/**
 * e2e/specs/_agent13_niveau2_numsecu_reimport.e2e.spec.ts
 *
 * QA Terrain (agent-13) — Vérification vivante du "Niveau 2" du plan de
 * complétion des cartes via réimport (src/main/workers/import-worker.js,
 * cf. C:\Users\EBYCHOCO\.claude\plans\actuellement-tout-fonctionne-bien-peppy-puppy.md).
 *
 * Objectif : quand une ligne réimportée ne matche plus une carte existante via
 * cle_doublon (un des 5 champs clés était vide et vient d'être renseigné),
 * une correspondance de secours via num_secu (13 chiffres, unique des deux
 * côtés sur le site) doit rattacher automatiquement la ligne à la bonne carte
 * et compléter ses champs vides — sans jamais créer de doublon, sans jamais
 * écraser une valeur déjà réelle, sans jamais toucher au statut.
 *
 * Isolation : instance Electron isolée sur un userDataDir jetable
 * (e2e/fixtures/electron-app.ts + seed-runner.ts), données 100% synthétiques
 * préfixées ZZTEST_, nettoyées en fin de run avec vérification SQL explicite.
 * Import réel piloté via l'écran Administrateur de Site (/import).
 */
import { test, expect } from '@playwright/test';
import { launchSeededApp, teardownSeededApp, type E2EEnvironment } from '../fixtures/electron-app';
import { getTestUser } from '../fixtures/test-users';
import { writeFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

test.describe.serial('QA Terrain — Niveau 2 (correspondance de secours num_secu) réimport (agent-13)', () => {
  let env: E2EEnvironment;
  let anyTestFailed = false;

  const siteAId = () => env.seed.siteId;
  const siteACentreId = () => env.seed.centreId;

  // Capture du stdout du process Electron principal — les console.log() du Worker Thread
  // d'import (import-worker.js, logs "[CSV WORKER]"/"[FUSION DIAGNOSTIC]"/"[IMPORT DIAGNOSTIC]")
  // remontent au stdout du process Node hôte (main process Electron), lui-même exposé par
  // Playwright via `app.process().stdout`.
  let mainProcessOutput = '';

  test.beforeAll(async () => {
    env = await launchSeededApp();
    const proc = env.app.process();
    proc.stdout?.on('data', (chunk) => { mainProcessOutput += chunk.toString(); });
    proc.stderr?.on('data', (chunk) => { mainProcessOutput += chunk.toString(); });
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

  // ── Helper SQL direct (pattern repris de import-centre-migration-qa-terrain.e2e.spec.ts) ──
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

  async function readValueAfterLabel(label: string): Promise<string> {
    const { window } = env;
    const locator = window.locator('p', { hasText: label }).locator('xpath=following-sibling::p[1]');
    return (await locator.first().innerText()).trim();
  }

  // Attente défensive contre l'overlay global bloquant "Chargement sécurisé en cours..."
  // (constat documenté dans import-centre-migration-qa-terrain.e2e.spec.ts, hors périmètre ici).
  async function waitForNoLoadingOverlay(timeout = 60000) {
    const { window } = env;
    await expect(window.getByText('Chargement sécurisé en cours...')).toHaveCount(0, { timeout });
  }

  const tmpDir = mkdtempSync(join(tmpdir(), 'gest-in-situ-qa-niveau2-'));
  const csvAPath = join(tmpDir, 'zztest_niveau2_fichierA.csv');
  const csvBPath = join(tmpDir, 'zztest_niveau2_fichierB.csv');

  const NUM_SECU_1 = '1234567890123'; // Carte #1 — cas nominal Niveau 2
  const NUM_SECU_2 = '9876543210987'; // Carte témoin #2 — chemin normal (cle_doublon)
  const NUM_SECU_SHARED = '1111111111111'; // Cartes #3/#4 — ambiguïté volontaire

  const consoleErrors: string[] = [];

  test('0. Login ADMINISTRATEUR_SITE + écoute des erreurs console pour toute la session', async () => {
    const { window } = env;
    window.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    window.on('pageerror', (err) => consoleErrors.push(String(err)));

    const admin = getTestUser('administrateurSite');
    await window.waitForURL(/#\/login/);
    await window.getByTestId('login-input').fill(admin.login);
    await window.getByTestId('password-input').fill(admin.password);
    await window.getByTestId('login-submit').click();
    await window.waitForURL(/#\/dashboard/, { timeout: 20000 });
    await waitForNoLoadingOverlay();

    // Renomme le centre (évite la modale garde-fou "Personnalisation du Centre Requise",
    // hors-périmètre de ce test) pour un import direct sans détour.
    await dbQuery(`UPDATE t_centres SET nom = 'ZZTEST_CENTRE_NIVEAU2' WHERE id = ?`, [siteACentreId()]);
  });

  // ══════════════════════════════════════════════════════════════════════
  // PREMIER IMPORT (fichier A)
  // ══════════════════════════════════════════════════════════════════════

  test('1. Préparation + import du fichier A (4 cartes : #1 cas nominal, #2 témoin, #3/#4 num_secu partagé)', async () => {
    const { window } = env;
    const lines = [
      'NOMS;PRENOMS;DATE DE NAISSANCE;NUM SECU;LIEU DE NAISSANCE;CONTACT;LIEU ENROLEMENT;RANGEMENT;STATUT;DATE DELIVRANCE',
      // #1 — cible Niveau 2 : noms/prenoms/lieu/contact vides, MAIS date de naissance valide
      // (constat empirique agent-13 : import-worker.js rejette intégralement toute ligne dont
      // isValidDate(ddn) est faux — lignes 741-748 — donc une date de naissance VRAIMENT vide
      // ne peut jamais produire de fiche en t_cartes via CSV, quelle que soit la cause invoquée
      // par le scénario. Ce champ est donc renseigné ici avec une date-placeholder distincte
      // de celle du fichier B, ce qui permet en prime de vérifier la garantie "jamais écraser
      // une valeur déjà réelle, même différente" spécifiquement sur date_de_naissance).
      `;;2000-01-01;${NUM_SECU_1};;;ZZTEST_ENROL1;ZZTEST_RANG1;EN STOCK;`,
      // #2 — témoin déjà complet
      `ZZTEST_N2_TEMOIN;STANDARD;1990-01-01;${NUM_SECU_2};ABOBO;0102030401;ZZTEST_ENROL2;ZZTEST_RANG2;EN STOCK;`,
      // #3/#4 — num_secu partagé, noms/prenoms/lieu/contact vides des deux côtés (ambiguïté
      // volontaire), dates de naissance distinctes (même contrainte de validité que #1 ci-dessus ;
      // une valeur distincte entre les 2 lignes évite aussi la dédup intra-fichier sur cle_doublon).
      `;;1900-01-01;${NUM_SECU_SHARED};;;ZZTEST_ENROL3;ZZTEST_RANG3;EN STOCK;`,
      `;;1900-01-02;${NUM_SECU_SHARED};;;ZZTEST_ENROL4;ZZTEST_RANG4;EN STOCK;`
    ];
    writeFileSync(csvAPath, lines.join('\n'), 'utf-8');

    await window.evaluate(() => { globalThis.location.hash = '#/import'; });
    await window.waitForURL(/#\/import/);
    await waitForNoLoadingOverlay();

    await mockOpenDialogOnce(csvAPath);
    try {
      await window.getByRole('button', { name: /Sélectionner le Listing/i }).click();
      await expect(window.getByText('4 lignes détectées').first()).toBeVisible({ timeout: 10000 });
    } finally {
      await restoreOpenDialog();
    }

    await window.getByRole('button', { name: "Lancer l'Importation" }).click();
    await expect(window.getByText('Personnalisation du Centre Requise')).toHaveCount(0);
    await expect(window.getByText('Configuration des Centres')).toBeVisible({ timeout: 10000 });
    await window.getByRole('button', { name: "Poursuivre l'import" }).click();
    // Fiabilisation (constat empirique agent-13) : avec un fichier aussi petit (4 lignes),
    // l'overlay "Importation en cours..." peut apparaître puis disparaître plus vite que la
    // fenêtre de poll par défaut de Playwright — ce n'est pas un bug applicatif, juste une
    // course sans rapport avec le scénario Niveau 2 testé ici. On ne vérifie donc plus cet état
    // transitoire et on attend directement l'état final "Bilan de Migration".
    await window.evaluate(() => window.dispatchEvent(new Event('app:focus-restored')));
    await expect(window.getByText('Bilan de Migration')).toBeVisible({ timeout: 60000 });
  });

  test('2. Vérification base après import A : 4 cartes présentes avec les états attendus', async () => {
    const rows = await dbQuery(
      `SELECT id_carte, noms, prenoms, date_de_naissance, lieu_de_naissance, contact, num_secu, cle_doublon, statut FROM t_cartes WHERE site_id = ? AND num_secu IN (?,?,?) ORDER BY num_secu, id_carte`,
      [siteAId(), NUM_SECU_1, NUM_SECU_2, NUM_SECU_SHARED]
    );
    console.log('[CONSTAT] Cartes après import A:', JSON.stringify(rows));

    const card1 = rows.filter((r) => r.num_secu === NUM_SECU_1);
    expect(card1.length, 'Carte #1 (noms/prenoms/lieu/contact vides, num_secu unique) doit exister').toBe(1);
    expect(card1[0].statut).toBe('EN STOCK');
    expect(card1[0].date_de_naissance, 'Date de naissance placeholder bien enregistrée').toBe('2000-01-01');
    expect(card1[0].noms).toBe('');
    expect(card1[0].lieu_de_naissance).toBe('');
    expect(card1[0].contact).toBe('');

    const card2 = rows.filter((r) => r.num_secu === NUM_SECU_2);
    expect(card2.length, 'Carte témoin #2 doit exister').toBe(1);
    expect(card2[0].noms).toBe('ZZTEST_N2_TEMOIN');

    const sharedCards = rows.filter((r) => r.num_secu === NUM_SECU_SHARED);
    expect(sharedCards.length, 'Les 2 cartes à num_secu partagé doivent toutes deux exister').toBe(2);
  });

  test('3. Marquage direct en base de la carte #1 comme DELIVRE (simulateur de travail terrain)', async () => {
    const card1Before = await dbQuery(`SELECT id_carte FROM t_cartes WHERE site_id = ? AND num_secu = ?`, [siteAId(), NUM_SECU_1]);
    expect(card1Before.length).toBe(1);
    const id1 = card1Before[0].id_carte;

    await dbQuery(
      `UPDATE t_cartes SET statut = 'DELIVRE', nom_retirant = 'ZZTEST_RETIRANT_TERRAIN', is_dirty = 0 WHERE id_carte = ?`,
      [id1]
    );
    const check = await dbQuery(`SELECT statut, nom_retirant FROM t_cartes WHERE id_carte = ?`, [id1]);
    expect(check[0].statut).toBe('DELIVRE');
    expect(check[0].nom_retirant).toBe('ZZTEST_RETIRANT_TERRAIN');
  });

  // ══════════════════════════════════════════════════════════════════════
  // DEUXIÈME IMPORT (fichier B — corrigé)
  // ══════════════════════════════════════════════════════════════════════

  test('4. Préparation + import du fichier B (corrigé)', async () => {
    const { window } = env;
    const lines = [
      'NOMS;PRENOMS;DATE DE NAISSANCE;NUM SECU;LIEU DE NAISSANCE;CONTACT;LIEU ENROLEMENT;RANGEMENT;STATUT;DATE DELIVRANCE',
      // #1 — même num_secu, désormais tous les champs clés renseignés
      `ZZTEST_N2_CIBLE;STANDARD;1985-05-05;${NUM_SECU_1};YOPOUGON;0708091011;ZZTEST_ENROL1B;ZZTEST_RANG1B;EN STOCK;`,
      // #2 — mêmes 5 champs clés que A (matche via cle_doublon, chemin normal), num_secu identique
      `ZZTEST_N2_TEMOIN;STANDARD;1990-01-01;${NUM_SECU_2};ABOBO;0102030401;ZZTEST_ENROL2B;ZZTEST_RANG2B;EN STOCK;`,
      // #3/#4 — même num_secu partagé, mais désormais noms/prénoms différenciés et réels
      `ZZTEST_N2_PARTAGE_A;ALPHA;1980-01-01;${NUM_SECU_SHARED};ABOBO;0102030001;ZZTEST_ENROL3B;ZZTEST_RANG3B;EN STOCK;`,
      `ZZTEST_N2_PARTAGE_B;BETA;1981-02-02;${NUM_SECU_SHARED};ABOBO;0102030002;ZZTEST_ENROL4B;ZZTEST_RANG4B;EN STOCK;`
    ];
    writeFileSync(csvBPath, lines.join('\n'), 'utf-8');

    await window.getByRole('button', { name: 'Nouvelle Migration' }).click();
    await expect(window.getByText('Prêt pour la migration ?')).toBeVisible({ timeout: 10000 });

    await mockOpenDialogOnce(csvBPath);
    try {
      await window.getByRole('button', { name: /Sélectionner le Listing/i }).click();
      await expect(window.getByText('4 lignes détectées').first()).toBeVisible({ timeout: 10000 });
    } finally {
      await restoreOpenDialog();
    }

    await window.getByRole('button', { name: "Lancer l'Importation" }).click();
    await expect(window.getByText('Configuration des Centres')).toBeVisible({ timeout: 10000 });
    await window.getByRole('button', { name: "Poursuivre l'import" }).click();
    // Fiabilisation (constat empirique agent-13) : avec un fichier aussi petit (4 lignes),
    // l'overlay "Importation en cours..." peut apparaître puis disparaître plus vite que la
    // fenêtre de poll par défaut de Playwright — ce n'est pas un bug applicatif, juste une
    // course sans rapport avec le scénario Niveau 2 testé ici. On ne vérifie donc plus cet état
    // transitoire et on attend directement l'état final "Bilan de Migration".
    await window.evaluate(() => window.dispatchEvent(new Event('app:focus-restored')));
    await expect(window.getByText('Bilan de Migration')).toBeVisible({ timeout: 60000 });
  });

  test('5. Carte #1 : fusion Niveau 2 correcte (champs complétés, cle_doublon recalculé, statut/nom_retirant protégés, is_dirty=1, outbox créé, pas de doublon)', async () => {
    const cards = await dbQuery(`SELECT * FROM t_cartes WHERE site_id = ? AND num_secu = ?`, [siteAId(), NUM_SECU_1]);
    console.log('[CONSTAT] Carte #1 après réimport B:', JSON.stringify(cards));
    expect(cards.length, 'Aucun doublon ne doit être créé pour la carte #1').toBe(1);

    const c = cards[0];
    expect(c.noms).toBe('ZZTEST_N2_CIBLE');
    expect(c.prenoms).toBe('STANDARD');
    // date_de_naissance était DÉJÀ réellement renseignée (2000-01-01, posée par le fichier A) —
    // le fichier B apporte une valeur DIFFÉRENTE (1985-05-05) qui ne doit JAMAIS écraser une
    // valeur déjà réelle, même si elle diffère du fichier réimporté (garantie explicite du plan).
    expect(c.date_de_naissance, 'date_de_naissance déjà réelle ne doit jamais être écrasée, même par une valeur différente du fichier réimporté').toBe('2000-01-01');
    expect(c.lieu_de_naissance).toBe('YOPOUGON');
    expect(c.contact).toBe('0708091011');

    expect(c.cle_doublon, 'cle_doublon doit être recalculé avec les nouvelles valeurs, en conservant la date de naissance déjà réelle (2000-01-01, pas celle du fichier B)').toBe('ZZTEST_N2_CIBLE|STANDARD|2000-01-01|YOPOUGON|0708091011');

    expect(c.statut, 'Le statut DELIVRE ne doit jamais être touché par le Niveau 2').toBe('DELIVRE');
    expect(c.nom_retirant, 'nom_retirant (preuve de retrait terrain) ne doit jamais être écrasé').toBe('ZZTEST_RETIRANT_TERRAIN');

    expect(c.is_dirty).toBe(1);

    const outbox = await dbQuery(`SELECT * FROM t_outbox WHERE id = ?`, [c.sync_id]);
    expect(outbox.length, 'Une entrée t_outbox doit être créée pour la carte fusionnée par le Niveau 2').toBe(1);
    expect(outbox[0].status).toBe('PENDING');
  });

  test('6. Carte témoin #2 : chemin normal (cle_doublon) non affecté par le Niveau 2', async () => {
    const cards = await dbQuery(`SELECT * FROM t_cartes WHERE site_id = ? AND num_secu = ?`, [siteAId(), NUM_SECU_2]);
    expect(cards.length).toBe(1);
    const c = cards[0];
    expect(c.noms).toBe('ZZTEST_N2_TEMOIN');
    expect(c.statut).toBe('EN STOCK');
    // Le lieu_enrolement/rangement du fichier B ('ZZTEST_ENROL2B'/'ZZTEST_RANG2B') ne doit PAS
    // écraser les valeurs déjà réelles posées par le fichier A (Niveau 1 : jamais d'écrasement).
    expect(c.lieu_enrolement).toBe('ZZTEST_ENROL2');
    expect(c.rangement).toBe('ZZTEST_RANG2');
  });

  test('7. Cartes #3/#4 (num_secu partagé/ambigu) : refus de fusion Niveau 2, pas de duplication d\'identité — 2 anciennes fiches intactes + 2 nouvelles fiches légitimes', async () => {
    const cards = await dbQuery(`SELECT id_carte, noms, prenoms, date_de_naissance FROM t_cartes WHERE site_id = ? AND num_secu = ? ORDER BY id_carte`, [siteAId(), NUM_SECU_SHARED]);
    console.log('[CONSTAT] Cartes #3/#4 après réimport B:', JSON.stringify(cards));

    // Ambiguïté num_secu partagé (2 cartes candidates des deux côtés) → t_niveau2_cartes_secu/
    // t_niveau2_temp_secu (HAVING COUNT(*)=1) excluent ces lignes : AUCUN rattachement de secours
    // Niveau 2 n'a lieu, par construction. Les 2 lignes du fichier B ont donc une identité
    // (cle_doublon) totalement nouvelle par rapport aux 2 fiches vides existantes → elles suivent
    // le chemin Niveau 0 normal (INSERT, nouvelle fiche), CE QUI EST LE COMPORTEMENT ATTENDU du
    // garde-fou : refuser la fusion automatique ne doit pas faire disparaître la ligne réimportée,
    // seulement empêcher qu'elle soit rattachée par erreur. D'où 4 fiches au total pour ce
        // num_secu après réimport B (2 anciennes vides + 2 nouvelles nommées), et NON 2 : le total
    // de 2 n'aurait été correct que si la ligne réimportée avait été purement et simplement
    // ignorée, ce que le plan Niveau 2/3 ne prescrit à aucun moment (le résidu ambigu reste
    // seulement "non fusionné automatiquement", pas "rejeté").
    expect(cards.length, 'Total attendu : 2 anciennes fiches vides (non fusionnées) + 2 nouvelles fiches légitimes créées par le chemin normal = 4').toBe(4);

    const withNames = cards.filter((c) => c.noms === 'ZZTEST_N2_PARTAGE_A' || c.noms === 'ZZTEST_N2_PARTAGE_B');
    expect(withNames.length, 'Les 2 lignes du fichier B doivent avoir créé exactement 2 nouvelles fiches nommées, sans doublonnage (pas 3, pas 4 avec le même nom)').toBe(2);
    expect(cards.filter((c) => c.noms === 'ZZTEST_N2_PARTAGE_A').length, 'Aucune identité ne doit être dupliquée plusieurs fois').toBe(1);
    expect(cards.filter((c) => c.noms === 'ZZTEST_N2_PARTAGE_B').length, 'Aucune identité ne doit être dupliquée plusieurs fois').toBe(1);

    // Les 2 anciennes fiches vides du fichier A doivent toujours exister également, intactes
    // (non fusionnées, non supprimées, non modifiées) — preuve que le refus de fusion Niveau 2
    // laisse bien les fiches d'origine en l'état.
    const stillEmpty = cards.filter((c) => !c.noms || c.noms === '');
    expect(stillEmpty.length, 'Les 2 anciennes fiches vides du fichier A doivent rester distinctes et intactes (non fusionnées, non supprimées)').toBe(2);
    const emptyDates = stillEmpty.map((c) => c.date_de_naissance).sort();
    expect(emptyDates, 'Les 2 anciennes fiches vides doivent conserver leurs dates de naissance placeholder d\'origine, inchangées').toEqual(['1900-01-01', '1900-01-02']);
  });

  test('8. Logs [FUSION DIAGNOSTIC] : présence du compteur Niveau 2 (COMPLETE(N2)) avec au moins 1 ligne complétée, et compte total de cartes cohérent (pas de doublon inattendu)', async () => {
    console.log('[DIAG] Extrait mainProcessOutput (recherche FUSION DIAGNOSTIC):',
      mainProcessOutput.split('\n').filter((l) => l.includes('FUSION DIAGNOSTIC') || l.includes('Niveau 2')).join('\n'));

    expect(mainProcessOutput, 'Le log [FUSION DIAGNOSTIC] doit être présent dans le stdout du process principal').toContain('[FUSION DIAGNOSTIC]');
    expect(mainProcessOutput, 'Le compteur COMPLETE(N2) doit apparaître dans les logs de chunk').toMatch(/COMPLETE\(N2\):\s*\d+\s*lig/);
    expect(mainProcessOutput, 'Le bilan final doit mentionner le total Niveau 2 (num_secu)').toMatch(/Total COMPLETE \(Niveau 2.*num_secu.*\)\s*:\s*(\d+)\s*lignes/);

    // mainProcessOutput accumule le stdout des DEUX imports (fichier A puis fichier B) : le
    // bilan de l'import A rapporte légitimement 0 (rien à compléter sur une base vierge), donc
    // on prend le DERNIER bilan (celui de l'import B, où le Niveau 2 doit réellement se
    // déclencher pour la carte #1), pas le premier match.
    const bilanMatches = [...mainProcessOutput.matchAll(/Total COMPLETE \(Niveau 2.*?\)\s*:\s*(\d+)\s*lignes/g)];
    expect(bilanMatches.length, 'Bilan Niveau 2 introuvable dans les logs').toBeGreaterThanOrEqual(1);
    const totalN2 = parseInt(bilanMatches[bilanMatches.length - 1][1], 10);
    console.log(`[CONSTAT] Total COMPLETE (Niveau 2) rapporté par le worker (bilan du réimport B) : ${totalN2}`);
    expect(totalN2, 'Au moins la carte #1 doit avoir été complétée par le Niveau 2 lors du réimport B').toBeGreaterThanOrEqual(1);
    expect(mainProcessOutput, 'Aucune stack trace non gérée ne doit apparaître pendant la fusion').not.toMatch(/Uncaught|UnhandledPromiseRejection/);

    // Cohérence globale du nombre de cartes ZZTEST_N2_* sur le site : 1 (#1) + 1 (#2 témoin) + 4 (#3/#4 x2) = 6
    const total = await dbQuery(`SELECT COUNT(*) as c FROM t_cartes WHERE site_id = ? AND num_secu IN (?,?,?)`, [siteAId(), NUM_SECU_1, NUM_SECU_2, NUM_SECU_SHARED]);
    expect(total[0].c, 'Total de cartes cohérent pour ce lot de test : 1 + 1 + 4 = 6, aucun doublon inattendu').toBe(6);
  });

  // ══════════════════════════════════════════════════════════════════════
  // NETTOYAGE — purge explicite des données de test + vérification SQL
  // ══════════════════════════════════════════════════════════════════════

  test('9. Nettoyage : purge de toutes les données ZZTEST_ créées par ce run, avec vérification SQL du nettoyage complet', async () => {
    const idsToClean = await dbQuery(`SELECT id_carte, sync_id FROM t_cartes WHERE site_id = ? AND num_secu IN (?,?,?)`, [siteAId(), NUM_SECU_1, NUM_SECU_2, NUM_SECU_SHARED]);
    console.log('[CLEANUP] Cartes à nettoyer:', JSON.stringify(idsToClean));

    for (const row of idsToClean) {
      await dbQuery(`DELETE FROM t_outbox WHERE id = ?`, [row.sync_id]);
    }
    await dbQuery(`DELETE FROM t_cartes WHERE site_id = ? AND num_secu IN (?,?,?)`, [siteAId(), NUM_SECU_1, NUM_SECU_2, NUM_SECU_SHARED]);
    await dbQuery(`DELETE FROM t_cartes WHERE site_id = ? AND (noms LIKE 'ZZTEST\\_%' ESCAPE '\\' OR lieu_enrolement LIKE 'ZZTEST\\_%' ESCAPE '\\')`, [siteAId()]);

    const remainingCards = await dbQuery(
      `SELECT COUNT(*) as c FROM t_cartes WHERE site_id = ? AND (num_secu IN (?,?,?) OR noms LIKE 'ZZTEST\\_%' ESCAPE '\\')`,
      [siteAId(), NUM_SECU_1, NUM_SECU_2, NUM_SECU_SHARED]
    );
    expect(remainingCards[0].c, 'Vérification SQL : aucune carte de test ZZTEST_ ne doit subsister').toBe(0);

    let remainingOutbox = 0;
    for (const row of idsToClean) {
      const r = await dbQuery(`SELECT COUNT(*) as c FROM t_outbox WHERE id = ?`, [row.sync_id]);
      remainingOutbox += r[0].c;
    }
    expect(remainingOutbox, 'Vérification SQL : aucune entrée t_outbox résiduelle pour les cartes de test').toBe(0);

    // Restauration du nom de centre d'origine posé par le seed (voir seed-database.ts:88)
    await dbQuery(`UPDATE t_centres SET nom = 'Centre E2E Test' WHERE id = ?`, [siteACentreId()]);
  });

  test('10. Aucune erreur console pendant toute la manipulation (renderer)', async () => {
    console.log('[CONSTAT] Erreurs console renderer collectées:', JSON.stringify(consoleErrors));
    // Filtre défensif : ne retient que des erreurs, en excluant tout bruit connu et sans rapport
    // avec le scénario testé ici (aucun filtre appliqué a priori — la liste est loguée pour audit
    // manuel si non vide, afin de ne jamais masquer une vraie régression par un filtre trop large).
    expect(consoleErrors, 'Aucune erreur console renderer ne doit survenir pendant tout le scénario Niveau 2').toEqual([]);
  });
});
