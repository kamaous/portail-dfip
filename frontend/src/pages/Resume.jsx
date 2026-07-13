import { useEffect, useMemo, useState } from 'react';
import api from '../lib/api';
import { BookOpen, ClipboardCheck, Calendar, Gavel } from 'lucide-react';
import { OK_CIBLES } from './Tutorat';

/* Module RÉSUMÉ : deux segments (Tutorat / Examens) avec barres de progression,
   situation par promotion / pôle / niveau / semestre / formation. */

const DIMENSIONS = [
  ['pole_code', 'Pôle'],
  ['promotion_code', 'Promotion'],
  ['niveau', 'Niveau'],
  ['semestre_code', 'Semestre'],
  ['formation_nom', 'Formation'],
];
const SESSION_LABEL = { 1: 'Normale', 2: 'Rattrapage', 3: 'Spéciale' };
const SESSION_STYLE = { 1: 'bg-blue-100 text-blue-700', 2: 'bg-amber-100 text-amber-700', 3: 'bg-purple-100 text-purple-700' };
const NIVEAU_LABEL = { L1: 'Licence 1', L2: 'Licence 2', L3: 'Licence 3', M1: 'Master 1', M2: 'Master 2' };

const progressionFiche = (t) => Object.entries(OK_CIBLES).filter(([k, v]) => t[k] === v).length / 5;

function BarreProgression({ pct, className = '' }) {
  const couleur = pct >= 1 ? 'bg-green-500' : pct >= 0.6 ? 'bg-blue-500' : pct >= 0.3 ? 'bg-amber-500' : 'bg-red-400';
  return (
    <div className={`h-2.5 bg-slate-100 rounded-full overflow-hidden ${className}`}>
      <div className={`h-full rounded-full transition-all duration-700 ${couleur}`} style={{ width: `${Math.round(pct * 100)}%` }} />
    </div>
  );
}

function GroupesTable({ groupes }) {
  return (
    <div className="space-y-2">
      {groupes.map(g => (
        <div key={g.cle} className="flex items-center gap-3">
          <span className="text-sm text-slate-600 w-56 truncate shrink-0" title={g.cle}>{g.label}</span>
          <BarreProgression pct={g.pct} className="flex-1" />
          <span className="text-xs font-bold text-slate-700 w-12 text-right shrink-0">{Math.round(g.pct * 100)} %</span>
          <span className="text-[11px] text-slate-400 w-24 text-right shrink-0">{g.detail}</span>
        </div>
      ))}
      {groupes.length === 0 && <p className="text-sm text-slate-400 italic py-4 text-center">Aucune donnée</p>}
    </div>
  );
}

function grouper(items, dimension, pctFn, detailFn) {
  const map = new Map();
  for (const it of items) {
    let cle = it[dimension] || '—';
    if (dimension === 'niveau') cle = NIVEAU_LABEL[cle] || cle;
    if (!map.has(cle)) map.set(cle, []);
    map.get(cle).push(it);
  }
  return [...map.entries()]
    .map(([cle, list]) => ({
      cle,
      label: `${cle} (${list.length})`,
      pct: list.reduce((s, x) => s + pctFn(x), 0) / list.length,
      detail: detailFn(list),
    }))
    .sort((a, b) => b.pct - a.pct);
}

export default function Resume() {
  const [tutorats, setTutorats] = useState([]);
  const [evals, setEvals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dimTut, setDimTut] = useState('pole_code');
  const [dimEval, setDimEval] = useState('pole_code');

  useEffect(() => {
    Promise.all([api.get('/tutorat'), api.get('/evaluations')])
      .then(([t, e]) => { setTutorats(t.data.filter(x => x.statut_fiche !== 'REJETEE')); setEvals(e.data.filter(x => x.etat !== 'ANNULE')); })
      .finally(() => setLoading(false));
  }, []);

  /* --- Tutorat --- */
  const pctTutoratGlobal = tutorats.length ? tutorats.reduce((s, t) => s + progressionFiche(t), 0) / tutorats.length : 0;
  const groupesTutorat = useMemo(() =>
    grouper(tutorats, dimTut, progressionFiche,
      list => `${list.filter(t => t.etat_tutorat === 'TERMINE').length} terminé(s) · ${list.filter(t => t.etat_tutorat === 'EN_COURS').length} en cours`),
    [tutorats, dimTut]);

  /* --- Examens --- */
  const pctEvalFiche = (e) => e.delib_etat === 'TERMINEE' ? 1 : e.etat_eval === 'EVAL_TERMINEES' ? 0.75 : e.etat_eval === 'EVAL_EN_COURS' ? 0.5 : 0.15;
  const pctEvalGlobal = evals.length ? evals.reduce((s, e) => s + pctEvalFiche(e), 0) / evals.length : 0;
  const groupesEval = useMemo(() =>
    grouper(evals, dimEval, pctEvalFiche,
      list => `${list.filter(e => e.etat_eval === 'EVAL_TERMINEES').length} terminée(s) · ${list.filter(e => e.delib_etat === 'TERMINEE').length} délibérée(s)`),
    [evals, dimEval]);

  /* Dates prévues, les plus proches en premier (à venir d'abord, puis passées) */
  const datesTriees = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return evals
      .map(e => ({ ...e, date_cle: e.date_programmation || e.date_demarrage }))
      .filter(e => e.date_cle)
      .sort((a, b) => {
        const aFutur = a.date_cle >= today, bFutur = b.date_cle >= today;
        if (aFutur !== bFutur) return aFutur ? -1 : 1;      // à venir en premier
        return aFutur ? a.date_cle.localeCompare(b.date_cle) // à venir : plus proche d'abord
                      : b.date_cle.localeCompare(a.date_cle); // passées : plus récente d'abord
      });
  }, [evals]);

  const jr = (d) => Math.ceil((new Date(d) - new Date()) / 86400000);

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Résumé</h1>
        <p className="text-slate-500 text-sm">Situation globale du tutorat et des examens — par promotion, pôle, niveau, semestre et formation</p>
      </div>

      {/* ===== Segment TUTORAT ===== */}
      <div className="card !p-0 overflow-hidden">
        <div className="px-5 py-4 text-white" style={{ background: 'linear-gradient(135deg, #1e3a5f, #2563eb)' }}>
          <div className="flex items-center gap-3 flex-wrap">
            <BookOpen size={20} />
            <h2 className="font-bold text-lg">Tutorat</h2>
            <span className="text-white/70 text-sm">{tutorats.length} fiche(s)</span>
            <span className="ml-auto font-bold text-xl">{Math.round(pctTutoratGlobal * 100)} %</span>
          </div>
          <div className="h-3 bg-white/20 rounded-full overflow-hidden mt-2">
            <div className="h-full bg-white rounded-full transition-all duration-700" style={{ width: `${Math.round(pctTutoratGlobal * 100)}%` }} />
          </div>
          <p className="text-white/60 text-[11px] mt-1">Progression moyenne des indicateurs PLATEFORMES ET TUTORATS (plateforme, cours, 3 enrôlements)</p>
        </div>
        <div className="p-5">
          <div className="flex gap-2 mb-4 flex-wrap">
            {DIMENSIONS.map(([k, l]) => (
              <button key={k} onClick={() => setDimTut(k)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${dimTut === k ? 'bg-[#1e3a5f] text-white' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'}`}>
                Par {l.toLowerCase()}
              </button>
            ))}
          </div>
          <GroupesTable groupes={groupesTutorat} />
        </div>
      </div>

      {/* ===== Segment EXAMENS ===== */}
      <div className="card !p-0 overflow-hidden">
        <div className="px-5 py-4 text-white" style={{ background: 'linear-gradient(135deg, #6d28d9, #a855f7)' }}>
          <div className="flex items-center gap-3 flex-wrap">
            <ClipboardCheck size={20} />
            <h2 className="font-bold text-lg">Examens</h2>
            <span className="text-white/70 text-sm">{evals.length} évaluation(s)</span>
            <span className="ml-auto font-bold text-xl">{Math.round(pctEvalGlobal * 100)} %</span>
          </div>
          <div className="h-3 bg-white/20 rounded-full overflow-hidden mt-2">
            <div className="h-full bg-white rounded-full transition-all duration-700" style={{ width: `${Math.round(pctEvalGlobal * 100)}%` }} />
          </div>
          <p className="text-white/60 text-[11px] mt-1">Avancement : calendrier → en cours → terminées → délibérées</p>
        </div>
        <div className="p-5 space-y-6">
          <div>
            <div className="flex gap-2 mb-4 flex-wrap">
              {DIMENSIONS.map(([k, l]) => (
                <button key={k} onClick={() => setDimEval(k)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${dimEval === k ? 'bg-purple-700 text-white' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'}`}>
                  Par {l.toLowerCase()}
                </button>
              ))}
            </div>
            <GroupesTable groupes={groupesEval} />
          </div>

          {/* Dates prévues par session — les plus proches en premier */}
          <div>
            <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wide mb-3 flex items-center gap-2">
              <Calendar size={15} /> Dates prévues des examens (les plus proches en premier)
            </h3>
            <div className="divide-y divide-slate-100 max-h-96 overflow-y-auto nav-scroll">
              {datesTriees.map(e => {
                const j = jr(e.date_cle);
                return (
                  <div key={e.id} className="flex items-center gap-3 py-2.5 flex-wrap">
                    <span className={`badge text-[11px] shrink-0 ${j < 0 ? 'bg-slate-100 text-slate-400' : j <= 7 ? 'bg-red-100 text-red-700 font-bold' : j <= 21 ? 'bg-amber-100 text-amber-700' : 'bg-blue-50 text-blue-700'}`}>
                      {e.date_cle}{j >= 0 ? ` · J−${j}` : ''}
                    </span>
                    <span className={`badge ${SESSION_STYLE[e.session_num]} shrink-0`}>{SESSION_LABEL[e.session_num]}</span>
                    <span className="badge bg-slate-100 text-slate-600 shrink-0">{e.type_evaluation === 'DEVOIR' ? 'Devoir' : 'Examen'}</span>
                    <span className="text-sm text-slate-700 font-medium truncate flex-1" title={e.formation_nom}>
                      {e.formation_nom || '—'}
                    </span>
                    <span className="text-xs text-slate-400 shrink-0">
                      {e.pole_code}{e.promotion_code ? ` · ${e.promotion_code}` : ''}{e.niveau ? ` · ${e.niveau}` : ''}{e.semestre_code ? ` · ${e.semestre_code}` : ''}
                    </span>
                    {e.delib_etat === 'TERMINEE' && <Gavel size={13} className="text-green-600 shrink-0" title="Délibérée" />}
                  </div>
                );
              })}
              {datesTriees.length === 0 && <p className="text-sm text-slate-400 italic py-4 text-center">Aucune date prévue</p>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
