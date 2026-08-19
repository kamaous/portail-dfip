const express = require('express');
const { getDb } = require('../db/connection');
const { auth, requireRole } = require('../middleware/auth');

const router = express.Router();

/* ===== Paramètres de plateforme =====
   contrainte_plages : '1' = les fiches de tutorat et les évaluations doivent
   s'inscrire dans les plages du Planning annuel (et une plage doit exister) ;
   '0' = plages purement indicatives (création libre).
   contrainte_vacances : '1' (défaut) = création d'évaluations INTERDITE durant
   les vacances scolaires ; '0' = autorisée. Les jours FÉRIÉS restent, eux,
   TOUJOURS bloquants (non concernés par cette option).
   SEUL LE DIRECTEUR DES active ou désactive ces options. */

const DEFAUTS = { contrainte_plages: '0', contrainte_vacances: '1' };

function getParam(db, cle) {
  const row = db.prepare('SELECT valeur FROM parametres WHERE cle = ?').get(cle);
  return row ? row.valeur : (DEFAUTS[cle] ?? null);
}

function setParam(db, cle, valeur, userId) {
  db.prepare(`
    INSERT INTO parametres (cle, valeur, modifie_par, modifie_le) VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur, modifie_par = excluded.modifie_par, modifie_le = excluded.modifie_le
  `).run(cle, valeur, userId);
}

// Lecture (tous les utilisateurs connectés — l'UI adapte ses messages)
router.get('/contrainte-plages', auth, (req, res) => {
  res.json({ active: getParam(getDb(), 'contrainte_plages') === '1' });
});

// Bascule : Directeur DES uniquement (rôle réel — l'alias DIRECTEUR ne suffit pas,
// requireRole('DIRECTEUR_DES') ne matche que le vrai DES)
router.put('/contrainte-plages', auth, requireRole('DIRECTEUR_DES'), (req, res) => {
  const db = getDb();
  const active = req.body.active === true || req.body.active === 1 || req.body.active === '1';
  setParam(db, 'contrainte_plages', active ? '1' : '0', req.user.id);
  db.prepare('INSERT INTO audit_logs (user_id, action, module, detail) VALUES (?, ?, ?, ?)')
    .run(req.user.id, 'PARAM_CONTRAINTE_PLAGES', 'PARAMETRES', active ? 'ACTIVÉE' : 'DÉSACTIVÉE');
  res.json({ active });
});

router.get('/contrainte-vacances', auth, (req, res) => {
  res.json({ active: getParam(getDb(), 'contrainte_vacances') !== '0' });
});
router.put('/contrainte-vacances', auth, requireRole('DIRECTEUR_DES'), (req, res) => {
  const db = getDb();
  const active = req.body.active === true || req.body.active === 1 || req.body.active === '1';
  setParam(db, 'contrainte_vacances', active ? '1' : '0', req.user.id);
  db.prepare('INSERT INTO audit_logs (user_id, action, module, detail) VALUES (?, ?, ?, ?)')
    .run(req.user.id, 'PARAM_CONTRAINTE_VACANCES', 'PARAMETRES', active ? 'ACTIVÉE' : 'DÉSACTIVÉE');
  res.json({ active });
});

module.exports = { router, getParam };
