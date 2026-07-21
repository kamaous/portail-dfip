const express = require('express');
const bcrypt = require('bcryptjs');
const { getDb } = require('../db/connection');
const { auth, requireRole } = require('../middleware/auth');
const { sendEmail, templates } = require('../services/email');
const { ROLE_LABELS } = require('../config');

const router = express.Router();

// GET /api/users — liste tous les utilisateurs (DIRECTEUR + ADMIN)
router.get('/', auth, requireRole('DIRECTEUR', 'ADMIN_PORTAIL', 'CHEF_SERVICE'), (req, res) => {
  const db = getDb();
  const users = db.prepare(`
    SELECT u.id, u.nom, u.prenom, u.email, u.role, u.service, u.actif,
           u.must_change_password, u.created_at, p.nom as pole_nom
    FROM users u
    LEFT JOIN poles p ON p.id = u.pole_id
    ORDER BY u.nom
  `).all();
  res.json(users.map(u => ({ ...u, role_label: ROLE_LABELS[u.role] || u.role })));
});

// GET /api/users/online — utilisateurs en ligne
router.get('/online', auth, (req, res) => {
  const db = getDb();
  const onlines = db.prepare(`
    SELECT s.user_id, s.connected_at, s.last_activity, s.ip_address,
           u.nom, u.prenom, u.role,
           ROUND((julianday('now') - julianday(s.connected_at)) * 24 * 60, 0) as minutes_connecte
    FROM user_sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.actif = 1
      AND datetime(s.last_activity) > datetime('now', '-15 minutes')
    ORDER BY s.last_activity DESC
  `).all();
  res.json(onlines.map(u => ({ ...u, role_label: ROLE_LABELS[u.role] || u.role })));
});

// GET /api/users/sessions — historique des sessions (ADMIN + DIRECTEUR)
router.get('/sessions', auth, requireRole('DIRECTEUR', 'ADMIN_PORTAIL'), (req, res) => {
  const db = getDb();
  const limit = parseInt(req.query.limit) || 50;
  const sessions = db.prepare(`
    SELECT s.*, u.nom, u.prenom, u.role,
           ROUND((julianday(COALESCE(s.disconnected_at, 'now')) - julianday(s.connected_at)) * 24 * 60, 1) as duree_minutes
    FROM user_sessions s
    JOIN users u ON u.id = s.user_id
    ORDER BY s.connected_at DESC
    LIMIT ?
  `).all(limit);
  res.json(sessions);
});

// GET /api/users/visites — nombre total de visites (connexions) du portail
router.get('/visites', auth, requireRole('DIRECTEUR', 'ADMIN_PORTAIL'), (req, res) => {
  const db = getDb();
  res.json({
    total: db.prepare('SELECT COUNT(*) as c FROM user_sessions').get().c,
    ce_mois: db.prepare("SELECT COUNT(*) as c FROM user_sessions WHERE connected_at >= date('now', 'start of month')").get().c,
    aujourdhui: db.prepare("SELECT COUNT(*) as c FROM user_sessions WHERE date(connected_at) = date('now')").get().c,
  });
});

// POST /api/users — créer un utilisateur (ADMIN + DIRECTEUR)
router.post('/', auth, requireRole('DIRECTEUR', 'ADMIN_PORTAIL'), (req, res) => {
  const { nom, prenom, email, role, pole_id, service, password } = req.body;
  if (!nom || !email || !role) return res.status(400).json({ error: 'Champs requis manquants' });

  const tmpPassword = password || `UnCHK@${Math.floor(1000 + Math.random() * 9000)}`;
  const hash = bcrypt.hashSync(tmpPassword, 10);
  const db = getDb();

  try {
    const result = db.prepare(`
      INSERT INTO users (nom, prenom, email, password_hash, role, pole_id, service)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(nom, prenom || '', email.toLowerCase().trim(), hash, role, pole_id || null, service || null);

    const newUser = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);

    // Notification email
    const tpl = templates.bienvenue({ ...newUser, prenom: prenom || nom }, tmpPassword, ROLE_LABELS[role] || role);
    sendEmail({ to: email, ...tpl });

    // Notification interne
    db.prepare(`INSERT INTO notifications (user_id, titre, message, type) VALUES (?, ?, ?, ?)`)
      .run(result.lastInsertRowid, 'Bienvenue !', `Votre compte ${ROLE_LABELS[role]} a été créé.`, 'INFO');

    db.prepare(`INSERT INTO audit_logs (user_id, action, module, detail) VALUES (?, ?, ?, ?)`)
      .run(req.user.id, 'CREATE_USER', 'USERS', `${nom} ${prenom} (${role})`);

    const { password_hash, ...safe } = newUser;
    res.status(201).json({ ...safe, tmp_password: tmpPassword, role_label: ROLE_LABELS[role] });
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.status(409).json({ error: 'Cet email est déjà utilisé' });
    throw err;
  }
});

// PUT /api/users/:id — modifier un utilisateur (TOUS les champs, email et mot de passe inclus)
router.put('/:id', auth, requireRole('DIRECTEUR', 'ADMIN_PORTAIL'), (req, res) => {
  const { nom, prenom, email, role, pole_id, service, actif, password } = req.body;
  const db = getDb();

  const prev = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!prev) return res.status(404).json({ error: 'Utilisateur introuvable' });

  // Email modifiable : normalisé + unicité contrôlée
  const nouvelEmail = (email || prev.email).toLowerCase().trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nouvelEmail)) {
    return res.status(400).json({ error: 'Adresse email invalide' });
  }
  if (nouvelEmail !== prev.email &&
      db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(nouvelEmail, req.params.id)) {
    return res.status(409).json({ error: 'Cet email est déjà utilisé par un autre compte' });
  }

  // Mot de passe optionnel : s'il est fourni, il est définitif (choisi par l'admin)
  const mdp = (password || '').trim();
  if (mdp && mdp.length < 6) {
    return res.status(400).json({ error: 'Mot de passe trop court (6 caractères minimum)' });
  }

  db.prepare(`
    UPDATE users SET nom=?, prenom=?, email=?, role=?, pole_id=?, service=?, actif=?, updated_at=datetime('now')
    WHERE id=?
  `).run(nom ?? prev.nom, prenom ?? prev.prenom ?? '', nouvelEmail, role || prev.role,
    pole_id || null, service || null, actif !== undefined ? actif : 1, req.params.id);

  if (mdp) {
    db.prepare("UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?")
      .run(bcrypt.hashSync(mdp, 10), req.params.id);
  }

  const changements = [
    nouvelEmail !== prev.email && `email ${prev.email} → ${nouvelEmail}`,
    (role && role !== prev.role) && `rôle ${prev.role} → ${role}`,
    mdp && 'mot de passe modifié',
  ].filter(Boolean).join(', ');
  db.prepare(`INSERT INTO audit_logs (user_id, action, module, detail) VALUES (?, ?, ?, ?)`)
    .run(req.user.id, 'UPDATE_USER', 'USERS', `id=${req.params.id}${changements ? ` (${changements})` : ''}`);

  res.json({ message: 'Utilisateur mis à jour' });
});

// DELETE /api/users/:id — désactiver (soft delete)
router.delete('/:id', auth, requireRole('ADMIN_PORTAIL'), (req, res) => {
  const db = getDb();
  db.prepare(`UPDATE users SET actif = 0, updated_at = datetime('now') WHERE id = ?`).run(req.params.id);
  // Fermer toutes les sessions
  db.prepare(`UPDATE user_sessions SET actif = 0, disconnected_at = datetime('now') WHERE user_id = ?`).run(req.params.id);
  res.json({ message: 'Utilisateur désactivé' });
});

// POST /api/users/:id/reset-password (ADMIN + DIRECTEUR)
// L'admin peut fournir son propre mot de passe ({ password }) — sinon un temporaire est généré.
router.post('/:id/reset-password', auth, requireRole('DIRECTEUR', 'ADMIN_PORTAIL'), (req, res) => {
  const choisi = (req.body?.password || '').trim();
  if (choisi && choisi.length < 6) return res.status(400).json({ error: 'Mot de passe trop court (6 caractères minimum)' });
  const tmpPassword = choisi || `UnCHK@${Math.floor(1000 + Math.random() * 9000)}`;
  const hash = bcrypt.hashSync(tmpPassword, 10);
  const db = getDb();
  if (!db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id)) {
    return res.status(404).json({ error: 'Utilisateur introuvable' });
  }

  db.prepare(`
    UPDATE users SET password_hash = ?, must_change_password = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(hash, choisi ? 0 : 1, req.params.id); // mot de passe choisi par l'admin = définitif

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  sendEmail({
    to: user.email,
    subject: '[Portail DFIP] Réinitialisation de votre mot de passe',
    html: `<p>Bonjour ${user.prenom} ${user.nom},</p><p>Votre mot de passe a été réinitialisé. Nouveau mot de passe temporaire : <strong>${tmpPassword}</strong></p><p>Veuillez le changer à votre prochaine connexion.</p>`
  });

  res.json({ message: 'Mot de passe réinitialisé', tmp_password: tmpPassword });
});

module.exports = router;
