const express = require('express');
const { getDb } = require('../db/connection');
const { auth, requireRole, hasRole } = require('../middleware/auth');
const { notifierConcernes, checkDateBloquee, emailWrapper } = require('../services/notify');
const { sendEmail } = require('../services/email');
const { ROLES_RESTREINTS } = require('../config');

const router = express.Router();

const SESSION_LABEL = { 1: 'Session Normale', 2: 'Session de Rattrapage', 3: 'Session Spéciale' };

// Suivi (réception, implémentation, état, date prévue) : Chef de division DFE
const SUIVI_ROLES = ['CHEF_DIV_EVALUATION', 'DIRECTEUR', 'ADMIN_PORTAIL'];
// Création + dates : Responsable pédagogique du pôle (les Responsables de formation
// consultent et signalent), complétés par le Chef DFE
const CREATE_ROLES = ['RESPONSABLE_PEDAGOGIQUE', ...SUIVI_ROLES];
// Délibérations : Directeurs de pôle (leur pôle) + Directeur/Admin
// Délibérations : réservées aux Responsables pédagogiques des pôles
const DELIB_ROLES = ['RESPONSABLE_PEDAGOGIQUE'];

/* ===== Plages d'évaluations définies dans le Planning annuel =====
   Sources (union) : activités TYPÉES « EVALUATIONS » du segment du pôle
   + compatibilité : lignes « Évaluations SEJA / STN / LSHE » du segment DFIP & DES. */
const POLE_SEGMENT = { SEJA: 'PSEJA', STN: 'PSTN', LSHE: 'PLSHE' };
function plagesEvaluations(db, annee_id, poleId) {
  const pole = db.prepare('SELECT code FROM poles WHERE id = ?').get(poleId);
  if (!pole) return [];
  return db.prepare(`
    SELECT date_debut, date_fin, libelle, sous_type FROM planning_activites
    WHERE annee_id = ?
      AND (
        (type = 'EVALUATIONS' AND segment = ?)
        OR (segment = 'DFIP_DES' AND ligne = ?)
      )
    ORDER BY date_debut
  `).all(annee_id, POLE_SEGMENT[pole.code] || '—', `Évaluations ${pole.code}`);
}

/* ===== Contrôle de CAPACITÉ des ENO (remplace l'ancien conflit inter-pôles) =====
   Plusieurs pôles peuvent désormais évaluer simultanément : la seule contrainte
   est la capacité physique des ENO (effectifs cumulés des évaluations qui se
   chevauchent vs capacité de chaque ENO). Sans effectifs connus pour le cursus,
   aucun blocage. */
const { simuler } = require('./statistiques');
function conflitCapacite(db, { formation_id, promotion_id, niveau, date_demarrage, date_fin_prevue, exclure_id }) {
  if (!date_demarrage || !formation_id || !niveau || !promotion_id) return null;
  const promo = db.prepare('SELECT code FROM promotions WHERE id = ?').get(promotion_id);
  if (!promo) return null;
  const connus = db.prepare('SELECT COUNT(*) as c FROM effectifs WHERE promotion_code = ? AND niveau = ? AND formation_id = ?')
    .get(promo.code, niveau, formation_id).c;
  if (connus === 0) return null; // cursus sans effectifs renseignés → pas de contrôle
  const r = simuler(db, {
    selections: [{ promotion_code: promo.code, niveau, formation_id }],
    date_demarrage, date_fin_prevue, exclure_id,
  });
  return r.faisable ? null : r;
}

function dansUnePlage(plages, d1, d2) {
  return plages.some(p => d1 >= p.date_debut && (d2 || d1) <= p.date_fin);
}

// Contrôle des dates fournies par un responsable de formation (bloquant),
// et par les autres rôles si des plages existent.
function controlePlage(db, user, { annee_id, pole_id, date_demarrage, date_fin_prevue }) {
  if (!date_demarrage) return null;
  const plages = plagesEvaluations(db, annee_id, pole_id);
  const estRF = hasRole(user, 'RESPONSABLE_FORMATION');
  if (plages.length === 0) {
    return estRF
      ? "Aucune plage d'évaluations n'est définie dans le Planning annuel pour votre pôle. Impossible de fixer des dates."
      : null; // les rôles de direction peuvent amorcer sans plage
  }
  if (!dansUnePlage(plages, date_demarrage, date_fin_prevue)) {
    const liste = plages.map(p => `${p.date_debut} → ${p.date_fin}`).join(' ; ');
    return `Dates hors plage : les évaluations de votre pôle doivent se tenir dans les plages du Planning annuel (${liste}).`;
  }
  return null;
}

/* ===== Lecture ===== */
router.get('/', auth, (req, res) => {
  const db = getDb();
  const { annee_id, pole_id, session_num, type_evaluation } = req.query;
  let sql = `
    SELECT se.*,
      aa.libelle as annee_libelle,
      p.nom as pole_nom, p.code as pole_code,
      f.nom as formation_nom, f.code as formation_code, f.cycle as formation_cycle,
      pr.code as promotion_code,
      cb.nom as created_by_nom, cb.prenom as created_by_prenom
    FROM sessions_examen se
    JOIN annees_academiques aa ON aa.id = se.annee_id
    LEFT JOIN poles p ON p.id = se.pole_id
    LEFT JOIN formations f ON f.id = se.formation_id
    LEFT JOIN promotions pr ON pr.id = se.promotion_id
    JOIN users cb ON cb.id = se.created_by
    WHERE 1=1`;
  const params = [];
  if (annee_id) { sql += ' AND se.annee_id = ?'; params.push(annee_id); }
  if (pole_id) { sql += ' AND se.pole_id = ?'; params.push(pole_id); }
  if (session_num) { sql += ' AND se.session_num = ?'; params.push(session_num); }
  if (type_evaluation) { sql += ' AND se.type_evaluation = ?'; params.push(type_evaluation); }
  if (ROLES_RESTREINTS.includes(req.user.role) && req.user.pole_id) {
    sql += ' AND se.pole_id = ?'; params.push(req.user.pole_id);
  }
  sql += ' ORDER BY se.session_num, se.date_demarrage';
  res.json(db.prepare(sql).all(...params));
});

// GET /api/evaluations/plages?annee_id=&pole_id= — plages autorisées (pour l'UI)
router.get('/plages', auth, (req, res) => {
  const db = getDb();
  const annee_id = req.query.annee_id
    || db.prepare('SELECT id FROM annees_academiques WHERE active = 1 LIMIT 1').get()?.id;
  if (!req.query.pole_id || !annee_id) return res.json([]);
  res.json(plagesEvaluations(db, annee_id, req.query.pole_id));
});

router.post('/check-date', auth, (req, res) => {
  res.json(checkDateBloquee(req.body.date));
});

// POST /api/evaluations/check-conflit — pré-contrôle de CAPACITÉ des ENO (pour l'UI)
router.post('/check-conflit', auth, (req, res) => {
  const db = getDb();
  const { formation_id, promotion_id, niveau, date_demarrage, date_fin_prevue, exclure_id } = req.body;
  if (!formation_id || !promotion_id || !niveau || !date_demarrage) return res.json({ capacite: null });
  res.json({ capacite: conflitCapacite(db, { formation_id, promotion_id, niveau, date_demarrage, date_fin_prevue, exclure_id }) });
});

/* ===== Création (Responsables de formation, dans les plages du planning) ===== */
router.post('/', auth, requireRole(...CREATE_ROLES), (req, res) => {
  const { annee_id, pole_id, promotion_id, formation_id, niveau, semestre_code, session_num,
          type_evaluation, date_demarrage, date_fin_prevue } = req.body;
  if (!annee_id || !pole_id || !formation_id) {
    return res.status(400).json({ error: 'Année, pôle et formation requis' });
  }
  if (!date_demarrage || !date_fin_prevue) {
    return res.status(400).json({ error: 'Date de démarrage et date de clôture requises' });
  }

  const db = getDb();

  // Le Responsable pédagogique ne crée que pour SON pôle
  if (req.user.role === 'RESPONSABLE_PEDAGOGIQUE' && req.user.pole_id !== parseInt(pole_id)) {
    return res.status(403).json({ error: 'Vous ne pouvez renseigner que les évaluations de votre pôle.' });
  }

  // Dates impérativement dans les plages du Planning annuel
  const errPlage = controlePlage(db, req.user, { annee_id, pole_id, date_demarrage, date_fin_prevue });
  if (errPlage) return res.status(422).json({ error: errPlage, hors_plage: true });

  // RÈGLE MÉTIER : capacité physique des ENO (effectifs cumulés des évaluations simultanées)
  const capa = conflitCapacite(db, { formation_id, promotion_id, niveau, date_demarrage, date_fin_prevue });
  if (capa) {
    const s = capa.satures[0];
    return res.status(409).json({
      error: `Capacité ENO dépassée : ${capa.satures.map(x => `${x.eno} (${x.demande}/${x.capacite}, ${x.manque} places manquantes)`).join(' ; ')}. Changez les dates ou répartissez les formations sur d'autres créneaux.`,
      conflit: true, capacite: capa,
    });
  }

  // Jamais un jour férié / vacances
  const blk = checkDateBloquee(date_demarrage);
  if (blk.ferie) return res.status(409).json({ error: `Date de démarrage = jour férié (${blk.ferie.libelle}).` });
  if (blk.vacances) return res.status(409).json({ error: `Date de démarrage pendant les vacances (${blk.vacances.libelle}).` });

  const r = db.prepare(`
    INSERT INTO sessions_examen (annee_id, pole_id, promotion_id, formation_id, niveau, semestre_code,
      session_num, type_evaluation, date_demarrage, date_fin_prevue, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(annee_id, pole_id, promotion_id || null, formation_id || null, niveau || null, semestre_code || null,
    session_num || 1, type_evaluation === 'DEVOIR' ? 'DEVOIR' : 'EVALUATION',
    date_demarrage, date_fin_prevue, req.user.id);

  const filiere = db.prepare('SELECT nom FROM formations WHERE id = ?').get(formation_id);
  notifierConcernes({
    pole_id,
    titre: `${type_evaluation === 'DEVOIR' ? 'Devoir' : 'Évaluation'} — ${SESSION_LABEL[session_num || 1]}`,
    message: `${filiere?.nom || ''} : du ${date_demarrage} au ${date_fin_prevue}.`,
    type: 'EXAMEN',
    lien: '/evaluations',
  });
  db.prepare('INSERT INTO audit_logs (user_id, action, module, detail) VALUES (?, ?, ?, ?)')
    .run(req.user.id, 'CREATE_EVALUATION', 'EVALUATIONS', `${filiere?.nom || ''} ${SESSION_LABEL[session_num || 1]}`);

  res.status(201).json(db.prepare('SELECT * FROM sessions_examen WHERE id = ?').get(r.lastInsertRowid));
});

/* ===== Mise à jour ===== */
router.put('/:id', auth, (req, res) => {
  const db = getDb();
  const prev = db.prepare('SELECT * FROM sessions_examen WHERE id = ?').get(req.params.id);
  if (!prev) return res.status(404).json({ error: 'Évaluation introuvable' });

  const { date_demarrage, date_fin_prevue, session_num, type_evaluation,
          reception_epreuves, date_programmation, implementation_epreuves, etat_eval,
          delib_etat, date_deliberation, etat, observations, motif } = req.body;

  const estSuivi = SUIVI_ROLES.includes(req.user.role);
  // Dates : Responsable pédagogique du pôle (les RF signalent, ils ne modifient pas)
  const estRF = req.user.role === 'RESPONSABLE_PEDAGOGIQUE' && req.user.pole_id === prev.pole_id;
  const estDP = hasRole(req.user, 'RESPONSABLE_POLE') && req.user.pole_id === prev.pole_id;
  const estDirection = ['DIRECTEUR', 'ADMIN_PORTAIL'].includes(req.user.role);

  // Évaluation délibérée (clôturée) : modifiable uniquement par le Directeur DFIP
  if (prev.delib_etat === 'TERMINEE' && !estDirection) {
    return res.status(403).json({ error: 'Évaluation délibérée (clôturée) — modifiable uniquement par le Directeur DFIP.' });
  }

  // La date prévue pour l'examen ne doit pas sortir des plages fournies par le Planning annuel
  if (date_programmation !== undefined && date_programmation && !estDirection) {
    const errProg = controlePlage(db, req.user, {
      annee_id: prev.annee_id, pole_id: prev.pole_id,
      date_demarrage: date_programmation, date_fin_prevue: date_programmation,
    });
    if (errProg) {
      return res.status(422).json({ error: `Date prévue pour l'examen hors plage — ${errProg}`, hors_plage: true });
    }
  }

  // --- Champs de suivi (Chef de division DFE) ---
  const changeSuivi = [reception_epreuves, date_programmation, implementation_epreuves, etat_eval, etat, observations, session_num, type_evaluation]
    .some(v => v !== undefined);
  if (changeSuivi && !estSuivi) {
    return res.status(403).json({ error: 'Le suivi des évaluations est réservé au Chef de division DFE.' });
  }

  // --- Dates (Responsable de formation ou Chef DFE) : toujours dans les plages ---
  const changeDates = date_demarrage !== undefined || date_fin_prevue !== undefined;
  if (changeDates && prev.activite_id) {
    return res.status(409).json({ error: 'Cette évaluation est liée au Planning annuel : modifiez les dates de l\'activité dans le planning.' });
  }
  if (changeDates) {
    if (!estSuivi && !estRF) return res.status(403).json({ error: 'Les dates sont renseignées par le responsable de formation.' });
    const errPlage = controlePlage(db, req.user, {
      annee_id: prev.annee_id, pole_id: prev.pole_id,
      date_demarrage: date_demarrage ?? prev.date_demarrage,
      date_fin_prevue: date_fin_prevue ?? prev.date_fin_prevue,
    });
    if (errPlage) return res.status(422).json({ error: errPlage, hors_plage: true });

    // Capacité des ENO sur les nouvelles dates
    const capa = conflitCapacite(db, {
      formation_id: prev.formation_id, promotion_id: prev.promotion_id, niveau: prev.niveau,
      date_demarrage: date_demarrage ?? prev.date_demarrage,
      date_fin_prevue: date_fin_prevue ?? prev.date_fin_prevue,
      exclure_id: prev.id,
    });
    if (capa) {
      return res.status(409).json({
        error: `Capacité ENO dépassée : ${capa.satures.map(x => `${x.eno} (${x.demande}/${x.capacite}, ${x.manque} places manquantes)`).join(' ; ')}. Changez les dates.`,
        conflit: true, capacite: capa,
      });
    }
  }

  // --- Délibérations : SEULS les Responsables pédagogiques des pôles les modifient
  //     (le Directeur DFIP ne peut intervenir que pour corriger une évaluation déjà délibérée) ---
  const estRPPole = req.user.role === 'RESPONSABLE_PEDAGOGIQUE' && req.user.pole_id === prev.pole_id;
  const changeDelib = delib_etat !== undefined || date_deliberation !== undefined;
  if (changeDelib) {
    if (!estRPPole && !(estDirection && prev.delib_etat === 'TERMINEE')) {
      return res.status(403).json({ error: 'Les délibérations sont réservées au Responsable pédagogique du pôle.' });
    }
    if ((etat_eval ?? prev.etat_eval) !== 'EVAL_TERMINEES') {
      return res.status(409).json({ error: 'Les délibérations ne s\'ouvrent qu\'une fois les évaluations terminées.' });
    }
  }

  // --- Report / annulation ⇒ incident obligatoire ---
  const estReport = date_demarrage && prev.date_demarrage && date_demarrage !== prev.date_demarrage;
  const estAnnulation = etat === 'ANNULE' && prev.etat !== 'ANNULE';
  if ((estReport || estAnnulation) && !motif) {
    return res.status(422).json({
      error: estAnnulation ? "Annulation : le motif (incident) est obligatoire." : "Report de dates : le motif (incident) est obligatoire.",
      motif_requis: true,
    });
  }
  if (date_demarrage && date_demarrage !== prev.date_demarrage) {
    const blk = checkDateBloquee(date_demarrage);
    if (blk.ferie) return res.status(409).json({ error: `Jour férié (${blk.ferie.libelle}).` });
    if (blk.vacances) return res.status(409).json({ error: `Vacances (${blk.vacances.libelle}).` });
  }

  db.prepare(`
    UPDATE sessions_examen SET
      date_demarrage=?, date_fin_prevue=?, session_num=?, type_evaluation=?,
      reception_epreuves=?, date_programmation=?, implementation_epreuves=?, etat_eval=?,
      delib_etat=?, date_deliberation=?, deliberation=?, etat=?, observations=?, updated_at=datetime('now')
    WHERE id=?
  `).run(
    date_demarrage ?? prev.date_demarrage,
    date_fin_prevue ?? prev.date_fin_prevue,
    session_num ?? prev.session_num,
    type_evaluation ?? prev.type_evaluation,
    reception_epreuves ?? prev.reception_epreuves,
    date_programmation ?? prev.date_programmation,
    implementation_epreuves ?? prev.implementation_epreuves,
    etat_eval ?? prev.etat_eval,
    delib_etat ?? prev.delib_etat,
    date_deliberation !== undefined ? date_deliberation : prev.date_deliberation,
    (delib_etat ?? prev.delib_etat) === 'TERMINEE' ? 1 : prev.deliberation,
    etat ?? prev.etat,
    observations ?? prev.observations,
    req.params.id);

  // Incident automatique en cas de report / annulation
  if (estReport || estAnnulation) {
    const filiere = prev.formation_id ? db.prepare('SELECT nom FROM formations WHERE id = ?').get(prev.formation_id) : null;
    const titre = `${estAnnulation ? 'Annulation' : 'Report'} ${SESSION_LABEL[prev.session_num]}${filiere ? ` — ${filiere.nom}` : ''}`;
    db.prepare(`
      INSERT INTO incidents (titre, description, type_incident, gravite, statut, signale_par,
        pole_id, promotion_id, formation_id, niveau, semestre_code, session_num,
        date_debut, date_incident, conseq_eval, consequence_examens, ref_type, ref_id)
      VALUES (?, ?, 'AUTRE', 'HAUTE', 'OUVERT', ?, ?, ?, ?, ?, ?, ?, date('now'), date('now'), ?, ?, 'SESSION_EXAMEN', ?)
    `).run(titre, motif, req.user.id,
      prev.pole_id || null, prev.promotion_id || null, prev.formation_id || null,
      prev.niveau || null, prev.semestre_code || null, prev.session_num,
      estAnnulation ? 'ANNULATION' : 'REPORT',
      estAnnulation ? 'Évaluation annulée' : `Évaluation reportée du ${prev.date_demarrage} au ${date_demarrage}`,
      prev.id);
    notifierConcernes({ pole_id: prev.pole_id, titre: `🚨 ${titre}`, message: `Motif : ${motif}`, type: 'INCIDENT', lien: '/incidents' });
  }

  const filiereNom = prev.formation_id ? db.prepare('SELECT nom FROM formations WHERE id = ?').get(prev.formation_id)?.nom : null;
  const refEval = `${filiereNom || 'Pôle'} · ${SESSION_LABEL[prev.session_num]} ${prev.niveau || ''} ${prev.semestre_code || ''}`.trim();

  // Évaluations terminées → le Responsable pédagogique du pôle est notifié pour la DÉLIBÉRATION
  if (etat_eval === 'EVAL_TERMINEES' && prev.etat_eval !== 'EVAL_TERMINEES' && prev.pole_id) {
    const rps = db.prepare("SELECT * FROM users WHERE role = 'RESPONSABLE_PEDAGOGIQUE' AND pole_id = ? AND actif = 1").all(prev.pole_id);
    const ins = db.prepare('INSERT INTO notifications (user_id, titre, message, type, lien) VALUES (?, ?, ?, ?, ?)');
    for (const rp of rps) {
      const msg = `Les évaluations « ${refEval} » sont terminées : vous pouvez procéder à la délibération (Pas encore / Prévue le / Effective).`;
      ins.run(rp.id, '⚖ Évaluations terminées — délibération à mener', msg, 'EVALUATION', '/evaluations');
      sendEmail({ to: rp.email, subject: '[Portail DFIP] Évaluations terminées — délibération', html: emailWrapper(rp, 'Délibération à mener', `<p>${msg}</p>`) });
    }
  }

  // Modification des dates par le Responsable pédagogique → le Chef division DFE valide/vérifie
  if (estRF && changeDates) {
    const chefs = db.prepare("SELECT * FROM users WHERE role = 'CHEF_DIV_EVALUATION' AND actif = 1").all();
    const ins = db.prepare('INSERT INTO notifications (user_id, titre, message, type, lien) VALUES (?, ?, ?, ?, ?)');
    for (const c of chefs) {
      const msg = `${req.user.prenom} ${req.user.nom} (Responsable pédagogique) a modifié les dates de « ${refEval} » : ${date_demarrage ?? prev.date_demarrage} → ${date_fin_prevue ?? prev.date_fin_prevue}. Merci de vérifier et valider ce changement.`;
      ins.run(c.id, '📝 Évaluation modifiée — à valider', msg, 'EVALUATION', '/evaluations');
      sendEmail({ to: c.email, subject: '[Portail DFIP] Évaluation modifiée par le Responsable pédagogique', html: emailWrapper(c, 'Modification à valider', `<p>${msg}</p>`) });
    }
  }

  res.json(db.prepare('SELECT * FROM sessions_examen WHERE id = ?').get(req.params.id));
});

/* ===== Délibérations groupées (Directeur de pôle : plusieurs formations à la fois) ===== */
router.post('/deliberations', auth, requireRole(...DELIB_ROLES), (req, res) => {
  const { ids, delib_etat, date_deliberation } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'Sélectionnez au moins une évaluation' });
  if (!['PAS_ENCORE', 'PREVUE', 'TERMINEE'].includes(delib_etat)) return res.status(400).json({ error: 'État de délibération invalide' });
  if (['PREVUE', 'TERMINEE'].includes(delib_etat) && !date_deliberation) {
    return res.status(400).json({ error: 'La date de délibération est requise' });
  }

  const db = getDb();
  const resultats = { appliquees: 0, refusees: [] };
  const maj = db.prepare(`
    UPDATE sessions_examen SET delib_etat=?, date_deliberation=?, deliberation=?, updated_at=datetime('now') WHERE id=?
  `);

  const estDirection = ['DIRECTEUR', 'ADMIN_PORTAIL'].includes(req.user.role);
  for (const id of ids) {
    const s = db.prepare('SELECT * FROM sessions_examen WHERE id = ?').get(id);
    if (!s) { resultats.refusees.push({ id, raison: 'introuvable' }); continue; }
    if (!estDirection && req.user.pole_id !== s.pole_id) {
      resultats.refusees.push({ id, raison: 'hors de votre pôle' }); continue;
    }
    if (s.etat_eval !== 'EVAL_TERMINEES') {
      resultats.refusees.push({ id, raison: 'évaluations non terminées' }); continue;
    }
    maj.run(delib_etat, date_deliberation || null, delib_etat === 'TERMINEE' ? 1 : 0, id);
    resultats.appliquees++;
  }

  db.prepare('INSERT INTO audit_logs (user_id, action, module, detail) VALUES (?, ?, ?, ?)')
    .run(req.user.id, 'DELIBERATIONS_BULK', 'EVALUATIONS', `${resultats.appliquees} formation(s) → ${delib_etat}`);

  res.json(resultats);
});

// DELETE
/* Suppression :
   - Directeur / Admin : suppression directe
   - Chef division DFE : uniquement une évaluation ANNULÉE → demande soumise à la validation du Directeur DFIP */
router.delete('/:id', auth, requireRole('DIRECTEUR', 'ADMIN_PORTAIL', 'CHEF_DIV_EVALUATION'), (req, res) => {
  const db = getDb();
  const s = db.prepare('SELECT * FROM sessions_examen WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Évaluation introuvable' });
  if (s.activite_id) {
    return res.status(409).json({ error: 'Évaluation liée au Planning annuel : supprimez l\'activité dans le planning.' });
  }

  const estDirection = ['DIRECTEUR', 'ADMIN_PORTAIL'].includes(req.user.role);
  if (!estDirection) {
    // Chef division DFE : demande de suppression (évaluation annulée uniquement)
    if (s.etat !== 'ANNULE') {
      return res.status(409).json({ error: 'Seule une évaluation ANNULÉE peut faire l\'objet d\'une demande de suppression.' });
    }
    if (s.suppr_demandee) return res.status(409).json({ error: 'Suppression déjà demandée — en attente du Directeur DFIP.' });
    db.prepare("UPDATE sessions_examen SET suppr_demandee = 1, updated_at = datetime('now') WHERE id = ?").run(s.id);
    const dirs = db.prepare("SELECT * FROM users WHERE role = 'DIRECTEUR' AND actif = 1").all();
    const ins = db.prepare('INSERT INTO notifications (user_id, titre, message, type, lien) VALUES (?, ?, ?, ?, ?)');
    for (const d of dirs) {
      const msg = `${req.user.prenom} ${req.user.nom} demande la suppression d'une évaluation ANNULÉE (${SESSION_LABEL[s.session_num]} ${s.niveau || ''} ${s.semestre_code || ''}). Validez ou refusez depuis le module Évaluations.`;
      ins.run(d.id, '🗑 Demande de suppression d\'évaluation', msg, 'EVALUATION', '/evaluations');
      sendEmail({ to: d.email, subject: '[Portail DFIP] Demande de suppression d\'évaluation', html: emailWrapper(d, 'Suppression à valider', `<p>${msg}</p>`) });
    }
    db.prepare('INSERT INTO audit_logs (user_id, action, module, detail) VALUES (?, ?, ?, ?)')
      .run(req.user.id, 'DEMANDE_SUPPRESSION', 'EVALUATIONS', `id=${s.id}`);
    return res.status(202).json({ message: 'Demande de suppression transmise au Directeur DFIP pour validation.' });
  }

  db.prepare('DELETE FROM sessions_examen WHERE id = ?').run(req.params.id);
  db.prepare('INSERT INTO audit_logs (user_id, action, module, detail) VALUES (?, ?, ?, ?)')
    .run(req.user.id, 'DELETE_EVALUATION', 'EVALUATIONS', `id=${req.params.id}`);
  res.json({ message: 'Évaluation supprimée' });
});

// POST /api/evaluations/:id/refuser-suppression — le Directeur DFIP refuse la demande
router.post('/:id/refuser-suppression', auth, requireRole('DIRECTEUR', 'ADMIN_PORTAIL'), (req, res) => {
  const db = getDb();
  const s = db.prepare('SELECT * FROM sessions_examen WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Évaluation introuvable' });
  db.prepare("UPDATE sessions_examen SET suppr_demandee = 0, updated_at = datetime('now') WHERE id = ?").run(s.id);
  const chefs = db.prepare("SELECT * FROM users WHERE role = 'CHEF_DIV_EVALUATION' AND actif = 1").all();
  const ins = db.prepare('INSERT INTO notifications (user_id, titre, message, type, lien) VALUES (?, ?, ?, ?, ?)');
  chefs.forEach(c => ins.run(c.id, 'Demande de suppression refusée',
    `Le Directeur DFIP a refusé la suppression de l'évaluation ${SESSION_LABEL[s.session_num]} ${s.niveau || ''} ${s.semestre_code || ''}.`, 'EVALUATION', '/evaluations'));
  res.json({ message: 'Demande refusée — évaluation conservée' });
});

module.exports = router;
