import React, { useState, useEffect } from 'react';
import { Outlet, NavLink, useLocation } from 'react-router-dom';
import {
  Building2, Database, Globe, RefreshCw,
  LayoutDashboard, CreditCard, Search, BarChart2, Clock, FileText, Users
} from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { toast } from 'react-hot-toast';

export default function AdminCentreLayout() {
  const { user } = useAuthStore();
  const [centreName, setCentreName] = useState<string>('');
  
  // Sync States
  const [isPullingCards, setIsPullingCards] = useState<boolean>(false);
  const [isSyncingUsers, setIsSyncingUsers] = useState<boolean>(false);
  const [isBulkUploading, setIsBulkUploading] = useState<boolean>(false);
  const [cloudCartesCount, setCloudCartesCount] = useState<number>(0);
  const [detailedSyncStats, setDetailedSyncStats] = useState<any>(null);
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

  // Fetch Centre Name and initial sync counts
  useEffect(() => {
    const fetchBaseData = async () => {
      if (user?.centre_id && user?.site_id) {
        try {
          if (window.api.hierarchy.getCentreById) {
            const currentCentre = await window.api.hierarchy.getCentreById(Number(user.centre_id));
            if (currentCentre) setCentreName(currentCentre.nom);
          } else {
            const centres = await window.api.hierarchy.getCentres(user.site_id);
            const currentCentre = centres.find((c: any) => Number(c.id) === Number(user.centre_id));
            if (currentCentre) setCentreName(currentCentre.nom);
          }

          window.api.sync.getCloudCartesCount(user.site_id).then(count => {
            setCloudCartesCount(count);
          }).catch(console.error);

          const syncStats = await window.api.stats.getDetailedSyncStats(user.site_id);
          if (syncStats) setDetailedSyncStats(syncStats);

        } catch (error) {
          console.error("Erreur lors du chargement des infos de base:", error);
        }
      }
    };
    fetchBaseData();
    const interval = setInterval(fetchBaseData, 30000);

    // Bug identique à celui corrigé sur AgentSaisieLayout.tsx/AgentQualiteLayout.tsx (délivrance
    // de carte sans recalcul du compteur qui pilote le bouton "Synchroniser") : la route enfant
    // /admin-centre/recherche (VerificationSearchPage, autonome, sans props ni
    // useOutletContext) dispatch désormais 'app:data-updated' après une délivrance réussie (cf.
    // useDeliveryFlow.ts) mais ce layout ne l'écoutait pas — cloudCartesCount/detailedSyncStats
    // (qui pilotent RÉCUPÉRER/"Synchroniser mes saisies") ne se recalculaient donc plus jamais
    // avant le prochain tick de l'intervalle (30s). fetchBaseData() est déjà idempotent et sans
    // effet de bord (simple re-fetch), donc rappelable ici sans garde supplémentaire.
    const handleDataUpdated = () => { fetchBaseData(); };
    window.addEventListener('app:data-updated', handleDataUpdated);

    return () => {
      clearInterval(interval);
      window.removeEventListener('app:data-updated', handleDataUpdated);
    };
  }, [user]);

  // Actions
  const handlePullSiteCards = async () => {
    if (!user?.site_id) return;
    setIsPullingCards(true);
    const toastId = toast.loading('☁️ Récupération des cartes depuis le cloud...');
    try {
      const res = await window.api.sync.pullSiteCards(Number(user.site_id), user);
      if (res.success) {
        toast.success(res.count > 0 ? `✅ Récupération réussie ! ${res.count} carte(s) modifiée(s).` : "✅ Vos données locales sont déjà à jour.", { id: toastId, duration: 4000 });
        // Force refresh des compteurs de conformité
        const detailedSyncStats = await window.api.stats.getDetailedSyncStats(user.site_id);
        if (detailedSyncStats) setDetailedSyncStats(detailedSyncStats);
      } else {
        toast.error(`Échec de récupération : ${res.message || 'Erreur inconnue'}`, { id: toastId, duration: 6000 });
      }
    } catch (err: any) {
      toast.error(`Échec : ${err.message || err}`, { id: toastId });
    } finally {
      setIsPullingCards(false);
    }
  };

  const handleSyncUsers = async () => {
    if (!user?.site_id) return;
    setIsSyncingUsers(true);
    const toastId = toast.loading('☁️ Synchronisation des utilisateurs...');
    try {
      const res = await window.api.sync.syncUsersFromSupabase(Number(user.site_id), user);
      if (res.success) {
        toast.success(res.count && res.count > 0 ? `✅ ${res.count} utilisateur(s) synchronisé(s).` : "✅ Utilisateurs à jour.", { id: toastId, duration: 4000 });
      } else {
        toast.error(`Échec : ${res.message || 'Erreur inconnue'}`, { id: toastId });
      }
    } catch (err: any) {
      toast.error(`Échec : ${err.message || err}`, { id: toastId });
    } finally {
      setIsSyncingUsers(false);
    }
  };

  const handleStartBulkUpload = async () => {
    if (!user?.site_id) return;
    setIsBulkUploading(true);
    const toastId = toast.loading("Envoi des données vers le cloud...");
    try {
      const res = await window.api.sync.startBulk(Number(user.site_id), false, false, false);
      if (res.success) {
        toast.success(res.message, { id: toastId });
        if ((res.strictCount || 0) > 0 || (res.probableCount || 0) > 0 || (res.invalidCount || 0) > 0) {
           toast.error(`Des anomalies ont bloqué l'envoi de certaines cartes. Veuillez les corriger dans l'onglet Cartes.`, { duration: 6000 });
        }
        setDetailedSyncStats((prev: any) => prev ? { ...prev, cleanCount: 0, modifiedCount: 0 } : prev); // Update optimiste, en attendant le prochain tick
      } else {
        toast.error(res.message || "Erreur de synchronisation", { id: toastId });
      }
    } catch (err: any) {
      toast.error(`Échec de l'envoi : ${err.message || err}`, { id: toastId });
    } finally {
      setIsBulkUploading(false);
    }
  };

  const pullDisabled = isPullingCards || cloudCartesCount === 0;
  // Nombre réellement envoyable (conforme : pas de doublon, pas de date invalide, pas de
  // donnée manquante) — distinct du compte brut is_dirty pour ne pas activer le bouton sur
  // des cartes que l'envoi rejettera silencieusement.
  const conformeCount = (detailedSyncStats?.cleanCount || 0) + (detailedSyncStats?.modifiedCount || 0);
  const pushDisabled = isBulkUploading || conformeCount === 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', backgroundColor: 'var(--bg-primary)' }}>
      {/* En-tête Premium Supervision */}
      <div style={{
        padding: '24px 32px 16px',
        borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
        background: 'linear-gradient(to bottom, rgba(15, 23, 42, 0.6) 0%, transparent 100%)',
        display: 'flex',
        flexDirection: 'column',
        gap: 20
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 900, color: 'white', margin: 0, display: 'flex', alignItems: 'center', gap: 12 }}>
              <Building2 color="#3b82f6" size={28} />
              PORTAIL SUPERVISION
            </h1>
            <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '4px 0 0 0' }}>
              Centre de {centreName || '...'}
            </p>
          </div>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <button 
              onClick={handleSyncUsers} 
              disabled={isSyncingUsers }
              className="btn-outline" 
              style={{ ...syncBtnStyle, cursor: (isSyncingUsers ) ? 'not-allowed' : 'pointer', opacity: (isSyncingUsers ) ? 0.5 : 1 }}
            >
              <RefreshCw size={18} style={{ animation: isSyncingUsers ? 'spin 1.5s linear infinite' : 'none' }} />
              {isSyncingUsers ? '...' : 'UTILISATEURS'}
            </button>

            <button 
              onClick={handlePullSiteCards} 
              disabled={pullDisabled}
              className="btn-outline" 
              style={{ ...syncBtnStyle, cursor: pullDisabled ? 'not-allowed' : 'pointer', opacity: pullDisabled ? 0.5 : 1 }}
            >
              <Database size={18} style={{ animation: isPullingCards ? 'spin 1.5s linear infinite' : 'none' }} />
              {isPullingCards ? 'RÉCUPÉRATION...' : `RÉCUPÉRER${cloudCartesCount > 0 ? ` (${cloudCartesCount.toLocaleString('fr')})` : ''}`}
            </button>

              <button
                onClick={handleStartBulkUpload}
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
                {isBulkUploading ? 'ENVOI...' : `Synchroniser mes saisies${conformeCount > 0 ? ` (${conformeCount.toLocaleString('fr')})` : ''}`}
              </button>
          </div>
        </div>

        {/* Navigation Modulaire */}
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
          <NavLink to="/admin-centre" end className="tab-link" style={getNavLinkStyle}>
            <LayoutDashboard size={16} /> Tableau de Bord
          </NavLink>
          <NavLink to="/admin-centre/cartes" className="tab-link" style={getNavLinkStyle}>
            <CreditCard size={16} /> Cartes CMU
          </NavLink>
          <NavLink to="/admin-centre/recherche" className="tab-link" style={getNavLinkStyle}>
            <Search size={16} /> Recherche CMU
          </NavLink>
          <NavLink to="/admin-centre/retraits" className="tab-link" style={getNavLinkStyle}>
            <BarChart2 size={16} /> Suivi des Retraits
          </NavLink>
          <NavLink to="/admin-centre/queue" className="tab-link" style={getNavLinkStyle}>
            <Clock size={16} /> File d'attente
          </NavLink>
          <NavLink to="/admin-centre/logs" className="tab-link" style={getNavLinkStyle}>
            <FileText size={16} /> Journaux
          </NavLink>
          <NavLink to="/admin-centre/equipe" className="tab-link" style={getNavLinkStyle}>
            <Users size={16} /> Mon équipe
          </NavLink>
        </div>
      </div>

      {/* Contenu de la sous-page */}
      <div style={{ flex: 1, overflow: 'auto', padding: '24px 32px' }}>
        <Outlet />
      </div>
    </div>
  );
}

const syncBtnStyle = {
  padding: '10px 18px', 
  borderRadius: 12, 
  fontWeight: 700,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '8px',
  border: '1px solid rgba(255, 255, 255, 0.1)',
  background: 'rgba(255, 255, 255, 0.03)',
  color: 'white',
  whiteSpace: 'nowrap' as any
};

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
  } : {}),
  whiteSpace: 'nowrap' as any
});
