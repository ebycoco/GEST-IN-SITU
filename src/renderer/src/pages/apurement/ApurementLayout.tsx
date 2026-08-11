import React, { useState, useEffect } from 'react';
import { BookOpenCheck, Database, Globe, RefreshCw, LayoutDashboard } from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { useDashboardStats } from '../dashboard/hooks/useDashboardStats';
import { useForceSyncActions } from '../dashboard/hooks/useForceSyncActions';
import InventaireApurement from '../inventaire/InventaireApurement';
import ApurementOverview from './ApurementOverview';

type Tab = 'OVERVIEW' | 'APUREMENT';

/**
 * Portail dédié au rôle OPERATEUR_APUREMENT.
 *
 * Deux onglets internes (pas de nouvelle route react-router, `/apurement` reste unique dans
 * App.tsx), sur le modèle exact d'InventaireLayout.tsx (`type Tab`, `useState<Tab>`, rendu
 * conditionnel) :
 * - "Vue d'ensemble" (ApurementOverview, par défaut à l'ouverture) : 4 KPI + liste paginée du
 *   travail du jour.
 * - "Travail d'apurement" : rend <InventaireApurement /> — le composant est déjà autonome
 *   (aucune prop reçue, ne dépend que de useAuthStore pour site_id/login) et reste réutilisé
 *   tel quel depuis InventaireLayout.tsx (onglet APUREMENT), donc partagé sans modification
 *   entre les deux portails.
 *
 * La barre de synchro cloud (badge local + Actualiser + Récupérer + Envoyer les corrections)
 * reprend à l'identique le bloc déjà en place dans InventaireLayout.tsx / AgentQualiteLayout.tsx.
 */
export default function ApurementLayout() {
  const { user, activeSiteId } = useAuthStore();
  const [activeTab, setActiveTab] = useState<Tab>('OVERVIEW');

  const { stats, dirtyCartesCount, cloudCartesCount, detailedSyncStats, loading: isStatsLoading, loadStats } = useDashboardStats(user, activeSiteId, false);
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
  // pas activer le bouton sur des cartes que l'envoi rejettera silencieusement (classement
  // 'NON CLASSE', date invalide, doublon). Même pattern que InventaireLayout.tsx/AgentQualiteLayout.tsx.
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
  const pullDisabled = isPullingCards || cloudCartesCount <= 0;
  const pushDisabled = isBulkUploading || conformeCartesCount === 0;

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
              <BookOpenCheck color="#ec4899" size={28} />
              PORTAIL D'APUREMENT
            </h1>
            <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '4px 0 0 0' }}>
              Émargement rétroactif des cahiers historiques.
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
              {isPullingCards && !isBackgroundPulling ? 'RÉCUPÉRATION EN COURS...' : `RÉCUPÉRER LES CARTES DEPUIS LE CLOUD${cloudCartesCount > 0 ? ` (${cloudCartesCount.toLocaleString('fr')})` : ''}`}
            </button>

            <button
              // forceMissing=true : une donnée manquante (rangement, nom, prénom, contact...) ne
              // doit plus bloquer l'envoi cloud une fois la date corrigée. Seuls les doublons
              // (forceProbable) et les dates invalides (forceInvalid) restent des blocages durs.
              // Même comportement que InventaireLayout.tsx/AgentQualiteLayout.tsx (rangement/apurement).
              onClick={() => handleStartBulkUpload(false, false, true, (detailedSyncStats?.modifiedCount || 0) > 0)}
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
            </button>
          </div>
        </div>

        {/* Onglets internes : Vue d'ensemble / Travail d'apurement (même pattern qu'InventaireLayout.tsx) */}
        <div style={{ display: 'flex', gap: 12, background: 'rgba(0,0,0,0.2)', padding: 8, borderRadius: 16, border: '1px solid rgba(255,255,255,0.05)' }}>
          <button
            onClick={() => setActiveTab('OVERVIEW')}
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
              background: activeTab === 'OVERVIEW' ? 'linear-gradient(135deg, #ec4899 0%, #be185d 100%)' : 'transparent',
              color: activeTab === 'OVERVIEW' ? 'white' : 'var(--text-muted)',
              fontWeight: 800,
              cursor: 'pointer',
              transition: 'all 0.2s',
              boxShadow: activeTab === 'OVERVIEW' ? '0 4px 12px rgba(236, 72, 153, 0.3)' : 'none'
            }}
          >
            <LayoutDashboard size={18} />
            VUE D'ENSEMBLE
          </button>

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
            TRAVAIL D'APUREMENT
          </button>
        </div>
      </div>

      {/* Contenu Principal */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {activeTab === 'OVERVIEW' && <ApurementOverview />}
        {activeTab === 'APUREMENT' && <InventaireApurement />}
      </div>
    </div>
  );
}
