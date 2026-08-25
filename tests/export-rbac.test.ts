import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Test ciblé — Correctif P0 (audit RBAC #3) : les handlers IPC `export:csv`,
 * `export:excel`, `export:pdf` et `export:getRows` (src/main/ipc/handlers.ts)
 * appelaient auparavant `queries.getExportRows(filters)` SANS AUCUNE vérification
 * de rôle ni cantonnement site forcé. `getExportRows()` ne filtre par site_id QUE
 * si `filters.site_id` est renseigné (base `WHERE 1=1`) : un appel IPC direct sans
 * ce paramètre (ou avec un site_id forgé) exposait les cartes de TOUS les sites,
 * avec des champs nominatifs sensibles (num_secu, contact, noms, prenoms,
 * date_de_naissance), à tout compte authentifié quel que soit son rôle.
 *
 * Correctif : ajout de `assertExportAccess(filters)` en tout début des 4 handlers,
 * qui (1) rejette tout rôle hors ['SUPER ADMIN', 'ADMINISTRATEUR_SITE'] et (2)
 * force `site_id = secureUser.site_id` pour tout rôle non-SUPER-ADMIN, en écrasant
 * toute valeur reçue du client. Le cas SUPER ADMIN sans site actif (export "tous
 * sites") reste préservé.
 *
 * Ce test exerce le VRAI handler `export:getRows` enregistré par
 * `registerIpcHandlers` (pas une réimplémentation), avec `getSecureCurrentUser()`
 * mocké pour piloter l'identité de session, mais `verifyUserRole()` (interne à
 * handlers.ts, non mockable) lit réellement `t_users` — les comptes de test sont
 * donc de vraies lignes en base.
 */

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gest-in-situ-test-export-rbac-'));

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn(),
    removeHandler: vi.fn()
  },
  dialog: {
    showOpenDialog: vi.fn(),
    showSaveDialog: vi.fn()
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
// test, pour isoler la vérification RBAC de `assertExportAccess()` — la vérification
// de rôle elle-même (`verifyUserRole`, interne à handlers.ts) continue de lire la
// VRAIE table t_users, non mockée ici.
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

describe('export:getRows — cantonnement RBAC/site (correctif P0)', () => {
  let connection: typeof import('../src/main/database/connection');
  let handlersModule: typeof import('../src/main/ipc/handlers');
  let db: import('better-sqlite3').Database;
  let exportGetRowsHandler: (event: any, filters?: Record<string, string>) => any;

  const SITE_A = 930;
  const SITE_B = 931;
  const USER_UNAUTHORIZED = 9301; // OPERATEUR_VERIFICATION, site A — hors rôles autorisés export
  const USER_ADMIN_SITE_A = 9302; // ADMINISTRATEUR_SITE, site A
  const USER_SUPER_ADMIN = 9303; // SUPER ADMIN

  beforeAll(async () => {
    connection = await import('../src/main/database/connection');
    handlersModule = await import('../src/main/ipc/handlers');

    db = await connection.initDatabase();

    db.prepare(`INSERT INTO t_sites (id, nom, code, is_active, sync_id) VALUES (?, 'SITE_A_EXPORT_TEST', 'SITE_A_EXPORT_TEST', 1, ?)`)
      .run(SITE_A, 'site-sync-930-export');
    db.prepare(`INSERT INTO t_sites (id, nom, code, is_active, sync_id) VALUES (?, 'SITE_B_EXPORT_TEST', 'SITE_B_EXPORT_TEST', 1, ?)`)
      .run(SITE_B, 'site-sync-931-export');

    db.prepare(`
      INSERT INTO t_users (id_user, login, password_hash, role, nom_user, statut_actif, site_id)
      VALUES (?, 'operateur.verif.export.test', 'x', 'OPERATEUR_VERIFICATION', 'Test', 1, ?)
    `).run(USER_UNAUTHORIZED, SITE_A);

    db.prepare(`
      INSERT INTO t_users (id_user, login, password_hash, role, nom_user, statut_actif, site_id)
      VALUES (?, 'admin.site.export.test', 'x', 'ADMINISTRATEUR_SITE', 'Test', 1, ?)
    `).run(USER_ADMIN_SITE_A, SITE_A);

    db.prepare(`
      INSERT INTO t_users (id_user, login, password_hash, role, nom_user, statut_actif, site_id)
      VALUES (?, 'super.admin.export.test', 'x', 'SUPER ADMIN', 'Test', 1, NULL)
    `).run(USER_SUPER_ADMIN);

    db.prepare(`
      INSERT INTO t_cartes (site_id, noms, prenoms, num_secu, is_dirty, sync_id)
      VALUES (?, 'NOM_SITE_A', 'PRENOM_SITE_A', NULL, 0, NULL)
    `).run(SITE_A);
    db.prepare(`
      INSERT INTO t_cartes (site_id, noms, prenoms, num_secu, is_dirty, sync_id)
      VALUES (?, 'NOM_SITE_B', 'PRENOM_SITE_B', NULL, 0, NULL)
    `).run(SITE_B);

    // Capture du handler réellement enregistré par registerIpcHandlers pour le canal
    // 'export:getRows' (véritable code de production, pas une réimplémentation).
    const { ipcMain } = await import('electron');
    handlersModule.registerIpcHandlers({ webContents: { send: vi.fn() } } as any);
    const registeredCalls = vi.mocked(ipcMain.handle).mock.calls;
    const call = registeredCalls.find(([channel]) => channel === 'export:getRows');
    expect(call).toBeDefined();
    exportGetRowsHandler = call![1] as typeof exportGetRowsHandler;
  });

  afterAll(() => {
    connection.closeDatabase();
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('(a) rejette un rôle hors [SUPER ADMIN, ADMINISTRATEUR_SITE] (OPERATEUR_VERIFICATION)', () => {
    mockGetSecureCurrentUser.mockReturnValue({ id_user: USER_UNAUTHORIZED, role: 'OPERATEUR_VERIFICATION', site_id: SITE_A, centre_id: null });

    expect(() => exportGetRowsHandler({} as any, {})).toThrow('Accès refusé pour cette opération.');
  });

  it("(b) un ADMINISTRATEUR_SITE sans site_id dans filters ne récupère QUE les cartes de son propre site", () => {
    mockGetSecureCurrentUser.mockReturnValue({ id_user: USER_ADMIN_SITE_A, role: 'ADMINISTRATEUR_SITE', site_id: SITE_A, centre_id: null });

    const rows = exportGetRowsHandler({} as any, {}) as Array<{ site_id: number }>;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every(r => r.site_id === SITE_A)).toBe(true);
  });

  it('(b bis) un ADMINISTRATEUR_SITE avec un site_id forgé (autre site) reste cantonné à son propre site', () => {
    mockGetSecureCurrentUser.mockReturnValue({ id_user: USER_ADMIN_SITE_A, role: 'ADMINISTRATEUR_SITE', site_id: SITE_A, centre_id: null });

    const rows = exportGetRowsHandler({} as any, { site_id: String(SITE_B) }) as Array<{ site_id: number }>;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every(r => r.site_id === SITE_A)).toBe(true);
  });

  it('(c) un SUPER ADMIN sans filters.site_id récupère les cartes de tous les sites (comportement légitime préservé)', () => {
    mockGetSecureCurrentUser.mockReturnValue({ id_user: USER_SUPER_ADMIN, role: 'SUPER ADMIN', site_id: null, centre_id: null });

    const rows = exportGetRowsHandler({} as any, {}) as Array<{ site_id: number }>;
    const siteIds = new Set(rows.map(r => r.site_id));
    expect(siteIds.has(SITE_A)).toBe(true);
    expect(siteIds.has(SITE_B)).toBe(true);
  });
});
