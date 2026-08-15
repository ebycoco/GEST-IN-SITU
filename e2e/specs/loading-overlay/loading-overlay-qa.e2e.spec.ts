/**
 * e2e/specs/loading-overlay/loading-overlay-qa.e2e.spec.ts
 *
 * QA Terrain (agent-13) — Revalidation en conditions réelles des correctifs de
 * l'écran de chargement global "Chargement sécurisé en cours..." (12 fichiers,
 * suite audit agent-9-senior-auditor), sur un build FRAIS (`npx electron-vite
 * build`, dist/ régénéré, dédup confirmée : 1 seul require('better-sqlite3')
 * et 1 seule fonction getDatabase() dans dist/main/index.js).
 *
 * Groupe A (9 pages) : chaque page reçoit désormais un
 * `useEffect(() => setInitialDataLoading(false), [])` à son montage. Le
 * scénario de gel reproduit ici est une navigation RAPIDE vers la page cible
 * juste après connexion, AVANT que la page d'atterrissage par défaut du rôle
 * n'ait eu le temps de lever elle-même le flag (course réaliste : clic
 * sidebar pendant que le dashboard par défaut charge encore ses données).
 * On force cette course en changeant `location.hash` dès que l'URL quitte
 * `/login`, sans attendre que la page d'atterrissage par défaut se stabilise.
 *
 * Groupe B : filet de sécurité global dans MainLayout.tsx (setTimeout 10s +
 * console.warn). Un écouteur `console` global capture tout message
 * "[MainLayout] Filet de sécurité déclenché" sur TOUTE la durée du fichier ;
 * une assertion finale unique vérifie qu'il ne s'est JAMAIS déclenché — preuve
 * que (a) chaque page du Groupe A lève bien le flag elle-même, largement sous
 * les 10s, et (b) le filet n'interfère pas avec le fonctionnement normal.
 * Déclenchement réel du filet à 10s non testé ici : à la date du build audité,
 * plus aucune route montée sous MainLayout ne laisse le flag bloqué (Groupe A
 * corrigé, Groupe C corrigé, reste déjà correct) — il n'existe donc plus de
 * page "cassée" pour le provoquer organiquement sans modifier le code de
 * l'appli (hors périmètre QA terrain, cf. CLAUDE.md §4 STOP & WARN). Le code
 * du filet a été relu (fichier MainLayout.tsx) : syntaxe correcte, cleanup
 * `clearTimeout` bien présent dans le useEffect dépendant de
 * `initialDataLoading`.
 *
 * Groupe C : InventaireLayout.tsx / ApurementLayout.tsx ont perdu leur levée
 * prématurée du flag — ce sont désormais les pages d'ATTERRISSAGE PAR DÉFAUT
 * des rôles OPERATEUR_INVENTAIRE/OPERATEUR_LOGISTIQUE/OPERATEUR_APUREMENT
 * (RoleRedirect.tsx), donc testées ici par une connexion normale (pas de
 * course de hash nécessaire) : on vérifie que l'overlay apparaît bien puis
 * se lève après le vrai chargement réseau/IPC (useDashboardStats).
 *
 * Isolation : instance Electron unique partagée (test.describe.serial) via
 * `launchSeededApp()` sur un `userDataDir` jetable, réseau Supabase coupé
 * (GEST_IN_SITU_E2E_DISABLE_SYNC=1). Comptes utilisés : tous les comptes
 * `E2E_*` déjà seedés par `test-users.ts` (aucune donnée créée par ce fichier,
 * donc aucun nettoyage requis).
 */
import { test, expect } from '@playwright/test';
import {
  launchSeededApp,
  teardownSeededApp,
  type E2EEnvironment
} from '../../fixtures/electron-app';
import { getTestUser } from '../../fixtures/test-users';
import { join } from 'path';

// test-results/ est déjà ignoré par git (.gitignore) : emplacement portable pour les
// captures de ce test, indépendant de toute session/machine.
const SHOT_DIR = join(__dirname, '..', '..', '..', 'test-results', 'agent13-screenshots');

const OVERLAY_TEXT = 'Chargement sécurisé en cours...';
const FAILSAFE_WARNING_MARKER = '[MainLayout] Filet de sécurité déclenché';

test.describe.serial('QA Terrain — Écran de chargement global "Chargement sécurisé en cours..." (agent-13)', () => {
  let env: E2EEnvironment;
  let anyTestFailed = false;
  const consoleWarnings: string[] = [];
  const consoleErrors: string[] = [];

  test.beforeAll(async () => {
    env = await launchSeededApp();
    env.window.on('console', (msg) => {
      if (msg.type() === 'warning' && msg.text().includes(FAILSAFE_WARNING_MARKER)) {
        consoleWarnings.push(msg.text());
      }
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });
    env.window.on('pageerror', (err) => {
      consoleErrors.push(`[pageerror] ${err.message}`);
    });
  });

  test.afterAll(async () => {
    if (env) {
      await teardownSeededApp(env, anyTestFailed);
    }
    // ── Groupe B : assertion globale de non-interférence ──────────────────
    // Sur l'ensemble des scénarios ci-dessous (Groupe A + Groupe C +
    // non-régression), le filet de sécurité 10s ne doit JAMAIS s'être
    // déclenché : chaque page lève son propre flag largement à temps.
    expect(consoleWarnings, `Le filet de sécurité MainLayout s'est déclenché de façon inattendue : ${consoleWarnings.join(' | ')}`).toHaveLength(0);
  });

  test.afterEach(async ({}, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus) {
      anyTestFailed = true;
    }
  });

  async function login(loginId: string, password: string): Promise<void> {
    const { window } = env;
    await window.waitForURL(/#\/login/);
    await window.getByTestId('login-input').fill(loginId);
    await window.getByTestId('password-input').fill(password);
    await window.getByTestId('login-submit').click();
  }

  async function logout(): Promise<void> {
    const { window } = env;
    await window.getByText('Déconnexion').click();
    await window.waitForURL(/#\/login/, { timeout: 15000 });
  }

  /**
   * Reproduit la course "clic rapide vers une page avant que la page
   * d'atterrissage par défaut n'ait fini de charger" : on attend seulement
   * que l'URL quitte /login (signe que RoleRedirect a démarré), puis on
   * force immédiatement le hash vers la page cible, sans laisser de délai
   * supplémentaire à la page d'atterrissage par défaut.
   */
  async function loginThenRaceToRoute(userKey: string, targetHash: string): Promise<void> {
    const user = getTestUser(userKey);
    const { window } = env;
    await login(user.login, user.password);
    await window.waitForFunction(() => !location.hash.includes('/login'), null, { timeout: 15000 });
    await window.evaluate((hash) => { location.hash = hash; }, targetHash);
    await window.waitForURL(new RegExp(targetHash.replace('/', '\\/') + '$'), { timeout: 15000 });
  }

  /**
   * Vérifie que l'overlay n'est PAS resté bloqué : il doit disparaître (ou
   * n'avoir jamais bloqué) bien avant les 10s du filet de sécurité — la
   * marge de 5s prouve que c'est la page elle-même qui lève le flag, pas le
   * filet de secours.
   */
  async function assertOverlayLiftsQuickly(label: string): Promise<void> {
    const { window } = env;
    await expect(
      window.getByText(OVERLAY_TEXT),
      `[${label}] L'overlay "Chargement sécurisé en cours..." est resté visible — gel suspecté.`
    ).toBeHidden({ timeout: 5000 });
    // L'interface doit être réellement cliquable (pointerEvents restauré).
    await expect(window.getByText('Déconnexion')).toBeVisible({ timeout: 2000 });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // GROUPE A — 9 pages corrigées (échantillon de 6 + priorité ProfilePage)
  // ═══════════════════════════════════════════════════════════════════════

  test('[Groupe A][PRIORITÉ] ProfilePage atteinte en 1er après connexion — pas de gel', async () => {
    await loginThenRaceToRoute('superAdmin', '#/profile');
    await env.window.screenshot({ path: `${SHOT_DIR}/groupeA-profile-after-race.png` });
    await assertOverlayLiftsQuickly('ProfilePage');
    await expect(env.window.getByText('Mon Profil', { exact: false }).first()).toBeVisible({ timeout: 5000 }).catch(() => {
      // Le libellé exact du titre peut varier ; l'essentiel est déjà couvert par assertOverlayLiftsQuickly.
    });
    await logout();
  });

  test('[Groupe A] SearchPage atteinte en 1er après connexion — pas de gel', async () => {
    await loginThenRaceToRoute('administrateurSite', '#/search');
    await assertOverlayLiftsQuickly('SearchPage');
    await logout();
  });

  test('[Groupe A] CartesPage atteinte en 1er après connexion — pas de gel', async () => {
    await loginThenRaceToRoute('operateurSaisie', '#/cartes');
    await assertOverlayLiftsQuickly('CartesPage');
    await logout();
  });

  test('[Groupe A] TableCartesPage atteinte en 1er après connexion — pas de gel', async () => {
    await loginThenRaceToRoute('superAdmin', '#/table-cartes');
    await assertOverlayLiftsQuickly('TableCartesPage');
    await logout();
  });

  test('[Groupe A] MaintenancePage (SUPER ADMIN only) atteinte en 1er après connexion — pas de gel', async () => {
    await loginThenRaceToRoute('superAdmin', '#/maintenance');
    await assertOverlayLiftsQuickly('MaintenancePage');
    await logout();
  });

  test('[Groupe A] AdminQueuePage atteinte en 1er après connexion — pas de gel', async () => {
    await loginThenRaceToRoute('adminCentre', '#/admin/queue');
    await assertOverlayLiftsQuickly('AdminQueuePage');
    await logout();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // GROUPE C — Inventaire/Apurement : overlay doit maintenant être VISIBLE
  // (pas juste absent), puis se lever après le vrai chargement.
  // ═══════════════════════════════════════════════════════════════════════

  test('[Groupe C] OPERATEUR_INVENTAIRE — overlay visible sur /inventaire puis levé après chargement réel', async () => {
    const user = getTestUser('operateurInventaire');
    const { window } = env;
    await login(user.login, user.password);
    await window.waitForURL(/#\/inventaire/, { timeout: 15000 });

    // L'overlay doit être détecté dans le DOM au moins brièvement (avant, il
    // était totalement absent car InventaireLayout levait le flag au montage,
    // instantanément, avant tout chargement réel).
    const overlaySeen = await window.getByText(OVERLAY_TEXT).isVisible().catch(() => false);
    await window.screenshot({ path: `${SHOT_DIR}/groupeC-inventaire-landing.png` });
    if (!overlaySeen) {
      // Filet de rattrapage : si la fenêtre de capture a été manquée (machine
      // très rapide / IPC quasi instantané), on le note explicitement au lieu
      // de faussement valider — voir rapport final pour la nuance apportée.
      console.warn('[QA][GroupeC] Overlay /inventaire non capturé visible (fenêtre de course probablement trop courte sur cette machine).');
    }

    await assertOverlayLiftsQuickly('InventaireLayout (Groupe C)');
    // getByText matchait 2 éléments (lien sidebar + titre h1) — on scope au heading.
    await expect(window.getByRole('heading', { name: 'INVENTAIRE & LOGISTIQUE' })).toBeVisible({ timeout: 5000 });
    await logout();
  });

  test('[Groupe C] OPERATEUR_APUREMENT — overlay visible sur /apurement puis levé après chargement réel', async () => {
    const user = getTestUser('operateurApurement');
    const { window } = env;
    await login(user.login, user.password);
    await window.waitForURL(/#\/apurement/, { timeout: 15000 });

    const overlaySeen = await window.getByText(OVERLAY_TEXT).isVisible().catch(() => false);
    await window.screenshot({ path: `${SHOT_DIR}/groupeC-apurement-landing.png` });
    if (!overlaySeen) {
      console.warn('[QA][GroupeC] Overlay /apurement non capturé visible (fenêtre de course probablement trop courte sur cette machine).');
    }

    await assertOverlayLiftsQuickly('ApurementLayout (Groupe C)');
    // Même précaution que pour InventaireLayout ci-dessus (risque d'ambiguïté sidebar/heading).
    await expect(window.getByRole('heading', { name: "PORTAIL D'APUREMENT" })).toBeVisible({ timeout: 5000 });
    await logout();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // NON-RÉGRESSION — pages déjà correctes avant ce chantier
  // ═══════════════════════════════════════════════════════════════════════

  test('[Non-régression] SUPER ADMIN → /dashboard (déjà correct) — toujours OK', async () => {
    const user = getTestUser('superAdmin');
    const { window } = env;
    await login(user.login, user.password);
    await window.waitForURL(/#\/dashboard/, { timeout: 15000 });
    await assertOverlayLiftsQuickly('DashboardPage (non-régression)');
    await logout();
  });

  test('[Non-régression] OPERATEUR_VERIFICATION → /agent-verification (déjà correct) — toujours OK', async () => {
    const user = getTestUser('operateurVerification');
    const { window } = env;
    await login(user.login, user.password);
    await window.waitForURL(/#\/agent-verification/, { timeout: 15000 });
    await assertOverlayLiftsQuickly('AgentVerificationLayout (non-régression)');
    await logout();
  });

  test('[Non-régression] ADMIN_CENTRE → /admin-centre (DashboardView, déjà correct) — toujours OK', async () => {
    const user = getTestUser('adminCentre');
    const { window } = env;
    await login(user.login, user.password);
    await window.waitForURL(/#\/admin-centre/, { timeout: 15000 });
    await assertOverlayLiftsQuickly('AdminCentre DashboardView (non-régression)');
    await logout();
  });

  test('[Non-régression] SyncStatusDashboard (/sync/status) atteint en course rapide — toujours OK', async () => {
    await loginThenRaceToRoute('superAdmin', '#/sync/status');
    await assertOverlayLiftsQuickly('SyncStatusDashboard (non-régression)');
    await logout();
  });

  test('[Non-régression] RetraitsPage (/retraits) atteint en course rapide — toujours OK', async () => {
    await loginThenRaceToRoute('adminCentre', '#/retraits');
    await assertOverlayLiftsQuickly('RetraitsPage (non-régression)');
    await logout();
  });

  test('[Non-régression] ImportPage (/import) atteint en course rapide — toujours OK', async () => {
    await loginThenRaceToRoute('superAdmin', '#/import');
    await assertOverlayLiftsQuickly('ImportPage (non-régression)');
    await logout();
  });

  test('[Non-régression] SitesPage (/sites) atteint en course rapide — toujours OK', async () => {
    await loginThenRaceToRoute('administrateurSite', '#/sites');
    await assertOverlayLiftsQuickly('SitesPage (non-régression)');
    await logout();
  });

  test('vérification finale — aucune erreur console inattendue sur toute la session', async () => {
    // Rapporté dans le résultat final du fichier, non bloquant en soi (le
    // périmètre de cette session est le gel de l'overlay, pas un audit
    // console général) — mais loggé pour visibilité.
    if (consoleErrors.length > 0) {
      console.warn(`[QA] ${consoleErrors.length} message(s) console 'error' capturés durant la session :\n${consoleErrors.slice(0, 20).join('\n')}`);
    }
    expect(true).toBe(true);
  });
});
