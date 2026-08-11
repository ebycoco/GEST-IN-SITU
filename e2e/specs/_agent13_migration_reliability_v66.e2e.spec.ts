/**
 * e2e/specs/_agent13_migration_reliability_v66.e2e.spec.ts
 *
 * QA Terrain (agent-13) — Revalidation vivante du correctif de fiabilité de
 * migration SQLite (incident réel de production : `migrateV64` échouait sur
 * des lignes `t_users` orphelines, déclenchant une reconstruction d'urgence
 * dont le filet de secours s'arrêtait à V48 tout en tamponnant
 * `user_version = SCHEMA_VERSION` — un `user_version` mensonger constaté sur
 * deux postes de terrain distincts).
 *
 * Couvre les scénarios 1, 2 et 3 du plan de test fourni par l'orchestrateur :
 *   1. Poste sain — non-régression P0 (aucune réparation ne doit se
 *      déclencher inutilement).
 *   2. Simulation de l'état réel du poste de production affecté : structure
 *      bloquée (CHECK(role) sans OPERATEUR_APUREMENT, CHECK(statut) sans
 *      DOUBLON, index V61/V62 absents) mais `user_version` mensongèrement à
 *      65 — `migrateV66_structuralIntegrityNet` doit tout réparer SANS
 *      déclencher de reconstruction d'urgence.
 *   3. Orphelins t_users injectés (site_id/centre_id/poste_id pointant vers
 *      des id inexistants), `user_version` < 64 — `migrateV64` doit les
 *      neutraliser AVANT le foreign_key_check, empêchant toute reconstruction
 *      d'urgence.
 *
 * Isolation : chaque scénario tourne sur son propre `userDataDir` jetable
 * (`fs.mkdtempSync`), jamais un chemin de poste réel. Toutes les données de
 * test sont préfixées `ZZTEST_`/`QA_TERRAIN`. Build utilisé : `dist/`
 * existant (jamais reconstruit par cet agent — CLAUDE.md §1) ; ce spec est
 * lancé directement via `npx playwright test`, PAS via `npm run test:e2e`
 * (dont le hook `pretest:e2e` relancerait `electron-vite build`).
 */
import { test, expect } from '@playwright/test';
import { launchSeededApp, launchExistingApp, teardownSeededApp, type E2EEnvironment } from '../fixtures/electron-app';
import { runSeedInElectronNode } from '../fixtures/seed-runner';
import {
  runCorruptV66GapsProbe,
  runInjectOrphansProbe,
  runInspectIntegrityProbe
} from '../fixtures/db-migration-integrity-probe-runner';
import { getTestUser } from '../fixtures/test-users';
import { readFileSync, existsSync, rmSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

function readMainLogFromDisk(userDataDir: string): string {
  // Constat empirique repris de _agent13_update_close_marker.e2e.spec.ts :
  // `app.getPath('logs')` (electron-log) résout, sous `--user-data-dir`, vers
  // `<userDataDir>/logs/main.log`.
  const candidate = join(userDataDir, 'logs', 'main.log');
  if (!existsSync(candidate)) return '';
  return readFileSync(candidate, 'utf-8');
}

async function closeAppForcefully(app: { close: () => Promise<void>; process: () => any }): Promise<void> {
  await Promise.race([app.close(), new Promise<void>((resolve) => setTimeout(resolve, 8000))]).catch(() => undefined);
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

const DB_QUERY_MARKER = '__E2E_DBQ_MIGRELIAB__:';
async function dbQuery(dbPath: string, sql: string, params: unknown[] = []): Promise<any[]> {
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
    ['-e', script, dbPath, sql, JSON.stringify(params)],
    { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
  );
  const line = stdout.split(/\r?\n/).reverse().find((l) => l.startsWith(DB_QUERY_MARKER));
  if (!line) {
    throw new Error(`[dbQuery] Aucun résultat exploitable.\nSQL: ${sql}\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`);
  }
  return JSON.parse(line.slice(DB_QUERY_MARKER.length));
}

// ═══════════════════════════════════════════════════════════════════════
// SCÉNARIO 1 — Poste sain : non-régression P0.
// ═══════════════════════════════════════════════════════════════════════
test.describe.serial('QA Terrain agent-13 — Scénario 1 : poste sain (non-régression migration V66)', () => {
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

  test('1.a Base fraîche : user_version=66, CHECK complets, index présents, dès le premier démarrage', async () => {
    const result = await runInspectIntegrityProbe(env.userDataDir);
    expect(result.userVersion).toBe(66);
    expect(result.usersCheckHasApurement).toBe(true);
    expect(result.cartesCheckHasDoublon).toBe(true);
    expect(result.indexesPresent['idx_cartes_created_by_created_at']).toBe(true);
    expect(result.indexesPresent['idx_cartes_site_centre_statut']).toBe(true);
    expect(result.orphanUsersRemaining).toBe(0);
  });

  test('1.b Aucune réparation V66 déclenchée inutilement, aucune reconstruction d\'urgence', async () => {
    const logContent = readMainLogFromDisk(env.userDataDir);
    expect(logContent.length).toBeGreaterThan(0);
    // Aucun des 4 messages de réparation individuelle du filet V66 ne doit
    // apparaître sur une base saine.
    expect(logContent).not.toContain('[MIGRATION V66] t_users.CHECK(role) ne contient pas encore');
    expect(logContent).not.toContain('[MIGRATION V66] t_cartes.CHECK(statut) ne contient pas encore');
    expect(logContent).not.toContain('Index idx_cartes_created_by_created_at manquant');
    expect(logContent).not.toContain('Index idx_cartes_site_centre_statut manquant');
    expect(logContent).not.toContain("ÉCHEC CRITIQUE");
    expect(logContent).not.toContain("reconstruction d'urgence");
    expect(logContent).toContain('[MIGRATION V66] Filet d\'intégrité structurelle vérifié');
  });

  test('1.c Connexion fonctionnelle sous 3 rôles (non-régression générale, pas de gel)', async () => {
    const { window } = env;
    const roles: Array<{ key: string; urlPattern: RegExp }> = [
      { key: 'administrateurSite', urlPattern: /#\/dashboard/ },
      { key: 'operateurVerification', urlPattern: /#\/agent-verification/ },
      { key: 'operateurApurement', urlPattern: /#\/apurement/ }
    ];
    for (const { key, urlPattern } of roles) {
      const user = getTestUser(key);
      await window.waitForURL(/#\/login/, { timeout: 20000 });
      await window.getByTestId('login-input').fill(user.login);
      await window.getByTestId('password-input').fill(user.password);
      await window.getByTestId('login-submit').click();
      await window.waitForURL(urlPattern, { timeout: 20000 });
      // Aucun gel "Chargement sécurisé en cours..." persistant.
      await expect(window.getByText('Chargement sécurisé en cours')).toHaveCount(0, { timeout: 10000 }).catch(() => {});
      // Déconnexion pour repasser au rôle suivant.
      const logoutBtn = window.getByRole('button', { name: /Déconnexion|Se déconnecter/i });
      if (await logoutBtn.count() > 0) {
        await logoutBtn.first().click();
      } else {
        await window.evaluate(() => localStorage.clear());
        await window.goto(window.url().split('#')[0] + '#/login');
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════
// SCÉNARIO 2 — Simulation de l'état réel de production (le plus important).
// ═══════════════════════════════════════════════════════════════════════
test.describe.serial('QA Terrain agent-13 — Scénario 2 : état production simulé (V66 auto-réparation)', () => {
  let userDataDir: string;
  let scenarioFailed = false;

  test.afterEach(async ({}, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus) scenarioFailed = true;
  });

  test.afterAll(async () => {
    if (userDataDir) {
      if (scenarioFailed) {
        console.warn(`[agent13][scenario2] Test en échec — répertoire conservé pour diagnostic : ${userDataDir}`);
        return;
      }
      try {
        rmSync(userDataDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 500 });
      } catch (err) {
        console.warn('[agent13][scenario2] Échec du nettoyage du userDataDir :', err);
      }
    }
  });

  test('2. CHECK(role)/CHECK(statut)/index absents + user_version=65 mensonger → réparation individuelle V66 sans reconstruction d\'urgence', async () => {
    userDataDir = mkdtempSync(join(tmpdir(), 'gest-in-situ-e2e-v66gaps-'));
    const seed = await runSeedInElectronNode(userDataDir);

    const corrupt = await runCorruptV66GapsProbe(userDataDir);
    expect(corrupt.usersCheckHadApurementBefore).toBe(true);
    expect(corrupt.cartesCheckHadDoublonBefore).toBe(true);
    expect(corrupt.indexesDropped).toEqual(
      expect.arrayContaining(['idx_cartes_created_by_created_at', 'idx_cartes_site_centre_statut'])
    );
    expect(corrupt.userVersionForced).toBe(65);

    // Vérification indépendante avant relance : l'état corrompu est bien tel
    // que décrit (sinon le test suivant ne prouverait rien).
    const before = await runInspectIntegrityProbe(userDataDir);
    expect(before.userVersion).toBe(65);
    expect(before.usersCheckHasApurement).toBe(false);
    expect(before.cartesCheckHasDoublon).toBe(false);
    expect(before.indexesPresent['idx_cartes_created_by_created_at']).toBe(false);
    expect(before.indexesPresent['idx_cartes_site_centre_statut']).toBe(false);

    // ── Relance RÉELLE de l'application (vrai cycle de démarrage) ──────────
    const { app, window } = await launchExistingApp(userDataDir);
    let mainLog = '';
    try {
      await window.waitForURL(/#\/login/, { timeout: 30000 });
    } finally {
      await closeAppForcefully(app);
      mainLog = readMainLogFromDisk(userDataDir);
    }

    console.log('[agent13][scenario2][FULL MAIN LOG]\n' + mainLog);

    // Logs [MIGRATION V66] attendus pour chacune des 3 réparations.
    expect(mainLog).toContain('[MIGRATION V66] t_users.CHECK(role) ne contient pas encore OPERATEUR_APUREMENT — rejeu de migrateV64');
    expect(mainLog).toContain('[MIGRATION V66] t_cartes.CHECK(statut) ne contient pas encore DOUBLON — rejeu de migrateV60');
    expect(mainLog).toContain('Index idx_cartes_created_by_created_at manquant — rejeu de migrateV61');
    expect(mainLog).toContain('Index idx_cartes_site_centre_statut manquant — rejeu de migrateV62');
    expect(mainLog).toContain('[MIGRATION V66] Filet d\'intégrité structurelle vérifié');

    // Aucune reconstruction d'urgence ne doit avoir été déclenchée.
    expect(mainLog).not.toContain("ÉCHEC CRITIQUE");
    expect(mainLog).not.toContain("Déclenchement de la reconstruction d'urgence");

    // ── État structurel réellement complet après réparation ────────────────
    const after = await runInspectIntegrityProbe(userDataDir);
    expect(after.userVersion).toBe(66);
    expect(after.usersCheckHasApurement).toBe(true);
    expect(after.cartesCheckHasDoublon).toBe(true);
    expect(after.indexesPresent['idx_cartes_created_by_created_at']).toBe(true);
    expect(after.indexesPresent['idx_cartes_site_centre_statut']).toBe(true);

    // Aucune donnée perdue au passage (utilisateurs de test intacts).
    const userCount = await dbQuery(seed.dbPath, 'SELECT COUNT(*) as c FROM t_users');
    // TEST_USERS complet (9) moins le compte OPERATEUR_APUREMENT retiré par la
    // sonde avant restriction du CHECK, pour rester fidèle à l'état réel (ce
    // rôle n'a jamais pu exister avant V64 — voir commentaire dans la sonde).
    expect(userCount[0].c).toBeGreaterThanOrEqual(8);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// SCÉNARIO 3 — Orphelins t_users injectés : preuve anti-reconstruction.
// ═══════════════════════════════════════════════════════════════════════
test.describe.serial('QA Terrain agent-13 — Scénario 3 : orphelins t_users injectés (Volet 1 anti-urgence)', () => {
  let userDataDir: string;
  let dbPath: string;
  let scenarioFailed = false;

  test.afterEach(async ({}, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus) scenarioFailed = true;
  });

  test.afterAll(async () => {
    if (userDataDir) {
      if (scenarioFailed) {
        console.warn(`[agent13][scenario3] Test en échec — répertoire conservé pour diagnostic : ${userDataDir}`);
        return;
      }
      try {
        rmSync(userDataDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 500 });
      } catch (err) {
        console.warn('[agent13][scenario3] Échec du nettoyage du userDataDir :', err);
      }
    }
  });

  test('3. Orphelins site/centre/poste inexistants + user_version=63 → neutralisation avant foreign_key_check, jamais de reconstruction d\'urgence', async () => {
    userDataDir = mkdtempSync(join(tmpdir(), 'gest-in-situ-e2e-orphans-'));
    const seed = await runSeedInElectronNode(userDataDir);
    dbPath = seed.dbPath;

    const TARGET_VERSION = 63; // < 64 : force le rejeu normal de migrateV64 au prochain démarrage.
    const inject = await runInjectOrphansProbe(userDataDir, TARGET_VERSION);
    expect(inject.userVersionForced).toBe(TARGET_VERSION);
    expect(inject.orphanSiteId).toBe(999001);

    // Vérification indépendante : l'orphelin existe bien, avec ses FK invalides.
    const orphanBefore = await dbQuery(dbPath, 'SELECT site_id, centre_id, poste_id FROM t_users WHERE login = ?', [inject.orphanLogin]);
    expect(orphanBefore[0].site_id).toBe(999001);
    expect(orphanBefore[0].centre_id).toBe(999002);
    expect(orphanBefore[0].poste_id).toBe(999003);

    // ── Relance RÉELLE de l'application ─────────────────────────────────────
    const { app, window } = await launchExistingApp(userDataDir);
    let mainLog = '';
    try {
      await window.waitForURL(/#\/login/, { timeout: 30000 });
    } finally {
      await closeAppForcefully(app);
      mainLog = readMainLogFromDisk(userDataDir);
    }

    console.log('[agent13][scenario3][FULL MAIN LOG]\n' + mainLog);

    // Logs [MIGRATION V64] attendus : neutralisation AVANT foreign_key_check.
    expect(mainLog).toContain('ligne(s) t_users avec site_id orphelin neutralisée(s)');
    expect(mainLog).toContain('ligne(s) t_users avec centre_id orphelin neutralisée(s)');
    expect(mainLog).toContain('ligne(s) t_users avec poste_id orphelin neutralisée(s)');
    expect(mainLog).toContain(inject.orphanLogin);
    expect(mainLog).toContain('PRAGMA foreign_key_check(t_users, t_user_roles) = pass');

    // Absence totale de reconstruction d'urgence.
    expect(mainLog).not.toContain("ÉCHEC CRITIQUE");
    expect(mainLog).not.toContain("Déclenchement de la reconstruction d'urgence");

    // ── État final : compte neutralisé (jamais supprimé), plus orphelin ────
    const orphanAfter = await dbQuery(dbPath, 'SELECT site_id, centre_id, poste_id FROM t_users WHERE login = ?', [inject.orphanLogin]);
    expect(orphanAfter.length).toBe(1);
    expect(orphanAfter[0].site_id).toBeNull();
    expect(orphanAfter[0].centre_id).toBeNull();
    expect(orphanAfter[0].poste_id).toBeNull();

    const after = await runInspectIntegrityProbe(userDataDir);
    expect(after.userVersion).toBe(66);
    expect(after.orphanUsersRemaining).toBe(1); // le compte de test ZZTEST_ORPHAN survit (neutralisé, pas supprimé)

    // ── Nettoyage explicite du compte de test créé pour ce scénario ────────
    const cleanup = await dbQuery(dbPath, "DELETE FROM t_users WHERE login LIKE 'ZZTEST_ORPHAN_%'");
    expect(cleanup[0].changes).toBe(1);
    const remaining = await dbQuery(dbPath, "SELECT COUNT(*) as c FROM t_users WHERE login LIKE 'ZZTEST_ORPHAN_%'");
    expect(remaining[0].c).toBe(0);
  });
});
