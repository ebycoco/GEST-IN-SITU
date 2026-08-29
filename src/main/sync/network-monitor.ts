import { net } from 'electron';
import log from 'electron-log';
import { EventEmitter } from 'events';

// ─── GARDE-FOU E2E (positionnée UNIQUEMENT par e2e/fixtures/electron-app.ts) ─
// Quand cette variable vaut '1', AUCUNE requête réseau réelle ne doit jamais
// atteindre Supabase (ni ping, ni sync) — même via forcePing()/resetAndRetry()
// déclenchés depuis l'UI (bouton "Réessayer"). Jamais positionnée par défaut
// en dev ou en production.
const E2E_DISABLE_SYNC = process.env.GEST_IN_SITU_E2E_DISABLE_SYNC === '1';

export type NetworkState = 'ONLINE' | 'OFFLINE' | 'PROBING' | 'DEGRADED' | 'PERMANENT_OFFLINE';

export class NetworkMonitor extends EventEmitter {
  private currentState: NetworkState = 'OFFLINE';
  private pingInterval: NodeJS.Timeout | null = null;
  private consecutiveFailures = 0;
  private consecutiveSuccesses = 0;

  // ── Configuration ──────────────────────────────────────────────────────────
  private readonly CHECK_INTERVAL = 30 * 1000;       // Ping toutes les 30s
  private readonly FAILURES_FOR_OFFLINE = 6;          // 6 échecs consécutifs (3 min) → OFFLINE
  private readonly SUCCESSES_FOR_ONLINE = 1;          // 1 succès suffit à repasser ONLINE

  /**
   * Nombre maximum de tentatives de ping autorisées pendant la phase de démarrage
   * (avant qu'un utilisateur se connecte). Au-delà, on passe en PERMANENT_OFFLINE
   * et on stoppe DÉFINITIVEMENT le setInterval pour protéger le service réseau d'Electron.
   * L'utilisateur doit cliquer sur "Réessayer" pour relancer une session de 3 pings.
   */
  private readonly MAX_BOOT_RETRIES = 2; // R5: Réduit de 3 à 2 pour accélérer le repli hors-ligne
  private bootPingCount = 0;
  private isPermanentOffline = false;

  private isChecking = false;
  private bypassForceOnline = false;

  constructor() {
    super();
  }

  public setBypassForceOnline(value: boolean): void {
    this.bypassForceOnline = value;
    log.info(`[NetworkMonitor] bypassForceOnline set to ${value}`);
  }

  public start(): void {
    if (E2E_DISABLE_SYNC) {
      log.warn('[NetworkMonitor] Démarrage ignoré : GEST_IN_SITU_E2E_DISABLE_SYNC=1 (contexte E2E isolé).');
      return;
    }
    if (this.pingInterval) return;
    // Si l'état permanent offline a déjà été atteint, ne pas redémarrer le monitor
    if (this.isPermanentOffline) {
      log.warn('[NetworkMonitor] start() ignoré : état PERMANENT_OFFLINE actif. Utilisez resetAndRetry().');
      return;
    }

    log.info('[NetworkMonitor] Démarrage du moniteur réseau.');

    // Premier check retardé de 5s pour laisser la fenêtre s'ouvrir complètement.
    setTimeout(() => {
      this.checkConnection();
    }, 5_000);

    // Planifier les vérifications régulières
    this.pingInterval = setInterval(() => {
      this.checkConnection();
    }, this.CHECK_INTERVAL);

    // .unref() : n'empêche pas Electron de quitter proprement
    if (typeof (this.pingInterval as any).unref === 'function') {
      (this.pingInterval as any).unref();
    }
  }

  public stop(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    log.info('[NetworkMonitor] Moniteur réseau arrêté.');
  }

  public getState(): NetworkState {
    if (this.bypassForceOnline) {
      return 'ONLINE';
    }
    return this.currentState;
  }

  /**
   * Réinitialise l'état PERMANENT_OFFLINE et relance une nouvelle session de
   * MAX_BOOT_RETRIES tentatives. Appelé par le handler IPC 'network:retry'
   * déclenché depuis le bouton "Réessayer" de l'UI.
   */
  public async resetAndRetry(): Promise<NetworkState> {
    log.info('[NetworkMonitor] Réinitialisation manuelle — relance d\'une nouvelle session de connexion.');
    this.isPermanentOffline = false;
    this.bootPingCount = 0;
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses = 0;

    // Stopper l'ancien interval s'il existe encore
    this.stop();

    // Repasser en OFFLINE pour permettre la transition vers PROBING
    if (this.currentState === 'PERMANENT_OFFLINE') {
      this.transitionTo('OFFLINE');
    }

    // Relancer le monitoring
    this.start();

    // Attendre le premier ping et retourner l'état résultant
    await this.checkConnection();
    return this.currentState;
  }

  /**
   * Force le moniteur à abandonner son statut OFFLINE ou PROBING
   * et à réessayer une connexion immédiatement.
   */
  public async forcePing(): Promise<NetworkState> {
    log.info('[NetworkMonitor] Réessai manuel de connexion initié par l\'utilisateur.');
    this.consecutiveFailures = 0; // reset des échecs
    if (this.currentState === 'OFFLINE' || this.currentState === 'DEGRADED') {
      this.transitionTo('PROBING');
    }
    await this.checkConnection();
    return this.currentState;
  }

  private transitionTo(newState: NetworkState): void {
    if (this.currentState === newState) return;

    const oldState = this.currentState;
    this.currentState = newState;

    log.info(`[NetworkMonitor] Transition réseau : ${oldState} -> ${newState}`);
    this.emit('change', { oldState, newState });
  }

  /**
   * Effectue une requête HTTP légère vers Supabase pour valider la connectivité réseau réelle.
   */
  private async checkConnection(): Promise<void> {
    // Rempart final : quel que soit le chemin d'appel (cycle automatique,
    // forcePing(), resetAndRetry() depuis le bouton "Réessayer"...), aucun
    // net.request réel vers Supabase ne doit partir en contexte E2E isolé.
    if (E2E_DISABLE_SYNC) return;
    if (this.isChecking) return;

    // Si on est en PERMANENT_OFFLINE, bloquer tout nouveau ping
    if (this.isPermanentOffline) {
      log.warn('[NetworkMonitor] checkConnection() bloqué : état PERMANENT_OFFLINE actif.');
      return;
    }

    this.isChecking = true;

    // Incrémenter le compteur de boot seulement si on n'est pas encore ONLINE
    if (this.currentState !== 'ONLINE') {
      this.bootPingCount++;
      log.info(`[NetworkMonitor] Tentative de ping ${this.bootPingCount}/${this.MAX_BOOT_RETRIES}`);

      // Vérification de la limite de boot AVANT d'effectuer le ping
      if (this.bootPingCount > this.MAX_BOOT_RETRIES) {
        log.warn(
          `[NetworkMonitor] PERMANENT_OFFLINE — limite de ${this.MAX_BOOT_RETRIES} tentatives atteinte. ` +
          `Arrêt définitif du monitoring. Cliquez sur "Réessayer" pour relancer.`
        );
        this.isPermanentOffline = true;
        this.isChecking = false;
        this.stop(); // Stoppe le setInterval définitivement
        this.transitionTo('PERMANENT_OFFLINE');
        return;
      }
    }

    // Signal primaire : Net d'Electron détecte-t-il une connectivité locale/globale ?
    if (!net.online) {
      this.handleFailure('No local network connection (net.online is false)');
      this.isChecking = false;
      return;
    }

    // Si on était offline ou probing, on signale qu'on est en train de tester (PROBING)
    if (this.currentState === 'OFFLINE') {
      this.transitionTo('PROBING');
    }

    try {
      const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://itvyayakwgzvfqvdrgyv.supabase.co';

      const isOnline = await this.pingEndpoint(`${supabaseUrl}/rest/v1/`);

      if (isOnline) {
        this.handleSuccess();
      } else {
        this.handleFailure('Supabase endpoint unreachable (HTTP error or timeout)');
      }
    } catch (err: any) {
      this.handleFailure(err.message || 'Network request failed');
    } finally {
      this.isChecking = false;
    }
  }

  private pingEndpoint(url: string): Promise<boolean> {
    return new Promise((resolve) => {
      const request = net.request({
        method: 'GET',
        url: url,
        redirect: 'manual'
      });

      // Timeout à 5 secondes (relevé de 2s — un délai trop court faisait compter comme
      // "échec" une connexion terrain simplement lente/à latence élevée, ex. réseau
      // mobile dégradé en Côte d'Ivoire, provoquant des bascules PERMANENT_OFFLINE à tort
      // dès le démarrage — cf. investigation agent-4-db-sync sur le blocage silencieux de
      // la synchro montante après import). MAX_BOOT_RETRIES reste inchangé (2, soit 3
      // tentatives) : seule la marge par tentative est élargie, pas leur nombre.
      const timeout = setTimeout(() => {
        request.abort();
        resolve(false);
      }, 5_000);

      request.on('response', (response) => {
        clearTimeout(timeout);
        // Supabase REST répond généralement par un 400 ou 401 si non auth,
        // mais cela prouve que le serveur est joignable et qu'on a internet.
        resolve(response.statusCode >= 200 && response.statusCode < 500);
      });

      request.on('error', () => {
        clearTimeout(timeout);
        resolve(false);
      });

      request.end();
    });
  }

  private handleSuccess(): void {
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses++;
    // Quand on passe ONLINE, réinitialiser le compteur de boot (session active)
    this.bootPingCount = 0;

    if (this.consecutiveSuccesses >= this.SUCCESSES_FOR_ONLINE) {
      this.transitionTo('ONLINE');
    }
  }

  private handleFailure(reason: string): void {
    this.consecutiveSuccesses = 0;
    this.consecutiveFailures++;

    log.warn(`[NetworkMonitor] Échec ping (${this.consecutiveFailures}/${this.FAILURES_FOR_OFFLINE}) : ${reason}`);

    if (this.consecutiveFailures === 1 && this.currentState === 'ONLINE') {
      // Première perte de connexion : état dégradé (on attend avant de déclarer offline)
      this.transitionTo('DEGRADED');
    } else if (this.consecutiveFailures >= this.FAILURES_FOR_OFFLINE) {
      // Limite atteinte (3 minutes) : on déclare offline
      this.transitionTo('OFFLINE');
    }
  }
}

export const networkMonitor = new NetworkMonitor();
