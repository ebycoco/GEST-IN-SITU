import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Test ciblé — Correctif P1-1 (audit RBAC systématique, item #6) :
 *
 * `sync:forceGlobal` (src/main/ipc/handlers.ts) ne comportait AUCUNE vérification —
 * n'importe quel rôle authentifié pouvait déclencher `forceGlobalSuperAdminSync()`
 * (marque is_dirty=1 sur la totalité de t_sites/t_centres/t_users, tous sites
 * confondus). Correctif : deux chemins distincts —
 *  (1) session active → exige verifyUserRole(..., ['SUPER ADMIN']) ;
 *  (2) aucune session (bootstrap LoginPage.tsx pré-connexion) → autorisé
 *      UNIQUEMENT si t_users est vide (même critère que app:checkFirstLaunch).
 *
 * Ce test exerce le VRAI handler enregistré par `registerIpcHandlers` (pas une
 * réimplémentation), avec `getSecureCurrentUser()` mocké pour piloter l'identité de
 * session, mais `verifyUserRole()` (interne à handlers.ts, non mockable) lit
 * réellement `t_users` — les comptes de test sont donc de vraies lignes en base.
 *
 * Ordre des describes IMPORTANT : le premier describe (bootstrap) doit s'exécuter
 * avant toute insertion dans t_users, pour garantir un t_users réellement vide au
 * moment du test "(a) autorise si t_users vide".
 *
 * DÉCOUVERTE (pas une régression du correctif) : la migration V1 (schema.ts) insère
 * TOUJOURS un compte 'superadmin' par défaut (id_user=1, INSERT OR IGNORE) sur toute
 * base fraîchement créée — t_users n'est donc JAMAIS réellement vide juste après
 * initDatabase(), y compris en production. Le critère "t_users vide = premier
 * lancement" (déjà utilisé tel quel par le handler préexistant app:checkFirstLaunch,
 * repris ici par cohérence) est donc structurellement toujours faux : le chemin
 * bootstrap de sync:forceGlobal (déclenché uniquement si isFirstLaunch est vrai côté
 * LoginPage.tsx) est déjà inatteignable aujourd'hui, indépendamment de ce correctif —
 * qui n'introduit donc aucune régression fonctionnelle nouvelle. Le test (a)
 * supprime explicitement ce compte seed pour exercer quand même la branche de code
 * correspondante (vérifier qu'elle fonctionne SI jamais t_users était un jour
 * réellement vide), sans prétendre que ce scénario se produit en pratique.
 */

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gest-in-situ-test-forceglobal-rbac-'));

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

describe('sync:forceGlobal — garde RBAC serveur (correctif P1-1)', () => {
  let connection: typeof import('../src/main/database/connection');
  let handlersModule: typeof import('../src/main/ipc/handlers');
  let db: import('better-sqlite3').Database;
  let forceGlobalHandler: (event: any, currentUser?: any) => Promise<any>;

  const SITE_A = 960;
  const USER_ADMIN_SITE = 9601; // ADMINISTRATEUR_SITE — appelant réel problématique (dashboard)
  const USER_SUPER_ADMIN = 9602; // SUPER ADMIN — autorisé

  beforeAll(async () => {
    connection = await import('../src/main/database/connection');
    handlersModule = await import('../src/main/ipc/handlers');

    // t_users est vide juste après initDatabase() (fraîchement créée dans tmpDir) :
    // c'est cette fenêtre qui est exploitée par le test bootstrap ci-dessous.
    db = await connection.initDatabase();

    db.prepare(`INSERT INTO t_sites (id, nom, code, is_active, sync_id) VALUES (?, 'SITE_A_FORCEGLOBAL_TEST', 'SITE_A_FORCEGLOBAL_TEST', 1, ?)`)
      .run(SITE_A, 'site-sync-960-forceglobal');

    const { ipcMain } = await import('electron');
    handlersModule.registerIpcHandlers({ webContents: { send: vi.fn() } } as any);
    const registeredCalls = vi.mocked(ipcMain.handle).mock.calls;
    const call = registeredCalls.find(([channel]) => channel === 'sync:forceGlobal');
    expect(call).toBeDefined();
    forceGlobalHandler = call![1] as typeof forceGlobalHandler;
  });

  afterAll(() => {
    connection.closeDatabase();
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('(a) bootstrap : autorise si aucune session ET t_users vide (premier lancement réel)', async () => {
    mockGetSecureCurrentUser.mockReturnValue(null);

    // Supprime le compte 'superadmin' seedé par la migration V1 (cf. note de découverte
    // en tête de fichier) : t_users n'est JAMAIS vide autrement, y compris juste après
    // initDatabase(). Nécessaire pour exercer réellement la branche "t_users vide".
    db.prepare("DELETE FROM t_users WHERE login = 'superadmin'").run();

    const countUsersBefore = (db.prepare('SELECT COUNT(*) as count FROM t_users').get() as any).count;
    expect(countUsersBefore).toBe(0); // précondition du test : vraiment aucun utilisateur

    db.prepare('UPDATE t_sites SET is_dirty = 0').run();

    await forceGlobalHandler({} as any, undefined);

    const site = db.prepare('SELECT is_dirty FROM t_sites WHERE id = ?').get(SITE_A) as any;
    expect(site.is_dirty).toBe(1); // la synchro a bien été appliquée pour le cas bootstrap légitime
  });

  it("(b) bootstrap : rejette si aucune session ET t_users non vide (n'est plus un premier lancement)", async () => {
    // Insère un utilisateur réel : t_users n'est plus vide à partir d'ici.
    db.prepare(`
      INSERT INTO t_users (id_user, login, password_hash, role, nom_user, statut_actif, site_id)
      VALUES (?, 'admin.site.forceglobal.test', 'x', 'ADMINISTRATEUR_SITE', 'Test', 1, ?)
    `).run(USER_ADMIN_SITE, SITE_A);

    mockGetSecureCurrentUser.mockReturnValue(null);

    const countUsersBefore = (db.prepare('SELECT COUNT(*) as count FROM t_users').get() as any).count;
    expect(countUsersBefore).toBeGreaterThan(0);

    db.prepare('UPDATE t_sites SET is_dirty = 0').run();

    await expect(forceGlobalHandler({} as any, undefined)).rejects.toThrow('Accès refusé. Session invalide.');

    const site = db.prepare('SELECT is_dirty FROM t_sites WHERE id = ?').get(SITE_A) as any;
    expect(site.is_dirty).toBe(0); // aucune synchro déclenchée pour un appel non-bootstrap sans session
  });

  it('(c) session active : rejette ADMINISTRATEUR_SITE (rôle insuffisant pour une synchro globale tous-sites)', async () => {
    mockGetSecureCurrentUser.mockReturnValue({ id_user: USER_ADMIN_SITE, login: 'admin.site.forceglobal.test', role: 'ADMINISTRATEUR_SITE', site_id: SITE_A, centre_id: null });

    db.prepare('UPDATE t_sites SET is_dirty = 0').run();

    await expect(forceGlobalHandler({} as any, { login: 'admin.site.forceglobal.test' })).rejects.toThrow(
      'Accès refusé. Seul le SUPER ADMIN peut lancer une synchronisation globale.'
    );

    const site = db.prepare('SELECT is_dirty FROM t_sites WHERE id = ?').get(SITE_A) as any;
    expect(site.is_dirty).toBe(0); // intact : rejeté avant tout effet
  });

  it('(d) session active : accepte SUPER ADMIN (rôle légitime)', async () => {
    db.prepare(`
      INSERT INTO t_users (id_user, login, password_hash, role, nom_user, statut_actif, site_id)
      VALUES (?, 'super.admin.forceglobal.test', 'x', 'SUPER ADMIN', 'Test', 1, NULL)
    `).run(USER_SUPER_ADMIN);

    mockGetSecureCurrentUser.mockReturnValue({ id_user: USER_SUPER_ADMIN, login: 'super.admin.forceglobal.test', role: 'SUPER ADMIN', site_id: null, centre_id: null });

    db.prepare('UPDATE t_sites SET is_dirty = 0').run();

    await forceGlobalHandler({} as any, { login: 'super.admin.forceglobal.test' });

    const site = db.prepare('SELECT is_dirty FROM t_sites WHERE id = ?').get(SITE_A) as any;
    expect(site.is_dirty).toBe(1); // comportement inchangé pour un rôle légitime
  });
});
