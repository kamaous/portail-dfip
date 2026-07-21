import { useEffect, useState } from 'react';
import api from '../lib/api';
import toast from 'react-hot-toast';
import { Plus, BookOpen, Trash2, AlertTriangle, Calendar, LayoutGrid, GanttChartSquare, List } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useMemo } from 'react';
import { BoutonSignaler, PanneauSignalements } from '../components/Signalements';
import PlageDates from '../components/PlageDates';
import { useNavigate } from 'react-router-dom';

/* Couleur des bandes d'incident selon la gravité (légende propre aux modules) */
export const GRAVITE_COULEUR = { CRITIQUE: '#991b1b', HAUTE: '#ea580c', MOYENNE: '#d97706', FAIBLE: '#64748b' };

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
    options: { PAS_DEMARRE: 'En attente de démarrage', PRET: 'Prêt pour démarrage', EN_COURS: 'En cours', TERMINE: 'Terminé' },
    colors: { PAS_DEMARRE: 'bg-slate-100 text-slate-600', PRET: 'bg-teal-100 text-teal-700', EN_COURS: 'bg-blue-100 text-blue-700', TERMINE: 'bg-green-100 text-green-700' },
  },
};

/* Segments = pôles (couleurs alignées sur le Planning annuel) */
const POLES_SEG = {
  LSHE: { color: '#6d28d9', light: '#f0e9fb' },
  STN: { color: '#16a34a', light: '#e8f6ec' },
  SEJA: { color: '#ea580c', light: '#fdeee3' },
};
const ETAT_BAR = { PAS_DEMARRE: '#94a3b8', PRET: '#0d9488', EN_COURS: null, TERMINE: '#16a34a' }; // null = couleur du pôle

/* État AUTOMATIQUE du tutorat, déduit des conditions de démarrage et des dates :
   - conditions non réunies → En attente de démarrage
   - conditions réunies avant la date de démarrage → Prêt pour démarrage
   - conditions réunies et date de fin atteinte → Terminé
   - sinon → En cours */
export function etatTutoratAuto(t) {
  if (t.statut_fiche === 'SOUMISE' || t.statut_fiche === 'REJETEE') return 'PAS_DEMARRE';
  const ok = Object.entries(OK_CIBLES).every(([k, v]) => t[k] === v);
  if (!ok) return 'PAS_DEMARRE';
  const d = t.date_demarree_le || t.date_debut, f = t.date_terminee_le || t.date_fin;
  const now = Date.now();
  if (d && now < Date.parse(d)) return 'PRET';
  if (f && now >= Date.parse(f)) return 'TERMINE';
  return 'EN_COURS';
}

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

/* Progression du tutorat — quota officiel :
   1. Validation de la fiche : 10 %
   2. Écoulement de la durée fixée (démarrage → fin prévue) : 90 % */
export function progressionDates(t) {
  const valide = (t.statut_fiche === 'VALIDEE' || !t.statut_fiche) ? 0.10 : 0;
  const d = t.date_demarree_le || t.date_debut, f = t.date_terminee_le || t.date_fin;
  let temps = 0;
  if (d && f) {
    const a = Date.parse(d), b = Date.parse(f), now = Date.now();
    temps = b <= a ? (now >= b ? 1 : 0) : Math.min(1, Math.max(0, (now - a) / (b - a)));
  }
  return valide + 0.90 * temps;
}

/* ===== Calendrier mensuel façon Google Agenda =====
   Bandes multi-jours empilées par semaine (couloirs), vacances en fond rosé,
   fériés en point rouge. Partagé entre les modules Tutorat et Évaluations.
   events: [{ debut, fin (ISO), label, titre, color, dashed?, onClick? }] */
const MOIS_FR = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
const isoJour = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function CalendrierMois({ events, vacances = [], feries = [], onDayClick }) {
  const [mois, setMois] = useState(() => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), 1); });
  const aujourd = isoJour(new Date());

  // Semaines affichées : du lundi précédant le 1er au dimanche suivant la fin du mois
  const semaines = useMemo(() => {
    const start = new Date(mois);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7)); // lundi
    const finMois = new Date(mois.getFullYear(), mois.getMonth() + 1, 0);
    const out = [];
    const cur = new Date(start);
    while (cur <= finMois) {
      const jours = [];
      for (let i = 0; i < 7; i++) { jours.push(new Date(cur)); cur.setDate(cur.getDate() + 1); }
      out.push(jours);
    }
    return out;
  }, [mois]);

  // Bandes d'une semaine : segment [c0..c1] (colonnes 0-6) + couloir (lane) sans chevauchement
  function bandesSemaine(jours) {
    const sISO = isoJour(jours[0]), eISO = isoJour(jours[6]);
    const diff = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
    const evs = events
      .filter(ev => ev.debut && ev.fin && ev.debut <= eISO && ev.fin >= sISO)
      .sort((a, b) => a.debut.localeCompare(b.debut) || b.fin.localeCompare(a.fin));
    const finCouloirs = []; // dernière colonne occupée de chaque couloir
    return evs.map(ev => {
      const c0 = Math.max(0, diff(sISO, ev.debut));
      const c1 = Math.min(6, diff(sISO, ev.fin));
      let lane = finCouloirs.findIndex(fc => fc < c0);
      if (lane === -1) { lane = finCouloirs.length; finCouloirs.push(c1); } else { finCouloirs[lane] = c1; }
      return { ...ev, c0, c1, lane, continueG: ev.debut < sISO, continueD: ev.fin > eISO };
    });
  }

  return (
    <div className="card !p-0 overflow-hidden">
      {/* Barre de navigation du mois */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100 flex-wrap">
        <button onClick={() => { const n = new Date(); setMois(new Date(n.getFullYear(), n.getMonth(), 1)); }}
          className="btn-secondary !py-1.5 !px-3 !text-xs">Aujourd'hui</button>
        <button onClick={() => setMois(m => new Date(m.getFullYear(), m.getMonth() - 1, 1))}
          className="w-8 h-8 rounded-full hover:bg-slate-100 text-slate-500 font-bold">‹</button>
        <button onClick={() => setMois(m => new Date(m.getFullYear(), m.getMonth() + 1, 1))}
          className="w-8 h-8 rounded-full hover:bg-slate-100 text-slate-500 font-bold">›</button>
        <h3 className="font-bold text-lg text-slate-800 ml-1">{MOIS_FR[mois.getMonth()]} {mois.getFullYear()}</h3>
      </div>

      {/* En-tête des jours */}
      <div className="grid grid-cols-7 text-center text-[11px] font-semibold text-slate-400 uppercase tracking-wide py-1.5 border-b border-slate-100">
        {['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].map(j => <div key={j}>{j}</div>)}
      </div>

      {/* Semaines */}
      {semaines.map((jours, wi) => {
        const bandes = bandesSemaine(jours);
        const nbLanes = bandes.reduce((m, b) => Math.max(m, b.lane + 1), 0);
        return (
          <div key={wi} className="relative grid grid-cols-7 border-t border-slate-100 first:border-t-0"
            style={{ minHeight: Math.max(92, 34 + nbLanes * 24 + 8) }}>
            {jours.map((j, di) => {
              const jISO = isoJour(j);
              const horsMois = j.getMonth() !== mois.getMonth();
              const ferie = feries.find(f => f.recurrent ? f.date.slice(5) === jISO.slice(5) : f.date === jISO);
              const enVacances = vacances.some(v => v.date_debut <= jISO && jISO <= v.date_fin);
              return (
                <div key={di}
                  onClick={onDayClick ? () => onDayClick(jISO) : undefined}
                  className={`border-l border-slate-100 first:border-l-0 px-1.5 pt-1 ${horsMois ? 'bg-slate-50/70' : ''} ${enVacances ? '!bg-red-50/70' : ''} ${onDayClick ? 'cursor-pointer hover:bg-blue-50/60' : ''}`}
                  title={[ferie && `Férié : ${ferie.libelle}`, enVacances && 'Vacances', onDayClick && `Cliquer pour créer au ${jISO}`].filter(Boolean).join(' · ') || undefined}>
                  <div className="flex items-center gap-1">
                    <span className={`text-xs w-6 h-6 flex items-center justify-center rounded-full ${jISO === aujourd ? 'bg-blue-600 text-white font-bold' : horsMois ? 'text-slate-300' : 'text-slate-600 font-medium'}`}>
                      {j.getDate()}
                    </span>
                    {ferie && <span className="w-2 h-2 rounded-full bg-red-500 border border-white shadow-sm shrink-0" />}
                  </div>
                </div>
              );
            })}
            {/* Bandes multi-jours (façon Google Agenda) */}
            {bandes.map((b, bi) => (
              <div key={bi} onClick={b.onClick} title={b.titre}
                className={`absolute h-5 flex items-center px-1.5 text-[10px] font-semibold overflow-hidden whitespace-nowrap shadow-sm z-10 ${b.onClick ? 'cursor-pointer hover:opacity-85 hover:ring-2 hover:ring-blue-200' : 'cursor-help'} ${b.continueG ? '' : 'rounded-l-md'} ${b.continueD ? '' : 'rounded-r-md'} ${b.dashed ? 'border-2 border-dashed bg-white/95' : 'text-white'}`}
                style={{
                  top: 34 + b.lane * 24,
                  left: `calc(${(b.c0 / 7) * 100}% + 2px)`,
                  width: `calc(${((b.c1 - b.c0 + 1) / 7) * 100}% - 4px)`,
                  background: b.dashed ? undefined : b.color,
                  borderColor: b.dashed ? b.color : undefined,
                  color: b.dashed ? b.color : undefined,
                }}>
                <span className="truncate">{b.continueG ? '… ' : ''}{b.label}{b.continueD ? ' …' : ''}</span>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

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

function ModalTutorat({ poles, promotions, annees, user, defaultDebut, onClose, onCreated }) {
  const estRF = user?.role === 'RESPONSABLE_PEDAGOGIQUE'; // pôle verrouillé + fiche soumise à validation
  const [form, setForm] = useState({
    annee_id: annees.find(a => a.active)?.id || '',
    pole_id: estRF && user?.pole_id ? String(user.pole_id) : '',   // pôle verrouillé pour un responsable de formation
    formation_id: '', promotion_id: '', niveau: '', semestre_code: '',
    date_debut: defaultDebut || '', date_fin: '',
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

          <div>
            <label className="text-sm font-medium text-slate-700 block mb-1">Période du tutorat (début → fin) *</label>
            <PlageDates debut={form.date_debut} fin={form.date_fin}
              onChange={({ debut, fin }) => setForm(f => ({ ...f, date_debut: debut, date_fin: fin }))} />
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

function FicheCard({ t, onChange, onRetard, onDelete, onValider, onSaveEtat, onSaveDates, estCreateur, canDelete, canWrite, canValider, peutSignaler }) {
  const seg = POLES_SEG[t.pole_code] || POLES_SEG.STN;
  const prog = progression(t);
  const toutOK = prog === 5;
  const pctDates = progressionDates(t); // quota : 10 % validation + 90 % durée écoulée
  const etatAuto = etatTutoratAuto(t);  // état calculé automatiquement
  const [editionDates, setEditionDates] = useState(false);
  const [datesForm, setDatesForm] = useState({ date_debut: t.date_debut || '', date_fin: t.date_fin || '' });
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
            {t.activite_id && <span className="badge bg-white/25 text-white" title="Issue du planning annuel — dates pilotées par l'activité liée">🔗 Planning annuel</span>}
            {soumise && <span className="badge bg-amber-400 text-amber-950">⏳ À valider</span>}
            {rejetee && <span className="badge bg-red-200 text-red-800">Rejetée</span>}
            {validee && (
              <span className={`badge ${etatAuto === 'EN_COURS' ? 'bg-white text-blue-700' : etatAuto === 'TERMINE' ? 'bg-green-300 text-green-900' : etatAuto === 'PRET' ? 'bg-teal-200 text-teal-900' : 'bg-white/25 text-white'}`}>
                {ETATS.etat_tutorat.options[etatAuto]}
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
                  <span className="text-xs font-bold text-slate-600" title={`Progression temporelle (${t.date_debut || '—'} → ${t.date_fin || '—'}) · indicateurs : ${prog}/5`}>
                    {Math.round(pctDates * 100)}%
                  </span>
                </div>
              </div>
              {/* Progression basée sur les dates de début et de fin du tutorat */}
              <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                <div className={`h-full rounded-full transition-all duration-500 ${ALERTE.bar}`} style={{ width: `${pctDates * 100}%` }} />
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

            {/* Enregistrer l'état : le Chef Technopédagogie peut revenir modifier à tout moment */}
            {editable && (
              <button onClick={() => onSaveEtat(t)}
                className="btn-primary w-full !py-2 text-xs flex items-center justify-center gap-1.5">
                💾 Enregistrer l'état
              </button>
            )}

            {/* État tutorat : AUTOMATIQUE (conditions de démarrage + dates) */}
            <div className={`flex items-center gap-3 rounded-xl p-3 border ${toutOK ? 'bg-blue-50/60 border-blue-100' : 'bg-slate-50 border-slate-200'}`}
              title="Prêt pour démarrage : conditions réunies avant la date de démarrage · Terminé : conditions réunies et date de fin atteinte · En cours : sinon">
              <span className="text-sm font-semibold text-slate-700 flex-1">
                État du tutorat <span className="text-[10px] font-normal text-slate-400">(automatique)</span>
              </span>
              <span className={`badge ${ETATS.etat_tutorat.colors[etatAuto]}`}>{ETATS.etat_tutorat.options[etatAuto]}</span>
            </div>

            {/* Dates : démarrage par défaut = date soumise par le RP, fin prévue par défaut = date de fin donnée */}
            <div className="grid grid-cols-2 gap-3">
              {[['date_demarree_le', 'Date de démarrage', t.date_debut], ['date_terminee_le', 'Date de fin prévue', t.date_fin]].map(([f, label, defaut]) => (
                <div key={f} className="bg-slate-50 rounded-xl px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wide text-slate-400 mb-0.5">{label}{!t[f] && defaut ? ' (par défaut)' : ''}</p>
                  {editable ? (
                    <input type="date" value={t[f] || defaut || ''} onChange={e => onChange(t.id, f, e.target.value)} className="!py-0.5 !text-xs !bg-transparent !border-0 !px-0" />
                  ) : <p className="text-xs font-semibold text-slate-700">{t[f] || defaut || '—'}</p>}
                </div>
              ))}
            </div>
          </>
        )}

        {/* Édition par le créateur (Responsable pédagogique) : soumise à re-validation du Chef Technopédagogie */}
        {estCreateur && !rejetee && !t.activite_id && (
          <div className="border border-blue-100 bg-blue-50/50 rounded-xl p-3 space-y-2">
            {!editionDates ? (
              <button onClick={() => { setDatesForm({ date_debut: t.date_debut || '', date_fin: t.date_fin || '' }); setEditionDates(true); }}
                className="text-xs font-semibold text-blue-700 hover:underline">
                ✏️ Modifier les dates de la fiche
              </button>
            ) : (
              <>
                <p className="text-[11px] text-blue-700">⚠️ Vos modifications seront <strong>soumises à la validation du Chef de division Technopédagogie</strong>.</p>
                <PlageDates compact debut={datesForm.date_debut} fin={datesForm.date_fin}
                  onChange={({ debut, fin }) => setDatesForm({ date_debut: debut, date_fin: fin })} />
                <div className="flex gap-2">
                  <button onClick={() => setEditionDates(false)} className="btn-secondary !py-1 text-xs flex-1">Annuler</button>
                  <button onClick={async () => { await onSaveDates(t, datesForm); setEditionDates(false); }}
                    className="btn-primary !py-1 text-xs flex-1">Enregistrer (soumis à validation)</button>
                </div>
              </>
            )}
          </div>
        )}

        {/* Pied de carte */}
        <div className="flex items-center justify-between pt-1">
          <p className="text-[11px] text-slate-400">Créée par {t.created_by_prenom} {t.created_by_nom}</p>
          <div className="flex items-center gap-1.5">
            {peutSignaler && (
              <BoutonSignaler cibleType="TUTORAT" cibleId={t.id}
                contexte={`${t.formation_nom || t.pole_nom || ''} · ${t.promotion_code || ''} ${t.niveau || ''} ${t.semestre_code || ''}`} />
            )}
            {canWrite && validee && (
              <button onClick={() => onRetard(t)} className="text-xs font-medium text-orange-600 hover:bg-orange-50 px-2.5 py-1.5 rounded-lg flex items-center gap-1">
                <AlertTriangle size={13} /> Retard
              </button>
            )}
            {canDelete && !t.activite_id && (
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
  const [modalDate, setModalDate] = useState(null); // date pré-remplie (clic sur un jour du calendrier)
  const [filtreEtat, setFiltreEtat] = useState('');
  const [retardModal, setRetardModal] = useState(null);
  const [vue, setVue] = useState('PLANNING');          // PLANNING | FICHES
  const [segment, setSegment] = useState(null);        // null = tous les pôles
  const [detailId, setDetailId] = useState(null);      // fiche ouverte en popup
  const [fNiveau, setFNiveau] = useState('');
  const [fFormation, setFFormation] = useState('');
  const [fSemestre, setFSemestre] = useState('');
  const [fPromo, setFPromo] = useState('');
  const [vacances, setVacances] = useState([]);
  const [feries, setFeries] = useState([]);
  const [plagesPlanning, setPlagesPlanning] = useState([]); // activités type TUTORAT du Planning annuel
  const [incidentsData, setIncidentsData] = useState([]);   // incidents avec conséquence tutorat
  const navigate = useNavigate();

  function load() {
    setLoading(true);
    Promise.all([
      api.get('/tutorat'),
      api.get('/poles'),
      api.get('/poles/promotions'),
      api.get('/dashboard/annees'),
      api.get('/calendrier-academique/vacances'),
      api.get('/calendrier-academique/feries'),
      api.get('/planning/plages?type=TUTORAT'),
      api.get('/incidents').catch(() => ({ data: [] })),
    ]).then(([t, p, pr, a, v, f, pl, inc]) => {
      setTutorats(t.data); setPoles(p.data); setPromotions(pr.data); setAnnees(a.data);
      setVacances(v.data); setFeries(f.data); setPlagesPlanning(pl.data);
      setIncidentsData(inc.data);
    }).finally(() => setLoading(false));
  }
  useEffect(load, []);

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

  // Enregistrement groupé de l'état (Chef Technopédagogie — modifiable à tout moment)
  async function saveEtat(t) {
    try {
      await api.put(`/tutorat/${t.id}`, {
        plateforme_cours: t.plateforme_cours, cours: t.cours,
        enrolement_tuteurs: t.enrolement_tuteurs, enrolement_etudiants: t.enrolement_etudiants,
        enrolement_enseignants: t.enrolement_enseignants,
      });
      toast.success('État enregistré — vous pourrez revenir le modifier à tout moment');
      load();
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
  }

  // Modification par le créateur (RP) : la fiche repasse en validation chez le Chef Technopédagogie
  async function saveDates(t, dates) {
    try {
      await api.put(`/tutorat/${t.id}`, dates);
      toast.success('Modifications enregistrées — la fiche est soumise à la re-validation du Chef Technopédagogie', { duration: 6000 });
      load();
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
  }
  const estCreateurFiche = (t) => user?.role === 'RESPONSABLE_PEDAGOGIQUE' && user?.id === t.created_by;

  const canDelete = ['DIRECTEUR', 'ADMIN_PORTAIL'].includes(user?.role);
  // Section PLATEFORMES ET TUTORATS : Chef division Technopédagogie (aligné sur le backend)
  const canWrite = ['CHEF_DIV_TECHNOPEDAGOGIE', 'DIRECTEUR', 'ADMIN_PORTAIL'].includes(user?.role);
  const canValider = canWrite;
  // Création des fiches : Responsable pédagogique du pôle (les RF consultent et signalent)
  const canCreate = ['RESPONSABLE_PEDAGOGIQUE', 'CHEF_DIV_TECHNOPEDAGOGIE', 'DIRECTEUR', 'ADMIN_PORTAIL'].includes(user?.role);
  const peutSignaler = user?.role === 'RESPONSABLE_FORMATION';
  const canSetDemarrage = ['DIRECTEUR', 'CHEF_DIV_TECHNOPEDAGOGIE', 'ADMIN_PORTAIL'].includes(user?.role);
  const anneeActive = annees.find(a => a.active);

  // Vue limitée au pôle : responsables de formation uniquement
  // (Directeurs de pôle et Responsables pédagogiques voient TOUS les pôles, comme la direction)
  const ROLES_POLE = ['MEMBRE_POLE', 'RESPONSABLE_FORMATION', 'ENSEIGNANT', 'ETUDIANT'];
  const poleCodeUser = ROLES_POLE.includes(user?.role) && user?.pole_id
    ? poles.find(p => p.id === user.pole_id)?.code || null
    : null;
  useEffect(() => { if (poleCodeUser) setSegment(poleCodeUser); }, [poleCodeUser]);

  // Filtres combinables : niveau, formation, semestre, promotion
  const formationsDispo = useMemo(() =>
    [...new Set(tutorats.map(t => t.formation_code || t.formation_nom).filter(Boolean))].sort(), [tutorats]);
  const semestresDispo = useMemo(() =>
    [...new Set(tutorats.map(t => t.semestre_code).filter(Boolean))].sort(), [tutorats]);
  const promosDispo = useMemo(() =>
    [...new Set(tutorats.map(t => t.promotion_code).filter(Boolean))].sort(), [tutorats]);

  const tutoratsAffiches = tutorats.filter(t =>
    (!segment || t.pole_code === segment) &&
    (!filtreEtat || etatTutoratAuto(t) === filtreEtat) &&
    (!fNiveau || t.niveau === fNiveau) &&
    (!fFormation || (t.formation_code || t.formation_nom) === fFormation) &&
    (!fSemestre || t.semestre_code === fSemestre) &&
    (!fPromo || t.promotion_code === fPromo));
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
          <button onClick={() => { setModalDate(null); setModal(true); }} className="btn-primary flex items-center gap-2">
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

      {/* Signalements des responsables de formation → traités par le Responsable pédagogique */}
      <PanneauSignalements cibleType="TUTORAT" user={user} />

      <div className="flex gap-2 flex-wrap items-center">
        {['', 'PAS_DEMARRE', 'PRET', 'EN_COURS', 'TERMINE'].map(s => (
          <button key={s} onClick={() => setFiltreEtat(s)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${filtreEtat === s ? 'bg-[#1e3a5f] text-white' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'}`}>
            {s ? ETATS.etat_tutorat.options[s] : 'Tous'}
          </button>
        ))}
        {/* Filtres combinables : niveau, formation, semestre, promotion */}
        <div className="flex items-center gap-2 flex-wrap ml-auto">
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
        <>
          {/* Activités TUTORAT issues du Planning annuel */}
          {(() => {
            const plagesAff = plagesPlanning.filter(p => !segment || p.pole_code === segment);
            if (plagesAff.length === 0) return null;
            return (
              <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-xs text-blue-800 flex items-center gap-2 flex-wrap">
                <span className="font-semibold">📚 Tutorat au Planning annuel :</span>
                {plagesAff.map((p, i) => (
                  <span key={i} className="bg-white rounded-lg px-2 py-1 font-semibold" title={p.ligne}>
                    {p.pole_code} · {p.libelle} : {p.date_debut} → {p.date_fin}
                  </span>
                ))}
                <span className="text-blue-500">Les fiches de suivi ci-dessous s'inscrivent dans ces plages.</span>
              </div>
            );
          })()}
          <div className="grid lg:grid-cols-2 gap-4">
            {tutoratsAffiches.map(t => (
              <FicheCard key={t.id} t={t} onChange={changeField} onRetard={setRetardModal} onDelete={supprimer} onValider={valider}
                onSaveEtat={saveEtat} onSaveDates={saveDates} estCreateur={estCreateurFiche(t)}
                canDelete={canDelete} canWrite={canWrite} canValider={canValider} peutSignaler={peutSignaler} />
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
              // Incidents impactant le tutorat : bandes 🚨 (couleur = gravité), clic → module Incidents
              ...incidentsData
                .filter(i => (i.conseq_tutorat || i.consequence_tutorat)
                  && (i.date_debut || i.date_incident)
                  && (!segment || !i.pole_id || poles.find(p => p.id === i.pole_id)?.code === segment))
                .map(i => {
                  const debut = i.date_debut || i.date_incident;
                  return {
                    debut, fin: i.date_fin || debut,
                    color: GRAVITE_COULEUR[i.gravite] || '#991b1b',
                    label: `🚨 ${i.statut === 'RESOLU' ? '✓ ' : ''}${i.titre} · ${i.conseq_tutorat || i.consequence_tutorat}`,
                    titre: `Incident ${i.gravite} — ${i.titre} · Conséquence tutorat : ${i.conseq_tutorat || i.consequence_tutorat} · ${i.statut === 'RESOLU' ? 'Résolu' : i.statut} (cliquer pour ouvrir le module Incidents)`,
                    onClick: () => navigate('/incidents'),
                  };
                }),
              // Plages TUTORAT du Planning annuel : bandes pointillées
              ...plagesPlanning.filter(p => !segment || p.pole_code === segment).map(p => ({
                debut: p.date_debut, fin: p.date_fin, dashed: true,
                color: (POLES_SEG[p.pole_code] || POLES_SEG.STN).color,
                label: `📚 ${p.libelle} · ${p.ligne} (${p.pole_code})`,
                titre: `Planning annuel : ${p.libelle} (${p.ligne}) · ${p.date_debut} → ${p.date_fin}`,
              })),
              // Fiches de suivi : bandes pleines avec le nom de la formation
              ...tutoratsAffiches
                .filter(t => (t.date_debut || t.date_demarree_le) && (t.date_fin || t.date_terminee_le))
                .map(t => {
                  const seg = POLES_SEG[t.pole_code] || POLES_SEG.STN;
                  const debut = t.date_debut || t.date_demarree_le;
                  const fin = t.date_fin || t.date_terminee_le;
                  // Format : [Pôle ·] Promotion - Formation Niveau Semestre (ex : P10 - ANG L3 S5)
                  const etat = etatTutoratAuto(t);
                  return {
                    debut, fin,
                    color: ETAT_BAR[etat] || seg.color,
                    label: `${!segment ? `${t.pole_code} · ` : ''}${t.promotion_code || '?'} - ${t.formation_code || t.formation_nom || t.pole_code} ${t.niveau || ''} ${t.semestre_code || ''} (${Math.round(progressionDates(t) * 100)}%)`,
                    titre: `${t.pole_code} — Promotion ${t.promotion_code || '?'} — ${t.formation_nom || 'Formation non précisée'} ${NIVEAUX[t.niveau]?.label || ''} Semestre ${(t.semestre_code || '').replace('S', '')} : ${debut} → ${fin} — ${ETATS.etat_tutorat.options[etat]} · progression ${Math.round(progressionDates(t) * 100)}% (cliquer pour la fiche)`,
                    onClick: () => setDetailId(t.id),
                  };
                }),
            ]}
          />
          {/* Fiches sans dates : accessibles sous le calendrier */}
          {(() => {
            const sansDates = tutoratsAffiches.filter(t => !(t.date_debut || t.date_demarree_le) || !(t.date_fin || t.date_terminee_le));
            if (sansDates.length === 0) return null;
            return (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-slate-400 font-semibold uppercase tracking-wide text-[11px]">Sans dates :</span>
                {sansDates.map(t => {
                  const seg = POLES_SEG[t.pole_code] || POLES_SEG.STN;
                  return (
                    <button key={t.id} onClick={() => setDetailId(t.id)}
                      title={`${t.formation_nom || 'Formation non précisée'} — dates non renseignées (cliquer pour la fiche)`}
                      className="px-2.5 py-1 rounded-lg border-2 border-dashed bg-white font-semibold hover:bg-slate-50"
                      style={{ color: seg.color, borderColor: `${seg.color}66` }}>
                      {t.promotion_code || '?'} - {t.formation_code || t.formation_nom || t.pole_code} {t.niveau || ''} {t.semestre_code || ''}
                    </button>
                  );
                })}
              </div>
            );
          })()}
        </>
      )}

      {/* Légende de la vue planning */}
      {vue === 'PLANNING' && !loading && (
        <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500">
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded" style={{ background: '#94a3b8' }} /> En attente de démarrage</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded" style={{ background: '#2563eb' }} /> En cours (couleur du pôle)</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded" style={{ background: '#16a34a' }} /> Terminé</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded border-2 border-dashed border-slate-400 bg-white" /> Plage du Planning annuel</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-red-50 border border-red-200" /> Vacances</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-500" /> Férié</span>
          <span className="flex items-center gap-1.5">🚨 Incident impactant le tutorat
            <span className="w-3 h-3 rounded" style={{ background: GRAVITE_COULEUR.CRITIQUE }} title="Critique" />
            <span className="w-3 h-3 rounded" style={{ background: GRAVITE_COULEUR.HAUTE }} title="Haute" />
            <span className="w-3 h-3 rounded" style={{ background: GRAVITE_COULEUR.MOYENNE }} title="Moyenne" />
            <span className="w-3 h-3 rounded" style={{ background: GRAVITE_COULEUR.FAIBLE }} title="Faible" />
            (✓ = résolu)
          </span>
          <span>Cliquez sur une bande pour afficher et modifier la fiche.</span>
        </div>
      )}

      {modal && <ModalTutorat poles={poles} promotions={promotions} annees={annees} user={user} defaultDebut={modalDate} onClose={() => setModal(false)} onCreated={load} />}
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
              onSaveEtat={saveEtat}
              onSaveDates={saveDates}
              estCreateur={estCreateurFiche(ficheDetail)}
              canDelete={canDelete}
              canWrite={canWrite}
              canValider={canValider}
              peutSignaler={peutSignaler}
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
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto nav-scroll">
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
