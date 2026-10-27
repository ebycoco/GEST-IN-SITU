import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Audit 2026-10-26, chantier C point 3 (cause A) — sans « Récupération automatique », aucun
 * site n'est actif dans le SyncEngine (activeSiteId null) et le cycle périodique
 * executeSyncCycle() sortait AVANT de traiter la file t_outbox : les écritures locales
 * (t_logs, t_users, t_cartes...) n'étaient jamais envoyées par le cycle automatique.
 *
 * Attendu : l'outbox (indépendante du site) est traitée avant la garde « aucun site actif » ;
 * runUpstream (qui dépend du site) reste derrière la garde. Aucun double traitement.
 *
 * Tout est simulé (outbox, réseau, upstream, base) : aucun appel réseau, aucune base réelle.
 */

const mocks = vi.hoisted(() => ({
  processOutboxPending: vi.fn(async (_periodic?: boolean, _force?: boolean) => ({ processed: 0, errors: 0 })),
  getOutboxPendingCount: vi.fn(() => 0),
  getOutboxActionableCount: vi.fn(() => 0),
  runUpstream: vi.fn(async () => 0),
  runDownstream: vi.fn(async () => 0)
}));

vi.mock('electron', () => ({
  app: { getPath: () => 'C:\\tmp-cycle-outbox-test', isPackaged: false },
  net: { online: true, request: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] }
}));

vi.mock('../src/main/sync/network-monitor', () => ({
  networkMonitor: { getState: () => 'ONLINE', on: vi.fn(), start: vi.fn(), stop: vi.fn(), resetAndRetry: vi.fn() }
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
  runDownstream: mocks.runDownstream, syncUsersFromCloud: vi.fn(), runSyncInitiale: vi.fn(),
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

describe('cycle périodique — outbox traitée même sans site actif (audit 2026-10-26 C3)', () => {
  let engine: any;

  beforeEach(async () => {
    vi.clearAllMocks();
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

  it('(d1) sans site actif + entrées PENDING : outbox traitée (cycle périodique), runUpstream/downstream NON lancés', async () => {
    mocks.getOutboxPendingCount.mockReturnValue(3);
    await engine.executeSyncCycle();
    expect(mocks.processOutboxPending).toHaveBeenCalledTimes(1);
    // fromPeriodicCycle = true (promotion ERROR->PENDING après backoff), forceCards NON passé :
    // les cartes restent soumises au réglage « Envoi Automatique ».
    expect(mocks.processOutboxPending).toHaveBeenCalledWith(true);
    expect(mocks.runUpstream).not.toHaveBeenCalled();
    expect(mocks.runDownstream).not.toHaveBeenCalled();
    expect(engine.isSyncing).toBe(false);
  });

  it('(d2) sans site actif et file vide : rien n\'est traité (comportement inchangé)', async () => {
    await engine.executeSyncCycle();
    expect(mocks.processOutboxPending).not.toHaveBeenCalled();
    expect(mocks.runUpstream).not.toHaveBeenCalled();
  });

  it('(d3) avec site actif : outbox traitée UNE fois puis runUpstream', async () => {
    engine.activeSiteId = 7;
    mocks.getOutboxPendingCount.mockReturnValue(2);
    await engine.executeSyncCycle();
    expect(mocks.processOutboxPending).toHaveBeenCalledTimes(1);
    expect(mocks.processOutboxPending).toHaveBeenCalledWith(true);
    expect(mocks.runUpstream).toHaveBeenCalledTimes(1);
    expect(mocks.processOutboxPending.mock.invocationCallOrder[0]).toBeLessThan(mocks.runUpstream.mock.invocationCallOrder[0]);
  });

  it('(d4) erreur outbox sans site actif : non bloquante, verrou isSyncing libéré', async () => {
    mocks.getOutboxPendingCount.mockReturnValue(1);
    mocks.processOutboxPending.mockRejectedValue(new Error('réseau'));
    await expect(engine.executeSyncCycle()).resolves.toBeUndefined();
    expect(engine.isSyncing).toBe(false);
    expect(mocks.runUpstream).not.toHaveBeenCalled();
  });

  it('(d5) forceSync sans site actif : la file n\'est traitée qu\'UNE fois (pas de double passage)', async () => {
    mocks.getOutboxPendingCount.mockReturnValue(2);
    const res = await engine.forceSync();
    expect(mocks.processOutboxPending).toHaveBeenCalledTimes(1);
    expect(res.success).toBe(true);
  });
});
