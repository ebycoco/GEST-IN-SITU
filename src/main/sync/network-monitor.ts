import { net } from 'electron';
import log from 'electron-log';
import { EventEmitter } from 'events';

export type NetworkState = 'ONLINE' | 'OFFLINE' | 'PROBING' | 'DEGRADED';

class NetworkMonitor extends EventEmitter {
  private currentState: NetworkState = 'OFFLINE';
  private pingInterval: NodeJS.Timeout | null = null;
  private consecutiveFailures = 0;
  private consecutiveSuccesses = 0;
  
  // Configuration
  private readonly CHECK_INTERVAL = 30 * 1000; // Ping toutes les 30s
  private readonly FAILURES_FOR_OFFLINE = 6;  // 6 échecs consécutifs (6 * 30s = 3 minutes) pour passer offline
  private readonly SUCCESSES_FOR_ONLINE = 1;   // 1 succès suffit à repasser online
  
  private isChecking = false;

  constructor() {
    super();
  }

  public start(): void {
    if (this.pingInterval) return;
    
    log.info('Network monitor started.');
    
    // Premier check immédiat
    this.checkConnection();

    // Planifier les vérifications régulières
    this.pingInterval = setInterval(() => {
      this.checkConnection();
    }, this.CHECK_INTERVAL);
  }

  public stop(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    log.info('Network monitor stopped.');
  }

  public getState(): NetworkState {
    return this.currentState;
  }

  private transitionTo(newState: NetworkState): void {
    if (this.currentState === newState) return;
    
    const oldState = this.currentState;
    this.currentState = newState;
    
    log.info(`Network state transition: ${oldState} -> ${newState}`);
    this.emit('change', { oldState, newState });
  }

  /**
   * Effectue une requête HTTP légère vers Supabase pour valider la connectivité réseau réelle.
   */
  private async checkConnection(): Promise<void> {
    if (this.isChecking) return;
    this.isChecking = true;

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

      // Timeout après 7 secondes
      const timeout = setTimeout(() => {
        request.abort();
        resolve(false);
      }, 7000);

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

    if (this.consecutiveSuccesses >= this.SUCCESSES_FOR_ONLINE) {
      // Si on était instable, on repasse en ligne
      this.transitionTo('ONLINE');
    }
  }

  private handleFailure(reason: string): void {
    this.consecutiveSuccesses = 0;
    this.consecutiveFailures++;

    log.warn(`Network ping failure (${this.consecutiveFailures}/${this.FAILURES_FOR_OFFLINE}): ${reason}`);

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
