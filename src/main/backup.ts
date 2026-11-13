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
// 10 min après le démarrage (2 min si aucune sauvegarde fiable récente) puis toutes les heures ;
// rotation sur les 7 derniers JOURS distincts.
//
// Réserves d'audit traitées (13/11/2026, sur 5cd9bd7) :
// - Horloge du poste reculée : une sauvegarde datée dans le futur (mtime > maintenant + 5 min)
//   n'est plus prise pour « récente » (sinon plus aucune sauvegarde jusqu'à ce que l'horloge la
//   rattrape). Elle est ignorée pour le calcul d'âge, signalée en log.warn, rend la sauvegarde due
//   et « en retard » (non reportable par la garde occupé), et n'entre pas dans la rotation. La
//   sauvegarde qui vient d'être créée est en outre protégée nommément de la rotation qui la suit.
// - Échecs : renommage du .tmp retenté (3 essais, pause asynchrone de 500 ms) ; après un échec,
//   pas de nouvel essai avant 6 h (mémoire du module, remise à zéro au démarrage suivant).
// - Garde occupé : log.warn à partir du 2e report d'affilée.

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
/**
 * Premier contrôle rapproché quand le poste n'a aucune sauvegarde fiable : aucune sauvegarde,
 * la plus récente a plus de 48 h, ou une sauvegarde est datée dans le futur (horloge reculée).
 */
export const BACKUP_SHORT_INITIAL_DELAY_MS = 2 * 60 * 1000;
/** Contrôle périodique « une sauvegarde est-elle due ? ». */
export const BACKUP_CHECK_INTERVAL_MS = HOUR_MS;
/** Nombre de jours distincts conservés (une sauvegarde par jour, la plus récente du jour). */
export const BACKUP_RETENTION_DAYS = 7;
/** Marge tolérée sur la date d'une sauvegarde : au-delà de maintenant + 5 min, elle est « datée dans le futur ». */
export const BACKUP_FUTURE_TOLERANCE_MS = 5 * 60 * 1000;
/** Nombre total d'essais de renommage du fichier temporaire (antivirus, indexeur Windows). */
export const BACKUP_RENAME_MAX_ATTEMPTS = 3;
/** Pause (asynchrone) entre deux essais de renommage. */
export const BACKUP_RENAME_RETRY_DELAY_MS = 500;
/** Après un échec de sauvegarde, délai minimal avant un nouvel essai (sauf redémarrage de l'appli). */
export const BACKUP_FAILURE_RETRY_DELAY_MS = 6 * HOUR_MS;

export interface BackupFileInfo {
  name: string;
  mtimeMs: number;
}

/** Options facultatives de la rotation (ajoutées le 13/11/2026, appel à 1 ou 2 arguments inchangé). */
export interface BackupRotationOptions {
  /** Noms jamais supprimés (ex. la sauvegarde qui vient d'être créée). */
  protectedNames?: readonly string[];
  /**
   * Heure de référence. Si fournie, les fichiers datés après `now + BACKUP_FUTURE_TOLERANCE_MS`
   * sont exclus de la rotation : ni supprimés, ni comptés comme jour conservé.
   */
  now?: number;
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
/**
 * Heure (référence `now` de runBackupIfDue) du dernier échec de sauvegarde, null si aucun.
 * Mémoire volontairement non persistée : un redémarrage de l'appli autorise un nouvel essai.
 */
let lastBackupFailureAt: number | null = null;
/** Nombre de reports d'affilée pour cause « application occupée ». */
let consecutiveBusyDeferrals = 0;

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

function isFutureDated(mtimeMs: number, now: number): boolean {
  return mtimeMs > now + BACKUP_FUTURE_TOLERANCE_MS;
}

/** Pause non bloquante (le thread principal reste libre pendant l'attente). */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
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

interface BackupState {
  /** Âge (ms) de la plus récente sauvegarde NON datée dans le futur, null s'il n'y en a aucune. */
  latestAgeMs: number | null;
  /** Sauvegardes datées dans le futur (horloge du poste reculée depuis leur écriture). */
  futureFiles: BackupFileInfo[];
}

function analyzeBackups(files: BackupFileInfo[], now: number): BackupState {
  const futureFiles: BackupFileInfo[] = [];
  let latestAgeMs: number | null = null;
  for (const f of files) {
    if (isFutureDated(f.mtimeMs, now)) {
      futureFiles.push(f);
      continue;
    }
    // `files` est trié du plus récent au plus ancien : le premier fichier non futur est le bon.
    if (latestAgeMs === null) latestAgeMs = now - f.mtimeMs;
  }
  return { latestAgeMs, futureFiles };
}

function warnFutureFiles(context: string, futureFiles: BackupFileInfo[], now: number): void {
  if (futureFiles.length === 0) return;
  const maxAheadMin = Math.round((futureFiles[0].mtimeMs - now) / 60000);
  log.warn(
    `[BACKUP] (${context}) ${futureFiles.length} sauvegarde(s) datée(s) dans le futur (jusqu'à ${maxAheadMin} min d'avance) : ` +
      `horloge du poste probablement reculée. Elles sont ignorées pour décider de la sauvegarde et conservées hors rotation.`
  );
}

/**
 * Âge (ms) de la plus récente sauvegarde valide, ou null s'il n'y en a aucune. Les sauvegardes
 * datées dans le futur (au-delà de la tolérance de 5 min) sont ignorées : l'âge n'est donc jamais
 * négatif au-delà de cette tolérance.
 */
export function getLatestBackupAgeMs(backupDir: string, now: number = Date.now()): number | null {
  return analyzeBackups(listBackupFiles(backupDir), now).latestAgeMs;
}

/** Une sauvegarde est due s'il n'y en a aucune (hors fichiers datés dans le futur) ou si la plus récente a plus de 24 h. */
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
 * Options : `protectedNames` ne sont jamais supprimés ; avec `now`, les fichiers datés dans le futur
 * sont exclus du calcul (ni supprimés, ni comptés), pour qu'ils ne chassent pas les sauvegardes du
 * présent.
 */
export function selectBackupsToDelete(
  files: BackupFileInfo[],
  retentionDays: number = BACKUP_RETENTION_DAYS,
  options: BackupRotationOptions = {}
): string[] {
  const protectedNames = new Set(options.protectedNames ?? []);
  const now = options.now;
  const candidates = now === undefined ? files : files.filter(f => !isFutureDated(f.mtimeMs, now));
  const sorted = [...candidates].sort((a, b) => b.mtimeMs - a.mtimeMs);
  const keptDays = new Set<string>();
  const toDelete: string[] = [];
  const keep = Math.max(1, retentionDays);
  sorted.forEach((f, index) => {
    const day = localDayKey(f.mtimeMs);
    if (index === 0 || protectedNames.has(f.name)) {
      keptDays.add(day);
      return; // la plus récente et les fichiers protégés ne sont jamais supprimés
    }
    if (!keptDays.has(day) && keptDays.size < keep) {
      keptDays.add(day);
      return;
    }
    toDelete.push(f.name);
  });
  return toDelete;
}

function rotateBackups(backupDir: string, justCreatedName: string): void {
  const now = Date.now();
  const files = listBackupFiles(backupDir);
  warnFutureFiles('rotation', analyzeBackups(files, now).futureFiles, now);
  const toDelete = selectBackupsToDelete(files, BACKUP_RETENTION_DAYS, {
    protectedNames: [justCreatedName],
    now
  });
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

/**
 * Renommage .tmp → .db avec nouveaux essais. Un antivirus ou l'indexeur Windows peut garder le
 * fichier ouvert juste après l'écriture (EBUSY/EPERM). Les pauses sont asynchrones (setTimeout),
 * aucune attente active. Relance la dernière erreur si tous les essais échouent.
 */
async function renameWithRetry(from: string, to: string): Promise<void> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= BACKUP_RENAME_MAX_ATTEMPTS; attempt++) {
    try {
      renameSync(from, to);
      if (attempt > 1) log.info(`[BACKUP] Renommage réussi au ${attempt}e essai.`);
      return;
    } catch (err) {
      lastError = err;
      if (attempt < BACKUP_RENAME_MAX_ATTEMPTS) {
        log.warn(
          `[BACKUP] Renommage du fichier temporaire impossible (essai ${attempt}/${BACKUP_RENAME_MAX_ATTEMPTS}), nouvel essai dans ${BACKUP_RENAME_RETRY_DELAY_MS} ms :`,
          err
        );
        await delay(BACKUP_RENAME_RETRY_DELAY_MS);
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Renommage impossible : ${String(lastError)}`);
}

type BackupOutcome = 'success' | 'failed' | 'skipped';

/**
 * Corps de la sauvegarde. 'skipped' = base indisponible (pas un échec disque, pas de délai de 6 h).
 * N'émet jamais d'exception : toute erreur est journalisée et le .tmp est supprimé.
 */
async function executeBackup(): Promise<BackupOutcome> {
  let tempPath: string | null = null;
  try {
    const db = getDatabase();
    if (!db) {
      log.error('Backup failed: Database instance not available');
      return 'skipped';
    }

    const backupDir = getBackupDir();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const backupName = `${BACKUP_FILE_PREFIX}${timestamp}${BACKUP_FILE_EXT}`;
    const backupPath = join(backupDir, backupName);

    cleanupStaleTempFiles(backupDir);

    // Écriture dans un fichier temporaire puis renommage : une copie interrompue ne porte jamais
    // le nom final et n'est donc jamais comptée comme sauvegarde valide.
    tempPath = backupPath + BACKUP_TEMP_SUFFIX;
    log.info(`Starting backup: ${backupPath}...`);
    await db.backup(tempPath);
    if (!existsSync(tempPath) || statSync(tempPath).size === 0) {
      throw new Error(`Fichier de sauvegarde absent ou vide après db.backup : ${tempPath}`);
    }
    await renameWithRetry(tempPath, backupPath);
    tempPath = null;
    log.info(`Backup successfully created via SQLite API: ${backupPath}`);

    // Rotation uniquement APRÈS une sauvegarde terminée et renommée avec succès ; la sauvegarde
    // qui vient d'être créée est protégée nommément (cas d'une horloge reculée).
    rotateBackups(backupDir, backupName);
    return 'success';
  } catch (e) {
    log.error('Backup transaction failed:', e);
    if (tempPath) {
      try {
        if (existsSync(tempPath)) unlinkSync(tempPath);
      } catch (cleanupErr) {
        log.warn('[BACKUP] Fichier temporaire non supprimé après échec :', cleanupErr);
      }
    }
    return 'failed';
  }
}

export async function performBackup(): Promise<void> {
  await executeBackup();
}

/**
 * Lance la sauvegarde si elle est due. Renvoie true si une sauvegarde a été tentée.
 * Exportée pour les tests ; appelée par les timers de initBackupScheduler.
 * Tout le contrôle avant `backupInProgress = true` est synchrone : deux appels simultanés ne
 * peuvent pas lancer deux copies.
 */
export async function runBackupIfDue(reason: string, now: number = Date.now()): Promise<boolean> {
  if (backupInProgress) {
    log.info(`[BACKUP] (${reason}) Sauvegarde déjà en cours, contrôle ignoré.`);
    return false;
  }
  try {
    const backupDir = getBackupDir();
    const { latestAgeMs: age, futureFiles } = analyzeBackups(listBackupFiles(backupDir), now);
    warnFutureFiles(reason, futureFiles, now);
    if (age !== null && age <= BACKUP_MAX_AGE_MS) {
      consecutiveBusyDeferrals = 0;
      log.info(
        `[BACKUP] (${reason}) Sauvegarde récente (il y a ${Math.round(age / 60000)} min), aucune nouvelle sauvegarde.`
      );
      return false;
    }
    if (lastBackupFailureAt !== null && now - lastBackupFailureAt < BACKUP_FAILURE_RETRY_DELAY_MS) {
      const remainingMin = Math.ceil((BACKUP_FAILURE_RETRY_DELAY_MS - (now - lastBackupFailureAt)) / 60000);
      log.info(
        `[BACKUP] (${reason}) Sauvegarde due mais la dernière tentative a échoué : nouvel essai dans ${remainingMin} min (ou au prochain démarrage).`
      );
      return false;
    }
    // Une sauvegarde datée dans le futur rend l'historique non fiable : traitée comme « en retard ».
    const overdue = age === null || age > BACKUP_FORCE_AGE_MS || futureFiles.length > 0;
    if (!overdue && isBackupBusy()) {
      consecutiveBusyDeferrals++;
      const message = `[BACKUP] (${reason}) Sauvegarde due mais application occupée, nouvel essai dans 1 h (report n° ${consecutiveBusyDeferrals} d'affilée).`;
      if (consecutiveBusyDeferrals >= 2) log.warn(message);
      else log.info(message);
      return false;
    }
  } catch (err) {
    log.error(`[BACKUP] (${reason}) Contrôle de la sauvegarde impossible :`, err);
    return false;
  }

  backupInProgress = true;
  try {
    const outcome = await executeBackup();
    if (outcome === 'success') {
      lastBackupFailureAt = null;
      consecutiveBusyDeferrals = 0;
    } else if (outcome === 'failed') {
      lastBackupFailureAt = now;
      log.warn(
        `[BACKUP] (${reason}) Échec de la sauvegarde : pas de nouvel essai avant ${BACKUP_FAILURE_RETRY_DELAY_MS / HOUR_MS} h (ou au prochain démarrage).`
      );
    }
  } finally {
    backupInProgress = false;
  }
  return true;
}

/**
 * Délai du premier contrôle : court si le poste n'a aucune sauvegarde fiable (aucune, la plus
 * récente > 48 h, ou une sauvegarde datée dans le futur), sinon BACKUP_INITIAL_DELAY_MS.
 * Lecture du dossier par readdir/stat uniquement (quelques fichiers) ; en cas d'erreur, délai normal.
 */
export function getInitialBackupDelayMs(now: number = Date.now()): number {
  try {
    const { latestAgeMs, futureFiles } = analyzeBackups(listBackupFiles(getBackupDir()), now);
    if (latestAgeMs === null || latestAgeMs > BACKUP_FORCE_AGE_MS || futureFiles.length > 0) {
      return BACKUP_SHORT_INITIAL_DELAY_MS;
    }
  } catch (err) {
    log.warn('[BACKUP] Lecture du dossier de sauvegarde impossible au démarrage, délai normal :', err);
  }
  return BACKUP_INITIAL_DELAY_MS;
}

export function initBackupScheduler(): void {
  if (initialTimer) clearTimeout(initialTimer);
  if (periodicTimer) clearInterval(periodicTimer);

  const initialDelayMs = getInitialBackupDelayMs();
  initialTimer = setTimeout(() => {
    initialTimer = null;
    runBackupIfDue('démarrage').catch(err => log.error('Initial backup failed:', err));
  }, initialDelayMs);

  periodicTimer = setInterval(() => {
    runBackupIfDue('contrôle horaire').catch(err => log.error('Scheduled backup failed:', err));
  }, BACKUP_CHECK_INTERVAL_MS);

  log.info(
    `Backup scheduler initialized (first check in ${initialDelayMs / 60000} min, then hourly; backup when latest > 24h)`
  );
}

/** Arrête les timers et remet à zéro la mémoire du module (tests). */
export function stopBackupScheduler(): void {
  if (initialTimer) clearTimeout(initialTimer);
  if (periodicTimer) clearInterval(periodicTimer);
  initialTimer = null;
  periodicTimer = null;
  lastBackupFailureAt = null;
  consecutiveBusyDeferrals = 0;
}
