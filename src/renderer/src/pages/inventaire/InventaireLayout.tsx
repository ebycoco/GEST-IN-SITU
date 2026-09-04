import React, { useState, useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { PackageSearch, Boxes, BookOpenCheck, Database, Globe, RefreshCw } from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { useDashboardStats } from '../dashboard/hooks/useDashboardStats';
import { useForceSyncActions } from '../dashboard/hooks/useForceSyncActions';
import { useAutoDownstreamPreference } from '../../hooks/useAutoDownstreamPreference';
import { usePushButtonVisibility } from '../../hooks/usePushButtonVisibility';
import { AutoSyncIndicators } from '../../components/AutoSyncIndicators';
import InventairePhysiqueScan from './InventairePhysiqueScan';
import InventaireLogistique from './InventaireLogistique';
import InventaireApurement from './InventaireApurement';

type Tab = 'SCAN' | 'LOGISTIQUE' | 'APUREMENT';

export default function InventaireLayout() {
  const { user, activeSiteId } = useAuthStore();
  const [activeTab, setActiveTab] = useState<Tab>('SCAN');

  // OPERATEUR_LOGISTIQUE n'a pas accès à l'onglet APUREMENT HISTORIQUE (les 3 autres rôles du
  // hub - SUPER ADMIN, ADMINISTRATEUR_SITE, OPERATEUR_INVENTAIRE - conservent les 3 onglets).
  const canAccessApurement = user?.role !== 'OPERATEUR_LOGISTIQUE';

  // Décision produit validée (Option B, plan d'impact) : OPERATEUR_LOGISTIQUE bascule seul sur
  // le nouveau portail multi-pages (sous-routes react-router `/inventaire`, `/inventaire/scan`,
  // `/inventaire/logistique`, navigation via la sidebar dédiée — voir Sidebar.tsx). Les 3 autres
  // rôles qui partagent cette route (SUPER ADMIN, ADMINISTRATEUR_SITE, OPERATEUR_INVENTAIRE)
  // conservent EXACTEMENT le comportement actuel ci-dessous (barre d'onglets internes activeTab,
  // aucun changement observable, même URL /inventaire sans sous-chemin).
  const isLogistiquePortal = user?.role === 'OPERATEUR_LOGISTIQUE';

  const { stats, dirtyCartesCount, cloudCartesCount, detailedSyncStats, loading: isStatsLoading, loadStats } = useDashboardStats(user, activeSiteId, false);
  const {
    isPullingCards,
    isBackgroundPulling,
    isBulkUploading,
    handlePullSiteCards,
    handleStartBulkUpload
  } = useForceSyncActions(user, activeSiteId, loadStats);

  // Ce layout n'avait aucun listener sur les corrections effectuées par les vues enfants
  // (InventaireApurement.tsx, InventaireLogistique.tsx, InventairePhysiqueScan.tsx), qui
  // dispatchent désormais 'app:data-updated' après chaque correction réussie — même bug que
  // celui corrigé sur AgentQualiteLayout.tsx (dirtyCartesCount/conformeCartesCount/
  // detailedSyncStats, qui pilotent le bouton "Envoyer les corrections", ne se recalculaient
  // jamais après une correction). silent=true : pas d'overlay de chargement pour un événement
  // de fond (même pattern qu'AgentQualiteLayout.tsx).
  useEffect(() => {
    const handleDataUpdated = () => { loadStats(true); };
    window.addEventListener('app:data-updated', handleDataUpdated);
    return () => window.removeEventListener('app:data-updated', handleDataUpdated);
  }, [loadStats]);

  // Filet de sécurité par polling léger (même pattern que usePushButtonVisibility.ts:81-86 et
  // AgentQualiteLayout.tsx) : couvre le cas d'un envoi automatique déclenché en tâche de fond
  // sans qu'aucun événement 'app:data-updated' ne soit émis côté renderer. Actif uniquement
  // tant que dirtyCartesCount > 0 — politique Low-Memory CLAUDE.md §2. Nettoyage systématique
  // de l'intervalle au démontage/changement de dépendance.
  useEffect(() => {
    if (dirtyCartesCount <= 0) return undefined;
    const REFRESH_INTERVAL_MS = 90000;
    const interval = setInterval(() => { loadStats(true); }, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [dirtyCartesCount, loadStats]);

  // Garde-fou : si l'onglet APUREMENT est actif et que le rôle actif effectif bascule vers
  // OPERATEUR_LOGISTIQUE en cours de session (compte multi-rôles, cf. setActiveRole() /
  // CLAUDE.md §3), on ne doit pas rester bloqué sur un onglet désormais masqué/inaccessible :
  // retour automatique sur SCAN (onglet par défaut).
  useEffect(() => {
    if (!canAccessApurement && activeTab === 'APUREMENT') {
      setActiveTab('SCAN');
    }
  }, [canAccessApurement, activeTab]);

  // Quand la récupération automatique des cartes est active pour l'utilisateur courant, le
  // bouton manuel "Récupérer les cartes depuis le cloud" ci-dessous doit rester désactivé et
  // masquer son compteur — cf. useAutoDownstreamPreference.ts.
  const autoDownstream = useAutoDownstreamPreference();

  // Nombre de cartes réellement envoyables par le bouton "Envoyer les corrections" tel
  // qu'utilisé ci-dessous (allowProbable/allowInvalid/allowMissing tous à false). Distinct de
  // dirtyCartesCount (compteur brut is_dirty=1, partagé par plusieurs autres pages) pour ne
  // pas activer le bouton sur des cartes que l'envoi rejettera silencieusement (classement
  // 'NON CLASSE', date invalide, doublon). Même pattern que AgentQualiteLayout.tsx.
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
  const pullDisabled = autoDownstream || isPullingCards || cloudCartesCount <= 0;
  const {
    visible: pushVisible,
    disabled: pushDisabled,
    refreshActionableCount,
    outboxBacklogCount,
    refreshOutboxBacklogCount
  } = usePushButtonVisibility(conformeCartesCount, isBulkUploading);

  const handlePushClick = async () => {
    // forceMissing=true : une donnée manquante (rangement, nom, prénom, contact...) ne doit
    // plus bloquer l'envoi cloud une fois la date corrigée. Seuls les doublons
    // (forceProbable) et les dates invalides (forceInvalid) restent des blocages durs. Même
    // comportement que AgentQualiteLayout.tsx (rangement/apurement).
    const res = await handleStartBulkUpload(false, false, true, (detailedSyncStats?.modifiedCount || 0) > 0);
    if (res && (res as any).success) {
      refreshActionableCount();
      refreshOutboxBacklogCount();
    }
  };

  return (
    <div className="animate-fade-in" style={{ padding: '20px', maxWidth: 1200, margin: '0 auto', display: 'flex', flexDirection: 'column' }}>

      {/* Header & Navigation Tabs */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16, marginBottom: 20 }}>
          <h1 style={{ fontSize: 28, fontWeight: 900, color: 'white', margin: 0 }}>INVENTAIRE & LOGISTIQUE</h1>

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

        {/* Barre d'onglets internes (activeTab) — masquée UNIQUEMENT pour OPERATEUR_LOGISTIQUE
            (navigation désormais via la sidebar dédiée + sous-routes react-router, voir
            Sidebar.tsx/App.tsx). Reste affichée à l'identique pour les 3 autres rôles qui
            partagent cette route (SUPER ADMIN, ADMINISTRATEUR_SITE, OPERATEUR_INVENTAIRE) — zéro
            changement observable pour eux. */}
        {!isLogistiquePortal && (
        <div style={{ display: 'flex', gap: 12, background: 'rgba(0,0,0,0.2)', padding: 8, borderRadius: 16, border: '1px solid rgba(255,255,255,0.05)' }}>
          <button
            onClick={() => setActiveTab('SCAN')}
            className="hover-scale"
            style={{
              flex: 1,
              padding: '12px 16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              border: 'none',
              borderRadius: 12,
              background: activeTab === 'SCAN' ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)' : 'transparent',
              color: activeTab === 'SCAN' ? 'white' : 'var(--text-muted)',
              fontWeight: 800,
              cursor: 'pointer',
              transition: 'all 0.2s',
              boxShadow: activeTab === 'SCAN' ? '0 4px 12px rgba(16, 185, 129, 0.3)' : 'none'
            }}
          >
            <PackageSearch size={18} />
            INVENTAIRE PAR SCAN
          </button>
          
          <button
            onClick={() => setActiveTab('LOGISTIQUE')}
            className="hover-scale"
            style={{
              flex: 1,
              padding: '12px 16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              border: 'none',
              borderRadius: 12,
              background: activeTab === 'LOGISTIQUE' ? 'linear-gradient(135deg, #a855f7 0%, #7c3aed 100%)' : 'transparent',
              color: activeTab === 'LOGISTIQUE' ? 'white' : 'var(--text-muted)',
              fontWeight: 800,
              cursor: 'pointer',
              transition: 'all 0.2s',
              boxShadow: activeTab === 'LOGISTIQUE' ? '0 4px 12px rgba(168, 85, 247, 0.3)' : 'none'
            }}
          >
            <Boxes size={18} />
            CLASSEMENT LOGISTIQUE
          </button>

          {canAccessApurement && (
            <button
              onClick={() => setActiveTab('APUREMENT')}
              className="hover-scale"
              style={{
                flex: 1,
                padding: '12px 16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                border: 'none',
                borderRadius: 12,
                background: activeTab === 'APUREMENT' ? 'linear-gradient(135deg, #ec4899 0%, #be185d 100%)' : 'transparent',
                color: activeTab === 'APUREMENT' ? 'white' : 'var(--text-muted)',
                fontWeight: 800,
                cursor: 'pointer',
                transition: 'all 0.2s',
                boxShadow: activeTab === 'APUREMENT' ? '0 4px 12px rgba(236, 72, 153, 0.3)' : 'none'
              }}
            >
              <BookOpenCheck size={18} />
              APUREMENT HISTORIQUE
            </button>
          )}
        </div>
        )}
      </div>

      {/* Content Area — OPERATEUR_LOGISTIQUE : navigation par sous-routes react-router
          (InventaireOverview/InventairePhysiqueScan/InventaireLogistique montés via <Outlet/>,
          voir App.tsx). Les 3 autres rôles gardent le rendu conditionnel activeTab existant,
          strictement inchangé. */}
      <div style={{ background: 'rgba(255,255,255,0.01)', borderRadius: 20, border: '1px solid rgba(255,255,255,0.02)' }}>
        {isLogistiquePortal ? (
          <Outlet />
        ) : (
          <>
            {activeTab === 'SCAN' && <InventairePhysiqueScan />}
            {activeTab === 'LOGISTIQUE' && <InventaireLogistique />}
            {activeTab === 'APUREMENT' && canAccessApurement && <InventaireApurement />}
          </>
        )}
      </div>
    </div>
  );
}
