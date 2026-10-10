import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Rejeu de last_login_at par les battements tant que le login n'est pas confirmé écrit
 * (presence.service.ts). Tout est mocké : aucun réseau. État module isolé via vi.resetModules.
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

type Svc = typeof import('../src/main/sync/presence.service');
let svc: Svc;

const FK_ERR = {
  error: {
    code: '23503',
    message: 'insert or update on table "t_user_presence" violates foreign key constraint "t_user_presence_user_sync_id_fkey"',
    details: 'Key is not present in table "t_users".',
  },
};
const OK = { error: null };

const T_LOGIN = '2026-10-10T08:00:00.000Z';
const T_BEAT1 = '2026-10-10T08:02:00.000Z';
const T_BEAT2 = '2026-10-10T08:04:00.000Z';

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise<void>((r) => setImmediate(r));
}

function mkUser(id: string) {
  return { sync_id: id, login: `l-${id}`, site_id: 7, centre_id: 3, role: 'OPERATEUR_VERIFICATION' };
}

/** Payload (1er argument) du n-ième appel upsert. */
const payloadOf = (n: number) => state.upsert.mock.calls[n][0] as Record<string, unknown>;

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(T_LOGIN));
  state.network = 'ONLINE';
  state.upsert = vi.fn();
  state.client = { from: () => ({ upsert: state.upsert }) };
  svc = await import('../src/main/sync/presence.service');
});

afterEach(() => {
  vi.useRealTimers();
});

describe('rejeu de last_login_at par les battements', () => {
  it('(a) login réussi puis battement : le battement n\'a pas last_login_at', async () => {
    state.upsert.mockResolvedValue(OK);
    const u = mkUser('a');
    svc.recordPresenceLogin(u);
    await flush();
    vi.setSystemTime(new Date(T_BEAT1));
    svc.heartbeatPresence(u);
    await flush();
    expect(state.upsert).toHaveBeenCalledTimes(2);
    expect(payloadOf(0).last_login_at).toBe(T_LOGIN); // comportement normal inchangé
    expect(payloadOf(1)).not.toHaveProperty('last_login_at');
  });

  it('(b) login en échec FK user_sync_id puis battement OK : ISO du login, puis plus rien', async () => {
    state.upsert.mockResolvedValueOnce(FK_ERR).mockResolvedValue(OK);
    const u = mkUser('b');
    svc.recordPresenceLogin(u);
    await flush();
    vi.setSystemTime(new Date(T_BEAT1));
    svc.heartbeatPresence(u);
    await flush();
    vi.setSystemTime(new Date(T_BEAT2));
    svc.heartbeatPresence(u);
    await flush();
    expect(state.upsert).toHaveBeenCalledTimes(3);
    expect(payloadOf(1).last_login_at).toBe(T_LOGIN);
    expect(payloadOf(1).last_heartbeat_at).toBe(T_BEAT1);
    expect(payloadOf(2)).not.toHaveProperty('last_login_at');
  });

  it('(b bis) battement en échec : le suivant réessaie avec le même ISO', async () => {
    state.upsert.mockResolvedValueOnce(FK_ERR).mockResolvedValueOnce(FK_ERR).mockResolvedValue(OK);
    const u = mkUser('b2');
    svc.recordPresenceLogin(u);
    await flush();
    vi.setSystemTime(new Date(T_BEAT1));
    svc.heartbeatPresence(u);
    await flush();
    vi.setSystemTime(new Date(T_BEAT2));
    svc.heartbeatPresence(u);
    await flush();
    expect(payloadOf(1).last_login_at).toBe(T_LOGIN);
    expect(payloadOf(2).last_login_at).toBe(T_LOGIN);
  });

  it('(c) login perdu (réseau non ONLINE) puis battement ONLINE : ISO du login', async () => {
    state.upsert.mockResolvedValue(OK);
    const u = mkUser('c');
    state.network = 'OFFLINE';
    svc.recordPresenceLogin(u);
    await flush();
    expect(state.upsert).not.toHaveBeenCalled();
    state.network = 'ONLINE';
    vi.setSystemTime(new Date(T_BEAT1));
    svc.heartbeatPresence(u);
    await flush();
    expect(state.upsert).toHaveBeenCalledTimes(1);
    expect(payloadOf(0).last_login_at).toBe(T_LOGIN);
    expect(payloadOf(0).last_heartbeat_at).toBe(T_BEAT1);
  });

  it('(d) nouveau login : ISO remplacé et remis non confirmé', async () => {
    state.upsert.mockResolvedValueOnce(OK).mockResolvedValueOnce(FK_ERR).mockResolvedValue(OK);
    const u = mkUser('d');
    svc.recordPresenceLogin(u); // confirmé
    await flush();
    vi.setSystemTime(new Date(T_BEAT1));
    svc.recordPresenceLogin(u); // 2e login, échoue
    await flush();
    vi.setSystemTime(new Date(T_BEAT2));
    svc.heartbeatPresence(u);
    await flush();
    expect(payloadOf(1).last_login_at).toBe(T_BEAT1);
    expect(payloadOf(2).last_login_at).toBe(T_BEAT1);
  });

  it('(e) sync_id inconnu (battement sans login dans ce process) : pas de last_login_at', async () => {
    state.upsert.mockResolvedValue(OK);
    svc.heartbeatPresence(mkUser('e'));
    await flush();
    expect(state.upsert).toHaveBeenCalledTimes(1);
    expect(payloadOf(0)).not.toHaveProperty('last_login_at');
  });

  it('(f) borne mémoire : au-delà de 200 sync_id, le plus ancien est évincé', async () => {
    state.upsert.mockResolvedValue(FK_ERR); // aucun login n'est jamais confirmé
    for (let i = 0; i < 201; i++) svc.recordPresenceLogin(mkUser(`f${i}`));
    await flush();
    state.upsert.mockClear();
    state.upsert.mockResolvedValue(OK);
    svc.heartbeatPresence(mkUser('f0')); // évincé
    svc.heartbeatPresence(mkUser('f200')); // le plus récent
    await flush();
    expect(state.upsert).toHaveBeenCalledTimes(2);
    expect(payloadOf(0)).not.toHaveProperty('last_login_at');
    expect(payloadOf(1).last_login_at).toBe(T_LOGIN);
  });

  it('rôle non suivi : aucun appel, rien mémorisé', async () => {
    state.upsert.mockResolvedValue(OK);
    const admin = { ...mkUser('x'), role: 'SUPER ADMIN' };
    svc.recordPresenceLogin(admin);
    svc.heartbeatPresence(admin);
    await flush();
    expect(state.upsert).not.toHaveBeenCalled();
  });
});
