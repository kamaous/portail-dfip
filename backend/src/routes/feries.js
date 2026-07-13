const express = require('express');
const { getDb } = require('../db/connection');
const { auth, requireRole } = require('../middleware/auth');

const router = express.Router();

/* ============ JOURS FÉRIÉS ============ */

// GET /api/calendrier-academique/feries
router.get('/feries', auth, (req, res) => {
  const db = getDb();
  res.json(db.prepare('SELECT * FROM jours_feries ORDER BY date').all());
});

// POST /api/calendrier-academique/feries (Directeur + Admin)
router.post('/feries', auth, requireRole('DIRECTEUR', 'ADMIN_PORTAIL'), (req, res) => {
  const { date, libelle, recurrent } = req.body;
  if (!date || !libelle) return res.status(400).json({ error: 'Date et libellé requis' });
  const db = getDb();
  const r = db.prepare('INSERT INTO jours_feries (date, libelle, recurrent, created_by) VALUES (?, ?, ?, ?)')
    .run(date, libelle, recurrent ? 1 : 0, req.user.id);
  db.prepare('INSERT INTO audit_logs (user_id, action, module, detail) VALUES (?, ?, ?, ?)')
    .run(req.user.id, 'CREATE_FERIE', 'CALENDRIER', `${libelle} (${date})`);
  res.status(201).json(db.prepare('SELECT * FROM jours_feries WHERE id = ?').get(r.lastInsertRowid));
});

// DELETE /api/calendrier-academique/feries/:id
router.delete('/feries/:id', auth, requireRole('DIRECTEUR', 'ADMIN_PORTAIL'), (req, res) => {
  getDb().prepare('DELETE FROM jours_feries WHERE id = ?').run(req.params.id);
  res.json({ message: 'Jour férié supprimé' });
});

/* ============ VACANCES (Directeur uniquement) ============ */

// GET /api/calendrier-academique/vacances
router.get('/vacances', auth, (req, res) => {
  const db = getDb();
  const { annee_id } = req.query;
  const sql = annee_id
    ? 'SELECT * FROM vacances WHERE annee_id = ? OR annee_id IS NULL ORDER BY date_debut'
    : 'SELECT * FROM vacances ORDER BY date_debut';
  res.json(annee_id ? db.prepare(sql).all(annee_id) : db.prepare(sql).all());
});

// POST /api/calendrier-academique/vacances (Directeur SEULEMENT)
router.post('/vacances', auth, requireRole('DIRECTEUR'), (req, res) => {
  const { annee_id, libelle, date_debut, date_fin } = req.body;
  if (!libelle || !date_debut || !date_fin) {
    return res.status(400).json({ error: 'Libellé, date de début et date de fin requis' });
  }
  if (date_fin < date_debut) return res.status(400).json({ error: 'La date de fin doit suivre la date de début' });
  const db = getDb();
  const r = db.prepare('INSERT INTO vacances (annee_id, libelle, date_debut, date_fin, created_by) VALUES (?, ?, ?, ?, ?)')
    .run(annee_id || null, libelle, date_debut, date_fin, req.user.id);
  db.prepare('INSERT INTO audit_logs (user_id, action, module, detail) VALUES (?, ?, ?, ?)')
    .run(req.user.id, 'CREATE_VACANCES', 'CALENDRIER', libelle);
  res.status(201).json(db.prepare('SELECT * FROM vacances WHERE id = ?').get(r.lastInsertRowid));
});

// DELETE /api/calendrier-academique/vacances/:id (Directeur SEULEMENT)
router.delete('/vacances/:id', auth, requireRole('DIRECTEUR'), (req, res) => {
  getDb().prepare('DELETE FROM vacances WHERE id = ?').run(req.params.id);
  res.json({ message: 'Vacances supprimées' });
});

module.exports = router;
