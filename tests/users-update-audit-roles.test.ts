import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Handler réel users:update (registerIpcHandlers) sur une base SQLite TEMPORAIRE :
 * le journal SYS_MODIF_DROITS doit porter les rôles envoyés. updateUser() reçoit le même
 * objet `data` et en supprime `roles` : sans copie préalable, droits_ajoutes valait toujours [].
 * Modules réseau/sync mockés : aucune écriture Supabase, aucun accès à la vraie base.
 */

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gest-in-situ-test-update-audit-roles-'));

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), on: vi.fn(), removeHandler: vi.fn() },
  dialog: { showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })), showSaveDialog: vi.fn() },
  app: { getPath: () => tmpDir, isPackaged: false, relaunch: vi.fn(), exit: vi.fn() },
  net: { online: true, request: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] },
  shell: { openPath: vi.fn(), showItemInFolder: vi.fn() }
}));
vi.mock('../src/main/auth/session-heartbeat', () => ({
  startSessionHeartbeat: vi.fn(),
  stopSessionHeartbeat: vi.fn(),
  getCurrentUserLogin: vi.fn(() => null),
  getSecureCurrentUser: vi.fn(() => null),
  setActiveRole: vi.fn(),
  getCurrentGrantedRoles: vi.fn(() => []),
  refreshSecureCurrentUser: vi.fn(),
  resolveCurrentSessionLogin: vi.fn(() => null)
}));
vi.mock('../src/main/sync/presence.service', () => ({
  recordPresenceLogin: vi.fn(),
  recordPresenceLogout: vi.fn(),
  heartbeatPresence: vi.fn()
}));
vi.mock('../src/main/sync/supabase-client', () => ({ getSupabaseClient: vi.fn(() => null) }));
vi.mock('../src/main/sync/network-monitor', () => ({
  networkMonitor: { getState: () => 'OFFLINE', on: vi.fn(), start: vi.fn(), stop: vi.fn() }
}));
vi.mock('../src/main/sync/outbox.service', () => ({
  enqueueOutbox: vi.fn(),
  scheduleOutboxProcessing: vi.fn(),
  cancelPendingInsert: vi.fn(() => true)
}));
vi.mock('../src/main/utils/audit', () => ({ logAudit: vi.fn(), CRUD_SYNC_WHITELIST: new Set<string>() }));

type Handler = (event: unknown, ...args: unknown[]) => Promise<unknown>;

const ROOT_SESSION = { id_user: 999999, role: 'SUPER ADMIN', login: 'ROOT' };
const SITE_A = 921;

describe('users:update — journal SYS_MODIF_DROITS', () => {
  let connection: typeof import('../src/main/database/connection');
  let db: import('better-sqlite3').Database;
  let update: Handler;
  let logAudit: ReturnType<typeof vi.fn>;

  const flushImmediate = () => new Promise<void>(resolve => setImmediate(resolve));

  function mk(login: string, role: string, roles: string[]): number {
    db.prepare(`INSERT INTO t_users (login, password_hash, role, nom_user, prenom_user, statut_actif, site_id, centre_id, sync_id, is_dirty)
                VALUES (?, 'HASH', ?, 'Nom', 'Prenom', 1, ?, NULL, ?, 0)`).run(login, role, SITE_A, `sync-${login}`);
    const id = (db.prepare('SELECT id_user FROM t_users WHERE login = ?').get(login) as { id_user: number }).id_user;
    for (const r of roles) db.prepare('INSERT INTO t_user_roles (id_user, role) VALUES (?, ?)').run(id, r);
    return id;
  }

  beforeAll(async () => {
    connection = await import('../src/main/database/connection');
    const handlersModule = await import('../src/main/ipc/handlers');
    db = await connection.initDatabase();
    db.prepare(`INSERT INTO t_sites (id, nom, code, is_active, is_permanent, sync_id) VALUES (?, 'SITE_A', 'SITE_A', 1, 1, 'site-sync-921')`).run(SITE_A);
    const { ipcMain } = await import('electron');
    const hb = await import('../src/main/auth/session-heartbeat');
    vi.mocked(hb.getSecureCurrentUser).mockReturnValue(ROOT_SESSION as never);
    const audit = await import('../src/main/utils/audit');
    logAudit = vi.mocked(audit.logAudit);
    handlersModule.registerIpcHandlers({ webContents: { send: vi.fn() } } as never);
    update = vi.mocked(ipcMain.handle).mock.calls.find(([c]) => c === 'users:update')![1] as Handler;
  }, 60000); // import de handlers.ts + migrations complètes : plus long que le délai par défaut
  afterAll(() => {
    connection.closeDatabase();
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });
  beforeEach(() => {
    logAudit.mockClear();
    db.prepare('DELETE FROM t_user_roles').run();
    db.prepare('DELETE FROM t_users').run();
  });

  const droitsLog = () => logAudit.mock.calls.find(([, action]) => action === 'SYS_MODIF_DROITS');

  it('droits_ajoutes porte les rôles envoyés (et non [])', async () => {
    const id = mk('agent.a', 'OPERATEUR_SAISIE', ['OPERATEUR_SAISIE']);
    await update({}, id, { login: 'agent.a', role: 'OPERATEUR_SAISIE', roles: ['OPERATEUR_SAISIE', 'OPERATEUR_QUALITE'] });
    await flushImmediate();
    const call = droitsLog();
    expect(call).toBeDefined();
    expect(call![2]).toMatchObject({
      login_agent: 'agent.a',
      nouveau_role: 'OPERATEUR_SAISIE',
      droits_ajoutes: ['OPERATEUR_SAISIE', 'OPERATEUR_QUALITE']
    });
  });

  it('sans roles envoyés : droits_ajoutes reste []', async () => {
    const id = mk('agent.b', 'OPERATEUR_SAISIE', ['OPERATEUR_SAISIE']);
    await update({}, id, { login: 'agent.b', nom_user: 'Autre' });
    await flushImmediate();
    expect(droitsLog()![2]).toMatchObject({ droits_ajoutes: [] });
  });
});
