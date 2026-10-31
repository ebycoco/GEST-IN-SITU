import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Plan site_id 2026-10-31, commit 5 : à l'acquittement d'un upsert t_sites / t_centres, l'id
 * attribué par le cloud est relu ; s'il diffère de l'id local (ligne créée sur ce poste), l'id local
 * est réaligné — jamais pendant une session ouverte. createSite : l'admin dépend du site ;
 * createCentre : insertion + enfilage dans une transaction, dépendance envers le site.
 * Base jetable, client Supabase mocké, réseau simulé ONLINE.
 */

process.env.GEST_IN_SITU_E2E_DISABLE_SYNC = '1';
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gest-in-situ-test-ack-realign-'));

vi.mock('electron', () => ({
  app: { getPath: () => tmpDir, isPackaged: false },
  net: { online: true, request: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] }
}));

vi.mock('../src/main/sync/network-monitor', () => ({
  networkMonitor: { getState: () => 'ONLINE', on: vi.fn(), off: vi.fn() }
}));

let fakeSession: Record<string, unknown> | null = null;
vi.mock('../src/main/auth/session-heartbeat', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/main/auth/session-heartbeat')>()),
  getSecureCurrentUser: () => fakeSession
}));

/** Ids attribués par le cloud, par sync_id. */
const cloudIds = new Map<string, number>();
/** Lignes t_sites / t_centres présentes dans le cloud (lues par la garde d'alignement). */
const cloudRows: Array<{ table: string; row: Record<string, unknown> }> = [];
const sent: Array<{ table: string; payload: Record<string, unknown> }> = [];
vi.mock('../src/main/sync/supabase-client', () => ({
  getSupabaseClient: () => ({
    from: (table: string) => ({
      upsert: (p: Record<string, unknown>) => {
        sent.push({ table, payload: { ...p } });
        const id = cloudIds.get(p.sync_id as string) ?? null;
        if (id !== null && (table === 't_sites' || table === 't_centres')) cloudRows.push({ table, row: { ...p, id } });
        const result = { error: null };
        return {
          select: async () => ({ error: null, data: [{ id, sync_id: p.sync_id }] }),
          then: (res: any, rej: any) => Promise.resolve(result).then(res, rej)
        };
      },
      select: () => ({
        eq: async (k: string, v: unknown) => ({ error: null, data: cloudRows.filter(c => c.table === table && c.row[k] === v).map(c => c.row) })
      }),
      delete: () => ({ eq: async () => ({ error: null }) }),
      update: () => ({ eq: async () => ({ error: null }) })
    })
  })
}));

describe('outbox — réalignement à l\'acquittement (plan site_id, commit 5)', () => {
  let connection: typeof import('../src/main/database/connection');
  let outbox: typeof import('../src/main/sync/outbox.service');
  let hierarchy: typeof import('../src/main/database/queries/hierarchy.queries');
  let realign: typeof import('../src/main/sync/hierarchy-realign');
  let db: import('better-sqlite3').Database;

  beforeAll(async () => {
    connection = await import('../src/main/database/connection');
    outbox = await import('../src/main/sync/outbox.service');
    hierarchy = await import('../src/main/database/queries/hierarchy.queries');
    realign = await import('../src/main/sync/hierarchy-realign');
    db = await connection.initDatabase();
  });

  afterAll(() => {
    connection.closeDatabase();
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    fakeSession = null;
    sent.length = 0;
    cloudIds.clear();
    cloudRows.length = 0;
    db.pragma('foreign_keys = OFF');
    for (const t of ['t_outbox', 't_logs', 't_user_roles', 't_users', 't_centres', 't_sites']) db.prepare(`DELETE FROM ${t}`).run();
    db.pragma('foreign_keys = ON');
  });

  const one = (sql: string, ...p: unknown[]) => db.prepare(sql).get(...p) as any;
  /** Laisse s'exécuter les traitements replanifiés (setImmediate) jusqu'à file vide. */
  async function drain(): Promise<void> {
    for (let i = 0; i < 20; i++) {
      await outbox.processOutboxPending(false, true);
      await new Promise(r => setImmediate(r));
      if (!outbox.isOutboxProcessing() && one(`SELECT COUNT(*) AS n FROM t_outbox WHERE status = 'PENDING'`).n === 0) return;
    }
  }

  it('createSite : l\'admin dépend du site ; hors session, site réaligné sur l\'id cloud et admin envoyé avec cet id', async () => {
    hierarchy.createSite({ nom: 'NOUVEAU', code: 'NV1', max_centres: 4, admin: { nom: 'Adm', login: 'adm_nv1', password_hash: 'secret1' } });
    const local = one(`SELECT id, sync_id FROM t_sites WHERE code = 'NV1'`);
    const admin = one(`SELECT sync_id FROM t_users WHERE login = 'adm_nv1'`);
    expect(one('SELECT depends_on FROM t_outbox WHERE id = ?', admin.sync_id).depends_on).toBe(local.sync_id);
    const CLOUD = local.id + 500;
    cloudIds.set(local.sync_id, CLOUD);

    await drain();

    expect(one(`SELECT id FROM t_sites WHERE sync_id = ?`, local.sync_id).id).toBe(CLOUD);
    expect(one(`SELECT site_id FROM t_users WHERE login = 'adm_nv1'`).site_id).toBe(CLOUD);
    const sentAdmin = sent.filter(s => s.table === 't_users');
    expect(sent[0].table).toBe('t_sites');
    expect(sentAdmin.length).toBeGreaterThan(0);
    expect(sentAdmin[sentAdmin.length - 1].payload.site_id).toBe(CLOUD);
    expect(one(`SELECT status FROM t_outbox WHERE id = ?`, admin.sync_id).status).toBe('SYNCED');
  });

  it('session ouverte : pas de réalignement ; commit 6 : l\'admin n\'est PAS envoyé avec l\'id local, puis part avec l\'id cloud après réalignement', async () => {
    fakeSession = { login: 'sa', role: 'SUPER ADMIN', site_id: null, centre_id: null };
    hierarchy.createSite({ nom: 'NOUVEAU2', code: 'NV2', max_centres: 4, admin: { nom: 'Adm', login: 'adm_nv2', password_hash: 'secret1' } });
    const local = one(`SELECT id, sync_id FROM t_sites WHERE code = 'NV2'`);
    const admin = one(`SELECT sync_id FROM t_users WHERE login = 'adm_nv2'`);
    const CLOUD = local.id + 500;
    cloudIds.set(local.sync_id, CLOUD);

    await drain();

    expect(one(`SELECT id FROM t_sites WHERE sync_id = ?`, local.sync_id).id).toBe(local.id);
    expect(sent.filter(s => s.table === 't_users')).toEqual([]);
    const row = one('SELECT status, error_msg, attempts FROM t_outbox WHERE id = ?', admin.sync_id);
    expect(row.status).toBe('PENDING');
    expect(row.error_msg).toContain(outbox.NOT_ALIGNED_PREFIX);
    expect(row.attempts).toBe(0);

    // Prochain démarrage : réalignement (préchargement), puis envoi avec l'id cloud.
    fakeSession = null;
    realign.realignLocalSite(db, local.id, CLOUD, local.sync_id);
    await drain();
    const sentAdmin = sent.filter(s => s.table === 't_users');
    expect(sentAdmin.map(s => s.payload.site_id)).toEqual([CLOUD]);
    expect(one('SELECT status FROM t_outbox WHERE id = ?', admin.sync_id).status).toBe('SYNCED');
  });

  it('commit 6 : les entrées reportées passent en fin de lot et ne bloquent pas les suivantes (> 50 reportées)', async () => {
    db.prepare(`INSERT INTO t_sites (id, nom, code, is_active, max_centres, sync_id) VALUES (7, 'LOCAL', 'L7', 1, 4, 'site-local-7')`).run();
    // Le cloud a un AUTRE site à l'id 7.
    cloudRows.push({ table: 't_sites', row: { id: 7, sync_id: 'site-autre', code: 'AUTRE' } });
    const ins = db.prepare(`INSERT INTO t_outbox (id, table_name, operation, payload, status, created_at) VALUES (?, 't_logs', 'INSERT', ?, 'PENDING', ?)`);
    for (let i = 0; i < 55; i++) ins.run(`log-k-${i}`, JSON.stringify({ sync_id: `log-k-${i}`, action: 'X', site_id: 7 }), `2026-01-01 00:00:${String(i).padStart(2, '0')}`);
    ins.run('log-ok', JSON.stringify({ sync_id: 'log-ok', action: 'X', site_id: null }), '2026-01-02 00:00:00');

    await outbox.processOutboxPending(false, true);
    await outbox.processOutboxPending(false, true);

    expect(sent.filter(s => s.table === 't_logs').map(s => s.payload.sync_id)).toEqual(['log-ok']);
    expect(one(`SELECT COUNT(*) AS n FROM t_outbox WHERE error_msg LIKE ?`, `${outbox.NOT_ALIGNED_PREFIX}%`).n).toBe(55);
  });

  it('commit 6 : site cloud de même identité (même code, autre sync_id) → envoi autorisé', async () => {
    db.prepare(`INSERT INTO t_sites (id, nom, code, is_active, max_centres, sync_id) VALUES (8, 'S8', 'S8', 1, 4, 'uuid-local-8')`).run();
    cloudRows.push({ table: 't_sites', row: { id: 8, sync_id: 'uuid-cloud-8', code: 'S8' } });
    db.prepare(`INSERT INTO t_outbox (id, table_name, operation, payload, status) VALUES ('log-8', 't_logs', 'INSERT', ?, 'PENDING')`)
      .run(JSON.stringify({ sync_id: 'log-8', action: 'X', site_id: 8 }));
    await drain();
    expect(sent.map(s => s.payload.sync_id)).toEqual(['log-8']);
  });

  it('id cloud égal à l\'id local : rien ne change', async () => {
    hierarchy.createSite({ nom: 'NOUVEAU3', code: 'NV3', max_centres: 4, admin: { nom: 'Adm', login: 'adm_nv3', password_hash: 'secret1' } });
    const local = one(`SELECT id, sync_id FROM t_sites WHERE code = 'NV3'`);
    cloudIds.set(local.sync_id, local.id);
    await drain();
    expect(one(`SELECT id FROM t_sites WHERE sync_id = ?`, local.sync_id).id).toBe(local.id);
    expect(sent.filter(s => s.table === 't_users').length).toBe(1);
  });

  it('createCentre : insertion + enfilage dans une transaction, dépendance envers le site, centre réaligné hors session', async () => {
    db.prepare(`INSERT INTO t_sites (id, nom, code, is_active, max_centres, sync_id) VALUES (40, 'S', 'S40', 1, 4, 'site-40')`).run();
    cloudRows.push({ table: 't_sites', row: { id: 40, sync_id: 'site-40', code: 'S40' } });
    hierarchy.createCentre({ site_id: 40, nom: 'Centre A', numero: 1 });
    const c = one(`SELECT id, sync_id FROM t_centres WHERE nom = 'Centre A'`);
    expect(one('SELECT depends_on FROM t_outbox WHERE id = ?', c.sync_id).depends_on).toBe('site-40');
    cloudIds.set(c.sync_id, c.id + 300);

    await drain();

    expect(one(`SELECT id, site_id FROM t_centres WHERE sync_id = ?`, c.sync_id)).toEqual({ id: c.id + 300, site_id: 40 });
  });

  it('createCentre : un échec d\'insertion n\'enfile rien', () => {
    db.prepare(`INSERT INTO t_sites (id, nom, code, is_active, max_centres, sync_id) VALUES (41, 'S', 'S41', 1, 4, 'site-41')`).run();
    expect(() => hierarchy.createCentre({ site_id: 41, nom: 'Centre KO', numero: 9 })).toThrow();
    expect(one('SELECT COUNT(*) AS n FROM t_outbox').n).toBe(0);
  });
});
