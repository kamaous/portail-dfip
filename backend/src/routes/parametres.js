const express = require('express');
const { getDb } = require('../db/connection');
const { auth, requireRole } = require('../middleware/auth');

const router = express.Router();

/* ===== Paramètres de plateforme =====
   contrainte_plages : '1' = les fiches de tutorat et les évaluations doivent
   s'inscrire dans les plages du Planning annuel (et une plage doit exister) ;
   '0' = plages purement indicatives (création libre).
   SEUL LE DIRECTEUR DES active ou désactive cette option. */

const DEFAUTS = { contrainte_plages: '0' };

function getParam(db, cle) {
  const row = db.prepare('SELECT valeur FROM parametres WHERE cle = ?').get(cle);
  return row ? row.valeur : (DEFAUTS[cle] ?? null);
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
  db.prepare(`
    INSERT INTO parametres (cle, valeur, modifie_par, modifie_le) VALUES ('contrainte_plages', ?, ?, datetime('now'))
    ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur, modifie_par = excluded.modifie_par, modifie_le = excluded.modifie_le
  `).run(active ? '1' : '0', req.user.id);
  db.prepare('INSERT INTO audit_logs (user_id, action, module, detail) VALUES (?, ?, ?, ?)')
    .run(req.user.id, 'PARAM_CONTRAINTE_PLAGES', 'PARAMETRES', active ? 'ACTIVÉE' : 'DÉSACTIVÉE');
  res.json({ active });
});

module.exports = { router, getParam };
