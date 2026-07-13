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

      <Route path="/" element={
        <ProtectedRoute>
          <Layout><Dashboard /></Layout>
        </ProtectedRoute>
      } />
      <Route path="/taches" element={
        <ProtectedRoute>
          <Layout><Taches /></Layout>
        </ProtectedRoute>
      } />
      <Route path="/tutorat" element={
        <ProtectedRoute>
          <Layout><Tutorat /></Layout>
        </ProtectedRoute>
      } />
      <Route path="/evaluations" element={
        <ProtectedRoute>
          <Layout><Evaluations /></Layout>
        </ProtectedRoute>
      } />
      {/* Anciennes URLs : redirections */}
      <Route path="/examens" element={<Navigate to="/evaluations" replace />} />
      <Route path="/sessions" element={<Navigate to="/evaluations" replace />} />
      <Route path="/calendriers" element={<Navigate to="/" replace />} />
      <Route path="/incidents" element={
        <ProtectedRoute>
          <Layout><Incidents /></Layout>
        </ProtectedRoute>
      } />
      <Route path="/reunions" element={
        <ProtectedRoute>
          <Layout><Reunions /></Layout>
        </ProtectedRoute>
      } />
      <Route path="/calendrier-academique" element={
        <ProtectedRoute>
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
