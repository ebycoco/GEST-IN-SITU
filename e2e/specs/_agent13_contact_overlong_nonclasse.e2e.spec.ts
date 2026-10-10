/**
 * QA Terrain (agent-13) : commits c77558d (collage > 10 chiffres, historique > 10) et 9c2aec1 (NON CLASSE).
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
const SHOT_DIR = join(__dirname, '..', '..', 'test-results', 'agent13-overlong-shots');
const P = 'ZZTEST_OVL';
const NOW = Date.now();
const CI = 'input[placeholder="+225 01 02 03 04 05"]';
const RI = 'input[placeholder="Ex: MAIRIE-A3"]';
const SEARCH = 'input[placeholder="Saisir les critères..."]';

test.describe.serial('QA Terrain overlong + NON CLASSE', () => {
  let env: E2EEnvironment;
  let site2: number;
  let centre2: number;
  let centrePfx: number;

  test.beforeAll(async () => {
    mkdirSync(SHOT_DIR, { recursive: true });
    env = await launchSeededApp();
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

  async function addCarte(key: string, opts: { contact?: string | null; rangement?: string | null; site?: number; centre?: number; noms?: string; prenoms?: string; secu?: string } = {}) {
    await dbQuery(
      `INSERT INTO t_cartes (noms, prenoms, statut, site_id, centre_id, sync_id, is_dirty, num_secu, date_de_naissance, lieu_de_naissance, contact, rangement)
       VALUES (?, ?, 'EN STOCK', ?, ?, ?, 0, ?, '1990-01-01', 'ABOBO', ?, ?)`,
      [opts.noms ?? `${P}_${key}`, opts.prenoms ?? 'QAPRE', opts.site ?? env.seed.siteId, opts.centre ?? env.seed.centreId, `zztest-ovl-${key}-${NOW}`,
        opts.secu ?? `ZZTEST-OVL-${key}-${NOW}`, opts.contact ?? null, opts.rangement === undefined ? null : opts.rangement]
    );
  }
  const sid = (key: string) => `zztest-ovl-${key}-${NOW}`;
  const row = async (key: string) => (await dbQuery(
    `SELECT contact, rangement, centre_id, is_dirty FROM t_cartes WHERE sync_id = ?`, [sid(key)]))[0];
  const toastsText = async () => (await env.window.locator('[role="status"]').allTextContents()).join(' | ');
  async function waitNoToast() {
    try { await env.window.waitForFunction(() => document.querySelectorAll('[role="status"]').length === 0, null, { timeout: 9000 }); } catch { /* ignore */ }
  }
  async function gotoHash(h: string) {
    await env.window.evaluate((x) => { window.location.hash = x; }, h);
    await env.window.waitForTimeout(1200);
  }

  async function searchLogi(key: string) {
    const { window } = env;
    await gotoHash('#/inventaire/logistique');
    const annuler = window.getByRole('button', { name: 'Annuler' });
    if (await annuler.count()) await annuler.click();
    await window.locator(SEARCH).waitFor({ state: 'visible', timeout: 10000 });
    await window.locator(SEARCH).fill(`${P}_${key}`);
    await window.locator(`text=${P}_${key} QAPRE`).first().waitFor({ timeout: 8000 });
  }
  async function openLogi(key: string) {
    const { window } = env;
    await searchLogi(key);
    await window.locator(`text=${P}_${key} QAPRE`).first().click();
    const ci = window.locator(CI);
    await ci.waitFor({ state: 'visible', timeout: 5000 });
    await window.waitForTimeout(500);
    return ci;
  }
  async function paste(sel: string, text: string, selectAll = true) {
    const { window } = env;
    const ci = window.locator(sel).first();
    await ci.focus();
    if (selectAll) await window.keyboard.press('Control+A');
    await window.keyboard.insertText(text);
    return ci.inputValue();
  }
  async function submitLogi(rangement: string | null): Promise<string> {
    const { window } = env;
    if (rangement !== null) await window.locator(RI).fill(rangement);
    await waitNoToast();
    await window.getByRole('button', { name: /Valider \(Entrée\)/ }).click();
    await window.waitForTimeout(1500);
    return toastsText();
  }

  test('00 setup + login', async () => {
    const r = await dbQuery(`INSERT INTO t_sites (nom, code, is_active, max_centres, is_permanent, sync_id) VALUES (?, ?, 1, 4, 1, ?)`, [`${P}_SITE2`, `E2E-OVL-${NOW}`, `e2e-ovl-site2-${NOW}`]);
    site2 = r[0].lastInsertRowid;
    const c = await dbQuery(`INSERT INTO t_centres (site_id, nom, numero, sync_id) VALUES (?, ?, 1, ?)`, [site2, `${P}_CENTRE2`, `e2e-ovl-c2-${NOW}`]);
    centre2 = c[0].lastInsertRowid;
    const cp = await dbQuery(`INSERT INTO t_centres (site_id, nom, numero, sync_id, prefixe_rangement) VALUES (?, ?, 2, ?, 'ZZPFX')`, [env.seed.siteId, `${P}_CENTREPFX`, `e2e-ovl-cpfx-${NOW}`]);
    centrePfx = cp[0].lastInsertRowid;
    console.log(`[A13][SETUP] centre seed=${env.seed.centreId} centre prefixe ZZPFX=${centrePfx}`);
    for (const k of ['T1', 'T2', 'T3', 'T4', 'T5', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'V7', 'V8', 'V9', 'V10', 'TYPE11', 'FILLED', 'PREF', 'NEUF', 'SEUL', 'KEEP', 'S_T1', 'S_T2', 'S_V1', 'S_V2', 'S_H11', 'S_H11B', 'S_H11C', 'S_H5']) await addCarte(k);
    await addCarte('KEEP2', { contact: '0102030405' });
    await addCarte('H11', { contact: '07080900101' });
    await addCarte('H11B', { contact: '07080900101' });
    await addCarte('H12', { contact: '070809001012' });
    await addCarte('H12B', { contact: '070809001012' });
    await addCarte('H5', { contact: '12345' });
    await addCarte('NC1', { rangement: 'NON CLASSE' });
    await addCarte('NC2', { rangement: 'non classe' });
    await addCarte('NC3', { rangement: ' NON CLASSE ' });
    await addCarte('NC4', { rangement: null });
    await addCarte('NC5', { rangement: '' });
    await addCarte('NC6', { rangement: 'ZZ-AB12' });
    await addCarte('AUTRESITE', { site: site2, centre: centre2 });
    await addCarte('LAY1', { contact: '0102030405', noms: 'KOUASSI-KONAN', prenoms: 'ADJOUA MARIE', secu: '2250123456789' });
    const u = getTestUser('operateurLogistique');
    const { window } = env;
    await window.waitForURL(/#\/login/, { timeout: 30000 });
    await window.getByTestId('login-input').fill(u.login);
    await window.getByTestId('password-input').fill(u.password);
    await window.getByTestId('login-submit').click();
    await window.waitForURL(/#\/inventaire/, { timeout: 20000 });
  });

  test('A Logistique collages', async () => {
    const { window } = env;
    // trop longs
    for (const [k, v] of [['T1', '07080900101'], ['T2', '070809001012'], ['T3', '1230708090010']] as const) {
      const ci = await openLogi(k);
      await waitNoToast();
      const shown = await paste(CI, v);
      await window.waitForTimeout(500);
      const toast = await toastsText();
      console.log(`[A13][A-LONG ${k} "${v}"] champ="${shown}" toast="${toast}"`);
      const t2 = await submitLogi('ZZ-' + k);
      console.log(`[A13][A-LONG ${k}] apres validation toast="${t2}" DB=${JSON.stringify(await row(k))}`);
      void ci;
    }
    // 11e chiffre tape
    const ci = await openLogi('TYPE11');
    await waitNoToast();
    await ci.focus();
    await window.keyboard.type('0708090010');
    await window.keyboard.type('9');
    await window.waitForTimeout(500);
    console.log(`[A13][A-11e tape] champ="${await ci.inputValue()}" toasts="${await toastsText()}"`);
    // 10 chiffres colles sur champ deja rempli (curseur en fin, sans select all)
    const afterAppend = await paste(CI, '0102030405', false);
    await window.waitForTimeout(500);
    console.log(`[A13][A-10chiffres sur champ rempli, ajout en fin] champ="${afterAppend}" toast="${await toastsText()}"`);
    const afterReplace = await paste(CI, '0102030405', true);
    console.log(`[A13][A-10chiffres sur champ rempli, tout selectionne] champ="${afterReplace}"`);
    await submitLogi('ZZ-TYPE11');
    console.log(`[A13][A-TYPE11 DB] ${JSON.stringify(await row('TYPE11'))}`);
    // formes valides
    const valid: [string, string][] = [['V1', '0708090010'], ['V2', '07 08 09 00 10'], ['V3', '+225 07 08 09 00 10'], ['V4', '+2250708090010'], ['V5', '2250708090010'], ['V6', '07-08.09/00 10'], ['V7', '07a08b09c00d10'], ['V8', '22507080900']];
    for (const [k, v] of valid) {
      await openLogi(k);
      await waitNoToast();
      const shown = await paste(CI, v);
      const t = await submitLogi('ZZ-' + k);
      console.log(`[A13][A-VALID ${k} "${v}"] champ="${shown}" toast="${t}" DB=${JSON.stringify(await row(k))}`);
    }
  });

  test('B historique >10 (Logistique)', async () => {
    const { window } = env;
    let ci = await openLogi('H11');
    const info = await ci.evaluate((el: HTMLInputElement) => ({ value: el.value, border: getComputedStyle(el).borderTopColor, title: el.title }));
    console.log(`[A13][B-H11 affichage] ${JSON.stringify(info)}`);
    await window.screenshot({ path: join(SHOT_DIR, 'logi-H11-historique.png') });
    let t = await submitLogi('ZZ-H11');
    console.log(`[A13][B-H11 rangement seul] toast="${t}" DB=${JSON.stringify(await row('H11'))}`);
    ci = await openLogi('H11B');
    await waitNoToast();
    const shown = await paste(CI, '0708090010');
    t = await submitLogi('ZZ-H11B');
    console.log(`[A13][B-H11B corrige en 10 chiffres] champ="${shown}" toast="${t}" DB=${JSON.stringify(await row('H11B'))}`);
    ci = await openLogi('H12');
    await waitNoToast();
    await ci.focus();
    await window.keyboard.press('End');
    await window.keyboard.press('Backspace');
    console.log(`[A13][B-H12 apres Backspace] champ="${await ci.inputValue()}"`);
    const shownP = await paste(CI, '0708090010999');
    console.log(`[A13][B-H12 colle 13 chiffres sur historique 12] champ="${shownP}" toast="${await toastsText()}"`);
    await ci.focus();
    await window.keyboard.press('Control+A');
    await window.keyboard.type('07080900101');
    console.log(`[A13][B-H12 reste >10 apres saisie 11 chiffres] champ="${await ci.inputValue()}" toast="${await toastsText()}"`);
    t = await submitLogi('ZZ-H12');
    console.log(`[A13][B-H12 valeur >10 modifiee] toast="${t}" DB=${JSON.stringify(await row('H12'))}`);
    ci = await openLogi('H12B');
    await ci.focus();
    await window.keyboard.press('End');
    await window.keyboard.press('Backspace');
    console.log(`[A13][B-H12B Backspace -> 11 chiffres] champ="${await ci.inputValue()}" toast="${await toastsText()}"`);
    t = await submitLogi('ZZ-H12B');
    console.log(`[A13][B-H12B envoi 11 chiffres modifies] toast="${t}" formulaire ouvert=${(await window.locator(RI).count()) > 0} DB=${JSON.stringify(await row('H12B'))}`);
    ci = await openLogi('H5');
    console.log(`[A13][B-H5 affichage] "${await ci.inputValue()}"`);
    t = await submitLogi('ZZ-H5');
    console.log(`[A13][B-H5 rangement seul] toast="${t}" DB=${JSON.stringify(await row('H5'))}`);
  });

  test('C NON CLASSE', async () => {
    const { window } = env;
    for (const k of ['NC1', 'NC2', 'NC3', 'NC4', 'NC5', 'NC6']) {
      await searchLogi(k);
      const card = window.locator('div.hover-scale', { hasText: `${P}_${k} QAPRE` }).first();
      const badge = (await card.innerText()).replace(/\s+/g, ' ');
      await card.click();
      await window.locator(RI).waitFor({ state: 'visible', timeout: 5000 });
      await window.waitForTimeout(400);
      console.log(`[A13][C-${k}] liste="${badge}" champ rangement="${await window.locator(RI).inputValue()}" (DB avant=${JSON.stringify((await row(k)).rangement)})`);
      if (k === 'NC1') await window.screenshot({ path: join(SHOT_DIR, 'logi-NC1-champ-vide.png') });
      if (k === 'NC6') await window.screenshot({ path: join(SHOT_DIR, 'logi-NC6-prerempli.png') });
    }
    // valider vide (NC1)
    await openLogi('NC1');
    await window.locator(RI).fill('');
    let t = await submitLogi(null);
    console.log(`[A13][C-NC1 valide vide] toast="${t}" DB=${JSON.stringify(await row('NC1'))}`);
    t = await submitLogi('ZZPFX-5');
    console.log(`[A13][C-NC1 rangement ZZPFX-5] toast="${t}" DB=${JSON.stringify(await row('NC1'))} (centre avant=${env.seed.centreId}, centre prefixe=${centrePfx})`);
    await openLogi('NC4');
    t = await submitLogi('ZZ-NC4');
    console.log(`[A13][C-NC4 rangement ZZ-NC4 sans prefixe] toast="${t}" DB=${JSON.stringify(await row('NC4'))}`);
  });

  test('D non-regression + Sans rangement', async () => {
    const { window } = env;
    await openLogi('SEUL');
    let t = await submitLogi('ZZ-SEUL');
    console.log(`[A13][D-SEUL] toast="${t}" DB=${JSON.stringify(await row('SEUL'))}`);
    let ci = await openLogi('KEEP2');
    console.log(`[A13][D-KEEP2 prerempli] "${await ci.inputValue()}"`);
    await ci.fill('');
    t = await submitLogi('ZZ-KEEP2');
    console.log(`[A13][D-KEEP2 vide] toast="${t}" DB=${JSON.stringify(await row('KEEP2'))}`);
    ci = await openLogi('NEUF');
    await ci.focus();
    await window.keyboard.type('070809001');
    t = await submitLogi('ZZ-NEUF');
    console.log(`[A13][D-NEUF 9 chiffres] toast="${t}" DB=${JSON.stringify(await row('NEUF'))}`);

    // Sans rangement
    await gotoHash('#/inventaire/sans-rangement');
    await window.waitForTimeout(2500);
    const filt = async (k: string) => { await window.locator(SEARCH).fill(`${P}_${k}`); await window.waitForTimeout(1500); };
    const rowOf = (k: string) => window.locator('tr', { hasText: `${P}_${k}` });
    const cIn = (k: string) => rowOf(k).locator(CI);
    const rIn = (k: string) => rowOf(k).locator('input[placeholder="Ex: A-12-034"]');
    const sr = async (k: string, text: string, selectAll = true) => {
      await cIn(k).focus();
      if (selectAll) await window.keyboard.press('Control+A');
      await window.keyboard.insertText(text);
      return cIn(k).inputValue();
    };
    for (const [k, v] of [['S_T1', '07080900101'], ['S_T2', '1230708090010']] as const) {
      await filt(k);
      await waitNoToast();
      const shown = await sr(k, v);
      await window.waitForTimeout(400);
      const toast = await toastsText();
      await rIn(k).fill('ZZ-' + k);
      await waitNoToast();
      await rIn(k).press('Enter');
      await window.waitForTimeout(1200);
      console.log(`[A13][SR-LONG ${k} "${v}"] champ="${shown}" toast="${toast}" apres enregistrement toast="${await toastsText()}" DB=${JSON.stringify(await row(k))}`);
    }
    await filt('S_T1');
    await rIn('S_T1').press('Enter').catch(() => undefined);
    for (const [k, v] of [['S_V1', '+225 07 08 09 00 10'], ['S_V2', '07a08b09c00d10']] as const) {
      await filt(k);
      await waitNoToast();
      const shown = await sr(k, v);
      await rIn(k).fill('ZZ-' + k);
      await waitNoToast();
      await rIn(k).press('Enter');
      await window.waitForTimeout(1200);
      console.log(`[A13][SR-VALID ${k} "${v}"] champ="${shown}" DB=${JSON.stringify(await row(k))}`);
    }
    // 11e chiffre au clavier
    await filt('S_H5');
    await waitNoToast();
    await cIn('S_H5').focus();
    await window.keyboard.type('07080900109');
    console.log(`[A13][SR-11e tape] champ="${await cIn('S_H5').inputValue()}" toasts="${await toastsText()}"`);
    // historique 11 chiffres : on cree 3 lignes sans rangement
    await dbQuery(`UPDATE t_cartes SET rangement = NULL WHERE sync_id IN (?, ?)`, [sid('H11'), sid('H11B')]).catch(() => undefined);
    await addCarte('RHA', { contact: '07080900101' });
    await addCarte('RHB', { contact: '07080900101' });
    await addCarte('RHC', { contact: '12345' });
    await gotoHash('#/inventaire/sans-rangement');
    await window.waitForTimeout(2000);
    await filt('RHA');
    await waitNoToast();
    const kv = ['RHA', 'RHB'];
    const info = await cIn('RHA').evaluate((el: HTMLInputElement) => ({ value: el.value, border: getComputedStyle(el).borderTopColor, title: el.title }));
    console.log(`[A13][SR-H11 affichage] ${JSON.stringify(info)}`);
    await window.screenshot({ path: join(SHOT_DIR, 'sansrang-H11.png') });
    await rIn('RHA').fill('ZZ-RHA');
    await rIn('RHA').press('Enter');
    await window.waitForTimeout(1200);
    console.log(`[A13][SR-H11 rangement seul] DB=${JSON.stringify(await row('RHA'))}`);
    await filt('RHB');
    const shownB = await sr('RHB', '0708090010');
    await rIn('RHB').fill('ZZ-RHB');
    await rIn('RHB').press('Enter');
    await window.waitForTimeout(1200);
    console.log(`[A13][SR-H11B corrige] champ="${shownB}" DB=${JSON.stringify(await row('RHB'))}`);
    await filt('RHC');
    console.log(`[A13][SR-H5 affichage] "${await cIn('RHC').inputValue()}"`);
    await rIn('RHC').fill('ZZ-RHC');
    await rIn('RHC').press('Enter');
    await window.waitForTimeout(1200);
    console.log(`[A13][SR-H5] DB=${JSON.stringify(await row('RHC'))} (unused=${kv.length})`);
    // 9 chiffres sans rangement-erreur
    await filt('S_V1');

    // cloisonnement
    await filt('AUTRESITE');
    console.log(`[A13][D-site] autre site visible Sans rangement=${await window.locator(`text=${P}_AUTRESITE`).count()}`);
    await searchLogi('SEUL').catch(() => undefined);
    await window.locator(SEARCH).fill(`${P}_AUTRESITE`);
    await window.waitForTimeout(1500);
    console.log(`[A13][D-site] autre site visible Logistique=${await window.locator(`text=${P}_AUTRESITE`).count()}`);
    const idOther = (await dbQuery(`SELECT id_carte FROM t_cartes WHERE sync_id=?`, [sid('AUTRESITE')]))[0].id_carte;
    const res = await window.evaluate(async (id) => {
      try { await (window as any).api.cartes.updateRangementEtFiche(id, { rangement: 'ZZ-HACK' }); return 'OK'; }
      catch (e: any) { return 'ERR ' + (e?.message || e); }
    }, idOther);
    console.log(`[A13][D-site] IPC autre site -> ${res} DB=${JSON.stringify(await row('AUTRESITE'))}`);

    // mesures
    await gotoHash('#/inventaire/sans-rangement');
    await window.waitForTimeout(2000);
    await window.locator(SEARCH).fill('KOUASSI-KONAN');
    await window.waitForTimeout(1800);
    const cdp = await window.context().newCDPSession(window);
    for (const [w, h] of [[1366, 768], [1280, 720]] as const) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
      await window.waitForTimeout(800);
      const m = await window.evaluate(() => {
        const tb = document.querySelector('table') as HTMLElement;
        const wrap = tb.parentElement as HTMLElement;
        const wr = wrap.getBoundingClientRect();
        const inputs = Array.from(wrap.querySelectorAll('tbody tr:first-child input')) as HTMLElement[];
        const btn = wrap.querySelector('tbody tr:first-child button') as HTMLElement | null;
        const vis = (el: HTMLElement | null) => { if (!el) return null; const r = el.getBoundingClientRect(); return { left: Math.round(r.left), right: Math.round(r.right), fullyVisible: r.left >= wr.left - 0.5 && r.right <= wr.right + 0.5 }; };
        return { inner: [innerWidth, innerHeight], table: tb.scrollWidth, wrapClient: wrap.clientWidth, wrapScroll: wrap.scrollWidth, wrapRect: [Math.round(wr.left), Math.round(wr.right)], contact: vis(inputs[0]), rangement: vis(inputs[1]), action: vis(btn), contactValue: (inputs[0] as HTMLInputElement).value };
      });
      console.log(`[A13][D-MESURE ${w}x${h}] ${JSON.stringify(m)}`);
      await window.screenshot({ path: join(SHOT_DIR, `sansrang-${w}x${h}.png`) });
    }
    await cdp.send('Emulation.clearDeviceMetricsOverride');
  });

  test('cleanup', async () => {
    const del = await dbQuery(`DELETE FROM t_cartes WHERE noms LIKE 'ZZTEST_OVL%' OR sync_id LIKE 'zztest-ovl-%'`);
    await dbQuery(`DELETE FROM t_outbox WHERE id LIKE 'zztest-ovl-%'`).catch(() => undefined);
    await dbQuery(`DELETE FROM t_centres WHERE nom LIKE 'ZZTEST_OVL%'`);
    await dbQuery(`DELETE FROM t_sites WHERE nom LIKE 'ZZTEST_OVL%'`);
    const left = (await dbQuery(`SELECT COUNT(*) c FROM t_cartes WHERE sync_id LIKE 'zztest-ovl-%'`))[0].c;
    console.log(`[A13][CLEANUP] cartes supprimees=${del[0].changes} reste=${left}`);
  });
});
