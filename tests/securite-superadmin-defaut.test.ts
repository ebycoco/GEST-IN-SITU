import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Sécurité (2026-10-31) — compte 'superadmin' seed au mot de passe par défaut.
 *
 * Partie 1 :
 *  - migrateV1 crée désormais la ligne seed DÉSACTIVÉE (poste neuf) ;
 *  - disableDefaultSuperadminAccounts() (schema.ts, exécutée par runMigrations à chaque
 *    démarrage) désactive un seed resté au mot de passe 'admin', laisse actif un seed dont le mot de
 *    passe a été changé, est idempotente et n'écrit rien dans t_outbox ;
 *  - verifySuperAdminPassword() (hierarchy.queries.ts) n'accepte plus le compte local par défaut.
 *
 * Base SQLite temporaire réelle (migrations de production via initDatabase), jamais la base réelle.
 */

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gest-in-situ-test-superadmin-defaut-'));

vi.mock('electron', () => ({
  app: { getPath: () => tmpDir, isPackaged: false },
  net: { online: true, request: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] }
}));

const mockGetSecureCurrentUser = vi.fn();
vi.mock('../src/main/auth/session-heartbeat', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/main/auth/session-heartbeat')>();
  return { ...actual, getSecureCurrentUser: (...args: any[]) => mockGetSecureCurrentUser(...args) };
});

describe('Compte superadmin par défaut + verifySuperAdminPassword', () => {
  let connection: typeof import('../src/main/database/connection');
  let schema: typeof import('../src/main/database/schema');
  let hierarchy: typeof import('../src/main/database/queries/hierarchy.queries');
  let localAuth: typeof import('../src/main/auth/local-auth');
  let db: import('better-sqlite3').Database;

  const seedRow = () => db.prepare("SELECT id_user, statut_actif, sync_id, password_hash FROM t_users WHERE login = 'superadmin'").get() as
    { id_user: number; statut_actif: number; sync_id: string | null; password_hash: string };
  const outboxCount = () => (db.prepare('SELECT COUNT(*) AS c FROM t_outbox').get() as { c: number }).c;
  const auditCount = () => (db.prepare("SELECT COUNT(*) AS c FROM t_audit_log WHERE action = 'SECURITE_COMPTE_DEFAUT_DESACTIVE'").get() as { c: number }).c;

  /** Simule un poste installé avant le correctif : seed actif au mot de passe 'admin'. */
  const restoreLegacySeed = (password = 'admin') => {
    db.prepare("UPDATE t_users SET statut_actif = 1, sync_id = NULL, password_hash = ? WHERE login = 'superadmin'")
      .run(localAuth.hashPassword(password));
  };

  beforeAll(async () => {
    connection = await import('../src/main/database/connection');
    schema = await import('../src/main/database/schema');
    hierarchy = await import('../src/main/database/queries/hierarchy.queries');
    localAuth = await import('../src/main/auth/local-auth');
    db = await connection.initDatabase();
  });

  afterAll(() => {
    connection.closeDatabase();
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    mockGetSecureCurrentUser.mockReturnValue(null);
  });

  describe('Poste neuf (migrateV1)', () => {
    it('crée la ligne seed désactivée, inutilisable avec le mot de passe par défaut, t_users non vide', () => {
      const row = seedRow();
      expect(row).toBeDefined();
      expect(row.id_user).toBe(1);
      expect(row.statut_actif).toBe(0);
      expect(localAuth.verifyPassword('admin', row.password_hash)).toBe(false);
      // Parcours poste neuf inchangé : app:checkFirstLaunch et le préchargement testent COUNT(*) > 0.
      const count = (db.prepare('SELECT COUNT(*) AS c FROM t_users').get() as { c: number }).c;
      expect(count).toBeGreaterThan(0);
    });

    it("refuse la connexion 'superadmin' / 'admin' (authenticateUser filtre statut_actif = 1)", async () => {
      const users = await import('../src/main/database/queries/users.queries');
      expect(await users.authenticateUser('superadmin', 'admin')).toBeNull();
    });
  });

  describe('Passe disableDefaultSuperadminAccounts', () => {
    it('désactive un seed resté au mot de passe par défaut, trace locale, aucun envoi cloud', () => {
      restoreLegacySeed('admin');
      const outboxBefore = outboxCount();
      const auditBefore = auditCount();

      const res = schema.disableDefaultSuperadminAccounts(db);

      expect(res).toEqual({ disabled: 1, keptActive: 0 });
      expect(seedRow().statut_actif).toBe(0);
      expect(auditCount()).toBe(auditBefore + 1);
      expect(outboxCount()).toBe(outboxBefore);
    });

    it('est idempotente (second passage sans effet)', () => {
      const auditBefore = auditCount();
      const res = schema.disableDefaultSuperadminAccounts(db);
      expect(res).toEqual({ disabled: 0, keptActive: 0 });
      expect(seedRow().statut_actif).toBe(0);
      expect(auditCount()).toBe(auditBefore);
    });

    it('laisse actif un seed dont le mot de passe a été changé', () => {
      restoreLegacySeed('Mot_De_Passe_Change_2026');
      const res = schema.disableDefaultSuperadminAccounts(db);
      expect(res).toEqual({ disabled: 0, keptActive: 1 });
      expect(seedRow().statut_actif).toBe(1);
    });

    it("ne touche pas un compte 'superadmin' synchronisé (sync_id non vide)", () => {
      db.prepare("UPDATE t_users SET statut_actif = 1, sync_id = 'cloud-superadmin', password_hash = ? WHERE login = 'superadmin'")
        .run(localAuth.hashPassword('admin'));
      const res = schema.disableDefaultSuperadminAccounts(db);
      expect(res).toEqual({ disabled: 0, keptActive: 0 });
      expect(seedRow().statut_actif).toBe(1);
    });

    it('est câblée dans runMigrations (démarrage sur base déjà à jour)', () => {
      restoreLegacySeed('admin');
      schema.runMigrations(db);
      expect(seedRow().statut_actif).toBe(0);
      expect(db.pragma('user_version', { simple: true })).toBe(schema.SCHEMA_VERSION);
    });
  });

  describe('verifySuperAdminPassword', () => {
    const SA_SYNCED = 8801;
    const SA_VIA_ROLES = 8802;
    const SA_SYNCED_INACTIVE = 8803;
    const SA_LOCAL = 8804;
    const SA_LEGACY_HASH = 8805;

    beforeAll(() => {
      const ins = db.prepare(`
        INSERT INTO t_users (id_user, login, password_hash, role, nom_user, statut_actif, site_id, sync_id)
        VALUES (?, ?, ?, ?, 'Test', ?, NULL, ?)
      `);
      ins.run(SA_SYNCED, 'sa.synced.test', localAuth.hashPassword('Bon_Mdp_Synced_1'), 'SUPER ADMIN', 1, 'sync-sa-8801');
      ins.run(SA_VIA_ROLES, 'sa.roles.test', localAuth.hashPassword('Bon_Mdp_Roles_2'), 'ADMINISTRATEUR_SITE', 1, 'sync-sa-8802');
      db.prepare('INSERT INTO t_user_roles (id_user, role) VALUES (?, ?)').run(SA_VIA_ROLES, 'SUPER ADMIN');
      ins.run(SA_SYNCED_INACTIVE, 'sa.inactive.test', localAuth.hashPassword('Mdp_Inactif_3'), 'SUPER ADMIN', 0, 'sync-sa-8803');
      ins.run(SA_LOCAL, 'sa.local.test', localAuth.hashPassword('Mdp_Local_4'), 'SUPER ADMIN', 1, null);
      ins.run(SA_LEGACY_HASH, 'sa.legacy.test', 'Mdp_En_Clair_5', 'SUPER ADMIN', 1, 'sync-sa-8805');
    });

    it('sans session : le compte seed par défaut désactivé est refusé', () => {
      restoreLegacySeed('admin');
      schema.disableDefaultSuperadminAccounts(db);
      expect(hierarchy.verifySuperAdminPassword('admin')).toBe(false);
    });

    it('sans session : un seed par défaut encore ACTIF (non synchronisé) est refusé aussi', () => {
      restoreLegacySeed('admin');
      expect(hierarchy.verifySuperAdminPassword('admin')).toBe(false);
      schema.disableDefaultSuperadminAccounts(db);
    });

    it('sans session : SUPER ADMIN actif et synchronisé accepté, mauvais mot de passe refusé', () => {
      expect(hierarchy.verifySuperAdminPassword('Bon_Mdp_Synced_1')).toBe(true);
      expect(hierarchy.verifySuperAdminPassword('Mauvais')).toBe(false);
      expect(hierarchy.verifySuperAdminPassword('')).toBe(false);
    });

    it('sans session : SUPER ADMIN accordé via t_user_roles accepté', () => {
      expect(hierarchy.verifySuperAdminPassword('Bon_Mdp_Roles_2')).toBe(true);
    });

    it('sans session : SUPER ADMIN désactivé, local non synchronisé ou à hash non-bcrypt refusés', () => {
      expect(hierarchy.verifySuperAdminPassword('Mdp_Inactif_3')).toBe(false);
      expect(hierarchy.verifySuperAdminPassword('Mdp_Local_4')).toBe(false);
      expect(hierarchy.verifySuperAdminPassword('Mdp_En_Clair_5')).toBe(false);
    });

    it('session SUPER ADMIN : seul le mot de passe du compte de la session est vérifié', () => {
      mockGetSecureCurrentUser.mockReturnValue({ id_user: SA_LOCAL, login: 'sa.local.test', role: 'SUPER ADMIN', site_id: null });
      expect(hierarchy.verifySuperAdminPassword('Mdp_Local_4')).toBe(true);
      expect(hierarchy.verifySuperAdminPassword('Bon_Mdp_Synced_1')).toBe(false);
    });

    it('session SUPER ADMIN sur un compte désactivé : refus', () => {
      mockGetSecureCurrentUser.mockReturnValue({ id_user: SA_SYNCED_INACTIVE, login: 'sa.inactive.test', role: 'SUPER ADMIN', site_id: null });
      expect(hierarchy.verifySuperAdminPassword('Mdp_Inactif_3')).toBe(false);
    });

    it('session ROOT failsafe (sans ligne t_users) : repli sur la règle stricte', () => {
      mockGetSecureCurrentUser.mockReturnValue({ id_user: 999999, login: 'ROOT', role: 'SUPER ADMIN', site_id: null });
      expect(hierarchy.verifySuperAdminPassword('Bon_Mdp_Synced_1')).toBe(true);
      expect(hierarchy.verifySuperAdminPassword('admin')).toBe(false);
    });

    it("session d'un autre rôle actif : règle stricte (pas de vérification du compte de session)", () => {
      mockGetSecureCurrentUser.mockReturnValue({ id_user: SA_LOCAL, login: 'sa.local.test', role: 'ADMINISTRATEUR_SITE', site_id: 1 });
      expect(hierarchy.verifySuperAdminPassword('Mdp_Local_4')).toBe(false);
      expect(hierarchy.verifySuperAdminPassword('Bon_Mdp_Synced_1')).toBe(true);
    });
  });
});
