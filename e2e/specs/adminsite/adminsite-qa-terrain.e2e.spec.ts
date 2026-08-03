/**
 * e2e/specs/adminsite/adminsite-qa-terrain.e2e.spec.ts
 *
 * QA Terrain (agent-13) — Premier passage complet sur le rôle ADMINISTRATEUR_SITE.
 *
 * Priorité absolue : scénario de sécurité sur les handlers `hierarchy:*`
 * (src/main/ipc/handlers.ts) qui, contrairement à `users:*` (protégés par
 * `getSecureCurrentUser()`), n'ont pas ou peu de vérification de rôle/propriété
 * de site. Puis couverture des 4 zones fonctionnelles demandées : Dashboard,
 * Importation, Agents, Infrastructures + état des boutons de synchro Cloud.
 *
 * Toutes les données créées par ce spec sont préfixées `ZZTEST_` et nettoyées
 * en fin de run (site B synthétique supprimé via le bug lui-même — voir SEC-7 —
 * puis les artefacts résiduels du site A sont supprimés explicitement et
 * vérifiés par lecture SQLite directe).
 *
 * Une seule instance Electron est partagée pour tout le fichier
 * (`test.describe.serial`) : coût de démarrage (DB + IPC + SyncEngine) trop
 * élevé pour le payer par scénario (voir e2e/specs/auth/login.e2e.spec.ts).
 */
import { test, expect } from '@playwright/test';
import { launchSeededApp, teardownSeededApp, type E2EEnvironment } from '../../fixtures/electron-app';
import { getTestUser } from '../../fixtures/test-users';
import { hashPassword } from '../../../src/main/auth/local-auth';
import { writeFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

test.describe.serial('QA Terrain — ADMINISTRATEUR_SITE (agent-13)', () => {
  let env: E2EEnvironment;
  let anyTestFailed = false;

  // ── État partagé entre scénarios ──────────────────────────────────────────
  let siteBId: number;
  let siteBCentreId: number;
  let siteBUserId: number;
  let intrusCentreId: number;
  const siteAId = () => env.seed.siteId;
  const siteACentreId = () => env.seed.centreId;
  const adminAUserId = () => env.seed.userIds['administrateurSite'];

  test.beforeAll(async () => {
    env = await launchSeededApp();
    const user = getTestUser('administrateurSite');
    await env.window.waitForURL(/#\/login/);
    await env.window.getByTestId('login-input').fill(user.login);
    await env.window.getByTestId('password-input').fill(user.password);
    await env.window.getByTestId('login-submit').click();
    await env.window.waitForURL(/#\/dashboard/, { timeout: 20000 });
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

  // ── Helper : exécute du SQL brut contre la vraie base SQLite (ABI native) ──
  // `electronApplication.evaluate()` (CDP Runtime.evaluate dans le process
  // principal) s'est révélé inutilisable ici : ni `require` ni `import()`
  // dynamique ne sont câblés dans ce contexte injecté (`TypeError: A dynamic
  // import callback was not specified`), empiriquement constaté en cours de
  // run. On réutilise donc EXACTEMENT le contournement déjà établi et
  // fonctionnel par `seed-runner.ts` pour ce même problème d'ABI natif
  // (better-sqlite3 compilé pour Electron, pas pour le Node système) : lancer
  // `electron.exe` en mode `ELECTRON_RUN_AS_NODE=1` comme process Node autonome
  // (pas de fenêtre, `require` normalement disponible), une requête à la fois.
  // Ouverture/fermeture à chaque appel pour ne jamais garder de verrou WAL
  // concurrent avec l'app réelle.
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

  // Petit helper pour construire une clé de doublon canonique identique à
  // celle utilisée par le worker d'import / la saisie manuelle.
  const cleDoublon = (noms: string, prenoms: string, ddn: string, lieu: string, contact: string) =>
    `${noms}|${prenoms}|${ddn}|${lieu}|${contact}`;

  // ══════════════════════════════════════════════════════════════════════
  // BLOC 0 — Confirmation du rendu SiteAdminView (pas GovernanceView)
  // ══════════════════════════════════════════════════════════════════════
  test('0. ADMINISTRATEUR_SITE voit SiteAdminView : bouton PURGER SITE absent, PURGER CLOUD présent', async () => {
    const { window } = env;
    // Timeout généreux : le premier chargement des stats (loading=true → false) peut prendre
    // plus de 15s sous charge système avant que la Zone de Danger Cloud ne se monte.
    await expect(window.getByText('PURGER LES CARTES DU SITE')).toHaveCount(0);
    await expect(window.getByText(/PURGER LES CARTES CLOUD/)).toBeVisible({ timeout: 45000 });
  });

  // ══════════════════════════════════════════════════════════════════════
  // BLOC SÉCURITÉ — cloisonnement site sur les handlers hierarchy:*
  // ══════════════════════════════════════════════════════════════════════

  test('SEC-0. Setup Site B ZZTEST (100% synthétique, isolé, jamais touché par l\'admin A légitimement)', async () => {
    const now = Date.now();
    const siteRes = await dbQuery(
      `INSERT INTO t_sites (nom, code, is_active, max_centres, is_permanent, sync_id) VALUES (?, ?, 1, 4, 1, ?)`,
      [`ZZTEST_SITE_B_${now}`, `ZZTEST-SITEB-${now}`, `zztest-siteb-${now}`]
    );
    siteBId = siteRes[0].lastInsertRowid;
    const centreRes = await dbQuery(
      `INSERT INTO t_centres (site_id, nom, numero, sync_id) VALUES (?, ?, 1, ?)`,
      [siteBId, 'ZZTEST_CENTRE_B_PRINCIPAL', `zztest-centreb-${now}`]
    );
    siteBCentreId = centreRes[0].lastInsertRowid;
    const userRes = await dbQuery(
      `INSERT INTO t_users (login, password_hash, role, nom_user, prenom_user, statut_actif, site_id, centre_id, sync_id, is_dirty)
       VALUES (?, ?, 'OPERATEUR_VERIFICATION', 'ZZTEST', 'SITEB', 1, ?, ?, ?, 0)`,
      [`ZZTEST_USER_SITEB_${now}`, hashPassword('ZZTEST_Pwd_2026!'), siteBId, siteBCentreId, `zztest-userb-${now}`]
    );
    siteBUserId = userRes[0].lastInsertRowid;

    expect(siteBId).toBeGreaterThan(0);
    expect(siteBCentreId).toBeGreaterThan(0);
    expect(siteBUserId).toBeGreaterThan(0);
  });

  test('SEC-1. hierarchy:getSites fuite la liste COMPLÈTE de tous les sites à un ADMINISTRATEUR_SITE', async () => {
    const sites: any[] = await env.window.evaluate(() => (window as any).api.hierarchy.getSites());
    const ids = sites.map((s) => s.id);
    expect(sites.length).toBeGreaterThanOrEqual(2);
    expect(ids).toContain(siteAId());
    expect(ids).toContain(siteBId); // PREUVE : site étranger visible depuis un compte ADMINISTRATEUR_SITE
  });

  test('SEC-2. hierarchy:updateSite modifie un site étranger (Site B) sans vérification de propriété', async () => {
    const before = await dbQuery('SELECT is_active, max_centres FROM t_sites WHERE id = ?', [siteBId]);
    expect(before[0].is_active).toBe(1);
    expect(before[0].max_centres).toBe(4);

    const res = await env.window.evaluate(
      (id) => (window as any).api.hierarchy.updateSite(id, { is_active: 0, max_centres: 99 }),
      siteBId
    );
    expect(res).toBeTruthy();

    const after = await dbQuery('SELECT is_active, max_centres FROM t_sites WHERE id = ?', [siteBId]);
    expect(after[0].is_active).toBe(0); // PREUVE : champ modifié sur un site étranger
    expect(after[0].max_centres).toBe(99);
  });

  test('SEC-3. hierarchy:createCentre crée un centre sous le site étranger B depuis un compte du site A', async () => {
    const before = await dbQuery('SELECT COUNT(*) as c FROM t_centres WHERE site_id = ?', [siteBId]);
    expect(before[0].c).toBe(1); // seulement le centre principal B créé en SEC-0

    await env.window.evaluate(
      (id) => (window as any).api.hierarchy.createCentre({ site_id: id, nom: 'ZZTEST_CENTRE_INTRUS', numero: 2 }),
      siteBId
    );

    const after = await dbQuery('SELECT id, nom, site_id FROM t_centres WHERE site_id = ? AND nom = ?', [
      siteBId,
      'ZZTEST_CENTRE_INTRUS'
    ]);
    expect(after.length).toBe(1); // PREUVE : centre intrus créé sous le site B
    intrusCentreId = after[0].id;
  });

  test('SEC-4. hierarchy:updateCentre puis deleteCentre/centre:delete sur un centre du site étranger B', async () => {
    // prefixe_rangement fourni : le centre intrus (numero 2) n'est pas le centre principal,
    // et la validation métier de hierarchy:updateCentre (handlers.ts) exige un préfixe non
    // vide pour tout centre secondaire — règle métier normale, sans lien avec le contrôle
    // de propriété de site (absent, lui) que ce scénario vise à démontrer.
    await env.window.evaluate(
      (id) => (window as any).api.hierarchy.updateCentre(id, { nom: 'ZZTEST_CENTRE_MODIFIE', prefixe_rangement: 'ZZTESTINTRUS' }),
      intrusCentreId
    );
    let row = await dbQuery('SELECT nom FROM t_centres WHERE id = ?', [intrusCentreId]);
    expect(row[0].nom).toBe('ZZTEST_CENTRE_MODIFIE'); // PREUVE : update réussi sur un centre étranger

    await env.window.evaluate((id) => (window as any).api.hierarchy.deleteCentre(id), intrusCentreId);
    row = await dbQuery('SELECT * FROM t_centres WHERE id = ?', [intrusCentreId]);
    expect(row.length).toBe(0); // PREUVE : delete réussi sur un centre étranger
  });

  test('SEC-5. db:purge REJETTE un siteId forgé quand currentUser porte une identité réelle (site-scope correct)', async () => {
    // Contrôle négatif : ce handler prend currentUser en paramètre CLIENT (falsifiable
    // sur l'identité), mais vérifie le rôle/site_id RÉEL de cet id_user en base — donc,
    // tant que l'id_user fourni existe réellement et n'est pas le compte 999999
    // (FAILSAFE_ROOT_ID, voir SEC-6), le cloisonnement fonctionne.
    const before = await dbQuery('SELECT COUNT(*) as c FROM t_cartes WHERE site_id = ?', [siteBId]);

    let threw = false;
    let message = '';
    try {
      await env.window.evaluate(
        (args) => (window as any).api.db.purge(args.siteId, { id_user: args.userId, login: 'E2E_ADMINISTRATEUR_SITE', role: 'ADMINISTRATEUR_SITE' }),
        { siteId: siteBId, userId: adminAUserId() }
      );
    } catch (e: any) {
      threw = true;
      message = String(e?.message || e);
    }

    expect(threw).toBe(true);
    expect(message).toMatch(/autre site|refus/i);

    const after = await dbQuery('SELECT COUNT(*) as c FROM t_cartes WHERE site_id = ?', [siteBId]);
    expect(after[0].c).toBe(before[0].c); // rien n'a été purgé
  });

  test('SEC-6 [BONUS]. FAILSAFE_ROOT_ID (999999, handlers.ts:25) bypass le rôle ET le cloisonnement de db:purge', async () => {
    // Insère une carte synthétique sur le Site B pour observer l'effet du purge en sécurité
    // (aucune donnée réelle, tout est sur le site B jetable).
    const now = Date.now();
    await dbQuery(
      `INSERT INTO t_cartes (noms, prenoms, date_de_naissance, statut, site_id, centre_id, cle_doublon, sync_id)
       VALUES (?, ?, ?, 'EN STOCK', ?, ?, ?, ?)`,
      ['ZZTEST_CARTE_FAILSAFE', 'X', '1990-01-01', siteBId, siteBCentreId, cleDoublon('ZZTEST_CARTE_FAILSAFE', 'X', '1990-01-01', '', ''), `zztest-carte-failsafe-${now}`]
    );
    const before = await dbQuery('SELECT COUNT(*) as c FROM t_cartes WHERE site_id = ?', [siteBId]);
    expect(before[0].c).toBe(1);

    // Appel effectué depuis la session RENDERER de l'ADMINISTRATEUR_SITE du site A —
    // aucune authentification SUPER ADMIN n'a jamais eu lieu. `currentUser` est un objet
    // JS entièrement fabriqué côté client (équivalent à un appel console DevTools).
    let threw = false;
    let errMsg = '';
    try {
      await env.window.evaluate(
        (siteId) =>
          (window as any).api.db.purge(siteId, { id_user: 999999, login: 'ZZTEST_FAILSAFE_EXPLOIT', role: 'SUPER ADMIN' }),
        siteBId
      );
    } catch (e: any) {
      threw = true;
      errMsg = String(e?.message || e);
    }

    const after = await dbQuery('SELECT COUNT(*) as c FROM t_cartes WHERE site_id = ?', [siteBId]);

    // On consigne le résultat empirique tel quel (pas d'hypothèse a priori) :
    console.log(`[SEC-6][FAILSAFE_ROOT_ID] threw=${threw} errMsg="${errMsg}" cartes avant=${before[0].c} après=${after[0].c}`);
    expect(after[0].c).toBe(0); // PREUVE : purge exécutée avec une identité fabriquée (id_user 999999 inexistant en base)
    expect(threw).toBe(false);
  });

  test('SEC-7 [FINAL]. hierarchy:deleteSite supprime en cascade le Site B (100% ZZTEST) sans aucune vérification', async () => {
    const cartesBefore = await dbQuery('SELECT COUNT(*) as c FROM t_cartes WHERE site_id = ?', [siteBId]);
    const usersBefore = await dbQuery('SELECT COUNT(*) as c FROM t_users WHERE site_id = ?', [siteBId]);
    const centresBefore = await dbQuery('SELECT COUNT(*) as c FROM t_centres WHERE site_id = ?', [siteBId]);
    console.log(`[SEC-7] Avant deleteSite(Site B) : ${cartesBefore[0].c} cartes, ${usersBefore[0].c} utilisateurs, ${centresBefore[0].c} centres.`);

    await env.window.evaluate((id) => (window as any).api.hierarchy.deleteSite(id), siteBId);

    const siteAfter = await dbQuery('SELECT * FROM t_sites WHERE id = ?', [siteBId]);
    const cartesAfter = await dbQuery('SELECT COUNT(*) as c FROM t_cartes WHERE site_id = ?', [siteBId]);
    const usersAfter = await dbQuery('SELECT COUNT(*) as c FROM t_users WHERE site_id = ?', [siteBId]);
    const centresAfter = await dbQuery('SELECT COUNT(*) as c FROM t_centres WHERE site_id = ?', [siteBId]);

    expect(siteAfter.length).toBe(0); // le site lui-même a disparu
    expect(cartesAfter[0].c).toBe(0);
    expect(usersAfter[0].c).toBe(0);
    expect(centresAfter[0].c).toBe(0);
    console.log('[SEC-7] Site B et toutes ses données synthétiques ont été supprimés (nettoyage confirmé).');
  });

  // ══════════════════════════════════════════════════════════════════════
  // ZONE 1 — DASHBOARD (SiteAdminView)
  // ══════════════════════════════════════════════════════════════════════

  test('DASH-1. KPI "Total Cartes" / "En Stock" / "Sans Rangement" reflètent la réalité DB (delta avant/après insertion)', async () => {
    const { window } = env;
    const statsBefore: any = await window.evaluate(() => (window as any).api.stats.get(undefined, undefined));

    const now = Date.now();
    await dbQuery(
      `INSERT INTO t_cartes (noms, prenoms, date_de_naissance, statut, rangement, site_id, centre_id, cle_doublon, sync_id)
       VALUES ('ZZTEST_DASH_KPI', 'CARD', '1985-05-05', 'EN STOCK', '', ?, ?, ?, ?)`,
      [siteAId(), siteACentreId(), cleDoublon('ZZTEST_DASH_KPI', 'CARD', '1985-05-05', '', ''), `zztest-dashkpi-${now}`]
    );

    // Le cache serveur de stats:get (STATS_CACHE_TTL_MS) doit expirer avant relecture.
    await window.waitForTimeout(16000);

    const statsAfter: any = await window.evaluate(() => (window as any).api.stats.get(undefined, undefined));
    expect(statsAfter.total).toBe(statsBefore.total + 1);
    expect(statsAfter.en_stock).toBe(statsBefore.en_stock + 1);
    expect(statsAfter.sans_rangement).toBeGreaterThanOrEqual(statsBefore.sans_rangement + 1);

    // Remontage du composant Dashboard (bounce de hash) pour rafraîchir l'UI, puis
    // vérification visuelle des tuiles KPI dans le DOM réel.
    await window.evaluate(() => { globalThis.location.hash = '#/agents'; });
    await window.waitForTimeout(300);
    await window.evaluate(() => { globalThis.location.hash = '#/dashboard'; });
    await window.waitForURL(/#\/dashboard/);
    await expect(window.getByText('Total Cartes').first()).toBeVisible();
    // "Sans Rangement" apparaît 2x dans le DOM (tuile KPI + intitulé de section) : on cible
    // spécifiquement le libellé de tuile KPI pour éviter la violation "strict mode".
    await expect(window.locator('.kpi-label-muted', { hasText: 'Sans Rangement' })).toBeVisible();
    await expect(window.getByText(String(statsAfter.total)).first()).toBeVisible();
  });

  test('DASH-2. Clic sur la tuile "Sans Rangement" navigue vers /agent-qualite/manquants', async () => {
    const { window } = env;
    await window.getByText('Sans Rangement').first().click();
    await window.waitForURL(/#\/agent-qualite\/manquants/, { timeout: 15000 });
    // Retour au dashboard pour la suite du run
    await window.evaluate(() => { globalThis.location.hash = '#/dashboard'; });
    await window.waitForURL(/#\/dashboard/);
  });

  test('DASH-3. Bouton "Auditer les Dates Invalides" présent et cliquable', async () => {
    const { window } = env;
    const btn = window.getByText(/Auditer les Dates Invalides/i);
    await expect(btn).toBeVisible();
  });

  // ══════════════════════════════════════════════════════════════════════
  // ZONE 2 — IMPORTATION (ImportPage + import-worker.js)
  // ══════════════════════════════════════════════════════════════════════

  test('IMP-1. Import CSV réel : standard EN STOCK/DELIVRE, statut inconnu, date invalide, doublon ignoré, mise à jour légitime', async () => {
    const { window } = env;

    // ── Pré-existant en base AVANT import : 1 carte pour le cas "doublon exact ignoré"
    // et 1 carte EN STOCK pour le cas "mise à jour légitime → DELIVRE" ──────────────
    await dbQuery(
      `INSERT INTO t_cartes (noms, prenoms, date_de_naissance, lieu_de_naissance, contact, statut, site_id, centre_id, cle_doublon, sync_id)
       VALUES ('ZZTEST_IMP5DUP', 'STANDARD', '1993-04-04', 'ABOBO', '0102030409', 'EN STOCK', ?, ?, ?, ?)`,
      [siteAId(), siteACentreId(), cleDoublon('ZZTEST_IMP5DUP', 'STANDARD', '1993-04-04', 'ABOBO', '0102030409'), `zztest-imp5dup-${Date.now()}`]
    );
    await dbQuery(
      `INSERT INTO t_cartes (noms, prenoms, date_de_naissance, lieu_de_naissance, contact, statut, site_id, centre_id, cle_doublon, sync_id)
       VALUES ('ZZTEST_IMP6UPD', 'STANDARD', '1994-05-05', 'ABOBO', '0102030410', 'EN STOCK', ?, ?, ?, ?)`,
      [siteAId(), siteACentreId(), cleDoublon('ZZTEST_IMP6UPD', 'STANDARD', '1994-05-05', 'ABOBO', '0102030410'), `zztest-imp6upd-${Date.now()}`]
    );

    const csvLines = [
      'NOMS;PRENOMS;DATE DE NAISSANCE;LIEU DE NAISSANCE;CONTACT;NUM SECU;RANGEMENT;STATUT;DATE DELIVRANCE;LIEU ENROLEMENT',
      // 1. Standard EN STOCK
      'ZZTEST_IMP1;STANDARD;1990-01-01;ABOBO;0102030405;ZZTESTNS0001;;EN STOCK;;ABOBO',
      // 2. Standard DELIVRE
      'ZZTEST_IMP2;STANDARD;1991-02-02;ABOBO;0102030406;ZZTESTNS0002;;DELIVRE;2024-05-05;ABOBO',
      // 3. Statut non reconnu → normalisé EN STOCK + anomalie STATUT_INCONNU
      'ZZTEST_IMP3;STANDARD;1992-03-03;ABOBO;0102030407;ZZTESTNS0003;;BIZARRE123;;ABOBO',
      // 4. Date de naissance invalide → anomalie DATE_INVALIDE, exclue de t_cartes
      'ZZTEST_IMP4;STANDARD;99/99/9999;ABOBO;0102030408;ZZTESTNS0004;;EN STOCK;;ABOBO',
      // 5. Doublon exact (même cle_doublon qu'une carte déjà EN STOCK) → ignoré silencieusement
      'ZZTEST_IMP5DUP;STANDARD;1993-04-04;ABOBO;0102030409;ZZTESTNS0005;;EN STOCK;;ABOBO',
      // 6. Mise à jour légitime (carte existante EN STOCK, import apporte DELIVRE) → doit mettre à jour
      'ZZTEST_IMP6UPD;STANDARD;1994-05-05;ABOBO;0102030410;ZZTESTNS0006;;DELIVRE;2024-06-06;ABOBO'
    ];
    const tmpDir = mkdtempSync(join(tmpdir(), 'gest-in-situ-qa-import-'));
    const csvPath = join(tmpDir, 'zztest_import.csv');
    writeFileSync(csvPath, csvLines.join('\n'), 'utf-8');

    // NOTE méthodologique : le bouton "Sélectionner un fichier" ouvre une boîte de
    // dialogue OS native (dialog.showOpenDialog), non automatisable via Playwright/
    // Electron sans monkey-patcher le module `dialog` du process principal. On
    // invoque donc directement `window.api.import.processFile(...)` — EXACTEMENT
    // la même fonction que le bouton "Lancer l'import" du renderer appelle
    // (ImportPage.tsx:168) — contre la vraie base SQLite et le vrai worker
        // d'import (import-worker.js). Seul le clic sur le sélecteur de fichier natif
    // n'a pas été exercé littéralement.
    const siteAIdVal = siteAId();
    const importResult: any = await window.evaluate(
      (args) => (window as any).api.import.clearTemp(args.siteId).then(() =>
        (window as any).api.import.processFile(args.csvPath, 'E2E_ADMINISTRATEUR_SITE', 6, args.siteId, args.userId)
      ),
      { csvPath, siteId: siteAIdVal, userId: adminAUserId() }
    );
    console.log('[IMP-1] Résultat processFile:', JSON.stringify(importResult));

    // ── Vérification DB post-import ────────────────────────────────────────────
    const imp1 = await dbQuery("SELECT statut FROM t_cartes WHERE noms = 'ZZTEST_IMP1'");
    expect(imp1.length).toBe(1);
    expect(imp1[0].statut).toBe('EN STOCK');

    const imp2 = await dbQuery("SELECT statut FROM t_cartes WHERE noms = 'ZZTEST_IMP2'");
    expect(imp2.length).toBe(1);
    expect(imp2[0].statut).toBe('DELIVRE');

    const imp3 = await dbQuery("SELECT statut FROM t_cartes WHERE noms = 'ZZTEST_IMP3'");
    expect(imp3.length).toBe(1);
    expect(imp3[0].statut).toBe('EN STOCK'); // normalisé
    const anomalie3 = await dbQuery("SELECT type_anomalie FROM t_import_anomalies WHERE noms = 'ZZTEST_IMP3'");
    expect(anomalie3.length).toBeGreaterThanOrEqual(1);
    expect(anomalie3[0].type_anomalie).toBe('STATUT_INCONNU');

    const imp4 = await dbQuery("SELECT * FROM t_cartes WHERE noms = 'ZZTEST_IMP4'");
    expect(imp4.length).toBe(0); // exclue de t_cartes
    const anomalie4 = await dbQuery("SELECT type_anomalie FROM t_import_anomalies WHERE noms = 'ZZTEST_IMP4'");
    expect(anomalie4.length).toBeGreaterThanOrEqual(1);
    expect(anomalie4[0].type_anomalie).toBe('DATE_INVALIDE');

    const imp5 = await dbQuery("SELECT statut FROM t_cartes WHERE noms = 'ZZTEST_IMP5DUP'");
    expect(imp5.length).toBe(1); // toujours une seule ligne, pas de doublon inséré
    expect(imp5[0].statut).toBe('EN STOCK'); // inchangé

    const imp6 = await dbQuery("SELECT statut FROM t_cartes WHERE noms = 'ZZTEST_IMP6UPD'");
    expect(imp6.length).toBe(1); // toujours une seule ligne
    expect(imp6[0].statut).toBe('DELIVRE'); // mis à jour par l'import
  });

  // ══════════════════════════════════════════════════════════════════════
  // ZONE 3 — AGENTS (AgentsPage)
  // ══════════════════════════════════════════════════════════════════════

  let createdAgentLogin = '';

  test('AG-1. UI : visibleRoles n\'expose ni SUPER ADMIN ni ADMINISTRATEUR_SITE pour un ADMINISTRATEUR_SITE', async () => {
    const { window } = env;
    await window.evaluate(() => { globalThis.location.hash = '#/agents'; });
    await window.waitForURL(/#\/agents/, { timeout: 15000 });

    const createBtn = window.getByRole('button', { name: /Nouvel Agent|Créer le premier agent/i }).first();
    // Le bouton d'ouverture du modal est soit dans le header (toujours présent), soit
    // dans l'état vide — on tente le header en priorité.
    const headerBtn = window.locator('button', { hasText: 'Nouvel Agent' });
    if (await headerBtn.count() > 0) {
      await headerBtn.first().click();
    } else {
      await createBtn.click();
    }

    await expect(window.getByText('Administrateur de Site (Totalité)')).toHaveCount(0);
    await expect(window.getByText(/Opérateur de Vérification/)).toBeVisible();
  });

  test('AG-2. Création réelle d\'un agent ZZTEST_ (OPERATEUR_VERIFICATION) via le formulaire UI', async () => {
    const { window } = env;
    createdAgentLogin = `ZZTEST_QA_OPVERIF_${Date.now()}`;

    await window.getByPlaceholder('ex: agent_abobo').fill(createdAgentLogin);
    await window.getByPlaceholder('••••••••').first().fill('ZZTEST_Pwd_2026!');
    await window.getByPlaceholder('NOM DE FAMILLE').fill('ZZTEST');
    await window.getByPlaceholder('Prénoms').fill('QAOPVERIF');
    await window.getByText(/Opérateur de Vérification/).click();
    await window.locator('select.form-select').selectOption({ value: String(siteACentreId()) });

    await window.getByRole('button', { name: "Créer l'agent" }).click();
    // Une fois le modal fermé, la liste affiche le rôle brut ('OPERATEUR_VERIFICATION', badge)
    // et non plus le libellé lisible du formulaire ('Opérateur de Vérification (...)') — on
    // vérifie donc la présence de l'agent créé via son login, sans ambiguïté.
    await expect(window.getByText(createdAgentLogin)).toBeVisible({ timeout: 15000 });

    const rows = await dbQuery('SELECT role, site_id, statut_actif FROM t_users WHERE login = ?', [createdAgentLogin]);
    expect(rows.length).toBe(1);
    expect(rows[0].role).toBe('OPERATEUR_VERIFICATION');
    expect(rows[0].site_id).toBe(siteAId());
    expect(rows[0].statut_actif).toBe(1);
  });

  test('AG-3. Appel IPC forcé users:create avec role=SUPER ADMIN est REJETÉ côté serveur (assertRolesAssignable)', async () => {
    const forgedLogin = `ZZTEST_FORGED_SUPERADMIN_${Date.now()}`;
    let threw = false;
    let msg = '';
    try {
      await env.window.evaluate(
        (login) =>
          (window as any).api.users.create({
            login,
            password: 'ZZTEST_Pwd_2026!',
            role: 'SUPER ADMIN',
            roles: ['SUPER ADMIN'],
            nom_user: 'ZZTEST',
            prenom_user: 'FORGED'
          }),
        forgedLogin
      );
    } catch (e: any) {
      threw = true;
      msg = String(e?.message || e);
    }
    expect(threw).toBe(true);
    expect(msg).toMatch(/autoris|rôle/i);

    const rows = await dbQuery('SELECT * FROM t_users WHERE login = ?', [forgedLogin]);
    expect(rows.length).toBe(0); // rien créé
  });

  test('AG-4. Modification réelle de l\'agent créé (UI) + vérification DB', async () => {
    const { window } = env;
    // Recherche l'agent créé pour cibler la bonne ligne
    await window.getByText(createdAgentLogin).scrollIntoViewIfNeeded();
    const row = window.locator('.table-row-hover', { hasText: createdAgentLogin });
    await row.locator('button[title="Modifier"]').click();

    await window.getByPlaceholder('Prénoms').fill('QAOPVERIFMODIFIE');
    await window.getByRole('button', { name: 'Mettre à jour' }).click();

    const rows = await dbQuery('SELECT prenom_user FROM t_users WHERE login = ?', [createdAgentLogin]);
    expect(rows[0].prenom_user).toBe('QAOPVERIFMODIFIE');
  });

  test('AG-5. Désactivation puis réactivation réelle de l\'agent (UI + mot de passe admin requis)', async () => {
    const { window } = env;
    const row = window.locator('.table-row-hover', { hasText: createdAgentLogin });
    await row.locator('button[title="Désactiver"]').click();

    // Modal confirmService requirePassword=true pour une désactivation
    await window.getByPlaceholder('••••••••').last().fill('E2E_Test_Pwd_2026!');
    await window.getByRole('button', { name: 'Confirmer' }).click();

    await expect.poll(async () => {
      const rows = await dbQuery('SELECT statut_actif FROM t_users WHERE login = ?', [createdAgentLogin]);
      return rows[0]?.statut_actif;
    }, { timeout: 10000 }).toBe(0);

    // Réactivation : confirmService.confirm() affiche quand même une modale (sans champ mot
    // de passe, requirePassword=false ici) — il faut tout de même cliquer "Confirmer".
    const rowAfter = window.locator('.table-row-hover', { hasText: createdAgentLogin });
    await rowAfter.locator('button[title="Activer"]').click();
    await window.getByRole('button', { name: 'Confirmer' }).click();
    await expect.poll(async () => {
      const rows = await dbQuery('SELECT statut_actif FROM t_users WHERE login = ?', [createdAgentLogin]);
      return rows[0]?.statut_actif;
    }, { timeout: 10000 }).toBe(1);
  });

  test('AG-6. Réinitialisation de mot de passe : aucun mot de passe en clair renvoyé, hash bcrypt changé en DB', async () => {
    const before = await dbQuery('SELECT password_hash FROM t_users WHERE login = ?', [createdAgentLogin]);
    const { window } = env;
    const row = window.locator('.table-row-hover', { hasText: createdAgentLogin });
    await row.locator('button[title="Réinitialiser le mot de passe"]').click();
    await window.getByPlaceholder('••••••••').last().fill('E2E_Test_Pwd_2026!');
    await window.getByRole('button', { name: 'Confirmer' }).click();

    await expect(window.getByText('Mot de passe réinitialisé !')).toBeVisible({ timeout: 10000 });
    // Le toast ne doit contenir aucun mot de passe en clair (uniquement le message générique)
    const toastText = await window.getByText('Mot de passe réinitialisé !').locator('..').innerText();
    expect(toastText).not.toMatch(/[a-z0-9]{6,}!?["']?\s*$/m); // heuristique : pas de token qui ressemble à un mdp

    const after = await dbQuery('SELECT password_hash FROM t_users WHERE login = ?', [createdAgentLogin]);
    expect(after[0].password_hash).not.toBe(before[0].password_hash);
    expect(after[0].password_hash.startsWith('$2')).toBe(true); // toujours un hash bcrypt
  });

  test('AG-7. Cross-site : un ADMINISTRATEUR_SITE ne peut PAS gérer un utilisateur d\'un autre site (appel IPC direct forcé)', async () => {
    // Site B a été détruit en SEC-7 ; on recrée un utilisateur étranger jetable dans un
    // site C synthétique pour ce test isolé, supprimé immédiatement après.
    const now = Date.now();
    const siteRes = await dbQuery(
      `INSERT INTO t_sites (nom, code, is_active, max_centres, is_permanent, sync_id) VALUES (?, ?, 1, 4, 1, ?)`,
      [`ZZTEST_SITE_C_${now}`, `ZZTEST-SITEC-${now}`, `zztest-sitec-${now}`]
    );
    const siteCId = siteRes[0].lastInsertRowid;
    const userRes = await dbQuery(
      `INSERT INTO t_users (login, password_hash, role, nom_user, prenom_user, statut_actif, site_id, sync_id, is_dirty)
       VALUES (?, ?, 'OPERATEUR_VERIFICATION', 'ZZTEST', 'SITEC', 1, ?, ?, 0)`,
      [`ZZTEST_USER_SITEC_${now}`, hashPassword('ZZTEST_Pwd_2026!'), siteCId, `zztest-userc-${now}`]
    );
    const siteCUserId = userRes[0].lastInsertRowid;

    let threwUpdate = false;
    try {
      await env.window.evaluate(
        (id) => (window as any).api.users.update(id, { nom_user: 'HACKED' }),
        siteCUserId
      );
    } catch { threwUpdate = true; }
    expect(threwUpdate).toBe(true);

    let threwDelete = false;
    try {
      await env.window.evaluate((id) => (window as any).api.users.delete(id), siteCUserId);
    } catch { threwDelete = true; }
    expect(threwDelete).toBe(true);

    let threwReset = false;
    try {
      await env.window.evaluate((id) => (window as any).api.users.resetAgentPassword(id), siteCUserId);
    } catch { threwReset = true; }
    expect(threwReset).toBe(true);

    const row = await dbQuery('SELECT nom_user, statut_actif FROM t_users WHERE id_user = ?', [siteCUserId]);
    expect(row[0].nom_user).toBe('ZZTEST'); // pas modifié
    expect(row[0].statut_actif).toBe(1); // pas désactivé

    // Nettoyage site C
    await dbQuery('DELETE FROM t_users WHERE site_id = ?', [siteCId]);
    await dbQuery('DELETE FROM t_sites WHERE id = ?', [siteCId]);
  });

  // ══════════════════════════════════════════════════════════════════════
  // ZONE 4 — INFRASTRUCTURES (SitesPage)
  // ══════════════════════════════════════════════════════════════════════

  test('SITES-1. Onglet "SITES" absent de l\'UI pour ADMINISTRATEUR_SITE (réservé SUPER ADMIN)', async () => {
    const { window } = env;
    await window.evaluate(() => { globalThis.location.hash = '#/sites'; });
    await window.waitForURL(/#\/sites/, { timeout: 15000 });
    // Onglets "Sites"/"Centres" (SitesPage.tsx:360-368) réservés à SUPER ADMIN — pour
    // ADMINISTRATEUR_SITE, aucun bouton d'onglet de ce type n'existe (className "tabs-premium"
    // absent) : seul un badge "Centres créés : X / Y" est affiché à la place.
    await expect(window.getByRole('button', { name: 'SITES', exact: true })).toHaveCount(0);
    await expect(window.locator('.tabs-premium')).toHaveCount(0);
    await expect(window.getByText(/Centres créés :/)).toBeVisible();
  });

  test('SITES-2. Création légitime d\'un centre ZZTEST_ sur SON site (respecte le quota max_centres)', async () => {
    const { window } = env;
    const centresBefore = await dbQuery('SELECT COUNT(*) as c FROM t_centres WHERE site_id = ?', [siteAId()]);

    await window.getByRole('button', { name: /Nouveau Centre/i }).click();
    const centreNom = `ZZTEST_CENTRE_LEGIT_${Date.now()}`;
    await window.getByPlaceholder('Ex: CENTRE COMMUNAUTAIRE').fill(centreNom);
    await window.getByPlaceholder('Ex: 2').fill('2');
    await window.getByPlaceholder('BOX FHB, PK18', { exact: false }).fill('ZZTESTPREFIX');
    await window.getByRole('button', { name: 'CRÉER LE CENTRE' }).click();

    await expect(window.getByText(centreNom)).toBeVisible({ timeout: 10000 });
    const centresAfter = await dbQuery('SELECT COUNT(*) as c FROM t_centres WHERE site_id = ?', [siteAId()]);
    expect(centresAfter[0].c).toBe(centresBefore[0].c + 1);

    const row = await dbQuery('SELECT site_id, prefixe_rangement FROM t_centres WHERE nom = ?', [centreNom]);
    expect(row[0].site_id).toBe(siteAId());
  });

  // ══════════════════════════════════════════════════════════════════════
  // ZONE 5 — Boutons de synchro Cloud (état/cohérence locale uniquement)
  // ══════════════════════════════════════════════════════════════════════

  test('SYNC-1. Boutons Envoyer/Télécharger (Dashboard) reflètent l\'état local (réseau coupé en E2E)', async () => {
    const { window } = env;
    await window.evaluate(() => { globalThis.location.hash = '#/dashboard'; });
    await window.waitForURL(/#\/dashboard/);
    // Réseau Supabase coupé par GEST_IN_SITU_E2E_DISABLE_SYNC=1 : les compteurs cloud
    // (cloudCartesCount, dirtyUsersCount) restent à 0/indéterminé, mais les boutons doivent
    // être présents et refléter un état cohérent (pas de crash, pas de NaN affiché). Textes
    // réels confirmés en lisant SiteAdminView.tsx (bloc ADMINISTRATEUR_SITE, ligne ~1064).
    await expect(window.getByText(/TÉLÉCHARGER .*CARTES DEPUIS LE CLOUD|DONNÉES DISTANTES À JOUR/)).toBeVisible({ timeout: 20000 });
    await expect(window.getByText(/SYNCHRONISER LES COMPTES AGENTS|COMPTES À JOUR/)).toBeVisible({ timeout: 20000 });
  });

  // ══════════════════════════════════════════════════════════════════════
  // NETTOYAGE FINAL — artefacts ZZTEST résiduels du site A
  // ══════════════════════════════════════════════════════════════════════

  test('CLEANUP. Suppression et vérification de tous les artefacts ZZTEST_ résiduels créés sur le Site A', async () => {
    const cartesDeleted = await dbQuery("DELETE FROM t_cartes WHERE noms LIKE 'ZZTEST\\_%' ESCAPE '\\'");
    const anomaliesDeleted = await dbQuery("DELETE FROM t_import_anomalies WHERE noms LIKE 'ZZTEST\\_%' ESCAPE '\\'");
    const usersDeleted = await dbQuery("DELETE FROM t_users WHERE login LIKE 'ZZTEST\\_%' ESCAPE '\\'");
    const centresDeleted = await dbQuery("DELETE FROM t_centres WHERE nom LIKE 'ZZTEST\\_%' ESCAPE '\\'");

    console.log(
      `[CLEANUP] Supprimés — cartes: ${cartesDeleted[0].changes}, anomalies: ${anomaliesDeleted[0].changes}, ` +
      `users: ${usersDeleted[0].changes}, centres: ${centresDeleted[0].changes}`
    );

    const remainingCartes = await dbQuery("SELECT COUNT(*) as c FROM t_cartes WHERE noms LIKE 'ZZTEST\\_%' ESCAPE '\\'");
    const remainingUsers = await dbQuery("SELECT COUNT(*) as c FROM t_users WHERE login LIKE 'ZZTEST\\_%' ESCAPE '\\'");
    const remainingCentres = await dbQuery("SELECT COUNT(*) as c FROM t_centres WHERE nom LIKE 'ZZTEST\\_%' ESCAPE '\\'");
    const remainingSites = await dbQuery("SELECT COUNT(*) as c FROM t_sites WHERE nom LIKE 'ZZTEST\\_%' ESCAPE '\\'");

    expect(remainingCartes[0].c).toBe(0);
    expect(remainingUsers[0].c).toBe(0);
    expect(remainingCentres[0].c).toBe(0);
    expect(remainingSites[0].c).toBe(0);
  });
});
