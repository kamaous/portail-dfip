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
// Création + dates : RESPONSABLE DE FORMATION (son pôle), complétés par le Chef DFE.
// Le Responsable pédagogique ne crée PAS : son rôle est la DÉLIBÉRATION.
// Contrôle sur le rôle RÉEL (req.user.role) pour ne pas laisser passer l'héritage RP → RF.
const CREATE_ROLES = ['RESPONSABLE_FORMATION', ...SUIVI_ROLES];
function creationAutorisee(req, res, next) {
  if (!CREATE_ROLES.includes(req.user.role)) {
    return res.status(403).json({ error: 'La création des évaluations est réservée aux Responsables de formation.' });
  }
  next();
}
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
function conflitCapacite(db, { formation_id, promotion_id, niveau, date_demarrage, date_fin_prevue, heure_debut, heure_fin, groupe, exclure_id }) {
  if (!date_demarrage || !formation_id || !niveau || !promotion_id) return null;
  const promo = db.prepare('SELECT code FROM promotions WHERE id = ?').get(promotion_id);
  if (!promo) return null;
  const connus = db.prepare('SELECT COUNT(*) as c FROM effectifs WHERE promotion_code = ? AND niveau = ? AND formation_id = ?')
    .get(promo.code, niveau, formation_id).c;
  if (connus === 0) return null; // cursus sans effectifs renseignés → pas de contrôle
  const r = simuler(db, {
    selections: [{ promotion_code: promo.code, niveau, formation_id, groupe: groupe || null }],
    date_demarrage, date_fin_prevue, heure_debut, heure_fin, exclure_id,
  });
  return r.faisable ? null : r;
}

/* ENO où l'effectif du cursus dépasse À LUI SEUL la capacité d'accueil :
   la promotion doit alors être scindée en 2 groupes (G1 / G2). */
function enosNecessitantGroupes(db, { formation_id, promotion_id, niveau }) {
  if (!formation_id || !promotion_id || !niveau) return [];
  const promo = db.prepare('SELECT code FROM promotions WHERE id = ?').get(promotion_id);
  if (!promo) return [];
  const rows = db.prepare(`
    SELECT e.id, e.nom, e.capacite, ef.nombre,
      (SELECT COALESCE(SUM(CASE WHEN s.disponible = 1 THEN s.capacite ELSE 0 END), -1)
       FROM eno_salles s WHERE s.eno_id = e.id) as cap_salles,
      (SELECT COUNT(*) FROM eno_salles s WHERE s.eno_id = e.id) as nb_salles
    FROM effectifs ef JOIN enos e ON e.id = ef.eno_id
    WHERE ef.promotion_code = ? AND ef.niveau = ? AND ef.formation_id = ? AND e.actif = 1
  `).all(promo.code, niveau, formation_id);
  return rows
    .map(r => ({ eno: r.nom, effectif: r.nombre, capacite: r.nb_salles > 0 ? r.cap_salles : r.capacite }))
    .filter(r => r.capacite > 0 && r.effectif > r.capacite);
}

const GROUPES_VALIDES = [null, '', 'G1', 'G2'];
function normaliseEpreuves(epreuves) {
  if (epreuves === undefined) return undefined;      // champ absent → inchangé
  if (!epreuves) return null;
  const arr = typeof epreuves === 'string' ? JSON.parse(epreuves) : epreuves;
  if (!Array.isArray(arr)) throw new Error('epreuves doit être une liste');
  return JSON.stringify(arr
    .filter(e => e && e.date)
    .map(e => ({
      date: String(e.date),
      heure_debut: e.heure_debut || null,
      heure_fin: e.heure_fin || null,
      matieres: Array.isArray(e.matieres) ? e.matieres.map(String).filter(Boolean) : [],
    }))
    .sort((a, b) => a.date.localeCompare(b.date) || String(a.heure_debut || '').localeCompare(String(b.heure_debut || '')))
  );
}

function dansUnePlage(plages, d1, d2) {
  return plages.some(p => d1 >= p.date_debut && (d2 || d1) <= p.date_fin);
}

// CONTRAINTE DES PLAGES = OPTION pilotée par le DIRECTEUR DES (paramètre
// contrainte_plages, page Référentiel). Activée : une plage EVALUATIONS doit
// exister pour le pôle et les dates doivent s'y inscrire. Désactivée : indicatif.
const { getParam } = require('./parametres');
function controlePlage(db, user, { annee_id, pole_id, date_demarrage, date_fin_prevue }) {
  if (getParam(db, 'contrainte_plages') !== '1') return null; // option désactivée par le DES
  if (!date_demarrage) return null;
  const plages = plagesEvaluations(db, annee_id, pole_id);
  if (plages.length === 0) {
    return "Contrainte des plages active : aucune plage d'évaluations n'est définie au Planning annuel pour ce pôle. Créez d'abord l'activité (type Évaluations), ou demandez au Directeur DES de désactiver la contrainte.";
  }
  if (!dansUnePlage(plages, date_demarrage, date_fin_prevue)) {
    const liste = plages.map(p => `${p.date_debut} → ${p.date_fin}`).join(' ; ');
    return `Contrainte des plages active : les évaluations doivent se tenir dans les plages du Planning annuel (${liste}).`;
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
  const { formation_id, promotion_id, niveau, date_demarrage, date_fin_prevue, heure_debut, heure_fin, groupe, exclure_id } = req.body;
  if (!formation_id || !promotion_id || !niveau) return res.json({ capacite: null, groupes_requis: [] });
  // ENO où l'effectif du cursus dépasse à lui seul la capacité → scission G1/G2 proposée
  const groupes_requis = enosNecessitantGroupes(db, { formation_id, promotion_id, niveau });
  if (!date_demarrage) return res.json({ capacite: null, groupes_requis });
  res.json({
    capacite: conflitCapacite(db, { formation_id, promotion_id, niveau, date_demarrage, date_fin_prevue, heure_debut, heure_fin, groupe: groupe || null, exclure_id }),
    groupes_requis,
  });
});

/* ===== Création (Responsables de formation, dans les plages du planning) ===== */
router.post('/', auth, creationAutorisee, (req, res) => {
  const { annee_id, pole_id, promotion_id, formation_id, niveau, semestre_code, session_num,
          type_evaluation, date_demarrage, date_fin_prevue, heure_debut, heure_fin, groupe, epreuves } = req.body;
  if (!annee_id || !pole_id || !formation_id) {
    return res.status(400).json({ error: 'Année, pôle et formation requis' });
  }
  if (!date_demarrage || !date_fin_prevue) {
    return res.status(400).json({ error: 'Date de démarrage et date de clôture requises' });
  }
  if (!GROUPES_VALIDES.includes(groupe ?? null)) {
    return res.status(400).json({ error: 'Groupe invalide (G1 ou G2)' });
  }
  let epreuvesJson = null;
  try { epreuvesJson = normaliseEpreuves(epreuves) ?? null; }
  catch { return res.status(400).json({ error: 'Format des épreuves invalide' }); }

  const db = getDb();

  // Le Responsable de formation ne crée que pour SON pôle
  if (req.user.role === 'RESPONSABLE_FORMATION' && req.user.pole_id !== parseInt(pole_id)) {
    return res.status(403).json({ error: 'Vous ne pouvez renseigner que les évaluations de votre pôle.' });
  }

  // Dates impérativement dans les plages du Planning annuel
  const errPlage = controlePlage(db, req.user, { annee_id, pole_id, date_demarrage, date_fin_prevue });
  if (errPlage) return res.status(422).json({ error: errPlage, hors_plage: true });

  // RÈGLE MÉTIER : capacité physique des ENO (effectifs cumulés des évaluations simultanées,
  // au même créneau horaire — deux créneaux disjoints ne se cumulent pas)
  const capa = conflitCapacite(db, { formation_id, promotion_id, niveau, date_demarrage, date_fin_prevue, heure_debut, heure_fin, groupe: groupe || null });
  if (capa) {
    return res.status(409).json({
      error: `Capacité ENO dépassée : ${capa.satures.map(x => `${x.eno} (${x.demande}/${x.capacite}, ${x.manque} places manquantes)`).join(' ; ')}. Changez les dates, répartissez sur d'autres créneaux ou scindez en groupes G1/G2.`,
      conflit: true, capacite: capa,
      groupes_requis: enosNecessitantGroupes(db, { formation_id, promotion_id, niveau }),
    });
  }

  // Jamais un jour férié — toujours bloquant. Les vacances sont bloquantes par
  // défaut, mais l'option est désactivable par le Directeur DES (contrainte_vacances).
  const blk = checkDateBloquee(date_demarrage);
  if (blk.ferie) return res.status(409).json({ error: `Date de démarrage = jour férié (${blk.ferie.libelle}).` });
  if (blk.vacances && getParam(db, 'contrainte_vacances') !== '0') {
    return res.status(409).json({ error: `Date de démarrage pendant les vacances (${blk.vacances.libelle}) — option désactivable par le Directeur DES.` });
  }

  const r = db.prepare(`
    INSERT INTO sessions_examen (annee_id, pole_id, promotion_id, formation_id, niveau, semestre_code,
      session_num, type_evaluation, date_demarrage, date_fin_prevue, heure_debut, heure_fin, groupe, epreuves, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(annee_id, pole_id, promotion_id || null, formation_id || null, niveau || null, semestre_code || null,
    session_num || 1, type_evaluation === 'DEVOIR' ? 'DEVOIR' : 'EVALUATION',
    date_demarrage, date_fin_prevue, heure_debut || null, heure_fin || null, groupe || null, epreuvesJson, req.user.id);

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

  const { date_demarrage, date_fin_prevue, heure_debut, heure_fin, session_num, type_evaluation,
          reception_epreuves, date_programmation, implementation_epreuves, etat_eval,
          delib_etat, date_deliberation, etat, observations, motif, groupe, epreuves } = req.body;
  if (groupe !== undefined && !GROUPES_VALIDES.includes(groupe ?? null)) {
    return res.status(400).json({ error: 'Groupe invalide (G1 ou G2)' });
  }
  let epreuvesJson;
  try { epreuvesJson = normaliseEpreuves(epreuves); } // undefined = inchangé
  catch { return res.status(400).json({ error: 'Format des épreuves invalide' }); }

  const estSuivi = SUIVI_ROLES.includes(req.user.role);
  // Dates : Responsable de formation du pôle (le Responsable pédagogique délibère, il ne crée pas)
  const estRF = req.user.role === 'RESPONSABLE_FORMATION' && req.user.pole_id === prev.pole_id;
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

  // --- Dates / groupe (Responsable de formation ou Chef DFE) : toujours dans les plages ---
  // (changer de groupe modifie la charge de capacité → même contrôle que les dates)
  const changeDates = date_demarrage !== undefined || date_fin_prevue !== undefined
    || heure_debut !== undefined || heure_fin !== undefined || groupe !== undefined;
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

    // Capacité des ENO sur les nouvelles dates / heures
    const capa = conflitCapacite(db, {
      formation_id: prev.formation_id, promotion_id: prev.promotion_id, niveau: prev.niveau,
      date_demarrage: date_demarrage ?? prev.date_demarrage,
      date_fin_prevue: date_fin_prevue ?? prev.date_fin_prevue,
      heure_debut: heure_debut !== undefined ? heure_debut : prev.heure_debut,
      heure_fin: heure_fin !== undefined ? heure_fin : prev.heure_fin,
      groupe: groupe !== undefined ? (groupe || null) : prev.groupe,
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
    if (blk.vacances && getParam(db, 'contrainte_vacances') !== '0') {
      return res.status(409).json({ error: `Vacances (${blk.vacances.libelle}) — option désactivable par le Directeur DES.` });
    }
  }

  db.prepare(`
    UPDATE sessions_examen SET
      date_demarrage=?, date_fin_prevue=?, heure_debut=?, heure_fin=?, groupe=?, epreuves=?, session_num=?, type_evaluation=?,
      reception_epreuves=?, date_programmation=?, implementation_epreuves=?, etat_eval=?,
      delib_etat=?, date_deliberation=?, deliberation=?, etat=?, observations=?, updated_at=datetime('now')
    WHERE id=?
  `).run(
    date_demarrage ?? prev.date_demarrage,
    date_fin_prevue ?? prev.date_fin_prevue,
    heure_debut !== undefined ? (heure_debut || null) : prev.heure_debut,
    heure_fin !== undefined ? (heure_fin || null) : prev.heure_fin,
    groupe !== undefined ? (groupe || null) : prev.groupe,
    epreuvesJson !== undefined ? epreuvesJson : prev.epreuves,
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
      sendEmail({ to: rp.email, subject: '[SUIVI PÉDAGOGIQUE] Évaluations terminées — délibération', html: emailWrapper(rp, 'Délibération à mener', `<p>${msg}</p>`) });
    }
  }

  // Modification des dates par le Responsable pédagogique → le Chef division DFE valide/vérifie
  if (estRF && changeDates) {
    const chefs = db.prepare("SELECT * FROM users WHERE role = 'CHEF_DIV_EVALUATION' AND actif = 1").all();
    const ins = db.prepare('INSERT INTO notifications (user_id, titre, message, type, lien) VALUES (?, ?, ?, ?, ?)');
    for (const c of chefs) {
      const msg = `${req.user.prenom} ${req.user.nom} (Responsable pédagogique) a modifié les dates de « ${refEval} » : ${date_demarrage ?? prev.date_demarrage} → ${date_fin_prevue ?? prev.date_fin_prevue}. Merci de vérifier et valider ce changement.`;
      ins.run(c.id, '📝 Évaluation modifiée — à valider', msg, 'EVALUATION', '/evaluations');
      sendEmail({ to: c.email, subject: '[SUIVI PÉDAGOGIQUE] Évaluation modifiée par le Responsable pédagogique', html: emailWrapper(c, 'Modification à valider', `<p>${msg}</p>`) });
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
/* Suppression : Directeur DFIP, Admin et Chef division DFE (suppression directe).
   Une évaluation DÉLIBÉRÉE reste supprimable uniquement par la Direction.
   Une évaluation ANNULÉE liée au Planning annuel est supprimable : son activité
   de planning est détachée (type neutralisé) pour éviter toute re-création. */
router.delete('/:id', auth, requireRole('DIRECTEUR', 'ADMIN_PORTAIL', 'CHEF_DIV_EVALUATION'), (req, res) => {
  const db = getDb();
  const s = db.prepare('SELECT * FROM sessions_examen WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Évaluation introuvable' });
  if (s.activite_id && s.etat !== 'ANNULE') {
    return res.status(409).json({ error: 'Évaluation liée au Planning annuel : supprimez l\'activité dans le planning.' });
  }
  const estDirection = ['DIRECTEUR', 'ADMIN_PORTAIL'].includes(req.user.role);
  if (!estDirection && s.delib_etat === 'TERMINEE') {
    return res.status(403).json({ error: 'Évaluation délibérée (clôturée) : suppression réservée au Directeur DFIP.' });
  }

  if (s.activite_id) {
    // sous_type = 'DETACHE' : marqueur qui empêche le re-typage rétroactif au démarrage
    db.prepare("UPDATE planning_activites SET type = NULL, sous_type = 'DETACHE' WHERE id = ?").run(s.activite_id);
  }
  db.prepare('DELETE FROM sessions_examen WHERE id = ?').run(req.params.id);
  db.prepare('INSERT INTO audit_logs (user_id, action, module, detail) VALUES (?, ?, ?, ?)')
    .run(req.user.id, 'DELETE_EVALUATION', 'EVALUATIONS', `id=${req.params.id}${s.activite_id ? ` (annulée, activité planning ${s.activite_id} détachée)` : ''}`);
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
