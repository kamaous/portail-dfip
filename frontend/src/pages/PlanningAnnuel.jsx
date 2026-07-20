import { useEffect, useMemo, useRef, useState } from 'react';
import api from '../lib/api';
import toast from 'react-hot-toast';
import { Plus, GanttChartSquare, LayoutGrid } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import PlageDates from '../components/PlageDates';

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

/* ===== ZOOM TEMPOREL CONTINU (façon Timeline Zoom Bar de Premiere Pro) =====
   La fenêtre visible [t0, t1] (en ms) glisse et se resserre librement dans un
   domaine de 3 années académiques. L'échelle s'adapte au niveau de zoom :
   années → mois → semaines → jours. */
const JOUR_MS = 86400000;

export function useTimelineFenetre(fenetre) {
  return useMemo(() => {
    const start = new Date(fenetre.t0), end = new Date(fenetre.t1);
    const total = fenetre.t1 - fenetre.t0;
    const jours = total / JOUR_MS;
    const units = [];
    const push = (d, n, label, sub, weekend) => {
      const dd = Math.max(+d, fenetre.t0), nn = Math.min(+n, fenetre.t1);
      if (nn > dd) units.push({ label, sub, weekend, left: ((dd - fenetre.t0) / total) * 100, width: ((nn - dd) / total) * 100 });
    };
    if (jours > 550) {
      // Échelle ANNÉES
      for (let y = start.getFullYear(); y <= end.getFullYear(); y++) {
        push(new Date(y, 0, 1), new Date(y + 1, 0, 1), String(y));
      }
    } else if (jours > 110) {
      // Échelle MOIS
      let d = new Date(start.getFullYear(), start.getMonth(), 1);
      while (+d < fenetre.t1) {
        const n = new Date(d.getFullYear(), d.getMonth() + 1, 1);
        push(d, n, `${MOIS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`);
        d = n;
      }
    } else if (jours > 36) {
      // Échelle SEMAINES (départ lundi)
      const d0 = new Date(start); d0.setHours(0, 0, 0, 0);
      d0.setDate(d0.getDate() - ((d0.getDay() + 6) % 7));
      for (let d = new Date(d0); +d < fenetre.t1; d.setDate(d.getDate() + 7)) {
        const n = new Date(d); n.setDate(d.getDate() + 7);
        push(new Date(d), n, `${d.getDate()} ${MOIS[d.getMonth()]}`);
      }
    } else {
      // Échelle JOURS
      const J = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];
      const d0 = new Date(start); d0.setHours(0, 0, 0, 0);
      for (let d = new Date(d0); +d < fenetre.t1; d.setDate(d.getDate() + 1)) {
        const n = new Date(d); n.setDate(d.getDate() + 1);
        push(new Date(d), n, String(d.getDate()), J[d.getDay()], d.getDay() === 0 || d.getDay() === 6);
      }
    }
    const pctRaw = (s) => ((Date.parse(s) - fenetre.t0) / total) * 100;
    const pct = (s) => Math.max(0, Math.min(100, pctRaw(s)));
    return { start, end, months: units, units, pct, pctRaw, mode: jours <= 36 ? 'MOIS' : 'ANNEE', jours };
  }, [fenetre.t0, fenetre.t1]);
}

/* Barre de zoom à deux poignées : rapprocher = zoomer, écarter = dézoomer,
   glisser le bloc central = faire défiler la période sans changer le zoom. */
export function BarreZoom({ domaine, fenetre, setFenetre, reperes = [], onReset }) {
  const piste = useRef(null);
  const [drag, setDrag] = useState(null); // { type: 'G'|'D'|'PAN', x0, f0 }
  const MIN = 7 * JOUR_MS; // fenêtre minimale : une semaine
  const span = domaine.t1 - domaine.t0;
  const pct = (t) => ((t - domaine.t0) / span) * 100;

  useEffect(() => {
    if (!drag) return;
    const move = (e) => {
      const largeur = piste.current?.getBoundingClientRect().width || 1;
      const dt = ((e.clientX - drag.x0) / largeur) * span;
      let { t0, t1 } = drag.f0;
      if (drag.type === 'PAN') {
        const w = t1 - t0;
        t0 = Math.max(domaine.t0, Math.min(domaine.t1 - w, t0 + dt));
        t1 = t0 + w;
      } else if (drag.type === 'G') {
        t0 = Math.max(domaine.t0, Math.min(t1 - MIN, t0 + dt));
      } else {
        t1 = Math.min(domaine.t1, Math.max(t0 + MIN, t1 + dt));
      }
      setFenetre({ t0, t1 });
    };
    const up = () => setDrag(null);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, [drag, domaine.t0, domaine.t1, span, setFenetre]);

  const prendre = (type) => (e) => { e.preventDefault(); e.stopPropagation(); setDrag({ type, x0: e.clientX, f0: { ...fenetre } }); };
  const fmt = (t) => new Date(t).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
  const niveaux = fenetre.t1 - fenetre.t0 > 550 * JOUR_MS ? 'Années' : fenetre.t1 - fenetre.t0 > 110 * JOUR_MS ? 'Mois' : fenetre.t1 - fenetre.t0 > 36 * JOUR_MS ? 'Semaines' : 'Jours';

  return (
    <div className="card !py-3 select-none">
      <div className="flex items-center gap-3 mb-2 flex-wrap text-xs">
        <span className="font-bold text-slate-500 uppercase tracking-wide">🔍 Zoom temporel</span>
        <span className="text-slate-600"><strong>{fmt(fenetre.t0)}</strong> → <strong>{fmt(fenetre.t1)}</strong></span>
        <span className="badge bg-blue-100 text-blue-700 text-[10px]">Échelle : {niveaux}</span>
        <span className="text-slate-400 hidden sm:inline">Rapprochez les poignées pour zoomer · glissez le bloc pour faire défiler</span>
        <button onClick={onReset} className="ml-auto text-blue-600 hover:underline">Année active</button>
      </div>
      <div ref={piste} className="relative h-9 bg-slate-100 rounded-lg overflow-hidden touch-none"
        onDoubleClick={onReset} title="Double-clic : revenir à l'année active">
        {/* Graduations des années du domaine */}
        {(() => {
          const out = [];
          for (let y = new Date(domaine.t0).getFullYear(); y <= new Date(domaine.t1).getFullYear(); y++) {
            const l = pct(+new Date(y, 0, 1));
            if (l > 0 && l < 100) out.push(
              <div key={y} className="absolute inset-y-0 border-l border-slate-300 pointer-events-none" style={{ left: `${l}%` }}>
                <span className="absolute top-0 left-1 text-[8px] text-slate-400">{y}</span>
              </div>
            );
          }
          return out;
        })()}
        {/* Repères des activités et vacances (mini-aperçu) */}
        {reperes.map((r, i) => {
          const l = pct(r.t0), w = Math.max(((r.t1 - r.t0) / span) * 100, 0.3);
          if (l >= 100 || l + w <= 0) return null;
          return <div key={i} className="absolute bottom-1 h-1.5 rounded-full pointer-events-none opacity-80"
            style={{ left: `${Math.max(0, l)}%`, width: `${w}%`, background: r.color }} />;
        })}
        {/* Fenêtre visible (glisser = défiler) */}
        <div className="absolute inset-y-0 bg-[#1e3a5f]/15 border-y-2 border-[#1e3a5f]/40 cursor-grab active:cursor-grabbing"
          style={{ left: `${pct(fenetre.t0)}%`, width: `${Math.max(pct(fenetre.t1) - pct(fenetre.t0), 0.5)}%` }}
          onPointerDown={prendre('PAN')} />
        {/* Poignées gauche / droite */}
        <div className="absolute inset-y-0 w-3 bg-[#1e3a5f] rounded-sm cursor-ew-resize flex items-center justify-center z-10"
          style={{ left: `calc(${pct(fenetre.t0)}% - 6px)` }} onPointerDown={prendre('G')} title="Poignée de début">
          <span className="w-0.5 h-4 bg-white/70 rounded" />
        </div>
        <div className="absolute inset-y-0 w-3 bg-[#1e3a5f] rounded-sm cursor-ew-resize flex items-center justify-center z-10"
          style={{ left: `calc(${pct(fenetre.t1)}% - 6px)` }} onPointerDown={prendre('D')} title="Poignée de fin">
          <span className="w-0.5 h-4 bg-white/70 rounded" />
        </div>
      </div>
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

/* Vacances et fériés AU PREMIER PLAN : colonnes pleine hauteur avec le libellé
   à la VERTICALE (style du classeur Excel UN-CHK). À poser une seule fois
   au-dessus de toutes les pistes d'un tableau (décalé de la colonne des libellés). */
export function OverlaysDevant({ vacances, feries, tl, left = '14rem' }) {
  const vertical = { writingMode: 'vertical-rl', textOrientation: 'upright' };
  return (
    <div className="absolute inset-y-0 right-0 z-20 pointer-events-none overflow-hidden" style={{ left }}>
      {vacances.map((v, i) => {
        const l = tl.pctRaw(v.date_debut), r = tl.pctRaw(v.date_fin);
        if (r <= 0 || l >= 100) return null;
        const gauche = Math.max(0, l), w = Math.min(100, r) - gauche;
        return (
          <div key={`v${i}`} title={`🏖 ${v.libelle} : ${v.date_debut} → ${v.date_fin}`}
            className="absolute inset-y-0 bg-red-600/80 border-x border-white/40 flex items-center justify-center overflow-hidden"
            style={{ left: `${gauche}%`, width: `${Math.max(w, 0.5)}%` }}>
            <span className="text-white font-bold text-[9px] leading-none tracking-widest max-h-full overflow-hidden" style={vertical}>
              {v.libelle.toUpperCase()}
            </span>
          </div>
        );
      })}
      {feries.map((f, i) => {
        const l = tl.pct(f.date);
        if (l <= 0 || l >= 100) return null;
        return (
          <div key={`f${i}`} title={`🚩 ${f.libelle} (${f.date})`}
            className="absolute inset-y-0 bg-slate-800/85 flex items-center justify-center overflow-hidden"
            style={{ left: `calc(${l}% - 9px)`, width: '18px' }}>
            <span className="text-white font-bold text-[8px] leading-none tracking-wider max-h-full overflow-hidden" style={vertical}>
              {f.libelle.toUpperCase()}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* Bandeau dédié sous l'en-tête : noms des vacances + marqueurs de fériés bien visibles */
export function BandeauVacances({ vacances, feries, tl }) {
  return (
    <div className="flex border-b border-red-100 bg-red-50/60">
      <div className="w-56 shrink-0 px-3 py-1.5 text-[10px] font-bold text-red-500 uppercase tracking-wide border-r border-slate-200 flex items-center sticky left-0 bg-red-50 z-30">
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

/* Libellés proposés pour la barre selon le TYPE d'activité et le NIVEAU :
   Évaluations — L1/M1 : S1-S2 · L2 : S3-S4 · L3 : S5-S6 · M2 : S3-S4 (chacun en SN + SR)
   Tutorat     — L1/M1 : S1,S2 · L2 : S3,S4 · L3 : S5,S6 · M2 : S3 */
const LIGNE_NIVEAU_LIB = { 'Licence 1': 'L1', 'Licence 2': 'L2', 'Licence 3': 'L3', 'Master 1': 'M1', 'Master 2': 'M2' };
function libellesPossibles(type, ligne) {
  const niv = LIGNE_NIVEAU_LIB[ligne];
  if (!niv) return null;
  const SEMS = { L1: ['S1', 'S2'], M1: ['S1', 'S2'], L2: ['S3', 'S4'], L3: ['S5', 'S6'], M2: type === 'TUTORAT' ? ['S3'] : ['S3', 'S4'] };
  if (type === 'EVALUATIONS') return SEMS[niv].flatMap(s => [`${s} SN`, `${s} SR`]);
  if (type === 'TUTORAT') return SEMS[niv].map(s => `Tutorat ${s}`);
  return null;
}

function ModalActivite({ annee, canSegments, defaultSegment, lignesMap, peutAjouterLigne, onLignesChanged, onClose, onCreated }) {
  const [form, setForm] = useState({
    segment: (defaultSegment && canSegments.includes(defaultSegment) ? defaultSegment : canSegments[0]) || 'DFIP_DES',
    ligne: '', libelle: '', date_debut: '', date_fin: '',
    type: '', sous_type: 'EXAMEN',
  });
  const [loading, setLoading] = useState(false);
  const [ajoutLigne, setAjoutLigne] = useState(false);
  const [nouvelleLigne, setNouvelleLigne] = useState('');
  const lignes = lignesMap[form.segment] || LIGNES_DEFAUT[form.segment] || [];
  const estRectorat = form.segment === 'RECTORAT';
  const sansType = ['RECTORAT', 'DFIP_DES'].includes(form.segment); // pas de type d'activité pour ces segments
  const termeLigne = estRectorat ? 'Ligne' : 'Niveau'; // « Ligne » pour le Rectorat, « Niveau » ailleurs

  async function ajouterLigne() {
    if (!nouvelleLigne.trim()) return;
    try {
      await api.post('/planning/lignes', { segment: form.segment, nom: nouvelleLigne.trim() });
      toast.success(`${termeLigne} « ${nouvelleLigne.trim()} » ajouté(e) au segment`);
      setForm(f => ({ ...f, ligne: nouvelleLigne.trim() }));
      setNouvelleLigne(''); setAjoutLigne(false);
      onLignesChanged();
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
  }

  async function submit(e) {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post('/planning', { ...form, type: sansType ? '' : form.type, annee_id: annee.id });
      toast.success('Activité ajoutée au planning');
      onCreated(); onClose();
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
    finally { setLoading(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto nav-scroll">
        <div className="flex items-center justify-between p-5 border-b">
          <h2 className="font-semibold text-slate-800">Ajouter une activité — {annee.libelle}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-4">
          <div>
            <label className="text-sm font-medium text-slate-700 block mb-1">Segment *</label>
            <select value={form.segment} onChange={e => setForm(f => ({ ...f, segment: e.target.value, ligne: '', libelle: '', type: ['RECTORAT', 'DFIP_DES'].includes(e.target.value) ? '' : f.type }))}>
              {canSegments.map(s => <option key={s} value={s}>{SEGMENTS[s].label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700 block mb-1">{termeLigne} *</label>
            <div className="flex gap-2">
              <select value={form.ligne} onChange={e => setForm(f => ({ ...f, ligne: e.target.value, libelle: '' }))} required className="flex-1">
                <option value="">— Choisir un {termeLigne.toLowerCase()} —</option>
                {lignes.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
              {peutAjouterLigne && (
                <button type="button" onClick={() => setAjoutLigne(v => !v)}
                  className="btn-secondary !px-3 shrink-0" title={`Ajouter un ${termeLigne.toLowerCase()} à ce segment (Directeur DFIP)`}>
                  +
                </button>
              )}
            </div>
            {ajoutLigne && (
              <div className="flex gap-2 mt-2">
                <input value={nouvelleLigne} onChange={e => setNouvelleLigne(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); ajouterLigne(); } }}
                  placeholder={`Nouveau ${termeLigne.toLowerCase()} pour ${form.segment.replace('_', ' & ')}...`}
                  className="flex-1 !py-1.5 !text-sm" autoFocus />
                <button type="button" onClick={ajouterLigne} className="btn-primary !py-1.5 !px-3 !text-sm shrink-0">Ajouter</button>
              </div>
            )}
          </div>
          {/* TYPE D'ACTIVITÉ (avant le libellé) — pas de type pour RECTORAT ni DFIP & DES */}
          {!sansType && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium text-slate-700 block mb-1">Type d'activité</label>
              <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value, libelle: '' }))}>
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
          )}
          {!sansType && form.type && (
            <p className="text-xs text-blue-700 bg-blue-50 border border-blue-100 rounded-xl p-2.5 -mt-1">
              🔗 Cette activité sera <strong>automatiquement affichée dans le module {form.type === 'TUTORAT' ? 'Tutorat' : 'Évaluations'}</strong> —
              pas de nouvelle saisie : le suivi se fera directement sur l'entrée liée.
            </p>
          )}

          {/* LIBELLÉ : liste déroulante déduite du type + niveau, sinon saisie libre */}
          <div>
            <label className="text-sm font-medium text-slate-700 block mb-1">Libellé de la barre *</label>
            {(() => {
              const opts = sansType ? null : libellesPossibles(form.type, form.ligne);
              return opts ? (
                <select value={form.libelle} onChange={e => setForm(f => ({ ...f, libelle: e.target.value }))} required>
                  <option value="">— Choisir un libellé —</option>
                  {opts.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : (
                <input value={form.libelle} onChange={e => setForm(f => ({ ...f, libelle: e.target.value }))}
                  placeholder="Ex: S1, Réinscriptions, Découpage..." required />
              );
            })()}
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700 block mb-1">Période de l'activité (début → fin) *</label>
            <PlageDates debut={form.date_debut} fin={form.date_fin}
              onChange={({ debut, fin }) => setForm(f => ({ ...f, date_debut: debut, date_fin: fin }))} />
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
  const [lignesSeg, setLignesSeg] = useState([]);         // lignes/niveaux paramétrables par segment
  const [modal, setModal] = useState(false);
  const [modalAnnee, setModalAnnee] = useState(false);
  const [loading, setLoading] = useState(true);

  const annee = annees.find(a => a.id === anneeId);

  // Zoom temporel continu : domaine = 3 années académiques autour de l'année choisie ;
  // fenêtre par défaut = l'année académique active (nov → oct)
  const anneeBase = parseInt(annee?.libelle) || new Date().getFullYear();
  const domaine = useMemo(() => ({
    t0: +new Date(anneeBase - 1, 10, 1), t1: +new Date(anneeBase + 2, 10, 1),
  }), [anneeBase]);
  const fenetreDefaut = useMemo(() => ({
    t0: +new Date(anneeBase, 10, 1), t1: +new Date(anneeBase + 1, 10, 1),
  }), [anneeBase]);
  const [fenetre, setFenetre] = useState(fenetreDefaut);
  useEffect(() => { setFenetre(fenetreDefaut); }, [fenetreDefaut]);

  const tl = useTimelineFenetre(fenetre);

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
      api.get('/planning/lignes').catch(() => ({ data: [] })),
    ]).then(([p, v, f, l]) => {
      setActivites(p.data); setVacances(v.data); setFeries(f.data); setLignesSeg(l.data);
    }).finally(() => setLoading(false));
  }
  useEffect(load, [anneeId]);

  // Matérialise les fériés récurrents dans la plage de la timeline
  // (toutes les années couvertes par la fenêtre de zoom, pas seulement les bornes)
  const feriesRange = useMemo(() => {
    if (!annee) return [];
    const annees_ = [];
    for (let y = tl.start.getFullYear(); y <= tl.end.getFullYear(); y++) annees_.push(y);
    const out = [];
    for (const f of feries) {
      if (f.recurrent) {
        const mmdd = f.date.slice(5);
        annees_.forEach(y => {
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
  const peutAjouterLigne = ['DIRECTEUR', 'ADMIN_PORTAIL'].includes(user?.role);

  // Lignes paramétrées, groupées par segment (source : table planning_lignes)
  const lignesMap = useMemo(() => {
    const m = {};
    lignesSeg.forEach(l => { (m[l.segment] = m[l.segment] || []).push(l.nom); });
    return m;
  }, [lignesSeg]);
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
          <div className="ml-auto flex items-center gap-2 flex-wrap text-xs text-slate-400">
            <span>🔍 Zoom continu : barre sous le planning</span>
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

      {/* Barre de zoom continu (poignées + défilement), EN HAUT du calendrier */}
      <BarreZoom
        domaine={domaine} fenetre={fenetre} setFenetre={setFenetre}
        onReset={() => setFenetre(fenetreDefaut)}
        reperes={[
          ...activites.map(a => ({
            t0: Date.parse(a.date_debut), t1: Date.parse(a.date_fin) + JOUR_MS,
            color: (SEGMENTS[a.segment] || SEGMENTS.RECTORAT).color,
          })),
          ...vacances.map(v => ({ t0: Date.parse(v.date_debut), t1: Date.parse(v.date_fin) + JOUR_MS, color: '#ef4444' })),
        ]}
      />

      {loading ? (
        <div className="flex items-center justify-center h-40">
          <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="card !p-0 overflow-x-auto nav-scroll">
          <div className="min-w-[1100px]">
            {/* En-tête des mois — FIGÉ en haut, coin figé à gauche */}
            <div className="flex sticky top-0 bg-white z-40 border-b border-slate-200">
              <div className="w-56 shrink-0 px-3 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wide border-r border-slate-200 sticky left-0 bg-white z-40">
                Segments / Lignes / Niveaux
              </div>
              <EnTeteUnites tl={tl} />
            </div>

            {/* Bandeau vacances & fériés */}
            <BandeauVacances vacances={vacances} feries={feriesRange} tl={tl} />

            {/* Segments + vacances/fériés AU PREMIER PLAN (texte vertical) */}
            <div className="relative">
            <OverlaysDevant vacances={vacances} feries={feriesRange} tl={tl} left="14rem" />
            {Object.entries(SEGMENTS)
              .filter(([key]) => segmentsVisibles.includes(key) && (!segmentActif || key === segmentActif))
              .map(([key, seg]) => {
              const focus = segmentActif === key;
              const actsSeg = activites.filter(a => a.segment === key);
              const lignes = [...new Set([...(lignesMap[key] || LIGNES_DEFAUT[key] || []), ...actsSeg.map(a => a.ligne)])];
              return (
                <div key={key} className="border-b border-slate-100 last:border-0">
                  {/* Bandeau segment (libellé figé à gauche au défilement) */}
                  <div className={`flex items-center gap-2 ${focus ? 'py-3' : 'py-2'}`} style={{ background: seg.light }}>
                    <span className={`font-bold px-3 sticky left-0 z-30 max-w-[70vw] truncate ${focus ? 'text-base' : 'text-sm'}`} style={{ color: seg.color }} title={seg.label}>{seg.label}</span>
                    <span className="text-xs text-slate-400 ml-auto shrink-0 pr-3">{actsSeg.length} activité(s)</span>
                  </div>

                  {/* Lignes (première colonne FIGÉE à gauche) */}
                  {lignes.map(ligne => {
                    const barres = actsSeg.filter(a => a.ligne === ligne);
                    return (
                      <div key={ligne} className="flex border-t border-slate-50">
                        <div className={`w-56 shrink-0 px-3 border-r border-slate-100 truncate text-slate-600 sticky left-0 bg-white z-30 ${focus ? 'py-4 text-sm font-medium' : 'py-2 text-xs'}`} title={ligne}>
                          {ligne}
                        </div>
                        <div className={`flex-1 relative ${focus ? 'h-14' : 'h-9'}`}>
                          <FondGrille tl={tl} />
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
            </div>

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
        💡 Les bandes rouges = vacances · les colonnes sombres = jours fériés (gérés dans « Fériés & Vacances »).
        Zoom : rapprochez les poignées de la barre ci-dessus, ou glissez le bloc pour faire défiler la période.
      </p>

      {modal && annee && (
        <ModalActivite annee={annee} canSegments={canSegments} defaultSegment={segmentActif}
          lignesMap={lignesMap} peutAjouterLigne={peutAjouterLigne}
          onLignesChanged={() => api.get('/planning/lignes').then(r => setLignesSeg(r.data)).catch(() => {})}
          onClose={() => setModal(false)} onCreated={load} />
      )}
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
          lignesMap={lignesMap}
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
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto nav-scroll">
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
function ModalDetail({ activite: a, canEdit, estDirecteur, lignesMap = {}, onClose, onChanged }) {
  const seg = SEGMENTS[a.segment];
  const termeLigne = a.segment === 'RECTORAT' ? 'Ligne' : 'Niveau';
  const lignesDispo = [...new Set([...(lignesMap[a.segment] || LIGNES_DEFAUT[a.segment] || []), a.ligne])];
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
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto nav-scroll">
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
                    <label className="text-xs font-medium text-slate-600 block mb-1">{termeLigne}</label>
                    <select value={form.ligne} onChange={e => setForm(f => ({ ...f, ligne: e.target.value }))} className="!py-1.5 !text-sm">
                      {lignesDispo.map(l => <option key={l} value={l}>{l}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-600 block mb-1">Libellé</label>
                    <input value={form.libelle} onChange={e => setForm(f => ({ ...f, libelle: e.target.value }))} className="!py-1.5 !text-sm" />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-600 block mb-1">Période (début → fin)</label>
                  <PlageDates compact debut={form.date_debut} fin={form.date_fin}
                    onChange={({ debut, fin }) => setForm(f => ({ ...f, date_debut: debut, date_fin: fin || debut }))} />
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
