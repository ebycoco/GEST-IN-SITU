/**
 * QA terrain agent-13 — validation VIVANTE de 27a20ba (L2-0) et 8e79f33 (L2-1b).
 * Supabase DEV ajadkziqaskadlzboeqo UNIQUEMENT (build dist-e2e-cloud, --mode e2e). JAMAIS la production.
 * Non commitée. Données cloud préfixées ZZTEST_PULL_ ; nettoyage en afterAll.
 */
import { test, expect } from '@playwright/test';
import { launchSeededApp, teardownSeededApp, type E2EEnvironment } from '../fixtures/electron-app';
import { supabaseDev, ensureCloudSiteAndCentre, E2E_CLOUD_SUPABASE_URL } from '../fixtures/supabase-dev-client';
import {
  sleep, sqlRead, sqlWrite, waitOnline, loginKey, loginUi, logoutUi, goAgents, setWindow1366, toasts, appLog,
  shot, PWD, dismissAlerts, readAllRows
} from './_agent13_agents_helpers';

const P = 'ZZTEST_PULL_';
const log = (...a: any[]) => console.log('[PULL]', ...a);
const J = (x: any) => JSON.stringify(x);
const noLic = (t: string[]) => t.filter((x) => !/LICENCE/.test(x));
const results: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail = '') => { results.push({ name, ok, detail }); log(ok ? 'PASS' : 'FAIL', name, detail); };
const uuid = (tag: string) => `zztest-pull-${tag}-${Date.now()}`;

test.describe.serial('QA terrain — L2-0 / L2-1b (cloud dev)', () => {
  test.setTimeout(2_400_000);
  let A: E2EEnvironment; let failed = false; let HASH = ''; let SITE = 0;
  const ids: Record<string, string> = {};

  const lu = async (login: string) => (await sqlRead(A, `SELECT id_user,login,role,nom_user,statut_actif,site_id,centre_id,sync_id,is_dirty,email,telephone FROM t_users WHERE login='${login}'`))[0];
  const luS = async (sync: string) => (await sqlRead(A, `SELECT id_user,login,role,nom_user,statut_actif,centre_id,sync_id,is_dirty FROM t_users WHERE sync_id='${sync}'`));
  const lr = async (login: string) => (await sqlRead(A, `SELECT r.role FROM t_user_roles r JOIN t_users u ON u.id_user=r.id_user WHERE u.login='${login}' ORDER BY r.role`)).map((r: any) => r.role);
  const cIns = async (tag: string, o: any) => {
    const sync_id = o.sync_id === null ? null : (o.sync_id || uuid(tag));
    if (o.sync_id !== null) ids[tag] = sync_id;
    const row = { login: P + tag, password_hash: HASH, role: 'OPERATEUR_VERIFICATION', nom_user: tag + '_NOM0', prenom_user: 'P', statut_actif: 1, site_id: SITE, centre_id: 1, ...o, sync_id };
    const r = await supabaseDev.from('t_users').insert(row);
    log('cloud insert', tag, r.error ? 'ERR ' + r.error.message : 'ok');
    return r.error?.message;
  };
  const cRoles = async (tag: string, roles: string[]) => {
    await supabaseDev.from('t_user_roles').delete().eq('user_sync_id', ids[tag]);
    if (roles.length) { const r = await supabaseDev.from('t_user_roles').insert(roles.map((role) => ({ user_sync_id: ids[tag], role }))); if (r.error) log('cloud roles ERR', tag, r.error.message); }
  };
  const cUpd = async (tag: string, patch: any) => { const r = await supabaseDev.from('t_users').update(patch).eq('sync_id', ids[tag]); if (r.error) log('cloud upd ERR', tag, r.error.message); };
  const pullIpc = (env = A) => env.window.evaluate(async (sid) => {
    try { const me = await (window as any).api.auth?.getCurrentUser?.(); return await (window as any).api.sync.pullAgents(sid, me); } catch (e: any) { return { ex: String(e.message || e) }; }
  }, SITE);
  const pullLines = () => appLog(A).split('\n').filter((l) => /pullAgentsFromCloud\] Site|users-sync.helper|syncCurrentUserActiveStatus|UserSync\]|syncUsersFromCloud|Downstream error|UNIQUE/.test(l));
  const lastSummary = () => { const l = pullLines().filter((x) => /Site \d+ : \{/.test(x)).pop() || ''; return l.slice(l.indexOf('Site ')); };
  const freshQuiet = async (key = 'administrateurSite') => {
    if (!(await A.window.evaluate(() => location.hash.includes('/login')))) await logoutUi(A);
    await loginKey(A, key);
    await sleep(22000); // tick initial du cycle comptes (10 s) passé -> ~2m30 de calme
  };

  test.afterEach(async ({}, ti) => { if (ti.status !== ti.expectedStatus) failed = true; });
  test.afterAll(async () => {
    log(`BILAN: ${results.filter((r) => r.ok).length}/${results.length} OK`);
    for (const r of results.filter((x) => !x.ok)) log('ECHEC =>', r.name, r.detail);
    try {
      const { data: us } = await supabaseDev.from('t_users').select('sync_id,login').or('login.like.ZZTEST_%,login.like.E2E_%');
      for (const u of us || []) {
        await supabaseDev.from('t_user_presence').delete().eq('user_sync_id', u.sync_id);
        await supabaseDev.from('t_user_roles').delete().eq('user_sync_id', u.sync_id);
      }
      await supabaseDev.from('t_logs').delete().eq('site_id', 1);
      for (const u of us || []) await supabaseDev.from('t_users').delete().eq('sync_id', u.sync_id);
      await supabaseDev.from('t_users').delete().like('login', 'ZZTEST_PULL_%');
      await supabaseDev.from('t_centres').delete().ilike('nom', 'ZZTEST_%');
      await supabaseDev.from('t_sites').delete().ilike('nom', 'ZZTEST_%');
      const left = await supabaseDev.from('t_users').select('login').or('login.like.ZZTEST_%,login.like.E2E_%');
      log('CLEANUP cloud: users restants ZZTEST_/E2E_ =', J(left.data));
    } catch (e) { console.error('[PULL] cleanup échec', e); }
    if (A) try { await teardownSeededApp(A, failed); } catch { /* */ }
  });

  test('00 setup', async () => {
    expect(E2E_CLOUD_SUPABASE_URL).toContain('ajadkziqaskadlzboeqo');
    expect(E2E_CLOUD_SUPABASE_URL).not.toContain('itvyayakwgzvfqvdrgyv');
    A = await launchSeededApp({ allowRealSync: true });
    expect(await waitOnline(A)).toBe(true);
    SITE = A.seed.siteId;
    log('dbPath A =', A.seed.dbPath, 'site', SITE, 'centre', A.seed.centreId);
    await ensureCloudSiteAndCentre(SITE, A.seed.centreId);
    for (const id of [2, 3]) {
      const r = await supabaseDev.from('t_centres').upsert({ id, site_id: SITE, nom: 'ZZTEST_PULL_CENTRE_X', numero: id, sync_id: `zztest-pull-centre-${id}` }, { onConflict: 'id' });
      expect(r.error?.message).toBeUndefined();
    }
    const adm = (await sqlRead(A, `SELECT * FROM t_users WHERE login='E2E_ADMINISTRATEUR_SITE'`))[0];
    HASH = adm.password_hash;
    await supabaseDev.from('t_users').delete().like('login', 'E2E_%');
    const ins = await supabaseDev.from('t_users').insert({ login: adm.login, password_hash: HASH, role: adm.role, nom_user: adm.nom_user, prenom_user: adm.prenom_user, statut_actif: 1, site_id: SITE, centre_id: null, sync_id: adm.sync_id });
    expect(ins.error?.message).toBeUndefined();
    await loginKey(A, 'administrateurSite');
    log('pullCentres =', J(await A.window.evaluate(async (sid) => (window as any).api.hierarchy.pullCentres(sid), SITE)));
    log('centres locaux =', J(await sqlRead(A, 'SELECT id,nom FROM t_centres')));
    // ADMIN_CENTRE local + cloud (centre 3)
    const acSync = uuid('ac');
    await sqlWrite(A, `INSERT INTO t_users (login,password_hash,role,nom_user,prenom_user,statut_actif,site_id,centre_id,sync_id,is_dirty) VALUES ('E2E_ADMIN_CENTRE_Z','${HASH}','ADMIN_CENTRE','ACNOM','P',1,${SITE},3,'${acSync}',0)`);
    const acId = (await sqlRead(A, `SELECT id_user FROM t_users WHERE login='E2E_ADMIN_CENTRE_Z'`))[0].id_user;
    await sqlWrite(A, `INSERT INTO t_user_roles (id_user,role) VALUES (${acId},'ADMIN_CENTRE')`);
    const r2 = await supabaseDev.from('t_users').insert({ login: 'E2E_ADMIN_CENTRE_Z', password_hash: HASH, role: 'ADMIN_CENTRE', nom_user: 'ACNOM', prenom_user: 'P', statut_actif: 1, site_id: SITE, centre_id: 3, sync_id: acSync });
    expect(r2.error?.message).toBeUndefined();
    await setWindow1366(A);
  });

  test('S1+S2+S3+S4+S5+S6 pull : renommage, sale, supprimé, conflit, invalides, rôles', async () => {
    // --- agents cloud initiaux, puis premier pull (insertions) ---
    await cIns('REN', {}); await cIns('OTH', {}); await cIns('DIRTY', {}); await cIns('PEND', {}); await cIns('DEL', {});
    await cIns('M', { role: 'OPERATEUR_QUALITE', centre_id: 2 }); await cRoles('M', ['OPERATEUR_QUALITE', 'OPERATEUR_SAISIE']);
    await cIns('SESS', {}); await cIns('DIRTYR', {}); await cRoles('DIRTYR', ['OPERATEUR_VERIFICATION']);
    await goAgents(A);
    const r0 = await pullIpc();
    log('pull #0 =', J(r0), '|', lastSummary());
    check('pull initial: 9 insertions, success', r0.success === true && r0.summary?.inserted >= 9, J(r0));
    const m0 = await lu(P + 'M');
    check('S6 rôles multiples répliqués (insertion) + centre 2', J(await lr(P + 'M')) === J(['OPERATEUR_QUALITE', 'OPERATEUR_SAISIE']) && m0.centre_id === 2, J({ roles: await lr(P + 'M'), c: m0.centre_id }));
    check('hash cloud copié (non vide)', (await sqlRead(A, `SELECT password_hash h FROM t_users WHERE login='${P}M'`))[0].h === HASH, '');

    // --- fenêtre calme ---
    await freshQuiet();
    await goAgents(A);
    const t0 = Date.now();
    // S2 sale : locale modifiée + outbox PENDING ; cloud différent
    await sqlWrite(A, `UPDATE t_users SET nom_user='LOCALDIRTY', is_dirty=1 WHERE login='${P}DIRTY'`);
    await sqlWrite(A, `INSERT INTO t_outbox (id,table_name,operation,payload,status) VALUES ('${ids.DIRTY}','t_users','UPDATE','{"sync_id":"${ids.DIRTY}","nom_user":"LOCALDIRTY"}','PENDING')`);
    await cUpd('DIRTY', { nom_user: 'CLOUDNEW' });
    // S2b sale « roles » : locale dirty, rôles locaux 1, cloud 2
    await sqlWrite(A, `UPDATE t_users SET is_dirty=1 WHERE login='${P}DIRTYR'`);
    await cRoles('DIRTYR', ['OPERATEUR_VERIFICATION', 'OPERATEUR_APUREMENT']);
    // S2c outbox seul (is_dirty=0)
    await sqlWrite(A, `INSERT INTO t_outbox (id,table_name,operation,payload,status) VALUES ('${ids.PEND}','t_users','UPDATE','{"sync_id":"${ids.PEND}","nom_user":"LOCALPEND"}','PENDING')`);
    await sqlWrite(A, `UPDATE t_users SET nom_user='LOCALPEND' WHERE login='${P}PEND'`);
    await cUpd('PEND', { nom_user: 'CLOUDPEND' });
    // S3 supprimé local en attente
    await sqlWrite(A, `UPDATE t_users SET statut_actif=-1, is_dirty=-1 WHERE login='${P}DEL'`);
    // S1 renommage + autre agent modifié + rôles de M modifiés
    await cUpd('REN', { login: P + 'REN2', nom_user: 'REN_NOM1' });
    await cUpd('OTH', { nom_user: 'OTH_NOM1' });
    await cRoles('M', ['OPERATEUR_QUALITE', 'OPERATEUR_APUREMENT']);
    // S4 conflit : cloud CONF (sync C1) vs local CONF (sync C2)
    await cIns('CONF', { nom_user: 'CLOUD_CONF' });
    await sqlWrite(A, `INSERT INTO t_users (login,password_hash,role,nom_user,prenom_user,statut_actif,site_id,centre_id,sync_id,is_dirty) VALUES ('${P}CONF','${HASH}','OPERATEUR_SAISIE','LOCAL_CONF','P',1,${SITE},1,'zztest-pull-LOCAL-OTHER-SYNC',0)`);
    // S5 invalides
    const e1 = await cIns('BADROLE', { role: 'ROLE_BIDON' });
    const e2 = await cIns('NOHASH', { password_hash: '' });
    const e3 = await cIns('NOSYNC', { sync_id: null });
    log('invalides cloud (erreur éventuelle de contrainte):', J({ e1, e2, e3 }));
    await cIns('GOOD2', {}); // agent valide inséré APRÈS les invalides
    log('préparation en', Date.now() - t0, 'ms');
    const pre = await sqlRead(A, `SELECT login,nom_user,is_dirty,statut_actif FROM t_users WHERE login LIKE '${P}%' ORDER BY login`);
    log('état local avant pull =', J(pre));
    log('outbox avant =', J(await sqlRead(A, `SELECT id,status FROM t_outbox WHERE table_name='t_users'`)));

    // clic UI
    await A.window.getByRole('button', { name: /Télécharger les agents/ }).click();
    await sleep(4500);
    const tt = noLic(await toasts(A));
    log('TOASTS après clic =', J(tt));
    log('durée total fenêtre', Date.now() - t0, 'ms |', lastSummary());
    await shot(A, 'PULL-S1-apres-telechargement');
    check('S1 toast succès (pas d\'échec)', tt.some((x) => /Téléchargement réussi/.test(x)) && !tt.some((x) => /Échec|Erreur/.test(x)), J(tt));

    const ren = await luS(ids.REN); const oth = await lu(P + 'OTH');
    check('S1 login local renommé (même ligne, sync_id)', ren.length === 1 && ren[0].login === P + 'REN2' && ren[0].nom_user === 'REN_NOM1' && ren[0].is_dirty === 0, J(ren));
    check('S1 pas de doublon ancien login', !(await lu(P + 'REN')), '');
    check('S1 autres agents mis à jour (OTH)', oth.nom_user === 'OTH_NOM1', J(oth));
    const mR = await lr(P + 'M');
    check('S6 rôles propres remplacés (M : QUALITE+APUREMENT)', J(mR) === J(['OPERATEUR_APUREMENT', 'OPERATEUR_QUALITE']), J(mR));
    const d = await lu(P + 'DIRTY');
    check('S2 ligne sale NON écrasée (nom local conservé, is_dirty 1)', d.nom_user === 'LOCALDIRTY' && d.is_dirty === 1, J(d));
    check('S2 outbox PENDING conservée', (await sqlRead(A, `SELECT status FROM t_outbox WHERE id='${ids.DIRTY}'`))[0]?.status === 'PENDING', '');
    const dr = await lr(P + 'DIRTYR');
    check('S6 ligne sale : rôles non remplacés', J(dr) === J(['OPERATEUR_VERIFICATION']), J(dr));
    const pe = await lu(P + 'PEND');
    check('S2c outbox PENDING seul : nom local conservé', pe.nom_user === 'LOCALPEND', J(pe));
    const de = await lu(P + 'DEL');
    check('S3 supprimé (-1/-1) non ressuscité', de.statut_actif === -1 && de.is_dirty === -1, J(de));
    const cf = await lu(P + 'CONF');
    check('S4 conflit : ligne locale intacte', cf.sync_id === 'zztest-pull-LOCAL-OTHER-SYNC' && cf.nom_user === 'LOCAL_CONF', J(cf));
    check('S4 sync_id cloud du conflit non inséré', (await luS(ids.CONF)).length === 0, '');
    check('S4 autres agents valides après le conflit (GOOD2 inséré)', !!(await lu(P + 'GOOD2')), '');
    check('S5 BADROLE absent', e1 ? true : !(await lu(P + 'BADROLE')), 'cloudErr=' + e1);
    check('S5 NOHASH absent', e2 ? true : !(await lu(P + 'NOHASH')), 'cloudErr=' + e2);
    check('S5 NOSYNC absent', e3 ? true : !(await lu(P + 'NOSYNC')), 'cloudErr=' + e3);
    check('S1..S5 résumé loggé (conflits 1)', /skipped_conflict":1/.test(lastSummary()), lastSummary());
    const rowsUi = (await readAllRows(A)).map((x) => x.login);
    log('liste UI =', J(rowsUi.filter((l) => l.startsWith(P))));
    check('UI: DEL supprimé non listé', !rowsUi.includes(P + 'DEL'), '');
    check('UI: REN2 listé', rowsUi.includes(P + 'REN2'), '');
    // S2d : second pull idempotent, dirty toujours préservé
    const r2 = await pullIpc(); log('pull #2 =', J(r2));
    check('pull #2 idempotent : dirty toujours préservé', (await lu(P + 'DIRTY')).nom_user === 'LOCALDIRTY' && (await lu(P + 'DEL')).statut_actif === -1, J(r2.summary));
    log('lignes de log pull:', J(pullLines().slice(-12)));
  });

  test('S2e : le cycle de fond syncUsersFromCloud (3 min) vs ligne sale', async () => {
    // observation de la voie NON modifiée par L2-1b : écrase-t-elle la ligne sale ?
    await goAgents(A);
    const before = await lu(P + 'DIRTY');
    log('avant attente tick :', J(before));
    const t = Date.now();
    let after = before;
    while (Date.now() - t < 200000) { await sleep(10000); after = await lu(P + 'DIRTY'); if (after.nom_user !== before.nom_user || after.is_dirty !== before.is_dirty) break; }
    log('après tick :', J(after), '| lignes UserSync:', J(pullLines().filter((l) => /UserSync|UNIQUE|syncUsersFromCloud|Downstream error/.test(l)).slice(-10)));
    check('S2e (info) cycle de fond 3 min n\'écrase pas la ligne sale', after.nom_user === 'LOCALDIRTY' && after.is_dirty === 1, J(after));
  });

  test('S8 L2-0 : session non éjectée après renommage cloud ; désactivation explicite appliquée', async () => {
    if (!(await A.window.evaluate(() => location.hash.includes('/login')))) await logoutUi(A);
    const sess = await luS(ids.SESS);
    log('SESS local avant =', J(sess));
    await cUpd('SESS', { login: P + 'SESS_R' });
    const rLogin = await loginUi(A, P + 'SESS', PWD, false);
    check('S8 connexion agent (login local ancien) OK', rLogin.ok === true, J(rLogin));
    await sleep(40000); // tick initial +10 s
    const s1 = await luS(ids.SESS);
    const hash1 = await A.window.evaluate(() => location.hash);
    log('SESS après tick, hash UI =', hash1, J(s1));
    log('lignes sync:', J(pullLines().filter((l) => /UserSync|UNIQUE|syncUsersFromCloud|syncCurrentUserActiveStatus|Downstream error/.test(l)).slice(-8)));
    check('S8 renommage cloud : statut_actif local reste 1', s1.length >= 1 && s1.every((x: any) => x.statut_actif === 1), J(s1));
    check('S8 renommage cloud : session non éjectée (hors /login)', !hash1.includes('/login'), hash1);
    await shot(A, 'PULL-S8-session-apres-renommage');
    // désactivation explicite
    await cUpd('SESS', { statut_actif: 0 });
    const t = Date.now(); let st = 1;
    while (Date.now() - t < 230000) { await sleep(10000); st = (await luS(ids.SESS))[0]?.statut_actif; if (st === 0) break; }
    log('SESS statut après désactivation cloud =', st, 'en', Date.now() - t, 'ms');
    log('lignes sync:', J(pullLines().filter((l) => /syncCurrentUserActiveStatus|UNIQUE|UserSync\]/.test(l)).slice(-8)));
    check('S8 désactivation explicite cloud (0) -> désactivé localement', st === 0, 'statut=' + st);
    check('S8 is_dirty non touché par la désactivation descendante', (await luS(ids.SESS))[0]?.is_dirty === 0, J(await luS(ids.SESS)));
  });

  test('S7 ADMIN_CENTRE : remap de centre par nom, centre inexistant -> NULL', async () => {
    await dismissAlerts(A);
    const onLogin = await A.window.evaluate(() => location.hash.includes('/login'));
    if (!onLogin) { try { await logoutUi(A); } catch { await A.window.evaluate(() => { location.hash = '#/login'; }); } }
    await cIns('CEN_REMAP', { centre_id: 2 });
    const c99 = await supabaseDev.from('t_centres').upsert({ id: 99, site_id: SITE, nom: 'ZZTEST_PULL_CENTRE_99', numero: 4, sync_id: 'zztest-pull-centre-99' }, { onConflict: 'id' });
    log('centre cloud 99:', c99.error?.message || 'ok');
    await cIns('CEN_NONE', { centre_id: 99 });
    const rl = await loginUi(A, 'E2E_ADMIN_CENTRE_Z', PWD, false);
    log('login ADMIN_CENTRE =', J(rl), await A.window.evaluate(() => location.hash));
    await sleep(2000);
    const res = await A.window.evaluate(async (sid) => { try { const me = await (window as any).api.auth?.getCurrentUser?.(); return await (window as any).api.sync.syncUsersFromSupabase(sid, me); } catch (e: any) { return { ex: String(e.message || e) }; } }, SITE);
    log('syncUsersFromSupabase =', J(res), '|', lastSummary());
    const a = await lu(P + 'CEN_REMAP'); const b = await lu(P + 'CEN_NONE');
    log('centres locaux =', J(await sqlRead(A, 'SELECT id,nom FROM t_centres')));
    check('S7 ADMIN_CENTRE : appel réussi', res?.success === true, J(res));
    check('S7 remap par nom : centre cloud 2 -> centre admin 3', a?.centre_id === 3, J(a));
    check('S7 centre inexistant localement -> NULL', b && b.centre_id === null, J(b));
    await shot(A, 'PULL-S7-admin-centre');
  });

  test('S9 non-régression : connexion d\'un agent téléchargé, push', async () => {
    await dismissAlerts(A);
    if (!(await A.window.evaluate(() => location.hash.includes('/login')))) { try { await logoutUi(A); } catch { /* */ } }
    const r = await loginUi(A, P + 'M', PWD, false);
    check('S9 agent téléchargé (hash cloud) se connecte', r.ok === true, J(r) + ' ' + await A.window.evaluate(() => location.hash));
    await sleep(1500);
    try { await logoutUi(A); } catch { await A.window.evaluate(() => { location.hash = '#/login'; }); }
    await loginKey(A, 'administrateurSite'); await goAgents(A);
    await A.window.getByRole('button', { name: /Envoyer vers le Cloud/ }).click().catch(() => log('bouton push absent/désactivé'));
    await sleep(8000);
    log('toasts push =', J(noLic(await toasts(A))));
    const c = await supabaseDev.from('t_users').select('login,nom_user').eq('sync_id', ids.DIRTY).maybeSingle();
    log('cloud DIRTY après push =', J(c.data), '| local =', J(await lu(P + 'DIRTY')), '| outbox =', J(await sqlRead(A, `SELECT id,status FROM t_outbox WHERE table_name='t_users'`)));
  });
});
