/**
 * e2e/specs/_agent13_missing_data_lieu_enrolement.e2e.spec.ts
 *
 * QA Terrain (agent-13) — Test fonctionnel vivant du nouvel onglet "Sans Lieu Enrôl." ajouté à
 * l'écran "Données Manquantes" du portail Qualité (MissingDataView.tsx), qui permet enfin de
 * compléter `lieu_enrolement` (jusqu'ici la seule colonne sans aucune voie de correction — voir
 * le plan `actuellement-tout-fonctionne-bien-peppy-puppy.md`).
 *
 * Scénario couvert (demande orchestrateur) :
 *   1. Connexion OPERATEUR_QUALITE + présence visuelle de l'onglet "Sans Lieu Enrôl.", bien
 *      distinct de "Sans Lieu Naiss." (aucune confusion de libellé).
 *   2. Filtrage correct : seules les cartes ZZTEST_ avec lieu_enrolement vide/NULL apparaissent
 *      (une carte témoin avec lieu_enrolement déjà rempli ne doit PAS apparaître).
 *   3. Complétion réelle via l'UI (ExpandedManquantDetails, 8ème champ du grid) → vérification
 *      SQLite directe : lieu_enrolement mis à jour, is_dirty=1, updated_at rafraîchi, entrée
 *      t_outbox PENDING créée pour le sync_id de la carte (quadriptyque transactionnel).
 *   4. Disparition de la carte de la liste après rafraîchissement de l'onglet.
 *   5. Non-régression : l'onglet préexistant "Sans Lieu Naiss." (lieu de naissance) continue de
 *      fonctionner correctement, non affecté par cet ajout.
 *   6. Absence d'erreur console pendant toute la manipulation.
 *
 * ── Isolation ─────────────────────────────────────────────────────────────
 * Harnais Playwright `_electron` exclusif (`../fixtures/electron-app.ts`, userDataDir jetable via
 * `fs.mkdtempSync`), lancé contre le build réel `dist/` (réseau Supabase coupé par défaut,
 * `GEST_IN_SITU_E2E_DISABLE_SYNC=1`). Toutes les données créées sont préfixées `ZZTEST_`/`zztest-`
 * et nettoyées explicitement en fin de fichier avec revérification COUNT(*)=0. Seed complémentaire
 * inséré directement en base via le helper `dbQuery` (better-sqlite3 sous ELECTRON_RUN_AS_NODE=1,
 * même mécanisme que `_agent13_sync_badge_apurement_qualite.e2e.spec.ts`) — pas de fichier de seed
 * séparé, ce test est volontairement autonome.
 */
import { test, expect } from '@playwright/test';
import {
  launchSeededApp,
  teardownSeededApp,
  type E2EEnvironment
} from '../fixtures/electron-app';
import { getTestUser } from '../fixtures/test-users';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

test.describe.serial('QA Terrain — Onglet "Sans Lieu Enrôl." (Données Manquantes, portail Qualité) (agent-13)', () => {
  let env: E2EEnvironment;
  let anyTestFailed = false;
  const consoleErrors: string[] = [];

  test.beforeAll(async () => {
    env = await launchSeededApp();
    env.window.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });
    env.window.on('pageerror', (err) => {
      consoleErrors.push(`[pageerror] ${err.message}`);
    });
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

  // ── Helper SQL direct (better-sqlite3 via ELECTRON_RUN_AS_NODE — même mécanisme que les autres
  // specs agent-13) ──────────────────────────────────────────────────────────────────────────
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

  async function login(): Promise<void> {
    const { window } = env;
    const user = getTestUser('operateurQualite');
    await window.waitForURL(/#\/login/, { timeout: 20000 });
    await window.getByTestId('login-input').fill(user.login);
    await window.getByTestId('password-input').fill(user.password);
    await window.getByTestId('login-submit').click();
    await window.waitForURL(/#\/agent-qualite$/, { timeout: 15000 });
  }

  const suffix = Date.now();
  const nomEmpty1 = `ZZTEST_LIEUENROL_VIDE1_${suffix}`;
  const nomEmpty2 = `ZZTEST_LIEUENROL_VIDE2_${suffix}`;
  const nomEmpty3 = `ZZTEST_LIEUENROL_VIDE3_${suffix}`;
  const nomFilled = `ZZTEST_LIEUENROL_DEJAREMPLI_${suffix}`;
  const nomLieuNaissVide = `ZZTEST_LIEUNAISS_VIDE_${suffix}`;
  const nomLieuNaissRempli = `ZZTEST_LIEUNAISS_REMPLI_${suffix}`;

  let idEmpty1 = 0, idEmpty2 = 0, idEmpty3 = 0, idFilled = 0, idLieuNaissVide = 0, idLieuNaissRempli = 0;
  let syncIdEmpty1 = '';

  test('0. Seed ZZTEST_ : 3 cartes lieu_enrolement vide, 1 déjà remplie, + 1 paire pour la non-régression "Sans Lieu Naiss."', async () => {
    const siteId = env.seed.siteId;
    const centreId = env.seed.centreId;

    syncIdEmpty1 = `zztest-lieuenrol-vide1-${suffix}`;
    const r1 = await dbQuery(
      `INSERT INTO t_cartes (noms, prenoms, date_de_naissance, lieu_de_naissance, lieu_enrolement, num_secu, contact, statut, site_id, centre_id, sync_id, is_dirty)
       VALUES (?, 'ZZTEST_PRENOM', '1985-01-01', 'ZZTEST_LIEU', NULL, ?, '0100000001', 'EN STOCK', ?, ?, ?, 0)`,
      [nomEmpty1, `ZZTEST-SECU-LE1-${suffix}`, siteId, centreId, syncIdEmpty1]
    );
    idEmpty1 = r1[0].lastInsertRowid as number;

    const r2 = await dbQuery(
      `INSERT INTO t_cartes (noms, prenoms, date_de_naissance, lieu_de_naissance, lieu_enrolement, num_secu, contact, statut, site_id, centre_id, sync_id, is_dirty)
       VALUES (?, 'ZZTEST_PRENOM', '1985-01-02', 'ZZTEST_LIEU', '', ?, '0100000002', 'EN STOCK', ?, ?, ?, 0)`,
      [nomEmpty2, `ZZTEST-SECU-LE2-${suffix}`, siteId, centreId, `zztest-lieuenrol-vide2-${suffix}`]
    );
    idEmpty2 = r2[0].lastInsertRowid as number;

    const r3 = await dbQuery(
      `INSERT INTO t_cartes (noms, prenoms, date_de_naissance, lieu_de_naissance, lieu_enrolement, num_secu, contact, statut, site_id, centre_id, sync_id, is_dirty)
       VALUES (?, 'ZZTEST_PRENOM', '1985-01-03', 'ZZTEST_LIEU', NULL, ?, '0100000003', 'EN STOCK', ?, ?, ?, 0)`,
      [nomEmpty3, `ZZTEST-SECU-LE3-${suffix}`, siteId, centreId, `zztest-lieuenrol-vide3-${suffix}`]
    );
    idEmpty3 = r3[0].lastInsertRowid as number;

    // Carte témoin : lieu_enrolement DÉJÀ rempli -> ne doit JAMAIS apparaître dans "Sans Lieu Enrôl.".
    const r4 = await dbQuery(
      `INSERT INTO t_cartes (noms, prenoms, date_de_naissance, lieu_de_naissance, lieu_enrolement, num_secu, contact, statut, site_id, centre_id, sync_id, is_dirty)
       VALUES (?, 'ZZTEST_PRENOM', '1985-01-04', 'ZZTEST_LIEU', 'ABOBO_DEJA_REMPLI', ?, '0100000004', 'EN STOCK', ?, ?, ?, 0)`,
      [nomFilled, `ZZTEST-SECU-LE4-${suffix}`, siteId, centreId, `zztest-lieuenrol-rempli-${suffix}`]
    );
    idFilled = r4[0].lastInsertRowid as number;

    // Paire pour la non-régression de l'onglet préexistant "Sans Lieu Naiss." (lieu_de_naissance).
    const r5 = await dbQuery(
      `INSERT INTO t_cartes (noms, prenoms, date_de_naissance, lieu_de_naissance, lieu_enrolement, num_secu, contact, statut, site_id, centre_id, sync_id, is_dirty)
       VALUES (?, 'ZZTEST_PRENOM', '1985-01-05', NULL, 'ZZTEST_ENROL_OK', ?, '0100000005', 'EN STOCK', ?, ?, ?, 0)`,
      [nomLieuNaissVide, `ZZTEST-SECU-LN1-${suffix}`, siteId, centreId, `zztest-lieunaiss-vide-${suffix}`]
    );
    idLieuNaissVide = r5[0].lastInsertRowid as number;

    const r6 = await dbQuery(
      `INSERT INTO t_cartes (noms, prenoms, date_de_naissance, lieu_de_naissance, lieu_enrolement, num_secu, contact, statut, site_id, centre_id, sync_id, is_dirty)
       VALUES (?, 'ZZTEST_PRENOM', '1985-01-06', 'ABIDJAN_DEJA_REMPLI', 'ZZTEST_ENROL_OK2', ?, '0100000006', 'EN STOCK', ?, ?, ?, 0)`,
      [nomLieuNaissRempli, `ZZTEST-SECU-LN2-${suffix}`, siteId, centreId, `zztest-lieunaiss-rempli-${suffix}`]
    );
    idLieuNaissRempli = r6[0].lastInsertRowid as number;

    console.log(`[agent13][LIEU-ENROL][Seed] Cartes créées : vide1=${idEmpty1} vide2=${idEmpty2} vide3=${idEmpty3} rempli=${idFilled} lieuNaissVide=${idLieuNaissVide} lieuNaissRempli=${idLieuNaissRempli}`);
  });

  test('1. Connexion OPERATEUR_QUALITE + navigation vers Données Manquantes', async () => {
    await login();
    const { window } = env;
    await window.getByRole('link', { name: 'Données Manquantes' }).click();
    await window.waitForURL(/#\/agent-qualite\/manquants/, { timeout: 15000 });
    await expect(window.getByRole('button', { name: /Sans N° Sécu/ })).toBeVisible({ timeout: 10000 });
  });

  test('2. Présence visuelle distincte des onglets "Sans Lieu Enrôl." et "Sans Lieu Naiss."', async () => {
    const { window } = env;
    const tabLieuNaissance = window.getByRole('button', { name: /Sans Lieu Naiss\./ });
    const tabLieuEnrolement = window.getByRole('button', { name: /Sans Lieu Enrôl\./ });
    await expect(tabLieuNaissance).toBeVisible({ timeout: 10000 });
    await expect(tabLieuEnrolement).toBeVisible({ timeout: 10000 });

    const textNaissance = (await tabLieuNaissance.innerText()).trim();
    const textEnrolement = (await tabLieuEnrolement.innerText()).trim();
    console.log(`[agent13][LIEU-ENROL][Onglets] "${textNaissance}" vs "${textEnrolement}" (doivent être visuellement distincts)`);
    expect(textNaissance).not.toBe(textEnrolement);
    expect(textNaissance.toUpperCase()).toContain('NAISS');
    expect(textEnrolement.toUpperCase()).toContain('ENRÔL');
  });

  test('3. Onglet "Sans Lieu Enrôl." : seules les cartes lieu_enrolement vide/NULL apparaissent (pas la carte témoin déjà remplie)', async () => {
    const { window } = env;
    await window.getByRole('button', { name: /Sans Lieu Enrôl\./ }).click();
    await window.waitForTimeout(600);

    await expect(window.locator('tr').filter({ hasText: nomEmpty1 })).toBeVisible({ timeout: 10000 });
    await expect(window.locator('tr').filter({ hasText: nomEmpty2 })).toBeVisible({ timeout: 10000 });
    await expect(window.locator('tr').filter({ hasText: nomEmpty3 })).toBeVisible({ timeout: 10000 });

    const filledRowCount = await window.locator('tr').filter({ hasText: nomFilled }).count();
    console.log(`[agent13][LIEU-ENROL][Filtrage] Carte témoin "${nomFilled}" (lieu_enrolement déjà rempli) visible dans "Sans Lieu Enrôl." = ${filledRowCount > 0 ? 'OUI (BUG)' : 'NON (attendu)'}`);
    expect(filledRowCount).toBe(0);

    // Vérité terrain DB en complément de l'observation UI.
    const dbCheck = await dbQuery(
      `SELECT noms, lieu_enrolement FROM t_cartes WHERE id_carte IN (?, ?, ?, ?)`,
      [idEmpty1, idEmpty2, idEmpty3, idFilled]
    );
    console.log(`[agent13][LIEU-ENROL][Filtrage] État DB des 4 cartes : ${JSON.stringify(dbCheck)}`);
  });

  test('4. Complétion réelle via l\'UI (8ème champ du grid) → vérification SQLite : lieu_enrolement, is_dirty, updated_at, t_outbox PENDING', async () => {
    const { window } = env;

    const before = (await dbQuery(
      `SELECT lieu_enrolement, is_dirty, updated_at, sync_id FROM t_cartes WHERE id_carte = ?`,
      [idEmpty1]
    ))[0];
    console.log(`[agent13][LIEU-ENROL][Complétion] État AVANT : ${JSON.stringify(before)}`);
    expect(before.is_dirty).toBe(0);
    expect(before.lieu_enrolement).toBeFalsy();
    expect(before.sync_id).toBe(syncIdEmpty1);

    const outboxBefore = await dbQuery(`SELECT status FROM t_outbox WHERE id = ?`, [syncIdEmpty1]);
    console.log(`[agent13][LIEU-ENROL][Complétion] t_outbox AVANT pour sync_id="${syncIdEmpty1}" : ${JSON.stringify(outboxBefore)} (attendu: aucune ligne)`);
    expect(outboxBefore.length).toBe(0);

    const row = window.locator('tr').filter({ hasText: nomEmpty1 });
    await expect(row).toBeVisible({ timeout: 10000 });
    await row.getByRole('button', { name: /Compléter/ }).click();

    // Grid ExpandedManquantDetails, ordre fixe : Noms(0) Prénoms(1) Date(2) Contact(3)
    // LieuNaissance(4) NumSécu(5) Rangement(6) LieuEnrôlement(7) — vérifié par lecture de code
    // (src/renderer/src/components/Quality/ExpandedManquantDetails.tsx).
    await window.getByRole('button', { name: /Modifier/ }).nth(7).click();
    const lieuEnrolInput = window.locator('input[placeholder="Lieu d\'enrôlement..."]');
    await expect(lieuEnrolInput).toBeVisible({ timeout: 10000 });
    await lieuEnrolInput.fill('zztest_abobo_gare');
    // ExpandedManquantDetails.tsx : onChange de ce champ applique lui-même .toUpperCase() côté
    // client (comme noms/prenoms/lieu_de_naissance) — la valeur affichée/persistée est donc
    // "ZZTEST_ABOBO_GARE", vérifié empiriquement (constat DB ci-dessous) avant d'écrire cette
    // assertion.
    await expect(lieuEnrolInput).toHaveValue('ZZTEST_ABOBO_GARE');
    await window.locator('button.btn-primary').filter({ has: window.locator('svg') }).last().click();

    // Constat empirique (même limite déjà documentée dans agent-qualite.e2e.spec.ts, test 8) :
    // le toast react-hot-toast peut s'être déjà dissipé au moment où ce locator a la main
    // (course entre rendu et auto-dismiss), sans que ce soit un défaut applicatif — la preuve
    // fiable reste la base. On attend soit le toast, soit la fermeture du champ d'édition
    // (handleSave() ne referme editingField QUE sur succès réel, cf. ExpandedManquantDetails.tsx
    // ligne 45-49), avant de se fonder uniquement sur l'état SQLite.
    await Promise.race([
      window.getByText('Donnée mise à jour avec succès !').last().waitFor({ state: 'visible', timeout: 10000 }).catch(() => null),
      lieuEnrolInput.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => null)
    ]);

    const after = (await dbQuery(
      `SELECT lieu_enrolement, is_dirty, updated_at FROM t_cartes WHERE id_carte = ?`,
      [idEmpty1]
    ))[0];
    console.log(`[agent13][LIEU-ENROL][Complétion] État APRÈS : ${JSON.stringify(after)}`);
    expect(after.lieu_enrolement).toBe('ZZTEST_ABOBO_GARE');
    expect(after.is_dirty).toBe(1);
    expect(after.updated_at).not.toBe(before.updated_at);

    const outboxAfter = await dbQuery(`SELECT status, table_name FROM t_outbox WHERE id = ?`, [syncIdEmpty1]);
    console.log(`[agent13][LIEU-ENROL][Complétion] t_outbox APRÈS : ${JSON.stringify(outboxAfter)} (attendu: 1 ligne PENDING, t_cartes)`);
    expect(outboxAfter.length).toBeGreaterThanOrEqual(1);
    expect(outboxAfter[0].status).toBe('PENDING');
    expect(outboxAfter[0].table_name).toBe('t_cartes');
  });

  test('5. La carte complétée disparaît de "Sans Lieu Enrôl." après rafraîchissement de l\'onglet', async () => {
    const { window } = env;
    // Rafraîchissement en changeant d'onglet puis en revenant (loadTabData() se redéclenche
    // via le useEffect sur activeTab, cf. MissingDataView.tsx:71-73).
    await window.getByRole('button', { name: /Sans Lieu Naiss\./ }).click();
    await window.waitForTimeout(400);
    await window.getByRole('button', { name: /Sans Lieu Enrôl\./ }).click();
    await window.waitForTimeout(600);

    const goneRowCount = await window.locator('tr').filter({ hasText: nomEmpty1 }).count();
    console.log(`[agent13][LIEU-ENROL][Disparition] Carte "${nomEmpty1}" encore visible dans "Sans Lieu Enrôl." après complétion = ${goneRowCount > 0 ? 'OUI (BUG)' : 'NON (attendu)'}`);
    expect(goneRowCount).toBe(0);

    // Les 2 autres cartes toujours vides doivent, elles, rester présentes.
    await expect(window.locator('tr').filter({ hasText: nomEmpty2 })).toBeVisible({ timeout: 10000 });
    await expect(window.locator('tr').filter({ hasText: nomEmpty3 })).toBeVisible({ timeout: 10000 });
  });

  test('6. Non-régression : l\'onglet préexistant "Sans Lieu Naiss." filtre toujours correctement lieu_de_naissance', async () => {
    const { window } = env;
    await window.getByRole('button', { name: /Sans Lieu Naiss\./ }).click();
    await window.waitForTimeout(600);

    await expect(window.locator('tr').filter({ hasText: nomLieuNaissVide })).toBeVisible({ timeout: 10000 });
    const remplieRowCount = await window.locator('tr').filter({ hasText: nomLieuNaissRempli }).count();
    console.log(`[agent13][LIEU-ENROL][Non-régression] Carte "${nomLieuNaissRempli}" (lieu_de_naissance déjà rempli) visible dans "Sans Lieu Naiss." = ${remplieRowCount > 0 ? 'OUI (BUG)' : 'NON (attendu)'}`);
    expect(remplieRowCount).toBe(0);

    // Vérifie aussi que la carte tout juste complétée au test 4 (lieu_de_naissance déjà rempli
    // dès le seed, seul lieu_enrolement a été touché) n'apparaît PAS ici non plus (les deux
    // colonnes sont bien indépendantes, pas de contamination croisée entre les deux onglets).
    const crossContamCount = await window.locator('tr').filter({ hasText: nomEmpty1 }).count();
    console.log(`[agent13][LIEU-ENROL][Non-régression] Carte "${nomEmpty1}" (lieu_de_naissance déjà rempli au seed) visible dans "Sans Lieu Naiss." = ${crossContamCount > 0 ? 'OUI (BUG contamination croisée)' : 'NON (attendu)'}`);
    expect(crossContamCount).toBe(0);
  });

  test('7. Aucune erreur console pendant toute la manipulation', async () => {
    console.log(`[agent13][LIEU-ENROL][Console] Erreurs console capturées pendant tout le run : ${consoleErrors.length}`);
    if (consoleErrors.length > 0) {
      console.log(`[agent13][LIEU-ENROL][Console] Détail : ${JSON.stringify(consoleErrors, null, 2)}`);
    }
    expect(consoleErrors, `Erreurs console inattendues : ${JSON.stringify(consoleErrors)}`).toEqual([]);
  });

  test('8. Nettoyage final — suppression de toutes les données ZZTEST_/zztest- créées, vérification explicite', async () => {
    await dbQuery(`DELETE FROM t_outbox WHERE id LIKE 'zztest-lieuenrol-%' OR id LIKE 'zztest-lieunaiss-%'`);
    await dbQuery(`DELETE FROM t_cartes WHERE noms LIKE 'ZZTEST\\_LIEUENROL%' ESCAPE '\\' OR noms LIKE 'ZZTEST\\_LIEUNAISS%' ESCAPE '\\'`);

    const remainingCartes = await dbQuery(
      `SELECT COUNT(*) as c FROM t_cartes WHERE noms LIKE 'ZZTEST\\_LIEUENROL%' ESCAPE '\\' OR noms LIKE 'ZZTEST\\_LIEUNAISS%' ESCAPE '\\'`
    );
    const remainingOutbox = await dbQuery(
      `SELECT COUNT(*) as c FROM t_outbox WHERE id LIKE 'zztest-lieuenrol-%' OR id LIKE 'zztest-lieunaiss-%'`
    );
    console.log(`[agent13][LIEU-ENROL][CLEANUP] t_cartes restantes=${remainingCartes[0].c}, t_outbox restantes=${remainingOutbox[0].c}`);
    expect(remainingCartes[0].c).toBe(0);
    expect(remainingOutbox[0].c).toBe(0);
  });
});
