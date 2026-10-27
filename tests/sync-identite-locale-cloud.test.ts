import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as http from 'http';
import { Worker } from 'worker_threads';
import { createRequire } from 'module';
import Database from 'better-sqlite3';

/**
 * Audit 2026-10-26, chantier C point 3 — identité locale envoyée au cloud + erreurs muettes.
 *
 * Les id_user locaux (t_users.id_user SQLite) ne correspondent jamais aux id_user Supabase
 * (séquence cloud propre). t_cartes.created_by et t_logs.id_user sont des FK vers
 * t_users(id_user) côté Supabase : envoyer l'id local provoque une violation FK (23503) ou
 * attribue la ligne au mauvais agent. Ces colonnes doivent partir à null vers le cloud, la
 * valeur locale restant inchangée (statistiques locales).
 *
 * Et une erreur Supabase non transitoire (ou une exception) doit laisser une trace dès la
 * 1re tentative (error_msg + last_attempt_at), sans changer le statut PENDING.
 *
 * Base jetable, client Supabase simulé, réseau simulé ONLINE. Aucun appel réseau réel.
 */

process.env.GEST_IN_SITU_E2E_DISABLE_SYNC = '1';
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gest-in-situ-test-identite-cloud-'));

vi.mock('electron', () => ({
  app: { getPath: () => tmpDir, isPackaged: false },
  net: { online: true, request: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] }
}));

vi.mock('../src/main/sync/network-monitor', () => ({
  networkMonitor: { getState: () => 'ONLINE', on: vi.fn(), off: vi.fn() }
}));

const session = vi.hoisted(() => ({
  user: null as null | { id_user: number; login: string; role: string; site_id: number; centre_id: number | null }
}));
vi.mock('../src/main/auth/session-heartbeat', () => ({
  getSecureCurrentUser: () => session.user,
  getCurrentUserLogin: () => session.user?.login ?? null
}));

type FakeError = { message: string; code?: string };
const fake = vi.hoisted(() => ({
  result: { error: null } as { error: FakeError | null },
  throwError: null as null | Error,
  sent: [] as Array<{ table: string; payload: any }>,
  duringSend: null as null | (() => void)
}));
vi.mock('../src/main/sync/supabase-client', () => ({
  getSupabaseClient: () => ({
    from: (table: string) => ({
      upsert: async (p: any) => {
        const rows = Array.isArray(p) ? p : [p];
        for (const r of rows) fake.sent.push({ table, payload: r });
        const hook = fake.duringSend;
        fake.duringSend = null;
        if (hook) hook();
        if (fake.throwError) throw fake.throwError;
        return fake.result;
      },
      delete: () => ({ eq: async () => fake.result, in: async () => fake.result }),
      update: () => ({ eq: async () => fake.result })
    })
  })
}));

const SITE_ID = 982;
const LOCAL_USER_CARD = 7;
const LOCAL_USER_LOG = 5;
let seq = 0;

const flush = () => new Promise<void>((r) => setTimeout(r, 30));

describe('identité locale non envoyée au cloud + trace des erreurs outbox (audit 2026-10-26 C3)', () => {
  let connection: typeof import('../src/main/database/connection');
  let outbox: typeof import('../src/main/sync/outbox.service');
  let db: import('better-sqlite3').Database;

  beforeAll(async () => {
    connection = await import('../src/main/database/connection');
    outbox = await import('../src/main/sync/outbox.service');
    db = await connection.initDatabase();
    db.prepare(`INSERT OR IGNORE INTO t_sites (id, nom, code, is_active, sync_id) VALUES (?, 'SITE_ID_CLOUD', 'SITE_ID_CLOUD', 1, 'site-id-cloud')`).run(SITE_ID);
    for (const id of [LOCAL_USER_CARD, LOCAL_USER_LOG]) {
      db.prepare(
        `INSERT OR IGNORE INTO t_users (id_user, login, password_hash, role, site_id, sync_id) VALUES (?, ?, 'x', 'OPERATEUR_VERIFICATION', ?, ?)`
      ).run(id, `agent${id}`, SITE_ID, `user-id-cloud-${id}`);
    }
  });

  afterAll(() => {
    connection.closeDatabase();
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    fake.result = { error: null };
    fake.throwError = null;
    fake.sent = [];
    fake.duringSend = null;
    session.user = null;
    db.prepare('DELETE FROM t_outbox').run();
  });

  function seedCard(createdBy: number | null = LOCAL_USER_CARD) {
    seq++;
    const syncId = `carte-id-cloud-${seq}`;
    db.prepare(
      `INSERT INTO t_cartes (sync_id, site_id, noms, prenoms, date_de_naissance, is_dirty, created_by) VALUES (?, ?, 'NOM', 'PRENOM', '1990-01-01', 1, ?)`
    ).run(syncId, SITE_ID, createdBy);
    const full = db.prepare('SELECT * FROM t_cartes WHERE sync_id = ?').get(syncId) as Record<string, unknown>;
    outbox.enqueueOutbox(syncId, 't_cartes', 'UPDATE', full);
    return syncId;
  }

  const outboxRow = (id: string) =>
    db.prepare('SELECT status, payload, attempts, error_msg, last_attempt_at FROM t_outbox WHERE id = ?').get(id) as {
      status: string; payload: string; attempts: number; error_msg: string | null; last_attempt_at: string | null;
    };

  // ── (a) cartes : created_by neutralisé dans les 3 chemins d'envoi ─────────────
  describe('(a) t_cartes.created_by', () => {
    it('(a1) outbox (payload-mapper) : created_by envoyé à null, valeur locale conservée', async () => {
      const syncId = seedCard();
      await outbox.processOutboxPending(false, true);

      const sentCard = fake.sent.find((s) => s.table === 't_cartes' && s.payload.sync_id === syncId);
      expect(sentCard).toBeDefined();
      expect(sentCard!.payload).toHaveProperty('created_by', null);
      expect(outboxRow(syncId).status).toBe('SYNCED');
      const local = db.prepare('SELECT created_by FROM t_cartes WHERE sync_id = ?').get(syncId) as { created_by: number };
      expect(local.created_by).toBe(LOCAL_USER_CARD);
    });

    it('(a2) upstream.ts (t_sync_queue) : created_by envoyé à null, valeur locale conservée', async () => {
      seq++;
      const syncId = `carte-id-cloud-queue-${seq}`;
      const ins = db.prepare(
        `INSERT INTO t_cartes (sync_id, site_id, noms, prenoms, date_de_naissance, is_dirty, created_by) VALUES (?, ?, 'NOM', 'PRENOM', '1990-01-01', 1, ?)`
      ).run(syncId, SITE_ID, LOCAL_USER_CARD);
      const full = db.prepare('SELECT * FROM t_cartes WHERE sync_id = ?').get(syncId);
      db.prepare(`INSERT INTO t_sync_queue (table_name, record_id, operation, payload) VALUES ('t_cartes', ?, 'UPDATE', ?)`)
        .run(Number(ins.lastInsertRowid), JSON.stringify(full));

      const { runUpstream } = await import('../src/main/sync/upstream');
      await runUpstream();

      const sentCard = fake.sent.find((s) => s.table === 't_cartes' && s.payload.sync_id === syncId);
      expect(sentCard).toBeDefined();
      expect(sentCard!.payload).toHaveProperty('created_by', null);
      const local = db.prepare('SELECT created_by FROM t_cartes WHERE sync_id = ?').get(syncId) as { created_by: number };
      expect(local.created_by).toBe(LOCAL_USER_CARD);
    });
  });

  // ── (b) t_logs : id_user neutralisé ───────────────────────────────────────────
  describe('(b) t_logs.id_user', () => {
    it('(b1) logAudit (action CRUD_SYNC_WHITELIST) : payload upsert id_user null, login_user conservé, t_logs local garde id_user', async () => {
      session.user = { id_user: LOCAL_USER_LOG, login: 'agent5', role: 'OPERATEUR_VERIFICATION', site_id: SITE_ID, centre_id: null };
      const { logAudit } = await import('../src/main/utils/audit');
      const marker = `marker-${Date.now()}`;
      logAudit('agent5', 'CARTE_MODIFICATION', { marker });
      await flush();
      await outbox.processOutboxPending(false, true);
      await flush();

      const sentLog = fake.sent.find((s) => s.table === 't_logs' && String(s.payload.detail).includes(marker));
      expect(sentLog).toBeDefined();
      expect(sentLog!.payload).toHaveProperty('id_user', null);
      expect(sentLog!.payload.login_user).toBe('agent5');

      // Le payload stocké en file ne porte pas non plus l'id local (nouveaux enfilages).
      const queued = db.prepare(`SELECT payload FROM t_outbox WHERE table_name = 't_logs' AND payload LIKE ?`).get(`%${marker}%`) as { payload: string };
      expect(JSON.parse(queued.payload).id_user ?? null).toBeNull();

      const localLog = db.prepare(`SELECT id_user, login_user FROM t_logs WHERE detail LIKE ?`).get(`%${marker}%`) as { id_user: number; login_user: string };
      expect(localLog.id_user).toBe(LOCAL_USER_LOG);
      expect(localLog.login_user).toBe('agent5');
    });

    it('(b2) entrée t_logs déjà en file avec id_user: 5 (ancienne version) : envoyée avec id_user null', async () => {
      const syncId = `log-ancien-${Date.now()}`;
      db.prepare(
        `INSERT INTO t_logs (id_user, login_user, action, detail, site_id, sync_id, is_dirty) VALUES (?, 'agent5', 'CARTE_SAISIE', '{}', ?, ?, 1)`
      ).run(LOCAL_USER_LOG, SITE_ID, syncId);
      outbox.enqueueOutbox(syncId, 't_logs', 'INSERT', {
        sync_id: syncId, id_user: LOCAL_USER_LOG, login_user: 'agent5', action: 'CARTE_SAISIE', detail: '{}',
        site_id: SITE_ID, centre_id: null, date_heure: new Date().toISOString()
      });

      await outbox.processOutboxPending(false, true);

      const sentLog = fake.sent.find((s) => s.table === 't_logs' && s.payload.sync_id === syncId);
      expect(sentLog).toBeDefined();
      expect(sentLog!.payload).toHaveProperty('id_user', null);
      expect(sentLog!.payload.login_user).toBe('agent5');
      expect(outboxRow(syncId).status).toBe('SYNCED');
      const localLog = db.prepare('SELECT id_user FROM t_logs WHERE sync_id = ?').get(syncId) as { id_user: number };
      expect(localLog.id_user).toBe(LOCAL_USER_LOG);
    });
  });

  // ── (c) erreur non transitoire : trace dès la 1re tentative ───────────────────
  describe('(c) trace des erreurs outbox', () => {
    const FK_ERROR = { code: '23503', message: 'insert or update on table "t_cartes" violates foreign key constraint "t_cartes_created_by_fkey"' };

    it('(c1) 23503 à la 1re tentative : PENDING, error_msg et last_attempt_at renseignés, attempts = 1', async () => {
      const syncId = seedCard();
      fake.result = { error: FK_ERROR };
      const res = await outbox.processOutboxPending(false, true);
      const row = outboxRow(syncId);
      expect(row.status).toBe('PENDING');
      expect(row.attempts).toBe(1);
      expect(row.error_msg).toContain('foreign key');
      expect(row.last_attempt_at).not.toBeNull();
      expect(res.errors).toBe(0);
    });

    it('(c2) exception pendant l\'envoi : PENDING, error_msg et last_attempt_at renseignés', async () => {
      const syncId = seedCard();
      fake.throwError = new Error('fetch failed: socket hang up');
      await outbox.processOutboxPending(false, true);
      const row = outboxRow(syncId);
      expect(row.status).toBe('PENDING');
      expect(row.attempts).toBe(1);
      expect(row.error_msg).toContain('socket hang up');
      expect(row.last_attempt_at).not.toBeNull();
    });

    it('(c3) garde anti-course : ré-enfilage pendant l\'envoi en échec => nouvelle version sans error_msg', async () => {
      const syncId = seedCard();
      fake.result = { error: FK_ERROR };
      fake.duringSend = () => {
        db.prepare(`UPDATE t_cartes SET noms = 'V2', is_dirty = 1 WHERE sync_id = ?`).run(syncId);
        const full = db.prepare('SELECT * FROM t_cartes WHERE sync_id = ?').get(syncId) as Record<string, unknown>;
        outbox.enqueueOutbox(syncId, 't_cartes', 'UPDATE', full);
      };
      await outbox.processOutboxPending(false, true);
      const row = outboxRow(syncId);
      expect(row.status).toBe('PENDING');
      expect(row.attempts).toBe(0);
      expect(row.error_msg).toBeNull();
      expect(JSON.parse(row.payload).noms).toBe('V2');
    });

    it('(c4) après MAX tentatives : ERROR comme avant', async () => {
      const syncId = seedCard();
      db.prepare('UPDATE t_outbox SET attempts = 4 WHERE id = ?').run(syncId);
      fake.result = { error: FK_ERROR };
      const res = await outbox.processOutboxPending(false, true);
      const row = outboxRow(syncId);
      expect(row.status).toBe('ERROR');
      expect(row.attempts).toBe(5);
      expect(row.error_msg).toContain('foreign key');
      expect(res.errors).toBe(1);
    });

    it('(c5) succès après une erreur tracée : SYNCED et error_msg effacé', async () => {
      const syncId = seedCard();
      fake.result = { error: FK_ERROR };
      await outbox.processOutboxPending(false, true);
      fake.result = { error: null };
      await outbox.processOutboxPending(false, true);
      const row = outboxRow(syncId);
      expect(row.status).toBe('SYNCED');
      expect(row.error_msg).toBeNull();
    });
  });
});

// ── (a3) upload-worker.js (envoi manuel en masse, worker_threads) ───────────────
describe('(a3) upload-worker.js : created_by envoyé à null', () => {
  const requireCjs = createRequire(import.meta.url);
  const sqlitePath = requireCjs.resolve('better-sqlite3');
  const workerTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gest-in-situ-test-upload-worker-'));
  const dbPath = path.join(workerTmp, 'upload.db');
  let server: http.Server;
  let port = 0;
  const bodies: any[] = [];

  beforeAll(async () => {
    const { runMigrations } = await import('../src/main/database/schema');
    const wdb = new Database(dbPath);
    runMigrations(wdb);
    wdb.prepare(`INSERT OR IGNORE INTO t_sites (id, nom, code, is_active) VALUES (4, 'S4', 'S4', 1)`).run();
    wdb.prepare(`INSERT OR IGNORE INTO t_users (id_user, login, password_hash, role, site_id, sync_id) VALUES (7, 'agent7', 'x', 'OPERATEUR_VERIFICATION', 4, 'u7')`).run();
    wdb.prepare(
      `INSERT INTO t_cartes (sync_id, site_id, noms, prenoms, date_de_naissance, rangement, is_dirty, created_by) VALUES ('carte-worker-1', 4, 'NOM', 'PRENOM', '1990-01-01', 'A1', 1, 7)`
    ).run();
    wdb.close();

    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        if (req.method === 'POST' && body) bodies.push(JSON.parse(body));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('[]');
      });
    });
    await new Promise<void>((r) => server.listen(0, () => { port = (server.address() as any).port; r(); }));
  });

  afterAll(() => {
    server.close();
    try { fs.rmSync(workerTmp, { recursive: true, force: true }); } catch { /* fichier encore verrouillé : ignoré */ }
  });

  it('le corps POST /t_cartes porte created_by null ; la carte locale garde 7', async () => {
    // Toujours la source (jamais dist/, potentiellement obsolète).
    const workerPath = path.join(__dirname, '../src/main/workers/upload-worker.js');
    await new Promise<void>((resolve, reject) => {
      const w = new Worker(workerPath, {
        workerData: {
          siteId: 4, dbPath, sqlitePath,
          supabaseUrl: `http://localhost:${port}`, supabaseAnonKey: 'mock-key',
          allowProbable: true, allowInvalid: true, allowMissing: true, onlyModified: false
        }
      });
      w.on('message', (m) => { if (m.type === 'done' || m.type === 'error') { w.terminate(); resolve(); } });
      w.on('error', reject);
    });

    const rows = bodies.flat().filter((r: any) => r && r.sync_id === 'carte-worker-1');
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r).toHaveProperty('created_by', null);

    const rdb = new Database(dbPath, { readonly: true });
    const local = rdb.prepare(`SELECT created_by FROM t_cartes WHERE sync_id = 'carte-worker-1'`).get() as { created_by: number };
    rdb.close();
    expect(local.created_by).toBe(7);
  });
});
