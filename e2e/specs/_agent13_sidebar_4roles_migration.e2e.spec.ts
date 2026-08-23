/**
 * e2e/specs/_agent13_sidebar_4roles_migration.e2e.spec.ts
 *
 * QA Terrain (agent-13) — Test fonctionnel vivant du déplacement de la barre
 * d'onglets horizontale vers la sidebar verticale pour 4 rôles
 * (OPERATEUR_QUALITE, ADMIN_CENTRE, OPERATEUR_APUREMENT,
 * OPERATEUR_VERIFICATION), et de la non-régression stricte pour
 * ADMINISTRATEUR_SITE / SUPER ADMIN sur les mêmes routes partagées
 * (Sidebar.tsx, AgentQualiteLayout.tsx, AgentVerificationLayout.tsx,
 * AdminCentreLayout.tsx, ApurementLayout.tsx — changement non commité au
 * moment de ce test).
 *
 * Aucune donnée de test créée (pas de carte, pas de compte agent) : ce
 * fichier ne fait que naviguer dans l'UI avec les comptes E2E_ déjà définis
 * dans e2e/fixtures/test-users.ts et seedés automatiquement par
 * seed-database.ts. Le seul nettoyage nécessaire est celui, déjà automatique,
 * du userDataDir jetable (teardownSeededApp).
 *
 * Build utilisé : `npx electron-vite build` relancé manuellement par l'agent
 * juste avant ce test pour que dist/ reflète les modifications non commitées
 * (App.tsx, Sidebar.tsx, AdminCentreLayout.tsx, AgentQualiteLayout.tsx,
 * AgentVerificationLayout.tsx, ApurementLayout.tsx).
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

test.describe.serial('QA Terrain — Sidebar 4 rôles migrés + non-régression ADMINISTRATEUR_SITE/SUPER ADMIN (agent-13)', () => {
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
    env.window.on('pageerror', (err) => {
      consoleErrors.push(`[pageerror] ${err.message}`);
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

  /** Retourne les libellés des liens `.nav-item` actuellement surlignés `.active` — pour
   * vérifier qu'un SEUL lien est actif à la fois (attention particulière demandée sur le
   * correctif `end`). */
  async function activeNavLabels(): Promise<string[]> {
    return env.window.locator('.nav-item.active').allTextContents();
  }

  // ═══════════════════════════════════════════════════════════════════════
  // A. OPERATEUR_QUALITE — sidebar "QUALITÉ & ASSAINISSEMENT", 6 liens
  // ═══════════════════════════════════════════════════════════════════════
  test('A1. OPERATEUR_QUALITE : connexion → sidebar "QUALITÉ & ASSAINISSEMENT" avec les 6 liens attendus', async () => {
    const user = getTestUser('operateurQualite');
    await login(user.login, user.password, /#\/agent-qualite$/);
    const { window } = env;

    await expect(window.getByText('QUALITÉ & ASSAINISSEMENT', { exact: true })).toBeVisible({ timeout: 15000 });
    const navItems = window.locator('.nav-item');
    const labels = await navItems.allTextContents();
    console.log(`[agent13][SIDEBAR][OPERATEUR_QUALITE] Entrées : ${JSON.stringify(labels)}`);
    for (const expected of ["Vue d'ensemble", 'Doublons', 'Données Manquantes', 'Dates Invalides ou Absentes', 'Autres Anomalies', 'Recherche Universelle', 'Mon Profil']) {
      expect(labels.some((l) => l.includes(expected))).toBe(true);
    }
    expect(labels.length).toBe(7);

    // Aucune barre d'onglets horizontale (.tab-link) ne doit subsister pour ce rôle.
    await expect(window.locator('.tab-link')).toHaveCount(0);
    await window.screenshot({ path: join(SHOT_DIR, 'agent13-sb4-qualite-01-sidebar.png') });
  });

  test('A2. OPERATEUR_QUALITE : clic sur chacun des 6 liens → navigation correcte + un seul lien actif à la fois', async () => {
    const { window } = env;
    const cases: { label: string; urlPattern: RegExp; marker: string }[] = [
      { label: "Vue d'ensemble", urlPattern: /#\/agent-qualite$/, marker: 'Statistiques Globales des Anomalies' },
      { label: 'Doublons', urlPattern: /#\/agent-qualite\/doublons$/, marker: 'Traitement des Doublons' },
      { label: 'Données Manquantes', urlPattern: /#\/agent-qualite\/manquants$/, marker: 'Complétion des Données Manquantes' },
      { label: 'Dates Invalides ou Absentes', urlPattern: /#\/agent-qualite\/invalides$/, marker: 'Correction des Dates Invalides ou Absentes' },
      { label: 'Autres Anomalies', urlPattern: /#\/agent-qualite\/anomalies-brutes$/, marker: 'Autres anomalies' },
      { label: 'Recherche Universelle', urlPattern: /#\/agent-qualite\/recherche-universelle$/, marker: 'Recherche Universelle' }
    ];
    // Ordre volontaire : Vue d'ensemble en dernier pour vérifier explicitement le retour
    // depuis une sous-route (test du correctif `end` sur l'index).
    for (const c of [...cases.slice(1), cases[0]]) {
      await window.locator('.nav-item', { hasText: c.label }).click();
      await window.waitForURL(c.urlPattern, { timeout: 15000 });
      await expect(window.getByText(c.marker, { exact: false }).first()).toBeVisible({ timeout: 10000 });
      const active = await activeNavLabels();
      console.log(`[agent13][NAV][OPERATEUR_QUALITE] Clic "${c.label}" → URL OK, lien(s) actif(s) = ${JSON.stringify(active)}`);
      expect(active.length).toBe(1);
      expect(active[0]).toContain(c.label);
      await expect(window.locator('.tab-link')).toHaveCount(0);
    }
    await window.screenshot({ path: join(SHOT_DIR, 'agent13-sb4-qualite-02-vue-ensemble-active.png') });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // B. ADMIN_CENTRE — sidebar "PORTAIL SUPERVISION" (7) + "AUTRES" (1)
  // ═══════════════════════════════════════════════════════════════════════
  test('B1. ADMIN_CENTRE : connexion → sidebar "PORTAIL SUPERVISION" (7 liens) + "AUTRES" (Apurement Historique)', async () => {
    await logout();
    const user = getTestUser('adminCentre');
    await login(user.login, user.password, /#\/admin-centre$/);
    const { window } = env;

    await expect(window.getByRole('navigation').getByText('PORTAIL SUPERVISION', { exact: true })).toBeVisible({ timeout: 15000 });
    await expect(window.getByText('AUTRES', { exact: true })).toBeVisible({ timeout: 10000 });
    const navItems = window.locator('.nav-item');
    const labels = await navItems.allTextContents();
    console.log(`[agent13][SIDEBAR][ADMIN_CENTRE] Entrées : ${JSON.stringify(labels)}`);
    for (const expected of ['Tableau de Bord', 'Cartes CMU', 'Recherche CMU', 'Suivi des Retraits', "File d'attente", 'Journaux', 'Mon équipe', 'Apurement Historique', 'Mon Profil']) {
      expect(labels.some((l) => l.includes(expected))).toBe(true);
    }
    expect(labels.length).toBe(9);
    // "Apurement Historique" doit être un lien UNIQUE (pas éclaté en 3 sous-liens).
    expect(labels.filter((l) => l.includes('Apurement')).length).toBe(1);

    await expect(window.locator('.tab-link')).toHaveCount(0);
    await window.screenshot({ path: join(SHOT_DIR, 'agent13-sb4-admincentre-01-sidebar.png') });
  });

  test('B2. ADMIN_CENTRE : clic sur chacun des liens "PORTAIL SUPERVISION" → navigation correcte + un seul lien actif', async () => {
    const { window } = env;
    const cases: { label: string; urlPattern: RegExp; marker: string | RegExp }[] = [
      { label: 'Cartes CMU', urlPattern: /#\/admin-centre\/cartes$/, marker: 'Cartes CMU' },
      // Selon les données seedées, VerificationSearchPage affiche soit son en-tête de recherche,
      // soit un état vide "Aucune donnée disponible" (garde pré-existante du composant, sans
      // rapport avec ce chantier) — les deux formulations sont un succès de navigation valide ici.
      { label: 'Recherche CMU', urlPattern: /#\/admin-centre\/recherche$/, marker: /Recherche de Carte|Aucune donnée disponible/ },
      { label: 'Suivi des Retraits', urlPattern: /#\/admin-centre\/retraits$/, marker: 'Suivi des Retraits' },
      { label: "File d'attente", urlPattern: /#\/admin-centre\/queue$/, marker: "File d'attente de Traitement" },
      { label: 'Journaux', urlPattern: /#\/admin-centre\/logs$/, marker: "Journal d'Audit Système" },
      { label: 'Mon équipe', urlPattern: /#\/admin-centre\/equipe$/, marker: 'Mon Équipe' },
      { label: 'Tableau de Bord', urlPattern: /#\/admin-centre$/, marker: "Cadence de l'équipe locale" }
    ];
    for (const c of cases) {
      await window.locator('.nav-item', { hasText: c.label }).click();
      await window.waitForURL(c.urlPattern, { timeout: 15000 });
      await expect(window.getByText(c.marker, { exact: false }).first()).toBeVisible({ timeout: 10000 });
      const active = await activeNavLabels();
      console.log(`[agent13][NAV][ADMIN_CENTRE] Clic "${c.label}" → URL OK, lien(s) actif(s) = ${JSON.stringify(active)}`);
      expect(active.length).toBe(1);
      expect(active[0]).toContain(c.label);
      await expect(window.locator('.tab-link')).toHaveCount(0);
    }
    await window.screenshot({ path: join(SHOT_DIR, 'agent13-sb4-admincentre-02-tableau-bord-active.png') });
  });

  test('B3. ADMIN_CENTRE : clic "Apurement Historique" → /apurement, la barre d\'onglets horizontale d\'origine (3 onglets) reste affichée', async () => {
    const { window } = env;
    await window.locator('.nav-item', { hasText: 'Apurement Historique' }).click();
    await window.waitForURL(/#\/apurement$/, { timeout: 15000 });
    await expect(window.getByText("PORTAIL D'APUREMENT")).toBeVisible({ timeout: 15000 });
    // Barre horizontale non éclatée dans la sidebar pour ADMIN_CENTRE (rôle non ciblé par ce
    // chantier sur cette route partagée) : les 3 onglets "VUE D'ENSEMBLE"/"TRAVAIL
    // D'APUREMENT"/"CARTES DÉCHARGÉES" (classe .hover-scale, tout en majuscules) doivent
    // rester visibles.
    await expect(window.getByText("VUE D'ENSEMBLE", { exact: true })).toBeVisible({ timeout: 10000 });
    await expect(window.getByText("TRAVAIL D'APUREMENT", { exact: true })).toBeVisible({ timeout: 5000 });
    await expect(window.getByText('CARTES DÉCHARGÉES', { exact: true })).toBeVisible({ timeout: 5000 });
    console.log('[agent13][ADMIN_CENTRE] /apurement : barre horizontale à 3 onglets toujours affichée (comportement attendu, non modifié pour ADMIN_CENTRE).');
    await window.screenshot({ path: join(SHOT_DIR, 'agent13-sb4-admincentre-03-apurement-tabs.png') });
    // Retour au portail supervision pour la suite (le lien sidebar s'intitule "Tableau de Bord",
    // "PORTAIL SUPERVISION" n'étant que le titre de section, pas un .nav-item cliquable).
    await window.locator('.nav-item', { hasText: 'Tableau de Bord' }).click();
    await window.waitForURL(/#\/admin-centre$/, { timeout: 15000 });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // C. OPERATEUR_APUREMENT — sidebar "PORTAIL D'APUREMENT" (3 vues, vrai routing)
  // ═══════════════════════════════════════════════════════════════════════
  test('C1. OPERATEUR_APUREMENT : connexion → sidebar "PORTAIL D\'APUREMENT" avec les 3 liens attendus, pas de barre horizontale', async () => {
    await logout();
    const user = getTestUser('operateurApurement');
    await login(user.login, user.password, /#\/apurement$/);
    const { window } = env;

    await expect(window.getByRole('navigation').getByText("PORTAIL D'APUREMENT", { exact: true })).toBeVisible({ timeout: 15000 });
    const navItems = window.locator('.nav-item');
    const labels = await navItems.allTextContents();
    console.log(`[agent13][SIDEBAR][OPERATEUR_APUREMENT] Entrées : ${JSON.stringify(labels)}`);
    for (const expected of ["Vue d'ensemble", "Travail d'apurement", 'Cartes déchargées', 'Mon Profil']) {
      expect(labels.some((l) => l.includes(expected))).toBe(true);
    }
    expect(labels.length).toBe(4);

    // Aucune trace de la barre horizontale d'origine (tout-majuscules "VUE D'ENSEMBLE").
    await expect(window.getByText("VUE D'ENSEMBLE", { exact: true })).not.toBeVisible();
    await window.screenshot({ path: join(SHOT_DIR, 'agent13-sb4-apurement-01-sidebar.png') });
  });

  test('C2. OPERATEUR_APUREMENT : les 3 vues affichent les bonnes données via vrai routing (URL change), un seul lien actif à la fois', async () => {
    const { window } = env;

    // Vue d'ensemble (déjà sur cette route après login) : KPI "Aujourd'hui" visible.
    await expect(window.getByText("Aujourd'hui", { exact: true }).first()).toBeVisible({ timeout: 10000 });
    let active = await activeNavLabels();
    expect(active.length).toBe(1);
    expect(active[0]).toContain("Vue d'ensemble");
    console.log(`[agent13][NAV][OPERATEUR_APUREMENT] Vue d'ensemble active au chargement : ${JSON.stringify(active)}`);

    // Travail d'apurement.
    await window.locator('.nav-item', { hasText: "Travail d'apurement" }).click();
    await window.waitForURL(/#\/apurement\/travail$/, { timeout: 15000 });
    await expect(window.locator('input[placeholder="Saisir nom & prénoms..."]')).toBeVisible({ timeout: 10000 });
    active = await activeNavLabels();
    console.log(`[agent13][NAV][OPERATEUR_APUREMENT] Clic "Travail d'apurement" → actif = ${JSON.stringify(active)}`);
    expect(active.length).toBe(1);
    expect(active[0]).toContain("Travail d'apurement");

    // Cartes déchargées.
    await window.locator('.nav-item', { hasText: 'Cartes déchargées' }).click();
    await window.waitForURL(/#\/apurement\/cartes-dechargees$/, { timeout: 15000 });
    await expect(window.getByRole('heading', { name: 'Cartes déchargées' })).toBeVisible({ timeout: 10000 });
    active = await activeNavLabels();
    console.log(`[agent13][NAV][OPERATEUR_APUREMENT] Clic "Cartes déchargées" → actif = ${JSON.stringify(active)}`);
    expect(active.length).toBe(1);
    expect(active[0]).toContain('Cartes déchargées');

    // Retour Vue d'ensemble depuis une sous-route (vérification directe du correctif `end`).
    await window.locator('.nav-item', { hasText: "Vue d'ensemble" }).click();
    await window.waitForURL(/#\/apurement$/, { timeout: 15000 });
    await expect(window.getByText("Aujourd'hui", { exact: true }).first()).toBeVisible({ timeout: 10000 });
    active = await activeNavLabels();
    console.log(`[agent13][NAV][OPERATEUR_APUREMENT] Retour "Vue d'ensemble" depuis sous-route → actif = ${JSON.stringify(active)}`);
    expect(active.length).toBe(1);
    expect(active[0]).toContain("Vue d'ensemble");
    await window.screenshot({ path: join(SHOT_DIR, 'agent13-sb4-apurement-02-vue-ensemble-active.png') });
  });

  test('C3. OPERATEUR_APUREMENT : rechargement (F5) sur une sous-vue (/apurement/travail) ne casse rien (pas d\'écran blanc)', async () => {
    const { window } = env;
    await window.locator('.nav-item', { hasText: "Travail d'apurement" }).click();
    await window.waitForURL(/#\/apurement\/travail$/, { timeout: 15000 });
    await expect(window.locator('input[placeholder="Saisir nom & prénoms..."]')).toBeVisible({ timeout: 10000 });

    await window.reload();
    await window.waitForLoadState('domcontentloaded');
    // Constat vérifié par sonde dédiée (comparaison avec /agent-qualite/doublons, route imbriquée
    // PRÉ-EXISTANTE et totalement étrangère à ce chantier) : un F5 sur N'IMPORTE QUELLE route
    // imbriquée protégée renvoie systématiquement vers /login ~300ms après le rechargement (le
    // store d'auth Zustand n'est pas encore réhydraté au premier rendu de ProtectedRoute, qui
    // redirige avant que checkAuth() ait résolu). Comportement global de l'application, préexistant
    // à ce chantier — PAS une régression introduite par la conversion d'ApurementLayout en routes.
    // Ce test vérifie donc seulement l'absence de crash/écran blanc et la possibilité de se
    // reconnecter, pas la préservation du lien profond (qu'aucune route de l'appli ne garantit).
    await window.waitForURL(/#\/login$/, { timeout: 20000 });
    await expect(window.getByTestId('login-input')).toBeVisible({ timeout: 10000 });
    console.log('[agent13][F5-RELOAD][OPERATEUR_APUREMENT] Après reload sur /apurement/travail → retour /login (comportement global préexistant, pas une régression de ce chantier).');
    await window.screenshot({ path: join(SHOT_DIR, 'agent13-sb4-apurement-03-f5-reload.png') });

    // Reconnexion pour la suite de la série.
    const user = getTestUser('operateurApurement');
    await window.getByTestId('login-input').fill(user.login);
    await window.getByTestId('password-input').fill(user.password);
    await window.getByTestId('login-submit').click();
    await window.waitForURL(/#\/apurement$/, { timeout: 20000 });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // D. OPERATEUR_VERIFICATION — sidebar "PORTAIL DE VÉRIFICATION" (3) + "AUTRES" (1)
  // ═══════════════════════════════════════════════════════════════════════
  test('D1. OPERATEUR_VERIFICATION : connexion → sidebar "PORTAIL DE VÉRIFICATION" (3) + "AUTRES" (Recherche Rapide)', async () => {
    await logout();
    const user = getTestUser('operateurVerification');
    await login(user.login, user.password, /#\/agent-verification$/);
    const { window } = env;

    await expect(window.getByRole('navigation').getByText('PORTAIL DE VÉRIFICATION', { exact: true })).toBeVisible({ timeout: 15000 });
    await expect(window.getByText('AUTRES', { exact: true })).toBeVisible({ timeout: 10000 });
    const navItems = window.locator('.nav-item');
    const labels = await navItems.allTextContents();
    console.log(`[agent13][SIDEBAR][OPERATEUR_VERIFICATION] Entrées : ${JSON.stringify(labels)}`);
    for (const expected of ["Vue d'ensemble", 'Recherche Active', "Signalements d'anomalies", 'Recherche Rapide', 'Mon Profil']) {
      expect(labels.some((l) => l.includes(expected))).toBe(true);
    }
    expect(labels.length).toBe(5);

    await expect(window.locator('.tab-link')).toHaveCount(0);
    await window.screenshot({ path: join(SHOT_DIR, 'agent13-sb4-verification-01-sidebar.png') });
  });

  test('D2. OPERATEUR_VERIFICATION : clic sur chacun des 4 liens → navigation correcte + un seul lien actif à la fois', async () => {
    const { window } = env;

    await window.locator('.nav-item', { hasText: 'Recherche Active' }).click();
    await window.waitForURL(/#\/agent-verification\/recherche$/, { timeout: 15000 });
    // Site de test sans carte seedée : "Base de données locale vide" attendu (comportement
    // normal de la page, pas une anomalie de ce changement).
    await expect(window.getByText(/Base de données locale vide|Rechercher une carte/).first()).toBeVisible({ timeout: 10000 });
    let active = await activeNavLabels();
    console.log(`[agent13][NAV][OPERATEUR_VERIFICATION] Clic "Recherche Active" → actif = ${JSON.stringify(active)}`);
    expect(active.length).toBe(1);
    expect(active[0]).toContain('Recherche Active');
    await expect(window.locator('.tab-link')).toHaveCount(0);

    await window.locator('.nav-item', { hasText: "Signalements d'anomalies" }).click();
    await window.waitForURL(/#\/agent-verification\/signalements$/, { timeout: 15000 });
    await expect(window.getByText('Signalements Non Résolus').first()).toBeVisible({ timeout: 10000 });
    active = await activeNavLabels();
    console.log(`[agent13][NAV][OPERATEUR_VERIFICATION] Clic "Signalements d'anomalies" → actif = ${JSON.stringify(active)}`);
    expect(active.length).toBe(1);
    expect(active[0]).toContain("Signalements d'anomalies");
    await expect(window.locator('.tab-link')).toHaveCount(0);

    await window.locator('.nav-item', { hasText: 'Recherche Rapide' }).click();
    await window.waitForURL(/#\/search$/, { timeout: 15000 });
    await expect(window.getByText('Recherche FTS5 (Texte Intégral)')).toBeVisible({ timeout: 10000 });
    active = await activeNavLabels();
    console.log(`[agent13][NAV][OPERATEUR_VERIFICATION] Clic "Recherche Rapide" → actif = ${JSON.stringify(active)}`);
    expect(active.length).toBe(1);
    expect(active[0]).toContain('Recherche Rapide');

    // Retour Vue d'ensemble (test du correctif `end` depuis une route hors /agent-verification/*).
    await window.locator('.nav-item', { hasText: "Vue d'ensemble" }).click();
    await window.waitForURL(/#\/agent-verification$/, { timeout: 15000 });
    await expect(window.getByText('Travail du jour')).toBeVisible({ timeout: 10000 });
    active = await activeNavLabels();
    console.log(`[agent13][NAV][OPERATEUR_VERIFICATION] Retour "Vue d'ensemble" → actif = ${JSON.stringify(active)}`);
    expect(active.length).toBe(1);
    expect(active[0]).toContain("Vue d'ensemble");
    await expect(window.locator('.tab-link')).toHaveCount(0);
    await window.screenshot({ path: join(SHOT_DIR, 'agent13-sb4-verification-02-vue-ensemble-active.png') });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // E. ADMINISTRATEUR_SITE — non-régression stricte sur les 3 routes partagées
  // ═══════════════════════════════════════════════════════════════════════
  test('E1. ADMINISTRATEUR_SITE : /agent-qualite → barre d\'onglets horizontale d\'origine INCHANGÉE, sidebar NON éclatée', async () => {
    await logout();
    const user = getTestUser('administrateurSite');
    await login(user.login, user.password, /#\/dashboard$/);
    const { window } = env;

    await window.evaluate(() => { window.location.hash = '#/agent-qualite'; });
    await window.waitForURL(/#\/agent-qualite$/, { timeout: 15000 });
    await expect(window.getByText('PORTAIL DE CONFORMITÉ ET QUALITÉ')).toBeVisible({ timeout: 15000 });

    // Barre horizontale scrollable d'origine (6 .tab-link) toujours présente et cliquable.
    const tabLinks = window.locator('.tab-link');
    await expect(tabLinks).toHaveCount(6, { timeout: 10000 });
    const tabLabels = await tabLinks.allTextContents();
    console.log(`[agent13][NONREG][ADMINISTRATEUR_SITE][/agent-qualite] Onglets horizontaux : ${JSON.stringify(tabLabels)}`);
    for (const expected of ["Vue d'ensemble", 'Doublons', 'Données Manquantes', 'Dates Invalides ou Absentes', 'Autres Anomalies', 'Recherche Universelle']) {
      expect(tabLabels.some((l) => l.includes(expected))).toBe(true);
    }
    await tabLinks.filter({ hasText: 'Doublons' }).click();
    await window.waitForURL(/#\/agent-qualite\/doublons$/, { timeout: 10000 });
    await expect(window.getByText('Traitement des Doublons')).toBeVisible({ timeout: 10000 });

    // La sidebar d'ADMINISTRATEUR_SITE ne doit PAS avoir gagné les liens éclatés
    // "Doublons"/"Données Manquantes"/etc. comme entrées de nav-item distinctes : ce sont des
    // routes de sous-navigation OPERATEUR_QUALITE, pas des entrées sidebar pour ce rôle.
    const navLabels = await window.locator('.nav-item').allTextContents();
    console.log(`[agent13][NONREG][ADMINISTRATEUR_SITE] Sidebar (menu complet) : ${JSON.stringify(navLabels)}`);
    expect(navLabels.some((l) => l.includes('Doublons'))).toBe(false);
    expect(navLabels.some((l) => l.includes('Données Manquantes'))).toBe(false);
    expect(navLabels.some((l) => l.trim() === 'Qualité & Assainissement')).toBe(true);
    await window.screenshot({ path: join(SHOT_DIR, 'agent13-sb4-adminsite-01-agent-qualite-tabs.png') });
  });

  test('E2. ADMINISTRATEUR_SITE : /agent-verification → barre d\'onglets horizontale d\'origine INCHANGÉE, sidebar NON éclatée', async () => {
    const { window } = env;
    await window.evaluate(() => { window.location.hash = '#/agent-verification'; });
    await window.waitForURL(/#\/agent-verification$/, { timeout: 15000 });
    await expect(window.getByText('PORTAIL DE VÉRIFICATION')).toBeVisible({ timeout: 15000 });

    const tabLinks = window.locator('.tab-link');
    await expect(tabLinks).toHaveCount(3, { timeout: 10000 });
    const tabLabels = await tabLinks.allTextContents();
    console.log(`[agent13][NONREG][ADMINISTRATEUR_SITE][/agent-verification] Onglets horizontaux : ${JSON.stringify(tabLabels)}`);
    for (const expected of ["Vue d'ensemble", 'Recherche Active', "Signalements d'anomalies"]) {
      expect(tabLabels.some((l) => l.includes(expected))).toBe(true);
    }

    const navLabels = await window.locator('.nav-item').allTextContents();
    console.log(`[agent13][NONREG][ADMINISTRATEUR_SITE] Sidebar (menu complet) : ${JSON.stringify(navLabels)}`);
    expect(navLabels.some((l) => l.trim() === 'Signalements d\'anomalies')).toBe(false);
    await window.screenshot({ path: join(SHOT_DIR, 'agent13-sb4-adminsite-02-agent-verification-tabs.png') });
  });

  test('E3. ADMINISTRATEUR_SITE : /apurement → barre d\'onglets horizontale d\'origine INCHANGÉE, sidebar NON éclatée', async () => {
    const { window } = env;
    await window.evaluate(() => { window.location.hash = '#/apurement'; });
    await window.waitForURL(/#\/apurement$/, { timeout: 15000 });
    await expect(window.getByText("PORTAIL D'APUREMENT")).toBeVisible({ timeout: 15000 });

    await expect(window.getByText("VUE D'ENSEMBLE", { exact: true })).toBeVisible({ timeout: 10000 });
    await expect(window.getByText("TRAVAIL D'APUREMENT", { exact: true })).toBeVisible({ timeout: 5000 });
    await expect(window.getByText('CARTES DÉCHARGÉES', { exact: true })).toBeVisible({ timeout: 5000 });

    const navLabels = await window.locator('.nav-item').allTextContents();
    console.log(`[agent13][NONREG][ADMINISTRATEUR_SITE] Sidebar (menu complet) : ${JSON.stringify(navLabels)}`);
    expect(navLabels.some((l) => l.trim() === "Travail d'apurement")).toBe(false);
    expect(navLabels.some((l) => l.trim() === 'Cartes déchargées')).toBe(false);
    await window.screenshot({ path: join(SHOT_DIR, 'agent13-sb4-adminsite-03-apurement-tabs.png') });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // F. SUPER ADMIN — vérification par prudence (mêmes 3 routes, contrôle allégé)
  // ═══════════════════════════════════════════════════════════════════════
  test('F1. SUPER ADMIN : /agent-qualite, /agent-verification, /apurement → barres horizontales toujours présentes', async () => {
    await logout();
    const user = getTestUser('superAdmin');
    await login(user.login, user.password, /#\/dashboard$/);
    const { window } = env;

    await window.evaluate(() => { window.location.hash = '#/agent-qualite'; });
    await window.waitForURL(/#\/agent-qualite$/, { timeout: 15000 });
    await expect(window.locator('.tab-link')).toHaveCount(6, { timeout: 10000 });
    console.log('[agent13][NONREG][SUPER ADMIN] /agent-qualite : 6 onglets horizontaux toujours présents.');

    await window.evaluate(() => { window.location.hash = '#/agent-verification'; });
    await window.waitForURL(/#\/agent-verification$/, { timeout: 15000 });
    await expect(window.locator('.tab-link')).toHaveCount(3, { timeout: 10000 });
    console.log('[agent13][NONREG][SUPER ADMIN] /agent-verification : 3 onglets horizontaux toujours présents.');

    await window.evaluate(() => { window.location.hash = '#/apurement'; });
    await window.waitForURL(/#\/apurement$/, { timeout: 15000 });
    await expect(window.getByText("VUE D'ENSEMBLE", { exact: true })).toBeVisible({ timeout: 10000 });
    console.log('[agent13][NONREG][SUPER ADMIN] /apurement : onglets horizontaux toujours présents.');
    await window.screenshot({ path: join(SHOT_DIR, 'agent13-sb4-superadmin-01-tabs.png') });
  });

  test('G. Aucune erreur console/pageerror imputable au scénario', async () => {
    const relevant = consoleErrors.filter((e) => !/DevTools|Autofill|ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED/.test(e));
    if (relevant.length > 0) {
      console.log('[QA-CHECK][Erreurs console capturées]\n' + relevant.join('\n'));
    }
    expect(relevant).toEqual([]);
  });
});
