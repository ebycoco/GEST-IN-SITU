/**
 * e2e/specs/_agent13_apurement_overview.e2e.spec.ts
 *
 * QA Terrain (agent-13) — REVALIDATION en conditions réelles de 3 correctifs appliqués sur le
 * portail OPERATEUR_APUREMENT (onglet "Vue d'ensemble") après un premier passage QA :
 *
 *   Correctif 1 (P0 sécurité) — `stats:getVerification`/`stats:getCardsToday` dérivent
 *   désormais agentUsername/siteId de getSecureCurrentUser()/scopeSiteCentreToSession() pour
 *   tout rôle non-SUPER ADMIN (handlers.ts ~L1580).
 *
 *   Correctif 2 (P1 KPI) — nouvel endpoint dédié `stats:getApurementStats` +
 *   `getApurementCardsTodayPaginated` corrigée : les deux filtrent désormais sur `updated_at`
 *   (horodatage réel de l'action serveur) au lieu de `date_delivrance` (date saisie librement,
 *   souvent historique) pour les KPI/la liste "Travail du jour" du portail Apurement.
 *
 *   Correctif 3 (nouvelle modale) — InventaireApurement.tsx (composant PARTAGÉ entre
 *   ApurementLayout.tsx et l'onglet APUREMENT d'InventaireLayout.tsx) affiche désormais une
 *   modale de confirmation (GlobalConfirmModal/confirmService) quand l'agent sélectionne une
 *   carte déjà `DELIVRE`, avec "Continuer quand même" / "Annuler".
 *
 * Une seule instance Electron isolée est partagée pour tout le fichier (même méthodologie
 * que _agent13_sync_status_dashboard.e2e.spec.ts). Le seed standard (1 site + 1 centre +
 * TEST_USERS, dont E2E_OPERATEUR_APUREMENT et E2E_OPERATEUR_INVENTAIRE, tous deux rattachés au
 * même site/centre de test) est utilisé tel quel ; un second site + un second agent APUREMENT
 * (préfixe ZZTEST_, hashés avec bcryptjs via hashPassword — même mécanisme que test-users.ts)
 * sont créés directement en base par ce fichier pour le scénario d'isolation multi-site.
 *
 * Toute carte insérée directement en base par ce fichier (hors flux UI réel) porte le préfixe
 * ZZTEST_ dans `noms`, et est supprimée en fin de fichier avec revérification explicite
 * (COUNT(*) = 0). Le userDataDir jetable est nettoyé par teardownSeededApp.
 */
import { test, expect, type Page } from '@playwright/test';
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

test.describe.serial("QA Terrain — Portail d'Apurement / Vue d'ensemble (/apurement) — REVALIDATION 3 correctifs (agent-13)", () => {
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

  // ── Helpers génériques (repris de _agent13_sync_status_dashboard.e2e.spec.ts) ──
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

  // bcryptjs hash, exécuté dans le process Electron (mêmes deps que l'app) pour créer
  // le second agent APUREMENT (isolation multi-site) sans dépendre de better-sqlite3 côté
  // test-runner.
  async function bcryptHash(password: string): Promise<string> {
    const script = `
      const bcrypt = require('bcryptjs');
      process.stdout.write('__HASH__:' + bcrypt.hashSync(process.argv[1], 10));
    `;
    const electronPath = require('electron') as unknown as string;
    const { stdout } = await execFileAsync(
      electronPath,
      ['-e', script, password],
      { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf-8', cwd: join(__dirname, '../..') }
    );
    const line = stdout.split(/\r?\n/).find((l) => l.startsWith('__HASH__:'));
    if (!line) throw new Error(`[bcryptHash] Pas de hash produit.\n${stdout}`);
    return line.slice('__HASH__:'.length);
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

  const TEST_PASSWORD = 'ZZTEST_Pwd_2026!';
  let otherSiteId = 0;
  let otherCentreId = 0;
  let otherUserId = 0;
  let otherAgentLogin = 'ZZTEST_APUREMENT_S2';
  const insertedCardIds: number[] = [];
  const bulkCardIds: number[] = [];
  let modalCardIdApurement = 0;
  let modalCardIdInventaire = 0;

  // ═══════════════════════════════════════════════════════════════════════
  // BLOC 1 — Non-régression du portail : onglet par défaut, bascule d'onglets,
  // absence de gel derrière "Chargement sécurisé en cours...".
  // ═══════════════════════════════════════════════════════════════════════
  test('1. Connexion OPERATEUR_APUREMENT — onglet "Vue d\'ensemble" actif par défaut, pas de gel', async () => {
    const { window } = env;
    const user = getTestUser('operateurApurement');

    await window.waitForURL(/#\/login/, { timeout: 20000 });
    await login(user.login, user.password);
    await window.waitForURL(/#\/apurement/, { timeout: 20000 });

    await expect(window.getByText("PORTAIL D'APUREMENT")).toBeVisible({ timeout: 10000 });
    await expect(window.getByText("VUE D'ENSEMBLE")).toBeVisible();
    await expect(window.getByText("Travail du jour")).toBeVisible({ timeout: 15000 });

    const overlay = window.locator('.dashboard-premium.animate-fade-in');
    const overlayGoneInTime = await overlay
      .waitFor({ state: 'detached', timeout: 8000 })
      .then(() => true)
      .catch(() => false);
    console.log(`[agent13][APUREMENT-OVERVIEW] Overlay "Chargement sécurisé" levé en < 8s : ${overlayGoneInTime}`);

    await window.screenshot({ path: join(SHOT_DIR, 'agent13-apurement-01-overview-default.png') });
    for (const label of ["Aujourd'hui", 'Cette semaine', 'Ce mois', 'Cette année']) {
      const v = await getKpiValue(window, label);
      expect(v, `KPI "${label}" devrait être un nombre (0 attendu sur base fraîche)`).not.toBeNull();
    }
  });

  test('2. Bascule "Travail d\'apurement" <-> "Vue d\'ensemble" — pas de perte d\'état gênante', async () => {
    const { window } = env;

    await window.getByText("TRAVAIL D'APUREMENT").click();
    await expect(window.getByText('APUREMENT DES CAHIERS HISTORIQUES')).toBeVisible({ timeout: 10000 });
    await expect(window.getByPlaceholder('Saisir nom & prénoms...')).toBeVisible();

    await window.getByText("VUE D'ENSEMBLE").click();
    await expect(window.getByText('Travail du jour')).toBeVisible({ timeout: 10000 });

    await window.getByText("TRAVAIL D'APUREMENT").click();
    await expect(window.getByPlaceholder('Saisir nom & prénoms...')).toBeVisible({ timeout: 10000 });

    await window.screenshot({ path: join(SHOT_DIR, 'agent13-apurement-02-tab-switch.png') });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // BLOC 2 — Scénario bout-en-bout : traiter une fiche via l'UI réelle, puis
  // vérifier le KPI "Aujourd'hui" et la liste "Travail du jour".
  // ═══════════════════════════════════════════════════════════════════════
  test('3. Bout-en-bout — apurement d\'une fiche EN STOCK via l\'UI (pas de modale, correctif 3 non-régression), KPI + liste "Travail du jour" à jour', async () => {
    const { window } = env;
    const now = Date.now();

    const insert = await dbQuery(
      `INSERT INTO t_cartes (noms, prenoms, date_de_naissance, lieu_de_naissance, num_secu, statut, site_id)
       VALUES (?, ?, '1985-03-12', 'ZZTEST_LIEU', 'ZZTEST-SECU-001', 'EN STOCK', ?)`,
      [`ZZTEST_NOM_${now}`, 'ZZTEST_PRENOM', env.seed.siteId]
    );
    const carteId = insert[0].lastInsertRowid as number;
    insertedCardIds.push(carteId);

    await expect(window.getByPlaceholder('Saisir nom & prénoms...')).toBeVisible({ timeout: 10000 });
    await window.getByPlaceholder('Saisir nom & prénoms...').fill(`ZZTEST_NOM_${now}`);
    await window.getByRole('button', { name: /Rechercher/ }).click();

    await expect(window.getByText(`ZZTEST_NOM_${now} ZZTEST_PRENOM`)).toBeVisible({ timeout: 10000 });
    await window.getByText(`ZZTEST_NOM_${now} ZZTEST_PRENOM`).click();

    // CORRECTIF 3 — non-régression : carte EN STOCK (jamais déchargée) → aucune modale
    // "Carte déjà déchargée" ne doit apparaître, accès direct au formulaire.
    await expect(window.getByText('Carte déjà déchargée')).not.toBeVisible();
    await expect(window.getByText('Dossier Sélectionné')).toBeVisible({ timeout: 10000 });
    await window.locator('input[placeholder="Ex: 0707..."]').fill('0700000001');

    await window.getByRole('button', { name: /Valider l'Apurement/ }).click();
    await expect(window.getByText('Décharge historique enregistrée avec succès.').last()).toBeVisible({ timeout: 10000 });

    const rowAfter = (await dbQuery(
      `SELECT statut, agent_distributeur, is_dirty, date_delivrance, nom_retirant, num_retirant, site_id, updated_at FROM t_cartes WHERE id_carte = ?`,
      [carteId]
    ))[0];
    const apurementUser = getTestUser('operateurApurement');
    console.log(`[agent13][APUREMENT-E2E] Fiche ${carteId} après validation :`, JSON.stringify(rowAfter));
    expect(rowAfter.statut).toBe('DELIVRE');
    expect(rowAfter.agent_distributeur.toUpperCase()).toBe(apurementUser.login.toUpperCase());
    expect(rowAfter.is_dirty).toBe(1);
    expect(rowAfter.nom_retirant).toBe(`ZZTEST_NOM_${now} ZZTEST_PRENOM`);
    expect(rowAfter.num_retirant).toBe('0700000001');

    const todayStr = new Date().toISOString().split('T')[0];
    expect(
      rowAfter.date_delivrance,
      'date_delivrance par défaut du formulaire (non modifiée) doit être la date du jour'
    ).toBe(todayStr);
    expect(rowAfter.updated_at.slice(0, 10), 'updated_at doit aussi être horodaté à aujourd\'hui').toBe(todayStr);

    await window.getByText("VUE D'ENSEMBLE").click();
    await expect(window.getByText('Travail du jour')).toBeVisible({ timeout: 10000 });

    const kpiToday = await getKpiValue(window, "Aujourd'hui");
    console.log(`[agent13][APUREMENT-E2E] KPI "Aujourd'hui" après 1 fiche apurée = ${kpiToday} (attendu >= 1)`);
    expect(kpiToday).toBeGreaterThanOrEqual(1);

    const rows = await getTravailDuJourRows(window);
    const found = rows.some((r) => r.identite.includes(`ZZTEST_NOM_${now}`));
    await window.screenshot({ path: join(SHOT_DIR, 'agent13-apurement-03-e2e-after.png') });
    expect(found, 'La fiche apurée doit apparaître dans "Travail du jour" sans action manuelle').toBe(true);
  });

  test('4. [CORRECTIF P1 REVALIDÉ] Apurement avec une date de retrait HISTORIQUE (passée) — apparaît désormais dans le KPI/liste "Aujourd\'hui" (filtrage sur updated_at)', async () => {
    const { window } = env;
    const now = Date.now();

    const insert = await dbQuery(
      `INSERT INTO t_cartes (noms, prenoms, date_de_naissance, lieu_de_naissance, num_secu, statut, site_id)
       VALUES (?, ?, '1990-06-01', 'ZZTEST_LIEU', 'ZZTEST-SECU-002', 'EN STOCK', ?)`,
      [`ZZTEST_HISTO_${now}`, 'ZZTEST_PRENOM', env.seed.siteId]
    );
    const carteId = insert[0].lastInsertRowid as number;
    insertedCardIds.push(carteId);

    await expect(window.getByText('Travail du jour')).toBeVisible({ timeout: 10000 });
    const kpiBefore = await getKpiValue(window, "Aujourd'hui");

    await window.getByText("TRAVAIL D'APUREMENT").click();
    await expect(window.getByPlaceholder('Saisir nom & prénoms...')).toBeVisible({ timeout: 10000 });
    await window.getByPlaceholder('Saisir nom & prénoms...').fill(`ZZTEST_HISTO_${now}`);
    await window.getByRole('button', { name: /Rechercher/ }).click();
    await expect(window.getByText(`ZZTEST_HISTO_${now} ZZTEST_PRENOM`)).toBeVisible({ timeout: 10000 });
    await window.getByText(`ZZTEST_HISTO_${now} ZZTEST_PRENOM`).click();

    // Renseigne explicitement une date de retrait passée (ex: cahier retrouvé de
    // 3 mois — cas d'usage réel de "l'émargement rétroactif de cahiers historiques").
    const pastDate = new Date();
    pastDate.setMonth(pastDate.getMonth() - 3);
    const pastDateStr = pastDate.toISOString().split('T')[0];
    await window.locator('input[type="date"]').fill(pastDateStr);
    await window.locator('input[placeholder="Ex: 0707..."]').fill('0700000002');

    await window.getByRole('button', { name: /Valider l'Apurement/ }).click();
    await expect(window.getByText('Décharge historique enregistrée avec succès.').last()).toBeVisible({ timeout: 10000 });

    const rowAfter = (await dbQuery(`SELECT date_delivrance, updated_at FROM t_cartes WHERE id_carte = ?`, [carteId]))[0];
    const todayStr = new Date().toISOString().split('T')[0];
    expect(rowAfter.date_delivrance, 'date_delivrance doit rester la date historique SAISIE par l\'agent (comportement métier inchangé)').toBe(pastDateStr);
    expect(rowAfter.updated_at.slice(0, 10), 'updated_at doit être horodaté à AUJOURD\'HUI (action serveur réelle), indépendamment de date_delivrance').toBe(todayStr);

    await window.getByText("VUE D'ENSEMBLE").click();
    await expect(window.getByText('Travail du jour')).toBeVisible({ timeout: 10000 });
    const kpiAfter = await getKpiValue(window, "Aujourd'hui");
    const rows = await getTravailDuJourRows(window);
    const foundInTodayList = rows.some((r) => r.identite.includes(`ZZTEST_HISTO_${now}`));

    await window.screenshot({ path: join(SHOT_DIR, 'agent13-apurement-04-historic-date-now-in-today.png') });

    console.log(
      `[agent13][CORRECTIF-P1-REVALIDE] Fiche apurée AUJOURD'HUI avec date_delivrance=${pastDateStr} (historique) : ` +
      `KPI avant=${kpiBefore}, après=${kpiAfter} (attendu +1), présente dans "Travail du jour"=${foundInTodayList} (attendu true — ` +
      `AVANT le correctif, ce même scénario donnait "false" : c'est exactement le cas qui échouait avant.)`
    );
    expect(kpiAfter, 'Le KPI "Aujourd\'hui" doit désormais compter cette fiche malgré sa date de retrait passée').toBe((kpiBefore ?? 0) + 1);
    expect(foundInTodayList, 'Le correctif P1 doit faire apparaître la fiche malgré la date passée saisie (filtrage sur updated_at)').toBe(true);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // BLOC 3 — CORRECTIF 3 : modale "carte déjà déchargée" sur /apurement
  // (onglet "Travail d'apurement" d'ApurementLayout.tsx → InventaireApurement.tsx partagé).
  // ═══════════════════════════════════════════════════════════════════════
  test('5. [CORRECTIF 3] /apurement — sélection d\'une carte DÉJÀ déchargée → modale avec bonnes infos → "Annuler" ne modifie rien en base', async () => {
    const { window } = env;
    const now = Date.now();
    const apurementUser = getTestUser('operateurApurement');

    // Carte créée DÉJÀ DELIVRE (simule une fiche déjà traitée précédemment par l'agent).
    const firstDate = '2026-01-15';
    const insert = await dbQuery(
      `INSERT INTO t_cartes (noms, prenoms, date_de_naissance, lieu_de_naissance, num_secu, statut, site_id, agent_distributeur, date_delivrance, nom_retirant, num_retirant, relation_retirant, updated_at, is_dirty)
       VALUES (?, 'ZZTEST_PRENOM', '1975-04-20', 'ZZTEST_LIEU', 'ZZTEST-SECU-MODAL1', 'DELIVRE', ?, ?, ?, 'ZZTEST ANCIEN RETIRANT', '0700000010', 'SOI-MEME', ?, 1)`,
      [`ZZTEST_MODAL_${now}`, env.seed.siteId, apurementUser.login, firstDate, new Date().toISOString()]
    );
    modalCardIdApurement = insert[0].lastInsertRowid as number;
    insertedCardIds.push(modalCardIdApurement);

    await window.getByText("VUE D'ENSEMBLE").click();
    await expect(window.getByText('Travail du jour')).toBeVisible({ timeout: 10000 });
    await window.getByText("TRAVAIL D'APUREMENT").click();
    await expect(window.getByPlaceholder('Saisir nom & prénoms...')).toBeVisible({ timeout: 10000 });
    await window.getByPlaceholder('Saisir nom & prénoms...').fill(`ZZTEST_MODAL_${now}`);
    await window.getByRole('button', { name: /Rechercher/ }).click();
    await expect(window.getByText(`ZZTEST_MODAL_${now} ZZTEST_PRENOM`)).toBeVisible({ timeout: 10000 });

    await window.getByText(`ZZTEST_MODAL_${now} ZZTEST_PRENOM`).click();

    // Modale attendue, avec date/agent/nom du retirant déjà enregistrés.
    await expect(window.getByText('Carte déjà déchargée')).toBeVisible({ timeout: 10000 });
    const modalText = await window.evaluate(() => document.body.textContent || '');
    console.log(`[agent13][CORRECTIF-3][MODALE] Texte contient date="${firstDate}"=${modalText.includes(firstDate)}, agent="${apurementUser.login}"=${modalText.includes(apurementUser.login)}, retirant="ZZTEST ANCIEN RETIRANT"=${modalText.includes('ZZTEST ANCIEN RETIRANT')}`);
    expect(modalText).toContain(firstDate);
    expect(modalText).toContain(apurementUser.login);
    expect(modalText).toContain('ZZTEST ANCIEN RETIRANT');
    await window.screenshot({ path: join(SHOT_DIR, 'agent13-apurement-05-modal-deja-dechargee.png') });

    // Le formulaire d'émargement ne doit PAS être ouvert tant que la modale est affichée.
    await expect(window.getByText('Dossier Sélectionné')).not.toBeVisible();

    // "Annuler" → retour à la liste de résultats, RIEN ne doit changer en base.
    await window.getByRole('button', { name: 'Annuler' }).click();
    await expect(window.getByText('Carte déjà déchargée')).not.toBeVisible({ timeout: 5000 });
    await expect(window.getByText(`ZZTEST_MODAL_${now} ZZTEST_PRENOM`)).toBeVisible({ timeout: 5000 });

    const rowAfterCancel = (await dbQuery(
      `SELECT date_delivrance, agent_distributeur, nom_retirant, num_retirant FROM t_cartes WHERE id_carte = ?`,
      [modalCardIdApurement]
    ))[0];
    console.log(`[agent13][CORRECTIF-3][ANNULER] État en base après "Annuler" :`, JSON.stringify(rowAfterCancel));
    expect(rowAfterCancel.date_delivrance).toBe(firstDate);
    expect(rowAfterCancel.nom_retirant).toBe('ZZTEST ANCIEN RETIRANT');
    expect(rowAfterCancel.num_retirant).toBe('0700000010');
  });

  test('6. [CORRECTIF 3] /apurement — "Continuer quand même" ouvre le formulaire et écrase l\'ancien émargement (comportement volontaire, pas un bug)', async () => {
    const { window } = env;
    expect(modalCardIdApurement, 'Dépend de la carte créée au test 5').toBeGreaterThan(0);

    // On est reparti sur la liste de résultats (fin du test 5) : re-sélection de la même carte.
    const row = (await dbQuery(`SELECT noms, prenoms FROM t_cartes WHERE id_carte = ?`, [modalCardIdApurement]))[0];
    const fullName = `${row.noms} ${row.prenoms}`;
    await expect(window.getByText(fullName)).toBeVisible({ timeout: 10000 });
    await window.getByText(fullName).click();

    await expect(window.getByText('Carte déjà déchargée')).toBeVisible({ timeout: 10000 });
    await window.getByRole('button', { name: 'Continuer quand même' }).click();

    // Le formulaire s'ouvre normalement, pré-rempli par la nouvelle sélection (SOI-MEME par défaut).
    await expect(window.getByText('Dossier Sélectionné')).toBeVisible({ timeout: 10000 });

    const newDateStr = new Date().toISOString().split('T')[0];
    await window.locator('input[type="date"]').fill(newDateStr);
    await window.locator('input[placeholder="Ex: 0707..."]').fill('0799999999');
    await window.getByRole('button', { name: /Valider l'Apurement/ }).click();
    await expect(window.getByText('Décharge historique enregistrée avec succès.').last()).toBeVisible({ timeout: 10000 });

    const rowAfter = (await dbQuery(
      `SELECT date_delivrance, nom_retirant, num_retirant FROM t_cartes WHERE id_carte = ?`,
      [modalCardIdApurement]
    ))[0];
    console.log(`[agent13][CORRECTIF-3][CONTINUER] État en base après "Continuer quand même" + validation :`, JSON.stringify(rowAfter));
    expect(rowAfter.date_delivrance, 'La nouvelle validation doit écraser l\'ancienne date_delivrance (comportement volontaire documenté)').toBe(newDateStr);
    expect(rowAfter.num_retirant).toBe('0799999999');
    expect(rowAfter.nom_retirant, 'nom_retirant écrasé par le nouvel émargement (SOI-MEME par défaut)').toBe(fullName);

    await window.screenshot({ path: join(SHOT_DIR, 'agent13-apurement-06-modal-continuer-ecrase.png') });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // BLOC 4 — Sécurité P0 : forgeage direct de agentUsername/siteId via IPC
  // (stats:getApurementCardsTodayPaginated). Vérité serveur désormais basée sur updated_at
  // (correctif 2), cohérent avec l'endpoint testé.
  // ═══════════════════════════════════════════════════════════════════════
  test('7. [SÉCURITÉ P0] Appel IPC direct forgé — agentUsername/siteId ignorés côté serveur pour un rôle non-SUPER ADMIN', async () => {
    const { window } = env;
    const apurementUser = getTestUser('operateurApurement');

    const forgedAgent = await window.evaluate(async () => {
      // @ts-expect-error API exposée par preload, non typée ici pour l'évaluation brute
      return await window.api.stats.getApurementCardsTodayPaginated('AGENT_INEXISTANT_FORGE', 999999999, 0, 20);
    });
    console.log(`[agent13][SECURITE-P0] Appel forgé agentUsername='AGENT_INEXISTANT_FORGE' siteId=999999999 → total=${forgedAgent.total}, rows=${forgedAgent.rows.length}`);

    // Vérité serveur indépendante, basée sur updated_at (cohérent avec le correctif 2) :
    // combien de fiches DELIVRE "aujourd'hui" (updated_at) pour le VRAI agent connecté / site.
    const todayStr = new Date().toISOString().split('T')[0];
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];
    const realCount = (await dbQuery(
      `SELECT COUNT(*) as c FROM t_cartes WHERE statut='DELIVRE' AND UPPER(agent_distributeur)=UPPER(?) AND site_id=? AND updated_at >= ? AND updated_at < ?`,
      [apurementUser.login, env.seed.siteId, todayStr, tomorrowStr]
    ))[0].c;

    expect(forgedAgent.total, 'Le total doit correspondre aux VRAIES fiches de la session serveur, pas au paramètre forgé').toBe(realCount);
    expect(forgedAgent.rows.length).toBeGreaterThanOrEqual(1);
    for (const r of forgedAgent.rows) {
      expect(r.id_carte).toBeDefined();
    }

    const forgedSiteOnly = await window.evaluate(async () => {
      // @ts-expect-error idem
      return await window.api.stats.getApurementCardsTodayPaginated('', 1, 0, 20);
    });
    expect(forgedSiteOnly.total).toBe(realCount);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // BLOC 5 — Pagination (>20 fiches le même jour pour le même agent), ground-truth basé sur
  // updated_at (correctif 2).
  // ═══════════════════════════════════════════════════════════════════════
  test('8. Pagination — 25 fiches supplémentaires aujourd\'hui : 20 par page, contrôles cohérents', async () => {
    const { window } = env;
    const apurementUser = getTestUser('operateurApurement');
    const now = Date.now();
    const todayStr = new Date().toISOString().split('T')[0];

    for (let i = 1; i <= 25; i++) {
      const insert = await dbQuery(
        `INSERT INTO t_cartes (noms, prenoms, date_de_naissance, lieu_de_naissance, num_secu, statut, site_id, agent_distributeur, date_delivrance, nom_retirant, num_retirant, relation_retirant, is_dirty)
         VALUES (?, 'ZZTEST_PRENOM', '1980-01-01', 'ZZTEST_LIEU', ?, 'DELIVRE', ?, ?, ?, 'ZZTEST RETIRANT', '0700000000', 'SOI-MEME', 1)`,
        [
          `ZZTEST_BULK_${now}_${String(i).padStart(2, '0')}`,
          `ZZTEST-SECU-BULK-${i}`,
          env.seed.siteId,
          apurementUser.login,
          todayStr
        ]
      );
      bulkCardIds.push(insert[0].lastInsertRowid as number);
    }
    // Les 25 lignes ci-dessus n'écrivent pas explicitement `updated_at` → colonne par défaut
    // `datetime('now')` (schema.ts), donc aussi horodatées à AUJOURD'HUI : cohérent avec le
    // filtrage sur updated_at de l'endpoint corrigé.

    await window.getByText("VUE D'ENSEMBLE").click();
    await expect(window.getByText('Travail du jour')).toBeVisible({ timeout: 10000 });
    await window.getByText("TRAVAIL D'APUREMENT").click();
    await window.getByText("VUE D'ENSEMBLE").click();
    await expect(window.getByText('Travail du jour')).toBeVisible({ timeout: 10000 });
    await window.waitForTimeout(500);

    const todayTomorrow = new Date();
    todayTomorrow.setDate(todayTomorrow.getDate() + 1);
    const totalTodayReal = (await dbQuery(
      `SELECT COUNT(*) as c FROM t_cartes WHERE statut='DELIVRE' AND UPPER(agent_distributeur)=UPPER(?) AND site_id=? AND updated_at >= ? AND updated_at < ?`,
      [apurementUser.login, env.seed.siteId, todayStr, todayTomorrow.toISOString().split('T')[0]]
    ))[0].c;
    console.log(`[agent13][PAGINATION] Total réel "aujourd'hui" (updated_at) en base pour cet agent = ${totalTodayReal} (attendu 28 : test3 + test4-historique + test5/6-modale + 25 du bulk)`);

    const rowsPage1 = await getTravailDuJourRows(window);
    console.log(`[agent13][PAGINATION] Lignes affichées page 1 = ${rowsPage1.length} (attendu <= 20)`);
    expect(rowsPage1.length).toBeLessThanOrEqual(20);
    expect(rowsPage1.length).toBe(Math.min(20, totalTodayReal));

    const prevBtn = window.getByRole('button', { name: /Précédent/ });
    const nextBtn = window.getByRole('button', { name: /Suivant/ });
    await expect(prevBtn).toBeVisible();
    await expect(nextBtn).toBeVisible();
    await expect(prevBtn).toBeDisabled();
    await expect(nextBtn).toBeEnabled();

    await window.screenshot({ path: join(SHOT_DIR, 'agent13-apurement-08-pagination-page1.png') });

    await nextBtn.click();
    await window.waitForTimeout(500);
    const rowsPage2 = await getTravailDuJourRows(window);
    console.log(`[agent13][PAGINATION] Lignes affichées page 2 = ${rowsPage2.length} (attendu ${totalTodayReal - 20})`);
    expect(rowsPage2.length).toBeLessThanOrEqual(20);
    expect(rowsPage2.length).toBe(totalTodayReal - 20);

    const overlap = rowsPage1.filter((r1) => rowsPage2.some((r2) => r2.identite === r1.identite));
    expect(overlap.length, 'Aucune ligne ne doit apparaître sur les deux pages').toBe(0);

    await expect(prevBtn).toBeEnabled();

    await window.screenshot({ path: join(SHOT_DIR, 'agent13-apurement-08-pagination-page2.png') });

    await prevBtn.click();
    await window.waitForTimeout(500);
    const rowsBackToPage1 = await getTravailDuJourRows(window);
    expect(rowsBackToPage1.length).toBe(rowsPage1.length);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // BLOC 6 — Isolation multi-site/multi-agent (P0) : second site + second
  // agent APUREMENT créés en base, jamais visibles depuis la session du
  // premier agent (ni via l'UI, ni via un appel IPC forgé avec ses identifiants).
  // ═══════════════════════════════════════════════════════════════════════
  test('9. [ISOLATION P0] Préparation — second site + second agent APUREMENT (ZZTEST_)', async () => {
    const now = Date.now();
    const site = await dbQuery(
      `INSERT INTO t_sites (nom, code, is_active, max_centres, is_permanent, sync_id) VALUES (?, ?, 1, 4, 1, ?)`,
      [`ZZTEST Site 2`, `ZZTEST-SITE2-${now}`, `zztest-site2-${now}`]
    );
    otherSiteId = site[0].lastInsertRowid as number;

    const centre = await dbQuery(
      `INSERT INTO t_centres (site_id, nom, numero, sync_id) VALUES (?, 'ZZTEST Centre 2', 1, ?)`,
      [otherSiteId, `zztest-centre2-${now}`]
    );
    otherCentreId = centre[0].lastInsertRowid as number;

    otherAgentLogin = `ZZTEST_APUREMENT_S2_${now}`;
    const hash = await bcryptHash(TEST_PASSWORD);
    const user = await dbQuery(
      `INSERT INTO t_users (login, password_hash, role, nom_user, prenom_user, statut_actif, site_id, centre_id, sync_id, is_dirty)
       VALUES (?, ?, 'OPERATEUR_APUREMENT', 'ZZTEST', 'Apurement2', 1, ?, ?, ?, 0)`,
      [otherAgentLogin, hash, otherSiteId, otherCentreId, `zztest-user-s2-${now}`]
    );
    otherUserId = user[0].lastInsertRowid as number;
    await dbQuery(`INSERT INTO t_user_roles (id_user, role) VALUES (?, 'OPERATEUR_APUREMENT')`, [otherUserId]);

    console.log(`[agent13][ISOLATION] Second site créé id=${otherSiteId}, second agent créé login=${otherAgentLogin}`);
    expect(otherSiteId).toBeGreaterThan(0);
    expect(otherUserId).toBeGreaterThan(0);
  });

  test('10. [ISOLATION P0] Le second agent (site 2) apure une fiche via l\'UI réelle', async () => {
    const { window } = env;
    const now = Date.now();

    await logout();
    await login(otherAgentLogin, TEST_PASSWORD);
    await window.waitForURL(/#\/apurement/, { timeout: 20000 });
    await expect(window.getByText("PORTAIL D'APUREMENT")).toBeVisible({ timeout: 10000 });

    const kpiToday = await getKpiValue(window, "Aujourd'hui");
    expect(kpiToday).toBe(0);
    const rows0 = await getTravailDuJourRows(window);
    expect(rows0.length).toBe(0);

    const insert = await dbQuery(
      `INSERT INTO t_cartes (noms, prenoms, date_de_naissance, lieu_de_naissance, num_secu, statut, site_id)
       VALUES (?, 'ZZTEST_PRENOM', '1992-09-09', 'ZZTEST_LIEU', 'ZZTEST-SECU-S2', 'EN STOCK', ?)`,
      [`ZZTEST_SITE2_${now}`, otherSiteId]
    );
    const carteId = insert[0].lastInsertRowid as number;

    await window.getByText("TRAVAIL D'APUREMENT").click();
    await expect(window.getByPlaceholder('Saisir nom & prénoms...')).toBeVisible({ timeout: 10000 });
    await window.getByPlaceholder('Saisir nom & prénoms...').fill(`ZZTEST_SITE2_${now}`);
    await window.getByRole('button', { name: /Rechercher/ }).click();
    await expect(window.getByText(`ZZTEST_SITE2_${now} ZZTEST_PRENOM`)).toBeVisible({ timeout: 10000 });
    await window.getByText(`ZZTEST_SITE2_${now} ZZTEST_PRENOM`).click();
    await window.locator('input[placeholder="Ex: 0707..."]').fill('0700000003');
    await window.getByRole('button', { name: /Valider l'Apurement/ }).click();
    await expect(window.getByText('Décharge historique enregistrée avec succès.').last()).toBeVisible({ timeout: 10000 });

    const rowAfter = (await dbQuery(`SELECT statut, agent_distributeur, site_id FROM t_cartes WHERE id_carte = ?`, [carteId]))[0];
    expect(rowAfter.statut).toBe('DELIVRE');
    expect(rowAfter.agent_distributeur.toUpperCase()).toBe(otherAgentLogin.toUpperCase());
    expect(rowAfter.site_id).toBe(otherSiteId);

    await window.getByText("VUE D'ENSEMBLE").click();
    await expect(window.getByText('Travail du jour')).toBeVisible({ timeout: 10000 });
    const kpiAfter = await getKpiValue(window, "Aujourd'hui");
    expect(kpiAfter).toBe(1);

    await window.screenshot({ path: join(SHOT_DIR, 'agent13-apurement-10-site2-agent-overview.png') });
    await logout();
  });

  test('11. [ISOLATION P0] Le premier agent (site 1) ne voit JAMAIS le travail du site 2 — ni via l\'UI, ni via IPC forgé', async () => {
    const { window } = env;
    const apurementUser = getTestUser('operateurApurement');

    await login(apurementUser.login, apurementUser.password);
    await window.waitForURL(/#\/apurement/, { timeout: 20000 });
    await expect(window.getByText('Travail du jour')).toBeVisible({ timeout: 10000 });

    const rows = await getTravailDuJourRows(window);
    const leaked = rows.some((r) => r.identite.includes('ZZTEST_SITE2_'));
    console.log(`[agent13][ISOLATION-P0][UI] Fiche du site 2 visible dans la Vue d'ensemble du site 1 = ${leaked} (attendu: false)`);
    expect(leaked).toBe(false);

    const forged = await window.evaluate(
      async ({ otherLogin, otherSite }) => {
        // @ts-expect-error API preload non typée ici
        return await window.api.stats.getApurementCardsTodayPaginated(otherLogin, otherSite, 0, 20);
      },
      { otherLogin: otherAgentLogin, otherSite: otherSiteId }
    );
    console.log(
      `[agent13][ISOLATION-P0][IPC-FORGE] Appel forgé depuis session site 1 avec agentUsername='${otherAgentLogin}' ` +
      `siteId=${otherSiteId} → total=${forged.total}, rows=${JSON.stringify(forged.rows.map((r: any) => r.noms))}`
    );
    const forgedLeak = forged.rows.some((r: any) => r.noms?.startsWith('ZZTEST_SITE2_'));
    expect(forgedLeak, 'Un appel IPC forgé avec le login/site du second agent ne doit JAMAIS renvoyer ses fiches').toBe(false);

    await window.screenshot({ path: join(SHOT_DIR, 'agent13-apurement-11-no-leak-site1.png') });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // BLOC 7 — CORRECTIF 1 (P0) REVALIDÉ : handlers PARTAGÉS 'stats:getVerification' /
  // 'stats:getCardsToday' (alimentent les mêmes 4 KPI sur les deux portails APUREMENT et
  // VERIFICATION). Session ré-authentifiée explicitement (le test 11 se termine sans logout,
  // donc la session du premier agent est toujours active ici).
  // ═══════════════════════════════════════════════════════════════════════
  test("12. [SÉCURITÉ P0 CORRIGÉE] 'stats:getVerification'/'stats:getCardsToday' — désormais cantonnés à la session serveur réelle, plus au paramètre forgé", async () => {
    const { window } = env;
    const apurementUser = getTestUser('operateurApurement');

    // Vérité serveur indépendante : stats RÉELLES (date_delivrance, comportement inchangé de
    // ces deux handlers pré-existants) du premier agent (site 1) aujourd'hui.
    const todayStr = new Date().toISOString().split('T')[0];
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];
    const realCountSite1 = (await dbQuery(
      `SELECT COUNT(*) as c FROM t_cartes WHERE statut='DELIVRE' AND UPPER(agent_distributeur)=UPPER(?) AND site_id=? AND date_delivrance >= ? AND date_delivrance < ?`,
      [apurementUser.login, env.seed.siteId, todayStr, tomorrowStr]
    ))[0].c;

    // Appel DIRECT (bypass UI) avec le login/site RÉELS et FORGÉS du second agent (site 2) —
    // exactement le scénario d'attaque décrit dans la tâche : un agent authentique falsifie les
    // paramètres pour consulter les stats d'un collègue sur un autre site.
    const forgedStats = await window.evaluate(
      async ({ otherLogin, otherSite }) => {
        // @ts-expect-error API preload non typée ici
        return await window.api.stats.getVerification(otherLogin, otherSite);
      },
      { otherLogin: otherAgentLogin, otherSite: otherSiteId }
    );
    const forgedCardsToday = await window.evaluate(
      async ({ otherLogin, otherSite }) => {
        // @ts-expect-error idem — getVerificationCardsToday renvoie un COMPTEUR (number), pas un tableau
        return await window.api.stats.getCardsToday(otherLogin, otherSite);
      },
      { otherLogin: otherAgentLogin, otherSite: otherSiteId }
    );
    console.log(
      `[agent13][SECURITE-P0-CORRIGEE] Depuis la session RÉELLE du premier agent (site 1), appel DIRECT de ` +
      `'stats:getVerification'/'stats:getCardsToday' avec agentUsername/siteId FORGÉS = login/site RÉELS du second ` +
      `agent (site 2) → getVerification.today=${forgedStats?.today} (vérité serveur site1=${realCountSite1}), ` +
      `getCardsToday=${forgedCardsToday} (le second agent a traité 1 fiche aujourd'hui sur SON site — si ces ` +
      `chiffres correspondaient à ceux du site 2 plutôt qu'à realCountSite1, le correctif ne serait pas effectif).`
    );
    expect(forgedStats?.today, 'stats:getVerification forgé (site 2) doit refléter le VRAI agent connecté (site 1), pas le paramètre').toBe(realCountSite1);
    expect(forgedCardsToday, 'stats:getCardsToday forgé (site 2) doit refléter le VRAI agent connecté (site 1), pas le paramètre').toBe(realCountSite1);

    await window.screenshot({ path: join(SHOT_DIR, 'agent13-apurement-12-shared-handlers-fixed.png') });
    await logout();
  });

  test('13. [NON-RÉGRESSION SUPER ADMIN] visibilité inter-agents volontaire et non filtrée (comportement attendu, pas un bug)', async () => {
    const { window } = env;
    const superAdmin = getTestUser('superAdmin');

    await login(superAdmin.login, superAdmin.password);
    await window.waitForURL(/#\/dashboard/, { timeout: 20000 });

    const asSuperAdminForSite2Agent = await window.evaluate(
      async ({ otherLogin, otherSite }) => {
        // @ts-expect-error API preload non typée ici
        return await window.api.stats.getApurementCardsTodayPaginated(otherLogin, otherSite, 0, 20);
      },
      { otherLogin: otherAgentLogin, otherSite: otherSiteId }
    );
    console.log(
      `[agent13][SUPER-ADMIN-OVERSIGHT] SUPER ADMIN consultant explicitement agentUsername='${otherAgentLogin}' ` +
      `siteId=${otherSiteId} → total=${asSuperAdminForSite2Agent.total} (attendu: 1, ce rôle garde la liberté de consultation)`
    );
    expect(asSuperAdminForSite2Agent.total).toBe(1);

    await logout();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // BLOC 8 — Non-régression portail OPERATEUR_VERIFICATION (hook partagé
  // useVerificationStats, toujours basé sur date_delivrance — inchangé).
  // ═══════════════════════════════════════════════════════════════════════
  test('14. [NON-RÉGRESSION] Portail OPERATEUR_VERIFICATION — Vue d\'ensemble (Overview.tsx) toujours fonctionnelle', async () => {
    const { window } = env;
    const user = getTestUser('operateurVerification');

    await window.waitForURL(/#\/login/, { timeout: 20000 });
    await login(user.login, user.password);
    await window.waitForURL(/#\/agent-verification/, { timeout: 20000 });

    const overlay = window.locator('.dashboard-premium.animate-fade-in');
    const overlayGoneInTime = await overlay
      .waitFor({ state: 'detached', timeout: 12000 })
      .then(() => true)
      .catch(() => false);
    console.log(`[agent13][VERIFICATION-NONREG] Overlay "Chargement sécurisé" levé en < 12s : ${overlayGoneInTime}`);

    for (const label of ["Aujourd'hui", 'Cette semaine', 'Ce mois', 'Cette année']) {
      const v = await getKpiValue(window, label);
      expect(v, `Portail OPERATEUR_VERIFICATION — KPI "${label}" doit rester fonctionnel après le chantier Apurement`).not.toBeNull();
    }

    await window.screenshot({ path: join(SHOT_DIR, 'agent13-apurement-14-verification-portal-ok.png') });
    await logout();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // BLOC 9 — CORRECTIF 3 : même modale via l'onglet APUREMENT du portail /inventaire
  // (OPERATEUR_INVENTAIRE/LOGISTIQUE) — composant InventaireApurement.tsx partagé.
  // ═══════════════════════════════════════════════════════════════════════
  test('15. [CORRECTIF 3] /inventaire (onglet APUREMENT) — carte DÉJÀ déchargée → modale avec bonnes infos → "Annuler" ne modifie rien', async () => {
    const { window } = env;
    const now = Date.now();
    const inventaireUser = getTestUser('operateurInventaire');

    const firstDate = '2025-11-02';
    const insert = await dbQuery(
      `INSERT INTO t_cartes (noms, prenoms, date_de_naissance, lieu_de_naissance, num_secu, statut, site_id, agent_distributeur, date_delivrance, nom_retirant, num_retirant, relation_retirant, updated_at, is_dirty)
       VALUES (?, 'ZZTEST_PRENOM', '1988-02-02', 'ZZTEST_LIEU', 'ZZTEST-SECU-MODAL2', 'DELIVRE', ?, ?, ?, 'ZZTEST ANCIEN RETIRANT INV', '0700000020', 'SOI-MEME', ?, 1)`,
      [`ZZTEST_MODALINV_${now}`, env.seed.siteId, inventaireUser.login, firstDate, new Date().toISOString()]
    );
    modalCardIdInventaire = insert[0].lastInsertRowid as number;
    insertedCardIds.push(modalCardIdInventaire);

    await login(inventaireUser.login, inventaireUser.password);
    await window.waitForURL(/#\/inventaire/, { timeout: 20000 });

    await window.getByRole('button', { name: /APUREMENT HISTORIQUE/ }).click();
    await expect(window.getByPlaceholder('Saisir nom & prénoms...')).toBeVisible({ timeout: 10000 });
    await window.getByPlaceholder('Saisir nom & prénoms...').fill(`ZZTEST_MODALINV_${now}`);
    await window.getByRole('button', { name: /Rechercher/ }).click();
    await expect(window.getByText(`ZZTEST_MODALINV_${now} ZZTEST_PRENOM`)).toBeVisible({ timeout: 10000 });
    await window.getByText(`ZZTEST_MODALINV_${now} ZZTEST_PRENOM`).click();

    await expect(window.getByText('Carte déjà déchargée')).toBeVisible({ timeout: 10000 });
    const modalText = await window.evaluate(() => document.body.textContent || '');
    expect(modalText).toContain(firstDate);
    expect(modalText).toContain(inventaireUser.login);
    expect(modalText).toContain('ZZTEST ANCIEN RETIRANT INV');
    await window.screenshot({ path: join(SHOT_DIR, 'agent13-apurement-15-inventaire-modal-deja-dechargee.png') });

    await expect(window.getByText('Dossier Sélectionné')).not.toBeVisible();

    await window.getByRole('button', { name: 'Annuler' }).click();
    await expect(window.getByText('Carte déjà déchargée')).not.toBeVisible({ timeout: 5000 });
    await expect(window.getByText(`ZZTEST_MODALINV_${now} ZZTEST_PRENOM`)).toBeVisible({ timeout: 5000 });

    const rowAfterCancel = (await dbQuery(
      `SELECT date_delivrance, nom_retirant, num_retirant FROM t_cartes WHERE id_carte = ?`,
      [modalCardIdInventaire]
    ))[0];
    console.log(`[agent13][CORRECTIF-3][INVENTAIRE][ANNULER] État en base après "Annuler" :`, JSON.stringify(rowAfterCancel));
    expect(rowAfterCancel.date_delivrance).toBe(firstDate);
    expect(rowAfterCancel.nom_retirant).toBe('ZZTEST ANCIEN RETIRANT INV');
  });

  test('16. [CORRECTIF 3] /inventaire (onglet APUREMENT) — carte NON déchargée → aucune modale (non-régression) ; "Continuer quand même" écrase l\'ancien émargement de la carte du test 15', async () => {
    const { window } = env;
    const now = Date.now();
    const inventaireUser = getTestUser('operateurInventaire');

    // Carte fraîche EN STOCK — non-régression : aucune modale ne doit apparaître.
    const insertFresh = await dbQuery(
      `INSERT INTO t_cartes (noms, prenoms, date_de_naissance, lieu_de_naissance, num_secu, statut, site_id)
       VALUES (?, 'ZZTEST_PRENOM', '1995-07-07', 'ZZTEST_LIEU', 'ZZTEST-SECU-FRESH-INV', 'EN STOCK', ?)`,
      [`ZZTEST_FRESHINV_${now}`, env.seed.siteId]
    );
    const freshCarteId = insertFresh[0].lastInsertRowid as number;
    insertedCardIds.push(freshCarteId);

    await window.getByPlaceholder('Saisir nom & prénoms...').fill(`ZZTEST_FRESHINV_${now}`);
    await window.getByRole('button', { name: /Rechercher/ }).click();
    await expect(window.getByText(`ZZTEST_FRESHINV_${now} ZZTEST_PRENOM`)).toBeVisible({ timeout: 10000 });
    await window.getByText(`ZZTEST_FRESHINV_${now} ZZTEST_PRENOM`).click();
    await expect(window.getByText('Carte déjà déchargée')).not.toBeVisible();
    await expect(window.getByText('Dossier Sélectionné')).toBeVisible({ timeout: 10000 });
    // Revient à la liste sans valider (Annuler du FORMULAIRE, pas de la modale).
    await window.getByRole('button', { name: 'Annuler', exact: true }).click();
    await expect(window.getByPlaceholder('Saisir nom & prénoms...')).toBeVisible({ timeout: 10000 });

    // Reprend la carte du test 15 (déjà DELIVRE) → "Continuer quand même" → écrase l'ancien émargement.
    expect(modalCardIdInventaire, 'Dépend de la carte créée au test 15').toBeGreaterThan(0);
    const row = (await dbQuery(`SELECT noms, prenoms FROM t_cartes WHERE id_carte = ?`, [modalCardIdInventaire]))[0];
    const fullName = `${row.noms} ${row.prenoms}`;
    await window.getByPlaceholder('Saisir nom & prénoms...').fill(fullName);
    await window.getByRole('button', { name: /Rechercher/ }).click();
    await expect(window.getByText(fullName)).toBeVisible({ timeout: 10000 });
    await window.getByText(fullName).click();

    await expect(window.getByText('Carte déjà déchargée')).toBeVisible({ timeout: 10000 });
    await window.getByRole('button', { name: 'Continuer quand même' }).click();
    await expect(window.getByText('Dossier Sélectionné')).toBeVisible({ timeout: 10000 });

    const newDateStr = new Date().toISOString().split('T')[0];
    await window.locator('input[type="date"]').fill(newDateStr);
    await window.locator('input[placeholder="Ex: 0707..."]').fill('0788888888');
    await window.getByRole('button', { name: /Valider l'Apurement/ }).click();
    await expect(window.getByText('Décharge historique enregistrée avec succès.').last()).toBeVisible({ timeout: 10000 });

    const rowAfter = (await dbQuery(
      `SELECT date_delivrance, num_retirant, agent_distributeur FROM t_cartes WHERE id_carte = ?`,
      [modalCardIdInventaire]
    ))[0];
    console.log(`[agent13][CORRECTIF-3][INVENTAIRE][CONTINUER] État en base après "Continuer quand même" + validation :`, JSON.stringify(rowAfter));
    expect(rowAfter.date_delivrance).toBe(newDateStr);
    expect(rowAfter.num_retirant).toBe('0788888888');
    expect(rowAfter.agent_distributeur.toUpperCase()).toBe(inventaireUser.login.toUpperCase());

    await window.screenshot({ path: join(SHOT_DIR, 'agent13-apurement-16-inventaire-modal-continuer-ecrase.png') });
    await logout();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // BLOC 10 — Nettoyage exhaustif des données de test (§1 garde-fou).
  // ═══════════════════════════════════════════════════════════════════════
  test('17. Nettoyage — suppression de toutes les données ZZTEST_ créées (cartes, users, centre, site)', async () => {
    for (const id of insertedCardIds) {
      await dbQuery(`DELETE FROM t_cartes WHERE id_carte = ?`, [id]);
    }
    for (const id of bulkCardIds) {
      await dbQuery(`DELETE FROM t_cartes WHERE id_carte = ?`, [id]);
    }
    await dbQuery(`DELETE FROM t_cartes WHERE noms LIKE 'ZZTEST_%'`);

    const remainingCards = (await dbQuery(`SELECT COUNT(*) as c FROM t_cartes WHERE noms LIKE 'ZZTEST_%'`))[0].c;
    expect(remainingCards).toBe(0);

    if (otherAgentLogin) {
      // t_logs.id_user référence t_users(id_user) SANS ON DELETE CASCADE (contrairement à
      // t_user_roles) : la connexion réelle effectuée en tests 10/11/13 y a inséré des lignes
      // d'audit (ex: action LOGIN) qui doivent être purgées explicitement avant de pouvoir
      // supprimer l'utilisateur, sous peine de FOREIGN KEY constraint failed (constaté empiriquement).
      await dbQuery(`DELETE FROM t_logs WHERE id_user = ? OR login_user = ?`, [otherUserId, otherAgentLogin]);
      const users = await dbQuery(`SELECT id_user FROM t_users WHERE login = ?`, [otherAgentLogin]);
      for (const u of users) {
        await dbQuery(`DELETE FROM t_user_roles WHERE id_user = ?`, [u.id_user]);
      }
      await dbQuery(`DELETE FROM t_users WHERE login = ?`, [otherAgentLogin]);
    }
    if (otherCentreId) {
      await dbQuery(`DELETE FROM t_centres WHERE id = ?`, [otherCentreId]);
    }
    if (otherSiteId) {
      await dbQuery(`DELETE FROM t_sites WHERE id = ?`, [otherSiteId]);
    }

    const remainingUsers = (await dbQuery(`SELECT COUNT(*) as c FROM t_users WHERE login LIKE 'ZZTEST_%'`))[0].c;
    const remainingSites = (await dbQuery(`SELECT COUNT(*) as c FROM t_sites WHERE nom LIKE 'ZZTEST%'`))[0].c;
    console.log(
      `[agent13][NETTOYAGE] Cartes ZZTEST_ restantes=${remainingCards}, users ZZTEST_ restants=${remainingUsers}, ` +
      `sites ZZTEST restants=${remainingSites} (attendu: 0 partout)`
    );
    expect(remainingUsers).toBe(0);
    expect(remainingSites).toBe(0);
  });
});
