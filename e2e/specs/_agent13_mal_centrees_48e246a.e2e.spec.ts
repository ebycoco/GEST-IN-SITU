/**
 * QA Terrain (agent-13) : commit 48e246a, page Cartes mal-centrees (OPERATEUR_LOGISTIQUE).
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
const SHOT_DIR = join(__dirname, '..', '..', 'test-results', 'agent13-malcentrees-shots');
const P = 'ZZTEST_MC';
const NOW = Date.now();
const SEARCH = 'input[placeholder="Saisir les critères..."]';

test.describe.serial('QA Terrain mal-centrees 48e246a', () => {
  let env: E2EEnvironment;
  let site2: number;
  let centre2: number;
  let centre2p: number;
  let cA: number;
  let cB: number;

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

  async function addCarte(key: string, o: { statut?: string | null; rangement?: string | null; centre?: number | null; site?: number; noms?: string; prenoms?: string; secu?: string; ddn?: string; lieu?: string } = {}) {
    const hasCentre = Object.prototype.hasOwnProperty.call(o, 'centre');
    try {
      await dbQuery(
        `INSERT INTO t_cartes (noms, prenoms, statut, site_id, centre_id, sync_id, is_dirty, num_secu, date_de_naissance, lieu_de_naissance, rangement)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
        [o.noms ?? `${P}_${key}`, o.prenoms ?? 'QAPRE', o.statut === undefined ? 'EN STOCK' : o.statut, o.site ?? env.seed.siteId,
          hasCentre ? o.centre : env.seed.centreId, `zztest-mc-${key}-${NOW}`, o.secu ?? `ZZTEST-MC-${key}-${NOW}`,
          o.ddn ?? '1990-01-01', o.lieu ?? 'ABOBO', o.rangement === undefined ? null : o.rangement]
      );
    } catch (e: any) {
      console.log(`[A13][SEED-ERR ${key}] ${e.message.split('\n')[0]}`);
    }
  }
  const sid = (key: string) => `zztest-mc-${key}-${NOW}`;
  const idOf = async (key: string) => (await dbQuery(`SELECT id_carte FROM t_cartes WHERE sync_id=?`, [sid(key)]))[0]?.id_carte;
  const row = async (key: string) => (await dbQuery(`SELECT centre_id, statut, rangement, is_dirty, updated_at, action_at FROM t_cartes WHERE sync_id = ?`, [sid(key)]))[0];
  const toastsText = async () => (await env.window.locator('[role="status"]').allTextContents()).join(' | ');
  async function waitNoToast() {
    try { await env.window.waitForFunction(() => document.querySelectorAll('[role="status"]').length === 0, null, { timeout: 9000 }); } catch { /* ignore */ }
  }
  async function gotoHash(h: string) {
    await env.window.evaluate((x) => { window.location.hash = x; }, h);
    await env.window.waitForTimeout(1500);
  }
  async function listNames(): Promise<string[]> {
    return env.window.evaluate((p) => Array.from(document.querySelectorAll('tbody tr td:first-child')).map((e) => (e as HTMLElement).innerText.trim()).filter((t) => t.startsWith(p)), P);
  }
  async function refresh() {
    await env.window.locator('button.btn-outline', { hasText: 'Actualiser' }).click();
    await env.window.waitForTimeout(1200);
  }
  const ipc = async (id: number) => env.window.evaluate(async (i) => {
    try { const r = await (window as any).api.cartes.corrigerCentreCarte(i); return 'OK ' + JSON.stringify(r); }
    catch (e: any) { return 'ERR ' + (e?.message || e); }
  }, id);

  test('00 setup + login', async () => {
    const r2 = await dbQuery(`INSERT INTO t_sites (nom, code, is_active, max_centres, is_permanent, sync_id) VALUES (?, ?, 1, 4, 1, ?)`, [`${P}_SITE2`, `E2E-MC-${NOW}`, `e2e-mc-site2-${NOW}`]);
    site2 = r2[0].lastInsertRowid;
    centre2 = (await dbQuery(`INSERT INTO t_centres (site_id, nom, numero, sync_id) VALUES (?, ?, 1, ?)`, [site2, `${P}_C2A`, `e2e-mc-c2a-${NOW}`]))[0].lastInsertRowid;
    centre2p = (await dbQuery(`INSERT INTO t_centres (site_id, nom, numero, sync_id, prefixe_rangement) VALUES (?, ?, 2, ?, 'S2P')`, [site2, `${P}_C2B`, `e2e-mc-c2b-${NOW}`]))[0].lastInsertRowid;
    cA = (await dbQuery(`INSERT INTO t_centres (site_id, nom, numero, sync_id, prefixe_rangement) VALUES (?, ?, 2, ?, 'MCA')`, [env.seed.siteId, `${P}_CENTRE_A`, `e2e-mc-ca-${NOW}`]))[0].lastInsertRowid;
    cB = (await dbQuery(`INSERT INTO t_centres (site_id, nom, numero, sync_id, prefixe_rangement) VALUES (?, ?, 3, ?, 'MCB')`, [env.seed.siteId, `${P}_CENTRE_B`, `e2e-mc-cb-${NOW}`]))[0].lastInsertRowid;
    console.log(`[A13][SETUP] centre seed=${env.seed.centreId} A(MCA)=${cA} B(MCB)=${cB} site2=${site2} centre2p(S2P)=${centre2p}`);
    await addCarte('M1STOCK', { rangement: 'MCA-001' });
    await addCarte('M1B', { rangement: 'MCA-002' });
    await addCarte('M2DELIV', { statut: 'DELIVRE', rangement: 'MCA-003' });
    await addCarte('M3DOUBLON', { statut: 'DOUBLON', rangement: 'MCA-004' });
    await addCarte('M4RETIRE', { statut: 'RETIRE', rangement: 'MCA-005' });
    await addCarte('M4DISTRIB', { statut: 'DISTRIBUEE', rangement: 'MCB-006' });
    await addCarte('M4BROUILLON', { statut: 'BROUILLON', rangement: 'MCB-007' });
    await addCarte('M4NULL', { statut: null, rangement: 'MCB-008' });
    await addCarte('M5BIENCENTREE', { rangement: 'MCA-009', centre: cA });
    await addCarte('M6NONCLASSE', { rangement: 'NON CLASSE' });
    await addCarte('M7VIDE', { rangement: '' });
    await addCarte('M8SANSPFX', { rangement: 'XXNOPFX-1' });
    await addCarte('M9CENTRENULL', { rangement: 'MCB-010', centre: null });
    await addCarte('E1ERRCENTRE', { rangement: 'MCA-011' });
    await addCarte('E2ERRDELIV', { rangement: 'MCA-012' });
    await addCarte('LONG', { rangement: 'MCA-013', noms: `${P}_LONGNAME_ABCDEFGHIJKLMNOPQRS`, prenoms: 'JEAN-BAPTISTE ADJOUA MARIE-CLAIRE', secu: '2250123456789' });
    await addCarte('REAL', { rangement: 'MCA-020', noms: "KOUAME-N'GUESSAN", prenoms: 'ADJOUA MARIE-CLAIRE', secu: '2250123456789' });
    await addCarte('SCI', { rangement: 'MCA-014', secu: '3.84E+12' });
    await addCarte('AUTRESITE', { site: site2, centre: centre2, rangement: 'S2P-001' });
    for (let i = 1; i <= 18; i++) {
      const n = String(i).padStart(2, '0');
      await addCarte(`PG${n}`, { rangement: `MCB-1${n}`, noms: `${P}_PG${n}`, ddn: i === 3 ? '1985-05-05' : '1990-01-01', lieu: i === 4 ? 'YOPOUGON' : 'ABOBO' });
    }
    const u = getTestUser('operateurLogistique');
    const { window } = env;
    await window.waitForURL(/#\/login/, { timeout: 30000 });
    await window.getByTestId('login-input').fill(u.login);
    await window.getByTestId('password-input').fill(u.password);
    await window.getByTestId('login-submit').click();
    await window.waitForURL(/#\/inventaire/, { timeout: 20000 });
  });

  test('1 liste (filtre statuts) + pagination + recherche', async () => {
    const { window } = env;
    await gotoHash('#/inventaire/anomalies-centre');
    await window.waitForTimeout(1500);
    // Toutes les pages : sauter par Suivant
    const all: string[] = [];
    all.push(...(await listNames()));
    await window.screenshot({ path: join(SHOT_DIR, 'liste-page1.png') });
    const info1 = await window.locator('text=/Affichage \\d+ à \\d+ sur \\d+/').allTextContents();
    console.log(`[A13][PAGINATION] page1 lignes=${all.length} ${JSON.stringify(info1)}`);
    for (let p = 2; p <= 4; p++) {
      const next = window.getByRole('button', { name: 'Suivant' });
      if (!(await next.count()) || (await next.isDisabled())) break;
      await next.click();
      await window.waitForTimeout(600);
      const names = await listNames();
      console.log(`[A13][PAGINATION] page${p} lignes=${names.length} ${JSON.stringify(await window.locator('text=/Affichage \\d+ à \\d+ sur \\d+/').allTextContents())}`);
      all.push(...names);
    }
    const hasName = (k: string) => all.some((n) => n.includes(`${P}_${k}`));
    const expect: [string, boolean][] = [['M1STOCK', true], ['M1B', true], ['M2DELIV', false], ['M3DOUBLON', false], ['M4RETIRE', true], ['M4DISTRIB', true], ['M4BROUILLON', true], ['M4NULL', true], ['M5BIENCENTREE', false], ['M6NONCLASSE', false], ['M7VIDE', false], ['M8SANSPFX', false], ['M9CENTRENULL', true], ['AUTRESITE', false], ['SCI', true], ['LONG', true], ['PG01', true], ['PG18', true]];
    for (const [k, present] of expect) {
      const dbRow = await row(k);
      console.log(`[A13][LISTE ${k}] statut=${dbRow ? dbRow.statut : 'absent-en-base(seed KO)'} attendu=${present ? 'PRESENTE' : 'ABSENTE'} observe=${hasName(k) ? 'PRESENTE' : 'ABSENTE'}`);
    }
    console.log(`[A13][LISTE] total noms ZZTEST_MC listes=${all.length}`);
    // retour page 1 par recherche
    await window.getByRole('button', { name: 'Précédent' }).click().catch(() => undefined);
    // recherche nom
    await window.locator(SEARCH).fill('PG0');
    await window.waitForTimeout(600);
    console.log(`[A13][RECH nom "PG0"] ${JSON.stringify(await window.locator('text=/Affichage \\d+ à \\d+ sur \\d+/').allTextContents())} lignes=${(await listNames()).length}`);
    await window.locator(SEARCH).fill('');
    await window.locator('input[placeholder="Ex: ABOBO"]').fill('YOPOUGON');
    await window.waitForTimeout(600);
    console.log(`[A13][RECH lieu YOPOUGON] ${JSON.stringify(await listNames())}`);
    await window.locator('input[placeholder="Ex: ABOBO"]').fill('');
    await window.locator('input[placeholder="JJ/MM/AAAA"]').fill('05/05/1985');
    await window.waitForTimeout(700);
    console.log(`[A13][RECH date 05/05/1985] ${JSON.stringify(await listNames())}`);
    await window.locator('input[placeholder="JJ/MM/AAAA"]').fill('');
    await window.waitForTimeout(500);
  });

  test('2 annulation puis correction', async () => {
    const { window } = env;
    await gotoHash('#/inventaire/anomalies-centre');
    await window.waitForTimeout(1200);
    await window.locator(SEARCH).fill(`${P}_M1STOCK`);
    await window.waitForTimeout(600);
    const rowLoc = window.locator('tr', { hasText: `${P}_M1STOCK` });
    const before = await row('M1STOCK');
    await rowLoc.getByRole('button', { name: 'Corriger' }).click();
    await window.waitForTimeout(600);
    const modal = window.locator('.premium-card', { hasText: 'Corriger le centre de la carte' });
    console.log(`[A13][CONFIRM texte] ${(await modal.innerText()).replace(/\s+/g, ' ').slice(0, 400)}`);
    await window.screenshot({ path: join(SHOT_DIR, 'confirm.png') });
    await modal.locator('.btn-outline').click();
    await window.waitForTimeout(800);
    console.log(`[A13][ANNULER] DB avant=${JSON.stringify(before)} apres=${JSON.stringify(await row('M1STOCK'))} ligne encore listee=${await rowLoc.count()}`);
    await waitNoToast();
    await rowLoc.getByRole('button', { name: 'Corriger' }).click();
    await window.waitForTimeout(500);
    await modal.locator('.btn-plein-soleil').click();
    await window.waitForTimeout(1500);
    console.log(`[A13][CORRIGER M1STOCK] toast="${await toastsText()}" ligne listee=${await rowLoc.count()}`);
    const after = await row('M1STOCK');
    console.log(`[A13][CORRIGER DB] avant=${JSON.stringify(before)} apres=${JSON.stringify(after)} (centre attendu A=${cA})`);
    try {
      console.log(`[A13][t_logs] ${JSON.stringify(await dbQuery(`SELECT action, login_user, is_dirty, centre_id, substr(valeur_apres,1,200) va, substr(detail,1,120) d FROM t_logs WHERE action = 'CENTRE_CARTE_CORRIGE'`))}`);
      console.log(`[A13][t_outbox] ${JSON.stringify(await dbQuery(`SELECT status, operation, attempts, table_name FROM t_outbox WHERE id = ?`, [sid('M1STOCK')]))}`);
    } catch (e: any) { console.log(`[A13][t_logs/outbox ERR] ${e.message}`); }
    await window.locator(SEARCH).fill('');
    await refresh();
    const names = await listNames();
    console.log(`[A13][APRES CORRECTION] M1STOCK encore listee=${names.some((n) => n.includes(`${P}_M1STOCK`))}`);
  });

  test('3 IPC direct (verrous) + 5 cloisonnement', async () => {
    for (const k of ['M2DELIV', 'M3DOUBLON', 'M5BIENCENTREE', 'M8SANSPFX', 'AUTRESITE']) {
      const id = await idOf(k);
      if (!id) { console.log(`[A13][IPC ${k}] carte absente (seed KO)`); continue; }
      const before = await row(k);
      const res = await ipc(id);
      console.log(`[A13][IPC ${k}] -> ${res} | avant=${JSON.stringify(before)} apres=${JSON.stringify(await row(k))}`);
    }
  });

  test('4 erreurs UI (carte modifiee entre-temps)', async () => {
    const { window } = env;
    await gotoHash('#/inventaire/anomalies-centre');
    await window.waitForTimeout(1200);
    await window.locator(SEARCH).fill(`${P}_E1`);
    await window.waitForTimeout(500);
    // modifie en base hors UI : carte devenue bien centree
    await dbQuery(`UPDATE t_cartes SET centre_id = ? WHERE sync_id = ?`, [cA, sid('E1ERRCENTRE')]);
    const modal = window.locator('.premium-card', { hasText: 'Corriger le centre de la carte' });
    await waitNoToast();
    await window.locator('tr', { hasText: `${P}_E1` }).getByRole('button', { name: 'Corriger' }).click();
    await window.waitForTimeout(400);
    await modal.locator('.btn-plein-soleil').click();
    await window.waitForTimeout(1500);
    console.log(`[A13][ERR-UI bien centree entre-temps] toast="${await toastsText()}" ligne encore listee=${await window.locator('tr', { hasText: `${P}_E1` }).count()}`);
    await window.screenshot({ path: join(SHOT_DIR, 'erreur-ui-1.png') });
    await window.locator(SEARCH).fill(`${P}_E2`);
    await window.waitForTimeout(500);
    await dbQuery(`UPDATE t_cartes SET statut = 'DELIVRE' WHERE sync_id = ?`, [sid('E2ERRDELIV')]);
    await waitNoToast();
    await window.locator('tr', { hasText: `${P}_E2` }).getByRole('button', { name: 'Corriger' }).click();
    await window.waitForTimeout(400);
    await modal.locator('.btn-plein-soleil').click();
    await window.waitForTimeout(1500);
    console.log(`[A13][ERR-UI delivree entre-temps] toast="${await toastsText()}" DB=${JSON.stringify(await row('E2ERRDELIV'))}`);
    await window.screenshot({ path: join(SHOT_DIR, 'erreur-ui-2.png') });
  });

  test('7/8 largeur, identite, num secu scientifique', async () => {
    const { window } = env;
    await gotoHash('#/inventaire/anomalies-centre');
    await window.waitForTimeout(1500);
    await window.locator(SEARCH).fill(`${P}_LONG`);
    await window.waitForTimeout(600);
    const cdp = await window.context().newCDPSession(window);
    for (const [w, h] of [[1366, 768], [1280, 720]] as const) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
      await window.waitForTimeout(800);
      const m = await window.evaluate(() => {
        const tb = document.querySelector('table') as HTMLElement;
        const wrap = tb.parentElement as HTMLElement;
        const wr = wrap.getBoundingClientRect();
        const first = tb.querySelector('tbody tr:first-child') as HTMLElement;
        const idc = first.querySelector('td:first-child') as HTMLElement;
        const btn = first.querySelector('button') as HTMLElement;
        const br = btn.getBoundingClientRect();
        const lh = parseFloat(getComputedStyle(idc.firstElementChild as HTMLElement).lineHeight) || 20;
        return {
          inner: [innerWidth, innerHeight], table: tb.scrollWidth, wrapClient: wrap.clientWidth, wrapScroll: wrap.scrollWidth,
          wrapRect: [Math.round(wr.left), Math.round(wr.right)], btn: { left: Math.round(br.left), right: Math.round(br.right), visible: br.right <= wr.right + 0.5 },
          identiteWidth: Math.round(idc.getBoundingClientRect().width), identiteHeight: Math.round(idc.getBoundingClientRect().height), lineHeightApprox: lh,
          identiteText: idc.innerText.trim()
        };
      });
      console.log(`[A13][MESURE ${w}x${h}] ${JSON.stringify(m)}`);
      await window.screenshot({ path: join(SHOT_DIR, `liste-${w}x${h}.png`) });
    }
    await cdp.send('Emulation.clearDeviceMetricsOverride');
    await window.locator(SEARCH).fill(`${P}_SCI`);
    await window.waitForTimeout(600);
    console.log(`[A13][SECU-SCI] cellule N° Sécu = "${await window.locator('tbody tr:first-child td:nth-child(2)').innerText()}"`);
    await window.screenshot({ path: join(SHOT_DIR, 'secu-sci.png') });
  });

  test('7b largeur realiste', async () => {
    const { window } = env;
    await gotoHash('#/inventaire/anomalies-centre');
    await window.waitForTimeout(1500);
    const cdp = await window.context().newCDPSession(window);
    for (const q of ["KOUAME-N'GUESSAN", `${P}_PG01`]) {
      await window.locator(SEARCH).fill(q);
      await window.waitForTimeout(600);
      for (const [w, h] of [[1366, 768], [1280, 720]] as const) {
        await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
        await window.waitForTimeout(700);
        const m = await window.evaluate(() => {
          const tb = document.querySelector('table') as HTMLElement;
          const wrap = tb.parentElement as HTMLElement;
          const wr = wrap.getBoundingClientRect();
          const first = tb.querySelector('tbody tr:first-child') as HTMLElement;
          const idc = first.querySelector('td:first-child') as HTMLElement;
          const br = (first.querySelector('button') as HTMLElement).getBoundingClientRect();
          return { inner: [innerWidth, innerHeight], table: tb.scrollWidth, wrapClient: wrap.clientWidth, wrapScroll: wrap.scrollWidth, btn: { left: Math.round(br.left), right: Math.round(br.right), visible: br.right <= wr.right + 0.5 }, identiteW: Math.round(idc.getBoundingClientRect().width), identiteH: Math.round(idc.getBoundingClientRect().height), text: idc.innerText.trim() };
        });
        console.log(`[A13][MESURE-REAL ${q} ${w}x${h}] ${JSON.stringify(m)}`);
        await window.screenshot({ path: join(SHOT_DIR, `real-${q.startsWith('KOUAME') ? 'kouame' : 'pg01'}-${w}x${h}.png`) });
      }
    }
    await cdp.send('Emulation.clearDeviceMetricsOverride');
  });

  test('cleanup', async () => {
    const del = await dbQuery(`DELETE FROM t_cartes WHERE sync_id LIKE 'zztest-mc-%'`);
    await dbQuery(`DELETE FROM t_outbox WHERE id LIKE 'zztest-mc-%'`).catch(() => undefined);
    await dbQuery(`DELETE FROM t_logs WHERE detail LIKE '%ZZTEST_MC%'`).catch(() => undefined);
    await dbQuery(`DELETE FROM t_centres WHERE nom LIKE 'ZZTEST_MC%'`);
    await dbQuery(`DELETE FROM t_sites WHERE nom LIKE 'ZZTEST_MC%'`);
    const left = (await dbQuery(`SELECT COUNT(*) c FROM t_cartes WHERE sync_id LIKE 'zztest-mc-%'`))[0].c;
    console.log(`[A13][CLEANUP] cartes supprimees=${del[0].changes} reste=${left}`);
  });
});
