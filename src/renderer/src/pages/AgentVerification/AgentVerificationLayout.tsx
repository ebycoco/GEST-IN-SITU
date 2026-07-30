import React, { useState, useEffect } from 'react';
import { OnlineBadge } from '../../components/OnlineBadge';

import { Outlet, NavLink } from 'react-router-dom';
import { Database, Globe, LayoutDashboard, Search, AlertTriangle, ShieldCheck } from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { useForceSyncActions } from '../dashboard/hooks/useForceSyncActions';
import { useDashboardStats } from '../dashboard/hooks/useDashboardStats';

export default function AgentVerificationLayout() {
  const { user, activeSiteId } = useAuthStore();
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);

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

  const { stats, cloudCartesCount, detailedSyncStats, loadStats } = useDashboardStats(user, activeSiteId, false);
  const {
    isPullingCards,
    isBackgroundPulling,
    isBulkUploading,
    handlePullSiteCards,
    handleStartBulkUpload
  } = useForceSyncActions(user, activeSiteId, loadStats);

  const pullDisabled = isPullingCards || cloudCartesCount === 0;
  // Nombre réellement envoyable (conforme : pas de doublon, pas de date invalide, pas de
  // donnée manquante) — distinct du compte brut is_dirty pour ne pas activer le bouton sur
  // des cartes que l'envoi rejettera silencieusement.
  const conformeCount = (detailedSyncStats?.cleanCount || 0) + (detailedSyncStats?.modifiedCount || 0);
  const pushDisabled = isBulkUploading || conformeCount === 0;

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
              <ShieldCheck color="#FFE600" size={28} />
              PORTAIL DE VÉRIFICATION
            </h1>
            <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '4px 0 0 0' }}>
              Recherche de cartes, délivrance et gestion des signalements.
            </p>
          </div>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            {stats?.total !== undefined && (
              <div style={{ 
                display: 'flex', alignItems: 'center', gap: 8, 
                padding: '10px 16px', 
                background: 'rgba(74, 222, 128, 0.05)', 
                borderRadius: 12, 
                border: '1px solid rgba(74, 222, 128, 0.2)',
                color: 'var(--text-secondary)'
              }}>
                <Database size={16} color="#4ade80" />
                <span style={{ fontSize: 13, fontWeight: 600 }}>Cartes disponibles en local :</span>
                <span style={{ fontSize: 15, fontWeight: 800, color: 'white' }}>
                  {stats.total.toLocaleString('fr-FR')}
                </span>
              </div>
            )}
            
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
                justifyContent: 'center',
                gap: '8px',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                background: 'rgba(255, 255, 255, 0.03)',
                color: 'white',
                flex: '1 1 auto',
                whiteSpace: 'nowrap'
              }}
            >
              <Database size={18} style={{ animation: isPullingCards && !isBackgroundPulling ? 'spin 1.5s linear infinite' : 'none' }} />
              {isPullingCards && !isBackgroundPulling ? 'RÉCUPÉRATION EN COURS...' : `RÉCUPÉRER LES CARTES DEPUIS LE CLOUD${cloudCartesCount > 0 ? ` (${cloudCartesCount.toLocaleString('fr')})` : ''}`}
            </button>

            <button
              onClick={() => handleStartBulkUpload(false, false, false)}
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
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                flex: '1 1 auto',
                whiteSpace: 'nowrap'
              }}
            >
              <Globe size={18} style={{ animation: isBulkUploading ? 'spin 1.5s linear infinite' : 'none' }} />
              {isBulkUploading ? 'ACTUALISATION...' : `Synchroniser mes actions${conformeCount > 0 ? ` (${conformeCount.toLocaleString('fr')})` : ''}`}
            </button>
          </div>
        </div>

        {/* Sous-navigation Modulaire */}
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
          <NavLink to="/agent-verification" end className="tab-link" style={getNavLinkStyle}>
            <LayoutDashboard size={16} /> Vue d'ensemble
          </NavLink>
          <NavLink to="/agent-verification/recherche" className="tab-link" style={getNavLinkStyle}>
            <Search size={16} /> Recherche Active
          </NavLink>
          <NavLink to="/agent-verification/signalements" className="tab-link" style={getNavLinkStyle}>
            <AlertTriangle size={16} /> Signalements d'anomalies
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
