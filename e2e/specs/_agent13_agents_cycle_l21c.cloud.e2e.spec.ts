/**
 * QA terrain agent-13 — validation VIVANTE de 6a8696e (L2-1c) : cycle de fond comptes (tick ~3 min).
 * Supabase DEV ajadkziqaskadlzboeqo UNIQUEMENT (build dist-e2e-cloud, --mode e2e). JAMAIS la production.
 * Données cloud préfixées ZZTEST_CYC_ ; nettoyage en afterAll.
 */
import { test, expect } from '@playwright/test';
import { launchSeededApp, teardownSeededApp, type E2EEnvironment } from '../fixtures/electron-app';
import { supabaseDev, ensureCloudSiteAndCentre, E2E_CLOUD_SUPABASE_URL } from '../fixtures/supabase-dev-client';
import {
  sleep, sqlRead, sqlWrite, waitOnline, loginUi, logoutUi, goAgents, setWindow1366, toasts, appLog,
  shot, PWD, dismissAlerts
} from './_agent13_agents_helpers';

const P = 'ZZTEST_CYC_';
const log = (...a: any[]) => console.log('[CYC]', ...a);
const J = (x: any) => JSON.stringify(x);
const results: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail = '') => { results.push({ name, ok, detail }); log(ok ? 'PASS' : 'FAIL', name, detail); };
const uuid = (tag: string) => `zztest-cyc-${tag}-${Date.now()}`;

test.describe.serial('QA terrain — L2-1c cycle de fond (cloud dev)', () => {
  test.setTimeout(3_000_000);
  let A: E2EEnvironment; let failed = false; let HASH = ''; let SITE = 0; let ADM_SYNC = ''; let ADM_LOGIN_LOCAL = 'E2E_ADMINISTRATEUR_SITE';
  const ids: Record<string, string> = {};

  const lu = async (login: string) => (await sqlRead(A, `SELECT id_user,login,role,nom_user,statut_actif,site_id,centre_id,sync_id,is_dirty,password_hash FROM t_users WHERE login='${login}'`))[0];
  const luS = async (sync: string) => (await sqlRead(A, `SELECT id_user,login,role,nom_user,statut_actif,centre_id,sync_id,is_dirty,password_hash FROM t_users WHERE sync_id='${sync}'`));
  const lr = async (login: string) => (await sqlRead(A, `SELECT r.role FROM t_user_roles r JOIN t_users u ON u.id_user=r.id_user WHERE u.login='${login}' ORDER BY r.role`)).map((r: any) => r.role);
  const cIns = async (tag: string, o: any) => {
    const sync_id = o.sync_id || uuid(tag); ids[tag] = sync_id;
    const row = { login: P + tag, password_hash: HASH, role: 'OPERATEUR_VERIFICATION', nom_user: tag + '_NOM0', prenom_user: 'P', statut_actif: 1, site_id: SITE, centre_id: 1, ...o, sync_id };
    const r = await supabaseDev.from('t_users').insert(row);
    if (r.error) log('cloud insert ERR', tag, r.error.message);
    return r.error?.message;
  };
  const cRoles = async (tag: string, roles: string[]) => {
    await supabaseDev.from('t_user_roles').delete().eq('user_sync_id', ids[tag]);
    if (roles.length) { const r = await supabaseDev.from('t_user_roles').insert(roles.map((role) => ({ user_sync_id: ids[tag], role }))); if (r.error) log('cloud roles ERR', tag, r.error.message); }
  };
  const cUpd = async (tagOrSync: string, patch: any) => { const s = ids[tagOrSync] || tagOrSync; const r = await supabaseDev.from('t_users').update(patch).eq('sync_id', s); if (r.error) log('cloud upd ERR', tagOrSync, r.error.message); };
  const logText = () => appLog(A);
  const tickCount = () => (logText().match(/Synchronisation des utilisateurs pour le site/g) || []).length;
  const userSyncLines = () => logText().split('\n').filter((l) => /UserSync\]|syncUsersFromCloud\]|users-sync.helper|syncCurrentUserActiveStatus|UNIQUE|Downstream error|foreign key/i.test(l));
  const waitTick = async (from: number, maxMs = 260000) => {
    const t = Date.now();
    while (Date.now() - t < maxMs) { if (tickCount() > from) { await sleep(6000); return true; } await sleep(3000); }
    return false;
  };
  const cur = () => A.window.evaluate(async () => { try { const u = await (window as any).api.auth?.getCurrentUser?.(); return u ? { login: u.login, role: u.role, id: u.id_user } : null; } catch (e: any) { return { ex: String(e.message || e) }; } });

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
      await supabaseDev.from('t_users').delete().like('login', 'ZZTEST_%');
      await supabaseDev.from('t_centres').delete().ilike('nom', 'ZZTEST_%');
      await supabaseDev.from('t_sites').delete().ilike('nom', 'ZZTEST_%');
      const left = await supabaseDev.from('t_users').select('login').or('login.like.ZZTEST_%,login.like.E2E_%');
      log('CLEANUP cloud: users restants ZZTEST_/E2E_ =', J(left.data));
    } catch (e) { console.error('[CYC] cleanup échec', e); }
    if (A) try { await teardownSeededApp(A, failed); } catch { /* */ }
  });

  test('00 setup + garde-fou ref', async () => {
    expect(E2E_CLOUD_SUPABASE_URL).toContain('ajadkziqaskadlzboeqo');
    expect(E2E_CLOUD_SUPABASE_URL).not.toContain('itvyayakwgzvfqvdrgyv');
    A = await launchSeededApp({ allowRealSync: true });
    expect(await waitOnline(A)).toBe(true);
    SITE = A.seed.siteId;
    log('dbPath =', A.seed.dbPath, 'site', SITE, 'centre', A.seed.centreId, 'ref', E2E_CLOUD_SUPABASE_URL);
    await ensureCloudSiteAndCentre(SITE, A.seed.centreId);
    const adm = (await sqlRead(A, `SELECT * FROM t_users WHERE login='E2E_ADMINISTRATEUR_SITE'`))[0];
    HASH = adm.password_hash; ADM_SYNC = adm.sync_id;
    await supabaseDev.from('t_users').delete().like('login', 'E2E_%');
    const ins = await supabaseDev.from('t_users').insert({ login: adm.login, password_hash: HASH, role: adm.role, nom_user: adm.nom_user, prenom_user: adm.prenom_user, statut_actif: 1, site_id: SITE, centre_id: null, sync_id: adm.sync_id });
    expect(ins.error?.message).toBeUndefined();
    // centre 99 cloud, volontairement NON tiré localement (item 6)
    const c99 = await supabaseDev.from('t_centres').upsert({ id: 99, site_id: SITE, nom: 'ZZTEST_CYC_CENTRE_99', numero: 4, sync_id: 'zztest-cyc-centre-99' }, { onConflict: 'id' });
    log('centre cloud 99:', c99.error?.message || 'ok');
    log('centres locaux =', J(await sqlRead(A, 'SELECT id,nom FROM t_centres')));
    // agents cloud initiaux
    for (const t of ['REN', 'OTH', 'DIRTY', 'DEL', 'M']) await cIns(t, t === 'M' ? { role: 'OPERATEUR_QUALITE' } : {});
    await cRoles('M', ['OPERATEUR_QUALITE', 'OPERATEUR_SAISIE']);
    await loginUi(A, 'E2E_ADMINISTRATEUR_SITE', PWD);
    await setWindow1366(A);
    await goAgents(A);
    const r0 = await A.window.evaluate(async (sid) => { const me = await (window as any).api.auth?.getCurrentUser?.(); return (window as any).api.sync.pullAgents(sid, me); }, SITE);
    log('pull initial =', J(r0));
    for (const t of ['REN', 'OTH', 'DIRTY', 'DEL', 'M']) expect(await lu(P + t)).toBeTruthy();
    expect(await lr(P + 'M')).toEqual(['OPERATEUR_QUALITE', 'OPERATEUR_SAISIE']);
    check('00 pull initial: 5 agents locaux', true);
  });

  test('T1 tick #1 : P1-1 renommage session+agent, autres MAJ, P1-2 sale, -1/-1, conflit, centre absent, hash', async () => {
    // relogin pour caler le timer (tick initial +10 s, puis toutes les 3 min)
    await logoutUi(A);
    await loginUi(A, 'E2E_ADMINISTRATEUR_SITE', PWD);
    const loginAt = Date.now();
    const c0 = tickCount();
    log('login à', new Date(loginAt).toISOString(), 'ticks log avant =', c0);
    expect(await waitTick(c0, 60000)).toBe(true); // tick initial +10 s
    const tick1At = Date.now();
    const c1 = tickCount();
    log('tick initial observé; ticks =', c1);
    await goAgents(A);
    // attente jusqu'à ~tick1+130 s avant de préparer (le tick suivant est à ~+180 s)
    await sleep(Math.max(0, 130000 - (Date.now() - tick1At)));
    const t0 = Date.now();
    // P1-2 : sale + outbox PENDING, cloud différent
    await sqlWrite(A, `UPDATE t_users SET nom_user='LOCALDIRTY', is_dirty=1 WHERE login='${P}DIRTY'`);
    await sqlWrite(A, `INSERT INTO t_outbox (id,table_name,operation,payload,status) VALUES ('${ids.DIRTY}','t_users','UPDATE','{"sync_id":"${ids.DIRTY}","nom_user":"LOCALDIRTY"}','PENDING')`);
    await cUpd('DIRTY', { nom_user: 'CLOUDNEW' });
    // -1/-1 local, cloud actif
    await sqlWrite(A, `UPDATE t_users SET statut_actif=-1, is_dirty=-1 WHERE login='${P}DEL'`);
    // P1-1 : renommage de la session (admin) + agent REN ; OTH nom+hash ; M rôles
    await cUpd(ADM_SYNC, { login: P + 'ADM_R', nom_user: 'ADM_NOM_CLOUD' });
    await cUpd('REN', { login: P + 'REN2', nom_user: 'REN_NOM1' });
    await cUpd('OTH', { nom_user: 'OTH_NOM1', password_hash: HASH + 'X', role: 'OPERATEUR_SAISIE' });
    await cRoles('M', ['OPERATEUR_QUALITE', 'OPERATEUR_APUREMENT']);
    // conflit de login : cloud CONF (sync C1) vs local CONF (sync C2)
    await cIns('CONF', { nom_user: 'CLOUD_CONF' });
    await sqlWrite(A, `INSERT INTO t_users (login,password_hash,role,nom_user,prenom_user,statut_actif,site_id,centre_id,sync_id,is_dirty) VALUES ('${P}CONF','${HASH}','OPERATEUR_SAISIE','LOCAL_CONF','P',1,${SITE},1,'zztest-cyc-LOCAL-OTHER-SYNC',0)`);
    // centre absent localement (99) + agent valide inséré après le conflit
    await cIns('CEN99', { centre_id: 99 });
    await cIns('GOOD2', {});
    log('préparation en', Date.now() - t0, 'ms ; depuis tick initial', Date.now() - tick1At, 'ms');
    log('outbox avant tick =', J(await sqlRead(A, `SELECT id,status FROM t_outbox WHERE table_name='t_users'`)));
    expect(await waitTick(c1, 200000)).toBe(true);
    log('tick #2 observé à +', Date.now() - tick1At, 'ms après tick initial');
    await sleep(4000);
    await shot(A, 'CYC-T1-apres-tick');
    const lines = userSyncLines();
    log('lignes sync:', J(lines.slice(-14)));
    const sessCur = await cur(); const hash = await A.window.evaluate(() => location.hash);
    log('session après tick =', J(sessCur), hash);

    check('P1-1 aucun "UNIQUE constraint failed: t_users.sync_id" dans main.log', !/UNIQUE constraint failed/.test(logText()), '');
    const adm = await luS(ADM_SYNC);
    check('P1-1 session renommée: 1 ligne, nouveau login, même id/sync, statut 1', adm.length === 1 && adm[0].login === P + 'ADM_R' && adm[0].statut_actif === 1 && adm[0].nom_user === 'ADM_NOM_CLOUD', J(adm));
    check('P5 renommage seul: session conservée (hors /login, user courant présent)', !hash.includes('/login') && !!sessCur && !sessCur.ex, J(sessCur) + hash);
    const ren = await luS(ids.REN);
    check('P1-1 REN renommé même ligne sync_id', ren.length === 1 && ren[0].login === P + 'REN2' && ren[0].nom_user === 'REN_NOM1' && ren[0].is_dirty === 0, J(ren));
    check('P1-1 ancien login REN absent', !(await lu(P + 'REN')), '');
    const oth = await lu(P + 'OTH');
    check('P1-1 OTH: nom, rôle et hash mis à jour dans le même cycle', oth.nom_user === 'OTH_NOM1' && oth.role === 'OPERATEUR_SAISIE' && oth.password_hash === HASH + 'X', J({ n: oth.nom_user, r: oth.role, h: oth.password_hash === HASH + 'X' }));
    check('rôles M remplacés (QUALITE+APUREMENT)', J(await lr(P + 'M')) === J(['OPERATEUR_APUREMENT', 'OPERATEUR_QUALITE']), J(await lr(P + 'M')));
    const d = await lu(P + 'DIRTY');
    check('P1-2 sale: nom local conservé, is_dirty=1', d.nom_user === 'LOCALDIRTY' && d.is_dirty === 1, J(d));
    check('P1-2 outbox PENDING intacte', (await sqlRead(A, `SELECT status FROM t_outbox WHERE id='${ids.DIRTY}'`))[0]?.status === 'PENDING', J(await sqlRead(A, `SELECT id,status FROM t_outbox WHERE table_name='t_users'`)));
    const de = await lu(P + 'DEL');
    check('P3 -1/-1 non ressuscité', de.statut_actif === -1 && de.is_dirty === -1, J(de));
    const cf = await lu(P + 'CONF');
    check('P4 conflit: ligne locale intacte (sync_id local, nom local)', cf.sync_id === 'zztest-cyc-LOCAL-OTHER-SYNC' && cf.nom_user === 'LOCAL_CONF', J(cf));
    check('P4 sync_id cloud du conflit non inséré', (await luS(ids.CONF)).length === 0, '');
    check('P4 autre agent valide inséré (GOOD2)', !!(await lu(P + 'GOOD2')), '');
    const sumLine = lines.filter((l) => /ignoré\(s\)/.test(l)).pop() || '';
    check('P4 log "ignoré(s) ... conflit(s) de login" présent', /\d+ ignoré\(s\), 1 conflit\(s\) de login/.test(sumLine), sumLine.slice(-260));
    const c99 = await lu(P + 'CEN99');
    check('P6 centre absent localement: cycle OK, agent inséré', !!c99, J(c99 && { centre_id: c99.centre_id }));
    log('INFO centres locaux =', J(await sqlRead(A, 'SELECT id FROM t_centres')), '| foreign_key_check =', J(await sqlRead(A, 'PRAGMA foreign_key_check(t_users)')));
    const hasRefresh = lines.some((l) => /refreshSecureCurrentUser/.test(l));
    check('cycle complet: refreshSecureCurrentUser exécuté après le pull', hasRefresh, '');
  });

  test('T2 P1-2 cohérence : push de l\'outbox -> cloud reçoit la valeur locale', async () => {
    // La session a été éjectée au T1 (constat P5) : reconnexion avec le login renommé
    if (!(await A.window.evaluate(() => location.hash.includes('/login')))) await logoutUi(A);
    const rl = await loginUi(A, P + 'ADM_R', PWD, false);
    log('relogin ADM_R =', J(rl));
    await goAgents(A);
    const before = await supabaseDev.from('t_users').select('nom_user').eq('sync_id', ids.DIRTY).maybeSingle();
    log('cloud DIRTY avant push =', J(before.data), '| local =', J(await lu(P + 'DIRTY')));
    await A.window.getByRole('button', { name: /Envoyer vers le Cloud/ }).click().catch(() => log('bouton push absent'));
    await sleep(10000);
    log('toasts push =', J(await toasts(A)));
    const after = await supabaseDev.from('t_users').select('nom_user').eq('sync_id', ids.DIRTY).maybeSingle();
    log('cloud DIRTY après push =', J(after.data), '| local =', J(await lu(P + 'DIRTY')), '| outbox =', J(await sqlRead(A, `SELECT id,status FROM t_outbox WHERE table_name='t_users'`)));
    check('P1-2 cohérence: cloud reçoit la valeur locale après push (LOCALDIRTY)', after.data?.nom_user === 'LOCALDIRTY', J(after.data));
  });

  test('T3 P5 : renommage + désactivation explicite de la session -> désactivé local + session invalidée', async () => {
    await cUpd(ADM_SYNC, { login: P + 'ADM_R2', statut_actif: 0 });
    const c = tickCount();
    const ok = await waitTick(c, 260000);
    await sleep(3000);
    const adm = await luS(ADM_SYNC);
    const hash = await A.window.evaluate(() => location.hash);
    const sessCur = await cur();
    log('tick vu =', ok, '| admin local =', J(adm), '| hash', hash, '| session', J(sessCur));
    log('lignes sync:', J(userSyncLines().slice(-8)));
    await shot(A, 'CYC-T3-apres-desactivation');
    check('P5 désactivation explicite + renommage: statut local = 0', adm.length === 1 && adm[0].statut_actif === 0, J(adm));
    check('P5 session invalidée (retour /login ou plus d\'utilisateur courant)', hash.includes('/login') || !sessCur || !!sessCur.ex || sessCur === null, hash + J(sessCur));
    check('aucun UNIQUE constraint dans main.log (fin T3)', !/UNIQUE constraint failed/.test(logText()), '');
  });

  test('T4 P7 toast avec ignorés/conflits (bouton Télécharger les agents)', async () => {
    // réactive l'admin (cloud + local) pour reconnecter
    await cUpd(ADM_SYNC, { login: P + 'ADM_R', statut_actif: 1 });
    await dismissAlerts(A);
    if (!(await A.window.evaluate(() => location.hash.includes('/login')))) { try { await logoutUi(A); } catch { await A.window.evaluate(() => { location.hash = '#/login'; }); } }
    await sqlWrite(A, `UPDATE t_users SET statut_actif=1, login='${P}ADM_R', is_dirty=0 WHERE sync_id='${ADM_SYNC}'`);
    const r = await loginUi(A, P + 'ADM_R', PWD, false);
    log('relogin admin renommé =', J(r));
    check('relogin avec le login renommé (hash cloud inchangé)', r.ok === true, J(r));
    await goAgents(A);
    // lignes ignorées : DIRTY (sale), DEL (-1), + CONF (conflit déjà présent)
    await sqlWrite(A, `UPDATE t_users SET nom_user='LOCALDIRTY2', is_dirty=1 WHERE login='${P}DIRTY'`);
    await cUpd('DIRTY', { nom_user: 'CLOUDNEW2' });
    await A.window.getByRole('button', { name: /Télécharger les agents/ }).click();
    await sleep(4500);
    const tt = (await toasts(A)).filter((x) => !/LICENCE/.test(x));
    log('TOASTS =', J(tt));
    await shot(A, 'CYC-T4-toast');
    check('P7 toast contient "ignoré(s)" et "conflit(s) de login"', tt.some((x) => /ignoré\(s\)/.test(x) && /conflit\(s\) de login/.test(x) && /Téléchargement réussi/.test(x)), J(tt));
  });

  test('T5 non-régression : connexion d\'un agent téléchargé (hash cloud)', async () => {
    await dismissAlerts(A);
    if (!(await A.window.evaluate(() => location.hash.includes('/login')))) { try { await logoutUi(A); } catch { /* */ } }
    const r = await loginUi(A, P + 'M', PWD, false);
    check('agent téléchargé (M) se connecte', r.ok === true, J(r));
    check('FIN aucun UNIQUE constraint failed dans main.log', !/UNIQUE constraint failed/.test(logText()), '');
  });
});
