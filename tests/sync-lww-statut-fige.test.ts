import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as http from 'http';
import { Worker } from 'worker_threads';
import { createRequire } from 'module';
import Database from 'better-sqlite3';

/**
 * Correctif rouge 4 / A-02 (audit 2026-10-26), ETAPE 2 cote POSTE.
 *
 * Le trigger Supabase trg_t_cartes_status_guard (supabase/migrations/0006) ne refuse pas une
 * copie dont le "bloc statut" est plus ancien que le cloud : il garde le bloc cloud (21
 * colonnes), laisse passer les autres champs et pose updated_at = greatest(NEW, OLD) + 1 ms.
 * Le poste doit lire la reponse de l'upsert (.select) et, en cas d'ecart sur le bloc statut,
 * appliquer localement le bloc garde par le cloud (sans toucher les autres champs locaux),
 * updated_at = valeur cloud, is_dirty = 0, et tracer CONFLIT_SYNC_STATUT dans t_logs.
 * Sans trigger (production actuelle), la reponse = l'envoi : comportement strictement inchange.
 *
 * Base jetable, client Supabase simule (outbox) / serveur HTTP local (upload-worker).
 * Aucun appel reseau reel.
 */

process.env.GEST_IN_SITU_E2E_DISABLE_SYNC = '1';
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gest-in-situ-test-lww-statut-'));

vi.mock('electron', () => ({
  app: { getPath: () => tmpDir, isPackaged: false },
  net: { online: true, request: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] }
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

/** Format de sortie PostgREST d'un timestamptz (session UTC) : 2026-10-20T09:00:00+00:00. */
function pgTs(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  return new Date(String(v)).toISOString().replace('.000Z', 'Z').replace('Z', '+00:00');
}

/** Ce que renvoie un upsert ... select(...) SANS trigger : la ligne envoyee, au format cloud. */
function cloudEcho(sent: Record<string, any>, cols: string[]): Record<string, any> {
  const out: Record<string, any> = {};
  for (const c of cols) {
    if (c === 'date_delivrance' || c === 'updated_at' || c === 'action_at') out[c] = pgTs(sent[c]);
    else out[c] = sent[c] === undefined ? null : sent[c];
  }
  return out;
}

/** Bloc DELIVRE garde par le cloud (delivrance faite par un autre poste). */
const CLOUD_DELIVRE = {
  statut: 'DELIVRE',
  date_delivrance: '2026-10-20T09:00:00+00:00',
  agent_distributeur: 'agentA',
  centre_retrait: 'CENTRE A',
  nom_retirant: 'RETIRANT A',
  num_retirant: 'CNI-001',
  contact_retirant: '0700000099',
  relation_retirant: 'TITULAIRE'
};
const CLOUD_UPDATED_AT = '2026-10-27T12:00:00.001+00:00';

const fake = vi.hoisted(() => ({
  /** Construit la ligne renvoyee par le cloud a partir de la ligne envoyee (null = rien). */
  respond: null as null | ((sent: Record<string, any>, cols: string[]) => Record<string, any> | null),
  error: null as null | { message: string; code?: string },
  sent: [] as Array<Record<string, any>>,
  selectCols: [] as string[],
  duringSend: null as null | (() => void)
}));

vi.mock('../src/main/sync/supabase-client', () => ({
  getSupabaseClient: () => ({
    from: () => {
      const run = async (p: any, cols: string[] | null) => {
        const rows = Array.isArray(p) ? p : [p];
        fake.sent.push(...rows);
        const hook = fake.duringSend;
        fake.duringSend = null;
        if (hook) hook();
        if (fake.error) return { data: null, error: fake.error };
        if (!cols) return { data: null, error: null };
        const data = rows
          .map((r) => (fake.respond ? fake.respond(r, cols) : cloudEcho(r, cols)))
          .filter(Boolean);
        return { data, error: null };
      };
      return {
        upsert: (p: any) => ({
          select: (cols: string) => {
            const list = String(cols).split(',').map((s) => s.trim()).filter(Boolean);
            fake.selectCols = list;
            return run(p, list);
          },
          then: (res: any, rej: any) => run(p, null).then(res, rej)
        }),
        delete: () => ({ eq: async () => ({ error: null }) }),
        update: () => ({ eq: async () => ({ error: null }) })
      };
    }
  })
}));

const SITE_ID = 983;
let seq = 0;

describe('outbox t_cartes : lecture de la reponse cloud (bloc statut fige, A-02 etape 2)', () => {
  let connection: typeof import('../src/main/database/connection');
  let outbox: typeof import('../src/main/sync/outbox.service');
  let db: import('better-sqlite3').Database;

  beforeAll(async () => {
    connection = await import('../src/main/database/connection');
    outbox = await import('../src/main/sync/outbox.service');
    db = await connection.initDatabase();
    db.prepare(`INSERT OR IGNORE INTO t_sites (id, nom, code, is_active, sync_id) VALUES (?, 'SITE_LWW', 'SITE_LWW', 1, 'site-lww')`).run(SITE_ID);
  });

  afterAll(() => {
    connection.closeDatabase();
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    fake.respond = null;
    fake.error = null;
    fake.sent = [];
    fake.selectCols = [];
    fake.duringSend = null;
    db.prepare('DELETE FROM t_outbox').run();
  });

  /** Carte EN STOCK modifiee localement (nouveau contact), is_dirty = 1, entree UPDATE PENDING. */
  function seedCard(extra: Record<string, unknown> = {}) {
    seq++;
    const syncId = `carte-lww-${seq}`;
    db.prepare(
      `INSERT INTO t_cartes (sync_id, site_id, noms, prenoms, date_de_naissance, statut, contact, updated_at, is_dirty)
       VALUES (?, ?, 'NOM', 'PRENOM', '1990-01-01', 'EN STOCK', '0711111111', '2026-10-27T10:00:00.000Z', 1)`
    ).run(syncId, SITE_ID);
    for (const [k, v] of Object.entries(extra)) {
      db.prepare(`UPDATE t_cartes SET ${k} = ? WHERE sync_id = ?`).run(v, syncId);
    }
    const full = db.prepare('SELECT * FROM t_cartes WHERE sync_id = ?').get(syncId) as Record<string, unknown>;
    outbox.enqueueOutbox(syncId, 't_cartes', 'UPDATE', full);
    return syncId;
  }

  const card = (syncId: string) => db.prepare('SELECT * FROM t_cartes WHERE sync_id = ?').get(syncId) as Record<string, any>;
  const outboxRow = (id: string) =>
    db.prepare('SELECT status, payload, attempts FROM t_outbox WHERE id = ?').get(id) as { status: string; payload: string; attempts: number };
  const conflictLogs = (syncId: string) =>
    db.prepare(`SELECT * FROM t_logs WHERE action = 'CONFLIT_SYNC_STATUT' AND valeur_apres LIKE ?`).all(`%${syncId}%`) as Array<Record<string, any>>;

  /** Reponse cloud du trigger : bloc DELIVRE garde, autres champs = envoi, updated_at bumpe. */
  const conflictResponse = (sent: Record<string, any>, cols: string[]) => {
    const row = cloudEcho(sent, cols);
    for (const c of STATUS_BLOCK) if (c in row) row[c] = null;
    Object.assign(row, CLOUD_DELIVRE);
    row.updated_at = CLOUD_UPDATED_AT;
    return row;
  };

  it('(a) conflit : bloc DELIVRE du cloud applique, contact local conserve, is_dirty 0, updated_at cloud, 1 t_logs, outbox SYNCED', async () => {
    const syncId = seedCard();
    fake.respond = conflictResponse;

    const res = await outbox.processOutboxPending(false, true);

    expect(res.processed).toBe(1);
    // .select limite aux colonnes utiles (bloc statut + sync_id + updated_at)
    expect(fake.selectCols).toContain('statut');
    expect(fake.selectCols).toContain('updated_at');
    expect(fake.selectCols).toContain('sync_id');
    expect(fake.selectCols).not.toContain('noms');
    expect(fake.selectCols).not.toContain('contact');

    const c = card(syncId);
    expect(c.statut).toBe('DELIVRE');
    expect(c.date_delivrance).toBe(CLOUD_DELIVRE.date_delivrance);
    expect(c.agent_distributeur).toBe('agentA');
    expect(c.centre_retrait).toBe('CENTRE A');
    expect(c.nom_retirant).toBe('RETIRANT A');
    expect(c.num_retirant).toBe('CNI-001');
    expect(c.contact_retirant).toBe('0700000099');
    expect(c.relation_retirant).toBe('TITULAIRE');
    expect(c.contact).toBe('0711111111'); // champ hors bloc : la valeur locale reste
    expect(c.noms).toBe('NOM');
    expect(c.is_dirty).toBe(0);
    expect(c.updated_at).toBe(CLOUD_UPDATED_AT);

    expect(outboxRow(syncId).status).toBe('SYNCED');
    // Aucune nouvelle mise en file pour la carte (le cloud est deja juste)
    expect(db.prepare(`SELECT COUNT(*) AS n FROM t_outbox WHERE status = 'PENDING'`).get()).toEqual({ n: 0 });

    const logs = conflictLogs(syncId);
    expect(logs.length).toBe(1);
    expect(logs[0].id_user).toBeNull();
    expect(logs[0].site_id).toBe(SITE_ID);
    expect(JSON.parse(logs[0].valeur_apres).garde.statut).toBe('DELIVRE');
    expect(JSON.parse(logs[0].valeur_avant).ecarte.statut).toBe('EN STOCK');
  });

  it('(b) reponse identique a l\'envoi (production sans trigger) : comportement inchange, aucun t_logs de conflit', async () => {
    const syncId = seedCard();
    const before = card(syncId);

    const res = await outbox.processOutboxPending(false, true);

    expect(res.processed).toBe(1);
    const c = card(syncId);
    expect(c.statut).toBe('EN STOCK');
    expect(c.updated_at).toBe(before.updated_at); // non modifie (comportement actuel)
    expect(c.is_dirty).toBe(0);
    expect(outboxRow(syncId).status).toBe('SYNCED');
    expect(conflictLogs(syncId).length).toBe(0);
  });

  it('(b2) sans trigger, carte DELIVRE avec date locale ISO "Z" renvoyee en "+00:00" : pas de faux conflit', async () => {
    const syncId = seedCard({
      statut: 'DELIVRE', date_delivrance: '2026-10-21T08:30:15.123Z', agent_distributeur: 'agentB',
      nom_retirant: 'R B', doublon_declare_le: '2026-10-01T00:00:00.000Z'
    });
    const res = await outbox.processOutboxPending(false, true);
    expect(res.processed).toBe(1);
    const c = card(syncId);
    expect(c.date_delivrance).toBe('2026-10-21T08:30:15.123Z'); // valeur locale intacte
    expect(c.is_dirty).toBe(0);
    expect(conflictLogs(syncId).length).toBe(0);
  });

  it('(b3) reponse vide (ligne non renvoyee) : comportement actuel, aucun conflit', async () => {
    const syncId = seedCard();
    fake.respond = () => null;
    const res = await outbox.processOutboxPending(false, true);
    expect(res.processed).toBe(1);
    expect(card(syncId).statut).toBe('EN STOCK');
    expect(outboxRow(syncId).status).toBe('SYNCED');
    expect(conflictLogs(syncId).length).toBe(0);
  });

  it('(d) course : outbox modifiee pendant l\'envoi + conflit => la nouvelle version locale en attente n\'est pas perdue', async () => {
    const syncId = seedCard();
    fake.respond = conflictResponse;
    fake.duringSend = () => {
      db.prepare(`UPDATE t_cartes SET contact = '0722222222', is_dirty = 1 WHERE sync_id = ?`).run(syncId);
      const full = db.prepare('SELECT * FROM t_cartes WHERE sync_id = ?').get(syncId) as Record<string, unknown>;
      outbox.enqueueOutbox(syncId, 't_cartes', 'UPDATE', full);
    };

    const res = await outbox.processOutboxPending(false, true);

    expect(res.processed).toBe(0);
    const row = outboxRow(syncId);
    expect(row.status).toBe('PENDING');
    expect(JSON.parse(row.payload).contact).toBe('0722222222');
    const c = card(syncId);
    expect(c.contact).toBe('0722222222');
    expect(c.is_dirty).toBe(1);
    expect(c.statut).toBe('EN STOCK'); // pas d'application tant que la nouvelle version n'est pas partie
    expect(conflictLogs(syncId).length).toBe(0);

    // Envoi suivant de la nouvelle version : le cloud re-arbitre, le bloc cloud est alors applique.
    const res2 = await outbox.processOutboxPending(false, true);
    expect(res2.processed).toBe(1);
    const c2 = card(syncId);
    expect(c2.statut).toBe('DELIVRE');
    expect(c2.contact).toBe('0722222222');
    expect(c2.is_dirty).toBe(0);
    expect(outboxRow(syncId).status).toBe('SYNCED');
    expect(conflictLogs(syncId).length).toBe(1);
  });
});

// ── (c) upload-worker.js : envoi manuel en masse, reponse lue par lot ─────────────
// Stabilite (2026-10-27) : chaque cas lance un vrai worker_threads qui charge supabase-js et
// better-sqlite3 a froid (~1,6 s seul, ~3-4 s quand les 67 fichiers tournent en parallele),
// trop pres du delai Vitest par defaut (5 s). D'ou : delai explicite, base propre par cas,
// serveur sur 127.0.0.1, et echec explicite (message + journaux du worker) si le worker
// signale une erreur ou s'arrete sans 'done'.
const WORKER_TEST_TIMEOUT_MS = 30_000;
const WORKER_RUN_TIMEOUT_MS = 25_000;

describe('(c) upload-worker.js : lecture de la reponse cloud par lot', () => {
  const requireCjs = createRequire(import.meta.url);
  const sqlitePath = requireCjs.resolve('better-sqlite3');
  const workerTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gest-in-situ-test-lww-worker-'));
  /** Base migree une seule fois, copiee pour chaque cas (aucun etat partage entre (c) et (c2)). */
  const templatePath = path.join(workerTmp, 'template.db');
  let dbPath = '';
  let dbSeq = 0;
  let server: http.Server;
  let port = 0;
  const requests: Array<{ url: string; prefer: string; body: any[] }> = [];
  /** sync_id des cartes pour lesquelles le serveur simule la garde du trigger. */
  let conflictIds = new Set<string>();

  beforeAll(async () => {
    const { runMigrations } = await import('../src/main/database/schema');
    const wdb = new Database(templatePath);
    runMigrations(wdb);
    wdb.prepare(`INSERT OR IGNORE INTO t_sites (id, nom, code, is_active) VALUES (5, 'S5', 'S5', 1)`).run();
    // Base autonome (pas de -wal/-shm a copier) avant duplication.
    wdb.pragma('journal_mode = DELETE');
    wdb.close();

    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const rows: any[] = req.method === 'POST' && body ? [].concat(JSON.parse(body)) : [];
        requests.push({ url: req.url || '', prefer: String(req.headers['prefer'] || ''), body: rows });
        const u = new URL(req.url || '/', 'http://x');
        const sel = u.searchParams.get('select');
        let out: any[] = [];
        if (req.method === 'POST' && sel) {
          const cols = sel.split(',').map((s) => s.replace(/"/g, '').trim());
          out = rows.map((r) => {
            const row = cloudEcho(r, cols);
            if (conflictIds.has(r.sync_id)) {
              for (const c of STATUS_BLOCK) if (c in row) row[c] = null;
              Object.assign(row, CLOUD_DELIVRE);
              row.updated_at = CLOUD_UPDATED_AT;
            }
            return row;
          });
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(out));
      });
    });
    // 127.0.0.1 explicite (serveur ET URL du worker) : pas de resolution de "localhost"
    // (IPv6 ::1 / IPv4) sous charge.
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => { port = (server.address() as any).port; r(); }));
  }, WORKER_TEST_TIMEOUT_MS);

  beforeEach(() => {
    dbSeq++;
    dbPath = path.join(workerTmp, `upload-${dbSeq}.db`);
    fs.copyFileSync(templatePath, dbPath);
    conflictIds = new Set();
    requests.length = 0;
  });

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    try { fs.rmSync(workerTmp, { recursive: true, force: true }); } catch { /* fichier encore verrouille : ignore */ }
  });

  type WorkerMsg = { type: string; [k: string]: any };

  /**
   * Lance upload-worker.js et attend son message 'done'. Rejette (message + journaux du worker)
   * sur 'error', sur une erreur du thread, sur un arret sans 'done' ou au-dela de
   * WORKER_RUN_TIMEOUT_MS. Le thread est toujours termine (base liberee) avant de rendre la main.
   */
  function runWorker(): Promise<{ done: WorkerMsg; logs: WorkerMsg[] }> {
    const workerPath = path.join(__dirname, '../src/main/workers/upload-worker.js');
    return new Promise((resolve, reject) => {
      const logs: WorkerMsg[] = [];
      let settled = false;
      const w = new Worker(workerPath, {
        workerData: {
          siteId: 5, dbPath, sqlitePath,
          supabaseUrl: `http://127.0.0.1:${port}`, supabaseAnonKey: 'mock-key',
          allowProbable: true, allowInvalid: true, allowMissing: true, onlyModified: false
        }
      });
      const journal = () => logs.map((l) => `[${l.level}] ${l.message}`).join(' | ') || '(aucun)';
      const finish = (err: Error | null, done?: WorkerMsg) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        w.terminate().then(
          () => (err ? reject(err) : resolve({ done: done!, logs })),
          () => (err ? reject(err) : resolve({ done: done!, logs }))
        );
      };
      const timer = setTimeout(
        () => finish(new Error(`upload-worker sans 'done' apres ${WORKER_RUN_TIMEOUT_MS} ms. Journaux : ${journal()}`)),
        WORKER_RUN_TIMEOUT_MS
      );
      w.on('message', (m: WorkerMsg) => {
        if (m.type === 'log') logs.push(m);
        else if (m.type === 'done') finish(null, m);
        else if (m.type === 'error') finish(new Error(`upload-worker a signale une erreur : ${m.error}. Journaux : ${journal()}`));
      });
      w.on('error', (e: Error) => finish(new Error(`upload-worker a plante : ${e.message}. Journaux : ${journal()}`)));
      w.on('exit', (code) => finish(new Error(`upload-worker arrete (code ${code}) sans 'done'. Journaux : ${journal()}`)));
    });
  }

  /** Aucun journal 'error' du worker (ex. ECHEC bloc / Exception bloc / Erreur SQLite locale). */
  const errorLogs = (logs: WorkerMsg[]) => logs.filter((l) => l.level === 'error').map((l) => l.message);

  function seed(syncId: string) {
    const wdb = new Database(dbPath);
    wdb.prepare(
      `INSERT INTO t_cartes (sync_id, site_id, noms, prenoms, date_de_naissance, rangement, statut, contact, updated_at, is_dirty)
       VALUES (?, 5, 'NOM', 'PRENOM', '1990-01-01', 'A1', 'EN STOCK', '0733333333', '2026-10-27T10:00:00.000Z', 1)`
    ).run(syncId);
    wdb.close();
  }

  const readCard = (syncId: string) => {
    const rdb = new Database(dbPath, { readonly: true });
    const r = rdb.prepare('SELECT * FROM t_cartes WHERE sync_id = ?').get(syncId) as Record<string, any>;
    rdb.close();
    return r;
  };
  const readConflictLogs = () => {
    const rdb = new Database(dbPath, { readonly: true });
    const r = rdb.prepare(`SELECT * FROM t_logs WHERE action = 'CONFLIT_SYNC_STATUT'`).all() as Array<Record<string, any>>;
    rdb.close();
    return r;
  };

  it('(c) 2 cartes, 1 en conflit : seule celle-ci prend le bloc cloud ; l\'autre suit le chemin actuel (updated_at = pushedAt)', async () => {
    seed('w-ok');
    seed('w-conflit');
    conflictIds = new Set(['w-conflit']);

    const { done, logs: workerLogs } = await runWorker();
    expect(errorLogs(workerLogs)).toEqual([]);
    expect(done.uploadedCount).toBe(2);

    const post = requests.find((r) => r.url.startsWith('/rest/v1/t_cartes') && r.body.length > 0);
    expect(post).toBeDefined();
    // .select limite aux colonnes utiles
    const sel = new URL(post!.url, 'http://x').searchParams.get('select') || '';
    expect(sel).toContain('statut');
    expect(sel).toContain('updated_at');
    expect(sel).not.toContain('noms');
    const sentOk = post!.body.find((r: any) => r.sync_id === 'w-ok');
    const pushedAt = sentOk.updated_at;

    const ok = readCard('w-ok');
    expect(ok.statut).toBe('EN STOCK');
    expect(ok.is_dirty).toBe(0);
    expect(ok.updated_at).toBe(pushedAt);

    const cf = readCard('w-conflit');
    expect(cf.statut).toBe('DELIVRE');
    expect(cf.date_delivrance).toBe(CLOUD_DELIVRE.date_delivrance);
    expect(cf.agent_distributeur).toBe('agentA');
    expect(cf.nom_retirant).toBe('RETIRANT A');
    expect(cf.contact).toBe('0733333333');
    expect(cf.is_dirty).toBe(0);
    expect(cf.updated_at).toBe(CLOUD_UPDATED_AT);

    const logs = readConflictLogs();
    expect(logs.length).toBe(1);
    expect(logs[0].id_user).toBeNull();
    expect(logs[0].site_id).toBe(5);
    expect(JSON.parse(logs[0].valeur_apres).sync_id).toBe('w-conflit');
  }, WORKER_TEST_TIMEOUT_MS);

  it('(c2) sans trigger (reponse = envoi) : aucun conflit, comportement actuel', async () => {
    seed('w-ok-2');
    conflictIds = new Set();

    const { done, logs: workerLogs } = await runWorker();
    expect(errorLogs(workerLogs)).toEqual([]);
    expect(done.uploadedCount).toBe(1);

    const post = requests.find((r) => r.url.startsWith('/rest/v1/t_cartes') && r.body.some((b: any) => b.sync_id === 'w-ok-2'));
    expect(post).toBeDefined();
    const sent = post!.body.find((r: any) => r.sync_id === 'w-ok-2');
    const c = readCard('w-ok-2');
    expect(c.statut).toBe('EN STOCK');
    expect(c.is_dirty).toBe(0);
    expect(c.updated_at).toBe(sent.updated_at);
    expect(readConflictLogs().length).toBe(0);
  }, WORKER_TEST_TIMEOUT_MS);
});
