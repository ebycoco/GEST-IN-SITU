const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { v4: uuidv4 } = require('uuid');
const http = require('http');
const { Worker } = require('worker_threads');

app.whenReady().then(async () => {
  console.log('[TEST] Démarrage des tests de synchronisation...');
  let hasError = false;

  const dbPath = path.join(__dirname, 'test_sync.db');
  let db;
  let mockServer;
  let mockPort = 0;
  let interceptedRequests = [];

  try {
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    db = new Database(dbPath);
    
    // Mock simpliste du schéma
    db.prepare(`
      CREATE TABLE IF NOT EXISTS t_sites (id_site INTEGER PRIMARY KEY, nom_site TEXT, is_active INTEGER)
    `).run();
    db.prepare(`
      CREATE TABLE IF NOT EXISTS t_centres (id_centre INTEGER PRIMARY KEY, site_id INTEGER, nom_centre TEXT)
    `).run();
    db.prepare(`
      CREATE TABLE IF NOT EXISTS t_cartes (
        id_carte INTEGER PRIMARY KEY AUTOINCREMENT,
        noms TEXT, prenoms TEXT, date_de_naissance TEXT,
        site_id INTEGER, is_dirty INTEGER DEFAULT 0,
        sync_id TEXT, synced_at TEXT, statut TEXT DEFAULT 'EN STOCK',
        updated_at TEXT, cle_doublon TEXT, rangement TEXT, num_secu TEXT
      )
    `).run();
    db.prepare(`
      CREATE TABLE IF NOT EXISTS t_import_anomalies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        site_id INTEGER,
        type_anomalie TEXT
      )
    `).run();

    db.prepare(`INSERT OR IGNORE INTO t_sites (id_site, nom_site, is_active) VALUES (4, 'SITE_TEST', 1)`).run();
    db.prepare(`INSERT OR IGNORE INTO t_centres (id_centre, site_id, nom_centre) VALUES (10, 4, 'CENTRE_TEST')`).run();

    mockServer = http.createServer((req, res) => {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        interceptedRequests.push({ method: req.method, url: req.url, body: body ? JSON.parse(body) : null });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: [], error: null }));
      });
    });

    await new Promise((resolve) => {
      mockServer.listen(0, () => {
        mockPort = mockServer.address().port;
        resolve();
      });
    });

    console.log('[TEST 1] Création de carte (is_dirty = 1)');
    const syncId = uuidv4();
    const result = db.prepare(`
      INSERT INTO t_cartes (noms, prenoms, date_de_naissance, site_id, is_dirty, sync_id)
      VALUES ('TEST', 'CREATE', '1990-01-01', 4, 1, ?)
    `).run(syncId);
    let carte = db.prepare('SELECT * FROM t_cartes WHERE id_carte = ?').get(result.lastInsertRowid);
    if (carte.is_dirty !== 1) throw new Error('is_dirty != 1');
    console.log('-> OK');

    console.log('[TEST 2] Soft Delete (is_dirty = -1)');
    db.prepare("UPDATE t_cartes SET is_dirty = -1, updated_at = datetime('now') WHERE id_carte = ?").run(result.lastInsertRowid);
    carte = db.prepare('SELECT is_dirty FROM t_cartes WHERE id_carte = ?').get(result.lastInsertRowid);
    if (carte.is_dirty !== -1) throw new Error('is_dirty != -1');
    console.log('-> OK');

    console.log('[TEST 3] stats-worker.js comptage modifiedCount');
    db.prepare(`
      INSERT INTO t_cartes (noms, prenoms, date_de_naissance, site_id, is_dirty, sync_id, synced_at)
      VALUES ('TEST', 'MODIFIED', '1990-01-01', 4, 1, ?, datetime('now'))
    `).run(uuidv4());

    const workerPath = path.join(__dirname, '../dist/main/workers/stats-worker.js');
    const statsResult = await new Promise((resolve, reject) => {
      const worker = new Worker(workerPath, { workerData: { sqlitePath: 'better-sqlite3', dbPath } });
      worker.on('message', (msg) => {
        if (msg.type === 'log') { console.log(msg.message); return; }
        if (msg.success) resolve(msg.data); 
        else reject(new Error(msg.error?.message || msg.error || JSON.stringify(msg))); 
      });
      worker.on('error', reject);
      worker.postMessage({ type: 'getDetailedSyncStats', siteId: 4, messageId: 'test1' });
    });
    if (statsResult.modifiedCount !== 2) throw new Error(`modifiedCount expected 2, got ${statsResult.modifiedCount}`);
    console.log('-> OK');

    console.log('[TEST 4] upload-worker.js (onlyModified = true)');
    const uploadWorkerPath = path.join(__dirname, '../dist/main/workers/upload-worker.js');
    interceptedRequests = [];
    
    await new Promise((resolve, reject) => {
      const worker = new Worker(uploadWorkerPath, {
        workerData: {
          sqlitePath: 'better-sqlite3',
          siteId: 4, dbPath, supabaseUrl: `http://localhost:${mockPort}`, supabaseAnonKey: 'mock-key',
          allowProbable: true, allowInvalid: true, allowMissing: true, onlyModified: true
        }
      });
      worker.on('message', (msg) => { if (msg.type === 'done' || msg.type === 'error') resolve(); });
      worker.on('error', reject);
    });

    const upsertRequest = interceptedRequests.find(req => req.method === 'POST');
    const deleteRequest = interceptedRequests.find(req => req.method === 'DELETE');
    if (!upsertRequest) throw new Error('Aucun UPSERT envoyé');
    if (!deleteRequest) throw new Error('Aucun DELETE envoyé');

    const countDeleted = db.prepare('SELECT COUNT(*) as c FROM t_cartes WHERE is_dirty = -1').get();
    if (countDeleted.c !== 0) throw new Error('Les cartes is_dirty = -1 n\'ont pas été supprimées de SQLite');
    console.log('-> OK');

    console.log('[TEST 5] Nouvelle fiche saisie (is_dirty = 1, synced_at IS NULL)');
    const syncIdNew = uuidv4();
    db.prepare(`
      INSERT INTO t_cartes (noms, prenoms, date_de_naissance, site_id, is_dirty, sync_id, rangement)
      VALUES ('NOUVEAU', 'TEST', '2000-01-01', 4, 1, ?, 'BOITE 1')
    `).run(syncIdNew);

    const statsResult2 = await new Promise((resolve, reject) => {
      const worker = new Worker(workerPath, { workerData: { sqlitePath: 'better-sqlite3', dbPath } });
      worker.on('message', (msg) => {
        if (msg.type === 'log') { console.log(msg.message); return; }
        if (msg.success) resolve(msg.data); 
        else reject(new Error(msg.error?.message || msg.error || JSON.stringify(msg))); 
      });
      worker.on('error', reject);
      worker.postMessage({ type: 'getDetailedSyncStats', siteId: 4, messageId: 'test2' });
    });
    // La carte est parfaite (dates, etc.), elle devrait être comptée dans cleanCount ou modifiedCount
    if (statsResult2.modifiedCount < 1 && statsResult2.cleanCount < 1) throw new Error('Nouvelle fiche non détectée par le dashboard');

    interceptedRequests = [];
    await new Promise((resolve, reject) => {
      const worker = new Worker(uploadWorkerPath, {
        workerData: {
          sqlitePath: 'better-sqlite3',
          siteId: 4, dbPath, supabaseUrl: `http://localhost:${mockPort}`, supabaseAnonKey: 'mock-key',
          allowProbable: true, allowInvalid: true, allowMissing: true, onlyModified: false
        }
      });
      worker.on('message', (msg) => { if (msg.type === 'done' || msg.type === 'error') resolve(); });
      worker.on('error', reject);
    });

    const newCardUpsert = interceptedRequests.find(req => req.method === 'POST' && req.body && req.body.length > 0 && req.body.some(c => c.sync_id === syncIdNew));
    if (!newCardUpsert) throw new Error('La nouvelle carte n\'a pas été envoyée (UPSERT manquant)');

    const finalCard = db.prepare('SELECT is_dirty, synced_at FROM t_cartes WHERE sync_id = ?').get(syncIdNew);
    if (finalCard.is_dirty !== 0 || !finalCard.synced_at) {
      throw new Error('La date synced_at ou is_dirty n\'a pas été mise à jour en local après envoi');
    }
    console.log('-> OK');

    console.log('[SUCCES] Tous les tests sont passés !');
  } catch (e) {
    console.error('[ERREUR]', e);
    hasError = true;
  } finally {
    if (db) db.close();
    if (mockServer) mockServer.close();
    app.quit(hasError ? 1 : 0);
  }
});
