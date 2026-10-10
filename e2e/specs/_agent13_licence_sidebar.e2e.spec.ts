/**
 * e2e/specs/_agent13_licence_sidebar.e2e.spec.ts
 *
 * QA Terrain (agent-13) — badge « Licence · Pro » de l'en-tête de la Sidebar
 * (LicenseSidebarBadge.tsx + 3 lignes dans Sidebar.tsx, partagée par tous les rôles).
 *
 * Isolation : instance Electron avec userDataDir jetable (../fixtures/electron-app.ts), réseau Supabase
 * coupé (GEST_IN_SITU_E2E_DISABLE_SYNC=1), base seedée au schéma réel. Les sites ZZTEST_* ajoutés vivent
 * dans cette base jetable, supprimée au teardown. Mots de passe : fixtures ../fixtures/test-users.ts.
 *
 * Lancement (jamais via `npm test`) :  npx playwright test _agent13_licence_sidebar
 * (nécessite un build à jour : `npx electron-vite build`).
 * Captures : dossier LICENCE_SIDEBAR_QA_SHOT_DIR, sinon test-results/agent13-licence-sidebar/ (ignoré par git).
 *
 * Les valeurs attendues (couleurs d'état, textes d'infobulle) sont écrites en dur ici, indépendamment du code testé.
 */
import { test, expect, type Locator } from '@playwright/test';
import { launchSeededApp, teardownSeededApp, type E2EEnvironment } from '../fixtures/electron-app';
import { getTestUser } from '../fixtures/test-users';
import { join } from 'path';
import { mkdirSync } from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const SHOT_DIR = process.env.LICENCE_SIDEBAR_QA_SHOT_DIR || join(__dirname, '..', '..', 'test-results', 'agent13-licence-sidebar');
const TIP_ADMIN = 'Pour renouveler, contactez le super administrateur.';
const TIP_OTHER = "Pour renouveler, contactez l'administrateur du site.";

function midnightUtcIso(offsetDays: number): string {
  const t = new Date();
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate() + offsetDays)).toISOString();
}

type Color = 'green' | 'orange' | 'red' | 'gray';
interface Case { label: string; expiry: string | null; perm: 0 | 1; color: Color; soon: boolean; tip: boolean }
const CASES: Case[] = [
  { label: 'plus45', expiry: midnightUtcIso(45), perm: 0, color: 'green', soon: false, tip: false },
  { label: 'plus10', expiry: midnightUtcIso(10), perm: 0, color: 'orange', soon: false, tip: true },
  { label: 'plus2', expiry: midnightUtcIso(2), perm: 0, color: 'red', soon: true, tip: true },
  { label: 'permanent', expiry: null, perm: 1, color: 'green', soon: false, tip: false },
  { label: 'sans_echeance', expiry: null, perm: 0, color: 'orange', soon: false, tip: true },
  { label: 'date_invalide', expiry: 'pas-une-date', perm: 0, color: 'gray', soon: false, tip: false }
];

test.describe.serial('QA Terrain — badge Licence de la Sidebar (agent-13)', () => {
  let env: E2EEnvironment;
  let anyTestFailed = false;
  const consoleMsgs: { type: string; text: string }[] = [];
  const palette: Record<Color, string> = { green: '', orange: '', red: '', gray: '' };

  test.beforeAll(async () => {
    mkdirSync(SHOT_DIR, { recursive: true });
    env = await launchSeededApp();
    expect(env.seed.dbPath.startsWith(env.userDataDir)).toBe(true); // base jetable uniquement
    env.window.on('console', (m) => consoleMsgs.push({ type: m.type(), text: m.text() }));
    env.window.on('pageerror', (e) => consoleMsgs.push({ type: 'pageerror', text: String(e) }));
    // Compteur d'appels hierarchy:getSites côté main (enveloppe le handler existant, lecture seule).
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  async function getSitesCalls(): Promise<number> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return env.app.evaluate(() => (globalThis as any).__getSitesCalls as number);
  }
  /** Notifie la Sidebar comme le fait le reste de l'app après une mutation (recharge getSites). */
  async function fireDataUpdated(): Promise<void> {
    await env.window.evaluate(() => window.dispatchEvent(new Event('app:data-updated')));
    await env.window.waitForTimeout(900);
  }
  const header = (): Locator => env.window.locator('.sidebar-header');
  const badge = (): Locator => env.window.locator('.sidebar-header [role="status"]');

  async function waitSidebar(): Promise<void> {
    await env.window.waitForURL(/#\/(?!login)/, { timeout: 30000 });
    await header().waitFor({ timeout: 30000 });
    // laisse le temps au chargement getSites (le sous-titre quitte l'état « Chargement »)
    await expect(env.window.locator('.sidebar-subtitle')).not.toContainText('Chargement', { timeout: 20000 });
  }
  /** Mesure du libellé « Expire bientôt » (2e ligne du badge critique). */
  async function readSoon(): Promise<{ text: string; sw: number; cw: number; left: number; right: number; asideLeft: number; asideRight: number; textOverflow: string; lines: number }> {
    return env.window.evaluate(() => {
      const b = document.querySelector('.sidebar-header [role="status"]') as HTMLElement;
      const el = Array.from(b.querySelectorAll('span')).find((s) => (s.textContent || '').includes('Expire')) as HTMLElement;
      const r = el.getBoundingClientRect();
      const a = (document.querySelector('aside.sidebar') as HTMLElement).getBoundingClientRect();
      const lh = parseFloat(getComputedStyle(el).lineHeight) || parseFloat(getComputedStyle(el).fontSize) * 1.2;
      return {
        text: el.innerText, sw: el.scrollWidth, cw: el.clientWidth, left: Math.round(r.left), right: Math.round(r.right),
        asideLeft: Math.round(a.left), asideRight: Math.round(a.right), textOverflow: getComputedStyle(el).textOverflow,
        lines: Math.round(r.height / lh)
      };
    });
  }
  async function dotColor(): Promise<string> {
    return badge().locator('span').first().evaluate((el) => getComputedStyle(el).backgroundColor);
  }
  async function readBadge(): Promise<{ text: string; dot: string; title: string | null; describedBy: string | null; hidden: string }> {
    const text = ((await badge().innerText()) || '').replace(/\s+/g, ' ').trim();
    const title = await badge().getAttribute('title');
    const describedBy = await badge().getAttribute('aria-describedby');
    const hidden = describedBy
      ? (((await env.window.locator(`[id="${describedBy}"]`).textContent()) || '').trim())
      : '';
    return { text, dot: await dotColor(), title, describedBy, hidden };
  }
  /** Vérifie un cas sur le badge déjà affiché ; `tip` = infobulle attendue pour ce rôle. */
  async function assertCase(c: Case, tipText: string): Promise<string> {
    await expect(badge()).toBeVisible({ timeout: 15000 });
    const b = await readBadge();
    expect(b.text.startsWith('LICENCE')).toBe(true); // text-transform: uppercase : innerText rend la casse affichée
    expect(b.text).toContain('Pro');
    expect(b.text).not.toMatch(/\d/); // aucun nombre de jours ni date
    expect(b.dot).toBe(palette[c.color]);
    if (c.soon) expect(b.text).toContain('Expire bientôt');
    else expect(b.text).not.toContain('Expire bientôt');
    if (c.tip) {
      expect(b.title).toBe(tipText);
      expect(b.describedBy).toBeTruthy();
      expect(b.hidden).toBe(tipText);
    } else {
      expect(b.title).toBeNull();
      expect(b.describedBy).toBeNull();
    }
    return `${c.label} | texte="${b.text}" | pastille=${b.dot} | title=${b.title} | aria="${b.hidden}"`;
  }

  // ── 0. Palette de référence (couleurs d'état résolues par le navigateur) ──
  test('Palette — résolution des couleurs d\'état (variables CSS du thème)', async () => {
    await expect(env.window.getByTestId('login-input')).toBeVisible({ timeout: 60000 });
    const res = await env.window.evaluate(() => {
      const resolve = (v: string) => {
        const p = document.createElement('span');
        p.style.background = `var(${v})`;
        document.body.appendChild(p);
        const c = getComputedStyle(p).backgroundColor;
        p.remove();
        return c;
      };
      return { green: resolve('--accent-green'), orange: resolve('--accent-orange'), red: resolve('--accent-red'), gray: resolve('--text-secondary') };
    });
    Object.assign(palette, res);
    console.log(`[SIDEBAR_QA] palette ${JSON.stringify(res)}`);
    expect(new Set(Object.values(res)).size).toBe(4); // 4 couleurs distinctes
  });

  // ── 1. ADMINISTRATEUR_SITE ───────────────────────────────────────────────
  test('ADMIN_SITE — 6 états de licence (texte, pastille, « Expire bientôt », title, aria) + app:data-updated + zéro appel getSites en plus', async () => {
    await setSiteLicence(env.seed.siteId, CASES[0].expiry, CASES[0].perm);
    await login('administrateurSite');
    await waitSidebar();
    for (const c of CASES) {
      await setSiteLicence(env.seed.siteId, c.expiry, c.perm);
      const before = await getSitesCalls();
      await fireDataUpdated();
      const after = await getSitesCalls();
      expect(after - before).toBe(1); // 1 seul rechargement (celui de la Sidebar), le badge n'en ajoute aucun
      const line = await assertCase(c, TIP_ADMIN);
      await shot(`admin_${c.label}`);
      console.log(`[SIDEBAR_QA] ADMIN_SITE ${line}`);
    }
    await logout();
  });

  // ── 2. Autres rôles ──────────────────────────────────────────────────────
  const OTHER_ROLES = ['adminCentre', 'operateurSaisie', 'operateurVerification', 'operateurLogistique', 'operateurQualite', 'operateurInventaire', 'operateurApurement'];
  for (const key of OTHER_ROLES) {
    test(`Rôle ${key} — +10 j (orange) et +2 j (rouge) : badge, infobulle « administrateur du site », pas de nombre`, async () => {
      await setSiteLicence(env.seed.siteId, CASES[1].expiry, 0);
      await login(key);
      await waitSidebar();
      console.log(`[SIDEBAR_QA] ${key} ${await assertCase(CASES[1], TIP_OTHER)}`);
      await shot(`role_${key}_plus10`);
      await setSiteLicence(env.seed.siteId, CASES[2].expiry, 0);
      await fireDataUpdated();
      console.log(`[SIDEBAR_QA] ${key} ${await assertCase(CASES[2], TIP_OTHER)}`);
      await shot(`role_${key}_plus2`);
      // +45 j et permanent : badge sans infobulle
      await setSiteLicence(env.seed.siteId, CASES[0].expiry, 0);
      await fireDataUpdated();
      console.log(`[SIDEBAR_QA] ${key} ${await assertCase(CASES[0], TIP_OTHER)}`);
      await logout();
    });
  }

  // ── 3. SUPER ADMIN ───────────────────────────────────────────────────────
  test('SUPER ADMIN — sans site puis sites aux états différents : jamais de badge dans l\'en-tête', async () => {
    const siteIds: Record<string, number> = {};
    const mk = async (code: string, nom: string, expiry: string | null, perm: 0 | 1) => {
      await dbQuery(
        'INSERT INTO t_sites (nom, code, is_active, max_centres, is_permanent, expiry_date, sync_id) VALUES (?,?,1,4,?,?,?)',
        [nom, code, perm, expiry, `zztest-${code}`]
      );
      siteIds[code] = (await dbQuery('SELECT id FROM t_sites WHERE code = ?', [code]))[0].id;
    };
    await mk('ZZTEST_ROUGE', 'ZZTEST_ROUGE', midnightUtcIso(2), 0);
    await mk('ZZTEST_ORANGE', 'ZZTEST_ORANGE', midnightUtcIso(12), 0);
    await mk('ZZTEST_VERT', 'ZZTEST_VERT', midnightUtcIso(60), 0);
    await mk('ZZTEST_SANS', 'ZZTEST_SANS', null, 0);
    await setSiteLicence(env.seed.siteId, null, 1);

    await login('superAdmin');
    await waitSidebar();
    await expect(badge()).toHaveCount(0);
    await shot('super_sans_site');
    const sel = env.window.locator('select.site-select');
    for (const code of ['ZZTEST_ROUGE', 'ZZTEST_ORANGE', 'ZZTEST_VERT', 'ZZTEST_SANS']) {
      await sel.selectOption(String(siteIds[code]));
      await env.window.waitForTimeout(1200);
      await expect(env.window.locator('.active-site-badge')).toContainText(code);
      await expect(badge()).toHaveCount(0);
      await shot(`super_${code}`);
    }
    await sel.selectOption(String(env.seed.siteId));
    await env.window.waitForTimeout(1000);
    await expect(badge()).toHaveCount(0);
    await fireDataUpdated();
    await expect(badge()).toHaveCount(0);
    await sel.selectOption('');
    await env.window.waitForTimeout(800);
    await expect(badge()).toHaveCount(0);
    // on laisse le super admin avec un site sélectionné avant déconnexion (test de résidu au scénario 6)
    await sel.selectOption(String(siteIds['ZZTEST_ROUGE']));
    await env.window.waitForTimeout(800);
    await logout();
    // Admin de site juste après un super admin : son propre badge, pas de résidu
    await setSiteLicence(env.seed.siteId, CASES[1].expiry, 0);
    await login('administrateurSite');
    await waitSidebar();
    console.log(`[SIDEBAR_QA] admin après super admin ${await assertCase(CASES[1], TIP_ADMIN)}`);
    await logout();
    // Retour super admin : plus de badge
    await login('superAdmin');
    await waitSidebar();
    await expect(badge()).toHaveCount(0);
    await logout();
  });

  // ── 4. Nom de site très long à 1366x768 ──────────────────────────────────
  test('Nom de site très long — 1366x768 : pas de débordement, ellipsis, badge lisible', async () => {
    const longName = 'ZZTEST_' + 'SITE_AVEC_UN_NOM_EXTREMEMENT_LONG_'.repeat(4);
    await dbQuery('UPDATE t_sites SET nom = ? WHERE id = ?', [longName, env.seed.siteId]);
    await setSiteLicence(env.seed.siteId, CASES[2].expiry, 0); // critical => texte « Expire bientôt » (le plus large)
    await setContentSize(1366, 768);
    await login('administrateurSite');
    await waitSidebar();
    await expect(badge()).toBeVisible();
    await env.window.waitForTimeout(800);
    const m = await env.window.evaluate(() => {
      const aside = document.querySelector('aside.sidebar') as HTMLElement;
      const hdr = document.querySelector('.sidebar-header') as HTMLElement;
      const b = document.querySelector('.sidebar-header [role="status"]') as HTMLElement;
      const sub = document.querySelector('.sidebar-subtitle') as HTMLElement;
      const btn = document.querySelector('.sidebar-toggle-btn') as HTMLElement;
      const br = b.getBoundingClientRect(), ar = aside.getBoundingClientRect(), btnR = btn.getBoundingClientRect();
      const kids = Array.from(b.children).map((c) => {
        const r = (c as HTMLElement).getBoundingClientRect();
        return { t: (c as HTMLElement).innerText, w: Math.round(r.width), right: Math.round(r.right), sw: (c as HTMLElement).scrollWidth, cw: (c as HTMLElement).clientWidth };
      });
      return {
        docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        asideScrollOverflow: aside.scrollWidth - aside.clientWidth,
        headerScrollOverflow: hdr.scrollWidth - hdr.clientWidth,
        asideRight: Math.round(ar.right), badgeRight: Math.round(br.right), badgeWidth: Math.round(br.width),
        btnRight: Math.round(btnR.right), btnLeft: Math.round(btnR.left),
        badgeScrollOverflow: b.scrollWidth - b.clientWidth,
        subEllipsis: sub.scrollWidth > sub.clientWidth, subOverflowCss: getComputedStyle(sub).textOverflow,
        kids, vw: window.innerWidth
      };
    });
    console.log(`[SIDEBAR_QA] long-name 1366x768 ${JSON.stringify(m)}`);
    await shot('nom_long_1366x768_expire_bientot');
    expect(m.docOverflow).toBeLessThanOrEqual(0);
    expect(m.asideScrollOverflow).toBeLessThanOrEqual(0);
    expect(m.headerScrollOverflow).toBeLessThanOrEqual(0);
    expect(m.badgeRight).toBeLessThanOrEqual(m.asideRight);
    expect(m.btnRight).toBeLessThanOrEqual(m.asideRight);
    expect(m.subEllipsis).toBe(true);
    // Lisibilité de « Expire bientôt » : VRAIE assertion (ex-annotation P1).
    const soon = m.kids.find((k) => k.t.includes('Expire'));
    expect(soon).toBeTruthy();
    expect(soon!.sw).toBeLessThanOrEqual(soon!.cw); // pas de contenu coupé
    const soonInfo = await readSoon();
    console.log(`[SIDEBAR_QA] expire-bientot ${JSON.stringify(soonInfo)}`);
    expect(soonInfo.text.replace(/\s+/g, ' ').trim()).toBe('Expire bientôt');
    expect(soonInfo.text).not.toMatch(/[…]|\.\.\./);
    expect(soonInfo.textOverflow).not.toBe('ellipsis');
    expect(soonInfo.right).toBeLessThanOrEqual(soonInfo.asideRight);
    expect(soonInfo.left).toBeGreaterThanOrEqual(soonInfo.asideLeft);
    expect(soonInfo.lines).toBeLessThanOrEqual(2); // 1 ligne, ou au pire « Expire / bientôt »
    await dbQuery('UPDATE t_sites SET nom = ? WHERE id = ?', ['ZZTEST_SITE', env.seed.siteId]);
    await fireDataUpdated();
    await logout();
  });

  // ── 4b. Contrôle visuel état critique : nom court / très long × 1366x768 / 1024x768 ──
  for (const [w, h] of [[1366, 768], [1024, 768]] as const) {
    test(`Critique (+2 j) nom court puis très long — ${w}x${h} : en-tête, repli, logo, ellipsis, « Expire bientôt » entier`, async () => {
      const longName = 'ZZTEST_' + 'SITE_AVEC_UN_NOM_EXTREMEMENT_LONG_'.repeat(4);
      await setSiteLicence(env.seed.siteId, CASES[2].expiry, 0);
      await setContentSize(w, h);
      await login('administrateurSite');
      await waitSidebar();
      const metrics = async () => env.window.evaluate(() => {
        const q = (s: string) => document.querySelector(s) as HTMLElement;
        const r = (e: HTMLElement) => { const b = e.getBoundingClientRect(); return { t: Math.round(b.top), b: Math.round(b.bottom), l: Math.round(b.left), r: Math.round(b.right) }; };
        const sub = q('.sidebar-subtitle');
        return {
          header: r(q('.sidebar-header')), toggle: r(q('.sidebar-toggle-btn')), logo: r(q('.sidebar-logo')),
          title: r(q('.sidebar-title')), sub: r(sub), aside: r(q('aside.sidebar')),
          subEllipsis: sub.scrollWidth > sub.clientWidth,
          docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          headerOverflow: q('.sidebar-header').scrollWidth - q('.sidebar-header').clientWidth
        };
      });
      const results: Record<string, Awaited<ReturnType<typeof metrics>>> = {};
      for (const [tag, nom] of [['court', 'ZZTEST_SITE'], ['long', longName]] as const) {
        await dbQuery('UPDATE t_sites SET nom = ? WHERE id = ?', [nom, env.seed.siteId]);
        await fireDataUpdated();
        await expect(badge()).toBeVisible();
        const mm = await metrics();
        results[tag] = mm;
        const soonInfo = await readSoon();
        console.log(`[SIDEBAR_QA] critique ${w}x${h} ${tag} ${JSON.stringify({ mm, soonInfo })}`);
        await shot(`critique_${tag}_${w}x${h}`);
        expect(soonInfo.text.replace(/\s+/g, ' ').trim()).toBe('Expire bientôt');
        expect(soonInfo.sw).toBeLessThanOrEqual(soonInfo.cw);
        expect(soonInfo.right).toBeLessThanOrEqual(soonInfo.asideRight);
        expect(mm.docOverflow).toBeLessThanOrEqual(0);
        expect(mm.headerOverflow).toBeLessThanOrEqual(0);
        expect(mm.toggle.r).toBeLessThanOrEqual(mm.aside.r);
        expect(mm.toggle.t).toBeGreaterThanOrEqual(mm.header.t);
        expect(mm.toggle.b).toBeLessThanOrEqual(mm.header.b);
        expect(mm.logo.b).toBeLessThanOrEqual(mm.header.b);
        expect(mm.sub.r).toBeLessThanOrEqual(mm.toggle.l + 1); // le nom de site ne passe pas sous le bouton de repli
      }
      // Le nom long ne change ni la hauteur de l'en-tête ni la position du bouton/logo
      expect(results.long.header.b - results.long.header.t).toBe(results.court.header.b - results.court.header.t);
      expect(results.long.toggle).toEqual(results.court.toggle);
      expect(results.long.logo).toEqual(results.court.logo);
      expect(results.long.subEllipsis).toBe(true);
      expect(results.court.subEllipsis).toBe(false);
      // Hauteur d'en-tête critique vs orange (une ligne de plus attendue, bornée)
      await setSiteLicence(env.seed.siteId, CASES[1].expiry, 0);
      await dbQuery('UPDATE t_sites SET nom = ? WHERE id = ?', ['ZZTEST_SITE', env.seed.siteId]);
      await fireDataUpdated();
      const orange = await metrics();
      const dh = (results.court.header.b - results.court.header.t) - (orange.header.b - orange.header.t);
      console.log(`[SIDEBAR_QA] ${w}x${h} hauteur en-tête critique-orange = ${dh}px`);
      expect(dh).toBeGreaterThanOrEqual(0);
      expect(dh).toBeLessThanOrEqual(20);
      await logout();
    });
  }

  // ── 4c. Autres états : pas de 2e ligne ; barre repliée propre en critique ──
  test('Autres états (vert/orange/permanent/sans échéance/invalide) : pas de 2e ligne, hauteur identique', async () => {
    await setContentSize(1366, 768);
    await login('administrateurSite');
    await waitSidebar();
    const hs: Record<string, number> = {};
    for (const c of CASES.filter((x) => !x.soon)) {
      await setSiteLicence(env.seed.siteId, c.expiry, c.perm);
      await fireDataUpdated();
      await expect(badge()).toBeVisible();
      const info = await env.window.evaluate(() => {
        const b = document.querySelector('.sidebar-header [role="status"]') as HTMLElement;
        const vis = Array.from(b.children).filter((e) => (e as HTMLElement).getBoundingClientRect().height > 2);
        return { visibleChildren: vis.length, h: Math.round(b.getBoundingClientRect().height) };
      });
      hs[c.label] = info.h;
      console.log(`[SIDEBAR_QA] sans 2e ligne ${c.label} ${JSON.stringify(info)}`);
      expect(info.visibleChildren).toBe(1);
      await shot(`etat_${c.label}_1366`);
    }
    expect(new Set(Object.values(hs)).size).toBe(1);
    await logout();
  });

  // ── 5. Repli / dépli + 7. accessibilité clavier du bouton ────────────────
  test('Repli/dépli répétés (souris + clavier) : badge masqué replié, de retour déplié, pas de crash', async () => {
    await setSiteLicence(env.seed.siteId, CASES[2].expiry, 0);
    await setContentSize(1366, 768);
    await login('administrateurSite');
    await waitSidebar();
    const toggle = env.window.locator('.sidebar-toggle-btn');
    const width = () => env.window.locator('aside.sidebar').evaluate((e) => Math.round(e.getBoundingClientRect().width));
    const wOpen = await width();
    await expect(badge()).toBeVisible();
    for (let i = 0; i < 3; i++) {
      await toggle.click();
      await env.window.waitForTimeout(500);
      await expect(badge()).toBeHidden();
      const wClosed = await width();
      expect(wClosed).toBeLessThan(wOpen);
      if (i === 0) await shot('replie_admin_critical');
      const ov = await env.window.evaluate(() => {
        const a = document.querySelector('aside.sidebar') as HTMLElement;
        return { aside: a.scrollWidth - a.clientWidth, doc: document.documentElement.scrollWidth - document.documentElement.clientWidth };
      });
      expect(ov.aside).toBeLessThanOrEqual(0);
      expect(ov.doc).toBeLessThanOrEqual(0);
      await toggle.click();
      await env.window.waitForTimeout(500);
      await expect(badge()).toBeVisible();
      expect(await width()).toBe(wOpen);
    }
    await shot('deplie_admin_critical');
    // Clavier : focus + Entrée puis Espace
    await toggle.focus();
    await expect(toggle).toBeFocused();
    await env.window.keyboard.press('Enter');
    await env.window.waitForTimeout(400);
    await expect(badge()).toBeHidden();
    await env.window.keyboard.press('Space');
    await env.window.waitForTimeout(400);
    await expect(badge()).toBeVisible();
    // Le badge n'est pas focalisable (ne vole pas de tabulation)
    expect(await badge().getAttribute('tabindex')).toBeNull();
    await logout();
  });

  // ── 6. Navigation, badge stable ──────────────────────────────────────────
  test('Navigation entre pages : badge stable, aucun appel getSites supplémentaire', async () => {
    await setSiteLicence(env.seed.siteId, CASES[1].expiry, 0);
    await login('administrateurSite');
    await waitSidebar();
    const ref = await readBadge();
    const callsBefore = await getSitesCalls();
    const links = env.window.locator('aside.sidebar nav a, aside.sidebar a.sidebar-link');
    const n = Math.min(await links.count(), 6);
    expect(n).toBeGreaterThan(1);
    for (let i = 0; i < n; i++) {
      await links.nth(i).click();
      await env.window.waitForTimeout(900);
      await expect(badge()).toBeVisible();
      const b = await readBadge();
      expect(b.text).toBe(ref.text);
      expect(b.dot).toBe(ref.dot);
      expect(b.title).toBe(ref.title);
    }
    console.log(`[SIDEBAR_QA] navigation ${n} liens; getSites supplémentaires: ${(await getSitesCalls()) - callsBefore}`);
    await shot('navigation_stable');
    await logout();
  });

  // ── 7. Non-régression Sidebar ────────────────────────────────────────────
  test('Non-régression Sidebar : titre, sous-titre = nom du site, navigation, repli, statut, version', async () => {
    await setSiteLicence(env.seed.siteId, CASES[1].expiry, 0);
    const siteNom = (await dbQuery('SELECT nom FROM t_sites WHERE id = ?', [env.seed.siteId]))[0].nom as string;
    await login('administrateurSite');
    await waitSidebar();
    await expect(env.window.locator('.sidebar-title')).toHaveText(/IN-SITU/i);
    await expect(env.window.locator('.sidebar-subtitle')).toHaveText(siteNom);
    await expect(env.window.locator('.sidebar-logo img')).toBeVisible();
    await expect(env.window.getByText('Tableau de bord').first()).toBeVisible();
    await expect(env.window.getByText('Déconnexion')).toBeVisible();
    await expect(env.window.locator('.sidebar-avatar')).toBeVisible();
    await expect(env.window.locator('.online-dot')).toBeVisible();
    // Ordre dans l'en-tête : titre, sous-titre puis badge (badge sous le nom du site)
    const order = await env.window.evaluate(() => {
      const s = document.querySelector('.sidebar-subtitle')!.getBoundingClientRect();
      const b = document.querySelector('.sidebar-header [role="status"]')!.getBoundingClientRect();
      return { subBottom: s.bottom, badgeTop: b.top };
    });
    expect(order.badgeTop).toBeGreaterThanOrEqual(order.subBottom - 1);
    await shot('non_regression_sidebar');
    await logout();
  });

  // ── 8. Console ───────────────────────────────────────────────────────────
  test('Console renderer — aucune erreur/avertissement lié au badge, à React (clés, hooks, aria)', async () => {
    const all = consoleMsgs.filter((m) => ['error', 'warning', 'pageerror'].includes(m.type));
    console.log(`[SIDEBAR_QA] ${consoleMsgs.length} messages console, erreurs/warnings: ${all.map((m) => `${m.type}: ${m.text.slice(0, 160)}`).join(' || ') || 'aucun'}`);
    const bad = all.filter((m) => m.type === 'pageerror' || /LicenseSidebarBadge|license|Rules of Hooks|Warning:|aria-describedby/i.test(m.text));
    expect(bad).toEqual([]);
  });
});
