import { autoUpdater } from 'electron-updater';
import { ipcMain, BrowserWindow } from 'electron';
import log from 'electron-log';
import { is } from '@electron-toolkit/utils';

export function setupAutoUpdater(mainWindow: BrowserWindow, syncEngine: any) {
  autoUpdater.logger = log;
  (autoUpdater.logger as any).transports.file.level = 'info';
  
  // Activer le téléchargement automatique en arrière-plan
  autoUpdater.autoDownload = true;
  
  // Forcer l'auto-updater à fonctionner même en mode développement
  if (is.dev) {
    autoUpdater.forceDevUpdateConfig = true;
  }

  // Déclenchement automatique et autonome de la recherche de mise à jour 10s après le démarrage
  setTimeout(() => {
    log.info('[AutoUpdater] Recherche automatique de mise à jour lancée...');
    autoUpdater.checkForUpdates().catch((err: any) => {
      log.error('[AutoUpdater] Erreur lors de la recherche automatique:', err);
    });
  }, 10000);

  ipcMain.handle('updater:check', async () => {
    try {
      log.info('[AutoUpdater] Checking for updates...');
      const result = await autoUpdater.checkForUpdates();
      return { success: true, result };
    } catch (error: any) {
      log.error('[AutoUpdater] Check error:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('updater:download', async () => {
    try {
      log.info('[AutoUpdater] Starting download...');
      await autoUpdater.downloadUpdate();
      return { success: true };
    } catch (error: any) {
      log.error('[AutoUpdater] Download error:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('updater:install', async () => {
    try {
      if (syncEngine && syncEngine.isCurrentlySyncing()) {
        log.warn('[AutoUpdater] Sync is currently running. Refusing to install update immediately to protect SQLite.');
        return { success: false, error: 'Une synchronisation est en cours. Veuillez réessayer dans quelques instants.' };
      }
      log.info('[AutoUpdater] Installing update and quitting...');
      autoUpdater.quitAndInstall();
      return { success: true };
    } catch (error: any) {
      log.error('[AutoUpdater] Install error:', error);
      return { success: false, error: error.message };
    }
  });

  autoUpdater.on('update-available', (info) => {
    log.info('[AutoUpdater] Update available:', info);
    mainWindow.webContents.send('updater:update-available', info);
  });

  autoUpdater.on('update-not-available', (info) => {
    log.info('[AutoUpdater] Update not available.', info);
    mainWindow.webContents.send('updater:update-not-available', info);
  });

  autoUpdater.on('download-progress', (progressObj) => {
    mainWindow.webContents.send('updater:download-progress', progressObj);
  });

  autoUpdater.on('update-downloaded', (info) => {
    log.info('[AutoUpdater] Update downloaded:', info);
    mainWindow.webContents.send('updater:update-downloaded', info);
  });

  autoUpdater.on('error', (err) => {
    log.error('[AutoUpdater] Error in auto-updater:', err);
    mainWindow.webContents.send('updater:error', err.message);
  });
}

