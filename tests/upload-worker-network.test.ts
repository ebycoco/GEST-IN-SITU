import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as net from 'net';
import * as http from 'http';
import { createRequire } from 'module';
import { Worker } from 'worker_threads';

/**
 * Audit agent-13 2026-10-31, P1-3 — upload-worker.js, réseau qui se bloque en cours d'envoi :
 * - chaque requête a un délai maximal (workerData.requestTimeoutMs ; 60 s par défaut) ;
 * - après 2 blocs consécutifs en échec réseau, l'envoi s'arrête (les autres cartes restent is_dirty=1) ;
 * - le résultat est un ÉCHEC (success=false, message réseau), plus un faux « terminé : 0 cartes traitées ».
 * Vrai worker_thread, vraie base jetable, faux « Supabase » local (serveur TCP muet ou port fermé).
 */

process.env.GEST_IN_SITU_E2E_DISABLE_SYNC = '1';
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gest-in-situ-test-upload-worker-'));

vi.mock('electron', () => ({
  app: { getPath: () => tmpDir, isPackaged: false },
  net: { online: false, request: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] }
}));

const SITE = 8101;
const CARDS = 700; // blocs de 300 : 3 blocs, l'envoi doit s'arrêter après le 2e

describe('upload-worker — délai par requête et arrêt sur réseau défaillant (P1-3)', () => {
  let connection: typeof import('../src/main/database/connection');
  let db: import('better-sqlite3').Database;
  let sqlitePath: string;
  const servers: Array<net.Server | http.Server> = [];

  beforeAll(async () => {
    connection = await import('../src/main/database/connection');
    db = await connection.initDatabase();
    sqlitePath = createRequire(import.meta.url).resolve('better-sqlite3');
    db.prepare(`INSERT INTO t_sites (id, nom, code, is_active, sync_id) VALUES (?, 'W', 'W', 1, 'site-w')`).run(SITE);
    const ins = db.prepare(`INSERT INTO t_cartes (noms, prenoms, date_de_naissance, site_id, sync_id, is_dirty, statut, rangement) VALUES (?, 'P', '1990-01-01', ?, ?, 1, 'EN STOCK', 'A1')`);
    db.transaction(() => { for (let i = 0; i < CARDS; i++) ins.run(`N${i}`, SITE, `w-${i}`); })();
  });

  afterAll(() => {
    for (const s of servers) { s.closeAllConnections?.(); s.close(); }
    connection.closeDatabase();
    try { if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* verrou Windows résiduel : dossier temporaire */ }
  });

  const runWorker = (supabaseUrl: string, requestTimeoutMs: number) =>
    new Promise<{ msgs: any[]; done: any }>((resolve, reject) => {
      const worker = new Worker(path.join(__dirname, '..', 'src', 'main', 'workers', 'upload-worker.js'), {
        workerData: {
          siteId: SITE, centreId: null, allowProbable: true, allowInvalid: true, allowMissing: true, onlyModified: false,
          dbPath: connection.getDbPath(), supabaseUrl, supabaseAnonKey: 'fake', sqlitePath, requestTimeoutMs
        }
      });
      const msgs: any[] = [];
      worker.on('message', m => {
        msgs.push(m);
        if (m.type === 'done' || m.type === 'error') {
          // libère la base (Windows : fichier verrouillé tant que le thread vit) avant de rendre la main
          void worker.terminate().then(() => resolve({ msgs, done: m }));
        }
      });
      worker.on('error', reject);
    });

  const dirtyCount = () => (db.prepare('SELECT COUNT(*) AS n FROM t_cartes WHERE site_id = ? AND is_dirty = 1').get(SITE) as { n: number }).n;

  it('serveur muet : délai par requête, arrêt après 2 blocs, résultat en échec, cartes restées à envoyer', async () => {
    let requests = 0;
    const mute = http.createServer(() => { requests++; }); // reçoit la requête, ne répond jamais
    servers.push(mute);
    await new Promise<void>(r => mute.listen(0, '127.0.0.1', () => r()));
    const port = (mute.address() as net.AddressInfo).port;

    const t0 = Date.now();
    const { done } = await runWorker(`http://127.0.0.1:${port}`, 400);
    const elapsed = Date.now() - t0;

    expect(done.type).toBe('done');
    expect(done.success).toBe(false);
    expect(done.uploadedCount).toBe(0);
    expect(done.message).toContain('Vérifiez la connexion');
    expect(elapsed).toBeLessThan(10000); // 2 × 400 ms + démarrage, très loin des ~5 min mesurés sans délai
    // 2 blocs tentés au plus (la bibliothèque peut rejouer une requête) ; sans l'arrêt, les 3 blocs seraient tentés
    expect(requests).toBeGreaterThanOrEqual(2);
    expect(requests).toBeLessThanOrEqual(4);
    expect(done.message).not.toContain('Synchronisation de masse terminée');
    expect(dirtyCount()).toBe(CARDS);
  }, 30000);

  it('port fermé : échec rapide, même issue', async () => {
    const probe = net.createServer();
    await new Promise<void>(r => probe.listen(0, '127.0.0.1', () => r()));
    const port = (probe.address() as net.AddressInfo).port;
    await new Promise<void>(r => probe.close(() => r()));

    const { done } = await runWorker(`http://127.0.0.1:${port}`, 5000);

    expect(done.success).toBe(false);
    expect(done.uploadedCount).toBe(0);
    expect(dirtyCount()).toBe(CARDS);
  }, 30000);
});
