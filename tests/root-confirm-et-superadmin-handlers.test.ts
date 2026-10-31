import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import bcrypt from 'bcryptjs';

/**
 * Handlers réels (registerIpcHandlers) sur une base SQLite temporaire :
 *  - hierarchy:verifyPassword en session ROOT (confirmation par l'empreinte ROOT, pas t_users) ;
 *  - users:createSuperAdmin (réservé ROOT, mot de passe ROOT revérifié, verrou anti-bruteforce) ;
 *  - auth:registerSuperAdmin n'est plus exposé.
 */

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gest-in-situ-test-root-confirm-'));

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

type Handler = (event: unknown, ...args: unknown[]) => Promise<unknown>;

const ROOT_PWD = 'Mdp_Root_Jetable_Test_2026';
const ROOT_HASH = bcrypt.hashSync(ROOT_PWD, 4);
const GOOD_PWD = 'Nouveau-SA-mdp-2026';
const ROOT_SESSION = { id_user: 999999, role: 'SUPER ADMIN', login: 'ROOT' };

describe('ROOT : confirmation par mot de passe et création de SUPER ADMIN', () => {
  let connection: typeof import('../src/main/database/connection');
  let db: import('better-sqlite3').Database;
  let verify: Handler;
  let createSA: Handler;
  let handles: string[];
  let setSession: (u: unknown) => void;

  beforeAll(async () => {
    process.env.FAILSAFE_ROOT_PASSWORD_HASH = ROOT_HASH;
    connection = await import('../src/main/database/connection');
    const handlersModule = await import('../src/main/ipc/handlers');
    const { hashPassword } = await import('../src/main/auth/local-auth');
    db = await connection.initDatabase();
    db.prepare(`INSERT INTO t_users (login, password_hash, role, nom_user, statut_actif, site_id, sync_id)
                VALUES ('sa.normal', ?, 'SUPER ADMIN', 'N', 1, NULL, 'sync-sa-normal')`).run(hashPassword('Mdp-SA-normal-2026'));
    const { ipcMain } = await import('electron');
    const hb = await import('../src/main/auth/session-heartbeat');
    setSession = (u) => vi.mocked(hb.getSecureCurrentUser).mockReturnValue(u as never);
    handlersModule.registerIpcHandlers({ webContents: { send: vi.fn() } } as never);
    const calls = vi.mocked(ipcMain.handle).mock.calls;
    handles = calls.map(([c]) => c as string);
    verify = calls.find(([c]) => c === 'hierarchy:verifyPassword')![1] as Handler;
    createSA = calls.find(([c]) => c === 'users:createSuperAdmin')![1] as Handler;
  });
  afterAll(() => {
    delete process.env.FAILSAFE_ROOT_PASSWORD_HASH;
    connection.closeDatabase();
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });
  beforeEach(async () => {
    process.env.FAILSAFE_ROOT_PASSWORD_HASH = ROOT_HASH;
    // Remise à zéro du verrou ROOT par une vérification réussie en session ROOT.
    setSession(ROOT_SESSION);
    await verify({}, ROOT_PWD, 'ROOT');
    db.prepare('DELETE FROM t_logs').run();
  });

  /** Fait expirer le verrou (horloge avancée de 6 min) puis le remet à zéro par une vérification ROOT réussie. */
  async function unlockRoot(): Promise<void> {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 6 * 60 * 1000);
    setSession(ROOT_SESSION);
    await verify({}, ROOT_PWD, 'ROOT');
    vi.useRealTimers();
  }

  const saPayload = (over: Record<string, unknown> = {}) => ({
    login: 'sa.cree', nom_user: 'CREE', prenom_user: 'Un', password: GOOD_PWD, rootPassword: ROOT_PWD, ...over
  });

  describe('hierarchy:verifyPassword', () => {
    it('session ROOT + bon mot de passe -> vrai', async () => {
      expect(await verify({}, ROOT_PWD, 'ROOT', 'Reinitialisation')).toBe(true);
    });
    it('session ROOT + mauvais mot de passe -> faux', async () => {
      expect(await verify({}, 'mauvais', 'ROOT')).toBe(false);
    });
    it("session ROOT sans empreinte ROOT -> faux (ROOT désactivé)", async () => {
      delete process.env.FAILSAFE_ROOT_PASSWORD_HASH;
      expect(await verify({}, ROOT_PWD, 'ROOT')).toBe(false);
    });
    it('SUPER ADMIN normal envoyant login ROOT + mot de passe ROOT -> faux', async () => {
      setSession({ id_user: 1, role: 'SUPER ADMIN', login: 'sa.normal' });
      expect(await verify({}, ROOT_PWD, 'ROOT')).toBe(false);
    });
    it('SUPER ADMIN normal : son propre mot de passe reste accepté (comportement inchangé)', async () => {
      setSession({ id_user: 1, role: 'SUPER ADMIN', login: 'sa.normal' });
      expect(await verify({}, 'Mdp-SA-normal-2026', 'sa.normal')).toBe(true);
      expect(await verify({}, 'faux', 'sa.normal')).toBe(false);
    });
    it('session ROOT : le login fourni par le renderer ne change rien (un autre mot de passe est refusé)', async () => {
      expect(await verify({}, 'Mdp-SA-normal-2026', 'sa.normal')).toBe(false);
    });
    it('5 échecs -> verrou : même le bon mot de passe ROOT est refusé', async () => {
      for (let i = 0; i < 5; i++) expect(await verify({}, 'mauvais', 'ROOT')).toBe(false);
      expect(await verify({}, ROOT_PWD, 'ROOT')).toBe(false);
      await unlockRoot();
    });
  });

  describe('users:createSuperAdmin', () => {
    it('ROOT + bon mot de passe ROOT -> compte créé (site NULL, SUPER ADMIN, outbox PENDING sans mot de passe en clair)', async () => {
      const res = await createSA({}, saPayload()) as { success: boolean; login: string };
      expect(res).toMatchObject({ success: true, login: 'sa.cree' });
      const r = db.prepare("SELECT * FROM t_users WHERE login = 'sa.cree'").get() as { role: string; site_id: number | null; sync_id: string };
      expect(r.role).toBe('SUPER ADMIN');
      expect(r.site_id).toBeNull();
      const ob = db.prepare("SELECT * FROM t_outbox WHERE table_name = 't_users' AND operation = 'INSERT' AND id = ?").get(r.sync_id) as { status: string; payload: string } | undefined;
      expect(ob?.status).toBe('PENDING');
      expect(ob!.payload).not.toContain(GOOD_PWD);
      expect(ob!.payload).not.toContain(ROOT_PWD);
    });
    it.each([
      ['SUPER ADMIN normal', { id_user: 1, role: 'SUPER ADMIN', login: 'sa.normal' }],
      ['ADMINISTRATEUR_SITE', { id_user: 2, role: 'ADMINISTRATEUR_SITE', site_id: 1, login: 'as' }],
      ['ADMIN_CENTRE', { id_user: 3, role: 'ADMIN_CENTRE', site_id: 1, centre_id: 1, login: 'ac' }],
      ['sans session', null]
    ])('%s -> accès refusé, aucun compte créé', async (_n, session) => {
      setSession(session);
      await expect(createSA({}, saPayload({ login: 'sa.refuse' }))).rejects.toThrow(/Accès refusé/);
      expect(db.prepare("SELECT 1 FROM t_users WHERE login = 'sa.refuse'").get()).toBeUndefined();
    });
    it('mauvais mot de passe ROOT -> refusé, puis verrou après 5 échecs (même avec le bon mot de passe)', async () => {
      for (let i = 0; i < 5; i++) {
        await expect(createSA({}, saPayload({ login: 'sa.verrou', rootPassword: 'faux' }))).rejects.toThrow(/Mot de passe ROOT incorrect|Trop de tentatives/);
      }
      await expect(createSA({}, saPayload({ login: 'sa.verrou' }))).rejects.toThrow(/Trop de tentatives/);
      expect(db.prepare("SELECT 1 FROM t_users WHERE login = 'sa.verrou'").get()).toBeUndefined();
      await unlockRoot();
    });
    it('login déjà pris -> refusé', async () => {
      await expect(createSA({}, saPayload({ login: 'SA.NORMAL' }))).rejects.toThrow(/déjà utilisé/);
    });
    it('mot de passe < 12 caractères -> refusé', async () => {
      await expect(createSA({}, saPayload({ login: 'sa.court', password: 'Court-12345' }))).rejects.toThrow(/12 caractères/);
      expect(db.prepare("SELECT 1 FROM t_users WHERE login = 'sa.court'").get()).toBeUndefined();
    });
  });

  it("auth:registerSuperAdmin n'est plus exposé", () => {
    expect(handles).not.toContain('auth:registerSuperAdmin');
    expect(handles).toContain('users:createSuperAdmin');
  });
});
