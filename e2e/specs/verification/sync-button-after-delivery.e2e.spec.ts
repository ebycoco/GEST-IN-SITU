/**
 * e2e/specs/verification/sync-button-after-delivery.e2e.spec.ts
 *
 * Régression ciblée du bug rapporté par l'utilisateur : après une délivrance
 * de carte par un OPERATEUR_VERIFICATION via RechercheView.tsx (route
 * `/agent-verification/recherche`), le bouton "Synchroniser mes actions"
 * (AgentVerificationLayout.tsx) restait désactivé tant que l'écran n'était
 * pas remonté manuellement — cause : RechercheView.tsx passait un
 * `loadStats` factice (`async () => {}`) à `useDeliveryFlow`, jamais la
 * vraie fonction du layout parent qui recalcule `detailedSyncStats`/
 * `conformeCount` (dont dépend l'état enabled/disabled du bouton).
 *
 * Correctif vérifié ici : AgentVerificationLayout.tsx expose désormais
 * `loadStats` via le contexte de l'Outlet (`refreshStats`), et
 * RechercheView.tsx le récupère via `useOutletContext` au lieu du mock.
 *
 * Contrairement à `verification-search.e2e.spec.ts` (test 17, qui insère ses
 * cartes ZZTEST_ directement en base et documente `conformeCount` comme
 * potentiellement non concluant pour ce jeu de données), ce spec crée sa
 * carte via le vrai chemin applicatif (`window.api.cartes.create`, comme
 * `delivrer-carte-outbox-repro.e2e.spec.ts`) pour obtenir un `cle_doublon`
 * réel et un `conformeCount` représentatif d'un poste terrain.
 *
 * Réseau désactivé (`launchSeededApp()` sans `allowRealSync`) : seul l'état
 * du bouton (enabled/disabled, dérivé de `detailedSyncStats` local) est
 * vérifié, pas un envoi réel vers Supabase.
 */
import { test, expect } from '@playwright/test';
import { launchSeededApp, teardownSeededApp, type E2EEnvironment } from '../../fixtures/electron-app';
import { getTestUser } from '../../fixtures/test-users';
import { execFileSync } from 'child_process';
import { join } from 'path';

function dbPathOf(userDataDir: string): string {
  return join(userDataDir, 'data', 'gest_in_situ.db');
}

function queryDb(dbPath: string, sql: string): string {
  return execFileSync('sqlite3', [dbPath, sql], { encoding: 'utf-8' }).trim();
}

test.describe.serial('[REGRESSION] Bouton "Synchroniser mes actions" après délivrance (RechercheView)', () => {
  let env: E2EEnvironment;
  let dbPath: string;
  let anyTestFailed = false;

  test.beforeAll(async () => {
    env = await launchSeededApp();
    dbPath = dbPathOf(env.userDataDir);
  });

  test.afterAll(async () => {
    if (env) {
      try {
        queryDb(dbPath, "DELETE FROM t_cartes WHERE noms LIKE 'ZZTEST_%';");
      } catch (e) {
        console.warn('[E2E] Nettoyage ZZTEST_ échoué (non bloquant) :', e);
      }
      await teardownSeededApp(env, anyTestFailed);
    }
  });

  test.afterEach(async ({}, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus) anyTestFailed = true;
  });

  test('Délivrance via RechercheView -> bouton "Synchroniser mes actions" actif SANS remonter l\'écran', async () => {
    const { window, seed } = env;
    const user = getTestUser('operateurVerification');

    await window.waitForURL(/#\/login/);
    await window.getByTestId('login-input').fill(user.login);
    await window.getByTestId('password-input').fill(user.password);
    await window.getByTestId('login-submit').click();
    await window.waitForURL(/#\/agent-verification$/, { timeout: 15000 });

    // Carte créée via le vrai chemin applicatif (cle_doublon calculé normalement,
    // contrairement à un INSERT SQL direct) pour un conformeCount représentatif.
    const created = await window.evaluate(
      async ({ siteId, centreId }) => {
        return (window as any).api.cartes.create({
          noms: 'ZZTEST_SYNCBTN',
          prenoms: 'REGRESSION',
          date_de_naissance: '1990-01-01',
          rangement: 'R1',
          statut: 'EN STOCK',
          site_id: siteId,
          centre_id: centreId,
          contact: '0102030405',
          num_secu: 'ZZTEST-NUMSECU-SYNCBTN',
          agent_saisie: 'E2E_OPERATEUR_VERIFICATION'
        });
      },
      { siteId: seed.siteId, centreId: seed.centreId }
    );
    expect(Number(queryDb(dbPath, `SELECT COUNT(*) FROM t_cartes WHERE sync_id='${created.sync_id}';`))).toBe(1);

    await window.getByRole('link', { name: 'Recherche Active' }).click();
    await window.waitForURL(/#\/agent-verification\/recherche/, { timeout: 15000 });

    const pushButton = window.getByRole('button', { name: /Synchroniser mes actions/ });
    await expect(pushButton).toBeVisible({ timeout: 10000 });

    await window.locator('input[placeholder="Ex: KOFFI KOFFI KAN"]').fill('ZZTEST_SYNCBTN REGRESSION');
    await window.locator('input[placeholder="JJ/MM/AAAA"]').fill('01/01/1990');
    await window.getByRole('button', { name: /Rechercher la Carte/ }).click();

    await expect(window.getByText('Vérification Physique')).toBeVisible({ timeout: 10000 });
    await window.getByRole('button', { name: /Oui, j'ai la carte/ }).click();
    await expect(window.getByText('Validation du Retrait')).toBeVisible();
    await window.getByRole('button', { name: /Valider la délivrance/ }).click();
    await expect(window.getByText('Carte délivrée avec succès !')).toBeVisible({ timeout: 10000 });

    const localState = queryDb(dbPath, `SELECT statut, is_dirty FROM t_cartes WHERE sync_id='${created.sync_id}';`);
    expect(localState).toBe('DELIVRE|1');

    // ── Assertion clé de la régression ──────────────────────────────────────
    // AVANT correctif : loadStats mock -> conformeCount jamais recalculé ->
    // bouton reste `disabled` ici, tant que l'écran n'est pas remonté.
    // APRÈS correctif : refreshStats (vrai loadStats) déclenché par
    // useDeliveryFlow -> conformeCount inclut la carte tout juste délivrée ->
    // bouton passe `enabled` SANS navigation ni remontage.
    await expect(pushButton).toBeEnabled({ timeout: 10000 });
  });
});
