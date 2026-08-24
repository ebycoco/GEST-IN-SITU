/**
 * e2e/specs/cloud/session-refresh-role-added-real.e2e.spec.ts
 *
 * QA Terrain (agent-13) — Scénario 3/4 : "rôle ajouté pendant une session
 * active, sans toucher au rôle actif -> mise à jour silencieuse, PAS de
 * déconnexion". Même protocole, mêmes garde-fous et même adaptation
 * mono-instance (contrainte RAM constatée empiriquement — voir
 * _session-refresh-shared.ts et le commentaire de tête de
 * session-refresh-role-removed-real.e2e.spec.ts) que les 3 autres scénarios.
 *
 * ── Subtilité découverte en cours de conception (documentée, pas un bug) ──
 * `refreshSecureCurrentUser()` supprime volontairement `changed=true` sur le
 * TOUT PREMIER appel post-login (établissement de la référence
 * `secureCurrentGrantedRoles`, évite un faux-positif). Un rôle ajouté AVANT
 * ce premier cycle (T+10s) serait donc silencieusement absorbé comme
 * "baseline" sans jamais déclencher `auth:session-updated`. Ce scénario
 * laisse donc sciemment le premier cycle s'exécuter (marge de 35s) AVANT de
 * déclencher la modification admin, pour que le DEUXIÈME cycle (~T+190s)
 * puisse effectivement détecter et notifier le delta.
 *
 * Invocation ciblée uniquement :
 *   npx playwright test e2e/specs/cloud/session-refresh-role-added-real.e2e.spec.ts
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
  simulateAdminRoleChange,
  cleanupLocalCrossPosteUsers,
  cleanupCloudCrossPosteUsers,
  readConfirmModalMessage
} from './_session-refresh-shared';

const RUN_ID = Date.now();
const loginRoleAdded = `QA_TERRAIN_ROLEADD_${RUN_ID}`;
const syncIdRoleAdded = `qa-terrain-crossposte-roleadd-${RUN_ID}`;

test.describe.serial('Session Cloud RÉELLE — Scénario 3/4 : rôle ajouté en session active, sans déconnexion (agent-13, commits 6c5df9f -> dcd0bb7)', () => {
  let envA: E2EEnvironment;
  let dbPathA: string;
  // Message affiché par le modal de confirmation React (GlobalConfirmModal.tsx) — remplace
  // l'ancienne capture de l'alert() natif via window.on('dialog', ...), qui ne se déclenche
  // plus jamais depuis la migration de App.tsx vers confirmService.confirm(). Mis à jour à
  // chaque itération de la boucle de polling via readConfirmModalMessage(). Doit rester null
  // pendant tout ce scénario (aucune déconnexion attendue).
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
    await createCrossPosteUser(dbPathA, siteId, centreId, loginRoleAdded, 'OPERATEUR_VERIFICATION', syncIdRoleAdded, pwdHash);

    const stateA = await waitForNetworkOnline(envA.window, 90_000);
    console.log(`[SETUP] État réseau Poste A = "${stateA}" (attendu ONLINE).`);
    expect(stateA).toBe('ONLINE');
  });

  test('1. Rôle ajouté sans toucher au rôle actif -> mise à jour silencieuse (getSessionSnapshot), aucune déconnexion', async () => {
    test.setTimeout(360_000);
    const { window } = envA;
    capturedDialogMessage = null;

    await login(window, loginRoleAdded, QA_PWD);
    await waitLoggedIn(window);
    console.log(`[SC3] Poste A connecté (${loginRoleAdded}), url="${window.url()}".`);
    await expect(window).toHaveURL(/#\/agent-verification/, { timeout: 10000 });

    // Laisser le PREMIER cycle (T+10s) établir la référence secureCurrentGrantedRoles
    // AVANT toute modification admin — voir commentaire de tête de fichier.
    await window.waitForTimeout(35_000);
    const snapBefore = await window.evaluate(async () => (window as any).api.auth.getSessionSnapshot());
    console.log(`[SC3] Snapshot session AVANT ajout de rôle -> ${JSON.stringify(snapBefore)}`);

    // Admin (Poste B, simulé — voir commentaire de tête) ajoute ADMIN_CENTRE sans toucher
    // au rôle actif OPERATEUR_VERIFICATION.
    await simulateAdminRoleChange(syncIdRoleAdded, loginRoleAdded, hashPassword(QA_PWD), envA.seed.siteId, envA.seed.centreId, ['OPERATEUR_VERIFICATION', 'ADMIN_CENTRE']);

    const startWait = Date.now();
    const deadline = startWait + 245_000;
    let rolesUpdated = false;
    let snap: any = null;
    while (Date.now() < deadline) {
      snap = await window.evaluate(async () => (window as any).api.auth.getSessionSnapshot());
      if (snap?.roles?.includes('ADMIN_CENTRE')) { rolesUpdated = true; break; }
      capturedDialogMessage = await readConfirmModalMessage(window);
      if (capturedDialogMessage || window.url().includes('#/login')) break; // déconnexion inattendue -> sort, signalé ci-dessous
      await window.waitForTimeout(8000);
    }
    console.log(`[SC3] Après ${Math.round((Date.now() - startWait) / 1000)}s -> rolesUpdated=${rolesUpdated}, snapshot final=${JSON.stringify(snap)}, dialog="${capturedDialogMessage}", url="${window.url()}".`);

    expect(capturedDialogMessage, 'Un ajout de rôle sans toucher le rôle actif ne doit JAMAIS provoquer de déconnexion').toBeNull();
    expect(window.url(), 'Poste A doit rester sur son portail, pas de redirection /login').not.toContain('#/login');
    expect(rolesUpdated, 'La liste des rôles disponibles (getSessionSnapshot) doit inclure ADMIN_CENTRE après le cycle').toBe(true);
    expect(snap.roles).toContain('OPERATEUR_VERIFICATION');
    expect(snap.role, 'Le rôle ACTIF de la session ne doit jamais être modifié par un simple ajout').toBe('OPERATEUR_VERIFICATION');
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
