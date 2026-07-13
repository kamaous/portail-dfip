import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import ChangePassword from './pages/ChangePassword';
import Dashboard from './pages/Dashboard';
import Taches from './pages/Taches';
import Incidents from './pages/Incidents';
import Tutorat from './pages/Tutorat';
import Evaluations from './pages/Evaluations';
import Reunions from './pages/Reunions';
import Resume from './pages/Resume';
import PlanningPublic from './pages/PlanningPublic';

// Rôles « visiteurs » : lecture seule du planning annuel uniquement
export const ROLES_VISITEURS = ['RECTEUR', 'VICE_RECTEUR', 'DIRECTEUR_DES', 'SCOLARITE', 'MEMBRE_POLE', 'ENSEIGNANT', 'ETUDIANT'];
const ROLES_METIER = ['DIRECTEUR', 'ADMIN_PORTAIL', 'CHEF_SERVICE', 'CHEF_DIV_TECHNOPEDAGOGIE', 'CHEF_DIV_EVALUATION', 'RESPONSABLE_POLE', 'RESPONSABLE_PEDAGOGIQUE', 'RESPONSABLE_FORMATION'];
import CalendrierAcademique from './pages/CalendrierAcademique';
import PlanningAnnuel from './pages/PlanningAnnuel';
import Utilisateurs from './pages/Utilisateurs';
import Poles from './pages/Poles';
import Connexions from './pages/Connexions';

function ProtectedRoute({ children, roles }) {
  const { user, loading } = useAuth();

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100">
      <div className="w-10 h-10 border-4 border-[#1e3a5f] border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />;
  return children;
}

function AppRoutes() {
  const { user } = useAuth();

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/changer-mot-de-passe" element={
        <ProtectedRoute><ChangePassword /></ProtectedRoute>
      } />

      {/* Accès PUBLIC (sans compte) : planning annuel en lecture seule */}
      <Route path="/public" element={<PlanningPublic />} />

      <Route path="/" element={
        <ProtectedRoute>
          {ROLES_VISITEURS.includes(user?.role)
            ? <Navigate to="/planning" replace />
            : <Layout><Dashboard /></Layout>}
        </ProtectedRoute>
      } />
      <Route path="/resume" element={
        <ProtectedRoute roles={ROLES_METIER}>
          <Layout><Resume /></Layout>
        </ProtectedRoute>
      } />
      <Route path="/taches" element={
        <ProtectedRoute roles={ROLES_METIER}>
          <Layout><Taches /></Layout>
        </ProtectedRoute>
      } />
      <Route path="/tutorat" element={
        <ProtectedRoute roles={ROLES_METIER}>
          <Layout><Tutorat /></Layout>
        </ProtectedRoute>
      } />
      <Route path="/evaluations" element={
        <ProtectedRoute roles={ROLES_METIER}>
          <Layout><Evaluations /></Layout>
        </ProtectedRoute>
      } />
      {/* Anciennes URLs : redirections */}
      <Route path="/examens" element={<Navigate to="/evaluations" replace />} />
      <Route path="/sessions" element={<Navigate to="/evaluations" replace />} />
      <Route path="/calendriers" element={<Navigate to="/" replace />} />
      <Route path="/incidents" element={
        <ProtectedRoute roles={ROLES_METIER}>
          <Layout><Incidents /></Layout>
        </ProtectedRoute>
      } />
      <Route path="/reunions" element={
        <ProtectedRoute roles={ROLES_METIER}>
          <Layout><Reunions /></Layout>
        </ProtectedRoute>
      } />
      <Route path="/calendrier-academique" element={
        <ProtectedRoute roles={ROLES_METIER}>
          <Layout><CalendrierAcademique /></Layout>
        </ProtectedRoute>
      } />
      <Route path="/planning" element={
        <ProtectedRoute>
          <Layout><PlanningAnnuel /></Layout>
        </ProtectedRoute>
      } />
      <Route path="/utilisateurs" element={
        <ProtectedRoute roles={['DIRECTEUR', 'CHEF_SERVICE', 'ADMIN_PORTAIL']}>
          <Layout><Utilisateurs /></Layout>
        </ProtectedRoute>
      } />
      <Route path="/poles" element={
        <ProtectedRoute>
          <Layout><Poles /></Layout>
        </ProtectedRoute>
      } />
      <Route path="/connexions" element={
        <ProtectedRoute roles={['DIRECTEUR', 'ADMIN_PORTAIL']}>
          <Layout><Connexions /></Layout>
        </ProtectedRoute>
      } />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
        <Toaster position="top-right" toastOptions={{
          className: 'text-sm',
          style: { borderRadius: '10px', fontFamily: 'Inter, system-ui, sans-serif' }
        }} />
      </AuthProvider>
    </BrowserRouter>
  );
}
