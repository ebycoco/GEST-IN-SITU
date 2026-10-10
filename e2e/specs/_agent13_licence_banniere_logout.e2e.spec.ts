/**
 * e2e/specs/_agent13_licence_banniere_logout.e2e.spec.ts
 *
 * QA Terrain — bannière d'expiration de licence (LicenseExpiryBanner, pilotée par App.tsx via le
 * canal IPC 'license:expiryWarning') : elle ne doit PAS survivre à une déconnexion (ni rester sur
 * /login, ni fuiter vers le compte suivant, ni réapparaître via le minuteur de la croix), tout en
 * restant bien affichée à chaque login légitime d'un compte dont la licence expire dans <= 3 jours.
 *
 * Isolation : instance Electron avec userDataDir jetable (voir ../fixtures/electron-app.ts), réseau
 * Supabase coupé (GEST_IN_SITU_E2E_DISABLE_SYNC=1 positionné par le harnais), base seedée. Jamais la
 * base de production ni Supabase. Aucune valeur sensible : comptes E2E_* du fixture test-users.
 *
 * Prérequis : dist/ (electron-vite build) doit être à jour avec App.tsx modifié. Cette spec ne
 * lance aucun build.
 * Lancement (jamais via `npm test`) :  npx playwright test _agent13_licence_banniere_logout
 *
 * Cas (e) : le délai de réapparition de la croix est imposé par le main (reappearMs = 60 s pour
 * ADMINISTRATEUR_SITE, 5 min sinon) et n'est pas réglable par le harnais ; le test attend donc
 * réellement 65 s (> 60 s). Limite documentée : pas d'horloge simulée côté renderer.
 */
import { test, expect, type Locator } from '@playwright/test';
import { launchSeededApp, teardownSeededApp, type E2EEnvironment } from '../fixtures/electron-app';
import { getTestUser } from '../fixtures/test-users';
import { execFile } from 'child_process';
import { join } from 'path';
import { mkdirSync } from 'fs';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const DAY = 86400000;
/** Délai de réapparition ADMINISTRATEUR_SITE (session-heartbeat.ts) + marge. */
const REAPPEAR_WAIT_MS = 65000;
/** Dossier de captures optionnel (variable d'environnement QA_SHOT_DIR) ; sans elle, aucune capture. */
const SHOT_DIR = process.env.QA_SHOT_DIR;

/** Minuit UTC de (aujourd'hui UTC + n jours), au format ISO (comme SitesPage). */
function midnightUtcIso(offsetDays: number): string {
  const t = new Date();
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate() + offsetDays)).toISOString();
}

test.describe.serial('QA Terrain — bannière licence et déconnexion', () => {
  test.setTimeout(180000);
  let env: E2EEnvironment;
  let anyTestFailed = false;
  const consoleMsgs: { type: string; text: string }[] = [];

  test.beforeAll(async () => {
    env = await launchSeededApp();
    // Garde-fou : la base utilisée doit être sous le répertoire temporaire jetable.
    expect(env.seed.dbPath.startsWith(env.userDataDir)).toBe(true);
    if (SHOT_DIR) mkdirSync(SHOT_DIR, { recursive: true });
    env.window.on('console', (m) => consoleMsgs.push({ type: m.type(), text: m.text() }));
    env.window.on('pageerror', (e) => consoleMsgs.push({ type: 'pageerror', text: String(e) }));
  });

  test.afterAll(async () => {
    if (env) await teardownSeededApp(env, anyTestFailed);
  });

  test.afterEach(async ({}, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus) anyTestFailed = true;
  });

  // ── Helpers ──────────────────────────────────────────────────────────────
  const MARK = '__E2E_DBQ__:';
  async function dbQuery(sql: string, params: unknown[] = []): Promise<unknown[]> {
    const script = `
      const Database = require('better-sqlite3');
      const db = new Database(process.argv[1], { timeout: 15000 });
      db.pragma('busy_timeout = 15000');
      try {
        const stmt = db.prepare(process.argv[2]);
        const params = JSON.parse(process.argv[3]);
        const result = /^\\s*select/i.test(process.argv[2]) ? stmt.all(...params) : [stmt.run(...params)];
        process.stdout.write(${JSON.stringify(MARK)} + JSON.stringify(result));
      } finally { db.close(); }
    `;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electronPath = require('electron') as unknown as string;
    const { stdout } = await execFileAsync(electronPath, ['-e', script, env.seed.dbPath, sql, JSON.stringify(params)], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024
    });
    const line = stdout.split(/\r?\n/).reverse().find((l) => l.startsWith(MARK));
    if (!line) throw new Error(`[dbQuery] pas de résultat pour: ${sql}`);
    return JSON.parse(line.slice(MARK.length)) as unknown[];
  }

  async function setSiteLicence(id: number, expiry: string | null, permanent: 0 | 1): Promise<void> {
    await dbQuery('UPDATE t_sites SET expiry_date = ?, is_permanent = ? WHERE id = ?', [expiry, permanent, id]);
  }

  async function login(key: string): Promise<void> {
    const u = getTestUser(key);
    const { window } = env;
    await window.getByTestId('login-input').fill(u.login);
    await window.getByTestId('password-input').fill(u.password);
    await window.getByTestId('login-submit').click();
  }
  async function waitLoggedIn(): Promise<void> {
    await env.window.waitForURL(/#\/(?!login)/, { timeout: 30000 });
  }
  async function logout(): Promise<void> {
    await env.window.getByText('Déconnexion').click();
    await env.window.waitForURL(/#\/login/, { timeout: 15000 });
  }
  async function shot(name: string): Promise<void> {
    if (SHOT_DIR) await env.window.screenshot({ path: join(SHOT_DIR, `${name}.png`) });
  }
  const banner = (): Locator => env.window.getByText(/Attention, votre licence expire le/);

  test('prépare la licence : site à +2 jours (fenêtre de bannière <= 3 j)', async () => {
    await setSiteLicence(env.seed.siteId, midnightUtcIso(2), 0);
    // Sanity indépendante du code testé (règle A1) : le jour d'échéance est dans 2 jours calendaires UTC.
    const t = new Date();
    const iso = midnightUtcIso(2);
    expect(Math.round((Date.parse(iso) - Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate())) / DAY)).toBe(2);
  });

  test('(a) ADMINISTRATEUR_SITE licence +2 j : bannière visible après login', async () => {
    await login('administrateurSite');
    await waitLoggedIn();
    await expect(banner()).toBeVisible({ timeout: 15000 });
  });

  test('(b) logout : bannière absente sur la page de login', async () => {
    await logout();
    await env.window.waitForTimeout(1500);
    await shot('01_login_apres_logout_sans_banniere');
    await expect(banner()).toHaveCount(0);
  });

  test('(c) login SUPER ADMIN ensuite : bannière absente', async () => {
    await login('superAdmin');
    await waitLoggedIn();
    await env.window.waitForTimeout(3000);
    await expect(banner()).toHaveCount(0);
    await logout();
  });

  test('(d) re-login ADMINISTRATEUR_SITE : la bannière réapparaît (non-régression du push au login)', async () => {
    await login('administrateurSite');
    await waitLoggedIn();
    await expect(banner()).toBeVisible({ timeout: 15000 });
    await shot('02_apres_relogin_avec_banniere');
    await logout();
    await expect(banner()).toHaveCount(0);
  });

  test('(e) croix fermée puis logout : pas de réapparition via le minuteur après > reappearMs', async () => {
    await login('administrateurSite');
    await waitLoggedIn();
    await expect(banner()).toBeVisible({ timeout: 15000 });
    await env.window.getByRole('button', { name: "Fermer l'alerte de licence" }).click();
    await expect(banner()).toHaveCount(0);
    // Logout immédiat : le minuteur de réapparition (60 s) a été armé par la croix.
    await logout();
    await env.window.waitForTimeout(REAPPEAR_WAIT_MS);
    expect(env.window.url()).toMatch(/#\/login/);
    await expect(banner()).toHaveCount(0);
  });

  test('(f) opérateur du même site, licence +2 j : reçoit sa propre bannière après login', async () => {
    await login('operateurSaisie');
    await waitLoggedIn();
    await expect(banner()).toBeVisible({ timeout: 15000 });
    await logout();
    await expect(banner()).toHaveCount(0);
  });

  test('(g) bannière toujours présente après navigation entre pages tant que connecté', async () => {
    await login('administrateurSite');
    await waitLoggedIn();
    await expect(banner()).toBeVisible({ timeout: 15000 });
    for (const label of ['Infrastructures', 'Journaux', 'Tableau de bord']) {
      await env.window.getByRole('link', { name: label }).first().click();
      await env.window.waitForTimeout(1200);
      await expect(banner(), `bannière après navigation vers ${label}`).toBeVisible();
    }
  });

  test('(h) croix puis réapparition à ~60 s tant que connecté (comportement existant)', async () => {
    // Session ADMINISTRATEUR_SITE du test (g) toujours ouverte.
    await expect(banner()).toBeVisible();
    await env.window.getByRole('button', { name: "Fermer l'alerte de licence" }).click();
    await expect(banner()).toHaveCount(0);
    await env.window.waitForTimeout(30000);
    await expect(banner()).toHaveCount(0);
    await expect(banner()).toBeVisible({ timeout: REAPPEAR_WAIT_MS - 30000 });
  });

  test('(i) login -> logout -> login enchaînés sans attente : bannière du second login affichée', async () => {
    await logout();
    await login('administrateurSite');
    await waitLoggedIn();
    await expect(banner()).toBeVisible({ timeout: 15000 });
    await logout();
    // Enchaînement immédiat, sans pause, puis un opérateur du même site.
    await login('operateurSaisie');
    await waitLoggedIn();
    await expect(banner()).toBeVisible({ timeout: 15000 });
    await logout();
    await expect(banner()).toHaveCount(0);
  });

  test('(j) logout FORCÉ (licence expirée en cours de session) : modale, puis aucune bannière résiduelle', async () => {
    await login('administrateurSite');
    await waitLoggedIn();
    await expect(banner()).toBeVisible({ timeout: 15000 });
    // Licence dépassée en base + émission côté main de l'évènement que le moteur de synchro
    // enverrait (le cycle comptes/rôles est coupé par GEST_IN_SITU_E2E_DISABLE_SYNC=1).
    await setSiteLicence(env.seed.siteId, midnightUtcIso(-1), 0);
    await env.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.send('auth:session-expired', { reason: 'license_expired' });
    });
    await env.window.waitForURL(/#\/login/, { timeout: 15000 });
    await expect(env.window.getByText('Licence expirée').first()).toBeVisible({ timeout: 10000 });
    await shot('03_logout_force_modale_licence_expiree');
    await env.window.getByRole('button', { name: 'OK' }).click();
    await env.window.waitForTimeout(1500);
    await expect(banner()).toHaveCount(0);
    await shot('04_login_apres_logout_force_sans_banniere');
    // Remise de la licence dans la fenêtre J-3 pour la suite.
    await setSiteLicence(env.seed.siteId, midnightUtcIso(2), 0);
  });

  test('(k) aucune erreur de page (pageerror) pendant toute la spec', async () => {
    const errs = consoleMsgs.filter((m) => m.type === 'pageerror');
    const errors = consoleMsgs.filter((m) => m.type === 'error');
    console.log(`[LICENCE_BANNIERE_QA] ${consoleMsgs.length} messages console, ${errors.length} error : ${errors.map((m) => m.text.slice(0, 140)).join(' || ')}`);
    expect(errs).toEqual([]);
  });
});
