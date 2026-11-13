import { getBackupDir, getDatabase } from './database/connection';
import { readdirSync, unlinkSync, statSync, renameSync, existsSync } from 'fs';
import { join } from 'path';
import log from 'electron-log';

// ─── Sauvegarde automatique quotidienne ─────────────────────────────────────
// Avant (jusqu'au 13/11/2026) : sauvegarde complète 60 s après CHAQUE démarrage + setInterval 24 h,
// rotation sur les 7 derniers FICHIERS. Sur un poste à disque lent (base ~290 Mo), la copie
// (~80 s) tombait en même temps que la synchro/stats de démarrage, et 7 redémarrages dans la
// journée effaçaient tout l'historique des jours précédents.
// Maintenant : une sauvegarde n'est faite que si la plus récente a plus de 24 h ; contrôle
// 10 min après le démarrage puis toutes les heures ; rotation sur les 7 derniers JOURS distincts.

/** Motif de nom des sauvegardes automatiques (inchangé : seuls ces fichiers sont gérés ici). */
export const BACKUP_FILE_PREFIX = 'gest_in_situ_backup_';
export const BACKUP_FILE_EXT = '.db';
/** Suffixe du fichier en cours d'écriture : il ne finit pas par `.db`, donc jamais pris pour une sauvegarde valide. */
export const BACKUP_TEMP_SUFFIX = '.tmp';

const HOUR_MS = 60 * 60 * 1000;
/** Âge au-delà duquel une nouvelle sauvegarde est due. */
export const BACKUP_MAX_AGE_MS = 24 * HOUR_MS;
/** Au-delà de cet âge, la sauvegarde est faite même si l'application est occupée (sécurité d'abord). */
export const BACKUP_FORCE_AGE_MS = 48 * HOUR_MS;
/** Premier contrôle après le démarrage : laisse passer sync, téléchargement et stats de démarrage. */
export const BACKUP_INITIAL_DELAY_MS = 10 * 60 * 1000;
/** Contrôle périodique « une sauvegarde est-elle due ? ». */
export const BACKUP_CHECK_INTERVAL_MS = HOUR_MS;
/** Nombre de jours distincts conservés (une sauvegarde par jour, la plus récente du jour). */
export const BACKUP_RETENTION_DAYS = 7;

export interface BackupFileInfo {
  name: string;
  mtimeMs: number;
}

/**
 * Garde « occupé » (synchronisation, import, purge). Fournie par index.ts via setBackupBusyCheck,
 * même principe que setFtsMaintenanceBusyCheck (connection.ts) : ce module n'importe ni le moteur
 * de sync ni les handlers. null = aucune garde → considéré « libre ».
 */
let backupBusyCheck: (() => boolean) | null = null;
let backupInProgress = false;
let initialTimer: ReturnType<typeof setTimeout> | null = null;
let periodicTimer: ReturnType<typeof setInterval> | null = null;

export function setBackupBusyCheck(fn: (() => boolean) | null): void {
  backupBusyCheck = fn;
}

/** En cas d'erreur du rappel, on considère l'application occupée (report d'une heure, sans risque). */
function isBackupBusy(): boolean {
  if (!backupBusyCheck) return false;
  try {
    return backupBusyCheck() === true;
  } catch (err) {
    log.warn('[BACKUP] Garde « occupé » en erreur, sauvegarde reportée par prudence :', err);
    return true;
  }
}

function isBackupFileName(name: string): boolean {
  return name.startsWith(BACKUP_FILE_PREFIX) && name.endsWith(BACKUP_FILE_EXT);
}

/**
 * Sauvegardes valides du dossier (motif de nom reconnu, fichier non vide), de la plus récente à la
 * plus ancienne selon la date de modification (= fin d'écriture). Seul statSync est utilisé :
 * aucun contenu de fichier n'est lu en mémoire.
 */
export function listBackupFiles(backupDir: string): BackupFileInfo[] {
  const result: BackupFileInfo[] = [];
  for (const name of readdirSync(backupDir)) {
    if (!isBackupFileName(name)) continue;
    try {
      const st = statSync(join(backupDir, name));
      if (!st.isFile() || st.size === 0) continue;
      result.push({ name, mtimeMs: st.mtime.getTime() });
    } catch {
      // Fichier disparu entre readdir et stat : ignoré.
    }
  }
  return result.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

/** Âge (ms) de la plus récente sauvegarde valide, ou null s'il n'y en a aucune. */
export function getLatestBackupAgeMs(backupDir: string, now: number = Date.now()): number | null {
  const files = listBackupFiles(backupDir);
  if (files.length === 0) return null;
  return now - files[0].mtimeMs;
}

/** Une sauvegarde est due s'il n'y en a aucune ou si la plus récente a plus de 24 h. */
export function isBackupDue(backupDir: string, now: number = Date.now()): boolean {
  const age = getLatestBackupAgeMs(backupDir, now);
  return age === null || age > BACKUP_MAX_AGE_MS;
}

/** Jour calendaire local (AAAA-MM-JJ) d'une date de modification. */
function localDayKey(mtimeMs: number): string {
  const d = new Date(mtimeMs);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const j = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${j}`;
}

/**
 * Rotation : garde la plus récente sauvegarde de chacun des `retentionDays` derniers jours
 * distincts ayant une sauvegarde, et renvoie les noms à supprimer. La plus récente de toutes est
 * toujours conservée (elle est la première du premier jour) ; le résultat ne vide jamais la liste.
 */
export function selectBackupsToDelete(
  files: BackupFileInfo[],
  retentionDays: number = BACKUP_RETENTION_DAYS
): string[] {
  const sorted = [...files].sort((a, b) => b.mtimeMs - a.mtimeMs);
  const keptDays = new Set<string>();
  const toDelete: string[] = [];
  const keep = Math.max(1, retentionDays);
  sorted.forEach((f, index) => {
    if (index === 0) {
      keptDays.add(localDayKey(f.mtimeMs));
      return; // la plus récente n'est jamais supprimée
    }
    const day = localDayKey(f.mtimeMs);
    if (!keptDays.has(day) && keptDays.size < keep) {
      keptDays.add(day);
      return;
    }
    toDelete.push(f.name);
  });
  return toDelete;
}

function rotateBackups(backupDir: string): void {
  const toDelete = selectBackupsToDelete(listBackupFiles(backupDir));
  for (const name of toDelete) {
    try {
      unlinkSync(join(backupDir, name));
      log.info(`Old backup deleted: ${name}`);
    } catch (err) {
      log.warn(`[BACKUP] Suppression impossible de l'ancienne sauvegarde ${name} :`, err);
    }
  }
}

/** Supprime les fichiers temporaires laissés par une sauvegarde interrompue (crash, arrêt du poste). */
function cleanupStaleTempFiles(backupDir: string): void {
  for (const name of readdirSync(backupDir)) {
    if (!name.startsWith(BACKUP_FILE_PREFIX)) continue;
    if (!name.endsWith(BACKUP_FILE_EXT + BACKUP_TEMP_SUFFIX)) continue;
    try {
      unlinkSync(join(backupDir, name));
      log.info(`[BACKUP] Fichier temporaire d'une sauvegarde interrompue supprimé : ${name}`);
    } catch (err) {
      log.warn(`[BACKUP] Fichier temporaire non supprimé (${name}) :`, err);
    }
  }
}

export async function performBackup(): Promise<void> {
  let tempPath: string | null = null;
  try {
    const db = getDatabase();
    if (!db) {
      log.error('Backup failed: Database instance not available');
      return;
    }

    const backupDir = getBackupDir();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const backupPath = join(backupDir, `${BACKUP_FILE_PREFIX}${timestamp}${BACKUP_FILE_EXT}`);

    cleanupStaleTempFiles(backupDir);

    // Écriture dans un fichier temporaire puis renommage : une copie interrompue ne porte jamais
    // le nom final et n'est donc jamais comptée comme sauvegarde valide.
    tempPath = backupPath + BACKUP_TEMP_SUFFIX;
    log.info(`Starting backup: ${backupPath}...`);
    await db.backup(tempPath);
    if (!existsSync(tempPath) || statSync(tempPath).size === 0) {
      throw new Error(`Fichier de sauvegarde absent ou vide après db.backup : ${tempPath}`);
    }
    renameSync(tempPath, backupPath);
    tempPath = null;
    log.info(`Backup successfully created via SQLite API: ${backupPath}`);

    // Rotation uniquement APRÈS une sauvegarde terminée et renommée avec succès.
    rotateBackups(backupDir);
  } catch (e) {
    log.error('Backup transaction failed:', e);
    if (tempPath) {
      try {
        if (existsSync(tempPath)) unlinkSync(tempPath);
      } catch (cleanupErr) {
        log.warn('[BACKUP] Fichier temporaire non supprimé après échec :', cleanupErr);
      }
    }
  }
}

/**
 * Lance la sauvegarde si elle est due. Renvoie true si une sauvegarde a été tentée.
 * Exportée pour les tests ; appelée par les timers de initBackupScheduler.
 */
export async function runBackupIfDue(reason: string, now: number = Date.now()): Promise<boolean> {
  if (backupInProgress) {
    log.info(`[BACKUP] (${reason}) Sauvegarde déjà en cours, contrôle ignoré.`);
    return false;
  }
  try {
    const backupDir = getBackupDir();
    const age = getLatestBackupAgeMs(backupDir, now);
    if (age !== null && age <= BACKUP_MAX_AGE_MS) {
      log.info(
        `[BACKUP] (${reason}) Sauvegarde récente (il y a ${Math.round(age / 60000)} min), aucune nouvelle sauvegarde.`
      );
      return false;
    }
    const overdue = age === null || age > BACKUP_FORCE_AGE_MS;
    if (!overdue && isBackupBusy()) {
      log.info(`[BACKUP] (${reason}) Sauvegarde due mais application occupée, nouvel essai dans 1 h.`);
      return false;
    }
  } catch (err) {
    log.error(`[BACKUP] (${reason}) Contrôle de la sauvegarde impossible :`, err);
    return false;
  }

  backupInProgress = true;
  try {
    await performBackup();
  } finally {
    backupInProgress = false;
  }
  return true;
}

export function initBackupScheduler(): void {
  if (initialTimer) clearTimeout(initialTimer);
  if (periodicTimer) clearInterval(periodicTimer);

  initialTimer = setTimeout(() => {
    initialTimer = null;
    runBackupIfDue('démarrage').catch(err => log.error('Initial backup failed:', err));
  }, BACKUP_INITIAL_DELAY_MS);

  periodicTimer = setInterval(() => {
    runBackupIfDue('contrôle horaire').catch(err => log.error('Scheduled backup failed:', err));
  }, BACKUP_CHECK_INTERVAL_MS);

  log.info(
    `Backup scheduler initialized (first check in ${BACKUP_INITIAL_DELAY_MS / 60000} min, then hourly; backup when latest > 24h)`
  );
}

/** Arrête les timers (tests). */
export function stopBackupScheduler(): void {
  if (initialTimer) clearTimeout(initialTimer);
  if (periodicTimer) clearInterval(periodicTimer);
  initialTimer = null;
  periodicTimer = null;
}
