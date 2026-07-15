const jwt = require('jsonwebtoken');
const { JWT_SECRET, ROLE_HERITAGE, ROLES_VISITEURS, ROLE_ALIAS } = require('../config');
const { getDb } = require('../db/connection');

/* Rôles effectifs d'un utilisateur (alias + héritage inclus).
   Ex: RESPONSABLE_PEDAGOGIQUE → [RESPONSABLE_PEDAGOGIQUE, RESPONSABLE_POLE, RESPONSABLE_FORMATION]
       COORDONNATEUR → [COORDONNATEUR, ADMIN_PORTAIL] */
function rolesEffectifs(role) {
  const set = new Set([role]);
  if (ROLE_ALIAS[role]) set.add(ROLE_ALIAS[role]);
  for (const r of [...set]) (ROLE_HERITAGE[r] || []).forEach(h => set.add(h));
  return [...set];
}
function hasRole(user, ...roles) {
  if (!user) return false;
  const eff = rolesEffectifs(user.role);
  return roles.some(r => eff.includes(r));
}

/* Les rôles « visiteurs » n'ont accès qu'à la consultation du planning annuel */
const VISITEUR_ALLOW = [
  '/api/auth/',                      // me, logout, heartbeat, changement de mot de passe
  '/api/planning',                   // planning + périmètre + plages (GET)
  '/api/dashboard/annees',           // sélecteur d'année du planning
  '/api/calendrier-academique/',     // fériés & vacances (bandes du planning)
];
function accesVisiteurAutorise(req) {
  const url = req.originalUrl.split('?')[0];
  if (url.startsWith('/api/auth/')) return true;
  if (req.method !== 'GET') return false;
  return VISITEUR_ALLOW.some(p => url.startsWith(p));
}

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
  RESPONSABLE_PEDAGOGIQUE: 3,
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

    // Alias de droits : le rôle est traité comme son rôle cible partout dans l'API
    // (COORDONNATEUR → ADMIN_PORTAIL, DIRECTEUR_DES → DIRECTEUR) ; role_reel conserve l'original.
    req.user = {
      ...payload, ...user,
      role: ROLE_ALIAS[user.role] || user.role,
      role_reel: user.role,
      session_id: session.id,
      roles_effectifs: rolesEffectifs(user.role),
    };

    // Visiteurs (Recteur, Vice-Recteur, DES, Scolarité, Membres, Enseignants, Étudiants) :
    // lecture seule du planning annuel uniquement.
    if (ROLES_VISITEURS.includes(user.role) && !accesVisiteurAutorise(req)) {
      return res.status(403).json({ error: 'Accès visiteur : consultation du planning annuel uniquement.' });
    }

    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token expiré ou invalide' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Non authentifié' });
    // Tient compte de l'héritage de rôles (Responsable pédagogique = Dir. pôle + Resp. formation)
    if (!roles.some(r => req.user.roles_effectifs.includes(r))) {
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
    if (!req.user.roles_effectifs.includes('ADMIN_PORTAIL') && userLevel < minLevel) {
      return res.status(403).json({ error: 'Accès refusé — niveau insuffisant' });
    }
    next();
  };
}

module.exports = { auth, requireRole, requireMinRole, hasRole, rolesEffectifs, ROLE_LEVEL };
