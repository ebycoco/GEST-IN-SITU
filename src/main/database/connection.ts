import Database from 'better-sqlite3';
import { app } from 'electron';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { runMigrations, SCHEMA_VERSION } from './schema';
import { invalidateCentresColumnsCache } from './queries/hierarchy.queries';
import log from 'electron-log';

let db: Database.Database | null = null;
let ftsCheckTimer: ReturnType<typeof setTimeout> | null = null;

// ─── Maintenance FTS5 différée ──────────────────────────────────────────────
/** Clé t_config (table clé/valeur existante, aucune migration) : date ISO du dernier contrôle FTS5 réussi. */
export const FTS_CHECK_CONFIG_KEY = 'fts_integrity_last_check';
/** Périodicité du contrôle complet. */
export const FTS_CHECK_INTERVAL_DAYS = 7;
/** Délai après initDatabase() : la fenêtre principale est affichée bien avant. */
export const FTS_CHECK_DELAY_MS = 90_000;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Report du contrôle quand l'application est occupée (sync, import, purge) au déclenchement. */
export const FTS_BUSY_RETRY_DELAY_MS = 5 * 60_000;
/** Nombre maximal de reports (12 × 5 min = 1 h) avant abandon pour la session en cours. */
export const FTS_BUSY_MAX_RETRIES = 12;

/**
 * Garde « occupé » du contrôle FTS5 différé. Fournie par index.ts (setFtsMaintenanceBusyCheck)
 * pour que ce module n'importe ni le moteur de sync ni les handlers IPC (pas de dépendance
 * circulaire : handlers.ts et sync-engine.ts dépendent eux-mêmes de la couche base de données).
 * null = aucune garde enregistrée (tests, démarrage incomplet) → considéré « libre ».
 */
let ftsBusyCheck: (() => boolean) | null = null;

/**
 * Enregistre (ou retire avec null) le rappel indiquant qu'une opération lourde est en cours
 * (synchronisation, import, purge). Appelé une fois depuis index.ts après l'enregistrement des
 * handlers IPC ; le rappel n'est consulté qu'au déclenchement du timer FTS5 différé.
 */
export function setFtsMaintenanceBusyCheck(fn: (() => boolean) | null): void {
  ftsBusyCheck = fn;
}

/**
 * Lit la garde « occupé ». En cas d'erreur du rappel, on considère l'application OCCUPÉE :
 * lancer à l'aveugle un contrôle synchrone de plusieurs secondes pendant une écriture massive
 * est le risque que cette garde doit éviter, alors qu'un report ne coûte rien (le nombre de
 * reports est borné par FTS_BUSY_MAX_RETRIES, puis le contrôle est retenté au démarrage suivant).
 */
function isFtsMaintenanceBusy(): boolean {
  if (!ftsBusyCheck) return false;
  try {
    return ftsBusyCheck() === true;
  } catch (err) {
    log.warn('[FTS5] Garde « occupé » en erreur, contrôle FTS5 reporté par prudence :', err);
    return true;
  }
}

export type FtsMaintenanceOutcome = 'skipped' | 'ok' | 'rebuilt' | 'rebuild-failed' | 'error';

/** Date du dernier contrôle réussi (null si jamais fait ou illisible). */
function readFtsLastCheck(database: Database.Database): Date | null {
  try {
    const row = database.prepare('SELECT value FROM t_config WHERE key = ?').get(FTS_CHECK_CONFIG_KEY) as { value: string } | undefined;
    if (!row?.value) return null;
    const t = Date.parse(row.value);
    return Number.isNaN(t) ? null : new Date(t);
  } catch {
    return null;
  }
}

export function markFtsIntegrityChecked(database: Database.Database, now: Date): void {
  try {
    database.prepare("INSERT OR REPLACE INTO t_config (key, value, updated_at) VALUES (?, ?, datetime('now'))")
      .run(FTS_CHECK_CONFIG_KEY, now.toISOString());
  } catch (err) {
    log.warn("[FTS5] Impossible d'enregistrer la date du contrôle FTS5 (il sera refait au prochain démarrage) :", err);
  }
}

/**
 * Contrôle dû si : jamais fait, date illisible, au moins FTS_CHECK_INTERVAL_DAYS jours écoulés,
 * ou date enregistrée dans le futur de plus d'un jour (horloge du poste faussée puis corrigée).
 */
export function isFtsIntegrityCheckDue(database: Database.Database, now: Date): boolean {
  const last = readFtsLastCheck(database);
  if (!last) return true;
  const elapsed = now.getTime() - last.getTime();
  if (elapsed < -DAY_MS) return true;
  return elapsed >= FTS_CHECK_INTERVAL_DAYS * DAY_MS;
}

/**
 * Contrôle d'intégrité FTS5 de t_cartes_fts + reconstruction en cas de corruption
 * (mêmes commandes, mêmes conditions et mêmes messages de log que l'ancien contrôle de démarrage).
 * La date n'est enregistrée qu'après un contrôle réussi ou une reconstruction réussie : en cas
 * d'erreur inconnue ou d'échec du rebuild, le contrôle sera retenté au démarrage suivant.
 *
 * ATTENTION : better-sqlite3 est synchrone. Le contrôle (et un éventuel 'rebuild') bloque le
 * processus principal pendant son exécution (≈0,5 s à chaud, jusqu'à ~13 s à froid sur disque
 * lent ; rebuild ≈12 s mesuré dans fts-maintenance.ts). Accepté car l'appel est différé hors
 * démarrage et rare (au plus une fois tous les FTS_CHECK_INTERVAL_DAYS jours). Pas de worker :
 * le rebuild écrit et tient le verrou d'écriture, un worker ne le rendrait pas moins bloquant
 * pour les écritures du processus principal, pour une complexité supplémentaire.
 */
export function runFtsIntegrityMaintenance(database: Database.Database, now: Date = new Date()): FtsMaintenanceOutcome {
  if (!isFtsIntegrityCheckDue(database, now)) {
    log.info(`[FTS5] Contrôle d'intégrité non dû (dernier contrôle il y a moins de ${FTS_CHECK_INTERVAL_DAYS} jours).`);
    return 'skipped';
  }
  const start = Date.now();
  try {
    database.exec("INSERT INTO t_cartes_fts(t_cartes_fts) VALUES('integrity-check');");
    log.info(`FTS5 Index integrity check passed. (différé, ${Date.now() - start} ms)`);
    markFtsIntegrityChecked(database, now);
    return 'ok';
  } catch (err: any) {
    const message = String(err?.message ?? '');
    if (err?.code === 'SQLITE_CORRUPT_VTAB' || message.includes('malformed') || message.includes('corrupt')) {
      log.warn('FTS5 Index is corrupted. Rebuilding...');
      try {
        database.exec("INSERT INTO t_cartes_fts(t_cartes_fts) VALUES('rebuild');");
        log.info(`FTS5 Index successfully rebuilt. (${Date.now() - start} ms)`);
        markFtsIntegrityChecked(database, now);
        return 'rebuilt';
      } catch (rebuildErr) {
        log.error('Failed to rebuild FTS5 index:', rebuildErr);
        return 'rebuild-failed';
      }
    }
    log.error('FTS5 Integrity check failed with unknown error:', err);
    return 'error';
  }
}

/**
 * Planifie le contrôle FTS5 différé (un seul timer actif, unref : ne retient pas la fermeture ;
 * closeDatabase() annule le timer en cours, y compris un report).
 *
 * Garde « occupé » : si le contrôle est dû mais qu'une synchronisation, un import ou une purge
 * est en cours au déclenchement, le contrôle (synchrone, bloquant le processus principal) est
 * reporté de FTS_BUSY_RETRY_DELAY_MS, au plus FTS_BUSY_MAX_RETRIES fois. Au-delà, abandon pour
 * cette session SANS enregistrer de date : le contrôle sera retenté au prochain démarrage.
 * La garde n'est consultée que si le contrôle est dû (sinon aucun report inutile).
 */
function scheduleFtsIntegrityMaintenance(
  database: Database.Database,
  delayMs: number = FTS_CHECK_DELAY_MS,
  retriesDone: number = 0
): void {
  if (ftsCheckTimer) clearTimeout(ftsCheckTimer);
  ftsCheckTimer = setTimeout(() => {
    ftsCheckTimer = null;
    // La connexion a pu être fermée ou remplacée entre-temps (fermeture, restauration).
    if (db !== database || !database.open) return;
    try {
      if (isFtsIntegrityCheckDue(database, new Date()) && isFtsMaintenanceBusy()) {
        if (retriesDone < FTS_BUSY_MAX_RETRIES) {
          log.info(`[FTS5] Application occupée (sync/import/purge) : contrôle FTS5 reporté de ${FTS_BUSY_RETRY_DELAY_MS / 60_000} min (report ${retriesDone + 1}/${FTS_BUSY_MAX_RETRIES}).`);
          scheduleFtsIntegrityMaintenance(database, FTS_BUSY_RETRY_DELAY_MS, retriesDone + 1);
        } else {
          log.info(`[FTS5] Application toujours occupée après ${FTS_BUSY_MAX_RETRIES} reports : contrôle FTS5 abandonné pour cette session (retenté au prochain démarrage).`);
        }
        return;
      }
      runFtsIntegrityMaintenance(database);
    } catch (err) {
      log.error('[FTS5] Échec inattendu de la maintenance FTS5 différée :', err);
    }
  }, delayMs);
  ftsCheckTimer.unref?.();
}
// ────────────────────────────────────────────────────────────────────────────

export function getDbPath(): string {
  const userDataPath = app.getPath('userData');
  const dbDir = join(userDataPath, 'data');
  if (!existsSync(dbDir)) mkdirSync(dbDir, { recursive: true });
  return join(dbDir, 'gest_in_situ.db');
}

export function getBackupDir(): string {
  const userDataPath = app.getPath('userData');
  const backupDir = join(userDataPath, 'backups');
  if (!existsSync(backupDir)) mkdirSync(backupDir, { recursive: true });
  return backupDir;
}

export async function initDatabase(): Promise<Database.Database> {
  const dbPath = getDbPath();
  log.info(`Database path: ${dbPath}`);

  db = new Database(dbPath, { timeout: 30000 });

  // Performance optimizations for 200k+ rows
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('cache_size = -64000'); // 64MB cache
  db.pragma('busy_timeout = 30000'); // Attendre 30s la libération des verrous (compatibilité Worker)
  db.pragma('foreign_keys = ON');
  db.pragma('temp_store = MEMORY');
  db.pragma('mmap_size = 268435456'); // 256MB mmap
  db.pragma('page_size = 4096');
  db.pragma('wal_autocheckpoint = 100000'); // 400MB WAL avant autocheckpoint (empêche les freezes de l'UI pendant l'import massif)

  // Run schema migrations. En cas d'échec (y compris RECOVERY_REQUIRED), la connexion est libérée
  // et l'erreur remontée : aucune écriture supplémentaire n'est faite sur une base en recovery.
  const versionBefore = db.pragma('user_version', { simple: true }) as number;
  try {
    runMigrations(db);
  } catch (migrationErr) {
    db.close();
    db = null;
    throw migrationErr;
  }
  // Invalider le cache des colonnes de t_centres après migration
  invalidateCentresColumnsCache();

  // Purge automatique des Dead Letter Entries expirées (> 7 jours)
  try {
    const result = db.prepare("DELETE FROM t_sync_queue WHERE synced = -1 AND created_at < datetime('now', '-7 days')").run();
    log.info(`[DLQ MAINTENANCE] ${result.changes} anciennes Dead Letter Entries expirées (> 7 jours) purgées.`);
  } catch (err) {
    log.error('Échec de la purge de démarrage des Dead Letters:', err);
  }



  // FTS5 : contrôle d'intégrité de t_cartes_fts DIFFÉRÉ (retiré du chemin bloquant du démarrage).
  // Historique : l'integrity-check complet tournait ici à chaque démarrage, en synchrone, avant
  // l'affichage de toute fenêtre — 13,2 s mesurées à froid sur disque 5400 tr/min (main.log du
  // 13/11/2026, ~222 000 cartes, base ~290 Mo). Il est désormais planifié FTS_CHECK_DELAY_MS après
  // l'ouverture (fenêtre principale affichée entre-temps) et ne s'exécute que si le dernier
  // contrôle réussi date de plus de FTS_CHECK_INTERVAL_DAYS jours.
  // Après une migration appliquée, validateDatabase() (schema.ts → recovery.ts) vient déjà de
  // contrôler FTS5 (simple ET strict) : la date est enregistrée sans refaire le contrôle.
  if (versionBefore < SCHEMA_VERSION) {
    markFtsIntegrityChecked(db, new Date());
    log.info('[FTS5] Migration appliquée : contrôle FTS5 déjà fait par la validation post-migration, date enregistrée.');
  }
  scheduleFtsIntegrityMaintenance(db);

  // Add Regexp support
  db.function('regexp', (pattern: string, text: string) => {
    const re = new RegExp(pattern);
    return re.test(text) ? 1 : 0;
  });

  log.info('Database ready with WAL mode and performance optimizations');
  return db;
}

export function getDatabase(): Database.Database | null {
  return db;
}

export function closeDatabase(): void {
  if (ftsCheckTimer) {
    clearTimeout(ftsCheckTimer);
    ftsCheckTimer = null;
  }
  if (db) {
    db.close();
    db = null;
    log.info('Database closed');
  }
}
