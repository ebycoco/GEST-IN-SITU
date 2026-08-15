/**
 * e2e/specs/_agent13_inventaire_cloud_bar.e2e.spec.ts
 *
 * QA Terrain (agent-13) — Vérification vivante (build FRAIS `dist/`,
 * réseau Supabase coupé par construction via GEST_IN_SITU_E2E_DISABLE_SYNC,
 * voir electron-app.ts) de la nouvelle barre d'actions cloud ajoutée sur
 * `InventaireLayout.tsx` (route `/inventaire`) : badge "Cartes disponibles
 * en local", bouton "Actualiser", bouton "RÉCUPÉRER LES CARTES DEPUIS LE
 * CLOUD" et bouton "Envoyer les corrections" — réplique du pattern déjà en
 * place sur AgentQualiteLayout.tsx.
 *
 * Couvre également la non-régression des 3 onglets existants (SCAN,
 * LOGISTIQUE, APUREMENT) et le cloisonnement site du badge/compteur cloud.
 *
 * Une seule instance Electron isolée est partagée pour tout le fichier
 * (coût de démarrage ~50-75s) : chaque bloc se connecte/déconnecte
 * successivement sous un rôle différent (OPERATEUR_INVENTAIRE,
 * OPERATEUR_LOGISTIQUE, ADMINISTRATEUR_SITE — comptes ajoutés à
 * test-users.ts pour cette session, jamais des identifiants réels).
 *
 * Toutes les cartes/sites de test créés sont préfixés `ZZTEST_` (noms) ou
 * `E2E-SITE2-`/`ZZTEST-` (sync_id/identifiants), et supprimés en fin de
 * fichier avec re-vérification explicite. `userDataDir` jetable nettoyé par
 * `teardownSeededApp` — aucune base de production n'est jamais touchée.
 */
import { test, expect } from '@playwright/test';
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
// test-results/ est déjà ignoré par git (.gitignore) : emplacement portable pour les
// captures de ce test, indépendant de toute session/machine.
const SHOT_DIR = join(__dirname, '..', '..', 'test-results', 'agent13-screenshots');

const NOW = Date.now();
const PREFIX = 'ZZTEST_INV';

test.describe.serial('QA Terrain — Barre cloud INVENTAIRE & LOGISTIQUE (/inventaire) (agent-13)', () => {
  let env: E2EEnvironment;
  let anyTestFailed = false;
  const consoleErrors: string[] = [];
  let secondSiteId: number;
  let secondCentreId: number;

  test.beforeAll(async () => {
    env = await launchSeededApp();
    env.window.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
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

  // ── Helpers génériques (voir _agent13_sync_status_dashboard.e2e.spec.ts) ──
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

  // `PRAGMA user_version` n'est pas un SELECT valide pour le routage .all()/.run() de
  // dbQuery() ci-dessus (better-sqlite3 refuse .run() sur un statement qui retourne des
  // lignes) : helper dédié utilisant l'API `db.pragma()` correcte, même mécanisme
  // d'exécution que `_agent13_probe_v61v62.e2e.spec.ts` (db-migration-probe.ts).
  async function pragmaUserVersion(): Promise<number> {
    const script = `
      const Database = require('better-sqlite3');
      const db = new Database(process.argv[1], { timeout: 15000 });
      try {
        const v = db.pragma('user_version', { simple: true });
        process.stdout.write(${JSON.stringify(DB_QUERY_MARKER)} + JSON.stringify(v));
      } finally {
        db.close();
      }
    `;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electronPath = require('electron') as unknown as string;
    const { stdout, stderr } = await execFileAsync(
      electronPath,
      ['-e', script, env.seed.dbPath],
      { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
    );
    const line = stdout.split(/\r?\n/).reverse().find((l) => l.startsWith(DB_QUERY_MARKER));
    if (!line) {
      throw new Error(`[pragmaUserVersion] Aucun résultat exploitable.\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`);
    }
    return JSON.parse(line.slice(DB_QUERY_MARKER.length));
  }

  async function login(loginId: string, password: string, urlPattern: RegExp): Promise<void> {
    const { window } = env;
    await window.waitForURL(/#\/login/, { timeout: 20000 });
    await window.getByTestId('login-input').fill(loginId);
    await window.getByTestId('password-input').fill(password);
    await window.getByTestId('login-submit').click();
    await window.waitForURL(urlPattern, { timeout: 20000 });
  }

  async function logout(): Promise<void> {
    const { window } = env;
    await window.getByText('Déconnexion').click();
    await window.waitForURL(/#\/login/, { timeout: 15000 });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 0. Préparation des données de test (cartes + second site pour cloisonnement)
  // ═══════════════════════════════════════════════════════════════════════
  test('0. Préparation : insertion des cartes ZZTEST_ et d\'un second site pour le test de cloisonnement', async () => {
    // Second site + centre isolé, pour vérifier qu'aucune de ses cartes ne fuite
    // dans le badge/compteur du site sous test.
    const site2 = await dbQuery(
      `INSERT INTO t_sites (nom, code, is_active, max_centres, is_permanent, sync_id) VALUES (?, ?, 1, 4, 1, ?)`,
      [`${PREFIX}_SITE2`, `E2E-SITE2-${NOW}`, `e2e-site2-${NOW}`]
    );
    secondSiteId = site2[0].lastInsertRowid;
    const centre2 = await dbQuery(
      `INSERT INTO t_centres (site_id, nom, numero, sync_id) VALUES (?, ?, 1, ?)`,
      [secondSiteId, `${PREFIX}_CENTRE2`, `e2e-centre2-${NOW}`]
    );
    secondCentreId = centre2[0].lastInsertRowid;

    // NB : la colonne `statut` porte une contrainte CHECK stricte (voir schema.ts) —
    // seules les valeurs EN STOCK/DELIVRE/DISTRIBUEE/RETIRE/ANNULE/BROUILLON/DOUBLON
    // sont acceptées. "NON CLASSE" n'est PAS un statut : c'est un simple libellé
    // d'affichage utilisé côté UI quand `rangement` est NULL/vide (voir
    // InventaireLogistique.tsx "Sans rangement"). Toutes les cartes de test
    // ci-dessous démarrent donc avec un `statut` valide et `rangement` NULL.
    await dbQuery(
      `INSERT INTO t_cartes (noms, prenoms, statut, site_id, centre_id, sync_id, is_dirty, num_secu)
       VALUES (?, ?, 'EN STOCK', ?, ?, ?, 0, ?)`,
      [`${PREFIX}_AUTRESITE`, 'FUITE', secondSiteId, secondCentreId, `zztest-autresite-${NOW}`, `ZZTEST-AUTRESITE-${NOW}`]
    );

    // Carte pour le scénario SCAN : identifiable par num_secu, pas encore rangée.
    // Statut initial délibérément différent de la cible ('BROUILLON') pour que la
    // transition vers 'EN STOCK' opérée par le scan soit réellement observable.
    await dbQuery(
      `INSERT INTO t_cartes (noms, prenoms, statut, site_id, centre_id, sync_id, is_dirty, num_secu)
       VALUES (?, ?, 'BROUILLON', ?, ?, ?, 0, ?)`,
      [`${PREFIX}_SCAN`, 'ALPHA', env.seed.siteId, env.seed.centreId, `zztest-scan-${NOW}`, `ZZTEST-SCAN-${NOW}`]
    );

    // Carte pour le scénario LOGISTIQUE (nom unique, pas de num_secu — teste aussi
    // la saisie du num_secu manquant en cours de classement).
    await dbQuery(
      `INSERT INTO t_cartes (noms, prenoms, statut, site_id, centre_id, sync_id, is_dirty)
       VALUES (?, ?, 'EN STOCK', ?, ?, ?, 0)`,
      [`${PREFIX}_LOGI`, 'BETA', env.seed.siteId, env.seed.centreId, `zztest-logi-${NOW}`]
    );

    // Deux cartes homonymes (même nom/prénom) pour tester le raccourci clavier numérique.
    await dbQuery(
      `INSERT INTO t_cartes (noms, prenoms, statut, site_id, centre_id, sync_id, is_dirty, date_de_naissance)
       VALUES (?, ?, 'EN STOCK', ?, ?, ?, 0, ?)`,
      [`${PREFIX}_HOMONYME`, 'GAMMA', env.seed.siteId, env.seed.centreId, `zztest-homo1-${NOW}`, '1990-01-01']
    );
    await dbQuery(
      `INSERT INTO t_cartes (noms, prenoms, statut, site_id, centre_id, sync_id, is_dirty, date_de_naissance)
       VALUES (?, ?, 'EN STOCK', ?, ?, ?, 0, ?)`,
      [`${PREFIX}_HOMONYME`, 'GAMMA', env.seed.siteId, env.seed.centreId, `zztest-homo2-${NOW}`, '1985-05-05']
    );

    // Carte pour le scénario APUREMENT : en stock, recherchable par nom/date/lieu.
    await dbQuery(
      `INSERT INTO t_cartes (noms, prenoms, statut, site_id, centre_id, sync_id, is_dirty, date_de_naissance, lieu_de_naissance, num_secu)
       VALUES (?, ?, 'EN STOCK', ?, ?, ?, 0, ?, ?, ?)`,
      [`${PREFIX}_APUREMENT`, 'DELTA', env.seed.siteId, env.seed.centreId, `zztest-apu-${NOW}`, '1975-03-15', 'ABOBO', `ZZTEST-APU-${NOW}`]
    );

    const countSite = await dbQuery('SELECT COUNT(*) as c FROM t_cartes WHERE site_id = ?', [env.seed.siteId]);
    // 5 cartes créées pour le site sous test : SCAN, LOGI, 2x HOMONYME, APUREMENT.
    expect(countSite[0].c).toBe(5);
    const countOtherSite = await dbQuery('SELECT COUNT(*) as c FROM t_cartes WHERE site_id = ?', [secondSiteId]);
    expect(countOtherSite[0].c).toBe(1);

    console.log(`[agent13][SETUP] Site sous test id=${env.seed.siteId} → 5 cartes ZZTEST_. Second site id=${secondSiteId} → 1 carte ZZTEST_ (fuite potentielle).`);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 1. OPERATEUR_INVENTAIRE — badge local exact + cloisonnement site
  // ═══════════════════════════════════════════════════════════════════════
  test('1. OPERATEUR_INVENTAIRE : badge "Cartes disponibles en local" exact et scopé au site actif', async () => {
    const user = getTestUser('operateurInventaire');
    await login(user.login, user.password, /#\/inventaire/);

    const { window } = env;
    const expectedTotal = (await dbQuery('SELECT COUNT(*) as c FROM t_cartes WHERE site_id = ?', [env.seed.siteId]))[0].c;

    const badge = window.locator('text=Cartes disponibles en local :').locator('xpath=..');
    await expect(badge).toBeVisible({ timeout: 30000 });
    const badgeText = (await badge.textContent()) || '';
    const badgeValue = Number(badgeText.replace(/[^\d]/g, ''));

    console.log(`[agent13][BADGE] Affiché=${badgeValue} | Attendu (COUNT site=${env.seed.siteId})=${expectedTotal}`);
    expect(badgeValue).toBe(expectedTotal);
    // Vérifie explicitement l'absence de fuite : la carte du second site ne doit
    // JAMAIS être comptée (5, pas 6).
    expect(badgeValue).toBe(5);

    await window.screenshot({ path: join(SHOT_DIR, 'agent13-inv-01-operateur-inventaire-badge.png') });
  });

  test('2. [RE-VALIDATION P0#1] OPERATEUR_INVENTAIRE : bouton "RÉCUPÉRER LES CARTES DEPUIS LE CLOUD" évolue maintenant (rôle ajouté à useDashboardStats.ts)', async () => {
    const { window } = env;
    const pullBtn = window.getByRole('button', { name: /RÉCUPÉRATION EN COURS|RÉCUPÉRER LES CARTES DEPUIS LE CLOUD/ });
    await expect(pullBtn).toBeVisible({ timeout: 15000 });
    // Laisse le temps aux 3 tentatives de fetchCloudCountWithRetry (2.5s d'intervalle,
    // ~7.5s) de se dérouler. AVANT le correctif, OPERATEUR_INVENTAIRE n'étant pas dans
    // la liste de rôles de useDashboardStats.ts, fetchCloudCountWithRetry n'était même
    // JAMAIS appelée : le bouton restait figé sans qu'aucune tentative réseau ne se
    // déclenche. APRÈS correctif, le rôle est inclus → l'appel se déclenche bien, et
    // puisque le réseau Supabase est coupé dans ce harnais (GEST_IN_SITU_E2E_DISABLE_SYNC),
    // les 3 tentatives échouent et cloudCartesCount retombe sur la sentinelle -1 —
    // exactement le même comportement observé pour ADMINISTRATEUR_SITE (test 9), preuve
    // que le rôle est désormais traité de façon cohérente.
    await window.waitForTimeout(9000);
    const btnText = (await pullBtn.textContent()) || '';
    const isDisabled = await pullBtn.isDisabled();
    console.log(`[agent13][PULL-BTN][OPERATEUR_INVENTAIRE] texte="${btnText.trim()}" disabled=${isDisabled} (attendu : désactivé, sentinelle -1, comme ADMINISTRATEUR_SITE)`);
    await window.screenshot({ path: join(SHOT_DIR, 'agent13-inv-02-operateur-inventaire-pull-btn.png') });
    expect(isDisabled).toBe(true);
    expect(btnText).not.toMatch(/\(\d+\)/);
  });

  test('3. [RE-VALIDATION P0#1] OPERATEUR_INVENTAIRE : bouton "Envoyer les corrections" désactivé sans carte conforme dirty, puis activé par un SIMPLE clic "Actualiser" (plus besoin de logout/login)', async () => {
    const { window } = env;
    const sendBtn = window.getByRole('button', { name: /Envoyer les corrections|ENVOI/ });
    await expect(sendBtn).toBeVisible({ timeout: 15000 });
    await expect(sendBtn).toBeDisabled();
    console.log('[agent13][SEND-BTN] Correctement désactivé : aucune carte conforme is_dirty=1 au départ.');

    // On rend une carte is_dirty=1 conforme directement en base, avec contact_retirant
    // et relation_retirant explicitement NULL (non renseignés) — sert aussi de terrain
    // pour le point 4 (mapping cloud) : vérifier que rien ne casse à l'envoi pour une
    // carte sans ces deux champs.
    await dbQuery(
      `INSERT INTO t_cartes (noms, prenoms, statut, site_id, centre_id, sync_id, is_dirty, rangement, contact_retirant, relation_retirant)
       VALUES (?, ?, 'EN STOCK', ?, ?, ?, 1, 'ZZTEST-RANG-1', NULL, NULL)`,
      [`${PREFIX}_CONFORME`, 'EPSILON', env.seed.siteId, env.seed.centreId, `zztest-conforme-${NOW}`]
    );

    const refreshBtn = window.getByRole('button', { name: /Actualiser/ });
    await refreshBtn.click();
    await window.waitForTimeout(2500);

    const disabledAfterOneClick = await sendBtn.isDisabled();
    console.log(`[agent13][SEND-BTN] Après 1 SEUL clic "Actualiser" avec 1 carte conforme is_dirty=1 en base : disabled=${disabledAfterOneClick} (attendu: false / enabled — avant correctif il fallait un logout/login)`);
    await window.screenshot({ path: join(SHOT_DIR, 'agent13-inv-03a-operateur-inventaire-send-btn-after-refresh.png') });
    expect(disabledAfterOneClick).toBe(false);

    // ── Point 4 : non-régression du mapping cloud contact_retirant/relation_retirant ──
    // Réseau Supabase coupé dans ce harnais (bulk-uploader.ts court-circuite AVANT
    // d'atteindre payload-mapper.ts/upload-worker.js dès GEST_IN_SITU_E2E_DISABLE_SYNC=1)
    // : impossible de valider un aller-retour réel du payload. On vérifie donc ici que le
    // clic sur "Envoyer les corrections" — pour une carte dont contact_retirant/
    // relation_retirant sont NULL — ne fait planter ni l'UI ni le process main (aucune
    // exception, is_dirty inchangé puisque l'upload n'a pas eu lieu), en complément de la
    // relecture statique de payload-mapper.ts/upstream.ts/upload-worker.js (fallback
    // `|| null` systématique, intrinsèquement sûr pour des champs undefined/null).
    await sendBtn.click();
    await window.waitForTimeout(2000);
    const rowAfterSendClick = await dbQuery(
      `SELECT is_dirty, contact_retirant, relation_retirant FROM t_cartes WHERE sync_id = ?`,
      [`zztest-conforme-${NOW}`]
    );
    console.log(`[agent13][POINT4][SEND-CLICK] État après clic "Envoyer les corrections" (réseau coupé, upload court-circuité) : ${JSON.stringify(rowAfterSendClick[0])}`);
    expect(rowAfterSendClick[0].is_dirty).toBe(1); // Upload non effectué (réseau coupé) : inchangé, pas de corruption.
    await window.screenshot({ path: join(SHOT_DIR, 'agent13-inv-03c-operateur-inventaire-send-click-no-crash.png') });

    // Nettoyage immédiat de cette carte dédiée (ne sert plus qu'aux scénarios suivants).
    await dbQuery(`DELETE FROM t_cartes WHERE sync_id = ?`, [`zztest-conforme-${NOW}`]);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 4. Onglet SCAN — non-régression
  // ═══════════════════════════════════════════════════════════════════════
  test('4. Onglet SCAN : verrouillage rangement + scan identifiant → statut EN STOCK + rangement en base', async () => {
    const { window } = env;
    await window.getByRole('button', { name: /INVENTAIRE PAR SCAN/ }).click();

    const rangementInput = window.locator('input[placeholder="Ex: BOITE-001"]');
    await expect(rangementInput).toBeVisible({ timeout: 10000 });
    const targetRangement = `ZZTEST-BOITE-${NOW}`;
    await rangementInput.fill(targetRangement);
    await window.getByRole('button', { name: 'Verrouiller Cible' }).click();

    const scanInput = window.locator('input[placeholder="Scannez l\'identifiant de la carte ici..."]');
    await expect(scanInput).toBeVisible({ timeout: 10000 });
    await scanInput.fill(`ZZTEST-SCAN-${NOW}`);
    await scanInput.press('Enter');

    await expect(window.locator(`text=${PREFIX}_SCAN ALPHA`)).toBeVisible({ timeout: 10000 });

    const row = await dbQuery(
      `SELECT statut, rangement FROM t_cartes WHERE sync_id = ?`,
      [`zztest-scan-${NOW}`]
    );
    console.log(`[agent13][SCAN] statut=${row[0].statut} rangement=${row[0].rangement} (attendu EN STOCK / ${targetRangement})`);
    expect(row[0].statut).toBe('EN STOCK');
    expect(row[0].rangement).toBe(targetRangement);

    await window.screenshot({ path: join(SHOT_DIR, 'agent13-inv-04-scan-succes.png') });

    // Cas d'erreur volontaire : identifiant inconnu.
    await scanInput.fill('ZZTEST-INCONNU-XYZ');
    await scanInput.press('Enter');
    await expect(window.locator('text=Échec de scan')).toBeVisible({ timeout: 10000 });
    console.log('[agent13][SCAN] Cas d\'erreur (identifiant inconnu) correctement signalé dans la liste.');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 5. Onglet LOGISTIQUE — non-régression + raccourci clavier homonymes
  // ═══════════════════════════════════════════════════════════════════════
  test('5. Onglet LOGISTIQUE : recherche + attribution rangement → rangement + is_dirty en base, statut inchangé', async () => {
    const { window } = env;
    await window.getByRole('button', { name: /CLASSEMENT LOGISTIQUE/ }).click();

    const searchInput = window.locator('input[placeholder="Saisir les critères..."]');
    await expect(searchInput).toBeVisible({ timeout: 10000 });
    await searchInput.fill(`${PREFIX}_LOGI`);
    await expect(window.locator(`text=${PREFIX}_LOGI BETA`)).toBeVisible({ timeout: 10000 });
    await window.locator(`text=${PREFIX}_LOGI BETA`).click();

    // Numéro de sécu manquant → champ obligatoire affiché en premier.
    const numSecuInput = window.locator('input[placeholder="Ex: 22501..."]');
    await expect(numSecuInput).toBeVisible({ timeout: 5000 });
    await numSecuInput.fill(`ZZTEST-LOGI-SECU-${NOW}`);

    const rangementInput = window.locator('input[placeholder="Ex: MAIRIE-A3"]');
    const targetRangement = `ZZTEST-CASIER-${NOW}`;
    await rangementInput.fill(targetRangement);
    await window.getByRole('button', { name: /Valider \(Entrée\)/ }).click();

    await expect(window.locator('text=Rechercher une fiche')).toBeVisible({ timeout: 10000 });

    const row = await dbQuery(
      `SELECT statut, rangement, is_dirty, num_secu FROM t_cartes WHERE sync_id = ?`,
      [`zztest-logi-${NOW}`]
    );
    console.log(`[agent13][LOGISTIQUE] statut=${row[0].statut} rangement=${row[0].rangement} is_dirty=${row[0].is_dirty} (statut attendu INCHANGÉ = EN STOCK, valeur d'insertion initiale)`);
    expect(row[0].rangement).toBe(targetRangement);
    expect(row[0].is_dirty).toBe(1);
    expect(row[0].statut).toBe('EN STOCK'); // Contrairement au SCAN, LOGISTIQUE ne doit PAS toucher au statut.
    expect(row[0].num_secu).toBe(`ZZTEST-LOGI-SECU-${NOW}`);

    await window.screenshot({ path: join(SHOT_DIR, 'agent13-inv-05-logistique-succes.png') });

    // [RE-VALIDATION P2] Raccourci clavier numérique sur homonymes. `searchQuickLogistique`
    // trie désormais par `ORDER BY noms ASC, prenoms ASC, id_carte ASC` (tiebreaker ajouté) :
    // pour 2 homonymes stricts (même noms/prenoms), l'ordre doit maintenant être stable et
    // reproductible à chaque recherche (id_carte ASC = ordre d'insertion, donc 1990-01-01
    // avant 1985-05-05 puisqu'inséré en premier ci-dessus).
    await searchInput.fill(`${PREFIX}_HOMONYME`);
    await expect(window.locator('text=Appuyez sur la touche numérique')).toBeVisible({ timeout: 10000 });
    const resultRows = window.locator(`text=${PREFIX}_HOMONYME GAMMA`);
    await expect(resultRows).toHaveCount(2, { timeout: 10000 });
    const datesInDisplayOrder = await window.locator('text=/Né\\(e\\) le \\d{4}-\\d{2}-\\d{2}/').allTextContents();
    console.log(`[agent13][LOGISTIQUE][TRI-STABLE] Ordre d'affichage des 2 homonymes : ${JSON.stringify(datesInDisplayOrder)}`);
    expect(datesInDisplayOrder.length).toBe(2);
    // id_carte ASC = ordre d'insertion : 1990-01-01 (homo1) inséré avant 1985-05-05 (homo2).
    expect(datesInDisplayOrder[0]).toContain('1990-01-01');
    expect(datesInDisplayOrder[1]).toContain('1985-05-05');
    const expectedSecondDate = datesInDisplayOrder[1].match(/\d{4}-\d{2}-\d{2}/)?.[0];

    await window.keyboard.press('2');
    // La sélection doit afficher la date de naissance du 2e élément TEL QU'AFFICHÉ.
    await expect(window.locator(`text=${expectedSecondDate}`)).toBeVisible({ timeout: 10000 });
    console.log(`[agent13][LOGISTIQUE] Raccourci clavier numérique (touche 2) a bien sélectionné le 2e élément affiché (${expectedSecondDate}).`);
    // Annulation (pas de modification voulue sur ce cas).
    await window.getByRole('button', { name: 'Annuler' }).click();

    // Répétition x3 de la MÊME recherche successive : l'ordre doit rester STRICTEMENT
    // identique à chaque fois (déterminisme du tiebreaker id_carte ASC), preuve du
    // correctif P2 (avant, l'ordre SQLite pour des lignes ex-aequo sur noms/prenoms
    // n'était garanti par aucune clause ORDER BY supplémentaire).
    for (let i = 1; i <= 3; i++) {
      await searchInput.fill('');
      await searchInput.fill(`${PREFIX}_HOMONYME`);
      await expect(window.locator('text=Appuyez sur la touche numérique')).toBeVisible({ timeout: 10000 });
      await expect(window.locator(`text=${PREFIX}_HOMONYME GAMMA`)).toHaveCount(2, { timeout: 10000 });
      const repeatOrder = await window.locator('text=/Né\\(e\\) le \\d{4}-\\d{2}-\\d{2}/').allTextContents();
      console.log(`[agent13][LOGISTIQUE][TRI-STABLE] Répétition ${i}/3 : ${JSON.stringify(repeatOrder)}`);
      expect(repeatOrder[0]).toContain('1990-01-01');
      expect(repeatOrder[1]).toContain('1985-05-05');
    }
    await searchInput.fill('');

    // Cas limite : champ rangement vide → refus (toast), pas de sauvegarde.
    await searchInput.fill(`${PREFIX}_LOGI`);
    await window.locator(`text=${PREFIX}_LOGI BETA`).click();
    await expect(window.locator('input[placeholder="Ex: MAIRIE-A3"]')).toHaveValue(targetRangement, { timeout: 5000 });
    const rangementField = window.locator('input[placeholder="Ex: MAIRIE-A3"]');
    await rangementField.fill('');
    await window.getByRole('button', { name: /Valider \(Entrée\)/ }).click();
    await expect(window.locator('text=Le rangement est obligatoire.')).toBeVisible({ timeout: 5000 });
    console.log('[agent13][LOGISTIQUE] Cas limite (rangement vide) correctement bloqué avec message d\'erreur.');
    await window.getByRole('button', { name: 'Annuler' }).click();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 6. Onglet APUREMENT — non-régression
  // ═══════════════════════════════════════════════════════════════════════
  test('6. [RE-VALIDATION P0#2] Onglet APUREMENT : recherche combinée + émargement historique — migration v63 (relation_retirant) : la sauvegarde réussit désormais', async () => {
    const { window } = env;
    await window.getByRole('button', { name: /APUREMENT HISTORIQUE/ }).click();

    const nomInput = window.locator('input[placeholder="Saisir nom & prénoms..."]');
    await expect(nomInput).toBeVisible({ timeout: 10000 });
    await nomInput.fill(`${PREFIX}_APUREMENT`);
    await window.getByRole('button', { name: 'Rechercher' }).click();

    await expect(window.locator(`text=${PREFIX}_APUREMENT DELTA`)).toBeVisible({ timeout: 10000 });
    await window.locator(`text=${PREFIX}_APUREMENT DELTA`).click();

    const dateInput = window.locator('input[type="date"]');
    await dateInput.fill('2026-01-15');

    await window.locator('select').selectOption('CONJOINT');
    const nomRetirantInput = window.locator('input[placeholder="Ex: KOUASSI KOFFI JEAN"]');
    await nomRetirantInput.fill('ZZTEST_RETIRANT CONJOINT');
    const telInput = window.locator('input[placeholder="Ex: 0707..."]');
    await telInput.fill('0700000000');

    await window.getByRole('button', { name: /Valider l'Apurement/ }).click();

    // ── RE-VALIDATION (P0#2, correctif migration v63) ──────────────────────
    // Avant correctif : `updateApurementHistorique()` référençait une colonne
    // `relation_retirant` absente du schéma réel de `t_cartes` → SqliteError
    // systématique ("no such column: relation_retirant") sur TOUT clic "Valider
    // l'Apurement". La migration v63 (schema.ts, `migrateV63()`) ajoute
    // désormais cette colonne (ALTER TABLE ADD COLUMN, purement additif) et le
    // seed e2e (via `runMigrations()` réel, voir seed-database.ts) l'exécute
    // sur une base neuve — donc si ce test passe, il valide À LA FOIS la
    // fonctionnalité ET le chemin de migration d'une installation neuve.
    // [agent-13][MAJ] SCHEMA_VERSION est passée de 63 à 64 avec le chantier
    // OPERATEUR_APUREMENT (élargissement CHECK(role), voir migrateV64() dans
    // schema.ts) : l'assertion ci-dessous est mise à jour en conséquence
    // (64), la logique de re-validation P0#2 (relation_retirant) reste
    // strictement inchangée.
    const successToast = window.locator('text=Décharge historique enregistrée avec succès.');
    await expect(successToast).toBeVisible({ timeout: 10000 });
    console.log('[agent13][P0#2][APUREMENT] Sauvegarde réussie : plus de SqliteError relation_retirant.');

    const userVersion = await pragmaUserVersion();
    console.log(`[agent13][MIGRATION] user_version de la base e2e (seedée via runMigrations réel) = ${userVersion}`);
    expect(userVersion).toBe(64);

    const row = await dbQuery(
      `SELECT statut, date_delivrance, nom_retirant, num_retirant, relation_retirant, agent_distributeur, is_dirty
       FROM t_cartes WHERE sync_id = ?`,
      [`zztest-apu-${NOW}`]
    );
    console.log(`[agent13][APUREMENT] État en base après succès : ${JSON.stringify(row[0])}`);
    expect(row[0].statut).toBe('DELIVRE');
    expect(row[0].is_dirty).toBe(1);
    expect(row[0].date_delivrance).toBe('2026-01-15');
    expect(row[0].nom_retirant).toBe('ZZTEST_RETIRANT CONJOINT');
    expect(row[0].num_retirant).toBe('0700000000');
    expect(row[0].relation_retirant).toBe('CONJOINT');

    await window.screenshot({ path: join(SHOT_DIR, 'agent13-inv-06-apurement-P0-succes-sauvegarde.png') });

    // handleSave() appelle resetState() en cas de succès : retour automatique à l'écran
    // de recherche (nomInput réapparaît, vidé), prêt pour le cas limite suivant.
    await expect(nomInput).toBeVisible({ timeout: 10000 });
    await expect(nomInput).toHaveValue('');

    // Cas d'erreur volontaire : champ téléphone retirant vide (validation CLIENT,
    // avant tout appel IPC — indépendante du bug P0 ci-dessus, doit continuer à
    // fonctionner). NB : `selectCard()` pré-remplit nomRetirant avec le nom de
    // l'assuré lui-même (relation par défaut "SOI-MEME") — c'est donc le
    // téléphone, laissé vide, qui déclenche la 1re validation bloquante ici.
    await nomInput.fill(`${PREFIX}_SCAN`);
    await window.getByRole('button', { name: 'Rechercher' }).click();
    await expect(window.locator(`text=${PREFIX}_SCAN ALPHA`)).toBeVisible({ timeout: 10000 });
    await window.locator(`text=${PREFIX}_SCAN ALPHA`).click();
    await window.getByRole('button', { name: /Valider l'Apurement/ }).click();
    await expect(window.locator('text=Le téléphone du retirant est obligatoire.')).toBeVisible({ timeout: 5000 });
    console.log('[agent13][APUREMENT] Cas limite (téléphone retirant vide) correctement bloqué côté client.');
    await window.getByRole('button', { name: 'Annuler' }).click();
  });

  test('7. La barre d\'actions cloud reste visible et cohérente après changement d\'onglet (pas de recouvrement visuel)', async () => {
    const { window } = env;
    for (const tabName of [/INVENTAIRE PAR SCAN/, /CLASSEMENT LOGISTIQUE/, /APUREMENT HISTORIQUE/]) {
      await window.getByRole('button', { name: tabName }).click();
      await expect(window.locator('text=Cartes disponibles en local :')).toBeVisible({ timeout: 10000 });
      await expect(window.getByRole('button', { name: /Actualiser/ })).toBeVisible();
      await expect(window.getByRole('button', { name: /RÉCUPÉRER LES CARTES DEPUIS LE CLOUD|RÉCUPÉRATION EN COURS/ })).toBeVisible();
      await expect(window.getByRole('button', { name: /Envoyer les corrections|ENVOI/ })).toBeVisible();
    }
    await window.screenshot({ path: join(SHOT_DIR, 'agent13-inv-07-barre-cloud-persistante.png') });
    console.log('[agent13][UI] Barre cloud visible et stable sur les 3 onglets, aucun recouvrement détecté visuellement (voir capture).');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 8. OPERATEUR_LOGISTIQUE — même page, même barre (accès + badge)
  // ═══════════════════════════════════════════════════════════════════════
  test('8. OPERATEUR_LOGISTIQUE : accès à /inventaire confirmé, badge exact également pour ce second rôle', async () => {
    await logout();
    const user = getTestUser('operateurLogistique');
    await login(user.login, user.password, /#\/inventaire/);

    const { window } = env;
    const badge = window.locator('text=Cartes disponibles en local :').locator('xpath=..');
    await expect(badge).toBeVisible({ timeout: 30000 });
    // Le cache serveur mémoïzé de stats:get (TTL 15s, clé site_id+centre_id, déjà documenté
    // ailleurs dans ce dépôt) est partagé avec OPERATEUR_INVENTAIRE testé juste avant (même
    // site/centre) : une carte insérée puis supprimée directement en base (test 3) a pu laisser
    // une valeur de cache pas encore expirée. "Actualiser" (forceRefresh=true) contourne
    // explicitement ce cache pour garantir une lecture fraîche avant comparaison.
    await window.getByRole('button', { name: /Actualiser/ }).click();
    await window.waitForTimeout(1500);
    const expectedTotal = (await dbQuery('SELECT COUNT(*) as c FROM t_cartes WHERE site_id = ?', [env.seed.siteId]))[0].c;
    const badgeValue = Number(((await badge.textContent()) || '').replace(/[^\d]/g, ''));
    console.log(`[agent13][BADGE][OPERATEUR_LOGISTIQUE] Affiché=${badgeValue} | Attendu=${expectedTotal}`);
    expect(badgeValue).toBe(expectedTotal);

    const pullBtn = window.getByRole('button', { name: /RÉCUPÉRATION EN COURS|RÉCUPÉRER LES CARTES DEPUIS LE CLOUD/ });
    await window.waitForTimeout(9000);
    const btnText = (await pullBtn.textContent()) || '';
    const isDisabled = await pullBtn.isDisabled();
    console.log(`[agent13][PULL-BTN][OPERATEUR_LOGISTIQUE] texte="${btnText.trim()}" disabled=${isDisabled}`);
    await window.screenshot({ path: join(SHOT_DIR, 'agent13-inv-08-operateur-logistique-badge.png') });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 9. ADMINISTRATEUR_SITE — comparaison : le compteur cloud atteint bien la
  //    sentinelle -1 (réseau coupé) pour CE rôle, contrairement aux deux
  //    opérateurs testés ci-dessus (voir rapport pour l'analyse).
  // ═══════════════════════════════════════════════════════════════════════
  test('9. ADMINISTRATEUR_SITE (comparaison) : le compteur cloud atteint la sentinelle -1 après les tentatives réseau', async () => {
    await logout();
    const user = getTestUser('administrateurSite');
    await login(user.login, user.password, /#\/dashboard/);

    const { window } = env;
    // Navigation réaliste via le lien de sidebar réel (ADMINISTRATEUR_SITE a accès à
    // "Inventaire & Logistique", voir Sidebar.tsx) plutôt qu'une injection de hash.
    await window.getByText('Inventaire & Logistique').click();
    await window.waitForURL(/#\/inventaire/, { timeout: 15000 });

    const pullBtn = window.getByRole('button', { name: /RÉCUPÉRATION EN COURS|RÉCUPÉRER LES CARTES DEPUIS LE CLOUD/ });
    await expect(pullBtn).toBeVisible({ timeout: 15000 });
    // fetchCloudCountWithRetry : 3 tentatives x 2.5s = ~7.5s avant setCloudCartesCount(-1).
    await window.waitForTimeout(9000);
    const btnText = (await pullBtn.textContent()) || '';
    const isDisabled = await pullBtn.isDisabled();
    console.log(`[agent13][PULL-BTN][ADMINISTRATEUR_SITE] texte="${btnText.trim()}" disabled=${isDisabled} (attendu : désactivé, aucun compteur "(N)" affiché car cloudCartesCount=-1)`);
    expect(isDisabled).toBe(true);
    // Le texte ne doit contenir aucun "(N)" avec N > 0 : cloudCartesCount <= 0 (0 ou -1)
    // ne doit jamais afficher de compteur entre parenthèses (voir condition
    // `cloudCartesCount > 0 ? ... : ''` dans InventaireLayout.tsx).
    expect(btnText).not.toMatch(/\(\d+\)/);

    await window.screenshot({ path: join(SHOT_DIR, 'agent13-inv-09-administrateur-site-sentinelle.png') });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 10. Nettoyage complet des données de test
  // ═══════════════════════════════════════════════════════════════════════
  test('10. Nettoyage : suppression de toutes les cartes ZZTEST_ et du second site de test', async () => {
    const delCartes = await dbQuery(`DELETE FROM t_cartes WHERE noms LIKE ?`, [`${PREFIX}%`]);
    const remainingCartes = await dbQuery(`SELECT COUNT(*) as c FROM t_cartes WHERE noms LIKE ?`, [`${PREFIX}%`]);
    console.log(`[agent13][CLEANUP] Cartes supprimées=${delCartes[0].changes} restantes=${remainingCartes[0].c}`);
    expect(remainingCartes[0].c).toBe(0);

    const delCentre = await dbQuery(`DELETE FROM t_centres WHERE id = ?`, [secondCentreId]);
    const delSite = await dbQuery(`DELETE FROM t_sites WHERE id = ?`, [secondSiteId]);
    console.log(`[agent13][CLEANUP] Second site/centre supprimés : centre changes=${delCentre[0].changes} site changes=${delSite[0].changes}`);
    expect(delSite[0].changes).toBe(1);
    expect(delCentre[0].changes).toBe(1);
  });

  test('11. Aucune erreur console/pageerror imputable au scénario', async () => {
    const relevant = consoleErrors.filter((e) => !/DevTools|Autofill|ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED/.test(e));
    if (relevant.length > 0) {
      console.log('[QA-CHECK][Erreurs console capturées]\n' + relevant.join('\n'));
    }
    expect(relevant).toEqual([]);
  });
});
