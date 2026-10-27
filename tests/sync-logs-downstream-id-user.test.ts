import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Audit 2026-10-26, chantier C point 3 (suite) — rapatriement t_logs (runLogsDownstream).
 *
 * Les id_user locaux ne correspondent jamais aux id_user Supabase. Un t_logs venu du cloud
 * porte donc un id_user qui, recopié tel quel en local, désigne un agent inexistant ou un
 * AUTRE agent de ce poste (faussant stats et contrôles par id_user). La ligne doit être
 * insérée localement avec id_user NULL ; login_user identifie l'agent.
 *
 * Base jetable, client Supabase simulé. Aucun appel réseau réel.
 */

process.env.GEST_IN_SITU_E2E_DISABLE_SYNC = '1';
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gest-in-situ-test-logs-downstream-'));

vi.mock('electron', () => ({
  app: { getPath: () => tmpDir, isPackaged: false },
  net: { online: true, request: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] }
}));

vi.mock('../src/main/sync/network-monitor', () => ({
  networkMonitor: { getState: () => 'ONLINE', on: vi.fn(), off: vi.fn() }
}));

vi.mock('../src/main/auth/session-heartbeat', () => ({
  getSecureCurrentUser: () => null,
  getCurrentUserLogin: () => null
}));

const fake = vi.hoisted(() => ({ rows: [] as any[] }));
vi.mock('../src/main/sync/supabase-client', () => ({
  getSupabaseClient: () => ({
    rpc: (_name: string, _args: unknown) => ({
      abortSignal: async () => ({ data: fake.rows, error: null })
    })
  })
}));

const SITE_ID = 983;
const LOCAL_OTHER_AGENT = 7; // agent local DIFFÉRENT de l'auteur cloud
const LOCAL_EXISTING_AUTHOR = 5;

describe('runLogsDownstream : id_user cloud non recopié en local (audit 2026-10-26 C3)', () => {
  let connection: typeof import('../src/main/database/connection');
  let downstream: typeof import('../src/main/sync/downstream');
  let db: import('better-sqlite3').Database;

  beforeAll(async () => {
    connection = await import('../src/main/database/connection');
    downstream = await import('../src/main/sync/downstream');
    db = await connection.initDatabase();
    db.prepare(`INSERT OR IGNORE INTO t_sites (id, nom, code, is_active, sync_id) VALUES (?, 'SITE_LOGS_DS', 'SITE_LOGS_DS', 1, 'site-logs-ds')`).run(SITE_ID);
    for (const id of [LOCAL_OTHER_AGENT, LOCAL_EXISTING_AUTHOR]) {
      db.prepare(
        `INSERT OR IGNORE INTO t_users (id_user, login, password_hash, role, site_id, sync_id) VALUES (?, ?, 'x', 'OPERATEUR_VERIFICATION', ?, ?)`
      ).run(id, `agentlocal${id}`, SITE_ID, `user-logs-ds-${id}`);
    }
  });

  afterAll(() => {
    connection.closeDatabase();
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('insère le t_logs cloud avec id_user NULL, login_user et le reste conservés ; ne touche pas un t_logs déjà présent', async () => {
    // t_logs déjà présent localement (même sync_id qu'une ligne cloud) : ne doit pas changer.
    db.prepare(
      `INSERT INTO t_logs (id_user, login_user, action, detail, date_heure, site_id, sync_id, is_dirty)
       VALUES (?, 'agentlocal5', 'CARTE_SAISIE', 'detail-local', '2026-10-20T08:00:00Z', ?, 'log-ds-existant', 0)`
    ).run(LOCAL_EXISTING_AUTHOR, SITE_ID);

    fake.rows = [
      {
        sync_id: 'log-ds-nouveau', id_user: LOCAL_OTHER_AGENT, login_user: 'agentcloud',
        action: 'CARTE_MODIFICATION', detail: 'detail-cloud', valeur_avant: 'avant', valeur_apres: 'apres',
        date_heure: '2026-10-21T09:00:00Z', centre_id: 12, site_id: SITE_ID
      },
      {
        sync_id: 'log-ds-existant', id_user: 999, login_user: 'autre',
        action: 'CARTE_MODIFICATION', detail: 'detail-cloud-2', valeur_avant: null, valeur_apres: null,
        date_heure: '2026-10-20T08:00:00Z', centre_id: null, site_id: SITE_ID
      }
    ];

    const merged = await downstream.runLogsDownstream(SITE_ID);
    expect(merged).toBe(1);

    const inserted = db.prepare('SELECT * FROM t_logs WHERE sync_id = ?').get('log-ds-nouveau') as Record<string, unknown>;
    expect(inserted).toBeDefined();
    expect(inserted.id_user).toBeNull();
    expect(inserted.login_user).toBe('agentcloud');
    expect(inserted.action).toBe('CARTE_MODIFICATION');
    expect(inserted.detail).toBe('detail-cloud');
    expect(inserted.valeur_avant).toBe('avant');
    expect(inserted.valeur_apres).toBe('apres');
    expect(inserted.date_heure).toBe('2026-10-21T09:00:00Z');
    expect(inserted.centre_id).toBe(12);
    expect(inserted.site_id).toBe(SITE_ID);
    expect(inserted.is_dirty).toBe(0);

    const existing = db.prepare('SELECT id_user, login_user, detail, COUNT(*) OVER () AS n FROM t_logs WHERE sync_id = ?').get('log-ds-existant') as Record<string, unknown>;
    expect(existing.id_user).toBe(LOCAL_EXISTING_AUTHOR);
    expect(existing.login_user).toBe('agentlocal5');
    expect(existing.detail).toBe('detail-local');
    expect(existing.n).toBe(1);

    // Aucun t_logs local attribué à l'agent 7 par le rapatriement.
    const forOther = db.prepare('SELECT COUNT(*) AS n FROM t_logs WHERE id_user = ?').get(LOCAL_OTHER_AGENT) as { n: number };
    expect(forOther.n).toBe(0);
  });
});
