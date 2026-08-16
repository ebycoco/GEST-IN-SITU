/**
 * e2e/specs/cloud/session-refresh-negative-control-real.e2e.spec.ts
 *
 * QA Terrain (agent-13) — Scénario 4/4 : "contrôle négatif". Un poste dont
 * le compte n'est touché par AUCUNE action admin ne doit jamais se
 * déconnecter intempestivement ni afficher de comportement erratique
 * pendant plusieurs cycles du cycle dédié comptes/rôles (3 min,
 * sync-engine.ts). Même protocole que les 3 autres scénarios (voir
 * session-refresh-role-removed-real.e2e.spec.ts pour le contexte complet et
 * _session-refresh-shared.ts pour l'adaptation mono-instance RAM).
 *
 * Ce scénario n'a besoin d'AUCUNE simulation d'action admin : il vérifie
 * simplement qu'une session active, dont le compte reste inchangé côté
 * Cloud, traverse plusieurs cycles réels du SyncEngine sans effet de bord.
 *
 * Invocation ciblée uniquement :
 *   npx playwright test e2e/specs/cloud/session-refresh-negative-control-real.e2e.spec.ts
 * Build préalable requis : npx electron-vite build --mode e2e (déjà fait).
 */
import { test, expect } from '@playwright/test';
import { launchSeededApp, teardownSeededApp, type E2EEnvironment } from '../../fixtures/electron-app';
import { ensureCloudSiteAndCentre } from '../../fixtures/supabase-dev-client';
import { hashPassword } from '../../../src/main/auth/local-auth';
import {
  QA_PWD,
  login,
  waitLoggedIn,
  waitForNetworkOnline,
  createCrossPosteUser,
  cleanupLocalCrossPosteUsers,
  cleanupCloudCrossPosteUsers
} from './_session-refresh-shared';

const RUN_ID = Date.now();
const loginControl = `QA_TERRAIN_CONTROL_${RUN_ID}`;
const syncIdControl = `qa-terrain-crossposte-control-${RUN_ID}`;

test.describe.serial('Session Cloud RÉELLE — Scénario 4/4 : contrôle négatif, aucune action admin (agent-13, commits 6c5df9f -> dcd0bb7)', () => {
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
    await createCrossPosteUser(dbPathA, siteId, centreId, loginControl, 'OPERATEUR_VERIFICATION', syncIdControl, pwdHash);

    envA.window.on('dialog', async (dialog) => {
      capturedDialogMessage = dialog.message();
      console.log(`[DIALOG][Poste A] alert() capturé (INATTENDU — contrôle négatif) : "${capturedDialogMessage}"`);
      await dialog.accept();
    });

    const stateA = await waitForNetworkOnline(envA.window, 90_000);
    console.log(`[SETUP] État réseau Poste A = "${stateA}" (attendu ONLINE).`);
    expect(stateA).toBe('ONLINE');
  });

  test('1. Aucune action admin -> aucune déconnexion, aucun comportement erratique sur plusieurs cycles', async () => {
    test.setTimeout(300_000);
    const { window } = envA;
    capturedDialogMessage = null;

    await login(window, loginControl, QA_PWD);
    await waitLoggedIn(window);
    console.log(`[SC4] Poste A connecté (${loginControl}), url="${window.url()}".`);
    await expect(window).toHaveURL(/#\/agent-verification/, { timeout: 10000 });

    const snapAtLogin = await window.evaluate(async () => (window as any).api.auth.getSessionSnapshot());
    console.log(`[SC4] Snapshot au login -> ${JSON.stringify(snapAtLogin)}`);

    // Couvre le premier cycle (T+10s) et une bonne marge dans le second (T+190s), sans jamais
    // qu'aucune action admin n'ait lieu sur ce compte.
    console.log('[SC4] Attente d\'environ 4 minutes sans aucune action admin (couvre le 1er cycle et une bonne marge du 2e)...');
    const startWait = Date.now();
    const deadline = startWait + 250_000;
    let regression = false;
    while (Date.now() < deadline) {
      await window.waitForTimeout(15_000);
      if (capturedDialogMessage || window.url().includes('#/login')) { regression = true; break; }
    }
    console.log(`[SC4] Après ${Math.round((Date.now() - startWait) / 1000)}s -> regression=${regression}, dialog="${capturedDialogMessage}", url="${window.url()}".`);

    expect(capturedDialogMessage, 'Contrôle négatif : aucune déconnexion intempestive attendue').toBeNull();
    expect(window.url(), 'Contrôle négatif : le poste doit rester connecté sur son portail').not.toContain('#/login');
    expect(regression).toBe(false);

    const snapFinal = await window.evaluate(async () => (window as any).api.auth.getSessionSnapshot());
    console.log(`[SC4] Snapshot final -> ${JSON.stringify(snapFinal)}`);
    expect(snapFinal?.login?.toUpperCase(), 'La session doit être restée celle du même compte, sans altération').toBe(loginControl.toUpperCase());
    expect(snapFinal?.role).toBe('OPERATEUR_VERIFICATION');
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
