import { NavLink, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import {
  LayoutDashboard, CreditCard, Upload, Search, Users,
  FileText, UserCircle, LogOut, Shield, Wifi, WifiOff,
  PanelLeftClose, PanelLeftOpen
} from 'lucide-react';
import { useState, useEffect } from 'react';

const getNavItemsForRole = (role?: string) => {
  if (!role) return [];

  const baseItems = [
    { label: 'Mon Profil', icon: UserCircle, path: '/profile' },
  ];

  if (role === 'SUPER ADMIN' || role === 'ADMINISTRATEUR') {
    return [
      { label: 'Tableau de bord', icon: LayoutDashboard, path: '/dashboard' },
      { label: 'Cartes CMU', icon: CreditCard, path: '/cartes' },
      { label: 'Importation', icon: Upload, path: '/import' },
      { label: 'Recherche Globale', icon: Search, path: '/search' },
      { label: 'Agents', icon: Users, path: '/agents' },
      { label: 'Journaux', icon: FileText, path: '/logs' },
      ...baseItems
    ];
  }

  if (role === 'EDITEUR') {
    return [
      { label: 'Assainissement', icon: FileText, path: '/editeur/mission1' },
      { label: 'Cartes CMU', icon: CreditCard, path: '/cartes' },
      { label: 'Recherche', icon: Search, path: '/search' },
      ...baseItems
    ];
  }

  if (role === 'AJOUTANT') {
    return [
      { label: 'Nouvelle Saisie', icon: FileText, path: '/ajoutant/saisie' },
      { label: 'Recherche', icon: Search, path: '/search' },
      ...baseItems
    ];
  }

  if (role === 'CONSULTANT') {
    return [
      { label: 'Recherche CMU', icon: Search, path: '/consultant/recherche' },
      ...baseItems
    ];
  }

  return baseItems;
};

export default function Sidebar() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isCollapsed, setIsCollapsed] = useState(false);

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
    <aside className={`sidebar ${isCollapsed ? 'collapsed' : ''}`}>
      <div className="sidebar-header" style={{ display: 'flex', justifyContent: isCollapsed ? 'center' : 'space-between', alignItems: 'center', width: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div className="sidebar-logo">GI</div>
          <div className="sidebar-text">
            <div className="sidebar-title">GEST-IN-SITU</div>
            <div className="sidebar-subtitle">Cartes CMU</div>
          </div>
        </div>
        <button 
          className="sidebar-toggle-btn" 
          onClick={() => setIsCollapsed(!isCollapsed)}
          title={isCollapsed ? "Ouvrir le menu" : "Réduire le menu"}
        >
          {isCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
        </button>
      </div>

      <div className="sidebar-user">
        <div style={{ position: 'relative' }}>
          <div className="sidebar-avatar">{initials}</div>
          <div className="online-dot" />
        </div>
        <div className="sidebar-text">
          <div className="sidebar-user-name">{user?.nom_user || user?.login}</div>
          <span className="sidebar-user-role">{user?.role}</span>
        </div>
      </div>

      <nav className="sidebar-nav">
        <div className="sidebar-section-label sidebar-text">Navigation</div>
        {getNavItemsForRole(user?.role).map((item) => {
          const Icon = item.icon;
          return (
            <NavLink key={item.path} to={item.path} end={item.path === '/dashboard'}
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
              title={isCollapsed ? item.label : undefined}
            >
              <Icon />
              <span className="sidebar-text">{item.label}</span>
            </NavLink>
          );
        })}
      </nav>

      <div className="sidebar-footer">
        <div className="sync-indicator" style={{ marginBottom: 12 }} title={isOnline ? 'En ligne' : 'Hors ligne'}>
          {isOnline ? <Wifi size={14} color="var(--accent-green)" /> : <WifiOff size={14} color="var(--accent-red)" />}
          <span className="sidebar-text" style={{ color: isOnline ? 'var(--accent-green)' : 'var(--accent-red)' }}>
            {isOnline ? 'En ligne' : 'Hors ligne'}
          </span>
        </div>
        <button className="btn-logout" onClick={handleLogout} title={isCollapsed ? "Déconnexion" : undefined}>
          <LogOut size={16} />
          <span className="sidebar-text">Déconnexion</span>
        </button>
      </div>
    </aside>
  );
}
