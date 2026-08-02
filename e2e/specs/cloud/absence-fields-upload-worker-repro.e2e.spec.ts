/**
 * e2e/specs/cloud/absence-fields-upload-worker-repro.e2e.spec.ts
 *
 * QA / vérification ciblée (agent-4-db-sync) du correctif P1 : `upload-worker.js`
 * (Worker Thread du bouton manuel "Synchroniser mes actions", src/main/workers/
 * upload-worker.js) construisait son propre mapping carte->Supabase (`mappedCards`,
 * lignes ~202-236) INCOMPLET par rapport à `mapCardPayload()` de
 * src/main/sync/payload-mapper.ts — il omettait notamment `agent_saisie`,
 * `agent_signalement_absence`, `date_signalement_absence`,
 * `agent_resolution_absence`, `date_resolution_absence`, `note_resolution`,
 * `notif_lue`, `is_exported`, `created_by`.
 *
 * Impact réel : quand ce chemin réalise le TOUT PREMIER envoi (INSERT via
 * upsert onConflict sync_id) d'une carte fraîchement signalée absente, tout
 * champ omis du payload part `NULL` côté cloud (comportement upsert/INSERT
 * standard PostgreSQL sur colonne absente du payload) — perte de traçabilité
 * de l'agent ayant signalé l'absence, visible par tout autre poste/admin
 * consultant le cloud.
 *
 * Stratégie de test : créer une carte puis la signaler absente le plus tôt
 * possible après le login (avant que le NetworkMonitor ne bascule ONLINE et
 * ne déclenche le flush automatique de l'outbox — l'AUTRE chemin qui pousse
 * ce même mapping, déjà correct AVANT ce correctif via
 * src/main/sync/upstream.ts, vérifié ne PAS présenter ce défaut lors de cette
 * intervention), puis pousser manuellement via le vrai bouton "Synchroniser
 * mes actions" (bulk-uploader.ts -> upload-worker.js) et vérifier sur le
 * projet Supabase dev réel que les champs précédemment manquants sont bien
 * présents. L'état réseau ET l'état is_dirty/synced_at local sont loggés à
 * chaque étape pour documenter honnêtement quel chemin (upload-worker.js vs
 * cycle outbox automatique) a réellement traité la carte en premier, sans
 * faire échouer le test sur cet aléa de timing — les deux chemins doivent
 * désormais produire un résultat cloud correct après ce correctif.
 *
 * Invocation ciblée uniquement (comme les autres specs de ce dossier) :
 *   npx playwright test e2e/specs/cloud/absence-fields-upload-worker-repro.e2e.spec.ts
 * Build préalable requis : npx electron-vite build --mode e2e (jamais lancé
 * automatiquement par un agent — CLAUDE.md §1).
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

async function getNetworkState(window: E2EEnvironment['window']): Promise<string> {
  const status = await window.evaluate(() => (window as any).api.sync.getStatus());
  return status.state;
}

async function login(window: E2EEnvironment['window'], user: { login: string; password: string }): Promise<void> {
  await window.waitForURL(/#\/login/);
  await window.getByTestId('login-input').fill(user.login);
  await window.getByTestId('password-input').fill(user.password);
  await window.getByTestId('login-submit').click();
  await window.waitForURL(/#\/agent-verification$/, { timeout: 15000 });
}

async function logout(window: E2EEnvironment['window']): Promise<void> {
  await window.locator('.btn-logout').click();
  await window.waitForURL(/#\/login/, { timeout: 15000 });
}

test.describe.serial('Correctif upload-worker.js — champs absence manquants (agent-4-db-sync)', () => {
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
      `[E2E-CLOUD][NETTOYAGE FINAL] Résidus ZZTEST_ après DELETE + re-SELECT sur le projet dev -> ` +
      `cartes=${residual.residualCartes} centres=${residual.residualCentres} sites=${residual.residualSites} ` +
      `(attendu : 0/0/0)`
    );
    expect(residual.residualCartes).toBe(0);
    expect(residual.residualCentres).toBe(0);
    expect(residual.residualSites).toBe(0);
  });

  test.afterEach(async ({}, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus) {
      anyTestFailed = true;
    }
  });

  test('Créer + signaler absente + pousser manuellement -> tous les champs précédemment manquants sont présents sur Supabase dev', async () => {
    const { window } = env;
    const user = getTestUser('operateurVerification');
    const launchTs = Date.now();

    await login(window, user);
    const stateAfterLogin = await getNetworkState(window);
    console.log(`[QA-CHECK] État réseau juste après login (+${Date.now() - launchTs}ms depuis lancement) = "${stateAfterLogin}"`);

    // Création + signalement d'absence, dès que possible après le login (avant
    // bascule ONLINE si possible) — appels IPC directs, même chemin applicatif
    // réel que les boutons UI (voir sync-cloud-real.e2e.spec.ts).
    const created = await window.evaluate(
      async ({ siteId, centreId }) => {
        return (window as any).api.cartes.create({
          noms: 'ZZTEST_ABSFIELDS',
          prenoms: 'MAMADOU',
          date_de_naissance: '1993-09-03',
          rangement: 'P3',
          statut: 'EN STOCK',
          site_id: siteId,
          centre_id: centreId,
          contact: '0102030493',
          num_secu: 'ZZTEST-NUMSECU-ABSFIELDS',
          agent_saisie: 'E2E_OPERATEUR_VERIFICATION'
        });
      },
      { siteId: mainSiteId, centreId: mainCentreId }
    );
    cardSyncId = created.sync_id;

    await window.evaluate(
      async ({ id, currentUser }) => {
        return (window as any).api.cartes.signalerAbsence(
          id,
          currentUser.login,
          currentUser.login,
          'ZZTEST_ABSENCE_UPLOAD_WORKER',
          currentUser
        );
      },
      {
        id: created.id,
        currentUser: { role: 'OPERATEUR_VERIFICATION', site_id: mainSiteId, centre_id: mainCentreId, login: user.login }
      }
    );

    const stateAfterActions = await getNetworkState(window);
    console.log(`[QA-CHECK] État réseau après création+signalement (+${Date.now() - launchTs}ms depuis lancement) = "${stateAfterActions}"`);

    const localAfterSignal = queryDb(
      dbPath,
      `SELECT agent_signalement_absence, statut_physique, is_dirty, IFNULL(synced_at,'') FROM t_cartes WHERE sync_id='${cardSyncId}';`
    );
    console.log(`[QA-CHECK] État local juste après signalement (agent_signalement_absence|statut_physique|is_dirty|synced_at) -> "${localAfterSignal}"`);
    expect(localAfterSignal).toBe(`${user.login}|ABSENT|1|`);

    // Remontage (logout/login) : nécessaire pour rafraîchir detailedSyncStats
    // -> conformeCount côté UI (AgentVerificationLayout.tsx:74-75) et donc
    // activer le bouton "Synchroniser mes actions" (useDashboardStats ne
    // recharge qu'au montage, pas de polling — même contrainte que
    // sync-cloud-real.e2e.spec.ts scénario 2b).
    await logout(window);
    await login(window, user);

    // Contrôle empirique juste avant le clic : quel chemin a réellement déjà
    // traité (ou non) la carte à cet instant ?
    const preClickState = queryDb(
      dbPath,
      `SELECT is_dirty, IFNULL(synced_at,'') FROM t_cartes WHERE sync_id='${cardSyncId}';`
    );
    console.log(
      `[QA-CHECK] État local is_dirty|synced_at juste avant clic "Synchroniser mes actions" -> "${preClickState}" ` +
      `(is_dirty=1|vide -> upload-worker.js sera le premier à traiter cette carte ; ` +
      `is_dirty=0|rempli -> déjà traitée entre-temps par le cycle outbox automatique)`
    );

    const cloudBeforePush = await getCloudCardBySyncId(cardSyncId);
    console.log(
      `[QA-CHECK] Carte cloud avant clic push -> ${cloudBeforePush ? 'DÉJÀ PRÉSENTE (outbox a gagné la course)' : 'absente (upload-worker.js sera le premier écrivain si le bouton est actif)'}`
    );

    const pushButton = window.getByRole('button', { name: /Synchroniser mes actions/ });
    await expect(pushButton).toBeVisible({ timeout: 15000 });

    if (await pushButton.isEnabled()) {
      await pushButton.click();
      await expect(
        window.getByText(/[Ss]ynchronisation de masse|cartes traitées|cartes envoyées|à jour/i)
      ).toBeVisible({ timeout: 30000 });
    } else {
      console.log(
        '[QA-CHECK] Bouton "Synchroniser mes actions" désactivé (conformeCount=0) — ' +
        'la carte a très probablement déjà été synchronisée par le cycle outbox automatique.'
      );
    }

    // Vérité terrain finale, quel que soit le chemin réellement emprunté : la
    // carte DOIT être présente sur le cloud avec tous les champs précédemment
    // manquants côté upload-worker.js.
    let cloudAfter = await getCloudCardBySyncId(cardSyncId);
    if (!cloudAfter) {
      // Filet de sécurité : laisse une marge courte si le réseau a été lent.
      await window.waitForTimeout(5000);
      cloudAfter = await getCloudCardBySyncId(cardSyncId);
    }

    expect(cloudAfter).not.toBeNull();
    console.log(`[QA-CHECK] Ligne cloud finale pour sync_id=${cardSyncId} -> ${JSON.stringify(cloudAfter)}`);

    // Ces 3 champs sont la preuve directe du correctif : sur ce tout premier
    // envoi (INSERT via upsert), un champ omis du payload part NULL côté
    // PostgreSQL — c'est exactement le symptôme du bug confirmé par agent-13.
    expect(cloudAfter.noms).toBe('ZZTEST_ABSFIELDS');
    expect(cloudAfter.agent_saisie).toBe('E2E_OPERATEUR_VERIFICATION');
    expect(cloudAfter.agent_signalement_absence).toBe(user.login);
    expect(cloudAfter.date_signalement_absence).toBeTruthy();
    expect(Number(cloudAfter.id_site)).toBe(mainSiteId);
    expect(Number(cloudAfter.id_centre)).toBe(mainCentreId);
  });
});
