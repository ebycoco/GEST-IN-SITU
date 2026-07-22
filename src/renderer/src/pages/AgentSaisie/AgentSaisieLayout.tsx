import React, { useState, useEffect } from 'react';
import { OnlineBadge } from '../../components/OnlineBadge';

import { Outlet, NavLink } from 'react-router-dom';
import { Database, Globe, FileText, History, LayoutDashboard, Send, Edit3 } from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { useForceSyncActions } from '../dashboard/hooks/useForceSyncActions';
import { useDashboardStats } from '../dashboard/hooks/useDashboardStats';
import { toast } from 'react-hot-toast';

export default function AgentSaisieLayout() {
  const { user, activeSiteId } = useAuthStore();
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);
  const [draftsCount, setDraftsCount] = useState<number>(0);
  const [isPublishing, setIsPublishing] = useState<boolean>(false);

  const fetchDraftsCount = React.useCallback(async () => {
    if (!activeSiteId) return;
    try {
      const count = await window.api.cartes.countDrafts(activeSiteId, user);
      setDraftsCount(count);
    } catch (err) {
      console.error("Erreur chargement nombre de brouillons:", err);
    }
  }, [activeSiteId, user]);

  const { dirtyCartesCount, cloudCartesCount, detailedSyncStats, loadStats } = useDashboardStats(user, activeSiteId, false);
  const {
    isPullingCards,
    isBackgroundPulling,
    isBulkUploading,
    handlePullSiteCards,
    handleStartBulkUpload
  } = useForceSyncActions(user, activeSiteId, loadStats);

  useEffect(() => {
    fetchDraftsCount();
    const interval = setInterval(fetchDraftsCount, 5000);

    const handleDataUpdated = () => {
      fetchDraftsCount();
      loadStats(true); // Silent reload
    };
    window.addEventListener('app:data-updated', handleDataUpdated);

    return () => {
      clearInterval(interval);
      window.removeEventListener('app:data-updated', handleDataUpdated);
    };
  }, [fetchDraftsCount, loadStats]);

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


  const pullDisabled = isPullingCards || cloudCartesCount === 0;
  const pushDisabled = isBulkUploading || dirtyCartesCount === 0;

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
              <FileText color="#FFE600" size={28} />
              PORTAIL DE SAISIE
            </h1>
            <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '4px 0 0 0' }}>
              Tableau de bord, nouvelles saisies et historique pour l'opérateur.
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
              {isPullingCards && !isBackgroundPulling ? 'TÉLÉCHARGEMENT EN COURS...' : `Télécharger depuis le Cloud${cloudCartesCount > 0 ? ` (${cloudCartesCount.toLocaleString('fr')})` : ''}`}
            </button>

            <button
              onClick={() => handleStartBulkUpload(false, false, false, (detailedSyncStats?.modifiedCount || 0) > 0)}
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
              {isBulkUploading ? 'ENVOI...' : 'Synchroniser vers le Cloud'}
            </button>

            {/* NOUVEAU BOUTON : PUBLIER BROUILLONS */}
            <button
              onClick={async () => {
                if (!activeSiteId) return;
                setIsPublishing(true);
                try {
                  const res = await window.api.cartes.publishDrafts(activeSiteId, user);
                  toast.success(`${res.publishedCount} brouillon(s) publié(s) et envoyé(s) à la synchronisation.`);
                  fetchDraftsCount();
                  loadStats();
                  window.dispatchEvent(new CustomEvent('app:data-updated'));
                } catch (e: any) {
                  toast.error("Erreur lors de l'envoi des brouillons: " + e.message);
                } finally {
                  setIsPublishing(false);
                }
              }}
              disabled={draftsCount === 0 || isPublishing}
              className="btn-plein-soleil"
              style={{
                padding: '12px 24px',
                borderRadius: 12,
                fontWeight: 700,
                backgroundColor: draftsCount === 0 || isPublishing ? '#555555' : '#4CAF50',
                color: '#ffffff',
                border: '1px solid ' + (draftsCount === 0 || isPublishing ? '#555555' : '#4CAF50'),
                cursor: draftsCount === 0 || isPublishing ? 'not-allowed' : 'pointer',
                opacity: draftsCount === 0 || isPublishing ? 0.5 : 1,
                boxShadow: draftsCount === 0 || isPublishing ? 'none' : '0 4px 15px rgba(76, 175, 80, 0.3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                transition: 'all 0.2s ease-in-out',
                flex: '1 1 auto',
                whiteSpace: 'nowrap'
              }}
            >
              <Send size={18} style={{ animation: isPublishing ? 'pulse 1.5s linear infinite' : 'none' }} />
              {isPublishing ? 'VALIDATION EN COURS...' : `VALIDER MES BROUILLONS${draftsCount > 0 ? ` (${draftsCount})` : ''}`}
            </button>
          </div>
        </div>

        {/* Sous-navigation Modulaire */}
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
          <NavLink to="/agent-saisie" end className="tab-link" style={getNavLinkStyle}>
            <LayoutDashboard size={16} /> Vue d'ensemble
          </NavLink>
          <NavLink to="/agent-saisie/nouvelle" className="tab-link" style={getNavLinkStyle}>
            <FileText size={16} /> Nouvelle Saisie
          </NavLink>
          <NavLink to="/agent-saisie/historique" className="tab-link" style={getNavLinkStyle}>
            <History size={16} /> Historique des saisies
          </NavLink>
          <NavLink to="/agent-saisie/brouillons" className="tab-link" style={getNavLinkStyle}>
            <Edit3 size={16} /> Mes Brouillons {draftsCount > 0 && <span style={{ background: '#f44336', color: 'white', padding: '2px 6px', borderRadius: 10, fontSize: 11 }}>{draftsCount}</span>}
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
