import log from 'electron-log';
import { EventEmitter } from 'events';
import { networkMonitor, NetworkState } from './network-monitor';

import { runUpstream } from './upstream';
import { runDownstream, syncUsersFromCloud, runSyncInitiale, runLogsDownstream, syncCurrentUserActiveStatus } from './downstream';
import { getDatabase } from '../database/connection';
import { processOutboxPending, getOutboxPendingCount } from './outbox.service';
import { purgeEmptyRows } from '../database/queries/maintenance.queries';
import { refreshSecureCurrentUser, getCurrentGrantedRoles, getCurrentUserLogin, stopSessionHeartbeat } from '../auth/session-heartbeat';

// ─── INTERVALLE DU CYCLE DOWNSTREAM AUTOMATIQUE (POST-LOGIN) ────────────────
// 2 heures — déclenché après authentification de l'utilisateur.
// Ce cycle est DISTINCT du cycle d'upload court (30s) de l'upstream.
const AUTO_DOWNSTREAM_INTERVAL_MS = 2 * 60 * 60 * 1000; // 2 heures

// Délai avant le PREMIER downstream automatique après login.
// On attend 10s pour laisser l'UI s'installer complètement.
const AUTO_DOWNSTREAM_INITIAL_DELAY_MS = 10 * 1000; // 10 secondes

// ─── INTERVALLE DU CYCLE DOWNSTREAM COMPTES/RÔLES (SÉCURITÉ) ────────────────
// 3 minutes — dédié EXCLUSIVEMENT à syncUsersFromCloud (comptes/rôles), TOUJOURS
// actif après authentification, quelle que soit la préférence de confort
// `auto_downstream_<id_user>` (celle-ci ne pilote QUE le cycle cartes de 2h
// ci-dessus). Un rôle retiré ou modifié côté Cloud est un enjeu de sécurité :
// il doit se répercuter rapidement sur tous les postes ouverts d'un même site,
// sans attendre le cycle long de 2h ni une fermeture/réouverture de l'application.
const USER_SYNC_INTERVAL_MS = 3 * 60 * 1000; // 3 minutes

// Délai avant le PREMIER cycle comptes/rôles après login — même logique que
// AUTO_DOWNSTREAM_INITIAL_DELAY_MS : laisser l'UI s'installer avant tout appel réseau.
const USER_SYNC_INITIAL_DELAY_MS = 10 * 1000; // 10 secondes

// ─── TYPES EXPORTÉS ─────────────────────────────────────────────────────────
export type AutoDownstreamEvent =
  | { phase: 'start'; siteId: number }
  | { phase: 'done'; siteId: number; count: number; durationMs: number }
  | { phase: 'error'; siteId: number; reason: string }
  | { phase: 'skipped'; reason: 'offline' | 'already-syncing' }
  | { phase: 'scheduled'; nextRunMs: number };

// ─────────────────────────────────────────────────────────────────────────────

/**
 * SyncEngine — Moteur de synchronisation Supabase <-> SQLite.
 *
 * Deux cycles coexistent :
 *  1. CYCLE COURT (30s)   : Upstream uniquement — pousse les opérations locales vers le cloud.
 *  2. CYCLE LONG  (2h)    : Downstream uniquement — rapatrie les cartes du cloud vers le local.
 *     -> Ce cycle ne démarre QU'APRES une authentification réussie (appel de startAutoDownstreamTimer).
 *     -> Il respecte strictement la disponibilité réseau et ne bloque jamais le thread UI.
 *
 * Gestion réseau :
 *  - Si le réseau passe OFFLINE pendant la fenêtre d'attente des 2h, le prochain tick est
 *    simplement sauté (idempotent). Aucun doublon ne peut être créé.
 *  - Si le réseau revient (événement 'online' du NetworkMonitor) alors qu'une fenêtre de
 *    synchronisation est "due" (pendingDownstreamDue !== null), un downstream est déclenché
 *    immédiatement sans attendre la prochaine échéance.
 *
 * Thread Safety :
 *  - isDownstreamRunning protège contre les exécutions concurrentes du cycle long.
 *  - isSyncing protège le cycle court (upload).
 */
class SyncEngine extends EventEmitter {
  // ── Cycle court (Upstream) ────────────────────────────────────────────────
  private syncTimer: NodeJS.Timeout | null = null;
  private isSyncing = false;
  private readonly MIN_SYNC_INTERVAL = 5 * 60 * 1000; // 5 minutes par défaut
  private readonly MAX_SYNC_INTERVAL = 30 * 60 * 1000; // 30 minutes maximum
  private currentSyncInterval = 5 * 60 * 1000; // Intervalle dynamique (Backoff)

  // ── Cycle long (Downstream automatique post-login) ────────────────────────
  /**
   * Timer du cycle de 2 heures.
   * Initialisé par startAutoDownstreamTimer() après login.
   * Détruit par stopAutoDownstreamTimer() après logout ou fermeture.
   */
  private downstreamTimer: NodeJS.Timeout | null = null;

  /** Timer du délai initial avant le premier downstream. */
  private downstreamInitialDelay: NodeJS.Timeout | null = null;

  /**
   * Site ID de l'utilisateur connecté, transmis au moment du login.
   * null = aucun utilisateur connecté -> le cycle long est inactif.
   */
  private activeSiteId: number | null = null;

  /**
   * Verrou anti-concurrence pour le downstream automatique.
   * true = un downstream est en cours, tout nouveau déclenchement est ignoré.
   */
  private isDownstreamRunning = false;

  /**
   * Timestamp de la prochaine synchronisation "due" si on était offline au moment
   * de l'échéance. Permet de déclencher immédiatement au retour du réseau.
   * null = aucune synchronisation en retard.
   */
  private pendingDownstreamDue: number | null = null;

  // ── Cycle dédié comptes/rôles (3 minutes, TOUJOURS actif) ──────────────────
  /**
   * Timer récurrent du cycle de 3 minutes (syncUsersFromCloud uniquement).
   * Initialisé par startUserAccountsSyncTimer() après login.
   * Détruit par stopUserAccountsSyncTimer() après logout ou fermeture.
   */
  private userSyncTimer: NodeJS.Timeout | null = null;

  /** Timer du délai initial avant le premier cycle comptes/rôles. */
  private userSyncInitialDelay: NodeJS.Timeout | null = null;

  /** Site ID pour lequel le cycle comptes/rôles est actif. null = inactif. */
  private activeUserSyncSiteId: number | null = null;

  /**
   * Verrou anti-concurrence dédié au cycle comptes/rôles.
   * Distinct de isDownstreamRunning : ce cycle est indépendant du cycle cartes de 2h.
   */
  private isUserSyncRunning = false;

  /**
   * Référence vers le BrowserWindow principal pour envoyer des notifications
   * discrètes vers le Renderer (footer de l'UI). Injectée via setMainWindow().
   */
  private mainWindowRef: Electron.BrowserWindow | null = null;

  constructor() {
    super();
    // Écoute des changements d'état réseau
    networkMonitor.on('change', ({ newState }: { newState: NetworkState }) => {
      this.handleNetworkChange(newState);
    });
  }

  // ── API publique ──────────────────────────────────────────────────────────

  /**
   * Injecte la référence à la fenêtre principale pour les push IPC.
   * A appeler depuis index.ts après createWindow().
   */
  public setMainWindow(win: Electron.BrowserWindow): void {
    this.mainWindowRef = win;
  }

  /**
   * Démarre le moteur de synchronisation.
   *
   * @param delayMs - Délai optionnel (ms) avant le premier appel à handleNetworkChange.
   *   Utilisé pour garantir que la fenêtre est visible avant toute tentative réseau.
   *   Par défaut : 0 (rétro-compatible), mais index.ts passe 3000ms.
   */
  public init(delayMs = 0): void {
    networkMonitor.start();
    if (delayMs > 0) {
      setTimeout(() => {
        this.handleNetworkChange(networkMonitor.getState());
      }, delayMs);
    } else {
      this.handleNetworkChange(networkMonitor.getState());
    }
    log.info(`[SyncEngine] Moteur de synchronisation initialisé (délai réseau : ${delayMs}ms).`);
  }

  public destroy(): void {
    this.stopSyncCycle();
    this.stopAutoDownstreamTimer();
    this.stopUserAccountsSyncTimer();
    networkMonitor.stop();
  }

  // ── Cycle Long : Downstream automatique post-login ────────────────────────

  /**
   * A appeler immédiatement après une authentification réussie.
   *
   * @param siteId - L'identifiant de site de l'utilisateur connecté.
   *
   * Comportement :
   *  - Un premier downstream est déclenché après AUTO_DOWNSTREAM_INITIAL_DELAY_MS (10s)
   *    pour laisser l'UI s'installer.
   *  - Puis un cycle de 2h s'installe.
   *  - Si le réseau est OFFLINE au moment du tick, le cycle est sauté (pendingDownstreamDue).
   *  - Si le réseau revient alors qu'un cycle était "dû", il se déclenche immédiatement.
   */
  public startAutoDownstreamTimer(siteId: number): void {
    // Idempotence : si un timer récurrent ou un délai initial est déjà actif pour le même site, on l'ignore.
    if ((this.downstreamTimer !== null || this.downstreamInitialDelay !== null) && this.activeSiteId === siteId) {
      log.info(`[SyncEngine][AutoDownstream] Timer (récurrent ou initial) déjà actif pour le site ${siteId}. Ignoré.`);
      return;
    }

    // Si un autre site était actif (changement d'utilisateur), on nettoie d'abord.
    this.stopAutoDownstreamTimer();

    this.activeSiteId = siteId;
    log.info(`[SyncEngine][AutoDownstream] Démarrage du cycle automatique de 2h pour le site ${siteId}.`);

    // Premier déclenchement retardé — laisse l'UI s'afficher complètement
    // avant de lancer une requête réseau vers Supabase.
    this.downstreamInitialDelay = setTimeout(() => {
      this.downstreamInitialDelay = null;
      // On délègue à setImmediate pour sortir du call-stack courant
      // et éviter tout micro-blocage du thread UI.
      setImmediate(() => this.triggerAutoDownstream(siteId));
    }, AUTO_DOWNSTREAM_INITIAL_DELAY_MS);

    // Cycle récurrent de 2 heures
    this.downstreamTimer = setInterval(() => {
      setImmediate(() => this.triggerAutoDownstream(siteId));
    }, AUTO_DOWNSTREAM_INTERVAL_MS);

    // .unref() : le timer n'empêche pas Electron de quitter proprement.
    this.downstreamTimer.unref();

    // Notifier le renderer qu'un cycle est planifié
    this.notifyRenderer('sync:auto-downstream', {
      phase: 'scheduled',
      nextRunMs: AUTO_DOWNSTREAM_INITIAL_DELAY_MS
    } as AutoDownstreamEvent);
  }

  /**
   * A appeler lors d'un logout ou d'une fermeture de session.
   * Stoppe proprement tous les timers du cycle long.
   */
  public stopAutoDownstreamTimer(): void {
    if (this.downstreamInitialDelay !== null) {
      clearTimeout(this.downstreamInitialDelay);
      this.downstreamInitialDelay = null;
    }
    if (this.downstreamTimer !== null) {
      clearInterval(this.downstreamTimer);
      this.downstreamTimer = null;
    }
    if (this.activeSiteId !== null) {
      log.info(`[SyncEngine][AutoDownstream] Cycle automatique arrêté pour le site ${this.activeSiteId}.`);
    }
    this.activeSiteId = null;
    this.pendingDownstreamDue = null;
  }

  // ── Cycle dédié comptes/rôles (3 minutes, TOUJOURS actif) ──────────────────

  /**
   * A appeler immédiatement après une authentification réussie, à côté de
   * startAutoDownstreamTimer().
   *
   * @param siteId - L'identifiant de site de l'utilisateur connecté.
   *
   * Contrairement au cycle cartes de 2h (startAutoDownstreamTimer), ce cycle
   * n'est PAS conditionné par la préférence de confort `auto_downstream_<id_user>` :
   * un rôle retiré ou modifié côté Cloud doit se répercuter rapidement sur tous
   * les postes ouverts, sans dépendre d'une préférence utilisateur. C'est un
   * enjeu de sécurité, pas de confort.
   *
   * Comportement (même pattern que startAutoDownstreamTimer) :
   *  - Un premier cycle est déclenché après USER_SYNC_INITIAL_DELAY_MS (10s).
   *  - Puis un cycle récurrent de 3 minutes s'installe.
   *  - Si le réseau est offline, ou qu'un autre cycle (upstream/verrou global)
   *    est en cours au moment du tick, ce tick est simplement sauté ; le
   *    suivant réessaiera automatiquement 3 minutes plus tard.
   */
  public startUserAccountsSyncTimer(siteId: number): void {
    // Idempotence : si un timer (récurrent ou initial) est déjà actif pour le même site, on l'ignore.
    if ((this.userSyncTimer !== null || this.userSyncInitialDelay !== null) && this.activeUserSyncSiteId === siteId) {
      log.info(`[SyncEngine][UserSync] Timer (récurrent ou initial) déjà actif pour le site ${siteId}. Ignoré.`);
      return;
    }

    // Si un autre site était actif (changement d'utilisateur), on nettoie d'abord.
    this.stopUserAccountsSyncTimer();

    this.activeUserSyncSiteId = siteId;
    log.info(`[SyncEngine][UserSync] Démarrage du cycle de synchronisation comptes/rôles (3 min) pour le site ${siteId}.`);

    this.userSyncInitialDelay = setTimeout(() => {
      this.userSyncInitialDelay = null;
      setImmediate(() => this.triggerUserAccountsSync(siteId));
    }, USER_SYNC_INITIAL_DELAY_MS);

    this.userSyncTimer = setInterval(() => {
      setImmediate(() => this.triggerUserAccountsSync(siteId));
    }, USER_SYNC_INTERVAL_MS);

    // .unref() : le timer n'empêche pas Electron de quitter proprement.
    this.userSyncTimer.unref();
  }

  /**
   * A appeler lors d'un logout ou d'une fermeture de session.
   * Stoppe proprement tous les timers du cycle comptes/rôles.
   */
  public stopUserAccountsSyncTimer(): void {
    if (this.userSyncInitialDelay !== null) {
      clearTimeout(this.userSyncInitialDelay);
      this.userSyncInitialDelay = null;
    }
    if (this.userSyncTimer !== null) {
      clearInterval(this.userSyncTimer);
      this.userSyncTimer = null;
    }
    if (this.activeUserSyncSiteId !== null) {
      log.info(`[SyncEngine][UserSync] Cycle comptes/rôles arrêté pour le site ${this.activeUserSyncSiteId}.`);
    }
    this.activeUserSyncSiteId = null;
  }

  /**
   * Point d'entrée du cycle comptes/rôles (3 minutes).
   * Réutilise telle quelle syncUsersFromCloud (src/main/sync/downstream.ts) —
   * aucune autre opération de synchronisation n'est déclenchée ici.
   *
   * Gardes appliquées (même esprit que triggerAutoDownstream) :
   *  - isUserSyncRunning : anti-chevauchement propre à ce cycle.
   *  - globalSyncLocked : aucun cycle automatique pendant une opération destructrice.
   *  - Réseau ONLINE requis.
   *  - isSyncing (upstream) en cours -> tick sauté, reprise au tick suivant.
   */
  private async triggerUserAccountsSync(siteId: number): Promise<void> {
    if (this.isUserSyncRunning) {
      log.info('[SyncEngine][UserSync] Ignoré : un cycle comptes/rôles précédent est encore en cours.');
      return;
    }

    if (this.globalSyncLocked) {
      log.info('[SyncEngine][UserSync] Ignoré : verrou global actif (opération destructrice en cours).');
      return;
    }

    const networkState = networkMonitor.getState();
    if (networkState !== 'ONLINE') {
      log.info(`[SyncEngine][UserSync] Réseau ${networkState} — cycle sauté (prochain essai dans ${USER_SYNC_INTERVAL_MS / 60000} min).`);
      return;
    }

    // Si un cycle upstream est en cours, on attend le prochain tick (3 min plus tard)
    // pour éviter des conflits de transaction sur SQLite.
    if (this.isSyncing) {
      log.info('[SyncEngine][UserSync] Ignoré : cycle upstream en cours. Reprise au prochain tick.');
      return;
    }

    // Si un downstream (automatique 2h OU un pull manuel via beginManualDownstream)
    // est en cours, on attend le prochain tick. Corrige la collision SQLITE_BUSY
    // observée en production (site 4, 2026-08-16) : ce garde manquait auparavant,
    // alors que triggerAutoDownstream et triggerSync le vérifient déjà tous les deux —
    // le cycle comptes/rôles était le seul écrivain périodique à pouvoir se glisser en
    // parallèle d'un DownloadWorker pendant toute la durée d'un pull (jusqu'à 20+ minutes
    // pour un pull complet).
    if (this.isDownstreamRunning) {
      log.info('[SyncEngine][UserSync] Ignoré : un downstream (automatique ou pull manuel) est en cours. Reprise au prochain tick.');
      return;
    }

    this.isUserSyncRunning = true;
    try {
      await syncUsersFromCloud(siteId);

      // Vérification ciblée du statut_actif Cloud pour le login de la session courante
      // UNIQUEMENT (pas un pull de masse) : syncUsersFromCloud ci-dessus filtre
      // `.eq('statut_actif', 1)` côté Cloud et ne peut donc jamais rapatrier localement
      // une désactivation — sans cet appel, un compte désactivé côté Cloud resterait
      // indéfiniment actif en local tant que l'app n'est pas fermée/rouverte.
      // Skip silencieux si aucune session n'est active sur ce poste (getCurrentUserLogin
      // retourne null après logout/avant login).
      const currentLogin = getCurrentUserLogin();
      if (currentLogin) {
        await syncCurrentUserActiveStatus(currentLogin, siteId);
      }

      // Rafraîchit l'instantané en mémoire de la session serveur (secureCurrentUser) à partir
      // de t_users/t_user_roles, désormais à jour localement grâce aux pulls ci-dessus. Appelé
      // UNIQUEMENT après un pull réussi (jamais dans le catch) : si le pull a échoué, la
      // donnée locale n'a pas bougé, un rafraîchissement n'apporterait rien de nouveau.
      // Purement synchrone (cf. session-heartbeat.ts) — ne bloque pas ce cycle async.
      const refreshResult = refreshSecureCurrentUser();
      log.info(
        `[SyncEngine][UserSync] refreshSecureCurrentUser — changed=${refreshResult.changed}, ` +
        `revoked=${refreshResult.revoked}, disabled=${refreshResult.disabled} (site ${siteId}).`
      );

      // ── Invalidation fail-closed AVANT notification (sécurité) ────────────
      // Cas bloquant (revoked/disabled) : la session en mémoire du process main
      // (secureCurrentUser, currentUserLogin, currentSessionToken, rôles) est invalidée
      // ICI, de façon SYNCHRONE côté main process, AVANT même que le renderer ne soit
      // informé. Les timers dépendants (cycle comptes/rôles 3 min, cycle cartes 2h) sont
      // arrêtés dans la foulée. Ainsi, même si l'event IPC 'auth:session-expired' est perdu
      // (fenêtre minimisée/gelée) ou si le renderer ne coopère pas, le cantonnement
      // site/centre ne peut plus s'appuyer sur un secureCurrentUser obsolète : c'est un
      // fail-closed réel, plus un fail-open reposant sur le seul aller-retour renderer.
      // La notification renderer ci-dessous reste best-effort (UX : afficher le message et
      // rediriger vers /login) mais n'est plus le SEUL rempart de sécurité.
      if (refreshResult.revoked || refreshResult.disabled) {
        await stopSessionHeartbeat();
        this.stopUserAccountsSyncTimer();
        this.stopAutoDownstreamTimer();
        this.notifyRenderer('auth:session-expired', {
          reason: refreshResult.revoked ? 'revoked' : 'disabled'
        });
      } else if (refreshResult.changed) {
        this.notifyRenderer('auth:session-updated', { roles: getCurrentGrantedRoles() ?? [] });
      }
    } catch (err) {
      log.warn(`[SyncEngine][UserSync] Erreur lors de la synchronisation comptes/rôles pour le site ${siteId} :`, err);
    } finally {
      this.isUserSyncRunning = false;
    }
  }

  // ── Cycle Court : Upstream (30s) ──────────────────────────────────────────

  /**
   * Force un cycle de synchronisation complet (upstream + downstream) immédiatement.
   * Accessible via le bouton manuel de l'UI.
   */
  public async forceSync(): Promise<{ success: boolean; message: string }> {
    const state = networkMonitor.getState();
    if (state !== 'ONLINE') {
      return {
        success: false,
        message: `Impossible de synchroniser. L'application est actuellement hors-ligne (${state}).`
      };
    }

    if (this.isSyncing) {
      return { success: false, message: 'Une synchronisation (upstream) est déjà en cours.' };
    }

    if (this.isDownstreamRunning) {
      return { success: false, message: 'Une synchronisation automatique (downstream) est déjà en cours.' };
    }

    log.info('[SyncEngine] Synchronisation manuelle forcée depuis l\'UI.');

    // ── RÉINITIALISATION DU TIMER DE 2 HEURES ──────────────────────────────
    // Si l'utilisateur force manuellement, on repousse la prochaine échéance
    // automatique de 2 heures pour ne pas refaire la même opération de suite.
    if (this.activeSiteId !== null) {
      log.info(`[SyncEngine] Action manuelle détectée : report du cycle automatique pour le site ${this.activeSiteId}.`);
      this.startAutoDownstreamTimer(this.activeSiteId);
    }

    try {
      await this.executeSyncCycle();
      return { success: true, message: 'Synchronisation terminée avec succès.' };
    } catch (err: any) {
      log.error('[SyncEngine] Échec de la synchronisation forcée :', err);
      return { success: false, message: `Échec de la synchronisation: ${err.message || err}` };
    }
  }

  public pause(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
      log.info('[SyncEngine] PAUSÉ (import en cours).');
    }
  }

  public resume(): void {
    if (!this.syncTimer && networkMonitor.getState() === 'ONLINE') {
      this.startSyncCycle();
      log.info('[SyncEngine] REPRIS (import terminé).');
    }
  }

  public isCurrentlySyncing(): boolean {
    return this.isSyncing || this.isDownstreamRunning;
  }

  // ── Verrou downstream manuel (pulls déclenchés depuis l'UI) ───────────────

  /**
   * A appeler par tout pull downstream DÉCLENCHÉ MANUELLEMENT depuis l'UI
   * (ex: IPC 'sync:pullSiteCards', 'sync:forceFullPull') AVANT d'exécuter
   * runDownstream(), pour que sa durée complète (potentiellement de longues
   * minutes lors d'un pull complet) soit visible des autres gardes de
   * concurrence — exactement comme le downstream automatique de 2h
   * (triggerAutoDownstream) qui pose déjà isDownstreamRunning pour toute sa
   * durée.
   *
   * Correctif : avant ce verrou, un pull manuel ne posait AUCUN état partagé
   * pendant son exécution — isDownstreamRunning restait `false` du début à
   * la fin. Résultat observé en production (site 4, cf. diagnostic du
   * 2026-08-16) : le cycle comptes/rôles (3 min, triggerUserAccountsSync) a pu
   * démarrer SON PROPRE write SQLite pendant qu'un DownloadWorker du pull
   * manuel écrivait déjà — collision SQLITE_BUSY ("database is locked").
   *
   * @returns false si un downstream (automatique ou manuel) est déjà en
   *   cours — l'appelant doit alors refuser l'opération plutôt que de
   *   démarrer un second DownloadWorker concurrent.
   */
  public beginManualDownstream(): boolean {
    if (this.isDownstreamRunning) {
      return false;
    }
    this.isDownstreamRunning = true;
    return true;
  }

  /**
   * A appeler dans un bloc `finally`, systématiquement après tout pull
   * démarré via beginManualDownstream() — succès ou échec.
   */
  public endManualDownstream(): void {
    this.isDownstreamRunning = false;
  }

  // ── Verrou Global (Global Sync Lock) ──────────────────────────────────────

  /**
   * Verrou global exclusif pour les opérations destructrices (ex: purge cloud).
   * Ce verrou est DISTINCT des verrous isSyncing et isDownstreamRunning :
   * il est posé manuellement par un handler IPC pendant la durée de l'opération
   * pour interdire tout démarrage de cycle automatique ou manuel concurrent.
   *
   * true = une opération destructrice est en cours → tout nouveau cycle est interdit.
   */
  private globalSyncLocked = false;

  /**
   * Tente de poser le verrou global exclusif.
   * Retourne false si le moteur est déjà actif (isSyncing, isDownstreamRunning
   * ou globalSyncLocked), true si le verrou a été posé avec succès.
   *
   * @param reason - Description de l'opération qui pose le verrou (pour les logs).
   */
  public acquireGlobalSyncLock(reason: string): boolean {
    if (this.isSyncing || this.isDownstreamRunning || this.globalSyncLocked) {
      log.warn(
        `[SyncEngine][GlobalLock] REFUS — acquisition impossible pour '${reason}'. ` +
        `isSyncing=${this.isSyncing}, isDownstreamRunning=${this.isDownstreamRunning}, ` +
        `globalSyncLocked=${this.globalSyncLocked}`
      );
      return false;
    }
    this.globalSyncLocked = true;
    log.info(`[SyncEngine][GlobalLock] Verrou global posé — opération : '${reason}'.`);
    return true;
  }

  /**
   * Libère le verrou global exclusif.
   * Doit IMPÉRATIVEMENT être appelé dans un bloc finally pour garantir
   * que le moteur n'est pas bloqué indéfiniment en cas d'erreur.
   *
   * @param reason - Description de l'opération qui libère le verrou (pour les logs).
   */
  public releaseGlobalSyncLock(reason: string): void {
    this.globalSyncLocked = false;
    log.info(`[SyncEngine][GlobalLock] Verrou global libéré — opération : '${reason}'.`);
  }

  /**
   * Indique si un verrou global exclusif est actif.
   * Consulté avant tout démarrage de cycle upstream ou downstream.
   */
  public isGlobalSyncLocked(): boolean {
    return this.globalSyncLocked;
  }

  // ── Gestion réseau ────────────────────────────────────────────────────────

  private handleNetworkChange(state: NetworkState): void {
    // ── Garde PERMANENT_OFFLINE ───────────────────────────────────────────────
    // Si l'état est PERMANENT_OFFLINE (3 tentatives épuisées), on stoppe TOUS
    // les cycles et on n'autorise aucun nouveau démarrage automatique.
    // Seul un appel à retryConnection() depuis le bouton "Réessayer" peut
    // sortir de cet état.
    if (state === 'PERMANENT_OFFLINE') {
      log.warn('[SyncEngine] État PERMANENT_OFFLINE — tous les cycles de synchronisation sont suspendus.');
      log.warn('[SyncEngine] Cliquez sur "Réessayer" dans l\'interface pour relancer la connexion.');
      this.stopSyncCycle();
      this.stopAutoDownstreamTimer();
      return;
    }

    if (state === 'ONLINE') {
      log.info('[SyncEngine] Réseau ONLINE — démarrage du cycle upstream.');
      this.startSyncCycle();

      // ── Traitement prioritaire de l'Outbox au retour réseau ───────────────
      // Toutes les opérations de création (sites, centres, users) qui étaient
      // PENDING pendant la coupure sont traitées immédiatement, via setImmediate
      // pour ne jamais bloquer le thread UI d'Electron.
      setImmediate(() => {
        const pendingCount = getOutboxPendingCount();
        if (pendingCount > 0) {
          log.info(
            `[SyncEngine][Outbox] Réseau rétabli — ${pendingCount} entrée(s) PENDING détectée(s). ` +
            `Déclenchement du traitement outbox différé.`
          );
        }
        processOutboxPending().catch((err: any) => {
          log.warn('[SyncEngine][Outbox] Erreur lors du traitement outbox au retour réseau :', err);
        });
      });

      // Reprise du downstream en retard
      // Si un downstream était "dû" pendant une coupure réseau, on le déclenche
      // immédiatement au retour de la connexion.
      if (this.pendingDownstreamDue !== null && this.activeSiteId !== null) {
        const overdueMs = Date.now() - this.pendingDownstreamDue;
        log.info(
          `[SyncEngine][AutoDownstream] Réseau rétabli — déclenchement du downstream en retard ` +
          `(${overdueMs} ms) pour le site ${this.activeSiteId}.`
        );
        this.pendingDownstreamDue = null;
        const siteIdSnapshot = this.activeSiteId;
        // Petit délai de 2s pour laisser la connexion se stabiliser.
        setTimeout(() => {
          setImmediate(() => this.triggerAutoDownstream(siteIdSnapshot));
        }, 2_000);
      }
    } else {
      log.info(`[SyncEngine] Réseau ${state} — arrêt du cycle upstream.`);
      this.stopSyncCycle();
    }
  }

  /**
   * Déclenche une nouvelle tentative de connexion réseau depuis l'UI (bouton "Réessayer").
   * Réinitialise le NetworkMonitor depuis l'état PERMANENT_OFFLINE et relance les cycles
   * si la connexion est rétablie.
   */
  public async retryConnection(): Promise<{ success: boolean; state: string }> {
    log.info('[SyncEngine] retryConnection() déclenché depuis l\'UI.');
    try {
      const newState = await networkMonitor.resetAndRetry();
      log.info(`[SyncEngine] retryConnection() terminé — état réseau : ${newState}`);
      return { success: newState === 'ONLINE', state: newState };
    } catch (err: any) {
      log.error('[SyncEngine] Erreur lors de retryConnection() :', err);
      return { success: false, state: 'PERMANENT_OFFLINE' };
    }
  }

  private startSyncCycle(): void {
    if (this.syncTimer) return;

    const runNext = () => {
      if (networkMonitor.getState() !== 'ONLINE') {
        this.syncTimer = null;
        return;
      }
      this.triggerSync();
      this.syncTimer = setTimeout(runNext, this.currentSyncInterval);
      if (typeof this.syncTimer.unref === 'function') {
        this.syncTimer.unref();
      }
    };

    // Premier déclenchement rapide après 2 secondes en ligne
    this.syncTimer = setTimeout(runNext, 2_000);
    if (typeof this.syncTimer.unref === 'function') {
      this.syncTimer.unref();
    }
  }

  private stopSyncCycle(): void {
    if (this.syncTimer) {
      clearTimeout(this.syncTimer);
      this.syncTimer = null;
    }
  }

  private triggerSync(): void {
    if (this.isSyncing) {
      log.info('[SyncEngine] Cycle upstream ignoré : le cycle précédent est encore en cours.');
      return;
    }
    if (this.isDownstreamRunning) {
      log.info('[SyncEngine] Cycle upstream ignoré : un downstream automatique est en cours.');
      return;
    }
    // Vérification du verrou global (ex: purge cloud en cours)
    if (this.globalSyncLocked) {
      log.info('[SyncEngine] Cycle upstream ignoré : verrou global actif (opération destructrice en cours).');
      return;
    }
    this.executeSyncCycle().catch((err) => {
      log.error('[SyncEngine] Échec du cycle upstream périodique :', err);
    });
  }

  // ── Exécution du Downstream automatique ──────────────────────────────────

  /**
   * Point d'entrée du downstream automatique.
   *
   * Garanties :
   *  - Strictement non-bloquant (délégué via setImmediate par l'appelant).
   *  - Idempotent : un seul downstream en cours à la fois (verrou isDownstreamRunning).
   *  - Résilient : si le réseau est OFFLINE, marque l'échéance comme "due" pour reprise.
   */
  private async triggerAutoDownstream(siteId: number): Promise<void> {
    // Vérification du verrou anti-concurrence
    if (this.isDownstreamRunning) {
      log.info('[SyncEngine][AutoDownstream] Ignoré : un downstream est déjà en cours.');
      return;
    }

    // Vérification du verrou global (ex: purge cloud en cours)
    if (this.globalSyncLocked) {
      log.info('[SyncEngine][AutoDownstream] Ignoré : verrou global actif (opération destructrice en cours).');
      this.notifyRenderer('sync:auto-downstream', {
        phase: 'skipped',
        reason: 'already-syncing'
      } as AutoDownstreamEvent);
      return;
    }

    // Vérification de la disponibilité réseau
    const networkState = networkMonitor.getState();
    if (networkState !== 'ONLINE') {
      log.info(
        `[SyncEngine][AutoDownstream] Réseau ${networkState} — cycle de 2h sauté. ` +
        `Mémorisation de l'échéance pour reprise au retour de la connexion.`
      );
      // Mémoriser que ce cycle était "dû" afin de le déclencher dès le retour réseau
      this.pendingDownstreamDue = Date.now();

      this.notifyRenderer('sync:auto-downstream', {
        phase: 'skipped',
        reason: 'offline'
      } as AutoDownstreamEvent);
      return;
    }

    // Si un cycle upstream est en cours, on attend le prochain tick
    // pour éviter des conflits de transaction sur SQLite.
    if (this.isSyncing) {
      log.info('[SyncEngine][AutoDownstream] Ignoré : cycle upstream en cours. Reprise au prochain tick.');
      this.notifyRenderer('sync:auto-downstream', {
        phase: 'skipped',
        reason: 'already-syncing'
      } as AutoDownstreamEvent);
      return;
    }

    // Exécution de la purge locale discrète (maintenance)
    try {
      purgeEmptyRows();
    } catch (e) {
      log.error('[SyncEngine] Erreur lors de purgeEmptyRows :', e);
    }

    // Exécution effective du downstream
    this.isDownstreamRunning = true;
    const startTs = performance.now();

    log.info(`[SyncEngine][AutoDownstream] Déclenchement du downstream automatique pour le site ${siteId}.`);

    // Notifier l'UI : "Synchronisation automatique en cours..."
    this.notifyRenderer('sync:auto-downstream', {
      phase: 'start',
      siteId
    } as AutoDownstreamEvent);

    try {
      // Rapatriement des utilisateurs du site (non-bloquant, catch silencieux)
      try {
        await syncUsersFromCloud(siteId);
      } catch (userSyncErr) {
        log.warn('[SyncEngine][AutoDownstream] syncUsersFromCloud échoué (non-bloquant) :', userSyncErr);
      }

      // Rapatriement des cartes du cloud
      const pulledCount = await runDownstream(siteId);

      // Rapatriement des entrées t_logs CRUD cross-poste (liste blanche CRUD_SYNC_WHITELIST,
      // voir src/main/utils/audit.ts). Isolée dans son propre try/catch : un échec ici ne doit
      // jamais faire échouer le cycle downstream automatique des cartes ci-dessus (déjà terminé
      // avec succès à ce stade). Watermark et cloisonnement site_id dédiés, gérés en interne par
      // runLogsDownstream (src/main/sync/downstream.ts).
      try {
        await runLogsDownstream(siteId);
      } catch (logsSyncErr) {
        log.warn('[SyncEngine][AutoDownstream] runLogsDownstream échoué (non-bloquant) :', logsSyncErr);
      }

      const durationMs = Math.round(performance.now() - startTs);

      log.info(
        `[SyncEngine][AutoDownstream] Downstream terminé — ` +
        `${pulledCount} enregistrement(s) fusionné(s) en ${durationMs} ms.`
      );

      // Notifier l'UI : synchronisation terminée
      this.notifyRenderer('sync:auto-downstream', {
        phase: 'done',
        siteId,
        count: pulledCount,
        durationMs
      } as AutoDownstreamEvent);

      // Le watermark ('last_downstream_sync'/'_id') est déjà avancé de façon précise et
      // transactionnelle par download-worker.js à partir du updated_at/sync_id réel de la
      // dernière carte traitée — ne PAS l'écraser ici avec l'heure locale de la machine :
      // un écart d'horloge (poste non synchronisé NTP) ou une carte écrite sur le cloud
      // pendant ce court instant se retrouverait avec un updated_at antérieur au nouveau
      // watermark et ne serait plus jamais retirée par aucun futur downstream.

      // Notifier le renderer de la mise à jour des données
      this.notifyRenderer('sync:updated-data', { source: 'auto-downstream', siteId, count: pulledCount });

    } catch (err: any) {
      const reason = err?.message ?? String(err);
      log.error(
        `[SyncEngine][AutoDownstream] Erreur lors du downstream pour le site ${siteId} :`, err
      );

      this.notifyRenderer('sync:auto-downstream', {
        phase: 'error',
        siteId,
        reason
      } as AutoDownstreamEvent);
    } finally {
      // Le verrou DOIT être libéré dans le bloc finally pour garantir qu'un
      // échec ne bloque pas tous les cycles suivants.
      this.isDownstreamRunning = false;
    }
  }

  // ── Cycle complet (Upload + Download) ────────────────────────────────────

  private async executeSyncCycle(): Promise<void> {
    if (this.isSyncing || this.isDownstreamRunning) return;
    this.isSyncing = true;

    log.info('[SyncEngine] --- Début du cycle de synchronisation Supabase ---');
    const cycleStart = performance.now();
    try {
      const db = getDatabase();
      if (!db) {
        this.isSyncing = false;
        return;
      }

      // 1. Détection de base vide (Bootstrap)
      const userCountRow = db.prepare("SELECT COUNT(*) as count FROM t_users").get() as { count: number };
      if (userCountRow.count === 0) {
        log.info('[SyncEngine] Base locale vide. Exécution de runSyncInitiale (Bootstrap Global)...');
        await runSyncInitiale();
        this.isSyncing = false;
        return;
      }

      // 2. Vérifier si un utilisateur est actuellement connecté dans cette session
      const siteId = this.activeSiteId;

      if (!siteId) {
        log.info('[SyncEngine] Aucun utilisateur connecté dans cette session. Phase de synchronisation d\'activité ignorée.');
        this.isSyncing = false;
        return;
      }

      // 3. Upstream (Push local -> cloud)
      // ── Priorité 1 : Vider l'Outbox (entités structurelles : sites, centres, users)
      // L'outbox est traitée en premier pour garantir que les entités de référence
      // existent sur Supabase avant d'envoyer les cartes CMU qui en dépendent.
      const outboxPending = getOutboxPendingCount();
      if (outboxPending > 0) {
        log.info(`[SyncEngine][Outbox] ${outboxPending} entrée(s) PENDING — traitement prioritaire avant l'upstream cartes.`);
        try {
          const outboxResult = await processOutboxPending();
          log.info(
            `[SyncEngine][Outbox] Traitement terminé : ${outboxResult.processed} synchronisé(s), ` +
            `${outboxResult.errors} en erreur.`
          );
        } catch (outboxErr: any) {
          log.warn('[SyncEngine][Outbox] Erreur lors du traitement outbox dans le cycle sync (non-bloquant) :', outboxErr);
        }
      }

      // ── Priorité 2 : Upstream des cartes CMU (t_sync_queue) ───────────────────
      log.info('[SyncEngine] Initialisation de la phase Upstream (local -> Supabase)...');
      const upstreamStart = performance.now();
      const pushedCount = await runUpstream();
      const upstreamDuration = performance.now() - upstreamStart;
      if (upstreamDuration > 5000) {
        log.warn(`[SyncEngine][LATENCE] Phase Upstream a pris ${upstreamDuration.toFixed(2)} ms (seuil 5s dépassé).`);
      } else {
        log.info(`[SyncEngine] Phase Upstream terminée. ${pushedCount} opération(s) envoyée(s) en ${upstreamDuration.toFixed(2)} ms.`);
      }

      // ⚠️ IMPORTANT : Le Downstream (Pull cloud -> local) est intentionnellement
      // RETIRÉ du cycle court. Il est géré EXCLUSIVEMENT par le cycle automatique
      // de 2 heures (triggerAutoDownstream) pour éviter tout accès concurrent au
      // fichier SQLite entre deux DownloadWorkers simultanés → database is locked.
      // Le cycle court est UPSTREAM ONLY : Outbox + t_sync_queue.

      const totalItemsSynced = (outboxPending > 0 ? outboxPending : 0) + pushedCount;
      if (totalItemsSynced > 0) {
        if (this.currentSyncInterval !== this.MIN_SYNC_INTERVAL) {
          log.info(`[SyncEngine] Données synchronisées (${totalItemsSynced} items). Réinitialisation de l'intervalle à ${this.MIN_SYNC_INTERVAL / 1000}s.`);
        }
        this.currentSyncInterval = this.MIN_SYNC_INTERVAL;
      } else {
        const previousInterval = this.currentSyncInterval;
        this.currentSyncInterval = Math.min(this.currentSyncInterval * 2, this.MAX_SYNC_INTERVAL);
        if (this.currentSyncInterval !== previousInterval) {
          log.info(`[SyncEngine] Aucune donnée synchronisée. Augmentation de l'intervalle (Backoff) à ${this.currentSyncInterval / 60000} minutes.`);
        }
      }

      const cycleDuration = performance.now() - cycleStart;
      if (cycleDuration > 5000) {
        log.warn(`[SyncEngine][LATENCE] Cycle complet a pris ${cycleDuration.toFixed(2)} ms (seuil 5s dépassé).`);
      } else {
        log.info(`[SyncEngine] --- Cycle Upstream terminé avec succès en ${cycleDuration.toFixed(2)} ms ---`);
      }
    } catch (e) {
      log.error('[SyncEngine] Erreur lors du cycle de synchronisation :', e);
      throw e;
    } finally {
      this.isSyncing = false;
    }
  }

  // ── Utilitaires privés ────────────────────────────────────────────────────

  /**
   * Envoie un événement IPC vers le Renderer principal de façon sécurisée.
   * Ne fait rien si mainWindow n'est pas encore disponible ou si la fenêtre est détruite.
   *
   * @param channel - Le canal IPC (ex: 'sync:auto-downstream').
   * @param payload - Les données à envoyer.
   */
  private notifyRenderer(channel: string, payload: unknown): void {
    try {
      if (
        this.mainWindowRef &&
        !this.mainWindowRef.isDestroyed() &&
        this.mainWindowRef.webContents
      ) {
        this.mainWindowRef.webContents.send(channel, payload);
      }
    } catch (err) {
      log.warn(`[SyncEngine] Impossible d'envoyer la notification IPC '${channel}' :`, err);
    }
  }
}

export const syncEngine = new SyncEngine();
