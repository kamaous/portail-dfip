import { useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  LayoutDashboard, Users, CheckSquare, BookOpen, ClipboardList,
  AlertTriangle, Bell, LogOut, Settings,
  Building2, Calendar, ClipboardCheck, CalendarOff, Video,
  PanelLeftClose, PanelLeftOpen, GanttChartSquare, Gauge, BarChart3, Menu
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

/* Sur mobile, le tiroir de navigation est toujours affiché « déployé » (icône + libellé),
   quel que soit l'état `open` du repli bureau — seul le bureau (md+) applique le mode icônes seules. */
function NavItem({ to, icon: Icon, label, end, open }) {
  return (
    <NavLink
      to={to}
      end={end}
      title={open ? undefined : label}
      className={({ isActive }) =>
        `flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 ${
          open ? '' : 'md:justify-center md:gap-0 md:px-0 md:w-11 md:mx-auto'
        } ${
          isActive
            ? 'bg-[#1e3a5f] text-white shadow-sm shadow-blue-900/20'
            : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
        }`
      }
    >
      <Icon size={19} className="shrink-0" />
      <span className={`truncate ${open ? '' : 'md:hidden'}`}>{label}</span>
    </NavLink>
  );
}

function SectionTitle({ open, children }) {
  if (!open) {
    return (
      <>
        <div className="hidden md:block h-px bg-slate-200 mx-3 my-3" />
        <p className="md:hidden text-slate-400 text-[11px] font-semibold px-3 mb-1.5 mt-5 first:mt-1 uppercase tracking-wider">{children}</p>
      </>
    );
  }
  return <p className="text-slate-400 text-[11px] font-semibold px-3 mb-1.5 mt-5 first:mt-1 uppercase tracking-wider">{children}</p>;
}

export default function Layout({ children }) {
  const { user, logout, notifCount } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(true);       // repli/déploiement (bureau uniquement)
  const [mobileOpen, setMobileOpen] = useState(false); // tiroir de navigation (mobile/tablette)
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
      {/* Rideau semi-transparent derrière le tiroir de navigation mobile */}
      {mobileOpen && (
        <div className="fixed inset-0 bg-black/40 z-40 md:hidden" onClick={() => setMobileOpen(false)} />
      )}

      {/* ===== Barre latérale ===== */}
      {/* Mobile/tablette : tiroir hors-écran (fixed, glisse depuis la gauche). Bureau (md+) : colonne fixe, repliable. */}
      <aside className={`flex flex-col transition-transform md:transition-all duration-300 w-64 ${open ? 'md:w-64' : 'md:w-[72px]'}
        fixed md:relative inset-y-0 left-0 z-50 md:z-auto ${mobileOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0
        bg-white border-r border-slate-200 shrink-0`}>
        {/* Logo (cliquable → tableau de bord) */}
        <div className={`flex items-center py-4 border-b border-slate-100 px-4 gap-3 ${open ? 'md:px-4 md:gap-3' : 'md:flex-col md:gap-2 md:px-0'}`}>
          <Link to="/" onClick={() => setMobileOpen(false)} className={`flex items-center min-w-0 gap-2.5 flex-1 ${open ? '' : 'md:gap-0 md:flex-none'}`} title="Tableau de bord">
            <img src="/dfip-icon.svg" alt="DFIP" className="w-10 h-10 rounded-xl shrink-0 shadow-md shadow-blue-900/20" />
            <div className={`min-w-0 ${open ? '' : 'md:hidden'}`}>
              <p className="text-slate-800 font-bold text-sm truncate">SUIVI PÉDAGOGIQUE</p>
              <p className="text-slate-400 text-xs truncate">UnCHK</p>
            </div>
          </Link>
          {/* Fermer le tiroir (mobile uniquement) */}
          <button
            onClick={() => setMobileOpen(false)}
            className="md:hidden text-slate-400 hover:text-slate-700 hover:bg-slate-100 p-1.5 rounded-lg shrink-0 transition-colors"
            title="Fermer le menu"
          >
            <PanelLeftClose size={18} />
          </button>
          {/* Replier/déployer (bureau uniquement) */}
          <button
            onClick={() => setOpen(v => !v)}
            className="hidden md:block text-slate-400 hover:text-slate-700 hover:bg-slate-100 p-1.5 rounded-lg shrink-0 transition-colors"
            title={open ? 'Réduire le menu' : 'Agrandir le menu'}
          >
            {open ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
          </button>
        </div>

        {/* Navigation — un clic sur un lien referme le tiroir mobile */}
        <nav onClick={() => setMobileOpen(false)} className={`flex-1 overflow-y-auto nav-scroll py-3 space-y-1 px-3 ${open ? 'md:px-3' : 'md:px-2'}`}>
          {ROLES_VISITEURS.includes(user?.role) ? (
            <>
              {/* Visiteur : consultation du planning annuel (+ validation référentiel pour le Vice-Recteur) */}
              <SectionTitle open={open}>Consultation</SectionTitle>
              <NavItem to="/planning" icon={GanttChartSquare} label="Planning annuel" open={open} />
              {user?.role === 'VICE_RECTEUR' && (
                <NavItem to="/referentiel" icon={Building2} label="Référentiel" open={open} />
              )}
            </>
          ) : user?.role === 'CHARGE_SCOLARITE' ? (
            <>
              {/* Chargé de scolarité (ENO) : capacités de son ENO + planning */}
              <SectionTitle open={open}>Mon ENO</SectionTitle>
              <NavItem to="/statistiques" icon={BarChart3} label="Statistiques (ENO)" open={open} />
              <NavItem to="/planning" icon={GanttChartSquare} label="Planning annuel" open={open} />
            </>
          ) : user?.role === 'DIRECTEUR_DEVES' ? (
            <>
              {/* Directeur DEVES : ajout et gestion des ENO + planning */}
              <SectionTitle open={open}>ENO</SectionTitle>
              <NavItem to="/statistiques" icon={BarChart3} label="Statistiques (ENO)" open={open} />
              <NavItem to="/referentiel" icon={Building2} label="Référentiel" open={open} />
              <NavItem to="/planning" icon={GanttChartSquare} label="Planning annuel" open={open} />
            </>
          ) : (
            <>
          <SectionTitle open={open}>Principal</SectionTitle>
          <NavItem to="/" icon={LayoutDashboard} label="Tableau de bord" end open={open} />
          <NavItem to="/resume" icon={Gauge} label="Résumé" open={open} />
          <NavItem to="/statistiques" icon={BarChart3} label="Statistiques" open={open} />
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
              <NavItem to="/referentiel" icon={Building2} label="Référentiel" open={open} />
              <NavItem to="/poles" icon={Building2} label="Pôles & Filières" open={open} />
              {(isAdmin || isDirecteur) && (
                <NavItem to="/connexions" icon={Settings} label="Connexions" open={open} />
              )}
            </>
          )}
            </>
          )}
        </nav>

        {/* Zone utilisateur — version complète (mobile toujours, bureau si déployé) */}
        <div className="border-t border-slate-100 p-3">
          <div className={`flex items-center gap-2.5 ${open ? '' : 'md:hidden'}`}>
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
          {/* Version compacte : bureau replié uniquement */}
          {!open && (
            <div className="hidden md:flex md:flex-col md:items-center md:gap-2">
              <div className="w-9 h-9 rounded-full bg-[#1e3a5f] flex items-center justify-center text-white text-xs font-bold" title={`${user?.prenom} ${user?.nom}`}>
                {user?.prenom?.[0]}{user?.nom?.[0]}
              </div>
              <button onClick={handleLogout} className="text-slate-400 hover:text-red-500 hover:bg-red-50 p-1.5 rounded-lg transition-colors" title="Déconnexion">
                <LogOut size={16} />
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* ===== Zone principale ===== */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Barre supérieure */}
        <header className="bg-white/80 backdrop-blur border-b border-slate-200 px-3 sm:px-6 py-3 flex items-center gap-3 justify-between shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            {/* Bouton menu (mobile/tablette uniquement) */}
            <button
              onClick={() => setMobileOpen(true)}
              className="md:hidden text-slate-500 hover:text-slate-800 hover:bg-slate-100 p-2 rounded-xl transition-colors shrink-0"
              title="Ouvrir le menu"
            >
              <Menu size={20} />
            </button>
            <div className="min-w-0">
              <h1 className="text-slate-800 font-semibold text-sm truncate">Direction de la Formation et de l'Ingénierie Pédagogique</h1>
              <p className="text-slate-400 text-xs truncate hidden sm:block">Université numérique Cheikh Hamidou KANE - UnCHK</p>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <span className={`badge ${ROLE_COLORS[user?.role] || 'bg-slate-100 text-slate-700'} text-xs hidden sm:inline-flex`}>
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
        <main className="flex-1 overflow-y-auto p-3 sm:p-6 relative">
          <div className="max-w-7xl mx-auto">
            {children}
          </div>
          {notifOpen && <NotifPanel onClose={() => setNotifOpen(false)} />}
        </main>
      </div>
    </div>
  );
}
