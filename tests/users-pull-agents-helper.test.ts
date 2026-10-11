import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * LOT 2 / L2-1b : pullAgentsFromCloud (users.queries.ts) branché sur upsertCloudUser.
 * Base jetable, client Supabase mocké (t_users + t_user_roles en mémoire). Jamais la production.
 */

process.env.GEST_IN_SITU_E2E_DISABLE_SYNC = '1';
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gest-in-situ-test-pull-agents-'));

vi.mock('electron', () => ({
  app: { getPath: () => tmpDir, isPackaged: false },
  net: { online: false, request: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] }
}));

let cloudUsers: any[] = [];
let cloudRoles: { user_sync_id: string; role: string }[] = [];
let cloudError: { message: string } | null = null;
vi.mock('../src/main/sync/supabase-client', () => ({
  getSupabaseClient: () => ({
    from: (table: string) => {
      const filters: [string, unknown][] = [];
      let inFilter: unknown[] | null = null;
      const run = () => {
        if (cloudError) return { data: null, error: cloudError };
        if (table === 't_user_roles') return { data: cloudRoles.filter(r => !inFilter || inFilter.includes(r.user_sync_id)), error: null };
        return { data: cloudUsers.filter(u => filters.every(([c, v]) => u[c] === v)), error: null };
      };
      const builder: any = {
        select: () => builder,
        eq: (c: string, v: unknown) => { filters.push([c, v]); return builder; },
        in: (_c: string, vals: unknown[]) => { inFilter = vals; return builder; },
        then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej)
      };
      return builder;
    }
  })
}));

const SITE = 976;
const CENTRE_A = 9761;
const CENTRE_B = 9762;
let n = 0;

describe('pullAgentsFromCloud via upsertCloudUser (L2-1b)', () => {
  let connection: typeof import('../src/main/database/connection');
  let queries: typeof import('../src/main/database/queries/users.queries');
  let db: import('better-sqlite3').Database;

  beforeAll(async () => {
    connection = await import('../src/main/database/connection');
    queries = await import('../src/main/database/queries/users.queries');
    db = await connection.initDatabase();
    db.prepare(`INSERT OR IGNORE INTO t_sites (id, nom, code, is_active, sync_id) VALUES (?, 'S_PA', 'S_PA', 1, 'site-pa')`).run(SITE);
    // Deux centres locaux de MÊME nom (cas du remap par nom pour ADMIN_CENTRE)
    db.prepare(`INSERT OR IGNORE INTO t_centres (id, nom, code, site_id, sync_id) VALUES (?, 'C_PA', 'C_PA1', ?, 'centre-pa1')`).run(CENTRE_A, SITE);
    db.prepare(`INSERT OR IGNORE INTO t_centres (id, nom, code, site_id, sync_id) VALUES (?, 'c_pa ', 'C_PA2', ?, 'centre-pa2')`).run(CENTRE_B, SITE);
  });

  afterAll(() => {
    connection.closeDatabase();
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(() => { cloudUsers = []; cloudRoles = []; cloudError = null; });

  const uid = () => ++n;
  function cu(login: string, syncId: string, over: Record<string, unknown> = {}) {
    return { login, password_hash: 'cloud-hash', role: 'OPERATEUR_QUALITE', nom_user: 'N', prenom_user: 'P', email: `${login}@x.ci`, telephone: '0101', site_id: SITE, centre_id: null, statut_actif: 1, sync_id: syncId, ...over };
  }
  function local(login: string, syncId: string | null, extra: { dirty?: number; statut?: number } = {}): number {
    return Number(db.prepare(
      `INSERT INTO t_users (login, password_hash, role, site_id, sync_id, is_dirty, statut_actif) VALUES (?, 'old-hash', 'OPERATEUR_VERIFICATION', ?, ?, ?, ?)`
    ).run(login, SITE, syncId, extra.dirty ?? 0, extra.statut ?? 1).lastInsertRowid);
  }
  const row = (id: number) => db.prepare('SELECT * FROM t_users WHERE id_user = ?').get(id) as any;

  it('renommage de login cloud : mise à jour sans exception, les autres agents sont tous traités', async () => {
    const k = uid();
    const idRenamed = local(`old_${k}`, `sid-${k}-a`);
    const idOther = local(`other_${k}`, `sid-${k}-b`);
    cloudUsers = [
      cu(`new_${k}`, `sid-${k}-a`),
      cu(`other_${k}`, `sid-${k}-b`, { nom_user: 'Modifie' }),
      cu(`fresh_${k}`, `sid-${k}-c`)
    ];
    const res = await queries.pullAgentsFromCloud(SITE);
    expect(res.success).toBe(true);
    expect(res.count).toBe(3);
    expect(row(idRenamed)).toMatchObject({ login: `new_${k}`, password_hash: 'cloud-hash', is_dirty: 0, email: `new_${k}@x.ci` });
    expect(row(idOther).nom_user).toBe('Modifie');
    expect(db.prepare('SELECT 1 FROM t_users WHERE login = ?').get(`fresh_${k}`)).toBeTruthy();
    expect(res.summary?.renamed).toBe(1);
  });

  it('ligne locale sale non écrasée, ligne -1 non ressuscitée, conflit compté', async () => {
    const k = uid();
    const idDirty = local(`dirty_${k}`, `sid-${k}-d`, { dirty: 1 });
    const idDel = local(`del_${k}`, `sid-${k}-e`, { statut: -1 });
    local(`taken_${k}`, `sid-${k}-other`);
    const idRen = local(`ren_${k}`, `sid-${k}-f`);
    cloudUsers = [
      cu(`dirty_${k}`, `sid-${k}-d`),
      cu(`del_${k}`, `sid-${k}-e`),
      cu(`taken_${k}`, `sid-${k}-f`), // renommage vers un login déjà détenu -> conflit
      cu(`ok_${k}`, `sid-${k}-g`)
    ];
    const res = await queries.pullAgentsFromCloud(SITE);
    expect(res.success).toBe(true);
    expect(row(idDirty).password_hash).toBe('old-hash');
    expect(row(idDel)).toMatchObject({ statut_actif: -1, password_hash: 'old-hash' });
    expect(row(idRen).login).toBe(`ren_${k}`);
    expect(res.conflicts).toBe(1);
    expect(res.skipped).toBeGreaterThanOrEqual(2);
    expect(res.count).toBe(1); // seul ok_ est inséré
  });

  it('ADMIN_CENTRE : centre remappé par nom ; centre inexistant -> NULL', async () => {
    const k = uid();
    cloudUsers = [
      cu(`rm_${k}`, `sid-${k}-h`, { centre_id: CENTRE_A }),
      cu(`nc_${k}`, `sid-${k}-i`, { centre_id: 987654 })
    ];
    const res = await queries.pullAgentsFromCloud(SITE, CENTRE_B);
    expect(res.success).toBe(true);
    const rm = db.prepare('SELECT centre_id FROM t_users WHERE login = ?').get(`rm_${k}`) as any;
    const nc = db.prepare('SELECT centre_id FROM t_users WHERE login = ?').get(`nc_${k}`) as any;
    expect(rm.centre_id).toBe(CENTRE_B);
    expect(nc.centre_id).toBeNull();
  });

  it('multi-rôles cloud appliqués à t_user_roles', async () => {
    const k = uid();
    cloudUsers = [cu(`mr_${k}`, `sid-${k}-j`)];
    cloudRoles = [{ user_sync_id: `sid-${k}-j`, role: 'OPERATEUR_SAISIE' }];
    await queries.pullAgentsFromCloud(SITE);
    const id = (db.prepare('SELECT id_user FROM t_users WHERE login = ?').get(`mr_${k}`) as any).id_user;
    const roles = (db.prepare('SELECT role FROM t_user_roles WHERE id_user = ? ORDER BY role').all(id) as any[]).map(r => r.role);
    expect(roles).toEqual(['OPERATEUR_QUALITE', 'OPERATEUR_SAISIE']);
  });

  it('cloud vide inchangé ; erreur Supabase -> success:false', async () => {
    const before = (db.prepare('SELECT COUNT(*) c FROM t_users').get() as any).c;
    const res = await queries.pullAgentsFromCloud(SITE);
    expect(res).toEqual({ success: true, count: 0, message: 'Aucun agent trouvé sur Supabase pour ce site.' });
    expect((db.prepare('SELECT COUNT(*) c FROM t_users').get() as any).c).toBe(before);
    cloudError = { message: 'boom' };
    expect(await queries.pullAgentsFromCloud(SITE)).toEqual({ success: false, count: 0, message: 'boom' });
  });

  it('retour compatible UI : success + count numérique + champs additifs', async () => {
    const k = uid();
    cloudUsers = [cu(`ui_${k}`, `sid-${k}-k`)];
    const res = await queries.pullAgentsFromCloud(SITE);
    expect(res.success).toBe(true);
    expect(typeof res.count).toBe('number');
    expect(typeof res.skipped).toBe('number');
    expect(typeof res.conflicts).toBe('number');
  });
});
