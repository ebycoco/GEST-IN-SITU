import { HashRouter, Routes, Route } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import MainLayout from './components/layout/MainLayout';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import CartesPage from './pages/CartesPage';
import ImportPage from './pages/ImportPage';
import SearchPage from './pages/SearchPage';
import AgentsPage from './pages/AgentsPage';
import LogsPage from './pages/LogsPage';
import ProfilePage from './pages/ProfilePage';
import { useAuthStore } from './stores/authStore';
import { useEffect } from 'react';

function ProtectedRoute({ children, requiredRoles }: { children: JSX.Element; requiredRoles?: string[] }) {
  const user = useAuthStore(s => s.user);
  if (!user) return <LoginPage />;
  if (requiredRoles && !requiredRoles.includes(user.role)) return <div>Accès refusé</div>;
  return children;
}

export default function App() {
  const checkAuth = useAuthStore(s => s.checkAuth);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  return (
    <>
      <Toaster position="top-right" toastOptions={{ duration: 4000, style: { background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)', borderRadius: 12 } }} />
      <HashRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          
          <Route path="/" element={<ProtectedRoute><MainLayout /></ProtectedRoute>}>
            <Route index element={<DashboardPage />} />
            <Route path="cartes" element={<CartesPage />} />
            <Route path="search" element={<SearchPage />} />
            <Route path="profile" element={<ProfilePage />} />
            
            {/* Routes Admin */}
            <Route path="import" element={<ProtectedRoute requiredRoles={['SUPER ADMIN', 'ADMINISTRATEUR']}><ImportPage /></ProtectedRoute>} />
            <Route path="agents" element={<ProtectedRoute requiredRoles={['SUPER ADMIN', 'ADMINISTRATEUR']}><AgentsPage /></ProtectedRoute>} />
            <Route path="logs" element={<ProtectedRoute requiredRoles={['SUPER ADMIN', 'ADMINISTRATEUR']}><LogsPage /></ProtectedRoute>} />
          </Route>
        </Routes>
      </HashRouter>
    </>
  );
}
