/**
 * e2e/fixtures/db-migration-probe.ts
 *
 * Sonde dédiée à la validation du chemin d'upgrade de schéma (V60/V61 → V62),
 * utilisée UNIQUEMENT par des specs QA terrain ponctuelles (agent-13). Suit
 * exactement le même contournement ABI que `seed-database.ts` : ce fichier
 * importe `better-sqlite3` (module natif compilé pour l'ABI Electron) et ne
 * doit donc JAMAIS être importé directement par un fichier de spec Playwright
 * (Node système). Il est bundlé + exécuté via `db-migration-probe-runner.ts`
 * (même mécanisme que `seed-runner.ts` pour `seed-database.ts`).
 *
 * Deux modes, sélectionnés par argv[3] :
 *   - "downgrade" : insère des cartes de test marquées `ZZTEST_`/`E2E_`, DROP
 *     les deux index couvrants ajoutés par V61/V62 (pour prouver qu'ils sont
 *     bien RECRÉÉS par la migration réelle, pas seulement no-op via
 *     `IF NOT EXISTS`), puis force `PRAGMA user_version = <argv[4]>`.
 *   - "inspect" : lit l'état courant (user_version, présence des deux index,
 *     nombre total de cartes, nombre de cartes de test `ZZTEST_`/`E2E_`) sans
 *     rien modifier.
 *
 * N'appelle JAMAIS `runMigrations()` elle-même : le but est justement de
 * vérifier que c'est le VRAI cycle de démarrage de l'application (schema.ts
 * exécuté depuis `dist/main/index.js`) qui répare le schéma, pas ce script.
 */
import Database from 'better-sqlite3';
import { join } from 'path';

const SEED_RESULT_MARKER = '__E2E_PROBE_RESULT__:';

const TARGET_INDEXES = ['idx_cartes_created_by_created_at', 'idx_cartes_site_centre_statut'];
const TEST_CARTES_PREFIX = 'ZZTEST_';

function resolveDbPath(userDataDir: string): string {
  return join(userDataDir, 'data', 'gest_in_situ.db');
}

interface DowngradeResult {
  mode: 'downgrade';
  dbPath: string;
  cartesCountBefore: number;
  testCartesInserted: number;
  cartesCountAfterInsert: number;
  indexesExistedBeforeDrop: Record<string, boolean>;
  indexesDropped: boolean;
  userVersionBefore: number;
  userVersionForced: number;
}

interface InspectResult {
  mode: 'inspect';
  dbPath: string;
  userVersion: number;
  indexesPresent: Record<string, boolean>;
  cartesCountTotal: number;
  testCartesCount: number;
}

function runDowngrade(userDataDir: string, siteId: number, centreId: number, targetVersion: number): DowngradeResult {
  const dbPath = resolveDbPath(userDataDir);
  const db = new Database(dbPath, { timeout: 30000 });
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const userVersionBefore = db.pragma('user_version', { simple: true }) as number;

  const cartesCountBefore = (
    db.prepare('SELECT COUNT(*) AS c FROM t_cartes').get() as { c: number }
  ).c;

  const indexesExistedBeforeDrop: Record<string, boolean> = {};
  for (const idx of TARGET_INDEXES) {
    const row = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name = ?`)
      .get(idx);
    indexesExistedBeforeDrop[idx] = !!row;
  }

  // Insertion de cartes de test marquées, pour prouver l'absence de perte de
  // données au travers du cycle downgrade → relance → migration.
  const insertCarte = db.prepare(
    `INSERT INTO t_cartes (noms, prenoms, statut, site_id, centre_id, sync_id)
     VALUES (@noms, @prenoms, 'EN STOCK', @site_id, @centre_id, @sync_id)`
  );
  const now = Date.now();
  let testCartesInserted = 0;
  for (let i = 1; i <= 5; i++) {
    insertCarte.run({
      noms: `${TEST_CARTES_PREFIX}UPGRADE_${i}`,
      prenoms: `E2E_MIGRATION_PROBE`,
      site_id: siteId,
      centre_id: centreId,
      sync_id: `e2e-upgrade-probe-carte-${i}-${now}`
    });
    testCartesInserted++;
  }

  const cartesCountAfterInsert = (
    db.prepare('SELECT COUNT(*) AS c FROM t_cartes').get() as { c: number }
  ).c;

  // DROP des deux index couvrants V61/V62, pour que leur (ré)apparition après
  // relance de l'app soit une preuve directe que la migration réelle s'est
  // exécutée, et non un simple no-op sur des index déjà présents.
  for (const idx of TARGET_INDEXES) {
    db.exec(`DROP INDEX IF EXISTS ${idx}`);
  }

  db.pragma(`user_version = ${targetVersion}`);

  db.close();

  return {
    mode: 'downgrade',
    dbPath,
    cartesCountBefore,
    testCartesInserted,
    cartesCountAfterInsert,
    indexesExistedBeforeDrop,
    indexesDropped: true,
    userVersionBefore,
    userVersionForced: targetVersion
  };
}

function runInspect(userDataDir: string): InspectResult {
  const dbPath = resolveDbPath(userDataDir);
  const db = new Database(dbPath, { timeout: 30000, readonly: true });

  const userVersion = db.pragma('user_version', { simple: true }) as number;

  const indexesPresent: Record<string, boolean> = {};
  for (const idx of TARGET_INDEXES) {
    const row = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name = ?`)
      .get(idx);
    indexesPresent[idx] = !!row;
  }

  const cartesCountTotal = (
    db.prepare('SELECT COUNT(*) AS c FROM t_cartes').get() as { c: number }
  ).c;
  const testCartesCount = (
    db
      .prepare(`SELECT COUNT(*) AS c FROM t_cartes WHERE noms LIKE ?`)
      .get(`${TEST_CARTES_PREFIX}%`) as { c: number }
  ).c;

  db.close();

  return {
    mode: 'inspect',
    dbPath,
    userVersion,
    indexesPresent,
    cartesCountTotal,
    testCartesCount
  };
}

function isRunAsScript(): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return typeof require !== 'undefined' && require.main === module;
}

if (isRunAsScript()) {
  const [, , userDataDir, mode, arg3, arg4, arg5] = process.argv;
  if (!userDataDir || !mode) {
    console.error('[PROBE] Usage: db-migration-probe <userDataDir> <downgrade|inspect> [siteId centreId targetVersion]');
    process.exit(1);
  }
  try {
    let result: DowngradeResult | InspectResult;
    if (mode === 'downgrade') {
      const siteId = Number(arg3);
      const centreId = Number(arg4);
      const targetVersion = Number(arg5);
      if (!siteId || !centreId || !targetVersion) {
        console.error('[PROBE] downgrade requires siteId centreId targetVersion');
        process.exit(1);
      }
      result = runDowngrade(userDataDir, siteId, centreId, targetVersion);
    } else if (mode === 'inspect') {
      result = runInspect(userDataDir);
    } else {
      console.error(`[PROBE] Mode inconnu : ${mode}`);
      process.exit(1);
    }
    console.log(SEED_RESULT_MARKER + JSON.stringify(result));
    process.exit(0);
  } catch (err: any) {
    console.error('[PROBE] Échec :', err?.stack || err?.message || err);
    process.exit(1);
  }
}

export { SEED_RESULT_MARKER };
