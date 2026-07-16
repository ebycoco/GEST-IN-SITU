import React, { useState, useEffect } from 'react';
import { Outlet, NavLink, useLocation } from 'react-router-dom';
import { Database, Globe, AlertTriangle, Users, Calendar, Fingerprint, LayoutDashboard } from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { useForceSyncActions } from '../dashboard/hooks/useForceSyncActions';
import { useDashboardStats } from '../dashboard/hooks/useDashboardStats';

export default function AgentQualiteLayout() {
  const { user, activeSiteId } = useAuthStore();
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);
  const location = useLocation();
  const isOverview = location.pathname === '/agent-qualite' || location.pathname === '/agent-qualite/';

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const { dirtyCartesCount, cloudCartesCount, loadStats } = useDashboardStats(user, activeSiteId, false);
  const {
    isPullingCards,
    isBackgroundPulling,
    isBulkUploading,
    handlePullSiteCards,
    handleStartBulkUpload
  } = useForceSyncActions(user, activeSiteId, loadStats);

  const pullDisabled = isPullingCards || !isOnline || cloudCartesCount === 0;
  const pushDisabled = isBulkUploading || !isOnline || dirtyCartesCount === 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', backgroundColor: 'var(--bg-primary)' }}>
      {/* En-tête Premium */}
      <div style={{
        padding: '24px 32px',
        borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
        background: 'linear-gradient(to bottom, rgba(0,0,0,0.3) 0%, transparent 100%)',
        display: 'flex',
        flexDirection: 'column',
        gap: 20
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 900, color: 'white', margin: 0, display: 'flex', alignItems: 'center', gap: 12 }}>
              <AlertTriangle color="#FFE600" size={28} />
              PORTAIL DE CONFORMITÉ ET QUALITÉ
            </h1>
            <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '4px 0 0 0' }}>
              Traitement des anomalies d'importation et nettoyage de la base de données.
            </p>
          </div>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <button
              onClick={() => handlePullSiteCards(false)}
              disabled={pullDisabled}
              className="btn-outline"
              style={{
                padding: '12px 24px',
                borderRadius: 12,
                fontWeight: 700,
                cursor: pullDisabled ? 'not-allowed' : 'pointer',
                opacity: pullDisabled ? 0.5 : 1,
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                background: 'rgba(255, 255, 255, 0.03)',
                color: 'white',
                whiteSpace: 'nowrap'
              }}
            >
              <Database size={18} style={{ animation: isPullingCards && !isBackgroundPulling ? 'spin 1.5s linear infinite' : 'none' }} />
              {isPullingCards && !isBackgroundPulling ? 'RÉCUPÉRATION EN COURS...' : `RÉCUPÉRER LES CARTES DEPUIS LE CLOUD${cloudCartesCount > 0 ? ` (${cloudCartesCount.toLocaleString('fr')})` : ''}`}
            </button>

            <button
              onClick={() => handleStartBulkUpload(false, false)}
              disabled={pushDisabled}
              className="btn-plein-soleil"
              style={{
                padding: '12px 24px',
                borderRadius: 12,
                fontWeight: 700,
                backgroundColor: pushDisabled ? '#555555' : '#FFE600',
                color: pushDisabled ? '#ffffff' : '#000000',
                border: '1px solid #FFE600',
                cursor: pushDisabled ? 'not-allowed' : 'pointer',
                opacity: pushDisabled ? 0.5 : 1,
                boxShadow: '0 4px 15px rgba(255, 230, 0, 0.3)',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                transition: 'all 0.2s ease-in-out',
                whiteSpace: 'nowrap'
              }}
            >
              <Globe size={18} style={{ animation: isBulkUploading ? 'spin 1.5s linear infinite' : 'none' }} />
              {isBulkUploading ? 'ENVOI EN COURS...' : `ENVOYER LES CARTES VERS LE CLOUD${dirtyCartesCount > 0 ? ` (${dirtyCartesCount.toLocaleString('fr')})` : ''}`}
            </button>
          </div>
        </div>

        {/* Sous-navigation Modulaire */}
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
          <NavLink to="/agent-qualite" end className="tab-link" style={() => getNavLinkStyle({ isActive: isOverview })}>
            <LayoutDashboard size={16} /> Vue d'ensemble
          </NavLink>
          <NavLink to="/agent-qualite/doublons" className="tab-link" style={getNavLinkStyle}>
            <Users size={16} /> Doublons
          </NavLink>
          <NavLink to="/agent-qualite/manquants" className="tab-link" style={getNavLinkStyle}>
            <Fingerprint size={16} /> Données Manquantes
          </NavLink>
          <NavLink to="/agent-qualite/invalides" className="tab-link" style={getNavLinkStyle}>
            <Calendar size={16} /> Formats Invalides
          </NavLink>
        </div>
      </div>

      {/* Contenu Principal (Outlet) */}
      <div style={{ flex: 1, overflow: 'auto', padding: '24px 32px' }}>
        <Outlet />
      </div>
    </div>
  );
}

const navLinkStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '10px 16px',
  borderRadius: 8,
  color: 'var(--text-muted)',
  textDecoration: 'none',
  fontWeight: 600,
  fontSize: 14,
  transition: 'all 0.2s ease',
  backgroundColor: 'rgba(255,255,255,0.02)',
  border: '1px solid rgba(255,255,255,0.05)'
};

const getNavLinkStyle = ({ isActive }: { isActive: boolean }) => ({
  ...navLinkStyle,
  ...(isActive ? {
    color: 'var(--accent-orange, #f39c12)',
    backgroundColor: 'rgba(243, 156, 18, 0.1)',
    border: '1px solid rgba(243, 156, 18, 0.3)'
  } : {})
});
