import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Suite V72 (P1-1) — suppression définitive d'un agent ayant des lignes t_logs.
 *
 * Depuis que V72 rétablit la FK canonique t_logs(id_user) → t_users(id_user) (sans ON DELETE),
 * `DELETE FROM t_users` échoue (« FOREIGN KEY constraint failed ») dès qu'une ligne t_logs
 * référence l'agent. Les deux chemins de suppression physique détachent désormais les logs
 * (id_user = NULL, login_user conservé) puis suppriment rôles et utilisateur dans UNE transaction :
 *  - outbox.service.ts : suppression locale après confirmation cloud (purgeLocalUserAfterCloudDelete) ;
 *  - users.queries.ts : hardDeleteUser, branche agent jamais synchronisé (wasLocalOnly).
 *
 * Base jetable (répertoire temporaire), jamais la base réelle.
 */

process.env.GEST_IN_SITU_E2E_DISABLE_SYNC = '1';
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gest-in-situ-test-v72-del-'));

vi.mock('electron', () => ({
  app: { getPath: () => tmpDir, isPackaged: false },
  net: { online: false, request: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] }
}));

const SITE_ID = 973;
let seq = 0;

describe('Suppression définitive d\'un agent ayant des logs (FK t_logs canonique)', () => {
  let connection: typeof import('../src/main/database/connection');
  let outbox: typeof import('../src/main/sync/outbox.service');
  let users: typeof import('../src/main/database/queries/users.queries');
  let db: import('better-sqlite3').Database;

  beforeAll(async () => {
    connection = await import('../src/main/database/connection');
    outbox = await import('../src/main/sync/outbox.service');
    users = await import('../src/main/database/queries/users.queries');
    db = await connection.initDatabase();
    db.prepare(`INSERT OR IGNORE INTO t_sites (id, nom, code, is_active, sync_id) VALUES (?, 'SITE_DEL', 'SITE_DEL', 1, 'site-del')`).run(SITE_ID);
  });

  afterAll(() => {
    connection.closeDatabase();
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  /** Agent + 2 rôles + 3 lignes t_logs le référençant (+ 1 ligne d'un autre agent, témoin). */
  function seedAgent(): { id: number; syncId: string; login: string } {
    seq++;
    const login = `agent_del_${seq}`;
    const syncId = `user-del-${seq}`;
    const id = Number(db.prepare(
      `INSERT INTO t_users (login, password_hash, role, site_id, sync_id) VALUES (?, 'x', 'OPERATEUR_VERIFICATION', ?, ?)`
    ).run(login, SITE_ID, syncId).lastInsertRowid);
    db.prepare(`INSERT INTO t_user_roles (id_user, role) VALUES (?, 'OPERATEUR_VERIFICATION'), (?, 'OPERATEUR_QUALITE')`).run(id, id);
    const ins = db.prepare(`INSERT INTO t_logs (id_user, login_user, action, detail, site_id, sync_id, is_dirty) VALUES (?, ?, 'CARTE_DELIVREE', ?, ?, ?, ?)`);
    for (let i = 0; i < 3; i++) ins.run(id, login, `detail ${i}`, SITE_ID, `log-${syncId}-${i}`, i % 2);
    return { id, syncId, login };
  }

  const logsOf = (syncId: string) =>
    db.prepare(`SELECT id_user, login_user, is_dirty, synced_at FROM t_logs WHERE sync_id LIKE ? ORDER BY sync_id`).all(`log-${syncId}-%`) as
      { id_user: number | null; login_user: string; is_dirty: number; synced_at: string | null }[];
  const userCount = (id: number) => (db.prepare('SELECT COUNT(*) AS c FROM t_users WHERE id_user = ?').get(id) as { c: number }).c;
  const roleCount = (id: number) => (db.prepare('SELECT COUNT(*) AS c FROM t_user_roles WHERE id_user = ?').get(id) as { c: number }).c;

  it('constat : l\'ancienne séquence (DELETE rôles puis DELETE t_users) échoue sur la FK t_logs', () => {
    const a = seedAgent();
    db.prepare('DELETE FROM t_user_roles WHERE id_user = ?').run(a.id);
    expect(() => db.prepare('DELETE FROM t_users WHERE id_user = ?').run(a.id)).toThrow(/FOREIGN KEY constraint failed/);
  });

  describe('chemin outbox — purgeLocalUserAfterCloudDelete (après confirmation cloud)', () => {
    it('supprime agent et rôles, conserve les logs détachés (id_user NULL, login_user et is_dirty intacts)', () => {
      const a = seedAgent();
      const temoin = seedAgent();
      const avant = logsOf(a.syncId);

      const res = outbox.purgeLocalUserAfterCloudDelete(db, a.syncId);

      expect(res).toEqual({ logsDetached: 3, usersDeleted: 1 });
      expect(userCount(a.id)).toBe(0);
      expect(roleCount(a.id)).toBe(0);
      const apres = logsOf(a.syncId);
      expect(apres).toHaveLength(3);
      expect(apres.every(l => l.id_user === null && l.login_user === a.login)).toBe(true);
      // is_dirty / synced_at non modifiés : le détachement est strictement local
      expect(apres.map(l => [l.is_dirty, l.synced_at])).toEqual(avant.map(l => [l.is_dirty, l.synced_at]));
      // Autre agent non touché
      expect(userCount(temoin.id)).toBe(1);
      expect(roleCount(temoin.id)).toBe(2);
      expect(logsOf(temoin.syncId).every(l => l.id_user === temoin.id)).toBe(true);
    });

    it('agent sans aucun log : suppression simple', () => {
      seq++;
      const id = Number(db.prepare(`INSERT INTO t_users (login, password_hash, role, site_id, sync_id) VALUES (?, 'x', 'OPERATEUR_VERIFICATION', ?, ?)`)
        .run(`agent_nolog_${seq}`, SITE_ID, `user-nolog-${seq}`).lastInsertRowid);
      expect(outbox.purgeLocalUserAfterCloudDelete(db, `user-nolog-${seq}`)).toEqual({ logsDetached: 0, usersDeleted: 1 });
      expect(userCount(id)).toBe(0);
    });

    it('atomicité : un échec du DELETE t_users annule le détachement des logs et la suppression des rôles', () => {
      const a = seedAgent();
      db.exec(`CREATE TRIGGER trg_test_block_delete BEFORE DELETE ON t_users WHEN old.id_user = ${a.id} BEGIN SELECT RAISE(ABORT, 'blocage test'); END`);
      try {
        expect(() => outbox.purgeLocalUserAfterCloudDelete(db, a.syncId)).toThrow(/blocage test/);
      } finally {
        db.exec('DROP TRIGGER trg_test_block_delete');
      }
      expect(userCount(a.id)).toBe(1);
      expect(roleCount(a.id)).toBe(2);
      expect(logsOf(a.syncId).every(l => l.id_user === a.id)).toBe(true);
    });
  });

  describe('chemin hardDeleteUser — agent jamais synchronisé (wasLocalOnly)', () => {
    const superAdmin = { role: 'SUPER ADMIN', login: 'super.admin' };

    it('supprime agent et rôles, conserve les logs détachés (id_user NULL, login_user intact)', () => {
      const a = seedAgent();
      outbox.enqueueOutbox(a.syncId, 't_users', 'INSERT', { sync_id: a.syncId, login: a.login, password_hash: 'x', role: 'OPERATEUR_VERIFICATION' });
      const avant = logsOf(a.syncId);

      expect(() => users.hardDeleteUser(a.id, superAdmin)).not.toThrow();

      expect(userCount(a.id)).toBe(0);
      expect(roleCount(a.id)).toBe(0);
      const apres = logsOf(a.syncId);
      expect(apres).toHaveLength(3);
      expect(apres.every(l => l.id_user === null && l.login_user === a.login)).toBe(true);
      expect(apres.map(l => [l.is_dirty, l.synced_at])).toEqual(avant.map(l => [l.is_dirty, l.synced_at]));
      // INSERT PENDING annulé, aucun DELETE enfilé (agent jamais synchronisé)
      expect((db.prepare('SELECT COUNT(*) AS c FROM t_outbox WHERE id = ?').get(a.syncId) as { c: number }).c).toBe(0);
    });

    it('atomicité : un échec du DELETE t_users laisse logs et rôles intacts (erreur remontée)', () => {
      const a = seedAgent();
      outbox.enqueueOutbox(a.syncId, 't_users', 'INSERT', { sync_id: a.syncId, login: a.login, password_hash: 'x', role: 'OPERATEUR_VERIFICATION' });
      db.exec(`CREATE TRIGGER trg_test_block_delete2 BEFORE DELETE ON t_users WHEN old.id_user = ${a.id} BEGIN SELECT RAISE(ABORT, 'blocage test'); END`);
      try {
        expect(() => users.hardDeleteUser(a.id, superAdmin)).toThrow(/blocage test/);
      } finally {
        db.exec('DROP TRIGGER trg_test_block_delete2');
      }
      expect(userCount(a.id)).toBe(1);
      expect(roleCount(a.id)).toBe(2);
      expect(logsOf(a.syncId).every(l => l.id_user === a.id)).toBe(true);
    });
  });
});
