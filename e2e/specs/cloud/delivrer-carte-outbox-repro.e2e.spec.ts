/**
 * e2e/specs/cloud/delivrer-carte-outbox-repro.e2e.spec.ts
 *
 * Reproduction ciblée (agent-4-db-sync) d'un bug trouvé pendant l'investigation
 * du P0 FTS5 : `delivrerCarte()` (cartes.queries.ts) enfile dans `t_outbox` un
 * payload MINIMAL `{ sync_id }` (sans `site_id`). `outbox.service.ts` applique
 * `mapCardPayload()` à ce payload lors de l'envoi immédiat/automatique, qui
 * rejette systématiquement faute de `site_id` -> l'entrée outbox part
 * définitivement en ERROR ("site_id manquant"), SANS jamais toucher Supabase
 * via ce chemin précis (immédiat, déclenché par `scheduleOutboxProcessing()`
 * juste après la délivrance).
 *
 * Ce test vérifie UNIQUEMENT ce chemin immédiat (lecture directe de la ligne
 * `t_outbox`, PAS le bouton "Synchronisation mes actions" qui utilise un
 * pipeline totalement séparé — upload-worker.js — déjà couvert par
 * sync-cloud-real.e2e.spec.ts et non affecté par ce bug).
 *
 * Comme les autres specs `allowRealSync: true` de ce dossier
 * (sync-cloud-real*.e2e.spec.ts), ce fichier n'est PAS destiné à tourner via
 * `npm run test:e2e` (son hook `pretest:e2e` reconstruirait `dist/`, sans
 * effet sur ce test qui dépend de `dist-e2e-cloud/`) — invocation ciblée
 * uniquement : `npx playwright test e2e/specs/cloud/delivrer-carte-outbox-repro.e2e.spec.ts`
 * (build préalable : `npx electron-vite build --mode e2e`, jamais lancé
 * automatiquement par un agent — CLAUDE.md §1).
 */
import { test, expect } from '@playwright/test';
import { launchSeededApp, teardownSeededApp, type E2EEnvironment } from '../../fixtures/electron-app';
import { getTestUser } from '../../fixtures/test-users';
import { ensureCloudSiteAndCentre, getCloudCardBySyncId, cleanupAllCloudTestData } from '../../fixtures/supabase-dev-client';
import { execFileSync } from 'child_process';
import { join } from 'path';

function dbPathOf(userDataDir: string): string {
  return join(userDataDir, 'data', 'gest_in_situ.db');
}

function queryDb(dbPath: string, sql: string): string {
  return execFileSync('sqlite3', [dbPath, sql], { encoding: 'utf-8' }).trim();
}

test.describe.serial('[REPRO] delivrerCarte() -> t_outbox payload minimal -> rejet site_id manquant', () => {
  let env: E2EEnvironment;
  let dbPath: string;
  let mainSiteId: number;
  let mainCentreId: number;
  let cardSyncId: string;
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
        execFileSync('sqlite3', [dbPath, "DELETE FROM t_cartes WHERE noms LIKE 'ZZTEST_%';"], { encoding: 'utf-8' });
      } catch (e) {
        console.warn('[REPRO] Nettoyage local ZZTEST_ échoué (non bloquant) :', e);
      }
      await teardownSeededApp(env, anyTestFailed);
    }
    const residual = await cleanupAllCloudTestData();
    console.log(
      `[REPRO][NETTOYAGE FINAL] Résidus ZZTEST_ après DELETE + re-SELECT -> ` +
      `cartes=${residual.residualCartes} centres=${residual.residualCentres} sites=${residual.residualSites} (attendu : 0/0/0)`
    );
    expect(residual.residualCartes).toBe(0);
    expect(residual.residualCentres).toBe(0);
    expect(residual.residualSites).toBe(0);
  });

  test.afterEach(async ({}, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus) anyTestFailed = true;
  });

  test('Délivrance réelle -> entrée t_outbox immédiate rejetée (ERROR, "site_id manquant") -> carte ABSENTE de Supabase dev', async () => {
    const { window } = env;

    const user = getTestUser('operateurVerification');
    await window.waitForURL(/#\/login/);
    await window.getByTestId('login-input').fill(user.login);
    await window.getByTestId('password-input').fill(user.password);
    await window.getByTestId('login-submit').click();
    await window.waitForURL(/#\/agent-verification$/, { timeout: 15000 });

    // Carte créée via le vrai chemin applicatif (cartes:create), comme
    // sync-cloud-real.e2e.spec.ts : évite toute seconde connexion SQLite
    // pendant que l'app allowRealSync tourne (corruption observée sinon).
    const created = await window.evaluate(
      async ({ siteId, centreId }) => {
        return (window as any).api.cartes.create({
          noms: 'ZZTEST_OUTBOXREPRO',
          prenoms: 'MOUSSA',
          date_de_naissance: '1993-03-03',
          rangement: 'R9',
          statut: 'EN STOCK',
          site_id: siteId,
          centre_id: centreId,
          contact: '0102030493',
          num_secu: 'ZZTEST-NUMSECU-OUTBOXREPRO',
          agent_saisie: 'E2E_OPERATEUR_VERIFICATION'
        });
      },
      { siteId: mainSiteId, centreId: mainCentreId }
    );
    cardSyncId = created.sync_id;
    expect(Number(queryDb(dbPath, `SELECT COUNT(*) FROM t_cartes WHERE sync_id='${cardSyncId}';`))).toBe(1);

    await window.getByRole('link', { name: 'Recherche Active' }).click();
    await window.waitForURL(/#\/agent-verification\/recherche/, { timeout: 15000 });
    await window.locator('input[placeholder="Ex: KOFFI KOFFI KAN"]').fill('ZZTEST_OUTBOXREPRO MOUSSA');
    await window.locator('input[placeholder="JJ/MM/AAAA"]').fill('03/03/1993');
    await window.getByRole('button', { name: /Rechercher la Carte/ }).click();

    await expect(window.getByText('Vérification Physique')).toBeVisible({ timeout: 10000 });
    await window.getByRole('button', { name: /Oui, j'ai la carte/ }).click();
    await expect(window.getByText('Validation du Retrait')).toBeVisible();
    await window.getByRole('button', { name: /Valider la délivrance/ }).click();
    await expect(window.getByText('Carte délivrée avec succès !')).toBeVisible({ timeout: 10000 });

    const localState = queryDb(dbPath, `SELECT statut, is_dirty FROM t_cartes WHERE sync_id='${cardSyncId}';`);
    console.log(`[REPRO] État local après délivrance -> "${localState}" (attendu : DELIVRE|1)`);
    expect(localState).toBe('DELIVRE|1');

    // L'entrée t_outbox est enfilée avec pour id le sync_id de la carte
    // (enqueueOutbox(carte.sync_id, ...) dans delivrerCarte()) -> requêtable
    // directement. Le rejet de validation ("site_id manquant") est immédiat
    // (synchrone, avant tout appel réseau) : s'il doit se produire, il est
    // visible en quelques secondes. En revanche, un succès réel dépend du
    // NetworkMonitor (network-monitor.ts: 1er ping à 5s, puis toutes les 30s
    // -> transition ONLINE possible jusqu'à ~35-40s après le démarrage), donc
    // on laisse une fenêtre large avant de conclure à un blocage.
    let outboxRow = '';
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      outboxRow = queryDb(dbPath, `SELECT status, error_msg FROM t_outbox WHERE id='${cardSyncId}';`);
      if (outboxRow && !outboxRow.startsWith('PENDING')) break;
      await window.waitForTimeout(2000);
    }
    console.log(`[REPRO] Ligne t_outbox (id=sync_id=${cardSyncId}) après traitement -> "${outboxRow}"`);

    // ── Comportement AVANT correctif attendu : ERROR|Erreur de validation de
    // la carte : site_id manquant. ── Comportement APRÈS correctif attendu :
    // status != ERROR (SYNCED, ou PENDING transitoire si offline probing).
    // On loggue dans les deux cas pour lecture humaine, et on vérifie l'état
    // cloud qui est la preuve définitive.
    const cloudCard = await getCloudCardBySyncId(cardSyncId);
    console.log(`[REPRO] Carte sur Supabase dev pour sync_id=${cardSyncId} -> ${cloudCard ? JSON.stringify({ statut: cloudCard.statut, id_site: cloudCard.id_site }) : 'ABSENTE (null)'}`);

    if (outboxRow.startsWith('ERROR')) {
      expect(outboxRow).toContain('site_id manquant');
      expect(cloudCard).toBeNull();
    } else {
      expect(cloudCard).not.toBeNull();
      expect(cloudCard.statut).toBe('DELIVRE');
      expect(Number(cloudCard.id_site)).toBe(mainSiteId);
    }
  });
});
