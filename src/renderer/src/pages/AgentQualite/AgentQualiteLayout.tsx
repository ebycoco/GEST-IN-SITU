import React, { useState, useEffect } from 'react';
import { OnlineBadge } from '../../components/OnlineBadge';

import { Outlet, NavLink, useLocation } from 'react-router-dom';
import { Database, Globe, AlertTriangle, Users, Calendar, Fingerprint, LayoutDashboard, Search, RefreshCw } from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { useForceSyncActions } from '../dashboard/hooks/useForceSyncActions';
import { useDashboardStats } from '../dashboard/hooks/useDashboardStats';
import { CorrectionSidePanel } from '../../components/Quality/CorrectionSidePanel';
import { IdentificationGuidee } from '../../components/Quality/IdentificationGuidee';
import { useQualityUIStore } from '../../stores/qualityUIStore';
import { useAutoDownstreamPreference } from '../../hooks/useAutoDownstreamPreference';
import { usePushButtonVisibility } from '../../hooks/usePushButtonVisibility';
import { AutoSyncIndicators } from '../../components/AutoSyncIndicators';

export default function AgentQualiteLayout() {
  const { user, activeSiteId } = useAuthStore();
  // Quand la récupération automatique des cartes est active pour l'utilisateur courant, le
  // bouton manuel "Récupérer les cartes depuis le cloud" ci-dessous doit rester désactivé et
  // masquer son compteur — cf. useAutoDownstreamPreference.ts.
  const autoDownstream = useAutoDownstreamPreference();
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const location = useLocation();
  const isOverview = location.pathname === '/agent-qualite' || location.pathname === '/agent-qualite/';
  const { activeCard, correctionType, closeCorrection, isGuideOpen, closeGuide, guideInitialName, triggerRefresh, openCorrection, isFetchingQuery } = useQualityUIStore();

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

  const { stats, dirtyCartesCount, cloudCartesCount, detailedSyncStats, loadStats } = useDashboardStats(user, activeSiteId, false);

  // Bug identique à celui corrigé sur AgentVerificationLayout.tsx/RechercheView.tsx (délivrance
  // de carte sans recalcul du compteur qui pilote le bouton "Synchroniser") : chaque correction
  // qualité (CorrectionSidePanel.onSave, DoublonsView, MissingDataView, InvalidFormatView)
  // dispatch déjà 'app:data-updated' (cf. onSave ci-dessous) mais ce layout ne l'écoutait pas —
  // dirtyCartesCount/cloudCartesCount/detailedSyncStats (qui pilotent pullDisabled/pushDisabled
  // des boutons "Récupérer"/"Envoyer les corrections") ne se recalculaient donc plus jamais
  // après le montage initial. Silent=true : pas d'overlay de chargement pour un événement de
  // fond déclenché par une action métier ponctuelle (même pattern qu'AgentSaisieLayout.tsx).
  useEffect(() => {
    const handleDataUpdated = () => { loadStats(true); };
    window.addEventListener('app:data-updated', handleDataUpdated);
    return () => window.removeEventListener('app:data-updated', handleDataUpdated);
  }, [loadStats]);
  const {
    isPullingCards,
    isBackgroundPulling,
    isBulkUploading,
    handlePullSiteCards,
    handleStartBulkUpload
  } = useForceSyncActions(user, activeSiteId, loadStats);

  // Nombre de cartes réellement envoyables par le bouton "Envoyer les corrections" tel
  // qu'utilisé ci-dessous (allowProbable/allowInvalid/allowMissing tous à false). Distinct de
  // dirtyCartesCount (compteur brut is_dirty=1, partagé par plusieurs autres pages) pour ne
  // pas afficher "en attente" des cartes que le bouton ne pourra pas envoyer sans forçage
  // (classement 'NON CLASSE', date invalide, doublon) — évite le message trompeur "Aucune
  // donnée locale conforme" alors que le badge annonçait des corrections en attente.
  const [conformeCartesCount, setConformeCartesCount] = useState<number>(0);
  useEffect(() => {
    const siteIdToUse = user?.role === 'SUPER ADMIN' ? activeSiteId : user?.site_id;
    if (!siteIdToUse) { setConformeCartesCount(0); return; }
    let cancelled = false;
    window.api.stats.getUnsyncedConformeCardsCount(Number(siteIdToUse))
      .then(count => { if (!cancelled) setConformeCartesCount(count); })
      .catch(err => console.error('Failed to fetch conforme cartes count:', err));
    return () => { cancelled = true; };
  }, [user, activeSiteId, dirtyCartesCount]);

  // cloudCartesCount vaut -1 en sentinelle d'indisponibilite Supabase (voir
  // sync:getCloudCartesCount cote main) : toute valeur <= 0 doit desactiver le bouton.
  // Meme correctif que AgentVerificationLayout.tsx (cloudCartesCount === 0 ne couvrait
  // pas le cas -1, laissant le bouton actif alors que le cloud est injoignable).
  const pullDisabled = autoDownstream || isPullingCards || cloudCartesCount <= 0;
  const {
    visible: pushVisible,
    disabled: pushDisabled,
    refreshActionableCount,
    outboxBacklogCount,
    refreshOutboxBacklogCount
  } = usePushButtonVisibility(conformeCartesCount, isBulkUploading);
  const nonConformeCount = Math.max(0, dirtyCartesCount - conformeCartesCount);

  const handlePushClick = async () => {
    // forceMissing=true : une donnée manquante (rangement, nom, prénom, contact...) ne doit
    // plus bloquer l'envoi cloud une fois la date corrigée. Seuls les doublons
    // (forceProbable) et les dates invalides (forceInvalid) restent des blocages durs.
    const res = await handleStartBulkUpload(false, false, true, (detailedSyncStats?.modifiedCount || 0) > 0);
    if (res && (res as any).success) {
      refreshActionableCount();
      refreshOutboxBacklogCount();
    }
  };

  // triggerRefresh() est un simple incrément synchrone de compteur (cf. qualityUIStore.ts) qui ne
  // rafraîchit que les listes des vues enfants (Doublons, Données Manquantes, etc.) — il ne
  // recalculait jamais dirtyCartesCount/cloudCartesCount/detailedSyncStats, qui pilotent
  // l'état enabled/disabled des boutons "Récupérer les cartes"/"Envoyer les corrections"
  // ci-dessous (même bug que le mock loadStats corrigé sur AgentVerificationLayout.tsx). On
  // appelle donc aussi loadStats (forceRefresh: true, comme le bouton "Actualiser" d'
  // InventaireLayout.tsx/ApurementLayout.tsx) en plus de triggerRefresh(). isRefreshing ne sert
  // qu'à donner un retour visuel bref (icône qui tourne ~600ms) au clic, sans bloquer le bouton.
  const handleRefreshClick = () => {
    setIsRefreshing(true);
    triggerRefresh();
    loadStats(false, undefined, true);
    setTimeout(() => setIsRefreshing(false), 600);
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
              <AlertTriangle color="#FFE600" size={28} />
              PORTAIL DE CONFORMITÉ ET QUALITÉ
            </h1>
            <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '4px 0 0 0' }}>
              Traitement des anomalies d'importation et nettoyage de la base de données.
            </p>
          </div>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
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
              onClick={handleRefreshClick}
              disabled={isRefreshing}
              className="btn"
              style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', borderRadius: 8, fontSize: 13,
                background: 'rgba(255, 255, 255, 0.05)', border: '1px solid rgba(255, 255, 255, 0.1)', color: 'white',
                cursor: isRefreshing ? 'not-allowed' : 'pointer', opacity: isRefreshing ? 0.6 : 1, transition: 'all 0.2s'
              }}
              onMouseOver={(e) => { if (!isRefreshing) e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)'; }}
              onMouseOut={(e) => { if (!isRefreshing) e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)'; }}
            >
              <RefreshCw size={16} style={{ animation: isRefreshing ? 'spin 1.5s linear infinite' : 'none' }} />
              {isRefreshing ? 'Actualisation...' : 'Actualiser'}
            </button>

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
              {isPullingCards && !isBackgroundPulling ? 'RÉCUPÉRATION EN COURS...' : `RÉCUPÉRER LES CARTES DEPUIS LE CLOUD${(!autoDownstream && cloudCartesCount > 0) ? ` (${cloudCartesCount.toLocaleString('fr')})` : ''}`}
            </button>

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
                  gap: '8px',
                  whiteSpace: 'nowrap'
                }}
              >
                <Globe size={18} style={{ animation: isBulkUploading ? 'spin 1.5s linear infinite' : 'none' }} />
                {isBulkUploading ? 'ENVOI...' : 'Envoyer les corrections'}
                {/* Badge informatif : backlog réel t_outbox (outboxBacklogCount), distinct de
                    actionableCount qui pilote uniquement l'activation du bouton — cf. audit
                    agent-9-senior-auditor P1 #1 (usePushButtonVisibility.ts). */}
                {outboxBacklogCount > 0 && (
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    minWidth: 20, height: 20, padding: '0 6px', borderRadius: 10,
                    background: 'rgba(0,0,0,0.25)', color: pushDisabled ? '#ffffff' : '#000000',
                    fontSize: 11, fontWeight: 800
                  }}>
                    {outboxBacklogCount.toLocaleString('fr')}
                  </span>
                )}
              </button>
            )}

            <AutoSyncIndicators />
          </div>
        </div>

        {/* Rappel visuel : corrections locales pas encore envoyées vers le cloud.
            Les fusions/corrections qualité restent 100% locales tant que ce bouton
            n'a pas été cliqué — ce bandeau évite l'oubli. */}
        {dirtyCartesCount > 0 && !isBulkUploading && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '10px 16px',
            borderRadius: 10,
            background: 'rgba(255, 230, 0, 0.08)',
            border: '1px solid rgba(255, 230, 0, 0.25)',
            color: '#FFE600',
            fontSize: 13,
            fontWeight: 600
          }}>
            <AlertTriangle size={16} style={{ flexShrink: 0 }} />
            {conformeCartesCount > 0 ? (
              <>
                {conformeCartesCount.toLocaleString('fr')} correction{conformeCartesCount > 1 ? 's' : ''} prête{conformeCartesCount > 1 ? 's' : ''} à l'envoi — restera{conformeCartesCount > 1 ? 'nt' : ''} uniquement sur ce poste tant que vous n'aurez pas cliqué sur « Envoyer les corrections ».
                {nonConformeCount > 0 && ` (${nonConformeCount.toLocaleString('fr')} autre${nonConformeCount > 1 ? 's' : ''} non conforme${nonConformeCount > 1 ? 's' : ''} — date invalide ou doublon à corriger avant envoi.)`}
              </>
            ) : (
              `${dirtyCartesCount.toLocaleString('fr')} correction${dirtyCartesCount > 1 ? 's' : ''} en attente mais non conforme${dirtyCartesCount > 1 ? 's' : ''} (date invalide ou doublon) — corrigez ces fiches avant de pouvoir les envoyer.`
            )}
          </div>
        )}

        {/* Sous-navigation Modulaire — masquée pour OPERATEUR_QUALITE (navigation désormais via
            la sidebar, cf. Sidebar.tsx) ; reste affichée telle quelle pour SUPER ADMIN /
            ADMINISTRATEUR_SITE qui partagent cette même route `/agent-qualite`. */}
        {user?.role !== 'OPERATEUR_QUALITE' && (
          <div style={{
            display: 'flex',
            gap: 8,
            overflowX: 'auto',
            paddingBottom: 4,
            pointerEvents: isFetchingQuery ? 'none' : 'auto',
            opacity: isFetchingQuery ? 0.6 : 1,
            transition: 'opacity 0.2s ease-in-out'
          }}>
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
              <Calendar size={16} /> Dates Invalides ou Absentes
            </NavLink>
            <NavLink to="/agent-qualite/anomalies-brutes" className="tab-link" style={getNavLinkStyle}>
              <AlertTriangle size={16} /> Autres Anomalies
            </NavLink>
            <NavLink to="/agent-qualite/recherche-universelle" className="tab-link" style={getNavLinkStyle}>
              <Search size={16} /> Recherche Universelle
            </NavLink>
          </div>
        )}
      </div>

      {/* Contenu Principal (Outlet) */}
      <div style={{ flex: 1, overflow: 'auto', padding: '24px 32px' }}>
        <Outlet />
      </div>

      {activeCard && (
        <CorrectionSidePanel
          isOpen={!!activeCard}
          record={activeCard}
          anomalieType={correctionType}
          onClose={closeCorrection}
          onSave={async (id, updates) => {
            await window.api.cartes.updateCarte(id, updates, user);
            triggerRefresh();
            window.dispatchEvent(new CustomEvent('app:data-updated'));
          }}
        />
      )}

      {isGuideOpen && (
        <IdentificationGuidee
          isOpen={isGuideOpen}
          initialName={guideInitialName}
          onClose={closeGuide}
          siteId={activeSiteId || 1}
          onSelectCard={(carte) => openCorrection(carte, 'Identification')}
        />
      )}
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
  border: '1px solid rgba(255,255,255,0.05)',
  whiteSpace: 'nowrap' as const
};

const getNavLinkStyle = ({ isActive }: { isActive: boolean }) => ({
  ...navLinkStyle,
  ...(isActive ? {
    color: 'var(--accent-orange, #f39c12)',
    backgroundColor: 'rgba(243, 156, 18, 0.1)',
    border: '1px solid rgba(243, 156, 18, 0.3)'
  } : {})
});
