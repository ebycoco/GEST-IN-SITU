import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';

/**
 * LOT L2 — battement de présence immédiat au retour ONLINE (src/main/auth/session-heartbeat.ts)
 * + point de déconnexion forcée. Tout est mocké (electron, DB, presence.service, network-monitor) :
 * aucun module natif, aucun réseau, aucune base.
 */

const mocks = vi.hoisted(() => ({
  heartbeatPresence: vi.fn(),
  recordPresenceLogout: vi.fn(),
}));

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] } }));
vi.mock('../src/main/database/connection', () => ({ getDatabase: () => null }));
vi.mock('../src/main/database/queries/users.queries', () => ({ resolveGrantedRoles: () => [] }));
vi.mock('../src/main/sync/supabase-client', () => ({ getSupabaseClient: () => null }));
vi.mock('../src/main/sync/presence.service', () => ({
  heartbeatPresence: mocks.heartbeatPresence,
  recordPresenceLogout: mocks.recordPresenceLogout,
}));
vi.mock('../src/main/sync/network-monitor', async () => {
  const { EventEmitter: EE } = await import('events');
  return { networkMonitor: new EE() };
});

import { networkMonitor } from '../src/main/sync/network-monitor';
import { startSessionHeartbeat, stopSessionHeartbeat } from '../src/main/auth/session-heartbeat';

const emitter = networkMonitor as unknown as EventEmitter;
const USER = { login: 'agent1', role: 'OPERATEUR_SAISIE', site_id: 1, centre_id: 2, id_user: 5, sync_id: 'sync-1' };

describe('session-heartbeat : écouteur réseau de présence', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    mocks.heartbeatPresence.mockClear();
    await stopSessionHeartbeat();
  });
  afterEach(async () => {
    await stopSessionHeartbeat();
    vi.useRealTimers();
  });

  it('(d) retire l\'écouteur à stopSessionHeartbeat et ne l\'empile pas après plusieurs start/stop', async () => {
    expect(emitter.listenerCount('change')).toBe(0);
    for (let i = 0; i < 3; i++) {
      startSessionHeartbeat({ ...USER }, `tok-${i}`);
      expect(emitter.listenerCount('change')).toBe(1);
    }
    // start sans stop explicite entre deux sessions : toujours un seul écouteur
    startSessionHeartbeat({ ...USER }, 'tok-x');
    expect(emitter.listenerCount('change')).toBe(1);
    await stopSessionHeartbeat();
    expect(emitter.listenerCount('change')).toBe(0);
  });

  it('(d) battement immédiat au passage OFFLINE -> ONLINE avec les bons champs', () => {
    startSessionHeartbeat({ ...USER }, 'tok');
    emitter.emit('change', { oldState: 'OFFLINE', newState: 'ONLINE' });
    expect(mocks.heartbeatPresence).toHaveBeenCalledTimes(1);
    expect(mocks.heartbeatPresence).toHaveBeenCalledWith({
      sync_id: 'sync-1', login: 'agent1', site_id: 1, centre_id: 2, role: 'OPERATEUR_SAISIE',
    });
  });

  it('(d) pas de battement pour les autres transitions (ONLINE->OFFLINE, ONLINE->ONLINE)', () => {
    startSessionHeartbeat({ ...USER }, 'tok');
    emitter.emit('change', { oldState: 'ONLINE', newState: 'OFFLINE' });
    emitter.emit('change', { oldState: 'ONLINE', newState: 'ONLINE' });
    expect(mocks.heartbeatPresence).not.toHaveBeenCalled();
  });

  it('(d) throttle de 30 s respecté', () => {
    startSessionHeartbeat({ ...USER }, 'tok');
    emitter.emit('change', { oldState: 'OFFLINE', newState: 'ONLINE' });
    vi.advanceTimersByTime(10_000);
    emitter.emit('change', { oldState: 'OFFLINE', newState: 'ONLINE' });
    expect(mocks.heartbeatPresence).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(21_000);
    emitter.emit('change', { oldState: 'OFFLINE', newState: 'ONLINE' });
    expect(mocks.heartbeatPresence).toHaveBeenCalledTimes(2);
  });

  it('(d) aucun battement si la session n\'a pas de sync_id', () => {
    const { sync_id: _omit, id_user: _omit2, ...noSync } = USER;
    startSessionHeartbeat({ ...noSync }, 'tok');
    emitter.emit('change', { oldState: 'OFFLINE', newState: 'ONLINE' });
    expect(mocks.heartbeatPresence).not.toHaveBeenCalled();
  });

  it('(d) aucun battement après stopSessionHeartbeat', async () => {
    startSessionHeartbeat({ ...USER }, 'tok');
    await stopSessionHeartbeat();
    emitter.emit('change', { oldState: 'OFFLINE', newState: 'ONLINE' });
    expect(mocks.heartbeatPresence).not.toHaveBeenCalled();
  });
});
