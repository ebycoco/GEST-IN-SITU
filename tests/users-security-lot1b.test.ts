import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * LOT 1b « correctifs de l'audit sécurité des comptes agents » — src/main/database/queries/users.queries.ts.
 *
 * Cas d'attaque P0-1 / P1-1 / P1-2 / P1-3 / P2-1 / P2-2 / P2-3 contre une base SQLite TEMPORAIRE
 * migrée par initDatabase() (même pattern que tests/users-security-lot1.test.ts). Modules
 * réseau/sync mockés : aucune écriture Supabase, aucun accès à la vraie base. Le `caller` imite
 * getSecureCurrentUser() ({ id_user, role, site_id, centre_id, login }).
 */

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gest-in-situ-test-users-lot1b-'));

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

describe('LOT 1b — correctifs audit sécurité des comptes agents (users.queries)', () => {
  let connection: typeof import('../src/main/database/connection');
  let uq: typeof import('../src/main/database/queries/users.queries');
  let db: import('better-sqlite3').Database;

  const SITE_A = 811;
  const SITE_B = 812;
  let centreA: number;
  let centreA2: number;

  type Row = { id_user: number; login: string; password_hash: string; role: string; site_id: number; nom_user: string; prenom_user: string; statut_actif: number; sync_id: string; is_dirty: number; centre_id: number | null };
  const row = (login: string) => db.prepare('SELECT * FROM t_users WHERE login = ?').get(login) as Row;
  const count = () => (db.prepare('SELECT COUNT(*) AS n FROM t_users').get() as { n: number }).n;
  const rolesOf = (id: number) => (db.prepare('SELECT role FROM t_user_roles WHERE id_user = ?').all(id) as { role: string }[]).map(r => r.role).sort();

  function mk(login: string, role: string, site: number, opts: { active?: number; centre?: number | null; roles?: string[] } = {}): Row {
    db.prepare(`INSERT INTO t_users (login, password_hash, role, nom_user, prenom_user, statut_actif, site_id, centre_id, sync_id, is_dirty)
                VALUES (?, 'HASH_' || ?, ?, 'Nom', 'Prenom', ?, ?, ?, ?, 0)`)
      .run(login, login, role, opts.active ?? 1, site, opts.centre ?? null, `sync-${login}`);
    const r = row(login);
    for (const x of opts.roles ?? [role]) db.prepare('INSERT INTO t_user_roles (id_user, role) VALUES (?, ?)').run(r.id_user, x);
    return r;
  }
  const caller = (u: Row) => ({ id_user: u.id_user, role: u.role, site_id: u.site_id, centre_id: u.centre_id ?? undefined, login: u.login });

  beforeAll(async () => {
    connection = await import('../src/main/database/connection');
    uq = await import('../src/main/database/queries/users.queries');
    db = await connection.initDatabase();
    db.prepare(`INSERT INTO t_sites (id, nom, code, is_active, is_permanent, sync_id) VALUES (?, 'SITE_A', 'SITE_A', 1, 1, 'site-sync-811')`).run(SITE_A);
    db.prepare(`INSERT INTO t_sites (id, nom, code, is_active, is_permanent, sync_id) VALUES (?, 'SITE_B', 'SITE_B', 1, 1, 'site-sync-812')`).run(SITE_B);
    centreA = Number(db.prepare(`INSERT INTO t_centres (site_id, nom, numero, sync_id) VALUES (?, 'CA', 1, 'centre-sync-811')`).run(SITE_A).lastInsertRowid);
    centreA2 = Number(db.prepare(`INSERT INTO t_centres (site_id, nom, numero, sync_id) VALUES (?, 'CA2', 2, 'centre-sync-811b')`).run(SITE_A).lastInsertRowid);
  });

  afterAll(() => {
    connection.closeDatabase();
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    db.prepare('DELETE FROM t_logs').run(); // journaux (FK vers t_users) écrits par resetAgentPassword / hardDelete
    db.prepare('DELETE FROM t_user_roles').run();
    db.prepare('DELETE FROM t_users').run();
  });

  // ─────────────── P0-1 : rôle principal de createUser ───────────────
  describe('P0-1 createUser — rôle principal validé', () => {
    it.each([['ADMIN_CENTRE'], ['ADMINISTRATEUR_SITE']])('%s : role SUPER ADMIN + roles [SAISIE] = refus, aucun compte créé', (r) => {
      const c = r === 'ADMIN_CENTRE' ? mk('c', r, SITE_A, { centre: centreA }) : mk('c', r, SITE_A);
      const n = count();
      expect(() => uq.createUser({ login: 'pirate', password: 'x12345', role: 'SUPER ADMIN', roles: ['OPERATEUR_SAISIE'] }, caller(c))).toThrow();
      expect(count()).toBe(n);
    });
    it('role absent de roles[] = refus (même rôle assignable)', () => {
      const adm = mk('adm', 'ADMINISTRATEUR_SITE', SITE_A);
      const n = count();
      expect(() => uq.createUser({ login: 'x', password: 'x12345', role: 'OPERATEUR_QUALITE', roles: ['OPERATEUR_SAISIE'] }, caller(adm))).toThrow('rôle principal');
      expect(count()).toBe(n);
    });
    it('création normale (role = roles[0]) OK', () => {
      const adm = mk('adm', 'ADMINISTRATEUR_SITE', SITE_A);
      uq.createUser({ login: 'ok', password: 'x12345', role: 'OPERATEUR_SAISIE', roles: ['OPERATEUR_SAISIE', 'OPERATEUR_QUALITE'] }, caller(adm));
      expect(row('ok').role).toBe('OPERATEUR_SAISIE');
      expect(rolesOf(row('ok').id_user)).toEqual(['OPERATEUR_QUALITE', 'OPERATEUR_SAISIE']);
    });
  });

  // ─────────────── P1-1 : cible SUPER ADMIN ───────────────
  describe('P1-1 cible SUPER ADMIN', () => {
    const MSG = 'Accès non autorisé aux données de ce site';
    const attacks = (target: Row, c: ReturnType<typeof caller>) => {
      expect(() => uq.updateUser(target.id_user, { password: 'pirate1' }, c)).toThrow(MSG);
      expect(() => uq.updateUser(target.id_user, { statut_actif: 0 }, c)).toThrow(MSG);
      expect(() => uq.updateUser(target.id_user, { roles: ['OPERATEUR_SAISIE'] }, c)).toThrow(MSG);
      expect(() => uq.deleteUser(target.id_user, c)).toThrow(MSG);
      expect(() => uq.hardDeleteUser(target.id_user, c)).toThrow(MSG);
      expect(() => uq.resetAgentPassword(target.id_user, c)).toThrow(MSG);
    };
    it('ADMINISTRATEUR_SITE sur un SUPER ADMIN du même site (colonne role) = refus, compte inchangé', () => {
      const sa = mk('sa', 'SUPER ADMIN', SITE_A);
      const adm = mk('adm', 'ADMINISTRATEUR_SITE', SITE_A);
      attacks(sa, caller(adm));
      expect(row('sa')).toEqual(sa);
      expect(rolesOf(sa.id_user)).toEqual(['SUPER ADMIN']);
    });
    it('cible détenant SUPER ADMIN seulement via t_user_roles = refus', () => {
      const sa = mk('sa2', 'OPERATEUR_SAISIE', SITE_A, { roles: ['OPERATEUR_SAISIE', 'SUPER ADMIN'] });
      const adm = mk('adm', 'ADMINISTRATEUR_SITE', SITE_A);
      attacks(sa, caller(adm));
      expect(row('sa2')).toEqual(sa);
    });
    it('ADMIN_CENTRE sur un SUPER ADMIN du même site (même centre) = refus', () => {
      const sa = mk('sa', 'SUPER ADMIN', SITE_A, { centre: centreA });
      const ac = mk('ac', 'ADMIN_CENTRE', SITE_A, { centre: centreA });
      expect(() => uq.updateUser(sa.id_user, { password: 'pirate1' }, caller(ac))).toThrow(MSG);
      expect(() => uq.updateUser(sa.id_user, { statut_actif: 0 }, caller(ac))).toThrow(MSG);
      expect(() => uq.updateUser(sa.id_user, { roles: ['OPERATEUR_SAISIE'] }, caller(ac))).toThrow(MSG);
      expect(row('sa')).toEqual(sa);
    });
    it('SUPER ADMIN sur SUPER ADMIN = OK', () => {
      const sa = mk('sa', 'SUPER ADMIN', SITE_A);
      const sa2 = mk('sa2', 'SUPER ADMIN', SITE_A);
      uq.updateUser(sa2.id_user, { nom_user: 'Modifie' }, caller(sa));
      expect(row('sa2').nom_user).toBe('Modifie');
      expect(uq.resetAgentPassword(sa2.id_user, caller(sa)).success).toBe(true);
    });
  });

  // ─────────────── P1-2 : statut_actif ───────────────
  describe('P1-2 statut_actif strict', () => {
    it.each([['"0x1"', '0x1'], ['"0b1"', '0b1'], ['"1e0"', '1e0'], ['" 1"', ' 1'], ['null', null], ['true', true], ['2', 2], ['-1', -1], ['"1"', '1'], ['1.5', 1.5]])('statut_actif %s = refus, compte inchangé', (_l, v) => {
      const adm = mk('adm', 'ADMINISTRATEUR_SITE', SITE_A);
      const ag = mk('ag', 'OPERATEUR_SAISIE', SITE_A);
      expect(() => uq.updateUser(ag.id_user, { statut_actif: v }, caller(adm))).toThrow('Valeur de statut invalide');
      expect(row('ag')).toEqual(ag);
    });
    it('0 puis 1 = OK', () => {
      const adm = mk('adm', 'ADMINISTRATEUR_SITE', SITE_A);
      const ag = mk('ag', 'OPERATEUR_SAISIE', SITE_A);
      uq.updateUser(ag.id_user, { statut_actif: 0 }, caller(adm));
      expect(row('ag').statut_actif).toBe(0);
      uq.updateUser(ag.id_user, { statut_actif: 1 }, caller(adm));
      expect(row('ag').statut_actif).toBe(1);
    });
    it('auto-désactivation avec "0x1" = refus ; avec 0 = refus (propre compte)', () => {
      const adm = mk('adm', 'ADMINISTRATEUR_SITE', SITE_A);
      mk('adm2', 'ADMINISTRATEUR_SITE', SITE_A);
      expect(() => uq.updateUser(adm.id_user, { statut_actif: '0x1' }, caller(adm))).toThrow('Valeur de statut invalide');
      expect(() => uq.updateUser(adm.id_user, { statut_actif: 0 }, caller(adm))).toThrow('propre compte');
      expect(row('adm').statut_actif).toBe(1);
    });
  });

  // ─────────────── P1-3 : ADMIN_CENTRE ───────────────
  describe('P1-3 ADMIN_CENTRE cantonné à son centre', () => {
    const MSG = 'Accès non autorisé aux données de ce site';
    it('agent d\'un autre centre du même site = refus, inchangé', () => {
      const ac = mk('ac', 'ADMIN_CENTRE', SITE_A, { centre: centreA });
      const ag = mk('ag', 'OPERATEUR_SAISIE', SITE_A, { centre: centreA2 });
      expect(() => uq.updateUser(ag.id_user, { nom_user: 'X' }, caller(ac))).toThrow(MSG);
      expect(() => uq.updateUser(ag.id_user, { password: 'pirate1' }, caller(ac))).toThrow(MSG);
      expect(row('ag')).toEqual(ag);
    });
    it('administrateur de site et autre ADMIN_CENTRE du même centre = refus', () => {
      const ac = mk('ac', 'ADMIN_CENTRE', SITE_A, { centre: centreA });
      const adm = mk('adm', 'ADMINISTRATEUR_SITE', SITE_A, { centre: centreA });
      const ac2 = mk('ac2', 'ADMIN_CENTRE', SITE_A, { centre: centreA });
      expect(() => uq.updateUser(adm.id_user, { password: 'pirate1' }, caller(ac))).toThrow(MSG);
      expect(() => uq.updateUser(ac2.id_user, { statut_actif: 0 }, caller(ac))).toThrow(MSG);
      expect(row('adm')).toEqual(adm);
      expect(row('ac2')).toEqual(ac2);
    });
    it('caller sans centre_id = refus', () => {
      const ac = mk('ac', 'ADMIN_CENTRE', SITE_A);
      const ag = mk('ag', 'OPERATEUR_SAISIE', SITE_A);
      expect(() => uq.updateUser(ag.id_user, { nom_user: 'X' }, caller(ac))).toThrow(MSG);
    });
    it('déplacement vers un autre centre refusé ; centre vide forcé au centre de l\'appelant', () => {
      const ac = mk('ac', 'ADMIN_CENTRE', SITE_A, { centre: centreA });
      const ag = mk('ag', 'OPERATEUR_SAISIE', SITE_A, { centre: centreA });
      expect(() => uq.updateUser(ag.id_user, { centre_id: centreA2 }, caller(ac))).toThrow('doit rester dans votre centre');
      expect(row('ag').centre_id).toBe(centreA);
      uq.updateUser(ag.id_user, { centre_id: null, nom_user: 'N2' }, caller(ac));
      expect(row('ag').centre_id).toBe(centreA);
      expect(row('ag').nom_user).toBe('N2');
    });
    it('agent de son centre = OK (nom/rôles/statut)', () => {
      const ac = mk('ac', 'ADMIN_CENTRE', SITE_A, { centre: centreA });
      const ag = mk('ag', 'OPERATEUR_SAISIE', SITE_A, { centre: centreA });
      uq.updateUser(ag.id_user, { nom_user: 'Nouveau', roles: ['OPERATEUR_QUALITE'], statut_actif: 0 }, caller(ac));
      expect(row('ag').nom_user).toBe('Nouveau');
      expect(row('ag').statut_actif).toBe(0);
      expect(rolesOf(ag.id_user)).toEqual(['OPERATEUR_QUALITE']);
    });
    it('createUser par ADMIN_CENTRE : centre et site forcés à ceux de l\'appelant', () => {
      const ac = mk('ac', 'ADMIN_CENTRE', SITE_A, { centre: centreA });
      uq.createUser({ login: 'nouv', password: 'x12345', roles: ['OPERATEUR_SAISIE'], centre_id: centreA2, site_id: SITE_B }, caller(ac));
      expect(row('nouv').centre_id).toBe(centreA);
      expect(row('nouv').site_id).toBe(SITE_A);
    });
  });

  // ─────────────── P2-1 : recréation d'une ligne supprimée ───────────────
  describe('P2-1 recréation de login supprimé (-1)', () => {
    it('ligne -1 d\'un autre site = refus générique, ligne inchangée', () => {
      const adm = mk('adm', 'ADMINISTRATEUR_SITE', SITE_A);
      const old = mk('vieux', 'OPERATEUR_SAISIE', SITE_B, { active: -1 });
      expect(() => uq.createUser({ login: 'vieux', password: 'x12345', roles: ['OPERATEUR_SAISIE'] }, caller(adm))).toThrow('Ce login est déjà utilisé');
      expect(row('vieux')).toEqual(old);
    });
    it('ligne -1 ayant détenu SUPER ADMIN = refus pour un non-SUPER ADMIN', () => {
      const adm = mk('adm', 'ADMINISTRATEUR_SITE', SITE_A);
      const old = mk('ex.sa', 'SUPER ADMIN', SITE_A, { active: -1 });
      expect(() => uq.createUser({ login: 'ex.sa', password: 'x12345', roles: ['OPERATEUR_SAISIE'] }, caller(adm))).toThrow('Ce login est déjà utilisé');
      expect(row('ex.sa')).toEqual(old);
    });
    it('ligne -1 du même site = recréée ; SUPER ADMIN peut recréer une ligne d\'un autre site', () => {
      const adm = mk('adm', 'ADMINISTRATEUR_SITE', SITE_A);
      mk('vieux', 'OPERATEUR_SAISIE', SITE_A, { active: -1 });
      uq.createUser({ login: 'vieux', password: 'x12345', roles: ['OPERATEUR_SAISIE'] }, caller(adm));
      expect(row('vieux').statut_actif).toBe(1);
      const sa = mk('sa', 'SUPER ADMIN', SITE_A);
      mk('vieux2', 'OPERATEUR_SAISIE', SITE_B, { active: -1 });
      uq.createUser({ login: 'vieux2', password: 'x12345', roles: ['OPERATEUR_SAISIE'], site_id: SITE_A }, caller(sa));
      expect(row('vieux2').statut_actif).toBe(1);
    });
    it('plusieurs lignes -1 équivalentes : login strictement identique réutilisé, sinon refus propre', () => {
      const adm = mk('adm', 'ADMINISTRATEUR_SITE', SITE_A);
      mk('Dup', 'OPERATEUR_SAISIE', SITE_A, { active: -1 });
      mk('dup', 'OPERATEUR_SAISIE', SITE_A, { active: -1 });
      expect(() => uq.createUser({ login: 'DUP', password: 'x12345', roles: ['OPERATEUR_SAISIE'] }, caller(adm))).toThrow('Ce login est déjà utilisé');
      uq.createUser({ login: 'dup', password: 'x12345', roles: ['OPERATEUR_SAISIE'] }, caller(adm));
      expect(row('dup').statut_actif).toBe(1);
      expect(row('Dup').statut_actif).toBe(-1);
    });
  });

  // ─────────────── P2-2 : logins ───────────────
  describe('P2-2 normalisation des logins', () => {
    it('espaces début/fin : refus de doublon, et login stocké trimé', () => {
      const adm = mk('adm', 'ADMINISTRATEUR_SITE', SITE_A);
      mk('jean', 'OPERATEUR_SAISIE', SITE_A);
      expect(() => uq.createUser({ login: '  jean ', password: 'x12345', roles: ['OPERATEUR_SAISIE'] }, caller(adm))).toThrow('Ce login est déjà utilisé');
      uq.createUser({ login: '  marie ', password: 'x12345', roles: ['OPERATEUR_SAISIE'] }, caller(adm));
      expect(row('marie')).toBeTruthy();
    });
    it('« É » vs « é » et NFC vs NFD = doublon refusé (create et update)', () => {
      const adm = mk('adm', 'ADMINISTRATEUR_SITE', SITE_A);
      mk('Élodie', 'OPERATEUR_SAISIE', SITE_A);
      const autre = mk('autre', 'OPERATEUR_SAISIE', SITE_A);
      expect(() => uq.createUser({ login: 'élodie', password: 'x12345', roles: ['OPERATEUR_SAISIE'] }, caller(adm))).toThrow('Ce login est déjà utilisé');
      expect(() => uq.createUser({ login: 'Élodie', password: 'x12345', roles: ['OPERATEUR_SAISIE'] }, caller(adm))).toThrow('Ce login est déjà utilisé');
      expect(() => uq.updateUser(autre.id_user, { login: 'ÉLODIE' }, caller(adm))).toThrow('Ce login est déjà utilisé');
      expect(row('autre').login).toBe('autre');
    });
    it('login vide après trim = refus (create et update)', () => {
      const adm = mk('adm', 'ADMINISTRATEUR_SITE', SITE_A);
      const ag = mk('ag', 'OPERATEUR_SAISIE', SITE_A);
      const n = count();
      expect(() => uq.createUser({ login: '   ', password: 'x12345', roles: ['OPERATEUR_SAISIE'] }, caller(adm))).toThrow('login est obligatoire');
      expect(count()).toBe(n);
      expect(() => uq.updateUser(ag.id_user, { login: '  ' }, caller(adm))).toThrow('login est obligatoire');
      expect(row('ag').login).toBe('ag');
    });
    it('changement de login valide (trimé) OK', () => {
      const adm = mk('adm', 'ADMINISTRATEUR_SITE', SITE_A);
      const ag = mk('ag', 'OPERATEUR_SAISIE', SITE_A);
      uq.updateUser(ag.id_user, { login: ' nouveau.login ' }, caller(adm));
      expect(row('nouveau.login')).toBeTruthy();
    });
  });

  // ─────────────── P2-3 : password_hash ───────────────
  describe('P2-3 password_hash jamais accepté de l\'extérieur', () => {
    it('password_hash seul : ignoré, hash inchangé', () => {
      const adm = mk('adm', 'ADMINISTRATEUR_SITE', SITE_A);
      const ag = mk('ag', 'OPERATEUR_SAISIE', SITE_A);
      uq.updateUser(ag.id_user, { password_hash: 'EVIL', nom_user: 'N' }, caller(adm));
      expect(row('ag').password_hash).toBe(ag.password_hash);
      expect(row('ag').nom_user).toBe('N');
    });
    it('password_hash + password : seul le hash calculé est posé', () => {
      const adm = mk('adm', 'ADMINISTRATEUR_SITE', SITE_A);
      const ag = mk('ag', 'OPERATEUR_SAISIE', SITE_A);
      uq.updateUser(ag.id_user, { password_hash: 'EVIL', password: 'vrai123' }, caller(adm));
      const h = row('ag').password_hash;
      expect(h).not.toBe('EVIL');
      expect(h).not.toBe(ag.password_hash);
    });
  });
});
