/**
 * e2e/specs/auth/login.e2e.spec.ts
 *
 * Étape 1 du plan E2E (voir .agents/storage/factory_memory.md,
 * section "2026-07-31 — Plan d'Implémentation Étanche : Suite E2E Automatisée") :
 * spike de validation + couverture du parcours de connexion.
 *
 * Rôles couverts dans ce premier incrément : OPERATEUR_VERIFICATION et
 * ADMINISTRATEUR_SITE (voir e2e/fixtures/test-users.ts). L'extension aux
 * autres rôles réels (RoleRedirect.tsx) est prévue pour les incréments
 * suivants.
 *
 * Une seule instance Electron est partagée pour l'ensemble des scénarios de
 * ce fichier (beforeAll/afterAll) : chaque scénario se connecte, vérifie,
 * puis se déconnecte avant de rendre la main au scénario suivant. Ceci
 * limite le nombre de démarrages complets de l'application (coûteux : DB,
 * SyncEngine, fenêtre Electron) tout en gardant chaque scénario atomique et
 * lisible. `test.describe.serial` garantit l'ordre d'exécution.
 */
import { test, expect } from '@playwright/test';
import { launchSeededApp, teardownSeededApp, type E2EEnvironment } from '../../fixtures/electron-app';
import { getTestUser } from '../../fixtures/test-users';

test.describe.serial('Authentification — Connexion / Échec / Déconnexion', () => {
  let env: E2EEnvironment;
  let anyTestFailed = false;

  test.beforeAll(async () => {
    env = await launchSeededApp();
  });

  test.afterAll(async () => {
    if (env) {
      await teardownSeededApp(env, anyTestFailed);
    }
  });

  test.afterEach(async ({}, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus) {
      anyTestFailed = true;
    }
  });

  async function login(login: string, password: string): Promise<void> {
    const { window } = env;
    await window.getByTestId('login-input').fill(login);
    await window.getByTestId('password-input').fill(password);
    await window.getByTestId('login-submit').click();
  }

  async function logout(): Promise<void> {
    const { window } = env;
    await window.getByText('Déconnexion').click();
    await window.waitForURL(/#\/login/);
  }

  test('connexion réussie — OPERATEUR_VERIFICATION redirigé vers /agent-verification', async () => {
    const { window } = env;
    const user = getTestUser('operateurVerification');

    await window.waitForURL(/#\/login/);
    await login(user.login, user.password);

    await window.waitForURL(/#\/agent-verification/, { timeout: 15000 });
    await expect(window.getByText('Déconnexion')).toBeVisible();

    await logout();
  });

  test('connexion réussie — ADMINISTRATEUR_SITE redirigé vers /dashboard', async () => {
    const { window } = env;
    const user = getTestUser('administrateurSite');

    await window.waitForURL(/#\/login/);
    await login(user.login, user.password);

    await window.waitForURL(/#\/dashboard/, { timeout: 15000 });
    await expect(window.getByText('Déconnexion')).toBeVisible();

    await logout();
  });

  test('échec de connexion — mauvais mot de passe', async () => {
    const { window } = env;
    const user = getTestUser('operateurVerification');

    await window.waitForURL(/#\/login/);
    await login(user.login, 'MotDePasseIncorrect_2026!');

    await expect(window.getByText('Identifiants incorrects')).toBeVisible({ timeout: 10000 });
    // Aucune redirection ne doit avoir eu lieu : le formulaire reste affiché.
    await expect(window).toHaveURL(/#\/login/);
    await expect(window.getByTestId('login-submit')).toBeVisible();
  });
});
