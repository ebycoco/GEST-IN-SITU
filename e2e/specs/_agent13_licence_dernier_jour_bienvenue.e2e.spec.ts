/**
 * e2e/specs/_agent13_licence_dernier_jour_bienvenue.e2e.spec.ts
 *
 * QA Terrain — (1) règle A1 « dernier jour utilisable » de la licence de site (shared/utils/license.ts,
 * users.queries.ts authenticateUser, session-heartbeat.ts), (2) toast de bienvenue personnalisé
 * (pages/loginWelcome.ts + LoginPage.tsx), (3) couleur de l'échéance sur la page Sites (SitesPage.tsx).
 *
 * Isolation : instance Electron avec userDataDir jetable (voir ../fixtures/electron-app.ts), réseau Supabase
 * coupé (GEST_IN_SITU_E2E_DISABLE_SYNC=1 positionné par le harnais), base seedée. Aucune donnée réelle.
 * Les sites ZZTEST_* et le compte QA_TERRAIN_* n'existent que dans cette base jetable (supprimée au teardown).
 * Le mot de passe ROOT de secours est une valeur jetable posée dans l'environnement du process de test.
 *
 * Horloge : le blocage de licence s'exécute dans le process main, dont l'horloge n'est pas simulable par le
 * harnais. Les échéances sont donc calculées relativement à l'heure RÉELLE du run (minuit UTC d'aujourd'hui,
 * d'hier, de demain...). Le franchissement de minuit (23:59:59.999 -> 00:00:00.000 UTC) est couvert par le test
 * Vitest tests/session-heartbeat-license-site.test.ts (horloge simulée), pas ici.
 *
 * Lancement (jamais via `npm test`) :  npx playwright test _agent13_licence_dernier_jour_bienvenue
 * Captures : dossier donné par LICENCE_QA_SHOT_DIR, sinon test-results/agent13-licence-dernier-jour/.
 *
 * Les attendus sont calculés ici de façon indépendante du code testé (jours calendaires UTC par construction,
 * noms de mois en dur, textes de toast écrits à la main).
 */
import { test, expect, type Locator } from '@playwright/test';
import { launchSeededApp, teardownSeededApp, type E2EEnvironment } from '../fixtures/electron-app';
import { getTestUser } from '../fixtures/test-users';
import { hashPassword } from '../../src/main/auth/local-auth';
import { execFile } from 'child_process';
import { join } from 'path';
import { mkdirSync } from 'fs';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const SHOT_DIR = process.env.LICENCE_QA_SHOT_DIR || join(__dirname, '..', '..', 'test-results', 'agent13-licence-dernier-jour');
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const CONTACT_MSG = 'Pour renouveler votre licence, contactez le super administrateur.';
const ROOT_TEST_PWD = 'ZZTEST_root_jetable_2026';
const MULTI_LOGIN = 'QA_TERRAIN_MULTI_BIENVENUE';
const MULTI_PWD = 'QA_Terrain_Pwd_2026!';

/** Minuit UTC de (aujourd'hui UTC + n jours), au format ISO (comme SitesPage). */
function midnightUtcIso(offsetDays: number): string {
  const t = new Date();
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate() + offsetDays)).toISOString();
}
/** « 10 octobre 2026 » depuis la partie AAAA-MM-JJ de la valeur BRUTE en base. */
function expectedFrDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return `${d === 1 ? '1er' : d} ${MOIS[m - 1]} ${y}`;
}

test.describe.serial('QA Terrain — licence dernier jour (A1) + toast de bienvenue (agent-13)', () => {
  test.setTimeout(240000);
  let env: E2EEnvironment;
  let anyTestFailed = false;
  const consoleMsgs: { type: string; text: string }[] = [];
  const siteIds: Record<string, number> = {};

  test.beforeAll(async () => {
    mkdirSync(SHOT_DIR, { recursive: true });
    process.env.FAILSAFE_ROOT_PASSWORD = ROOT_TEST_PWD; // valeur jetable, héritée par l'instance lancée
    env = await launchSeededApp();
    expect(env.seed.dbPath.startsWith(env.userDataDir)).toBe(true); // base jetable uniquement
    env.window.on('console', (m) => consoleMsgs.push({ type: m.type(), text: m.text() }));
    env.window.on('pageerror', (e) => consoleMsgs.push({ type: 'pageerror', text: String(e) }));
  });

  test.afterAll(async () => {
    delete process.env.FAILSAFE_ROOT_PASSWORD;
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
  async function setSiteLicence(id: number, expiry: string | null, permanent: 0 | 1, active: 0 | 1 = 1): Promise<void> {
    await dbQuery('UPDATE t_sites SET expiry_date = ?, is_permanent = ?, is_active = ? WHERE id = ?', [expiry, permanent, active, id]);
  }
  async function setNames(key: string, nom: string, prenom: string): Promise<void> {
    await dbQuery('UPDATE t_users SET nom_user = ?, prenom_user = ? WHERE login = ?', [nom, prenom, getTestUser(key).login]);
  }
  async function loginRaw(loginStr: string, pwd: string): Promise<void> {
    await env.window.getByTestId('login-input').fill(loginStr);
    await env.window.getByTestId('password-input').fill(pwd);
    await env.window.getByTestId('login-submit').click();
  }
  async function login(key: string): Promise<void> {
    const u = getTestUser(key);
    await loginRaw(u.login, u.password);
  }
  async function logout(): Promise<void> {
    await env.window.getByText('Déconnexion').click();
    await env.window.waitForURL(/#\/login/, { timeout: 15000 });
  }
  async function goto(hash: string): Promise<void> {
    await env.window.evaluate((h) => { window.location.hash = h; }, hash);
    await env.window.waitForTimeout(1200);
  }
  async function shot(name: string): Promise<void> {
    await env.window.screenshot({ path: join(SHOT_DIR, `${name}.png`) });
  }
  const card = (): Locator => env.window.locator('[role="status"][aria-label^="Licence :"]');
  const banner = (): Locator => env.window.getByText(/Attention, votre licence expire le/);
  const sidebarBadge = (): Locator => env.window.locator('.sidebar-header [role="status"]');
  async function cardText(): Promise<string> {
    await expect(card()).toBeVisible({ timeout: 15000 });
    return ((await card().innerText()) || '').replace(/\s+/g, ' ').trim();
  }
  async function cssVar(v: string): Promise<string> {
    return env.window.evaluate((name) => {
      const p = document.createElement('span');
      p.style.color = `var(${name})`;
      document.body.appendChild(p);
      const c = getComputedStyle(p).color;
      p.remove();
      return c;
    }, v);
  }
  async function adminOnDashboard(): Promise<void> {
    await login('administrateurSite');
    await env.window.waitForURL(/#\/(dashboard|role-selector)/, { timeout: 30000 });
    await goto('#/dashboard');
    await env.window.getByText('Indicateurs Système').first().waitFor({ timeout: 30000 });
  }
  /** Lit le texte du toast de bienvenue juste après le clic de connexion. */
  async function loginAndReadToast(loginStr: string, pwd: string): Promise<string> {
    await loginRaw(loginStr, pwd);
    const toast = env.window.locator('[role="status"]').filter({ hasText: /^Bienvenue/ }).first();
    await expect(toast).toBeVisible({ timeout: 20000 });
    return ((await toast.innerText()) || '').replace(/\s+/g, ' ').trim();
  }

  // ── Préparation ──────────────────────────────────────────────────────────
  test('prépare les sites ZZTEST (HIER / AUJOURD\'HUI sur la page Sites)', async () => {
    const mk = async (code: string, nom: string, expiry: string | null) => {
      await dbQuery(
        'INSERT INTO t_sites (nom, code, is_active, max_centres, is_permanent, expiry_date, sync_id) VALUES (?,?,1,4,0,?,?)',
        [nom, code, expiry, `zztest-${code}`]
      );
      siteIds[code] = (await dbQuery('SELECT id FROM t_sites WHERE code = ?', [code]))[0].id;
    };
    await mk('ZZTEST_AUJ', 'ZZTEST_AUJ_aujourdhui', midnightUtcIso(0));
    await mk('ZZTEST_HIER', 'ZZTEST_HIER_hier', midnightUtcIso(-1));
    await mk('ZZTEST_DEM', 'ZZTEST_DEM_demain', midnightUtcIso(1));
    expect(Object.keys(siteIds)).toHaveLength(3);
  });

  // ── Scénario 1 : échéance = AUJOURD'HUI ──────────────────────────────────
  test('S1 ADMIN_SITE échéance AUJOURD\'HUI : accès OK, carte « Expire aujourd\'hui », bannière « (dernier jour inclus) », badge rouge « Expire bientôt »', async () => {
    const iso = midnightUtcIso(0);
    await setSiteLicence(env.seed.siteId, iso, 0);
    await adminOnDashboard();
    expect(env.window.url()).toMatch(/#\/dashboard/);
    const text = await cardText();
    console.log(`[A1_QA] S1 carte="${text}"`);
    expect(text).toContain("Expire aujourd'hui");
    expect(text).toContain(`Échéance le ${expectedFrDate(iso)}`);
    expect(text).toContain(CONTACT_MSG);
    // carte critique = bordure gauche rouge
    const border = await card().evaluate((el) => getComputedStyle(el).borderLeftColor);
    expect(border).toBe(await cssVar('--accent-red'));
    // bannière
    await expect(banner()).toBeVisible({ timeout: 15000 });
    const btxt = ((await banner().innerText()) || '').replace(/\s+/g, ' ').trim();
    console.log(`[A1_QA] S1 bannière="${btxt}"`);
    const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
    const moisCourt = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
    expect(btxt).toContain(`Attention, votre licence expire le ${moisCourt} (dernier jour inclus). Veuillez`);
    // badge Sidebar
    await expect(sidebarBadge()).toBeVisible({ timeout: 15000 });
    const dot = await sidebarBadge().locator('span').first().evaluate((el) => getComputedStyle(el).backgroundColor);
    const btext = ((await sidebarBadge().innerText()) || '').replace(/\s+/g, ' ').trim();
    console.log(`[A1_QA] S1 badge="${btext}" pastille=${dot}`);
    expect(dot).toBe(await cssVar('--accent-red'));
    expect(btext).toContain('Expire bientôt');
    await shot('s1_admin_expire_aujourdhui');
    // état en base : aucune modification de la donnée stockée
    expect((await dbQuery('SELECT expiry_date FROM t_sites WHERE id = ?', [env.seed.siteId]))[0].expiry_date).toBe(iso);
    await logout();
  });

  test('S1bis opérateur (OPERATEUR_SAISIE) échéance AUJOURD\'HUI : connexion OK + bannière version opérateur', async () => {
    await login('operateurSaisie');
    await env.window.waitForURL(/#\/(?!login)/, { timeout: 30000 });
    expect(env.window.url()).not.toMatch(/#\/login/);
    await expect(banner()).toBeVisible({ timeout: 15000 });
    const btxt = ((await banner().innerText()) || '').replace(/\s+/g, ' ').trim();
    console.log(`[A1_QA] S1bis bannière opérateur="${btxt}"`);
    expect(btxt).toContain('(dernier jour inclus). Veuillez en informer l\'administrateur du site');
    await shot('s1bis_operateur_aujourdhui');
    await logout();
  });

  // ── Scénario 2 : hier / demain / +10 / +45 / permanent / sans échéance ───
  test('S2 échéance HIER : connexion refusée, modale « Licence expirée », aucune session', async () => {
    await setSiteLicence(env.seed.siteId, midnightUtcIso(-1), 0);
    await login('administrateurSite');
    await expect(env.window.getByText('Licence expirée').first()).toBeVisible({ timeout: 15000 });
    const msg = await env.window.locator('body').innerText();
    console.log(`[A1_QA] S2 modale: ${msg.replace(/\s+/g, ' ').slice(0, 200)}`);
    expect(msg).toContain('La licence de votre site a expiré. Veuillez contacter le super administrateur.');
    expect(env.window.url()).toMatch(/#\/login/);
    await shot('s2_hier_modale_licence_expiree');
    await env.window.getByRole('button', { name: 'OK', exact: true }).click();
    await env.window.waitForTimeout(500);
    expect(env.window.url()).toMatch(/#\/login/);
    // opérateur aussi refusé
    await login('operateurSaisie');
    await expect(env.window.getByText('Licence expirée').first()).toBeVisible({ timeout: 15000 });
    await env.window.getByRole('button', { name: 'OK', exact: true }).click();
  });

  const cases: { label: string; expiry: string | null; perm: 0 | 1; head: string; border: 'red' | 'orange' | 'green' | null; banner: boolean; sidebarSoon: boolean }[] = [
    { label: 'demain', expiry: midnightUtcIso(1), perm: 0, head: '1 jour restant', border: 'red', banner: true, sidebarSoon: true },
    { label: 'plus10', expiry: midnightUtcIso(10), perm: 0, head: '10 jours restants', border: 'orange', banner: false, sidebarSoon: false },
    { label: 'plus45', expiry: midnightUtcIso(45), perm: 0, head: '45 jours restants', border: 'green', banner: false, sidebarSoon: false },
    { label: 'permanent', expiry: null, perm: 1, head: 'Licence permanente', border: null, banner: false, sidebarSoon: false },
    { label: 'sans_echeance', expiry: null, perm: 0, head: 'Échéance non définie', border: null, banner: false, sidebarSoon: false }
  ];
  for (const c of cases) {
    test(`S2 ADMIN_SITE — ${c.label} : « ${c.head} »`, async () => {
      await setSiteLicence(env.seed.siteId, c.expiry, c.perm);
      await adminOnDashboard();
      const text = await cardText();
      console.log(`[A1_QA] S2 ${c.label} carte="${text}"`);
      expect(text).toContain(c.head);
      if (c.expiry) expect(text).toContain(`Échéance le ${expectedFrDate(c.expiry)}`);
      if (c.border) {
        const b = await card().evaluate((el) => getComputedStyle(el).borderLeftColor);
        expect(b).toBe(await cssVar(`--accent-${c.border}`));
      }
      if (c.banner) await expect(banner()).toBeVisible({ timeout: 15000 });
      else await expect(banner()).toHaveCount(0);
      await expect(sidebarBadge()).toBeVisible({ timeout: 15000 });
      const btext = ((await sidebarBadge().innerText()) || '').replace(/\s+/g, ' ').trim();
      if (c.sidebarSoon) expect(btext).toContain('Expire bientôt');
      else expect(btext).not.toContain('Expire bientôt');
      await shot(`s2_${c.label}`);
      await logout();
    });
  }

  // ── Scénario 3 : session ouverte, échéance AUJOURD'HUI, tick heartbeat ───
  test('S3 session ouverte (échéance AUJOURD\'HUI) : pas de coupure après >= 1 tick de heartbeat (2 min)', async () => {
    await setSiteLicence(env.seed.siteId, midnightUtcIso(0), 0);
    await adminOnDashboard();
    await expect(banner()).toBeVisible({ timeout: 15000 });
    const logsBefore = consoleMsgs.length;
    await env.window.waitForTimeout(135000); // > 120 s : au moins un tick du setInterval du main
    expect(env.window.url()).toMatch(/#\/dashboard/);
    await expect(env.window.getByText('Licence expirée')).toHaveCount(0);
    await env.window.getByRole('button', { name: /Actualiser/ }).click();
    expect(await cardText()).toContain("Expire aujourd'hui");
    console.log(`[A1_QA] S3 session toujours active après 135 s ; ${consoleMsgs.length - logsBefore} nouveaux messages console`);
    await shot('s3_session_apres_tick');
    await logout();
  });

  // ── Scénario 4 : page Sites (SUPER ADMIN) ────────────────────────────────
  test('S4 page Sites : échéance AUJOURD\'HUI en --text-muted (pas rouge), HIER en rouge, DEMAIN en --text-muted', async () => {
    await login('superAdmin');
    await env.window.waitForURL(/#\/(dashboard|role-selector)/, { timeout: 30000 });
    await goto('#/sites');
    await env.window.waitForTimeout(1500);
    const red = await cssVar('--accent-red');
    const muted = await cssVar('--text-muted');
    const colorFor = async (nom: string): Promise<{ txt: string; color: string }> => {
      const row = env.window.locator('tr', { hasText: nom }).first();
      await expect(row).toBeVisible({ timeout: 15000 });
      return row.evaluate((tr) => {
        const spans = Array.from(tr.querySelectorAll('td:nth-last-child(2) span')) as HTMLElement[];
        const s = spans[0];
        return { txt: (s.textContent || '').trim(), color: getComputedStyle(s).color };
      });
    };
    const auj = await colorFor('ZZTEST_AUJ_aujourdhui');
    const hier = await colorFor('ZZTEST_HIER_hier');
    const dem = await colorFor('ZZTEST_DEM_demain');
    console.log(`[A1_QA] S4 AUJ="${auj.txt}" ${auj.color} | HIER="${hier.txt}" ${hier.color} | DEM="${dem.txt}" ${dem.color} | red=${red} muted=${muted}`);
    expect(auj.color).toBe(muted);
    expect(auj.color).not.toBe(red);
    expect(hier.color).toBe(red);
    expect(dem.color).toBe(muted);
    await shot('s4_page_sites_couleurs');
  });

  test('S7a SUPER ADMIN jamais bloqué par la licence (site rattaché expiré HIER)', async () => {
    await logout();
    await setSiteLicence(env.seed.siteId, midnightUtcIso(-1), 0);
    await login('superAdmin');
    await env.window.waitForURL(/#\/(?!login)/, { timeout: 30000 });
    expect(env.window.url()).not.toMatch(/#\/login/);
    await expect(env.window.getByText('Licence expirée')).toHaveCount(0);
    await logout();
  });

  test('S7b SITE_SUSPENDU inchangé : site is_active=0 (licence valable) -> refus « Accès suspendu »', async () => {
    await setSiteLicence(env.seed.siteId, midnightUtcIso(45), 0, 0);
    await login('administrateurSite');
    await expect(env.window.getByText('Accès suspendu').first()).toBeVisible({ timeout: 15000 });
    expect(env.window.url()).toMatch(/#\/login/);
    await shot('s7b_site_suspendu');
    await env.window.getByRole('button', { name: 'OK', exact: true }).click();
    await setSiteLicence(env.seed.siteId, midnightUtcIso(45), 0, 1);
  });

  test('S7c autres rôles : login normal avec licence +45 j (aucune bannière)', async () => {
    for (const key of ['adminCentre', 'operateurVerification', 'operateurQualite']) {
      await login(key);
      await env.window.waitForURL(/#\/(?!login)/, { timeout: 30000 });
      await env.window.waitForTimeout(1500);
      expect(env.window.url()).not.toMatch(/#\/login/);
      await expect(banner()).toHaveCount(0);
      await logout();
    }
  });

  // ── Scénario 5 : toast de bienvenue ──────────────────────────────────────
  const toastCases: { key: string; nom: string; prenom: string; expected: string; note: string }[] = [
    { key: 'operateurSaisie', nom: 'YEO', prenom: 'Awa', expected: 'Bienvenue Yeo !', note: 'nom MAJUSCULES -> capitalisé, jamais le prénom' },
    { key: 'adminCentre', nom: '', prenom: 'Fatou', expected: 'Bienvenue Fatou !', note: 'nom vide -> prénom' },
    { key: 'operateurVerification', nom: '', prenom: '', expected: 'Bienvenue !', note: 'nom+prénom vides' },
    { key: 'operateurLogistique', nom: 'KOUASSI-YAO', prenom: 'Jean', expected: 'Bienvenue Kouassi-Yao !', note: 'composé avec tiret' },
    { key: 'operateurQualite', nom: "N'GUESSAN", prenom: 'Paul', expected: "Bienvenue N'Guessan !", note: 'apostrophe' },
    { key: 'operateurInventaire', nom: 'Koné', prenom: 'Aïcha', expected: 'Bienvenue Koné !', note: 'casse mixte conservée' },
    { key: 'operateurApurement', nom: '   ', prenom: 'Marie', expected: 'Bienvenue Marie !', note: 'nom = espaces -> prénom' },
    { key: 'administrateurSite', nom: 'E2E', prenom: 'AdminSite', expected: 'Bienvenue E2e !', note: 'fixture E2E (tout en majuscules + chiffre) -> « E2e » conforme à la règle' }
  ];
  for (const c of toastCases) {
    test(`S5 toast — ${c.key} nom=${JSON.stringify(c.nom)} prénom=${JSON.stringify(c.prenom)} -> « ${c.expected} » (${c.note})`, async () => {
      await setNames(c.key, c.nom, c.prenom);
      const u = getTestUser(c.key);
      const got = await loginAndReadToast(u.login, u.password);
      console.log(`[A1_QA] S5 ${c.key}: toast="${got}"`);
      expect(got).toBe(c.expected);
      expect(got).not.toContain(c.prenom.trim() && c.nom.trim() ? c.prenom : '\u0000');
      if (c.key === 'operateurSaisie') await shot('s5_toast_bienvenue_yeo');
      await env.window.waitForURL(/#\/(?!login)/, { timeout: 30000 });
      await logout();
    });
  }

  test('S5 toast — SUPER ADMIN (nom E2E) : « Bienvenue E2e ! »', async () => {
    const u = getTestUser('superAdmin');
    const got = await loginAndReadToast(u.login, u.password);
    console.log(`[A1_QA] S5 superAdmin: toast="${got}"`);
    expect(got).toBe('Bienvenue E2e !');
    await env.window.waitForURL(/#\/(?!login)/, { timeout: 30000 });
    await logout();
  });

  test('S5 toast — compte ROOT (failsafe, mot de passe jetable) : « Bienvenue Root ! »', async () => {
    const got = await loginAndReadToast('ROOT', ROOT_TEST_PWD);
    console.log(`[A1_QA] S5 ROOT: toast="${got}"`);
    expect(got).toBe('Bienvenue Root !');
    await shot('s5_toast_bienvenue_root');
    await env.window.waitForURL(/#\/(?!login)/, { timeout: 30000 });
    await logout();
  });

  test('S5 toast — compte multi-rôles : « Bienvenue Traore ! Sélectionnez votre rôle pour cette session. »', async () => {
    const res = await dbQuery(
      `INSERT INTO t_users (login, password_hash, role, nom_user, prenom_user, statut_actif, site_id, centre_id, sync_id, is_dirty)
       VALUES (?, ?, 'ADMIN_CENTRE', 'TRAORE', 'Ibrahim', 1, ?, ?, ?, 0)`,
      [MULTI_LOGIN, hashPassword(MULTI_PWD), env.seed.siteId, env.seed.centreId, `qaterrain-multi-bienvenue-${Date.now()}`]
    );
    const id = res[0].lastInsertRowid;
    await dbQuery(`INSERT INTO t_user_roles (id_user, role) VALUES (?, 'ADMIN_CENTRE')`, [id]);
    await dbQuery(`INSERT INTO t_user_roles (id_user, role) VALUES (?, 'OPERATEUR_VERIFICATION')`, [id]);
    const got = await loginAndReadToast(MULTI_LOGIN, MULTI_PWD);
    console.log(`[A1_QA] S5 multi-rôles: toast="${got}"`);
    expect(got).toBe('Bienvenue Traore ! Sélectionnez votre rôle pour cette session.');
    await expect(env.window).toHaveURL(/#\/role-selector/, { timeout: 15000 });
    await shot('s5_toast_bienvenue_multiroles');
  });

  // ── Nettoyage + console ──────────────────────────────────────────────────
  test('Nettoyage : sites ZZTEST supprimés ; le compte QA_TERRAIN (référencé par t_logs) disparaît avec le répertoire jetable', async () => {
    await dbQuery("DELETE FROM t_sites WHERE code LIKE 'ZZTEST_%'");
    expect((await dbQuery("SELECT COUNT(*) AS n FROM t_sites WHERE code LIKE 'ZZTEST_%'"))[0].n).toBe(0);
    // Le compte QA_TERRAIN_* est référencé par les logs de connexion (FK) : sa suppression unitaire est refusée ;
    // toute la base (userDataDir temporaire) est supprimée au teardown quand la spec est verte.
  });

  test('Console renderer : aucune pageerror, aucune erreur liée à la licence ou au toast', async () => {
    const errs = consoleMsgs.filter((m) => ['error', 'pageerror'].includes(m.type));
    console.log(`[A1_QA] ${consoleMsgs.length} messages console, error/pageerror: ${errs.map((m) => `${m.type}: ${m.text.slice(0, 160)}`).join(' || ')}`);
    expect(consoleMsgs.filter((m) => m.type === 'pageerror')).toEqual([]);
    expect(errs.filter((m) => /licen[cs]e|welcome|bienvenue|loginWelcome/i.test(m.text))).toEqual([]);
  });
});
