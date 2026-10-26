import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Audit 2026-10-26 (point 5) — course dans la file d'envoi t_outbox.
 * L'id d'outbox est réutilisé pour une même entité (enqueueOutbox = UPSERT ON CONFLICT(id)).
 * Si la carte est modifiée à nouveau PENDANT l'envoi de l'ancienne version, la réponse de
 * cet ancien envoi ne doit ni marquer la ligne SYNCED, ni effacer is_dirty, ni la passer en
 * ERROR : la nouvelle version doit rester PENDING et partir au traitement suivant.
 * Base jetable, client Supabase mocké, réseau simulé ONLINE.
 */

process.env.GEST_IN_SITU_E2E_DISABLE_SYNC = '1';
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gest-in-situ-test-outbox-race-'));

vi.mock('electron', () => ({
  app: { getPath: () => tmpDir, isPackaged: false },
  net: { online: true, request: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] }
}));

vi.mock('../src/main/sync/network-monitor', () => ({
  networkMonitor: { getState: () => 'ONLINE', on: vi.fn(), off: vi.fn() }
}));

type FakeResult = { error: { message: string; code?: string } | null };
const fake = {
  result: { error: null } as FakeResult,
  sent: [] as Array<Record<string, unknown>>,
  /** Exécuté pendant l'appel réseau simulé (avant sa réponse) : simule une modif concurrente. */
  duringSend: null as null | (() => void)
};
vi.mock('../src/main/sync/supabase-client', () => ({
  getSupabaseClient: () => ({
    from: () => ({
      upsert: async (p: Record<string, unknown>) => {
        fake.sent.push(p);
        const hook = fake.duringSend;
        fake.duringSend = null;
        if (hook) hook();
        return fake.result;
      },
      delete: () => ({ eq: async () => fake.result }),
      update: () => ({ eq: async () => fake.result })
    })
  })
}));

const SITE_ID = 981;
let seq = 0;

describe('outbox — ré-enfilage pendant un envoi en vol (audit 2026-10-26 point 5)', () => {
  let connection: typeof import('../src/main/database/connection');
  let outbox: typeof import('../src/main/sync/outbox.service');
  let db: import('better-sqlite3').Database;

  beforeAll(async () => {
    connection = await import('../src/main/database/connection');
    outbox = await import('../src/main/sync/outbox.service');
    db = await connection.initDatabase();
    db.prepare(`INSERT OR IGNORE INTO t_sites (id, nom, code, is_active, sync_id) VALUES (?, 'SITE_RACE', 'SITE_RACE', 1, 'site-race')`).run(SITE_ID);
  });

  afterAll(() => {
    connection.closeDatabase();
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    fake.result = { error: null };
    fake.sent = [];
    fake.duringSend = null;
    db.prepare('DELETE FROM t_outbox').run();
  });

  function cardPayload(syncId: string, noms: string) {
    return { sync_id: syncId, site_id: SITE_ID, noms, prenoms: 'TEST', date_de_naissance: '1990-01-01' };
  }

  /** Carte locale modifiée (is_dirty = 1) + entrée UPDATE PENDING (version 1). */
  function seedCard() {
    seq++;
    const syncId = `carte-race-${seq}`;
    db.prepare(
      `INSERT INTO t_cartes (sync_id, site_id, noms, prenoms, date_de_naissance, is_dirty) VALUES (?, ?, 'V1', 'TEST', '1990-01-01', 1)`
    ).run(syncId, SITE_ID);
    outbox.enqueueOutbox(syncId, 't_cartes', 'UPDATE', cardPayload(syncId, 'V1'));
    return syncId;
  }

  /** Simule une 2e modification locale (quadriptyque : is_dirty = 1 + ré-enfilage même id). */
  function modifyAgain(syncId: string) {
    db.prepare(`UPDATE t_cartes SET noms = 'V2', is_dirty = 1 WHERE sync_id = ?`).run(syncId);
    outbox.enqueueOutbox(syncId, 't_cartes', 'UPDATE', cardPayload(syncId, 'V2'));
  }

  const outboxRow = (id: string) =>
    db.prepare('SELECT status, payload, attempts FROM t_outbox WHERE id = ?').get(id) as { status: string; payload: string; attempts: number };
  const dirty = (syncId: string) =>
    (db.prepare('SELECT is_dirty FROM t_cartes WHERE sync_id = ?').get(syncId) as { is_dirty: number }).is_dirty;

  it('(a) succès de l\'ancienne version après ré-enfilage : la ligne reste PENDING (V2) et is_dirty reste 1', async () => {
    const syncId = seedCard();
    fake.duringSend = () => modifyAgain(syncId);

    const res = await outbox.processOutboxPending(false, true);

    expect(fake.sent.map(p => p.noms)).toEqual(['V1']);
    const row = outboxRow(syncId);
    expect(row.status).toBe('PENDING');
    expect(JSON.parse(row.payload).noms).toBe('V2');
    expect(row.attempts).toBe(0);
    expect(dirty(syncId)).toBe(1);
    expect(res.processed).toBe(0);
  });

  it('(b) le traitement suivant envoie bien V2, puis SYNCED et is_dirty 0', async () => {
    const syncId = seedCard();
    fake.duringSend = () => modifyAgain(syncId);
    await outbox.processOutboxPending(false, true);

    const res = await outbox.processOutboxPending(false, true);

    expect(fake.sent.map(p => p.noms)).toEqual(['V1', 'V2']);
    expect(res.processed).toBe(1);
    expect(outboxRow(syncId).status).toBe('SYNCED');
    expect(dirty(syncId)).toBe(0);
  });

  it('(c) non-régression : sans modification concurrente, SYNCED et is_dirty 0', async () => {
    const syncId = seedCard();
    const res = await outbox.processOutboxPending(false, true);
    expect(res.processed).toBe(1);
    expect(outboxRow(syncId).status).toBe('SYNCED');
    expect(dirty(syncId)).toBe(0);
  });

  it('(d) échec définitif de l\'ancienne version après ré-enfilage : la nouvelle version n\'est pas passée en ERROR', async () => {
    const syncId = seedCard();
    db.prepare('UPDATE t_outbox SET attempts = 4 WHERE id = ?').run(syncId); // prochaine tentative = seuil
    fake.result = { error: { message: 'violates check constraint', code: '23514' } };
    fake.duringSend = () => modifyAgain(syncId);

    const res = await outbox.processOutboxPending(false, true);

    const row = outboxRow(syncId);
    expect(row.status).toBe('PENDING');
    expect(JSON.parse(row.payload).noms).toBe('V2');
    expect(row.attempts).toBe(0);
    expect(dirty(syncId)).toBe(1);
    expect(res.errors).toBe(0);
  });

  it('(e) non-régression : échec définitif sans ré-enfilage => ERROR', async () => {
    const syncId = seedCard();
    db.prepare('UPDATE t_outbox SET attempts = 4 WHERE id = ?').run(syncId);
    fake.result = { error: { message: 'violates check constraint', code: '23514' } };
    const res = await outbox.processOutboxPending(false, true);
    expect(outboxRow(syncId).status).toBe('ERROR');
    expect(res.errors).toBe(1);
  });
});
