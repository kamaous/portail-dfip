const express = require('express');
const { getDb } = require('../db/connection');
const { auth, requireRole } = require('../middleware/auth');
const { demanderSuppression } = require('./referentiel');

const router = express.Router();

/* RÈGLES RÉFÉRENTIEL :
   - AJOUT de pôles, formations, promotions : Directeur DES uniquement (rôle réel).
   - ÉDITION : Directeur DES (via alias DIRECTEUR) + Direction/Admin.
   - SUPPRESSION : demande obligatoirement VALIDÉE par le Vice-Recteur. */

// GET /api/poles — avec formations (référentiel UN-CHK)
router.get('/', auth, (req, res) => {
  const db = getDb();
  const poles = db.prepare('SELECT * FROM poles ORDER BY code').all();
  const formations = db.prepare('SELECT * FROM formations ORDER BY cycle, nom').all();

  const rps = db.prepare("SELECT pole_id, nom, prenom FROM users WHERE role = 'RESPONSABLE_PEDAGOGIQUE' AND actif = 1").all();

  const result = poles.map(p => ({
    ...p,
    formations: formations.filter(f => f.pole_id === p.id),
    responsable_pedagogique: rps.find(r => r.pole_id === p.id) || null,
    promo_filieres: [], // compat : ancien modèle supprimé
  }));

  res.json(result);
});

// GET /api/poles/promotions — liste des promotions (P9..P13)
router.get('/promotions', auth, (req, res) => {
  res.json(getDb().prepare('SELECT * FROM promotions WHERE active = 1 ORDER BY code').all());
});

// POST /api/poles/promotions — AJOUT : Directeur DES uniquement
router.post('/promotions', auth, requireRole('DIRECTEUR_DES'), (req, res) => {
  const { code, annee_entree } = req.body;
  if (!code) return res.status(400).json({ error: 'Code requis (ex: P14)' });
  const db = getDb();
  try {
    const r = db.prepare('INSERT INTO promotions (code, annee_entree) VALUES (?, ?)').run(code.toUpperCase(), annee_entree || null);
    res.status(201).json(db.prepare('SELECT * FROM promotions WHERE id = ?').get(r.lastInsertRowid));
  } catch {
    res.status(409).json({ error: 'Cette promotion existe déjà' });
  }
});

// PUT /api/poles/promotions/:id — édition (DES via alias, Direction, Admin)
router.put('/promotions/:id', auth, requireRole('DIRECTEUR', 'ADMIN_PORTAIL'), (req, res) => {
  const db = getDb();
  const p = db.prepare('SELECT * FROM promotions WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Promotion introuvable' });
  const { code, annee_entree } = req.body;
  db.prepare('UPDATE promotions SET code = ?, annee_entree = ? WHERE id = ?')
    .run(code ? code.toUpperCase() : p.code, annee_entree !== undefined ? (annee_entree || null) : p.annee_entree, p.id);
  res.json(db.prepare('SELECT * FROM promotions WHERE id = ?').get(p.id));
});

// DELETE /api/poles/promotions/:id — demande à valider par le Vice-Recteur
router.delete('/promotions/:id', auth, requireRole('DIRECTEUR', 'ADMIN_PORTAIL'), (req, res) => {
  const db = getDb();
  const p = db.prepare('SELECT * FROM promotions WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Promotion introuvable' });
  const r = demanderSuppression(db, { type: 'PROMOTION', ref_id: p.id, libelle: p.code, user: req.user });
  res.status(202).json({ message: r.deja ? 'Demande déjà en attente chez le Vice-Recteur' : 'Demande transmise au Vice-Recteur pour validation', demande: true });
});

// POST /api/poles/:id/formations — AJOUT : Directeur DES uniquement
// Champs : code (sigle) + nom complet + cycle (LICENCE | MASTER)
router.post('/:id/formations', auth, requireRole('DIRECTEUR_DES'), (req, res) => {
  const { nom, code, cycle } = req.body;
  if (!code?.trim()) return res.status(400).json({ error: 'Abréviation (sigle) requise' });
  if (!nom?.trim()) return res.status(400).json({ error: 'Nom complet requis' });
  if (!['LICENCE', 'MASTER'].includes(cycle)) return res.status(400).json({ error: 'Cycle requis : LICENCE ou MASTER' });
  const db = getDb();
  try {
    const r = db.prepare('INSERT INTO formations (pole_id, nom, code, cycle) VALUES (?, ?, ?, ?)')
      .run(req.params.id, nom.trim(), code.trim().toUpperCase(), cycle);
    res.status(201).json(db.prepare('SELECT * FROM formations WHERE id = ?').get(r.lastInsertRowid));
  } catch {
    res.status(409).json({ error: 'Cette formation existe déjà pour ce pôle' });
  }
});

// PUT /api/poles/formations/:fid — édition (DES via alias, Direction, Admin)
router.put('/formations/:fid', auth, requireRole('DIRECTEUR', 'ADMIN_PORTAIL'), (req, res) => {
  const db = getDb();
  const f = db.prepare('SELECT * FROM formations WHERE id = ?').get(req.params.fid);
  if (!f) return res.status(404).json({ error: 'Formation introuvable' });
  const { nom, code, cycle } = req.body;
  db.prepare('UPDATE formations SET nom = ?, code = ?, cycle = ? WHERE id = ?')
    .run(nom?.trim() || f.nom, code !== undefined ? (code.trim().toUpperCase() || null) : f.code,
      ['LICENCE', 'MASTER'].includes(cycle) ? cycle : f.cycle, f.id);
  res.json(db.prepare('SELECT * FROM formations WHERE id = ?').get(f.id));
});

// DELETE /api/poles/formations/:fid — demande à valider par le Vice-Recteur
router.delete('/formations/:fid', auth, requireRole('DIRECTEUR', 'ADMIN_PORTAIL'), (req, res) => {
  const db = getDb();
  const f = db.prepare('SELECT * FROM formations WHERE id = ?').get(req.params.fid);
  if (!f) return res.status(404).json({ error: 'Formation introuvable' });
  const r = demanderSuppression(db, { type: 'FORMATION', ref_id: f.id, libelle: `${f.code || ''} ${f.nom}`.trim(), user: req.user });
  res.status(202).json({ message: r.deja ? 'Demande déjà en attente chez le Vice-Recteur' : 'Demande transmise au Vice-Recteur pour validation', demande: true });
});

// POST /api/poles — AJOUT de pôle : Directeur DES uniquement
router.post('/', auth, requireRole('DIRECTEUR_DES'), (req, res) => {
  const { code, nom } = req.body;
  if (!code) return res.status(400).json({ error: 'Code requis' });
  const db = getDb();
  try {
    const r = db.prepare('INSERT INTO poles (code, nom) VALUES (?, ?)').run(code.toUpperCase(), nom || null);
    res.status(201).json(db.prepare('SELECT * FROM poles WHERE id = ?').get(r.lastInsertRowid));
  } catch {
    res.status(409).json({ error: 'Code déjà utilisé' });
  }
});

router.put('/:id', auth, requireRole('DIRECTEUR', 'ADMIN_PORTAIL'), (req, res) => {
  const { code, nom } = req.body;
  const db = getDb();
  db.prepare('UPDATE poles SET code = ?, nom = ? WHERE id = ?').run(code.toUpperCase(), nom || null, req.params.id);
  res.json({ message: 'Pôle mis à jour' });
});

// DELETE /api/poles/:id — demande à valider par le Vice-Recteur
router.delete('/:id', auth, requireRole('DIRECTEUR', 'ADMIN_PORTAIL'), (req, res) => {
  const db = getDb();
  const p = db.prepare('SELECT * FROM poles WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Pôle introuvable' });
  const r = demanderSuppression(db, { type: 'POLE', ref_id: p.id, libelle: `${p.code}${p.nom ? ` — ${p.nom}` : ''}`, user: req.user });
  res.status(202).json({ message: r.deja ? 'Demande déjà en attente chez le Vice-Recteur' : 'Demande transmise au Vice-Recteur pour validation', demande: true });
});

// CRUD Promo-Filières
router.post('/promo-filieres', auth, requireRole('DIRECTEUR', 'ADMIN_PORTAIL', 'CHEF_SERVICE'), (req, res) => {
  const { pole_id, nom } = req.body;
  if (!pole_id || !nom) return res.status(400).json({ error: 'pole_id et nom requis' });
  const db = getDb();
  try {
    const r = db.prepare('INSERT INTO promo_filieres (pole_id, nom) VALUES (?, ?)').run(pole_id, nom);
    res.status(201).json(db.prepare('SELECT * FROM promo_filieres WHERE id = ?').get(r.lastInsertRowid));
  } catch {
    res.status(409).json({ error: 'Cette filière existe déjà dans ce pôle' });
  }
});

router.put('/promo-filieres/:id', auth, requireRole('DIRECTEUR', 'ADMIN_PORTAIL', 'CHEF_SERVICE'), (req, res) => {
  const { nom } = req.body;
  const db = getDb();
  db.prepare('UPDATE promo_filieres SET nom = ? WHERE id = ?').run(nom, req.params.id);
  res.json({ message: 'Filière mise à jour' });
});

router.delete('/promo-filieres/:id', auth, requireRole('DIRECTEUR', 'ADMIN_PORTAIL'), (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM promo_filieres WHERE id = ?').run(req.params.id);
  res.json({ message: 'Filière supprimée' });
});

// CRUD Semestres
router.post('/semestres', auth, requireRole('DIRECTEUR', 'ADMIN_PORTAIL', 'CHEF_SERVICE'), (req, res) => {
  const { promo_filiere_id, nom } = req.body;
  if (!promo_filiere_id || !nom) return res.status(400).json({ error: 'promo_filiere_id et nom requis' });
  const db = getDb();
  try {
    const r = db.prepare('INSERT INTO semestres (promo_filiere_id, nom) VALUES (?, ?)').run(promo_filiere_id, nom);
    res.status(201).json(db.prepare('SELECT * FROM semestres WHERE id = ?').get(r.lastInsertRowid));
  } catch {
    res.status(409).json({ error: 'Ce semestre existe déjà' });
  }
});

router.delete('/semestres/:id', auth, requireRole('DIRECTEUR', 'ADMIN_PORTAIL'), (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM semestres WHERE id = ?').run(req.params.id);
  res.json({ message: 'Semestre supprimé' });
});

module.exports = router;
