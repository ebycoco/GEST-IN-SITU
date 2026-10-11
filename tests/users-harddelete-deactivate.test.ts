import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * L2-3 — hardDeleteUser : un agent ayant une activité métier locale est DÉSACTIVÉ (outcome
 * 'deactivated', UPDATE outbox) au lieu d'être supprimé ; sans activité : suppression comme avant
 * (outcome 'deleted'). Base jetable (répertoire temporaire), outbox réelle, réseau hors ligne.
 */

process.env.GEST_IN_SITU_E2E_DISABLE_SYNC = '1';
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gest-in-situ-test-hd-deact-'));

vi.mock('electron', () => ({
  app: { getPath: () => tmpDir, isPackaged: false },
  net: { online: false, request: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] }
}));

const SITE_ID = 974;
let seq = 0;

describe('hardDeleteUser — désactivation si activité métier (L2-3)', () => {
  let connection: typeof import('../src/main/database/connection');
  let outbox: typeof import('../src/main/sync/outbox.service');
  let users: typeof import('../src/main/database/queries/users.queries');
  let db: import('better-sqlite3').Database;
  const superAdmin = { role: 'SUPER ADMIN', login: 'super.admin' };

  beforeAll(async () => {
    connection = await import('../src/main/database/connection');
    outbox = await import('../src/main/sync/outbox.service');
    users = await import('../src/main/database/queries/users.queries');
    db = await connection.initDatabase();
    db.prepare(`INSERT OR IGNORE INTO t_sites (id, nom, code, is_active, sync_id) VALUES (?, 'SITE_HD', 'SITE_HD', 1, 'site-hd')`).run(SITE_ID);
  });

  afterAll(() => {
    connection.closeDatabase();
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  /** Agent synchronisé (sync_id, aucun INSERT PENDING) ou jamais synchronisé (INSERT PENDING). */
  function seed(opts: { synced?: boolean; statut?: number } = {}) {
    seq++;
    const login = `agent_hd_${seq}`;
    const syncId = `user-hd-${seq}`;
    const id = Number(db.prepare(
      `INSERT INTO t_users (login, password_hash, role, site_id, sync_id, statut_actif, is_dirty) VALUES (?, 'HASH', 'OPERATEUR_SAISIE', ?, ?, ?, 0)`
    ).run(login, SITE_ID, syncId, opts.statut ?? 1).lastInsertRowid);
    db.prepare(`INSERT INTO t_user_roles (id_user, role) VALUES (?, 'OPERATEUR_SAISIE')`).run(id);
    if (opts.synced === false) {
      outbox.enqueueOutbox(syncId, 't_users', 'INSERT', { sync_id: syncId, login, password_hash: 'HASH', role: 'OPERATEUR_SAISIE', site_id: SITE_ID, statut_actif: 1 });
    }
    return { id, login, syncId };
  }
  function addCarte(cols: Record<string, unknown>) {
    seq++;
    const keys = Object.keys(cols);
    db.prepare(`INSERT INTO t_cartes (noms, prenoms, site_id, sync_id${keys.map(k => ', ' + k).join('')}) VALUES ('N', 'P', ?, ?${keys.map(() => ', ?').join('')})`)
      .run(SITE_ID, `carte-hd-${seq}`, ...keys.map(k => cols[k]));
  }
  const addLog = (id: number, login: string, action: string) => {
    seq++;
    db.prepare(`INSERT INTO t_logs (id_user, login_user, action, detail, site_id, sync_id) VALUES (?, ?, ?, 'd', ?, ?)`).run(id, login, action, SITE_ID, `log-hd-${seq}`);
  };
  const urow = (id: number) => db.prepare('SELECT statut_actif, is_dirty FROM t_users WHERE id_user = ?').get(id) as { statut_actif: number; is_dirty: number } | undefined;
  const ops = (syncId: string) => (db.prepare('SELECT operation, payload FROM t_outbox WHERE id = ?').all(syncId) as { operation: string; payload: string }[]);

  function expectDeactivated(a: { id: number; syncId: string }) {
    const res = users.hardDeleteUser(a.id, superAdmin);
    expect(res.outcome).toBe('deactivated');
    expect(urow(a.id)).toEqual({ statut_actif: 0, is_dirty: 1 });
    const o = ops(a.syncId);
    expect(o).toHaveLength(1);
    expect(o[0].operation).toBe('UPDATE');
    const p = JSON.parse(o[0].payload);
    expect(p).toMatchObject({ sync_id: a.syncId, login: expect.any(String), password_hash: 'HASH', role: 'OPERATEUR_SAISIE', statut_actif: 0 });
    expect((db.prepare('SELECT COUNT(*) AS c FROM t_user_roles WHERE id_user = ?').get(a.id) as { c: number }).c).toBe(1);
  }

  it('carte créée par l\'agent (created_by) => désactivé, ligne et carte conservées, UPDATE sans DELETE', () => {
    const a = seed();
    addCarte({ created_by: a.id });
    expectDeactivated(a);
    expect((db.prepare('SELECT COUNT(*) AS c FROM t_cartes WHERE created_by = ?').get(a.id) as { c: number }).c).toBe(1);
  });

  it('agent_saisie = login => désactivé', () => {
    const a = seed();
    addCarte({ agent_saisie: a.login });
    expectDeactivated(a);
  });

  it('agent_distributeur = login => désactivé', () => {
    const a = seed();
    addCarte({ agent_distributeur: a.login });
    expectDeactivated(a);
  });

  it('agent_signalement_absence = login => désactivé', () => {
    const a = seed();
    addCarte({ agent_signalement_absence: a.login });
    expectDeactivated(a);
  });

  it('log non-LOGIN => désactivé', () => {
    const a = seed();
    addLog(a.id, a.login, 'CARTE_DELIVREE');
    expectDeactivated(a);
    expect((db.prepare('SELECT COUNT(*) AS c FROM t_logs WHERE id_user = ?').get(a.id) as { c: number }).c).toBe(1);
  });

  it('agent déjà désactivé (0) avec activité => idempotent, \'deactivated\'', () => {
    const a = seed({ statut: 0 });
    addCarte({ created_by: a.id });
    expectDeactivated(a);
    expect(users.hardDeleteUser(a.id, superAdmin).outcome).toBe('deactivated');
  });

  it('agent jamais synchronisé avec activité => désactivé, INSERT PENDING conservé avec statut_actif 0', () => {
    const a = seed({ synced: false });
    addCarte({ created_by: a.id });
    const res = users.hardDeleteUser(a.id, superAdmin);
    expect(res.outcome).toBe('deactivated');
    expect(urow(a.id)).toEqual({ statut_actif: 0, is_dirty: 1 });
    const o = ops(a.syncId);
    expect(o).toHaveLength(1);
    expect(o[0].operation).toBe('INSERT');
    expect(JSON.parse(o[0].payload)).toMatchObject({ site_id: SITE_ID, statut_actif: 0 });
  });

  it('SEULEMENT des logs LOGIN => \'deleted\' (logs détachés, agent supprimé après DELETE outbox / ligne -1)', () => {
    const a = seed({ synced: false });
    addLog(a.id, a.login, 'LOGIN');
    addLog(a.id, a.login, 'LOGIN');
    const res = users.hardDeleteUser(a.id, superAdmin);
    expect(res.outcome).toBe('deleted');
    expect(urow(a.id)).toBeUndefined();
    const logs = db.prepare('SELECT id_user FROM t_logs WHERE login_user = ?').all(a.login) as { id_user: number | null }[];
    expect(logs).toHaveLength(2);
    expect(logs.every(l => l.id_user === null)).toBe(true);
    expect(ops(a.syncId)).toHaveLength(0);
  });

  it('agent synchronisé sans aucune activité => \'deleted\', statut -1 et DELETE enfilé (comportement existant)', () => {
    const a = seed();
    const res = users.hardDeleteUser(a.id, superAdmin);
    expect(res.outcome).toBe('deleted');
    expect(urow(a.id)).toEqual({ statut_actif: -1, is_dirty: -1 });
    expect(ops(a.syncId).map(o => o.operation)).toEqual(['DELETE']);
  });

  it('agent jamais synchronisé sans activité => suppression physique, outbox vide', () => {
    const a = seed({ synced: false });
    const res = users.hardDeleteUser(a.id, superAdmin);
    expect(res.outcome).toBe('deleted');
    expect(urow(a.id)).toBeUndefined();
    expect(ops(a.syncId)).toHaveLength(0);
  });

  it('gardes conservés : ADMIN_CENTRE refusé, auto-suppression refusée, cible -1 introuvable (aucune écriture)', () => {
    const a = seed();
    addCarte({ created_by: a.id });
    expect(() => users.hardDeleteUser(a.id, { role: 'ADMIN_CENTRE', login: 'ac', site_id: SITE_ID })).toThrow();
    expect(() => users.hardDeleteUser(a.id, { role: 'SUPER ADMIN', login: 'x', id_user: a.id })).toThrow('propre compte');
    expect(urow(a.id)).toEqual({ statut_actif: 1, is_dirty: 0 });
    const dead = seed({ statut: -1 });
    addCarte({ created_by: dead.id });
    expect(() => users.hardDeleteUser(dead.id, superAdmin)).toThrow('Utilisateur introuvable');
    expect(urow(dead.id)?.statut_actif).toBe(-1);
  });
});
