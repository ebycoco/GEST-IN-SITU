import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Sauvegarde automatique quotidienne (13/11/2026) — src/main/backup.ts.
 * Avant : sauvegarde complète 60 s après chaque démarrage, rotation sur 7 FICHIERS.
 * Maintenant : sauvegarde seulement si la plus récente a plus de 24 h, contrôle 10 min après le
 * démarrage puis toutes les heures, rotation sur 7 JOURS distincts, écriture via fichier temporaire.
 * Dossier temporaire jetable, base factice (aucune vraie base, aucun réseau).
 */
const state = vi.hoisted(() => ({
  backupDir: '',
  db: null as null | { backup: (p: string) => Promise<unknown> }
}));

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}));

vi.mock('../src/main/database/connection', () => ({
  getBackupDir: () => state.backupDir,
  getDatabase: () => state.db,
  getDbPath: () => path.join(state.backupDir, 'live.db')
}));

import * as backup from '../src/main/backup';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function makeBackupFile(name: string, mtime: Date): string {
  const p = path.join(state.backupDir, name);
  fs.writeFileSync(p, 'SQLite format 3\0');
  fs.utimesSync(p, mtime, mtime);
  return p;
}

function nameFor(d: Date, suffix = ''): string {
  return `gest_in_situ_backup_${d.toISOString().replace(/[:.]/g, '-').slice(0, 19)}${suffix}.db`;
}

/** Midi local (ou une autre heure) du jour J-k : reste dans le même jour calendaire local. */
function localDay(k: number, hour = 12): Date {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate() - k, hour, 0, 0);
}

function listDir(): string[] {
  return fs.readdirSync(state.backupDir).sort();
}

describe('Sauvegarde automatique quotidienne (backup.ts)', () => {
  let backupSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    state.backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gest-in-situ-test-backup-'));
    backupSpy = vi.fn(async (p: string) => {
      fs.writeFileSync(p, 'SQLite format 3\0copie');
    });
    state.db = { backup: backupSpy };
    backup.setBackupBusyCheck(null);
  });

  afterEach(() => {
    backup.stopBackupScheduler();
    backup.setBackupBusyCheck(null);
    vi.useRealTimers();
    fs.rmSync(state.backupDir, { recursive: true, force: true });
  });

  it('pas de sauvegarde si la plus récente a moins de 24 h', async () => {
    makeBackupFile(nameFor(new Date(Date.now() - 3 * HOUR)), new Date(Date.now() - 3 * HOUR));
    expect(backup.isBackupDue(state.backupDir)).toBe(false);
    const ran = await backup.runBackupIfDue('test');
    expect(ran).toBe(false);
    expect(backupSpy).not.toHaveBeenCalled();
    expect(listDir()).toHaveLength(1);
  });

  it('sauvegarde si aucune sauvegarde n\'existe', async () => {
    expect(backup.isBackupDue(state.backupDir)).toBe(true);
    const ran = await backup.runBackupIfDue('test');
    expect(ran).toBe(true);
    expect(backupSpy).toHaveBeenCalledTimes(1);
    const files = listDir();
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^gest_in_situ_backup_.*\.db$/);
    // db.backup écrit d'abord dans un fichier temporaire non reconnu comme sauvegarde
    expect(String(backupSpy.mock.calls[0][0])).toMatch(/\.db\.tmp$/);
  });

  it('sauvegarde si la plus récente a plus de 24 h', async () => {
    const old = new Date(Date.now() - 25 * HOUR);
    makeBackupFile(nameFor(old), old);
    const ran = await backup.runBackupIfDue('test');
    expect(ran).toBe(true);
    expect(listDir()).toHaveLength(2);
  });

  it('les fichiers étrangers, vides ou temporaires ne comptent pas comme sauvegarde récente', async () => {
    const recent = new Date(Date.now() - HOUR);
    makeBackupFile('pre_restore_123.db', recent);
    makeBackupFile('backup_pre_cloud_purge_1.db', recent);
    makeBackupFile(nameFor(recent) + '.tmp', recent);
    const empty = path.join(state.backupDir, nameFor(new Date(Date.now() - 2 * HOUR), '_vide'));
    fs.writeFileSync(empty, '');
    expect(backup.isBackupDue(state.backupDir)).toBe(true);
  });

  it('garde « occupé » : report si due depuis peu, sauvegarde forcée au-delà de 48 h', async () => {
    backup.setBackupBusyCheck(() => true);
    const d30 = new Date(Date.now() - 30 * HOUR);
    makeBackupFile(nameFor(d30), d30);
    expect(await backup.runBackupIfDue('test')).toBe(false);
    expect(backupSpy).not.toHaveBeenCalled();

    fs.rmSync(path.join(state.backupDir, nameFor(d30)));
    const d50 = new Date(Date.now() - 50 * HOUR);
    makeBackupFile(nameFor(d50), d50);
    expect(await backup.runBackupIfDue('test')).toBe(true);
    expect(backupSpy).toHaveBeenCalledTimes(1);
  });

  it('garde « occupé » en erreur : considérée occupée (report)', async () => {
    backup.setBackupBusyCheck(() => {
      throw new Error('boom');
    });
    const d30 = new Date(Date.now() - 30 * HOUR);
    makeBackupFile(nameFor(d30), d30);
    expect(await backup.runBackupIfDue('test')).toBe(false);
  });

  it('rotation : garde la plus récente de chacun des 7 derniers jours distincts', async () => {
    // 10 jours passés (J-1 à J-10), deux sauvegardes par jour (9 h et 12 h locales)
    const expectedKept: string[] = [];
    for (let k = 1; k <= 10; k++) {
      const noon = localDay(k, 12);
      const morning = localDay(k, 9);
      makeBackupFile(nameFor(noon, '_midi'), noon);
      makeBackupFile(nameFor(morning, '_matin'), morning);
      if (k <= 6) expectedKept.push(nameFor(noon, '_midi'));
    }
    const old = backup.getLatestBackupAgeMs(state.backupDir)!;
    expect(old).toBeGreaterThan(0);

    await backup.performBackup();

    const files = listDir();
    // nouvelle sauvegarde (aujourd'hui) + J-1..J-6 (midi) = 7 jours distincts
    expect(files).toHaveLength(7);
    for (const name of expectedKept) expect(files).toContain(name);
    expect(files.filter(f => f.includes('_matin'))).toHaveLength(0);
  });

  it('rotation : 7 redémarrages le même jour n\'effacent plus l\'historique des jours précédents', () => {
    const files: backup.BackupFileInfo[] = [];
    for (let k = 1; k <= 5; k++) files.push({ name: `jour-${k}`, mtimeMs: localDay(k).getTime() });
    for (let h = 0; h < 8; h++) files.push({ name: `aujourdhui-${h}`, mtimeMs: localDay(0, 8 + h).getTime() });
    const del = backup.selectBackupsToDelete(files);
    // tous les jours passés gardés, aujourd'hui : seule la plus récente (15 h) gardée
    for (let k = 1; k <= 5; k++) expect(del).not.toContain(`jour-${k}`);
    expect(del).not.toContain('aujourdhui-7');
    expect(del).toHaveLength(7);
  });

  it('la plus récente n\'est jamais supprimée et il reste toujours au moins 1 fichier', () => {
    const one = [{ name: 'seule', mtimeMs: Date.now() }];
    expect(backup.selectBackupsToDelete(one)).toEqual([]);
    expect(backup.selectBackupsToDelete(one, 0)).toEqual([]);
    const many = Array.from({ length: 20 }, (_, i) => ({ name: `f${i}`, mtimeMs: localDay(i).getTime() }));
    const del = backup.selectBackupsToDelete(many, 0);
    expect(del).not.toContain('f0');
    expect(del).toHaveLength(19);
  });

  it('échec de la sauvegarde : aucune suppression, aucun fichier partiel laissé', async () => {
    for (let k = 1; k <= 10; k++) makeBackupFile(nameFor(localDay(k)), localDay(k));
    const before = listDir();
    backupSpy.mockImplementationOnce(async (p: string) => {
      fs.writeFileSync(p, 'partiel'); // écriture à mi-chemin
      throw new Error('disque plein');
    });
    await backup.performBackup();
    expect(listDir()).toEqual(before);
  });

  it('un fichier temporaire laissé par une sauvegarde interrompue est nettoyé à la suivante', async () => {
    const stale = nameFor(localDay(3)) + '.tmp';
    makeBackupFile(stale, localDay(3));
    await backup.performBackup();
    expect(listDir()).not.toContain(stale);
    expect(listDir().filter(f => f.endsWith('.db'))).toHaveLength(1);
  });

  it('planificateur : rien avant 10 min, puis contrôle toutes les heures', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'] });
    backup.initBackupScheduler();

    await vi.advanceTimersByTimeAsync(9 * 60 * 1000);
    expect(backupSpy).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1 * 60 * 1000 + 10);
    expect(backupSpy).toHaveBeenCalledTimes(1); // aucune sauvegarde → due → faite

    // contrôles horaires suivants : la sauvegarde vient d'être faite → rien
    await vi.advanceTimersByTimeAsync(3 * HOUR);
    expect(backupSpy).toHaveBeenCalledTimes(1);

    // la sauvegarde vieillit (> 24 h) : le prochain contrôle horaire la refait
    for (const f of listDir()) {
      const old = new Date(Date.now() - 25 * HOUR);
      fs.utimesSync(path.join(state.backupDir, f), old, old);
    }
    await vi.advanceTimersByTimeAsync(HOUR);
    expect(backupSpy).toHaveBeenCalledTimes(2);
  });
});
