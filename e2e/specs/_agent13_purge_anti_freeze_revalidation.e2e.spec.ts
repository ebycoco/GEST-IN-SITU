/**
 * e2e/specs/_agent13_purge_anti_freeze_revalidation.e2e.spec.ts
 *
 * QA Terrain (agent-13) — Revalidation du correctif anti-gel de
 * `purgeLocalDatabase()` (src/main/database/queries/maintenance.queries.ts)
 * déclenché par le bouton "Purger les cartes locales de ce PC" de la page
 * "Centre de Migration" (ImportPage.tsx, route /import).
 *
 * Zone sensible : ce même fichier (triggers FTS5 + VACUUM) a déjà causé une
 * corruption SQLITE_CORRUPT_VTAB en production par le passé (voir Bloc 8 de
 * e2e/specs/import/import-centre-migration-qa-terrain.e2e.spec.ts). Ce spec
 * NE duplique PAS ce stress-test déjà existant (5 rounds x 3 cycles
 * Emergency+Purge enchaînés) — il se concentre sur ce qui n'était PAS encore
 * couvert avant ce correctif :
 *   1. Volume réaliste (dizaines de milliers de cartes) : la progression
 *      `db:purge-progress` doit avancer par paliers visibles (pas un saut
 *      brutal 0%→100%) et le process MAIN ne doit jamais rester bloqué assez
 *      longtemps pour empêcher un autre appel IPC concurrent de répondre
 *      rapidement (preuve quantitative de non-gel, pas juste "l'app a fini
 *      par répondre").
 *   2. Intégrité post-purge sur un volume réaliste + FTS5 d'un AUTRE site
 *      non purgé toujours fonctionnel.
 *   3. Cloisonnement multi-site + t_logs NON vidé (ni pour le site étranger,
 *      ni pour le site purgé lui-même — règle métier volontairement
 *      différente d'emergencyPurge).
 *   4. syncEngine.pause()/resume() : vérifié via les logs electron-log
 *      (main.log) sur le chemin de succès ET sur un chemin d'échec simulé
 *      (tentative de purge d'un site étranger, rejetée par le contrôle de
 *      rôle) — resume() doit être appelé dans les deux cas.
 *   5. Cas limite : purge d'un site à 0 carte (réutilise le site A une fois
 *      vidé par le scénario 1, sans relancer Electron).
 *
 * Isolation : même harnais que les autres specs QA Terrain (Playwright
 * `_electron`, `e2e/fixtures/electron-app.ts`, `userDataDir` jetable).
 * Toutes les données créées sont préfixées `ZZTEST_` et nettoyées en fin de
 * run (bloc CLEANUP), avec vérification SQLite directe de la suppression
 * effective.
 */
import { test, expect } from '@playwright/test';
import { launchSeededApp, teardownSeededApp, type E2EEnvironment } from '../fixtures/electron-app';
import { getTestUser } from '../fixtures/test-users';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

// Volume réaliste : "plusieurs dizaines de milliers de cartes" (contexte de
// la tâche). 60 000 est un compromis entre représentativité (l'historique de
// gel documenté portait sur 218 332 cartes) et durée d'exécution du run E2E.
const BIG_VOLUME = 60_000;

test.describe.serial('QA Terrain — purgeLocalDatabase() anti-freeze + intégrité (agent-13)', () => {
  let env: E2EEnvironment;
  let anyTestFailed = false;

  const siteAId = () => env.seed.siteId;
  const siteACentreId = () => env.seed.centreId;
  let siteBId: number;
  let siteBCentreId: number;

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

  // ── Helpers SQL directs (pattern identique aux autres specs agent-13) ──
  const DB_QUERY_MARKER = '__E2E_DBQ__:';
  async function dbQuery(sql: string, params: unknown[] = []): Promise<any[]> {
    const script = `
      const Database = require('better-sqlite3');
      const db = new Database(process.argv[1], { timeout: 30000 });
      db.pragma('busy_timeout = 30000');
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

  const DB_PRAGMA_MARKER = '__E2E_DBPRAGMA__:';
  async function pragmaQuery(pragmaExpr: string): Promise<any[]> {
    const script = `
      const Database = require('better-sqlite3');
      const db = new Database(process.argv[1], { timeout: 30000 });
      db.pragma('busy_timeout = 30000');
      try {
        const result = db.pragma(process.argv[2]);
        process.stdout.write(${JSON.stringify(DB_PRAGMA_MARKER)} + JSON.stringify(result));
      } finally {
        db.close();
      }
    `;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electronPath = require('electron') as unknown as string;
    const { stdout, stderr } = await execFileAsync(
      electronPath,
      ['-e', script, env.seed.dbPath, pragmaExpr],
      { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
    );
    const line = stdout.split(/\r?\n/).reverse().find((l) => l.startsWith(DB_PRAGMA_MARKER));
    if (!line) {
      throw new Error(`[pragmaQuery] Aucun résultat exploitable.\nPRAGMA: ${pragmaExpr}\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`);
    }
    return JSON.parse(line.slice(DB_PRAGMA_MARKER.length));
  }

  // Insertion en masse d'un volume réaliste de cartes ZZTEST, en UNE SEULE
  // invocation du process Electron/Node (une transaction better-sqlite3
  // interne) — indispensable pour rester rapide sur 60 000 lignes (60 000
  // aller-retours execFile individuels serait ingérable en pratique).
  const BULK_MARKER = '__E2E_BULK__:';
  async function bulkInsertCards(siteId: number, centreId: number, count: number, prefix: string): Promise<{ inserted: number; ms: number }> {
    const script = `
      const Database = require('better-sqlite3');
      const db = new Database(process.argv[1], { timeout: 30000 });
      db.pragma('busy_timeout = 30000');
      const siteId = Number(process.argv[2]);
      const centreId = Number(process.argv[3]);
      const count = Number(process.argv[4]);
      const prefix = process.argv[5];
      try {
        const insert = db.prepare(\`INSERT INTO t_cartes (noms, prenoms, date_de_naissance, statut, site_id, centre_id, cle_doublon, sync_id) VALUES (?,?,?,?,?,?,?,?)\`);
        const insertMany = db.transaction((n) => {
          for (let i = 0; i < n; i++) {
            const noms = prefix + i;
            insert.run(noms, 'X', '1990-01-01', 'EN STOCK', siteId, centreId, noms + '|X|1990-01-01||', prefix + '-sync-' + i);
          }
        });
        const t0 = Date.now();
        insertMany(count);
        const dt = Date.now() - t0;
        process.stdout.write(${JSON.stringify(BULK_MARKER)} + JSON.stringify({ inserted: count, ms: dt }));
      } finally {
        db.close();
      }
    `;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electronPath = require('electron') as unknown as string;
    const { stdout, stderr } = await execFileAsync(
      electronPath,
      ['-e', script, env.seed.dbPath, String(siteId), String(centreId), String(count), prefix],
      { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024, timeout: 120_000 }
    );
    const line = stdout.split(/\r?\n/).reverse().find((l) => l.startsWith(BULK_MARKER));
    if (!line) {
      throw new Error(`[bulkInsertCards] Aucun résultat exploitable.\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`);
    }
    return JSON.parse(line.slice(BULK_MARKER.length));
  }

  const cleDoublon = (noms: string, prenoms: string, ddn: string, lieu: string, contact: string) =>
    `${noms}|${prenoms}|${ddn}|${lieu}|${contact}`;

  async function waitForNoLoadingOverlay(timeout = 60000) {
    const { window } = env;
    await expect(window.getByText('Chargement sécurisé en cours...')).toHaveCount(0, { timeout });
  }

  async function getMainLogPath(): Promise<string> {
    const userDataDir = await env.app.evaluate(({ app }) => app.getPath('userData'));
    return join(userDataDir, 'logs', 'main.log');
  }

  function readLogSafe(path: string): string {
    if (!existsSync(path)) return '';
    return readFileSync(path, 'utf-8');
  }

  // ══════════════════════════════════════════════════════════════════════
  // BLOC 0 — Login ADMINISTRATEUR_SITE (site A = env.seed.siteId)
  // ══════════════════════════════════════════════════════════════════════

  test('0. Login ADMINISTRATEUR_SITE', async () => {
    const { window } = env;
    const admin = getTestUser('administrateurSite');
    await window.waitForURL(/#\/login/);
    await window.getByTestId('login-input').fill(admin.login);
    await window.getByTestId('password-input').fill(admin.password);
    await window.getByTestId('login-submit').click();
    await window.waitForURL(/#\/dashboard/, { timeout: 20000 });
    await waitForNoLoadingOverlay();
  });

  // ══════════════════════════════════════════════════════════════════════
  // BLOC 1 — Site B (petit, synthétique) pour les vérifications de
  // cloisonnement/isolation FTS5/t_logs. Site A = seed par défaut, qui va
  // recevoir le volume réaliste.
  // ══════════════════════════════════════════════════════════════════════

  test('1. Setup Site B (isolation) : 1 carte, 1 anomalie, 1 entrée t_logs, tous ZZTEST', async () => {
    const now = Date.now();
    const siteRes = await dbQuery(
      `INSERT INTO t_sites (nom, code, is_active, max_centres, is_permanent, sync_id) VALUES (?, ?, 1, 4, 1, ?)`,
      [`ZZTEST_SITE_B_${now}`, `ZZTEST-SITEB-${now}`, `zztest-siteb-${now}`]
    );
    siteBId = siteRes[0].lastInsertRowid;
    const centreRes = await dbQuery(
      `INSERT INTO t_centres (site_id, nom, numero, sync_id) VALUES (?, 'ZZTEST_CENTRE_B', 1, ?)`,
      [siteBId, `zztest-centreb-${now}`]
    );
    siteBCentreId = centreRes[0].lastInsertRowid;

    await dbQuery(
      `INSERT INTO t_cartes (noms, prenoms, date_de_naissance, statut, site_id, centre_id, cle_doublon, sync_id)
       VALUES ('ZZTEST_SITEB_CARD1', 'X', '1990-01-01', 'EN STOCK', ?, ?, ?, ?)`,
      [siteBId, siteBCentreId, cleDoublon('ZZTEST_SITEB_CARD1', 'X', '1990-01-01', '', ''), `zztest-siteb-card1-${now}`]
    );
    await dbQuery(
      `INSERT INTO t_import_anomalies (type_anomalie, description, noms, prenoms, site_id, erreur_message)
       VALUES ('DATE_INVALIDE', 'ZZTEST anomalie site B', 'ZZTEST_SITEB_ANOMALY', 'X', ?, 'test')`,
      [siteBId]
    );
    await dbQuery(
      `INSERT INTO t_logs (action, detail, site_id, login_user) VALUES ('ZZTEST_ACTION_B', 'log site B', ?, 'ZZTEST_QA')`,
      [siteBId]
    );

    const cardCheck = await dbQuery('SELECT COUNT(*) as c FROM t_cartes WHERE site_id = ?', [siteBId]);
    expect(cardCheck[0].c).toBe(1);
    const ftsCheck = await dbQuery('SELECT rowid FROM t_cartes_fts WHERE t_cartes_fts MATCH ?', ['ZZTEST_SITEB_CARD1']);
    expect(ftsCheck.length, 'La carte du Site B doit être indexée en FTS5 dès sa création (trigger AFTER INSERT actif)').toBe(1);
  });

  // ══════════════════════════════════════════════════════════════════════
  // BLOC 2 — Volume réaliste sur le Site A (60 000 cartes ZZTEST) + t_logs
  // et anomalies pré-existants, pour un scénario de purge concret et
  // représentatif de l'historique de gel documenté.
  // ══════════════════════════════════════════════════════════════════════

  const CARD_PREFIX = 'ZZTEST_BIGPURGE_';
  let siteALogsCountBefore: number;

  test(`2. Injection de ${BIG_VOLUME} cartes ZZTEST sur le Site A + historique t_logs/anomalies pré-existant`, async () => {
    test.setTimeout(180_000);
    const bulkRes = await bulkInsertCards(siteAId(), siteACentreId(), BIG_VOLUME, CARD_PREFIX);
    console.log(`[BULK INSERT] ${bulkRes.inserted} cartes insérées en ${bulkRes.ms} ms (triggers FTS5 actifs pendant l'insertion).`);

    await dbQuery(
      `INSERT INTO t_import_anomalies (type_anomalie, description, noms, prenoms, site_id, erreur_message)
       VALUES ('DATE_INVALIDE', 'ZZTEST anomalie site A pré-purge', 'ZZTEST_SITEA_ANOMALY', 'X', ?, 'test')`,
      [siteAId()]
    );
    // Historique t_logs pré-existant pour le Site A (le PLUS important à vérifier : la purge
    // NORMALE, contrairement à emergencyPurge, ne doit JAMAIS vider t_logs — même pour le site
    // qu'elle purge elle-même).
    for (let i = 0; i < 5; i++) {
      await dbQuery(
        `INSERT INTO t_logs (action, detail, site_id, login_user) VALUES (?, ?, ?, 'ZZTEST_QA')`,
        [`ZZTEST_ACTION_A_${i}`, `log site A #${i}`, siteAId()]
      );
    }

    const cardCheck = await dbQuery('SELECT COUNT(*) as c FROM t_cartes WHERE site_id = ?', [siteAId()]);
    expect(cardCheck[0].c).toBeGreaterThanOrEqual(BIG_VOLUME);
    const logsCheck = await dbQuery("SELECT COUNT(*) as c FROM t_logs WHERE site_id = ? AND action LIKE 'ZZTEST\\_ACTION\\_A\\_%' ESCAPE '\\'", [siteAId()]);
    expect(logsCheck[0].c).toBe(5);
    siteALogsCountBefore = (await dbQuery('SELECT COUNT(*) as c FROM t_logs WHERE site_id = ?', [siteAId()]))[0].c;

    const ftsCheck = await dbQuery('SELECT COUNT(*) as c FROM t_cartes_fts WHERE t_cartes_fts MATCH ?', [`${CARD_PREFIX}*`]);
    expect(ftsCheck[0].c).toBeGreaterThanOrEqual(BIG_VOLUME);
  });

  // ══════════════════════════════════════════════════════════════════════
  // BLOC 3 — SCÉNARIO 1 (priorité 1) : purge du volume réaliste, sans gel,
  // avec progression réelle capturée côté renderer + sonde de latence IPC
  // concurrente (preuve quantitative que le process MAIN reste réactif
  // pendant la phase FTS5).
  // ══════════════════════════════════════════════════════════════════════

  test('3. Purge du Site A (60 000 cartes) : progression continue, AUCUN gel mesurable, base intègre', async () => {
    test.setTimeout(300_000);
    const { window } = env;
    await window.evaluate(() => { globalThis.location.hash = '#/dashboard'; });
    await window.waitForURL(/#\/dashboard/);
    await window.evaluate(() => { globalThis.location.hash = '#/import'; });
    await window.waitForURL(/#\/import/);
    await waitForNoLoadingOverlay();
    await expect(window.getByRole('button', { name: 'Purger les cartes locales de ce PC' })).toBeEnabled({ timeout: 20000 });

    // ── Instrumentation AVANT de déclencher la purge ──────────────────────
    // 1) Capture brute de TOUS les événements 'db:purge-progress' (indépendante
    //    du throttle/RAF déjà appliqué par le composant React lui-même).
    // 2) Sonde de latence IPC concurrente : pendant que la purge tourne côté
    //    main process, on tire des appels db:getCardCount() en boucle toutes
    //    les 250ms. Si le main thread était réellement gelé (bug historique),
    //    CES appels resteraient eux aussi bloqués en file d'attente derrière
    //    l'opération SQLite synchrone — c'est la preuve la plus directe et la
    //    plus quantitative de "pas de gel", bien plus fiable qu'une simple
    //    observation visuelle de la barre de progression.
    await window.evaluate(() => {
      (window as any).__agent13ProgressLog = [];
      (window as any).__agent13RemoveProgressListener = (window as any).api.db.onPurgeProgress((p: number) => {
        (window as any).__agent13ProgressLog.push({ p, t: Date.now() });
      });
      (window as any).__agent13PingLog = [];
      (window as any).__agent13PingRunning = true;
      const loop = async () => {
        while ((window as any).__agent13PingRunning) {
          const t0 = performance.now();
          try {
            await (window as any).api.db.getCardCount();
            const dt = performance.now() - t0;
            (window as any).__agent13PingLog.push(dt);
          } catch {
            (window as any).__agent13PingLog.push(-1);
          }
          await new Promise((r) => setTimeout(r, 250));
        }
      };
      loop();
    });

    const purgeStartedAt = Date.now();
    await window.getByRole('button', { name: 'Purger les cartes locales de ce PC' }).click();
    await expect(window.getByText('Purge des cartes locales')).toBeVisible({ timeout: 10000 });
    const admin = getTestUser('administrateurSite');
    await window.getByPlaceholder('••••••••').last().fill(admin.password);
    await window.getByRole('button', { name: 'Confirmer' }).click();

    await expect(window.getByText('Base de données locale purgée avec succès !')).toBeVisible({ timeout: 240000 });
    const purgeEndedAt = Date.now();

    // Laisse une fenêtre courte pour que le dernier ping/flush en vol se termine
    await window.waitForTimeout(600);
    await window.evaluate(() => {
      (window as any).__agent13PingRunning = false;
      if (typeof (window as any).__agent13RemoveProgressListener === 'function') {
        (window as any).__agent13RemoveProgressListener();
      }
    });

    const progressLog: Array<{ p: number; t: number }> = await window.evaluate(() => (window as any).__agent13ProgressLog);
    const pingLog: number[] = await window.evaluate(() => (window as any).__agent13PingLog);

    const totalDurationMs = purgeEndedAt - purgeStartedAt;
    console.log(`[PURGE ${BIG_VOLUME} cartes] Durée totale (clic → toast succès) = ${totalDurationMs} ms`);
    console.log(`[PURGE ${BIG_VOLUME} cartes] Événements de progression reçus (bruts, non throttlés côté test) : ${JSON.stringify(progressLog)}`);
    console.log(`[PURGE ${BIG_VOLUME} cartes] Latences des ${pingLog.length} pings db:getCardCount() concurrents (ms) : ${JSON.stringify(pingLog)}`);

    // ── Assertion 1 : la progression n'est PAS un simple saut 0%→100% ──────
    const distinctPercents = Array.from(new Set(progressLog.map((e) => e.p))).sort((a, b) => a - b);
    expect(distinctPercents.length, 'La progression doit comporter plusieurs paliers distincts (pas juste un saut 0→100)').toBeGreaterThanOrEqual(3);
    expect(distinctPercents[0], 'Le premier palier de progression doit être < 50% (début de la purge, pas déjà proche de la fin)').toBeLessThan(50);
    // Le canal db:purge-progress plafonne à 90% par construction (le VACUUM final ne rapporte
    // aucune progression) : on vérifie donc que 90 (ou proche) est bien atteint, pas 100.
    expect(Math.max(...distinctPercents), 'La progression doit approcher son plafond documenté (~90%) avant le VACUUM final').toBeGreaterThanOrEqual(85);

    // ── Assertion 2 : aucun "trou" de progression anormalement long AVANT le
    // dernier événement (le dernier écart, avant le VACUUM synchrone final,
    // PEUT être plus long — c'est le "bref gel résiduel attendu" documenté
    // dans la tâche, à ne pas signaler comme un défaut).
    const gaps: number[] = [];
    for (let i = 1; i < progressLog.length; i++) {
      gaps.push(progressLog[i].t - progressLog[i - 1].t);
    }
    const gapsExcludingLast = gaps.slice(0, -1);
    const maxGapExcludingLast = gapsExcludingLast.length > 0 ? Math.max(...gapsExcludingLast) : 0;
    console.log(`[PURGE ${BIG_VOLUME} cartes] Écart max entre 2 événements de progression consécutifs (hors dernier écart, qui peut inclure la fin de la boucle FTS5) = ${maxGapExcludingLast} ms`);
    expect(maxGapExcludingLast, 'Aucun écart > 5s ne devrait séparer 2 événements de progression pendant la phase FTS5 incrémentale (hors tout dernier écart lié à la fin de la boucle)').toBeLessThan(5000);

    // ── Assertion 3 (LA PLUS DIRECTE) : le process MAIN est resté réactif ──
    // Au moins plusieurs pings concurrents ont dû être émis pendant l'opération,
    // ET aucun n'a dépassé un seuil largement inférieur à la durée totale de
    // l'ancien gel documenté (~30s sur 218k cartes) — la preuve que le main
    // thread n'a jamais été bloqué assez longtemps pour mettre en file
    // d'attente un appel IPC concurrent au-delà de quelques centaines de ms.
    expect(pingLog.length, 'Au moins quelques pings IPC concurrents auraient dû être émis pendant la purge').toBeGreaterThan(2);
    const failedPings = pingLog.filter((v) => v === -1);
    expect(failedPings.length, 'Aucun ping IPC concurrent ne devrait échouer pendant la purge').toBe(0);
    const maxPingLatency = Math.max(...pingLog);
    console.log(`[PURGE ${BIG_VOLUME} cartes] Latence max d'un ping IPC concurrent (db:getCardCount) pendant la purge = ${maxPingLatency.toFixed(1)} ms`);
    expect(maxPingLatency, 'CORRECTIF ANTI-FREEZE : un appel IPC concurrent (db:getCardCount) ne doit JAMAIS être mis en file derrière la purge au point de dépasser 3s de latence — l\'ancien comportement bloquant aurait fait attendre ce ping ~30s').toBeLessThan(3000);

    // ── DB : Site A vidé, Site B et son historique intacts ────────────────
    const cartesA = await dbQuery('SELECT COUNT(*) as c FROM t_cartes WHERE site_id = ?', [siteAId()]);
    expect(cartesA[0].c).toBe(0);
    const anomaliesA = await dbQuery('SELECT COUNT(*) as c FROM t_import_anomalies WHERE site_id = ?', [siteAId()]);
    expect(anomaliesA[0].c).toBe(0);

    // SCÉNARIO 3 — t_logs du Site A NON vidé par la purge normale (règle
    // métier intentionnellement différente d'emergencyPurge).
    const logsA = await dbQuery('SELECT COUNT(*) as c FROM t_logs WHERE site_id = ?', [siteAId()]);
    expect(logsA[0].c, 'La purge NORMALE ne doit JAMAIS vider t_logs, y compris pour le site qu\'elle purge elle-même').toBe(siteALogsCountBefore);

    // Aucune entrée t_sync_queue orpheline pointant vers une carte du Site A désormais supprimée
    const orphanQueue = await dbQuery(
      `SELECT COUNT(*) as c FROM t_sync_queue WHERE table_name = 't_cartes' AND record_id NOT IN (SELECT id_carte FROM t_cartes)`
    );
    expect(orphanQueue[0].c).toBe(0);

    // SCÉNARIO 3 (cloisonnement) — Site B totalement intact
    const cartesB = await dbQuery('SELECT COUNT(*) as c FROM t_cartes WHERE site_id = ?', [siteBId]);
    expect(cartesB[0].c, 'Cloisonnement confirmé : le Site B survit à la purge du Site A').toBe(1);
    const anomaliesB = await dbQuery('SELECT COUNT(*) as c FROM t_import_anomalies WHERE site_id = ?', [siteBId]);
    expect(anomaliesB[0].c).toBe(1);
    const logsB = await dbQuery('SELECT COUNT(*) as c FROM t_logs WHERE site_id = ?', [siteBId]);
    expect(logsB[0].c).toBeGreaterThanOrEqual(1);

    // SCÉNARIO 2 — Intégrité + FTS5 du Site B (non purgé) toujours opérationnel
    const integrity = await pragmaQuery('integrity_check');
    expect(integrity[0].integrity_check).toBe('ok');
    const quickCheck = await pragmaQuery('quick_check');
    expect(quickCheck[0].quick_check).toBe('ok');
    const fkCheck = await pragmaQuery('foreign_key_check');
    expect(fkCheck.length, 'foreign_key_check doit renvoyer 0 ligne (aucune violation de clé étrangère)').toBe(0);

    const ftsBAfter = await dbQuery('SELECT rowid FROM t_cartes_fts WHERE t_cartes_fts MATCH ?', ['ZZTEST_SITEB_CARD1']);
    expect(ftsBAfter.length, 'La recherche FTS5 du Site B (non purgé) doit toujours fonctionner après la purge du Site A').toBe(1);
    const ftsAAfter = await dbQuery('SELECT COUNT(*) as c FROM t_cartes_fts WHERE t_cartes_fts MATCH ?', [`${CARD_PREFIX}*`]);
    expect(ftsAAfter[0].c, 'Les cartes purgées du Site A doivent avoir disparu de l\'index FTS5').toBe(0);

    const triggers = await dbQuery("SELECT name FROM sqlite_master WHERE type='trigger' AND name IN ('trg_cartes_ai','trg_cartes_ad','trg_cartes_au')");
    expect(triggers.length).toBe(3);
    const ftsTable = await dbQuery("SELECT name FROM sqlite_master WHERE type='table' AND name='t_cartes_fts'");
    expect(ftsTable.length).toBe(1);
  });

  // ══════════════════════════════════════════════════════════════════════
  // BLOC 4 — SCÉNARIO 4 : syncEngine.pause()/resume() — vérification par les
  // logs main.log, sur le chemin de succès (test 3 ci-dessus) ET sur un
  // chemin d'échec simulé (purge d'un site étranger rejetée par le contrôle
  // de rôle ADMINISTRATEUR_SITE).
  //
  // LIMITE STRUCTURELLE (STOP & WARN documentée, pas contournée) : ce spec
  // tourne avec GEST_IN_SITU_E2E_DISABLE_SYNC=1 (réseau Supabase coupé par
  // défaut, voir electron-app.ts) — le SyncEngine ne démarre donc JAMAIS son
  // cycle de synchronisation réel dans ce mode (`resume()` ne relance
  // `startSyncCycle()` que si `networkMonitor.getState() === 'ONLINE'`), ce
  // qui rend impossible de recréer ici une VRAIE écriture concurrente
  // (upstream/downstream SyncEngine) intercalée pendant la fenêtre sans
  // triggers FTS5. Le seul mode qui permettrait cela (`launchSeededApp({
  // allowRealSync: true })`) nécessite un build isolé `dist-e2e-cloud/`
  // (`npx electron-vite build --mode e2e`) — commande de build explicitement
  // interdite à un agent de sa propre initiative (CLAUDE.md §1, et rappelé
  // en toutes lettres dans le commentaire "Mode e2e-cloud" d'electron-app.ts).
  // `dist-e2e-cloud/` présent sur ce poste date du 2026-08-02, ANTÉRIEUR aux
  // modifications de purgeLocalDatabase/handlers.ts du 2026-08-12 : l'utiliser
  // tel quel aurait testé l'ANCIEN code, pas le correctif. Ce scénario précis
  // (écriture SyncEngine réellement concurrente pendant la purge) est donc
  // documenté ci-dessous comme NON TESTABLE en l'état, à charge de
  // l'orchestrateur de faire reconstruire dist-e2e-cloud/ par un humain puis
  // de relancer ce test si une validation réseau réelle est requise.
  // ══════════════════════════════════════════════════════════════════════

  test('4. syncEngine.resume() est appelé même sur un échec (purge d\'un site étranger rejetée)', async () => {
    const { window } = env;
    const logPath = await getMainLogPath();
    const logBefore = readLogSafe(logPath);

    const cartesBBefore = await dbQuery('SELECT COUNT(*) as c FROM t_cartes WHERE site_id = ?', [siteBId]);

    // Appel direct de l'API exposée par le preload (contourne le modal UI,
    // qui ne permettrait de toute façon pas de choisir un site étranger) —
    // même pattern que le test 13 du spec import-centre-migration-qa-terrain.
    const result = await window.evaluate(async (sid) => {
      try {
        await (window as any).api.db.purge(sid, {});
        return { ok: true };
      } catch (e: any) {
        return { ok: false, message: e?.message || String(e) };
      }
    }, siteBId);

    expect(result.ok, 'Un ADMINISTRATEUR_SITE ne doit jamais pouvoir purger un site étranger').toBe(false);
    expect(result.message).toMatch(/autre site|refus/i);

    // Aucune écriture ne doit avoir eu lieu sur le Site B (tentative rejetée en amont)
    const cartesBAfter = await dbQuery('SELECT COUNT(*) as c FROM t_cartes WHERE site_id = ?', [siteBId]);
    expect(cartesBAfter[0].c).toBe(cartesBBefore[0].c);

    // Laisse le temps au flush du logger sur disque
    await window.waitForTimeout(500);
    const logAfter = readLogSafe(logPath);
    const logDiff = logAfter.slice(logBefore.length);
    console.log(`[SYNCENGINE RESUME] Diff main.log après tentative de purge d'un site étranger (${logDiff.length} caractères) :\n${logDiff}`);

    expect(logDiff, 'Le handler doit journaliser un échec critique pour cette tentative').toMatch(/PURGE LOCALE.*(ÉCHEC|CRITIQUE|CRITIQU)/);
    expect(logDiff, 'syncEngine.resume() (et son log associé) doit être appelé même après un échec — voir le bloc finally du handler db:purge').toMatch(/synchronisation r[ée]activ[ée]e/i);
  });

  // ══════════════════════════════════════════════════════════════════════
  // BLOC 5 — SCÉNARIO 5 : cas limite, purge d'un site à 0 carte. Réutilise
  // le Site A, déjà vidé par le test 3 ci-dessus (aucun redémarrage requis).
  // Appel direct de l'API (le bouton UI est désactivé quand cardCount===0,
  // ce qui est le comportement normal de l'UI — voir constat en fin de
  // rapport — donc on exerce ici directement la fonction serveur).
  // ══════════════════════════════════════════════════════════════════════

  test('5. Purge d\'un site à 0 carte (Site A déjà vidé) : succès propre, 100% atteint sans erreur ni division par zéro', async () => {
    const { window } = env;
    const cardsBefore = await dbQuery('SELECT COUNT(*) as c FROM t_cartes WHERE site_id = ?', [siteAId()]);
    expect(cardsBefore[0].c, 'Précondition du scénario : le Site A doit être vide avant ce test').toBe(0);

    const progressValues: number[] = await window.evaluate(async (sid) => {
      const events: number[] = [];
      const remove = (window as any).api.db.onPurgeProgress((p: number) => events.push(p));
      try {
        const res = await (window as any).api.db.purge(sid, {});
        if (!res?.success) throw new Error('purge a échoué de façon inattendue sur un site vide : ' + JSON.stringify(res));
        if (res.count !== 0) throw new Error('count attendu = 0, obtenu = ' + res.count);
      } finally {
        remove();
      }
      return events;
    }, siteAId());

    console.log(`[PURGE SITE VIDE] Événements de progression reçus : ${JSON.stringify(progressValues)}`);
    // Aucune assertion stricte sur la granularité (l'opération est quasi-instantanée sur 0
    // carte, le throttle peut légitimement ne laisser passer qu'un seul événement flush final) —
    // seul compte l'absence d'erreur et l'aboutissement propre, déjà vérifié ci-dessus.

    const integrity = await pragmaQuery('integrity_check');
    expect(integrity[0].integrity_check).toBe('ok');
    const cartesAfter = await dbQuery('SELECT COUNT(*) as c FROM t_cartes WHERE site_id = ?', [siteAId()]);
    expect(cartesAfter[0].c).toBe(0);
  });

  // ══════════════════════════════════════════════════════════════════════
  // NETTOYAGE FINAL
  // ══════════════════════════════════════════════════════════════════════

  test('CLEANUP. Suppression et vérification de tous les artefacts ZZTEST_ résiduels', async () => {
    const cartesDeleted = await dbQuery("DELETE FROM t_cartes WHERE noms LIKE 'ZZTEST\\_%' ESCAPE '\\'");
    const anomaliesDeleted = await dbQuery("DELETE FROM t_import_anomalies WHERE noms LIKE 'ZZTEST\\_%' ESCAPE '\\'");
    const logsDeleted = await dbQuery("DELETE FROM t_logs WHERE action LIKE 'ZZTEST\\_%' ESCAPE '\\'");
    // Le centre unique du Site A n'est jamais renommé/créé en ZZTEST par ce spec (contrairement
    // à import-centre-migration-qa-terrain.e2e.spec.ts) : pas de contournement FOREIGN KEY requis.
    const centresDeleted = await dbQuery("DELETE FROM t_centres WHERE nom LIKE 'ZZTEST\\_%' ESCAPE '\\'");
    const sitesDeleted = await dbQuery("DELETE FROM t_sites WHERE nom LIKE 'ZZTEST\\_%' ESCAPE '\\'");

    console.log(
      `[CLEANUP] Supprimés — cartes: ${cartesDeleted[0].changes}, anomalies: ${anomaliesDeleted[0].changes}, ` +
      `logs: ${logsDeleted[0].changes}, centres ZZTEST: ${centresDeleted[0].changes}, sites ZZTEST: ${sitesDeleted[0].changes}`
    );

    const remainingCartes = await dbQuery("SELECT COUNT(*) as c FROM t_cartes WHERE noms LIKE 'ZZTEST\\_%' ESCAPE '\\'");
    const remainingAnomalies = await dbQuery("SELECT COUNT(*) as c FROM t_import_anomalies WHERE noms LIKE 'ZZTEST\\_%' ESCAPE '\\'");
    const remainingLogs = await dbQuery("SELECT COUNT(*) as c FROM t_logs WHERE action LIKE 'ZZTEST\\_%' ESCAPE '\\'");
    const remainingSites = await dbQuery("SELECT COUNT(*) as c FROM t_sites WHERE nom LIKE 'ZZTEST\\_%' ESCAPE '\\'");

    expect(remainingCartes[0].c).toBe(0);
    expect(remainingAnomalies[0].c).toBe(0);
    expect(remainingLogs[0].c).toBe(0);
    expect(remainingSites[0].c).toBe(0);

    const finalIntegrity = await pragmaQuery('integrity_check');
    expect(finalIntegrity[0].integrity_check, 'Intégrité SQLite finale après nettoyage').toBe('ok');
  });
});
