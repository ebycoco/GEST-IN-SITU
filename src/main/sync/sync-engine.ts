import log from 'electron-log';
import { EventEmitter } from 'events';
import { networkMonitor, NetworkState } from './network-monitor';

import { runUpstream } from './upstream';
import { runDownstream, syncUsersFromCloud, runSyncInitiale } from './downstream';
import { getDatabase } from '../database/connection';
import { processOutboxPending, getOutboxPendingCount } from './outbox.service';

// ─── INTERVALLE DU CYCLE DOWNSTREAM AUTOMATIQUE (POST-LOGIN) ────────────────
// 2 heures — déclenché après authentification de l'utilisateur.
// Ce cycle est DISTINCT du cycle d'upload court (30s) de l'upstream.
const AUTO_DOWNSTREAM_INTERVAL_MS = 2 * 60 * 60 * 1000; // 2 heures

// Délai avant le PREMIER downstream automatique après login.
// On attend 10s pour laisser l'UI s'installer complètement.
const AUTO_DOWNSTREAM_INITIAL_DELAY_MS = 10 * 1000; // 10 secondes

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

  public init(): void {
    networkMonitor.start();
    this.handleNetworkChange(networkMonitor.getState());
    log.info('[SyncEngine] Moteur de synchronisation initialisé.');
  }

  public destroy(): void {
    this.stopSyncCycle();
    this.stopAutoDownstreamTimer();
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

      // Mettre à jour le timestamp de dernière synchronisation en base
      this.updateLastDownstreamSync();

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
   * Met à jour la clé 'last_downstream_sync' dans t_config.
   * Utilise un INSERT OR REPLACE pour garantir l'idempotence.
   */
  private updateLastDownstreamSync(): void {
    try {
      const db = getDatabase();
      if (!db) return;
      const now = new Date().toISOString();
      const emptyUuid = '00000000-0000-0000-0000-000000000000';
      db.transaction(() => {
        const stmt = db.prepare('INSERT OR REPLACE INTO t_config (key, value) VALUES (?, ?)');
        stmt.run('last_downstream_sync', now);
        stmt.run('last_downstream_sync_id', emptyUuid);
      })();
    } catch (err) {
      log.warn('[SyncEngine] Impossible de mettre à jour last_downstream_sync :', err);
    }
  }

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
