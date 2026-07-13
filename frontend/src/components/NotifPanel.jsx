import { useEffect, useState } from 'react';
import { X, Bell, CheckCheck } from 'lucide-react';
import api from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';

const TYPE_STYLES = {
  INFO: 'bg-blue-50 border-blue-200 text-blue-800',
  SUCCES: 'bg-green-50 border-green-200 text-green-800',
  ERREUR: 'bg-red-50 border-red-200 text-red-800',
  ALERTE: 'bg-orange-50 border-orange-200 text-orange-800',
  TACHE: 'bg-purple-50 border-purple-200 text-purple-800',
  INCIDENT: 'bg-red-50 border-red-200 text-red-800',
  CALENDRIER: 'bg-cyan-50 border-cyan-200 text-cyan-800',
  TUTORAT: 'bg-emerald-50 border-emerald-200 text-emerald-800',
  EXAMEN: 'bg-indigo-50 border-indigo-200 text-indigo-800',
};

export default function NotifPanel({ onClose }) {
  const [notifs, setNotifs] = useState([]);
  const { setNotifCount } = useAuth();

  useEffect(() => {
    api.get('/notifications').then(r => setNotifs(r.data));
  }, []);

  async function marquerToutLu() {
    await api.put('/notifications/lire-tout');
    setNotifs(ns => ns.map(n => ({ ...n, lue: 1 })));
    setNotifCount(0);
  }

  async function marquerLu(id) {
    await api.put(`/notifications/${id}/lire`);
    setNotifs(ns => ns.map(n => n.id === id ? { ...n, lue: 1 } : n));
    setNotifCount(c => Math.max(0, c - 1));
  }

  return (
    <div className="absolute right-6 top-0 z-50 w-96 bg-white rounded-xl shadow-xl border border-slate-200 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <Bell size={16} className="text-slate-600" />
          <span className="font-semibold text-slate-800 text-sm">Notifications</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={marquerToutLu} className="text-xs text-blue-600 hover:underline flex items-center gap-1">
            <CheckCheck size={14} /> Tout lire
          </button>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="max-h-96 overflow-y-auto divide-y divide-slate-50">
        {notifs.length === 0 && (
          <div className="py-12 text-center text-slate-400 text-sm">
            <Bell size={32} className="mx-auto mb-2 opacity-30" />
            Aucune notification
          </div>
        )}
        {notifs.map(n => (
          <div
            key={n.id}
            onClick={() => !n.lue && marquerLu(n.id)}
            className={`px-4 py-3 cursor-pointer hover:bg-slate-50 transition-colors ${!n.lue ? 'bg-blue-50/50' : ''}`}
          >
            <div className={`text-xs font-medium inline-flex items-center gap-1 px-2 py-0.5 rounded-full border mb-1 ${TYPE_STYLES[n.type] || TYPE_STYLES.INFO}`}>
              {n.type}
            </div>
            <p className={`text-sm ${n.lue ? 'text-slate-500' : 'text-slate-800 font-medium'}`}>{n.titre}</p>
            <p className="text-xs text-slate-400 mt-0.5">{n.message}</p>
            <p className="text-xs text-slate-300 mt-1">
              {formatDistanceToNow(new Date(n.created_at), { addSuffix: true, locale: fr })}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
