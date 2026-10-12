/**
 * QA terrain agent-13 - VALIDATION VIVANTE L2-3 (64a71eb) + L2-3b (17730ba), UI + Supabase DEV ajadkziqaskadlzboeqo
 * UNIQUEMENT (build dist-e2e-cloud). JAMAIS la production (itvyayakwgzvfqvdrgyv). Non commitee.
 */
import { test, expect } from '@playwright/test';
import { launchSeededApp, launchExistingApp, teardownSeededApp, type E2EEnvironment } from '../fixtures/electron-app';
import { supabaseDev, ensureCloudSiteAndCentre, E2E_CLOUD_SUPABASE_URL } from '../fixtures/supabase-dev-client';
import {
  sleep, sqlRead, sqlWrite, appLog, waitOnline, loginKey, loginUi, logoutUi, asAdmin, goAgents, setWindow1366, readAllRows, toasts,
  createAgentUI, pushLabel, shot, PWD, clickRowBtn, confirmDialog, dismissAlerts
} from './_agent13_agents_helpers';

const P = 'ZZTEST_L23_';
const log = (...a: any[]) => console.log('[L23]', ...a);
const J = (x: any) => JSON.stringify(x);
const noLic = (t: string[]) => t.filter((x) => !/LICENCE/.test(x));
const results: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail = '') => { results.push({ name, ok, detail }); log(ok ? 'PASS' : 'FAIL', name, detail); };
const SKIP = (process.env.L23_SKIP || '').split(',').filter(Boolean);
const TOAST_DEACT = /activité enregistrée.*désactivé à la place/;

test.describe.serial('QA terrain - L2-3 / L2-3b hardDelete agent (cloud dev)', () => {
  test.setTimeout(3_000_000);
  let A: E2EEnvironment; let failed = false;
  const createdCloudUserIds: number[] = [];

  const lu = async (login: string) => (await sqlRead(A, `SELECT id_user,login,statut_actif,is_dirty,sync_id,site_id,centre_id,role,nom_user FROM t_users WHERE login='${login}'`))[0];
  const cu = async (login: string) => (await supabaseDev.from('t_users').select('id_user,login,statut_actif,sync_id,nom_user,role').eq('login', login).maybeSingle()).data as any;
  const ob = async (syncId: string) => sqlRead(A, `SELECT id,table_name,operation,status,attempts,error_msg FROM t_outbox WHERE id='${syncId}' OR id LIKE '${syncId}\\_%' ESCAPE '\\'`);
  const obUsers = async (syncId: string) => (await ob(syncId)).filter((r: any) => r.table_name === 't_users');
  const auditRows = async (like: string) => sqlRead(A, `SELECT operator_id,action_type,details FROM audit_logs WHERE details LIKE '%${like}%' ORDER BY rowid DESC LIMIT 8`);
  const tlogsAudit = async (idUser: number) => sqlRead(A, `SELECT action,detail FROM t_logs WHERE detail LIKE '%"id_user":${idUser}%' OR detail LIKE '%ID ${idUser}%' ORDER BY id_log DESC LIMIT 5`);
  const delResp = async () => A.app.evaluate(() => (globalThis as any).__delResp || []);
  const mainLogHas = (needle: string) => appLog(A).split('\n').filter((l) => l.includes(needle));
  const outAny = async () => {
    if (await A.window.evaluate(() => location.hash.includes('/login'))) return;
    if (await A.window.evaluate(() => location.hash.includes('role-selector'))) { await A.window.getByRole('button', { name: /d[ée]connect/i }).last().click(); await A.window.waitForURL(/#\/login/, { timeout: 15000 }); return; }
    await logoutUi(A);
  };
  const step = async (name: string, fn: () => Promise<void>) => {
    try { await fn(); } catch (e: any) { check('ETAPE ' + name, false, String(e?.message || e).split('\n')[0].slice(0, 300)); try { await dismissAlerts(A); } catch { /* */ } }
  };
  const instrument = async () => A.app.evaluate(async () => {
    const g: any = globalThis; if (g.__fetchWrapped) return 'already';
    g.__fetchWrapped = true; g.__origFetch2 = g.fetch; g.__delResp = []; g.__delayDelete = 0; g.__qaOff = false;
    g.fetch = async (input: any, init: any) => {
      const url = typeof input === 'string' ? input : (input?.url || String(input));
      const method = String((init && init.method) || input?.method || 'GET').toUpperCase();
      const isUserDel = method === 'DELETE' && /\/rest\/v1\/t_users\?/.test(url);
      if (isUserDel && g.__delayDelete) await new Promise((r) => setTimeout(r, g.__delayDelete));
      if (g.__qaOff) throw new TypeError('fetch failed (QA offline)');
      const res = await g.__origFetch2(input, init);
      if (isUserDel) { try { g.__delResp.push({ url, status: res.status, body: await res.clone().text() }); } catch { /* */ } }
      return res;
    };
    return 'wrapped';
  });
  const offlineOn = async () => A.app.evaluate(async ({ session }) => { (globalThis as any).__qaOff = true; await session.defaultSession.setProxy({ proxyRules: 'http=127.0.0.1:9;https=127.0.0.1:9' }); });
  const offlineOff = async () => { await A.app.evaluate(async ({ session }) => { (globalThis as any).__qaOff = false; await session.defaultSession.setProxy({ mode: 'direct' }); }); };
  const mkAgent = async (suffix: string, centreId = 1) => {
    const login = P + suffix;
    await createAgentUI(A, { login, password: 'Mdp-' + suffix + '_2026', nom: 'L23' + suffix, roles: ['OPERATEUR_VERIFICATION'], centreId });
    return login;
  };
  const waitCloudUser = async (login: string, max = 40000) => {
    const t0 = Date.now(); let c: any = null;
    while (Date.now() - t0 < max) { c = await cu(login); if (c) break; await sleep(1500); }
    if (c) createdCloudUserIds.push(c.id_user);
    return c;
  };
  const waitUntil = async (fn: () => Promise<boolean>, max = 60000, step = 2000) => { const t0 = Date.now(); while (Date.now() - t0 < max) { if (await fn()) return true; await sleep(step); } return false; };
  const hardDeleteUI = async (login: string) => {
    await goAgents(A);
    await clickRowBtn(A, login, 'Supprimer définitivement');
    await sleep(300);
    const dlg = await A.window.locator('p:near(h3)').first().innerText().catch(() => '');
    const stop = Date.now();
    await A.window.locator('input[autocomplete="current-password"]').fill(PWD);
    await A.window.getByRole('button', { name: 'Confirmer' }).click();
    let t: string[] = [];
    for (let i = 0; i < 12; i++) { await sleep(250); t = noLic(await toasts(A)); if (t.length) break; }
    log('toasts hardDelete', login, J(t), 'dlg=', dlg.slice(0, 200), 'dt=', Date.now() - stop);
    return { t, dlg };
  };
  const insCardLocal = async (extra: string, vals: string, idUser?: number) => {
    const u = await lu(P + 'X');
    void u;
    await sqlWrite(A, `INSERT INTO t_cartes (noms,prenoms,statut,site_id,centre_id,sync_id,is_dirty${extra}) VALUES ('ZZTEST_L23_CARTE','X','EN STOCK',${A.seed.siteId},${A.seed.centreId},'zztest-l23-card-${Date.now()}-${Math.floor(Math.random() * 1e6)}',0${vals})`);
    void idUser;
  };
  const cardsCount = async () => (await sqlRead(A, `SELECT count(*) n FROM t_cartes WHERE noms='ZZTEST_L23_CARTE'`))[0].n;

  test.afterEach(async ({}, ti) => { if (ti.status !== ti.expectedStatus) failed = true; });
  test.afterAll(async () => {
    log(`BILAN: ${results.filter((r) => r.ok).length}/${results.length} OK`);
    for (const r of results.filter((x) => !x.ok)) log('ECHEC =>', r.name, r.detail);
    try {
      const { data: us } = await supabaseDev.from('t_users').select('id_user,sync_id,login').or('login.like.ZZTEST_%,login.like.E2E_%');
      const ids = (us || []).map((u: any) => u.id_user);
      log('CLEANUP users cloud a supprimer:', J((us || []).map((u: any) => u.login)));
      if (ids.length) {
        await supabaseDev.from('t_cartes').delete().in('created_by', ids);
        await supabaseDev.from('t_logs').delete().in('id_user', ids);
      }
      await supabaseDev.from('t_cartes').delete().like('noms', 'ZZTEST_%');
      await supabaseDev.from('t_logs').delete().like('login_user', 'ZZTEST_%');
      for (const u of us || []) {
        await supabaseDev.from('t_user_presence').delete().eq('user_sync_id', u.sync_id);
        await supabaseDev.from('t_user_roles').delete().eq('user_sync_id', u.sync_id);
      }
      for (const u of us || []) { const r = await supabaseDev.from('t_users').delete().eq('sync_id', u.sync_id); if (r.error) log('cleanup user echec', u.login, r.error.message); }
      await supabaseDev.from('t_centres').delete().ilike('nom', 'ZZTEST_%');
      await supabaseDev.from('t_sites').delete().ilike('nom', 'ZZTEST_%');
      const left = await supabaseDev.from('t_users').select('login').or('login.like.ZZTEST_%,login.like.E2E_%');
      const lc = await supabaseDev.from('t_cartes').select('sync_id').like('noms', 'ZZTEST_%');
      log('CLEANUP residuel cloud: users=' + J((left.data || []).map((x: any) => x.login)) + ' cartes=' + (lc.data || []).length);
    } catch (e) { console.error('[L23] cleanup echec', e); }
    if (A) try { await teardownSeededApp(A, failed); } catch { /* */ }
  });

  test('00 setup', async () => {
    expect(E2E_CLOUD_SUPABASE_URL).toContain('ajadkziqaskadlzboeqo');
    expect(E2E_CLOUD_SUPABASE_URL).not.toContain('itvyayakwgzvfqvdrgyv');
    A = await launchSeededApp({ allowRealSync: true });
    expect(await waitOnline(A)).toBe(true);
    log('dbPath A =', A.seed.dbPath, '| userData =', A.userDataDir);
    log('instrument fetch:', await instrument());
    await ensureCloudSiteAndCentre(A.seed.siteId, A.seed.centreId);
    for (const [id, n] of [[2, 'ZZTEST_QA_Centre2'], [3, 'ZZTEST_QA_Centre3']] as const) {
      const r = await supabaseDev.from('t_centres').upsert({ id, site_id: A.seed.siteId, nom: n, numero: id, sync_id: `zztest-l23-centre-${id}` }, { onConflict: 'id' });
      expect(r.error?.message).toBeUndefined();
    }
    const full = (await sqlRead(A, `SELECT * FROM t_users WHERE login='E2E_ADMINISTRATEUR_SITE'`))[0];
    const ins = await supabaseDev.from('t_users').insert({ login: full.login, password_hash: full.password_hash, role: full.role, nom_user: full.nom_user, prenom_user: full.prenom_user, statut_actif: 1, site_id: full.site_id, centre_id: null, sync_id: full.sync_id });
    expect(ins.error?.message).toBeUndefined();
    await loginKey(A, 'administrateurSite');
    log('pullCentres =', J(await A.window.evaluate(async (sid) => (window as any).api.hierarchy.pullCentres(sid), A.seed.siteId)));
    await setWindow1366(A);
    await goAgents(A);
  });

  test('S1 agent synchronise SANS activite -> deleted', async () => {
    test.skip(SKIP.includes('S1'));
    await step('S1', async () => {
      const login = await mkAgent('NOACT');
      const c0 = await waitCloudUser(login);
      check('S1 pre: agent present au cloud', !!c0, J(c0));
      const l0 = await lu(login);
      log('S1 local avant =', J(l0), '| outbox =', J(await obUsers(l0.sync_id)));
      const r = await hardDeleteUI(login);
      check('S1 toast habituel (suppression)', r.t.some((x) => /supprimé définitivement/.test(x)) && !r.t.some((x) => TOAST_DEACT.test(x)), J(r.t));
      await shot(A, 'L23-S1-apres');
      check('S1 disparu de la liste UI', (await readAllRows(A)).every((x) => x.login !== login), '');
      const gone = await waitUntil(async () => (await cu(login)) === null && !(await lu(login)), 30000);
      log('S1 local apres =', J(await lu(login)), '| cloud =', J(await cu(login)), '| outbox =', J(await obUsers(l0.sync_id)));
      check('S1 cloud supprime ET ligne locale purgee apres succes DELETE', gone, '');
      const ad = await auditRows(`ID: ${l0.id_user}`);
      log('S1 audit_logs =', J(ad));
      check('S1 audit [SUPPRESSION] journalise, aucun [DESACTIVATION]', ad.some((x: any) => /\[SUPPRESSION\]/.test(x.details)) && !ad.some((x: any) => /DESACTIVATION/.test(x.details)), '');
    });
  });

  test('S2 agent AVEC activite locale -> deactivated', async () => {
    const variants: Array<{ k: string; seed: (id: number, login: string) => Promise<void>; label: string }> = [
      { k: 'CARD', label: 'carte created_by=id local', seed: async (id) => insCardLocal(',created_by', `,${id}`) },
      { k: 'SAISIE', label: 'carte agent_saisie=login', seed: async (_id, login) => insCardLocal(',agent_saisie', `,'${login}'`) },
      { k: 'LOG', label: 'log non-LOGIN local', seed: async (id, login) => { await sqlWrite(A, `INSERT INTO t_logs (id_user,login_user,action,detail,site_id,sync_id,is_dirty) VALUES (${id},'${login}','ZZTEST_ACTION_METIER','qa l23',${A.seed.siteId},'zztest-l23-log-${Date.now()}',0)`); } }
    ];
    for (const v of variants) {
      await step('S2-' + v.k, async () => {
        await outAny(); await asAdmin(A); await goAgents(A);
        const login = await mkAgent('ACT' + v.k);
        const c0 = await waitCloudUser(login);
        const l0 = await lu(login);
        await v.seed(l0.id_user, login);
        const cards0 = await cardsCount();
        log(`S2-${v.k} (${v.label}) local avant =`, J(l0), 'cloud id=', c0?.id_user);
        const r = await hardDeleteUI(login);
        check(`S2-${v.k} toast desactivation`, r.t.some((x) => TOAST_DEACT.test(x)), J(r.t));
        await shot(A, 'L23-S2-' + v.k);
        let l = await lu(login);
        check(`S2-${v.k} local statut 0 (ligne conservee)`, !!l && l.statut_actif === 0, J(l));
        const rows = await readAllRows(A); const row = rows.find((x) => x.login === login);
        check(`S2-${v.k} reste visible (inactif) dans l'UI`, !!row, J(row && { statut: row.statut, buttons: row.buttons }));
        const synced = await waitUntil(async () => (await cu(login))?.statut_actif === 0 && (await lu(login)).is_dirty === 0, 40000);
        l = await lu(login);
        log(`S2-${v.k} apres: local=`, J(l), '| cloud=', J(await cu(login)), '| outbox users=', J(await obUsers(l.sync_id)));
        check(`S2-${v.k} cloud statut_actif=0 (UPDATE pousse), is_dirty=0`, synced, '');
        check(`S2-${v.k} aucun DELETE actif en outbox`, !(await obUsers(l.sync_id)).some((o: any) => o.operation === 'DELETE' && o.status !== 'SYNCED'), J(await obUsers(l.sync_id)));
        check(`S2-${v.k} cartes conservees`, (await cardsCount()) === cards0, `${cards0}->${await cardsCount()}`);
        const ad = await auditRows(`ID: ${l0.id_user}`); const ad2 = await auditRows(`ID ${l0.id_user}`);
        const tl = await tlogsAudit(l0.id_user);
        log(`S2-${v.k} audit_logs =`, J([...ad, ...ad2]), '| t_logs =', J(tl));
        check(`S2-${v.k} audit [DESACTIVATION] present, pas de [SUPPRESSION]`, ad.some((x: any) => /DESACTIVATION/.test(x.details)) && !ad.some((x: any) => /\[SUPPRESSION\]/.test(x.details)), '');
        // login refuse
        await outAny();
        const lr = await loginUi(A, login, 'Mdp-ACT' + v.k + '_2026', false);
        check(`S2-${v.k} connexion refusee`, lr.ok === false, J(lr));
        // reactivation
        await asAdmin(A); await goAgents(A);
        await clickRowBtn(A, login, 'Activer'); await confirmDialog(A, PWD);
        const re = await waitUntil(async () => (await lu(login)).statut_actif === 1 && (await cu(login))?.statut_actif === 1, 40000);
        check(`S2-${v.k} reactivation (bouton Activer) local + cloud`, re, J(await lu(login)) + J(await cu(login)));
      });
    }
  });

  test('S2d agent connecte une fois (LOGIN seul) puis supprime', async () => {
    test.skip(SKIP.includes('S2d'));
    await step('S2d', async () => {
      await outAny(); await asAdmin(A); await goAgents(A);
      const login = await mkAgent('LOGINONLY');
      await waitCloudUser(login);
      await outAny();
      const lr = await loginUi(A, login, 'Mdp-LOGINONLY_2026', false);
      log('S2d login agent =', J(lr));
      await sleep(8000); await outAny(); await asAdmin(A); await goAgents(A);
      const l0 = await lu(login);
      const logs = await sqlRead(A, `SELECT id_user,login_user,action FROM t_logs WHERE login_user='${login}' OR id_user=${l0.id_user}`);
      log('S2d logs locaux de l agent =', J(logs), '| cloud logs =', J((await supabaseDev.from('t_logs').select('id_user,login_user,action').eq('login_user', login)).data));
      const r = await hardDeleteUI(login);
      const gone = await waitUntil(async () => (await cu(login)) === null, 25000);
      const l = await lu(login); const c = await cu(login);
      log('S2d resultat: toasts=', J(r.t), 'local=', J(l), 'cloud=', J(c), 'delResp=', J(await delResp()));
      check('S2d (info) issue coherente: soit supprime partout, soit desactive local+cloud', (gone && !l) || (l?.statut_actif === 0 && c?.statut_actif === 0), J({ l, c }));
    });
  });

  test('S3 agent jamais synchronise (hors-ligne)', async () => {
    test.skip(SKIP.includes('S3'));
    await step('S3', async () => {
      await outAny(); await asAdmin(A); await goAgents(A);
      await offlineOn(); await sleep(1500);
      const a1 = await mkAgent('OFF_ACT'); const a2 = await mkAgent('OFF_NOACT');
      const l1 = await lu(a1); const l2 = await lu(a2);
      log('S3 locaux =', J([l1, l2]), '| outbox OFF_ACT =', J(await obUsers(l1.sync_id)), '| outbox OFF_NOACT =', J(await obUsers(l2.sync_id)));
      check('S3 pre: INSERT en attente pour les 2', (await obUsers(l1.sync_id)).some((o: any) => o.operation === 'INSERT' && o.status === 'PENDING') && (await obUsers(l2.sync_id)).some((o: any) => o.operation === 'INSERT' && o.status === 'PENDING'), '');
      await insCardLocal(',created_by', `,${l1.id_user}`);
      const r1 = await hardDeleteUI(a1);
      check('S3 avec activite: toast desactivation', r1.t.some((x) => TOAST_DEACT.test(x)), J(r1.t));
      const o1 = await obUsers(l1.sync_id);
      const ins = await sqlRead(A, `SELECT payload FROM t_outbox WHERE id='${l1.sync_id}'`);
      log('S3 OFF_ACT local =', J(await lu(a1)), '| outbox =', J(o1), '| payload =', ins[0]?.payload?.replace(/"password_hash":"[^"]+"/, '"password_hash":"***"'));
      check('S3 avec activite: INSERT conserve avec statut_actif 0', o1.length === 1 && o1[0].operation === 'INSERT' && (await lu(a1)).statut_actif === 0 && /"statut_actif":0/.test(ins[0]?.payload || ''), J(o1));
      const r2 = await hardDeleteUI(a2);
      check('S3 sans activite: toast suppression', r2.t.some((x) => /supprimé définitivement/.test(x)), J(r2.t));
      check('S3 sans activite: ligne locale physiquement supprimee, aucune entree t_users en outbox', !(await lu(a2)) && (await obUsers(l2.sync_id)).length === 0, J(await ob(l2.sync_id)));
      log('S3 outbox residuel (roles orphelins) OFF_NOACT =', J(await ob(l2.sync_id)));
      await offlineOff();
      expect(await waitOnline(A)).toBe(true);
      const ok = await waitUntil(async () => !!(await cu(a1)), 90000, 3000);
      const c1 = await cu(a1); if (c1) createdCloudUserIds.push(c1.id_user);
      log('S3 apres retour reseau: cloud OFF_ACT =', J(c1), '| cloud OFF_NOACT =', J(await cu(a2)), '| outbox OFF_ACT=', J(await obUsers(l1.sync_id)));
      await sleep(10000);
      log('S3 outbox OFF_NOACT apres retour reseau =', J(await ob(l2.sync_id)), '| outbox global non SYNCED =', J(await sqlRead(A, "SELECT table_name,operation,status,attempts,substr(error_msg,1,200) e FROM t_outbox WHERE status!='SYNCED'")));
      log('S3 outbox ERROR detail =', J(await sqlRead(A, "SELECT id,table_name,attempts,substr(payload,1,230) p,substr(error_msg,1,120) e FROM t_outbox WHERE status='ERROR' LIMIT 4")), '| t_users locaux =', J(await sqlRead(A, 'SELECT id_user,login FROM t_users')));
      check('S3 cloud: OFF_ACT cree avec statut_actif=0, OFF_NOACT jamais envoye', ok && c1?.statut_actif === 0 && (await cu(a2)) === null, J(c1));
    });
  });

  const cloudActivity = async (login: string, kind: 'log' | 'card') => {
    const c = await waitCloudUser(login);
    if (!c) throw new Error('agent absent du cloud ' + login);
    const tag = `${Date.now()}`;
    if (kind === 'log') {
      const r = await supabaseDev.from('t_logs').insert({ id_user: c.id_user, login_user: 'ZZTEST_CLOUD_ACTOR', action: 'ZZTEST_CLOUD_ACTION', detail: 'qa l23b', site_id: A.seed.siteId, sync_id: 'zztest-l23b-log-' + tag });
      if (r.error) throw new Error('insert cloud log: ' + r.error.message);
    } else {
      const r = await supabaseDev.from('t_cartes').insert({ sync_id: 'zztest-l23b-card-' + tag, noms: 'ZZTEST_L23B', prenoms: 'X', statut: 'EN STOCK', id_site: A.seed.siteId, id_centre: A.seed.centreId, created_by: c.id_user });
      if (r.error) throw new Error('insert cloud carte: ' + r.error.message);
    }
    return c;
  };

  test('S4 23503 reel : DELETE cloud refuse -> filet', async () => {
    test.skip(SKIP.includes('S4'));
    for (const kind of ['log', 'card'] as const) {
      await step('S4-' + kind, async () => {
        await outAny(); await asAdmin(A); await goAgents(A);
        const login = await mkAgent('FK' + kind.toUpperCase());
        const c = await cloudActivity(login, kind);
        const l0 = await lu(login);
        const nLocalAct = (await sqlRead(A, `SELECT (SELECT count(*) FROM t_cartes WHERE created_by=${l0.id_user}) a, (SELECT count(*) FROM t_logs WHERE (id_user=${l0.id_user} OR login_user='${login}') AND action<>'LOGIN') b`))[0];
        log(`S4-${kind} local id=${l0.id_user} cloud id=${c.id_user} activite locale=`, J(nLocalAct));
        check(`S4-${kind} pre: aucune activite locale (heuristique ne se declenche pas)`, nLocalAct.a === 0 && nLocalAct.b === 0, J(nLocalAct));
        const nResp0 = (await delResp()).length;
        const r = await hardDeleteUI(login);
        check(`S4-${kind} toast "supprime" (le main croit supprimer)`, r.t.some((x) => /supprimé définitivement/.test(x)), J(r.t));
        const filet = await waitUntil(async () => (await lu(login))?.statut_actif === 0, 40000, 1500);
        const resp = (await delResp()).slice(nResp0);
        log(`S4-${kind} REPONSE CLOUD DELETE t_users (brute) =`, J(resp));
        check(`S4-${kind} DELETE cloud reellement refuse 23503`, resp.some((x: any) => x.status === 409 && /23503/.test(x.body)), J(resp));
        const lg = mainLogHas('refusée (clé étrangère)');
        log(`S4-${kind} main.log filet =`, J(lg.slice(-2)));
        check(`S4-${kind} log "refusee (cle etrangere)" present`, lg.some((x) => x.includes(login)), J(lg.slice(-1)));
        check(`S4-${kind} local statut 0 apres filet`, filet, J(await lu(login)));
        const pushed = await waitUntil(async () => (await lu(login)).is_dirty === 0 && (await cu(login))?.statut_actif === 0, 40000, 1500);
        const l = await lu(login);
        log(`S4-${kind} final: local=`, J(l), '| cloud=', J(await cu(login)), '| outbox=', J(await obUsers(l.sync_id)));
        check(`S4-${kind} UPDATE envoye: is_dirty 0, cloud statut_actif=0, agent toujours present`, pushed, '');
        check(`S4-${kind} plus de DELETE actif; DELETE clos`, !(await obUsers(l.sync_id)).some((o: any) => o.operation === 'DELETE' && o.status !== 'SYNCED'), J(await obUsers(l.sync_id)));
        const ad = await auditRows(login);
        log(`S4-${kind} audit_logs =`, J(ad));
        check(`S4-${kind} audit [DESACTIVATION] (SYSTEM)`, ad.some((x: any) => /DESACTIVATION/.test(x.details)), '');
        await goAgents(A);
        check(`S4-${kind} visible dans l'UI (inactif)`, (await readAllRows(A)).some((x) => x.login === login), '');
        await shot(A, 'L23-S4-' + kind);
      });
    }
  });

  test('S4c pas de reactivation par le cycle de fond / redemarrage', async () => {
    test.skip(SKIP.includes('S4c'));
    await step('S4c', async () => {
      const logins = [P + 'FKLOG', P + 'FKCARD'];
      log('attente tick 3 min + pull (200 s) ...');
      await sleep(200_000);
      for (const lg of logins) check('S4c apres tick 3 min ' + lg + ' reste statut 0', (await lu(lg))?.statut_actif === 0 && (await cu(lg))?.statut_actif === 0, J(await lu(lg)));
      // pull explicite des agents (bouton Telecharger les agents)
      await goAgents(A);
      await A.window.getByRole('button', { name: /Télécharger les agents/ }).click(); await sleep(6000);
      for (const lg of logins) check('S4c apres Telecharger les agents ' + lg + ' reste statut 0', (await lu(lg))?.statut_actif === 0, J(await lu(lg)));
      // redemarrage
      await outAny();
      const pid = A.app.process().pid;
      await Promise.race([A.app.close().catch(() => {}), sleep(8000)]);
      try { if (pid) require('child_process').execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' }); } catch { /* deja ferme */ }
      await sleep(3000);
      const dir = A.userDataDir;
      let re: any; let lastErr: any;
      for (let k = 0; k < 4 && !re; k++) { try { re = await launchExistingApp(dir, { allowRealSync: true }); } catch (e) { lastErr = e; log('relance echec tentative', k, String((e as any).message).slice(0, 150)); await sleep(8000); } }
      if (!re) throw lastErr;
      A.app = re.app; A.window = re.window;
      await instrument();
      expect(await waitOnline(A)).toBe(true);
      await sleep(15000);
      for (const lg of logins) check('S4c apres redemarrage+preload ' + lg + ' reste statut 0', (await lu(lg))?.statut_actif === 0 && (await cu(lg))?.statut_actif === 0, J(await lu(lg)));
      await asAdmin(A); await setWindow1366(A); await goAgents(A);
      await sleep(20000);
      for (const lg of logins) check('S4c apres login admin + 20s ' + lg + ' reste statut 0', (await lu(lg))?.statut_actif === 0, J(await lu(lg)));
    });
  });

  test('S5 course : recreation pendant DELETE en attente / en vol', async () => {
    await step('S5a (DELETE en attente, hors-ligne)', async () => {
      await outAny(); await asAdmin(A); await goAgents(A);
      const login = await mkAgent('RACEA');
      const c = await cloudActivity(login, 'log');
      const l0 = await lu(login);
      await offlineOn(); await sleep(1500);
      const r = await hardDeleteUI(login);
      log('S5a apres delete offline: local=', J(await lu(login)), '| outbox=', J(await obUsers(l0.sync_id)));
      const rc = await A.window.evaluate(async (lg) => { try { await (window as any).api.users.create({ login: lg, password: 'Mdp-RACEA2_2026', nom_user: 'RECREE', prenom_user: 'A', roles: ['OPERATEUR_QUALITE'], centre_id: 1 }); return 'ok'; } catch (e: any) { return String(e.message || e); } }, login);
      log('S5a recreate =', rc, '| local=', J(await lu(login)), '| outbox=', J(await obUsers(l0.sync_id)));
      await offlineOff(); expect(await waitOnline(A)).toBe(true);
      { await goAgents(A); const b = A.window.getByRole('button', { name: /Envoyer vers le Cloud/ }); log('bouton push present =', await b.count(), J(await pushLabel(A))); if (await b.count()) { await b.first().click(); await sleep(3000); } }
      await waitUntil(async () => (await cu(login))?.nom_user === 'RECREE', 120000, 3000);
      const l = await lu(login);
      log('S5a final local=', J(l), '| cloud=', J(await cu(login)), '| outbox=', J(await obUsers(l0.sync_id)), '| delResp(derniers)=', J((await delResp()).slice(-2)));
      log('S5a main.log lignes sync_id =', J(mainLogHas(l0.sync_id).map((x) => x.slice(0, 230)).slice(-14)));
      check('S5a recree: local statut 1, nom RECREE', rc === 'ok' && l.statut_actif === 1 && l.nom_user === 'RECREE', J({ rc, l }));
      check('S5a cloud suit la recreation (statut 1, nom RECREE)', (await cu(login))?.statut_actif === 1 && (await cu(login))?.nom_user === 'RECREE', J(await cu(login)));
      void r; void c;
    });
    await step('S5a0 baseline: UPDATE hors-ligne simple (sans suppression)', async () => {
      await outAny(); await asAdmin(A); await goAgents(A);
      const login = await mkAgent('BASEL');
      await waitCloudUser(login);
      const l0 = await lu(login);
      await offlineOn(); await sleep(1500);
      const rr = await A.window.evaluate(async ([id]: [number]) => { try { await (window as any).api.users.update(id, { nom_user: 'BASELMOD' }); return 'ok'; } catch (e: any) { return String(e.message || e); } }, [l0.id_user] as [number]);
      await sleep(5000);
      log('S5a0 update offline =', rr, J(await obUsers(l0.sync_id)));
      await offlineOff(); expect(await waitOnline(A)).toBe(true);
      { await goAgents(A); const b = A.window.getByRole('button', { name: /Envoyer vers le Cloud/ }); log('bouton push present =', await b.count(), J(await pushLabel(A))); if (await b.count()) { await b.first().click(); await sleep(3000); } }
      const okb = await waitUntil(async () => (await cu(login))?.nom_user === 'BASELMOD', 120000, 3000);
      log('S5a0 apres retour reseau: cloud=', J(await cu(login)), '| outbox=', J(await obUsers(l0.sync_id)));
      check('S5a0 baseline: UPDATE hors-ligne pousse apres retour reseau (<120 s)', okb, '');
    });
    await step('S5b (DELETE en vol retarde 6 s, 23503 reel apres recreation)', async () => {
      await outAny(); await asAdmin(A); await goAgents(A);
      const login = await mkAgent('RACEB');
      await cloudActivity(login, 'log');
      const l0 = await lu(login);
      await A.app.evaluate(() => { (globalThis as any).__delayDelete = 6000; });
      const n0 = (await delResp()).length;
      const rc = await A.window.evaluate(async ([id, lg]: [number, string]) => {
        const out: any = {};
        try { out.del = await (window as any).api.users.hardDelete(id); } catch (e: any) { out.delErr = String(e.message || e); }
        await new Promise((r) => setTimeout(r, 1500));
        try { await (window as any).api.users.create({ login: lg, password: 'Mdp-RACEB2_2026', nom_user: 'RECREEB', prenom_user: 'B', roles: ['OPERATEUR_QUALITE'], centre_id: 1 }); out.create = 'ok'; } catch (e: any) { out.createErr = String(e.message || e); }
        return out;
      }, [l0.id_user, login] as [number, string]);
      log('S5b hardDelete/create =', J(rc), '| local juste apres recreation=', J(await lu(login)), '| outbox=', J(await obUsers(l0.sync_id)));
      await sleep(14000);
      await A.app.evaluate(() => { (globalThis as any).__delayDelete = 0; });
      const resp = (await delResp()).slice(n0);
      const l = await lu(login);
      log('S5b REPONSE DELETE =', J(resp), '| final local=', J(l), '| cloud=', J(await cu(login)), '| outbox=', J(await obUsers(l0.sync_id)));
      log('S5b main.log (filet / ligne plus en -1)=', J(mainLogHas("n'est plus en statut -1").slice(-2)));
      const ended = await waitUntil(async () => (await lu(login)).is_dirty === 0, 40000);
      const lf = await lu(login);
      check('S5b recreation OK malgre DELETE en vol', rc.create === 'ok', J(rc));
      check('S5b ligne recreee NON ecrasee (statut 1, nom RECREEB, pas desactivee)', lf.statut_actif === 1 && lf.nom_user === 'RECREEB', J(lf));
      check('S5b cloud: agent actif nom RECREEB', (await cu(login))?.statut_actif === 1 && (await cu(login))?.nom_user === 'RECREEB', J(await cu(login)) + ' ended=' + ended);
      check('S5b DELETE reellement refuse en 23503', resp.some((x: any) => /23503/.test(x.body)), J(resp));
    });
  });

  test('S6 non-regression : centre (outbox t_centres) + cartes', async () => {
    test.skip(SKIP.includes('S6'));
    await step('S6', async () => {
      const cen = (await sqlRead(A, `SELECT id,nom,sync_id FROM t_centres WHERE nom='ZZTEST_QA_Centre3'`))[0];
      log('S6 centre local =', J(cen));
      if (!cen) { check('S6 centre ZZTEST_QA_Centre3 pull', false, 'absent'); return; }
      const r = await A.window.evaluate(async (id) => { try { return { ok: true, v: await (window as any).api.hierarchy.deleteCentre(id) }; } catch (e: any) { return { ok: false, e: String(e.message || e) }; } }, cen.id);
      log('S6 deleteCentre =', J(r));
      await sleep(10000);
      const cc = (await supabaseDev.from('t_centres').select('id').eq('nom', 'ZZTEST_QA_Centre3')).data || [];
      const ob2 = await sqlRead(A, `SELECT table_name,operation,status,error_msg FROM t_outbox WHERE table_name='t_centres'`);
      log('S6 cloud centre apres =', J(cc), '| outbox t_centres =', J(ob2));
      check('S6 suppression centre: outbox t_centres traite sans filet agent', r.ok && !ob2.some((o: any) => o.status === 'PENDING') && !mainLogHasOther(), J({ r, cc, ob2 }));
    });
  });
  const mainLogHasOther = () => mainLogHas('Filet FK t_users en échec').length > 0;
});
