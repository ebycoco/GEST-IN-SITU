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

// Session simulée (null par défaut = comportement réel avant connexion).
let fakeSession: Record<string, unknown> | null = null;
vi.mock('../src/main/auth/session-heartbeat', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/main/auth/session-heartbeat')>()),
  getSecureCurrentUser: () => fakeSession
}));

const SITE_A = 981;
const SITE_B = 982;
let cloudUsers: any[] = [];
let cloudRoles: { user_sync_id: string; role: string }[] = [];
const DEFAULT_SITES = [
  { id: 981, nom: 'S_PA', code: 'S_PA', is_active: 1, max_centres: 4, sync_id: 'site-pa' },
  { id: 982, nom: 'S_PB', code: 'S_PB', is_active: 1, max_centres: 4, sync_id: 'site-pb' }
];
let cloudSites: any[] = DEFAULT_SITES;
let cloudCentres: any[] = [];
let cloudSitesError = false; // lecture t_sites en échec (réseau, RLS)
let cloudCentresError = false;
vi.mock('../src/main/sync/supabase-client', () => ({
  getSupabaseClient: () => ({
    from: (table: string) => {
      const filters: Array<[string, unknown]> = [];
      const run = () => {
        let data: any[];
        if (table === 't_sites' && cloudSitesError) return { data: null, error: { message: 'erreur simulée t_sites' } };
        if (table === 't_centres' && cloudCentresError) return { data: null, error: { message: 'erreur simulée t_centres' } };
        if (table === 't_sites') data = cloudSites;
        else if (table === 't_centres') data = cloudCentres;
        else if (table === 't_user_roles') data = cloudRoles;
        else data = cloudUsers;
        return { data: data.filter(r => filters.every(([k, v]) => r[k] === v)), error: null };
      };
      const builder: any = {
        select: () => builder,
        eq: (k: string, v: unknown) => { filters.push([k, v]); return builder; },
        abortSignal: () => Promise.resolve(run()),
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
  beforeEach(() => { cloudUsers = []; cloudRoles = []; cloudSites = DEFAULT_SITES; cloudCentres = []; cloudSitesError = false; cloudCentresError = false; });

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

  // ── Audit fbec916 P2-7 : construction des listes de vérification (sites, centres) du préchargement ──
  it('liste des sites du cloud : un compte local est déplacé vers le site cloud vérifié', async () => {
    const k = uid();
    local(`move_${k}`, `sid-${k}-m`);
    cloudUsers = [cu(`move_${k}`, `sid-${k}-m`, { site_id: SITE_B })];
    await downstream.preloadUsersFromCloud();
    expect(byLogin(`move_${k}`).site_id).toBe(SITE_B);
  });

  it('lecture des sites en échec : liste vide, le site local du compte est conservé (repli sûr)', async () => {
    const k = uid();
    local(`keep_${k}`, `sid-${k}-k`);
    cloudSitesError = true;
    cloudUsers = [cu(`keep_${k}`, `sid-${k}-k`, { site_id: SITE_B })];
    await downstream.preloadUsersFromCloud();
    expect(byLogin(`keep_${k}`).site_id).toBe(SITE_A);
  });

  it('liste des centres du cloud : lecture en échec → centre local conservé (repli sûr) ; lecture réussie → centre cloud appliqué', async () => {
    const k = uid();
    const C1 = 9900 + k, C2 = 9950 + k;
    ensureSites();
    db.prepare(`INSERT INTO t_centres (id, site_id, nom, numero, sync_id) VALUES (?, ?, 'LOC1', 1, ?), (?, ?, 'LOC2', 2, ?)`)
      .run(C1, SITE_A, `centre-loc1-${k}`, C2, SITE_A, `centre-loc2-${k}`);
    const id = local(`ctr_${k}`, `sid-${k}-c`);
    db.prepare('UPDATE t_users SET centre_id = ? WHERE id_user = ?').run(C1, id);
    // Lecture des centres en échec : liste vide → le centre cloud C2 (existant en local) n'est pas vérifié.
    // (Une divergence d'identité sur un centre lu avec succès est réalignée par le préchargement avant les
    // comptes ; le cas « id identique, identité différente » est couvert dans users-sync-site-rule.test.ts.)
    cloudCentresError = true;
    cloudUsers = [cu(`ctr_${k}`, `sid-${k}-c`, { site_id: SITE_A, centre_id: C2 })];
    await downstream.preloadUsersFromCloud();
    expect(byLogin(`ctr_${k}`).centre_id).toBe(C1);

    cloudCentresError = false;
    cloudCentres = [{ id: C2, site_id: SITE_A, nom: 'LOC2', numero: 2, sync_id: `centre-loc2-${k}` }];
    cloudUsers = [cu(`ctr_${k}`, `sid-${k}-c`, { site_id: SITE_A, centre_id: C2 })];
    await downstream.preloadUsersFromCloud();
    expect(byLogin(`ctr_${k}`).centre_id).toBe(C2);
  });

  it('SUPER ADMIN dont le site cloud est absent localement : inséré sans site ; autre rôle au site absent : refusé', async () => {
    const k = uid();
    ensureSites();
    cloudUsers = [
      cu(`sa_absent_${k}`, `sid-${k}-sa`, { site_id: 12, role: 'SUPER ADMIN' }),
      cu(`op_absent_${k}`, `sid-${k}-op`, { site_id: 12 })
    ];
    await downstream.preloadUsersFromCloud();
    expect(byLogin(`sa_absent_${k}`)).toMatchObject({ site_id: null, centre_id: null, role: 'SUPER ADMIN', is_dirty: 0 });
    expect(byLogin(`op_absent_${k}`)).toBeUndefined();
    expect(fk()).toBe(1);
  });

  it('poste créateur (plan site_id) : site et centre locaux réalignés sur leurs ids cloud, sans écrasement ni doublon', async () => {
    const k = uid();
    const L_SITE = 9500 + k, C_SITE = 9600 + k, L_CENTRE = 9700 + k, C_CENTRE = 9800 + k;
    db.prepare(`INSERT INTO t_sites (id, nom, code, is_active, sync_id) VALUES (?, 'NOUVEAU', ?, 1, ?)`).run(L_SITE, `NV_${k}`, `site-nv-${k}`);
    db.prepare(`INSERT INTO t_centres (id, site_id, nom, numero, sync_id) VALUES (?, ?, 'CENTRE NV', 1, ?)`).run(L_CENTRE, L_SITE, `centre-nv-${k}`);
    db.prepare(`INSERT INTO t_users (login, password_hash, role, site_id, centre_id, sync_id, is_dirty, statut_actif) VALUES (?, 'h', 'ADMINISTRATEUR_SITE', ?, ?, ?, 0, 1)`)
      .run(`admin_nv_${k}`, L_SITE, L_CENTRE, `sid-${k}-adm`);
    cloudSites = [
      ...DEFAULT_SITES,
      { id: C_SITE, nom: 'NOUVEAU', code: `NV_${k}`, is_active: 1, max_centres: 4, sync_id: `site-nv-${k}` },
      { id: L_SITE, nom: 'AUTRE', code: `AU_${k}`, is_active: 1, max_centres: 4, sync_id: `site-autre-${k}` }
    ];
    cloudCentres = [{ id: C_CENTRE, site_id: C_SITE, nom: 'CENTRE NV', numero: 1, sync_id: `centre-nv-${k}` }];

    await downstream.preloadUsersFromCloud();

    expect(db.prepare('SELECT id FROM t_sites WHERE sync_id = ?').get(`site-nv-${k}`)).toEqual({ id: C_SITE });
    expect(db.prepare('SELECT sync_id FROM t_sites WHERE id = ?').get(L_SITE)).toEqual({ sync_id: `site-autre-${k}` });
    expect(db.prepare('SELECT id, site_id FROM t_centres WHERE sync_id = ?').all(`centre-nv-${k}`)).toEqual([{ id: C_CENTRE, site_id: C_SITE }]);
    expect(byLogin(`admin_nv_${k}`)).toMatchObject({ site_id: C_SITE, centre_id: C_CENTRE });
    expect(fk()).toBe(1);
  });

  it('audit P0-1 : site de même code mais sync_id local différent (ensureSyncIds) → ni déplacé ni supprimé, références intactes', async () => {
    const k = uid();
    const S = 9400 + k;
    db.prepare(`INSERT INTO t_sites (id, nom, code, is_active, sync_id) VALUES (?, 'ABO', ?, 1, ?)`).run(S, `ABO_${k}`, `uuid-local-${k}`);
    db.prepare(`INSERT INTO t_users (login, password_hash, role, site_id, sync_id, is_dirty, statut_actif) VALUES (?, 'h', 'OPERATEUR_SAISIE', ?, ?, 0, 1)`)
      .run(`agent_abo_${k}`, S, `sid-${k}-abo`);
    cloudSites = [...DEFAULT_SITES, { id: S, nom: 'ABO', code: `ABO_${k}`, is_active: 1, max_centres: 4, sync_id: `uuid-cloud-${k}` }];

    await downstream.preloadUsersFromCloud();

    expect(db.prepare('SELECT id, sync_id FROM t_sites WHERE code = ?').all(`ABO_${k}`)).toEqual([{ id: S, sync_id: `uuid-cloud-${k}` }]);
    expect(byLogin(`agent_abo_${k}`).site_id).toBe(S);
    expect(fk()).toBe(1);
  });

  it('re-audit P1-A : syncUsersFromCloud refuse un site cloud sans sync_id dont le code diffère du site local', async () => {
    const k = uid();
    const B = 9350 + k;
    db.prepare(`INSERT INTO t_sites (id, nom, code, is_active, sync_id) VALUES (?, 'B', ?, 1, ?)`).run(B, `B3_${k}`, `uuid-b-${k}`);
    cloudSites = [{ id: B, nom: 'AUTRE', code: `AUTRE3_${k}`, is_active: 1, max_centres: 4, sync_id: null }];
    await expect(downstream.syncUsersFromCloud(B)).rejects.toBeInstanceOf(downstream.SiteNotFoundError);
    expect(db.prepare('SELECT code FROM t_sites WHERE id = ?').get(B)).toEqual({ code: `B3_${k}` });
  });

  it('re-audit P1-B : en session, syncUsersFromCloud n\'écrit pas un site cloud à réaligner (pas de suppression par le code)', async () => {
    const k = uid();
    const L = 9300 + k, C = 9360 + k;
    db.prepare(`INSERT INTO t_sites (id, nom, code, is_active, sync_id) VALUES (?, 'ABO', ?, 1, ?)`).run(L, `ABO3_${k}`, `uuid-a-${k}`);
    db.prepare(`INSERT INTO t_users (login, password_hash, role, site_id, sync_id, is_dirty, statut_actif) VALUES (?, 'h', 'OPERATEUR_SAISIE', ?, ?, 0, 1)`)
      .run(`agent_a_${k}`, L, `sid-${k}-a3`);
    cloudSites = [{ id: C, nom: 'ABO', code: `ABO3_${k}`, is_active: 1, max_centres: 4, sync_id: `uuid-a-${k}` }];
    fakeSession = { login: 'x', role: 'SUPER ADMIN', site_id: null, centre_id: null };
    try {
      await downstream.syncUsersFromCloud(C);
    } finally {
      fakeSession = null;
    }
    expect(db.prepare('SELECT id FROM t_sites WHERE code = ?').get(`ABO3_${k}`)).toEqual({ id: L });
    expect(db.prepare('SELECT COUNT(*) AS n FROM t_sites WHERE id = ?').get(C)).toEqual({ n: 0 });
    expect(byLogin(`agent_a_${k}`).site_id).toBe(L);
  });

  it('runDownstream : site local dont l\'id désigne un autre site dans le cloud → SiteNotFoundError, rien n\'est écrit', async () => {
    const k = uid();
    const L_SITE = 9900 + k;
    db.prepare(`INSERT INTO t_sites (id, nom, code, is_active, sync_id) VALUES (?, 'LOCAL', ?, 1, ?)`).run(L_SITE, `LO_${k}`, `site-lo-${k}`);
    cloudSites = [{ id: L_SITE, nom: 'AUTRE', code: `AU2_${k}`, is_active: 1, max_centres: 4, sync_id: `site-autre2-${k}` }];
    cloudCentres = [{ id: 99990 + k, site_id: L_SITE, nom: 'CENTRE AUTRE', numero: 1, sync_id: `centre-autre2-${k}` }];

    await expect(downstream.runDownstream(L_SITE)).rejects.toBeInstanceOf(downstream.SiteNotFoundError);
    expect(db.prepare('SELECT nom, sync_id FROM t_sites WHERE id = ?').get(L_SITE)).toEqual({ nom: 'LOCAL', sync_id: `site-lo-${k}` });
    expect(db.prepare('SELECT COUNT(*) AS n FROM t_centres WHERE sync_id = ?').get(`centre-autre2-${k}`)).toEqual({ n: 0 });
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
