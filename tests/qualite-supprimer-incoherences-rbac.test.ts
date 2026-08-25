import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Test ciblé — Correctif P0 (audit RBAC #2) : le handler IPC
 * `qualite:supprimerIncoherences` (src/main/ipc/handlers.ts) n'effectuait auparavant
 * AUCUNE vérification de rôle ni de cantonnement site — le `site_id` provenait
 * intégralement du payload client, permettant à n'importe quel compte authentifié
 * (quel que soit son rôle) de faire supprimer/marquer `is_dirty = -1` toutes les
 * cartes `t_cartes` d'un site arbitraire, ou de vider `t_import_anomalies`.
 *
 * Correctif : ajout de `assertQualiteAccessOnSite(site_id)` (déjà utilisée par les
 * handlers voisins `import:getAnomalies`/`clearAnomalies`/etc.) en tout début du
 * handler, avant tout accès base.
 *
 * Ce test exerce le VRAI handler enregistré par `registerIpcHandlers` (pas une
 * réimplémentation), avec `getSecureCurrentUser()` mocké pour piloter l'identité
 * de session, mais `verifyUserRole()` (interne à handlers.ts, non mockable) lit
 * réellement `t_users` — les comptes de test sont donc de vraies lignes en base.
 */

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gest-in-situ-test-qualite-rbac-'));

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
// test, pour isoler la vérification RBAC de `assertQualiteAccessOnSite()` — la
// vérification de rôle elle-même (`verifyUserRole`, interne à handlers.ts) continue
// de lire la VRAIE table t_users, non mockée ici.
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

describe("qualite:supprimerIncoherences — cantonnement RBAC/site (correctif P0)", () => {
  let connection: typeof import('../src/main/database/connection');
  let handlersModule: typeof import('../src/main/ipc/handlers');
  let db: import('better-sqlite3').Database;
  let supprimerIncoherencesHandler: (event: any, payload: { type_incoherence: string; site_id: number }) => Promise<any>;

  const SITE_A = 920;
  const SITE_B = 921;
  const USER_UNAUTHORIZED = 9201; // OPERATEUR_VERIFICATION, site A — hors QUALITE_ROLES
  const USER_ADMIN_SITE_A = 9202; // ADMINISTRATEUR_SITE, site A — légitime sur A, pas sur B

  beforeAll(async () => {
    connection = await import('../src/main/database/connection');
    handlersModule = await import('../src/main/ipc/handlers');

    db = await connection.initDatabase();

    db.prepare(`INSERT INTO t_sites (id, nom, code, is_active, sync_id) VALUES (?, 'SITE_A_QUALITE_TEST', 'SITE_A_QUALITE_TEST', 1, ?)`)
      .run(SITE_A, 'site-sync-920-qualite');
    db.prepare(`INSERT INTO t_sites (id, nom, code, is_active, sync_id) VALUES (?, 'SITE_B_QUALITE_TEST', 'SITE_B_QUALITE_TEST', 1, ?)`)
      .run(SITE_B, 'site-sync-921-qualite');

    db.prepare(`
      INSERT INTO t_users (id_user, login, password_hash, role, nom_user, statut_actif, site_id)
      VALUES (?, 'operateur.verif.qualite.test', 'x', 'OPERATEUR_VERIFICATION', 'Test', 1, ?)
    `).run(USER_UNAUTHORIZED, SITE_A);

    db.prepare(`
      INSERT INTO t_users (id_user, login, password_hash, role, nom_user, statut_actif, site_id)
      VALUES (?, 'admin.site.qualite.test', 'x', 'ADMINISTRATEUR_SITE', 'Test', 1, ?)
    `).run(USER_ADMIN_SITE_A, SITE_A);

    // Capture du handler réellement enregistré par registerIpcHandlers pour le canal
    // 'qualite:supprimerIncoherences' (véritable code de production, pas une
    // réimplémentation).
    const { ipcMain } = await import('electron');
    handlersModule.registerIpcHandlers({ webContents: { send: vi.fn() } } as any);
    const registeredCalls = vi.mocked(ipcMain.handle).mock.calls;
    const call = registeredCalls.find(([channel]) => channel === 'qualite:supprimerIncoherences');
    expect(call).toBeDefined();
    supprimerIncoherencesHandler = call![1] as typeof supprimerIncoherencesHandler;
  });

  afterAll(() => {
    connection.closeDatabase();
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('(a) rejette un rôle hors QUALITE_ROLES (OPERATEUR_VERIFICATION) et ne supprime rien', async () => {
    mockGetSecureCurrentUser.mockReturnValue({ id_user: USER_UNAUTHORIZED, role: 'OPERATEUR_VERIFICATION', site_id: SITE_A, centre_id: null });

    const carte = db.prepare(`
      INSERT INTO t_cartes (site_id, noms, prenoms, num_secu, is_dirty, sync_id)
      VALUES (?, 'NOM_A', 'PRENOM_A', NULL, 0, NULL)
    `).run(SITE_A);
    const idCarte = carte.lastInsertRowid as number;

    await expect(
      supprimerIncoherencesHandler({} as any, { type_incoherence: 'SANS_SECU', site_id: SITE_A })
    ).rejects.toThrow('Accès refusé pour cette opération.');

    const row = db.prepare('SELECT is_dirty FROM t_cartes WHERE id_carte = ?').get(idCarte) as { is_dirty: number };
    expect(row.is_dirty).toBe(0); // toujours intacte, rien supprimé
  });

  it("(b) rejette un ADMINISTRATEUR_SITE appelant avec un site_id différent du sien", async () => {
    mockGetSecureCurrentUser.mockReturnValue({ id_user: USER_ADMIN_SITE_A, role: 'ADMINISTRATEUR_SITE', site_id: SITE_A, centre_id: null });

    const carte = db.prepare(`
      INSERT INTO t_cartes (site_id, noms, prenoms, num_secu, is_dirty, sync_id)
      VALUES (?, 'NOM_B', 'PRENOM_B', NULL, 0, NULL)
    `).run(SITE_B);
    const idCarte = carte.lastInsertRowid as number;

    await expect(
      supprimerIncoherencesHandler({} as any, { type_incoherence: 'SANS_SECU', site_id: SITE_B })
    ).rejects.toThrow("Accès refusé : ce site n'est pas le vôtre.");

    const row = db.prepare('SELECT is_dirty FROM t_cartes WHERE id_carte = ?').get(idCarte) as { is_dirty: number };
    expect(row.is_dirty).toBe(0); // toujours intacte, rien supprimé sur le site B
  });

  it('(c) un appel légitime (rôle autorisé, bon site) fonctionne toujours normalement', async () => {
    mockGetSecureCurrentUser.mockReturnValue({ id_user: USER_ADMIN_SITE_A, role: 'ADMINISTRATEUR_SITE', site_id: SITE_A, centre_id: null });

    const carte = db.prepare(`
      INSERT INTO t_cartes (site_id, noms, prenoms, num_secu, is_dirty, sync_id)
      VALUES (?, 'NOM_C', 'PRENOM_C', NULL, 0, NULL)
    `).run(SITE_A);
    const idCarte = carte.lastInsertRowid as number;

    const result = await supprimerIncoherencesHandler({} as any, { type_incoherence: 'SANS_SECU', site_id: SITE_A });

    expect(result.success).toBe(true);
    expect(result.deleted).toBeGreaterThanOrEqual(1);

    const row = db.prepare('SELECT is_dirty FROM t_cartes WHERE id_carte = ?').get(idCarte) as { is_dirty: number };
    expect(row.is_dirty).toBe(-1); // suppression logique effective (comportement inchangé)
  });
});
