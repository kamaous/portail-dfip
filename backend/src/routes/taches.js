const express = require('express');
const { getDb } = require('../db/connection');
const { auth } = require('../middleware/auth');
const { sendEmail, templates } = require('../services/email');

const router = express.Router();

function notifyAssigne(db, tache, assignePar) {
  const assigne = db.prepare('SELECT * FROM users WHERE id = ?').get(tache.assigne_a);
  if (!assigne) return;

  // Notification interne
  db.prepare(`INSERT INTO notifications (user_id, titre, message, type, lien) VALUES (?, ?, ?, ?, ?)`)
    .run(assigne.id, 'Nouvelle tâche assignée', `"${tache.titre}" par ${assignePar.prenom} ${assignePar.nom}`, 'TACHE', `/taches/${tache.id}`);

  // Email
  const tpl = templates.nouvelleTache(assigne, assignePar, tache);
  sendEmail({ to: assigne.email, ...tpl });
}

// GET /api/taches
router.get('/', auth, (req, res) => {
  const db = getDb();
  const { mode } = req.query; // 'recues' | 'assignees' | 'toutes'

  let query = `
    SELECT t.*,
      ap.nom as assigne_par_nom, ap.prenom as assigne_par_prenom,
      aa.nom as assigne_a_nom, aa.prenom as assigne_a_prenom
    FROM taches t
    JOIN users ap ON ap.id = t.assigne_par
    JOIN users aa ON aa.id = t.assigne_a
  `;

  let params = [];
  if (mode === 'recues') {
    query += ' WHERE t.assigne_a = ?';
    params = [req.user.id];
  } else if (mode === 'assignees') {
    query += ' WHERE t.assigne_par = ?';
    params = [req.user.id];
  } else if (req.user.role === 'DIRECTEUR' || req.user.role === 'ADMIN_PORTAIL') {
    // Tous les accès
  } else {
    query += ' WHERE t.assigne_a = ? OR t.assigne_par = ?';
    params = [req.user.id, req.user.id];
  }

  query += ' ORDER BY t.created_at DESC';
  res.json(db.prepare(query).all(...params));
});

// GET /api/taches/:id
router.get('/:id', auth, (req, res) => {
  const db = getDb();
  const tache = db.prepare(`
    SELECT t.*,
      ap.nom as assigne_par_nom, ap.prenom as assigne_par_prenom,
      aa.nom as assigne_a_nom, aa.prenom as assigne_a_prenom
    FROM taches t
    JOIN users ap ON ap.id = t.assigne_par
    JOIN users aa ON aa.id = t.assigne_a
    WHERE t.id = ?
  `).get(req.params.id);

  if (!tache) return res.status(404).json({ error: 'Tâche non trouvée' });

  const commentaires = db.prepare(`
    SELECT tc.*, u.nom, u.prenom, u.role
    FROM tache_commentaires tc
    JOIN users u ON u.id = tc.user_id
    WHERE tc.tache_id = ?
    ORDER BY tc.created_at ASC
  `).all(req.params.id);

  res.json({ ...tache, commentaires });
});

// POST /api/taches
router.post('/', auth, (req, res) => {
  const { titre, description, type, priorite, assigne_a, date_echeance, module, ref_id } = req.body;
  if (!titre || !assigne_a) return res.status(400).json({ error: 'Titre et destinataire requis' });

  const db = getDb();

  const result = db.prepare(`
    INSERT INTO taches (titre, description, type, priorite, assigne_par, assigne_a, date_echeance, module, ref_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(titre, description || null, type || 'GENERALE', priorite || 'NORMALE', req.user.id, assigne_a, date_echeance || null, module || null, ref_id || null);

  const newTache = db.prepare('SELECT * FROM taches WHERE id = ?').get(result.lastInsertRowid);
  notifyAssigne(db, newTache, req.user);

  db.prepare(`INSERT INTO audit_logs (user_id, action, module, detail) VALUES (?, ?, ?, ?)`)
    .run(req.user.id, 'CREATE_TACHE', 'TACHES', titre);

  res.status(201).json(newTache);
});

// PUT /api/taches/:id/statut
router.put('/:id/statut', auth, (req, res) => {
  const { statut, observations } = req.body;
  const db = getDb();
  const tache = db.prepare('SELECT * FROM taches WHERE id = ?').get(req.params.id);
  if (!tache) return res.status(404).json({ error: 'Tâche non trouvée' });

  // Seul l'assigné ou un admin/directeur peut changer le statut
  if (tache.assigne_a !== req.user.id && !['DIRECTEUR', 'ADMIN_PORTAIL'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Non autorisé' });
  }

  const date_completion = statut === 'COMPLETEE' ? "datetime('now')" : 'NULL';
  db.prepare(`
    UPDATE taches SET statut = ?, observations = ?,
      date_completion = ${date_completion === 'NULL' ? 'NULL' : date_completion},
      updated_at = datetime('now')
    WHERE id = ?
  `).run(statut, observations || tache.observations, req.params.id);

  if (statut === 'COMPLETEE') {
    const assignePar = db.prepare('SELECT * FROM users WHERE id = ?').get(tache.assigne_par);
    const assigne = db.prepare('SELECT * FROM users WHERE id = ?').get(tache.assigne_a);
    if (assignePar && assigne) {
      db.prepare(`INSERT INTO notifications (user_id, titre, message, type, lien) VALUES (?, ?, ?, ?, ?)`)
        .run(assignePar.id, 'Tâche complétée', `"${tache.titre}" a été complétée par ${assigne.prenom} ${assigne.nom}`, 'TACHE', `/taches/${tache.id}`);
      const tpl = templates.tacheCompletee(assignePar, assigne, tache);
      sendEmail({ to: assignePar.email, ...tpl });
    }
  }

  res.json({ message: 'Statut mis à jour' });
});

// POST /api/taches/:id/commentaires
router.post('/:id/commentaires', auth, (req, res) => {
  const { contenu } = req.body;
  if (!contenu) return res.status(400).json({ error: 'Contenu requis' });

  const db = getDb();
  const tache = db.prepare('SELECT * FROM taches WHERE id = ?').get(req.params.id);
  if (!tache) return res.status(404).json({ error: 'Tâche non trouvée' });

  db.prepare('INSERT INTO tache_commentaires (tache_id, user_id, contenu) VALUES (?, ?, ?)').run(req.params.id, req.user.id, contenu);

  // Notifier l'autre partie
  const notifId = tache.assigne_a === req.user.id ? tache.assigne_par : tache.assigne_a;
  db.prepare(`INSERT INTO notifications (user_id, titre, message, type, lien) VALUES (?, ?, ?, ?, ?)`)
    .run(notifId, 'Nouveau commentaire', `Sur la tâche "${tache.titre}"`, 'TACHE', `/taches/${tache.id}`);

  res.status(201).json({ message: 'Commentaire ajouté' });
});

// DELETE /api/taches/:id
router.delete('/:id', auth, (req, res) => {
  const db = getDb();
  const tache = db.prepare('SELECT * FROM taches WHERE id = ?').get(req.params.id);
  if (!tache) return res.status(404).json({ error: 'Tâche non trouvée' });

  if (tache.assigne_par !== req.user.id && !['DIRECTEUR', 'ADMIN_PORTAIL'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Non autorisé' });
  }

  db.prepare('DELETE FROM taches WHERE id = ?').run(req.params.id);
  res.json({ message: 'Tâche supprimée' });
});

module.exports = router;
