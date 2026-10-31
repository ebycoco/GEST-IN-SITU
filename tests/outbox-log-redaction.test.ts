import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Le password_hash d'un payload t_users ne doit jamais apparaître dans main.log, ni à
 * l'enfilage (enqueueOutbox) ni à l'envoi (processOutboxPending). Le payload envoyé à
 * Supabase, lui, doit toujours contenir le hash (colonne NOT NULL côté cloud).
 * Base jetable, client Supabase mocké, electron-log capturé.
 */

process.env.GEST_IN_SITU_E2E_DISABLE_SYNC = '1';
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gest-in-situ-test-log-redaction-'));

const logged: string[] = [];
vi.mock('electron-log', () => {
  const capture = (...args: unknown[]) => {
    logged.push(args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
  };
  return { default: { info: capture, warn: capture, error: capture, debug: capture } };
});

vi.mock('electron', () => ({
  app: { getPath: () => tmpDir, isPackaged: false },
  net: { online: true, request: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] }
}));

vi.mock('../src/main/sync/network-monitor', () => ({
  networkMonitor: { getState: () => 'ONLINE', on: vi.fn(), off: vi.fn() }
}));

const sent: Array<Record<string, unknown>> = [];
vi.mock('../src/main/sync/supabase-client', () => ({
  getSupabaseClient: () => ({
    from: () => ({
      upsert: async (p: Record<string, unknown>) => {
        sent.push(p);
        return { error: null };
      },
      delete: () => ({ eq: async () => ({ error: null }) }),
      update: () => ({ eq: async () => ({ error: null }) })
    })
  })
}));

const HASH = '$2b$10$HASHSECRETNEDOITPASAPPARAITRE0123456789abcdefghij';

describe('outbox — password_hash masqué dans les logs', () => {
  let connection: typeof import('../src/main/database/connection');
  let outbox: typeof import('../src/main/sync/outbox.service');

  beforeAll(async () => {
    connection = await import('../src/main/database/connection');
    outbox = await import('../src/main/sync/outbox.service');
    await connection.initDatabase();
  });

  afterAll(() => {
    connection.closeDatabase();
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('redactPayloadForLog masque password_hash et password, garde les autres champs', () => {
    const out = outbox.redactPayloadForLog({ login: 'agent1', password_hash: HASH, password: 'x', role: 'OPERATEUR' });
    expect(out).not.toContain(HASH);
    expect(JSON.parse(out)).toEqual({ login: 'agent1', password_hash: '[MASQUÉ]', password: '[MASQUÉ]', role: 'OPERATEUR' });
  });

  it('enfilage + envoi d\'un t_users : hash absent des logs, présent dans l\'envoi Supabase', async () => {
    logged.length = 0;
    sent.length = 0;
    const syncId = 'user-log-redaction-1';
    outbox.enqueueOutbox(syncId, 't_users', 'INSERT', {
      sync_id: syncId, login: 'agent_redaction', password_hash: HASH, role: 'OPERATEUR_VERIFICATION', statut_actif: 1
    });

    await outbox.processOutboxPending(false, true);

    expect(sent.some(p => p.password_hash === HASH)).toBe(true);
    expect(logged.some(l => l.includes('agent_redaction'))).toBe(true);
    expect(logged.filter(l => l.includes(HASH))).toEqual([]);
  });
});
