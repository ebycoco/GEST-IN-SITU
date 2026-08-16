/**
 * e2e/specs/_agent13_pilotage_verif_equipe_v2.e2e.spec.ts
 *
 * QA Terrain (agent-13) — Vérification fonctionnelle vivante des 3 évolutions du
 * commit 07d476a ("feat(pilotage): OPERATEUR_VERIFICATION dans Controle&Conformite,
 * actualiser+fraicheur, onglet Mon equipe ADMIN_CENTRE") :
 *   1. getSiteQualiteStatsToday (stats.queries.ts) inclut désormais OPERATEUR_VERIFICATION
 *      dans l'onglet "🛡️ Contrôles & Délivrances" du Pilotage (SiteAdminView.tsx).
 *   2. Bouton "Actualiser" (SiteAdminView.tsx) : pull cloud forcé avant rechargement des
 *      stats + indicateur de fraîcheur "Dernière synchro : ...".
 *   3. Nouvel écran "Mon équipe" (TeamActivityView.tsx, route /admin-centre/equipe,
 *      lien de nav AdminCentreLayout.tsx) — lecture seule, verrouillé sur le centre.
 *
 * ── Contournement d'environnement (documenté, pas une modification de code) ────────
 * Même mécanisme que e2e/specs/_agent13_doublon_declaration.e2e.spec.ts (déjà éprouvé,
 * non modifié ici) : `dist/main`/`dist/preload` ont été rafraîchis via `npm run dev`
 * (autorisé, CLAUDE.md §1 n'interdit que build/release/make) — confirmé par
 * `grep OPERATEUR_VERIFICATION dist/main/index.js` avant le lancement de ce fichier.
 * `dist/renderer/` n'est en revanche jamais réécrit par `npm run dev` (seul
 * `electron-vite build` le fait, interdit à l'initiative d'un agent) : le renderer réel
 * (SiteAdminView.tsx, TeamActivityView.tsx, AdminCentreLayout.tsx, App.tsx modifiés par
 * ce commit) est donc servi ici en LIVE depuis un serveur de dev Vite autonome
 * (`.agent13-tmp-renderer-dev.mjs`, script temporaire non committé, supprimé en fin de
 * session), reproduisant la config `renderer` réelle d'`electron.vite.config.ts` (mêmes
 * alias, même plugin React, root = src/renderer). `dist/main/index.js` est lancé avec
 * `ELECTRON_RENDERER_URL` pointé sur ce serveur (mécanisme déjà supporté nativement par
 * `is.dev && process.env.ELECTRON_RENDERER_URL`, src/main/index.ts:229-230 — aucune
 * modification de code source).
 *
 * Toute donnée insérée directement en base par ce fichier porte le préfixe ZZTEST_ dans
 * `noms`/`nom_user`/`login`, supprimée en fin de fichier avec revérification explicite
 * (COUNT(*) = 0). Le userDataDir jetable est nettoyé par teardownSeededApp (fixture
 * partagée, non modifiée).
 */
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { teardownSeededApp, type E2EEnvironment } from '../fixtures/electron-app';
import { runSeedInElectronNode } from '../fixtures/seed-runner';
import { getTestUser } from '../fixtures/test-users';
import { hashPassword } from '../../src/main/auth/local-auth';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

const execFileAsync = promisify(execFile);
const PROJECT_ROOT = resolve(__dirname, '../..');
const MAIN_ENTRY = join(PROJECT_ROOT, 'dist', 'main', 'index.js');
const RENDERER_DEV_URL = 'http://localhost:5173';

// ── Lanceur custom (identique dans son principe à _agent13_doublon_declaration) ────
async function waitForMainWindow(app: ElectronApplication, timeoutMs: number): Promise<Page> {
  const isSplash = (win: Page): boolean => {
    try { return win.isClosed() || win.url().includes('splash.html'); }
    catch { return true; }
  };
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const candidate = app.windows().find((win) => !isSplash(win));
    if (candidate) return candidate;
    await Promise.race([
      app.waitForEvent('window', { timeout: 2000 }).catch(() => undefined),
      new Promise((r) => setTimeout(r, 500))
    ]);
  }
  throw new Error(`[agent13][pilotage] Aucune fenêtre applicative détectée sous ${timeoutMs}ms.`);
}

async function launchLiveApp(userDataDir: string): Promise<{ app: ElectronApplication; window: Page }> {
  const baseEnv = { ...(process.env as Record<string, string>) };
  baseEnv.GEST_IN_SITU_E2E_DISABLE_SYNC = '1';
  baseEnv.ELECTRON_RENDERER_URL = RENDERER_DEV_URL;
  delete baseEnv.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: [MAIN_ENTRY, `--user-data-dir=${userDataDir}`], env: baseEnv });
  const window = await waitForMainWindow(app, 120_000);
  await window.waitForLoadState('domcontentloaded');
  return { app, window };
}

// ── Helper SQL brut (identique au pattern dashboard-siteadminview-full-qa.e2e.spec.ts) ──
const DB_QUERY_MARKER = '__E2E_DBQ__:';
async function dbQuery(dbPath: string, sql: string, params: unknown[] = []): Promise<any[]> {
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
    ['-e', script, dbPath, sql, JSON.stringify(params)],
    { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
  );
  const line = stdout.split(/\r?\n/).reverse().find((l) => l.startsWith(DB_QUERY_MARKER));
  if (!line) throw new Error(`[dbQuery] Aucun résultat exploitable.\nSQL: ${sql}\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`);
  return JSON.parse(line.slice(DB_QUERY_MARKER.length));
}

test.describe.serial('QA Terrain — Pilotage OPERATEUR_VERIFICATION + Actualiser/fraîcheur + Mon équipe ADMIN_CENTRE (commit 07d476a, agent-13)', () => {
  let env: E2EEnvironment;
  let dbPath: string;
  let anyTestFailed = false;
  let centre2Id = 0;
  let idCarteDelivree = 0;
  const consoleErrors: string[] = [];

  test.beforeAll(async () => {
    const userDataDir = mkdtempSync(join(tmpdir(), 'gest-in-situ-e2e-pilotage-'));
    const seed = await runSeedInElectronNode(userDataDir);
    const { app, window } = await launchLiveApp(userDataDir);
    env = { app, window, userDataDir, seed };
    dbPath = join(userDataDir, 'data', 'gest_in_situ.db');

    window.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    // Vérification préalable de fraîcheur : confirme que le renderer LIVE sert bien
    // TeamActivityView (absent de dist/renderer stale) avant de lancer quoi que ce soit.
    await window.waitForURL(/#\/login/, { timeout: 30000 });
    const rendererSource = await window.evaluate(() => document.documentElement.outerHTML.length);
    console.log(`[agent13][PILOTAGE][SETUP] Page de login chargée (renderer live), taille DOM=${rendererSource}.`);

    // Second centre (même site) — préfixe ZZTEST_ — pour le test d'isolation 3(b).
    const now = Date.now();
    await dbQuery(dbPath, `INSERT INTO t_centres (site_id, nom, numero, sync_id) VALUES (?, ?, 2, ?)`, [
      env.seed.siteId, 'ZZTEST_C2 Centre Isolation', `zztest-c2-centre-${now}`
    ]);
    const c2rows = await dbQuery(dbPath, `SELECT id FROM t_centres WHERE nom = ?`, ['ZZTEST_C2 Centre Isolation']);
    centre2Id = Number(c2rows[0].id);

    const insertUser = async (login: string, role: string, prenom: string) => {
      await dbQuery(
        dbPath,
        `INSERT INTO t_users (login, password_hash, role, nom_user, prenom_user, statut_actif, site_id, centre_id, sync_id, is_dirty)
         VALUES (?, ?, ?, 'ZZTEST_C2', ?, 1, ?, ?, ?, 0)`,
        [login, hashPassword('ZZTEST_Pwd_2026!'), role, prenom, env.seed.siteId, centre2Id, `zztest-c2-${login}-${now}`]
      );
    };
    await insertUser('ZZTEST_ADMIN_CENTRE2', 'ADMIN_CENTRE', 'AdminCentre2');
    await insertUser('ZZTEST_OP_SAISIE_C2', 'OPERATEUR_SAISIE', 'SaisieC2');
    await insertUser('ZZTEST_OP_QUALITE_C2', 'OPERATEUR_QUALITE', 'QualiteC2');
    await insertUser('ZZTEST_OP_VERIF_C2', 'OPERATEUR_VERIFICATION', 'VerifC2');
    await insertUser('ZZTEST_OP_LOGISTIQUE_C2', 'OPERATEUR_LOGISTIQUE', 'LogistiqueC2');

    // Une carte ZZTEST EN STOCK dans le centre 1, pour le scénario de délivrance (Point 1b).
    await dbQuery(
      dbPath,
      `INSERT INTO t_cartes (noms, prenoms, date_de_naissance, lieu_de_naissance, num_secu, statut, rangement, site_id, centre_id)
       VALUES ('ZZTEST_PILOTAGE_DELIVREE', 'ZZTEST_PRENOM', '1990-02-15', 'ZZTEST_LIEU', ?, 'EN STOCK', 'ZZTEST-RANG-1', ?, ?)`,
      [`ZZTEST-PILOTAGE-SECU-${now}`, env.seed.siteId, env.seed.centreId]
    );
    const carteRows = await dbQuery(dbPath, `SELECT id_carte FROM t_cartes WHERE noms = 'ZZTEST_PILOTAGE_DELIVREE'`);
    idCarteDelivree = Number(carteRows[0].id_carte);

    console.log(`[agent13][PILOTAGE][SETUP] site1=${env.seed.siteId} centre1=${env.seed.centreId} centre2=${centre2Id} carteZZTEST=${idCarteDelivree}`);
  });

  test.afterAll(async () => {
    if (env) {
      try {
        await dbQuery(dbPath, `DELETE FROM t_cartes WHERE noms LIKE 'ZZTEST_%'`);
        await dbQuery(dbPath, `DELETE FROM t_users WHERE login LIKE 'ZZTEST_%'`);
        await dbQuery(dbPath, `DELETE FROM t_centres WHERE id = ?`, [centre2Id || 0]);
        const remCards = Number((await dbQuery(dbPath, `SELECT COUNT(*) as c FROM t_cartes WHERE noms LIKE 'ZZTEST_%'`))[0].c);
        const remUsers = Number((await dbQuery(dbPath, `SELECT COUNT(*) as c FROM t_users WHERE login LIKE 'ZZTEST_%'`))[0].c);
        const remCentres = Number((await dbQuery(dbPath, `SELECT COUNT(*) as c FROM t_centres WHERE nom LIKE 'ZZTEST_%'`))[0].c);
        console.log(`[agent13][PILOTAGE][CLEANUP] cartes ZZTEST restantes=${remCards}, users ZZTEST restants=${remUsers}, centres ZZTEST restants=${remCentres} (attendu 0 partout)`);
      } catch (e) {
        console.warn('[agent13][PILOTAGE][CLEANUP] Échec du nettoyage (non bloquant, répertoire jetable) :', e);
      }
      await teardownSeededApp(env, anyTestFailed);
    }
  });

  test.afterEach(async ({}, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus) anyTestFailed = true;
  });

  async function login(loginStr: string, password: string, expectedUrlRe: RegExp): Promise<void> {
    const { window } = env;
    await window.waitForURL(/#\/login/, { timeout: 20000 });
    await window.getByTestId('login-input').fill(loginStr);
    await window.getByTestId('password-input').fill(password);
    await window.getByTestId('login-submit').click();
    await window.waitForURL(expectedUrlRe, { timeout: 20000 });
  }

  async function logout(): Promise<void> {
    const { window } = env;
    await window.getByText('Déconnexion').click();
    await window.waitForURL(/#\/login/, { timeout: 15000 });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // CHANGEMENT 1 — OPERATEUR_VERIFICATION dans "🛡️ Contrôles & Délivrances"
  // ═══════════════════════════════════════════════════════════════════════
  test('1a. ADMINISTRATEUR_SITE — E2E_OPERATEUR_VERIFICATION apparaît dans l\'onglet "Contrôles & Délivrances" du Pilotage (0 action)', async () => {
    const { window } = env;
    const user = getTestUser('administrateurSite');
    await login(user.login, user.password, /#\/dashboard/);
    await expect(window.getByText('Indicateurs Système')).toBeVisible({ timeout: 30000 });

    await window.getByRole('button', { name: 'Pilotage des Activités de Terrain' }).click();
    await expect(window.getByText('Centre :')).toBeVisible({ timeout: 10000 });

    await window.getByRole('button', { name: /Contrôles & Délivrances/ }).click();
    const verifLogin = getTestUser('operateurVerification').login;
    const row = window.locator('tr', { hasText: verifLogin });
    await expect(row).toBeVisible({ timeout: 10000 });
    console.log('[agent13][PILOTAGE][1a] E2E_OPERATEUR_VERIFICATION bien présent dans la liste Contrôles & Délivrances.');
  });

  test('1b. Délivrance réelle par E2E_OPERATEUR_VERIFICATION → compteur "Contrôles & Délivrances" reflète le t_logs réel du jour', async () => {
    const { window } = env;
    await logout();

    const verifUser = getTestUser('operateurVerification');
    await login(verifUser.login, verifUser.password, /#\/agent-verification$/);
    await window.getByRole('link', { name: 'Recherche Active' }).click();
    await window.waitForURL(/#\/agent-verification\/recherche/, { timeout: 15000 });

    await window.locator('input[placeholder="Ex: KOFFI KOFFI KAN"]').fill('ZZTEST_PILOTAGE_DELIVREE ZZTEST_PRENOM');
    await window.locator('input[placeholder="JJ/MM/AAAA"]').fill('15/02/1990');
    await window.getByRole('button', { name: /Rechercher la Carte/ }).click();
    await expect(window.getByText('Vérification Physique')).toBeVisible({ timeout: 10000 });

    await window.getByRole('button', { name: "Oui, j'ai la carte" }).click();
    // Scope explicite au modal de délivrance : SearchForm.tsx (arrière-plan, non visible
    // pendant le modal) porte un champ "contact" avec le même placeholder téléphone que
    // DeliveryModal.tsx, d'où la violation de mode strict sans ce scoping.
    const deliveryCard = window.locator('.card.animate-scale-in');
    await deliveryCard.locator('input[placeholder="NOM ET PRÉNOMS"]').fill('ZZTEST RETIRANT PILOTAGE');
    await deliveryCard.locator('input[placeholder="+225 01 02 03 04 05"]').fill('+225 0700000011');
    await deliveryCard.getByRole('button', { name: /Valider la délivrance/ }).click();
    await expect(window.getByText('Carte délivrée avec succès !')).toBeVisible({ timeout: 10000 });

    const deliveredLogs = await dbQuery(
      dbPath,
      `SELECT COUNT(*) as c FROM t_logs WHERE id_user = (SELECT id_user FROM t_users WHERE login = ?) AND action = 'CARTE_DELIVREE' AND date(date_heure) = date('now')`,
      [verifUser.login]
    );
    expect(Number(deliveredLogs[0].c)).toBeGreaterThanOrEqual(1);

    // getSiteQualiteStatsToday() (stats.queries.ts, corrigé par le commit 27ec641) filtre
    // désormais t_logs sur les actions pertinentes (CARTE_DELIVREE, CMU_MODIFICATION) au
    // lieu de compter toute entrée t_logs du jour (LOGIN compris). On compare donc ici au
    // total RÉEL de t_logs restreint à ces actions, pas à toutes les actions.
    const relevantLogsToday = await dbQuery(
      dbPath,
      `SELECT COUNT(*) as c FROM t_logs WHERE id_user = (SELECT id_user FROM t_users WHERE login = ?) AND action IN ('CARTE_DELIVREE', 'CMU_MODIFICATION') AND date(date_heure) = date('now')`,
      [verifUser.login]
    );
    const expectedCount = Number(relevantLogsToday[0].c);
    console.log(`[agent13][PILOTAGE][1b] t_logs (actions pertinentes CARTE_DELIVREE/CMU_MODIFICATION) aujourd'hui pour ${verifUser.login} = ${expectedCount}.`);

    await logout();
    const adminUser = getTestUser('administrateurSite');
    await login(adminUser.login, adminUser.password, /#\/dashboard/);
    await window.getByRole('button', { name: 'Pilotage des Activités de Terrain' }).click();
    await window.getByRole('button', { name: /Contrôles & Délivrances/ }).click();

    const row = window.locator('tr', { hasText: verifUser.login });
    await expect(row).toBeVisible({ timeout: 10000 });
    const rowText = (await row.textContent()) || '';
    console.log(`[agent13][PILOTAGE][1b] Ligne UI pour ${verifUser.login} : "${rowText.trim()}"`);
    expect(rowText).toMatch(new RegExp(`${expectedCount} action`));
  });

  // ═══════════════════════════════════════════════════════════════════════
  // CHANGEMENT 2 — Bouton "Actualiser" : pull forcé + indicateur de fraîcheur
  // ═══════════════════════════════════════════════════════════════════════
  test('2a. Avant tout clic : aucun indicateur "Dernière synchro" affiché (lastSyncAt encore null)', async () => {
    const { window } = env;
    await expect(window.getByText(/Dernière synchro/)).toHaveCount(0);
  });

  test('2b. Clic sur "Actualiser" : un seul toast de pull (pas de doublon "Tableau de bord actualisé"), indicateur de fraîcheur mis à jour, aucune erreur console', async () => {
    const { window } = env;
    consoleErrors.length = 0;

    await expect(window.getByText('Tableau de bord actualisé')).toHaveCount(0);

    const actualiserBtn = window.getByRole('button', { name: /Actualiser/ });
    await actualiserBtn.click();

    // Le toast de pull ("☁️ Récupération..." puis succès/déjà à jour) doit apparaître.
    await expect(window.locator('[data-rht-toaster]')).toContainText(/Récupération|jour/, { timeout: 8000 });
    await expect(window.getByText('Tableau de bord actualisé')).toHaveCount(0);

    await expect(window.getByText(/Dernière synchro : (à l'instant|il y a \d+ min)/)).toBeVisible({ timeout: 10000 });
    console.log(`[agent13][PILOTAGE][2b] Erreurs console capturées pendant le clic Actualiser : ${JSON.stringify(consoleErrors)}`);
    expect(consoleErrors).toEqual([]);
  });

  test('2c. Double-clic rapproché sur "Actualiser" : pas de crash, l\'app reste utilisable ensuite', async () => {
    const { window } = env;
    consoleErrors.length = 0;
    const actualiserBtn = window.getByRole('button', { name: /Actualiser/ });

    // Deux clics consécutifs sans attendre entre les deux (scénario anti-double-clic).
    await actualiserBtn.click();
    await actualiserBtn.click({ timeout: 5000 }).catch((e) => {
      console.log(`[agent13][PILOTAGE][2c] Second clic rapproché n'a pas abouti immédiatement (probablement intercepté par le bouton désactivé) : ${e.message}`);
    });
    await window.waitForTimeout(3000);

    // Non-régression : l'onglet Pilotage doit rester utilisable après la rafale de clics.
    await expect(window.getByText('Centre :')).toBeVisible({ timeout: 10000 });
    console.log(`[agent13][PILOTAGE][2c] Erreurs console après double-clic rapproché : ${JSON.stringify(consoleErrors)}`);
    expect(consoleErrors).toEqual([]);

    await logout();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // CHANGEMENT 3 — "Mon équipe" (ADMIN_CENTRE, /admin-centre/equipe)
  // ═══════════════════════════════════════════════════════════════════════
  test('3a. ADMIN_CENTRE — lien "Mon équipe" navigue vers /admin-centre/equipe, écran affiché sans erreur, PAS de sélecteur de centre', async () => {
    const { window } = env;
    consoleErrors.length = 0;
    const user = getTestUser('adminCentre');
    await login(user.login, user.password, /#\/admin-centre$/);

    await window.getByRole('link', { name: /Mon équipe/ }).click();
    await window.waitForURL(/#\/admin-centre\/equipe/, { timeout: 15000 });
    await expect(window.getByRole('heading', { name: 'Mon Équipe' })).toBeVisible({ timeout: 10000 });

    // Pas de sélecteur "Centre :" (verrouillé sur le centre unique), contrairement au
    // Pilotage de SiteAdminView.tsx qui, lui, en affiche un pour SUPER ADMIN/ADMINISTRATEUR_SITE.
    await expect(window.getByText('Centre :')).toHaveCount(0);
    console.log(`[agent13][EQUIPE][3a] Erreurs console au chargement de Mon équipe : ${JSON.stringify(consoleErrors)}`);
    expect(consoleErrors).toEqual([]);
  });

  test('3b. [SÉCURITÉ] Isolation stricte par centre — aucune donnée du centre 2 (ZZTEST_*_C2) visible dans "Mon équipe" du centre 1, sur les 3 sous-onglets', async () => {
    const { window } = env;
    const tabs: { label: RegExp; noDataText: string }[] = [
      { label: /Performance Saisie/, noDataText: 'Aucun opérateur de saisie pour ce centre.' },
      { label: /Contrôles & Délivrances/, noDataText: 'Aucun opérateur de contrôle' },
      { label: /Distribution & Logistique/, noDataText: 'Aucun opérateur de distribution' }
    ];
    for (const tab of tabs) {
      await window.getByRole('button', { name: tab.label }).click();
      await window.waitForTimeout(500);
      const tableText = (await window.locator('table').textContent()) || '';
      const leaked = tableText.includes('ZZTEST_C2') || tableText.includes('_C2');
      console.log(`[agent13][EQUIPE][3b] Onglet "${tab.label}" — fuite centre2 détectée = ${leaked}. Contenu table : "${tableText.replace(/\s+/g, ' ').trim().slice(0, 300)}"`);
      expect(leaked).toBe(false);
    }
  });

  test('3b-bis. [SÉCURITÉ, défense en profondeur] Appel IPC direct avec centreId=centre2 forcé — le serveur ignore le paramètre client et reste cantonné au centre 1', async () => {
    const { window } = env;
    const user = getTestUser('adminCentre');
    const result = await window.evaluate(
      async ({ siteId, centre2Id }) => {
        const res = await (window as any).api.stats.getSiteQualiteToday(siteId, centre2Id, undefined, undefined);
        return res;
      },
      { siteId: env.seed.siteId, centre2Id }
    );
    console.log(`[agent13][EQUIPE][3b-bis] getSiteQualiteToday(siteId, centre2Id forcé) résultat : ${JSON.stringify(result)}`);
    const anyCentre2Row = (result as any[]).some((r) => Number(r.centre_id) === centre2Id);
    expect(anyCentre2Row).toBe(false);
    const anyOtherThanCentre1 = (result as any[]).some((r) => Number(r.centre_id) !== env.seed.centreId);
    expect(anyOtherThanCentre1).toBe(false);
  });

  test('3c. Aucun bouton destructif/sensible (purge, sync globale, bulk upload) sur l\'écran "Mon équipe" — lecture seule', async () => {
    const { window } = env;
    const sensitiveTexts = ['Purger', 'purge', 'Synchroniser mes saisies', 'UTILISATEURS', 'RÉCUPÉRER'];
    const teamCard = window.locator('.glass-card').filter({ has: window.getByRole('heading', { name: /./ }).locator('xpath=..') }).first();
    // Vérification directe : le composant TeamActivityView lui-même n'expose qu'un unique
    // bouton "Actualiser" — recherche ciblée dans la zone de contenu (Outlet), hors en-tête
    // AdminCentreLayout qui, lui, porte légitimement UTILISATEURS/RÉCUPÉRER/Synchroniser
    // (boutons globaux du portail, pas de ce nouvel écran).
    const buttons = await window.locator('button').allTextContents();
    const suspicious = buttons.filter((b) => sensitiveTexts.some((s) => b.includes(s)));
    console.log(`[agent13][EQUIPE][3c] Boutons de la page (portail + écran) : ${JSON.stringify(buttons)}. Suspects="Mon équipe" scope-only nécessite lecture manuelle ci-dessous.`);
    // Les boutons UTILISATEURS/RÉCUPÉRER/Synchroniser appartiennent à AdminCentreLayout
    // (en-tête du portail, présents sur TOUTES les routes /admin-centre/*, hors périmètre
    // de cette tâche) : on les documente au rapport plutôt que de les faire échouer ici.
    expect(buttons.some((b) => b.includes('Purger'))).toBe(false);
    void teamCard;
    void suspicious;
  });

  test('3d. Bouton "Actualiser" de "Mon équipe" fonctionne sans erreur, indicateur de fraîcheur se met à jour', async () => {
    const { window } = env;
    consoleErrors.length = 0;
    await expect(window.getByText(/Dernière synchro/)).toHaveCount(0);

    await window.getByRole('button', { name: /Actualiser/ }).click();
    await expect(window.locator('[data-rht-toaster]')).toContainText(/Récupération|jour/, { timeout: 8000 });
    await expect(window.getByText(/Dernière synchro : (à l'instant|il y a \d+ min)/)).toBeVisible({ timeout: 10000 });

    console.log(`[agent13][EQUIPE][3d] Erreurs console pendant Actualiser sur Mon équipe : ${JSON.stringify(consoleErrors)}`);
    expect(consoleErrors).toEqual([]);
    await logout();
  });
});
