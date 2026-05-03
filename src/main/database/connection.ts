import Database from 'better-sqlite3';
import { app } from 'electron';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { runMigrations } from './schema';
import log from 'electron-log';

let db: Database.Database | null = null;

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

  db = new Database(dbPath);

  // Performance optimizations for 200k+ rows
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('cache_size = -64000'); // 64MB cache
  db.pragma('foreign_keys = ON');
  db.pragma('temp_store = MEMORY');
  db.pragma('mmap_size = 268435456'); // 256MB mmap
  db.pragma('page_size = 4096');

  // Run schema migrations
  runMigrations(db);

  log.info('Database ready with WAL mode and performance optimizations');
  return db;
}

export function getDatabase(): Database.Database | null {
  return db;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
    log.info('Database closed');
  }
}
