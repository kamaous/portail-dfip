import { useState } from 'react';

/* Sélecteur de PLAGE de dates : un clic pour la date de début, un clic pour la
   date de fin — la période est surlignée (mini-calendrier). Utilisé partout où
   un intervalle début → fin est saisi. */
const MOIS_FR = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export default function PlageDates({ debut, fin, onChange, compact = false }) {
  const [mois, setMois] = useState(() => {
    const ref = debut ? new Date(`${debut}T00:00:00`) : new Date();
    return new Date(ref.getFullYear(), ref.getMonth(), 1);
  });
  const aujourd = iso(new Date());

  const start = new Date(mois);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7)); // lundi
  const finMois = new Date(mois.getFullYear(), mois.getMonth() + 1, 0);
  const semaines = [];
  const cur = new Date(start);
  while (cur <= finMois) {
    const w = [];
    for (let i = 0; i < 7; i++) { w.push(new Date(cur)); cur.setDate(cur.getDate() + 1); }
    semaines.push(w);
  }

  function clic(jISO) {
    if (!debut || (debut && fin)) onChange({ debut: jISO, fin: '' });      // 1er clic (ou re-sélection)
    else if (jISO < debut) onChange({ debut: jISO, fin: debut });          // clic avant le début : on réordonne
    else onChange({ debut, fin: jISO });                                   // 2e clic = fin
  }

  return (
    <div className={`border border-slate-200 rounded-xl bg-white select-none ${compact ? 'p-2 max-w-64' : 'p-3 max-w-72'}`}>
      {/* Navigation du mois */}
      <div className="flex items-center justify-between mb-1">
        <button type="button" onClick={() => setMois(m => new Date(m.getFullYear(), m.getMonth() - 1, 1))}
          className="w-7 h-7 rounded-full hover:bg-slate-100 text-slate-500 font-bold shrink-0">‹</button>
        <p className={`font-semibold text-slate-700 ${compact ? 'text-xs' : 'text-sm'}`}>{MOIS_FR[mois.getMonth()]} {mois.getFullYear()}</p>
        <button type="button" onClick={() => setMois(m => new Date(m.getFullYear(), m.getMonth() + 1, 1))}
          className="w-7 h-7 rounded-full hover:bg-slate-100 text-slate-500 font-bold shrink-0">›</button>
      </div>

      <div className="grid grid-cols-7 text-center text-[10px] font-semibold text-slate-400 mb-0.5">
        {['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((x, i) => <div key={i}>{x}</div>)}
      </div>

      {semaines.map((w, wi) => (
        <div key={wi} className="grid grid-cols-7">
          {w.map((j, di) => {
            const jISO = iso(j);
            const horsMois = j.getMonth() !== mois.getMonth();
            const estDebut = !horsMois && jISO === debut;
            const estFin = !horsMois && jISO === fin;
            const dansPlage = !horsMois && debut && fin && jISO > debut && jISO < fin;
            return (
              <button key={di} type="button" onClick={() => !horsMois && clic(jISO)} tabIndex={horsMois ? -1 : 0}
                className={`relative ${compact ? 'h-7' : 'h-8'} ${horsMois ? 'cursor-default' : 'cursor-pointer'}`}>
                {/* Bande de la plage (continue entre début et fin) */}
                {dansPlage && <span className="absolute inset-0 bg-blue-50" />}
                {estDebut && fin && fin !== debut && <span className="absolute inset-y-0 right-0 w-1/2 bg-blue-50" />}
                {estFin && fin !== debut && <span className="absolute inset-y-0 left-0 w-1/2 bg-blue-50" />}
                <span className={`relative z-10 ${compact ? 'w-6 h-6 text-[11px]' : 'w-7 h-7 text-xs'} mx-auto flex items-center justify-center rounded-full transition-colors ${
                  estDebut || estFin ? 'bg-[#1e3a5f] text-white font-bold'
                    : horsMois ? 'text-transparent'
                    : jISO === aujourd ? 'ring-1 ring-slate-400 text-slate-700 hover:bg-slate-100'
                    : 'text-slate-700 hover:bg-slate-100'}`}>
                  {j.getDate()}
                </span>
              </button>
            );
          })}
        </div>
      ))}

      {/* Récapitulatif de la sélection */}
      <div className={`flex items-center justify-between gap-2 mt-1.5 pt-1.5 border-t border-slate-100 ${compact ? 'text-[11px]' : 'text-xs'}`}>
        <span className="text-slate-600 truncate">
          {!debut ? 'Cliquez la date de début…'
            : !fin ? <><strong>{debut}</strong><span className="text-blue-600"> → cliquez la date de fin…</span></>
            : <><strong>{debut}</strong> → <strong>{fin}</strong></>}
        </span>
        {(debut || fin) && (
          <button type="button" onClick={() => onChange({ debut: '', fin: '' })} className="text-blue-600 hover:underline shrink-0">Effacer</button>
        )}
      </div>
    </div>
  );
}
