import React, { useState, useEffect } from 'react';
import { OnlineBadge } from '../../components/OnlineBadge';

import { Outlet, NavLink } from 'react-router-dom';
import { Database, Globe, FileText, History, LayoutDashboard, Send, Edit3 } from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { useForceSyncActions } from '../dashboard/hooks/useForceSyncActions';
import { useDashboardStats } from '../dashboard/hooks/useDashboardStats';
import { useAutoDownstreamPreference } from '../../hooks/useAutoDownstreamPreference';
import { toast } from 'react-hot-toast';

export default function AgentSaisieLayout() {
  const { user, activeSiteId } = useAuthStore();
  // Quand la récupération automatique des cartes est active pour l'utilisateur courant, le
  // bouton manuel "Télécharger depuis le Cloud" ci-dessous doit rester désactivé et masquer
  // son compteur — cf. useAutoDownstreamPreference.ts.
  const autoDownstream = useAutoDownstreamPreference();
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);
  const [draftsCount, setDraftsCount] = useState<number>(0);
  const [isPublishing, setIsPublishing] = useState<boolean>(false);

  // Résolution de site alignée sur le pattern déjà utilisé par SaisiePage.tsx (même fichier
  // parent) et useDashboardStats.ts : `activeSiteId` (store useAuthStore) ne représente le
  // contexte de site que pour le SUPER ADMIN (sélecteur de site dans la Sidebar) ; pour tous
  // les autres rôles — dont OPERATEUR_SAISIE — `activeSiteId` reste TOUJOURS null (voir
  // useAuthStore.login(): initialSiteId n'est peuplé que pour ADMINISTRATEUR_SITE/ADMIN_CENTRE)
  // et le site réel de l'utilisateur est `user.site_id`. Utiliser `activeSiteId` brut ici
  // empêchait le badge "Mes Brouillons (N)" et la publication de brouillons de fonctionner
  // pour OPERATEUR_SAISIE (`if (!activeSiteId) return;` toujours vrai).
  const effectiveSiteId = user?.role === 'SUPER ADMIN' ? activeSiteId : user?.site_id;

  const fetchDraftsCount = React.useCallback(async () => {
    if (!effectiveSiteId) return;
    try {
      const count = await window.api.cartes.countDrafts(effectiveSiteId, user);
      setDraftsCount(count);
    } catch (err) {
      console.error("Erreur chargement nombre de brouillons:", err);
    }
  }, [effectiveSiteId, user]);

  const { cloudCartesCount, detailedSyncStats, loadStats } = useDashboardStats(user, activeSiteId, false);
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


  // cloudCartesCount vaut -1 en sentinelle d'indisponibilite Supabase (voir
  // sync:getCloudCartesCount cote main) : toute valeur <= 0 doit desactiver le bouton.
  // Meme correctif que AgentVerificationLayout.tsx / AgentQualiteLayout.tsx
  // (cloudCartesCount === 0 ne couvrait pas le cas -1, laissant le bouton actif hors-ligne).
  const pullDisabled = autoDownstream || isPullingCards || cloudCartesCount <= 0;
  // Nombre réellement envoyable (conforme : pas de doublon, pas de date invalide, pas de
  // donnée manquante) — distinct de dirtyCartesCount (brut) pour ne pas activer le bouton
  // sur des cartes que l'envoi rejettera silencieusement.
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
              {isPullingCards && !isBackgroundPulling ? 'TÉLÉCHARGEMENT EN COURS...' : `Télécharger depuis le Cloud${(!autoDownstream && cloudCartesCount > 0) ? ` (${cloudCartesCount.toLocaleString('fr')})` : ''}`}
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
              {isBulkUploading ? 'ENVOI...' : `Synchroniser vers le Cloud${conformeCount > 0 ? ` (${conformeCount.toLocaleString('fr')})` : ''}`}
            </button>

            {/* NOUVEAU BOUTON : PUBLIER BROUILLONS */}
            <button
              onClick={async () => {
                if (!effectiveSiteId) return;
                setIsPublishing(true);
                try {
                  const res = await window.api.cartes.publishDrafts(effectiveSiteId, user);
                  if (res.skippedInvalidDateCount > 0) {
                    toast.success(`${res.publishedCount} brouillon(s) publié(s) et envoyé(s) à la synchronisation. ⚠️ ${res.skippedInvalidDateCount} brouillon(s) ignoré(s) car leur date de naissance est invalide ou manquante — corrigez-les avant de réessayer.`);
                  } else {
                    toast.success(`${res.publishedCount} brouillon(s) publié(s) et envoyé(s) à la synchronisation.`);
                  }
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
