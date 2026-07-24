import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { NIVEAUX } from './Tutorat';
import { SESSION_CODE } from './Evaluations';

/* CALENDRIER D'EXAMENS imprimable (→ PDF) pour UN cursus :
   formation × promotion × niveau (± semestre, ± session).
   Ouvert depuis « 📄 Calendrier PDF » du module Évaluations. */

const SESSION_LBL = { 1: 'Session Normale', 2: 'Session de Rattrapage', 3: 'Session Spéciale' };
const JOURS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
const fmtDate = (s) => s ? new Date(`${s}T00:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }) : '—';

function statut(e) {
  if (e.etat === 'SUSPENDU') return 'Suspendue';
  if (e.etat === 'ANNULE') return 'Annulée';
  if (e.delib_etat === 'TERMINEE') return 'Terminée et délibérée';
  if (e.etat_eval === 'EVAL_TERMINEES') return 'Terminée';
  if (e.etat_eval === 'EVAL_EN_COURS') return 'En cours';
  return 'Programmée';
}

export default function CalendrierExamens() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const formationId = Number(params.get('formation_id'));
  const promo = params.get('promotion_code') || '';
  const niveau = params.get('niveau') || '';
  const semestre = params.get('semestre') || '';
  const session = params.get('session') || '';
  const [evals, setEvals] = useState([]);
  const [poles, setPoles] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.get('/evaluations'), api.get('/poles')])
      .then(([e, p]) => { setEvals(e.data); setPoles(p.data); })
      .finally(() => setLoading(false));
  }, []);

  const formation = useMemo(() =>
    poles.flatMap(p => (p.formations || []).map(f => ({ ...f, pole_code: p.code, pole_nom: p.nom })))
      .find(f => f.id === formationId), [poles, formationId]);

  const selection = useMemo(() => evals
    .filter(e => e.formation_id === formationId
      && (!promo || e.promotion_code === promo)
      && (!niveau || e.niveau === niveau)
      && (!semestre || e.semestre_code === semestre)
      && (!session || String(e.session_num) === session)
      && e.etat !== 'ANNULE')
    .sort((a, b) => (a.date_demarrage || '9999').localeCompare(b.date_demarrage || '9999')),
    [evals, formationId, promo, niveau, semestre, session]);

  useEffect(() => {
    if (!loading) { const t = setTimeout(() => window.print(), 900); return () => clearTimeout(t); }
  }, [loading]);

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <div className="w-8 h-8 border-4 border-[#1e3a5f] border-t-transparent rounded-full animate-spin" />
    </div>
  );

  const sousTitre = [
    formation ? `${formation.nom}${formation.code ? ` (${formation.code})` : ''}` : `Formation #${formationId}`,
    promo && `Promotion ${promo}`,
    niveau && (NIVEAUX[niveau]?.label || niveau),
    semestre && `Semestre ${semestre.replace('S', '')}`,
    session && SESSION_LBL[session],
  ].filter(Boolean).join(' · ');

  return (
    <div className="bg-white min-h-screen text-slate-800 p-8 max-w-3xl mx-auto text-sm">
      <style>{`@media print { .no-print { display: none !important; } @page { margin: 14mm; } }`}</style>

      <div className="no-print flex items-center gap-3 mb-6 bg-blue-50 border border-blue-100 rounded-xl p-3">
        <p className="text-xs text-blue-800 flex-1">Utilisez <strong>Imprimer → Enregistrer au format PDF</strong> pour produire le calendrier.</p>
        <button onClick={() => window.print()} className="btn-primary !py-1.5 !px-4 text-xs">🖨 Imprimer / PDF</button>
        <button onClick={() => window.close()} className="btn-secondary !py-1.5 !px-4 text-xs">Fermer</button>
      </div>

      {/* En-tête institutionnel */}
      <div className="flex items-center gap-4 border-b-4 border-[#1e3a5f] pb-4 mb-2">
        <img src="/dfip-icon.svg" alt="DFIP" className="w-14 h-14 rounded-xl" />
        <div className="flex-1">
          <h1 className="text-xl font-bold text-[#1e3a5f]">Calendrier des examens</h1>
          <p className="text-xs text-slate-500">Direction de la Formation et de l'Ingénierie Pédagogique · Université numérique Cheikh Hamidou KANE (UnCHK)</p>
        </div>
      </div>
      <p className="text-base font-bold text-slate-800 mb-1">{sousTitre}</p>
      {formation && <p className="text-xs text-slate-500 mb-5">{formation.pole_nom}</p>}

      {selection.length === 0 ? (
        <p className="text-slate-400 italic py-8">Aucune évaluation programmée pour ce cursus avec ces critères.</p>
      ) : (
        <>
          {/* Tableau récapitulatif */}
          <table className="w-full text-xs mb-6">
            <thead><tr className="bg-[#1e3a5f] text-white text-left">
              {['Type', 'Session', 'Semestre', 'Du', 'Au', 'Horaire quotidien', 'Statut'].map(h => <th key={h} className="px-2.5 py-2 font-bold">{h}</th>)}
            </tr></thead>
            <tbody>
              {selection.map(e => (
                <tr key={e.id} className="border-b border-slate-200">
                  <td className="px-2.5 py-2 font-semibold">{e.type_evaluation === 'DEVOIR' ? 'Devoir' : 'Examen'}</td>
                  <td className="px-2.5 py-2">{SESSION_CODE[e.session_num]} — {SESSION_LBL[e.session_num]}</td>
                  <td className="px-2.5 py-2">{e.semestre_code || '—'}</td>
                  <td className="px-2.5 py-2 whitespace-nowrap">{e.date_demarrage || '—'}</td>
                  <td className="px-2.5 py-2 whitespace-nowrap">{e.date_fin_prevue || '—'}</td>
                  <td className="px-2.5 py-2 whitespace-nowrap">{e.heure_debut ? `${e.heure_debut} – ${e.heure_fin || '—'}` : 'Journée entière'}</td>
                  <td className="px-2.5 py-2">{statut(e)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Détail par évaluation */}
          {selection.map(e => (
            <div key={e.id} className="border border-slate-200 rounded-xl p-4 mb-4 break-inside-avoid">
              <p className="font-bold text-[#1e3a5f]">
                {e.type_evaluation === 'DEVOIR' ? '📝 Devoir' : '🧪 Examen'} — {SESSION_LBL[e.session_num]}
                {e.semestre_code ? ` · Semestre ${e.semestre_code.replace('S', '')}` : ''}
              </p>
              <div className="grid grid-cols-2 gap-x-6 gap-y-1 mt-2 text-xs">
                <p><span className="text-slate-500">Début :</span> <strong>{fmtDate(e.date_demarrage)}</strong></p>
                <p><span className="text-slate-500">Fin :</span> <strong>{fmtDate(e.date_fin_prevue)}</strong></p>
                <p><span className="text-slate-500">Horaire quotidien :</span> <strong>{e.heure_debut ? `${e.heure_debut} – ${e.heure_fin || '—'}` : 'Journée entière'}</strong></p>
                <p><span className="text-slate-500">Statut :</span> <strong>{statut(e)}</strong></p>
                {e.date_programmation && <p><span className="text-slate-500">Calendrier arrêté le :</span> <strong>{e.date_programmation}</strong></p>}
                {e.delib_etat === 'TERMINEE' && <p><span className="text-slate-500">Délibération :</span> <strong>Effective{e.date_deliberation ? ` le ${e.date_deliberation}` : ''}</strong></p>}
                {e.delib_etat === 'PREVUE' && <p><span className="text-slate-500">Délibération :</span> <strong>Prévue{e.date_deliberation ? ` le ${e.date_deliberation}` : ''}</strong></p>}
              </div>
            </div>
          ))}
        </>
      )}

      <p className="text-[10px] text-slate-400 text-center border-t border-slate-200 pt-3 mt-8">
        Portail DFIP — UnCHK · Document généré le {new Date().toLocaleDateString('fr-FR')} par {user?.prenom} {user?.nom} · Sous réserve de modifications publiées sur le portail
      </p>
    </div>
  );
}
