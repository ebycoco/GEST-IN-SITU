import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import BetterSqlite3 from 'better-sqlite3';
import type Database from 'better-sqlite3';

/**
 * Démarrage lent (13/11/2026) — l'integrity-check FTS5 de t_cartes_fts ne tourne plus en synchrone
 * dans initDatabase() : il est différé (timer) et limité à une fois tous les 7 jours, la date du
 * dernier contrôle réussi étant stockée dans t_config ('fts_integrity_last_check').
 * Base SQLite jetable (répertoire temporaire), aucun réseau.
 */
process.env.GEST_IN_SITU_E2E_DISABLE_SYNC = '1';
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gest-in-situ-test-fts-differe-'));

vi.mock('electron', () => ({
  app: { getPath: () => tmpDir, isPackaged: false },
  net: { online: false, request: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] }
}));

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-11-13T12:00:00.000Z');

describe('Contrôle FTS5 différé et hebdomadaire (connection.ts)', () => {
  let connection: typeof import('../src/main/database/connection');
  let db: Database.Database;

  const readKey = () =>
    (db.prepare('SELECT value FROM t_config WHERE key = ?').get(connection.FTS_CHECK_CONFIG_KEY) as { value: string } | undefined)?.value;
  const setLast = (d: Date) =>
    db.prepare('INSERT OR REPLACE INTO t_config (key, value) VALUES (?, ?)').run(connection.FTS_CHECK_CONFIG_KEY, d.toISOString());
  const clearLast = () => db.prepare('DELETE FROM t_config WHERE key = ?').run(connection.FTS_CHECK_CONFIG_KEY);
  const integrityCalls = (spy: ReturnType<typeof vi.spyOn>) =>
    spy.mock.calls.filter((c: unknown[]) => String(c[0]).includes("'integrity-check'")).length;

  beforeAll(async () => {
    connection = await import('../src/main/database/connection');
    db = await connection.initDatabase();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  afterAll(() => {
    connection?.closeDatabase();
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('installation neuve (migration appliquée) : date enregistrée sans contrôle supplémentaire', () => {
    const value = readKey();
    expect(value).toBeTruthy();
    expect(Number.isNaN(Date.parse(value!))).toBe(false);
  });

  it('pas de contrôle si le dernier date de moins de 7 jours', () => {
    setLast(new Date(NOW.getTime() - 3 * DAY));
    const spy = vi.spyOn(db, 'exec');
    expect(connection.isFtsIntegrityCheckDue(db, NOW)).toBe(false);
    expect(connection.runFtsIntegrityMaintenance(db, NOW)).toBe('skipped');
    expect(integrityCalls(spy)).toBe(0);
  });

  it('contrôle si le dernier date de plus de 7 jours, puis date mise à jour', () => {
    setLast(new Date(NOW.getTime() - 8 * DAY));
    const spy = vi.spyOn(db, 'exec');
    expect(connection.isFtsIntegrityCheckDue(db, NOW)).toBe(true);
    expect(connection.runFtsIntegrityMaintenance(db, NOW)).toBe('ok');
    expect(integrityCalls(spy)).toBe(1);
    expect(readKey()).toBe(NOW.toISOString());
  });

  it('contrôle si jamais fait, ou si la date est illisible ou dans le futur', () => {
    clearLast();
    expect(connection.isFtsIntegrityCheckDue(db, NOW)).toBe(true);
    db.prepare('INSERT OR REPLACE INTO t_config (key, value) VALUES (?, ?)').run(connection.FTS_CHECK_CONFIG_KEY, 'pas-une-date');
    expect(connection.isFtsIntegrityCheckDue(db, NOW)).toBe(true);
    setLast(new Date(NOW.getTime() + 30 * DAY));
    expect(connection.isFtsIntegrityCheckDue(db, NOW)).toBe(true);
    clearLast();
    expect(connection.runFtsIntegrityMaintenance(db, NOW)).toBe('ok');
    expect(readKey()).toBe(NOW.toISOString());
  });

  it("corruption détectée : reconstruction ('rebuild') lancée, puis date enregistrée", () => {
    clearLast();
    const realExec = db.exec.bind(db);
    const spy = vi.spyOn(db, 'exec').mockImplementation((sql: string) => {
      if (sql.includes("'integrity-check'")) {
        const err: any = new Error('database disk image is malformed');
        err.code = 'SQLITE_CORRUPT_VTAB';
        throw err;
      }
      return realExec(sql);
    });
    expect(connection.runFtsIntegrityMaintenance(db, NOW)).toBe('rebuilt');
    expect(spy.mock.calls.some((c: unknown[]) => String(c[0]).includes("'rebuild'"))).toBe(true);
    expect(readKey()).toBe(NOW.toISOString());
  });

  it('erreur inconnue ou rebuild en échec : date non enregistrée (retentée au prochain démarrage)', () => {
    clearLast();
    vi.spyOn(db, 'exec').mockImplementation(() => { throw new Error('disk I/O error'); });
    expect(connection.runFtsIntegrityMaintenance(db, NOW)).toBe('error');
    expect(readKey()).toBeUndefined();

    vi.restoreAllMocks();
    vi.spyOn(db, 'exec').mockImplementation(() => {
      const err: any = new Error('database disk image is malformed');
      err.code = 'SQLITE_CORRUPT_VTAB';
      throw err;
    });
    expect(connection.runFtsIntegrityMaintenance(db, NOW)).toBe('rebuild-failed');
    expect(readKey()).toBeUndefined();
  });

  describe('planification différée (timer) et garde « occupé »', () => {
    /**
     * Rouvre la base (déjà à SCHEMA_VERSION : aucune migration) sous horloge simulée, avec une
     * date de dernier contrôle posée AVANT l'ouverture. Les espions sont posés sur le PROTOTYPE
     * better-sqlite3 avant initDatabase() : ils voient tout exec()/prepare() de l'ouverture.
     */
    const reopen = async (lastCheck: string) => {
      setLast(new Date(lastCheck));
      connection.closeDatabase();
      vi.useFakeTimers();
      const execSpy = vi.spyOn(BetterSqlite3.prototype, 'exec');
      const prepareSpy = vi.spyOn(BetterSqlite3.prototype, 'prepare');
      db = await connection.initDatabase();
      return { execSpy, prepareSpy };
    };
    const oldIso = () => new Date(Date.now() - 10 * DAY).toISOString();

    afterEach(async () => {
      connection.setFtsMaintenanceBusyCheck(null);
      vi.restoreAllMocks();
      vi.useRealTimers();
      // Chaque test démarre avec une base ouverte (certains la ferment volontairement).
      if (!connection.getDatabase()) db = await connection.initDatabase();
    });

    it("initDatabase() sur base existante : 0 integrity-check pendant l'ouverture, pas de marquage, contrôle après le délai", async () => {
      const old = oldIso();
      const { execSpy, prepareSpy } = await reopen(old);
      // Pendant initDatabase() : aucun integrity-check (ni exec, ni prepare) et date inchangée.
      expect(integrityCalls(execSpy)).toBe(0);
      expect(integrityCalls(prepareSpy)).toBe(0);
      expect(readKey()).toBe(new Date(old).toISOString());

      vi.advanceTimersByTime(connection.FTS_CHECK_DELAY_MS - 1);
      expect(integrityCalls(execSpy)).toBe(0);
      vi.advanceTimersByTime(1);
      expect(integrityCalls(execSpy)).toBe(1);
      expect(readKey()).not.toBe(new Date(old).toISOString());
    });

    it('closeDatabase() annule le contrôle planifié', async () => {
      const { execSpy } = await reopen(oldIso());
      connection.closeDatabase();
      vi.advanceTimersByTime(connection.FTS_CHECK_DELAY_MS);
      vi.advanceTimersByTime(connection.FTS_BUSY_RETRY_DELAY_MS * 2);
      expect(integrityCalls(execSpy)).toBe(0);
    });

    it('occupé au déclenchement : report, puis contrôle au report suivant une fois libre', async () => {
      let busy = true;
      const busyCheck = vi.fn(() => busy);
      connection.setFtsMaintenanceBusyCheck(busyCheck);
      const old = oldIso();
      const { execSpy } = await reopen(old);

      vi.advanceTimersByTime(connection.FTS_CHECK_DELAY_MS);
      expect(busyCheck).toHaveBeenCalledTimes(1);
      expect(integrityCalls(execSpy)).toBe(0);
      vi.advanceTimersByTime(connection.FTS_BUSY_RETRY_DELAY_MS);
      expect(busyCheck).toHaveBeenCalledTimes(2);
      expect(integrityCalls(execSpy)).toBe(0);
      expect(readKey()).toBe(new Date(old).toISOString());

      busy = false;
      vi.advanceTimersByTime(connection.FTS_BUSY_RETRY_DELAY_MS - 1);
      expect(integrityCalls(execSpy)).toBe(0);
      vi.advanceTimersByTime(1);
      expect(integrityCalls(execSpy)).toBe(1);
      expect(readKey()).not.toBe(new Date(old).toISOString());
    });

    it('occupé au-delà de la limite : abandon pour la session, sans marquage de date', async () => {
      let busy = true;
      const busyCheck = vi.fn(() => busy);
      connection.setFtsMaintenanceBusyCheck(busyCheck);
      const old = oldIso();
      const { execSpy } = await reopen(old);

      vi.advanceTimersByTime(connection.FTS_CHECK_DELAY_MS);
      vi.advanceTimersByTime(connection.FTS_BUSY_RETRY_DELAY_MS * connection.FTS_BUSY_MAX_RETRIES);
      // 1 essai initial + FTS_BUSY_MAX_RETRIES reports, tous occupés.
      expect(busyCheck).toHaveBeenCalledTimes(1 + connection.FTS_BUSY_MAX_RETRIES);
      expect(integrityCalls(execSpy)).toBe(0);

      // Abandon effectif : même redevenue libre, l'application ne relance plus rien cette session.
      busy = false;
      vi.advanceTimersByTime(DAY);
      expect(busyCheck).toHaveBeenCalledTimes(1 + connection.FTS_BUSY_MAX_RETRIES);
      expect(integrityCalls(execSpy)).toBe(0);
      expect(readKey()).toBe(new Date(old).toISOString());
    });

    it('garde en erreur : considérée « occupée » (report), contrôle au report suivant', async () => {
      let fail = true;
      connection.setFtsMaintenanceBusyCheck(() => {
        if (fail) throw new Error('garde indisponible');
        return false;
      });
      const { execSpy } = await reopen(oldIso());

      vi.advanceTimersByTime(connection.FTS_CHECK_DELAY_MS);
      expect(integrityCalls(execSpy)).toBe(0);
      fail = false;
      vi.advanceTimersByTime(connection.FTS_BUSY_RETRY_DELAY_MS);
      expect(integrityCalls(execSpy)).toBe(1);
    });

    it("contrôle non dû : la garde n'est pas consultée et aucun report n'est planifié", async () => {
      const busyCheck = vi.fn(() => true);
      connection.setFtsMaintenanceBusyCheck(busyCheck);
      const { execSpy } = await reopen(new Date(Date.now() - 1 * DAY).toISOString());

      vi.advanceTimersByTime(connection.FTS_CHECK_DELAY_MS);
      vi.advanceTimersByTime(connection.FTS_BUSY_RETRY_DELAY_MS * 3);
      expect(busyCheck).not.toHaveBeenCalled();
      expect(integrityCalls(execSpy)).toBe(0);
    });
  });
});
