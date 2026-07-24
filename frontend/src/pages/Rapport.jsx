import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { NIVEAUX, etatTutoratAuto, progressionDates } from './Tutorat';
import { progressionEval, SESSION_CODE } from './Evaluations';

/* RAPPORT PDF — page imprimable : toutes les données de la période avec graphiques.
   Ouverte depuis « Export PDF » (Tableau de bord / Résumé) ; Ctrl+P ⇒ PDF. */

const POLE_COLOR = { SEJA: '#ea580c', STN: '#16a34a', LSHE: '#6d28d9' };
const ETAT_TUT_LBL = { PAS_DEMARRE: 'En attente', PRET: 'Prêt pour démarrage', EN_COURS: 'En cours', TERMINE: 'Terminé' };

function statutSuivi(e) {
  if (e.etat === 'SUSPENDU') return 'Suspendue';
  if (e.etat === 'ANNULE') return 'Annulée';
  if (e.delib_etat === 'TERMINEE') return 'Terminée et délibérée';
  if (e.etat_eval === 'EVAL_TERMINEES') return 'Terminée';
  if (e.etat_eval === 'EVAL_EN_COURS') return 'En cours';
  if (e.date_programmation) return 'Programmée';
  return 'À programmer';
}
const chevauche = (d1, f1, du, au) => d1 && (f1 || d1) >= du && d1 <= au;

/* Graphique en barres horizontales (CSS pur — fiable à l'impression) */
function GraphBarres({ titre, data }) {
  const max = Math.max(1, ...data.map(d => d.value));
  return (
    <div className="border border-slate-200 rounded-xl p-4 break-inside-avoid">
      <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-3">{titre}</h3>
      <div className="space-y-2">
        {data.map((d, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <span className="w-40 shrink-0 text-slate-600 truncate" title={d.label}>{d.label}</span>
            <div className="flex-1 h-4 bg-slate-100 rounded overflow-hidden">
              <div className="h-full rounded" style={{ width: `${(d.value / max) * 100}%`, background: d.color || '#1e3a5f', printColorAdjust: 'exact', WebkitPrintColorAdjust: 'exact' }} />
            </div>
            <span className="w-8 text-right font-bold text-slate-700">{d.value}</span>
          </div>
        ))}
        {data.every(d => d.value === 0) && <p className="text-xs text-slate-400 italic">Aucune donnée sur la période</p>}
      </div>
    </div>
  );
}

function Kpi({ label, value, sub }) {
  return (
    <div className="border border-slate-200 rounded-xl px-3 py-2.5 text-center break-inside-avoid">
      <p className="text-2xl font-bold text-[#1e3a5f]">{value}</p>
      <p className="text-[10px] uppercase tracking-wide text-slate-500 leading-tight">{label}</p>
      {sub && <p className="text-[10px] text-slate-400">{sub}</p>}
    </div>
  );
}

export default function Rapport() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const du = params.get('du') || '';
  const au = params.get('au') || '';
  const [tutorats, setTutorats] = useState([]);
  const [evals, setEvals] = useState([]);
  const [incidents, setIncidents] = useState([]);
  const [poles, setPoles] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get('/tutorat'), api.get('/evaluations'), api.get('/incidents').catch(() => ({ data: [] })), api.get('/poles'),
    ]).then(([t, e, i, p]) => {
      setTutorats(t.data.filter(x => x.statut_fiche !== 'REJETEE'));
      setEvals(e.data); setIncidents(i.data); setPoles(p.data);
    }).finally(() => setLoading(false));
  }, []);

  const tuts = useMemo(() => tutorats.filter(t => chevauche(t.date_debut || t.date_demarree_le, t.date_fin || t.date_terminee_le, du, au)), [tutorats, du, au]);
  const evs = useMemo(() => evals.filter(e => chevauche(e.date_demarrage, e.date_fin_prevue, du, au)), [evals, du, au]);
  const incs = useMemo(() => incidents.filter(i => chevauche(i.date_debut || i.date_incident, i.date_fin, du, au)), [incidents, du, au]);

  // Impression automatique une fois les données chargées
  useEffect(() => {
    if (!loading) { const t = setTimeout(() => window.print(), 900); return () => clearTimeout(t); }
  }, [loading]);

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <div className="w-8 h-8 border-4 border-[#1e3a5f] border-t-transparent rounded-full animate-spin" />
    </div>
  );

  const pctMoyTut = tuts.length ? Math.round(tuts.reduce((s, t) => s + progressionDates(t), 0) / tuts.length * 100) : 0;
  const pctMoyEval = evs.length ? Math.round(evs.reduce((s, e) => s + progressionEval(e), 0) / evs.length * 100) : 0;

  return (
    <div className="bg-white min-h-screen text-slate-800 p-8 max-w-5xl mx-auto text-sm">
      <style>{`@media print { .no-print { display: none !important; } body { background: #fff; } @page { margin: 12mm; } }`}</style>

      {/* Barre d'action (masquée à l'impression) */}
      <div className="no-print flex items-center gap-3 mb-6 bg-blue-50 border border-blue-100 rounded-xl p-3">
        <p className="text-xs text-blue-800 flex-1">Utilisez <strong>Imprimer → Enregistrer au format PDF</strong> pour produire le document.</p>
        <button onClick={() => window.print()} className="btn-primary !py-1.5 !px-4 text-xs">🖨 Imprimer / PDF</button>
        <button onClick={() => window.close()} className="btn-secondary !py-1.5 !px-4 text-xs">Fermer</button>
      </div>

      {/* En-tête du rapport */}
      <div className="flex items-center gap-4 border-b-4 border-[#1e3a5f] pb-4 mb-5">
        <img src="/dfip-icon.svg" alt="DFIP" className="w-14 h-14 rounded-xl" />
        <div className="flex-1">
          <h1 className="text-xl font-bold text-[#1e3a5f]">Rapport d'activité — Portail DFIP</h1>
          <p className="text-xs text-slate-500">Direction de la Formation et de l'Ingénierie Pédagogique · Université numérique Cheikh Hamidou KANE (UnCHK)</p>
        </div>
        <div className="text-right text-xs text-slate-500">
          <p className="font-bold text-slate-700">Période : {du} → {au}</p>
          <p>Généré le {new Date().toLocaleDateString('fr-FR')} par {user?.prenom} {user?.nom}</p>
        </div>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-4 sm:grid-cols-8 gap-2 mb-6">
        <Kpi label="Fiches tutorat" value={tuts.length} />
        <Kpi label="Progression moy. tutorat" value={`${pctMoyTut}%`} />
        <Kpi label="Tutorats terminés" value={tuts.filter(t => etatTutoratAuto(t) === 'TERMINE').length} />
        <Kpi label="Évaluations" value={evs.length} />
        <Kpi label="Progression moy. éval." value={`${pctMoyEval}%`} />
        <Kpi label="Éval. terminées" value={evs.filter(e => e.etat_eval === 'EVAL_TERMINEES').length} />
        <Kpi label="Délibérées" value={evs.filter(e => e.delib_etat === 'TERMINEE').length} />
        <Kpi label="Incidents" value={incs.length} sub={`${incs.filter(i => i.statut !== 'RESOLU').length} ouverts`} />
      </div>

      {/* Graphiques */}
      <div className="grid sm:grid-cols-2 gap-4 mb-6">
        <GraphBarres titre="Tutorat — par état" data={Object.entries(ETAT_TUT_LBL).map(([k, l]) => ({
          label: l, value: tuts.filter(t => etatTutoratAuto(t) === k).length,
          color: { PAS_DEMARRE: '#94a3b8', PRET: '#0d9488', EN_COURS: '#2563eb', TERMINE: '#16a34a' }[k],
        }))} />
        <GraphBarres titre="Évaluations — statut du suivi" data={['À programmer', 'Programmée', 'En cours', 'Terminée', 'Terminée et délibérée', 'Annulée'].map(st => ({
          label: st, value: evs.filter(e => statutSuivi(e) === st).length,
          color: { 'À programmer': '#94a3b8', 'Programmée': '#2563eb', 'En cours': '#f59e0b', 'Terminée': '#10b981', 'Terminée et délibérée': '#16a34a', 'Annulée': '#dc2626' }[st],
        }))} />
        <GraphBarres titre="Évaluations — par pôle" data={poles.map(p => ({
          label: p.code, value: evs.filter(e => e.pole_code === p.code).length, color: POLE_COLOR[p.code] || '#1e3a5f',
        }))} />
        <GraphBarres titre="Incidents — par gravité" data={['CRITIQUE', 'HAUTE', 'MOYENNE', 'FAIBLE'].map(g => ({
          label: g, value: incs.filter(i => i.gravite === g).length,
          color: { CRITIQUE: '#991b1b', HAUTE: '#ea580c', MOYENNE: '#f59e0b', FAIBLE: '#94a3b8' }[g],
        }))} />
      </div>

      {/* Tableau tutorat */}
      <h2 className="text-sm font-bold text-[#1e3a5f] uppercase tracking-wide border-b-2 border-slate-200 pb-1 mb-2">📚 Suivi du tutorat ({tuts.length})</h2>
      <table className="w-full text-xs mb-6">
        <thead><tr className="bg-slate-100 text-left">
          {['Pôle', 'Programme', 'Promo', 'Niveau', 'Sem.', 'Début', 'Fin prévue', 'État', 'Progression'].map(h => <th key={h} className="px-2 py-1.5 font-bold text-slate-600">{h}</th>)}
        </tr></thead>
        <tbody>
          {tuts.map(t => (
            <tr key={t.id} className="border-b border-slate-100 break-inside-avoid">
              <td className="px-2 py-1 font-semibold" style={{ color: POLE_COLOR[t.pole_code] }}>{t.pole_code}</td>
              <td className="px-2 py-1">{t.formation_code || t.formation_nom || '—'}</td>
              <td className="px-2 py-1">{t.promotion_code || '—'}</td>
              <td className="px-2 py-1">{NIVEAUX[t.niveau]?.label || t.niveau || '—'}</td>
              <td className="px-2 py-1">{t.semestre_code || '—'}</td>
              <td className="px-2 py-1 tabular-nums">{t.date_debut || t.date_demarree_le || '—'}</td>
              <td className="px-2 py-1 tabular-nums">{t.date_fin || t.date_terminee_le || '—'}</td>
              <td className="px-2 py-1">{ETAT_TUT_LBL[etatTutoratAuto(t)]}</td>
              <td className="px-2 py-1 font-bold tabular-nums">{Math.round(progressionDates(t) * 100)}%</td>
            </tr>
          ))}
          {tuts.length === 0 && <tr><td colSpan={9} className="px-2 py-3 text-slate-400 italic">Aucune fiche sur la période</td></tr>}
        </tbody>
      </table>

      {/* Tableau évaluations */}
      <h2 className="text-sm font-bold text-[#1e3a5f] uppercase tracking-wide border-b-2 border-slate-200 pb-1 mb-2">🧪 Évaluations ({evs.length})</h2>
      <table className="w-full text-xs mb-6">
        <thead><tr className="bg-slate-100 text-left">
          {['Pôle', 'Programme', 'Sess.', 'Niveau/Sem.', 'Arrêtée le', 'Début', 'Fin', 'Statut du suivi', 'Délibération', 'Progr.'].map(h => <th key={h} className="px-2 py-1.5 font-bold text-slate-600">{h}</th>)}
        </tr></thead>
        <tbody>
          {evs.map(e => (
            <tr key={e.id} className="border-b border-slate-100 break-inside-avoid">
              <td className="px-2 py-1 font-semibold" style={{ color: POLE_COLOR[e.pole_code] }}>{e.pole_code}</td>
              <td className="px-2 py-1">{e.formation_code || e.formation_nom || '—'}{e.type_evaluation === 'DEVOIR' ? ' (devoir)' : ''}</td>
              <td className="px-2 py-1">{SESSION_CODE[e.session_num]}</td>
              <td className="px-2 py-1">{e.niveau || '—'} {e.semestre_code || ''}</td>
              <td className="px-2 py-1 tabular-nums">{e.date_programmation || '—'}</td>
              <td className="px-2 py-1 tabular-nums">{e.date_demarrage || '—'}</td>
              <td className="px-2 py-1 tabular-nums">{e.date_fin_prevue || '—'}</td>
              <td className="px-2 py-1">{statutSuivi(e)}</td>
              <td className="px-2 py-1">{e.delib_etat === 'TERMINEE' ? `Effective ${e.date_deliberation || ''}` : e.delib_etat === 'PREVUE' ? `Prévue ${e.date_deliberation || ''}` : 'Pas encore'}</td>
              <td className="px-2 py-1 font-bold tabular-nums">{Math.round(progressionEval(e) * 100)}%</td>
            </tr>
          ))}
          {evs.length === 0 && <tr><td colSpan={10} className="px-2 py-3 text-slate-400 italic">Aucune évaluation sur la période</td></tr>}
        </tbody>
      </table>

      {/* Tableau incidents */}
      <h2 className="text-sm font-bold text-[#1e3a5f] uppercase tracking-wide border-b-2 border-slate-200 pb-1 mb-2">🚨 Incidents ({incs.length})</h2>
      <table className="w-full text-xs mb-8">
        <thead><tr className="bg-slate-100 text-left">
          {['Gravité', 'Statut', 'Incident', 'Pôle', 'Période', 'Conséq. évaluations', 'Conséq. tutorat', 'Signalé par'].map(h => <th key={h} className="px-2 py-1.5 font-bold text-slate-600">{h}</th>)}
        </tr></thead>
        <tbody>
          {incs.map(i => (
            <tr key={i.id} className="border-b border-slate-100 break-inside-avoid">
              <td className="px-2 py-1 font-bold" style={{ color: { CRITIQUE: '#991b1b', HAUTE: '#ea580c', MOYENNE: '#b45309', FAIBLE: '#64748b' }[i.gravite] }}>{i.gravite}</td>
              <td className="px-2 py-1">{i.statut === 'RESOLU' ? '✓ Résolu' : i.statut.replace('_', ' ')}</td>
              <td className="px-2 py-1">{i.titre}</td>
              <td className="px-2 py-1">{poles.find(p => p.id === i.pole_id)?.code || 'Général'}</td>
              <td className="px-2 py-1 tabular-nums">{(i.date_debut || i.date_incident) || '—'}{i.date_fin ? ` → ${i.date_fin}` : ''}</td>
              <td className="px-2 py-1">{i.conseq_eval || i.consequence_examens || '—'}</td>
              <td className="px-2 py-1">{i.conseq_tutorat || i.consequence_tutorat || '—'}</td>
              <td className="px-2 py-1">{i.signale_par_prenom} {i.signale_par_nom}</td>
            </tr>
          ))}
          {incs.length === 0 && <tr><td colSpan={8} className="px-2 py-3 text-slate-400 italic">Aucun incident sur la période</td></tr>}
        </tbody>
      </table>

      <p className="text-[10px] text-slate-400 text-center border-t border-slate-200 pt-3">
        Portail DFIP — UnCHK · Rapport généré automatiquement le {new Date().toLocaleString('fr-FR')} · Période {du} → {au}
      </p>
    </div>
  );
}
