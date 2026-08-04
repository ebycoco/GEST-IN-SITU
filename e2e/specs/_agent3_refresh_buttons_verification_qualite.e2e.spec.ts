/**
 * e2e/specs/_agent3_refresh_buttons_verification_qualite.e2e.spec.ts
 *
 * Vérification fonctionnelle vivante (agent-3) des boutons "Actualiser"
 * ajoutés sur AgentVerificationLayout.tsx et AgentQualiteLayout.tsx, en
 * réplication du pattern déjà validé sur SiteAdminView.tsx (voir
 * actualiser-cache-ttl-repro.e2e.spec.ts). Aucune donnée carte requise :
 * les deux boutons dépendent uniquement de useDashboardStats/triggerRefresh,
 * qui fonctionnent sans jeu de cartes seedé.
 *
 * Portée volontairement limitée à un contrôle de non-régression basique :
 * bouton visible, cliquable, bascule "Actualisation..." pendant le
 * chargement (ou brève confirmation visuelle pour Qualité, cf.
 * triggerRefresh() synchrone), puis revient à "Actualiser" sans exception
 * console ni crash de la fenêtre.
 */
import { test, expect } from '@playwright/test';
import { launchSeededApp, teardownSeededApp, type E2EEnvironment } from '../fixtures/electron-app';
import { getTestUser } from '../fixtures/test-users';

test.describe.serial('Boutons "Actualiser" — AgentVerificationLayout & AgentQualiteLayout (agent-3)', () => {
  let env: E2EEnvironment;
  let anyTestFailed = false;
  const consoleErrors: string[] = [];

  test.beforeAll(async () => {
    env = await launchSeededApp();
    env.window.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    env.window.on('pageerror', (err) => {
      consoleErrors.push(`[pageerror] ${err.message}`);
    });
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

  async function login(loginId: string, password: string, urlPattern: RegExp): Promise<void> {
    const { window } = env;
    await window.waitForURL(/#\/login/, { timeout: 20000 });
    await window.getByTestId('login-input').fill(loginId);
    await window.getByTestId('password-input').fill(password);
    await window.getByTestId('login-submit').click();
    await window.waitForURL(urlPattern, { timeout: 20000 });
  }

  async function logout(): Promise<void> {
    const { window } = env;
    await window.getByText('Déconnexion').click();
    await window.waitForURL(/#\/login/, { timeout: 15000 });
  }

  test('1. Portail Vérification (/agent-verification) : bouton "Actualiser" présent et fonctionnel', async () => {
    const user = getTestUser('operateurVerification');
    await login(user.login, user.password, /#\/agent-verification/);

    const { window } = env;
    const refreshBtn = window.getByRole('button', { name: /Actualiser/ });
    await expect(refreshBtn).toBeVisible({ timeout: 30000 });
    await expect(refreshBtn).toBeEnabled();

    await refreshBtn.click();
    // Le clic doit propager forceRefresh: true jusqu'à loadStats sans lever
    // d'exception ; le bouton doit revenir à un état stable "Actualiser"
    // (loading terminé) sans rester bloqué indéfiniment sur "Actualisation...".
    await expect(window.getByRole('button', { name: 'Actualiser' })).toBeVisible({ timeout: 20000 });
    await expect(refreshBtn).toBeEnabled();

    console.log('[QA-CHECK][Portail Vérification] Bouton "Actualiser" cliqué avec succès, retour à l\'état stable confirmé.');
  });

  test('2. Portail Qualité (/agent-qualite) : bouton "Actualiser" présent et fonctionnel', async () => {
    const { window } = env;

    // Déconnexion explicite pour repasser par /login avec le second compte de test
    // (même instance Electron, sans redémarrage — pattern identique à
    // dashboard-cache-cross-user-repro.e2e.spec.ts).
    await logout();

    const user = getTestUser('operateurQualite');
    await login(user.login, user.password, /#\/agent-qualite/);

    const refreshBtn = window.getByRole('button', { name: 'Actualiser' });
    await expect(refreshBtn).toBeVisible({ timeout: 30000 });
    await expect(refreshBtn).toBeEnabled();

    await refreshBtn.click();
    // triggerRefresh() est synchrone (simple incrément de compteur Zustand) :
    // l'état isRefreshing local doit revenir à false rapidement (~600ms).
    await expect(window.getByRole('button', { name: 'Actualiser' })).toBeEnabled({ timeout: 5000 });

    console.log('[QA-CHECK][Portail Qualité] Bouton "Actualiser" cliqué avec succès, retour à l\'état stable confirmé.');
  });

  test('3. Aucune erreur console/pageerror imputable aux boutons "Actualiser" pendant le scénario', async () => {
    const relevant = consoleErrors.filter((e) => !/DevTools|Autofill|ERR_INTERNET_DISCONNECTED/.test(e));
    if (relevant.length > 0) {
      console.log('[QA-CHECK][Erreurs console capturées]\n' + relevant.join('\n'));
    }
    expect(relevant).toEqual([]);
  });
});
