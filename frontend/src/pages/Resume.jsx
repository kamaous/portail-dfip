import { useEffect, useMemo, useState } from 'react';
import api from '../lib/api';
import { BookOpen, ClipboardCheck, FlaskConical, Gavel, RefreshCw } from 'lucide-react';
import { progressionDates } from './Tutorat';

/* Module RÉSUMÉ — inspiré du classeur « Calendrier académique UN-CHK » :
   - Volets Tutorat / Évaluations (filtre principal)
   - Onglets SEJA / STN / LSHE : « SUIVI DE L'EXÉCUTION » du pôle, par niveau
     (filtres Promotion + Semestre)
   - Onglet DFIP : « Suivi de la programmation des évaluations »
     (filtres Promotion + Semestre + Programme + Statut du suivi)              */

const POLES_SEG = {
  SEJA: { color: '#ea580c', light: '#fdeee3' },
  STN: { color: '#16a34a', light: '#e8f6ec' },
  LSHE: { color: '#6d28d9', light: '#f0e9fb' },
  DFIP: { color: '#1e3a5f', light: '#e8eef5' },
};
const NIVEAUX_ORDRE = ['L1', 'L2', 'L3', 'M1', 'M2'];
const NIVEAU_LABEL = { L1: 'LICENCE 1', L2: 'LICENCE 2', L3: 'LICENCE 3', M1: 'MASTER 1', M2: 'MASTER 2' };
const ETAT_TUT = {
  PAS_DEMARRE: ['En attente de démarrage', 'bg-slate-100 text-slate-600'],
  EN_COURS: ['En cours', 'bg-blue-100 text-blue-700'],
  TERMINE: ['Terminé', 'bg-green-100 text-green-700'],
};
const SESSION_LABEL = { 1: 'Normale', 2: 'Rattrapage', 3: 'Spéciale' };
const STATUTS_SUIVI = ['Examen à programmer', 'Examen programmé', 'Évaluations en cours', 'Examen terminé', 'Terminé et délibéré', 'Examen annulé'];

const progTut = progressionDates; // progression du tutorat basée sur les dates début → fin
/* Progression d'une évaluation : 5 jalons (programmée, épreuves reçues,
   implémentées, évaluations terminées, délibérée) */
const progEval = (e) => [
  !!e.date_programmation,
  e.reception_epreuves === 'TOTALE',
  e.implementation_epreuves === 'TERMINE',
  e.etat_eval === 'EVAL_TERMINEES',
  e.delib_etat === 'TERMINEE',
].filter(Boolean).length / 5;

const fmtSemestre = (x) => x.niveau && x.semestre_code ? `${x.niveau}-Semestre ${x.semestre_code.replace('S', '')}` : (x.semestre_code || '—');
const nomProgramme = (x) => x.formation_code || x.formation_nom || (x.pole_code ? `${x.pole_code} (pôle)` : '(pôle entier)');

/* Statut du suivi (colonne DFIP), déduit de l'état réel de l'évaluation */
function statutSuivi(e) {
  if (e.etat === 'ANNULE') return ['Examen annulé', 'bg-red-100 text-red-700'];
  if (e.delib_etat === 'TERMINEE') return ['Terminé et délibéré', 'bg-green-100 text-green-700'];
  if (e.etat_eval === 'EVAL_TERMINEES') return ['Examen terminé', 'bg-emerald-100 text-emerald-700'];
  if (e.etat_eval === 'EVAL_EN_COURS') return ['Évaluations en cours', 'bg-amber-100 text-amber-700'];
  if (e.date_programmation) return ['Examen programmé', 'bg-blue-100 text-blue-700'];
  return ['Examen à programmer', 'bg-slate-100 text-slate-600'];
}

function Barre({ pct }) {
  const c = pct >= 1 ? 'bg-green-500' : pct >= 0.6 ? 'bg-blue-500' : pct >= 0.3 ? 'bg-amber-500' : 'bg-red-400';
  return (
    <div className="flex items-center gap-2 min-w-28">
      <div className="h-2 bg-slate-100 rounded-full overflow-hidden flex-1">
        <div className={`h-full rounded-full transition-all duration-500 ${c}`} style={{ width: `${Math.round(pct * 100)}%` }} />
      </div>
      <span className="text-xs font-bold text-slate-600 w-9 text-right">{Math.round(pct * 100)}%</span>
    </div>
  );
}

function Filtre({ value, onChange, children }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      className={`!w-auto !py-1.5 !text-xs ${value ? '!border-blue-400 !bg-blue-50 font-semibold' : ''}`}>
      {children}
    </select>
  );
}

export default function Resume() {
  const [tutorats, setTutorats] = useState([]);
  const [evals, setEvals] = useState([]);
  const [poles, setPoles] = useState([]);
  const [incidents, setIncidents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [onglet, setOnglet] = useState('SEJA');
  const [volet, setVolet] = useState('TUTORAT'); // TUTORAT | EVALUATIONS (onglets pôles)
  const [fPromo, setFPromo] = useState('');
  const [fSem, setFSem] = useState('');
  const [fProg, setFProg] = useState('');      // DFIP : programme
  const [fStatut, setFStatut] = useState('');  // DFIP : statut du suivi

  function load() {
    setLoading(true);
    Promise.all([
      api.get('/tutorat'), api.get('/evaluations'), api.get('/poles'),
      api.get('/incidents').catch(() => ({ data: [] })),
    ]).then(([t, e, p, i]) => {
      setTutorats(t.data.filter(x => x.statut_fiche !== 'REJETEE'));
      setEvals(e.data);
      setPoles(p.data);
      setIncidents(i.data);
    }).finally(() => setLoading(false));
  }
  useEffect(load, []);

  const promotions = useMemo(() =>
    [...new Set([...tutorats, ...evals].map(x => x.promotion_code).filter(Boolean))].sort(), [tutorats, evals]);
  const semestres = useMemo(() =>
    [...new Set([...tutorats, ...evals].map(x => x.semestre_code).filter(Boolean))].sort(), [tutorats, evals]);
  const programmes = useMemo(() =>
    [...new Set(evals.map(nomProgramme))].sort(), [evals]);

  const okPromoSem = (x) => (!fPromo || x.promotion_code === fPromo) && (!fSem || x.semestre_code === fSem);
  const tutoratsF = useMemo(() => tutorats.filter(okPromoSem), [tutorats, fPromo, fSem]);
  const evalsF = useMemo(() => evals.filter(okPromoSem), [evals, fPromo, fSem]);
  // DFIP : filtres supplémentaires Programme + Statut du suivi
  const evalsDfip = useMemo(() => evalsF.filter(e =>
    (!fProg || nomProgramme(e) === fProg) && (!fStatut || statutSuivi(e)[0] === fStatut)), [evalsF, fProg, fStatut]);

  const pole = poles.find(p => p.code === onglet);
  const seg = POLES_SEG[onglet] || POLES_SEG.DFIP;
  const estDfip = onglet === 'DFIP';
  const voletEval = estDfip || volet === 'EVALUATIONS';

  /* ===== Données onglet pôle (volet Tutorat ou Évaluations) ===== */
  const itemsPole = voletEval
    ? evalsF.filter(e => e.pole_code === onglet)
    : tutoratsF.filter(t => t.pole_code === onglet);
  const parNiveau = NIVEAUX_ORDRE
    .map(niv => ({ niv, items: itemsPole.filter(x => x.niveau === niv) }))
    .filter(g => g.items.length > 0);
  const sansNiveau = itemsPole.filter(x => !NIVEAUX_ORDRE.includes(x.niveau));
  const majPole = itemsPole.reduce((m, x) => ((x.updated_at || x.created_at || '') > m ? (x.updated_at || x.created_at) : m), '');

  /* ===== Données onglet DFIP : programmation des évaluations ===== */
  const evalsProg = [...evalsDfip].sort((a, b) => {
    const da = a.date_programmation || a.date_demarrage || '9999';
    const db_ = b.date_programmation || b.date_demarrage || '9999';
    return da.localeCompare(db_);
  });
  const nbProgrammees = evalsDfip.filter(e => e.date_programmation).length;
  const nbTerminees = evalsDfip.filter(e => e.etat_eval === 'EVAL_TERMINEES').length;
  const nbDeliberees = evalsDfip.filter(e => e.delib_etat === 'TERMINEE').length;
  const nbReportees = incidents.filter(i => i.conseq_eval === 'REPORT').length;
  /* Encart : programmes en cours avec leur taux d'exécution (tutorat en cours) */
  const enCours = tutoratsF.filter(t => t.etat_tutorat === 'EN_COURS')
    .sort((a, b) => progTut(b) - progTut(a)).slice(0, 6);

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Résumé — Suivi de l'exécution</h1>
          <p className="text-slate-500 text-sm">Remontée des activités par pôle et suivi de la programmation des évaluations (DFIP)</p>
        </div>
        <button onClick={load} className="btn-secondary flex items-center gap-2"><RefreshCw size={15} /> Actualiser</button>
      </div>

      {/* Onglets façon classeur + volets + filtres */}
      <div className="card !p-3 space-y-2.5">
        <div className="flex flex-wrap items-center gap-2">
          {['SEJA', 'STN', 'LSHE', 'DFIP'].map(k => {
            const s = POLES_SEG[k];
            const actif = onglet === k;
            return (
              <button key={k} onClick={() => setOnglet(k)}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold border-2 transition-all ${actif ? 'text-white shadow-md scale-105' : 'bg-white hover:scale-[1.02]'}`}
                style={actif ? { background: s.color, borderColor: s.color } : { color: s.color, borderColor: `${s.color}55` }}>
                {k === 'DFIP' ? <ClipboardCheck size={15} /> : <BookOpen size={15} />} {k}
              </button>
            );
          })}

          {/* Volets Tutorat / Évaluations (onglets pôles uniquement) */}
          {!estDfip && (
            <div className="flex rounded-xl border border-slate-200 overflow-hidden ml-1">
              {[['TUTORAT', BookOpen, 'Tutorat'], ['EVALUATIONS', FlaskConical, 'Évaluations']].map(([v, Icon, label]) => (
                <button key={v} onClick={() => setVolet(v)}
                  className={`flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium transition-colors ${volet === v ? 'bg-[#1e3a5f] text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
                  <Icon size={14} /> {label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Filtres :</span>
          <Filtre value={fPromo} onChange={setFPromo}>
            <option value="">Toutes promotions</option>
            {promotions.map(p => <option key={p} value={p}>{p}</option>)}
          </Filtre>
          <Filtre value={fSem} onChange={setFSem}>
            <option value="">Tous semestres</option>
            {semestres.map(s => <option key={s} value={s}>{s}</option>)}
          </Filtre>
          {estDfip && (
            <>
              <Filtre value={fProg} onChange={setFProg}>
                <option value="">Tous programmes</option>
                {programmes.map(p => <option key={p} value={p}>{p}</option>)}
              </Filtre>
              <Filtre value={fStatut} onChange={setFStatut}>
                <option value="">Tous statuts du suivi</option>
                {STATUTS_SUIVI.map(s => <option key={s} value={s}>{s}</option>)}
              </Filtre>
            </>
          )}
          {(fPromo || fSem || fProg || fStatut) && (
            <button onClick={() => { setFPromo(''); setFSem(''); setFProg(''); setFStatut(''); }}
              className="text-xs text-blue-600 hover:underline">Réinitialiser</button>
          )}
        </div>
      </div>

      {!estDfip ? (
        /* ================== ONGLET PÔLE : SUIVI DE L'EXÉCUTION ================== */
        <div className="card !p-0 overflow-hidden">
          <div className="px-5 py-4 text-white" style={{ background: `linear-gradient(135deg, ${seg.color}, ${seg.color}cc)` }}>
            <p className="text-[11px] font-bold uppercase tracking-wider text-white/70">
              Suivi de l'exécution — {voletEval ? 'évaluations' : 'tutorat'}
            </p>
            <h2 className="font-bold text-lg leading-tight">{pole?.nom || onglet}</h2>
            <div className="flex flex-wrap gap-x-6 gap-y-1 mt-1.5 text-xs text-white/85">
              <span>Responsable pédagogique : <strong>{pole?.responsable_pedagogique ? `${pole.responsable_pedagogique.prenom} ${pole.responsable_pedagogique.nom}` : '—'}</strong></span>
              <span>Dernière mise à jour : <strong>{majPole ? majPole.slice(0, 16) : '—'}</strong></span>
              <span>{itemsPole.length} {voletEval ? 'évaluation(s)' : 'programme(s)'} suivi(s)</span>
            </div>
          </div>

          <div className="overflow-x-auto nav-scroll">
            <table className="w-full text-sm min-w-[760px]">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="text-left px-4 py-2.5 table-header">État</th>
                  <th className="text-left px-4 py-2.5 table-header">Semestre</th>
                  <th className="text-left px-4 py-2.5 table-header">Date de début</th>
                  <th className="text-left px-4 py-2.5 table-header">Date de fin</th>
                  <th className="text-left px-4 py-2.5 table-header">Programme</th>
                  <th className="text-left px-4 py-2.5 table-header w-44">Progression</th>
                </tr>
              </thead>
              <tbody>
                {[...parNiveau, ...(sansNiveau.length ? [{ niv: null, items: sansNiveau }] : [])].map(({ niv, items }) => {
                  const prog = voletEval ? progEval : progTut;
                  const pctNiv = items.reduce((s, x) => s + prog(x), 0) / items.length;
                  const termines = voletEval
                    ? items.filter(e => e.etat_eval === 'EVAL_TERMINEES' || e.delib_etat === 'TERMINEE').length
                    : items.filter(t => t.etat_tutorat === 'TERMINE').length;
                  return [
                    /* Ligne d'agrégat du niveau (comme la ligne LICENCE 1 du classeur) */
                    <tr key={`niv-${niv}`} style={{ background: seg.light }}>
                      <td colSpan={4} className="px-4 py-2 font-bold text-sm" style={{ color: seg.color }}>
                        {niv ? NIVEAU_LABEL[niv] : 'AUTRES'}
                      </td>
                      <td className="px-4 py-2 text-xs font-semibold" style={{ color: seg.color }}>
                        {items.length} {voletEval ? 'évaluation(s)' : 'programme(s)'} · {termines} terminé(s)
                      </td>
                      <td className="px-4 py-2"><Barre pct={pctNiv} /></td>
                    </tr>,
                    ...items.map(x => {
                      const [lbl, cls] = voletEval ? statutSuivi(x) : (ETAT_TUT[x.etat_tutorat] || ETAT_TUT.PAS_DEMARRE);
                      const debut = voletEval ? x.date_demarrage : x.date_debut;
                      const fin = voletEval ? x.date_fin_prevue : x.date_fin;
                      return (
                        <tr key={x.id} className="border-b border-slate-50 hover:bg-slate-50/60">
                          <td className="px-4 py-2">
                            <span className={`badge ${cls} text-[11px]`}>{lbl}</span>
                            {voletEval && x.delib_etat === 'TERMINEE' && <Gavel size={12} className="inline ml-1.5 text-green-600" />}
                          </td>
                          <td className="px-4 py-2 text-slate-600 whitespace-nowrap">{fmtSemestre(x)}</td>
                          <td className="px-4 py-2 text-slate-600 whitespace-nowrap tabular-nums">{debut || '—'}</td>
                          <td className="px-4 py-2 text-slate-600 whitespace-nowrap tabular-nums">{fin || '—'}</td>
                          <td className="px-4 py-2">
                            <span className="font-medium text-slate-800" title={x.formation_nom || ''}>{nomProgramme(x)}</span>
                            {x.promotion_code && <span className="text-xs text-slate-400"> · {x.promotion_code}</span>}
                            {voletEval && <span className="text-xs text-slate-400"> · S{x.session_num} {SESSION_LABEL[x.session_num]}</span>}
                            {voletEval && x.type_evaluation === 'DEVOIR' && <span className="badge bg-cyan-100 text-cyan-700 text-[10px] ml-1.5">Devoir</span>}
                            {x.activite_id && <span title="Issue du planning annuel"> 🔗</span>}
                          </td>
                          <td className="px-4 py-2"><Barre pct={voletEval ? progEval(x) : progTut(x)} /></td>
                        </tr>
                      );
                    }),
                  ];
                })}
                {itemsPole.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400">
                    Aucune {voletEval ? 'évaluation' : 'fiche de tutorat'} pour ce pôle avec ces filtres
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* ================== ONGLET DFIP : PROGRAMMATION DES ÉVALUATIONS ================== */
        <>
          <div className="card !p-0 overflow-hidden">
            <div className="px-5 py-4 text-white" style={{ background: 'linear-gradient(135deg, #1e3a5f, #2563eb)' }}>
              <p className="text-[11px] font-bold uppercase tracking-wider text-white/70">Suivi de la programmation des évaluations</p>
              <h2 className="font-bold text-lg leading-tight">Direction de la Formation et de l'Ingénierie pédagogique (DFIP)</h2>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mt-3">
                {[['Effectif', evalsDfip.length], ['Programmées', nbProgrammees], ['Terminées', nbTerminees], ['Délibérées', nbDeliberees], ['Reportées', nbReportees]].map(([l, v]) => (
                  <div key={l} className="bg-white/12 border border-white/20 rounded-xl px-3 py-2 text-center">
                    <p className="text-xl font-bold tabular-nums">{v}</p>
                    <p className="text-[11px] text-white/75 uppercase tracking-wide">{l}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="overflow-x-auto nav-scroll">
              <table className="w-full text-sm min-w-[820px]">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="text-left px-4 py-2.5 table-header">Semestre</th>
                    <th className="text-left px-4 py-2.5 table-header">Arrêté le</th>
                    <th className="text-left px-4 py-2.5 table-header">Programme</th>
                    <th className="text-left px-4 py-2.5 table-header">Session</th>
                    <th className="text-left px-4 py-2.5 table-header">Statut du suivi</th>
                    <th className="text-left px-4 py-2.5 table-header">Fin examen</th>
                  </tr>
                </thead>
                <tbody>
                  {evalsProg.map(e => {
                    const [lbl, cls] = statutSuivi(e);
                    const pc = POLES_SEG[e.pole_code]?.color || '#64748b';
                    return (
                      <tr key={e.id} className="border-b border-slate-50 hover:bg-slate-50/60">
                        <td className="px-4 py-2 text-slate-600 whitespace-nowrap">{fmtSemestre(e)}</td>
                        <td className="px-4 py-2 whitespace-nowrap tabular-nums font-medium text-slate-800">{e.date_programmation || '—'}</td>
                        <td className="px-4 py-2">
                          <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ background: pc }} />
                          <span className="font-medium text-slate-800" title={e.formation_nom || ''}>{nomProgramme(e)}</span>
                          {e.promotion_code && <span className="text-xs text-slate-400"> · {e.promotion_code}</span>}
                          {e.type_evaluation === 'DEVOIR' && <span className="badge bg-cyan-100 text-cyan-700 text-[10px] ml-1.5">Devoir</span>}
                        </td>
                        <td className="px-4 py-2 text-slate-600">{SESSION_LABEL[e.session_num]}</td>
                        <td className="px-4 py-2">
                          <span className={`badge ${cls} text-[11px]`}>{lbl}</span>
                          {e.delib_etat === 'TERMINEE' && <Gavel size={12} className="inline ml-1.5 text-green-600" />}
                        </td>
                        <td className="px-4 py-2 text-slate-600 whitespace-nowrap tabular-nums">{e.date_fin_prevue || '—'}</td>
                      </tr>
                    );
                  })}
                  {evalsProg.length === 0 && (
                    <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400">Aucune évaluation pour ces filtres</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Encart : programmes en cours avec leurs taux d'exécution */}
          {enCours.length > 0 && (
            <div className="card">
              <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wide mb-3">
                Semestres des programmes en cours — taux d'exécution
              </h3>
              <div className="space-y-2">
                {enCours.map(t => (
                  <div key={t.id} className="flex items-center gap-3">
                    <span className="text-xs text-slate-500 w-32 shrink-0 whitespace-nowrap">{fmtSemestre(t)}</span>
                    <span className="text-sm font-medium text-slate-800 w-44 truncate shrink-0" title={t.formation_nom}>
                      {nomProgramme(t)}
                    </span>
                    <Barre pct={progTut(t)} />
                    <span className="text-[11px] text-slate-400 shrink-0">{t.pole_code}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
