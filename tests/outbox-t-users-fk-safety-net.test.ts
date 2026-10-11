import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * L2-3b — filet de sécurité outbox : un DELETE cloud de t_users refusé par une clé étrangère
 * (23503) désactive l'agent localement au lieu de le laisser zombie (statut -1 / is_dirty -1) avec
 * une entrée retentée indéfiniment. Garde stricte : t_users + DELETE + erreur FK identifiée ;
 * tout le reste (autres tables/opérations/erreurs) doit rester strictement inchangé.
 * Base jetable, client Supabase mocké, réseau simulé ONLINE.
 */

process.env.GEST_IN_SITU_E2E_DISABLE_SYNC = '1';
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gest-in-situ-test-fksafety-'));

vi.mock('electron', () => ({
  app: { getPath: () => tmpDir, isPackaged: false },
  net: { online: true, request: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] }
}));

vi.mock('../src/main/sync/network-monitor', () => ({
  networkMonitor: { getState: () => 'ONLINE', on: vi.fn(), off: vi.fn() }
}));

type FakeResult = { error: { message: string; code?: string; details?: string } | null };
const fake = {
  result: { error: null } as FakeResult,
  calls: [] as Array<{ table: string; op: string }>
};
vi.mock('../src/main/sync/supabase-client', () => ({
  getSupabaseClient: () => ({
    from: (table: string) => ({
      delete: () => ({ eq: async () => { fake.calls.push({ table, op: 'DELETE' }); return fake.result; } }),
      upsert: async () => { fake.calls.push({ table, op: 'UPSERT' }); return fake.result; },
      update: () => ({ eq: async () => { fake.calls.push({ table, op: 'UPDATE' }); return fake.result; } })
    })
  })
}));

const SITE_ID = 975;
let seq = 0;

const FK_MSG = 'update or delete on table "t_users" violates foreign key constraint "t_cartes_created_by_fkey" on table "t_cartes"';

describe('outbox — filet FK 23503 sur DELETE t_users (L2-3b)', () => {
  let connection: typeof import('../src/main/database/connection');
  let outbox: typeof import('../src/main/sync/outbox.service');
  let db: import('better-sqlite3').Database;

  beforeAll(async () => {
    connection = await import('../src/main/database/connection');
    outbox = await import('../src/main/sync/outbox.service');
    db = await connection.initDatabase();
    db.prepare(`INSERT OR IGNORE INTO t_sites (id, nom, code, is_active, sync_id) VALUES (?, 'SITE_FK', 'SITE_FK', 1, 'site-fk')`).run(SITE_ID);
  });

  afterAll(() => {
    connection.closeDatabase();
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    fake.result = { error: null };
    fake.calls = [];
    db.prepare('DELETE FROM t_outbox').run();
  });

  /** Agent marqué à la suppression (état posé par hardDeleteUser) + entrée DELETE PENDING. */
  function seedDeleted(statut = -1, dirty = -1) {
    seq++;
    const syncId = `user-fk-${seq}`;
    const id = Number(db.prepare(
      `INSERT INTO t_users (login, password_hash, role, site_id, sync_id, statut_actif, is_dirty) VALUES (?, 'HASH', 'OPERATEUR_SAISIE', ?, ?, ?, ?)`
    ).run(`agent_fk_${seq}`, SITE_ID, syncId, statut, dirty).lastInsertRowid);
    db.prepare(`INSERT INTO t_user_roles (id_user, role) VALUES (?, 'OPERATEUR_SAISIE')`).run(id);
    outbox.enqueueOutbox(syncId, 't_users', 'DELETE', { sync_id: syncId });
    return { id, syncId };
  }
  const urow = (id: number) => db.prepare('SELECT statut_actif, is_dirty FROM t_users WHERE id_user = ?').get(id) as { statut_actif: number; is_dirty: number } | undefined;
  const entries = () => db.prepare('SELECT id, table_name, operation, status, attempts FROM t_outbox').all() as Array<{ id: string; table_name: string; operation: string; status: string; attempts: number }>;
  const roles = (id: number) => (db.prepare('SELECT COUNT(*) AS c FROM t_user_roles WHERE id_user = ?').get(id) as { c: number }).c;
  const auditCount = () => (db.prepare("SELECT COUNT(*) AS c FROM audit_logs WHERE operator_id = 'SYSTEM' AND details LIKE '%refusée par le cloud%'").get() as { c: number }).c;

  it('(a) 23503 avec code => -1/-1 devient 0/0, entrée clôturée, aucune nouvelle entrée, audit, rôles conservés', async () => {
    const a = seedDeleted();
    fake.result = { error: { message: FK_MSG, code: '23503' } };
    const before = auditCount();
    const res = await outbox.processOutboxPending();
    expect(res.errors).toBe(0);
    expect(urow(a.id)).toEqual({ statut_actif: 0, is_dirty: 1 });
    expect(entries()).toEqual([{ id: a.syncId, table_name: 't_users', operation: 'UPDATE', status: 'PENDING', attempts: 0 }]);
    const p = JSON.parse((db.prepare('SELECT payload FROM t_outbox WHERE id = ?').get(a.syncId) as { payload: string }).payload);
    expect(p).toMatchObject({ sync_id: a.syncId, login: expect.any(String), password_hash: 'HASH', role: 'OPERATEUR_SAISIE', statut_actif: 0 });
    expect(entries().filter(e => e.operation === 'DELETE')).toHaveLength(0);
    expect(roles(a.id)).toBe(1);
    expect(auditCount()).toBe(before + 1);
    expect(fake.calls).toEqual([{ table: 't_users', op: 'DELETE' }]);
  });

  it('(b) message FK seul (sans code) => même résultat', async () => {
    const a = seedDeleted();
    fake.result = { error: { message: FK_MSG } };
    await outbox.processOutboxPending();
    expect(urow(a.id)).toEqual({ statut_actif: 0, is_dirty: 1 });
    expect(entries().map(e => `${e.operation}:${e.status}`)).toEqual(['UPDATE:PENDING']);
  });

  it('(b2) code 23503 sans message explicite => détecté', async () => {
    const a = seedDeleted();
    fake.result = { error: { message: 'conflict', code: '23503' } };
    await outbox.processOutboxPending();
    expect(urow(a.id)).toEqual({ statut_actif: 0, is_dirty: 1 });
  });

  it('(a2) la synchro descendante (cloud actif) ne reactive pas la ligne ; UPDATE reussi => SYNCED, is_dirty 0', async () => {
    const a = seedDeleted();
    fake.result = { error: { message: FK_MSG, code: '23503' } };
    await outbox.processOutboxPending();
    const { upsertCloudUser } = await import('../src/main/sync/users-sync.helper');
    const res = upsertCloudUser(db, { login: `agent_fk_${seq}`, password_hash: 'HASH', role: 'OPERATEUR_SAISIE', site_id: SITE_ID, statut_actif: 1, sync_id: a.syncId }, { statutFromCloud: true });
    expect(['skipped_dirty', 'skipped_pending_outbox']).toContain(res.action);
    expect(urow(a.id)).toEqual({ statut_actif: 0, is_dirty: 1 });
    fake.result = { error: null };
    fake.calls = [];
    await outbox.processOutboxPending();
    expect(fake.calls).toEqual([{ table: 't_users', op: 'UPSERT' }]);
    expect(entries().map(e => `${e.operation}:${e.status}`)).toEqual(['UPDATE:SYNCED']);
    expect(urow(a.id)).toEqual({ statut_actif: 0, is_dirty: 0 });
    expect(roles(a.id)).toBe(1);
  });

  it('(c) ligne recréée/réactivée entre-temps (statut 1) => intouchée, entrée clôturée sans effet destructeur', async () => {
    const a = seedDeleted(1, 1);
    fake.result = { error: { message: FK_MSG, code: '23503' } };
    const before = auditCount();
    await outbox.processOutboxPending();
    expect(urow(a.id)).toEqual({ statut_actif: 1, is_dirty: 1 });
    expect(entries().map(e => e.status)).toEqual(['SYNCED']);
    expect(roles(a.id)).toBe(1);
    expect(auditCount()).toBe(before);
  });

  it('(c2) entrée ré-enfilée en INSERT pendant l\'appel réseau => jamais écrasée par la clôture', async () => {
    const a = seedDeleted();
    fake.result = { error: { message: FK_MSG, code: '23503' } };
    // Simule createUser : l'id outbox (sync_id) est ré-enfilé en INSERT pendant l'await réseau.
    // La course est reproduite via un getter sur fake.result, lu par le mock au moment de la réponse.
    Object.defineProperty(fake, 'result', {
      configurable: true,
      get() {
        db.prepare("UPDATE t_users SET statut_actif = 1, is_dirty = 1 WHERE sync_id = ?").run(a.syncId);
        outbox.enqueueOutbox(a.syncId, 't_users', 'INSERT', { sync_id: a.syncId, login: 'x', statut_actif: 1 });
        return { error: { message: FK_MSG, code: '23503' } };
      }
    });
    try {
      await outbox.processOutboxPending();
    } finally {
      Object.defineProperty(fake, 'result', { configurable: true, writable: true, value: { error: null } });
    }
    expect(urow(a.id)).toEqual({ statut_actif: 1, is_dirty: 1 });
    expect(entries().map(e => e.operation)).toEqual(['INSERT']);
  });

  it.each([
    ['erreur réseau', { message: 'TypeError: fetch failed' }],
    ['permission 42501', { message: 'permission denied for table t_users', code: '42501' }],
    ['unicité 23505', { message: 'duplicate key value violates unique constraint', code: '23505' }]
  ])('(d/e) %s sur DELETE t_users => comportement inchangé (ligne -1/-1, entrée PENDING retentée)', async (_l, error) => {
    const a = seedDeleted();
    fake.result = { error };
    await outbox.processOutboxPending();
    expect(urow(a.id)).toEqual({ statut_actif: -1, is_dirty: -1 });
    expect(entries()).toEqual([{ id: a.syncId, table_name: 't_users', operation: 'DELETE', status: 'PENDING', attempts: 1 }]);
  });

  it('(e) erreur non-FK répétée jusqu\'au seuil => ERROR comme avant', async () => {
    const a = seedDeleted();
    fake.result = { error: { message: 'permission denied', code: '42501' } };
    for (let i = 0; i < 5; i++) await outbox.processOutboxPending();
    expect(urow(a.id)).toEqual({ statut_actif: -1, is_dirty: -1 });
    expect(entries()[0].status).toBe('ERROR');
  });

  it.each(['t_cartes', 't_logs', 't_centres', 't_sites'])('(f) 23503 sur DELETE %s => inchangé (PENDING retenté, aucun effet sur t_users)', async (table) => {
    const a = seedDeleted(1, 0);
    db.prepare('DELETE FROM t_outbox').run();
    outbox.enqueueOutbox(`other-${table}`, table, 'DELETE', { sync_id: `other-${table}` });
    fake.result = { error: { message: FK_MSG, code: '23503' } };
    await outbox.processOutboxPending();
    expect(entries()).toEqual([{ id: `other-${table}`, table_name: table, operation: 'DELETE', status: 'PENDING', attempts: 1 }]);
    expect(urow(a.id)).toEqual({ statut_actif: 1, is_dirty: 0 });
  });

  it.each(['INSERT', 'UPDATE'] as const)('(f) 23503 sur %s t_users => inchangé (PENDING retenté, ligne intacte)', async (op) => {
    const a = seedDeleted(1, 1);
    db.prepare('DELETE FROM t_outbox').run();
    outbox.enqueueOutbox(a.syncId, 't_users', op, { sync_id: a.syncId, login: 'l', password_hash: 'h', role: 'OPERATEUR_SAISIE', statut_actif: 1 });
    fake.result = { error: { message: FK_MSG, code: '23503' } };
    await outbox.processOutboxPending();
    expect(entries()).toEqual([{ id: a.syncId, table_name: 't_users', operation: op, status: 'PENDING', attempts: 1 }]);
    expect(urow(a.id)).toEqual({ statut_actif: 1, is_dirty: 1 });
  });

  it('(g) DELETE t_users réussi => purge locale comme avant (ligne et rôles supprimés, entrée SYNCED)', async () => {
    const a = seedDeleted();
    fake.result = { error: null };
    const res = await outbox.processOutboxPending();
    expect(res.processed).toBe(1);
    expect(urow(a.id)).toBeUndefined();
    expect(roles(a.id)).toBe(0);
    expect(entries().map(e => e.status)).toEqual(['SYNCED']);
  });
});
