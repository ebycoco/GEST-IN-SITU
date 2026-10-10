import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * LOT L2 — recordPresenceLogoutAndWait() (src/main/sync/presence.service.ts).
 * Tout est mocké (supabase-client, network-monitor, electron-log) : aucun appel réseau réel.
 */

const state = vi.hoisted(() => ({
  network: 'ONLINE' as string,
  client: null as any,
}));

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../src/main/sync/network-monitor', () => ({
  networkMonitor: { getState: () => state.network },
}));
vi.mock('../src/main/sync/supabase-client', () => ({
  getSupabaseClient: () => state.client,
}));

import { recordPresenceLogoutAndWait } from '../src/main/sync/presence.service';

/** Construit un faux client dont la chaîne update().eq().abortSignal() est pilotable. */
function makeClient(resolver: (signal: AbortSignal) => Promise<{ error: any }>) {
  const calls = { from: vi.fn(), update: vi.fn(), eq: vi.fn(), abortSignal: vi.fn() };
  const client = {
    from: (t: string) => {
      calls.from(t);
      return {
        update: (p: any) => {
          calls.update(p);
          return {
            eq: (c: string, v: string) => {
              calls.eq(c, v);
              return {
                abortSignal: (s: AbortSignal) => {
                  calls.abortSignal(s);
                  return resolver(s);
                },
              };
            },
          };
        },
      };
    },
  };
  return { client, calls };
}

describe('recordPresenceLogoutAndWait', () => {
  beforeEach(() => {
    state.network = 'ONLINE';
    state.client = null;
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('(a) retourne sans attendre si le réseau n\'est pas ONLINE', async () => {
    const { client, calls } = makeClient(() => new Promise(() => {}));
    state.client = client;
    state.network = 'OFFLINE';
    await recordPresenceLogoutAndWait('u1');
    expect(calls.from).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('(a) retourne sans attendre si sync_id vide', async () => {
    const { client, calls } = makeClient(() => new Promise(() => {}));
    state.client = client;
    await recordPresenceLogoutAndWait('');
    expect(calls.from).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('(a) retourne sans attendre si le client Supabase est absent', async () => {
    state.client = null;
    await recordPresenceLogoutAndWait('u1');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('écrit last_logout_at (UPDATE sur t_user_presence) et nettoie son timer quand Supabase répond', async () => {
    const { client, calls } = makeClient(async () => ({ error: null }));
    state.client = client;
    await recordPresenceLogoutAndWait('u1');
    expect(calls.from).toHaveBeenCalledWith('t_user_presence');
    expect(calls.update.mock.calls[0][0]).toHaveProperty('last_logout_at');
    expect(calls.eq).toHaveBeenCalledWith('user_sync_id', 'u1');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('(b) rend la main après ~timeout si l\'UPDATE ne répond jamais, sans exception, sans timer résiduel', async () => {
    let capturedSignal: AbortSignal | undefined;
    const { client } = makeClient((s) => {
      capturedSignal = s;
      return new Promise(() => {});
    });
    state.client = client;

    let done = false;
    const p = recordPresenceLogoutAndWait('u1', 1500).then(() => { done = true; });

    await vi.advanceTimersByTimeAsync(1499);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    await p;
    expect(done).toBe(true);
    expect(capturedSignal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('(c) ne propage pas une erreur renvoyée par Supabase', async () => {
    const { client } = makeClient(async () => ({ error: { message: 'boom' } }));
    state.client = client;
    await expect(recordPresenceLogoutAndWait('u1')).resolves.toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('(c) ne propage pas une exception levée par le client', async () => {
    const { client } = makeClient(async () => { throw new Error('network down'); });
    state.client = client;
    await expect(recordPresenceLogoutAndWait('u1')).resolves.toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });
});
