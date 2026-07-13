import { useState } from 'react';

// Palette par label connue (couleurs cohérentes avec les badges)
const COLOR_MAP = {
  // Tâches
  OUVERTE: '#3b82f6', EN_COURS: '#f59e0b', COMPLETEE: '#22c55e', ANNULEE: '#94a3b8',
  // Incidents gravité
  CRITIQUE: '#dc2626', HAUTE: '#f97316', MOYENNE: '#f59e0b', FAIBLE: '#94a3b8',
  // Incidents statut
  OUVERT: '#ef4444', RESOLU: '#22c55e',
  // Examens
  PLANIFIE: '#3b82f6', TERMINE: '#22c55e', ANNULE: '#ef4444',
  // Rôles
  DIRECTEUR: '#8b5cf6', CHEF_SERVICE: '#3b82f6', MEMBRE_POLE: '#22c55e',
  SCOLARITE: '#f97316', ADMIN_PORTAIL: '#dc2626',
};
const FALLBACK = ['#1e3a5f', '#2563eb', '#06b6d4', '#22c55e', '#f59e0b', '#f97316', '#dc2626', '#8b5cf6'];

function colorFor(label, i) {
  return COLOR_MAP[label] || FALLBACK[i % FALLBACK.length];
}

/* ---------- Donut interactif ---------- */
export function DonutChart({ title, data = [], onSlice, icon: Icon }) {
  const [hover, setHover] = useState(null);
  const filtered = data.filter(d => d.value > 0);
  const total = filtered.reduce((s, d) => s + d.value, 0);

  if (total === 0) return (
    <div className="card">
      <h3 className="font-semibold text-slate-800 mb-3 flex items-center gap-2 text-sm">
        {Icon && <Icon size={16} />} {title}
      </h3>
      <div className="h-44 flex items-center justify-center text-slate-300 text-sm">Aucune donnée</div>
    </div>
  );

  const R = 60, STROKE = 22, C = 2 * Math.PI * R;
  let offset = 0;
  const segments = filtered.map((d, i) => {
    const frac = d.value / total;
    const seg = { ...d, color: colorFor(d.label, i), dash: frac * C, offset: offset * C, frac };
    offset += frac;
    return seg;
  });

  const active = hover != null ? segments[hover] : null;

  return (
    <div className="card">
      <h3 className="font-semibold text-slate-800 mb-3 flex items-center gap-2 text-sm">
        {Icon && <Icon size={16} />} {title}
      </h3>
      <div className="flex items-center gap-4">
        <div className="relative shrink-0">
          <svg width="150" height="150" viewBox="0 0 150 150">
            <g transform="rotate(-90 75 75)">
              {segments.map((s, i) => (
                <circle
                  key={i}
                  cx="75" cy="75" r={R}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={hover === i ? STROKE + 5 : STROKE}
                  strokeDasharray={`${s.dash} ${C - s.dash}`}
                  strokeDashoffset={-s.offset}
                  className="transition-all duration-200 cursor-pointer"
                  style={{ opacity: hover == null || hover === i ? 1 : 0.4 }}
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => onSlice?.(s.label)}
                />
              ))}
            </g>
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <span className="text-2xl font-bold text-slate-800">{active ? active.value : total}</span>
            <span className="text-xs text-slate-400">{active ? active.label : 'Total'}</span>
          </div>
        </div>
        <div className="flex-1 space-y-1.5 min-w-0">
          {segments.map((s, i) => (
            <button
              key={i}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onClick={() => onSlice?.(s.label)}
              className={`w-full flex items-center gap-2 text-left px-2 py-1 rounded-lg transition-colors ${hover === i ? 'bg-slate-50' : ''}`}
            >
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: s.color }} />
              <span className="text-xs text-slate-600 truncate flex-1">{s.label}</span>
              <span className="text-xs font-semibold text-slate-800">{s.value}</span>
              <span className="text-xs text-slate-400 w-9 text-right">{Math.round(s.frac * 100)}%</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------- Barres horizontales interactives ---------- */
export function BarChart({ title, data = [], onBar, icon: Icon }) {
  const [hover, setHover] = useState(null);
  const filtered = data.filter(d => d.value > 0);
  const max = Math.max(...filtered.map(d => d.value), 1);

  return (
    <div className="card">
      <h3 className="font-semibold text-slate-800 mb-4 flex items-center gap-2 text-sm">
        {Icon && <Icon size={16} />} {title}
      </h3>
      {filtered.length === 0 ? (
        <div className="h-32 flex items-center justify-center text-slate-300 text-sm">Aucune donnée</div>
      ) : (
        <div className="space-y-2.5">
          {filtered.map((d, i) => (
            <button
              key={i}
              onClick={() => onBar?.(d.label)}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              className="w-full group"
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-slate-600 truncate">{d.label}</span>
                <span className="text-xs font-semibold text-slate-800">{d.value}</span>
              </div>
              <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${(d.value / max) * 100}%`,
                    background: colorFor(d.label, i),
                    opacity: hover == null || hover === i ? 1 : 0.5,
                  }}
                />
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- Sparkline / courbe d'activité ---------- */
export function ActivityChart({ title, data = [], icon: Icon }) {
  const [hover, setHover] = useState(null);
  // Construire 7 jours glissants
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const found = data.find(x => x.jour === key);
    days.push({ jour: key, value: found ? found.value : 0, label: d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' }) });
  }
  const max = Math.max(...days.map(d => d.value), 1);
  const W = 100, H = 40;
  const pts = days.map((d, i) => [(i / (days.length - 1)) * W, H - (d.value / max) * H]);
  const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  const area = `${path} L ${W} ${H} L 0 ${H} Z`;

  return (
    <div className="card">
      <h3 className="font-semibold text-slate-800 mb-1 flex items-center gap-2 text-sm">
        {Icon && <Icon size={16} />} {title}
      </h3>
      <p className="text-xs text-slate-400 mb-3">7 derniers jours · {days.reduce((s, d) => s + d.value, 0)} actions</p>
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-24" preserveAspectRatio="none">
          <defs>
            <linearGradient id="actGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#2563eb" stopOpacity="0.3" />
              <stop offset="100%" stopColor="#2563eb" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area} fill="url(#actGrad)" />
          <path d={path} fill="none" stroke="#2563eb" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
          {pts.map((p, i) => (
            <circle key={i} cx={p[0]} cy={p[1]} r={hover === i ? 3 : 2}
              fill="#2563eb" vectorEffect="non-scaling-stroke"
              className="cursor-pointer" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
          ))}
        </svg>
        {hover != null && (
          <div className="absolute -top-2 bg-slate-800 text-white text-xs px-2 py-1 rounded pointer-events-none"
            style={{ left: `${(hover / (days.length - 1)) * 100}%`, transform: 'translateX(-50%)' }}>
            {days[hover].value} action(s)
          </div>
        )}
      </div>
      <div className="flex justify-between mt-1">
        {days.map((d, i) => (
          <span key={i} className="text-[10px] text-slate-400">{d.label}</span>
        ))}
      </div>
    </div>
  );
}
