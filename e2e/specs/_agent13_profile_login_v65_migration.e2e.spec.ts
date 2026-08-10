/**
 * e2e/specs/_agent13_profile_login_v65_migration.e2e.spec.ts
 *
 * QA Terrain (agent-13) — Validation du chemin de migration SCHEMA_VERSION
 * 64 → 65 (`migrateV65`, `src/main/database/schema.ts`) sur build FRAIS
 * (`dist/` régénéré via `npx electron-vite build`), qui réécrit les
 * préférences "Récupération Automatique" de `t_config` :
 *   `auto_downstream_<login>`  →  `auto_downstream_<id_user>`
 *
 * Contrairement au volet UI (`_agent13_profile_login_v65_ui.e2e.spec.ts`),
 * ce spec attaque directement `t_config` en SQL brut pour simuler un poste
 * terrain resté sur `user_version = 64` avec plusieurs préférences déjà
 * enregistrées, puis relance le VRAI cycle de démarrage de l'application
 * (`launchExistingApp`, jamais un reseed) pour prouver que c'est
 * `runMigrations()` réel — pas ce script — qui répare les données. Même
 * méthodologie que `_agent13_probe_v61v62.e2e.spec.ts` (Bloc B).
 *
 * Bloc A — Fresh install : une base neuve créée par `runMigrations()` (via
 *   le seed) doit finir directement à `user_version = 65`.
 * Bloc B — Chemin d'upgrade v64 → v65 : préférences `auto_downstream_<login>`
 *   variées (true/false) pour plusieurs utilisateurs réels, + une clé
 *   `t_config` sans rapport, + une clé orpheline (login inexistant) →
 *   vérifie la réécriture correcte, la non-altération de l'inchangé, et
 *   l'idempotence sur rejeu.
 *
 * Isolation : `userDataDir` jetables (`fs.mkdtempSync`), supprimés en fin de
 * run. Base entièrement locale (`GEST_IN_SITU_E2E_DISABLE_SYNC=1` via
 * `launchExistingApp`, comportement par défaut de la fixture) — jamais la
 * base de production, particulièrement critique ici vu l'incident récent sur
 * ce même mécanisme de migration.
 */
import { test, expect } from '@playwright/test';
import { launchExistingApp } from '../fixtures/electron-app';
import { runSeedInElectronNode } from '../fixtures/seed-runner';
import { getTestUser } from '../fixtures/test-users';
import { rmSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const DB_QUERY_MARKER = '__E2E_DBQ__:';
async function dbQuery(dbPath: string, sql: string, params: unknown[] = []): Promise<any[]> {
  const script = `
    const Database = require('better-sqlite3');
    const db = new Database(process.argv[1], { timeout: 15000 });
    db.pragma('busy_timeout = 15000');
    try {
      const sql = process.argv[2];
      const params = JSON.parse(process.argv[3]);
      let result;
      if (/^\\s*pragma\\s+/i.test(sql)) {
        // better-sqlite3 : les PRAGMA (lecture ET écriture, ex "user_version = 64")
        // doivent passer par db.pragma(), jamais prepare().all()/.run() (lève
        // "This statement does not return data" côté écriture).
        const pragmaExpr = sql.replace(/^\\s*pragma\\s+/i, '').trim();
        const pragmaResult = db.pragma(pragmaExpr);
        result = Array.isArray(pragmaResult) ? pragmaResult : [{ user_version: pragmaResult }];
      } else if (/^\\s*select/i.test(sql)) {
        result = db.prepare(sql).all(...params);
      } else {
        const info = db.prepare(sql).run(...params);
        result = [{ changes: info.changes, lastInsertRowid: info.lastInsertRowid }];
      }
      process.stdout.write(${JSON.stringify(DB_QUERY_MARKER)} + JSON.stringify(result));
    } finally {
      db.close();
    }
  `;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const electronPath = require('electron') as unknown as string;
  const { stdout, stderr } = await execFileAsync(
    electronPath,
    ['-e', script, dbPath, sql, JSON.stringify(params)],
    { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
  );
  const line = stdout.split(/\r?\n/).reverse().find((l) => l.startsWith(DB_QUERY_MARKER));
  if (!line) {
    throw new Error(`[dbQuery] Aucun résultat exploitable.\nSQL: ${sql}\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`);
  }
  return JSON.parse(line.slice(DB_QUERY_MARKER.length));
}

async function getUserVersion(dbPath: string): Promise<number> {
  const rows = await dbQuery(dbPath, 'PRAGMA user_version');
  return rows[0].user_version;
}

async function relaunchAndClose(userDataDir: string): Promise<void> {
  const { app, window } = await launchExistingApp(userDataDir);
  try {
    await window.waitForURL(/#\/login/, { timeout: 30000 });
  } finally {
    await Promise.race([
      app.close(),
      new Promise<void>((resolve) => setTimeout(resolve, 8000))
    ]).catch(() => undefined);
    try {
      const proc = app.process();
      if (proc.exitCode === null && proc.signalCode === null && proc.pid) {
        if (process.platform === 'win32') {
          await execFileAsync('taskkill', ['/PID', String(proc.pid), '/T', '/F']).catch(() => undefined);
        } else {
          proc.kill();
        }
      }
    } catch {
      // non-bloquant
    }
    await new Promise((resolve) => setTimeout(resolve, 2500));
  }
}

test.describe.serial('QA Terrain — Migration V65 : auto_downstream_<login> → auto_downstream_<id_user> (agent-13)', () => {
  let userDataDir: string;
  let dbPath: string;

  test.afterAll(async () => {
    if (userDataDir) {
      try {
        rmSync(userDataDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 500 });
      } catch (err) {
        console.warn('[agent13][V65] Échec du nettoyage du userDataDir migration :', err);
      }
    }
  });

  test('A. Base neuve : runMigrations() amène directement PRAGMA user_version = 65', async () => {
    userDataDir = mkdtempSync(join(tmpdir(), 'gest-in-situ-e2e-v65-'));
    const seed = await runSeedInElectronNode(userDataDir);
    dbPath = seed.dbPath;

    const version = await getUserVersion(dbPath);
    expect(version).toBe(65);
  });

  test('B. Simulation v64 : plusieurs préférences auto_downstream_<login> variées + clés non concernées → migration correcte à la relance réelle', async () => {
    const adminSite = getTestUser('administrateurSite');
    const operateurSaisie = getTestUser('operateurSaisie');
    const operateurVerification = getTestUser('operateurVerification');

    const idAdminSite = (await dbQuery(dbPath, 'SELECT id_user FROM t_users WHERE login = ?', [adminSite.login]))[0].id_user;
    const idOperateurSaisie = (await dbQuery(dbPath, 'SELECT id_user FROM t_users WHERE login = ?', [operateurSaisie.login]))[0].id_user;
    const idOperateurVerification = (await dbQuery(dbPath, 'SELECT id_user FROM t_users WHERE login = ?', [operateurVerification.login]))[0].id_user;

    // ── Insertion manuelle des anciennes préférences (format V64, clé <login>) ──
    await dbQuery(dbPath, "INSERT INTO t_config (key, value, updated_at) VALUES (?, 'true', datetime('now'))", [`auto_downstream_${adminSite.login}`]);
    await dbQuery(dbPath, "INSERT INTO t_config (key, value, updated_at) VALUES (?, 'false', datetime('now'))", [`auto_downstream_${operateurSaisie.login}`]);
    await dbQuery(dbPath, "INSERT INTO t_config (key, value, updated_at) VALUES (?, 'true', datetime('now'))", [`auto_downstream_${operateurVerification.login}`]);
    // Clé t_config sans rapport (ne doit jamais être touchée).
    await dbQuery(dbPath, "INSERT INTO t_config (key, value, updated_at) VALUES ('some_other_setting', 'foo', datetime('now'))");
    // Clé orpheline : suffixe ne correspondant à AUCUN login existant (ex. ancien
    // utilisateur supprimé) — ne doit jamais être migrée ni supprimée.
    await dbQuery(dbPath, "INSERT INTO t_config (key, value, updated_at) VALUES ('auto_downstream_ZZTEST_LOGIN_INEXISTANT', 'true', datetime('now'))");

    // Forcer la base à l'état "v64" (juste avant l'introduction de la migration V65).
    await dbQuery(dbPath, 'PRAGMA user_version = 64');
    const before = await getUserVersion(dbPath);
    expect(before).toBe(64);

    // ── Relance RÉELLE de l'application (dist/main/index.js) sur ce même
    //    userDataDir : c'est runMigrations() qui doit exécuter migrateV65. ──
    await relaunchAndClose(userDataDir);

    const after = await getUserVersion(dbPath);
    expect(after).toBe(65);

    const allConfigRows = await dbQuery(dbPath, 'SELECT key, value FROM t_config');
    const byKey: Record<string, string> = Object.fromEntries(allConfigRows.map((r: any) => [r.key, r.value]));

    // Anciennes clés <login> : disparues.
    expect(byKey[`auto_downstream_${adminSite.login}`]).toBeUndefined();
    expect(byKey[`auto_downstream_${operateurSaisie.login}`]).toBeUndefined();
    expect(byKey[`auto_downstream_${operateurVerification.login}`]).toBeUndefined();

    // Nouvelles clés <id_user> : présentes, valeurs préservées.
    expect(byKey[`auto_downstream_${idAdminSite}`]).toBe('true');
    expect(byKey[`auto_downstream_${idOperateurSaisie}`]).toBe('false');
    expect(byKey[`auto_downstream_${idOperateurVerification}`]).toBe('true');

    // Clé sans rapport : intacte.
    expect(byKey['some_other_setting']).toBe('foo');

    // Clé orpheline (login inexistant) : ni migrée ni supprimée, valeur intacte.
    const orphanRow = (await dbQuery(dbPath, 'SELECT value FROM t_config WHERE key = ?', ['auto_downstream_ZZTEST_LOGIN_INEXISTANT']))[0];
    expect(orphanRow.value).toBe('true');
  });

  test('C. Idempotence : rejeu de la migration sur une base déjà migrée → aucun changement, aucun doublon', async () => {
    const beforeRows = await dbQuery(dbPath, "SELECT key, value FROM t_config ORDER BY key");
    const beforeVersion = await getUserVersion(dbPath);
    expect(beforeVersion).toBe(65);

    // Deuxième relance réelle : `runMigrations()` voit déjà user_version=65,
    // donc `if (currentVersion < 65)` est faux et `migrateV65()` n'est même
    // pas invoquée — vérifie explicitement l'absence de tout effet de bord.
    await relaunchAndClose(userDataDir);

    const afterRows = await dbQuery(dbPath, "SELECT key, value FROM t_config ORDER BY key");
    const afterVersion = await getUserVersion(dbPath);
    expect(afterVersion).toBe(65);
    expect(afterRows).toEqual(beforeRows);

    // Nettoyage explicite des clés de test (traçabilité), bien que le
    // `userDataDir` entier soit de toute façon supprimé en afterAll.
    const cleanup = await dbQuery(dbPath, "DELETE FROM t_config WHERE key = 'auto_downstream_ZZTEST_LOGIN_INEXISTANT' OR key = 'some_other_setting'");
    expect(cleanup[0].changes).toBe(2);
  });
});
