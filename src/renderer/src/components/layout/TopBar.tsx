import { Bell, Settings, CheckCircle, AlertTriangle, RefreshCw, MapPin, ShieldAlert } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import SyncWidget from '../SyncWidget';

function ConsultantPerimeter() {
  const user = useAuthStore((s) => s.user);
  const [loading, setLoading] = useState(true);
  const [perimeter, setPerimeter] = useState<{ siteNom: string; centreNom: string } | null>(null);

  useEffect(() => {
    if (user?.role === 'CONSULTANT' && user.site_id && user.centre_id) {
      setLoading(true);
      Promise.all([
        window.api.hierarchy.getSites(),
        window.api.hierarchy.getCentres(user.site_id)
      ]).then(([sites, centres]) => {
        const siteObj = sites.find((s: any) => s.id === user.site_id);
        const centreObj = centres.find((c: any) => c.id === user.centre_id);
        setPerimeter({
          siteNom: siteObj?.nom || `Site #${user.site_id}`,
          centreNom: centreObj?.nom || `Centre #${user.centre_id}`
        });
      }).catch(err => {
        console.error('[ConsultantPerimeter] Error loading names:', err);
      }).finally(() => {
        setLoading(false);
      });
    } else {
      setLoading(false);
    }
  }, [user]);

  if (user?.role !== 'CONSULTANT') return null;

  if (loading) {
    return (
      <div className="skeleton" style={{ width: 180, height: 38, borderRadius: 12, margin: '0 16px', opacity: 0.5 }} />
    );
  }

  if (!perimeter) return null;

  return (
    <div 
      className="consultant-perimeter-badge"
      title="Sécurité : Vos droits de consultation sont limités à ce Site et ce Centre uniquement."
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: 8, background: 'rgba(99, 102, 241, 0.1)', color: 'var(--accent-primary)', flexShrink: 0 }}>
        <MapPin size={14} />
      </div>
      <div className="perimeter-info">
        <span className="perimeter-label">PÉRIMÈTRE D'AFFECTATION</span>
        <span className="perimeter-values">{perimeter.siteNom} • {perimeter.centreNom}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', color: 'var(--accent-primary)', opacity: 0.7, cursor: 'help', marginLeft: 4 }}>
        <ShieldAlert size={12} />
      </div>
    </div>
  );
}

export default function TopBar() {
  const [showNotifications, setShowNotifications] = useState(false);
  const [syncStatus, setSyncStatus] = useState<{ status: string; queueLength: number }>({ status: 'OFFLINE', queueLength: 0 });
  const dropdownRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  // Polling sync status
  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const info = await window.api.sync.getStatus();
        if (info) {
          setSyncStatus({
            status: info.state || 'OFFLINE',
            queueLength: typeof info.queueCount === 'number' ? info.queueCount : 0
          });
        }
      } catch (err) {
        console.error('[TopBar] Failed to fetch sync status:', err);
      }
    };

    fetchStatus();
    const interval = setInterval(fetchStatus, 10000);
    return () => clearInterval(interval);
  }, []);

  // Click Outside logic
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowNotifications(false);
      }
    };
    if (showNotifications) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showNotifications]);

  const isOnline = syncStatus.status === 'ONLINE' || syncStatus.status === 'PROBING';

  return (
    <header className="topbar">
      <div className="topbar-left">
        <h1 className="topbar-title">GEST-IN-SITU</h1>
      </div>

      <div className="topbar-right" ref={dropdownRef}>
        {/* Affichage du périmètre d'affectation pour le Consultant */}
        <ConsultantPerimeter />

        {/* Widget de synchronisation offline-first */}
        <SyncWidget />

        <button 
          className={`topbar-icon-btn ${showNotifications ? 'active' : ''}`} 
          title="Notifications"
          onClick={() => setShowNotifications(!showNotifications)}
          style={{ position: 'relative' }}
        >
          <Bell size={16} />
          {syncStatus.queueLength > 0 && (
            <span className="badge" style={{ background: isOnline ? 'var(--accent-primary)' : 'var(--accent-red)', animation: isOnline ? 'pulse 2s infinite' : 'none' }}>
              {syncStatus.queueLength}
            </span>
          )}
        </button>

        <button className="topbar-icon-btn" title="Paramètres" onClick={() => navigate('/profile')}>
          <Settings size={16} />
        </button>

        {/* Dynamic Notification Popover */}
        {showNotifications && (
          <div className="topbar-notifications-dropdown">
            <div className="topbar-notifications-header">
              <h4>Notifications & Synchronisation</h4>
            </div>
            
            <div style={{ maxHeight: 300, overflowY: 'auto' }}>
              {syncStatus.queueLength > 0 ? (
                <div className="topbar-notification-item">
                  <div className="topbar-notification-icon" style={{ background: isOnline ? 'rgba(99, 102, 241, 0.1)' : 'rgba(239, 68, 68, 0.1)', color: isOnline ? 'var(--accent-primary)' : 'var(--accent-red)' }}>
                    {isOnline ? <RefreshCw size={18} className="animate-spin" /> : <AlertTriangle size={18} />}
                  </div>
                  <div className="topbar-notification-content">
                    <div className="topbar-notification-title">File de synchronisation</div>
                    <div className="topbar-notification-desc">
                      {isOnline 
                        ? `${syncStatus.queueLength} modification(s) en cours de transmission avec le Cloud.` 
                        : `${syncStatus.queueLength} modification(s) en attente. Reconnexion internet requise.`
                      }
                    </div>
                  </div>
                </div>
              ) : (
                <div className="topbar-notification-item">
                  <div className="topbar-notification-icon" style={{ background: 'rgba(34, 197, 94, 0.1)', color: 'var(--accent-green)' }}>
                    <CheckCircle size={18} />
                  </div>
                  <div className="topbar-notification-content">
                    <div className="topbar-notification-title">Système à jour</div>
                    <div className="topbar-notification-desc">
                      Aucune notification. Votre base locale est entièrement synchronisée.
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
