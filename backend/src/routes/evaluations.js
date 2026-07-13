const express = require('express');
const { getDb } = require('../db/connection');
const { auth, requireRole, hasRole } = require('../middleware/auth');
const { notifierConcernes, checkDateBloquee } = require('../services/notify');
const { ROLES_RESTREINTS } = require('../config');

const router = express.Router();

const SESSION_LABEL = { 1: 'Session Normale', 2: 'Session de Rattrapage', 3: 'Session Spéciale' };

// Suivi (réception, implémentation, état, date prévue) : Chef de division DFE
const SUIVI_ROLES = ['CHEF_DIV_EVALUATION', 'DIRECTEUR', 'ADMIN_PORTAIL'];
// Création + dates : Responsables de formation (leur pôle), complétés par le Chef DFE
const CREATE_ROLES = ['RESPONSABLE_FORMATION', ...SUIVI_ROLES];
// Délibérations : Directeurs de pôle (leur pôle) + Directeur/Admin
const DELIB_ROLES = ['RESPONSABLE_POLE', 'DIRECTEUR', 'ADMIN_PORTAIL'];

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

/* ===== Conflit inter-pôles =====
   Règle métier : deux pôles ne doivent JAMAIS avoir des évaluations programmées
   en simultané — ici : chevauchement des périodes démarrage → clôture. */
function conflitsInterPoles(db, { annee_id, pole_id, date_demarrage, date_fin_prevue, exclure_id }) {
  if (!date_demarrage) return [];
  const fin = date_fin_prevue || date_demarrage;
  return db.prepare(`
    SELECT se.id, se.date_demarrage, se.date_fin_prevue, se.session_num, se.type_evaluation,
           p.code as pole_code, p.nom as pole_nom, f.nom as formation_nom
    FROM sessions_examen se
    JOIN poles p ON p.id = se.pole_id
    LEFT JOIN formations f ON f.id = se.formation_id
    WHERE se.annee_id = ?
      AND se.pole_id != ?
      AND se.etat != 'ANNULE'
      AND se.id != ?
      AND se.date_demarrage IS NOT NULL
      AND se.date_demarrage <= ?
      AND COALESCE(se.date_fin_prevue, se.date_demarrage) >= ?
    ORDER BY se.date_demarrage
  `).all(annee_id, pole_id, exclure_id || -1, fin, date_demarrage);
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

// POST /api/evaluations/check-conflit — pré-contrôle du conflit inter-pôles (pour l'UI)
router.post('/check-conflit', auth, (req, res) => {
  const db = getDb();
  const { annee_id, pole_id, date_demarrage, date_fin_prevue, exclure_id } = req.body;
  if (!annee_id || !pole_id || !date_demarrage) return res.json({ conflits: [] });
  res.json({ conflits: conflitsInterPoles(db, { annee_id, pole_id, date_demarrage, date_fin_prevue, exclure_id }) });
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

  // Un responsable de formation (ou pédagogique) ne crée que pour SON pôle
  if (hasRole(req.user, 'RESPONSABLE_FORMATION') && !['CHEF_DIV_EVALUATION', 'DIRECTEUR', 'ADMIN_PORTAIL'].includes(req.user.role)
      && req.user.pole_id !== parseInt(pole_id)) {
    return res.status(403).json({ error: 'Vous ne pouvez renseigner que les évaluations de votre pôle.' });
  }

  // Dates impérativement dans les plages du Planning annuel
  const errPlage = controlePlage(db, req.user, { annee_id, pole_id, date_demarrage, date_fin_prevue });
  if (errPlage) return res.status(422).json({ error: errPlage, hors_plage: true });

  // RÈGLE MÉTIER : jamais deux pôles en évaluation simultanément (chevauchement de périodes)
  const conflits = conflitsInterPoles(db, { annee_id, pole_id, date_demarrage, date_fin_prevue });
  if (conflits.length > 0) {
    const c = conflits[0];
    return res.status(409).json({
      error: `Conflit inter-pôles : le pôle ${c.pole_code} a déjà des évaluations du ${c.date_demarrage} au ${c.date_fin_prevue || c.date_demarrage}. Deux pôles ne peuvent pas être en évaluation simultanément — changez les dates.`,
      conflit: true,
      conflits,
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
  const estRF = hasRole(req.user, 'RESPONSABLE_FORMATION') && req.user.pole_id === prev.pole_id;
  const estDP = hasRole(req.user, 'RESPONSABLE_POLE') && req.user.pole_id === prev.pole_id;
  const estDirection = ['DIRECTEUR', 'ADMIN_PORTAIL'].includes(req.user.role);

  // --- Champs de suivi (Chef de division DFE) ---
  const changeSuivi = [reception_epreuves, date_programmation, implementation_epreuves, etat_eval, etat, observations, session_num, type_evaluation]
    .some(v => v !== undefined);
  if (changeSuivi && !estSuivi) {
    return res.status(403).json({ error: 'Le suivi des évaluations est réservé au Chef de division DFE.' });
  }

  // --- Dates (Responsable de formation ou Chef DFE) : toujours dans les plages ---
  const changeDates = date_demarrage !== undefined || date_fin_prevue !== undefined;
  if (changeDates) {
    if (!estSuivi && !estRF) return res.status(403).json({ error: 'Les dates sont renseignées par le responsable de formation.' });
    const errPlage = controlePlage(db, req.user, {
      annee_id: prev.annee_id, pole_id: prev.pole_id,
      date_demarrage: date_demarrage ?? prev.date_demarrage,
      date_fin_prevue: date_fin_prevue ?? prev.date_fin_prevue,
    });
    if (errPlage) return res.status(422).json({ error: errPlage, hors_plage: true });

    // Conflit inter-pôles sur les nouvelles dates
    const conflits = conflitsInterPoles(db, {
      annee_id: prev.annee_id, pole_id: prev.pole_id,
      date_demarrage: date_demarrage ?? prev.date_demarrage,
      date_fin_prevue: date_fin_prevue ?? prev.date_fin_prevue,
      exclure_id: prev.id,
    });
    if (conflits.length > 0) {
      const c = conflits[0];
      return res.status(409).json({
        error: `Conflit inter-pôles : le pôle ${c.pole_code} a déjà des évaluations du ${c.date_demarrage} au ${c.date_fin_prevue || c.date_demarrage}. Changez les dates.`,
        conflit: true,
        conflits,
      });
    }
  }

  // --- Délibérations (Directeurs de pôle, après « Évaluations terminées ») ---
  const changeDelib = delib_etat !== undefined || date_deliberation !== undefined;
  if (changeDelib) {
    if (!estDP && !estDirection) {
      return res.status(403).json({ error: 'Les délibérations sont renseignées par le Directeur de pôle.' });
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
router.delete('/:id', auth, requireRole('DIRECTEUR', 'ADMIN_PORTAIL'), (req, res) => {
  getDb().prepare('DELETE FROM sessions_examen WHERE id = ?').run(req.params.id);
  res.json({ message: 'Évaluation supprimée' });
});

module.exports = router;
