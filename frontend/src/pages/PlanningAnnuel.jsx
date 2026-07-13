import { useEffect, useMemo, useState } from 'react';
import api from '../lib/api';
import toast from 'react-hot-toast';
import { Plus, GanttChartSquare, LayoutGrid } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

/* Les 5 segments institutionnels (couleurs alignées sur le fichier Excel) */
const SEGMENTS = {
  RECTORAT: { label: 'UN-CHK (Rectorat)', color: '#1e3a5f', light: '#e8eef5' },
  DFIP_DES: { label: "Direction de la Formation et de l'Ingénierie pédagogique (DFIP) & Direction des Etudes et de la Scolarité (DES)", color: '#0e7490', light: '#e6f4f7' },
  PSEJA: { label: "Pôle Sciences économiques, juridiques et de l'Administration (PSEJA)", color: '#ea580c', light: '#fdeee3' },
  PSTN: { label: 'Pôle Sciences, Technologies et Numérique (PSTN)', color: '#16a34a', light: '#e8f6ec' },
  PLSHE: { label: "Pôle Lettres, Sciences humaines et de l'Education (PLSHE)", color: '#6d28d9', light: '#f0e9fb' },
};

/* Lignes par défaut de chaque segment (structure du fichier Excel) */
const LIGNES_DEFAUT = {
  RECTORAT: ["Découpage de l'année"],
  DFIP_DES: ['Inscriptions', 'Cours transversaux', 'Réinscriptions', 'Demandes de dérogation', 'Formation des tuteurs', 'Évaluations SEJA', 'Évaluations STN', 'Évaluations LSHE'],
  PSEJA: ['Licence 1', 'Licence 2', 'Licence 3', 'Master 1', 'Master 2'],
  PSTN: ['Licence 1', 'Licence 2', 'Licence 3', 'Master 1', 'Master 2'],
  PLSHE: ['Licence 1', 'Licence 2', 'Licence 3', 'Master 1', 'Master 2'],
};

const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

/* Timeline : année académique (nov → oct) ou zoom sur un mois (jour par jour).
   zoom = { mode: 'ANNEE' } | { mode: 'MOIS', mois: 0..11 } (0 = novembre) */
export function useTimeline(libelle, zoom = { mode: 'ANNEE' }) {
  return useMemo(() => {
    const y = parseInt(libelle) || new Date().getFullYear();
    let start, finEx; // finEx = borne exclusive
    if (zoom.mode === 'MOIS') {
      start = new Date(y, 10 + (zoom.mois || 0), 1);
      finEx = new Date(y, 11 + (zoom.mois || 0), 1);
    } else {
      start = new Date(y, 10, 1);
      finEx = new Date(y + 1, 10, 1);
    }
    const total = finEx - start;
    const units = [];
    if (zoom.mode === 'MOIS') {
      const J = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];
      for (let d = new Date(start); d < finEx; d.setDate(d.getDate() + 1)) {
        const dd = new Date(d);
        const next = new Date(dd); next.setDate(dd.getDate() + 1);
        units.push({
          label: String(dd.getDate()),
          sub: J[dd.getDay()],
          weekend: dd.getDay() === 0 || dd.getDay() === 6,
          left: ((dd - start) / total) * 100,
          width: ((next - dd) / total) * 100,
        });
      }
    } else {
      for (let i = 0; i < 12; i++) {
        const d = new Date(y, 10 + i, 1);
        const n = new Date(y, 11 + i, 1);
        units.push({
          label: `${MOIS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`,
          left: ((d - start) / total) * 100,
          width: ((n - d) / total) * 100,
        });
      }
    }
    const pct = (dateStr) => Math.max(0, Math.min(100, ((new Date(dateStr) - start) / total) * 100));
    const pctRaw = (dateStr) => ((new Date(dateStr) - start) / total) * 100; // non borné (pour ignorer le hors-plage)
    return { start, end: new Date(finEx - 1), months: units, units, pct, pctRaw, mode: zoom.mode };
  }, [libelle, zoom.mode, zoom.mois]);
}

/* En-tête des unités (mois, ou jours avec initiale + week-ends grisés) */
export function EnTeteUnites({ tl }) {
  return (
    <div className="flex-1 relative h-8">
      {tl.units.map((u, i) => (
        <div key={i}
          className={`absolute inset-y-0 flex items-center justify-center text-[11px] font-medium border-l border-slate-100 ${u.weekend ? 'bg-slate-100/80 text-slate-400' : 'text-slate-500'}`}
          style={{ left: `${u.left}%`, width: `${u.width}%` }}>
          {u.sub ? (
            <div className="flex flex-col items-center leading-tight">
              <span className="text-[8px] text-slate-400">{u.sub}</span>
              <span>{u.label}</span>
            </div>
          ) : u.label}
        </div>
      ))}
    </div>
  );
}

/* Fond de piste : lignes de grille + week-ends grisés (mode jours) */
export function FondGrille({ tl }) {
  return (
    <>
      {tl.units.map((u, i) => u.weekend ? (
        <div key={`w${i}`} className="absolute inset-y-0 bg-slate-100/70 pointer-events-none" style={{ left: `${u.left}%`, width: `${u.width}%` }} />
      ) : null)}
      {tl.units.map((u, i) => (
        <div key={`l${i}`} className="absolute inset-y-0 border-l border-slate-50 pointer-events-none" style={{ left: `${u.left}%` }} />
      ))}
    </>
  );
}

/* Contrôle de zoom : vue année ↔ vue d'un mois jour par jour */
export function ZoomBar({ zoom, setZoom, libelle }) {
  const y = parseInt(libelle) || new Date().getFullYear();
  const NOMS = ['Novembre', 'Décembre', 'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre'];
  const anneeDe = i => (i < 2 ? y : y + 1);
  const enMois = zoom.mode === 'MOIS';
  return (
    <div className="flex items-center gap-1">
      <button onClick={() => setZoom({ mode: 'ANNEE' })}
        className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${!enMois ? 'bg-[#1e3a5f] text-white border-[#1e3a5f]' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>
        Année
      </button>
      <button disabled={!enMois || zoom.mois <= 0} onClick={() => setZoom({ mode: 'MOIS', mois: zoom.mois - 1 })}
        className="px-2 py-1.5 rounded-lg text-xs border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 disabled:opacity-30">◀</button>
      <select value={enMois ? zoom.mois : ''} onChange={e => e.target.value !== '' && setZoom({ mode: 'MOIS', mois: +e.target.value })}
        className={`!w-auto !py-1.5 !text-xs ${enMois ? '!border-[#1e3a5f] !font-semibold' : ''}`}>
        <option value="">Zoom jour par jour…</option>
        {NOMS.map((m, i) => <option key={i} value={i}>{m} {anneeDe(i)}</option>)}
      </select>
      <button disabled={!enMois || zoom.mois >= 11} onClick={() => setZoom({ mode: 'MOIS', mois: zoom.mois + 1 })}
        className="px-2 py-1.5 rounded-lg text-xs border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 disabled:opacity-30">▶</button>
    </div>
  );
}

/* Bandes verticales vacances + traits fériés, répétés dans chaque piste */
export function Overlays({ vacances, feries, tl }) {
  return (
    <>
      {vacances.map(v => {
        const l = tl.pct(v.date_debut), r = tl.pct(v.date_fin);
        if (r <= 0 || l >= 100) return null;
        return (
          <div key={`v${v.id}`} title={`🏖 ${v.libelle} : ${v.date_debut} → ${v.date_fin}`}
            className="absolute inset-y-0 bg-red-400/25 border-x-2 border-red-400/50 pointer-events-none"
            style={{
              left: `${l}%`, width: `${Math.max(r - l, 0.4)}%`,
              backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 6px, rgba(239,68,68,0.12) 6px, rgba(239,68,68,0.12) 12px)',
            }} />
        );
      })}
      {feries.map((f, i) => {
        const l = tl.pct(f.date);
        if (l <= 0 || l >= 100) return null;
        return (
          <div key={`f${i}`} title={`🚩 ${f.libelle} (${f.date})`}
            className="absolute inset-y-0 w-[3px] bg-red-500/70 pointer-events-none"
            style={{ left: `${l}%` }} />
        );
      })}
    </>
  );
}

/* Bandeau dédié sous l'en-tête : noms des vacances + marqueurs de fériés bien visibles */
export function BandeauVacances({ vacances, feries, tl }) {
  return (
    <div className="flex border-b border-red-100 bg-red-50/60">
      <div className="w-56 shrink-0 px-3 py-1.5 text-[10px] font-bold text-red-500 uppercase tracking-wide border-r border-slate-200 flex items-center">
        🏖 Vacances & fériés
      </div>
      <div className="flex-1 relative h-7">
        {tl.months.map((m, i) => (
          <div key={i} className="absolute inset-y-0 border-l border-red-100/60" style={{ left: `${m.left}%` }} />
        ))}
        {vacances.map(v => {
          const l = tl.pct(v.date_debut), r = tl.pct(v.date_fin);
          if (r <= 0 || l >= 100) return null;
          return (
            <div key={v.id} title={`${v.libelle} : ${v.date_debut} → ${v.date_fin}`}
              className="absolute top-1 bottom-1 bg-red-500 rounded-md flex items-center justify-center px-1.5 text-[9px] font-bold text-white uppercase tracking-wide truncate shadow-sm"
              style={{ left: `${l}%`, width: `${Math.max(r - l, 2)}%` }}>
              {v.libelle}
            </div>
          );
        })}
        {feries.map((f, i) => {
          const l = tl.pct(f.date);
          if (l <= 0 || l >= 100) return null;
          return (
            <div key={`fb${i}`} title={`${f.libelle} (${f.date})`}
              className="absolute top-0.5 w-2.5 h-2.5 rounded-full bg-red-600 border-2 border-white shadow cursor-help"
              style={{ left: `calc(${l}% - 5px)` }} />
          );
        })}
      </div>
    </div>
  );
}

function ModalActivite({ annee, canSegments, defaultSegment, onClose, onCreated }) {
  const [form, setForm] = useState({
    segment: (defaultSegment && canSegments.includes(defaultSegment) ? defaultSegment : canSegments[0]) || 'DFIP_DES',
    ligne: '', libelle: '', date_debut: '', date_fin: '',
    type: '', sous_type: 'EXAMEN',
  });
  const [loading, setLoading] = useState(false);
  const lignes = LIGNES_DEFAUT[form.segment] || [];

  async function submit(e) {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post('/planning', { ...form, annee_id: annee.id });
      toast.success('Activité ajoutée au planning');
      onCreated(); onClose();
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
    finally { setLoading(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b">
          <h2 className="font-semibold text-slate-800">Ajouter une activité — {annee.libelle}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-4">
          <div>
            <label className="text-sm font-medium text-slate-700 block mb-1">Segment *</label>
            <select value={form.segment} onChange={e => setForm(f => ({ ...f, segment: e.target.value, ligne: '' }))}>
              {canSegments.map(s => <option key={s} value={s}>{SEGMENTS[s].label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700 block mb-1">Ligne *</label>
            <input list="lignes-sugg" value={form.ligne} onChange={e => setForm(f => ({ ...f, ligne: e.target.value }))}
              placeholder="Ex: Licence 1, Cours transversaux..." required />
            <datalist id="lignes-sugg">
              {lignes.map(l => <option key={l} value={l} />)}
            </datalist>
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700 block mb-1">Libellé de la barre *</label>
            <input value={form.libelle} onChange={e => setForm(f => ({ ...f, libelle: e.target.value }))}
              placeholder="Ex: S1, S1N (rattrapage), Réinscriptions..." required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium text-slate-700 block mb-1">Type d'activité</label>
              <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
                <option value="">— Générique —</option>
                <option value="TUTORAT">Tutorat</option>
                <option value="EVALUATIONS">Évaluations</option>
              </select>
            </div>
            {form.type === 'EVALUATIONS' && (
              <div>
                <label className="text-sm font-medium text-slate-700 block mb-1">Sous-type *</label>
                <select value={form.sous_type} onChange={e => setForm(f => ({ ...f, sous_type: e.target.value }))}>
                  <option value="EXAMEN">Examen</option>
                  <option value="DEVOIRS">Devoirs</option>
                </select>
              </div>
            )}
          </div>
          {form.type && (
            <p className="text-xs text-blue-700 bg-blue-50 border border-blue-100 rounded-xl p-2.5 -mt-1">
              🔗 Cette activité sera <strong>automatiquement affichée dans le module {form.type === 'TUTORAT' ? 'Tutorat' : 'Évaluations'}</strong> —
              pas de nouvelle saisie : le suivi se fera directement sur l'entrée liée.
            </p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium text-slate-700 block mb-1">Début *</label>
              <input type="date" value={form.date_debut} onChange={e => setForm(f => ({ ...f, date_debut: e.target.value }))} required />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 block mb-1">Fin *</label>
              <input type="date" value={form.date_fin} onChange={e => setForm(f => ({ ...f, date_fin: e.target.value }))} required />
            </div>
          </div>
          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Annuler</button>
            <button type="submit" disabled={loading} className="btn-primary flex-1">{loading ? '...' : 'Ajouter'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function PlanningAnnuel() {
  const { user } = useAuth();
  const [annees, setAnnees] = useState([]);
  const [anneeId, setAnneeId] = useState(null);
  const [activites, setActivites] = useState([]);
  const [vacances, setVacances] = useState([]);
  const [feries, setFeries] = useState([]);
  const [segmentActif, setSegmentActif] = useState(null); // null = vue globale (par défaut)
  const [zoom, setZoom] = useState({ mode: 'ANNEE' });
  const [modal, setModal] = useState(false);
  const [modalAnnee, setModalAnnee] = useState(false);
  const [loading, setLoading] = useState(true);

  const annee = annees.find(a => a.id === anneeId);
  const tl = useTimeline(annee?.libelle || '', zoom);

  useEffect(() => {
    api.get('/dashboard/annees').then(r => {
      setAnnees(r.data);
      setAnneeId(r.data.find(a => a.active)?.id || r.data[0]?.id || null);
    });
  }, []);

  function load() {
    if (!anneeId) return;
    setLoading(true);
    Promise.all([
      api.get(`/planning?annee_id=${anneeId}`),
      api.get(`/calendrier-academique/vacances?annee_id=${anneeId}`),
      api.get('/calendrier-academique/feries'),
    ]).then(([p, v, f]) => {
      setActivites(p.data); setVacances(v.data); setFeries(f.data);
    }).finally(() => setLoading(false));
  }
  useEffect(load, [anneeId]);

  // Matérialise les fériés récurrents dans la plage de la timeline
  const feriesRange = useMemo(() => {
    if (!annee) return [];
    const out = [];
    for (const f of feries) {
      if (f.recurrent) {
        const mmdd = f.date.slice(5);
        [tl.start.getFullYear(), tl.end.getFullYear()].forEach(y => {
          const d = `${y}-${mmdd}`;
          if (new Date(d) >= tl.start && new Date(d) <= tl.end) out.push({ ...f, date: d });
        });
      } else if (new Date(f.date) >= tl.start && new Date(f.date) <= tl.end) {
        out.push(f);
      }
    }
    return out;
  }, [feries, annee, tl]);

  // Périmètre du profil (calculé côté serveur) : segments visibles + segments où créer
  const [perimetre, setPerimetre] = useState({ visibles: Object.keys(SEGMENTS), creation: [] });
  useEffect(() => {
    api.get('/planning/perimetre').then(r => setPerimetre(r.data)).catch(() => {});
  }, []);

  const estDirecteur = user?.role === 'DIRECTEUR';
  const canSegments = perimetre.creation;                 // segments où ce profil peut créer
  const canEdit = canSegments.length > 0 || estDirecteur; // peut agir sur au moins un segment
  const segmentsVisibles = perimetre.visibles;
  const vueRestreinte = segmentsVisibles.length === 1;    // profil limité à son pôle
  const peutEditerActivite = (a) => estDirecteur || canSegments.includes(a.segment);

  const [detail, setDetail] = useState(null);       // activité affichée en popup
  const [demandes, setDemandes] = useState([]);

  // Profil limité à un seul segment → focus automatique dessus
  useEffect(() => {
    if (vueRestreinte) setSegmentActif(segmentsVisibles[0]);
  }, [vueRestreinte, segmentsVisibles]);

  function loadDemandes() {
    api.get('/planning/demandes/liste').then(r => setDemandes(r.data)).catch(() => {});
  }
  useEffect(loadDemandes, [anneeId]);

  const demandesAttente = demandes.filter(d => d.statut === 'EN_ATTENTE');

  async function traiterDemande(id, decision) {
    try {
      await api.post(`/planning/demandes/${id}/traiter`, { decision });
      toast.success(decision === 'VALIDEE' ? 'Demande validée et appliquée' : 'Demande rejetée');
      load(); loadDemandes();
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Planning annuel</h1>
          <p className="text-slate-500 text-sm">Calendrier académique {annee?.libelle || ''} — vue globale par segment</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select value={anneeId || ''} onChange={e => setAnneeId(parseInt(e.target.value))} className="!w-auto">
            {annees.map(a => <option key={a.id} value={a.id}>{a.libelle}{a.active ? ' (active)' : ''}</option>)}
          </select>
          {['DIRECTEUR', 'ADMIN_PORTAIL'].includes(user?.role) && (
            <button onClick={() => setModalAnnee(true)} className="btn-secondary flex items-center gap-1.5" title="Créer une année académique">
              <Plus size={15} /> Année
            </button>
          )}
          {canSegments.length > 0 && (
            <button onClick={() => setModal(true)} className="btn-primary flex items-center gap-2">
              <Plus size={16} /> Activité
            </button>
          )}
        </div>
      </div>

      {/* Segments cliquables (slicers) : vue globale par défaut, clic = focus sur un seul calendrier.
          Les profils rattachés à un pôle ne voient que leur segment. */}
      <div className="card !p-3">
        <div className="flex flex-wrap items-center gap-2">
          {!vueRestreinte && (
            <button
              onClick={() => setSegmentActif(null)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold border-2 transition-all ${
                segmentActif === null
                  ? 'bg-slate-800 text-white border-slate-800 shadow-md'
                  : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
              }`}
            >
              <LayoutGrid size={15} /> Tous les calendriers
            </button>
          )}
          {Object.entries(SEGMENTS).filter(([k]) => segmentsVisibles.includes(k)).map(([k, s]) => {
            const actif = segmentActif === k;
            const nb = activites.filter(a => a.segment === k).length;
            return (
              <button
                key={k}
                onClick={() => setSegmentActif(actif ? null : k)}
                title={s.label}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold border-2 transition-all ${
                  actif ? 'text-white shadow-md scale-105' : 'bg-white hover:scale-[1.02]'
                }`}
                style={actif
                  ? { background: s.color, borderColor: s.color }
                  : { color: s.color, borderColor: `${s.color}55` }}
              >
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: actif ? '#fff' : s.color }} />
                {k.replace('_', ' & ')}
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${actif ? 'bg-white/25' : 'bg-slate-100 text-slate-500'}`}>{nb}</span>
              </button>
            );
          })}
          <div className="ml-auto flex items-center gap-2 flex-wrap">
            <ZoomBar zoom={zoom} setZoom={setZoom} libelle={annee?.libelle || ''} />
          </div>
        </div>
        <div className="flex items-center gap-4 text-xs text-slate-500 mt-2.5 pt-2.5 border-t border-slate-100">
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-red-500/20 border border-red-300" /> Vacances</span>
          <span className="flex items-center gap-1.5"><span className="w-0.5 h-3 bg-red-500/70" /> Jour férié</span>
          {segmentActif && (
            <span className="ml-auto font-medium text-slate-600">
              Vue focalisée : {SEGMENTS[segmentActif].label} — cliquez à nouveau sur le segment (ou « Tous ») pour revenir à la vue globale
            </span>
          )}
        </div>
      </div>

      {/* Demandes en attente de validation du Directeur DFIP */}
      {demandesAttente.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
          <p className="text-sm font-bold text-amber-800 mb-3">
            ✋ {demandesAttente.length} demande(s) en attente de validation du Directeur DFIP
          </p>
          <div className="space-y-2">
            {demandesAttente.map(d => {
              const payload = d.payload ? JSON.parse(d.payload) : null;
              return (
                <div key={d.id} className="bg-white rounded-xl p-3 flex items-center gap-3 flex-wrap">
                  <span className={`badge shrink-0 ${d.type_demande === 'SUPPRESSION' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>
                    {d.type_demande === 'SUPPRESSION' ? 'Suppression' : 'Modification'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-slate-700">
                      <strong>{d.activite_libelle}</strong> — {d.segment.replace('_', ' & ')} / {d.ligne}
                      <span className="text-slate-400"> ({d.activite_debut} → {d.activite_fin})</span>
                    </p>
                    <p className="text-xs text-slate-500">
                      Par {d.demandeur_prenom} {d.demandeur_nom}
                      {payload && ` · Nouvelles valeurs : ${[payload.libelle && `libellé "${payload.libelle}"`, payload.ligne && `ligne "${payload.ligne}"`, payload.date_debut && `début ${payload.date_debut}`, payload.date_fin && `fin ${payload.date_fin}`].filter(Boolean).join(', ')}`}
                    </p>
                  </div>
                  {estDirecteur ? (
                    <div className="flex gap-2 shrink-0">
                      <button onClick={() => traiterDemande(d.id, 'VALIDEE')} className="btn-primary !py-1.5 !px-3 text-xs !bg-green-600 hover:!bg-green-700">✓ Valider</button>
                      <button onClick={() => traiterDemande(d.id, 'REJETEE')} className="btn-secondary !py-1.5 !px-3 text-xs !text-red-600 !border-red-200 hover:!bg-red-50">✕ Rejeter</button>
                    </div>
                  ) : (
                    <span className="badge bg-amber-100 text-amber-700 shrink-0">En attente</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-40">
          <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="card !p-0 overflow-x-auto nav-scroll">
          <div className="min-w-[1100px]">
            {/* En-tête des mois */}
            <div className="flex sticky top-0 bg-white z-10 border-b border-slate-200">
              <div className="w-56 shrink-0 px-3 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wide border-r border-slate-200">
                Segments / Lignes
              </div>
              <EnTeteUnites tl={tl} />
            </div>

            {/* Bandeau vacances & fériés */}
            <BandeauVacances vacances={vacances} feries={feriesRange} tl={tl} />

            {/* Segments (tous en vue globale, un seul en vue focalisée, limités au périmètre visible) */}
            {Object.entries(SEGMENTS)
              .filter(([key]) => segmentsVisibles.includes(key) && (!segmentActif || key === segmentActif))
              .map(([key, seg]) => {
              const focus = segmentActif === key;
              const actsSeg = activites.filter(a => a.segment === key);
              const lignes = [...new Set([...(LIGNES_DEFAUT[key] || []), ...actsSeg.map(a => a.ligne)])];
              return (
                <div key={key} className="border-b border-slate-100 last:border-0">
                  {/* Bandeau segment (même style que les modules Tutorat / Évaluations) */}
                  <div className={`flex items-center gap-2 px-3 ${focus ? 'py-3' : 'py-2'}`} style={{ background: seg.light }}>
                    <span className={`font-bold ${focus ? 'text-base' : 'text-sm'}`} style={{ color: seg.color }}>{seg.label}</span>
                    <span className="text-xs text-slate-400 ml-auto shrink-0">{actsSeg.length} activité(s)</span>
                  </div>

                  {/* Lignes */}
                  {lignes.map(ligne => {
                    const barres = actsSeg.filter(a => a.ligne === ligne);
                    return (
                      <div key={ligne} className="flex border-t border-slate-50">
                        <div className={`w-56 shrink-0 px-3 border-r border-slate-100 truncate text-slate-600 ${focus ? 'py-4 text-sm font-medium' : 'py-2 text-xs'}`} title={ligne}>
                          {ligne}
                        </div>
                        <div className={`flex-1 relative ${focus ? 'h-14' : 'h-9'}`}>
                          <FondGrille tl={tl} />
                          <Overlays vacances={vacances} feries={feriesRange} tl={tl} />
                          {/* Barres d'activité */}
                          {barres.map(a => {
                            const lr = tl.pctRaw(a.date_debut);
                            const rr = tl.pctRaw(a.date_fin);
                            if (rr <= 0 || lr >= 100) return null; // hors de la fenêtre visible
                            const l = Math.max(0, lr);
                            const w = Math.max(Math.min(100, rr) - l, 0.8);
                            return (
                              <div
                                key={a.id}
                                onClick={() => setDetail(a)}
                                title={`${a.libelle} : ${a.date_debut} → ${a.date_fin}${a.type ? ` · ${a.type === 'TUTORAT' ? 'Tutorat' : `Évaluations (${a.sous_type === 'DEVOIRS' ? 'Devoirs' : 'Examen'})`}` : ''} — cliquer pour les détails`}
                                className={`absolute rounded-md flex items-center gap-1 px-2 font-semibold text-white shadow-sm overflow-hidden cursor-pointer hover:opacity-85 hover:ring-2 hover:ring-white/60 ${focus ? 'top-2 bottom-2 text-xs' : 'top-1 bottom-1 text-[10px]'}`}
                                style={{ left: `${l}%`, width: `${w}%`, background: a.couleur || seg.color }}
                              >
                                <span className="truncate">
                                  {a.type === 'TUTORAT' ? '📚 ' : a.type === 'EVALUATIONS' ? (a.sous_type === 'DEVOIRS' ? '📝 ' : '🧪 ') : ''}
                                  {a.libelle}
                                </span>
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

            {activites.length === 0 && (
              <div className="py-12 text-center text-slate-400">
                <GanttChartSquare size={36} className="mx-auto mb-2 opacity-30" />
                Aucune activité planifiée pour cette année
              </div>
            )}
          </div>
        </div>
      )}

      <p className="text-xs text-slate-400">
        💡 Les bandes rouges = vacances · les traits rouges = jours fériés (gérés dans « Fériés & Vacances »).
        {canEdit && ' Cliquez sur une barre pour la supprimer.'}
      </p>

      {modal && annee && <ModalActivite annee={annee} canSegments={canSegments} defaultSegment={segmentActif} onClose={() => setModal(false)} onCreated={load} />}
      {modalAnnee && (
        <ModalAnnee onClose={() => setModalAnnee(false)} onCreated={() => {
          api.get('/dashboard/annees').then(r => {
            setAnnees(r.data);
            setAnneeId(r.data.find(a => a.active)?.id || r.data[0]?.id || null);
          });
        }} />
      )}
      {detail && (
        <ModalDetail
          activite={detail}
          canEdit={peutEditerActivite(detail)}
          estDirecteur={estDirecteur}
          onClose={() => setDetail(null)}
          onChanged={() => { setDetail(null); load(); loadDemandes(); }}
        />
      )}
    </div>
  );
}

/* Création d'une année académique (Directeur / Admin) */
function ModalAnnee({ onClose, onCreated }) {
  const [libelle, setLibelle] = useState('');
  const [loading, setLoading] = useState(false);
  async function submit(e) {
    e.preventDefault();
    if (!libelle.trim()) return toast.error('Libellé requis');
    setLoading(true);
    try {
      const r = await api.post('/dashboard/annees', { libelle: libelle.trim() });
      await api.put(`/dashboard/annees/${r.data.id}/activer`);
      toast.success('Année créée et activée');
      onCreated(); onClose();
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
    finally { setLoading(false); }
  }
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b">
          <h2 className="font-semibold text-slate-800">Créer une année académique</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-4">
          <input value={libelle} onChange={e => setLibelle(e.target.value)} placeholder="Ex: 2026-2027" autoFocus />
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Annuler</button>
            <button type="submit" disabled={loading} className="btn-primary flex-1">{loading ? '...' : 'Créer et activer'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* Popup de détails d'une activité : consultation + édition + suppression (validées par le Directeur DFIP) */
function ModalDetail({ activite: a, canEdit, estDirecteur, onClose, onChanged }) {
  const seg = SEGMENTS[a.segment];
  const [form, setForm] = useState({ ligne: a.ligne, libelle: a.libelle, date_debut: a.date_debut, date_fin: a.date_fin });
  const [loading, setLoading] = useState(false);
  const modifie = form.ligne !== a.ligne || form.libelle !== a.libelle || form.date_debut !== a.date_debut || form.date_fin !== a.date_fin;

  async function enregistrer() {
    setLoading(true);
    try {
      const r = await api.put(`/planning/${a.id}`, form);
      if (r.status === 202) toast(r.data.message, { icon: '✋', duration: 5000 });
      else toast.success('Modification appliquée');
      onChanged();
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
    finally { setLoading(false); }
  }

  async function supprimer() {
    const msg = estDirecteur
      ? `Supprimer définitivement « ${a.libelle} » ?`
      : `Demander la suppression de « ${a.libelle} » ?\nLa suppression ne sera effective qu'après validation du Directeur DFIP.`;
    if (!confirm(msg)) return;
    setLoading(true);
    try {
      const r = await api.delete(`/planning/${a.id}`);
      if (r.status === 202) toast(r.data.message, { icon: '✋', duration: 5000 });
      else toast.success('Activité supprimée');
      onChanged();
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
    finally { setLoading(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
        {/* En-tête coloré du segment */}
        <div className="px-5 py-4" style={{ background: seg.color }}>
          <p className="text-white/70 text-xs font-semibold uppercase tracking-wide">{a.segment.replace('_', ' & ')} · {a.ligne}</p>
          <h2 className="text-white font-bold text-lg">{a.libelle}</h2>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="bg-slate-50 rounded-xl p-3">
              <p className="text-[11px] uppercase tracking-wide text-slate-400 mb-0.5">Début</p>
              <p className="font-semibold text-slate-800">{a.date_debut}</p>
            </div>
            <div className="bg-slate-50 rounded-xl p-3">
              <p className="text-[11px] uppercase tracking-wide text-slate-400 mb-0.5">Fin</p>
              <p className="font-semibold text-slate-800">{a.date_fin}</p>
            </div>
          </div>
          {a.created_by_nom && (
            <p className="text-xs text-slate-400">Créée par {a.created_by_prenom} {a.created_by_nom}</p>
          )}

          {canEdit && (
            <>
              <div className="border-t border-slate-100 pt-4 space-y-3">
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">Modifier</p>
                {!estDirecteur && (
                  <div className="bg-amber-50 border border-amber-100 rounded-xl p-2.5 text-xs text-amber-700">
                    ⚠️ Toute modification ou suppression sera soumise à la <strong>validation du Directeur DFIP</strong> avant d'être appliquée.
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-slate-600 block mb-1">Ligne</label>
                    <input value={form.ligne} onChange={e => setForm(f => ({ ...f, ligne: e.target.value }))} className="!py-1.5 !text-sm" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-600 block mb-1">Libellé</label>
                    <input value={form.libelle} onChange={e => setForm(f => ({ ...f, libelle: e.target.value }))} className="!py-1.5 !text-sm" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-600 block mb-1">Début</label>
                    <input type="date" value={form.date_debut} onChange={e => setForm(f => ({ ...f, date_debut: e.target.value }))} className="!py-1.5 !text-sm" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-600 block mb-1">Fin</label>
                    <input type="date" value={form.date_fin} onChange={e => setForm(f => ({ ...f, date_fin: e.target.value }))} className="!py-1.5 !text-sm" />
                  </div>
                </div>
              </div>
              <div className="flex gap-2 pt-1">
                <button onClick={supprimer} disabled={loading} className="btn-secondary !text-red-600 !border-red-200 hover:!bg-red-50 flex-1">
                  {estDirecteur ? 'Supprimer' : 'Demander la suppression'}
                </button>
                <button onClick={enregistrer} disabled={!modifie || loading} className="btn-primary flex-1 disabled:opacity-40">
                  {loading ? '...' : (estDirecteur ? 'Enregistrer' : 'Soumettre la modification')}
                </button>
              </div>
            </>
          )}
          <button onClick={onClose} className="w-full text-center text-sm text-slate-400 hover:text-slate-600 pt-1">Fermer</button>
        </div>
      </div>
    </div>
  );
}
