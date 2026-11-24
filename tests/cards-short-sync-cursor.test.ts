import { describe, it, expect, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3';

/**
 * Cycle court des cartes (sync-engine.ts triggerCardsShortSync -> getPendingCardsCount).
 *
 * Bug (test vivant agent-13, 2026-11-24) : apres un pull ayant recu des cartes, runDownstream()
 * recule le curseur 'last_downstream_sync' de 2 min (marge anti-decalage d'horloge). Le comptage
 * leger partait de ce curseur recule : il retrouvait a chaque tick (~75 s) les memes cartes deja
 * recues, relancait un pull complet, qui re-reculait le curseur au meme point -> boucle sans fin.
 *
 * Base SQLite en memoire (seulement t_config), client Supabase simule qui applique reellement le
 * filtre tuple (updated_at, sync_id) > (watermark, lastSyncId). Aucun appel reseau.
 */

vi.mock('electron-log', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('electron', () => ({
  app: { getPath: () => '.', isPackaged: false },
  BrowserWindow: { getAllWindows: () => [] }
}));
vi.mock('../src/main/auth/session-heartbeat', () => ({ getSecureCurrentUser: () => null }));
vi.mock('../src/main/utils/audit', () => ({ logAudit: vi.fn() }));

const state = vi.hoisted(() => ({
  db: null as import('better-sqlite3').Database | null,
  cloud: [] as { sync_id: string; updated_at: string; id_site: number }[],
  filters: [] as string[]
}));

vi.mock('../src/main/database/connection', () => ({
  getDatabase: () => state.db,
  getDbPath: () => ':memory:'
}));

vi.mock('../src/main/sync/supabase-client', () => ({
  getSupabaseClient: () => ({
    from: () => {
      let orFilter = '';
      let site: unknown = null;
      type Res = { count: number | null; error: { message: string } | null };
      interface CountQuery {
        select: () => CountQuery;
        or: (f: string) => CountQuery;
        eq: (c: string, v: unknown) => CountQuery;
        then: (res: (r: Res) => unknown, rej?: (e: unknown) => unknown) => Promise<unknown>;
      }
      const b: CountQuery = {
        select: () => b,
        or: (f: string) => { orFilter = f; return b; },
        eq: (...args: [string, unknown]) => { site = args[1]; return b; },
        then: (res, rej) => {
          state.filters.push(orFilter);
          const m = /^updated_at\.gt\.(.+),and\(updated_at\.eq\.(.+),sync_id\.gt\.(.+)\)$/.exec(orFilter);
          if (!m) return Promise.resolve<Res>({ count: null, error: { message: 'filtre inattendu' } }).then(res, rej);
          const wm = new Date(m[1]).getTime();
          const id = m[3];
          const count = state.cloud.filter(r => {
            if (r.id_site !== site) return false;
            const t = new Date(r.updated_at).getTime();
            return t > wm || (t === wm && r.sync_id > id);
          }).length;
          return Promise.resolve<Res>({ count, error: null }).then(res, rej);
        }
      };
      return b;
    }
  })
}));

import { getPendingCardsCount, resolvePendingCountCursor } from '../src/main/sync/downstream';

const SITE = 4;
const OTHER_SITE = 9;
const ZERO = '00000000-0000-0000-0000-000000000000';
const BUFFER_MS = 2 * 60 * 1000;
const T = '2026-11-24T06:37:24.512Z'; // updated_at cloud des 2 cartes alignees apres envoi

function setConfig(entries: Record<string, string>): void {
  const ins = state.db!.prepare('INSERT OR REPLACE INTO t_config (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(entries)) ins.run(k, v);
}

/** Etat t_config exactement tel que l'ecrit la fin de runDownstream() (downstream.ts, marge de securite). */
function stateAfterCompletedPull(lastUpdatedAt: string, lastSyncId: string): void {
  setConfig({
    last_downstream_sync_true: lastUpdatedAt,
    last_downstream_sync_true_id: lastSyncId,
    last_downstream_sync: new Date(new Date(lastUpdatedAt).getTime() - BUFFER_MS).toISOString(),
    last_downstream_sync_id: ZERO
  });
}

beforeEach(() => {
  state.db = new Database(':memory:');
  state.db.exec('CREATE TABLE t_config (key TEXT PRIMARY KEY, value TEXT)');
  state.filters = [];
  state.cloud = [
    { sync_id: 'aaa-1', updated_at: '2026-11-24T06:20:00.000Z', id_site: SITE },
    { sync_id: 'bbb-2', updated_at: T, id_site: SITE },
    { sync_id: 'ccc-3', updated_at: T, id_site: SITE },
    { sync_id: 'zzz-9', updated_at: '2026-11-24T06:50:00.000Z', id_site: OTHER_SITE }
  ];
});

describe('getPendingCardsCount : pas de pull en boucle apres reception (cycle court cartes)', () => {
  it('apres un pull termine, les cartes deja recues ne sont plus comptees (tick leger = 0)', async () => {
    stateAfterCompletedPull(T, 'ccc-3');
    // Avant correctif : 2 (les deux cartes a T, dans la fenetre de recul de 2 min) a chaque tick.
    expect(await getPendingCardsCount(SITE)).toBe(0);
    expect(await getPendingCardsCount(SITE)).toBe(0);
  });

  it('une carte reellement nouvelle est comptee, y compris a updated_at egal (sync_id superieur)', async () => {
    stateAfterCompletedPull(T, 'bbb-2');
    // ccc-3 a le meme updated_at que le repere mais un sync_id superieur : nouvelle.
    expect(await getPendingCardsCount(SITE)).toBe(1);
    state.cloud.push({ sync_id: 'ddd-4', updated_at: '2026-11-24T06:37:25.000Z', id_site: SITE });
    expect(await getPendingCardsCount(SITE)).toBe(2);
  });

  it('forceFullPull (curseur remis a 1970, repere exact ancien) : comptage depuis le curseur de pull', async () => {
    stateAfterCompletedPull(T, 'ccc-3');
    setConfig({ last_downstream_sync: '1970-01-01T00:00:00Z', last_downstream_sync_id: ZERO });
    expect(await getPendingCardsCount(SITE)).toBe(3);
  });

  it('pull interrompu en cours de chunk (curseur != repere - tampon) : comptage depuis le curseur de pull', async () => {
    stateAfterCompletedPull(T, 'ccc-3');
    setConfig({ last_downstream_sync: '2026-11-24T06:20:00.000Z', last_downstream_sync_id: 'aaa-1' });
    expect(await getPendingCardsCount(SITE)).toBe(2);
  });

  it('poste sans repere exact (ancienne version) : comportement historique', async () => {
    setConfig({ last_downstream_sync: '2026-11-24T06:20:00.000Z', last_downstream_sync_id: ZERO });
    expect(await getPendingCardsCount(SITE)).toBe(3);
  });

  it('cloisonnement : les cartes d\'un autre site ne sont jamais comptees', async () => {
    stateAfterCompletedPull(T, 'ccc-3');
    expect(await getPendingCardsCount(SITE)).toBe(0);
    expect(state.filters.length).toBe(1);
  });
});

describe('resolvePendingCountCursor', () => {
  it('garde la valeur brute du repere (microsecondes Postgres non tronquees)', () => {
    const raw = '2026-11-24T06:37:24.512345+00:00';
    const rewound = new Date(new Date(raw).getTime() - BUFFER_MS).toISOString();
    expect(resolvePendingCountCursor(rewound, ZERO, raw, 'ccc-3')).toEqual({ watermark: raw, lastSyncId: 'ccc-3' });
  });

  it('repere absent, invalide, ou curseur avec sync_id non nul : curseur de pull', () => {
    const rewound = new Date(new Date(T).getTime() - BUFFER_MS).toISOString();
    expect(resolvePendingCountCursor(rewound, ZERO, undefined, undefined)).toEqual({ watermark: rewound, lastSyncId: ZERO });
    expect(resolvePendingCountCursor(rewound, ZERO, 'pas-une-date', 'x')).toEqual({ watermark: rewound, lastSyncId: ZERO });
    expect(resolvePendingCountCursor(rewound, 'bbb-2', T, 'ccc-3')).toEqual({ watermark: rewound, lastSyncId: 'bbb-2' });
  });
});
