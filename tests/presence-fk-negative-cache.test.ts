import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * P1 « cache négatif FK 23503 » — identifyViolatedFkColumn() et comportement de _upsertPresence
 * (via heartbeatPresence / recordPresenceLogin). Tout est mocké : aucun appel réseau réel.
 */

const state = vi.hoisted(() => ({
  network: 'ONLINE' as string,
  client: null as any,
  upsert: null as any,
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

import {
  identifyViolatedFkColumn,
  heartbeatPresence,
  recordPresenceLogin,
} from '../src/main/sync/presence.service';

const MSG = (col: string) =>
  `insert or update on table "t_user_presence" violates foreign key constraint "t_user_presence_${col}_fkey"`;

describe('identifyViolatedFkColumn', () => {
  it('lit le nom de contrainte dans message (3 cas réels PostgREST)', () => {
    expect(identifyViolatedFkColumn({ message: MSG('user_sync_id'), details: 'Key is not present in table "t_users".' })).toBe('user_sync_id');
    expect(identifyViolatedFkColumn({ message: MSG('site_id'), details: 'Key is not present in table "t_sites".' })).toBe('site_id');
    expect(identifyViolatedFkColumn({ message: MSG('centre_id'), details: 'Key is not present in table "t_centres".' })).toBe('centre_id');
  });

  it('ancien format Key (col)=(val) dans details (rétro-compatibilité)', () => {
    expect(identifyViolatedFkColumn({ message: 'FK violée', details: 'Key (site_id)=(9) is not present in table "t_sites".' })).toBe('site_id');
  });

  it('repli sur la table citée dans details', () => {
    expect(identifyViolatedFkColumn({ message: 'x', details: 'Key is not present in table "t_users".' })).toBe('user_sync_id');
    expect(identifyViolatedFkColumn({ message: 'x', details: 'Key is not present in table "t_sites".' })).toBe('site_id');
    expect(identifyViolatedFkColumn({ message: 'x', details: 'Key is not present in table "t_centres".' })).toBe('centre_id');
  });

  it('retourne null pour entrées inconnues / vides / null', () => {
    expect(identifyViolatedFkColumn({ message: 'boom', details: 'rien' })).toBeNull();
    expect(identifyViolatedFkColumn({ message: 'Key (autre)=(1)', details: null })).toBeNull();
    expect(identifyViolatedFkColumn({})).toBeNull();
    expect(identifyViolatedFkColumn(null)).toBeNull();
    expect(identifyViolatedFkColumn(undefined)).toBeNull();
  });
});

/** Laisse s'exécuter le setImmediate des wrappers publics puis l'await de l'upsert. */
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise<void>((r) => setImmediate(r));
}

let uid = 0;
function makeUser() {
  uid += 1;
  return { sync_id: `fk-user-${uid}`, login: `l${uid}`, site_id: 7, centre_id: 3, role: 'OPERATEUR_VERIFICATION' };
}

describe('_upsertPresence : erreurs 23503', () => {
  beforeEach(() => {
    state.network = 'ONLINE';
    state.upsert = vi.fn();
    state.client = { from: () => ({ upsert: state.upsert }) };
  });

  async function twoTicks(user: ReturnType<typeof makeUser>) {
    heartbeatPresence(user);
    await flush();
    heartbeatPresence(user);
    await flush();
  }

  it('(a) FK user_sync_id : pas de cache, le tick suivant réessaie', async () => {
    state.upsert.mockResolvedValue({ error: { code: '23503', message: MSG('user_sync_id'), details: 'Key is not present in table "t_users".' } });
    await twoTicks(makeUser());
    expect(state.upsert).toHaveBeenCalledTimes(2);
  });

  it('(b) FK site_id : cache, le tick suivant ne rappelle pas', async () => {
    state.upsert.mockResolvedValue({ error: { code: '23503', message: MSG('site_id'), details: 'Key is not present in table "t_sites".' } });
    await twoTicks(makeUser());
    expect(state.upsert).toHaveBeenCalledTimes(1);
  });

  it('(c) FK centre_id : pas de cache', async () => {
    state.upsert.mockResolvedValue({ error: { code: '23503', message: MSG('centre_id'), details: 'Key is not present in table "t_centres".' } });
    await twoTicks(makeUser());
    expect(state.upsert).toHaveBeenCalledTimes(2);
  });

  it('(d) 23503 non identifiable : pas de cache', async () => {
    state.upsert.mockResolvedValue({ error: { code: '23503', message: 'violation', details: 'format imprévu' } });
    await twoTicks(makeUser());
    expect(state.upsert).toHaveBeenCalledTimes(2);
  });

  it('(e) autre erreur : comportement inchangé (pas de cache, pas de throw)', async () => {
    state.upsert.mockResolvedValue({ error: { code: '42501', message: 'rls', details: null } });
    const user = makeUser();
    recordPresenceLogin(user);
    await flush();
    heartbeatPresence(user);
    await flush();
    expect(state.upsert).toHaveBeenCalledTimes(2);
  });

  it('succès : payload inchangé (upsert onConflict user_sync_id)', async () => {
    state.upsert.mockResolvedValue({ error: null });
    heartbeatPresence(makeUser());
    await flush();
    expect(state.upsert).toHaveBeenCalledTimes(1);
    expect(state.upsert.mock.calls[0][1]).toEqual({ onConflict: 'user_sync_id' });
  });
});
