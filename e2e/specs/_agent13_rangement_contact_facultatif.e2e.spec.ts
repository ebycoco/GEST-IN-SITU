/**
 * QA Terrain (agent-13) : commit 647f7ab, contact facultatif au rangement (OPERATEUR_LOGISTIQUE).
 * Base temporaire jetable, sync coupée (launchSeededApp). Données ZZTEST_ uniquement.
 */
import { test, expect } from '@playwright/test';
import { launchSeededApp, teardownSeededApp, type E2EEnvironment } from '../fixtures/electron-app';
import { getTestUser } from '../fixtures/test-users';
import { join } from 'path';
import { mkdirSync } from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const SHOT_DIR = join(__dirname, '..', '..', 'test-results', 'agent13-contact-shots');
const P = 'ZZTEST_CTC';
const NOW = Date.now();

test.describe.serial('QA Terrain contact facultatif rangement', () => {
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

  async function addCarte(key: string, opts: { contact?: string | null; rangement?: string | null; site?: number; centre?: number } = {}) {
    await dbQuery(
      `INSERT INTO t_cartes (noms, prenoms, statut, site_id, centre_id, sync_id, is_dirty, num_secu, date_de_naissance, lieu_de_naissance, contact, rangement)
       VALUES (?, ?, 'EN STOCK', ?, ?, ?, 0, ?, '1990-01-01', 'ABOBO', ?, ?)`,
      [`${P}_${key}`, 'QAPRE', opts.site ?? env.seed.siteId, opts.centre ?? env.seed.centreId, `zztest-ctc-${key}-${NOW}`,
        `ZZTEST-CTC-${key}-${NOW}`, opts.contact ?? null, opts.rangement ?? null]
    );
  }
  const row = async (key: string) => (await dbQuery(
    `SELECT noms, prenoms, contact, rangement, is_dirty, cle_doublon, cle_doublon_flex FROM t_cartes WHERE sync_id = ?`,
    [`zztest-ctc-${key}-${NOW}`]))[0];
  const outbox = async (key: string) => {
    try {
      return (await dbQuery(`SELECT COUNT(*) c FROM t_outbox WHERE sync_id = ?`, [`zztest-ctc-${key}-${NOW}`]))[0].c;
    } catch (e) { return 'n/a'; }
  };
  const toastsText = async () => (await env.window.locator('[role="status"]').allTextContents()).join(' | ');

  async function gotoHash(h: string) {
    await env.window.evaluate((x) => { window.location.hash = x; }, h);
    await env.window.waitForTimeout(1200);
  }

  async function logistique(key: string, contact: string | null, rangement: string, opts: { clearContact?: boolean } = {}) {
    const { window } = env;
    await gotoHash('#/inventaire/logistique');
    const annuler = window.getByRole('button', { name: 'Annuler' });
    if (await annuler.count()) await annuler.click();
    const search = window.locator('input[placeholder="Saisir les critères..."]');
    await expect(search).toBeVisible({ timeout: 10000 });
    await search.fill(`${P}_${key}`);
    await window.locator(`text=${P}_${key} QAPRE`).first().click();
    const ci = window.locator('input[placeholder="Ex: 0708090010"]');
    await expect(ci).toBeVisible({ timeout: 5000 });
    const prefilled = await ci.inputValue();
    if (opts.clearContact) await ci.fill('');
    else if (contact !== null) await ci.fill(contact);
    await window.locator('input[placeholder="Ex: MAIRIE-A3"]').fill(rangement);
    return { prefilled, ci };
  }
  async function submit(): Promise<string> {
    const { window } = env;
    await window.getByRole('button', { name: /Valider \(Entrée\)/ }).click();
    await window.waitForTimeout(1200);
    return await toastsText();
  }

  test('00 setup + login + taille 1366x768', async () => {
    const r = await dbQuery(
      `INSERT INTO t_sites (nom, code, is_active, max_centres, is_permanent, sync_id) VALUES (?, ?, 1, 4, 1, ?)`,
      [`${P}_SITE2`, `E2E-CTC-${NOW}`, `e2e-ctc-site2-${NOW}`]);
    site2 = r[0].lastInsertRowid;
    const c = await dbQuery(`INSERT INTO t_centres (site_id, nom, numero, sync_id) VALUES (?, ?, 1, ?)`,
      [site2, `${P}_CENTRE2`, `e2e-ctc-c2-${NOW}`]);
    centre2 = c[0].lastInsertRowid;
    for (const k of ['S1RIEN', 'S2PLUS', 'S3LOC', 'S5NEUF', 'S5LETTRE', 'S5CINQ', 'S7ONZE', 'S7DOUZE', 'S7MIX', 'S7SEP', 'S9PLUS225SEUL']) {
      await addCarte(k);
    }
    await addCarte('S4KEEP', { contact: '0102030405' });
    await addCarte('S6HIST', { contact: '12345' });
    await addCarte('AUTRESITE', { site: site2, centre: centre2 });
    await addCarte('R1ENTREE'); await addCarte('R2OK'); await addCarte('R5BAD');
    await addCarte('R3HIST', { contact: '12345' });
    await addCarte('R4KEEP', { contact: '0102030405' });

    await env.app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => !x.webContents.getURL().includes('splash'))!;
      w.unmaximize();
      w.setContentSize(1366, 768);
    });
    const u = getTestUser('operateurLogistique');
    const { window } = env;
    await window.waitForURL(/#\/login/, { timeout: 30000 });
    await window.getByTestId('login-input').fill(u.login);
    await window.getByTestId('password-input').fill(u.password);
    await window.getByTestId('login-submit').click();
    await window.waitForURL(/#\/inventaire/, { timeout: 20000 });
    console.log('[A13] viewport', JSON.stringify(await window.evaluate(() => [innerWidth, innerHeight])));
  });

  test('S1 rangement seul sans contact', async () => {
    const { prefilled } = await logistique('S1RIEN', null, 'ZZ-S1');
    await env.window.screenshot({ path: join(SHOT_DIR, 'logi-1-form.png') });
    const t = await submit();
    console.log(`[A13][S1] prefilled="${prefilled}" toast="${t}" DB=${JSON.stringify(await row('S1RIEN'))} outbox=${await outbox('S1RIEN')}`);
  });

  test('S2 contact valide avec +225 et espaces', async () => {
    await logistique('S2PLUS', '+225 07 08 09 00 10', 'ZZ-S2');
    const t = await submit();
    console.log(`[A13][S2a] toast="${t}" DB=${JSON.stringify(await row('S2PLUS'))} outbox=${await outbox('S2PLUS')}`);
    await logistique('S3LOC', '0708090010', 'ZZ-S3');
    const t2 = await submit();
    console.log(`[A13][S2b] toast="${t2}" DB=${JSON.stringify(await row('S3LOC'))}`);
    await logistique('S9PLUS225SEUL', '+2250708090010', 'ZZ-S9');
    const t3 = await submit();
    console.log(`[A13][S2c +225 colle sans espaces] toast="${t3}" DB=${JSON.stringify(await row('S9PLUS225SEUL'))}`);
  });

  test('S3 contact vide sur carte avec contact existant', async () => {
    const { prefilled } = await logistique('S4KEEP', null, 'ZZ-S4', { clearContact: true });
    const t = await submit();
    console.log(`[A13][S3] prefilled="${prefilled}" toast="${t}" DB=${JSON.stringify(await row('S4KEEP'))}`);
  });

  test('S4 contact invalide', async () => {
    const cases: [string, string][] = [['S5NEUF', '070809001'], ['S5LETTRE', 'abcdefghij'], ['S5CINQ', '07 08']];
    for (const [k, v] of cases) {
      await logistique(k, v, 'ZZ-' + k);
      await env.window.screenshot({ path: join(SHOT_DIR, `logi-4-${k}-avant.png`) });
      const t = await submit();
      await env.window.screenshot({ path: join(SHOT_DIR, `logi-4-${k}-apres.png`) });
      const stillForm = await env.window.locator('input[placeholder="Ex: MAIRIE-A3"]').count();
      console.log(`[A13][S4 ${k} "${v}"] toast="${t}" formulaire encore affiche=${stillForm > 0} DB=${JSON.stringify(await row(k))}`);
    }
  });

  test('S5 contact historique non conforme, non modifie', async () => {
    const { prefilled } = await logistique('S6HIST', null, 'ZZ-S6');
    const t = await submit();
    console.log(`[A13][S5] prefilled="${prefilled}" toast="${t}" DB=${JSON.stringify(await row('S6HIST'))}`);
  });

  test('P2-1 troncature 11/12 chiffres, lettres melees, separateurs', async () => {
    const cases: [string, string][] = [['S7ONZE', '07080900101'], ['S7DOUZE', '070809001012'], ['S7MIX', '0708090010abc'], ['S7SEP', '07-08.09/00 10']];
    for (const [k, v] of cases) {
      const lg = await logistique(k, v, 'ZZ-' + k);
      const valAvant = await lg.ci.inputValue();
      await env.window.waitForTimeout(800);
      const t = await submit();
      const r = await row(k);
      console.log(`[A13][P2-1 valeur champ avant envoi="${valAvant}"]`);
      console.log(`[A13][P2-1 ${k} "${v}"] toast="${t}" contact=${r.contact} rangement=${r.rangement} cle=${r.cle_doublon}`);
    }
  });

  test('S6 cloisonnement site', async () => {
    await gotoHash('#/inventaire/logistique');
    const search = env.window.locator('input[placeholder="Saisir les critères..."]');
    await search.fill(`${P}_AUTRESITE`);
    await env.window.waitForTimeout(1500);
    console.log(`[A13][S6] resultats carte autre site (Logistique) = ${await env.window.locator(`text=${P}_AUTRESITE`).count()}`);
    await gotoHash('#/inventaire/sans-rangement');
    await env.window.waitForTimeout(2000);
    console.log(`[A13][S6] autre site dans Sans rangement = ${await env.window.locator(`text=${P}_AUTRESITE`).count()}`);
    const idOther = (await dbQuery(`SELECT id_carte FROM t_cartes WHERE sync_id=?`, [`zztest-ctc-AUTRESITE-${NOW}`]))[0].id_carte;
    const res = await env.window.evaluate(async (id) => {
      try { await (window as any).api.cartes.updateRangementEtFiche(id, { rangement: 'ZZ-HACK', contact: '0708090010' }); return 'OK'; }
      catch (e: any) { return 'ERR ' + (e?.message || e); }
    }, idOther);
    console.log(`[A13][S6] IPC direct sur carte autre site -> ${res} | DB=${JSON.stringify(await row('AUTRESITE'))}`);
  });

  test('Sans rangement : layout, Entree, enregistrements', async () => {
    const { window } = env;
    await gotoHash('#/inventaire/sans-rangement');
    await window.waitForTimeout(2500);
    await window.screenshot({ path: join(SHOT_DIR, 'sansrang-1-initial.png') });
    const dims = await window.evaluate(() => {
      const t = document.querySelector('table');
      const sc = t?.parentElement;
      return {
        win: [innerWidth, innerHeight], docScrollW: document.documentElement.scrollWidth,
        table: t ? t.scrollWidth : null, wrapClient: sc?.clientWidth, wrapScroll: sc?.scrollWidth,
        wrapOverflowX: sc ? getComputedStyle(sc).overflowX : null
      };
    });
    console.log(`[A13][SR-layout] ${JSON.stringify(dims)}`);
    const rowOf = (k: string) => window.locator('tr', { hasText: `${P}_${k}` });
    const cIn = (k: string) => rowOf(k).locator('input[placeholder="0708090010"]');
    const rIn = (k: string) => rowOf(k).locator('input[placeholder="Ex: A-12-034"]');

    await cIn('R1ENTREE').fill('0708090010');
    await cIn('R1ENTREE').press('Enter');
    await window.waitForTimeout(1200);
    await window.screenshot({ path: join(SHOT_DIR, 'sansrang-2-enter-vide.png') });
    console.log(`[A13][SR-b] Entree contact + rangement vide : toast="${await toastsText()}" ligne visible=${await rowOf('R1ENTREE').count()} DB=${JSON.stringify(await row('R1ENTREE'))}`);

    await cIn('R2OK').fill('+225 07 08 09 00 10');
    await window.screenshot({ path: join(SHOT_DIR, 'sansrang-3-colle-225.png') });
    await rIn('R2OK').fill('ZZ-R2');
    await rIn('R2OK').press('Enter');
    await window.waitForTimeout(1800);
    console.log(`[A13][SR-ok] DB=${JSON.stringify(await row('R2OK'))} ligne restante=${await rowOf('R2OK').count()}`);

    await cIn('R5BAD').fill('12345');
    await rIn('R5BAD').fill('ZZ-R5');
    await rIn('R5BAD').press('Enter');
    await window.waitForTimeout(1000);
    await window.screenshot({ path: join(SHOT_DIR, 'sansrang-4-invalide.png') });
    console.log(`[A13][SR-invalide] toast="${await toastsText()}" ligne restante=${await rowOf('R5BAD').count()} DB=${JSON.stringify(await row('R5BAD'))}`);

    for (const [k, rg] of [['R3HIST', 'ZZ-R3'], ['R4KEEP', 'ZZ-R4']] as const) {
      if (await rowOf(k).count()) {
        console.log(`[A13][SR ${k}] contact prerempli="${await cIn(k).inputValue()}"`);
        if (k === 'R4KEEP') await cIn(k).fill('');
        await rIn(k).fill(rg);
        await rIn(k).press('Enter');
        await window.waitForTimeout(1800);
      } else {
        console.log(`[A13][SR ${k}] ligne absente de la page`);
      }
      console.log(`[A13][SR ${k}] DB=${JSON.stringify(await row(k))}`);
    }
  });

  test('cleanup', async () => {
    const del = await dbQuery(`DELETE FROM t_cartes WHERE noms LIKE 'ZZTEST_CTC%'`);
    await dbQuery(`DELETE FROM t_centres WHERE nom LIKE 'ZZTEST_CTC%'`);
    await dbQuery(`DELETE FROM t_sites WHERE nom LIKE 'ZZTEST_CTC%'`);
    const left = (await dbQuery(`SELECT COUNT(*) c FROM t_cartes WHERE noms LIKE 'ZZTEST_CTC%'`))[0].c;
    console.log(`[A13][CLEANUP] cartes supprimees=${del[0].changes} reste=${left}`);
  });
});
