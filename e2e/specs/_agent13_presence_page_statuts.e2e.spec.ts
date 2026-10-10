/**
 * e2e/specs/_agent13_presence_page_statuts.e2e.spec.ts
 *
 * QA terrain agent-13 — lot L1 (page Présence des Agents, commit facddf2).
 * Build `dist/` standard, réseau Supabase COUPÉ (GEST_IN_SITU_E2E_DISABLE_SYNC=1) :
 * aucune requête Supabase. Les lignes de présence sont fournies en remplaçant, côté
 * process main de l'instance isolée, le handler IPC `presence:getAgents` (méthode
 * « simulation IPC », pas de base dev). Le renderer, le calcul de statut et le rendu
 * sont les vrais.
 */
import { test, expect } from '@playwright/test';
import { launchSeededApp, teardownSeededApp, type E2EEnvironment } from '../fixtures/electron-app';
import { getTestUser } from '../fixtures/test-users';
import { join } from 'path';

const SHOT_DIR = join(__dirname, '..', '..', 'test-results', 'agent13-screenshots');
const MIN = 60_000;

function iso(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

function buildRows(siteId: number, centreId: number, withOtherSite: boolean) {
  const base = { nom_user: 'ZZTEST', site_id: siteId, centre_id: centreId, last_action_at: null, last_action_label: null };
  const rows: any[] = [
    { ...base, sync_id: 'zz-1', login: 'ZZTEST_ENLIGNE_1MIN', prenom_user: 'EnLigne', role: 'OPERATEUR_SAISIE', last_login_at: iso(-30 * MIN), last_heartbeat_at: iso(-1 * MIN), last_logout_at: null },
    { ...base, sync_id: 'zz-2', login: 'ZZTEST_INACTIF_8MIN', prenom_user: 'Inactif', role: 'OPERATEUR_QUALITE', last_login_at: iso(-60 * MIN), last_heartbeat_at: iso(-8 * MIN), last_logout_at: null },
    { ...base, sync_id: 'zz-3', login: 'ZZTEST_HORS_20MIN', prenom_user: 'Hors20', role: 'OPERATEUR_VERIFICATION', last_login_at: iso(-90 * MIN), last_heartbeat_at: iso(-20 * MIN), last_logout_at: null },
    { ...base, sync_id: 'zz-4', login: 'ZZTEST_LOGOUT_GE_HB', prenom_user: 'LogoutGeHb', role: 'ADMIN_CENTRE', last_login_at: iso(-30 * MIN), last_heartbeat_at: iso(-5 * MIN), last_logout_at: iso(-4 * MIN) },
    { ...base, sync_id: 'zz-5', login: 'ZZTEST_FERME_SANS_DECO', prenom_user: 'Ferme', role: 'OPERATEUR_LOGISTIQUE', last_login_at: iso(-50 * MIN), last_heartbeat_at: iso(-40 * MIN), last_logout_at: iso(-120 * MIN) },
    { ...base, sync_id: 'zz-6', login: 'ZZTEST_JAMAIS_BATTEMENT', prenom_user: 'Jamais', role: 'OPERATEUR_INVENTAIRE', last_login_at: null, last_heartbeat_at: null, last_logout_at: null },
    { ...base, sync_id: 'zz-7', login: 'ZZTEST_FUTUR_PLUS10', prenom_user: 'Futur', role: 'OPERATEUR_APUREMENT', last_login_at: iso(-5 * MIN), last_heartbeat_at: iso(10 * MIN), last_logout_at: null },
    { ...base, sync_id: 'zz-8', login: 'ZZTEST_LOGIN_LONG_NOM_DE_COMPTE_TRES_LONG_POUR_DEBORDEMENT', prenom_user: 'Un Prenom Tres Long Aussi', role: 'OPERATEUR_SAISIE', last_login_at: iso(-60 * MIN), last_heartbeat_at: iso(-40 * MIN), last_logout_at: null },
  ];
  for (let i = 0; i < 3; i++) {
    rows.push({ ...base, sync_id: `zz-f${i}`, login: `ZZTEST_FILLER_${i}`, prenom_user: `Filler${i}`, role: 'OPERATEUR_SAISIE', last_login_at: iso(-20 * MIN), last_heartbeat_at: iso(-2 * MIN), last_logout_at: null });
  }
  if (withOtherSite) {
    for (let i = 0; i < 3; i++) {
      rows.push({ ...base, site_id: 999, centre_id: 999, sync_id: `zz-o${i}`, login: `ZZTEST_AUTRESITE_${i}`, prenom_user: `Autre${i}`, role: 'OPERATEUR_SAISIE', last_login_at: iso(-20 * MIN), last_heartbeat_at: iso(-2 * MIN), last_logout_at: null });
    }
  }
  return rows;
}

test.describe.serial('QA terrain L1 — Présence des Agents (statuts, cellule, lisibilité)', () => {
  let env: E2EEnvironment;
  let failed = false;

  test.beforeAll(async () => { env = await launchSeededApp(); });
  test.afterAll(async () => { if (env) await teardownSeededApp(env, failed); });
  test.afterEach(async ({}, ti) => { if (ti.status !== ti.expectedStatus) failed = true; });

  async function setSize() {
    await env.app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && x.isVisible())!;
      if (w.isMaximized()) w.unmaximize();
      w.setContentSize(1366, 768);
    });
  }
  async function mockHandler(rows: any[]) {
    await env.app.evaluate(({ ipcMain }, r) => {
      ipcMain.removeHandler('presence:getAgents');
      ipcMain.handle('presence:getAgents', async () => r);
    }, rows);
  }
  async function login(key: 'administrateurSite' | 'superAdmin') {
    const { window } = env;
    const u = getTestUser(key);
    await window.waitForURL(/#\/login/, { timeout: 30000 });
    await window.getByTestId('login-input').fill(u.login);
    await window.getByTestId('password-input').fill(u.password);
    await window.getByTestId('login-submit').click();
    await window.waitForURL(/#\/dashboard/, { timeout: 30000 });
  }
  async function logout() {
    await env.window.getByRole('button', { name: 'Déconnexion' }).click();
    await env.window.waitForURL(/#\/login/, { timeout: 15000 });
  }
  async function readTable() {
    return env.window.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('.presence-table tbody tr')).map((tr) => {
        const tds = tr.querySelectorAll('td');
        return {
          statut: (tds[0]?.textContent || '').trim(),
          login: (tds[1]?.querySelector('div:nth-child(2)')?.textContent || '').trim(),
          deconnexion: (tds[5]?.innerText || '').replace(/\n/g, ' | ').trim(),
        };
      });
      const counts = Array.from(document.querySelectorAll('.presence-glass-card')).slice(0, 3).map((c) => (c.textContent || '').trim());
      let minFont = 99; let minEl = '';
      document.querySelectorAll('.presence-table th, .presence-table td, .presence-table td *').forEach((el) => {
        if (!(el as HTMLElement).innerText?.trim()) return;
        const fs = parseFloat(getComputedStyle(el).fontSize);
        if (fs < minFont) { minFont = fs; minEl = (el.textContent || '').trim().slice(0, 30); }
      });
      const tableWrap = document.querySelector('.presence-table')!.parentElement as HTMLElement;
      return {
        rows, counts, minFont, minEl,
        wrapOverflow: tableWrap.scrollWidth - tableWrap.clientWidth,
        docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        pager: (document.body.innerText.match(/\d+ \/ \d+/) || [''])[0],
        total: (document.body.innerText.match(/\d+ agents? au total/) || [''])[0],
        winW: window.innerWidth, winH: window.innerHeight,
        offlineBanner: document.body.innerText.includes('Connexion Supabase indisponible'),
      };
    });
  }
  async function goPresence() {
    await env.window.evaluate(() => { window.location.hash = '#/agents/presence'; });
    await expect(env.window.getByRole('heading', { name: 'Présence des Agents' })).toBeVisible({ timeout: 10000 });
    await expect(env.window.locator('.presence-table')).toBeVisible({ timeout: 15000 });
  }

  test('A1. ADMINISTRATEUR_SITE — statuts, cellule déconnexion, compteurs, 1366x768', async () => {
    await setSize();
    await mockHandler(buildRows(env.seed.siteId, env.seed.centreId, false));
    await login('administrateurSite');
    await goPresence();
    const t = await readTable();
    console.log('[A1] ' + JSON.stringify(t, null, 1));
    await env.window.screenshot({ path: join(SHOT_DIR, 'agent13-L1-A1-admin-site-p1.png') });
    await env.window.getByText('SUIVANT').click();
    await env.window.waitForTimeout(300);
    const t2 = await readTable();
    console.log('[A1-page2] ' + JSON.stringify(t2.rows) + ' ' + t2.pager);
    await env.window.screenshot({ path: join(SHOT_DIR, 'agent13-L1-A1-admin-site-p2.png') });
    await logout();
  });

  test('A2. SUPER ADMIN — filtre site + pagination', async () => {
    await mockHandler(buildRows(env.seed.siteId, env.seed.centreId, true));
    await login('superAdmin');
    await goPresence();
    const t = await readTable();
    console.log('[A2-all] ' + JSON.stringify({ counts: t.counts, total: t.total, pager: t.pager, minFont: t.minFont, wrap: t.wrapOverflow, doc: t.docOverflow }));
    await env.window.screenshot({ path: join(SHOT_DIR, 'agent13-L1-A2-super-admin-all.png') });
    const sel = env.window.locator('select:not(.site-select)').first();
    const nSel = await sel.count();
    console.log('[A2] selecteur de site présent=' + nSel);
    if (nSel > 0) {
      const opts = await sel.locator('option').allTextContents();
      console.log('[A2] options=' + JSON.stringify(opts));
      await sel.selectOption(String(env.seed.siteId));
      await env.window.waitForTimeout(400);
      const f = await readTable();
      console.log('[A2-filtre-site] ' + JSON.stringify({ counts: f.counts, total: f.total, pager: f.pager, logins: f.rows.map((r) => r.login) }));
      await env.window.screenshot({ path: join(SHOT_DIR, 'agent13-L1-A2-super-admin-filtre.png') });
      await sel.selectOption('ALL');
    }
    await logout();
  });
});
