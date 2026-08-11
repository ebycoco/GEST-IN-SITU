/**
 * e2e/specs/_agent13_verification_saisie_overview.e2e.spec.ts
 *
 * QA Terrain (agent-13) — Test fonctionnel vivant des 2 nouvelles sections "Travail du jour"
 * paginées ajoutées après le portail OPERATEUR_APUREMENT (déjà validé) :
 *
 *   Tâche A — OPERATEUR_VERIFICATION (AgentVerification/views/Overview.tsx) : les 4 KPI
 *   existants (useVerificationStats / stats:getVerification) restent inchangés ; nouvelle
 *   liste paginée "Travail du jour" (20/page) alimentée par le nouvel endpoint
 *   stats:getVerificationCardsTodayPaginated, filtrée sur date_delivrance.
 *
 *   Tâche B — OPERATEUR_SAISIE (AgentSaisie/views/Overview.tsx) : nouvelle grille de 4 KPI
 *   (stats:getAgentStats, filtre created_by/created_at) + nouvelle liste paginée "Travail du
 *   jour" (stats:getAgentCardsTodayPaginated) qui remplace l'ancienne "Activité Récente" non
 *   paginée. HistoriqueView.tsx (stats:getAgentRecentSaisies) doit rester identique.
 *
 *   Durcissement sécurité rétroactif (P0) sur 6 handlers au total :
 *   stats:getVerificationCardsTodayPaginated, stats:getAgentToday, stats:getAgentRecentSaisies,
 *   stats:getAgentStats, stats:getAgentCardsTodayPaginated — tous cantonnent désormais
 *   l'agent/userId effectif à la session serveur réelle (getSecureCurrentUser()) pour tout rôle
 *   non-SUPER ADMIN, quels que soient les paramètres envoyés par le renderer.
 *
 * Une seule instance Electron isolée est partagée pour tout le fichier (méthodologie identique
 * à _agent13_apurement_overview.e2e.spec.ts). Toute donnée créée directement en base par ce
 * fichier (hors flux UI réel) porte le préfixe ZZTEST_ dans noms/prenoms/login, nettoyée en fin
 * de fichier avec revérification explicite (COUNT(*) = 0). Le userDataDir jetable est nettoyé
 * par teardownSeededApp.
 */
import { test, expect, type Page } from '@playwright/test';
import {
  launchSeededApp,
  teardownSeededApp,
  type E2EEnvironment
} from '../fixtures/electron-app';
import { getTestUser } from '../fixtures/test-users';
import { hashPassword } from '../../src/main/auth/local-auth';
import { join } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const SHOT_DIR =
  'C:\\Users\\EBYCHOCO\\AppData\\Local\\Temp\\claude\\d--Espace-travail-GEST-IN-SITU-CARTE-ABOBO-V2\\0ecf52dd-3c68-446e-99c9-2a28cf4e9dcc\\scratchpad';

test.describe.serial('QA Terrain — "Travail du jour" paginé sur /agent-verification et /agent-saisie (agent-13)', () => {
  let env: E2EEnvironment;
  let anyTestFailed = false;

  test.beforeAll(async () => {
    env = await launchSeededApp();
  });

  test.afterAll(async () => {
    if (env) {
      await teardownSeededApp(env, anyTestFailed);
    }
  });

  test.afterEach(async ({}, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus) {
      anyTestFailed = true;
    }
  });

  // ── Helpers génériques (repris de _agent13_apurement_overview.e2e.spec.ts) ──
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

  async function login(loginStr: string, password: string): Promise<void> {
    const { window } = env;
    await window.getByTestId('login-input').fill(loginStr);
    await window.getByTestId('password-input').fill(password);
    await window.getByTestId('login-submit').click();
  }

  async function logout(): Promise<void> {
    const { window } = env;
    await window.getByText('Déconnexion').click();
    await window.waitForURL(/#\/login/, { timeout: 15000 });
  }

  async function getKpiValue(window: Page, label: string): Promise<number | null> {
    const text = await window.evaluate((lbl) => {
      const divs = Array.from(document.querySelectorAll('div'));
      const labelDiv = divs.find((d) => d.textContent?.trim() === lbl && d.children.length === 0);
      if (!labelDiv || !labelDiv.parentElement) return null;
      const valueDiv = labelDiv.parentElement.children[0] as HTMLElement | undefined;
      return valueDiv ? valueDiv.textContent : null;
    }, label);
    if (text === null || text === undefined) return null;
    const n = parseInt(text.trim(), 10);
    return Number.isNaN(n) ? null : n;
  }

  async function getTravailDuJourRows(window: Page): Promise<Array<{ identite: string }>> {
    return window.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('table tbody tr'));
      return rows.map((r) => ({ identite: r.querySelector('td')?.textContent?.trim() || '' }));
    });
  }

  const insertedCardIds: number[] = [];
  const bulkCardIdsVerif: number[] = [];
  const bulkCardIdsSaisie: number[] = [];
  let secondSaisieUserId = 0;
  let secondSaisieLogin = 'ZZTEST_SAISIE_B';

  // ═══════════════════════════════════════════════════════════════════════
  // BLOC 0 — Non-régression rapide du portail OPERATEUR_APUREMENT (déjà validé
  // lors d'un run précédent) : simple vérification qu'il charge toujours sans gel.
  // ═══════════════════════════════════════════════════════════════════════
  test('0. Non-régression rapide — OPERATEUR_APUREMENT charge toujours sans gel', async () => {
    const { window } = env;
    const user = getTestUser('operateurApurement');

    await window.waitForURL(/#\/login/, { timeout: 20000 });
    await login(user.login, user.password);
    await window.waitForURL(/#\/apurement/, { timeout: 20000 });
    await expect(window.getByText("PORTAIL D'APUREMENT")).toBeVisible({ timeout: 10000 });
    await expect(window.getByText('Travail du jour')).toBeVisible({ timeout: 15000 });
    console.log('[agent13][NONREG-APUREMENT] Portail Apurement toujours fonctionnel, pas de gel.');
    await logout();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // BLOC A — OPERATEUR_VERIFICATION (Tâche A)
  // ═══════════════════════════════════════════════════════════════════════
  test('A1. Connexion OPERATEUR_VERIFICATION — 4 KPI inchangés (0 sur base fraîche), "Travail du jour" vide, pas de gel', async () => {
    const { window } = env;
    const user = getTestUser('operateurVerification');

    await login(user.login, user.password);
    await window.waitForURL(/#\/agent-verification$/, { timeout: 20000 });
    await expect(window.getByText('PORTAIL DE VÉRIFICATION')).toBeVisible({ timeout: 10000 });

    const overlay = window.locator('.dashboard-premium.animate-fade-in');
    const overlayGoneInTime = await overlay
      .waitFor({ state: 'detached', timeout: 12000 })
      .then(() => true)
      .catch(() => false);
    console.log(`[agent13][VERIF-A1] Overlay "Chargement sécurisé" levé en < 12s : ${overlayGoneInTime}`);

    await expect(window.getByText('Travail du jour')).toBeVisible({ timeout: 15000 });
    for (const label of ["Aujourd'hui", 'Cette semaine', 'Ce mois', 'Cette année']) {
      const v = await getKpiValue(window, label);
      expect(v, `KPI "${label}" doit être 0 sur base fraîche`).toBe(0);
    }
    await expect(window.getByText('Aucune fiche délivrée aujourd\'hui pour le moment.')).toBeVisible({ timeout: 10000 });
    await window.screenshot({ path: join(SHOT_DIR, 'agent13-verifsaisie-A1-verif-overview-empty.png') });
  });

  test('A2. Bout-en-bout — délivrance d\'une fiche via l\'UI réelle : KPI "Aujourd\'hui" + "Travail du jour" à jour', async () => {
    const { window } = env;
    const now = Date.now();

    const insert = await dbQuery(
      `INSERT INTO t_cartes (noms, prenoms, date_de_naissance, lieu_de_naissance, num_secu, statut, site_id, centre_id, contact, rangement)
       VALUES (?, 'AGENT', '1990-01-15', 'ZZTEST_LIEU', 'ZZTEST-SECU-VERIF-001', 'EN STOCK', ?, ?, '+225 01 02 03 04 05', 'A1')`,
      [`ZZTEST_VERIFDU_${now}`, env.seed.siteId, env.seed.centreId]
    );
    const carteId = insert[0].lastInsertRowid as number;
    insertedCardIds.push(carteId);

    // stats:get (handlers.ts) mémoïse sa réponse 15s (STATS_CACHE_TTL_MS) par clé
    // `${siteId}_${centreId || 'all'}` : la carte insérée directement en base (hors flux
    // applicatif normal, donc sans notification de l'app) n'est pas vue par le cache déjà
    // rempli à 0 lors du login (A1). RechercheView.tsx (totalCards, qui pilote l'écran
    // bloquant "Base de données locale vide") appelle `stats.get(siteIdToUse)` SANS 2e
    // argument (centreId=undefined pour ce rôle, cf. useDashboardStats.ts) -> clé de cache
    // `${siteId}_all`. On force donc un refresh explicite sur EXACTEMENT cette même clé
    // (centreId omis, comme le fait le vrai bouton "Actualiser" pour ce rôle) pour que
    // RechercheView voie immédiatement la carte fraîchement insérée.
    await window.evaluate(async (siteId) => {
      // @ts-expect-error API preload non typée ici
      await window.api.stats.get(siteId, undefined, true);
    }, env.seed.siteId);

    await window.getByRole('link', { name: 'Recherche Active' }).click();
    await window.waitForURL(/#\/agent-verification\/recherche/, { timeout: 15000 });
    await expect(window.getByText('Base de données locale vide')).not.toBeVisible({ timeout: 10000 });
    const nomField = window.getByPlaceholder('Ex: KOFFI KOFFI KAN');
    await expect(nomField).toBeVisible({ timeout: 10000 });

    await nomField.fill(`ZZTEST_VERIFDU_${now} AGENT`);
    await expect(nomField).toHaveValue(`ZZTEST_VERIFDU_${now} AGENT`);
    await window.locator('input[placeholder="JJ/MM/AAAA"]').fill('15/01/1990');
    await window.getByRole('button', { name: /Rechercher la Carte/ }).click();

    await expect(window.getByText('Vérification Physique')).toBeVisible({ timeout: 10000 });
    await window.getByRole('button', { name: /Oui, j'ai la carte/ }).click();
    await expect(window.getByText('Validation du Retrait')).toBeVisible({ timeout: 10000 });
    await window.getByRole('button', { name: /Valider la délivrance/ }).click();
    await expect(window.getByText('Carte délivrée avec succès !')).toBeVisible({ timeout: 10000 });

    const verifUser = getTestUser('operateurVerification');
    const rowAfter = (await dbQuery(
      `SELECT statut, agent_distributeur, is_dirty, date_delivrance, site_id FROM t_cartes WHERE id_carte = ?`,
      [carteId]
    ))[0];
    console.log(`[agent13][VERIF-A2] Fiche ${carteId} après délivrance :`, JSON.stringify(rowAfter));
    expect(rowAfter.statut).toBe('DELIVRE');
    expect(rowAfter.agent_distributeur.toUpperCase()).toBe(verifUser.login.toUpperCase());
    expect(rowAfter.is_dirty).toBe(1);

    await window.getByRole('link', { name: "Vue d'ensemble" }).click();
    await window.waitForURL(/#\/agent-verification$/, { timeout: 15000 });
    await expect(window.getByText('Travail du jour')).toBeVisible({ timeout: 10000 });

    // useVerificationStats.loadStats() (fetch async déclenché au montage d'Overview) peut ne
    // pas encore avoir résolu au moment précis de ce remontage de route -> on attend la valeur
    // cible avec un polling borné plutôt qu'une lecture unique immédiate.
    await expect.poll(async () => await getKpiValue(window, "Aujourd'hui"), { timeout: 10000 }).toBe(1);
    const kpiToday = await getKpiValue(window, "Aujourd'hui");
    console.log(`[agent13][VERIF-A2] KPI "Aujourd'hui" après 1 fiche délivrée = ${kpiToday} (attendu 1)`);

    const rows = await getTravailDuJourRows(window);
    const found = rows.some((r) => r.identite.includes(`ZZTEST_VERIFDU_${now}`));
    await window.screenshot({ path: join(SHOT_DIR, 'agent13-verifsaisie-A2-verif-e2e-after.png') });
    expect(found, 'La fiche délivrée doit apparaître dans "Travail du jour" après rechargement de la vue').toBe(true);
  });

  test('A3. [SÉCURITÉ P0] Appel IPC direct forgé stats:getVerificationCardsTodayPaginated — agentUsername/siteId ignorés pour un rôle non-SUPER ADMIN', async () => {
    const { window } = env;
    const verifUser = getTestUser('operateurVerification');

    const todayStr = new Date().toISOString().split('T')[0];
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];
    const realCount = (await dbQuery(
      `SELECT COUNT(*) as c FROM t_cartes WHERE statut='DELIVRE' AND UPPER(agent_distributeur)=UPPER(?) AND site_id=? AND date_delivrance >= ? AND date_delivrance < ?`,
      [verifUser.login, env.seed.siteId, todayStr, tomorrowStr]
    ))[0].c;

    const forged = await window.evaluate(async () => {
      // @ts-expect-error API preload non typée ici
      return await window.api.stats.getVerificationCardsTodayPaginated('AGENT_INEXISTANT_FORGE', 999999999, 0, 20);
    });
    console.log(
      `[agent13][SECURITE-P0][VERIF] Appel forgé agentUsername='AGENT_INEXISTANT_FORGE' siteId=999999999 -> ` +
      `total=${forged.total} (vérité serveur pour le VRAI agent connecté = ${realCount})`
    );
    expect(forged.total, 'Le total doit refléter le VRAI agent/site de la session serveur, jamais le paramètre forgé').toBe(realCount);
    expect(forged.rows.length).toBeGreaterThanOrEqual(1);

    await window.screenshot({ path: join(SHOT_DIR, 'agent13-verifsaisie-A3-verif-security.png') });
  });

  test('A4. Pagination — 25 fiches DELIVRE supplémentaires aujourd\'hui pour cet agent : 20/page, aucun doublon', async () => {
    const { window } = env;
    const verifUser = getTestUser('operateurVerification');
    const now = Date.now();
    const todayStr = new Date().toISOString().split('T')[0];

    for (let i = 1; i <= 25; i++) {
      const insert = await dbQuery(
        `INSERT INTO t_cartes (noms, prenoms, date_de_naissance, lieu_de_naissance, num_secu, statut, site_id, agent_distributeur, date_delivrance, nom_retirant, num_retirant, relation_retirant, is_dirty)
         VALUES (?, 'ZZTEST_PRENOM', '1980-01-01', 'ZZTEST_LIEU', ?, 'DELIVRE', ?, ?, ?, 'ZZTEST RETIRANT', '0700000000', 'SOI-MEME', 1)`,
        [
          `ZZTEST_VBULK_${now}_${String(i).padStart(2, '0')}`,
          `ZZTEST-SECU-VBULK-${i}`,
          env.seed.siteId,
          verifUser.login,
          todayStr
        ]
      );
      bulkCardIdsVerif.push(insert[0].lastInsertRowid as number);
    }

    await window.getByRole('link', { name: 'Recherche Active' }).click();
    await window.getByRole('link', { name: "Vue d'ensemble" }).click();
    await window.waitForURL(/#\/agent-verification$/, { timeout: 15000 });
    await expect(window.getByText('Travail du jour')).toBeVisible({ timeout: 10000 });
    await window.waitForTimeout(500);

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const totalTodayReal = (await dbQuery(
      `SELECT COUNT(*) as c FROM t_cartes WHERE statut='DELIVRE' AND UPPER(agent_distributeur)=UPPER(?) AND site_id=? AND date_delivrance >= ? AND date_delivrance < ?`,
      [verifUser.login, env.seed.siteId, todayStr, tomorrow.toISOString().split('T')[0]]
    ))[0].c;
    console.log(`[agent13][VERIF-A4] Total réel "aujourd'hui" en base pour cet agent = ${totalTodayReal} (attendu 26 : test A2 + 25 du bulk)`);
    expect(totalTodayReal).toBe(26);

    const rowsPage1 = await getTravailDuJourRows(window);
    expect(rowsPage1.length).toBe(20);

    const prevBtn = window.getByRole('button', { name: /Précédent/ });
    const nextBtn = window.getByRole('button', { name: /Suivant/ });
    await expect(prevBtn).toBeDisabled();
    await expect(nextBtn).toBeEnabled();
    await window.screenshot({ path: join(SHOT_DIR, 'agent13-verifsaisie-A4-verif-pagination-page1.png') });

    await nextBtn.click();
    await window.waitForTimeout(500);
    const rowsPage2 = await getTravailDuJourRows(window);
    expect(rowsPage2.length).toBe(totalTodayReal - 20);
    const overlap = rowsPage1.filter((r1) => rowsPage2.some((r2) => r2.identite === r1.identite));
    expect(overlap.length, 'Aucune ligne ne doit apparaître sur les deux pages').toBe(0);
    await expect(prevBtn).toBeEnabled();
    await expect(nextBtn).toBeDisabled();
    await window.screenshot({ path: join(SHOT_DIR, 'agent13-verifsaisie-A4-verif-pagination-page2.png') });

    await logout();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // BLOC B — OPERATEUR_SAISIE (Tâche B)
  // ═══════════════════════════════════════════════════════════════════════
  let opSaisieUserId = 0;

  test('B1. Connexion OPERATEUR_SAISIE — 4 KPI (0 sur base fraîche), "Travail du jour" vide, pas de gel', async () => {
    const { window } = env;
    const user = getTestUser('operateurSaisie');

    await window.waitForURL(/#\/login/, { timeout: 20000 });
    await login(user.login, user.password);
    await window.waitForURL(/#\/agent-saisie$/, { timeout: 20000 });
    await expect(window.getByText('PORTAIL DE SAISIE')).toBeVisible({ timeout: 10000 });

    const userRow = (await dbQuery('SELECT id_user FROM t_users WHERE login = ?', [user.login]))[0];
    opSaisieUserId = userRow.id_user;

    const overlay = window.locator('.dashboard-premium.animate-fade-in');
    const overlayGoneInTime = await overlay
      .waitFor({ state: 'detached', timeout: 12000 })
      .then(() => true)
      .catch(() => false);
    console.log(`[agent13][SAISIE-B1] Overlay "Chargement sécurisé" levé en < 12s (non-régression AgentSaisieLayout/useDashboardStats) : ${overlayGoneInTime}`);

    await expect(window.getByText('Travail du jour')).toBeVisible({ timeout: 15000 });
    for (const label of ["Aujourd'hui", 'Cette semaine', 'Ce mois', 'Cette année']) {
      const v = await getKpiValue(window, label);
      expect(v, `KPI "${label}" doit être 0 sur base fraîche`).toBe(0);
    }
    await expect(window.getByText('Aucune saisie enregistrée aujourd\'hui pour le moment.')).toBeVisible({ timeout: 10000 });
    await window.screenshot({ path: join(SHOT_DIR, 'agent13-verifsaisie-B1-saisie-overview-empty.png') });
  });

  test('B2. Bout-en-bout — nouvelle saisie via l\'UI réelle : KPI "Aujourd\'hui" + "Travail du jour" à jour', async () => {
    const { window } = env;
    const now = Date.now();

    await window.getByRole('link', { name: 'Nouvelle Saisie' }).click();
    await window.waitForURL(/#\/agent-saisie\/nouvelle/, { timeout: 15000 });

    await window.getByPlaceholder('Ex: KOUASSI').fill(`ZZTEST_SAISIEDU_${now}`);
    await window.getByPlaceholder('Ex: JEAN BAPTISTE').fill('AGENT');
    await window.locator('input[placeholder="JJ/MM/AAAA"]').fill('15062000');
    await window.getByPlaceholder('Ex: ABIDJAN').fill('ABOBO');
    await window.getByPlaceholder('Ex: 3841236548952').fill('1234500009991');
    await window.getByRole('button', { name: 'Valider la saisie' }).click();
    await expect(window.getByText('✅ Carte enregistrée avec succès !').first()).toBeVisible({ timeout: 10000 });

    const rowAfter = (await dbQuery(
      `SELECT is_dirty, created_by, statut FROM t_cartes WHERE noms = ?`,
      [`ZZTEST_SAISIEDU_${now}`]
    ))[0];
    console.log(`[agent13][SAISIE-B2] Carte créée en base :`, JSON.stringify(rowAfter));
    expect(rowAfter.created_by).toBe(opSaisieUserId);
    expect(rowAfter.is_dirty).toBe(1);
    expect(rowAfter.statut).toBe('EN STOCK');

    await window.getByRole('link', { name: "Vue d'ensemble" }).click();
    await window.waitForURL(/#\/agent-saisie$/, { timeout: 15000 });
    await expect(window.getByText('Travail du jour')).toBeVisible({ timeout: 10000 });

    await expect.poll(async () => await getKpiValue(window, "Aujourd'hui"), { timeout: 10000 }).toBe(1);
    const kpiToday = await getKpiValue(window, "Aujourd'hui");
    console.log(`[agent13][SAISIE-B2] KPI "Aujourd'hui" après 1 saisie = ${kpiToday} (attendu 1)`);

    const rows = await getTravailDuJourRows(window);
    const found = rows.some((r) => r.identite.includes(`ZZTEST_SAISIEDU_${now}`));
    await window.screenshot({ path: join(SHOT_DIR, 'agent13-verifsaisie-B2-saisie-e2e-after.png') });
    expect(found, 'La fiche saisie doit apparaître dans "Travail du jour" après rechargement de la vue').toBe(true);
  });

  test('B3. [NON-RÉGRESSION] "Historique des saisies" (HistoriqueView.tsx / stats:getAgentRecentSaisies) inchangé — toutes dates, paginé', async () => {
    const { window } = env;

    await window.getByRole('link', { name: 'Historique' }).click();
    await window.waitForURL(/#\/agent-saisie\/historique/, { timeout: 15000 });
    await expect(window.getByText('Chargement en cours...')).toHaveCount(0, { timeout: 15000 });

    const dbRows = await dbQuery(
      `SELECT COUNT(*) as c FROM t_cartes WHERE created_by = ?`,
      [opSaisieUserId]
    );
    console.log(`[agent13][SAISIE-B3] Historique — total réel en base pour cet agent (toutes dates) = ${dbRows[0].c} (attendu 1, seule la carte de B2 existe à ce stade)`);
    expect(dbRows[0].c).toBe(1);

    await expect(window.getByText('AGENT')).toBeVisible({ timeout: 10000 });
    // Pas de section "Travail du jour" ici : l'historique garde son propre en-tête/table inchangés.
    await expect(window.getByText('Historique de vos saisies')).toBeVisible();
    await window.screenshot({ path: join(SHOT_DIR, 'agent13-verifsaisie-B3-historique-nonreg.png') });
  });

  test('B4. [SÉCURITÉ P0] Second agent OPERATEUR_SAISIE (ZZTEST_) — création + saisie propre pour tester le forgeage', async () => {
    const { window } = env;
    secondSaisieLogin = `ZZTEST_SAISIE_B_${Date.now()}`;
    const hash = hashPassword('ZZTEST_Pwd_2026!');
    const userRes = await dbQuery(
      `INSERT INTO t_users (login, password_hash, role, nom_user, prenom_user, statut_actif, site_id, centre_id, sync_id, is_dirty)
       VALUES (?, ?, 'OPERATEUR_SAISIE', 'ZZTEST', 'AgentB', 1, ?, ?, ?, 0)`,
      [secondSaisieLogin, hash, env.seed.siteId, env.seed.centreId, `zztest-saisieb-${Date.now()}`]
    );
    secondSaisieUserId = userRes[0].lastInsertRowid as number;
    await dbQuery('INSERT INTO t_user_roles (id_user, role) VALUES (?, ?)', [secondSaisieUserId, 'OPERATEUR_SAISIE']);

    const now = Date.now();
    const cleDoublon = `ZZTEST_AGENTBCARD|X|1996-01-01|ABOBO|`;
    // created_at explicite au format ISO avec "T" (celui produit par `new Date().toISOString()`
    // dans le vrai flux applicatif de createCarte()) : le défaut SQLite `datetime('now')`
    // produit un format "YYYY-MM-DD HH:MM:SS" (espace, pas "T") qui, comparé lexicographiquement
    // à la borne "YYYY-MM-DDT00:00:00.000Z" utilisée par getAgentStats/getAgentToday pour le
    // bucket "Aujourd'hui", est perçu comme ANTÉRIEUR à cette borne (l'espace ASCII 0x20 < 'T'
    // 0x54) alors qu'il s'agit bien du même jour — ce mismatch de format est reproductible
    // uniquement via une écriture SQL directe hors du flux applicatif réel (jamais rencontré en
    // production, où created_at est toujours écrit via new Date().toISOString()) ; on aligne
    // donc ce created_at synthétique sur le format réel pour ne pas fausser ce scénario.
    const nowIso = new Date().toISOString();
    await dbQuery(
      `INSERT INTO t_cartes (noms, prenoms, date_de_naissance, lieu_de_naissance, num_secu, statut, site_id, centre_id, created_by, cle_doublon, sync_id, is_dirty, created_at)
       VALUES ('ZZTEST_AGENTBCARD', 'X', '1996-01-01', 'ABOBO', ?, 'EN STOCK', ?, ?, ?, ?, ?, 1, ?)`,
      [`ZZTEST-SECU-AGENTB-${now}`, env.seed.siteId, env.seed.centreId, secondSaisieUserId, cleDoublon, `zztest-agentbcard-${now}`, nowIso]
    );

    console.log(`[agent13][SAISIE-B4] Second agent créé login=${secondSaisieLogin}, id_user=${secondSaisieUserId}, avec 1 carte propre.`);
    expect(secondSaisieUserId).toBeGreaterThan(0);

    // Toujours connecté en tant que premier agent (opSaisieUserId) à ce stade -> forge les 4
    // handlers avec l'id_user RÉEL du second agent, depuis la session RÉELLE du premier.
    const realToday = (await dbQuery(
      `SELECT COUNT(*) as c FROM t_cartes WHERE created_by = ? AND created_at >= ?`,
      [opSaisieUserId, new Date().toISOString().split('T')[0] + 'T00:00:00.000Z']
    ))[0].c;
    const realRecents = (await dbQuery(
      `SELECT COUNT(*) as c FROM t_cartes WHERE created_by = ?`,
      [opSaisieUserId]
    ))[0].c;

    const forgedToday = await window.evaluate(async (id) => {
      // @ts-expect-error API preload non typée ici
      return await window.api.stats.getAgentToday(id);
    }, secondSaisieUserId);
    const forgedRecents = await window.evaluate(async (id) => {
      // @ts-expect-error idem
      return await window.api.stats.getAgentRecentSaisies(id, 25, 0);
    }, secondSaisieUserId);
    const forgedStats = await window.evaluate(async (id) => {
      // @ts-expect-error idem
      return await window.api.stats.getAgentStats(id);
    }, secondSaisieUserId);
    const forgedPaginated = await window.evaluate(async (id) => {
      // @ts-expect-error idem
      return await window.api.stats.getAgentCardsTodayPaginated(id, 0, 20);
    }, secondSaisieUserId);

    console.log(
      `[agent13][SECURITE-P0][SAISIE] Depuis la session RÉELLE du 1er agent, appels forgés avec userId=${secondSaisieUserId} (2e agent) -> ` +
      `getAgentToday=${forgedToday} (vérité 1er agent=${realToday}), getAgentRecentSaisies.total=${forgedRecents.total} (vérité=${realRecents}), ` +
      `getAgentStats.today=${forgedStats.today}, getAgentCardsTodayPaginated.total=${forgedPaginated.total}`
    );
    expect(forgedToday, 'stats:getAgentToday forgé doit refléter le VRAI agent connecté, pas le paramètre').toBe(realToday);
    expect(forgedRecents.total, 'stats:getAgentRecentSaisies forgé doit refléter le VRAI agent connecté').toBe(realRecents);
    expect(forgedRecents.rows.every((r: any) => !r.noms?.startsWith('ZZTEST_AGENTBCARD'))).toBe(true);
    expect(forgedStats.today, 'stats:getAgentStats forgé doit refléter le VRAI agent connecté').toBe(realToday);
    expect(forgedPaginated.total, 'stats:getAgentCardsTodayPaginated forgé doit refléter le VRAI agent connecté').toBe(realToday);
    expect(forgedPaginated.rows.every((r: any) => !r.noms?.startsWith('ZZTEST_AGENTBCARD'))).toBe(true);

    await window.screenshot({ path: join(SHOT_DIR, 'agent13-verifsaisie-B4-saisie-security.png') });
  });

  test('B5. [ISOLATION] Le second agent voit exclusivement son propre travail (UI réelle)', async () => {
    const { window } = env;
    await logout();
    await login(secondSaisieLogin, 'ZZTEST_Pwd_2026!');
    await window.waitForURL(/#\/agent-saisie$/, { timeout: 20000 });
    await expect(window.getByText('Travail du jour')).toBeVisible({ timeout: 10000 });

    // Ce second agent possède exactement 1 carte propre (créée en base au test B4) : les 4
    // KPI doivent refléter CETTE seule carte, jamais les 26 du premier agent (isolation).
    await expect.poll(async () => await getKpiValue(window, "Aujourd'hui"), { timeout: 10000 }).toBe(1);
    for (const label of ["Aujourd'hui", 'Cette semaine', 'Ce mois', 'Cette année']) {
      const v = await getKpiValue(window, label);
      expect(v, `Second agent — KPI "${label}" doit valoir 1 (sa seule carte propre), jamais les 26 du premier agent`).toBe(1);
    }
    const rows = await getTravailDuJourRows(window);
    expect(rows.length).toBe(1);
    expect(rows[0].identite).toContain('ZZTEST_AGENTBCARD');
    console.log('[agent13][SAISIE-B5] Second agent voit exactement sa propre carte (1) partout — pas de fuite des 26 fiches du premier agent.');

    await logout();
    const opSaisie = getTestUser('operateurSaisie');
    await login(opSaisie.login, opSaisie.password);
    await window.waitForURL(/#\/agent-saisie$/, { timeout: 20000 });
  });

  test('B6. Pagination — 25 saisies supplémentaires aujourd\'hui pour le 1er agent : 20/page, aucun doublon', async () => {
    const { window } = env;
    const now = Date.now();
    const todayIso = new Date().toISOString().split('T')[0] + 'T00:00:00.000Z';

    // created_at explicite au format ISO "T" (voir commentaire détaillé au test B4) : le
    // défaut SQLite `datetime('now')` (espace, pas "T") est perçu comme antérieur à la borne
    // "Aujourd'hui" par comparaison lexicographique, malgré le même jour calendaire.
    for (let i = 1; i <= 25; i++) {
      const insert = await dbQuery(
        `INSERT INTO t_cartes (noms, prenoms, date_de_naissance, lieu_de_naissance, num_secu, statut, site_id, centre_id, created_by, cle_doublon, sync_id, is_dirty, created_at)
         VALUES (?, 'ZZTEST_PRENOM', '1980-01-01', 'ZZTEST_LIEU', ?, 'EN STOCK', ?, ?, ?, ?, ?, 1, ?)`,
        [
          `ZZTEST_SBULK_${now}_${String(i).padStart(2, '0')}`,
          `ZZTEST-SECU-SBULK-${i}`,
          env.seed.siteId,
          env.seed.centreId,
          opSaisieUserId,
          `ZZTEST_SBULK_${now}_${i}|X|1980-01-01|ZZTEST_LIEU|`,
          `zztest-sbulk-${now}-${i}`,
          new Date().toISOString()
        ]
      );
      bulkCardIdsSaisie.push(insert[0].lastInsertRowid as number);
    }

    // B5 se termine déjà sur /agent-saisie (Overview) : un simple clic sur "Vue d'ensemble"
    // (même route, pas de navigation réelle) ne remonte pas le composant et ne redéclenche
    // donc pas loadCardsToday(). On force un rechargement réel via le bouton "Actualiser"
    // (même mécanisme que handleRefreshClick, Overview.tsx), scénario par ailleurs réaliste
    // (l'agent clique Actualiser après une salve de saisies).
    await expect(window.getByText('Travail du jour')).toBeVisible({ timeout: 10000 });
    await window.getByRole('button', { name: /Actualiser/ }).click();
    await window.waitForTimeout(800);

    const totalTodayReal = (await dbQuery(
      `SELECT COUNT(*) as c FROM t_cartes WHERE created_by = ? AND created_at >= ?`,
      [opSaisieUserId, todayIso]
    ))[0].c;
    console.log(`[agent13][SAISIE-B6] Total réel "aujourd'hui" en base pour cet agent = ${totalTodayReal} (attendu 26 : B2 + 25 du bulk)`);
    expect(totalTodayReal).toBe(26);

    const rowsPage1 = await getTravailDuJourRows(window);
    expect(rowsPage1.length).toBe(20);

    const prevBtn = window.getByRole('button', { name: /Précédent/ });
    const nextBtn = window.getByRole('button', { name: /Suivant/ });
    await expect(prevBtn).toBeDisabled();
    await expect(nextBtn).toBeEnabled();
    await window.screenshot({ path: join(SHOT_DIR, 'agent13-verifsaisie-B6-saisie-pagination-page1.png') });

    await nextBtn.click();
    await window.waitForTimeout(500);
    const rowsPage2 = await getTravailDuJourRows(window);
    expect(rowsPage2.length).toBe(totalTodayReal - 20);
    const overlap = rowsPage1.filter((r1) => rowsPage2.some((r2) => r2.identite === r1.identite));
    expect(overlap.length, 'Aucune ligne ne doit apparaître sur les deux pages').toBe(0);
    await expect(prevBtn).toBeEnabled();
    await expect(nextBtn).toBeDisabled();
    await window.screenshot({ path: join(SHOT_DIR, 'agent13-verifsaisie-B6-saisie-pagination-page2.png') });
  });

  test('B7. [NON-RÉGRESSION SUPER ADMIN] liberté de consultation conservée sur les 2 nouveaux endpoints', async () => {
    const { window } = env;
    await logout();
    const superAdmin = getTestUser('superAdmin');
    await login(superAdmin.login, superAdmin.password);
    await window.waitForURL(/#\/dashboard/, { timeout: 20000 });

    const asSuperAdmin = await window.evaluate(async (id) => {
      // @ts-expect-error API preload non typée ici
      return await window.api.stats.getAgentCardsTodayPaginated(id, 0, 20);
    }, opSaisieUserId);
    console.log(`[agent13][SUPER-ADMIN-OVERSIGHT] SUPER ADMIN consultant explicitement userId=${opSaisieUserId} -> total=${asSuperAdmin.total} (attendu 26, ce rôle garde la liberté de consultation)`);
    expect(asSuperAdmin.total).toBe(26);

    const verifUser = getTestUser('operateurVerification');
    const asSuperAdminVerif = await window.evaluate(
      async ({ login, siteId }) => {
        // @ts-expect-error idem
        return await window.api.stats.getVerificationCardsTodayPaginated(login, siteId, 0, 20);
      },
      { login: verifUser.login, siteId: env.seed.siteId }
    );
    console.log(`[agent13][SUPER-ADMIN-OVERSIGHT] SUPER ADMIN consultant explicitement agentUsername='${verifUser.login}' -> total=${asSuperAdminVerif.total} (attendu 26)`);
    expect(asSuperAdminVerif.total).toBe(26);

    await logout();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // BLOC 9 — Nettoyage exhaustif des données de test (§1 garde-fou).
  // ═══════════════════════════════════════════════════════════════════════
  test('9. Nettoyage — suppression de toutes les données ZZTEST_ créées (cartes, second agent)', async () => {
    for (const id of insertedCardIds) {
      await dbQuery(`DELETE FROM t_cartes WHERE id_carte = ?`, [id]);
    }
    for (const id of bulkCardIdsVerif) {
      await dbQuery(`DELETE FROM t_cartes WHERE id_carte = ?`, [id]);
    }
    for (const id of bulkCardIdsSaisie) {
      await dbQuery(`DELETE FROM t_cartes WHERE id_carte = ?`, [id]);
    }
    await dbQuery(`DELETE FROM t_cartes WHERE noms LIKE 'ZZTEST_%'`);

    const remainingCards = (await dbQuery(`SELECT COUNT(*) as c FROM t_cartes WHERE noms LIKE 'ZZTEST_%'`))[0].c;
    expect(remainingCards).toBe(0);

    if (secondSaisieUserId) {
      // t_logs.id_user référence t_users(id_user) SANS ON DELETE CASCADE : purge explicite
      // des logs d'audit générés par la connexion réelle du test B5 avant suppression de l'user.
      await dbQuery(`DELETE FROM t_logs WHERE id_user = ? OR login_user = ?`, [secondSaisieUserId, secondSaisieLogin]);
      await dbQuery(`DELETE FROM t_user_roles WHERE id_user = ?`, [secondSaisieUserId]);
      await dbQuery(`DELETE FROM t_users WHERE id_user = ?`, [secondSaisieUserId]);
    }

    const remainingUsers = (await dbQuery(`SELECT COUNT(*) as c FROM t_users WHERE login LIKE 'ZZTEST_%'`))[0].c;
    console.log(`[agent13][NETTOYAGE] Cartes ZZTEST_ restantes=${remainingCards}, users ZZTEST_ restants=${remainingUsers} (attendu 0 partout)`);
    expect(remainingUsers).toBe(0);
  });
});
