/**
 * e2e/specs/_agent13_licence_dashboard.e2e.spec.ts
 *
 * QA Terrain (agent-13) — carte « Licence » du tableau de bord (/dashboard, onglet
 * « Indicateurs Système ») : LicenseStatusCard.tsx + shared/utils/license.ts, insérée dans
 * SiteAdminView.tsx. Rôles : ADMINISTRATEUR_SITE, et SUPER ADMIN consultant un site (activeSiteId).
 *
 * Isolation : une instance Electron avec userDataDir jetable (voir ../fixtures/electron-app.ts),
 * réseau Supabase coupé (GEST_IN_SITU_E2E_DISABLE_SYNC=1), base seedée au schéma réel. Toutes les
 * lignes ajoutées (sites ZZTEST_*) vivent dans cette base jetable, supprimée au teardown.
 *
 * Lancement (jamais via `npm test`) :  npx playwright test _agent13_licence_dashboard
 * Captures : dossier donné par la variable d'environnement LICENCE_QA_SHOT_DIR, sinon
 * test-results/agent13-licence/ (ignoré par git).
 *
 * Dates : l'échéance est écrite en base comme le fait SitesPage (minuit UTC, ISO). Les valeurs
 * attendues sont recalculées ici de façon indépendante du code testé (formule Math.ceil écrite à
 * la main + noms de mois FR en dur), pour détecter un décalage d'un jour.
 */
import { test, expect, type Page, type Locator } from '@playwright/test';
import { launchSeededApp, teardownSeededApp, type E2EEnvironment } from '../fixtures/electron-app';
import { getTestUser } from '../fixtures/test-users';
import { join } from 'path';
import { mkdirSync } from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const SHOT_DIR = process.env.LICENCE_QA_SHOT_DIR || join(__dirname, '..', '..', 'test-results', 'agent13-licence');
const DAY = 86400000;
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const CONTACT_MSG = 'Pour renouveler votre licence, contactez le super administrateur.';

/** Minuit UTC de (aujourd'hui UTC + n jours), au format ISO (comme SitesPage). */
function midnightUtcIso(offsetDays: number): string {
  const t = new Date();
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate() + offsetDays)).toISOString();
}
function expectedDaysLeft(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / DAY);
}
/** « 5 novembre 2026 » depuis la partie AAAA-MM-JJ de la valeur BRUTE en base (aucun fuseau). */
function expectedFrDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return `${d === 1 ? '1er' : d} ${MOIS[m - 1]} ${y}`;
}

test.describe.serial('QA Terrain — carte Licence du dashboard (agent-13)', () => {
  let env: E2EEnvironment;
  let anyTestFailed = false;
  const consoleMsgs: { type: string; text: string }[] = [];
  const siteIds: Record<string, number> = {};

  test.beforeAll(async () => {
    mkdirSync(SHOT_DIR, { recursive: true });
    env = await launchSeededApp();
    // Garde-fou : la base utilisée doit être sous le répertoire temporaire jetable.
    expect(env.seed.dbPath.startsWith(env.userDataDir)).toBe(true);
    env.window.on('console', (m) => consoleMsgs.push({ type: m.type(), text: m.text() }));
    env.window.on('pageerror', (e) => consoleMsgs.push({ type: 'pageerror', text: String(e) }));
    // Compteur d'appels IPC hierarchy:getSites côté main (enveloppe le handler existant, lecture seule).
    await env.app.evaluate(({ ipcMain }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const map = (ipcMain as any)._invokeHandlers as Map<string, (...a: unknown[]) => unknown>;
      const orig = map.get('hierarchy:getSites');
      if (!orig) throw new Error('handler hierarchy:getSites introuvable');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).__getSitesCalls = 0;
      map.set('hierarchy:getSites', (...a: unknown[]) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (globalThis as any).__getSitesCalls++;
        return orig(...a);
      });
    });
  });

  test.afterAll(async () => {
    if (env) await teardownSeededApp(env, anyTestFailed);
  });

  test.afterEach(async ({}, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus) anyTestFailed = true;
  });

  // ── Helpers ──────────────────────────────────────────────────────────────
  const MARK = '__E2E_DBQ__:';
  async function dbQuery(sql: string, params: unknown[] = []): Promise<any[]> {
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
    return JSON.parse(line.slice(MARK.length));
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
  async function logout(): Promise<void> {
    await env.window.getByText('Déconnexion').click();
    await env.window.waitForURL(/#\/login/, { timeout: 15000 });
  }
  async function goto(hash: string): Promise<void> {
    await env.window.evaluate((h) => { window.location.hash = h; }, hash);
    await env.window.waitForTimeout(1200);
  }
  async function shot(name: string): Promise<string> {
    const p = join(SHOT_DIR, `${name}.png`);
    await env.window.screenshot({ path: p });
    return p;
  }
  async function setContentSize(w: number, h: number): Promise<void> {
    await env.app.evaluate(({ BrowserWindow }, [ww, hh]) => {
      const win = BrowserWindow.getAllWindows().find((x) => !x.webContents.getURL().includes('splash'));
      if (!win) return;
      if (win.isMaximized()) win.unmaximize();
      win.setContentSize(ww, hh);
    }, [w, h]);
    await env.window.waitForTimeout(600);
  }
  const card = (): Locator => env.window.locator('[role="status"][aria-label^="Licence :"]');
  const banner = (): Locator => env.window.getByText(/Attention, votre licence expire le/);
  async function cardText(): Promise<string> {
    await expect(card()).toBeVisible({ timeout: 15000 });
    return ((await card().innerText()) || '').replace(/\s+/g, ' ').trim();
  }
  async function cardColor(): Promise<string> {
    // Couleur effective du titre principal (3e bloc texte) = border-left de la carte.
    return card().evaluate((el) => getComputedStyle(el).borderLeftColor);
  }
  async function getSitesCalls(): Promise<number> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return env.app.evaluate(() => (globalThis as any).__getSitesCalls as number);
  }
  async function adminLoginOnDashboard(): Promise<void> {
    await login('administrateurSite');
    await env.window.waitForURL(/#\/(dashboard|role-selector)/, { timeout: 30000 });
    await goto('#/dashboard');
    await env.window.getByText('Indicateurs Système').first().waitFor({ timeout: 30000 });
  }

  // ── 1. ADMINISTRATEUR_SITE ───────────────────────────────────────────────
  const adminCases: { label: string; expiry: string | null; perm: 0 | 1; kind: string }[] = [
    { label: 'plus10', expiry: midnightUtcIso(10), perm: 0, kind: 'warning' },
    { label: 'plus45', expiry: midnightUtcIso(45), perm: 0, kind: 'ok' },
    { label: 'plus2', expiry: midnightUtcIso(2), perm: 0, kind: 'critical' },
    { label: 'plus1', expiry: midnightUtcIso(1), perm: 0, kind: 'critical' },
    { label: 'aujourdhui', expiry: new Date(Date.now() + 3 * 3600 * 1000).toISOString(), perm: 0, kind: 'critical' },
    { label: 'permanent', expiry: null, perm: 1, kind: 'permanent' },
    { label: 'sans_echeance', expiry: null, perm: 0, kind: 'undefined' }
  ];

  for (const c of adminCases) {
    test(`ADMIN_SITE — ${c.label}`, async () => {
      await setSiteLicence(env.seed.siteId, c.expiry, c.perm);
      await adminLoginOnDashboard();
      const text = await cardText();
      await shot(`admin_${c.label}`);
      expect(text).toContain('Pro');
      if (c.kind === 'permanent') {
        expect(text).toContain('Licence permanente');
        expect(text).not.toContain('jour');
        expect(text).not.toContain('contactez');
      } else if (c.kind === 'undefined') {
        expect(text).toContain('Échéance non définie');
        expect(text).toContain('À renseigner par le super administrateur');
        expect(text).toContain(CONTACT_MSG);
      } else {
        const n = expectedDaysLeft(c.expiry!);
        const head = n === 0 ? "Expire aujourd'hui" : n === 1 ? '1 jour restant' : `${n} jours restants`;
        expect(text).toContain(head);
        expect(text).toContain(`Échéance le ${expectedFrDate(c.expiry!)}`);
        expect(text).toContain(CONTACT_MSG);
        // Bannière : uniquement si 0 <= n <= 3 (règle existante, même Math.ceil).
        if (n >= 0 && n <= 3) await expect(banner()).toBeVisible({ timeout: 10000 });
        else await expect(banner()).toHaveCount(0);
      }
      console.log(`[LICENCE_QA] ${c.label} | base=${c.expiry} | carte="${text}" | bordure=${await cardColor()}`);
      await logout();
    });
  }

  test('ADMIN_SITE — site expiré : login bloqué (LICENCE_EXPIREE) inchangé', async () => {
    await setSiteLicence(env.seed.siteId, midnightUtcIso(-1), 0);
    await login('administrateurSite');
    await env.window.waitForTimeout(2500);
    expect(env.window.url()).toMatch(/#\/login/);
    const body = await env.window.locator('body').innerText();
    await shot('admin_expire_login_bloque');
    console.log(`[LICENCE_QA] message login expiré: ${body.replace(/\s+/g, ' ').slice(0, 300)}`);
    expect(body.toLowerCase()).toContain('licence');
    await env.window.getByRole('button', { name: 'OK', exact: true }).click();
    await env.window.waitForTimeout(500);
  });

  test('ADMIN_SITE — Actualiser recharge la carte (valeur modifiée en base) + 1 appel getSites', async () => {
    await setSiteLicence(env.seed.siteId, midnightUtcIso(45), 0);
    await adminLoginOnDashboard();
    expect(await cardText()).toContain(`${expectedDaysLeft(midnightUtcIso(45))} jours restants`);
    const newIso = midnightUtcIso(10);
    await setSiteLicence(env.seed.siteId, newIso, 0);
    const before = await getSitesCalls();
    await env.window.getByRole('button', { name: /Actualiser/ }).click();
    await expect(card()).toContainText(`${expectedDaysLeft(newIso)} jours restants`, { timeout: 30000 });
    const after = await getSitesCalls();
    console.log(`[LICENCE_QA] appels getSites pendant Actualiser: ${after - before}`);
    await shot('admin_actualiser_apres');
    expect(after - before).toBeGreaterThanOrEqual(1);
  });

  test('ADMIN_SITE — onglet Pilotage : pas de carte ; retour Indicateurs : carte', async () => {
    await env.window.getByText('Pilotage des Activités de Terrain').first().click();
    await env.window.waitForTimeout(800);
    await expect(card()).toHaveCount(0);
    await env.window.getByText('Indicateurs Système').first().click();
    await expect(card()).toBeVisible();
  });

  test('ADMIN_SITE — expiry_date invalide : « Échéance indisponible », dashboard intact', async () => {
    await setSiteLicence(env.seed.siteId, 'pas-une-date', 0);
    await env.window.getByRole('button', { name: /Actualiser/ }).click();
    await expect(card()).toContainText('Échéance indisponible', { timeout: 30000 });
    await shot('admin_date_invalide');
    expect(await cardText()).toContain(CONTACT_MSG);
    await expect(env.window.getByText('Indicateurs Système').first()).toBeVisible();
    await logout();
  });

  // ── 2. SUPER ADMIN ───────────────────────────────────────────────────────
  test('SUPER ADMIN — sans site : aucune carte ; site choisi : bonne carte, jamais de contact ; changement de site', async () => {
    const mk = async (code: string, nom: string, expiry: string | null, perm: 0 | 1) => {
      await dbQuery(
        'INSERT INTO t_sites (nom, code, is_active, max_centres, is_permanent, expiry_date, sync_id) VALUES (?,?,1,4,?,?,?)',
        [nom, code, perm, expiry, `zztest-${code}`]
      );
      siteIds[code] = (await dbQuery('SELECT id FROM t_sites WHERE code = ?', [code]))[0].id;
    };
    await setSiteLicence(env.seed.siteId, null, 1);
    await mk('ZZTEST_B', 'ZZTEST_B_orange', midnightUtcIso(12), 0);
    await mk('ZZTEST_C', 'ZZTEST_C_vert', midnightUtcIso(60), 0);
    await mk('ZZTEST_D', 'ZZTEST_D_sans', null, 0);

    await login('superAdmin');
    await env.window.waitForURL(/#\/(dashboard|role-selector)/, { timeout: 30000 });
    await goto('#/dashboard');
    await env.window.waitForTimeout(2000);
    await expect(card()).toHaveCount(0);
    await shot('super_sans_site');

    const sel = env.window.locator('select.site-select');
    await sel.selectOption(String(siteIds['ZZTEST_B']));
    await env.window.waitForTimeout(1500);
    let text = await cardText();
    await shot('super_site_B');
    expect(text).toContain(`${expectedDaysLeft(midnightUtcIso(12))} jours restants`);
    expect(text).toContain(`Échéance le ${expectedFrDate(midnightUtcIso(12))}`);
    expect(text).not.toContain('contactez');

    await sel.selectOption(String(siteIds['ZZTEST_C']));
    await expect(card()).toContainText(`${expectedDaysLeft(midnightUtcIso(60))} jours restants`, { timeout: 20000 });
    expect(await cardText()).not.toContain('contactez');
    await shot('super_site_C');

    await sel.selectOption(String(siteIds['ZZTEST_D']));
    await expect(card()).toContainText('Échéance non définie', { timeout: 20000 });
    expect(await cardText()).not.toContain('contactez');

    await sel.selectOption(String(env.seed.siteId));
    await expect(card()).toContainText('Licence permanente', { timeout: 20000 });
    await shot('super_site_permanent');

    await sel.selectOption('');
    await env.window.waitForTimeout(1200);
    await expect(card()).toHaveCount(0);
  });

  test('SUPER ADMIN — non-régression : page Sites (échéance) inchangée', async () => {
    await goto('#/sites');
    await env.window.waitForTimeout(1500);
    const body = (await env.window.locator('body').innerText()).replace(/\s+/g, ' ');
    await shot('super_page_sites');
    expect(body).toContain('PERMANENTE');
    expect(body).toContain('ZZTEST_B_orange');
    expect(body).toContain('Non définie');
    await logout();
  });

  // ── 3. Autres rôles ──────────────────────────────────────────────────────
  for (const key of ['operateurSaisie', 'adminCentre', 'operateurVerification']) {
    test(`Autre rôle ${key} — aucune carte Licence`, async () => {
      await setSiteLicence(env.seed.siteId, midnightUtcIso(10), 0);
      await login(key);
      await env.window.waitForTimeout(3500);
      await shot(`autre_${key}`);
      await expect(card()).toHaveCount(0);
      expect(await env.window.locator('body').innerText()).not.toContain('Pour renouveler votre licence');
      await logout();
    });
  }

  // ── 6. Responsive ────────────────────────────────────────────────────────
  for (const [w, h] of [[1366, 768], [1024, 768]] as const) {
    test(`Responsive ${w}x${h} — pas de débordement horizontal, KPI visibles`, async () => {
      await setSiteLicence(env.seed.siteId, midnightUtcIso(2), 0);
      await setContentSize(w, h);
      await adminLoginOnDashboard();
      await expect(card()).toBeVisible();
      await env.window.waitForTimeout(1500);
      await shot(`responsive_${w}x${h}`);
      const m = await env.window.evaluate(() => {
        const c = document.querySelector('[role="status"][aria-label^="Licence :"]') as HTMLElement;
        const r = c.getBoundingClientRect();
        return {
          docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          cardRight: r.right, cardBottom: r.bottom, cardHeight: r.height, vw: window.innerWidth, vh: window.innerHeight
        };
      });
      console.log(`[LICENCE_QA] responsive ${w}x${h}: ${JSON.stringify(m)}`);
      expect(m.docOverflow).toBeLessThanOrEqual(0);
      expect(m.cardRight).toBeLessThanOrEqual(m.vw);
      await logout();
    });
  }

  // ── 7. Console ───────────────────────────────────────────────────────────
  test('Console renderer — aucune erreur/warning lié à la carte Licence', async () => {
    const bad = consoleMsgs.filter((m) => /LicenseStatusCard|license/i.test(m.text) && ['error', 'warning', 'pageerror'].includes(m.type));
    console.log(`[LICENCE_QA] ${consoleMsgs.length} messages console, dont erreurs/warnings: ${consoleMsgs.filter((m) => ['error', 'warning', 'pageerror'].includes(m.type)).map((m) => `${m.type}: ${m.text.slice(0, 160)}`).join(' || ')}`);
    expect(bad).toEqual([]);
  });
});
