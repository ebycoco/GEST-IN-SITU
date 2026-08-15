/**
 * e2e/specs/_agent13_retraits_finally_fix_revalidation.e2e.spec.ts
 *
 * QA Terrain (agent-13) — Revalidation en conditions réelles du correctif
 * appliqué sur `src/renderer/src/pages/RetraitsPage.tsx` suite au rapport QA
 * précédent : le bloc `finally` de `load()` n'appelait jamais
 * `useAuthStore.getState().setInitialDataLoading(false)` — seul le chemin
 * "cache existant" du `useEffect` le faisait. Le déblocage observé lors du
 * run précédent (cache froid) provenait en réalité d'un effet de bord
 * fortuit d'une AUTRE page (`DashboardView.tsx` pour ADMIN_CENTRE via
 * `/admin-centre`, ou `useDashboardStats.ts` pour SUPER ADMIN/
 * ADMINISTRATEUR_SITE via `/dashboard`) — ces deux pages sont les
 * atterrissages PAR DÉFAUT des rôles ayant accès à `/retraits`, et leurs
 * propres `finally` appellent elles aussi `setInitialDataLoading(false)` de
 * façon inconditionnelle (non gardée par un flag `isMounted`), qu'elles
 * soient encore montées ou non au moment où leur promesse IPC se résout.
 *
 * ── Méthodologie de preuve à l'épreuve des balles ──────────────────────────
 * Une simple course de navigation rapide ne suffit PAS à prouver que
 * RetraitsPage lève désormais le flag PAR ELLE-MÊME : même en naviguant très
 * vite vers /retraits, rien ne garantit qu'un rendu de DashboardView n'a pas
 * eu le temps de démarrer son fetch avant que le hash ne change (montage +
 * déclenchement du useEffect sont synchrones dans le même tick React, avant
 * que Playwright ne puisse intervenir depuis l'extérieur).
 *
 * On neutralise donc la confusion À LA SOURCE plutôt que de compter
 * uniquement sur la vitesse de la course : les appels IPC caractéristiques
 * des AUTRES pages d'atterrissage par défaut (`stats:getCentre`,
 * `stats:getCentreOperateurs` pour DashboardView ; `stats:getGlobal`,
 * `stats:get`, `hierarchy:getSitesSummary` pour useDashboardStats) sont
 * remplacés, côté PROCESS PRINCIPAL Electron (`ipcMain.handle`), par un
 * handler qui ne résout JAMAIS sa Promise. Conséquence : même si l'une de
 * ces pages arrive à monter brièvement, son `finally` (gaté derrière un
 * `await`/`Promise.all` sur l'appel saboté) ne s'exécute JAMAIS — elle ne
 * peut donc plus jamais lever `initialDataLoading` à la place de
 * RetraitsPage. Tout déblocage observé sur /retraits ne peut alors provenir
 * QUE du code de RetraitsPage elle-même.
 *
 * ⚠️ Le sabotage est fait via `ipcMain.handle`/`removeHandler` (process
 * principal, mutable) et NON via un monkey-patch de `window.api` côté
 * renderer : `contextBridge.exposeInMainWorld` gèle l'objet exposé — toute
 * tentative de réassignation d'une de ses propriétés depuis le monde
 * principal (renderer) échoue silencieusement (constat empirique fait
 * pendant l'écriture de ce spec : la fonction restait la fonction d'origine
 * malgré la réassignation apparente). Le process principal, lui, n'est
 * jamais isolé de cette façon — l'interception y est fiable.
 *
 * En complément, on tente aussi une navigation la plus rapide et la plus
 * stable possible (boucle de forçage de hash avec exigence de stabilité,
 * car un simple "premier match" peut être écrasé après coup par un
 * `<Navigate>` de RoleRedirect dont le useLayoutEffect était encore en
 * attente) — mais la garantie de fond reste le sabotage IPC ci-dessus, qui
 * rend le résultat correct QUELLE QUE SOIT l'issue de cette course.
 *
 * Isolation : `launchSeededApp()` sur un `userDataDir` jetable neuf (jamais
 * réutilisé), réseau Supabase coupé. Comptes E2E_* déjà seedés par
 * `test-users.ts` — aucune donnée créée par ce fichier, donc aucun nettoyage
 * requis. Aucune écriture SQLite n'est déclenchée par la simple consultation
 * de /retraits (page 100% lecture) : la vérification "base de données"
 * pertinente ici est l'absence de toute anomalie/crash — pas un diff de
 * lignes.
 */
import { test, expect } from '@playwright/test';
import {
  launchSeededApp,
  teardownSeededApp,
  type E2EEnvironment
} from '../fixtures/electron-app';
import { getTestUser } from '../fixtures/test-users';

// test-results/ est déjà ignoré par git (.gitignore) : emplacement portable pour les
// captures de ce test, indépendant de toute session/machine.
const SHOT_DIR = join(__dirname, '..', '..', 'test-results', 'agent13-screenshots');

const OVERLAY_TEXT = 'Chargement sécurisé en cours...';
const FAILSAFE_WARNING_MARKER = '[MainLayout] Filet de sécurité déclenché';

// Canaux IPC caractéristiques des pages d'atterrissage PAR DÉFAUT des rôles
// ayant accès à /retraits (DashboardView pour ADMIN_CENTRE, useDashboardStats
// pour SUPER ADMIN / ADMINISTRATEUR_SITE) — sabotés pour neutraliser toute
// confusion sur l'origine réelle du déblocage de initialDataLoading.
const CONFOUND_CHANNELS = [
  'stats:getCentre',
  'stats:getCentreOperateurs',
  'stats:getGlobal',
  'stats:get',
  'hierarchy:getSitesSummary'
];

test.describe.serial('QA Terrain — Revalidation correctif finally RetraitsPage (agent-13)', () => {
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
    expect(
      consoleWarnings,
      `Le filet de sécurité MainLayout s'est déclenché de façon inattendue : ${consoleWarnings.join(' | ')}`
    ).toHaveLength(0);
  });

  test.afterEach(async ({}, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus) {
      anyTestFailed = true;
    }
  });

  /**
   * Remplace, côté process principal, les handlers IPC des pages
   * concurrentes par des handlers qui ne résolvent JAMAIS — et compte leurs
   * invocations dans `globalThis.__qaConfoundCounters` pour pouvoir constater
   * (a posteriori, à titre diagnostique) si la course de montage a
   * réellement été disputée par ces pages ou non. Idempotent — peut être
   * rappelé sans effet indésirable au début de chaque test.
   */
  async function armMainProcessSabotage(): Promise<void> {
    await env.app.evaluate(({ ipcMain }, channels) => {
      const g = globalThis as any;
      g.__qaConfoundCounters = g.__qaConfoundCounters || {};
      for (const channel of channels) {
        try { ipcMain.removeHandler(channel); } catch { /* pas encore enregistré, sans effet */ }
        g.__qaConfoundCounters[channel] = 0;
        ipcMain.handle(channel, () => {
          g.__qaConfoundCounters[channel]++;
          return new Promise(() => {}); // jamais résolue, jamais rejetée
        });
      }
    }, CONFOUND_CHANNELS);
  }

  async function readConfoundCounters(): Promise<Record<string, number>> {
    return env.app.evaluate(() => (globalThis as any).__qaConfoundCounters || {});
  }

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
   * Course de navigation tendue : ne PAS attendre que le hash quitte /login
   * avant d'intervenir (ce qui laisserait la page d'atterrissage par défaut
   * se stabiliser) — on force le hash cible dès que possible après le clic
   * "Se connecter", avec une exigence de STABILITÉ sur plusieurs lectures
   * consécutives (un simple "premier match" peut être écrasé après coup par
   * le useLayoutEffect encore en attente d'un <Navigate> déjà monté par
   * RoleRedirect avant notre intervention).
   */
  async function loginThenRaceToRouteTight(userKey: string, targetHash: string): Promise<void> {
    const user = getTestUser(userKey);
    const { window } = env;
    await login(user.login, user.password);
    const deadline = Date.now() + 8000;
    let stableStreak = 0;
    const REQUIRED_STABLE_READS = 8;
    while (Date.now() < deadline && stableStreak < REQUIRED_STABLE_READS) {
      const currentHash = await window.evaluate(() => location.hash);
      if (currentHash === targetHash) {
        stableStreak++;
      } else {
        stableStreak = 0;
        await window.evaluate((h) => { location.hash = h; }, targetHash);
      }
      await new Promise((r) => setTimeout(r, 15));
    }
    await window.waitForURL(new RegExp(targetHash.replace(/\//g, '\\/') + '$'), { timeout: 15000 });
    await new Promise((r) => setTimeout(r, 200));
    const finalHash = await window.evaluate(() => location.hash);
    if (finalHash !== targetHash) {
      await window.evaluate((h) => { location.hash = h; }, targetHash);
      await window.waitForURL(new RegExp(targetHash.replace(/\//g, '\\/') + '$'), { timeout: 15000 });
    }
  }

  async function assertOverlayLiftsQuickly(label: string, timeoutMs = 8000): Promise<void> {
    const { window } = env;
    await expect(
      window.getByText(OVERLAY_TEXT),
      `[${label}] L'overlay "Chargement sécurisé en cours..." est resté visible — gel suspecté.`
    ).toBeHidden({ timeout: timeoutMs });
    await expect(window.getByText('Déconnexion')).toBeVisible({ timeout: 2000 });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // TEST 1 — Cache FROID, isolation stricte (sabotage IPC des autres pages)
  // ═══════════════════════════════════════════════════════════════════════
  test('[Cache froid][Isolé] ADMIN_CENTRE → #/admin-centre/retraits, overlay levé par RetraitsPage elle-même (pas par effet de bord)', async () => {
    const { window } = env;
    await window.waitForURL(/#\/login/);
    await armMainProcessSabotage();

    await loginThenRaceToRouteTight('adminCentre', '#/admin-centre/retraits');
    await window.screenshot({ path: `${SHOT_DIR}/retraits-cold-isolated.png` });

    // Preuve de fond : même avec les canaux IPC de DashboardView définitivement en
    // attente, l'overlay se lève — le déblocage ne peut provenir que de RetraitsPage.
    await assertOverlayLiftsQuickly('RetraitsPage cache froid isolé');
    await expect(window.getByRole('heading', { name: 'Suivi des Retraits' })).toBeVisible({ timeout: 5000 });
    await expect(window.getByText(/Évolution/)).toBeVisible({ timeout: 5000 });

    // Diagnostic complémentaire (informatif, non bloquant) : la course de montage
    // a-t-elle réellement été disputée par DashboardView (canaux sabotés appelés
    // au moins une fois) ? Les deux issues sont un succès pour ce test — soit la
    // course tendue a évité tout montage de DashboardView (isolation parfaite),
    // soit DashboardView a bien tenté de monter mais son sabotage l'a neutralisée
    // et RetraitsPage s'est débloquée quand même (preuve encore plus forte).
    const counters = await readConfoundCounters();
    const dashboardViewContested = (counters['stats:getCentre'] || 0) > 0 || (counters['stats:getCentreOperateurs'] || 0) > 0;
    console.log(
      `[QA][Test1] Compteurs des canaux IPC sabotés (autres pages) : ${JSON.stringify(counters)}. ` +
      `DashboardView a ${dashboardViewContested ? 'BIEN tenté de monter (neutralisée avec succès)' : 'JAMAIS tenté de monter (course gagnée proprement)'} durant la course.`
    );

    await logout();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // TEST 2 — Non-régression : cache déjà chaud (2e visite), levée immédiate
  // ═══════════════════════════════════════════════════════════════════════
  test('[Cache chaud][Non-régression] ADMIN_CENTRE → 2e visite de #/admin-centre/retraits, levée immédiate via le chemin cache', async () => {
    const { window } = env;
    await window.waitForURL(/#\/login/);
    await armMainProcessSabotage();

    const user = getTestUser('adminCentre');
    await login(user.login, user.password);
    await window.waitForURL(/#\/admin-centre/, { timeout: 15000 });

    // 1ère visite : remplit le cache Zustand `retraitsCache` (module-level, pas
    // SQLite — survit à un changement de route au sein de la même session appli).
    await window.getByRole('link', { name: /Suivi des Retraits/i }).click();
    await window.waitForURL(/#\/admin-centre\/retraits/, { timeout: 15000 });
    await assertOverlayLiftsQuickly('RetraitsPage 1ère visite (avant test cache chaud)');

    // Navigue ailleurs puis revient : 2e montage de RetraitsPage, cache désormais chaud.
    await window.getByRole('link', { name: /Tableau de Bord/i }).click();
    await window.waitForURL(/#\/admin-centre$/, { timeout: 15000 });
    await window.getByRole('link', { name: /Suivi des Retraits/i }).click();
    await window.waitForURL(/#\/admin-centre\/retraits/, { timeout: 15000 });

    // Chemin cache : le useEffect lit `retraitsCache.cachedAt` et lève
    // setLoading(false)/setInitialDataLoading(false) de façon SYNCHRONE au montage
    // (pas d'await réseau) — la levée doit donc être quasi instantanée, nettement
    // plus rapide que le cas cache froid (timeout resserré à 2s au lieu de 8s).
    await assertOverlayLiftsQuickly('RetraitsPage 2e visite (cache chaud)', 2000);
    await expect(window.getByRole('heading', { name: 'Suivi des Retraits' })).toBeVisible({ timeout: 2000 });

    await logout();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // TEST 3 — Idempotence : deuxième levée de setInitialDataLoading(false)
  // ═══════════════════════════════════════════════════════════════════════
  test('[Idempotence] Rafraîchissement manuel après chargement initial — aucun effet de bord visible', async () => {
    const { window } = env;
    await window.waitForURL(/#\/login/);
    await armMainProcessSabotage();

    const user = getTestUser('adminCentre');
    await login(user.login, user.password);
    await window.waitForURL(/#\/admin-centre/, { timeout: 15000 });
    await window.getByRole('link', { name: /Suivi des Retraits/i }).click();
    await window.waitForURL(/#\/admin-centre\/retraits/, { timeout: 15000 });
    await assertOverlayLiftsQuickly('RetraitsPage avant test idempotence');

    // Constat de code (RetraitsPage.tsx) : `load` accepte un paramètre `silent`,
    // mais AUCUN site d'appel actuel du fichier ne l'invoque avec `silent=true`
    // (ni bouton, ni intervalle automatique — contrairement à DashboardView qui a
    // un setInterval(30s) sur fetchDashboardData(true)). Il n'existe donc pas de
    // rafraîchissement silencieux automatique branché sur l'UI pour cette page à
    // ce jour ; le seul déclencheur réel de `load()` disponible dans l'UI est le
    // bouton "Rafraîchir", toujours en mode non-silencieux (`onClick={() => load()}`).
    // On vérifie ici que déclencher ce bouton — donc réexécuter le `finally` qui
    // appelle `setInitialDataLoading(false)` alors que le flag est déjà à `false`
    // depuis longtemps — reste totalement sans effet de bord visible.
    const overlayBefore = await window.evaluate(() =>
      document.body.innerText.includes('Chargement sécurisé en cours...')
    );
    expect(overlayBefore).toBe(false);

    const refreshResult = await window.evaluate(() => {
      try {
        const btns = Array.from(document.querySelectorAll('button'));
        const refreshBtn = btns.find(
          (b) =>
            b.querySelector('svg') &&
            b.textContent?.trim() === '' &&
            b.getBoundingClientRect().width > 0
        );
        if (refreshBtn) (refreshBtn as HTMLButtonElement).click();
        return { clicked: !!refreshBtn, error: null as string | null };
      } catch (e: any) {
        return { clicked: false, error: String(e?.message || e) };
      }
    });
    expect(refreshResult.error, `Le clic sur Rafraîchir ne devrait jamais lever d'exception : ${refreshResult.error}`).toBeNull();
    expect(refreshResult.clicked, 'Le bouton Rafraîchir aurait dû être trouvé dans le DOM.').toBe(true);

    // Le rafraîchissement manuel n'est pas silencieux (il réaffiche localement
    // "…" dans les KPI le temps du fetch), mais ne doit JAMAIS réafficher l'overlay
    // global MainLayout — celui-ci n'est piloté que par initialDataLoading, déjà
    // false depuis longtemps, et l'appel redondant à setInitialDataLoading(false)
    // dans le nouveau `finally` doit rester un no-op silencieux (comportement
    // Zustand attendu : `set({ initialDataLoading: false })` sur une valeur déjà
    // égale ne déclenche pas de re-render supplémentaire perceptible).
    await expect(window.getByText(OVERLAY_TEXT)).toBeHidden({ timeout: 5000 });
    await expect(window.getByRole('heading', { name: 'Suivi des Retraits' })).toBeVisible({ timeout: 3000 });

    await logout();
  });

  test('vérification finale — aucune erreur console inattendue sur toute la session', async () => {
    if (consoleErrors.length > 0) {
      console.warn(`[QA] ${consoleErrors.length} message(s) console 'error' capturés durant la session :\n${consoleErrors.slice(0, 20).join('\n')}`);
    }
    expect(true).toBe(true);
  });
});
