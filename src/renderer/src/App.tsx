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
import InventaireLayout from './pages/inventaire/InventaireLayout';
import AdminCentreDashboardPage from './pages/AdminCentreDashboardPage';
import RetraitsPage from './pages/RetraitsPage';
import { useAuthStore } from './stores/authStore';
import { useEffect, useState } from 'react';
import { GlobalConfirmModal } from './components/GlobalConfirmModal';
import SyncStatusDashboard from './pages/SyncStatusDashboard';
import MaintenancePage from './pages/MaintenancePage';
import { UpdateRequiredBlocker } from './components/UpdateRequiredBlocker';

// Portail Admin Centre
import AdminCentreLayout from './pages/AdminCentre/AdminCentreLayout';
import DashboardView from './pages/AdminCentre/views/DashboardView';

// Imports Portail Vérification
import AgentVerificationLayout from './pages/AgentVerification/AgentVerificationLayout';
import VerificationOverview from './pages/AgentVerification/views/Overview';
import VerificationRecherche from './pages/AgentVerification/views/RechercheView';
import VerificationSignalements from './pages/AgentVerification/views/SignalementsView';

// Agent Saisie
import AgentSaisieLayout from './pages/AgentSaisie/AgentSaisieLayout';
import SaisieOverview from './pages/AgentSaisie/views/Overview';
import NouvelleSaisieView from './pages/AgentSaisie/views/NouvelleSaisieView';
import HistoriqueView from './pages/AgentSaisie/views/HistoriqueView';
import EditSaisieView from './pages/AgentSaisie/views/EditSaisieView';

// Agent de Qualité
import AgentQualiteLayout from './pages/AgentQualite/AgentQualiteLayout';
import Overview from './pages/AgentQualite/views/Overview';
import DoublonsView from './pages/AgentQualite/views/DoublonsView';
import MissingDataView from './pages/AgentQualite/views/MissingDataView';
import InvalidFormatView from './pages/AgentQualite/views/InvalidFormatView';

function ProtectedRoute({ children, requiredRoles }: { children: React.ReactElement; requiredRoles?: string[] }) {
  const user = useAuthStore(s => s.user);
  if (!user) return <Navigate to="/login" replace />;
  if (requiredRoles && !requiredRoles.includes(user.role)) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  const checkAuth = useAuthStore(s => s.checkAuth);
  const [updateInfo, setUpdateInfo] = useState<any>(null);

  useEffect(() => {
    checkAuth();

    const unsubWarning = window.api?.auth?.onAuthWarning?.((msg: string) => {
      import('react-hot-toast').then(({ toast }) => {
        toast(msg, {
          icon: '⚠️',
          duration: 10000,
        });
      });
    });

    const unsubEnforcer = window.api?.enforcer?.onUpdateRequired?.((info: any) => {
      setUpdateInfo(info);
    });

    const unsubSessionExpired = window.api?.auth?.onSessionExpired?.(() => {
      useAuthStore.getState().logout();
      alert("Votre session a été fermée car ce compte s'est connecté sur une autre machine.");
    });

    return () => {
      if (unsubWarning) unsubWarning();
      if (unsubEnforcer) unsubEnforcer();
      if (unsubSessionExpired) unsubSessionExpired();
    };
  }, [checkAuth]);

  return (
    <>
      {updateInfo && <UpdateRequiredBlocker info={updateInfo} />}
      <Toaster position="top-right" containerStyle={{ zIndex: 10000, top: 40 }} toastOptions={{ duration: 4000, style: { background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)', borderRadius: 12 } }} />
      <GlobalConfirmModal />
      <HashRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          
          <Route path="/" element={<ProtectedRoute><MainLayout /></ProtectedRoute>}>
            {/* Redirection dynamique par défaut */}
            <Route index element={<RoleRedirect />} />
            <Route path="dashboard" element={<ProtectedRoute requiredRoles={['SUPER ADMIN', 'ADMINISTRATEUR_SITE']}><DashboardPage /></ProtectedRoute>} />
            <Route path="centre/dashboard" element={<ProtectedRoute requiredRoles={['SUPER ADMIN', 'ADMINISTRATEUR_SITE']}><AdminCentreDashboardPage /></ProtectedRoute>} />
            
            {/* Portail Admin Centre */}
            <Route path="admin-centre" element={<ProtectedRoute requiredRoles={['ADMIN_CENTRE']}><AdminCentreLayout /></ProtectedRoute>}>
              <Route index element={<DashboardView />} />
              <Route path="cartes" element={<CartesPage />} />
              <Route path="recherche" element={<VerificationSearchPage />} />
              <Route path="retraits" element={<RetraitsPage />} />
              <Route path="queue" element={<AdminQueuePage />} />
              <Route path="logs" element={<LogsPage />} />
            </Route>

            {/* Routes Opérateur de Vérification & Admin */}
            <Route path="agent-verification" element={<ProtectedRoute requiredRoles={['OPERATEUR_VERIFICATION', 'SUPER ADMIN', 'ADMINISTRATEUR_SITE', 'ADMIN_CENTRE']}><AgentVerificationLayout /></ProtectedRoute>}>
              <Route index element={<VerificationOverview />} />
              <Route path="recherche" element={<VerificationRecherche />} />
              <Route path="signalements" element={<VerificationSignalements />} />
            </Route>

            {/* Routes Opérateur de Saisie & Admin */}
            <Route path="agent-saisie" element={<ProtectedRoute requiredRoles={['OPERATEUR_SAISIE', 'SUPER ADMIN', 'ADMINISTRATEUR_SITE']}><AgentSaisieLayout /></ProtectedRoute>}>
              <Route index element={<SaisieOverview />} />
              <Route path="nouvelle" element={<NouvelleSaisieView />} />
              <Route path="historique" element={<HistoriqueView />} />
              <Route path="edit/:id" element={<EditSaisieView />} />
            </Route>

            {/* Routes Opérateur Logistique & Inventaire (Hub 3-en-1) */}
            <Route path="inventaire" element={<ProtectedRoute requiredRoles={['SUPER ADMIN', 'ADMINISTRATEUR_SITE', 'OPERATEUR_INVENTAIRE', 'OPERATEUR_LOGISTIQUE']}><InventaireLayout /></ProtectedRoute>} />

            {/* Routes Agent de Qualité & Admin */}
            <Route path="agent-qualite" element={<ProtectedRoute requiredRoles={['OPERATEUR_QUALITE', 'SUPER ADMIN', 'ADMINISTRATEUR_SITE']}><AgentQualiteLayout /></ProtectedRoute>}>
              <Route index element={<Overview />} />
              <Route path="doublons" element={<DoublonsView />} />
              <Route path="manquants" element={<MissingDataView />} />
              <Route path="invalides" element={<InvalidFormatView />} />
            </Route>

            {/* Routes Transversales */}
            <Route path="cartes" element={<ProtectedRoute requiredRoles={['SUPER ADMIN', 'ADMINISTRATEUR_SITE', 'ADMIN_CENTRE', 'OPERATEUR_QUALITE', 'OPERATEUR_SAISIE']}><CartesPage /></ProtectedRoute>} />
            <Route path="search" element={<SearchPage />} />
            <Route path="profile" element={<ProfilePage />} />
            
            {/* Routes Admin */}
            <Route path="import" element={<ProtectedRoute requiredRoles={['SUPER ADMIN', 'ADMINISTRATEUR_SITE']}><ImportPage /></ProtectedRoute>} />
            <Route path="agents" element={<ProtectedRoute requiredRoles={['SUPER ADMIN', 'ADMINISTRATEUR_SITE']}><AgentsPage /></ProtectedRoute>} />
            <Route path="sites" element={<ProtectedRoute requiredRoles={['SUPER ADMIN', 'ADMINISTRATEUR_SITE']}><SitesPage /></ProtectedRoute>} />
            <Route path="export" element={<ProtectedRoute requiredRoles={['SUPER ADMIN', 'ADMINISTRATEUR_SITE']}><ExportPage /></ProtectedRoute>} />
            <Route path="admin/queue" element={<ProtectedRoute requiredRoles={['SUPER ADMIN', 'ADMINISTRATEUR_SITE', 'ADMIN_CENTRE']}><AdminQueuePage /></ProtectedRoute>} />
            <Route path="sync/status" element={<ProtectedRoute requiredRoles={['SUPER ADMIN', 'ADMINISTRATEUR_SITE']}><SyncStatusDashboard /></ProtectedRoute>} />
            <Route path="maintenance" element={<ProtectedRoute requiredRoles={['SUPER ADMIN']}><MaintenancePage /></ProtectedRoute>} />
            <Route path="logs" element={<ProtectedRoute requiredRoles={['SUPER ADMIN', 'ADMINISTRATEUR_SITE', 'ADMIN_CENTRE']}><LogsPage /></ProtectedRoute>} />
            <Route path="retraits" element={<ProtectedRoute requiredRoles={['SUPER ADMIN', 'ADMINISTRATEUR_SITE', 'ADMIN_CENTRE']}><RetraitsPage /></ProtectedRoute>} />
          </Route>
        </Routes>
      </HashRouter>
    </>
  );
}
