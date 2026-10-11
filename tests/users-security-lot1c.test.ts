import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * LOT 1c « cible supprimée (-1) = introuvable » — src/main/database/queries/users.queries.ts.
 *
 * Cas d'attaque P0-1 / P1-1 / P1-2 / P1-3 / P2-1 / P2-2 / P2-3 contre une base SQLite TEMPORAIRE
 * migrée par initDatabase() (même pattern que tests/users-security-lot1.test.ts). Modules
 * réseau/sync mockés : aucune écriture Supabase, aucun accès à la vraie base. Le `caller` imite
 * getSecureCurrentUser() ({ id_user, role, site_id, centre_id, login }).
 */

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gest-in-situ-test-users-lot1c-'));

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

describe('LOT 1c — cible en statut -1 refusée (users.queries)', () => {
  let connection: typeof import('../src/main/database/connection');
  let uq: typeof import('../src/main/database/queries/users.queries');
  let db: import('better-sqlite3').Database;

  const SITE_A = 821;
  let centreA: number;
  const MSG = 'Utilisateur introuvable';

  type Row = { id_user: number; login: string; role: string; site_id: number; statut_actif: number; centre_id: number | null };
  const row = (login: string) => db.prepare('SELECT * FROM t_users WHERE login = ?').get(login) as Row;

  function mk(login: string, role: string, site: number, opts: { active?: number; centre?: number | null } = {}): Row {
    db.prepare(`INSERT INTO t_users (login, password_hash, role, nom_user, prenom_user, statut_actif, site_id, centre_id, sync_id, is_dirty)
                VALUES (?, 'HASH_' || ?, ?, 'Nom', 'Prenom', ?, ?, ?, ?, 0)`)
      .run(login, login, role, opts.active ?? 1, site, opts.centre ?? null, `sync-${login}`);
    const r = row(login);
    db.prepare('INSERT INTO t_user_roles (id_user, role) VALUES (?, ?)').run(r.id_user, role);
    return r;
  }
  const caller = (u: Row) => ({ id_user: u.id_user, role: u.role, site_id: u.site_id, centre_id: u.centre_id ?? undefined, login: u.login });

  beforeAll(async () => {
    connection = await import('../src/main/database/connection');
    uq = await import('../src/main/database/queries/users.queries');
    db = await connection.initDatabase();
    db.prepare(`INSERT INTO t_sites (id, nom, code, is_active, is_permanent, sync_id) VALUES (?, 'SITE_A', 'SITE_A', 1, 1, 'site-sync-821')`).run(SITE_A);
    centreA = Number(db.prepare(`INSERT INTO t_centres (site_id, nom, numero, sync_id) VALUES (?, 'CA', 1, 'centre-sync-821')`).run(SITE_A).lastInsertRowid);
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

  const callers: Array<[string, () => Row]> = [
    ['ADMINISTRATEUR_SITE', () => mk('c', 'ADMINISTRATEUR_SITE', SITE_A)],
    ['ADMIN_CENTRE', () => mk('c', 'ADMIN_CENTRE', SITE_A, { centre: centreA })],
    ['SUPER ADMIN', () => mk('c', 'SUPER ADMIN', SITE_A)]
  ];

  describe.each(callers)('appelant %s sur une cible -1', (_name, makeCaller) => {
    it('updateUser (dont statut_actif 1 / 0 / nom / password) = refus, ligne inchangée', () => {
      const c = makeCaller();
      const dead = mk('mort', 'OPERATEUR_SAISIE', SITE_A, { active: -1, centre: centreA });
      for (const data of [{ statut_actif: 1 }, { statut_actif: 0 }, { nom_user: 'X' }, { password: 'pirate1' }]) {
        expect(() => uq.updateUser(dead.id_user, { ...data }, caller(c))).toThrow(MSG);
      }
      expect(row('mort')).toEqual(dead);
    });
    it('deleteUser = refus, ligne inchangée (reste -1)', () => {
      if (_name === 'ADMIN_CENTRE') return; // rôle insuffisant par construction (autre message)
      const c = makeCaller();
      const dead = mk('mort', 'OPERATEUR_SAISIE', SITE_A, { active: -1 });
      expect(() => uq.deleteUser(dead.id_user, caller(c))).toThrow(MSG);
      expect(row('mort')).toEqual(dead);
    });
    it('hardDeleteUser = refus, ligne inchangée', () => {
      if (_name === 'ADMIN_CENTRE') return;
      const c = makeCaller();
      const dead = mk('mort', 'OPERATEUR_SAISIE', SITE_A, { active: -1 });
      expect(() => uq.hardDeleteUser(dead.id_user, caller(c))).toThrow(MSG);
      expect(row('mort')).toEqual(dead);
    });
    it('resetAgentPassword = refus, hash inchangé', () => {
      if (_name === 'ADMIN_CENTRE') return;
      const c = makeCaller();
      const dead = mk('mort', 'OPERATEUR_SAISIE', SITE_A, { active: -1 });
      expect(() => uq.resetAgentPassword(dead.id_user, caller(c))).toThrow(MSG);
      expect(db.prepare('SELECT password_hash FROM t_users WHERE login = ?').get('mort')).toEqual({ password_hash: 'HASH_mort' });
    });
  });

  it('ADMIN_CENTRE : deleteUser/hardDelete/reset restent refusés par le rôle (aucune écriture)', () => {
    const ac = mk('ac', 'ADMIN_CENTRE', SITE_A, { centre: centreA });
    const dead = mk('mort', 'OPERATEUR_SAISIE', SITE_A, { active: -1, centre: centreA });
    expect(() => uq.deleteUser(dead.id_user, caller(ac))).toThrow();
    expect(() => uq.hardDeleteUser(dead.id_user, caller(ac))).toThrow();
    expect(() => uq.resetAgentPassword(dead.id_user, caller(ac))).toThrow();
    expect(row('mort')).toEqual(dead);
  });

  it('non-régression : cible active -> update/delete OK ; createUser recrée une ligne -1 du même site', () => {
    const adm = mk('adm', 'ADMINISTRATEUR_SITE', SITE_A);
    const ag = mk('ag', 'OPERATEUR_SAISIE', SITE_A);
    uq.updateUser(ag.id_user, { nom_user: 'N2' }, caller(adm));
    expect(row('ag').nom_user).toBe('N2');
    uq.deleteUser(ag.id_user, caller(adm));
    expect(row('ag').statut_actif).toBe(0); // désactivé (0) reste modifiable/réactivable
    uq.updateUser(ag.id_user, { statut_actif: 1 }, caller(adm));
    expect(row('ag').statut_actif).toBe(1);

    mk('vieux', 'OPERATEUR_SAISIE', SITE_A, { active: -1 });
    uq.createUser({ login: 'vieux', password: 'x12345', roles: ['OPERATEUR_SAISIE'] }, caller(adm));
    expect(row('vieux').statut_actif).toBe(1);
  });
});
