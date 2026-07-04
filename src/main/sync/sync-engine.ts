import log from 'electron-log';
import { networkMonitor, NetworkState } from './network-monitor';
import { getSupabaseClient } from './supabase-client';

import { runUpstream } from './upstream';
import { runDownstream, syncUsersFromCloud } from './downstream';
import { getDatabase } from '../database/connection';

class SyncEngine {
  private syncTimer: NodeJS.Timeout | null = null;
  private isSyncing = false;
  private readonly SYNC_INTERVAL = 30 * 1000; // 30 secondes

  constructor() {
    // Écouter les changements d'état réseau
    networkMonitor.on('change', ({ newState }: { newState: NetworkState }) => {
      this.handleNetworkChange(newState);
    });
  }

  public init(): void {
    networkMonitor.start();
    this.handleNetworkChange(networkMonitor.getState());
    log.info('Sync Engine initialized.');
  }

  public destroy(): void {
    this.stopSyncCycle();
    networkMonitor.stop();
  }

  /**
   * Force un cycle de synchronisation immédiatement (par exemple via un bouton dans l'UI).
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
      return { success: false, message: 'Une synchronisation est déjà en cours.' };
    }

    log.info('Manual sync forced from UI.');
    try {
      await this.executeSyncCycle();
      return { success: true, message: 'Synchronisation terminée avec succès.' };
    } catch (err: any) {
      log.error('Forced sync cycle failed:', err);
      return { success: false, message: `Échec de la synchronisation: ${err.message || err}` };
    }
  }

  private handleNetworkChange(state: NetworkState): void {
    if (state === 'ONLINE') {
      log.info('Network is ONLINE. Starting sync cycle.');
      this.startSyncCycle();
    } else {
      log.info(`Network is ${state}. Stopping sync cycle.`);
      this.stopSyncCycle();
    }
  }

  private startSyncCycle(): void {
    if (this.syncTimer) return;
    
    // Premier déclenchement rapide après 2 secondes en ligne
    setTimeout(() => {
      if (networkMonitor.getState() === 'ONLINE') {
        this.triggerSync();
      }
    }, 2000);

    this.syncTimer = setInterval(() => {
      this.triggerSync();
    }, this.SYNC_INTERVAL);
  }

  public pause(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
      log.info('Sync Engine PAUSED (import in progress).');
    }
  }

  public resume(): void {
    if (!this.syncTimer && networkMonitor.getState() === 'ONLINE') {
      this.startSyncCycle();
      log.info('Sync Engine RESUMED (import finished).');
    }
  }

  private stopSyncCycle(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
  }

  private triggerSync(): void {
    this.executeSyncCycle().catch((err) => {
      log.error('Periodic sync cycle failed:', err);
    });
  }

  private async executeSyncCycle(): Promise<void> {
    if (this.isSyncing) return;
    this.isSyncing = true;
    
    log.info('--- Starting Sync Cycle ---');
    try {
      // 1. Upstream (Push local -> cloud)
      log.info('Executing Upstream phase...');
      const pushedCount = await runUpstream();
      log.info(`Upstream phase complete. Pushed ${pushedCount} operations.`);

      // 2. Récupérer le siteId dynamique (ex: du dernier utilisateur connecté ou le site par défaut)
      const db = getDatabase();
      let siteId = 1;
      if (db) {
        try {
          const lastLoggedUser = db.prepare(`
            SELECT site_id FROM t_users 
            WHERE last_login IS NOT NULL 
            ORDER BY last_login DESC LIMIT 1
          `).get() as { site_id?: number } | undefined;
          
          if (lastLoggedUser && lastLoggedUser.site_id) {
            siteId = lastLoggedUser.site_id;
          }
        } catch (err) {
          log.warn('Could not determine site_id from last login user, defaulting to 1:', err);
        }
      }

      // 3. Downstream (Pull cloud -> local)
      log.info(`Executing Downstream phase for siteId ${siteId}...`);
      
      // Rapatrier proactivement les utilisateurs du site avant de traiter les cartes
      try {
        await syncUsersFromCloud(siteId);
      } catch (err) {
        log.error('Error during syncUsersFromCloud:', err);
      }

      const pulledCount = await runDownstream(siteId);
      log.info(`Downstream phase complete. Merged ${pulledCount} records.`);

      log.info('--- Sync Cycle Completed Successfully ---');
    } catch (e) {
      log.error('Error during sync cycle execution:', e);
      throw e;
    } finally {
      this.isSyncing = false;
    }
  }
}

export const syncEngine = new SyncEngine();
