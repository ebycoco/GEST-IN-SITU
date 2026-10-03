import Database from 'better-sqlite3';
import log from 'electron-log';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'fs';
import { basename, dirname, join } from 'path';
import { checkFtsIntegrity, rebuildFtsIndex, FtsTable } from './fts-maintenance';

/**
 * Recovery des migrations de schéma.
 *
 * Contrat :
 * - base existante dont la migration échoue → RECOVERY_REQUIRED (marqueur fichier). Jamais de
 *   réinstallation, jamais de remise à zéro de user_version.
 * - base existante avec user_version = 0 → RECOVERY_REQUIRED, aucune migration rejouée.
 * - snapshot de sauvegarde = VACUUM INTO (snapshot logique cohérent, WAL inclus), jamais copie brute.
 * - dérive FTS5 seule (strict KO, simple OK, aucune anomalie hors FTS5) → reconstruction contrôlée
 *   de l'index ; toute autre anomalie → arrêt en RECOVERY_REQUIRED, sans reconstruction.
 * - restauration : copie isolée, validation, réparation FTS5 éventuelle dans la copie, puis
 *   remplacement de la base vivante et suppression du marqueur seulement après succès.
 */

export const RECOVERY_CODE = 'RECOVERY_REQUIRED';
export const RECOVERY_MARKER_NAME = 'RECOVERY_REQUIRED.json';

export interface RecoveryInfo {
  dbPath: string;
  fromVersion: number;
  targetVersion: number;
  reason: string;
  snapshotPath: string | null;
  createdAt: string;
}

export class RecoveryRequiredError extends Error {
  readonly code = RECOVERY_CODE;
  readonly info: RecoveryInfo;

  constructor(info: RecoveryInfo) {
    super(`${RECOVERY_CODE} : ${info.reason}`);
    this.name = 'RecoveryRequiredError';
    this.info = info;
  }
}

export class RestoreRefusedError extends Error {
  constructor(reason: string) {
    super(`Restauration refusée : ${reason}`);
    this.name = 'RestoreRefusedError';
  }
}

export function recoveryMarkerPath(dbPath: string): string {
  return join(dirname(dbPath), RECOVERY_MARKER_NAME);
}

/** Marqueur si la base est en RECOVERY_REQUIRED, sinon null. Un marqueur illisible reste bloquant. */
export function readRecoveryMarker(dbPath: string): RecoveryInfo | null {
  const markerPath = recoveryMarkerPath(dbPath);
  if (!existsSync(markerPath)) return null;
  try {
    return JSON.parse(readFileSync(markerPath, 'utf-8')) as RecoveryInfo;
  } catch {
    return {
      dbPath,
      fromVersion: -1,
      targetVersion: -1,
      reason: 'marqueur RECOVERY_REQUIRED illisible',
      snapshotPath: null,
      createdAt: 'inconnue',
    };
  }
}

export function writeRecoveryMarker(info: RecoveryInfo): void {
  writeFileSync(recoveryMarkerPath(info.dbPath), JSON.stringify(info, null, 2), 'utf-8');
}

export function clearRecoveryMarker(dbPath: string): void {
  const markerPath = recoveryMarkerPath(dbPath);
  if (existsSync(markerPath)) unlinkSync(markerPath);
}

/**
 * Snapshot logique cohérent via VACUUM INTO : lit à travers la connexion courante (les pages du WAL
 * sont donc incluses) et produit un fichier autonome, repassé en journal_mode=DELETE.
 * Hors transaction. La cible est remplacée si elle existe déjà.
 */
export function snapshotDatabase(db: Database.Database, targetPath: string): void {
  if (existsSync(targetPath)) unlinkSync(targetPath);
  mkdirSync(dirname(targetPath), { recursive: true });
  db.prepare('VACUUM INTO ?').run(targetPath);
  const snap = new Database(targetPath);
  try {
    snap.pragma('journal_mode = DELETE');
  } finally {
    snap.close();
  }
}

/** Tables critiques (présentes depuis V51 au plus tard : un snapshot antérieur les possède). */
const REQUIRED_TABLES = [
  't_sites', 't_centres', 't_users', 't_user_roles', 't_cartes', 't_import_anomalies',
  't_logs', 't_sync_queue', 't_outbox', 't_cartes_fts', 't_anomalies_fts',
];
const REQUIRED_COLUMNS: Record<string, string[]> = {
  t_cartes: ['relation_retirant', 'doublon_declare_par', 'statut_avant_doublon', 'apurement_correction_par', 'action_at'],
  t_outbox: ['last_attempt_at'],
};
const REQUIRED_INDEXES = ['idx_cartes_created_by_created_at', 'idx_cartes_site_centre_statut'];
/** Triggers FTS5 canoniques (V71) : commandes 'delete' uniquement, jamais DELETE FROM fts. */
const CANONICAL_TRIGGERS = ['trg_cartes_ai', 'trg_cartes_ad', 'trg_cartes_au', 'trg_anomalies_ad', 'trg_anomalies_au'];
const LEGACY_FTS_DELETE = /DELETE\s+FROM\s+t_(cartes|anomalies)_fts/i;
const FTS_TABLES: FtsTable[] = ['t_cartes_fts', 't_anomalies_fts'];

export interface ValidationReport {
  ok: boolean;
  /** Messages lisibles de tous les échecs. */
  failures: string[];
  /** Échecs hors FTS5 (intégrité, tables, colonnes, index, triggers, version). */
  structural: string[];
  /** FTS5 dont l'integrity-check simple échoue : corruption générale, non réparable ici. */
  ftsSimpleFailed: FtsTable[];
  /** FTS5 dont le strict échoue alors que le simple passe : dérive de l'index, reconstructible. */
  ftsDrift: FtsTable[];
}

/**
 * 'current' : schéma complet attendu (après migration).
 * 'restorable' : schéma antérieur accepté (snapshot restauré, qui sera migré au démarrage) —
 *  seules l'intégrité SQLite, les tables critiques et FTS5 sont exigées.
 */
export type ValidationMode = 'current' | 'restorable';

export function validateDatabase(db: Database.Database, expectedVersion?: number, mode: ValidationMode = 'current'): ValidationReport {
  const failures: string[] = [];
  const fail = (msg: string) => failures.push(msg);
  const ftsSimpleFailed: FtsTable[] = [];
  const ftsDrift: FtsTable[] = [];

  try {
    if (db.pragma('quick_check', { simple: true }) !== 'ok') fail('quick_check : échec');
  } catch (e: any) { fail(`quick_check : ${e.message}`); }

  try {
    if (db.pragma('integrity_check', { simple: true }) !== 'ok') fail('integrity_check : échec');
  } catch (e: any) { fail(`integrity_check : ${e.message}`); }

  if (mode === 'current' && expectedVersion !== undefined) {
    const version = db.pragma('user_version', { simple: true }) as number;
    if (version !== expectedVersion) fail(`user_version : attendu ${expectedVersion}, obtenu ${version}`);
  }

  const existingTables = new Set(
    (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map(r => r.name)
  );
  for (const table of REQUIRED_TABLES) {
    if (!existingTables.has(table)) fail(`table manquante : ${table}`);
  }

  if (mode === 'current') {
    for (const [table, columns] of Object.entries(REQUIRED_COLUMNS)) {
      if (!existingTables.has(table)) continue;
      const present = new Set((db.pragma(`table_info(${table})`) as { name: string }[]).map(c => c.name));
      for (const col of columns) {
        if (!present.has(col)) fail(`colonne manquante : ${table}.${col}`);
      }
    }

    const existingIndexes = new Set(
      (db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all() as { name: string }[]).map(r => r.name)
    );
    for (const idx of REQUIRED_INDEXES) {
      if (!existingIndexes.has(idx)) fail(`index manquant : ${idx}`);
    }

    const triggerSql = new Map(
      (db.prepare("SELECT name, sql FROM sqlite_master WHERE type='trigger'").all() as { name: string; sql: string }[])
        .map(r => [r.name, r.sql ?? ''])
    );
    for (const name of CANONICAL_TRIGGERS) {
      const sql = triggerSql.get(name);
      if (sql === undefined) { fail(`trigger manquant : ${name}`); continue; }
      if (LEGACY_FTS_DELETE.test(sql)) fail(`trigger FTS5 non canonique (DELETE direct) : ${name}`);
      if ((name.endsWith('_ad') || name.endsWith('_au')) && !/VALUES\s*\(\s*'delete'/i.test(sql)) {
        fail(`trigger FTS5 sans commande delete : ${name}`);
      }
    }
  }

  if (existingTables.has('t_cartes_fts') && existingTables.has('t_anomalies_fts')) {
    for (const table of FTS_TABLES) {
      const simple = checkFtsIntegrity(db, table, false);
      if (!simple.ok) {
        ftsSimpleFailed.push(table);
        fail(`FTS5 simple : ${table} : ${simple.error}`);
        continue;
      }
      const strict = checkFtsIntegrity(db, table, true);
      if (!strict.ok) {
        ftsDrift.push(table);
        fail(`FTS5 strict : ${table} : ${strict.error}`);
      }
    }
  }

  return {
    ok: failures.length === 0,
    failures,
    structural: failures.filter(f => !f.startsWith('FTS5')),
    ftsSimpleFailed,
    ftsDrift,
  };
}

/**
 * Décision sur un rapport de validation :
 * - 'none'    : rien à faire ;
 * - 'rebuild' : seule anomalie = dérive FTS5 (simple OK, strict KO) → reconstruction contrôlée ;
 * - 'stop'    : toute autre anomalie (SQLite, structure, FTS5 simple) → RECOVERY_REQUIRED sans rebuild.
 */
export function planFtsRepair(report: ValidationReport): 'none' | 'rebuild' | 'stop' {
  if (report.ok) return 'none';
  if (report.structural.length === 0 && report.ftsSimpleFailed.length === 0 && report.ftsDrift.length > 0) return 'rebuild';
  return 'stop';
}

/** Reconstruction contrôlée des index FTS5 en dérive. Lève une erreur si le strict reste KO après rebuild. */
export function repairFtsDrift(db: Database.Database, report: ValidationReport): FtsTable[] {
  const repaired: FtsTable[] = [];
  for (const table of report.ftsDrift) {
    const res = rebuildFtsIndex(db, table);
    if (!res.integrityAfter.ok) {
      throw new Error(`reconstruction FTS5 ${table} : strict encore KO après rebuild (${res.integrityAfter.error})`);
    }
    log.warn(`[RECOVERY] Index ${table} reconstruit (${res.durationMs} ms), contrôle strict OK.`);
    repaired.push(table);
  }
  return repaired;
}

/** Compteurs de données critiques. -1 si la table n'existe pas. */
export function countCriticalRows(db: Database.Database): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const table of ['t_sites', 't_users', 't_cartes']) {
    try {
      counts[table] = (db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c;
    } catch {
      counts[table] = -1;
    }
  }
  return counts;
}

function removeJournalFiles(dbPath: string): void {
  for (const suffix of ['-wal', '-shm', '-journal']) {
    const stale = dbPath + suffix;
    if (existsSync(stale)) unlinkSync(stale);
  }
}

export interface RestoreCopyResult {
  dbPath: string;
  validation: ValidationReport;
}

/**
 * Copie un snapshot dans un répertoire isolé neuf et le valide. Seul le fichier principal est copié :
 * aucun -wal/-shm voisin du snapshot n'est repris, et aucun journal n'existe dans le répertoire.
 */
export function restoreSnapshotToIsolatedDir(snapshotPath: string, isolatedDir: string): RestoreCopyResult {
  if (existsSync(isolatedDir) && readdirSync(isolatedDir).length > 0) {
    throw new Error(`répertoire de restauration non vide : ${isolatedDir}`);
  }
  mkdirSync(isolatedDir, { recursive: true });
  const restoredPath = join(isolatedDir, 'gest_in_situ.db');
  copyFileSync(snapshotPath, restoredPath);

  const restored = new Database(restoredPath);
  let validation: ValidationReport;
  try {
    restored.pragma('journal_mode = DELETE');
    validation = validateDatabase(restored, undefined, 'restorable');
  } finally {
    restored.close();
  }
  removeJournalFiles(restoredPath);
  return { dbPath: restoredPath, validation };
}

/**
 * Remplace le fichier vivant par une base restaurée et validée. Le fichier est copié à côté de la
 * cible puis renommé (remplacement atomique au niveau du système de fichiers). Les -wal/-shm/-journal
 * de l'ancienne base sont supprimés avant, pour qu'aucun journal ancien ne soit rejoué. Le marqueur
 * RECOVERY_REQUIRED n'est effacé qu'ici, une fois le remplacement réussi.
 */
export function replaceLiveDatabase(restoredPath: string, liveDbPath: string): void {
  removeJournalFiles(liveDbPath);
  const tmpPath = liveDbPath + '.restore-tmp';
  copyFileSync(restoredPath, tmpPath);
  renameSync(tmpPath, liveDbPath);
  clearRecoveryMarker(liveDbPath);
  log.warn(`[RECOVERY] Base vivante remplacée par la restauration validée : ${restoredPath}`);
}

export interface PerformRestoreOptions {
  /** Snapshot ou sauvegarde choisie par l'opérateur. */
  sourcePath: string;
  /** Chemin de la base vivante. */
  dbPath: string;
  /** Répertoire des sauvegardes (copies de travail et snapshots de sécurité). */
  backupDir: string;
  /** Connexion vivante ouverte, si elle existe (snapshot de sécurité pris avant remplacement). */
  liveDb: Database.Database | null;
  /** Ferme la connexion vivante juste avant le remplacement. */
  closeLive?: () => void;
  /** Version maximale acceptée (SCHEMA_VERSION de l'application). */
  targetVersion: number;
}

export interface RestoreOutcome {
  /** Snapshot de sécurité de l'état vivant avant remplacement (null si aucun état vivant). */
  safetyPath: string | null;
  ftsRepaired: FtsTable[];
  counts: Record<string, number>;
}

/**
 * Procédure de restauration contrôlée :
 * 1. copie isolée du fichier source, validation « restaurable » ;
 * 2. contrôles : version dans [1, targetVersion], pas d'anomalie hors FTS5, tables critiques présentes ;
 * 3. dérive FTS5 seule → reconstruction dans la copie isolée, puis revalidation ;
 * 4. snapshot de sécurité de l'état vivant ;
 * 5. remplacement de la base vivante, suppression du marqueur RECOVERY_REQUIRED.
 * Toute étape en échec lève RestoreRefusedError avant remplacement : la base vivante et le marqueur restent intacts.
 */
export function performRestore(opts: PerformRestoreOptions): RestoreOutcome {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const isolatedDir = join(opts.backupDir, `restore_${stamp}`);
  const refuse = (reason: string): never => {
    rmSync(isolatedDir, { recursive: true, force: true });
    throw new RestoreRefusedError(reason);
  };

  // Snapshot de recovery (enterRecoveryRequired) : pris dans l'état d'échec de la migration, avec
  // l'ancien user_version et un schéma possiblement à moitié migré. Le restaurer relancerait la même
  // migration, qui échouerait à nouveau. Seule une sauvegarde antérieure est acceptable.
  if (/^recovery_v\d+_to_v\d+_/.test(basename(opts.sourcePath))) {
    throw new RestoreRefusedError("snapshot d'un échec de migration (recovery_*) : choisir une sauvegarde antérieure");
  }

  let copy: RestoreCopyResult;
  try {
    copy = restoreSnapshotToIsolatedDir(opts.sourcePath, isolatedDir);
  } catch (e: any) {
    refuse(`fichier illisible ou non SQLite (${e.message})`);
  }
  const restoredPath = copy!.dbPath;

  const ftsRepaired: FtsTable[] = [];
  let counts: Record<string, number> = {};
  // La copie est fermée AVANT tout refus : sous Windows, un fichier ouvert ne peut pas être supprimé.
  let refusal: string | null = null;
  const work = new Database(restoredPath);
  try {
    const version = work.pragma('user_version', { simple: true }) as number;
    if (version < 1 || version > opts.targetVersion) {
      refusal = `user_version ${version} hors de la plage [1, ${opts.targetVersion}]`;
    } else {
      let report = copy!.validation;
      const plan = planFtsRepair(report);
      if (plan === 'stop') {
        refusal = `anomalie non réparable automatiquement : ${report.failures.join(' | ')}`;
      } else {
        if (plan === 'rebuild') {
          ftsRepaired.push(...repairFtsDrift(work, report));
          report = validateDatabase(work, undefined, 'restorable');
          if (!report.ok) refusal = `validation après reconstruction FTS5 : ${report.failures.join(' | ')}`;
        }
        if (refusal === null) {
          counts = countCriticalRows(work);
          if (Object.values(counts).some(c => c < 0)) refusal = 'table critique absente de la sauvegarde';
        }
      }
    }
  } catch (e: any) {
    refusal = e.message;
  } finally {
    work.close();
  }
  if (refusal !== null) refuse(refusal);
  removeJournalFiles(restoredPath);

  let safetyPath: string | null = null;
  try {
    if (opts.liveDb) {
      safetyPath = join(opts.backupDir, `pre_restore_${stamp}.db`);
      snapshotDatabase(opts.liveDb, safetyPath);
    } else if (existsSync(opts.dbPath)) {
      safetyPath = join(opts.backupDir, `pre_restore_${stamp}.db`);
      const live = new Database(opts.dbPath);
      try {
        snapshotDatabase(live, safetyPath);
      } finally {
        live.close();
      }
    }
  } catch (e: any) {
    refuse(`snapshot de sécurité de l'état vivant impossible (${e.message})`);
  }

  opts.closeLive?.();
  replaceLiveDatabase(restoredPath, opts.dbPath);
  rmSync(isolatedDir, { recursive: true, force: true });
  return { safetyPath, ftsRepaired, counts };
}
