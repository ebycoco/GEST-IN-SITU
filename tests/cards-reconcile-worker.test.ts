import { describe, it, expect, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { Worker } from 'worker_threads';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

/**
 * Test du VRAI download-worker.js (non modifie) via worker_threads sur un fichier SQLite
 * temporaire (jamais la base reelle), comme le fait downstream.ts. Verifie le contrat
 * skipWatermark utilise par le rattrapage (cards-reconcile.ts) : curseur intact + carte inseree,
 * et, par defaut, curseur bien ecrit (pas de regression du pull normal).
 */

const WORKER_PATH = resolve(__dirname, '../src/main/workers/download-worker.js');
const COLUMNS = [
  'noms', 'prenoms', 'date_de_naissance', 'lieu_de_naissance', 'num_secu', 'lieu_enrolement', 'contact',
  'rangement', 'statut', 'date_delivrance', 'agent_saisie', 'nom_retirant', 'num_retirant',
  'agent_distributeur', 'centre_retrait', 'cle_doublon', 'cle_doublon_flex', 'statut_physique',
  'agent_signalement_absence', 'date_signalement_absence', 'note_signalement_absence', 'escalade_niveau',
  'has_invalid_date', 'contact_retirant', 'relation_retirant', 'date_resolution_absence',
  'agent_resolution_absence', 'note_resolution', 'doublon_declare_par', 'doublon_declare_le', 'doublon_motif',
  'statut_avant_doublon', 'doublon_annule_par', 'doublon_annule_le', 'doublon_motif_annulation',
  'apurement_correction_par', 'apurement_correction_le', 'apurement_correction_motif',
  'apurement_annulation_par', 'apurement_annulation_le', 'apurement_annulation_motif',
  'site_id', 'centre_id', 'poste_id', 'qr_code_data', 'sync_id', 'is_exported',
  'created_at', 'updated_at', 'action_at', 'synced_at', 'is_dirty'
];

const dirs: string[] = [];
afterEach(() => { while (dirs.length) { try { rmSync(dirs.pop()!, { recursive: true, force: true }); } catch { /* ignore */ } } });

function makeTempDb(): string {
  const dir = mkdtempSync(join(tmpdir(), 'reconcile-worker-'));
  dirs.push(dir);
  const dbPath = join(dir, 'test.db');
  const db = new Database(dbPath);
  db.exec(`CREATE TABLE t_cartes (id_carte INTEGER PRIMARY KEY AUTOINCREMENT, ${COLUMNS.join(', ')});
           CREATE TABLE t_config (key TEXT PRIMARY KEY, value TEXT);
           INSERT INTO t_config VALUES ('last_downstream_sync', '2026-01-01T00:00:00Z');
           INSERT INTO t_config VALUES ('last_downstream_sync_id', 'cursor-id-0');`);
  db.close();
  return dbPath;
}

function runWorkerChunk(dbPath: string, msg: Record<string, unknown>): Promise<any> {
  return new Promise((res, rej) => {
    const worker = new Worker(WORKER_PATH, { workerData: { dbPath, sqlitePath: require.resolve('better-sqlite3') } });
    worker.on('message', (m: any) => {
      if (m.type === 'chunk-done') { worker.postMessage({ type: 'close' }); res(m); }
      else if (m.type === 'error') { worker.terminate(); rej(new Error(m.message)); }
    });
    worker.on('error', rej);
    worker.postMessage({ type: 'write-chunk', ...msg });
  });
}

const card = { sync_id: 'sid-new-1', id_site: 7, noms: 'KONE', prenoms: 'AWA', statut: 'EN STOCK', updated_at: '2026-09-01T10:00:00Z' };

function readState(dbPath: string) {
  const db = new Database(dbPath, { readonly: true });
  try {
    const cfg = Object.fromEntries((db.prepare('SELECT key, value FROM t_config').all() as any[]).map(r => [r.key, r.value]));
    const n = (db.prepare("SELECT COUNT(*) n FROM t_cartes WHERE sync_id = 'sid-new-1' AND site_id = 7").get() as any).n;
    return { cfg, n };
  } finally { db.close(); }
}

describe('vrai download-worker.js : contrat skipWatermark', () => {
  it('skipWatermark=true : carte inseree ET curseur last_downstream_sync* inchange', async () => {
    const dbPath = makeTempDb();
    const r = await runWorkerChunk(dbPath, {
      cloudCards: [card], watermark: '1970-01-01T00:00:00Z', lastSyncId: '00000000-0000-0000-0000-000000000000',
      siteId: 7, myCentreId: null, skipWatermark: true
    });
    expect(r.insertedCount).toBe(1);
    const { cfg, n } = readState(dbPath);
    expect(n).toBe(1);
    expect(cfg.last_downstream_sync).toBe('2026-01-01T00:00:00Z');
    expect(cfg.last_downstream_sync_id).toBe('cursor-id-0');
  }, 30000);

  it('defaut (skipWatermark absent) : carte inseree ET curseur ecrit', async () => {
    const dbPath = makeTempDb();
    const r = await runWorkerChunk(dbPath, {
      cloudCards: [card], watermark: '2026-01-01T00:00:00Z', lastSyncId: 'cursor-id-0', siteId: 7, myCentreId: null
    });
    expect(r.insertedCount).toBe(1);
    const { cfg, n } = readState(dbPath);
    expect(n).toBe(1);
    expect(cfg.last_downstream_sync).toBe('2026-09-01T10:00:00Z');
    expect(cfg.last_downstream_sync_id).toBe('sid-new-1');
  }, 30000);
});
