import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Handler `versions:getPostes` (src/main/ipc/handlers.ts) — écran SUPER ADMIN « Versions des
 * postes » (docs/PLAN_ECRAN_VERSIONS_POSTES.md, étape 3).
 *
 * Exerce le VRAI handler enregistré par registerIpcHandlers, avec getSecureCurrentUser() mocké
 * (rôle ACTIF de session) ; verifyUserRole() lit réellement t_users (lignes de test).
 * Refus attendus : pas de session, rôle actif ≠ SUPER ADMIN (même pour un compte qui porte
 * SUPER ADMIN en rôle secondaire), verifyUserRole faux (compte SUPER ADMIN désactivé).
 * Cas autorisé : SUPER ADMIN actif → passe la garde ; le moniteur réseau n'est pas démarré
 * dans ce test (état OFFLINE) → réponse structurée OFFLINE, aucun appel réseau.
 */

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gest-in-situ-test-versions-getpostes-rbac-'));

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
    getVersion: () => '2.27.0',
    isPackaged: false,
    once: vi.fn()
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

// Chemin de succès : client Supabase factice (deux RPC), version connue de l'auto-updater simulée
// (le vrai module tire electron-updater, non chargeable hors Electron). Aucun appel réseau.
const fakeRpcData: Record<string, unknown> = {
  fn_list_client_versions: [
    { poste_ref: 'abcdef12', app_version: '2.27.0', site_sync_id: 'site-sync-980', last_user_sync_id: null, first_seen_at: '2026-11-01T00:00:00Z', last_seen_at: '2026-11-14T00:00:00Z', nb_reports: 3, key_kind: 'publishable' }
  ],
  fn_count_client_versions: [{ nb_total: 4, nb_preuve: 1, nb_ignorees: 1, nb_listables: 2 }]
};
const fakeSupabase = {
  rpc: (fn: string) => ({ abortSignal: async () => ({ data: fakeRpcData[fn], error: null }) })
};
vi.mock('../src/main/sync/supabase-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/main/sync/supabase-client')>()),
  getSupabaseClient: () => fakeSupabase
}));
vi.mock('../src/main/auto-updater', () => ({
  getLastKnownLatestVersion: () => '2.28.0'
}));

describe('versions:getPostes — contrôle d\'accès', () => {
  let connection: typeof import('../src/main/database/connection');
  let db: import('better-sqlite3').Database;
  let handler: (event: any, ...args: any[]) => Promise<any>;

  const SITE = 980;
  const USER_SA = 9801;            // SUPER ADMIN actif
  const USER_SA_INACTIF = 9802;    // SUPER ADMIN désactivé → verifyUserRole faux
  const USER_ADMIN_SITE = 9803;    // ADMINISTRATEUR_SITE avec SUPER ADMIN en rôle secondaire

  beforeAll(async () => {
    connection = await import('../src/main/database/connection');
    const handlersModule = await import('../src/main/ipc/handlers');
    db = await connection.initDatabase();

    db.prepare(`INSERT INTO t_sites (id, nom, code, is_active, sync_id) VALUES (?, 'SITE_VERSIONS_TEST', 'SITE_VERSIONS_TEST', 1, 'site-sync-980')`).run(SITE);
    db.prepare(`INSERT INTO t_users (id_user, login, password_hash, role, nom_user, statut_actif, site_id) VALUES (?, 'sa.versions.test', 'x', 'SUPER ADMIN', 'Test', 1, NULL)`).run(USER_SA);
    db.prepare(`INSERT INTO t_users (id_user, login, password_hash, role, nom_user, statut_actif, site_id) VALUES (?, 'sa.inactif.versions.test', 'x', 'SUPER ADMIN', 'Test', 0, NULL)`).run(USER_SA_INACTIF);
    db.prepare(`INSERT INTO t_users (id_user, login, password_hash, role, nom_user, statut_actif, site_id) VALUES (?, 'admin.site.versions.test', 'x', 'ADMINISTRATEUR_SITE', 'Test', 1, ?)`).run(USER_ADMIN_SITE, SITE);
    db.prepare(`INSERT INTO t_user_roles (id_user, role) VALUES (?, 'SUPER ADMIN')`).run(USER_ADMIN_SITE);

    const { ipcMain } = await import('electron');
    handlersModule.registerIpcHandlers({ webContents: { send: vi.fn() } } as any);
    const call = vi.mocked(ipcMain.handle).mock.calls.find(([channel]) => channel === 'versions:getPostes');
    expect(call).toBeDefined();
    handler = call![1] as typeof handler;
  });

  afterAll(() => {
    connection.closeDatabase();
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('refuse sans session', async () => {
    mockGetSecureCurrentUser.mockReturnValue(null);
    expect(await handler({})).toEqual({ success: false, error: 'FORBIDDEN' });
  });

  it('refuse un rôle actif non SUPER ADMIN, même si le compte porte SUPER ADMIN en rôle secondaire', async () => {
    mockGetSecureCurrentUser.mockReturnValue({ id_user: USER_ADMIN_SITE, role: 'ADMINISTRATEUR_SITE', site_id: SITE, centre_id: null });
    expect(await handler({})).toEqual({ success: false, error: 'FORBIDDEN' });
  });

  it('refuse si verifyUserRole est faux (compte SUPER ADMIN désactivé)', async () => {
    mockGetSecureCurrentUser.mockReturnValue({ id_user: USER_SA_INACTIF, role: 'SUPER ADMIN', site_id: null, centre_id: null });
    expect(await handler({})).toEqual({ success: false, error: 'FORBIDDEN' });
  });

  it('ignore tout paramètre du renderer et laisse passer SUPER ADMIN actif (hors ligne → OFFLINE structuré)', async () => {
    mockGetSecureCurrentUser.mockReturnValue({ id_user: USER_SA, role: 'SUPER ADMIN', site_id: null, centre_id: null });
    expect(await handler({}, { siteId: 1, forged: true })).toEqual({ success: false, error: 'OFFLINE' });
  });

  it('succès (SUPER ADMIN actif, réseau ONLINE) : rows, counts, latestVersion et currentVersion', async () => {
    const { networkMonitor } = await import('../src/main/sync/network-monitor');
    const stateSpy = vi.spyOn(networkMonitor, 'getState').mockReturnValue('ONLINE');
    try {
      mockGetSecureCurrentUser.mockReturnValue({ id_user: USER_SA, role: 'SUPER ADMIN', site_id: null, centre_id: null });
      const res = await handler({});
      expect(res.success).toBe(true);
      expect(res.counts).toEqual({ nb_total: 4, nb_preuve: 1, nb_ignorees: 1, nb_listables: 2 });
      expect(res.latestVersion).toBe('2.28.0');
      expect(res.currentVersion).toBe('2.27.0');
      expect(res.truncated).toBe(false);
      expect(res.rows).toHaveLength(1);
      // site_sync_id 'site-sync-980' traduit en nom via t_sites (ligne de test insérée plus haut).
      expect(res.rows[0]).toMatchObject({ poste_ref: 'abcdef12', app_version: '2.27.0', site_nom: 'SITE_VERSIONS_TEST', last_user_login: null, nb_reports: 3 });
    } finally {
      stateSpy.mockRestore();
    }
  });
});
