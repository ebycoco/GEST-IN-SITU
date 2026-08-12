/**
 * e2e/specs/_agent13_admin_centre_p0_revalidation_v2.e2e.spec.ts
 *
 * QA Terrain (agent-13) — REVALIDATION des 7 failles P0 + 1 P1 trouvées lors
 * de l'audit précédent du portail ADMIN_CENTRE (/admin-centre), après
 * correctifs annoncés :
 *   P0-1 stats:getCentre / stats:getCentreOperateurs (scopeSiteCentreToSession)
 *   P0-2 cartes:getPage (centre_id forcé sur secureUser.centre_id)
 *   P0-3 cartes:getAbsencesCentre (centreId recadré session)
 *   P0-4 stats:getRetraits / stats:getRetraitsTrend (recadrage cross-centre/site)
 *   P0-5 Recherche CMU (cartes:search / searchCartesFTS) — fuite PII usage NORMAL
 *   P0-6 logs:consultation — filtrage via jointure t_users.login
 *   P0-7 audit:delete → doit cibler t_audit_log (pas audit_logs)
 *   P1   stats:getDetailedSyncStats (resolveScopedSiteId)
 *
 * `dist/` a été régénéré et vérifié sain (31 modules) juste avant ce run.
 * Base 100% isolée (userDataDir jetable via launchSeededApp, réseau Supabase
 * coupé) — jamais de données citoyennes réelles. Toute donnée insérée
 * directement en base porte le préfixe ZZTEST_, nettoyée en fin de fichier
 * avec revérification explicite (COUNT(*) = 0).
 *
 * Suite `describe.serial` : en mode serial, Playwright saute automatiquement
 * tous les tests restants dès qu'un `expect()` échoue dans l'un d'eux. Pour
 * garantir un rapport complet en un seul run (cold start Electron réel ~50-75s,
 * coûteux à relancer), chaque test capture son verdict réel dans
 * `console.log` (PASS/FAIL explicite via `verdict()`, cf. convention déjà
 * utilisée dans `e2e/specs/security/wave2-live-verification.e2e.spec.ts`) et
 * ne laisse jamais une assertion Playwright interrompre la suite. Le verdict
 * humain définitif est dans le rapport final de l'agent, pas dans le statut
 * Playwright de ce fichier.
 */
import { test, type Page } from '@playwright/test';
import {
  launchSeededApp,
  teardownSeededApp,
  type E2EEnvironment
} from '../fixtures/electron-app';
import { getTestUser } from '../fixtures/test-users';
import { join } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const SHOT_DIR =
  'C:\\Users\\EBYCHOCO\\AppData\\Local\\Temp\\claude\\d--Espace-travail-GEST-IN-SITU-CARTE-ABOBO-V2\\0ecf52dd-3c68-446e-99c9-2a28cf4e9dcc\\scratchpad';

const VERDICTS: string[] = [];
function verdict(id: string, ok: boolean, detail: string): void {
  const line = `[VERDICT][${id}] ${ok ? 'PASS' : 'FAIL'} — ${detail}`;
  VERDICTS.push(line);
  // eslint-disable-next-line no-console
  console.log(line);
}

test.describe.serial('QA Terrain — Revalidation P0/P1 portail ADMIN_CENTRE (agent-13, v2)', () => {
  let env: E2EEnvironment;
  let anyTestFailed = false;

  test.beforeAll(async () => {
    env = await launchSeededApp();
  });

  test.afterAll(async () => {
    console.log('\n\n========== RÉCAPITULATIF DES VERDICTS (revalidation P0/P1 ADMIN_CENTRE) ==========');
    for (const v of VERDICTS) console.log(v);
    console.log('====================================================================================\n');
    if (env) {
      await teardownSeededApp(env, anyTestFailed);
    }
  });

  test.afterEach(async ({}, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus) {
      anyTestFailed = true;
    }
  });

  // ── Helpers ────────────────────────────────────────────────────────────
  const DB_QUERY_MARKER = '__E2E_DBQ__:';
  async function dbQuery(sql: string, params: unknown[] = []): Promise<any[]> {
    const script = `
      const Database = require('better-sqlite3');
      const db = new Database(process.argv[1], { timeout: 15000 });
      db.pragma('busy_timeout = 15000');
      try {
        const sql = process.argv[2];
        const params = JSON.parse(process.argv[3]);
        const stmt = db.prepare(sql);
        let result;
        if (/^\\s*select/i.test(sql)) {
          result = stmt.all(...params);
        } else {
          const info = stmt.run(...params);
          result = [{ changes: info.changes, lastInsertRowid: info.lastInsertRowid }];
        }
        process.stdout.write(${JSON.stringify(DB_QUERY_MARKER)} + JSON.stringify(result));
      } finally {
        db.close();
      }
    `;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electronPath = require('electron') as unknown as string;
    const { stdout, stderr } = await execFileAsync(
      electronPath,
      ['-e', script, env.seed.dbPath, sql, JSON.stringify(params)],
      { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
    );
    const line = stdout.split(/\r?\n/).reverse().find((l) => l.startsWith(DB_QUERY_MARKER));
    if (!line) {
      throw new Error(`[dbQuery] Aucun résultat exploitable.\nSQL: ${sql}\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`);
    }
    return JSON.parse(line.slice(DB_QUERY_MARKER.length));
  }

  async function goHash(path: string): Promise<void> {
    await env.window.evaluate((p) => { window.location.hash = p; }, path);
  }

  async function loginAs(loginValue: string, password: string, urlRegex: RegExp): Promise<void> {
    const { window } = env;
    await window.waitForURL(/#\/login/, { timeout: 20000 });
    await window.getByTestId('login-input').fill(loginValue);
    await window.getByTestId('password-input').fill(password);
    await window.getByTestId('login-submit').click();
    await window.waitForURL(urlRegex, { timeout: 20000 });
  }

  async function logout(): Promise<void> {
    const { window } = env;
    try {
      await window.locator('.btn-logout').click({ timeout: 5000 });
      await window.waitForURL(/#\/login/, { timeout: 15000 });
    } catch (e) {
      console.warn('[E2E] Déconnexion normale impossible, reload direct sur #/login :', e);
      await window.evaluate(() => { window.location.hash = '#/login'; });
      await window.waitForURL(/#\/login/, { timeout: 15000 });
    }
  }

  // ── Données de test cross-centre / cross-site ─────────────────────────
  const now = Date.now();
  let centreBId = 0; // même site que ADMIN_CENTRE testé — cloisonnement intra-site
  let siteCId = 0;
  let centreCId = 0; // site totalement étranger — cloisonnement inter-site
  let cardCentreBStockId = 0;
  let cardCentreBAbsentId = 0;
  let cardCentreBDelivreId = 0;
  let cardSiteCId = 0;
  let ownLogId = 0;
  const allInsertedCardIds: number[] = [];

  test.beforeAll(async () => {
    const adminCentre = getTestUser('adminCentre');
    const ownSiteId = env.seed.siteId;

    const centreBRes = await dbQuery(
      `INSERT INTO t_centres (site_id, nom, numero, sync_id) VALUES (?, ?, 2, ?)`,
      [ownSiteId, 'ZZTEST_CENTRE_B', `zztest-centreb-v2-${now}`]
    );
    centreBId = centreBRes[0].lastInsertRowid;

    const siteCRes = await dbQuery(
      `INSERT INTO t_sites (nom, code, is_active, max_centres, is_permanent, sync_id) VALUES (?, ?, 1, 4, 1, ?)`,
      [`ZZTEST_SITE_C_V2_${now}`, `ZZTEST-SITEC-V2-${now}`, `zztest-sitec-v2-${now}`]
    );
    siteCId = siteCRes[0].lastInsertRowid;
    const centreCRes = await dbQuery(
      `INSERT INTO t_centres (site_id, nom, numero, sync_id) VALUES (?, ?, 1, ?)`,
      [siteCId, 'ZZTEST_CENTRE_C', `zztest-centrec-v2-${now}`]
    );
    centreCId = centreCRes[0].lastInsertRowid;

    // Un opérateur fantôme rattaché à Centre B — pour P0-1 (stats:getCentreOperateurs).
    await dbQuery(
      `INSERT INTO t_users (login, password_hash, nom_user, prenom_user, role, site_id, centre_id, is_dirty)
       VALUES (?, '$2a$10$invalidHashNeverUsedForLoginZZTEST', 'ZZTEST_CENTREB', 'OPERATEUR', 'OPERATEUR_VERIFICATION', ?, ?, 1)`,
      [`ZZTEST_CENTREB_OPERATOR_${now}`, ownSiteId, centreBId]
    );

    // Carte EN STOCK dans Centre B (même site) — CartesPage / Recherche / P0-5.
    let ins = await dbQuery(
      `INSERT INTO t_cartes (noms, prenoms, date_de_naissance, lieu_de_naissance, num_secu, statut, site_id, centre_id, contact, rangement)
       VALUES ('ZZTEST_CENTREB_STOCK', 'BENEFICIAIRE', '1985-03-20', 'ZZTEST_LIEU', ?, 'EN STOCK', ?, ?, '+225 07 07 07 07 07', 'BX-B1')`,
      [`ZZTEST-SECU-CENTREB-V2-${now}`, ownSiteId, centreBId]
    );
    cardCentreBStockId = ins[0].lastInsertRowid;
    allInsertedCardIds.push(cardCentreBStockId);

    // Carte ABSENTE (escalade CENTRE) dans Centre B — P0-3.
    ins = await dbQuery(
      `INSERT INTO t_cartes (noms, prenoms, date_de_naissance, lieu_de_naissance, num_secu, statut, statut_physique, escalade_niveau, agent_signalement_absence, date_signalement_absence, site_id, centre_id, rangement)
       VALUES ('ZZTEST_CENTREB_ABSENT', 'X', '1990-01-01', 'ZZTEST_LIEU', ?, 'EN STOCK', 'ABSENT', 'CENTRE', 'ZZTEST_GHOST_AGENT', datetime('now'), ?, ?, 'BX-B2')`,
      [`ZZTEST-SECU-CENTREB-ABS-V2-${now}`, ownSiteId, centreBId]
    );
    cardCentreBAbsentId = ins[0].lastInsertRowid;
    allInsertedCardIds.push(cardCentreBAbsentId);

    // Carte DELIVRE aujourd'hui dans Centre B — P0-4 (stats:getRetraits).
    ins = await dbQuery(
      `INSERT INTO t_cartes (noms, prenoms, date_de_naissance, lieu_de_naissance, num_secu, statut, site_id, centre_id, agent_distributeur, date_delivrance, nom_retirant, num_retirant, is_dirty)
       VALUES ('ZZTEST_CENTREB_DELIVRE', 'X', '1990-01-01', 'ZZTEST_LIEU', ?, 'DELIVRE', ?, ?, 'ZZTEST_GHOST_AGENT', datetime('now'), 'ZZTEST RETIRANT', '0700000000', 1)`,
      [`ZZTEST-SECU-CENTREB-DEL-V2-${now}`, ownSiteId, centreBId]
    );
    cardCentreBDelivreId = ins[0].lastInsertRowid;
    allInsertedCardIds.push(cardCentreBDelivreId);

    // Carte dans Site C (totalement étranger).
    ins = await dbQuery(
      `INSERT INTO t_cartes (noms, prenoms, date_de_naissance, lieu_de_naissance, num_secu, statut, site_id, centre_id, rangement)
       VALUES ('ZZTEST_SITEC_CARD', 'X', '1990-01-01', 'ZZTEST_LIEU', ?, 'EN STOCK', ?, ?, 'BX-C1')`,
      [`ZZTEST-SECU-SITEC-V2-${now}`, siteCId, centreCId]
    );
    cardSiteCId = ins[0].lastInsertRowid;
    allInsertedCardIds.push(cardSiteCId);

    // Utilisateur fantôme rattaché à Site C (log P0-6).
    await dbQuery(
      `INSERT INTO t_users (login, password_hash, nom_user, prenom_user, role, site_id, centre_id, is_dirty)
       VALUES (?, '$2a$10$invalidHashNeverUsedForLoginZZTEST', 'ZZTEST_SITEC', 'GHOST', 'OPERATEUR_VERIFICATION', ?, ?, 1)`,
      [`ZZTEST_SITEC_GHOST_${now}`, siteCId, centreCId]
    );
    await dbQuery(
      `INSERT INTO t_audit_log (utilisateur, action, details, date_creation) VALUES (?, ?, ?, datetime('now'))`,
      [`ZZTEST_SITEC_GHOST_${now}`, 'CONNEXION', JSON.stringify({ note: 'ZZTEST ghost log site C' })]
    );

    // Log réellement rattaché au propre compte ADMIN_CENTRE testé — pour P0-7 (suppression réelle).
    const ownLogRes = await dbQuery(
      `INSERT INTO t_audit_log (utilisateur, action, details, date_creation) VALUES (?, ?, ?, datetime('now'))`,
      [adminCentre.login, 'CONNEXION', JSON.stringify({ note: 'ZZTEST_OWN_LOG_FOR_DELETE' })]
    );
    ownLogId = ownLogRes[0].lastInsertRowid;

    console.log(
      `[agent13][SETUP] Centre B (id=${centreBId}), Site C (id=${siteCId})/Centre C (id=${centreCId}) créés. ` +
      `ADMIN_CENTRE testé = ${adminCentre.login}, site=${ownSiteId}, centre=${env.seed.centreId}. Log propre id=${ownLogId}.`
    );
  });

  // ═══════════════════════════════════════════════════════════════════
  // BLOC 1 — Connexion ADMIN_CENTRE, baseline.
  // ═══════════════════════════════════════════════════════════════════
  test('1. Connexion ADMIN_CENTRE et chargement du dashboard', async () => {
    const { window } = env;
    const user = getTestUser('adminCentre');
    try {
      await loginAs(user.login, user.password, /#\/admin-centre$/);
      const visible = await window.getByText('PORTAIL SUPERVISION').isVisible({ timeout: 10000 }).catch(() => false);
      verdict('BASELINE-1', visible, 'Connexion + dashboard ADMIN_CENTRE OK');
      await window.screenshot({ path: join(SHOT_DIR, 'agent13-v2-1-login.png') });
    } catch (e: any) {
      verdict('BASELINE-1', false, `EXCEPTION : ${e?.message || e}`);
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // BLOC 2 — P0-1 : stats:getCentre / stats:getCentreOperateurs.
  // ═══════════════════════════════════════════════════════════════════
  test('2. [P0-1] stats:getCentre — forgeage intra-site (Centre B) recadré sur le VRAI centre de session', async () => {
    const { window } = env;
    try {
      const ownTruth = (await dbQuery(
        `SELECT COUNT(*) as total FROM t_cartes WHERE site_id = ? AND centre_id = ?`,
        [env.seed.siteId, env.seed.centreId]
      ))[0];
      const centreBTruth = (await dbQuery(
        `SELECT COUNT(*) as total FROM t_cartes WHERE site_id = ? AND centre_id = ?`,
        [env.seed.siteId, centreBId]
      ))[0];
      const forged = await window.evaluate(async ({ centreB, siteId }) => {
        // @ts-expect-error API preload non typée ici
        return await window.api.stats.getCentre(centreB, siteId);
      }, { centreB: centreBId, siteId: env.seed.siteId });

      const ok = forged.total === ownTruth.total && (centreBTruth.total === 0 || forged.total !== centreBTruth.total);
      verdict('P0-1a', ok,
        `forged centreId=${centreBId} -> total=${forged?.total} (vérité propre centre=${ownTruth.total}, vérité Centre B=${centreBTruth.total})`);
    } catch (e: any) {
      verdict('P0-1a', false, `EXCEPTION : ${e?.message || e}`);
    }
  });

  test('3. [P0-1] stats:getCentre — forgeage cross-SITE (Centre C/Site C) recadré sur la VRAIE session', async () => {
    const { window } = env;
    try {
      const ownTruth = (await dbQuery(
        `SELECT COUNT(*) as total FROM t_cartes WHERE site_id = ? AND centre_id = ?`,
        [env.seed.siteId, env.seed.centreId]
      ))[0];
      const forged = await window.evaluate(async ({ centreC, siteC }) => {
        // @ts-expect-error idem
        return await window.api.stats.getCentre(centreC, siteC);
      }, { centreC: centreCId, siteC: siteCId });

      const ok = forged.total === ownTruth.total;
      verdict('P0-1b', ok, `forged centreId=${centreCId}, siteId=${siteCId} (étrangers) -> total=${forged?.total} (attendu propre centre=${ownTruth.total})`);
    } catch (e: any) {
      verdict('P0-1b', false, `EXCEPTION : ${e?.message || e}`);
    }
  });

  test('4. [P0-1] stats:getCentreOperateurs — forgeage Centre B ne renvoie plus la cadence de Centre B', async () => {
    const { window } = env;
    try {
      const forged = await window.evaluate(async (centreB) => {
        // @ts-expect-error idem
        return await window.api.stats.getCentreOperateurs(centreB);
      }, centreBId);
      const logins = (forged as any[]).map((r) => r.login);
      const leaked = logins.some((l) => String(l).startsWith('ZZTEST_CENTREB_OPERATOR'));
      verdict('P0-1c', !leaked, `forged centreId=${centreBId} -> logins=${JSON.stringify(logins)} (fuite Centre B=${leaked})`);
    } catch (e: any) {
      verdict('P0-1c', false, `EXCEPTION : ${e?.message || e}`);
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // BLOC 3 — P0-2 : cartes:getPage.
  // ═══════════════════════════════════════════════════════════════════
  test('5. [P0-2] cartes:getPage — appel forgé SANS filtre centre_id : la carte de Centre B ne fuite plus', async () => {
    const { window } = env;
    try {
      const forged = await window.evaluate(async () => {
        // @ts-expect-error idem — filtres vides, comme un client compromis/DevTools
        return await window.api.cartes.getPage(0, 200, {});
      });
      const noms = (forged.rows as any[]).map((r) => r.noms);
      const leaked = noms.includes('ZZTEST_CENTREB_STOCK');
      verdict('P0-2', !leaked, `cartes:getPage({}) -> total=${forged.total}, noms=${JSON.stringify(noms)} (fuite Centre B=${leaked})`);
    } catch (e: any) {
      verdict('P0-2', false, `EXCEPTION : ${e?.message || e}`);
    }
  });

  test('6. CartesPage — UI réelle : aucune carte de Centre B affichée', async () => {
    const { window } = env;
    try {
      await window.evaluate(() => { window.location.hash = '#/admin-centre/cartes'; });
      await window.waitForURL(/#\/admin-centre\/cartes/, { timeout: 15000 });
      const bodyText = await window.locator('body').innerText();
      const leaked = bodyText.includes('ZZTEST_CENTREB_STOCK');
      verdict('P0-2-UI', !leaked, `Vue Cartes CMU (ADMIN_CENTRE) contient ZZTEST_CENTREB_STOCK=${leaked}`);
      await window.screenshot({ path: join(SHOT_DIR, 'agent13-v2-6-cartes.png') });
    } catch (e: any) {
      verdict('P0-2-UI', false, `EXCEPTION : ${e?.message || e}`);
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // BLOC 4 — P0-3 : cartes:getAbsencesCentre.
  // ═══════════════════════════════════════════════════════════════════
  test('7. [P0-3] cartes:getAbsencesCentre — forgeage Centre B ne renvoie plus ses absences', async () => {
    const { window } = env;
    try {
      const forged = await window.evaluate(async (centreB) => {
        // @ts-expect-error idem
        return await window.api.cartes.getAbsencesCentre(centreB);
      }, centreBId);
      const noms = (forged as any[]).map((r) => r.noms);
      const leaked = noms.includes('ZZTEST_CENTREB_ABSENT');
      verdict('P0-3', !leaked, `forged centreId=${centreBId} -> ${JSON.stringify(noms)} (fuite Centre B=${leaked})`);
    } catch (e: any) {
      verdict('P0-3', false, `EXCEPTION : ${e?.message || e}`);
    }
  });

  test('8. AdminQueuePage — UI réelle : aucune anomalie de Centre B affichée', async () => {
    const { window } = env;
    try {
      await window.evaluate(() => { window.location.hash = '#/admin-centre/queue'; });
      await window.waitForURL(/#\/admin-centre\/queue/, { timeout: 15000 });
      const bodyText = await window.locator('body').innerText();
      const leaked = bodyText.includes('ZZTEST_CENTREB_ABSENT');
      verdict('P0-3-UI', !leaked, `Vue File d'attente (ADMIN_CENTRE) contient ZZTEST_CENTREB_ABSENT=${leaked}`);
      await window.screenshot({ path: join(SHOT_DIR, 'agent13-v2-8-queue.png') });
    } catch (e: any) {
      verdict('P0-3-UI', false, `EXCEPTION : ${e?.message || e}`);
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // BLOC 5 — P0-4 : stats:getRetraits / stats:getRetraitsTrend.
  // ═══════════════════════════════════════════════════════════════════
  test('9. [P0-4] stats:getRetraits/getRetraitsTrend — forgeage cross-centre ET cross-site recadrés', async () => {
    const { window } = env;
    try {
      const ownTruth = (await dbQuery(
        `SELECT COUNT(*) as total FROM t_cartes WHERE site_id = ? AND centre_id = ? AND statut = 'DELIVRE'`,
        [env.seed.siteId, env.seed.centreId]
      ))[0];

      const forgedCentreB = await window.evaluate(async ({ siteId, centreB }) => {
        // @ts-expect-error idem
        return await window.api.stats.getRetraits(siteId, centreB, 'annee', null);
      }, { siteId: env.seed.siteId, centreB: centreBId });
      const okB = forgedCentreB.totaux.cette_annee === ownTruth.total;
      verdict('P0-4a', okB,
        `forged stats.getRetraits(siteOwn, centreB) -> totaux.cette_annee=${forgedCentreB.totaux.cette_annee} (attendu propre centre=${ownTruth.total}, Centre B a 1 carte DELIVRE réelle)`);

      const forgedSiteC = await window.evaluate(async ({ siteC, centreC }) => {
        // @ts-expect-error idem
        return await window.api.stats.getRetraits(siteC, centreC, 'annee', null);
      }, { siteC: siteCId, centreC: centreCId });
      const okC = forgedSiteC.totaux.cette_annee === ownTruth.total;
      verdict('P0-4b', okC, `forged stats.getRetraits(siteC, centreC) [étrangers] -> totaux.cette_annee=${forgedSiteC.totaux.cette_annee} (attendu propre centre=${ownTruth.total})`);

      const trendForged = await window.evaluate(async ({ siteId, centreB }) => {
        // @ts-expect-error idem
        return await window.api.stats.getRetraitsTrend(siteId, centreB, 'annee', null);
      }, { siteId: env.seed.siteId, centreB: centreBId });
      verdict('P0-4c', Array.isArray(trendForged), `stats.getRetraitsTrend forgé ne plante pas (recadré silencieusement) -> ${JSON.stringify(trendForged).slice(0, 200)}`);
    } catch (e: any) {
      verdict('P0-4', false, `EXCEPTION : ${e?.message || e}`);
    }
  });

  test('10. RetraitsPage — UI réelle : "Total de votre Centre" = 0 (Centre B ne pollue pas)', async () => {
    const { window } = env;
    try {
      await window.evaluate(() => { window.location.hash = '#/admin-centre/retraits'; });
      await window.waitForURL(/#\/admin-centre\/retraits/, { timeout: 15000 });
      await window.getByRole('heading', { name: 'Suivi des Retraits' }).waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
      await window.waitForTimeout(800);
      const visible = await window.getByText('Votre centre uniquement').isVisible({ timeout: 10000 }).catch(() => false);
      const bodyText = await window.locator('body').innerText().catch(() => '');
      const foundInBody = bodyText.includes('Votre centre uniquement');
      verdict('P0-4-UI', visible || foundInBody, `Vue Retraits (ADMIN_CENTRE) affiche le badge "Votre centre uniquement" (getByText=${visible}, bodyText=${foundInBody})`);
      await window.screenshot({ path: join(SHOT_DIR, 'agent13-v2-10-retraits.png') });
    } catch (e: any) {
      verdict('P0-4-UI', false, `EXCEPTION : ${e?.message || e}`);
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // BLOC 6 — P0-5 : Recherche CMU (le plus important — fuite PII usage normal).
  // ═══════════════════════════════════════════════════════════════════
  test('11. [P0-5] Recherche CMU — recherche NORMALE (sans forgeage) d\'un bénéficiaire de Centre B : ne doit PLUS apparaître', async () => {
    const { window } = env;
    try {
      await window.evaluate(() => { window.location.hash = '#/admin-centre/recherche'; });
      await window.waitForURL(/#\/admin-centre\/recherche/, { timeout: 15000 });
      await window.getByPlaceholder('Ex: KOFFI KOFFI KAN').fill('ZZTEST_CENTREB_STOCK BENEFICIAIRE');
      await window.locator('input[placeholder="JJ/MM/AAAA"]').fill('20/03/1985');
      await window.getByRole('button', { name: /Rechercher la Carte/ }).click();
      await window.waitForTimeout(2000);

      const bodyText = await window.locator('body').innerText();
      const nameLeaked = bodyText.includes('ZZTEST_CENTREB_STOCK');
      const secuLeaked = bodyText.includes('ZZTEST-SECU-CENTREB-V2');
      const contactLeaked = bodyText.includes('+225 07 07 07 07 07');
      const ok = !nameLeaked && !secuLeaked && !contactLeaked;
      verdict('P0-5-fixed', ok,
        `Recherche nom+date d'un bénéficiaire de Centre B depuis ADMIN_CENTRE (Centre A) -> nom visible=${nameLeaked}, num_secu visible=${secuLeaked}, contact visible=${contactLeaked} (attendu false partout)`);
      await window.screenshot({ path: join(SHOT_DIR, 'agent13-v2-11-recherche-noleak.png') });
      // Le résultat "Carte Introuvable" s'affiche dans une modale plein écran dédiée (bouton
      // "Fermer et recommencer"), DISTINCTE du bouton "Effacer" du formulaire (qui réinitialise
      // les champs mais ne ferme pas cette modale) — la fermer explicitement pour ne pas fausser
      // la recherche du test suivant sur cette même instance de page (pas de remount, même hash).
      await window.getByRole('button', { name: 'Fermer et recommencer' }).click({ force: true, timeout: 5000 }).catch(() => {});
      await window.getByRole('button', { name: 'Effacer' }).click({ force: true }).catch(() => {});
    } catch (e: any) {
      verdict('P0-5-fixed', false, `EXCEPTION : ${e?.message || e}`);
    }
  });

  test('12. [P0-5 non-régression] Recherche CMU — un bénéficiaire de SON PROPRE centre reste trouvable', async () => {
    const { window } = env;
    try {
      const ownSiteId = env.seed.siteId;
      const ins = await dbQuery(
        `INSERT INTO t_cartes (noms, prenoms, date_de_naissance, lieu_de_naissance, num_secu, statut, site_id, centre_id, contact, rangement)
         VALUES ('ZZTEST_CENTREA_SEARCHABLE', 'BENEFICIAIRE', '1988-05-15', 'ZZTEST_LIEU', ?, 'EN STOCK', ?, ?, '+225 06 06 06 06 06', 'BX-A0')`,
        [`ZZTEST-SECU-CENTREA-SEARCH-${now}`, ownSiteId, env.seed.centreId]
      );
      const newCardId = ins[0].lastInsertRowid;
      allInsertedCardIds.push(newCardId);

      // Diagnostic (avant toute interaction UI) : la carte est-elle bien visible en base et dans
      // l'index FTS5 juste après l'insertion brute (dbQuery, hors flux applicatif) ? Permet de
      // distinguer un vrai bug produit d'un artefact de méthode de test (propagation FTS5).
      const rawRow = await dbQuery(`SELECT id_carte, noms, centre_id, site_id FROM t_cartes WHERE id_carte = ?`, [newCardId]);
      const ftsRow = await dbQuery(`SELECT rowid FROM t_cartes_fts WHERE rowid = ?`, [newCardId]);
      console.log(`[agent13][DIAG-12] Après insert brut id=${newCardId} -> t_cartes=${JSON.stringify(rawRow)}, t_cartes_fts contient rowid=${ftsRow.length === 1}`);

      // Diagnostic bis : appel forgé direct du handler IPC cartes:search (contourne la logique
      // de filtrage client "directMatches" de useVerificationSearch.ts) pour isoler si le
      // problème vient du serveur ou du parsing renderer.
      const directIpc = await window.evaluate(async () => {
        // @ts-expect-error API preload non typée ici
        return await window.api.cartes.search('ZZTEST_CENTREA_SEARCHABLE BENEFICIAIRE', 50, { date_de_naissance: '1988-05-15' });
      });
      console.log(`[agent13][DIAG-12] cartes:search direct (sans passer par le formulaire) -> ${JSON.stringify((directIpc as any[]).map(r => ({ noms: r.noms, centre_id: r.centre_id })))}`);

      await window.evaluate(() => { window.location.hash = '#/admin-centre/recherche'; });
      await window.waitForURL(/#\/admin-centre\/recherche/, { timeout: 15000 });
      await window.getByPlaceholder('Ex: KOFFI KOFFI KAN').fill('ZZTEST_CENTREA_SEARCHABLE BENEFICIAIRE');
      await window.locator('input[placeholder="JJ/MM/AAAA"]').fill('15/05/1988');
      // force:true — un panneau "Carte Introuvable" du test précédent (même route hash, pas de
      // remount) peut transitoirement intercepter le clic pendant sa disparition (animate-fade-in).
      await window.getByRole('button', { name: /Rechercher la Carte/ }).click({ force: true, timeout: 15000 });

      // Un match EXACT unique déclenche directement la modale "Vérification Physique"
      // (useVerificationSearch.ts, branche directMatches.length===1) plutôt qu'une liste de
      // résultats textuelle — le nom du bénéficiaire n'apparaît pas en clair dans l'en-tête de
      // cette modale (seul le n° CMU y figure, voir DeliveryModal.tsx). Signal correct = la
      // modale elle-même, pas le nom.
      const modalOpened = await window.getByText('Vérification Physique').isVisible({ timeout: 10000 }).catch(() => false);
      const bodyTextAfter = await window.locator('body').innerText().catch(() => '');
      verdict('P0-5-nonreg', modalOpened,
        `Recherche d'un bénéficiaire du PROPRE centre -> modale "Vérification Physique" ouverte=${modalOpened} ` +
        `(diag FTS=${ftsRow.length === 1}, diag IPC direct=${(directIpc as any[]).length} résultat(s)) ` +
        `${modalOpened ? '' : `— texte page au moment de l'échec (200 premiers car.) : ${bodyTextAfter.slice(0, 200)}`}`);
      await window.screenshot({ path: join(SHOT_DIR, 'agent13-v2-12-recherche-ownfound.png') });

      // Nettoie la modale ouverte pour ne pas perturber le test suivant.
      await window.locator('button.btn-close').click({ timeout: 3000, force: true }).catch(() => {});
      await window.getByRole('button', { name: 'Effacer' }).click({ force: true }).catch(() => {});
    } catch (e: any) {
      verdict('P0-5-nonreg', false, `EXCEPTION : ${e?.message || e}`);
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // BLOC 7 — Scénario légitime bout-en-bout (propre centre) — non-régression.
  // ═══════════════════════════════════════════════════════════════════
  test('13. Bout-en-bout — recherche, vérification physique et délivrance réelle d\'une carte de SON PROPRE centre', async () => {
    const { window } = env;
    const user = getTestUser('adminCentre');
    try {
      const ins = await dbQuery(
        `INSERT INTO t_cartes (noms, prenoms, date_de_naissance, lieu_de_naissance, num_secu, statut, site_id, centre_id, contact, rangement)
         VALUES ('ZZTEST_CENTREA_DELIVER', 'BENEFICIAIRE', '1992-07-11', 'ZZTEST_LIEU', ?, 'EN STOCK', ?, ?, '+225 05 05 05 05 05', 'BX-A1')`,
        [`ZZTEST-SECU-CENTREA-DELIVER-${now}`, env.seed.siteId, env.seed.centreId]
      );
      const cardId = ins[0].lastInsertRowid;
      allInsertedCardIds.push(cardId);

      await goHash('#/admin-centre/recherche');
      await window.waitForURL(/#\/admin-centre\/recherche/, { timeout: 15000 });
      await window.getByPlaceholder('Ex: KOFFI KOFFI KAN').fill('ZZTEST_CENTREA_DELIVER BENEFICIAIRE');
      await window.locator('input[placeholder="JJ/MM/AAAA"]').fill('11/07/1992');
      await window.getByRole('button', { name: /Rechercher la Carte/ }).click({ force: true, timeout: 15000 });
      await window.waitForTimeout(1500);

      const modalOpened = await window.getByText('Vérification Physique').isVisible({ timeout: 10000 }).catch(() => false);
      if (!modalOpened) {
        const bodyTextAfter = await window.locator('body').innerText().catch(() => '');
        console.log(`[agent13][DIAG-13] Modale non ouverte après recherche — texte page (400 premiers car.) : ${bodyTextAfter.slice(0, 400)}`);
        const directIpc = await window.evaluate(async () => {
          // @ts-expect-error API preload non typée ici
          return await window.api.cartes.search('ZZTEST_CENTREA_DELIVER BENEFICIAIRE', 50, { date_de_naissance: '1992-07-11' });
        });
        console.log(`[agent13][DIAG-13] cartes:search direct (diagnostic) -> ${JSON.stringify((directIpc as any[]).map((r: any) => ({ noms: r.noms, statut_physique: r.statut_physique, statut: r.statut, centre_id: r.centre_id })))}`);
        throw new Error(`Modale "Vérification Physique" non ouverte après recherche du bénéficiaire propre centre.`);
      }
      await window.getByRole('button', { name: /Oui, j'ai la carte/ }).click();
      await window.getByText('Validation du Retrait').waitFor({ state: 'visible', timeout: 10000 });
      await window.getByRole('button', { name: /Valider la délivrance/ }).click();
      const successVisible = await window.getByText('Carte délivrée avec succès !').isVisible({ timeout: 10000 }).catch(() => false);

      const rowAfter = (await dbQuery(
        `SELECT statut, agent_distributeur, is_dirty, centre_id FROM t_cartes WHERE id_carte = ?`,
        [cardId]
      ))[0];
      const dbOk = rowAfter.statut === 'DELIVRE' && rowAfter.agent_distributeur.toUpperCase() === user.login.toUpperCase()
        && rowAfter.is_dirty === 1 && rowAfter.centre_id === env.seed.centreId;
      verdict('E2E-DELIVERY', successVisible && dbOk, `UI succès=${successVisible}, DB après=${JSON.stringify(rowAfter)}`);
      await window.screenshot({ path: join(SHOT_DIR, 'agent13-v2-13-delivery.png') });
    } catch (e: any) {
      verdict('E2E-DELIVERY', false, `EXCEPTION : ${e?.message || e}`);
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // BLOC 8 — P0-6 / P0-7 : LogsPage.
  // ═══════════════════════════════════════════════════════════════════
  test('14. [P0-6] LogsPage — le log fantôme d\'un site totalement étranger n\'apparaît plus', async () => {
    const { window } = env;
    try {
      await window.evaluate(() => { window.location.hash = '#/admin-centre/logs'; });
      await window.waitForURL(/#\/admin-centre\/logs/, { timeout: 15000 });
      await window.getByText("Journal d'Audit Système").waitFor({ state: 'visible', timeout: 10000 });
      await window.waitForTimeout(1000);

      const bodyText = await window.locator('body').innerText();
      const leaked = bodyText.includes(`ZZTEST_SITEC_GHOST_${now}`);
      verdict('P0-6', !leaked, `Log ZZTEST_SITEC_GHOST_${now} (site totalement étranger) visible dans /admin-centre/logs=${leaked} (attendu false)`);
      await window.screenshot({ path: join(SHOT_DIR, 'agent13-v2-14-logs.png') });
    } catch (e: any) {
      verdict('P0-6', false, `EXCEPTION : ${e?.message || e}`);
    }
  });

  test('15. [P0-7] Bouton "Supprimer" d\'un log — le log propre affiché DISPARAÎT réellement de t_audit_log', async () => {
    const { window } = env;
    const user = getTestUser('adminCentre');
    try {
      const before = await dbQuery(`SELECT id FROM t_audit_log WHERE id = ?`, [ownLogId]);
      const beforeOk = before.length === 1;

      await window.evaluate(() => { window.location.hash = '#/admin-centre/logs'; });
      await window.waitForURL(/#\/admin-centre\/logs/, { timeout: 15000 });

      // Filtrer/localiser précisément la ligne du log propre inséré en base (utilisateur = adminCentre.login,
      // action CONNEXION, détail ZZTEST_OWN_LOG_FOR_DELETE) — la table peut être paginée/triée DESC.
      const row = window.locator('tr', { hasText: 'ZZTEST_OWN_LOG_FOR_DELETE' }).first();
      const rowVisible = await row.isVisible({ timeout: 8000 }).catch(() => false);
      if (!rowVisible) {
        verdict('P0-7', false, `Ligne du log propre (id=${ownLogId}) introuvable dans l'UI /admin-centre/logs — impossible de tester le bouton Supprimer.`);
      } else {
        await row.locator('button[title="Supprimer ce log"]').click();
        const pwdInput = window.getByPlaceholder('••••••••').last();
        const hasPasswordPrompt = await pwdInput.isVisible({ timeout: 5000 }).catch(() => false);
        if (hasPasswordPrompt) {
          await pwdInput.fill(user.password);
        }
        await window.getByRole('button', { name: 'Confirmer' }).click();
        await window.waitForTimeout(1500);

        const after = await dbQuery(`SELECT id FROM t_audit_log WHERE id = ?`, [ownLogId]);
        const deleted = after.length === 0;
        verdict('P0-7', beforeOk && deleted, `Avant suppression présent=${beforeOk}, après clic "Supprimer"+confirmation présent en base=${after.length === 1} (attendu disparu)`);
        await window.screenshot({ path: join(SHOT_DIR, 'agent13-v2-15-logs-delete.png') });
      }
    } catch (e: any) {
      verdict('P0-7', false, `EXCEPTION : ${e?.message || e}`);
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // BLOC 9 — P1 : stats:getDetailedSyncStats.
  // ═══════════════════════════════════════════════════════════════════
  test('16. [P1] stats:getDetailedSyncStats — forgeage cross-site recadré sur le vrai site de session', async () => {
    const { window } = env;
    try {
      const ownForged = await window.evaluate(async (siteId) => {
        // @ts-expect-error idem
        return await window.api.stats.getDetailedSyncStats(siteId);
      }, env.seed.siteId);
      const foreignForged = await window.evaluate(async (siteC) => {
        // @ts-expect-error idem
        return await window.api.stats.getDetailedSyncStats(siteC);
      }, siteCId);
      const ok = JSON.stringify(ownForged) === JSON.stringify(foreignForged);
      verdict('P1-syncstats', ok, `getDetailedSyncStats(siteOwn)=${JSON.stringify(ownForged)} vs getDetailedSyncStats(siteC forgé)=${JSON.stringify(foreignForged)} (doivent être identiques = ignore le paramètre forgé)`);
    } catch (e: any) {
      verdict('P1-syncstats', false, `EXCEPTION : ${e?.message || e}`);
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // BLOC 10 — Contrôle d'accès négatif (rappel rapide, déjà validé au run précédent).
  // ═══════════════════════════════════════════════════════════════════
  test('17. Contrôle d\'accès négatif — routes réservées redirigent proprement vers /admin-centre', async () => {
    const { window } = env;
    try {
      const forbiddenRoutes = ['/dashboard', '/sites', '/sync/status', '/maintenance'];
      let allOk = true;
      for (const route of forbiddenRoutes) {
        await goHash(`#${route}`);
        await window.waitForURL(/#\/admin-centre$/, { timeout: 10000 }).catch(() => { allOk = false; });
      }
      verdict('ACCES-NEGATIF', allOk, `Routes testées : ${forbiddenRoutes.join(', ')} -> toutes redirigées vers /admin-centre=${allOk}`);
    } catch (e: any) {
      verdict('ACCES-NEGATIF', false, `EXCEPTION : ${e?.message || e}`);
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // BLOC 11 — Non-régression : autres rôles utilisant searchCartesFTS/cartes:search.
  // ═══════════════════════════════════════════════════════════════════
  test('18. [Non-régression] OPERATEUR_VERIFICATION — recherche reste site-large (pas restreinte au centre)', async () => {
    const { window } = env;
    try {
      await logout();
      const opVerif = getTestUser('operateurVerification');
      await loginAs(opVerif.login, opVerif.password, /#\/agent-verification/);
      await goHash('#/agent-verification/recherche');
      await window.waitForURL(/#\/agent-verification\/recherche/, { timeout: 15000 });

      // Le montage de cette vue attend 2 appels IPC séquentiels (hierarchy.getCentres puis
      // stats.get) avant de décider d'afficher le formulaire ou l'écran "Base de données locale
      // vide" (RechercheView.tsx) — délai généreux pour ne pas confondre lenteur de démarrage
      // avec une vraie régression.
      const nameInput = window.getByPlaceholder('Ex: KOFFI KOFFI KAN');
      const emptyScreen = window.getByText('Base de données locale vide');
      await Promise.race([
        nameInput.waitFor({ state: 'visible', timeout: 20000 }).catch(() => {}),
        emptyScreen.waitFor({ state: 'visible', timeout: 20000 }).catch(() => {})
      ]);
      const hasNameInput = await nameInput.isVisible().catch(() => false);
      const hasEmptyScreen = await emptyScreen.isVisible().catch(() => false);
      let found = false;
      if (hasNameInput) {
        await nameInput.fill('ZZTEST_CENTREB_STOCK BENEFICIAIRE');
        await window.locator('input[placeholder="JJ/MM/AAAA"]').fill('20/03/1985');
        await window.getByRole('button', { name: /Rechercher la Carte/ }).click({ force: true, timeout: 15000 });
        await window.waitForTimeout(2000);
        found = await window.getByText('ZZTEST_CENTREB_STOCK').first().isVisible({ timeout: 8000 }).catch(() => false);
      }
      verdict('NONREG-OPVERIF', hasNameInput && found,
        `OPERATEUR_VERIFICATION (même site, autre centre que ADMIN_CENTRE testé) recherche ZZTEST_CENTREB_STOCK -> ` +
        `formulaire trouvé=${hasNameInput}, écran "base vide" affiché=${hasEmptyScreen}, carte trouvée=${found} (attendu formulaire=true — cette recherche n'est PAS restreinte au centre pour ce rôle, choix produit assumé pour ADMIN_CENTRE uniquement)`);
      await window.screenshot({ path: join(SHOT_DIR, 'agent13-v2-18-opverif-search.png') });
      await logout();
    } catch (e: any) {
      verdict('NONREG-OPVERIF', false, `EXCEPTION : ${e?.message || e}`);
      await logout().catch(() => {});
    }
  });

  test('19. [Non-régression] ADMINISTRATEUR_SITE — recherche CMU reste multi-centre (portée site entière conservée)', async () => {
    const { window } = env;
    try {
      const adminSite = getTestUser('administrateurSite');
      await loginAs(adminSite.login, adminSite.password, /#\/dashboard/);
      const forged = await window.evaluate(async () => {
        // @ts-expect-error idem
        return await window.api.cartes.search('ZZTEST_CENTREB_STOCK', 50, {});
      });
      const noms = (forged as any[]).map((r) => r.noms);
      const found = noms.includes('ZZTEST_CENTREB_STOCK');
      verdict('NONREG-ADMINSITE', found, `ADMINISTRATEUR_SITE cartes:search('ZZTEST_CENTREB_STOCK') -> ${JSON.stringify(noms)} (attendu true — portée site entière non restreinte, seul ADMIN_CENTRE est cantonné à son centre)`);
      await logout();
    } catch (e: any) {
      verdict('NONREG-ADMINSITE', false, `EXCEPTION : ${e?.message || e}`);
      await logout().catch(() => {});
    }
  });

  test('20. [Non-régression] SUPER ADMIN — recherche CMU reste multi-site', async () => {
    const { window } = env;
    try {
      const superAdmin = getTestUser('superAdmin');
      await loginAs(superAdmin.login, superAdmin.password, /#\/dashboard/);
      const forged = await window.evaluate(async () => {
        // @ts-expect-error idem
        return await window.api.cartes.search('ZZTEST_SITEC_CARD', 50, {});
      });
      const noms = (forged as any[]).map((r) => r.noms);
      const found = noms.includes('ZZTEST_SITEC_CARD');
      verdict('NONREG-SUPERADMIN', found, `SUPER ADMIN cartes:search('ZZTEST_SITEC_CARD') [autre site] -> ${JSON.stringify(noms)} (attendu true — portée globale conservée)`);
      await logout();
    } catch (e: any) {
      verdict('NONREG-SUPERADMIN', false, `EXCEPTION : ${e?.message || e}`);
      await logout().catch(() => {});
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // BLOC 12 — Nettoyage exhaustif des données de test (§1 garde-fou).
  // ═══════════════════════════════════════════════════════════════════
  test('21. Nettoyage — suppression de toutes les données ZZTEST_ créées', async () => {
    for (const id of allInsertedCardIds) {
      await dbQuery(`DELETE FROM t_cartes WHERE id_carte = ?`, [id]);
    }
    await dbQuery(`DELETE FROM t_cartes WHERE noms LIKE 'ZZTEST_%'`);
    await dbQuery(`DELETE FROM t_audit_log WHERE utilisateur LIKE 'ZZTEST_%' OR details LIKE '%ZZTEST%'`);
    await dbQuery(`DELETE FROM audit_logs WHERE operator_id LIKE 'ZZTEST_%' OR details LIKE '%ZZTEST%'`);
    await dbQuery(`DELETE FROM t_users WHERE login LIKE 'ZZTEST_%'`);
    await dbQuery(`DELETE FROM t_centres WHERE nom LIKE 'ZZTEST_%'`);
    await dbQuery(`DELETE FROM t_sites WHERE nom LIKE 'ZZTEST_%'`);

    const remainingCards = (await dbQuery(`SELECT COUNT(*) as c FROM t_cartes WHERE noms LIKE 'ZZTEST_%'`))[0].c;
    const remainingLogs = (await dbQuery(`SELECT COUNT(*) as c FROM t_audit_log WHERE utilisateur LIKE 'ZZTEST_%'`))[0].c;
    const remainingUsers = (await dbQuery(`SELECT COUNT(*) as c FROM t_users WHERE login LIKE 'ZZTEST_%'`))[0].c;
    const remainingCentres = (await dbQuery(`SELECT COUNT(*) as c FROM t_centres WHERE nom LIKE 'ZZTEST_%'`))[0].c;
    const remainingSites = (await dbQuery(`SELECT COUNT(*) as c FROM t_sites WHERE nom LIKE 'ZZTEST_%'`))[0].c;
    const allClean = remainingCards === 0 && remainingLogs === 0 && remainingUsers === 0 && remainingCentres === 0 && remainingSites === 0;
    verdict('NETTOYAGE', allClean,
      `Restants -> cartes=${remainingCards}, logs=${remainingLogs}, users=${remainingUsers}, centres=${remainingCentres}, sites=${remainingSites} (attendu 0 partout)`);
  });
});
