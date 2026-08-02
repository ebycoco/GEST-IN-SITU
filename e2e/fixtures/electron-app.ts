/**
 * e2e/fixtures/electron-app.ts
 *
 * Helper de cycle de vie pour lancer une instance isolée de GEST-IN-SITU
 * sous Playwright (`_electron`).
 *
 * ── Isolation ─────────────────────────────────────────────────────────────
 * Chaque test obtient son propre répertoire temporaire jetable
 * (`fs.mkdtempSync`, jamais un chemin fixe committé), passé à l'application
 * via le switch natif Chromium `--user-data-dir`. `getDbPath()`
 * (`src/main/database/connection.ts`) dérive systématiquement son chemin de
 * `app.getPath('userData')`, qui reflète ce switch — aucune modification de
 * `connection.ts` ni de `index.ts` n'est nécessaire pour cette isolation.
 *
 * Un `--user-data-dir` distinct par run place également le verrou
 * `requestSingleInstanceLock()` (index.ts:50) dans un répertoire différent
 * de celui d'une session dev/terrain réelle : aucun risque de collision ou
 * de kill accidentel d'une instance de production en cours d'exécution sur
 * la même machine.
 *
 * ── Isolation Supabase (réseau) ──────────────────────────────────────────
 * `env: { ...process.env }` hérite du `.env` du poste (donc du VRAI
 * `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` de production) : sans garde
 * supplémentaire, le SyncEngine et le NetworkMonitor de l'app lancée ici
 * tenteraient de parler au projet Supabase réel dès `syncEngine.init()`
 * (3s après `ready-to-show`, voir src/main/index.ts). On ajoute donc
 * `GEST_IN_SITU_E2E_DISABLE_SYNC=1` à l'environnement de l'app lancée :
 * cette variable est lue par `src/main/sync/network-monitor.ts`
 * (bloque tout `net.request` réel, y compris via forcePing()/resetAndRetry()
 * déclenchés depuis le bouton "Réessayer" de l'UI), `src/main/sync/
 * supabase-client.ts` (`getSupabaseClient()` renvoie `null`, ce que tous ses
 * appelants — upstream, downstream, outbox, preloadUsersFromCloud, handlers
 * IPC — null-checkent déjà et no-opent proprement) et `src/main/sync/
 * bulk-uploader.ts` (le seul flux qui construit son propre client Supabase à
 * partir des variables d'env DANS un Worker Thread, en contournant
 * `getSupabaseClient()`). Résultat : le réseau reste bloqué en `OFFLINE`
 * pendant toute la durée du test — comportement volontaire et sûr pour un
 * test e2e offline-first, jamais activé par défaut en dev ou en production
 * (cette variable n'est positionnée nulle part ailleurs dans le dépôt).
 *
 * ── Prérequis ─────────────────────────────────────────────────────────────
 * Nécessite un build préalable (`electron-vite build` → `dist/main/index.js`,
 * `dist/preload/index.js`, `dist/renderer/index.html`), déclenché par le
 * script `pretest:e2e` de package.json — jamais par cet helper lui-même.
 *
 * ── Mode e2e-cloud (`allowRealSync: true`) ──────────────────────────────────
 * Trois scénarios (pull "Récupérer depuis le Cloud", push "Synchroniser mes
 * actions", et le fallback `cartes.searchCloudEmergency`) ne peuvent PAS être
 * validés avec `GEST_IN_SITU_E2E_DISABLE_SYNC=1` puisque cette variable coupe
 * précisément tout accès réseau Supabase. Pour ces specs uniquement,
 * `launchSeededApp({ allowRealSync: true })` :
 *   1. NE positionne PAS `GEST_IN_SITU_E2E_DISABLE_SYNC` dans l'environnement
 *      de l'app lancée (réseau réel autorisé pour cette instance).
 *   2. Lance l'app depuis `dist-e2e-cloud/main/index.js` (PAS `dist/`) — un
 *      build physiquement distinct, produit avec `--mode e2e`, qui pointe
 *      vers le projet Supabase de DEV/STAGING défini dans `.env.e2e`
 *      (jamais le projet de production défini dans `.env`). Voir le
 *      commentaire en tête d'`electron.vite.config.ts` pour le détail du
 *      mécanisme d'isolation (`loadEnv`/`--mode`, dossier de sortie distinct).
 * Appelée sans argument (ou avec `allowRealSync` omis/false), cette fonction
 * est STRICTEMENT INCHANGÉE : tous les specs existants continuent à tourner
 * contre `dist/` avec le réseau Supabase coupé, comme avant.
 *
 * Procédure exacte pour lancer les tests e2e-cloud :
 *   1. Construire le build isolé (jamais lancé automatiquement par un agent —
 *      CLAUDE.md §1 — cette commande est à exécuter par un humain) :
 *        npx electron-vite build --mode e2e
 *      → écrit dans `dist-e2e-cloud/` à partir de `.env.e2e`, laisse `dist/`
 *      intact (le build prod qui s'y trouve déjà n'est pas touché).
 *   2. Lancer UNIQUEMENT les specs cloud (à écrire sous un nom identifiable,
 *      ex. `e2e/specs/*.cloud.e2e.spec.ts`) avec `npx playwright test <fichier>`
 *      — ces specs doivent appeler `launchSeededApp({ allowRealSync: true })`.
 *      Ne PAS utiliser `npm run test:e2e` pour ces specs : son hook
 *      `pretest:e2e` relancerait `electron-vite build` (mode par défaut =
 *      production) et régénérerait `dist/` — sans effet sur `dist-e2e-cloud/`
 *      ni sur ces tests, mais c'est une reconstruction inutile à éviter.
 *   3. Retour en sécurité au build de production après la session de tests :
 *      `dist/` n'a jamais été modifié par l'étape 1 (voir mécanisme
 *      d'isolation), donc AUCUNE action n'est nécessaire pour restaurer un
 *      état "prod" fonctionnel. Par prudence avant toute publication réelle,
 *      reconstruire `dist/` proprement quand même :
 *        npx electron-vite build
 *      (mode par défaut = production, lit `.env`, écrit dans `dist/`).
 *      `dist-e2e-cloud/` peut être supprimé à tout moment sans risque
 *      (`rm -rf dist-e2e-cloud`) : aucune commande de packaging n'en dépend.
 */
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
// ⚠️ N'IMPORTE JAMAIS `./seed-database` directement ici : ce module charge
// `better-sqlite3` (natif, ABI Electron) au niveau top-level, ce qui ferait
// planter ce fichier dès son import sous le Node système du test-runner
// Playwright (voir seed-runner.ts). Seul `runSeedInElectronNode()` — qui
// n'importe qu'un `type` de seed-database.ts, effacé à la compilation — est
// sûr à utiliser ici.
import { runSeedInElectronNode, type SeedResult } from './seed-runner';

const PROJECT_ROOT = resolve(__dirname, '../..');
// Build de production standard (réseau Supabase coupé par défaut, voir plus bas).
const MAIN_ENTRY_PROD = join(PROJECT_ROOT, 'dist', 'main', 'index.js');
// Build isolé e2e-cloud (`electron-vite build --mode e2e`), pointé vers le
// projet Supabase de dev/staging via `.env.e2e` — jamais le projet de prod.
const MAIN_ENTRY_E2E_CLOUD = join(PROJECT_ROOT, 'dist-e2e-cloud', 'main', 'index.js');

export interface E2EEnvironment {
  app: ElectronApplication;
  window: Page;
  userDataDir: string;
  seed: SeedResult;
}

export interface LaunchSeededAppOptions {
  /**
   * `true` UNIQUEMENT pour les specs qui valident réellement le pull cloud,
   * le bulk upload ou `searchCloudEmergency` contre le projet Supabase de
   * dev/staging. Ne positionne pas `GEST_IN_SITU_E2E_DISABLE_SYNC` (réseau
   * réel autorisé) et lance l'app depuis `dist-e2e-cloud/` au lieu de
   * `dist/`. Par défaut `false` : comportement 100% inchangé pour tous les
   * specs existants (réseau coupé, build `dist/` standard).
   */
  allowRealSync?: boolean;
}

/**
 * Attend la fenêtre applicative réelle (pas le splashscreen) parmi les
 * fenêtres déjà ouvertes ou à venir. Voir le commentaire dans
 * `launchSeededApp()` pour le détail empirique du problème contourné.
 */
async function waitForMainWindow(app: ElectronApplication, timeoutMs: number): Promise<Page> {
  const isSplash = (win: Page): boolean => {
    try {
      return win.isClosed() || win.url().includes('splash.html');
    } catch {
      return true;
    }
  };

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const candidate = app.windows().find((win) => !isSplash(win));
    if (candidate) return candidate;

    await Promise.race([
      app.waitForEvent('window', { timeout: 2000 }).catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, 500))
    ]);
  }

  throw new Error(
    `[E2E][electron-app] Aucune fenêtre applicative (hors splashscreen) détectée dans le délai de ${timeoutMs}ms.`
  );
}

/**
 * Vérifie si un PID est encore vivant, de façon portable (POSIX comme Windows).
 * Le signal 0 ne termine rien : Node se contente d'ouvrir un handle vers le
 * process pour tester son existence, et lève une exception (ESRCH) s'il n'y
 * en a plus. Utilisé uniquement par la vérification post-taskkill ci-dessous.
 */
function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Crée un répertoire utilisateur jetable, y sème une base SQLite au schéma
 * réel (v60) avec les données de test, puis lance l'application dessus.
 *
 * Le seed s'exécute via `runSeedInElectronNode()` car `better-sqlite3` est
 * un module natif compilé pour l'ABI Node d'Electron : il ne peut pas être
 * chargé directement depuis le process Node du test-runner Playwright (voir
 * seed-runner.ts pour le détail empirique de ce contournement).
 */
export async function launchSeededApp(options: LaunchSeededAppOptions = {}): Promise<E2EEnvironment> {
  const { allowRealSync = false } = options;
  const userDataDir = mkdtempSync(join(tmpdir(), 'gest-in-situ-e2e-'));

  const seed = await runSeedInElectronNode(userDataDir);

  const mainEntry = allowRealSync ? MAIN_ENTRY_E2E_CLOUD : MAIN_ENTRY_PROD;
  if (allowRealSync && !existsSync(mainEntry)) {
    throw new Error(
      `[E2E][electron-app] allowRealSync: true mais aucun build e2e-cloud trouvé à ` +
      `${mainEntry}. Construisez-le d'abord avec : npx electron-vite build --mode e2e ` +
      `(voir le commentaire "Mode e2e-cloud" en tête de ce fichier).`
    );
  }

  // `process.env` est typé `{ [key: string]: string | undefined }` par Node ;
  // l'API Playwright exige `{ [key: string]: string }`. En pratique, toute
  // propriété réellement énumérée sur `process.env` est une string (jamais
  // `undefined`) — ce cast est donc sûr.
  const baseEnv = { ...(process.env as Record<string, string>) };
  if (!allowRealSync) {
    // Coupe tout accès réseau réel à Supabase (prod) pour cette instance —
    // voir le commentaire d'isolation Supabase en tête de fichier.
    baseEnv.GEST_IN_SITU_E2E_DISABLE_SYNC = '1';
  } else {
    // allowRealSync: true — s'assurer qu'aucune valeur héritée de l'environnement
    // hôte ne coupe le réseau pour cette instance volontairement "cloud".
    delete baseEnv.GEST_IN_SITU_E2E_DISABLE_SYNC;
  }

  const app = await electron.launch({
    args: [mainEntry, `--user-data-dir=${userDataDir}`],
    env: baseEnv
  });

  // ⚠️ Découverte empirique : `app.firstWindow()` retourne la toute première
  // fenêtre détectée par CDP, qui peut être la fenêtre de SPLASHSCREEN
  // (créée par `createSplashWindow()` dans src/main/index.ts, plusieurs
  // secondes AVANT la fenêtre principale) plutôt que la fenêtre applicative
  // réelle. Le splash se ferme ensuite automatiquement (sur `ready-to-show`
  // de la fenêtre principale), ce qui invalide la référence `Page` déjà
  // capturée par `firstWindow()` et casse tout `waitForURL()` ultérieur
  // avec `Target page, context or browser has been closed` — observé de
  // façon intermittente (course entre les deux fenêtres). Fix contenu à
  // cette fixture (aucune modification de index.ts) : on ignore
  // explicitement toute fenêtre dont l'URL contient `splash.html` et on
  // attend la fenêtre applicative réelle (dist/renderer/index.html).
  const window = await waitForMainWindow(app, 120_000);
  await window.waitForLoadState('domcontentloaded');

  return { app, window, userDataDir, seed };
}

/**
 * Ferme proprement l'instance Electron puis nettoie le répertoire temporaire
 * — sauf en cas d'échec du test, où la base est conservée pour diagnostic
 * (chemin loggé pour retrouver la base SQLite et les logs electron-log).
 */
export async function teardownSeededApp(env: E2EEnvironment, testFailed: boolean): Promise<void> {
  // ⚠️ Découverte empirique (spike de validation) : `app.close()` déclenche le
  // handler réel `mainWindow.on('close', ...)` de src/main/index.ts, qui peut
  // afficher une modale native BLOQUANTE (`dialog.showMessageBoxSync`) si une
  // synchronisation Supabase est en cours au moment de la fermeture. Cet appel
  // est SYNCHRONE côté process principal Electron : il gèle tout le event-loop
  // du main process (donc aussi tout futur `app.evaluate()`/RPC CDP), rendant
  // toute fermeture "gracieuse" impossible à distance dans ce cas précis.
  // Fix ciblé, contenu à cette fixture (aucune modification de index.ts) :
  // course entre une fermeture gracieuse courte et un arrêt forcé du process
  // OS sous-jacent (`ChildProcess.kill()`), qui contourne totalement le JS
  // bloqué puisqu'il agit au niveau du système d'exploitation.
  try {
    await Promise.race([
      env.app.close(),
      new Promise<void>((resolve) => setTimeout(resolve, 8000))
    ]);
  } catch (err) {
    // Non-bloquant : l'app peut déjà être fermée (crash applicatif pendant le test).
    console.warn('[E2E][electron-app] Échec de la fermeture propre de l\'app :', err);
  } finally {
    try {
      const proc = env.app.process();
      if (proc.exitCode === null && proc.signalCode === null && proc.pid) {
        // Constat empirique : `ChildProcess.kill()` de Node ne tue QUE le
        // process electron.exe immédiat, pas les processus enfants (GPU,
        // renderer, utility) qu'Electron démarre systématiquement. Ces
        // enfants orphelins restent vivants, gardent ouverts les handles de
        // fichiers (SQLite WAL/SHM sous userDataDir) ET les pipes
        // stdout/stderr hérités — ce qui bloque indéfiniment tout code
        // attendant la fermeture réelle de ces flux (dont le teardown
        // interne du worker Playwright, observé en pratique via
        // "Worker teardown timeout of 180000ms exceeded"). Sur Windows,
        // seul `taskkill /T /F` (arrêt de l'arbre de processus complet)
        // termine fiablement tout le groupe.
        const exited = new Promise<void>((resolve) => proc.once('exit', () => resolve()));
        if (process.platform === 'win32') {
          try {
            await execFileAsync('taskkill', ['/PID', String(proc.pid), '/T', '/F']);
          } catch (taskkillErr) {
            console.warn('[E2E][electron-app] taskkill /T /F a échoué :', taskkillErr);
          }
        } else {
          proc.kill();
        }

        const exitedInTime = await Promise.race([
          exited.then(() => true),
          new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 5000))
        ]);

        // ⚠️ Durcissement (constat terrain) : ne JAMAIS supposer que le process
        // est mort simplement parce que taskkill/kill n'a pas levé d'exception
        // ou que l'attente de 5s s'est écoulée. Des runs précédents ont laissé
        // des electron.exe orphelins actifs en tâche de fond, qui continuaient
        // à synchroniser vers le projet Supabase DEV PARTAGÉ et provoquaient de
        // fausses erreurs "violates foreign key constraint t_cartes_id_site_fkey"
        // sur des runs ultérieurs sans rapport. On ne fait cette vérification
        // bornée (poll léger, 4s max) QUE si 'exit' n'est pas arrivé à temps :
        // dans le cas normal (l'immense majorité), rien n'est ajouté au délai.
        if (!exitedInTime && proc.pid) {
          const POLL_INTERVAL_MS = 500;
          const pollDeadline = Date.now() + 4000;
          let alive = isPidAlive(proc.pid);
          while (alive && Date.now() < pollDeadline) {
            await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
            alive = isPidAlive(proc.pid);
          }
          if (alive) {
            console.warn(
              `[E2E][electron-app] ALERTE : le process electron.exe (PID ${proc.pid}) semble ` +
              `TOUJOURS ACTIF ~9s après l'arrêt forcé (taskkill/kill). Process probablement ` +
              `orphelin — vérifiez manuellement (ex: Get-Process -Id ${proc.pid}) et terminez-le : ` +
              `un electron.exe orphelin continue de synchroniser vers le Supabase dev partagé et ` +
              `peut fausser les runs e2e suivants.`
            );
          } else {
            console.warn(
              `[E2E][electron-app] Le process electron.exe (PID ${proc.pid}) a mis plus de 5s à ` +
              `disparaître après l'arrêt forcé, mais est bien terminé (vérification explicite).`
            );
          }
        }
      }
    } catch (killErr) {
      console.warn('[E2E][electron-app] Échec de l\'arrêt forcé du process Electron :', killErr);
    }
    // Marge de sécurité supplémentaire : sur Windows, la libération des
    // handles de fichiers par le noyau peut légèrement retarder la sortie
    // effective du process au-delà de l'événement 'exit' de Node lui-même
    // (EPERM observé empiriquement sur le rmSync ci-dessous avec une marge
    // plus courte).
    await new Promise((resolve) => setTimeout(resolve, 2500));
  }

  if (testFailed) {
    console.warn(
      `[E2E][electron-app] Test en échec — répertoire conservé pour diagnostic : ${env.userDataDir}`
    );
    return;
  }

  try {
    rmSync(env.userDataDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 500 });
  } catch (err) {
    console.warn('[E2E][electron-app] Échec du nettoyage du répertoire temporaire :', err);
  }
}
