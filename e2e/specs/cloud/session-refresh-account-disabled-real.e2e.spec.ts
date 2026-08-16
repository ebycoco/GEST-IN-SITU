/**
 * e2e/specs/cloud/session-refresh-account-disabled-real.e2e.spec.ts
 *
 * QA Terrain (agent-13) — Scénario 2/4 : "compte désactivé pendant une
 * session active". Même protocole, mêmes garde-fous et même adaptation
 * mono-instance (contrainte RAM constatée empiriquement — voir
 * _session-refresh-shared.ts et le commentaire de tête de
 * session-refresh-role-removed-real.e2e.spec.ts) que les 3 autres scénarios.
 *
 * Spécificité de ce scénario : `syncUsersFromCloud()` filtre sa requête
 * Supabase avec `.eq('statut_actif', 1)` — un compte désactivé côté Cloud
 * n'apparaît donc JAMAIS dans ses résultats et ne peut jamais être rapatrié
 * par ce chemin seul. C'est précisément l'angle mort comblé par le correctif
 * P0-2 (commit 7e3fa1b, câblé en 23bb642) : `syncCurrentUserActiveStatus()`
 * interroge Supabase SPÉCIFIQUEMENT pour le login de la session courante
 * (sans le filtre statut_actif=1) et réaligne localement `statut_actif=0`
 * si besoin, permettant à `refreshSecureCurrentUser()` de détecter
 * `disabled=true` au cycle suivant.
 *
 * Invocation ciblée uniquement :
 *   npx playwright test e2e/specs/cloud/session-refresh-account-disabled-real.e2e.spec.ts
 * Build préalable requis : npx electron-vite build --mode e2e (déjà fait).
 */
import { test, expect } from '@playwright/test';
import { launchSeededApp, teardownSeededApp, type E2EEnvironment } from '../../fixtures/electron-app';
import { ensureCloudSiteAndCentre } from '../../fixtures/supabase-dev-client';
import { hashPassword } from '../../../src/main/auth/local-auth';
import {
  QA_PWD,
  queryDb,
  login,
  waitLoggedIn,
  waitForNetworkOnline,
  createCrossPosteUser,
  simulateAdminDisable,
  cleanupLocalCrossPosteUsers,
  cleanupCloudCrossPosteUsers
} from './_session-refresh-shared';

const RUN_ID = Date.now();
const loginDisabled = `QA_TERRAIN_DISABLED_${RUN_ID}`;
const syncIdDisabled = `qa-terrain-crossposte-disabled-${RUN_ID}`;

test.describe.serial('Session Cloud RÉELLE — Scénario 2/4 : compte désactivé en session active (agent-13, commits 6c5df9f -> dcd0bb7)', () => {
  let envA: E2EEnvironment;
  let dbPathA: string;
  let capturedDialogMessage: string | null = null;
  let anyTestFailed = false;

  test.afterEach(async ({}, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus) anyTestFailed = true;
  });

  test.afterAll(async () => {
    if (envA) await teardownSeededApp(envA, anyTestFailed);
  });

  test('0. Setup — Poste A réel + 1 compte QA_TERRAIN_ croisé (local + Cloud)', async () => {
    test.setTimeout(150_000);
    envA = await launchSeededApp({ allowRealSync: true });
    dbPathA = envA.seed.dbPath;
    const siteId = envA.seed.siteId;
    const centreId = envA.seed.centreId;
    console.log(`[SETUP] Poste A -> site=${siteId} centre=${centreId}`);

    await ensureCloudSiteAndCentre(siteId, centreId);

    const pwdHash = hashPassword(QA_PWD);
    await createCrossPosteUser(dbPathA, siteId, centreId, loginDisabled, 'OPERATEUR_VERIFICATION', syncIdDisabled, pwdHash);

    envA.window.on('dialog', async (dialog) => {
      capturedDialogMessage = dialog.message();
      console.log(`[DIALOG][Poste A] alert() capturé : "${capturedDialogMessage}"`);
      await dialog.accept();
    });

    const stateA = await waitForNetworkOnline(envA.window, 90_000);
    console.log(`[SETUP] État réseau Poste A = "${stateA}" (attendu ONLINE).`);
    expect(stateA).toBe('ONLINE');
  });

  test('1. Compte désactivé pendant une session active -> déconnexion fail-closed + message "compte...désactivé"', async () => {
    test.setTimeout(360_000);
    const { window } = envA;
    capturedDialogMessage = null;

    await login(window, loginDisabled, QA_PWD);
    await waitLoggedIn(window);
    console.log(`[SC2] Poste A connecté (${loginDisabled}), url="${window.url()}".`);
    await expect(window).toHaveURL(/#\/agent-verification/, { timeout: 10000 });

    // Admin (Poste B, simulé — voir commentaire de tête) désactive le compte.
    await simulateAdminDisable(syncIdDisabled, loginDisabled);

    const startWait = Date.now();
    const deadline = startWait + 250_000;
    let detected = false;
    while (Date.now() < deadline) {
      if (capturedDialogMessage || window.url().includes('#/login')) { detected = true; break; }
      await window.waitForTimeout(8000);
    }
    console.log(`[SC2] Détection après ${Math.round((Date.now() - startWait) / 1000)}s -> detected=${detected}, dialog="${capturedDialogMessage}", url="${window.url()}".`);

    expect(detected, 'Poste A doit se déconnecter automatiquement après désactivation du compte').toBe(true);
    expect(capturedDialogMessage).not.toBeNull();
    expect(capturedDialogMessage).toMatch(/compte/i);
    expect(capturedDialogMessage).toMatch(/désactivé/i);
    expect(capturedDialogMessage).not.toMatch(/autre machine/i);
    expect(window.url()).toContain('#/login');

    const localRow = queryDb(dbPathA, `SELECT statut_actif FROM t_users WHERE login='${loginDisabled}';`);
    console.log(`[SC2] État local Poste A après détection (statut_actif) -> ${localRow} (attendu 0, réaligné par syncCurrentUserActiveStatus).`);
    expect(localRow).toBe('0');
  });

  test('2. Nettoyage — compte QA_TERRAIN_ (Poste A + Cloud) avec revérification explicite', async () => {
    const { remainingA } = cleanupLocalCrossPosteUsers(dbPathA);
    console.log(`[CLEANUP] Restants locaux Poste A -> ${remainingA} (attendu 0)`);
    expect(remainingA).toBe(0);

    const { residualUsers, residualRoles } = await cleanupCloudCrossPosteUsers();
    console.log(`[CLEANUP][CLOUD] Résiduel -> users=${residualUsers} roles=${residualRoles} (attendu 0/0)`);
    expect(residualUsers).toBe(0);
    expect(residualRoles).toBe(0);
  });
});
