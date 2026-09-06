import { useEffect, useState } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import { LogIn, GanttChartSquare } from 'lucide-react';
import { ResumeCorps } from './Resume';

/* Version PUBLIQUE (lecture seule, sans compte) du module Résumé — même principe
   que PlanningPublic.jsx : données servies par /api/public/resume, sans aucune
   donnée nominative (ni créateur, ni déclarant, ni responsable). */
export default function ResumePublic() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    axios.get('/api/public/resume')
      .then(r => setData(r.data))
      .catch(() => setData({ tutorats: [], evaluations: [], poles: [], incidents: [] }))
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="h-1.5 bg-gradient-to-r from-[#1e3a5f] via-blue-500 to-cyan-400" />
      {/* En-tête public */}
      <header className="bg-white border-b border-slate-200 px-6 py-3 flex items-center gap-3 flex-wrap">
        <img src="/dfip-icon.svg" alt="DFIP" className="w-10 h-10 rounded-xl" />
        <div className="min-w-0">
          <h1 className="text-slate-800 font-bold">Résumé — SUIVI PÉDAGOGIQUE</h1>
          <p className="text-slate-400 text-xs">Université numérique Cheikh Hamidou KANE - UnCHK · Consultation publique</p>
        </div>
        <div className="ml-auto flex items-center gap-2 flex-wrap">
          <Link to="/public" className="btn-secondary flex items-center gap-2 !py-2"><GanttChartSquare size={15} /> Planning annuel</Link>
          <Link to="/login" className="btn-primary flex items-center gap-2 !py-2"><LogIn size={15} /> Connexion</Link>
        </div>
      </header>

      <main className="p-6 max-w-7xl mx-auto">
        <ResumeCorps
          tutorats={data?.tutorats || []}
          evals={data?.evaluations || []}
          poles={data?.poles || []}
          incidents={data?.incidents || []}
          loading={loading}
          onRefresh={load}
          publicMode
        />
      </main>
    </div>
  );
}
