import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ChevronDown } from 'lucide-react';
import api from '../lib/api';

/* Incidents remontés qui impactent le module courant :
   - module TUTORAT     → incidents avec conséquence tutorat
   - module EVALUATIONS → incidents avec conséquence évaluations (report, annulation…) */
const GRAVITE = {
  CRITIQUE: 'bg-red-100 text-red-800', HAUTE: 'bg-orange-100 text-orange-700',
  MOYENNE: 'bg-amber-100 text-amber-700', FAIBLE: 'bg-slate-100 text-slate-600',
};

export default function PanneauIncidents({ module, poles = [], segment = null }) {
  const [incidents, setIncidents] = useState([]);
  const [ouvert, setOuvert] = useState(false);

  useEffect(() => {
    api.get('/incidents').then(r => setIncidents(r.data)).catch(() => setIncidents([]));
  }, []);

  const codePole = (i) => poles.find(p => p.id === i.pole_id)?.code || null;
  const concernes = incidents.filter(i =>
    (module === 'TUTORAT' ? (i.conseq_tutorat || i.consequence_tutorat) : (i.conseq_eval || i.consequence_examens))
    && (!segment || codePole(i) === segment));

  if (concernes.length === 0) return null;
  const ouverts = concernes.filter(i => i.statut !== 'RESOLU').length;

  return (
    <div className="border border-red-200 bg-red-50/70 rounded-xl overflow-hidden">
      <button onClick={() => setOuvert(v => !v)} className="w-full flex items-center gap-2 px-4 py-2.5 text-left">
        <AlertTriangle size={16} className="text-red-600 shrink-0" />
        <span className="text-sm font-semibold text-red-800">
          {concernes.length} incident(s) impactant {module === 'TUTORAT' ? 'le tutorat' : 'les évaluations'}
        </span>
        {ouverts > 0 && <span className="badge bg-red-600 text-white text-[10px]">{ouverts} non résolu(s)</span>}
        <ChevronDown size={15} className={`ml-auto text-red-400 transition-transform ${ouvert ? 'rotate-180' : ''}`} />
      </button>
      {ouvert && (
        <div className="px-4 pb-3 space-y-1.5">
          {concernes.map(i => (
            <div key={i.id} className={`flex items-center gap-2 flex-wrap bg-white rounded-lg px-3 py-2 text-xs ${i.statut === 'RESOLU' ? 'opacity-60' : ''}`}>
              <span className={`badge ${GRAVITE[i.gravite] || GRAVITE.FAIBLE} text-[10px]`}>{i.gravite}</span>
              <span className="font-medium text-slate-700">{i.titre}</span>
              <span className="text-slate-400">
                {codePole(i) || 'Général'}
                {(i.date_debut || i.date_incident) && ` · ${i.date_debut || i.date_incident}${i.date_fin ? ` → ${i.date_fin}` : ''}`}
              </span>
              <span className="badge bg-slate-100 text-slate-600 text-[10px]">
                {module === 'TUTORAT' ? (i.conseq_tutorat || i.consequence_tutorat) : (i.conseq_eval || i.consequence_examens)}
              </span>
              {i.statut === 'RESOLU' && <span className="badge bg-green-100 text-green-700 text-[10px]">✓ Résolu</span>}
              <Link to="/incidents" className="ml-auto text-blue-600 hover:underline shrink-0">Ouvrir →</Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
