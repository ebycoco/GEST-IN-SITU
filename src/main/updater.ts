import { autoUpdater } from 'electron-updater';
import { BrowserWindow } from 'electron';
import log from 'electron-log';

export function initAutoUpdater(mainWindow: BrowserWindow): void {
  autoUpdater.logger = log;
  // CORRECTION N°2 : autoDownload désactivé (était true).
  // Raison : en mode production sur une machine sans release GitHub publiée,
  // l'ancien comportement déclenchait un téléchargement agressif ou une exception
  // réseau non gérée qui bloquait silencieusement le démarrage sur les PC cibles.
  autoUpdater.autoDownload = false;
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
    // CORRECTION N°2 : Ce handler intercepte désormais les erreurs réseau (404
    // si latest.yml absent sur GitHub, timeout, etc.) sans crasher le processus.
    log.warn('Auto-updater non critique :', err.message);
    mainWindow.webContents.send('updater:error', err.message);
  });

  // CORRECTION N°2 : L'appel checkForUpdates() est wrappé dans un try/catch
  // asynchrone pour étouffer toute exception synchrone (ex: configuration GitHub
  // absente, réseau inexistant au démarrage) qui gelait le démarrage sur PC cible.
  // Le check initial est également retardé de 10 secondes pour laisser le temps
  // à la fenêtre de s'afficher complètement avant toute requête réseau bloquante.
  setTimeout(() => {
    // Désactivé car non supporté nativement par Inno Setup (génère une erreur ENOENT app-update.yml).
    // Les mises à jour sont vérifiées via Supabase.
    /*
    try {
      autoUpdater.checkForUpdates().catch((err: Error) => {
        log.warn('Vérification de mise à jour impossible (non critique) :', err.message);
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn('Vérification de mise à jour impossible (non critique) :', message);
    }
    */
  }, 10_000); // Délai de 10 secondes après le démarrage

  // Check toutes les 4 heures
  setInterval(() => {
    // Désactivé
    /*
    try {
      autoUpdater.checkForUpdates().catch((err: Error) => {
        log.warn('Vérification périodique de mise à jour impossible (non critique) :', err.message);
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn('Vérification périodique de mise à jour impossible (non critique) :', message);
    }
    */
  }, 4 * 60 * 60 * 1000);
}
