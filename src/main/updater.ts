import { autoUpdater } from 'electron-updater';
import { BrowserWindow } from 'electron';
import log from 'electron-log';

export function initAutoUpdater(mainWindow: BrowserWindow): void {
  autoUpdater.logger = log;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    log.info('Checking for updates...');
    mainWindow.webContents.send('updater:checking');
  });

  autoUpdater.on('update-available', (info) => {
    log.info('Update available:', info.version);
    mainWindow.webContents.send('updater:available', info);
  });

  autoUpdater.on('update-not-available', () => {
    log.info('App is up to date');
    mainWindow.webContents.send('updater:not-available');
  });

  autoUpdater.on('download-progress', (progress) => {
    mainWindow.webContents.send('updater:progress', progress);
  });

  autoUpdater.on('update-downloaded', (info) => {
    log.info('Update downloaded:', info.version);
    mainWindow.webContents.send('updater:downloaded', info);
  });

  autoUpdater.on('error', (err) => {
    log.error('Update error:', err);
    mainWindow.webContents.send('updater:error', err.message);
  });

  // Check every 4 hours
  autoUpdater.checkForUpdates();
  setInterval(() => autoUpdater.checkForUpdates(), 4 * 60 * 60 * 1000);
}
