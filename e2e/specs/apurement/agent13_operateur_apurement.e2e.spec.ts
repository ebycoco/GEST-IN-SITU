/**
 * e2e/specs/apurement/agent13_operateur_apurement.e2e.spec.ts
 *
 * QA Terrain (agent-13) — Vérification vivante du chantier OPERATEUR_APUREMENT
 * (migration v64, nouveau portail dédié /apurement), sur un build FRAIS
 * (`npx electron-vite build` après purge de `node_modules/.vite` — dédup
 * confirmée : 31 modules, un seul `getDatabase()`/`initDatabase()` dans
 * dist/main/index.js).
 *
 * Isolation : instance Electron lancée par `launchSeededApp()` sur un
 * `userDataDir` jetable (`fs.mkdtempSync`) via `--user-data-dir`, réseau
 * Supabase coupé (`GEST_IN_SITU_E2E_DISABLE_SYNC=1`). Aucune base de
 * production n'est jamais touchée par ce fichier.
 *
 * Toutes les cartes de test sont préfixées `ZZTEST_APU`, tous les comptes
 * agent créés via l'UI sont préfixés `ZZTEST_APU_` (login), et nettoyés en
 * fin de fichier avec re-vérification explicite.
 */
import { test, expect } from '@playwright/test';
import {
  launchSeededApp,
  teardownSeededApp,
  type E2EEnvironment
} from '../../fixtures/electron-app';
import { getTestUser } from '../../fixtures/test-users';
import { join } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
// test-results/ est déjà ignoré par git (.gitignore) : emplacement portable pour les
// captures de ce test, indépendant de toute session/machine.
const SHOT_DIR = join(__dirname, '..', '..', '..', 'test-results', 'agent13-screenshots');

const NOW = Date.now();
const PREFIX = 'ZZTEST_APU';

test.describe.serial('QA Terrain — Portail dédié OPERATEUR_APUREMENT (/apurement) (agent-13)', () => {
  let env: E2EEnvironment;
  let anyTestFailed = false;
  const consoleErrors: string[] = [];
  const createdLoginsSuperAdmin: string[] = [];
  const createdLoginsAdminSite: string[] = [];

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

  // ── Helpers génériques (mêmes patterns que _agent13_inventaire_cloud_bar.e2e.spec.ts) ──
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
  // 0. Vérification préalable : user_version = 64 sur la base seedée (migration
  //    neuve v64 exécutée par le VRAI runMigrations(), voir seed-database.ts).
  // ═══════════════════════════════════════════════════════════════════════
  test('0. Base e2e seedée (runMigrations réel) : user_version = 64', async () => {
    const v = await pragmaUserVersion();
    console.log(`[agent13][MIGRATION] user_version de la base e2e neuve = ${v}`);
    expect(v).toBe(64);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 1. Préparation des données de test (cartes ZZTEST_APU pour le scénario d'émargement)
  // ═══════════════════════════════════════════════════════════════════════
  test('1. Préparation : insertion des cartes ZZTEST_APU (cible + homonymes)', async () => {
    await dbQuery(
      `INSERT INTO t_cartes (noms, prenoms, statut, site_id, centre_id, sync_id, is_dirty, date_de_naissance, lieu_de_naissance, num_secu)
       VALUES (?, ?, 'EN STOCK', ?, ?, ?, 0, ?, ?, ?)`,
      [`${PREFIX}_CIBLE`, 'ZETA', env.seed.siteId, env.seed.centreId, `zztest-apu-portail-${NOW}`, '1980-06-20', 'ABOBO', `ZZTEST-APU-PORTAIL-${NOW}`]
    );
    // Deux homonymes pour valider la levée de doute au clavier sur le NOUVEAU portail
    // (même comportement attendu que l'onglet APUREMENT de /inventaire).
    await dbQuery(
      `INSERT INTO t_cartes (noms, prenoms, statut, site_id, centre_id, sync_id, is_dirty, date_de_naissance)
       VALUES (?, ?, 'EN STOCK', ?, ?, ?, 0, ?)`,
      [`${PREFIX}_HOMO`, 'ETA', env.seed.siteId, env.seed.centreId, `zztest-apu-homo1-${NOW}`, '1992-02-02']
    );
    await dbQuery(
      `INSERT INTO t_cartes (noms, prenoms, statut, site_id, centre_id, sync_id, is_dirty, date_de_naissance)
       VALUES (?, ?, 'EN STOCK', ?, ?, ?, 0, ?)`,
      [`${PREFIX}_HOMO`, 'ETA', env.seed.siteId, env.seed.centreId, `zztest-apu-homo2-${NOW}`, '1988-08-08']
    );
    const count = await dbQuery('SELECT COUNT(*) as c FROM t_cartes WHERE noms LIKE ?', [`${PREFIX}%`]);
    expect(count[0].c).toBe(3);
    console.log(`[agent13][SETUP] 3 cartes ${PREFIX}_ insérées (site=${env.seed.siteId}, centre=${env.seed.centreId}).`);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 2. Connexion OPERATEUR_APUREMENT : redirection automatique + sidebar minimale
  // ═══════════════════════════════════════════════════════════════════════
  test('2. OPERATEUR_APUREMENT : connexion → redirection automatique vers /apurement', async () => {
    const user = getTestUser('operateurApurement');
    await login(user.login, user.password, /#\/apurement/);
    const { window } = env;
    await expect(window.locator('text=PORTAIL D\'APUREMENT')).toBeVisible({ timeout: 15000 });
    await window.screenshot({ path: join(SHOT_DIR, 'agent13-apu-01-login-redirect.png') });
  });

  test('3. OPERATEUR_APUREMENT : sidebar réduite aux 3 vues du portail (Vue d\'ensemble/Travail d\'apurement/Cartes déchargées) + Mon Profil', async () => {
    // Depuis la migration des onglets internes d'ApurementLayout.tsx vers de vraies routes
    // (App.tsx, cf. e2e/specs/_agent13_sidebar_4roles_migration.e2e.spec.ts pour la couverture
    // complète de ce changement), la sidebar OPERATEUR_APUREMENT liste les 3 vues directement au
    // lieu d'un lien unique "Apurement Historique" (libellé désormais réservé au raccourci
    // ADMIN_CENTRE/SUPER ADMIN/ADMINISTRATEUR_SITE vers ce même portail).
    const { window } = env;
    const navItems = window.locator('.nav-item');
    await expect(navItems).toHaveCount(4, { timeout: 10000 });
    const labels = await navItems.allTextContents();
    console.log(`[agent13][SIDEBAR] Entrées visibles pour OPERATEUR_APUREMENT : ${JSON.stringify(labels)}`);
    expect(labels.some((l) => l.includes("Vue d'ensemble"))).toBe(true);
    expect(labels.some((l) => l.includes("Travail d'apurement"))).toBe(true);
    expect(labels.some((l) => l.includes('Cartes déchargées'))).toBe(true);
    expect(labels.some((l) => l.includes('Mon Profil'))).toBe(true);
    // Aucune entrée d'administration ne doit fuiter (Agents, Infrastructures, Tableau de bord...).
    expect(labels.some((l) => /Agents|Infrastructures|Tableau de bord|Importation|Exportation/.test(l))).toBe(false);
  });

  test('4. OPERATEUR_APUREMENT : tentative d\'accès direct à /dashboard, /agents, /sites → redirection forcée vers /apurement', async () => {
    const { window } = env;
    for (const forbidden of ['/dashboard', '/agents', '/sites']) {
      await window.evaluate((path) => { window.location.hash = `#${path}`; }, forbidden);
      await window.waitForURL(/#\/apurement/, { timeout: 10000 });
      console.log(`[agent13][ROUTE-GUARD] Accès direct à ${forbidden} correctement bloqué → redirigé vers /apurement.`);
    }
    await window.screenshot({ path: join(SHOT_DIR, 'agent13-apu-02-route-guard.png') });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 5. Fonctionnel : recherche combinée + levée de doute clavier + émargement
  // ═══════════════════════════════════════════════════════════════════════
  test('5. Portail /apurement : recherche + émargement → statut=DELIVRE et relation_retirant en base (identique à l\'onglet /inventaire)', async () => {
    const { window } = env;
    const nomInput = window.locator('input[placeholder="Saisir nom & prénoms..."]');
    await expect(nomInput).toBeVisible({ timeout: 10000 });

    // Cas d'erreur volontaire : recherche avec champs vides.
    await window.getByRole('button', { name: 'Rechercher' }).click();
    await expect(window.locator('text=Veuillez remplir au moins un critère')).toBeVisible({ timeout: 5000 });
    console.log('[agent13][APU-PORTAIL] Cas limite (recherche vide) correctement bloqué.');

    await nomInput.fill(`${PREFIX}_CIBLE`);
    await window.getByRole('button', { name: 'Rechercher' }).click();
    await expect(window.locator(`text=${PREFIX}_CIBLE ZETA`)).toBeVisible({ timeout: 10000 });
    await window.locator(`text=${PREFIX}_CIBLE ZETA`).click();

    await window.locator('input[type="date"]').fill('2026-02-10');
    await window.locator('select').selectOption('ENFANT');
    await window.locator('input[placeholder="Ex: KOUASSI KOFFI JEAN"]').fill(`${PREFIX}_RETIRANT ENFANT`);

    // Cas d'erreur volontaire : téléphone retirant vide → blocage client.
    await window.getByRole('button', { name: /Valider l'Apurement/ }).click();
    await expect(window.locator('text=Le téléphone du retirant est obligatoire.')).toBeVisible({ timeout: 5000 });
    console.log('[agent13][APU-PORTAIL] Cas limite (téléphone vide) correctement bloqué côté client.');

    await window.locator('input[placeholder="Ex: 0707..."]').fill('0102030405');
    await window.getByRole('button', { name: /Valider l'Apurement/ }).click();
    await expect(window.locator('text=Décharge historique enregistrée avec succès.')).toBeVisible({ timeout: 10000 });

    const row = await dbQuery(
      `SELECT statut, date_delivrance, nom_retirant, num_retirant, relation_retirant, agent_distributeur, is_dirty
       FROM t_cartes WHERE sync_id = ?`,
      [`zztest-apu-portail-${NOW}`]
    );
    console.log(`[agent13][APU-PORTAIL] État en base après succès : ${JSON.stringify(row[0])}`);
    expect(row[0].statut).toBe('DELIVRE');
    expect(row[0].is_dirty).toBe(1);
    expect(row[0].date_delivrance).toBe('2026-02-10');
    expect(row[0].nom_retirant).toBe(`${PREFIX}_RETIRANT ENFANT`);
    expect(row[0].num_retirant).toBe('0102030405');
    expect(row[0].relation_retirant).toBe('ENFANT');
    expect(row[0].agent_distributeur).toBe(getTestUser('operateurApurement').login);

    await window.screenshot({ path: join(SHOT_DIR, 'agent13-apu-03-emargement-succes.png') });
  });

  test('6. Portail /apurement : levée de doute homonymes au clavier (touche numérique)', async () => {
    const { window } = env;
    const nomInput = window.locator('input[placeholder="Saisir nom & prénoms..."]');
    await expect(nomInput).toBeVisible({ timeout: 10000 });
    await nomInput.fill(`${PREFIX}_HOMO`);
    await window.getByRole('button', { name: 'Rechercher' }).click();
    await expect(window.locator(`text=${PREFIX}_HOMO ETA`)).toHaveCount(2, { timeout: 10000 });

    const dates = await window.locator('text=/Né\\(e\\) le \\d{4}-\\d{2}-\\d{2}/').allTextContents();
    console.log(`[agent13][APU-PORTAIL][HOMONYMES] Ordre affiché : ${JSON.stringify(dates)}`);
    expect(dates.length).toBe(2);
    const secondDate = dates[1].match(/\d{4}-\d{2}-\d{2}/)?.[0];

    // ── Constat empirique (échec initial de ce test) ────────────────────────
    // Le bouton "RECHERCHER" est `disabled={loading}` pendant l'appel IPC
    // asynchrone : le cliquer avec la souris lui donne le focus, puis le
    // désactiver brièvement pendant `loading=true` fait perdre le focus au
    // `document.body` (comportement navigateur standard). `window.keyboard.press()`
    // dispatche alors l'événement clavier SUR `document.body`, qui n'est PAS un
    // descendant du <div onKeyDown={handleKeyDown}> englobant (il est un
    // ANCÊTRE) : l'événement ne bubble donc jamais jusqu'au handler, et la
    // touche numérique reste sans effet — la liste de résultats reste affichée
    // telle quelle (silencieusement, aucune erreur visible pour l'agent de
    // terrain). Reproduit à l'identique sur ce composant `InventaireApurement.tsx`
    // partagé (voir rapport final, P1 — l'onglet /inventaire ne l'a jamais
    // testé au clavier non plus, seulement à la souris). Un clic explicite sur
    // le champ de recherche restaure un focus correct (descendant du wrapper)
    // avant la frappe, comme le ferait un agent revenant au clavier après avoir
    // cliqué "RECHERCHER" à la souris.
    await nomInput.click();
    await window.keyboard.press('2');
    // Marqueur non ambigu de la transition RÉELLE vers le formulaire d'émargement
    // (contrairement à un simple texte de date, présent aussi dans la liste de
    // résultats non filtrée — cause du faux positif initial de ce test).
    const dossierSelectionne = window.locator('text=Dossier Sélectionné');
    await expect(dossierSelectionne).toBeVisible({ timeout: 10000 });
    await expect(window.locator(`text=${secondDate}`)).toBeVisible({ timeout: 10000 });
    console.log(`[agent13][APU-PORTAIL][HOMONYMES] Touche "2" a bien sélectionné le 2e résultat (${secondDate}) — formulaire d'émargement confirmé affiché.`);
    // Annuler (pas de modification voulue sur ce cas).
    await window.getByRole('button', { name: 'Annuler' }).click();
    await window.locator('input[placeholder="Saisir nom & prénoms..."]').fill('');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 7. Barre de synchro cloud du portail dédié
  // ═══════════════════════════════════════════════════════════════════════
  test('7. Portail /apurement : barre de synchro cloud (badge, Actualiser, Récupérer, Envoyer) présente et cohérente', async () => {
    const { window } = env;
    const badge = window.locator('text=Cartes disponibles en local :').locator('xpath=..');
    await expect(badge).toBeVisible({ timeout: 20000 });
    const expectedTotal = (await dbQuery('SELECT COUNT(*) as c FROM t_cartes WHERE site_id = ?', [env.seed.siteId]))[0].c;
    const badgeValue = Number(((await badge.textContent()) || '').replace(/[^\d]/g, ''));
    console.log(`[agent13][APU-PORTAIL][BADGE] Affiché=${badgeValue} | Attendu (COUNT site=${env.seed.siteId})=${expectedTotal}`);
    expect(badgeValue).toBe(expectedTotal);

    const refreshBtn = window.getByRole('button', { name: /Actualiser/ });
    await expect(refreshBtn).toBeVisible();
    await refreshBtn.click();
    await window.waitForTimeout(1000);

    const pullBtn = window.getByRole('button', { name: /RÉCUPÉRATION EN COURS|RÉCUPÉRER LES CARTES DEPUIS LE CLOUD/ });
    await expect(pullBtn).toBeVisible({ timeout: 15000 });
    await window.waitForTimeout(9000); // 3 tentatives x 2.5s (réseau coupé) → sentinelle -1.
    const isPullDisabled = await pullBtn.isDisabled();
    console.log(`[agent13][APU-PORTAIL][PULL-BTN] disabled=${isPullDisabled} (attendu: true, réseau coupé → sentinelle -1)`);
    expect(isPullDisabled).toBe(true);

    const sendBtn = window.getByRole('button', { name: /Envoyer les corrections|ENVOI/ });
    await expect(sendBtn).toBeVisible();
    // Une carte conforme is_dirty=1 existe déjà (celle émargée au test 5) : le bouton doit
    // être activé après Actualiser (mêmes règles que InventaireLayout/AgentQualiteLayout).
    const isSendDisabled = await sendBtn.isDisabled();
    console.log(`[agent13][APU-PORTAIL][SEND-BTN] disabled=${isSendDisabled} (attendu: false, une carte conforme is_dirty=1 existe déjà)`);
    expect(isSendDisabled).toBe(false);

    await window.screenshot({ path: join(SHOT_DIR, 'agent13-apu-04-cloud-bar.png') });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 8. Création du rôle OPERATEUR_APUREMENT par SUPER ADMIN
  // ═══════════════════════════════════════════════════════════════════════
  test('8. SUPER ADMIN : création d\'un compte OPERATEUR_APUREMENT via AgentsPage → succès + DB (t_users + t_user_roles)', async () => {
    await logout();
    const superAdmin = getTestUser('superAdmin');
    await login(superAdmin.login, superAdmin.password, /#\/dashboard/);

    const { window } = env;
    // SUPER ADMIN opère multi-site : "Sélectionnez un site" (contexte opérationnel, sidebar)
    // verrouille tous les modules de gestion (dont /agents, overlay "Chargement sécurisé en
    // cours...") tant qu'aucun site actif n'est choisi — constat empirique (1er run de ce
    // test), comportement voulu de l'application, pas un bug.
    await window.locator('select.site-select').selectOption({ label: 'Site E2E Test' });
    // Constat empirique : sauter directement au hash "#/agents" juste après le login
    // (avant la fin du cycle de "Chargement sécurisé en cours..." déclenché par le
    // premier rendu du Dashboard) laisse l'overlay de chargement bloqué visuellement et
    // intercepte tous les clics indéfiniment. Navigation réaliste via le lien de sidebar
    // réel (comme le fait déjà _agent13_inventaire_cloud_bar.e2e.spec.ts pour
    // ADMINISTRATEUR_SITE) : attend que l'overlay disparaisse, puis clique "Agents".
    await expect(window.locator('text=Chargement sécurisé en cours')).toBeHidden({ timeout: 30000 });
    await window.getByText('Agents', { exact: true }).click();
    await window.waitForURL(/#\/agents/, { timeout: 15000 });

    await window.getByText('Nouvel Agent').click();
    const newLogin = `ZZTEST_APU_SA_${NOW}`;
    createdLoginsSuperAdmin.push(newLogin);

    await window.locator('input[placeholder="ex: agent_abobo"]').fill(newLogin);
    await window.locator('input[placeholder="••••••••"]').fill('ZZTest_Pwd_2026!');
    await window.locator('input[placeholder="NOM DE FAMILLE"]').fill('ZZTEST_APU_SA');
    await window.locator('input[placeholder="Prénoms"]').fill('CREESUPERADMIN');

    // Constat empirique (1er run) : `formData.roles` démarre pré-coché sur
    // ['OPERATEUR_VERIFICATION'] (valeur par défaut du formulaire, AgentsPage.tsx) et
    // `toggleRole()` refuse de décocher un rôle si c'est le SEUL sélectionné ("Au moins
    // un rôle est requis"). Ordre obligatoire : cocher OPERATEUR_APUREMENT D'ABORD (rend
    // le tableau ['OPERATEUR_VERIFICATION','OPERATEUR_APUREMENT'], longueur 2), PUIS
    // décocher OPERATEUR_VERIFICATION (autorisé une fois longueur > 1) — le rôle primaire
    // enregistré est `currentRoles[0]`, donc OPERATEUR_APUREMENT devient bien le rôle
    // primaire une fois seul restant. Comportement du formulaire inchangé par ce chantier,
    // simple correction de scénario de test.
    const roleCheckbox = window.locator('label', { hasText: 'Opérateur Apurement (Émargement historique)' });
    await expect(roleCheckbox).toBeVisible({ timeout: 5000 });
    await roleCheckbox.click();
    const defaultRoleCheckbox = window.locator('label', { hasText: 'Opérateur de Vérification (Recherche & Délivrance)' });
    await defaultRoleCheckbox.click();

    // Affectation centre obligatoire pour un rôle OPERATEUR_*.
    // Scopé au <form> du modal de création (pas le site-select global de la sidebar,
    // visible uniquement pour SUPER ADMIN et situé hors de ce <form>).
    await window.locator('form select').selectOption({ label: 'Centre E2E Test (Site E2E Test)' });

    await window.getByRole('button', { name: 'Créer l\'agent' }).click();
    await expect(window.locator('text=Agent créé avec succès')).toBeVisible({ timeout: 10000 });

    const row = await dbQuery(
      `SELECT id_user, role, site_id, centre_id FROM t_users WHERE login = ?`,
      [newLogin]
    );
    console.log(`[agent13][CREATE][SUPER ADMIN] Compte créé en base : ${JSON.stringify(row[0])}`);
    expect(row.length).toBe(1);
    expect(row[0].role).toBe('OPERATEUR_APUREMENT');
    const rolesRow = await dbQuery(`SELECT role FROM t_user_roles WHERE id_user = ?`, [row[0].id_user]);
    expect(rolesRow.map((r) => r.role)).toContain('OPERATEUR_APUREMENT');

    await window.screenshot({ path: join(SHOT_DIR, 'agent13-apu-05-create-by-superadmin.png') });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 9. Connexion avec le compte fraîchement créé (bcrypt + CHECK cohérents bout-en-bout)
  // ═══════════════════════════════════════════════════════════════════════
  test('9. Connexion avec le compte OPERATEUR_APUREMENT créé par SUPER ADMIN → redirection /apurement (bout-en-bout)', async () => {
    await logout();
    const newLogin = createdLoginsSuperAdmin[0];
    await login(newLogin, 'ZZTest_Pwd_2026!', /#\/apurement/);
    const { window } = env;
    await expect(window.locator('text=PORTAIL D\'APUREMENT')).toBeVisible({ timeout: 15000 });
    console.log('[agent13][E2E-LOGIN] Compte créé via UI par SUPER ADMIN se connecte bien et atterrit sur /apurement.');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 10. Création du rôle OPERATEUR_APUREMENT par ADMINISTRATEUR_SITE
  // ═══════════════════════════════════════════════════════════════════════
  test('10. ADMINISTRATEUR_SITE : création d\'un compte OPERATEUR_APUREMENT via AgentsPage → succès + DB', async () => {
    await logout();
    const adminSite = getTestUser('administrateurSite');
    await login(adminSite.login, adminSite.password, /#\/dashboard/);

    const { window } = env;
    await expect(window.locator('text=Chargement sécurisé en cours')).toBeHidden({ timeout: 30000 });
    await window.getByText('Agents', { exact: true }).click();
    await window.waitForURL(/#\/agents/, { timeout: 15000 });

    await window.getByText('Nouvel Agent').click();
    const newLogin = `ZZTEST_APU_AS_${NOW}`;
    createdLoginsAdminSite.push(newLogin);

    await window.locator('input[placeholder="ex: agent_abobo"]').fill(newLogin);
    await window.locator('input[placeholder="••••••••"]').fill('ZZTest_Pwd_2026!');
    await window.locator('input[placeholder="NOM DE FAMILLE"]').fill('ZZTEST_APU_AS');
    await window.locator('input[placeholder="Prénoms"]').fill('CREEADMINSITE');

    // Constat empirique (1er run) : `formData.roles` démarre pré-coché sur
    // ['OPERATEUR_VERIFICATION'] (valeur par défaut du formulaire, AgentsPage.tsx) et
    // `toggleRole()` refuse de décocher un rôle si c'est le SEUL sélectionné ("Au moins
    // un rôle est requis"). Ordre obligatoire : cocher OPERATEUR_APUREMENT D'ABORD (rend
    // le tableau ['OPERATEUR_VERIFICATION','OPERATEUR_APUREMENT'], longueur 2), PUIS
    // décocher OPERATEUR_VERIFICATION (autorisé une fois longueur > 1) — le rôle primaire
    // enregistré est `currentRoles[0]`, donc OPERATEUR_APUREMENT devient bien le rôle
    // primaire une fois seul restant. Comportement du formulaire inchangé par ce chantier,
    // simple correction de scénario de test.
    const roleCheckbox = window.locator('label', { hasText: 'Opérateur Apurement (Émargement historique)' });
    await expect(roleCheckbox).toBeVisible({ timeout: 5000 });
    await roleCheckbox.click();
    const defaultRoleCheckbox = window.locator('label', { hasText: 'Opérateur de Vérification (Recherche & Délivrance)' });
    await defaultRoleCheckbox.click();
    // Scopé au <form> du modal de création (pas le site-select global de la sidebar,
    // visible uniquement pour SUPER ADMIN et situé hors de ce <form>).
    await window.locator('form select').selectOption({ label: 'Centre E2E Test (Site E2E Test)' });

    await window.getByRole('button', { name: 'Créer l\'agent' }).click();
    await expect(window.locator('text=Agent créé avec succès')).toBeVisible({ timeout: 10000 });

    const row = await dbQuery(`SELECT id_user, role FROM t_users WHERE login = ?`, [newLogin]);
    console.log(`[agent13][CREATE][ADMINISTRATEUR_SITE] Compte créé en base : ${JSON.stringify(row[0])}`);
    expect(row.length).toBe(1);
    expect(row[0].role).toBe('OPERATEUR_APUREMENT');

    await window.screenshot({ path: join(SHOT_DIR, 'agent13-apu-06-create-by-adminsite.png') });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 11. ADMIN_CENTRE : ni exposition UI, ni contournement serveur
  // ═══════════════════════════════════════════════════════════════════════
  test('11. ADMIN_CENTRE : /agents totalement inaccessible (route bloquée AVANT le filtrage de rôles du formulaire)', async () => {
    await logout();
    const adminCentre = getTestUser('adminCentre');
    await login(adminCentre.login, adminCentre.password, /#\/admin-centre/);

    const { window } = env;
    await window.evaluate(() => { window.location.hash = '#/agents'; });
    // ProtectedRoute (App.tsx, requiredRoles=['SUPER ADMIN','ADMINISTRATEUR_SITE']) redirige
    // vers "/", que RoleRedirect renvoie ensuite vers /admin-centre pour ce rôle : ADMIN_CENTRE
    // ne peut donc JAMAIS voir le formulaire de création d'agent (le filtrage de rôles interne
    // à AgentsPage.tsx pour ADMIN_CENTRE est du code mort côté navigation réelle — non
    // atteignable via l'UI, cf. rapport final).
    await window.waitForURL(/#\/admin-centre/, { timeout: 10000 });
    console.log('[agent13][ADMIN_CENTRE] Accès direct à /agents bloqué au niveau routeur, jamais atteint le formulaire.');
    await window.screenshot({ path: join(SHOT_DIR, 'agent13-apu-07-admincentre-agents-blocked.png') });
  });

  test('12. ADMIN_CENTRE : tentative forcée côté IPC (users:create, role=OPERATEUR_APUREMENT) → rejetée côté serveur', async () => {
    const { window } = env;
    const result = await window.evaluate(async () => {
      try {
        await (window as any).api.users.create({
          login: `ZZTEST_APU_FORCED_${Date.now()}`,
          password: 'ZZTest_Pwd_2026!',
          role: 'OPERATEUR_APUREMENT',
          roles: ['OPERATEUR_APUREMENT'],
          nom_user: 'ZZTEST_FORCED',
          prenom_user: 'ADMINCENTRE'
        });
        return { rejected: false };
      } catch (err: any) {
        return { rejected: true, message: err?.message || String(err) };
      }
    });
    console.log(`[agent13][SECURITY][ADMIN_CENTRE→users:create] Résultat de la tentative forcée : ${JSON.stringify(result)}`);
    expect(result.rejected).toBe(true);
    expect(result.message).toMatch(/Accès non autorisé/i);

    const forcedRow = await dbQuery(`SELECT COUNT(*) as c FROM t_users WHERE login LIKE ?`, ['ZZTEST_APU_FORCED_%']);
    expect(forcedRow[0].c).toBe(0);
    console.log('[agent13][SECURITY] Aucun compte OPERATEUR_APUREMENT créé en base malgré la tentative forcée par ADMIN_CENTRE : confirmé.');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 13. Sécurité : cartes:searchCombinedInventaire rejette un rôle non autorisé
  // ═══════════════════════════════════════════════════════════════════════
  test('13. [P0 sécurité] cartes:searchCombinedInventaire rejette un rôle non autorisé (OPERATEUR_SAISIE)', async () => {
    await logout();
    const saisie = getTestUser('operateurSaisie');
    await login(saisie.login, saisie.password, /#\/agent-saisie/);

    const { window } = env;
    const result = await window.evaluate(async (siteId) => {
      try {
        const res = await (window as any).api.cartes.searchCombinedInventaire(siteId, 'TEST', '', '');
        return { rejected: false, res };
      } catch (err: any) {
        return { rejected: true, message: err?.message || String(err) };
      }
    }, env.seed.siteId);
    console.log(`[agent13][SECURITY][OPERATEUR_SAISIE→searchCombinedInventaire] Résultat : ${JSON.stringify(result)}`);
    expect(result.rejected).toBe(true);
    expect(result.message).toMatch(/Accès refusé/i);
  });

  test('14. [Non-régression] cartes:searchCombinedInventaire fonctionne toujours pour OPERATEUR_APUREMENT (rôle nouvellement autorisé)', async () => {
    await logout();
    const apurement = getTestUser('operateurApurement');
    await login(apurement.login, apurement.password, /#\/apurement/);

    const { window } = env;
    const result = await window.evaluate(async ({ siteId, query }) => {
      try {
        const res = await (window as any).api.cartes.searchCombinedInventaire(siteId, query, '', '');
        return { rejected: false, count: Array.isArray(res) ? res.length : null };
      } catch (err: any) {
        return { rejected: true, message: err?.message || String(err) };
      }
    }, { siteId: env.seed.siteId, query: 'NOM_DE_TEST_QUELCONQUE' });
    console.log(`[agent13][NON-REG][OPERATEUR_APUREMENT→searchCombinedInventaire] Résultat : ${JSON.stringify(result)}`);
    expect(result.rejected).toBe(false);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 15. Nettoyage complet des données de test
  // ═══════════════════════════════════════════════════════════════════════
  test('15. Nettoyage : suppression des cartes ZZTEST_APU et des comptes agents créés', async () => {
    await logout();

    const delCartes = await dbQuery(`DELETE FROM t_cartes WHERE noms LIKE ?`, [`${PREFIX}%`]);
    const remainingCartes = await dbQuery(`SELECT COUNT(*) as c FROM t_cartes WHERE noms LIKE ?`, [`${PREFIX}%`]);
    console.log(`[agent13][CLEANUP] Cartes ZZTEST_APU supprimées=${delCartes[0].changes} restantes=${remainingCartes[0].c}`);
    expect(remainingCartes[0].c).toBe(0);

    const allCreatedLogins = [...createdLoginsSuperAdmin, ...createdLoginsAdminSite];
    for (const login of allCreatedLogins) {
      const userRow = await dbQuery(`SELECT id_user FROM t_users WHERE login = ?`, [login]);
      if (userRow.length > 0) {
        // Constat empirique : t_logs.id_user REFERENCES t_users(id_user) SANS ON DELETE
        // CASCADE (contrairement à t_user_roles) — le compte s'étant connecté au test 9 a
        // laissé une entrée d'audit ("connexion") qui bloque un DELETE physique direct sur
        // t_users (FOREIGN KEY constraint failed). L'app elle-même ne fait d'ailleurs jamais
        // de DELETE physique local sur t_users (hardDeleteUser() dans users.queries.ts fait
        // un soft-delete statut_actif=-1 + outbox) : ce nettoyage e2e purge explicitement
        // t_logs d'abord pour obtenir un DELETE physique propre, sans quoi la base de test
        // jetable resterait avec un enregistrement orphelin (sans conséquence réelle
        // puisqu'elle est de toute façon détruite par teardownSeededApp, mais on nettoie
        // par principe et pour garder l'assertion de comptage exacte).
        await dbQuery(`DELETE FROM t_logs WHERE id_user = ?`, [userRow[0].id_user]);
        await dbQuery(`DELETE FROM t_user_roles WHERE id_user = ?`, [userRow[0].id_user]);
        await dbQuery(`DELETE FROM t_users WHERE id_user = ?`, [userRow[0].id_user]);
      }
    }
    const remainingUsers = await dbQuery(`SELECT COUNT(*) as c FROM t_users WHERE login LIKE 'ZZTEST_APU_%'`);
    console.log(`[agent13][CLEANUP] Comptes agents créés supprimés : ${JSON.stringify(allCreatedLogins)}. Restants='ZZTEST_APU_%' : ${remainingUsers[0].c}`);
    expect(remainingUsers[0].c).toBe(0);
  });

  test('16. Aucune erreur console/pageerror imputable au scénario', async () => {
    const relevant = consoleErrors.filter((e) => !/DevTools|Autofill|ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED/.test(e));
    if (relevant.length > 0) {
      console.log('[QA-CHECK][Erreurs console capturées]\n' + relevant.join('\n'));
    }
    expect(relevant).toEqual([]);
  });
});
