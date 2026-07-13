import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import { LayoutGrid, LogIn } from 'lucide-react';
import { useTimeline, Overlays, BandeauVacances, EnTeteUnites, FondGrille, ZoomBar } from './PlanningAnnuel';

/* Version PUBLIQUE (lecture seule, sans compte) du planning annuel */
const SEGMENTS = {
  RECTORAT: { label: 'UN-CHK (Rectorat)', color: '#1e3a5f', light: '#e8eef5' },
  DFIP_DES: { label: "Direction de la Formation et de l'Ingénierie pédagogique (DFIP) & Direction des Etudes et de la Scolarité (DES)", color: '#0e7490', light: '#e6f4f7' },
  PSEJA: { label: "Pôle Sciences économiques, juridiques et de l'Administration (PSEJA)", color: '#ea580c', light: '#fdeee3' },
  PSTN: { label: 'Pôle Sciences, Technologies et Numérique (PSTN)', color: '#16a34a', light: '#e8f6ec' },
  PLSHE: { label: "Pôle Lettres, Sciences humaines et de l'Education (PLSHE)", color: '#6d28d9', light: '#f0e9fb' },
};
const LIGNES_DEFAUT = {
  RECTORAT: ["Découpage de l'année"],
  DFIP_DES: ['Inscriptions', 'Cours transversaux', 'Réinscriptions', 'Demandes de dérogation', 'Formation des tuteurs', 'Évaluations SEJA', 'Évaluations STN', 'Évaluations LSHE'],
  PSEJA: ['Licence 1', 'Licence 2', 'Licence 3', 'Master 1', 'Master 2'],
  PSTN: ['Licence 1', 'Licence 2', 'Licence 3', 'Master 1', 'Master 2'],
  PLSHE: ['Licence 1', 'Licence 2', 'Licence 3', 'Master 1', 'Master 2'],
};

export default function PlanningPublic() {
  const [data, setData] = useState(null);
  const [anneeId, setAnneeId] = useState(null);
  const [segmentActif, setSegmentActif] = useState(null);
  const [zoom, setZoom] = useState({ mode: 'ANNEE' });

  useEffect(() => {
    axios.get(`/api/public/planning${anneeId ? `?annee_id=${anneeId}` : ''}`)
      .then(r => { setData(r.data); if (!anneeId) setAnneeId(r.data.annee_id); })
      .catch(() => setData({ annees: [], activites: [], vacances: [], feries: [] }));
  }, [anneeId]);

  const annee = data?.annees?.find(a => a.id === (anneeId || data?.annee_id));
  const tl = useTimeline(annee?.libelle || '', zoom);
  const feriesRange = useMemo(() => {
    if (!data) return [];
    const out = [];
    for (const f of data.feries) {
      if (f.recurrent) {
        const mmdd = f.date.slice(5);
        [tl.start.getFullYear(), tl.end.getFullYear()].forEach(y => {
          const d = `${y}-${mmdd}`;
          if (new Date(d) >= tl.start && new Date(d) <= tl.end) out.push({ ...f, date: d });
        });
      } else if (new Date(f.date) >= tl.start && new Date(f.date) <= tl.end) out.push(f);
    }
    return out;
  }, [data, tl]);

  const activites = data?.activites || [];

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="h-1.5 bg-gradient-to-r from-[#1e3a5f] via-blue-500 to-cyan-400" />
      {/* En-tête public */}
      <header className="bg-white border-b border-slate-200 px-6 py-3 flex items-center gap-3 flex-wrap">
        <img src="/dfip-icon.svg" alt="DFIP" className="w-10 h-10 rounded-xl" />
        <div className="min-w-0">
          <h1 className="text-slate-800 font-bold">Planning annuel — Portail DFIP</h1>
          <p className="text-slate-400 text-xs">Université numérique Cheikh Hamidou KANE - UnCHK · Consultation publique</p>
        </div>
        <div className="ml-auto flex items-center gap-2 flex-wrap">
          <ZoomBar zoom={zoom} setZoom={setZoom} libelle={annee?.libelle || ''} />
          <select value={anneeId || ''} onChange={e => setAnneeId(parseInt(e.target.value))} className="!w-auto">
            {(data?.annees || []).map(a => <option key={a.id} value={a.id}>{a.libelle}{a.active ? ' (active)' : ''}</option>)}
          </select>
          <Link to="/login" className="btn-primary flex items-center gap-2 !py-2"><LogIn size={15} /> Connexion</Link>
        </div>
      </header>

      <main className="p-6 max-w-7xl mx-auto space-y-4">
        {/* Segments cliquables */}
        <div className="card !p-3">
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => setSegmentActif(null)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold border-2 transition-all ${segmentActif === null ? 'bg-slate-800 text-white border-slate-800 shadow-md' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'}`}>
              <LayoutGrid size={15} /> Tous les calendriers
            </button>
            {Object.entries(SEGMENTS).map(([k, s]) => {
              const actif = segmentActif === k;
              const nb = activites.filter(a => a.segment === k).length;
              return (
                <button key={k} onClick={() => setSegmentActif(actif ? null : k)} title={s.label}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold border-2 transition-all ${actif ? 'text-white shadow-md scale-105' : 'bg-white hover:scale-[1.02]'}`}
                  style={actif ? { background: s.color, borderColor: s.color } : { color: s.color, borderColor: `${s.color}55` }}>
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: actif ? '#fff' : s.color }} />
                  {k.replace('_', ' & ')}
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${actif ? 'bg-white/25' : 'bg-slate-100 text-slate-500'}`}>{nb}</span>
                </button>
              );
            })}
          </div>
        </div>

        {!data ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="card !p-0 overflow-x-auto nav-scroll">
            <div className="min-w-[1100px]">
              <div className="flex sticky top-0 bg-white z-10 border-b border-slate-200">
                <div className="w-56 shrink-0 px-3 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wide border-r border-slate-200">
                  Segments / Lignes
                </div>
                <EnTeteUnites tl={tl} />
              </div>
              <BandeauVacances vacances={data.vacances} feries={feriesRange} tl={tl} />
              {Object.entries(SEGMENTS)
                .filter(([key]) => !segmentActif || key === segmentActif)
                .map(([key, seg]) => {
                  const acts = activites.filter(a => a.segment === key);
                  const lignes = [...new Set([...(LIGNES_DEFAUT[key] || []), ...acts.map(a => a.ligne)])];
                  const focus = segmentActif === key;
                  return (
                    <div key={key} className="border-b border-slate-100 last:border-0">
                      <div className={`flex items-center gap-2 px-3 ${focus ? 'py-3' : 'py-2'}`} style={{ background: seg.light }}>
                        <span className={`font-bold ${focus ? 'text-base' : 'text-sm'}`} style={{ color: seg.color }}>{seg.label}</span>
                        <span className="text-xs text-slate-400 ml-auto">{acts.length} activité(s)</span>
                      </div>
                      {lignes.map(ligne => {
                        const barres = acts.filter(a => a.ligne === ligne);
                        return (
                          <div key={ligne} className="flex border-t border-slate-50">
                            <div className={`w-56 shrink-0 px-3 border-r border-slate-100 truncate text-slate-600 ${focus ? 'py-4 text-sm font-medium' : 'py-2 text-xs'}`} title={ligne}>
                              {ligne}
                            </div>
                            <div className={`flex-1 relative ${focus ? 'h-14' : 'h-9'}`}>
                              <FondGrille tl={tl} />
                              <Overlays vacances={data.vacances} feries={feriesRange} tl={tl} />
                              {barres.map(a => {
                                const lr = tl.pctRaw(a.date_debut), rr = tl.pctRaw(a.date_fin);
                                if (rr <= 0 || lr >= 100) return null;
                                const l = Math.max(0, lr);
                                const w = Math.max(Math.min(100, rr) - l, 0.8);
                                return (
                                  <div key={a.id}
                                    title={`${a.libelle} : ${a.date_debut} → ${a.date_fin}`}
                                    className={`absolute rounded-md flex items-center px-1.5 font-semibold text-white truncate shadow-sm ${focus ? 'top-1.5 bottom-1.5 text-xs' : 'top-1 bottom-1 text-[10px]'}`}
                                    style={{ left: `${l}%`, width: `${w}%`, background: a.couleur || seg.color }}>
                                    {a.type === 'TUTORAT' ? '📚 ' : a.type === 'EVALUATIONS' ? (a.sous_type === 'DEVOIRS' ? '📝 ' : '🧪 ') : ''}{a.libelle}
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
        <p className="text-xs text-slate-400 text-center">
          Consultation publique en lecture seule — © {new Date().getFullYear()} UnCHK, Portail DFIP
        </p>
      </main>
    </div>
  );
}
