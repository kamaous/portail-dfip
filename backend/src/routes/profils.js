const express = require('express');
const { getDb } = require('../db/connection');
const { auth, requireRole } = require('../middleware/auth');
const { ROLES, ROLE_LABELS } = require('../config');

const router = express.Router();

/* ===== PROFILS PERSONNALISÉS (Administrateur) =====
   Un profil = un nom + une description + des PRIVILÈGES hérités d'un rôle de
   base. Le code du profil est stocké dans users.role ; le middleware le résout
   vers le rôle de base pour tous les contrôles d'accès. Le PÉRIMÈTRE est celui
   du rôle de base, appliqué au pôle / à l'ENO affectés au compte. */

const slug = (s) => 'PROFIL_' + String(s).toUpperCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);

// GET /api/profils — liste (tous les connectés : nécessaire aux libellés)
router.get('/', auth, (req, res) => {
  const db = getDb();
  const profils = db.prepare(`
    SELECT p.*, (SELECT COUNT(*) FROM users u WHERE u.role = p.code AND u.actif = 1) as nb_utilisateurs
    FROM profils p ORDER BY p.nom
  `).all();
  res.json(profils.map(p => ({ ...p, base_role_label: ROLE_LABELS[p.base_role] || p.base_role })));
});

// POST /api/profils — création (ADMIN uniquement)
router.post('/', auth, requireRole('ADMIN_PORTAIL'), (req, res) => {
  const { nom, description, base_role } = req.body;
  if (!nom?.trim()) return res.status(400).json({ error: 'Nom du profil requis' });
  if (!ROLES.includes(base_role)) return res.status(400).json({ error: 'Rôle de base invalide' });
  const db = getDb();
  const code = slug(nom);
  try {
    const r = db.prepare('INSERT INTO profils (code, nom, description, base_role, created_by) VALUES (?, ?, ?, ?, ?)')
      .run(code, nom.trim(), description?.trim() || null, base_role, req.user.id);
    db.prepare('INSERT INTO audit_logs (user_id, action, module, detail) VALUES (?, ?, ?, ?)')
      .run(req.user.id, 'CREATE_PROFIL', 'PROFILS', `${nom} (privilèges : ${base_role})`);
    res.status(201).json(db.prepare('SELECT * FROM profils WHERE id = ?').get(r.lastInsertRowid));
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'Un profil avec un nom équivalent existe déjà' });
    throw e;
  }
});

// PUT /api/profils/:id — édition (ADMIN) : nom, description, privilèges, actif
// (le code ne change pas : les comptes existants restent rattachés)
router.put('/:id', auth, requireRole('ADMIN_PORTAIL'), (req, res) => {
  const db = getDb();
  const p = db.prepare('SELECT * FROM profils WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Profil introuvable' });
  const { nom, description, base_role, actif } = req.body;
  if (base_role !== undefined && !ROLES.includes(base_role)) {
    return res.status(400).json({ error: 'Rôle de base invalide' });
  }
  db.prepare('UPDATE profils SET nom = ?, description = ?, base_role = ?, actif = ? WHERE id = ?')
    .run(nom?.trim() || p.nom, description !== undefined ? (description?.trim() || null) : p.description,
      base_role || p.base_role, actif !== undefined ? (actif ? 1 : 0) : p.actif, p.id);
  db.prepare('INSERT INTO audit_logs (user_id, action, module, detail) VALUES (?, ?, ?, ?)')
    .run(req.user.id, 'UPDATE_PROFIL', 'PROFILS', `${p.nom}${base_role && base_role !== p.base_role ? ` (privilèges ${p.base_role} → ${base_role})` : ''}`);
  res.json(db.prepare('SELECT * FROM profils WHERE id = ?').get(p.id));
});

// DELETE /api/profils/:id — suppression (ADMIN) : refusée si des comptes l'utilisent
router.delete('/:id', auth, requireRole('ADMIN_PORTAIL'), (req, res) => {
  const db = getDb();
  const p = db.prepare('SELECT * FROM profils WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Profil introuvable' });
  const n = db.prepare('SELECT COUNT(*) as c FROM users WHERE role = ?').get(p.code).c;
  if (n > 0) return res.status(409).json({ error: `Impossible : ${n} compte(s) utilisent ce profil. Réaffectez-les d'abord.` });
  db.prepare('DELETE FROM profils WHERE id = ?').run(p.id);
  db.prepare('INSERT INTO audit_logs (user_id, action, module, detail) VALUES (?, ?, ?, ?)')
    .run(req.user.id, 'DELETE_PROFIL', 'PROFILS', p.nom);
  res.json({ message: 'Profil supprimé' });
});

module.exports = { router };
