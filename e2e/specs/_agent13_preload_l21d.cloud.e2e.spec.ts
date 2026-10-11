/**
 * QA terrain agent-13 — validation VIVANTE de cdef097 (L2-1d) : preloadUsersFromCloud via upsertCloudUser.
 * Supabase DEV ajadkziqaskadlzboeqo UNIQUEMENT (build dist-e2e-cloud, --mode e2e). JAMAIS la production.
 * userData isolé (mkdtemp). Données cloud préfixées ZZTEST_PRE_, sites/centres/postes ids 9001.. ; nettoyage en afterAll.
 */
import { test, expect, _electron as electron } from '@playwright/test';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { teardownSeededApp, type E2EEnvironment } from '../fixtures/electron-app';
import { runSeedInElectronNode } from '../fixtures/seed-runner';
import { supabaseDev, E2E_CLOUD_SUPABASE_URL } from '../fixtures/supabase-dev-client';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { sleep, sqlRead, appLog, loginUi, logoutUi, dismissAlerts, PWD } from './_agent13_agents_helpers';

const execFileAsync = promisify(execFile);
const P = 'ZZTEST_PRE_';
const S1 = 9001, S2 = 9002, C1 = 9101, C1B = 9102, C2 = 9201, POSTE = 9301;
const log = (...a: any[]) => console.log('[PRE]', ...a);
const J = (x: any) => JSON.stringify(x);
const results: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail = '') => { results.push({ name, ok, detail }); log(ok ? 'PASS' : 'FAIL', name, detail); };
const sy = (t: string) => `zztest-pre-${t}-${Date.now()}`;
const ROOT = resolve(__dirname, '../..');
const ENTRY = join(ROOT, 'dist-e2e-cloud', 'main', 'index.js');
const OFFLINE_JS = process.env.QA_OFFLINE_JS || '';

async function sqlExec(env: E2EEnvironment, sqls: string[]) {
  const script = `const D=require('better-sqlite3');const db=new D(process.argv[1],{timeout:20000});try{db.pragma('foreign_keys = OFF');for(const s of JSON.parse(process.argv[2]))db.exec(s);process.stdout.write('__OK__');}finally{db.close();}`;
  const electronPath = require('electron') as unknown as string;
  const { stdout } = await execFileAsync(electronPath, ['-e', script, env.seed.dbPath, JSON.stringify(sqls)],
    { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf-8' });
  if (!stdout.includes('__OK__')) throw new Error('sqlExec KO ' + stdout);
}

async function launch(env: E2EEnvironment, extraEnv: Record<string, string> = {}) {
  const base = { ...(process.env as Record<string, string>), ...extraEnv };
  delete base.GEST_IN_SITU_E2E_DISABLE_SYNC;
  if (extraEnv.GEST_IN_SITU_E2E_DISABLE_SYNC) base.GEST_IN_SITU_E2E_DISABLE_SYNC = extraEnv.GEST_IN_SITU_E2E_DISABLE_SYNC;
  env.app = await electron.launch({ args: [ENTRY, `--user-data-dir=${env.userDataDir}`], env: base });
  const deadline = Date.now() + 120000;
  let w: any = null;
  while (Date.now() < deadline && !w) {
    w = env.app.windows().find((x) => { try { return !x.isClosed() && !x.url().includes('splash.html'); } catch { return false; } });
    if (!w) await Promise.race([env.app.waitForEvent('window', { timeout: 2000 }).catch(() => undefined), sleep(500)]);
  }
  if (!w) throw new Error('fenêtre principale introuvable');
  await w.waitForLoadState('domcontentloaded');
  env.window = w;
  if (extraEnv.QA_OFFLINE === '1') {
    await env.app.evaluate(() => { (globalThis as any).fetch = () => Promise.reject(new TypeError('fetch failed (QA offline emulation)')); });
  }
}
async function shutdown(env: E2EEnvironment) {
  // arrêt forcé de l'arbre de processus, répertoire conservé (testFailed=true)
  await teardownSeededApp(env, true);
}

test.describe.serial('QA terrain — L2-1d préchargement des comptes (cloud dev)', () => {
  test.setTimeout(1_800_000);
  let A: E2EEnvironment; let failed = false; let HASH = '';
  const ids: Record<string, string> = {};
  let off = 0; // offset du main.log pour isoler la session courante

  const fullLog = () => appLog(A);
  const tail = () => fullLog().slice(off);
  const markOffset = () => { off = fullLog().length; };
  const preloadLines = () => tail().split('\n').filter((l) => /Preload:|preloadUsersFromCloud|\[INIT\]|SYS_BOOTSTRAP|UNIQUE|users-sync\.helper/i.test(l));
  const waitPreload = async (maxMs = 90000) => {
    const t = Date.now();
    while (Date.now() - t < maxMs) { if (/Preload: \d+\/\d+ utilisateurs synchronisés/.test(tail())) { await sleep(1500); return true; } await sleep(1000); }
    return false;
  };
  const lu = async (login: string) => (await sqlRead(A, `SELECT * FROM t_users WHERE login='${login}'`))[0];
  const luS = async (s: string) => sqlRead(A, `SELECT * FROM t_users WHERE sync_id='${s}'`);
  const lr = async (login: string) => (await sqlRead(A, `SELECT r.role FROM t_user_roles r JOIN t_users u ON u.id_user=r.id_user WHERE u.login='${login}' ORDER BY r.role`)).map((r: any) => r.role);
  const cIns = async (tag: string, o: any = {}) => {
    const sync_id = o.sync_id || sy(tag); ids[tag] = sync_id;
    const row = { login: P + tag, password_hash: HASH, role: 'OPERATEUR_VERIFICATION', nom_user: tag + '_NOM', prenom_user: 'P', statut_actif: 1, site_id: S1, centre_id: C1, ...o, sync_id };
    const r = await supabaseDev.from('t_users').insert(row);
    if (r.error) log('cloud insert ERR', tag, r.error.message);
    return r.error?.message;
  };
  const cRoles = async (tag: string, roles: string[]) => {
    await supabaseDev.from('t_user_roles').delete().eq('user_sync_id', ids[tag]);
    if (roles.length) { const r = await supabaseDev.from('t_user_roles').insert(roles.map((role) => ({ user_sync_id: ids[tag], role }))); if (r.error) log('cloud roles ERR', tag, r.error.message); }
  };
  const cUpd = async (tag: string, patch: any) => { const r = await supabaseDev.from('t_users').update(patch).eq('sync_id', ids[tag]); if (r.error) log('cloud upd ERR', tag, r.error.message); };
  const localIns = async (tag: string, o: any) => {
    const sync = o.sync_id || sy('L' + tag); ids[tag] = sync;
    const r = { login: P + tag, role: 'OPERATEUR_VERIFICATION', nom: tag + '_LOCALNOM', site: S1, centre: C1, statut: 1, dirty: 0, ...o };
    await sqlExec(A, [`INSERT INTO t_users (login,password_hash,role,nom_user,prenom_user,statut_actif,site_id,centre_id,sync_id,is_dirty) VALUES ('${r.login}','${HASH}','${r.role}','${r.nom}','P',${r.statut},${r.site},${r.centre},'${sync}',${r.dirty})`,
      `INSERT INTO t_user_roles (id_user,role) SELECT id_user,role FROM t_users WHERE login='${r.login}'`]);
  };
  const snapshot = async (like: string) => sqlRead(A, `SELECT login,role,nom_user,statut_actif,site_id,centre_id,sync_id,is_dirty,email FROM t_users WHERE login LIKE '${like}' ORDER BY login`);

  test.afterEach(async ({}, ti) => { if (ti.status !== ti.expectedStatus) failed = true; });
  test.afterAll(async () => {
    log(`BILAN: ${results.filter((r) => r.ok).length}/${results.length} OK`);
    for (const r of results.filter((x) => !x.ok)) log('ECHEC =>', r.name, r.detail);
    try {
      const { data: us } = await supabaseDev.from('t_users').select('sync_id,login').like('login', 'ZZTEST_%');
      for (const u of us || []) {
        await supabaseDev.from('t_user_presence').delete().eq('user_sync_id', u.sync_id);
        await supabaseDev.from('t_user_roles').delete().eq('user_sync_id', u.sync_id);
      }
      await supabaseDev.from('t_logs').delete().in('site_id', [S1, S2]);
      await supabaseDev.from('t_users').delete().like('login', 'ZZTEST_%');
      await supabaseDev.from('t_postes').delete().eq('id', POSTE);
      await supabaseDev.from('t_centres').delete().in('id', [C1, C1B, C2]);
      await supabaseDev.from('t_sites').delete().in('id', [S1, S2]);
      const left = await supabaseDev.from('t_users').select('login');
      const ls = await supabaseDev.from('t_sites').select('id');
      const lc = await supabaseDev.from('t_centres').select('id');
      const lp = await supabaseDev.from('t_postes').select('id');
      const lro = await supabaseDev.from('t_user_roles').select('user_sync_id');
      log('CLEANUP cloud: users=', J(left.data), 'sites=', J(ls.data), 'centres=', J(lc.data), 'postes=', J(lp.data), 'roles=', J(lro.data));
    } catch (e) { console.error('[PRE] cleanup échec', e); }
    if (A) try { await teardownSeededApp(A, failed); } catch { /* */ }
  });

  test('00 garde-fous ref + seed + base locale vide + cloud multi-sites', async () => {
    expect(E2E_CLOUD_SUPABASE_URL).toContain('ajadkziqaskadlzboeqo');
    expect(E2E_CLOUD_SUPABASE_URL).not.toContain('itvyayakwgzvfqvdrgyv');
    expect(existsSync(ENTRY)).toBe(true);
    // le build e2e ne doit contenir AUCUNE trace du ref prod
    const scan = (dir: string): string[] => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? scan(p) : [p]; });
    const bad = scan(join(ROOT, 'dist-e2e-cloud')).filter((f) => /\.(js|html|json|map)$/.test(f) && readFileSync(f, 'utf8').includes('itvyayakwgzvfqvdrgyv'));
    expect(bad).toEqual([]);
    const withRef = scan(join(ROOT, 'dist-e2e-cloud')).filter((f) => /\.js$/.test(f) && readFileSync(f, 'utf8').includes('ajadkziqaskadlzboeqo'));
    log('dist-e2e-cloud: fichiers avec ref dev =', withRef.length, '; avec ref prod = 0');
    check('00 build e2e: ref prod absent, ref dev présent', withRef.length > 0 && bad.length === 0);

    const userDataDir = mkdtempSync(join(tmpdir(), 'gest-in-situ-e2e-pre-'));
    const seed = await runSeedInElectronNode(userDataDir);
    A = { app: null as any, window: null as any, userDataDir, seed };
    log('dbPath =', seed.dbPath, '| userData =', userDataDir);
    const adm = (await sqlRead(A, `SELECT password_hash FROM t_users WHERE login='E2E_ADMINISTRATEUR_SITE'`))[0];
    HASH = adm.password_hash;
    // base fraîche : plus aucun compte / site / centre local
    await sqlExec(A, ['DELETE FROM t_user_roles', 'DELETE FROM t_users', 'DELETE FROM t_centres', 'DELETE FROM t_sites']);
    expect((await sqlRead(A, 'SELECT COUNT(*) c FROM t_users'))[0].c).toBe(0);
    // cloud : 2 sites, 3 centres, 1 poste
    const s = await supabaseDev.from('t_sites').upsert([
      { id: S1, nom: 'ZZTEST_PRE_SITE1', code: 'ZZTEST-PRE-S1', is_active: 1, max_centres: 4, is_permanent: true, sync_id: 'zztest-pre-site1' },
      { id: S2, nom: 'ZZTEST_PRE_SITE2', code: 'ZZTEST-PRE-S2', is_active: 1, max_centres: 4, is_permanent: true, sync_id: 'zztest-pre-site2' }], { onConflict: 'id' });
    expect(s.error?.message).toBeUndefined();
    const c = await supabaseDev.from('t_centres').upsert([
      { id: C1, site_id: S1, nom: 'ZZTEST_PRE_C1', numero: 1, sync_id: 'zztest-pre-c1' },
      { id: C1B, site_id: S1, nom: 'ZZTEST_PRE_C1B', numero: 2, sync_id: 'zztest-pre-c1b' },
      { id: C2, site_id: S2, nom: 'ZZTEST_PRE_C2', numero: 1, sync_id: 'zztest-pre-c2' }], { onConflict: 'id' });
    expect(c.error?.message).toBeUndefined();
    const po = await supabaseDev.from('t_postes').upsert({ id: POSTE, centre_id: C1, nom: 'ZZTEST_PRE_POSTE', numero: 1, sync_id: 'zztest-pre-poste' }, { onConflict: 'id' });
    log('poste cloud:', po.error?.message || 'ok');
    // comptes cloud
    const errs = [
      await cIns('SA', { role: 'SUPER ADMIN', site_id: null, centre_id: null }),
      await cIns('ADM1', { role: 'ADMINISTRATEUR_SITE', centre_id: null }),
      await cIns('MULTI', { role: 'OPERATEUR_QUALITE', email: 'multi@zztest.ci', telephone: '0102030405', poste_id: po.error ? null : POSTE, avatar_url: 'http://zztest/avatar.png', last_login: '2026-10-01T10:00:00Z' }),
      await cIns('S2OP', { role: 'OPERATEUR_SAISIE', site_id: S2, centre_id: C2 })
    ];
    log('erreurs insert cloud =', J(errs));
    await cRoles('MULTI', ['OPERATEUR_QUALITE', 'OPERATEUR_SAISIE']);
    await cRoles('ADM1', ['ADMINISTRATEUR_SITE', 'ADMIN_CENTRE']);
    const cu = await supabaseDev.from('t_users').select('login,site_id,role').like('login', 'ZZTEST_%');
    log('cloud users =', J(cu.data));
    check('00 cloud: 4 comptes de 2 sites (dont SUPER ADMIN site NULL) créés', (cu.data || []).length === 4, J(errs));
  });

  test('S1 base fraîche : démarrage -> comptes insérés (sites/centres/rôles/colonnes étendues), SUPER ADMIN sans site, login hash cloud', async () => {
    markOffset();
    await launch(A);
    const ok = await waitPreload(120000);
    log('lignes Preload:', J(preloadLines().slice(-16)));
    if (!ok) { // la page Login délègue à forceGlobal : on tente de la déclencher comme le ferait l'UI
      log('Aucun préchargement automatique observé en 120 s ; état écran =', await A.window.evaluate(() => location.hash));
    }
    check('S1 ligne "Preload: N/M utilisateurs synchronisés" observée au démarrage sur base vide', ok, J(preloadLines().slice(-4)));
    const sites = await sqlRead(A, 'SELECT id,nom FROM t_sites ORDER BY id');
    const cen = await sqlRead(A, 'SELECT id,site_id FROM t_centres ORDER BY id');
    log('sites locaux =', J(sites), 'centres =', J(cen));
    check('S1 sites 9001/9002 et centres 9101/9102/9201 présents localement', sites.length === 2 && cen.length === 3, J({ sites, cen }));
    const rows = await snapshot(P + '%');
    log('comptes locaux =', J(rows));
    check('S1 4 comptes insérés', rows.length === 4, String(rows.length));
    const sa = await lu(P + 'SA');
    check('S1 SUPER ADMIN sans site inséré (repli): site NULL, role SUPER ADMIN, statut 1, is_dirty 0', !!sa && sa.site_id === null && sa.role === 'SUPER ADMIN' && sa.statut_actif === 1 && sa.is_dirty === 0, J(sa && { site: sa.site_id, role: sa.role, st: sa.statut_actif, d: sa.is_dirty }));
    check('S1 SUPER ADMIN: t_user_roles contient SUPER ADMIN', J(await lr(P + 'SA')) === J(['SUPER ADMIN']), J(await lr(P + 'SA')));
    check('S1 log "dont 1 SUPER ADMIN sans site"', /dont 1 SUPER ADMIN sans site/.test(tail()));
    const m = await lu(P + 'MULTI');
    check('S1 MULTI: site 9001 / centre 9101, rôle principal', !!m && m.site_id === S1 && m.centre_id === C1 && m.role === 'OPERATEUR_QUALITE', J(m && { s: m.site_id, c: m.centre_id, r: m.role }));
    check('S1 MULTI: rôles multiples QUALITE+SAISIE', J(await lr(P + 'MULTI')) === J(['OPERATEUR_QUALITE', 'OPERATEUR_SAISIE']), J(await lr(P + 'MULTI')));
    check('S1 MULTI: colonnes étendues email/telephone/poste_id/avatar_url/last_login écrites', !!m && m.email === 'multi@zztest.ci' && m.telephone === '0102030405' && m.avatar_url === 'http://zztest/avatar.png' && !!m.last_login && (m.poste_id === POSTE || m.poste_id === null), J(m && { e: m.email, t: m.telephone, p: m.poste_id, a: m.avatar_url, l: m.last_login }));
    check('S1 MULTI: poste_id = 9301 écrit', !!m && m.poste_id === POSTE, J(m && m.poste_id));
    const a1 = await lu(P + 'ADM1'); const s2 = await lu(P + 'S2OP');
    check('S1 ADM1 site 9001 centre NULL + rôles ADMIN SITE/CENTRE', !!a1 && a1.site_id === S1 && a1.centre_id === null && J(await lr(P + 'ADM1')) === J(['ADMINISTRATEUR_SITE', 'ADMIN_CENTRE']), J(a1 && { s: a1.site_id, c: a1.centre_id, roles: await lr(P + 'ADM1') }));
    check('S1 S2OP site 9002 centre 9201 (autre site inséré sur base fraîche)', !!s2 && s2.site_id === S2 && s2.centre_id === C2, J(s2 && { s: s2.site_id, c: s2.centre_id }));
    check('S1 hash local == hash cloud (MULTI)', !!m && m.password_hash === HASH);
    check('S1 aucune exception / UNIQUE constraint dans main.log', !/UNIQUE constraint failed/.test(tail()) && !/Preload: Exception/.test(tail()), J(preloadLines().filter((l) => /UNIQUE|Exception/.test(l))));
    // login avec compte préchargé
    // Constat UI : l'écran Login chargé pendant le bootstrap (base vide) peut rester sur « Hors-ligne… première configuration »
    const hadBlock = (await A.window.getByTestId('login-input').count()) === 0;
    log('écran login bloqué sur Hors-ligne (base vide au chargement) =', hadBlock);
    if (hadBlock) {
      await A.window.screenshot({ path: join(ROOT, 'test-results', 'agent13-screenshots', 'agent13-PRE-S1-ecran-hors-ligne.png') }).catch(() => undefined);
      const retry = A.window.getByRole('button', { name: /Réessayer la connexion/ });
      if (await retry.count()) { await retry.click(); await sleep(6000); }
      log('après Réessayer: login-input présent =', (await A.window.getByTestId('login-input').count()) > 0);
      if ((await A.window.getByTestId('login-input').count()) === 0) { await A.window.reload(); await sleep(6000); log('après reload: login-input =', (await A.window.getByTestId('login-input').count()) > 0); }
    }
    const r = await loginUi(A, P + 'MULTI', PWD, false);
    log('login MULTI =', J(r));
    check('S1 connexion avec compte préchargé (hash cloud) OK', r.ok === true, J(r));
    await sleep(1500);
    await shutdown(A);
  });

  test('S2-S6 redémarrage : renommage, autres MAJ, sale, outbox, -1/-1, conflit, statut 0, disparus, cloisonnement', async () => {
    // état local avant : lignes locales supplémentaires (appli arrêtée), puis cloud divergent
    await localIns('REN', {}); await cIns('REN', { sync_id: ids.REN });
    await localIns('OTH', {}); await cIns('OTH', { sync_id: ids.OTH });
    await localIns('DIRTY', { nom: 'LOCALDIRTY', dirty: 1 }); await cIns('DIRTY', { sync_id: ids.DIRTY, nom_user: 'CLOUDNEW' });
    await localIns('OUTB', { nom: 'LOCALOUTB' }); await cIns('OUTB', { sync_id: ids.OUTB, nom_user: 'CLOUDOUTB' });
    await sqlExec(A, [`INSERT INTO t_outbox (id,table_name,operation,payload,status) VALUES ('${ids.OUTB}','t_users','UPDATE','{"sync_id":"${ids.OUTB}","nom_user":"LOCALOUTB"}','PENDING')`]);
    await localIns('DEL', { statut: -1, dirty: -1 }); await cIns('DEL', { sync_id: ids.DEL });
    await localIns('CONF', { nom: 'LOCAL_CONF', sync_id: 'zztest-pre-LOCAL-OTHER-SYNC' }); await cIns('CONF', { nom_user: 'CLOUD_CONF' });
    await localIns('ZERO', {}); await cIns('ZERO', { sync_id: ids.ZERO });
    await localIns('GONE', {});           // local only, site 1
    await localIns('GONE2', { site: S2, centre: C2 }); // local only, site 2
    // divergences cloud
    await cUpd('REN', { login: P + 'REN2', nom_user: 'REN_NOM1' });
    await cUpd('OTH', { nom_user: 'OTH_NOM1', email: 'oth@zztest.ci', role: 'OPERATEUR_SAISIE' });
    await cUpd('ZERO', { statut_actif: 0 });
    await cUpd('MULTI', { nom_user: 'MULTI_NOM1' });
    await cIns('GOOD', {});
    await cUpd('DEL', { nom_user: 'DEL_CLOUD_ACTIF' });
    const before = await snapshot(P + '%');
    const s2Before = J(await sqlRead(A, `SELECT login,role,nom_user,statut_actif,site_id,centre_id,sync_id,is_dirty FROM t_users WHERE site_id=${S2} AND login IN ('${P}S2OP','${P}GONE2') ORDER BY login`));
    const mBefore = await lu(P + 'MULTI');
    log('avant redémarrage =', J(before.map((r: any) => r.login + ':' + r.nom_user)));
    markOffset();
    await launch(A);
    const ok = await waitPreload(90000);
    log('lignes Preload:', J(preloadLines().slice(-16)));
    check('S2 démarrage: préchargement exécuté (comptes locaux existants)', ok && /Comptes locaux détectés/.test(tail()), J(preloadLines().slice(0, 3)));
    check('S2 aucune exception ni "UNIQUE constraint failed" dans main.log', !/UNIQUE constraint failed/.test(tail()) && !/Preload: Exception/.test(tail()), J(preloadLines().filter((l) => /UNIQUE|Exception/.test(l))));
    const ren = await luS(ids.REN);
    check('S2 renommage: 1 ligne, même id_user/sync_id, login ZZTEST_PRE_REN2, nom mis à jour', ren.length === 1 && ren[0].login === P + 'REN2' && ren[0].nom_user === 'REN_NOM1' && ren[0].is_dirty === 0, J(ren.map((r: any) => ({ id: r.id_user, l: r.login, n: r.nom_user }))));
    const renBefore = before.find((r: any) => r.login === P + 'REN');
    check('S2 renommage: ancien login absent, id_user conservé', !(await lu(P + 'REN')), 'idavant=' + (renBefore ? 'ok' : '?'));
    const oth = await lu(P + 'OTH');
    check('S2 AUTRES comptes mis à jour: OTH nom+email+rôle; MULTI nom', oth.nom_user === 'OTH_NOM1' && oth.email === 'oth@zztest.ci' && oth.role === 'OPERATEUR_SAISIE' && (await lu(P + 'MULTI')).nom_user === 'MULTI_NOM1', J({ o: oth.nom_user, e: oth.email, r: oth.role, m: (await lu(P + 'MULTI')).nom_user }));
    check('S2 nouveau compte cloud GOOD inséré', !!(await lu(P + 'GOOD')));
    const d = await lu(P + 'DIRTY');
    check('S3 ligne sale non écrasée (nom local, is_dirty=1)', d.nom_user === 'LOCALDIRTY' && d.is_dirty === 1, J({ n: d.nom_user, d: d.is_dirty, e: d.email }));
    const ob = await lu(P + 'OUTB');
    const obx = await sqlRead(A, `SELECT id,status FROM t_outbox WHERE id='${ids.OUTB}'`);
    check('S3 ligne avec outbox PENDING non écrasée (nom local, is_dirty 0, entrée outbox intacte)', ob.nom_user === 'LOCALOUTB' && ob.is_dirty === 0 && obx.length === 1 && obx[0].status === 'PENDING', J({ n: ob.nom_user, d: ob.is_dirty, e: ob.email, obx }));
    const de = await lu(P + 'DEL');
    check('S4 -1/-1 local non ressuscité', de.statut_actif === -1 && de.is_dirty === -1 && de.nom_user !== 'DEL_CLOUD_ACTIF', J({ st: de.statut_actif, d: de.is_dirty, n: de.nom_user }));
    const cf = await lu(P + 'CONF');
    check('S4 conflit de login: ligne locale intacte, sync_id cloud non inséré', cf.sync_id === 'zztest-pre-LOCAL-OTHER-SYNC' && cf.nom_user === 'LOCAL_CONF' && (await luS(ids.CONF)).length === 0, J({ s: cf.sync_id, n: cf.nom_user }));
    const sumLine = tail().split('\n').filter((l) => /compte\(s\) ignoré\(s\)/.test(l)).pop() || '';
    check('S4 log "Preload: N compte(s) ignoré(s), M conflit(s) de login" (M=1)', /Preload: \d+ compte\(s\) ignoré\(s\), 1 conflit\(s\) de login/.test(sumLine), sumLine.slice(-200));
    const sumRes = tail().split('\n').filter((l) => /utilisateurs synchronisés via upsertCloudUser/.test(l)).pop() || '';
    log('LIGNE RESUME =', sumRes.slice(-400));
    const z = await lu(P + 'ZERO');
    check('S5 statut 0 cloud repris à 0 sur compte local actif propre', z.statut_actif === 0, J({ st: z.statut_actif, d: z.is_dirty }));
    const g = await lu(P + 'GONE'); const g2 = await lu(P + 'GONE2');
    check('S5 compte local absent du cloud: inchangé (aucune passe disparus), sites 1 et 2', g.statut_actif === 1 && g.nom_user === 'GONE_LOCALNOM' && g2.statut_actif === 1 && g2.nom_user === 'GONE2_LOCALNOM', J({ g: g.statut_actif, g2: g2.statut_actif }));
    const s2After = J(await sqlRead(A, `SELECT login,role,nom_user,statut_actif,site_id,centre_id,sync_id,is_dirty FROM t_users WHERE site_id=${S2} AND login IN ('${P}S2OP','${P}GONE2') ORDER BY login`));
    check('S6 cloisonnement: comptes du site 2 (S2OP, GONE2) inchangés/non désactivés', s2Before === s2After, s2After);
    const sa = await lu(P + 'SA'); const a1 = await lu(P + 'ADM1');
    check('S6 SUPER ADMIN (site NULL) et ADM1 toujours actifs, site inchangé', sa.statut_actif === 1 && sa.site_id === null && a1.statut_actif === 1 && a1.site_id === S1, J({ sa: sa.statut_actif, a1: a1.statut_actif }));
    check('S6 MULTI: site/centre/rôles inchangés', mBefore.site_id === S1 && (await lu(P + 'MULTI')).centre_id === C1 && J(await lr(P + 'MULTI')) === J(['OPERATEUR_QUALITE', 'OPERATEUR_SAISIE']));
    log('foreign_key_check t_users =', J(await sqlRead(A, 'PRAGMA foreign_key_check(t_users)')));
    log('PRAGMA foreign_keys (hors app) — vérification via log réactivation:', /Contraintes de clés étrangères \(foreign_keys\) réactivées/.test(tail()));
    check('S2 PRAGMA foreign_keys réactivé (log)', /Contraintes de clés étrangères \(foreign_keys\) réactivées/.test(tail()));
    // l'app démarre normalement et n'est pas bloquée : login avec compte renommé (id_user conservé)
    const r = await loginUi(A, P + 'REN2', PWD, false);
    log('login REN2 (renommé) =', J(r));
    check('S2 app non bloquée: login avec le login renommé OK', r.ok === true, J(r));
    // S6 session du site 1 : session courante cohérente après préchargement
    const cu = await A.window.evaluate(async () => { try { return await (window as any).api.auth.getSessionSnapshot(); } catch (e: any) { return { ex: String(e.message || e) }; } });
    log('getSessionSnapshot =', J(cu));
    check('S6 session agent site 1 valide (getSessionSnapshot)', !!cu && !(cu as any).ex && J(cu).includes(P + 'REN2'), J(cu));
    await sleep(1000);
    await shutdown(A);
  });

  test('S7 démarrage hors-ligne (fetch global rejeté via NODE_OPTIONS) : pas de blocage, comptes locaux inchangés', async () => {
    const rowsBefore = J(await snapshot(P + '%'));
    await cUpd('OTH', { nom_user: 'OTH_NOM_OFFLINE' }); // divergence cloud : ne doit PAS arriver en local
    markOffset();
    await launch(A, { QA_OFFLINE: '1' });
    await sleep(25000);
    log('lignes Preload (offline):', J(preloadLines().slice(-10)));
    const alive = await A.window.evaluate(() => document.readyState).catch(() => null);
    check('S7 émulation active : erreurs fetch dans main.log', /fetch failed/i.test(tail()), J(tail().split(String.fromCharCode(10)).filter((l) => /fetch failed/i.test(l)).slice(0, 3)));
    check('S7 fenêtre réactive (pas de blocage)', alive === 'complete' || alive === 'interactive', String(alive));
    const rowsAfter = J(await snapshot(P + '%'));
    check('S7 comptes locaux strictement inchangés hors-ligne', rowsBefore === rowsAfter, rowsAfter === rowsBefore ? '' : rowsAfter.slice(0, 600));
    check('S7 aucun succès de préchargement (échec réseau)', !/Preload: \d+\/\d+ utilisateurs synchronisés/.test(tail()), J(preloadLines().slice(-5)));
    check('S7 démarrage non bloqué : "[INIT] Preload silencieux terminé" ou "Échec du preload"', /Preload silencieux terminé|Échec du preload silencieux/.test(tail()), J(preloadLines().slice(-3)));
    const r = await loginUi(A, P + 'REN2', PWD, false);
    check('S7 login hors-ligne avec compte local OK', r.ok === true, J(r));
    await shutdown(A);
  });
});
