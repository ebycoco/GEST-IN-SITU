import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Audit 2026-10-26 (point 6) — forceSync() répondait « Synchronisation terminée avec succès. »
 * même quand executeSyncCycle() sortait sans rien traiter (aucun site actif) alors que des
 * entrées t_outbox restaient à envoyer. Correctif confiné à forceSync() :
 *  (i) sans site actif, la file t_outbox est quand même traitée (processOutboxPending(true)) ;
 *  (ii) s'il reste des entrées actionnables après coup -> success:false + message clair.
 *
 * Tout est simulé (outbox, réseau, upstream, base) : aucun appel réseau, aucune base réelle.
 */

const mocks = vi.hoisted(() => ({
  netState: 'ONLINE' as string,
  processOutboxPending: vi.fn(async (_force?: boolean) => ({ processed: 0, errors: 0 })),
  getOutboxPendingCount: vi.fn(() => 0),
  getOutboxActionableCount: vi.fn(() => 0),
  runUpstream: vi.fn(async () => 0)
}));

vi.mock('electron', () => ({
  app: { getPath: () => 'C:\\tmp-forcesync-test', isPackaged: false },
  net: { online: true, request: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] }
}));

vi.mock('../src/main/sync/network-monitor', () => ({
  networkMonitor: {
    getState: () => mocks.netState,
    on: vi.fn(), start: vi.fn(), stop: vi.fn(), resetAndRetry: vi.fn()
  }
}));

vi.mock('../src/main/sync/outbox.service', () => ({
  processOutboxPending: mocks.processOutboxPending,
  getOutboxPendingCount: mocks.getOutboxPendingCount,
  getOutboxActionableCount: mocks.getOutboxActionableCount,
  setCardsAutoUpstreamEnabled: vi.fn()
}));

vi.mock('../src/main/sync/upstream', () => ({ runUpstream: mocks.runUpstream }));
vi.mock('../src/main/sync/cards-reconcile', () => ({ reconcileMissingCards: vi.fn() }));
vi.mock('../src/main/sync/downstream', () => ({
  runDownstream: vi.fn(), syncUsersFromCloud: vi.fn(), runSyncInitiale: vi.fn(),
  runLogsDownstream: vi.fn(), syncCurrentUserActiveStatus: vi.fn(), getPendingCardsCount: vi.fn(() => 0)
}));
vi.mock('../src/main/sync/presence.service', () => ({ recordPresenceLogout: vi.fn() }));
vi.mock('../src/main/database/queries/maintenance.queries', () => ({ purgeEmptyRows: vi.fn() }));
vi.mock('../src/main/auth/session-heartbeat', () => ({
  refreshSecureCurrentUser: vi.fn(), getCurrentGrantedRoles: vi.fn(() => []),
  resolveCurrentSessionLogin: vi.fn(), stopSessionHeartbeat: vi.fn(), getSecureCurrentUser: vi.fn(() => null)
}));
vi.mock('../src/main/database/connection', () => ({
  // Base minimale : executeSyncCycle ne lit que le nombre d'utilisateurs (non vide -> pas de bootstrap).
  getDatabase: () => ({ prepare: () => ({ get: () => ({ count: 1 }) }) })
}));

describe('forceSync() — outbox sans site actif et message fidèle', () => {
  let engine: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.netState = 'ONLINE';
    mocks.processOutboxPending.mockResolvedValue({ processed: 0, errors: 0 });
    mocks.getOutboxPendingCount.mockReturnValue(0);
    mocks.getOutboxActionableCount.mockReturnValue(0);
    const mod = await import('../src/main/sync/sync-engine');
    engine = mod.syncEngine;
    engine.activeSiteId = null;
    engine.isSyncing = false;
    engine.isDownstreamRunning = false;
    engine.isBulkUploading = false;
    engine.startAutoDownstreamTimer = vi.fn();
  });

  it('(a) sans site actif + entrées PENDING : la file est traitée', async () => {
    mocks.getOutboxPendingCount.mockReturnValue(2);
    mocks.processOutboxPending.mockImplementation(async () => {
      mocks.getOutboxActionableCount.mockReturnValue(0); // tout part
      return { processed: 2, errors: 0 };
    });
    const res = await engine.forceSync();
    expect(mocks.processOutboxPending).toHaveBeenCalledWith(true);
    expect(res).toEqual({ success: true, message: 'Synchronisation terminée avec succès.' });
  });

  it('(b) il reste des entrées après traitement : success:false + message partiel', async () => {
    mocks.getOutboxPendingCount.mockReturnValue(3);
    mocks.getOutboxActionableCount.mockReturnValue(3);
    mocks.processOutboxPending.mockResolvedValue({ processed: 0, errors: 3 });
    const res = await engine.forceSync();
    expect(mocks.processOutboxPending).toHaveBeenCalledWith(true);
    expect(res.success).toBe(false);
    expect(res.message).toBe("Synchronisation partielle : 3 élément(s) restent en attente d'envoi.");
  });

  it('(c) rien en attente : success:true', async () => {
    const res = await engine.forceSync();
    expect(res).toEqual({ success: true, message: 'Synchronisation terminée avec succès.' });
  });

  it('(d) erreur de processOutboxPending sans site actif : non bloquante, résultat honnête', async () => {
    mocks.getOutboxActionableCount.mockReturnValue(1);
    mocks.processOutboxPending.mockRejectedValue(new Error('réseau'));
    const res = await engine.forceSync();
    expect(res.success).toBe(false);
    expect(res.message).toContain('Synchronisation partielle : 1 élément(s)');
  });

  it("(e) avec site actif : processOutboxPending n'est PAS appelé en plus par forceSync (le cycle s'en charge)", async () => {
    engine.activeSiteId = 7;
    mocks.getOutboxPendingCount.mockReturnValue(0);
    const res = await engine.forceSync();
    expect(mocks.processOutboxPending).not.toHaveBeenCalled();
    expect(res.success).toBe(true);
  });
});
