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

/* Alimentation du planning annuel (décision 13/07/2026) :
   SEULS les Responsables pédagogiques de pôle créent des activités — chacun pour SON pôle.
   Le DFIP et l'Admin portail gardent l'accès complet (administration). */
function segmentsAutorises(user, db) {
  if (user.role === 'DIRECTEUR' || user.role === 'ADMIN_PORTAIL') return SEGMENTS;
  if (user.role === 'RESPONSABLE_PEDAGOGIQUE') {
    const code = codePoleUser(user, db);
    return code && POLE_SEGMENT[code] ? [POLE_SEGMENT[code]] : [];
  }
  return [];
}

/* Périmètre de VISIBILITÉ : les responsables rattachés à un pôle ne voient que leur segment.
   Les visiteurs (Recteur, étudiants...) consultent TOUT le planning en lecture seule. */
const { ROLES_VISITEURS } = require('../config');
function segmentsVisibles(user, db) {
  if (ROLES_VISITEURS.includes(user.role)) return SEGMENTS;
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

/* ===== Liaison planning → modules =====
   Une activité typée TUTORAT ou EVALUATIONS sur un segment de pôle alimente
   automatiquement le module correspondant (pas de double saisie). */
const NIVEAU_LIGNE = { 'Licence 1': 'L1', 'Licence 2': 'L2', 'Licence 3': 'L3', 'Master 1': 'M1', 'Master 2': 'M2' };

function poleDuSegment(db, segment) {
  const code = SEGMENT_POLE[segment];
  return code ? db.prepare('SELECT id, code, nom FROM poles WHERE code = ?').get(code) : null;
}

// Conflit inter-pôles pour une plage d'ÉVALUATIONS du planning
function conflitEvalPlanning(db, { annee_id, pole_id, date_debut, date_fin, exclure_activite_id }) {
  return db.prepare(`
    SELECT se.date_demarrage, se.date_fin_prevue, p.code as pole_code, p.nom as pole_nom, f.nom as formation_nom
    FROM sessions_examen se
    JOIN poles p ON p.id = se.pole_id
    LEFT JOIN formations f ON f.id = se.formation_id
    WHERE se.annee_id = ? AND se.pole_id != ? AND se.etat != 'ANNULE'
      AND (se.activite_id IS NULL OR se.activite_id != ?)
      AND se.date_demarrage IS NOT NULL
      AND se.date_demarrage <= ? AND COALESCE(se.date_fin_prevue, se.date_demarrage) >= ?
    ORDER BY se.date_demarrage LIMIT 5
  `).all(annee_id, pole_id, exclure_activite_id || 0, date_fin || date_debut, date_debut);
}

// Crée / met à jour / supprime l'entrée de module liée à une activité
function synchroniserModule(db, activiteId, userId) {
  const pa = db.prepare('SELECT * FROM planning_activites WHERE id = ?').get(activiteId);
  if (!pa) return;
  const pole = poleDuSegment(db, pa.segment);
  const ficheT = db.prepare('SELECT id FROM tutorat WHERE activite_id = ?').get(activiteId);
  const ficheE = db.prepare('SELECT id FROM sessions_examen WHERE activite_id = ?').get(activiteId);
  const niveau = NIVEAU_LIGNE[pa.ligne] || null;

  const veutTutorat = pa.type === 'TUTORAT' && pole;
  const veutEval = pa.type === 'EVALUATIONS' && pole;

  // Supprimer les liaisons devenues obsolètes (changement/suppression de type)
  if (ficheT && !veutTutorat) db.prepare('DELETE FROM tutorat WHERE id = ?').run(ficheT.id);
  if (ficheE && !veutEval) db.prepare('DELETE FROM sessions_examen WHERE id = ?').run(ficheE.id);

  if (veutTutorat) {
    if (ficheT) {
      db.prepare(`UPDATE tutorat SET date_debut=?, date_fin=?, niveau=?, updated_at=datetime('now') WHERE id=?`)
        .run(pa.date_debut, pa.date_fin, niveau, ficheT.id);
    } else {
      db.prepare(`
        INSERT INTO tutorat (annee_id, pole_id, niveau, date_debut, date_fin, statut_fiche, activite_id, created_by, observations)
        VALUES (?, ?, ?, ?, ?, 'VALIDEE', ?, ?, ?)
      `).run(pa.annee_id, pole.id, niveau, pa.date_debut, pa.date_fin, pa.id, userId, `Issue du planning annuel : ${pa.libelle}`);
    }
  }
  if (veutEval) {
    if (ficheE) {
      db.prepare(`UPDATE sessions_examen SET date_demarrage=?, date_fin_prevue=?, niveau=?, type_evaluation=?, updated_at=datetime('now') WHERE id=?`)
        .run(pa.date_debut, pa.date_fin, niveau, pa.sous_type === 'DEVOIRS' ? 'DEVOIR' : 'EVALUATION', ficheE.id);
    } else {
      db.prepare(`
        INSERT INTO sessions_examen (annee_id, pole_id, niveau, session_num, type_evaluation,
          date_demarrage, date_fin_prevue, activite_id, created_by, observations)
        VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?)
      `).run(pa.annee_id, pole.id, niveau, pa.sous_type === 'DEVOIRS' ? 'DEVOIR' : 'EVALUATION',
        pa.date_debut, pa.date_fin, pa.id, userId, `Issue du planning annuel : ${pa.libelle}`);
    }
  }
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

/* ===== Lignes (niveaux) paramétrables des segments ===== */

// GET /api/planning/lignes — liste des lignes par segment (tous les profils, visiteurs inclus)
router.get('/lignes', auth, (req, res) => {
  res.json(getDb().prepare('SELECT * FROM planning_lignes ORDER BY segment, ordre, nom').all());
});

// POST /api/planning/lignes — ajout d'une ligne/niveau par le Directeur DFIP (ou l'Admin)
router.post('/lignes', auth, requireRole('DIRECTEUR', 'ADMIN_PORTAIL'), (req, res) => {
  const { segment, nom } = req.body;
  if (!segment || !nom?.trim()) return res.status(400).json({ error: 'Segment et nom requis' });
  if (!SEGMENTS.includes(segment)) return res.status(400).json({ error: 'Segment invalide' });
  const db = getDb();
  try {
    const max = db.prepare('SELECT COALESCE(MAX(ordre), -1) as m FROM planning_lignes WHERE segment = ?').get(segment).m;
    const r = db.prepare('INSERT INTO planning_lignes (segment, nom, ordre, created_by) VALUES (?, ?, ?, ?)')
      .run(segment, nom.trim(), max + 1, req.user.id);
    db.prepare('INSERT INTO audit_logs (user_id, action, module, detail) VALUES (?, ?, ?, ?)')
      .run(req.user.id, 'CREATE_LIGNE', 'CALENDRIER', `${segment}: ${nom.trim()}`);
    res.status(201).json(db.prepare('SELECT * FROM planning_lignes WHERE id = ?').get(r.lastInsertRowid));
  } catch {
    res.status(409).json({ error: 'Cette ligne existe déjà pour ce segment' });
  }
});

// DELETE /api/planning/lignes/:id — suppression si aucune activité ne l'utilise
router.delete('/lignes/:id', auth, requireRole('DIRECTEUR', 'ADMIN_PORTAIL'), (req, res) => {
  const db = getDb();
  const l = db.prepare('SELECT * FROM planning_lignes WHERE id = ?').get(req.params.id);
  if (!l) return res.status(404).json({ error: 'Ligne introuvable' });
  const utilisee = db.prepare('SELECT COUNT(*) as c FROM planning_activites WHERE segment = ? AND ligne = ?').get(l.segment, l.nom).c;
  if (utilisee > 0) return res.status(409).json({ error: `Impossible : ${utilisee} activité(s) utilisent cette ligne` });
  db.prepare('DELETE FROM planning_lignes WHERE id = ?').run(req.params.id);
  res.json({ message: 'Ligne supprimée' });
});

// GET /api/planning/plages?type=TUTORAT|EVALUATIONS&annee_id= — plages typées par pôle
// (alimente dynamiquement les modules Tutorat et Évaluations)
router.get('/plages', auth, (req, res) => {
  const db = getDb();
  const type = req.query.type === 'TUTORAT' ? 'TUTORAT' : 'EVALUATIONS';
  const annee_id = req.query.annee_id
    || db.prepare('SELECT id FROM annees_academiques WHERE active = 1 LIMIT 1').get()?.id;
  if (!annee_id) return res.json([]);
  const rows = db.prepare(`
    SELECT pa.segment, pa.ligne, pa.libelle, pa.type, pa.sous_type, pa.date_debut, pa.date_fin
    FROM planning_activites pa
    WHERE pa.annee_id = ? AND pa.type = ?
    ORDER BY pa.date_debut
  `).all(annee_id, type);
  const segPole = { PSEJA: 'SEJA', PSTN: 'STN', PLSHE: 'LSHE' };
  res.json(rows.map(r => ({ ...r, pole_code: segPole[r.segment] || null })));
});

// POST /api/planning
router.post('/', auth, (req, res) => {
  let { annee_id, segment, ligne, libelle, date_debut, date_fin, couleur, type, sous_type } = req.body;
  if (!annee_id || !segment || !ligne || !libelle || !date_debut || !date_fin) {
    return res.status(400).json({ error: 'Année, segment, ligne, libellé et dates requis' });
  }
  if (!SEGMENTS.includes(segment)) return res.status(400).json({ error: 'Segment invalide' });
  if (segment === 'RECTORAT') { type = null; sous_type = null; } // le Rectorat n'a pas de type d'activité
  if (date_fin < date_debut) return res.status(400).json({ error: 'La date de fin doit suivre la date de début' });
  if (type && !['TUTORAT', 'EVALUATIONS'].includes(type)) return res.status(400).json({ error: 'Type invalide' });
  if (type === 'EVALUATIONS' && sous_type && !['EXAMEN', 'DEVOIRS'].includes(sous_type)) {
    return res.status(400).json({ error: 'Sous-type invalide (Examen ou Devoirs)' });
  }

  const db = getDb();
  // Création strictement limitée au périmètre du profil
  if (!segmentsAutorises(req.user, db).includes(segment)) {
    return res.status(403).json({ error: 'Seuls les Responsables pédagogiques alimentent le planning (chacun pour son pôle).' });
  }

  // Une plage d'ÉVALUATIONS ne peut pas chevaucher les évaluations d'un autre pôle
  if (type === 'EVALUATIONS') {
    const pole = poleDuSegment(db, segment);
    if (pole) {
      const conflits = conflitEvalPlanning(db, { annee_id, pole_id: pole.id, date_debut, date_fin });
      if (conflits.length > 0) {
        const c = conflits[0];
        return res.status(409).json({
          error: `Conflit inter-pôles : le pôle ${c.pole_code} a déjà des évaluations du ${c.date_demarrage} au ${c.date_fin_prevue || c.date_demarrage}. Deux pôles ne peuvent pas être en évaluation simultanément.`,
          conflit: true, conflits,
        });
      }
    }
  }

  const r = db.prepare(`
    INSERT INTO planning_activites (annee_id, segment, ligne, libelle, date_debut, date_fin, couleur, type, sous_type, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(annee_id, segment, ligne, libelle, date_debut, date_fin, couleur || null,
    type || null, type === 'EVALUATIONS' ? (sous_type || 'EXAMEN') : null, req.user.id);

  // Liaison automatique : l'activité typée alimente le module Tutorat / Évaluations
  synchroniserModule(db, r.lastInsertRowid, req.user.id);

  db.prepare('INSERT INTO audit_logs (user_id, action, module, detail) VALUES (?, ?, ?, ?)')
    .run(req.user.id, 'CREATE_PLANNING', 'CALENDRIER', `${segment}/${ligne}: ${libelle}`);

  res.status(201).json(db.prepare('SELECT * FROM planning_activites WHERE id = ?').get(r.lastInsertRowid));
});

function appliquerModification(db, activiteId, payload, userId) {
  const prev = db.prepare('SELECT * FROM planning_activites WHERE id = ?').get(activiteId);
  if (!prev) return false;
  db.prepare(`
    UPDATE planning_activites SET ligne=?, libelle=?, date_debut=?, date_fin=?, couleur=?, type=?, sous_type=? WHERE id=?
  `).run(payload.ligne ?? prev.ligne, payload.libelle ?? prev.libelle,
    payload.date_debut ?? prev.date_debut, payload.date_fin ?? prev.date_fin,
    payload.couleur !== undefined ? payload.couleur : prev.couleur,
    payload.type !== undefined ? payload.type : prev.type,
    payload.sous_type !== undefined ? payload.sous_type : prev.sous_type,
    activiteId);
  // Répercuter sur le module lié (Tutorat / Évaluations)
  synchroniserModule(db, activiteId, userId || prev.created_by);
  return true;
}

// Supprime une activité ET son entrée liée dans les modules
function supprimerActivite(db, activiteId) {
  db.prepare('DELETE FROM tutorat WHERE activite_id = ?').run(activiteId);
  db.prepare('DELETE FROM sessions_examen WHERE activite_id = ?').run(activiteId);
  db.prepare('DELETE FROM planning_activites WHERE id = ?').run(activiteId);
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

  const { ligne, libelle, date_debut, date_fin, couleur, type, sous_type } = req.body;
  const payload = { ligne, libelle, date_debut, date_fin, couleur, type, sous_type };

  // Le Directeur DFIP applique directement (c'est lui le validateur)
  if (req.user.role === 'DIRECTEUR') {
    appliquerModification(db, req.params.id, payload, req.user.id);
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
    supprimerActivite(db, req.params.id); // supprime aussi l'entrée liée dans Tutorat/Évaluations
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
      supprimerActivite(db, dem.activite_id); // + entrée liée Tutorat/Évaluations
    } else {
      appliquerModification(db, dem.activite_id, JSON.parse(dem.payload || '{}'), req.user.id);
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
