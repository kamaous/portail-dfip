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
          conseq_eval, conseq_tutorat, promotion_id, formation_id, niveau, semestre_code, session_num } = req.body;
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

  const result = db.prepare(`
    INSERT INTO incidents (titre, description, type_incident, gravite, signale_par, assigne_a,
      pole_id, promo_filiere_id, module, date_incident, date_debut, date_fin,
      consequence_examens, consequence_tutorat, consequence_calendrier,
      conseq_eval, conseq_tutorat, promotion_id, formation_id, niveau, semestre_code, session_num)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(titre, description, type_incident || 'AUTRE', gravite || 'FAIBLE', req.user.id, assigneId,
    pole_id || null, promo_filiere_id || null, module || null,
    date_incident || date_debut || null, date_debut || null, date_fin || null,
    consequence_examens || null, consequence_tutorat || null, consequence_calendrier || null,
    conseq_eval || null, conseq_tutorat || null,
    promotion_id || null, formation_id || null, niveau || null, semestre_code || null, session_num || null);

  const incident = db.prepare('SELECT * FROM incidents WHERE id = ?').get(result.lastInsertRowid);

  // Notifier l'assigné
  if (assigneId) {
    const assigne = db.prepare('SELECT * FROM users WHERE id = ?').get(assigneId);
    if (assigne) {
      db.prepare(`INSERT INTO notifications (user_id, titre, message, type, lien) VALUES (?, ?, ?, ?, ?)`)
        .run(assigne.id, '🚨 Incident signalé', `${req.user.prenom} ${req.user.nom} : "${titre}"`, 'INCIDENT', `/incidents/${incident.id}`);
      const tpl = templates.nouvelIncident(assigne, req.user, incident);
      sendEmail({ to: assigne.email, ...tpl });
    }
  }

  // Notifier le Directeur pour tout incident grave
  if (['CRITIQUE', 'HAUTE'].includes(gravite || 'FAIBLE')) {
    const directeurs = db.prepare("SELECT * FROM users WHERE role IN ('DIRECTEUR', 'CHEF_SERVICE') AND actif = 1").all();
    directeurs.forEach(d => {
      if (d.id !== assigneId) {
        db.prepare(`INSERT INTO notifications (user_id, titre, message, type, lien) VALUES (?, ?, ?, ?, ?)`)
          .run(d.id, '⚠️ Incident grave signalé', `Gravité ${gravite} : "${titre}"`, 'ALERTE', `/incidents/${incident.id}`);
      }
    });
  }

  db.prepare(`INSERT INTO audit_logs (user_id, action, module, detail) VALUES (?, ?, ?, ?)`)
    .run(req.user.id, 'CREATE_INCIDENT', 'INCIDENTS', titre);

  res.status(201).json(incident);
});

// PUT /api/incidents/:id/statut
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
