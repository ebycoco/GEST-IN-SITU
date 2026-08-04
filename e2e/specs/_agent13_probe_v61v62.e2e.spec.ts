/**
 * e2e/specs/_agent13_probe_v61v62.e2e.spec.ts
 *
 * QA Terrain (agent-13) — Validation du build FRAIS (`dist/` régénéré via
 * `npm run build`, SCHEMA_VERSION=62 confirmé présent) sur deux axes :
 *
 *   Bloc A — "Fresh install" : une base neuve créée par `runMigrations()`
 *     (via le seed, qui appelle la vraie fonction de schema.ts) doit finir à
 *     `PRAGMA user_version = 62`, avec les deux index couvrants V61/V62 posés.
 *
 *   Bloc B — "Chemin d'upgrade" (non couvert par un run précédent, bloqué par
 *     un `dist/` alors périmé) : une base seedée est forcée à
 *     `PRAGMA user_version = 60` (simulant un poste terrain resté sur un
 *     ancien build), altérée pour retirer les deux index V61/V62, puis
 *     relancée sur ce MÊME `userDataDir` via le VRAI cycle de démarrage de
 *     l'application (`launchExistingApp`, aucun reseed). On vérifie que
 *     `runMigrations()` répare bien tout ça à la volée (index recréés,
 *     `user_version` → 62) et qu'aucune carte n'a été perdue au passage.
 *
 *   Bloc C — Test de fumée KPI Dashboard sur ce même build frais.
 *
 * Toutes les cartes créées pour ces scénarios sont préfixées `ZZTEST_` (voir
 * `e2e/fixtures/db-migration-probe.ts` et `NOMS_PREFIX` ci-dessous) et
 * supprimées en fin de run avec re-vérification. Les `userDataDir` sont des
 * répertoires temporaires jetables (`fs.mkdtempSync`), supprimés par
 * `teardownSeededApp`/nettoyage explicite — aucune base de production n'est
 * touchée (voir `e2e/fixtures/electron-app.ts` pour le détail de l'isolation
 * `--user-data-dir`).
 */
import { test, expect } from '@playwright/test';
import {
  launchSeededApp,
  launchExistingApp,
  teardownSeededApp,
  type E2EEnvironment
} from '../fixtures/electron-app';
import { runSeedInElectronNode } from '../fixtures/seed-runner';
import { runDowngradeProbe, runInspectProbe } from '../fixtures/db-migration-probe-runner';
import { getTestUser } from '../fixtures/test-users';
import { rmSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const NOMS_PREFIX = 'ZZTEST_KPI_SMOKE';

// ═══════════════════════════════════════════════════════════════════════
// BLOC A + C : instance unique — fresh install v62, puis smoke-test KPI.
// ═══════════════════════════════════════════════════════════════════════
test.describe.serial('QA Terrain — Migrations V61/V62 build frais : fresh install + KPI (agent-13)', () => {
  let env: E2EEnvironment;
  let anyTestFailed = false;

  test.beforeAll(async () => {
    env = await launchSeededApp();
  });

  test.afterAll(async () => {
    if (env) {
      await teardownSeededApp(env, anyTestFailed);
    }
  });

  test.afterEach(async ({}, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus) {
      anyTestFailed = true;
    }
  });

  const DB_QUERY_MARKER = '__E2E_DBQ__:';
  async function dbQuery(sql: string, params: unknown[] = []): Promise<any[]> {
    const script = `
      const Database = require('better-sqlite3');
      const db = new Database(process.argv[1], { timeout: 15000 });
      db.pragma('busy_timeout = 15000');
      try {
        const sql = process.argv[2];
        const params = JSON.parse(process.argv[3]);
        const stmt = db.prepare(sql);
        let result;
        if (/^\\s*select/i.test(sql)) {
          result = stmt.all(...params);
        } else {
          const info = stmt.run(...params);
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
      ['-e', script, env.seed.dbPath, sql, JSON.stringify(params)],
      { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
    );
    const line = stdout.split(/\r?\n/).reverse().find((l) => l.startsWith(DB_QUERY_MARKER));
    if (!line) {
      throw new Error(`[dbQuery] Aucun résultat exploitable.\nSQL: ${sql}\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`);
    }
    return JSON.parse(line.slice(DB_QUERY_MARKER.length));
  }

  async function readAdminTotalCartes(): Promise<number> {
    const { window } = env;
    const label = window.locator('.kpi-label-muted', { hasText: 'Total Cartes' });
    await expect(label).toBeVisible({ timeout: 30000 });
    const parent = label.locator('xpath=..');
    const value = parent.locator('.kpi-value-lg');
    const text = (await value.textContent()) || '';
    return Number(text.replace(/[^\d]/g, ''));
  }

  test('A. Fresh install : PRAGMA user_version = 62 dès le premier démarrage', async () => {
    const result = await runInspectProbe(env.userDataDir);
    expect(result.userVersion).toBe(62);
    expect(result.indexesPresent['idx_cartes_created_by_created_at']).toBe(true);
    expect(result.indexesPresent['idx_cartes_site_centre_statut']).toBe(true);
  });

  test('C. Smoke test KPI Dashboard cohérent avec ce build frais', async () => {
    const { window } = env;
    const user = getTestUser('administrateurSite');
    await window.waitForURL(/#\/login/, { timeout: 20000 });
    await window.getByTestId('login-input').fill(user.login);
    await window.getByTestId('password-input').fill(user.password);
    await window.getByTestId('login-submit').click();
    await window.waitForURL(/#\/dashboard/, { timeout: 20000 });

    const totalBefore = await readAdminTotalCartes();

    const N = 3;
    const rowsSql: string[] = [];
    const params: unknown[] = [];
    for (let i = 1; i <= N; i++) {
      rowsSql.push('(?,?,?,?,?,?,?)');
      params.push(
        `${NOMS_PREFIX}_${i}`,
        'AGENT13',
        'EN STOCK',
        env.seed.siteId,
        env.seed.centreId,
        `zztest-kpismoke-${Date.now()}-${i}`,
        0
      );
    }
    await dbQuery(
      `INSERT INTO t_cartes (noms, prenoms, statut, site_id, centre_id, sync_id, is_dirty) VALUES ${rowsSql.join(',')}`,
      params
    );

    // NB : `window.reload()` (F5) casse l'état d'authentification côté
    // renderer (store en mémoire non re-hydraté) sans que l'utilisateur réel
    // ne fasse jamais ça sur le terrain — on utilise le vrai bouton
    // "Actualiser" du dashboard (même pattern que
    // dashboard-cache-cross-user-repro.e2e.spec.ts:211) pour rafraîchir les
    // KPI sans quitter la session.
    //
    // ── Découverte en cours de run (agent-13) ────────────────────────────
    // `src/main/ipc/handlers.ts` memoize `stats:get` avec un TTL de 15s
    // (clé `${siteId}_${centreId}`, voir commentaire "CACHE MEMOIZATION POUR
    // stats:get"). Un premier clic "Actualiser" DANS cette fenêtre de 15s
    // depuis le dernier appel sert donc volontairement la réponse en cache
    // (pré-insertion), PUIS un second clic après expiration du TTL doit
    // refléter les 3 cartes insérées. On vérifie explicitement les deux
    // phases pour caractériser precisement le comportement (bug potentiel
    // côté terrain : un agent qui clique "Actualiser" moins de 15s après un
    // chargement précédent du dashboard ne voit AUCUN changement, même réel).
    await window.getByRole('button', { name: /Actualiser/ }).click();
    const totalImmediatelyAfterClick = await readAdminTotalCartes();

    await window.waitForTimeout(16000);
    await window.getByRole('button', { name: /Actualiser/ }).click();
    const totalAfter = await readAdminTotalCartes();

    await window.screenshot({
      path: join(
        'C:\\Users\\EBYCHOCO\\AppData\\Local\\Temp\\claude\\d--Espace-travail-GEST-IN-SITU-CARTE-ABOBO-V2\\344cf3c3-4173-4a2a-bbd7-a341c1d208bf\\scratchpad',
        'agent13-kpi-dashboard-build-frais.png'
      )
    });

    console.log(
      `[agent13][KPI-CACHE] totalBefore=${totalBefore} totalImmediatelyAfterClick(<15s)=${totalImmediatelyAfterClick} totalAfter(>15s TTL)=${totalAfter} (attendu ${totalBefore + N})`
    );
    expect(totalAfter).toBe(totalBefore + N);

    // ── Nettoyage immédiat des cartes de test KPI ──────────────────────────
    const delResult = await dbQuery(`DELETE FROM t_cartes WHERE noms LIKE ?`, [`${NOMS_PREFIX}_%`]);
    expect(delResult[0].changes).toBe(N);
    const remaining = await dbQuery(`SELECT COUNT(*) as c FROM t_cartes WHERE noms LIKE ?`, [`${NOMS_PREFIX}_%`]);
    expect(remaining[0].c).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// BLOC B : chemin d'upgrade v60 → v62 sur une instance dédiée.
// ═══════════════════════════════════════════════════════════════════════
test.describe.serial('QA Terrain — Migrations V61/V62 build frais : chemin upgrade v60→v62 (agent-13)', () => {
  let userDataDir: string;
  let dbPath: string;

  test.afterAll(async () => {
    if (userDataDir) {
      try {
        rmSync(userDataDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 500 });
      } catch (err) {
        console.warn('[agent13] Échec du nettoyage du userDataDir upgrade :', err);
      }
    }
  });

  test('B. Downgrade forcé v60 + cartes de test, puis relance réelle → migration V61+V62 appliquée sans perte de données', async () => {
    // ── Étape 1 : seed d'une base neuve (schéma réel le plus récent = v62) ──
    userDataDir = mkdtempSync(join(tmpdir(), 'gest-in-situ-e2e-upgrade-'));
    const seed = await runSeedInElectronNode(userDataDir);
    dbPath = seed.dbPath;

    // ── Étape 2 : downgrade forcé — insère 5 cartes ZZTEST_, DROP les 2 index
    //    V61/V62, force PRAGMA user_version = 60 (simule un poste resté sur
    //    un ancien build, jamais relancé depuis l'introduction de V61/V62).
    const TARGET_VERSION = 60;
    const downgrade = await runDowngradeProbe(userDataDir, seed.siteId, seed.centreId, TARGET_VERSION);

    // Le seed vient d'exécuter la VRAIE runMigrations() (schema.ts) sur une
    // base neuve : elle était donc déjà à jour (v62) avec les 2 index posés,
    // AVANT qu'on ne force le downgrade — sinon le test suivant ne prouverait
    // rien (un index absent au départ pourrait réapparaître pour n'importe
    // quelle raison).
    expect(downgrade.userVersionBefore).toBe(62);
    expect(downgrade.indexesExistedBeforeDrop['idx_cartes_created_by_created_at']).toBe(true);
    expect(downgrade.indexesExistedBeforeDrop['idx_cartes_site_centre_statut']).toBe(true);
    expect(downgrade.cartesCountBefore).toBe(0);
    expect(downgrade.testCartesInserted).toBe(5);
    expect(downgrade.cartesCountAfterInsert).toBe(5);
    expect(downgrade.userVersionForced).toBe(TARGET_VERSION);

    // ── Étape 3 : relance RÉELLE de l'application sur ce même userDataDir
    //    (aucun reseed) — c'est le VRAI cycle de démarrage (dist/main/index.js
    //    → initDatabase() → runMigrations()) qui doit réparer le schéma.
    const { app, window } = await launchExistingApp(userDataDir);
    try {
      await window.waitForURL(/#\/login/, { timeout: 30000 });
      await window.screenshot({
        path: join(
          'C:\\Users\\EBYCHOCO\\AppData\\Local\\Temp\\claude\\d--Espace-travail-GEST-IN-SITU-CARTE-ABOBO-V2\\344cf3c3-4173-4a2a-bbd7-a341c1d208bf\\scratchpad',
          'agent13-upgrade-v60-to-v62-login-apres-migration.png'
        )
      });
    } finally {
      // Fermeture propre avant inspection SQLite directe (libère tout verrou
      // WAL/SHM tenu par le process principal de l'app).
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

    // ── Étape 4 : inspection post-migration ─────────────────────────────
    const after = await runInspectProbe(userDataDir);
    expect(after.userVersion).toBe(62);
    expect(after.indexesPresent['idx_cartes_created_by_created_at']).toBe(true);
    expect(after.indexesPresent['idx_cartes_site_centre_statut']).toBe(true);
    // Aucune perte de données : les 5 cartes ZZTEST_ insérées avant le
    // downgrade sont toujours là après le cycle downgrade → relance → migration.
    expect(after.cartesCountTotal).toBe(5);
    expect(after.testCartesCount).toBe(5);

    // ── Nettoyage des cartes de test (traçabilité explicite, même si le
    //    userDataDir entier est de toute façon supprimé en afterAll) ──────
    const cleanupScript = `
      const Database = require('better-sqlite3');
      const db = new Database(process.argv[1], { timeout: 15000 });
      try {
        const info = db.prepare("DELETE FROM t_cartes WHERE noms LIKE 'ZZTEST_%'").run();
        const remaining = db.prepare("SELECT COUNT(*) as c FROM t_cartes WHERE noms LIKE 'ZZTEST_%'").get();
        process.stdout.write('__E2E_CLEANUP__:' + JSON.stringify({ changes: info.changes, remaining: remaining.c }));
      } finally {
        db.close();
      }
    `;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electronPath = require('electron') as unknown as string;
    const { stdout } = await execFileAsync(electronPath, ['-e', cleanupScript, dbPath], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      encoding: 'utf-8'
    });
    const cleanupLine = stdout.split(/\r?\n/).reverse().find((l) => l.startsWith('__E2E_CLEANUP__:'));
    const cleanupResult = cleanupLine ? JSON.parse(cleanupLine.slice('__E2E_CLEANUP__:'.length)) : null;
    expect(cleanupResult?.changes).toBe(5);
    expect(cleanupResult?.remaining).toBe(0);
  });
});
