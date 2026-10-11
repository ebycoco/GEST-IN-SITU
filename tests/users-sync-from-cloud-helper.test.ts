import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * LOT 2 / L2-1c : syncUsersFromCloud (downstream.ts) branché sur upsertCloudUser.
 * Base jetable, client Supabase mocké. Jamais la production.
 */

process.env.GEST_IN_SITU_E2E_DISABLE_SYNC = '1';
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gest-in-situ-test-sync-users-'));

vi.mock('electron', () => ({
  app: { getPath: () => tmpDir, isPackaged: false },
  net: { online: false, request: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] }
}));

const SITE = 977;
let cloudUsers: any[] = [];
let cloudRoles: { user_sync_id: string; role: string }[] = [];
vi.mock('../src/main/sync/supabase-client', () => ({
  getSupabaseClient: () => ({
    from: (table: string) => {
      const filters: [string, unknown][] = [];
      let inFilter: unknown[] | null = null;
      const run = () => {
        if (table === 't_sites') return { data: [{ id: SITE, nom: 'S_SU', code: 'S_SU', is_active: 1, max_centres: 4, sync_id: 'site-su' }], error: null };
        if (table === 't_user_roles') return { data: cloudRoles.filter(r => !inFilter || inFilter.includes(r.user_sync_id)), error: null };
        return { data: cloudUsers.filter(u => filters.every(([c, v]) => u[c] === v)), error: null };
      };
      const builder: any = {
        select: () => builder,
        eq: (c: string, v: unknown) => { filters.push([c, v]); return builder; },
        in: (_c: string, vals: unknown[]) => { inFilter = vals; return builder; },
        abortSignal: () => Promise.resolve(run()),
        then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej)
      };
      return builder;
    }
  })
}));

let n = 0;
describe('syncUsersFromCloud via upsertCloudUser (L2-1c)', () => {
  let connection: typeof import('../src/main/database/connection');
  let downstream: typeof import('../src/main/sync/downstream');
  let db: import('better-sqlite3').Database;

  beforeAll(async () => {
    connection = await import('../src/main/database/connection');
    downstream = await import('../src/main/sync/downstream');
    db = await connection.initDatabase();
    db.prepare(`INSERT OR IGNORE INTO t_sites (id, nom, code, is_active, sync_id) VALUES (?, 'S_SU', 'S_SU', 1, 'site-su')`).run(SITE);
  });
  afterAll(() => {
    connection.closeDatabase();
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });
  beforeEach(() => { cloudUsers = []; cloudRoles = []; });

  const uid = () => ++n;
  const cu = (login: string, syncId: string, over: Record<string, unknown> = {}) => ({
    login, password_hash: 'cloud-hash', role: 'OPERATEUR_QUALITE', nom_user: 'N', prenom_user: 'P',
    site_id: SITE, centre_id: null, statut_actif: 1, sync_id: syncId, ...over
  });
  const local = (login: string, syncId: string | null, x: { dirty?: number; statut?: number } = {}): number =>
    Number(db.prepare(
      `INSERT INTO t_users (login, password_hash, role, nom_user, site_id, sync_id, is_dirty, statut_actif) VALUES (?, 'old-hash', 'OPERATEUR_VERIFICATION', 'Local', ?, ?, ?, ?)`
    ).run(login, SITE, syncId, x.dirty ?? 0, x.statut ?? 1).lastInsertRowid);
  const row = (id: number) => db.prepare('SELECT * FROM t_users WHERE id_user = ?').get(id) as any;
  const fk = () => db.pragma('foreign_keys', { simple: true });

  it('renommage cloud : pas d\'exception, autres agents mis à jour, FK restaurées', async () => {
    const k = uid();
    const idR = local(`old_${k}`, `sid-${k}-a`);
    const idO = local(`other_${k}`, `sid-${k}-b`);
    cloudUsers = [cu(`new_${k}`, `sid-${k}-a`), cu(`other_${k}`, `sid-${k}-b`, { nom_user: 'Modifie' }), cu(`fresh_${k}`, `sid-${k}-c`)];
    const count = await downstream.syncUsersFromCloud(SITE);
    expect(count).toBe(3);
    expect(row(idR)).toMatchObject({ login: `new_${k}`, password_hash: 'cloud-hash', is_dirty: 0 });
    expect(row(idO).nom_user).toBe('Modifie');
    expect(db.prepare('SELECT 1 FROM t_users WHERE login = ?').get(`fresh_${k}`)).toBeTruthy();
    expect(fk()).toBe(1);
  });

  it('ligne sale et outbox PENDING non écrasées ; ligne -1 non ressuscitée ; conflit non fatal', async () => {
    const k = uid();
    const idDirty = local(`dirty_${k}`, `sid-${k}-d`, { dirty: 1 });
    const idOut = local(`out_${k}`, `sid-${k}-o`);
    db.prepare(`INSERT INTO t_outbox (id, table_name, operation, payload, status) VALUES (?, 't_users', 'UPDATE', '{}', 'PENDING')`).run(`sid-${k}-o`);
    const idDel = local(`del_${k}`, `sid-${k}-e`, { statut: -1 });
    local(`taken_${k}`, `sid-${k}-x`);
    const idRen = local(`ren_${k}`, `sid-${k}-f`);
    cloudUsers = [
      cu(`dirty_${k}`, `sid-${k}-d`, { nom_user: 'Cloud' }),
      cu(`out_${k}`, `sid-${k}-o`, { nom_user: 'Cloud' }),
      cu(`del_${k}`, `sid-${k}-e`),
      cu(`taken_${k}`, `sid-${k}-f`),
      cu(`ok_${k}`, `sid-${k}-g`)
    ];
    const count = await downstream.syncUsersFromCloud(SITE);
    expect(count).toBe(1);
    expect(row(idDirty)).toMatchObject({ password_hash: 'old-hash', is_dirty: 1, nom_user: 'Local' });
    expect(row(idOut)).toMatchObject({ password_hash: 'old-hash', nom_user: 'Local' });
    expect(row(idDel)).toMatchObject({ statut_actif: -1, password_hash: 'old-hash' });
    expect(row(idRen).login).toBe(`ren_${k}`);
  });

  it('rôles multiples cloud appliqués ; rôle invalide ignoré sans exception', async () => {
    const k = uid();
    cloudUsers = [cu(`mr_${k}`, `sid-${k}-h`), cu(`bad_${k}`, `sid-${k}-i`, { role: 'ROLE_INCONNU' })];
    cloudRoles = [{ user_sync_id: `sid-${k}-h`, role: 'OPERATEUR_SAISIE' }];
    const count = await downstream.syncUsersFromCloud(SITE);
    expect(count).toBe(1);
    const id = (db.prepare('SELECT id_user FROM t_users WHERE login = ?').get(`mr_${k}`) as any).id_user;
    const roles = (db.prepare('SELECT role FROM t_user_roles WHERE id_user = ? ORDER BY role').all(id) as any[]).map(r => r.role);
    expect(roles).toEqual(['OPERATEUR_QUALITE', 'OPERATEUR_SAISIE']);
    expect(db.prepare('SELECT 1 FROM t_users WHERE login = ?').get(`bad_${k}`)).toBeUndefined();
  });

  it('cloud vide : retourne 0, base inchangée', async () => {
    const before = (db.prepare('SELECT COUNT(*) c FROM t_users').get() as any).c;
    expect(await downstream.syncUsersFromCloud(SITE)).toBe(0);
    expect((db.prepare('SELECT COUNT(*) c FROM t_users').get() as any).c).toBe(before);
    expect(fk()).toBe(1);
  });

  it('PRAGMA foreign_keys restauré même si l\'upsert échoue globalement, sans exception', async () => {
    const k = uid();
    cloudUsers = [cu(`boom_${k}`, `sid-${k}-z`)];
    const orig = db.prepare.bind(db);
    const spy = vi.spyOn(db, 'prepare').mockImplementation(((sql: string) => {
      if (/FROM t_users WHERE sync_id/.test(sql)) throw new Error('SQL boom');
      return orig(sql);
    }) as any);
    await expect(downstream.syncUsersFromCloud(SITE)).resolves.toBe(0);
    spy.mockRestore();
    expect(fk()).toBe(1);
  });
});
