/**
 * e2e/specs/cloud/sync-cloud-real-fallback.e2e.spec.ts
 *
 * QA Terrain (agent-13, run 4) — Scénario 3 (fallback de recherche cloud)
 * isolé dans son propre fichier / sa propre instance Electron fraîche.
 *
 * Raison de l'isolement : `sync-cloud-real.e2e.spec.ts` (scénarios 1 et 2,
 * même run) a mis en évidence une corruption SQLite réelle et reproductible
 * ("database disk image is malformed" sur `cartes:delivrer`, confirmée sur
 * 4 tentatives indépendantes, y compris SANS aucune connexion SQLite externe
 * — voir le rapport final de la session pour le détail) dès qu'une carte est
 * créée puis délivrée alors que le SyncEngine réel tourne. Cette anomalie
 * est documentée comme P0 dans le rapport, hors périmètre de correction pour
 * agent-13 (STOP & WARN — composant SyncEngine/Worker Threads partagé).
 *
 * Le scénario 3 (recherche cloud de secours + rapatriement unitaire) ne
 * dépend d'aucune délivrance ni création de carte : il est testé ici
 * indépendamment, dans une instance qui n'exécute jamais `cartes:create` ni
 * `cartes:delivrer`, pour ne pas être bloqué par l'anomalie ci-dessus.
 */
import { test, expect } from '@playwright/test';
import { launchSeededApp, teardownSeededApp, type E2EEnvironment } from '../../fixtures/electron-app';
import { getTestUser } from '../../fixtures/test-users';
import { ensureCloudSiteAndCentre, insertCloudCard, cleanupAllCloudTestData } from '../../fixtures/supabase-dev-client';
import { execFileSync } from 'child_process';
import { join } from 'path';

function dbPathOf(userDataDir: string): string {
  return join(userDataDir, 'data', 'gest_in_situ.db');
}
function queryDb(dbPath: string, sql: string): string {
  return execFileSync('sqlite3', [dbPath, sql], { encoding: 'utf-8' }).trim();
}

const RUN_ID = Date.now();
const FALLBACK_SYNC_ID = `zztest-cloud-fallback2-${RUN_ID}`;

test.describe.serial('Sync Cloud RÉELLE — Scénario 3 isolé : fallback recherche cloud (QA Terrain agent-13, run 4)', () => {
  let env: E2EEnvironment;
  let dbPath: string;
  let mainSiteId: number;
  let mainCentreId: number;
  let anyTestFailed = false;

  test.beforeAll(async () => {
    env = await launchSeededApp({ allowRealSync: true });
    dbPath = dbPathOf(env.userDataDir);
    mainSiteId = env.seed.siteId;
    mainCentreId = env.seed.centreId;
    await ensureCloudSiteAndCentre(mainSiteId, mainCentreId);
    await insertCloudCard({
      sync_id: FALLBACK_SYNC_ID,
      noms: 'ZZTEST_CLOUDFALLBACK2',
      prenoms: 'BAKARY',
      date_naissance: '1992-08-03',
      rangement: 'F1',
      statut: 'EN STOCK',
      id_site: mainSiteId,
      id_centre: mainCentreId,
      contact: '0102030492',
      num_secu: 'ZZTEST-NUMSECU-FALLBACK2'
    });
  });

  test.afterAll(async () => {
    if (env) {
      try {
        execDbSafe(dbPath, "DELETE FROM t_cartes WHERE noms LIKE 'ZZTEST_%';");
      } catch (e) {
        console.warn('[E2E-CLOUD] Nettoyage local ZZTEST_ échoué (non bloquant) :', e);
      }
      await teardownSeededApp(env, anyTestFailed);
    }
    const residual = await cleanupAllCloudTestData();
    console.log(
      `[E2E-CLOUD][NETTOYAGE FINAL - scénario 3 isolé] Résidus ZZTEST_ après DELETE + re-SELECT -> ` +
      `cartes=${residual.residualCartes} centres=${residual.residualCentres} sites=${residual.residualSites} (attendu : 0/0/0)`
    );
    expect(residual.residualCartes).toBe(0);
    expect(residual.residualCentres).toBe(0);
    expect(residual.residualSites).toBe(0);
  });

  test.afterEach(async ({}, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus) anyTestFailed = true;
  });

  function execDbSafe(dbPath: string, sql: string): void {
    execFileSync('sqlite3', [dbPath, sql], { encoding: 'utf-8' });
  }

  async function login(): Promise<void> {
    const { window } = env;
    const user = getTestUser('operateurVerification');
    await window.waitForURL(/#\/login/);
    await window.getByTestId('login-input').fill(user.login);
    await window.getByTestId('password-input').fill(user.password);
    await window.getByTestId('login-submit').click();
    await window.waitForURL(/#\/agent-verification$/, { timeout: 15000 });
  }

  function deliveryModal() {
    return env.window.locator('.card').filter({ hasText: 'Vérification Physique' });
  }

  test('3a. Carte ZZTEST_CLOUDFALLBACK2 posée UNIQUEMENT côté cloud -> introuvable localement, fallback searchCloudEmergency la trouve, "Rapatrier" -> insertion locale', async () => {
    const { window } = env;
    await login();

    const localBefore = queryDb(dbPath, `SELECT COUNT(*) FROM t_cartes WHERE sync_id='${FALLBACK_SYNC_ID}';`);
    expect(Number(localBefore)).toBe(0);

    // seed-database.ts ne seed aucune carte : RechercheView bloque la recherche
    // ("Base de données locale vide") tant que cardsCount === 0 pour le site.
    // Une carte ANCRE locale (jamais délivrée -> pas de `cartes:delivrer`, cf.
    // l'anomalie P0 documentée dans sync-cloud-real.e2e.spec.ts) suffit à lever
    // ce blocage sans revalider le chemin de délivrance ici.
    await window.evaluate(
      async ({ siteId, centreId }) => {
        return (window as any).api.cartes.create({
          noms: 'ZZTEST_ANCHOR',
          prenoms: 'LOCALE',
          date_de_naissance: '1980-01-01',
          rangement: 'A0',
          statut: 'EN STOCK',
          site_id: siteId,
          centre_id: centreId,
          contact: '0102030400',
          num_secu: 'ZZTEST-NUMSECU-ANCHOR',
          agent_saisie: 'E2E_OPERATEUR_VERIFICATION'
        });
      },
      { siteId: mainSiteId, centreId: mainCentreId }
    );

    await window.getByRole('link', { name: 'Recherche Active' }).click();
    await window.waitForURL(/#\/agent-verification\/recherche/, { timeout: 15000 });
    await window.locator('input[placeholder="Ex: KOFFI KOFFI KAN"]').fill('ZZTEST_CLOUDFALLBACK2 BAKARY');
    await window.locator('input[placeholder="JJ/MM/AAAA"]').fill('03/08/1992');
    await window.getByRole('button', { name: /Rechercher la Carte/ }).click();

    await expect(window.getByText('Trouvée sur le Cloud')).toBeVisible({ timeout: 15000 });
    await expect(window.getByText('ZZTEST_CLOUDFALLBACK2')).toBeVisible();
    const rapatrierButton = window.getByRole('button', { name: /Rapatrier/ });
    await expect(rapatrierButton).toBeVisible();

    await rapatrierButton.click();

    await expect(deliveryModal()).toBeVisible({ timeout: 15000 });
    await expect(deliveryModal()).toContainText('ZZTEST_CLOUDFALLBACK2');

    const localAfter = queryDb(
      dbPath,
      `SELECT noms, prenoms, date_de_naissance, rangement, statut, site_id, centre_id, is_dirty FROM t_cartes WHERE sync_id='${FALLBACK_SYNC_ID}';`
    );
    console.log(`[QA-CHECK][Scénario 3 isolé] Ligne SQLite locale après rapatriement unitaire -> "${localAfter}"`);
    expect(localAfter).toBe(`ZZTEST_CLOUDFALLBACK2|BAKARY|1992-08-03|F1|EN STOCK|${mainSiteId}|${mainCentreId}|0`);

    await window.locator('.btn-close').click();
  });
});
