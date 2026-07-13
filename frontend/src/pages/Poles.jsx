import { useEffect, useState } from 'react';
import api from '../lib/api';
import toast from 'react-hot-toast';
import { Plus, ChevronRight, Trash2, Building2, GraduationCap, Users2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const CYCLE_STYLE = {
  LICENCE: 'bg-blue-50 text-blue-700 border-blue-100',
  MASTER: 'bg-purple-50 text-purple-700 border-purple-100',
};

export default function Poles() {
  const { user } = useAuth();
  const [poles, setPoles] = useState([]);
  const [promotions, setPromotions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState({});

  const canEdit = ['DIRECTEUR', 'ADMIN_PORTAIL', 'CHEF_SERVICE'].includes(user?.role);
  const canPromo = ['DIRECTEUR', 'ADMIN_PORTAIL'].includes(user?.role);

  function load() {
    setLoading(true);
    Promise.all([api.get('/poles'), api.get('/poles/promotions')])
      .then(([p, pr]) => { setPoles(p.data); setPromotions(pr.data); })
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  async function ajouterPole() {
    const code = prompt('Code du pôle (ex: STN) :');
    if (!code) return;
    const nom = prompt('Nom du pôle :');
    try { await api.post('/poles', { code, nom }); toast.success('Pôle créé'); load(); }
    catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
  }

  async function supprimerPole(id, nom) {
    if (!confirm(`Supprimer le pôle "${nom}" et toutes ses formations ?`)) return;
    await api.delete(`/poles/${id}`); toast.success('Pôle supprimé'); load();
  }

  async function ajouterFormation(poleId) {
    const nom = prompt('Nom de la formation (ex: Sciences juridiques (SJ)) :');
    if (!nom) return;
    const cycle = confirm('Formation de cycle MASTER ?\n(OK = Master, Annuler = Licence)') ? 'MASTER' : 'LICENCE';
    const m = nom.match(/\(([^)]+)\)\s*$/);
    try {
      await api.post(`/poles/${poleId}/formations`, { nom, code: m ? m[1] : null, cycle });
      toast.success('Formation ajoutée'); load();
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
  }

  async function supprimerFormation(id, nom) {
    if (!confirm(`Supprimer la formation "${nom}" ?`)) return;
    await api.delete(`/poles/formations/${id}`); toast.success('Formation supprimée'); load();
  }

  async function ajouterPromotion() {
    const code = prompt('Code de la promotion (ex: P14) :');
    if (!code) return;
    const annee = prompt("Année d'entrée (ex: 2026-2027) :");
    try { await api.post('/poles/promotions', { code, annee_entree: annee }); toast.success('Promotion créée'); load(); }
    catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Pôles, Formations & Promotions</h1>
          <p className="text-slate-500 text-sm">Référentiel officiel UN-CHK · {poles.length} pôles · {poles.reduce((s, p) => s + (p.formations?.length || 0), 0)} formations · {promotions.length} promotions</p>
        </div>
        {canEdit && (
          <button onClick={ajouterPole} className="btn-primary flex items-center gap-2">
            <Plus size={16} /> Ajouter un pôle
          </button>
        )}
      </div>

      {/* Promotions */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-slate-800 flex items-center gap-2"><Users2 size={17} /> Promotions</h3>
          {canPromo && <button onClick={ajouterPromotion} className="text-xs text-blue-600 font-medium hover:bg-blue-50 px-2 py-1 rounded-lg flex items-center gap-1"><Plus size={13} /> Promotion</button>}
        </div>
        <div className="flex flex-wrap gap-2">
          {promotions.map(p => (
            <div key={p.id} className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-sm">
              <span className="font-bold text-[#1e3a5f]">{p.code}</span>
              {p.annee_entree && <span className="text-slate-400 text-xs ml-1.5">entrée {p.annee_entree}</span>}
            </div>
          ))}
        </div>
      </div>

      {/* Pôles + formations */}
      <div className="space-y-4">
        {poles.map(pole => {
          const licences = (pole.formations || []).filter(f => f.cycle === 'LICENCE');
          const masters = (pole.formations || []).filter(f => f.cycle === 'MASTER');
          return (
            <div key={pole.id} className="card">
              <div className="flex items-center justify-between mb-2">
                <button
                  onClick={() => setExpanded(e => ({ ...e, [pole.id]: !e[pole.id] }))}
                  className="flex items-center gap-2 font-semibold text-slate-800 hover:text-blue-700 text-left"
                >
                  <ChevronRight size={18} className={`transition-transform shrink-0 ${expanded[pole.id] ? 'rotate-90' : ''}`} />
                  <span className="text-blue-600 font-mono text-sm bg-blue-50 px-2 py-0.5 rounded shrink-0">{pole.code}</span>
                  <span className="truncate">{pole.nom || pole.code}</span>
                  <span className="text-xs text-slate-400 font-normal shrink-0">({pole.formations?.length || 0} formations)</span>
                </button>
                {canEdit && (
                  <div className="flex gap-1 shrink-0">
                    <button onClick={() => ajouterFormation(pole.id)} className="text-xs text-blue-600 hover:bg-blue-50 px-2 py-1 rounded">+ Formation</button>
                    <button onClick={() => supprimerPole(pole.id, pole.nom)} className="p-1.5 text-red-400 hover:bg-red-50 rounded">
                      <Trash2 size={14} />
                    </button>
                  </div>
                )}
              </div>

              {expanded[pole.id] && (
                <div className="ml-6 mt-3 space-y-4">
                  {[['LICENCE', licences], ['MASTER', masters]].map(([cycle, list]) => list.length > 0 && (
                    <div key={cycle}>
                      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                        <GraduationCap size={13} /> {cycle === 'LICENCE' ? 'Licences' : 'Masters'} ({list.length})
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {list.map(f => (
                          <div key={f.id} className={`flex items-center gap-1.5 border rounded-xl px-2.5 py-1.5 text-xs ${CYCLE_STYLE[f.cycle]}`}>
                            {f.code && <span className="font-bold">{f.code}</span>}
                            <span className="max-w-64 truncate" title={f.nom}>{f.nom.replace(/\s*\([^)]+\)\s*$/, '')}</span>
                            {canEdit && (
                              <button onClick={() => supprimerFormation(f.id, f.nom)} className="text-red-400 hover:text-red-600 ml-0.5">✕</button>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                  {(pole.formations || []).length === 0 && <p className="text-sm text-slate-400 italic">Aucune formation</p>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
