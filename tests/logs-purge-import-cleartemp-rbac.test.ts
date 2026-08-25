import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Test ciblé — Correctifs P0 (audit RBAC #4 et #5) :
 *
 * (1) `logs:purge` (src/main/ipc/handlers.ts) ne comportait AUCUNE vérification de
 *     rôle serveur — seule protection : un `dialog.showMessageBoxSync` natif côté
 *     renderer, qui n'est pas une barrière de sécurité (un appel IPC direct la
 *     contourne intégralement). `DELETE FROM t_audit_log` sans clause WHERE purge la
 *     totalité du journal, tous sites confondus. Correctif : garde
 *     `verifyUserRole(..., ['SUPER ADMIN', 'ADMINISTRATEUR_SITE'])` en tout début de
 *     handler, reflétant l'intention déjà présente côté UI (LogsPage.tsx:186).
 *
 * (2) `import:clearTemp` (src/main/ipc/handlers.ts) n'appelait pas
 *     `assertQualiteAccessOnSite(siteId)`, contrairement à tous ses handlers voisins
 *     (import:getAnomalies, clearAnomalies, etc.). Correctif : ajout de l'appel,
 *     identique au correctif déjà appliqué à `qualite:supprimerIncoherences`.
 *
 * Ce test exerce les VRAIS handlers enregistrés par `registerIpcHandlers` (pas une
 * réimplémentation), avec `getSecureCurrentUser()` mocké pour piloter l'identité de
 * session, mais `verifyUserRole()` (interne à handlers.ts, non mockable) lit
 * réellement `t_users` — les comptes de test sont donc de vraies lignes en base.
 *
 * Gestion de `dialog.showMessageBoxSync` (natif Electron) : le module `electron` est
 * entièrement mocké (comme dans les tests RBAC voisins) ; `showMessageBoxSync` est
 * remplacé par un `vi.fn()` piloté, ce qui permet d'isoler la vérification RBAC
 * (placée AVANT l'appel au dialog dans le handler corrigé) du comportement du dialog
 * lui-même. Pour le cas "rôle non autorisé", le dialog n'est jamais atteint (la garde
 * RBAC lève avant) — vérifié en assertant `showMessageBoxSync` non appelé. Pour le
 * cas "rôle autorisé", le mock retourne `1` (bouton "Confirmer la Purge") afin de
 * valider que la garde RBAC laisse bien passer un rôle légitime jusqu'à la purge
 * réelle.
 */

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gest-in-situ-test-logs-import-rbac-'));

const mockShowMessageBoxSync = vi.fn();

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn(),
    removeHandler: vi.fn()
  },
  dialog: {
    showOpenDialog: vi.fn(),
    showSaveDialog: vi.fn(),
    showMessageBoxSync: (...args: any[]) => mockShowMessageBoxSync(...args)
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

// Mock ciblé : seule l'identité de session (rôle/site actifs) est pilotée depuis le
// test, pour isoler les vérifications RBAC de `verifyUserRole()` et
// `assertQualiteAccessOnSite()` — la vérification de rôle elle-même (`verifyUserRole`,
// interne à handlers.ts) continue de lire la VRAIE table t_users, non mockée ici.
const mockGetSecureCurrentUser = vi.fn();
vi.mock('../src/main/auth/session-heartbeat', () => ({
  startSessionHeartbeat: vi.fn(),
  stopSessionHeartbeat: vi.fn(),
  getCurrentUserLogin: vi.fn(() => 'test.user'),
  getSecureCurrentUser: (...args: any[]) => mockGetSecureCurrentUser(...args),
  setActiveRole: vi.fn(),
  getCurrentGrantedRoles: vi.fn(() => []),
  refreshSecureCurrentUser: vi.fn()
}));

describe('logs:purge — garde RBAC serveur (correctif P0 #4)', () => {
  let connection: typeof import('../src/main/database/connection');
  let handlersModule: typeof import('../src/main/ipc/handlers');
  let db: import('better-sqlite3').Database;
  let logsPurgeHandler: (event: any, payload?: { periode_purge?: string }) => Promise<any>;

  const SITE_A = 940;
  const USER_OPERATEUR = 9401; // OPERATEUR_VERIFICATION — hors rôles autorisés purge
  const USER_ADMIN_CENTRE = 9402; // ADMIN_CENTRE — lecture seule sur /logs, jamais la purge
  const USER_ADMIN_SITE = 9403; // ADMINISTRATEUR_SITE — autorisé
  const USER_SUPER_ADMIN = 9404; // SUPER ADMIN — autorisé

  beforeAll(async () => {
    connection = await import('../src/main/database/connection');
    handlersModule = await import('../src/main/ipc/handlers');

    db = await connection.initDatabase();

    db.prepare(`INSERT INTO t_sites (id, nom, code, is_active, sync_id) VALUES (?, 'SITE_A_LOGS_TEST', 'SITE_A_LOGS_TEST', 1, ?)`)
      .run(SITE_A, 'site-sync-940-logs');

    db.prepare(`
      INSERT INTO t_users (id_user, login, password_hash, role, nom_user, statut_actif, site_id)
      VALUES (?, 'operateur.verif.logs.test', 'x', 'OPERATEUR_VERIFICATION', 'Test', 1, ?)
    `).run(USER_OPERATEUR, SITE_A);

    db.prepare(`
      INSERT INTO t_users (id_user, login, password_hash, role, nom_user, statut_actif, site_id)
      VALUES (?, 'admin.centre.logs.test', 'x', 'ADMIN_CENTRE', 'Test', 1, ?)
    `).run(USER_ADMIN_CENTRE, SITE_A);

    db.prepare(`
      INSERT INTO t_users (id_user, login, password_hash, role, nom_user, statut_actif, site_id)
      VALUES (?, 'admin.site.logs.test', 'x', 'ADMINISTRATEUR_SITE', 'Test', 1, ?)
    `).run(USER_ADMIN_SITE, SITE_A);

    db.prepare(`
      INSERT INTO t_users (id_user, login, password_hash, role, nom_user, statut_actif, site_id)
      VALUES (?, 'super.admin.logs.test', 'x', 'SUPER ADMIN', 'Test', 1, NULL)
    `).run(USER_SUPER_ADMIN);

    // Capture du handler réellement enregistré par registerIpcHandlers pour le canal
    // 'logs:purge' (véritable code de production, pas une réimplémentation).
    const { ipcMain } = await import('electron');
    handlersModule.registerIpcHandlers({ webContents: { send: vi.fn() } } as any);
    const registeredCalls = vi.mocked(ipcMain.handle).mock.calls;
    const call = registeredCalls.find(([channel]) => channel === 'logs:purge');
    expect(call).toBeDefined();
    logsPurgeHandler = call![1] as typeof logsPurgeHandler;
  });

  afterAll(() => {
    connection.closeDatabase();
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('(a) rejette OPERATEUR_VERIFICATION et ne vide pas t_audit_log (dialog jamais atteint)', async () => {
    mockGetSecureCurrentUser.mockReturnValue({ id_user: USER_OPERATEUR, role: 'OPERATEUR_VERIFICATION', site_id: SITE_A, centre_id: null });
    mockShowMessageBoxSync.mockClear();

    db.prepare(`INSERT INTO t_audit_log (utilisateur, action, details) VALUES ('probe', 'PROBE_ACTION', '{}')`).run();
    const countBefore = (db.prepare('SELECT COUNT(*) as count FROM t_audit_log').get() as any).count;
    expect(countBefore).toBeGreaterThan(0);

    await expect(logsPurgeHandler({} as any, {})).rejects.toThrow(
      "Accès refusé. Seul le SUPER ADMIN ou l'ADMINISTRATEUR_SITE peut purger le journal d'audit."
    );

    expect(mockShowMessageBoxSync).not.toHaveBeenCalled();
    const countAfter = (db.prepare('SELECT COUNT(*) as count FROM t_audit_log').get() as any).count;
    expect(countAfter).toBe(countBefore); // intact
  });

  it("(b) rejette ADMIN_CENTRE (lecture seule sur /logs — jamais la purge) et ne vide pas t_audit_log", async () => {
    mockGetSecureCurrentUser.mockReturnValue({ id_user: USER_ADMIN_CENTRE, role: 'ADMIN_CENTRE', site_id: SITE_A, centre_id: 1 });
    mockShowMessageBoxSync.mockClear();

    const countBefore = (db.prepare('SELECT COUNT(*) as count FROM t_audit_log').get() as any).count;
    expect(countBefore).toBeGreaterThan(0);

    await expect(logsPurgeHandler({} as any, {})).rejects.toThrow(
      "Accès refusé. Seul le SUPER ADMIN ou l'ADMINISTRATEUR_SITE peut purger le journal d'audit."
    );

    expect(mockShowMessageBoxSync).not.toHaveBeenCalled();
    const countAfter = (db.prepare('SELECT COUNT(*) as count FROM t_audit_log').get() as any).count;
    expect(countAfter).toBe(countBefore); // intact
  });

  it('(c) laisse passer ADMINISTRATEUR_SITE (rôle autorisé) jusqu\'à la purge réelle', async () => {
    mockGetSecureCurrentUser.mockReturnValue({ id_user: USER_ADMIN_SITE, role: 'ADMINISTRATEUR_SITE', site_id: SITE_A, centre_id: null });
    mockShowMessageBoxSync.mockClear();
    mockShowMessageBoxSync.mockReturnValue(1); // "Confirmer la Purge"

    const countBefore = (db.prepare('SELECT COUNT(*) as count FROM t_audit_log').get() as any).count;
    expect(countBefore).toBeGreaterThan(0);

    const result = await logsPurgeHandler({} as any, {});

    expect(mockShowMessageBoxSync).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
    expect(result.nombre_lignes_supprimées).toBe(countBefore);
    const countAfter = (db.prepare('SELECT COUNT(*) as count FROM t_audit_log').get() as any).count;
    expect(countAfter).toBe(0); // comportement de purge inchangé pour un rôle légitime
  });

  it('(d) laisse passer SUPER ADMIN (rôle autorisé) jusqu\'à la purge réelle', async () => {
    mockGetSecureCurrentUser.mockReturnValue({ id_user: USER_SUPER_ADMIN, role: 'SUPER ADMIN', site_id: null, centre_id: null });
    mockShowMessageBoxSync.mockClear();
    mockShowMessageBoxSync.mockReturnValue(1); // "Confirmer la Purge"

    db.prepare(`INSERT INTO t_audit_log (utilisateur, action, details) VALUES ('probe2', 'PROBE_ACTION_2', '{}')`).run();
    const countBefore = (db.prepare('SELECT COUNT(*) as count FROM t_audit_log').get() as any).count;
    expect(countBefore).toBeGreaterThan(0);

    const result = await logsPurgeHandler({} as any, {});

    expect(result.success).toBe(true);
    const countAfter = (db.prepare('SELECT COUNT(*) as count FROM t_audit_log').get() as any).count;
    expect(countAfter).toBe(0);
  });
});

describe('import:clearTemp — cantonnement RBAC/site (correctif P0 #5)', () => {
  let connection: typeof import('../src/main/database/connection');
  let handlersModule: typeof import('../src/main/ipc/handlers');
  let db: import('better-sqlite3').Database;
  let importClearTempHandler: (event: any, siteId: any) => any;

  const SITE_A = 950;
  const SITE_B = 951;
  const USER_UNAUTHORIZED = 9501; // OPERATEUR_VERIFICATION, site A — hors QUALITE_ROLES
  const USER_ADMIN_SITE_A = 9502; // ADMINISTRATEUR_SITE, site A — légitime sur A, pas sur B

  beforeAll(async () => {
    connection = await import('../src/main/database/connection');
    handlersModule = await import('../src/main/ipc/handlers');

    db = await connection.initDatabase();

    db.prepare(`INSERT INTO t_sites (id, nom, code, is_active, sync_id) VALUES (?, 'SITE_A_IMPORT_TEST', 'SITE_A_IMPORT_TEST', 1, ?)`)
      .run(SITE_A, 'site-sync-950-import');
    db.prepare(`INSERT INTO t_sites (id, nom, code, is_active, sync_id) VALUES (?, 'SITE_B_IMPORT_TEST', 'SITE_B_IMPORT_TEST', 1, ?)`)
      .run(SITE_B, 'site-sync-951-import');

    db.prepare(`
      INSERT INTO t_users (id_user, login, password_hash, role, nom_user, statut_actif, site_id)
      VALUES (?, 'operateur.verif.import.test', 'x', 'OPERATEUR_VERIFICATION', 'Test', 1, ?)
    `).run(USER_UNAUTHORIZED, SITE_A);

    db.prepare(`
      INSERT INTO t_users (id_user, login, password_hash, role, nom_user, statut_actif, site_id)
      VALUES (?, 'admin.site.import.test', 'x', 'ADMINISTRATEUR_SITE', 'Test', 1, ?)
    `).run(USER_ADMIN_SITE_A, SITE_A);

    // Capture du handler réellement enregistré par registerIpcHandlers pour le canal
    // 'import:clearTemp' (véritable code de production, pas une réimplémentation).
    const { ipcMain } = await import('electron');
    handlersModule.registerIpcHandlers({ webContents: { send: vi.fn() } } as any);
    const registeredCalls = vi.mocked(ipcMain.handle).mock.calls;
    const call = registeredCalls.find(([channel]) => channel === 'import:clearTemp');
    expect(call).toBeDefined();
    importClearTempHandler = call![1] as typeof importClearTempHandler;
  });

  afterAll(() => {
    connection.closeDatabase();
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('(a) rejette un rôle hors QUALITE_ROLES (OPERATEUR_VERIFICATION) et ne vide rien', async () => {
    mockGetSecureCurrentUser.mockReturnValue({ id_user: USER_UNAUTHORIZED, role: 'OPERATEUR_VERIFICATION', site_id: SITE_A, centre_id: null });

    db.prepare(`
      INSERT INTO t_import_temp (site_id, noms, prenoms) VALUES (?, 'NOM_A', 'PRENOM_A')
    `).run(SITE_A);
    const countBefore = (db.prepare('SELECT COUNT(*) as count FROM t_import_temp WHERE site_id = ?').get(SITE_A) as any).count;
    expect(countBefore).toBeGreaterThan(0);

    expect(() => importClearTempHandler({} as any, SITE_A)).toThrow('Accès refusé pour cette opération.');

    const countAfter = (db.prepare('SELECT COUNT(*) as count FROM t_import_temp WHERE site_id = ?').get(SITE_A) as any).count;
    expect(countAfter).toBe(countBefore); // intact
  });

  it("(b) rejette un ADMINISTRATEUR_SITE ciblant un site autre que le sien", async () => {
    mockGetSecureCurrentUser.mockReturnValue({ id_user: USER_ADMIN_SITE_A, role: 'ADMINISTRATEUR_SITE', site_id: SITE_A, centre_id: null });

    db.prepare(`
      INSERT INTO t_import_temp (site_id, noms, prenoms) VALUES (?, 'NOM_B', 'PRENOM_B')
    `).run(SITE_B);
    const countBefore = (db.prepare('SELECT COUNT(*) as count FROM t_import_temp WHERE site_id = ?').get(SITE_B) as any).count;
    expect(countBefore).toBeGreaterThan(0);

    expect(() => importClearTempHandler({} as any, SITE_B)).toThrow("Accès refusé : ce site n'est pas le vôtre.");

    const countAfter = (db.prepare('SELECT COUNT(*) as count FROM t_import_temp WHERE site_id = ?').get(SITE_B) as any).count;
    expect(countAfter).toBe(countBefore); // intact
  });

  it('(c) un appel légitime (rôle autorisé, bon site) fonctionne toujours normalement', async () => {
    mockGetSecureCurrentUser.mockReturnValue({ id_user: USER_ADMIN_SITE_A, role: 'ADMINISTRATEUR_SITE', site_id: SITE_A, centre_id: null });

    db.prepare(`
      INSERT INTO t_import_temp (site_id, noms, prenoms) VALUES (?, 'NOM_C', 'PRENOM_C')
    `).run(SITE_A);
    const countBefore = (db.prepare('SELECT COUNT(*) as count FROM t_import_temp WHERE site_id = ?').get(SITE_A) as any).count;
    expect(countBefore).toBeGreaterThan(0);

    const result = importClearTempHandler({} as any, SITE_A);
    expect(result).toBeDefined();

    const countAfter = (db.prepare('SELECT COUNT(*) as count FROM t_import_temp WHERE site_id = ?').get(SITE_A) as any).count;
    expect(countAfter).toBe(0); // purge effective sur le bon site (comportement inchangé)
  });
});
