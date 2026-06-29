import { app, BrowserWindow, ipcMain, Notification, shell, nativeTheme } from 'electron';
import { join } from 'path';
import { electronApp, optimizer, is } from '@electron-toolkit/utils';
import { initDatabase, getDatabase } from './database/connection';
import { registerIpcHandlers } from './ipc/handlers';
import { initAutoUpdater } from './updater';
import { initBackupScheduler } from './backup';
import log from 'electron-log';

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    frame: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0a0e27',
      symbolColor: '#8b8fa3',
      height: 36
    },
    icon: join(__dirname, '../../resources/icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    },
    backgroundColor: '#0a0e27'
  });

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show();
    if (is.dev) {
      mainWindow?.webContents.openDevTools({ mode: 'detach' });
    }
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: 'deny' };
  });

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

// Window controls IPC
function setupWindowControls(): void {
  ipcMain.on('window:minimize', () => mainWindow?.minimize());
  ipcMain.on('window:maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow?.maximize();
    }
  });
  ipcMain.on('window:close', () => mainWindow?.close());
  ipcMain.handle('window:isMaximized', () => mainWindow?.isMaximized());
}

// Notifications
function setupNotifications(): void {
  ipcMain.handle('notification:show', (_, { title, body }) => {
    if (Notification.isSupported()) {
      new Notification({ title, body, icon: join(__dirname, '../../resources/icon.png') }).show();
    }
  });
}

// Theme
function setupTheme(): void {
  ipcMain.handle('theme:get', () => nativeTheme.shouldUseDarkColors ? 'dark' : 'light');
  ipcMain.handle('theme:set', (_, theme: 'dark' | 'light' | 'system') => {
    nativeTheme.themeSource = theme;
    return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
  });
}

app.whenReady().then(async () => {
  log.info('GEST-IN-SITU starting...');

  // Initialize database
  await initDatabase();
  log.info('Database initialized');


  // Create main window
  electronApp.setAppUserModelId('com.ebycoco.gest-in-situ');
  createWindow();

  // Register IPC handlers
  if (mainWindow) {
    registerIpcHandlers(mainWindow);
    setupWindowControls();
    setupNotifications();
    setupTheme();
  }

  // Auto-updater (production only)
  if (!is.dev) {
    initAutoUpdater(mainWindow!);
    initBackupScheduler();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  const db = getDatabase();
  if (db) db.close();
  if (process.platform !== 'darwin') app.quit();
});
