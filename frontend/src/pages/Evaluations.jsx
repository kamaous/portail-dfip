import { useEffect, useState, useMemo } from 'react';
import api from '../lib/api';
import toast from 'react-hot-toast';
import { Plus, ClipboardCheck, Trash2, Calendar, Gavel, LayoutGrid, GanttChartSquare, List, CheckSquare } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { SelecteurCursus, NIVEAUX, CalendrierMois } from './Tutorat';
import { BoutonSignaler, PanneauSignalements } from '../components/Signalements';
import PlageDates from '../components/PlageDates';
import PanneauIncidents from '../components/PanneauIncidents';

export const SESSION_LABEL = { 1: 'Session Normale', 2: 'Session de Rattrapage', 3: 'Session Spéciale' };
export const SESSION_CODE = { 1: 'SN', 2: 'SR', 3: 'SS' }; // Normale / Rattrapage / Spéciale
const TYPE_EVAL = {
  EVALUATION: { label: 'Évaluation', color: 'bg-blue-100 text-blue-700' },
  DEVOIR: { label: 'Devoir', color: 'bg-cyan-100 text-cyan-700' },
};
const RECEPTION = {
  options: { PAS_DISPONIBLE: 'Pas encore disponible', EN_COURS_COLLECTE: 'En cours de collecte', DISPONIBLE: 'Disponible' },
  colors: { PAS_DISPONIBLE: 'bg-slate-100 text-slate-600', EN_COURS_COLLECTE: 'bg-amber-100 text-amber-700', DISPONIBLE: 'bg-green-100 text-green-700' },
};
const IMPLEMENTATION = {
  options: { PAS_ENCORE: 'Pas encore', EN_COURS: 'En cours', TERMINE: 'Terminé' },
  colors: { PAS_ENCORE: 'bg-slate-100 text-slate-600', EN_COURS: 'bg-amber-100 text-amber-700', TERMINE: 'bg-green-100 text-green-700' },
};
const ETAT_EVAL = {
  options: { CALENDRIER_DISPONIBLE: 'Calendrier disponible', EVAL_EN_COURS: 'Évaluations en cours', EVAL_TERMINEES: 'Évaluations terminées' },
  colors: { CALENDRIER_DISPONIBLE: 'bg-blue-100 text-blue-700', EVAL_EN_COURS: 'bg-amber-100 text-amber-700', EVAL_TERMINEES: 'bg-green-100 text-green-700' },
};
const DELIB = {
  options: { PAS_ENCORE: 'Pas encore', PREVUE: 'Prévue le', TERMINEE: 'Effective (clôturée)' },
  colors: { PAS_ENCORE: 'bg-slate-100 text-slate-600', PREVUE: 'bg-purple-100 text-purple-700', TERMINEE: 'bg-green-100 text-green-700' },
};

/* Progression d'une évaluation — quota officiel :
   Réception des épreuves Disponible 10 % · Date prévue valide 15 % ·
   Implémentation terminée 25 % · Évaluations terminées 20 % · Délibération effective 30 % */
export function progressionEval(s) {
  return (s.reception_epreuves === 'DISPONIBLE' ? 0.10 : 0)
    + (s.date_programmation ? 0.15 : 0)
    + (s.implementation_epreuves === 'TERMINE' ? 0.25 : 0)
    + (s.etat_eval === 'EVAL_TERMINEES' ? 0.20 : 0)
    + (s.delib_etat === 'TERMINEE' ? 0.30 : 0);
}

const POLES_SEG = {
  LSHE: { color: '#6d28d9', light: '#f0e9fb' },
  STN: { color: '#16a34a', light: '#e8f6ec' },
  SEJA: { color: '#ea580c', light: '#fdeee3' },
};
const ETAT_BAR = { CALENDRIER_DISPONIBLE: null, EVAL_EN_COURS: '#f59e0b', EVAL_TERMINEES: '#16a34a' };

/* ===== Modal de création (Responsable de formation, dates dans les plages du planning) ===== */
function ModalEvaluation({ poles, promotions, annees, user, defaultDate, onClose, onCreated, onConflit }) {
  const estRF = user?.role === 'RESPONSABLE_PEDAGOGIQUE'; // pôle verrouillé pour le Responsable pédagogique
  const [form, setForm] = useState({
    annee_id: annees.find(a => a.active)?.id || '',
    pole_id: estRF && user?.pole_id ? String(user.pole_id) : '',
    formation_id: '', promotion_id: '', niveau: '', semestre_code: '',
    session_num: 1, type_evaluation: 'EVALUATION', date_demarrage: defaultDate || '', date_fin_prevue: '',
  });
  const [plages, setPlages] = useState(null);
  const [loading, setLoading] = useState(false);

  // Charger les plages autorisées dès qu'un pôle est choisi
  useEffect(() => {
    if (!form.pole_id || !form.annee_id) { setPlages(null); return; }
    api.get(`/evaluations/plages?annee_id=${form.annee_id}&pole_id=${form.pole_id}`)
      .then(r => setPlages(r.data)).catch(() => setPlages([]));
  }, [form.pole_id, form.annee_id]);

  const horsPlage = plages?.length > 0 && form.date_demarrage && form.date_fin_prevue &&
    !plages.some(p => form.date_demarrage >= p.date_debut && form.date_fin_prevue <= p.date_fin);

  // Pré-contrôle du conflit inter-pôles en direct
  const [conflitsLive, setConflitsLive] = useState([]);
  useEffect(() => {
    setConflitsLive([]);
    if (!form.pole_id || !form.annee_id || !form.date_demarrage) return;
    api.post('/evaluations/check-conflit', {
      annee_id: form.annee_id, pole_id: form.pole_id,
      date_demarrage: form.date_demarrage, date_fin_prevue: form.date_fin_prevue,
    }).then(r => setConflitsLive(r.data.conflits || [])).catch(() => {});
  }, [form.pole_id, form.annee_id, form.date_demarrage, form.date_fin_prevue]);

  async function submit(e) {
    e.preventDefault();
    if (!form.formation_id) return toast.error('Sélectionnez une formation');
    if (!form.date_demarrage || !form.date_fin_prevue) return toast.error('Dates de démarrage et de clôture requises');
    setLoading(true);
    try {
      await api.post('/evaluations', form);
      toast.success('Évaluation enregistrée — concernés notifiés');
      onCreated(); onClose();
    } catch (err) {
      if (err.response?.data?.conflit) {
        onConflit(err.response.data);   // popup explicite de conflit inter-pôles
      } else {
        toast.error(err.response?.data?.error || 'Erreur', { duration: 6000 });
      }
    } finally { setLoading(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b sticky top-0 bg-white z-10">
          <h2 className="font-semibold text-slate-800">Nouvelle évaluation</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-sm font-medium text-slate-700 block mb-1">Année *</label>
              <select value={form.annee_id} onChange={e => setForm(f => ({ ...f, annee_id: e.target.value }))} required>
                <option value="">Choisir...</option>
                {annees.map(a => <option key={a.id} value={a.id}>{a.libelle}{a.active ? ' (active)' : ''}</option>)}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 block mb-1">Type *</label>
              <select value={form.type_evaluation} onChange={e => setForm(f => ({ ...f, type_evaluation: e.target.value }))}>
                <option value="EVALUATION">Évaluation</option>
                <option value="DEVOIR">Devoir</option>
              </select>
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 block mb-1">Session *</label>
              <select value={form.session_num} onChange={e => setForm(f => ({ ...f, session_num: parseInt(e.target.value) }))}>
                <option value={1}>Normale</option>
                <option value={2}>Rattrapage</option>
                <option value={3}>Spéciale</option>
              </select>
            </div>
          </div>

          <SelecteurCursus poles={poles} promotions={promotions} form={form} setForm={setForm} lockPole={estRF} />

          {/* Plages autorisées (Planning annuel) */}
          {form.pole_id && plages !== null && (
            plages.length > 0 ? (
              <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-xs text-blue-800">
                📅 <strong>Plages d'évaluations du Planning annuel :</strong>{' '}
                {plages.map((p, i) => <span key={i} className="inline-block bg-white rounded-lg px-2 py-0.5 mx-0.5 font-semibold">{p.date_debut} → {p.date_fin}</span>)}
                <br />Les dates doivent impérativement s'y inscrire.
              </div>
            ) : (
              <div className="bg-red-50 border border-red-100 rounded-xl p-3 text-xs text-red-700">
                ⚠️ Aucune plage d'évaluations définie dans le Planning annuel pour ce pôle
                {estRF ? ' — la création sera bloquée. Contactez la DFIP.' : '.'}
              </div>
            )
          )}

          <div>
            <label className="text-sm font-medium text-slate-700 block mb-1">Période de l'évaluation (démarrage → clôture) *</label>
            <PlageDates debut={form.date_demarrage} fin={form.date_fin_prevue}
              onChange={({ debut, fin }) => setForm(f => ({ ...f, date_demarrage: debut, date_fin_prevue: fin }))} />
          </div>
          {horsPlage && <p className="text-xs text-red-600 font-medium -mt-2">⛔ Ces dates sortent des plages autorisées — l'enregistrement sera refusé.</p>}
          {conflitsLive.length > 0 && (
            <div className="bg-red-50 border-2 border-red-200 rounded-xl p-3 text-xs text-red-700 -mt-1">
              ⛔ <strong>Conflit inter-pôles détecté :</strong> le pôle <strong>{conflitsLive[0].pole_code}</strong> a déjà
              des évaluations du {conflitsLive[0].date_demarrage} au {conflitsLive[0].date_fin_prevue || conflitsLive[0].date_demarrage}.
              Deux pôles ne peuvent pas être en évaluation simultanément — changez les dates.
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Annuler</button>
            <button type="submit" disabled={loading} className="btn-primary flex-1">{loading ? '...' : 'Enregistrer'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ===== Page ===== */
export default function Evaluations() {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [poles, setPoles] = useState([]);
  const [promotions, setPromotions] = useState([]);
  const [annees, setAnnees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [filtreSession, setFiltreSession] = useState('');
  const [filtreType, setFiltreType] = useState('');
  const [vue, setVue] = useState('PLANNING');
  const [segment, setSegment] = useState(null);
  const [detailId, setDetailId] = useState(null);
  const [modalDate, setModalDate] = useState(null); // date pré-remplie (clic sur un jour du calendrier)
  const [fNiveau, setFNiveau] = useState('');
  const [fFormation, setFFormation] = useState('');
  const [fSemestre, setFSemestre] = useState('');
  const [fPromo, setFPromo] = useState('');
  const [vacances, setVacances] = useState([]);
  const [feries, setFeries] = useState([]);
  const [motifModal, setMotifModal] = useState(null);
  const [selection, setSelection] = useState([]);       // délibérations groupées
  const [delibModal, setDelibModal] = useState(false);
  const [conflitInfo, setConflitInfo] = useState(null); // popup conflit inter-pôles

  const [plagesPlanning, setPlagesPlanning] = useState([]); // activités type EVALUATIONS du Planning annuel

  function load() {
    setLoading(true);
    const qs = new URLSearchParams();
    if (filtreSession) qs.set('session_num', filtreSession);
    if (filtreType) qs.set('type_evaluation', filtreType);
    Promise.all([
      api.get(`/evaluations${qs.toString() ? `?${qs}` : ''}`),
      api.get('/poles'),
      api.get('/poles/promotions'),
      api.get('/dashboard/annees'),
      api.get('/calendrier-academique/vacances'),
      api.get('/calendrier-academique/feries'),
      api.get('/planning/plages?type=EVALUATIONS'),
    ]).then(([s, p, pr, a, v, f, pl]) => {
      setItems(s.data); setPoles(p.data); setPromotions(pr.data); setAnnees(a.data);
      setVacances(v.data); setFeries(f.data); setPlagesPlanning(pl.data);
    }).finally(() => setLoading(false));
  }
  useEffect(load, [filtreSession, filtreType]);

  async function update(id, patch) {
    setItems(ss => ss.map(s => s.id === id ? { ...s, ...patch } : s));
    try { await api.put(`/evaluations/${id}`, patch); toast.success('Mise à jour enregistrée'); load(); }
    catch (err) {
      if (err.response?.data?.conflit) {
        setConflitInfo(err.response.data);   // popup explicite : conflit inter-pôles
      } else {
        toast.error(err.response?.data?.error || 'Erreur', { duration: 6000 });
      }
      load();
    }
  }

  function changerDate(s, champ, valeur) {
    if (champ === 'date_demarrage' && s.date_demarrage && valeur && valeur !== s.date_demarrage) {
      setMotifModal({ session: s, patch: { date_demarrage: valeur }, action: 'REPORT' });
    } else {
      update(s.id, { [champ]: valeur });
    }
  }

  function annuler(s) { setMotifModal({ session: s, patch: { etat: 'ANNULE' }, action: 'ANNULATION' }); }

  async function del(id) {
    if (!confirm('Supprimer cette évaluation ?')) return;
    try {
      const r = await api.delete(`/evaluations/${id}`);
      toast.success(r.data?.message || 'Supprimée'); load();
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
  }

  // Chef div DFE : demande de suppression d'une évaluation ANNULÉE (validée par le Directeur DFIP)
  async function demanderSuppression(id) {
    if (!confirm('Demander la suppression de cette évaluation annulée ?\nElle ne sera effective qu\'après validation du Directeur DFIP.')) return;
    try {
      const r = await api.delete(`/evaluations/${id}`);
      toast.success(r.data?.message || 'Demande transmise', { duration: 6000 }); load();
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
  }
  async function refuserSuppression(id) {
    try {
      const r = await api.post(`/evaluations/${id}/refuser-suppression`);
      toast.success(r.data?.message || 'Demande refusée'); load();
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
  }
  // Marquer terminé : popup demandant la date de fin pour valider l'action
  const [terminerModal, setTerminerModal] = useState(null);
  function marquerTerminee(s) { setTerminerModal(s); }

  const canDelete = ['DIRECTEUR', 'ADMIN_PORTAIL'].includes(user?.role);
  // Suivi : Chef de division DFE
  const canSuivi = ['CHEF_DIV_EVALUATION', 'DIRECTEUR', 'ADMIN_PORTAIL'].includes(user?.role);
  // Création + dates : Responsable pédagogique du pôle (les RF consultent et signalent)
  const canCreate = ['RESPONSABLE_PEDAGOGIQUE', 'CHEF_DIV_EVALUATION', 'DIRECTEUR', 'ADMIN_PORTAIL'].includes(user?.role);
  const estRF = user?.role === 'RESPONSABLE_PEDAGOGIQUE';
  const peutSignaler = user?.role === 'RESPONSABLE_FORMATION';
  // Délibérations : SEULS les Responsables pédagogiques des pôles
  const canDelib = user?.role === 'RESPONSABLE_PEDAGOGIQUE';

  // Vue limitée au pôle : responsables de formation uniquement
  // (Directeurs de pôle et Responsables pédagogiques voient TOUS les pôles)
  const ROLES_POLE = ['MEMBRE_POLE', 'RESPONSABLE_FORMATION', 'ENSEIGNANT', 'ETUDIANT'];
  const poleCodeUser = ROLES_POLE.includes(user?.role) && user?.pole_id
    ? poles.find(p => p.id === user.pole_id)?.code || null : null;
  useEffect(() => { if (poleCodeUser) setSegment(poleCodeUser); }, [poleCodeUser]);

  const anneeActive = annees.find(a => a.active);

  // Filtres combinables : niveau, formation, semestre, promotion
  const formationsDispo = useMemo(() =>
    [...new Set(items.map(s => s.formation_code || s.formation_nom).filter(Boolean))].sort(), [items]);
  const semestresDispo = useMemo(() =>
    [...new Set(items.map(s => s.semestre_code).filter(Boolean))].sort(), [items]);
  const promosDispo = useMemo(() =>
    [...new Set(items.map(s => s.promotion_code).filter(Boolean))].sort(), [items]);

  const affiches = items.filter(s =>
    (!segment || s.pole_code === segment) &&
    (!fNiveau || s.niveau === fNiveau) &&
    (!fFormation || (s.formation_code || s.formation_nom) === fFormation) &&
    (!fSemestre || s.semestre_code === fSemestre) &&
    (!fPromo || s.promotion_code === fPromo));
  const detail = items.find(s => s.id === detailId);
  const selectionnables = affiches.filter(s => s.etat_eval === 'EVAL_TERMINEES' && s.delib_etat !== 'TERMINEE' && s.pole_id === user?.pole_id);
  const toggleSel = id => setSelection(sel => sel.includes(id) ? sel.filter(x => x !== id) : [...sel, id]);
  const propsCarte = { update, changerDate, annuler, del, demanderSuppression, refuserSuppression, marquerTerminee, canSuivi, canDelib, canDelete, estRF, peutSignaler, userPoleId: user?.pole_id, userRole: user?.role };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Évaluations</h1>
          <p className="text-slate-500 text-sm">{items.length} évaluation(s) · Évaluations & Devoirs · 3 sessions</p>
        </div>
        {canCreate && <button onClick={() => { setModalDate(null); setModal(true); }} className="btn-primary flex items-center gap-2"><Plus size={16} /> Nouvelle évaluation</button>}
      </div>

      {/* Segments pôles + filtres + zoom + vue */}
      <div className="card !p-3">
        <div className="flex flex-wrap items-center gap-2">
          {!poleCodeUser && (
            <button onClick={() => setSegment(null)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold border-2 transition-all ${segment === null ? 'bg-slate-800 text-white border-slate-800 shadow-md' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'}`}>
              <LayoutGrid size={15} /> Tous les pôles
            </button>
          )}
          {poles.filter(p => !poleCodeUser || p.code === poleCodeUser).map(p => {
            const seg = POLES_SEG[p.code] || POLES_SEG.STN;
            const actif = segment === p.code;
            const nb = items.filter(s => s.pole_code === p.code).length;
            return (
              <button key={p.code} onClick={() => setSegment(actif && !poleCodeUser ? null : p.code)} title={p.nom}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold border-2 transition-all ${actif ? 'text-white shadow-md scale-105' : 'bg-white hover:scale-[1.02]'}`}
                style={actif ? { background: seg.color, borderColor: seg.color } : { color: seg.color, borderColor: `${seg.color}55` }}>
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: actif ? '#fff' : seg.color }} />
                {p.code}
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${actif ? 'bg-white/25' : 'bg-slate-100 text-slate-500'}`}>{nb}</span>
              </button>
            );
          })}
          <div className="ml-auto flex items-center gap-2 flex-wrap">
            <div className="flex rounded-xl border border-slate-200 overflow-hidden">
              {[['PLANNING', GanttChartSquare, 'Planning'], ['CARTES', List, 'Cartes']].map(([v, Icon, label]) => (
                <button key={v} onClick={() => setVue(v)}
                  className={`flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium transition-colors ${vue === v ? 'bg-[#1e3a5f] text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
                  <Icon size={15} /> {label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="flex gap-2 mt-2.5 pt-2.5 border-t border-slate-100 flex-wrap items-center">
          <span className="text-xs text-slate-400 font-medium">Session :</span>
          {[['', 'Toutes'], ['1', 'Normale'], ['2', 'Rattrapage'], ['3', 'Spéciale']].map(([v, l]) => (
            <button key={v} onClick={() => setFiltreSession(v)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${filtreSession === v ? 'bg-[#1e3a5f] text-white' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'}`}>{l}</button>
          ))}
          <span className="text-xs text-slate-400 font-medium ml-3">Type :</span>
          {[['', 'Tous'], ['EVALUATION', 'Évaluations'], ['DEVOIR', 'Devoirs']].map(([v, l]) => (
            <button key={v} onClick={() => setFiltreType(v)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${filtreType === v ? 'bg-[#1e3a5f] text-white' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'}`}>{l}</button>
          ))}
          {canDelib && selectionnables.length > 0 && (
            <button onClick={() => setDelibModal(true)} disabled={selection.length === 0}
              className="ml-auto btn-primary !py-1.5 text-xs !bg-purple-600 hover:!bg-purple-700 disabled:opacity-40 flex items-center gap-1.5">
              <Gavel size={13} /> Délibérations ({selection.length})
            </button>
          )}
        </div>
        {/* Filtres combinables : niveau, formation, semestre, promotion */}
        <div className="flex gap-2 mt-2.5 pt-2.5 border-t border-slate-100 flex-wrap items-center">
          <span className="text-xs text-slate-400 font-medium">Filtres :</span>
          <select value={fNiveau} onChange={e => setFNiveau(e.target.value)} className={`!w-auto !py-1.5 !text-xs ${fNiveau ? '!border-blue-400 !bg-blue-50 font-semibold' : ''}`}>
            <option value="">Tous niveaux</option>
            {Object.entries(NIVEAUX).map(([k, n]) => <option key={k} value={k}>{n.label}</option>)}
          </select>
          <select value={fFormation} onChange={e => setFFormation(e.target.value)} className={`!w-auto !py-1.5 !text-xs max-w-44 ${fFormation ? '!border-blue-400 !bg-blue-50 font-semibold' : ''}`}>
            <option value="">Toutes formations</option>
            {formationsDispo.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
          <select value={fSemestre} onChange={e => setFSemestre(e.target.value)} className={`!w-auto !py-1.5 !text-xs ${fSemestre ? '!border-blue-400 !bg-blue-50 font-semibold' : ''}`}>
            <option value="">Tous semestres</option>
            {semestresDispo.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={fPromo} onChange={e => setFPromo(e.target.value)} className={`!w-auto !py-1.5 !text-xs ${fPromo ? '!border-blue-400 !bg-blue-50 font-semibold' : ''}`}>
            <option value="">Toutes promotions</option>
            {promosDispo.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          {(fNiveau || fFormation || fSemestre || fPromo) && (
            <button onClick={() => { setFNiveau(''); setFFormation(''); setFSemestre(''); setFPromo(''); }}
              className="text-xs text-blue-600 hover:underline">Réinitialiser</button>
          )}
        </div>
      </div>

      {/* Signalements des responsables de formation → traités par le Responsable pédagogique */}
      <PanneauSignalements cibleType="EVALUATION" user={user} />

      {/* Incidents remontés impactant les évaluations */}
      <PanneauIncidents module="EVALUATIONS" poles={poles} segment={segment} />

      {loading ? (
        <div className="flex justify-center h-32 items-center"><div className="w-6 h-6 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>
      ) : affiches.length === 0 ? (
        <div className="card py-12 text-center text-slate-400"><ClipboardCheck size={36} className="mx-auto mb-2 opacity-30" />Aucune évaluation{segment ? ` pour le pôle ${segment}` : ''}</div>
      ) : vue === 'CARTES' ? (
        <>
          {/* Activités EVALUATIONS issues du Planning annuel */}
          {(() => {
            const plagesAff = plagesPlanning.filter(p => !segment || p.pole_code === segment);
            if (plagesAff.length === 0) return null;
            return (
              <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-xs text-blue-800 flex items-center gap-2 flex-wrap">
                <span className="font-semibold">🧪 Évaluations au Planning annuel :</span>
                {plagesAff.map((p, i) => (
                  <span key={i} className="bg-white rounded-lg px-2 py-1 font-semibold" title={p.ligne}>
                    {p.pole_code} · {p.sous_type === 'DEVOIRS' ? '📝' : '🧪'} {p.libelle} : {p.date_debut} → {p.date_fin}
                  </span>
                ))}
                <span className="text-blue-500">Les évaluations saisies ci-dessous s'inscrivent dans ces plages.</span>
              </div>
            );
          })()}
          <div className="grid lg:grid-cols-2 gap-4">
            {affiches.map(s => (
              <CarteEvaluation key={s.id} s={s} {...propsCarte}
                selectable={canDelib && s.etat_eval === 'EVAL_TERMINEES'}
                selected={selection.includes(s.id)}
                onToggleSel={() => toggleSel(s.id)} />
            ))}
          </div>
        </>
      ) : (
        /* ===== Vue PLANNING : calendrier mensuel façon Google Agenda ===== */
        <>
          <CalendrierMois
            vacances={vacances} feries={feries}
            onDayClick={canCreate ? (d) => { setModalDate(d); setModal(true); } : undefined}
            events={[
              // Plages EVALUATIONS du Planning annuel : bandes pointillées
              ...plagesPlanning.filter(p => !segment || p.pole_code === segment).map(p => ({
                debut: p.date_debut, fin: p.date_fin, dashed: true,
                color: (POLES_SEG[p.pole_code] || POLES_SEG.STN).color,
                label: `${p.sous_type === 'DEVOIRS' ? '📝' : '🧪'} ${p.libelle} · ${p.ligne} (${p.pole_code})`,
                titre: `Planning annuel : ${p.libelle} (${p.ligne}) · ${p.sous_type === 'DEVOIRS' ? 'Devoirs' : 'Examen'} · ${p.date_debut} → ${p.date_fin}`,
              })),
              // Évaluations saisies : bandes pleines avec le nom de la formation
              ...affiches.filter(s => s.date_demarrage).map(s => {
                const seg = POLES_SEG[s.pole_code] || POLES_SEG.STN;
                const fin = s.date_fin_prevue || s.date_demarrage;
                // Format : Promotion - Formation Niveau Semestre Session (ex : P10 - ANG L3 S5 SN)
                return {
                  debut: s.date_demarrage, fin,
                  color: s.etat === 'ANNULE' ? '#dc2626' : (ETAT_BAR[s.etat_eval] || seg.color),
                  label: `${s.type_evaluation === 'DEVOIR' ? '📝 ' : ''}${!segment ? `${s.pole_code} · ` : ''}${s.promotion_code || '?'} - ${s.formation_code || s.formation_nom || s.pole_code} ${s.niveau || ''} ${s.semestre_code || ''} ${SESSION_CODE[s.session_num]}${s.delib_etat === 'TERMINEE' ? ' ⚖' : ''}`,
                  titre: `${s.pole_code} — Promotion ${s.promotion_code || '?'} — ${s.formation_nom || 'Formation non précisée'} ${NIVEAUX[s.niveau]?.label || ''} Semestre ${(s.semestre_code || '').replace('S', '')} · ${TYPE_EVAL[s.type_evaluation]?.label || ''} ${SESSION_LABEL[s.session_num]} : ${s.date_demarrage} → ${fin} — ${ETAT_EVAL.options[s.etat_eval]}${s.delib_etat === 'TERMINEE' ? ' · Délibéré' : ''} (cliquer pour les détails)`,
                  onClick: () => setDetailId(s.id),
                };
              }),
            ]}
          />
          {/* Évaluations sans date de démarrage : accessibles sous le calendrier */}
          {(() => {
            const sansDates = affiches.filter(s => !s.date_demarrage);
            if (sansDates.length === 0) return null;
            return (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-slate-400 font-semibold uppercase tracking-wide text-[11px]">Sans dates :</span>
                {sansDates.map(s => {
                  const seg = POLES_SEG[s.pole_code] || POLES_SEG.STN;
                  return (
                    <button key={s.id} onClick={() => setDetailId(s.id)}
                      title={`${s.formation_nom || 'Formation non précisée'} — date de démarrage non renseignée (cliquer pour les détails)`}
                      className="px-2.5 py-1 rounded-lg border-2 border-dashed bg-white font-semibold hover:bg-slate-50"
                      style={{ color: seg.color, borderColor: `${seg.color}66` }}>
                      {s.promotion_code || '?'} - {s.formation_code || s.formation_nom || s.pole_code} {s.niveau || ''} {s.semestre_code || ''} {SESSION_CODE[s.session_num]}
                    </button>
                  );
                })}
              </div>
            );
          })()}
        </>
      )}

      {vue === 'PLANNING' && !loading && (
        <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500">
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded" style={{ background: '#2563eb' }} /> Calendrier disponible (couleur du pôle)</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded" style={{ background: '#f59e0b' }} /> Évaluations en cours</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded" style={{ background: '#16a34a' }} /> Terminées</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded" style={{ background: '#dc2626' }} /> Annulée</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded border-2 border-dashed border-slate-400 bg-white" /> Plage du Planning annuel</span>
          <span>📝 = devoir · SN/SR/SS = session Normale/Rattrapage/Spéciale · ⚖ = délibéré · Cliquez sur une bande pour les détails.</span>
        </div>
      )}

      {modal && <ModalEvaluation poles={poles} promotions={promotions} annees={annees} user={user} defaultDate={modalDate} onClose={() => setModal(false)} onCreated={load} onConflit={setConflitInfo} />}

      {/* Marquer terminé : date de fin demandée pour valider l'action */}
      {terminerModal && (
        <ModalTerminer s={terminerModal} onClose={() => setTerminerModal(null)}
          onConfirm={async (dateFin) => {
            const patch = terminerModal.activite_id
              ? { etat_eval: 'EVAL_TERMINEES' } // dates pilotées par le Planning annuel
              : { etat_eval: 'EVAL_TERMINEES', date_fin_prevue: dateFin };
            await update(terminerModal.id, patch);
            setTerminerModal(null);
          }} />
      )}

      {/* Popup explicite : conflit d'examens entre pôles */}
      {conflitInfo && (
        <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto nav-scroll">
            <div className="bg-red-600 text-white px-5 py-4">
              <h2 className="font-bold text-lg">⛔ Conflit d'examens entre pôles</h2>
              <p className="text-red-100 text-xs mt-0.5">Deux pôles ne peuvent jamais être en évaluation simultanément.</p>
            </div>
            <div className="p-5 space-y-3">
              <p className="text-sm text-slate-700">{conflitInfo.error}</p>
              <div className="bg-red-50 border border-red-100 rounded-xl divide-y divide-red-100">
                {(conflitInfo.conflits || []).map(c => (
                  <div key={c.id} className="px-3 py-2 text-xs">
                    <p className="font-bold text-red-800">{c.pole_nom}</p>
                    <p className="text-slate-600">
                      {c.formation_nom || 'Formation —'} · {c.type_evaluation === 'DEVOIR' ? 'Devoir' : 'Examen'} · Session {c.session_num}
                    </p>
                    <p className="text-red-700 font-semibold">📅 {c.date_demarrage} → {c.date_fin_prevue || c.date_demarrage}</p>
                  </div>
                ))}
              </div>
              <p className="text-xs text-slate-500">Choisissez une autre période pour valider cette évaluation.</p>
              <button onClick={() => setConflitInfo(null)} className="btn-danger w-full">J'ai compris — je change la date</button>
            </div>
          </div>
        </div>
      )}
      {motifModal && (
        <ModalMotif data={motifModal} onClose={() => { setMotifModal(null); load(); }}
          onConfirm={async (motif) => {
            try {
              await api.put(`/evaluations/${motifModal.session.id}`, { ...motifModal.patch, motif });
              toast.success(motifModal.action === 'ANNULATION' ? 'Annulée — incident créé' : 'Reportée — incident créé');
            } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
            setMotifModal(null); load();
          }} />
      )}
      {delibModal && (
        <ModalDelib count={selection.length} onClose={() => setDelibModal(false)}
          onConfirm={async (delib_etat, date) => {
            try {
              const r = await api.post('/evaluations/deliberations', { ids: selection, delib_etat, date_deliberation: date });
              toast.success(`${r.data.appliquees} délibération(s) enregistrée(s)${r.data.refusees.length ? ` · ${r.data.refusees.length} refusée(s)` : ''}`);
              setSelection([]); setDelibModal(false); load();
            } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
          }} />
      )}
      {detail && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setDetailId(null)}>
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto nav-scroll" onClick={e => e.stopPropagation()}>
            <CarteEvaluation s={detail} {...propsCarte} />
            <button onClick={() => setDetailId(null)} className="w-full mt-2 bg-white/90 rounded-xl py-2 text-sm text-slate-500 hover:text-slate-700">Fermer</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ===== Carte d'une évaluation ===== */
function CarteEvaluation({ s, update, changerDate, annuler, del, demanderSuppression, refuserSuppression, marquerTerminee, canSuivi, canDelib, canDelete, estRF, peutSignaler, userPoleId, userRole, selectable, selected, onToggleSel }) {
  // Évaluation délibérée (clôturée) : plus éditable, sauf par le Directeur DFIP
  const verrouDelib = s.delib_etat === 'TERMINEE' && !['DIRECTEUR', 'ADMIN_PORTAIL'].includes(userRole);
  const editDates = !verrouDelib && (canSuivi || (estRF && s.pole_id === userPoleId)) && s.etat !== 'ANNULE' && !s.activite_id;
  const editSuivi = !verrouDelib && canSuivi;
  // Délibérations : SEUL le Responsable pédagogique du pôle les modifie
  // (le Directeur DFIP peut seulement corriger une évaluation déjà délibérée)
  const editDelib = s.etat_eval === 'EVAL_TERMINEES' && (
    (userRole === 'RESPONSABLE_PEDAGOGIQUE' && s.pole_id === userPoleId && !verrouDelib)
    || (s.delib_etat === 'TERMINEE' && ['DIRECTEUR', 'ADMIN_PORTAIL'].includes(userRole))
  );
  const pct = progressionEval(s);

  // BROUILLON du suivi : les changements ne s'appliquent qu'au clic « Enregistrer l'état »
  const [draft, setDraft] = useState({});
  const DEFAUTS = { reception_epreuves: 'PAS_DISPONIBLE', date_programmation: '', implementation_epreuves: 'PAS_ENCORE', etat_eval: 'CALENDRIER_DISPONIBLE' };
  const val = (f) => draft[f] !== undefined ? draft[f] : (s[f] || DEFAUTS[f]);
  const enAttente = Object.keys(draft).some(f => draft[f] !== (s[f] || DEFAUTS[f]));
  return (
    <div className={`card relative ${s.etat === 'ANNULE' ? 'opacity-60' : ''} ${selected ? 'ring-2 ring-purple-400' : ''}`}>
      {selectable && (
        <button onClick={onToggleSel} title="Sélectionner pour délibérations groupées"
          className={`absolute -top-2 -left-2 w-7 h-7 rounded-lg border-2 flex items-center justify-center transition-colors ${selected ? 'bg-purple-600 border-purple-600 text-white' : 'bg-white border-slate-300 text-transparent hover:border-purple-400'}`}>
          <CheckSquare size={15} />
        </button>
      )}
      <div className="flex items-start justify-between mb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-slate-800">{SESSION_LABEL[s.session_num]}</h3>
            <span className={`badge ${TYPE_EVAL[s.type_evaluation]?.color || ''}`}>{TYPE_EVAL[s.type_evaluation]?.label}</span>
            {s.activite_id && <span className="badge bg-indigo-100 text-indigo-700" title="Issue du planning annuel — dates pilotées par l'activité liée">🔗 Planning annuel</span>}
            {s.etat === 'ANNULE' && <span className="badge bg-red-100 text-red-700">Annulée</span>}
          </div>
          <p className="text-xs text-slate-500 truncate">
            {s.formation_nom || s.pole_nom}
            {s.promotion_code && <> · <span className="font-semibold text-blue-700">{s.promotion_code}</span></>}
            {s.niveau && <> · {s.niveau}</>}
            {s.semestre_code && <> · {s.semestre_code}</>}
            {' · '}{s.annee_libelle}
          </p>
        </div>
        <span className={`badge ${ETAT_EVAL.colors[s.etat_eval]} shrink-0`}>{ETAT_EVAL.options[s.etat_eval]}</span>
      </div>

      {/* Progression (quota : réception 10 % · date 15 % · implémentation 25 % · terminées 20 % · délibération 30 %) */}
      <div className="mb-3">
        <div className="flex items-center justify-between mb-1">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Progression</p>
          <div className="flex items-center gap-2">
            {verrouDelib && <span className="badge bg-purple-100 text-purple-700 text-[10px]" title="Délibération effective — modifiable uniquement par le Directeur DFIP">🔒 Clôturée</span>}
            <span className="text-xs font-bold text-slate-600">{Math.round(pct * 100)}%</span>
          </div>
        </div>
        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
          <div className={`h-full rounded-full transition-all duration-500 ${pct >= 1 ? 'bg-green-500' : pct >= 0.5 ? 'bg-blue-500' : pct >= 0.25 ? 'bg-amber-500' : 'bg-slate-400'}`}
            style={{ width: `${pct * 100}%` }} />
        </div>
      </div>

      {/* Dates (Responsable de formation) */}
      <div className="grid grid-cols-2 gap-3 mb-3">
        {[['date_demarrage', 'Date de démarrage'], ['date_fin_prevue', 'Date de clôture']].map(([f, label]) => (
          <div key={f} className="bg-slate-50 rounded-xl px-3 py-2">
            <p className="text-[10px] uppercase tracking-wide text-slate-400 mb-0.5">{label}</p>
            {editDates ? (
              <input type="date" value={s[f] || ''} onChange={e => changerDate(s, f, e.target.value)} className="!py-0.5 !text-xs !bg-transparent !border-0 !px-0" />
            ) : <p className="text-xs font-semibold text-slate-700">{s[f] || '—'}</p>}
          </div>
        ))}
      </div>

      {/* Suivi — Chef de division DFE : les changements ne s'appliquent QU'AU clic « Enregistrer l'état » */}
      <div className={`border rounded-xl p-3 mb-3 space-y-2 ${enAttente ? 'border-amber-300 bg-amber-50/40' : 'border-slate-100'}`}>
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Suivi — Chef division DFE</p>
          {enAttente && <span className="text-[10px] font-semibold text-amber-600">Modifications non enregistrées</span>}
        </div>
        <LigneSelect label="Réception des épreuves" cfg={RECEPTION} value={val('reception_epreuves')} editable={editSuivi} onChange={v => setDraft(d => ({ ...d, reception_epreuves: v }))} />
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500 flex-1" title="Doit rester dans la plage d'évaluations du Planning annuel">Date prévue pour l'évaluation</span>
          {editSuivi ? (
            <input type="date" value={val('date_programmation')} onChange={e => setDraft(d => ({ ...d, date_programmation: e.target.value }))} className="!w-auto !py-1 !text-xs" />
          ) : <span className="text-xs font-semibold text-slate-700">{s.date_programmation || '—'}</span>}
        </div>
        <LigneSelect label="Implémentation des épreuves" cfg={IMPLEMENTATION} value={val('implementation_epreuves')} editable={editSuivi} onChange={v => setDraft(d => ({ ...d, implementation_epreuves: v }))} />
        <LigneSelect label="État" cfg={ETAT_EVAL} value={val('etat_eval')} editable={editSuivi} onChange={v => setDraft(d => ({ ...d, etat_eval: v }))} />
        {editSuivi && (
          <div className="flex gap-2 pt-1">
            <button disabled={!enAttente}
              onClick={async () => { await update(s.id, draft); setDraft({}); }}
              className="btn-primary flex-1 !py-1.5 text-xs disabled:opacity-40">
              💾 Enregistrer l'état
            </button>
            {enAttente && (
              <button onClick={() => setDraft({})} className="btn-secondary !py-1.5 text-xs">Annuler</button>
            )}
            {s.etat_eval !== 'EVAL_TERMINEES' && s.etat !== 'ANNULE' && (
              <button onClick={() => marquerTerminee(s)} className="btn-primary flex-1 !py-1.5 text-xs !bg-green-600 hover:!bg-green-700">
                ✔ Marquer terminé
              </button>
            )}
          </div>
        )}
      </div>

      {/* Délibérations — Directeur de pôle */}
      <div className={`flex items-center gap-3 rounded-xl p-3 border flex-wrap ${s.etat_eval === 'EVAL_TERMINEES' ? 'bg-purple-50/60 border-purple-100' : 'bg-slate-50 border-slate-200'}`}>
        <Gavel size={15} className="text-purple-500 shrink-0" />
        <span className="text-xs font-medium text-purple-900">Délibération :</span>
        {s.etat_eval !== 'EVAL_TERMINEES' ? (
          <span className="text-xs text-slate-400">🔒 après « Évaluations terminées »</span>
        ) : editDelib ? (
          <ControleDelib s={s} update={update} />
        ) : (
          <span className={`badge ${DELIB.colors[s.delib_etat || 'PAS_ENCORE']}`}>
            {DELIB.options[s.delib_etat || 'PAS_ENCORE']}{s.date_deliberation && s.delib_etat !== 'PAS_ENCORE' ? ` ${s.date_deliberation}` : ''}
          </span>
        )}
      </div>

      {(canSuivi || canDelete || peutSignaler) && s.etat !== 'ANNULE' && (
        <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 mt-3">
          {peutSignaler && (
            <BoutonSignaler cibleType="EVALUATION" cibleId={s.id}
              contexte={`${s.formation_nom || s.pole_nom || ''} · ${SESSION_LABEL[s.session_num]} · ${s.date_demarrage || ''} → ${s.date_fin_prevue || ''}`} />
          )}
          {editSuivi && <button onClick={() => annuler(s)} className="text-xs font-medium text-red-500 hover:bg-red-50 px-2.5 py-1.5 rounded-lg">Annuler l'évaluation</button>}
          {canDelete && !s.activite_id && !verrouDelib && <button onClick={() => del(s.id)} className="p-1.5 text-red-400 hover:bg-red-50 rounded"><Trash2 size={15} /></button>}
        </div>
      )}

      {/* Évaluation ANNULÉE : suppression par le Chef div DFE, sur validation du Directeur DFIP */}
      {s.etat === 'ANNULE' && (canSuivi || canDelete) && !s.activite_id && (
        <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 mt-3 flex-wrap">
          {s.suppr_demandee ? (
            canDelete ? (
              <>
                <span className="badge bg-amber-100 text-amber-700 text-[11px]">🗑 Suppression demandée par le Chef div. DFE</span>
                <button onClick={() => del(s.id)} className="btn-danger !py-1.5 text-xs">Valider la suppression</button>
                <button onClick={() => refuserSuppression(s.id)} className="btn-secondary !py-1.5 text-xs">Refuser</button>
              </>
            ) : (
              <span className="badge bg-amber-100 text-amber-700 text-[11px]">🗑 Suppression demandée — en attente de validation du Directeur DFIP</span>
            )
          ) : (
            <>
              {userRole === 'CHEF_DIV_EVALUATION' && (
                <button onClick={() => demanderSuppression(s.id)} className="text-xs font-medium text-red-500 hover:bg-red-50 px-2.5 py-1.5 rounded-lg border border-red-200">
                  🗑 Demander la suppression (validation DFIP)
                </button>
              )}
              {canDelete && <button onClick={() => del(s.id)} className="p-1.5 text-red-400 hover:bg-red-50 rounded" title="Supprimer"><Trash2 size={15} /></button>}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* Délibération (Responsable pédagogique) : Pas encore / Prévue le (date) / Effective.
   L'état et la date sont appliqués ENSEMBLE au clic sur « Valider » —
   « Effective » clôture l'évaluation (comptée dans les délibérations faites). */
function ControleDelib({ s, update }) {
  const [etat, setEtat] = useState(s.delib_etat || 'PAS_ENCORE');
  const [date, setDate] = useState(s.date_deliberation || new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(false);
  const modifie = etat !== (s.delib_etat || 'PAS_ENCORE') || (['PREVUE', 'TERMINEE'].includes(etat) && date !== (s.date_deliberation || ''));
  return (
    <>
      <select value={etat} onChange={e => setEtat(e.target.value)}
        className={`!py-1 !text-xs !w-auto font-medium rounded-lg border-0 ${DELIB.colors[etat]}`}>
        {Object.entries(DELIB.options).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
      {['PREVUE', 'TERMINEE'].includes(etat) && (
        <input type="date" value={date} onChange={e => setDate(e.target.value)} className="!py-1 !text-xs !w-auto" />
      )}
      <button disabled={!modifie || loading || (['PREVUE', 'TERMINEE'].includes(etat) && !date)}
        onClick={async () => {
          if (etat === 'TERMINEE' && !confirm('Délibération EFFECTIVE : l\'évaluation sera clôturée (comptée dans les délibérations) et ne sera plus modifiable, sauf par le Directeur DFIP. Confirmer ?')) return;
          setLoading(true);
          await update(s.id, { delib_etat: etat, date_deliberation: ['PREVUE', 'TERMINEE'].includes(etat) ? date : null });
          setLoading(false);
        }}
        className="btn-primary !py-1 !px-3 !text-xs !bg-purple-600 hover:!bg-purple-700 disabled:opacity-40 ml-auto">
        {loading ? '...' : 'Valider'}
      </button>
    </>
  );
}

function LigneSelect({ label, cfg, value, editable, onChange }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-slate-500 flex-1">{label}</span>
      {editable ? (
        <select value={value} onChange={e => onChange(e.target.value)} className={`!w-auto !py-1 !text-xs font-medium rounded-lg border-0 ${cfg.colors[value]}`}>
          {Object.entries(cfg.options).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      ) : <span className={`badge ${cfg.colors[value]}`}>{cfg.options[value]}</span>}
    </div>
  );
}

/* Marquer une évaluation TERMINÉE : la date de fin valide l'action */
function ModalTerminer({ s, onClose, onConfirm }) {
  const [date, setDate] = useState(s.date_fin_prevue || new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(false);
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto nav-scroll">
        <div className="p-5 border-b">
          <h2 className="font-semibold text-slate-800">✔ Marquer l'évaluation comme terminée</h2>
          <p className="text-xs text-slate-500 mt-1">
            {s.formation_nom || 'Formation —'} · {SESSION_LABEL[s.session_num]} {s.niveau || ''} {s.semestre_code || ''}
          </p>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="text-sm font-medium text-slate-700 block mb-1">Date de fin des évaluations *</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} autoFocus />
            {s.activite_id && <p className="text-xs text-slate-400 mt-1">🔗 Évaluation liée au Planning annuel : ses dates restent pilotées par l'activité liée.</p>}
          </div>
          <p className="text-xs text-blue-700 bg-blue-50 border border-blue-100 rounded-xl p-2.5">
            Le Responsable pédagogique du pôle sera notifié pour procéder à la <strong>délibération</strong>.
          </p>
          <div className="flex gap-2">
            <button onClick={onClose} className="btn-secondary flex-1">Annuler</button>
            <button disabled={!date || loading}
              onClick={async () => { setLoading(true); await onConfirm(date); setLoading(false); }}
              className="btn-primary flex-1 !bg-green-600 hover:!bg-green-700 disabled:opacity-40">
              {loading ? '...' : 'Confirmer'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* Motif obligatoire pour report / annulation ⇒ incident */
function ModalMotif({ data, onClose, onConfirm }) {
  const [motif, setMotif] = useState('');
  const [loading, setLoading] = useState(false);
  const estAnnulation = data.action === 'ANNULATION';
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto nav-scroll">
        <div className="p-5 border-b">
          <h2 className="font-semibold text-slate-800">{estAnnulation ? "Annuler l'évaluation" : "Reporter l'évaluation"}</h2>
          <p className="text-xs text-slate-500 mt-1">
            {SESSION_LABEL[data.session.session_num]}{data.session.formation_nom ? ` — ${data.session.formation_nom}` : ''}
            {!estAnnulation && ` · ${data.session.date_demarrage} → ${data.patch.date_demarrage}`}
          </p>
        </div>
        <div className="p-5 space-y-4">
          <div className="bg-red-50 border border-red-100 rounded-xl p-3 text-xs text-red-700">
            Tout report ou annulation exige un <strong>incident</strong> documenté qui sera créé automatiquement.
          </div>
          <textarea value={motif} onChange={e => setMotif(e.target.value)} rows={3} placeholder="Motif détaillé..." autoFocus />
          <div className="flex gap-2">
            <button onClick={onClose} className="btn-secondary flex-1">Retour</button>
            <button disabled={!motif.trim() || loading}
              onClick={async () => { setLoading(true); await onConfirm(motif.trim()); setLoading(false); }}
              className="btn-danger flex-1 disabled:opacity-40">
              {loading ? '...' : 'Confirmer'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* Délibérations groupées (plusieurs formations à la fois) */
function ModalDelib({ count, onClose, onConfirm }) {
  const [etat, setEtat] = useState('TERMINEE');
  const [date, setDate] = useState('');
  const [loading, setLoading] = useState(false);
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto nav-scroll">
        <div className="p-5 border-b">
          <h2 className="font-semibold text-slate-800 flex items-center gap-2"><Gavel size={17} className="text-purple-600" /> Délibérations — {count} formation(s)</h2>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="text-sm font-medium text-slate-700 block mb-1">État *</label>
            <select value={etat} onChange={e => setEtat(e.target.value)}>
              <option value="TERMINEE">Terminée</option>
              <option value="PREVUE">Prévue le</option>
              <option value="PAS_ENCORE">Pas encore</option>
            </select>
          </div>
          {['TERMINEE', 'PREVUE'].includes(etat) && (
            <div>
              <label className="text-sm font-medium text-slate-700 block mb-1">Date *</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} required />
            </div>
          )}
          <div className="flex gap-2">
            <button onClick={onClose} className="btn-secondary flex-1">Annuler</button>
            <button disabled={loading || (['TERMINEE', 'PREVUE'].includes(etat) && !date)}
              onClick={async () => { setLoading(true); await onConfirm(etat, date); setLoading(false); }}
              className="btn-primary flex-1 !bg-purple-600 hover:!bg-purple-700 disabled:opacity-40">
              {loading ? '...' : 'Appliquer'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
