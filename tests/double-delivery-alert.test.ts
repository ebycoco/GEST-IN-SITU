import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as http from 'http';
import { Worker } from 'worker_threads';
import { createRequire } from 'module';
import Database from 'better-sqlite3';

/**
 * P1-2 (2026-11-24) : alerte « double délivrance ».
 * Ce poste a délivré une carte (hors ligne) ; une autre délivrance est arrivée au cloud avant.
 * La garde 0006 renvoie le bloc gardé ; le poste s'aligne (CONFLIT_SYNC_STATUT, inchangé) ET crée
 * une alerte locale ALERTE_DOUBLE_DELIVRANCE (une seule par carte), sans mise en file t_outbox.
 * Base jetable, client Supabase simulé (outbox) / serveur HTTP local (upload-worker).
 * Aucun appel réseau réel.
 */

process.env.GEST_IN_SITU_E2E_DISABLE_SYNC = '1';
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gest-in-situ-test-double-delivrance-'));

const sentToRenderer = vi.hoisted(() => [] as Array<{ channel: string; data: any }>);

vi.mock('electron', () => ({
  app: { getPath: () => tmpDir, isPackaged: false },
  net: { online: true, request: vi.fn() },
  BrowserWindow: {
    getAllWindows: () => [{
      isDestroyed: () => false,
      webContents: { send: (channel: string, data: any) => sentToRenderer.push({ channel, data }) }
    }]
  }
}));

vi.mock('../src/main/sync/network-monitor', () => ({
  networkMonitor: { getState: () => 'ONLINE', on: vi.fn(), off: vi.fn() }
}));

const STATUS_BLOCK = [
  'statut', 'date_delivrance', 'agent_distributeur', 'centre_retrait',
  'nom_retirant', 'num_retirant', 'contact_retirant', 'relation_retirant',
  'doublon_declare_par', 'doublon_declare_le', 'doublon_motif',
  'doublon_annule_par', 'doublon_annule_le', 'doublon_motif_annulation',
  'statut_avant_doublon',
  'apurement_correction_par', 'apurement_correction_le', 'apurement_correction_motif',
  'apurement_annulation_par', 'apurement_annulation_le', 'apurement_annulation_motif'
];

function pgTs(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  return new Date(String(v)).toISOString().replace('.000Z', 'Z').replace('Z', '+00:00');
}

function cloudEcho(sent: Record<string, any>, cols: string[]): Record<string, any> {
  const out: Record<string, any> = {};
  for (const c of cols) {
    if (c === 'date_delivrance' || c === 'updated_at' || c === 'action_at') out[c] = pgTs(sent[c]);
    else out[c] = sent[c] === undefined ? null : sent[c];
  }
  return out;
}

/** Délivrance gardée par le cloud (faite par le téléphone, arrivée la première). */
const CLOUD_DELIVRE = {
  statut: 'DELIVRE',
  date_delivrance: '2026-11-24T09:00:00+00:00',
  agent_distributeur: 'agent.mobile',
  centre_retrait: 'CENTRE A',
  nom_retirant: 'RETIRANT MOBILE',
  num_retirant: 'CNI-MOB',
  contact_retirant: '0700000001',
  relation_retirant: 'TITULAIRE'
};
const CLOUD_UPDATED_AT = '2026-11-24T10:00:00.001+00:00';

const fake = vi.hoisted(() => ({
  respond: null as null | ((sent: Record<string, any>, cols: string[]) => Record<string, any> | null)
}));

vi.mock('../src/main/sync/supabase-client', () => ({
  getSupabaseClient: () => ({
    from: () => {
      const run = async (p: any, cols: string[] | null) => {
        const rows = Array.isArray(p) ? p : [p];
        if (!cols) return { data: null, error: null };
        const data = rows.map((r) => (fake.respond ? fake.respond(r, cols) : cloudEcho(r, cols))).filter(Boolean);
        return { data, error: null };
      };
      return {
        upsert: (p: any) => ({
          select: (cols: string) => run(p, String(cols).split(',').map((s) => s.trim()).filter(Boolean)),
          then: (res: any, rej: any) => run(p, null).then(res, rej)
        }),
        delete: () => ({ eq: async () => ({ error: null }) }),
        update: () => ({ eq: async () => ({ error: null }) })
      };
    }
  })
}));

const SITE_ID = 984;
const OTHER_SITE_ID = 985;
const CENTRE_ID = 71;
let seq = 0;

/** Réponse du trigger : bloc DELIVRE gardé (éventuellement modifié par `override`). */
const guardResponse = (override: Record<string, any> = {}) => (sent: Record<string, any>, cols: string[]) => {
  const row = cloudEcho(sent, cols);
  for (const c of STATUS_BLOCK) if (c in row) row[c] = null;
  Object.assign(row, CLOUD_DELIVRE, override);
  row.updated_at = CLOUD_UPDATED_AT;
  return row;
};

describe('détection pure (detectDoubleDelivery)', () => {
  let mod: typeof import('../src/main/sync/double-delivery-alert');
  beforeAll(async () => { mod = await import('../src/main/sync/double-delivery-alert'); });

  const sent = { sync_id: 'c1', noms: 'KOUASSI', prenoms: 'AMA', statut: 'DELIVRE', date_delivrance: '2026-11-24T11:00:00.000Z', agent_distributeur: 'agent.poste' };

  it('DELIVRE envoyé vs DELIVRE gardé avec date/agent différents -> détecté', () => {
    const info = mod.detectDoubleDelivery(sent, CLOUD_DELIVRE, ['date_delivrance', 'agent_distributeur']);
    expect(info).not.toBeNull();
    expect(info!.carteSyncId).toBe('c1');
    expect(info!.garde.agent_distributeur).toBe('agent.mobile');
    expect(info!.ecarte.agent_distributeur).toBe('agent.poste');
    expect(mod.buildDoubleDeliveryMessage(info!)).toContain('Carte AMA KOUASSI déjà remise par agent.mobile le ');
  });

  it('envoi EN STOCK (simple alignement, pas de délivrance locale) -> rien', () => {
    expect(mod.detectDoubleDelivery({ ...sent, statut: 'EN STOCK' }, CLOUD_DELIVRE, ['statut', 'date_delivrance'])).toBeNull();
  });

  it('cloud non DELIVRE (ex. ANNULE) -> rien (reste CONFLIT_SYNC_STATUT seul)', () => {
    expect(mod.detectDoubleDelivery(sent, { ...CLOUD_DELIVRE, statut: 'ANNULE' }, ['statut'])).toBeNull();
  });

  it('même date et même agent (correction de retirant) -> rien', () => {
    expect(mod.detectDoubleDelivery(sent, CLOUD_DELIVRE, ['nom_retirant', 'apurement_correction_le'])).toBeNull();
  });
});

describe('outbox t_cartes : alerte double délivrance', () => {
  let connection: typeof import('../src/main/database/connection');
  let outbox: typeof import('../src/main/sync/outbox.service');
  let alertMod: typeof import('../src/main/sync/double-delivery-alert');
  let db: import('better-sqlite3').Database;

  beforeAll(async () => {
    connection = await import('../src/main/database/connection');
    outbox = await import('../src/main/sync/outbox.service');
    alertMod = await import('../src/main/sync/double-delivery-alert');
    db = await connection.initDatabase();
    db.prepare(`INSERT OR IGNORE INTO t_sites (id, nom, code, is_active, sync_id) VALUES (?, 'SITE_DD', 'SITE_DD', 1, 'site-dd')`).run(SITE_ID);
    db.prepare(`INSERT OR IGNORE INTO t_sites (id, nom, code, is_active, sync_id) VALUES (?, 'SITE_DD2', 'SITE_DD2', 1, 'site-dd2')`).run(OTHER_SITE_ID);
    db.prepare(`INSERT OR IGNORE INTO t_centres (id, site_id, nom, numero, sync_id) VALUES (?, ?, 'C71', 1, 'centre-dd-71')`).run(CENTRE_ID, SITE_ID);
    db.prepare(`INSERT OR IGNORE INTO t_centres (id, site_id, nom, numero, sync_id) VALUES (72, ?, 'C72', 2, 'centre-dd-72')`).run(SITE_ID);
  });

  afterAll(() => {
    connection.closeDatabase();
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    fake.respond = null;
    sentToRenderer.length = 0;
    db.prepare('DELETE FROM t_outbox').run();
  });

  /** Carte délivrée localement (hors ligne) : DELIVRE, is_dirty = 1, entrée UPDATE PENDING. */
  function seedLocalDelivery(opts: { syncId?: string; statut?: string; siteId?: number; centreId?: number | null } = {}) {
    seq++;
    const syncId = opts.syncId ?? `carte-dd-${seq}`;
    const statut = opts.statut ?? 'DELIVRE';
    const existing = db.prepare('SELECT id_carte FROM t_cartes WHERE sync_id = ?').get(syncId);
    if (!existing) {
      db.prepare(
        `INSERT INTO t_cartes (sync_id, site_id, centre_id, noms, prenoms, date_de_naissance, statut, updated_at, is_dirty)
         VALUES (?, ?, ?, 'KOUASSI', 'AMA', '1990-01-01', 'EN STOCK', '2026-11-24T08:00:00.000Z', 1)`
      ).run(syncId, opts.siteId ?? SITE_ID, opts.centreId === undefined ? CENTRE_ID : opts.centreId);
    }
    if (statut === 'DELIVRE') {
      db.prepare(
        `UPDATE t_cartes SET statut = 'DELIVRE', date_delivrance = '2026-11-24T11:00:00.000Z', agent_distributeur = 'agent.poste',
         nom_retirant = 'RETIRANT POSTE', is_dirty = 1 WHERE sync_id = ?`
      ).run(syncId);
    }
    const full = db.prepare('SELECT * FROM t_cartes WHERE sync_id = ?').get(syncId) as Record<string, unknown>;
    outbox.enqueueOutbox(syncId, 't_cartes', 'UPDATE', full);
    return syncId;
  }

  const alertsFor = (syncId: string) =>
    db.prepare(`SELECT * FROM t_logs WHERE action = 'ALERTE_DOUBLE_DELIVRANCE' AND json_extract(valeur_apres, '$.carte_sync_id') = ?`).all(syncId) as Array<Record<string, any>>;
  const conflictLogs = (syncId: string) =>
    db.prepare(`SELECT * FROM t_logs WHERE action = 'CONFLIT_SYNC_STATUT' AND valeur_apres LIKE ?`).all(`%${syncId}%`) as Array<Record<string, any>>;

  it('délivrance locale écartée : carte alignée, 1 alerte locale non mise en file, signal renderer', async () => {
    const syncId = seedLocalDelivery();
    fake.respond = guardResponse();

    const res = await outbox.processOutboxPending(false, true);
    expect(res.processed).toBe(1);

    const card = db.prepare('SELECT * FROM t_cartes WHERE sync_id = ?').get(syncId) as Record<string, any>;
    expect(card.agent_distributeur).toBe('agent.mobile');
    expect(card.is_dirty).toBe(0);
    expect(conflictLogs(syncId).length).toBe(1); // comportement existant conservé

    const alerts = alertsFor(syncId);
    expect(alerts.length).toBe(1);
    expect(alerts[0].is_dirty).toBe(0);
    expect(alerts[0].is_read).toBe(0);
    expect(alerts[0].site_id).toBe(SITE_ID);
    expect(alerts[0].centre_id).toBe(CENTRE_ID);
    expect(alerts[0].detail).toContain('déjà remise par agent.mobile');
    expect(JSON.parse(alerts[0].valeur_avant).ecarte.agent_distributeur).toBe('agent.poste');
    // Jamais remontée au cloud
    expect(db.prepare(`SELECT COUNT(*) AS n FROM t_outbox WHERE table_name = 't_logs'`).get()).toEqual({ n: 0 });
    expect(sentToRenderer.filter((m) => m.channel === 'sync:double-delivery-alert')).toEqual([
      { channel: 'sync:double-delivery-alert', data: { count: 1 } }
    ]);
  });

  it('même carte vue une seconde fois : pas de doublon d\'alerte ni de nouveau signal', async () => {
    const syncId = seedLocalDelivery();
    fake.respond = guardResponse();
    await outbox.processOutboxPending(false, true);
    expect(alertsFor(syncId).length).toBe(1);

    sentToRenderer.length = 0;
    seedLocalDelivery({ syncId }); // re-délivrance locale de la même carte, nouveau conflit
    await outbox.processOutboxPending(false, true);
    expect(alertsFor(syncId).length).toBe(1);
    expect(sentToRenderer.filter((m) => m.channel === 'sync:double-delivery-alert')).toEqual([]);
  });

  it('simple alignement sans délivrance locale (carte EN STOCK modifiée) : aucune alerte', async () => {
    const syncId = seedLocalDelivery({ statut: 'EN STOCK' });
    fake.respond = guardResponse();
    await outbox.processOutboxPending(false, true);
    expect(conflictLogs(syncId).length).toBe(1);
    expect(alertsFor(syncId).length).toBe(0);
    expect(sentToRenderer.filter((m) => m.channel === 'sync:double-delivery-alert')).toEqual([]);
  });

  it('envoi accepté (pas de garde) : aucune alerte', async () => {
    const syncId = seedLocalDelivery();
    await outbox.processOutboxPending(false, true);
    expect(alertsFor(syncId).length).toBe(0);
  });

  it('liste et acquittement : portée site/centre, acquittement unique et tracé', async () => {
    const mine = seedLocalDelivery();
    const otherCentre = seedLocalDelivery({ centreId: 72 });
    const otherSite = seedLocalDelivery({ siteId: OTHER_SITE_ID, centreId: null });
    fake.respond = guardResponse();
    await outbox.processOutboxPending(false, true);

    const opScope = alertMod.resolveDoubleDeliveryScope({ role: 'OPERATEUR_VERIFICATION', site_id: SITE_ID, centre_id: CENTRE_ID })!;
    const listOp = alertMod.listPendingDoubleDeliveryAlerts(db, opScope).map((a) => a.carte_sync_id);
    expect(listOp).toContain(mine);
    expect(listOp).not.toContain(otherCentre);
    expect(listOp).not.toContain(otherSite);

    // ADMINISTRATEUR_SITE reçoit un centre "principal" au login : il voit pourtant tout son site.
    const adminScope = alertMod.resolveDoubleDeliveryScope({ role: 'ADMINISTRATEUR_SITE', site_id: SITE_ID, centre_id: CENTRE_ID })!;
    const listAdmin = alertMod.listPendingDoubleDeliveryAlerts(db, adminScope).map((a) => a.carte_sync_id);
    expect(listAdmin).toEqual(expect.arrayContaining([mine, otherCentre]));
    expect(listAdmin).not.toContain(otherSite);

    expect(alertMod.resolveDoubleDeliveryScope({ role: 'OPERATEUR_VERIFICATION', site_id: null })).toBeNull();
    expect(alertMod.resolveDoubleDeliveryScope(null)).toBeNull();

    const alertOtherSite = alertMod.listPendingDoubleDeliveryAlerts(db, { siteId: OTHER_SITE_ID, centreId: null, allSites: false })[0];
    // Hors portée : refusé
    expect(alertMod.acknowledgeDoubleDeliveryAlert(db, alertOtherSite.id_log, opScope, { id_user: null, login: 'op1' })).toBe(false);

    const alertMine = alertMod.listPendingDoubleDeliveryAlerts(db, opScope).find((a) => a.carte_sync_id === mine)!;
    expect(alertMine.garde.agent_distributeur).toBe('agent.mobile');
    expect(alertMod.acknowledgeDoubleDeliveryAlert(db, alertMine.id_log, opScope, { id_user: null, login: 'op1' })).toBe(true);
    expect(alertMod.acknowledgeDoubleDeliveryAlert(db, alertMine.id_log, opScope, { id_user: null, login: 'op1' })).toBe(false);
    expect(alertMod.listPendingDoubleDeliveryAlerts(db, opScope).map((a) => a.carte_sync_id)).not.toContain(mine);

    const ack = db.prepare(`SELECT * FROM t_logs WHERE action = 'ALERTE_DOUBLE_DELIVRANCE_ACQUITTEE' AND json_extract(valeur_apres, '$.alerte_id_log') = ?`).all(alertMine.id_log) as Array<Record<string, any>>;
    expect(ack.length).toBe(1);
    expect(ack[0].login_user).toBe('op1');
    expect(ack[0].is_dirty).toBe(0);
    expect(ack[0].site_id).toBe(SITE_ID);
  });
});

// ── upload-worker.js : copie dupliquée de la détection (envoi manuel en masse) ─────────────
const WORKER_TEST_TIMEOUT_MS = 30_000;
const WORKER_RUN_TIMEOUT_MS = 25_000;

describe('upload-worker.js : alerte double délivrance', () => {
  const requireCjs = createRequire(import.meta.url);
  const sqlitePath = requireCjs.resolve('better-sqlite3');
  const workerTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gest-in-situ-test-dd-worker-'));
  const dbPath = path.join(workerTmp, 'upload.db');
  let server: http.Server;
  let port = 0;

  beforeAll(async () => {
    const { runMigrations } = await import('../src/main/database/schema');
    const wdb = new Database(dbPath);
    runMigrations(wdb);
    wdb.prepare(`INSERT OR IGNORE INTO t_sites (id, nom, code, is_active) VALUES (6, 'S6', 'S6', 1)`).run();
    for (const [syncId, statut] of [['w-dd', 'DELIVRE'], ['w-stock', 'EN STOCK']]) {
      wdb.prepare(
        `INSERT INTO t_cartes (sync_id, site_id, noms, prenoms, date_de_naissance, rangement, statut, date_delivrance, agent_distributeur, updated_at, is_dirty)
         VALUES (?, 6, 'YAO', 'KOFFI', '1990-01-01', 'A1', ?, ?, ?, '2026-11-24T08:00:00.000Z', 1)`
      ).run(syncId, statut, statut === 'DELIVRE' ? '2026-11-24T11:00:00.000Z' : null, statut === 'DELIVRE' ? 'agent.poste' : null);
    }
    wdb.pragma('journal_mode = DELETE');
    wdb.close();

    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const rows: any[] = req.method === 'POST' && body ? [].concat(JSON.parse(body)) : [];
        const sel = new URL(req.url || '/', 'http://x').searchParams.get('select');
        let out: any[] = [];
        if (req.method === 'POST' && sel) {
          const cols = sel.split(',').map((s) => s.replace(/"/g, '').trim());
          out = rows.map((r) => guardResponse()(r, cols)); // les deux cartes : garde DELIVRE
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(out));
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => { port = (server.address() as any).port; r(); }));
  }, WORKER_TEST_TIMEOUT_MS);

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    try { fs.rmSync(workerTmp, { recursive: true, force: true }); } catch { /* fichier verrouillé : ignoré */ }
  });

  it('carte DELIVRE écartée -> 1 alerte + message double-delivery ; carte EN STOCK alignée -> aucune', async () => {
    const workerPath = path.join(__dirname, '../src/main/workers/upload-worker.js');
    const messages: any[] = await new Promise((resolve, reject) => {
      const got: any[] = [];
      let settled = false;
      const w = new Worker(workerPath, {
        workerData: {
          siteId: 6, dbPath, sqlitePath,
          supabaseUrl: `http://127.0.0.1:${port}`, supabaseAnonKey: 'mock-key',
          allowProbable: true, allowInvalid: true, allowMissing: true, onlyModified: false
        }
      });
      const finish = (err: Error | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        w.terminate().then(() => (err ? reject(err) : resolve(got)), () => (err ? reject(err) : resolve(got)));
      };
      const timer = setTimeout(() => finish(new Error('worker sans done')), WORKER_RUN_TIMEOUT_MS);
      w.on('message', (m: any) => {
        got.push(m);
        if (m.type === 'done') finish(null);
        else if (m.type === 'error') finish(new Error(m.error));
      });
      w.on('error', (e) => finish(e));
    });

    expect(messages.filter((m) => m.type === 'log' && m.level === 'error')).toEqual([]);
    expect(messages.filter((m) => m.type === 'double-delivery')).toEqual([{ type: 'double-delivery', count: 1 }]);

    const rdb = new Database(dbPath, { readonly: true });
    const alerts = rdb.prepare(`SELECT * FROM t_logs WHERE action = 'ALERTE_DOUBLE_DELIVRANCE'`).all() as Array<Record<string, any>>;
    const conflicts = rdb.prepare(`SELECT COUNT(*) AS n FROM t_logs WHERE action = 'CONFLIT_SYNC_STATUT'`).get() as { n: number };
    rdb.close();
    expect(conflicts.n).toBe(2);
    expect(alerts.length).toBe(1);
    expect(JSON.parse(alerts[0].valeur_apres).carte_sync_id).toBe('w-dd');
    expect(alerts[0].is_dirty).toBe(0);
    expect(alerts[0].site_id).toBe(6);
    expect(alerts[0].detail).toContain('Carte KOFFI YAO déjà remise par agent.mobile');
  }, WORKER_TEST_TIMEOUT_MS);
});
