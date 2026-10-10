/**
 * QA Terrain (agent-13) : commit 52c9115, champ contact formaté +225 + refus 11/12 chiffres.
 * Base temporaire jetable, sync coupée (launchSeededApp). Données ZZTEST_ uniquement.
 */
import { test } from '@playwright/test';
import { launchSeededApp, teardownSeededApp, type E2EEnvironment } from '../fixtures/electron-app';
import { getTestUser } from '../fixtures/test-users';
import { join } from 'path';
import { mkdirSync } from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const SHOT_DIR = join(__dirname, '..', '..', 'test-results', 'agent13-format-shots');
const P = 'ZZTEST_FMT';
const NOW = Date.now();
const CI_L = 'input[placeholder="+225 01 02 03 04 05"]';

test.describe.serial('QA Terrain contact formate 52c9115', () => {
  let env: E2EEnvironment;
  let site2: number;
  let centre2: number;

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
      [opts.noms ?? `${P}_${key}`, opts.prenoms ?? 'QAPRE', opts.site ?? env.seed.siteId, opts.centre ?? env.seed.centreId, `zztest-fmt-${key}-${NOW}`,
        opts.secu ?? `ZZTEST-FMT-${key}-${NOW}`, opts.contact ?? null, opts.rangement ?? null]
    );
  }
  const sid = (key: string) => `zztest-fmt-${key}-${NOW}`;
  const row = async (key: string) => (await dbQuery(
    `SELECT contact, rangement, is_dirty, cle_doublon_flex FROM t_cartes WHERE sync_id = ?`, [sid(key)]))[0];
  const outboxOf = async (key: string) => {
    try { return JSON.stringify((await dbQuery(`SELECT status, operation, attempts FROM t_outbox WHERE id = ?`, [sid(key)]))); } catch (e: any) { return 'ERR ' + e.message; }
  };
  const logsOf = async (key: string) => {
    try {
      const id = (await dbQuery(`SELECT id_carte FROM t_cartes WHERE sync_id = ?`, [sid(key)]))[0].id_carte;
      return JSON.stringify((await dbQuery(`SELECT action, substr(detail,1,90) d FROM t_logs WHERE detail LIKE ? OR valeur_apres LIKE ? ORDER BY id_log DESC LIMIT 3`, [`%${id}%`, `%${sid(key)}%`])));
    } catch (e: any) { return 'ERR ' + e.message; }
  };
  const toastsText = async () => (await env.window.locator('[role="status"]').allTextContents()).join(' | ');
  async function waitNoToast() {
    try { await env.window.waitForFunction(() => document.querySelectorAll('[role="status"]').length === 0, null, { timeout: 9000 }); } catch { /* ignore */ }
  }
  async function gotoHash(h: string) {
    await env.window.evaluate((x) => { window.location.hash = x; }, h);
    await env.window.waitForTimeout(1200);
  }
  const caret = async (sel: string) => env.window.locator(sel).first().evaluate((el: HTMLInputElement) => [el.selectionStart, el.selectionEnd]);
  const setCaret = async (sel: string, pos: number) => env.window.locator(sel).first().evaluate((el: HTMLInputElement, p: number) => { el.focus(); el.setSelectionRange(p, p); }, pos);

  async function openLogi(key: string) {
    const { window } = env;
    await gotoHash('#/inventaire/logistique');
    const annuler = window.getByRole('button', { name: 'Annuler' });
    if (await annuler.count()) await annuler.click();
    const search = window.locator('input[placeholder="Saisir les critères..."]');
    await search.waitFor({ state: 'visible', timeout: 10000 });
    await search.fill(`${P}_${key}`);
    await window.locator(`text=${P}_${key} QAPRE`).first().click();
    const ci = window.locator(CI_L);
    await ci.waitFor({ state: 'visible', timeout: 5000 });
    return ci;
  }
  async function pasteInto(sel: string, text: string) {
    const { window } = env;
    const ci = window.locator(sel).first();
    await ci.fill('');
    await ci.focus();
    await window.keyboard.insertText(text);
    return ci.inputValue();
  }
  async function submitLogi(rangement: string): Promise<string> {
    const { window } = env;
    await window.locator('input[placeholder="Ex: MAIRIE-A3"]').fill(rangement);
    await waitNoToast();
    await window.getByRole('button', { name: /Valider \(Entrée\)/ }).click();
    await window.waitForTimeout(1500);
    return toastsText();
  }

  test('00 setup + login', async () => {
    const r = await dbQuery(`INSERT INTO t_sites (nom, code, is_active, max_centres, is_permanent, sync_id) VALUES (?, ?, 1, 4, 1, ?)`,
      [`${P}_SITE2`, `E2E-FMT-${NOW}`, `e2e-fmt-site2-${NOW}`]);
    site2 = r[0].lastInsertRowid;
    const c = await dbQuery(`INSERT INTO t_centres (site_id, nom, numero, sync_id) VALUES (?, ?, 1, ?)`, [site2, `${P}_CENTRE2`, `e2e-fmt-c2-${NOW}`]);
    centre2 = c[0].lastInsertRowid;
    for (const k of ['TYPE', 'SEUL', 'NOCT', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P11', 'P12', 'PMIX', 'P13NO225', 'P225NOPLUS', 'NEUF', 'KEEP', 'KEEPVIDE']) await addCarte(k);
    await addCarte('PREF', { contact: '0102030405' });
    await addCarte('H5', { contact: '12345' });
    await addCarte('H11', { contact: '07080900101' });
    await addCarte('AUTRESITE', { site: site2, centre: centre2 });
    await addCarte('KEEP', { contact: '0102030405' }).catch(() => undefined);
    await addCarte('RTYPE'); await addCarte('R1ENTREE'); await addCarte('R2OK'); await addCarte('R9NEUF');
    await addCarte('R3H', { contact: '12345' });
    // Cartes réalistes pour la mesure de largeur
    await addCarte('LAY1', { contact: '0102030405', noms: 'KOUASSI-KONAN', prenoms: 'ADJOUA MARIE', secu: '2250123456789' });
    await addCarte('LAY2', { contact: '0708090010', noms: 'TRAORE', prenoms: 'MAMADOU', secu: '1990123456781' });
    const u = getTestUser('operateurLogistique');
    const { window } = env;
    await window.waitForURL(/#\/login/, { timeout: 30000 });
    await window.getByTestId('login-input').fill(u.login);
    await window.getByTestId('password-input').fill(u.password);
    await window.getByTestId('login-submit').click();
    await window.waitForURL(/#\/inventaire/, { timeout: 20000 });
  });

  test('1a frappe/suppression dans Logistique', async () => {
    const { window } = env;
    await openLogi('TYPE');
    const out: string[] = [];
    const ci = window.locator(CI_L);
    console.log(`[A13][L-init] valeur initiale="${await ci.inputValue()}"`);
    await ci.focus();
    for (const d of '0708090010') { await window.keyboard.type(d); out.push(await ci.inputValue()); }
    console.log(`[A13][L-type] etapes: ${JSON.stringify(out)} caret=${JSON.stringify(await caret(CI_L))}`);
    await window.keyboard.type('9');
    console.log(`[A13][L-11e] apres 11e chiffre "9": "${await ci.inputValue()}"`);
    await window.screenshot({ path: join(SHOT_DIR, 'logi-typed-full.png') });
    // Backspace au milieu apres "+225 07 08" (index 10)
    await setCaret(CI_L, 10);
    await window.keyboard.press('Backspace');
    console.log(`[A13][L-bs-milieu] caret@10 Backspace -> "${await ci.inputValue()}" caret=${JSON.stringify(await caret(CI_L))}`);
    // Backspace juste apres un espace (index 8 = apres "+225 07 ")
    const before = await ci.inputValue();
    await setCaret(CI_L, 8);
    await window.keyboard.press('Backspace');
    console.log(`[A13][L-bs-espace] avant="${before}" caret@8 Backspace -> "${await ci.inputValue()}" caret=${JSON.stringify(await caret(CI_L))}`);
    await window.keyboard.press('Backspace');
    console.log(`[A13][L-bs-espace-2] 2e Backspace -> "${await ci.inputValue()}" caret=${JSON.stringify(await caret(CI_L))}`);
    // Insertion d'un chiffre au milieu
    const b2 = await ci.inputValue();
    await setCaret(CI_L, 7);
    await window.keyboard.type('5');
    console.log(`[A13][L-ins-milieu] avant="${b2}" caret@7 type 5 -> "${await ci.inputValue()}" caret=${JSON.stringify(await caret(CI_L))}`);
    // Effacer jusqu'a vide au clavier (Backspace en fin)
    await setCaret(CI_L, (await ci.inputValue()).length);
    const seq: string[] = [];
    for (let i = 0; i < 14; i++) { await window.keyboard.press('Backspace'); seq.push(await ci.inputValue()); if ((await ci.inputValue()) === '') break; }
    console.log(`[A13][L-bs-jusqua-vide] ${JSON.stringify(seq)}`);
    await window.keyboard.type('0');
    console.log(`[A13][L-retaper-0] "${await ci.inputValue()}"`);
    await window.keyboard.press('Backspace');
    console.log(`[A13][L-+225-seul] apres Backspace: "${await ci.inputValue()}"`);
    console.log(`[A13][L-paste +225 seul] "${await pasteInto(CI_L, '+225')}" / "${await pasteInto(CI_L, '+225 ')}"`);
    await window.keyboard.type('0708090010');
    const t = await submitLogi('ZZ-TYPE');
    console.log(`[A13][L-type-save] toast="${t}" DB=${JSON.stringify(await row('TYPE'))}`);
  });

  test('3/4 prefill + vide + seul + historique + invalide', async () => {
    const { window } = env;
    let ci = await openLogi('PREF');
    console.log(`[A13][PRE] prerempli 0102030405 -> "${await ci.inputValue()}"`);
    await window.screenshot({ path: join(SHOT_DIR, 'logi-prefill.png') });
    await ci.fill('');
    let t = await submitLogi('ZZ-PREF');
    console.log(`[A13][KEEP vide] toast="${t}" DB=${JSON.stringify(await row('PREF'))} outbox=${await outboxOf('PREF')}`);
    ci = await openLogi('SEUL');
    console.log(`[A13][PRE-vide] carte sans contact -> "${await ci.inputValue()}"`);
    t = await submitLogi('ZZ-SEUL');
    console.log(`[A13][SEUL] toast="${t}" DB=${JSON.stringify(await row('SEUL'))} outbox=${await outboxOf('SEUL')} logs=${await logsOf('SEUL')}`);
    ci = await openLogi('H5');
    console.log(`[A13][PRE-H5] contact historique 12345 -> "${await ci.inputValue()}"`);
    t = await submitLogi('ZZ-H5');
    console.log(`[A13][H5 non modifie] toast="${t}" DB=${JSON.stringify(await row('H5'))}`);
    ci = await openLogi('H11');
    console.log(`[A13][PRE-H11] contact historique 07080900101 (11 chiffres) -> "${await ci.inputValue()}"`);
    t = await submitLogi('ZZ-H11');
    console.log(`[A13][H11 non modifie] toast="${t}" DB=${JSON.stringify(await row('H11'))}`);
    ci = await openLogi('NEUF');
    await ci.fill('');
    await ci.focus();
    await window.keyboard.type('070809001');
    console.log(`[A13][NEUF] affiche="${await ci.inputValue()}"`);
    await waitNoToast();
    t = await submitLogi('ZZ-NEUF');
    await window.screenshot({ path: join(SHOT_DIR, 'logi-invalide-9.png') });
    console.log(`[A13][NEUF 9 chiffres] toast="${t}" formulaire ouvert=${(await window.locator(CI_L).count()) > 0} DB=${JSON.stringify(await row('NEUF'))} outbox=${await outboxOf('NEUF')}`);
  });

  test('2 collages (affichage + base)', async () => {
    const cases: [string, string][] = [
      ['P1', '0708090010'], ['P2', '07 08 09 00 10'], ['P3', '+225 07 08 09 00 10'], ['P4', '+2250708090010'],
      ['P5', '07-08.09/00 10'], ['P6', '2250708090010'], ['P11', '07080900101'], ['P12', '070809001012'],
      ['PMIX', '07a08b09c00d10'], ['P13NO225', '1230708090010'], ['P225NOPLUS', '22507080900']
    ];
    for (const [k, v] of cases) {
      const ci = await openLogi(k);
      const shown = await pasteInto(CI_L, v);
      const t = await submitLogi('ZZ-' + k);
      console.log(`[A13][PASTE ${k} "${v}"] affiche="${shown}" toast="${t}" DB=${JSON.stringify(await row(k))}`);
      void ci;
    }
  });

  test('5 IPC direct', async () => {
    const calls: [string, string][] = [['P11', '07080900101'], ['P12', '070809001012'], ['P13NO225', '1230708090010'], ['PMIX', '0708090010abc'], ['P1', '+225 07 08 09 00 10'], ['KEEPVIDE', '']];
    for (const [k, v] of calls) {
      const id = (await dbQuery(`SELECT id_carte FROM t_cartes WHERE sync_id=?`, [sid(k)]))[0].id_carte;
      const before = await row(k);
      const res = await env.window.evaluate(async ([i, c]) => {
        try { await (window as any).api.cartes.updateRangementEtFiche(i, { rangement: 'ZZ-IPC', contact: c }); return 'OK'; }
        catch (e: any) { return 'ERR ' + (e?.message || e); }
      }, [id, v] as [number, string]);
      console.log(`[A13][IPC ${k} "${v}"] -> ${res} | avant=${JSON.stringify(before)} apres=${JSON.stringify(await row(k))}`);
    }
  });

  test('1b/6/7 Sans rangement + clavier + mesures', async () => {
    const { window } = env;
    // Logistique : Entree dans contact -> focus rangement
    await openLogi('NOCT');
    await window.waitForTimeout(1000);
    console.log(`[A13][L-focus-initial] champ focus apres selection: placeholder="${await window.evaluate(() => (document.activeElement as HTMLInputElement)?.placeholder)}"`);
    await window.locator(CI_L).click();
    await window.keyboard.type('0708090010');
    await window.keyboard.press('Enter');
    console.log(`[A13][L-Entree] focus apres Entree: placeholder="${await window.evaluate(() => (document.activeElement as HTMLInputElement)?.placeholder)}" formulaire encore ouvert=${(await window.locator('input[placeholder="Ex: MAIRIE-A3"]').count()) > 0} DB=${JSON.stringify(await row('NOCT'))}`);
    await window.getByRole('button', { name: 'Annuler' }).click();

    await gotoHash('#/inventaire/sans-rangement');
    await window.waitForTimeout(2500);
    const rowOf = (k: string) => window.locator('tr', { hasText: `${P}_${k}` });
    const filt = async (k: string) => {
      await window.locator('input[placeholder="Saisir les critères..."]').fill(`${P}_${k}`);
      await window.waitForTimeout(1500);
    };
    const SC = 'input[placeholder="+225 01 02 03 04 05"]';
    const cIn = (k: string) => rowOf(k).locator(SC);
    const rIn = (k: string) => rowOf(k).locator('input[placeholder="Ex: A-12-034"]');

    // Frappe dans Sans rangement
    const out: string[] = [];
    await filt('RTYPE');
    await cIn('RTYPE').focus();
    for (const d of '07080900109') { await window.keyboard.type(d); out.push(await cIn('RTYPE').inputValue()); }
    console.log(`[A13][SR-type] ${JSON.stringify(out)}`);
    await setCaret(`tr:has-text("${P}_RTYPE") ${SC}`, 10);
    await window.keyboard.press('Backspace');
    console.log(`[A13][SR-bs-milieu] -> "${await cIn('RTYPE').inputValue()}" caret=${JSON.stringify(await caret(`tr:has-text("${P}_RTYPE") ${SC}`))}`);
    const seq: string[] = [];
    await setCaret(`tr:has-text("${P}_RTYPE") ${SC}`, (await cIn('RTYPE').inputValue()).length);
    for (let i = 0; i < 14; i++) { await window.keyboard.press('Backspace'); const v = await cIn('RTYPE').inputValue(); seq.push(v); if (v === '') break; }
    console.log(`[A13][SR-bs-jusqua-vide] ${JSON.stringify(seq)}`);

    // Entree avec rangement vide
    await filt('R1ENTREE');
    await cIn('R1ENTREE').fill('');
    await cIn('R1ENTREE').focus();
    await window.keyboard.type('0708090010');
    await waitNoToast();
    await window.keyboard.press('Enter');
    await window.waitForTimeout(1000);
    console.log(`[A13][SR-Entree-rangement-vide] toast="${await toastsText()}" ligne=${await rowOf('R1ENTREE').count()} DB=${JSON.stringify(await row('R1ENTREE'))}`);

    // 9 chiffres + rangement
    await filt('R9NEUF');
    await cIn('R9NEUF').focus();
    await window.keyboard.type('070809001');
    await rIn('R9NEUF').fill('ZZ-R9');
    await waitNoToast();
    await rIn('R9NEUF').press('Enter');
    await window.waitForTimeout(1000);
    console.log(`[A13][SR-9chiffres] toast="${await toastsText()}" ligne=${await rowOf('R9NEUF').count()} DB=${JSON.stringify(await row('R9NEUF'))}`);

    // Collage complet + enregistrement
    await filt('R2OK');
    await pasteInto(`tr:has-text("${P}_R2OK") ${SC}`, '+225 07 08 09 00 10');
    await rIn('R2OK').fill('ZZ-R2');
    await waitNoToast();
    await rIn('R2OK').press('Enter');
    await window.waitForTimeout(1500);
    console.log(`[A13][SR-ok] toast="${await toastsText()}" ligne=${await rowOf('R2OK').count()} DB=${JSON.stringify(await row('R2OK'))} outbox=${await outboxOf('R2OK')}`);

    // historique non modifie
    await filt('R3H');
    console.log(`[A13][SR-H] prerempli="${await cIn('R3H').inputValue()}"`);
    await rIn('R3H').fill('ZZ-R3');
    await waitNoToast();
    await rIn('R3H').press('Enter');
    await window.waitForTimeout(1500);
    console.log(`[A13][SR-H] toast="${await toastsText()}" DB=${JSON.stringify(await row('R3H'))}`);

    // cloisonnement
    await filt('AUTRESITE');
    console.log(`[A13][SR-site] autre site visible=${await window.locator(`text=${P}_AUTRESITE`).count()}`);

    // Mesures de largeur
    await window.locator('input[placeholder="Saisir les critères..."]').fill('KOUASSI-KONAN');
    await window.waitForTimeout(1800);
    const cdp = await window.context().newCDPSession(window);
    for (const [w, h] of [[1366, 768], [1280, 720]] as const) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
      await window.waitForTimeout(800);
      const m = await window.evaluate(() => {
        const t = document.querySelector('table') as HTMLElement;
        const wrap = t.parentElement as HTMLElement;
        const wr = wrap.getBoundingClientRect();
        const inputs = Array.from(wrap.querySelectorAll('tbody tr:first-child input')) as HTMLElement[];
        const btn = wrap.querySelector('tbody tr:first-child button') as HTMLElement | null;
        const vis = (el: HTMLElement | null) => { if (!el) return null; const r = el.getBoundingClientRect(); return { left: Math.round(r.left), right: Math.round(r.right), fullyVisible: r.left >= wr.left - 0.5 && r.right <= wr.right + 0.5 }; };
        return {
          inner: [innerWidth, innerHeight], docScrollW: document.documentElement.scrollWidth,
          table: t.scrollWidth, wrapClient: wrap.clientWidth, wrapScroll: wrap.scrollWidth, overflowX: getComputedStyle(wrap).overflowX,
          wrapRect: { left: Math.round(wr.left), right: Math.round(wr.right) },
          contactInput: vis(inputs[0]), rangementInput: vis(inputs[1]), actionBtn: vis(btn),
          firstRowText: (wrap.querySelector('tbody tr:first-child') as HTMLElement).innerText.replace(/\n+/g, ' / ')
        };
      });
      console.log(`[A13][MESURE ${w}x${h}] ${JSON.stringify(m)}`);
      await window.screenshot({ path: join(SHOT_DIR, `sansrang-${w}x${h}.png`) });
    }
    await cdp.send('Emulation.clearDeviceMetricsOverride');
  });

  test('8 cloisonnement IPC + cleanup', async () => {
    const idOther = (await dbQuery(`SELECT id_carte FROM t_cartes WHERE sync_id=?`, [sid('AUTRESITE')]))[0].id_carte;
    const res = await env.window.evaluate(async (id) => {
      try { await (window as any).api.cartes.updateRangementEtFiche(id, { rangement: 'ZZ-HACK', contact: '+225 07 08 09 00 10' }); return 'OK'; }
      catch (e: any) { return 'ERR ' + (e?.message || e); }
    }, idOther);
    console.log(`[A13][SITE] IPC autre site -> ${res} DB=${JSON.stringify(await row('AUTRESITE'))}`);
    const del = await dbQuery(`DELETE FROM t_cartes WHERE noms LIKE 'ZZTEST_FMT%' OR sync_id LIKE 'zztest-fmt-%'`);
    await dbQuery(`DELETE FROM t_outbox WHERE id LIKE 'zztest-fmt-%'`).catch(() => undefined);
    await dbQuery(`DELETE FROM t_centres WHERE nom LIKE 'ZZTEST_FMT%'`);
    await dbQuery(`DELETE FROM t_sites WHERE nom LIKE 'ZZTEST_FMT%'`);
    const left = (await dbQuery(`SELECT COUNT(*) c FROM t_cartes WHERE sync_id LIKE 'zztest-fmt-%'`))[0].c;
    console.log(`[A13][CLEANUP] cartes supprimees=${del[0].changes} reste=${left}`);
  });
});
