import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/main/database/schema';
import { Worker } from 'worker_threads';
import * as path from 'path';
import * as http from 'http';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

describe('Synchronisation Offline-First (Delta-Sync)', () => {
  let db: Database.Database;
  const dbPath = path.join(__dirname, 'test_sync.db');
  let mockServer: http.Server;
  let mockPort = 0;
  let interceptedRequests: { method: string, url: string, body: any }[] = [];

  beforeAll(async () => {
    // 1. Initialiser la BD temporaire
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    db = new Database(dbPath);
    runMigrations(db);

    // Initialiser les données de base (site_id = 4)
    db.prepare(`INSERT OR IGNORE INTO t_sites (id_site, nom_site, is_active) VALUES (4, 'SITE_TEST', 1)`).run();
    db.prepare(`INSERT OR IGNORE INTO t_centres (id_centre, site_id, nom_centre) VALUES (10, 4, 'CENTRE_TEST')`).run();

    // 2. Démarrer le Mock Server HTTP Supabase
    mockServer = http.createServer((req, res) => {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        interceptedRequests.push({
          method: req.method || 'GET',
          url: req.url || '/',
          body: body ? JSON.parse(body) : null
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: [], error: null }));
      });
    });

    await new Promise<void>((resolve) => {
      mockServer.listen(0, () => {
        mockPort = (mockServer.address() as any).port;
        resolve();
      });
    });
  });

  afterAll(() => {
    db.close();
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    mockServer.close();
  });

  it('devrait marquer une création de carte comme is_dirty = 1', () => {
    const syncId = uuidv4();
    const result = db.prepare(`
      INSERT INTO t_cartes (noms, prenoms, date_de_naissance, site_id, is_dirty, sync_id)
      VALUES ('TEST', 'CREATE', '1990-01-01', 4, 1, ?)
    `).run(syncId);

    const carte = db.prepare('SELECT * FROM t_cartes WHERE id_carte = ?').get(result.lastInsertRowid) as any;
    expect(carte.is_dirty).toBe(1);
    expect(carte.sync_id).toBe(syncId);
  });

  it('devrait passer une carte en is_dirty = -1 lors de la suppression (Soft Delete)', () => {
    const syncId = uuidv4();
    const insertResult = db.prepare(`
      INSERT INTO t_cartes (noms, prenoms, date_de_naissance, site_id, is_dirty, sync_id)
      VALUES ('TEST', 'DELETE', '1990-01-01', 4, 1, ?)
    `).run(syncId);
    const idCarte = insertResult.lastInsertRowid;

    // Simulation du soft delete de deleteCarte()
    db.prepare("UPDATE t_cartes SET is_dirty = -1, updated_at = datetime('now') WHERE id_carte = ?").run(idCarte);

    const carte = db.prepare('SELECT is_dirty FROM t_cartes WHERE id_carte = ?').get(idCarte) as any;
    expect(carte.is_dirty).toBe(-1);
  });

  it('devrait compter les is_dirty = 1 et -1 dans stats-worker.js', async () => {
    
    // Insérer une carte modifiée (is_dirty = 1 et synced_at non null)
    db.prepare(`
      INSERT INTO t_cartes (noms, prenoms, date_de_naissance, site_id, is_dirty, sync_id, synced_at)
      VALUES ('TEST', 'MODIFIED', '1990-01-01', 4, 1, ?, datetime('now'))
    `).run(uuidv4());

    // Exécuter stats-worker.js dans un worker_thread
    const workerPath = path.join(__dirname, '../src/main/workers/stats-worker.js');
    const distPath = path.join(__dirname, '../dist/main/workers/stats-worker.js');
    const targetScript = fs.existsSync(distPath) ? distPath : workerPath;

    const result = await new Promise<any>((resolve, reject) => {
      const worker = new Worker(targetScript, {
        workerData: { sqlitePath: dbPath }
      });
      worker.on('message', (msg) => {
        if (msg.success && msg.data) resolve(msg.data);
      });
      worker.on('error', reject);
      worker.postMessage({ type: 'getDetailedSyncStats', siteId: 4, messageId: 'test1' });
    });

    // 1 modifiée, 1 supprimée (du test précédent) => modifiedCount = 2
    expect(result.modifiedCount).toBe(2);
  });

  it('devrait uploader et supprimer les fiches avec upload-worker.js (onlyModified = true)', async () => {
    const workerPath = path.join(__dirname, '../src/main/workers/upload-worker.js');
    const distPath = path.join(__dirname, '../dist/main/workers/upload-worker.js');
    const targetScript = fs.existsSync(distPath) ? distPath : workerPath;
    
    interceptedRequests = []; // reset

    await new Promise<void>((resolve, reject) => {
      const worker = new Worker(targetScript, {
        workerData: {
          siteId: 4,
          dbPath,
          supabaseUrl: `http://localhost:${mockPort}`,
          supabaseAnonKey: 'mock-key',
          allowProbable: true,
          allowInvalid: true,
          allowMissing: true,
          onlyModified: true
        }
      });
      worker.on('message', (msg) => {
        if (msg.type === 'done' || msg.type === 'error') resolve();
      });
      worker.on('error', reject);
    });

    // Vérifier les requêtes interceptées
    expect(interceptedRequests.length).toBeGreaterThan(0);
    
    // Une requête UPSERT pour is_dirty = 1, et une requête DELETE pour is_dirty = -1
    const upsertRequest = interceptedRequests.find(req => req.method === 'POST');
    const deleteRequest = interceptedRequests.find(req => req.method === 'DELETE');

    expect(upsertRequest).toBeDefined();
    expect(deleteRequest).toBeDefined();

    // Vérifier la purge locale (is_dirty = -1 a été effacé physiquement)
    const countDeleted = db.prepare('SELECT COUNT(*) as c FROM t_cartes WHERE is_dirty = -1').get() as any;
    expect(countDeleted.c).toBe(0); // Supprimé de SQLite !
  });
});
