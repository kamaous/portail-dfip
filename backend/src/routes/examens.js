const express = require('express');
const { getDb } = require('../db/connection');
const { auth, requireRole } = require('../middleware/auth');
const { sendEmail } = require('../services/email');

const router = express.Router();

// GET /api/examens
router.get('/', auth, (req, res) => {
  const db = getDb();
  const { annee_id, pole_id, statut } = req.query;

  let query = `
    SELECT e.*,
      p.nom as pole_nom, pf.nom as filiere_nom, s.nom as semestre_nom,
      aa.libelle as annee_libelle,
      u.nom as surveillant_nom, u.prenom as surveillant_prenom,
      cb.nom as created_by_nom, cb.prenom as created_by_prenom
    FROM examens e
    JOIN annees_academiques aa ON aa.id = e.annee_id
    LEFT JOIN poles p ON p.id = e.pole_id
    LEFT JOIN promo_filieres pf ON pf.id = e.promo_filiere_id
    LEFT JOIN semestres s ON s.id = e.semestre_id
    LEFT JOIN users u ON u.id = e.surveillant_id
    JOIN users cb ON cb.id = e.created_by
    WHERE 1=1
  `;
  const params = [];

  if (annee_id) { query += ' AND e.annee_id = ?'; params.push(annee_id); }
  if (pole_id) { query += ' AND e.pole_id = ?'; params.push(pole_id); }
  if (statut) { query += ' AND e.statut = ?'; params.push(statut); }

  if (req.user.role === 'MEMBRE_POLE' && req.user.pole_id) {
    query += ' AND e.pole_id = ?';
    params.push(req.user.pole_id);
  }

  query += ' ORDER BY e.date_debut DESC, e.created_at DESC';
  res.json(db.prepare(query).all(...params));
});

// GET /api/examens/stats
router.get('/stats', auth, (req, res) => {
  const db = getDb();
  const { annee_id } = req.query;
  const cond = annee_id ? 'WHERE annee_id = ?' : '';
  const params = annee_id ? [annee_id] : [];

  const total = db.prepare(`SELECT COUNT(*) as cnt FROM examens ${cond}`).get(...params);
  const byStatut = db.prepare(`SELECT statut, COUNT(*) as cnt FROM examens ${cond} GROUP BY statut`).all(...params);
  const byType = db.prepare(`SELECT type_examen, COUNT(*) as cnt FROM examens ${cond} GROUP BY type_examen`).all(...params);

  res.json({ total: total.cnt, by_statut: byStatut, by_type: byType });
});

// POST /api/examens
router.post('/', auth, requireRole('DIRECTEUR', 'CHEF_SERVICE', 'ADMIN_PORTAIL', 'SCOLARITE'), (req, res) => {
  const { annee_id, pole_id, promo_filiere_id, semestre_id, libelle, type_examen, date_debut, date_fin, salle, surveillant_id, nb_inscrits } = req.body;
  if (!annee_id || !libelle) return res.status(400).json({ error: 'annee_id et libelle requis' });

  const db = getDb();
  const result = db.prepare(`
    INSERT INTO examens (annee_id, pole_id, promo_filiere_id, semestre_id, libelle, type_examen, date_debut, date_fin, salle, surveillant_id, nb_inscrits, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(annee_id, pole_id || null, promo_filiere_id || null, semestre_id || null, libelle, type_examen || 'ORDINAIRE', date_debut || null, date_fin || null, salle || null, surveillant_id || null, nb_inscrits || null, req.user.id);

  // Notifier le surveillant si assigné
  if (surveillant_id) {
    const surveillant = db.prepare('SELECT * FROM users WHERE id = ?').get(surveillant_id);
    if (surveillant) {
      db.prepare(`INSERT INTO notifications (user_id, titre, message, type) VALUES (?, ?, ?, ?)`)
        .run(surveillant.id, 'Surveillance assignée', `Vous êtes assigné(e) comme surveillant(e) pour : ${libelle}`, 'EXAMEN');
      sendEmail({
        to: surveillant.email,
        subject: '[Portail DFIP] Surveillance d\'examen assignée',
        html: `<p>Bonjour ${surveillant.prenom} ${surveillant.nom},</p><p>Vous avez été assigné(e) comme surveillant(e) pour l'examen : <strong>${libelle}</strong>.</p>${date_debut ? `<p>Date : ${date_debut}</p>` : ''}`
      });
    }
  }

  db.prepare(`INSERT INTO audit_logs (user_id, action, module, detail) VALUES (?, ?, ?, ?)`)
    .run(req.user.id, 'CREATE_EXAMEN', 'EXAMENS', libelle);

  res.status(201).json(db.prepare('SELECT * FROM examens WHERE id = ?').get(result.lastInsertRowid));
});

// PUT /api/examens/:id
router.put('/:id', auth, requireRole('DIRECTEUR', 'CHEF_SERVICE', 'ADMIN_PORTAIL', 'SCOLARITE'), (req, res) => {
  const { libelle, type_examen, date_debut, date_fin, salle, surveillant_id, nb_inscrits, nb_presents, statut, pv_deliberation, observations } = req.body;
  const db = getDb();

  db.prepare(`
    UPDATE examens SET libelle=?, type_examen=?, date_debut=?, date_fin=?, salle=?,
      surveillant_id=?, nb_inscrits=?, nb_presents=?, statut=?, pv_deliberation=?,
      observations=?, updated_at=datetime('now')
    WHERE id=?
  `).run(libelle, type_examen, date_debut || null, date_fin || null, salle || null, surveillant_id || null, nb_inscrits || null, nb_presents || null, statut, pv_deliberation || null, observations || null, req.params.id);

  res.json({ message: 'Examen mis à jour' });
});

// DELETE /api/examens/:id
router.delete('/:id', auth, requireRole('DIRECTEUR', 'ADMIN_PORTAIL'), (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM examens WHERE id = ?').run(req.params.id);
  res.json({ message: 'Examen supprimé' });
});

module.exports = router;
