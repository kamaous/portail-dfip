import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { useAuth } from '../context/AuthContext';
import {
  CheckSquare, AlertTriangle, BookOpen, ClipboardList,
  Calendar, Users, Wifi, TrendingUp, Clock, Activity,
  PieChart, BarChart3, Building2, RefreshCw, FileSpreadsheet
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import { DonutChart, BarChart, ActivityChart } from '../components/Charts';

function StatCard({ icon: Icon, label, value, sub, color = 'blue', onClick }) {
  const colors = {
    blue: 'text-blue-600 bg-blue-50',
    green: 'text-green-600 bg-green-50',
    red: 'text-red-600 bg-red-50',
    orange: 'text-orange-600 bg-orange-50',
    purple: 'text-purple-600 bg-purple-50',
    cyan: 'text-cyan-600 bg-cyan-50',
  };
  return (
    <button
      onClick={onClick}
      className="card flex items-start gap-4 text-left hover:shadow-md hover:-translate-y-0.5 transition-all w-full group"
    >
      <div className={`p-3 rounded-xl ${colors[color]} group-hover:scale-105 transition-transform`}>
        <Icon size={22} />
      </div>
      <div className="min-w-0">
        <p className="text-2xl font-bold text-slate-800">{value ?? '—'}</p>
        <p className="text-sm font-medium text-slate-600">{label}</p>
        {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
      </div>
    </button>
  );
}

const ACTION_LABELS = {
  LOGIN: 'Connexion', LOGOUT: 'Déconnexion', CREATE_TACHE: 'Tâche créée',
  CREATE_INCIDENT: 'Incident signalé', CREATE_EXAMEN: 'Examen créé',
  UPLOAD_CALENDRIER: 'Calendrier uploadé', CREATE_USER: 'Utilisateur créé',
  CREATE_TUTORAT: 'Tutorat créé', CHANGE_PASSWORD: 'Mot de passe changé',
};

const ROLE_LABELS = {
  DIRECTEUR: 'Directeurs', CHEF_SERVICE: 'Chefs de service', MEMBRE_POLE: 'Membres pôle',
  SCOLARITE: 'Scolarité', ADMIN_PORTAIL: 'Admins',
};

import BoutonExportPdf from '../components/ExportPdf';

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [annees, setAnnees] = useState([]);
  const [anneeId, setAnneeId] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  function load(showRefresh) {
    if (showRefresh) setRefreshing(true);
    api.get(`/dashboard/stats${anneeId ? `?annee_id=${anneeId}` : ''}`)
      .then(r => setStats(r.data))
      .finally(() => { setLoading(false); setRefreshing(false); });
  }

  useEffect(() => {
    api.get('/dashboard/annees').then(r => setAnnees(r.data));
  }, []);

  useEffect(() => { load(); }, [anneeId]);

  // Auto-refresh toutes les 60s
  useEffect(() => {
    const iv = setInterval(() => load(true), 60000);
    return () => clearInterval(iv);
  }, [anneeId]);

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  const rep = stats?.repartitions || {};

  // Mapper rôles avec libellés lisibles
  const rolesData = (rep.utilisateurs_role || []).map(r => ({ label: ROLE_LABELS[r.label] || r.label, value: r.value, _raw: r.label }));

  return (
    <div className="space-y-6">
      {/* En-tête + contrôles */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">
            Bonjour, {user?.prenom} {user?.nom} 👋
          </h1>
          <p className="text-slate-500 text-sm mt-1">
            Vue d'ensemble · {stats?.annee_affichee?.libelle || 'Aucune année'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <BoutonExportPdf />
          {['RECTEUR', 'VICE_RECTEUR', 'DIRECTEUR', 'CHEF_SERVICE', 'CHEF_DIV_TECHNOPEDAGOGIE', 'CHEF_DIV_EVALUATION', 'ADMIN_PORTAIL'].includes(user?.role) && (
            <button
              onClick={async () => {
                const r = await api.get(`/export/dashboard${anneeId ? `?annee_id=${anneeId}` : ''}`, { responseType: 'blob' });
                const url = URL.createObjectURL(r.data);
                const a = document.createElement('a');
                a.href = url;
                a.download = `Statistiques_DFIP_${new Date().toISOString().slice(0, 10)}.xlsx`;
                a.click();
                URL.revokeObjectURL(url);
              }}
              className="btn-secondary flex items-center gap-2 !text-green-700 !border-green-200 hover:!bg-green-50"
              title="Exporter les statistiques au format Excel"
            >
              <FileSpreadsheet size={15} /> Export Excel
            </button>
          )}
          <button
            onClick={() => load(true)}
            className="btn-secondary flex items-center gap-2"
            title="Rafraîchir"
          >
            <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} /> Actualiser
          </button>
          <select
            value={anneeId}
            onChange={e => setAnneeId(e.target.value)}
            className="!w-auto"
          >
            <option value="">Année active</option>
            {annees.map(a => (
              <option key={a.id} value={a.id}>{a.libelle}{a.active ? ' (active)' : ''}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Alertes */}
      {stats?.incidents?.critiques > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center gap-3">
          <AlertTriangle className="text-red-500 shrink-0" size={20} />
          <div>
            <p className="text-red-800 font-semibold text-sm">
              {stats.incidents.critiques} incident(s) critique(s) non résolu(s)
            </p>
            <p className="text-red-600 text-xs">Nécessite une attention immédiate</p>
          </div>
          <button onClick={() => navigate('/incidents')} className="ml-auto text-xs text-red-700 underline font-medium">Voir</button>
        </div>
      )}

      {stats?.taches?.mes_taches > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-center gap-3">
          <CheckSquare className="text-amber-500 shrink-0" size={20} />
          <p className="text-amber-800 text-sm">
            Vous avez <strong>{stats.taches.mes_taches}</strong> tâche(s) en attente
          </p>
          <button onClick={() => navigate('/taches')} className="ml-auto text-xs text-amber-700 underline font-medium">Voir</button>
        </div>
      )}

      {/* Cartes cliquables */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={CheckSquare} label="Tâches ouvertes" value={stats?.taches?.ouvertes} sub={`${stats?.taches?.completees} complétées`} color="blue" onClick={() => navigate('/taches')} />
        <StatCard icon={AlertTriangle} label="Incidents ouverts" value={stats?.incidents?.ouverts} sub={`${stats?.incidents?.critiques} critiques`} color="red" onClick={() => navigate('/incidents')} />
        <StatCard icon={ClipboardList} label="Évaluations" value={stats?.evaluations?.total} sub={`${stats?.evaluations?.en_cours ?? 0} en cours`} color="purple" onClick={() => navigate('/evaluations')} />
        <StatCard icon={BookOpen} label="Tutorats en cours" value={stats?.tutorat?.en_cours} color="green" onClick={() => navigate('/tutorat')} />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Calendar} label="Délibérations faites" value={stats?.evaluations?.delib_terminees} sub={`${stats?.evaluations?.terminees ?? 0} éval. terminées`} color="cyan" onClick={() => navigate('/evaluations')} />
        <StatCard icon={Users} label="Utilisateurs actifs" value={stats?.utilisateurs?.total} color="orange" onClick={() => navigate('/utilisateurs')} />
        <StatCard icon={Wifi} label="En ligne" value={stats?.utilisateurs?.en_ligne} sub="15 dernières min." color="green" onClick={() => navigate('/connexions')} />
        <StatCard icon={Building2} label="Pôles" value={stats?.poles} color="blue" onClick={() => navigate('/poles')} />
      </div>

      {/* Graphiques interactifs */}
      <div className="grid lg:grid-cols-2 gap-4">
        <DonutChart
          title="Incidents par gravité"
          icon={PieChart}
          data={rep.incidents_gravite}
          onSlice={(label) => navigate(`/incidents?gravite=${label}`)}
        />
        <DonutChart
          title="Tâches par statut"
          icon={PieChart}
          data={rep.taches_statut}
          onSlice={() => navigate('/taches')}
        />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <BarChart
          title="Charge par pôle (examens + incidents + tutorats)"
          icon={BarChart3}
          data={rep.charge_poles}
          onBar={() => navigate('/poles')}
        />
        <BarChart
          title="Évaluations par état"
          icon={BarChart3}
          data={(rep.evaluations_etat || []).map(x => ({
            ...x,
            label: { CALENDRIER_DISPONIBLE: 'Calendrier disponible', EVAL_EN_COURS: 'En cours', EVAL_TERMINEES: 'Terminées' }[x.label] || x.label,
          }))}
          onBar={() => navigate('/evaluations')}
        />
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <ActivityChart title="Activité du portail" icon={Activity} data={stats?.activite_7j} />
        </div>
        <BarChart
          title="Utilisateurs par rôle"
          icon={Users}
          data={rolesData}
          onBar={() => navigate('/utilisateurs')}
        />
      </div>

      {/* Activité récente */}
      {stats?.activite_recente?.length > 0 && (
        <div className="card">
          <h3 className="font-semibold text-slate-800 mb-4 flex items-center gap-2">
            <Clock size={16} /> Activité récente
          </h3>
          <div className="space-y-2">
            {stats.activite_recente.map(log => (
              <div key={log.id} className="flex items-center gap-3 py-2 border-b border-slate-50 last:border-0">
                <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-xs font-bold text-slate-600 shrink-0">
                  {log.prenom?.[0]}{log.nom?.[0]}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-slate-700">
                    <span className="font-medium">{log.prenom} {log.nom}</span>
                    {' — '}
                    <span className="text-slate-500">{ACTION_LABELS[log.action] || log.action}</span>
                    {log.detail && <span className="text-slate-400"> : {log.detail}</span>}
                  </p>
                </div>
                <span className="text-xs text-slate-400 shrink-0">
                  {formatDistanceToNow(new Date(log.created_at), { addSuffix: true, locale: fr })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
