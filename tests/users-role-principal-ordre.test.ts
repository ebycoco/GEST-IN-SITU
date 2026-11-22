import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Rôle principal (t_users.role) et ordre de la liste roles[] (users.queries.ts).
 * Le rôle principal d'un compte ne doit jamais changer par simple effet d'ordre de roles[] :
 *  - getUsers renvoie roles[] avec le rôle principal en tête ;
 *  - updateUser respecte le `role` explicitement envoyé (l'écran des agents envoie toujours le
 *    principal actuel), au lieu de prendre aveuglément roles[0].
 * Le changement volontaire de rôle principal (décocher le principal dans l'écran) reste possible.
 *
 * Base SQLite TEMPORAIRE migrée par initDatabase() (même pattern que users-superadmin-role-secondaire).
 * Modules réseau/sync mockés : aucune écriture Supabase, aucun accès à la vraie base.
 */

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gest-in-situ-test-role-principal-'));

vi.mock('electron', () => ({
  app: { getPath: () => tmpDir, isPackaged: false },
  net: { online: true, request: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] }
}));
vi.mock('../src/main/sync/outbox.service', () => ({
  enqueueOutbox: vi.fn(),
  scheduleOutboxProcessing: vi.fn(),
  cancelPendingInsert: vi.fn(() => true)
}));
vi.mock('../src/main/sync/network-monitor', () => ({
  networkMonitor: { getState: () => 'OFFLINE' }
}));
vi.mock('../src/main/sync/supabase-client', () => ({ getSupabaseClient: vi.fn() }));
vi.mock('../src/main/sync/presence.service', () => ({ recordPresenceLogin: vi.fn() }));
vi.mock('../src/main/utils/audit', () => ({ logAudit: vi.fn() }));

describe('Rôle principal indépendant de l\'ordre de roles[] (users.queries)', () => {
  let connection: typeof import('../src/main/database/connection');
  let uq: typeof import('../src/main/database/queries/users.queries');
  let db: import('better-sqlite3').Database;

  const SITE_A = 921;
  const ROOT = { id_user: 999999, role: 'SUPER ADMIN', login: 'ROOT' };

  type Row = { id_user: number; login: string; role: string; site_id: number | null; centre_id: number | null; nom_user: string };
  const row = (login: string) => db.prepare('SELECT * FROM t_users WHERE login = ?').get(login) as Row | undefined;
  const rolesOf = (id: number) => (db.prepare('SELECT role FROM t_user_roles WHERE id_user = ?').all(id) as { role: string }[]).map(r => r.role).sort();

  function mk(login: string, role: string, site: number | null, roles?: string[]): Row {
    db.prepare(`INSERT INTO t_users (login, password_hash, role, nom_user, prenom_user, statut_actif, site_id, centre_id, sync_id, is_dirty)
                VALUES (?, 'HASH_' || ?, ?, 'Nom', 'Prenom', 1, ?, NULL, ?, 0)`)
      .run(login, login, role, site, `sync-${login}`);
    const r = row(login)!;
    for (const x of roles ?? [role]) db.prepare('INSERT INTO t_user_roles (id_user, role) VALUES (?, ?)').run(r.id_user, x);
    return r;
  }
  const caller = (u: Row) => ({ id_user: u.id_user, role: u.role, site_id: u.site_id ?? undefined, centre_id: u.centre_id ?? undefined, login: u.login });

  beforeAll(async () => {
    connection = await import('../src/main/database/connection');
    uq = await import('../src/main/database/queries/users.queries');
    db = await connection.initDatabase();
    db.prepare(`INSERT INTO t_sites (id, nom, code, is_active, is_permanent, sync_id) VALUES (?, 'SITE_A', 'SITE_A', 1, 1, 'site-sync-921')`).run(SITE_A);
  });

  afterAll(() => {
    connection.closeDatabase();
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    db.prepare('DELETE FROM t_logs').run();
    db.prepare('DELETE FROM t_user_roles').run();
    db.prepare('DELETE FROM t_users').run();
  });

  describe('getUsers', () => {
    it('roles[] commence toujours par le rôle principal (secondaire alphabétiquement avant le principal)', () => {
      mk('op', 'OPERATEUR_SAISIE', SITE_A, ['ADMINISTRATEUR_SITE', 'OPERATEUR_SAISIE']);
      const u = uq.getUsers(SITE_A).find((x: { login: string }) => x.login === 'op');
      expect(u.roles[0]).toBe('OPERATEUR_SAISIE');
      expect([...u.roles].sort()).toEqual(['ADMINISTRATEUR_SITE', 'OPERATEUR_SAISIE']);
    });

    it('compte historique avec SUPER ADMIN secondaire (vue ROOT) : principal en tête, SUPER ADMIN conservé dans la liste', () => {
      mk('legacy', 'OPERATEUR_SAISIE', SITE_A, ['SUPER ADMIN', 'OPERATEUR_SAISIE']);
      const u = uq.getUsers(SITE_A, undefined, { includeSuperAdmins: true }).find((x: { login: string }) => x.login === 'legacy');
      expect(u.roles[0]).toBe('OPERATEUR_SAISIE');
      expect(u.roles).toContain('SUPER ADMIN');
    });
  });

  describe('updateUser', () => {
    it('ROOT édite le nom d\'un compte historique (SUPER ADMIN secondaire renvoyé EN TÊTE de roles[]) : principal inchangé', () => {
      const legacy = mk('legacy', 'OPERATEUR_SAISIE', SITE_A, ['OPERATEUR_SAISIE', 'SUPER ADMIN']);
      // Charge utile identique à celle de l'écran des agents (role = principal à l'ouverture du modal).
      uq.updateUser(legacy.id_user, {
        login: 'legacy', nom_user: 'Renomme', prenom_user: 'Prenom', centre_id: null,
        role: 'OPERATEUR_SAISIE', roles: ['SUPER ADMIN', 'OPERATEUR_SAISIE']
      }, ROOT);
      expect(row('legacy')).toMatchObject({ role: 'OPERATEUR_SAISIE', nom_user: 'Renomme' });
      expect(rolesOf(legacy.id_user)).toEqual(['OPERATEUR_SAISIE', 'SUPER ADMIN']);
    });

    it('ADMINISTRATEUR_SITE édite un opérateur multi-rôles (secondaire en tête de roles[]) : principal inchangé', () => {
      const adm = mk('adm', 'ADMINISTRATEUR_SITE', SITE_A);
      const op = mk('op', 'OPERATEUR_SAISIE', SITE_A, ['OPERATEUR_SAISIE', 'OPERATEUR_QUALITE']);
      uq.updateUser(op.id_user, {
        nom_user: 'Renomme', role: 'OPERATEUR_SAISIE', roles: ['OPERATEUR_QUALITE', 'OPERATEUR_SAISIE']
      }, caller(adm));
      expect(row('op')!.role).toBe('OPERATEUR_SAISIE');
      expect(rolesOf(op.id_user)).toEqual(['OPERATEUR_QUALITE', 'OPERATEUR_SAISIE']);
    });

    it('changement volontaire : principal décoché dans l\'écran -> le premier rôle restant devient principal', () => {
      const sa = mk('sa', 'SUPER ADMIN', null);
      const op = mk('op', 'OPERATEUR_SAISIE', SITE_A, ['OPERATEUR_SAISIE', 'ADMIN_CENTRE']);
      // Écran : toggleRole retire OPERATEUR_SAISIE -> roles = ['ADMIN_CENTRE'], role = 'ADMIN_CENTRE'.
      uq.updateUser(op.id_user, { role: 'ADMIN_CENTRE', roles: ['ADMIN_CENTRE'] }, caller(sa));
      expect(row('op')!.role).toBe('ADMIN_CENTRE');
      expect(rolesOf(op.id_user)).toEqual(['ADMIN_CENTRE']);
    });

    it('changement volontaire : rôle unique remplacé (ajout puis retrait) -> nouveau principal', () => {
      const sa = mk('sa', 'SUPER ADMIN', null);
      const op = mk('op', 'OPERATEUR_SAISIE', SITE_A);
      uq.updateUser(op.id_user, { role: 'OPERATEUR_QUALITE', roles: ['OPERATEUR_QUALITE'] }, caller(sa));
      expect(row('op')!.role).toBe('OPERATEUR_QUALITE');
    });

    it('role explicite présent dans roles[] = choix explicite respecté', () => {
      const sa = mk('sa', 'SUPER ADMIN', null);
      const op = mk('op', 'OPERATEUR_SAISIE', SITE_A, ['OPERATEUR_SAISIE', 'ADMIN_CENTRE']);
      uq.updateUser(op.id_user, { role: 'ADMIN_CENTRE', roles: ['OPERATEUR_SAISIE', 'ADMIN_CENTRE'] }, caller(sa));
      expect(row('op')!.role).toBe('ADMIN_CENTRE');
    });

    it('role absent ou absent de roles[] : convention historique roles[0] inchangée', () => {
      const sa = mk('sa', 'SUPER ADMIN', null);
      const a = mk('a', 'OPERATEUR_SAISIE', SITE_A);
      const b = mk('b', 'OPERATEUR_SAISIE', SITE_A);
      uq.updateUser(a.id_user, { roles: ['ADMIN_CENTRE', 'OPERATEUR_SAISIE'] }, caller(sa));
      uq.updateUser(b.id_user, { role: 'OPERATEUR_QUALITE', roles: ['ADMIN_CENTRE', 'OPERATEUR_SAISIE'] }, caller(sa));
      expect(row('a')!.role).toBe('ADMIN_CENTRE');
      expect(row('b')!.role).toBe('ADMIN_CENTRE');
    });
  });
});
