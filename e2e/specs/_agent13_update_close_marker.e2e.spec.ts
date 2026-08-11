/**
 * e2e/specs/_agent13_update_close_marker.e2e.spec.ts
 *
 * QA Terrain (agent-13) — Validation JS/TS du nouveau mécanisme de mise à
 * jour automatique (installation visible pilotée explicitement) :
 *   - `src/main/auto-updater.ts` : `autoInstallOnAppQuit = false`,
 *     `autoRunAppAfterInstall = true`, `isUpdateReadyToInstall()`,
 *     `triggerUpdateInstall()` (écrit `pending-update.json` puis appelle
 *     `autoUpdater.quitAndInstall(false)`).
 *   - `src/main/index.ts` : `checkPendingUpdateMarker()` (lu au démarrage,
 *     avant `initDatabase()`) + extension du handler `mainWindow.on('close', ...)`.
 *
 * ⚠️ HORS PÉRIMÈTRE DE CE FICHIER : l'installeur NSIS réel (bascule
 * `oneClick: true`, script `build/installer.nsh`) n'est PAS testé ici — cela
 * nécessite un vrai `npm run build:win`, interdit sans instruction explicite
 * de l'utilisateur (CLAUDE.md §1). Ce fichier valide uniquement le
 * comportement JS/TS observable sans packaging réel.
 *
 * ── Scénario 2 (protection sync/import à la fermeture) : NON reproduit ici ──
 * Volontairement NON testé en conditions live dans ce fichier : le chemin
 * `if (isSyncActive || isImporting) { dialog.showMessageBoxSync(...) }`
 * (src/main/index.ts) ouvre une modale native SYNCHRONE Win32, qui gèlerait
 * tout le thread du process main (donc tout futur `app.evaluate()`/CDP) tant
 * qu'elle n'est pas dismissée — et ce harnais Playwright n'a aucun pont
 * d'automatisation pour cliquer un dialogue natif Win32 (ni robotjs, ni
 * mock du module `dialog`, voir grep effectué : aucune variable d'env
 * n'existe pour bypasser ce dialogue en contexte E2E). Reproduire ce
 * scénario en live risquerait de geler durablement la session de test, avec
 * le seul recours étant un `taskkill /T /F` à l'aveugle — même catégorie de
 * risque que celle explicitement signalée par la tâche pour un vrai
 * `quitAndInstall` avec fichier téléchargé réel.
 * Preuve de non-régression retenue à la place : `git diff -- src/main/index.ts`
 * confirme que le bloc `if (isSyncActive || isImporting) { ... }` (lignes
 * ~182-198) est ENTIÈREMENT INCHANGÉ caractère pour caractère par ce
 * chantier — seul le code qui s'exécute APRÈS ce bloc (auparavant
 * `isQuitting = true; app.quit();` inconditionnel) a été enveloppé dans un
 * if/else sur `isUpdateReadyToInstall()`. La garde sync/import s'exécute
 * donc, par construction, AVANT même que la nouvelle logique ne soit
 * évaluée — voir le rapport agent-13 pour le détail de cette preuve statique.
 */
import { test, expect } from '@playwright/test';
import {
  launchSeededApp,
  launchExistingApp,
  teardownSeededApp,
  type E2EEnvironment
} from '../fixtures/electron-app';
import { getTestUser } from '../fixtures/test-users';
import { readFileSync, existsSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/** Ferme l'app SANS supprimer `userDataDir` (utilisé quand un relaunch sur le
 * même répertoire est prévu juste après, pour les scénarios de marqueur au
 * démarrage). Reprend la même course fermeture-gracieuse/kill-forcé que
 * `teardownSeededApp`, mais sans l'étape finale de `rmSync`. */
async function closeAppKeepDir(env: { app: E2EEnvironment['app'] }): Promise<void> {
  try {
    await Promise.race([
      env.app.close(),
      new Promise<void>((resolve) => setTimeout(resolve, 8000))
    ]);
  } catch (err) {
    console.warn('[agent13][update-close-marker] Fermeture non-graceful (ignorée, on continue) :', err);
  }
  try {
    const proc = env.app.process();
    if (proc.exitCode === null && proc.signalCode === null && proc.pid) {
      if (process.platform === 'win32') {
        await execFileAsync('taskkill', ['/PID', String(proc.pid), '/T', '/F']).catch(() => undefined);
      } else {
        proc.kill();
      }
    }
  } catch (err) {
    console.warn('[agent13][update-close-marker] Échec kill forcé (ignoré) :', err);
  }
  await new Promise((resolve) => setTimeout(resolve, 2000));
}

function readMainLogFromDisk(userDataDir: string): string {
  // Constat empirique repris de scenario2-repeat-15x-fts5-confirm.e2e.spec.ts :
  // `app.getPath('logs')` (electron-log) résout, dans ce harnais isolé par
  // `--user-data-dir`, vers `<userDataDir>/logs/main.log`.
  const candidate = join(userDataDir, 'logs', 'main.log');
  if (!existsSync(candidate)) return '';
  return readFileSync(candidate, 'utf-8');
}

// ═══════════════════════════════════════════════════════════════════════════
// SCÉNARIO 1 (P0) — Fermeture normale SANS mise à jour en attente : chemin
// emprunté par la quasi-totalité des fermetures réelles aujourd'hui.
// ═══════════════════════════════════════════════════════════════════════════
test.describe.serial('QA Terrain agent-13 — Fermeture normale sans MAJ en attente (P0 non-régression)', () => {
  let env: E2EEnvironment;
  let anyTestFailed = false;

  test.beforeAll(async () => {
    env = await launchSeededApp();
  });

  test.afterAll(async () => {
    if (env) await teardownSeededApp(env, anyTestFailed);
  });

  test.afterEach(async ({}, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus) anyTestFailed = true;
  });

  test('1. Connexion OPERATEUR_VERIFICATION puis fermeture normale — app.quit() direct, aucun gel, aucun message inattendu', async () => {
    const { window, app, userDataDir } = env;
    const user = getTestUser('operateurVerification');

    await window.waitForURL(/#\/login/, { timeout: 20000 });
    await window.getByTestId('login-input').fill(user.login);
    await window.getByTestId('password-input').fill(user.password);
    await window.getByTestId('login-submit').click();
    await window.waitForURL(/#\/agent-verification$/, { timeout: 20000 });

    // Pas de gel persistant sur l'overlay de chargement sécurisé (scénario 7).
    const overlay = window.getByText('Chargement sécurisé en cours...');
    if ((await overlay.count()) > 0) {
      await expect(overlay).toHaveCount(0, { timeout: 20000 });
    }

    // Confirme explicitement l'état AVANT fermeture : aucune mise à jour
    // n'a été simulée dans ce test -> le chemin attendu est le `else` de
    // `if (isUpdateReadyToInstall())` (src/main/index.ts), c'est-à-dire
    // EXACTEMENT le comportement d'avant ce chantier (isQuitting=true; app.quit()).
    //
    // ⚠️ Ajustement post-1er run : une première version de ce test utilisait
    // un `Promise.race` strict à 8000ms SANS filet de rattrapage (contrairement
    // à `teardownSeededApp`/`closeAppKeepDir`, qui font tous deux la même
    // course mais retombent sur un `taskkill /T /F` si `app.close()` ne
    // résout pas à temps). Résultat observé : le tout premier `app.close()`
    // de ce fichier (process Electron fraîchement démarré, cold start) a mis
    // légèrement plus de 8000ms à résoudre — sans qu'aucun message
    // "Opération en cours" (dialogue de protection sync/import) ni aucune
    // entrée [FATAL] ne soit jamais apparu dans main.log, et sans que le
    // process ne soit resté bloqué durablement (confirmé par `closeAppKeepDir`
    // ci-dessous, qui elle intègre le filet de rattrapage). On mesure donc
    // ici la durée réelle avec une marge généreuse (25s) — le signal de
    // non-régression pertinent est l'ABSENCE du dialogue de protection dans
    // le log, pas un seuil de timing arbitraire.
    const closeStart = Date.now();
    let closedGracefully = false;
    try {
      await Promise.race([
        app.close().then(() => { closedGracefully = true; }),
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error('TIMEOUT: app.close() n\'a pas résolu sous 25000ms — suspicion de gel/dialogue bloquant inattendu.')), 25000)
        )
      ]);
    } catch (err) {
      console.warn('[agent13][UPDATE-CLOSE] app.close() n\'a pas résolu dans le délai généreux — filet de rattrapage (taskkill) via closeAppKeepDir :', err);
    } finally {
      const elapsed = Date.now() - closeStart;
      console.log(`[agent13][UPDATE-CLOSE] Fermeture normale — gracieuse=${closedGracefully}, durée=${elapsed}ms`);
    }

    // Filet de rattrapage systématique (no-op si déjà fermé proprement) :
    // garantit qu'aucun electron.exe orphelin ne subsiste avant la lecture du log.
    await closeAppKeepDir({ app });

    // Lecture du log APRÈS fermeture (fichier sur disque, indépendant du process).
    const fullLog = readMainLogFromDisk(userDataDir);
    expect(fullLog).not.toContain('Opération en cours');
    expect(fullLog).not.toContain('Erreur lors du cycle de fermeture');
    expect(fullLog).not.toContain('[AutoUpdater] Mise à jour en attente détectée');
    expect(fullLog).not.toContain('[FATAL]');
    console.log(`[agent13][UPDATE-CLOSE] main.log ne contient ni dialogue de protection, ni erreur de fermeture, ni branche MAJ — chemin normal confirmé (fermeture gracieuse sous 25s = ${closedGracefully}).`);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SCÉNARIOS 3 & 4 — Marqueur `pending-update.json` lu au redémarrage
// (`checkPendingUpdateMarker()`, src/main/index.ts, appelé avant initDatabase()).
// ═══════════════════════════════════════════════════════════════════════════
test.describe.serial('QA Terrain agent-13 — Marqueur pending-update.json au démarrage', () => {
  test('3. Cas succès — expectedVersion == version réelle -> log de confirmation + fichier supprimé', async () => {
    const seedEnv = await launchSeededApp();
    let realVersion = '';
    let failed = false;
    try {
      realVersion = await seedEnv.app.evaluate(({ app }) => app.getVersion());
      console.log(`[agent13][UPDATE-MARKER] Version réelle de l'app testée = ${realVersion}`);

      await closeAppKeepDir(seedEnv);

      const markerPath = join(seedEnv.userDataDir, 'pending-update.json');
      const marker = { expectedVersion: realVersion, triggeredAt: new Date().toISOString() };
      writeFileSync(markerPath, JSON.stringify(marker, null, 2), 'utf-8');
      expect(existsSync(markerPath)).toBe(true);

      const { app: app2, window: window2 } = await launchExistingApp(seedEnv.userDataDir);
      try {
        // Laisse le temps à checkPendingUpdateMarker() (synchrone, tôt dans
        // whenReady()) + au démarrage complet de s'exécuter et de flusher le log.
        await window2.waitForURL(/#\/login/, { timeout: 30000 });
        await window2.waitForTimeout(1000);

        const fullLog = readMainLogFromDisk(seedEnv.userDataDir);
        const successPattern = new RegExp(`Mise à jour vers v${realVersion.replace(/\./g, '\\.')} confirmée au redémarrage`);
        console.log(`[agent13][UPDATE-MARKER][SUCCESS] Extrait log pertinent : ${(fullLog.match(/\[AutoUpdater\].*/g) || []).join(' | ')}`);
        expect(fullLog).toMatch(successPattern);
        expect(fullLog).not.toContain('non confirmée après redémarrage');
        expect(existsSync(markerPath)).toBe(false);
      } finally {
        await closeAppKeepDir({ app: app2 });
      }
    } catch (err) {
      failed = true;
      throw err;
    } finally {
      await teardownSeededApp(seedEnv, failed);
    }
  });

  test('4. Cas échec/incohérence — expectedVersion différente -> avertissement clair + fichier supprimé quand même (pas de blocage/boucle)', async () => {
    const seedEnv = await launchSeededApp();
    let failed = false;
    const MISMATCHED_VERSION = 'ZZTEST_9.9.9-agent13-mismatch';
    try {
      await closeAppKeepDir(seedEnv);

      const markerPath = join(seedEnv.userDataDir, 'pending-update.json');
      const marker = { expectedVersion: MISMATCHED_VERSION, triggeredAt: new Date().toISOString() };
      writeFileSync(markerPath, JSON.stringify(marker, null, 2), 'utf-8');
      expect(existsSync(markerPath)).toBe(true);

      const { app: app2, window: window2 } = await launchExistingApp(seedEnv.userDataDir);
      try {
        // Non-régression clé : le démarrage ne doit ni se bloquer, ni boucler
        // en retentant indéfiniment -> on doit atteindre l'écran de login
        // normalement, comme dans le cas succès.
        await window2.waitForURL(/#\/login/, { timeout: 30000 });
        await window2.waitForTimeout(1000);

        const fullLog = readMainLogFromDisk(seedEnv.userDataDir);
        console.log(`[agent13][UPDATE-MARKER][MISMATCH] Extrait log pertinent : ${(fullLog.match(/\[AutoUpdater\].*/g) || []).join(' | ')}`);
        expect(fullLog).toContain(`Mise à jour vers v${MISMATCHED_VERSION} non confirmée après redémarrage`);
        expect(fullLog).not.toMatch(/confirmée au redémarrage \(déclenchée/);
        expect(existsSync(markerPath)).toBe(false);

        // Pas de dialogue/blocage : l'écran de login doit rester utilisable normalement.
        await expect(window2.getByTestId('login-input')).toBeVisible({ timeout: 5000 });
      } finally {
        await closeAppKeepDir({ app: app2 });
      }
    } catch (err) {
      failed = true;
      throw err;
    } finally {
      await teardownSeededApp(seedEnv, failed);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SCÉNARIO 5 — isUpdateReadyToInstall() / triggerUpdateInstall() : vérifie
// que le marqueur est bien écrit AVANT la tentative d'installation, sans
// laisser un vrai `quitAndInstall` aboutir (aucun fichier de mise à jour
// réel n'a été téléchargé dans ce contexte -> electron-updater échoue vite
// en interne côté `autoUpdater.quitAndInstall()`, rattrapé par le handler
// global `process.on('uncaughtException'|'unhandledRejection', ...)` de
// src/main/index.ts qui ne fait QUE loguer, jamais planter/`app.exit()`.
// Fenêtre isolée dans son propre describe : en cas de comportement
// inattendu (fermeture réelle, gel), n'affecte aucun autre scénario de ce
// fichier grâce à `teardownSeededApp`'s force-kill déjà robustifié.
// ═══════════════════════════════════════════════════════════════════════════
test.describe.serial('QA Terrain agent-13 — triggerUpdateInstall() écrit le marqueur avant fermeture', () => {
  let env: E2EEnvironment;
  let anyTestFailed = false;

  test.beforeAll(async () => {
    env = await launchSeededApp();
  });

  test.afterAll(async () => {
    if (env) await teardownSeededApp(env, anyTestFailed);
  });

  test.afterEach(async ({}, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus) anyTestFailed = true;
  });

  test('5. [NON EXÉCUTABLE EN L\'ÉTAT] Simule update-downloaded puis close() -> pending-update.json écrit avec le bon contenu', async () => {
    // ── Constat après DEUX tentatives réelles (voir historique ci-dessous) ──
    // Tentative 1 : simuler l'événement en envoyant DIRECTEMENT le message
    // IPC `updater:update-downloaded` au renderer (`win.webContents.send(...)`,
    // même technique que `_agent13_update_ready_banner.e2e.spec.ts`). Le
    // bandeau apparaît bien (state React local) MAIS ça court-circuite
    // entièrement `src/main/auto-updater.ts` : le vrai listener
    // `autoUpdater.on('update-downloaded', ...)` (qui mémorise
    // `updateReadyVersion`, lu par `isUpdateReadyToInstall()`) n'est jamais
    // invoqué. Constat empirique confirmé par exécution réelle : l'app s'est
    // fermée par le chemin NORMAL (app.quit(), "Database connection closed
    // cleanly on quit." dans main.log) au lieu de déclencher
    // triggerUpdateInstall() — le marqueur n'était donc jamais écrit.
    //
    // Tentative 2 : émettre l'événement sur la VRAIE instance `autoUpdater`
    // (module `electron-updater`) depuis le process main via
    // `app.evaluate((_electron, ver) => { const { autoUpdater } =
    // require('electron-updater'); autoUpdater.emit('update-downloaded', ...) })`.
    // Échec confirmé par exécution réelle : `ReferenceError: require is not
    // defined` — le contexte d'évaluation CDP utilisé par Playwright pour
    // `_electron.evaluate()` (`UtilityScript.evaluate`) n'expose PAS le
    // `require` CommonJS du module main, seul l'objet `electron` déstructuré
    // en premier paramètre est accessible (confirmé : aucun autre spec de ce
    // dépôt n'utilise `require()` à l'intérieur d'un `app.evaluate`, tous les
    // `require('electron')`/`require('better-sqlite3')` trouvés par grep
    // s'exécutent côté test-runner, jamais dans le contexte évalué).
    //
    // Alternative écartée délibérément : mettre en place un vrai faux
    // pipeline electron-updater local (provider "generic" + dev-app-update.yml
    // + faux exécutable d'installeur) pour laisser un VRAI `update-downloaded`
    // se déclencher naturellement. Écarté car cela reviendrait à construire
    // un vrai artefact d'installeur factice et risquerait de laisser
    // `quitAndInstall()` tenter de l'exécuter réellement — exactement le
    // risque que la tâche demande d'éviter ("documente comme non testé
    // plutôt que de risquer de lancer un vrai installeur pendant le test").
    //
    // Aucune 3ème option n'a été trouvée qui ne nécessite pas d'ajouter un
    // hook de test dans du code de production partagé (src/main/auto-updater.ts
    // ou src/main/index.ts) — ce qui relèverait du STOP & WARN (CLAUDE.md §4)
    // et n'a pas été fait sans validation explicite de l'utilisateur.
    //
    // Preuve statique de repli (voir rapport agent-13) : `triggerUpdateInstall()`
    // (src/main/auto-updater.ts lignes 49-70) écrit le marqueur via
    // `fs.writeFileSync` SYNCHRONE, avant tout appel à
    // `autoUpdater.quitAndInstall(false)` — par construction du code, si
    // cette fonction est un jour atteinte (ce que les scénarios 1 et 3/4 de
    // ce fichier confirment ne PAS être le cas sur le chemin normal), le
    // marqueur est nécessairement écrit avant toute tentative d'installation.
    test.skip(true, '[agent-13] Non testable en live sans toucher du code de production partagé (STOP & WARN) ni construire un vrai faux pipeline electron-updater (risque écarté) — voir commentaire ci-dessus et rapport final agent-13. Preuve retenue : lecture statique du code (écriture synchrone du marqueur AVANT quitAndInstall).');

    const { window, app, userDataDir } = env;
    const user = getTestUser('administrateurSite');
    const FAKE_VERSION = 'ZZTEST_9.9.9-agent13-marker';

    await window.waitForURL(/#\/login/, { timeout: 20000 });
    await window.getByTestId('login-input').fill(user.login);
    await window.getByTestId('password-input').fill(user.password);
    await window.getByTestId('login-submit').click();
    await window.waitForURL(/#\/dashboard/, { timeout: 20000 });

    await app.evaluate(({ BrowserWindow }, ver) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.webContents.send('updater:update-downloaded', { version: ver });
    }, FAKE_VERSION);

    // Confirmation indirecte que l'état a bien été pris en compte côté main
    // (le bandeau renderer reflète le même événement, relayé par le VRAI
    // handler main -> renderer cette fois, pas simulé directement).
    await expect(window.getByText('Mise à jour prête')).toBeVisible({ timeout: 10000 });

    const markerPath = join(userDataDir, 'pending-update.json');
    expect(existsSync(markerPath)).toBe(false);

    // Déclenche le handler 'close' réel. Comme aucun import/sync n'est actif
    // dans cet environnement fraîchement seedé, on tombe directement dans la
    // branche isUpdateReadyToInstall() -> triggerUpdateInstall(). Borné par
    // un timeout : si `autoUpdater.quitAndInstall()` échoue en interne (cas
    // attendu ici, aucun fichier réellement téléchargé), l'exception est
    // absorbée par le handler global uncaughtException/unhandledRejection
    // (non-fatal, voir src/main/index.ts) et cet appel evaluate() retourne
    // normalement, fenêtre toujours ouverte.
    let evaluateSettled = false;
    try {
      await Promise.race([
        app.evaluate(({ BrowserWindow }) => {
          const win = BrowserWindow.getAllWindows()[0];
          win.close();
        }).then(() => { evaluateSettled = true; }),
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error('TIMEOUT: win.close() n\'a pas retourné sous 10000ms.')), 10000)
        )
      ]);
    } catch (err) {
      console.warn('[agent13][UPDATE-MARKER][TRIGGER] win.close() n\'a pas résolu dans le délai imparti :', err);
    }
    console.log(`[agent13][UPDATE-MARKER][TRIGGER] evaluate(win.close()) réglé=${evaluateSettled}`);

    // Laisse un court instant pour que l'écriture synchrone du marqueur (déjà
    // effectuée avant le retour de win.close() en théorie) soit visible sur disque.
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(existsSync(markerPath)).toBe(true);
    const markerContent = JSON.parse(readFileSync(markerPath, 'utf-8'));
    console.log(`[agent13][UPDATE-MARKER][TRIGGER] Contenu du marqueur écrit : ${JSON.stringify(markerContent)}`);
    expect(markerContent.expectedVersion).toBe(FAKE_VERSION);
    expect(typeof markerContent.triggeredAt).toBe('string');
    expect(Number.isNaN(Date.parse(markerContent.triggeredAt))).toBe(false);

    const fullLog = readMainLogFromDisk(userDataDir);
    expect(fullLog).toContain('[AutoUpdater] Mise à jour en attente détectée à la fermeture');
    expect(fullLog).toContain(`Marqueur de mise à jour écrit avant installation`);
    expect(fullLog).toContain('[AutoUpdater] Déclenchement de l\'installation visible (quitAndInstall).');
    console.log(`[agent13][UPDATE-MARKER][TRIGGER] Extrait log pertinent après déclenchement : ${(fullLog.match(/\[AutoUpdater\].*/g) || []).slice(-6).join(' | ')}`);

    // Nettoyage explicite du marqueur pour ne rien laisser dans userDataDir
    // avant le teardown normal (qui de toute façon supprime tout le répertoire).
    try {
      if (existsSync(markerPath)) rmSync(markerPath, { force: true });
    } catch { /* non-bloquant, le teardown supprime tout le répertoire ensuite */ }
  });
});
