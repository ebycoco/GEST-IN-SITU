/**
 * e2e/fixtures/db-migration-probe-runner.ts
 *
 * Bundle + exécute `db-migration-probe.ts` via le binaire Electron en mode
 * `ELECTRON_RUN_AS_NODE=1`, pour les mêmes raisons ABI que `seed-runner.ts`
 * (voir son commentaire d'en-tête). Réservé aux specs QA terrain ponctuelles
 * de validation du chemin d'upgrade de schéma.
 */
import { build } from 'esbuild';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

const execFileAsync = promisify(execFile);

const PROBE_RESULT_MARKER = '__E2E_PROBE_RESULT__:';
const PROJECT_ROOT = resolve(__dirname, '../..');
const PROBE_ENTRY = resolve(__dirname, 'db-migration-probe.ts');

async function bundleProbeScript(): Promise<string> {
  const result = await build({
    entryPoints: [PROBE_ENTRY],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    external: ['better-sqlite3'],
    write: false,
    logLevel: 'silent'
  });

  const output = result.outputFiles?.[0]?.text;
  if (!output) {
    throw new Error('[E2E][db-migration-probe-runner] esbuild n\'a produit aucune sortie.');
  }
  return output;
}

async function runProbe(args: string[]): Promise<any> {
  const bundleCode = await bundleProbeScript();

  const bundleDir = mkdtempSync(join(tmpdir(), 'gest-in-situ-e2e-probebundle-'));
  const bundlePath = join(bundleDir, 'db-migration-probe.bundle.cjs');
  writeFileSync(bundlePath, bundleCode, 'utf-8');

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const electronPath = require('electron') as unknown as string;

  const { stdout, stderr } = await execFileAsync(electronPath, [bundlePath, ...args], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      NODE_PATH: join(PROJECT_ROOT, 'node_modules')
    },
    encoding: 'utf-8',
    maxBuffer: 10 * 1024 * 1024
  });

  const markerLine = stdout
    .split(/\r?\n/)
    .reverse()
    .find((line) => line.startsWith(PROBE_RESULT_MARKER));

  if (!markerLine) {
    throw new Error(
      `[E2E][db-migration-probe-runner] Aucun résultat exploitable.\n` +
      `--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`
    );
  }

  return JSON.parse(markerLine.slice(PROBE_RESULT_MARKER.length));
}

export async function runDowngradeProbe(
  userDataDir: string,
  siteId: number,
  centreId: number,
  targetVersion: number
): Promise<{
  mode: 'downgrade';
  dbPath: string;
  cartesCountBefore: number;
  testCartesInserted: number;
  cartesCountAfterInsert: number;
  indexesExistedBeforeDrop: Record<string, boolean>;
  indexesDropped: boolean;
  userVersionBefore: number;
  userVersionForced: number;
}> {
  return runProbe([userDataDir, 'downgrade', String(siteId), String(centreId), String(targetVersion)]);
}

export async function runInspectProbe(userDataDir: string): Promise<{
  mode: 'inspect';
  dbPath: string;
  userVersion: number;
  indexesPresent: Record<string, boolean>;
  cartesCountTotal: number;
  testCartesCount: number;
}> {
  return runProbe([userDataDir, 'inspect']);
}
