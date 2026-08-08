/**
 * e2e/specs/import/import-centre-migration-qa-terrain.e2e.spec.ts
 *
 * QA Terrain (agent-13) — REVALIDATION des 8 correctifs appliqués sur la page
 * "Centre de Migration" (src/renderer/src/pages/ImportPage.tsx, route /import)
 * suite au rapport QA précédent. Ce fichier remplace la version précédente :
 * les scénarios qui documentaient un bug avéré (VACUUM fire-and-forget,
 * compteur de cartes global, corbeille inopérante, doublons probables jamais
 * détectés) ont été réécrits pour affirmer le comportement CORRIGÉ attendu,
 * au lieu de documenter l'ancien bug comme "constat empirique".
 *
 * Isolation : même harnais que les runs QA Terrain précédents (Playwright
 * `_electron`, `e2e/fixtures/electron-app.ts`, `userDataDir` jetable sous
 * `AppData/Local/Temp/`, `GEST_IN_SITU_E2E_DISABLE_SYNC=1` positionné par
 * défaut par `launchSeededApp()`). Cette page contient des actions
 * destructrices (purge totale des cartes, réinitialisation FTS5) : AUCUNE
 * exécution contre `AppData/Roaming/gest-in-situ/data/gest_in_situ.db`
 * (chemin de production terrain) n'a lieu ici — seul le `userDataDir`
 * temporaire seedé par `runSeedInElectronNode()` est manipulé.
 *
 * Toutes les données créées par ce spec sont préfixées `ZZTEST_` et
 * nettoyées en fin de run (voir bloc CLEANUP), avec vérification SQLite
 * directe de la suppression effective.
 *
 * Une seule instance Electron est partagée pour tout le fichier
 * (`test.describe.serial`) : le RBAC (OPERATEUR_VERIFICATION) est vérifié
 * en tout début de run, puis un logout UI réel (`.btn-logout`) bascule sur
 * ADMINISTRATEUR_SITE pour le reste des scénarios — évite le coût d'un
 * second cold start Electron complet (~50-75s mesurés empiriquement).
 */
import { test, expect } from '@playwright/test';
import { launchSeededApp, teardownSeededApp, type E2EEnvironment } from '../../fixtures/electron-app';
import { getTestUser } from '../../fixtures/test-users';
import { writeFileSync, mkdtempSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

test.describe.serial('QA Terrain — Centre de Migration / ImportPage — REVALIDATION 8 correctifs (agent-13)', () => {
  let env: E2EEnvironment;
  let anyTestFailed = false;

  const siteAId = () => env.seed.siteId;
  const siteACentreId = () => env.seed.centreId;

  let siteBId: number;
  let siteBCentreId: number;

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

  // ── Helper SQL direct (voir adminsite-qa-terrain.e2e.spec.ts pour le détail
  // empirique de ce contournement ABI better-sqlite3 / Electron) ────────────
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

  // Variante dédiée aux PRAGMA (integrity_check, etc.) : `db.pragma()` de
  // better-sqlite3 gère le parsing du résultat correctement, contrairement à
  // `stmt.run()` utilisé par `dbQuery` pour tout ce qui ne commence pas par
  // "select" — un PRAGMA de lecture n'est ni l'un ni l'autre.
  const DB_PRAGMA_MARKER = '__E2E_DBPRAGMA__:';
  async function pragmaQuery(pragmaExpr: string): Promise<any[]> {
    const script = `
      const Database = require('better-sqlite3');
      const db = new Database(process.argv[1], { timeout: 15000 });
      db.pragma('busy_timeout = 15000');
      try {
        const result = db.pragma(process.argv[2]);
        process.stdout.write(${JSON.stringify(DB_PRAGMA_MARKER)} + JSON.stringify(result));
      } finally {
        db.close();
      }
    `;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electronPath = require('electron') as unknown as string;
    const { stdout, stderr } = await execFileAsync(
      electronPath,
      ['-e', script, env.seed.dbPath, pragmaExpr],
      { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
    );
    const line = stdout.split(/\r?\n/).reverse().find((l) => l.startsWith(DB_PRAGMA_MARKER));
    if (!line) {
      throw new Error(`[pragmaQuery] Aucun résultat exploitable.\nPRAGMA: ${pragmaExpr}\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`);
    }
    return JSON.parse(line.slice(DB_PRAGMA_MARKER.length));
  }

  // Clé de doublon canonique 5 segments (identique worker/saisie manuelle)
  const cleDoublon = (noms: string, prenoms: string, ddn: string, lieu: string, contact: string) =>
    `${noms}|${prenoms}|${ddn}|${lieu}|${contact}`;
  // Clé "flexible" 4 segments (sans lieu) utilisée par la détection de doublons probables
  const cleDoublonFlex = (noms: string, prenoms: string, ddn: string, contact: string) =>
    `${noms}|${prenoms}|${ddn}|${contact}`;

  async function mockOpenDialogOnce(filePath: string) {
    await env.app.evaluate(({ dialog }, fp) => {
      (dialog as any).__originalShowOpenDialog = dialog.showOpenDialog;
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [fp] })) as any;
    }, filePath);
  }
  async function restoreOpenDialog() {
    await env.app.evaluate(({ dialog }) => {
      if ((dialog as any).__originalShowOpenDialog) {
        dialog.showOpenDialog = (dialog as any).__originalShowOpenDialog;
        delete (dialog as any).__originalShowOpenDialog;
      }
    });
  }

  // Lit la valeur numérique affichée juste après un label <p> (tuiles Bilan / Source Active)
  async function readValueAfterLabel(label: string): Promise<string> {
    const { window } = env;
    const locator = window.locator('p', { hasText: label }).locator('xpath=following-sibling::p[1]');
    return (await locator.first().innerText()).trim();
  }

  // ── CONSTAT (hors périmètre des 8 correctifs revalidés ici, voir rapport final) ──
  // MainLayout.tsx affiche un overlay global bloquant ("Chargement sécurisé en cours...",
  // `pointerEvents: 'none'` sur l'Outlet) tant que `authStore.initialDataLoading` est true.
  // Ce flag est levé par la page Dashboard (useDashboardStats.ts, `setTimeout(..., 300)` dans
  // le `finally` de `loadStats()`/`loadGlobalData()`) — mais seulement après ses propres appels
  // IPC. Sur des navigations aussi rapprochées que dans ce spec (hash change immédiat vers
  // /import après /dashboard), la fenêtre entre l'arrivée sur /dashboard et la résolution de
  // `loadStats()` peut dépasser le temps qu'il faut pour atteindre /import et tenter d'y
  // cliquer — l'overlay (globalement partagé, pas propre à /import) intercepte alors les clics
  // ("<div> intercepts pointer events"). ImportPage.tsx lui-même ne lève JAMAIS ce flag en
  // l'absence de cache (`fetchCardCount()` ne l'efface pas), donc /import dépend entièrement
  // d'un passage préalable par une page qui l'efface. Attente défensive ajoutée ici (pas un
  // correctif produit) pour fiabiliser la suite QA.
  async function waitForNoLoadingOverlay(timeout = 60000) {
    const { window } = env;
    try {
      await expect(window.getByText('Chargement sécurisé en cours...')).toHaveCount(0, { timeout });
    } catch (e) {
      try {
        const stepText = await window.locator('span', { hasText: /./ }).filter({ hasText: /Initialisation|Connexion|Extraction|Vérification|Analyse|Mise en cache|Déverrouillage|Interface prête/ }).first().innerText({ timeout: 2000 });
        console.log('[DIAG waitForNoLoadingOverlay] loadingStepText=', stepText);
      } catch (diagErr) {
        console.log('[DIAG waitForNoLoadingOverlay] could not read loadingStepText:', diagErr);
      }
      throw e;
    }
  }

  const tmpDir = mkdtempSync(join(tmpdir(), 'gest-in-situ-qa-import-centre-'));

  // ══════════════════════════════════════════════════════════════════════
  // BLOC 0 — RBAC : un rôle non autorisé (OPERATEUR_VERIFICATION) est bloqué
  // ══════════════════════════════════════════════════════════════════════

  test('0. Login OPERATEUR_VERIFICATION puis /import → ProtectedRoute redirige vers /agent-verification', async () => {
    const { window } = env;
    const user = getTestUser('operateurVerification');
    await window.waitForURL(/#\/login/);
    await window.getByTestId('login-input').fill(user.login);
    await window.getByTestId('password-input').fill(user.password);
    await window.getByTestId('login-submit').click();
    await window.waitForURL(/#\/agent-verification/, { timeout: 20000 });

    await window.evaluate(() => { globalThis.location.hash = '#/import'; });
    await window.waitForURL(/#\/agent-verification/, { timeout: 15000 });
    await expect(window.getByText('Centre de Migration')).toHaveCount(0);
  });

  test('0b. Logout UI réel puis login ADMINISTRATEUR_SITE (bascule de rôle sans relancer Electron)', async () => {
    const { window } = env;
    await window.locator('.btn-logout').click();
    await window.waitForURL(/#\/login/, { timeout: 15000 });

    const admin = getTestUser('administrateurSite');
    await window.getByTestId('login-input').fill(admin.login);
    await window.getByTestId('password-input').fill(admin.password);
    await window.getByTestId('login-submit').click();
    await window.waitForURL(/#\/dashboard/, { timeout: 20000 });

    // DIAGNOSTIC agent-13 (banc jetable _diag_overlay{1,2,3}.e2e.spec.ts, supprimés après
    // usage — voir rapport final) : `initialDataLoading` (authStore.ts) n'est mis à `true`
    // qu'UNE SEULE FOIS dans toute l'appli, en dur dans l'action `login()`. Il n'est plus
    // JAMAIS remis à `true` ensuite (aucun appel à `setInitialDataLoading(true)` ailleurs
    // dans le renderer) — seul `useDashboardStats.ts` le repasse à `false` via
    // `setTimeout(() => useAuthStore.getState().setInitialDataLoading(false), 300)` en toute
    // fin de `loadStats()`/`loadGlobalData()`. Si la page /dashboard est quittée (hash-jump)
    // AVANT que React n'ait eu l'occasion d'exécuter l'effet qui déclenche `loadStats()`,
    // cette fonction n'est JAMAIS appelée : le `setTimeout` qui lève le flag n'est donc
    // jamais programmé, et l'overlay global bloquant reste affiché DÉFINITIVEMENT (confirmé
    // reproductible à 100% : 92s d'attente sans résolution) — pas une simple lenteur. Bug réel
    // (UI globale, MainLayout.tsx/authStore.ts/useDashboardStats.ts), mais HORS PÉRIMÈTRE des
    // 8 correctifs de "Centre de Migration" révalidés ici (aucun des fichiers touchés par ces
    // correctifs — maintenance.queries.ts, handlers.ts [scope import/db uniquement],
    // import-worker.js, ImportPage.tsx, preload/*, ne concerne l'auth ou le Dashboard) —
    // signalé en P1 dans le rapport final, à river à agent-3-coder séparément. Attente ICI
    // (une seule fois, juste après ce second login, AVANT toute navigation ultérieure) pour
    // laisser `loadStats()` s'exécuter et lever le flag pendant que /dashboard est encore
    // monté — protège tout le reste de la suite (le flag ne repassant plus jamais à `true`).
    await waitForNoLoadingOverlay();
  });

  // ══════════════════════════════════════════════════════════════════════
  // BLOC 1 — En-tête de la page
  // ══════════════════════════════════════════════════════════════════════

  test('1. Header "Centre de Migration" + badge "MOTEUR TURBO V2.0" visibles', async () => {
    const { window } = env;
    await window.evaluate(() => { globalThis.location.hash = '#/import'; });
    await window.waitForURL(/#\/import/, { timeout: 15000 });
    await waitForNoLoadingOverlay();
    await expect(window.getByText('Centre de Migration')).toBeVisible();
    await expect(window.getByText('MOTEUR TURBO V2.0')).toBeVisible();
  });

  // ══════════════════════════════════════════════════════════════════════
  // BLOC 2 — Aperçu du fichier : détection de colonnes (variantes d'en-tête),
  // suppression de ligne (aperçu uniquement, fichier disque intact)
  // ══════════════════════════════════════════════════════════════════════

  const previewCsvPath = join(tmpDir, 'zztest_preview_variants.csv');
  test('2. Sélection fichier + auto-détection de colonnes avec variantes d\'en-tête courtes ("nom","prenom","date_naissance","n° secu","lieu","contact")', async () => {
    const { window } = env;
    const lines = [
      'nom;prenom;date_naissance;n° secu;lieu;contact',
      'ZZTEST_PREV1;Kouassi;1990-01-01;NS1001;Abobo;0708091011',
      'ZZTEST_PREV2;Yao;1991-02-02;NS1002;Abobo;0708091012',
      'ZZTEST_PREV3;Aka;1992-03-03;NS1003;Abobo;0708091013',
      'ZZTEST_PREV4;Bakayoko;1993-04-04;NS1004;Abobo;0708091014',
      'ZZTEST_PREV5;Coulibaly;1994-05-05;NS1005;Abobo;0708091015'
    ];
    writeFileSync(previewCsvPath, lines.join('\n'), 'utf-8');

    await mockOpenDialogOnce(previewCsvPath);
    try {
      await window.getByRole('button', { name: /Sélectionner le Listing/i }).click();
      await expect(window.getByText('5 lignes détectées').first()).toBeVisible({ timeout: 10000 });
    } finally {
      await restoreOpenDialog();
    }

    for (const label of ['NOM(S)', 'PRÉNOM(S)', 'DATE NAISSANCE', 'N° SÉCU', 'LIEU NAISSANCE', 'CONTACT']) {
      await expect(window.getByText(label, { exact: true })).toBeVisible();
    }
    await expect(window.getByText('ZZTEST_PREV3')).toBeVisible();
    await expect(window.getByText('Kouassi')).toBeVisible();

    const volume = await readValueAfterLabel('Volume');
    expect(volume).toBe('5');
  });

  test('3. Bouton corbeille : la ligne disparaît de l\'aperçu + le "Volume" décrémente, SANS toucher le fichier source sur disque', async () => {
    const { window } = env;
    const sizeBefore = statSync(previewCsvPath).size;

    const row = window.locator('tr', { hasText: 'ZZTEST_PREV3' });
    await row.locator('button.btn-icon').click();
    await expect(window.getByText('Ligne retirée de l\'aperçu').first()).toBeVisible({ timeout: 5000 });
    await expect(window.getByText('ZZTEST_PREV3')).toHaveCount(0);

    const volume = await readValueAfterLabel('Volume');
    expect(volume).toBe('4');

    const sizeAfter = statSync(previewCsvPath).size;
    expect(sizeAfter, 'Le fichier CSV source sur disque ne doit jamais être modifié par la suppression dans l\'aperçu').toBe(sizeBefore);
  });

  test('4. Fichier illisible (chemin inexistant) → toast d\'erreur, aucun aperçu affiché', async () => {
    const { window } = env;
    await window.evaluate(() => { globalThis.location.hash = '#/dashboard'; });
    await window.waitForURL(/#\/dashboard/);
    await window.evaluate(() => { globalThis.location.hash = '#/import'; });
    await window.waitForURL(/#\/import/);
    await waitForNoLoadingOverlay();

    const missingPath = join(tmpDir, 'ZZTEST_DOES_NOT_EXIST.csv');
    await mockOpenDialogOnce(missingPath);
    try {
      await window.getByRole('button', { name: /Sélectionner le Listing/i }).click();
      await expect(window.getByText(/Erreur de lecture/i).first()).toBeVisible({ timeout: 10000 });
    } finally {
      await restoreOpenDialog();
    }
    await expect(window.locator('table.data-table')).toHaveCount(0);
  });

  // ══════════════════════════════════════════════════════════════════════
  // BLOC 3 — Garde-fou "Centre Principal non renommé" + P0-2 (corbeille à
  // 2 exclusions NON consécutives) + P2 (alias d'en-tête "N° SECU")
  // ══════════════════════════════════════════════════════════════════════

  const importCsvPath = join(tmpDir, 'zztest_real_import.csv');
  const EXCLUDED_A_NAME = 'ZZTEST_MIG_EXCLUDED_A'; // ligne 2 du fichier (index 1, 0-based)
  const EXCLUDED_B_NAME = 'ZZTEST_MIG_EXCLUDED_B'; // ligne 4 du fichier (index 3, 0-based)

  test('5. Préparation des données pré-existantes + fichier d\'import réel (12 lignes, en-tête "N° SECU" sans accent, 2 lignes à exclure NON consécutives)', async () => {
    // ── Pré-existant en base AVANT import ──────────────────────────────────
    // R6 : doublon exact (carte déjà EN STOCK, import apporte la même identité en EN STOCK → ignoré)
    await dbQuery(
      `INSERT INTO t_cartes (noms, prenoms, date_de_naissance, lieu_de_naissance, contact, statut, site_id, centre_id, cle_doublon, cle_doublon_flex, sync_id)
       VALUES ('ZZTEST_MIG_EXACTDUP_EXIST', 'STANDARD', '1993-06-06', 'ABOBO', '0102030406', 'EN STOCK', ?, ?, ?, ?, ?)`,
      [siteAId(), siteACentreId(),
        cleDoublon('ZZTEST_MIG_EXACTDUP_EXIST', 'STANDARD', '1993-06-06', 'ABOBO', '0102030406'),
        cleDoublonFlex('ZZTEST_MIG_EXACTDUP_EXIST', 'STANDARD', '1993-06-06', '0102030406'),
        `zztest-migdup-${Date.now()}`]
    );
    // R7 : mise à jour légitime (carte EN STOCK existante, import apporte DELIVRE → doit être mise à jour)
    await dbQuery(
      `INSERT INTO t_cartes (noms, prenoms, date_de_naissance, lieu_de_naissance, contact, statut, site_id, centre_id, cle_doublon, cle_doublon_flex, sync_id)
       VALUES ('ZZTEST_MIG_LEGITUPDATE', 'STANDARD', '1994-07-07', 'ABOBO', '0102030407', 'EN STOCK', ?, ?, ?, ?, ?)`,
      [siteAId(), siteACentreId(),
        cleDoublon('ZZTEST_MIG_LEGITUPDATE', 'STANDARD', '1994-07-07', 'ABOBO', '0102030407'),
        cleDoublonFlex('ZZTEST_MIG_LEGITUPDATE', 'STANDARD', '1994-07-07', '0102030407'),
        `zztest-migupd-${Date.now()}`]
    );
    // R10 : doublon PROBABLE (même identité flex — noms/prenoms/ddn/contact — mais lieu différent)
    await dbQuery(
      `INSERT INTO t_cartes (noms, prenoms, date_de_naissance, lieu_de_naissance, contact, statut, site_id, centre_id, cle_doublon, cle_doublon_flex, sync_id)
       VALUES ('ZZTEST_MIG_PROBABLEDUP', 'STANDARD', '1998-11-11', 'ABOBO', '0102030410', 'EN STOCK', ?, ?, ?, ?, ?)`,
      [siteAId(), siteACentreId(),
        cleDoublon('ZZTEST_MIG_PROBABLEDUP', 'STANDARD', '1998-11-11', 'ABOBO', '0102030410'),
        cleDoublonFlex('ZZTEST_MIG_PROBABLEDUP', 'STANDARD', '1998-11-11', '0102030410'),
        `zztest-migprob-${Date.now()}`]
    );

    // En-tête : "N° SECU" SANS accent — variante ajoutée à COLUMN_ALIASES.num_secu par le
    // correctif P2. Avant le correctif, cet en-tête ne matchait aucun alias connu du Worker
    // (seul le mapping front-end de l'aperçu le reconnaissait) et num_secu restait vide en base.
    // Lignes 2 (index 1) et 4 (index 3) seront retirées via la corbeille — NON consécutives,
    // séparées par la ligne NEW2 (index 2) — pour vérifier l'invariant d'indexation du correctif
    // P0-2 sur plusieurs suppressions successives, pas seulement une.
    const lines = [
      'NOMS;PRENOMS;DATE DE NAISSANCE;LIEU DE NAISSANCE;CONTACT;N° SECU;RANGEMENT;STATUT;DATE DELIVRANCE;LIEU ENROLEMENT',
      'ZZTEST_MIG_NEW1;STANDARD;1990-01-01;ABOBO;0102030401;NS0001;;EN STOCK;;ABOBO',                    // 0 — kept, new
      `${EXCLUDED_A_NAME};STANDARD;1990-02-02;ABOBO;0102030491;NS0091;;EN STOCK;;ABOBO`,                 // 1 — EXCLU
      'ZZTEST_MIG_NEW2;STANDARD;1991-02-02;ABOBO;0102030402;NS0002;;DELIVRE;2024-05-05;ABOBO',           // 2 — kept, new
      `${EXCLUDED_B_NAME};STANDARD;1991-03-03;ABOBO;0102030492;NS0092;;EN STOCK;;ABOBO`,                 // 3 — EXCLU
      'ZZTEST_MIG_INTRADUP;STANDARD;1992-03-03;ABOBO;0102030403;NS0003;;EN STOCK;;ABOBO',                // 4 — kept, new (1ère occurrence)
      'ZZTEST_MIG_INTRADUP;STANDARD;1992-03-03;ABOBO;0102030403;NS0003;;EN STOCK;;ABOBO',                // 5 — kept, doublon intra-fichier
      'ZZTEST_MIG_BADDATE;STANDARD;99/99/9999;ABOBO;0102030405;NS0005;;EN STOCK;;ABOBO',                 // 6 — kept, rejeté (date invalide)
      'ZZTEST_MIG_EXACTDUP_EXIST;STANDARD;1993-06-06;ABOBO;0102030406;NS0006;;EN STOCK;;ABOBO',          // 7 — kept, doublon exact ignoré
      'ZZTEST_MIG_LEGITUPDATE;STANDARD;1994-07-07;ABOBO;0102030407;NS0007;;DELIVRE;2024-07-07;ABOBO',    // 8 — kept, mise à jour légitime
      'ZZTEST_MIG_UNKNOWNSTATUS;STANDARD;1995-08-08;ABOBO;0102030408;NS0008;;BIZARRE999;;ABOBO',         // 9 — kept, anomalie statut inconnu (inséré quand même)
      'ZZTEST_MIG_NEW3;STANDARD;1996-09-09;ABOBO;0102030409;NS0009;;EN STOCK;;ABOBO',                    // 10 — kept, new
      'ZZTEST_MIG_PROBABLEDUP;STANDARD;1998-11-11;YOPOUGON;0102030410;NS0010;;EN STOCK;;ABOBO'           // 11 — kept, doublon probable
    ];
    writeFileSync(importCsvPath, lines.join('\n'), 'utf-8');

    // Forçage du nom générique sur le centre unique du site A pour déclencher le garde-fou
    await dbQuery(`UPDATE t_centres SET nom = 'CENTRE PRINCIPAL' WHERE id = ?`, [siteACentreId()]);
    const row = await dbQuery('SELECT nom, numero FROM t_centres WHERE id = ?', [siteACentreId()]);
    expect(row[0].nom).toBe('CENTRE PRINCIPAL');
  });

  test('6. Sélection du fichier réel + suppression de 2 lignes NON CONSÉCUTIVES dans l\'aperçu (index 1 puis index 3), puis "Lancer l\'Importation" → modale bloquante "Personnalisation du Centre Requise"', async () => {
    const { window } = env;
    await window.evaluate(() => { globalThis.location.hash = '#/dashboard'; });
    await window.waitForURL(/#\/dashboard/);
    await window.evaluate(() => { globalThis.location.hash = '#/import'; });
    await window.waitForURL(/#\/import/);
    await waitForNoLoadingOverlay();

    await mockOpenDialogOnce(importCsvPath);
    try {
      await window.getByRole('button', { name: /Sélectionner le Listing/i }).click();
      await expect(window.getByText('12 lignes détectées').first()).toBeVisible({ timeout: 10000 });
    } finally {
      await restoreOpenDialog();
    }
    // Vérifie au passage que l'alias "N° SECU" (sans accent) est bien mappé à la colonne
    // canonique N° SÉCU dans l'aperçu (mapping front-end, indépendant du Worker).
    await expect(window.getByText('N° SÉCU', { exact: true })).toBeVisible();

    // Suppression n°1 : ligne index 1 (EXCLUDED_A)
    const rowA = window.locator('tr', { hasText: EXCLUDED_A_NAME });
    await rowA.locator('button.btn-icon').click();
    await expect(window.getByText('Ligne retirée de l\'aperçu').first()).toBeVisible({ timeout: 5000 });
    let volume = await readValueAfterLabel('Volume');
    expect(volume).toBe('11');

    // Suppression n°2 : ligne index 3 (EXCLUDED_B) — NON consécutive de la précédente
    // (séparée par la ligne NEW2 toujours visible). Vérifie que l'invariant d'indexation
    // tient sur une 2e suppression, pas seulement la première.
    const rowB = window.locator('tr', { hasText: EXCLUDED_B_NAME });
    await rowB.locator('button.btn-icon').click();
    await expect(window.getByText('Ligne retirée de l\'aperçu').first()).toBeVisible({ timeout: 5000 });
    volume = await readValueAfterLabel('Volume');
    expect(volume).toBe('10');

    // La ligne intermédiaire (NEW2) et les lignes suivantes restent bien affichées
    await expect(window.getByText('ZZTEST_MIG_NEW2')).toBeVisible();
    await expect(window.getByText('ZZTEST_MIG_PROBABLEDUP')).toBeVisible();

    await window.getByRole('button', { name: "Lancer l'Importation" }).click();
    await expect(window.getByText('Personnalisation du Centre Requise')).toBeVisible({ timeout: 10000 });

    // "Fermer" referme la modale sans perdre l'état de l'aperçu (file/preview/exclusions intacts)
    await window.getByRole('button', { name: 'Fermer' }).click();
    await expect(window.getByText('Personnalisation du Centre Requise')).toHaveCount(0);
    volume = await readValueAfterLabel('Volume');
    expect(volume, 'L\'aperçu (et les 2 suppressions de ligne) doit survivre à la fermeture de la modale garde-fou').toBe('10');

    // Reproduction + clic "Personnaliser" → navigation vers /sites
    await window.getByRole('button', { name: "Lancer l'Importation" }).click();
    await expect(window.getByText('Personnalisation du Centre Requise')).toBeVisible({ timeout: 5000 });
    await window.getByRole('button', { name: 'Personnaliser' }).click();
    await window.waitForURL(/#\/sites/, { timeout: 10000 });
  });

  test('7. Renommage du centre (débloque le garde-fou) puis retour sur /import : la modale garde-fou n\'apparaît plus', async () => {
    const { window } = env;
    await dbQuery(`UPDATE t_centres SET nom = 'ZZTEST_CENTRE_ABOBO' WHERE id = ?`, [siteACentreId()]);
    const row = await dbQuery('SELECT nom FROM t_centres WHERE id = ?', [siteACentreId()]);
    expect(row[0].nom).toBe('ZZTEST_CENTRE_ABOBO');

    // Retour sur /import (le composant a été démonté par la navigation vers /sites : file/preview repartent à zéro)
    await window.evaluate(() => { globalThis.location.hash = '#/import'; });
    await window.waitForURL(/#\/import/);
    await waitForNoLoadingOverlay();
    await expect(window.getByText('Sélectionner le Listing')).toBeVisible({ timeout: 10000 });
  });

  // ══════════════════════════════════════════════════════════════════════
  // BLOC 4 — Import réel (executeImport) + Bilan de Migration
  // ══════════════════════════════════════════════════════════════════════

  test('8. Ré-sélection du fichier + re-suppression des MÊMES 2 lignes (ordre inversé : B puis A), "Lancer l\'Importation" → modale "Configuration des Centres" (plus de garde-fou)', async () => {
    const { window } = env;
    await mockOpenDialogOnce(importCsvPath);
    try {
      await window.getByRole('button', { name: /Sélectionner le Listing/i }).click();
      await expect(window.getByText('12 lignes détectées').first()).toBeVisible({ timeout: 10000 });
    } finally {
      await restoreOpenDialog();
    }

    // Ordre volontairement inversé (B avant A) par rapport au test 6, pour vérifier que
    // l'invariant d'indexation ne dépend pas de l'ordre des suppressions.
    const rowB = window.locator('tr', { hasText: EXCLUDED_B_NAME });
    await rowB.locator('button.btn-icon').click();
    await expect(window.getByText('Ligne retirée de l\'aperçu').first()).toBeVisible({ timeout: 5000 });
    let volume = await readValueAfterLabel('Volume');
    expect(volume).toBe('11');

    const rowA = window.locator('tr', { hasText: EXCLUDED_A_NAME });
    await rowA.locator('button.btn-icon').click();
    await expect(window.getByText('Ligne retirée de l\'aperçu').first()).toBeVisible({ timeout: 5000 });
    volume = await readValueAfterLabel('Volume');
    expect(volume).toBe('10');

    await window.getByRole('button', { name: "Lancer l'Importation" }).click();
    await expect(window.getByText('Personnalisation du Centre Requise')).toHaveCount(0);
    await expect(window.getByText('Configuration des Centres')).toBeVisible({ timeout: 10000 });
    await expect(window.getByText('ZZTEST_CENTRE_ABOBO')).toBeVisible();
  });

  test('9. "Poursuivre l\'import" → import réel via le Worker, overlay bloquant, progression jusqu\'à 100%, réconciliation focus-restored sans gel', async () => {
    const { window } = env;
    await window.getByRole('button', { name: "Poursuivre l'import" }).click();

    await expect(window.getByText('Importation en cours...')).toBeVisible({ timeout: 10000 });

    await window.evaluate(() => window.dispatchEvent(new Event('app:focus-restored')));

    await expect(window.getByText('Bilan de Migration')).toBeVisible({ timeout: 60000 });
    await expect(window.getByText('Importation en cours...')).toHaveCount(0);
  });

  test('10. Bilan de Migration : P0-2 (exclusions réellement effectives et absentes de tout compteur), P1-3 (doublons probables > 0), P2 (num_secu via alias "N° SECU", libellé "Anomalies Signalées" + tooltip)', async () => {
    const { window } = env;

    const lignesTraitees = await readValueAfterLabel('Lignes Traitées');
    const nouvellesFiches = await readValueAfterLabel('Nouvelles Fiches');
    const misesAJour = await readValueAfterLabel('Mises à jour');
    const doublonsIgnores = await readValueAfterLabel('Doublons Ignorés');
    const doublonsProbables = await readValueAfterLabel('⚠️ Doublons Probables');
    // P2 : libellé renommé "Rejetées / Erreurs" → "Anomalies Signalées"
    await expect(window.getByText('Rejetées / Erreurs')).toHaveCount(0);
    const anomaliesLabel = window.getByText('Anomalies Signalées', { exact: true });
    await expect(anomaliesLabel).toBeVisible();
    const tooltipText = await anomaliesLabel.getAttribute('title');
    expect(tooltipText, 'Tooltip explicite attendu sur "Anomalies Signalées"').toContain('date invalide');
    expect(tooltipText).toContain('statut inconnu');
    const anomaliesSignalees = await readValueAfterLabel('Anomalies Signalées');

    console.log(`[BILAN UI] LignesTraitées=${lignesTraitees} Nouvelles=${nouvellesFiches} MàJ=${misesAJour} DoublonsIgnorés=${doublonsIgnores} DoublonsProbables=${doublonsProbables} AnomaliesSignalées=${anomaliesSignalees}`);

    // Sur les 12 lignes de données, 2 sont exclues (EXCLUDED_A, EXCLUDED_B) → 10 réellement traitées.
    expect(lignesTraitees).toBe('10');
    expect(nouvellesFiches).toBe('6'); // NEW1, NEW2, INTRADUP(x1), UNKNOWNSTATUS, NEW3, PROBABLEDUP-new
    expect(misesAJour).toBe('1'); // LEGITUPDATE
    expect(doublonsIgnores).toBe('2'); // INTRADUP (2e occurrence intra-fichier) + EXACTDUP_EXIST
    // CORRECTIF P1-3 validé : le comptage des doublons probables se fait désormais AVANT la
    // boucle de fusion (sur l'état de t_cartes tel qu'il existait avant cet import), donc
    // PROBABLEDUP (identité flex partagée avec une fiche pré-existante, lieu différent) est
    // enfin détecté. Avant le correctif, cette valeur était structurellement toujours 0.
    expect(doublonsProbables).toBe('1');
    expect(anomaliesSignalees).toBe('2'); // BADDATE (date invalide, non inséré) + UNKNOWNSTATUS (inséré mais anomalie tracée)

    // ── Vérification DB ligne par ligne ────────────────────────────────────
    // P0-2 — LES 2 LIGNES EXCLUES VIA LA CORBEILLE DOIVENT ÊTRE TOTALEMENT ABSENTES
    const excludedA = await dbQuery("SELECT * FROM t_cartes WHERE noms = ?", [EXCLUDED_A_NAME]);
    expect(excludedA.length, 'P0-2 : la ligne exclue via la corbeille (index 1) ne doit JAMAIS être importée dans t_cartes').toBe(0);
    const excludedB = await dbQuery("SELECT * FROM t_cartes WHERE noms = ?", [EXCLUDED_B_NAME]);
    expect(excludedB.length, 'P0-2 : la ligne exclue via la corbeille (index 3) ne doit JAMAIS être importée dans t_cartes').toBe(0);
    const excludedAAnomaly = await dbQuery("SELECT * FROM t_import_anomalies WHERE noms = ?", [EXCLUDED_A_NAME]);
    expect(excludedAAnomaly.length, 'Une ligne exclue ne doit apparaître dans AUCUN compteur, y compris les anomalies').toBe(0);
    const excludedBAnomaly = await dbQuery("SELECT * FROM t_import_anomalies WHERE noms = ?", [EXCLUDED_B_NAME]);
    expect(excludedBAnomaly.length).toBe(0);

    const new1 = await dbQuery("SELECT statut, num_secu FROM t_cartes WHERE noms = 'ZZTEST_MIG_NEW1'");
    expect(new1.length).toBe(1);
    expect(new1[0].statut).toBe('EN STOCK');
    // P2 — alias "N° SECU" (sans accent) : num_secu doit être correctement peuplé, pas vide.
    expect(new1[0].num_secu, 'P2 : alias "N° SECU" doit être reconnu par COLUMN_ALIASES et peupler num_secu').toBe('NS0001');

    const new2 = await dbQuery("SELECT statut, num_secu FROM t_cartes WHERE noms = 'ZZTEST_MIG_NEW2'");
    expect(new2.length).toBe(1);
    expect(new2[0].statut).toBe('DELIVRE');
    expect(new2[0].num_secu).toBe('NS0002');

    const intraDup = await dbQuery("SELECT statut FROM t_cartes WHERE noms = 'ZZTEST_MIG_INTRADUP'");
    expect(intraDup.length, 'Les 2 lignes strictement identiques du CSV ne doivent produire qu\'une seule fiche').toBe(1);
    expect(intraDup[0].statut).toBe('EN STOCK');

    const badDate = await dbQuery("SELECT * FROM t_cartes WHERE noms = 'ZZTEST_MIG_BADDATE'");
    expect(badDate.length, 'Date de naissance invalide → exclue de t_cartes').toBe(0);
    const badDateAnomaly = await dbQuery("SELECT type_anomalie FROM t_import_anomalies WHERE noms = 'ZZTEST_MIG_BADDATE'");
    expect(badDateAnomaly.length).toBeGreaterThanOrEqual(1);
    expect(badDateAnomaly[0].type_anomalie).toBe('DATE_INVALIDE');

    const exactDup = await dbQuery("SELECT statut FROM t_cartes WHERE noms = 'ZZTEST_MIG_EXACTDUP_EXIST'");
    expect(exactDup.length, 'Toujours une seule fiche (doublon exact ignoré)').toBe(1);
    expect(exactDup[0].statut).toBe('EN STOCK');

    const legitUpdate = await dbQuery("SELECT statut, num_secu FROM t_cartes WHERE noms = 'ZZTEST_MIG_LEGITUPDATE'");
    expect(legitUpdate.length).toBe(1);
    expect(legitUpdate[0].statut).toBe('DELIVRE');

    const unknownStatus = await dbQuery("SELECT statut FROM t_cartes WHERE noms = 'ZZTEST_MIG_UNKNOWNSTATUS'");
    expect(unknownStatus.length, 'Statut inconnu : la carte est quand même insérée (normalisée EN STOCK)').toBe(1);
    expect(unknownStatus[0].statut).toBe('EN STOCK');
    const unknownAnomaly = await dbQuery("SELECT type_anomalie FROM t_import_anomalies WHERE noms = 'ZZTEST_MIG_UNKNOWNSTATUS'");
    expect(unknownAnomaly.length).toBeGreaterThanOrEqual(1);
    expect(unknownAnomaly[0].type_anomalie).toBe('STATUT_INCONNU');

    const new3 = await dbQuery("SELECT statut, num_secu FROM t_cartes WHERE noms = 'ZZTEST_MIG_NEW3'");
    expect(new3.length).toBe(1);
    expect(new3[0].num_secu).toBe('NS0009');

    const probableDup = await dbQuery("SELECT COUNT(*) as c FROM t_cartes WHERE noms = 'ZZTEST_MIG_PROBABLEDUP'");
    expect(probableDup[0].c, 'Lieu différent → nouvelle fiche distincte (pas une mise à jour), détectée séparément comme "doublon probable"').toBe(2);

    // Cloisonnement site : toutes les cartes ZZTEST_MIG_ créées portent bien le site_id du site actif
    const foreignSite = await dbQuery("SELECT COUNT(*) as c FROM t_cartes WHERE noms LIKE 'ZZTEST\\_MIG\\_%' ESCAPE '\\' AND site_id != ?", [siteAId()]);
    expect(foreignSite[0].c).toBe(0);
    const correctCentre = await dbQuery("SELECT COUNT(*) as c FROM t_cartes WHERE noms LIKE 'ZZTEST\\_MIG\\_%' ESCAPE '\\' AND centre_id != ?", [siteACentreId()]);
    expect(correctCentre[0].c).toBe(0);
  });

  test('11. "Nouvelle Migration" réinitialise proprement l\'état (retour à l\'écran d\'upload)', async () => {
    const { window } = env;
    await window.getByRole('button', { name: 'Nouvelle Migration' }).click();
    await expect(window.getByText('Prêt pour la migration ?')).toBeVisible({ timeout: 10000 });
    await expect(window.getByText('Bilan de Migration')).toHaveCount(0);
  });

  // ══════════════════════════════════════════════════════════════════════
  // BLOC 5 — P1-1/P0-8 : db:getCardCount filtré par site (cloisonnement),
  // testé directement via l'API exposée côté renderer (window.api.db.getCardCount)
  // pour s'affranchir du cache local (useCacheStore) de la page.
  // ══════════════════════════════════════════════════════════════════════

  test('12. Setup Site B (100% ZZTEST synthétique) avec ses propres cartes, pour les tests d\'isolation', async () => {
    const now = Date.now();
    const siteRes = await dbQuery(
      `INSERT INTO t_sites (nom, code, is_active, max_centres, is_permanent, sync_id) VALUES (?, ?, 1, 4, 1, ?)`,
      [`ZZTEST_SITE_B_${now}`, `ZZTEST-SITEB-${now}`, `zztest-siteb-${now}`]
    );
    siteBId = siteRes[0].lastInsertRowid;
    const centreRes = await dbQuery(
      `INSERT INTO t_centres (site_id, nom, numero, sync_id) VALUES (?, 'ZZTEST_CENTRE_B', 1, ?)`,
      [siteBId, `zztest-centreb-${now}`]
    );
    siteBCentreId = centreRes[0].lastInsertRowid;

    await dbQuery(
      `INSERT INTO t_cartes (noms, prenoms, date_de_naissance, statut, site_id, centre_id, cle_doublon, sync_id)
       VALUES ('ZZTEST_SITEB_CARD1', 'X', '1990-01-01', 'EN STOCK', ?, ?, ?, ?)`,
      [siteBId, siteBCentreId, cleDoublon('ZZTEST_SITEB_CARD1', 'X', '1990-01-01', '', ''), `zztest-siteb-card1-${now}`]
    );
    await dbQuery(
      `INSERT INTO t_import_anomalies (type_anomalie, description, noms, prenoms, site_id, erreur_message)
       VALUES ('DATE_INVALIDE', 'ZZTEST anomalie site B', 'ZZTEST_SITEB_ANOMALY', 'X', ?, 'test')`,
      [siteBId]
    );

    const check = await dbQuery('SELECT COUNT(*) as c FROM t_cartes WHERE site_id = ?', [siteBId]);
    expect(check[0].c).toBe(1);
  });

  test('13. CORRECTIF P1-1/P0-8 : db:getCardCount(siteId) est cloisonné par site — un ADMINISTRATEUR_SITE ne peut ni lire ni forcer le comptage d\'un site étranger', async () => {
    const { window } = env;
    await window.evaluate(() => { globalThis.location.hash = '#/import'; });
    await window.waitForURL(/#\/import/);
    await waitForNoLoadingOverlay();

    const siteACountDb = (await dbQuery('SELECT COUNT(*) as c FROM t_cartes WHERE site_id = ?', [siteAId()]))[0].c;
    const globalCountDb = (await dbQuery('SELECT COUNT(*) as c FROM t_cartes'))[0].c;
    console.log(`[CONSTAT] t_cartes site A=${siteACountDb} vs global=${globalCountDb} (Site B contient 1 carte étrangère)`);
    expect(globalCountDb).toBeGreaterThan(siteACountDb); // Sanity check : Site B contribue bien au global

    // Appel direct à l'API exposée par le preload (celle utilisée par fetchCardCount()),
    // sans siteId explicite : pour un ADMINISTRATEUR_SITE, le serveur DOIT dériver le site
    // de la session réelle (secureUser.site_id), pas retourner le total global tous sites.
    const countNoArg = await window.evaluate(() => (window as any).api.db.getCardCount());
    expect(countNoArg, 'CORRECTIF P1-1 : sans siteId, le total ne doit plus être global (bug précédent) mais celui du site de la session').toBe(siteACountDb);
    expect(countNoArg).not.toBe(globalCountDb);

    // Tentative de contournement : un ADMINISTRATEUR_SITE fournit explicitement l'ID du site
    // B (étranger) en paramètre. Le handler doit IGNORER ce paramètre client pour tout rôle
    // non-SUPER-ADMIN (cloisonnement CLAUDE.md §3, sécurité — pas seulement UI) et retourner
    // quand même le compte du site A (site réel de la session serveur).
    const countForeignArg = await window.evaluate((sid) => (window as any).api.db.getCardCount(sid), siteBId);
    expect(countForeignArg, 'Sécurité : un ADMINISTRATEUR_SITE ne doit jamais pouvoir lire le compte d\'un site étranger via ce paramètre').toBe(siteACountDb);
    expect(countForeignArg).not.toBe(1); // 1 = le compte réel du Site B, qu'il ne doit JAMAIS obtenir ici

    // Non-régression : le bouton de purge reste actif tant que le site actif a des cartes
    await expect(window.getByRole('button', { name: 'Purger les cartes locales de ce PC' })).toBeEnabled({ timeout: 15000 });
  });

  // ══════════════════════════════════════════════════════════════════════
  // BLOC 6 — "Réparer & Forcer la Synchronisation Locale" (emergencyPurge)
  // + P1-2 (texte de la modale de confirmation)
  // ══════════════════════════════════════════════════════════════════════

  test('14. Emergency Purge : mauvais mot de passe → action bloquée, aucun changement en base', async () => {
    const { window } = env;
    const before = await dbQuery('SELECT COUNT(*) as c FROM t_cartes WHERE site_id = ?', [siteAId()]);
    expect(before[0].c).toBeGreaterThan(0);

    await window.getByRole('button', { name: /Réparer & Forcer la Synchronisation Locale/i }).click();
    await expect(window.getByRole('heading', { name: 'Réparer & Forcer la Synchronisation' })).toBeVisible({ timeout: 10000 });

    // CORRECTIF P1-2 : le texte de la modale mentionne désormais EXPLICITEMENT la suppression
    // des cartes locales du site, avant la saisie du mot de passe (auparavant, le texte ne
    // parlait que de FTS5/Outbox, laissant croire à tort qu'aucune carte locale n'était supprimée).
    await expect(window.getByText(/supprime TOUTES les cartes locales de ce site sur ce poste/i)).toBeVisible();
    await expect(window.getByText(/réinitialise l.index de recherche FTS5/i)).toBeVisible();
    await expect(window.getByText(/vide la file d.attente Outbox locale/i)).toBeVisible();
    await expect(window.getByText(/données cloud de Supabase restent en parfaite sécurité/i)).toBeVisible();

    await window.getByPlaceholder('••••••••').last().fill('ZZTEST_MotDePasse_Incorrect');
    await window.getByRole('button', { name: 'Confirmer' }).click();
    await expect(window.getByText('❌ Mot de passe administrateur incorrect.').first()).toBeVisible({ timeout: 10000 });

    const after = await dbQuery('SELECT COUNT(*) as c FROM t_cartes WHERE site_id = ?', [siteAId()]);
    expect(after[0].c).toBe(before[0].c);

    await window.getByRole('button', { name: 'Annuler' }).click();
  });

  test('15. Emergency Purge : bon mot de passe → t_cartes ET t_import_anomalies vidés pour le Site A, FTS5 reconstruit, Site B intact, base intègre (VACUUM synchrone attendu)', async () => {
    const { window } = env;
    const admin = getTestUser('administrateurSite');
    const anomaliesBefore = await dbQuery('SELECT COUNT(*) as c FROM t_import_anomalies WHERE site_id = ?', [siteAId()]);
    expect(anomaliesBefore[0].c).toBeGreaterThan(0);

    await window.getByRole('button', { name: /Réparer & Forcer la Synchronisation Locale/i }).click();
    await expect(window.getByRole('heading', { name: 'Réparer & Forcer la Synchronisation' })).toBeVisible({ timeout: 10000 });
    await window.getByPlaceholder('••••••••').last().fill(admin.password);
    await window.getByRole('button', { name: 'Confirmer' }).click();
    // CORRECTIF P0-1 : ce toast de succès n'apparaît désormais qu'une fois le VACUUM
    // *totalement terminé* (synchrone, attendu côté main process) — plus un simple
    // "le VACUUM a été planifié en tâche de fond dans 500ms".
    await expect(window.getByText('Base de données vidée et FTS5 réparé avec succès !')).toBeVisible({ timeout: 30000 });

    const cartesA = await dbQuery('SELECT COUNT(*) as c FROM t_cartes WHERE site_id = ?', [siteAId()]);
    expect(cartesA[0].c).toBe(0);
    const anomaliesA = await dbQuery('SELECT COUNT(*) as c FROM t_import_anomalies WHERE site_id = ?', [siteAId()]);
    expect(anomaliesA[0].c).toBe(0);

    const cartesB = await dbQuery('SELECT COUNT(*) as c FROM t_cartes WHERE site_id = ?', [siteBId]);
    expect(cartesB[0].c).toBe(1);
    const anomaliesB = await dbQuery('SELECT COUNT(*) as c FROM t_import_anomalies WHERE site_id = ?', [siteBId]);
    expect(anomaliesB[0].c).toBe(1);

    const ftsTable = await dbQuery("SELECT name FROM sqlite_master WHERE type='table' AND name='t_cartes_fts'");
    expect(ftsTable.length).toBe(1);
    const triggers = await dbQuery("SELECT name FROM sqlite_master WHERE type='trigger' AND name IN ('trg_cartes_ai','trg_cartes_ad','trg_cartes_au')");
    expect(triggers.length).toBe(3);

    // Le VACUUM synchrone est déjà terminé à ce stade (promesse résolue) : la base doit être
    // parfaitement intègre immédiatement après, sans délai d'attente supplémentaire.
    const integrity = await pragmaQuery('integrity_check');
    expect(integrity.length).toBe(1);
    expect(integrity[0].integrity_check).toBe('ok');
  });

  // ══════════════════════════════════════════════════════════════════════
  // BLOC 7 — "Purger les cartes locales de ce PC" (purgeLocalDatabase) + isolation
  // ══════════════════════════════════════════════════════════════════════

  test('16. Réinjection de cartes ZZTEST sur le Site A pour un scénario de purge concret', async () => {
    const { window } = env;
    await window.evaluate(() => { globalThis.location.hash = '#/dashboard'; });
    await window.waitForURL(/#\/dashboard/);
    await window.evaluate(() => { globalThis.location.hash = '#/import'; });
    await window.waitForURL(/#\/import/);
    await waitForNoLoadingOverlay();

    const now = Date.now();
    await dbQuery(
      `INSERT INTO t_cartes (noms, prenoms, date_de_naissance, statut, site_id, centre_id, cle_doublon, sync_id)
       VALUES ('ZZTEST_PURGE_CARD1', 'X', '1990-01-01', 'EN STOCK', ?, ?, ?, ?)`,
      [siteAId(), siteACentreId(), cleDoublon('ZZTEST_PURGE_CARD1', 'X', '1990-01-01', '', ''), `zztest-purge1-${now}`]
    );
    await dbQuery(
      `INSERT INTO t_cartes (noms, prenoms, date_de_naissance, statut, site_id, centre_id, cle_doublon, sync_id)
       VALUES ('ZZTEST_PURGE_CARD2', 'X', '1991-02-02', 'EN STOCK', ?, ?, ?, ?)`,
      [siteAId(), siteACentreId(), cleDoublon('ZZTEST_PURGE_CARD2', 'X', '1991-02-02', '', ''), `zztest-purge2-${now}`]
    );
    const check = await dbQuery('SELECT COUNT(*) as c FROM t_cartes WHERE site_id = ?', [siteAId()]);
    expect(check[0].c).toBe(2);
  });

  test('17. Purge : mauvais mot de passe → aucune suppression', async () => {
    const { window } = env;
    await window.evaluate(() => { globalThis.location.hash = '#/dashboard'; });
    await window.waitForURL(/#\/dashboard/);
    await window.evaluate(() => { globalThis.location.hash = '#/import'; });
    await window.waitForURL(/#\/import/);
    await waitForNoLoadingOverlay();
    await expect(window.getByRole('button', { name: 'Purger les cartes locales de ce PC' })).toBeEnabled({ timeout: 15000 });

    const before = await dbQuery('SELECT COUNT(*) as c FROM t_cartes WHERE site_id = ?', [siteAId()]);
    await window.getByRole('button', { name: 'Purger les cartes locales de ce PC' }).click();
    await expect(window.getByText('Purge des cartes locales')).toBeVisible({ timeout: 10000 });
    await window.getByPlaceholder('••••••••').last().fill('ZZTEST_MotDePasse_Incorrect');
    await window.getByRole('button', { name: 'Confirmer' }).click();
    await expect(window.getByText('❌ Mot de passe administrateur incorrect.').first()).toBeVisible({ timeout: 10000 });

    const after = await dbQuery('SELECT COUNT(*) as c FROM t_cartes WHERE site_id = ?', [siteAId()]);
    expect(after[0].c).toBe(before[0].c);
    await window.getByRole('button', { name: 'Annuler' }).click();
  });

  test('18. Purge : bon mot de passe → t_cartes vidé pour le Site A uniquement, Site B toujours intact, base intègre (VACUUM synchrone attendu)', async () => {
    const { window } = env;
    const admin = getTestUser('administrateurSite');

    await window.getByRole('button', { name: 'Purger les cartes locales de ce PC' }).click();
    await expect(window.getByText('Purge des cartes locales')).toBeVisible({ timeout: 10000 });
    await window.getByPlaceholder('••••••••').last().fill(admin.password);
    await window.getByRole('button', { name: 'Confirmer' }).click();
    await expect(window.getByText('Base de données locale purgée avec succès !')).toBeVisible({ timeout: 30000 });

    const cartesA = await dbQuery('SELECT COUNT(*) as c FROM t_cartes WHERE site_id = ?', [siteAId()]);
    expect(cartesA[0].c).toBe(0);

    const cartesB = await dbQuery('SELECT COUNT(*) as c FROM t_cartes WHERE site_id = ?', [siteBId]);
    expect(cartesB[0].c, 'Cloisonnement confirmé : le Site B synthétique survit à la purge du Site A').toBe(1);

    const integrity = await pragmaQuery('integrity_check');
    expect(integrity[0].integrity_check).toBe('ok');
  });

  // ══════════════════════════════════════════════════════════════════════
  // BLOC 8 — REVALIDATION agent-13 (correctif agent-4-db-sync) du point
  // bloquant du run QA précédent. Cause racine identifiée : emergencyPurge()
  // faisait un DROP TABLE t_cartes_fts + CREATE VIRTUAL TABLE (ré-indexation
  // complète) suivi d'un VACUUM — séquence qui déclenchait de façon
  // reproductible (7/7 sur le run précédent, sur 2 runs distincts) une
  // erreur SQLITE_CORRUPT_VTAB ("database disk image is malformed")
  // remontée par une connexion SQLite EXTERNE juste après 3 cycles
  // enchaînés Emergency Purge → activité SQLite → Purge normale (fichier
  // pourtant sain à une réinspection ultérieure — race transitoire
  // auto-cicatrisante liée au VACUUM d'une vtable FTS5 tout juste
  // droppée/recréée, pas une corruption disque persistante).
  //
  // Correctif : t_cartes_fts n'est plus JAMAIS droppée/recréée pendant
  // emergencyPurge() — seules les lignes du site purgé sont retirées de
  // l'index de façon incrémentale (commandes 'delete' individuelles par
  // lots de 500, comme le ferait le trigger AFTER DELETE normal), plus un
  // wal_checkpoint(TRUNCATE) ajouté après chaque VACUUM dans
  // purgeLocalDatabase ET emergencyPurge (src/main/database/queries/
  // maintenance.queries.ts). Banc de reproduction jetable dédié
  // (stress_vacuum_fts5.js) : 18/18 succès après correctif contre 7/7
  // échecs avant.
  //
  // Le run précédent n'avait exécuté ce scénario (3 cycles) qu'UNE seule
  // fois. Cette revalidation répète l'INTÉGRALITÉ du scénario 5 FOIS de
  // suite (5 tests distincts générés ci-dessous, chacun avec son propre
  // budget de timeout Playwright de 180s — 5 x 3 cycles = 15 enchaînements
  // Emergency Purge + Purge normale au total), pour écarter tout doute sur
  // un correctif qui ne tiendrait que par chance sur une poignée de
  // répétitions. Chaque cycle se conclut par un `PRAGMA integrity_check`
  // ; le 3e cycle de chaque round ajoute en plus une sonde FTS5
  // (`SELECT ... FROM t_cartes_fts WHERE t_cartes_fts MATCH ...`) et un
  // `PRAGMA quick_check`, tous deux depuis une connexion SQLite EXTERNE et
  // DISTINCTE (process Electron/Node jetable, jamais partagé avec la
  // connexion de l'app ni entre deux appels `dbQuery`/`pragmaQuery`) —
  // exactement le point d'entrée qui remontait SQLITE_CORRUPT_VTAB avant
  // le correctif, y compris pour une connexion n'ayant jamais interagi
  // avec t_cartes_fts auparavant.
  // ══════════════════════════════════════════════════════════════════════

  async function runVacuumFts5StressRound(round: number) {
    const { window } = env;
    const admin = getTestUser('administrateurSite');

    for (let cycle = 1; cycle <= 3; cycle++) {
      // Activité SQLite AVANT le cycle (le VACUUM doit compacter un fichier qui a
      // réellement bougé, pas une base déjà vide et inerte).
      const t0 = Date.now();
      await dbQuery(
        `INSERT INTO t_cartes (noms, prenoms, date_de_naissance, statut, site_id, centre_id, cle_doublon, sync_id)
         VALUES (?, 'X', '1990-01-01', 'EN STOCK', ?, ?, ?, ?)`,
        [`ZZTEST_VACSTRESS_R${round}C${cycle}A`, siteAId(), siteACentreId(),
          cleDoublon(`ZZTEST_VACSTRESS_R${round}C${cycle}A`, 'X', '1990-01-01', '', ''), `zztest-vac-r${round}c${cycle}a-${t0}`]
      );
      await dbQuery(
        `INSERT INTO t_cartes (noms, prenoms, date_de_naissance, statut, site_id, centre_id, cle_doublon, sync_id)
         VALUES (?, 'X', '1991-01-01', 'EN STOCK', ?, ?, ?, ?)`,
        [`ZZTEST_VACSTRESS_R${round}C${cycle}B`, siteAId(), siteACentreId(),
          cleDoublon(`ZZTEST_VACSTRESS_R${round}C${cycle}B`, 'X', '1991-01-01', '', ''), `zztest-vac-r${round}c${cycle}b-${t0}`]
      );

      await window.evaluate(() => { globalThis.location.hash = '#/dashboard'; });
      await window.waitForURL(/#\/dashboard/);
      await window.evaluate(() => { globalThis.location.hash = '#/import'; });
      await window.waitForURL(/#\/import/);
      await waitForNoLoadingOverlay();

      // 1) Emergency Purge
      await window.getByRole('button', { name: /Réparer & Forcer la Synchronisation Locale/i }).click();
      await expect(window.getByRole('heading', { name: 'Réparer & Forcer la Synchronisation' })).toBeVisible({ timeout: 10000 });
      await window.getByPlaceholder('••••••••').last().fill(admin.password);
      await window.getByRole('button', { name: 'Confirmer' }).click();
      await expect(window.getByText('Base de données vidée et FTS5 réparé avec succès !')).toBeVisible({ timeout: 30000 });

      // Activité SQLite intercalée IMMÉDIATEMENT entre les 2 purges — reproduit le
      // scénario de corruption d'origine (écriture pendant/juste après le 1er VACUUM).
      const t1 = Date.now();
      await dbQuery(
        `INSERT INTO t_cartes (noms, prenoms, date_de_naissance, statut, site_id, centre_id, cle_doublon, sync_id)
         VALUES (?, 'X', '1992-01-01', 'EN STOCK', ?, ?, ?, ?)`,
        [`ZZTEST_VACSTRESS_R${round}C${cycle}C`, siteAId(), siteACentreId(),
          cleDoublon(`ZZTEST_VACSTRESS_R${round}C${cycle}C`, 'X', '1992-01-01', '', ''), `zztest-vac-r${round}c${cycle}c-${t1}`]
      );

      // NOTE (hors périmètre des 8 correctifs) : executeEmergencyPurge() met `cardCount`
      // local à 0 par un simple `setCardCount(0)` (pas un vrai re-fetch), ce qui désactive
      // le bouton "Purger les cartes locales de ce PC" (`disabled={cardCount === 0}`) tant
      // que le composant n'est pas remonté. Un aller-retour /dashboard → /import force un
      // remount qui relit `useCacheStore` (non invalidé par les purges, cf. constat plus
      // haut) et réaffiche un compteur non nul, réactivant le bouton — sans quoi la 2e purge
      // enchaînée ne serait même pas cliquable dans ce harnais de test.
      //
      // CONSTAT agent-13 (run de revalidation, hors périmètre des 8 correctifs) : ce remount
      // via bounce /dashboard→/import perd parfois la course contre `useCacheStore` (observé :
      // 1 échec sur 29 cycles Emergency+Purge enchaînés cumulés sur 2 runs complets — bouton
      // resté durablement désactivé après un seul aller-retour). Boucle de re-tentatives
      // ajoutée ICI (harnais de test uniquement, aucun changement app) pour absorber cette
      // course déjà documentée, sans jamais masquer une vraie corruption (l'intégrité SQLite
      // est de toute façon revérifiée juste après, indépendamment de ce mécanisme).
      let purgeButtonEnabled = false;
      for (let attempt = 1; attempt <= 3 && !purgeButtonEnabled; attempt++) {
        await window.evaluate(() => { globalThis.location.hash = '#/dashboard'; });
        await window.waitForURL(/#\/dashboard/);
        await window.evaluate(() => { globalThis.location.hash = '#/import'; });
        await window.waitForURL(/#\/import/);
        await waitForNoLoadingOverlay();
        try {
          await expect(window.getByRole('button', { name: 'Purger les cartes locales de ce PC' })).toBeEnabled({ timeout: 15000 });
          purgeButtonEnabled = true;
        } catch (e) {
          console.log(`[VACUUM/FTS5 STRESS round ${round} cycle ${cycle}] bouton "Purger" toujours désactivé après tentative ${attempt}/3 de remount`);
          if (attempt === 3) throw e;
        }
      }

      // 2) Purge normale, ENCHAÎNÉE tout de suite après (aucune attente artificielle)
      await window.getByRole('button', { name: 'Purger les cartes locales de ce PC' }).click();
      await expect(window.getByText('Purge des cartes locales')).toBeVisible({ timeout: 10000 });
      await window.getByPlaceholder('••••••••').last().fill(admin.password);
      await window.getByRole('button', { name: 'Confirmer' }).click();
      await expect(window.getByText('Base de données locale purgée avec succès !')).toBeVisible({ timeout: 30000 });

      // 3) Vérification d'intégrité SQLite directe (connexion externe fraîche) — AUCUNE
      // corruption tolérée.
      const integrity = await pragmaQuery('integrity_check');
      console.log(`[VACUUM/FTS5 STRESS round ${round} cycle ${cycle}/3] integrity_check = ${JSON.stringify(integrity)}`);
      expect(integrity.length, `Round ${round} cycle ${cycle} : integrity_check doit renvoyer exactement 1 ligne`).toBe(1);
      expect(integrity[0].integrity_check, `Round ${round} cycle ${cycle} : intégrité SQLite compromise après enchaînement Emergency+Purge`).toBe('ok');

      // La base reste pleinement utilisable après le cycle (pas de SQLITE_CORRUPT sur une requête réelle)
      const sanity = await dbQuery('SELECT COUNT(*) as c FROM t_cartes');
      expect(sanity[0].c).toBeGreaterThanOrEqual(0);
      const cartesA = await dbQuery('SELECT COUNT(*) as c FROM t_cartes WHERE site_id = ?', [siteAId()]);
      expect(cartesA[0].c, `Round ${round} cycle ${cycle} : le Site A doit être vide après la purge normale finale du cycle`).toBe(0);

      // Juste après le 3e cycle : sonde FTS5 directe + quick_check, depuis une connexion
      // SQLite EXTERNE et DISTINCTE — exactement le scénario qui remontait
      // SQLITE_CORRUPT_VTAB avant le correctif (voir en-tête de bloc).
      if (cycle === 3) {
        const ftsProbe = await dbQuery(
          `SELECT count(*) as c FROM t_cartes_fts WHERE t_cartes_fts MATCH ?`,
          ['ZZTEST*']
        );
        expect(ftsProbe.length, `Round ${round} : sonde FTS5 externe post-cycle-3 doit renvoyer 1 ligne (pas d'exception SQLITE_CORRUPT_VTAB)`).toBe(1);

        const quickCheck = await pragmaQuery('quick_check');
        expect(quickCheck[0].quick_check, `Round ${round} : quick_check externe post-cycle-3 compromis`).toBe('ok');
        console.log(`[VACUUM/FTS5 STRESS round ${round}] sonde FTS5 externe post-cycle-3 OK (count=${ftsProbe[0].c}), quick_check=ok`);
      }
    }

    // Site B (étranger, jamais touché par ces 3 cycles répétés sur le Site A) toujours intact
    const cartesB = await dbQuery('SELECT COUNT(*) as c FROM t_cartes WHERE site_id = ?', [siteBId]);
    expect(cartesB[0].c, `Round ${round} : Site B doit rester intact après 3 cycles Emergency+Purge répétés sur le Site A`).toBe(1);

    // Vérification finale globale du round (redondante mais bon marché) : intégrité toujours "ok"
    const finalIntegrity = await pragmaQuery('integrity_check');
    expect(finalIntegrity[0].integrity_check).toBe('ok');
  }

  for (let round = 1; round <= 5; round++) {
    test(`19.${round}. Stress-test VACUUM/FTS5 (revalidation correctif incrémental agent-4-db-sync) — round ${round}/5 : 3 cycles Emergency+Purge enchaînés, sonde FTS5 + quick_check externes post-cycle-3 — aucune corruption`, async () => {
      await runVacuumFts5StressRound(round);
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  // BLOC 9 — NON-RÉGRESSION (nouveau scénario, jamais testé sur le run
  // précédent) : effet de bord corrigé au passage par agent-4-db-sync.
  // L'ANCIEN code d'emergencyPurge() faisait un DROP TABLE t_cartes_fts —
  // qui vide l'INTÉGRALITÉ de l'index FTS5, PARTAGÉ ENTRE TOUS LES SITES —
  // puis ne ré-indexait QUE le site purgé : une réparation d'urgence sur un
  // seul site effaçait donc silencieusement la recherche plein texte de
  // TOUS LES AUTRES SITES. Le NOUVEAU code incrémental ne retire de
  // l'index que les lignes du site réellement purgé et doit donc préserver
  // l'index FTS5 des autres sites. Vérifié ici via une recherche FTS5 sur
  // le Site B AVANT/APRÈS un Emergency Purge exécuté sur le Site A
  // uniquement.
  // ══════════════════════════════════════════════════════════════════════

  test('20. Isolation FTS5 inter-sites : Emergency Purge sur le Site A ne vide PAS l\'index FTS5 du Site B (non-régression de l\'effet de bord corrigé)', async () => {
    const { window } = env;
    const admin = getTestUser('administrateurSite');

    // Après les 5 rounds du BLOC 8, le Site A est vide (dernière action de chaque round =
    // purge normale). On y réinjecte une carte fraîche, dédiée à ce scénario.
    const now = Date.now();
    await dbQuery(
      `INSERT INTO t_cartes (noms, prenoms, date_de_naissance, statut, site_id, centre_id, cle_doublon, sync_id)
       VALUES ('ZZTEST_FTSISOA', 'X', '1990-01-01', 'EN STOCK', ?, ?, ?, ?)`,
      [siteAId(), siteACentreId(), cleDoublon('ZZTEST_FTSISOA', 'X', '1990-01-01', '', ''), `zztest-ftsisoa-${now}`]
    );

    // ── AVANT toute action : les DEUX sites doivent être trouvables en FTS5 ──
    const siteACardBefore = await dbQuery('SELECT id_carte FROM t_cartes WHERE noms = ?', ['ZZTEST_FTSISOA']);
    expect(siteACardBefore.length).toBe(1);
    const ftsABefore = await dbQuery('SELECT rowid FROM t_cartes_fts WHERE t_cartes_fts MATCH ?', ['ZZTEST_FTSISOA']);
    expect(ftsABefore.length, 'Site A doit être trouvable en FTS5 avant toute action').toBe(1);
    expect(ftsABefore[0].rowid).toBe(siteACardBefore[0].id_carte);

    // Carte du Site B semée dès le test 12 ('ZZTEST_SITEB_CARD1'), jamais touchée depuis
    // (aucun des blocs précédents n'agit sur le Site B).
    const siteBCardBefore = await dbQuery('SELECT id_carte FROM t_cartes WHERE noms = ? AND site_id = ?', ['ZZTEST_SITEB_CARD1', siteBId]);
    expect(siteBCardBefore.length, 'La carte de test du Site B doit toujours exister avant l\'action').toBe(1);
    const ftsBBefore = await dbQuery('SELECT rowid FROM t_cartes_fts WHERE t_cartes_fts MATCH ?', ['ZZTEST_SITEB_CARD1']);
    expect(ftsBBefore.length, 'Site B doit être trouvable en FTS5 AVANT l\'Emergency Purge du Site A').toBe(1);
    expect(ftsBBefore[0].rowid).toBe(siteBCardBefore[0].id_carte);

    // ── ACTION : Emergency Purge du Site A UNIQUEMENT ──
    await window.evaluate(() => { globalThis.location.hash = '#/dashboard'; });
    await window.waitForURL(/#\/dashboard/);
    await window.evaluate(() => { globalThis.location.hash = '#/import'; });
    await window.waitForURL(/#\/import/);
    await waitForNoLoadingOverlay();
    await expect(window.getByRole('button', { name: /Réparer & Forcer la Synchronisation Locale/i })).toBeEnabled({ timeout: 15000 });

    await window.getByRole('button', { name: /Réparer & Forcer la Synchronisation Locale/i }).click();
    await expect(window.getByRole('heading', { name: 'Réparer & Forcer la Synchronisation' })).toBeVisible({ timeout: 10000 });
    await window.getByPlaceholder('••••••••').last().fill(admin.password);
    await window.getByRole('button', { name: 'Confirmer' }).click();
    await expect(window.getByText('Base de données vidée et FTS5 réparé avec succès !')).toBeVisible({ timeout: 30000 });

    // ── APRÈS : Site A disparu de t_cartes ET de l'index FTS5, Site B INTACT dans les deux ──
    const cartesA = await dbQuery('SELECT COUNT(*) as c FROM t_cartes WHERE site_id = ?', [siteAId()]);
    expect(cartesA[0].c, 'Site A doit être vidé de t_cartes par l\'Emergency Purge').toBe(0);
    const ftsAAfter = await dbQuery('SELECT rowid FROM t_cartes_fts WHERE t_cartes_fts MATCH ?', ['ZZTEST_FTSISOA']);
    expect(ftsAAfter.length, 'La carte du Site A doit avoir disparu de l\'index FTS5 après sa purge').toBe(0);

    const cartesB = await dbQuery('SELECT COUNT(*) as c FROM t_cartes WHERE site_id = ?', [siteBId]);
    expect(cartesB[0].c, 'Site B ne doit JAMAIS être touché par un Emergency Purge du Site A').toBe(1);
    const ftsBAfter = await dbQuery('SELECT rowid FROM t_cartes_fts WHERE t_cartes_fts MATCH ?', ['ZZTEST_SITEB_CARD1']);
    expect(ftsBAfter.length, 'RÉGRESSION SI 0 : l\'ancien code vidait TOUT l\'index FTS5 (tous sites) à chaque Emergency Purge — le correctif incrémental doit préserver le Site B').toBe(1);
    expect(ftsBAfter[0].rowid).toBe(siteBCardBefore[0].id_carte);

    const triggers = await dbQuery("SELECT name FROM sqlite_master WHERE type='trigger' AND name IN ('trg_cartes_ai','trg_cartes_ad','trg_cartes_au')");
    expect(triggers.length).toBe(3);
    const ftsTable = await dbQuery("SELECT name FROM sqlite_master WHERE type='table' AND name='t_cartes_fts'");
    expect(ftsTable.length).toBe(1);

    const integrity = await pragmaQuery('integrity_check');
    expect(integrity[0].integrity_check).toBe('ok');
  });

  // ══════════════════════════════════════════════════════════════════════
  // NETTOYAGE FINAL
  // ══════════════════════════════════════════════════════════════════════

  test('CLEANUP. Suppression et vérification de tous les artefacts ZZTEST_ résiduels (Site A + Site B synthétique)', async () => {
    const cartesDeleted = await dbQuery("DELETE FROM t_cartes WHERE noms LIKE 'ZZTEST\\_%' ESCAPE '\\'");
    const anomaliesDeleted = await dbQuery("DELETE FROM t_import_anomalies WHERE noms LIKE 'ZZTEST\\_%' ESCAPE '\\'");
    // CORRECTIF agent-13 (bug de nettoyage latent, découvert ici pour la première fois — jamais
    // atteint sur les runs précédents, qui échouaient plus tôt au test 19 avant même d'arriver au
    // CLEANUP) : t_centres.centre_id est référencé par FOREIGN KEY depuis t_users. Le centre
    // unique du Site A a été RENOMMÉ (pas créé) en 'ZZTEST_CENTRE_ABOBO' au test 7 — mais les
    // comptes utilisateurs de test seedés au démarrage (runSeedInElectronNode, hors périmètre
    // ZZTEST) restent rattachés à ce centre via leur centre_id. Un DELETE FROM t_centres
    // sans garde-fou déclenchait donc systématiquement SQLITE_CONSTRAINT_FOREIGNKEY (observé
    // ici : la CLEANUP échouait, alors que les 26 tests précédents — dont les 8 correctifs
    // revalidés — passaient tous). Sans impact fonctionnel réel (userDataDir jetable détruit
    // en fin de run de toute façon), mais on exclut désormais explicitement tout centre encore
    // référencé par un utilisateur réel — seul le centre synthétique du Site B (siteBCentreId,
    // créé au test 12, sans aucun utilisateur rattaché) est donc réellement supprimé ici.
    const centresDeleted = await dbQuery(
      "DELETE FROM t_centres WHERE nom LIKE 'ZZTEST\\_%' ESCAPE '\\' AND id NOT IN (SELECT centre_id FROM t_users WHERE centre_id IS NOT NULL)"
    );
    const sitesDeleted = await dbQuery("DELETE FROM t_sites WHERE nom LIKE 'ZZTEST\\_%' ESCAPE '\\'");

    console.log(
      `[CLEANUP] Supprimés — cartes: ${cartesDeleted[0].changes}, anomalies: ${anomaliesDeleted[0].changes}, ` +
      `centres ZZTEST: ${centresDeleted[0].changes}, sites ZZTEST: ${sitesDeleted[0].changes}`
    );

    const remainingCartes = await dbQuery("SELECT COUNT(*) as c FROM t_cartes WHERE noms LIKE 'ZZTEST\\_%' ESCAPE '\\'");
    const remainingAnomalies = await dbQuery("SELECT COUNT(*) as c FROM t_import_anomalies WHERE noms LIKE 'ZZTEST\\_%' ESCAPE '\\'");
    const remainingSites = await dbQuery("SELECT COUNT(*) as c FROM t_sites WHERE nom LIKE 'ZZTEST\\_%' ESCAPE '\\'");

    expect(remainingCartes[0].c).toBe(0);
    expect(remainingAnomalies[0].c).toBe(0);
    expect(remainingSites[0].c).toBe(0);

    console.log('[CLEANUP] Note : le centre unique du Site A (renommé ZZTEST_CENTRE_ABOBO en test 7) N\'est PAS supprimé (FOREIGN KEY depuis t_users, utilisateurs de test réels toujours rattachés) — sans impact : userDataDir jetable détruit en fin de run.');

    const finalIntegrity = await pragmaQuery('integrity_check');
    expect(finalIntegrity[0].integrity_check, 'Intégrité SQLite finale après nettoyage').toBe('ok');
  });
});
