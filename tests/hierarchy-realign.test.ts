import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Plan site_id 2026-10-31 (E1, commit 3) : hierarchy-realign renumérote l'id LOCAL d'un site /
 * centre sur son id CLOUD, avec toutes ses références et les payloads t_outbox en attente.
 * Base jetable, aucun appel réseau (module pur-DB).
 */

process.env.GEST_IN_SITU_E2E_DISABLE_SYNC = '1';
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gest-in-situ-test-realign-'));

vi.mock('electron', () => ({
  app: { getPath: () => tmpDir, isPackaged: false },
  net: { online: false, request: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] }
}));

describe('hierarchy-realign — id local → id cloud', () => {
  let connection: typeof import('../src/main/database/connection');
  let realign: typeof import('../src/main/sync/hierarchy-realign');
  let db: import('better-sqlite3').Database;

  beforeAll(async () => {
    connection = await import('../src/main/database/connection');
    realign = await import('../src/main/sync/hierarchy-realign');
    db = await connection.initDatabase();
  });

  afterAll(() => {
    connection.closeDatabase();
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    db.pragma('foreign_keys = OFF');
    for (const t of ['t_outbox', 't_logs', 't_import_anomalies', 't_cartes', 't_user_roles', 't_users', 't_postes', 't_centres', 't_sites']) {
      db.prepare(`DELETE FROM ${t}`).run();
    }
    db.prepare(`DELETE FROM sqlite_sequence WHERE name IN ('t_sites', 't_centres', 't_postes')`).run();
    db.pragma('foreign_keys = ON');
  });

  const site = (id: number, syncId: string) =>
    db.prepare(`INSERT INTO t_sites (id, nom, code, is_active, sync_id) VALUES (?, ?, ?, 1, ?)`).run(id, `S_${syncId}`, `C_${syncId}`, syncId);
  const centre = (id: number, siteId: number, syncId: string) =>
    db.prepare(`INSERT INTO t_centres (id, site_id, nom, numero, sync_id) VALUES (?, ?, ?, 1, ?)`).run(id, siteId, `CE_${syncId}`, syncId);
  const user = (login: string, siteId: number, centreId: number | null) =>
    db.prepare(`INSERT INTO t_users (login, password_hash, role, site_id, centre_id, sync_id, is_dirty) VALUES (?, 'h', 'OPERATEUR_SAISIE', ?, ?, ?, 0)`)
      .run(login, siteId, centreId, `u-${login}`);
  const carte = (syncId: string, siteId: number, centreId: number | null) =>
    db.prepare(`INSERT INTO t_cartes (sync_id, site_id, centre_id, noms, prenoms, date_de_naissance, is_dirty) VALUES (?, ?, ?, 'N', 'P', '1990-01-01', 0)`)
      .run(syncId, siteId, centreId);
  const outbox = (id: string, table: string, status: string, payload: Record<string, unknown>) =>
    db.prepare(`INSERT INTO t_outbox (id, table_name, operation, payload, status) VALUES (?, ?, 'UPDATE', ?, ?)`).run(id, table, JSON.stringify(payload), status);
  const payloadOf = (id: string) => JSON.parse((db.prepare('SELECT payload FROM t_outbox WHERE id = ?').get(id) as { payload: string }).payload);
  const one = (sql: string, ...p: unknown[]) => db.prepare(sql).get(...p) as any;

  it('site L → C : t_sites, toutes les références et les payloads PENDING/ERROR ; SYNCED intact ; rien de sale ni d\'enfilé', () => {
    site(5, 'site-new');
    centre(7, 5, 'centre-new');
    user('agent', 5, 7);
    carte('carte-1', 5, 7);
    db.prepare(`INSERT INTO t_logs (action, site_id, centre_id, sync_id) VALUES ('X', 5, 7, 'log-1')`).run();
    db.prepare(`INSERT INTO t_import_anomalies (noms, site_id) VALUES ('ANO', 5)`).run();
    outbox('o-user', 't_users', 'PENDING', { sync_id: 'u-agent', site_id: 5, centre_id: 7 });
    outbox('o-carte', 't_cartes', 'ERROR', { sync_id: 'carte-1', site_id: 5 });
    outbox('o-cloudname', 't_cartes', 'PENDING', { sync_id: 'carte-x', id_site: 5 });
    outbox('o-old', 't_users', 'SYNCED', { sync_id: 'u-old', site_id: 5 });
    outbox('o-other', 't_users', 'PENDING', { sync_id: 'u-other', site_id: 6 });

    const res = realign.realignLocalSite(db, 5, 40, 'site-new');

    expect(res.action).toBe('realigned');
    expect(one('SELECT id FROM t_sites WHERE sync_id = ?', 'site-new').id).toBe(40);
    expect(one('SELECT COUNT(*) AS n FROM t_sites WHERE id = 5').n).toBe(0);
    expect(one('SELECT site_id FROM t_centres WHERE id = 7').site_id).toBe(40);
    expect(one(`SELECT site_id, centre_id, is_dirty FROM t_users WHERE login = 'agent'`)).toEqual({ site_id: 40, centre_id: 7, is_dirty: 0 });
    expect(one(`SELECT site_id, is_dirty FROM t_cartes WHERE sync_id = 'carte-1'`)).toEqual({ site_id: 40, is_dirty: 0 });
    expect(one(`SELECT site_id FROM t_logs WHERE sync_id = 'log-1'`).site_id).toBe(40);
    expect(one(`SELECT site_id FROM t_import_anomalies WHERE noms = 'ANO'`).site_id).toBe(40);
    expect(payloadOf('o-user')).toEqual({ sync_id: 'u-agent', site_id: 40, centre_id: 7 });
    expect(payloadOf('o-carte').site_id).toBe(40);
    expect(payloadOf('o-cloudname').id_site).toBe(40);
    expect(payloadOf('o-old').site_id).toBe(5);
    expect(payloadOf('o-other').site_id).toBe(6);
    expect(one('SELECT COUNT(*) AS n FROM t_outbox').n).toBe(5);
    expect(one(`SELECT COUNT(*) AS n FROM t_logs`).n).toBe(1);
    expect(db.pragma('foreign_key_check')).toEqual([]);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  it('AUTOINCREMENT : un site créé après le réalignement ne reçoit pas l\'id cloud', () => {
    site(5, 'site-new');
    realign.realignLocalSite(db, 5, 40, 'site-new');
    const id = Number(db.prepare(`INSERT INTO t_sites (nom, code, sync_id) VALUES ('NEXT', 'NEXT', 'site-next')`).run().lastInsertRowid);
    expect(id).toBeGreaterThan(40);
  });

  it('collision : une autre ligne locale occupant l\'id cloud est d\'abord déplacée, avec ses références', () => {
    site(5, 'site-new');
    site(40, 'site-autre-local');
    centre(7, 5, 'centre-new');
    centre(8, 40, 'centre-autre');
    user('a_new', 5, 7);
    user('a_autre', 40, 8);
    outbox('o-autre', 't_users', 'PENDING', { sync_id: 'u-a_autre', site_id: 40 });

    const res = realign.realignLocalSite(db, 5, 40, 'site-new');

    expect(res.action).toBe('realigned');
    const moved = res.movedOccupantTo!;
    expect(moved).toBeGreaterThan(40);
    expect(one('SELECT id FROM t_sites WHERE sync_id = ?', 'site-new').id).toBe(40);
    expect(one('SELECT id FROM t_sites WHERE sync_id = ?', 'site-autre-local').id).toBe(moved);
    expect(one('SELECT site_id FROM t_centres WHERE id = 7').site_id).toBe(40);
    expect(one('SELECT site_id FROM t_centres WHERE id = 8').site_id).toBe(moved);
    expect(one(`SELECT site_id FROM t_users WHERE login = 'a_new'`).site_id).toBe(40);
    expect(one(`SELECT site_id FROM t_users WHERE login = 'a_autre'`).site_id).toBe(moved);
    expect(payloadOf('o-autre').site_id).toBe(moved);
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });

  it('centre L → C : t_centres, t_postes, t_users, t_cartes et payloads (centre_id, id_centre, id du centre)', () => {
    site(40, 'site-1');
    centre(3, 40, 'centre-new');
    db.prepare(`INSERT INTO t_postes (centre_id, nom, numero, sync_id) VALUES (3, 'P1', 1, 'poste-1')`).run();
    user('agent', 40, 3);
    carte('carte-1', 40, 3);
    outbox('o-centre', 't_centres', 'PENDING', { sync_id: 'centre-new', id: 3, site_id: 40 });
    outbox('o-carte', 't_cartes', 'PENDING', { sync_id: 'carte-1', id_centre: 3, id_site: 40 });

    const res = realign.realignLocalCentre(db, 3, 21, 'centre-new');

    expect(res.action).toBe('realigned');
    expect(one('SELECT id, site_id FROM t_centres WHERE sync_id = ?', 'centre-new')).toEqual({ id: 21, site_id: 40 });
    expect(one(`SELECT centre_id FROM t_postes WHERE sync_id = 'poste-1'`).centre_id).toBe(21);
    expect(one(`SELECT centre_id FROM t_users WHERE login = 'agent'`).centre_id).toBe(21);
    expect(one(`SELECT centre_id FROM t_cartes WHERE sync_id = 'carte-1'`).centre_id).toBe(21);
    expect(payloadOf('o-centre')).toEqual({ sync_id: 'centre-new', id: 21, site_id: 40 });
    expect(payloadOf('o-carte')).toEqual({ sync_id: 'carte-1', id_centre: 21, id_site: 40 });
  });

  it('noop, skipped et idempotence : rien n\'est modifié', () => {
    site(5, 'site-new');
    expect(realign.realignLocalSite(db, 5, 5, 'site-new').action).toBe('noop');
    expect(realign.realignLocalSite(db, 5, 40, 'autre-sync').action).toBe('skipped');
    expect(realign.realignLocalSite(db, 99, 40, 'site-new').action).toBe('skipped');
    expect(realign.realignLocalSite(db, 5, 0, 'site-new').action).toBe('skipped');
    const inTx = db.transaction(() => realign.realignLocalSite(db, 5, 40, 'site-new'))();
    expect(inTx).toMatchObject({ action: 'skipped' });
    expect(one('SELECT id FROM t_sites WHERE sync_id = ?', 'site-new').id).toBe(5);

    expect(realign.realignLocalSite(db, 5, 40, 'site-new').action).toBe('realigned');
    expect(realign.realignLocalSite(db, 5, 40, 'site-new').action).toBe('skipped');
    expect(one('SELECT id FROM t_sites WHERE sync_id = ?', 'site-new').id).toBe(40);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  it('erreur SQL pendant le réalignement : tout est annulé et foreign_keys est restauré', () => {
    site(5, 'site-new');
    user('agent', 5, null);
    const orig = db.prepare.bind(db);
    const spy = vi.spyOn(db, 'prepare').mockImplementation(((sql: string) => {
      if (/UPDATE "t_users"/.test(sql)) throw new Error('SQL boom');
      return orig(sql);
    }) as any);
    expect(() => realign.realignLocalSite(db, 5, 40, 'site-new')).toThrow('SQL boom');
    spy.mockRestore();
    expect(one('SELECT id FROM t_sites WHERE sync_id = ?', 'site-new').id).toBe(5);
    expect(one(`SELECT site_id FROM t_users WHERE login = 'agent'`).site_id).toBe(5);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
  });
});
