import { useEffect, useMemo, useState } from 'react';
import api from '../lib/api';
import { BookOpen, ClipboardCheck, Calendar, Gavel, FilterX } from 'lucide-react';
import { OK_CIBLES, NIVEAUX } from './Tutorat';

/* Module RÉSUMÉ : deux segments (Tutorat / Examens) avec barres de progression.
   FILTRES COMBINABLES : on peut par exemple voir la situation de la Promotion 13,
   Licence 1, Semestre 2, formation CD — les filtres s'appliquent aux deux segments. */

const SESSION_LABEL = { 1: 'Normale', 2: 'Rattrapage', 3: 'Spéciale' };
const SESSION_STYLE = { 1: 'bg-blue-100 text-blue-700', 2: 'bg-amber-100 text-amber-700', 3: 'bg-purple-100 text-purple-700' };
const ETAT_TUT = { PAS_DEMARRE: ['En attente', 'bg-slate-100 text-slate-600'], EN_COURS: ['En cours', 'bg-blue-100 text-blue-700'], TERMINE: ['Terminé', 'bg-green-100 text-green-700'] };
const ETAT_EVAL = { CALENDRIER_DISPONIBLE: ['Calendrier disponible', 'bg-blue-100 text-blue-700'], EVAL_EN_COURS: ['En cours', 'bg-amber-100 text-amber-700'], EVAL_TERMINEES: ['Terminées', 'bg-green-100 text-green-700'] };

const progressionFiche = (t) => Object.entries(OK_CIBLES).filter(([k, v]) => t[k] === v).length / 5;
const pctEval = (e) => e.delib_etat === 'TERMINEE' ? 1 : e.etat_eval === 'EVAL_TERMINEES' ? 0.75 : e.etat_eval === 'EVAL_EN_COURS' ? 0.5 : 0.15;

function BarreProgression({ pct, className = '' }) {
  const couleur = pct >= 1 ? 'bg-green-500' : pct >= 0.6 ? 'bg-blue-500' : pct >= 0.3 ? 'bg-amber-500' : 'bg-red-400';
  return (
    <div className={`h-2.5 bg-slate-100 rounded-full overflow-hidden ${className}`}>
      <div className={`h-full rounded-full transition-all duration-700 ${couleur}`} style={{ width: `${Math.round(pct * 100)}%` }} />
    </div>
  );
}

export default function Resume() {
  const [tutorats, setTutorats] = useState([]);
  const [evals, setEvals] = useState([]);
  const [loading, setLoading] = useState(true);
  // Filtres combinables (vides = tous)
  const [f, setF] = useState({ pole: '', promotion: '', niveau: '', semestre: '', formation: '' });

  useEffect(() => {
    Promise.all([api.get('/tutorat'), api.get('/evaluations')])
      .then(([t, e]) => { setTutorats(t.data.filter(x => x.statut_fiche !== 'REJETEE')); setEvals(e.data.filter(x => x.etat !== 'ANNULE')); })
      .finally(() => setLoading(false));
  }, []);

  const tous = useMemo(() => [...tutorats, ...evals], [tutorats, evals]);
  const options = useMemo(() => ({
    pole: [...new Set(tous.map(x => x.pole_code).filter(Boolean))].sort(),
    promotion: [...new Set(tous.map(x => x.promotion_code).filter(Boolean))].sort(),
    niveau: Object.keys(NIVEAUX),
    semestre: [...new Set(tous.map(x => x.semestre_code).filter(Boolean))].sort(),
    formation: [...new Set(tous.map(x => x.formation_nom).filter(Boolean))].sort(),
  }), [tous]);

  const correspond = (x) =>
    (!f.pole || x.pole_code === f.pole) &&
    (!f.promotion || x.promotion_code === f.promotion) &&
    (!f.niveau || x.niveau === f.niveau) &&
    (!f.semestre || x.semestre_code === f.semestre) &&
    (!f.formation || x.formation_nom === f.formation);

  const tutoratsF = useMemo(() => tutorats.filter(correspond), [tutorats, f]);
  const evalsF = useMemo(() => evals.filter(correspond), [evals, f]);

  const pctTutorat = tutoratsF.length ? tutoratsF.reduce((s, t) => s + progressionFiche(t), 0) / tutoratsF.length : 0;
  const pctExamens = evalsF.length ? evalsF.reduce((s, e) => s + pctEval(e), 0) / evalsF.length : 0;

  /* Dates prévues : les plus proches en premier (à venir d'abord), filtrées */
  const datesTriees = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return evalsF
      .map(e => ({ ...e, date_cle: e.date_programmation || e.date_demarrage }))
      .filter(e => e.date_cle)
      .sort((a, b) => {
        const aF = a.date_cle >= today, bF = b.date_cle >= today;
        if (aF !== bF) return aF ? -1 : 1;
        return aF ? a.date_cle.localeCompare(b.date_cle) : b.date_cle.localeCompare(a.date_cle);
      });
  }, [evalsF]);

  const jr = (d) => Math.ceil((new Date(d) - new Date()) / 86400000);
  const filtresActifs = Object.values(f).some(Boolean);
  const cursus = (x) => [x.pole_code, x.promotion_code, x.niveau, x.semestre_code].filter(Boolean).join(' · ');

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  const FILTRES = [
    ['pole', 'Pôle'], ['promotion', 'Promotion'], ['niveau', 'Niveau'], ['semestre', 'Semestre'], ['formation', 'Formation'],
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Résumé</h1>
        <p className="text-slate-500 text-sm">Situation du tutorat et des examens — filtres combinables (ex. P13 + Licence 1 + Semestre 2 + une formation)</p>
      </div>

      {/* ===== Filtres combinables ===== */}
      <div className="card !p-3">
        <div className="flex flex-wrap items-end gap-2">
          {FILTRES.map(([k, label]) => (
            <div key={k} className={k === 'formation' ? 'min-w-56 flex-1' : ''}>
              <label className="text-[11px] font-semibold text-slate-400 uppercase block mb-1">{label}</label>
              <select value={f[k]} onChange={e => setF(v => ({ ...v, [k]: e.target.value }))}
                className={`!py-1.5 !text-xs ${f[k] ? '!border-blue-400 !bg-blue-50 font-semibold' : ''}`}>
                <option value="">{k === 'niveau' ? 'Tous' : k === 'formation' ? 'Toutes' : 'Tous'}</option>
                {options[k].map(o => <option key={o} value={o}>{k === 'niveau' ? (NIVEAUX[o]?.label || o) : o}</option>)}
              </select>
            </div>
          ))}
          {filtresActifs && (
            <button onClick={() => setF({ pole: '', promotion: '', niveau: '', semestre: '', formation: '' })}
              className="btn-secondary !py-1.5 text-xs flex items-center gap-1.5 !text-red-600 !border-red-200 hover:!bg-red-50">
              <FilterX size={13} /> Réinitialiser
            </button>
          )}
        </div>
      </div>

      {/* ===== Segment TUTORAT ===== */}
      <div className="card !p-0 overflow-hidden">
        <div className="px-5 py-4 text-white" style={{ background: 'linear-gradient(135deg, #1e3a5f, #2563eb)' }}>
          <div className="flex items-center gap-3 flex-wrap">
            <BookOpen size={20} />
            <h2 className="font-bold text-lg">Tutorat</h2>
            <span className="text-white/70 text-sm">{tutoratsF.length} fiche(s){filtresActifs ? ' (filtrées)' : ''}</span>
            <span className="ml-auto font-bold text-xl">{Math.round(pctTutorat * 100)} %</span>
          </div>
          <div className="h-3 bg-white/20 rounded-full overflow-hidden mt-2">
            <div className="h-full bg-white rounded-full transition-all duration-700" style={{ width: `${Math.round(pctTutorat * 100)}%` }} />
          </div>
          <p className="text-white/60 text-[11px] mt-1">Progression PLATEFORMES ET TUTORATS (plateforme, cours, 3 enrôlements)</p>
        </div>
        <div className="p-5">
          <div className="space-y-2 max-h-80 overflow-y-auto nav-scroll">
            {tutoratsF.map(t => {
              const p = progressionFiche(t);
              const [etatLbl, etatCls] = ETAT_TUT[t.etat_tutorat] || ETAT_TUT.PAS_DEMARRE;
              return (
                <div key={t.id} className="flex items-center gap-3 flex-wrap">
                  <span className="text-sm text-slate-700 font-medium w-64 truncate shrink-0" title={t.formation_nom}>
                    {t.formation_nom || `${t.pole_nom || t.pole_code} (pôle)`}
                  </span>
                  <span className="text-[11px] text-slate-400 w-36 shrink-0">{cursus(t)}</span>
                  <BarreProgression pct={p} className="flex-1 min-w-32" />
                  <span className="text-xs font-bold text-slate-600 w-10 text-right">{Math.round(p * 100)}%</span>
                  <span className={`badge ${etatCls} text-[10px] shrink-0`}>{etatLbl}</span>
                  {t.activite_id && <span title="Issue du planning annuel">🔗</span>}
                </div>
              );
            })}
            {tutoratsF.length === 0 && <p className="text-sm text-slate-400 italic py-4 text-center">Aucune fiche pour ces filtres</p>}
          </div>
        </div>
      </div>

      {/* ===== Segment EXAMENS ===== */}
      <div className="card !p-0 overflow-hidden">
        <div className="px-5 py-4 text-white" style={{ background: 'linear-gradient(135deg, #6d28d9, #a855f7)' }}>
          <div className="flex items-center gap-3 flex-wrap">
            <ClipboardCheck size={20} />
            <h2 className="font-bold text-lg">Examens</h2>
            <span className="text-white/70 text-sm">{evalsF.length} évaluation(s){filtresActifs ? ' (filtrées)' : ''}</span>
            <span className="ml-auto font-bold text-xl">{Math.round(pctExamens * 100)} %</span>
          </div>
          <div className="h-3 bg-white/20 rounded-full overflow-hidden mt-2">
            <div className="h-full bg-white rounded-full transition-all duration-700" style={{ width: `${Math.round(pctExamens * 100)}%` }} />
          </div>
          <p className="text-white/60 text-[11px] mt-1">Avancement : calendrier → en cours → terminées → délibérées</p>
        </div>
        <div className="p-5 space-y-6">
          {/* Situation détaillée */}
          <div className="space-y-2 max-h-72 overflow-y-auto nav-scroll">
            {evalsF.map(e => {
              const p = pctEval(e);
              const [etatLbl, etatCls] = ETAT_EVAL[e.etat_eval] || ETAT_EVAL.CALENDRIER_DISPONIBLE;
              return (
                <div key={e.id} className="flex items-center gap-3 flex-wrap">
                  <span className="text-sm text-slate-700 font-medium w-64 truncate shrink-0" title={e.formation_nom}>
                    {e.formation_nom || `${e.pole_nom || e.pole_code} (pôle)`}
                  </span>
                  <span className={`badge ${SESSION_STYLE[e.session_num]} text-[10px] shrink-0`}>{SESSION_LABEL[e.session_num]}</span>
                  <span className="text-[11px] text-slate-400 w-32 shrink-0">{cursus(e)}</span>
                  <BarreProgression pct={p} className="flex-1 min-w-32" />
                  <span className={`badge ${etatCls} text-[10px] shrink-0`}>{etatLbl}</span>
                  {e.delib_etat === 'TERMINEE' && <Gavel size={13} className="text-green-600 shrink-0" title="Délibérée" />}
                  {e.activite_id && <span title="Issue du planning annuel">🔗</span>}
                </div>
              );
            })}
            {evalsF.length === 0 && <p className="text-sm text-slate-400 italic py-4 text-center">Aucune évaluation pour ces filtres</p>}
          </div>

          {/* Dates prévues par session — les plus proches en premier */}
          <div>
            <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wide mb-3 flex items-center gap-2">
              <Calendar size={15} /> Dates prévues (les plus proches en premier)
            </h3>
            <div className="divide-y divide-slate-100 max-h-80 overflow-y-auto nav-scroll">
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
                      {e.formation_nom || `${e.pole_code} (pôle)`}
                    </span>
                    <span className="text-xs text-slate-400 shrink-0">{cursus(e)}</span>
                  </div>
                );
              })}
              {datesTriees.length === 0 && <p className="text-sm text-slate-400 italic py-4 text-center">Aucune date prévue pour ces filtres</p>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
