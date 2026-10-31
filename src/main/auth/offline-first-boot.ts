import log from 'electron-log';

/**
 * Rattrapage du préchargement des comptes sur un poste démarré hors ligne (audit 2026-10-31, P1-3).
 *
 * Contexte : depuis la désactivation du compte seed 'superadmin' (schema.ts), la table t_users n'est
 * jamais vide (COUNT(*) > 0) : `app:checkFirstLaunch` répond false, l'amorçage du sync-engine
 * (count === 0) ne tourne pas, et `preloadUsersFromCloud()` n'est lancé qu'une fois, ~3,5 s après
 * l'affichage de la fenêtre (src/main/index.ts). Si ce préchargement n'aboutit pas (pas de réseau,
 * erreur Supabase), le poste n'a AUCUN compte actif et rien ne relançait le rapatriement au retour
 * du réseau.
 *
 * Ce module arme, uniquement dans ce cas, une écoute de l'événement 'change' du NetworkMonitor :
 *  - à chaque passage vers ONLINE, relance le préchargement (une seule exécution à la fois) ;
 *  - le succès se juge sur l'état réel de la base (au moins un compte statut_actif = 1), car
 *    `preloadUsersFromCloud()` ne rejette pas sur erreur réseau (il journalise et retourne) ;
 *  - après succès, l'écoute est retirée (aucun listener résiduel) ;
 *  - après échec, on attend le prochain passage ONLINE, avec un délai minimal entre deux
 *    tentatives (`minIntervalMs`) pour éviter une rafale si le réseau oscille.
 * Aucune boucle ni minuterie propre : uniquement des événements (politique Low-Memory, CLAUDE.md §2).
 * Ne modifie ni la porte de préchargement (preload-gate.ts), ni app:checkFirstLaunch, ni
 * sync:forceGlobal, ni le sync-engine.
 *
 * Les dépendances sont injectées (NetworkMonitor, comptage, préchargement) pour rester testable
 * sans Electron ni base réelle.
 */

export interface NetworkChangeEvent {
  oldState: string;
  newState: string;
}

/** Sous-ensemble de l'API EventEmitter du NetworkMonitor réellement utilisé ici. */
export interface NetworkChangeSource {
  on(event: 'change', listener: (e: NetworkChangeEvent) => void): unknown;
  off(event: 'change', listener: (e: NetworkChangeEvent) => void): unknown;
}

export interface OfflineBootRecoveryDeps {
  network: NetworkChangeSource;
  /** Nombre de comptes locaux actifs (statut_actif = 1). Peut lever : traité comme « inconnu ». */
  countActiveUsers: () => number;
  /** Préchargement des comptes depuis le cloud (preloadUsersFromCloud en production). */
  preload: () => Promise<void>;
  /** Préchargement possible (client Supabase présent). Faux en E2E isolé / configuration absente. */
  canPreload: () => boolean;
  /** Délai minimal entre deux tentatives (ms). */
  minIntervalMs?: number;
  /** Horloge injectable (tests). */
  now?: () => number;
}

export const OFFLINE_BOOT_RECOVERY_MIN_INTERVAL_MS = 30_000;

export interface OfflineBootRecoveryHandle {
  /** Vrai tant que l'écoute réseau est active. */
  isArmed: () => boolean;
  /** Retire l'écoute (idempotent). */
  disarm: () => void;
  /** Promesse de la tentative en cours, ou null (tests / diagnostic). */
  currentAttempt: () => Promise<void> | null;
}

const NOOP_HANDLE: OfflineBootRecoveryHandle = {
  isArmed: () => false,
  disarm: () => undefined,
  currentAttempt: () => null
};

/** Comptage protégé : null si la lecture échoue (on ne conclut alors ni succès ni échec définitif). */
function safeCount(countActiveUsers: () => number): number | null {
  try {
    const n = countActiveUsers();
    return Number.isFinite(n) ? n : null;
  } catch (err: any) {
    log.warn('[OfflineBoot] Lecture du nombre de comptes actifs impossible :', err?.message || err);
    return null;
  }
}

/**
 * Arme le rattrapage si (et seulement si) le poste n'a aucun compte actif et qu'un préchargement
 * est possible. À appeler APRÈS la tentative initiale de préchargement (réussie ou non).
 * Retourne une poignée inerte si rien n'est armé.
 */
export function armOfflineBootUserRecovery(deps: OfflineBootRecoveryDeps): OfflineBootRecoveryHandle {
  const minIntervalMs = deps.minIntervalMs ?? OFFLINE_BOOT_RECOVERY_MIN_INTERVAL_MS;
  const now = deps.now ?? Date.now;

  if (!deps.canPreload()) return NOOP_HANDLE;
  const initialCount = safeCount(deps.countActiveUsers);
  // Lecture impossible : on ne présume pas d'un poste vide (pas d'écoute ajoutée).
  if (initialCount === null || initialCount > 0) return NOOP_HANDLE;

  let armed = true;
  let inFlight: Promise<void> | null = null;
  let lastAttemptAt = Number.NEGATIVE_INFINITY;

  const disarm = (): void => {
    if (!armed) return;
    armed = false;
    deps.network.off('change', onChange);
  };

  function onChange(e: NetworkChangeEvent): void {
    if (!armed || !e || e.newState !== 'ONLINE' || e.oldState === 'ONLINE') return;
    // Garde de concurrence : une seule tentative à la fois.
    if (inFlight) return;

    // Un autre chemin (sync:forceGlobal, sync-engine) a pu rapatrier les comptes entre-temps.
    const before = safeCount(deps.countActiveUsers);
    if (before !== null && before > 0) {
      log.info('[OfflineBoot] Des comptes actifs sont désormais présents : rattrapage inutile, écoute retirée.');
      disarm();
      return;
    }
    if (!deps.canPreload()) return;

    const t = now();
    if (t - lastAttemptAt < minIntervalMs) {
      log.info('[OfflineBoot] Retour réseau trop rapproché de la tentative précédente : attente du prochain passage en ligne.');
      return;
    }
    lastAttemptAt = t;

    log.info('[OfflineBoot] Réseau revenu et aucun compte actif local : relance du préchargement des comptes.');
    inFlight = (async () => {
      try {
        await deps.preload();
      } catch (err: any) {
        log.warn('[OfflineBoot] Échec du préchargement de rattrapage :', err?.message || err);
      }
      const after = safeCount(deps.countActiveUsers);
      if (after !== null && after > 0) {
        log.info(`[OfflineBoot] Préchargement de rattrapage réussi (${after} compte(s) actif(s)) : écoute réseau retirée.`);
        disarm();
      } else {
        log.warn('[OfflineBoot] Toujours aucun compte actif après le rattrapage : nouvelle tentative au prochain retour du réseau.');
      }
    })().finally(() => {
      inFlight = null;
    });
  }

  deps.network.on('change', onChange);
  log.info('[OfflineBoot] Aucun compte actif local après le préchargement initial : rattrapage armé sur le retour du réseau.');

  return {
    isArmed: () => armed,
    disarm,
    currentAttempt: () => inFlight
  };
}
