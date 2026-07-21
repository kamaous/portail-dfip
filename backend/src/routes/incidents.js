const express = require('express');
const { getDb } = require('../db/connection');
const { auth, requireRole } = require('../middleware/auth');
const { sendEmail, templates } = require('../services/email');

const router = express.Router();

// GET /api/incidents
router.get('/', auth, (req, res) => {
  const db = getDb();
  const { statut, gravite, pole_id } = req.query;

  let query = `
    SELECT i.*,
      sp.nom as signale_par_nom, sp.prenom as signale_par_prenom,
      aa.nom as assigne_a_nom, aa.prenom as assigne_a_prenom,
      p.nom as pole_nom, pf.nom as filiere_nom
    FROM incidents i
    JOIN users sp ON sp.id = i.signale_par
    LEFT JOIN users aa ON aa.id = i.assigne_a
    LEFT JOIN poles p ON p.id = i.pole_id
    LEFT JOIN promo_filieres pf ON pf.id = i.promo_filiere_id
    WHERE 1=1
  `;
  const params = [];

  if (statut) { query += ' AND i.statut = ?'; params.push(statut); }
  if (gravite) { query += ' AND i.gravite = ?'; params.push(gravite); }
  if (pole_id) { query += ' AND i.pole_id = ?'; params.push(pole_id); }

  // Membres de pôle voient leurs incidents + ceux de leur pôle
  if (req.user.role === 'MEMBRE_POLE') {
    query += ' AND (i.signale_par = ? OR i.assigne_a = ? OR i.pole_id = ?)';
    params.push(req.user.id, req.user.id, req.user.pole_id || -1);
  }

  query += " ORDER BY CASE i.gravite WHEN 'CRITIQUE' THEN 1 WHEN 'HAUTE' THEN 2 WHEN 'MOYENNE' THEN 3 ELSE 4 END, i.created_at DESC";
  res.json(db.prepare(query).all(...params));
});

// GET /api/incidents/stats
router.get('/stats', auth, (req, res) => {
  const db = getDb();
  const total = db.prepare('SELECT COUNT(*) as cnt FROM incidents').get();
  const ouverts = db.prepare("SELECT COUNT(*) as cnt FROM incidents WHERE statut = 'OUVERT'").get();
  const byGravite = db.prepare('SELECT gravite, COUNT(*) as cnt FROM incidents GROUP BY gravite').all();
  const byStatut = db.prepare('SELECT statut, COUNT(*) as cnt FROM incidents GROUP BY statut').all();
  res.json({ total: total.cnt, ouverts: ouverts.cnt, by_gravite: byGravite, by_statut: byStatut });
});

// GET /api/incidents/:id
router.get('/:id', auth, (req, res) => {
  const db = getDb();
  const incident = db.prepare(`
    SELECT i.*,
      sp.nom as signale_par_nom, sp.prenom as signale_par_prenom,
      aa.nom as assigne_a_nom, aa.prenom as assigne_a_prenom,
      p.nom as pole_nom
    FROM incidents i
    JOIN users sp ON sp.id = i.signale_par
    LEFT JOIN users aa ON aa.id = i.assigne_a
    LEFT JOIN poles p ON p.id = i.pole_id
    WHERE i.id = ?
  `).get(req.params.id);

  if (!incident) return res.status(404).json({ error: 'Incident non trouvé' });

  const commentaires = db.prepare(`
    SELECT ic.*, u.nom, u.prenom, u.role
    FROM incident_commentaires ic
    JOIN users u ON u.id = ic.user_id
    WHERE ic.incident_id = ?
    ORDER BY ic.created_at ASC
  `).all(req.params.id);

  res.json({ ...incident, commentaires });
});

// Types officiels d'incidents et de conséquences
const TYPES_INCIDENT = ['GREVE', 'FETE', 'FERIE', 'EVENEMENT', 'INCIDENT_TECHNIQUE', 'AUTRE'];
const CONSEQ_EVAL = ['REPORT', 'ANNULATION', 'RALLONGE', 'ARRET', 'AUTRE'];

// POST /api/incidents
// Remontée d'incidents réservée aux : Responsables pédagogiques des pôles,
// Chef division DFE (formations & évaluations), Chef division Technopédagogie (+ direction/admin)
router.post('/', auth, requireRole('RESPONSABLE_PEDAGOGIQUE', 'CHEF_DIV_EVALUATION', 'CHEF_DIV_TECHNOPEDAGOGIE', 'DIRECTEUR', 'ADMIN_PORTAIL'), (req, res) => {
  const { titre, description, type_incident, gravite, pole_id, promo_filiere_id, module,
          date_incident, date_debut, date_fin, assigne_a,
          consequence_examens, consequence_tutorat, consequence_calendrier,
          conseq_eval, conseq_tutorat, promotion_id, formation_id, niveau, semestre_code, session_num,
          ref_type, ref_id } = req.body;
  if (!titre || !description) return res.status(400).json({ error: 'Nom et description détaillée requis' });
  if (type_incident && !TYPES_INCIDENT.includes(type_incident) && !['ACADEMIQUE', 'ADMINISTRATIF', 'TECHNIQUE', 'COMPORTEMENT', 'RETARD', 'REPORT_EXAMEN', 'ANNULATION_EXAMEN'].includes(type_incident)) {
    return res.status(400).json({ error: 'Type d\'incident invalide' });
  }
  if (conseq_eval && !CONSEQ_EVAL.includes(conseq_eval)) {
    return res.status(400).json({ error: 'Conséquence évaluations invalide' });
  }

  const db = getDb();

  // Auto-assigner au Directeur si gravité critique et pas d'assignation
  let assigneId = assigne_a || null;
  if (!assigneId && gravite === 'CRITIQUE') {
    const directeur = db.prepare("SELECT id FROM users WHERE role = 'DIRECTEUR' AND actif = 1 LIMIT 1").get();
    assigneId = directeur?.id || null;
  }

  // Pôle(s) concerné(s) : un id, une LISTE d'ids (un incident créé par pôle),
  // ou rien = « Tous les pôles » (incident général, visible partout)
  const polesCibles = (Array.isArray(pole_id) ? pole_id : [pole_id]).filter(Boolean);
  const cibles = polesCibles.length ? polesCibles : [null];

  const insert = db.prepare(`
    INSERT INTO incidents (titre, description, type_incident, gravite, signale_par, assigne_a,
      pole_id, promo_filiere_id, module, date_incident, date_debut, date_fin,
      consequence_examens, consequence_tutorat, consequence_calendrier,
      conseq_eval, conseq_tutorat, promotion_id, formation_id, niveau, semestre_code, session_num,
      ref_type, ref_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const crees = [];
  for (const cible of cibles) {
    const result = insert.run(titre, description, type_incident || 'AUTRE', gravite || 'FAIBLE', req.user.id, assigneId,
      cible || null, promo_filiere_id || null, module || null,
      date_incident || date_debut || null, date_debut || null, date_fin || null,
      consequence_examens || null, consequence_tutorat || null, consequence_calendrier || null,
      conseq_eval || null, conseq_tutorat || null,
      promotion_id || null, formation_id || null, niveau || null, semestre_code || null, session_num || null,
      ['TUTORAT', 'SESSION_EXAMEN'].includes(ref_type) ? ref_type : null, ref_id || null);
    crees.push(db.prepare('SELECT * FROM incidents WHERE id = ?').get(result.lastInsertRowid));
  }
  const incident = crees[0];
  const suffixePoles = cibles.length > 1 ? ` (${cibles.length} pôles)` : '';

  // Notifier l'assigné (une seule fois, même pour plusieurs pôles)
  if (assigneId) {
    const assigne = db.prepare('SELECT * FROM users WHERE id = ?').get(assigneId);
    if (assigne) {
      db.prepare(`INSERT INTO notifications (user_id, titre, message, type, lien) VALUES (?, ?, ?, ?, ?)`)
        .run(assigne.id, '🚨 Incident signalé', `${req.user.prenom} ${req.user.nom} : "${titre}"${suffixePoles}`, 'INCIDENT', `/incidents/${incident.id}`);
      const tpl = templates.nouvelIncident(assigne, req.user, incident);
      sendEmail({ to: assigne.email, ...tpl });
    }
  }

  // Notifier le Directeur pour tout incident grave (une seule fois)
  if (['CRITIQUE', 'HAUTE'].includes(gravite || 'FAIBLE')) {
    const directeurs = db.prepare("SELECT * FROM users WHERE role IN ('DIRECTEUR', 'CHEF_SERVICE') AND actif = 1").all();
    directeurs.forEach(d => {
      if (d.id !== assigneId) {
        db.prepare(`INSERT INTO notifications (user_id, titre, message, type, lien) VALUES (?, ?, ?, ?, ?)`)
          .run(d.id, '⚠️ Incident grave signalé', `Gravité ${gravite} : "${titre}"${suffixePoles}`, 'ALERTE', `/incidents/${incident.id}`);
      }
    });
  }

  db.prepare(`INSERT INTO audit_logs (user_id, action, module, detail) VALUES (?, ?, ?, ?)`)
    .run(req.user.id, 'CREATE_INCIDENT', 'INCIDENTS', `${titre}${suffixePoles}`);

  res.status(201).json(crees.length === 1 ? incident : crees);
});

// PUT /api/incidents/:id/statut
/* POST /api/incidents/:id/resoudre — RÉSOLUTION DÉCISIONNELLE du Directeur DFIP.
   Décisions possibles, appliquées à l'élément lié (fiche tutorat / évaluation) :
   - PROLONGER : étend la date de fin de N jours (ex. +5 j si l'incident a duré 5 j)
   - REPORTER  : décale la période à partir d'une nouvelle date de début
   - ANNULER   : annule l'évaluation liée (ou documente l'arrêt du tutorat)
   - INTACT    : les dates sont conservées, la décision est documentée */
router.post('/:id/resoudre', auth, requireRole('DIRECTEUR', 'ADMIN_PORTAIL'), (req, res) => {
  const { decision, jours, nouvelle_date, resolution } = req.body;
  if (!['PROLONGER', 'REPORTER', 'ANNULER', 'INTACT'].includes(decision)) {
    return res.status(400).json({ error: 'Décision invalide' });
  }
  if (!resolution?.trim()) {
    return res.status(400).json({ error: 'La description documentée de la résolution est obligatoire.' });
  }
  const db = getDb();
  const inc = db.prepare('SELECT * FROM incidents WHERE id = ?').get(req.params.id);
  if (!inc) return res.status(404).json({ error: 'Incident non trouvé' });

  const addJours = (dateStr, n) => {
    const d = new Date(`${dateStr}T00:00:00`); d.setDate(d.getDate() + n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const actions = [];

  if (inc.ref_type && inc.ref_id) {
    if (decision === 'PROLONGER' && Number(jours) > 0) {
      const n = Number(jours);
      if (inc.ref_type === 'TUTORAT') {
        const t = db.prepare('SELECT * FROM tutorat WHERE id = ?').get(inc.ref_id);
        if (t?.date_fin) {
          const nf = addJours(t.date_fin, n);
          db.prepare("UPDATE tutorat SET date_fin = ?, updated_at = datetime('now') WHERE id = ?").run(nf, t.id);
          actions.push(`fin du tutorat prolongée de ${n} j (${t.date_fin} → ${nf})`);
        }
      } else if (inc.ref_type === 'SESSION_EXAMEN') {
        const s = db.prepare('SELECT * FROM sessions_examen WHERE id = ?').get(inc.ref_id);
        if (s?.date_fin_prevue) {
          const nf = addJours(s.date_fin_prevue, n);
          db.prepare("UPDATE sessions_examen SET date_fin_prevue = ?, updated_at = datetime('now') WHERE id = ?").run(nf, s.id);
          actions.push(`fin de l'évaluation prolongée de ${n} j (${s.date_fin_prevue} → ${nf})`);
        }
      }
    } else if (decision === 'REPORTER' && nouvelle_date) {
      if (inc.ref_type === 'TUTORAT') {
        const t = db.prepare('SELECT * FROM tutorat WHERE id = ?').get(inc.ref_id);
        if (t?.date_debut) {
          const delta = Math.round((Date.parse(nouvelle_date) - Date.parse(t.date_debut)) / 86400000);
          const nf = t.date_fin ? addJours(t.date_fin, delta) : null;
          db.prepare("UPDATE tutorat SET date_debut = ?, date_fin = COALESCE(?, date_fin), updated_at = datetime('now') WHERE id = ?")
            .run(nouvelle_date, nf, t.id);
          actions.push(`tutorat reporté au ${nouvelle_date} (décalage ${delta} j)`);
        }
      } else if (inc.ref_type === 'SESSION_EXAMEN') {
        const s = db.prepare('SELECT * FROM sessions_examen WHERE id = ?').get(inc.ref_id);
        if (s?.date_demarrage) {
          const delta = Math.round((Date.parse(nouvelle_date) - Date.parse(s.date_demarrage)) / 86400000);
          const nf = s.date_fin_prevue ? addJours(s.date_fin_prevue, delta) : null;
          db.prepare("UPDATE sessions_examen SET date_demarrage = ?, date_fin_prevue = COALESCE(?, date_fin_prevue), updated_at = datetime('now') WHERE id = ?")
            .run(nouvelle_date, nf, s.id);
          actions.push(`évaluation reportée au ${nouvelle_date} (décalage ${delta} j)`);
        }
      }
    } else if (decision === 'ANNULER') {
      if (inc.ref_type === 'SESSION_EXAMEN') {
        db.prepare("UPDATE sessions_examen SET etat = 'ANNULE', updated_at = datetime('now') WHERE id = ?").run(inc.ref_id);
        actions.push('évaluation liée ANNULÉE');
      } else if (inc.ref_type === 'TUTORAT') {
        db.prepare("UPDATE tutorat SET observations = COALESCE(observations, '') || ' [ARRÊTÉ suite à incident #' || ? || ']', updated_at = datetime('now') WHERE id = ?")
          .run(inc.id, inc.ref_id);
        actions.push('arrêt du tutorat documenté dans la fiche');
      }
    }
  }

  const LBL = { PROLONGER: `Prolongation${Number(jours) > 0 ? ` de ${Number(jours)} j` : ''}`, REPORTER: `Report${nouvelle_date ? ` au ${nouvelle_date}` : ''}`, ANNULER: 'Annulation', INTACT: 'Dates conservées' };
  const texte = `[Décision DFIP : ${LBL[decision]}] ${resolution.trim()}${actions.length ? ` · Effets appliqués : ${actions.join(' ; ')}` : ''}`;
  db.prepare("UPDATE incidents SET statut = 'RESOLU', resolution = ?, date_resolution = datetime('now'), updated_at = datetime('now') WHERE id = ?")
    .run(texte, inc.id);

  const signalePar = db.prepare('SELECT * FROM users WHERE id = ?').get(inc.signale_par);
  if (signalePar) {
    db.prepare('INSERT INTO notifications (user_id, titre, message, type, lien) VALUES (?, ?, ?, ?, ?)')
      .run(signalePar.id, '✅ Incident résolu — décision du DFIP', `"${inc.titre}" : ${LBL[decision]}. ${resolution.trim()}`, 'SUCCES', '/incidents');
    sendEmail({
      to: signalePar.email,
      subject: '[Portail DFIP] Incident résolu — décision du Directeur',
      html: `<p>L'incident "<strong>${inc.titre}</strong>" a été résolu.</p><p><strong>Décision : ${LBL[decision]}</strong></p><p>${resolution.trim()}</p>${actions.length ? `<p>Effets appliqués : ${actions.join(' ; ')}</p>` : ''}`,
    });
  }
  db.prepare('INSERT INTO audit_logs (user_id, action, module, detail) VALUES (?, ?, ?, ?)')
    .run(req.user.id, 'RESOUDRE_INCIDENT', 'INCIDENTS', `#${inc.id} ${LBL[decision]}`);

  res.json({ message: `Incident résolu — ${LBL[decision]}`, actions });
});

router.put('/:id/statut', auth, (req, res) => {
  const { statut, resolution } = req.body;
  const db = getDb();
  const incident = db.prepare('SELECT * FROM incidents WHERE id = ?').get(req.params.id);
  if (!incident) return res.status(404).json({ error: 'Incident non trouvé' });

  const date_resolution = statut === 'RESOLU' ? "datetime('now')" : 'NULL';
  db.prepare(`
    UPDATE incidents SET statut = ?, resolution = ?,
      date_resolution = ${statut === 'RESOLU' ? date_resolution : 'NULL'},
      updated_at = datetime('now')
    WHERE id = ?
  `).run(statut, resolution || null, req.params.id);

  if (statut === 'RESOLU') {
    const signalePar = db.prepare('SELECT * FROM users WHERE id = ?').get(incident.signale_par);
    if (signalePar) {
      db.prepare(`INSERT INTO notifications (user_id, titre, message, type) VALUES (?, ?, ?, ?)`)
        .run(signalePar.id, '✅ Incident résolu', `"${incident.titre}" a été résolu.`, 'SUCCES');
      sendEmail({
        to: signalePar.email,
        subject: '[Portail DFIP] Incident résolu',
        html: `<p>L'incident "<strong>${incident.titre}</strong>" a été résolu.</p>${resolution ? `<p>Résolution : ${resolution}</p>` : ''}`
      });
    }
  }

  res.json({ message: 'Statut mis à jour' });
});

// POST /api/incidents/:id/commentaires
router.post('/:id/commentaires', auth, (req, res) => {
  const { contenu } = req.body;
  if (!contenu) return res.status(400).json({ error: 'Contenu requis' });

  const db = getDb();
  db.prepare('INSERT INTO incident_commentaires (incident_id, user_id, contenu) VALUES (?, ?, ?)').run(req.params.id, req.user.id, contenu);

  const incident = db.prepare('SELECT * FROM incidents WHERE id = ?').get(req.params.id);
  if (incident) {
    const notifId = incident.signale_par === req.user.id ? incident.assigne_a : incident.signale_par;
    if (notifId) {
      db.prepare(`INSERT INTO notifications (user_id, titre, message, type, lien) VALUES (?, ?, ?, ?, ?)`)
        .run(notifId, 'Nouveau commentaire', `Sur l'incident "${incident.titre}"`, 'INCIDENT', `/incidents/${req.params.id}`);
    }
  }

  res.status(201).json({ message: 'Commentaire ajouté' });
});

// DELETE /api/incidents/:id
router.delete('/:id', auth, requireRole('DIRECTEUR', 'ADMIN_PORTAIL'), (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM incidents WHERE id = ?').run(req.params.id);
  res.json({ message: 'Incident supprimé' });
});

module.exports = router;
