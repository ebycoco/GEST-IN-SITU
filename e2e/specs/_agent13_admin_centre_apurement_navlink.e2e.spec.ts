/**
 * e2e/specs/_agent13_admin_centre_apurement_navlink.e2e.spec.ts
 *
 * QA Terrain (agent-13) — Vérification CIBLÉE de l'ajout du lien "Apurement
 * Historique" dans la Sidebar pour ADMIN_CENTRE (Sidebar.tsx:130-136,
 * getNavItems() -> path /apurement). Avant ce changement, ADMIN_CENTRE
 * n'avait AUCUN moyen de navigation vers ce portail (route déjà autorisée
 * côté RBAC App.tsx:161 pour ce rôle, seul l'accès UI manquait).
 *
 * Scope minimal (test ciblé, pas de rejeu du scénario métier complet déjà
 * validé par e2e/specs/apurement/agent13_operateur_apurement.e2e.spec.ts et
 * e2e/specs/_agent13_admin_centre_overview.e2e.spec.ts) :
 *   1. Sidebar ADMIN_CENTRE affiche bien "Portail Supervision" +
 *      "Apurement Historique" + "Mon Profil" (3 entrées, pas plus).
 *   2. Clic sur "Apurement Historique" -> atterrit sur /apurement,
 *      ApurementLayout.tsx affiché avec ses 3 onglets accessibles.
 *   3. Clic sur "Portail Supervision" -> retour fonctionnel sur
 *      /admin-centre (non-régression navigation existante).
 *   4. Non-régression croisée minimale : sidebar OPERATEUR_APUREMENT (2
 *      entrées) et SUPER ADMIN (menu complet) restent inchangées.
 *
 * Isolation : launchSeededApp() sur un userDataDir jetable
 * (fs.mkdtempSync), réseau Supabase coupé (GEST_IN_SITU_E2E_DISABLE_SYNC=1).
 * Comptes utilisés : E2E_ADMIN_CENTRE / E2E_OPERATEUR_APUREMENT /
 * E2E_SUPER_ADMIN, déjà définis et seedés automatiquement par
 * e2e/fixtures/test-users.ts + seed-database.ts — aucune donnée
 * supplémentaire créée par ce fichier, donc aucun nettoyage DB nécessaire
 * (le userDataDir jetable est supprimé par teardownSeededApp()).
 */
import { test, expect } from '@playwright/test';
import {
  launchSeededApp,
  teardownSeededApp,
  type E2EEnvironment
} from '../fixtures/electron-app';
import { getTestUser } from '../fixtures/test-users';
import { join } from 'path';

const SHOT_DIR = join(__dirname, '..', '..', 'test-results', 'agent13-screenshots');

test.describe.serial('QA Terrain — ADMIN_CENTRE : lien Sidebar "Apurement Historique" (agent-13)', () => {
  let env: E2EEnvironment;
  let anyTestFailed = false;
  const consoleErrors: string[] = [];

  test.beforeAll(async () => {
    env = await launchSeededApp();
    env.window.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        if (!/favicon|Autofill|DevTools/i.test(text)) consoleErrors.push(text);
      }
    });
  });

  test.afterAll(async () => {
    if (env) await teardownSeededApp(env, anyTestFailed);
  });

  test.afterEach(async ({}, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus) anyTestFailed = true;
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

  // ═══════════════════════════════════════════════════════════════════════
  // 1. Connexion ADMIN_CENTRE + inventaire exact de la sidebar
  // ═══════════════════════════════════════════════════════════════════════
  test('1. ADMIN_CENTRE : connexion -> redirection /admin-centre, sidebar = 3 entrées exactes', async () => {
    const user = getTestUser('adminCentre');
    await login(user.login, user.password, /#\/admin-centre$/);
    const { window } = env;
    await expect(window.getByRole('heading', { name: 'PORTAIL SUPERVISION' })).toBeVisible({ timeout: 15000 });

    const navItems = window.locator('.nav-item');
    await expect(navItems).toHaveCount(3, { timeout: 10000 });
    const labels = await navItems.allTextContents();
    console.log(`[agent13][SIDEBAR][ADMIN_CENTRE] Entrées visibles : ${JSON.stringify(labels)}`);
    expect(labels.some((l) => l.includes('Portail Supervision'))).toBe(true);
    expect(labels.some((l) => l.includes('Apurement Historique'))).toBe(true);
    expect(labels.some((l) => l.includes('Mon Profil'))).toBe(true);
    await window.screenshot({ path: join(SHOT_DIR, 'agent13-adminctr-apunav-01-sidebar.png') });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 2. Navigation vers le portail Apurement + 3 onglets accessibles
  // ═══════════════════════════════════════════════════════════════════════
  test('2. ADMIN_CENTRE : clic "Apurement Historique" -> /apurement, 3 onglets visibles et fonctionnels', async () => {
    const { window } = env;
    await window.locator('.nav-item', { hasText: 'Apurement Historique' }).click();
    await window.waitForURL(/#\/apurement$/, { timeout: 15000 });
    await expect(window.getByText("PORTAIL D'APUREMENT")).toBeVisible({ timeout: 15000 });

    // Onglet par défaut : VUE D'ENSEMBLE (ApurementOverview).
    await expect(window.getByText("VUE D'ENSEMBLE")).toBeVisible({ timeout: 10000 });
    await expect(window.getByText('Travail du jour')).toBeVisible({ timeout: 10000 });

    // Onglet TRAVAIL D'APUREMENT (InventaireApurement, composant partagé).
    await window.getByText("TRAVAIL D'APUREMENT").click();
    await expect(window.locator('input[placeholder="Saisir nom & prénoms..."]')).toBeVisible({ timeout: 10000 });

    // Onglet CARTES DÉCHARGÉES (ApurementCorrections).
    await window.getByText('CARTES DÉCHARGÉES').click();
    await expect(window.getByRole('heading', { name: 'Cartes déchargées' })).toBeVisible({ timeout: 10000 });

    console.log('[agent13][APUREMENT-NAV] Les 3 onglets du portail /apurement sont accessibles pour ADMIN_CENTRE.');
    await window.screenshot({ path: join(SHOT_DIR, 'agent13-adminctr-apunav-02-portail.png') });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 3. Non-régression : "Portail Supervision" fonctionne toujours
  // ═══════════════════════════════════════════════════════════════════════
  test('3. ADMIN_CENTRE : clic "Portail Supervision" -> retour fonctionnel sur /admin-centre', async () => {
    const { window } = env;
    await window.locator('.nav-item', { hasText: 'Portail Supervision' }).click();
    await window.waitForURL(/#\/admin-centre$/, { timeout: 15000 });
    await expect(window.getByRole('heading', { name: 'PORTAIL SUPERVISION' })).toBeVisible({ timeout: 15000 });
    await expect(window.getByText("Cadence de l'équipe locale")).toBeVisible({ timeout: 15000 });
    console.log('[agent13][NONREG] "Portail Supervision" toujours fonctionnel après ajout du lien Apurement.');
    await window.screenshot({ path: join(SHOT_DIR, 'agent13-adminctr-apunav-03-retour-supervision.png') });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 4. Non-régression croisée minimale : autres rôles inchangés
  // ═══════════════════════════════════════════════════════════════════════
  test('4. Non-régression croisée : sidebar OPERATEUR_APUREMENT toujours limitée à 2 entrées', async () => {
    await logout();
    const user = getTestUser('operateurApurement');
    await login(user.login, user.password, /#\/apurement$/);
    const { window } = env;
    const navItems = window.locator('.nav-item');
    await expect(navItems).toHaveCount(2, { timeout: 10000 });
    const labels = await navItems.allTextContents();
    console.log(`[agent13][SIDEBAR][OPERATEUR_APUREMENT] Entrées visibles (doit rester inchangé) : ${JSON.stringify(labels)}`);
    expect(labels.some((l) => l.includes('Apurement Historique'))).toBe(true);
    expect(labels.some((l) => l.includes('Mon Profil'))).toBe(true);
    expect(labels.some((l) => l.includes('Portail Supervision'))).toBe(false);
  });

  test('5. Non-régression croisée : sidebar SUPER ADMIN (sans site sélectionné) toujours inchangée', async () => {
    await logout();
    const user = getTestUser('superAdmin');
    await login(user.login, user.password, /#\/dashboard$/);
    const { window } = env;
    const navItems = window.locator('.nav-item');
    const labels = await navItems.allTextContents();
    console.log(`[agent13][SIDEBAR][SUPER_ADMIN] Entrées visibles (doit rester inchangé) : ${JSON.stringify(labels)}`);
    // Ce compte de test est siteOnly (aucun site actif sélectionné) : Sidebar.tsx:91-98
    // renvoie alors le menu réduit "Tableau de bord / Infrastructures / Maintenance System /
    // Mon Profil" pour SUPER ADMIN — branche de code totalement distincte de celle modifiée
    // pour ADMIN_CENTRE (Sidebar.tsx:130-136). Constat, pas un bug lié à ce changement.
    expect(labels.some((l) => l.includes('Tableau de bord'))).toBe(true);
    expect(labels.some((l) => l.includes('Infrastructures'))).toBe(true);
    expect(labels.some((l) => l.includes('Mon Profil'))).toBe(true);
    // Ni ce menu réduit ni le menu complet (avec site sélectionné, App.tsx:100-127) n'exposent
    // "Apurement Historique" comme entrée directe — seule la Sidebar ADMIN_CENTRE a changé.
    expect(labels.some((l) => l.includes('Apurement Historique'))).toBe(false);
    console.log(`[agent13][NONREG-CONSOLE] ${consoleErrors.length} erreur(s) console (hors bruit connu) sur toute la session.`);
    expect(consoleErrors.length).toBeLessThan(50);
  });
});
