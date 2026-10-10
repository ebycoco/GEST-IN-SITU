/**
 * QA Terrain (agent-13) : commit b747acb, n° secu jamais en notation scientifique.
 * Base temporaire jetable, sync coupee (launchSeededApp). Exports dans un dossier temporaire (dialog stubbe).
 */
import { test } from '@playwright/test';
import { launchSeededApp, teardownSeededApp, type E2EEnvironment } from '../fixtures/electron-app';
import { getTestUser } from '../fixtures/test-users';
import { join } from 'path';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const SHOT_DIR = join(__dirname, '..', '..', 'test-results', 'agent13-numsecu-shots');
const NOW = Date.now();
const P = 'ZZTEST_NS';
const SCI_RE = /\d[eE]\+\d/;

// [cle, num_secu, statut, rangement, extra]
const SEEDS: Array<[string, string | null, string, string | null]> = [
  ['SCI1', '3,84E+12', 'EN STOCK', 'ZZ-R1'],
  ['SCI2', '3.84E+12', 'EN STOCK', 'ZZ-R2'],
  ['SCI3', '1,2346E+12', 'EN STOCK', 'ZZ-R3'],
  ['SCI4', '3,84e+12', 'EN STOCK', 'ZZ-R4'],
  ['NORM', '3840000000000', 'EN STOCK', 'ZZ-R5'],
  ['NORM2', '1234567890123', 'EN STOCK', 'ZZ-R6'],
  ['VIDE', '', 'EN STOCK', 'ZZ-R7'],
  ['NUL', null, 'EN STOCK', 'ZZ-R8'],
  ['E11', '3,84E+11', 'EN STOCK', 'ZZ-R9'],
  ['ABC', 'ABC', 'EN STOCK', 'ZZ-R10'],
  ['DELIV', '3,86E+12', 'DELIVRE', 'ZZ-R11'],
  ['BROU', '3,87E+12', 'BROUILLON', null],
  ['SANS', '3,89E+12', 'EN STOCK', null],
  ['DOUB1', '3,90E+12', 'EN STOCK', 'ZZ-R12'],
  ['DOUB2', '3,91E+12', 'EN STOCK', 'ZZ-R13'],
  ['MCENT', '3,88E+12', 'EN STOCK', 'MCX-1'],
  ['MISSL', '3,93E+12', 'EN STOCK', 'ZZ-R14'],
  ['MISSC', '3,94E+12', 'EN STOCK', 'ZZ-R15'],
  ['ZERO', '0,384E+12', 'EN STOCK', 'ZZ-R16'],
  ['BNORM', '3881234567890', 'BROUILLON', null]
];

test.describe.serial('QA Terrain correctif 384c7e0', () => {
  let env: E2EEnvironment;
  let tmpOut: string;
  let site2: number;
  let centre2: number;
  let cMc: number;
  const consoleErrors: string[] = [];

  test.beforeAll(async () => {
    mkdirSync(SHOT_DIR, { recursive: true });
    tmpOut = mkdtempSync(join(tmpdir(), 'a13-exports-'));
    env = await launchSeededApp();
    env.window.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    env.window.on('pageerror', (e) => consoleErrors.push('[pageerror] ' + e.message));
  });
  test.afterAll(async () => {
    if (env) await teardownSeededApp(env, false);
    try { rmSync(tmpOut, { recursive: true, force: true }); } catch { /* ignore */ }
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
  const sid = (k: string) => `zztest-ns-${k}-${NOW}`;
  const numSecuDb = async (k: string) => (await dbQuery(`SELECT num_secu FROM t_cartes WHERE sync_id=?`, [sid(k)]))[0]?.num_secu;
  async function seedAll() {
    const adminId = env.seed.userIds['administrateurSite'];
    for (const [k, secu, statut, rang] of SEEDS) {
      const dup = k.startsWith('DOUB');
      const noms = dup ? `${P}_DOUB` : `${P}_${k}`;
      const centre = k === 'MCENT' ? env.seed.centreId : env.seed.centreId;
      try {
        await dbQuery(
          `INSERT INTO t_cartes (noms, prenoms, statut, site_id, centre_id, sync_id, is_dirty, num_secu, date_de_naissance, lieu_de_naissance, contact, rangement, cle_doublon, cle_doublon_flex, created_by)
           VALUES (?, 'QAPRE', ?, ?, ?, ?, 0, ?, '1990-01-01', ?, ?, ?, ?, ?, ?)`,
          [noms, statut, env.seed.siteId, centre, sid(k), secu, k === 'MISSL' ? null : 'ABOBO', k === 'MISSC' ? null : '0708090010', rang,
            dup ? `${noms}|QAPRE|1990-01-01|ABOBO|0708090010` : null, dup ? `${noms}|QAPRE|1990-01-01|0708090010` : null, adminId]
        );
      } catch (e: any) { console.log(`[A13][SEED-ERR ${k}] ${e.message.split('\n')[0].slice(0, 160)}`); }
    }
  }
  async function gotoHash(h: string, wait = 2500) {
    await env.window.evaluate((x) => { window.location.hash = x; }, h);
    await env.window.waitForTimeout(wait);
  }
  async function scan(label: string) {
    const r = await env.window.evaluate((reSrc) => {
      const re = new RegExp(reSrc);
      const text = document.body.innerText;
      const hits: string[] = [];
      for (const line of text.split('\n')) if (re.test(line)) hits.push(line.slice(0, 120));
      const attrHits: string[] = [];
      document.querySelectorAll('*').forEach((el) => {
        for (const a of ['title', 'aria-label', 'value', 'placeholder']) {
          const v = (el as HTMLElement).getAttribute?.(a) ?? '';
          if (v && re.test(v)) attrHits.push(`${el.tagName}[${a}]=${v.slice(0, 60)}`);
        }
        if ((el as HTMLInputElement).value && re.test((el as HTMLInputElement).value)) attrHits.push(`${el.tagName}.value=${(el as HTMLInputElement).value.slice(0, 60)}`);
      });
      const conv = (text.match(/3840000000000/g) || []).length + (text.match(/1234600000000/g) || []).length;
      const conv2 = (text.match(/38[5-9]0000000000|3910000000000/g) || []).length;
      return { hits: hits.slice(0, 5), attrHits: Array.from(new Set(attrHits)).slice(0, 5), conv, conv2, len: text.length };
    }, SCI_RE.source);
    console.log(`[A13][SCAN ${label}] E+texte=${r.hits.length} ${JSON.stringify(r.hits)} E+attr=${JSON.stringify(r.attrHits)} converti(3840000000000/1234600000000)=${r.conv} autres convertis=${r.conv2}`);
    return r;
  }
  const toastsText = async () => (await env.window.locator('[role="status"]').allTextContents()).join(' | ');

  test('00 setup + login admin site', async () => {
    await seedAll();
    cMc = (await dbQuery(`INSERT INTO t_centres (site_id, nom, numero, sync_id, prefixe_rangement) VALUES (?, ?, 2, ?, 'MCX')`, [env.seed.siteId, `${P}_CMC`, `e2e-ns-cmc-${NOW}`]))[0].lastInsertRowid;
    const r2 = await dbQuery(`INSERT INTO t_sites (nom, code, is_active, max_centres, is_permanent, sync_id) VALUES (?, ?, 1, 4, 1, ?)`, [`${P}_SITE2`, `E2E-NS-${NOW}`, `e2e-ns-site2-${NOW}`]);
    site2 = r2[0].lastInsertRowid;
    centre2 = (await dbQuery(`INSERT INTO t_centres (site_id, nom, numero, sync_id) VALUES (?, ?, 1, ?)`, [site2, `${P}_C2`, `e2e-ns-c2-${NOW}`]))[0].lastInsertRowid;
    await dbQuery(`INSERT INTO t_cartes (noms, prenoms, statut, site_id, centre_id, sync_id, is_dirty, num_secu, contact, rangement) VALUES (?, 'QAPRE', 'EN STOCK', ?, ?, ?, 0, '3,92E+12', '0708090010', 'ZZ-S2')`, [`${P}_AUTRESITE`, site2, centre2, sid('AUTRESITE')]);
    // anomalie brute (import) avec n° sci
    try {
      await dbQuery(`INSERT INTO t_import_anomalies (noms, prenoms, num_secu, site_id, erreur_message, sync_id) VALUES (?, 'QAPRE', '3,84E+12', ?, 'NUM_SECU_INVALIDE', ?)`, [`${P}_ANOM`, env.seed.siteId, `zztest-ns-anom-${NOW}`]);
    } catch (e: any) { console.log(`[A13][SEED-ERR anomalie] ${e.message.split('\n')[0].slice(0, 200)}`); }
    console.log(`[A13][SETUP] site=${env.seed.siteId} cartes seed=${(await dbQuery(`SELECT COUNT(*) c FROM t_cartes WHERE noms LIKE 'ZZTEST_NS%'`))[0].c}`);
    const u = getTestUser('administrateurSite');
    const { window } = env;
    await window.waitForURL(/#\/login/, { timeout: 30000 });
    await window.getByTestId('login-input').fill(u.login);
    await window.getByTestId('password-input').fill(u.password);
    await window.getByTestId('login-submit').click();
    await window.waitForTimeout(4000);
    console.log(`[A13][LOGIN] url=${window.url().split('#')[1]}`);
  });

  test('1 crawl des ecrans (admin site)', async () => {
    const { window } = env;
    const routes = ['#/cartes', '#/search', '#/table-cartes', '#/agent-verification', '#/agent-verification/recherche', '#/agent-saisie', '#/agent-saisie/brouillons', '#/agent-saisie/historique',
      '#/inventaire', '#/inventaire/logistique', '#/inventaire/anomalies-centre', '#/inventaire/sans-rangement', '#/inventaire/scan', '#/apurement', '#/apurement/travail', '#/apurement/cartes-dechargees',
      '#/agent-qualite', '#/agent-qualite/doublons', '#/agent-qualite/manquants', '#/agent-qualite/invalides', '#/agent-qualite/anomalies-brutes', '#/agent-qualite/recherche-universelle', '#/admin/queue', '#/retraits', '#/dashboard'];
    for (const r of routes) {
      await gotoHash(r, 2500);
      const url = window.url().split('#')[1];
      await scan(`${r} (url=${url}) initial`);
      // recherche eventuelle
      const search = window.locator('input[type="text"], input[type="search"], input:not([type])').filter({ hasNot: window.locator('[disabled]') });
      const n = await search.count();
      let filled = false;
      for (let i = 0; i < Math.min(n, 4); i++) {
        const ph = (await search.nth(i).getAttribute('placeholder')) || '';
        if (/echerch|aisir|nom|critère|ZZ/i.test(ph) && !/JJ\/MM|ABOBO/.test(ph)) {
          await search.nth(i).fill('ZZTEST_NS');
          await window.keyboard.press('Enter');
          filled = true;
          break;
        }
      }
      if (filled) {
        await window.waitForTimeout(2500);
        const s = await scan(`${r} apres recherche ZZTEST_NS`);
        void s;
        // ouvre le 1er element contenant la carte SCI
        const target = window.locator(`text=${P}_SCI1`).first();
        if (await target.count()) {
          await target.click({ timeout: 3000 }).catch(() => undefined);
          await window.waitForTimeout(1500);
          await scan(`${r} apres clic ${P}_SCI1`);
          await window.keyboard.press('Escape');
        }
      }
      await window.screenshot({ path: join(SHOT_DIR, `crawl-${r.replace(/[#/]/g, '_')}.png`) }).catch(() => undefined);
    }
    console.log(`[A13][CONSOLE crawl] erreurs=${consoleErrors.length} ${JSON.stringify(consoleErrors.slice(0, 6))}`);
    console.log(`[A13][BASE apres crawl] ${JSON.stringify(await Promise.all(['SCI1', 'SCI2', 'SCI3', 'SCI4', 'NORM', 'VIDE', 'NUL', 'E11', 'ABC'].map(async (k) => `${k}=${JSON.stringify(await numSecuDb(k))}`)))}`);
  });

  test('5 exports CSV / Excel / getRows (dialog stubbe, dossier temporaire)', async () => {
    const { window } = env;
    const csvPath = join(tmpOut, 'export.csv');
    const xlsxPath = join(tmpOut, 'export.xlsx');
    await env.app.evaluate(({ dialog }, paths) => {
      (dialog as any).showSaveDialog = async (_w: any, opts: any) => ({ canceled: false, filePath: (opts && /xlsx/i.test(opts.defaultPath || '')) ? paths.xlsx : paths.csv });
    }, { csv: csvPath, xlsx: xlsxPath });
    const before = JSON.stringify(await dbQuery(`SELECT sync_id, num_secu FROM t_cartes WHERE sync_id LIKE 'zztest-ns-%' ORDER BY sync_id`));
    const rc = await window.evaluate(async () => { try { return JSON.stringify(await (window as any).api.export.csv({})); } catch (e: any) { return 'ERR ' + e.message; } });
    const rx = await window.evaluate(async () => { try { return JSON.stringify(await (window as any).api.export.excel({})); } catch (e: any) { return 'ERR ' + e.message; } });
    console.log(`[A13][EXPORT retours] csv=${rc} xlsx=${rx} fichiers temporaires: csv existe=${existsSync(csvPath)} xlsx existe=${existsSync(xlsxPath)}`);
    if (existsSync(csvPath)) {
      const raw = readFileSync(csvPath, 'utf-8').replace(/^﻿/, '');
      const lines = raw.split(/\r?\n/);
      const hdr = lines[0].split(';').map((h) => h.replace(/^"|"$/g, ''));
      console.log(`[A13][CSV] lignes=${lines.length} entete=${JSON.stringify(hdr.slice(0, 10))} E+ occurrences=${(raw.match(/\d[eE]\+\d/g) || []).length}`);
      const iNom = hdr.indexOf('noms'); const iSec = hdr.indexOf('num_secu');
      for (const l of lines.slice(1)) if (/ZZTEST_NS_/.test(l)) {
        const cells = l.split(';').map((c) => c.replace(/^"|"$/g, ''));
        console.log(`[A13][CSV ligne] ${cells[iNom]} -> num_secu cellule brute=${JSON.stringify(cells[iSec])}`);
      }
      console.log(`[A13][CSV cloisonnement] contient AUTRESITE=${raw.includes('ZZTEST_NS_AUTRESITE')}`);
    }
    if (existsSync(xlsxPath)) {
      const ExcelJS = require('exceljs');
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.readFile(xlsxPath);
      const ws = wb.worksheets[0];
      const head: string[] = []; ws.getRow(1).eachCell((c: any) => head.push(String(c.value)));
      const iSec = head.findIndex((h) => /NUM SECU/i.test(h)); const iNom = head.findIndex((h) => /^NOMS$/i.test(h));
      console.log(`[A13][XLSX] feuille="${ws.name}" lignes=${ws.rowCount} entetes=${JSON.stringify(head.slice(0, 8))}`);
      let ePlus = 0;
      ws.eachRow((row: any, n: number) => {
        if (n === 1) return;
        const nom = String(row.getCell(iNom + 1).value);
        const c = row.getCell(iSec + 1);
        if (/e\+/i.test(String(c.value))) ePlus++;
        if (/ZZTEST_NS_/.test(nom)) console.log(`[A13][XLSX ligne] ${nom} -> valeur=${JSON.stringify(c.value)} type=${typeof c.value} numFmt=${c.numFmt}`);
      });
      console.log(`[A13][XLSX] cellules num_secu avec E+ = ${ePlus}`);
    }
    const rows = await window.evaluate(async () => { try { return JSON.stringify(await (window as any).api.export.getRows({})); } catch (e: any) { return 'ERR ' + e.message; } });
    try {
      const arr = JSON.parse(rows) as any[];
      console.log(`[A13][getRows] lignes=${arr.length} num_secu des cartes de test=${JSON.stringify(arr.filter((r) => /ZZTEST_NS/.test(r.noms)).map((r) => `${r.noms.replace('ZZTEST_NS_', '')}:${r.num_secu}`))}`);
    } catch { console.log(`[A13][getRows] ${rows.slice(0, 200)}`); }
    const after = JSON.stringify(await dbQuery(`SELECT sync_id, num_secu FROM t_cartes WHERE sync_id LIKE 'zztest-ns-%' ORDER BY sync_id`));
    console.log(`[A13][EXPORT base inchangee] ${before === after}`);
  });

  test('6 non-regression recherche + mise en page (admin)', async () => {
    const { window } = env;
    await gotoHash('#/search', 2000);
    console.log(`[A13][SEARCH page] inputs=${JSON.stringify(await window.evaluate(() => Array.from(document.querySelectorAll('input')).map((i) => i.type + ':' + i.placeholder)))}`);
    const inp = window.locator('input:not([type="hidden"]):not([type="checkbox"])').first();
    for (const q of ['1234567890123', '3840000000000']) {
      await inp.fill(q);
      await window.keyboard.press('Enter');
      await window.waitForTimeout(2500);
      const names = await window.evaluate(() => Array.from(document.body.innerText.matchAll(/ZZTEST_NS_\w+/g)).map((m) => m[0]));
      console.log(`[A13][RECHERCHE n° secu "${q}"] cartes trouvees=${JSON.stringify(Array.from(new Set(names)))}`);
    }
    const cdp = await window.context().newCDPSession(window);
    await gotoHash('#/cartes', 2000);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });
    await window.waitForTimeout(800);
    const m = await window.evaluate(() => ({ inner: [innerWidth, innerHeight], docScrollW: document.documentElement.scrollWidth, tables: Array.from(document.querySelectorAll('table')).map((t) => { const p = t.parentElement as HTMLElement; return { table: t.scrollWidth, wrapClient: p.clientWidth, wrapScroll: p.scrollWidth }; }) }));
    console.log(`[A13][MESURE #/cartes 1366x768] ${JSON.stringify(m)}`);
    await window.screenshot({ path: join(SHOT_DIR, 'cartes-1366x768.png') });
    await cdp.send('Emulation.clearDeviceMetricsOverride');
    console.log(`[A13][CONSOLE final admin] erreurs=${consoleErrors.length} ${JSON.stringify(consoleErrors.slice(0, 6))}`);
  });


  async function btnNames() {
    return env.window.evaluate(() => Array.from(document.querySelectorAll('button')).filter((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).map((b) => (b.innerText || b.title || '').trim().replace(/\s+/g, ' ')).filter(Boolean));
  }
  const dbField = async (k: string, f: string) => (await dbQuery(`SELECT ${f} AS v FROM t_cartes WHERE sync_id=?`, [sid(k)]))[0]?.v;

  async function openPanel(name: string) {
    const { window } = env;
    await gotoHash('#/agent-qualite/recherche-universelle', 2000);
    await window.locator('input[type="text"]').first().fill(name);
    await window.keyboard.press('Enter');
    await window.waitForTimeout(2200);
    const row = window.locator('tbody tr', { hasText: name }).first();
    const b = row.getByRole('button').first();
    if (await b.count()) await b.click(); else await row.click();
    await window.waitForTimeout(1200);
  }
  const secuPanel = () => env.window.locator('input[inputmode="numeric"][maxlength="13"]').first();
  /** Sauvegarde le panneau ; si un mot de passe est demande, le saisit et confirme. Retourne { pwd, toast }. */
  async function savePanel() {
    const { window } = env;
    await window.getByRole('button', { name: /Sauvegarder/ }).click();
    await window.waitForTimeout(900);
    let pwd = false;
    const pw = window.locator('input[type="password"]');
    if (await pw.count()) {
      pwd = true;
      await pw.first().fill(getTestUser('administrateurSite').password);
      await window.locator('.btn-danger, .btn-plein-soleil').filter({ hasText: /Confirmer|OK|Valider/ }).last().click();
    }
    await window.waitForTimeout(1800);
    return { pwd, toast: await toastsText() };
  }

  test('3 panneau de correction (CorrectionSidePanel) : scientifique, normal, anomalie', async () => {
    const { window } = env;
    // a) SCI4 : n° sécu scientifique -> champ vide ; modifier contact uniquement
    await openPanel(`${P}_SCI4`);
    console.log(`[A13][PANNEAU SCI4] champ n° sécu="${await secuPanel().inputValue()}" (attendu vide) base="${await dbField('SCI4', 'num_secu')}"`);
    await window.screenshot({ path: join(SHOT_DIR, 'panel-sci4.png') });
    await window.locator('input[inputmode="numeric"][maxlength="10"]').first().fill('0708090098');
    let r = await savePanel();
    console.log(`[A13][PANNEAU SCI4 contact seul] mot de passe demande=${r.pwd} toast="${r.toast}" base num_secu=${JSON.stringify(await dbField('SCI4', 'num_secu'))} contact=${JSON.stringify(await dbField('SCI4', 'contact'))}`);
    // b) SCI4 : saisir un vrai numero
    await openPanel(`${P}_SCI4`);
    await secuPanel().fill('1234567890124');
    r = await savePanel();
    console.log(`[A13][PANNEAU SCI4 vrai numero] mot de passe demande=${r.pwd} toast="${r.toast}" base num_secu=${JSON.stringify(await dbField('SCI4', 'num_secu'))}`);
    // c) NORM2 : valeur normale 13 chiffres
    await openPanel(`${P}_NORM2`);
    console.log(`[A13][PANNEAU NORM2] champ n° sécu prerempli="${await secuPanel().inputValue()}" (attendu brut 1234567890123)`);
    await window.locator('input[inputmode="numeric"][maxlength="10"]').first().fill('0708090097');
    r = await savePanel();
    console.log(`[A13][PANNEAU NORM2 contact seul] mot de passe demande=${r.pwd} base num_secu=${JSON.stringify(await dbField('NORM2', 'num_secu'))} contact=${JSON.stringify(await dbField('NORM2', 'contact'))}`);
    await openPanel(`${P}_NORM2`);
    await secuPanel().fill('1234567890125');
    r = await savePanel();
    console.log(`[A13][PANNEAU NORM2 numero modifie] mot de passe demande=${r.pwd} base num_secu=${JSON.stringify(await dbField('NORM2', 'num_secu'))}`);
    // d) ZERO : 0,384E+12 reste inchange a l'affichage
    await openPanel(`${P}_ZERO`);
    console.log(`[A13][PANNEAU ZERO 0,384E+12] champ n° sécu="${await secuPanel().inputValue()}" base="${await dbField('ZERO', 'num_secu')}"`);
    await window.getByRole('button', { name: 'Annuler' }).click();
    await window.waitForTimeout(800);
    // e) anomalie d'import
    await gotoHash('#/agent-qualite/recherche-universelle', 2000);
    await window.locator('input[type="text"]').first().fill(`${P}_ANOM`);
    await window.keyboard.press('Enter');
    await window.waitForTimeout(2200);
    console.log(`[A13][ANOMALIE recherche] lignes=${JSON.stringify(await window.evaluate(() => Array.from(document.querySelectorAll('tbody tr')).map((r) => (r as HTMLElement).innerText.replace(/\s+/g, ' ').slice(0, 140))))}`);
    const rowA = window.locator('tbody tr', { hasText: `${P}_ANOM` }).first();
    if (await rowA.count()) {
      const ba = rowA.getByRole('button').first();
      if (await ba.count()) await ba.click(); else await rowA.click();
      await window.waitForTimeout(1200);
      if (await secuPanel().count()) {
        console.log(`[A13][ANOMALIE panneau] champ n° sécu="${await secuPanel().inputValue()}" (base anomalie: 3,84E+12)`);
        await window.screenshot({ path: join(SHOT_DIR, 'panel-anomalie.png') });
        const nomInput = window.locator('input[type="text"]').filter({ hasNot: window.locator('[maxlength]') });
        const vals = await window.evaluate(() => Array.from(document.querySelectorAll('input')).map((i) => i.value));
        console.log(`[A13][ANOMALIE panneau inputs] ${JSON.stringify(vals)}`);
        void nomInput;
        const idx = vals.findIndex((v) => v === `${P}_ANOM`);
        if (idx >= 0) await window.locator('input').nth(idx).fill(`${P}_ANOM2`);
        const before = await dbQuery(`SELECT COUNT(*) c FROM t_cartes WHERE noms LIKE 'ZZTEST_NS_ANOM%'`);
        const ra = await savePanel();
        const cartes = await dbQuery(`SELECT noms, num_secu, statut, rangement FROM t_cartes WHERE noms LIKE 'ZZTEST_NS_ANOM%'`);
        const anos = await dbQuery(`SELECT noms, num_secu FROM t_import_anomalies WHERE noms LIKE 'ZZTEST_NS_ANOM%'`);
        console.log(`[A13][ANOMALIE enregistrement nom modifie] mot de passe demande=${ra.pwd} toast="${ra.toast}" cartes avant=${before[0].c} cartes apres=${JSON.stringify(cartes)} anomalies restantes=${JSON.stringify(anos)}`);
      } else {
        console.log(`[A13][ANOMALIE] panneau non ouvert : non verifie. boutons=${JSON.stringify((await btnNames()).slice(-8))}`);
      }
    } else console.log('[A13][ANOMALIE] ligne anomalie non trouvee dans la recherche : non verifie');
  });

  test('3b edition en ligne Qualite (ExpandedManquantDetails)', async () => {
    const { window } = env;
    await gotoHash('#/agent-qualite/manquants', 2500);
    await window.getByRole('button', { name: 'Sans Rangement', exact: true }).click();
    await window.waitForTimeout(2000);
    const tr = window.locator('tbody tr', { hasText: `${P}_SANS` }).first();
    await tr.click().catch(() => undefined);
    await window.waitForTimeout(1500);
    const near = window.locator('span:text-is("3890000000000") ~ button, span:text-is("3890000000000") + * button, div:has(> span:text-is("3890000000000")) > button').first();
    if (!(await near.count())) { console.log('[A13][EDIT EN LIGNE] bouton non localise : non verifie'); return; }
    await near.click();
    await window.waitForTimeout(800);
    const vals = await window.evaluate(() => Array.from(document.querySelectorAll('input')).map((i) => i.value));
    console.log(`[A13][EDIT EN LIGNE] valeurs d'inputs=${JSON.stringify(vals)} (attendu aucune valeur n° sécu prerempli)`);
    await window.screenshot({ path: join(SHOT_DIR, 'inline-edit-vide.png') });
    console.log(`[A13][EDIT EN LIGNE boutons] ${JSON.stringify((await btnNames()).slice(-10))}`);
    const ctl = await window.evaluate(() => { const i = Array.from(document.querySelectorAll('input')).find((x) => x.type === 'text' && x.value === '' && x.closest('div')?.querySelector('button')) as HTMLElement | undefined; const c = i?.parentElement; return c ? Array.from(c.querySelectorAll('button')).map((b) => `${b.innerText}|${b.title}|${b.getAttribute('aria-label')}`) : null; });
    console.log(`[A13][EDIT EN LIGNE controles voisins] ${JSON.stringify(ctl)}`);
    // enregistrer sans saisir : bouton icone Sauvegarder (btn-primary) voisin du champ d'edition
    const saveBtn = () => window.locator('input[inputmode="numeric"][maxlength="13"]').first().locator('xpath=following-sibling::button[contains(@class,"btn-primary")]').first();
    await saveBtn().click();
    await window.waitForTimeout(1800);
    console.log(`[A13][EDIT EN LIGNE enregistrer vide] toast="${await toastsText()}" edition encore ouverte=${await window.locator('input[inputmode="numeric"][maxlength="13"]').count()} base num_secu=${JSON.stringify(await dbField('SANS', 'num_secu'))}`);
    if (!(await window.locator('input[inputmode="numeric"][maxlength="13"]').count())) {
      const near2 = window.locator('span:text-is("3890000000000") ~ button, span:text-is("3890000000000") + * button, div:has(> span:text-is("3890000000000")) > button').first();
      if (await near2.count()) { await near2.click(); await window.waitForTimeout(600); }
    }
    await window.locator('input[inputmode="numeric"][maxlength="13"]').first().fill('1234567890126');
    await saveBtn().click();
    await window.waitForTimeout(1800);
    const pw = await window.locator('input[type="password"]').count();
    if (pw) { await window.locator('input[type="password"]').first().fill(getTestUser('administrateurSite').password); await window.locator('.btn-danger, .btn-plein-soleil').filter({ hasText: /Confirmer|OK|Valider/ }).last().click(); await window.waitForTimeout(1800); }
    console.log(`[A13][EDIT EN LIGNE saisie 13 chiffres] mot de passe demande=${pw > 0} toast="${await toastsText()}" base num_secu=${JSON.stringify(await dbField('SANS', 'num_secu'))}`);
  });

  test('6b SaisieEditModal (brouillon) en OPERATEUR_SAISIE', async () => {
    const { window } = env;
    const sa = env.seed.userIds['operateurSaisie'];
    await dbQuery(`UPDATE t_cartes SET created_by = ?, is_dirty = 1 WHERE sync_id IN (?, ?)`, [sa, sid('BROU'), sid('BNORM')]);
    await window.getByText('Déconnexion').click();
    await window.waitForURL(/#\/login/, { timeout: 15000 });
    const us = getTestUser('operateurSaisie');
    await window.getByTestId('login-input').fill(us.login);
    await window.getByTestId('password-input').fill(us.password);
    await window.getByTestId('login-submit').click();
    await window.waitForTimeout(4000);
    const openModal = async (k: string) => {
      await gotoHash('#/agent-saisie/brouillons', 2500);
      const tr = window.locator('tbody tr', { hasText: `${P}_${k}` }).first();
      await tr.getByRole('button', { name: /Modifier/ }).click();
      await window.waitForTimeout(1500);
    };
    const secuModal = () => window.locator('input[placeholder="Ex: 3841236548952"]').first();
    const saveModal = async () => { await window.getByRole('button', { name: /Enregistrer les modifications/ }).click(); await window.waitForTimeout(2500); return toastsText(); };
    await openModal('BROU');
    console.log(`[A13][SAISIE BROU] champ prerempli="${await secuModal().inputValue()}" (attendu 3870000000000) base="${await dbField('BROU', 'num_secu')}"`);
    await window.screenshot({ path: join(SHOT_DIR, 'saisie-modal.png') });
    let t = await saveModal();
    console.log(`[A13][SAISIE BROU enregistrer sans rien modifier] toast="${t}" base num_secu=${JSON.stringify(await dbField('BROU', 'num_secu'))}`);
    await openModal('BROU');
    const inputsVals = await window.evaluate(() => Array.from(document.querySelectorAll('input')).map((i) => i.value));
    const idx = inputsVals.findIndex((v) => v === 'ABOBO');
    if (idx >= 0) await window.locator('input').nth(idx).fill('YOPOUGON');
    t = await saveModal();
    console.log(`[A13][SAISIE BROU autre champ modifie (lieu)] toast="${t}" base num_secu=${JSON.stringify(await dbField('BROU', 'num_secu'))} lieu=${JSON.stringify(await dbField('BROU', 'lieu_de_naissance'))} (idx lieu=${idx})`);
    await openModal('BROU');
    await secuModal().fill('3871111111111');
    t = await saveModal();
    console.log(`[A13][SAISIE BROU n° sécu modifie] toast="${t}" base num_secu=${JSON.stringify(await dbField('BROU', 'num_secu'))}`);
    await openModal('BNORM');
    console.log(`[A13][SAISIE BNORM] champ prerempli="${await secuModal().inputValue()}" base="${await dbField('BNORM', 'num_secu')}"`);
    await secuModal().fill('3881111111112');
    t = await saveModal();
    console.log(`[A13][SAISIE BNORM n° sécu normal modifie] toast="${t}" base num_secu=${JSON.stringify(await dbField('BNORM', 'num_secu'))}`);
    console.log(`[A13][CONSOLE saisie] erreurs=${consoleErrors.length} ${JSON.stringify(consoleErrors.slice(0, 5))}`);
  });

  test('6c SaisiePage : nouvelle carte avec n° sécu valide', async () => {
    const { window } = env;
    await gotoHash('#/agent-saisie/nouvelle', 2500);
    const info = await window.evaluate(() => Array.from(document.querySelectorAll('input')).map((i, n) => `${n}:${i.name}|${i.placeholder}`));
    console.log(`[A13][SAISIEPAGE inputs] ${JSON.stringify(info)}`);
    const fill = async (re: RegExp, v: string) => {
      const idx = info.findIndex((x) => re.test(x));
      if (idx >= 0) await window.locator('input').nth(idx).fill(v);
      return idx;
    };
    const iN = await fill(/noms?\b|nom\|/i, `${P}_NEW`);
    await fill(/prenoms?|prénom/i, 'QAPRE');
    await fill(/JJ\/MM/i, '01/01/1990');
    await fill(/lieu.*naiss|ABOBO/i, 'ABOBO');
    await fill(/3841236548952|secu|cmu/i, '3891234567891');
    await fill(/contact|01 02/i, '0708090091');
    console.log(`[A13][SAISIEPAGE] index nom=${iN}`);
    await window.screenshot({ path: join(SHOT_DIR, 'saisiepage.png') });
    console.log(`[A13][SAISIEPAGE boutons] ${JSON.stringify((await btnNames()).slice(-8))}`);
    const brouillon = window.getByRole('button', { name: /Sauvegarder en brouillon/ });
    if (await brouillon.count()) { await brouillon.click(); await window.waitForTimeout(2200); }
    const rows = await dbQuery(`SELECT noms, num_secu, statut FROM t_cartes WHERE noms = ?`, [`${P}_NEW`]);
    console.log(`[A13][SAISIEPAGE apres enregistrement en brouillon] toast="${await toastsText()}" base=${JSON.stringify(rows)}`);
  });

  test('7 operateur logistique : plus d ecriture silencieuse + mise en page', async () => {
    const { window } = env;
    await window.getByText('Déconnexion').click();
    await window.waitForURL(/#\/login/, { timeout: 15000 });
    const u = getTestUser('operateurLogistique');
    await window.getByTestId('login-input').fill(u.login);
    await window.getByTestId('password-input').fill(u.password);
    await window.getByTestId('login-submit').click();
    await window.waitForURL(/#\/inventaire/, { timeout: 20000 });
    const SEARCH = 'input[placeholder="Saisir les critères..."]';
    const open = async (k: string) => {
      await gotoHash('#/inventaire/logistique', 1500);
      const an = window.getByRole('button', { name: 'Annuler' });
      if (await an.count()) await an.click();
      await window.locator(SEARCH).fill(`${P}_${k}`);
      await window.locator(`text=${P}_${k} QAPRE`).first().click();
      await window.waitForTimeout(900);
    };
    const valider = async (rang: string) => { await window.locator('input[placeholder="Ex: MAIRIE-A3"]').fill(rang); await window.getByRole('button', { name: /Valider \(Entrée\)/ }).click(); await window.waitForTimeout(1800); return toastsText(); };
    await open('SCI2');
    console.log(`[A13][LOGISTIQUE SCI2] champ n° sécu visible=${await window.locator('input[placeholder="Ex: 22501..."]').count()} base avant="${await dbField('SCI2', 'num_secu')}"`);
    let t = await valider('ZZ-NS-L2');
    console.log(`[A13][LOGISTIQUE SCI2 rangement] toast="${t}" base apres=${JSON.stringify(await dbField('SCI2', 'num_secu'))} rangement=${JSON.stringify(await dbField('SCI2', 'rangement'))}`);
    await open('NUL');
    console.log(`[A13][LOGISTIQUE NUL (sans n° sécu)] champ visible=${await window.locator('input[placeholder="Ex: 22501..."]').count()}`);
    await window.locator('input[placeholder="Ex: 22501..."]').fill('3891111111113');
    t = await valider('ZZ-NS-NUL');
    console.log(`[A13][LOGISTIQUE NUL 13 chiffres saisis] toast="${t}" base num_secu=${JSON.stringify(await dbField('NUL', 'num_secu'))}`);
    await open('VIDE');
    console.log(`[A13][LOGISTIQUE VIDE (n° sécu '')] champ visible=${await window.locator('input[placeholder="Ex: 22501..."]').count()}`);
    t = await valider('ZZ-NS-VIDE');
    console.log(`[A13][LOGISTIQUE VIDE champ laisse vide] toast="${t}" base num_secu=${JSON.stringify(await dbField('VIDE', 'num_secu'))} rangement=${JSON.stringify(await dbField('VIDE', 'rangement'))}`);
    // mise en page
    const cdp = await window.context().newCDPSession(window);
    await dbQuery(`UPDATE t_cartes SET rangement = NULL WHERE sync_id = ?`, [sid('SCI2')]);
    for (const r of ['#/inventaire/sans-rangement', '#/inventaire/anomalies-centre']) {
      await gotoHash(r, 2500);
      await scan(r);
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });
      await window.waitForTimeout(800);
      const m = await window.evaluate(() => { const t = document.querySelector('table') as HTMLElement | null; if (!t) return null; const wrap = t.parentElement as HTMLElement; const wr = wrap.getBoundingClientRect(); const b = t.querySelector('tbody tr:first-child button') as HTMLElement | null; const br = b ? b.getBoundingClientRect() : null; return { inner: [innerWidth, innerHeight], wrapClient: wrap.clientWidth, wrapScroll: wrap.scrollWidth, btnVisible: br ? br.right <= wr.right + 0.5 : null }; });
      console.log(`[A13][MESURE ${r} 1366x768] ${JSON.stringify(m)}`);
      await cdp.send('Emulation.clearDeviceMetricsOverride');
    }
    console.log(`[A13][CONSOLE final] erreurs=${consoleErrors.length} ${JSON.stringify(consoleErrors.slice(0, 6))}`);
  });

  test('cleanup', async () => {
    const del = await dbQuery(`DELETE FROM t_cartes WHERE sync_id LIKE 'zztest-ns-%' OR noms LIKE 'ZZTEST_NS%'`);
    await dbQuery(`DELETE FROM t_import_anomalies WHERE noms LIKE 'ZZTEST_NS%'`).catch(() => undefined);
    await dbQuery(`DELETE FROM t_outbox WHERE id LIKE 'zztest-ns-%'`).catch(() => undefined);
    await dbQuery(`DELETE FROM t_logs WHERE detail LIKE '%ZZTEST_NS%'`).catch(() => undefined);
    await dbQuery(`DELETE FROM t_centres WHERE nom LIKE 'ZZTEST_NS%'`);
    await dbQuery(`DELETE FROM t_sites WHERE nom LIKE 'ZZTEST_NS%'`);
    const left = (await dbQuery(`SELECT COUNT(*) c FROM t_cartes WHERE sync_id LIKE 'zztest-ns-%'`))[0].c;
    console.log(`[A13][CLEANUP] cartes supprimees=${del[0].changes} reste=${left} exports temporaires dans ${tmpOut} (supprimes en afterAll) existe=${existsSync(tmpOut)}`);
    void readFileSync;
  });
});
