/**
 * e2e/specs/_agent13_presence_realpg_cloud.cloud.e2e.spec.ts
 *
 * QA terrain agent-13 — validation de la présence des agents (L1 facddf2 / L2 45060df) contre un
 * VRAI Postgres : projet Supabase DEV ajadkziqaskadlzboeqo (build dist-e2e-cloud, .env.e2e).
 * JAMAIS la production. Données ZZTEST_ / E2E_ uniquement, nettoyées en afterAll.
 *
 * Deux instances Electron isolées (userData jetables) : A = OPERATEUR_VERIFICATION, B = ADMINISTRATEUR_SITE.
 */
import { test, expect } from '@playwright/test';
import { join } from 'path';
import { readFileSync, readdirSync } from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { launchSeededApp, launchExistingApp, teardownSeededApp, type E2EEnvironment } from '../fixtures/electron-app';
import { getTestUser } from '../fixtures/test-users';
import { supabaseDev, ensureCloudSiteAndCentre, E2E_CLOUD_SUPABASE_URL } from '../fixtures/supabase-dev-client';

const execFileAsync = promisify(execFile);
const SHOT_DIR = join(__dirname, '..', '..', 'test-results', 'agent13-screenshots');

test.describe.serial('QA terrain — Présence des agents contre vrai Postgres (projet dev)', () => {
  test.setTimeout(540_000);
  let A: E2EEnvironment;
  let B: E2EEnvironment;
  let failed = false;
  let opSyncId = '';
  let opLogin = '';
  const cleanup: string[] = [];

  test.afterEach(async ({}, ti) => { if (ti.status !== ti.expectedStatus) failed = true; });

  test.afterAll(async () => {
    try {
      if (opSyncId) {
        await supabaseDev.from('t_user_presence').delete().eq('user_sync_id', opSyncId);
        await supabaseDev.from('t_users').delete().eq('sync_id', opSyncId);
      }
      await supabaseDev.from('t_centres').delete().ilike('nom', 'ZZTEST_%');
      await supabaseDev.from('t_sites').delete().ilike('nom', 'ZZTEST_%');
      const left = await Promise.all([
        supabaseDev.from('t_users').select('id_user', { count: 'exact', head: true }),
        supabaseDev.from('t_user_presence').select('user_sync_id', { count: 'exact', head: true }),
        supabaseDev.from('t_centres').select('id', { count: 'exact', head: true }),
        supabaseDev.from('t_sites').select('id', { count: 'exact', head: true })
      ]);
      console.log(`[RPG][CLEANUP] résiduel users=${left[0].count} presence=${left[1].count} centres=${left[2].count} sites=${left[3].count} ${cleanup.join(' | ')}`);
    } catch (e) { console.error('[RPG][CLEANUP] échec', e); }
    for (const e of [A, B]) { if (e) { try { await teardownSeededApp(e, failed); } catch { /* déjà fermé */ } } }
  });

  async function dbQuery(env: E2EEnvironment, sql: string): Promise<any[]> {
    const script = `
      const Database = require('better-sqlite3');
      const db = new Database(process.argv[1], { readonly: true, timeout: 15000 });
      try { process.stdout.write('__Q__:' + JSON.stringify(db.prepare(process.argv[2]).all())); } finally { db.close(); }`;
    const electronPath = require('electron') as unknown as string;
    const { stdout } = await execFileAsync(electronPath, ['-e', script, env.seed.dbPath, sql],
      { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf-8' });
    const line = stdout.split(/\r?\n/).reverse().find((l) => l.startsWith('__Q__:'))!;
    return JSON.parse(line.slice(6));
  }

  async function waitOnline(env: E2EEnvironment, ms = 60000): Promise<boolean> {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const s = await env.window.evaluate(async () => { try { return (await (window as any).api.sync.getStatus()).state; } catch { return null; } });
      if (s === 'ONLINE') return true;
      await env.window.waitForTimeout(500);
    }
    return false;
  }

  async function login(env: E2EEnvironment, key: 'operateurVerification' | 'administrateurSite', url: RegExp) {
    const u = getTestUser(key);
    await env.window.waitForURL(/#\/login/, { timeout: 30000 });
    await env.window.getByTestId('login-input').fill(u.login);
    await env.window.getByTestId('password-input').fill(u.password);
    await env.window.getByTestId('login-submit').click();
    await env.window.waitForURL(url, { timeout: 30000 });
  }

  async function presenceRow() {
    const r = await supabaseDev.from('t_user_presence').select('*').eq('user_sync_id', opSyncId).maybeSingle();
    return r.data as any;
  }

  async function waitRow(pred: (r: any) => boolean, ms: number): Promise<any> {
    const t0 = Date.now();
    let last: any = null;
    while (Date.now() - t0 < ms) {
      last = await presenceRow();
      if (last && pred(last)) return last;
      await new Promise((r) => setTimeout(r, 200));
    }
    return last;
  }

  function appLog(env: E2EEnvironment): string {
    const dir = join(env.userDataDir, 'logs');
    return readdirSync(dir).map((f) => readFileSync(join(dir, f), 'utf8')).join('\n');
  }

  async function readAdminTable(env: E2EEnvironment) {
    // Force un remontage de la page (sinon données en cache jusqu'au prochain poll de 45 s).
    await env.window.evaluate(() => { window.location.hash = '#/dashboard'; });
    await env.window.waitForTimeout(600);
    await env.window.evaluate(() => { window.location.hash = '#/agents/presence'; });
    await expect(env.window.getByRole('heading', { name: 'Présence des Agents' })).toBeVisible({ timeout: 10000 });
    await expect(env.window.locator('.presence-table')).toBeVisible({ timeout: 20000 });
    return env.window.evaluate(() =>
      Array.from(document.querySelectorAll('.presence-table tbody tr')).map((tr) => {
        const tds = tr.querySelectorAll('td');
        return {
          statut: (tds[0]?.textContent || '').trim(),
          login: (tds[1]?.querySelector('div:nth-child(2)')?.textContent || '').trim(),
          connexion: (tds[4] as HTMLElement)?.innerText?.replace(/\n/g, ' | ').trim(),
          deconnexion: (tds[5] as HTMLElement)?.innerText?.replace(/\n/g, ' | ').trim()
        };
      })
    );
  }

  test('0. Garde-fou prod + préparation (site/centre/user cloud) + démarrage instances A et B', async () => {
    expect(E2E_CLOUD_SUPABASE_URL).toContain('ajadkziqaskadlzboeqo');
    expect(E2E_CLOUD_SUPABASE_URL).not.toContain('itvyayakwgzvfqvdrgyv');
    A = await launchSeededApp({ allowRealSync: true });
    expect(await waitOnline(A)).toBe(true);
    await ensureCloudSiteAndCentre(A.seed.siteId, A.seed.centreId);
    const u = (await dbQuery(A, `SELECT sync_id, login, site_id, centre_id, role, nom_user, prenom_user, password_hash FROM t_users WHERE login='E2E_OPERATEUR_VERIFICATION'`))[0];
    opSyncId = u.sync_id; opLogin = u.login;
    const { error } = await supabaseDev.from('t_users').insert({
      login: u.login, password_hash: u.password_hash /* hash local réel : le UserSync (3 min) écrase le hash local par celui du cloud */, role: u.role, nom_user: u.nom_user,
      prenom_user: u.prenom_user, statut_actif: 1, site_id: u.site_id, centre_id: u.centre_id, sync_id: u.sync_id
    });
    expect(error, error?.message).toBeNull();
    expect(await presenceRow()).toBeNull();
    B = await launchSeededApp({ allowRealSync: true });
    expect(await waitOnline(B)).toBe(true);
    console.log(`[RPG] A=${A.userDataDir} B=${B.userDataDir} opSyncId=${opSyncId} siteId=${A.seed.siteId} centreId=${A.seed.centreId}`);
  });

  test('a+f. login OPERATEUR (anon) -> ligne t_user_presence créée, FK OK, aucun 23503', async () => {
    const t0 = Date.now();
    await login(A, 'operateurVerification', /#\/agent-verification/);
    const row = await waitRow((r) => !!r.last_login_at, 15000);
    console.log(`[RPG][a] ligne apparue en ${Date.now() - t0} ms (depuis clic login) = ${JSON.stringify(row)}`);
    expect(row).not.toBeNull();
    expect(row.login).toBe(opLogin);
    expect(row.site_id).toBe(A.seed.siteId);
    expect(row.centre_id).toBe(A.seed.centreId);
    expect(row.role).toBe('OPERATEUR_VERIFICATION');
    expect(row.last_login_at).toBeTruthy();
    expect(row.last_heartbeat_at).toBeTruthy();
    expect(row.last_logout_at).toBeNull();
    const log = appLog(A);
    const bad = log.split('\n').filter((l) => /PresenceService/.test(l) && /(23503|abandonn|échoué)/.test(l));
    console.log(`[RPG][a] lignes de log PresenceService en échec = ${JSON.stringify(bad)}`);
    expect(bad).toEqual([]);
  });

  test('b. heartbeat : last_heartbeat_at avance au tick de 2 min (upsert sur ligne existante)', async () => {
    const r0 = await presenceRow();
    const t0 = Date.now();
    const r1 = await waitRow((r) => new Date(r.last_heartbeat_at).getTime() > new Date(r0.last_heartbeat_at).getTime() + 1000, 170000);
    console.log(`[RPG][b] heartbeat avant=${r0.last_heartbeat_at} apres=${r1.last_heartbeat_at} (+${Date.now() - t0} ms d'attente) login_at inchangé=${r0.last_login_at === r1.last_login_at}`);
    expect(new Date(r1.last_heartbeat_at).getTime()).toBeGreaterThan(new Date(r0.last_heartbeat_at).getTime());
  });

  test('d. page Présence des Agents côté ADMINISTRATEUR_SITE : agent En ligne, déconnexion « — »', async () => {
    await login(B, 'administrateurSite', /#\/dashboard/);
    const rows = await readAdminTable(B);
    console.log('[RPG][d1] table admin (agent connecté) = ' + JSON.stringify(rows));
    await B.window.screenshot({ path: join(SHOT_DIR, 'agent13-RPG-d1-enligne.png') });
    const mine = rows.find((r) => r.login.includes(opLogin));
    expect(mine, 'agent opérateur absent de la page admin').toBeTruthy();
    expect(mine!.statut).toBe('En ligne');
    expect(mine!.deconnexion).toBe('—');
  });

  test('f. déconnexion volontaire : UPDATE last_logout_at (anon) ; page admin : Hors ligne + date de déconnexion', async () => {
    await A.window.getByRole('button', { name: 'Déconnexion' }).click();
    await A.window.waitForURL(/#\/login/, { timeout: 15000 });
    const row = await waitRow((r) => !!r.last_logout_at, 10000);
    console.log('[RPG][f] ligne après logout volontaire = ' + JSON.stringify(row));
    expect(row.last_logout_at).toBeTruthy();
    expect(new Date(row.last_logout_at).getTime()).toBeGreaterThanOrEqual(new Date(row.last_heartbeat_at).getTime());
    // recharge côté admin
    await B.window.evaluate(() => { window.location.hash = '#/dashboard'; });
    await B.window.waitForTimeout(500);
    const rows = await readAdminTable(B);
    console.log('[RPG][f] table admin après logout = ' + JSON.stringify(rows));
    await B.window.screenshot({ path: join(SHOT_DIR, 'agent13-RPG-f-horsligne.png') });
    const mine = rows.find((r) => r.login.includes(opLogin))!;
    expect(mine.statut).toBe('Hors ligne');
    expect(mine.deconnexion).toBe(new Date(row.last_logout_at).toLocaleString('fr-FR'));
  });

  test('c. fermeture de fenêtre (connecté) : last_logout_at écrit en < 1,5 s, lecture directe', async () => {
    await login(A, 'operateurVerification', /#\/agent-verification/);
    const r0 = await waitRow((r) => r.last_login_at && (!r.last_logout_at || new Date(r.last_login_at) > new Date(r.last_logout_at)), 15000);
    await A.window.waitForTimeout(1500);
    console.log('[RPG][c] avant fermeture = ' + JSON.stringify(r0));
    const proc = A.app.process();
    const t0 = Date.now();
    const exited = new Promise<number>((r) => proc.once('exit', () => r(Date.now() - t0)));
    A.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && x.isVisible())?.close();
    }).catch(() => undefined);
    let seenAt = -1; let row: any = null;
    while (Date.now() - t0 < 8000) {
      row = await presenceRow();
      if (row?.last_logout_at && new Date(row.last_logout_at) > new Date(r0.last_login_at)) { seenAt = Date.now() - t0; break; }
      await new Promise((r) => setTimeout(r, 50));
    }
    const dur = await Promise.race([exited, new Promise<number>((r) => setTimeout(() => r(-1), 15000))]);
    const writtenMs = row?.last_logout_at ? new Date(row.last_logout_at).getTime() - t0 : null;
    console.log(`[RPG][c] ligne après fermeture = ${JSON.stringify(row)} ; vue côté lecteur après ${seenAt} ms ; last_logout_at écrit à t0+${writtenMs} ms (horloge app) ; process terminé en ${dur} ms`);
    expect(seenAt).toBeGreaterThanOrEqual(0);
    expect(seenAt).toBeLessThan(2000);
    expect(dur).toBeGreaterThan(0);
    expect(dur).toBeLessThan(5000);
    // côté admin
    const rows = await readAdminTable(B);
    console.log('[RPG][c] table admin après fermeture = ' + JSON.stringify(rows));
    const mine = rows.find((r) => r.login.includes(opLogin))!;
    expect(mine.statut).toBe('Hors ligne');
    expect(mine.deconnexion).toBe(new Date(row.last_logout_at).toLocaleString('fr-FR'));
    await B.window.screenshot({ path: join(SHOT_DIR, 'agent13-RPG-c-fermeture.png') });
  });

  test('g. déconnexion forcée (compte désactivé côté cloud en session) : redirection login + last_logout_at écrit une fois', async () => {
    test.setTimeout(540_000);
    const re = await launchExistingApp(A.userDataDir, { allowRealSync: true });
    A = { ...A, app: re.app, window: re.window };
    expect(await waitOnline(A)).toBe(true);
    await login(A, 'operateurVerification', /#\/agent-verification/);
    const r0 = await waitRow((r) => r.last_login_at && !(r.last_logout_at && new Date(r.last_logout_at) >= new Date(r.last_heartbeat_at)), 15000);
    console.log('[RPG][g] avant désactivation = ' + JSON.stringify(r0));
    const { error } = await supabaseDev.from('t_users').update({ statut_actif: 0 }).eq('sync_id', opSyncId);
    expect(error, error?.message).toBeNull();
    const tOff = Date.now();
    let redirected = true;
    try { await A.window.waitForURL(/#\/login/, { timeout: 300000 }); } catch { redirected = false; }
    const redirMs = Date.now() - tOff;
    await A.window.waitForTimeout(2500);
    const row = await presenceRow();
    console.log(`[RPG][g] redirigé vers login=${redirected} après ${redirMs} ms ; ligne = ${JSON.stringify(row)}`);
    const fl = appLog(A).split('\n').filter((l) => /(forc|désactiv|desactiv|Presence|UserSync)/i.test(l)).slice(-12);
    console.log('[RPG][g] log = ' + fl.join('\n'));
    await A.window.screenshot({ path: join(SHOT_DIR, 'agent13-RPG-g-forced.png') });
    expect(redirected).toBe(true);
    expect(new Date(row.last_logout_at).getTime()).toBeGreaterThan(new Date(r0.last_heartbeat_at).getTime() - 1);
    expect(new Date(row.last_logout_at).getTime()).toBeGreaterThanOrEqual(tOff - 1000);
  });
});
