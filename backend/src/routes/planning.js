const express = require('express');
const { getDb } = require('../db/connection');
const { auth, requireRole } = require('../middleware/auth');
const { sendEmail } = require('../services/email');
const { emailWrapper } = require('../services/notify');

const router = express.Router();

// Notifie tous les Directeurs (in-app + email)
function notifierDirecteurs(db, titre, message) {
  const dirs = db.prepare("SELECT * FROM users WHERE role = 'DIRECTEUR' AND actif = 1").all();
  const ins = db.prepare('INSERT INTO notifications (user_id, titre, message, type, lien) VALUES (?, ?, ?, ?, ?)');
  dirs.forEach(d => {
    ins.run(d.id, titre, message, 'PLANNING', '/planning');
    sendEmail({ to: d.email, subject: `[Portail DFIP] ${titre}`, html: emailWrapper(d, titre, `<p>${message}</p>`) });
  });
}

function notifierUser(db, userId, titre, message) {
  const u = db.prepare('SELECT * FROM users WHERE id = ? AND actif = 1').get(userId);
  if (!u) return;
  db.prepare('INSERT INTO notifications (user_id, titre, message, type, lien) VALUES (?, ?, ?, ?, ?)')
    .run(u.id, titre, message, 'PLANNING', '/planning');
  sendEmail({ to: u.email, subject: `[Portail DFIP] ${titre}`, html: emailWrapper(u, titre, `<p>${message}</p>`) });
}

const SEGMENTS = ['RECTORAT', 'DFIP_DES', 'PSEJA', 'PSTN', 'PLSHE'];
// Correspondance segment ↔ code pôle
const SEGMENT_POLE = { PSEJA: 'SEJA', PSTN: 'STN', PLSHE: 'LSHE' };
const POLE_SEGMENT = { SEJA: 'PSEJA', STN: 'PSTN', LSHE: 'PLSHE' };
// Rôles dont la VUE est limitée à leur pôle
const { ROLES_RESTREINTS } = require('../config');

function codePoleUser(user, db) {
  if (!user.pole_id) return null;
  return db.prepare('SELECT code FROM poles WHERE id = ?').get(user.pole_id)?.code || null;
}

/* Périmètre de CRÉATION/MODIFICATION par profil :
   - RESPONSABLE_POLE → le segment de son pôle uniquement
   - VICE_RECTEUR → RECTORAT
   - DIRECTEUR (DFIP) et DIRECTEUR_DES → DFIP & DES
   - ADMIN_PORTAIL → tous (administration technique)                     */
function segmentsAutorises(user, db) {
  switch (user.role) {
    case 'ADMIN_PORTAIL': return SEGMENTS;
    case 'VICE_RECTEUR': return ['RECTORAT'];
    case 'DIRECTEUR':
    case 'DIRECTEUR_DES': return ['DFIP_DES'];
    case 'RESPONSABLE_POLE': {
      const code = codePoleUser(user, db);
      return code && POLE_SEGMENT[code] ? [POLE_SEGMENT[code]] : [];
    }
    default: return [];
  }
}

/* Périmètre de VISIBILITÉ : les profils rattachés à un pôle ne voient que leur segment */
function segmentsVisibles(user, db) {
  if (ROLES_RESTREINTS.includes(user.role)) {
    const code = codePoleUser(user, db);
    return code && POLE_SEGMENT[code] ? [POLE_SEGMENT[code]] : [];
  }
  return SEGMENTS;
}

function peutEcrire(user, segment, db) {
  // Le Directeur DFIP garde la main partout : c'est lui qui valide toute modification
  if (user.role === 'DIRECTEUR') return true;
  return segmentsAutorises(user, db).includes(segment);
}

// GET /api/planning?annee_id= — filtré selon le périmètre de visibilité du profil
router.get('/', auth, (req, res) => {
  const db = getDb();
  const annee_id = req.query.annee_id
    || db.prepare('SELECT id FROM annees_academiques WHERE active = 1 LIMIT 1').get()?.id;
  if (!annee_id) return res.json([]);
  const visibles = segmentsVisibles(req.user, db);
  if (visibles.length === 0) return res.json([]);
  res.json(db.prepare(`
    SELECT pa.*, u.nom as created_by_nom, u.prenom as created_by_prenom
    FROM planning_activites pa
    LEFT JOIN users u ON u.id = pa.created_by
    WHERE pa.annee_id = ? AND pa.segment IN (${visibles.map(() => '?').join(',')})
    ORDER BY pa.segment, pa.ligne, pa.date_debut
  `).all(annee_id, ...visibles));
});

// GET /api/planning/perimetre — segments visibles + segments où l'utilisateur peut créer
router.get('/perimetre', auth, (req, res) => {
  const db = getDb();
  res.json({
    visibles: segmentsVisibles(req.user, db),
    creation: segmentsAutorises(req.user, db),
  });
});

// POST /api/planning
router.post('/', auth, (req, res) => {
  const { annee_id, segment, ligne, libelle, date_debut, date_fin, couleur } = req.body;
  if (!annee_id || !segment || !ligne || !libelle || !date_debut || !date_fin) {
    return res.status(400).json({ error: 'Année, segment, ligne, libellé et dates requis' });
  }
  if (!SEGMENTS.includes(segment)) return res.status(400).json({ error: 'Segment invalide' });
  if (date_fin < date_debut) return res.status(400).json({ error: 'La date de fin doit suivre la date de début' });

  const db = getDb();
  // Création strictement limitée au périmètre du profil (y compris pour le Directeur DFIP)
  if (!segmentsAutorises(req.user, db).includes(segment)) {
    return res.status(403).json({ error: 'Vous ne pouvez créer des activités que dans votre périmètre (segment de votre entité).' });
  }

  const r = db.prepare(`
    INSERT INTO planning_activites (annee_id, segment, ligne, libelle, date_debut, date_fin, couleur, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(annee_id, segment, ligne, libelle, date_debut, date_fin, couleur || null, req.user.id);

  db.prepare('INSERT INTO audit_logs (user_id, action, module, detail) VALUES (?, ?, ?, ?)')
    .run(req.user.id, 'CREATE_PLANNING', 'CALENDRIER', `${segment}/${ligne}: ${libelle}`);

  res.status(201).json(db.prepare('SELECT * FROM planning_activites WHERE id = ?').get(r.lastInsertRowid));
});

function appliquerModification(db, activiteId, payload) {
  const prev = db.prepare('SELECT * FROM planning_activites WHERE id = ?').get(activiteId);
  if (!prev) return false;
  db.prepare(`
    UPDATE planning_activites SET ligne=?, libelle=?, date_debut=?, date_fin=?, couleur=? WHERE id=?
  `).run(payload.ligne ?? prev.ligne, payload.libelle ?? prev.libelle,
    payload.date_debut ?? prev.date_debut, payload.date_fin ?? prev.date_fin,
    payload.couleur !== undefined ? payload.couleur : prev.couleur, activiteId);
  return true;
}

function descriptionActivite(a) {
  return `« ${a.libelle} » (${a.segment} / ${a.ligne}, ${a.date_debut} → ${a.date_fin})`;
}

// PUT /api/planning/:id — modification : appliquée si Directeur, sinon demande à valider
router.put('/:id', auth, (req, res) => {
  const db = getDb();
  const prev = db.prepare('SELECT * FROM planning_activites WHERE id = ?').get(req.params.id);
  if (!prev) return res.status(404).json({ error: 'Activité introuvable' });
  if (!peutEcrire(req.user, prev.segment, db)) return res.status(403).json({ error: 'Accès refusé' });

  const { ligne, libelle, date_debut, date_fin, couleur } = req.body;
  const payload = { ligne, libelle, date_debut, date_fin, couleur };

  // Le Directeur DFIP applique directement (c'est lui le validateur)
  if (req.user.role === 'DIRECTEUR') {
    appliquerModification(db, req.params.id, payload);
    db.prepare('INSERT INTO audit_logs (user_id, action, module, detail) VALUES (?, ?, ?, ?)')
      .run(req.user.id, 'UPDATE_PLANNING', 'CALENDRIER', descriptionActivite(prev));
    return res.json(db.prepare('SELECT * FROM planning_activites WHERE id = ?').get(req.params.id));
  }

  // Toute autre modification est soumise à la validation du Directeur
  const r = db.prepare(`
    INSERT INTO planning_demandes (activite_id, type_demande, payload, demande_par)
    VALUES (?, 'MODIFICATION', ?, ?)
  `).run(req.params.id, JSON.stringify(payload), req.user.id);
  notifierDirecteurs(db, '✋ Demande de modification du planning',
    `${req.user.prenom} ${req.user.nom} demande la modification de ${descriptionActivite(prev)}.`);
  db.prepare('INSERT INTO audit_logs (user_id, action, module, detail) VALUES (?, ?, ?, ?)')
    .run(req.user.id, 'DEMANDE_MODIF_PLANNING', 'CALENDRIER', descriptionActivite(prev));
  res.status(202).json({
    demande_id: r.lastInsertRowid,
    message: 'Modification soumise à la validation du Directeur DFIP.',
  });
});

// DELETE /api/planning/:id — suppression : appliquée si Directeur, sinon demande à valider
router.delete('/:id', auth, (req, res) => {
  const db = getDb();
  const prev = db.prepare('SELECT * FROM planning_activites WHERE id = ?').get(req.params.id);
  if (!prev) return res.status(404).json({ error: 'Activité introuvable' });
  if (!peutEcrire(req.user, prev.segment, db)) return res.status(403).json({ error: 'Accès refusé' });

  if (req.user.role === 'DIRECTEUR') {
    db.prepare('DELETE FROM planning_activites WHERE id = ?').run(req.params.id);
    db.prepare('INSERT INTO audit_logs (user_id, action, module, detail) VALUES (?, ?, ?, ?)')
      .run(req.user.id, 'DELETE_PLANNING', 'CALENDRIER', descriptionActivite(prev));
    return res.json({ message: 'Activité supprimée' });
  }

  const r = db.prepare(`
    INSERT INTO planning_demandes (activite_id, type_demande, demande_par)
    VALUES (?, 'SUPPRESSION', ?)
  `).run(req.params.id, req.user.id);
  notifierDirecteurs(db, '✋ Demande de suppression du planning',
    `${req.user.prenom} ${req.user.nom} demande la suppression de ${descriptionActivite(prev)}.`);
  db.prepare('INSERT INTO audit_logs (user_id, action, module, detail) VALUES (?, ?, ?, ?)')
    .run(req.user.id, 'DEMANDE_SUPPR_PLANNING', 'CALENDRIER', descriptionActivite(prev));
  res.status(202).json({
    demande_id: r.lastInsertRowid,
    message: 'Suppression soumise à la validation du Directeur DFIP.',
  });
});

// GET /api/planning/demandes/liste — Directeur/Admin : toutes ; autres : les leurs
router.get('/demandes/liste', auth, (req, res) => {
  const db = getDb();
  const voitTout = ['DIRECTEUR', 'ADMIN_PORTAIL'].includes(req.user.role);
  const sql = `
    SELECT pd.*, pa.segment, pa.ligne, pa.libelle as activite_libelle,
      pa.date_debut as activite_debut, pa.date_fin as activite_fin,
      u.nom as demandeur_nom, u.prenom as demandeur_prenom, u.role as demandeur_role
    FROM planning_demandes pd
    JOIN planning_activites pa ON pa.id = pd.activite_id
    JOIN users u ON u.id = pd.demande_par
    ${voitTout ? '' : 'WHERE pd.demande_par = ?'}
    ORDER BY CASE pd.statut WHEN 'EN_ATTENTE' THEN 0 ELSE 1 END, pd.created_at DESC
    LIMIT 100
  `;
  res.json(voitTout ? db.prepare(sql).all() : db.prepare(sql).all(req.user.id));
});

// POST /api/planning/demandes/:id/traiter — Directeur DFIP uniquement
router.post('/demandes/:id/traiter', auth, requireRole('DIRECTEUR'), (req, res) => {
  const { decision } = req.body; // VALIDEE | REJETEE
  if (!['VALIDEE', 'REJETEE'].includes(decision)) return res.status(400).json({ error: 'Décision invalide' });

  const db = getDb();
  const dem = db.prepare('SELECT * FROM planning_demandes WHERE id = ?').get(req.params.id);
  if (!dem) return res.status(404).json({ error: 'Demande introuvable' });
  if (dem.statut !== 'EN_ATTENTE') return res.status(409).json({ error: 'Demande déjà traitée' });

  const act = db.prepare('SELECT * FROM planning_activites WHERE id = ?').get(dem.activite_id);

  if (decision === 'VALIDEE') {
    if (dem.type_demande === 'SUPPRESSION') {
      // La suppression en cascade retire aussi la demande ; l'audit log conserve la trace
      db.prepare('DELETE FROM planning_activites WHERE id = ?').run(dem.activite_id);
    } else {
      appliquerModification(db, dem.activite_id, JSON.parse(dem.payload || '{}'));
      db.prepare("UPDATE planning_demandes SET statut='VALIDEE', valide_par=?, traite_at=datetime('now') WHERE id=?")
        .run(req.user.id, dem.id);
    }
  } else {
    db.prepare("UPDATE planning_demandes SET statut='REJETEE', valide_par=?, traite_at=datetime('now') WHERE id=?")
      .run(req.user.id, dem.id);
  }

  const label = dem.type_demande === 'SUPPRESSION' ? 'suppression' : 'modification';
  notifierUser(db, dem.demande_par,
    decision === 'VALIDEE' ? `✅ Demande de ${label} validée` : `❌ Demande de ${label} rejetée`,
    `Votre demande de ${label} de « ${act?.libelle || ''} » (${act?.ligne || ''}) a été ${decision === 'VALIDEE' ? 'validée et appliquée' : 'rejetée'} par le Directeur.`);

  db.prepare('INSERT INTO audit_logs (user_id, action, module, detail) VALUES (?, ?, ?, ?)')
    .run(req.user.id, decision === 'VALIDEE' ? 'VALIDE_DEMANDE_PLANNING' : 'REJETE_DEMANDE_PLANNING', 'CALENDRIER', `demande #${dem.id}`);

  res.json({ message: decision === 'VALIDEE' ? 'Demande validée et appliquée' : 'Demande rejetée' });
});

module.exports = router;
