/**
 * QA terrain agent-13 — validation VIVANTE de c8fd467 : LoginPage « première configuration »
 * (bandeau hors-ligne fiable + attente bornée du rapatriement des comptes).
 * Supabase DEV ajadkziqaskadlzboeqo UNIQUEMENT (build dist-e2e-cloud, --mode e2e). JAMAIS la production.
 * userData isolé (mkdtemp). Données cloud préfixées ZZTEST_LF_, sites/centres 9011.. ; nettoyage en afterAll.
 */
import { test, expect, _electron as electron } from '@playwright/test';
import { existsSync, readFileSync, readdirSync, statSync, mkdtempSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { teardownSeededApp, type E2EEnvironment } from '../fixtures/electron-app';
import { runSeedInElectronNode } from '../fixtures/seed-runner';
import { supabaseDev, E2E_CLOUD_SUPABASE_URL } from '../fixtures/supabase-dev-client';
import { sleep, sqlRead, appLog, loginUi, logoutUi, PWD, SHOT_DIR } from './_agent13_agents_helpers';

const execFileAsync = promisify(execFile);
const P = 'ZZTEST_LF_';
const S1 = 9011, S2 = 9012, C1 = 9111, C2 = 9211;
const log = (...a: any[]) => console.log('[LF]', ...a);
const J = (x: any) => JSON.stringify(x);
const results: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail = '') => { results.push({ name, ok, detail }); log(ok ? 'PASS' : 'FAIL', name, detail); };
const sy = (t: string) => `zztest-lf-${t}-${Date.now()}`;
const ROOT = resolve(__dirname, '../..');
const ENTRY = process.env.QA_ENTRY || join(ROOT, 'dist-e2e-cloud', 'main', 'index.js');
const shot = (env: E2EEnvironment, name: string) => env.window.screenshot({ path: join(SHOT_DIR, `agent13-LF-${name}.png`) }).catch(() => undefined);

async function sqlExec(env: E2EEnvironment, sqls: string[]) {
  const script = `const D=require('better-sqlite3');const db=new D(process.argv[1],{timeout:20000});try{db.pragma('foreign_keys = OFF');for(const s of JSON.parse(process.argv[2]))db.exec(s);process.stdout.write('__OK__');}finally{db.close();}`;
  const electronPath = require('electron') as unknown as string;
  const { stdout } = await execFileAsync(electronPath, ['-e', script, env.seed.dbPath, JSON.stringify(sqls)],
    { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf-8' });
  if (!stdout.includes('__OK__')) throw new Error('sqlExec KO ' + stdout);
}

const consoleLogs: { t: number; type: string; text: string }[] = [];
const pageErrors: string[] = [];
const T0 = () => Date.now();

async function launch(env: E2EEnvironment, opts: { disableSync?: boolean; offlineFromStart?: boolean } = {}) {
  const base: Record<string, string> = { ...(process.env as Record<string, string>) };
  delete base.GEST_IN_SITU_E2E_DISABLE_SYNC;
  if (opts.disableSync) base.GEST_IN_SITU_E2E_DISABLE_SYNC = '1';
  env.app = await electron.launch({ args: [ENTRY, `--user-data-dir=${env.userDataDir}`], env: base });
  if (opts.offlineFromStart) {
    // émulation réseau Electron (net.request du NetworkMonitor + renderer) dès que app est prête
    await env.app.evaluate(async ({ app, session }) => { const g: any = globalThis; g.__origFetch = g.__origFetch || g.fetch; g.__qaOff = true; g.fetch = (...a: any[]) => (g.__qaOff ? Promise.reject(new TypeError('fetch failed (QA offline)')) : g.__origFetch(...a)); await app.whenReady(); await session.defaultSession.setProxy({ proxyRules: 'http=127.0.0.1:9;https=127.0.0.1:9' }); });
  }
  const deadline = Date.now() + 120000;
  let w: any = null;
  while (Date.now() < deadline && !w) {
    w = env.app.windows().find((x) => { try { return !x.isClosed() && !x.url().includes('splash.html'); } catch { return false; } });
    if (!w) await Promise.race([env.app.waitForEvent('window', { timeout: 2000 }).catch(() => undefined), sleep(300)]);
  }
  if (!w) throw new Error('fenêtre principale introuvable');
  env.window = w;
  w.on('console', (m: any) => consoleLogs.push({ t: Date.now(), type: m.type(), text: m.text() }));
  w.on('pageerror', (e: any) => pageErrors.push(String(e)));
  // compteurs IPC côté main (instrumentation test uniquement)
  const inst = await env.app.evaluate(({ ipcMain }) => {
    const m = (ipcMain as any)._invokeHandlers as Map<string, any>;
    (globalThis as any).__ipc = { 'app:checkFirstLaunch': [], 'sync:forcePing': [], 'sync:forceGlobal': [] };
    const ok: string[] = [];
    for (const ch of Object.keys((globalThis as any).__ipc)) {
      const h = m?.get(ch); if (!h) continue;
      m.set(ch, async (...a: any[]) => { (globalThis as any).__ipc[ch].push(Date.now()); return h(...a); });
      ok.push(ch);
    }
    return ok;
  });
  log('instrumentation IPC =', J(inst));
  await w.waitForLoadState('domcontentloaded');
}
const ipcCalls = (env: E2EEnvironment, ch: string): Promise<number[]> => env.app.evaluate((_, c) => (globalThis as any).__ipc[c] || [], ch);
async function offlineOn(env: E2EEnvironment) {
  await env.app.evaluate(async ({ session }) => { const g: any = globalThis; g.__origFetch = g.__origFetch || g.fetch; g.__qaOff = true; g.fetch = (...a: any[]) => (g.__qaOff ? Promise.reject(new TypeError('fetch failed (QA offline)')) : g.__origFetch(...a)); await session.defaultSession.setProxy({ proxyRules: 'http=127.0.0.1:9;https=127.0.0.1:9' }); });
}
async function offlineOff(env: E2EEnvironment) {
  await env.app.evaluate(async ({ session }) => { const g: any = globalThis; g.__qaOff = false; await session.defaultSession.setProxy({ mode: 'direct' }); });
}

const banner = (env: E2EEnvironment): Promise<string | null> => env.window.evaluate(() => {
  const m = (document.body.innerText || '').split('\n').map((l) => l.trim()).find((l) => /^(🔴|🟡|🟢)/.test(l));
  return m || null;
}).catch(() => null);
const hasForm = async (env: E2EEnvironment) => (await env.window.getByTestId('login-input').count().catch(() => 0)) > 0;
const navOnLine = (env: E2EEnvironment) => env.window.evaluate(() => navigator.onLine).catch(() => null);

type Pt = { t: number; text: string | null; form: boolean; onLine: boolean | null };
async function sample(env: E2EEnvironment, tStart: number, until: (p: Pt) => boolean, maxMs: number, stepMs = 500) {
  const tl: Pt[] = []; let last: string | null | undefined = undefined; let lastForm: boolean | undefined;
  const end = Date.now() + maxMs;
  while (Date.now() < end) {
    const text = await banner(env); const form = await hasForm(env); const onLine = await navOnLine(env);
    const p: Pt = { t: Date.now() - tStart, text, form, onLine };
    if (text !== last || form !== lastForm) { tl.push(p); last = text; lastForm = form; log(`t=${(p.t / 1000).toFixed(1)}s banner=${J(text)} form=${form} nav.onLine=${onLine}`); }
    if (until(p)) { p.t = Date.now() - tStart; return { tl, done: true, at: p.t }; }
    await sleep(stepMs);
  }
  return { tl, done: false, at: Date.now() - tStart };
}
const rateOver = async (env: E2EEnvironment, ch: string, ms: number) => { const a = (await ipcCalls(env, ch)).length; await sleep(ms); return (await ipcCalls(env, ch)).length - a; };

test.describe.serial('QA terrain — LoginPage première configuration (c8fd467, cloud dev)', () => {
  test.setTimeout(2_400_000);
  let HASH = ''; let failed = false;
  const envs: E2EEnvironment[] = [];
  const ids: Record<string, string> = {};
  const created: string[] = [];

  async function freshEnv(wipe: boolean): Promise<E2EEnvironment> {
    const userDataDir = mkdtempSync(join(tmpdir(), 'gest-in-situ-e2e-lf-'));
    const seed = await runSeedInElectronNode(userDataDir);
    const env: E2EEnvironment = { app: null as any, window: null as any, userDataDir, seed };
    envs.push(env);
    if (wipe) await sqlExec(env, ['DELETE FROM t_user_roles', 'DELETE FROM t_users', 'DELETE FROM t_centres', 'DELETE FROM t_sites']);
    return env;
  }
  const cIns = async (tag: string, o: any = {}) => {
    const sync_id = sy(tag); ids[tag] = sync_id;
    const row = { login: P + tag, password_hash: HASH, role: 'OPERATEUR_VERIFICATION', nom_user: tag + '_NOM', prenom_user: 'P', statut_actif: 1, site_id: S1, centre_id: C1, ...o, sync_id };
    const r = await supabaseDev.from('t_users').insert(row);
    if (r.error) log('cloud insert ERR', tag, r.error.message);
    created.push(P + tag);
    return r.error?.message;
  };
  const cloudUsers = async () => (await supabaseDev.from('t_users').select('login')).data?.map((u: any) => u.login) || [];
  const cloudDeleteZZ = async () => {
    const { data: us } = await supabaseDev.from('t_users').select('sync_id,login').like('login', 'ZZTEST_LF_%');
    for (const u of us || []) {
      await supabaseDev.from('t_user_presence').delete().eq('user_sync_id', u.sync_id);
      await supabaseDev.from('t_user_roles').delete().eq('user_sync_id', u.sync_id);
    }
    await supabaseDev.from('t_users').delete().like('login', 'ZZTEST_LF_%');
  };
  const closeApp = async (env: E2EEnvironment) => { try { await teardownSeededApp(env, true); } catch { /* */ } };

  test.afterEach(async ({}, ti) => { if (ti.status !== ti.expectedStatus) failed = true; });
  test.afterAll(async () => {
    log(`BILAN: ${results.filter((r) => r.ok).length}/${results.length} OK`);
    for (const r of results.filter((x) => !x.ok)) log('ECHEC =>', r.name, r.detail);
    const errs = consoleLogs.filter((c) => c.type === 'error' || c.type === 'warning');
    log('console renderer error/warn =', J(errs.map((c) => c.type + ':' + c.text.slice(0, 200))), 'pageerrors =', J(pageErrors));
    for (const e of envs) { try { if (e.app) await closeApp(e); } catch { /* */ } }
    try {
      await cloudDeleteZZ();
      await supabaseDev.from('t_logs').delete().in('site_id', [S1, S2]);
      await supabaseDev.from('t_centres').delete().in('id', [C1, C2]);
      await supabaseDev.from('t_sites').delete().in('id', [S1, S2]);
      const left = await supabaseDev.from('t_users').select('login');
      const ls = await supabaseDev.from('t_sites').select('id');
      const lc = await supabaseDev.from('t_centres').select('id');
      log('CLEANUP cloud: users=', J(left.data), 'sites=', J(ls.data), 'centres=', J(lc.data), 'créés(logins)=', J(created));
    } catch (e) { console.error('[LF] cleanup échec', e); }
    /* userData conservés pour diagnostic */
  });

  test('00 garde-fous ref + cloud dev vide de ZZTEST_ + peuplement', async () => {
    expect(E2E_CLOUD_SUPABASE_URL).toContain('ajadkziqaskadlzboeqo');
    expect(E2E_CLOUD_SUPABASE_URL).not.toContain('itvyayakwgzvfqvdrgyv');
    expect(existsSync(ENTRY)).toBe(true);
    const scan = (dir: string): string[] => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? scan(p) : [p]; });
    const files = scan(join(ROOT, 'dist-e2e-cloud')).filter((f) => /\.(js|html|json|map)$/.test(f));
    const bad = files.filter((f) => readFileSync(f, 'utf8').includes('itvyayakwgzvfqvdrgyv'));
    expect(bad).toEqual([]);
    const withRef = files.filter((f) => /\.js$/.test(f) && readFileSync(f, 'utf8').includes('ajadkziqaskadlzboeqo'));
    const rend = files.filter((f) => f.includes('renderer') && /\.js$/.test(f) && readFileSync(f, 'utf8').includes('Rapatriement des comptes agents en cours'));
    check('00 build e2e: ref prod absent, ref dev présent, bundle renderer contient le correctif c8fd467', withRef.length > 0 && bad.length === 0 && rend.length > 0, `dev=${withRef.length} prod=0 renderer-fix=${rend.length}`);
    const pre = await cloudUsers();
    log('comptes cloud dev AVANT (tous):', J(pre));
    check('00 cloud dev: aucun compte préexistant hors ZZTEST_ (cloud "vide" exploitable pour S2)', pre.filter((l: string) => !l.startsWith('ZZTEST_')).length === 0, J(pre));
    await cloudDeleteZZ();
    // HASH : depuis un seed jetable
    const e0 = await freshEnv(false);
    HASH = (await sqlRead(e0, `SELECT password_hash FROM t_users WHERE login='E2E_ADMINISTRATEUR_SITE'`))[0].password_hash;
    // site / centres cloud
    const s = await supabaseDev.from('t_sites').upsert([
      { id: S1, nom: 'ZZTEST_LF_SITE1', code: 'ZZTEST-LF-S1', is_active: 1, max_centres: 4, is_permanent: true, sync_id: 'zztest-lf-site1' },
      { id: S2, nom: 'ZZTEST_LF_SITE2', code: 'ZZTEST-LF-S2', is_active: 1, max_centres: 4, is_permanent: true, sync_id: 'zztest-lf-site2' }], { onConflict: 'id' });
    expect(s.error?.message).toBeUndefined();
    const c = await supabaseDev.from('t_centres').upsert([
      { id: C1, site_id: S1, nom: 'ZZTEST_LF_C1', numero: 1, sync_id: 'zztest-lf-c1' },
      { id: C2, site_id: S2, nom: 'ZZTEST_LF_C2', numero: 1, sync_id: 'zztest-lf-c2' }], { onConflict: 'id' });
    expect(c.error?.message).toBeUndefined();
  });

  test('S1 base vide + Internet : formulaire sans Réessayer ni reload, jamais "Hors-ligne"', async () => {
    const errs = [await cIns('OP', {}), await cIns('ADM', { role: 'ADMINISTRATEUR_SITE', centre_id: null }), await cIns('S2OP', { role: 'OPERATEUR_SAISIE', site_id: S2, centre_id: C2 })];
    log('insert cloud erreurs =', J(errs));
    const env = await freshEnv(true);
    expect((await sqlRead(env, 'SELECT COUNT(*) c FROM t_users'))[0].c).toBe(0);
    const t0 = T0();
    await launch(env);
    const tWin = Date.now() - t0;
    log('fenêtre principale trouvée à', tWin, 'ms');
    const tS = Date.now();
    const r = await sample(env, tS, (p) => p.form, 60000);
    {
      const dl = async (ch: string) => { const a = await ipcCalls(env, ch); return { n: a.length, first: a.slice(0, 6).map((x) => x - tS), last: a.slice(-3).map((x) => x - tS) }; };
      log("DIAG IPC forcePing", J(await dl("sync:forcePing")), "forceGlobal", J(await dl("sync:forceGlobal")), "cfl", J(await dl("app:checkFirstLaunch")));
      log("DIAG t_users locaux =", (await sqlRead(env, "SELECT COUNT(*) c FROM t_users"))[0].c);
      log("DIAG main.log =", J(appLog(env).split(String.fromCharCode(10)).filter((l) => /Preload|forceGlobal|Session invalide|runSyncInitiale|NetworkMonitor|Accès refusé|utilisateurs synchronis/i.test(l)).slice(0, 25).map((l) => l.slice(0, 220))));
    }
    const texts = r.tl.map((p) => p.text);
    if (!r.done) {
      const hist = (await ipcCalls(env, "sync:forcePing")).map((x) => Math.floor((x - tS) / 500));
      const h: Record<number, number> = {}; for (const k of hist) h[k] = (h[k] || 0) + 1;
      log("DIAG histogramme forcePing par 500ms depuis tS =", J(h));
      const g0 = (await ipcCalls(env, "sync:forceGlobal")).length;
      const btn = env.window.getByRole("button", { name: /Réessayer la connexion/ });
      log("DIAG bouton Réessayer présent =", await btn.count());
      if (await btn.count()) { await btn.click(); const rr = await sample(env, Date.now(), (p) => p.form, 20000); log("DIAG après Réessayer: timeline", J(rr.tl), "forceGlobal +", (await ipcCalls(env, "sync:forceGlobal")).length - g0); }
      await shot(env, "S1-apres-reessayer");
      await env.window.reload(); const rl = await sample(env, Date.now(), (p) => p.form, 15000); log("DIAG après reload: timeline", J(rl.tl));
      log("DIAG console renderer =", J(consoleLogs.filter((c) => c.type === "error").map((c) => c.text.slice(0, 160))));
    }
    log('TIMELINE S1 =', J(r.tl));
    await shot(env, 'S1-formulaire');
    check('S1 le formulaire de login apparaît sans Réessayer/reload', r.done, `délai depuis fenêtre ${(r.at / 1000).toFixed(1)} s ; depuis lancement ${((r.at + tWin) / 1000).toFixed(1)} s`);
    check('S1 jamais de bandeau "Hors-ligne" pendant la phase', !texts.some((t) => t && /Hors-ligne/.test(t)), J(texts));
    check('S1 messages attendus observés (Connexion/Rapatriement) avant le formulaire', texts.some((t) => t && /Rapatriement|Connexion/.test(t)), J(texts));
    const s1p = (await ipcCalls(env, 'sync:forcePing')).length, s1g = (await ipcCalls(env, 'sync:forceGlobal')).length, s1c = (await ipcCalls(env, 'app:checkFirstLaunch')).length;
    log('MESURE S1 forcePing/forceGlobal/cfl =', s1p, s1g, s1c, '(attendu ~1/~1/~3-5)');
    check('S1 compteurs IPC bornés (forcePing<=2, forceGlobal<=2, checkFirstLaunch<=8)', s1p <= 2 && s1g <= 2 && s1c <= 8, `${s1p}/${s1g}/${s1c}`);
    await sleep(5000);
    check('S1 aucun appel de configuration après apparition du formulaire (5 s)', (await ipcCalls(env, 'sync:forcePing')).length === s1p && (await ipcCalls(env, 'app:checkFirstLaunch')).length === s1c, `${(await ipcCalls(env, 'sync:forcePing')).length}/${(await ipcCalls(env, 'app:checkFirstLaunch')).length}`);
    const cnt = (await sqlRead(env, 'SELECT COUNT(*) c FROM t_users'))[0].c;
    check('S1 base locale : comptes rapatriés (>0)', cnt > 0, 'c=' + cnt);
    const lr = await loginUi(env, P + 'OP', PWD, false);
    log('login OP =', J(lr));
    check('S1 connexion avec compte préchargé OK', lr.ok === true, J(lr));
    await sleep(1500);
    await closeApp(env);
  });

  test('S2 base vide + cloud sans compte : 90 s, compteurs, Réessayer stable, pas de boucle', async () => {
    await cloudDeleteZZ();
    log('comptes cloud avant S2 =', J(await cloudUsers()));
    const env = await freshEnv(true);
    await launch(env);
    const tS = Date.now();
    const r = await sample(env, tS, (p) => !!p.text && /Aucun compte agent récupéré/.test(p.text), 90000, 250);
    log('TIMELINE S2 =', J(r.tl.slice(0, 12)), '... nb transitions =', r.tl.length, 'atteint à', r.at);
    await shot(env, 'S2-cloud-vide');
    const dl = async (ch: string) => (await ipcCalls(env, ch)).length;
    // stabilité du bouton Réessayer : on marque le nœud DOM et on le surveille 6 s
    const btn = env.window.getByRole('button', { name: /Réessayer la connexion/ });
    const present0 = await btn.count();
    await env.window.evaluate(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => /Réessayer la connexion/.test(x.textContent || '')); if (b) (b as any).__qaTag = 'T'; });
    let lost = 0, bannerChanges = 0, lastB: string | null | undefined;
    for (let i = 0; i < 40; i++) {
      const ok = await env.window.evaluate(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => /Réessayer la connexion/.test(x.textContent || '')); return !!b && (b as any).__qaTag === 'T'; }).catch(() => false);
      if (!ok) lost++;
      const bt = await banner(env); if (lastB !== undefined && bt !== lastB) bannerChanges++; lastB = bt;
      await sleep(150);
    }
    const remain = Math.max(0, 90000 - (Date.now() - tS));
    await sleep(remain);
    const p90 = await dl('sync:forcePing'), g90 = await dl('sync:forceGlobal'), c90 = await dl('app:checkFirstLaunch');
    log('MESURE S2 à ~90 s : forcePing', p90, 'forceGlobal', g90, 'checkFirstLaunch', c90, '(attendu ~1 / ~1 / ~43-45)');
    log('Réessayer présent=', present0, 'perdu/remplacé sur 40 échantillons =', lost, 'changements de bandeau =', bannerChanges);
    const msgs = r.tl.map((p) => p.text);
    check('S2 message "Aucun compte agent récupéré" atteint vers 60 s', r.done && r.at >= 50000 && r.at <= 75000, 'at=' + r.at);
    check('S2 bouton Réessayer présent et stable (même nœud DOM, 6 s)', present0 === 1 && lost === 0 && bannerChanges === 0, `present=${present0} lost=${lost} bannerChanges=${bannerChanges}`);
    check('S2 compteurs forcePing<=2, forceGlobal<=2 sur 90 s', p90 <= 2 && g90 <= 2, `${p90}/${g90}`);
    check('S2 checkFirstLaunch ~43-45 sur 90 s (tolérance 35-55)', c90 >= 35 && c90 <= 55, 'cfl=' + c90);
    check('S2 pas d échec "Impossible de contacter le cloud"', !msgs.some((m) => m && /Impossible de contacter le cloud/.test(m)), J(msgs.slice(0, 6)));
    check('S2 jamais "Hors-ligne" alors que le réseau est en ligne', !msgs.some((m) => m && /Hors-ligne/.test(m)), J(msgs.slice(0, 6)));
    // S5 : 3 clics rapides sur Réessayer -> un seul run actif
    const bp = await dl('sync:forcePing'), bg = await dl('sync:forceGlobal');
    const tClick = Date.now();
    for (let i = 0; i < 3; i++) { await btn.click({ timeout: 3000 }).catch((e: any) => log('clic', i, 'échec', String(e).slice(0, 80))); await sleep(150); }
    await sleep(3000);
    const dp = (await dl('sync:forcePing')) - bp, dg = (await dl('sync:forceGlobal')) - bg;
    log('MESURE S5 après 3 clics rapides : forcePing +', dp, 'forceGlobal +', dg, '; bandeau', J(await banner(env)));
    await shot(env, 'S5-apres-3-clics');
    check('S5 3 clics rapides => un seul run (forcePing<=1, forceGlobal<=1)', dp <= 1 && dg <= 1, `+${dp}/+${dg}`);
    const bp2 = await dl('sync:forcePing');
    await sleep(8000);
    check('S5/S2 pas de boucle après relance (forcePing +<=1 en 8 s)', (await dl('sync:forcePing')) - bp2 <= 1, '+' + ((await dl('sync:forcePing')) - bp2));
    // attendre la fin du run relancé (60 s) pour décrire l'état final
    const rEnd = await sample(env, tClick, (p) => !!p.text && /Aucun compte agent récupéré/.test(p.text), 75000, 500);
    log('état après relance : atteint=', rEnd.done, 'à', rEnd.at, 'timeline', J(rEnd.tl.slice(0, 5)));
    // limite connue : compte ajouté après l'échec
    await cIns('OP', {});
    const r2 = await sample(env, Date.now(), (p) => p.form, 20000, 500);
    log('S2b (compte ajouté au cloud après échec) : formulaire sans action =', r2.done);
    const pc = await dl('sync:forcePing');
    if (!r2.done) {
      await btn.click({ timeout: 3000 }).catch(() => undefined);
      const r3 = await sample(env, Date.now(), (p) => p.form, 45000, 500);
      log('S2c après clic Réessayer : formulaire =', r3.done, 'forcePing +', (await dl('sync:forcePing')) - pc, 'forceGlobal total', await dl('sync:forceGlobal'), 'users locaux=', (await sqlRead(env, 'SELECT COUNT(*) c FROM t_users'))[0].c);
    }
    log('main.log Preload =', J(appLog(env).split(String.fromCharCode(10)).filter((l) => /Preload:|runSyncInitiale/i.test(l)).slice(-6).map((l) => l.slice(0, 200))));
    await closeApp(env);
  });

  test('S3 vrai hors-ligne : bandeau Hors-ligne, pas de formulaire, reprise automatique au retour en ligne', async () => {
    await cloudDeleteZZ();
    await cIns('OP', {});
    const env = await freshEnv(true);
    await launch(env, { offlineFromStart: true });
    const tS = Date.now();
    const r = await sample(env, tS, () => false, 45000);
    log('TIMELINE S3 (hors-ligne) =', J(r.tl));
    await shot(env, 'S3-hors-ligne');
    const lastText = r.tl[r.tl.length - 1]?.text || null;
    log('état final hors-ligne : banner', J(lastText), 'form', await hasForm(env), 'nav.onLine', await navOnLine(env));
    check('S3 hors-ligne : bandeau "Hors-ligne" affiché', !!lastText && /Hors-ligne/.test(lastText), J(r.tl.map((p) => p.text)));
    check('S3 hors-ligne : pas de formulaire', !(await hasForm(env)));
    check('S3 hors-ligne : fenêtre réactive (pas de crash)', (await env.window.evaluate(() => document.readyState).catch(() => null)) === 'complete');
    check('S3 hors-ligne : aucun compte rapatrié', (await sqlRead(env, 'SELECT COUNT(*) c FROM t_users'))[0].c === 0);
    const pingBefore = (await ipcCalls(env, 'sync:forcePing')).length;
    const globalBefore = (await ipcCalls(env, 'sync:forceGlobal')).length;
    const tBack = Date.now();
    await offlineOff(env);
    log('RETOUR EN LIGNE (émulation levée) à t=0');
    const r2 = await sample(env, tBack, (p) => p.form, 240000, 500);
    log('TIMELINE S3b (retour en ligne) =', J(r2.tl));
    await shot(env, 'S3-retour-en-ligne');
    const pingAfter = (await ipcCalls(env, 'sync:forcePing')).length - pingBefore;
    const globalAfter = (await ipcCalls(env, 'sync:forceGlobal')).length - globalBefore;
    log('MESURE S3 retour en ligne : forcePing +', pingAfter, 'forceGlobal +', globalAfter, '; appels forcePing (ms depuis retour)', J((await ipcCalls(env, 'sync:forcePing')).map((x) => x - tBack)));
    const offPing = (await ipcCalls(env, 'sync:forcePing'));
    const gaps = offPing.slice(1).map((x, i) => x - offPing[i]);
    log('écarts entre forcePing consécutifs (ms) =', J(gaps));
    check('S3 pas de rafale : forcePing total <= 6, écarts >= 9 s', offPing.length <= 6 && gaps.every((g) => g >= 9000), `n=${offPing.length} gaps=${J(gaps)}`);
    check('S3 retour en ligne : le formulaire apparaît sans action (reprise automatique)', r2.done, `délai ${(r2.at / 1000).toFixed(1)} s`);
    check('S3 reprise : pas de doublon de configuration (forceGlobal <= 2)', globalAfter <= 2, `forcePing+${pingAfter} forceGlobal+${globalAfter}`);
    const nPoll = await rateOver(env, 'app:checkFirstLaunch', 6000);
    check('S3 plus aucun sondage actif une fois configuré', nPoll === 0, 'n=' + nPoll);
    await closeApp(env);
  });

  test('S4 poste déjà configuré : formulaire direct, sans bandeau, connexion/reconnexion hors-ligne', async () => {
    const env = await freshEnv(false);
    expect((await sqlRead(env, 'SELECT COUNT(*) c FROM t_users'))[0].c).toBeGreaterThan(0);
    const mark = consoleLogs.length;
    await launch(env, { disableSync: true });
    const r = await sample(env, Date.now(), (p) => p.form, 60000);
    log('TIMELINE S4 =', J(r.tl));
    await shot(env, 'S4-poste-configure');
    check('S4 formulaire direct', r.done);
    check('S4 aucun bandeau de configuration/hors-ligne', r.tl.every((p) => p.text === null), J(r.tl.map((p) => p.text)));
    await sleep(3000);
    check('S4 aucun sondage checkFirstLaunch répété (<= 2 appels)', (await ipcCalls(env, 'app:checkFirstLaunch')).length <= 2, J((await ipcCalls(env, 'app:checkFirstLaunch')).length));
    const l1 = await loginUi(env, 'E2E_ADMINISTRATEUR_SITE', PWD, false);
    check('S4 connexion OK', l1.ok === true, J(l1));
    await sleep(1500);
    const q = async () => [(await ipcCalls(env, 'app:checkFirstLaunch')).length, (await ipcCalls(env, 'sync:forcePing')).length, (await ipcCalls(env, 'sync:forceGlobal')).length];
    const q0 = await q(); await sleep(8000); const q1 = await q();
    log('MESURE S4 après login : cfl/forcePing/forceGlobal avant/après 8 s =', J(q0), J(q1));
    check('S4 aucun appel IPC de configuration après login (8 s)', J(q0) === J(q1), J([q0, q1]));
    await logoutUi(env);
    await offlineOn(env);
    await sleep(2000);
    log('hors-ligne actif ; nav.onLine =', await navOnLine(env));
    const l2 = await loginUi(env, 'E2E_ADMINISTRATEUR_SITE', PWD, false);
    check('S4 reconnexion hors-ligne OK', l2.ok === true, J(l2));
    await logoutUi(env);
    await offlineOff(env);
    const errs = consoleLogs.slice(mark).filter((c) => c.type === 'error');
    log('erreurs console S4 =', J(errs.map((c) => c.text.slice(0, 200))));
    check('S4 aucune erreur console renderer ni pageerror', errs.length === 0 && pageErrors.length === 0, J({ errs: errs.map((c) => c.text.slice(0, 120)), pageErrors }));
    await closeApp(env);
  });

  test('ZZ bilan', async () => {
    const bad = results.filter((r) => !r.ok);
    expect(bad.map((b) => b.name)).toEqual([]);
  });
});
