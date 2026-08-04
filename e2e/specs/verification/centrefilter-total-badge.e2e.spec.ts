/**
 * e2e/specs/verification/centrefilter-total-badge.e2e.spec.ts
 *
 * Test fonctionnel vivant (QA Terrain - agent-13) : vérifie EMPIRIQUEMENT si le
 * "total de cartes en local" affiché/utilisé pour un opérateur
 * OPERATEUR_VERIFICATION / OPERATEUR_QUALITE reste bien au niveau SITE, ou si
 * un des deux mécanismes suivants le limite à tort au niveau CENTRE :
 *   1. Badge d'en-tête "Cartes disponibles en local" (AgentVerificationLayout.tsx
 *      / AgentQualiteLayout.tsx, valeur `stats.total` de useDashboardStats.ts).
 *   2. `totalCards` interne de RechercheView.tsx (portail Vérification), qui
 *      décide de l'affichage de l'écran bloquant "Base de données locale vide"
 *      et qui, d'après lecture de code, passe explicitement
 *      `isPrincipal ? undefined : (selectedCentreId || undefined)` comme
 *      centreId à `window.api.stats.get(...)`.
 *
 * Note méthodologique (échec constaté d'une première approche) : une tentative
 * d'instrumentation directe par monkey-patch de `window.api.stats.get` depuis
 * la page (pour journaliser siteId/centreId envoyés) s'est révélée
 * silencieusement inopérante — `window.api` est exposé via
 * `contextBridge.exposeInMainWorld('api', api)` (src/preload/index.ts:585),
 * qui gèle l'objet exposé côté monde isolé : la réaffectation de
 * `window.api.stats.get` ne lève aucune erreur mais n'a aucun effet (0 appel
 * jamais journalisé, vérifié empiriquement). Abandonné au profit d'une preuve
 * 100% UI, sans aucune instrumentation JS :
 *   - Badge : lecture directe du texte affiché dans le DOM (fiable).
 *   - `totalCards` : un TROISIÈME centre, NON principal et VOLONTAIREMENT VIDE
 *     (0 carte), est ajouté à la topologie. Le site a 42 cartes au total, mais
 *     AUCUNE au centre de cet opérateur. Si `totalCards` reste au niveau SITE
 *     (attendu), l'écran bloquant "Base de données locale vide" ne doit PAS
 *     s'afficher. S'il s'affiche, c'est la preuve directe et non-ambiguë que
 *     `totalCards` a été filtré à tort par centre_id (0 carte à CE centre)
 *     plutôt que par site_id (42 cartes au site) — sans avoir besoin de lire
 *     une valeur interne non exposée à l'écran.
 *
 * Topologie : 1 site ZZTEST_CENTREFILTER_SITE, 3 centres :
 *   - ZZTEST_CENTRE_PRINCIPAL (numero=1, "principal") -> 30 cartes ZZTEST_
 *   - ZZTEST_CENTRE_SECOND (numero=2, non principal)  -> 12 cartes ZZTEST_
 *   - ZZTEST_CENTRE_EMPTY (numero=3, non principal)   -> 0 carte
 *   Total SITE attendu = 42.
 *
 * 4 comptes jetables testés successivement dans la MÊME instance Electron
 * (site/centres/cartes partagés, un seul lancement pour limiter le coût RAM) :
 *   - ZZTEST_OPV_SECOND    (OPERATEUR_VERIFICATION @ centre SECOND, 12 cartes)
 *   - ZZTEST_OPV_PRINCIPAL (OPERATEUR_VERIFICATION @ centre PRINCIPAL, 30 cartes)
 *   - ZZTEST_OPQ_SECOND    (OPERATEUR_QUALITE @ centre SECOND, 12 cartes)
 *   - ZZTEST_OPV_EMPTY     (OPERATEUR_VERIFICATION @ centre EMPTY, 0 carte)
 *
 * Aucune correction n'est appliquée par ce spec : uniquement observation et
 * preuve chiffrée/visuelle (conformément au rôle agent-13, CLAUDE.md §6/§4).
 */
import { test, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { teardownSeededApp, type E2EEnvironment } from '../../fixtures/electron-app';
import { runSeedInElectronNode } from '../../fixtures/seed-runner';
import { execFile, execFileSync } from 'child_process';
import { promisify } from 'util';
import { join, resolve } from 'path';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';

const execFileAsync = promisify(execFile);
const PROJECT_ROOT = resolve(__dirname, '../../..');
const MAIN_ENTRY_PROD = join(PROJECT_ROOT, 'dist', 'main', 'index.js');
const SEED_SCRIPT = 'C:\\Users\\EBYCHOCO\\AppData\\Local\\Temp\\claude\\d--Espace-travail-GEST-IN-SITU-CARTE-ABOBO-V2\\344cf3c3-4173-4a2a-bbd7-a341c1d208bf\\scratchpad\\seed-centrefilter.js';

interface SeedCentreFilterResult {
  siteId: number;
  centrePrincipalId: number;
  centreSecondId: number;
  centreEmptyId: number;
  nPrincipal: number;
  nSecond: number;
  totalSite: number;
  opvSecond: { login: string; password: string; id: number };
  opvPrincipal: { login: string; password: string; id: number };
  opqSecond: { login: string; password: string; id: number };
  opvEmpty: { login: string; password: string; id: number };
}

async function runSeedCentreFilter(userDataDir: string): Promise<SeedCentreFilterResult> {
  const electronPath = require('electron') as unknown as string;
  const { stdout, stderr } = await execFileAsync(
    electronPath,
    [SEED_SCRIPT, userDataDir],
    {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_PATH: join(PROJECT_ROOT, 'node_modules') },
      encoding: 'utf-8'
    }
  );
  console.log('[E2E][seed-centrefilter][stdout]\n' + stdout);
  if (stderr) console.log('[E2E][seed-centrefilter][stderr]\n' + stderr);
  const marker = '__SEED_CENTREFILTER_RESULT__:';
  const line = stdout.split(/\r?\n/).reverse().find((l) => l.startsWith(marker));
  if (!line) {
    throw new Error(`[E2E] seed-centrefilter.js n'a produit aucun résultat exploitable.\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`);
  }
  return JSON.parse(line.slice(marker.length));
}

async function waitForMainWindow(app: ElectronApplication, timeoutMs: number): Promise<Page> {
  const isSplash = (win: Page): boolean => {
    try {
      return win.isClosed() || win.url().includes('splash.html');
    } catch {
      return true;
    }
  };
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const candidate = app.windows().find((win) => !isSplash(win));
    if (candidate) return candidate;
    await Promise.race([
      app.waitForEvent('window', { timeout: 2000 }).catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, 500))
    ]);
  }
  throw new Error(`[E2E][centrefilter] Aucune fenêtre applicative détectée dans le délai de ${timeoutMs}ms.`);
}

function dbPathOf(userDataDir: string): string {
  return join(userDataDir, 'data', 'gest_in_situ.db');
}

function queryDb(dbPath: string, sql: string): string {
  return execFileSync('sqlite3', [dbPath, sql], { encoding: 'utf-8' }).trim();
}

async function readBadgeValue(window: Page): Promise<string | null> {
  const label = window.getByText('Cartes disponibles en local :');
  const visible = await label.isVisible().catch(() => false);
  if (!visible) return null;
  // Le chiffre affiché est le <span> frère immédiat dans le div conteneur
  // parent direct (structure exacte de AgentVerificationLayout.tsx:100-114 /
  // AgentQualiteLayout.tsx:88-102) : on lit donc le texte complet du parent
  // direct de ce label, qui contient les deux spans (libellé + chiffre).
  const container = label.locator('xpath=..');
  const text = await container.innerText();
  return text;
}

test.describe.serial('Total de cartes en local (badge + totalCards) — Cloisonnement CENTRE vs SITE (agent-13)', () => {
  let env: E2EEnvironment;
  let topo: SeedCentreFilterResult;
  let dbPath: string;
  let anyTestFailed = false;

  test.beforeAll(async () => {
    // Seed intégralement AVANT le lancement d'Electron (cf. leçon empirique de
    // verification-search-3centres.e2e.spec.ts : seeder une topologie custom
    // APRÈS le lancement de l'app a provoqué un "database disk image is
    // malformed" reproductible sur l'UPDATE suivant émis par l'app).
    const userDataDir = mkdtempSync(join(tmpdir(), 'gest-in-situ-e2e-'));
    const baseSeed = await runSeedInElectronNode(userDataDir);
    topo = await runSeedCentreFilter(userDataDir);

    const app = await electron.launch({
      args: [MAIN_ENTRY_PROD, `--user-data-dir=${userDataDir}`],
      env: { ...(process.env as Record<string, string>), GEST_IN_SITU_E2E_DISABLE_SYNC: '1' }
    });
    const window = await waitForMainWindow(app, 120_000);
    await window.waitForLoadState('domcontentloaded');

    env = { app, window, userDataDir, seed: baseSeed };
    dbPath = dbPathOf(env.userDataDir);

    // Vérité terrain préalable : la répartition des cartes ZZTEST_ est bien
    // celle attendue (30 / 12 / 0), avant toute action UI.
    const counts = queryDb(
      dbPath,
      `SELECT centre_id, COUNT(*) FROM t_cartes WHERE noms LIKE 'ZZTEST_CARTE_%' GROUP BY centre_id ORDER BY centre_id;`
    );
    console.log('[E2E][centrefilter] Répartition réelle en base (centre_id|count):\n' + counts);
    expect(counts).toContain(`${topo.centrePrincipalId}|${topo.nPrincipal}`);
    expect(counts).toContain(`${topo.centreSecondId}|${topo.nSecond}`);
    const totalSite = queryDb(dbPath, `SELECT COUNT(*) FROM t_cartes WHERE site_id=${topo.siteId};`);
    console.log(`[E2E][centrefilter] Total SITE réel en base = ${totalSite} (attendu ${topo.totalSite})`);
    expect(Number(totalSite)).toBe(topo.totalSite);
  });

  test.afterAll(async () => {
    if (env) {
      try {
        queryDb(dbPath, "DELETE FROM t_cartes WHERE noms LIKE 'ZZTEST_%';");
        queryDb(dbPath, "DELETE FROM t_centres WHERE nom LIKE 'ZZTEST_%';");
        queryDb(dbPath, "DELETE FROM t_sites WHERE nom LIKE 'ZZTEST_%';");
        queryDb(dbPath, "DELETE FROM t_user_roles WHERE id_user IN (SELECT id_user FROM t_users WHERE login LIKE 'ZZTEST_%');");
        queryDb(dbPath, "DELETE FROM t_users WHERE login LIKE 'ZZTEST_%';");
        queryDb(dbPath, "DELETE FROM audit_logs WHERE details LIKE '%ZZTEST%';");
        queryDb(dbPath, "DELETE FROM t_logs WHERE detail LIKE '%ZZTEST%';");
        const remaining = queryDb(dbPath, "SELECT COUNT(*) FROM t_cartes WHERE noms LIKE 'ZZTEST_%';");
        console.log('[E2E][centrefilter] Nettoyage vérifié — cartes ZZTEST_ restantes après DELETE : ' + remaining);
      } catch (e) {
        console.warn('[E2E] Nettoyage ZZTEST_ (centrefilter) échoué (non bloquant, répertoire jetable de toute façon) :', e);
      }
      await teardownSeededApp(env, anyTestFailed);
    }
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

  /**
   * Déconnexion entre deux comptes de test dans la MÊME instance Electron.
   * `authStore` (Zustand) n'a AUCUN middleware `persist` (état 100% en
   * mémoire, vérifié par lecture de src/renderer/src/stores/authStore.ts) et
   * n'est exposé sur aucun global `window` : un simple `location.reload()`
   * suffit donc à réinitialiser tout l'état client (retour à `user: null` ->
   * garde de routage -> `/login`). Côté main process, `window.api.auth.logout()`
   * appelle `stopSessionHeartbeat()` (session-heartbeat.ts:48-58) qui remet
   * explicitement `secureCurrentUser = null` : la session serveur
   * (`getSecureCurrentUser()`, source de vérité RBAC non falsifiable) est donc
   * bien réinitialisée AVANT le login suivant, pas seulement l'état visuel.
   */
  async function logout(loginId: string): Promise<void> {
    const { window } = env;
    await window.evaluate(async (login) => {
      await (window as any).api.auth.logout(login);
    }, loginId);
    await window.evaluate(() => location.reload());
    await window.waitForLoadState('domcontentloaded');
    await window.waitForURL(/#\/login/, { timeout: 20000 });
  }

  test('0. Vérité terrain : comptes ZZTEST créés avec le bon centre_id en base', async () => {
    const rows = queryDb(
      dbPath,
      `SELECT login||'='||centre_id FROM t_users WHERE login IN ('ZZTEST_OPV_SECOND','ZZTEST_OPV_PRINCIPAL','ZZTEST_OPQ_SECOND','ZZTEST_OPV_EMPTY') ORDER BY login;`
    ).split(/\r?\n/);
    expect(rows).toEqual([
      `ZZTEST_OPQ_SECOND=${topo.centreSecondId}`,
      `ZZTEST_OPV_EMPTY=${topo.centreEmptyId}`,
      `ZZTEST_OPV_PRINCIPAL=${topo.centrePrincipalId}`,
      `ZZTEST_OPV_SECOND=${topo.centreSecondId}`
    ]);
  });

  test('1. ZZTEST_OPV_SECOND (Vérification, centre NON-principal, 12 cartes) — badge + écran Recherche', async () => {
    const { window } = env;
    await login(topo.opvSecond.login, topo.opvSecond.password);
    await window.waitForURL(/#\/agent-verification$/, { timeout: 15000 });
    await expect(window.getByText('PORTAIL DE VÉRIFICATION')).toBeVisible();

    await expect(window.getByText('Cartes disponibles en local :')).toBeVisible({ timeout: 15000 });
    const badgeText = await readBadgeValue(window);
    console.log(`[E2E][centrefilter][OPV_SECOND] Badge en-tête = "${badgeText}"`);
    await window.screenshot({ path: 'test-results/centrefilter-01-opvsecond-badge.png' });

    await window.getByRole('link', { name: 'Recherche Active' }).click();
    await window.waitForURL(/#\/agent-verification\/recherche/, { timeout: 15000 });
    await expect(window.getByText('Base de données locale vide')).not.toBeVisible();
    await window.screenshot({ path: 'test-results/centrefilter-02-opvsecond-recherche.png' });

    await logout(topo.opvSecond.login);
  });

  test('2. ZZTEST_OPV_PRINCIPAL (Vérification, centre PRINCIPAL, 30 cartes) — badge + écran Recherche', async () => {
    const { window } = env;
    await login(topo.opvPrincipal.login, topo.opvPrincipal.password);
    await window.waitForURL(/#\/agent-verification$/, { timeout: 15000 });
    await expect(window.getByText('PORTAIL DE VÉRIFICATION')).toBeVisible();

    await expect(window.getByText('Cartes disponibles en local :')).toBeVisible({ timeout: 15000 });
    const badgeText = await readBadgeValue(window);
    console.log(`[E2E][centrefilter][OPV_PRINCIPAL] Badge en-tête = "${badgeText}"`);
    await window.screenshot({ path: 'test-results/centrefilter-03-opvprincipal-badge.png' });

    await window.getByRole('link', { name: 'Recherche Active' }).click();
    await window.waitForURL(/#\/agent-verification\/recherche/, { timeout: 15000 });
    await expect(window.getByText('Base de données locale vide')).not.toBeVisible();
    await window.screenshot({ path: 'test-results/centrefilter-04-opvprincipal-recherche.png' });

    await logout(topo.opvPrincipal.login);
  });

  test('3. ZZTEST_OPQ_SECOND (Qualité, centre NON-principal, 12 cartes) — badge uniquement', async () => {
    const { window } = env;
    await login(topo.opqSecond.login, topo.opqSecond.password);
    await window.waitForURL(/#\/agent-qualite$/, { timeout: 15000 });
    await expect(window.getByText('PORTAIL DE CONFORMITÉ ET QUALITÉ')).toBeVisible();

    await expect(window.getByText('Cartes disponibles en local :')).toBeVisible({ timeout: 15000 });
    const badgeText = await readBadgeValue(window);
    console.log(`[E2E][centrefilter][OPQ_SECOND] Badge en-tête = "${badgeText}"`);
    await window.screenshot({ path: 'test-results/centrefilter-05-opqsecond-badge.png' });

    await logout(topo.opqSecond.login);
  });

  test('4. ZZTEST_OPV_EMPTY (Vérification, centre NON-principal, 0 carte à SON centre, 42 au SITE) — preuve directe totalCards', async () => {
    const { window } = env;
    await login(topo.opvEmpty.login, topo.opvEmpty.password);
    await window.waitForURL(/#\/agent-verification$/, { timeout: 15000 });
    await expect(window.getByText('PORTAIL DE VÉRIFICATION')).toBeVisible();

    await expect(window.getByText('Cartes disponibles en local :')).toBeVisible({ timeout: 15000 });
    const badgeText = await readBadgeValue(window);
    console.log(`[E2E][centrefilter][OPV_EMPTY] Badge en-tête = "${badgeText}"`);
    await window.screenshot({ path: 'test-results/centrefilter-06-opvempty-badge.png' });

    await window.getByRole('link', { name: 'Recherche Active' }).click();
    await window.waitForURL(/#\/agent-verification\/recherche/, { timeout: 15000 });
    // Laisse le temps à l'effet fetchTotal (userCentreReady + stats.get) de
    // s'exécuter avant d'évaluer l'état affiché.
    await window.waitForTimeout(2500);
    await window.screenshot({ path: 'test-results/centrefilter-07-opvempty-recherche.png' });

    // ── PREUVE DIRECTE ──────────────────────────────────────────────────────
    // Business rule attendue : totalCards doit refléter le SITE (42 cartes),
    // pas le centre de l'agent (0 carte) -> l'écran bloquant ne doit PAS
    // apparaître. S'il apparaît, c'est la preuve irréfutable que RechercheView
    // a filtré son calcul de total par centre_id au lieu de site_id.
    const emptyScreenVisible = await window.getByText('Base de données locale vide').isVisible().catch(() => false);
    console.log(`[E2E][centrefilter][OPV_EMPTY] Écran "Base de données locale vide" affiché ? ${emptyScreenVisible}`);
    expect(emptyScreenVisible).toBe(false);
  });
});
