/**
 * QA terrain agent-13 — re-test VIVANT lots 1 / 1b sécurité des comptes agents (commits 60d850c, bae1b7b).
 * Phase 1 : attaques via IPC (window.api.users.*) sur base SQLite ISOLÉE, réseau COUPÉ
 * (GEST_IN_SITU_E2E_DISABLE_SYNC=1), build dist-e2e-cloud (code courant, Supabase DEV uniquement — jamais prod).
 * Chaque attaque : snapshot t_users/t_user_roles/t_outbox avant/après -> toute écriture partielle après refus est signalée.
 */
import { test } from '@playwright/test';
import { _electron as electron } from '@playwright/test';
import { mkdtempSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { runSeedInElectronNode } from '../fixtures/seed-runner';
import { teardownSeededApp, type E2EEnvironment } from '../fixtures/electron-app';
import { hashPassword } from '../../src/main/auth/local-auth';
import { sleep, sqlRead, sqlWrite, loginUi, logoutUi, goAgents, PWD, toasts, shot } from './_agent13_agents_helpers';

const MAIN = resolve(__dirname, '../../dist-e2e-cloud/main/index.js');
const log = (...a: any[]) => console.log('[SEC]', ...a);
const J = (x: any) => JSON.stringify(x);
const Q = (s: string) => `'${s.replace(/'/g, "''")}'`;

const results: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail = '') => { results.push({ name, ok, detail }); log(ok ? 'PASS' : 'FAIL', name, detail); };

test.describe.serial('QA terrain — sécurité comptes agents lots 1/1b (offline, base isolée)', () => {
  test.setTimeout(1_800_000);
  let E: E2EEnvironment; let S = 0; let C1 = 0; let C2 = 0; let S2 = 0; let C3 = 0; let failed = false;
  const HASH = hashPassword(PWD);

  const sql = (s: string) => sqlRead(E, s);
  const w = (s: string) => sqlWrite(E, s);
  const uid = async (login: string) => (await sql(`SELECT id_user FROM t_users WHERE login=${Q(login)}`))[0]?.id_user as number;
  const user = async (login: string) => (await sql(`SELECT id_user,login,role,nom_user,prenom_user,statut_actif,site_id,centre_id,sync_id,is_dirty,substr(password_hash,1,25) h FROM t_users WHERE login=${Q(login)}`))[0];
  const rolesOf = async (login: string) => (await sql(`SELECT r.role FROM t_user_roles r JOIN t_users u ON u.id_user=r.id_user WHERE u.login=${Q(login)} ORDER BY r.role`)).map((r: any) => r.role);
  const snap = async () => J([
    await sql(`SELECT id_user,login,role,nom_user,prenom_user,statut_actif,site_id,centre_id,sync_id,is_dirty,password_hash,updated_at FROM t_users ORDER BY id_user`),
    await sql(`SELECT id_user,role FROM t_user_roles ORDER BY id_user,role`),
    await sql(`SELECT id,table_name,operation,status FROM t_outbox WHERE table_name IN ('t_users','t_user_roles') ORDER BY id`)
  ]);
  const call = (fn: string, ...args: any[]) => E.window.evaluate(async ([f, a]: [string, any[]]) => {
    try { const r = await (window as any).api.users[f](...a); return { ok: true, val: r }; } catch (e: any) { return { ok: false, err: String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') }; }
  }, [fn, args] as [string, any[]]);
  const resetCall = (id: number) => E.window.evaluate(async (i) => {
    try { const r = await (window as any).api.users.resetAgentPassword(i); return { ok: true, val: { success: r.success, hasTemp: !!r.temporaryPassword } }; } catch (e: any) { return { ok: false, err: String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') }; }
  }, id);
  /** attaque attendue REFUSÉE : erreur + base strictement inchangée */
  const refused = async (name: string, fn: () => Promise<any>, errRe?: RegExp) => {
    const before = await snap(); const r = await fn(); const after = await snap();
    const unchanged = before === after;
    check(`REFUS ${name}`, r.ok === false && unchanged && (!errRe || errRe.test(r.err || '')), `${r.ok ? 'ACCEPTÉ !! ' + J(r.val) : 'err=' + J(r.err)} | base inchangée=${unchanged}`);
  };
  const allowed = async (name: string, fn: () => Promise<any>) => {
    const r = await fn(); check(`AUTORISÉ ${name}`, r.ok === true, r.ok ? J(r.val) : 'err=' + J(r.err)); return r;
  };
  const loginAs = async (login: string) => {
    const onLogin = await E.window.evaluate(() => location.hash.includes('/login'));
    if (!onLogin) { await E.window.evaluate(() => { window.location.hash = '#/login'; }); }
    // déconnexion propre si connecté
    if (!(await E.window.evaluate(() => location.hash.includes('/login')))) await logoutUi(E);
    await loginUi(E, login, PWD, true);
    await sleep(800);
  };
  const logoutIfIn = async () => { if (!(await E.window.evaluate(() => location.hash.includes('/login')))) await logoutUi(E); };
  const insUser = async (login: string, role: string, site: number, centre: number | null, statut = 1, extraRoles: string[] = [], dirty = 0) => {
    await w(`INSERT INTO t_users (login,password_hash,role,nom_user,prenom_user,statut_actif,site_id,centre_id,sync_id,is_dirty) VALUES (${Q(login)},${Q(HASH)},${Q(role)},'ZZTEST','FIX',${statut},${site},${centre ?? 'NULL'},${Q('zztest-sec-' + login)},${dirty})`);
    const id = await uid(login);
    for (const r of new Set([role, ...extraRoles])) await w(`INSERT INTO t_user_roles (id_user,role) VALUES (${id},${Q(r)})`);
    return id;
  };

  test.afterEach(async ({}, ti) => { if (ti.status !== ti.expectedStatus) failed = true; });
  test.afterAll(async () => {
    const pass = results.filter((r) => r.ok).length;
    log(`BILAN: ${pass}/${results.length} contrôles OK`);
    for (const r of results.filter((x) => !x.ok)) log('ECHEC =>', r.name, r.detail);
    if (E) try { await teardownSeededApp(E, failed); } catch { /* */ }
  });

  test('00 setup : base isolée + fixtures ZZTEST_ + lancement hors-ligne', async () => {
    const userDataDir = mkdtempSync(join(tmpdir(), 'gest-in-situ-e2e-'));
    const seed = await runSeedInElectronNode(userDataDir);
    log('dbPath isolé =', seed.dbPath);
    if (!existsSync(MAIN)) throw new Error('build e2e manquant');
    E = { app: null as any, window: null as any, userDataDir, seed };
    S = seed.siteId; C1 = seed.centreId;
    await w(`INSERT INTO t_centres (site_id,nom,numero,sync_id) VALUES (${S},'ZZTEST_C2',2,'zztest-sec-c2')`);
    C2 = (await sql(`SELECT id FROM t_centres WHERE sync_id='zztest-sec-c2'`))[0].id;
    await w(`INSERT INTO t_sites (nom,code,is_active,max_centres,is_permanent,sync_id) VALUES ('ZZTEST_SITE2','ZZTEST-S2',1,4,1,'zztest-sec-s2')`);
    S2 = (await sql(`SELECT id FROM t_sites WHERE sync_id='zztest-sec-s2'`))[0].id;
    await w(`INSERT INTO t_centres (site_id,nom,numero,sync_id) VALUES (${S2},'ZZTEST_C3',1,'zztest-sec-c3')`);
    C3 = (await sql(`SELECT id FROM t_centres WHERE sync_id='zztest-sec-c3'`))[0].id;
    log('ids S,C1,C2,S2,C3 =', S, C1, C2, S2, C3);
    await insUser('ZZTEST_OP1', 'OPERATEUR_SAISIE', S, C1);
    await insUser('ZZTEST_OP_C2', 'OPERATEUR_SAISIE', S, C2);
    await insUser('ZZTEST_ADMC_B', 'ADMIN_CENTRE', S, C1);
    await insUser('ZZTEST_OP_HIDDENSA', 'OPERATEUR_SAISIE', S, C1, 1, ['ADMINISTRATEUR_SITE']);
    await insUser('ZZTEST_SA_C1', 'OPERATEUR_SAISIE', S, C1, 1, ['SUPER ADMIN']);
    await insUser('ZZTEST_SA_MULTI', 'ADMINISTRATEUR_SITE', S, null, 1, ['SUPER ADMIN']);
    await insUser('ZZTEST_OTHER_SITE', 'OPERATEUR_SAISIE', S2, C3);
    await insUser('ZZTEST_ADMSITE_S2', 'ADMINISTRATEUR_SITE', S2, null);
    await insUser('ZZTEST_INACTIVE', 'OPERATEUR_SAISIE', S, C1, 0);
    await insUser('ZZTEST_Élodie', 'OPERATEUR_SAISIE', S, C1);
    await insUser('ZZTEST_DEL_S1', 'OPERATEUR_SAISIE', S, C1, -1, [], -1);
    await insUser('ZZTEST_DEL_CASE', 'OPERATEUR_SAISIE', S, C1, -1, [], -1);
    await insUser('ZZTEST_DEL_S2', 'OPERATEUR_SAISIE', S2, C3, -1, [], -1);
    await insUser('ZZTEST_DEL_EXSA', 'SUPER ADMIN', S, null, -1, [], -1);
    await insUser('ZZTEST_DEL_C1', 'OPERATEUR_SAISIE', S, C1, -1, [], -1);
    await insUser('ZZTEST_Amb', 'OPERATEUR_SAISIE', S, C1, -1, [], -1);
    await insUser('ZZTEST_AMB', 'OPERATEUR_SAISIE', S, C1, -1, [], -1);
    await insUser('ZZTEST_SA_TARGET2', 'OPERATEUR_SAISIE', S, C1); // cible simple pour contrôles positifs
    log('fixtures insérées:', (await sql(`SELECT count(*) n FROM t_users`))[0].n, 'users');
    // lancement hors-ligne sur le build e2e (Supabase DEV compilé), sync coupée
    const envv = { ...(process.env as Record<string, string>), GEST_IN_SITU_E2E_DISABLE_SYNC: '1' };
    const app = await electron.launch({ args: [MAIN, `--user-data-dir=${userDataDir}`], env: envv });
    let win: any = null;
    for (let i = 0; i < 240 && !win; i++) {
      win = app.windows().find((x) => { try { return !x.isClosed() && !x.url().includes('splash.html'); } catch { return false; } });
      if (!win) await sleep(500);
    }
    await win.waitForLoadState('domcontentloaded');
    E.app = app; E.window = win;
    log('userData =', userDataDir);
  });

  test('S1 ADMIN_CENTRE : création avec rôles interdits / rôle principal absent', async () => {
    await loginAs('E2E_ADMIN_CENTRE');
    // UI : la page /agents est-elle accessible à ADMIN_CENTRE ?
    await E.window.evaluate(() => { window.location.hash = '#/agents'; });
    await sleep(2000);
    const hdr = await E.window.getByRole('heading', { name: 'Gestion des Agents' }).count();
    log('S1 UI ADMIN_CENTRE sur #/agents : hash =', await E.window.evaluate(() => location.hash), '| page Gestion des Agents visible =', hdr);
    check('UI : ADMIN_CENTRE n’accède pas à la page Gestion des Agents', hdr === 0, '');
    await shot(E, 'SEC-S1-admincentre-route-agents');
    const base = { password: 'Mdp-Test_2026', nom_user: 'ZZTEST_SEC', prenom_user: 'X', centre_id: C1 };
    const mk = (login: string, extra: any) => () => call('create', { ...base, login, ...extra });
    await refused('AC crée SUPER ADMIN (roles)', mk('ZZTEST_N1', { roles: ['SUPER ADMIN'], role: 'SUPER ADMIN' }));
    await refused('AC crée SUPER ADMIN (roles seul)', mk('ZZTEST_N2', { roles: ['SUPER ADMIN'] }));
    await refused('AC crée SUPER ADMIN (role seul)', mk('ZZTEST_N3', { role: 'SUPER ADMIN' }));
    await refused('AC crée ADMINISTRATEUR_SITE', mk('ZZTEST_N4', { roles: ['ADMINISTRATEUR_SITE'], role: 'ADMINISTRATEUR_SITE' }));
    await refused('AC crée ADMIN_CENTRE', mk('ZZTEST_N5', { roles: ['ADMIN_CENTRE'], role: 'ADMIN_CENTRE' }));
    await refused('AC : roles OK + role principal SUPER ADMIN hors roles[]', mk('ZZTEST_N6', { roles: ['OPERATEUR_SAISIE'], role: 'SUPER ADMIN' }));
    await refused('AC : roles contient SUPER ADMIN en 2e position', mk('ZZTEST_N7', { roles: ['OPERATEUR_SAISIE', 'SUPER ADMIN'], role: 'OPERATEUR_SAISIE' }));
    await refused('AC : rôle principal absent de roles[] (QUALITE vs SAISIE)', mk('ZZTEST_N8', { roles: ['OPERATEUR_SAISIE'], role: 'OPERATEUR_QUALITE' }), /rôle principal/i);
    await refused('AC : roles vide', mk('ZZTEST_N9', { roles: [] }));
    await refused('AC : roles vide + role OP', mk('ZZTEST_N10', { roles: [], role: 'OPERATEUR_SAISIE' }));
    await refused('AC : roles chaîne', mk('ZZTEST_N11', { roles: 'SUPER ADMIN' }));
    await refused('AC : roles [nombre]', mk('ZZTEST_N12', { roles: [123] }));
    await refused('AC : role objet', mk('ZZTEST_N13', { role: { x: 1 } }));
    await refused('AC : rôle inconnu', mk('ZZTEST_N14', { roles: ['ROLE_BIDON'], role: 'ROLE_BIDON' }));
    // contrôle positif + cantonnement forcé site/centre
    const r = await allowed('AC crée OPERATEUR_SAISIE (site_id=S2 / centre_id=C2 injectés, doivent être ignorés)', mk('ZZTEST_AC_OK', { roles: ['OPERATEUR_SAISIE'], role: 'OPERATEUR_SAISIE', site_id: S2, centre_id: C2 }));
    const u = await user('ZZTEST_AC_OK');
    check('AC_OK forcé au site et au centre de l’appelant', u?.site_id === S && u?.centre_id === C1, J(u));
    log('S1 rôles AC_OK =', J(await rolesOf('ZZTEST_AC_OK')), 'outbox =', J(await sql(`SELECT id,operation FROM t_outbox WHERE id LIKE '%${u?.sync_id}%'`)));
    void r;
  });

  test('S1b ADMIN_SITE : création', async () => {
    await loginAs('E2E_ADMINISTRATEUR_SITE');
    const base = { password: 'Mdp-Test_2026', nom_user: 'ZZTEST_SEC', prenom_user: 'X', centre_id: C1 };
    const mk = (login: string, extra: any) => () => call('create', { ...base, login, ...extra });
    await refused('AS crée SUPER ADMIN', mk('ZZTEST_M1', { roles: ['SUPER ADMIN'], role: 'SUPER ADMIN' }));
    await refused('AS crée ADMINISTRATEUR_SITE', mk('ZZTEST_M2', { roles: ['ADMINISTRATEUR_SITE'], role: 'ADMINISTRATEUR_SITE' }));
    await refused('AS : role SUPER ADMIN hors roles[]', mk('ZZTEST_M3', { roles: ['OPERATEUR_SAISIE'], role: 'SUPER ADMIN' }));
    await refused('AS : rôle principal absent de roles[]', mk('ZZTEST_M4', { roles: ['OPERATEUR_SAISIE'], role: 'ADMIN_CENTRE' }));
    await refused('AS : centre d’un autre site', mk('ZZTEST_M5', { roles: ['OPERATEUR_SAISIE'], centre_id: C3 }));
    await allowed('AS crée ADMIN_CENTRE légitime', mk('ZZTEST_AS_ADMC', { roles: ['ADMIN_CENTRE'], role: 'ADMIN_CENTRE', site_id: S2 }));
    check('AS_ADMC site forcé au site de l’appelant', (await user('ZZTEST_AS_ADMC'))?.site_id === S, J(await user('ZZTEST_AS_ADMC')));
  });

  test('S2 login déjà existant (casse, NFC/NFD, espaces) + recréation de comptes supprimés', async () => {
    const base = { password: 'Mdp-Test_2026', nom_user: 'ZZTEST_DUP', prenom_user: 'X', centre_id: C1, roles: ['OPERATEUR_SAISIE'], role: 'OPERATEUR_SAISIE' };
    const mk = (login: any, extra: any = {}) => () => call('create', { ...base, login, ...extra });
    await loginAs('E2E_ADMINISTRATEUR_SITE');
    const dups: [string, any][] = [
      ['exact', 'E2E_OPERATEUR_SAISIE'], ['casse', 'e2e_operateur_saisie'], ['casse mixte', 'E2e_Operateur_Saisie'],
      ['espace fin', 'E2E_OPERATEUR_SAISIE '], ['espace début', ' E2E_OPERATEUR_SAISIE'], ['tab/espace', '\tE2E_OPERATEUR_SAISIE  '],
      ['NFD vs NFC', 'ZZTEST_Élodie'], ['majuscule accent', 'ZZTEST_ÉLODIE'], ['minuscule accent', 'zztest_élodie'],
      ['SUPER ADMIN existant', 'E2E_SUPER_ADMIN'], ['SUPER ADMIN casse', 'e2e_super_admin'], ['autre site', 'ZZTEST_OTHER_SITE'], ['autre site casse', 'zztest_other_site'],
      ['compte désactivé (0)', 'ZZTEST_INACTIVE'], ['compte désactivé casse', 'zztest_inactive'], ['son propre login', 'E2E_ADMINISTRATEUR_SITE']
    ];
    for (const [n, l] of dups) await refused(`création login existant: ${n}`, mk(l), /déjà utilisé/);
    await refused('login vide', mk(''));
    await refused('login espaces', mk('   '));
    await refused('login absent', mk(undefined));
    await refused('login nombre', mk(12345));
    // recréation d'un compte supprimé (-1)
    const before = await user('ZZTEST_DEL_S1');
    await allowed('AS recrée compte supprimé du même site (ZZTEST_DEL_S1)', mk('ZZTEST_DEL_S1', { nom_user: 'ZZTEST_RECREE' }));
    const after = await user('ZZTEST_DEL_S1');
    check('DEL_S1 réutilisé: statut 1, même id/sync_id, nom mis à jour', after?.statut_actif === 1 && after?.id_user === before?.id_user && after?.sync_id === before?.sync_id && after?.nom_user === 'ZZTEST_RECREE', J({ before, after }));
    check('DEL_S1 mot de passe remplacé', after?.h !== before?.h, '');
    await refused('AS recrée supprimé d’un AUTRE site (DEL_S2)', mk('ZZTEST_DEL_S2'), /déjà utilisé/);
    await refused('AS recrée ex-SUPER ADMIN supprimé (DEL_EXSA)', mk('ZZTEST_DEL_EXSA'), /déjà utilisé/);
    await refused('AS recrée ex-SUPER ADMIN supprimé (casse)', mk('zztest_del_exsa'), /déjà utilisé/);
    await refused('AS recrée DEL_S2 (casse)', mk('zztest_del_s2'), /déjà utilisé/);
    await refused('AS : login ambigu (2 lignes -1, casse nouvelle)', mk('zztest_amb'), /déjà utilisé/);
    await allowed('AS recrée DEL_CASE par variante de casse (réutilisation unique)', mk('zztest_del_case'));
    log('S2 DEL_CASE après =', J(await user('zztest_del_case')), J(await user('ZZTEST_DEL_CASE')));
    await allowed('AS recrée "ZZTEST_Amb" exact parmi 2 lignes -1', mk('ZZTEST_Amb'));
    log('S2 Amb/AMB après =', J(await sql(`SELECT login,statut_actif FROM t_users WHERE login LIKE 'ZZTEST_Amb' COLLATE NOCASE`)));
    // SUPER ADMIN : peut recréer
    await loginAs('E2E_SUPER_ADMIN');
    await allowed('SUPER ADMIN recrée l’ex-SUPER ADMIN supprimé', () => call('create', { ...base, login: 'ZZTEST_DEL_EXSA', site_id: S }));
    log('S2 DEL_EXSA après =', J(await user('ZZTEST_DEL_EXSA')), J(await rolesOf('ZZTEST_DEL_EXSA')));
    await allowed('SUPER ADMIN recrée DEL_S2 sur site S2', () => call('create', { ...base, login: 'ZZTEST_DEL_S2', site_id: S2, centre_id: C3 }));
    await refused('SUPER ADMIN: login existant (casse)', () => call('create', { ...base, login: 'E2E_super_ADMIN', site_id: S }), /déjà utilisé/);
    // ADMIN_CENTRE : -1 dans son centre/site OK, autres sites non
    await loginAs('E2E_ADMIN_CENTRE');
    await refused('AC recrée supprimé autre site', mk('ZZTEST_DEL_S2'), /déjà utilisé/);
    await refused('AC login existant casse', mk('E2E_ADMIN_CENTRE'.toLowerCase()), /déjà utilisé/);
  });

  test('S3 ADMIN_SITE / ADMIN_CENTRE visent un SUPER ADMIN (même site)', async () => {
    const sa = await uid('E2E_SUPER_ADMIN'); const saC1 = await uid('ZZTEST_SA_C1'); const saMulti = await uid('ZZTEST_SA_MULTI');
    log('S3 SA rattaché au même site ? ', J(await user('E2E_SUPER_ADMIN')));
    for (const who of ['E2E_ADMINISTRATEUR_SITE', 'E2E_ADMIN_CENTRE']) {
      await loginAs(who);
      for (const [lbl, id] of [['E2E_SUPER_ADMIN', sa], ['SA via t_user_roles C1', saC1], ['SA multi-rôle ADMIN_SITE', saMulti]] as const) {
        const tag = `${who.replace('E2E_', '')} -> ${lbl}`;
        await refused(`${tag}: update nom`, () => call('update', id, { nom_user: 'PIRATE' }));
        await refused(`${tag}: update statut_actif 0`, () => call('update', id, { statut_actif: 0 }));
        await refused(`${tag}: update roles OP`, () => call('update', id, { roles: ['OPERATEUR_SAISIE'] }));
        await refused(`${tag}: update password`, () => call('update', id, { password: 'Piratage_2026!' }));
        await refused(`${tag}: update login`, () => call('update', id, { login: 'ZZTEST_PIRATE' }));
        await refused(`${tag}: delete`, () => call('delete', id));
        await refused(`${tag}: hardDelete`, () => call('hardDelete', id));
        await refused(`${tag}: resetAgentPassword`, () => resetCall(id));
      }
    }
    await loginAs('E2E_SUPER_ADMIN');
    await allowed('contrôle: SUPER ADMIN modifie SA_C1 (nom)', () => call('update', saC1, { nom_user: 'MODIF_PAR_SA' }));
    await allowed('contrôle: SUPER ADMIN reset mot de passe SA_C1', () => resetCall(saC1));
  });

  test('S4 updateUser : statut, roles, password_hash, site, centre, ADMIN_CENTRE', async () => {
    await loginAs('E2E_ADMINISTRATEUR_SITE');
    const op = await uid('ZZTEST_OP1');
    for (const [n, v] of [['-1', -1], ['"0x1"', '0x1'], ['"1"', '1'], ['"0"', '0'], ['true', true], ['false', false], ['null', null], ['2', 2], ['0.5', 0.5], ['"-1"', '-1'], ['[1]', [1]], ['{}', {}], ['1e0 (num ok?)', 1.0000001]] as const)
      await refused(`AS update statut_actif=${n}`, () => call('update', op, { statut_actif: v }), /statut invalide/);
    await refused('AS update statut_actif=-1 avec nom (écriture partielle ?)', () => call('update', op, { statut_actif: -1, nom_user: 'PARTIEL' }));
    await allowed('contrôle AS update statut_actif=0', () => call('update', op, { statut_actif: 0 }));
    await allowed('contrôle AS update statut_actif=1', () => call('update', op, { statut_actif: 1 }));
    await refused('AS update roles []', () => call('update', op, { roles: [] }));
    await refused('AS update roles [] + nom', () => call('update', op, { roles: [], nom_user: 'PARTIEL2' }));
    await refused('AS update roles chaîne', () => call('update', op, { roles: 'SUPER ADMIN' }));
    await refused('AS update roles [SUPER ADMIN]', () => call('update', op, { roles: ['SUPER ADMIN'] }));
    await refused('AS update roles [ADMINISTRATEUR_SITE]', () => call('update', op, { roles: ['OPERATEUR_SAISIE', 'ADMINISTRATEUR_SITE'] }));
    await refused('AS update role=SUPER ADMIN seul', () => call('update', op, { role: 'SUPER ADMIN' }));
    await refused('AS update role=ROLE_BIDON via roles', () => call('update', op, { roles: ['ROLE_BIDON'] }));
    // password_hash fourni
    const h0 = (await user('ZZTEST_OP1')).h;
    const full0 = (await sql(`SELECT password_hash FROM t_users WHERE id_user=${op}`))[0].password_hash;
    const ob0 = (await sql(`SELECT count(*) n FROM t_outbox`))[0].n;
    const r = await call('update', op, { nom_user: 'ZZTEST_PH', password_hash: '$2a$10$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' });
    const full1 = (await sql(`SELECT password_hash FROM t_users WHERE id_user=${op}`))[0].password_hash;
    check('password_hash fourni par appelant IGNORÉ (hash inchangé)', full0 === full1, `ok=${r.ok} err=${r.err}`);
    const payloads = (await sql(`SELECT payload FROM t_outbox WHERE table_name='t_users'`)).map((x: any) => x.payload).join('');
    check('payload outbox ne contient pas le faux hash', !payloads.includes('AAAAAAAAAAAAAAAA'), '');
    void h0; void ob0;
    const r2 = await call('update', op, { password_hash: '$2a$10$BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB' });
    check('password_hash SEUL: hash inchangé', (await sql(`SELECT password_hash FROM t_users WHERE id_user=${op}`))[0].password_hash === full0, J(r2));
    // sync_id / is_dirty / id_user injectés
    const sy0 = (await user('ZZTEST_OP1')).sync_id;
    await call('update', op, { sync_id: 'hijack', is_dirty: 0, id_user: 99999, last_login: 'x', nom_user: 'ZZTEST_INJ' });
    check('sync_id/id_user injectés ignorés', (await user('ZZTEST_OP1')).sync_id === sy0 && (await user('ZZTEST_OP1')).id_user === op, '');
    // site
    await refused('AS update site_id=S2', () => call('update', op, { site_id: S2 }), /seul un SUPER ADMIN/);
    await refused('AS update site_id="S2" chaîne', () => call('update', op, { site_id: String(S2) }));
    await refused('AS update site_id=S2 + nom', () => call('update', op, { site_id: S2, nom_user: 'PARTIEL3' }));
    await allowed('AS update site_id = site actuel (ignoré)', () => call('update', op, { site_id: S }));
    // centre
    await refused('AS update centre hors site (C3)', () => call('update', op, { centre_id: C3 }), /n'appartient pas/);
    await refused('AS update centre inexistant', () => call('update', op, { centre_id: 99999 }));
    await refused('AS update centre "C3" chaîne', () => call('update', op, { centre_id: String(C3) }));
    await allowed('contrôle AS update centre C2', () => call('update', op, { centre_id: C2 }));
    await allowed('contrôle AS remet centre C1', () => call('update', op, { centre_id: C1 }));
    // cible hors site
    const other = await uid('ZZTEST_OTHER_SITE');
    await refused('AS update agent AUTRE site', () => call('update', other, { nom_user: 'X' }));
    await refused('AS delete agent AUTRE site', () => call('delete', other));
    await refused('AS hardDelete agent AUTRE site', () => call('hardDelete', other));
    await refused('AS reset mdp agent AUTRE site', () => resetCall(other));
    await refused('AS update id inexistant', () => call('update', 987654, { nom_user: 'X' }));
    // login
    await refused('AS update login -> login existant (casse)', () => call('update', op, { login: 'e2e_operateur_qualite' }), /déjà utilisé/);
    await refused('AS update login -> NFD d’un existant', () => call('update', op, { login: 'ZZTEST_ÉLODIE' }), /déjà utilisé/);
    await refused('AS update login -> login supprimé -1', () => call('update', op, { login: 'ZZTEST_DEL_S2' }), /déjà utilisé/);
    await refused('AS update login vide', () => call('update', op, { login: '   ' }));
    await allowed('AS update login avec espaces (trim attendu)', () => call('update', op, { login: '  ZZTEST_OP1  ' }));
    check('login normalisé trim', !!(await user('ZZTEST_OP1')), '');
    // cible supprimée (-1)
    const del1 = await uid('ZZTEST_DEL_C1');
    const rs = await call('update', del1, { statut_actif: 1 });
    log('S4 SONDE: AS réactive un compte supprimé -1 via update statut 1 ->', J(rs), J(await user('ZZTEST_DEL_C1')));
    check('SONDE compte -1 non ressuscitable par update', rs.ok === false, J(rs));
    // ADMIN_CENTRE
    await loginAs('E2E_ADMIN_CENTRE');
    const opc2 = await uid('ZZTEST_OP_C2'); const admcB = await uid('ZZTEST_ADMC_B'); const hid = await uid('ZZTEST_OP_HIDDENSA'); const admS = await uid('E2E_ADMINISTRATEUR_SITE');
    await refused('AC update agent d’un AUTRE centre', () => call('update', opc2, { nom_user: 'X' }));
    await refused('AC update agent d’un autre centre (statut)', () => call('update', opc2, { statut_actif: 0 }));
    await refused('AC update autre ADMIN_CENTRE', () => call('update', admcB, { nom_user: 'X' }));
    await refused('AC update ADMINISTRATEUR_SITE', () => call('update', admS, { nom_user: 'X' }));
    await refused('AC update ADMINISTRATEUR_SITE (password)', () => call('update', admS, { password: 'Piratage_2026!' }));
    await refused('AC update agent avec ADMINISTRATEUR_SITE additionnel', () => call('update', hid, { nom_user: 'X' }));
    await refused('AC update agent AUTRE site', () => call('update', other, { nom_user: 'X' }));
    await refused('AC déplace OP1 vers centre C2', () => call('update', op, { centre_id: C2 }), /rester dans votre centre/);
    await refused('AC déplace OP1 vers centre C3 (autre site)', () => call('update', op, { centre_id: C3 }));
    await refused('AC promeut OP1 ADMIN_CENTRE', () => call('update', op, { roles: ['ADMIN_CENTRE'] }));
    await refused('AC promeut OP1 ADMINISTRATEUR_SITE', () => call('update', op, { roles: ['ADMINISTRATEUR_SITE'] }));
    await refused('AC role=SUPER ADMIN', () => call('update', op, { role: 'SUPER ADMIN' }));
    await refused('AC site_id=S2', () => call('update', op, { site_id: S2 }));
    await refused('AC statut -1', () => call('update', op, { statut_actif: -1 }));
    await refused('AC statut "0x1"', () => call('update', op, { statut_actif: '0x1' }));
    await allowed('contrôle AC update OP1 (nom, centre C1)', () => call('update', op, { nom_user: 'ZZTEST_PAR_AC', centre_id: C1 }));
    await allowed('contrôle AC update OP1 centre_id null => forcé à C1', () => call('update', op, { centre_id: null }));
    check('OP1 reste dans C1 après centre_id null', (await user('ZZTEST_OP1')).centre_id === C1, J(await user('ZZTEST_OP1')));
    await allowed('contrôle AC désactive OP1 (statut 0)', () => call('update', op, { statut_actif: 0 }));
    await allowed('contrôle AC réactive OP1', () => call('update', op, { statut_actif: 1 }));
    const rs2 = await call('update', del1, { statut_actif: 1 });
    log('S4 SONDE: AC réactive un compte supprimé -1 de son centre ->', J(rs2), J(await user('ZZTEST_DEL_C1')));
    check('SONDE AC: compte -1 non ressuscitable', rs2.ok === false, J(rs2));
    // handlers réservés
    await refused('AC delete OP1 (handler)', () => call('delete', op));
    await refused('AC hardDelete OP1 (handler)', () => call('hardDelete', op));
    await refused('AC reset mdp OP1 (handler)', () => resetCall(op));
  });

  test('S5 auto-désactivation / auto-suppression / dernier administrateur', async () => {
    await loginAs('E2E_ADMINISTRATEUR_SITE');
    const me = await uid('E2E_ADMINISTRATEUR_SITE');
    // fixtures : retirer les autres administrateurs de site actifs du site (SA_MULTI, HIDDENSA) pour que E2E_ADMINISTRATEUR_SITE soit le DERNIER
    await w(`UPDATE t_users SET statut_actif=0 WHERE login IN ('ZZTEST_SA_MULTI','ZZTEST_OP_HIDDENSA')`);
    log('S5 admins de site actifs du site =', J(await sql(`SELECT u.login FROM t_users u WHERE u.site_id=${S} AND u.statut_actif=1 AND (u.role='ADMINISTRATEUR_SITE' OR EXISTS (SELECT 1 FROM t_user_roles r WHERE r.id_user=u.id_user AND r.role='ADMINISTRATEUR_SITE'))`)));
    await refused('AS s’auto-désactive (update statut 0)', () => call('update', me, { statut_actif: 0 }), /propre compte/);
    await refused('AS s’auto-désactive (delete)', () => call('delete', me), /propre compte/);
    await refused('AS s’auto-supprime (hardDelete)', () => call('hardDelete', me), /propre compte/);
    await refused('AS se retire ADMINISTRATEUR_SITE (dernier admin)', () => call('update', me, { roles: ['OPERATEUR_SAISIE'] }), /dernier administrateur/);
    await refused('AS: se retire le rôle avec ADMIN_CENTRE seul', () => call('update', me, { roles: ['ADMIN_CENTRE'] }), /dernier administrateur/);
    await allowed('AS garde ADMINISTRATEUR_SITE en changeant le nom', () => call('update', me, { nom_user: 'E2E', roles: ['ADMINISTRATEUR_SITE'] }));
    // second admin
    const adm2 = await insUser('ZZTEST_ADM2', 'ADMINISTRATEUR_SITE', S, null);
    await allowed('AS désactive un AUTRE admin de site (existe un autre admin actif)', () => call('update', adm2, { statut_actif: 0 }));
    await allowed('AS réactive ADM2', () => call('update', adm2, { statut_actif: 1 }));
    // cas dernier admin atteignable : ADM2 connecté, E2E admin rendu inactif par SQL
    await loginAs('ZZTEST_ADM2');
    await w(`UPDATE t_users SET statut_actif=0 WHERE id_user=${me}`);
    await refused('ADM2 (seul admin actif) se retire le rôle ADMINISTRATEUR_SITE', () => call('update', adm2, { roles: ['OPERATEUR_SAISIE'] }), /dernier administrateur/);
    await refused('ADM2 s’auto-désactive', () => call('delete', adm2), /propre compte/);
    await w(`UPDATE t_users SET statut_actif=1 WHERE id_user=${me}`);
    // SUPER ADMIN
    await loginAs('E2E_SUPER_ADMIN');
    const sa = await uid('E2E_SUPER_ADMIN');
    await refused('SUPER ADMIN s’auto-désactive (delete)', () => call('delete', sa), /propre compte/);
    await refused('SUPER ADMIN s’auto-désactive (update)', () => call('update', sa, { statut_actif: 0 }), /propre compte/);
    await refused('SUPER ADMIN s’auto-supprime', () => call('hardDelete', sa), /propre compte/);
    // SUPER ADMIN peut retirer/désactiver le dernier admin (choix documenté)
    await w(`UPDATE t_users SET statut_actif=0 WHERE id_user=${adm2}`);
    await allowed('SUPER ADMIN désactive le DERNIER admin actif du site (E2E_ADMINISTRATEUR_SITE)', () => call('delete', me));
    check('E2E_ADMINISTRATEUR_SITE désactivé par SA', (await user('E2E_ADMINISTRATEUR_SITE')).statut_actif === 0, '');
    await w(`UPDATE t_users SET statut_actif=1 WHERE id_user IN (${me},${adm2})`);
    // suppression définitive d'un agent sans cartes
    const del = await insUser('ZZTEST_TO_HARDDEL', 'OPERATEUR_SAISIE', S, C1);
    await loginAs('E2E_ADMINISTRATEUR_SITE');
    await allowed('AS hardDelete agent sans cartes', () => call('hardDelete', del));
    log('S5 après hardDelete =', J(await sql(`SELECT id_user,statut_actif,is_dirty FROM t_users WHERE login='ZZTEST_TO_HARDDEL'`)), 'roles', J(await sql(`SELECT * FROM t_user_roles WHERE id_user=${del}`)), 'outbox', J(await sql(`SELECT id,operation FROM t_outbox WHERE id LIKE '%TO_HARDDEL%'`)));
  });

  test('S6 bilan base + nettoyage', async () => {
    log('t_users final:', J(await sql(`SELECT login,role,statut_actif,site_id,centre_id,is_dirty FROM t_users WHERE login LIKE 'ZZTEST%' OR login LIKE 'zztest%' ORDER BY id_user`)));
    log('t_user_roles incohérents (role principal absent de t_user_roles):', J(await sql(`SELECT u.login,u.role FROM t_users u WHERE u.statut_actif=1 AND NOT EXISTS (SELECT 1 FROM t_user_roles r WHERE r.id_user=u.id_user AND r.role=u.role)`)));
    log('tmp password: aucune fuite, passages en dernière ligne');
    await logoutIfIn();
    // la base est jetable (mkdtemp) : supprimée par teardownSeededApp si tous les tests passent
    check('fin de session', true, 'base jetable ' + E.userDataDir);
  });
});
