/**
 * e2e/specs/_agent13_deletesite_deletecentre_neutralization.e2e.spec.ts
 *
 * QA Terrain (agent-13) — Scénario 4 du plan de revalidation du correctif de
 * fiabilité de migration : `deleteSite()`/`deleteCentre()`
 * (`src/main/database/queries/hierarchy.queries.ts`) neutralisent désormais
 * (au lieu de laisser orphelins ou, pour deleteCentre, de ne rien faire du
 * tout) les comptes utilisateurs rattachés à l'entité supprimée.
 *
 *   - deleteSite() : les comptes SUPER ADMIN rattachés au site survivent avec
 *     site_id/centre_id/poste_id → NULL, is_dirty=1, entrée UPDATE dans
 *     t_outbox. Les comptes NON-SUPER-ADMIN de ce site restent, eux,
 *     supprimés (comportement inchangé).
 *   - deleteCentre() : les comptes utilisateurs rattachés à ce centre
 *     (nouveau comportement — avant, deleteCentre() ne touchait jamais
 *     t_users) survivent avec centre_id/poste_id → NULL, is_dirty=1, entrée
 *     UPDATE dans t_outbox, et restent connectables.
 *
 * Testé via l'UI réelle (page /sites, "Infrastructures"), sous le rôle
 * SUPER ADMIN de test — jamais un appel direct à la fonction métier.
 *
 * Isolation : toutes les entités créées pour ce scénario sont préfixées
 * `ZZTEST_`, sur le `userDataDir` jetable standard de `launchSeededApp()`.
 * Nettoyage explicite en fin de run (les comptes neutralisés ne sont jamais
 * supprimés automatiquement par l'application — c'est le comportement
 * attendu — donc ce spec les supprime lui-même après vérification).
 */
import { test, expect } from '@playwright/test';
import { launchSeededApp, teardownSeededApp, type E2EEnvironment } from '../fixtures/electron-app';
import { getTestUser } from '../fixtures/test-users';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const DB_QUERY_MARKER = '__E2E_DBQ_DELSITE__:';
async function makeDbQuery(dbPath: string) {
  return async function dbQuery(sql: string, params: unknown[] = []): Promise<any[]> {
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
  };
}

test.describe.serial('QA Terrain agent-13 — Scénario 4 : deleteSite/deleteCentre neutralisent (ne suppriment pas) les comptes rattachés', () => {
  let env: E2EEnvironment;
  let dbQuery: (sql: string, params?: unknown[]) => Promise<any[]>;
  let anyTestFailed = false;

  const now = Date.now();
  const TEST_SITE_CODE = `ZZTEST-SITE-DEL-${now}`;
  const TEST_SITE_NOM = `ZZTEST_SITE_DELETE_${now}`;
  const SUPERADMIN_LOGIN = `ZZTEST_SUPERADMIN_ONSITE_${now}`;
  const OPERATEUR_ONSITE_LOGIN = `ZZTEST_OPERATEUR_ONSITE_${now}`;
  const TEST_CENTRE_NOM = `ZZTEST_CENTRE_DELETE_${now}`;
  const ADMINCENTRE_LOGIN = `ZZTEST_ADMINCENTRE_ONCENTRE_${now}`;

  let testSiteId: number;
  let testCentreId: number;

  test.beforeAll(async () => {
    env = await launchSeededApp();
    dbQuery = await makeDbQuery(env.seed.dbPath);

    // ── Site de test + SUPER ADMIN rattaché + opérateur non-SUPER-ADMIN rattaché ──
    const siteRes = await dbQuery(
      `INSERT INTO t_sites (nom, code, is_active, max_centres, is_permanent, sync_id) VALUES (?, ?, 1, 4, 1, ?)`,
      [TEST_SITE_NOM, TEST_SITE_CODE, `zztest-site-del-${now}`]
    );
    testSiteId = siteRes[0].lastInsertRowid;

    const superAdminUser = getTestUser('superAdmin');
    await dbQuery(
      `INSERT INTO t_users (login, password_hash, role, nom_user, prenom_user, statut_actif, site_id, centre_id, sync_id, is_dirty)
       VALUES (?, ?, 'SUPER ADMIN', 'ZZTEST', 'SuperAdminOnSite', 1, ?, NULL, ?, 0)`,
      [SUPERADMIN_LOGIN, superAdminUser.passwordHash, testSiteId, `zztest-superadmin-onsite-${now}`]
    );

    await dbQuery(
      `INSERT INTO t_users (login, password_hash, role, nom_user, prenom_user, statut_actif, site_id, centre_id, sync_id, is_dirty)
       VALUES (?, ?, 'OPERATEUR_VERIFICATION', 'ZZTEST', 'OperateurOnSite', 1, ?, NULL, ?, 0)`,
      [OPERATEUR_ONSITE_LOGIN, superAdminUser.passwordHash, testSiteId, `zztest-operateur-onsite-${now}`]
    );

    // ── Centre de test (numero=2, non-principal → bouton de suppression actif
    //    dans l'UI) rattaché au site principal du seed + ADMIN_CENTRE rattaché ──
    const centreRes = await dbQuery(
      `INSERT INTO t_centres (site_id, nom, numero, prefixe_rangement, sync_id) VALUES (?, ?, 2, 'ZZT', ?)`,
      [env.seed.siteId, TEST_CENTRE_NOM, `zztest-centre-del-${now}`]
    );
    testCentreId = centreRes[0].lastInsertRowid;

    const adminCentreUser = getTestUser('adminCentre');
    await dbQuery(
      `INSERT INTO t_users (login, password_hash, role, nom_user, prenom_user, statut_actif, site_id, centre_id, sync_id, is_dirty)
       VALUES (?, ?, 'ADMIN_CENTRE', 'ZZTEST', 'AdminCentreOnCentre', 1, ?, ?, ?, 0)`,
      [ADMINCENTRE_LOGIN, adminCentreUser.passwordHash, env.seed.siteId, testCentreId, `zztest-admincentre-oncentre-${now}`]
    );
  });

  test.afterAll(async () => {
    // Nettoyage explicite des comptes neutralisés (jamais supprimés par
    // l'application elle-même — comportement attendu) + résidus outbox.
    // Enveloppé en try/catch : un échec de nettoyage ne doit JAMAIS empêcher
    // teardownSeededApp() de fermer le process Electron (sinon le worker
    // Playwright reste bloqué en attente de fermeture — constaté en run réel).
    try {
      if (dbQuery) {
        // FK : t_user_roles/t_logs référencent t_users(id_user) — nettoyer les
        // dépendants avant les comptes eux-mêmes (le login réel effectué en
        // 4.6 a pu créer une entrée t_logs pour ADMINCENTRE_LOGIN).
        await dbQuery(
          `DELETE FROM t_user_roles WHERE id_user IN (SELECT id_user FROM t_users WHERE login IN (?, ?, ?))`,
          [SUPERADMIN_LOGIN, OPERATEUR_ONSITE_LOGIN, ADMINCENTRE_LOGIN]
        );
        await dbQuery(
          `DELETE FROM t_logs WHERE id_user IN (SELECT id_user FROM t_users WHERE login IN (?, ?, ?))`,
          [SUPERADMIN_LOGIN, OPERATEUR_ONSITE_LOGIN, ADMINCENTRE_LOGIN]
        );
        const cleanupUsers = await dbQuery(
          `DELETE FROM t_users WHERE login IN (?, ?, ?)`,
          [SUPERADMIN_LOGIN, OPERATEUR_ONSITE_LOGIN, ADMINCENTRE_LOGIN]
        );
        console.log(`[agent13][scenario4][cleanup] t_users supprimés : ${cleanupUsers[0].changes}`);
        const cleanupOutbox = await dbQuery(`DELETE FROM t_outbox WHERE id LIKE 'zztest-%'`);
        console.log(`[agent13][scenario4][cleanup] t_outbox résiduel supprimé : ${cleanupOutbox[0].changes}`);
      }
    } catch (err) {
      console.warn('[agent13][scenario4][cleanup] Échec du nettoyage (non-bloquant) :', err);
    }
    if (env) await teardownSeededApp(env, anyTestFailed);
  });

  test.afterEach(async ({}, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus) anyTestFailed = true;
  });

  test('4.0 Préconditions en base avant toute action UI', async () => {
    const site = await dbQuery('SELECT id FROM t_sites WHERE id = ?', [testSiteId]);
    expect(site.length).toBe(1);
    const superAdminBefore = await dbQuery('SELECT site_id FROM t_users WHERE login = ?', [SUPERADMIN_LOGIN]);
    expect(superAdminBefore[0].site_id).toBe(testSiteId);
    const centre = await dbQuery('SELECT id FROM t_centres WHERE id = ?', [testCentreId]);
    expect(centre.length).toBe(1);
    const adminCentreBefore = await dbQuery('SELECT centre_id FROM t_users WHERE login = ?', [ADMINCENTRE_LOGIN]);
    expect(adminCentreBefore[0].centre_id).toBe(testCentreId);
  });

  test('4.1 Connexion SUPER ADMIN et navigation vers Infrastructures (/sites)', async () => {
    const { window } = env;
    const superAdmin = getTestUser('superAdmin');
    await window.waitForURL(/#\/login/, { timeout: 20000 });
    await window.getByTestId('login-input').fill(superAdmin.login);
    await window.getByTestId('password-input').fill(superAdmin.password);
    await window.getByTestId('login-submit').click();
    await window.waitForURL(/#\/dashboard/, { timeout: 20000 });

    await window.getByText('Infrastructures').click();
    await window.waitForURL(/#\/sites/, { timeout: 20000 });
    await expect(window.getByRole('table').getByText(TEST_SITE_NOM)).toBeVisible({ timeout: 15000 });
  });

  test('4.2 Suppression du site de test via l\'UI (mot de passe admin requis)', async () => {
    const { window } = env;
    const row = window.locator('tr', { hasText: TEST_SITE_NOM });
    await row.locator('button[title="Suppression irréversible"]').click();

    await expect(window.getByText('PURGE COMPLÈTE DU SITE')).toBeVisible({ timeout: 10000 });
    await window.locator('input[type="password"]').fill(getTestUser('superAdmin').password);
    await window.getByRole('button', { name: 'EXÉCUTER LA PURGE' }).click();

    // Attente de la disparition de la ligne (succès de l'opération) plutôt
    // que du toast, plus robuste aux variations de timing d'affichage.
    await expect(window.getByRole('table').getByText(TEST_SITE_NOM)).toHaveCount(0, { timeout: 20000 });
  });

  test('4.3 Vérification base : site supprimé, SUPER ADMIN neutralisé (survit), opérateur non-SUPER-ADMIN supprimé, outbox UPDATE', async () => {
    const site = await dbQuery('SELECT id FROM t_sites WHERE id = ?', [testSiteId]);
    expect(site.length).toBe(0);

    const superAdminAfter = await dbQuery(
      'SELECT site_id, centre_id, poste_id, is_dirty, sync_id FROM t_users WHERE login = ?',
      [SUPERADMIN_LOGIN]
    );
    expect(superAdminAfter.length).toBe(1); // survit — jamais supprimé
    expect(superAdminAfter[0].site_id).toBeNull();
    expect(superAdminAfter[0].centre_id).toBeNull();
    expect(superAdminAfter[0].poste_id).toBeNull();
    expect(superAdminAfter[0].is_dirty).toBe(1);

    const operateurAfter = await dbQuery('SELECT id_user FROM t_users WHERE login = ?', [OPERATEUR_ONSITE_LOGIN]);
    expect(operateurAfter.length).toBe(0); // comportement inchangé : supprimé avec le site

    const outboxEntry = await dbQuery(
      `SELECT operation, table_name FROM t_outbox WHERE id = ?`,
      [superAdminAfter[0].sync_id]
    );
    expect(outboxEntry.length).toBe(1);
    expect(outboxEntry[0].operation).toBe('UPDATE');
    expect(outboxEntry[0].table_name).toBe('t_users');
  });

  test('4.4 Suppression du centre de test via l\'UI (onglet Centres, confirmService)', async () => {
    const { window } = env;
    await window.getByText('Centres', { exact: true }).click();
    await expect(window.getByRole('table').getByText(TEST_CENTRE_NOM)).toBeVisible({ timeout: 15000 });

    const row = window.locator('tr', { hasText: TEST_CENTRE_NOM });
    await row.locator('button[title="Supprimer ce centre"]').click();

    await expect(window.getByText('Confirmez votre mot de passe')).toBeVisible({ timeout: 10000 });
    await window.getByPlaceholder('••••••••').last().fill(getTestUser('superAdmin').password);
    await window.getByRole('button', { name: 'Confirmer' }).click();

    await expect(window.getByRole('table').getByText(TEST_CENTRE_NOM)).toHaveCount(0, { timeout: 20000 });
  });

  test('4.5 Vérification base : centre supprimé, ADMIN_CENTRE neutralisé (survit), outbox UPDATE', async () => {
    const centre = await dbQuery('SELECT id FROM t_centres WHERE id = ?', [testCentreId]);
    expect(centre.length).toBe(0);

    const adminCentreAfter = await dbQuery(
      'SELECT centre_id, poste_id, is_dirty, sync_id, site_id FROM t_users WHERE login = ?',
      [ADMINCENTRE_LOGIN]
    );
    expect(adminCentreAfter.length).toBe(1); // survit
    expect(adminCentreAfter[0].centre_id).toBeNull();
    expect(adminCentreAfter[0].poste_id).toBeNull();
    expect(adminCentreAfter[0].is_dirty).toBe(1);
    // site_id, lui, n'est jamais touché par deleteCentre (contrairement à
    // deleteSite) — l'utilisateur garde son rattachement au niveau du site.
    expect(adminCentreAfter[0].site_id).toBe(env.seed.siteId);

    const outboxEntry = await dbQuery(
      `SELECT operation, table_name FROM t_outbox WHERE id = ?`,
      [adminCentreAfter[0].sync_id]
    );
    expect(outboxEntry.length).toBe(1);
    expect(outboxEntry[0].operation).toBe('UPDATE');
    expect(outboxEntry[0].table_name).toBe('t_users');
  });

  test('4.6 Le compte ADMIN_CENTRE neutralisé reste utilisable (connexion possible)', async () => {
    const { window } = env;
    // Déconnexion du SUPER ADMIN.
    const logoutBtn = window.getByRole('button', { name: /Déconnexion|Se déconnecter/i });
    if (await logoutBtn.count() > 0) {
      await logoutBtn.first().click();
    } else {
      await window.evaluate(() => localStorage.clear());
      await window.goto(window.url().split('#')[0] + '#/login');
    }
    await window.waitForURL(/#\/login/, { timeout: 20000 });

    const adminCentreUser = getTestUser('adminCentre');
    await window.getByTestId('login-input').fill(ADMINCENTRE_LOGIN);
    await window.getByTestId('password-input').fill(adminCentreUser.password);
    await window.getByTestId('login-submit').click();

    // Connexion réussie = navigation hors de /login (peu importe la route
    // exacte, l'important est l'absence d'erreur d'authentification).
    await window.waitForURL((url) => !url.toString().includes('#/login'), { timeout: 20000 });
  });
});
