import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Test ciblé — Correctif P1 (plan d'impact validé) : fenêtre de course entre les
 * suppressions de hiérarchie (site/centre) et le traitement de l'Outbox.
 *
 * `processOutboxPending()` (src/main/sync/outbox.service.ts) lit une entrée t_outbox
 * PENDING puis attend un appel réseau Supabase (`await ... upsert(...)`) avant de
 * changer son statut. Si `hierarchy:deleteSite` (src/main/ipc/handlers.ts) déclenche
 * `queries.deleteSite()` pendant cette fenêtre, `cancelPendingInsert()` (qui ne teste
 * que le statut SQLite PENDING) supprime la ligne outbox en pensant l'entité jamais
 * synchronisée — alors que l'upsert réseau en vol peut réussir juste après, créant une
 * ligne fantôme orpheline côté Supabase.
 *
 * Correctif : le handler IPC `hierarchy:deleteSite` doit désormais attendre (poll borné
 * sur `isOutboxProcessing()`, src/main/sync/outbox.service.ts) qu'aucun cycle
 * `processOutboxPending()` ne soit en vol avant d'appeler `queries.deleteSite()`.
 *
 * Ce test exerce le VRAI handler enregistré par `registerIpcHandlers` (pas une
 * réimplémentation), avec `isOutboxProcessing()` mocké pour simuler un cycle outbox en
 * cours (retourne `true` pour les 2 premiers appels), et vérifie directement, à
 * l'intérieur même du mock, que le site n'est PAS ENCORE supprimé de la base tant que
 * `isOutboxProcessing()` répond `true` — preuve directe que l'appel destructeur est bien
 * séquencé APRÈS la fin du traitement outbox, et non avant.
 */

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gest-in-situ-test-race-'));

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

// Mock ciblé : seule `isOutboxProcessing` est remplacée par un espion contrôlable
// depuis le test ; toutes les autres exports du module (enqueueOutbox,
// cancelPendingInsert, scheduleOutboxProcessing, processOutboxPending, ...) restent
// les VRAIES implémentations, utilisées telles quelles par hierarchy.queries.ts.
vi.mock('../src/main/sync/outbox.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/main/sync/outbox.service')>();
  return {
    ...actual,
    isOutboxProcessing: vi.fn(() => false)
  };
});

// Mock ciblé : la session sécurisée renvoie un SUPER ADMIN fixe (bypass FAILSAFE_ROOT_ID
// dans verifyUserRole côté handlers.ts, sans toucher à la vraie table t_users), pour ne
// tester que la mécanique d'attente outbox — pas la logique RBAC déjà couverte ailleurs.
vi.mock('../src/main/auth/session-heartbeat', () => ({
  startSessionHeartbeat: vi.fn(),
  stopSessionHeartbeat: vi.fn(),
  getCurrentUserLogin: vi.fn(() => 'super.admin'),
  getSecureCurrentUser: vi.fn(() => ({ id_user: 999999, role: 'SUPER ADMIN', site_id: null, centre_id: null })),
  setActiveRole: vi.fn(),
  getCurrentGrantedRoles: vi.fn(() => ['SUPER ADMIN']),
  refreshSecureCurrentUser: vi.fn()
}));

describe('hierarchy:deleteSite — attend la fin de l\'outbox en vol avant suppression (correctif P1)', () => {
  let connection: typeof import('../src/main/database/connection');
  let handlersModule: typeof import('../src/main/ipc/handlers');
  let outboxService: typeof import('../src/main/sync/outbox.service');
  let db: import('better-sqlite3').Database;

  const SITE_ID = 901;
  const SITE_SYNC_ID = 'site-sync-901-race';

  beforeAll(async () => {
    connection = await import('../src/main/database/connection');
    handlersModule = await import('../src/main/ipc/handlers');
    outboxService = await import('../src/main/sync/outbox.service');

    db = await connection.initDatabase();

    db.prepare(`INSERT INTO t_sites (id, nom, code, is_active, sync_id) VALUES (?, 'SITE_RACE_TEST', 'SITE_RACE_TEST', 1, ?)`)
      .run(SITE_ID, SITE_SYNC_ID);
  });

  afterAll(() => {
    connection.closeDatabase();
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    vi.mocked(outboxService.isOutboxProcessing).mockReset();
  });

  it('n\'appelle queries.deleteSite() qu\'après que isOutboxProcessing() soit redevenu false', async () => {
    // Capture du handler réellement enregistré par registerIpcHandlers pour le canal
    // 'hierarchy:deleteSite' (véritable code de production, pas une réimplémentation).
    const { ipcMain } = await import('electron');
    handlersModule.registerIpcHandlers({ webContents: { send: vi.fn() } } as any);

    const registeredCalls = vi.mocked(ipcMain.handle).mock.calls;
    const deleteSiteCall = registeredCalls.find(([channel]) => channel === 'hierarchy:deleteSite');
    expect(deleteSiteCall).toBeDefined();
    const deleteSiteHandler = deleteSiteCall![1] as (event: any, id: number) => Promise<any>;

    let callCount = 0;
    const TRUE_CALLS = 2; // simule un cycle processOutboxPending() en vol pour 2 vérifications

    vi.mocked(outboxService.isOutboxProcessing).mockImplementation(() => {
      callCount++;
      if (callCount <= TRUE_CALLS) {
        // ── Preuve directe de la correction du P1 ────────────────────────────
        // Tant que l'outbox est réputé "en cours", le site NE DOIT PAS ENCORE
        // avoir été supprimé — si le correctif régressait (appel direct à
        // queries.deleteSite() avant le poll), cette assertion échouerait dès
        // le 1er appel du mock.
        const row = db.prepare('SELECT COUNT(*) as c FROM t_sites WHERE id = ?').get(SITE_ID) as { c: number };
        expect(row.c).toBe(1);
        return true;
      }
      return false;
    });

    const startedAt = Date.now();
    await deleteSiteHandler({} as any, SITE_ID);
    const elapsedMs = Date.now() - startedAt;

    // Le poll doit avoir itéré au moins TRUE_CALLS+1 fois (les TRUE_CALLS retournant
    // true, puis au moins un appel retournant false pour sortir de la boucle).
    expect(callCount).toBeGreaterThanOrEqual(TRUE_CALLS + 1);

    // Le délai de retry (OUTBOX_DELETE_LOCK_RETRY_DELAY_MS = 500ms, cf. handlers.ts)
    // doit avoir été réellement observé au moins TRUE_CALLS fois — preuve que le
    // handler a réellement ATTENDU (pas juste vérifié une fois puis continué).
    expect(elapsedMs).toBeGreaterThanOrEqual(TRUE_CALLS * 500 - 100);

    // Suppression effective, une fois l'attente terminée.
    const finalRow = db.prepare('SELECT COUNT(*) as c FROM t_sites WHERE id = ?').get(SITE_ID) as { c: number };
    expect(finalRow.c).toBe(0);
  }, 20000);
});
