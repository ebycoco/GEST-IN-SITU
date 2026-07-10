import { NavLink, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import {
  LayoutDashboard, CreditCard, Upload, Search, Users,
  FileText, UserCircle, LogOut, Shield, Wifi, WifiOff,
  PanelLeftClose, PanelLeftOpen, Clock, MapPin, X, Download, Package, Activity, ShieldCheck, BarChart2
} from 'lucide-react';
import { useState, useEffect } from 'react';

const getNavItemsForRole = (role?: string) => {
  if (!role) return [];

  const baseItems = [
    { label: 'Mon Profil', icon: UserCircle, path: '/profile' },
  ];

  if (role === 'SUPER ADMIN' || role === 'ADMINISTRATEUR_SITE') {
    const adminItems = [
      { label: 'Tableau de bord', icon: LayoutDashboard, path: '/dashboard' },
      { label: 'Cartes CMU', icon: CreditCard, path: '/cartes' },
      { label: 'Recherche CMU', icon: Search, path: '/verification/recherche' },
      { label: 'Nouvelle Saisie', icon: FileText, path: '/saisie' },
      { label: 'Classement Logistique', icon: Package, path: '/logistique' },
      { label: 'Apurement Inventaire', icon: Clock, path: '/inventaire' },
      { label: 'Qualité & Assainissement', icon: ShieldCheck, path: '/qualite' },
      { label: 'Importation', icon: Upload, path: '/import' },
      { label: 'File d\'attente', icon: Clock, path: '/admin/queue' },
    ];

    if (role === 'SUPER ADMIN') {
      adminItems.push({ label: 'Infrastructures', icon: MapPin, path: '/sites' });
    }

    return [
      ...adminItems,
      { label: 'Agents', icon: Users, path: '/agents' },
      { label: 'Suivi des Retraits', icon: BarChart2, path: '/retraits' },
      { label: 'Journaux', icon: FileText, path: '/logs' },
      ...baseItems
    ];
  }

  if (role === 'OPERATEUR_QUALITE') {
    return [
      { label: 'Qualité & Assainissement', icon: ShieldCheck, path: '/qualite' },
      { label: 'Cartes CMU', icon: CreditCard, path: '/cartes' },
      { label: 'Recherche', icon: Search, path: '/search' },
      ...baseItems
    ];
  }

  if (role === 'OPERATEUR_SAISIE') {
    return [
      { label: 'Tableau de bord', icon: Activity, path: '/dashboard' },
      { label: 'Nouvelle Saisie', icon: FileText, path: '/saisie' },
      { label: 'Recherche', icon: Search, path: '/search' },
      ...baseItems
    ];
  }

  if (role === 'OPERATEUR_LOGISTIQUE') {
    return [
      { label: 'Classement Logistique', icon: Package, path: '/logistique' },
      ...baseItems
    ];
  }

  if (role === 'OPERATEUR_INVENTAIRE') {
    return [
      { label: 'Apurement Inventaire', icon: Clock, path: '/inventaire' },
      ...baseItems
    ];
  }

  if (role === 'OPERATEUR_VERIFICATION') {
    return [
      { label: 'Recherche CMU', icon: Search, path: '/verification/recherche' },
      ...baseItems
    ];
  }

  if (role === 'ADMIN_CENTRE') {
    return [
      { label: 'Tableau de bord Centre', icon: LayoutDashboard, path: '/centre/dashboard' },
      { label: 'Suivi des Retraits',     icon: BarChart2,        path: '/retraits' },
      { label: 'Cartes CMU',             icon: CreditCard,       path: '/cartes' },
      { label: 'Recherche CMU',          icon: Search,           path: '/verification/recherche' },
      { label: 'Journaux',               icon: FileText,         path: '/logs' },
      ...baseItems,
    ];
  }

  return baseItems;
};

export default function Sidebar() {
  const user = useAuthStore((s) => s.user);
  const activeSiteId = useAuthStore((s) => s.activeSiteId);
  const setActiveSiteId = useAuthStore((s) => s.setActiveSiteId);
  const logout = useAuthStore((s) => s.logout);
  const initialDataLoading = useAuthStore((s) => s.initialDataLoading);
  const navigate = useNavigate();
  
  const [sites, setSites] = useState<any[]>([]);
  const [sitesLoaded, setSitesLoaded] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isCollapsed, setIsCollapsed] = useState(false);

  const [appVersion, setAppVersion] = useState('1.0.0');
  const [appName, setAppName] = useState('GESTION CARTES IN-SITU');

  useEffect(() => {
    if (window.api?.app?.getVersion) {
      window.api.app.getVersion().then(setAppVersion).catch(console.error);
    }
    if (window.api?.app?.getName) {
      window.api.app.getName().then((name) => {
        if (name) {
          setAppName(name.toUpperCase().replace(/_/g, '-'));
        }
      }).catch(console.error);
    }
  }, []);

  useEffect(() => {
    if (window.api?.hierarchy?.getSites) {
      window.api.hierarchy.getSites()
        .then((data) => {
          setSites(data);
          setSitesLoaded(true);
        })
        .catch((err) => {
          console.error(err);
          setSitesLoaded(true); // Marquer comme chargé même en cas d'erreur pour ne pas rester bloqué
        });
    } else {
      setSitesLoaded(true); // API absente (ex: dev sans contexte Electron)
    }
  }, []);

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

  const currentSiteId = user?.role === 'SUPER ADMIN' ? activeSiteId : user?.site_id;
  const currentSite = sites.find(s => s.id === currentSiteId);
  const siteName = currentSite ? currentSite.nom : '';
  // Affiche un libellé de chargement tant que les sites n'ont pas été reçus depuis SQLite,
  // puis le nom du site s'il est trouvé, ou un libellé neutre si aucun site n'est associé.
  const displayTitle = !sitesLoaded
    ? '⏳ Chargement...'
    : siteName
      ? `IN-SITU - ${siteName}`
      : 'IN-SITU';
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
          { label: 'Recherche CMU', icon: Search, path: '/verification/recherche' },
          { label: 'Nouvelle Saisie', icon: FileText, path: '/saisie' },
          { label: 'Classement Logistique', icon: Package, path: '/logistique' },
          { label: 'Apurement Inventaire', icon: Clock, path: '/inventaire' },
          { label: 'Qualité & Assainissement', icon: ShieldCheck, path: '/qualite' },
          { label: 'Importation', icon: Upload, path: '/import' },
          { label: 'Exportation', icon: Download, path: '/export' },
          { label: 'File d\'attente', icon: Clock, path: '/admin/queue' }
        );
        items.push(
          { label: 'Agents', icon: Users, path: '/agents' },
          { label: 'Suivi des Retraits', icon: BarChart2, path: '/retraits' },
          { label: 'Journaux', icon: FileText, path: '/logs' }
        );
      }
      return items;
    }

    if (user.role === 'ADMINISTRATEUR_SITE') {
      return [
        { label: 'Tableau de bord', icon: LayoutDashboard, path: '/dashboard' },
        { label: 'Cartes CMU', icon: CreditCard, path: '/cartes' },
        { label: 'Recherche CMU', icon: Search, path: '/verification/recherche' },
        { label: 'Nouvelle Saisie', icon: FileText, path: '/saisie' },
        { label: 'Classement Logistique', icon: Package, path: '/logistique' },
        { label: 'Apurement Inventaire', icon: Clock, path: '/inventaire' },
        { label: 'Qualité & Assainissement', icon: ShieldCheck, path: '/qualite' },
        { label: 'Importation', icon: Upload, path: '/import' },
        { label: 'Exportation', icon: Download, path: '/export' },
        { label: 'File d\'attente', icon: Clock, path: '/admin/queue' },
        { label: 'Infrastructures', icon: MapPin, path: '/sites' },
        { label: 'Agents', icon: Users, path: '/agents' },
        { label: 'Suivi des Retraits', icon: BarChart2, path: '/retraits' },
        { label: 'Journaux', icon: FileText, path: '/logs' },
        ...baseItems.filter(i => i.path === '/profile')
      ];
    }

    if (user.role === 'ADMIN_CENTRE') {
      return [
        { label: 'Tableau de bord', icon: LayoutDashboard, path: '/centre/dashboard' },
        { label: 'Suivi des Retraits', icon: BarChart2, path: '/retraits' },
        { label: 'Cartes CMU', icon: CreditCard, path: '/cartes' },
        { label: 'Recherche CMU', icon: Search, path: '/verification/recherche' },
        { label: 'Journaux', icon: FileText, path: '/logs' },
        ...baseItems.filter(i => i.path === '/profile')
      ];
    }

    // Autres rôles...
    if (user.role === 'OPERATEUR_QUALITE') {
      return [
        { label: 'Qualité & Assainissement', icon: ShieldCheck, path: '/qualite' },
        { label: 'Cartes CMU', icon: CreditCard, path: '/cartes' },
        { label: 'Recherche', icon: Search, path: '/verification/recherche' },
        ...baseItems.filter(i => i.path === '/profile')
      ];
    }
    if (user.role === 'OPERATEUR_SAISIE') {
      return [
        { label: 'Tableau de bord', icon: Activity, path: '/dashboard' },
        { label: 'Nouvelle Saisie', icon: FileText, path: '/saisie' },
        { label: 'Recherche', icon: Search, path: '/verification/recherche' },
        ...baseItems.filter(i => i.path === '/profile')
      ];
    }
    if (user.role === 'OPERATEUR_LOGISTIQUE') {
      return [
        { label: 'Classement Logistique', icon: Package, path: '/logistique' },
        ...baseItems.filter(i => i.path === '/profile')
      ];
    }
    if (user.role === 'OPERATEUR_INVENTAIRE') {
      return [
        { label: 'Apurement Inventaire', icon: Clock, path: '/inventaire' },
        ...baseItems.filter(i => i.path === '/profile')
      ];
    }
    if (user.role === 'OPERATEUR_VERIFICATION') {
      return [
        { label: 'Recherche CMU', icon: Search, path: '/verification/recherche' },
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
            <div 
              className="sidebar-title text-sm xl:text-base font-bold uppercase truncate block max-w-full"
              style={{
                fontSize: 'clamp(12px, 1.2vw, 15px)',
                fontWeight: 700,
                textTransform: 'uppercase',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                display: 'block',
                maxWidth: '100%'
              }}
              title={displayTitle}
            >
              {displayTitle}
            </div>
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
        {user?.role === 'SUPER ADMIN' && !activeSiteId && !isCollapsed && (
          <div style={{ margin: '8px 16px 16px', padding: '12px', borderRadius: '12px', background: 'rgba(241, 196, 15, 0.08)', border: '1px dashed rgba(241, 196, 15, 0.25)', color: '#f39c12', fontSize: '11px', lineHeight: '1.4', fontWeight: 600 }}>
            ⚠️ Sélectionnez un site ci-dessus pour activer les modules de gestion (Cartes, Saisie, Agents, Import...).
          </div>
        )}
        {getNavItems().map((item) => {
          const Icon = item.icon;
          return (
            <NavLink 
              key={item.path} 
              to={initialDataLoading ? "#" : item.path} 
              end={item.path === '/dashboard'}
              onClick={(e) => {
                if (initialDataLoading) {
                  e.preventDefault();
                }
              }}
              className={({ isActive }) => `nav-item ${isActive && !initialDataLoading ? 'active' : ''}`}
              style={{
                opacity: initialDataLoading ? 0.45 : 1,
                cursor: initialDataLoading ? 'not-allowed' : 'pointer',
                pointerEvents: initialDataLoading ? 'none' : 'auto',
                transition: 'all 0.2s ease-in-out'
              }}
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
        {!isCollapsed && (
          <div style={{ 
            textAlign: 'center', 
            marginTop: 16, 
            fontSize: '9px', 
            color: 'var(--text-muted)', 
            opacity: 0.5,
            lineHeight: '1.4',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            maxWidth: '100%'
          }} title={`GEST-IN-SITU v${appVersion} - © Ebychoco 2026 - Tous droits réservés`}>
            GEST-IN-SITU v{appVersion}<br />
            © Ebychoco 2026 - Tous droits réservés
          </div>
        )}
      </div>
    </aside>
  );
}
