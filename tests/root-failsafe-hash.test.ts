import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import bcrypt from 'bcryptjs';

/**
 * Sécurité (2026-10-31) — Compte de secours ROOT vérifié par EMPREINTE bcrypt.
 *
 * Exerce le VRAI handler `auth:login` (registerIpcHandlers) sur une base SQLite temporaire :
 *  - ROOT accepté seulement si l'empreinte est une empreinte bcrypt valide ET correspond ;
 *  - refusé sans empreinte, avec une empreinte non bcrypt (même égale au mot de passe saisi),
 *    avec un mauvais mot de passe ; l'ancienne variable en clair FAILSAFE_ROOT_PASSWORD est ignorée ;
 *  - poste installé (app.isPackaged) : seule l'empreinte figée au build compte, l'environnement
 *    d'exécution est ignoré ;
 *  - le verrou anti-bruteforce (5 échecs / 5 min, clé auth:login:root) continue de s'appliquer.
 */

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gest-in-situ-test-root-hash-'));

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

type LoginHandler = (event: unknown, login: unknown, password: unknown) => Promise<{ id_user: number; login: string; role: string } | null>;

describe('ROOT failsafe — empreinte bcrypt', () => {
  let connection: typeof import('../src/main/database/connection');
  let loginHandler: LoginHandler;
  let electronApp: { isPackaged: boolean };

  // Jeu de test jetable (coût 4 : rapide). Aucune valeur réelle.
  const ROOT_PWD = 'Mdp_Root_Jetable_Test_2026';
  const VALID_HASH = bcrypt.hashSync(ROOT_PWD, 4);

  /** Remet le compteur d'échecs de ROOT à zéro par une connexion réussie. */
  async function resetRootLock(): Promise<void> {
    process.env.FAILSAFE_ROOT_PASSWORD_HASH = VALID_HASH;
    const ok = await loginHandler({}, 'root', ROOT_PWD);
    expect(ok?.id_user).toBe(999999);
    delete process.env.FAILSAFE_ROOT_PASSWORD_HASH;
  }

  beforeAll(async () => {
    delete process.env.FAILSAFE_ROOT_PASSWORD;
    delete process.env.FAILSAFE_ROOT_PASSWORD_HASH;
    delete process.env.BAKED_FAILSAFE_ROOT_PASSWORD_HASH;
    connection = await import('../src/main/database/connection');
    const handlersModule = await import('../src/main/ipc/handlers');
    await connection.initDatabase();

    const electron = await import('electron');
    electronApp = electron.app as unknown as { isPackaged: boolean };
    handlersModule.registerIpcHandlers({ webContents: { send: vi.fn() } } as never);
    const calls = vi.mocked(electron.ipcMain.handle).mock.calls;
    loginHandler = calls.find(([c]) => c === 'auth:login')![1] as unknown as LoginHandler;
  });

  afterEach(() => {
    delete process.env.FAILSAFE_ROOT_PASSWORD;
    delete process.env.FAILSAFE_ROOT_PASSWORD_HASH;
    delete process.env.BAKED_FAILSAFE_ROOT_PASSWORD_HASH;
    electronApp.isPackaged = false;
  });

  afterAll(() => {
    connection.closeDatabase();
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('accepte ROOT avec une empreinte valide et le bon mot de passe', async () => {
    process.env.FAILSAFE_ROOT_PASSWORD_HASH = VALID_HASH;
    const user = await loginHandler({}, 'ROOT', ROOT_PWD);
    expect(user).toMatchObject({ id_user: 999999, login: 'ROOT', role: 'SUPER ADMIN' });
  });

  it('refuse ROOT sans empreinte (compte désactivé)', async () => {
    expect(await loginHandler({}, 'root', ROOT_PWD)).toBeNull();
    await resetRootLock();
  });

  it("refuse ROOT avec une empreinte non bcrypt, même égale au mot de passe saisi", async () => {
    process.env.FAILSAFE_ROOT_PASSWORD_HASH = ROOT_PWD; // texte en clair, pas une empreinte
    expect(await loginHandler({}, 'root', ROOT_PWD)).toBeNull();
    process.env.FAILSAFE_ROOT_PASSWORD_HASH = VALID_HASH.slice(0, 40); // empreinte tronquée
    expect(await loginHandler({}, 'root', ROOT_PWD)).toBeNull();
    await resetRootLock();
  });

  it('refuse ROOT avec un mauvais mot de passe', async () => {
    process.env.FAILSAFE_ROOT_PASSWORD_HASH = VALID_HASH;
    expect(await loginHandler({}, 'root', 'mauvais')).toBeNull();
    expect(await loginHandler({}, 'root', '')).toBeNull();
    expect(await loginHandler({}, 'root', undefined)).toBeNull();
    await resetRootLock();
  });

  it("ignore l'ancienne variable en clair FAILSAFE_ROOT_PASSWORD", async () => {
    process.env.FAILSAFE_ROOT_PASSWORD = ROOT_PWD;
    expect(await loginHandler({}, 'root', ROOT_PWD)).toBeNull();
    await resetRootLock();
  });

  it("poste installé : l'empreinte d'exécution est ignorée, seule l'empreinte figée au build compte", async () => {
    electronApp.isPackaged = true;
    process.env.FAILSAFE_ROOT_PASSWORD_HASH = VALID_HASH;
    expect(await loginHandler({}, 'root', ROOT_PWD)).toBeNull();

    process.env.BAKED_FAILSAFE_ROOT_PASSWORD_HASH = VALID_HASH;
    const user = await loginHandler({}, 'root', ROOT_PWD);
    expect(user?.id_user).toBe(999999);
  });

  it('ROOT reste soumis au verrou anti-bruteforce (5 échecs -> même le bon mot de passe est refusé)', async () => {
    process.env.FAILSAFE_ROOT_PASSWORD_HASH = VALID_HASH;
    for (let i = 0; i < 5; i++) {
      expect(await loginHandler({}, 'root', 'mauvais')).toBeNull();
    }
    await expect(loginHandler({}, 'root', ROOT_PWD)).rejects.toThrow(/TROP_DE_TENTATIVES/);
  });
});
