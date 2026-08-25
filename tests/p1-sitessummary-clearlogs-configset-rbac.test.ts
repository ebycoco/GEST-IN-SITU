import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Test ciblé — Correctifs P1 (audit RBAC systématique, items #7 à #9) :
 *
 * (1) `hierarchy:getSitesSummary` (src/main/ipc/handlers.ts) ne comportait AUCUNE
 *     vérification — tout compte authentifié recevait le résumé (compteurs +
 *     login de l'ADMINISTRATEUR_SITE) de tous les sites. Correctif : même pattern
 *     que `hierarchy:getSites` (P0-1) — filtrage sur secureUser.site_id pour tout
 *     rôle non-SUPER-ADMIN.
 *
 * (2) `maintenance:clearLogs` n'était protégé que par la vérification du MOT DE
 *     PASSE PROPRE À L'APPELANT (`verifyUserPassword`) — ne prouve pas la
 *     détention d'un rôle privilégié. Correctif : garde `verifyUserRole(...,
 *     ['SUPER ADMIN'])` ajoutée EN PLUS (la vérification par mot de passe reste
 *     intacte, testée séparément).
 *
 * (3) `config:set` (canal orphelin côté renderer, mais invocable directement)
 *     n'avait AUCUNE garde. Correctif : `verifyUserRole(..., ['SUPER ADMIN'])`.
 *
 * Ce test exerce les VRAIS handlers enregistrés par `registerIpcHandlers` (pas une
 * réimplémentation), avec `getSecureCurrentUser()` mocké pour piloter l'identité de
 * session, mais `verifyUserRole()`/`verifyUserPassword()` (internes, non mockables)
 * lisent réellement `t_users` — les comptes de test sont donc de vraies lignes.
 */

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gest-in-situ-test-sitessummary-clearlogs-configset-rbac-'));

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

describe('handlers P1-2/P1-3/P1-4', () => {
  let connection: typeof import('../src/main/database/connection');
  let handlersModule: typeof import('../src/main/ipc/handlers');
  let db: import('better-sqlite3').Database;
  let getSitesSummaryHandler: (event: any) => Promise<any>;
  let clearLogsHandler: (event: any, password: any, currentUser?: any) => Promise<any>;
  let configSetHandler: (event: any, key: any, value: any) => Promise<any>;

  const SITE_A = 970;
  const SITE_B = 971;
  const USER_ADMIN_SITE_A = 9701; // ADMINISTRATEUR_SITE, site A
  const USER_OPERATEUR_A = 9702; // OPERATEUR_VERIFICATION, site A — hors rôles autorisés clearLogs/configSet
  const USER_SUPER_ADMIN = 9703; // SUPER ADMIN

  beforeAll(async () => {
    connection = await import('../src/main/database/connection');
    handlersModule = await import('../src/main/ipc/handlers');

    db = await connection.initDatabase();

    db.prepare(`INSERT INTO t_sites (id, nom, code, is_active, sync_id) VALUES (?, 'SITE_A_P1_TEST', 'SITE_A_P1_TEST', 1, ?)`)
      .run(SITE_A, 'site-sync-970-p1');
    db.prepare(`INSERT INTO t_sites (id, nom, code, is_active, sync_id) VALUES (?, 'SITE_B_P1_TEST', 'SITE_B_P1_TEST', 1, ?)`)
      .run(SITE_B, 'site-sync-971-p1');

    db.prepare(`
      INSERT INTO t_users (id_user, login, password_hash, role, nom_user, statut_actif, site_id)
      VALUES (?, 'admin.site.p1.test', 'x', 'ADMINISTRATEUR_SITE', 'Test', 1, ?)
    `).run(USER_ADMIN_SITE_A, SITE_A);

    db.prepare(`
      INSERT INTO t_users (id_user, login, password_hash, role, nom_user, statut_actif, site_id)
      VALUES (?, 'operateur.p1.test', 'x', 'OPERATEUR_VERIFICATION', 'Test', 1, ?)
    `).run(USER_OPERATEUR_A, SITE_A);

    db.prepare(`
      INSERT INTO t_users (id_user, login, password_hash, role, nom_user, statut_actif, site_id)
      VALUES (?, 'super.admin.p1.test', 'x', 'SUPER ADMIN', 'Test', 1, NULL)
    `).run(USER_SUPER_ADMIN);

    const { ipcMain } = await import('electron');
    handlersModule.registerIpcHandlers({ webContents: { send: vi.fn() } } as any);
    const registeredCalls = vi.mocked(ipcMain.handle).mock.calls;

    const summaryCall = registeredCalls.find(([channel]) => channel === 'hierarchy:getSitesSummary');
    expect(summaryCall).toBeDefined();
    getSitesSummaryHandler = summaryCall![1] as typeof getSitesSummaryHandler;

    const clearLogsCall = registeredCalls.find(([channel]) => channel === 'maintenance:clearLogs');
    expect(clearLogsCall).toBeDefined();
    clearLogsHandler = clearLogsCall![1] as typeof clearLogsHandler;

    const configSetCall = registeredCalls.find(([channel]) => channel === 'config:set');
    expect(configSetCall).toBeDefined();
    configSetHandler = configSetCall![1] as typeof configSetHandler;
  });

  afterAll(() => {
    connection.closeDatabase();
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('hierarchy:getSitesSummary — cloisonnement site (P1-2)', () => {
    it('(a) rejette une session invalide', async () => {
      mockGetSecureCurrentUser.mockReturnValue(null);
      await expect(getSitesSummaryHandler({} as any)).rejects.toThrow('Session invalide.');
    });

    it('(b) cantonne ADMINISTRATEUR_SITE à son propre site (pas de fuite cross-site)', async () => {
      mockGetSecureCurrentUser.mockReturnValue({ id_user: USER_ADMIN_SITE_A, role: 'ADMINISTRATEUR_SITE', site_id: SITE_A, centre_id: null });
      const result = await getSitesSummaryHandler({} as any) as any[];
      expect(result.length).toBe(1);
      expect(result[0].id).toBe(SITE_A);
    });

    it('(c) renvoie tous les sites à SUPER ADMIN (comportement inchangé)', async () => {
      mockGetSecureCurrentUser.mockReturnValue({ id_user: USER_SUPER_ADMIN, role: 'SUPER ADMIN', site_id: null, centre_id: null });
      const result = await getSitesSummaryHandler({} as any) as any[];
      const ids = result.map((s) => s.id);
      expect(ids).toContain(SITE_A);
      expect(ids).toContain(SITE_B);
    });
  });

  describe('maintenance:clearLogs — garde de rôle EN PLUS du mot de passe (P1-3)', () => {
    beforeAll(() => {
      db.prepare(`INSERT INTO t_logs (action, detail) VALUES ('PROBE_ACTION', 'probe P1-3')`).run();
    });

    it("(a) rejette un rôle non-SUPER-ADMIN AVANT toute vérification de mot de passe (mot de passe jamais évalué)", async () => {
      mockGetSecureCurrentUser.mockReturnValue({ id_user: USER_ADMIN_SITE_A, role: 'ADMINISTRATEUR_SITE', site_id: SITE_A, centre_id: null });

      const countBefore = (db.prepare('SELECT COUNT(*) as count FROM t_logs').get() as any).count;
      expect(countBefore).toBeGreaterThan(0);

      // Mot de passe volontairement correct-ou-non n'a pas d'importance : la garde de rôle
      // doit rejeter AVANT d'atteindre verifyUserPassword().
      await expect(clearLogsHandler({} as any, 'peu importe', { login: 'admin.site.p1.test' })).rejects.toThrow(
        'Accès refusé. Seul le SUPER ADMIN peut purger les logs système.'
      );

      const countAfter = (db.prepare('SELECT COUNT(*) as count FROM t_logs').get() as any).count;
      expect(countAfter).toBe(countBefore); // intact
    });

    it('(b) laisse passer SUPER ADMIN jusqu\'à la vérification de mot de passe existante (non contournée)', async () => {
      mockGetSecureCurrentUser.mockReturnValue({ id_user: USER_SUPER_ADMIN, role: 'SUPER ADMIN', site_id: null, centre_id: null });

      // password_hash = 'x' (non-bcrypt) pour cet utilisateur de test : verifyUserPassword()
      // rejette délibérément tout hash non-bcrypt (voir hierarchy.queries.ts). On vérifie ici
      // que la garde de rôle laisse bien passer jusqu'à CETTE vérification préexistante
      // (message d'erreur distinct de celui de la garde de rôle), preuve qu'elle n'a pas été
      // contournée par le nouveau correctif.
      await expect(clearLogsHandler({} as any, 'wrong-password', { login: 'super.admin.p1.test' })).rejects.toThrow(
        'Mot de passe incorrect.'
      );
    });
  });

  describe('config:set — garde de rôle (P1-4)', () => {
    it('(a) rejette OPERATEUR_VERIFICATION et n\'écrit rien dans t_config', async () => {
      mockGetSecureCurrentUser.mockReturnValue({ id_user: USER_OPERATEUR_A, role: 'OPERATEUR_VERIFICATION', site_id: SITE_A, centre_id: null });

      await expect(configSetHandler({} as any, 'test_key_p1_4', 'valeur_interdite')).rejects.toThrow(
        'Accès refusé. Seul le SUPER ADMIN peut modifier la configuration système.'
      );

      const row = db.prepare('SELECT value FROM t_config WHERE key = ?').get('test_key_p1_4');
      expect(row).toBeUndefined();
    });

    it('(b) accepte SUPER ADMIN et écrit bien dans t_config (comportement inchangé)', async () => {
      mockGetSecureCurrentUser.mockReturnValue({ id_user: USER_SUPER_ADMIN, role: 'SUPER ADMIN', site_id: null, centre_id: null });

      await configSetHandler({} as any, 'test_key_p1_4', 'valeur_autorisee');

      const row = db.prepare('SELECT value FROM t_config WHERE key = ?').get('test_key_p1_4') as any;
      expect(row.value).toBe('valeur_autorisee');
    });
  });
});
