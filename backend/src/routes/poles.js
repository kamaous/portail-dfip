const express = require('express');
const { getDb } = require('../db/connection');
const { auth, requireRole } = require('../middleware/auth');

const router = express.Router();

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

// POST /api/poles/promotions
router.post('/promotions', auth, requireRole('DIRECTEUR', 'ADMIN_PORTAIL'), (req, res) => {
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

// POST /api/poles/:id/formations
router.post('/:id/formations', auth, requireRole('DIRECTEUR', 'ADMIN_PORTAIL', 'CHEF_SERVICE'), (req, res) => {
  const { nom, code, cycle } = req.body;
  if (!nom) return res.status(400).json({ error: 'Nom requis' });
  const db = getDb();
  try {
    const r = db.prepare('INSERT INTO formations (pole_id, nom, code, cycle) VALUES (?, ?, ?, ?)')
      .run(req.params.id, nom, code || null, cycle || 'LICENCE');
    res.status(201).json(db.prepare('SELECT * FROM formations WHERE id = ?').get(r.lastInsertRowid));
  } catch {
    res.status(409).json({ error: 'Cette formation existe déjà pour ce pôle' });
  }
});

// DELETE /api/poles/formations/:fid
router.delete('/formations/:fid', auth, requireRole('DIRECTEUR', 'ADMIN_PORTAIL'), (req, res) => {
  getDb().prepare('DELETE FROM formations WHERE id = ?').run(req.params.fid);
  res.json({ message: 'Formation supprimée' });
});

// CRUD Pôles (ADMIN + DIRECTEUR)
router.post('/', auth, requireRole('DIRECTEUR', 'ADMIN_PORTAIL'), (req, res) => {
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

router.delete('/:id', auth, requireRole('DIRECTEUR', 'ADMIN_PORTAIL'), (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM poles WHERE id = ?').run(req.params.id);
  res.json({ message: 'Pôle supprimé' });
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
