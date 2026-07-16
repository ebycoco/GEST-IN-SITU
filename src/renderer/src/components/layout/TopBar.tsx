import { Bell, Settings, CheckCircle, AlertTriangle, RefreshCw, MapPin, ShieldAlert, XCircle } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { toast } from 'react-hot-toast';
import SyncWidget from '../SyncWidget';

function ConsultantPerimeter() {
  const user = useAuthStore((s) => s.user);
  const [loading, setLoading] = useState(true);
  const [perimeter, setPerimeter] = useState<{ siteNom: string; centreNom: string } | null>(null);

  useEffect(() => {
    if (user?.role === 'OPERATEUR_VERIFICATION' && user.site_id && user.centre_id) {
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

  if (user?.role !== 'OPERATEUR_VERIFICATION') return null;

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
  const [notifications, setNotifications] = useState<any[]>([]);
  const [showResolutionModal, setShowResolutionModal] = useState(false);
  const [selectedResolution, setSelectedResolution] = useState<any>(null);
  const user = useAuthStore((s) => s.user);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const unreadCount = notifications.length;

  // Transition Event-Driven : Plus de setInterval périodique
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

    // S'abonner aux changements de statut de synchronisation poussés par le main process
    if (window.api && window.api.sync.onStatusChanged) {
      const unsubscribe = window.api.sync.onStatusChanged((statusInfo: any) => {
        if (statusInfo) {
          setSyncStatus({
            status: statusInfo.state || 'OFFLINE',
            queueLength: typeof statusInfo.queueCount === 'number' ? statusInfo.queueCount : 0
          });
        }
      });
      return () => {
        if (unsubscribe) unsubscribe();
      };
    }
    return undefined;
  }, []);

  // Polling unread sync notifications list - initial fetch
  const fetchUnreadNotifications = async () => {
    try {
      if (window.api && window.api.sync.getUnreadList && user) {
        const list = await window.api.sync.getUnreadList(user.site_id);
        const filteredList = (list || []).filter(n => {
          if (user.role === 'ADMINISTRATEUR_SITE' || user.role === 'SUPER ADMIN') {
            return n.action !== 'CARTE_ABSENTE_RETROUVEE' && n.action !== 'CARTE_PERDUE_CONFIRMEE' && n.action !== 'CARTE_PERDUE_RETROUVEE';
          }
          if (user.role === 'OPERATEUR_VERIFICATION') {
            if (n.site_id !== undefined && n.site_id !== null && n.site_id !== user.site_id) {
              return false;
            }

            // Filtrer par centre (site_id) si présent dans le payload
            let parsed = null;
            try {
              parsed = typeof n.valeur_apres === 'string' ? JSON.parse(n.valeur_apres) : n.valeur_apres;
            } catch (e) {}
            if (parsed && parsed.site_id !== undefined && parsed.site_id !== null) {
              if (Number(parsed.site_id) !== Number(user.site_id)) {
                return false;
              }
            }

            return n.action !== 'CARTE_ABSENTE_SIGNALEE';
          }
          return true;
        });
        setNotifications(filteredList);
      }
    } catch (err) {
      console.error('[TopBar] Failed to fetch unread sync count:', err);
    }
  };

  useEffect(() => {
    fetchUnreadNotifications();
  }, [user]);

  // Real-time update count increment & event reaction
  useEffect(() => {
    if (window.api && window.api.onDatabaseUpdated) {
      const unsubscribe = window.api.onDatabaseUpdated((data) => {
        // Rafraîchir les notifications de manière réactive
        fetchUnreadNotifications();
        
        if (data && data.type === 'ABSENCE_SIGNALEE') {
          if (user?.role === 'ADMINISTRATEUR_SITE' || user?.role === 'SUPER ADMIN') {
            toast.error("⚠️ 1 carte signalée manquante dans les rangements !", {
              duration: 6000,
              style: {
                background: '#000',
                color: '#FFD700',
                border: '1px solid #FFD700'
              }
            });
          }
        } else if (data && (data.type === 'ABSENCE_RESOLUE' || data.type === 'CARTE_RETROUVEE')) {
          toast.success("📥 1 carte introuvable a été retrouvée et relocalisée !", {
            duration: 6000,
            style: {
              background: '#000',
              color: '#FFD700',
              border: '1px solid #FFD700'
            }
          });
        }
      });
      return () => {
        if (unsubscribe) unsubscribe();
      };
    }
    return undefined;
  }, [user?.site_id, user?.role]);

  const handleMarkAsRead = async () => {
    try {
      if (window.api && window.api.sync.markAsRead && user) {
        await window.api.sync.markAsRead(user.site_id);
        setNotifications([]);
      }
    } catch (err) {
      console.error('[TopBar] Failed to mark notifications as read:', err);
    }
  };

  const handleNotificationClick = async (n: any) => {
    if (n.action === 'CARTE_ABSENTE_SIGNALEE') {
      navigate('/admin/queue');
      setShowNotifications(false);
    } else if (n.action === 'CARTE_ABSENTE_RETROUVEE' || n.action === 'CARTE_PERDUE_CONFIRMEE' || n.action === 'CARTE_PERDUE_RETROUVEE') {
      if (user?.role === 'OPERATEUR_VERIFICATION') {
        try {
          if (window.api && window.api.sync.markNotificationAsRead) {
            await window.api.sync.markNotificationAsRead(n.id_log);
          }
        } catch (err) {
          console.error('[TopBar] Failed to mark notification as read:', err);
        }
        setNotifications(prev => prev.filter(item => item.id_log !== n.id_log));
        setShowNotifications(false);
        navigate('/verification/recherche?tab=resolus');
      } else {
        let parsed = null;
        try {
          parsed = typeof n.valeur_apres === 'string' ? JSON.parse(n.valeur_apres) : n.valeur_apres;
        } catch (e) {
          console.error('Failed to parse valeur_apres:', e);
        }
        setSelectedResolution({
          id_log: n.id_log,
          message: n.action === 'CARTE_PERDUE_RETROUVEE' 
            ? `Bonne nouvelle ! La carte de ${parsed?.noms || ''} ${parsed?.prenoms || ''} a été RETROUVÉE et réintégrée au stock.`
            : n.detail,
          noms: parsed?.noms || 'Inconnu',
          prenoms: parsed?.prenoms || '',
          rangement: parsed?.rangement || 'Non classé',
          contact: parsed?.contact || '—',
          isLost: n.action === 'CARTE_PERDUE_CONFIRMEE'
        });
        setShowResolutionModal(true);
        setShowNotifications(false);
      }
    } else {
      try {
        if (window.api && window.api.sync.markNotificationAsRead) {
          await window.api.sync.markNotificationAsRead(n.id_log);
        }
      } catch (err) {
        console.error('[TopBar] Failed to mark notification as read:', err);
      }
      setNotifications(prev => prev.filter(item => item.id_log !== n.id_log));
      setShowNotifications(false);
    }
  };

  const handleCloseResolutionModal = async () => {
    if (selectedResolution) {
      try {
        setNotifications(prev => prev.filter(item => item.id_log !== selectedResolution.id_log));
        if (window.api && window.api.sync.markNotificationAsRead) {
          await window.api.sync.markNotificationAsRead(selectedResolution.id_log);
        }
      } catch (err) {
        console.error('[TopBar] Failed to mark single resolution as read:', err);
      }
      setShowResolutionModal(false);
      setSelectedResolution(null);
    }
  };

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
  const showOfflineWarning = !isOnline && syncStatus.queueLength > 0;

  return (
    <>
      {showOfflineWarning && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, zIndex: 9999,
          background: '#ef4444',
          color: '#fff',
          padding: '8px 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          fontSize: 13,
          fontWeight: 600,
          boxShadow: '0 4px 12px rgba(239,68,68,0.3)',
          animation: 'slideDown 0.3s ease-out'
        }}>
          <AlertTriangle size={16} />
          Vous avez des signalements ou données en attente. Veuillez vous connecter à Internet pour finaliser leur envoi.
        </div>
      )}
      <header className="topbar" style={{ marginTop: showOfflineWarning ? 36 : 0, transition: 'margin-top 0.3s' }}>
        <div className="topbar-left">
          <h1 className="topbar-title">GESTION CARTES IN-SITU</h1>
        </div>

      <div className="topbar-right" ref={dropdownRef}>
        {/* Affichage du périmètre d'affectation pour l'Opérateur de Vérification */}
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
          {unreadCount > 0 ? (
            <span 
              className="animate-pulse" 
              style={{ 
                position: 'absolute',
                top: '-4px',
                right: '-4px',
                display: 'flex',
                height: '18px',
                width: '18px',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '50%',
                background: '#e74c3c',
                color: '#fff',
                fontSize: '10px',
                fontWeight: 'bold',
                border: '2px solid #0a0e27',
                boxShadow: '0 0 8px rgba(231,76,60,0.5)'
              }}
            >
              {unreadCount}
            </span>
          ) : (
            syncStatus.queueLength > 0 && (
              <span className="badge" style={{ background: isOnline ? 'var(--accent-primary)' : 'var(--accent-red)', animation: isOnline ? 'pulse 2s infinite' : 'none' }}>
                {syncStatus.queueLength}
              </span>
            )
          )}
        </button>

        <button className="topbar-icon-btn" title="Paramètres" onClick={() => navigate('/profile')}>
          <Settings size={16} />
        </button>

        {/* Dynamic Notification Popover */}
        {showNotifications && (
          <div className="topbar-notifications-dropdown" style={{ minWidth: 320 }}>
            <div className="topbar-notifications-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--border-color)' }}>
              <h4 style={{ margin: 0 }}>Notifications</h4>
              {unreadCount > 0 && (
                <button 
                  onClick={handleMarkAsRead}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#FFD700',
                    fontSize: 12,
                    fontWeight: 'bold',
                    cursor: 'pointer',
                    padding: 0
                  }}
                >
                  Tout marquer comme lu
                </button>
              )}
            </div>
            
            <div style={{ maxHeight: 300, overflowY: 'auto' }}>
              {unreadCount > 0 ? (
                notifications.map(n => {
                  const isAbsence = n.action === 'CARTE_ABSENTE_SIGNALEE';
                  const isResolution = n.action === 'CARTE_ABSENTE_RETROUVEE' || n.action === 'CARTE_PERDUE_RETROUVEE';
                  const isPerdue = n.action === 'CARTE_PERDUE_CONFIRMEE';
                  
                  return (
                    <div 
                      key={n.id_log}
                      className="topbar-notification-item cursor-pointer hover:bg-zinc-800/50 transition-colors" 
                      onClick={() => handleNotificationClick(n)}
                      style={{ 
                        borderLeft: isAbsence || isPerdue ? '3px solid #e74c3c' : isResolution ? '3px solid #27ae60' : '3px solid #FFD700',
                        background: 'rgba(255, 255, 255, 0.01)',
                        padding: '12px 16px',
                        borderBottom: '1px solid var(--border-subtle)',
                        display: 'flex',
                        gap: 12,
                        cursor: 'pointer',
                        transition: 'background-color 0.2s'
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.03)'}
                      onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.01)'}
                    >
                      <div 
                        style={{ 
                          background: isAbsence || isPerdue ? 'rgba(231, 76, 60, 0.1)' : isResolution ? 'rgba(39, 174, 96, 0.1)' : 'rgba(255, 215, 0, 0.1)', 
                          color: isAbsence || isPerdue ? '#e74c3c' : isResolution ? '#27ae60' : '#FFD700',
                          width: 32,
                          height: 32,
                          borderRadius: 8,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0
                        }}
                      >
                        {isPerdue ? <XCircle size={16} /> : <Bell size={16} />}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div 
                          style={{ 
                            color: isAbsence || isPerdue ? '#e74c3c' : isResolution ? '#27ae60' : '#FFD700', 
                            fontWeight: 'bold',
                            fontSize: 13
                          }}
                        >
                          {isAbsence ? 'Absence Signalée' : isResolution ? (n.action === 'CARTE_PERDUE_RETROUVEE' ? 'Carte Réactivée' : 'Absence Résolue') : isPerdue ? 'Carte Introuvable (Perdue)' : 'Mise à jour Base'}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                          {isPerdue ? (() => {
                            let parsed = null;
                            try {
                              parsed = typeof n.valeur_apres === 'string' ? JSON.parse(n.valeur_apres) : n.valeur_apres;
                            } catch (e) {}
                            return `La carte de ${parsed?.noms || ''} ${parsed?.prenoms || ''} a été confirmée PERDUE après fouille par l'administration.`;
                          })() : n.action === 'CARTE_PERDUE_RETROUVEE' ? (() => {
                            let parsed = null;
                            try {
                              parsed = typeof n.valeur_apres === 'string' ? JSON.parse(n.valeur_apres) : n.valeur_apres;
                            } catch (e) {}
                            return `Bonne nouvelle ! La carte de ${parsed?.noms || ''} ${parsed?.prenoms || ''} a été RETROUVÉE et réintégrée au stock.`;
                          })() : n.detail}
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
                          {n.date_heure ? new Date(n.date_heure).toLocaleString() : ''}
                        </div>
                      </div>
                    </div>
                  );
                })
              ) : (
                syncStatus.queueLength === 0 && (
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
                )
              )}
              {syncStatus.queueLength > 0 && (
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
              )}
            </div>
          </div>
        )}
        {/* Resolution Modal for Consultant */}
        {showResolutionModal && selectedResolution && (
          <div style={{
            position: 'fixed',
            inset: 0,
            zIndex: 11000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px'
          }}>
            {/* Background Blur Overlay */}
            <div style={{
              background: 'rgba(2, 6, 23, 0.85)',
              backdropFilter: 'blur(8px)',
              position: 'absolute',
              inset: 0
            }} onClick={handleCloseResolutionModal} />

            {/* Modal Body */}
            <div className="animate-slide-up" style={{
              position: 'relative',
              width: '95%',
              maxWidth: '500px',
              background: '#0f172a',
              borderRadius: '24px',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
              border: '1px solid rgba(255,255,255,0.1)',
              overflow: 'hidden',
              padding: '32px'
            }}>
              <div style={{ textAlign: 'center', marginBottom: 24 }}>
                <div style={{ 
                  display: 'inline-flex', 
                  padding: 16, 
                  background: selectedResolution.isLost ? 'rgba(239, 68, 68, 0.1)' : 'rgba(39, 174, 96, 0.1)', 
                  borderRadius: '50%', 
                  color: selectedResolution.isLost ? '#ef4444' : '#27ae60',
                  marginBottom: 16
                }}>
                  {selectedResolution.isLost ? <XCircle size={36} /> : <CheckCircle size={36} />}
                </div>
                <h3 style={{ margin: '0 0 8px 0', fontSize: 22, fontWeight: 800, color: 'white' }}>
                  {selectedResolution.isLost ? '❌ Recherche Infructueuse !' : '📥 Carte Physique Relocalisée !'}
                </h3>
                <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 14 }}>
                  {selectedResolution.isLost 
                    ? "Après une fouille approfondie par l'administration, cette carte n'a pas pu être retrouvée."
                    : "Bonne nouvelle ! L'administration a retrouvé et rangé la carte suivante :"
                  }
                </p>
              </div>

              {/* Contraste Card */}
              <div style={{
                background: 'rgba(255, 255, 255, 0.02)',
                border: '1px solid rgba(255, 255, 255, 0.05)',
                borderRadius: 16,
                padding: 24,
                marginBottom: 24
              }}>
                <div style={{ marginBottom: 16 }}>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Assuré</span>
                  <div style={{ fontSize: 18, fontWeight: 800, color: 'white', marginTop: 2, textTransform: 'uppercase' }}>
                    {selectedResolution.noms} {selectedResolution.prenoms}
                  </div>
                </div>

                <div style={{ marginBottom: 16 }}>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Contact Client</span>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-secondary)', marginTop: 2 }}>
                    {selectedResolution.contact}
                  </div>
                </div>

                <div>
                  {selectedResolution.isLost ? (
                    <>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Statut / Recommandation</span>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#ef4444', marginTop: 6, lineHeight: 1.4 }}>
                        ⚠️ Recherche infructueuse. Veuillez orienter l'assuré vers une demande de duplicata.
                      </div>
                    </>
                  ) : (
                    <>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Nouveau Rangement</span>
                      <div style={{ fontSize: 28, fontWeight: 900, color: '#FFD700', marginTop: 4 }}>
                        {selectedResolution.rangement}
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Action Button */}
              <button
                onClick={handleCloseResolutionModal}
                style={{
                  width: '100%',
                  padding: '16px',
                  borderRadius: 14,
                  background: selectedResolution.isLost ? '#ef4444' : '#27ae60',
                  color: 'white',
                  border: 'none',
                  fontWeight: 800,
                  fontSize: 15,
                  cursor: 'pointer'
                }}
                className="hover-scale"
              >
                Fermer et archiver
              </button>
            </div>
          </div>
        )}
      </div>
      </header>
    </>
  );
}
