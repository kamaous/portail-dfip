const express = require('express');
const { getDb } = require('../db/connection');
const { auth, requireRole } = require('../middleware/auth');

const router = express.Router();

/* ===== RÉFÉRENTIEL — demandes de suppression =====
   Toute suppression de pôle, formation, promotion ou ENO est une DEMANDE
   qui doit être validée par le VICE-RECTEUR avant d'être appliquée. */

// Crée une demande (utilisé par poles.js et statistiques.js)
function demanderSuppression(db, { type, ref_id, libelle, user }) {
  const deja = db.prepare(
    "SELECT id FROM referentiel_suppressions WHERE type = ? AND ref_id = ? AND statut = 'EN_ATTENTE'"
  ).get(type, ref_id);
  if (deja) return { deja: true };
  db.prepare('INSERT INTO referentiel_suppressions (type, ref_id, libelle, demande_par) VALUES (?, ?, ?, ?)')
    .run(type, ref_id, libelle, user.id);
  const vr = db.prepare("SELECT * FROM users WHERE role = 'VICE_RECTEUR' AND actif = 1").all();
  const ins = db.prepare('INSERT INTO notifications (user_id, titre, message, type, lien) VALUES (?, ?, ?, ?, ?)');
  vr.forEach(u => ins.run(u.id, 'Suppression à valider',
    `${user.prenom} ${user.nom} demande la suppression de ${LBL[type]} « ${libelle} ».`, 'REFERENTIEL', '/referentiel'));
  db.prepare('INSERT INTO audit_logs (user_id, action, module, detail) VALUES (?, ?, ?, ?)')
    .run(user.id, 'DEMANDE_SUPPRESSION', 'REFERENTIEL', `${type} ${libelle}`);
  return { deja: false };
}

const LBL = { POLE: 'du pôle', FORMATION: 'de la formation', PROMOTION: 'de la promotion', ENO: "de l'ENO" };

// GET /api/referentiel/suppressions — demandes (en attente d'abord)
router.get('/suppressions', auth, (req, res) => {
  const db = getDb();
  res.json(db.prepare(`
    SELECT rs.*, d.prenom as demandeur_prenom, d.nom as demandeur_nom,
           v.prenom as decideur_prenom, v.nom as decideur_nom
    FROM referentiel_suppressions rs
    JOIN users d ON d.id = rs.demande_par
    LEFT JOIN users v ON v.id = rs.decide_par
    ORDER BY CASE rs.statut WHEN 'EN_ATTENTE' THEN 0 ELSE 1 END, rs.created_at DESC
    LIMIT 60
  `).all());
});

// POST /api/referentiel/suppressions/:id/decider — VICE-RECTEUR uniquement
router.post('/suppressions/:id/decider', auth, requireRole('VICE_RECTEUR'), (req, res) => {
  const { decision } = req.body; // VALIDER | REJETER
  if (!['VALIDER', 'REJETER'].includes(decision)) return res.status(400).json({ error: 'decision VALIDER ou REJETER requise' });
  const db = getDb();
  const dem = db.prepare('SELECT * FROM referentiel_suppressions WHERE id = ?').get(req.params.id);
  if (!dem) return res.status(404).json({ error: 'Demande introuvable' });
  if (dem.statut !== 'EN_ATTENTE') return res.status(409).json({ error: 'Demande déjà traitée' });

  if (decision === 'VALIDER') {
    // Application effective de la suppression, avec garde-fous
    if (dem.type === 'POLE') {
      const n = db.prepare('SELECT COUNT(*) as c FROM formations WHERE pole_id = ?').get(dem.ref_id).c;
      if (n > 0) return res.status(409).json({ error: `Impossible : ${n} formation(s) encore rattachée(s) à ce pôle. Supprimez-les d'abord.` });
      db.prepare('DELETE FROM poles WHERE id = ?').run(dem.ref_id);
    } else if (dem.type === 'FORMATION') {
      db.prepare('DELETE FROM effectifs WHERE formation_id = ?').run(dem.ref_id);
      db.prepare('DELETE FROM formations WHERE id = ?').run(dem.ref_id);
    } else if (dem.type === 'PROMOTION') {
      db.prepare('DELETE FROM promotions WHERE id = ?').run(dem.ref_id);
    } else if (dem.type === 'ENO') {
      const n = db.prepare('SELECT COUNT(*) as c FROM effectifs WHERE eno_id = ?').get(dem.ref_id).c;
      if (n > 0) return res.status(409).json({ error: `Impossible : ${n} effectif(s) rattachés à cet ENO. Videz-les d'abord.` });
      db.prepare('DELETE FROM eno_salles WHERE eno_id = ?').run(dem.ref_id);
      db.prepare('DELETE FROM enos WHERE id = ?').run(dem.ref_id);
    }
  }

  db.prepare("UPDATE referentiel_suppressions SET statut = ?, decide_par = ?, decide_le = datetime('now') WHERE id = ?")
    .run(decision === 'VALIDER' ? 'VALIDEE' : 'REJETEE', req.user.id, dem.id);
  db.prepare('INSERT INTO notifications (user_id, titre, message, type, lien) VALUES (?, ?, ?, ?, ?)')
    .run(dem.demande_par,
      decision === 'VALIDER' ? '✅ Suppression validée' : '❌ Suppression rejetée',
      `Le Vice-Recteur a ${decision === 'VALIDER' ? 'validé' : 'rejeté'} la suppression ${LBL[dem.type]} « ${dem.libelle} ».`,
      'REFERENTIEL', '/referentiel');
  db.prepare('INSERT INTO audit_logs (user_id, action, module, detail) VALUES (?, ?, ?, ?)')
    .run(req.user.id, `SUPPRESSION_${decision === 'VALIDER' ? 'VALIDEE' : 'REJETEE'}`, 'REFERENTIEL', `${dem.type} ${dem.libelle}`);
  res.json({ message: decision === 'VALIDER' ? 'Suppression appliquée' : 'Demande rejetée' });
});

module.exports = { router, demanderSuppression };
