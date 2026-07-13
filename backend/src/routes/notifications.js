const express = require('express');
const { getDb } = require('../db/connection');
const { auth } = require('../middleware/auth');

const router = express.Router();

// GET /api/notifications
router.get('/', auth, (req, res) => {
  const db = getDb();
  const limit = parseInt(req.query.limit) || 30;
  const notifs = db.prepare(`
    SELECT * FROM notifications WHERE user_id = ?
    ORDER BY created_at DESC LIMIT ?
  `).all(req.user.id, limit);
  res.json(notifs);
});

// PUT /api/notifications/lire-tout
router.put('/lire-tout', auth, (req, res) => {
  const db = getDb();
  db.prepare('UPDATE notifications SET lue = 1 WHERE user_id = ?').run(req.user.id);
  res.json({ message: 'Toutes les notifications marquées comme lues' });
});

// PUT /api/notifications/:id/lire
router.put('/:id/lire', auth, (req, res) => {
  const db = getDb();
  db.prepare('UPDATE notifications SET lue = 1 WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ message: 'Notification lue' });
});

// DELETE /api/notifications/:id
router.delete('/:id', auth, (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM notifications WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ message: 'Notification supprimée' });
});

module.exports = router;
