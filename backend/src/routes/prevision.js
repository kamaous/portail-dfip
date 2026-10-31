const express = require('express');
const { getDb } = require('../db/connection');
const { auth, hasRole } = require('../middleware/auth');
const { checkDateBloquee } = require('../services/notify');
const { getParam } = require('./parametres');

/* ===== Module PRÉVISION =====
   Anticipe, pour chaque cohorte (pôle × promotion × niveau) et chacune de ses
   formations, les prochaines étapes de chaque semestre : fiche de tutorat,
   évaluation en session normale (SN) et session de rattrapage (SR).

   Les dates proposées viennent, dans l'ordre :
     1. du Planning annuel (plages « Tutorat Sx », « Sx SN », « Sx SR » du segment
        du pôle, ligne du niveau) ;
     2. sinon, de l'étape précédente (déjà créée ou elle-même proposée) + les écarts
        observés dans le planning, ou les durées réelles médianes.
   Le module ne crée rien lui-même : la page appelle les routes habituelles
   (POST /api/tutorat, POST /api/evaluations), avec tous leurs contrôles. */

const router = express.Router();

const POLE_SEGMENT = { SEJA: 'PSEJA', STN: 'PSTN', LSHE: 'PLSHE' };
const NIVEAU_LIGNE = { L1: 'Licence 1', L2: 'Licence 2', L3: 'Licence 3', M1: 'Master 1', M2: 'Master 2' };
const SEMESTRES_NIVEAU = { L1: ['S1', 'S2'], L2: ['S3', 'S4'], L3: ['S5', 'S6'], M1: ['S1', 'S2'], M2: ['S3', 'S4'] };
const NIVEAUX_ORDRE = ['L1', 'L2', 'L3', 'M1', 'M2'];
// Rôles qui créent (mêmes listes que les routes tutorat / évaluations)
const CREE_TUTORAT = ['RESPONSABLE_FORMATION', 'CHEF_DIV_TECHNOPEDAGOGIE', 'DIRECTEUR', 'ADMIN_PORTAIL'];
const CREE_EVAL = ['RESPONSABLE_FORMATION', 'CHEF_DIV_EVALUATION', 'DIRECTEUR', 'ADMIN_PORTAIL'];
// Rôles limités à leur pôle
const ROLES_POLE = ['RESPONSABLE_FORMATION', 'RESPONSABLE_PEDAGOGIQUE', 'RESPONSABLE_POLE'];

/* ---- Dates (chaînes AAAA-MM-JJ, calcul en UTC pour éviter les décalages) ---- */
const jour = (s) => new Date(`${s}T00:00:00Z`);
const iso = (d) => d.toISOString().slice(0, 10);
const plus = (s, n) => { const d = jour(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const ecart = (a, b) => Math.round((jour(b) - jour(a)) / 86400000);
const max = (...l) => l.filter(Boolean).sort().pop();
const mediane = (l, defaut) => {
  const v = l.filter(n => Number.isFinite(n)).sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : defaut;
};

/* Premier jour d'examen possible à partir de `s` : pas de week-end, jamais un jour
   férié, pas de vacances si la contrainte est active (paramètre du Directeur DES). */
function jourExamen(s, vacancesBloquantes) {
  let d = s;
  for (let i = 0; i < 60; i++) {
    const wd = jour(d).getUTCDay();
    const b = checkDateBloquee(d);
    if (wd !== 0 && wd !== 6 && !b.ferie && !(b.vacances && vacancesBloquantes)) return d;
    d = plus(d, 1);
  }
  return s;
}

/* Plage du planning pour une étape : celle qui n'est pas encore terminée (la plus
   proche), sinon la plus récente. */
function choisirPlage(plages, aujourdhui) {
  if (!plages.length) return null;
  const aVenir = plages.filter(p => p.date_fin >= aujourdhui).sort((a, b) => a.date_debut.localeCompare(b.date_debut));
  return aVenir[0] || [...plages].sort((a, b) => b.date_fin.localeCompare(a.date_fin))[0];
}

/* Analyse d'un libellé du planning : « Tutorat S2 » → TUTORAT/S2 ; « S3 SN » → SN/S3 */
function etapeDuLibelle(a) {
  const sem = (a.libelle.match(/S\s?(\d{1,2})/i) || [])[1];
  if (!sem) return null;
  if (a.type === 'TUTORAT') return { etape: 'TUTORAT', semestre: `S${sem}` };
  if (a.type === 'EVALUATIONS') {
    if (/\bSR\b|rattrap/i.test(a.libelle)) return { etape: 'SR', semestre: `S${sem}` };
    return { etape: 'SN', semestre: `S${sem}` };
  }
  return null;
}

/* Écarts typiques, mesurés dans le planning (sinon valeurs par défaut) et durées
   réelles médianes (tutorat, examens). */
function parametresEstimation(db, plagesParCle, annee_id) {
  const gTutSN = [], gSNSR = [], gTutTut = [];
  for (const [cle, p] of Object.entries(plagesParCle)) {
    const [seg, ligne, etape, sem] = cle.split('|');
    if (etape !== 'TUTORAT') continue;
    const n = +sem.slice(1);
    for (const t of p) {
      const sn = (plagesParCle[`${seg}|${ligne}|SN|${sem}`] || []).find(x => x.date_debut >= t.date_fin);
      if (sn) {
        gTutSN.push(ecart(t.date_fin, sn.date_debut));
        const sr = (plagesParCle[`${seg}|${ligne}|SR|${sem}`] || []).find(x => x.date_debut >= sn.date_fin);
        if (sr) gSNSR.push(ecart(sn.date_fin, sr.date_debut));
      }
      const suiv = (plagesParCle[`${seg}|${ligne}|TUTORAT|S${n + 1}`] || []).find(x => x.date_debut >= t.date_fin);
      if (suiv) gTutTut.push(ecart(t.date_fin, suiv.date_debut));
    }
  }
  const tut = db.prepare(`SELECT date_debut, date_fin FROM tutorat WHERE formation_id IS NOT NULL
    AND date_debut IS NOT NULL AND date_fin >= date_debut AND annee_id = ?`).all(annee_id);
  const ev = db.prepare(`SELECT date_demarrage d, date_fin_prevue f FROM sessions_examen WHERE formation_id IS NOT NULL
    AND type_evaluation = 'EVALUATION' AND etat != 'ANNULE' AND date_demarrage IS NOT NULL
    AND date_fin_prevue >= date_demarrage AND annee_id = ?`).all(annee_id);
  return {
    duree_tutorat: Math.max(28, mediane(tut.map(t => ecart(t.date_debut, t.date_fin) + 1), 84)),
    duree_examen: Math.min(10, Math.max(1, mediane(ev.map(e => ecart(e.d, e.f) + 1), 3))),
    // bornés pour rester raisonnables quand le planning est irrégulier
    ecart_tutorat_sn: Math.min(30, Math.max(3, mediane(gTutSN, 7))),
    ecart_sn_sr: Math.min(60, Math.max(14, mediane(gSNSR, 21))),
    ecart_tutorat_tutorat: Math.min(30, Math.max(1, mediane(gTutTut, 7))),
    jours_avant_reception: 10,   // épreuves reçues au plus tard 10 jours avant l'examen
    jours_avant_deliberation: 14, // délibération environ 2 semaines après la fin
  };
}

// GET /api/prevision — propositions pour l'année active (ou ?annee_id=)
router.get('/', auth, (req, res) => {
  const db = getDb();
  const annee = req.query.annee_id
    ? db.prepare('SELECT * FROM annees_academiques WHERE id = ?').get(req.query.annee_id)
    : db.prepare('SELECT * FROM annees_academiques WHERE active = 1 LIMIT 1').get();
  if (!annee) return res.json({ annee: null, poles: [], institutionnel: [], parametres: {} });

  const aujourdhui = iso(new Date());
  const vacancesBloquantes = getParam(db, 'contrainte_vacances') !== '0';
  const prochainOuvre = jourExamen(plus(aujourdhui, 1), false);

  /* -- Plages du planning, indexées « segment|ligne|étape|semestre » -- */
  const plagesParCle = {};
  for (const a of db.prepare(`SELECT * FROM planning_activites WHERE annee_id = ? AND type IN ('TUTORAT','EVALUATIONS')`).all(annee.id)) {
    const e = etapeDuLibelle(a);
    if (!e) continue;
    (plagesParCle[`${a.segment}|${a.ligne}|${e.etape}|${e.semestre}`] ||= []).push(a);
  }
  const P = parametresEstimation(db, plagesParCle, annee.id);

  /* -- Périmètre : rôles de pôle → leur pôle seulement -- */
  const limitePole = ROLES_POLE.some(r => hasRole(req.user, r)) && req.user.role !== 'ADMIN_PORTAIL' ? req.user.pole_id : null;
  const poles = db.prepare('SELECT id, code, nom FROM poles ORDER BY id').all()
    .filter(p => POLE_SEGMENT[p.code] && (!limitePole || p.id === limitePole));

  /* -- Existant (fiches et évaluations de formation de l'année) -- */
  const tutorats = db.prepare(`
    SELECT id, pole_id, promotion_id, formation_id, niveau, semestre_code, date_debut, date_fin, statut_fiche
    FROM tutorat WHERE annee_id = ? AND formation_id IS NOT NULL AND COALESCE(statut_fiche,'') != 'REJETEE'
  `).all(annee.id);
  const evals = db.prepare(`
    SELECT id, pole_id, promotion_id, formation_id, niveau, semestre_code, session_num,
           date_demarrage, date_fin_prevue, etat, etat_eval, groupe
    FROM sessions_examen WHERE annee_id = ? AND formation_id IS NOT NULL
      AND type_evaluation = 'EVALUATION' AND etat != 'ANNULE'
  `).all(annee.id);
  const formations = Object.fromEntries(db.prepare('SELECT id, code, nom FROM formations').all().map(f => [f.id, f]));
  const promotions = Object.fromEntries(db.prepare('SELECT id, code FROM promotions').all().map(p => [p.id, p]));

  const peutTutorat = (pole) => CREE_TUTORAT.includes(req.user.role) && (req.user.role !== 'RESPONSABLE_FORMATION' || req.user.pole_id === pole.id);
  const peutEval = (pole) => CREE_EVAL.includes(req.user.role) && (req.user.role !== 'RESPONSABLE_FORMATION' || req.user.pole_id === pole.id);

  const resultat = poles.map(pole => {
    const seg = POLE_SEGMENT[pole.code];
    // Cohortes : (promotion, niveau) ayant déjà au moins une fiche ou une évaluation de formation
    const cohortes = {};
    for (const x of [...tutorats, ...evals].filter(x => x.pole_id === pole.id && x.promotion_id && NIVEAU_LIGNE[x.niveau])) {
      const c = (cohortes[`${x.promotion_id}|${x.niveau}`] ||= { promotion_id: x.promotion_id, niveau: x.niveau, formations: new Set() });
      c.formations.add(x.formation_id);
    }

    const listeCohortes = Object.values(cohortes).map(c => {
      const ligne = NIVEAU_LIGNE[c.niveau];
      // Semestres du niveau (+ ceux déjà utilisés) ; le S4 de Master 2 seulement s'il existe quelque part
      const semestres = [...new Set([...SEMESTRES_NIVEAU[c.niveau],
        ...[...tutorats, ...evals].filter(x => x.pole_id === pole.id && x.promotion_id === c.promotion_id && x.niveau === c.niveau).map(x => x.semestre_code)])]
        .filter(s => s && (c.niveau !== 'M2' || s !== 'S4'
          || plagesParCle[`${seg}|${ligne}|TUTORAT|S4`] || plagesParCle[`${seg}|${ligne}|SN|S4`]
          || [...tutorats, ...evals].some(x => x.pole_id === pole.id && x.promotion_id === c.promotion_id && x.semestre_code === 'S4')))
        .sort((a, b) => +a.slice(1) - +b.slice(1));

      const formationsListe = [...c.formations].map(id => formations[id]).filter(Boolean)
        .sort((a, b) => (a.code || a.nom).localeCompare(b.code || b.nom));

      // Chaîne de dates par formation, semestre après semestre
      const finTutoratPrec = {}; // formation_id → fin du tutorat du semestre précédent (réel ou proposé)
      const semestresSortie = semestres.map(sem => {
        const plage = (etape) => {
          const p = choisirPlage(plagesParCle[`${seg}|${ligne}|${etape}|${sem}`] || [], aujourdhui);
          return p ? { date_debut: p.date_debut, date_fin: p.date_fin, libelle: p.libelle } : null;
        };
        const plTut = plage('TUTORAT'), plSN = plage('SN'), plSR = plage('SR');

        const lignes = formationsListe.map(f => {
          const cle = x => x.pole_id === pole.id && x.promotion_id === c.promotion_id && x.formation_id === f.id && x.semestre_code === sem;
          const etapes = [];

          /* 1. Fiche de tutorat */
          const tExist = tutorats.filter(cle).sort((a, b) => (a.date_debut || '').localeCompare(b.date_debut || ''))[0];
          let tutFin;
          if (tExist) {
            etapes.push({ etape: 'TUTORAT', statut: 'CREE', existant: { id: tExist.id, debut: tExist.date_debut, fin: tExist.date_fin, statut_fiche: tExist.statut_fiche } });
            tutFin = tExist.date_fin;
          } else {
            const prec = finTutoratPrec[f.id];
            let debut, source;
            if (plTut) { debut = plTut.date_debut; source = `Planning annuel : ${plTut.libelle} (${plTut.date_debut} → ${plTut.date_fin})`; }
            else if (prec) { debut = plus(prec, P.ecart_tutorat_tutorat); source = `Estimée : fin du tutorat précédent + ${P.ecart_tutorat_tutorat} j`; }
            else { debut = prochainOuvre; source = 'Estimée : aucune plage au planning ni étape précédente'; }
            debut = max(debut, prochainOuvre, prec ? plus(prec, 1) : null);
            const finPlage = plTut && plTut.date_fin >= plus(debut, 27) ? plTut.date_fin : null;
            const fin = finPlage || plus(debut, P.duree_tutorat - 1);
            if (!finPlage && plTut) source += ` — fin estimée (${Math.round(P.duree_tutorat / 7)} semaines)`;
            etapes.push({
              etape: 'TUTORAT', statut: plTut && plTut.date_fin < aujourdhui ? 'EN_RETARD' : 'A_CREER',
              proposition: { debut, fin, source, hors_plage: !!plTut && (debut < plTut.date_debut || fin > plTut.date_fin) },
            });
            tutFin = fin;
          }
          finTutoratPrec[f.id] = tutFin;

          /* 2. et 3. Évaluations : session normale puis rattrapage */
          let finPrec = tutFin;
          for (const [etape, num, pl, ecartDef, libEcart] of [
            ['SN', 1, plSN, P.ecart_tutorat_sn, 'fin du tutorat'],
            ['SR', 2, plSR, P.ecart_sn_sr, 'fin de la session normale'],
          ]) {
            const eExist = evals.filter(x => cle(x) && x.session_num === num).sort((a, b) => (a.date_demarrage || '').localeCompare(b.date_demarrage || ''));
            if (eExist.length) {
              const d = eExist[0].date_demarrage, fn = eExist.map(e => e.date_fin_prevue).sort().pop();
              etapes.push({ etape, statut: 'CREE', existant: { id: eExist[0].id, debut: d, fin: fn, etat_eval: eExist[0].etat_eval, groupes: eExist.length } });
              finPrec = fn || finPrec;
              continue;
            }
            // Jamais avant « étape précédente + écart typique », même si la plage du planning est plus tôt
            const auPlusTot = plus(finPrec, ecartDef);
            let debut, source;
            if (pl && pl.date_debut >= auPlusTot) { debut = pl.date_debut; source = `Planning annuel : ${pl.libelle} (${pl.date_debut} → ${pl.date_fin})`; }
            else if (pl) { debut = auPlusTot; source = `Planning annuel : ${pl.libelle} (${pl.date_debut} → ${pl.date_fin}) trop tôt — décalée après la ${libEcart} + ${ecartDef} j`; }
            else { debut = auPlusTot; source = `Estimée : ${libEcart} + ${ecartDef} j`; }
            debut = jourExamen(max(debut, prochainOuvre), vacancesBloquantes);
            let fin = plus(debut, P.duree_examen - 1);
            if (pl && fin > pl.date_fin && debut <= pl.date_fin) fin = pl.date_fin;
            etapes.push({
              etape, statut: pl && pl.date_fin < aujourdhui ? 'EN_RETARD' : 'A_CREER',
              proposition: {
                debut, fin, source,
                hors_plage: !!pl && (debut < pl.date_debut || fin > pl.date_fin),
                reception_epreuves: plus(debut, -P.jours_avant_reception),
                deliberation: plus(fin, P.jours_avant_deliberation),
              },
            });
            finPrec = fin;
          }
          return { formation: f, etapes };
        });
        return { semestre: sem, plages: { TUTORAT: plTut, SN: plSN, SR: plSR }, formations: lignes };
      });

      return {
        promotion_id: c.promotion_id, promotion: promotions[c.promotion_id]?.code || '—',
        niveau: c.niveau, semestres: semestresSortie,
      };
    }).sort((a, b) => b.promotion.localeCompare(a.promotion, 'fr', { numeric: true })
      || NIVEAUX_ORDRE.indexOf(a.niveau) - NIVEAUX_ORDRE.indexOf(b.niveau));

    return {
      id: pole.id, code: pole.code, nom: pole.nom, segment: seg,
      droits: { tutorat: peutTutorat(pole), evaluation: peutEval(pole) },
      cohortes: listeCohortes,
    };
  });

  /* -- Calendrier institutionnel à venir (Rectorat, DFIP & DES) : 120 jours -- */
  const institutionnel = db.prepare(`
    SELECT id, segment, ligne, libelle, date_debut, date_fin FROM planning_activites
    WHERE annee_id = ? AND segment IN ('RECTORAT','DFIP_DES') AND date_fin >= ? AND date_debut <= ?
    ORDER BY date_debut
  `).all(annee.id, aujourdhui, plus(aujourdhui, 120));

  res.json({ annee, aujourdhui, parametres: P, poles: resultat, institutionnel });
});

module.exports = router;
