const express = require('express');
const { getDb } = require('../db/connection');
const { auth, requireRole } = require('../middleware/auth');
const { notifierConcernes } = require('../services/notify');
const { sendEmail } = require('../services/email');
const { ROLES_RESTREINTS } = require('../config');

const router = express.Router();

// Création des fiches : initiée par les Responsables de formation, validée par le Chef div. Technopédagogie
const CREATE_ROLES = ['RESPONSABLE_FORMATION', 'CHEF_DIV_TECHNOPEDAGOGIE', 'DIRECTEUR', 'ADMIN_PORTAIL'];
// Section « PLATEFORMES ET TUTORATS » (indicateurs + état) : Chef div. Technopédagogie
const INDIC_ROLES = ['CHEF_DIV_TECHNOPEDAGOGIE', 'DIRECTEUR', 'ADMIN_PORTAIL'];
const WRITE_ROLES = INDIC_ROLES; // compat (signaler-retard, etc.)

// Tout est OK quand plateforme + cours disponibles et les 3 enrôlements effectifs
function toutEstOK(t) {
  return t.plateforme_cours === 'DISPONIBLE' && t.cours === 'DISPONIBLES'
    && t.enrolement_tuteurs === 'TERMINE' && t.enrolement_etudiants === 'TERMINE'
    && t.enrolement_enseignants === 'TERMINE';
}

function notifierRole(db, role, titre, message) {
  const users = db.prepare('SELECT * FROM users WHERE role = ? AND actif = 1').all(role);
  const ins = db.prepare('INSERT INTO notifications (user_id, titre, message, type, lien) VALUES (?, ?, ?, ?, ?)');
  users.forEach(u => ins.run(u.id, titre, message, 'TUTORAT', '/tutorat'));
  return users;
}

// GET /api/tutorat — suivi par Pôle/Filière/Semestre
router.get('/', auth, (req, res) => {
  const db = getDb();
  const { annee_id, pole_id, etat } = req.query;

  let query = `
    SELECT t.*,
      aa.libelle as annee_libelle,
      p.nom as pole_nom, p.code as pole_code,
      f.nom as formation_nom, f.code as formation_code, f.cycle as formation_cycle,
      pr.code as promotion_code,
      cb.nom as created_by_nom, cb.prenom as created_by_prenom
    FROM tutorat t
    JOIN annees_academiques aa ON aa.id = t.annee_id
    LEFT JOIN poles p ON p.id = t.pole_id
    LEFT JOIN formations f ON f.id = t.formation_id
    LEFT JOIN promotions pr ON pr.id = t.promotion_id
    JOIN users cb ON cb.id = t.created_by
    WHERE 1=1
  `;
  const params = [];
  if (annee_id) { query += ' AND t.annee_id = ?'; params.push(annee_id); }
  if (pole_id) { query += ' AND t.pole_id = ?'; params.push(pole_id); }
  if (etat) { query += ' AND t.etat_tutorat = ?'; params.push(etat); }
  // Rôles restreints (enseignants, étudiants, responsables...) : uniquement leur pôle
  if (ROLES_RESTREINTS.includes(req.user.role) && req.user.pole_id) {
    query += ' AND t.pole_id = ?'; params.push(req.user.pole_id);
  }
  query += ' ORDER BY t.updated_at DESC';
  res.json(db.prepare(query).all(...params));
});

// PUT /api/tutorat/demarrage-global — date de démarrage globale du tutorat (par année)
router.put('/demarrage-global', auth, requireRole('DIRECTEUR', 'CHEF_DIV_TECHNOPEDAGOGIE', 'ADMIN_PORTAIL'), (req, res) => {
  const { annee_id, date } = req.body;
  if (!annee_id) return res.status(400).json({ error: 'annee_id requis' });
  const db = getDb();
  db.prepare('UPDATE annees_academiques SET date_demarrage_tutorat = ? WHERE id = ?').run(date || null, annee_id);
  if (date) {
    notifierConcernes({
      titre: 'Démarrage global du tutorat',
      message: `La date de démarrage globale du tutorat est fixée au ${date}.`,
      type: 'TUTORAT',
      lien: '/tutorat',
    });
  }
  db.prepare('INSERT INTO audit_logs (user_id, action, module, detail) VALUES (?, ?, ?, ?)')
    .run(req.user.id, 'SET_DEMARRAGE_TUTORAT', 'TUTORAT', date || 'effacée');
  res.json(db.prepare('SELECT * FROM annees_academiques WHERE id = ?').get(annee_id));
});

// GET /api/tutorat/stats
router.get('/stats', auth, (req, res) => {
  const db = getDb();
  const { annee_id } = req.query;
  const cond = annee_id ? 'WHERE annee_id = ?' : '';
  const params = annee_id ? [annee_id] : [];
  res.json({
    total: db.prepare(`SELECT COUNT(*) as cnt FROM tutorat ${cond}`).get(...params).cnt,
    by_etat: db.prepare(`SELECT etat_tutorat as etat, COUNT(*) as cnt FROM tutorat ${cond} GROUP BY etat_tutorat`).all(...params),
  });
});

const FIELDS = ['plateforme_cours', 'cours', 'enrolement_tuteurs', 'enrolement_etudiants',
  'enrolement_enseignants', 'etat_tutorat', 'date_debut', 'date_fin',
  'date_demarree_le', 'date_terminee_le', 'observations'];

// POST /api/tutorat — création par un Responsable de formation (→ SOUMISE au Chef div. Technopédagogie)
router.post('/', auth, requireRole(...CREATE_ROLES), (req, res) => {
  const b = req.body;
  if (!b.annee_id) return res.status(400).json({ error: 'annee_id requis' });
  if (!b.pole_id || !b.promotion_id || !b.formation_id || !b.niveau || !b.semestre_code) {
    return res.status(400).json({ error: 'Pôle, promotion, formation, niveau et semestre requis' });
  }
  if (!b.date_debut || !b.date_fin) {
    return res.status(400).json({ error: 'Les dates de début et de fin du tutorat sont requises' });
  }
  const db = getDb();

  // Un responsable de formation ne crée que pour SON pôle
  if (req.user.role === 'RESPONSABLE_FORMATION' && req.user.pole_id !== parseInt(b.pole_id)) {
    return res.status(403).json({ error: 'Vous ne pouvez créer des fiches que pour votre pôle.' });
  }

  // Soumise si créée par un responsable de formation, validée d'office sinon
  const soumise = req.user.role === 'RESPONSABLE_FORMATION';
  const statut_fiche = soumise ? 'SOUMISE' : 'VALIDEE';

  const r = db.prepare(`
    INSERT INTO tutorat (annee_id, pole_id, promotion_id, formation_id, niveau, semestre_code,
      date_debut, date_fin, statut_fiche, observations, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    b.annee_id, b.pole_id, b.promotion_id, b.formation_id, b.niveau, b.semestre_code,
    b.date_debut, b.date_fin, statut_fiche, b.observations || null, req.user.id
  );

  if (soumise) {
    const formation = db.prepare('SELECT nom FROM formations WHERE id = ?').get(b.formation_id);
    const chefs = notifierRole(db, 'CHEF_DIV_TECHNOPEDAGOGIE', '📥 Fiche tutorat à valider',
      `${req.user.prenom} ${req.user.nom} a soumis une fiche tutorat : ${formation?.nom || ''} (${b.niveau} ${b.semestre_code}).`);
    chefs.forEach(c => sendEmail({
      to: c.email,
      subject: '[Portail DFIP] Fiche tutorat à valider',
      html: `<p>Une nouvelle fiche de suivi tutorat attend votre validation : <strong>${formation?.nom || ''}</strong> (${b.niveau} ${b.semestre_code}), du ${b.date_debut} au ${b.date_fin}.</p>`,
    }));
  }

  db.prepare('INSERT INTO audit_logs (user_id, action, module, detail) VALUES (?, ?, ?, ?)')
    .run(req.user.id, 'CREATE_TUTORAT', 'TUTORAT', `Fiche #${r.lastInsertRowid} (${statut_fiche})`);

  res.status(201).json(db.prepare('SELECT * FROM tutorat WHERE id = ?').get(r.lastInsertRowid));
});

// POST /api/tutorat/:id/valider — validation de la fiche par le Chef div. Technopédagogie
router.post('/:id/valider', auth, requireRole(...INDIC_ROLES), (req, res) => {
  const { decision } = req.body; // VALIDEE | REJETEE
  if (!['VALIDEE', 'REJETEE'].includes(decision)) return res.status(400).json({ error: 'Décision invalide' });
  const db = getDb();
  const t = db.prepare('SELECT * FROM tutorat WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Fiche introuvable' });
  if (t.statut_fiche !== 'SOUMISE') return res.status(409).json({ error: 'Cette fiche a déjà été traitée' });

  db.prepare("UPDATE tutorat SET statut_fiche = ?, valide_par = ?, date_validation = datetime('now'), updated_at = datetime('now') WHERE id = ?")
    .run(decision, req.user.id, req.params.id);

  // Notifier le responsable de formation créateur
  const createur = db.prepare('SELECT * FROM users WHERE id = ?').get(t.created_by);
  if (createur) {
    const formation = t.formation_id ? db.prepare('SELECT nom FROM formations WHERE id = ?').get(t.formation_id) : null;
    const msg = decision === 'VALIDEE'
      ? `Votre fiche tutorat ${formation?.nom || ''} (${t.niveau} ${t.semestre_code}) a été validée — le suivi PLATEFORMES ET TUTORATS démarre.`
      : `Votre fiche tutorat ${formation?.nom || ''} (${t.niveau} ${t.semestre_code}) a été rejetée.`;
    db.prepare('INSERT INTO notifications (user_id, titre, message, type, lien) VALUES (?, ?, ?, ?, ?)')
      .run(createur.id, decision === 'VALIDEE' ? '✅ Fiche tutorat validée' : '❌ Fiche tutorat rejetée', msg, 'TUTORAT', '/tutorat');
    sendEmail({ to: createur.email, subject: `[Portail DFIP] Fiche tutorat ${decision === 'VALIDEE' ? 'validée' : 'rejetée'}`, html: `<p>${msg}</p>` });
  }

  res.json(db.prepare('SELECT * FROM tutorat WHERE id = ?').get(req.params.id));
});

// PUT /api/tutorat/:id — mise à jour (indicateurs = Chef div. Technopédagogie ; dates = créateur aussi)
router.put('/:id', auth, (req, res) => {
  const db = getDb();
  const prev = db.prepare('SELECT * FROM tutorat WHERE id = ?').get(req.params.id);
  if (!prev) return res.status(404).json({ error: 'Fiche introuvable' });

  const estChef = INDIC_ROLES.includes(req.user.role);
  const estCreateurRF = req.user.role === 'RESPONSABLE_FORMATION' && prev.created_by === req.user.id;
  if (!estChef && !estCreateurRF) {
    return res.status(403).json({ error: 'Section PLATEFORMES ET TUTORATS réservée au Chef de division Technopédagogie.' });
  }

  const INDICATEURS = ['plateforme_cours', 'cours', 'enrolement_tuteurs', 'enrolement_etudiants',
    'enrolement_enseignants', 'etat_tutorat', 'date_demarree_le', 'date_terminee_le'];
  const champsDemandes = FIELDS.filter(f => f in req.body);

  // Le responsable de formation créateur ne peut ajuster que les dates prévues et observations
  if (!estChef && champsDemandes.some(f => INDICATEURS.includes(f))) {
    return res.status(403).json({ error: 'Seul le Chef de division Technopédagogie met à jour la section PLATEFORMES ET TUTORATS.' });
  }

  // Les indicateurs ne se remplissent qu'après validation de la fiche
  if (estChef && prev.statut_fiche === 'SOUMISE' && champsDemandes.some(f => INDICATEURS.includes(f))) {
    return res.status(409).json({ error: 'Validez d\'abord la fiche avant de renseigner PLATEFORMES ET TUTORATS.' });
  }

  // Verrou métier : l'état tutorat reste « En attente de démarrage » tant que tout n'est pas OK
  if (req.body.etat_tutorat && req.body.etat_tutorat !== 'PAS_DEMARRE') {
    const apres = { ...prev, ...req.body };
    if (!toutEstOK(apres)) {
      return res.status(422).json({
        error: 'Tout doit être OK avant de démarrer : plateforme disponible, cours disponibles et les 3 enrôlements effectifs.',
        verrou_etat: true,
      });
    }
  }

  const sets = [];
  const vals = [];
  for (const f of champsDemandes) { sets.push(`${f}=?`); vals.push(req.body[f]); }
  if (sets.length) {
    vals.push(req.params.id);
    db.prepare(`UPDATE tutorat SET ${sets.join(', ')}, updated_at=datetime('now') WHERE id=?`).run(...vals);
  }

  // Notifier si l'état global du tutorat change
  if (req.body.etat_tutorat && req.body.etat_tutorat !== prev.etat_tutorat) {
    const labels = { PAS_DEMARRE: 'Pas encore démarré', EN_COURS: 'En cours', TERMINE: 'Terminé' };
    const filiere = prev.formation_id ? db.prepare('SELECT nom FROM formations WHERE id = ?').get(prev.formation_id) : null;
    notifierConcernes({
      pole_id: prev.pole_id,
      titre: 'Tutorat — changement d\'état',
      message: `Le tutorat${filiere ? ` (${filiere.nom})` : ''} est maintenant : ${labels[req.body.etat_tutorat]}.`,
      type: 'TUTORAT',
      lien: '/tutorat',
    });
  }

  res.json(db.prepare('SELECT * FROM tutorat WHERE id = ?').get(req.params.id));
});

// POST /api/tutorat/:id/signaler-retard — créer un incident lié au non-respect des dates
router.post('/:id/signaler-retard', auth, requireRole(...WRITE_ROLES), (req, res) => {
  const db = getDb();
  const t = db.prepare('SELECT * FROM tutorat WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Fiche introuvable' });

  const filiere = t.formation_id ? db.prepare('SELECT nom FROM formations WHERE id = ?').get(t.formation_id) : null;
  const { description, consequence_tutorat, consequence_calendrier } = req.body;

  const titre = `Retard tutorat${filiere ? ` — ${filiere.nom}` : ''}${t.promotion_id ? ` (${db.prepare('SELECT code FROM promotions WHERE id = ?').get(t.promotion_id)?.code || ''})` : ''}`;
  const r = db.prepare(`
    INSERT INTO incidents (titre, description, type_incident, gravite, statut, signale_par,
      pole_id, date_debut, date_incident, consequence_tutorat, consequence_calendrier, ref_type, ref_id)
    VALUES (?, ?, 'RETARD', 'HAUTE', 'OUVERT', ?, ?, date('now'), date('now'), ?, ?, 'TUTORAT', ?)
  `).run(titre,
    description || `Les dates du tutorat (début: ${t.date_debut || '—'}, fin: ${t.date_fin || '—'}) n'ont pas été respectées.`,
    req.user.id, t.pole_id || null,
    consequence_tutorat || 'Fin prolongée', consequence_calendrier || null, t.id);

  notifierConcernes({
    pole_id: t.pole_id,
    titre: `🚨 ${titre}`,
    message: `Un retard a été signalé sur le tutorat${filiere ? ` (${filiere.nom})` : ''}.`,
    type: 'INCIDENT',
    lien: '/incidents',
  });

  db.prepare('INSERT INTO audit_logs (user_id, action, module, detail) VALUES (?, ?, ?, ?)')
    .run(req.user.id, 'CREATE_INCIDENT', 'TUTORAT', titre);

  res.status(201).json(db.prepare('SELECT * FROM incidents WHERE id = ?').get(r.lastInsertRowid));
});

// DELETE /api/tutorat/:id
router.delete('/:id', auth, requireRole('DIRECTEUR', 'ADMIN_PORTAIL'), (req, res) => {
  getDb().prepare('DELETE FROM tutorat WHERE id = ?').run(req.params.id);
  res.json({ message: 'Fiche supprimée' });
});

module.exports = router;
