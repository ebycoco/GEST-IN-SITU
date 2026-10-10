/**
 * e2e/specs/_agent13_presence_page_5cc86c4.e2e.spec.ts
 *
 * QA terrain agent-13 — commit 5cc86c4 (B : battement futur > 2 min = Inactif ; C : badge 11 px nowrap)
 * + P2-A (fermeture rôles non suivis). Build dist-e2e-cloud (HEAD) lancé avec
 * GEST_IN_SITU_E2E_DISABLE_SYNC=1 : AUCUN réseau Supabase (client désactivé), presence:getAgents simulé.
 */
import { test, expect } from '@playwright/test';
import { _electron as electron } from '@playwright/test';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { runSeedInElectronNode } from '../fixtures/seed-runner';
import { teardownSeededApp, type E2EEnvironment } from '../fixtures/electron-app';
import { getTestUser } from '../fixtures/test-users';

const ROOT = resolve(__dirname, '../..');
const ENTRY = join(ROOT, 'dist-e2e-cloud', 'main', 'index.js');
const SHOT_DIR = join(ROOT, 'test-results', 'agent13-screenshots');
const MIN = 60_000;
const iso = (o: number) => new Date(Date.now() + o).toISOString();

test.describe.serial('QA terrain 5cc86c4 — page Présence (B futur = Inactif, C badge 11 px une ligne)', () => {
  test.setTimeout(240000);
  let env: E2EEnvironment;
  let failed = false;
  test.afterEach(async ({}, ti) => { if (ti.status !== ti.expectedStatus) failed = true; });
  test.afterAll(async () => { if (env) await teardownSeededApp(env, failed); });

  test('P2-B/C. ADMINISTRATEUR_SITE 1366x768 : statuts futur, badges une ligne >= 11 px, débordement', async () => {
    const userDataDir = mkdtempSync(join(tmpdir(), 'gest-in-situ-e2e-'));
    const seed = await runSeedInElectronNode(userDataDir);
    const baseEnv = { ...(process.env as Record<string, string>), GEST_IN_SITU_E2E_DISABLE_SYNC: '1' };
    const app = await electron.launch({ args: [ENTRY, `--user-data-dir=${userDataDir}`], env: baseEnv });
    let window: any = null;
    const dl = Date.now() + 90000;
    while (Date.now() < dl && !window) {
      window = app.windows().find((w) => !w.isClosed() && !w.url().includes('splash.html')) || null;
      if (!window) await new Promise((r) => setTimeout(r, 500));
    }
    await window.waitForLoadState('domcontentloaded');
    env = { app, window, userDataDir, seed };

    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && x.isVisible())!;
      if (w.isMaximized()) w.unmaximize();
      w.setContentSize(1366, 768);
    });
    const base = { nom_user: 'ZZTEST', site_id: seed.siteId, centre_id: seed.centreId, last_action_at: null, last_action_label: null };
    const rows = [
      { ...base, sync_id: 'zz-1', login: 'ZZTEST_FUTUR_PLUS1MIN', prenom_user: 'P1', role: 'OPERATEUR_SAISIE', last_login_at: iso(-30 * MIN), last_heartbeat_at: iso(1 * MIN), last_logout_at: null },
      { ...base, sync_id: 'zz-2', login: 'ZZTEST_FUTUR_PLUS3MIN', prenom_user: 'P3', role: 'OPERATEUR_QUALITE', last_login_at: iso(-30 * MIN), last_heartbeat_at: iso(3 * MIN), last_logout_at: null },
      { ...base, sync_id: 'zz-3', login: 'ZZTEST_FUTUR_PLUS10MIN', prenom_user: 'P10', role: 'OPERATEUR_VERIFICATION', last_login_at: iso(-30 * MIN), last_heartbeat_at: iso(10 * MIN), last_logout_at: null },
      { ...base, sync_id: 'zz-4', login: 'ZZTEST_LOGOUT_GE_HBFUTUR', prenom_user: 'LG', role: 'ADMIN_CENTRE', last_login_at: iso(-30 * MIN), last_heartbeat_at: iso(3 * MIN), last_logout_at: iso(4 * MIN) },
      { ...base, sync_id: 'zz-5', login: 'ZZTEST_HORS_20MIN', prenom_user: 'H', role: 'OPERATEUR_LOGISTIQUE', last_login_at: iso(-90 * MIN), last_heartbeat_at: iso(-20 * MIN), last_logout_at: null },
      { ...base, sync_id: 'zz-6', login: 'ZZTEST_ENLIGNE_MOINS1MIN', prenom_user: 'E', role: 'OPERATEUR_SAISIE', last_login_at: iso(-30 * MIN), last_heartbeat_at: iso(-1 * MIN), last_logout_at: null },
      { ...base, sync_id: 'zz-7', login: 'ZZTEST_INACTIF_8MIN', prenom_user: 'I', role: 'OPERATEUR_APUREMENT', last_login_at: iso(-30 * MIN), last_heartbeat_at: iso(-8 * MIN), last_logout_at: null },
      { ...base, sync_id: 'zz-8', login: 'ZZTEST_LOGIN_LONG_NOM_DE_COMPTE_TRES_LONG_POUR_DEBORDEMENT', prenom_user: 'Un Prenom Tres Long Aussi', role: 'OPERATEUR_SAISIE', last_login_at: iso(-60 * MIN), last_heartbeat_at: iso(-40 * MIN), last_logout_at: null },
    ];
    await app.evaluate(({ ipcMain }, r) => {
      ipcMain.removeHandler('presence:getAgents');
      ipcMain.handle('presence:getAgents', async () => r);
    }, rows);
    const u = getTestUser('administrateurSite');
    await window.waitForURL(/#\/login/, { timeout: 30000 });
    await window.getByTestId('login-input').fill(u.login);
    await window.getByTestId('password-input').fill(u.password);
    await window.getByTestId('login-submit').click();
    await window.waitForURL(/#\/dashboard/, { timeout: 30000 });
    await window.evaluate(() => { window.location.hash = '#/agents/presence'; });
    await expect(window.getByRole('heading', { name: 'Présence des Agents' })).toBeVisible({ timeout: 10000 });
    await expect(window.locator('.presence-table')).toBeVisible({ timeout: 15000 });
    const t = await window.evaluate(() => {
      const out = Array.from(document.querySelectorAll('.presence-table tbody tr')).map((tr) => {
        const td0 = tr.querySelectorAll('td')[0];
        const badge = td0.querySelector('span') as HTMLElement;
        const cs = getComputedStyle(badge);
        const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2;
        return {
          login: (tr.querySelectorAll('td')[1]?.querySelector('div:nth-child(2)')?.textContent || '').trim().split(' ')[0],
          statut: (badge.textContent || '').trim(),
          fontSize: cs.fontSize, whiteSpace: cs.whiteSpace,
          badgeH: Math.round(badge.getBoundingClientRect().height), badgeW: Math.round(badge.getBoundingClientRect().width),
          lines: badge.getClientRects().length, singleLine: badge.getBoundingClientRect().height < lh * 1.9 + 8
        };
      });
      const wrap = document.querySelector('.presence-table')!.parentElement as HTMLElement;
      return { out, wrapOverflow: wrap.scrollWidth - wrap.clientWidth, wrapClientW: wrap.clientWidth, wrapScrollW: wrap.scrollWidth,
        docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, winW: window.innerWidth, winH: window.innerHeight,
        pager: (document.body.innerText.match(/\d+ \/ \d+/) || [''])[0] };
    });
    console.log('[P2BC] ' + JSON.stringify(t, null, 1));
    await window.screenshot({ path: join(SHOT_DIR, 'agent13-5cc86c4-page-p1.png') });
    // Baseline : on réapplique en DOM le style d'AVANT 5cc86c4 (fontSize 10, pas de nowrap) pour comparer à données identiques.
    const old = await window.evaluate(() => {
      document.querySelectorAll('.presence-table tbody tr td:first-child span').forEach((s) => { (s as HTMLElement).style.fontSize = '10px'; (s as HTMLElement).style.whiteSpace = 'normal'; });
      const wrap = document.querySelector('.presence-table')!.parentElement as HTMLElement;
      return { wrapOverflow: wrap.scrollWidth - wrap.clientWidth, scrollW: wrap.scrollWidth, badgeW: Math.round((document.querySelector('.presence-table tbody tr td:first-child span') as HTMLElement).getBoundingClientRect().width) };
    });
    console.log('[P2BC] BASELINE emulée (10px, normal) = ' + JSON.stringify(old) + ' ; APRES (11px nowrap) wrapOverflow=' + t.wrapOverflow);
    const byLogin = Object.fromEntries(t.out.map((r: any) => [r.login, r]));
    const get = (k: string) => t.out.find((r: any) => r.login.startsWith(k));
    console.log('[P2BC] statuts = ' + JSON.stringify(t.out.map((r: any) => `${r.login}=${r.statut}`)));
    void byLogin;
    for (const r of t.out) {
      expect(parseFloat(r.fontSize), r.login).toBeGreaterThanOrEqual(11);
      expect(r.whiteSpace, r.login).toBe('nowrap');
      expect(r.singleLine, r.login).toBe(true);
    }
    expect(get('ZZTEST_FUTUR_PLUS1MIN').statut).toBe('En ligne');
    expect(get('ZZTEST_FUTUR_PLUS3MIN').statut).toBe('Inactif');
    expect(get('ZZTEST_FUTUR_PLUS10MIN').statut).toBe('Inactif');
    expect(get('ZZTEST_LOGOUT_GE_HBFUTUR').statut).toBe('Hors ligne');
    expect(get('ZZTEST_ENLIGNE_MOINS1MIN').statut).toBe('En ligne');
    expect(get('ZZTEST_INACTIF_8MIN').statut).toBe('Inactif');
    expect(get('ZZTEST_HORS_20MIN').statut).toBe('Hors ligne');
  });
});
