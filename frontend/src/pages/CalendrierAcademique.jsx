import { useEffect, useState } from 'react';
import api from '../lib/api';
import toast from 'react-hot-toast';
import { Plus, Trash2, CalendarOff, Palmtree, Lock } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import PlageDates from '../components/PlageDates';

export default function CalendrierAcademique() {
  const { user } = useAuth();
  const [feries, setFeries] = useState([]);
  const [vacances, setVacances] = useState([]);
  const [annees, setAnnees] = useState([]);
  const [loading, setLoading] = useState(true);

  const isDirecteur = user?.role === 'DIRECTEUR';
  const canFerie = ['DIRECTEUR', 'ADMIN_PORTAIL'].includes(user?.role);

  function load() {
    setLoading(true);
    Promise.all([
      api.get('/calendrier-academique/feries'),
      api.get('/calendrier-academique/vacances'),
      api.get('/dashboard/annees'),
    ]).then(([f, v, a]) => { setFeries(f.data); setVacances(v.data); setAnnees(a.data); })
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Calendrier académique</h1>
        <p className="text-slate-500 text-sm">Jours fériés et périodes de vacances — utilisés pour bloquer la programmation d'examens</p>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Jours fériés */}
        <FeriesPanel feries={feries} canEdit={canFerie} onReload={load} loading={loading} />
        {/* Vacances */}
        <VacancesPanel vacances={vacances} annees={annees} isDirecteur={isDirecteur} onReload={load} loading={loading} />
      </div>
    </div>
  );
}

function FeriesPanel({ feries, canEdit, onReload, loading }) {
  const [form, setForm] = useState({ date: '', libelle: '', recurrent: false });
  async function add(e) {
    e.preventDefault();
    if (!form.date || !form.libelle) return toast.error('Date et libellé requis');
    try { await api.post('/calendrier-academique/feries', form); toast.success('Jour férié ajouté'); setForm({ date: '', libelle: '', recurrent: false }); onReload(); }
    catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
  }
  async function del(id) {
    if (!confirm('Supprimer ce jour férié ?')) return;
    await api.delete(`/calendrier-academique/feries/${id}`); toast.success('Supprimé'); onReload();
  }
  return (
    <div className="card">
      <h3 className="font-semibold text-slate-800 mb-4 flex items-center gap-2">
        <CalendarOff size={18} className="text-red-500" /> Jours fériés
      </h3>
      {canEdit && (
        <form onSubmit={add} className="flex flex-wrap gap-2 mb-4 items-end bg-slate-50 p-3 rounded-xl">
          <div className="flex-1 min-w-[120px]">
            <label className="text-xs text-slate-500 block mb-1">Date</label>
            <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
          </div>
          <div className="flex-1 min-w-[140px]">
            <label className="text-xs text-slate-500 block mb-1">Libellé</label>
            <input value={form.libelle} onChange={e => setForm(f => ({ ...f, libelle: e.target.value }))} placeholder="Ex: Tabaski" />
          </div>
          <label className="flex items-center gap-1.5 text-xs text-slate-600 pb-2">
            <input type="checkbox" checked={form.recurrent} onChange={e => setForm(f => ({ ...f, recurrent: e.target.checked }))} className="!w-auto" />
            Chaque année
          </label>
          <button className="btn-primary !py-2"><Plus size={15} /></button>
        </form>
      )}
      {loading ? <Spinner /> : feries.length === 0 ? <Empty text="Aucun jour férié" /> : (
        <ul className="divide-y divide-slate-100">
          {feries.map(f => (
            <li key={f.id} className="flex items-center justify-between py-2.5">
              <div>
                <p className="text-sm font-medium text-slate-700">{f.libelle}</p>
                <p className="text-xs text-slate-400">{f.date}{f.recurrent ? ' · récurrent' : ''}</p>
              </div>
              {canEdit && <button onClick={() => del(f.id)} className="p-1.5 text-red-400 hover:bg-red-50 rounded"><Trash2 size={14} /></button>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function VacancesPanel({ vacances, annees, isDirecteur, onReload, loading }) {
  const [form, setForm] = useState({ libelle: '', date_debut: '', date_fin: '', annee_id: '' });
  async function add(e) {
    e.preventDefault();
    if (!form.libelle || !form.date_debut || !form.date_fin) return toast.error('Tous les champs requis');
    try { await api.post('/calendrier-academique/vacances', form); toast.success('Vacances ajoutées'); setForm({ libelle: '', date_debut: '', date_fin: '', annee_id: '' }); onReload(); }
    catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
  }
  async function del(id) {
    if (!confirm('Supprimer cette période ?')) return;
    await api.delete(`/calendrier-academique/vacances/${id}`); toast.success('Supprimé'); onReload();
  }
  return (
    <div className="card">
      <h3 className="font-semibold text-slate-800 mb-4 flex items-center gap-2">
        <Palmtree size={18} className="text-cyan-500" /> Vacances
        {!isDirecteur && <span className="ml-auto text-xs text-slate-400 flex items-center gap-1"><Lock size={12} /> Directeur uniquement</span>}
      </h3>
      {isDirecteur && (
        <form onSubmit={add} className="space-y-2 mb-4 bg-slate-50 p-3 rounded-xl">
          <input value={form.libelle} onChange={e => setForm(f => ({ ...f, libelle: e.target.value }))} placeholder="Ex: Vacances de Noël" />
          <div>
            <label className="text-xs text-slate-500 block mb-1">Période (début → fin)</label>
            <PlageDates compact debut={form.date_debut} fin={form.date_fin}
              onChange={({ debut, fin }) => setForm(f => ({ ...f, date_debut: debut, date_fin: fin }))} />
          </div>
          <select value={form.annee_id} onChange={e => setForm(f => ({ ...f, annee_id: e.target.value }))}>
            <option value="">Toutes les années</option>
            {annees.map(a => <option key={a.id} value={a.id}>{a.libelle}</option>)}
          </select>
          <button className="btn-primary w-full !py-2 flex items-center justify-center gap-1"><Plus size={15} /> Ajouter</button>
        </form>
      )}
      {loading ? <Spinner /> : vacances.length === 0 ? <Empty text="Aucune période de vacances" /> : (
        <ul className="divide-y divide-slate-100">
          {vacances.map(v => (
            <li key={v.id} className="flex items-center justify-between py-2.5">
              <div>
                <p className="text-sm font-medium text-slate-700">{v.libelle}</p>
                <p className="text-xs text-slate-400">{v.date_debut} → {v.date_fin}</p>
              </div>
              {isDirecteur && <button onClick={() => del(v.id)} className="p-1.5 text-red-400 hover:bg-red-50 rounded"><Trash2 size={14} /></button>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const Spinner = () => <div className="flex justify-center py-8"><div className="w-6 h-6 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>;
const Empty = ({ text }) => <p className="text-center text-slate-400 text-sm py-8">{text}</p>;
