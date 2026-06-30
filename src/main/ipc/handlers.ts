import { ipcMain, dialog, app, BrowserWindow } from 'electron';
import * as queries from '../database/queries';
import { getDbPath, getDatabase } from '../database/connection';
import { createReadStream } from 'fs';
import { join } from 'path';
import log from 'electron-log';
import * as readline from 'readline';
import { Worker } from 'worker_threads';
import { networkMonitor } from '../sync/network-monitor';
import { syncEngine } from '../sync/sync-engine';
import { runBulkUpload } from '../sync/bulk-uploader';

export function registerIpcHandlers(mainWindow: BrowserWindow): void {
  // Écouteur de changement d'état réseau pour notifier le Renderer
  networkMonitor.on('change', async ({ newState }) => {
    try {
      const db = getDatabase();
      let queueCount = 0;
      if (db) {
        const row = db.prepare("SELECT COUNT(*) as count FROM t_sync_queue WHERE synced = 0").get() as { count: number } | undefined;
        queueCount = row ? row.count : 0;
      }
      
      let lastSync = 'Jamais';
      if (db) {
        const row = db.prepare("SELECT value FROM t_config WHERE key = 'last_downstream_sync'").get() as { value: string } | undefined;
        if (row && row.value) lastSync = row.value;
      }

      mainWindow.webContents.send('sync:status-changed', {
        state: newState,
        lastSync,
        queueCount
      });
    } catch (err) {
      log.error('Failed to send sync status change to renderer:', err);
    }
  });
  // AUTH
  ipcMain.handle('auth:login', (_, login: string, password: string) => {
    try { return queries.authenticateUser(login, password); }
    catch (e) { log.error('Auth error', e); return null; }
  });

  // CARTES
  ipcMain.handle('cartes:getPage', async (_, offset, limit, filters) => {
    try { return queries.getCartesPage(offset, limit, filters); }
    catch (e) { log.error('IPC Error: cartes:getPage', e); throw e; }
  });
  ipcMain.handle('cartes:search', async (_, query, limit, filters) => {
    try { return queries.searchCartesFTS(query, limit, filters); }
    catch (e) { log.error('IPC Error: cartes:search', e); throw e; }
  });
  ipcMain.handle('cartes:getById', async (_, id) => {
    try { return queries.getCarteById(id); }
    catch (e) { log.error('IPC Error: cartes:getById', e); throw e; }
  });
  ipcMain.handle('cartes:create', async (_, data) => {
    try { 
      const siteId = Number(data.site_id);
      if (!siteId) throw new Error("site_id manquant ou invalide.");
      return queries.createCarte(data, siteId); 
    }
    catch (e) { log.error('IPC Error: cartes:create', e); throw e; }
  });
  ipcMain.handle('cartes:update', async (_, id, data) => {
    try { return queries.updateCarte(id, data); }
    catch (e) { log.error('IPC Error: cartes:update', e); throw e; }
  });
  ipcMain.handle('cartes:delete', async (_, id) => {
    try { return queries.deleteCarte(id); }
    catch (e) { log.error('IPC Error: cartes:delete', e); throw e; }
  });
  ipcMain.handle('cartes:delivrer', async (_, id, data, currentUser) => {
    try { return queries.delivrerCarte(id, data, currentUser); }
    catch (e) { log.error('IPC Error: cartes:delivrer', e); throw e; }
  });
  ipcMain.handle('cartes:signalerAbsence', async (_, id, agent) => {
    try { return queries.signalerAbsence(id, agent); }
    catch (e) { log.error('IPC Error: cartes:signalerAbsence', e); throw e; }
  });
  ipcMain.handle('cartes:getAbsences', async (_, siteId?: number) => {
    try { return queries.getAbsencesReportees(siteId); }
    catch (e) { log.error('IPC Error: cartes:getAbsences', e); throw e; }
  });
  ipcMain.handle('cartes:getAgentAbsences', async (_, agent: string, siteId?: number) => {
    try { return queries.getAgentReportedAbsences(agent, siteId); }
    catch (e) { log.error('IPC Error: cartes:getAgentAbsences', e); throw e; }
  });
  ipcMain.handle('cartes:resoudreAbsence', async (_, id, data) => {
    try { return queries.resoudreAbsence(id, data); }
    catch (e) { log.error('IPC Error: cartes:resoudreAbsence', e); throw e; }
  });
  ipcMain.handle('cartes:declarerPerdue', async (_, id) => {
    try { return queries.declarerPerdue(id); }
    catch (e) { log.error('IPC Error: cartes:declarerPerdue', e); throw e; }
  });
  ipcMain.handle('cartes:getInvalidDates', async (_, siteId?: number) => {
    try { return queries.getInvalidDateRecords(siteId); }
    catch (e) { log.error('IPC Error: cartes:getInvalidDates', e); throw e; }
  });
  ipcMain.handle('cartes:updateDate', async (_, id, newDate) => {
    try { return queries.updateDateDeNaissance(id, newDate); }
    catch (e) { log.error('IPC Error: cartes:updateDate', e); throw e; }
  });

   ipcMain.handle('stats:get', (_, siteId) => queries.getStats(siteId));
  ipcMain.handle('stats:getGlobal', async () => {
    try { return queries.getGlobalStats(); }
    catch (e) { log.error('IPC Error: stats:getGlobal', e); throw e; }
  });
  ipcMain.handle('stats:getConsultant', async (_, agentUsername, siteId) => {
    try { return queries.getConsultantStats(agentUsername, siteId); }
    catch (e) { log.error('IPC Error: stats:getConsultant', e); throw e; }
  });
  ipcMain.handle('stats:getCardsToday', async (_, agentUsername, siteId) => {
    try { return queries.getConsultantCardsToday(agentUsername, siteId); }
    catch (e) { log.error('IPC Error: stats:getCardsToday', e); throw e; }
  });

  // IMPORT - File selection
  ipcMain.handle('import:selectFile', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        { name: 'Fichiers données', extensions: ['csv', 'xlsx', 'xls'] },
        { name: 'Tous', extensions: ['*'] }
      ]
    });
    return result.canceled ? null : result.filePaths[0];
  });

  // IMPORT - Preview (only reads first 1000 rows + counts total)
  ipcMain.handle('import:parseCSV', async (_, filePath: string) => {
    try {
      const rows: any[] = [];
      let headers: string[] = [];
      let total = 0;

      const fileStream = createReadStream(filePath);
      const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
      let lineCount = 0;
      let sep = ',';

      for await (const line of rl) {
        if (!line.trim()) continue;
        if (lineCount === 0) {
          sep = line.includes(';') ? ';' : ',';
          headers = line.split(sep).map(h => h.trim().replace(/"/g, ''));
        } else {
          if (rows.length < 1000) {
            const cols = line.split(sep).map(c => c.trim().replace(/^"|"$/g, ''));
            const row: Record<string, string> = {};
            headers.forEach((h, i) => {
              row[h.toLowerCase().replace(/\s+/g, '_')] = cols[i] || '';
            });
            rows.push(row);
          }
        }
        lineCount++;
      }
      total = lineCount > 0 ? lineCount - 1 : 0;

      return { rows, headers, total };
    } catch (e) {
      log.error('File parse error', e);
      return { rows: [], headers: [], error: String(e) };
    }
  });

  // IMPORT - Utilities
  ipcMain.handle('import:clearTemp', (_, siteId) => {
    if (siteId === undefined || siteId === null) {
      throw new Error('siteId requis pour nettoyer la table temporaire d\'import.');
    }
    return queries.clearImportTemp(Number(siteId));
  });
  ipcMain.handle('import:executeBatch', (_, rows, agent, siteId) => queries.importBatch(rows, agent, siteId));
  ipcMain.handle('import:fusionner', (_, agent, siteId) => queries.fusionnerImport(siteId));

  // IMPORT - Process file using Worker Thread (NON-BLOCKING!)
  ipcMain.handle('import:processFile', (_, filePath: string, agent: string, totalEstimate: number, siteId?: number) => {
    return new Promise((resolve, reject) => {
      // Resolve the path to better-sqlite3 native module
      let sqlitePath: string;
      try {
        sqlitePath = require.resolve('better-sqlite3');
      } catch {
        sqlitePath = 'better-sqlite3';
      }

      // Path to our worker script
      const workerPath = join(__dirname, 'workers', 'import-worker.js');

      log.info(`Starting import worker: ${workerPath}`);
      log.info(`SQLite path: ${sqlitePath}`);
      log.info(`DB path: ${getDbPath()}`);
      log.info(`File: ${filePath}, Total estimate: ${totalEstimate}`);

      const worker = new Worker(workerPath, {
        workerData: {
          sqlitePath,
          dbPath: getDbPath(),
          filePath,
          agent,
          siteId,
          totalEstimate: totalEstimate || 220000
        }
      });

      worker.on('message', (msg: any) => {
        if (msg.type === 'progress') {
          if (!mainWindow.isDestroyed()) {
            mainWindow.webContents.send('import:progress', msg.value);
          }
        } else if (msg.type === 'done') {
          log.info('Import worker completed', msg.result);
          resolve(msg.result);
        } else if (msg.type === 'error') {
          log.error('Import worker error', msg.error);
          reject(new Error(msg.error));
        }
      });

      worker.on('error', (err) => {
        log.error('Worker thread error', err);
        reject(err);
      });

      worker.on('exit', (code) => {
        if (code !== 0) {
          log.error(`Worker exited with code ${code}`);
          reject(new Error(`Worker stopped with exit code ${code}`));
        }
      });
    });
  });

  // EXPORT - CSV with save dialog
  ipcMain.handle('export:csv', async (_, filters?: Record<string, string>) => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Exporter les cartes en CSV',
      defaultPath: `cartes_export_${new Date().toISOString().slice(0, 10)}.csv`,
      filters: [
        { name: 'Fichier CSV', extensions: ['csv'] },
        { name: 'Tous', extensions: ['*'] }
      ]
    });
    if (result.canceled || !result.filePath) return { success: false, reason: 'cancelled' };

    try {
      const rows = queries.exportCartes(filters) as Record<string, unknown>[];
      if (rows.length === 0) return { success: false, reason: 'no_data' };

      const headers = Object.keys(rows[0]);
      const csvLines = [
        headers.join(';'),
        ...rows.map(r => headers.map(h => {
          const val = String(r[h] ?? '').replace(/"/g, '""');
          return `"${val}"`;
        }).join(';'))
      ];

      const { writeFileSync } = await import('fs');
      writeFileSync(result.filePath, '\uFEFF' + csvLines.join('\r\n'), 'utf-8');

      log.info(`Export CSV: ${rows.length} rows to ${result.filePath}`);
      return { success: true, count: rows.length, path: result.filePath };
    } catch (e) {
      log.error('Export CSV error', e);
      return { success: false, reason: String(e) };
    }
  });

  // USERS
  ipcMain.handle('users:getAll', (_, siteId?: number) => queries.getUsers(siteId));
  ipcMain.handle('users:create', (_, data) => queries.createUser(data));
  ipcMain.handle('users:update', (_, id, data) => queries.updateUser(id, data));
  ipcMain.handle('users:delete', (_, id) => queries.deleteUser(id));
  ipcMain.handle('users:hardDelete', (_, id) => queries.hardDeleteUser(id));

  // LOGS
  ipcMain.handle('logs:get', (_, offset, limit, filters) => queries.getLogs(offset, limit, filters));
  ipcMain.handle('logs:add', (_, userId, login, action, detail) => queries.logAction(userId, login, action, detail));
  ipcMain.handle('logs:purge', () => queries.purgeLogs());

  // HIERARCHY
  ipcMain.handle('hierarchy:getSites', async () => {
    try { return queries.getSites(); }
    catch (e) { log.error('IPC Error: hierarchy:getSites', e); throw e; }
  });
  ipcMain.handle('hierarchy:getSitesSummary', async () => {
    try { return queries.getSitesSummary(); }
    catch (e) { log.error('IPC Error: hierarchy:getSitesSummary', e); throw e; }
  });
  ipcMain.handle('hierarchy:createSite', async (_, data) => {
    try { return queries.createSite(data); }
    catch (e) { log.error('IPC Error: hierarchy:createSite', e); throw e; }
  });
  ipcMain.handle('hierarchy:updateSite', async (_, id, data) => {
    try { return queries.updateSite(id, data); }
    catch (e) { log.error('IPC Error: hierarchy:updateSite', e); throw e; }
  });
  ipcMain.handle('hierarchy:deleteSite', async (_, id) => {
    try { return queries.deleteSite(id); }
    catch (e) { log.error('IPC Error: hierarchy:deleteSite', e); throw e; }
  });
  ipcMain.handle('hierarchy:resetAdminPassword', async (_, siteId, pass) => {
    try { return queries.resetSiteAdminPassword(siteId, pass); }
    catch (e) { log.error('IPC Error: hierarchy:resetAdminPassword', e); throw e; }
  });
  ipcMain.handle('hierarchy:verifyPassword', async (_, password) => {
    try { return queries.verifySuperAdminPassword(password); }
    catch (e) { log.error('IPC Error: hierarchy:verifyPassword', e); throw e; }
  });
  ipcMain.handle('hierarchy:getCentres', async (_, siteId) => {
    try { return queries.getCentres(siteId); }
    catch (e) { log.error('IPC Error: hierarchy:getCentres', e); throw e; }
  });
  ipcMain.handle('hierarchy:createCentre', async (_, data) => {
    try { return queries.createCentre(data); }
    catch (e) { log.error('IPC Error: hierarchy:createCentre', e); throw e; }
  });
  ipcMain.handle('hierarchy:updateCentre', async (_, id, data) => {
    try { return queries.updateCentre(id, data); }
    catch (e) { log.error('IPC Error: hierarchy:updateCentre', e); throw e; }
  });
  ipcMain.handle('hierarchy:getPostes', async (_, centreId) => {
    try { return queries.getPostes(centreId); }
    catch (e) { log.error('IPC Error: hierarchy:getPostes', e); throw e; }
  });

  // CONFIG
  ipcMain.handle('config:get', (_, key) => queries.getConfig(key));
  ipcMain.handle('config:set', (_, key, value) => queries.setConfig(key, value));
  ipcMain.handle('config:getAll', () => queries.getAllConfig());

  // APP INFO
  ipcMain.handle('app:getVersion', () => app.getVersion());
  ipcMain.handle('app:getDbPath', () => getDbPath());
  ipcMain.handle('db:purge', async () => {
    try { return queries.purgeLocalDatabase(); }
    catch (e) { log.error('IPC Error: db:purge', e); throw e; }
  });
  ipcMain.handle('db:getCardCount', async () => {
    try { return queries.getLocalCardCount(); }
    catch (e) { log.error('IPC Error: db:getCardCount', e); throw e; }
  });

  // MAINTENANCE
  ipcMain.handle('maintenance:clearAll', async (event) => {
    try {
      return await queries.clearDatabaseCartes(undefined, (percent) => {
        event.sender.send('maintenance-progress', percent);
      });
    } catch (e) {
      log.error('IPC Error: maintenance:clearAll', e);
      throw e;
    }
  });
  ipcMain.handle('maintenance:clearDatabaseCartes', async (event, siteId) => {
    try {
      return await queries.clearDatabaseCartes(siteId, (percent) => {
        event.sender.send('maintenance-progress', percent);
      });
    } catch (e) {
      log.error('IPC Error: maintenance:clearDatabaseCartes', e);
      throw e;
    }
  });
  ipcMain.handle('maintenance:fullReset', async (event) => {
    try {
      return await queries.fullSystemReset((percent) => {
        event.sender.send('maintenance-progress', percent);
      });
    } catch (e) {
      log.error('IPC Error: maintenance:fullReset', e);
      throw e;
    }
  });

  // SYNC
  ipcMain.handle('sync:getStatus', () => {
    const db = getDatabase();
    let queueCount = 0;
    if (db) {
      const row = db.prepare("SELECT COUNT(*) as count FROM t_sync_queue WHERE synced = 0").get() as { count: number } | undefined;
      queueCount = row ? row.count : 0;
    }
    
    let lastSync = 'Jamais';
    if (db) {
      const row = db.prepare("SELECT value FROM t_config WHERE key = 'last_downstream_sync'").get() as { value: string } | undefined;
      if (row && row.value) lastSync = row.value;
    }

    return {
      state: networkMonitor.getState(),
      lastSync,
      queueCount
    };
  });

  ipcMain.handle('sync:force', async () => {
    return syncEngine.forceSync();
  });

  ipcMain.handle('sync:startBulk', async (_, siteId: number) => {
    try {
      return await runBulkUpload(Number(siteId), (progress: number) => {
        mainWindow.webContents.send('sync:bulk-progress', progress);
      });
    } catch (err: any) {
      log.error('IPC sync:startBulk error:', err);
      return { success: false, uploadedCount: 0, message: err.message || String(err) };
    }
  });

  ipcMain.handle('sync:getUnreadCount', (_, siteId?: number) => {
    try {
      return queries.getUnreadSyncNotifications(siteId);
    } catch (e) {
      log.error('IPC Error: sync:getUnreadCount', e);
      throw e;
    }
  });

  ipcMain.handle('sync:getUnreadList', (_, siteId?: number) => {
    try {
      return queries.getUnreadNotificationsList(siteId);
    } catch (e) {
      log.error('IPC Error: sync:getUnreadList', e);
      throw e;
    }
  });

  ipcMain.handle('sync:markAsRead', (_, siteId?: number) => {
    try {
      return queries.markUnreadSyncNotificationsAsRead(siteId);
    } catch (e) {
      log.error('IPC Error: sync:markAsRead', e);
      throw e;
    }
  });

  log.info('All IPC handlers registered');
}
