import { create } from 'zustand';

interface CacheState {
  dashboardCache: {
    stats: any | null;
    globalStats: any | null;
    sites: any[];
    siteSaisiesStats: any[];
    siteQualiteStats: any[];
    siteLogistiqueStats: any[];
    operatorTodayCount: number;
    operatorRecentSaisies: any[];
    dirtyCartesCount: number;
    dirtyUsersCount: number;
    cloudCartesCount: number;
    detailedSyncStats?: { cleanCount: number, probableCount: number, strictCount: number, invalidCount: number } | null;
    cachedAt: number | null;
  };
  importCache: {
    cardCount: number | null;
    cachedAt: number | null;
  };
  centreDashboardCache: {
    stats: any | null;
    cadence: any[];
    cachedAt: number | null;
  };
  qualiteCache: {
    stats: any | null;
    cachedAt: number | null;
  };
  agentsCache: {
    list: any[];
    cachedAt: number | null;
  };
  sitesCache: {
    list: any[];
    cachedAt: number | null;
  };
  retraitsCache: {
    data: any | null;
    trend: any[];
    cachedAt: number | null;
  };
  setDashboardCache: (data: Partial<CacheState['dashboardCache']>) => void;
  setImportCache: (cardCount: number) => void;
  setCentreDashboardCache: (data: Partial<CacheState['centreDashboardCache']>) => void;
  setQualiteCache: (stats: any) => void;
  setAgentsCache: (list: any[]) => void;
  setSitesCache: (list: any[]) => void;
  setRetraitsCache: (data: any, trend: any[]) => void;
  clearCache: () => void;
}

export const useCacheStore = create<CacheState>((set) => ({
  dashboardCache: {
    stats: null,
    globalStats: null,
    sites: [],
    siteSaisiesStats: [],
    siteQualiteStats: [],
    siteLogistiqueStats: [],
    operatorTodayCount: 0,
    operatorRecentSaisies: [],
    dirtyCartesCount: 0,
    dirtyUsersCount: 0,
    cloudCartesCount: 0,
    cachedAt: null
  },
  importCache: {
    cardCount: null,
    cachedAt: null
  },
  centreDashboardCache: {
    stats: null,
    cadence: [],
    cachedAt: null
  },
  qualiteCache: {
    stats: null,
    cachedAt: null
  },
  agentsCache: {
    list: [],
    cachedAt: null
  },
  sitesCache: {
    list: [],
    cachedAt: null
  },
  retraitsCache: {
    data: null,
    trend: [],
    cachedAt: null
  },
  setDashboardCache: (data) => set((state) => ({
    dashboardCache: { ...state.dashboardCache, ...data, cachedAt: Date.now() }
  })),
  setImportCache: (cardCount) => set({
    importCache: { cardCount, cachedAt: Date.now() }
  }),
  setCentreDashboardCache: (data) => set((state) => ({
    centreDashboardCache: { ...state.centreDashboardCache, ...data, cachedAt: Date.now() }
  })),
  setQualiteCache: (stats) => set({
    qualiteCache: { stats, cachedAt: Date.now() }
  }),
  setAgentsCache: (list) => set({
    agentsCache: { list, cachedAt: Date.now() }
  }),
  setSitesCache: (list) => set({
    sitesCache: { list, cachedAt: Date.now() }
  }),
  setRetraitsCache: (data, trend) => set({
    retraitsCache: { data, trend, cachedAt: Date.now() }
  }),
  clearCache: () => set({
    dashboardCache: { stats: null, globalStats: null, sites: [], siteSaisiesStats: [], siteQualiteStats: [], siteLogistiqueStats: [], operatorTodayCount: 0, operatorRecentSaisies: [], dirtyCartesCount: 0, dirtyUsersCount: 0, cloudCartesCount: 0, cachedAt: null },
    importCache: { cardCount: null, cachedAt: null },
    centreDashboardCache: { stats: null, cadence: [], cachedAt: null },
    qualiteCache: { stats: null, cachedAt: null },
    agentsCache: { list: [], cachedAt: null },
    sitesCache: { list: [], cachedAt: null },
    retraitsCache: { data: null, trend: [], cachedAt: null }
  })
}));
