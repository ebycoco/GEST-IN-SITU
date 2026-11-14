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
    detailedSyncStats?: { cleanCount: number, missingCount: number, probableCount: number, strictCount: number, invalidCount: number, modifiedCount: number, ghostCount: number } | null;
    cachedAt: number | null;
    /**
     * Clé de portée (site / rôle actif / centre, ou 'GLOBAL' en gouvernance) de l'instantané.
     * OPTIONNEL : absent/null = cache hérité sans portée connue, jamais restauré par
     * useDashboardStats (cf. src/renderer/src/utils/cacheScope.ts).
     */
    scopeKey?: string | null;
  };
  importCache: {
    cardCount: number | null;
    cachedAt: number | null;
    /** Clé de portée (site / rôle actif) du compteur. OPTIONNEL, voir dashboardCache.scopeKey. */
    scopeKey?: string | null;
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
  centresCache: {
    list: any[];
    cachedAt: number | null;
  };
  retraitsCache: {
    data: any | null;
    trend: any[];
    cachedAt: number | null;
  };
  setDashboardCache: (data: Partial<CacheState['dashboardCache']>) => void;
  setImportCache: (cardCount: number, scopeKey?: string | null) => void;
  setCentreDashboardCache: (data: Partial<CacheState['centreDashboardCache']>) => void;
  setQualiteCache: (stats: any) => void;
  setAgentsCache: (list: any[]) => void;
  setSitesCache: (list: any[]) => void;
  setCentresCache: (list: any[]) => void;
  setRetraitsCache: (data: any, trend: any[]) => void;
  invalidateDashboardCache: () => void;
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
    cachedAt: null,
    scopeKey: null
  },
  importCache: {
    cardCount: null,
    cachedAt: null,
    scopeKey: null
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
  centresCache: {
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
  // 2e paramètre optionnel (rétrocompatible) : sans scopeKey, le cache est enregistré « sans portée »
  // (scopeKey = null) et ImportPage ne le restaurera pas.
  setImportCache: (cardCount, scopeKey) => set({
    importCache: { cardCount, cachedAt: Date.now(), scopeKey: scopeKey ?? null }
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
  setCentresCache: (list) => set({
    centresCache: { list, cachedAt: Date.now() }
  }),
  setRetraitsCache: (data, trend) => set({
    retraitsCache: { data, trend, cachedAt: Date.now() }
  }),
  invalidateDashboardCache: () => set((state) => ({
    dashboardCache: { ...state.dashboardCache, cachedAt: null }
  })),
  clearCache: () => set({
    dashboardCache: { stats: null, globalStats: null, sites: [], siteSaisiesStats: [], siteQualiteStats: [], siteLogistiqueStats: [], operatorTodayCount: 0, operatorRecentSaisies: [], dirtyCartesCount: 0, dirtyUsersCount: 0, cloudCartesCount: 0, cachedAt: null, scopeKey: null },
    importCache: { cardCount: null, cachedAt: null, scopeKey: null },
    centreDashboardCache: { stats: null, cadence: [], cachedAt: null },
    qualiteCache: { stats: null, cachedAt: null },
    agentsCache: { list: [], cachedAt: null },
    sitesCache: { list: [], cachedAt: null },
    centresCache: { list: [], cachedAt: null },
    retraitsCache: { data: null, trend: [], cachedAt: null }
  })
}));
