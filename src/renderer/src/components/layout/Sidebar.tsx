import { NavLink, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import {
  LayoutDashboard, CreditCard, Upload, Search, Users,
  FileText, UserCircle, LogOut, Shield, Wifi, WifiOff
} from 'lucide-react';
import { useState, useEffect } from 'react';

const navItems = [
  { label: 'Tableau de bord', icon: LayoutDashboard, path: '/' },
  { label: 'Cartes CMU', icon: CreditCard, path: '/cartes' },
  { label: 'Importation', icon: Upload, path: '/import', roles: ['SUPER ADMIN', 'ADMINISTRATEUR'] },
  { label: 'Recherche', icon: Search, path: '/search' },
  { label: 'Agents', icon: Users, path: '/agents', roles: ['SUPER ADMIN', 'ADMINISTRATEUR'] },
  { label: 'Journaux', icon: FileText, path: '/logs', roles: ['SUPER ADMIN', 'ADMINISTRATEUR'] },
  { label: 'Mon Profil', icon: UserCircle, path: '/profile' },
];

export default function Sidebar() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const on = () => setIsOnline(true);
    const off = () => setIsOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const initials = user ? (user.nom_user || user.login).slice(0, 2).toUpperCase() : 'GI';

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-logo">GI</div>
        <div>
          <div className="sidebar-title">GEST-IN-SITU</div>
          <div className="sidebar-subtitle">Cartes CMU</div>
        </div>
      </div>

      <div className="sidebar-user">
        <div style={{ position: 'relative' }}>
          <div className="sidebar-avatar">{initials}</div>
          <div className="online-dot" />
        </div>
        <div>
          <div className="sidebar-user-name">{user?.nom_user || user?.login}</div>
          <span className="sidebar-user-role">{user?.role}</span>
        </div>
      </div>

      <nav className="sidebar-nav">
        <div className="sidebar-section-label">Navigation</div>
        {navItems.map((item) => {
          if (item.roles && user && !item.roles.includes(user.role)) return null;
          const Icon = item.icon;
          return (
            <NavLink key={item.path} to={item.path} end={item.path === '/'}
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
              <Icon />
              <span>{item.label}</span>
            </NavLink>
          );
        })}
      </nav>

      <div className="sidebar-footer">
        <div className="sync-indicator" style={{ marginBottom: 12 }}>
          {isOnline ? <Wifi size={14} color="var(--accent-green)" /> : <WifiOff size={14} color="var(--accent-red)" />}
          <span style={{ color: isOnline ? 'var(--accent-green)' : 'var(--accent-red)' }}>
            {isOnline ? 'En ligne' : 'Hors ligne'}
          </span>
        </div>
        <button className="btn-logout" onClick={handleLogout}>
          <LogOut size={16} />
          <span>Déconnexion</span>
        </button>
      </div>
    </aside>
  );
}
