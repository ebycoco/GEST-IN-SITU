import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * LOT 2 / L2-1d : preloadUsersFromCloud (downstream.ts) branché sur upsertCloudUser.
 * Base jetable, client Supabase mocké. Jamais la production.
 */

process.env.GEST_IN_SITU_E2E_DISABLE_SYNC = '1';
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gest-in-situ-test-preload-users-'));

vi.mock('electron', () => ({
  app: { getPath: () => tmpDir, isPackaged: false },
  net: { online: false, request: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] }
}));

const SITE_A = 981;
const SITE_B = 982;
let cloudUsers: any[] = [];
let cloudRoles: { user_sync_id: string; role: string }[] = [];
vi.mock('../src/main/sync/supabase-client', () => ({
  getSupabaseClient: () => ({
    from: (table: string) => {
      const run = () => {
        if (table === 't_sites') return { data: [
          { id: 981, nom: 'S_PA', code: 'S_PA', is_active: 1, max_centres: 4, sync_id: 'site-pa' },
          { id: 982, nom: 'S_PB', code: 'S_PB', is_active: 1, max_centres: 4, sync_id: 'site-pb' }
        ], error: null };
        if (table === 't_centres') return { data: [], error: null };
        if (table === 't_user_roles') return { data: cloudRoles, error: null };
        return { data: cloudUsers, error: null };
      };
      const builder: any = {
        select: () => builder,
        then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej)
      };
      return builder;
    }
  })
}));

let n = 0;
describe('preloadUsersFromCloud via upsertCloudUser (L2-1d)', () => {
  let connection: typeof import('../src/main/database/connection');
  let downstream: typeof import('../src/main/sync/downstream');
  let db: import('better-sqlite3').Database;

  beforeAll(async () => {
    connection = await import('../src/main/database/connection');
    downstream = await import('../src/main/sync/downstream');
    db = await connection.initDatabase();
  });
  afterAll(() => {
    connection.closeDatabase();
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });
  beforeEach(() => { cloudUsers = []; cloudRoles = []; });

  const uid = () => ++n;
  const cu = (login: string, syncId: string, over: Record<string, unknown> = {}) => ({
    login, password_hash: 'cloud-hash', role: 'OPERATEUR_QUALITE', nom_user: 'N', prenom_user: 'P',
    email: null, telephone: null, site_id: SITE_A, centre_id: null, statut_actif: 1, sync_id: syncId,
    poste_id: null, avatar_url: null, last_login: null, created_at: null, updated_at: null, ...over
  });
  const ensureSites = () => {
    db.prepare(`INSERT OR IGNORE INTO t_sites (id, nom, code, is_active, sync_id) VALUES (?, 'S_PA', 'S_PA', 1, 'site-pa')`).run(SITE_A);
    db.prepare(`INSERT OR IGNORE INTO t_sites (id, nom, code, is_active, sync_id) VALUES (?, 'S_PB', 'S_PB', 1, 'site-pb')`).run(SITE_B);
  };
  const local = (login: string, syncId: string | null, x: { dirty?: number; statut?: number } = {}): number => {
    ensureSites();
    return Number(db.prepare(
      `INSERT INTO t_users (login, password_hash, role, nom_user, site_id, sync_id, is_dirty, statut_actif) VALUES (?, 'old-hash', 'OPERATEUR_VERIFICATION', 'Local', ?, ?, ?, ?)`
    ).run(login, SITE_A, syncId, x.dirty ?? 0, x.statut ?? 1).lastInsertRowid);
  };
  const row = (id: number) => db.prepare('SELECT * FROM t_users WHERE id_user = ?').get(id) as any;
  const byLogin = (l: string) => db.prepare('SELECT * FROM t_users WHERE login = ?').get(l) as any;
  const fk = () => db.pragma('foreign_keys', { simple: true });

  it('base fraîche (t_users vide) : comptes de plusieurs sites, SUPER ADMIN sans site, statut 0 repris, colonnes étendues', async () => {
    db.prepare('DELETE FROM t_user_roles').run();
    db.prepare('DELETE FROM t_users').run();
    const k = uid();
    cloudUsers = [
      cu(`a_${k}`, `sid-${k}-a`, { site_id: SITE_A, email: 'a@x.ci', telephone: '0102', avatar_url: 'av', last_login: '2026-01-01', created_at: '2025-05-05', updated_at: '2026-02-02' }),
      cu(`b_${k}`, `sid-${k}-b`, { site_id: SITE_B, role: 'ADMINISTRATEUR_SITE' }),
      cu(`sa_${k}`, `sid-${k}-s`, { site_id: null, role: 'SUPER ADMIN' }),
      cu(`off_${k}`, `sid-${k}-o`, { statut_actif: 0 })
    ];
    cloudRoles = [{ user_sync_id: `sid-${k}-a`, role: 'OPERATEUR_SAISIE' }];
    await downstream.preloadUsersFromCloud();
    expect(byLogin(`a_${k}`)).toMatchObject({ site_id: SITE_A, email: 'a@x.ci', telephone: '0102', avatar_url: 'av', last_login: '2026-01-01', created_at: '2025-05-05', updated_at: '2026-02-02', is_dirty: 0 });
    expect(byLogin(`b_${k}`)).toMatchObject({ site_id: SITE_B, role: 'ADMINISTRATEUR_SITE' });
    expect(byLogin(`sa_${k}`)).toMatchObject({ site_id: null, role: 'SUPER ADMIN', is_dirty: 0 });
    expect(byLogin(`off_${k}`).statut_actif).toBe(0);
    const ra = (db.prepare('SELECT role FROM t_user_roles WHERE id_user = ? ORDER BY role').all(byLogin(`a_${k}`).id_user) as any[]).map(r => r.role);
    expect(ra).toEqual(['OPERATEUR_QUALITE', 'OPERATEUR_SAISIE']);
    expect(db.prepare(`SELECT 1 FROM t_user_roles WHERE id_user = ? AND role = 'SUPER ADMIN'`).get(byLogin(`sa_${k}`).id_user)).toBeTruthy();
    expect(fk()).toBe(1);
  });

  it('renommage cloud : pas d\'exception, autres comptes préchargés, FK restaurées', async () => {
    const k = uid();
    const idR = local(`old_${k}`, `sid-${k}-a`);
    const idO = local(`other_${k}`, `sid-${k}-b`);
    cloudUsers = [cu(`new_${k}`, `sid-${k}-a`, { email: 'n@x.ci' }), cu(`other_${k}`, `sid-${k}-b`, { nom_user: 'Modifie' }), cu(`fresh_${k}`, `sid-${k}-c`, { site_id: SITE_B })];
    await expect(downstream.preloadUsersFromCloud()).resolves.toBeUndefined();
    expect(row(idR)).toMatchObject({ login: `new_${k}`, password_hash: 'cloud-hash', is_dirty: 0, email: 'n@x.ci' });
    expect(row(idO).nom_user).toBe('Modifie');
    expect(byLogin(`fresh_${k}`)).toMatchObject({ site_id: SITE_B });
    expect(fk()).toBe(1);
  });

  it('ligne sale et outbox PENDING non écrasées (y compris colonnes étendues) ; ligne -1 non ressuscitée ; conflit non fatal', async () => {
    const k = uid();
    const idDirty = local(`dirty_${k}`, `sid-${k}-d`, { dirty: 1 });
    const idOut = local(`out_${k}`, `sid-${k}-o`);
    db.prepare(`INSERT INTO t_outbox (id, table_name, operation, payload, status) VALUES (?, 't_users', 'UPDATE', '{}', 'PENDING')`).run(`sid-${k}-o`);
    const idDel = local(`del_${k}`, `sid-${k}-e`, { statut: -1 });
    local(`taken_${k}`, `sid-${k}-x`);
    const idRen = local(`ren_${k}`, `sid-${k}-f`);
    cloudUsers = [
      cu(`dirty_${k}`, `sid-${k}-d`, { nom_user: 'Cloud', email: 'c@x.ci' }),
      cu(`out_${k}`, `sid-${k}-o`, { nom_user: 'Cloud', email: 'c@x.ci' }),
      cu(`del_${k}`, `sid-${k}-e`),
      cu(`taken_${k}`, `sid-${k}-f`),
      cu(`ok_${k}`, `sid-${k}-g`)
    ];
    await downstream.preloadUsersFromCloud();
    expect(row(idDirty)).toMatchObject({ password_hash: 'old-hash', is_dirty: 1, nom_user: 'Local', email: null });
    expect(row(idOut)).toMatchObject({ password_hash: 'old-hash', nom_user: 'Local', email: null });
    expect(row(idDel)).toMatchObject({ statut_actif: -1, password_hash: 'old-hash' });
    expect(row(idRen).login).toBe(`ren_${k}`);
    expect(byLogin(`ok_${k}`)).toBeTruthy();
  });

  it('erreur SQL globale : aucune exception, foreign_keys restauré', async () => {
    const k = uid();
    cloudUsers = [cu(`boom_${k}`, `sid-${k}-z`)];
    const orig = db.prepare.bind(db);
    const spy = vi.spyOn(db, 'prepare').mockImplementation(((sql: string) => {
      if (/FROM t_users WHERE sync_id/.test(sql)) throw new Error('SQL boom');
      return orig(sql);
    }) as any);
    await expect(downstream.preloadUsersFromCloud()).resolves.toBeUndefined();
    spy.mockRestore();
    expect(fk()).toBe(1);
    expect(byLogin(`boom_${k}`)).toBeUndefined();
  });
});
