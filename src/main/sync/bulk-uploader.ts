import log from 'electron-log';
import { Worker } from 'worker_threads';
import { join } from 'path';
import { app } from 'electron';
import { getDbPath, getDatabase } from '../database/connection';
import { networkMonitor } from './network-monitor';
import { logAudit } from '../utils/audit';
import { checkHierarchyAlignmentForUpload } from './outbox.service';

// ─── SIGNAL D'ANNULATION GLOBAL ─────────────────────────────────────────────
let _currentWorker: Worker | null = null;
// Envoi en cours (de l'entrée de runBulkUpload jusqu'à sa résolution) et annulation demandée : l'annulation
// est retenue même avant la création du worker (contrôle d'alignement cloud en cours).
let _uploadActive = false;
let _cancelRequested = false;
// Réveille aussitôt le contrôle d'alignement en cours quand l'agent annule (sinon l'annulation n'est vue
// qu'à la fin de la vérification : jusqu'à 15 s).
let _wakeOnCancel: (() => void) | null = null;

/** Délai maximal du contrôle d'alignement cloud avant l'envoi en masse (réseau terrain lent). */
export const ALIGNMENT_CHECK_TIMEOUT_MS = 15000;

/**
 * Annule le bulk upload en cours de façon sûre en terminant le Worker Thread.
 * Idempotent : sans effet si aucun upload n'est actif.
 */
export function cancelBulkUpload(): void {
  if (!_uploadActive) return;
  _cancelRequested = true;
  log.warn('[BulkUpload] Signal d\'annulation reçu.');
  _wakeOnCancel?.();
  // _currentWorker reste renseigné : le gestionnaire 'exit' conclut l'envoi comme annulé.
  if (_currentWorker) _currentWorker.terminate();
}

const CANCELLED_RESULT = { success: false, uploadedCount: 0, message: 'Transfert annulé par l\'utilisateur.', cancelled: true };

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
  allowMissing: boolean,
  onlyModified: boolean = false,
  centreId: number | null = null,
  progressCallback: (progress: number) => void,
  userLogin: string = 'system'
): Promise<{ success: boolean; uploadedCount: number; message: string; cancelled?: boolean; refused?: boolean }> {

  // ─── GARDE-FOU E2E (positionnée UNIQUEMENT par e2e/fixtures/electron-app.ts) ─
  // Ce flux construit son propre client Supabase à partir des variables d'env
  // DANS le Worker Thread (upload-worker.js), en contournant entièrement
  // getSupabaseClient() ET networkMonitor (il force explicitement
  // setBypassForceOnline(true) juste après). Il doit donc être coupé ici,
  // avant tout accès aux credentials ou démarrage du worker. Jamais
  // positionnée par défaut en dev ou en production.
  if (process.env.GEST_IN_SITU_E2E_DISABLE_SYNC === '1') {
    log.warn('[BulkUpload] Upload annulé : GEST_IN_SITU_E2E_DISABLE_SYNC=1 (contexte E2E isolé).');
    return { success: false, uploadedCount: 0, message: 'Synchronisation désactivée en contexte de test E2E.' };
  }

  const dbPath = getDbPath();
  const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
  const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || '';

  if (!supabaseUrl || !supabaseAnonKey) {
    log.error('[BulkUpload] Configuration Supabase manquante (.env).');
    return { success: false, uploadedCount: 0, message: 'Configuration Supabase manquante.' };
  }

  _uploadActive = true;
  _cancelRequested = false;
  try {
    // ── Garde d'alignement (plan site_id, commit 7) : le worker envoie les cartes avec les ids LOCAUX
    // de site/centre. Sur un poste non réaligné, ils peuvent désigner un autre site dans le cloud (§3) :
    // l'envoi est alors refusé (réalignement au prochain démarrage). Centres : ceux des cartes à envoyer.
    // Délai maximal ALIGNMENT_CHECK_TIMEOUT_MS : un réseau bloqué ne fige pas la fenêtre de transfert.
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const db = getDatabase();
      const centreIds = db
        ? (db.prepare(`
            SELECT DISTINCT centre_id FROM t_cartes
            WHERE site_id = ? AND is_dirty = 1 AND centre_id IS NOT NULL ${centreId ? 'AND centre_id = ?' : ''}
          `).all(...(centreId ? [siteId, centreId] : [siteId])) as { centre_id: number }[]).map(r => r.centre_id)
        : [];
      const timeout = new Promise<{ ok: false; reason: string; timedOut: true }>(resolve => {
        timer = setTimeout(() => resolve({ ok: false, reason: 'vérification du site dans le cloud impossible (réseau, délai dépassé).', timedOut: true }), ALIGNMENT_CHECK_TIMEOUT_MS);
      });
      const cancelWake = new Promise<{ ok: false; reason: string }>(resolve => {
        _wakeOnCancel = () => resolve({ ok: false, reason: 'annulé' });
      });
      const alignment = await Promise.race([
        checkHierarchyAlignmentForUpload(siteId, centreId && !centreIds.includes(centreId) ? [...centreIds, centreId] : centreIds),
        timeout,
        cancelWake
      ]);
      if (_cancelRequested) {
        log.warn('[BulkUpload] Annulé pendant la vérification du site : worker non démarré.');
        return CANCELLED_RESULT;
      }
      if (!alignment.ok) {
        log.warn(`[BulkUpload] Envoi en masse refusé pour le site ${siteId} : ${alignment.reason}`);
        const advice = /réseau/.test(alignment.reason)
          ? 'Vérifiez la connexion et réessayez.'
          : 'Redémarrez l\'application et attendez la fin du chargement avant de vous connecter.';
        // refused : refus avant tout envoi (aucune carte partie) — le handler IPC rend la main aussitôt.
        return { success: false, uploadedCount: 0, message: `Envoi refusé : ${alignment.reason} ${advice}`, refused: true };
      }
    } catch (err: any) {
      log.error('[BulkUpload] Garde d\'alignement en échec :', err?.message || err);
      return { success: false, uploadedCount: 0, message: 'Vérification du site impossible : envoi annulé.', refused: true };
    } finally {
      clearTimeout(timer);
      _wakeOnCancel = null;
    }

    return await startUploadWorker(siteId, allowProbable, allowInvalid, allowMissing, onlyModified, centreId, progressCallback, userLogin, dbPath, supabaseUrl, supabaseAnonKey);
  } finally {
    _uploadActive = false;
    _cancelRequested = false;
    _currentWorker = null;
  }
}

function startUploadWorker(
  siteId: number,
  allowProbable: boolean,
  allowInvalid: boolean,
  allowMissing: boolean,
  onlyModified: boolean,
  centreId: number | null,
  progressCallback: (progress: number) => void,
  userLogin: string,
  dbPath: string,
  supabaseUrl: string,
  supabaseAnonKey: string
): Promise<{ success: boolean; uploadedCount: number; message: string; cancelled?: boolean }> {

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
        centreId,
        allowProbable,
        allowInvalid,
        allowMissing,
        onlyModified,
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
          if (msg.success === false) {
            logAudit(userLogin, 'SYS_SYNC_CLOUD_FAILURE', {
              site_id: siteId,
              error: msg.message,
              uploaded_count: msg.uploadedCount,
              timestamp: new Date().toISOString()
            });
          } else {
            logAudit(userLogin, 'SYS_SYNC_CLOUD_SUCCESS', {
              site_id: siteId,
              uploaded_count: msg.uploadedCount,
              timestamp_fin: new Date().toISOString()
            });
          }
          _currentWorker = null;
          networkMonitor.setBypassForceOnline(false);
          // msg.success === false : le worker a terminé sans pouvoir tout envoyer (réseau défaillant).
          resolve({ success: msg.success !== false, uploadedCount: msg.uploadedCount, message: msg.message });
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
        // Sortie sans message 'done'/'error' : annulation (cancelBulkUpload) ou arrêt inattendu du thread.
        log.warn(`[BulkUpload] Le Worker a été terminé (code ${code}).`);
        _currentWorker = null;
        networkMonitor.setBypassForceOnline(false);
        if (_cancelRequested) {
          logAudit(userLogin, 'SYS_SYNC_CLOUD_CANCELLED', {
            site_id: siteId,
            reason: 'Annulation manuelle par l\'agent / Interruption du thread.'
          });
          resolve(CANCELLED_RESULT);
        } else {
          logAudit(userLogin, 'SYS_SYNC_CLOUD_FAILURE', {
            site_id: siteId,
            error: `Worker arrêté sans résultat (code ${code})`,
            timestamp: new Date().toISOString()
          });
          resolve({ success: false, uploadedCount: 0, message: `Le transfert s'est arrêté de façon inattendue (code ${code}).` });
        }
      } else if (code !== 0) {
        log.error(`[BulkUpload] Le Worker s'est arrêté avec le code ${code}.`);
      }
    });
  });
}
