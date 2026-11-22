import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Règle du 2026-11-22 — « un SUPER ADMIN doit l'être par son rôle principal » (users.queries.ts).
 * 'SUPER ADMIN' est refusé en rôle SECONDAIRE (t_user_roles) à la création et à la modification,
 * quel que soit l'appelant (y compris un SUPER ADMIN) ; un SUPER ADMIN en rôle PRINCIPAL reste permis.
 * Un compte historique détenant déjà SUPER ADMIN en secondaire n'est ni bloqué ni modifié d'office.
 *
 * Base SQLite TEMPORAIRE migrée par initDatabase() (même pattern que users-security-lot1b.test.ts).
 * Modules réseau/sync mockés : aucune écriture Supabase, aucun accès à la vraie base.
 */

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gest-in-situ-test-sa-secondaire-'));

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

describe('Règle 2026-11-22 — SUPER ADMIN interdit en rôle secondaire (users.queries)', () => {
  let connection: typeof import('../src/main/database/connection');
  let uq: typeof import('../src/main/database/queries/users.queries');
  let db: import('better-sqlite3').Database;

  const SITE_A = 911;
  const MSG = 'ne peut pas être un rôle secondaire';

  type Row = { id_user: number; login: string; role: string; site_id: number | null; centre_id: number | null; nom_user: string };
  const row = (login: string) => db.prepare('SELECT * FROM t_users WHERE login = ?').get(login) as Row | undefined;
  const count = () => (db.prepare('SELECT COUNT(*) AS n FROM t_users').get() as { n: number }).n;
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
    db.prepare(`INSERT INTO t_sites (id, nom, code, is_active, is_permanent, sync_id) VALUES (?, 'SITE_A', 'SITE_A', 1, 1, 'site-sync-911')`).run(SITE_A);
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

  describe('createUser', () => {
    it('SUPER ADMIN créateur : roles [OPERATEUR_SAISIE, SUPER ADMIN] (principal = opérateur) = refus, aucun compte créé', () => {
      const sa = mk('sa', 'SUPER ADMIN', null);
      const n = count();
      expect(() => uq.createUser(
        { login: 'mix', password: 'x12345', role: 'OPERATEUR_SAISIE', roles: ['OPERATEUR_SAISIE', 'SUPER ADMIN'], site_id: SITE_A },
        caller(sa)
      )).toThrow(MSG);
      expect(count()).toBe(n);
      expect(row('mix')).toBeUndefined();
    });

    it('SUPER ADMIN créateur : roles sans role explicite, SUPER ADMIN pas en tête = refus', () => {
      const sa = mk('sa', 'SUPER ADMIN', null);
      expect(() => uq.createUser(
        { login: 'mix2', password: 'x12345', roles: ['ADMINISTRATEUR_SITE', 'SUPER ADMIN'], site_id: SITE_A },
        caller(sa)
      )).toThrow(MSG);
      expect(row('mix2')).toBeUndefined();
    });

    it('SUPER ADMIN créateur : SUPER ADMIN en rôle principal reste permis', () => {
      const sa = mk('sa', 'SUPER ADMIN', null);
      uq.createUser({ login: 'sa2', password: 'x12345', role: 'SUPER ADMIN', roles: ['SUPER ADMIN'] }, caller(sa));
      expect(row('sa2')).toMatchObject({ role: 'SUPER ADMIN', site_id: null });
      expect(rolesOf(row('sa2')!.id_user)).toEqual(['SUPER ADMIN']);
    });

    it('SUPER ADMIN créateur : SUPER ADMIN principal + rôle secondaire opérateur reste permis', () => {
      const sa = mk('sa', 'SUPER ADMIN', null);
      uq.createUser({ login: 'sa3', password: 'x12345', role: 'SUPER ADMIN', roles: ['SUPER ADMIN', 'OPERATEUR_SAISIE'], site_id: SITE_A }, caller(sa));
      expect(row('sa3')!.role).toBe('SUPER ADMIN');
    });

    it('ADMINISTRATEUR_SITE créateur : SUPER ADMIN secondaire toujours refusé (garde existante)', () => {
      const adm = mk('adm', 'ADMINISTRATEUR_SITE', SITE_A);
      expect(() => uq.createUser(
        { login: 'x', password: 'x12345', role: 'OPERATEUR_SAISIE', roles: ['OPERATEUR_SAISIE', 'SUPER ADMIN'] },
        caller(adm)
      )).toThrow('SUPER ADMIN');
      expect(row('x')).toBeUndefined();
    });

    it('ROOT (createSuperAdminAccount) : création d\'un SUPER ADMIN principal non cassée', () => {
      const created = uq.createSuperAdminAccount(
        { login: 'nouveau_sa', nom_user: 'Nom', prenom_user: 'Prenom', password: 'MotDePasse-Solide-123' },
        { id_user: 999999, role: 'SUPER ADMIN', login: 'ROOT' }
      );
      expect(created.login).toBe('nouveau_sa');
      expect(row('nouveau_sa')!.role).toBe('SUPER ADMIN');
      expect(rolesOf(row('nouveau_sa')!.id_user)).toEqual(['SUPER ADMIN']);
    });
  });

  describe('updateUser', () => {
    it('SUPER ADMIN appelant : ajout de SUPER ADMIN en secondaire à un opérateur = refus, rôles inchangés', () => {
      const sa = mk('sa', 'SUPER ADMIN', null);
      const op = mk('op', 'OPERATEUR_SAISIE', SITE_A);
      expect(() => uq.updateUser(op.id_user, { roles: ['OPERATEUR_SAISIE', 'SUPER ADMIN'] }, caller(sa))).toThrow(MSG);
      expect(row('op')!.role).toBe('OPERATEUR_SAISIE');
      expect(rolesOf(op.id_user)).toEqual(['OPERATEUR_SAISIE']);
    });

    it('SUPER ADMIN appelant : rétrogradation d\'un SUPER ADMIN en gardant SUPER ADMIN en secondaire = refus', () => {
      const sa = mk('sa', 'SUPER ADMIN', null);
      const sa2 = mk('sa2', 'SUPER ADMIN', SITE_A);
      expect(() => uq.updateUser(sa2.id_user, { roles: ['ADMINISTRATEUR_SITE', 'SUPER ADMIN'] }, caller(sa))).toThrow(MSG);
      expect(row('sa2')!.role).toBe('SUPER ADMIN');
      expect(rolesOf(sa2.id_user)).toEqual(['SUPER ADMIN']);
    });

    it('SUPER ADMIN appelant : changement du seul rôle principal (sans roles[]) laissant SUPER ADMIN en secondaire = refus', () => {
      const sa = mk('sa', 'SUPER ADMIN', null);
      const sa2 = mk('sa2', 'SUPER ADMIN', SITE_A);
      expect(() => uq.updateUser(sa2.id_user, { role: 'ADMINISTRATEUR_SITE' }, caller(sa))).toThrow(MSG);
      expect(row('sa2')!.role).toBe('SUPER ADMIN');
    });

    it('SUPER ADMIN principal conservé (SUPER ADMIN en tête de roles[]) reste permis', () => {
      const sa = mk('sa', 'SUPER ADMIN', null);
      const sa2 = mk('sa2', 'SUPER ADMIN', SITE_A);
      uq.updateUser(sa2.id_user, { roles: ['SUPER ADMIN', 'OPERATEUR_SAISIE'] }, caller(sa));
      expect(row('sa2')!.role).toBe('SUPER ADMIN');
      expect(rolesOf(sa2.id_user)).toEqual(['OPERATEUR_SAISIE', 'SUPER ADMIN']);
    });

    it('compte historique avec SUPER ADMIN déjà en secondaire : modification du nom sans toucher aux rôles = OK, rôles intacts', () => {
      const sa = mk('sa', 'SUPER ADMIN', null);
      const legacy = mk('legacy', 'OPERATEUR_SAISIE', SITE_A, ['OPERATEUR_SAISIE', 'SUPER ADMIN']);
      uq.updateUser(legacy.id_user, { nom_user: 'Renomme' }, caller(sa));
      expect(row('legacy')!.nom_user).toBe('Renomme');
      expect(rolesOf(legacy.id_user)).toEqual(['OPERATEUR_SAISIE', 'SUPER ADMIN']);
    });

    it('compte historique : renvoi des mêmes rôles (comportement de l\'écran) = non bloqué, données non supprimées', () => {
      const sa = mk('sa', 'SUPER ADMIN', null);
      const legacy = mk('legacy', 'OPERATEUR_SAISIE', SITE_A, ['OPERATEUR_SAISIE', 'SUPER ADMIN']);
      uq.updateUser(legacy.id_user, { nom_user: 'Renomme', role: 'OPERATEUR_SAISIE', roles: ['OPERATEUR_SAISIE', 'SUPER ADMIN'] }, caller(sa));
      expect(row('legacy')!.role).toBe('OPERATEUR_SAISIE');
      expect(rolesOf(legacy.id_user)).toEqual(['OPERATEUR_SAISIE', 'SUPER ADMIN']);
    });
  });
});
