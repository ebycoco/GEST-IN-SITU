import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Test ciblé — Correctif RBAC serveur de `sync:startBulk` (src/main/ipc/handlers.ts).
 *
 * Constat (audit de pré-release) : le handler ne comportait AUCUNE vérification de rôle
 * (seul `getSecureCurrentUser()` était appelé, après les verrous). N'importe quel appelant
 * IPC pouvait donc lancer un transfert de masse vers Supabase pour un site.
 *
 * Correctif : `verifyUserRole(secureUser.id_user, [...])` — même modèle que les autres
 * handlers du fichier — exécuté AVANT toute acquisition de verrou (beginBulkUpload), pour
 * qu'un refus ne laisse aucun état de synchro à nettoyer.
 *
 * Liste autorisée = rôles RÉELLEMENT câblés côté renderer sur un bouton d'envoi
 * (useForceSyncActions.handleStartBulkUpload / VerificationSearchPage / AdminCentreLayout) :
 *   SUPER ADMIN, ADMINISTRATEUR_SITE (dashboard/SiteAdminView), ADMIN_CENTRE (AdminCentreLayout,
 *   /admin-centre/recherche), OPERATEUR_VERIFICATION, OPERATEUR_SAISIE, OPERATEUR_INVENTAIRE,
 *   OPERATEUR_LOGISTIQUE (InventaireLayout), OPERATEUR_APUREMENT, OPERATEUR_QUALITE.
 *
 * Ce test exerce le VRAI handler enregistré par `registerIpcHandlers`. `verifyUserRole()`
 * lit réellement `t_users` / `t_user_roles` : les comptes de test sont de vraies lignes.
 * `runBulkUpload` et `runStatsWorker` sont mockés pour vérifier si la synchro de masse est
 * lancée, sans Supabase ni Worker thread. `networkMonitor` est neutralisé (hors ligne simulé)
 * pour que le vidage forcé de t_outbox ne touche jamais le réseau.
 */

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gest-in-situ-test-startbulk-rbac-'));

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
    online: false,
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

const mockRunBulkUpload = vi.fn(async () => ({ success: true, uploadedCount: 0, message: 'Transfert simulé' }));
vi.mock('../src/main/sync/bulk-uploader', () => ({
  runBulkUpload: (...args: any[]) => (mockRunBulkUpload as any)(...args),
  cancelBulkUpload: vi.fn()
}));

// Évite le Worker thread de comptage des anomalies (non pertinent pour le contrôle d'accès).
vi.mock('../src/main/database/queries/stats.queries', async (importOriginal) => {
  const original: any = await importOriginal();
  return {
    ...original,
    runStatsWorker: vi.fn(async () => ({ strictCount: 0, probableCount: 0, invalidCount: 0 }))
  };
});

describe('sync:startBulk — garde RBAC serveur (correctif audit pré-release)', () => {
  let connection: typeof import('../src/main/database/connection');
  let handlersModule: typeof import('../src/main/ipc/handlers');
  let syncEngineModule: typeof import('../src/main/sync/sync-engine');
  let networkMonitorModule: typeof import('../src/main/sync/network-monitor');
  let logModule: any;
  let db: import('better-sqlite3').Database;
  let startBulkHandler: (event: any, siteId: number, allowProbable?: boolean, allowInvalid?: boolean, allowMissing?: boolean, onlyModified?: boolean, currentUser?: any) => Promise<any>;

  const SITE_A = 970;
  const ALLOWED_ROLES = [
    'SUPER ADMIN',
    'ADMINISTRATEUR_SITE',
    'ADMIN_CENTRE',
    'OPERATEUR_VERIFICATION',
    'OPERATEUR_SAISIE',
    'OPERATEUR_INVENTAIRE',
    'OPERATEUR_LOGISTIQUE',
    'OPERATEUR_APUREMENT',
    'OPERATEUR_QUALITE'
  ];
  // Identifiants 9700+ : réservés à ce fichier de test.
  const ID_ROLE_BASE = 9700;
  const ID_INACTIVE = 9720;
  const ID_GHOST = 9799; // identifiant absent de t_users (session fantôme)

  const sessionFor = (id: number, role: string) => ({
    id_user: id,
    login: `startbulk.user.${id}`,
    role,
    site_id: SITE_A,
    centre_id: null
  });

  beforeAll(async () => {
    connection = await import('../src/main/database/connection');
    handlersModule = await import('../src/main/ipc/handlers');
    syncEngineModule = await import('../src/main/sync/sync-engine');
    networkMonitorModule = await import('../src/main/sync/network-monitor');
    logModule = (await import('electron-log')).default;

    db = await connection.initDatabase();

    db.prepare(`INSERT INTO t_sites (id, nom, code, is_active, sync_id) VALUES (?, 'SITE_A_STARTBULK_TEST', 'SITE_A_STARTBULK_TEST', 1, ?)`)
      .run(SITE_A, 'site-sync-970-startbulk');

    ALLOWED_ROLES.forEach((role, index) => {
      db.prepare(`
        INSERT INTO t_users (id_user, login, password_hash, role, nom_user, statut_actif, site_id, centre_id)
        VALUES (?, ?, 'x', ?, 'Test', 1, ?, NULL)
      `).run(ID_ROLE_BASE + index, `startbulk.user.${ID_ROLE_BASE + index}`, role, SITE_A);
    });

    db.prepare(`
      INSERT INTO t_users (id_user, login, password_hash, role, nom_user, statut_actif, site_id, centre_id)
      VALUES (?, ?, 'x', 'ADMIN_CENTRE', 'Test', 0, ?, NULL)
    `).run(ID_INACTIVE, `startbulk.user.${ID_INACTIVE}`, SITE_A);

    const { ipcMain } = await import('electron');
    handlersModule.registerIpcHandlers({ webContents: { send: vi.fn() }, isDestroyed: () => false } as any);
    const registeredCalls = vi.mocked(ipcMain.handle).mock.calls;
    const call = registeredCalls.find(([channel]) => channel === 'sync:startBulk');
    expect(call).toBeDefined();
    startBulkHandler = call![1] as typeof startBulkHandler;
  });

  beforeEach(() => {
    mockRunBulkUpload.mockClear();
    mockGetSecureCurrentUser.mockReset();
    // Hors ligne simulé : processOutboxPending refuse tout appel Supabase, aucune requête réseau.
    vi.spyOn(networkMonitorModule.networkMonitor, 'getState').mockReturnValue('OFFLINE');
    vi.spyOn(networkMonitorModule.networkMonitor, 'forcePing').mockResolvedValue(undefined as any);
  });

  afterAll(() => {
    vi.restoreAllMocks();
    connection.closeDatabase();
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('(a) refuse une session absente (aucune synchro lancée)', async () => {
    mockGetSecureCurrentUser.mockReturnValue(null);
    const beginSpy = vi.spyOn(syncEngineModule.syncEngine, 'beginBulkUpload');

    const res = await startBulkHandler({} as any, SITE_A, false, false, false, false, undefined);

    expect(res.success).toBe(false);
    expect(mockRunBulkUpload).not.toHaveBeenCalled();
    expect(beginSpy).not.toHaveBeenCalled();
    beginSpy.mockRestore();
  });

  it('(b) refuse un compte inactif, même avec un rôle autorisé (aucune synchro lancée)', async () => {
    mockGetSecureCurrentUser.mockReturnValue(sessionFor(ID_INACTIVE, 'ADMIN_CENTRE'));
    const warnSpy = vi.spyOn(logModule, 'warn');

    const res = await startBulkHandler({} as any, SITE_A, false, false, false, false, undefined);

    expect(res.success).toBe(false);
    expect(res.message).toMatch(/Accès refusé/);
    expect(mockRunBulkUpload).not.toHaveBeenCalled();
    expect(warnSpy.mock.calls.some(args => String(args[0]).includes('[SECURITY]'))).toBe(true);
    warnSpy.mockRestore();
  });

  it('(c) refuse une session fantôme (identifiant absent de t_users)', async () => {
    mockGetSecureCurrentUser.mockReturnValue(sessionFor(ID_GHOST, 'OPERATEUR_VERIFICATION'));

    const res = await startBulkHandler({} as any, SITE_A, false, false, false, false, undefined);

    expect(res.success).toBe(false);
    expect(mockRunBulkUpload).not.toHaveBeenCalled();
  });

  it.each(ALLOWED_ROLES)('(d) accepte le rôle autorisé %s (synchro lancée)', async (role) => {
    const index = ALLOWED_ROLES.indexOf(role);
    const userId = ID_ROLE_BASE + index;
    mockGetSecureCurrentUser.mockReturnValue(sessionFor(userId, role));

    const res = await startBulkHandler({} as any, SITE_A, false, false, false, false, undefined);

    expect(mockRunBulkUpload).toHaveBeenCalledTimes(1);
    expect(res.success).toBe(true);
  });
});
