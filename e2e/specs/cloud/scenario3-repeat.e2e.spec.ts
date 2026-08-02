/**
 * e2e/specs/cloud/scenario3-repeat.e2e.spec.ts
 *
 * QA Terrain (agent-13) — 5ème passage, CONFIRMATION FINALE du P0 (voir
 * scenario2-repeat-10x.e2e.spec.ts pour le contexte complet).
 *
 * Reproduit le SCÉNARIO 3 (fallback recherche cloud, qui avait bloqué au
 * 4ème essai précédent lors de la création répétée de la carte "ancre"
 * locale non délivrée) avec deux boucles répétées :
 *
 *   A. Création RÉPÉTÉE de la carte ancre locale non délivrée (celle qui
 *      bloquait spécifiquement au 4ème essai précédent) — vérification
 *      SELECT COUNT(*) après CHAQUE création, pas seulement à la fin.
 *   B. Plusieurs cartes ZZTEST_ différentes posées uniquement côté cloud,
 *      recherchées, rapatriées une à une via searchCloudEmergency +
 *      "Rapatrier", avec vérification de l'atterrissage local après CHAQUE
 *      rapatriement.
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
function execDb(dbPath: string, sql: string): void {
  execFileSync('sqlite3', [dbPath, sql], { encoding: 'utf-8' });
}

const RUN_ID = Date.now();
const ANCHOR_REPEAT_COUNT = 8;
const FALLBACK_CARD_COUNT = 6;

test.describe.serial('P0 CONFIRMATION — ancre répétée + fallback recherche cloud multi-cartes (QA Terrain agent-13, run 5)', () => {
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
  });

  test.afterAll(async () => {
    if (env) {
      try {
        execDb(dbPath, "DELETE FROM t_cartes WHERE noms LIKE 'ZZTEST_%';");
        execDb(dbPath, "DELETE FROM audit_logs WHERE details LIKE '%ZZTEST%';");
        execDb(dbPath, "DELETE FROM t_logs WHERE detail LIKE '%ZZTEST%';");
      } catch (e) {
        console.warn('[E2E-CLOUD] Nettoyage local ZZTEST_ échoué (non bloquant) :', e);
      }
      await teardownSeededApp(env, anyTestFailed);
    }
    const residual = await cleanupAllCloudTestData();
    console.log(
      `[E2E-CLOUD][NETTOYAGE FINAL] Résidus ZZTEST_ après DELETE + re-SELECT -> ` +
      `cartes=${residual.residualCartes} centres=${residual.residualCentres} sites=${residual.residualSites} (attendu : 0/0/0)`
    );
    expect(residual.residualCartes).toBe(0);
    expect(residual.residualCentres).toBe(0);
    expect(residual.residualSites).toBe(0);
  });

  test.afterEach(async ({}, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus) anyTestFailed = true;
  });

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

  test(`A. Création répétée (${ANCHOR_REPEAT_COUNT}x) de la carte ancre locale non délivrée, COUNT vérifié après CHAQUE création`, async () => {
    const { window } = env;
    await login();

    let runningTotal = 0;
    for (let i = 1; i <= ANCHOR_REPEAT_COUNT; i++) {
      const numSecu = `ZZTEST-NUMSECU-ANCHOR-${RUN_ID}-${i}`;
      const before = queryDb(dbPath, "SELECT COUNT(*) FROM t_cartes WHERE noms='ZZTEST_ANCHOR';");
      expect(Number(before)).toBe(runningTotal);

      const created = await window.evaluate(
        async ({ siteId, centreId, numSecu, i }) => {
          return (window as any).api.cartes.create({
            noms: 'ZZTEST_ANCHOR',
            prenoms: `LOCALE${i}`,
            date_de_naissance: '1980-01-01',
            rangement: `A${i}`,
            statut: 'EN STOCK',
            site_id: siteId,
            centre_id: centreId,
            contact: `010203040${i}`,
            num_secu: numSecu,
            agent_saisie: 'E2E_OPERATEUR_VERIFICATION'
          });
        },
        { siteId: mainSiteId, centreId: mainCentreId, numSecu, i }
      );
      runningTotal++;

      const after = queryDb(dbPath, "SELECT COUNT(*) FROM t_cartes WHERE noms='ZZTEST_ANCHOR';");
      console.log(`[QA-CHECK][Ancre ${i}/${ANCHOR_REPEAT_COUNT}] sync_id=${created.sync_id} -> COUNT(noms=ZZTEST_ANCHOR) = ${after} (attendu : ${runningTotal})`);
      expect(Number(after)).toBe(runningTotal);

      const integrityCheck = queryDb(dbPath, 'PRAGMA integrity_check;');
      expect(integrityCheck).toBe('ok');
    }

    console.log(`[QA-CHECK] ${ANCHOR_REPEAT_COUNT}/${ANCHOR_REPEAT_COUNT} créations d'ancre réussies sans incident, aucune perte, aucune corruption.`);
  });

  test(`B. ${FALLBACK_CARD_COUNT} cartes posées uniquement côté cloud -> recherche/fallback/rapatriement un à un, vérif après CHAQUE rapatriement`, async () => {
    const { window } = env;

    for (let i = 1; i <= FALLBACK_CARD_COUNT; i++) {
      const syncId = `zztest-cloud-fallback-r${i}-${RUN_ID}`;
      const noms = `ZZTEST_CLOUDFB_R${i}`;
      const prenoms = `BAKARY${i}`;
      const ddn = `199${i % 9}-0${(i % 9) + 1}-1${i % 9}`;
      const [yyyy, mm, dd] = ddn.split('-');
      const ddnFr = `${dd}/${mm}/${yyyy}`;

      console.log(`\n[QA-CHECK][Fallback ${i}/${FALLBACK_CARD_COUNT}] === DÉBUT (sync_id=${syncId}) ===`);

      await insertCloudCard({
        sync_id: syncId,
        noms,
        prenoms,
        date_naissance: ddn,
        rangement: `F${i}`,
        statut: 'EN STOCK',
        id_site: mainSiteId,
        id_centre: mainCentreId,
        contact: `010203041${i}`,
        num_secu: `ZZTEST-NUMSECU-FB-${RUN_ID}-${i}`
      });

      const localBefore = queryDb(dbPath, `SELECT COUNT(*) FROM t_cartes WHERE sync_id='${syncId}';`);
      expect(Number(localBefore)).toBe(0);

      await window.getByRole('link', { name: 'Recherche Active' }).click();
      await window.waitForURL(/#\/agent-verification\/recherche/, { timeout: 15000 });
      await window.locator('input[placeholder="Ex: KOFFI KOFFI KAN"]').fill(`${noms} ${prenoms}`);
      await window.locator('input[placeholder="JJ/MM/AAAA"]').fill(ddnFr);
      await window.getByRole('button', { name: /Rechercher la Carte/ }).click();

      await expect(window.getByText('Trouvée sur le Cloud')).toBeVisible({ timeout: 15000 });
      await expect(window.getByText(noms)).toBeVisible();
      const rapatrierButton = window.getByRole('button', { name: /Rapatrier/ });
      await expect(rapatrierButton).toBeVisible();

      await rapatrierButton.click();

      await expect(deliveryModal()).toBeVisible({ timeout: 15000 });
      await expect(deliveryModal()).toContainText(noms);

      const localAfter = queryDb(
        dbPath,
        `SELECT noms, prenoms, date_de_naissance, rangement, statut, site_id, centre_id, is_dirty FROM t_cartes WHERE sync_id='${syncId}';`
      );
      console.log(`[QA-CHECK][Fallback ${i}] Ligne SQLite locale après rapatriement -> "${localAfter}"`);
      expect(localAfter).toBe(`${noms}|${prenoms}|${ddn}|F${i}|EN STOCK|${mainSiteId}|${mainCentreId}|0`);

      const integrityCheck = queryDb(dbPath, 'PRAGMA integrity_check;');
      expect(integrityCheck).toBe('ok');

      await window.locator('.btn-close').click();
      console.log(`[QA-CHECK][Fallback ${i}/${FALLBACK_CARD_COUNT}] === OK, rapatriement conforme ===`);
    }

    console.log(`\n[QA-CHECK] ${FALLBACK_CARD_COUNT}/${FALLBACK_CARD_COUNT} rapatriements fallback réussis sans incident.`);
  });
});
