import { useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  LayoutDashboard, Users, CheckSquare, BookOpen, ClipboardList,
  AlertTriangle, Bell, LogOut, Settings,
  Building2, Calendar, ClipboardCheck, CalendarOff, Video,
  PanelLeftClose, PanelLeftOpen, GanttChartSquare, Gauge
} from 'lucide-react';

// Rôles « visiteurs » : lecture seule du planning annuel uniquement
const ROLES_VISITEURS = ['RECTEUR', 'VICE_RECTEUR', 'DIRECTEUR_DES', 'SCOLARITE', 'MEMBRE_POLE', 'ENSEIGNANT', 'ETUDIANT'];
import NotifPanel from './NotifPanel';

const ROLE_COLORS = {
  DIRECTEUR: 'bg-purple-100 text-purple-800',
  CHEF_SERVICE: 'bg-blue-100 text-blue-800',
  MEMBRE_POLE: 'bg-green-100 text-green-800',
  SCOLARITE: 'bg-orange-100 text-orange-800',
  ADMIN_PORTAIL: 'bg-red-100 text-red-800',
};

function NavItem({ to, icon: Icon, label, end, open }) {
  return (
    <NavLink
      to={to}
      end={end}
      title={open ? undefined : label}
      className={({ isActive }) =>
        `flex items-center rounded-xl text-sm font-medium transition-all duration-150 ${
          open ? 'gap-3 px-3.5 py-2.5' : 'justify-center py-2.5 px-0 w-11 mx-auto'
        } ${
          isActive
            ? 'bg-[#1e3a5f] text-white shadow-sm shadow-blue-900/20'
            : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
        }`
      }
    >
      <Icon size={19} className="shrink-0" />
      {open && <span className="truncate">{label}</span>}
    </NavLink>
  );
}

function SectionTitle({ open, children }) {
  if (!open) return <div className="h-px bg-slate-200 mx-3 my-3" />;
  return <p className="text-slate-400 text-[11px] font-semibold px-3 mb-1.5 mt-5 first:mt-1 uppercase tracking-wider">{children}</p>;
}

export default function Layout({ children }) {
  const { user, logout, notifCount } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(true);
  const [notifOpen, setNotifOpen] = useState(false);

  const isAdmin = user?.role === 'ADMIN_PORTAIL';
  const isDirecteur = user?.role === 'DIRECTEUR';
  const isChef = user?.role === 'CHEF_SERVICE';

  async function handleLogout() {
    await logout();
    navigate('/login');
  }

  return (
    <div className="flex h-screen overflow-hidden bg-slate-100">
      {/* ===== Barre latérale ===== */}
      <aside className={`flex flex-col transition-all duration-300 ${open ? 'w-64' : 'w-[72px]'} bg-white border-r border-slate-200 shrink-0`}>
        {/* Logo (cliquable → tableau de bord) */}
        <div className={`flex items-center py-4 border-b border-slate-100 ${open ? 'px-4 gap-3' : 'flex-col gap-2 px-0'}`}>
          <Link to="/" className={`flex items-center min-w-0 ${open ? 'gap-2.5 flex-1' : ''}`} title="Tableau de bord">
            <img src="/dfip-icon.svg" alt="DFIP" className="w-10 h-10 rounded-xl shrink-0 shadow-md shadow-blue-900/20" />
            {open && (
              <div className="min-w-0">
                <p className="text-slate-800 font-bold text-sm truncate">Portail DFIP</p>
                <p className="text-slate-400 text-xs truncate">UnCHK</p>
              </div>
            )}
          </Link>
          <button
            onClick={() => setOpen(v => !v)}
            className="text-slate-400 hover:text-slate-700 hover:bg-slate-100 p-1.5 rounded-lg shrink-0 transition-colors"
            title={open ? 'Réduire le menu' : 'Agrandir le menu'}
          >
            {open ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
          </button>
        </div>

        {/* Navigation */}
        <nav className={`flex-1 overflow-y-auto nav-scroll py-3 space-y-1 ${open ? 'px-3' : 'px-2'}`}>
          {ROLES_VISITEURS.includes(user?.role) ? (
            <>
              {/* Visiteur : consultation du planning annuel uniquement */}
              <SectionTitle open={open}>Consultation</SectionTitle>
              <NavItem to="/planning" icon={GanttChartSquare} label="Planning annuel" open={open} />
            </>
          ) : (
            <>
          <SectionTitle open={open}>Principal</SectionTitle>
          <NavItem to="/" icon={LayoutDashboard} label="Tableau de bord" end open={open} />
          <NavItem to="/resume" icon={Gauge} label="Résumé" open={open} />
          <NavItem to="/taches" icon={CheckSquare} label="Tâches" open={open} />
          <NavItem to="/planning" icon={GanttChartSquare} label="Planning annuel" open={open} />
          <NavItem to="/tutorat" icon={BookOpen} label="Tutorat" open={open} />
          <NavItem to="/evaluations" icon={ClipboardCheck} label="Évaluations" open={open} />
          <NavItem to="/incidents" icon={AlertTriangle} label="Incidents" open={open} />
          <NavItem to="/reunions" icon={Video} label="Réunions" open={open} />
          <NavItem to="/calendrier-academique" icon={CalendarOff} label="Fériés & Vacances" open={open} />

          {(isAdmin || isDirecteur || isChef) && (
            <>
              <SectionTitle open={open}>Administration</SectionTitle>
              <NavItem to="/utilisateurs" icon={Users} label="Utilisateurs" open={open} />
              <NavItem to="/poles" icon={Building2} label="Pôles & Filières" open={open} />
              {(isAdmin || isDirecteur) && (
                <NavItem to="/connexions" icon={Settings} label="Connexions" open={open} />
              )}
            </>
          )}
            </>
          )}
        </nav>

        {/* Zone utilisateur */}
        <div className={`border-t border-slate-100 p-3 ${open ? '' : 'flex flex-col items-center gap-2'}`}>
          {open ? (
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-full bg-[#1e3a5f] flex items-center justify-center text-white text-xs font-bold shrink-0">
                {user?.prenom?.[0]}{user?.nom?.[0]}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-slate-800 text-xs font-semibold truncate">{user?.prenom} {user?.nom}</p>
                <p className="text-slate-400 text-[11px] truncate">{user?.role_label || user?.role}</p>
              </div>
              <button onClick={handleLogout} className="text-slate-400 hover:text-red-500 hover:bg-red-50 p-1.5 rounded-lg transition-colors shrink-0" title="Déconnexion">
                <LogOut size={16} />
              </button>
            </div>
          ) : (
            <>
              <div className="w-9 h-9 rounded-full bg-[#1e3a5f] flex items-center justify-center text-white text-xs font-bold" title={`${user?.prenom} ${user?.nom}`}>
                {user?.prenom?.[0]}{user?.nom?.[0]}
              </div>
              <button onClick={handleLogout} className="text-slate-400 hover:text-red-500 hover:bg-red-50 p-1.5 rounded-lg transition-colors" title="Déconnexion">
                <LogOut size={16} />
              </button>
            </>
          )}
        </div>
      </aside>

      {/* ===== Zone principale ===== */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Barre supérieure */}
        <header className="bg-white/80 backdrop-blur border-b border-slate-200 px-6 py-3 flex items-center justify-between shrink-0">
          <div className="min-w-0">
            <h1 className="text-slate-800 font-semibold text-sm truncate">Direction de la Formation et de l'Ingénierie Pédagogique</h1>
            <p className="text-slate-400 text-xs truncate">Université numérique Cheikh Hamidou KANE - UnCHK</p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <span className={`badge ${ROLE_COLORS[user?.role] || 'bg-slate-100 text-slate-700'} text-xs`}>
              {user?.role_label || user?.role}
            </span>
            <button
              onClick={() => setNotifOpen(v => !v)}
              className="relative p-2 rounded-xl hover:bg-slate-100 transition-colors"
              title="Notifications"
            >
              <Bell size={18} className="text-slate-600" />
              {notifCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[10px] min-w-4 h-4 px-0.5 rounded-full flex items-center justify-center font-semibold">
                  {notifCount > 9 ? '9+' : notifCount}
                </span>
              )}
            </button>
          </div>
        </header>

        {/* Contenu */}
        <main className="flex-1 overflow-y-auto p-6 relative">
          <div className="max-w-7xl mx-auto">
            {children}
          </div>
          {notifOpen && <NotifPanel onClose={() => setNotifOpen(false)} />}
        </main>
      </div>
    </div>
  );
}
