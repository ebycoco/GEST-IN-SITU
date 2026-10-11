/**
 * QA terrain agent-13 — NON-RÉGRESSION des flux légitimes après lots 1/1b (60d850c, bae1b7b), UI + Supabase DEV
 * ajadkziqaskadlzboeqo UNIQUEMENT (build dist-e2e-cloud). JAMAIS la production.
 * Poste A = ADMINISTRATEUR_SITE (UI), poste B = second poste du même site (téléchargement).
 */
import { test, expect } from '@playwright/test';
import { launchSeededApp, teardownSeededApp, type E2EEnvironment } from '../fixtures/electron-app';
import { supabaseDev, ensureCloudSiteAndCentre, E2E_CLOUD_SUPABASE_URL } from '../fixtures/supabase-dev-client';
import {
  sleep, sqlRead, waitOnline, loginKey, loginUi, logoutUi, asAdmin, goAgents, setWindow1366, readAllRows, toasts, pushLabel,
  createAgentUI, openNewModal, fillAgentForm, submitModal, shot, PWD, searchBox, openEdit, clickRowBtn, confirmDialog, dismissAlerts, setRoles
} from './_agent13_agents_helpers';

const P = 'ZZTEST_SEC_';
const log = (...a: any[]) => console.log('[LEG]', ...a);
const J = (x: any) => JSON.stringify(x);
const noLic = (t: string[]) => t.filter((x) => !/LICENCE/.test(x));
const results: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail = '') => { results.push({ name, ok, detail }); log(ok ? 'PASS' : 'FAIL', name, detail); };

test.describe.serial('QA terrain — flux légitimes agents après lots 1/1b (cloud dev)', () => {
  test.setTimeout(1_800_000);
  let A: E2EEnvironment; let B: E2EEnvironment; let failed = false;
  const lu = async (env: E2EEnvironment, login: string) => (await sqlRead(env, `SELECT id_user,login,role,nom_user,prenom_user,statut_actif,site_id,centre_id,sync_id,is_dirty,password_hash FROM t_users WHERE login='${login}'`))[0];
  const lr = async (env: E2EEnvironment, login: string) => (await sqlRead(env, `SELECT r.role FROM t_user_roles r JOIN t_users u ON u.id_user=r.id_user WHERE u.login='${login}' ORDER BY r.role`)).map((r: any) => r.role);
  const cu = async (login: string) => (await supabaseDev.from('t_users').select('login,role,nom_user,prenom_user,statut_actif,site_id,centre_id,sync_id,password_hash').eq('login', login).maybeSingle()).data as any;
  const cr = async (sync: string) => ((await supabaseDev.from('t_user_roles').select('role').eq('user_sync_id', sync)).data || []).map((r: any) => r.role).sort();
  const outboxPending = async (env: E2EEnvironment) => sqlRead(env, `SELECT table_name,operation,status,attempts,error_msg FROM t_outbox WHERE table_name IN ('t_users','t_user_roles') AND status!='SYNCED'`);
  const outAny = async (env: E2EEnvironment) => {
    if (await env.window.evaluate(() => location.hash.includes('/login'))) return;
    if (await env.window.evaluate(() => location.hash.includes('role-selector'))) { await env.window.getByRole('button', { name: /d[ée]connect/i }).last().click(); await env.window.waitForURL(/#\/login/, { timeout: 15000 }); return; }
    await logoutUi(env);
  };
  const step = async (name: string, fn: () => Promise<void>) => {
    try { await fn(); } catch (e: any) { check('ÉTAPE ' + name, false, String(e?.message || e).split('\n')[0].slice(0, 300)); for (const env of [A, B]) { try { if (env) await dismissAlerts(env); } catch { /* */ } } }
  };
  const counts = async () => (await Promise.all(['t_users', 't_user_roles', 't_user_presence', 't_logs', 't_cartes', 't_centres', 't_sites'].map(async (t) => `${t}=${(await supabaseDev.from(t).select('*', { count: 'exact', head: true })).count}`))).join(' ');

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
      await supabaseDev.from('t_centres').delete().ilike('nom', 'ZZTEST_%');
      await supabaseDev.from('t_sites').delete().ilike('nom', 'ZZTEST_%');
      log('CLEANUP résiduel cloud: ' + await counts());
    } catch (e) { console.error('[LEG] cleanup échec', e); }
    for (const e of [A, B]) { if (e) try { await teardownSeededApp(e, failed); } catch { /* */ } }
  });

  test('00 setup', async () => {
    expect(E2E_CLOUD_SUPABASE_URL).toContain('ajadkziqaskadlzboeqo');
    expect(E2E_CLOUD_SUPABASE_URL).not.toContain('itvyayakwgzvfqvdrgyv');
    log('état initial cloud dev:', await counts());
    A = await launchSeededApp({ allowRealSync: true });
    expect(await waitOnline(A)).toBe(true);
    log('dbPath A =', A.seed.dbPath);
    await ensureCloudSiteAndCentre(A.seed.siteId, A.seed.centreId);
    for (const [id, n] of [[2, 'ZZTEST_QA_Centre2'], [3, 'ZZTEST_QA_Centre3']] as const) {
      const r = await supabaseDev.from('t_centres').upsert({ id, site_id: A.seed.siteId, nom: n, numero: id, sync_id: `zztest-sec-centre-${id}` }, { onConflict: 'id' });
      expect(r.error?.message).toBeUndefined();
    }
    const full = (await sqlRead(A, `SELECT * FROM t_users WHERE login='E2E_ADMINISTRATEUR_SITE'`))[0];
    const ins = await supabaseDev.from('t_users').insert({ login: full.login, password_hash: full.password_hash, role: full.role, nom_user: full.nom_user, prenom_user: full.prenom_user, statut_actif: 1, site_id: full.site_id, centre_id: null, sync_id: full.sync_id });
    expect(ins.error?.message).toBeUndefined();
    await loginKey(A, 'administrateurSite');
    log('pullCentres A =', J(await A.window.evaluate(async (sid) => (window as any).api.hierarchy.pullCentres(sid), A.seed.siteId)));
    await setWindow1366(A);
    await goAgents(A);
  });

  test('L1 créer / refus doublon UI / modifier / désactiver / réactiver / reset mdp', async () => {
    let tmp = '';
    await step('création OK', async () => {
      const r = await createAgentUI(A, { login: P + 'OK', password: 'Mdp-OK_2026', nom: 'OKNOM', prenom: 'OKPRE', roles: ['OPERATEUR_VERIFICATION'], centreId: 1 });
      log('création toasts', J(noLic(r.toasts)));
      const l = await lu(A, P + 'OK');
      check('création OK : ligne locale + rôle (is_dirty déjà 0 si sync immédiate)', !!l && l.statut_actif === 1 && l.role === 'OPERATEUR_VERIFICATION' && l.centre_id === 1 && l.site_id === A.seed.siteId, J(l && { ...l, password_hash: undefined }));
      check('création OK : t_user_roles', J(await lr(A, P + 'OK')) === J(['OPERATEUR_VERIFICATION']), J(await lr(A, P + 'OK')));
      log('outbox en attente juste après =', J(await outboxPending(A)));
      await shot(A, 'SEC-L1-apres-creation');
    });
    await step('doublon via UI (casse + exact)', async () => {
      for (const lg of [P + 'OK', (P + 'OK').toLowerCase(), ' ' + P + 'OK ']) {
        await openNewModal(A);
        await fillAgentForm(A, { login: lg, password: 'Autre_mdp_99', nom: 'ECRASE', roles: ['OPERATEUR_QUALITE'], centreId: 2 });
        await submitModal(A);
        const t = noLic(await toasts(A));
        log(`doublon UI ${J(lg)} -> toasts`, J(t), 'modal ouvert =', await A.window.getByRole('heading', { name: /Nouvel Agent/ }).count());
        check(`doublon UI ${J(lg)} : message affiché`, t.some((x) => /déjà utilisé/.test(x)), J(t));
        await sleep(2500);
        if (await A.window.getByRole('heading', { name: /Nouvel Agent/ }).count()) { await A.window.getByRole('button', { name: 'Annuler' }).click(); await sleep(400); }
      }
      const l = await lu(A, P + 'OK');
      check('doublon UI : compte existant intact', l.nom_user === 'OKNOM' && l.role === 'OPERATEUR_VERIFICATION', J({ nom: l.nom_user, role: l.role }));
      const n = (await sqlRead(A, `SELECT count(*) n FROM t_users WHERE login LIKE '${P}OK%' COLLATE NOCASE`))[0].n;
      check('doublon UI : un seul compte', n === 1, 'n=' + n);
    });
    await step('envoi cloud + vérification Supabase dev', async () => {
      const lb = await pushLabel(A); log('bouton push =', J(lb));
      await sleep(7000);
      const c = await cu(P + 'OK');
      const l = await lu(A, P + 'OK');
      check('cloud: agent OK présent (role, nom, centre, site)', !!c && c.role === 'OPERATEUR_VERIFICATION' && c.nom_user === 'OKNOM' && c.centre_id === 1 && c.site_id === A.seed.siteId && c.sync_id === l.sync_id, J(c && { ...c, password_hash: undefined }));
      check('cloud: hash mdp = local', c?.password_hash === l.password_hash, '');
      check('cloud: t_user_roles', c ? J(await cr(c.sync_id)) === J(['OPERATEUR_VERIFICATION']) : false, c ? J(await cr(c.sync_id)) : 'absent');
      log('outbox restant =', J(await outboxPending(A)), '| is_dirty local =', (await lu(A, P + 'OK')).is_dirty);
    });
    await step('modifier (nom + rôles + centre)', async () => {
      await goAgents(A);
      await openEdit(A, P + 'OK');
      await A.window.getByPlaceholder('NOM DE FAMILLE').fill('OKMOD');
      await A.window.getByPlaceholder('Prénoms').fill('PREMOD');
      await setRoles(A.window, ['OPERATEUR_SAISIE', 'OPERATEUR_QUALITE']);
      await A.window.locator('select.form-select').selectOption('2');
      await submitModal(A);
      log('modif toasts', J(noLic(await toasts(A))));
      const l = await lu(A, P + 'OK'); const rr = await lr(A, P + 'OK');
      check('modif locale: nom, centre, rôles, rôle principal', l.nom_user === 'OKMOD' && l.centre_id === 2 && J(rr) === J(['OPERATEUR_QUALITE', 'OPERATEUR_SAISIE']), J({ nom: l.nom_user, centre: l.centre_id, role: l.role, rr }));
      check('modif: rôle principal ∈ t_user_roles', rr.includes(l.role), `role=${l.role} roles=${J(rr)}`);
      await sleep(7000);
      const c = await cu(P + 'OK');
      check('modif cloud', c?.nom_user === 'OKMOD' && c?.centre_id === 2 && J(await cr(c.sync_id)) === J(['OPERATEUR_QUALITE', 'OPERATEUR_SAISIE']), J(c && { ...c, password_hash: undefined }) + ' roles=' + (c ? J(await cr(c.sync_id)) : ''));
    });
    await step('désactiver puis réactiver', async () => {
      await goAgents(A);
      await clickRowBtn(A, P + 'OK', 'Désactiver'); await confirmDialog(A, PWD);
      log('désactiver toasts', J(noLic(await toasts(A))));
      check('désactivation locale statut 0', (await lu(A, P + 'OK')).statut_actif === 0, '');
      await sleep(6000);
      check('désactivation cloud statut 0', (await cu(P + 'OK'))?.statut_actif === 0, J((await cu(P + 'OK'))?.statut_actif));
      await outAny(A);
      const r = await loginUi(A, P + 'OK', 'Mdp-OK_2026', false);
      check('agent désactivé ne peut pas se connecter', r.ok === false, J(r));
      await asAdmin(A); await goAgents(A);
      await clickRowBtn(A, P + 'OK', 'Activer'); await confirmDialog(A, PWD);
      check('réactivation locale statut 1', (await lu(A, P + 'OK')).statut_actif === 1, '');
      await sleep(6000);
      check('réactivation cloud statut 1', (await cu(P + 'OK'))?.statut_actif === 1, '');
    });
    await step('reset mot de passe + connexion agent', async () => {
      await goAgents(A);
      const h0 = (await lu(A, P + 'OK')).password_hash;
      await clickRowBtn(A, P + 'OK', 'Réinitialiser le mot de passe'); await confirmDialog(A, PWD);
      const tt = noLic(await toasts(A)).join(' ');
      const m = /réinitialisé !\s*([A-Za-z0-9]{8})/.exec(tt);
      tmp = m?.[1] || '';
      log('reset toasts', tt.slice(0, 200));
      check('reset: mdp temporaire affiché + hash local changé', !!tmp && (await lu(A, P + 'OK')).password_hash !== h0, 'tmp ok=' + !!tmp);
      await sleep(7000);
      check('reset: hash cloud = local', (await cu(P + 'OK'))?.password_hash === (await lu(A, P + 'OK')).password_hash, '');
      await outAny(A);
      const old = await loginUi(A, P + 'OK', 'Mdp-OK_2026', false);
      check('reset: ancien mdp refusé', old.ok === false, J(old));
      const nw = await loginUi(A, P + 'OK', tmp || 'x', false);
      check('reset: connexion agent avec mdp temporaire', nw.ok === true, J(nw) + ' hash=' + await A.window.evaluate(() => location.hash));
      await sleep(1500); await outAny(A); await asAdmin(A); await goAgents(A);
    });
  });

  test('L2 connexion d’un agent créé, suppression définitive, téléchargement poste B', async () => {
    await step('créer DEL + agent à connecter', async () => {
      await goAgents(A);
      await createAgentUI(A, { login: P + 'DEL', password: 'Mdp-DEL_2026', nom: 'DELNOM', roles: ['OPERATEUR_VERIFICATION'], centreId: 1 });
      await createAgentUI(A, { login: P + 'LOGIN', password: 'Mdp-LOGIN_2026', nom: 'LOGNOM', roles: ['OPERATEUR_SAISIE'], centreId: 1 });
      await sleep(7000);
      check('DEL et LOGIN dans le cloud', !!(await cu(P + 'DEL')) && !!(await cu(P + 'LOGIN')), '');
    });
    await step('connexion de l’agent créé', async () => {
      await outAny(A);
      const r = await loginUi(A, P + 'LOGIN', 'Mdp-LOGIN_2026', false);
      check('connexion agent créé (OPERATEUR_SAISIE)', r.ok === true, J(r) + ' ' + await A.window.evaluate(() => location.hash));
      await sleep(1000); await outAny(A); await asAdmin(A); await goAgents(A);
    });
    await step('suppression définitive DEL', async () => {
      await clickRowBtn(A, P + 'DEL', 'Supprimer définitivement'); await confirmDialog(A, PWD);
      log('suppression toasts', J(noLic(await toasts(A))));
      await sleep(7000);
      const loc = await lu(A, P + 'DEL');
      check('suppression: plus visible dans la liste', (await readAllRows(A)).every((x) => x.login !== P + 'DEL'), '');
      log('local après suppression =', J(loc && { statut: loc.statut_actif, dirty: loc.is_dirty }), '| cloud =', J(await cu(P + 'DEL')), '| outbox restant =', J(await outboxPending(A)));
      check('suppression: absent du cloud', (await cu(P + 'DEL')) === null, J(await cu(P + 'DEL')));
      await searchBox(A, '');
    });
    await step('recréation du login supprimé (même site)', async () => {
      const r = await createAgentUI(A, { login: P + 'DEL', password: 'Mdp-DEL2_2026', nom: 'DELBIS', roles: ['OPERATEUR_QUALITE'], centreId: 2 });
      log('recréation toasts', J(noLic(r.toasts)));
      const l = await lu(A, P + 'DEL');
      check('recréation: compte actif, nouveau rôle', !!l && l.statut_actif === 1 && l.role === 'OPERATEUR_QUALITE', J(l && { ...l, password_hash: undefined }));
      await sleep(7000);
      check('recréation: cloud', (await cu(P + 'DEL'))?.nom_user === 'DELBIS', J((await cu(P + 'DEL'))?.nom_user));
    });
    await step('poste B : Télécharger les agents', async () => {
      B = await launchSeededApp({ allowRealSync: true });
      expect(await waitOnline(B)).toBe(true);
      await loginKey(B, 'administrateurSite'); await setWindow1366(B); await goAgents(B);
      log('B logins avant =', J((await readAllRows(B)).map((x) => x.login)));
      await B.window.getByRole('button', { name: /Télécharger les agents/ }).click(); await sleep(5000);
      const t = noLic(await toasts(B));
      log('B toasts téléchargement', J(t));
      const logins = (await readAllRows(B)).map((x) => x.login);
      log('B logins après =', J(logins));
      check('Télécharger les agents: sans erreur', !t.some((x) => /erreur|échec|impossible/i.test(x)), J(t));
      check('Télécharger les agents: agents du cloud présents sur B', [P + 'OK', P + 'LOGIN', P + 'DEL'].every((l) => logins.includes(l)), J(logins));
      const b = await lu(B, P + 'OK');
      check('B: OK identique au cloud (nom, rôles)', b?.nom_user === 'OKMOD' && J(await lr(B, P + 'OK')) === J(['OPERATEUR_QUALITE', 'OPERATEUR_SAISIE']), J(b && { n: b.nom_user, r: await lr(B, P + 'OK') }));
      await shot(B, 'SEC-L2-B-telechargement');
    });
  });

  test('L3 attaques IPC en ligne : aucune propagation cloud après refus', async () => {
    await step('AS cible un compte du cloud en ligne', async () => {
      const call = (fn: string, ...a: any[]) => A.window.evaluate(async ([f, args]: [string, any[]]) => { try { return { ok: true, v: await (window as any).api.users[f](...args) }; } catch (e: any) { return { ok: false, e: String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') }; } }, [fn, a] as [string, any[]]);
      const me = (await lu(A, 'E2E_ADMINISTRATEUR_SITE')).id_user;
      const before = J(await cu('E2E_ADMINISTRATEUR_SITE'));
      const r1 = await call('update', me, { statut_actif: 0 }); const r2 = await call('delete', me); const r3 = await call('hardDelete', me);
      check('en ligne: auto-désactivation/suppression refusées', !r1.ok && !r2.ok && !r3.ok, J([r1.e, r2.e, r3.e]));
      await sleep(6000);
      check('cloud inchangé pour l’admin après refus', J(await cu('E2E_ADMINISTRATEUR_SITE')) === before, '');
      const okid = (await lu(A, P + 'OK')).id_user;
      const r4 = await call('update', okid, { statut_actif: '0x1' }); const r5 = await call('update', okid, { statut_actif: -1 });
      const r6 = await call('create', { login: P + 'EVIL', password: 'Mdp-EVIL_2026', roles: ['OPERATEUR_SAISIE'], role: 'SUPER ADMIN', centre_id: 1 });
      check('en ligne: statut invalide / rôle principal hors roles[] refusés', !r4.ok && !r5.ok && !r6.ok, J([r4.e, r5.e, r6.e]));
      await sleep(5000);
      check('cloud: aucun compte EVIL', (await cu(P + 'EVIL')) === null, '');
      check('cloud: OK toujours actif', (await cu(P + 'OK'))?.statut_actif === 1, '');
      log('outbox en attente après attaques =', J(await outboxPending(A)));
    });
  });
});
