/**
 * e2e/specs/_agent13_presence_loginat_cloud.cloud.e2e.spec.ts
 *
 * QA terrain agent-13 — correctif 242c2a3 (rejeu de last_login_at dans les battements tant que le login
 * n'est pas confirmé écrit) contre le VRAI Postgres du projet DEV ajadkziqaskadlzboeqo. JAMAIS la production.
 *
 * Test 1 (cas 2) : agent connecté pendant que le réseau est non-ONLINE (proxy Chromium mort -> ping KO),
 *   puis retour réseau (session.setProxy direct + sync.retryConnection) -> ligne avec last_login_at = heure du LOGIN.
 * Test 2 (cas 1, 3, 4) : login avant existence du compte cloud (FK), rattrapage, page Présence ADMINISTRATEUR_SITE,
 *   battement suivant (last_login_at inchangé), logout puis reconnexion (last_login_at mis à jour), nouveau battement.
 */
import { test, expect, _electron as electron } from '@playwright/test';
import { join } from 'path';
import { mkdtempSync, readFileSync, readdirSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { launchSeededApp, teardownSeededApp, type E2EEnvironment } from '../fixtures/electron-app';
import { runSeedInElectronNode } from '../fixtures/seed-runner';
import { getTestUser } from '../fixtures/test-users';
import { supabaseDev, ensureCloudSiteAndCentre, E2E_CLOUD_SUPABASE_URL } from '../fixtures/supabase-dev-client';

const execFileAsync = promisify(execFile);
const SHOT_DIR = join(__dirname, '..', '..', 'test-results', 'agent13-screenshots');
const MAIN_ENTRY_E2E_CLOUD = join(__dirname, '..', '..', 'dist-e2e-cloud', 'main', 'index.js');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test.describe.serial('QA terrain — last_login_at rejoué (242c2a3) contre vrai Postgres dev', () => {
  test.setTimeout(900_000);
  let failed = false;
  const syncIds: string[] = [];
  const envs: E2EEnvironment[] = [];

  test.afterEach(async ({}, ti) => { if (ti.status !== ti.expectedStatus) failed = true; });
  test.afterAll(async () => {
    try {
      for (const id of syncIds) {
        await supabaseDev.from('t_user_presence').delete().eq('user_sync_id', id);
        await supabaseDev.from('t_users').delete().eq('sync_id', id);
      }
      await supabaseDev.from('t_centres').delete().ilike('nom', 'ZZTEST_%');
      await supabaseDev.from('t_sites').delete().ilike('nom', 'ZZTEST_%');
      const left = await Promise.all([
        supabaseDev.from('t_users').select('id_user', { count: 'exact', head: true }),
        supabaseDev.from('t_user_presence').select('user_sync_id', { count: 'exact', head: true }),
        supabaseDev.from('t_centres').select('id', { count: 'exact', head: true }),
        supabaseDev.from('t_sites').select('id', { count: 'exact', head: true })
      ]);
      console.log(`[LGA][CLEANUP] résiduel users=${left[0].count} presence=${left[1].count} centres=${left[2].count} sites=${left[3].count}`);
    } catch (e) { console.error('[LGA][CLEANUP] échec', e); }
    for (const e of envs) { try { await teardownSeededApp(e, failed); } catch { /* */ } }
  });

  async function dbQuery(env: E2EEnvironment, sql: string): Promise<any[]> {
    const script = `
      const Database = require('better-sqlite3');
      const db = new Database(process.argv[1], { readonly: true, timeout: 15000 });
      try { process.stdout.write('__Q__:' + JSON.stringify(db.prepare(process.argv[2]).all())); } finally { db.close(); }`;
    const electronPath = require('electron') as unknown as string;
    const { stdout } = await execFileAsync(electronPath, ['-e', script, env.seed.dbPath, sql],
      { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf-8' });
    return JSON.parse(stdout.split(/\r?\n/).reverse().find((l) => l.startsWith('__Q__:'))!.slice(6));
  }
  const appLog = (env: E2EEnvironment) => {
    const dir = join(env.userDataDir, 'logs');
    return existsSync(dir) ? readdirSync(dir).map((f) => readFileSync(join(dir, f), 'utf8')).join('\n') : '';
  };
  const row = async (id: string) => (await supabaseDev.from('t_user_presence').select('*').eq('user_sync_id', id).maybeSingle()).data as any;
  async function waitRow(id: string, pred: (r: any) => boolean, ms: number) {
    const t0 = Date.now(); let last: any = null;
    while (Date.now() - t0 < ms) { last = await row(id); if (last && pred(last)) return last; await sleep(300); }
    return last;
  }
  async function waitOnline(env: E2EEnvironment) {
    for (let i = 0; i < 120; i++) {
      const s = await env.window.evaluate(async () => { try { return (await (window as any).api.sync.getStatus()).state; } catch { return null; } });
      if (s === 'ONLINE') return true; await sleep(500);
    }
    return false;
  }
  async function loginUi(env: E2EEnvironment, key: 'operateurVerification' | 'administrateurSite', url: RegExp) {
    const u = getTestUser(key);
    await env.window.waitForURL(/#\/login/, { timeout: 30000 });
    await env.window.getByTestId('login-input').fill(u.login);
    await env.window.getByTestId('password-input').fill(u.password);
    const t = Date.now();
    await env.window.getByTestId('login-submit').click();
    await env.window.waitForURL(url, { timeout: 30000 });
    return t;
  }
  function mirrorUser(u: any) {
    return supabaseDev.from('t_users').insert({
      login: u.login, password_hash: u.password_hash, role: u.role, nom_user: u.nom_user,
      prenom_user: u.prenom_user, statut_actif: 1, site_id: u.site_id, centre_id: u.centre_id, sync_id: u.sync_id
    });
  }
  const USER_SQL = `SELECT sync_id, login, site_id, centre_id, role, nom_user, prenom_user, password_hash FROM t_users WHERE login='E2E_OPERATEUR_VERIFICATION'`;

  test('Cas 2 : login pendant réseau non-ONLINE (perdu) puis retour réseau -> last_login_at = heure du login initial', async () => {
    expect(E2E_CLOUD_SUPABASE_URL).toContain('ajadkziqaskadlzboeqo');
    expect(E2E_CLOUD_SUPABASE_URL).not.toContain('itvyayakwgzvfqvdrgyv');
    const userDataDir = mkdtempSync(join(tmpdir(), 'gest-in-situ-e2e-'));
    const seed = await runSeedInElectronNode(userDataDir);
    await ensureCloudSiteAndCentre(seed.siteId, seed.centreId);
    const baseEnv = { ...(process.env as Record<string, string>) };
    delete baseEnv.GEST_IN_SITU_E2E_DISABLE_SYNC;
    // Proxy Chromium mort : le ping réseau (electron net) échoue -> état jamais ONLINE. Aucun trafic ne sort.
    const app = await electron.launch({ args: [MAIN_ENTRY_E2E_CLOUD, `--user-data-dir=${userDataDir}`, '--proxy-server=127.0.0.1:9'], env: baseEnv });
    let window = app.windows().find((w) => !w.url().includes('splash.html'));
    for (let i = 0; i < 240 && !window; i++) { await sleep(500); window = app.windows().find((w) => !w.url().includes('splash.html')); }
    expect(window).toBeTruthy();
    await window!.waitForLoadState('domcontentloaded');
    const env: E2EEnvironment = { app, window: window!, userDataDir, seed };
    envs.push(env);

    const u = (await dbQuery(env, USER_SQL))[0];
    syncIds.push(u.sync_id);
    const { error } = await mirrorUser(u);
    expect(error, error?.message).toBeNull();      // compte cloud présent : seule la couche réseau peut faire perdre le login
    expect(await row(u.sync_id)).toBeNull();
    const st0 = await window!.evaluate(async () => (await (window as any).api.sync.getStatus()).state);
    console.log(`[LGA][2] état réseau avant login = ${st0}`);
    expect(st0).not.toBe('ONLINE');

    const tLogin = await loginUi(env, 'operateurVerification', /#\/agent-verification/);
    const st1 = await window!.evaluate(async () => (await (window as any).api.sync.getStatus()).state);
    await sleep(20000);
    console.log(`[LGA][2] login clic=${new Date(tLogin).toISOString()} ; état réseau à +20 s = ${st1} ; ligne cloud = ${JSON.stringify(await row(u.sync_id))}`);
    expect(await row(u.sync_id), 'login hors ligne: aucune ligne ne doit exister').toBeNull();

    // Retour réseau : proxy direct + retry (mécanisme existant network:retry)
    await app.evaluate(async ({ session }) => { await session.defaultSession.setProxy({ mode: 'direct' }); });
    const tBack = Date.now();
    const r = await window!.evaluate(async () => (window as any).api.sync.retryConnection());
    console.log(`[LGA][2] retour réseau demandé ${new Date(tBack).toISOString()} -> ${JSON.stringify(r)}`);
    const got = await waitRow(u.sync_id, (x) => !!x, 60000);
    console.log(`[LGA][2] ligne apparue à T_retour+${Date.now() - tBack} ms = ${JSON.stringify(got)}`);
    console.log(`[LGA][2] logs réseau/présence:\n` + appLog(env).split('\n').filter((l) => /NetworkMonitor|PresenceService/.test(l)).slice(-12).join('\n'));
    expect(got).not.toBeNull();
    expect(got.last_login_at).not.toBeNull();
    const lMs = new Date(got.last_login_at).getTime(); const hMs = new Date(got.last_heartbeat_at).getTime();
    console.log(`[LGA][2] last_login_at=${got.last_login_at} (clic ${new Date(tLogin).toISOString()}, écart ${lMs - tLogin} ms) ; last_heartbeat_at=${got.last_heartbeat_at} ; login->heartbeat=${hMs - lMs} ms`);
    expect(Math.abs(lMs - tLogin)).toBeLessThan(3000);
    expect(hMs - lMs).toBeGreaterThan(15000);
    await sleep(500);
    await teardownSeededApp(env, false); envs.pop();
    await supabaseDev.from('t_user_presence').delete().eq('user_sync_id', u.sync_id);
    await supabaseDev.from('t_users').delete().eq('sync_id', u.sync_id);
  });

  test('Cas 1+3+4 : FK puis rattrapage, page Présence admin, battement suivant, reconnexion', async () => {
    const A = await launchSeededApp({ allowRealSync: true });
    envs.push(A);
    expect(await waitOnline(A)).toBe(true);
    await ensureCloudSiteAndCentre(A.seed.siteId, A.seed.centreId);
    const u = (await dbQuery(A, USER_SQL))[0];
    syncIds.push(u.sync_id);
    expect(await row(u.sync_id)).toBeNull();
    const tLogin1 = await loginUi(A, 'operateurVerification', /#\/agent-verification/);
    await sleep(1500);
    expect(await row(u.sync_id)).toBeNull();
    const { error } = await mirrorUser(u);
    expect(error, error?.message).toBeNull();
    const r1 = await waitRow(u.sync_id, (x) => !!x, 200000);
    expect(r1).not.toBeNull();
    const l1 = new Date(r1.last_login_at).getTime();
    console.log(`[LGA][1] login clic=${new Date(tLogin1).toISOString()} ; rattrapage: last_login_at=${r1.last_login_at} last_heartbeat_at=${r1.last_heartbeat_at} (écart clic ${l1 - tLogin1} ms)`);
    expect(Math.abs(l1 - tLogin1)).toBeLessThan(3000);
    expect(l1).not.toBe(new Date(r1.last_heartbeat_at).getTime());

    // Cas 4 : page Présence côté admin (instance B lancée APRES le rattrapage : son compte admin absent du cloud
    // serait sinon désactivé par le cycle UserSync de +3 min — artefact de harnais, sans lien avec la présence).
    const B = await launchSeededApp({ allowRealSync: true });
    envs.push(B);
    expect(await waitOnline(B)).toBe(true);
    await loginUi(B, 'administrateurSite', /#\/dashboard/);
    await B.window.evaluate(() => { window.location.hash = '#/dashboard'; });
    await sleep(600);
    await B.window.evaluate(() => { window.location.hash = '#/agents/presence'; });
    await expect(B.window.locator('.presence-table')).toBeVisible({ timeout: 20000 });
    const readTable = () => B.window.evaluate(() => Array.from(document.querySelectorAll('.presence-table tbody tr')).map((tr) => {
      const tds = tr.querySelectorAll('td');
      return { statut: (tds[0]?.textContent || '').trim(), login: (tds[1]?.querySelector('div:nth-child(2)')?.textContent || '').trim(),
        connexion: (tds[4] as HTMLElement)?.innerText?.replace(/\n/g, ' | ').trim(), deconnexion: (tds[5] as HTMLElement)?.innerText?.replace(/\n/g, ' | ').trim() };
    }));
    const t4 = await readTable();
    console.log('[LGA][4] table admin = ' + JSON.stringify(t4) + ' ; attendu connexion=' + new Date(r1.last_login_at).toLocaleString('fr-FR'));
    await B.window.screenshot({ path: join(SHOT_DIR, 'agent13-LGA-4-page-presence.png') });
    const mine = t4.find((x) => x.login.includes('E2E_OPERATEUR_VERIFICATION'))!;
    expect(mine).toBeTruthy();
    expect(mine.connexion).toContain(new Date(r1.last_login_at).toLocaleString('fr-FR'));

    // Cas 3b : battement suivant : heartbeat avance, last_login_at inchangé
    const r2 = await waitRow(u.sync_id, (x) => new Date(x.last_heartbeat_at).getTime() > new Date(r1.last_heartbeat_at).getTime() + 1000, 170000);
    console.log(`[LGA][3b] battement suivant: heartbeat ${r1.last_heartbeat_at} -> ${r2.last_heartbeat_at} ; last_login_at ${r1.last_login_at} -> ${r2.last_login_at}`);
    expect(new Date(r2.last_heartbeat_at).getTime()).toBeGreaterThan(new Date(r1.last_heartbeat_at).getTime());
    expect(r2.last_login_at).toBe(r1.last_login_at);

    // Cas 3c : logout puis reconnexion -> last_login_at = nouvelle heure
    await A.window.getByRole('button', { name: 'Déconnexion' }).click();
    await A.window.waitForURL(/#\/login/, { timeout: 15000 });
    const rOut = await waitRow(u.sync_id, (x) => !!x.last_logout_at, 10000);
    console.log(`[LGA][3c] après logout: ${JSON.stringify(rOut)}`);
    await sleep(3000);
    const tLogin2 = await loginUi(A, 'operateurVerification', /#\/agent-verification/);
    const r3 = await waitRow(u.sync_id, (x) => new Date(x.last_login_at).getTime() > l1 + 1000, 15000);
    const l3 = new Date(r3.last_login_at).getTime();
    console.log(`[LGA][3a/3c] reconnexion clic=${new Date(tLogin2).toISOString()} -> ${JSON.stringify(r3)} (écart ${l3 - tLogin2} ms)`);
    expect(Math.abs(l3 - tLogin2)).toBeLessThan(3000);

    // Cas 3b bis : 1 battement de plus après la reconnexion : last_login_at inchangé
    const r4 = await waitRow(u.sync_id, (x) => new Date(x.last_heartbeat_at).getTime() > new Date(r3.last_heartbeat_at).getTime() + 1000, 170000);
    console.log(`[LGA][3b-bis] battement après reconnexion: heartbeat ${r3.last_heartbeat_at} -> ${r4.last_heartbeat_at} ; last_login_at ${r3.last_login_at} -> ${r4.last_login_at}`);
    expect(new Date(r4.last_heartbeat_at).getTime()).toBeGreaterThan(new Date(r3.last_heartbeat_at).getTime());
    expect(r4.last_login_at).toBe(r3.last_login_at);
  });
});
