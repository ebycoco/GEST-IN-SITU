/**
 * e2e/specs/_agent13_presence_fkretry_cloud.cloud.e2e.spec.ts
 *
 * QA terrain agent-13 — correctif 7cbac7f (cache négatif FK 23503 de presence.service.ts) contre le
 * VRAI Postgres du projet DEV ajadkziqaskadlzboeqo. JAMAIS la production. Données E2E_/ZZTEST_ nettoyées.
 *
 * Scénario : un OPERATEUR_VERIFICATION se connecte AVANT que son compte existe dans t_users cloud
 * (FK user_sync_id violée au login) ; le compte est mirroré dans les 3 s (avant le 1er cycle UserSync
 * de +10 s qui désactiverait sinon le compte local) ; SANS redémarrer l'app, le battement de +2 min doit
 * créer la ligne. Puis le compte cloud est retiré après le cycle UserSync de +3 min pour provoquer un
 * 2e échec FK au tick de +4 min : le log FK ne doit PAS être répété (limite 1 / 10 min / clé).
 */
import { test, expect } from '@playwright/test';
import { join } from 'path';
import { readFileSync, readdirSync } from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { launchSeededApp, teardownSeededApp, type E2EEnvironment } from '../fixtures/electron-app';
import { getTestUser } from '../fixtures/test-users';
import { supabaseDev, ensureCloudSiteAndCentre, E2E_CLOUD_SUPABASE_URL } from '../fixtures/supabase-dev-client';

const execFileAsync = promisify(execFile);

test.describe.serial('QA terrain — Présence : retentative après FK user_sync_id (vrai Postgres dev)', () => {
  test.setTimeout(600_000);
  let A: E2EEnvironment;
  let failed = false;
  let opSyncId = '';

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
      console.log(`[FKR][CLEANUP] résiduel users=${left[0].count} presence=${left[1].count} centres=${left[2].count} sites=${left[3].count}`);
    } catch (e) { console.error('[FKR][CLEANUP] échec', e); }
    if (A) { try { await teardownSeededApp(A, failed); } catch { /* */ } }
  });

  async function dbQuery(sql: string): Promise<any[]> {
    const script = `
      const Database = require('better-sqlite3');
      const db = new Database(process.argv[1], { readonly: true, timeout: 15000 });
      try { process.stdout.write('__Q__:' + JSON.stringify(db.prepare(process.argv[2]).all())); } finally { db.close(); }`;
    const electronPath = require('electron') as unknown as string;
    const { stdout } = await execFileAsync(electronPath, ['-e', script, A.seed.dbPath, sql],
      { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf-8' });
    return JSON.parse(stdout.split(/\r?\n/).reverse().find((l) => l.startsWith('__Q__:'))!.slice(6));
  }
  function appLog(): string {
    const dir = join(A.userDataDir, 'logs');
    return readdirSync(dir).map((f) => readFileSync(join(dir, f), 'utf8')).join('\n');
  }
  const presenceRow = async () => (await supabaseDev.from('t_user_presence').select('*').eq('user_sync_id', opSyncId).maybeSingle()).data as any;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  test('FK-retry : connexion avant existence du compte cloud, puis compte mirroré -> ligne créée au tick suivant', async () => {
    expect(E2E_CLOUD_SUPABASE_URL).toContain('ajadkziqaskadlzboeqo');
    A = await launchSeededApp({ allowRealSync: true });
    for (let i = 0; i < 120; i++) {
      const s = await A.window.evaluate(async () => { try { return (await (window as any).api.sync.getStatus()).state; } catch { return null; } });
      if (s === 'ONLINE') break; await sleep(500);
    }
    await ensureCloudSiteAndCentre(A.seed.siteId, A.seed.centreId);
    const u = (await dbQuery(`SELECT sync_id, login, site_id, centre_id, role, nom_user, prenom_user, password_hash FROM t_users WHERE login='E2E_OPERATEUR_VERIFICATION'`))[0];
    opSyncId = u.sync_id;
    expect(await presenceRow()).toBeNull();
    const cloudUsers0 = await supabaseDev.from('t_users').select('sync_id').eq('sync_id', opSyncId);
    console.log(`[FKR] AVANT : t_users cloud pour ${opSyncId} = ${JSON.stringify(cloudUsers0.data)} ; t_user_presence = null`);

    const user = getTestUser('operateurVerification');
    await A.window.waitForURL(/#\/login/, { timeout: 30000 });
    await A.window.getByTestId('login-input').fill(user.login);
    await A.window.getByTestId('password-input').fill(user.password);
    const tLogin = Date.now();
    await A.window.getByTestId('login-submit').click();
    await A.window.waitForURL(/#\/agent-verification/, { timeout: 30000 });
    await sleep(1500);
    const failLog = appLog().split('\n').filter((l) => /PresenceService/.test(l));
    console.log(`[FKR] T0+${Date.now() - tLogin} ms : logs PresenceService après login (compte absent du cloud) =\n${failLog.join('\n')}`);
    console.log(`[FKR] ligne présence cloud juste après login = ${JSON.stringify(await presenceRow())}`);
    expect(await presenceRow()).toBeNull();
    expect(failLog.some((l) => /user_sync_id orphelin/.test(l) && /Non mis en cache/.test(l))).toBe(true);

    // Compte mirroré côté cloud (avant le 1er cycle UserSync de +10 s), SANS redémarrage.
    const { error } = await supabaseDev.from('t_users').insert({
      login: u.login, password_hash: u.password_hash, role: u.role, nom_user: u.nom_user,
      prenom_user: u.prenom_user, statut_actif: 1, site_id: u.site_id, centre_id: u.centre_id, sync_id: u.sync_id
    });
    expect(error, error?.message).toBeNull();
    const tMirror = Date.now();
    console.log(`[FKR] compte mirroré dans t_users cloud à T0+${tMirror - tLogin} ms ; app NON redémarrée`);

    // Attente du tick de +2 min
    let row: any = null; let tRow = 0;
    while (Date.now() - tLogin < 200000) {
      row = await presenceRow();
      if (row) { tRow = Date.now(); break; }
      await sleep(1000);
    }
    console.log(`[FKR] ligne apparue à T0+${tRow ? tRow - tLogin : 'JAMAIS'} ms = ${JSON.stringify(row)}`);
    expect(row, 'la ligne de présence n\'est jamais apparue pendant la session').not.toBeNull();
    expect(row.login).toBe(u.login);
    expect(row.role).toBe('OPERATEUR_VERIFICATION');
    expect(row.last_heartbeat_at).toBeTruthy();

    // 2e échec FK volontaire au tick +4 min : retire ligne+compte cloud APRES le cycle UserSync de +3 min.
    let seen = 0;
    while (Date.now() - tLogin < 240000) {
      seen = appLog().split('\n').filter((l) => /refreshSecureCurrentUser/.test(l)).length;
      if (seen >= 2) break;
      await sleep(1000);
    }
    console.log(`[FKR] cycles UserSync vus=${seen} à T0+${Date.now() - tLogin} ms`);
    expect(seen).toBeGreaterThanOrEqual(2);
    await supabaseDev.from('t_user_presence').delete().eq('user_sync_id', opSyncId);
    await supabaseDev.from('t_users').delete().eq('sync_id', opSyncId);
    const tDel = Date.now();
    console.log(`[FKR] ligne + compte cloud retirés à T0+${tDel - tLogin} ms (pour provoquer un 2e échec FK au tick +4 min)`);
    while (Date.now() - tLogin < 4 * 60000 + 25000) await sleep(2000);
    const after = await presenceRow();
    const log = appLog().split('\n').filter((l) => /PresenceService/.test(l));
    const fkWarns = log.filter((l) => /user_sync_id orphelin/.test(l));
    console.log(`[FKR] T0+${Date.now() - tLogin} ms : ligne cloud = ${JSON.stringify(after)} ; logs FK user_sync_id orphelin = ${fkWarns.length}\n${log.join('\n')}`);
    expect(after).toBeNull();            // le 2e tick a bien ECHOUE (compte retiré), donc pas de ligne recréée
    expect(fkWarns.length).toBe(1);      // et le log n'a PAS été répété (limite 10 min)
    await A.window.screenshot({ path: join(__dirname, '..', '..', 'test-results', 'agent13-screenshots', 'agent13-FKR-final.png') });
  });
});
