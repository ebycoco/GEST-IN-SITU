/**
 * e2e/specs/_agent13_update_resume_page.e2e.spec.ts
 *
 * QA Terrain (agent-13) — « Installer maintenant » + reprise de page après mise à jour
 * (UpdateReadyBanner.tsx, App.tsx handleInstallNow, utils/resumeAfterUpdate.ts, RoleRedirect.tsx).
 * Banc isolé (base temporaire, GEST_IN_SITU_E2E_DISABLE_SYNC=1), aucun cloud.
 *
 * Le clic confirmé « Installer maintenant » appelle window.close() : pour tester le filet
 * « Attendre » (P2-1), on neutralise mainWindow.close côté main (win.close = () => {}), ce qui
 * SIMULE un main qui annule la fermeture. Ce n'est pas une vraie fermeture/installation.
 */
import { test, expect } from '@playwright/test';
import { launchSeededApp, teardownSeededApp, type E2EEnvironment } from '../fixtures/electron-app';
import { getTestUser } from '../fixtures/test-users';
import { join } from 'path';

const SHOT_DIR = join(__dirname, '..', '..', 'test-results', 'agent13-screenshots');
const KEY = 'gest-in-situ-resume-after-update';

test.describe.serial('QA Terrain — Reprise de page après mise à jour (agent-13)', () => {
  let env: E2EEnvironment;
  let failed = false;

  test.beforeAll(async () => { env = await launchSeededApp(); });
  test.afterAll(async () => { if (env) await teardownSeededApp(env, failed); });
  test.afterEach(async ({}, ti) => { if (ti.status !== ti.expectedStatus) failed = true; });

  const hash = () => env.window.evaluate(() => window.location.hash);
  const readKey = () => env.window.evaluate((k) => localStorage.getItem(k), KEY);
  const snap = () => env.window.evaluate(() => (window as any).api.auth.getSessionSnapshot());

  async function loginAs(key: string): Promise<void> {
    const u = getTestUser(key);
    const { window } = env;
    await window.waitForURL(/#\/login/, { timeout: 20000 });
    await window.getByTestId('login-input').fill(u.login);
    await window.getByTestId('password-input').fill(u.password);
    await window.getByTestId('login-submit').click();
    await expect.poll(async () => (await hash()) !== '#/login' && (await hash()) !== '', { timeout: 25000 }).toBe(true);
    // laisse RoleRedirect/Navigate se stabiliser
    await window.waitForTimeout(1500);
  }

  async function logout(): Promise<void> {
    const { window } = env;
    window.once('dialog', (d) => { void d.accept(); });
    await env.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.send('auth:session-expired');
    });
    await window.waitForURL(/#\/login/, { timeout: 15000 });
    const ok = window.locator('button.btn-danger', { hasText: /^OK$/ });
    await window.waitForTimeout(500);
    if ((await ok.count()) > 0) await ok.first().click();
  }

  async function setCtx(over: Record<string, unknown>, base: any, route: string): Promise<void> {
    const ctx = {
      userId: base.id_user, role: base.role, siteId: base.site_id ?? null,
      centreId: base.centre_id ?? null, route, savedAt: Date.now(), ...over
    };
    await env.window.evaluate(([k, v]) => localStorage.setItem(k as string, v as string), [KEY, JSON.stringify(ctx)]);
  }

  async function shot(name: string) {
    await env.window.screenshot({ path: join(SHOT_DIR, `agent13-resume-${name}.png`) });
  }

  // Rôles : [clé fixture, home attendu, route autorisée non-home, route interdite]
  const ROLES: Array<[string, string, string, string]> = [
    ['administrateurSite', '#/dashboard', '/agents', '/maintenance'],
    ['operateurVerification', '#/agent-verification', '/search', '/import'],
    ['operateurSaisie', '#/agent-saisie', '/cartes', '/agents']
  ];

  test('0. Viewport 1366x768 + bandeau (lisibilité) + annulation confirmation', async () => {
    await loginAs('administrateurSite');
    await env.app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0]; w.setContentSize(1366, 768);
    });
    await env.window.waitForTimeout(800);
    const vp = await env.window.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
    console.log(`[agent13][RESUME] viewport réel: ${vp.w}x${vp.h}`);
    await env.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.send('updater:update-downloaded', { version: '9.9.9-test' });
    });
    const banner = env.window.getByText('Mise à jour prête');
    await expect(banner).toBeVisible({ timeout: 10000 });
    await expect(env.window.getByRole('button', { name: 'Installer maintenant' })).toBeVisible();
    await expect(env.window.getByRole('button', { name: 'Fermer la notification' })).toBeVisible();
    const box = await env.window.locator('.premium-card.premium-glass.animate-slide-up').first().boundingBox();
    console.log(`[agent13][RESUME] bandeau box=${JSON.stringify(box)} (viewport ${vp.w}x${vp.h})`);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(vp.h);
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(vp.w);
    await shot('00-banner-1366x768');
    // coexistence bannière licence
    await env.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.send('license:expiryWarning', {
        message: 'ZZTEST licence expire bientot', expiryDate: '2099-01-01', daysLeft: 3, reappearMs: 60000
      });
    });
    const lic = env.window.getByText('ZZTEST licence expire bientot');
    await expect(lic).toBeVisible({ timeout: 10000 });
    const lb = await lic.first().boundingBox();
    const overlap = !!lb && box!.x < lb.x + lb.width && box!.x + box!.width > lb.x &&
      box!.y < lb.y + lb.height && box!.y + box!.height > lb.y;
    console.log(`[agent13][RESUME] chevauchement licence/maj=${overlap}`);
    expect(overlap).toBe(false);
    await shot('00b-banner-with-license-1366x768');
    await env.window.getByRole('button', { name: "Fermer l'alerte de licence" }).click();

    // Annuler ne ferme rien
    await env.window.getByRole('button', { name: 'Installer maintenant' }).click();
    const title = env.window.getByRole('heading', { name: 'Installer la mise à jour' });
    await expect(title).toBeVisible();
    await shot('00c-confirm');
    await env.window.getByRole('button', { name: 'Annuler' }).click();
    await expect(title).toHaveCount(0);
    await expect(banner).toBeVisible();
    expect(await readKey()).toBeNull(); // annulation => rien sauvegardé
  });

  test('5. Confirmation => clé sauvegardée (contenu), puis supprimée après ~5 s si la fermeture est annulée (close neutralisé)', async () => {
    const s = await snap();
    await env.app.evaluate(({ BrowserWindow }) => {
      (BrowserWindow.getAllWindows()[0] as any).close = () => { /* simule « Attendre » */ };
    });
    await env.window.evaluate(() => { window.location.hash = '#/agents'; });
    await env.window.waitForURL(/#\/agents/);
    const t0 = Date.now();
    await env.window.getByRole('button', { name: 'Installer maintenant' }).click();
    const title = env.window.getByRole('heading', { name: 'Installer la mise à jour' });
    await expect(title).toBeVisible();
    await env.window.getByRole('button', { name: 'Installer maintenant', disabled: false }).click();
    await expect.poll(readKey, { timeout: 3000 }).not.toBeNull();
    const raw = JSON.parse((await readKey())!);
    console.log(`[agent13][RESUME] clé sauvegardée: ${JSON.stringify(raw)} ; snapshot=${JSON.stringify(s)}`);
    expect(raw.route).toBe('/agents');
    expect(raw.userId).toBe(s.id_user);
    expect(raw.role).toBe(s.role);
    expect(raw.siteId ?? null).toBe(s.site_id ?? null);
    expect(raw.centreId ?? null).toBe(s.centre_id ?? null);
    expect(Math.abs(raw.savedAt - Date.now())).toBeLessThan(5000);
    // encore présente à ~3 s
    await env.window.waitForTimeout(3000);
    expect(await readKey()).not.toBeNull();
    // supprimée après ~5 s
    await expect.poll(readKey, { timeout: 5000 }).toBeNull();
    console.log(`[agent13][RESUME] clé supprimée ${Date.now() - t0} ms après le clic`);
    // appli vivante, bandeau toujours visible (Attendre => peut réessayer)
    await expect(env.window.getByText('Mise à jour prête')).toBeVisible();
  });

  for (const [key, home, okRoute, forbiddenRoute] of ROLES) {
    test(`3/4. Rôle ${key} — sans clé => accueil habituel ; reprise a,b,c,d,e`, async () => {
      await logout();
      await env.window.evaluate((k) => localStorage.removeItem(k), KEY);
      await loginAs(key);
      const s = await snap();
      console.log(`[agent13][RESUME] ${key} snapshot=${JSON.stringify(s)}`);
      // 4. sans clé
      expect(await hash()).toBe(home);
      await shot(`4-${key}-home-sans-cle`);

      // (a) clé valide => route sauvegardée, clé supprimée
      await logout();
      await setCtx({}, s, okRoute);
      await loginAs(key);
      expect(await hash()).toBe('#' + okRoute);
      expect(await readKey()).toBeNull();
      await shot(`3a-${key}-resume`);

      // (b) > 30 min
      await logout();
      await setCtx({ savedAt: Date.now() - 31 * 60 * 1000 }, s, okRoute);
      await loginAs(key);
      expect(await hash()).toBe(home);
      expect(await readKey()).toBeNull();

      // (c) autre user / rôle / site / centre
      for (const over of [
        { userId: s.id_user + 999 }, { role: 'SUPER ADMIN' === s.role ? 'ADMIN_CENTRE' : 'SUPER ADMIN' },
        { siteId: (s.site_id ?? 0) + 777 }, { centreId: (s.centre_id ?? 0) + 777 }
      ]) {
        await logout();
        await setCtx(over, s, okRoute);
        await loginAs(key);
        expect(await hash(), `override ${JSON.stringify(over)}`).toBe(home);
        expect(await readKey()).toBeNull();
      }

      // (d) route interdite
      await logout();
      await setCtx({}, s, forbiddenRoute);
      await loginAs(key);
      expect(await hash()).toBe(home);
      expect(await readKey()).toBeNull();
      const bodyLen = (await env.window.evaluate(() => document.body.innerText.length));
      expect(bodyLen).toBeGreaterThan(50); // pas d'écran blanc
      await shot(`3d-${key}-route-interdite`);

      // (e) /login, vide, /role-selector, sans slash, racine
      for (const route of ['/login', '', '/role-selector', 'agents', '/', '/login?x=1']) {
        await logout();
        await setCtx({}, s, route);
        await loginAs(key);
        expect(await hash(), `route "${route}"`).toBe(home);
        expect(await readKey()).toBeNull();
      }
    });
  }

  test('3f. JSON corrompu / clé sans champs => ignoré, accueil, clé supprimée', async () => {
    const key = 'operateurVerification';
    await logout();
    await env.window.evaluate(([k]) => localStorage.setItem(k, '{pas du json'), [KEY]);
    await loginAs(key);
    expect(await hash()).toBe('#/agent-verification');
    expect(await readKey()).toBeNull();
    await logout();
    await env.window.evaluate(([k]) => localStorage.setItem(k, 'null'), [KEY]);
    await loginAs(key);
    expect(await hash()).toBe('#/agent-verification');
    expect(await readKey()).toBeNull();
  });
});
