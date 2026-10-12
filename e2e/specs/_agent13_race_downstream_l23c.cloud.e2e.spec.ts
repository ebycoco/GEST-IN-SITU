/**
 * QA terrain agent-13 - VALIDATION VIVANTE de 3ae07bc (course downstream/desactivation, garde "local plus recent que la lecture cloud").
 * UI + Supabase DEV ajadkziqaskadlzboeqo UNIQUEMENT (build dist-e2e-cloud, --mode e2e). JAMAIS la production (itvyayakwgzvfqvdrgyv). Non commitee.
 *
 * Instrument : wrapper fetch du main process qui execute la lecture cloud (GET t_users) IMMEDIATEMENT (le serveur repond avec
 * l'etat ANCIEN), puis GELE la reponse jusqu'a liberation par le test (equivalent d'une reponse lente / reordonnee).
 */
import { test, expect } from '@playwright/test';
import { launchSeededApp, teardownSeededApp, type E2EEnvironment } from '../fixtures/electron-app';
import { supabaseDev, ensureCloudSiteAndCentre, E2E_CLOUD_SUPABASE_URL } from '../fixtures/supabase-dev-client';
import {
  sleep, sqlRead, sqlWrite, appLog, waitOnline, loginUi, logoutUi, asAdmin, goAgents, setWindow1366, readAllRows, toasts,
  createAgentUI, shot, PWD, clickRowBtn, confirmDialog, dismissAlerts, openEdit, submitModal
} from './_agent13_agents_helpers';

const P = 'ZZTEST_RC_';
const log = (...a: any[]) => console.log('[RC]', ...a);
const J = (x: any) => JSON.stringify(x);
const noLic = (t: string[]) => t.filter((x) => !/LICENCE/.test(x));
const results: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail = '') => { results.push({ name, ok, detail }); log(ok ? 'PASS' : 'FAIL', name, detail); };
const ONLY = (process.env.RC_ONLY || '').split(',').filter(Boolean);
const run = (k: string) => ONLY.length === 0 || ONLY.includes(k);
const TOAST_DEACT = /activité enregistrée.*désactivé à la place/;
const RE_PULL = 'select=login,password_hash,role,nom_user,prenom_user,email,telephone';
const RE_BG = 'select=login,password_hash,role,nom_user,prenom_user,site_id,centre_id,sync_id,statut_actif&.*statut_actif=eq\\.1';
const tsMs = (s: string | null) => (s ? Date.parse(s.replace(' ', 'T') + 'Z') : NaN);
const utcSql = (ms: number) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);

test.describe.serial('QA terrain - 3ae07bc course downstream/desactivation (cloud dev)', () => {
  test.setTimeout(6_000_000);
  let A: E2EEnvironment; let failed = false;
  const bgAgents: string[] = [];
  const cycleStart = Date.now();

  const lu = async (login: string) => (await sqlRead(A, `SELECT id_user,login,statut_actif,is_dirty,sync_id,synced_at,nom_user,role FROM t_users WHERE login='${login}'`))[0];
  const cu = async (login: string) => (await supabaseDev.from('t_users').select('id_user,login,statut_actif,sync_id,nom_user,role').eq('login', login).maybeSingle()).data as any;
  const cuS = async (sync: string) => (await supabaseDev.from('t_users').select('id_user,login,statut_actif,sync_id,nom_user,role').eq('sync_id', sync).maybeSingle()).data as any;
  const obUsers = async (syncId: string) => (await sqlRead(A, `SELECT id,table_name,operation,status,attempts,error_msg FROM t_outbox WHERE (id='${syncId}' OR id LIKE '${syncId}\\_%' ESCAPE '\\') AND table_name='t_users'`));
  const logLines = (re: RegExp) => appLog(A).split('\n').filter((l) => re.test(l));
  const tickCount = () => (appLog(A).match(/Synchronisation des utilisateurs pour le site/g) || []).length;
  const waitUntil = async (fn: () => Promise<boolean>, max = 60000, st = 1500) => { const t0 = Date.now(); while (Date.now() - t0 < max) { if (await fn()) return true; await sleep(st); } return false; };
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
    g.__fetchWrapped = true; g.__origFetch2 = g.fetch; g.__delResp = []; g.__getLog = []; g.__fz = null;
    g.fetch = async (input: any, init: any) => {
      const url = typeof input === 'string' ? input : (input?.url || String(input));
      const method = String((init && init.method) || input?.method || 'GET').toUpperCase();
      const isUserGet = method === 'GET' && /\/rest\/v1\/t_users\?/.test(url);
      if (isUserGet) g.__getLog.push({ t: Date.now(), url: decodeURIComponent(url).slice(0, 260) });
      const fz = g.__fz;
      if (fz && fz.armed && isUserGet && new RegExp(fz.re).test(decodeURIComponent(url))) {
        fz.armed = false; fz.startedAt = Date.now(); fz.url = decodeURIComponent(url).slice(0, 260);
        const init2 = fz.dropSignal ? { ...(init || {}), signal: undefined } : init;
        const res = await g.__origFetch2(input, init2);
        let txt = ''; try { txt = await res.text(); fz.body = txt; } catch (e: any) { fz.bodyErr = String(e?.message || e); }
        fz.respondedAt = Date.now(); fz.status = res.status;
        const t0 = Date.now();
        while (!fz.release && Date.now() - t0 < fz.maxMs) await new Promise((r) => setTimeout(r, 100));
        fz.releasedAt = Date.now();
        return new g.Response(txt, { status: res.status, statusText: res.statusText, headers: res.headers });
      }
      const isUserDel = method === 'DELETE' && /\/rest\/v1\/t_users\?/.test(url);
      const res = await g.__origFetch2(input, init);
      if (isUserDel) { try { g.__delResp.push({ url, status: res.status, body: await res.clone().text() }); } catch { /* */ } }
      return res;
    };
    return 'wrapped';
  });
  const arm = (re: string, dropSignal: boolean, maxMs = 150000) => A.app.evaluate((_, a) => { (globalThis as any).__fz = { armed: true, re: a.re, dropSignal: a.dropSignal, maxMs: a.maxMs, release: false }; }, { re, dropSignal, maxMs });
  const release = () => A.app.evaluate(() => { const f = (globalThis as any).__fz; if (f) f.release = true; });
  const fzInfo = () => A.app.evaluate(() => { const f: any = (globalThis as any).__fz; return f ? { ...f, body: undefined, bodyLen: (f.body || '').length, bodyHasStatut1: undefined } : null; });
  const fzBody = () => A.app.evaluate(() => ((globalThis as any).__fz?.body || '') as string);
  const getLog = () => A.app.evaluate(() => (globalThis as any).__getLog as any[]);

  const mkAgent = async (suffix: string, centreId = 1) => {
    const login = P + suffix;
    await createAgentUI(A, { login, password: 'Mdp-' + suffix + '_2026', nom: 'RC' + suffix, roles: ['OPERATEUR_VERIFICATION'], centreId });
    return login;
  };
  const settledAgent = async (suffix: string) => {
    const login = await mkAgent(suffix);
    const ok = await waitUntil(async () => !!(await cu(login)) && (await lu(login))?.is_dirty === 0, 50000);
    await sleep(3500); // synced_at strictement anterieur (>1 s) a tout readAt ulterieur
    const l = await lu(login);
    log(`${suffix} pret: local=${J(l)} cloud=${J(await cu(login))} ok=${ok}`);
    return { login, l };
  };
  const hardDeleteUI = async (login: string) => {
    await goAgents(A);
    await clickRowBtn(A, login, 'Supprimer définitivement');
    await sleep(300);
    await A.window.locator('input[autocomplete="current-password"]').fill(PWD);
    await A.window.getByRole('button', { name: 'Confirmer' }).click();
    let t: string[] = [];
    for (let i = 0; i < 12; i++) { await sleep(250); t = noLic(await toasts(A)); if (t.length) break; }
    return t;
  };
  const insCardLocal = async (idUser: number) => sqlWrite(A, `INSERT INTO t_cartes (noms,prenoms,statut,site_id,centre_id,sync_id,is_dirty,created_by) VALUES ('ZZTEST_RC_CARTE','X','EN STOCK',${A.seed.siteId},${A.seed.centreId},'zztest-rc-card-${Date.now()}-${Math.floor(Math.random() * 1e6)}',0,${idUser})`);

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
      await supabaseDev.from('t_logs').delete().eq('site_id', 1);
      for (const u of us || []) {
        await supabaseDev.from('t_user_presence').delete().eq('user_sync_id', u.sync_id);
        await supabaseDev.from('t_user_roles').delete().eq('user_sync_id', u.sync_id);
      }
      for (const u of us || []) { const r = await supabaseDev.from('t_users').delete().eq('sync_id', u.sync_id); if (r.error) log('cleanup user echec', u.login, r.error.message); }
      await supabaseDev.from('t_users').delete().like('login', 'ZZTEST_%');
      await supabaseDev.from('t_centres').delete().ilike('nom', 'ZZTEST_%');
      await supabaseDev.from('t_sites').delete().ilike('nom', 'ZZTEST_%');
      const left = await supabaseDev.from('t_users').select('login').or('login.like.ZZTEST_%,login.like.E2E_%');
      const lc = await supabaseDev.from('t_cartes').select('sync_id').like('noms', 'ZZTEST_%');
      const ls = await supabaseDev.from('t_sites').select('id');
      const lce = await supabaseDev.from('t_centres').select('id');
      log('CLEANUP residuel cloud: users=' + J((left.data || []).map((x: any) => x.login)) + ' cartes=' + (lc.data || []).length + ' sites=' + (ls.data || []).length + ' centres=' + (lce.data || []).length);
    } catch (e) { console.error('[RC] cleanup echec', e); }
    if (A) try { await teardownSeededApp(A, failed); } catch { /* */ }
  });

  test('00 setup', async () => {
    expect(E2E_CLOUD_SUPABASE_URL).toContain('ajadkziqaskadlzboeqo');
    expect(E2E_CLOUD_SUPABASE_URL).not.toContain('itvyayakwgzvfqvdrgyv');
    A = await launchSeededApp({ allowRealSync: true });
    expect(await waitOnline(A)).toBe(true);
    log('dbPath A =', A.seed.dbPath, '| userData =', A.userDataDir, '| ref =', E2E_CLOUD_SUPABASE_URL);
    log('instrument fetch:', await instrument());
    await ensureCloudSiteAndCentre(A.seed.siteId, A.seed.centreId);
    const full = (await sqlRead(A, `SELECT * FROM t_users WHERE login='E2E_ADMINISTRATEUR_SITE'`))[0];
    await supabaseDev.from('t_users').delete().like('login', 'E2E_%');
    const ins = await supabaseDev.from('t_users').insert({ login: full.login, password_hash: full.password_hash, role: full.role, nom_user: full.nom_user, prenom_user: full.prenom_user, statut_actif: 1, site_id: full.site_id, centre_id: null, sync_id: full.sync_id });
    expect(ins.error?.message).toBeUndefined();
    await loginUi(A, 'E2E_ADMINISTRATEUR_SITE', PWD);
    await setWindow1366(A);
    await goAgents(A);
  });

  test('P0 sonde : URLs GET t_users du main (identification des lectures)', async () => {
    test.skip(!run('probe'));
    await step('probe', async () => {
      await A.window.getByRole('button', { name: /Télécharger les agents/ }).click(); await sleep(5000);
      await outAny(); await asAdmin(A); await sleep(14000);
      const gl = await getLog();
      log('GET t_users vus =', J(gl.map((x: any) => x.url)));
      check('P0 sonde: la requete du bouton pull ET celle du tick sont identifiables', gl.some((x) => new RegExp(RE_PULL).test(x.url)) && gl.some((x) => new RegExp(RE_BG).test(x.url)), '');
    });
  });

  /**
   * Course generique. mode: 'pull' (bouton "Telecharger les agents") | 'bg' (tick de fond, 10 s apres login).
   * how: 'deact' (bouton Desactiver) | 'harddel' (L2-3 : suppression d'un agent AVEC activite) | 'fk' (L2-3b : 23503 reel).
   */
  const race = async (mode: 'pull' | 'bg', how: 'deact' | 'harddel' | 'fk', opts: { dropSignal?: boolean; control?: boolean; hold?: number } = {}) => {
    const tag = `${mode.toUpperCase()}_${how.toUpperCase()}${opts.control ? '_CTRL' : ''}${opts.dropSignal === false ? '_SIG' : ''}`;
    await step('RACE ' + tag, async () => {
      const dropSignal = opts.dropSignal !== false;
      await outAny(); await asAdmin(A); await goAgents(A);
      const { login, l: l0 } = await settledAgent(tag);
      const pwd = 'Mdp-' + tag + '_2026';
      if (how === 'harddel') await insCardLocal(l0.id_user);
      if (how === 'fk') {
        const c = await cu(login);
        const r = await supabaseDev.from('t_logs').insert({ id_user: c.id_user, login_user: 'ZZTEST_CLOUD_ACTOR', action: 'ZZTEST_CLOUD_ACTION', detail: 'qa rc', site_id: A.seed.siteId, sync_id: 'zztest-rc-log-' + Date.now() });
        expect(r.error?.message).toBeUndefined();
      }
      const logStart = appLog(A).length;
      // --- 1) la lecture cloud demarre et recoit l'ANCIEN etat (statut 1), reponse gelee ---
      await arm(mode === 'pull' ? RE_PULL : RE_BG, dropSignal, opts.hold ?? 150000);
      if (mode === 'pull') {
        await goAgents(A);
        await A.window.getByRole('button', { name: /Télécharger les agents/ }).click();
      } else {
        await outAny(); await asAdmin(A); // timer UserSync demarre : tick a +10 s
      }
      const started = await waitUntil(async () => !!(await fzInfo())?.respondedAt, 60000, 400);
      const fz0: any = await fzInfo();
      const body = await fzBody();
      let stale: any = null; try { stale = (JSON.parse(body) as any[]).find((x) => x.login === login); } catch { /* */ }
      log(`${tag} lecture gelee: started=${started} url=${fz0?.url} bodyLen=${fz0?.bodyLen} etat vu pour ${login}=`, J(stale && { statut_actif: stale.statut_actif }));
      check(`${tag} pre: lecture cloud gelee avec ANCIEN etat (statut_actif=1)`, started && stale?.statut_actif === 1, J(fz0));
      const readAt = fz0.startedAt as number;
      // --- 2) desactivation par l'UI pendant le gel ---
      await goAgents(A);
      if (how === 'deact') {
        await clickRowBtn(A, login, 'Désactiver'); await confirmDialog(A, PWD);
      } else {
        const t = await hardDeleteUI(login);
        log(`${tag} toasts =`, J(t));
        if (how === 'harddel') check(`${tag} toast desactivation (L2-3)`, t.some((x) => TOAST_DEACT.test(x)), J(t));
        else check(`${tag} toast "supprime" (le main croit supprimer)`, t.some((x) => /supprimé définitivement/.test(x)), J(t));
      }
      const pushed = await waitUntil(async () => { const l = await lu(login); return l?.statut_actif === 0 && l.is_dirty === 0 && (await cu(login))?.statut_actif === 0; }, 90000, 1000);
      const l1 = await lu(login); const c1 = await cu(login); const ob1 = await obUsers(l1.sync_id);
      log(`${tag} apres push (gel toujours actif): local=${J(l1)} cloud=${J(c1)} outbox=${J(ob1)} | readAt=${new Date(readAt).toISOString()} synced_at=${l1.synced_at}`);
      check(`${tag} desactivation poussee pendant le gel: cloud 0, local 0, is_dirty 0`, pushed, J({ l1, c1 }));
      check(`${tag} synced_at >= debut de lecture (seconde) => condition de course reelle`, tsMs(l1.synced_at) >= Math.floor(readAt / 1000) * 1000, `${l1.synced_at} vs ${new Date(readAt).toISOString()}`);
      if (how === 'fk') {
        const dr = await A.app.evaluate(() => (globalThis as any).__delResp as any[]);
        check(`${tag} DELETE cloud reellement refuse 23503`, dr.some((x: any) => x.status === 409 && /23503/.test(x.body)), J(dr.slice(-1)));
      }
      check(`${tag} outbox SYNCED (aucun PENDING/ERROR)`, ob1.length > 0 && ob1.every((o: any) => o.status === 'SYNCED' || o.operation === 'DELETE'), J(ob1));
      // --- 3) connexion refusee PENDANT le gel ---
      await outAny();
      const lr1 = await loginUi(A, login, pwd, false);
      check(`${tag} connexion agent REFUSEE pendant le gel`, lr1.ok === false, J(lr1));
      if (opts.control) {
        // temoin positif : sans la garde (synced_at ancien), la lecture perimee DOIT reecrire statut 1 -> l'instrument reproduit bien la course
        await sqlWrite(A, `UPDATE t_users SET synced_at='2000-01-01 00:00:00' WHERE login='${login}'`);
      }
      await asAdmin(A);
      // --- 4) liberation de la lecture perimee ---
      const logsBefore = opts.hold ? logStart : appLog(A).length;
      await release();
      const done = await waitUntil(async () => {
        const seg = appLog(A).slice(logsBefore);
        return mode === 'pull' ? /\[pullAgentsFromCloud\] Site \d+ : \{/.test(seg) : /Downstream: (Aucun nouveau compte|\d+ utilisateur)|\[syncUsersFromCloud\] Site \d+ :|timeout for site|Downstream error on syncUsersFromCloud/.test(seg);
      }, 40000, 500);
      await sleep(2500);
      const seg = appLog(A).slice(logsBefore).split('\n').filter((x) => /pullAgentsFromCloud|syncUsersFromCloud|Downstream: |users-sync.helper|timeout/.test(x));
      const l2 = await lu(login); const c2 = await cu(login);
      const fz1: any = await fzInfo();
      log(`${tag} APRES liberation (done=${done}, gel ${fz1?.releasedAt - fz1?.startedAt} ms): local=${J(l2)} cloud=${J(c2)}`);
      log(`${tag} lignes main.log post-liberation =`, J(seg.map((x) => x.slice(0, 260))));
      if (opts.control) {
        check(`${tag} TEMOIN: sans garde (synced_at ancien) la lecture perimee reecrit statut 1 (course reproduite)`, l2.statut_actif === 1 && c2.statut_actif === 0, J({ l2, c2 }));
        return;
      }
      check(`${tag} SQLite reste a statut 0 (pas de reecriture a 1)`, l2.statut_actif === 0 && c2?.statut_actif === 0, J({ l2, c2 }));
      check(`${tag} is_dirty 0 inchange, aucun nouvel outbox PENDING`, l2.is_dirty === 0 && !(await obUsers(l2.sync_id)).some((o: any) => o.status !== 'SYNCED'), J(await obUsers(l2.sync_id)));
      const skippedLine = seg.some((x) => /"skipped_dirty":1/.test(x) || /skipped_dirty":[1-9]/.test(x));
      check(`${tag} resume log: skipped_dirty >= 1 (ligne ignoree)`, skippedLine, J(seg.map((x) => x.slice(0, 200))));
      log(`${tag} (info) raison "local plus recent" journalisee en clair = ${seg.some((x) => /local plus récent/.test(x))} (seul le compteur skipped_dirty est logge)`);
      // UI coherente
      await goAgents(A);
      const row = (await readAllRows(A)).find((x) => x.login === login);
      log(`${tag} UI row =`, J(row && { statut: row.statut, buttons: row.buttons }));
      check(`${tag} UI coherente: agent inactif, bouton Activer propose`, !!row && /inactif|d[ée]sactiv/i.test(row.statut + '') || (!!row && row.buttons.includes('Activer')), J(row));
      await shot(A, 'RC-' + tag);
      // --- 5) connexion refusee APRES liberation ---
      await outAny();
      const lr2 = await loginUi(A, login, pwd, false);
      check(`${tag} connexion agent REFUSEE apres liberation`, lr2.ok === false, J(lr2));
      await asAdmin(A);
      if (mode === 'bg') bgAgents.push(login);
      else {
        // pull suivant (non gele) : reste 0
        await goAgents(A); await A.app.evaluate(() => { (globalThis as any).__fz = null; });
        await A.window.getByRole('button', { name: /Télécharger les agents/ }).click(); await sleep(6000);
        const l3 = await lu(login);
        check(`${tag} pull suivant (non gele): reste statut 0`, l3.statut_actif === 0 && (await cu(login))?.statut_actif === 0, J(l3));
      }
      void logStart;
    });
  };

  // ===== SCENARIO 1 =====
  test('S1a course pullAgents x Desactiver (UI)', async () => { test.skip(!run('S1a')); await race('pull', 'deact'); });
  test('S1b course pullAgents x TEMOIN positif (synced_at antidate)', async () => { test.skip(!run('S1b')); await race('pull', 'deact', { control: true }); });
  test('S1c course pullAgents x L2-3 (suppression avec activite)', async () => { test.skip(!run('S1c')); await race('pull', 'harddel'); });
  test('S1d course pullAgents x L2-3b (23503 reel)', async () => { test.skip(!run('S1d')); await race('pull', 'fk'); });
  test('S1e course cycle de fond x Desactiver (UI)', async () => { test.skip(!run('S1e')); await race('bg', 'deact'); });
  test('S1f course cycle de fond x L2-3', async () => { test.skip(!run('S1f')); await race('bg', 'harddel'); });
  test('S1g course cycle de fond x L2-3b', async () => { test.skip(!run('S1g')); await race('bg', 'fk'); });
  test('S1h cycle de fond, signal 10 s conserve (fenetre realiste < 10 s)', async () => {
    test.skip(!run('S1h'));
    // ici on ne coupe PAS le signal d'abort : le gel est borne a 7 s. Le push doit etre quasi immediat ; resultat consigne tel quel.
    await race('bg', 'deact', { dropSignal: false, hold: 7000 });
  });

  test('S1z tick suivant : tous les agents du cycle de fond restent a 0', async () => {
    test.skip(!run('S1z') || false);
    await step('S1z', async () => {
      if (bgAgents.length === 0) { check('S1z (aucun agent bg)', true, 'rien a verifier'); return; }
      await A.app.evaluate(() => { (globalThis as any).__fz = null; });
      await outAny(); await asAdmin(A);
      const c0 = tickCount();
      const t0 = Date.now();
      // tick initial +10 s, puis +3 min : on attend 2 ticks supplementaires
      const ok = await waitUntil(async () => tickCount() >= c0 + 2, 230000, 3000);
      await sleep(6000);
      log(`S1z ${tickCount() - c0} ticks observes en ${Date.now() - t0} ms`);
      for (const lg of bgAgents) check(`S1z tick suivant ${lg}: local 0 / cloud 0`, (await lu(lg))?.statut_actif === 0 && (await cu(lg))?.statut_actif === 0, J(await lu(lg)));
      check('S1z 2 ticks supplementaires observes', ok, '');
    });
  });

  // ===== SCENARIO 2 : MAJ cloud legitime plus recente =====
  const legit = async (via: 'pull' | 'bg') => {
    await step('S2 ' + via, async () => {
      await outAny(); await asAdmin(A); await goAgents(A);
      const names = ['NOM', 'LOG', 'ROL'];
      const ag: Record<string, { login: string; l: any }> = {};
      for (const n of names) ag[n] = await settledAgent(`L${via.toUpperCase()}${n}`);
      // modification LOCALE recente (IPC users.update = meme chemin que la modale), envoyee au cloud
      for (const n of names) {
        const r = await A.window.evaluate(async ([id, nm]: [number, string]) => { try { await (window as any).api.users.update(id, { nom_user: nm }); return 'ok'; } catch (e: any) { return String(e?.message || e); } }, [ag[n].l.id_user, 'LOCALMOD' + n] as [number, string]);
        if (r !== 'ok') log('S2 update local err', r);
      }
      const pushed = await waitUntil(async () => { for (const n of names) { const l = await lu(ag[n].login); if (l.is_dirty !== 0 || (await cu(ag[n].login))?.nom_user !== 'LOCALMOD' + n) return false; } return true; }, 60000, 1000);
      check(`S2-${via} pre: modifications locales poussees`, pushed, '');
      const lastSync = Math.max(...(await Promise.all(names.map(async (n) => tsMs((await lu(ag[n].login)).synced_at)))));
      await sleep(3500);
      // mise a jour cloud (autre poste), plus recente que la derniere modification locale
      let t0 = 0;
      if (via === 'bg') {
        // caler juste apres un tick pour mesurer le pire cas (delai ~ intervalle)
        const c0 = tickCount();
        await outAny(); await asAdmin(A); // tick a +10 s
        await waitUntil(async () => tickCount() > c0, 40000, 500); await sleep(5000);
      }
      const cloudNew = { NOM: { nom_user: 'CLOUDNOM' }, LOG: { login: P + 'RENAMED_' + Date.now() % 100000 }, ROL: { role: 'OPERATEUR_QUALITE' } } as Record<string, any>;
      t0 = Date.now();
      for (const n of names) { const r = await supabaseDev.from('t_users').update(cloudNew[n]).eq('sync_id', ag[n].l.sync_id); if (r.error) log('cloud upd err', n, r.error.message); }
      if (via === 'pull') { await goAgents(A); await A.window.getByRole('button', { name: /Télécharger les agents/ }).click(); }
      const seen: Record<string, number> = {};
      const want = async (n: string) => {
        const row = (await sqlRead(A, `SELECT login,nom_user,role FROM t_users WHERE sync_id='${ag[n].l.sync_id}'`))[0];
        if (!row) return false;
        if (n === 'NOM') return row.nom_user === 'CLOUDNOM';
        if (n === 'LOG') return row.login === cloudNew.LOG.login;
        return row.role === 'OPERATEUR_QUALITE';
      };
      const tmax = via === 'pull' ? 40000 : 260000;
      while (Date.now() - t0 < tmax && Object.keys(seen).length < names.length) {
        for (const n of names) if (!(n in seen) && (await want(n))) seen[n] = Date.now() - t0;
        await sleep(1500);
      }
      log(`S2-${via} delais d'application (ms) =`, J(seen), '| dernier synced_at local avant =', new Date(lastSync).toISOString());
      for (const n of names) check(`S2-${via} MAJ cloud ${n} appliquee localement (delai ${seen[n] ?? 'jamais'} ms)`, n in seen, J(await lu(ag[n].login)));
      for (const n of names) {
        const l = (await sqlRead(A, `SELECT is_dirty,statut_actif FROM t_users WHERE sync_id='${ag[n].l.sync_id}'`))[0];
        if (l.is_dirty !== 0 || l.statut_actif !== 1) check(`S2-${via} ${n} etat local sain`, false, J(l));
      }
    });
  };
  test('S2a MAJ cloud legitime plus recente via pullAgents', async () => { test.skip(!run('S2a')); await legit('pull'); });
  test('S2b MAJ cloud legitime plus recente via cycle de fond', async () => { test.skip(!run('S2b')); await legit('bg'); });

  // ===== SCENARIO 3 : tolerance meme seconde =====
  test('S3 tolerance : synced_at dans la meme seconde que readAt', async () => {
    test.skip(!run('S3'));
    await step('S3a frontiere deterministe', async () => {
      await outAny(); await asAdmin(A); await goAgents(A);
      const { login, l } = await settledAgent('TOL');
      for (const k of ['EQ', 'PREV'] as const) {
        const nom = 'CLOUD_' + k;
        const r = await supabaseDev.from('t_users').update({ nom_user: nom }).eq('sync_id', l.sync_id);
        expect(r.error?.message).toBeUndefined();
        await A.app.evaluate(() => { (globalThis as any).__fz = null; });
        await arm(RE_PULL, true, 60000);
        await goAgents(A);
        await A.window.getByRole('button', { name: /Télécharger les agents/ }).click();
        await waitUntil(async () => !!(await fzInfo())?.respondedAt, 30000, 300);
        const readAt = ((await fzInfo()) as any).startedAt as number;
        const sec = Math.floor(readAt / 1000) * 1000;
        // EQ : synced_at = meme seconde que readAt ; PREV : une seconde plus tot
        await sqlWrite(A, `UPDATE t_users SET synced_at='${utcSql(k === 'EQ' ? sec : sec - 1000)}', is_dirty=0 WHERE login='${login}'`);
        await release(); await sleep(4000);
        const row = await lu(login);
        log(`S3a ${k}: readAt=${new Date(readAt).toISOString()} synced_at=${utcSql(k === 'EQ' ? sec : sec - 1000)} -> nom local=${row.nom_user}`);
        if (k === 'EQ') {
          check('S3a EQ: meme seconde => valeur cloud ignoree ce tick (tolerance)', row.nom_user !== nom, J(row));
          // tick suivant (nouvelle lecture >= 1 s plus tard, synced_at inchange) : appliquee
          await A.app.evaluate(() => { (globalThis as any).__fz = null; });
          await sleep(1500);
          const t1 = Date.now();
          await goAgents(A);
          await A.window.getByRole('button', { name: /Télécharger les agents/ }).click(); await sleep(5000);
          const row2 = await lu(login);
          check('S3a EQ: au pull suivant la valeur cloud legitime est appliquee (pas de blocage)', row2.nom_user === nom, J(row2) + ' delai<=' + (Date.now() - t1));
        } else {
          check('S3a PREV: synced_at une seconde plus tot => valeur cloud appliquee immediatement', row.nom_user === nom, J(row));
        }
      }
    });
    await step('S3b reel : modification -> push -> pull immediat (x6)', async () => {
      await outAny(); await asAdmin(A); await goAgents(A);
      const { login, l } = await settledAgent('TOLR');
      let applied = 0; const outcomes: string[] = [];
      for (let i = 0; i < 6; i++) {
        await A.app.evaluate(() => { (globalThis as any).__fz = null; });
        const lmod = 'LOCAL' + i, cnew = 'CLOUDNEWER' + i;
        await A.window.evaluate(async ([id, nm]: [number, string]) => { await (window as any).api.users.update(id, { nom_user: nm }); }, [l.id_user, lmod] as [number, string]);
        const t0 = Date.now();
        await waitUntil(async () => (await cu(login))?.nom_user === lmod, 30000, 250);
        const lloc = await lu(login);
        await supabaseDev.from('t_users').update({ nom_user: cnew }).eq('sync_id', l.sync_id);
        const pr = await A.window.evaluate(async (sid) => { const me = await (window as any).api.auth?.getCurrentUser?.(); const r1 = await (window as any).api.sync.pullAgents(sid, me); return r1; }, A.seed.siteId);
        const afterFirst = (await lu(login)).nom_user;
        let applied1 = afterFirst === cnew; let extraTries = 0;
        while (!applied1 && extraTries < 4) { await sleep(1200); extraTries++; await A.window.evaluate(async (sid) => { const me = await (window as any).api.auth?.getCurrentUser?.(); await (window as any).api.sync.pullAgents(sid, me); }, A.seed.siteId); applied1 = (await lu(login)).nom_user === cnew; }
        outcomes.push(`#${i}: synced_at=${lloc.synced_at} immediat=${afterFirst === cnew ? 'applique' : 'ignore(meme seconde)'} extraPulls=${extraTries} total=${Date.now() - t0}ms skipped=${J(pr.summary?.skipped_dirty)}`);
        if (applied1) applied++;
        await sleep(1500);
      }
      log('S3b outcomes =', J(outcomes));
      check('S3b reel: dans 6/6 cas la valeur cloud legitime plus recente finit appliquee (<= 4 pulls suivants)', applied === 6, J(outcomes));
    });
  });
});
