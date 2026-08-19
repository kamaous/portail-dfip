import { useEffect, useState, useMemo, useRef } from 'react';
import api from '../lib/api';
import toast from 'react-hot-toast';
import { Plus, ClipboardCheck, Trash2, Calendar, Gavel, LayoutGrid, GanttChartSquare, List, CheckSquare } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { SelecteurCursus, NIVEAUX, CalendrierMois } from './Tutorat';
import { BoutonSignaler, PanneauSignalements } from '../components/Signalements';
import PlageDates from '../components/PlageDates';
import { useNavigate } from 'react-router-dom';
import { GRAVITE_COULEUR } from './Tutorat';

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

/* Ligne d'une évaluation au sein d'une création multiple : une formation du même
   pôle + de la même promotion, avec SA PROPRE période (les évaluations sont
   éclatées — une par formation, chacune avec ses dates et son propre contrôle
   de capacité ENO / proposition de groupes G1-G2). */
function LigneFormationEvaluation({ ligne, index, formations, formationsExclues, promotion_id, niveau, heure_debut, heure_fin, plages, contrainte, onChange, onRemove, canRemove, erreur }) {
  const dispo = formations.filter(f => !formationsExclues.includes(String(f.id)) || String(f.id) === ligne.formation_id);

  const [capaciteLive, setCapaciteLive] = useState(null);
  const [groupesRequis, setGroupesRequis] = useState([]);
  // Auto-scission une seule fois par formation : si l'effectif dépasse la capacité
  // d'un ENO, on programme automatiquement le GROUPE 1 (l'utilisateur reste libre
  // de revenir à « Toute la promotion » ou de passer au Groupe 2 ensuite).
  const autoAppliqueRef = useRef(false);
  useEffect(() => { autoAppliqueRef.current = false; }, [ligne.formation_id]);
  useEffect(() => {
    setCapaciteLive(null);
    if (!ligne.formation_id || !promotion_id || !niveau) { setGroupesRequis([]); return; }
    api.post('/evaluations/check-conflit', {
      formation_id: ligne.formation_id, promotion_id, niveau,
      date_demarrage: ligne.date_demarrage, date_fin_prevue: ligne.date_fin_prevue,
      heure_debut, heure_fin, groupe: ligne.groupe || null,
    }).then(r => {
      setCapaciteLive(r.data.capacite || null);
      setGroupesRequis(r.data.groupes_requis || []);
      if ((r.data.groupes_requis || []).length > 0 && !ligne.groupe && !autoAppliqueRef.current) {
        autoAppliqueRef.current = true;
        onChange(index, { groupe: 'G1' });
      }
    }).catch(() => {});
  }, [ligne.formation_id, promotion_id, niveau, ligne.date_demarrage, ligne.date_fin_prevue, heure_debut, heure_fin, ligne.groupe]);

  const horsPlage = plages?.length > 0 && ligne.date_demarrage && ligne.date_fin_prevue &&
    !plages.some(p => ligne.date_demarrage >= p.date_debut && ligne.date_fin_prevue <= p.date_fin);

  return (
    <div className={`border rounded-xl p-3 space-y-2 ${erreur ? 'border-red-300 bg-red-50/50' : 'border-slate-200 bg-slate-50/60'}`}>
      <div className="flex items-center gap-2">
        <select value={ligne.formation_id} onChange={e => onChange(index, { formation_id: e.target.value })} required className="flex-1">
          <option value="">Formation {index + 1}...</option>
          {dispo.map(f => <option key={f.id} value={f.id}>{f.nom}</option>)}
        </select>
        {canRemove && (
          <button type="button" onClick={() => onRemove(index)} title="Retirer cette formation"
            className="p-2 text-red-400 hover:bg-red-50 rounded-lg shrink-0"><Trash2 size={15} /></button>
        )}
      </div>

      <PlageDates compact debut={ligne.date_demarrage} fin={ligne.date_fin_prevue}
        onChange={({ debut, fin }) => onChange(index, { date_demarrage: debut, date_fin_prevue: fin })} />

      {/* GROUPES : scission AUTOMATIQUE (Groupe 1 programmé d'office) quand l'effectif dépasse la capacité d'un ENO */}
      {groupesRequis.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-2 space-y-1.5">
          <p className="text-[11px] text-amber-800">
            👥 <strong>Effectif supérieur à la capacité</strong> dans : {groupesRequis.map(g => `${g.eno} (${g.effectif}/${g.capacite})`).join(' · ')}.
            {' '}Promotion scindée automatiquement en 2 groupes — <strong>Groupe 1 programmé sur ce créneau</strong> ; créez une seconde évaluation en Groupe 2 pour l'autre moitié.
          </p>
          <div className="flex gap-1.5">
            {[['', 'Toute la promotion'], ['G1', 'Groupe 1'], ['G2', 'Groupe 2']].map(([v, l]) => (
              <button type="button" key={v} onClick={() => onChange(index, { groupe: v })}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border-2 ${ligne.groupe === v ? 'bg-[#1e3a5f] text-white border-[#1e3a5f]' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'}`}>
                {l}{v === 'G1' && ligne.groupe === 'G1' ? ' ✓ auto' : ''}
              </button>
            ))}
          </div>
        </div>
      )}
      {horsPlage && (contrainte
        ? <p className="text-[11px] text-red-600 font-medium">⛔ Dates hors des plages du Planning annuel — l'enregistrement sera refusé.</p>
        : <p className="text-[11px] text-amber-600 font-medium">⚠ Dates hors des plages du Planning annuel (information).</p>)}
      {capaciteLive && (
        <div className="bg-red-50 border-2 border-red-200 rounded-lg p-2 text-[11px] text-red-700">
          ⛔ Capacité ENO dépassée : {capaciteLive.satures.map(s => `${s.eno} (${s.demande}/${s.capacite}, manque ${s.manque})`).join(' · ')}.
        </div>
      )}
      {erreur && <p className="text-[11px] text-red-600 font-medium">⚠ {erreur}</p>}
    </div>
  );
}

/* ===== Modal de création (Responsable de formation, dates dans les plages du planning) =====
   Une ou plusieurs formations du même pôle et de la même promotion à la fois :
   chaque formation obtient sa propre évaluation (fiche éclatée), avec sa propre
   période — les autres champs (année, type, session, créneau horaire) sont partagés. */
function ModalEvaluation({ poles, promotions, annees, user, defaultDate, onClose, onCreated }) {
  const estRF = user?.role === 'RESPONSABLE_FORMATION'; // pôle verrouillé pour le Responsable de formation
  const [form, setForm] = useState({
    annee_id: annees.find(a => a.active)?.id || '',
    pole_id: estRF && user?.pole_id ? String(user.pole_id) : '',
    promotion_id: '', niveau: '', semestre_code: '',
    session_num: 1, type_evaluation: 'EVALUATION',
    heure_debut: '08:30', heure_fin: '17:30',   // créneau standard par défaut
  });
  const ligneVide = () => ({ formation_id: '', date_demarrage: defaultDate || '', date_fin_prevue: '', groupe: '' });
  const [lignes, setLignes] = useState([ligneVide()]);
  const [erreurs, setErreurs] = useState({});
  const [plages, setPlages] = useState(null);
  const [loading, setLoading] = useState(false);

  // Charger les plages autorisées dès qu'un pôle est choisi
  useEffect(() => {
    if (!form.pole_id || !form.annee_id) { setPlages(null); return; }
    api.get(`/evaluations/plages?annee_id=${form.annee_id}&pole_id=${form.pole_id}`)
      .then(r => setPlages(r.data)).catch(() => setPlages([]));
  }, [form.pole_id, form.annee_id]);

  // Contrainte des plages : option activée/désactivée par le Directeur DES
  const [contrainte, setContrainte] = useState(false);
  useEffect(() => {
    api.get('/parametres/contrainte-plages').then(r => setContrainte(!!r.data.active)).catch(() => {});
  }, []);

  // Changement de pôle ou de niveau : les formations disponibles changent, on repart d'une ligne vide
  useEffect(() => { setLignes([ligneVide()]); setErreurs({}); }, [form.pole_id, form.niveau]);

  const pole = poles.find(p => p.id === parseInt(form.pole_id));
  const cycle = form.niveau ? NIVEAUX[form.niveau]?.cycle : null;
  const formationsPole = (pole?.formations || []).filter(f => !cycle || f.cycle === cycle);

  function majLigne(i, patch) { setLignes(ls => ls.map((l, idx) => idx === i ? { ...l, ...patch } : l)); }
  function ajouterLigne() { setLignes(ls => [...ls, ligneVide()]); }
  function retirerLigne(i) { setLignes(ls => ls.length > 1 ? ls.filter((_, idx) => idx !== i) : ls); }

  async function submit(e) {
    e.preventDefault();
    if (!form.pole_id || !form.promotion_id) return toast.error('Sélectionnez un pôle et une promotion');
    if (!form.niveau || !form.semestre_code) return toast.error('Sélectionnez un niveau et un semestre');
    for (const l of lignes) {
      if (!l.formation_id) return toast.error('Sélectionnez une formation pour chaque ligne');
      if (!l.date_demarrage || !l.date_fin_prevue) return toast.error('Dates de démarrage et de clôture requises pour chaque formation');
    }
    const ids = lignes.map(l => l.formation_id);
    if (new Set(ids).size !== ids.length) return toast.error('Une même formation ne peut apparaître qu\'une seule fois');

    setLoading(true);
    const resultats = await Promise.allSettled(lignes.map(l => api.post('/evaluations', {
      ...form, formation_id: l.formation_id, date_demarrage: l.date_demarrage,
      date_fin_prevue: l.date_fin_prevue, groupe: l.groupe || null,
    })));
    setLoading(false);

    const echecs = lignes
      .map((l, i) => ({ ligne: l, erreur: resultats[i].status === 'rejected' ? (resultats[i].reason?.response?.data?.error || 'Erreur') : null }))
      .filter(x => x.erreur);
    const succes = lignes.length - echecs.length;

    if (succes > 0) { toast.success(`${succes} évaluation(s) enregistrée(s) — concernés notifiés`); onCreated(); }
    if (echecs.length === 0) {
      onClose();
    } else {
      // Ne restent affichées que les formations en échec, pour correction et nouvel essai
      setLignes(echecs.map(x => x.ligne));
      setErreurs(Object.fromEntries(echecs.map((x, idx) => [idx, x.erreur])));
      toast.error(`${echecs.length} formation(s) n'ont pas pu être enregistrées — corrigez et réessayez`, { duration: 6000 });
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b sticky top-0 bg-white z-10">
          <h2 className="font-semibold text-slate-800">Nouvelle(s) évaluation(s)</h2>
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

          <SelecteurCursus poles={poles} promotions={promotions} form={form} setForm={setForm} lockPole={estRF} hideFormation />

          {/* Plages du Planning annuel — bloquantes ou indicatives selon l'option du DES */}
          {form.pole_id && plages !== null && plages.length > 0 && (
            <div className={`border rounded-xl p-3 text-xs ${contrainte ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-blue-50 border-blue-100 text-blue-800'}`}>
              📅 <strong>Plages d'évaluations du Planning annuel{contrainte ? '' : ' (à titre indicatif)'} :</strong>{' '}
              {plages.map((p, i) => <span key={i} className="inline-block bg-white rounded-lg px-2 py-0.5 mx-0.5 font-semibold">{p.date_debut} → {p.date_fin}</span>)}
              {contrainte && <><br />🔒 Contrainte activée par le Directeur DES : les dates doivent impérativement s'y inscrire.</>}
            </div>
          )}
          {contrainte && form.pole_id && plages !== null && plages.length === 0 && (
            <div className="bg-red-50 border border-red-100 rounded-xl p-3 text-xs text-red-700">
              🔒 <strong>Contrainte des plages activée</strong> (Directeur DES) et aucune plage d'évaluations n'existe pour ce pôle :
              la création sera refusée tant qu'une activité Évaluations n'est pas posée au Planning annuel.
            </div>
          )}

          {/* Créneau horaire quotidien — partagé par toutes les formations de cette création */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium text-slate-700 block mb-1">Heure de début *</label>
              <input type="time" value={form.heure_debut} onChange={e => setForm(f => ({ ...f, heure_debut: e.target.value }))} required />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 block mb-1">Heure de fin *</label>
              <input type="time" value={form.heure_fin} onChange={e => setForm(f => ({ ...f, heure_fin: e.target.value }))} required />
            </div>
          </div>
          <p className="text-[11px] text-slate-400 -mt-2">
            🕐 Le créneau permet la programmation simultanée : deux évaluations aux mêmes dates mais à des heures différentes ne se cumulent pas dans les ENO.
          </p>

          {/* Une ou plusieurs formations du même pôle et de la même promotion — chacune avec sa période */}
          {form.pole_id && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-slate-700">Formation(s) et période(s) *</label>
                <span className="text-xs text-slate-400">{lignes.length} formation{lignes.length > 1 ? 's' : ''}</span>
              </div>
              {lignes.map((l, i) => (
                <LigneFormationEvaluation key={i} index={i} ligne={l}
                  formations={formationsPole}
                  formationsExclues={lignes.filter((_, idx) => idx !== i).map(x => x.formation_id).filter(Boolean)}
                  promotion_id={form.promotion_id} niveau={form.niveau}
                  heure_debut={form.heure_debut} heure_fin={form.heure_fin}
                  plages={plages} contrainte={contrainte}
                  onChange={majLigne} onRemove={retirerLigne} canRemove={lignes.length > 1}
                  erreur={erreurs[i]} />
              ))}
              <button type="button" onClick={ajouterLigne} disabled={lignes.length >= formationsPole.length}
                className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl border-2 border-dashed border-slate-300 text-sm font-medium text-slate-500 hover:border-blue-400 hover:text-blue-600 disabled:opacity-40 disabled:hover:border-slate-300 disabled:hover:text-slate-500">
                <Plus size={15} /> Ajouter une formation du même pôle et de la même promotion
              </button>
              <p className="text-[11px] text-slate-400">Une évaluation distincte sera enregistrée pour chaque formation, avec sa propre période.</p>
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Annuler</button>
            <button type="submit" disabled={loading} className="btn-primary flex-1">
              {loading ? '...' : lignes.length > 1 ? `Enregistrer ${lignes.length} évaluations` : 'Enregistrer'}
            </button>
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
  const [incidentsData, setIncidentsData] = useState([]);   // incidents avec conséquence évaluations
  const navigate = useNavigate();

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
      api.get('/incidents').catch(() => ({ data: [] })),
    ]).then(([s, p, pr, a, v, f, pl, inc]) => {
      setItems(s.data); setPoles(p.data); setPromotions(pr.data); setAnnees(a.data);
      setVacances(v.data); setFeries(f.data); setPlagesPlanning(pl.data);
      setIncidentsData(inc.data);
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

  // Suppression : Chef division DFE, Directeur DFIP, Admin (délibérée = Direction seulement)
  const canDelete = ['CHEF_DIV_EVALUATION', 'DIRECTEUR', 'ADMIN_PORTAIL'].includes(user?.role);
  // Suivi : Chef de division DFE
  const canSuivi = ['CHEF_DIV_EVALUATION', 'DIRECTEUR', 'ADMIN_PORTAIL'].includes(user?.role);
  // Création + dates : Responsable pédagogique du pôle (les RF consultent et signalent)
  // Création : Responsable de FORMATION (le Responsable pédagogique délibère, il ne crée pas)
  const canCreate = ['RESPONSABLE_FORMATION', 'CHEF_DIV_EVALUATION', 'DIRECTEUR', 'ADMIN_PORTAIL'].includes(user?.role);
  const estRF = user?.role === 'RESPONSABLE_FORMATION';
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
  // En mode Cartes/Liste, seules les évaluations RATTACHÉES À UNE FORMATION comptent —
  // les plages pôle entières issues du Planning annuel (sans formation) restent
  // visibles uniquement dans le calendrier (bande pointillée de la vue Planning).
  const affichesFormations = affiches.filter(s => s.formation_id);
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
        <div className="flex items-center gap-2">
          <BoutonCalendrierPdf poles={poles} promotions={promotions} />
          {canCreate && <button onClick={() => { setModalDate(null); setModal(true); }} className="btn-primary flex items-center gap-2"><Plus size={16} /> Nouvelle évaluation</button>}
        </div>
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
              {[['PLANNING', GanttChartSquare, 'Planning'], ['CARTES', LayoutGrid, 'Cartes'], ['LISTE', List, 'Liste']].map(([v, Icon, label]) => (
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

      {loading ? (
        <div className="flex justify-center h-32 items-center"><div className="w-6 h-6 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>
      ) : (vue === 'LISTE' || vue === 'CARTES') && affichesFormations.length === 0 ? (
        <div className="card py-12 text-center text-slate-400"><ClipboardCheck size={36} className="mx-auto mb-2 opacity-30" />Aucune évaluation par formation{segment ? ` pour le pôle ${segment}` : ''}</div>
      ) : vue !== 'LISTE' && vue !== 'CARTES' && affiches.length === 0 ? (
        <div className="card py-12 text-center text-slate-400"><ClipboardCheck size={36} className="mx-auto mb-2 opacity-30" />Aucune évaluation{segment ? ` pour le pôle ${segment}` : ''}</div>
      ) : vue === 'LISTE' ? (
        <ListeEvaluations evals={affichesFormations} onOuvrir={(id) => setDetailId(id)} />
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
            {affichesFormations.map(s => (
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
              // Incidents impactant les évaluations : bandes 🚨 (couleur = gravité), clic → module Incidents
              ...incidentsData
                .filter(i => (i.conseq_eval || i.consequence_examens)
                  && (i.date_debut || i.date_incident)
                  && (!segment || !i.pole_id || poles.find(p => p.id === i.pole_id)?.code === segment))
                .map(i => {
                  const debut = i.date_debut || i.date_incident;
                  return {
                    debut, fin: i.date_fin || debut,
                    color: GRAVITE_COULEUR[i.gravite] || '#991b1b',
                    label: `🚨 ${i.statut === 'RESOLU' ? '✓ ' : ''}${i.titre} · ${i.conseq_eval || i.consequence_examens}`,
                    titre: `Incident ${i.gravite} — ${i.titre} · Conséquence évaluations : ${i.conseq_eval || i.consequence_examens} · ${i.statut === 'RESOLU' ? 'Résolu' : i.statut} (cliquer pour ouvrir le module Incidents)`,
                    onClick: () => navigate('/incidents'),
                  };
                }),
              // Plages EVALUATIONS du Planning annuel : bandes pointillées
              ...plagesPlanning.filter(p => !segment || p.pole_code === segment).map(p => ({
                debut: p.date_debut, fin: p.date_fin, dashed: true,
                color: (POLES_SEG[p.pole_code] || POLES_SEG.STN).color,
                label: `${p.sous_type === 'DEVOIRS' ? '📝' : '🧪'} ${p.libelle} · ${p.ligne} (${p.pole_code})`,
                titre: `Planning annuel : ${p.libelle} (${p.ligne}) · ${p.sous_type === 'DEVOIRS' ? 'Devoirs' : 'Examen'} · ${p.date_debut} → ${p.date_fin}`,
              })),
              // Évaluations saisies : bandes pleines avec le nom de la formation.
              // Les évaluations LIÉES au planning (activite_id) sont déjà représentées
              // par la bande pointillée de leur plage : pas de double affichage.
              ...affiches.filter(s => !s.activite_id && s.date_demarrage).map(s => {
                const seg = POLES_SEG[s.pole_code] || POLES_SEG.STN;
                const fin = s.date_fin_prevue || s.date_demarrage;
                // Format : Promotion - Formation Niveau Semestre Session (ex : P10 - ANG L3 S5 SN)
                return {
                  debut: s.date_demarrage, fin,
                  color: s.etat === 'ANNULE' ? '#dc2626' : s.etat === 'SUSPENDU' ? '#7c3aed' : (ETAT_BAR[s.etat_eval] || seg.color),
                  label: `${s.type_evaluation === 'DEVOIR' ? '📝 ' : ''}${!segment ? `${s.pole_code} · ` : ''}${s.promotion_code ? `${s.promotion_code} - ` : ''}${s.formation_code || s.formation_nom || s.pole_code} ${s.niveau || ''} ${s.semestre_code || ''} ${SESSION_CODE[s.session_num]}${s.groupe ? ` ${s.groupe}` : ''}${s.delib_etat === 'TERMINEE' ? ' ⚖' : ''}`,
                  titre: `${s.pole_code}${s.promotion_code ? ` — Promotion ${s.promotion_code}` : ' — promotion non renseignée'} — ${s.formation_nom || 'Formation non précisée'} ${NIVEAUX[s.niveau]?.label || ''} Semestre ${(s.semestre_code || '').replace('S', '')} · ${TYPE_EVAL[s.type_evaluation]?.label || ''} ${SESSION_LABEL[s.session_num]} : ${s.date_demarrage} → ${fin} — ${ETAT_EVAL.options[s.etat_eval]}${s.delib_etat === 'TERMINEE' ? ' · Délibéré' : ''} (cliquer pour les détails)`,
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
                      {s.promotion_code ? `${s.promotion_code} - ` : ''}{s.formation_code || s.formation_nom || s.pole_code} {s.niveau || ''} {s.semestre_code || ''} {SESSION_CODE[s.session_num]}
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
          <span className="flex items-center gap-1.5">🚨 Incident impactant les évaluations
            <span className="w-3 h-3 rounded" style={{ background: GRAVITE_COULEUR.CRITIQUE }} title="Critique" />
            <span className="w-3 h-3 rounded" style={{ background: GRAVITE_COULEUR.HAUTE }} title="Haute" />
            <span className="w-3 h-3 rounded" style={{ background: GRAVITE_COULEUR.MOYENNE }} title="Moyenne" />
            <span className="w-3 h-3 rounded" style={{ background: GRAVITE_COULEUR.FAIBLE }} title="Faible" />
            (✓ = résolu)
          </span>
          <span>📝 = devoir · SN/SR/SS = session Normale/Rattrapage/Spéciale · ⚖ = délibéré · Cliquez sur une bande pour les détails.</span>
        </div>
      )}

      {modal && <ModalEvaluation poles={poles} promotions={promotions} annees={annees} user={user} defaultDate={modalDate} onClose={() => setModal(false)} onCreated={load} />}

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

      {/* Popup explicite : capacité des ENO dépassée */}
      {conflitInfo && (
        <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto nav-scroll">
            <div className="bg-red-600 text-white px-5 py-4">
              <h2 className="font-bold text-lg">⛔ Capacité des ENO dépassée</h2>
              <p className="text-red-100 text-xs mt-0.5">Les effectifs cumulés des évaluations simultanées excèdent les places disponibles.</p>
            </div>
            <div className="p-5 space-y-3">
              <p className="text-sm text-slate-700">{conflitInfo.error}</p>
              {conflitInfo.capacite?.satures?.length > 0 && (
                <div className="bg-red-50 border border-red-100 rounded-xl divide-y divide-red-100">
                  {conflitInfo.capacite.satures.map((s, i) => (
                    <div key={i} className="px-3 py-2 text-xs flex items-center gap-2">
                      <span className="font-bold text-red-800 flex-1">ENO {s.eno}</span>
                      <span className="text-slate-600">{s.demande} étudiants / {s.capacite} places</span>
                      <span className="badge bg-red-600 text-white text-[10px]">−{s.manque}</span>
                    </div>
                  ))}
                </div>
              )}
              <p className="text-xs text-slate-500">
                💡 Décalez vers un autre créneau ou un autre jour, ou utilisez le <strong>Simulateur</strong> du module Statistiques pour trouver une répartition faisable.
              </p>
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
            {s.groupe && <span className="badge bg-amber-100 text-amber-800" title="Promotion scindée : seule la moitié de l'effectif est comptée dans les ENO">👥 {s.groupe === 'G1' ? 'Groupe 1' : 'Groupe 2'}</span>}
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
            {s.etat === 'SUSPENDU' && <span className="badge bg-violet-100 text-violet-700 text-[10px]">⏸ Suspendue</span>}
            {verrouDelib && <span className="badge bg-purple-100 text-purple-700 text-[10px]" title="Délibération effective — modifiable uniquement par le Directeur DFIP">🔒 Clôturée</span>}
            <span className="text-xs font-bold text-slate-600">{Math.round(pct * 100)}%</span>
          </div>
        </div>
        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
          <div className={`h-full rounded-full transition-all duration-500 ${pct >= 1 ? 'bg-green-500' : pct >= 0.5 ? 'bg-blue-500' : pct >= 0.25 ? 'bg-amber-500' : 'bg-slate-400'}`}
            style={{ width: `${pct * 100}%` }} />
        </div>
      </div>

      {/* Dates + créneau horaire (Responsable pédagogique) */}
      <div className="grid grid-cols-2 gap-3 mb-3">
        {[['date_demarrage', 'Date de démarrage'], ['date_fin_prevue', 'Date de clôture']].map(([f, label]) => (
          <div key={f} className="bg-slate-50 rounded-xl px-3 py-2">
            <p className="text-[10px] uppercase tracking-wide text-slate-400 mb-0.5">{label}</p>
            {editDates ? (
              <input type="date" value={s[f] || ''} onChange={e => changerDate(s, f, e.target.value)} className="!py-0.5 !text-xs !bg-transparent !border-0 !px-0" />
            ) : <p className="text-xs font-semibold text-slate-700">{s[f] || '—'}</p>}
          </div>
        ))}
        <div className="col-span-2 bg-slate-50 rounded-xl px-3 py-2 flex items-center gap-2">
          <p className="text-[10px] uppercase tracking-wide text-slate-400">🕐 Créneau horaire</p>
          {editDates ? (
            <>
              <input type="time" value={s.heure_debut || ''} onChange={e => update(s.id, { heure_debut: e.target.value })} className="!w-auto !py-0.5 !text-xs" />
              <span className="text-slate-400 text-xs">→</span>
              <input type="time" value={s.heure_fin || ''} onChange={e => update(s.id, { heure_fin: e.target.value })} className="!w-auto !py-0.5 !text-xs" />
            </>
          ) : (
            <p className="text-xs font-semibold text-slate-700">{s.heure_debut ? `${s.heure_debut} → ${s.heure_fin || '—'}` : 'Journée entière'}</p>
          )}
        </div>
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

      {/* Évaluation ANNULÉE : suppression directe (Chef div DFE, Directeur, Admin) */}
      {s.etat === 'ANNULE' && canDelete && (
        <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 mt-3">
          <button onClick={() => del(s.id)} className="text-xs font-medium text-red-500 hover:bg-red-50 px-2.5 py-1.5 rounded-lg border border-red-200 flex items-center gap-1.5">
            <Trash2 size={13} /> Supprimer l'évaluation annulée
          </button>
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

/* Export PDF du calendrier d'examens d'un cursus (formation × promotion × niveau ± semestre ± session) */
/* ===== Vue LISTE : tableau simple et triable des évaluations (clic = ouvrir le détail) ===== */
function statutSuivi(e) {
  if (e.etat === 'SUSPENDU') return ['Examen suspendu', 'bg-violet-100 text-violet-700'];
  if (e.etat === 'ANNULE') return ['Examen annulé', 'bg-red-100 text-red-700'];
  if (e.delib_etat === 'TERMINEE') return ['Terminé et délibéré', 'bg-green-100 text-green-700'];
  if (e.etat_eval === 'EVAL_TERMINEES') return ['Examen terminé', 'bg-emerald-100 text-emerald-700'];
  if (e.etat_eval === 'EVAL_EN_COURS') return ['Évaluations en cours', 'bg-amber-100 text-amber-700'];
  if (e.date_programmation) return ['Examen programmé', 'bg-blue-100 text-blue-700'];
  return ['Examen à programmer', 'bg-slate-100 text-slate-600'];
}
function ListeEvaluations({ evals, onOuvrir }) {
  const [tri, setTri] = useState({ cle: 'date_demarrage', sens: 1 });
  const trier = (cle) => setTri(t => ({ cle, sens: t.cle === cle ? -t.sens : 1 }));

  const valeur = (s, cle) => {
    switch (cle) {
      case 'formation': return s.formation_code || s.formation_nom || s.pole_code || '';
      case 'statut': return statutSuivi(s)[0];
      case 'session': return s.session_num;
      default: return s[cle] ?? '';
    }
  };
  const lignes = [...evals].sort((a, b) => {
    const va = valeur(a, tri.cle), vb = valeur(b, tri.cle);
    const cmp = typeof va === 'number' ? va - vb : String(va).localeCompare(String(vb), 'fr');
    return cmp * tri.sens;
  });

  const COLS = [
    ['formation', 'Formation'], ['promotion_code', 'Promotion'], ['niveau', 'Niveau'],
    ['semestre_code', 'Semestre'], ['session', 'Session'], ['pole_code', 'Pôle'],
    ['date_demarrage', 'Début'], ['date_fin_prevue', 'Fin'], ['heure_debut', 'Horaire'], ['statut', 'Statut du suivi'],
  ];

  return (
    <div className="card !p-0 overflow-x-auto nav-scroll">
      <table className="w-full text-sm min-w-[1000px]">
        <thead>
          <tr className="bg-slate-50 border-b border-slate-200">
            {COLS.map(([cle, lbl]) => (
              <th key={cle} onClick={() => trier(cle)}
                className="text-left px-3 py-2.5 table-header cursor-pointer select-none hover:text-[#1e3a5f] whitespace-nowrap"
                title="Cliquer pour trier (re-cliquer pour inverser)">
                {lbl} {tri.cle === cle ? (tri.sens === 1 ? '▲' : '▼') : <span className="text-slate-300">↕</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lignes.map(s => {
            const [lbl, cls] = statutSuivi(s);
            const seg = POLES_SEG[s.pole_code] || POLES_SEG.STN;
            return (
              <tr key={s.id} onClick={() => onOuvrir(s.id)}
                className={`border-b border-slate-50 hover:bg-blue-50/40 cursor-pointer ${s.etat === 'ANNULE' ? 'opacity-50' : ''}`}
                title="Cliquer pour ouvrir le détail">
                <td className="px-3 py-2 font-medium text-slate-800">
                  {s.type_evaluation === 'DEVOIR' ? '📝 ' : ''}{s.formation_code || s.formation_nom || `${s.pole_code} (pôle)`}
                  {s.groupe && <span className="badge bg-amber-100 text-amber-800 text-[10px] ml-1.5">👥 {s.groupe === 'G1' ? 'Groupe 1' : 'Groupe 2'}</span>}
                  {s.etat === 'ANNULE' && <span className="badge bg-red-100 text-red-700 text-[10px] ml-1.5">Annulée</span>}
                  {s.etat === 'SUSPENDU' && <span className="badge bg-violet-100 text-violet-700 text-[10px] ml-1.5">⏸ Suspendue</span>}
                  {s.activite_id && <span title="Issue du planning annuel"> 🔗</span>}
                </td>
                <td className="px-3 py-2 text-slate-600">{s.promotion_code || '—'}</td>
                <td className="px-3 py-2 text-slate-600">{s.niveau || '—'}</td>
                <td className="px-3 py-2 text-slate-600">{s.semestre_code || '—'}</td>
                <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{SESSION_CODE[s.session_num]}</td>
                <td className="px-3 py-2 font-semibold" style={{ color: seg.color }}>{s.pole_code}</td>
                <td className="px-3 py-2 text-slate-600 whitespace-nowrap tabular-nums">{s.date_demarrage || '—'}</td>
                <td className="px-3 py-2 text-slate-600 whitespace-nowrap tabular-nums">{s.date_fin_prevue || '—'}</td>
                <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{s.heure_debut ? `${s.heure_debut}–${s.heure_fin || ''}` : 'Journée'}</td>
                <td className="px-3 py-2">
                  <span className={`badge ${cls} text-[11px]`}>{lbl}</span>
                  {s.delib_etat === 'TERMINEE' && <span title="Délibérée"> ⚖</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* Groupe de cases à cocher réutilisable du modal d'export (multi-sélection) */
function GroupeCoches({ label, options, values, onToggle, cols = 3 }) {
  const COLS = { 1: 'grid-cols-1', 2: 'grid-cols-2', 3: 'grid-cols-3' };
  return (
    <div>
      <label className="text-sm font-medium text-slate-700 block mb-1">{label}</label>
      <div className={`grid ${COLS[cols] || COLS[3]} gap-1.5 max-h-40 overflow-y-auto nav-scroll border border-slate-200 rounded-xl p-2`}>
        {options.map(o => (
          <label key={o.v} className={`flex items-center gap-1.5 text-xs px-1.5 py-1 rounded-lg cursor-pointer ${values.includes(o.v) ? 'bg-blue-50 text-blue-800 font-semibold' : 'text-slate-600 hover:bg-slate-50'}`}
            title={o.t || undefined}>
            <input type="checkbox" checked={values.includes(o.v)} onChange={() => onToggle(o.v)} className="accent-[#1e3a5f]" />
            <span className="truncate">{o.l}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

function BoutonCalendrierPdf({ poles, promotions }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ poles: [], formations: [], promotions: [], niveaux: [], semestres: [], sessions: [], debut: '', fin: '' });
  const toggle = (champ) => (v) => setF(x => ({ ...x, [champ]: x[champ].includes(v) ? x[champ].filter(y => y !== v) : [...x[champ], v] }));

  // Formations proposées : restreintes aux pôles cochés (toutes sinon)
  const formations = poles
    .filter(p => f.poles.length === 0 || f.poles.includes(String(p.id)))
    .flatMap(p => (p.formations || []).map(x => ({ ...x, pole_code: p.code })));
  const semestres = f.niveaux.length > 0
    ? [...new Set(f.niveaux.flatMap(n => NIVEAUX[n]?.semestres || []))].sort()
    : ['S1', 'S2', 'S3', 'S4', 'S5', 'S6'];

  // Au moins un critère structurant : pôle(s), formation(s) ou période complète
  const peutGenerer = f.poles.length > 0 || f.formations.length > 0 || (f.debut && f.fin);

  function generer() {
    const qs = new URLSearchParams();
    for (const k of ['poles', 'formations', 'promotions', 'niveaux', 'semestres', 'sessions']) {
      if (f[k].length > 0) qs.set(k, f[k].join(','));
    }
    if (f.debut) qs.set('debut', f.debut);
    if (f.fin) qs.set('fin', f.fin);
    window.open(`/calendrier-examens?${qs}`, '_blank');
    setOpen(false);
  }

  return (
    <>
      <button onClick={() => setOpen(true)} className="btn-secondary flex items-center gap-2">
        📄 Calendrier PDF
      </button>
      {open && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto nav-scroll">
            <div className="flex items-center justify-between p-5 border-b sticky top-0 bg-white z-10">
              <h2 className="font-semibold text-slate-800">📄 Calendrier d'examens — export PDF</h2>
              <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>
            <div className="p-5 space-y-3">
              <p className="text-xs text-slate-500">
                Combinez librement les critères — <strong>sélections multiples</strong> partout.
                Au moins un <strong>pôle</strong>, une <strong>formation</strong> ou une <strong>période complète</strong> est requis.
              </p>

              <GroupeCoches label="Pôle(s)" cols={3}
                options={poles.map(p => ({ v: String(p.id), l: p.code, t: p.nom }))}
                values={f.poles}
                onToggle={(v) => setF(x => {
                  const nv = x.poles.includes(v) ? x.poles.filter(y => y !== v) : [...x.poles, v];
                  // Retirer les formations qui ne sont plus dans les pôles cochés
                  const ok = new Set(poles.filter(p => nv.length === 0 || nv.includes(String(p.id)))
                    .flatMap(p => (p.formations || []).map(fo => String(fo.id))));
                  return { ...x, poles: nv, formations: x.formations.filter(id => ok.has(id)) };
                })} />

              <GroupeCoches label="Formation(s) — toutes celles des pôles cochés si aucune" cols={2}
                options={formations.map(fo => ({ v: String(fo.id), l: `${fo.pole_code} — ${fo.code || fo.nom}`, t: fo.nom }))}
                values={f.formations} onToggle={toggle('formations')} />

              <div>
                <label className="text-sm font-medium text-slate-700 block mb-1">Période (intervalle de dates) — optionnelle</label>
                <PlageDates debut={f.debut} fin={f.fin} compact
                  onChange={({ debut, fin }) => setF(x => ({ ...x, debut, fin }))} />
                <p className="text-[11px] text-slate-400 mt-1">Seules les évaluations chevauchant cette période figureront dans le calendrier.</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <GroupeCoches label="Promotion(s)" cols={2}
                  options={promotions.map(p => ({ v: p.code, l: p.code }))}
                  values={f.promotions} onToggle={toggle('promotions')} />
                <GroupeCoches label="Niveau(x)" cols={2}
                  options={Object.entries(NIVEAUX).map(([k, n]) => ({ v: k, l: k, t: n.label }))}
                  values={f.niveaux}
                  onToggle={(v) => setF(x => {
                    const nv = x.niveaux.includes(v) ? x.niveaux.filter(y => y !== v) : [...x.niveaux, v];
                    const ok = new Set(nv.length > 0 ? nv.flatMap(n => NIVEAUX[n]?.semestres || []) : ['S1', 'S2', 'S3', 'S4', 'S5', 'S6']);
                    return { ...x, niveaux: nv, semestres: x.semestres.filter(s => ok.has(s)) };
                  })} />
                <GroupeCoches label="Semestre(s)" cols={2}
                  options={semestres.map(s => ({ v: s, l: `S${s.replace('S', '')}` }))}
                  values={f.semestres} onToggle={toggle('semestres')} />
                <GroupeCoches label="Session(s)" cols={1}
                  options={[{ v: '1', l: 'Normale (SN)' }, { v: '2', l: 'Rattrapage (SR)' }, { v: '3', l: 'Spéciale (SS)' }]}
                  values={f.sessions} onToggle={toggle('sessions')} />
              </div>

              <div className="flex gap-2 pt-1">
                <button onClick={() => setOpen(false)} className="btn-secondary flex-1">Annuler</button>
                <button onClick={generer} disabled={!peutGenerer} className="btn-primary flex-1 disabled:opacity-40"
                  title={peutGenerer ? undefined : 'Cochez au moins un pôle, une formation ou une période complète'}>
                  Générer le calendrier
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
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
