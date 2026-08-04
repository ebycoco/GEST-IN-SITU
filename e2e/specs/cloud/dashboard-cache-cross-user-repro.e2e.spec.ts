/**
 * e2e/specs/cloud/dashboard-cache-cross-user-repro.e2e.spec.ts
 *
 * QA Terrain (agent-13) — Reproduction ciblée du bug signalé en production :
 * après import + push par un ADMINISTRATEUR_SITE, un OPERATEUR_VERIFICATION/
 * OPERATEUR_QUALITE du même site qui se connecte ENSUITE sur LA MÊME instance
 * Electron (process jamais redémarré) voit le badge "Cartes disponibles en
 * local" figé à une ancienne valeur, y compris après un clic sur "RÉCUPÉRER
 * LES CARTES DEPUIS LE CLOUD".
 *
 * Hypothèse à confirmer/infirmer : `useCacheStore` (src/renderer/src/stores/
 * cacheStore.ts) est un store Zustand EN MÉMOIRE PARTAGÉ PAR TOUTE L'APP, sans
 * clé par utilisateur/site. Le montage de `useDashboardStats.ts` (lignes
 * 199-230) n'appelle `loadStats()` QUE si `cache.dashboardCache.cachedAt` est
 * absent — sinon il réutilise tel quel le cache déjà présent, quel que soit
 * qui l'y a posé. `authStore.ts.logout()` appelle bien `clearCache()`, mais
 * après 2 `await` dans une fonction async : reste à vérifier empiriquement
 * que ce nettoyage a toujours le temps de s'exécuter avant le montage du
 * Layout du prochain utilisateur.
 *
 * Échelle volontairement réduite (N1=5 puis +N2=20 => 25 cartes) : seul
 * l'ÉCART entre deux nombres compte pour prouver/réfuter le bug, pas le
 * volume réel de production (218 332).
 *
 * Toutes les cartes créées sont préfixées `ZZTEST_CACHEBUG_` et supprimées en
 * fin de run (test 'ZZ. Nettoyage'), avec vérification finale par re-SELECT.
 * Les comptes utilisés (`E2E_OPERATEUR_VERIFICATION`, `E2E_ADMINISTRATEUR_SITE`)
 * sont ceux déjà seedés par `seed-database.ts` (voir e2e/fixtures/test-users.ts),
 * rattachés au même site/centre de test — aucun compte inventé.
 *
 * Harnais par défaut (PAS `allowRealSync`) : ce bug est purement local/cache,
 * aucun accès réseau réel n'est nécessaire pour le reproduire. Le clic sur
 * "RÉCUPÉRER LES CARTES DEPUIS LE CLOUD" est tout de même exercé (test 4) pour
 * observer son effet réel sur l'affichage dans CET environnement — sa
 * signification est nuancée dans les logs/rapport car `GEST_IN_SITU_E2E_DISABLE_SYNC=1`
 * empêche un pull réseau réellement réussi (voir commentaire du test 4).
 */
import { test, expect } from '@playwright/test';
import { launchSeededApp, teardownSeededApp, type E2EEnvironment } from '../../fixtures/electron-app';
import { getTestUser } from '../../fixtures/test-users';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const RUN_ID = Date.now();
const N1 = 5;
const N2 = 20;
const NOMS_PREFIX = 'ZZTEST_CACHEBUG';

test.describe.serial('Repro — Cache dashboard partagé entre utilisateurs sur la même instance (agent-13)', () => {
  let env: E2EEnvironment;
  let anyTestFailed = false;
  let operatorBadgeAfterFirstLogin = -1;
  let adminTotalBeforeImport = -1;
  let adminTotalAfterImport = -1;
  let operatorBadgeAfterRelogin = -1;

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

  // ── Helper SQL brut (identique au pattern éprouvé d'adminsite-qa-terrain.e2e.spec.ts) ──
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
        `zztest-cachebug-${RUN_ID}-${idx}`,
        0 // is_dirty=0 : simule des cartes déjà importées/synchronisées, comme dans le scénario rapporté
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

  async function logout(): Promise<void> {
    const { window } = env;
    await window.getByText('Déconnexion').click();
    await window.waitForURL(/#\/login/, { timeout: 15000 });
  }

  async function readOperatorLocalBadge(): Promise<number> {
    const { window } = env;
    const label = window.getByText('Cartes disponibles en local :', { exact: true });
    await expect(label).toBeVisible({ timeout: 30000 });
    const parent = label.locator('xpath=..');
    const valueSpan = parent.locator('span').last();
    const text = (await valueSpan.textContent()) || '';
    return Number(text.replace(/[^\d]/g, ''));
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

  // ══════════════════════════════════════════════════════════════════════
  test('0. Seed N1 cartes ZZTEST_CACHEBUG_ pour le site de test (avant toute connexion)', async () => {
    await insertZzTestCartes(N1, 1);
    const rows = await dbQuery(
      `SELECT COUNT(*) as c FROM t_cartes WHERE site_id = ? AND noms LIKE ?`,
      [env.seed.siteId, `${NOMS_PREFIX}_%`]
    );
    expect(rows[0].c).toBe(N1);
  });

  test('1. OPERATEUR_VERIFICATION se connecte EN PREMIER -> badge "Cartes disponibles en local" = N1', async () => {
    const user = getTestUser('operateurVerification');
    await login(user.login, user.password, /#\/agent-verification/);

    operatorBadgeAfterFirstLogin = await readOperatorLocalBadge();
    console.log(`[QA-CHECK][Étape 1] Badge opérateur à la 1ère connexion = ${operatorBadgeAfterFirstLogin} (attendu ${N1})`);
    expect(operatorBadgeAfterFirstLogin).toBe(N1);

    // Laisse le temps au fetch cloudCartesCount (retry borné, ~2.5s x tentatives)
    // et à l'écriture du cache de bien se terminer avant la déconnexion.
    await env.window.waitForTimeout(3000);
    await logout();
  });

  test('2. ADMINISTRATEUR_SITE se connecte ensuite (même instance, process non redémarré) -> importe N2 cartes -> "Actualiser" confirme N1+N2', async () => {
    const user = getTestUser('administrateurSite');
    await login(user.login, user.password, /#\/dashboard/);

    adminTotalBeforeImport = await readAdminTotalCartes();
    console.log(`[QA-CHECK][Étape 2] Total Cartes admin avant import = ${adminTotalBeforeImport} (attendu ${N1})`);
    expect(adminTotalBeforeImport).toBe(N1);

    // Simulateur d'import CSV : insertion directe en base locale (mêmes garanties
    // qu'un import réel côté lecture des stats — la mécanique testée ici est le
    // rafraîchissement de l'affichage, pas le pipeline d'import lui-même).
    await insertZzTestCartes(N2, N1 + 1);
    const rows = await dbQuery(
      `SELECT COUNT(*) as c FROM t_cartes WHERE site_id = ? AND noms LIKE ?`,
      [env.seed.siteId, `${NOMS_PREFIX}_%`]
    );
    expect(rows[0].c).toBe(N1 + N2);

    const { window } = env;
    await window.getByRole('button', { name: /Actualiser/ }).click();
    await expect(window.getByText('Tableau de bord actualisé')).toBeVisible({ timeout: 15000 });

    adminTotalAfterImport = await readAdminTotalCartes();
    console.log(`[QA-CHECK][Étape 2] Total Cartes admin après import + clic "Actualiser" = ${adminTotalAfterImport} (attendu ${N1 + N2})`);
    expect(adminTotalAfterImport).toBe(N1 + N2);

    await logout();
  });

  test('3. OPERATEUR_VERIFICATION se reconnecte (même instance, sans redémarrage) -> quelle valeur pour le badge local ?', async () => {
    const user = getTestUser('operateurVerification');
    await login(user.login, user.password, /#\/agent-verification/);

    operatorBadgeAfterRelogin = await readOperatorLocalBadge();
    const bugReproduced = operatorBadgeAfterRelogin !== (N1 + N2);
    console.log(
      `[QA-CHECK][Étape 3][VERDICT] Badge opérateur après re-connexion = ${operatorBadgeAfterRelogin} ` +
      `| vrai total site (BDD) = ${N1 + N2} | valeur mise en cache par l'opérateur à l'étape 1 = ${N1} ` +
      `| BUG REPRODUIT = ${bugReproduced}`
    );

    // Vérité terrain indépendante de l'UI/cache renderer : appel IPC brut
    // window.api.stats.get(siteId), qui interroge SQLite fraîchement (hors
    // cache Zustand). Sert à prouver que la couche donnée/IPC est saine et
    // que tout écart constaté ci-dessus est un problème de RENDU, pas de requête.
    const rawIpcTotal = await env.window.evaluate(
      (siteId) => (window as any).api.stats.get(siteId).then((s: any) => s.total),
      env.seed.siteId
    );
    console.log(`[QA-CHECK][Étape 3] window.api.stats.get(siteId) en appel direct (hors cache Zustand) = ${rawIpcTotal} (attendu ${N1 + N2})`);
    expect(rawIpcTotal).toBe(N1 + N2);
  });

  test('4. Clic "RÉCUPÉRER LES CARTES DEPUIS LE CLOUD" -> le badge se met-il à jour ?', async () => {
    const { window } = env;
    const pullButton = window.getByRole('button', { name: /RÉCUPÉRER LES CARTES DEPUIS LE CLOUD/ });
    await expect(pullButton).toBeVisible({ timeout: 15000 });

    const disabledBefore = await pullButton.isDisabled();
    console.log(`[QA-CHECK][Étape 4] Bouton "Récupérer" avant clic -> disabled=${disabledBefore}, badge actuel=${await readOperatorLocalBadge()}`);

    if (!disabledBefore) {
      await pullButton.click();
      // Harnais par défaut : GEST_IN_SITU_E2E_DISABLE_SYNC=1 coupe tout accès
      // Supabase réel (voir electron-app.ts). Un clic ici NE PEUT donc PAS
      // aboutir à un pull réseau réellement réussi dans get environnement —
      // seul le comportement du bouton/toast est observé (fenêtre d'attente
      // généreuse pour laisser le temps à l'IPC d'échouer proprement et à
      // loadStats() de s'exécuter s'il est atteint).
      await window.waitForTimeout(6000);
    }

    const badgeAfterClick = await readOperatorLocalBadge();
    console.log(
      `[QA-CHECK][Étape 4][VERDICT] Badge après clic "Récupérer" = ${badgeAfterClick} ` +
      `(avant clic: ${operatorBadgeAfterRelogin}, vrai total BDD: ${N1 + N2}) ` +
      `| bouton était disabled=${disabledBefore}`
    );
  });

  test('ZZ. Nettoyage des données ZZTEST_CACHEBUG_', async () => {
    await logout().catch(() => {});
    const del = await dbQuery(`DELETE FROM t_cartes WHERE noms LIKE ?`, [`${NOMS_PREFIX}_%`]);
    const check = await dbQuery(
      `SELECT COUNT(*) as c FROM t_cartes WHERE noms LIKE ?`,
      [`${NOMS_PREFIX}_%`]
    );
    console.log(`[QA-CHECK][Nettoyage] DELETE changes=${del[0]?.changes} résiduel après re-SELECT=${check[0].c} (attendu 0)`);
    expect(check[0].c).toBe(0);
  });
});
