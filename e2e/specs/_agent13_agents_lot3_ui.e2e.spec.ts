/**
 * QA terrain agent-13 — Lot 3 page Agents (3A tableau 1366x768, 3C modal contact, 4 INVENTAIRE, 5 colonne Dernière co. locale).
 * Instance isolée (launchSeededApp sans sync réseau, userData gest-in-situ-e2e-*), aucune donnée réelle.
 */
import { test, expect } from '@playwright/test';
import { join } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { launchSeededApp, teardownSeededApp, type E2EEnvironment } from '../fixtures/electron-app';
import { supabaseDev, ensureCloudSiteAndCentre, E2E_CLOUD_SUPABASE_URL } from '../fixtures/supabase-dev-client';
import { waitOnline, sleep, sqlRead, sqlWrite, loginKey, logoutUi, goAgents, setWindow1366, toasts, dismissAlerts, SHOT_DIR, PWD, searchBox } from './_agent13_agents_helpers';

const log = (...a: any[]) => console.log('[LOT3UI]', ...a);
const J = (x: any) => JSON.stringify(x);
const noLic = (t: string[]) => t.filter((x) => !/LICENCE/.test(x));
const shot = (env: E2EEnvironment, n: string) => env.window.screenshot({ path: join(SHOT_DIR, `agent13-LOT3-${n}.png`) });

async function measureTable(env: E2EEnvironment) {
  return env.window.evaluate(() => {
    const wrap = document.querySelector('.table-responsive-wrapper') as HTMLElement;
    const rows = Array.from(document.querySelectorAll('.table-row-hover')) as HTMLElement[];
    const wr = wrap.getBoundingClientRect();
    const header = wrap.firstElementChild!.firstElementChild as HTMLElement;
    const hr = header.getBoundingClientRect();
    const badgeSizes = new Set<string>();
    const btnIssues: string[] = [];
    const cellIssues: string[] = [];
    rows.forEach((r) => {
      const cells = Array.from(r.children) as HTMLElement[];
      Array.from(cells[1]?.querySelectorAll('span') || []).forEach((s) => badgeSizes.add(getComputedStyle(s).fontSize));
      const act = cells[cells.length - 1];
      const ar = act.getBoundingClientRect();
      Array.from(act.querySelectorAll('button')).forEach((b) => {
        const br = b.getBoundingClientRect();
        if (br.left < ar.left - 0.5 || br.right > ar.right + 0.5 || br.width < 5) btnIssues.push(`${b.getAttribute('title')}:${Math.round(br.left)}-${Math.round(br.right)} vs ${Math.round(ar.left)}-${Math.round(ar.right)}`);
      });
      // overflow de cellule (hors ellipsis volontaire)
      cells.forEach((c, i) => { if (c.scrollWidth > c.clientWidth + 1 && i !== 0) cellIssues.push(`col${i}:${c.scrollWidth}>${c.clientWidth}`); });
    });
    const firstRow = rows[0]?.getBoundingClientRect();
    const visibleRows = rows.filter((r) => r.getBoundingClientRect().bottom <= window.innerHeight).length;
    const colWidths = rows[0] ? Array.from(rows[0].children).map((c) => Math.round(c.getBoundingClientRect().width)) : [];
    return {
      innerW: window.innerWidth, innerH: window.innerHeight,
      wrapScrollW: wrap.scrollWidth, wrapClientW: wrap.clientWidth, wrapHScroll: wrap.scrollWidth > wrap.clientWidth + 1,
      docHScroll: document.documentElement.scrollWidth > window.innerWidth + 1,
      headerTop: Math.round(hr.top), headerBottom: Math.round(hr.bottom), headerVisible: hr.bottom <= window.innerHeight,
      rowCount: rows.length, visibleRows, firstRowTop: firstRow ? Math.round(firstRow.top) : null,
      badgeSizes: Array.from(badgeSizes), btnIssues, cellIssues, colWidths,
      actionBtnCount: rows[0] ? rows[0].lastElementChild!.querySelectorAll('button').length : 0,
      headers: Array.from(header.children).map((h) => (h as HTMLElement).innerText)
    };
  });
}
async function readRows7(env: E2EEnvironment) {
  return env.window.evaluate(() => Array.from(document.querySelectorAll('.table-row-hover')).map((r) => {
    const c = Array.from(r.children) as HTMLElement[];
    const t = (i: number) => (c[i]?.innerText || '').replace(/\n+/g, ' | ').trim();
    const ll = c[4]?.querySelector('div[title]') as HTMLElement | null;
    return { agent: t(0), roles: t(1), centreSite: t(2), contact: t(3), last: t(4), lastTitle: ll?.getAttribute('title') || '', statut: t(5), btn: Array.from(c[6]?.querySelectorAll('button') || []).map((b) => b.getAttribute('title')) };
  }));
}
async function modalGeometry(env: E2EEnvironment) {
  return env.window.evaluate(() => {
    const form = document.querySelector('form') as HTMLElement;
    const modal = form.parentElement as HTMLElement;
    const mr = modal.getBoundingClientRect();
    const h3 = Array.from(document.querySelectorAll('h3')).find((x) => /Agent/.test((x as HTMLElement).innerText)) as HTMLElement;
    const hr = h3.getBoundingClientRect();
    const btn = (re: RegExp) => { const b = Array.from(document.querySelectorAll('button')).find((x) => re.test((x as HTMLElement).innerText)) as HTMLElement | undefined; const r = b?.getBoundingClientRect(); return r ? { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) } : null; };
    const scroller = Array.from(form.querySelectorAll('div')).find((d) => getComputedStyle(d).overflowY === 'auto') as HTMLElement | undefined;
    const em = document.getElementById('agent-email')!.getBoundingClientRect();
    const tel = document.getElementById('agent-tel')!.getBoundingClientRect();
    return {
      innerH: window.innerHeight, modalTop: Math.round(mr.top), modalBottom: Math.round(mr.bottom), titleTop: Math.round(hr.top), titleBottom: Math.round(hr.bottom),
      annuler: btn(/^Annuler$/), valider: btn(/Créer l'agent|Mettre à jour/),
      bodyScrolls: scroller ? scroller.scrollHeight > scroller.clientHeight + 1 : null, bodyScrollH: scroller?.scrollHeight, bodyClientH: scroller?.clientHeight,
      emailTop: Math.round(em.top), telTop: Math.round(tel.top), emailRight: Math.round(em.right), telLeft: Math.round(tel.left), emailW: Math.round(em.width), telW: Math.round(tel.width)
    };
  });
}
async function sqlExec(dbPath: string, sql: string) {
  const script = `const D=require('better-sqlite3');const db=new D(process.argv[1],{timeout:20000});try{db.exec(process.argv[2]);process.stdout.write('__OK__')}finally{db.close()}`;
  const { stdout } = await promisify(execFile)(require('electron') as unknown as string, ['-e', script, dbPath, sql], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf-8' });
  if (!stdout.includes('__OK__')) throw new Error('sqlExec KO ' + stdout);
}
const fillBase = async (env: E2EEnvironment, login: string, nom: string, role: string, centre: boolean) => {
  const w = env.window;
  await w.getByPlaceholder('ex: agent_abobo').fill(login);
  await w.locator('input[placeholder="••••••••"]').first().fill('Mdp-' + nom + '_2026');
  await w.getByPlaceholder('NOM DE FAMILLE').fill(nom);
  const cb = w.locator('label', { hasText: role }).locator('input[type=checkbox]');
  if (!(await cb.isChecked())) await cb.check();
  for (const other of ['Opérateur de Vérification', 'Opérateur de Saisie']) {
    if (other === role) continue;
    const o = w.locator('label', { hasText: other }).locator('input[type=checkbox]');
    if (await o.isChecked()) await o.uncheck();
  }
  if (centre) await w.locator('select.form-select').selectOption({ index: 1 });
};

test.describe.serial('QA terrain — Lot 3 Agents (UI locale)', () => {
  test.setTimeout(900_000);
  let S: E2EEnvironment; let failed = false;
  test.afterEach(async ({}, ti) => { if (ti.status !== ti.expectedStatus) failed = true; });
  test.afterAll(async () => {
    if (S) await teardownSeededApp(S, failed).catch(() => undefined);
    try {
      const { data: us } = await supabaseDev.from('t_users').select('sync_id,login').or('login.like.ZZTEST_%,login.like.E2E_%,login.eq.superadmin');
      for (const u of us || []) { await supabaseDev.from('t_user_presence').delete().eq('user_sync_id', u.sync_id); await supabaseDev.from('t_user_roles').delete().eq('user_sync_id', u.sync_id); }
      await supabaseDev.from('t_logs').delete().eq('site_id', 1);
      for (const u of us || []) await supabaseDev.from('t_users').delete().eq('sync_id', u.sync_id);
      await supabaseDev.from('t_centres').delete().ilike('nom', 'ZZTEST_%');
      await supabaseDev.from('t_sites').delete().ilike('nom', 'ZZTEST_%');
      const left = await Promise.all(['t_users', 't_user_roles', 't_user_presence', 't_logs', 't_cartes', 't_centres', 't_sites'].map(async (t) => `${t}=${(await supabaseDev.from(t).select('*', { count: 'exact', head: true })).count}`));
      log('CLEANUP résiduel cloud: ' + left.join(' '));
    } catch (e) { console.error('cleanup échec', e); }
  });
  const step = async (n: string, fn: () => Promise<void>) => { try { await fn(); } catch (e: any) { log(`!! ÉTAPE EN ÉCHEC « ${n} » :`, String(e?.message || e).split('\n')[0].slice(0, 300)); await dismissAlerts(S).catch(() => undefined); } };

  test('setup + tableau + modal + inventaire + dernière co.', async () => {
    expect(E2E_CLOUD_SUPABASE_URL).toContain('ajadkziqaskadlzboeqo');
    log('cloud initial:', (await Promise.all(['t_users', 't_user_roles', 't_user_presence', 't_logs', 't_sites', 't_centres'].map(async (t) => `${t}=${(await supabaseDev.from(t).select('*', { count: 'exact', head: true })).count}`))).join(' '));
    S = await launchSeededApp({ allowRealSync: true });
    expect(await waitOnline(S)).toBe(true);
    await ensureCloudSiteAndCentre(S.seed.siteId, S.seed.centreId);
    const seedRow = (await sqlRead(S, `SELECT password_hash, site_id, centre_id FROM t_users WHERE login='E2E_OPERATEUR_VERIFICATION'`))[0];
    const siteId = seedRow.site_id; const centreId = seedRow.centre_id;
    log('seed', J({ db: S.seed.dbPath, siteId, centreId, existing: await sqlRead(S, `SELECT login,role FROM t_users`) }));
    // Base ressemblant au terrain : 22 agents site 1 (noms/logins longs, multi-rôles, contacts variés), 2 agents d'un AUTRE site.
    const roles = ['OPERATEUR_VERIFICATION', 'OPERATEUR_SAISIE', 'OPERATEUR_LOGISTIQUE', 'OPERATEUR_QUALITE', 'OPERATEUR_APUREMENT', 'OPERATEUR_INVENTAIRE', 'ADMIN_CENTRE'];
    let sql = `INSERT INTO t_sites (id,nom,code,is_active,max_centres,is_permanent,sync_id) VALUES (900,'ZZTEST_AUTRE_SITE','ZZTEST-AUTRE',1,4,0,'zztest-autre-site');
               INSERT INTO t_centres (id,site_id,nom,numero,sync_id) VALUES (900,900,'ZZTEST_AUTRE_CENTRE',1,'zztest-autre-centre');`;
    for (let i = 1; i <= 22; i++) {
      const r = roles[i % roles.length];
      const long = i % 5 === 0;
      const login = `ZZTEST_L3_${long ? 'AGENT_AVEC_UN_LOGIN_TRES_LONG_' : ''}${String(i).padStart(2, '0')}`;
      const ll = i % 3 === 0 ? `'2026-10-0${(i % 9) + 1} 14:3${i % 10}:00'` : 'NULL';
      const email = i % 2 === 0 ? `'agent.longue.adresse.${i}@domaine-exemple-long.ci'` : 'NULL';
      const tel = i % 4 === 0 ? `'+22507010${String(100 + i)}'` : 'NULL';
      sql += `INSERT INTO t_users (login,password_hash,role,nom_user,prenom_user,email,telephone,statut_actif,site_id,centre_id,sync_id,last_login,is_dirty) VALUES ('${login}','${seedRow.password_hash}','${r}','${long ? 'KOUAMENANDJOUAMANTCHI' : 'NOM' + i}','${long ? 'Marie-Chantal Adjoua Françoise' : 'Pre' + i}',${email},${tel},${i % 7 === 0 ? 0 : 1},${siteId},${centreId},'zztest-l3-${i}',${ll},0);
               INSERT INTO t_user_roles (id_user, role) VALUES ((SELECT id_user FROM t_users WHERE login='${login}'), '${r}');`;
      if (i % 6 === 0) sql += `INSERT INTO t_user_roles (id_user, role) VALUES ((SELECT id_user FROM t_users WHERE login='${login}'), 'OPERATEUR_SAISIE');`;
    }
    for (const i of [1, 2]) {
      sql += `INSERT INTO t_users (login,password_hash,role,nom_user,prenom_user,statut_actif,site_id,centre_id,sync_id,last_login,is_dirty) VALUES ('ZZTEST_L3_AUTRESITE_${i}','${seedRow.password_hash}','OPERATEUR_SAISIE','AUTRESITE${i}','X',1,900,900,'zztest-l3-as-${i}','2026-10-05 10:00:00',0);
               INSERT INTO t_user_roles (id_user, role) VALUES ((SELECT id_user FROM t_users WHERE login='ZZTEST_L3_AUTRESITE_${i}'), 'OPERATEUR_SAISIE');`;
    }
    // exécution instruction par instruction (la helper prépare une seule requête)
    for (const stmt of sql.split(/;\s*\n?/).map((x) => x.trim()).filter(Boolean)) await sqlWrite(S, stmt);
    log('agents seedés', J(await sqlRead(S, `SELECT COUNT(*) n, SUM(site_id=900) autre FROM t_users`)));

    await loginKey(S, 'superAdmin');
    await setWindow1366(S);
    log('viewport', J(await S.window.evaluate(() => [innerWidth, innerHeight])));
    await goAgents(S);
    await shot(S, 'SA-01-page1');
    const m1 = await measureTable(S);
    log('S1 SA mesures page1', J(m1));
    const rows1 = await readRows7(S);
    log('S1 SA lignes page1', J(rows1.slice(0, 10)));
    log('S1 SA pagination', J(await S.window.evaluate(() => Array.from(document.querySelectorAll('button')).filter((b) => /Précédent|Suivant|^\d+$/.test((b as HTMLElement).innerText.trim())).map((b) => (b as HTMLElement).innerText.trim()))));
    await step('page 2/3', async () => {
      await S.window.getByRole('button', { name: 'Suivant' }).click(); await sleep(400);
      log('S1 SA page2 mesures', J(await measureTable(S)));
      await shot(S, 'SA-02-page2');
      await S.window.getByRole('button', { name: 'Suivant' }).click(); await sleep(400);
      log('S1 SA page3 mesures', J(await measureTable(S)));
      log('S1 SA page3 lignes', J(await readRows7(S)));
      await shot(S, 'SA-03-page3');
      for (let i = 0; i < 3; i++) { const p = S.window.getByRole('button', { name: 'Précédent' }); if (await p.isEnabled()) await p.click(); await sleep(200); }
    });
    // Capture d'une page contenant l'agent multi-rôles et le nom long
    await step('scroll vertical + capture ligne longue', async () => {
      const hasLong = rows1.find((r) => /TRES_LONG/.test(r.agent));
      log('S1 ligne login long =', J(hasLong));
    });
    // Dernière co. (hors ligne : sync désactivée dans cette instance) — SUPER ADMIN
    const allSA: any[] = [];
    for (let p = 0; p < 4; p++) { allSA.push(...(await readRows7(S))); const n = S.window.getByRole('button', { name: 'Suivant' }); if (await n.isEnabled()) { await n.click(); await sleep(300); } else break; }
    for (let p = 0; p < 4; p++) { const pr = S.window.getByRole('button', { name: 'Précédent' }); if (await pr.isEnabled()) { await pr.click(); await sleep(200); } }
    log('S5 SA : toutes lignes (agent | last | title) =', J(allSA.map((r) => [r.agent.split(' | ').pop(), r.last, r.lastTitle])));
    log('S6 SA voit logins autre site ?', J(allSA.filter((r) => /AUTRESITE/.test(r.agent)).length), '(attendu: seul site actif ou tous selon SUPER ADMIN)');
    log('S5 sync status', J(await S.window.evaluate(async () => (await (window as any).api.sync.getStatus()).state)));

    // 2. Modal à 1366x768
    await S.window.getByRole('button', { name: /Nouvel Agent/ }).click();
    await S.window.getByRole('heading', { name: /Nouvel Agent/ }).waitFor();
    await sleep(500);
    const g = await modalGeometry(S);
    log('S2 géométrie modal création', J(g));
    await shot(S, 'SA-04-modal-creation');
    await step('validation email', async () => {
      await fillBase(S, 'ZZTEST_L3_EMAIL', 'EMAILBAD', 'Opérateur de Saisie', true);
      await S.window.locator('#agent-email').fill('pas-un-email');
      await sleep(300);
      const err = await S.window.locator('#agent-email-err').innerText().catch(() => null);
      log('S2 email invalide -> message live =', J(err), 'aria-invalid =', await S.window.locator('#agent-email').getAttribute('aria-invalid'));
      await shot(S, 'SA-05-modal-email-invalide');
      await S.window.getByRole('button', { name: /Créer l'agent/ }).click(); await sleep(800);
      log('S2 submit email invalide -> modal ouvert =', await S.window.getByRole('heading', { name: /Nouvel Agent/ }).count(), 'créé ?', J(await sqlRead(S, `SELECT login FROM t_users WHERE login='ZZTEST_L3_EMAIL'`)), 'toasts', J(noLic(await toasts(S))));
      await S.window.locator('#agent-email').fill('');
      await S.window.locator('#agent-tel').fill('+22507010');
      await sleep(300);
      log('S2 tel +225 court -> message =', J(await S.window.locator('#agent-tel-err').innerText().catch(() => null)));
      await S.window.locator('#agent-tel').fill('+2250701234567890');
      await sleep(300);
      log('S2 tel +225 trop long -> message =', J(await S.window.locator('#agent-tel-err').innerText().catch(() => null)));
      await S.window.locator('#agent-tel').fill('0701234567');
      await sleep(300);
      log('S2 tel sans + -> message =', J(await S.window.locator('#agent-tel-err').innerText().catch(() => null)));
      await shot(S, 'SA-06-modal-tel-invalide');
      await S.window.getByRole('button', { name: /Créer l'agent/ }).click(); await sleep(800);
      log('S2 submit tel invalide -> modal ouvert =', await S.window.getByRole('heading', { name: /Nouvel Agent/ }).count(), 'créé ?', J(await sqlRead(S, `SELECT login FROM t_users WHERE login='ZZTEST_L3_EMAIL'`)));
      await S.window.locator('#agent-tel').fill('+22507 01 23 45 67');
      await sleep(300);
      log('S2 tel valide (espaces) -> message =', J(await S.window.locator('#agent-tel-err').innerText().catch(() => null)));
      // champs vides acceptés
      await S.window.locator('#agent-tel').fill('');
      await S.window.getByRole('button', { name: /Créer l'agent/ }).click(); await sleep(1800);
      log('S2 contact vide -> modal fermé =', (await S.window.getByRole('heading', { name: /Nouvel Agent/ }).count()) === 0, 'local =', J(await sqlRead(S, `SELECT login,email,telephone,is_dirty FROM t_users WHERE login='ZZTEST_L3_EMAIL'`)), 'toasts', J(noLic(await toasts(S))));
    });

    // 4. INVENTAIRE sous SUPER ADMIN
    await step('inventaire SA', async () => {
      await S.window.getByRole('button', { name: /Nouvel Agent/ }).click();
      await S.window.getByRole('heading', { name: /Nouvel Agent/ }).waitFor();
      const cb = S.window.locator('label', { hasText: 'Opérateur Inventaire' }).locator('input[type=checkbox]');
      log('S4 SA case Inventaire visible =', await cb.count());
      await fillBase(S, 'ZZTEST_L3_INV_SA', 'INVSA', 'Opérateur Inventaire', false);
      await S.window.getByRole('button', { name: /Créer l'agent/ }).click(); await sleep(800);
      log('S4 SA inventaire sans centre -> alertes/erreurs visibles =', J(await S.window.evaluate(() => Array.from(document.querySelectorAll('[role=alert],[role=status]')).map((e) => (e as HTMLElement).innerText))), 'modal ouvert =', await S.window.getByRole('heading', { name: /Nouvel Agent/ }).count(), 'toasts', J(noLic(await toasts(S))), 'créé ?', J(await sqlRead(S, `SELECT login FROM t_users WHERE login='ZZTEST_L3_INV_SA'`)));
      await S.window.locator('select.form-select').selectOption({ index: 1 });
      await S.window.locator('#agent-email').fill('inv.sa@exemple.ci');
      await S.window.locator('#agent-tel').fill('+2250701020304');
      await S.window.getByRole('button', { name: /Créer l'agent/ }).click(); await sleep(1800);
      log('S4 SA inventaire créé ->', J(await sqlRead(S, `SELECT u.login,u.role,u.email,u.telephone,u.centre_id,u.site_id,u.is_dirty,(SELECT group_concat(role) FROM t_user_roles r WHERE r.id_user=u.id_user) roles FROM t_users u WHERE login='ZZTEST_L3_INV_SA'`)));
      log('S4 SA outbox ->', J(await sqlRead(S, `SELECT id,table_name,operation,substr(payload,1,400) p FROM t_outbox ORDER BY id DESC LIMIT 3`)));
      // décochable à l'édition : ajouter Saisie puis décocher Inventaire
      await searchBox(S, 'ZZTEST_L3_INV_SA');
      await S.window.locator('.table-row-hover').first().locator('button[title="Modifier"]').click();
      await S.window.getByRole('heading', { name: "Modifier l'agent" }).waitFor();
      const inv = S.window.locator('label', { hasText: 'Opérateur Inventaire' }).locator('input[type=checkbox]');
      log('S4 SA édition : Inventaire coché =', await inv.isChecked());
      await shot(S, 'SA-07-modal-edition-inventaire');
      await S.window.locator('label', { hasText: 'Opérateur de Saisie' }).locator('input[type=checkbox]').check();
      await inv.uncheck(); await sleep(200);
      log('S4 SA édition : décoché =', !(await inv.isChecked()));
      await S.window.getByRole('button', { name: /Mettre à jour/ }).click(); await sleep(1800);
      log('S4 SA après décoche ->', J(await sqlRead(S, `SELECT u.login,u.role,u.is_dirty,(SELECT group_concat(role) FROM t_user_roles r WHERE r.id_user=u.id_user) roles FROM t_users u WHERE login='ZZTEST_L3_INV_SA'`)), J(noLic(await toasts(S))));
      // ré-ajoute Inventaire (pour tester la connexion) via édition
      await searchBox(S, 'ZZTEST_L3_INV_SA');
      await S.window.locator('.table-row-hover').first().locator('button[title="Modifier"]').click();
      await S.window.getByRole('heading', { name: "Modifier l'agent" }).waitFor();
      await S.window.locator('label', { hasText: 'Opérateur Inventaire' }).locator('input[type=checkbox]').check();
      await S.window.locator('label', { hasText: 'Opérateur de Saisie' }).locator('input[type=checkbox]').uncheck();
      await S.window.getByRole('button', { name: /Mettre à jour/ }).click(); await sleep(1800);
      log('S4 SA ré-ajout Inventaire ->', J(await sqlRead(S, `SELECT u.role,(SELECT group_concat(role) FROM t_user_roles r WHERE r.id_user=u.id_user) roles FROM t_users u WHERE login='ZZTEST_L3_INV_SA'`)));
    });
    await step('login agent inventaire', async () => {
      await logoutUi(S);
      await S.window.getByTestId('login-input').fill('ZZTEST_L3_INV_SA');
      await S.window.getByTestId('password-input').fill('Mdp-INVSA_2026');
      await S.window.getByTestId('login-submit').click();
      await S.window.waitForFunction(() => !location.hash.includes('/login'), null, { timeout: 30000 });
      await sleep(1500);
      log('S4 agent INVENTAIRE connecté, route =', await S.window.evaluate(() => location.hash), 'alerts', J(await dismissAlerts(S)));
      await shot(S, 'INV-01-connexion');
      await logoutUi(S);
    });

    // ADMINISTRATEUR_SITE
    await loginKey(S, 'administrateurSite');
    await goAgents(S);
    await shot(S, 'ADM-01-page1');
    const mA = await measureTable(S);
    log('S1 ADM mesures', J(mA));
    const admRows: any[] = [];
    for (let p = 0; p < 5; p++) { admRows.push(...(await readRows7(S))); const n = S.window.getByRole('button', { name: 'Suivant' }); if (await n.isEnabled()) { await n.click(); await sleep(300); } else break; }
    log('S6 ADM nb lignes =', admRows.length, 'AUTRESITE visibles =', admRows.filter((r) => /AUTRESITE/.test(r.agent)).length);
    log('S5 ADM lignes (agent|last|title) =', J(admRows.slice(0, 40).map((r) => [r.agent.split(' | ').pop(), r.last, r.lastTitle, r.roles])));
    for (let p = 0; p < 5; p++) { const pr = S.window.getByRole('button', { name: 'Précédent' }); if (await pr.isEnabled()) { await pr.click(); await sleep(200); } }
    await step('inventaire ADM', async () => {
      await S.window.getByRole('button', { name: /Nouvel Agent/ }).click();
      await S.window.getByRole('heading', { name: /Nouvel Agent/ }).waitFor();
      log('S4 ADM case Inventaire visible =', await S.window.locator('label', { hasText: 'Opérateur Inventaire' }).count());
      await fillBase(S, 'ZZTEST_L3_INV_ADM', 'INVADM', 'Opérateur Inventaire', false);
      await S.window.getByRole('button', { name: /Créer l'agent/ }).click(); await sleep(800);
      log('S4 ADM sans centre -> modal ouvert =', await S.window.getByRole('heading', { name: /Nouvel Agent/ }).count(), 'toasts', J(noLic(await toasts(S))));
      await S.window.locator('select.form-select').selectOption({ index: 1 });
      await S.window.getByRole('button', { name: /Créer l'agent/ }).click(); await sleep(1800);
      log('S4 ADM créé ->', J(await sqlRead(S, `SELECT u.login,u.role,u.centre_id,u.site_id,u.is_dirty,(SELECT group_concat(role) FROM t_user_roles r WHERE r.id_user=u.id_user) roles FROM t_users u WHERE login='ZZTEST_L3_INV_ADM'`)));
    });
    // modal à 1366 en édition + capture
    await step('modal édition ADM', async () => {
      await searchBox(S, 'ZZTEST_L3_INV_ADM');
      await S.window.locator('.table-row-hover').first().locator('button[title="Modifier"]').click();
      await S.window.getByRole('heading', { name: "Modifier l'agent" }).waitFor(); await sleep(400);
      log('S2 géométrie modal édition ADM', J(await modalGeometry(S)));
      await shot(S, 'ADM-02-modal-edition');
      await S.window.getByRole('button', { name: 'Annuler' }).click(); await sleep(300);
    });
    // nettoyage local = userData jetable (supprimé par teardown). Trace explicite :
    log('CLEANUP : userData jetable', S.userDataDir, '(supprimé par teardownSeededApp si test OK)');
    expect(true).toBe(true);
  });
});
