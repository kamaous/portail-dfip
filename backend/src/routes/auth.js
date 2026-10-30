const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('crypto').randomUUID ? { v4: () => require('crypto').randomUUID() } : require('crypto');
const { getDb } = require('../db/connection');
const { JWT_SECRET, JWT_EXPIRES_IN, ROLE_LABELS, ROLE_ALIAS, ROLES } = require('../config');

/* Le front reçoit le rôle EFFECTIF (alias appliqué : Coordonnateur → Admin,
   DES → Directeur ; profils personnalisés → leur rôle de base) pour que tous
   ses contrôles d'accès fonctionnent, et le libellé réel pour l'affichage. */
function userPourFront(user, db) {
  const { password_hash, ...safe } = user;
  let base = user.role, label = ROLE_LABELS[user.role] || user.role;
  if (!ROLES.includes(user.role) && db) {
    const prof = db.prepare('SELECT nom, base_role FROM profils WHERE code = ?').get(user.role);
    if (prof) { base = prof.base_role; label = prof.nom; }
  }
  return {
    ...safe,
    role: ROLE_ALIAS[base] || base,
    role_reel: user.role,
    role_label: label,
  };
}
const { auth } = require('../middleware/auth');

const router = express.Router();

function generateJti() {
  return require('crypto').randomUUID();
}

/* Anti-force-brute : 8 échecs sur un même couple IP+email en 15 min → blocage 15 min.
   (en mémoire — remis à zéro au redémarrage, suffisant contre les attaques en ligne) */
const tentatives = new Map(); // clé "ip|email" → { count, until }
const FENETRE_MS = 15 * 60 * 1000, MAX_ECHECS = 8;
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of tentatives) if (now > v.until) tentatives.delete(k);
}, 10 * 60 * 1000).unref();

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email et mot de passe requis' });

  const ipClient = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const cle = `${ipClient}|${String(email).toLowerCase().trim()}`;
  const essai = tentatives.get(cle);
  if (essai && essai.count >= MAX_ECHECS && Date.now() < essai.until) {
    return res.status(429).json({ error: 'Trop de tentatives. Réessayez dans quelques minutes.' });
  }

  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE email = ? AND actif = 1').get(email.toLowerCase().trim());

  // Compte BLOQUÉ (3 tentatives échouées) : seul un administrateur peut débloquer
  if (user && user.bloque) {
    db.prepare('INSERT INTO audit_logs (user_id, action, module, detail, ip_address) VALUES (?, ?, ?, ?, ?)')
      .run(user.id, 'LOGIN_BLOQUE', 'AUTH', 'tentative sur compte bloqué', ipClient);
    return res.status(423).json({ error: 'Compte bloqué après 3 tentatives de connexion échouées. Contactez l\'administrateur pour le débloquer.' });
  }

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    const cur = tentatives.get(cle) || { count: 0, until: 0 };
    tentatives.set(cle, { count: cur.count + 1, until: Date.now() + FENETRE_MS });
    db.prepare('INSERT INTO audit_logs (user_id, action, module, detail, ip_address) VALUES (?, ?, ?, ?, ?)')
      .run(user?.id || null, 'LOGIN_FAILED', 'AUTH', String(email).slice(0, 120), ipClient);

    // Compteur PAR COMPTE : au 3e échec, le compte est bloqué
    if (user) {
      const essais = (user.tentatives_echouees || 0) + 1;
      if (essais >= 3) {
        db.prepare('UPDATE users SET bloque = 1, tentatives_echouees = ? WHERE id = ?').run(essais, user.id);
        db.prepare('INSERT INTO audit_logs (user_id, action, module, detail, ip_address) VALUES (?, ?, ?, ?, ?)')
          .run(user.id, 'COMPTE_BLOQUE', 'AUTH', '3 tentatives échouées', ipClient);
        const admins = db.prepare("SELECT id FROM users WHERE role IN ('ADMIN_PORTAIL','DIRECTEUR') AND actif = 1").all();
        const ins = db.prepare('INSERT INTO notifications (user_id, titre, message, type, lien) VALUES (?, ?, ?, ?, ?)');
        admins.forEach(a => ins.run(a.id, '🔒 Compte bloqué',
          `Le compte ${user.email} a été bloqué après 3 tentatives de connexion échouées.`, 'SECURITE', '/utilisateurs'));
        return res.status(423).json({ error: 'Compte bloqué après 3 tentatives de connexion échouées. Contactez l\'administrateur pour le débloquer.' });
      }
      db.prepare('UPDATE users SET tentatives_echouees = ? WHERE id = ?').run(essais, user.id);
      // Le compte existe : on invite à RÉCUPÉRER le mot de passe avant le blocage
      return res.status(401).json({
        error: `Email ou mot de passe incorrect (tentative ${essais}/3). Mot de passe oublié ? Faites une récupération avant que votre compte ne soit bloqué au 3e échec.`,
        recuperation: true,
        tentatives_restantes: 3 - essais,
      });
    }
    return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
  }
  tentatives.delete(cle);
  if (user.tentatives_echouees) db.prepare('UPDATE users SET tentatives_echouees = 0 WHERE id = ?').run(user.id);

  // MOT DE PASSE PAR DÉFAUT encore en usage → changement OBLIGATOIRE à cette connexion
  if (password === 'Test@2026' && !user.must_change_password) {
    db.prepare('UPDATE users SET must_change_password = 1 WHERE id = ?').run(user.id);
    user.must_change_password = 1;
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

  res.json({
    token,
    user: userPourFront(user, db),
    must_change_password: !!user.must_change_password
  });
});

/* ===== RÉCUPÉRATION DU MOT DE PASSE =====
   L'adresse doit correspondre à un compte actif du portail (sinon : s'adresser à
   l'administrateur). Un lien à usage unique, valable RESET_MINUTES, est envoyé par
   email ; seule l'empreinte SHA-256 du jeton est conservée en base.
   Un compte BLOQUÉ reste déblocable uniquement par un administrateur. */
const crypto = require('crypto');
const { sendEmail, templates } = require('../services/email');
const { APP_URL } = require('../config');
const RESET_MINUTES = 60;
const empreinte = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
const MSG_COMPTE_BLOQUE = 'Ce compte est bloqué après 3 tentatives de connexion échouées. Contactez l\'administrateur pour le débloquer.';

// Anti-abus : 5 demandes par IP en 15 min
const demandesReset = new Map(); // ip → { count, until }
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of demandesReset) if (now > v.until) demandesReset.delete(k);
}, 10 * 60 * 1000).unref();

function jetonValide(db, token) {
  if (!token) return null;
  return db.prepare(`
    SELECT pr.id as reset_id, u.*
    FROM password_resets pr JOIN users u ON u.id = pr.user_id
    WHERE pr.token_hash = ? AND pr.used_at IS NULL
      AND datetime(pr.expires_at) > datetime('now') AND u.actif = 1
  `).get(empreinte(token));
}

// POST /api/auth/forgot-password
router.post('/forgot-password', async (req, res) => {
  const email = String(req.body?.email || '').toLowerCase().trim();
  if (!email) return res.status(400).json({ error: 'Adresse email requise' });

  const ipClient = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  let d = demandesReset.get(ipClient);
  if (!d || Date.now() > d.until) d = { count: 0, until: Date.now() + FENETRE_MS };
  if (d.count >= 5) return res.status(429).json({ error: 'Trop de demandes. Réessayez dans quelques minutes.' });
  demandesReset.set(ipClient, { count: d.count + 1, until: d.until });

  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE email = ? AND actif = 1').get(email);
  if (!user) {
    return res.status(404).json({
      error: 'Aucun compte n\'est associé à cette adresse email. Rapprochez-vous de l\'administrateur du portail pour obtenir un compte.',
    });
  }
  if (user.bloque) return res.status(423).json({ error: MSG_COMPTE_BLOQUE });

  // Un seul envoi toutes les 2 minutes pour un même compte
  const recent = db.prepare(`
    SELECT id FROM password_resets WHERE user_id = ? AND datetime(created_at) > datetime('now', '-2 minutes')
  `).get(user.id);
  if (recent) {
    return res.status(429).json({ error: 'Un email de récupération vient d\'être envoyé à cette adresse. Vérifiez votre boîte de réception (et les spams) avant de refaire une demande.' });
  }

  const token = crypto.randomBytes(32).toString('hex');
  db.prepare("UPDATE password_resets SET used_at = datetime('now') WHERE user_id = ? AND used_at IS NULL").run(user.id);
  db.prepare(`
    INSERT INTO password_resets (user_id, token_hash, expires_at, ip_address)
    VALUES (?, ?, datetime('now', ?), ?)
  `).run(user.id, empreinte(token), `+${RESET_MINUTES} minutes`, ipClient);

  const lien = `${APP_URL.replace(/\/$/, '')}/reinitialiser-mot-de-passe?token=${token}`;
  const envoye = await sendEmail({ to: user.email, ...templates.recuperationMotDePasse(user, lien, RESET_MINUTES) });
  db.prepare('INSERT INTO audit_logs (user_id, action, module, detail, ip_address) VALUES (?, ?, ?, ?, ?)')
    .run(user.id, 'PASSWORD_RESET_REQUEST', 'AUTH', envoye ? 'email envoyé' : 'échec envoi email', ipClient);
  if (!envoye) {
    return res.status(502).json({ error: 'L\'email de récupération n\'a pas pu être envoyé. Réessayez plus tard ou contactez l\'administrateur.' });
  }

  res.json({ message: `Un email de récupération a été envoyé à ${user.email}. Le lien est valable ${RESET_MINUTES} minutes.` });
});

// GET /api/auth/reset-password/:token — le lien est-il encore valable ?
router.get('/reset-password/:token', (req, res) => {
  const user = jetonValide(getDb(), req.params.token);
  if (!user) return res.status(400).json({ error: 'Ce lien de récupération est invalide, expiré ou déjà utilisé. Faites une nouvelle demande.' });
  if (user.bloque) return res.status(423).json({ error: MSG_COMPTE_BLOQUE });
  res.json({ email: user.email });
});

// POST /api/auth/reset-password
router.post('/reset-password', (req, res) => {
  const { token, nouveau_password } = req.body || {};
  if (!token || !nouveau_password) return res.status(400).json({ error: 'Champs requis manquants' });
  if (nouveau_password.length < 6) {
    return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 6 caractères' });
  }
  if (nouveau_password === 'Test@2026') {
    return res.status(400).json({ error: 'Ce mot de passe n\'est pas autorisé — choisissez un mot de passe personnel' });
  }

  const db = getDb();
  const user = jetonValide(db, token);
  if (!user) return res.status(400).json({ error: 'Ce lien de récupération est invalide, expiré ou déjà utilisé. Faites une nouvelle demande.' });
  if (user.bloque) return res.status(423).json({ error: MSG_COMPTE_BLOQUE });

  const ipClient = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  db.transaction(() => {
    db.prepare(`
      UPDATE users SET password_hash = ?, must_change_password = 0, tentatives_echouees = 0, updated_at = datetime('now')
      WHERE id = ?
    `).run(bcrypt.hashSync(nouveau_password, 10), user.id);
    db.prepare("UPDATE password_resets SET used_at = datetime('now') WHERE user_id = ? AND used_at IS NULL").run(user.id);
    // Les sessions ouvertes avec l'ancien mot de passe sont fermées
    db.prepare("UPDATE user_sessions SET actif = 0, disconnected_at = datetime('now') WHERE user_id = ? AND actif = 1").run(user.id);
    db.prepare('INSERT INTO audit_logs (user_id, action, module, ip_address) VALUES (?, ?, ?, ?)')
      .run(user.id, 'PASSWORD_RESET', 'AUTH', ipClient);
  })();

  res.json({ message: 'Mot de passe réinitialisé. Vous pouvez maintenant vous connecter.' });
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
  // Le nouveau mot de passe doit être DIFFÉRENT de l'actuel
  if (nouveau_password === ancien_password) {
    return res.status(400).json({ error: 'Le nouveau mot de passe doit être différent du mot de passe actuel' });
  }
  // Interdire de revenir au mot de passe par défaut
  if (nouveau_password === 'Test@2026') {
    return res.status(400).json({ error: 'Ce mot de passe n\'est pas autorisé — choisissez un mot de passe personnel' });
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

  const nonLues = db.prepare('SELECT COUNT(*) as cnt FROM notifications WHERE user_id = ? AND lue = 0').get(req.user.id);

  res.json({
    user: userPourFront(user, db),
    notifications_non_lues: nonLues.cnt
  });
});

// POST /api/auth/heartbeat — maintient la session active
router.post('/heartbeat', auth, (req, res) => {
  res.json({ ok: true });
});

module.exports = router;
