/**
 * e2e/specs/cloud/scenario2-repeat-10x.e2e.spec.ts
 *
 * QA Terrain (agent-13) — 5ème passage, CONFIRMATION FINALE du P0 découvert
 * au run précédent (perte silencieuse de carte pendant un vrai cycle de sync
 * Supabase, INSERT confirmé par les logs mais SELECT COUNT(*)=0 juste après).
 *
 * Deux correctifs ont depuis été appliqués (src/main/index.ts:
 * `ready-to-show` -> `.once(...)`, src/main/sync/downstream.ts: gardes
 * PRAGMA foreign_keys OFF/ON + verrou de réentrance sur
 * `preloadUsersFromCloud()`). agent-5 a rejoué une charge plus légère (300
 * cartes, 5 créations concurrentes) sans rien reproduire, mais recommande
 * explicitement de rejouer le protocole d'origine à charge comparable.
 *
 * Ce spec reproduit fidèlement le SCÉNARIO 2 (push, celui qui avait bloqué)
 * de sync-cloud-real.e2e.spec.ts, mais en boucle SÉRIE d'AU MOINS 10
 * cycles create+deliver+push complets, avec vérification DB locale ET
 * distante APRÈS CHAQUE cycle (pas seulement à la fin) — c'est exactement
 * le protocole qui avait fait apparaître la perte de données 4 fois lors
 * de l'investigation d'origine (agent-4-db-sync, ~1600 cycles).
 *
 * Toute perte silencieuse (INSERT confirmé localement mais absent après un
 * push, OU disparition pure et simple d'une carte déjà confirmée à un tour
 * précédent) interrompt la boucle IMMÉDIATEMENT et fait échouer le test avec
 * le détail exact du tour en cause.
 */
import { test, expect } from '@playwright/test';
import { launchSeededApp, teardownSeededApp, type E2EEnvironment } from '../../fixtures/electron-app';
import { getTestUser } from '../../fixtures/test-users';
import {
  ensureCloudSiteAndCentre,
  getCloudCardBySyncId,
  cleanupAllCloudTestData
} from '../../fixtures/supabase-dev-client';
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
const REPEAT_COUNT = 10;

test.describe.serial('P0 CONFIRMATION — 10x create+deliver+push en série (QA Terrain agent-13, run 5)', () => {
  let env: E2EEnvironment;
  let dbPath: string;
  let mainSiteId: number;
  let mainCentreId: number;
  let anyTestFailed = false;
  // Trace de TOUTES les cartes poussées avec succès aux tours précédents,
  // pour re-vérifier à CHAQUE tour suivant qu'elles n'ont pas disparu
  // silencieusement de la base locale (pas seulement la carte du tour courant).
  const pushedSyncIds: string[] = [];

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

  async function logout(): Promise<void> {
    const { window } = env;
    await window.locator('.btn-logout').click();
    await window.waitForURL(/#\/login/, { timeout: 15000 });
  }

  async function goToRecherche(): Promise<void> {
    const { window } = env;
    await window.getByRole('link', { name: 'Recherche Active' }).click();
    await window.waitForURL(/#\/agent-verification\/recherche/, { timeout: 15000 });
  }

  test(`Boucle série de ${REPEAT_COUNT} cycles create+deliver+push avec vérif DB locale+cloud après CHAQUE tour`, async () => {
    const { window } = env;
    await login();

    for (let i = 1; i <= REPEAT_COUNT; i++) {
      const noms = `ZZTEST_CLOUDPUSH_R${i}`;
      const prenoms = `ADAMA${i}`;
      const numSecu = `ZZTEST-NUMSECU-PUSH-${RUN_ID}-${i}`;
      // Calculée AVANT l'appel IPC et réutilisée telle quelle pour la recherche UI :
      // `cartes:create` (cartes.queries.ts:240 `createCarte`) ne retourne que
      // `{ id, sync_id }`, jamais les champs métier saisis.
      const ddn = `199${i % 10}-0${(i % 9) + 1}-1${i % 9}`;
      const [yyyy, mm, dd] = ddn.split('-');
      const ddnFr = `${dd}/${mm}/${yyyy}`;
      console.log(`\n[QA-CHECK][Tour ${i}/${REPEAT_COUNT}] === DÉBUT ===`);

      // ── 1. Création via le vrai chemin applicatif cartes:create ──
      const created = await window.evaluate(
        async ({ siteId, centreId, noms, prenoms, numSecu, ddn, i }) => {
          return (window as any).api.cartes.create({
            noms,
            prenoms,
            date_de_naissance: ddn,
            rangement: `P${i}`,
            statut: 'EN STOCK',
            site_id: siteId,
            centre_id: centreId,
            contact: `01020304${90 + i}`,
            num_secu: numSecu,
            agent_saisie: 'E2E_OPERATEUR_VERIFICATION'
          });
        },
        { siteId: mainSiteId, centreId: mainCentreId, noms, prenoms, numSecu, ddn, i }
      );
      const syncId: string = created.sync_id;

      const seededCheck = queryDb(dbPath, `SELECT COUNT(*) FROM t_cartes WHERE sync_id='${syncId}';`);
      console.log(`[QA-CHECK][Tour ${i}] Après INSERT local -> COUNT(sync_id=${syncId}) = ${seededCheck} (attendu : 1)`);
      expect(Number(seededCheck)).toBe(1);

      // ── 2. Vérification physique + délivrance via l'UI réelle ──

      await goToRecherche();
      await window.locator('input[placeholder="Ex: KOFFI KOFFI KAN"]').fill(`${noms} ${prenoms}`);
      await window.locator('input[placeholder="JJ/MM/AAAA"]').fill(ddnFr);
      await window.getByRole('button', { name: /Rechercher la Carte/ }).click();

      await expect(window.getByText('Vérification Physique')).toBeVisible({ timeout: 10000 });
      await window.getByRole('button', { name: /Oui, j'ai la carte/ }).click();
      await expect(window.getByText('Validation du Retrait')).toBeVisible();
      await window.getByRole('button', { name: /Valider la délivrance/ }).click();
      await expect(window.getByText('Carte délivrée avec succès !')).toBeVisible({ timeout: 10000 });

      const afterDeliver = queryDb(dbPath, `SELECT statut, is_dirty, rangement FROM t_cartes WHERE sync_id='${syncId}';`);
      console.log(`[QA-CHECK][Tour ${i}] État local après délivrance -> "${afterDeliver}" (attendu : DELIVRE|1|P${i})`);
      expect(afterDeliver).toBe(`DELIVRE|1|P${i}`);

      const dupCheck = queryDb(
        dbPath,
        `SELECT COUNT(*) FROM t_cartes WHERE site_id=${mainSiteId} AND noms='${noms}' AND prenoms='${prenoms}' AND date_de_naissance='${ddn}';`
      );
      expect(Number(dupCheck)).toBe(1);

      // ── 3. Ré-authentification (remontage Layout -> loadStats frais) ──
      await logout();
      await login();

      const pushButton = window.getByRole('button', { name: /Synchroniser mes actions/ });
      await expect(pushButton).toBeVisible({ timeout: 15000 });
      await expect(pushButton).toHaveText(/Synchroniser mes actions \(\d+\)/, { timeout: 20000 });
      const label = await pushButton.textContent();
      const conformeCount = Number((label?.match(/\((\d+)\)/) || ['', '0'])[1]);
      console.log(`[QA-CHECK][Tour ${i}] conformeCount affiché avant push = ${conformeCount} (attendu : >= 1)`);
      expect(conformeCount).toBeGreaterThan(0);
      await expect(pushButton).toBeEnabled();

      const cloudBefore = await getCloudCardBySyncId(syncId);
      expect(cloudBefore).toBeNull();

      // ── 4. Push réel ──
      await pushButton.click();
      await expect(window.getByText(/[Ss]ynchronisation de masse|cartes traitées|cartes envoyées|à jour/i)).toBeVisible({ timeout: 30000 });

      const localAfterPush = queryDb(dbPath, `SELECT COUNT(*), COALESCE(MAX(is_dirty),-1) FROM t_cartes WHERE sync_id='${syncId}';`);
      console.log(`[QA-CHECK][Tour ${i}] Local après push -> COUNT|is_dirty = "${localAfterPush}" (attendu : 1|0)`);
      expect(localAfterPush).toBe('1|0');

      const cloudAfter = await getCloudCardBySyncId(syncId);
      console.log(
        `[QA-CHECK][Tour ${i}] Cloud après push -> ${cloudAfter ? `noms=${cloudAfter.noms} statut=${cloudAfter.statut}` : 'NULL (PERTE !)'}`
      );
      expect(cloudAfter).not.toBeNull();
      expect(cloudAfter.noms).toBe(noms);
      expect(cloudAfter.prenoms).toBe(prenoms);
      expect(cloudAfter.statut).toBe('DELIVRE');
      expect(Number(cloudAfter.id_site)).toBe(mainSiteId);
      expect(Number(cloudAfter.id_centre)).toBe(mainCentreId);

      pushedSyncIds.push(syncId);

      // ── 5. RE-VÉRIFICATION de TOUTES les cartes des tours précédents ──
      // (détecte une disparition différée, pas seulement au moment du push)
      for (const prevSyncId of pushedSyncIds) {
        const stillThere = queryDb(dbPath, `SELECT COUNT(*) FROM t_cartes WHERE sync_id='${prevSyncId}';`);
        if (Number(stillThere) !== 1) {
          console.error(`[QA-CHECK][Tour ${i}] !!! DISPARITION DIFFÉRÉE détectée pour sync_id=${prevSyncId} (COUNT=${stillThere}) !!!`);
        }
        expect(Number(stillThere)).toBe(1);
      }

      const integrityCheck = queryDb(dbPath, 'PRAGMA integrity_check;');
      console.log(`[QA-CHECK][Tour ${i}] integrity_check = "${integrityCheck}" (attendu : ok)`);
      expect(integrityCheck).toBe('ok');

      console.log(`[QA-CHECK][Tour ${i}/${REPEAT_COUNT}] === OK, aucune perte, aucune corruption ===`);
    }

    console.log(`\n[QA-CHECK] ${REPEAT_COUNT}/${REPEAT_COUNT} cycles create+deliver+push réussis sans incident.`);
  });
});
