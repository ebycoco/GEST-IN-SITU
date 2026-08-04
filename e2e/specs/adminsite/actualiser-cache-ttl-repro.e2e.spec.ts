/**
 * e2e/specs/adminsite/actualiser-cache-ttl-repro.e2e.spec.ts
 *
 * Repro ciblée (agent-3) du bug P1 signalé par agent-13 : le bouton
 * "Actualiser" du Dashboard (SiteAdminView.tsx:585) peut afficher des KPI
 * périmés jusqu'à 15s après un chargement précédent, à cause de la
 * mémoïsation en mémoire du handler IPC `stats:get`
 * (src/main/ipc/handlers.ts, STATS_CACHE_TTL_MS = 15000) qui ne fait aucune
 * distinction entre un appel "routine" et un clic explicite sur "Actualiser".
 *
 * Scénario : connexion ADMINISTRATEUR_SITE (peuple le cache stats:get avec
 * un timestamp T0) -> insertion de 3 cartes en base -> clic "Actualiser"
 * BIEN AVANT l'expiration des 15s -> AVANT correctif, le total affiché reste
 * figé à la valeur d'avant insertion (cache hit silencieux) ; APRÈS correctif
 * (forceRefresh: true propagé jusqu'au handler), le total reflète
 * immédiatement les 3 cartes insérées.
 *
 * Harnais par défaut (pas d'allowRealSync) : bug purement local (cache
 * mémoire + SQLite), aucun accès réseau requis.
 */
import { test, expect } from '@playwright/test';
import { launchSeededApp, teardownSeededApp, type E2EEnvironment } from '../../fixtures/electron-app';
import { getTestUser } from '../../fixtures/test-users';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const RUN_ID = Date.now();
const NOMS_PREFIX = 'ZZTEST_ACTUALISERCACHE';
const N_INSERTED = 3;

test.describe.serial('Repro — bouton "Actualiser" et cache TTL 15s de stats:get (agent-3)', () => {
  let env: E2EEnvironment;
  let anyTestFailed = false;
  let totalBeforeInsert = -1;
  let totalAfterActualiser = -1;

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

  async function insertZzTestCartes(count: number, offset: number): Promise<void> {
    const rowsSql: string[] = [];
    const params: unknown[] = [];
    for (let i = 0; i < count; i++) {
      const idx = offset + i;
      rowsSql.push('(?,?,?,?,?,?,?,?)');
      params.push(
        `${NOMS_PREFIX}_${idx}`,
        'OPERATEUR',
        '1990-01-01',
        'EN STOCK',
        env.seed.siteId,
        env.seed.centreId,
        `zztest-actualisercache-${RUN_ID}-${idx}`,
        0
      );
    }
    const sql = `INSERT INTO t_cartes (noms, prenoms, date_de_naissance, statut, site_id, centre_id, sync_id, is_dirty) VALUES ${rowsSql.join(',')}`;
    await dbQuery(sql, params);
  }

  async function login(loginId: string, password: string, urlPattern: RegExp): Promise<void> {
    const { window } = env;
    await window.waitForURL(/#\/login/, { timeout: 20000 });
    await window.getByTestId('login-input').fill(loginId);
    await window.getByTestId('password-input').fill(password);
    await window.getByTestId('login-submit').click();
    await window.waitForURL(urlPattern, { timeout: 20000 });
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

  test('1. Connexion ADMINISTRATEUR_SITE -> lecture du Total Cartes initial (peuple le cache stats:get, T0)', async () => {
    const user = getTestUser('administrateurSite');
    await login(user.login, user.password, /#\/dashboard/);

    totalBeforeInsert = await readAdminTotalCartes();
    console.log(`[QA-CHECK][Étape 1] Total Cartes initial (T0, cache peuplé) = ${totalBeforeInsert}`);
    expect(totalBeforeInsert).toBeGreaterThanOrEqual(0);
  });

  test('2. Insertion de 3 cartes en base, puis clic "Actualiser" BIEN AVANT expiration du cache (TTL 15s)', async () => {
    // Le chargement initial de la page (étape 1) peut avoir pris plusieurs
    // dizaines de secondes (login + rendu + attente KPI) : le T0 réel du
    // cache mémoire `stats:get` (posé par le tout premier appel au montage du
    // Dashboard) est donc potentiellement déjà ancien. On réétablit un T0
    // fiable et récent ICI, par un appel IPC direct et volontairement SANS
    // forceRefresh — reflète exactement ce qu'un rechargement passif ferait
    // (et garantit que le cache est frais de <1s au moment de l'insertion
    // ci-dessous, pour que le test soit déterministe et ne dépende pas de la
    // durée variable du login/rendu initial).
    const freshBaseline = await env.window.evaluate(
      (siteId) => (window as any).api.stats.get(siteId).then((s: any) => s.total),
      env.seed.siteId
    );
    totalBeforeInsert = freshBaseline;
    console.log(`[QA-CHECK][Étape 2] Baseline réétablie juste avant insertion (T0 frais) = ${totalBeforeInsert}`);

    await insertZzTestCartes(N_INSERTED, 1);
    const rows = await dbQuery(
      `SELECT COUNT(*) as c FROM t_cartes WHERE site_id = ? AND noms LIKE ?`,
      [env.seed.siteId, `${NOMS_PREFIX}_%`]
    );
    expect(rows[0].c).toBe(N_INSERTED);

    // Volontairement rapide : l'objectif est de rester BIEN en-deçà des 15s de
    // TTL du cache mémoire stats:get (le clic ci-dessous survient typiquement
    // 1-3s après le chargement initial de l'étape 1).
    const { window } = env;
    await window.getByRole('button', { name: /Actualiser/ }).click();
    await expect(window.getByText('Tableau de bord actualisé')).toBeVisible({ timeout: 15000 });

    totalAfterActualiser = await readAdminTotalCartes();
    const expected = totalBeforeInsert + N_INSERTED;
    const bugReproduced = totalAfterActualiser !== expected;
    console.log(
      `[QA-CHECK][Étape 2][VERDICT] Total Cartes après clic "Actualiser" (<15s après T0) = ${totalAfterActualiser} ` +
      `(attendu ${expected} = ${totalBeforeInsert} + ${N_INSERTED}) | BUG REPRODUIT (KPI périmé) = ${bugReproduced}`
    );

    // Vérité terrain indépendante du rendu : appel IPC brut sans forceRefresh,
    // pour documenter la valeur telle que renvoyée par le cache mémoire au
    // moment du clic (utile au diagnostic, n'influence pas l'assertion finale).
    const rawIpcTotalNoForce = await env.window.evaluate(
      (siteId) => (window as any).api.stats.get(siteId).then((s: any) => s.total),
      env.seed.siteId
    );
    console.log(`[QA-CHECK][Étape 2] window.api.stats.get(siteId) SANS forceRefresh (peut encore lire le cache <15s) = ${rawIpcTotalNoForce}`);

    expect(totalAfterActualiser).toBe(expected);
  });

  test('ZZ. Nettoyage des données ZZTEST_ACTUALISERCACHE_', async () => {
    const del = await dbQuery(`DELETE FROM t_cartes WHERE noms LIKE ?`, [`${NOMS_PREFIX}_%`]);
    const check = await dbQuery(
      `SELECT COUNT(*) as c FROM t_cartes WHERE noms LIKE ?`,
      [`${NOMS_PREFIX}_%`]
    );
    console.log(`[QA-CHECK][Nettoyage] DELETE changes=${del[0]?.changes} résiduel après re-SELECT=${check[0].c} (attendu 0)`);
    expect(check[0].c).toBe(0);
  });
});
