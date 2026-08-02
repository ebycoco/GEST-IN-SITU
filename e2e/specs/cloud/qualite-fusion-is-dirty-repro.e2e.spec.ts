/**
 * e2e/specs/cloud/qualite-fusion-is-dirty-repro.e2e.spec.ts
 *
 * Reproduction ciblée (agent-4-db-sync) du bug P1 remonté par le test QA
 * vivant agent-13 sur le portail Qualité : après une fusion de doublons
 * (`qualite:fusionnerDoublons`, handlers.ts ~l.1616-1651) synchronisée avec
 * SUCCÈS vers Supabase via `t_outbox` (statut SYNCED confirmé), la carte
 * cible locale garde `is_dirty = 1` indéfiniment.
 *
 * Cause : `processOutboxPending()` (outbox.service.ts) ne remettait JAMAIS
 * `is_dirty` à 0 sur la table locale après un upsert réussi — contrairement à
 * `upload-worker.js:272` qui le fait pour son propre chemin (bulk upload
 * manuel, "Envoyer les corrections"). La fusion transite exclusivement par
 * l'outbox (jamais par le bulk upload — voir le commentaire détaillé en tête
 * de qualite-offline-sync-real.e2e.spec.ts), donc jamais nettoyée.
 *
 * Conséquence observée en conditions réelles : `stats:getUnsyncedConformeCardsCount`
 * compte cette carte comme "en attente" et le bandeau "corrections en attente"
 * du portail Qualité reste affiché à tort pour une carte déjà réellement
 * synchronisée.
 *
 * Comme les autres specs `allowRealSync: true` de ce dossier, invocation
 * ciblée uniquement (jamais via `npm run test:e2e`, dont le hook
 * `pretest:e2e` reconstruirait `dist/` sans effet sur `dist-e2e-cloud/`) :
 *   npx playwright test e2e/specs/cloud/qualite-fusion-is-dirty-repro.e2e.spec.ts
 * Build préalable : npx electron-vite build --mode e2e (jamais lancé
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

test.describe.serial('[REPRO] qualite:fusionnerDoublons -> outbox SYNCED -> is_dirty local jamais remis à 0', () => {
  let env: E2EEnvironment;
  let dbPath: string;
  let mainSiteId: number;
  let mainCentreId: number;
  let targetId: number;
  let targetSyncId: string;
  let sourceId: number;
  let sourceSyncId: string;
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

  test('Fusion réelle -> outbox SYNCED confirmé -> is_dirty local doit repasser à 0 sur la carte cible', async () => {
    const { window } = env;

    const user = getTestUser('operateurQualite');
    await window.waitForURL(/#\/login/);
    await window.getByTestId('login-input').fill(user.login);
    await window.getByTestId('password-input').fill(user.password);
    await window.getByTestId('login-submit').click();
    await window.waitForURL(/#\/agent-qualite/, { timeout: 15000 });

    // Carte CIBLE : num_secu vide -> recevra le merge depuis la source.
    const target = await window.evaluate(
      async ({ siteId, centreId }) => {
        return (window as any).api.cartes.create({
          noms: 'ZZTEST_FUSIONDIRTY',
          prenoms: 'CIBLE',
          date_de_naissance: '1990-01-01',
          rangement: 'NON CLASSE',
          statut: 'EN STOCK',
          site_id: siteId,
          centre_id: centreId,
          contact: '0100000001',
          agent_saisie: 'E2E_OPERATEUR_QUALITE'
        });
      },
      { siteId: mainSiteId, centreId: mainCentreId }
    );
    targetId = target.id;
    targetSyncId = target.sync_id;

    // Carte SOURCE (doublon) : porte le num_secu qui va être fusionné vers la cible.
    const source = await window.evaluate(
      async ({ siteId, centreId }) => {
        return (window as any).api.cartes.create({
          noms: 'ZZTEST_FUSIONDIRTY',
          prenoms: 'SOURCE',
          date_de_naissance: '1990-01-01',
          rangement: 'R7',
          statut: 'EN STOCK',
          site_id: siteId,
          centre_id: centreId,
          contact: '0100000002',
          num_secu: 'ZZTEST-NUMSECU-FUSIONDIRTY',
          agent_saisie: 'E2E_OPERATEUR_QUALITE'
        });
      },
      { siteId: mainSiteId, centreId: mainCentreId }
    );
    sourceId = source.id;
    sourceSyncId = source.sync_id;

    expect(Number(queryDb(dbPath, `SELECT COUNT(*) FROM t_cartes WHERE sync_id='${targetSyncId}';`))).toBe(1);
    expect(Number(queryDb(dbPath, `SELECT COUNT(*) FROM t_cartes WHERE sync_id='${sourceSyncId}';`))).toBe(1);

    // Fusion réelle via le VRAI handler IPC (comme DoublonsView.tsx).
    const fusionResult = await window.evaluate(
      async ({ id_carte_source, id_carte_cible }) => {
        return (window as any).api.qualite.fusionnerDoublons({
          id_carte_source,
          id_carte_cible,
          champs_fusionnes: ['num_secu', 'rangement']
        });
      },
      { id_carte_source: sourceId, id_carte_cible: targetId }
    );
    console.log(`[REPRO] Résultat qualite:fusionnerDoublons -> ${JSON.stringify(fusionResult)}`);

    // Juste après la fusion (avant tout traitement outbox), la cible DOIT être
    // marquée is_dirty=1 avec les champs mergés (comportement attendu, inchangé).
    const stateAfterMerge = queryDb(dbPath, `SELECT num_secu, rangement, is_dirty FROM t_cartes WHERE id_carte=${targetId};`);
    console.log(`[REPRO] État cible juste après fusion (avant sync) -> "${stateAfterMerge}" (attendu : ZZTEST-NUMSECU-FUSIONDIRTY|R7|1)`);
    expect(stateAfterMerge).toBe('ZZTEST-NUMSECU-FUSIONDIRTY|R7|1');

    // Attente de la confirmation SYNCED en t_outbox pour l'entrée UPDATE de la
    // cible (id = son sync_id, cf. enqueueOutbox(updatedTarget.sync_id, ...)).
    // Fenêtre large (comme delivrer-carte-outbox-repro) : le NetworkMonitor ne
    // passe ONLINE qu'après son 1er ping (~5s), potentiellement jusqu'à ~35-40s
    // après le démarrage de l'app.
    let outboxRow = '';
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      outboxRow = queryDb(dbPath, `SELECT status, error_msg FROM t_outbox WHERE id='${targetSyncId}';`);
      if (outboxRow && !outboxRow.startsWith('PENDING')) break;
      await window.waitForTimeout(2000);
    }
    console.log(`[REPRO] Ligne t_outbox (id=sync_id cible=${targetSyncId}) après traitement -> "${outboxRow}"`);
    expect(outboxRow.startsWith('SYNCED')).toBe(true);

    // Preuve définitive côté cloud : la carte cible porte bien les champs fusionnés.
    const cloudCard = await getCloudCardBySyncId(targetSyncId);
    console.log(
      `[REPRO] Carte cible sur Supabase dev (sync_id=${targetSyncId}) -> ` +
      `${cloudCard ? JSON.stringify({ num_secu: cloudCard.num_secu, rangement: cloudCard.rangement }) : 'ABSENTE (null)'}`
    );
    expect(cloudCard).not.toBeNull();
    expect(cloudCard.num_secu).toBe('ZZTEST-NUMSECU-FUSIONDIRTY');
    expect(cloudCard.rangement).toBe('R7');

    // ── Le coeur du bug ──────────────────────────────────────────────────────
    // AVANT correctif : is_dirty reste à 1 indéfiniment côté local malgré la
    // synchronisation réussie confirmée ci-dessus (SYNCED + valeurs cloud
    // correctes) -> la carte reste comptée à tort comme "en attente" par
    // stats:getUnsyncedConformeCardsCount. APRÈS correctif : is_dirty doit
    // repasser à 0 et synced_at doit être renseigné.
    const finalState = queryDb(dbPath, `SELECT is_dirty, synced_at FROM t_cartes WHERE id_carte=${targetId};`);
    console.log(`[REPRO] État local FINAL de la cible (is_dirty|synced_at) -> "${finalState}" (attendu APRÈS correctif : 0|<timestamp>)`);
    const [isDirtyFinal, syncedAtFinal] = finalState.split('|');
    expect(isDirtyFinal).toBe('0');
    expect(syncedAtFinal).not.toBe('');
  });
});
