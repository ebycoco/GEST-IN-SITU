/**
 * QA Terrain (agent-13) : commit 0a7d34b, journal CONTACT_CARTE_MODIFIE + avertissement doublon strict.
 * Base temporaire jetable, sync coupee (launchSeededApp). Donnees ZZTEST_ uniquement.
 */
import { test } from '@playwright/test';
import { launchSeededApp, teardownSeededApp, type E2EEnvironment } from '../fixtures/electron-app';
import { getTestUser } from '../fixtures/test-users';
import { join } from 'path';
import { mkdirSync } from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const SHOT_DIR = join(__dirname, '..', '..', 'test-results', 'agent13-audit-shots');
const P = 'ZZTEST_AUD';
const NOW = Date.now();
const CI = 'input[placeholder="+225 01 02 03 04 05"]';
const RI = 'input[placeholder="Ex: MAIRIE-A3"]';
const SEARCH = 'input[placeholder="Saisir les critères..."]';
const WARN = 'Ce contact crée un doublon avec une autre carte';

test.describe.serial('QA Terrain audit contact + doublon 0a7d34b', () => {
  let env: E2EEnvironment;
  let cpf: number;
  let site2: number;
  let centre2: number;
  const consoleErrors: string[] = [];

  test.beforeAll(async () => {
    mkdirSync(SHOT_DIR, { recursive: true });
    env = await launchSeededApp();
    env.window.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    env.window.on('pageerror', (e) => consoleErrors.push('[pageerror] ' + e.message));
  });
  test.afterAll(async () => {
    if (env) await teardownSeededApp(env, false);
  });

  const MK = '__E2E_DBQ__:';
  async function dbQuery(sql: string, params: unknown[] = []): Promise<any[]> {
    const script = `
      const Database = require('better-sqlite3');
      const db = new Database(process.argv[1], { timeout: 15000 });
      db.pragma('busy_timeout = 15000');
      try {
        const sql = process.argv[2]; const params = JSON.parse(process.argv[3]);
        const stmt = db.prepare(sql);
        let r;
        if (/^\\s*select/i.test(sql)) r = stmt.all(...params);
        else { const i = stmt.run(...params); r = [{ changes: i.changes, lastInsertRowid: Number(i.lastInsertRowid) }]; }
        process.stdout.write(${JSON.stringify(MK)} + JSON.stringify(r));
      } finally { db.close(); }`;
    const electronPath = require('electron') as unknown as string;
    const { stdout, stderr } = await execFileAsync(
      electronPath,
      ['-e', script, env.seed.dbPath, sql, JSON.stringify(params)],
      { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
    );
    const line = stdout.split(/\r?\n/).reverse().find((l) => l.startsWith(MK));
    if (!line) throw new Error(`dbQuery KO ${sql}\n${stdout}\n${stderr}`);
    return JSON.parse(line.slice(MK.length));
  }

  async function addCarte(key: string, o: { contact?: string | null; rangement?: string | null; site?: number; centre?: number; noms?: string; withKey?: boolean; secu?: string } = {}) {
    const noms = o.noms ?? `${P}_${key}`;
    const cle = o.withKey && o.contact ? `${noms}|QAPRE|1990-01-01|ABOBO|${o.contact}` : null;
    const cleFlex = o.withKey && o.contact ? `${noms}|QAPRE|1990-01-01|${o.contact}` : null;
    try {
      await dbQuery(
        `INSERT INTO t_cartes (noms, prenoms, statut, site_id, centre_id, sync_id, is_dirty, num_secu, date_de_naissance, lieu_de_naissance, contact, rangement, cle_doublon, cle_doublon_flex)
         VALUES (?, 'QAPRE', 'EN STOCK', ?, ?, ?, 0, ?, '1990-01-01', 'ABOBO', ?, ?, ?, ?)`,
        [noms, o.site ?? env.seed.siteId, o.centre ?? env.seed.centreId, `zztest-aud-${key}-${NOW}`, o.secu ?? `ZZTEST-AUD-${key}-${NOW}`,
          o.contact ?? null, o.rangement === undefined ? null : o.rangement, cle, cleFlex]
      );
    } catch (e: any) { console.log(`[A13][SEED-ERR ${key}] ${e.message.split('\n')[0]}`); }
  }
  const sid = (key: string) => `zztest-aud-${key}-${NOW}`;
  const idOf = async (key: string) => (await dbQuery(`SELECT id_carte FROM t_cartes WHERE sync_id=?`, [sid(key)]))[0].id_carte;
  const row = async (key: string) => (await dbQuery(`SELECT contact, rangement, centre_id, is_dirty, cle_doublon FROM t_cartes WHERE sync_id = ?`, [sid(key)]))[0];
  const logsFor = async (key: string) => {
    const id = await idOf(key);
    return dbQuery(
      `SELECT action, login_user, is_dirty, site_id, centre_id, detail, valeur_avant, valeur_apres FROM t_logs WHERE action IN ('CONTACT_CARTE_MODIFIE','CENTRE_CARTE_RECALCULE') AND detail LIKE ? ORDER BY id_log`,
      [`%carte ID ${id} %`]);
  };
  const outboxFor = async (key: string) => JSON.stringify(await dbQuery(`SELECT status, operation FROM t_outbox WHERE id = ?`, [sid(key)]));
  const toastsText = async () => (await env.window.locator('[role="status"]').allTextContents()).join(' | ');
  async function waitNoToast() {
    try { await env.window.waitForFunction(() => document.querySelectorAll('[role="status"]').length === 0, null, { timeout: 12000 }); } catch { /* ignore */ }
  }
  async function gotoHash(h: string) {
    await env.window.evaluate((x) => { window.location.hash = x; }, h);
    await env.window.waitForTimeout(1200);
  }
  async function openLogi(key: string) {
    const { window } = env;
    await gotoHash('#/inventaire/logistique');
    const annuler = window.getByRole('button', { name: 'Annuler' });
    if (await annuler.count()) await annuler.click();
    await window.locator(SEARCH).waitFor({ state: 'visible', timeout: 10000 });
    await window.locator(SEARCH).fill(`${P}_${key}`);
    await window.locator(`text=${P}_${key} QAPRE`).first().click();
    await window.locator(CI).waitFor({ state: 'visible', timeout: 5000 });
    await window.waitForTimeout(500);
    return window.locator(CI);
  }
  async function paste(sel: string, text: string) {
    const { window } = env;
    const el = window.locator(sel).first();
    await el.focus();
    await window.keyboard.press('Control+A');
    await window.keyboard.insertText(text);
    return el.inputValue();
  }
  async function submitLogi(rangement: string | null): Promise<string> {
    const { window } = env;
    if (rangement !== null) await window.locator(RI).fill(rangement);
    await waitNoToast();
    await window.getByRole('button', { name: /Valider \(Entrée\)/ }).click();
    await window.waitForTimeout(1500);
    return toastsText();
  }
  const fmtLogs = (l: any[]) => JSON.stringify(l.map((x) => ({ a: x.action, u: x.login_user, d: x.is_dirty, s: x.site_id, c: x.centre_id, det: x.detail, av: x.valeur_avant, ap: x.valeur_apres })));

  test('00 setup + login', async () => {
    const r = await dbQuery(`INSERT INTO t_sites (nom, code, is_active, max_centres, is_permanent, sync_id) VALUES (?, ?, 1, 4, 1, ?)`, [`${P}_SITE2`, `E2E-AUD-${NOW}`, `e2e-aud-site2-${NOW}`]);
    site2 = r[0].lastInsertRowid;
    centre2 = (await dbQuery(`INSERT INTO t_centres (site_id, nom, numero, sync_id) VALUES (?, ?, 1, ?)`, [site2, `${P}_C2`, `e2e-aud-c2-${NOW}`]))[0].lastInsertRowid;
    cpf = (await dbQuery(`INSERT INTO t_centres (site_id, nom, numero, sync_id, prefixe_rangement) VALUES (?, ?, 2, ?, 'CPF')`, [env.seed.siteId, `${P}_CPF`, `e2e-aud-cpf-${NOW}`]))[0].lastInsertRowid;
    console.log(`[A13][SETUP] centre seed=${env.seed.centreId} CPF=${cpf} site=${env.seed.siteId}`);
    await addCarte('L1', { contact: '0102030405' });
    for (const k of ['L2', 'L3', 'L6', 'L7', 'L8', 'UNIQ']) await addCarte(k);
    await addCarte('L4', { contact: '0102030405' });
    await addCarte('L5', { contact: '0102030405' });
    await addCarte('S1', { contact: '0102030405' });
    await addCarte('S2'); await addCarte('S3'); await addCarte('S9');
    await addCarte('IPC1', { contact: '0102030405' });
    await addCarte('NC1', { rangement: 'NON CLASSE' });
    // Doublons : DUPB insere AVANT DUPA pour etre le 1er homonyme (tri id_carte ASC)
    await addCarte('DUPB1', { noms: `${P}_DUP1` });
    await addCarte('DUPA1', { noms: `${P}_DUP1`, contact: '0708090010', withKey: true, rangement: 'ZZ-DUPA1' });
    await addCarte('DUPB4', { noms: `${P}_DUP4` });
    await addCarte('DUPA4', { noms: `${P}_DUP4`, contact: '0708090010', withKey: true, rangement: 'ZZ-DUPA4' });
    await addCarte('DUPB2', { noms: `${P}_DUP2` });
    await addCarte('DUPA2', { noms: `${P}_DUP2`, contact: '0708090010', withKey: true, rangement: 'ZZ-DUPA2' });
    await addCarte('DUPE1', { noms: `${P}_DUP3`, contact: '0605040302', withKey: true });
    await addCarte('DUPE2', { noms: `${P}_DUP3`, contact: '0605040302', withKey: true });
    await addCarte('AUTRESITE', { site: site2, centre: centre2 });
    await addCarte('LAY1', { contact: '0102030405', noms: 'KOUASSI-KONAN', secu: '2250123456789' });
    const u = getTestUser('operateurLogistique');
    const { window } = env;
    await window.waitForURL(/#\/login/, { timeout: 30000 });
    await window.getByTestId('login-input').fill(u.login);
    await window.getByTestId('password-input').fill(u.password);
    await window.getByTestId('login-submit').click();
    await window.waitForURL(/#\/inventaire/, { timeout: 20000 });
  });

  test('1 journal CONTACT_CARTE_MODIFIE (Logistique)', async () => {
    const { window } = env;
    await openLogi('L1');
    console.log(`[A13][L1 prerempli] "${await window.locator(CI).inputValue()}"`);
    await paste(CI, '0708090010');
    let t = await submitLogi('ZZ-L1');
    console.log(`[A13][L1 contact existant -> nouveau] toast="${t}" DB=${JSON.stringify(await row('L1'))} logs=${fmtLogs(await logsFor('L1'))}`);
    await openLogi('L2');
    await paste(CI, '+225 07 08 09 00 10');
    t = await submitLogi('ZZ-L2');
    console.log(`[A13][L2 sans contact -> nouveau] toast="${t}" DB=${JSON.stringify(await row('L2'))} logs=${fmtLogs(await logsFor('L2'))}`);
    await openLogi('L3');
    t = await submitLogi('ZZ-L3');
    console.log(`[A13][L3 rangement seul] toast="${t}" logs=${fmtLogs(await logsFor('L3'))}`);
    let ci = await openLogi('L4');
    await ci.fill('');
    t = await submitLogi('ZZ-L4');
    console.log(`[A13][L4 contact vide] toast="${t}" DB=${JSON.stringify(await row('L4'))} logs=${fmtLogs(await logsFor('L4'))}`);
    await openLogi('L5');
    t = await submitLogi('ZZ-L5');
    console.log(`[A13][L5 contact inchange] toast="${t}" DB=${JSON.stringify(await row('L5'))} logs=${fmtLogs(await logsFor('L5'))}`);
    await openLogi('L6');
    await window.locator(CI).focus();
    await window.keyboard.type('070809001');
    t = await submitLogi('ZZ-L6');
    console.log(`[A13][L6 9 chiffres] toast="${t}" DB=${JSON.stringify(await row('L6'))} logs=${fmtLogs(await logsFor('L6'))}`);
    await openLogi('L7');
    const shown = await paste(CI, '07080900101');
    await window.waitForTimeout(300);
    const tl = await toastsText();
    t = await submitLogi('ZZ-L7');
    console.log(`[A13][L7 colle 11 chiffres] champ="${shown}" toastColle="${tl}" toastEnvoi="${t}" DB=${JSON.stringify(await row('L7'))} logs=${fmtLogs(await logsFor('L7'))}`);
    await openLogi('L8');
    await paste(CI, '0708090011');
    t = await submitLogi('CPF-001');
    console.log(`[A13][L8 rangement CPF + contact] toast="${t}" DB=${JSON.stringify(await row('L8'))} (centre CPF=${cpf}) logs=${fmtLogs(await logsFor('L8'))}`);
    // IPC direct, meme valeur formattee
    const id = await idOf('IPC1');
    const res = await window.evaluate(async (i) => {
      try { return JSON.stringify(await (window as any).api.cartes.updateRangementEtFiche(i, { rangement: 'ZZ-IPC1', contact: '+225 01 02 03 04 05' })); }
      catch (e: any) { return 'ERR ' + (e?.message || e); }
    }, id);
    console.log(`[A13][IPC1 meme contact formatte] retour=${res} logs=${fmtLogs(await logsFor('IPC1'))}`);
    const res2 = await window.evaluate(async (i) => {
      try { return JSON.stringify(await (window as any).api.cartes.updateRangementEtFiche(i, { rangement: 'ZZ-IPC1B', contact: '0102030499' })); }
      catch (e: any) { return 'ERR ' + (e?.message || e); }
    }, id);
    console.log(`[A13][IPC1 nouveau contact] retour=${res2} logs=${fmtLogs(await logsFor('IPC1'))}`);
  });

  test('1b journal (Sans rangement)', async () => {
    const { window } = env;
    await gotoHash('#/inventaire/sans-rangement');
    await window.waitForTimeout(2000);
    const filt = async (k: string) => { await window.locator(SEARCH).fill(`${P}_${k}`); await window.waitForTimeout(1500); };
    const rowOf = (k: string) => window.locator('tr', { hasText: `${P}_${k}` });
    const cIn = (k: string) => rowOf(k).locator(CI);
    const rIn = (k: string) => rowOf(k).locator('input[placeholder="Ex: A-12-034"]');
    await filt('S1');
    await cIn('S1').focus(); await window.keyboard.press('Control+A'); await window.keyboard.insertText('0708090010');
    await rIn('S1').fill('ZZ-S1'); await waitNoToast(); await rIn('S1').press('Enter'); await window.waitForTimeout(1500);
    console.log(`[A13][S1 SR existant->nouveau] toast="${await toastsText()}" DB=${JSON.stringify(await row('S1'))} logs=${fmtLogs(await logsFor('S1'))}`);
    await filt('S2');
    await cIn('S2').focus(); await window.keyboard.insertText('0708090012');
    await rIn('S2').fill('ZZ-S2'); await waitNoToast(); await rIn('S2').press('Enter'); await window.waitForTimeout(1500);
    console.log(`[A13][S2 SR sans contact->nouveau] toast="${await toastsText()}" DB=${JSON.stringify(await row('S2'))} logs=${fmtLogs(await logsFor('S2'))}`);
    await filt('S3');
    await rIn('S3').fill('ZZ-S3'); await waitNoToast(); await rIn('S3').press('Enter'); await window.waitForTimeout(1500);
    console.log(`[A13][S3 SR rangement seul] toast="${await toastsText()}" logs=${fmtLogs(await logsFor('S3'))}`);
    await filt('S9');
    await cIn('S9').focus(); await window.keyboard.type('070809001');
    await rIn('S9').fill('ZZ-S9'); await waitNoToast(); await rIn('S9').press('Enter'); await window.waitForTimeout(1200);
    console.log(`[A13][S9 SR 9 chiffres] toast="${await toastsText()}" DB=${JSON.stringify(await row('S9'))} logs=${fmtLogs(await logsFor('S9'))}`);
  });

  test('2 doublon strict', async () => {
    const { window } = env;
    // Logistique
    await openLogi('DUP1');
    await paste(CI, '0708090010');
    await waitNoToast();
    await window.locator(RI).fill('ZZ-DUPB1');
    await window.getByRole('button', { name: /Valider \(Entrée\)/ }).click();
    const t0 = Date.now();
    let first = -1; let last = -1; let seenText = '';
    while (Date.now() - t0 < 14000) {
      const txt = await toastsText();
      if (txt.includes(WARN)) { if (first < 0) first = Date.now() - t0; last = Date.now() - t0; seenText = txt; }
      else if (first >= 0) break;
      await window.waitForTimeout(150);
    }
    console.log(`[A13][DUP Logistique] toasts="${seenText}" apparition~${first}ms disparition~${last}ms (duree~${last - first}ms)`);
    await window.screenshot({ path: join(SHOT_DIR, 'dup-toast.png') }).catch(() => undefined);
    console.log(`[A13][DUP Logistique] DB=${JSON.stringify(await row('DUPB1'))} outbox=${await outboxFor('DUPB1')} logs=${fmtLogs(await logsFor('DUPB1'))}`);
    // Sans rangement
    await gotoHash('#/inventaire/sans-rangement');
    await window.waitForTimeout(1800);
    await window.locator(SEARCH).fill(`${P}_DUP2`);
    await window.waitForTimeout(1500);
    const rowOf = window.locator('tr', { hasText: `${P}_DUP2` });
    console.log(`[A13][DUP SR] lignes listees pour DUP2=${await rowOf.count()}`);
    await rowOf.first().locator(CI).focus();
    await window.keyboard.insertText('0708090010');
    await rowOf.first().locator('input[placeholder="Ex: A-12-034"]').fill('ZZ-DUPB2');
    await waitNoToast();
    await rowOf.first().locator('input[placeholder="Ex: A-12-034"]').press('Enter');
    const t1 = Date.now();
    let f2 = -1; let l2 = -1; let txt2 = '';
    while (Date.now() - t1 < 14000) {
      const txt = await toastsText();
      if (txt.includes(WARN)) { if (f2 < 0) f2 = Date.now() - t1; l2 = Date.now() - t1; txt2 = txt; }
      else if (f2 >= 0) break;
      await window.waitForTimeout(150);
    }
    console.log(`[A13][DUP SR] toasts="${txt2}" duree~${l2 - f2}ms DB=${JSON.stringify(await row('DUPB2'))} outbox=${await outboxFor('DUPB2')} logs=${fmtLogs(await logsFor('DUPB2'))}`);
    await waitNoToast();
    // controle sans doublon
    await openLogi('UNIQ');
    await paste(CI, '0909090909');
    const tu = await submitLogi('ZZ-UNIQ');
    console.log(`[A13][UNIQ sans doublon] toast="${tu}" avertissement=${tu.includes(WARN)} DB=${JSON.stringify(await row('UNIQ'))} outbox=${await outboxFor('UNIQ')}`);
    // contact vide avec doublon preexistant
    const ci = await openLogi('DUP3');
    console.log(`[A13][DUPE (1er des 2) prerempli] "${await ci.inputValue()}"`);
    await ci.fill('');
    const te = await submitLogi('ZZ-DUPE1');
    console.log(`[A13][DUPE2 contact vide + doublon preexistant] toast="${te}" avertissement=${te.includes(WARN)} DB=${JSON.stringify(await row('DUPE1'))} outbox=${await outboxFor('DUPE1')}`);
  });

  test('2b duree toast Logistique', async () => {
    const { window } = env;
    await openLogi('DUP4');
    await paste(CI, '0708090010');
    await waitNoToast();
    await window.mouse.move(5, 5);
    await window.locator(RI).fill('ZZ-DUPB4');
    await window.locator(RI).press('Enter');
    const t0 = Date.now();
    let first = -1; let last = -1;
    while (Date.now() - t0 < 40000) {
      const txt = await toastsText();
      if (txt.includes(WARN)) { if (first < 0) first = Date.now() - t0; last = Date.now() - t0; }
      else if (first >= 0) break;
      await window.waitForTimeout(150);
    }
    console.log(`[A13][DUP Logistique duree] apparition~${first}ms disparition~${last}ms duree~${last - first}ms (cap 40s) souris=${JSON.stringify(await window.evaluate(() => 'n/a'))}`);
    await window.mouse.move(5, 5);
  });

  test('3 non-regression NON CLASSE, site, largeur', async () => {
    const { window } = env;
    await gotoHash('#/inventaire/logistique');
    await window.locator(SEARCH).fill(`${P}_NC1`);
    const card = window.locator('div.hover-scale', { hasText: `${P}_NC1 QAPRE` }).first();
    await card.waitFor({ timeout: 8000 });
    const badge = (await card.innerText()).replace(/\s+/g, ' ');
    await card.click();
    await window.locator(RI).waitFor({ timeout: 5000 });
    console.log(`[A13][NC1] liste="${badge.slice(-40)}" champ rangement="${await window.locator(RI).inputValue()}"`);
    await window.getByRole('button', { name: 'Annuler' }).click();
    await window.locator(SEARCH).fill(`${P}_AUTRESITE`);
    await window.waitForTimeout(1500);
    console.log(`[A13][SITE] autre site visible Logistique=${await window.locator(`text=${P}_AUTRESITE`).count()}`);
    const idO = await idOf('AUTRESITE');
    const res = await window.evaluate(async (i) => {
      try { await (window as any).api.cartes.updateRangementEtFiche(i, { rangement: 'ZZ-H', contact: '0708090010' }); return 'OK'; }
      catch (e: any) { return 'ERR ' + (e?.message || e); }
    }, idO);
    console.log(`[A13][SITE] IPC autre site -> ${res} logs=${fmtLogs(await logsFor('AUTRESITE'))}`);
    await gotoHash('#/inventaire/sans-rangement');
    await window.waitForTimeout(1500);
    await window.locator(SEARCH).fill('KOUASSI-KONAN');
    await window.waitForTimeout(1800);
    const cdp = await window.context().newCDPSession(window);
    for (const [w, h] of [[1366, 768], [1280, 720]] as const) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
      await window.waitForTimeout(700);
      const m = await window.evaluate(() => {
        const tb = document.querySelector('table') as HTMLElement; const wrap = tb.parentElement as HTMLElement; const wr = wrap.getBoundingClientRect();
        const btn = tb.querySelector('tbody tr:first-child button') as HTMLElement; const br = btn.getBoundingClientRect();
        return { inner: [innerWidth, innerHeight], wrapClient: wrap.clientWidth, wrapScroll: wrap.scrollWidth, btnVisible: br.right <= wr.right + 0.5 };
      });
      console.log(`[A13][MESURE ${w}x${h}] ${JSON.stringify(m)}`);
      await window.screenshot({ path: join(SHOT_DIR, `sansrang-${w}x${h}.png`) });
    }
    await cdp.send('Emulation.clearDeviceMetricsOverride');
    console.log(`[A13][CONSOLE] erreurs renderer pendant les scenarios (${consoleErrors.length}): ${JSON.stringify(consoleErrors.slice(0, 8))}`);
  });

  test('4 journal d audit (ecran) ADMINISTRATEUR_SITE', async () => {
    const { window } = env;
    await window.getByText('Déconnexion').click();
    await window.waitForURL(/#\/login/, { timeout: 15000 });
    const u = getTestUser('administrateurSite');
    await window.getByTestId('login-input').fill(u.login);
    await window.getByTestId('password-input').fill(u.password);
    await window.getByTestId('login-submit').click();
    await window.waitForTimeout(4000);
    await gotoHash('#/logs');
    await window.waitForTimeout(3000);
    await window.screenshot({ path: join(SHOT_DIR, 'journal-audit.png') });
    const body = await window.evaluate(() => document.body.innerText);
    console.log(`[A13][AUDIT-ECRAN] url=${window.url().split('#')[1]} contient CONTACT_CARTE_MODIFIE=${body.includes('CONTACT_CARTE_MODIFIE')} contient "Contact modifié"=${body.includes('Contact modifié')} contient CENTRE_CARTE=${body.includes('CENTRE_CARTE')} extrait="${body.replace(/\s+/g, ' ').slice(0, 500)}"`);
    const nb = (await dbQuery(`SELECT COUNT(*) c FROM t_logs WHERE action = 'CONTACT_CARTE_MODIFIE'`))[0].c;
    console.log(`[A13][AUDIT] lignes CONTACT_CARTE_MODIFIE en base (tous) = ${nb}`);
  });

  test('cleanup', async () => {
    const del = await dbQuery(`DELETE FROM t_cartes WHERE sync_id LIKE 'zztest-aud-%'`);
    await dbQuery(`DELETE FROM t_outbox WHERE id LIKE 'zztest-aud-%'`).catch(() => undefined);
    const dl = await dbQuery(`DELETE FROM t_logs WHERE detail LIKE '%ZZTEST_AUD%'`).catch(() => [{ changes: 'n/a' }]);
    await dbQuery(`DELETE FROM t_centres WHERE nom LIKE 'ZZTEST_AUD%'`);
    await dbQuery(`DELETE FROM t_sites WHERE nom LIKE 'ZZTEST_AUD%'`);
    const left = (await dbQuery(`SELECT COUNT(*) c FROM t_cartes WHERE sync_id LIKE 'zztest-aud-%'`))[0].c;
    console.log(`[A13][CLEANUP] cartes supprimees=${del[0].changes} logs supprimes=${dl[0].changes} reste cartes=${left}`);
  });
});
