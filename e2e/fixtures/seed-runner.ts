/**
 * e2e/fixtures/seed-runner.ts
 *
 * Exécute `seed-database.ts` (qui dépend de `better-sqlite3`, un module natif
 * compilé pour l'ABI Node d'Electron) depuis le test-runner Playwright (qui
 * s'exécute sous le Node système, ABI différente).
 *
 * ── Problème empiriquement vérifié (spike de validation) ────────────────────
 * `new (require('better-sqlite3'))(path)` exécuté sous le Node système lève
 * `ERR_DLOPEN_FAILED` ("was compiled against a different Node.js version") :
 * le binaire natif `better_sqlite3.node` présent dans node_modules est
 * compilé pour NODE_MODULE_VERSION 132 (Electron 34.x) alors que le Node
 * système utilisé pour lancer les tests (`npx playwright test`) est
 * NODE_MODULE_VERSION 137+ selon la version de Node installée.
 *
 * ── Solution retenue (sans toucher à src/main/index.ts) ─────────────────────
 * Le binaire `electron.exe` embarque exactement le runtime Node contre lequel
 * `better-sqlite3` a été compilé. Lancé avec la variable d'environnement
 * `ELECTRON_RUN_AS_NODE=1`, ce binaire se comporte comme un exécutable Node
 * standard (aucune fenêtre, aucune API `app`/`BrowserWindow` — celles-ci
 * restent `undefined`, ce qui est sans incidence ici car `schema.ts`
 * n'importe que `better-sqlite3`, `electron-log` et des modules internes
 * purs). On y exécute un bundle CommonJS autonome de `seed-database.ts`,
 * produit à la volée par esbuild (déjà présent dans les devDependencies via
 * `vite`, ajouté ici explicitement car utilisé directement).
 *
 * Le module natif `better-sqlite3` est exclu du bundle (`external`) : il est
 * résolu au moment de l'exécution via la variable d'environnement `NODE_PATH`
 * pointant vers le `node_modules` du projet, ce qui permet d'écrire le bundle
 * dans un répertoire temporaire jetable (hors de l'arborescence du projet)
 * sans casser la résolution de module CommonJS.
 *
 * Ce mécanisme est entièrement contenu dans `e2e/fixtures/` : aucune
 * modification de `connection.ts` ni de `index.ts`.
 */
import { build } from 'esbuild';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import type { SeedResult } from './seed-database';
// Ré-export nécessaire : `electron-app.ts` importe `SeedResult` directement
// depuis ce module (`./seed-runner`) plutôt que depuis `./seed-database`.
export type { SeedResult } from './seed-database';

const execFileAsync = promisify(execFile);

const SEED_RESULT_MARKER = '__E2E_SEED_RESULT__:';
const PROJECT_ROOT = resolve(__dirname, '../..');
const SEED_ENTRY = resolve(__dirname, 'seed-database.ts');

/**
 * Bundle `seed-database.ts` (+ son graphe d'imports réel : schema.ts,
 * local-auth.ts, payload-mapper.ts, test-users.ts...) en un unique fichier
 * CommonJS exécutable par Node/Electron, sans passer par `electron-vite`
 * (qui produirait un artefact orienté "application complète" et non un
 * script CLI autonome).
 */
async function bundleSeedScript(): Promise<string> {
  const result = await build({
    entryPoints: [SEED_ENTRY],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    // Seul le module natif doit rester résolu au runtime (NODE_PATH ci-dessous).
    // bcryptjs/electron-log sont du JS pur : les bundler évite toute dépendance
    // à un node_modules ambiant à l'endroit où le bundle est exécuté.
    external: ['better-sqlite3'],
    write: false,
    logLevel: 'silent'
  });

  const output = result.outputFiles?.[0]?.text;
  if (!output) {
    throw new Error('[E2E][seed-runner] esbuild n\'a produit aucune sortie pour seed-database.ts');
  }
  return output;
}

/**
 * Lance le bundle via le binaire Electron en mode ELECTRON_RUN_AS_NODE=1.
 * Retourne le résultat structuré du seed (site/centre/users ids + dbPath).
 */
export async function runSeedInElectronNode(userDataDir: string): Promise<SeedResult> {
  const bundleCode = await bundleSeedScript();

  // Répertoire temporaire jetable dédié au bundle — distinct du userDataDir
  // de l'app (qui ne doit contenir que les données Electron réelles).
  const bundleDir = mkdtempSync(join(tmpdir(), 'gest-in-situ-e2e-seedbundle-'));
  const bundlePath = join(bundleDir, 'seed-database.bundle.cjs');
  writeFileSync(bundlePath, bundleCode, 'utf-8');

  // `require('electron')` renvoie le chemin absolu vers le binaire electron.exe
  // (comportement standard du paquet npm `electron`), jamais codé en dur.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const electronPath = require('electron') as unknown as string;

  const { stdout, stderr } = await execFileAsync(electronPath, [bundlePath, userDataDir], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      // Permet à `require('better-sqlite3')` de résoudre le binaire natif
      // du projet même si le bundle vit dans l'OS tmpdir, hors de toute
      // arborescence node_modules ancêtre.
      NODE_PATH: join(PROJECT_ROOT, 'node_modules')
    },
    encoding: 'utf-8',
    maxBuffer: 10 * 1024 * 1024
  });

  const markerLine = stdout
    .split(/\r?\n/)
    .reverse()
    .find((line) => line.startsWith(SEED_RESULT_MARKER));

  if (!markerLine) {
    throw new Error(
      `[E2E][seed-runner] Le script de seed n'a pas produit de résultat exploitable.\n` +
      `--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`
    );
  }

  return JSON.parse(markerLine.slice(SEED_RESULT_MARKER.length)) as SeedResult;
}
