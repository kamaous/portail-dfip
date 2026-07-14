const express = require('express');
const { getDb } = require('../db/connection');
const { auth, requireRole, hasRole } = require('../middleware/auth');
const { sendEmail } = require('../services/email');
const { emailWrapper } = require('../services/notify');

const router = express.Router();

/* Signalements de non-conformité :
   - émis par les Responsables de formation (sur une fiche tutorat ou une évaluation de leur pôle)
   - traités par le Responsable pédagogique du pôle (+ Direction) */

function chargerCible(db, cible_type, cible_id) {
  if (cible_type === 'TUTORAT') {
    return db.prepare(`
      SELECT t.id, t.pole_id, t.formation_id, f.nom as formation_nom, p.code as pole_code
      FROM tutorat t LEFT JOIN formations f ON f.id = t.formation_id LEFT JOIN poles p ON p.id = t.pole_id
      WHERE t.id = ?`).get(cible_id);
  }
  return db.prepare(`
    SELECT se.id, se.pole_id, se.formation_id, f.nom as formation_nom, p.code as pole_code
    FROM sessions_examen se LEFT JOIN formations f ON f.id = se.formation_id LEFT JOIN poles p ON p.id = se.pole_id
    WHERE se.id = ?`).get(cible_id);
}

// POST /api/signalements — Responsable de formation (sa formation / son pôle)
router.post('/', auth, requireRole('RESPONSABLE_FORMATION', 'RESPONSABLE_PEDAGOGIQUE'), (req, res) => {
  const { cible_type, cible_id, objet, message } = req.body;
  if (!['TUTORAT', 'EVALUATION'].includes(cible_type)) return res.status(400).json({ error: 'Cible invalide' });
  if (!cible_id || !objet || !message) return res.status(400).json({ error: 'Objet et message détaillé requis' });

  const db = getDb();
  const cible = chargerCible(db, cible_type, cible_id);
  if (!cible) return res.status(404).json({ error: 'Élément introuvable' });
  if (req.user.pole_id && cible.pole_id && req.user.pole_id !== cible.pole_id) {
    return res.status(403).json({ error: 'Vous ne pouvez signaler que pour votre pôle.' });
  }

  const r = db.prepare(`
    INSERT INTO signalements (cible_type, cible_id, pole_id, formation_id, objet, message, signale_par)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(cible_type, cible_id, cible.pole_id || null, cible.formation_id || null, objet, message, req.user.id);

  // Notifier les Responsables pédagogiques du pôle (in-app + email)
  const rps = db.prepare(`
    SELECT * FROM users WHERE role = 'RESPONSABLE_PEDAGOGIQUE' AND actif = 1 AND (pole_id = ? OR ? IS NULL)
  `).all(cible.pole_id, cible.pole_id);
  const ins = db.prepare('INSERT INTO notifications (user_id, titre, message, type, lien) VALUES (?, ?, ?, ?, ?)');
  const lien = cible_type === 'TUTORAT' ? '/tutorat' : '/evaluations';
  rps.forEach(rp => {
    ins.run(rp.id, '⚠️ Signalement à traiter', `${req.user.prenom} ${req.user.nom} : « ${objet} » (${cible.formation_nom || cible.pole_code || ''})`, 'SIGNALEMENT', lien);
    sendEmail({
      to: rp.email,
      subject: `[Portail DFIP] Signalement à traiter : ${objet}`,
      html: emailWrapper(rp, 'Signalement de non-conformité', `
        <p><strong>${req.user.prenom} ${req.user.nom}</strong> (Responsable de formation) signale :</p>
        <div style="background:#fff7ed;border:1px solid #fed7aa;padding:14px;border-radius:8px;margin:12px 0">
          <p style="margin:0 0 6px"><strong>${objet}</strong>${cible.formation_nom ? ` — ${cible.formation_nom}` : ''}</p>
          <p style="margin:0;color:#374151">${message}</p>
        </div>
        <p>Merci de traiter ce point depuis le module ${cible_type === 'TUTORAT' ? 'Tutorat' : 'Évaluations'}.</p>`),
    });
  });

  db.prepare('INSERT INTO audit_logs (user_id, action, module, detail) VALUES (?, ?, ?, ?)')
    .run(req.user.id, 'CREATE_SIGNALEMENT', cible_type, objet);

  res.status(201).json(db.prepare('SELECT * FROM signalements WHERE id = ?').get(r.lastInsertRowid));
});

// GET /api/signalements?cible_type=&statut= — RP/direction : tout (RP filtré pôle) ; RF : les siens
router.get('/', auth, (req, res) => {
  const db = getDb();
  const { cible_type, statut } = req.query;
  let sql = `
    SELECT s.*, u.nom as signale_par_nom, u.prenom as signale_par_prenom,
      tp.nom as traite_par_nom, tp.prenom as traite_par_prenom,
      f.nom as formation_nom, p.code as pole_code
    FROM signalements s
    JOIN users u ON u.id = s.signale_par
    LEFT JOIN users tp ON tp.id = s.traite_par
    LEFT JOIN formations f ON f.id = s.formation_id
    LEFT JOIN poles p ON p.id = s.pole_id
    WHERE 1=1`;
  const params = [];
  if (cible_type) { sql += ' AND s.cible_type = ?'; params.push(cible_type); }
  if (statut) { sql += ' AND s.statut = ?'; params.push(statut); }

  if (req.user.role === 'RESPONSABLE_FORMATION') {
    sql += ' AND s.signale_par = ?'; params.push(req.user.id);
  } else if (req.user.role === 'RESPONSABLE_PEDAGOGIQUE' && req.user.pole_id) {
    sql += ' AND s.pole_id = ?'; params.push(req.user.pole_id);
  } else if (!['DIRECTEUR', 'ADMIN_PORTAIL', 'CHEF_SERVICE', 'CHEF_DIV_TECHNOPEDAGOGIE', 'CHEF_DIV_EVALUATION', 'RESPONSABLE_POLE'].includes(req.user.role)) {
    return res.json([]);
  }
  sql += " ORDER BY CASE s.statut WHEN 'OUVERT' THEN 0 ELSE 1 END, s.created_at DESC";
  res.json(db.prepare(sql).all(...params));
});

// POST /api/signalements/:id/traiter — Responsable pédagogique du pôle (+ Direction)
router.post('/:id/traiter', auth, requireRole('RESPONSABLE_PEDAGOGIQUE', 'DIRECTEUR', 'ADMIN_PORTAIL'), (req, res) => {
  const { reponse } = req.body;
  if (!reponse?.trim()) return res.status(400).json({ error: 'La réponse de traitement est requise' });

  const db = getDb();
  const s = db.prepare('SELECT * FROM signalements WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Signalement introuvable' });
  if (s.statut === 'TRAITE') return res.status(409).json({ error: 'Déjà traité' });
  if (req.user.role === 'RESPONSABLE_PEDAGOGIQUE' && s.pole_id && req.user.pole_id !== s.pole_id) {
    return res.status(403).json({ error: 'Vous ne traitez que les signalements de votre pôle.' });
  }

  db.prepare("UPDATE signalements SET statut = 'TRAITE', reponse = ?, traite_par = ?, traite_at = datetime('now') WHERE id = ?")
    .run(reponse.trim(), req.user.id, req.params.id);

  // Notifier le responsable de formation à l'origine du signalement
  const rf = db.prepare('SELECT * FROM users WHERE id = ?').get(s.signale_par);
  if (rf) {
    db.prepare('INSERT INTO notifications (user_id, titre, message, type, lien) VALUES (?, ?, ?, ?, ?)')
      .run(rf.id, '✅ Signalement traité', `« ${s.objet} » — réponse : ${reponse.trim().slice(0, 120)}`, 'SIGNALEMENT',
        s.cible_type === 'TUTORAT' ? '/tutorat' : '/evaluations');
    sendEmail({
      to: rf.email,
      subject: `[Portail DFIP] Votre signalement a été traité : ${s.objet}`,
      html: emailWrapper(rf, 'Signalement traité', `
        <p>Votre signalement <strong>« ${s.objet} »</strong> a été traité par ${req.user.prenom} ${req.user.nom} :</p>
        <div style="background:#ecfdf5;border:1px solid #a7f3d0;padding:14px;border-radius:8px;margin:12px 0">
          <p style="margin:0;color:#065f46">${reponse.trim()}</p>
        </div>`),
    });
  }

  db.prepare('INSERT INTO audit_logs (user_id, action, module, detail) VALUES (?, ?, ?, ?)')
    .run(req.user.id, 'TRAITER_SIGNALEMENT', s.cible_type, s.objet);

  res.json(db.prepare('SELECT * FROM signalements WHERE id = ?').get(req.params.id));
});

module.exports = router;
