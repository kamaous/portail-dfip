import { useEffect, useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../lib/api';
import toast from 'react-hot-toast';
import { Plus, AlertTriangle, CheckCircle, MessageSquare, ChevronDown, LayoutGrid, GanttChartSquare, List } from 'lucide-react';
import { formatDistanceToNow, format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { useAuth } from '../context/AuthContext';
import PlageDates from '../components/PlageDates';
import { useTimeline, Overlays, BandeauVacances, EnTeteUnites, FondGrille, ZoomBar } from './PlanningAnnuel';

/* Segments = pôles + incidents généraux (sans pôle) */
const POLES_SEG = {
  LSHE: { color: '#6d28d9', light: '#f0e9fb' },
  STN: { color: '#16a34a', light: '#e8f6ec' },
  SEJA: { color: '#ea580c', light: '#fdeee3' },
  GENERAL: { color: '#475569', light: '#eef2f6' },
};
/* Couleur de barre selon la gravité */
const GRAVITE_BAR = { CRITIQUE: '#dc2626', HAUTE: '#f97316', MOYENNE: '#f59e0b', FAIBLE: '#94a3b8' };

const GRAVITE_STYLES = {
  CRITIQUE: 'bg-red-100 text-red-800 border border-red-300',
  HAUTE: 'bg-orange-100 text-orange-700',
  MOYENNE: 'bg-amber-100 text-amber-700',
  FAIBLE: 'bg-slate-100 text-slate-600',
};
const STATUT_STYLES = {
  OUVERT: 'bg-red-100 text-red-700',
  EN_COURS: 'bg-amber-100 text-amber-700',
  RESOLU: 'bg-green-100 text-green-700',
};
const TYPE_INCIDENT = {
  GREVE: 'Grève', FETE: 'Fête', FERIE: 'Férié', EVENEMENT: 'Évènement',
  INCIDENT_TECHNIQUE: 'Incident technique', AUTRE: 'Autre',
};
const CONSEQ_EVAL = {
  '': '— Aucune —', REPORT: 'Report évaluations', ANNULATION: 'Annulation',
  RALLONGE: 'Rallonge', ARRET: 'Arrêt', AUTRE: 'Autre',
};
const CONSEQ_TUTORAT = { '': '— Aucune —', RETARD: 'Retard' };
const NIVEAUX_INC = { L1: 'Licence 1', L2: 'Licence 2', L3: 'Licence 3', M1: 'Master 1', M2: 'Master 2' };
const SEMESTRES_INC = { L1: ['S1', 'S2'], L2: ['S3', 'S4'], L3: ['S5', 'S6'], M1: ['S1', 'S2'], M2: ['S3'] };

function ModalIncident({ poles, promotions, users, onClose, onCreated }) {
  const { user } = useAuth();
  const [form, setForm] = useState({
    titre: '', description: '', type_incident: 'AUTRE', gravite: 'FAIBLE',
    pole_ids: [], assigne_a: '', date_incident: '', date_debut: '', date_fin: '',
    conseq_eval: '', conseq_tutorat: '',
    promotion_id: '', formation_id: '', niveau: '', semestre_code: '', session_num: '',
    consequence_examens: '', consequence_tutorat: '', consequence_calendrier: ''
  });
  const [loading, setLoading] = useState(false);
  // Formations filtrables uniquement quand UN SEUL pôle est sélectionné
  const poleSel = form.pole_ids.length === 1 ? poles.find(p => p.id === form.pole_ids[0]) : null;
  const aConsequence = form.conseq_eval || form.conseq_tutorat;

  // « Tous les pôles » = liste vide ; sinon liste à choix multiples
  const basculerPole = (id) => setForm(f => ({
    ...f,
    pole_ids: id === null ? [] : (f.pole_ids.includes(id) ? f.pole_ids.filter(x => x !== id) : [...f.pole_ids, id]),
    formation_id: '', // la formation dépend du pôle sélectionné
  }));

  async function submit(e) {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post('/incidents', { ...form, pole_id: form.pole_ids });
      toast.success(form.pole_ids.length > 1 ? `Incident signalé pour ${form.pole_ids.length} pôles` : 'Incident signalé');
      onCreated();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b sticky top-0 bg-white">
          <h2 className="font-semibold text-slate-800">Signaler un incident</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-4">
          <div>
            <label className="text-sm font-medium text-slate-700 block mb-1">Nom de l'incident *</label>
            <input type="text" value={form.titre} onChange={e => setForm(f => ({ ...f, titre: e.target.value }))} placeholder="Ex: Grève des transports" required />
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700 block mb-1">Description détaillée *</label>
            <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={3} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium text-slate-700 block mb-1">Type *</label>
              <select value={form.type_incident} onChange={e => setForm(f => ({ ...f, type_incident: e.target.value }))}>
                {Object.entries(TYPE_INCIDENT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 block mb-1">Gravité</label>
              <select value={form.gravite} onChange={e => setForm(f => ({ ...f, gravite: e.target.value }))}>
                <option value="FAIBLE">Faible</option>
                <option value="MOYENNE">Moyenne</option>
                <option value="HAUTE">Haute</option>
                <option value="CRITIQUE">Critique</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium text-slate-700 block mb-1">
                Pôle(s) concerné(s) <span className="text-xs font-normal text-slate-400">(choix multiples)</span>
              </label>
              <div className="border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-50">
                <label className={`flex items-center gap-2.5 px-3 py-2 text-sm cursor-pointer hover:bg-slate-50 ${form.pole_ids.length === 0 ? 'bg-blue-50/70 font-semibold' : ''}`}>
                  <input type="checkbox" checked={form.pole_ids.length === 0} onChange={() => basculerPole(null)}
                    className="!w-4 !h-4 accent-[#1e3a5f] shrink-0" />
                  <span className="text-slate-700">Tous les pôles</span>
                </label>
                {poles.map(p => (
                  <label key={p.id} className={`flex items-center gap-2.5 px-3 py-2 text-sm cursor-pointer hover:bg-slate-50 ${form.pole_ids.includes(p.id) ? 'bg-blue-50/70' : ''}`}>
                    <input type="checkbox" checked={form.pole_ids.includes(p.id)} onChange={() => basculerPole(p.id)}
                      className="!w-4 !h-4 accent-[#1e3a5f] shrink-0" />
                    <span className="text-slate-700">{p.code}</span>
                    <span className="text-xs text-slate-400 truncate">{p.nom}</span>
                  </label>
                ))}
              </div>
              <p className="text-[11px] text-slate-400 mt-1">
                {form.pole_ids.length === 0 ? 'Incident général : visible sur tous les pôles.'
                  : `Un incident sera créé pour chacun des ${form.pole_ids.length} pôle(s) sélectionné(s).`}
              </p>
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 block mb-1">Assigné à</label>
              <select value={form.assigne_a} onChange={e => setForm(f => ({ ...f, assigne_a: e.target.value }))}>
                <option value="">Auto (si critique)</option>
                {users.map(u => <option key={u.id} value={u.id}>{u.prenom} {u.nom}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700 block mb-1">Période de l'incident (début → fin)</label>
            <PlageDates debut={form.date_debut} fin={form.date_fin}
              onChange={({ debut, fin }) => setForm(f => ({ ...f, date_debut: debut, date_incident: debut, date_fin: fin }))} />
          </div>

          <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 space-y-3">
            <p className="text-xs font-semibold text-amber-800 uppercase tracking-wide">Conséquences (suggèrent des réajustements du planning)</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">Sur les Évaluations</label>
                <select value={form.conseq_eval} onChange={e => setForm(f => ({ ...f, conseq_eval: e.target.value }))}>
                  {Object.entries(CONSEQ_EVAL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">Sur le Tutorat</label>
                <select value={form.conseq_tutorat} onChange={e => setForm(f => ({ ...f, conseq_tutorat: e.target.value }))}>
                  {Object.entries(CONSEQ_TUTORAT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1">Précisions (documentation de la conséquence)</label>
              <input value={form.consequence_calendrier} onChange={e => setForm(f => ({ ...f, consequence_calendrier: e.target.value }))} placeholder="Ex: décaler la clôture du S1 d'une semaine" />
            </div>

            {/* Périmètre de la conséquence */}
            {aConsequence && (
              <div className="border-t border-amber-200 pt-3 space-y-2">
                <p className="text-[11px] font-semibold text-amber-700">Périmètre concerné</p>
                <div className="grid grid-cols-2 gap-2">
                  <select value={form.promotion_id} onChange={e => setForm(f => ({ ...f, promotion_id: e.target.value }))} className="!text-xs !py-1.5">
                    <option value="">Promotion : toutes</option>
                    {promotions.map(p => <option key={p.id} value={p.id}>{p.code}</option>)}
                  </select>
                  <select value={form.formation_id} onChange={e => setForm(f => ({ ...f, formation_id: e.target.value }))} className="!text-xs !py-1.5">
                    <option value="">Formation : toutes</option>
                    {(poleSel?.formations || []).map(fo => <option key={fo.id} value={fo.id}>{fo.nom}</option>)}
                  </select>
                  <select value={form.niveau} onChange={e => setForm(f => ({ ...f, niveau: e.target.value, semestre_code: '' }))} className="!text-xs !py-1.5">
                    <option value="">Niveau : tous</option>
                    {Object.entries(NIVEAUX_INC).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                  <select value={form.semestre_code} onChange={e => setForm(f => ({ ...f, semestre_code: e.target.value }))} className="!text-xs !py-1.5" disabled={!form.niveau}>
                    <option value="">Semestre : tous</option>
                    {(SEMESTRES_INC[form.niveau] || []).map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <select value={form.session_num} onChange={e => setForm(f => ({ ...f, session_num: e.target.value }))} className="!text-xs !py-1.5 col-span-2">
                    <option value="">Session : toutes</option>
                    <option value="1">Session Normale</option>
                    <option value="2">Session de Rattrapage</option>
                    <option value="3">Session Spéciale</option>
                  </select>
                </div>
                {!poleSel && <p className="text-[11px] text-amber-600">💡 Sélectionnez UN SEUL pôle ci-dessus pour filtrer les formations.</p>}
              </div>
            )}
          </div>

          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Annuler</button>
            <button type="submit" disabled={loading} className="btn-danger flex-1">
              {loading ? 'Envoi...' : '🚨 Signaler'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* Boîte de dialogue de RÉSOLUTION : le Directeur DFIP décide, de façon documentée,
   de l'effet sur les dates de l'élément lié (prolonger / reporter / annuler / intact) */
function ModalResolution({ incident, onClose, onDone }) {
  const dureeIncident = incident.date_debut && incident.date_fin
    ? Math.max(1, Math.round((Date.parse(incident.date_fin) - Date.parse(incident.date_debut)) / 86400000))
    : 1;
  const [decision, setDecision] = useState('INTACT');
  const [jours, setJours] = useState(dureeIncident);
  const [nouvelleDate, setNouvelleDate] = useState('');
  const [nouvelleFin, setNouvelleFin] = useState('');
  const [resolution, setResolution] = useState('');
  const [loading, setLoading] = useState(false);

  // Éléments impactés (évaluations / tutorats du périmètre de l'incident) :
  // la décision leur est appliquée AUTOMATIQUEMENT — pré-cochés à l'ouverture
  const [candidats, setCandidats] = useState({ evaluations: [], tutorats: [] });
  const [selCibles, setSelCibles] = useState([]); // clés "TYPE|id"
  const cleC = (c) => `${c.type}|${c.id}`;
  useEffect(() => {
    api.get(`/incidents/${incident.id}/cibles`).then(r => {
      setCandidats(r.data);
      const tous = [...r.data.evaluations, ...r.data.tutorats];
      const lies = tous.filter(c => c.lie);
      setSelCibles((lies.length ? lies : tous).map(cleC)); // lié → lui seul, sinon tout le périmètre
    }).catch(() => {});
  }, [incident.id]);
  const nbSel = selCibles.length;
  const cible = nbSel === 0 ? '' : nbSel === 1 ? " de l'élément sélectionné" : ` des ${nbSel} éléments sélectionnés`;

  const DECISIONS = [
    ['PROLONGER', 'Prolonger / étendre les dates', `La date de fin${cible} est repoussée du nombre de jours indiqué (ex. +${dureeIncident} j si l'incident a duré ${dureeIncident} j).`],
    ['REPORTER', 'Reporter', `La période${cible} est décalée à partir d'une nouvelle date de début — la durée initiale est conservée.`],
    ['FIN_SEULE', 'Modifier uniquement la fin', `Seule la date de fin${cible} est remplacée par la nouvelle date indiquée.`],
    ['SUSPENDRE', 'Suspendre', `Les évaluations sélectionnées passent à l'état SUSPENDUE (reprise possible) ; la suspension des tutorats est documentée dans leurs fiches.`],
    ['ANNULER', 'Annuler', `Les évaluations sélectionnées passent à l'état ANNULÉE ; l'arrêt des tutorats est documenté dans leurs fiches.`],
    ['INTACT', 'Garder les dates intactes', 'Aucune modification de dates — la décision et sa justification sont documentées.'],
  ];

  async function valider() {
    setLoading(true);
    try {
      const r = await api.post(`/incidents/${incident.id}/resoudre`, {
        decision, jours: decision === 'PROLONGER' ? Number(jours) : undefined,
        nouvelle_date: decision === 'REPORTER' ? nouvelleDate : undefined,
        nouvelle_fin: decision === 'FIN_SEULE' ? nouvelleFin : undefined,
        cibles: selCibles.map(k => { const [type, id] = k.split('|'); return { type, id: Number(id) }; }),
        resolution: resolution.trim(),
      });
      toast.success(r.data?.message || 'Incident résolu', { duration: 6000 });
      onDone(); onClose();
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
    finally { setLoading(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto nav-scroll">
        <div className="px-5 py-4 bg-[#1e3a5f] text-white">
          <h2 className="font-bold">⚖ Résolution de l'incident — décision du Directeur DFIP</h2>
          <p className="text-xs text-white/75 mt-0.5">{incident.gravite} · {incident.titre}</p>
        </div>
        <div className="p-5 space-y-4">
          <div className="bg-slate-50 rounded-xl p-3 text-xs text-slate-600 space-y-1">
            <p><strong>Description :</strong> {incident.description}</p>
            <p><strong>Période de l'incident :</strong> {(incident.date_debut || incident.date_incident) || '—'}{incident.date_fin ? ` → ${incident.date_fin}` : ''} ({dureeIncident} jour(s))</p>
          </div>

          {/* Éléments impactés : la décision s'y applique AUTOMATIQUEMENT */}
          <div>
            <p className="text-sm font-semibold text-slate-700 mb-1">
              Éléments impactés <span className="text-xs font-normal text-slate-400">({nbSel} sélectionné(s) — la décision s'y appliquera automatiquement)</span>
            </p>
            {candidats.evaluations.length + candidats.tutorats.length === 0 ? (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-xl p-2.5">
                Aucune évaluation ni fiche de tutorat ne chevauche la période de cet incident sur ce périmètre —
                la décision sera documentée sans modification automatique de dates.
              </p>
            ) : (
              <div className="border border-slate-200 rounded-xl max-h-44 overflow-y-auto nav-scroll divide-y divide-slate-50">
                {[...candidats.evaluations, ...candidats.tutorats].map(c => (
                  <label key={cleC(c)} className={`flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer hover:bg-slate-50 ${selCibles.includes(cleC(c)) ? 'bg-blue-50/70' : ''}`}>
                    <input type="checkbox" checked={selCibles.includes(cleC(c))}
                      onChange={() => setSelCibles(s => s.includes(cleC(c)) ? s.filter(x => x !== cleC(c)) : [...s, cleC(c)])}
                      className="!w-3.5 !h-3.5 accent-[#1e3a5f] shrink-0" />
                    <span>{c.type === 'TUTORAT' ? '📚' : '🧪'}</span>
                    <span className="text-slate-700 truncate">{c.libelle}</span>
                    {c.lie && <span className="badge bg-blue-100 text-blue-700 text-[10px] ml-auto shrink-0">🔗 lié</span>}
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <p className="text-sm font-semibold text-slate-700">Décision *</p>
            {DECISIONS.map(([val, titre, desc]) => (
              <label key={val} className={`block border-2 rounded-xl p-3 cursor-pointer transition-colors ${decision === val ? 'border-[#1e3a5f] bg-blue-50/60' : 'border-slate-200 hover:border-slate-300'}`}>
                <span className="flex items-center gap-2">
                  <input type="radio" name="decision" checked={decision === val} onChange={() => setDecision(val)} className="!w-4 !h-4 accent-[#1e3a5f]" />
                  <span className="text-sm font-semibold text-slate-800">{titre}</span>
                </span>
                <span className="block text-xs text-slate-500 mt-1 ml-6">{desc}</span>
                {val === 'PROLONGER' && decision === 'PROLONGER' && (
                  <span className="flex items-center gap-2 mt-2 ml-6 text-xs">
                    Prolonger de
                    <input type="number" min="1" max="365" value={jours} onChange={e => setJours(e.target.value)} className="!w-20 !py-1 !text-xs" />
                    jour(s)
                  </span>
                )}
                {val === 'REPORTER' && decision === 'REPORTER' && (
                  <span className="flex items-center gap-2 mt-2 ml-6 text-xs">
                    Nouvelle date de début
                    <input type="date" value={nouvelleDate} onChange={e => setNouvelleDate(e.target.value)} className="!w-auto !py-1 !text-xs" />
                  </span>
                )}
                {val === 'FIN_SEULE' && decision === 'FIN_SEULE' && (
                  <span className="flex items-center gap-2 mt-2 ml-6 text-xs">
                    Nouvelle date de fin
                    <input type="date" value={nouvelleFin} onChange={e => setNouvelleFin(e.target.value)} className="!w-auto !py-1 !text-xs" />
                  </span>
                )}
              </label>
            ))}
          </div>

          <div>
            <label className="text-sm font-semibold text-slate-700 block mb-1">Résolution documentée *</label>
            <textarea value={resolution} onChange={e => setResolution(e.target.value)} rows={3}
              placeholder="Décrivez clairement la décision, sa justification et les mesures prises..." />
          </div>

          <div className="flex gap-2">
            <button onClick={onClose} className="btn-secondary flex-1">Annuler</button>
            <button onClick={valider}
              disabled={loading || !resolution.trim() || (decision === 'PROLONGER' && !(Number(jours) > 0)) || (decision === 'REPORTER' && !nouvelleDate) || (decision === 'FIN_SEULE' && !nouvelleFin)}
              className="btn-primary flex-1 disabled:opacity-40">
              {loading ? '...' : '✓ Résoudre l\'incident'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function IncidentCard({ incident, onRefresh }) {
  const { user } = useAuth();
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState(null);
  const [comment, setComment] = useState('');
  const [resoudre, setResoudre] = useState(false);

  async function loadDetail() {
    if (detail) { setExpanded(v => !v); return; }
    const r = await api.get(`/incidents/${incident.id}`);
    setDetail(r.data);
    setExpanded(true);
  }

  async function changerStatut(statut) {
    await api.put(`/incidents/${incident.id}/statut`, { statut });
    toast.success('Statut mis à jour');
    onRefresh();
  }

  async function ajouterComment() {
    if (!comment.trim()) return;
    await api.post(`/incidents/${incident.id}/commentaires`, { contenu: comment });
    setComment('');
    const r = await api.get(`/incidents/${incident.id}`);
    setDetail(r.data);
    toast.success('Commentaire ajouté');
  }

  const canResolve = ['DIRECTEUR', 'CHEF_SERVICE', 'ADMIN_PORTAIL'].includes(user?.role) || incident.assigne_a === user?.id;
  // La résolution DÉCISIONNELLE (effet sur les dates) appartient au Directeur DFIP
  const canDecider = ['DIRECTEUR', 'ADMIN_PORTAIL'].includes(user?.role);

  return (
    <div className="card hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className={`badge ${GRAVITE_STYLES[incident.gravite]}`}>{incident.gravite}</span>
            <span className={`badge ${STATUT_STYLES[incident.statut]}`}>{incident.statut}</span>
            <span className="badge bg-slate-100 text-slate-600">{incident.type_incident}</span>
          </div>
          <h3 className="font-medium text-slate-800">{incident.titre}</h3>
          <p className="text-sm text-slate-500 mt-1 line-clamp-2">{incident.description}</p>
          <div className="flex items-center gap-4 mt-2 text-xs text-slate-400 flex-wrap">
            <span>Signalé par : {incident.signale_par_prenom} {incident.signale_par_nom}</span>
            {incident.assigne_a_nom && <span>Assigné à : {incident.assigne_a_prenom} {incident.assigne_a_nom}</span>}
            {incident.pole_nom && <span>Pôle : {incident.pole_nom}</span>}
            {incident.created_at && <span>📅 Déclaré le {format(new Date(incident.created_at), 'dd/MM/yyyy HH:mm')}</span>}
            {incident.date_incident && <span>Survenu le {format(new Date(incident.date_incident), 'dd/MM/yyyy')}</span>}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {canResolve && incident.statut === 'OUVERT' && (
            <button onClick={() => changerStatut('EN_COURS')} className="p-1.5 text-amber-600 hover:bg-amber-50 rounded-lg text-xs font-medium" title="Prendre en charge">
              Prendre en charge
            </button>
          )}
          {canDecider && incident.statut !== 'RESOLU' && (
            <button onClick={() => setResoudre(true)} className="p-1.5 text-green-600 hover:bg-green-50 rounded-lg flex items-center gap-1 text-xs font-medium" title="Résoudre (décision du DFIP : prolonger / reporter / annuler / intact)">
              <CheckCircle size={16} /> Résoudre
            </button>
          )}
          <button onClick={loadDetail} className="p-1.5 text-slate-400 hover:bg-slate-100 rounded-lg">
            <ChevronDown size={16} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </button>
        </div>
      </div>

      {resoudre && <ModalResolution incident={incident} onClose={() => setResoudre(false)} onDone={onRefresh} />}

      {expanded && detail && (
        <div className="mt-4 pt-4 border-t border-slate-100">
          {detail.resolution && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-3 mb-3 text-sm text-green-800">
              <strong>Résolution :</strong> {detail.resolution}
            </div>
          )}
          {detail.historique?.length > 0 && (
            <div className="mb-3">
              <h4 className="text-xs font-semibold text-slate-500 uppercase mb-2">Historique des décisions</h4>
              <div className="space-y-1.5">
                {detail.historique.map(h => (
                  <div key={h.id} className="bg-slate-50 border border-slate-100 rounded-lg px-3 py-2 text-xs">
                    <p><span className="font-bold text-slate-700">{(h.created_at || '').slice(0, 16).replace('T', ' ')}</span> · <span className="badge bg-blue-100 text-blue-700 text-[10px]">{h.decision}</span> {h.prenom ? <span className="text-slate-400">par {h.prenom} {h.nom}</span> : null}</p>
                    {h.detail && <p className="text-slate-600 mt-0.5">{h.detail}</p>}
                    {h.apres && <p className="text-slate-500 mt-0.5">↳ {h.apres}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}
          <h4 className="text-xs font-semibold text-slate-500 uppercase mb-2">Commentaires ({detail.commentaires?.length || 0})</h4>
          <div className="space-y-2 mb-3 max-h-48 overflow-y-auto">
            {detail.commentaires?.map(c => (
              <div key={c.id} className="bg-slate-50 rounded-lg p-3">
                <p className="text-xs font-semibold text-slate-700">{c.prenom} {c.nom}</p>
                <p className="text-sm text-slate-600 mt-0.5">{c.contenu}</p>
                <p className="text-xs text-slate-400 mt-1">
                  {formatDistanceToNow(new Date(c.created_at), { addSuffix: true, locale: fr })}
                </p>
              </div>
            ))}
            {!detail.commentaires?.length && <p className="text-xs text-slate-400">Aucun commentaire</p>}
          </div>
          <div className="flex gap-2">
            <input type="text" value={comment} onChange={e => setComment(e.target.value)} placeholder="Ajouter un commentaire..." className="flex-1" onKeyDown={e => e.key === 'Enter' && ajouterComment()} />
            <button onClick={ajouterComment} className="btn-primary px-3">Envoyer</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Incidents() {
  const { user } = useAuth();
  const [incidents, setIncidents] = useState([]);
  const [stats, setStats] = useState(null);
  const [poles, setPoles] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchParams, setSearchParams] = useSearchParams();
  const [filtreStatut, setFiltreStatut] = useState('');
  const [filtreGravite, setFiltreGravite] = useState(searchParams.get('gravite') || '');
  const [modal, setModal] = useState(false);
  const [vue, setVue] = useState('LISTE');        // LISTE (par défaut) | PLANNING
  const [segment, setSegment] = useState(null);   // null = tous, sinon code pôle ou GENERAL
  const [zoom, setZoom] = useState({ mode: 'ANNEE' });
  const [detailId, setDetailId] = useState(null);
  const [annees, setAnnees] = useState([]);
  const [promotions, setPromotions] = useState([]);
  const [vacances, setVacances] = useState([]);
  const [feries, setFeries] = useState([]);

  function load() {
    setLoading(true);
    const qs = new URLSearchParams();
    if (filtreStatut) qs.set('statut', filtreStatut);
    if (filtreGravite) qs.set('gravite', filtreGravite);
    Promise.all([
      api.get(`/incidents${qs.toString() ? `?${qs}` : ''}`),
      api.get('/incidents/stats'),
      api.get('/poles'),
      api.get('/poles/promotions'),
      api.get('/users'),
      api.get('/dashboard/annees'),
      api.get('/calendrier-academique/vacances'),
      api.get('/calendrier-academique/feries'),
    ]).then(([inc, s, p, pr, u, a, v, f]) => {
      setIncidents(inc.data);
      setStats(s.data);
      setPoles(p.data);
      setPromotions(pr.data);
      setUsers(u.data);
      setAnnees(a.data); setVacances(v.data); setFeries(f.data);
    }).finally(() => setLoading(false));
  }

  useEffect(load, [filtreStatut, filtreGravite]);

  const anneeActive = annees.find(a => a.active);
  const tl = useTimeline(anneeActive?.libelle || '', zoom);
  const feriesRange = useMemo(() => {
    const out = [];
    for (const f of feries) {
      if (f.recurrent) {
        const mmdd = f.date.slice(5);
        [tl.start.getFullYear(), tl.end.getFullYear()].forEach(y => {
          const d = `${y}-${mmdd}`;
          if (new Date(d) >= tl.start && new Date(d) <= tl.end) out.push({ ...f, date: d });
        });
      } else if (new Date(f.date) >= tl.start && new Date(f.date) <= tl.end) out.push(f);
    }
    return out;
  }, [feries, tl]);

  // Code pôle de chaque incident (GENERAL si aucun pôle)
  const codePole = (inc) => poles.find(p => p.id === inc.pole_id)?.code || 'GENERAL';
  const incidentsAffiches = segment ? incidents.filter(i => codePole(i) === segment) : incidents;
  const incidentDetail = incidents.find(i => i.id === detailId);
  const groupes = [...poles.map(p => ({ code: p.code, nom: p.nom })), { code: 'GENERAL', nom: 'Incidents généraux (sans pôle)' }];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Incidents</h1>
          <p className="text-slate-500 text-sm">{incidents.length} incident(s)</p>
        </div>
        {/* Remontée réservée : Responsables pédagogiques, Chef div DFE, Chef div Technopédagogie */}
        {['RESPONSABLE_PEDAGOGIQUE', 'CHEF_DIV_EVALUATION', 'CHEF_DIV_TECHNOPEDAGOGIE', 'DIRECTEUR', 'ADMIN_PORTAIL'].includes(user?.role) && (
          <button onClick={() => setModal(true)} className="btn-danger flex items-center gap-2">
            <Plus size={16} /> Signaler un incident
          </button>
        )}
      </div>

      {/* Stats rapides */}
      {stats && (
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: 'Total', value: stats.total, color: 'text-slate-800' },
            { label: 'Ouverts', value: stats.ouverts, color: 'text-red-600' },
            ...(stats.by_gravite || []).filter(g => g.gravite === 'CRITIQUE').map(g => ({ label: 'Critiques', value: g.cnt, color: 'text-red-800' })),
          ].map((s, i) => (
            <div key={i} className="card text-center py-3">
              <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
              <p className="text-xs text-slate-500">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Segments pôles + zoom + bascule de vue */}
      <div className="card !p-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setSegment(null)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold border-2 transition-all ${
              segment === null ? 'bg-slate-800 text-white border-slate-800 shadow-md' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
            }`}
          >
            <LayoutGrid size={15} /> Tous
          </button>
          {groupes.map(g => {
            const seg = POLES_SEG[g.code] || POLES_SEG.GENERAL;
            const actif = segment === g.code;
            const nb = incidents.filter(i => codePole(i) === g.code).length;
            return (
              <button
                key={g.code}
                onClick={() => setSegment(actif ? null : g.code)}
                title={g.nom}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold border-2 transition-all ${actif ? 'text-white shadow-md scale-105' : 'bg-white hover:scale-[1.02]'}`}
                style={actif ? { background: seg.color, borderColor: seg.color } : { color: seg.color, borderColor: `${seg.color}55` }}
              >
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: actif ? '#fff' : seg.color }} />
                {g.code === 'GENERAL' ? 'Général' : g.code}
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${actif ? 'bg-white/25' : 'bg-slate-100 text-slate-500'}`}>{nb}</span>
              </button>
            );
          })}
          <div className="ml-auto flex items-center gap-2 flex-wrap">
            {vue === 'PLANNING' && <ZoomBar zoom={zoom} setZoom={setZoom} libelle={anneeActive?.libelle || ''} />}
            <div className="flex rounded-xl border border-slate-200 overflow-hidden">
              {[['PLANNING', GanttChartSquare, 'Planning'], ['LISTE', List, 'Liste']].map(([v, Icon, label]) => (
                <button key={v} onClick={() => setVue(v)}
                  className={`flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium transition-colors ${vue === v ? 'bg-[#1e3a5f] text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
                  <Icon size={15} /> {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Filtres statut */}
      <div className="flex gap-2 flex-wrap items-center">
        <span className="text-xs text-slate-400 font-medium mr-1">Statut :</span>
        {['', 'OUVERT', 'EN_COURS', 'RESOLU'].map(s => (
          <button key={s} onClick={() => setFiltreStatut(s)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${filtreStatut === s ? 'bg-[#1e3a5f] text-white' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'}`}>
            {s || 'Tous'}
          </button>
        ))}
      </div>

      {/* Filtres gravité */}
      <div className="flex gap-2 flex-wrap items-center">
        <span className="text-xs text-slate-400 font-medium mr-1">Gravité :</span>
        {['', 'CRITIQUE', 'HAUTE', 'MOYENNE', 'FAIBLE'].map(g => (
          <button key={g} onClick={() => { setFiltreGravite(g); setSearchParams(g ? { gravite: g } : {}); }}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${filtreGravite === g ? 'bg-red-600 text-white' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'}`}>
            {g || 'Toutes'}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-32">
          <div className="w-6 h-6 border-4 border-red-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : incidentsAffiches.length === 0 ? (
        <div className="card text-center py-12 text-slate-400">
          <AlertTriangle size={40} className="mx-auto mb-2 opacity-30" />
          <p>Aucun incident{segment ? ` pour ${segment === 'GENERAL' ? 'la catégorie Général' : `le pôle ${segment}`}` : ''}</p>
        </div>
      ) : vue === 'LISTE' ? (
        /* ===== Vue LISTE (par défaut) : tableau détaillé ===== */
        <div className="card !p-0 overflow-x-auto nav-scroll">
          <table className="w-full text-sm min-w-[1050px]">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-left">
                {['Gravité', 'Statut', 'Type', 'Incident', 'Pôle', 'Déclaré le', 'Période', 'Conséq. évaluations', 'Conséq. tutorat', 'Signalé par', 'Assigné à', ''].map((h, i) => (
                  <th key={i} className="px-3 py-2.5 text-[11px] font-bold uppercase tracking-wide text-slate-500 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {incidentsAffiches.map(i => (
                <tr key={i.id} onClick={() => setDetailId(i.id)}
                  className={`border-b border-slate-50 hover:bg-slate-50/70 cursor-pointer ${i.statut === 'RESOLU' ? 'opacity-60' : ''}`}>
                  <td className="px-3 py-2"><span className={`badge ${GRAVITE_STYLES[i.gravite]} text-[11px]`}>{i.gravite}</span></td>
                  <td className="px-3 py-2"><span className={`badge ${STATUT_STYLES[i.statut]} text-[11px]`}>{i.statut === 'RESOLU' ? '✓ RÉSOLU' : i.statut.replace('_', ' ')}</span></td>
                  <td className="px-3 py-2 text-xs text-slate-500 whitespace-nowrap">{i.type_incident}</td>
                  <td className="px-3 py-2">
                    <p className="font-medium text-slate-800 line-clamp-1" title={i.titre}>{i.titre}</p>
                    <p className="text-xs text-slate-400 line-clamp-1" title={i.description}>{i.description}</p>
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-600 whitespace-nowrap">
                    {i.pole_nom ? codePole(i) : 'Général'}
                    {(i.niveau || i.semestre_code) && <span className="text-slate-400"> · {i.niveau || ''} {i.semestre_code || ''}</span>}
                    {i.session_num && <span className="text-slate-400"> · S{i.session_num}</span>}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-600 whitespace-nowrap tabular-nums">{(i.created_at || '').slice(0, 10) || '—'}</td>
                  <td className="px-3 py-2 text-xs text-slate-600 whitespace-nowrap tabular-nums">
                    {(i.date_debut || i.date_incident) || '—'}{i.date_fin ? ` → ${i.date_fin}` : ''}
                  </td>
                  <td className="px-3 py-2 text-xs whitespace-nowrap">
                    {(i.conseq_eval || i.consequence_examens)
                      ? <span className="badge bg-red-100 text-red-700 text-[10px]">{i.conseq_eval || i.consequence_examens}</span> : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-3 py-2 text-xs whitespace-nowrap">
                    {(i.conseq_tutorat || i.consequence_tutorat)
                      ? <span className="badge bg-orange-100 text-orange-700 text-[10px]">{i.conseq_tutorat || i.consequence_tutorat}</span> : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-500 whitespace-nowrap">{i.signale_par_prenom} {i.signale_par_nom}</td>
                  <td className="px-3 py-2 text-xs text-slate-500 whitespace-nowrap">{i.assigne_a_nom ? `${i.assigne_a_prenom} ${i.assigne_a_nom}` : '—'}</td>
                  <td className="px-3 py-2 text-right"><ChevronDown size={14} className="-rotate-90 text-slate-300" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        /* ===== Vue PLANNING : pôle → un incident par ligne, barre = durée ===== */
        <div className="card !p-0 overflow-x-auto nav-scroll">
          <div className="min-w-[1100px]">
            <div className="flex sticky top-0 bg-white z-10 border-b border-slate-200">
              <div className="w-64 shrink-0 px-3 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wide border-r border-slate-200">
                Pôles / Incidents
              </div>
              <EnTeteUnites tl={tl} />
            </div>

            <BandeauVacances vacances={vacances} feries={feriesRange} tl={tl} />

            {groupes.filter(g => !segment || g.code === segment).map(g => {
              const seg = POLES_SEG[g.code] || POLES_SEG.GENERAL;
              const incs = incidentsAffiches.filter(i => codePole(i) === g.code);
              const focus = segment === g.code;
              if (incs.length === 0 && segment !== g.code) return null; // en vue globale, masquer les groupes vides
              return (
                <div key={g.code} className="border-b border-slate-100 last:border-0">
                  <div className={`flex items-center gap-2 px-3 ${focus ? 'py-3' : 'py-2'}`} style={{ background: seg.light }}>
                    <span className={`font-bold ${focus ? 'text-base' : 'text-sm'}`} style={{ color: seg.color }}>{g.nom}</span>
                    <span className="text-xs text-slate-400 ml-auto">{incs.length} incident(s)</span>
                  </div>
                  {incs.length === 0 && <p className="text-xs text-slate-400 italic px-3 py-2">Aucun incident</p>}
                  {incs.map(inc => {
                    const debut = inc.date_debut || inc.date_incident;
                    const fin = inc.date_fin || inc.date_resolution || debut;
                    const resolu = inc.statut === 'RESOLU';
                    return (
                      <div key={inc.id} className="flex border-t border-slate-50">
                        <div className={`w-64 shrink-0 px-3 border-r border-slate-100 ${focus ? 'py-3.5 text-sm' : 'py-2 text-xs'}`}>
                          <span className={`line-clamp-2 font-medium ${resolu ? 'text-slate-400 line-through' : 'text-slate-600'}`} title={inc.titre}>
                            {inc.titre}
                          </span>
                        </div>
                        <div className={`flex-1 relative ${focus ? 'h-12' : 'h-9'}`}>
                          <FondGrille tl={tl} />
                          <Overlays vacances={vacances} feries={feriesRange} tl={tl} />
                          {debut && (() => {
                            const lr = tl.pctRaw(debut), rr = tl.pctRaw(fin);
                            if (rr <= 0 || lr >= 100) return null;
                            const l = Math.max(0, lr);
                            const w = Math.max(Math.min(100, rr) - l, tl.mode === 'MOIS' ? 2.5 : 1.2);
                            return (
                              <div onClick={() => setDetailId(inc.id)}
                                title={`${inc.titre} : ${debut}${fin !== debut ? ' → ' + fin : ''} — ${inc.gravite} · ${inc.statut} (cliquer pour détails)`}
                                className={`absolute rounded-md flex items-center px-2 font-semibold text-white shadow-sm overflow-hidden cursor-pointer hover:opacity-85 hover:ring-2 hover:ring-white/60 ${focus ? 'top-1.5 bottom-1.5 text-xs' : 'top-1 bottom-1 text-[10px]'} ${resolu ? 'opacity-50' : ''}`}
                                style={{ left: `${l}%`, width: `${w}%`, background: GRAVITE_BAR[inc.gravite] || '#94a3b8' }}>
                                <span className="truncate">{resolu ? '✓ ' : ''}{inc.gravite} · {inc.consequence_examens || inc.consequence_tutorat || inc.type_incident}</span>
                              </div>
                            );
                          })()}
                          {!debut && (
                            <button onClick={() => setDetailId(inc.id)}
                              className="absolute top-1 bottom-1 left-[1%] rounded-md border-2 border-dashed border-slate-300 bg-white px-1.5 text-[10px] font-semibold text-slate-400 flex items-center">
                              sans date
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Légende de la vue planning */}
      {vue === 'PLANNING' && !loading && (
        <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500">
          {Object.entries(GRAVITE_BAR).map(([g, c]) => (
            <span key={g} className="flex items-center gap-1.5"><span className="w-3 h-3 rounded" style={{ background: c }} /> {g}</span>
          ))}
          <span>✓ barre estompée = résolu · Cliquez sur une barre pour la fiche complète.</span>
        </div>
      )}

      {modal && <ModalIncident poles={poles} promotions={promotions} users={users} onClose={() => setModal(false)} onCreated={load} />}

      {/* Popup détails d'un incident (depuis la vue planning) */}
      {incidentDetail && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setDetailId(null)}>
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto nav-scroll" onClick={e => e.stopPropagation()}>
            <IncidentCard incident={incidentDetail} onRefresh={load} />
            <button onClick={() => setDetailId(null)} className="w-full mt-2 bg-white/90 rounded-xl py-2 text-sm text-slate-500 hover:text-slate-700">
              Fermer
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
