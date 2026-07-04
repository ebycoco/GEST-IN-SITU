import { ipcMain, dialog, app, BrowserWindow } from 'electron';
import * as queries from '../database/queries';
import { getDbPath, getDatabase } from '../database/connection';
import { createReadStream, openSync, readSync, closeSync } from 'fs';
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
  ipcMain.handle('auth:login', async (_, login: string, password: string) => {
    try { return await queries.authenticateUser(login, password); }
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
  ipcMain.handle('cartes:getHistoriquePertes', async (_, siteId?: number) => {
    try { return queries.getHistoriquePertes(siteId); }
    catch (e) { log.error('IPC Error: cartes:getHistoriquePertes', e); throw e; }
  });
  ipcMain.handle('cartes:reactiverCarte', async (_, id, nouveauRangement, currentUser) => {
    try { return queries.reactiverCarte(id, nouveauRangement, currentUser); }
    catch (e) { log.error('IPC Error: cartes:reactiverCarte', e); throw e; }
  });
  ipcMain.handle('cartes:getInvalidDates', async (_, siteId?: number) => {
    try { return queries.getInvalidDateRecords(siteId); }
    catch (e) { log.error('IPC Error: cartes:getInvalidDates', e); throw e; }
  });
  ipcMain.handle('cartes:updateDate', async (_, id, newDate) => {
    try { return queries.updateDateDeNaissance(id, newDate); }
    catch (e) { log.error('IPC Error: cartes:updateDate', e); throw e; }
  });
  ipcMain.handle('cartes:getDoublonsPage', async (_, siteId, offset, limit, query) => {
    try { return queries.getDoublonsStrictsPage(siteId, offset, limit, query); }
    catch (e) { log.error('IPC Error: cartes:getDoublonsPage', e); throw e; }
  });
  ipcMain.handle('cartes:getSansNumSecuPage', async (_, siteId, offset, limit, query) => {
    try { return queries.getSansNumSecuPage(siteId, offset, limit, query); }
    catch (e) { log.error('IPC Error: cartes:getSansNumSecuPage', e); throw e; }
  });
  ipcMain.handle('cartes:getSansRangementPage', async (_, siteId, offset, limit, query) => {
    try { return queries.getSansRangementPage(siteId, offset, limit, query); }
    catch (e) { log.error('IPC Error: cartes:getSansRangementPage', e); throw e; }
  });
  ipcMain.handle('cartes:updateQuickFields', async (_, id, fields) => {
    try { return queries.updateQuickFields(id, fields); }
    catch (e) { log.error('IPC Error: cartes:updateQuickFields', e); throw e; }
  });
  ipcMain.handle('cartes:searchQuickLogistique', async (_, siteId, critere) => {
    try { return queries.searchQuickLogistique(siteId, critere); }
    catch (e) { log.error('IPC Error: cartes:searchQuickLogistique', e); throw e; }
  });
  ipcMain.handle('cartes:updateRangementEtFiche', async (_, id, fields) => {
    try { return queries.updateRangementEtFiche(id, fields); }
    catch (e) { log.error('IPC Error: cartes:updateRangementEtFiche', e); throw e; }
  });
  ipcMain.handle('cartes:searchCombinedInventaire', async (_, siteId, queryNomsPrenoms, dateNaissance, lieuNaissance) => {
    try { return queries.searchCombinedInventaire(siteId, queryNomsPrenoms, dateNaissance, lieuNaissance); }
    catch (e) { log.error('IPC Error: cartes:searchCombinedInventaire', e); throw e; }
  });
  ipcMain.handle('cartes:updateApurementHistorique', async (_, id, fields) => {
    try { return queries.updateApurementHistorique(id, fields); }
    catch (e) { log.error('IPC Error: cartes:updateApurementHistorique', e); throw e; }
  });

   ipcMain.handle('stats:get', async (_, siteId) => {
    try { return await queries.getStats(siteId); }
    catch (e) { log.error('IPC Error: stats:get', e); throw e; }
   });
   ipcMain.handle('stats:getCentre', async (_, centreId, siteId) => {
     try { return await queries.getCentreStats(centreId, siteId); }
     catch (e) { log.error('IPC Error: stats:getCentre', e); throw e; }
   });
   ipcMain.handle('stats:getCentreOperateurs', async (_, centreId) => {
     try { return queries.getCentreOperateurCadence(centreId); }
     catch (e) { log.error('IPC Error: stats:getCentreOperateurs', e); throw e; }
   });
  ipcMain.handle('stats:getGlobal', async () => {
    try { return queries.getGlobalStats(); }
    catch (e) { log.error('IPC Error: stats:getGlobal', e); throw e; }
  });
  ipcMain.handle('stats:getVerification', async (_, agentUsername, siteId) => {
    try { return queries.getVerificationStats(agentUsername, siteId); }
    catch (e) { log.error('IPC Error: stats:getVerification', e); throw e; }
  });
  ipcMain.handle('stats:getCardsToday', async (_, agentUsername, siteId) => {
    try { return queries.getVerificationCardsToday(agentUsername, siteId); }
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

  // Détecteur d'encodage pour supporter UTF-8 et Windows-1252 (Latin1)
  function detectEncoding(filePath: string): 'utf8' | 'latin1' {
    try {
      const fd = openSync(filePath, 'r');
      const buffer = Buffer.alloc(102400);
      const bytesRead = readSync(fd, buffer, 0, 102400, 0);
      closeSync(fd);
      
      const slice = buffer.subarray(0, bytesRead);
      const str = slice.toString('utf8');
      const reencoded = Buffer.from(str, 'utf8');
      
      if (slice.equals(reencoded)) {
        return 'utf8';
      }
      return 'latin1';
    } catch (e) {
      return 'utf8';
    }
  }

  // IMPORT - Preview (only reads first 1000 rows + counts total)
  ipcMain.handle('import:parseCSV', async (_, filePath: string) => {
    try {
      const rows: any[] = [];
      let headers: string[] = [];
      let total = 0;

      const encoding = detectEncoding(filePath);
      log.info(`[MAIN PROCESS] Preview encoding resolved to: ${encoding}`);
      const fileStream = createReadStream(filePath, { encoding });
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
          } else {
            break;
          }
        }
        lineCount++;
      }
      total = rows.length;

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

      // Construction de la table de routage dynamique par centre du site admin
      let routingTable: any[] = [];
      try {
        if (siteId) {
          routingTable = queries.getCentresWithPrefixes(Number(siteId));
          log.info(`Centres routing table resolved for site ID ${siteId}:`, routingTable.map(c => `${c.nom} -> ${c.prefixe_rangement}`));
        }
      } catch (err) {
        log.error('Failed to resolve centres routing table for import', err);
      }

      // Suspendre le moteur de sync pour éviter les conflits de verrou SQLite pendant l'import
      syncEngine.pause();

      const worker = new Worker(workerPath, {
        workerData: {
          sqlitePath,
          dbPath: getDbPath(),
          filePath,
          agent,
          siteId,
          routingTable,
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
          syncEngine.resume();
          resolve(msg.result);
        } else if (msg.type === 'error') {
          log.error('Import worker error', msg.error);
          syncEngine.resume();
          reject(new Error(msg.error));
        }
      });

      worker.on('error', (err) => {
        log.error('Worker thread error', err);
        syncEngine.resume();
        reject(err);
      });

      worker.on('exit', (code) => {
        if (code !== 0) {
          log.error(`Worker exited with code ${code}`);
          syncEngine.resume();
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

      if (filters?.incremental === 'true') {
        const ids = rows.map(r => r.id_carte as number);
        queries.marquerCartesExporte(ids);
      }

      log.info(`Export CSV: ${rows.length} rows to ${result.filePath}`);
      return { success: true, count: rows.length, path: result.filePath };
    } catch (e) {
      log.error('Export CSV error', e);
      return { success: false, reason: String(e) };
    }
  });

  // EXPORT - Excel with save dialog (using exceljs)
  ipcMain.handle('export:excel', async (_, filters?: Record<string, string>) => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Exporter les cartes en Excel',
      defaultPath: `cartes_export_${new Date().toISOString().slice(0, 10)}.xlsx`,
      filters: [
        { name: 'Classeur Excel', extensions: ['xlsx'] },
        { name: 'Tous', extensions: ['*'] }
      ]
    });
    if (result.canceled || !result.filePath) return { success: false, reason: 'cancelled' };

    try {
      const rows = queries.exportCartes(filters) as Record<string, unknown>[];
      if (rows.length === 0) return { success: false, reason: 'no_data' };

      const ExcelJS = await import('exceljs');
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Cartes CMU');

      const headers = Object.keys(rows[0]);
      worksheet.columns = headers.map(h => ({
        header: h.toUpperCase().replace(/_/g, ' '),
        key: h,
        width: h === 'noms' || h === 'prenoms' ? 25 : 18
      }));

      // Add rows
      rows.forEach(r => worksheet.addRow(r));

      // Style header row
      const headerRow = worksheet.getRow(1);
      headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      headerRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF1E293B' } // Slate color header
      };

      await workbook.xlsx.writeFile(result.filePath);

      if (filters?.incremental === 'true') {
        const ids = rows.map(r => r.id_carte as number);
        queries.marquerCartesExporte(ids);
      }

      log.info(`Export Excel: ${rows.length} rows to ${result.filePath}`);
      return { success: true, count: rows.length, path: result.filePath };
    } catch (e) {
      log.error('Export Excel error', e);
      return { success: false, reason: String(e) };
    }
  });

  // EXPORT - RANGEMENTS
  ipcMain.handle('cartes:getRangements', (_, siteId?: number) => queries.getDistinctRangements(siteId));
  ipcMain.handle('export:marquerExporte', (_, ids: number[]) => queries.marquerCartesExporte(ids));
  ipcMain.handle('export:getRows', (_, filters?: Record<string, string>) => queries.exportCartes(filters));

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
  ipcMain.handle('db:purge', async (event, siteId) => {
    try {
      return await queries.purgeLocalDatabase(Number(siteId), (percent) => {
        if (!mainWindow.isDestroyed()) {
          mainWindow.webContents.send('db:purge-progress', percent);
        }
      });
    }
    catch (e) { log.error('IPC Error: db:purge', e); throw e; }
  });
  ipcMain.handle('db:emergency-purge', async (_, siteId) => {
    try { return queries.emergencyPurge(Number(siteId)); }
    catch (e) { log.error('IPC Error: db:emergency-purge', e); throw e; }
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

  ipcMain.handle('sync:markNotificationAsRead', (_, idLog: number) => {
    try {
      return queries.markNotificationAsRead(idLog);
    } catch (e) {
      log.error('IPC Error: sync:markNotificationAsRead', e);
      throw e;
    }
  });

  // OPERATEUR STATS HANDLERS
  ipcMain.handle('stats:getAgentToday', (_, userId: number) => queries.getAgentStatsToday(userId));
  ipcMain.handle('stats:getAgentRecentSaisies', (_, userId: number, limit?: number) => queries.getAgentRecentSaisies(userId, limit));
  ipcMain.handle('stats:getSiteSaisieToday', (_, siteId: number) => queries.getSiteSaisieStatsToday(siteId));

  // RETRAITS ANALYTICS HANDLERS
  ipcMain.handle('stats:getRetraits', (_, siteId: number, centreId: number | null, period: string) => {
    try {
      return queries.getRetraitsByCentre(siteId, centreId, period as any);
    } catch (e) {
      log.error('IPC Error: stats:getRetraits', e);
      throw e;
    }
  });
  ipcMain.handle('stats:getRetraitsTrend', (_, siteId: number, centreId: number | null, period: string) => {
    try {
      return queries.getRetraitsTrend(siteId, centreId, period as any);
    } catch (e) {
      log.error('IPC Error: stats:getRetraitsTrend', e);
      throw e;
    }
  });

  // SUPER ADMIN — Synchronisation Forcée Globale
  ipcMain.handle('sync:forceGlobal', async () => {
    try {
      return await queries.forceGlobalSuperAdminSync();
    } catch (error) {
      log.error('Erreur lors de la synchronisation forcée globale:', error);
      throw error;
    }
  });

  // SITE ADMIN — Synchronisation Forcée du Site
  ipcMain.handle('sync:forceSite', async (_, siteId: number) => {
    try {
      return await queries.forceSiteAdminSync(Number(siteId));
    } catch (error) {
      log.error(`Erreur lors de la synchronisation forcée du site ${siteId}:`, error);
      throw error;
    }
  });

  log.info('All IPC handlers registered');
}
