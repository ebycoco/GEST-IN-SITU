import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * LOT 1 « sécurité des comptes agents » — src/main/database/queries/users.queries.ts.
 *
 * Teste les vraies fonctions createUser / updateUser / deleteUser / hardDeleteUser contre une
 * base SQLite TEMPORAIRE migrée par initDatabase() (même pattern que
 * tests/session-heartbeat-license-site.test.ts). Les modules réseau/sync sont mockés : aucune
 * écriture Supabase, aucun accès à la vraie base. Les handlers ipcMain ne sont pas testés
 * directement : ils transmettent getSecureCurrentUser() comme `caller`/`creator`, objet que
 * ces tests construisent à l'identique ({ id_user, role, site_id, login }).
 */

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gest-in-situ-test-users-lot1-'));

vi.mock('electron', () => ({
  app: { getPath: () => tmpDir, isPackaged: false },
  net: { online: true, request: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] }
}));
vi.mock('../src/main/sync/outbox.service', () => ({
  enqueueOutbox: vi.fn(),
  scheduleOutboxProcessing: vi.fn(),
  cancelPendingInsert: vi.fn(() => true) // compte « jamais synchronisé » : suppression physique locale
}));
vi.mock('../src/main/sync/network-monitor', () => ({
  networkMonitor: { getState: () => 'OFFLINE' }
}));
vi.mock('../src/main/sync/supabase-client', () => ({ getSupabaseClient: vi.fn() }));
vi.mock('../src/main/sync/presence.service', () => ({ recordPresenceLogin: vi.fn() }));
vi.mock('../src/main/utils/audit', () => ({ logAudit: vi.fn() }));

describe('LOT 1 — sécurité des comptes agents (users.queries)', () => {
  let connection: typeof import('../src/main/database/connection');
  let uq: typeof import('../src/main/database/queries/users.queries');
  let db: import('better-sqlite3').Database;

  const SITE_A = 801;
  const SITE_B = 802;
  let centreA: number;
  let centreB: number;

  type Row = { id_user: number; login: string; password_hash: string; role: string; site_id: number; nom_user: string; prenom_user: string; statut_actif: number; sync_id: string; is_dirty: number; centre_id: number | null };
  const row = (login: string) => db.prepare('SELECT * FROM t_users WHERE login = ?').get(login) as Row;
  const rolesOf = (id: number) => (db.prepare('SELECT role FROM t_user_roles WHERE id_user = ?').all(id) as { role: string }[]).map(r => r.role).sort();

  function mk(login: string, role: string, site: number, opts: { active?: number; centre?: number | null; roles?: string[] } = {}): Row {
    db.prepare(`INSERT INTO t_users (login, password_hash, role, nom_user, prenom_user, statut_actif, site_id, centre_id, sync_id, is_dirty)
                VALUES (?, 'HASH_' || ?, ?, 'Nom', 'Prenom', ?, ?, ?, ?, 0)`)
      .run(login, login, role, opts.active ?? 1, site, opts.centre ?? null, `sync-${login}`);
    const r = row(login);
    for (const x of opts.roles ?? [role]) db.prepare('INSERT INTO t_user_roles (id_user, role) VALUES (?, ?)').run(r.id_user, x);
    return r;
  }
  const caller = (u: Row) => ({ id_user: u.id_user, role: u.role, site_id: u.site_id, login: u.login });

  beforeAll(async () => {
    connection = await import('../src/main/database/connection');
    uq = await import('../src/main/database/queries/users.queries');
    db = await connection.initDatabase();
    db.prepare(`INSERT INTO t_sites (id, nom, code, is_active, is_permanent, sync_id) VALUES (?, 'SITE_A', 'SITE_A', 1, 1, 'site-sync-801')`).run(SITE_A);
    db.prepare(`INSERT INTO t_sites (id, nom, code, is_active, is_permanent, sync_id) VALUES (?, 'SITE_B', 'SITE_B', 1, 1, 'site-sync-802')`).run(SITE_B);
    centreA = Number(db.prepare(`INSERT INTO t_centres (site_id, nom, numero, sync_id) VALUES (?, 'CA', 1, 'centre-sync-801')`).run(SITE_A).lastInsertRowid);
    centreB = Number(db.prepare(`INSERT INTO t_centres (site_id, nom, numero, sync_id) VALUES (?, 'CB', 1, 'centre-sync-802')`).run(SITE_B).lastInsertRowid);
  });

  afterAll(() => {
    connection.closeDatabase();
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    db.prepare('DELETE FROM t_user_roles').run();
    db.prepare('DELETE FROM t_users').run();
  });

  // ───────────────────────────── createUser ─────────────────────────────
  describe('createUser', () => {
    it('création normale OK (non-régression)', () => {
      const adm = mk('adm.a', 'ADMINISTRATEUR_SITE', SITE_A);
      uq.createUser({ login: 'nouveau', password: 'secret1', roles: ['OPERATEUR_SAISIE'], nom_user: 'N', prenom_user: 'P', centre_id: centreA }, caller(adm));
      const r = row('nouveau');
      expect(r.site_id).toBe(SITE_A);
      expect(r.statut_actif).toBe(1);
      expect(rolesOf(r.id_user)).toEqual(['OPERATEUR_SAISIE']);
    });

    it.each([
      ['même casse', 'cible'],
      ['casse différente', 'CIBLE']
    ])('login existant (%s) = refus, compte existant INCHANGÉ', (_l, login) => {
      const adm = mk('adm.a', 'ADMINISTRATEUR_SITE', SITE_A);
      const before = mk('cible', 'OPERATEUR_SAISIE', SITE_A);
      expect(() => uq.createUser({ login, password: 'pirate1', roles: ['OPERATEUR_VERIFICATION'], nom_user: 'X', prenom_user: 'Y' }, caller(adm)))
        .toThrow('Ce login est déjà utilisé. Choisissez-en un autre.');
      expect(row('cible')).toEqual(before);
      expect(rolesOf(before.id_user)).toEqual(['OPERATEUR_SAISIE']);
    });

    it('login d\'un compte d\'un AUTRE site = refus, message sans fuite de site/rôle, compte inchangé', () => {
      const adm = mk('adm.a', 'ADMINISTRATEUR_SITE', SITE_A);
      const before = mk('agent.b', 'OPERATEUR_SAISIE', SITE_B);
      let msg = '';
      try { uq.createUser({ login: 'agent.b', password: 'pirate1', roles: ['OPERATEUR_SAISIE'] }, caller(adm)); } catch (e) { msg = (e as Error).message; }
      expect(msg).toBe('Ce login est déjà utilisé. Choisissez-en un autre.');
      expect(msg).not.toMatch(/SITE|OPERATEUR/i);
      expect(row('agent.b')).toEqual(before);
    });

    it('login d\'un SUPER ADMIN = refus, compte inchangé (hash, rôle, site, nom)', () => {
      const adm = mk('adm.a', 'ADMINISTRATEUR_SITE', SITE_A);
      const before = mk('root', 'SUPER ADMIN', SITE_B);
      expect(() => uq.createUser({ login: 'root', password: 'pirate1', roles: ['OPERATEUR_SAISIE'], nom_user: 'Hack' }, caller(adm)))
        .toThrow('déjà utilisé');
      expect(row('root')).toEqual(before);
      expect(rolesOf(before.id_user)).toEqual(['SUPER ADMIN']);
    });

    it('login d\'un compte DÉSACTIVÉ (statut 0) = refus aussi (pas d\'exception de réactivation)', () => {
      const adm = mk('adm.a', 'ADMINISTRATEUR_SITE', SITE_A);
      const before = mk('inactif', 'OPERATEUR_SAISIE', SITE_A, { active: 0 });
      expect(() => uq.createUser({ login: 'inactif', password: 'pirate1', roles: ['OPERATEUR_SAISIE'] }, caller(adm))).toThrow('déjà utilisé');
      expect(row('inactif')).toEqual(before);
    });

    it('login supprimé (soft-delete statut -1 / is_dirty -1) = recréable', () => {
      const adm = mk('adm.a', 'ADMINISTRATEUR_SITE', SITE_A);
      // LOT 1b (P2-1) : la ligne supprimée doit être du MÊME site que l'appelant non SUPER ADMIN
      // (le cas cross-site est désormais refusé, cf. users-security-lot1b.test.ts).
      mk('supprime', 'OPERATEUR_SAISIE', SITE_A, { active: -1 });
      db.prepare("UPDATE t_users SET is_dirty = -1 WHERE login = 'supprime'").run();
      uq.createUser({ login: 'supprime', password: 'neuf123', roles: ['OPERATEUR_VERIFICATION'], nom_user: 'Neuf', prenom_user: 'Compte' }, caller(adm));
      const r = row('supprime');
      expect(r.statut_actif).toBe(1);
      expect(r.site_id).toBe(SITE_A);
      expect(r.role).toBe('OPERATEUR_VERIFICATION');
      expect(r.is_dirty).toBe(1);
      expect(r.password_hash).not.toBe('HASH_supprime');
      expect(rolesOf(r.id_user)).toEqual(['OPERATEUR_VERIFICATION']);
    });
  });

  // ───────────────────────────── updateUser ─────────────────────────────
  describe('updateUser — élévation de privilèges / colonnes', () => {
    it('data.role = SUPER ADMIN sans roles[] par ADMINISTRATEUR_SITE = refus', () => {
      const adm = mk('adm.a', 'ADMINISTRATEUR_SITE', SITE_A);
      const t = mk('ag', 'OPERATEUR_SAISIE', SITE_A);
      expect(() => uq.updateUser(t.id_user, { role: 'SUPER ADMIN' }, caller(adm))).toThrow('SUPER ADMIN');
      expect(row('ag').role).toBe('OPERATEUR_SAISIE');
      // auto-attribution
      expect(() => uq.updateUser(adm.id_user, { role: 'SUPER ADMIN' }, caller(adm))).toThrow('SUPER ADMIN');
      expect(row('adm.a').role).toBe('ADMINISTRATEUR_SITE');
    });

    it('ajout de SUPER ADMIN ou ADMINISTRATEUR_SITE à un tiers via roles[] = refus', () => {
      const adm = mk('adm.a', 'ADMINISTRATEUR_SITE', SITE_A);
      const t = mk('ag', 'OPERATEUR_SAISIE', SITE_A);
      expect(() => uq.updateUser(t.id_user, { roles: ['OPERATEUR_SAISIE', 'SUPER ADMIN'] }, caller(adm))).toThrow('SUPER ADMIN');
      expect(() => uq.updateUser(t.id_user, { roles: ['ADMINISTRATEUR_SITE'], role: 'ADMINISTRATEUR_SITE' }, caller(adm))).toThrow('ADMINISTRATEUR_SITE');
      expect(rolesOf(t.id_user)).toEqual(['OPERATEUR_SAISIE']);
      expect(row('ag').role).toBe('OPERATEUR_SAISIE');
    });

    it('un rôle déjà détenu n\'est jamais refusé, mais SUPER ADMIN reste non ajoutable même avec lui', () => {
      const adm = mk('adm.a', 'ADMINISTRATEUR_SITE', SITE_A);
      expect(() => uq.updateUser(adm.id_user, { roles: ['ADMINISTRATEUR_SITE', 'SUPER ADMIN'] }, caller(adm))).toThrow('SUPER ADMIN');
    });

    it('auto-modification de l\'ADMINISTRATEUR_SITE (nom/prénom) avec roles:[ADMINISTRATEUR_SITE] = OK', () => {
      const adm = mk('adm.a', 'ADMINISTRATEUR_SITE', SITE_A);
      uq.updateUser(adm.id_user, { login: 'adm.a', role: 'ADMINISTRATEUR_SITE', roles: ['ADMINISTRATEUR_SITE'], nom_user: 'Nouveau', prenom_user: 'Nom' }, caller(adm));
      const r = row('adm.a');
      expect(r.nom_user).toBe('Nouveau');
      expect(r.prenom_user).toBe('Nom');
      expect(rolesOf(adm.id_user)).toEqual(['ADMINISTRATEUR_SITE']);
    });

    it('site_id : ADMINISTRATEUR_SITE vers autre site = refus (valeur inchangée) ; valeur identique ignorée', () => {
      const adm = mk('adm.a', 'ADMINISTRATEUR_SITE', SITE_A);
      const t = mk('ag', 'OPERATEUR_SAISIE', SITE_A);
      expect(() => uq.updateUser(t.id_user, { site_id: SITE_B }, caller(adm))).toThrow('SUPER ADMIN');
      expect(row('ag').site_id).toBe(SITE_A);
      uq.updateUser(t.id_user, { site_id: SITE_A, nom_user: 'Ok' }, caller(adm));
      expect(row('ag').site_id).toBe(SITE_A);
      expect(row('ag').nom_user).toBe('Ok');
    });

    it('site_id : SUPER ADMIN vers site existant = OK, vers site inexistant = refus', () => {
      const sa = mk('root', 'SUPER ADMIN', SITE_A);
      const t = mk('ag', 'OPERATEUR_SAISIE', SITE_A);
      uq.updateUser(t.id_user, { site_id: SITE_B }, caller(sa));
      expect(row('ag').site_id).toBe(SITE_B);
      expect(() => uq.updateUser(t.id_user, { site_id: 99999 }, caller(sa))).toThrow('Site cible introuvable');
      expect(row('ag').site_id).toBe(SITE_B);
    });

    it('sync_id / is_dirty / last_login non modifiables par l\'appelant', () => {
      const adm = mk('adm.a', 'ADMINISTRATEUR_SITE', SITE_A);
      const t = mk('ag', 'OPERATEUR_SAISIE', SITE_A);
      uq.updateUser(t.id_user, { sync_id: 'pirate', is_dirty: 0, last_login: '2000-01-01', nom_user: 'Seul' }, caller(adm));
      const r = row('ag');
      expect(r.sync_id).toBe('sync-ag');
      expect(r.is_dirty).toBe(1); // forcé par la requête, pas par l'appelant
      expect((db.prepare('SELECT last_login FROM t_users WHERE login = ?').get('ag') as { last_login: string | null }).last_login).toBeNull();
      expect(r.nom_user).toBe('Seul');
    });

    it('login vers un login déjà pris (casse différente incluse) = refus ; login inchangé OK', () => {
      const adm = mk('adm.a', 'ADMINISTRATEUR_SITE', SITE_A);
      const t = mk('ag', 'OPERATEUR_SAISIE', SITE_A);
      mk('autre', 'OPERATEUR_SAISIE', SITE_B);
      expect(() => uq.updateUser(t.id_user, { login: 'AUTRE' }, caller(adm))).toThrow('déjà utilisé');
      expect(() => uq.updateUser(t.id_user, { login: 'autre' }, caller(adm))).toThrow('déjà utilisé');
      expect(row('ag')).toBeTruthy();
      uq.updateUser(t.id_user, { login: 'ag', nom_user: 'Meme' }, caller(adm));
      expect(row('ag').nom_user).toBe('Meme');
      uq.updateUser(t.id_user, { login: 'ag.renomme' }, caller(adm));
      expect(row('ag.renomme')).toBeTruthy();
    });

    it('centre d\'un autre site par ADMINISTRATEUR_SITE = refus ; centre du site = OK', () => {
      const adm = mk('adm.a', 'ADMINISTRATEUR_SITE', SITE_A);
      const t = mk('ag', 'OPERATEUR_SAISIE', SITE_A);
      expect(() => uq.updateUser(t.id_user, { centre_id: centreB }, caller(adm))).toThrow("n'appartient pas à votre site");
      expect(row('ag').centre_id).toBeNull();
      uq.updateUser(t.id_user, { centre_id: centreA }, caller(adm));
      expect(row('ag').centre_id).toBe(centreA);
    });

    it('non-régression : update nom/prénom/centre/rôles OK', () => {
      const adm = mk('adm.a', 'ADMINISTRATEUR_SITE', SITE_A);
      const t = mk('ag', 'OPERATEUR_SAISIE', SITE_A);
      uq.updateUser(t.id_user, { nom_user: 'N2', prenom_user: 'P2', centre_id: centreA, roles: ['OPERATEUR_VERIFICATION', 'OPERATEUR_QUALITE'] }, caller(adm));
      const r = row('ag');
      expect(r.nom_user).toBe('N2');
      expect(r.prenom_user).toBe('P2');
      expect(r.role).toBe('OPERATEUR_VERIFICATION');
      expect(rolesOf(t.id_user)).toEqual(['OPERATEUR_QUALITE', 'OPERATEUR_VERIFICATION']);
    });

    it('roles:[] refusé (plus d\'effacement silencieux des rôles)', () => {
      const adm = mk('adm.a', 'ADMINISTRATEUR_SITE', SITE_A);
      const t = mk('ag', 'OPERATEUR_SAISIE', SITE_A);
      expect(() => uq.updateUser(t.id_user, { roles: [] }, caller(adm))).toThrow('Au moins un rôle');
      expect(rolesOf(t.id_user)).toEqual(['OPERATEUR_SAISIE']);
    });

    it('cible d\'un autre site = toujours refusée (garde existante conservée)', () => {
      const adm = mk('adm.a', 'ADMINISTRATEUR_SITE', SITE_A);
      const t = mk('ag.b', 'OPERATEUR_SAISIE', SITE_B);
      expect(() => uq.updateUser(t.id_user, { nom_user: 'X' }, caller(adm))).toThrow('Accès non autorisé aux données de ce site');
    });
  });

  describe('auto-désactivation / dernier administrateur', () => {
    it('auto-désactivation via updateUser (statut_actif=0) = refus ; auto-suppression = refus', () => {
      const adm = mk('adm.a', 'ADMINISTRATEUR_SITE', SITE_A);
      mk('adm.a2', 'ADMINISTRATEUR_SITE', SITE_A);
      expect(() => uq.updateUser(adm.id_user, { statut_actif: 0 }, caller(adm))).toThrow('propre compte');
      expect(() => uq.deleteUser(adm.id_user, caller(adm))).toThrow('propre compte');
      expect(() => uq.hardDeleteUser(adm.id_user, caller(adm))).toThrow('propre compte');
      expect(row('adm.a').statut_actif).toBe(1);
    });

    it('SUPER ADMIN ne peut pas non plus se désactiver lui-même', () => {
      const sa = mk('root', 'SUPER ADMIN', SITE_A);
      expect(() => uq.updateUser(sa.id_user, { statut_actif: 0 }, caller(sa))).toThrow('propre compte');
    });

    it('dernier ADMINISTRATEUR_SITE actif : non désactivable (update / delete) ni supprimable par un ADMIN_CENTRE/ADMINISTRATEUR_SITE', () => {
      const lastAdm = mk('adm.seul', 'ADMINISTRATEUR_SITE', SITE_A);
      // LOT 1b (P1-3) : un ADMIN_CENTRE ne peut plus viser un administrateur de site du tout (refus
      // plus précoce) ; la garde « dernier administrateur » est donc exercée via un appelant
      // ADMINISTRATEUR_SITE (session distincte du compte cible, comme le test hardDelete ci-dessous).
      const ac = { id_user: 999998, role: 'ADMINISTRATEUR_SITE', site_id: SITE_A, login: 'x' };
      expect(() => uq.updateUser(lastAdm.id_user, { statut_actif: 0 }, ac)).toThrow('dernier administrateur');
      expect(() => uq.updateUser(lastAdm.id_user, { roles: ['OPERATEUR_SAISIE'] }, ac)).toThrow('dernier administrateur');
      expect(row('adm.seul').statut_actif).toBe(1);
      expect(rolesOf(lastAdm.id_user)).toEqual(['ADMINISTRATEUR_SITE']);
    });

    it('dernier admin avec un second compte ADMINISTRATEUR_SITE d\'un site tiers ou inactif : toujours "dernier"', () => {
      const lastAdm = mk('adm.seul', 'ADMINISTRATEUR_SITE', SITE_A);
      mk('adm.b', 'ADMINISTRATEUR_SITE', SITE_B);
      mk('adm.inactif', 'ADMINISTRATEUR_SITE', SITE_A, { active: 0 });
      const ac = { id_user: 999998, role: 'ADMINISTRATEUR_SITE', site_id: SITE_A, login: 'x' }; // cf. LOT 1b (P1-3)
      expect(() => uq.updateUser(lastAdm.id_user, { statut_actif: 0 }, ac)).toThrow('dernier administrateur');
    });

    it('avec un autre administrateur actif présent : désactivation OK (update) et suppression OK', () => {
      const a1 = mk('adm.1', 'ADMINISTRATEUR_SITE', SITE_A);
      const a2 = mk('adm.2', 'ADMINISTRATEUR_SITE', SITE_A);
      uq.updateUser(a2.id_user, { statut_actif: 0 }, caller(a1));
      expect(row('adm.2').statut_actif).toBe(0);
      // a2 désormais inactif : a1 est le dernier admin actif, mais un ADMINISTRATEUR_SITE ne peut
      // viser que d'autres comptes (auto-garde) — réactivation puis suppression de a2 OK.
      uq.updateUser(a2.id_user, { statut_actif: 1 }, caller(a1));
      expect(row('adm.2').statut_actif).toBe(1);
      uq.deleteUser(a2.id_user, caller(a1));
      expect(row('adm.2').statut_actif).toBe(0);
    });

    it('SUPER ADMIN peut désactiver / supprimer le dernier administrateur d\'un site (support)', () => {
      const sa = mk('root', 'SUPER ADMIN', SITE_B);
      const lastAdm = mk('adm.seul', 'ADMINISTRATEUR_SITE', SITE_A);
      uq.updateUser(lastAdm.id_user, { statut_actif: 0 }, caller(sa));
      expect(row('adm.seul').statut_actif).toBe(0);
      uq.updateUser(lastAdm.id_user, { statut_actif: 1 }, caller(sa));
      uq.deleteUser(lastAdm.id_user, caller(sa));
      expect(row('adm.seul').statut_actif).toBe(0);
    });

    it('non-régression : désactivation / réactivation / suppression d\'un agent normal OK', () => {
      const adm = mk('adm.a', 'ADMINISTRATEUR_SITE', SITE_A);
      const t = mk('ag', 'OPERATEUR_SAISIE', SITE_A);
      uq.updateUser(t.id_user, { statut_actif: 0 }, caller(adm));
      expect(row('ag').statut_actif).toBe(0);
      uq.updateUser(t.id_user, { statut_actif: 1 }, caller(adm));
      expect(row('ag').statut_actif).toBe(1);
      uq.deleteUser(t.id_user, caller(adm));
      expect(row('ag').statut_actif).toBe(0);
      uq.hardDeleteUser(t.id_user, caller(adm));
      expect(db.prepare('SELECT 1 FROM t_users WHERE login = ?').get('ag')).toBeUndefined();
    });

    it('dernier admin supprimé définitivement par un autre rôle non SUPER ADMIN : refusé (hardDelete)', () => {
      const lastAdm = mk('adm.seul', 'ADMINISTRATEUR_SITE', SITE_A);
      // Appelant ADMINISTRATEUR_SITE d'un autre compte multi-rôles simulé : caller sans être admin actif
      const fake = { id_user: 999999, role: 'ADMINISTRATEUR_SITE', site_id: SITE_A, login: 'x' };
      expect(() => uq.hardDeleteUser(lastAdm.id_user, fake)).toThrow('dernier administrateur');
      expect(row('adm.seul').statut_actif).toBe(1);
    });
  });
});
