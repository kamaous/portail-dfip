import { useEffect, useState } from 'react';
import api from '../lib/api';
import { Wifi, WifiOff, Clock, Monitor } from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';

const ROLE_COLORS = {
  DIRECTEUR: 'bg-purple-100 text-purple-800',
  CHEF_SERVICE: 'bg-blue-100 text-blue-800',
  MEMBRE_POLE: 'bg-green-100 text-green-800',
  SCOLARITE: 'bg-orange-100 text-orange-800',
  ADMIN_PORTAIL: 'bg-red-100 text-red-800',
};

export default function Connexions() {
  const [online, setOnline] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get('/users/online'),
      api.get('/users/sessions?limit=100')
    ]).then(([o, s]) => {
      setOnline(o.data);
      setSessions(s.data);
    }).finally(() => setLoading(false));

    const iv = setInterval(() => {
      api.get('/users/online').then(r => setOnline(r.data));
    }, 30000); // refresh toutes les 30s

    return () => clearInterval(iv);
  }, []);

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Suivi des connexions</h1>
        <p className="text-slate-500 text-sm">Utilisateurs en ligne et historique des sessions</p>
      </div>

      {/* En ligne */}
      <div className="card">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-2.5 h-2.5 bg-green-500 rounded-full animate-pulse" />
          <h2 className="font-semibold text-slate-800">En ligne actuellement ({online.length})</h2>
          <span className="text-xs text-slate-400 ml-auto">Actifs les 15 dernières minutes</span>
        </div>
        {online.length === 0 ? (
          <div className="text-center py-8 text-slate-400">
            <WifiOff size={32} className="mx-auto mb-2 opacity-30" />
            <p>Aucun utilisateur en ligne</p>
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {online.map((u, i) => (
              <div key={i} className="flex items-center gap-3 bg-green-50 border border-green-100 rounded-xl p-3">
                <div className="w-10 h-10 rounded-full bg-white border-2 border-green-300 flex items-center justify-center text-sm font-bold text-green-700 shrink-0">
                  {u.prenom?.[0]}{u.nom?.[0]}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-slate-800 text-sm">{u.prenom} {u.nom}</p>
                  <span className={`badge text-xs ${ROLE_COLORS[u.role]}`}>{u.role}</span>
                </div>
                <div className="text-right shrink-0">
                  <div className="flex items-center gap-1 text-green-600 text-xs">
                    <Clock size={11} />
                    <span>{u.minutes_connecte} min</span>
                  </div>
                  <p className="text-xs text-slate-400">{u.ip_address}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Historique des sessions */}
      <div className="card">
        <h2 className="font-semibold text-slate-800 mb-4 flex items-center gap-2">
          <Monitor size={16} /> Historique des sessions (100 dernières)
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left border-b border-slate-200">
              <tr>
                <th className="table-header pb-2">Utilisateur</th>
                <th className="table-header pb-2">Rôle</th>
                <th className="table-header pb-2">Connexion</th>
                <th className="table-header pb-2">Déconnexion</th>
                <th className="table-header pb-2">Durée</th>
                <th className="table-header pb-2">IP</th>
                <th className="table-header pb-2">Statut</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {sessions.map(s => (
                <tr key={s.id} className="hover:bg-slate-50">
                  <td className="py-2.5 pr-4">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-slate-200 flex items-center justify-center text-xs font-bold text-slate-600">
                        {s.prenom?.[0]}{s.nom?.[0]}
                      </div>
                      <span className="font-medium text-slate-700">{s.prenom} {s.nom}</span>
                    </div>
                  </td>
                  <td className="py-2.5 pr-4">
                    <span className={`badge text-xs ${ROLE_COLORS[s.role]}`}>{s.role}</span>
                  </td>
                  <td className="py-2.5 pr-4 text-slate-600 whitespace-nowrap">
                    {format(new Date(s.connected_at), 'dd/MM/yy HH:mm')}
                  </td>
                  <td className="py-2.5 pr-4 text-slate-500 whitespace-nowrap">
                    {s.disconnected_at ? format(new Date(s.disconnected_at), 'dd/MM/yy HH:mm') : '—'}
                  </td>
                  <td className="py-2.5 pr-4 text-slate-600">
                    {s.duree_minutes ? `${s.duree_minutes} min` : '—'}
                  </td>
                  <td className="py-2.5 pr-4 text-slate-400 font-mono text-xs">{s.ip_address || '—'}</td>
                  <td className="py-2.5">
                    <div className="flex items-center gap-1">
                      {s.actif ? (
                        <><div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" /><span className="text-xs text-green-600">En ligne</span></>
                      ) : (
                        <><div className="w-2 h-2 bg-slate-300 rounded-full" /><span className="text-xs text-slate-400">Déconnecté</span></>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
