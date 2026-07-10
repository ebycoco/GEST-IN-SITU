import React from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import MainLayout from './components/layout/MainLayout';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/dashboard';
import CartesPage from './pages/CartesPage';
import ImportPage from './pages/ImportPage';
import SearchPage from './pages/SearchPage';
import AgentsPage from './pages/AgentsPage';
import LogsPage from './pages/LogsPage';
import ProfilePage from './pages/ProfilePage';
import SitesPage from './pages/SitesPage';
import ExportPage from './pages/ExportPage';
import RoleRedirect from './components/RoleRedirect';
import VerificationSearchPage from './pages/VerificationSearchPage';
import SaisiePage from './pages/SaisiePage';
import QualiteAssainissementPage from './pages/QualiteAssainissementPage';
import AdminQueuePage from './pages/AdminQueuePage';
import LogistiquePage from './pages/LogistiquePage';
import InventairePage from './pages/InventairePage';
import AdminCentreDashboardPage from './pages/AdminCentreDashboardPage';
import RetraitsPage from './pages/RetraitsPage';
import { useAuthStore } from './stores/authStore';
import { useEffect } from 'react';

function ProtectedRoute({ children, requiredRoles }: { children: React.ReactElement; requiredRoles?: string[] }) {
  const user = useAuthStore(s => s.user);
  if (!user) return <Navigate to="/login" replace />;
  if (requiredRoles && !requiredRoles.includes(user.role)) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  const checkAuth = useAuthStore(s => s.checkAuth);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  return (
    <>
      <Toaster position="top-right" containerStyle={{ zIndex: 10000, top: 40 }} toastOptions={{ duration: 4000, style: { background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)', borderRadius: 12 } }} />
      <HashRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          
          <Route path="/" element={<ProtectedRoute><MainLayout /></ProtectedRoute>}>
            {/* Redirection dynamique par défaut */}
            <Route index element={<RoleRedirect />} />
            <Route path="dashboard" element={<ProtectedRoute requiredRoles={['SUPER ADMIN', 'ADMINISTRATEUR_SITE', 'OPERATEUR_SAISIE']}><DashboardPage /></ProtectedRoute>} />
            <Route path="centre/dashboard" element={<ProtectedRoute requiredRoles={['SUPER ADMIN', 'ADMINISTRATEUR_SITE', 'ADMIN_CENTRE']}><AdminCentreDashboardPage /></ProtectedRoute>} />
            
            {/* Routes Opérateur de Vérification */}
            <Route path="verification/recherche" element={<ProtectedRoute requiredRoles={['SUPER ADMIN', 'ADMINISTRATEUR_SITE', 'ADMIN_CENTRE', 'OPERATEUR_VERIFICATION']}><VerificationSearchPage /></ProtectedRoute>} />

            {/* Routes Opérateur de Saisie */}
            <Route path="saisie" element={<ProtectedRoute requiredRoles={['SUPER ADMIN', 'ADMINISTRATEUR_SITE', 'OPERATEUR_SAISIE']}><SaisiePage /></ProtectedRoute>} />

            {/* Routes Opérateur Logistique */}
            <Route path="logistique" element={<ProtectedRoute requiredRoles={['SUPER ADMIN', 'ADMINISTRATEUR_SITE', 'OPERATEUR_LOGISTIQUE']}><LogistiquePage /></ProtectedRoute>} />

            {/* Routes Opérateur Inventaire */}
            <Route path="inventaire" element={<ProtectedRoute requiredRoles={['SUPER ADMIN', 'ADMINISTRATEUR_SITE', 'OPERATEUR_INVENTAIRE']}><InventairePage /></ProtectedRoute>} />

            {/* Routes Opérateur Qualité */}
            <Route path="qualite" element={<ProtectedRoute requiredRoles={['SUPER ADMIN', 'ADMINISTRATEUR_SITE', 'OPERATEUR_QUALITE']}><QualiteAssainissementPage /></ProtectedRoute>} />

            {/* Routes Transversales */}
            <Route path="cartes" element={<ProtectedRoute requiredRoles={['SUPER ADMIN', 'ADMINISTRATEUR_SITE', 'ADMIN_CENTRE', 'OPERATEUR_QUALITE', 'OPERATEUR_SAISIE']}><CartesPage /></ProtectedRoute>} />
            <Route path="search" element={<SearchPage />} />
            <Route path="profile" element={<ProfilePage />} />
            
            {/* Routes Admin */}
            <Route path="import" element={<ProtectedRoute requiredRoles={['SUPER ADMIN', 'ADMINISTRATEUR_SITE']}><ImportPage /></ProtectedRoute>} />
            <Route path="agents" element={<ProtectedRoute requiredRoles={['SUPER ADMIN', 'ADMINISTRATEUR_SITE']}><AgentsPage /></ProtectedRoute>} />
            <Route path="sites" element={<ProtectedRoute requiredRoles={['SUPER ADMIN', 'ADMINISTRATEUR_SITE']}><SitesPage /></ProtectedRoute>} />
            <Route path="export" element={<ProtectedRoute requiredRoles={['SUPER ADMIN', 'ADMINISTRATEUR_SITE']}><ExportPage /></ProtectedRoute>} />
            <Route path="admin/queue" element={<ProtectedRoute requiredRoles={['SUPER ADMIN', 'ADMINISTRATEUR_SITE']}><AdminQueuePage /></ProtectedRoute>} />
            <Route path="logs" element={<ProtectedRoute requiredRoles={['SUPER ADMIN', 'ADMINISTRATEUR_SITE', 'ADMIN_CENTRE']}><LogsPage /></ProtectedRoute>} />
            <Route path="retraits" element={<ProtectedRoute requiredRoles={['SUPER ADMIN', 'ADMINISTRATEUR_SITE', 'ADMIN_CENTRE']}><RetraitsPage /></ProtectedRoute>} />
          </Route>
        </Routes>
      </HashRouter>
    </>
  );
}
