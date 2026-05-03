import { getDbPath, getBackupDir } from './database/connection';
import { copyFileSync, readdirSync, unlinkSync, statSync } from 'fs';
import { join } from 'path';
import log from 'electron-log';

export function initBackupScheduler(): void {
  // Run backup every 24 hours
  const INTERVAL = 24 * 60 * 60 * 1000;
  performBackup();
  setInterval(performBackup, INTERVAL);
  log.info('Backup scheduler initialized (every 24h)');
}

export function performBackup(): void {
  try {
    const dbPath = getDbPath();
    const backupDir = getBackupDir();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const backupPath = join(backupDir, `gest_in_situ_backup_${timestamp}.db`);

    copyFileSync(dbPath, backupPath);
    log.info(`Backup created: ${backupPath}`);

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
    log.error('Backup failed:', e);
  }
}
