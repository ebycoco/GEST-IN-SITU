import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * createSuperAdminAccount (users.queries.ts) : création d'un SUPER ADMIN par la session ROOT, et
 * garde assertTargetNotSuperAdmin sur updateUser/deleteUser/hardDeleteUser pour une cible détenant
 * SUPER ADMIN en SECOND rôle (t_user_roles). Base SQLite temporaire ; réseau/sync mockés.
 */

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gest-in-situ-test-sa-create-'));

vi.mock('electron', () => ({
  app: { getPath: () => tmpDir, isPackaged: false },
  net: { online: true, request: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] }
}));
const enqueueOutbox = vi.fn();
vi.mock('../src/main/sync/outbox.service', () => ({
  enqueueOutbox: (...a: unknown[]) => enqueueOutbox(...a),
  scheduleOutboxProcessing: vi.fn(),
  cancelPendingInsert: vi.fn(() => true)
}));
vi.mock('../src/main/sync/network-monitor', () => ({ networkMonitor: { getState: () => 'OFFLINE' } }));
vi.mock('../src/main/sync/supabase-client', () => ({ getSupabaseClient: vi.fn() }));
vi.mock('../src/main/sync/presence.service', () => ({ recordPresenceLogin: vi.fn() }));
vi.mock('../src/main/utils/audit', () => ({ logAudit: vi.fn() }));

const ROOT = { id_user: 999999, role: 'SUPER ADMIN', login: 'ROOT' };
const GOOD_PWD = 'Mot-de-passe-solide-2026';

describe('createSuperAdminAccount (ROOT) et cibles SUPER ADMIN en second rôle', () => {
  let connection: typeof import('../src/main/database/connection');
  let uq: typeof import('../src/main/database/queries/users.queries');
  let local: typeof import('../src/main/auth/local-auth');
  let db: import('better-sqlite3').Database;
  const SITE = 821;

  type Row = { id_user: number; login: string; password_hash: string; role: string; site_id: number | null; centre_id: number | null; statut_actif: number; sync_id: string; is_dirty: number; nom_user: string };
  const row = (login: string) => db.prepare('SELECT * FROM t_users WHERE login = ?').get(login) as Row | undefined;
  const count = () => (db.prepare('SELECT COUNT(*) AS n FROM t_users').get() as { n: number }).n;

  beforeAll(async () => {
    connection = await import('../src/main/database/connection');
    uq = await import('../src/main/database/queries/users.queries');
    local = await import('../src/main/auth/local-auth');
    db = await connection.initDatabase();
    db.prepare(`INSERT INTO t_sites (id, nom, code, is_active, is_permanent, sync_id) VALUES (?, 'SITE_SA', 'SITE_SA', 1, 1, 'site-sync-821')`).run(SITE);
  });
  afterAll(() => {
    connection.closeDatabase();
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });
  beforeEach(() => {
    enqueueOutbox.mockClear();
    db.prepare('DELETE FROM t_logs').run();
    db.prepare('DELETE FROM t_user_roles').run();
    db.prepare('DELETE FROM t_users').run();
  });

  it('ROOT crée un SUPER ADMIN : ligne, rôle, site NULL, hash vérifiable, outbox sans mot de passe en clair, audit propre', () => {
    const res = uq.createSuperAdminAccount({ login: '  sa.un ', nom_user: ' Dupont ', prenom_user: 'Jean', password: GOOD_PWD }, ROOT);
    expect(res.login).toBe('sa.un');
    const r = row('sa.un')!;
    expect(r).toBeTruthy();
    expect(r.role).toBe('SUPER ADMIN');
    expect(r.site_id).toBeNull();
    expect(r.centre_id).toBeNull();
    expect(r.statut_actif).toBe(1);
    expect(r.is_dirty).toBe(1);
    expect(r.sync_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(r.nom_user).toBe('Dupont');
    expect(r.password_hash).not.toContain(GOOD_PWD);
    expect(local.verifyPassword(GOOD_PWD, r.password_hash)).toBe(true);
    expect(res.id_user).toBe(r.id_user);
    expect((db.prepare('SELECT role FROM t_user_roles WHERE id_user = ?').all(r.id_user) as { role: string }[]).map(x => x.role)).toEqual(['SUPER ADMIN']);

    const userInsert = enqueueOutbox.mock.calls.find(c => c[1] === 't_users' && c[2] === 'INSERT');
    expect(userInsert).toBeTruthy();
    expect(userInsert![3]).toMatchObject({ login: 'sa.un', role: 'SUPER ADMIN', site_id: null, centre_id: null, statut_actif: 1, sync_id: r.sync_id });
    expect(userInsert![3].password_hash).toBe(r.password_hash);
    expect(JSON.stringify(enqueueOutbox.mock.calls)).not.toContain(GOOD_PWD);

    const audits = JSON.stringify(db.prepare('SELECT * FROM audit_logs').all());
    expect(audits).toContain('sa.un');
    expect(audits).not.toContain(GOOD_PWD);

    // Trace explicite « CRÉATION SUPER ADMIN » (en plus de la ligne générique de createUser) :
    // mentionne le rôle et le login, ni mot de passe ni hash.
    const saTrace = db.prepare("SELECT * FROM audit_logs WHERE details LIKE '%CRÉATION SUPER ADMIN%'").all() as { details: string }[];
    expect(saTrace).toHaveLength(1);
    expect(saTrace[0].details).toContain('SUPER ADMIN');
    expect(saTrace[0].details).toContain('sa.un');
    expect(JSON.stringify(saTrace)).not.toContain(GOOD_PWD);
    expect(JSON.stringify(saTrace)).not.toContain(r.password_hash);
  });

  it.each([
    ['SUPER ADMIN normal', { id_user: 12, role: 'SUPER ADMIN', login: 'sa' }],
    ['ADMINISTRATEUR_SITE', { id_user: 13, role: 'ADMINISTRATEUR_SITE', login: 'as' }],
    ['ADMIN_CENTRE', { id_user: 14, role: 'ADMIN_CENTRE', login: 'ac' }],
    ['absent', null]
  ])('%s : refusé, aucun compte créé', (_n, caller) => {
    const n = count();
    expect(() => uq.createSuperAdminAccount({ login: 'pirate', nom_user: 'X', password: GOOD_PWD }, caller as never)).toThrow(/ROOT/);
    expect(count()).toBe(n);
    expect(enqueueOutbox).not.toHaveBeenCalled();
  });

  it('ROOT dont le rôle actif n\'est pas SUPER ADMIN : refusé', () => {
    expect(() => uq.createSuperAdminAccount({ login: 'x1x', nom_user: 'X', password: GOOD_PWD }, { id_user: 999999, role: 'ADMIN_CENTRE' })).toThrow(/ROOT/);
  });

  it('login déjà pris (casse différente) : refusé, compte existant intact', () => {
    uq.createSuperAdminAccount({ login: 'sa.pris', nom_user: 'A', password: GOOD_PWD }, ROOT);
    const before = row('sa.pris')!.password_hash;
    expect(() => uq.createSuperAdminAccount({ login: 'SA.PRIS', nom_user: 'B', password: 'Un-autre-mdp-2026' }, ROOT)).toThrow(/déjà utilisé/);
    expect(row('sa.pris')!.password_hash).toBe(before);
  });

  it('mot de passe de moins de 12 caractères : refusé', () => {
    expect(() => uq.createSuperAdminAccount({ login: 'sa.court', nom_user: 'A', password: 'Court-12345' }, ROOT)).toThrow(/12 caractères/);
    expect(row('sa.court')).toBeUndefined();
  });

  it.each([[''], ['  '], ['a b c'], ['ab'], [42 as unknown as string]])('login invalide %j : refusé', (login) => {
    expect(() => uq.createSuperAdminAccount({ login, nom_user: 'A', password: GOOD_PWD }, ROOT)).toThrow();
  });

  it('nom vide : refusé', () => {
    expect(() => uq.createSuperAdminAccount({ login: 'sa.sansnom', nom_user: '  ', password: GOOD_PWD }, ROOT)).toThrow(/nom/i);
  });

  describe('cible détenant SUPER ADMIN en second rôle (assertTargetNotSuperAdmin)', () => {
    function mkHybrid(): number {
      db.prepare(`INSERT INTO t_users (login, password_hash, role, nom_user, prenom_user, statut_actif, site_id, sync_id, is_dirty)
                  VALUES ('hybride', 'HASH', 'ADMINISTRATEUR_SITE', 'H', 'H', 1, ?, 'sync-hybride', 0)`).run(SITE);
      const id = row('hybride')!.id_user;
      db.prepare('INSERT INTO t_user_roles (id_user, role) VALUES (?, ?)').run(id, 'ADMINISTRATEUR_SITE');
      db.prepare('INSERT INTO t_user_roles (id_user, role) VALUES (?, ?)').run(id, 'SUPER ADMIN');
      return id;
    }
    const siteAdmin = { id_user: 500, role: 'ADMINISTRATEUR_SITE', site_id: SITE, login: 'adm' };

    it('updateUser, deleteUser et hardDeleteUser par un non-SUPER ADMIN : refusés, cible inchangée', () => {
      const id = mkHybrid();
      expect(() => uq.updateUser(id, { nom_user: 'PIRATE' }, siteAdmin)).toThrow();
      expect(() => uq.deleteUser(id, siteAdmin)).toThrow();
      expect(() => uq.hardDeleteUser(id, siteAdmin)).toThrow();
      const r = row('hybride')!;
      expect(r.nom_user).toBe('H');
      expect(r.statut_actif).toBe(1);
    });
  });
});
