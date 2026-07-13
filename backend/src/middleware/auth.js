const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config');
const { getDb } = require('../db/connection');

// Hiérarchie : RECTEUR > VICE_RECTEUR > DIRECTEUR > CHEF_* > RESPONSABLE_* > membres > lecteurs
const ROLE_LEVEL = {
  RECTEUR: 7,
  VICE_RECTEUR: 6,
  DIRECTEUR: 5,
  DIRECTEUR_DES: 5,
  CHEF_SERVICE: 4,
  CHEF_DIV_TECHNOPEDAGOGIE: 4,
  CHEF_DIV_EVALUATION: 4,
  RESPONSABLE_POLE: 3,
  RESPONSABLE_FORMATION: 3,
  MEMBRE_POLE: 3,
  SCOLARITE: 3,
  ENSEIGNANT: 2,
  ETUDIANT: 1,
  ADMIN_PORTAIL: 10 // accès spécial admin
};

function auth(req, res, next) {
  const header = req.headers['authorization'];
  if (!header) return res.status(401).json({ error: 'Token manquant' });

  const token = header.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token invalide' });

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const db = getDb();

    // Vérifier que la session est toujours active
    const session = db.prepare(
      'SELECT id FROM user_sessions WHERE token_jti = ? AND actif = 1'
    ).get(payload.jti);

    if (!session) return res.status(401).json({ error: 'Session expirée ou invalide' });

    // Mettre à jour last_activity
    db.prepare(
      "UPDATE user_sessions SET last_activity = datetime('now') WHERE token_jti = ?"
    ).run(payload.jti);

    // Vérifier que l'utilisateur est toujours actif
    const user = db.prepare('SELECT * FROM users WHERE id = ? AND actif = 1').get(payload.id);
    if (!user) return res.status(401).json({ error: 'Compte désactivé' });

    req.user = { ...payload, ...user, session_id: session.id };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token expiré ou invalide' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Non authentifié' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Accès refusé — rôle insuffisant' });
    }
    next();
  };
}

function requireMinRole(minRole) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Non authentifié' });
    const userLevel = ROLE_LEVEL[req.user.role] || 0;
    const minLevel = ROLE_LEVEL[minRole] || 0;
    if (req.user.role !== 'ADMIN_PORTAIL' && userLevel < minLevel) {
      return res.status(403).json({ error: 'Accès refusé — niveau insuffisant' });
    }
    next();
  };
}

module.exports = { auth, requireRole, requireMinRole, ROLE_LEVEL };
