import { useState, useEffect } from 'react';
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

  const loadGlobalData = async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      const [gStats, sList] = await Promise.all([
        window.api.stats.getGlobal(),
        window.api.hierarchy.getSitesSummary()
      ]);
      setGlobalStats(gStats);
      setSites(sList);
      useCacheStore.getState().setDashboardCache({
        globalStats: gStats,
        sites: sList
      });
    } catch (e) {
      console.error(e);
    } finally {
      if (!silent) setLoading(false);
      useAuthStore.getState().setInitialDataLoading(false);
    }
  };

  const loadStats = async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      const siteIdToUse = user?.role === 'SUPER ADMIN' ? activeSiteId : user?.site_id;
      const centreIdToUse = user?.role === 'ADMIN_CENTRE' ? user?.centre_id : undefined;
      
      if (user?.role === 'OPERATEUR_SAISIE') {
        const [todayCount, recents] = await Promise.all([
          window.api.stats.getAgentToday(user.id_user),
          window.api.stats.getAgentRecentSaisies(user.id_user, 15)
        ]);
        setOperatorTodayCount(todayCount);
        setOperatorRecentSaisies(recents);
        useCacheStore.getState().setDashboardCache({
          operatorTodayCount: todayCount,
          operatorRecentSaisies: recents
        });
      } else {
        // Chargement des stats KPI avec bridage centre si ADMIN_CENTRE
        const data = await window.api.stats.get(siteIdToUse || undefined, centreIdToUse);
        setStats(data);
        
        let saisiesToday: any[] = [];
        let cartesCount = 0;
        let usersCount = 0;

        if (siteIdToUse && (user?.role === 'ADMINISTRATEUR_SITE' || user?.role === 'SUPER ADMIN' || user?.role === 'ADMIN_CENTRE')) {
          [saisiesToday, cartesCount, usersCount] = await Promise.all([
            window.api.stats.getSiteSaisieToday(siteIdToUse, centreIdToUse),
            window.api.stats.getUnsyncedCardsCount(siteIdToUse),
            window.api.stats.getUnsyncedUsersCount(siteIdToUse),
          ]);
          const qualiteToday = await window.api.stats.getSiteQualiteToday(siteIdToUse, centreIdToUse);
          const logistiqueToday = await window.api.stats.getSiteLogistiqueToday(siteIdToUse, centreIdToUse);
          setSiteSaisiesStats(saisiesToday);
          setSiteQualiteStats(qualiteToday);
          setSiteLogistiqueStats(logistiqueToday);
          setDirtyCartesCount(cartesCount);
          setDirtyUsersCount(usersCount);
        }

        useCacheStore.getState().setDashboardCache({
          stats: data,
          siteSaisiesStats: saisiesToday,
          siteQualiteStats: siteQualiteStats,
          siteLogistiqueStats: siteLogistiqueStats,
          dirtyCartesCount: cartesCount,
          dirtyUsersCount: usersCount
        });
      }
    } catch (e) { 
      console.error(e); 
    } finally { 
      if (!silent) setLoading(false); 
      useAuthStore.getState().setInitialDataLoading(false);
    }
  };

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
      setLoading(false);
      hasCache = true;
    }

    if (isGovernanceView) {
      loadGlobalData(hasCache);
    } else {
      loadStats(hasCache);
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
    loadGlobalData,
    loadStats
  };
}
