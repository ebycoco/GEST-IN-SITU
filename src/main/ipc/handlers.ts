import { ipcMain, dialog, app } from 'electron';
import * as queries from '../database/queries';
import { getDbPath, getBackupDir } from '../database/connection';
import { getDatabase } from '../database/connection';
import { readFileSync } from 'fs';
import { join } from 'path';
import log from 'electron-log';

export function registerIpcHandlers(): void {
  // AUTH
  ipcMain.handle('auth:login', (_, login: string, password: string) => {
    try { return queries.authenticateUser(login, password); }
    catch (e) { log.error('Auth error', e); return null; }
  });

  // CARTES
  ipcMain.handle('cartes:getPage', (_, offset, limit, filters) => queries.getCartesPage(offset, limit, filters));
  ipcMain.handle('cartes:search', (_, query, limit) => queries.searchCartesFTS(query, limit));
  ipcMain.handle('cartes:getById', (_, id) => queries.getCarteById(id));
  ipcMain.handle('cartes:create', (_, data) => queries.createCarte(data));
  ipcMain.handle('cartes:update', (_, id, data) => queries.updateCarte(id, data));
  ipcMain.handle('cartes:delete', (_, id) => queries.deleteCarte(id));
  ipcMain.handle('cartes:delivrer', (_, id, data) => queries.delivrerCarte(id, data));
  ipcMain.handle('cartes:signalerAbsence', (_, id, agent) => queries.signalerAbsence(id, agent));

  // STATS
  ipcMain.handle('stats:get', () => queries.getStats());

  // IMPORT
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

  ipcMain.handle('import:parseCSV', (_, filePath: string) => {
    try {
      const content = readFileSync(filePath, 'utf-8');
      const lines = content.split(/\r?\n/).filter(l => l.trim());
      if (lines.length === 0) return { rows: [], headers: [] };
      const sep = lines[0].includes(';') ? ';' : ',';
      const headers = lines[0].split(sep).map(h => h.trim().replace(/"/g, ''));
      const rows = lines.slice(1).map(line => {
        const cols = line.split(sep).map(c => c.trim().replace(/^"|"$/g, ''));
        const row: Record<string, string> = {};
        headers.forEach((h, i) => { row[h.toLowerCase().replace(/\s+/g, '_')] = cols[i] || ''; });
        return row;
      });
      return { rows, headers, total: rows.length };
    } catch (e) { log.error('CSV parse error', e); return { rows: [], headers: [], error: String(e) }; }
  });

  ipcMain.handle('import:executeBatch', (_, rows, agent) => queries.importBatch(rows, agent));
  ipcMain.handle('import:fusionner', () => queries.fusionnerImport());

  // EXPORT
  ipcMain.handle('export:selectFolder', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    return result.canceled ? null : result.filePaths[0];
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
