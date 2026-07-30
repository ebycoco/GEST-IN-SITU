import { useState, useEffect, useCallback } from 'react';
import { useCacheStore } from '../../../stores/cacheStore';
import { useAuthStore } from '../../../stores/authStore';

export function useDashboardStats(user: any, activeSiteId: number | null, isGovernanceView: boolean) {
  const [stats, setStats] = useState<any>(null);
  const [globalStats, setGlobalStats] = useState<any>(null);
  const [sites, setSites] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [operatorTodayCount, setOperatorTodayCount] = useState<number>(0);
  const [operatorRecentSaisies, setOperatorRecentSaisies] = useState<any[]>([]);
  const [siteSaisiesStats, setSiteSaisiesStats] = useState<any[]>([]);
  const [siteQualiteStats, setSiteQualiteStats] = useState<any[]>([]);
  const [siteLogistiqueStats, setSiteLogistiqueStats] = useState<any[]>([]);
  const [dirtyCartesCount, setDirtyCartesCount] = useState<number>(0);
  const [dirtyUsersCount, setDirtyUsersCount] = useState<number>(0);
  const [cloudCartesCount, setCloudCartesCount] = useState<number>(0);
  const [totalCloudCartesCount, setTotalCloudCartesCount] = useState<number>(0);
  const [detailedSyncStats, setDetailedSyncStats] = useState<{ cleanCount: number, missingCount: number, probableCount: number, strictCount: number, invalidCount: number, modifiedCount: number, ghostCount: number } | null>(null);

  const loadGlobalData = async (silent = false) => {
    try {
      if (!silent) {
        setLoading(true);
        useAuthStore.getState().setInitialDataProgress(20, 'Connexion BDD & Initialisation...');
      }
      const [gStats, sList] = await Promise.all([
        window.api.stats.getGlobal(),
        window.api.hierarchy.getSitesSummary()
      ]);
      setGlobalStats(gStats);
      setSites(sList);
      if (!silent) useAuthStore.getState().setInitialDataProgress(85, 'Mise en cache des données...');
      useCacheStore.getState().setDashboardCache({
        globalStats: gStats,
        sites: sList
      });
    } catch (e) {
      console.error(e);
    } finally {
      if (!silent) setLoading(false);
      useAuthStore.getState().setInitialDataProgress(100, 'Interface prête');
      setTimeout(() => useAuthStore.getState().setInitialDataLoading(false), 300);
    }
  };

  const loadStats = useCallback(async (silent = false, supervisionFilters?: { centreId?: number; agentId?: number; dateStr?: string }) => {
    try {
      if (!silent) {
        setLoading(true);
        useAuthStore.getState().setInitialDataProgress(20, 'Vérification des droits d\'accès...');
      }
      const siteIdToUse = user?.role === 'SUPER ADMIN' ? activeSiteId : user?.site_id;
      const centreIdToUse = user?.role === 'ADMIN_CENTRE' 
        ? user?.centre_id 
        : (supervisionFilters?.centreId !== undefined ? supervisionFilters.centreId : undefined);
      
      const targetAgentId = supervisionFilters?.agentId;
      const targetDateStr = supervisionFilters?.dateStr;

      if (user?.role === 'OPERATEUR_SAISIE') {
        if (!silent) useAuthStore.getState().setInitialDataProgress(40, 'Extraction des saisies récentes...');
        const [todayCount, recentsRes, cartesCount, syncStats] = await Promise.all([
          window.api.stats.getAgentToday(user.id_user),
          window.api.stats.getAgentRecentSaisies(user.id_user, 15),
          window.api.stats.getUnsyncedCardsCount(siteIdToUse!),
          window.api.stats.getDetailedSyncStats(siteIdToUse!)
        ]);
        const recents = (recentsRes as any).rows || [];
        if (!silent) useAuthStore.getState().setInitialDataProgress(70, 'Calcul des statistiques de synchronisation...');
        setOperatorTodayCount(todayCount);
        setOperatorRecentSaisies(recents);
        setDirtyCartesCount(cartesCount);
        setDetailedSyncStats(syncStats);

        window.api.sync.getCloudCartesCount(siteIdToUse!).then(count => {
          setCloudCartesCount(count);
          useCacheStore.getState().setDashboardCache({
            ...useCacheStore.getState().dashboardCache,
            cloudCartesCount: count
          });
        }).catch(err => {
          console.error('Failed to fetch cloud count:', err);
          setCloudCartesCount(-1);
        });

        if (!silent) useAuthStore.getState().setInitialDataProgress(85, 'Mise en cache et rendu final...');
        useCacheStore.getState().setDashboardCache({
          operatorTodayCount: todayCount,
          operatorRecentSaisies: recents,
          dirtyCartesCount: cartesCount
        });
      } else {
        // Chargement des stats KPI avec bridage centre si ADMIN_CENTRE
        if (!silent) useAuthStore.getState().setInitialDataProgress(40, 'Extraction des KPI globaux...');
        const data = await window.api.stats.get(siteIdToUse || undefined, centreIdToUse);
        setStats(data);
        
        let saisiesToday: any[] = [];
        let qualiteToday: any[] = [];
        let logistiqueToday: any[] = [];
        let cartesCount = 0;
        let usersCount = 0;
        let cloudCartes = -1;
        let syncStats: any = null;
 
        if (siteIdToUse && (user?.role === 'ADMINISTRATEUR_SITE' || user?.role === 'SUPER ADMIN' || user?.role === 'ADMIN_CENTRE' || user?.role === 'OPERATEUR_QUALITE' || user?.role === 'OPERATEUR_VERIFICATION')) {
          if (!silent) useAuthStore.getState().setInitialDataProgress(50, 'Analyse des données du site...');
          [saisiesToday, cartesCount, usersCount, syncStats] = await Promise.all([
            window.api.stats.getSiteSaisieToday(siteIdToUse, centreIdToUse, targetAgentId, targetDateStr),
            window.api.stats.getUnsyncedCardsCount(siteIdToUse),
            window.api.stats.getUnsyncedUsersCount(siteIdToUse),
            window.api.stats.getDetailedSyncStats(siteIdToUse)
          ]);
          
          // Fetch cloud count non-blockingly
          window.api.sync.getCloudCartesCount(siteIdToUse).then(count => {
            setCloudCartesCount(count);
            useCacheStore.getState().setDashboardCache({
              ...useCacheStore.getState().dashboardCache,
              cloudCartesCount: count
            });
          }).catch(err => {
            console.error('Failed to fetch cloud count:', err);
            setCloudCartesCount(-1);
          });

          window.api.sync.getTotalCloudCartesCount(siteIdToUse).then(count => {
            setTotalCloudCartesCount(count);
          }).catch(err => {
            console.error('Failed to fetch total cloud count:', err);
            setTotalCloudCartesCount(-1);
          });

          if (!silent) useAuthStore.getState().setInitialDataProgress(70, 'Extraction des indicateurs Qualité & Logistique...');
          qualiteToday = await window.api.stats.getSiteQualiteToday(siteIdToUse, centreIdToUse, targetAgentId, targetDateStr);
          logistiqueToday = await window.api.stats.getSiteLogistiqueToday(siteIdToUse, centreIdToUse, targetAgentId, targetDateStr);
          setSiteSaisiesStats(saisiesToday);
          setSiteQualiteStats(qualiteToday);
          setSiteLogistiqueStats(logistiqueToday);
          setDirtyCartesCount(cartesCount);
          setDirtyUsersCount(usersCount);
          setDetailedSyncStats(syncStats);
        }
 
        if (!silent) useAuthStore.getState().setInitialDataProgress(85, 'Mise en cache et préparation du rendu...');
        useCacheStore.getState().setDashboardCache({
          stats: data,
          siteSaisiesStats: saisiesToday,
          siteQualiteStats: qualiteToday,
          siteLogistiqueStats: logistiqueToday,
          dirtyCartesCount: cartesCount,
          dirtyUsersCount: usersCount,
          cloudCartesCount: cloudCartes, // initial state or previous cache if needed, handled above asynchronously
          detailedSyncStats: syncStats
        });
      }
    } catch (e) { 
      console.error(e); 
    } finally { 
      if (!silent) setLoading(false); 
      useAuthStore.getState().setInitialDataProgress(100, 'Déverrouillage...');
      setTimeout(() => useAuthStore.getState().setInitialDataLoading(false), 300);
    }
  }, [user?.role, user?.site_id, user?.centre_id, user?.id_user, activeSiteId]);

  useEffect(() => {
    const cache = useCacheStore.getState().dashboardCache;
    let hasCache = false;
    if (cache.cachedAt) {
      setStats(cache.stats);
      setGlobalStats(cache.globalStats);
      setSites(cache.sites);
      setSiteSaisiesStats(cache.siteSaisiesStats);
      setSiteQualiteStats(cache.siteQualiteStats || []);
      setSiteLogistiqueStats(cache.siteLogistiqueStats || []);
      setOperatorTodayCount(cache.operatorTodayCount);
      setOperatorRecentSaisies(cache.operatorRecentSaisies);
      setDirtyCartesCount(cache.dirtyCartesCount);
      setDirtyUsersCount(cache.dirtyUsersCount);
      setCloudCartesCount(cache.cloudCartesCount || 0);
      if (cache.detailedSyncStats) {
        setDetailedSyncStats(cache.detailedSyncStats);
      }
      setLoading(false);
      hasCache = true;
      // Libérer immédiatement le verrou de chargement global puisque les données sont instantanées
      useAuthStore.getState().setInitialDataLoading(false);
    }

    if (!hasCache) {
      if (isGovernanceView) {
        loadGlobalData();
      } else {
        loadStats();
      }
    }
  }, [activeSiteId, isGovernanceView]);

  return {
    stats,
    globalStats,
    sites,
    loading,
    operatorTodayCount,
    operatorRecentSaisies,
    siteSaisiesStats,
    siteQualiteStats,
    siteLogistiqueStats,
    dirtyCartesCount,
    dirtyUsersCount,
    setDirtyUsersCount,
    cloudCartesCount,
    totalCloudCartesCount,
    detailedSyncStats,
    loadGlobalData,
    loadStats
  };
}
