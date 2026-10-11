/**
 * QA terrain agent-13 — validation VIVANTE de 6709a21 (L2-0b) : session suivie par id_user.
 * Supabase DEV ajadkziqaskadlzboeqo UNIQUEMENT (build dist-e2e-cloud, --mode e2e). JAMAIS la production.
 * Données cloud préfixées ZZTEST_L20B_ ; nettoyage en afterAll.
 */
import { test, expect } from '@playwright/test';
import { launchSeededApp, teardownSeededApp, type E2EEnvironment } from '../fixtures/electron-app';
import { supabaseDev, ensureCloudSiteAndCentre, E2E_CLOUD_SUPABASE_URL } from '../fixtures/supabase-dev-client';
import {
  sleep, sqlRead, sqlWrite, waitOnline, loginUi, logoutUi, goAgents, setWindow1366, toasts, appLog,
  shot, PWD, dismissAlerts, createAgentUI
} from './_agent13_agents_helpers';

const P = 'ZZTEST_L20B_';
const log = (...a: any[]) => console.log('[L20B]', ...a);
const J = (x: any) => JSON.stringify(x);
const results: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail = '') => { results.push({ name, ok, detail }); log(ok ? 'PASS' : 'FAIL', name, detail); };
const uuid = (tag: string) => `zztest-l20b-${tag}-${Date.now()}`;

test.describe.serial('QA terrain — L2-0b session par id_user (cloud dev)', () => {
  test.setTimeout(3_600_000);
  let A: E2EEnvironment; let failed = false; let HASH = ''; let SITE = 0; let CENTRE = 0; let ADM_SYNC = '';
  const sync: Record<string, string> = {};

  const logText = () => appLog(A);
  const refreshCount = () => (logText().match(/\[UserSync\] refreshSecureCurrentUser —/g) || []).length;
  const waitRefresh = async (from: number, maxMs = 260000) => {
    const t = Date.now();
    while (Date.now() - t < maxMs) { if (refreshCount() > from) { await sleep(2500); return true; } await sleep(2000); }
    return false;
  };
  const snap = () => A.window.evaluate(async () => { try { return await (window as any).api.auth.getSessionSnapshot(); } catch (e: any) { return { ex: String(e.message || e) }; } });
  const hashUi = () => A.window.evaluate(() => location.hash);
  const byId = async (id: number) => (await sqlRead(A, `SELECT id_user,login,role,statut_actif,is_dirty,sync_id,site_id,centre_id,nom_user FROM t_users WHERE id_user=${id}`))[0];
  const byLogin = async (l: string) => (await sqlRead(A, `SELECT id_user,login,role,statut_actif,is_dirty,sync_id,site_id,centre_id FROM t_users WHERE login='${l}'`))[0];
  const rolesOf = async (id: number) => (await sqlRead(A, `SELECT role FROM t_user_roles WHERE id_user=${id} ORDER BY role`)).map((r: any) => r.role);

  const mk = async (tag: string, role: string, roles: string[], centre: number | null) => {
    const s = uuid(tag); sync[tag] = s;
    await sqlWrite(A, `INSERT INTO t_users (login,password_hash,role,nom_user,prenom_user,statut_actif,site_id,centre_id,sync_id,is_dirty) VALUES ('${P}${tag}','${HASH}','${role}','${tag}_NOM','P',1,${SITE},${centre === null ? 'NULL' : centre},'${s}',0)`);
    const id = (await byLogin(P + tag)).id_user;
    for (const r of roles) await sqlWrite(A, `INSERT INTO t_user_roles (id_user,role) VALUES (${id},'${r}')`);
    const ins = await supabaseDev.from('t_users').insert({ login: P + tag, password_hash: HASH, role, nom_user: tag + '_NOM', prenom_user: 'P', statut_actif: 1, site_id: SITE, centre_id: centre, sync_id: s });
    expect(ins.error?.message).toBeUndefined();
    await supabaseDev.from('t_user_roles').insert(roles.map((r) => ({ user_sync_id: s, role: r })));
    return id;
  };
  const cUpd = async (s: string, patch: any) => { const r = await supabaseDev.from('t_users').update(patch).eq('sync_id', s); if (r.error) log('cloud upd ERR', r.error.message); };
  const fresh = async (login: string, expectOk = true) => {
    await dismissAlerts(A);
    if (!(await hashUi()).includes('/login')) { try { await logoutUi(A); } catch { await A.window.evaluate(() => { location.hash = '#/login'; }); } }
    return loginUi(A, login, PWD, expectOk);
  };
  const presence = async (s: string) => (await supabaseDev.from('t_user_presence').select('login,last_heartbeat_at,last_login_at').eq('user_sync_id', s).maybeSingle()).data;

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
      const leftP = await supabaseDev.from('t_user_presence').select('user_sync_id').like('user_sync_id', 'zztest-%');
      log('CLEANUP cloud: users restants =', J(left.data), '| presence zztest restantes =', J(leftP.data));
    } catch (e) { console.error('[L20B] cleanup échec', e); }
    if (A) try { await teardownSeededApp(A, failed); } catch { /* */ }
  });

  test('00 setup + garde-fou ref', async () => {
    expect(E2E_CLOUD_SUPABASE_URL).toContain('ajadkziqaskadlzboeqo');
    expect(E2E_CLOUD_SUPABASE_URL).not.toContain('itvyayakwgzvfqvdrgyv');
    A = await launchSeededApp({ allowRealSync: true });
    expect(await waitOnline(A)).toBe(true);
    SITE = A.seed.siteId; CENTRE = A.seed.centreId;
    log('dbPath =', A.seed.dbPath, 'site', SITE, 'centre', CENTRE, 'ref', E2E_CLOUD_SUPABASE_URL);
    await ensureCloudSiteAndCentre(SITE, CENTRE);
    const adm = (await sqlRead(A, `SELECT * FROM t_users WHERE login='E2E_ADMINISTRATEUR_SITE'`))[0];
    HASH = adm.password_hash; ADM_SYNC = adm.sync_id;
    await supabaseDev.from('t_users').delete().like('login', 'E2E_%');
    const ins = await supabaseDev.from('t_users').insert({ login: adm.login, password_hash: HASH, role: adm.role, nom_user: adm.nom_user, prenom_user: adm.prenom_user, statut_actif: 1, site_id: SITE, centre_id: null, sync_id: adm.sync_id });
    expect(ins.error?.message).toBeUndefined();
    await supabaseDev.from('t_user_roles').delete().eq('user_sync_id', ADM_SYNC);
    await supabaseDev.from('t_user_roles').insert({ user_sync_id: ADM_SYNC, role: 'ADMINISTRATEUR_SITE' });
    await mk('AC', 'ADMIN_CENTRE', ['ADMIN_CENTRE'], CENTRE);
    await mk('OP', 'OPERATEUR_VERIFICATION', ['OPERATEUR_VERIFICATION'], CENTRE);
    await mk('MR', 'OPERATEUR_VERIFICATION', ['OPERATEUR_VERIFICATION', 'OPERATEUR_QUALITE'], CENTRE);
    await mk('DEL1', 'OPERATEUR_VERIFICATION', ['OPERATEUR_VERIFICATION'], CENTRE);
    await mk('DEL2', 'OPERATEUR_VERIFICATION', ['OPERATEUR_VERIFICATION'], CENTRE);
    await mk('DIS', 'OPERATEUR_VERIFICATION', ['OPERATEUR_VERIFICATION'], CENTRE);
    log('rôles locaux =', J(await sqlRead(A, `SELECT u.login,GROUP_CONCAT(r.role) r FROM t_users u LEFT JOIN t_user_roles r ON r.id_user=u.id_user GROUP BY u.id_user`)));
    await setWindow1366(A);
  });

  test('SA — P1-3 admin de site renommé (session conservée, présence, actions) puis désactivation (scénarios 1 et 3)', async () => {
    const off = logText().length;
    const idA = (await byLogin('E2E_ADMINISTRATEUR_SITE')).id_user;
    await cUpd(ADM_SYNC, { login: P + 'SA_R', nom_user: 'SA_NOM_CLOUD' });
    const c0 = refreshCount();
    await fresh('E2E_ADMINISTRATEUR_SITE');
    const loginAt = Date.now();
    const s0 = await snap();
    log('snapshot au login =', J(s0));
    expect(await waitRefresh(c0, 60000)).toBe(true);
    const s1 = await snap(); const h1 = await hashUi(); const row = await byId(idA);
    log('SA après tick1 : snapshot', J(s1), h1, 'local', J(row));
    await shot(A, 'L20B-SA-apres-tick1');
    const L = logText().slice(off);
    check('SA session conservée (hors /login)', !h1.includes('/login') && !!s1 && !s1.ex, h1 + J(s1));
    check('SA statut local = 1, login local renommé', row.statut_actif === 1 && row.login === P + 'SA_R' && row.nom_user === 'SA_NOM_CLOUD', J(row));
    check('SA session serveur : login courant renommé, id_user/role/site inchangés', s1?.login === P + 'SA_R' && s1.id_user === idA && s1.role === 'ADMINISTRATEUR_SITE' && s1.site_id === SITE, J(s1));
    check('SA main.log : pas de disabled=true ni UNIQUE', !/disabled=true/.test(L) && !/UNIQUE constraint failed/.test(L), (L.match(/refreshSecureCurrentUser —[^\n]*/g) || []).join(' || '));
    // actions post-renommage : page Agents + création d'un agent
    await setWindow1366(A);
    await goAgents(A);
    const cr = await createAgentUI(A, { login: P + 'NEWAG', password: PWD, nom: 'ZZTEST_L20B_NEWAG', roles: ['OPERATEUR_VERIFICATION'], centreId: CENTRE });
    log('création agent =', J(cr), J(await byLogin(P + 'NEWAG')));
    await shot(A, 'L20B-SA-creation-agent');
    const nu = await byLogin(P + 'NEWAG');
    check('SA post-renommage : page Agents OK + création d\'un agent OK', !!nu && nu.site_id === SITE && !cr.modalStillOpen, J({ cr, nu }));
    // présence : heartbeat à ~login+120 s doit porter le NOUVEAU login
    let pr: any = null;
    while (Date.now() - loginAt < 170000) { pr = await presence(ADM_SYNC); if (pr?.login === P + 'SA_R') break; await sleep(5000); }
    log('présence cloud SA =', J(pr), 'à +', Date.now() - loginAt, 'ms');
    log('INFO SA: ADMINISTRATEUR_SITE hors PRESENCE_ROLES (presence.service.ts:56) -> aucune présence attendue; couvert par OP');
    // scénario 3 : désactivation explicite du compte de la session après renommage
    const dirtyBefore = (await byId(idA)).is_dirty;
    const c1 = refreshCount();
    await cUpd(ADM_SYNC, { statut_actif: 0 });
    const ok = await waitRefresh(c1, 260000);
    const h2 = await hashUi(); const s2 = await snap(); const row2 = await byId(idA);
    log('SA après désactivation : tick', ok, h2, J(s2), J(row2));
    await shot(A, 'L20B-SA-apres-desactivation');
    const L2 = logText().slice(off);
    check('SC3 désactivation explicite : statut local 0, is_dirty inchangé', row2.statut_actif === 0 && row2.is_dirty === dirtyBefore, J({ row2, dirtyBefore }));
    check('SC3 session invalidée (fail-closed) : /login ou snapshot null', h2.includes('/login') || s2 === null, h2 + J(s2));
    check('SC3 main.log : disabled=true tracé', /disabled=true/.test(L2), '');
    check('SA aucun UNIQUE constraint', !/UNIQUE constraint failed/.test(L2), '');
  });

  test('AC — ADMIN_CENTRE renommé', async () => {
    const off = logText().length;
    const idA = (await byLogin(P + 'AC')).id_user;
    await cUpd(sync.AC, { login: P + 'AC_R' });
    const c0 = refreshCount();
    await fresh(P + 'AC');
    expect(await waitRefresh(c0, 60000)).toBe(true);
    const s1 = await snap(); const h1 = await hashUi(); const row = await byId(idA); const L = logText().slice(off);
    log('AC snapshot', J(s1), h1, J(row));
    check('AC session conservée, login renommé, statut 1', !h1.includes('/login') && s1?.login === P + 'AC_R' && row.statut_actif === 1 && row.login === P + 'AC_R', h1 + J({ s1, row }));
    check('AC rôle/site/centre effectifs inchangés', s1?.id_user === idA && s1.role === 'ADMIN_CENTRE' && s1.site_id === SITE && s1.centre_id === CENTRE, J(s1));
    check('AC main.log sans disabled=true/UNIQUE', !/disabled=true/.test(L) && !/UNIQUE constraint failed/.test(L), '');
    const cr = await A.window.evaluate(async (c) => { try { return await (window as any).api.users.create({ login: 'ZZTEST_L20B_NEWAG2', password: 'E2E_Test_Pwd_2026!', role: 'OPERATEUR_VERIFICATION', roles: ['OPERATEUR_VERIFICATION'], nom_user: 'ZZTEST_L20B_NEWAG2', prenom_user: 'x', site_id: 1, centre_id: c }); } catch (e: any) { return { ex: String(e.message).slice(0, 150) }; } }, CENTRE);
    const nu = await byLogin(P + 'NEWAG2');
    log('AC création agent =', J(cr), J(nu));
    await shot(A, 'L20B-AC-agents');
    check('AC post-renommage : création d\'un agent OK (centre de l\'AC)', !!nu && nu.centre_id === CENTRE, J({ cr, nu }));
  });

  test('DIS — renommage + désactivation cloud simultanés AVANT le tick (fail-closed)', async () => {
    const off = logText().length;
    const idA = (await byLogin(P + 'DIS')).id_user;
    await cUpd(sync.DIS, { login: P + 'DIS_R', statut_actif: 0 });
    const c0 = refreshCount();
    await fresh(P + 'DIS');
    const ok = await waitRefresh(c0, 60000);
    const h = await hashUi(); const s = await snap(); const row = await byId(idA); const L = logText().slice(off);
    log('DIS tick', ok, h, J(s), J(row));
    log('DIS lignes', J((L.match(/[^\n]*(UserSync|syncCurrentUserActiveStatus)[^\n]*/g) || []).slice(-6)));
    check('DIS (info) rename+désactivation simultanés : session coupée', h.includes('/login') || s === null, h + J(s) + J(row));
    check('DIS (info) statut local 0', row.statut_actif === 0, J(row));
  });

  test('DEL — compte supprimé (-1) et ligne absente pendant la session (scénario 5)', async () => {
    let idA = (await byLogin(P + 'DEL1')).id_user;
    let c0 = refreshCount();
    await fresh(P + 'DEL1');
    await sqlWrite(A, `UPDATE t_users SET statut_actif=-1, is_dirty=-1 WHERE id_user=${idA}`);
    expect(await waitRefresh(c0, 60000)).toBe(true);
    let h = await hashUi(); let s = await snap();
    log('DEL1 (-1)', h, J(s), J(await byId(idA)));
    check('SC5a compte -1 : session coupée', h.includes('/login') || s === null, h + J(s));
    idA = (await byLogin(P + 'DEL2')).id_user;
    c0 = refreshCount();
    await fresh(P + 'DEL2');
    const del = await sqlWrite(A, `DELETE FROM t_user_roles WHERE id_user=${idA}`).then(() => sqlWrite(A, `DELETE FROM t_users WHERE id_user=${idA}`)).catch((e) => ({ err: String(e.message).slice(0, 200) }));
    log('DEL2 suppression locale =', J(del), J(await sqlRead(A, `SELECT id_user FROM t_users WHERE id_user=${idA}`)));
    expect(await waitRefresh(c0, 60000)).toBe(true);
    h = await hashUi(); s = await snap();
    log('DEL2 (ligne absente)', h, J(s));
    check('SC5b ligne absente : session coupée', h.includes('/login') || s === null, h + J(s));
  });

  test('OP — OPERATEUR renommé + attaque : ancien login repris par un autre compte (scénarios 2 et 4)', async () => {
    const off = logText().length;
    const idA = (await byLogin(P + 'OP')).id_user;
    await cUpd(sync.OP, { login: P + 'OP_R' });
    const c0 = refreshCount();
    await fresh(P + 'OP');
    const loginAt = Date.now();
    expect(await waitRefresh(c0, 60000)).toBe(true);
    let s = await snap(); let h = await hashUi(); const row = await byId(idA);
    log('OP tick1', J(s), h, J(row));
    check('OP session conservée, login renommé, statut 1', !h.includes('/login') && s?.login === P + 'OP_R' && row.statut_actif === 1 && s.role === 'OPERATEUR_VERIFICATION', h + J({ s, row }));
    // ATTAQUE : un autre compte (ADMINISTRATEUR_SITE) reprend l'ancien login de A, cloud ET local
    const sB = uuid('ATK'); sync.ATK = sB;
    const insB = await supabaseDev.from('t_users').insert({ login: P + 'OP', password_hash: HASH, role: 'ADMINISTRATEUR_SITE', nom_user: 'ATK_NOM', prenom_user: 'P', statut_actif: 1, site_id: SITE, centre_id: null, sync_id: sB });
    log('cloud ATK insert =', insB.error?.message || 'ok');
    await supabaseDev.from('t_user_roles').insert({ user_sync_id: sB, role: 'ADMINISTRATEUR_SITE' });
    await sqlWrite(A, `INSERT INTO t_users (login,password_hash,role,nom_user,prenom_user,statut_actif,site_id,centre_id,sync_id,is_dirty) VALUES ('${P}OP','${HASH}','ADMINISTRATEUR_SITE','ATK_LOCAL','P',1,${SITE},NULL,'${sB}',0)`);
    const idB = (await byLogin(P + 'OP')).id_user;
    await sqlWrite(A, `INSERT INTO t_user_roles (id_user,role) VALUES (${idB},'ADMINISTRATEUR_SITE')`);
    log('ATK local idB =', idB, 'idA =', idA);
    const c1 = refreshCount();
    expect(await waitRefresh(c1, 260000)).toBe(true);
    s = await snap(); h = await hashUi();
    const rowA = await byId(idA); const rowB = await byId(idB); const L = logText().slice(off);
    log('OP après tick2 (attaque) : snapshot', J(s), h, 'A', J(rowA), 'B', J(rowB));
    log('lignes refresh', J((L.match(/refreshSecureCurrentUser —[^\n]*/g) || []).slice(-3)));
    check('ATK session de A conservée et suit A (id_user, login renommé)', !h.includes('/login') && s?.id_user === idA && s.login === P + 'OP_R', h + J(s));
    check('ATK la session n\'hérite PAS du rôle/site du nouveau compte', s?.role === 'OPERATEUR_VERIFICATION' && s.site_id === SITE && s.centre_id === CENTRE, J(s));
    check('ATK ligne de A inchangée (login renommé, rôle OP), ligne B intacte', rowA.login === P + 'OP_R' && rowA.role === 'OPERATEUR_VERIFICATION' && rowB.login === P + 'OP' && rowB.role === 'ADMINISTRATEUR_SITE' && rowB.sync_id === sB, J({ rowA, rowB }));
    const priv = await A.window.evaluate(async () => { try { await (window as any).api.users.create({ login: 'ZZTEST_L20B_PRIV', password: 'E2E_Test_Pwd_2026!', role: 'OPERATEUR_SAISIE', nom_user: 'ZZTEST_L20B_PRIV', prenom_user: 'x' }); return 'CREATED'; } catch (e: any) { return 'REFUSED:' + String(e.message).slice(0, 120); } });
    log('tentative users.create par la session de A =', priv, J(await byLogin(P + 'PRIV')));
    check('ATK appel admin (users.create) refusé pour la session de A', /REFUSED/.test(priv) && !(await byLogin(P + 'PRIV')), priv);
    // présence de A suit A (sync_id de A), pas B
    let pr: any = null;
    while (Date.now() - loginAt < 200000) { pr = await presence(sync.OP); if (pr?.login === P + 'OP_R') break; await sleep(5000); }
    const prB = await presence(sB);
    log('présence A =', J(pr), '| présence B =', J(prB));
    check('ATK présence de A écrite sous son sync_id avec le nouveau login ; aucune présence pour B', pr?.login === P + 'OP_R' && !prB, J({ pr, prB }));
    check('ATK/OP main.log sans UNIQUE', !/UNIQUE constraint failed/.test(L), '');
    await shot(A, 'L20B-OP-attaque');
  });

  test('MR — multi-rôles, rôle actif non primaire conservé + ancien login repris dans le cloud + rôle actif retiré (scénarios 2 et 5)', async () => {
    const off = logText().length;
    const idA = (await byLogin(P + 'MR')).id_user;
    await cUpd(sync.MR, { login: P + 'MR_R' });
    // ancien login repris dans le cloud AVANT le tick (concurrence rename / insertion)
    const sB = uuid('ATK2'); sync.ATK2 = sB;
    const insB = await supabaseDev.from('t_users').insert({ login: P + 'MR', password_hash: HASH, role: 'ADMINISTRATEUR_SITE', nom_user: 'ATK2_NOM', prenom_user: 'P', statut_actif: 1, site_id: SITE, centre_id: null, sync_id: sB });
    log('cloud ATK2 insert =', insB.error?.message || 'ok');
    await supabaseDev.from('t_user_roles').insert({ user_sync_id: sB, role: 'ADMINISTRATEUR_SITE' });
    const c0 = refreshCount();
    await fresh(P + 'MR');
    const sw = await A.window.evaluate(async () => (window as any).api.auth.setActiveRole('OPERATEUR_QUALITE'));
    log('setActiveRole =', J(sw), 'snapshot', J(await snap()));
    expect(await waitRefresh(c0, 60000)).toBe(true);
    let s = await snap(); let h = await hashUi(); const row = await byId(idA);
    log('MR après tick1', J(s), h, J(row), 'ATK2 local =', J(await sqlRead(A, `SELECT id_user,login,role,sync_id FROM t_users WHERE sync_id='${sB}'`)));
    const L1 = logText().slice(off);
    log('MR lignes', J((L1.match(/[^\n]*(ignoré|conflit|Login de la session|refreshSecureCurrentUser —)[^\n]*/g) || []).slice(-6)));
    check('MR session conservée, login renommé (ou aligné)', !h.includes('/login') && s?.id_user === idA, h + J(s));
    check('MR rôle actif non primaire CONSERVÉ après renommage (OPERATEUR_QUALITE)', s?.role === 'OPERATEUR_QUALITE', J(s));
    check('MR statut local 1', row.statut_actif === 1, J(row));
    check('MR session n\'a pas hérité d\'un rôle de l\'ancien login repris (pas ADMINISTRATEUR_SITE)', s?.role !== 'ADMINISTRATEUR_SITE', J(s));
    // scénario 5 : rôle actif retiré côté cloud pendant la session
    const c1 = refreshCount();
    await supabaseDev.from('t_user_roles').delete().eq('user_sync_id', sync.MR).eq('role', 'OPERATEUR_QUALITE');
    const ok = await waitRefresh(c1, 260000);
    h = await hashUi(); s = await snap();
    const L2 = logText().slice(off);
    log('MR après retrait du rôle actif : tick', ok, h, J(s), 'rôles locaux', J(await rolesOf(idA)));
    log('MR refresh', J((L2.match(/refreshSecureCurrentUser —[^\n]*/g) || []).slice(-2)));
    await shot(A, 'L20B-MR-role-retire');
    check('SC5c rôle actif retiré : session coupée (revoked)', h.includes('/login') || s === null, h + J(s));
    check('MR aucun UNIQUE', !/UNIQUE constraint failed/.test(L2), '');
  });

  test('OFF — connexion avec le NOUVEAU login après renommage ; ancien login refusé ; réseau coupé si émulable (scénario 6)', async () => {
    await dismissAlerts(A);
    if (!(await hashUi()).includes('/login')) { try { await logoutUi(A); } catch { /* */ } }
    let em = 'non émulé';
    try {
      await A.app.evaluate(({ session }) => { (session.defaultSession as any).enableNetworkEmulation({ offline: true }); });
      await sleep(15000);
      em = J(await A.window.evaluate(async () => { try { return (await (window as any).api.sync.getStatus()).state; } catch { return null; } }));
    } catch (e: any) { em = 'échec: ' + String(e.message).slice(0, 100); }
    log('état sync après émulation offline =', em);
    const rOld = await loginUi(A, P + 'AC', PWD, false);
    log('login ANCIEN AC =', J(rOld));
    check('OFF ancien login (AC, renommé) refusé', rOld.ok === false, J(rOld));
    const rNew = await loginUi(A, P + 'AC_R', PWD, false);
    const h = await hashUi();
    log('login NOUVEAU AC_R =', J(rNew), h, 'état réseau =', em);
    check('OFF login avec le NOUVEAU login OK (réseau : ' + em + ')', rNew.ok === true && !h.includes('/login'), J(rNew));
    try { await A.app.evaluate(({ session }) => { (session.defaultSession as any).enableNetworkEmulation({ offline: false }); }); } catch { /* */ }
    log('main.log UNIQUE total =', (logText().match(/UNIQUE constraint failed/g) || []).length);
    check('FIN aucun UNIQUE constraint dans toute la session de test', !/UNIQUE constraint failed/.test(logText()), '');
  });
});
