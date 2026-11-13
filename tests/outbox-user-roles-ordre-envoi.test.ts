import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * P1-1 (test vivant agent-13, 2026-11-13) — rôle perdu dans le cloud après ajout d'un rôle.
 * updateUser enfile : DELETE de tous les rôles (`<sync>_roles_del`) puis un INSERT par rôle.
 * L'INSERT d'un rôle déjà envoyé auparavant réutilise sa ligne t_outbox (ON CONFLICT(id)),
 * donc son ancien rowid ; à created_at égal (résolution à la seconde), il partait AVANT le
 * DELETE, qui l'effaçait ensuite dans le cloud. Les rôles d'un compte doivent toujours partir
 * APRÈS le DELETE de ses rôles enfilé avant (ou en même temps) qu'eux.
 * Base jetable, client Supabase simulé (état cloud de t_user_roles en mémoire), réseau ONLINE.
 */

process.env.GEST_IN_SITU_E2E_DISABLE_SYNC = '1';
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gest-in-situ-test-outbox-roles-'));

vi.mock('electron', () => ({
  app: { getPath: () => tmpDir, isPackaged: false },
  net: { online: true, request: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] }
}));

vi.mock('../src/main/sync/network-monitor', () => ({
  networkMonitor: { getState: () => 'ONLINE', on: vi.fn(), off: vi.fn() }
}));

type FakeError = { message: string; code?: string } | null;
const cloud = {
  /** t_user_roles cloud : user_sync_id -> rôles. */
  roles: new Map<string, Set<string>>(),
  ops: [] as string[],
  /** Erreur renvoyée par le prochain DELETE t_user_roles (puis remise à null). */
  nextRoleDeleteError: null as FakeError
};
vi.mock('../src/main/sync/supabase-client', () => ({
  getSupabaseClient: () => ({
    from: (table: string) => ({
      upsert: async (p: Record<string, unknown>) => {
        if (table === 't_user_roles') {
          const u = String(p.user_sync_id);
          if (!cloud.roles.has(u)) cloud.roles.set(u, new Set());
          cloud.roles.get(u)!.add(String(p.role));
          cloud.ops.push(`UPSERT ${p.role}`);
        } else {
          cloud.ops.push(`UPSERT ${table}`);
        }
        return { error: null };
      },
      delete: () => ({
        eq: async (_col: string, val: string) => {
          if (table === 't_user_roles') {
            const err = cloud.nextRoleDeleteError;
            cloud.nextRoleDeleteError = null;
            if (err) {
              cloud.ops.push('DELETE ROLES (échec)');
              return { error: err };
            }
            cloud.roles.delete(val);
            cloud.ops.push('DELETE ROLES');
          } else {
            cloud.ops.push(`DELETE ${table}`);
          }
          return { error: null };
        }
      }),
      update: () => ({ eq: async () => ({ error: null }) })
    })
  })
}));

const SAME_SECOND = '2026-11-13 10:00:00';
let seq = 0;

describe('outbox — ordre d\'envoi des rôles d\'un agent (P1-1 2026-11-13)', () => {
  let connection: typeof import('../src/main/database/connection');
  let outbox: typeof import('../src/main/sync/outbox.service');
  let db: import('better-sqlite3').Database;

  beforeAll(async () => {
    connection = await import('../src/main/database/connection');
    outbox = await import('../src/main/sync/outbox.service');
    db = await connection.initDatabase();
  });

  afterAll(() => {
    connection.closeDatabase();
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    cloud.roles.clear();
    cloud.ops = [];
    cloud.nextRoleDeleteError = null;
    db.prepare('DELETE FROM t_outbox').run();
  });

  const userPayload = (u: string) => ({ sync_id: u, login: `login-${u}`, password_hash: 'x', role: 'OPERATEUR_SAISIE', statut_actif: 1 });
  const roleIns = (u: string, role: string, op: 'INSERT' | 'UPDATE' = 'INSERT') =>
    outbox.enqueueOutbox(`${u}_${role}`, 't_user_roles', op, { user_sync_id: u, role });
  const rolesDel = (u: string) => outbox.enqueueOutbox(`${u}_roles_del`, 't_user_roles', 'DELETE', { sync_id: u });
  const status = (id: string) => (db.prepare('SELECT status FROM t_outbox WHERE id = ?').get(id) as { status: string } | undefined)?.status;
  /** Toutes les entrées PENDING enfilées « dans la même seconde » (pire cas réel, datetime('now')). */
  const sameSecond = () => db.prepare(`UPDATE t_outbox SET created_at = ? WHERE status = 'PENDING'`).run(SAME_SECOND);

  /** createUser (comme users.queries.ts) puis envoi : agent avec OPERATEUR_SAISIE, déjà dans le cloud. */
  async function agentDejaEnvoye(): Promise<string> {
    seq++;
    const u = `agent-roles-${seq}`;
    outbox.enqueueOutbox(u, 't_users', 'INSERT', userPayload(u));
    roleIns(u, 'OPERATEUR_SAISIE');
    db.prepare(`UPDATE t_outbox SET created_at = '2026-11-13 09:00:00' WHERE status = 'PENDING'`).run();
    await outbox.processOutboxPending(false, true);
    expect(cloud.roles.get(u)).toEqual(new Set(['OPERATEUR_SAISIE']));
    cloud.ops = [];
    return u;
  }

  /** updateUser avec roles = [OPERATEUR_QUALITE, OPERATEUR_SAISIE] (même ordre d'enfilage que users.queries.ts). */
  function ajoutRoleQualite(u: string) {
    outbox.enqueueOutbox(u, 't_users', 'UPDATE', userPayload(u));
    rolesDel(u);
    roleIns(u, 'OPERATEUR_QUALITE');
    roleIns(u, 'OPERATEUR_SAISIE'); // ligne réutilisée : ancien rowid
  }

  it('(a) ajout d\'un rôle dans la même seconde : le cloud garde les 2 rôles, DELETE envoyé avant les INSERT', async () => {
    const u = await agentDejaEnvoye();
    ajoutRoleQualite(u);
    sameSecond();

    await outbox.processOutboxPending(false, true);

    expect(cloud.roles.get(u)).toEqual(new Set(['OPERATEUR_QUALITE', 'OPERATEUR_SAISIE']));
    const iDel = cloud.ops.indexOf('DELETE ROLES');
    expect(iDel).toBeGreaterThanOrEqual(0);
    expect(cloud.ops.indexOf('UPSERT OPERATEUR_SAISIE')).toBeGreaterThan(iDel);
    expect(cloud.ops.indexOf('UPSERT OPERATEUR_QUALITE')).toBeGreaterThan(iDel);
    for (const id of [`${u}_roles_del`, `${u}_OPERATEUR_QUALITE`, `${u}_OPERATEUR_SAISIE`]) expect(status(id)).toBe('SYNCED');
  });

  it('(b) DELETE des rôles en échec : aucun rôle n\'est envoyé avant lui (sinon il les effacerait au rejeu)', async () => {
    const u = await agentDejaEnvoye();
    ajoutRoleQualite(u);
    sameSecond();
    cloud.nextRoleDeleteError = { message: 'permission denied', code: '42501' };

    await outbox.processOutboxPending(false, true);

    expect(cloud.ops.filter(o => o.startsWith('UPSERT OPERATEUR'))).toEqual([]);
    expect(status(`${u}_OPERATEUR_SAISIE`)).not.toBe('SYNCED');
    expect(status(`${u}_OPERATEUR_QUALITE`)).not.toBe('SYNCED');

    // Rejeu (DELETE de nouveau accepté) : tout part dans le bon ordre.
    db.prepare(`UPDATE t_outbox SET status = 'PENDING' WHERE status = 'ERROR'`).run();
    cloud.ops = [];
    await outbox.processOutboxPending(false, true);
    expect(cloud.roles.get(u)).toEqual(new Set(['OPERATEUR_QUALITE', 'OPERATEUR_SAISIE']));
    expect(cloud.ops[0]).toBe('DELETE ROLES');
  });

  it('(c) compatibilité : rôles renvoyés par « forcer la synchro » (UPDATE) après un DELETE en attente', async () => {
    const u = await agentDejaEnvoye();
    rolesDel(u);
    roleIns(u, 'OPERATEUR_QUALITE', 'UPDATE');
    roleIns(u, 'OPERATEUR_SAISIE', 'UPDATE');
    sameSecond();

    await outbox.processOutboxPending(false, true);

    expect(cloud.roles.get(u)).toEqual(new Set(['OPERATEUR_QUALITE', 'OPERATEUR_SAISIE']));
  });

  it('(d) non-régression : un DELETE enfilé APRÈS les rôles (suppression) part après eux', async () => {
    const u = await agentDejaEnvoye();
    roleIns(u, 'OPERATEUR_QUALITE');
    db.prepare(`UPDATE t_outbox SET created_at = '2026-11-13 10:00:00' WHERE status = 'PENDING'`).run();
    rolesDel(u);
    db.prepare(`UPDATE t_outbox SET created_at = '2026-11-13 10:00:05' WHERE id = ?`).run(`${u}_roles_del`);

    await outbox.processOutboxPending(false, true);

    expect(cloud.ops).toEqual(['UPSERT OPERATEUR_QUALITE', 'DELETE ROLES']);
    expect(cloud.roles.has(u)).toBe(false);
  });

  it('(e) non-régression : rôle sans DELETE en attente (création d\'agent) envoyé normalement', async () => {
    seq++;
    const u = `agent-roles-${seq}`;
    outbox.enqueueOutbox(u, 't_users', 'INSERT', userPayload(u));
    roleIns(u, 'OPERATEUR_SAISIE');
    sameSecond();

    await outbox.processOutboxPending(false, true);

    expect(cloud.ops).toEqual(['UPSERT t_users', 'UPSERT OPERATEUR_SAISIE']);
  });
});
