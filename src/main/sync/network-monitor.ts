import { net } from 'electron';
import log from 'electron-log';
import { EventEmitter } from 'events';

export type NetworkState = 'ONLINE' | 'OFFLINE' | 'PROBING' | 'DEGRADED';

export class NetworkMonitor extends EventEmitter {
  private currentState: NetworkState = 'OFFLINE';
  private pingInterval: NodeJS.Timeout | null = null;
  private consecutiveFailures = 0;
  private consecutiveSuccesses = 0;
  
  // Configuration
  private readonly CHECK_INTERVAL = 30 * 1000; // Ping toutes les 30s
  private readonly FAILURES_FOR_OFFLINE = 6;  // 6 échecs consécutifs (6 * 30s = 3 minutes) pour passer offline
  private readonly SUCCESSES_FOR_ONLINE = 1;   // 1 succès suffit à repasser online
  
  private isChecking = false;
  private bypassForceOnline = false;

  constructor() {
    super();
  }

  public setBypassForceOnline(value: boolean): void {
    this.bypassForceOnline = value;
    log.info(`NetworkMonitor bypassForceOnline set to ${value}`);
  }

  public start(): void {
    if (this.pingInterval) return;
    
    log.info('Network monitor started.');
    
    // CORRECTION N°3 : Le premier check est retardé de 5 secondes.
    // L'ancien comportement déclenchait le ping immédiatement au démarrage,
    // bloquant l'affichage de la fenêtre pendant jusqu'à 7 secondes (ancien timeout).
    // Avec ce délai, la fenêtre a le temps de s'afficher complètement avant
    // que le moniteur réseau ne commence à interroger Supabase.
    setTimeout(() => {
      this.checkConnection();
    }, 5_000);

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
    if (this.bypassForceOnline) {
      return 'ONLINE';
    }
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

      // CORRECTION N°3 : Timeout réduit à 3 secondes (était 7 secondes).
      // L'ancien timeout de 7s bloquait l'affichage de la fenêtre au démarrage
      // car le premier ping était lancé de façon synchrone avec le lancement de l'app.
      const timeout = setTimeout(() => {
        request.abort();
        resolve(false);
      }, 3_000);

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
