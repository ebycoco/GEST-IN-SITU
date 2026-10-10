/**
 * e2e/specs/_agent13_presence_close_mock.e2e.spec.ts
 *
 * QA terrain agent-13 — lot L2 (commit 45060df) : déconnexion écrite à la fermeture,
 * battement au retour réseau, logout sur déconnexion forcée.
 *
 * ISOLATION : le projet Supabase dev (zddibqgutigwxjwbojmn) n'existe plus (DNS ENOTFOUND). On
 * construit donc un build `--mode e2e` dont VITE_SUPABASE_URL (via .env.e2e.local, gitignoré)
 * pointe vers un FAUX serveur PostgREST local (127.0.0.1:54399) lancé par ce spec. Aucun
 * paquet ne sort vers un Supabase réel ; GitHub (auto-updater) est bloqué par --host-rules.
 */
import { test, expect } from '@playwright/test';
import { _electron as electron } from '@playwright/test';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import http from 'http';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { runSeedInElectronNode } from '../fixtures/seed-runner';
import { teardownSeededApp, type E2EEnvironment } from '../fixtures/electron-app';
import { getTestUser } from '../fixtures/test-users';

const execFileAsync = promisify(execFile);
const ROOT = resolve(__dirname, '../..');
const ENTRY = join(ROOT, 'dist-e2e-cloud', 'main', 'index.js');
const PORT = 54399;
const SHOT_DIR = join(ROOT, 'test-results', 'agent13-screenshots');

interface Req { t: number; method: string; path: string; body: any }

class MockSupabase {
  server: http.Server | null = null;
  sockets = new Set<any>();
  reqs: Req[] = [];
  presence = new Map<string, any>();
  patchDelayMs = 0;
  cloudUserDisabled = false;
  async start() {
    this.server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => this.handle(req, res, Buffer.concat(chunks).toString('utf8')));
    });
    this.server.on('connection', (s) => { this.sockets.add(s); s.on('close', () => this.sockets.delete(s)); });
    await new Promise<void>((r) => this.server!.listen(PORT, '127.0.0.1', () => r()));
  }
  async stop() {
    if (!this.server) return;
    for (const s of this.sockets) s.destroy();
    await new Promise<void>((r) => this.server!.close(() => r()));
    this.server = null;
  }
  handle(req: http.IncomingMessage, res: http.ServerResponse, raw: string) {
    const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);
    let body: any = null;
    try { body = raw ? JSON.parse(raw) : null; } catch { body = raw; }
    this.reqs.push({ t: Date.now(), method: req.method || '', path: url.pathname + url.search, body });
    const table = url.pathname.replace('/rest/v1/', '').replace('/rest/v1', '');
    const json = (code: number, data: any, extra: Record<string, string> = {}) => {
      res.writeHead(code, { 'content-type': 'application/json', 'content-range': '*/0', ...extra });
      res.end(data === undefined ? '' : JSON.stringify(data));
    };
    if (table === '') return json(200, {});
    if (table === 't_user_presence') {
      if (req.method === 'POST') {
        const arr = Array.isArray(body) ? body : [body];
        for (const r of arr) this.presence.set(r.user_sync_id, { ...(this.presence.get(r.user_sync_id) || {}), ...r });
        res.writeHead(201); return res.end();
      }
      if (req.method === 'PATCH') {
        const m = /user_sync_id=eq\.([^&]+)/.exec(url.search);
        const id = m ? decodeURIComponent(m[1]) : '';
        const doIt = () => {
          if (this.presence.has(id)) this.presence.set(id, { ...this.presence.get(id), ...body });
          try { res.writeHead(204); res.end(); } catch { /* socket aborted */ }
        };
        if (this.patchDelayMs > 0) setTimeout(doIt, this.patchDelayMs); else doIt();
        return;
      }
      if (req.method === 'GET') return json(200, [...this.presence.values()]);
    }
    if (table === 't_users' && req.method === 'GET' && /login=eq\./.test(url.search)) {
      const login = decodeURIComponent(/login=eq\.([^&]+)/.exec(url.search)![1]);
      return json(200, [{ login, statut_actif: this.cloudUserDisabled ? 0 : 1 }]);
    }
    if (table === 't_sites' && req.method === 'GET') return json(200, [{ id: 1, nom: 'Site E2E Test', code: 'E2E', is_active: 1, max_centres: 4, created_at: new Date().toISOString(), sync_id: 'mock-site', expiry_date: null, is_permanent: true }]);
    if (req.method === 'GET') return json(200, []);
    res.writeHead(req.method === 'POST' ? 201 : 204); res.end();
  }
  presReqs(method?: string) { return this.reqs.filter((r) => r.path.includes('t_user_presence') && (!method || r.method === method)); }
}

const mock = new MockSupabase();
const NL = String.fromCharCode(10);

async function launch(): Promise<E2EEnvironment> {
  const userDataDir = mkdtempSync(join(tmpdir(), 'gest-in-situ-e2e-'));
  const seed = await runSeedInElectronNode(userDataDir);
  const baseEnv = { ...(process.env as Record<string, string>) };
  delete baseEnv.GEST_IN_SITU_E2E_DISABLE_SYNC;
  const app = await electron.launch({
    args: [ENTRY, `--user-data-dir=${userDataDir}`, '--host-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1'],
    env: baseEnv
  });
  const deadline = Date.now() + 90000;
  let window: any = null;
  while (Date.now() < deadline && !window) {
    window = app.windows().find((w) => !w.isClosed() && !w.url().includes('splash.html')) || null;
    if (!window) await new Promise((r) => setTimeout(r, 500));
  }
  if (!window) throw new Error('no window');
  await window.waitForLoadState('domcontentloaded');
  return { app, window, userDataDir, seed };
}

async function loginAs(env: E2EEnvironment, key: 'operateurVerification' | 'administrateurSite' | 'superAdmin', url: RegExp) {
  const u = getTestUser(key);
  await env.window.waitForURL(/#\/login/, { timeout: 30000 });
  await env.window.getByTestId('login-input').fill(u.login);
  await env.window.getByTestId('password-input').fill(u.password);
  await env.window.getByTestId('login-submit').click();
  await env.window.waitForURL(url, { timeout: 30000 });
}

async function waitState(env: E2EEnvironment, want: string, timeoutMs: number): Promise<string | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const s = await env.window.evaluate(async () => { try { return (await (window as any).api.sync.getStatus()).state; } catch { return null; } });
    if (s === want) return s;
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

async function closeWindowAndMeasure(env: E2EEnvironment, times = 1, gapMs = 0) {
  const proc = env.app.process();
  const t0 = Date.now();
  const exited = new Promise<number>((r) => proc.once('exit', () => r(Date.now() - t0)));
  for (let i = 0; i < times; i++) {
    env.app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && x.isVisible());
      w?.close();
    }).catch(() => undefined);
    if (gapMs) await new Promise((r) => setTimeout(r, gapMs));
  }
  const dur = await Promise.race([exited, new Promise<number>((r) => setTimeout(() => r(-1), 20000))]);
  return { t0, dur };
}

async function zombies(userDataDir: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('powershell', ['-NoProfile', '-Command',
      `Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | Where-Object { $_.CommandLine -like '*${userDataDir.replace(/\\/g, '\\\\').split('\\').pop()}*' } | Select-Object -ExpandProperty ProcessId`]);
    return stdout.trim() || 'aucun';
  } catch (e: any) { return 'err ' + e.message; }
}

async function stopEnv(env: E2EEnvironment, failed: boolean) {
  await teardownSeededApp(env, failed);
}

test.describe('QA terrain L2 — fermeture / retour réseau / déconnexion forcée (faux Supabase local)', () => {
  test.setTimeout(240000);
  let failed = false;
  test.beforeAll(async () => { await mock.start(); });
  test.afterAll(async () => { await mock.stop(); });
  test.afterEach(async ({}, ti) => { if (ti.status !== ti.expectedStatus) failed = true; });

  test('B1. fermeture réseau ONLINE, UPDATE rapide : last_logout_at écrit, délai court, pas de zombie', async () => {
    mock.reqs = []; mock.presence.clear(); mock.patchDelayMs = 0;
    const env = await launch();
    try {
      expect(await waitState(env, 'ONLINE', 60000)).toBe('ONLINE');
      await loginAs(env, 'operateurVerification', /#\/agent-verification/);
      await env.window.waitForTimeout(3000);
      const syncId = (await env.window.evaluate(() => 1), env.seed ? undefined : undefined);
      const posts = mock.presReqs('POST');
      console.log('[B1] login upsert reçus=' + posts.length + ' body=' + JSON.stringify(posts[0]?.body));
      expect(posts.length).toBeGreaterThan(0);
      const id = posts[0].body.user_sync_id;
      const before = mock.presence.get(id);
      console.log('[B1] avant fermeture last_logout_at=' + before?.last_logout_at);
      mock.reqs = [];
      const { t0, dur } = await closeWindowAndMeasure(env);
      const patches = mock.presReqs('PATCH');
      console.log(`[B1] fermeture -> exit en ${dur} ms ; PATCH reçus=${patches.length} (+${patches[0] ? patches[0].t - t0 : 'n/a'} ms) body=${JSON.stringify(patches[0]?.body)}`);
      console.log('[B1] ligne mock après =' + JSON.stringify(mock.presence.get(id)));
      console.log('[B1] processus electron résiduels (userData)=' + await zombies(env.userDataDir));
      expect(patches.length).toBe(1);
      expect(mock.presence.get(id).last_logout_at).toBeTruthy();
    } finally { await stopEnv(env, failed); }
  });

  test('B2. fermeture avec serveur lent (UPDATE 10 s) : fermeture bornée ~1,5 s, + double clic', async () => {
    mock.reqs = []; mock.presence.clear(); mock.patchDelayMs = 10000;
    const env = await launch();
    try {
      expect(await waitState(env, 'ONLINE', 60000)).toBe('ONLINE');
      await loginAs(env, 'operateurVerification', /#\/agent-verification/);
      await env.window.waitForTimeout(3000);
      mock.reqs = [];
      const { t0, dur } = await closeWindowAndMeasure(env, 3, 150);
      const patches = mock.presReqs('PATCH');
      console.log(`[B2] triple close (150 ms d'écart) -> exit en ${dur} ms ; PATCH émis=${patches.length}`);
      console.log('[B2] processus electron résiduels=' + await zombies(env.userDataDir));
    } finally { mock.patchDelayMs = 0; await stopEnv(env, failed); }
  });

  test('B2b. fermeture serveur lent, UN SEUL clic', async () => {
    mock.reqs = []; mock.presence.clear(); mock.patchDelayMs = 10000;
    const env = await launch();
    try {
      expect(await waitState(env, 'ONLINE', 60000)).toBe('ONLINE');
      await loginAs(env, 'operateurVerification', /#\/agent-verification/);
      await env.window.waitForTimeout(3000);
      mock.reqs = [];
      const { dur } = await closeWindowAndMeasure(env, 1);
      console.log(`[B2b] clic unique -> exit en ${dur} ms ; PATCH émis=${mock.presReqs('PATCH').length}`);
    } finally { mock.patchDelayMs = 0; await stopEnv(env, failed); }
  });

  test('B3. fermeture sans réseau (serveur injoignable) : immédiate, pas d\'attente', async () => {
    await mock.stop();
    mock.reqs = []; mock.presence.clear();
    const env = await launch();
    try {
      await loginAs(env, 'operateurVerification', /#\/agent-verification/);
      await env.window.waitForTimeout(2000);
      const st = await env.window.evaluate(async () => (await (window as any).api.sync.getStatus()).state);
      console.log('[B3] état réseau avant fermeture=' + st);
      const { dur } = await closeWindowAndMeasure(env);
      console.log(`[B3] fermeture -> exit en ${dur} ms ; reqs mock=${mock.reqs.length}`);
      console.log('[B3] processus electron résiduels=' + await zombies(env.userDataDir));
      expect(dur).toBeLessThan(1500);
    } finally { await stopEnv(env, failed); await mock.start(); }
  });

  test('B4. fermeture après déconnexion volontaire : aucune attente, aucun UPDATE de fermeture', async () => {
    mock.reqs = []; mock.presence.clear(); mock.patchDelayMs = 10000;
    const env = await launch();
    try {
      expect(await waitState(env, 'ONLINE', 60000)).toBe('ONLINE');
      await loginAs(env, 'operateurVerification', /#\/agent-verification/);
      await env.window.waitForTimeout(2000);
      await env.window.getByRole('button', { name: 'Déconnexion' }).click();
      await env.window.waitForURL(/#\/login/, { timeout: 15000 });
      await env.window.waitForTimeout(500);
      const patchesAfterLogout = mock.presReqs('PATCH').length;
      console.log('[B4] PATCH logout volontaire émis=' + patchesAfterLogout + ' (renderer auth:logout)');
      mock.reqs = [];
      const { dur } = await closeWindowAndMeasure(env);
      console.log(`[B4] fermeture après logout -> exit en ${dur} ms ; PATCH à la fermeture=${mock.presReqs('PATCH').length}`);
      expect(dur).toBeLessThan(2000);
      expect(mock.presReqs('PATCH').length).toBe(0);
    } finally { mock.patchDelayMs = 0; await stopEnv(env, failed); }
  });

  test('B5. SUPER ADMIN connecté (rôle hors PRESENCE_ROLES) : fermeture', async () => {
    mock.reqs = []; mock.presence.clear(); mock.patchDelayMs = 10000;
    const env = await launch();
    try {
      expect(await waitState(env, 'ONLINE', 60000)).toBe('ONLINE');
      await loginAs(env, 'superAdmin', /#\/dashboard/);
      await env.window.waitForTimeout(2000);
      mock.reqs = [];
      const { dur } = await closeWindowAndMeasure(env);
      console.log(`[B5] SUPER ADMIN fermeture -> exit en ${dur} ms ; POST=${mock.presReqs('POST').length} PATCH=${mock.presReqs('PATCH').length}`);
    } finally { mock.patchDelayMs = 0; await stopEnv(env, failed); }
  });

  test('C. retour réseau OFFLINE->ONLINE pendant session : battement rapide (sans attendre 2 min)', async () => {
    await mock.stop();
    mock.reqs = []; mock.presence.clear();
    const env = await launch();
    try {
      await loginAs(env, 'operateurVerification', /#\/agent-verification/);
      await env.window.waitForTimeout(1500);
      const st0 = await env.window.evaluate(async () => (await (window as any).api.sync.getStatus()).state);
      console.log('[C] état avant retour=' + st0 + ' ; upserts présence reçus=' + mock.presReqs('POST').length);
      await mock.start();
      const t0 = Date.now();
      // Retour réseau « naturel » par ping (30 s) OU retryConnection : on utilise la sonde native.
      await env.window.evaluate(() => (window as any).api.sync.retryConnection());
      let got: Req | null = null;
      while (Date.now() - t0 < 60000 && !got) {
        got = mock.presReqs('POST')[0] || null;
        if (!got) await new Promise((r) => setTimeout(r, 250));
      }
      const st1 = await env.window.evaluate(async () => (await (window as any).api.sync.getStatus()).state);
      console.log(`[C] état après=${st1} ; premier upsert présence après ${got ? got.t - t0 : 'JAMAIS(60s)'} ms ; body=${JSON.stringify(got?.body)}`);
      expect(got).not.toBeNull();
      // Throttle : aucune rafale
      await new Promise((r) => setTimeout(r, 4000));
      console.log('[C] upserts totaux 4 s après=' + mock.presReqs('POST').length);
    } finally { await stopEnv(env, failed); }
  });

  test('D. déconnexion forcée (compte désactivé côté cloud) : un seul logout, pas de second du renderer', async () => {
    mock.reqs = []; mock.presence.clear(); mock.patchDelayMs = 0; mock.cloudUserDisabled = false;
    const env = await launch();
    try {
      expect(await waitState(env, 'ONLINE', 60000)).toBe('ONLINE');
      await loginAs(env, 'operateurVerification', /#\/agent-verification/);
      await env.window.waitForTimeout(2500);
      console.log('[D] upserts login=' + mock.presReqs('POST').length);
      mock.reqs = [];
      mock.cloudUserDisabled = true;
      await env.window.waitForURL(/#\/login/, { timeout: 60000 }).catch(() => undefined);
      await env.window.waitForTimeout(3000);
      const url = env.window.url();
      const patches = mock.presReqs('PATCH');
      console.log('[D] reqs mock après désactivation=' + JSON.stringify(mock.reqs.map((r) => r.method + ' ' + r.path.slice(0, 90))));
      try {
        const { readFileSync, readdirSync } = await import('fs');
        const logDir = join(env.userDataDir, 'logs');
        const lf = readdirSync(logDir).map((f) => readFileSync(join(logDir, f), 'utf8')).join(NL);
        console.log('[D] LOG: ' + lf.split(NL).filter((l) => /UserSync|syncCurrentUser|Presence|session|Session/.test(l)).slice(-25).join(NL));
      } catch (e: any) { console.log('[D] log illisible ' + e.message); }
      console.log(`[D] URL finale=${url} ; PATCH logout reçus=${patches.length} ; ${JSON.stringify(patches.map((p) => p.t - mock.reqs[0]?.t))}`);
      await env.window.screenshot({ path: join(SHOT_DIR, 'agent13-L2-D-forced-logout.png') });
      expect(patches.length).toBe(1);
    } finally { mock.cloudUserDisabled = false; await stopEnv(env, failed); }
  });

  test('E. (simulé) mise à jour prête : fermeture avec délai 1,5 s puis triggerUpdateInstall', async () => {
    mock.reqs = []; mock.presence.clear(); mock.patchDelayMs = 0;
    const env = await launch();
    try {
      expect(await waitState(env, 'ONLINE', 60000)).toBe('ONLINE');
      await loginAs(env, 'operateurVerification', /#\/agent-verification/);
      await env.window.waitForTimeout(2500);
      const sim = await env.app.evaluate((_e, ROOTP) => {
        try {
          const req = (process as any).getBuiltinModule('module').createRequire(ROOTP + '/package.json');
          const { autoUpdater } = req('electron-updater');
          autoUpdater.emit('update-downloaded', { version: '99.0.0' });
          return 'emit ok';
        } catch (e: any) { return 'KO ' + e.message; }
      }, ROOT);
      console.log('[E] simulation update-downloaded : ' + sim);
      mock.reqs = [];
      const { dur } = await closeWindowAndMeasure(env);
      console.log(`[E] fermeture avec MAJ prête simulée -> exit en ${dur} ms (-1 = process toujours vivant à 20 s) ; PATCH=${mock.presReqs('PATCH').length}`);
      const { readdirSync, existsSync, readFileSync } = await import('fs');
      const marker = join(env.userDataDir, 'pending-update.json');
      console.log('[E] marqueur pending-update.json présent=' + existsSync(marker) + (existsSync(marker) ? ' ' + readFileSync(marker, 'utf8').replace(/\s+/g, ' ') : ''));
      void readdirSync;
    } finally { await stopEnv(env, failed); }
  });
});
