import { ipcMain, dialog, app, BrowserWindow } from 'electron';
import * as queries from '../database/queries';
import { getDbPath } from '../database/connection';
import { createReadStream } from 'fs';
import { join } from 'path';
import log from 'electron-log';
import * as readline from 'readline';
import { Worker } from 'worker_threads';

export function registerIpcHandlers(mainWindow: BrowserWindow): void {
  // AUTH
  ipcMain.handle('auth:login', (_, login: string, password: string) => {
    try { return queries.authenticateUser(login, password); }
    catch (e) { log.error('Auth error', e); return null; }
  });

  // CARTES
  ipcMain.handle('cartes:getPage', (_, offset, limit, filters) => queries.getCartesPage(offset, limit, filters));
  ipcMain.handle('cartes:search', (_, query, limit, filters) => queries.searchCartesFTS(query, limit, filters));
  ipcMain.handle('cartes:getById', (_, id) => queries.getCarteById(id));
  ipcMain.handle('cartes:create', (_, data) => queries.createCarte(data));
  ipcMain.handle('cartes:update', (_, id, data) => queries.updateCarte(id, data));
  ipcMain.handle('cartes:delete', (_, id) => queries.deleteCarte(id));
  ipcMain.handle('cartes:delivrer', (_, id, data) => queries.delivrerCarte(id, data));
  ipcMain.handle('cartes:signalerAbsence', (_, id, agent) => queries.signalerAbsence(id, agent));

  // STATS
  ipcMain.handle('stats:get', () => queries.getStats());

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
  ipcMain.handle('import:clearTemp', () => queries.clearImportTemp());
  ipcMain.handle('import:executeBatch', (_, rows, agent) => queries.importBatch(rows, agent));
  ipcMain.handle('import:fusionner', () => queries.fusionnerImport());

  // IMPORT - Process file using Worker Thread (NON-BLOCKING!)
  ipcMain.handle('import:processFile', (_, filePath: string, agent: string, totalEstimate: number) => {
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
  ipcMain.handle('users:getAll', () => queries.getUsers());
  ipcMain.handle('users:create', (_, data) => queries.createUser(data));
  ipcMain.handle('users:update', (_, id, data) => queries.updateUser(id, data));
  ipcMain.handle('users:delete', (_, id) => queries.deleteUser(id));

  // LOGS
  ipcMain.handle('logs:get', (_, offset, limit, filters) => queries.getLogs(offset, limit, filters));
  ipcMain.handle('logs:add', (_, userId, login, action, detail) => queries.logAction(userId, login, action, detail));
  ipcMain.handle('logs:purge', () => queries.purgeLogs());

  // HIERARCHY
  ipcMain.handle('hierarchy:getSites', () => queries.getSites());
  ipcMain.handle('hierarchy:getCentres', (_, siteId) => queries.getCentres(siteId));
  ipcMain.handle('hierarchy:getPostes', (_, centreId) => queries.getPostes(centreId));

  // CONFIG
  ipcMain.handle('config:get', (_, key) => queries.getConfig(key));
  ipcMain.handle('config:set', (_, key, value) => queries.setConfig(key, value));
  ipcMain.handle('config:getAll', () => queries.getAllConfig());

  // APP INFO
  ipcMain.handle('app:getVersion', () => app.getVersion());
  ipcMain.handle('app:getDbPath', () => getDbPath());

  log.info('All IPC handlers registered');
}
