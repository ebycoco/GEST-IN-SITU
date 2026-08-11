import { autoUpdater } from 'electron-updater';
import { ipcMain, BrowserWindow, app } from 'electron';
import log from 'electron-log';
import { is } from '@electron-toolkit/utils';
import * as fs from 'fs';
import * as path from 'path';

// ─── FILET DE SÉCURITÉ : MARQUEUR DE MISE À JOUR EN ATTENTE ─────────────────
// Nom du fichier marqueur JSON écrit dans userData juste avant de déclencher
// l'installation visible (quitAndInstall). Ce dossier n'est jamais touché par
// l'installeur NSIS (aucun `installDirectory` custom défini ici), il survit
// donc à la mise à jour. Lu au prochain démarrage (src/main/index.ts) pour
// confirmer que la version installée correspond bien à celle attendue.
const PENDING_UPDATE_MARKER_FILENAME = 'pending-update.json';

// État de module : mémorise la version prête à être installée dès que
// l'événement 'update-downloaded' d'electron-updater est reçu. `null` tant
// qu'aucune mise à jour n'est prête.
let updateReadyVersion: string | null = null;

/**
 * Indique si une mise à jour a été téléchargée et est prête à être installée
 * (utilisé par le handler `mainWindow.on('close', ...)` de src/main/index.ts
 * pour décider de basculer sur le flux d'installation visible plutôt que sur
 * une fermeture normale de l'application).
 */
export function isUpdateReadyToInstall(): boolean {
  return updateReadyVersion !== null;
}

/**
 * Déclenche l'installation visible de la mise à jour déjà téléchargée.
 *
 * (a) Écrit un marqueur JSON dans userData avant de quitter, pour permettre
 *     au prochain démarrage de vérifier que la mise à jour a effectivement
 *     abouti (filet de sécurité, voir src/main/index.ts).
 * (b) Appelle `autoUpdater.quitAndInstall(false)` avec UN SEUL argument.
 *
 *     ⚠️ Piège identifié dans electron-updater (BaseUpdater.quitAndInstall,
 *     node_modules/electron-updater/out/BaseUpdater.js lignes 12-15) : la
 *     signature est `quitAndInstall(isSilent, isForceRunAfter)`, mais en
 *     interne elle calcule `this.install(isSilent, isSilent ? isForceRunAfter
 *     : this.autoRunAppAfterInstall)` — si isSilent=false (notre cas, pour un
 *     installeur VISIBLE), le second argument passé par l'appelant est
 *     IGNORÉ et remplacé par la propriété `autoRunAppAfterInstall` (positionnée
 *     explicitement à true ci-dessous). Ne jamais appeler `quitAndInstall(false, true)`
 *     en pensant que le second `true` compte : il serait silencieusement jeté.
 */
export function triggerUpdateInstall(): void {
  try {
    const markerPath = path.join(app.getPath('userData'), PENDING_UPDATE_MARKER_FILENAME);
    const marker = {
      expectedVersion: updateReadyVersion,
      triggeredAt: new Date().toISOString()
    };
    // Écriture synchrone volontaire : ce code s'exécute une seule fois, au
    // moment précis de la fermeture de l'app (juste avant quitAndInstall),
    // sur un fichier de quelques octets. Une écriture async introduirait un
    // risque de course avec le quit imminent déclenché par electron-updater.
    fs.writeFileSync(markerPath, JSON.stringify(marker, null, 2), 'utf-8');
    log.info(`[AutoUpdater] Marqueur de mise à jour écrit avant installation : ${markerPath}`);
  } catch (err: any) {
    // Non bloquant : l'absence de marqueur dégrade seulement la vérification
    // post-redémarrage (volet purement journalisation), pas l'installation.
    log.warn('[AutoUpdater] Échec de l\'écriture du marqueur de mise à jour (non bloquant) :', err?.message || err);
  }

  log.info('[AutoUpdater] Déclenchement de l\'installation visible (quitAndInstall).');
  autoUpdater.quitAndInstall(false);
}

export function setupAutoUpdater(mainWindow: BrowserWindow, syncEngine: any) {
  autoUpdater.logger = log;
  (autoUpdater.logger as any).transports.file.level = 'info';

  // Activer le téléchargement automatique en arrière-plan
  autoUpdater.autoDownload = true;

  // ─── FILET DE SÉCURITÉ : installation pilotée explicitement, jamais implicite ───
  // autoInstallOnAppQuit=false désactive le hook interne de BaseUpdater
  // (addQuitHandler, node_modules/electron-updater/out/BaseUpdater.js lignes
  // 68-89) qui installait jusqu'ici silencieusement la mise à jour à la
  // fermeture, en contournant la protection sync/import de mainWindow.on('close', ...)
  // dans src/main/index.ts. L'installation est désormais déclenchée
  // exclusivement via triggerUpdateInstall(), après cette protection.
  autoUpdater.autoInstallOnAppQuit = false;
  // Explicité même si déjà vrai par défaut : protège d'un futur changement
  // de valeur par défaut côté electron-updater. C'est ce flag (et non le
  // second argument de quitAndInstall, voir piège documenté ci-dessus) qui
  // pilote la relance automatique de l'app après installation non silencieuse.
  autoUpdater.autoRunAppAfterInstall = true;

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
      mainWindow.webContents.send('updater:installing');
      setTimeout(() => {
        autoUpdater.quitAndInstall();
      }, 1000);
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
    // Mémorise la version prête à installer (consommé par isUpdateReadyToInstall()
    // / triggerUpdateInstall() côté handler de fermeture dans src/main/index.ts).
    updateReadyVersion = info?.version || null;
    mainWindow.webContents.send('updater:update-downloaded', info);
  });

  autoUpdater.on('error', (err) => {
    log.error('[AutoUpdater] Error in auto-updater:', err);
    mainWindow.webContents.send('updater:error', err.message);
  });
}

