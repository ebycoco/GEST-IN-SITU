import React, { useState, useEffect, useRef } from 'react';
import { OnlineBadge } from '../../components/OnlineBadge';

import { Outlet, NavLink } from 'react-router-dom';
import { Database, Globe, LayoutDashboard, Search, AlertTriangle, ShieldCheck, RefreshCw } from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { useForceSyncActions } from '../dashboard/hooks/useForceSyncActions';
import { useDashboardStats } from '../dashboard/hooks/useDashboardStats';
import { useAutoDownstreamPreference } from '../../hooks/useAutoDownstreamPreference';
import { usePushButtonVisibility } from '../../hooks/usePushButtonVisibility';
import { AutoSyncIndicators } from '../../components/AutoSyncIndicators';

export default function AgentVerificationLayout() {
  const { user, activeSiteId } = useAuthStore();
  // Quand la récupération automatique des cartes est active pour l'utilisateur courant, le
  // bouton manuel "Récupérer les cartes depuis le cloud" ci-dessous doit rester désactivé et
  // masquer son compteur — cf. useAutoDownstreamPreference.ts.
  const autoDownstream = useAutoDownstreamPreference();
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

  const { stats, cloudCartesCount, detailedSyncStats, centreCardsCount, loadStats, loading: isStatsLoading } = useDashboardStats(user, activeSiteId, false);
  const {
    isPullingCards,
    isBackgroundPulling,
    isBulkUploading,
    handlePullSiteCards,
    handleStartBulkUpload
  } = useForceSyncActions(user, activeSiteId, loadStats);

  // cloudCartesCount vaut -1 en sentinelle d'indisponibilite Supabase (voir
  // sync:getCloudCartesCount cote main) : toute valeur <= 0 doit desactiver le bouton.
  const pullDisabled = autoDownstream || isPullingCards || cloudCartesCount <= 0;

  // ── Indicateur local "pull tout juste réussi" ──────────────────────────────
  // Contexte : après un pull réussi, src/main/sync/downstream.ts (moteur de synchro,
  // hors périmètre de ce composant) recule volontairement le watermark de 2 minutes
  // par sécurité anti-décalage d'horloge. Conséquence : cloudCartesCount peut rester
  // non-nul jusqu'à ~2 minutes après un pull qui a pourtant parfaitement réussi, ce
  // qui peut laisser croire à l'agent que la récupération a échoué. On affiche donc
  // un indicateur "à jour" local le temps de cette fenêtre, sans toucher au moteur.
  const [justPulledSuccess, setJustPulledSuccess] = useState<boolean>(false);
  const pullSuccessTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Nettoyage du timer au démontage pour éviter tout setState après unmount
  useEffect(() => {
    return () => {
      if (pullSuccessTimeoutRef.current) clearTimeout(pullSuccessTimeoutRef.current);
    };
  }, []);

  const handlePullClick = async () => {
    if (pullSuccessTimeoutRef.current) {
      clearTimeout(pullSuccessTimeoutRef.current);
      pullSuccessTimeoutRef.current = null;
    }
    setJustPulledSuccess(false);
    const res = await handlePullSiteCards(false);
    if (res && (res as any).success) {
      setJustPulledSuccess(true);
      // Fenêtre bornée à 2 min, alignée sur le recul de watermark de downstream.ts
      pullSuccessTimeoutRef.current = setTimeout(() => {
        setJustPulledSuccess(false);
        pullSuccessTimeoutRef.current = null;
      }, 120000);
    }
  };
  // Nombre réellement envoyable (conforme : pas de doublon, pas de date invalide, pas de
  // donnée manquante) — distinct du compte brut is_dirty pour ne pas activer le bouton sur
  // des cartes que l'envoi rejettera silencieusement.
  const conformeCount = (detailedSyncStats?.cleanCount || 0) + (detailedSyncStats?.modifiedCount || 0);
  const { visible: pushVisible, disabled: pushDisabled, actionableCount, refreshActionableCount } = usePushButtonVisibility(conformeCount, isBulkUploading);

  const handlePushClick = async () => {
    const res = await handleStartBulkUpload(false, false, false);
    if (res && (res as any).success) {
      refreshActionableCount();
    }
  };

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

            {centreCardsCount !== null && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '10px 16px',
                background: 'rgba(96, 165, 250, 0.05)',
                borderRadius: 12,
                border: '1px solid rgba(96, 165, 250, 0.2)',
                color: 'var(--text-secondary)'
              }}>
                <Database size={16} color="#60a5fa" />
                <span style={{ fontSize: 13, fontWeight: 600 }}>Les cartes de ce centre :</span>
                <span style={{ fontSize: 15, fontWeight: 800, color: 'white' }}>
                  {centreCardsCount.toLocaleString('fr-FR')}
                </span>
              </div>
            )}

            <button
              onClick={() => loadStats(false, undefined, true)}
              disabled={isStatsLoading}
              className="btn"
              style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', borderRadius: 8, fontSize: 13,
                background: 'rgba(255, 255, 255, 0.05)', border: '1px solid rgba(255, 255, 255, 0.1)', color: 'white',
                cursor: isStatsLoading ? 'not-allowed' : 'pointer', opacity: isStatsLoading ? 0.6 : 1, transition: 'all 0.2s'
              }}
              onMouseOver={(e) => { if (!isStatsLoading) e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)'; }}
              onMouseOut={(e) => { if (!isStatsLoading) e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)'; }}
            >
              <RefreshCw size={16} style={{ animation: isStatsLoading ? 'spin 1.5s linear infinite' : 'none' }} />
              {isStatsLoading ? 'Actualisation...' : 'Actualiser'}
            </button>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 auto' }}>
              <button
                onClick={handlePullClick}
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
                  width: '100%',
                  whiteSpace: 'nowrap'
                }}
              >
                <Database size={18} style={{ animation: isPullingCards && !isBackgroundPulling ? 'spin 1.5s linear infinite' : 'none' }} />
                {isPullingCards && !isBackgroundPulling ? 'RÉCUPÉRATION EN COURS...' : `RÉCUPÉRER LES CARTES DEPUIS LE CLOUD${(!autoDownstream && cloudCartesCount > 0) ? ` (${cloudCartesCount.toLocaleString('fr')})` : ''}`}
              </button>
              {!autoDownstream && justPulledSuccess && !isPullingCards && cloudCartesCount > 0 && (
                <span style={{ fontSize: 11, fontWeight: 600, color: '#4ade80', textAlign: 'center' }}>
                  ✅ À jour (dernière récupération réussie)
                </span>
              )}
            </div>

            {pushVisible && (
              <button
                onClick={handlePushClick}
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
                {isBulkUploading ? 'ACTUALISATION...' : `Synchroniser mes actions${actionableCount > 0 ? ` (${actionableCount.toLocaleString('fr')})` : ''}`}
              </button>
            )}

            <AutoSyncIndicators />
          </div>
        </div>

        {/* Sous-navigation Modulaire — masquée pour OPERATEUR_VERIFICATION (navigation désormais
            via la sidebar, cf. Sidebar.tsx) ; reste affichée telle quelle pour SUPER ADMIN /
            ADMINISTRATEUR_SITE / ADMIN_CENTRE qui partagent cette même route `/agent-verification`. */}
        {user?.role !== 'OPERATEUR_VERIFICATION' && (
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
        )}
      </div>

      {/* Contenu Principal (Outlet) */}
      {/*
        Correctif bouton "Synchroniser mes actions" bloqué après une délivrance (OPERATEUR_VERIFICATION) :
        `loadStats` (issu de useDashboardStats ci-dessus) recalcule `detailedSyncStats`, dont dépend
        `conformeCount`/`pushDisabled` du bouton. RechercheView.tsx (route enfant "recherche") ne le
        recevait pas et appelait un `loadStats` factice après `handleDeliver`, donc `detailedSyncStats`
        ne se rafraîchissait jamais après une délivrance et le bouton restait grisé. On l'expose ici via
        le contexte de l'Outlet pour que la route enfant puisse déclencher le même recalcul que celui
        déjà utilisé par les boutons de cette barre d'actions.
      */}
      <div style={{ flex: 1, overflow: 'auto', padding: '24px 32px' }}>
        <Outlet context={{ refreshStats: loadStats }} />
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
