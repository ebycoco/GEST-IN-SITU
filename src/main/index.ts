// ─── CHRONOMÈTRE DE DÉMARRAGE (COLD START) ─────────────────────────────────
// Doit être la toute première instruction exécutée dans le Main Process
// pour mesurer le temps total de démarrage de l'application.
const appStartTime = performance.now();
// ────────────────────────────────────────────────────────────────────────────

import { app, BrowserWindow, ipcMain, Notification, shell, nativeTheme, dialog } from 'electron';
import { join } from 'path';
import { electronApp, optimizer, is } from '@electron-toolkit/utils';
import { initDatabase, getDatabase } from './database/connection';
import { registerIpcHandlers, isImportActive } from './ipc/handlers';
import { ensureSyncIds } from './database/queries/hierarchy.queries';
import { setupAutoUpdater } from './auto-updater';
import { initBackupScheduler } from './backup';
import log from 'electron-log';
import { syncEngine } from './sync/sync-engine';
import { preloadUsersFromCloud } from './sync/downstream';

import { stopSessionHeartbeat } from './auth/session-heartbeat';

// --- SÉCURITÉ CONTRE LES CRASHS GLOBAUX (MAIN PROCESS) ---
process.on('uncaughtException', (error) => {
  log.error('🚨 [FATAL] Exception non gérée dans le Main Process :', error);
});

process.on('unhandledRejection', (reason, promise) => {
  log.error('🚨 [FATAL] Rejet de promesse non géré à :', promise, 'Raison :', reason);
});

let mainWindow: BrowserWindow | null = null;
let isQuitting = false;

// Sécurisation de l'instance unique
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  log.warn("🚨 Une autre instance de GEST-IN-SITU est déjà active. Fermeture de celle-ci.");
  app.quit();
  process.exit(0);
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

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
    icon: join(__dirname, '../../resources/icon.ico'),
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
    // ─── COLD START CHRONO ───────────────────────────────────────────────────
    // Calcul du temps total entre le lancement du processus et l'affichage
    // de la fenêtre principale (temps de démarrage réel perçu par l'utilisateur).
    const coldStartMs = (performance.now() - appStartTime).toFixed(2);
    log.info(`[PERF] Cold Start — Application démarrée et prête en ${coldStartMs} ms`);
    // ────────────────────────────────────────────────────────────────────────
    if (is.dev) {
      mainWindow?.webContents.openDevTools({ mode: 'detach' });
    }
  });

  mainWindow.on('close', (e) => {
    if (isQuitting) return;
    
    e.preventDefault();
    
    try {
      const isSyncActive = syncEngine.isCurrentlySyncing();
      const isImporting = isImportActive();
      
      if (isSyncActive || isImporting) {
        const choice = dialog.showMessageBoxSync(mainWindow!, {
          type: 'warning',
          buttons: ['Forcer la fermeture', 'Attendre'],
          defaultId: 1,
          title: 'Opération en cours',
          message: 'Des écritures ou synchronisations sont actuellement actives. Fermer l\'application maintenant pourrait corrompre vos données.',
          detail: 'Veuillez patienter ou forcer la fermeture.'
        });
        
        if (choice === 1) {
          return;
        }
      }
      
      isQuitting = true;
      app.quit();
    } catch (err) {
      log.error('Erreur lors du cycle de fermeture:', err);
      isQuitting = true;
      app.quit();
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
      new Notification({ title, body, icon: join(__dirname, '../../resources/icon.ico') }).show();
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

  try {
    ensureSyncIds();
    log.info('Vérification et génération des sync_ids terminées.');
  } catch (err) {
    log.error('Échec de la correction automatique des sync_ids:', err);
  }

  // Create main window IMMÉDIATEMENT (non bloquant)
  electronApp.setAppUserModelId('com.ebycoco.gest-in-situ');
  createWindow();

  // État global pour savoir si on est en train de preload
  let isPreloadingUsers = true;

  // Handler IPC pour que le Renderer puisse interroger l'état au montage
  ipcMain.handle('auth:isPreloadingUsers', () => isPreloadingUsers);

  // Lancement du preload en arrière-plan sans bloquer
  preloadUsersFromCloud().then(() => {
    log.info('[INIT] Preload initial terminé — les comptes locaux sont prêts pour le Login.');
    isPreloadingUsers = false;
    if (mainWindow) mainWindow.webContents.send('auth:preload-status', false);
  }).catch((preloadError: any) => {
    log.error(
      '[INIT] Échec du preload au démarrage (Supabase inaccessible ?) :',
      preloadError?.message ?? preloadError
    );
    log.warn('[INIT] Ouverture du Login avec les comptes locaux existants (mode dégradé).');
    isPreloadingUsers = false;
    if (mainWindow) mainWindow.webContents.send('auth:preload-status', false);
  });

  // Register IPC handlers
  if (mainWindow) {
    registerIpcHandlers(mainWindow);
    setupWindowControls();
    setupNotifications();
    setupTheme();
    
    // Injection de la référence fenêtre dans le SyncEngine pour permettre
    // l'envoi de notifications IPC discrètes vers le Renderer (footer "sync en cours").
    syncEngine.setMainWindow(mainWindow);

    // Allumage du moteur de synchronisation automatique et moniteur réseau
    syncEngine.init();
  }

  // Auto-updater (production only)
  if (!is.dev) {
    try {
      setupAutoUpdater(mainWindow!, syncEngine);
    } catch (updaterError: any) {
      log.warn("L'auto-updater n'a pas pu être initialisé (non bloquant) :", updaterError?.message || updaterError);
    }
    try {
      initBackupScheduler();
    } catch (backupError: any) {
      log.error("Le planificateur de sauvegarde n'a pas pu être initialisé :", backupError?.message || backupError);
    }
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  // ─── SURVEILLANCE RAM PÉRIODIQUE (ANTI-FUITE MÉMOIRE) ───────────────────
  // Cycle discret toutes les 5 minutes dans le Main Process.
  // Permet de détecter les fuites mémoires progressives avant le gel de l'IHM
  // sur les machines à 8 Go de RAM. Non-bloquant : setInterval est asynchrone
  // et n'occupe pas le thread principal.
  const RAM_MONITOR_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
  setInterval(() => {
    const mem = process.memoryUsage();
    const rssMb      = (mem.rss       / 1024 / 1024).toFixed(2);
    const heapTotMb  = (mem.heapTotal / 1024 / 1024).toFixed(2);
    const heapUsedMb = (mem.heapUsed  / 1024 / 1024).toFixed(2);
    const extMb      = (mem.external  / 1024 / 1024).toFixed(2);
    log.info(
      `[MONITORING RAM] RSS: ${rssMb} MB | Heap Total: ${heapTotMb} MB | Heap Used: ${heapUsedMb} MB | External: ${extMb} MB`
    );
    // Alerte si le Heap dépasse 500 MB (signe de fuite mémoire significative)
    if (mem.heapUsed > 500 * 1024 * 1024) {
      log.warn(
        `[ALERTE RAM] Consommation Heap élevée : ${heapUsedMb} MB. Risque de gel sur machine 8 Go.`
      );
    }
  }, RAM_MONITOR_INTERVAL_MS).unref(); // .unref() : n'empêche pas l'app de quitter proprement
  // ────────────────────────────────────────────────────────────────────────
});

app.on('window-all-closed', () => {
  stopSessionHeartbeat();
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  const db = getDatabase();
  if (db) {
    try {
      db.close();
      log.info('Database connection closed cleanly on quit.');
    } catch (err) {
      log.error('Error closing database connection:', err);
    }
  }
});
