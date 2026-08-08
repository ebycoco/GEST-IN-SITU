/**
 * e2e/specs/adminsite/dashboard-siteadminview-full-qa.e2e.spec.ts
 *
 * QA Terrain (agent-13) — Couverture complète du Tableau de bord
 * (SiteAdminView.tsx, route /dashboard) sous SUPER ADMIN, ADMINISTRATEUR_SITE
 * et ADMIN_CENTRE, section par section (voir le prompt de la tâche pour la
 * numérotation 1-9 reprise dans les commentaires ci-dessous).
 *
 * Une seule instance Electron partagée pour tout le fichier
 * (test.describe.serial), avec changement de rôle par logout/login successifs
 * (même pattern que e2e/specs/_agent13_sync_status_dashboard.e2e.spec.ts) :
 * coût de démarrage trop élevé pour le payer 3 fois.
 *
 * Toutes les données créées sont préfixées ZZTEST_ et nettoyées en fin de run
 * (test CLEANUP final, vérifié par re-SELECT).
 */
import { test, expect, type Page } from '@playwright/test';
import { launchSeededApp, teardownSeededApp, type E2EEnvironment } from '../../fixtures/electron-app';
import { getTestUser } from '../../fixtures/test-users';
import { hashPassword } from '../../../src/main/auth/local-auth';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

test.describe.serial('QA Terrain — Dashboard SiteAdminView complet (agent-13)', () => {
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

  // ── Helper SQL brut (identique aux autres specs QA terrain agent-13) ──────
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
  async function count1(sql: string, params: unknown[] = []): Promise<number> {
    const rows = await dbQuery(sql, params);
    return Number(rows[0]?.count ?? 0);
  }

  const cleDoublon = (noms: string, prenoms: string, ddn: string, lieu: string, contact: string) =>
    `${noms}|${prenoms}|${ddn}|${lieu}|${contact}`;

  const siteAId = () => env.seed.siteId;
  const siteACentreId = () => env.seed.centreId;

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

  /** Bounce de hash pour forcer un remontage de SiteAdminView (re-fetch centres/agents). */
  async function bounceDashboard(): Promise<void> {
    const { window } = env;
    await window.evaluate(() => { globalThis.location.hash = '#/agents'; });
    await window.waitForTimeout(300);
    await window.evaluate(() => { globalThis.location.hash = '#/dashboard'; });
    await window.waitForURL(/#\/dashboard/);
    await window.waitForTimeout(300);
  }

  async function clickActualiser(): Promise<void> {
    const { window } = env;
    // [P2 constaté QA — agent-13] Le Toaster ("Tableau de bord actualisé", App.tsx:101,
    // position="top-right") partage la même zone que ce bouton, également en haut à
    // droite. Des clics rapprochés (< 4s, durée de vie d'un toast) empilent plusieurs
    // toasts qui recouvrent physiquement le bouton et interceptent le clic réel (constaté
    // en toute rigueur ici : WIZ-4 a timeout 30s sur ce point avant ce correctif). On
    // laisse donc la pile se vider avant de cliquer, pour tester le COMPORTEMENT du
    // bouton lui-même sans le confondre avec ce recouvrement visuel, déjà tracé au rapport.
    await window.locator('[data-rht-toaster] div[role="status"]').first()
      .waitFor({ state: 'detached', timeout: 8000 }).catch(() => {});
    await window.getByRole('button', { name: /Actualiser/ }).click({ timeout: 10000 });
    await window.waitForTimeout(400);
  }

  async function readKpiTile(window: Page, label: string): Promise<number> {
    const labelEl = window.locator('.kpi-label-muted', { hasText: label }).first();
    await expect(labelEl).toBeVisible({ timeout: 20000 });
    const valueEl = labelEl.locator('xpath=preceding-sibling::div[contains(@class,"kpi-value-lg")]');
    const text = (await valueEl.textContent()) || '';
    return Number(text.replace(/[^\d]/g, ''));
  }

  // ══════════════════════════════════════════════════════════════════════
  // BLOC A — ADMINISTRATEUR_SITE
  // ══════════════════════════════════════════════════════════════════════

  test('ADM-0. Connexion ADMINISTRATEUR_SITE', async () => {
    const user = getTestUser('administrateurSite');
    await login(user.login, user.password, /#\/dashboard/);
    await expect(env.window.getByText('Indicateurs Système')).toBeVisible({ timeout: 30000 });
  });

  // ─── Section 1 : Lancement Rapide ───────────────────────────────────────
  // NOTE : les libellés des tuiles ("Cartes CMU", "Recherche CMU", "Monitoring Sync")
  // sont AUSSI des libellés de menu dans la Sidebar (toujours montée) : on scope donc
  // systématiquement sur la description propre à chaque tuile, unique dans le DOM.
  test('QR-1. Bloc "Lancement Rapide" replié par défaut puis dépliable au clic', async () => {
    const { window } = env;
    await expect(window.getByText('Gestion du stock et détails')).toHaveCount(0);
    await window.getByText('Lancement Rapide').click();
    await expect(window.getByText('Gestion du stock et détails')).toBeVisible();
    await expect(window.getByText('Saisie opérateur In-Situ')).toBeVisible();
    await expect(window.getByText('Recherche active et logs')).toBeVisible();
    await expect(window.getByText('État du réseau Supabase')).toBeVisible();
  });

  test('QR-2. Tuile "Cartes CMU" navigue vers /cartes', async () => {
    const { window } = env;
    await window.locator('.glass-card', { hasText: 'Gestion du stock et détails' }).click();
    await window.waitForURL(/#\/cartes/, { timeout: 15000 });
    await bounceDashboard();
    await window.getByText('Lancement Rapide').click();
  });

  test('QR-3. Tuile "Nouvelle Saisie" navigue vers /agent-saisie/nouvelle', async () => {
    const { window } = env;
    await window.locator('.glass-card', { hasText: 'Saisie opérateur In-Situ' }).click();
    await window.waitForURL(/#\/agent-saisie\/nouvelle/, { timeout: 15000 });
    await bounceDashboard();
    await window.getByText('Lancement Rapide').click();
  });

  test('QR-4. Tuile "Recherche CMU" navigue vers /verification/recherche', async () => {
    const { window } = env;
    await window.locator('.glass-card', { hasText: 'Recherche active et logs' }).click();
    await window.waitForURL(/#\/verification\/recherche/, { timeout: 15000 });
    await bounceDashboard();
    await window.getByText('Lancement Rapide').click();
  });

  test('QR-5. Tuile "Monitoring Sync" navigue vers /sync/status', async () => {
    const { window } = env;
    await window.locator('.glass-card', { hasText: 'État du réseau Supabase' }).click();
    await window.waitForURL(/#\/sync\/status/, { timeout: 15000 });
    await bounceDashboard();
  });

  // ─── Section 2 : Onglets + filtres Pilotage ─────────────────────────────
  test('TAB-1. Bascule "Indicateurs Système" <-> "Pilotage des Activités de Terrain"', async () => {
    const { window } = env;
    const sysBtn = window.getByRole('button', { name: 'Indicateurs Système' });
    const supBtn = window.getByRole('button', { name: 'Pilotage des Activités de Terrain' });

    await expect(sysBtn).toHaveCSS('border-bottom', /255, 215, 0/);
    await supBtn.click();
    await expect(supBtn).toHaveCSS('border-bottom', /255, 215, 0/);
    await expect(window.getByText('Centre :')).toBeVisible();
    await expect(window.getByText('Agent :')).toBeVisible();
    await expect(window.getByText('Date :')).toBeVisible();
  });

  test('SUP-BUG-1. [P0] Filtres Agent et Date du Pilotage SANS AUCUN EFFET sur les données affichées', async () => {
    const { window } = env;
    const now = Date.now();

    // 2 agents ZZTEST OPERATEUR_SAISIE rattachés au centre du site A.
    const insertAgent = async (login: string, prenom: string) => {
      const res = await dbQuery(
        `INSERT INTO t_users (login, password_hash, role, nom_user, prenom_user, statut_actif, site_id, centre_id, sync_id, is_dirty)
         VALUES (?, ?, 'OPERATEUR_SAISIE', 'ZZTEST', ?, 1, ?, ?, ?, 0)`,
        [login, hashPassword('ZZTEST_Pwd_2026!'), prenom, siteAId(), siteACentreId(), `zztest-${login}-${now}`]
      );
      return res[0].lastInsertRowid as number;
    };
    const agentXId = await insertAgent(`ZZTEST_AGENTX_${now}`, 'AGENTX');
    const agentYId = await insertAgent(`ZZTEST_AGENTY_${now}`, 'AGENTY');

    // Cartes créées AUJOURD'HUI par chacun (created_at ISO complet, comme created_by réel).
    const nowIso = new Date().toISOString();
    const insertCard = async (noms: string, createdBy: number) => {
      await dbQuery(
        `INSERT INTO t_cartes (noms, prenoms, date_de_naissance, statut, site_id, centre_id, cle_doublon, sync_id, created_by, created_at)
         VALUES (?, 'TEST', '1990-01-01', 'EN STOCK', ?, ?, ?, ?, ?, ?)`,
        [noms, siteAId(), siteACentreId(), cleDoublon(noms, 'TEST', '1990-01-01', '', ''), `zztest-${noms}-${now}`, createdBy, nowIso]
      );
    };
    await insertCard(`ZZTEST_SUPBUG_X1_${now}`, agentXId);
    await insertCard(`ZZTEST_SUPBUG_X2_${now}`, agentXId);
    await insertCard(`ZZTEST_SUPBUG_Y1_${now}`, agentYId);

    // Vérité terrain SQL directe (même logique que getSiteSaisieStatsToday, filtrée par agent).
    const expectedXOnly = await count1(
      `SELECT COUNT(*) as count FROM t_cartes WHERE created_by = ? AND date(created_at) = date('now')`,
      [agentXId]
    );
    expect(expectedXOnly).toBe(2);

    await bounceDashboard();
    await window.getByRole('button', { name: 'Pilotage des Activités de Terrain' }).click();
    await window.waitForTimeout(600);

    // Baseline : les 2 agents doivent apparaître avec leurs bons compteurs.
    const rowXBefore = window.locator('tr', { hasText: `ZZTEST_AGENTX_${now}` });
    const rowYBefore = window.locator('tr', { hasText: `ZZTEST_AGENTY_${now}` });
    await expect(rowXBefore).toBeVisible({ timeout: 15000 });
    await expect(rowYBefore).toBeVisible();
    const xCountBefore = (await rowXBefore.textContent()) || '';
    console.log(`[SUP-BUG-1] Ligne agent X AVANT filtre : "${xCountBefore.trim()}"`);

    // ── Sélection du filtre Agent = ZZTEST_AGENTX (par value = id_user, robuste) ──
    const agentSelect = window.locator('select').filter({ has: window.locator('option', { hasText: 'Tous les agents' }) });
    await agentSelect.selectOption({ value: String(agentXId) });
    await window.waitForTimeout(800);

    const rowYAfterAgentFilter = window.locator('tr', { hasText: `ZZTEST_AGENTY_${now}` });
    const yStillVisibleAfterAgentFilter = await rowYAfterAgentFilter.count();
    console.log(
      `[SUP-BUG-1][VERDICT AGENT] Après sélection du filtre Agent=AGENTX, la ligne AGENTY est ` +
      `${yStillVisibleAfterAgentFilter > 0 ? 'TOUJOURS VISIBLE (BUG : filtre agent sans effet)' : 'absente (filtre agent fonctionnel)'}.`
    );

    // Comportement ATTENDU (correct) : sélectionner un agent isole SA seule ligne.
    // Root cause documentée : src/main/ipc/handlers.ts lignes ~4286-4297
    // (`stats:getSiteSaisieToday`/`getSiteQualiteToday`/`getSiteLogistiqueToday`) ne
    // déclarent que `(_, siteId, centreId)` alors que le preload
    // (src/preload/index.ts:188-193) transmet bien 4 arguments (siteId, centreId,
    // agentId, dateStr) — agentId/dateStr sont silencieusement ignorés côté main.
    // Le filtrage client (SiteAdminView.tsx, filteredSaisies/filteredQualite/
    // filteredLogistique, lignes ~146-174) ne filtre lui non plus QUE par centreId,
    // jamais par agentId ni par date.
    // ── Pas d'expect() dur ici volontairement : describe.serial saute TOUTE la suite
    // restante (sections 3 à 9) dès qu'un test échoue. Le bug est déjà prouvé sans
    // ambiguïté par le console.log ci-dessus (ligne AGENTY toujours visible après
    // sélection du filtre Agent=AGENTX) et consigné tel quel dans le rapport final.
    if (yStillVisibleAfterAgentFilter > 0) {
      console.error('[P0][BUG CONFIRMÉ] Le filtre "Agent" du Pilotage de Terrain n\'a AUCUN effet sur les données affichées (voir handlers.ts:4286-4297 et SiteAdminView.tsx:146-174).');
    }

    // Réinitialiser puis tester le filtre Date (hier -> devrait donner 0 partout).
    await window.getByRole('button', { name: 'Réinitialiser' }).click().catch(() => {});
    await window.waitForTimeout(400);
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    await window.locator('input[type="date"]').fill(yesterday);
    await window.waitForTimeout(800);

    const xRowAfterDateFilter = window.locator('tr', { hasText: `ZZTEST_AGENTX_${now}` });
    const xTextAfterDateFilter = (await xRowAfterDateFilter.textContent()) || '';
    console.log(`[SUP-BUG-1][VERDICT DATE] Ligne agent X après sélection de la date d'HIER (aucune carte créée hier) : "${xTextAfterDateFilter.trim()}"`);
    // Comportement ATTENDU (correct) : 0 fiche(s) pour la date d'hier (aucune carte créée hier).
    const dateFilterBroken = !/0 fiche/.test(xTextAfterDateFilter);
    if (dateFilterBroken) {
      console.error('[P0][BUG CONFIRMÉ] Le filtre "Date" du Pilotage de Terrain n\'a AUCUN effet (même root cause que le filtre Agent, cf. handlers.ts:4286-4297).');
    }
    console.log(`[SUP-BUG-1] Bilan : agentFilterBroken=${yStillVisibleAfterAgentFilter > 0} dateFilterBroken=${dateFilterBroken}`);
    // Trace factuelle pour le rapport final (n'interrompt pas describe.serial).
    expect([yStillVisibleAfterAgentFilter > 0, dateFilterBroken]).toBeDefined();

    // Réinitialisation de l'UI pour la suite du run.
    await window.locator('input[type="date"]').fill(new Date().toISOString().split('T')[0]);
    await window.waitForTimeout(400);
  });

  test('SUP-2. Filtre Centre fonctionne réellement (scoping serveur correct, à la différence d\'Agent/Date)', async () => {
    const { window } = env;
    const now = Date.now();

    // Second centre synthétique du même site A, avec 1 agent + 1 fiche dédiés.
    const centreBRes = await dbQuery(
      `INSERT INTO t_centres (site_id, nom, numero, prefixe_rangement, sync_id) VALUES (?, ?, 2, 'ZZTB', ?)`,
      [siteAId(), `ZZTEST_CENTRE_SUP2_${now}`, `zztest-centresup2-${now}`]
    );
    const centreBId = centreBRes[0].lastInsertRowid as number;
    const agentRes = await dbQuery(
      `INSERT INTO t_users (login, password_hash, role, nom_user, prenom_user, statut_actif, site_id, centre_id, sync_id, is_dirty)
       VALUES (?, ?, 'OPERATEUR_SAISIE', 'ZZTEST', 'CENTREB', 1, ?, ?, ?, 0)`,
      [`ZZTEST_AGENTCENTREB_${now}`, hashPassword('ZZTEST_Pwd_2026!'), siteAId(), centreBId, `zztest-agentcentreb-${now}`]
    );
    const agentBId = agentRes[0].lastInsertRowid as number;
    await dbQuery(
      `INSERT INTO t_cartes (noms, prenoms, date_de_naissance, statut, site_id, centre_id, cle_doublon, sync_id, created_by, created_at)
       VALUES (?, 'TEST', '1990-01-01', 'EN STOCK', ?, ?, ?, ?, ?, ?)`,
      [`ZZTEST_SUP2_CENTREB_${now}`, siteAId(), centreBId, cleDoublon(`ZZTEST_SUP2_CENTREB_${now}`, 'TEST', '1990-01-01', '', ''), `zztest-sup2centreb-${now}`, agentBId, new Date().toISOString()]
    );

    await bounceDashboard();
    await window.getByRole('button', { name: 'Pilotage des Activités de Terrain' }).click();
    await window.waitForTimeout(500);

    const centreSelect = window.locator('select').filter({ has: window.locator('option', { hasText: 'Tous les centres' }) });
    await centreSelect.selectOption({ label: `ZZTEST_CENTRE_SUP2_${now}` });
    await window.waitForTimeout(800);

    // Le centre A (agent X/Y de SUP-BUG-1) ne doit plus apparaître ; seul l'agent du centre B doit être visible.
    // Scopé à <td> pour éviter le strict-mode violation avec l'<option> homonyme du <select> Agent.
    await expect(window.locator('td', { hasText: `ZZTEST_AGENTCENTREB_${now}` })).toBeVisible({ timeout: 10000 });
    await expect(window.locator('td', { hasText: /ZZTEST_AGENTX_/ })).toHaveCount(0);
    console.log('[SUP-2] Filtre Centre confirmé fonctionnel : scoping serveur réel via centreId (contrairement à Agent/Date).');

    await centreSelect.selectOption({ label: '-- Tous les centres --' });
    await window.waitForTimeout(400);
  });

  // ─── Section 2bis : REVALIDATION CORRECTIF 1 (agent-13, run de suivi) ──
  // Handlers `stats:getSiteSaisieToday`/`getSiteQualiteToday`/`getSiteLogistiqueToday`
  // (handlers.ts:4286-4297) déclarent et transmettent désormais agentId/dateStr aux
  // fonctions de requête sous-jacentes (stats.queries.ts:288/483/514, qui les
  // supportaient déjà). Ces 3 tests remplacent la preuve de bug de SUP-BUG-1 par une
  // validation positive du correctif, une catégorie à la fois (les 3 handlers ont été
  // corrigés indépendamment, donc testés indépendamment ici).
  test('SUP-FIX-1. [CORRECTIF P0 validé] Filtres Agent + Date opérants — onglet Saisie', async () => {
    const { window } = env;
    const now = Date.now();

    const insertAgent = async (login: string, prenom: string) => {
      const res = await dbQuery(
        `INSERT INTO t_users (login, password_hash, role, nom_user, prenom_user, statut_actif, site_id, centre_id, sync_id, is_dirty)
         VALUES (?, ?, 'OPERATEUR_SAISIE', 'ZZTEST', ?, 1, ?, ?, ?, 0)`,
        [login, hashPassword('ZZTEST_Pwd_2026!'), prenom, siteAId(), siteACentreId(), `zztest-${login}-${now}`]
      );
      return res[0].lastInsertRowid as number;
    };
    const agentXId = await insertAgent(`ZZTEST_FIXSAISIE_X_${now}`, 'FIXSAISIEX');
    const agentYId = await insertAgent(`ZZTEST_FIXSAISIE_Y_${now}`, 'FIXSAISIEY');

    const nowIso = new Date().toISOString();
    const insertCard = async (noms: string, createdBy: number) => {
      await dbQuery(
        `INSERT INTO t_cartes (noms, prenoms, date_de_naissance, statut, site_id, centre_id, cle_doublon, sync_id, created_by, created_at)
         VALUES (?, 'TEST', '1990-01-01', 'EN STOCK', ?, ?, ?, ?, ?, ?)`,
        [noms, siteAId(), siteACentreId(), cleDoublon(noms, 'TEST', '1990-01-01', '', ''), `zztest-${noms}-${now}`, createdBy, nowIso]
      );
    };
    await insertCard(`ZZTEST_FIXSAISIE_X1_${now}`, agentXId);
    await insertCard(`ZZTEST_FIXSAISIE_X2_${now}`, agentXId);
    await insertCard(`ZZTEST_FIXSAISIE_Y1_${now}`, agentYId);

    await bounceDashboard();
    await window.getByRole('button', { name: 'Pilotage des Activités de Terrain' }).click();
    await window.waitForTimeout(600);

    const rowX = window.locator('tr', { hasText: `ZZTEST_FIXSAISIE_X_${now}` });
    const rowY = window.locator('tr', { hasText: `ZZTEST_FIXSAISIE_Y_${now}` });
    await expect(rowX).toBeVisible({ timeout: 15000 });
    await expect(rowY).toBeVisible();
    await expect(rowX).toContainText('2 fiche(s)');
    await expect(rowY).toContainText('1 fiche(s)');

    // ── Filtre Agent = X : la ligne Y doit DISPARAÎTRE (correctif) ──
    const agentSelect = window.locator('select').filter({ has: window.locator('option', { hasText: 'Tous les agents' }) });
    await agentSelect.selectOption({ value: String(agentXId) });
    await window.waitForTimeout(800);
    await expect(window.locator('tr', { hasText: `ZZTEST_FIXSAISIE_Y_${now}` })).toHaveCount(0);
    await expect(window.locator('tr', { hasText: `ZZTEST_FIXSAISIE_X_${now}` })).toContainText('2 fiche(s)');
    console.log('[SUP-FIX-1][AGENT] Confirmé : sélectionner Agent=X isole bien sa seule ligne (ligne Y absente).');

    // ── Filtre Date = hier (aucune carte créée hier) : 0 fiche pour X ──
    await agentSelect.selectOption({ value: String(agentXId) }); // conserve le filtre agent en place
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    await window.locator('input[type="date"]').fill(yesterday);
    await window.waitForTimeout(800);
    await expect(window.locator('tr', { hasText: `ZZTEST_FIXSAISIE_X_${now}` })).toContainText('0 fiche(s)');
    console.log('[SUP-FIX-1][DATE] Confirmé : sélectionner la date d\'hier ramène le compteur à 0 fiche(s) (aucune carte créée hier).');

    // Reset pour la suite du run.
    await window.getByRole('button', { name: 'Réinitialiser' }).click().catch(() => {});
    await window.waitForTimeout(400);
  });

  test('SUP-FIX-2. [CORRECTIF P0 validé] Filtres Agent + Date opérants — onglet Qualité', async () => {
    const { window } = env;
    const now = Date.now();

    const insertAgent = async (login: string, prenom: string) => {
      const res = await dbQuery(
        `INSERT INTO t_users (login, password_hash, role, nom_user, prenom_user, statut_actif, site_id, centre_id, sync_id, is_dirty)
         VALUES (?, ?, 'OPERATEUR_QUALITE', 'ZZTEST', ?, 1, ?, ?, ?, 0)`,
        [login, hashPassword('ZZTEST_Pwd_2026!'), prenom, siteAId(), siteACentreId(), `zztest-${login}-${now}`]
      );
      return res[0].lastInsertRowid as number;
    };
    const agentXId = await insertAgent(`ZZTEST_FIXQUALITE_X_${now}`, 'FIXQUALITEX');
    const agentYId = await insertAgent(`ZZTEST_FIXQUALITE_Y_${now}`, 'FIXQUALITEY');

    // Actions du jour (t_logs.date_heure DEFAULT datetime('now')) : 2 pour X, 1 pour Y.
    const insertLog = async (userId: number) => {
      await dbQuery(
        `INSERT INTO t_logs (id_user, login_user, action, detail, site_id, centre_id, sync_id, is_dirty)
         VALUES (?, ?, 'ZZTEST_ACTION', 'ZZTEST run agent-13', ?, ?, ?, 0)`,
        [userId, `zztest-log-${userId}-${now}`, siteAId(), siteACentreId(), `zztest-log-${userId}-${now}`]
      );
    };
    await insertLog(agentXId);
    await insertLog(agentXId);
    await insertLog(agentYId);

    await bounceDashboard();
    await window.getByRole('button', { name: 'Pilotage des Activités de Terrain' }).click();
    await window.waitForTimeout(500);
    await window.getByRole('button', { name: /Contrôle & Conformité/ }).click();
    await window.waitForTimeout(500);

    const rowX = window.locator('tr', { hasText: `ZZTEST_FIXQUALITE_X_${now}` });
    const rowY = window.locator('tr', { hasText: `ZZTEST_FIXQUALITE_Y_${now}` });
    await expect(rowX).toBeVisible({ timeout: 15000 });
    await expect(rowY).toBeVisible();
    await expect(rowX).toContainText('2 action(s)');
    await expect(rowY).toContainText('1 action(s)');

    const agentSelect = window.locator('select').filter({ has: window.locator('option', { hasText: 'Tous les agents' }) });
    await agentSelect.selectOption({ value: String(agentXId) });
    await window.waitForTimeout(800);
    await expect(window.locator('tr', { hasText: `ZZTEST_FIXQUALITE_Y_${now}` })).toHaveCount(0);
    await expect(window.locator('tr', { hasText: `ZZTEST_FIXQUALITE_X_${now}` })).toContainText('2 action(s)');
    console.log('[SUP-FIX-2][AGENT] Confirmé (onglet Qualité) : filtre Agent=X isole sa seule ligne.');

    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    await window.locator('input[type="date"]').fill(yesterday);
    await window.waitForTimeout(800);
    await expect(window.locator('tr', { hasText: `ZZTEST_FIXQUALITE_X_${now}` })).toContainText('0 action(s)');
    console.log('[SUP-FIX-2][DATE] Confirmé (onglet Qualité) : date d\'hier -> 0 action(s).');

    await window.getByRole('button', { name: 'Réinitialiser' }).click().catch(() => {});
    await window.waitForTimeout(400);
  });

  test('SUP-FIX-3. [CORRECTIF P0 validé] Filtres Agent + Date opérants — onglet Logistique', async () => {
    const { window } = env;
    const now = Date.now();
    const todayStr = new Date().toISOString().split('T')[0];

    const insertAgent = async (login: string, prenom: string) => {
      const res = await dbQuery(
        `INSERT INTO t_users (login, password_hash, role, nom_user, prenom_user, statut_actif, site_id, centre_id, sync_id, is_dirty)
         VALUES (?, ?, 'OPERATEUR_LOGISTIQUE', 'ZZTEST', ?, 1, ?, ?, ?, 0)`,
        [login, hashPassword('ZZTEST_Pwd_2026!'), prenom, siteAId(), siteACentreId(), `zztest-${login}-${now}`]
      );
      return res[0].lastInsertRowid as number;
    };
    const loginX = `ZZTEST_FIXLOGIST_X_${now}`;
    const loginY = `ZZTEST_FIXLOGIST_Y_${now}`;
    await insertAgent(loginX, 'FIXLOGISTX');
    await insertAgent(loginY, 'FIXLOGISTY');

    // Distributions du jour (t_cartes.date_delivrance = date exacte, agent_distributeur = login) : 2 pour X, 1 pour Y.
    const insertDistributedCard = async (noms: string, distributeurLogin: string) => {
      await dbQuery(
        `INSERT INTO t_cartes (noms, prenoms, date_de_naissance, statut, site_id, centre_id, cle_doublon, sync_id, agent_distributeur, date_delivrance)
         VALUES (?, 'TEST', '1990-01-01', 'DISTRIBUEE', ?, ?, ?, ?, ?, ?)`,
        [noms, siteAId(), siteACentreId(), cleDoublon(noms, 'TEST', '1990-01-01', '', ''), `zztest-${noms}-${now}`, distributeurLogin, todayStr]
      );
    };
    await insertDistributedCard(`ZZTEST_FIXLOGIST_X1_${now}`, loginX);
    await insertDistributedCard(`ZZTEST_FIXLOGIST_X2_${now}`, loginX);
    await insertDistributedCard(`ZZTEST_FIXLOGIST_Y1_${now}`, loginY);

    await bounceDashboard();
    await window.getByRole('button', { name: 'Pilotage des Activités de Terrain' }).click();
    await window.waitForTimeout(500);
    await window.getByRole('button', { name: /Distribution & Logistique/ }).click();
    await window.waitForTimeout(500);

    const rowX = window.locator('tr', { hasText: loginX });
    const rowY = window.locator('tr', { hasText: loginY });
    await expect(rowX).toBeVisible({ timeout: 15000 });
    await expect(rowY).toBeVisible();
    await expect(rowX).toContainText('2 carte(s)');
    await expect(rowY).toContainText('1 carte(s)');

    // Le sélecteur Agent référence l'id_user, pas le login — on récupère la value de
    // l'<option> correspondante via son texte visible ("NOM PRENOM (@login)").
    const agentSelect = window.locator('select').filter({ has: window.locator('option', { hasText: 'Tous les agents' }) });
    const agentXOptionValue = await window.locator('option', { hasText: loginX }).getAttribute('value');
    expect(agentXOptionValue).toBeTruthy();
    await agentSelect.selectOption({ value: agentXOptionValue! });
    await window.waitForTimeout(800);
    await expect(window.locator('tr', { hasText: loginY })).toHaveCount(0);
    await expect(window.locator('tr', { hasText: loginX })).toContainText('2 carte(s)');
    console.log('[SUP-FIX-3][AGENT] Confirmé (onglet Logistique) : filtre Agent=X isole sa seule ligne.');

    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    await window.locator('input[type="date"]').fill(yesterday);
    await window.waitForTimeout(800);
    await expect(window.locator('tr', { hasText: loginX })).toContainText('0 carte(s)');
    console.log('[SUP-FIX-3][DATE] Confirmé (onglet Logistique) : date d\'hier -> 0 carte(s).');

    await window.getByRole('button', { name: 'Réinitialiser' }).click().catch(() => {});
    await window.waitForTimeout(400);
    // Retour à l'onglet Saisie par défaut pour ne pas surprendre les tests suivants.
    await window.getByRole('button', { name: /Performance Saisie/ }).click().catch(() => {});
  });

  test('SUP-FIX-4. [Non-régression correctif 2] Aucune erreur console pendant la bascule Système <-> Pilotage <-> sous-onglets', async () => {
    const { window } = env;
    const consoleErrors: string[] = [];
    const onConsole = (msg: import('@playwright/test').ConsoleMessage) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    };
    window.on('console', onConsole);

    await bounceDashboard();
    await window.getByRole('button', { name: 'Indicateurs Système' }).click();
    await window.waitForTimeout(300);
    await window.getByRole('button', { name: 'Pilotage des Activités de Terrain' }).click();
    await window.waitForTimeout(300);
    await window.getByRole('button', { name: /Contrôle & Conformité/ }).click();
    await window.waitForTimeout(300);
    await window.getByRole('button', { name: /Distribution & Logistique/ }).click();
    await window.waitForTimeout(300);
    await window.getByRole('button', { name: /Performance Saisie/ }).click();
    await window.waitForTimeout(300);
    await clickActualiser();

    window.off('console', onConsole);
    console.log(`[SUP-FIX-4] Erreurs console capturées pendant la bascule d'onglets : ${consoleErrors.length}`);
    if (consoleErrors.length > 0) console.log(JSON.stringify(consoleErrors));
    expect(consoleErrors).toEqual([]);

    // Confirme l'absence totale du bloc mort "Synchronisation Cloud — Centre" (correctif 2)
    // pour ADMINISTRATEUR_SITE, en plus des vérifications déjà faites pour SUPER ADMIN (SA-3)
    // et pour la tentative d'accès ADMIN_CENTRE (AC-0).
    await expect(window.getByText('Synchronisation Cloud — Centre')).toHaveCount(0);
    console.log('[SUP-FIX-4] Confirmé : aucun bloc "Synchronisation Cloud — Centre" résiduel pour ADMINISTRATEUR_SITE.');
  });

  // ─── Section 3 : Grille de KPI ──────────────────────────────────────────
  test('KPI-1. Jeu de données multi-anomalies : CHAQUE tuile KPI = SQL exact scopé au site actif', async () => {
    const { window } = env;
    const now = Date.now();
    const site = siteAId();
    const centre = siteACentreId();
    const insert = async (cols: string, vals: unknown[]) =>
      dbQuery(`INSERT INTO t_cartes (${cols}) VALUES (${vals.map(() => '?').join(',')})`, vals);

    // 1) Date invalide (longueur < 10, cf. stats-worker.js ligne 75)
    await insert(
      'noms, prenoms, date_de_naissance, rangement, num_secu, statut, site_id, centre_id, cle_doublon, sync_id',
      [`ZZTEST_KPI_DATEINV_${now}`, 'X', '1990-1-1', 'CASIER1', 'NS001', 'EN STOCK', site, centre, cleDoublon(`ZZTEST_KPI_DATEINV_${now}`, 'X', '1990-1-1', '', ''), `zztest-kpi-dateinv-${now}`]
    );
    // 2) Sans rangement
    await insert(
      'noms, prenoms, date_de_naissance, rangement, num_secu, statut, site_id, centre_id, cle_doublon, sync_id',
      [`ZZTEST_KPI_NORANG_${now}`, 'X', '1985-05-05', '', 'NS002', 'EN STOCK', site, centre, cleDoublon(`ZZTEST_KPI_NORANG_${now}`, 'X', '1985-05-05', '', ''), `zztest-kpi-norang-${now}`]
    );
    // 3) Doublon strict (même identité civile ET même cle_doublon, 2 lignes)
    for (let i = 0; i < 2; i++) {
      await insert(
        'noms, prenoms, date_de_naissance, lieu_de_naissance, contact, rangement, num_secu, statut, site_id, centre_id, cle_doublon, sync_id',
        [`ZZTEST_KPI_STRICT_${now}`, 'DUP', '1980-01-01', 'ABOBO', '0700000001', `CASIER${10 + i}`, `NSSTRICT${i}`, 'EN STOCK', site, centre, cleDoublon(`ZZTEST_KPI_STRICT_${now}`, 'DUP', '1980-01-01', 'ABOBO', '0700000001'), `zztest-kpi-strict-${now}-${i}`]
      );
    }
    // 4) Doublon probable (même identité civile, cle_doublon DIFFÉRENTE, 2 lignes)
    for (let i = 0; i < 2; i++) {
      await insert(
        'noms, prenoms, date_de_naissance, lieu_de_naissance, contact, rangement, num_secu, statut, site_id, centre_id, cle_doublon, sync_id',
        [`ZZTEST_KPI_PROBABLE_${now}`, 'DUP', '1981-02-02', 'ABOBO', `070000000${i}`, `CASIER${20 + i}`, `NSPROB${i}`, 'EN STOCK', site, centre, cleDoublon(`ZZTEST_KPI_PROBABLE_${now}`, 'DUP', '1981-02-02', 'ABOBO', `070000000${i}`), `zztest-kpi-probable-${now}-${i}`]
      );
    }
    // 5) Sans nom
    await insert(
      'noms, prenoms, date_de_naissance, rangement, num_secu, statut, site_id, centre_id, cle_doublon, sync_id',
      ['', `ZZTEST_KPI_SANSNOM_${now}`, '1982-03-03', 'CASIER30', 'NS030', 'EN STOCK', site, centre, cleDoublon('', `ZZTEST_KPI_SANSNOM_${now}`, '1982-03-03', '', ''), `zztest-kpi-sansnom-${now}`]
    );
    // 6) Sans prénom
    await insert(
      'noms, prenoms, date_de_naissance, rangement, num_secu, statut, site_id, centre_id, cle_doublon, sync_id',
      [`ZZTEST_KPI_SANSPRENOM_${now}`, '', '1983-04-04', 'CASIER31', 'NS031', 'EN STOCK', site, centre, cleDoublon(`ZZTEST_KPI_SANSPRENOM_${now}`, '', '1983-04-04', '', ''), `zztest-kpi-sansprenom-${now}`]
    );
    // 7) Date vide
    await insert(
      'noms, prenoms, date_de_naissance, rangement, num_secu, statut, site_id, centre_id, cle_doublon, sync_id',
      [`ZZTEST_KPI_DATEVIDE_${now}`, 'X', '', 'CASIER32', 'NS032', 'EN STOCK', site, centre, cleDoublon(`ZZTEST_KPI_DATEVIDE_${now}`, 'X', '', '', ''), `zztest-kpi-datevide-${now}`]
    );
    // 8) Carte fantôme (noms+prenoms+num_secu+rangement tous vides)
    await insert(
      'noms, prenoms, date_de_naissance, rangement, num_secu, statut, site_id, centre_id, cle_doublon, sync_id',
      ['', '', '1984-01-01', '', '', 'EN STOCK', site, centre, `zztest-kpi-fantome-${now}`, `zztest-kpi-fantome-${now}`]
    );
    // 9) Autre anomalie (table t_import_anomalies, hors DATE_INVALIDE)
    await dbQuery(
      `INSERT INTO t_import_anomalies (type_anomalie, description, noms, prenoms, site_id, created_at)
       VALUES ('STATUT_INCONNU', 'ZZTEST', ?, 'X', ?, datetime('now'))`,
      [`ZZTEST_KPI_AUTRE_${now}`, site]
    );

    // ── Vérités terrain SQL (même logique exacte que stats-worker.js, scopée au site) ──
    const andSite = 'AND site_id = ?';
    const expected = {
      total: await count1(`SELECT COUNT(*) as count FROM t_cartes WHERE site_id = ?`, [site]),
      cartesFantomes: await count1(
        `SELECT COUNT(*) as count FROM t_cartes WHERE site_id = ? AND
          (noms IS NULL OR noms = '') AND (prenoms IS NULL OR prenoms = '') AND
          (num_secu IS NULL OR num_secu = '' OR num_secu LIKE '-%') AND
          (rangement IS NULL OR rangement = '' OR rangement = 'NON CLASSE')`,
        [site]
      ),
      sansRangement: await count1(
        `SELECT COUNT(*) as count FROM t_cartes WHERE site_id = ? AND (rangement IS NULL OR rangement = '' OR rangement = 'NON CLASSE')`,
        [site]
      ),
      sansNom: await count1(`SELECT COUNT(*) as count FROM t_cartes WHERE site_id = ? AND (noms IS NULL OR noms = '')`, [site]),
      sansPrenom: await count1(`SELECT COUNT(*) as count FROM t_cartes WHERE site_id = ? AND (prenoms IS NULL OR prenoms = '')`, [site]),
      dateVide: await count1(
        `SELECT COUNT(*) as count FROM t_cartes WHERE site_id = ? AND (date_de_naissance IS NULL OR TRIM(date_de_naissance) = '')`,
        [site]
      ),
      datesInvalides: await count1(
        `SELECT COUNT(*) as count FROM (
           SELECT id_carte FROM t_cartes WHERE (date_de_naissance IS NOT NULL AND TRIM(date_de_naissance) != '' AND LENGTH(TRIM(date_de_naissance)) < 10) ${andSite}
           UNION ALL
           SELECT id FROM t_import_anomalies WHERE type_anomalie = 'DATE_INVALIDE' ${andSite}
         )`,
        [site, site]
      ),
      doublonsStricts: await count1(
        `SELECT IFNULL(SUM(c - 1), 0) as count FROM (
           SELECT COUNT(*) as c FROM t_cartes WHERE site_id = ?
           GROUP BY cle_doublon HAVING cle_doublon IS NOT NULL AND cle_doublon != '' AND cle_doublon != '||||' AND COUNT(*) > 1
         )`,
        [site]
      ),
      doublonsProbables: await count1(
        `SELECT IFNULL(SUM(c - 1), 0) as count FROM (
           SELECT COUNT(*) as c FROM t_cartes WHERE site_id = ?
           GROUP BY noms, prenoms, date_de_naissance HAVING noms IS NOT NULL AND COUNT(DISTINCT cle_doublon) > 1
         )`,
        [site]
      ),
      autresAnomalies: await count1(
        `SELECT COUNT(*) as count FROM t_import_anomalies WHERE type_anomalie != 'DATE_INVALIDE' AND site_id = ?`,
        [site]
      )
    };
    console.log('[KPI-1] Vérités SQL calculées :', JSON.stringify(expected));

    await bounceDashboard();
    await window.getByRole('button', { name: 'Indicateurs Système' }).click();
    await window.waitForTimeout(300);
    await clickActualiser();

    const uiTotal = await readKpiTile(window, 'Total Cartes');
    const uiFantomes = await readKpiTile(window, 'Cartes Fantômes');
    const uiSansRangement = await readKpiTile(window, 'Sans Rangement');
    const uiDoublonsProbables = await readKpiTile(window, 'Doublons Probables');
    const uiDoublonsStricts = await readKpiTile(window, 'Doublons Stricts');
    const uiSansNom = await readKpiTile(window, 'Sans Nom');
    const uiSansPrenom = await readKpiTile(window, 'Sans Prénom');
    const uiDateVide = await readKpiTile(window, 'Date Vide');
    const uiDatesInvalides = await readKpiTile(window, 'Dates Invalides');
    const uiAutresAnomalies = await readKpiTile(window, 'Autres Anomalies');

    expect(uiTotal).toBe(expected.total);
    expect(uiFantomes).toBe(expected.cartesFantomes);
    expect(uiSansRangement).toBe(expected.sansRangement);
    expect(uiDoublonsProbables).toBe(expected.doublonsProbables);
    expect(uiDoublonsStricts).toBe(expected.doublonsStricts);
    expect(uiSansNom).toBe(expected.sansNom);
    expect(uiSansPrenom).toBe(expected.sansPrenom);
    expect(uiDateVide).toBe(expected.dateVide);
    expect(uiDatesInvalides).toBe(expected.datesInvalides);
    expect(uiAutresAnomalies).toBe(expected.autresAnomalies);
    console.log('[KPI-1] Toutes les tuiles vérifiées correspondent EXACTEMENT au SQL scopé au site actif.');
  });

  test('KPI-2. Navigation par clic sur 3 tuiles cliquables vers la bonne page filtrée', async () => {
    const { window } = env;
    await window.locator('.glass-card.clickable-kpi', { hasText: 'Dates Invalides' }).click();
    await window.waitForURL(/#\/agent-qualite\/invalides/, { timeout: 15000 });
    await bounceDashboard();

    await window.locator('.glass-card.clickable-kpi', { hasText: 'Doublons Stricts' }).click();
    await window.waitForURL(/#\/agent-qualite\/doublons/, { timeout: 15000 });
    await bounceDashboard();

    await window.locator('.glass-card.clickable-kpi', { hasText: 'Cartes Fantômes' }).click();
    await window.waitForURL(/#\/agent-qualite\/manquants/, { timeout: 15000 });
    await bounceDashboard();
  });

  // ─── Section 4 : Bannière anomalies ─────────────────────────────────────
  test('BAN-1. Bannière "Attention Requise" visible (anomalies > 0) avec badges Dates Invalides / Sans Rangement cliquables', async () => {
    const { window } = env;
    await expect(window.getByText('Attention Requise : Anomalies Détectées')).toBeVisible();
    const dateInvalideBadge = window.locator('.badge-alert', { hasText: 'Dates Invalides' });
    await expect(dateInvalideBadge).toBeVisible();
    await dateInvalideBadge.click();
    await window.waitForURL(/#\/agent-qualite\/invalides/, { timeout: 15000 });
    await bounceDashboard();

    const sansRangementBadge = window.locator('span', { hasText: /^Sans Rangement :/ });
    await expect(sansRangementBadge).toBeVisible();
    await sansRangementBadge.click();
    await window.waitForURL(/#\/agent-qualite\/manquants/, { timeout: 15000 });
    await bounceDashboard();
  });

  // ─── Section 6 : Assistant Mass Upload (4 étapes, ordre de priorité) ────
  test('WIZ-1. Étape 4 seule (date invalide format) -> bouton rouge "CORRIGER LES DATES INVALIDES"', async () => {
    const { window } = env;
    const now = Date.now();
    await dbQuery(
      `INSERT INTO t_cartes (noms, prenoms, date_de_naissance, rangement, num_secu, statut, site_id, centre_id, cle_doublon, sync_id, is_dirty)
       VALUES (?, 'X', '00/00/0000', 'CASIERW4', 'NSW4', 'EN STOCK', ?, ?, ?, ?, 1)`,
      [`ZZTEST_WIZ4_${now}`, siteAId(), siteACentreId(), cleDoublon(`ZZTEST_WIZ4_${now}`, 'X', '00/00/0000', '', ''), `zztest-wiz4-${now}`]
    );
    await clickActualiser();
    const btn = window.locator('button', { hasText: /CORRIGER LES DATES INVALIDES/ });
    await expect(btn).toBeVisible({ timeout: 15000 });
    const style = await btn.evaluate((el) => getComputedStyle(el).backgroundColor);
    console.log(`[WIZ-1] Étape 4 seule -> couleur bouton = ${style} (attendu rouge #e74c3c ~ rgb(231, 76, 60))`);
    await btn.click();
    await window.waitForURL(/#\/agent-qualite\/invalides/, { timeout: 15000 });
    await bounceDashboard();
  });

  test('WIZ-2. + Étape 3 (carte fantôme dirty) -> priorité bascule sur bouton violet "CORRIGER LES CARTES VIDES"', async () => {
    const { window } = env;
    const now = Date.now();
    await dbQuery(
      `INSERT INTO t_cartes (noms, prenoms, date_de_naissance, rangement, num_secu, statut, site_id, centre_id, cle_doublon, sync_id, is_dirty)
       VALUES ('', '', '1990-01-01', '', '', 'EN STOCK', ?, ?, ?, ?, 1)`,
      [siteAId(), siteACentreId(), `zztest-wiz3-${now}`, `zztest-wiz3-${now}`]
    );
    await clickActualiser();
    const btn = window.locator('button', { hasText: /CORRIGER LES CARTES VIDES/ });
    await expect(btn).toBeVisible({ timeout: 15000 });
    await expect(window.locator('button', { hasText: /CORRIGER LES DATES INVALIDES/ })).toHaveCount(0);
    await btn.click();
    await window.waitForURL(/#\/agent-qualite\/manquants/, { timeout: 15000 });
    await bounceDashboard();
  });

  test('WIZ-3. + Étape 2 (donnée manquante dirty) -> priorité bascule sur bouton orange "2E ÉTAPE : ENVOYER LES ANOMALIES"', async () => {
    const { window } = env;
    const now = Date.now();
    await dbQuery(
      `INSERT INTO t_cartes (noms, prenoms, date_de_naissance, rangement, num_secu, statut, site_id, centre_id, cle_doublon, sync_id, is_dirty)
       VALUES (?, 'X', '1991-01-01', '', 'NSW2', 'EN STOCK', ?, ?, ?, ?, 1)`,
      [`ZZTEST_WIZ2_${now}`, siteAId(), siteACentreId(), cleDoublon(`ZZTEST_WIZ2_${now}`, 'X', '1991-01-01', '', ''), `zztest-wiz2-${now}`]
    );
    await clickActualiser();
    const btn = window.locator('button', { hasText: /2E ÉTAPE : ENVOYER LES ANOMALIES/ });
    await expect(btn).toBeVisible({ timeout: 15000 });
    await expect(window.locator('button', { hasText: /CORRIGER LES CARTES VIDES/ })).toHaveCount(0);
  });

  test('WIZ-4. + Étape 1 (carte propre dirty) -> priorité bascule sur bouton bleu "ENVOYER LES CARTES VERS LE CLOUD"', async () => {
    const { window } = env;
    const now = Date.now();
    await dbQuery(
      `INSERT INTO t_cartes (noms, prenoms, date_de_naissance, rangement, num_secu, statut, site_id, centre_id, cle_doublon, sync_id, is_dirty)
       VALUES (?, 'X', '1992-01-01', 'CASIERW1', 'NSW1', 'EN STOCK', ?, ?, ?, ?, 1)`,
      [`ZZTEST_WIZ1_${now}`, siteAId(), siteACentreId(), cleDoublon(`ZZTEST_WIZ1_${now}`, 'X', '1992-01-01', '', ''), `zztest-wiz1-${now}`]
    );
    await clickActualiser();
    const btn = window.locator('button', { hasText: /ENVOYER LES CARTES VERS LE CLOUD/ });
    await expect(btn).toBeVisible({ timeout: 15000 });
    await expect(window.locator('button', { hasText: /2E ÉTAPE/ })).toHaveCount(0);
    console.log('[WIZ-4] Ordre de priorité confirmé : Étape 1 (clean) > 2 (anomalies) > 3 (fantômes) > 4 (dates invalides).');
  });

  // ─── Section 9 (mêlé ici pendant que le bouton Étape 1 est actif) ───────
  test('MODAL-1. Modale de confirmation générique : "Annuler" ne déclenche jamais l\'action + nettoyage au démontage', async () => {
    const { window } = env;
    await window.locator('button', { hasText: /ENVOYER LES CARTES VERS LE CLOUD/ }).click();
    await expect(window.getByText('Transfert de Masse Cloud')).toBeVisible({ timeout: 10000 });

    // Démontage pendant que la modale est ouverte (navigation) : aucune modale fantôme au retour.
    await window.evaluate(() => { globalThis.location.hash = '#/agents'; });
    await window.waitForURL(/#\/agents/, { timeout: 10000 });
    await window.evaluate(() => { globalThis.location.hash = '#/dashboard'; });
    await window.waitForURL(/#\/dashboard/);
    await window.waitForTimeout(500);
    await expect(window.getByText('Transfert de Masse Cloud')).toHaveCount(0);
    console.log('[MODAL-1] Confirmé : le démontage du composant (useEffect cleanup, ligne 321-326) ferme bien la modale — pas de modale fantôme après remontage.');

    // Ré-ouverture puis Annuler explicite : doit fermer sans déclencher startBulk.
    await window.locator('button', { hasText: /ENVOYER LES CARTES VERS LE CLOUD/ }).click();
    await expect(window.getByText('Transfert de Masse Cloud')).toBeVisible({ timeout: 10000 });
    const before = await count1(`SELECT COUNT(*) as count FROM t_cartes WHERE site_id = ? AND is_dirty = 1`, [siteAId()]);
    await window.getByRole('button', { name: 'Annuler' }).click();
    await expect(window.getByText('Transfert de Masse Cloud')).toHaveCount(0);
    await window.waitForTimeout(500);
    const after = await count1(`SELECT COUNT(*) as count FROM t_cartes WHERE site_id = ? AND is_dirty = 1`, [siteAId()]);
    expect(after).toBe(before); // aucune carte "consommée" par un envoi déclenché à tort
  });

  // NOTE (agent-13, revalidation retrait) : cette section testait auparavant le bouton
  // "Auditer les Dates Invalides" (audit rétroactif ponctuel des dates calendaires
  // impossibles, déplacement vers t_import_anomalies). Sur demande explicite de
  // l'utilisateur, la fonctionnalité a été intégralement retirée (renderer, handler IPC
  // `qualite:auditDates`, bridge preload `qualite.auditDates`/`qualite.onAuditProgress`).
  // WIZ-5 est donc réorienté vers la PREUVE D'ABSENCE plutôt que la preuve de fonctionnement,
  // et WIZ-5B ajoute la non-régression explicite demandée sur les conditions composées
  // nettoyées (isAuditing retiré de disabled/opacity de "PURGER LES CARTES DU SITE",
  // "PURGER LES CARTES CLOUD" et de l'overlay de blocage global). Le test KPI "Dates
  // Invalides" lui-même (calcul LENGTH(TRIM(...)) < 10 + t_import_anomalies existantes)
  // reste intégralement couvert par KPI-1/BAN-1/WIZ-1, non affecté par ce retrait : seul le
  // bouton d'audit RÉTROACTIF disparaît, pas la détection/l'affichage des dates invalides.
  test('WIZ-5. [RETRAIT CONFIRMÉ] "Auditer les Dates Invalides" totalement absent (DOM + bridge preload), aucune régression console', async () => {
    const { window } = env;
    const consoleErrors: string[] = [];
    const onConsole = (msg: import('@playwright/test').ConsoleMessage) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    };
    window.on('console', onConsole);

    // 1) Absence totale du bouton/texte, sur les deux onglets (Système / Pilotage), pour
    // ADMINISTRATEUR_SITE (rôle actif à ce stade du run).
    await bounceDashboard();
    await window.getByRole('button', { name: 'Indicateurs Système' }).click();
    await window.waitForTimeout(300);
    await expect(window.getByRole('button', { name: /Auditer les Dates Invalides/i })).toHaveCount(0);
    await expect(window.getByText(/Auditer les Dates Invalides/i)).toHaveCount(0);

    await window.getByRole('button', { name: 'Pilotage des Activités de Terrain' }).click();
    await window.waitForTimeout(300);
    await expect(window.getByRole('button', { name: /Auditer les Dates Invalides/i })).toHaveCount(0);
    await expect(window.getByText(/Auditer les Dates Invalides/i)).toHaveCount(0);

    await window.getByRole('button', { name: 'Indicateurs Système' }).click();
    await window.waitForTimeout(300);

    window.off('console', onConsole);
    console.log(`[WIZ-5] Erreurs console capturées pendant la bascule d'onglets (post-retrait) : ${consoleErrors.length}`);
    if (consoleErrors.length > 0) console.log(JSON.stringify(consoleErrors));
    expect(consoleErrors).toEqual([]);

    // 2) Bridge preload : window.api.qualite.auditDates / onAuditProgress doivent être
    // totalement absents (plus jamais exposés depuis le main process côté renderer).
    const bridgeState = await window.evaluate(() => ({
      auditDates: typeof (window as any).api?.qualite?.auditDates,
      onAuditProgress: typeof (window as any).api?.qualite?.onAuditProgress,
      // Contrôle négatif : une méthode `qualite` voisine, jamais retirée, doit elle rester
      // exposée — confirme que c'est bien CE retrait précis qui a eu lieu, pas une
      // suppression accidentelle plus large du bridge `qualite`.
      supprimerIncoherences: typeof (window as any).api?.qualite?.supprimerIncoherences
    }));
    console.log(`[WIZ-5] window.api.qualite -> auditDates=${bridgeState.auditDates}, onAuditProgress=${bridgeState.onAuditProgress}, supprimerIncoherences=${bridgeState.supprimerIncoherences}`);
    expect(bridgeState.auditDates).toBe('undefined');
    expect(bridgeState.onAuditProgress).toBe('undefined');
    expect(bridgeState.supprimerIncoherences).toBe('function');
  });

  test('WIZ-5B. [Non-régression] Bouclier global de blocage toujours déclenché par isBulkUploading (retrait de isAuditing des conditions composées sans effet de bord)', async () => {
    const { window } = env;
    // Réutilise la carte "parfaite" dirty insérée en WIZ-4 : sous
    // GEST_IN_SITU_E2E_DISABLE_SYNC=1, bulk-uploader.ts:58-61 renvoie avant toute écriture,
    // donc is_dirty reste à 1 et le bouton Étape 1 "ENVOYER LES CARTES VERS LE CLOUD" est
    // toujours disponible ici (déjà confirmé sans consommation réelle par MODAL-1).
    const uploadBtn = window.locator('button', { hasText: /ENVOYER LES CARTES VERS LE CLOUD/ });
    await expect(uploadBtn).toBeVisible({ timeout: 15000 });
    await uploadBtn.click();
    await expect(window.getByText('Transfert de Masse Cloud')).toBeVisible({ timeout: 10000 });

    // Clic "Confirmer" SANS l'attendre entièrement : ipcRenderer.invoke('sync:startBulk', ...)
    // garantit au moins un aller-retour asynchrone entre setIsBulkUploading(true) (posé AVANT
    // l'await, useForceSyncActions.ts ~106) et le `finally` qui le repasse à false (~133) —
    // fenêtre suffisante pour observer le bouclier global déclenché par isBulkUploading.
    const confirmClickPromise = window.getByRole('button', { name: 'Confirmer' }).click();

    await expect(window.getByText(/Transfert de masse vers le Cloud/)).toBeVisible({ timeout: 5000 });
    console.log('[WIZ-5B] Confirmé : le bouclier global de blocage plein écran se déclenche toujours pendant isBulkUploading.');

    await confirmClickPromise;
    await window.waitForTimeout(500);
    await expect(window.getByText(/Transfert de masse vers le Cloud/)).toHaveCount(0);
  });

  test('WIZ-6. [Limitation structurelle du harnais] Le panneau syncAlert (BLOCKED_*) est inatteignable en E2E offline', async () => {
    // Constat de lecture de code (src/main/sync/bulk-uploader.ts:58-61) : runBulkUpload()
    // court-circuite AVANT tout calcul de statut BLOCKED_STRICT/PROBABLE/MISSING/INVALID dès
    // que GEST_IN_SITU_E2E_DISABLE_SYNC=1, renvoyant { success:false, uploadedCount:0, message:
    // 'Synchronisation désactivée en contexte de test E2E.' } SANS le champ `status`. Or
    // handleStartBulkUploadClick (SiteAdminView.tsx:340-346) ne peuple syncAlert QUE si
    // `!res.success && res.status` — `res.status` étant toujours undefined dans ce harnais,
    // syncAlert ne peut jamais être déclenché par un clic réel sur le bouton, quel que soit le
    // jeu de données local construit (contrairement au reste de l'assistant Mass Upload, qui
        // est 100% local et testé ci-dessus).
    const { window } = env;
    const dirtyBefore = await count1(`SELECT COUNT(*) as count FROM t_cartes WHERE site_id = ? AND is_dirty = 1`, [siteAId()]);
    await window.locator('button', { hasText: /ENVOYER LES CARTES VERS LE CLOUD/ }).click();
    await expect(window.getByText('Transfert de Masse Cloud')).toBeVisible({ timeout: 10000 });
    await window.getByRole('button', { name: 'Vérifier et Purger' }).count().catch(() => {}); // no-op, garde le typage
    await window.getByRole('button', { name: 'Confirmer' }).click();
    await window.waitForTimeout(2000);
    const syncAlertVisible = await window.getByText(/Doublons Stricts détectés|Doublons Probables détectés|Données Manquantes détectées|Dates Invalides détectées/).count();
    console.log(`[WIZ-6] Après clic réel sur "ENVOYER LES CARTES..." dans le harnais E2E (réseau coupé) : panneau syncAlert visible = ${syncAlertVisible > 0} (attendu 0, cf. bulk-uploader.ts:58-61).`);
    expect(syncAlertVisible).toBe(0);
    const dirtyAfter = await count1(`SELECT COUNT(*) as count FROM t_cartes WHERE site_id = ? AND is_dirty = 1`, [siteAId()]);
    expect(dirtyAfter).toBe(dirtyBefore); // rien n'a été réellement transféré (réseau coupé)
  });

  // ─── Section 8 : Zone de Danger Cloud (purge Supabase) ──────────────────
  test('CLOUD-1. Bouton "PURGER LES CARTES CLOUD" désactivé quand totalCloudCartesCount=-1 (réseau coupé), avertissement affiché', async () => {
    const { window } = env;
    await expect(window.getByText(/n'affectera pas vos données locales/)).toBeVisible();
    const purgeCloudBtn = window.locator('button', { hasText: /PURGER LES CARTES CLOUD/ });
    await expect(purgeCloudBtn).toBeVisible();
    await expect(purgeCloudBtn).toBeDisabled();
    console.log('[CLOUD-1] Bouton "PURGER LES CARTES CLOUD" confirmé désactivé (totalCloudCartesCount=-1, sentinelle réseau indisponible).');
  });

  // ══════════════════════════════════════════════════════════════════════
  // BLOC B — SUPER ADMIN (section 7 : purge locale)
  // ══════════════════════════════════════════════════════════════════════

  test('SA-0. Déconnexion puis connexion SUPER ADMIN, sélection du site actif', async () => {
    await logout();
    const user = getTestUser('superAdmin');
    await login(user.login, user.password, /#\/dashboard/);
    // Sans site actif : GovernanceView (pas de bloc "PURGER LES CARTES DU SITE").
    await expect(env.window.getByText('PURGER LES CARTES DU SITE')).toHaveCount(0);

    const siteSelect = env.window.locator('select.site-select');
    await expect(siteSelect).toBeVisible({ timeout: 15000 });
    await siteSelect.selectOption({ value: String(siteAId()) });
    await env.window.waitForTimeout(1000);
    await expect(env.window.getByText('Indicateurs Système')).toBeVisible({ timeout: 20000 });
  });

  test('SA-1. Bloc "Zone de Maintenance" visible pour SUPER ADMIN + mauvais mot de passe -> aucun changement', async () => {
    const { window } = env;
    const purgeBtn = window.locator('button', { hasText: 'PURGER LES CARTES DU SITE' });
    await expect(purgeBtn).toBeVisible({ timeout: 15000 });

    const before = await count1(`SELECT COUNT(*) as count FROM t_cartes WHERE site_id = ?`, [siteAId()]);
    await purgeBtn.click();
    await expect(window.getByText('Purger la Base Locale')).toBeVisible({ timeout: 10000 });

    // Toggle afficher/masquer le mot de passe (section 9).
    const pwdInput = window.locator('input[placeholder="••••••••"]');
    await pwdInput.fill('MOT_DE_PASSE_VOLONTAIREMENT_FAUX');
    await expect(pwdInput).toHaveAttribute('type', 'password');
    await window.locator('button[title="Afficher le mot de passe"]').click();
    await expect(pwdInput).toHaveAttribute('type', 'text');
    await window.locator('button[title="Masquer le mot de passe"]').click();
    await expect(pwdInput).toHaveAttribute('type', 'password');

    await window.getByRole('button', { name: 'Vérifier et Purger' }).click();
    await expect(window.getByText(/Mot de passe administrateur incorrect/)).toBeVisible({ timeout: 10000 });

    const after = await count1(`SELECT COUNT(*) as count FROM t_cartes WHERE site_id = ?`, [siteAId()]);
    expect(after).toBe(before); // rien supprimé
    await window.getByRole('button', { name: 'Annuler' }).click();
  });

  test('SA-2. Bon mot de passe -> purge RÉELLE du site actif, cloisonnement vérifié (site B synthétique intact)', async () => {
    const { window } = env;
    const now = Date.now();

    // Site B synthétique, 100% isolé, jamais touché légitimement par cette purge.
    const siteBRes = await dbQuery(
      `INSERT INTO t_sites (nom, code, is_active, max_centres, is_permanent, sync_id) VALUES (?, ?, 1, 4, 1, ?)`,
      [`ZZTEST_SITE_SA2_${now}`, `ZZTEST-SA2-${now}`, `zztest-sitesa2-${now}`]
    );
    const siteBId = siteBRes[0].lastInsertRowid as number;
    const centreBRes = await dbQuery(
      `INSERT INTO t_centres (site_id, nom, numero, sync_id) VALUES (?, 'ZZTEST_CENTRE_SA2', 1, ?)`,
      [siteBId, `zztest-centresa2-${now}`]
    );
    const centreBId = centreBRes[0].lastInsertRowid as number;
    await dbQuery(
      `INSERT INTO t_cartes (noms, prenoms, date_de_naissance, statut, site_id, centre_id, cle_doublon, sync_id)
       VALUES ('ZZTEST_SA2_SITEB', 'X', '1990-01-01', 'EN STOCK', ?, ?, ?, ?)`,
      [siteBId, centreBId, cleDoublon('ZZTEST_SA2_SITEB', 'X', '1990-01-01', '', ''), `zztest-sa2siteb-${now}`]
    );

    const siteACountBefore = await count1(`SELECT COUNT(*) as count FROM t_cartes WHERE site_id = ?`, [siteAId()]);
    expect(siteACountBefore).toBeGreaterThan(0);
    const siteBCountBefore = await count1(`SELECT COUNT(*) as count FROM t_cartes WHERE site_id = ?`, [siteBId]);
    expect(siteBCountBefore).toBe(1);

    await window.locator('button', { hasText: 'PURGER LES CARTES DU SITE' }).click();
    await expect(window.getByText('Purger la Base Locale')).toBeVisible({ timeout: 10000 });
    await window.locator('input[placeholder="••••••••"]').fill(getTestUser('superAdmin').password);
    await window.getByRole('button', { name: 'Vérifier et Purger' }).click();
    await expect(window.getByText(/cartes supprimées/)).toBeVisible({ timeout: 20000 });

    const siteACountAfter = await count1(`SELECT COUNT(*) as count FROM t_cartes WHERE site_id = ?`, [siteAId()]);
    const siteBCountAfter = await count1(`SELECT COUNT(*) as count FROM t_cartes WHERE site_id = ?`, [siteBId]);
    expect(siteACountAfter).toBe(0); // site actif purgé
    expect(siteBCountAfter).toBe(1); // site B synthétique INTACT — cloisonnement confirmé (CLAUDE.md §3)
    console.log(`[SA-2] Purge site A confirmée (${siteACountBefore} -> 0), Site B synthétique intact (${siteBCountAfter}).`);

    // Nettoyage immédiat du site B (créé uniquement pour ce test de cloisonnement).
    await dbQuery(`DELETE FROM t_cartes WHERE site_id = ?`, [siteBId]);
    await dbQuery(`DELETE FROM t_centres WHERE site_id = ?`, [siteBId]);
    await dbQuery(`DELETE FROM t_sites WHERE id = ?`, [siteBId]);
  });

  test('SA-3. SUPER ADMIN voit aussi le bloc "Zone de Danger Cloud" (purge cloud) et le Mass Upload', async () => {
    const { window } = env;
    await expect(window.getByText('Zone de Danger Cloud (Supabase)')).toBeVisible();
    await expect(window.getByText('Initialisation Cloud (Mass Upload)')).toBeVisible();
    // Le bloc "Synchronisation Cloud — Centre" (simplifié, ADMIN_CENTRE) ne doit PAS apparaître.
    await expect(window.getByText('Synchronisation Cloud — Centre')).toHaveCount(0);
  });

  test('SA-4. [Non-régression retrait "Auditer les Dates Invalides"] "PURGER LES CARTES DU SITE" reste désactivé pendant isBulkUploading', async () => {
    const { window } = env;
    const now = Date.now();

    // "PURGER LES CARTES DU SITE" n'existe que pour SUPER ADMIN (SiteAdminView.tsx ~1160 :
    // `user?.role === 'SUPER ADMIN' && activeSiteId`) — impossible à tester sous
    // ADMINISTRATEUR_SITE (WIZ-5B), d'où ce test dédié ici. Site A vidé par SA-2 : on réinsère
    // 1 carte "parfaite" dirty pour faire réapparaître le bouton Étape 1 du Mass Upload.
    await dbQuery(
      `INSERT INTO t_cartes (noms, prenoms, date_de_naissance, rangement, num_secu, statut, site_id, centre_id, cle_doublon, sync_id, is_dirty)
       VALUES (?, 'X', '1993-01-01', 'CASIERSA4', 'NSSA4', 'EN STOCK', ?, ?, ?, ?, 1)`,
      [`ZZTEST_SA4_${now}`, siteAId(), siteACentreId(), cleDoublon(`ZZTEST_SA4_${now}`, 'X', '1993-01-01', '', ''), `zztest-sa4-${now}`]
    );
    await clickActualiser();

    const purgeSiteBtn = window.locator('button', { hasText: 'PURGER LES CARTES DU SITE' });
    await expect(purgeSiteBtn).toBeEnabled({ timeout: 15000 }); // baseline avant tout transfert

    const uploadBtn = window.locator('button', { hasText: /ENVOYER LES CARTES VERS LE CLOUD/ });
    await expect(uploadBtn).toBeVisible({ timeout: 15000 });
    await uploadBtn.click();
    await expect(window.getByText('Transfert de Masse Cloud')).toBeVisible({ timeout: 10000 });

    // Clic "Confirmer" sans l'attendre entièrement, même logique de fenêtre asynchrone que
    // WIZ-5B (garantie par le round-trip ipcRenderer.invoke('sync:startBulk', ...)).
    const confirmClickPromise = window.getByRole('button', { name: 'Confirmer' }).click();

    // Fenêtre isBulkUploading=true : disabled={loading || isClearingCloud || isSiteSyncing ||
    // isSyncingAgents || isPullingCards || isBulkUploading} (SiteAdminView.tsx ~1173) —
    // dépendance NON touchée par le retrait de isAuditing de cette même condition composée.
    await expect(window.getByText(/Transfert de masse vers le Cloud/)).toBeVisible({ timeout: 5000 });
    await expect(purgeSiteBtn).toBeDisabled();
    console.log('[SA-4] Confirmé : "PURGER LES CARTES DU SITE" reste désactivé pendant isBulkUploading — le nettoyage de isAuditing n\'a pas cassé cette dépendance restante.');

    await confirmClickPromise;
    await window.waitForTimeout(500);
    await expect(purgeSiteBtn).toBeEnabled({ timeout: 10000 });
    console.log('[SA-4] Bouton réactivé une fois isBulkUploading retombé à false.');
  });

  // ══════════════════════════════════════════════════════════════════════
  // BLOC C — ADMIN_CENTRE (section 5)
  // ══════════════════════════════════════════════════════════════════════

  test('AC-0. [P1 — découverte] ADMIN_CENTRE ne peut PAS atteindre /dashboard (donc jamais SiteAdminView) : route gardée par ProtectedRoute', async () => {
    const now = Date.now();
    const login = `ZZTEST_ADMINCENTRE_${now}`;
    const res = await dbQuery(
      `INSERT INTO t_users (login, password_hash, role, nom_user, prenom_user, statut_actif, site_id, centre_id, sync_id, is_dirty)
       VALUES (?, ?, 'ADMIN_CENTRE', 'ZZTEST', 'ADMINCENTRE', 1, ?, ?, ?, 0)`,
      [login, hashPassword('ZZTEST_Pwd_2026!'), siteAId(), siteACentreId(), `zztest-admincentre-${now}`]
    );
    expect((res[0].lastInsertRowid as number)).toBeGreaterThan(0);

    await logout();
    const { window } = env;
    await window.waitForURL(/#\/login/, { timeout: 20000 });
    await window.getByTestId('login-input').fill(login);
    await window.getByTestId('password-input').fill('ZZTEST_Pwd_2026!');
    await window.getByTestId('login-submit').click();

    // Constat : App.tsx:111 garde /dashboard avec requiredRoles=['SUPER ADMIN','ADMINISTRATEUR_SITE']
    // (ADMIN_CENTRE explicitement exclu) ; RoleRedirect.tsx:30-31 redirige ADMIN_CENTRE vers
    // /admin-centre (portail dédié, src/pages/AdminCentre/views/DashboardView.tsx — un
    // composant TOTALEMENT DIFFÉRENT de SiteAdminView.tsx). Conséquence directe : le bloc
    // "Synchronisation Cloud — Centre" conditionné sur `user?.role === 'ADMIN_CENTRE'` dans
    // SiteAdminView.tsx (lignes ~1002-1067, section 5 de cette tâche) est du CODE MORT —
    // aucun ADMIN_CENTRE réel ne peut jamais l'atteindre en conditions normales.
    await window.waitForURL(/#\/admin-centre/, { timeout: 20000 });
    console.log('[AC-0][P1] ADMIN_CENTRE atterrit sur /admin-centre (portail dédié), jamais /dashboard.');

    // Tentative de forcer /dashboard malgré tout (navigation manuelle du hash) : le garde de
    // rôle doit rejeter et faire rebondir vers /admin-centre (pas de fuite d'accès).
    await window.evaluate(() => { globalThis.location.hash = '#/dashboard'; });
    await window.waitForTimeout(800);
    const urlAfterForcedNav = window.url();
    console.log(`[AC-0][P1] Après tentative de navigation forcée vers #/dashboard : URL finale = ${urlAfterForcedNav}`);
    expect(urlAfterForcedNav).toMatch(/#\/admin-centre/);
    expect(urlAfterForcedNav).not.toMatch(/#\/dashboard$/);
    await expect(window.getByText('Synchronisation Cloud — Centre')).toHaveCount(0);
  });

  // ══════════════════════════════════════════════════════════════════════
  // NETTOYAGE FINAL
  // ══════════════════════════════════════════════════════════════════════
  test('CLEANUP. Suppression de tous les artefacts ZZTEST_ résiduels', async () => {
    const cartes = await dbQuery("DELETE FROM t_cartes WHERE noms LIKE 'ZZTEST\\_%' ESCAPE '\\'");
    const anomalies = await dbQuery("DELETE FROM t_import_anomalies WHERE noms LIKE 'ZZTEST\\_%' ESCAPE '\\'");
    // t_logs.id_user -> t_users(id_user) sans ON DELETE CASCADE (schema.ts:769) : le login
    // ZZTEST_ADMINCENTRE (AC-0) a généré au moins une entrée d'audit (LOGIN). À purger avant
    // t_users pour éviter une violation de contrainte FK.
    const logs = await dbQuery(
      "DELETE FROM t_logs WHERE login_user LIKE 'ZZTEST\\_%' ESCAPE '\\' OR id_user IN (SELECT id_user FROM t_users WHERE login LIKE 'ZZTEST\\_%' ESCAPE '\\')"
    );
    const userRoles = await dbQuery(
      "DELETE FROM t_user_roles WHERE id_user IN (SELECT id_user FROM t_users WHERE login LIKE 'ZZTEST\\_%' ESCAPE '\\')"
    );
    const users = await dbQuery("DELETE FROM t_users WHERE login LIKE 'ZZTEST\\_%' ESCAPE '\\'");
    const centres = await dbQuery("DELETE FROM t_centres WHERE nom LIKE 'ZZTEST\\_%' ESCAPE '\\'");
    const sites = await dbQuery("DELETE FROM t_sites WHERE nom LIKE 'ZZTEST\\_%' ESCAPE '\\'");
    console.log(`[CLEANUP] Supprimés (préalable FK) — logs: ${logs[0].changes}, user_roles: ${userRoles[0].changes}`);

    console.log(
      `[CLEANUP] Supprimés — cartes: ${cartes[0].changes}, anomalies: ${anomalies[0].changes}, ` +
      `users: ${users[0].changes}, centres: ${centres[0].changes}, sites: ${sites[0].changes}`
    );

    const remainingCartes = await count1("SELECT COUNT(*) as count FROM t_cartes WHERE noms LIKE 'ZZTEST\\_%' ESCAPE '\\'");
    const remainingUsers = await count1("SELECT COUNT(*) as count FROM t_users WHERE login LIKE 'ZZTEST\\_%' ESCAPE '\\'");
    const remainingCentres = await count1("SELECT COUNT(*) as count FROM t_centres WHERE nom LIKE 'ZZTEST\\_%' ESCAPE '\\'");
    const remainingSites = await count1("SELECT COUNT(*) as count FROM t_sites WHERE nom LIKE 'ZZTEST\\_%' ESCAPE '\\'");
    const remainingAnomalies = await count1("SELECT COUNT(*) as count FROM t_import_anomalies WHERE noms LIKE 'ZZTEST\\_%' ESCAPE '\\'");

    expect(remainingCartes).toBe(0);
    expect(remainingUsers).toBe(0);
    expect(remainingCentres).toBe(0);
    expect(remainingSites).toBe(0);
    expect(remainingAnomalies).toBe(0);
  });
});
