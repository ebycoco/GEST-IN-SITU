import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Test ciblé — Garde anti-rafale sur `sync:force` (src/main/ipc/handlers.ts).
 *
 * Constat : chaque appel `sync:force` lançait un cycle complet et écrivait deux lignes
 * d'audit `SUPERADMIN_FORCE_SYNC`, sans aucune limitation de fréquence (rafales relevées :
 * ~50 appels en 7 s). Correctif : un `sync:force` accepté empêche tout nouvel appel accepté
 * pendant 3 secondes ; l'appel refusé ne lance aucun cycle et n'écrit aucune ligne d'audit.
 *
 * Ce test exerce le VRAI handler enregistré par `registerIpcHandlers`. `syncEngine.forceSync`
 * est espionné (pas de cycle réel, pas de réseau, pas de Supabase).
 */

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gest-in-situ-test-forcesync-throttle-'));

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn(),
    removeHandler: vi.fn()
  },
  dialog: {
    showOpenDialog: vi.fn(),
    showSaveDialog: vi.fn(),
    showMessageBoxSync: vi.fn()
  },
  app: {
    getPath: () => tmpDir,
    isPackaged: false
  },
  net: {
    online: true,
    request: vi.fn()
  },
  BrowserWindow: {
    getAllWindows: () => []
  },
  shell: {
    openPath: vi.fn(),
    showItemInFolder: vi.fn()
  }
}));

vi.mock('../src/main/auth/session-heartbeat', () => ({
  startSessionHeartbeat: vi.fn(),
  stopSessionHeartbeat: vi.fn(),
  getCurrentUserLogin: vi.fn(() => 'test.user'),
  getSecureCurrentUser: vi.fn(() => null),
  setActiveRole: vi.fn(),
  getCurrentGrantedRoles: vi.fn(() => []),
  refreshSecureCurrentUser: vi.fn()
}));

const realDateNow = Date.now;
const setNow = (t: number) => { Date.now = () => t; };

const flushAudit = () => new Promise<void>((resolve) => setTimeout(resolve, 20));

describe('sync:force — garde anti-rafale (3 s)', () => {
  let connection: typeof import('../src/main/database/connection');
  let handlersModule: typeof import('../src/main/ipc/handlers');
  let syncEngineModule: typeof import('../src/main/sync/sync-engine');
  let db: import('better-sqlite3').Database;
  let forceSyncHandler: (event: any, currentUser?: any) => Promise<any>;
  let forceSyncSpy: ReturnType<typeof vi.spyOn>;

  const countForceSyncAudits = () =>
    (db.prepare("SELECT COUNT(*) AS c FROM t_audit_log WHERE action = 'SUPERADMIN_FORCE_SYNC'").get() as any).c as number;

  beforeAll(async () => {
    connection = await import('../src/main/database/connection');
    handlersModule = await import('../src/main/ipc/handlers');
    syncEngineModule = await import('../src/main/sync/sync-engine');

    db = await connection.initDatabase();

    const { ipcMain } = await import('electron');
    handlersModule.registerIpcHandlers({ webContents: { send: vi.fn() } } as any);
    const call = vi.mocked(ipcMain.handle).mock.calls.find(([channel]) => channel === 'sync:force');
    expect(call).toBeDefined();
    forceSyncHandler = call![1] as typeof forceSyncHandler;

    forceSyncSpy = vi.spyOn(syncEngineModule.syncEngine, 'forceSync').mockResolvedValue({
      success: true,
      message: 'Synchronisation terminée avec succès.'
    });
  });

  afterEach(() => {
    forceSyncSpy.mockClear();
  });

  afterAll(() => {
    Date.now = realDateNow;
    connection.closeDatabase();
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('(a) premier appel accepté : lance un cycle et écrit ses deux lignes d\'audit', async () => {
    db.prepare('DELETE FROM t_audit_log').run();
    forceSyncSpy.mockClear();
    setNow(1_000_000);

    const res = await forceSyncHandler({} as any, { login: 'super.admin.test' });
    await flushAudit();

    expect(res.success).toBe(true);
    expect(forceSyncSpy).toHaveBeenCalledTimes(1);
    expect(countForceSyncAudits()).toBe(2);
  });

  it('(b) second appel dans les 3 s : refusé, aucun cycle, aucune ligne d\'audit ajoutée', async () => {
    db.prepare('DELETE FROM t_audit_log').run();
    forceSyncSpy.mockClear();
    setNow(2_000_000);
    await forceSyncHandler({} as any, { login: 'super.admin.test' });
    await flushAudit();
    const auditsAfterFirst = countForceSyncAudits();
    forceSyncSpy.mockClear();

    setNow(2_000_000 + 150);
    const res = await forceSyncHandler({} as any, { login: 'super.admin.test' });
    await flushAudit();

    expect(res.success).toBe(false);
    expect(typeof res.message).toBe('string');
    expect(forceSyncSpy).not.toHaveBeenCalled();
    expect(countForceSyncAudits()).toBe(auditsAfterFirst);
  });

  it('(c) appel après l\'expiration de la fenêtre (3 s) : à nouveau accepté', async () => {
    db.prepare('DELETE FROM t_audit_log').run();
    forceSyncSpy.mockClear();
    setNow(3_000_000);
    await forceSyncHandler({} as any, { login: 'super.admin.test' });

    setNow(3_000_000 + 3_100);
    const res = await forceSyncHandler({} as any, { login: 'super.admin.test' });
    await flushAudit();

    expect(res.success).toBe(true);
    expect(forceSyncSpy).toHaveBeenCalledTimes(2);
  });

  it('(d) rafale : seul le premier appel de la rafale lance un cycle', async () => {
    db.prepare('DELETE FROM t_audit_log').run();
    forceSyncSpy.mockClear();
    const base = 4_000_000;
    for (let i = 0; i < 10; i++) {
      setNow(base + i * 150);
      await forceSyncHandler({} as any, { login: 'super.admin.test' });
    }
    await flushAudit();

    expect(forceSyncSpy).toHaveBeenCalledTimes(1);
    expect(countForceSyncAudits()).toBe(2);
  });
});
