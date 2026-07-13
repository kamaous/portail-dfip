import { useEffect, useState } from 'react';
import api from '../lib/api';
import toast from 'react-hot-toast';
import { Plus, BookOpen, Trash2, AlertTriangle, Calendar, LayoutGrid, GanttChartSquare, List } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useMemo } from 'react';
import { useTimeline, Overlays, BandeauVacances, EnTeteUnites, FondGrille, ZoomBar } from './PlanningAnnuel';

/* Configuration des champs d'état — vocabulaire officiel du fichier Tutorat UN-CHK */
const ENROLEMENT = {
  options: { EN_ATTENTE: 'Pas encore', EN_COURS: 'Enrôlement en cours (partiel)', TERMINE: 'Enrôlement effectif' },
  colors: { EN_ATTENTE: 'bg-slate-100 text-slate-600', EN_COURS: 'bg-amber-100 text-amber-700', TERMINE: 'bg-green-100 text-green-700' },
};
const ETATS = {
  plateforme_cours: {
    label: 'Plateforme de cours',
    options: { PAS_DISPONIBLE: 'Pas encore disponible', EN_DEPLOIEMENT: 'En cours', DISPONIBLE: 'Disponible' },
    colors: { PAS_DISPONIBLE: 'bg-slate-100 text-slate-600', EN_DEPLOIEMENT: 'bg-amber-100 text-amber-700', DISPONIBLE: 'bg-green-100 text-green-700' },
  },
  cours: {
    label: 'Cours',
    options: { INDISPONIBLES: 'Pas encore disponible', EN_COURS: 'En cours', DISPONIBLES: 'Disponible' },
    colors: { INDISPONIBLES: 'bg-slate-100 text-slate-600', EN_COURS: 'bg-amber-100 text-amber-700', DISPONIBLES: 'bg-green-100 text-green-700' },
  },
  enrolement_tuteurs: { label: 'Tuteurs', ...ENROLEMENT },
  enrolement_etudiants: { label: 'Étudiants', ...ENROLEMENT },
  enrolement_enseignants: { label: 'Enseignants concepteurs', ...ENROLEMENT },
  etat_tutorat: {
    label: 'État du tutorat',
    options: { PAS_DEMARRE: 'En attente de démarrage', EN_COURS: 'En cours', TERMINE: 'Terminé' },
    colors: { PAS_DEMARRE: 'bg-slate-100 text-slate-600', EN_COURS: 'bg-blue-100 text-blue-700', TERMINE: 'bg-green-100 text-green-700' },
  },
};

/* Segments = pôles (couleurs alignées sur le Planning annuel) */
const POLES_SEG = {
  LSHE: { color: '#6d28d9', light: '#f0e9fb' },
  STN: { color: '#16a34a', light: '#e8f6ec' },
  SEJA: { color: '#ea580c', light: '#fdeee3' },
};
const ETAT_BAR = { PAS_DEMARRE: '#94a3b8', EN_COURS: null, TERMINE: '#16a34a' }; // null = couleur du pôle

/* Ligne d'indicateur de la section PLATEFORMES ET TUTORATS */
function IndicRow({ field, value, onChange, editable }) {
  const cfg = ETATS[field];
  const ok = OK_CIBLES[field] === value;
  return (
    <div className={`flex items-center gap-3 px-3 py-2 rounded-xl transition-colors ${ok ? 'bg-green-50/80' : 'bg-slate-50'}`}>
      <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${ok ? 'bg-green-500 ring-4 ring-green-100' : value === 'EN_COURS' || value === 'EN_DEPLOIEMENT' ? 'bg-amber-400 ring-4 ring-amber-100' : 'bg-slate-300'}`} />
      <span className="text-sm font-medium text-slate-700 flex-1">{cfg.label}</span>
      {editable ? (
        <select
          value={value}
          onChange={e => onChange(field, e.target.value)}
          className={`!w-auto !py-1 !text-xs font-semibold rounded-lg border-0 ${cfg.colors[value]} cursor-pointer`}
        >
          {Object.entries(cfg.options).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      ) : (
        <span className={`badge ${cfg.colors[value]}`}>{cfg.options[value] || value}</span>
      )}
      {ok && <span className="text-green-600 font-bold text-sm">✓</span>}
    </div>
  );
}

/* Niveaux et semestres officiels UN-CHK :
   L1/M1 → S1,S2 · L2 → S3,S4 · L3 → S5,S6 · M2 → S3 */
export const NIVEAUX = {
  L1: { label: 'Licence 1', cycle: 'LICENCE', semestres: ['S1', 'S2'] },
  L2: { label: 'Licence 2', cycle: 'LICENCE', semestres: ['S3', 'S4'] },
  L3: { label: 'Licence 3', cycle: 'LICENCE', semestres: ['S5', 'S6'] },
  M1: { label: 'Master 1', cycle: 'MASTER', semestres: ['S1', 'S2'] },
  M2: { label: 'Master 2', cycle: 'MASTER', semestres: ['S3'] },
};

/* « Tout est OK » = valeurs cibles des 5 indicateurs PLATEFORMES ET TUTORATS */
export const OK_CIBLES = {
  plateforme_cours: 'DISPONIBLE',
  cours: 'DISPONIBLES',
  enrolement_tuteurs: 'TERMINE',
  enrolement_etudiants: 'TERMINE',
  enrolement_enseignants: 'TERMINE',
};
const progression = (t) => Object.entries(OK_CIBLES).filter(([k, v]) => t[k] === v).length;
const joursRestants = (d) => d ? Math.ceil((new Date(d) - new Date()) / 86400000) : null;

/* Sélecteur Pôle → Formation → Promotion → Niveau → Semestre (référentiel UN-CHK) */
export function SelecteurCursus({ poles, promotions, form, setForm, lockPole }) {
  const pole = poles.find(p => p.id === parseInt(form.pole_id));
  const cycle = form.niveau ? NIVEAUX[form.niveau]?.cycle : null;
  const formations = (pole?.formations || []).filter(f => !cycle || f.cycle === cycle);
  return (
    <>
      <div>
        <label className="text-sm font-medium text-slate-700 block mb-1">Pôle *</label>
        {lockPole ? (
          <p className="w-full border border-slate-200 bg-slate-50 rounded-xl px-3 py-2 text-sm text-slate-700 font-medium">
            {pole?.nom || '—'} <span className="text-xs text-slate-400">(votre pôle)</span>
          </p>
        ) : (
          <select value={form.pole_id} onChange={e => setForm(f => ({ ...f, pole_id: e.target.value, formation_id: '' }))} required>
            <option value="">Choisir...</option>
            {poles.map(p => <option key={p.id} value={p.id}>{p.nom}</option>)}
          </select>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-sm font-medium text-slate-700 block mb-1">Promotion *</label>
          <select value={form.promotion_id} onChange={e => setForm(f => ({ ...f, promotion_id: e.target.value }))} required>
            <option value="">Choisir...</option>
            {promotions.map(p => <option key={p.id} value={p.id}>{p.code} ({p.annee_entree})</option>)}
          </select>
        </div>
        <div>
          <label className="text-sm font-medium text-slate-700 block mb-1">Niveau *</label>
          <select value={form.niveau} onChange={e => setForm(f => ({ ...f, niveau: e.target.value, semestre_code: '', formation_id: '' }))} required>
            <option value="">Choisir...</option>
            {Object.entries(NIVEAUX).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>
      </div>
      {form.niveau && (
        <div>
          <label className="text-sm font-medium text-slate-700 block mb-1">Semestre *</label>
          <div className="flex gap-2">
            {NIVEAUX[form.niveau].semestres.map(s => (
              <button key={s} type="button" onClick={() => setForm(f => ({ ...f, semestre_code: s }))}
                className={`px-3.5 py-1.5 rounded-lg text-sm font-medium border transition-colors ${form.semestre_code === s ? 'bg-[#1e3a5f] text-white border-[#1e3a5f]' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>
                {s === 'CT' ? 'CT (transversaux)' : s}
              </button>
            ))}
          </div>
        </div>
      )}
      {form.pole_id && (
        <div>
          <label className="text-sm font-medium text-slate-700 block mb-1">Formation *</label>
          <select value={form.formation_id} onChange={e => setForm(f => ({ ...f, formation_id: e.target.value }))} required>
            <option value="">Choisir...</option>
            {formations.map(f => <option key={f.id} value={f.id}>{f.nom}</option>)}
          </select>
        </div>
      )}
    </>
  );
}

function ModalTutorat({ poles, promotions, annees, user, onClose, onCreated }) {
  const estRF = ['RESPONSABLE_FORMATION', 'RESPONSABLE_PEDAGOGIQUE'].includes(user?.role);
  const [form, setForm] = useState({
    annee_id: annees.find(a => a.active)?.id || '',
    pole_id: estRF && user?.pole_id ? String(user.pole_id) : '',   // pôle verrouillé pour un responsable de formation
    formation_id: '', promotion_id: '', niveau: '', semestre_code: '',
    date_debut: '', date_fin: '',
  });
  const [loading, setLoading] = useState(false);
  const [plages, setPlages] = useState(null);

  // Plages TUTORAT du Planning annuel pour le pôle choisi (cadrage des dates)
  useEffect(() => {
    if (!form.pole_id || !form.annee_id) { setPlages(null); return; }
    api.get(`/planning/plages?type=TUTORAT&annee_id=${form.annee_id}`)
      .then(r => {
        const code = poles.find(p => p.id === parseInt(form.pole_id))?.code;
        setPlages(r.data.filter(p => p.pole_code === code));
      }).catch(() => setPlages([]));
  }, [form.pole_id, form.annee_id, poles]);

  async function submit(e) {
    e.preventDefault();
    if (!form.annee_id) return toast.error('Sélectionnez une année');
    if (!form.semestre_code) return toast.error('Sélectionnez un semestre');
    if (!form.date_debut || !form.date_fin) return toast.error('Les dates de début et de fin sont requises');
    setLoading(true);
    try {
      await api.post('/tutorat', form);
      toast.success(estRF
        ? 'Fiche soumise au Chef de division Technopédagogie pour validation'
        : 'Fiche de suivi créée');
      onCreated(); onClose();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur');
    } finally { setLoading(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b sticky top-0 bg-white">
          <h2 className="font-semibold text-slate-800">Nouvelle fiche de suivi tutorat</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-4">
          {estRF && (
            <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-xs text-blue-800">
              ℹ️ Votre fiche sera <strong>soumise au Chef de division Technopédagogie</strong> pour validation
              avant le démarrage du suivi PLATEFORMES ET TUTORATS.
            </div>
          )}
          <div>
            <label className="text-sm font-medium text-slate-700 block mb-1">Année académique *</label>
            <select value={form.annee_id} onChange={e => setForm(f => ({ ...f, annee_id: e.target.value }))} required>
              <option value="">Choisir...</option>
              {annees.map(a => <option key={a.id} value={a.id}>{a.libelle}{a.active ? ' (active)' : ''}</option>)}
            </select>
          </div>
          <SelecteurCursus poles={poles} promotions={promotions} form={form} setForm={setForm} lockPole={estRF} />

          {/* Plages TUTORAT du planning annuel */}
          {form.pole_id && plages !== null && plages.length > 0 && (
            <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-xs text-blue-800">
              📅 <strong>Plages tutorat du Planning annuel :</strong>{' '}
              {plages.map((p, i) => <span key={i} className="inline-block bg-white rounded-lg px-2 py-0.5 mx-0.5 font-semibold">{p.date_debut} → {p.date_fin}</span>)}
              <br />Les dates de la fiche doivent s'y inscrire.
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium text-slate-700 block mb-1">Date début tutorat *</label>
              <input type="date" value={form.date_debut} onChange={e => setForm(f => ({ ...f, date_debut: e.target.value }))} required />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 block mb-1">Date fin tutorat *</label>
              <input type="date" value={form.date_fin} onChange={e => setForm(f => ({ ...f, date_fin: e.target.value }))} required />
            </div>
          </div>
          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Annuler</button>
            <button type="submit" disabled={loading} className="btn-primary flex-1">{loading ? 'Création...' : 'Créer'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function FicheCard({ t, onChange, onRetard, onDelete, onValider, canDelete, canWrite, canValider }) {
  const seg = POLES_SEG[t.pole_code] || POLES_SEG.STN;
  const prog = progression(t);
  const toutOK = prog === 5;
  const jr = joursRestants(t.date_debut);
  const validee = t.statut_fiche === 'VALIDEE' || !t.statut_fiche;
  const soumise = t.statut_fiche === 'SOUMISE';
  const rejetee = t.statut_fiche === 'REJETEE';
  const editable = canWrite && validee;

  // Couleur d'alerte : vert = prêt · rouge = date dépassée sans être prêt · ambre = J-14 · bleu sinon
  const alerte = toutOK ? 'green' : (jr !== null && jr < 0) ? 'red' : (jr !== null && jr <= 14) ? 'amber' : 'blue';
  const ALERTE = {
    green: { bar: 'bg-green-500', chip: 'bg-green-100 text-green-700', txt: 'Tout est OK ✓' },
    red: { bar: 'bg-red-500', chip: 'bg-red-100 text-red-700 animate-pulse', txt: jr !== null ? `En retard de ${Math.abs(jr)} j` : 'En retard' },
    amber: { bar: 'bg-amber-500', chip: 'bg-amber-100 text-amber-700', txt: `J−${jr} avant démarrage` },
    blue: { bar: 'bg-blue-500', chip: 'bg-blue-100 text-blue-700', txt: jr !== null ? `J−${jr}` : 'Dates à venir' },
  }[alerte];

  return (
    <div className={`bg-white rounded-2xl shadow-sm border overflow-hidden ${soumise ? 'border-amber-200' : rejetee ? 'border-red-200 opacity-75' : 'border-slate-100'}`}>
      {/* En-tête à la couleur du pôle */}
      <div className="px-5 py-4 text-white" style={{ background: `linear-gradient(135deg, ${seg.color}, ${seg.color}cc)` }}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-white/70 text-[11px] font-bold uppercase tracking-wider">{t.pole_code} · {t.annee_libelle}</p>
            <h3 className="font-bold text-lg leading-tight truncate" title={t.formation_nom}>{t.formation_nom || 'Formation —'}</h3>
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            {soumise && <span className="badge bg-amber-400 text-amber-950">⏳ À valider</span>}
            {rejetee && <span className="badge bg-red-200 text-red-800">Rejetée</span>}
            {validee && (
              <span className={`badge ${t.etat_tutorat === 'EN_COURS' ? 'bg-white text-blue-700' : t.etat_tutorat === 'TERMINE' ? 'bg-green-300 text-green-900' : 'bg-white/25 text-white'}`}>
                {ETATS.etat_tutorat.options[t.etat_tutorat]}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 mt-2 flex-wrap">
          {t.promotion_code && <span className="bg-white/20 rounded-lg px-2 py-0.5 text-xs font-bold">{t.promotion_code}</span>}
          {t.niveau && <span className="bg-white/20 rounded-lg px-2 py-0.5 text-xs font-bold">{NIVEAUX[t.niveau]?.label || t.niveau}</span>}
          {t.semestre_code && <span className="bg-white/20 rounded-lg px-2 py-0.5 text-xs font-bold">Semestre {t.semestre_code.replace('S', '')}</span>}
          <span className="ml-auto text-xs text-white/80 flex items-center gap-1"><Calendar size={12} /> {t.date_debut || '—'} → {t.date_fin || '—'}</span>
        </div>
      </div>

      <div className="p-5 space-y-4">
        {/* Fiche soumise : validation par le Chef div. Technopédagogie */}
        {soumise && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
            <p className="text-sm text-amber-800 font-medium mb-2">
              📥 Fiche soumise par {t.created_by_prenom} {t.created_by_nom} — en attente de validation du Chef de division Technopédagogie.
            </p>
            {canValider && (
              <div className="flex gap-2">
                <button onClick={() => onValider(t.id, 'VALIDEE')} className="btn-primary !py-1.5 text-xs !bg-green-600 hover:!bg-green-700 flex-1">✓ Valider la fiche</button>
                <button onClick={() => onValider(t.id, 'REJETEE')} className="btn-secondary !py-1.5 text-xs !text-red-600 !border-red-200 hover:!bg-red-50 flex-1">✕ Rejeter</button>
              </div>
            )}
          </div>
        )}

        {validee && (
          <>
            {/* Barre de progression + alerte */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Plateformes et tutorats</p>
                <div className="flex items-center gap-2">
                  <span className={`badge ${ALERTE.chip} text-[11px]`}>{ALERTE.txt}</span>
                  <span className="text-xs font-bold text-slate-600">{prog}/5</span>
                </div>
              </div>
              <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                <div className={`h-full rounded-full transition-all duration-500 ${ALERTE.bar}`} style={{ width: `${(prog / 5) * 100}%` }} />
              </div>
            </div>

            {/* Les 5 indicateurs */}
            <div className="space-y-1.5">
              <IndicRow field="plateforme_cours" value={t.plateforme_cours} onChange={(f, v) => onChange(t.id, f, v)} editable={editable} />
              <IndicRow field="cours" value={t.cours} onChange={(f, v) => onChange(t.id, f, v)} editable={editable} />
              <IndicRow field="enrolement_tuteurs" value={t.enrolement_tuteurs} onChange={(f, v) => onChange(t.id, f, v)} editable={editable} />
              <IndicRow field="enrolement_etudiants" value={t.enrolement_etudiants} onChange={(f, v) => onChange(t.id, f, v)} editable={editable} />
              <IndicRow field="enrolement_enseignants" value={t.enrolement_enseignants} onChange={(f, v) => onChange(t.id, f, v)} editable={editable} />
            </div>

            {/* État tutorat : verrouillé tant que tout n'est pas OK */}
            <div className={`flex items-center gap-3 rounded-xl p-3 border ${toutOK ? 'bg-blue-50/60 border-blue-100' : 'bg-slate-50 border-slate-200'}`}>
              <span className="text-sm font-semibold text-slate-700 flex-1">État du tutorat</span>
              {!toutOK ? (
                <span className="text-xs text-slate-500 flex items-center gap-1.5" title="Plateforme et cours disponibles + les 3 enrôlements effectifs requis">
                  🔒 <span className="badge bg-slate-200 text-slate-600">{ETATS.etat_tutorat.options.PAS_DEMARRE}</span>
                  <span className="hidden sm:inline">— tout doit être OK pour démarrer</span>
                </span>
              ) : editable ? (
                <select value={t.etat_tutorat} onChange={e => onChange(t.id, 'etat_tutorat', e.target.value)}
                  className={`!w-auto !py-1 !text-xs font-semibold rounded-lg border-0 ${ETATS.etat_tutorat.colors[t.etat_tutorat]}`}>
                  {Object.entries(ETATS.etat_tutorat.options).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              ) : (
                <span className={`badge ${ETATS.etat_tutorat.colors[t.etat_tutorat]}`}>{ETATS.etat_tutorat.options[t.etat_tutorat]}</span>
              )}
            </div>

            {/* Dates effectives */}
            {(editable || t.date_demarree_le || t.date_terminee_le) && (
              <div className="grid grid-cols-2 gap-3">
                {[['date_demarree_le', 'Démarré le'], ['date_terminee_le', 'Terminé le']].map(([f, label]) => (
                  <div key={f} className="bg-slate-50 rounded-xl px-3 py-2">
                    <p className="text-[10px] uppercase tracking-wide text-slate-400 mb-0.5">{label}</p>
                    {editable ? (
                      <input type="date" value={t[f] || ''} onChange={e => onChange(t.id, f, e.target.value)} className="!py-0.5 !text-xs !bg-transparent !border-0 !px-0" />
                    ) : <p className="text-xs font-semibold text-slate-700">{t[f] || '—'}</p>}
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* Pied de carte */}
        <div className="flex items-center justify-between pt-1">
          <p className="text-[11px] text-slate-400">Créée par {t.created_by_prenom} {t.created_by_nom}</p>
          <div className="flex items-center gap-1.5">
            {canWrite && validee && (
              <button onClick={() => onRetard(t)} className="text-xs font-medium text-orange-600 hover:bg-orange-50 px-2.5 py-1.5 rounded-lg flex items-center gap-1">
                <AlertTriangle size={13} /> Retard
              </button>
            )}
            {canDelete && (
              <button onClick={() => onDelete(t.id)} className="p-1.5 text-red-400 hover:bg-red-50 rounded">
                <Trash2 size={15} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Tutorat() {
  const { user } = useAuth();
  const [tutorats, setTutorats] = useState([]);
  const [poles, setPoles] = useState([]);
  const [promotions, setPromotions] = useState([]);
  const [annees, setAnnees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [filtreEtat, setFiltreEtat] = useState('');
  const [retardModal, setRetardModal] = useState(null);
  const [vue, setVue] = useState('PLANNING');          // PLANNING | FICHES
  const [segment, setSegment] = useState(null);        // null = tous les pôles
  const [zoom, setZoom] = useState({ mode: 'ANNEE' });
  const [detailId, setDetailId] = useState(null);      // fiche ouverte en popup
  const [vacances, setVacances] = useState([]);
  const [feries, setFeries] = useState([]);

  function load() {
    setLoading(true);
    Promise.all([
      api.get(`/tutorat${filtreEtat ? `?etat=${filtreEtat}` : ''}`),
      api.get('/poles'),
      api.get('/poles/promotions'),
      api.get('/dashboard/annees'),
      api.get('/calendrier-academique/vacances'),
      api.get('/calendrier-academique/feries'),
    ]).then(([t, p, pr, a, v, f]) => {
      setTutorats(t.data); setPoles(p.data); setPromotions(pr.data); setAnnees(a.data);
      setVacances(v.data); setFeries(f.data);
    }).finally(() => setLoading(false));
  }
  useEffect(load, [filtreEtat]);

  async function changeField(id, field, value) {
    setTutorats(ts => ts.map(t => t.id === id ? { ...t, [field]: value } : t)); // optimiste
    try {
      await api.put(`/tutorat/${id}`, { [field]: value });
      if (field === 'etat_tutorat') toast.success('État mis à jour — concernés notifiés');
    } catch (err) {
      if (err.response?.data?.verrou_etat) {
        toast.error(err.response.data.error, { icon: '🔒', duration: 5000 });
      } else {
        toast.error(err.response?.data?.error || 'Erreur');
      }
      load();
    }
  }

  async function valider(id, decision) {
    if (decision === 'REJETEE' && !confirm('Rejeter cette fiche de suivi ?')) return;
    try {
      await api.post(`/tutorat/${id}/valider`, { decision });
      toast.success(decision === 'VALIDEE'
        ? 'Fiche validée — le suivi PLATEFORMES ET TUTORATS démarre'
        : 'Fiche rejetée — le responsable de formation est notifié');
      load();
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
  }

  async function supprimer(id) {
    if (!confirm('Supprimer cette fiche de suivi ?')) return;
    await api.delete(`/tutorat/${id}`);
    toast.success('Supprimée'); load();
  }

  const canDelete = ['DIRECTEUR', 'ADMIN_PORTAIL'].includes(user?.role);
  // Section PLATEFORMES ET TUTORATS : Chef division Technopédagogie (aligné sur le backend)
  const canWrite = ['CHEF_DIV_TECHNOPEDAGOGIE', 'DIRECTEUR', 'ADMIN_PORTAIL'].includes(user?.role);
  const canValider = canWrite;
  // Création des fiches : Responsables de formation + Responsable pédagogique (héritage)
  const canCreate = ['RESPONSABLE_FORMATION', 'RESPONSABLE_PEDAGOGIQUE', 'CHEF_DIV_TECHNOPEDAGOGIE', 'DIRECTEUR', 'ADMIN_PORTAIL'].includes(user?.role);
  const canSetDemarrage = ['DIRECTEUR', 'CHEF_DIV_TECHNOPEDAGOGIE', 'ADMIN_PORTAIL'].includes(user?.role);
  const anneeActive = annees.find(a => a.active);

  // Profils rattachés à un pôle : vue limitée à leur pôle uniquement
  const ROLES_POLE = ['MEMBRE_POLE', 'RESPONSABLE_POLE', 'RESPONSABLE_PEDAGOGIQUE', 'RESPONSABLE_FORMATION', 'ENSEIGNANT', 'ETUDIANT'];
  const poleCodeUser = ROLES_POLE.includes(user?.role) && user?.pole_id
    ? poles.find(p => p.id === user.pole_id)?.code || null
    : null;
  useEffect(() => { if (poleCodeUser) setSegment(poleCodeUser); }, [poleCodeUser]);

  const tl = useTimeline(anneeActive?.libelle || '', zoom);
  // Fériés récurrents matérialisés dans la plage de la timeline
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

  const tutoratsAffiches = segment ? tutorats.filter(t => t.pole_code === segment) : tutorats;
  const ficheDetail = tutorats.find(t => t.id === detailId);

  async function setDemarrageGlobal(date) {
    if (!anneeActive) return toast.error('Aucune année active');
    await api.put('/tutorat/demarrage-global', { annee_id: anneeActive.id, date });
    toast.success('Date de démarrage globale enregistrée — concernés notifiés');
    api.get('/dashboard/annees').then(r => setAnnees(r.data));
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Suivi du tutorat</h1>
          <p className="text-slate-500 text-sm">{tutorats.length} fiche(s) de suivi par semestre</p>
        </div>
        {canCreate && (
          <button onClick={() => setModal(true)} className="btn-primary flex items-center gap-2">
            <Plus size={16} /> Nouvelle fiche
          </button>
        )}
      </div>

      {/* Date de démarrage globale du tutorat */}
      <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 flex items-center gap-3 flex-wrap">
        <Calendar size={18} className="text-blue-600 shrink-0" />
        <p className="text-sm text-blue-900 font-medium">
          Démarrage global du tutorat {anneeActive ? `(${anneeActive.libelle})` : ''} :
          {anneeActive?.date_demarrage_tutorat
            ? <span className="font-bold"> {anneeActive.date_demarrage_tutorat}</span>
            : <span className="text-blue-500 italic"> non définie</span>}
        </p>
        {canSetDemarrage && (
          <input
            type="date"
            defaultValue={anneeActive?.date_demarrage_tutorat || ''}
            onChange={e => e.target.value && setDemarrageGlobal(e.target.value)}
            className="!w-auto !py-1.5 !text-xs ml-auto"
          />
        )}
      </div>

      {/* Segments pôles + bascule de vue */}
      <div className="card !p-3">
        <div className="flex flex-wrap items-center gap-2">
          {!poleCodeUser && (
            <button
              onClick={() => setSegment(null)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold border-2 transition-all ${
                segment === null ? 'bg-slate-800 text-white border-slate-800 shadow-md' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
              }`}
            >
              <LayoutGrid size={15} /> Tous les pôles
            </button>
          )}
          {poles.filter(p => !poleCodeUser || p.code === poleCodeUser).map(p => {
            const seg = POLES_SEG[p.code] || POLES_SEG.STN;
            const actif = segment === p.code;
            const nb = tutorats.filter(t => t.pole_code === p.code).length;
            return (
              <button
                key={p.code}
                onClick={() => setSegment(actif ? null : p.code)}
                title={p.nom}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold border-2 transition-all ${actif ? 'text-white shadow-md scale-105' : 'bg-white hover:scale-[1.02]'}`}
                style={actif ? { background: seg.color, borderColor: seg.color } : { color: seg.color, borderColor: `${seg.color}55` }}
              >
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: actif ? '#fff' : seg.color }} />
                {p.code}
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${actif ? 'bg-white/25' : 'bg-slate-100 text-slate-500'}`}>{nb}</span>
              </button>
            );
          })}
          <div className="ml-auto flex items-center gap-2 flex-wrap">
            {vue === 'PLANNING' && <ZoomBar zoom={zoom} setZoom={setZoom} libelle={anneeActive?.libelle || ''} />}
            <div className="flex rounded-xl border border-slate-200 overflow-hidden">
              {[['PLANNING', GanttChartSquare, 'Planning'], ['FICHES', List, 'Fiches']].map(([v, Icon, label]) => (
                <button key={v} onClick={() => setVue(v)}
                  className={`flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium transition-colors ${vue === v ? 'bg-[#1e3a5f] text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
                  <Icon size={15} /> {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="flex gap-2">
        {['', 'PAS_DEMARRE', 'EN_COURS', 'TERMINE'].map(s => (
          <button key={s} onClick={() => setFiltreEtat(s)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${filtreEtat === s ? 'bg-[#1e3a5f] text-white' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'}`}>
            {s ? ETATS.etat_tutorat.options[s] : 'Tous'}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-32">
          <div className="w-6 h-6 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : tutoratsAffiches.length === 0 ? (
        <div className="card py-12 text-center text-slate-400">
          <BookOpen size={36} className="mx-auto mb-2 opacity-30" />
          Aucune fiche de suivi{segment ? ` pour le pôle ${segment}` : ''}
        </div>
      ) : vue === 'FICHES' ? (
        <div className="grid lg:grid-cols-2 gap-4">
          {tutoratsAffiches.map(t => (
            <FicheCard key={t.id} t={t} onChange={changeField} onRetard={setRetardModal} onDelete={supprimer} onValider={valider} canDelete={canDelete} canWrite={canWrite} canValider={canValider} />
          ))}
        </div>
      ) : (
        /* ===== Vue PLANNING : pôle → formations → barres de tutorat ===== */
        <div className="card !p-0 overflow-x-auto nav-scroll">
          <div className="min-w-[1100px]">
            {/* En-tête des mois */}
            <div className="flex sticky top-0 bg-white z-10 border-b border-slate-200">
              <div className="w-64 shrink-0 px-3 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wide border-r border-slate-200">
                Pôles / Formations
              </div>
              <EnTeteUnites tl={tl} />
            </div>

            <BandeauVacances vacances={vacances} feries={feriesRange} tl={tl} />

            {poles.filter(p => !segment || p.code === segment).map(pole => {
              const seg = POLES_SEG[pole.code] || POLES_SEG.STN;
              const fichesPole = tutoratsAffiches.filter(t => t.pole_code === pole.code);
              // Une ligne par formation ayant au moins une fiche
              const formations = [...new Set(fichesPole.map(t => t.formation_nom || '(formation non précisée)'))];
              const focus = segment === pole.code;
              return (
                <div key={pole.code} className="border-b border-slate-100 last:border-0">
                  <div className={`flex items-center gap-2 px-3 ${focus ? 'py-3' : 'py-2'}`} style={{ background: seg.light }}>
                    <span className={`font-bold ${focus ? 'text-base' : 'text-sm'}`} style={{ color: seg.color }}>{pole.nom}</span>
                    <span className="text-xs text-slate-400 ml-auto">{fichesPole.length} fiche(s)</span>
                  </div>
                  {formations.length === 0 && (
                    <p className="text-xs text-slate-400 italic px-3 py-2">Aucune fiche de tutorat</p>
                  )}
                  {formations.map(fname => {
                    const fiches = fichesPole.filter(t => (t.formation_nom || '(formation non précisée)') === fname);
                    return (
                      <div key={fname} className="flex border-t border-slate-50">
                        <div className={`w-64 shrink-0 px-3 border-r border-slate-100 text-slate-600 ${focus ? 'py-4 text-sm font-medium' : 'py-2 text-xs'}`}>
                          <span className="line-clamp-2" title={fname}>{fname}</span>
                        </div>
                        <div className={`flex-1 relative ${focus ? 'h-14' : 'h-9'}`}>
                          <FondGrille tl={tl} />
                          <Overlays vacances={vacances} feries={feriesRange} tl={tl} />
                          {fiches.map((t, idx) => {
                            const debut = t.date_debut || t.date_demarree_le;
                            const fin = t.date_fin || t.date_terminee_le;
                            if ((debut && fin) && (tl.pctRaw(fin) <= 0 || tl.pctRaw(debut) >= 100)) return null; // hors fenêtre
                            if (!debut || !fin) {
                              if (tl.mode === 'MOIS') return null; // pastilles « sans dates » seulement en vue année
                              // Fiche sans dates : pastille cliquable en début de piste
                              return (
                                <button key={t.id} onClick={() => setDetailId(t.id)}
                                  title={`${t.promotion_code || ''} ${t.semestre_code || ''} — dates non renseignées (cliquer pour détails)`}
                                  className="absolute top-1 bottom-1 rounded-md border-2 border-dashed px-1.5 text-[10px] font-semibold flex items-center"
                                  style={{ left: `${1 + idx * 8}%`, color: seg.color, borderColor: `${seg.color}66`, background: '#fff' }}>
                                  {t.promotion_code || '?'} {t.semestre_code || ''} · sans dates
                                </button>
                              );
                            }
                            const l = tl.pct(debut), r = tl.pct(fin);
                            const w = Math.max(r - l, tl.mode === 'MOIS' ? 2.5 : 1);
                            const bg = ETAT_BAR[t.etat_tutorat] || seg.color;
                            return (
                              <div key={t.id} onClick={() => setDetailId(t.id)}
                                title={`${t.promotion_code || ''} ${t.niveau || ''} ${t.semestre_code || ''} : ${debut} → ${fin} — ${ETATS.etat_tutorat.options[t.etat_tutorat]} (cliquer pour détails)`}
                                className={`absolute rounded-md flex items-center gap-1 px-2 font-semibold text-white shadow-sm overflow-hidden cursor-pointer hover:opacity-85 hover:ring-2 hover:ring-white/60 ${focus ? 'top-2 bottom-2 text-xs' : 'top-1 bottom-1 text-[10px]'}`}
                                style={{ left: `${l}%`, width: `${w}%`, background: bg }}>
                                <span className="truncate">{t.promotion_code || ''} {t.semestre_code || ''} · {ETATS.etat_tutorat.options[t.etat_tutorat]}</span>
                              </div>
                            );
                          })}
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
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded" style={{ background: '#94a3b8' }} /> En attente de démarrage</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded" style={{ background: '#2563eb' }} /> En cours (couleur du pôle)</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded" style={{ background: '#16a34a' }} /> Terminé</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-red-500/25 border border-red-300" /> Vacances</span>
          <span>Cliquez sur une barre pour afficher et modifier la fiche.</span>
        </div>
      )}

      {modal && <ModalTutorat poles={poles} promotions={promotions} annees={annees} user={user} onClose={() => setModal(false)} onCreated={load} />}
      {retardModal && <ModalRetard fiche={retardModal} onClose={() => setRetardModal(null)} onDone={() => { setRetardModal(null); }} />}

      {/* Popup détails d'une fiche (depuis la vue planning) */}
      {ficheDetail && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setDetailId(null)}>
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto nav-scroll" onClick={e => e.stopPropagation()}>
            <FicheCard
              t={ficheDetail}
              onChange={changeField}
              onRetard={(f) => { setDetailId(null); setRetardModal(f); }}
              onDelete={(id) => { setDetailId(null); supprimer(id); }}
              onValider={valider}
              canDelete={canDelete}
              canWrite={canWrite}
              canValider={canValider}
            />
            <button onClick={() => setDetailId(null)} className="w-full mt-2 bg-white/90 rounded-xl py-2 text-sm text-slate-500 hover:text-slate-700">
              Fermer
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ModalRetard({ fiche, onClose, onDone }) {
  const [form, setForm] = useState({ description: '', consequence_tutorat: 'Fin prolongée', consequence_calendrier: '' });
  const [loading, setLoading] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post(`/tutorat/${fiche.id}/signaler-retard`, form);
      toast.success('Incident de retard créé — concernés notifiés');
      onDone();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur');
    } finally { setLoading(false); }
  }
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b">
          <h2 className="font-semibold text-slate-800 flex items-center gap-2"><AlertTriangle size={18} className="text-orange-500" /> Signaler un retard</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-4">
          <p className="text-sm text-slate-500">{fiche.formation_nom}{fiche.promotion_code ? ` · ${fiche.promotion_code}` : ''}{fiche.semestre_code ? ` · ${fiche.semestre_code}` : ''} · Dates : {fiche.date_debut || '—'} → {fiche.date_fin || '—'}</p>
          <div>
            <label className="text-sm font-medium text-slate-700 block mb-1">Description</label>
            <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={3} placeholder="Détails du non-respect des dates..." />
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700 block mb-1">Conséquence sur le tutorat</label>
            <input value={form.consequence_tutorat} onChange={e => setForm(f => ({ ...f, consequence_tutorat: e.target.value }))} placeholder="Ex: Fin prolongée" />
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700 block mb-1">Conséquence sur le calendrier</label>
            <input value={form.consequence_calendrier} onChange={e => setForm(f => ({ ...f, consequence_calendrier: e.target.value }))} placeholder="Ex: Décalage des dates de fin" />
          </div>
          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Annuler</button>
            <button type="submit" disabled={loading} className="btn-danger flex-1">{loading ? '...' : 'Créer l\'incident'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
