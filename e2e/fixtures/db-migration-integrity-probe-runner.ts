/**
 * e2e/fixtures/db-migration-integrity-probe-runner.ts
 *
 * Bundle + exécute `db-migration-integrity-probe.ts` via le binaire Electron
 * en mode `ELECTRON_RUN_AS_NODE=1`, mêmes raisons ABI que `seed-runner.ts` /
 * `db-migration-probe-runner.ts`. Réservé aux specs QA terrain ponctuelles
 * (agent-13) de validation du correctif de fiabilité de migration.
 */
import { build } from 'esbuild';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

const execFileAsync = promisify(execFile);

const PROBE_RESULT_MARKER = '__E2E_INTEGRITY_PROBE_RESULT__:';
const PROJECT_ROOT = resolve(__dirname, '../..');
const PROBE_ENTRY = resolve(__dirname, 'db-migration-integrity-probe.ts');

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
    throw new Error('[E2E][db-migration-integrity-probe-runner] esbuild n\'a produit aucune sortie.');
  }
  return output;
}

async function runProbe(args: string[]): Promise<any> {
  const bundleCode = await bundleProbeScript();

  const bundleDir = mkdtempSync(join(tmpdir(), 'gest-in-situ-e2e-integrityprobebundle-'));
  const bundlePath = join(bundleDir, 'db-migration-integrity-probe.bundle.cjs');
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
      `[E2E][db-migration-integrity-probe-runner] Aucun résultat exploitable.\n` +
      `--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`
    );
  }

  return JSON.parse(markerLine.slice(PROBE_RESULT_MARKER.length));
}

export async function runCorruptV66GapsProbe(userDataDir: string): Promise<any> {
  return runProbe([userDataDir, 'corrupt_v66_gaps']);
}

export async function runInjectOrphansProbe(userDataDir: string, targetVersion: number): Promise<any> {
  return runProbe([userDataDir, 'inject_orphans', String(targetVersion)]);
}

export async function runInspectIntegrityProbe(userDataDir: string): Promise<any> {
  return runProbe([userDataDir, 'inspect']);
}
