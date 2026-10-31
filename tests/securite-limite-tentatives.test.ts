import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Sécurité (2026-10-31) — Partie 2 : limite de tentatives (mécanisme en mémoire existant de
 * hierarchy:verifyPassword, 5 échecs -> verrou 5 min) branchée sur `auth:login` (clé = login
 * normalisé, ROOT compris) et `database:import` (clé fixe).
 *
 * Exerce les VRAIS handlers enregistrés par registerIpcHandlers sur une base SQLite temporaire.
 */

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gest-in-situ-test-limite-tentatives-'));

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), on: vi.fn(), removeHandler: vi.fn() },
  dialog: {
    showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })),
    showSaveDialog: vi.fn()
  },
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

type LoginHandler = (event: any, login: any, password: any) => Promise<any>;
type ImportHandler = (event: any, currentUser?: any, password?: any) => Promise<any>;

describe('Limite de tentatives — auth:login et database:import', () => {
  let connection: typeof import('../src/main/database/connection');
  let db: import('better-sqlite3').Database;
  let loginHandler: LoginHandler;
  let importHandler: ImportHandler;

  const PWD = 'Bon_Mdp_Test_2026';

  beforeAll(async () => {
    delete process.env.FAILSAFE_ROOT_PASSWORD;
    connection = await import('../src/main/database/connection');
    const handlersModule = await import('../src/main/ipc/handlers');
    const { hashPassword } = await import('../src/main/auth/local-auth');
    db = await connection.initDatabase();

    const ins = db.prepare(`
      INSERT INTO t_users (login, password_hash, role, nom_user, statut_actif, site_id, sync_id)
      VALUES (?, ?, 'SUPER ADMIN', 'Test', 1, NULL, ?)
    `);
    ins.run('agent.lock', hashPassword(PWD), 'sync-lock');
    ins.run('agent.reset', hashPassword(PWD), 'sync-reset');
    ins.run('sa.import', hashPassword(PWD), 'sync-sa-import');

    const { ipcMain } = await import('electron');
    handlersModule.registerIpcHandlers({ webContents: { send: vi.fn() } } as any);
    const calls = vi.mocked(ipcMain.handle).mock.calls;
    loginHandler = calls.find(([c]) => c === 'auth:login')![1] as LoginHandler;
    importHandler = calls.find(([c]) => c === 'database:import')![1] as ImportHandler;
  });

  afterAll(() => {
    connection.closeDatabase();
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('auth:login', () => {
    it('5 échecs -> verrou : même le bon mot de passe est refusé avec un message clair', async () => {
      for (let i = 0; i < 5; i++) {
        expect(await loginHandler({}, 'agent.lock', 'mauvais')).toBeNull();
      }
      await expect(loginHandler({}, 'agent.lock', PWD)).rejects.toThrow(/TROP_DE_TENTATIVES: .*Réessayez dans 5 minutes/);
      // Clé normalisée : casse et espaces ne contournent pas le verrou.
      await expect(loginHandler({}, '  AGENT.LOCK ', PWD)).rejects.toThrow(/TROP_DE_TENTATIVES/);
    });

    it("un autre login n'est pas affecté par le verrou", async () => {
      const user = await loginHandler({}, 'agent.reset', PWD);
      expect(user?.login).toBe('agent.reset');
    });

    it('une connexion réussie remet le compteur à zéro', async () => {
      for (let i = 0; i < 4; i++) {
        expect(await loginHandler({}, 'agent.reset', 'mauvais')).toBeNull();
      }
      expect((await loginHandler({}, 'agent.reset', PWD))?.login).toBe('agent.reset');
      for (let i = 0; i < 4; i++) {
        expect(await loginHandler({}, 'agent.reset', 'mauvais')).toBeNull();
      }
      // 4 échecs seulement depuis la remise à zéro : pas de verrou.
      expect((await loginHandler({}, 'agent.reset', PWD))?.login).toBe('agent.reset');
    });

    it('ROOT est aussi soumis au verrou', async () => {
      for (let i = 0; i < 5; i++) {
        expect(await loginHandler({}, 'ROOT', 'x')).toBeNull();
      }
      await expect(loginHandler({}, 'root', 'x')).rejects.toThrow(/TROP_DE_TENTATIVES/);
    });
  });

  describe('database:import', () => {
    it("un mot de passe absent n'est pas compté comme tentative", async () => {
      for (let i = 0; i < 6; i++) {
        expect(await importHandler({}, undefined, '')).toEqual({ success: false, reason: 'unauthorized' });
      }
      expect(await importHandler({}, undefined, PWD)).toEqual({ success: false, reason: 'cancelled' });
    });

    it('succès -> remise à zéro, puis 5 échecs -> verrou (message clair, même avec le bon mot de passe)', async () => {
      for (let i = 0; i < 4; i++) {
        expect(await importHandler({}, undefined, 'mauvais')).toEqual({ success: false, reason: 'unauthorized' });
      }
      // Bon mot de passe : franchit le contrôle (dialogue mocké en annulation), compteur remis à zéro.
      expect(await importHandler({}, undefined, PWD)).toEqual({ success: false, reason: 'cancelled' });

      for (let i = 0; i < 5; i++) {
        expect(await importHandler({}, undefined, 'mauvais')).toEqual({ success: false, reason: 'unauthorized' });
      }
      const locked = await importHandler({}, undefined, PWD);
      expect(locked.success).toBe(false);
      expect(locked.reason).toMatch(/Trop de tentatives d'importation échouées\. Réessayez dans 5 minutes\./);
    });
  });
});
