import { NavLink, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import {
  LayoutDashboard, CreditCard, Upload, Search, Users,
  FileText, UserCircle, LogOut, Shield, Wifi, WifiOff,
  PanelLeftClose, PanelLeftOpen, Clock, MapPin, X
} from 'lucide-react';
import { useState, useEffect } from 'react';

const getNavItemsForRole = (role?: string) => {
  if (!role) return [];

  const baseItems = [
    { label: 'Mon Profil', icon: UserCircle, path: '/profile' },
  ];

  if (role === 'SUPER ADMIN' || role === 'ADMINISTRATEUR') {
    const adminItems = [
      { label: 'Tableau de bord', icon: LayoutDashboard, path: '/dashboard' },
      { label: 'Cartes CMU', icon: CreditCard, path: '/cartes' },
      { label: 'Recherche CMU', icon: Search, path: '/consultant/recherche' },
      { label: 'Nouvelle Saisie', icon: FileText, path: '/ajoutant/saisie' },
      { label: 'Assainissement', icon: Clock, path: '/editeur/mission1' },
      { label: 'Importation', icon: Upload, path: '/import' },
      { label: 'File d\'attente', icon: Clock, path: '/admin/queue' },
    ];

    if (role === 'SUPER ADMIN') {
      adminItems.push({ label: 'Infrastructures', icon: MapPin, path: '/sites' });
    }

    return [
      ...adminItems,
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
  const activeSiteId = useAuthStore((s) => s.activeSiteId);
  const setActiveSiteId = useAuthStore((s) => s.setActiveSiteId);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();
  
  const [sites, setSites] = useState<any[]>([]);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isCollapsed, setIsCollapsed] = useState(false);

  useEffect(() => {
    if (user?.role === 'SUPER ADMIN') {
      window.api.hierarchy.getSites().then(setSites);
    }
  }, [user]);

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

  const currentSite = sites.find(s => s.id === activeSiteId);
  const initials = user ? (user.nom_user || user.login).slice(0, 2).toUpperCase() : 'GI';

  // Navigation Items Logic
  const getNavItems = () => {
    if (!user) return [];

    const baseItems = [
      { label: 'Tableau de bord', icon: LayoutDashboard, path: '/dashboard' },
      { label: 'Mon Profil', icon: UserCircle, path: '/profile' },
    ];

    if (user.role === 'SUPER ADMIN') {
      const items = [...baseItems];
      items.push({ label: 'Infrastructures', icon: MapPin, path: '/sites' });

      // Si un site est sélectionné, on débloque tout
      if (activeSiteId) {
        items.splice(1, 0, 
          { label: 'Cartes CMU', icon: CreditCard, path: '/cartes' },
          { label: 'Recherche CMU', icon: Search, path: '/consultant/recherche' },
          { label: 'Nouvelle Saisie', icon: FileText, path: '/ajoutant/saisie' },
          { label: 'Assainissement', icon: Clock, path: '/editeur/mission1' },
          { label: 'Importation', icon: Upload, path: '/import' },
          { label: 'File d\'attente', icon: Clock, path: '/admin/queue' }
        );
        items.push(
          { label: 'Agents', icon: Users, path: '/agents' },
          { label: 'Journaux', icon: FileText, path: '/logs' }
        );
      }
      return items;
    }

    if (user.role === 'ADMINISTRATEUR') {
      return [
        { label: 'Tableau de bord', icon: LayoutDashboard, path: '/dashboard' },
        { label: 'Cartes CMU', icon: CreditCard, path: '/cartes' },
        { label: 'Recherche CMU', icon: Search, path: '/consultant/recherche' },
        { label: 'Nouvelle Saisie', icon: FileText, path: '/ajoutant/saisie' },
        { label: 'Assainissement', icon: Clock, path: '/editeur/mission1' },
        { label: 'Importation', icon: Upload, path: '/import' },
        { label: 'File d\'attente', icon: Clock, path: '/admin/queue' },
        { label: 'Agents', icon: Users, path: '/agents' },
        { label: 'Journaux', icon: FileText, path: '/logs' },
        ...baseItems.filter(i => i.path === '/profile')
      ];
    }

    // Autres rôles...
    if (user.role === 'EDITEUR') {
      return [
        { label: 'Assainissement', icon: FileText, path: '/editeur/mission1' },
        { label: 'Cartes CMU', icon: CreditCard, path: '/cartes' },
        { label: 'Recherche', icon: Search, path: '/consultant/recherche' },
        ...baseItems.filter(i => i.path === '/profile')
      ];
    }
    if (user.role === 'AJOUTANT') {
      return [
        { label: 'Nouvelle Saisie', icon: FileText, path: '/ajoutant/saisie' },
        { label: 'Recherche', icon: Search, path: '/consultant/recherche' },
        ...baseItems.filter(i => i.path === '/profile')
      ];
    }
    if (user.role === 'CONSULTANT') {
      return [
        { label: 'Recherche CMU', icon: Search, path: '/consultant/recherche' },
        ...baseItems.filter(i => i.path === '/profile')
      ];
    }

    return baseItems;
  };

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
        <button className="sidebar-toggle-btn" onClick={() => setIsCollapsed(!isCollapsed)}>
          {isCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
        </button>
      </div>

      {/* SÉLECTEUR DE CONTEXTE SITE (POUR SUPER ADMIN) */}
      {user?.role === 'SUPER ADMIN' && !isCollapsed && (
        <div className="sidebar-context-selector">
          <div className="section-label">CONTEXTE OPÉRATIONNEL</div>
          <div className="selector-wrapper">
            <select 
              value={activeSiteId || ''} 
              onChange={(e) => setActiveSiteId(e.target.value ? parseInt(e.target.value) : null)}
              className="site-select"
            >
              <option value="">-- Sélectionner un site --</option>
              {sites.map(s => (
                <option key={s.id} value={s.id}>{s.nom}</option>
              ))}
            </select>
            {activeSiteId && (
              <button className="clear-site" onClick={() => setActiveSiteId(null)} title="Quitter le mode site">
                <X size={14} />
              </button>
            )}
          </div>
          {activeSiteId && (
            <div className="active-site-badge">
              <div className="pulse-dot" />
              MODE : {currentSite?.nom}
            </div>
          )}
        </div>
      )}

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
        {getNavItems().map((item) => {
          const Icon = item.icon;
          return (
            <NavLink key={item.path} to={item.path} end={item.path === '/dashboard'}
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            >
              <Icon size={18} />
              <span className="sidebar-text">{item.label}</span>
            </NavLink>
          );
        })}
      </nav>

      <div className="sidebar-footer">
        <div className="sync-indicator" style={{ marginBottom: 12 }}>
          {isOnline ? <Wifi size={14} color="var(--accent-green)" /> : <WifiOff size={14} color="var(--accent-red)" />}
          <span className="sidebar-text" style={{ color: isOnline ? 'var(--accent-green)' : 'var(--accent-red)' }}>
            {isOnline ? 'En ligne' : 'Hors ligne'}
          </span>
        </div>
        <button className="btn-logout" onClick={handleLogout}>
          <LogOut size={16} />
          <span className="sidebar-text">Déconnexion</span>
        </button>
      </div>
    </aside>
  );
}
