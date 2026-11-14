import { useState, useEffect, useCallback, useRef } from 'react';
import { useCacheStore } from '../../../stores/cacheStore';
import { useAuthStore } from '../../../stores/authStore';
import {
  GOVERNANCE_SCOPE_KEY,
  computeDashboardScopeKey,
  shouldRestoreCache
} from '../../../utils/cacheScope';

/**
 * Instantané « vierge » du cache tableau de bord. Utilisé quand une écriture complète change de
 * portée : sans cela, la fusion `{...ancienCache, ...data}` du store conserverait des champs du
 * site précédent sous la clé de la nouvelle portée (ex. `stats` du site A étiqueté « GLOBAL »).
 */
type DashboardCacheInput = Parameters<ReturnType<typeof useCacheStore.getState>['setDashboardCache']>[0];

const BLANK_DASHBOARD_SNAPSHOT = {
  stats: null,
  globalStats: null,
  sites: [] as unknown[],
  siteSaisiesStats: [] as unknown[],
  siteQualiteStats: [] as unknown[],
  siteLogistiqueStats: [] as unknown[],
  operatorTodayCount: 0,
  operatorRecentSaisies: [] as unknown[],
  dirtyCartesCount: 0,
  dirtyUsersCount: 0,
  cloudCartesCount: 0,
  detailedSyncStats: null
};

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
  // Ref (pas de state, cf. CLAUDE.md §2 low-memory : simple flag, pas de re-render dédié) :
  // mémorise si le dernier loadStats() exécuté portait un filtre centre "ad-hoc" via
  // supervisionFilters?.centreId, pour un rôle qui n'est PAS structurellement centre-scopé
  // (ADMIN_CENTRE reste un cas à part, déjà géré via insertedInMyCentre dans l'effet
  // onCardsReceived ci-dessous, non concerné par ce flag). Sert de garde dans cet effet pour
  // ne jamais incrémenter optimistiquement `stats.total` par-dessus une valeur actuellement
  // scopée à un centre (au lieu du site complet) — corrige une incohérence confirmée par
  // l'audit de non-régression sur le commit b4e917a.
  const isStatsCentreFilteredRef = useRef<boolean>(false);

  // ── Portée du cache (correctif « site actif périmé », D1) ───────────────────────────────
  // `scopeKey` identifie la portée affichée : vue gouvernance, ou site effectif + rôle actif +
  // centre (cf. utils/cacheScope.ts). Le cache n'est restauré que si sa clé correspond, et toute
  // réponse asynchrone arrivée après un changement de portée est ignorée (garde de péremption).
  // `scopeKeyRef` (ref, pas de state : aucun re-render dédié, CLAUDE.md §2) est mis à jour à chaque
  // rendu et lu APRÈS chaque `await` / `.then` : si la portée de l'appel diffère de la portée
  // courante, la réponse est périmée et ne doit ni s'afficher ni toucher au cache.
  const scopeKey = computeDashboardScopeKey({
    role: user?.role,
    activeSiteId,
    userSiteId: user?.site_id,
    centreId: user?.centre_id,
    isGovernanceView
  });
  const scopeKeyRef = useRef<string>(scopeKey);
  scopeKeyRef.current = scopeKey;

  // Écriture COMPLÈTE d'un instantané (fin de chargement) : étiquette la portée ; si le cache
  // appartenait à une autre portée, repart d'un instantané vierge. Ignorée si la portée a changé.
  const commitDashboardSnapshot = (key: string, data: DashboardCacheInput) => {
    if (scopeKeyRef.current !== key) return;
    const store = useCacheStore.getState();
    const base = store.dashboardCache.scopeKey === key ? {} : BLANK_DASHBOARD_SNAPSHOT;
    store.setDashboardCache({ ...base, ...data, scopeKey: key });
  };

  // Mise à jour PARTIELLE asynchrone (compteur cloud, incrément optimiste) : n'écrit que dans un
  // instantané déjà posé et daté de la MÊME portée. Sinon elle créerait (et re-daterait via
  // `cachedAt`) un faux cache « valide » d'une autre portée, ou ressusciterait un cache invalidé.
  const patchDashboardCache = (key: string, data: DashboardCacheInput) => {
    if (scopeKeyRef.current !== key) return;
    const store = useCacheStore.getState();
    if (!store.dashboardCache.cachedAt || store.dashboardCache.scopeKey !== key) return;
    store.setDashboardCache(data);
  };

  const loadGlobalData = async (silent = false) => {
    // Portée de cet appel : toujours la vue gouvernance. Périmé si l'utilisateur a ouvert un site
    // pendant l'attente (la réponse ne doit pas s'afficher ni estampiller le cache du site).
    const isStale = () => scopeKeyRef.current !== GOVERNANCE_SCOPE_KEY;
    try {
      if (!silent) {
        setLoading(true);
        useAuthStore.getState().setInitialDataProgress(20, 'Connexion BDD & Initialisation...');
      }
      const [gStats, sList] = await Promise.all([
        window.api.stats.getGlobal(),
        window.api.hierarchy.getSitesSummary()
      ]);
      if (isStale()) return;
      setGlobalStats(gStats);
      setSites(sList);
      if (!silent) useAuthStore.getState().setInitialDataProgress(85, 'Mise en cache des données...');
      commitDashboardSnapshot(GOVERNANCE_SCOPE_KEY, {
        globalStats: gStats,
        sites: sList
      });
    } catch (e) {
      console.error(e);
    } finally {
      if (!silent && !isStale()) setLoading(false);
      useAuthStore.getState().setInitialDataProgress(100, 'Interface prête');
      setTimeout(() => useAuthStore.getState().setInitialDataLoading(false), 300);
    }
  };

  const loadStats = useCallback(async (silent = false, supervisionFilters?: { centreId?: number; agentId?: number; dateStr?: string }, forceRefresh = false) => {
    // Portée de CET appel (calculée depuis la fermeture, donc cohérente avec les siteIdToUse /
    // centreIdToUse utilisés ci-dessous). Si la portée courante (scopeKeyRef) diffère après un
    // await, la réponse est périmée : elle ne s'affiche pas et n'écrit pas dans le cache.
    const callScopeKey = computeDashboardScopeKey({
      role: user?.role,
      activeSiteId,
      userSiteId: user?.site_id,
      centreId: user?.centre_id,
      isGovernanceView
    });
    const isStale = () => scopeKeyRef.current !== callScopeKey;
    try {
      if (!silent) {
        setLoading(true);
        useAuthStore.getState().setInitialDataProgress(20, 'Vérification des droits d\'accès...');
      }
      const siteIdToUse = user?.role === 'SUPER ADMIN' ? activeSiteId : user?.site_id;
      const centreIdToUse = user?.role === 'ADMIN_CENTRE'
        ? user?.centre_id
        : (supervisionFilters?.centreId !== undefined ? supervisionFilters.centreId : undefined);
      // Mise à jour du flag de garde (voir déclaration du ref ci-dessus) : true uniquement
      // pour un filtre centre "ad-hoc" (supervision) sur un rôle qui n'est pas structurellement
      // centre-scopé. Reste à false pour tous les autres appelants de loadStats (comportement
      // inchangé pour eux).
      isStatsCentreFilteredRef.current = user?.role !== 'ADMIN_CENTRE' && supervisionFilters?.centreId !== undefined;

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
        if (isStale()) return;
        const recents = (recentsRes as any).rows || [];
        if (!silent) useAuthStore.getState().setInitialDataProgress(70, 'Calcul des statistiques de synchronisation...');
        setOperatorTodayCount(todayCount);
        setOperatorRecentSaisies(recents);
        setDirtyCartesCount(cartesCount);
        setDetailedSyncStats(syncStats);

        fetchCloudCountWithRetry(siteIdToUse!).then(count => {
          if (isStale()) return;
          setCloudCartesCount(count);
          patchDashboardCache(callScopeKey, { cloudCartesCount: count });
        }).catch(err => {
          console.error('Failed to fetch cloud count after retries:', err);
          if (!isStale()) setCloudCartesCount(-1);
        });

        if (!silent) useAuthStore.getState().setInitialDataProgress(85, 'Mise en cache et rendu final...');
        commitDashboardSnapshot(callScopeKey, {
          operatorTodayCount: todayCount,
          operatorRecentSaisies: recents,
          dirtyCartesCount: cartesCount
        });
      } else {
        // Chargement des stats KPI avec bridage centre si ADMIN_CENTRE
        if (!silent) useAuthStore.getState().setInitialDataProgress(40, 'Extraction des KPI globaux...');
        const data = await window.api.stats.get(siteIdToUse || undefined, centreIdToUse, forceRefresh);
        if (isStale()) return;
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
          if (isStale()) return;

          // Fetch cloud count non-blockingly (avec retry léger et borné, voir fetchCloudCountWithRetry)
          fetchCloudCountWithRetry(siteIdToUse).then(count => {
            if (isStale()) return;
            setCloudCartesCount(count);
            patchDashboardCache(callScopeKey, { cloudCartesCount: count });
          }).catch(err => {
            console.error('Failed to fetch cloud count after retries:', err);
            if (!isStale()) setCloudCartesCount(-1);
          });

          window.api.sync.getTotalCloudCartesCount(siteIdToUse).then(count => {
            if (isStale()) return;
            setTotalCloudCartesCount(count);
          }).catch(err => {
            console.error('Failed to fetch total cloud count:', err);
            if (!isStale()) setTotalCloudCartesCount(-1);
          });

          if (!silent) useAuthStore.getState().setInitialDataProgress(70, 'Extraction des indicateurs Qualité & Logistique...');
          [qualiteToday, logistiqueToday] = await Promise.all([
            window.api.stats.getSiteQualiteToday(siteIdToUse, centreIdToUse, targetAgentId, targetDateStr),
            window.api.stats.getSiteLogistiqueToday(siteIdToUse, centreIdToUse, targetAgentId, targetDateStr)
          ]);
          if (isStale()) return;
          setSiteSaisiesStats(saisiesToday);
          setSiteQualiteStats(qualiteToday);
          setSiteLogistiqueStats(logistiqueToday);
          setDirtyCartesCount(cartesCount);
          setDirtyUsersCount(usersCount);
          setDetailedSyncStats(syncStats);
        }
 
        if (!silent) useAuthStore.getState().setInitialDataProgress(85, 'Mise en cache et préparation du rendu...');
        commitDashboardSnapshot(callScopeKey, {
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
      if (!silent && !isStale()) setLoading(false);
      useAuthStore.getState().setInitialDataProgress(100, 'Déverrouillage...');
      setTimeout(() => useAuthStore.getState().setInitialDataLoading(false), 300);
    }
  }, [user?.role, user?.site_id, user?.centre_id, user?.id_user, activeSiteId, isGovernanceView]);

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
        // Garde de péremption : portée changée pendant l'attente => réponse ignorée.
        if (scopeKeyRef.current !== scopeKey) return;
        setCloudCartesCount(count);
        patchDashboardCache(scopeKey, { cloudCartesCount: count });
      }).catch(err => {
        // Échec silencieux : on conserve la dernière valeur connue plutôt que de
        // basculer à -1 sur un simple aléa réseau transitoire (le prochain tick
        // ou la prochaine action explicite corrigera la valeur).
        console.error('Failed to refresh cloud count periodically:', err);
      });
    }, CLOUD_COUNT_REFRESH_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [user?.role, user?.site_id, activeSiteId, scopeKey]);

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
      // Garde anti-scope-incertain (cf. déclaration du ref plus haut) : si le dernier
      // loadStats() affichait une vue filtrée par centre (supervision, rôle non
      // structurellement centre-scopé), `stats.total` n'est PAS le total site — on
      // n'incrémente pas plutôt que d'incrémenter une base dont le scope est incertain.
      // Ne concerne pas ADMIN_CENTRE (totalIncrement utilise déjà insertedInMyCentre).
      const skipTotalIncrement = user?.role !== 'ADMIN_CENTRE' && isStatsCentreFilteredRef.current;
      if (totalIncrement > 0 && !skipTotalIncrement) {
        setStats((prev: any) => {
          const next = prev ? { ...prev, total: (prev.total ?? 0) + totalIncrement } : prev;
          // Mise à jour simultanée du cache renderer (risque de régression identifié : un
          // démontage/remontage ultérieur du layout ne doit pas resservir une valeur de
          // cache antérieure au pull). Écriture limitée à un cache de la MÊME portée.
          if (next) {
            patchDashboardCache(scopeKey, { stats: next });
          }
          return next;
        });
      }

      if (user?.role && CENTRE_CARDS_COUNT_ROLES.includes(user.role) && insertedInMyCentre > 0) {
        setCentreCardsCount((prev) => (prev !== null ? prev + insertedInMyCentre : prev));
      }
    });
    return () => unsubscribe();
  }, [user?.role, user?.site_id, user?.centre_id, activeSiteId, scopeKey]);

  useEffect(() => {
    // Restauration instantanée UNIQUEMENT si l'instantané appartient à la portée courante
    // (site effectif + rôle actif + centre, ou vue gouvernance). Un cache sans clé (hérité) ou d'une
    // autre portée est refusé : on remet à zéro les états affichés (sinon l'ancien site resterait
    // visible pendant le chargement) puis on recharge.
    const cache = useCacheStore.getState().dashboardCache;
    let hasCache = false;
    if (shouldRestoreCache(cache, scopeKey)) {
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
      setStats(null);
      setSiteSaisiesStats(prev => (prev.length ? [] : prev));
      setSiteQualiteStats(prev => (prev.length ? [] : prev));
      setSiteLogistiqueStats(prev => (prev.length ? [] : prev));
      setOperatorTodayCount(0);
      setOperatorRecentSaisies(prev => (prev.length ? [] : prev));
      setDirtyCartesCount(0);
      setDirtyUsersCount(0);
      setCloudCartesCount(0);
      setTotalCloudCartesCount(0);
      setDetailedSyncStats(null);
      setCentreCardsCount(null);
      isStatsCentreFilteredRef.current = false;
      if (isGovernanceView) {
        loadGlobalData();
      } else {
        loadStats();
      }
    }
    // Rechargement déclenché par le changement de portée (la clé englobe site actif, gouvernance,
    // rôle actif et centre). loadStats / loadGlobalData restent hors dépendances (comme avant) :
    // ils sont recréés à chaque rendu et l'appel porte la portée de CE rendu.
  }, [scopeKey]); // eslint-disable-line react-hooks/exhaustive-deps

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
