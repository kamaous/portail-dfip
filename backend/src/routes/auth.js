const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('crypto').randomUUID ? { v4: () => require('crypto').randomUUID() } : require('crypto');
const { getDb } = require('../db/connection');
const { JWT_SECRET, JWT_EXPIRES_IN, ROLE_LABELS } = require('../config');
const { auth } = require('../middleware/auth');

const router = express.Router();

function generateJti() {
  return require('crypto').randomUUID();
}

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email et mot de passe requis' });

  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE email = ? AND actif = 1').get(email.toLowerCase().trim());

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
  }

  const jti = generateJti();
  const token = jwt.sign(
    { id: user.id, email: user.email, role: user.role, nom: user.nom, prenom: user.prenom, jti },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );

  // Enregistrer la session
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  db.prepare(`
    INSERT INTO user_sessions (user_id, token_jti, ip_address, user_agent)
    VALUES (?, ?, ?, ?)
  `).run(user.id, jti, ip, req.headers['user-agent'] || '');

  // Log audit
  db.prepare(`INSERT INTO audit_logs (user_id, action, module, ip_address) VALUES (?, ?, ?, ?)`)
    .run(user.id, 'LOGIN', 'AUTH', ip);

  const { password_hash, ...userSafe } = user;
  res.json({
    token,
    user: { ...userSafe, role_label: ROLE_LABELS[user.role] || user.role },
    must_change_password: !!user.must_change_password
  });
});

// POST /api/auth/logout
router.post('/logout', auth, (req, res) => {
  const db = getDb();
  db.prepare(`
    UPDATE user_sessions SET actif = 0, disconnected_at = datetime('now')
    WHERE token_jti = ?
  `).run(req.user.jti);

  db.prepare(`INSERT INTO audit_logs (user_id, action, module) VALUES (?, ?, ?)`)
    .run(req.user.id, 'LOGOUT', 'AUTH');

  res.json({ message: 'Déconnexion réussie' });
});

// POST /api/auth/change-password
router.post('/change-password', auth, (req, res) => {
  const { ancien_password, nouveau_password } = req.body;
  if (!ancien_password || !nouveau_password) {
    return res.status(400).json({ error: 'Champs requis manquants' });
  }
  if (nouveau_password.length < 6) {
    return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 6 caractères' });
  }

  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(ancien_password, user.password_hash)) {
    return res.status(400).json({ error: 'Ancien mot de passe incorrect' });
  }

  const hash = bcrypt.hashSync(nouveau_password, 10);
  db.prepare(`
    UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = datetime('now')
    WHERE id = ?
  `).run(hash, req.user.id);

  db.prepare(`INSERT INTO audit_logs (user_id, action, module) VALUES (?, ?, ?)`)
    .run(req.user.id, 'CHANGE_PASSWORD', 'AUTH');

  res.json({ message: 'Mot de passe modifié avec succès' });
});

// GET /api/auth/me
router.get('/me', auth, (req, res) => {
  const db = getDb();
  const user = db.prepare(`
    SELECT u.*, p.nom as pole_nom
    FROM users u
    LEFT JOIN poles p ON p.id = u.pole_id
    WHERE u.id = ?
  `).get(req.user.id);

  const { password_hash, ...userSafe } = user;
  const nonLues = db.prepare('SELECT COUNT(*) as cnt FROM notifications WHERE user_id = ? AND lue = 0').get(req.user.id);

  res.json({
    user: { ...userSafe, role_label: ROLE_LABELS[user.role] || user.role },
    notifications_non_lues: nonLues.cnt
  });
});

// POST /api/auth/heartbeat — maintient la session active
router.post('/heartbeat', auth, (req, res) => {
  res.json({ ok: true });
});

module.exports = router;
