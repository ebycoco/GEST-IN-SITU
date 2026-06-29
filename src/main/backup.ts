import { getDbPath, getBackupDir, getDatabase } from './database/connection';
import { readdirSync, unlinkSync, statSync } from 'fs';
import { join } from 'path';
import log from 'electron-log';

export function initBackupScheduler(): void {
  // Run backup every 24 hours
  const INTERVAL = 24 * 60 * 60 * 1000;
  performBackup().catch(err => log.error('Initial backup failed:', err));
  setInterval(() => {
    performBackup().catch(err => log.error('Scheduled backup failed:', err));
  }, INTERVAL);
  log.info('Backup scheduler initialized (every 24h)');
}

export async function performBackup(): Promise<void> {
  try {
    const db = getDatabase();
    if (!db) {
      log.error('Backup failed: Database instance not available');
      return;
    }

    const backupDir = getBackupDir();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const backupPath = join(backupDir, `gest_in_situ_backup_${timestamp}.db`);

    log.info(`Starting backup: ${backupPath}...`);
    await db.backup(backupPath);
    log.info(`Backup successfully created via SQLite API: ${backupPath}`);

    // Rotate: keep only last 7 backups
    const MAX_BACKUPS = 7;
    const files = readdirSync(backupDir)
      .filter(f => f.startsWith('gest_in_situ_backup_') && f.endsWith('.db'))
      .map(f => ({ name: f, time: statSync(join(backupDir, f)).mtime.getTime() }))
      .sort((a, b) => b.time - a.time);

    if (files.length > MAX_BACKUPS) {
      files.slice(MAX_BACKUPS).forEach(f => {
        unlinkSync(join(backupDir, f.name));
        log.info(`Old backup deleted: ${f.name}`);
      });
    }
  } catch (e) {
    log.error('Backup transaction failed:', e);
  }
}
