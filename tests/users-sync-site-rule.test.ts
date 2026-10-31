import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Plan site_id 2026-10-31, commit 7 — règle « recommandée » : le site_id cloud remplace le site_id local
 * d'un compte existant, s'il est vérifié (ligne locale de même id et même sync_id que le cloud), sauf pour
 * un SUPER ADMIN (jamais rattaché par le cloud, seulement détaché). Base jetable, module pur-DB.
 */

process.env.GEST_IN_SITU_E2E_DISABLE_SYNC = '1';
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gest-in-situ-test-site-rule-'));

vi.mock('electron', () => ({
  app: { getPath: () => tmpDir, isPackaged: false },
  net: { online: false, request: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] }
}));

const SITE_A = 7101, SITE_B = 7102, CENTRE_A = 71011, CENTRE_B = 71021;
let n = 0;

describe('upsertCloudUser — règle du site « le cloud l\'emporte » (commit 7)', () => {
  let connection: typeof import('../src/main/database/connection');
  let helper: typeof import('../src/main/sync/users-sync.helper');
  let db: import('better-sqlite3').Database;

  beforeAll(async () => {
    connection = await import('../src/main/database/connection');
    helper = await import('../src/main/sync/users-sync.helper');
    db = await connection.initDatabase();
    db.prepare(`INSERT INTO t_sites (id, nom, code, is_active, sync_id) VALUES (?, 'A', 'A', 1, 'site-a'), (?, 'B', 'B', 1, 'site-b')`).run(SITE_A, SITE_B);
    db.prepare(`INSERT INTO t_centres (id, site_id, nom, numero, sync_id) VALUES (?, ?, 'CA', 1, 'centre-a'), (?, ?, 'CB', 1, 'centre-b')`).run(CENTRE_A, SITE_A, CENTRE_B, SITE_B);
  });

  afterAll(() => {
    connection.closeDatabase();
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const local = (role: string, siteId: number | null, centreId: number | null, dirty = 0) => {
    const k = ++n;
    db.prepare(`INSERT INTO t_users (login, password_hash, role, site_id, centre_id, sync_id, is_dirty, statut_actif) VALUES (?, 'h', ?, ?, ?, ?, ?, 1)`)
      .run(`u${k}`, role, siteId, centreId, `sid-${k}`, dirty);
    return { login: `u${k}`, sync_id: `sid-${k}` };
  };
  const cloud = (u: { login: string; sync_id: string }, over: Record<string, unknown>) =>
    ({ login: u.login, password_hash: 'h', role: 'OPERATEUR_SAISIE', nom_user: 'N', prenom_user: 'P', statut_actif: 1, sync_id: u.sync_id, ...over }) as any;
  const row = (login: string) => db.prepare('SELECT site_id, centre_id FROM t_users WHERE login = ?').get(login) as { site_id: number | null; centre_id: number | null };
  const VERIFIED = new Map<number, string | null>([[SITE_A, 'site-a'], [SITE_B, 'site-b']]);

  it('site cloud vérifié : remplace le site local ; centre de l\'ancien site retiré si le centre cloud est absent', () => {
    const u = local('OPERATEUR_SAISIE', SITE_A, CENTRE_A);
    helper.upsertCloudUser(db, cloud(u, { site_id: SITE_B, centre_id: 99999 }), { cloudSiteSyncIds: VERIFIED });
    expect(row(u.login)).toEqual({ site_id: SITE_B, centre_id: null });
  });

  it('site cloud vérifié avec un centre existant : site et centre du cloud', () => {
    const u = local('ADMIN_CENTRE', SITE_A, CENTRE_A);
    helper.upsertCloudUser(db, cloud(u, { role: 'ADMIN_CENTRE', site_id: SITE_B, centre_id: CENTRE_B }), { cloudSiteSyncIds: VERIFIED });
    expect(row(u.login)).toEqual({ site_id: SITE_B, centre_id: CENTRE_B });
  });

  it('sans liste de vérification (appelant non migré) : site local conservé (ancienne règle)', () => {
    const u = local('OPERATEUR_SAISIE', SITE_A, CENTRE_A);
    helper.upsertCloudUser(db, cloud(u, { site_id: SITE_B, centre_id: CENTRE_A }));
    expect(row(u.login).site_id).toBe(SITE_A);
  });

  it('site local de même id mais autre sync_id (poste non réaligné) : site local conservé', () => {
    const u = local('OPERATEUR_SAISIE', SITE_A, null);
    helper.upsertCloudUser(db, cloud(u, { site_id: SITE_B, centre_id: null }), { cloudSiteSyncIds: new Map([[SITE_B, 'autre-site-cloud']]) });
    expect(row(u.login).site_id).toBe(SITE_A);
  });

  it('SUPER ADMIN : détaché si le cloud n\'a plus de site (réparation du 2026-10-27), jamais rattaché', () => {
    const sa = local('SUPER ADMIN', SITE_A, null);
    helper.upsertCloudUser(db, cloud(sa, { role: 'SUPER ADMIN', site_id: null, centre_id: null }), { cloudSiteSyncIds: VERIFIED });
    expect(row(sa.login).site_id).toBeNull();

    const sa2 = local('SUPER ADMIN', null, null);
    helper.upsertCloudUser(db, cloud(sa2, { role: 'SUPER ADMIN', site_id: SITE_B, centre_id: null }), { cloudSiteSyncIds: VERIFIED });
    expect(row(sa2.login).site_id).toBeNull();

    const sa3 = local('SUPER ADMIN', SITE_A, null);
    helper.upsertCloudUser(db, cloud(sa3, { role: 'SUPER ADMIN', site_id: SITE_B, centre_id: null }), { cloudSiteSyncIds: VERIFIED });
    expect(row(sa3.login).site_id).toBe(SITE_A);
  });

  // ── Audit fbec916 P1-1 : centre cloud vérifié et toujours cohérent avec le site retenu ──
  it('site vérifié, centre cloud existant mais rattaché à l\'autre site : centre retiré', () => {
    const u = local('ADMIN_CENTRE', SITE_A, CENTRE_A);
    helper.upsertCloudUser(db, cloud(u, { role: 'ADMIN_CENTRE', site_id: SITE_B, centre_id: CENTRE_A }), { cloudSiteSyncIds: VERIFIED });
    expect(row(u.login)).toEqual({ site_id: SITE_B, centre_id: null });
  });

  it('site non vérifié, centre cloud d\'un autre site : site et centre locaux conservés', () => {
    const u = local('ADMIN_CENTRE', SITE_A, CENTRE_A);
    helper.upsertCloudUser(db, cloud(u, { role: 'ADMIN_CENTRE', site_id: SITE_B, centre_id: CENTRE_B }), { cloudSiteSyncIds: new Map([[SITE_B, 'autre-site-cloud']]) });
    expect(row(u.login)).toEqual({ site_id: SITE_A, centre_id: CENTRE_A });
  });

  it('centre cloud de même id mais autre sync_id (poste non réaligné) : centre local conservé', () => {
    db.prepare(`INSERT INTO t_centres (id, site_id, nom, numero, sync_id) VALUES (71012, ?, 'CA2', 2, 'centre-a2')`).run(SITE_A);
    const u = local('ADMIN_CENTRE', SITE_A, CENTRE_A);
    helper.upsertCloudUser(db, cloud(u, { role: 'ADMIN_CENTRE', site_id: SITE_A, centre_id: 71012 }), { cloudSiteSyncIds: VERIFIED, cloudCentreSyncIds: new Map([[71012, 'autre-centre-cloud']]) });
    expect(row(u.login)).toEqual({ site_id: SITE_A, centre_id: CENTRE_A });

    helper.upsertCloudUser(db, cloud(u, { role: 'ADMIN_CENTRE', site_id: SITE_A, centre_id: 71012 }), { cloudSiteSyncIds: VERIFIED, cloudCentreSyncIds: new Map([[71012, 'centre-a2']]) });
    expect(row(u.login)).toEqual({ site_id: SITE_A, centre_id: 71012 });
  });

  it('nouveau compte : centre cloud d\'un autre site non appliqué', () => {
    const c = cloud({ login: 'nouveau-p1-1', sync_id: 'sid-nouveau-p1-1' }, { site_id: SITE_A, centre_id: CENTRE_B });
    expect(helper.upsertCloudUser(db, c, { cloudSiteSyncIds: VERIFIED }).action).toBe('inserted');
    expect(row('nouveau-p1-1')).toEqual({ site_id: SITE_A, centre_id: null });
  });

  it('ligne locale modifiée non envoyée (is_dirty) : rien n\'est écrasé', () => {
    const u = local('OPERATEUR_SAISIE', SITE_A, CENTRE_A, 1);
    const res = helper.upsertCloudUser(db, cloud(u, { site_id: SITE_B, centre_id: CENTRE_B }), { cloudSiteSyncIds: VERIFIED });
    expect(res.action).toBe('skipped_dirty');
    expect(row(u.login)).toEqual({ site_id: SITE_A, centre_id: CENTRE_A });
  });
});
