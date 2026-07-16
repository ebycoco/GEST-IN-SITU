import log from 'electron-log';
import { Worker } from 'worker_threads';
import { join } from 'path';
import { app } from 'electron';
import { getDbPath } from '../database/connection';
import { networkMonitor } from './network-monitor';
import { logAudit } from '../utils/audit';

// ─── SIGNAL D'ANNULATION GLOBAL ─────────────────────────────────────────────
let _currentWorker: Worker | null = null;

/**
 * Annule le bulk upload en cours de façon sûre en terminant le Worker Thread.
 * Idempotent : sans effet si aucun upload n'est actif.
 */
export function cancelBulkUpload(): void {
  if (_currentWorker) {
    log.warn('[BulkUpload] Signal d\'annulation reçu. Interruption du Worker...');
    _currentWorker.terminate();
    _currentWorker = null;
  }
}

/**
 * Pousse en masse toutes les cartes modifiées (is_dirty = 1) d'un site vers Supabase.
 *
 * ARCHITECTURE WORKER THREAD :
 * ────────────────────────────
 * Cette fonction agit uniquement comme un Orchestrateur. Le travail lourd 
 * (SQLite, Supabase, sérialisation JSON, Garbage Collection) est exécuté dans 
 * un processus V8 isolé (`upload-worker.js`) pour garantir que l'interface React
 * reste 100% fluide, même sur des machines à 4Go de RAM.
 *
 * @param siteId        Identifiant du site à synchroniser.
 * @param allowProbable Inclure les doublons probables dans l'envoi.
 * @param allowInvalid  Inclure les cartes à dates invalides dans l'envoi.
 * @param progressCallback Appelé selon le throttle IPC du Worker avec le % d'avancement.
 * @param userLogin     Login de l'agent initiateur (pour l'audit).
 */
export async function runBulkUpload(
  siteId: number,
  allowProbable: boolean,
  allowInvalid: boolean,
  progressCallback: (progress: number) => void,
  userLogin: string = 'system'
): Promise<{ success: boolean; uploadedCount: number; message: string; cancelled?: boolean }> {
  
  const dbPath = getDbPath();
  const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
  const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || '';

  if (!supabaseUrl || !supabaseAnonKey) {
    log.error('[BulkUpload] Configuration Supabase manquante (.env).');
    return { success: false, uploadedCount: 0, message: 'Configuration Supabase manquante.' };
  }

  // Activer le contournement forcé du statut ONLINE pour ignorer la congestion réseau
  networkMonitor.setBypassForceOnline(true);

  // ── Audit de démarrage (SYS_SYNC_CLOUD_START) ─────────────────────────────
  logAudit(userLogin, 'SYS_SYNC_CLOUD_START', {
    site_id: siteId,
    allowProbable,
    allowInvalid,
    timestamp: new Date().toISOString()
  });

  return new Promise((resolve) => {
    // Résolution du chemin vers better-sqlite3 pour le worker (module natif)
    let sqlitePath: string;
    try {
      sqlitePath = require.resolve('better-sqlite3');
    } catch {
      sqlitePath = 'better-sqlite3';
    }

    // Le chemin __dirname pointe vers dist/main en dev et dans l'ASAR en prod.
    // Electron gère nativement le chargement des worker_threads depuis un ASAR.
    const workerPath = join(__dirname, 'workers', 'upload-worker.js');

    log.info(`[BulkUpload] Instanciation du Worker Thread : ${workerPath}`);

    const worker = new Worker(workerPath, {
      workerData: {
        siteId,
        allowProbable,
        allowInvalid,
        dbPath,
        supabaseUrl,
        supabaseAnonKey,
        sqlitePath
      }
    });

    _currentWorker = worker;

    worker.on('message', (msg) => {
      switch (msg.type) {
        case 'start':
          log.info(`[BulkUpload] Worker démarré avec succès. ${msg.total} cartes à synchroniser.`);
          progressCallback(0);
          break;
        case 'progress':
          progressCallback(msg.progress);
          // Optionnel : on peut logger discrètement si nécessaire, 
          // mais le Worker a déjà un log minimal.
          break;
        case 'log':
          if (msg.level === 'error') log.error(`[UploadWorker] ${msg.message}`);
          else if (msg.level === 'warn') log.warn(`[UploadWorker] ${msg.message}`);
          else log.info(`[UploadWorker] ${msg.message}`);
          break;
        case 'done':
          logAudit(userLogin, 'SYS_SYNC_CLOUD_SUCCESS', {
            site_id: siteId,
            uploaded_count: msg.uploadedCount,
            timestamp_fin: new Date().toISOString()
          });
          _currentWorker = null;
          networkMonitor.setBypassForceOnline(false);
          resolve({ success: true, uploadedCount: msg.uploadedCount, message: msg.message });
          break;
        case 'error':
          logAudit(userLogin, 'SYS_SYNC_CLOUD_FAILURE', {
            site_id: siteId,
            error: msg.error,
            timestamp: new Date().toISOString()
          });
          _currentWorker = null;
          networkMonitor.setBypassForceOnline(false);
          resolve({ success: false, uploadedCount: 0, message: `Erreur interne du Worker : ${msg.error}` });
          break;
      }
    });

    worker.on('error', (err: any) => {
      log.error('[BulkUpload] Crash fatal du Worker :', err);
      logAudit(userLogin, 'SYS_SYNC_CLOUD_FAILURE', {
        site_id: siteId,
        error: err.message,
        timestamp: new Date().toISOString()
      });
      _currentWorker = null;
      networkMonitor.setBypassForceOnline(false);
      resolve({ success: false, uploadedCount: 0, message: `Crash du Worker : ${err.message}` });
    });

    worker.on('exit', (code) => {
      if (_currentWorker) {
        // Le worker a été terminé violemment (ex: via cancelBulkUpload())
        log.warn(`[BulkUpload] Le Worker a été terminé (code ${code}).`);
        logAudit(userLogin, 'SYS_SYNC_CLOUD_CANCELLED', {
          site_id: siteId,
          reason: 'Annulation manuelle par l\'agent / Interruption du thread.'
        });
        _currentWorker = null;
        networkMonitor.setBypassForceOnline(false);
        resolve({ success: false, uploadedCount: 0, message: 'Transfert annulé par l\'utilisateur.', cancelled: true });
      } else if (code !== 0) {
        log.error(`[BulkUpload] Le Worker s'est arrêté avec le code ${code}.`);
      }
    });
  });
}
