/**
 * QA Terrain (agent-13) : commit 1bc15a3, ecran Sans rangement (Entree, conservation des saisies, aria-label).
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
const SHOT_DIR = join(__dirname, '..', '..', 'test-results', 'agent13-sr-shots');
const NOW = Date.now();
const SEARCH = 'input[placeholder="Saisir les critères..."]';
const WARN = 'Ce contact crée un doublon avec une autre carte';
const PN = 'QAPRE';
const nm = (k: string) => `ZZTEST_SR_${k}`;

test.describe.serial('QA Terrain Sans rangement 1bc15a3', () => {
  let env: E2EEnvironment;
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

  async function addCarte(key: string, o: { contact?: string | null; rangement?: string | null; site?: number; centre?: number; noms?: string; withKey?: boolean } = {}) {
    const noms = o.noms ?? nm(key);
    const cle = o.withKey && o.contact ? `${noms}|${PN}|1990-01-01|ABOBO|${o.contact}` : null;
    const cleFlex = o.withKey && o.contact ? `${noms}|${PN}|1990-01-01|${o.contact}` : null;
    try {
      await dbQuery(
        `INSERT INTO t_cartes (noms, prenoms, statut, site_id, centre_id, sync_id, is_dirty, num_secu, date_de_naissance, lieu_de_naissance, contact, rangement, cle_doublon, cle_doublon_flex)
         VALUES (?, ?, 'EN STOCK', ?, ?, ?, 0, ?, '1990-01-01', 'ABOBO', ?, ?, ?, ?)`,
        [noms, PN, o.site ?? env.seed.siteId, o.centre ?? env.seed.centreId, `zztest-sr-${key}-${NOW}`, `ZZTEST-SR-${key}-${NOW}`,
          o.contact ?? null, o.rangement === undefined ? null : o.rangement, cle, cleFlex]
      );
    } catch (e: any) { console.log(`[A13][SEED-ERR ${key}] ${e.message.split('\n')[0]}`); }
  }
  const sid = (key: string) => `zztest-sr-${key}-${NOW}`;
  const idOf = async (key: string) => (await dbQuery(`SELECT id_carte FROM t_cartes WHERE sync_id=?`, [sid(key)]))[0].id_carte;
  const row = async (key: string) => (await dbQuery(`SELECT contact, rangement, is_dirty FROM t_cartes WHERE sync_id = ?`, [sid(key)]))[0];
  const logsFor = async (key: string) => {
    const id = await idOf(key);
    return JSON.stringify((await dbQuery(`SELECT action FROM t_logs WHERE action = 'CONTACT_CARTE_MODIFIE' AND detail LIKE ?`, [`%carte ID ${id} %`])).map((x: any) => x.action));
  };
  const toastsText = async () => (await env.window.locator('[role="status"]').allTextContents()).join(' | ');
  async function waitNoToast() {
    try { await env.window.waitForFunction(() => document.querySelectorAll('[role="status"]').length === 0, null, { timeout: 12000 }); } catch { /* ignore */ }
  }
  async function gotoHash(h: string) {
    await env.window.evaluate((x) => { window.location.hash = x; }, h);
    await env.window.waitForTimeout(1500);
  }
  const cLab = (n: string) => `Contact (facultatif) de ${n} ${PN}`;
  const rLab = (n: string) => `Rangement de ${n} ${PN}`;
  const cIn = (n: string) => env.window.getByLabel(cLab(n), { exact: true });
  const rIn = (n: string) => env.window.getByLabel(rLab(n), { exact: true });
  const active = async () => env.window.evaluate(() => {
    const a = document.activeElement as HTMLInputElement | null;
    return a ? { aria: a.getAttribute('aria-label'), champ: a.getAttribute('data-champ'), placeholder: a.placeholder } : null;
  });
  async function srOpen() {
    await gotoHash('#/inventaire/scan');
    await gotoHash('#/inventaire/sans-rangement');
    await env.window.locator(SEARCH).waitFor({ state: 'visible', timeout: 10000 });
    await env.window.locator(SEARCH).fill('ZZTEST_SR_');
    await env.window.waitForTimeout(1600);
  }
  const refreshBtn = () => env.window.locator('button.btn-outline', { hasText: 'Actualiser' });
  const snapshot = async (names: string[]) => {
    const o: Record<string, string> = {};
    for (const n of names) {
      const c = cIn(n); const r = rIn(n);
      o[n.replace('ZZTEST_SR_', '')] = (await c.count()) ? `contact="${await c.inputValue()}" rang="${await r.inputValue()}"` : 'ABSENTE';
    }
    return JSON.stringify(o);
  };

  test('00 setup + login', async () => {
    const r2 = await dbQuery(`INSERT INTO t_sites (nom, code, is_active, max_centres, is_permanent, sync_id) VALUES (?, ?, 1, 4, 1, ?)`, [`ZZTEST_SR_SITE2`, `E2E-SR-${NOW}`, `e2e-sr-site2-${NOW}`]);
    site2 = r2[0].lastInsertRowid;
    centre2 = (await dbQuery(`INSERT INTO t_centres (site_id, nom, numero, sync_id) VALUES (?, ?, 1, ?)`, [site2, `ZZTEST_SR_C2`, `e2e-sr-c2-${NOW}`]))[0].lastInsertRowid;
    // 17 cartes A..Q (>15 pour la pagination). C a un contact en fiche.
    const keys = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    for (const k of keys) await addCarte(k, k === 'C' ? { contact: '0102030405' } : {});
    await addCarte('AUTRESITE', { site: site2, centre: centre2 });
    // paire doublon (A2 a deja rangement => seul B2 est liste)
    await addCarte('DUPB', { noms: 'ZZTEST_SR_DUP' });
    await addCarte('DUPA', { noms: 'ZZTEST_SR_DUP', contact: '0708090010', withKey: true, rangement: 'ZZ-DUPA' });
    const u = getTestUser('operateurLogistique');
    const { window } = env;
    await window.waitForURL(/#\/login/, { timeout: 30000 });
    await window.getByTestId('login-input').fill(u.login);
    await window.getByTestId('password-input').fill(u.password);
    await window.getByTestId('login-submit').click();
    await window.waitForURL(/#\/inventaire/, { timeout: 20000 });
  });

  test('1 Entree dans contact / rangement', async () => {
    const { window } = env;
    await srOpen();
    const names = await window.evaluate(() => Array.from(document.querySelectorAll('tbody tr td:first-child')).map((e) => (e as HTMLElement).innerText.trim()));
    console.log(`[A13][ORDRE] 5 premieres lignes: ${JSON.stringify(names.slice(0, 5))} total=${names.length}`);
    // Entree dans contact de B avec rangement vide (A,C,D... sont d'autres lignes)
    await cIn(nm('B')).focus();
    await window.keyboard.insertText('0708090012');
    await waitNoToast();
    await window.keyboard.press('Enter');
    await window.waitForTimeout(700);
    console.log(`[A13][ENTER contact, rangement vide] focus=${JSON.stringify(await active())} toasts="${await toastsText()}" DB(B)=${JSON.stringify(await row('B'))} ligneB=${await cIn(nm('B')).count()}`);
    // idem sur la ligne D pour verifier que c'est bien la ligne courante
    await cIn(nm('D')).focus();
    await window.keyboard.press('Enter');
    console.log(`[A13][ENTER contact D vide] focus=${JSON.stringify(await active())}`);
    await window.screenshot({ path: join(SHOT_DIR, 'enter-focus.png') });
    // rangement rempli : enregistre
    await rIn(nm('F')).fill('ZZ-F');
    await cIn(nm('F')).focus();
    await window.keyboard.insertText('0708090015');
    await waitNoToast();
    await window.keyboard.press('Enter');
    await window.waitForTimeout(1500);
    console.log(`[A13][ENTER contact, rangement rempli (F)] toast="${await toastsText()}" DB=${JSON.stringify(await row('F'))} ligneRestante=${await cIn(nm('F')).count()}`);
    // Entree dans rangement
    await rIn(nm('G')).fill('ZZ-G');
    await waitNoToast();
    await rIn(nm('G')).press('Enter');
    await window.waitForTimeout(1500);
    console.log(`[A13][ENTER rangement (G)] toast="${await toastsText()}" DB=${JSON.stringify(await row('G'))} ligneRestante=${await cIn(nm('G')).count()}`);
    await dbQuery(`UPDATE t_cartes SET rangement = NULL WHERE sync_id = ?`, [sid('B')]);
    console.log(`[A13][ETAT BASE] B=${JSON.stringify(await row('B'))}`);
  });

  test('2 conservation des saisies (rechargement silencieux) puis reinitialisations', async () => {
    const { window } = env;
    await srOpen();
    // lignes B, C, D, E, H toujours presentes ; A = ligne qu'on enregistre
    console.log(`[A13][AVANT SAISIE] ${await snapshot([nm('A'), nm('B'), nm('C'), nm('D'), nm('E'), nm('H')])}`);
    await rIn(nm('B')).fill('ZZ-B-NS');
    await cIn(nm('B')).focus(); await window.keyboard.press('Control+A'); await window.keyboard.insertText('0708090012');
    await cIn(nm('C')).focus(); await window.keyboard.press('Control+A'); await window.keyboard.insertText('0708090013'); // contact modifie, pas de rangement
    await rIn(nm('E')).fill('ZZ-E-GHOST');
    await rIn(nm('H')).fill('ZZ-H-NS');
    console.log(`[A13][APRES SAISIE B,C,E,H non enregistrees] ${await snapshot([nm('B'), nm('C'), nm('E'), nm('H')])}`);
    // E change de statut en base entre-temps (n'est plus "sans rangement")
    await dbQuery(`UPDATE t_cartes SET rangement = 'ZZ-AILLEURS' WHERE sync_id = ?`, [sid('E')]);
    // enregistre A (rangement + contact)
    await rIn(nm('A')).fill('ZZ-A');
    await cIn(nm('A')).focus(); await window.keyboard.insertText('0708090011');
    await waitNoToast();
    await rIn(nm('A')).press('Enter');
    await window.waitForTimeout(2500);
    console.log(`[A13][A enregistree] toast="${await toastsText()}" DB(A)=${JSON.stringify(await row('A'))}`);
    console.log(`[A13][APRES RECHARGEMENT SILENCIEUX] ${await snapshot([nm('A'), nm('B'), nm('C'), nm('D'), nm('E'), nm('H')])}`);
    const ghost = await window.evaluate(() => Array.from(document.querySelectorAll('input')).filter((i) => (i as HTMLInputElement).value === 'ZZ-E-GHOST').length);
    console.log(`[A13][FANTOME] inputs contenant la saisie de la ligne disparue E = ${ghost}`);
    await window.screenshot({ path: join(SHOT_DIR, 'apres-reload-silencieux.png') });
    // E revient dans le lot (rangement remis a NULL) : declenche un rechargement silencieux par enregistrement de I
    await dbQuery(`UPDATE t_cartes SET rangement = NULL WHERE sync_id = ?`, [sid('E')]);
    await rIn(nm('I')).fill('ZZ-I');
    await waitNoToast();
    await rIn(nm('I')).press('Enter');
    await window.waitForTimeout(2500);
    console.log(`[A13][E REVENUE dans le lot apres 2e rechargement silencieux] ${await snapshot([nm('B'), nm('C'), nm('E'), nm('H')])} (attendu E: contact vide, rang vide ; B/C/H conserves)`);
    // Actualiser : reinitialisation complete
    await refreshBtn().click();
    await window.waitForTimeout(1800);
    console.log(`[A13][APRES ACTUALISER] ${await snapshot([nm('B'), nm('C'), nm('E'), nm('H')])} (attendu: rang vides, C = fiche formatee)`);
    // saisie puis changement de page
    await rIn(nm('B')).fill('ZZ-B-PAGE');
    const nextBtn = window.getByRole('button', { name: 'Suivant' });
    const hasNext = (await nextBtn.count()) && !(await nextBtn.isDisabled());
    console.log(`[A13][PAGINATION] bouton Suivant actif=${hasNext}`);
    if (hasNext) {
      await nextBtn.click();
      await window.waitForTimeout(1500);
      await window.getByRole('button', { name: 'Précédent' }).click();
      await window.waitForTimeout(1500);
      console.log(`[A13][APRES CHANGEMENT DE PAGE aller-retour] ${await snapshot([nm('B'), nm('C')])}`);
    }
    // saisie puis changement de recherche
    await rIn(nm('B')).fill('ZZ-B-RECH');
    await window.locator(SEARCH).fill('ZZTEST_SR_B');
    await window.waitForTimeout(1600);
    await window.locator(SEARCH).fill('ZZTEST_SR_');
    await window.waitForTimeout(1600);
    console.log(`[A13][APRES CHANGEMENT DE RECHERCHE] ${await snapshot([nm('B'), nm('C')])}`);
  });

  test('3 accessibilite', async () => {
    const { window } = env;
    await srOpen();
    const total = await window.locator('tbody tr').count();
    const ok = await window.evaluate((pn) => {
      const rows = Array.from(document.querySelectorAll('tbody tr'));
      let good = 0; const bad: string[] = [];
      for (const r of rows) {
        const name = ((r.querySelector('td:nth-child(1)') as HTMLElement).innerText.trim() + ' ' + (r.querySelector('td:nth-child(2)') as HTMLElement).innerText.trim());
        const c = r.querySelector('input[aria-label^="Contact (facultatif) de"]');
        const g = r.querySelector('input[aria-label^="Rangement de"]');
        if (c && g && c.getAttribute('aria-label') === `Contact (facultatif) de ${name}`.replace(/\s+/g, ' ') && g.getAttribute('aria-label') === `Rangement de ${name}`.replace(/\s+/g, ' ')) good++; else bad.push(name);
      }
      void pn;
      return { good, bad: bad.slice(0, 3) };
    }, PN);
    console.log(`[A13][ARIA] lignes=${total} avec aria-label exacts=${ok.good} anomalies=${JSON.stringify(ok.bad)}`);
    console.log(`[A13][ARIA getByLabel] contact B trouve=${await cIn(nm('B')).count()} rangement B trouve=${await rIn(nm('B')).count()} getByRole(textbox)=${await window.getByRole('textbox', { name: cLab(nm('B')) }).count()}`);
    // Logistique : labels
    await gotoHash('#/inventaire/logistique');
    await window.locator(SEARCH).fill(nm('J'));
    await window.locator(`text=${nm('J')} ${PN}`).first().click();
    await window.locator('#logistique-contact-input').waitFor({ timeout: 5000 });
    await window.waitForTimeout(600);
    await window.locator('label[for="logistique-contact-input"]').click();
    console.log(`[A13][LABEL contact] focus id=${await window.evaluate(() => document.activeElement?.id)}`);
    await window.locator('label[for="logistique-rangement-input"]').click();
    console.log(`[A13][LABEL rangement] focus id=${await window.evaluate(() => document.activeElement?.id)}`);
    console.log(`[A13][getByLabel Logistique] "CONTACT" ${await window.getByLabel(/CONTACT/).count()} "CLASSEMENT" ${await window.getByLabel(/CLASSEMENT/).count()}`);
    await window.getByRole('button', { name: 'Annuler' }).click();
  });

  test('4 non-regression', async () => {
    const { window } = env;
    await srOpen();
    // collage 11 chiffres
    await cIn(nm('K')).focus(); await window.keyboard.press('Control+A'); await window.keyboard.insertText('07080900101');
    await window.waitForTimeout(300);
    console.log(`[A13][NR colle 11] champ="${await cIn(nm('K')).inputValue()}" toast="${await toastsText()}"`);
    await waitNoToast();
    // 9 chiffres + rangement
    await cIn(nm('K')).focus(); await window.keyboard.type('070809001');
    await rIn(nm('K')).fill('ZZ-K');
    await rIn(nm('K')).press('Enter');
    await window.waitForTimeout(1000);
    console.log(`[A13][NR 9 chiffres] champ="${await cIn(nm('K')).inputValue()}" toast="${await toastsText()}" DB=${JSON.stringify(await row('K'))}`);
    await waitNoToast();
    // frappe valide
    await cIn(nm('K')).focus(); await window.keyboard.press('Control+A'); await window.keyboard.press('Backspace');
    await window.keyboard.type('0708090016');
    console.log(`[A13][NR frappe] champ="${await cIn(nm('K')).inputValue()}"`);
    await rIn(nm('K')).press('Enter');
    await window.waitForTimeout(1500);
    console.log(`[A13][NR enregistre K] DB=${JSON.stringify(await row('K'))} journal=${await logsFor('K')}`);
    // doublon strict
    await window.locator(SEARCH).fill('ZZTEST_SR_DUP');
    await window.waitForTimeout(1500);
    await window.getByLabel(`Contact (facultatif) de ZZTEST_SR_DUP ${PN}`, { exact: true }).first().focus();
    await window.keyboard.insertText('0708090010');
    await window.getByLabel(`Rangement de ZZTEST_SR_DUP ${PN}`, { exact: true }).first().fill('ZZ-DUPB');
    await waitNoToast();
    await window.getByLabel(`Rangement de ZZTEST_SR_DUP ${PN}`, { exact: true }).first().press('Enter');
    await window.waitForTimeout(1200);
    const tt = await toastsText();
    console.log(`[A13][NR doublon] avertissement=${tt.includes(WARN)} toasts="${tt}" DB=${JSON.stringify(await row('DUPB'))}`);
    // cloisonnement + mesure
    await window.locator(SEARCH).fill('ZZTEST_SR_AUTRESITE');
    await window.waitForTimeout(1500);
    console.log(`[A13][NR site] autre site visible=${await window.locator('text=ZZTEST_SR_AUTRESITE').count()}`);
    await window.locator(SEARCH).fill('ZZTEST_SR_L');
    await window.waitForTimeout(1500);
    const cdp = await window.context().newCDPSession(window);
    for (const [w, h] of [[1366, 768], [1280, 720]] as const) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
      await window.waitForTimeout(700);
      const m = await window.evaluate(() => {
        const tb = document.querySelector('table') as HTMLElement; const wrap = tb.parentElement as HTMLElement; const wr = wrap.getBoundingClientRect();
        const btn = tb.querySelector('tbody tr:first-child button') as HTMLElement; const br = btn.getBoundingClientRect();
        return { inner: [innerWidth, innerHeight], wrapClient: wrap.clientWidth, wrapScroll: wrap.scrollWidth, btnVisible: br.right <= wr.right + 0.5 };
      });
      console.log(`[A13][NR MESURE ${w}x${h}] ${JSON.stringify(m)}`);
      await window.screenshot({ path: join(SHOT_DIR, `sansrang-${w}x${h}.png`) });
    }
    await cdp.send('Emulation.clearDeviceMetricsOverride');
    console.log(`[A13][CONSOLE] erreurs renderer (${consoleErrors.length}): ${JSON.stringify(consoleErrors.slice(0, 6))}`);
  });

  test('cleanup', async () => {
    const del = await dbQuery(`DELETE FROM t_cartes WHERE sync_id LIKE 'zztest-sr-%'`);
    await dbQuery(`DELETE FROM t_outbox WHERE id LIKE 'zztest-sr-%'`).catch(() => undefined);
    const dl = await dbQuery(`DELETE FROM t_logs WHERE detail LIKE '%ZZTEST_SR%'`).catch(() => [{ changes: 'n/a' }]);
    await dbQuery(`DELETE FROM t_centres WHERE nom LIKE 'ZZTEST_SR%'`);
    await dbQuery(`DELETE FROM t_sites WHERE nom LIKE 'ZZTEST_SR%'`);
    const left = (await dbQuery(`SELECT COUNT(*) c FROM t_cartes WHERE sync_id LIKE 'zztest-sr-%'`))[0].c;
    console.log(`[A13][CLEANUP] cartes supprimees=${del[0].changes} logs supprimes=${dl[0].changes} reste=${left}`);
  });
});
