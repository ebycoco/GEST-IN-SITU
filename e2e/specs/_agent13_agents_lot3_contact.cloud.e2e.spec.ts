/**
 * QA terrain agent-13 — Lot 3 page Agents : contact bout en bout (3B), colonne Dernière co. cloud/local (3D), isolation.
 * Supabase DEV ajadkziqaskadlzboeqo UNIQUEMENT (jamais prod). Instance isolée (userData gest-in-situ-e2e-*).
 * Instrumentation main : fetch enveloppé (__qaWB = bloque les écritures non-GET -> outbox reste pending ; __qaOff = bloque tout),
 * compteur d'appels presence:getAgents (__pc).
 */
import { test, expect } from '@playwright/test';
import { join } from 'path';
import { launchSeededApp, teardownSeededApp, type E2EEnvironment } from '../fixtures/electron-app';
import { supabaseDev, ensureCloudSiteAndCentre, E2E_CLOUD_SUPABASE_URL } from '../fixtures/supabase-dev-client';
import { sleep, sqlRead, sqlWrite, waitOnline, loginKey, logoutUi, goAgents, setWindow1366, toasts, dismissAlerts, searchBox, confirmDialog, PWD, SHOT_DIR } from './_agent13_agents_helpers';

const P = 'ZZTEST_L3C_';
const log = (...a: any[]) => console.log('[L3C]', ...a);
const J = (x: any) => JSON.stringify(x);
const noLic = (t: string[]) => t.filter((x) => !/LICENCE/.test(x));

test.describe.serial('QA terrain — Lot 3 Agents : contact / Dernière co. (cloud dev)', () => {
  test.setTimeout(2_400_000);
  let A: E2EEnvironment; let failed = false;
  const shot = (n: string) => A.window.screenshot({ path: join(SHOT_DIR, `agent13-LOT3C-${n}.png`) });
  const step = async (n: string, fn: () => Promise<void>) => { try { await fn(); } catch (e: any) { log(`!! ÉTAPE EN ÉCHEC « ${n} » :`, String(e?.message || e).split('\n')[0].slice(0, 400)); await dismissAlerts(A).catch(() => undefined); } };
  const cloudUser = async (login: string) => (await supabaseDev.from('t_users').select('login,role,email,telephone,statut_actif,sync_id,centre_id,site_id,nom_user,prenom_user').eq('login', login).maybeSingle()).data as any;
  const cloudRoles = async (sync: string) => ((await supabaseDev.from('t_user_roles').select('role').eq('user_sync_id', sync)).data || []).map((r: any) => r.role).sort();
  const local = async (login: string) => (await sqlRead(A, `SELECT login,role,email,telephone,statut_actif,is_dirty,sync_id,last_login FROM t_users WHERE login='${login}'`))[0];
  const outboxUsers = async (login: string) => {
    const l = await local(login); if (!l) return [];
    const rows = await sqlRead(A, `SELECT id,table_name,operation,payload FROM t_outbox WHERE table_name='t_users' AND id='${l.sync_id}'`);
    return rows.map((r: any) => { let p: any = {}; try { p = JSON.parse(r.payload); } catch { /* */ } return { op: r.operation, keys: Object.keys(p).sort(), email: 'email' in p ? p.email : '<absent>', telephone: 'telephone' in p ? p.telephone : '<absent>', login: p.login, role: p.role, hasHash: typeof p.password_hash === 'string' && p.password_hash.length > 20 }; });
  };
  const wb = async (on: boolean) => A.app.evaluate(({}, v) => { (globalThis as any).__qaWB = v; }, on);
  const offline = async (on: boolean) => A.app.evaluate(async ({ session }, v) => { (globalThis as any).__qaOff = v; await session.defaultSession.setProxy(v ? { proxyRules: 'http=127.0.0.1:9;https=127.0.0.1:9' } : { mode: 'direct' }); }, on);
  const pc = async () => A.app.evaluate(() => (globalThis as any).__pc as number);
  const waitUntil = async (fn: () => Promise<boolean>, max = 90000, st = 2000) => { const t0 = Date.now(); while (Date.now() - t0 < max) { if (await fn()) return true; await sleep(st); } return false; };
  const syncState = async () => A.window.evaluate(async () => (await (window as any).api.sync.getStatus()).state);
  const pushNow = async () => { const b = A.window.getByRole('button', { name: /Envoyer vers le Cloud/ }); if (await b.count() && await b.isEnabled().catch(() => false)) await b.click().catch(() => undefined); };
  const drained = async (login: string) => waitUntil(async () => { const l = await local(login); const ob = l ? await outboxUsers(login) : []; if (ob.length) await pushNow(); return !!l && l.is_dirty === 0 && ob.length === 0; }, 120000, 3000);

  const ROLE_CB = (w: any, label: string) => w.locator('label', { hasText: label }).locator('input[type=checkbox]');
  const createAgent = async (login: string, nom: string, opts: { email?: string; tel?: string; role?: string; roleLabel?: string } = {}) => {
    const w = A.window;
    await w.getByRole('button', { name: /Nouvel Agent/ }).click();
    await w.getByRole('heading', { name: /Nouvel Agent/ }).waitFor();
    await w.getByPlaceholder('ex: agent_abobo').fill(login);
    await w.locator('input[placeholder="••••••••"]').first().fill('Mdp-' + nom + '_2026');
    await w.getByPlaceholder('NOM DE FAMILLE').fill(nom);
    const want = opts.roleLabel || 'Opérateur de Saisie';
    if (!(await ROLE_CB(w, want).isChecked())) await ROLE_CB(w, want).check();
    for (const other of ['Opérateur de Vérification', 'Opérateur de Saisie', 'Opérateur Inventaire']) if (other !== want && (await ROLE_CB(w, other).isChecked())) await ROLE_CB(w, other).uncheck();
    await w.locator('select.form-select').selectOption({ index: 1 });
    if (opts.email !== undefined) await w.locator('#agent-email').fill(opts.email);
    if (opts.tel !== undefined) await w.locator('#agent-tel').fill(opts.tel);
    await w.getByRole('button', { name: /Créer l'agent/ }).click();
    await sleep(1800);
    return noLic(await toasts(A));
  };
  const openEditRow = async (login: string) => {
    await searchBox(A, login);
    await A.window.locator('.table-row-hover', { has: A.window.locator(`text="@${login}"`) }).locator('button[title="Modifier"]').click();
    await A.window.getByRole('heading', { name: "Modifier l'agent" }).waitFor();
    await sleep(300);
  };
  const submitEdit = async () => { await A.window.getByRole('button', { name: /Mettre à jour/ }).click(); await sleep(1800); return noLic(await toasts(A)); };
  const rowBtn = async (login: string, title: string) => { await searchBox(A, login); await A.window.locator('.table-row-hover', { has: A.window.locator(`text="@${login}"`) }).locator(`button[title="${title}"]`).click(); };
  const rowLast = async (login: string) => A.window.evaluate((lg) => {
    const r = Array.from(document.querySelectorAll('.table-row-hover')).find((x) => (x as HTMLElement).innerText.includes('@' + lg)) as HTMLElement | undefined;
    if (!r) return null; const c = r.children[4] as HTMLElement; const d = c.querySelector('div[title]') as HTMLElement;
    return { text: c.innerText.replace(/\n/g, ' ').trim(), title: d?.getAttribute('title') || '' };
  }, login);

  test.afterEach(async ({}, ti) => { if (ti.status !== ti.expectedStatus) failed = true; });
  test.afterAll(async () => {
    try { await A?.app.evaluate(async ({ session }) => { (globalThis as any).__qaOff = false; (globalThis as any).__qaWB = false; await session.defaultSession.setProxy({ mode: 'direct' }); }); } catch { /* */ }
    try {
      const { data: us } = await supabaseDev.from('t_users').select('sync_id,login').or('login.like.ZZTEST_%,login.like.E2E_%,login.eq.superadmin');
      for (const u of us || []) { await supabaseDev.from('t_user_presence').delete().eq('user_sync_id', u.sync_id); await supabaseDev.from('t_user_roles').delete().eq('user_sync_id', u.sync_id); }
      await supabaseDev.from('t_logs').delete().eq('site_id', 1);
      await supabaseDev.from('t_logs').delete().eq('site_id', 901);
      for (const u of us || []) await supabaseDev.from('t_users').delete().eq('sync_id', u.sync_id);
      await supabaseDev.from('t_centres').delete().ilike('nom', 'ZZTEST_%');
      await supabaseDev.from('t_sites').delete().ilike('nom', 'ZZTEST_%');
      const left = await Promise.all(['t_users', 't_user_roles', 't_user_presence', 't_logs', 't_cartes', 't_centres', 't_sites'].map(async (t) => `${t}=${(await supabaseDev.from(t).select('*', { count: 'exact', head: true })).count}`));
      log('CLEANUP résiduel cloud: ' + left.join(' '));
    } catch (e) { console.error('[L3C] cleanup échec', e); }
    if (A) await teardownSeededApp(A, failed).catch(() => undefined);
  });

  test('00 setup', async () => {
    expect(E2E_CLOUD_SUPABASE_URL).toContain('ajadkziqaskadlzboeqo');
    log('cloud initial:', (await Promise.all(['t_users', 't_user_roles', 't_user_presence', 't_logs', 't_sites', 't_centres'].map(async (t) => `${t}=${(await supabaseDev.from(t).select('*', { count: 'exact', head: true })).count}`))).join(' '));
    A = await launchSeededApp({ allowRealSync: true });
    log('userData', A.userDataDir, 'db', A.seed.dbPath);
    expect(await waitOnline(A)).toBe(true);
    await ensureCloudSiteAndCentre(A.seed.siteId, A.seed.centreId);
    const full = (await sqlRead(A, `SELECT * FROM t_users WHERE login='E2E_ADMINISTRATEUR_SITE'`))[0];
    const ins = await supabaseDev.from('t_users').insert({ login: full.login, password_hash: full.password_hash, role: full.role, nom_user: full.nom_user, prenom_user: full.prenom_user, statut_actif: 1, site_id: full.site_id, centre_id: null, sync_id: full.sync_id });
    expect(ins.error?.message).toBeUndefined();
    await A.app.evaluate(async ({ ipcMain }) => {
      const g: any = globalThis; g.__pc = 0; g.__qaWB = false; g.__qaOff = false; g.__origFetchL3 = g.fetch;
      g.fetch = async (input: any, init: any) => {
        const method = String((init && init.method) || input?.method || 'GET').toUpperCase();
        if (g.__qaOff) throw new TypeError('fetch failed (QA offline)');
        if (g.__qaWB && method !== 'GET' && method !== 'HEAD') throw new TypeError('fetch failed (QA write-block)');
        return g.__origFetchL3(input, init);
      };
      const m = (ipcMain as any)._invokeHandlers; const h = m.get('presence:getAgents');
      m.set('presence:getAgents', (...a: any[]) => { g.__pc++; return h(...a); });
    });
    await loginKey(A, 'administrateurSite');
    await setWindow1366(A);
    const c0 = await pc();
    await goAgents(A);
    log('S5 presence:getAgents appels au montage =', (await pc()) - c0);
    await sleep(6000);
    log('S5 presence:getAgents appels +6s (pas de polling) =', (await pc()) - c0);
    const c1 = await pc();
    await A.window.locator('button[title="Rafraîchir la liste"]').click(); await sleep(2500);
    log('S5 appels après clic Rafraîchir =', (await pc()) - c1);
  });

  test('S3 contact bout en bout', async () => {
    const C1 = P + 'C1';
    await step('création C1 (écritures cloud bloquées)', async () => {
      await wb(true);
      const t = await createAgent(C1, 'CONTACTUN', { email: 'c1.initial@exemple.ci', tel: '+22507 01 02 03 04' });
      log('S3 création C1 toasts', J(t), 'local =', J(await local(C1)));
      log('S3 outbox t_users C1 =', J(await outboxUsers(C1)));
      await shot('A-after-create');
      await wb(false);
      log('S3 drained =', await drained(C1));
      log('S3 cloud C1 =', J(await cloudUser(C1)), 'local =', J(await local(C1)));
    });
    await step('modification du contact', async () => {
      await wb(true);
      await openEditRow(C1);
      await A.window.locator('#agent-email').fill('c1.modifie@exemple.ci');
      await A.window.locator('#agent-tel').fill('+2250505050505');
      log('S3 edit contact toasts', J(await submitEdit()), 'local =', J(await local(C1)));
      log('S3 outbox après modif contact =', J(await outboxUsers(C1)));
      await wb(false); log('S3 drained =', await drained(C1));
      log('S3 cloud après modif contact =', J(await cloudUser(C1)));
    });
    await step('modification autre champ seul (prénom)', async () => {
      await wb(true);
      await openEditRow(C1);
      await A.window.getByPlaceholder('Prénoms').fill('PrenomSeul');
      log('S3 edit prénom toasts', J(await submitEdit()), 'local =', J(await local(C1)));
      log('S3 outbox après modif prénom seul =', J(await outboxUsers(C1)));
      await wb(false); log('S3 drained =', await drained(C1));
      log('S3 cloud après prénom =', J(await cloudUser(C1)));
    });
    await step('désactivation / réactivation', async () => {
      await wb(true);
      await rowBtn(C1, 'Désactiver'); await confirmDialog(A, PWD);
      log('S3 désactivé local =', J(await local(C1)), 'outbox =', J(await outboxUsers(C1)));
      await rowBtn(C1, 'Activer'); await confirmDialog(A, PWD);
      log('S3 réactivé local =', J(await local(C1)), 'outbox =', J(await outboxUsers(C1)));
      await wb(false); log('S3 drained =', await drained(C1));
      log('S3 cloud après toggle =', J(await cloudUser(C1)));
    });
    await step('effacement du contact', async () => {
      await wb(true);
      await openEditRow(C1);
      await A.window.locator('#agent-email').fill('');
      await A.window.locator('#agent-tel').fill('');
      log('S3 effacement toasts', J(await submitEdit()), 'local =', J(await local(C1)));
      log('S3 outbox après effacement =', J(await outboxUsers(C1)));
      await wb(false); log('S3 drained =', await drained(C1));
      log('S3 cloud après effacement =', J(await cloudUser(C1)));
    });
    await step('réutilisation compte supprimé (-1)', async () => {
      const C2 = P + 'C2';
      log('S3 création C2 avec contact toasts', J(await createAgent(C2, 'CONTACTDEUX', { email: 'c2.ancien@exemple.ci', tel: '+2250102030405' })));
      log('S3 C2 drained =', await drained(C2), 'cloud =', J(await cloudUser(C2)));
      await offline(true);
      await rowBtn(C2, 'Supprimer définitivement'); await confirmDialog(A, PWD); await sleep(1500);
      log('S3 C2 supprimé hors ligne -> local =', J(await local(C2)));
      const t = await createAgent(C2, 'CONTACTDEUXBIS', {});
      log('S3 re-création C2 SANS contact toasts', J(t), 'local =', J(await local(C2)), 'outbox =', J(await outboxUsers(C2)));
      await offline(false);
      expect(await waitOnline(A)).toBe(true);
      log('S3 C2 drained =', await drained(C2), 'cloud =', J(await cloudUser(C2)));
    });
    await step('contact absent des logs/audit', async () => {
      const needles = ['c1.initial', 'c1.modifie', 'c2.ancien', '0102030405', '0505050505', '07 01 02', '%@exemple.ci%'];
      for (const n of needles) {
        const like = n.startsWith('%') ? n : `%${n}%`;
        const tl = await sqlRead(A, `SELECT COUNT(*) n FROM t_logs WHERE detail LIKE '${like}'`);
        const au = await sqlRead(A, `SELECT COUNT(*) n FROM audit_logs WHERE details LIKE '${like}'`);
        const ob = await sqlRead(A, `SELECT COUNT(*) n FROM t_outbox WHERE table_name='t_logs' AND payload LIKE '${like}'`);
        log(`S3 logs contenant "${n}" : t_logs=${tl[0].n} audit_logs=${au[0].n} outbox(t_logs)=${ob[0].n}`);
      }
      log('S3 audit_logs C1 (dernières) =', J(await sqlRead(A, `SELECT action_type,details FROM audit_logs WHERE details LIKE '%${C1}%' ORDER BY rowid DESC LIMIT 6`)));
      const cl = (await supabaseDev.from('t_logs').select('action,detail').or('detail.ilike.%exemple.ci%,detail.ilike.%0102030405%,detail.ilike.%0505050505%')).data || [];
      log('S3 t_logs cloud contenant un contact =', cl.length);
    });
    await step('INVENTAIRE : cloud', async () => {
      const t = await createAgent(P + 'INV', 'INVCLOUD', { roleLabel: 'Opérateur Inventaire', email: 'inv@exemple.ci' });
      log('S4 INV créé toasts', J(t));
      log('S4 INV drained =', await drained(P + 'INV'));
      const cu = await cloudUser(P + 'INV');
      log('S4 cloud INV =', J(cu), 'rôles cloud =', J(cu ? await cloudRoles(cu.sync_id) : null), 'local roles =', J(await sqlRead(A, `SELECT role FROM t_user_roles WHERE id_user=(SELECT id_user FROM t_users WHERE login='${P}INV')`)));
    });
  });

  test('S3b descente cloud -> local et garde L2-1', async () => {
    const C3 = P + 'C3';
    await step('création C3 + push', async () => {
      log('création C3', J(await createAgent(C3, 'CONTACTTROIS', { email: 'c3.local@exemple.ci', tel: '+2250707070707' })));
      log('C3 drained =', await drained(C3), J(await cloudUser(C3)));
    });
    const dl = async () => { await A.window.getByRole('button', { name: /Télécharger les agents/ }).click(); await sleep(5000); return noLic(await toasts(A)); };
    await step('contact modifié côté cloud descend', async () => {
      await goAgents(A);
      const upd = await supabaseDev.from('t_users').update({ email: 'c3.cloud@exemple.ci', telephone: '+2250808080808' }).eq('login', C3);
      log('S3 update cloud direct err =', upd.error?.message);
      const c0 = await pc();
      const t = await dl();
      log('S3 téléchargement toasts', J(t), 'local C3 =', J(await local(C3)), 'presence:getAgents appels pendant téléchargement =', (await pc()) - c0);
      await shot('B-after-download');
    });
    await step('garde L2-1 : ligne dirty non écrasée', async () => {
      await wb(true);
      await openEditRow(C3);
      await A.window.locator('#agent-email').fill('c3.dirty@exemple.ci');
      log('S3 edit local dirty toasts', J(await submitEdit()), 'local =', J(await local(C3)), 'outbox =', J(await outboxUsers(C3)));
      await supabaseDev.from('t_users').update({ email: 'c3.cloud2@exemple.ci' }).eq('login', C3);
      const t = await dl();
      log('S3 téléchargement (ligne dirty) toasts', J(t), 'local C3 =', J(await local(C3)), '(attendu: email local dirty conservé)');
      await wb(false);
      log('S3 drained =', await drained(C3), 'cloud C3 =', J(await cloudUser(C3)));
    });
  });

  test('S5/S6 Dernière co. cloud / repli local / isolation / rôles', async () => {
    const C1 = P + 'C1'; const C2 = P + 'C2'; const C3 = P + 'C3';
    const c1 = await local(C1); const c2 = await local(C2);
    await sqlWrite(A, `UPDATE t_users SET last_login='2026-09-01 08:00:00' WHERE login='${C1}'`);
    await sqlWrite(A, `UPDATE t_users SET last_login='2026-10-09 08:15:00' WHERE login='${C2}'`);
    // Cloud : présence pour C1 (valeur cloud distincte du local) ; site 901 + agent d'un autre site avec présence
    const pr = await supabaseDev.from('t_user_presence').insert({ user_sync_id: c1.sync_id, login: C1, site_id: A.seed.siteId, centre_id: A.seed.centreId, role: 'OPERATEUR_SAISIE', last_login_at: '2026-10-11T09:15:00.000Z', last_heartbeat_at: '2026-10-11T09:20:00.000Z' });
    log('S5 insert présence cloud C1 err =', pr.error?.message);
    const s2 = await supabaseDev.from('t_sites').upsert({ id: 901, nom: 'ZZTEST_AUTRE_SITE_L3', code: 'ZZTEST-L3-AUTRE', is_active: 1, max_centres: 4, is_permanent: false, sync_id: 'zztest-l3-autre-site' }, { onConflict: 'id' });
    const ce = await supabaseDev.from('t_centres').upsert({ id: 901, site_id: 901, nom: 'ZZTEST_AUTRE_CENTRE_L3', numero: 1, sync_id: 'zztest-l3-autre-centre' }, { onConflict: 'id' });
    const ou = await supabaseDev.from('t_users').insert({ login: P + 'AUTRESITE', password_hash: 'x', role: 'OPERATEUR_SAISIE', nom_user: 'AUTRESITE', statut_actif: 1, site_id: 901, centre_id: 901, sync_id: 'zztest-l3-autresite-user' });
    const op = await supabaseDev.from('t_user_presence').insert({ user_sync_id: 'zztest-l3-autresite-user', login: P + 'AUTRESITE', site_id: 901, centre_id: 901, role: 'OPERATEUR_SAISIE', last_login_at: '2026-10-10T07:00:00.000Z' });
    log('S6 setup autre site err =', J([s2.error?.message, ce.error?.message, ou.error?.message, op.error?.message]));
    await step('ADMIN site en ligne', async () => {
      const c0 = await pc();
      await goAgents(A); await sleep(1500);
      log('S5 ADM en ligne : appels montage =', (await pc()) - c0, 'état', await syncState());
      for (const l of [C1, C2, C3, 'E2E_ADMINISTRATEUR_SITE', 'E2E_ADMIN_CENTRE']) log('S5 ADM ligne', l, J(await rowLast(l)));
      await shot('C-adm-online-last');
      const api = await A.window.evaluate(async () => { try { return (await (window as any).api.presence.getAgents()).map((r: any) => [r.login, r.site_id, r.last_login_at]); } catch (e: any) { return 'ERR ' + e.message; } });
      log('S6 ADM presence.getAgents (IPC) =', J(api), '(attendu: aucune ligne du site 901)');
      const rows = await A.window.evaluate(() => Array.from(document.querySelectorAll('.table-row-hover')).map((r) => (r as HTMLElement).innerText).filter((t) => /AUTRESITE/.test(t)).length);
      log('S6 ADM lignes AUTRESITE dans la liste =', rows);
    });
    await step('ADMIN site hors ligne (repli local)', async () => {
      await offline(true);
      const ok = await waitUntil(async () => { await A.window.evaluate(async () => { try { await (window as any).api.sync.retryConnection?.(); } catch { /* */ } }); return (await syncState()) !== 'ONLINE'; }, 150000, 4000);
      log('S5 réseau coupé : état =', await syncState(), 'non-ONLINE atteint =', ok);
      const c0 = await pc();
      await goAgents(A); await sleep(2000);
      log('S5 HORS LIGNE appels presence:getAgents au montage =', (await pc()) - c0, '(attendu 0 : non ONLINE)');
      for (const l of [C1, C2, C3, 'E2E_ADMINISTRATEUR_SITE']) log('S5 HORS LIGNE ligne', l, J(await rowLast(l)));
      log('S5 HORS LIGNE toasts =', J(noLic(await toasts(A))));
      await shot('D-adm-offline-last');
      await offline(false);
      log('S5 retour réseau ONLINE =', await waitOnline(A));
    });
    await step('SUPER ADMIN', async () => {
      await logoutUi(A); await loginKey(A, 'superAdmin');
      const c0 = await pc();
      await goAgents(A); await sleep(1500);
      log('S5 SA appels montage =', (await pc()) - c0);
      for (const l of [C1, C2, 'E2E_ADMINISTRATEUR_SITE', P + 'AUTRESITE']) log('S5 SA ligne', l, J(await rowLast(l)));
      const api = await A.window.evaluate(async () => { try { return (await (window as any).api.presence.getAgents()).map((r: any) => [r.login, r.site_id]); } catch (e: any) { return 'ERR ' + e.message; } });
      log('S6 SA presence.getAgents =', J(api));
      await shot('E-sa-last');
    });
    await step('ADMIN_CENTRE atteint /agents', async () => {
      await logoutUi(A); await loginKey(A, 'adminCentre');
      await A.window.evaluate(() => { window.location.hash = '#/agents'; }); await sleep(2500);
      log('S5 ADMIN_CENTRE hash après #/agents =', await A.window.evaluate(() => location.hash), 'titre présent =', await A.window.getByRole('heading', { name: 'Gestion des Agents' }).count());
      const api = await A.window.evaluate(async () => { try { return await (window as any).api.presence.getAgents(); } catch (e: any) { return 'ERR ' + e.message; } });
      log('S5 ADMIN_CENTRE presence.getAgents (IPC direct) =', J(api).slice(0, 200));
      await shot('F-admin-centre');
    });
  });
});
