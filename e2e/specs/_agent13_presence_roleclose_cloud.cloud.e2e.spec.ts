/**
 * e2e/specs/_agent13_presence_roleclose_cloud.cloud.e2e.spec.ts
 *
 * QA terrain agent-13 — commit 5cc86c4 (A) : à la fermeture de la fenêtre, le flush de déconnexion
 * ne concerne que les rôles suivis. VRAI Postgres du projet DEV ajadkziqaskadlzboeqo uniquement.
 * Pour prouver l'ABSENCE de PATCH pour ADMINISTRATEUR_SITE / SUPER ADMIN, on pré-insère une ligne
 * t_user_presence sentinelle (last_logout_at NULL) pour leur sync_id : si l'app écrivait un logout, la
 * ligne serait modifiée. Tout est nettoyé en afterAll.
 */
import { test, expect } from '@playwright/test';
import { join } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { launchSeededApp, teardownSeededApp, type E2EEnvironment } from '../fixtures/electron-app';
import { getTestUser } from '../fixtures/test-users';
import { supabaseDev, ensureCloudSiteAndCentre, E2E_CLOUD_SUPABASE_URL } from '../fixtures/supabase-dev-client';

const execFileAsync = promisify(execFile);
type Key = 'operateurVerification' | 'administrateurSite' | 'superAdmin';
const CASES: { key: Key; url: RegExp; expectLogout: boolean }[] = [
  { key: 'operateurVerification', url: /#\/agent-verification/, expectLogout: true },
  { key: 'administrateurSite', url: /#\/dashboard/, expectLogout: false },
  { key: 'superAdmin', url: /#\/dashboard/, expectLogout: false }
];

test.describe.serial('QA terrain 5cc86c4-A — fermeture par rôle (vrai Postgres dev)', () => {
  test.setTimeout(240_000);
  const syncIds: string[] = [];
  let current: E2EEnvironment | null = null;
  let failed = false;
  test.afterEach(async ({}, ti) => { if (ti.status !== ti.expectedStatus) failed = true; });
  test.afterAll(async () => {
    try {
      if (syncIds.length) {
        await supabaseDev.from('t_user_presence').delete().in('user_sync_id', syncIds);
        await supabaseDev.from('t_users').delete().in('sync_id', syncIds);
      }
      await supabaseDev.from('t_centres').delete().ilike('nom', 'ZZTEST_%');
      await supabaseDev.from('t_sites').delete().ilike('nom', 'ZZTEST_%');
      const left = await Promise.all([
        supabaseDev.from('t_users').select('id_user', { count: 'exact', head: true }),
        supabaseDev.from('t_user_presence').select('user_sync_id', { count: 'exact', head: true }),
        supabaseDev.from('t_centres').select('id', { count: 'exact', head: true }),
        supabaseDev.from('t_sites').select('id', { count: 'exact', head: true })
      ]);
      console.log(`[ROLECLOSE][CLEANUP] résiduel users=${left[0].count} presence=${left[1].count} centres=${left[2].count} sites=${left[3].count}`);
    } catch (e) { console.error('[ROLECLOSE][CLEANUP] échec', e); }
    if (current) { try { await teardownSeededApp(current, failed); } catch { /* */ } }
  });

  async function dbQuery(env: E2EEnvironment, login: string): Promise<any> {
    const script = `
      const Database = require('better-sqlite3');
      const db = new Database(process.argv[1], { readonly: true, timeout: 15000 });
      try { process.stdout.write('__Q__:' + JSON.stringify(db.prepare('SELECT sync_id, login, site_id, centre_id, role, nom_user, prenom_user, password_hash FROM t_users WHERE login=?').all(process.argv[2]))); } finally { db.close(); }`;
    const electronPath = require('electron') as unknown as string;
    const { stdout } = await execFileAsync(electronPath, ['-e', script, env.seed.dbPath, login],
      { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf-8' });
    return JSON.parse(stdout.split(/\r?\n/).reverse().find((l) => l.startsWith('__Q__:'))!.slice(6))[0];
  }

  for (const c of CASES) {
    test(`fermeture connecté en tant que ${c.key} : ${c.expectLogout ? 'logout écrit < 1,5 s' : 'AUCUN PATCH logout, pas d\'attente'}`, async () => {
      expect(E2E_CLOUD_SUPABASE_URL).toContain('ajadkziqaskadlzboeqo');
      const env = await launchSeededApp({ allowRealSync: true });
      current = env;
      for (let i = 0; i < 120; i++) {
        const s = await env.window.evaluate(async () => { try { return (await (window as any).api.sync.getStatus()).state; } catch { return null; } });
        if (s === 'ONLINE') break; await new Promise((r) => setTimeout(r, 500));
      }
      await ensureCloudSiteAndCentre(env.seed.siteId, env.seed.centreId);
      const u = getTestUser(c.key);
      const loc = await dbQuery(env, u.login);
      syncIds.push(loc.sync_id);
      // Compte cloud (évite la désactivation par UserSync) + ligne de présence sentinelle pour les rôles non suivis.
      const ins = await supabaseDev.from('t_users').insert({
        login: loc.login, password_hash: loc.password_hash, role: loc.role, nom_user: loc.nom_user, prenom_user: loc.prenom_user,
        statut_actif: 1, site_id: loc.site_id, centre_id: loc.centre_id, sync_id: loc.sync_id
      });
      expect(ins.error, ins.error?.message).toBeNull();
      if (!c.expectLogout) {
        const sentinel = await supabaseDev.from('t_user_presence').upsert({
          user_sync_id: loc.sync_id, login: loc.login, site_id: loc.site_id, centre_id: loc.centre_id, role: loc.role,
          last_heartbeat_at: new Date().toISOString(), last_login_at: new Date().toISOString(), last_logout_at: null
        }, { onConflict: 'user_sync_id' });
        console.log(`[ROLECLOSE][${c.key}] sentinelle insérée error=${sentinel.error?.message ?? 'none'}`);
      }
      await env.window.waitForURL(/#\/login/, { timeout: 30000 });
      await env.window.getByTestId('login-input').fill(u.login);
      await env.window.getByTestId('password-input').fill(u.password);
      await env.window.getByTestId('login-submit').click();
      await env.window.waitForURL(c.url, { timeout: 30000 });
      await env.window.waitForTimeout(3000); // < 10 s : avant le 1er cycle UserSync
      const before = (await supabaseDev.from('t_user_presence').select('*').eq('user_sync_id', loc.sync_id).maybeSingle()).data as any;
      console.log(`[ROLECLOSE][${c.key}] role=${loc.role} avant fermeture : ligne = ${JSON.stringify(before)}`);

      const proc = env.app.process();
      const t0 = Date.now();
      const exited = new Promise<number>((r) => proc.once('exit', () => r(Date.now() - t0)));
      env.app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && x.isVisible())?.close();
      }).catch(() => undefined);
      const dur = await Promise.race([exited, new Promise<number>((r) => setTimeout(() => r(-1), 20000))]);
      await new Promise((r) => setTimeout(r, 1500));
      const after = (await supabaseDev.from('t_user_presence').select('*').eq('user_sync_id', loc.sync_id).maybeSingle()).data as any;
      console.log(`[ROLECLOSE][${c.key}] fermeture -> process terminé en ${dur} ms ; ligne après = ${JSON.stringify(after)}`);
      expect(dur).toBeGreaterThan(0);
      if (c.expectLogout) {
        expect(after?.last_logout_at).toBeTruthy();
        expect(dur).toBeLessThan(1500);
      } else {
        expect(after?.last_logout_at ?? null).toBeNull();
        expect(dur).toBeLessThan(1500);
      }
      void join;
    });
  }
});
