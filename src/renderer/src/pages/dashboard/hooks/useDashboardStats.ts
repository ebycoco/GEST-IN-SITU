import { useState, useEffect, useCallback } from 'react';
import { useCacheStore } from '../../../stores/cacheStore';
import { useAuthStore } from '../../../stores/authStore';

/**
 * Récupère le compteur de cartes cloud avec un retry léger et borné (2-3 tentatives).
 *
 * Contexte (asynchrone / résilience) : juste après une transition réseau OFFLINE→ONLINE,
 * ou juste après un remontage de l'écran, le client Supabase côté main process peut ne pas
 * être encore pleinement stabilisé au moment du tout premier appel IPC — l'appel échoue une
 * fois, et sans retry le compteur reste figé à sa valeur précédente (potentiellement 0/périmée)
 * jusqu'à un futur remontage manuel de l'écran.
 *
 * Bornage : nombre de tentatives et délai fixes, PAS de polling illimité (conforme à la
 * politique low-memory du projet, CLAUDE.md §2). N'affecte pas le rendu (fire-and-forget côté
 * appelant) — seul le setTimeout interne est asynchrone.
 */
async function fetchCloudCountWithRetry(
  siteId: number,
  maxAttempts = 3,
  delayMs = 2500
): Promise<number> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await window.api.sync.getCloudCartesCount(siteId);
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }
  throw lastError;
}

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
  const [centreCardsCount, setCentreCardsCount] = useState<number | null>(null);

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

  const loadStats = useCallback(async (silent = false, supervisionFilters?: { centreId?: number; agentId?: number; dateStr?: string }, forceRefresh = false) => {
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

        fetchCloudCountWithRetry(siteIdToUse!).then(count => {
          setCloudCartesCount(count);
          useCacheStore.getState().setDashboardCache({
            ...useCacheStore.getState().dashboardCache,
            cloudCartesCount: count
          });
        }).catch(err => {
          console.error('Failed to fetch cloud count after retries:', err);
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
        const data = await window.api.stats.get(siteIdToUse || undefined, centreIdToUse, forceRefresh);
        setStats(data);
        
        let saisiesToday: any[] = [];
        let qualiteToday: any[] = [];
        let logistiqueToday: any[] = [];
        let cartesCount = 0;
        let usersCount = 0;
        let cloudCartes = -1;
        let syncStats: any = null;
 
        if (siteIdToUse && (user?.role === 'ADMINISTRATEUR_SITE' || user?.role === 'SUPER ADMIN' || user?.role === 'ADMIN_CENTRE' || user?.role === 'OPERATEUR_QUALITE' || user?.role === 'OPERATEUR_VERIFICATION' || user?.role === 'OPERATEUR_INVENTAIRE' || user?.role === 'OPERATEUR_LOGISTIQUE' || user?.role === 'OPERATEUR_APUREMENT')) {
          if (!silent) useAuthStore.getState().setInitialDataProgress(50, 'Analyse des données du site...');
          [saisiesToday, cartesCount, usersCount, syncStats] = await Promise.all([
            window.api.stats.getSiteSaisieToday(siteIdToUse, centreIdToUse, targetAgentId, targetDateStr),
            window.api.stats.getUnsyncedCardsCount(siteIdToUse),
            window.api.stats.getUnsyncedUsersCount(siteIdToUse),
            window.api.stats.getDetailedSyncStats(siteIdToUse)
          ]);
          
          // Fetch cloud count non-blockingly (avec retry léger et borné, voir fetchCloudCountWithRetry)
          fetchCloudCountWithRetry(siteIdToUse).then(count => {
            setCloudCartesCount(count);
            useCacheStore.getState().setDashboardCache({
              ...useCacheStore.getState().dashboardCache,
              cloudCartesCount: count
            });
          }).catch(err => {
            console.error('Failed to fetch cloud count after retries:', err);
            setCloudCartesCount(-1);
          });

          window.api.sync.getTotalCloudCartesCount(siteIdToUse).then(count => {
            setTotalCloudCartesCount(count);
          }).catch(err => {
            console.error('Failed to fetch total cloud count:', err);
            setTotalCloudCartesCount(-1);
          });

          if (!silent) useAuthStore.getState().setInitialDataProgress(70, 'Extraction des indicateurs Qualité & Logistique...');
          [qualiteToday, logistiqueToday] = await Promise.all([
            window.api.stats.getSiteQualiteToday(siteIdToUse, centreIdToUse, targetAgentId, targetDateStr),
            window.api.stats.getSiteLogistiqueToday(siteIdToUse, centreIdToUse, targetAgentId, targetDateStr)
          ]);
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

  // ── Rafraîchissement périodique léger du compteur cloud ──────────────────────
  // Le compteur "N cartes à télécharger" n'est jusqu'ici recalculé qu'au montage
  // de la page ou après une action explicite (pull réussi). Si un AUTRE poste
  // ajoute des cartes sur Supabase pendant que cette page reste ouverte, le
  // compteur reste figé jusqu'au prochain remontage. On le rafraîchit donc seul
  // (PAS tout loadStats, qui recalculerait aussi tous les autres KPI) toutes les
  // 3 minutes tant qu'un site actif est déterminé — intervalle volontairement
  // large et appel réseau léger (COUNT Supabase), conforme à la politique
  // Low-Memory (CLAUDE.md §2) : pas de polling agressif.
  useEffect(() => {
    const siteIdToUse = user?.role === 'SUPER ADMIN' ? activeSiteId : user?.site_id;
    if (!siteIdToUse) return undefined;

    const CLOUD_COUNT_ROLES = [
      'OPERATEUR_SAISIE', 'ADMINISTRATEUR_SITE', 'SUPER ADMIN', 'ADMIN_CENTRE',
      'OPERATEUR_QUALITE', 'OPERATEUR_VERIFICATION', 'OPERATEUR_INVENTAIRE',
      'OPERATEUR_LOGISTIQUE', 'OPERATEUR_APUREMENT'
    ];
    if (!user?.role || !CLOUD_COUNT_ROLES.includes(user.role)) return undefined;

    const CLOUD_COUNT_REFRESH_INTERVAL_MS = 3 * 60 * 1000; // 3 minutes
    const interval = setInterval(() => {
      fetchCloudCountWithRetry(siteIdToUse).then(count => {
        setCloudCartesCount(count);
        useCacheStore.getState().setDashboardCache({
          ...useCacheStore.getState().dashboardCache,
          cloudCartesCount: count
        });
      }).catch(err => {
        // Échec silencieux : on conserve la dernière valeur connue plutôt que de
        // basculer à -1 sur un simple aléa réseau transitoire (le prochain tick
        // ou la prochaine action explicite corrigera la valeur).
        console.error('Failed to refresh cloud count periodically:', err);
      });
    }, CLOUD_COUNT_REFRESH_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [user?.role, user?.site_id, activeSiteId]);

  // ── Badge "cartes du centre" (généralisé depuis AgentVerificationLayout.tsx) ────────────
  // Contexte : le badge `stats.total` reste volontairement scopé au SITE pour la plupart des
  // rôles (recherche multi-centre autorisée, cf. correctif RechercheView.tsx). Ce second badge
  // est un appel IPC indépendant, avec `centreId` explicitement fourni, pour afficher en plus
  // le sous-total propre au centre de l'utilisateur. Restreint aux rôles qui en ont l'usage
  // (pattern de gating identique à CLOUD_COUNT_ROLES ci-dessus) pour ne pas déclencher un appel
  // réseau superflu sur les rôles sans ce badge à l'écran.
  const CENTRE_CARDS_COUNT_ROLES = ['OPERATEUR_VERIFICATION', 'ADMIN_CENTRE'];
  useEffect(() => {
    let cancelled = false;
    if (!user?.role || !CENTRE_CARDS_COUNT_ROLES.includes(user.role)) {
      setCentreCardsCount(null);
      return undefined;
    }
    const siteIdToUse = user?.role === 'SUPER ADMIN' ? activeSiteId : user?.site_id;
    if (siteIdToUse && user?.centre_id) {
      window.api.stats.get(siteIdToUse, user.centre_id)
        .then((s: any) => { if (!cancelled) setCentreCardsCount(s?.total ?? 0); })
        .catch(() => { if (!cancelled) setCentreCardsCount(null); });
    }
    return () => { cancelled = true; };
  }, [user?.site_id, user?.centre_id, user?.role, activeSiteId]);

  // ── Rafraîchissement dynamique des compteurs sur ajout de carte en tâche de fond ──────────
  // Abonnement à 'sync:cards-received' (émis UNIQUEMENT par les cycles automatiques silencieux,
  // voir downstream.ts) : incrémentation optimiste de stats.total et centreCardsCount, SANS
  // requête SQL complète, quand une carte est effectivement AJOUTÉE (jamais sur une simple
  // mise à jour). Le badge site s'incrémente pour tout ajout ; le badge centre uniquement si
  // l'ajout concerne le centre de l'utilisateur connecté (insertedInMyCentre).
  // Abonnement IPC nettoyé au démontage (politique low-memory, CLAUDE.md §2).
  useEffect(() => {
    if (!window.api?.sync?.onCardsReceived) return undefined;
    const unsubscribe = window.api.sync.onCardsReceived((data) => {
      const insertedCount = data?.insertedCount ?? 0;
      const insertedInMyCentre = data?.insertedInMyCentre ?? 0;
      if (insertedCount <= 0) return;

      // Garde anti-décalage site (cas SUPER ADMIN en vue gouvernance d'un site différent
      // du site de connexion) : ignorer toute notification ne concernant pas le site affiché.
      const siteIdToUse = user?.role === 'SUPER ADMIN' ? activeSiteId : user?.site_id;
      if (data?.siteId != null && siteIdToUse != null && Number(data.siteId) !== Number(siteIdToUse)) {
        return;
      }

      const totalIncrement = user?.role === 'ADMIN_CENTRE' ? insertedInMyCentre : insertedCount;
      if (totalIncrement > 0) {
        setStats((prev: any) => {
          const next = prev ? { ...prev, total: (prev.total ?? 0) + totalIncrement } : prev;
          // Mise à jour simultanée du cache renderer (risque de régression identifié : un
          // démontage/remontage ultérieur du layout ne doit pas resservir une valeur de
          // cache antérieure au pull).
          if (next) {
            useCacheStore.getState().setDashboardCache({
              ...useCacheStore.getState().dashboardCache,
              stats: next
            });
          }
          return next;
        });
      }

      if (user?.role && CENTRE_CARDS_COUNT_ROLES.includes(user.role) && insertedInMyCentre > 0) {
        setCentreCardsCount((prev) => (prev !== null ? prev + insertedInMyCentre : prev));
      }
    });
    return () => unsubscribe();
  }, [user?.role, user?.site_id, user?.centre_id, activeSiteId]);

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
    centreCardsCount,
    loadGlobalData,
    loadStats
  };
}
