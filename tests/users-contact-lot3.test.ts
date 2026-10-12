import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * LOT 3B — email/telephone dans createUser / updateUser (users.queries.ts).
 * Base SQLite temporaire migrée par initDatabase(), outbox/réseau/sync mockés (même pattern que
 * users-security-lot1b.test.ts). Les payloads outbox sont lus via le mock enqueueOutbox.
 */

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gest-in-situ-test-users-contact-'));

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

describe('LOT 3B — contact (email/téléphone) createUser / updateUser', () => {
  let connection: typeof import('../src/main/database/connection');
  let uq: typeof import('../src/main/database/queries/users.queries');
  let outbox: typeof import('../src/main/sync/outbox.service');
  let db: import('better-sqlite3').Database;

  const SITE_A = 821;
  const SITE_B = 822;
  let centreA: number;
  let centreA2: number;

  type Row = { id_user: number; login: string; role: string; site_id: number; statut_actif: number; sync_id: string; centre_id: number | null; email: string | null; telephone: string | null };
  const row = (login: string) => db.prepare('SELECT * FROM t_users WHERE login = ?').get(login) as Row;
  const count = () => (db.prepare('SELECT COUNT(*) AS n FROM t_users').get() as { n: number }).n;

  function mk(login: string, role: string, site: number, opts: { active?: number; centre?: number | null; email?: string | null; telephone?: string | null } = {}): Row {
    db.prepare(`INSERT INTO t_users (login, password_hash, role, nom_user, prenom_user, statut_actif, site_id, centre_id, sync_id, is_dirty, email, telephone)
                VALUES (?, 'HASH_' || ?, ?, 'Nom', 'Prenom', ?, ?, ?, ?, 0, ?, ?)`)
      .run(login, login, role, opts.active ?? 1, site, opts.centre ?? null, `sync-${login}`, opts.email ?? null, opts.telephone ?? null);
    const r = row(login);
    db.prepare('INSERT INTO t_user_roles (id_user, role) VALUES (?, ?)').run(r.id_user, role);
    return r;
  }
  const caller = (u: Row) => ({ id_user: u.id_user, role: u.role, site_id: u.site_id, centre_id: u.centre_id ?? undefined, login: u.login });
  type Call = [string, string, string, Record<string, unknown>];
  const calls = () => (outbox.enqueueOutbox as unknown as { mock: { calls: Call[] } }).mock.calls;
  const userPayloads = () => calls().filter(c => c[1] === 't_users').map(c => ({ op: c[2], p: c[3] }));
  const audits = () => (db.prepare('SELECT details FROM audit_logs').all() as { details: string }[]).map(r => r.details).join('\n');

  beforeAll(async () => {
    connection = await import('../src/main/database/connection');
    uq = await import('../src/main/database/queries/users.queries');
    outbox = await import('../src/main/sync/outbox.service');
    db = await connection.initDatabase();
    db.prepare(`INSERT INTO t_sites (id, nom, code, is_active, is_permanent, sync_id) VALUES (?, 'SITE_A', 'SITE_A', 1, 1, 'site-sync-821')`).run(SITE_A);
    db.prepare(`INSERT INTO t_sites (id, nom, code, is_active, is_permanent, sync_id) VALUES (?, 'SITE_B', 'SITE_B', 1, 1, 'site-sync-822')`).run(SITE_B);
    centreA = Number(db.prepare(`INSERT INTO t_centres (site_id, nom, numero, sync_id) VALUES (?, 'CA', 1, 'centre-sync-821')`).run(SITE_A).lastInsertRowid);
    centreA2 = Number(db.prepare(`INSERT INTO t_centres (site_id, nom, numero, sync_id) VALUES (?, 'CA2', 2, 'centre-sync-821b')`).run(SITE_A).lastInsertRowid);
  });

  afterAll(() => {
    connection.closeDatabase();
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    db.prepare('DELETE FROM t_logs').run();
    db.prepare('DELETE FROM t_user_roles').run();
    db.prepare('DELETE FROM t_users').run();
    db.prepare('DELETE FROM audit_logs').run();
    (outbox.enqueueOutbox as unknown as { mockClear: () => void }).mockClear();
  });

  describe('createUser', () => {
    it('crée avec contact : colonnes + payload outbox INSERT (login/password_hash/role inclus)', () => {
      const adm = mk('adm', 'ADMINISTRATEUR_SITE', SITE_A);
      uq.createUser({ login: 'neo', password: 'x12345', role: 'OPERATEUR_SAISIE', email: '  neo@ex.ci ', telephone: '+225 07 01 02 03 04' }, caller(adm));
      const r = row('neo');
      expect(r.email).toBe('neo@ex.ci');
      expect(r.telephone).toBe('+2250701020304');
      const ins = userPayloads().find(x => x.op === 'INSERT')!;
      expect(ins.p).toMatchObject({ login: 'neo', role: 'OPERATEUR_SAISIE', email: 'neo@ex.ci', telephone: '+2250701020304' });
      expect(typeof ins.p.password_hash).toBe('string');
    });

    it('contact absent ou vide => NULL (facultatif)', () => {
      const adm = mk('adm', 'ADMINISTRATEUR_SITE', SITE_A);
      uq.createUser({ login: 'a1', password: 'x12345', role: 'OPERATEUR_SAISIE' }, caller(adm));
      uq.createUser({ login: 'a2', password: 'x12345', role: 'OPERATEUR_SAISIE', email: '  ', telephone: '' }, caller(adm));
      for (const l of ['a1', 'a2']) {
        expect(row(l).email).toBeNull();
        expect(row(l).telephone).toBeNull();
      }
      expect(userPayloads().every(x => x.p.email === null && x.p.telephone === null)).toBe(true);
    });

    it.each([
      [{ email: 'pas-un-email' }, /e-mail invalide/],
      [{ telephone: '0701020304' }, /commencer par '\+'/],
      [{ telephone: '+22507' }, /\+225/]
    ])('contact invalide %j => rejeté avant toute écriture', (extra, msg) => {
      const adm = mk('adm', 'ADMINISTRATEUR_SITE', SITE_A);
      const n = count();
      expect(() => uq.createUser({ login: 'bad', password: 'x12345', role: 'OPERATEUR_SAISIE', ...extra }, caller(adm))).toThrow(msg);
      expect(count()).toBe(n);
      expect(calls()).toHaveLength(0);
    });

    it('réutilisation d\'une ligne -1 : contact RÉINITIALISÉ (pas hérité), puis posé si fourni', () => {
      const adm = mk('adm', 'ADMINISTRATEUR_SITE', SITE_A);
      mk('ghost', 'OPERATEUR_SAISIE', SITE_A, { active: -1, email: 'old@ex.ci', telephone: '+2250102030405' });
      uq.createUser({ login: 'ghost', password: 'x12345', role: 'OPERATEUR_SAISIE' }, caller(adm));
      expect(row('ghost').email).toBeNull();
      expect(row('ghost').telephone).toBeNull();
      const upd = userPayloads().find(x => x.op === 'UPDATE')!;
      expect(upd.p).toMatchObject({ login: 'ghost', role: 'OPERATEUR_SAISIE', email: null, telephone: null });
      expect(typeof upd.p.password_hash).toBe('string');

      mk('ghost2', 'OPERATEUR_SAISIE', SITE_A, { active: -1, email: 'old@ex.ci' });
      uq.createUser({ login: 'ghost2', password: 'x12345', role: 'OPERATEUR_SAISIE', email: 'new@ex.ci' }, caller(adm));
      expect(row('ghost2').email).toBe('new@ex.ci');
    });

    it('audit sans contact', () => {
      const adm = mk('adm', 'ADMINISTRATEUR_SITE', SITE_A);
      uq.createUser({ login: 'priv', password: 'x12345', role: 'OPERATEUR_SAISIE', email: 'secret@ex.ci', telephone: '+2250701020304' }, caller(adm));
      expect(audits()).toContain('priv');
      expect(audits()).not.toContain('secret@ex.ci');
      expect(audits()).not.toContain('2250701020304');
    });
  });

  describe('updateUser', () => {
    it('modifie le contact : colonnes + payload complet (login/password_hash/role + contact)', () => {
      const adm = mk('adm', 'ADMINISTRATEUR_SITE', SITE_A);
      const t = mk('t1', 'OPERATEUR_SAISIE', SITE_A, { email: 'old@ex.ci' });
      uq.updateUser(t.id_user, { email: 'new@ex.ci', telephone: '+225 01 02 03 04 05' }, caller(adm));
      expect(row('t1').email).toBe('new@ex.ci');
      expect(row('t1').telephone).toBe('+2250102030405');
      const p = userPayloads()[0].p;
      expect(p).toMatchObject({ login: 't1', role: 'OPERATEUR_SAISIE', password_hash: 'HASH_t1', email: 'new@ex.ci', telephone: '+2250102030405' });
    });

    it('effacement (chaîne vide) => NULL en base et dans le payload', () => {
      const adm = mk('adm', 'ADMINISTRATEUR_SITE', SITE_A);
      const t = mk('t2', 'OPERATEUR_SAISIE', SITE_A, { email: 'old@ex.ci', telephone: '+2250102030405' });
      uq.updateUser(t.id_user, { email: '', telephone: '  ' }, caller(adm));
      expect(row('t2').email).toBeNull();
      expect(row('t2').telephone).toBeNull();
      expect(userPayloads()[0].p).toMatchObject({ email: null, telephone: null });
    });

    it('contact inchangé (même valeur) : pas de clés contact dans le payload', () => {
      const adm = mk('adm', 'ADMINISTRATEUR_SITE', SITE_A);
      const t = mk('t3', 'OPERATEUR_SAISIE', SITE_A, { email: 'same@ex.ci', telephone: '+2250102030405' });
      uq.updateUser(t.id_user, { nom_user: 'Autre', email: ' same@ex.ci ', telephone: '+225 01 02 03 04 05' }, caller(adm));
      const p = userPayloads()[0].p;
      expect('email' in p).toBe(false);
      expect('telephone' in p).toBe(false);
      expect(row('t3').email).toBe('same@ex.ci');
    });

    it('toggle de statut seul : payload SANS clés email/telephone, contact local (périmé) intact', () => {
      const adm = mk('adm', 'ADMINISTRATEUR_SITE', SITE_A);
      const t = mk('t4', 'OPERATEUR_SAISIE', SITE_A, { email: 'stale@ex.ci', telephone: '+2250102030405' });
      uq.updateUser(t.id_user, { statut_actif: 0 }, caller(adm));
      const p = userPayloads()[0].p;
      expect(Object.keys(p).sort()).toEqual(['centre_id', 'login', 'nom_user', 'password_hash', 'prenom_user', 'role', 'site_id', 'statut_actif', 'sync_id', 'updated_at']);
      expect(p).toMatchObject({ login: 't4', password_hash: 'HASH_t4', role: 'OPERATEUR_SAISIE', statut_actif: 0 });
      expect(row('t4').email).toBe('stale@ex.ci');
    });

    it('contact invalide => rejeté sans écriture ni outbox', () => {
      const adm = mk('adm', 'ADMINISTRATEUR_SITE', SITE_A);
      const t = mk('t5', 'OPERATEUR_SAISIE', SITE_A, { email: 'ok@ex.ci' });
      expect(() => uq.updateUser(t.id_user, { nom_user: 'X', email: 'zzz' }, caller(adm))).toThrow(/e-mail invalide/);
      expect(() => uq.updateUser(t.id_user, { telephone: '123' }, caller(adm))).toThrow(/commencer par '\+'/);
      expect(row('t5').email).toBe('ok@ex.ci');
      expect(calls()).toHaveLength(0);
    });

    it('gardes de périmètre inchangées : site tiers et ADMIN_CENTRE hors centre refusés', () => {
      const adm = mk('adm', 'ADMINISTRATEUR_SITE', SITE_A);
      const other = mk('other', 'OPERATEUR_SAISIE', SITE_B);
      expect(() => uq.updateUser(other.id_user, { email: 'x@ex.ci' }, caller(adm))).toThrow();
      expect(row('other').email).toBeNull();

      const ac = mk('ac', 'ADMIN_CENTRE', SITE_A, { centre: centreA });
      const foreign = mk('foreign', 'OPERATEUR_SAISIE', SITE_A, { centre: centreA2 });
      expect(() => uq.updateUser(foreign.id_user, { email: 'x@ex.ci' }, caller(ac))).toThrow();
      expect(row('foreign').email).toBeNull();
      expect(calls()).toHaveLength(0);
    });

    it('audit : « Contact modifié » sans valeur d\'email/téléphone', () => {
      const adm = mk('adm', 'ADMINISTRATEUR_SITE', SITE_A);
      const t = mk('t6', 'OPERATEUR_SAISIE', SITE_A);
      uq.updateUser(t.id_user, { email: 'secret@ex.ci', telephone: '+2250701020304' }, caller(adm));
      const a = audits();
      expect(a).toContain('Contact modifié');
      expect(a).not.toContain('secret@ex.ci');
      expect(a).not.toContain('2250701020304');
    });
  });
});
