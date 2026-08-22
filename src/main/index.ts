// ─── CHRONOMÈTRE DE DÉMARRAGE (COLD START) ─────────────────────────────────
// Doit être la toute première instruction exécutée dans le Main Process
// pour mesurer le temps total de démarrage de l'application.
const appStartTime = performance.now();
// ────────────────────────────────────────────────────────────────────────────

// ─── ENCODAGE UTF-8 (WINDOWS) ────────────────────────────────────────────────
// Force l'encodage UTF-8 sur stdout/stderr pour corriger la corruption CP850
// observée dans les terminaux Windows (code page 850 : "réussi" → "r├®ussi").
// Doit être exécuté AVANT tout appel à electron-log ou console.log.
if (process.platform === 'win32') {
  try {
    if (process.stdout.setEncoding) process.stdout.setEncoding('utf8');
    if (process.stderr.setEncoding) process.stderr.setEncoding('utf8');
  } catch (_) { /* non-fatal */ }
}
// ──────────────────────────────────────────────────────────────────────────────


import { app, BrowserWindow, ipcMain, Notification, shell, nativeTheme, dialog } from 'electron';
import { join } from 'path';
import { electronApp, optimizer, is } from '@electron-toolkit/utils';
import { initDatabase, getDatabase } from './database/connection';
import { registerIpcHandlers, isImportActive } from './ipc/handlers';
import { ensureSyncIds } from './database/queries/hierarchy.queries';
import { setupAutoUpdater, isUpdateReadyToInstall, triggerUpdateInstall } from './auto-updater';
import * as fs from 'fs';
import { initBackupScheduler } from './backup';
import log from 'electron-log';
import { syncEngine } from './sync/sync-engine';
import { preloadUsersFromCloud } from './sync/downstream';
import { resetOutboxErrors } from './sync/outbox.service';

import { stopSessionHeartbeat } from './auth/session-heartbeat';

// ─── ISOLATION DEV/PROD DU DOSSIER userData (SQLite + fichiers annexes) ────────
// Correctif P0 (QA terrain, août 2026) : en mode développement (`npm run dev`),
// Electron faisait pointer `userData` vers le même dossier que l'app packagée
// en production (%APPDATA%\gest-in-situ\...), donc vers la même base SQLite
// (comptes réels, dont un compte SUPER ADMIN réel), sans aucune séparation.
// Un lancement `npm run dev` redirige désormais `userData` vers un
// sous-dossier `dev` distinct — la production (app packagée,
// `app.isPackaged === true`) n'est jamais affectée, ni son chemin ni ses
// données déjà présentes.
// Garde supplémentaire : ne PAS rediriger si `--user-data-dir=...` est déjà
// passé explicitement en ligne de commande (switch natif Chromium/Electron).
// C'est le mécanisme dont dépend toute la suite e2e Playwright (voir
// e2e/fixtures/electron-app.ts) : chaque test lance l'app non empaquetée
// (`app.isPackaged === false`) sur un `userDataDir` temporaire jetable déjà
// pré-seedé (`<userDataDir>/data/gest_in_situ.db`) — sans cette garde, ce
// bloc ajouterait un sous-dossier `dev` inattendu et l'app ne retrouverait
// plus la base seedée par les tests.
// DOIT s'exécuter avant tout appel à `app.getPath('userData')` dans le cycle
// de vie du processus main (connection.ts::getDbPath/getBackupDir,
// checkPendingUpdateMarker ci-dessous, auto-updater.ts) — placé ici, au point
// d'entrée main, avant toute autre logique applicative.
const hasExplicitUserDataDir = process.argv.some((arg) => arg.startsWith('--user-data-dir='));
if (!app.isPackaged && !hasExplicitUserDataDir) {
  app.setPath('userData', join(app.getPath('userData'), 'dev'));
}
// ──────────────────────────────────────────────────────────────────────────────

// --- SÉCURITÉ CONTRE LES CRASHS GLOBAUX (MAIN PROCESS) ---
process.on('uncaughtException', (error) => {
  log.error('🚨 [FATAL] Exception non gérée dans le Main Process :', error);
});

process.on('unhandledRejection', (reason, promise) => {
  log.error('🚨 [FATAL] Rejet de promesse non géré à :', promise, 'Raison :', reason);
});

let mainWindow: BrowserWindow | null = null;
let splashWindow: BrowserWindow | null = null;
let isQuitting = false;
let isPreloadingUsers = false; // R1: Déchaîner le Login, ne plus bloquer

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

function createSplashWindow(): void {
  splashWindow = new BrowserWindow({
    width: 480,
    height: 320,
    show: false,
    frame: false,
    transparent: false,
    resizable: false,
    center: true,
    alwaysOnTop: true,
    icon: join(__dirname, '../../resources/icon.ico'),
    webPreferences: {
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    },
    backgroundColor: '#0a0e27'
  });

  const splashPath = join(__dirname, '../../resources/splash.html');
  splashWindow.loadFile(splashPath).catch((e) => {
    log.error('Erreur chargement splash.html:', e);
  });

  splashWindow.once('ready-to-show', () => {
    splashWindow?.show();
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

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.close();
      splashWindow = null;
    }
    // ─── COLD START CHRONO ───────────────────────────────────────────────────
    // Calcul du temps total entre le lancement du processus et l'affichage
    // de la fenêtre principale (temps de démarrage réel perçu par l'utilisateur).
    const coldStartMs = (performance.now() - appStartTime).toFixed(2);
    log.info(`[PERF] Cold Start — Application démarrée et prête en ${coldStartMs} ms`);
    // ────────────────────────────────────────────────────────────────────────
    if (is.dev) {
      mainWindow?.webContents.openDevTools({ mode: 'detach' });
    }

    // ─── DÉMARRAGE DIFFÉRÉ DU MOTEUR DE SYNCHRONISATION ──────────────────────
    // CRITIQUE : syncEngine.init() est appelé ICI (après ready-to-show) et non
    // plus dans le flux principal whenReady() pour garantir que :
    //   1. La fenêtre est entièrement visible avant le premier ping réseau
    //   2. Le NetworkMonitor ne sature pas le service réseau d'Electron avant
    //      que l'UI ait eu le temps de s'initialiser
    // Le paramètre delayMs=3000 ajoute un délai supplémentaire de 3s avant le
    // premier appel à handleNetworkChange, assurant une ouverture < 3s garantie.
    syncEngine.init(3000);
    log.info('[INIT] SyncEngine démarré (délai 3s) — fenêtre entièrement affichée.');
    // ────────────────────────────────────────────────────────────────────────

    // ─── DÉMARRAGE DIFFÉRÉ DU PRELOAD DES UTILISATEURS ───────────────────────
    // Retardé de 3.5s (après le premier ping SyncEngine) pour éviter que
    // SupabaseClient ne crashe le service réseau.
    setTimeout(() => {
      // Garde de Premier Démarrage (Base Vide)
      let hasUsers = false;
      try {
        const db = getDatabase();
        if (db) {
          const userCountRow = db.prepare("SELECT COUNT(*) as count FROM t_users").get() as { count: number };
          hasUsers = userCountRow.count > 0;
        }
      } catch (err) {
        log.error('[INIT] Erreur lors de la vérification des utilisateurs locaux :', err);
      }

      if (hasUsers) {
        log.info('[INIT] Comptes locaux détectés (count > 0). Exécution de R1: preload silencieux en arrière-plan.');
        preloadUsersFromCloud().then(() => {
          log.info('[INIT] Preload silencieux terminé.');
        }).catch((err) => {
          log.warn('[INIT] Échec du preload silencieux (mode hors-ligne) :', err?.message);
        });
      } else {
        log.info('[INIT] Base locale vide (Nouvelle machine). On délègue le rapatriement à la page Login (forceGlobal).');
      }
    }, 3500);

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

      // ─── FILET DE SÉCURITÉ : MISE À JOUR PRÊTE → INSTALLATION VISIBLE ───────
      // Ajout strictement additif : si une mise à jour a été téléchargée
      // (isUpdateReadyToInstall(), src/main/auto-updater.ts), on déclenche ici
      // explicitement l'installation visible APRÈS le passage réussi de la
      // vérification sync/import ci-dessus — remplace uniquement ce chemin de
      // app.quit() par triggerUpdateInstall(), qui gère lui-même l'appel final
      // à app.quit() en interne (autoUpdater.quitAndInstall). Le chemin normal
      // (pas de mise à jour en attente, immense majorité des fermetures) est
      // inchangé : même comportement qu'avant (isQuitting = true; app.quit()).
      if (isUpdateReadyToInstall()) {
        log.info('[AutoUpdater] Mise à jour en attente détectée à la fermeture — déclenchement de l\'installation visible.');
        isQuitting = true;
        triggerUpdateInstall();
      } else {
        isQuitting = true;
        app.quit();
      }
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

// ─── FILET DE SÉCURITÉ : VÉRIFICATION DU MARQUEUR DE MISE À JOUR AU DÉMARRAGE ───
// Si triggerUpdateInstall() (src/main/auto-updater.ts) a écrit un marqueur
// juste avant la fermeture précédente, on compare ici la version effectivement
// démarrée à la version attendue. Purement déclaratif (log) : pas de UI, pas
// de nouvelle tentative — le marqueur est supprimé dans tous les cas après ce
// constat pour ne pas ré-évaluer indéfiniment aux démarrages suivants.
// Placé délibérément tôt, avant initDatabase(), pour ne dépendre d'aucune
// migration/état SQLite.
function checkPendingUpdateMarker(): void {
  const markerPath = join(app.getPath('userData'), 'pending-update.json');
  try {
    if (!fs.existsSync(markerPath)) return;

    const raw = fs.readFileSync(markerPath, 'utf-8');
    const marker = JSON.parse(raw) as { expectedVersion?: string; triggeredAt?: string };
    const currentVersion = app.getVersion();

    if (marker.expectedVersion === currentVersion) {
      log.info(`[AutoUpdater] Mise à jour vers v${currentVersion} confirmée au redémarrage (déclenchée le ${marker.triggeredAt}).`);
    } else {
      log.warn(`[AutoUpdater] Mise à jour vers v${marker.expectedVersion ?? '?'} non confirmée après redémarrage — l'app tourne toujours en v${currentVersion}.`);
    }
  } catch (err: any) {
    log.warn('[AutoUpdater] Erreur lors de la lecture du marqueur de mise à jour (non bloquant) :', err?.message || err);
  } finally {
    try {
      if (fs.existsSync(markerPath)) fs.unlinkSync(markerPath);
    } catch (err: any) {
      log.warn('[AutoUpdater] Échec de la suppression du marqueur de mise à jour :', err?.message || err);
    }
  }
}
// ──────────────────────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  log.info('GEST-IN-SITU starting...');
  electronApp.setAppUserModelId('com.ebycoco.gest-in-situ');
  createSplashWindow();

  checkPendingUpdateMarker();

  // Initialize database
  await initDatabase();
  log.info('Database initialized');
  resetOutboxErrors();

  try {
    ensureSyncIds();
    log.info('Vérification et génération des sync_ids terminées.');
  } catch (err) {
    log.error('Échec de la correction automatique des sync_ids:', err);
  }

  // Create main window IMMÉDIATEMENT (non bloquant)
  createWindow();

  // État global pour savoir si on est en train de preload
  // isPreloadingUsers est déclaré globalement en haut du fichier.

  // Handler IPC pour que le Renderer puisse interroger l'état au montage
  ipcMain.handle('auth:isPreloadingUsers', () => isPreloadingUsers);

  // Le lancement effectif de preloadUsersFromCloud a été déplacé dans ready-to-show
  // pour éviter de saturer/crasher le network_service_instance_impl au démarrage.

  // Register IPC handlers
  if (mainWindow) {
    registerIpcHandlers(mainWindow);
    setupWindowControls();
    setupNotifications();
    setupTheme();
    
    // Injection de la référence fenêtre dans le SyncEngine pour permettre
    // l'envoi de notifications IPC discrètes vers le Renderer (footer "sync en cours").
    syncEngine.setMainWindow(mainWindow);

    // ⚠️ NOTE : syncEngine.init() est appelé dans le callback ready-to-show ci-dessus
    // (avec un délai de 3s) pour garantir que l'UI est visible avant tout ping réseau.

    // ─── HANDLER IPC : Bouton "Réessayer" de l'UI ──────────────────────────
    // Permet au Renderer de déclencher une nouvelle session de tentatives
    // de connexion après un état PERMANENT_OFFLINE.
    ipcMain.handle('network:retry', async () => {
      log.info('[IPC] network:retry reçu — déclenchement de retryConnection().');
      return syncEngine.retryConnection();
    });
  }

  // Auto-updater (production only / temporairement activé en dev)
  try {
    setupAutoUpdater(mainWindow!, syncEngine);
  } catch (updaterError: any) {
    log.warn("L'auto-updater n'a pas pu être initialisé (non bloquant) :", updaterError?.message || updaterError);
  }

  if (!is.dev) {
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
