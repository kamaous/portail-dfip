import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { NIVEAUX } from './Tutorat';
import { SESSION_CODE } from './Evaluations';

/* CALENDRIER D'EXAMENS imprimable (→ PDF).
   Critères combinables, tous MULTI-SÉLECTION : pôles, formations, promotions,
   niveaux, semestres, sessions + période (intervalle de dates).
   Paramètres multi = listes séparées par des virgules (poles, formations, promotions,
   niveaux, semestres, sessions, debut, fin) ; les anciens paramètres unitaires
   (formation_id, promotion_code, niveau, semestre, session) restent acceptés.
   Ouvert depuis « 📄 Calendrier PDF » du module Évaluations. */

const SESSION_LBL = { 1: 'Session Normale', 2: 'Session de Rattrapage', 3: 'Session Spéciale' };
const fmtDate = (s) => s ? new Date(`${s}T00:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }) : '—';
const fmtCourt = (s) => s ? new Date(`${s}T00:00:00`).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }) : '—';

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
  const getList = (k) => (params.get(k) || '').split(',').filter(Boolean);
  // Critères multi + compatibilité avec les anciens paramètres unitaires
  const polesSel = getList('poles').map(Number);
  const formationsSel = [...getList('formations').map(Number),
    ...(params.get('formation_id') ? [Number(params.get('formation_id'))] : [])];
  const promosSel = [...getList('promotions'), ...(params.get('promotion_code') ? [params.get('promotion_code')] : [])];
  const niveauxSel = [...getList('niveaux'), ...(params.get('niveau') ? [params.get('niveau')] : [])];
  const semestresSel = [...getList('semestres'), ...(params.get('semestre') ? [params.get('semestre')] : [])];
  const sessionsSel = [...getList('sessions'), ...(params.get('session') ? [params.get('session')] : [])];
  const debut = params.get('debut') || '';
  const fin = params.get('fin') || '';

  const [evals, setEvals] = useState([]);
  const [poles, setPoles] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.get('/evaluations'), api.get('/poles')])
      .then(([e, p]) => { setEvals(e.data); setPoles(p.data); })
      .finally(() => setLoading(false));
  }, []);

  const formations = useMemo(() =>
    poles.flatMap(p => (p.formations || []).map(f => ({ ...f, pole_id: p.id, pole_code: p.code, pole_nom: p.nom }))),
    [poles]);

  const selection = useMemo(() => evals
    .filter(e => (polesSel.length === 0 || polesSel.includes(e.pole_id))
      && (formationsSel.length === 0 || formationsSel.includes(e.formation_id))
      && (promosSel.length === 0 || promosSel.includes(e.promotion_code))
      && (niveauxSel.length === 0 || niveauxSel.includes(e.niveau))
      && (semestresSel.length === 0 || semestresSel.includes(e.semestre_code))
      && (sessionsSel.length === 0 || sessionsSel.includes(String(e.session_num)))
      // Période : évaluations CHEVAUCHANT l'intervalle (sans dates = exclues si période demandée)
      && (!(debut || fin) || (e.date_demarrage
        && (!fin || e.date_demarrage <= fin)
        && (!debut || (e.date_fin_prevue || e.date_demarrage) >= debut)))
      && e.etat !== 'ANNULE')
    .sort((a, b) => (a.date_demarrage || '9999').localeCompare(b.date_demarrage || '9999')),
    [evals, params]); // eslint-disable-line react-hooks/exhaustive-deps

  // Groupement par formation (sections du document), trié pôle puis formation
  const groupes = useMemo(() => {
    const m = new Map();
    for (const e of selection) {
      const k = e.formation_id || 0;
      if (!m.has(k)) {
        const fo = formations.find(f => f.id === e.formation_id);
        m.set(k, {
          nom: fo ? `${fo.nom}${fo.code ? ` (${fo.code})` : ''}` : (e.formation_nom || 'Formation —'),
          pole: fo?.pole_nom || e.pole_nom || '', pole_code: fo?.pole_code || e.pole_code || '',
          evals: [],
        });
      }
      m.get(k).evals.push(e);
    }
    return [...m.values()].sort((a, b) => (a.pole_code + a.nom).localeCompare(b.pole_code + b.nom));
  }, [selection, formations]);

  useEffect(() => {
    if (!loading) { const t = setTimeout(() => window.print(), 900); return () => clearTimeout(t); }
  }, [loading]);

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <div className="w-8 h-8 border-4 border-[#1e3a5f] border-t-transparent rounded-full animate-spin" />
    </div>
  );

  const nomsPoles = polesSel.map(id => poles.find(p => p.id === id)?.code || id);
  const sousTitre = [
    nomsPoles.length > 0 && `Pôle${nomsPoles.length > 1 ? 's' : ''} ${nomsPoles.join(', ')}`,
    formationsSel.length > 0 && (formationsSel.length === 1
      ? (formations.find(f => f.id === formationsSel[0])?.nom || `Formation #${formationsSel[0]}`)
      : `${formationsSel.length} formations sélectionnées`),
    promosSel.length > 0 && `Promotion${promosSel.length > 1 ? 's' : ''} ${promosSel.join(', ')}`,
    niveauxSel.length > 0 && niveauxSel.map(n => NIVEAUX[n]?.label || n).join(', '),
    semestresSel.length > 0 && `Semestre${semestresSel.length > 1 ? 's' : ''} ${semestresSel.map(s => s.replace('S', '')).join(', ')}`,
    sessionsSel.length > 0 && sessionsSel.map(s => SESSION_LBL[s]).join(', '),
  ].filter(Boolean).join(' · ') || 'Toutes les évaluations';

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
      {(debut || fin) && (
        <p className="text-xs font-semibold text-[#1e3a5f] mb-1">
          📆 Période : {debut ? `du ${fmtCourt(debut)}` : ''}{fin ? ` au ${fmtCourt(fin)}` : ' et au-delà'}
        </p>
      )}
      <p className="text-xs text-slate-500 mb-5">{selection.length} évaluation{selection.length > 1 ? 's' : ''} · {groupes.length} formation{groupes.length > 1 ? 's' : ''}</p>

      {selection.length === 0 ? (
        <p className="text-slate-400 italic py-8">Aucune évaluation programmée avec ces critères.</p>
      ) : groupes.map((g, gi) => (
        <div key={gi} className="mb-8 break-inside-avoid-page">
          {/* Section par formation */}
          <div className="bg-slate-100 border-l-4 border-[#1e3a5f] rounded-r-lg px-3 py-2 mb-3">
            <p className="font-bold text-[#1e3a5f]">{g.nom}</p>
            <p className="text-[11px] text-slate-500">{g.pole}</p>
          </div>

          {/* Tableau récapitulatif */}
          <table className="w-full text-xs mb-4">
            <thead><tr className="bg-[#1e3a5f] text-white text-left">
              {['Type', 'Session', 'Promotion', 'Niveau', 'Semestre', 'Du', 'Au', 'Horaire quotidien', 'Statut'].map(h => <th key={h} className="px-2 py-2 font-bold">{h}</th>)}
            </tr></thead>
            <tbody>
              {g.evals.map(e => (
                <tr key={e.id} className="border-b border-slate-200">
                  <td className="px-2 py-2 font-semibold">{e.type_evaluation === 'DEVOIR' ? 'Devoir' : 'Examen'}</td>
                  <td className="px-2 py-2">{SESSION_CODE[e.session_num]}{e.groupe ? ` · ${e.groupe}` : ''}</td>
                  <td className="px-2 py-2">{e.promotion_code || '—'}</td>
                  <td className="px-2 py-2">{e.niveau || '—'}</td>
                  <td className="px-2 py-2">{e.semestre_code || '—'}</td>
                  <td className="px-2 py-2 whitespace-nowrap">{e.date_demarrage || '—'}</td>
                  <td className="px-2 py-2 whitespace-nowrap">{e.date_fin_prevue || '—'}</td>
                  <td className="px-2 py-2 whitespace-nowrap">{e.heure_debut ? `${e.heure_debut} – ${e.heure_fin || '—'}` : 'Journée entière'}</td>
                  <td className="px-2 py-2">{statut(e)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Détail par évaluation */}
          {g.evals.map(e => (
            <div key={e.id} className="border border-slate-200 rounded-xl p-4 mb-3 break-inside-avoid">
              <p className="font-bold text-[#1e3a5f]">
                {e.type_evaluation === 'DEVOIR' ? '📝 Devoir' : '🧪 Examen'} — {SESSION_LBL[e.session_num]}
                {e.promotion_code ? ` · ${e.promotion_code}` : ''}{e.niveau ? ` · ${e.niveau}` : ''}
                {e.semestre_code ? ` · Semestre ${e.semestre_code.replace('S', '')}` : ''}
                {e.groupe ? ` · ${e.groupe === 'G1' ? 'GROUPE 1' : 'GROUPE 2'}` : ''}
              </p>
              {/* Calendrier détaillé des épreuves (concepteur) : Dates | Matières (EC) | Heures */}
              {(() => {
                let eps = null;
                try { eps = e.epreuves ? JSON.parse(e.epreuves) : null; } catch { eps = null; }
                if (!eps || eps.length === 0) return null;
                return (
                  <table className="w-full text-xs mt-3 mb-1">
                    <thead><tr className="bg-slate-100 text-left">
                      {['Dates', 'Matières (EC)', 'Heures'].map(h => <th key={h} className="px-2.5 py-1.5 font-bold text-[#1e3a5f]">{h}</th>)}
                    </tr></thead>
                    <tbody>
                      {eps.map((ep, i) => (
                        <tr key={i} className="border-b border-slate-200 align-top">
                          <td className="px-2.5 py-1.5 font-semibold whitespace-nowrap capitalize">{fmtDate(ep.date)}</td>
                          <td className="px-2.5 py-1.5">
                            {(ep.matieres || []).length > 0
                              ? ep.matieres.map((m, j) => <p key={j} className="mb-0.5">{m}</p>)
                              : <span className="text-slate-400 italic">—</span>}
                          </td>
                          <td className="px-2.5 py-1.5 whitespace-nowrap">{ep.heure_debut ? `${ep.heure_debut} – ${ep.heure_fin || '—'}` : 'Journée entière'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                );
              })()}
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
        </div>
      ))}

      {/* Consignes officielles d'examen (affichées quand le document contient un calendrier détaillé) */}
      {selection.some(e => { try { return e.epreuves && JSON.parse(e.epreuves).length > 0; } catch { return false; } }) && (
        <div className="border-2 border-[#1e3a5f] rounded-xl p-4 mt-2 text-xs break-inside-avoid">
          <p className="font-bold text-[#1e3a5f] mb-2">NB : Les étudiants sont tenus d'apporter leur machine bien chargée et leur modem.</p>
          <ul className="list-disc pl-5 space-y-1 text-slate-700">
            <li>L'étudiant aura le choix de commencer par n'importe quelle épreuve. Il ne sortira de la salle d'examen qu'après avoir fait toutes les épreuves, sauf cas de force majeure.</li>
            <li>Une tenue vestimentaire correcte et décente est exigée en salle d'examen. Elle doit être exempte de toute excentricité (pantalons déchirés, tenues trop courtes, moulantes ou décolletées, sous-vêtements apparents, short…).</li>
            <li>Le port de casquettes, capuches ou bonnets est strictement interdit à l'intérieur de la salle d'examen ; ces accessoires doivent être retirés avant l'entrée en salle.</li>
            <li>L'usage de l'Intelligence Artificielle (IA) est strictement interdit. Tout usage avéré ou tentative d'usage de l'IA (ChatGPT, Copilot, Gemini, etc.) pour le traitement des épreuves entraîne une comparution devant le conseil de discipline.</li>
          </ul>
        </div>
      )}

      <p className="text-[10px] text-slate-400 text-center border-t border-slate-200 pt-3 mt-8">
        SUIVI PÉDAGOGIQUE — UnCHK · Document généré le {new Date().toLocaleDateString('fr-FR')} par {user?.prenom} {user?.nom} · Sous réserve de modifications publiées sur la plateforme
      </p>
    </div>
  );
}
