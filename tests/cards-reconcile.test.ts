import { describe, it, expect, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3';

/**
 * Rattrapage des cartes manquantes par liste de sync_id (cards-reconcile.ts).
 * Base SQLite en memoire, client Supabase mocke, worker mocke. Jamais la production.
 */

vi.mock('electron-log', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../src/main/sync/supabase-client', () => ({ getSupabaseClient: () => null }));
vi.mock('../src/main/database/connection', () => ({ getDatabase: () => null }));
vi.mock('../src/main/sync/downstream', () => ({ writeCardsChunkWithoutCursor: vi.fn() }));

import {
  reconcileMissingCards,
  findMissingSyncIds,
  RECONCILE_PAGE_SIZE,
  RECONCILE_FETCH_IN_CHUNK,
  RECONCILE_WRITE_BATCH
} from '../src/main/sync/cards-reconcile';

const SITE = 7;
const sid = (n: number) => `sid-${String(n).padStart(6, '0')}`;

function makeDb(localIds: string[], siteId = SITE): Database.Database {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE t_cartes (id_carte INTEGER PRIMARY KEY, sync_id TEXT, site_id INTEGER);
           CREATE TABLE t_outbox (id TEXT PRIMARY KEY, table_name TEXT, operation TEXT, payload TEXT, status TEXT DEFAULT 'PENDING');`);
  const ins = db.prepare('INSERT INTO t_cartes (sync_id, site_id) VALUES (?, ?)');
  db.transaction(() => { for (const id of localIds) ins.run(id, siteId); })();
  return db;
}

interface Call { kind: 'page' | 'cards'; eq: Record<string, unknown>; gt?: string; inList?: string[]; limit?: number; signal?: AbortSignal }

/** Faux client Supabase : cloudIds trie, filtre id_site reellement applique. */
function makeSupabase(cloud: { sync_id: string; id_site: number }[], opts: { failOn?: 'page' | 'cards'; failAtCall?: number; failAfterPages?: number; hangOn?: 'page' | 'cards'; nullLastOnPage?: number } = {}) {
  const calls: Call[] = [];
  const sorted = [...cloud].sort((a, b) => (a.sync_id < b.sync_id ? -1 : 1));
  let n = 0;
  let pagesServed = 0;
  const client = {
    from: (_t: string) => {
      const call: Call = { kind: 'page', eq: {} };
      const run = (): any => {
        n++;
        calls.push(call);
        if (opts.hangOn && ((opts.hangOn === 'cards') === !!call.inList)) {
          call.kind = call.inList ? 'cards' : 'page';
          return new Promise(resolve => {
            const done = () => resolve({ data: null, error: { message: 'AbortError: The operation was aborted' } });
            if (call.signal?.aborted) done(); else call.signal?.addEventListener('abort', done);
          });
        }
        const base = sorted.filter(r => Object.entries(call.eq).every(([k, v]) => (r as any)[k] === v));
        if (call.inList) {
          call.kind = 'cards';
          if (opts.failOn === 'cards' && (opts.failAtCall === undefined || n >= opts.failAtCall)) return { data: null, error: { message: 'net down' } };
          return { data: base.filter(r => call.inList!.includes(r.sync_id)).map(r => ({ ...r, noms: 'X' })), error: null };
        }
        call.kind = 'page';
        pagesServed++;
        if (opts.failOn === 'page' && pagesServed > (opts.failAfterPages ?? 0)) return { data: null, error: { message: 'net down' } };
        let rows = base;
        if (call.gt !== undefined) rows = rows.filter(r => r.sync_id > call.gt!);
        const out: any[] = rows.slice(0, call.limit ?? 1000).map(r => ({ sync_id: r.sync_id }));
        if (opts.nullLastOnPage !== undefined && pagesServed === opts.nullLastOnPage && out.length > 0) out[out.length - 1] = { sync_id: null };
        return { data: out, error: null };
      };
      const b: any = {
        select: (_c: string) => b,
        eq: (c: string, v: unknown) => { call.eq[c] = v; return b; },
        gt: (_c: string, v: string) => { call.gt = v; return b; },
        in: (_c: string, v: string[]) => { call.inList = v; return b; },
        order: () => b,
        limit: (l: number) => { call.limit = l; return b; },
        abortSignal: (sig: AbortSignal) => { call.signal = sig; return b; },
        then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej)
      };
      return b;
    }
  };
  return { client, calls };
}

function makeWriter(db: Database.Database) {
  const batches: any[][] = [];
  const writeChunk = vi.fn(async (cards: any[]) => {
    batches.push(cards);
    const ins = db.prepare('INSERT INTO t_cartes (sync_id, site_id) VALUES (?, ?)');
    db.transaction(() => { for (const c of cards) ins.run(c.sync_id, c.id_site); })();
    return { processed: cards.length, insertedCount: cards.length };
  });
  return { writeChunk, batches };
}

const cloudOf = (from: number, to: number, site = SITE) =>
  Array.from({ length: to - from }, (_, i) => ({ sync_id: sid(from + i), id_site: site }));

describe('findMissingSyncIds', () => {
  it('compare par lots de 500 et ne retourne que les absents', () => {
    const db = makeDb(Array.from({ length: 1200 }, (_, i) => sid(i)).filter(i => i !== sid(3) && i !== sid(900)));
    const ids = Array.from({ length: 1300 }, (_, i) => sid(i));
    const missing = findMissingSyncIds(db, ids);
    expect(missing).toEqual([sid(3), sid(900), ...Array.from({ length: 100 }, (_, i) => sid(1200 + i))]);
  });
  it('ecarte les sync_id exclus', () => {
    const db = makeDb(['seed-local']);
    expect(findMissingSyncIds(db, ['a', 'b'], new Set(['a']))).toEqual(['b']);
  });
});

describe('reconcileMissingCards', () => {
  let writer: ReturnType<typeof makeWriter>;
  const yieldFn = async () => {};

  beforeEach(() => { writer = null as any; });

  it('aucune carte manquante : liste cloud parcourue, aucune requete de cartes, aucune ecriture', async () => {
    const db = makeDb(cloudOf(0, 50).map(c => c.sync_id));
    const { client, calls } = makeSupabase(cloudOf(0, 50));
    writer = makeWriter(db);
    const r = await reconcileMissingCards(SITE, null, { supabase: client, db, writeChunk: writer.writeChunk, yieldFn });
    expect(r).toMatchObject({ status: 'ok', missingFound: 0, recovered: 0 });
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every(c => c.kind === 'page')).toBe(true);
    expect(writer.writeChunk).not.toHaveBeenCalled();
  });

  it('local contient tout le cloud + des extras absents du cloud : 0 ecriture', async () => {
    const db = makeDb([...cloudOf(0, 10).map(c => c.sync_id), 'extra']);
    const { client } = makeSupabase(cloudOf(0, 10));
    writer = makeWriter(db);
    const r = await reconcileMissingCards(SITE, null, { supabase: client, db, writeChunk: writer.writeChunk, yieldFn });
    expect(r.status).toBe('ok');
    expect(r.recovered).toBe(0);
    expect(writer.writeChunk).not.toHaveBeenCalled();
  });

  it('local >= cloud en nombre MAIS cartes manquantes (extras locaux non pousses) : les manquantes sont recuperees', async () => {
    // cloud = 0..29 (30) ; local = 0..19 sauf 5 et 12 (18) + 15 extras locaux = 33 > 30
    const localIds = [
      ...cloudOf(0, 20).map(c => c.sync_id).filter(i => i !== sid(5) && i !== sid(12)),
      ...Array.from({ length: 15 }, (_, i) => 'local-only-' + i)
    ];
    const db = makeDb(localIds);
    expect((db.prepare('SELECT COUNT(*) n FROM t_cartes').get() as any).n).toBeGreaterThanOrEqual(30);
    const { client, calls } = makeSupabase(cloudOf(0, 30));
    writer = makeWriter(db);
    const r = await reconcileMissingCards(SITE, null, { supabase: client, db, writeChunk: writer.writeChunk, yieldFn });
    expect(r.status).toBe('ok');
    expect(r.missingFound).toBe(12); // 5, 12 et 20..29
    expect(r.recovered).toBe(12);
    const got = writer.batches.flat().map(c => c.sync_id).sort();
    expect(got).toEqual([sid(5), sid(12), ...Array.from({ length: 10 }, (_, i) => sid(20 + i))].sort());
    for (const c of calls) expect(c.eq.id_site).toBe(SITE);
    // les extras locaux ne sont jamais touches
    expect((db.prepare("SELECT COUNT(*) n FROM t_cartes WHERE sync_id LIKE 'local-only-%'").get() as any).n).toBe(15);
  });

  it('N=1250 manquantes sur 3 pages cloud : lots <= 500, tout recupere, id_site partout', async () => {
    const total = 3100; // 3 pages de 1000 + 1 de 100
    const missingIdx = new Set<number>();
    for (let i = 0; i < 1250; i++) missingIdx.add(Math.floor((i * total) / 1250));
    const localIds = Array.from({ length: total }, (_, i) => i).filter(i => !missingIdx.has(i)).map(sid);
    const db = makeDb(localIds);
    const { client, calls } = makeSupabase(cloudOf(0, total));
    writer = makeWriter(db);

    const r = await reconcileMissingCards(SITE, 3, { supabase: client, db, writeChunk: writer.writeChunk, yieldFn });

    expect(r.status).toBe('ok');
    expect(r.missingFound).toBe(missingIdx.size);
    expect(r.recovered).toBe(missingIdx.size);
    expect(calls.filter(c => c.kind === 'page').length).toBeGreaterThanOrEqual(4); // 4 pages + 1 vide
    expect(Math.max(...writer.batches.map(b => b.length))).toBeLessThanOrEqual(RECONCILE_WRITE_BATCH);
    expect(writer.batches.length).toBeGreaterThanOrEqual(Math.ceil(missingIdx.size / RECONCILE_WRITE_BATCH));
    for (const c of calls.filter(c => c.kind === 'cards')) expect(c.inList!.length).toBeLessThanOrEqual(RECONCILE_FETCH_IN_CHUNK);
    for (const c of calls.filter(c => c.kind === 'page')) expect(c.limit).toBe(RECONCILE_PAGE_SIZE);
    // myCentreId et siteId transmis au writer
    expect(writer.writeChunk.mock.calls[0][1]).toBe(SITE);
    expect(writer.writeChunk.mock.calls[0][2]).toBe(3);
    // Apres rattrapage : local == cloud
    expect((db.prepare('SELECT COUNT(*) n FROM t_cartes').get() as any).n).toBe(total);
  });

  it('filtre id_site present sur TOUTES les requetes cloud et jamais de carte d\'un autre site', async () => {
    const cloud = [...cloudOf(0, 20), ...cloudOf(1000, 1030, 99)]; // site 99 = autre site
    const db = makeDb(cloudOf(0, 10).map(c => c.sync_id));
    const { client, calls } = makeSupabase(cloud);
    writer = makeWriter(db);
    const r = await reconcileMissingCards(SITE, null, { supabase: client, db, writeChunk: writer.writeChunk, yieldFn });
    expect(r.recovered).toBe(10);
    expect(calls.length).toBeGreaterThan(2);
    for (const c of calls) expect(c.eq.id_site).toBe(SITE);
    for (const b of writer.batches) for (const card of b) expect(card.id_site).toBe(SITE);
  });

  it('ecarte une ligne retournee d\'un autre id_site (defense en profondeur)', async () => {
    const db = makeDb(['seed-local']);
    const { client } = makeSupabase(cloudOf(0, 3));
    // client "malveillant" : le .in() renvoie aussi une carte d'un autre site
    const orig = client.from;
    client.from = (t: string) => {
      const b = orig(t);
      const origThen = b.then;
      b.then = (res: any, rej: any) => origThen((v: any) => res(v.data && v.data[0]?.noms ? { ...v, data: [...v.data, { sync_id: 'intrus', id_site: 99 }] } : v), rej);
      return b;
    };
    writer = makeWriter(db);
    await reconcileMissingCards(SITE, null, { supabase: client, db, writeChunk: writer.writeChunk, yieldFn });
    expect(writer.batches.flat().some(c => c.sync_id === 'intrus')).toBe(false);
  });

  it('ne ressuscite pas une carte dont la suppression est en attente dans l\'outbox', async () => {
    const db = makeDb(['seed-local']);
    db.prepare(`INSERT INTO t_outbox (id, table_name, operation, payload, status) VALUES ('1','t_cartes','DELETE',?, 'PENDING')`)
      .run(JSON.stringify({ sync_id: sid(1) }));
    const { client } = makeSupabase(cloudOf(0, 3));
    writer = makeWriter(db);
    const r = await reconcileMissingCards(SITE, null, { supabase: client, db, writeChunk: writer.writeChunk, yieldFn });
    expect(r.recovered).toBe(2);
    expect(writer.batches.flat().map(c => c.sync_id)).not.toContain(sid(1));
  });

  it.each(['page', 'cards'] as const)('erreur reseau (%s) : pas de crash, status error', async (failOn) => {
    const db = makeDb(['seed-local']);
    const { client } = makeSupabase(cloudOf(0, 30), { failOn });
    writer = makeWriter(db);
    const r = await reconcileMissingCards(SITE, null, { supabase: client, db, writeChunk: writer.writeChunk, yieldFn });
    expect(r.status).toBe('error');
    expect(r.error).toContain('net down');
    expect(writer.writeChunk).not.toHaveBeenCalled();
  });

  it('erreur reseau a la 2e page : cartes deja recuperees conservees, status error, curseur intact', async () => {
    const db = makeDb(['seed-local']);
    db.exec("CREATE TABLE t_config (key TEXT PRIMARY KEY, value TEXT); INSERT INTO t_config VALUES ('last_downstream_sync','2026-01-01T00:00:00Z');");
    const { client } = makeSupabase(cloudOf(0, 1500), { failOn: 'page', failAfterPages: 1 });
    writer = makeWriter(db);
    const r = await reconcileMissingCards(SITE, null, { supabase: client, db, writeChunk: writer.writeChunk, yieldFn });
    expect(r.status).toBe('error');
    expect(r.error).toContain('net down');
    expect(r.recovered).toBe(1000);
    expect((db.prepare('SELECT COUNT(*) n FROM t_cartes').get() as any).n).toBe(1001); // 1000 recuperees + seed
    expect((db.prepare("SELECT value FROM t_config WHERE key='last_downstream_sync'").get() as any).value).toBe('2026-01-01T00:00:00Z');
  });

  it('erreur du worker : pas de crash, aucune ecriture du curseur (t_config jamais touchee)', async () => {
    const db = makeDb(['seed-local']);
    db.exec(`CREATE TABLE t_config (key TEXT PRIMARY KEY, value TEXT); INSERT INTO t_config VALUES ('last_downstream_sync','2026-01-01T00:00:00Z');`);
    const { client } = makeSupabase(cloudOf(0, 30));
    const writeChunk = vi.fn(async () => { throw new Error('SQLITE_BUSY'); });
    const r = await reconcileMissingCards(SITE, null, { supabase: client, db, writeChunk, yieldFn });
    expect(r.status).toBe('error');
    expect((db.prepare("SELECT value FROM t_config WHERE key='last_downstream_sync'").get() as any).value).toBe('2026-01-01T00:00:00Z');
  });

  it('table locale du site vide (purge/install neuve) : aucune requete cloud, aucune ecriture, statut skipped-empty-local', async () => {
    const db = makeDb([]);
    db.prepare('INSERT INTO t_cartes (sync_id, site_id) VALUES (?, ?)').run('autre-site', 99); // autre site : ne compte pas
    db.exec("CREATE TABLE t_config (key TEXT PRIMARY KEY, value TEXT); INSERT INTO t_config VALUES ('last_downstream_sync','2026-01-01T00:00:00Z');");
    const { client, calls } = makeSupabase(cloudOf(0, 30));
    writer = makeWriter(db);
    const r = await reconcileMissingCards(SITE, null, { supabase: client, db, writeChunk: writer.writeChunk, yieldFn });
    expect(r).toMatchObject({ status: 'skipped-empty-local', missingFound: 0, recovered: 0 });
    expect(calls.length).toBe(0);
    expect(writer.writeChunk).not.toHaveBeenCalled();
    expect((db.prepare('SELECT COUNT(*) n FROM t_cartes WHERE site_id = ?').get(SITE) as any).n).toBe(0);
    expect((db.prepare("SELECT value FROM t_config WHERE key='last_downstream_sync'").get() as any).value).toBe('2026-01-01T00:00:00Z');
  });

  it.each(['page', 'cards'] as const)('timeout d\'une requete (%s) : abort, status error, pas d\'exception ni d\'ecriture t_config', async (hangOn) => {
    const db = makeDb(['seed-local']);
    db.exec("CREATE TABLE t_config (key TEXT PRIMARY KEY, value TEXT); INSERT INTO t_config VALUES ('last_downstream_sync','2026-01-01T00:00:00Z');");
    const { client, calls } = makeSupabase(cloudOf(0, 5), { hangOn });
    writer = makeWriter(db);
    const r = await reconcileMissingCards(SITE, null, { supabase: client, db, writeChunk: writer.writeChunk, yieldFn, requestTimeoutMs: 30 });
    expect(r.status).toBe('error');
    expect(r.error).toContain('AbortError');
    expect(calls.some(c => c.signal?.aborted)).toBe(true);
    expect(writer.writeChunk).not.toHaveBeenCalled();
    expect((db.prepare("SELECT value FROM t_config WHERE key='last_downstream_sync'").get() as any).value).toBe('2026-01-01T00:00:00Z');
  });

  it('chaque requete cloud recoit un AbortSignal (timeout par defaut 15 s)', async () => {
    const db = makeDb(['seed-local']);
    const { client, calls } = makeSupabase(cloudOf(0, 5));
    writer = makeWriter(db);
    await reconcileMissingCards(SITE, null, { supabase: client, db, writeChunk: writer.writeChunk, yieldFn });
    expect(calls.length).toBeGreaterThan(1);
    expect(calls.every(c => c.signal instanceof AbortSignal && !c.signal.aborted)).toBe(true);
  });

  it('sync_id nul en fin de page : boucle arretee (pas de repartie du debut), log.warn', async () => {
    const db = makeDb(['seed-local']);
    const { client, calls } = makeSupabase(cloudOf(0, 1500), { nullLastOnPage: 1 });
    writer = makeWriter(db);
    const r = await reconcileMissingCards(SITE, null, { supabase: client, db, writeChunk: writer.writeChunk, yieldFn });
    expect(r.status).toBe('ok');
    expect(calls.filter(c => c.kind === 'page').length).toBe(1);
    expect(r.recovered).toBe(999); // 1000 lignes dont la derniere a un sync_id nul
  });

  it('ignore un siteId invalide et un client absent', async () => {
    expect((await reconcileMissingCards(0, null)).status).toBe('skipped');
    expect((await reconcileMissingCards(SITE, null)).status).toBe('skipped'); // mocks => client null
  });
});
