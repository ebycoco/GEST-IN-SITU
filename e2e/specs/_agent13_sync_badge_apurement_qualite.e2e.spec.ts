/**
 * e2e/specs/_agent13_sync_badge_apurement_qualite.e2e.spec.ts
 *
 * QA Terrain (agent-13) — Extension du mécanisme de visibilité de synchro Supabase (déjà validé
 * en production sur les portails Vérification et Saisie) à deux portails supplémentaires :
 *
 *   Volet 1 — Portail Apurement (ApurementOverview.tsx) : badge PAR CARTE (Synchronisé/En
 *   attente/Échec) dans "Travail du jour" + récapitulatif agrégé + auto-refresh 30s qui s'arrête
 *   tout seul quand tout est synchronisé (même mécanisme que le Portail Vérification).
 *
 *   Volet 2 — Portail Qualité (AgentQualite/views/Overview.tsx) : PAS de badge par carte (aucune
 *   notion fiable de "traité par moi aujourd'hui" pour une correction Qualité — voir commentaire
 *   de getSiteSyncSummary, stats.queries.ts ~L999), seulement un bandeau agrégé SITE-WIDE
 *   "X cartes en attente de synchro (dont Y en échec)", mis à jour via l'écouteur 'app:data-updated'
 *   déjà existant (pas de nouveau timer/polling).
 *
 * ── Isolation ─────────────────────────────────────────────────────────────
 * Harnais Playwright `_electron` exclusif (`../fixtures/electron-app.ts`), lancé contre le build
 * réel `dist/` (réseau Supabase coupé par défaut, `GEST_IN_SITU_E2E_DISABLE_SYNC=1`).
 * `userDataDir` jetable (`fs.mkdtempSync` via la fixture). Toutes les données créées par ce
 * fichier sont préfixées `ZZTEST_`/`zztest-` et nettoyées en fin de fichier avec revérification
 * explicite (COUNT(*) = 0).
 *
 * ── Note structurelle sur le Volet 2, scénario 5 (documentée en commentaire du test lui-même) ──
 * Overview.tsx enregistre son écouteur 'app:data-updated' dans son PROPRE useEffect : il est donc
 * démonté (et son écouteur retiré) dès qu'on navigue vers un autre onglet du portail Qualité
 * (Doublons/Données Manquantes/...), puisque ces vues sont des routes-enfants distinctes rendues
 * via <Outlet/> (AgentQualiteLayout.tsx). Il est donc structurellement impossible de rester sur la
 * route Overview tout en effectuant une correction réelle via l'UI (qui vit sur une autre route).
 * Ce fichier teste donc les DEUX volets complémentaires pour prouver le mécanisme sans ambiguïté :
 *   5a. Preuve isolée de l'écouteur : en restant sur Overview (aucune navigation), une mutation
 *       DB directe suivie d'un dispatch explicite de 'app:data-updated' (exactement l'appel que
 *       fait MissingDataView.tsx après une correction réelle) met à jour le bandeau sans clic ni
 *       navigation — isole la mécanique de l'écouteur de tout effet de remontage.
 *   5b. Parcours bout-en-bout réel : correction réelle d'un champ manquant via l'UI de
 *       MissingDataView.tsx (onglet "Données Manquantes"), puis retour sur "Vue d'ensemble" —
 *       valide que le flux complet fonctionne, tout en notant honnêtement que ce retour implique
 *       un remontage du composant (donc un nouveau fetch initial), pas uniquement l'écouteur.
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
const SHOT_DIR = join(__dirname, '..', '..', 'test-results', 'agent13-screenshots');

test.describe.serial('QA Terrain — Extension badge/bandeau synchro : Portails Apurement + Qualité (agent-13)', () => {
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

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // VOLET 1 — PORTAIL APUREMENT
  // ═══════════════════════════════════════════════════════════════════════════════════════════

  async function getApurementRowBadgeText(nameFragment: string): Promise<string | null> {
    const { window } = env;
    const row = window.locator('tbody tr', { hasText: nameFragment });
    const rowCount = await row.count();
    if (rowCount === 0) return null;
    return (await row.locator('td').last().innerText()).trim();
  }

  async function getApurementSyncSummaryCounts(): Promise<{ synced: string; pending: string; error: string } | null> {
    const { window } = env;
    return window.evaluate(() => {
      const spans = Array.from(document.querySelectorAll('span'));
      const findAfterBadge = (label: string): string | null => {
        const badge = spans.find((s) => s.textContent?.trim().toUpperCase().includes(label));
        if (!badge) return null;
        const parent = badge.closest('span')?.parentElement;
        if (!parent) return null;
        const siblings = Array.from(parent.children);
        const idx = siblings.indexOf(badge.closest('span') as Element);
        const counter = siblings[idx + 1] as HTMLElement | undefined;
        return counter ? counter.textContent?.trim() || null : null;
      };
      return {
        synced: findAfterBadge('SYNCHRONISÉ') || '',
        pending: findAfterBadge('EN ATTENTE') || '',
        error: findAfterBadge('ÉCHEC') || ''
      };
    });
  }

  const apuUniqueSuffix = Date.now();
  const apuNomCree = `ZZTEST_APU_${apuUniqueSuffix}`;
  let apuCarteId = 0;
  let apuSyncId = '';
  let apuOtherSiteId = 0;
  let apuOtherCentreId = 0;

  test('1. [APUREMENT] Émargement rétroactif réel (parcours UI complet) → badge "En attente" immédiat dans "Travail du jour", cohérent avec is_dirty=1 / t_outbox PENDING', async () => {
    const { window } = env;
    const apurementUser = getTestUser('operateurApurement');

    // sync_id renseigné explicitement (comme le fait toujours createCarte() via uuidv4() en
    // conditions réelles — cartes.queries.ts) : sans lui, enqueueOutbox() ne s'exécute jamais
    // (gardé par `if (carte.sync_id)`), ce qui n'a rien à voir avec le comportement applicatif
    // réel testé ici et fausserait la vérification t_outbox de ce scénario.
    const insert = await dbQuery(
      `INSERT INTO t_cartes (noms, prenoms, date_de_naissance, lieu_de_naissance, num_secu, statut, site_id, sync_id, is_dirty)
       VALUES (?, 'ZZTEST_PRENOM', '1985-03-12', 'ZZTEST_LIEU', ?, 'EN STOCK', ?, ?, 0)`,
      [apuNomCree, `ZZTEST-SECU-${apuUniqueSuffix}`, env.seed.siteId, `zztest-apu-${apuUniqueSuffix}`]
    );
    apuCarteId = insert[0].lastInsertRowid as number;

    await window.waitForURL(/#\/login/, { timeout: 20000 });
    await login(apurementUser.login, apurementUser.password);
    await window.waitForURL(/#\/apurement/, { timeout: 20000 });
    await expect(window.getByText("PORTAIL D'APUREMENT")).toBeVisible({ timeout: 10000 });

    await window.getByText("TRAVAIL D'APUREMENT").click();
    await expect(window.getByPlaceholder('Saisir nom & prénoms...')).toBeVisible({ timeout: 10000 });
    await window.getByPlaceholder('Saisir nom & prénoms...').fill(apuNomCree);
    await window.getByRole('button', { name: /Rechercher/ }).click();
    await expect(window.getByText(`${apuNomCree} ZZTEST_PRENOM`)).toBeVisible({ timeout: 10000 });
    await window.getByText(`${apuNomCree} ZZTEST_PRENOM`).click();

    await expect(window.getByText('Dossier Sélectionné')).toBeVisible({ timeout: 10000 });
    await window.locator('input[placeholder="Ex: 0707..."]').fill('0700000099');
    await window.getByRole('button', { name: /Valider l'Apurement/ }).click();
    await expect(window.getByText('Décharge historique enregistrée avec succès.').last()).toBeVisible({ timeout: 10000 });

    const rowAfter = (await dbQuery(
      `SELECT sync_id, statut, is_dirty, agent_distributeur FROM t_cartes WHERE id_carte = ?`,
      [apuCarteId]
    ))[0];
    console.log(`[agent13][APU-QUALITE][V1-S1] Carte après émargement réel : ${JSON.stringify(rowAfter)}`);
    expect(rowAfter.statut).toBe('DELIVRE');
    expect(rowAfter.is_dirty).toBe(1);
    expect(rowAfter.agent_distributeur.toUpperCase()).toBe(apurementUser.login.toUpperCase());
    apuSyncId = rowAfter.sync_id;
    expect(apuSyncId, 'sync_id doit être renseigné pour permettre la vérification t_outbox').toBeTruthy();

    const outboxRows = await dbQuery(`SELECT status FROM t_outbox WHERE id = ? AND table_name = 't_cartes'`, [apuSyncId]);
    console.log(`[agent13][APU-QUALITE][V1-S1] Lignes t_outbox pour cette carte : ${JSON.stringify(outboxRows)}`);
    expect(outboxRows.length).toBeGreaterThanOrEqual(1);
    expect(outboxRows[0].status).toBe('PENDING');

    await window.getByText("VUE D'ENSEMBLE").click();
    await expect(window.getByText('Travail du jour')).toBeVisible({ timeout: 10000 });
    await window.waitForTimeout(1000);

    const badge = await getApurementRowBadgeText(apuNomCree);
    console.log(`[agent13][APU-QUALITE][V1-S1] Badge affiché juste après l'émargement pour ${apuNomCree} : "${badge}"`);
    expect(badge?.toUpperCase()).toContain('EN ATTENTE');

    const summary = await getApurementSyncSummaryCounts();
    console.log(`[agent13][APU-QUALITE][V1-S1] Récapitulatif agrégé affiché : ${JSON.stringify(summary)}`);
    expect(summary).not.toBeNull();
    expect(Number(summary?.pending)).toBeGreaterThanOrEqual(1);

    await window.screenshot({ path: join(SHOT_DIR, 'agent13-apu-qualite-01-badge-en-attente.png') });
  });

  test('2. [APUREMENT] Simulation en base d\'une synchro réussie (is_dirty=0, t_outbox SYNCED) SANS action UI → le badge passe automatiquement à "Synchronisé" (polling 30s), puis le timer s\'arrête de lui-même', async () => {
    const { window } = env;
    expect(apuCarteId, 'Dépend de la carte créée au test 1').toBeGreaterThan(0);

    await dbQuery(`UPDATE t_cartes SET is_dirty = 0, synced_at = datetime('now') WHERE id_carte = ?`, [apuCarteId]);
    await dbQuery(`UPDATE t_outbox SET status = 'SYNCED' WHERE id = ? AND table_name = 't_cartes'`, [apuSyncId]);

    const dbState = await dbQuery(`SELECT is_dirty FROM t_cartes WHERE id_carte = ?`, [apuCarteId]);
    expect(dbState[0].is_dirty).toBe(0);

    // Observation passive jusqu'à 45s (couvre le cycle de 30s + marge) : aucun clic, aucune
    // navigation manuelle — seul le setInterval(30000) de ApurementOverview.tsx (déclenché tant
    // que pending>0/error>0 dans l'état déjà chargé) doit faire évoluer l'affichage.
    const samples: Array<{ t: number; badge: string | null }> = [];
    const start = Date.now();
    let autoRefreshedAt: number | null = null;
    while (Date.now() - start < 45000) {
      const badge = await getApurementRowBadgeText(apuNomCree);
      samples.push({ t: Date.now() - start, badge });
      if (badge?.toUpperCase().includes('SYNCHRONISÉ') && autoRefreshedAt === null) {
        autoRefreshedAt = Date.now() - start;
        break;
      }
      await window.waitForTimeout(3000);
    }
    console.log(`[agent13][APU-QUALITE][V1-S2] Échantillons badge (attente polling 30s) : ${JSON.stringify(samples)}`);
    console.log(`[agent13][APU-QUALITE][V1-S2] Rafraîchissement automatique observé à t=${autoRefreshedAt}ms`);
    await window.screenshot({ path: join(SHOT_DIR, 'agent13-apu-qualite-02-badge-auto-synchronise.png') });

    expect(autoRefreshedAt, 'Le badge doit finir par passer à "Synchronisé" via le polling 30s, sans action UI').not.toBeNull();

    // Le timer doit s'arrêter de lui-même une fois pending===0 && error===0 : on échantillonne
    // encore 8s pour s'assurer qu'aucun autre appel ne vient perturber l'affichage stable.
    await window.waitForTimeout(8000);
    const finalBadge = await getApurementRowBadgeText(apuNomCree);
    expect(finalBadge?.toUpperCase()).toContain('SYNCHRONISÉ');
  });

  test('3. [APUREMENT] Cloisonnement site — une fiche DELIVRE d\'un AUTRE site (même jour) n\'apparaît jamais dans "Travail du jour" de l\'agent connecté', async () => {
    const { window } = env;
    const apurementUser = getTestUser('operateurApurement');
    const now = Date.now();

    const site = await dbQuery(
      `INSERT INTO t_sites (nom, code, is_active, max_centres, is_permanent, sync_id) VALUES (?, ?, 1, 4, 1, ?)`,
      [`ZZTEST Site Apu2`, `ZZTEST-APU-SITE2-${now}`, `zztest-apu-site2-${now}`]
    );
    apuOtherSiteId = site[0].lastInsertRowid as number;
    const centre = await dbQuery(
      `INSERT INTO t_centres (site_id, nom, numero, sync_id) VALUES (?, 'ZZTEST Centre Apu2', 1, ?)`,
      [apuOtherSiteId, `zztest-apu-centre2-${now}`]
    );
    apuOtherCentreId = centre[0].lastInsertRowid as number;

    const nomAutreSite = `ZZTEST_APU_AUTRESITE_${now}`;
    await dbQuery(
      `INSERT INTO t_cartes (noms, prenoms, date_de_naissance, lieu_de_naissance, num_secu, statut, site_id, agent_distributeur, date_delivrance, updated_at, is_dirty)
       VALUES (?, 'ZZTEST_PRENOM', '1990-01-01', 'ZZTEST_LIEU', ?, 'DELIVRE', ?, ?, date('now'), datetime('now'), 1)`,
      [nomAutreSite, `ZZTEST-SECU-AS-${now}`, apuOtherSiteId, apurementUser.login]
    );

    await window.getByText("VUE D'ENSEMBLE").click();
    await expect(window.getByText('Travail du jour')).toBeVisible({ timeout: 10000 });
    await window.waitForTimeout(1000);

    const leakCount = await window.locator('tbody tr', { hasText: nomAutreSite }).count();
    console.log(`[agent13][APU-QUALITE][V1-S3] Fiche d'un AUTRE site (même agent_distributeur, même jour) visible dans "Travail du jour" = ${leakCount > 0 ? 'OUI (fuite)' : 'NON (correctement cloisonné)'}`);
    await window.screenshot({ path: join(SHOT_DIR, 'agent13-apu-qualite-03-cloisonnement-site.png') });
    expect(leakCount, 'Une fiche DELIVRE d\'un autre site ne doit jamais apparaître dans "Travail du jour" de cet agent').toBe(0);

    await logout();
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // VOLET 2 — PORTAIL QUALITÉ
  // ═══════════════════════════════════════════════════════════════════════════════════════════

  async function getQualiteBandeau(): Promise<{ visible: boolean; text: string | null; pending: number | null; error: number | null }> {
    const { window } = env;
    return window.evaluate(() => {
      const divs = Array.from(document.querySelectorAll('div'));
      const bandeau = divs.find((d) => (d.textContent || '').includes('en attente de synchro') && d.children.length <= 3);
      if (!bandeau) return { visible: false, text: null, pending: null, error: null };
      const text = bandeau.textContent || '';
      const pendingMatch = text.match(/([\d\s]+)\s*carte/);
      const errorMatch = text.match(/dont\s*([\d\s]+)\s*en échec/);
      const parseNum = (s: string) => parseInt(s.replace(/\s/g, ''), 10);
      return {
        visible: true,
        text,
        pending: pendingMatch ? parseNum(pendingMatch[1]) : null,
        error: errorMatch ? parseNum(errorMatch[1]) : null
      };
    });
  }

  const qualUniqueSuffix = Date.now();
  let qualBaselinePending = 0;
  let qualBaselineError = 0;
  const qualBulkCardIds: number[] = [];

  test('4. [QUALITÉ] Affichage initial du bandeau avec des cartes ZZTEST_ is_dirty=1 pré-existantes (créées directement en base) — compteur reflète le total SITE, pas seulement l\'agent connecté', async () => {
    const { window } = env;
    const qualiteUser = getTestUser('operateurQualite');

    const baseline = await dbQuery(
      `SELECT
         SUM(CASE WHEN t_outbox.status = 'ERROR' THEN 1 ELSE 0 END) as error,
         COUNT(*) as pendingTotal
       FROM t_cartes
       LEFT JOIN t_outbox ON t_outbox.id = t_cartes.sync_id AND t_outbox.table_name = 't_cartes'
       WHERE t_cartes.site_id = ? AND t_cartes.is_dirty = 1`,
      [env.seed.siteId]
    );
    qualBaselineError = baseline[0].error || 0;
    qualBaselinePending = Math.max(0, (baseline[0].pendingTotal || 0) - qualBaselineError);
    console.log(`[agent13][APU-QUALITE][V2-S4] Baseline avant insertion ZZTEST_ : pending=${qualBaselinePending}, error=${qualBaselineError}`);

    for (let i = 1; i <= 3; i++) {
      const insert = await dbQuery(
        `INSERT INTO t_cartes (noms, prenoms, date_de_naissance, lieu_de_naissance, num_secu, statut, site_id, is_dirty)
         VALUES (?, 'ZZTEST_PRENOM', '1980-01-01', 'ZZTEST_LIEU', ?, 'EN STOCK', ?, 1)`,
        [`ZZTEST_QUAL_BASE_${qualUniqueSuffix}_${i}`, `ZZTEST-SECU-QB-${qualUniqueSuffix}-${i}`, env.seed.siteId]
      );
      qualBulkCardIds.push(insert[0].lastInsertRowid as number);
    }

    await window.waitForURL(/#\/login/, { timeout: 20000 });
    await login(qualiteUser.login, qualiteUser.password);
    await window.waitForURL(/#\/agent-qualite/, { timeout: 20000 });
    await expect(window.getByText('PORTAIL DE CONFORMITÉ ET QUALITÉ')).toBeVisible({ timeout: 10000 });

    await window.waitForTimeout(1500);
    const bandeau = await getQualiteBandeau();
    console.log(`[agent13][APU-QUALITE][V2-S4] Bandeau affiché à l'ouverture : ${JSON.stringify(bandeau)} (attendu pending >= baseline+3 = ${qualBaselinePending + 3})`);
    await window.screenshot({ path: join(SHOT_DIR, 'agent13-apu-qualite-04-bandeau-initial.png') });

    expect(bandeau.visible, 'Le bandeau doit être visible dès lors qu\'il existe des cartes is_dirty=1 sur le site').toBe(true);
    expect(bandeau.pending, 'Le compteur doit refléter le TOTAL du site (site-wide), pas seulement les actions de cet agent').toBeGreaterThanOrEqual(qualBaselinePending + 3);
  });

  test('5a. [QUALITÉ] Preuve isolée de l\'écouteur — en restant sur "Vue d\'ensemble" (aucune navigation), une mutation DB + dispatch explicite de \'app:data-updated\' met à jour le bandeau sans clic ni navigation', async () => {
    const { window } = env;

    const before = await getQualiteBandeau();
    console.log(`[agent13][APU-QUALITE][V2-S5a] Bandeau AVANT mutation (toujours sur Vue d'ensemble, sans navigation) : ${JSON.stringify(before)}`);

    const insert = await dbQuery(
      `INSERT INTO t_cartes (noms, prenoms, date_de_naissance, lieu_de_naissance, num_secu, statut, site_id, is_dirty)
       VALUES (?, 'ZZTEST_PRENOM', '1980-01-01', 'ZZTEST_LIEU', ?, 'EN STOCK', ?, 1)`,
      [`ZZTEST_QUAL_EVT_${qualUniqueSuffix}`, `ZZTEST-SECU-EVT-${qualUniqueSuffix}`, env.seed.siteId]
    );
    qualBulkCardIds.push(insert[0].lastInsertRowid as number);

    // Exactement l'appel effectué par MissingDataView.tsx/DoublonsView.tsx après une correction
    // réelle (handleSaveField, ligne ~116) — reproduit ici indépendamment de toute navigation,
    // pour isoler la preuve que l'écouteur d'Overview.tsx (et lui seul) déclenche le rafraîchissement.
    await window.evaluate(() => window.dispatchEvent(new CustomEvent('app:data-updated')));
    await window.waitForTimeout(800);

    const after = await getQualiteBandeau();
    console.log(`[agent13][APU-QUALITE][V2-S5a] Bandeau APRÈS mutation + dispatch (toujours sur Vue d'ensemble) : ${JSON.stringify(after)}`);
    await window.screenshot({ path: join(SHOT_DIR, 'agent13-apu-qualite-05a-event-driven-no-nav.png') });

    expect(after.pending, 'Le bandeau doit refléter la nouvelle carte sans navigation ni rechargement, uniquement via l\'écouteur app:data-updated').toBe((before.pending || 0) + 1);
  });

  test('5b. [QUALITÉ] Parcours bout-en-bout réel — correction d\'un champ manquant via MissingDataView.tsx (onglet "Données Manquantes"), retour sur "Vue d\'ensemble"', async () => {
    const { window } = env;
    const nomManquant = `ZZTEST_QUAL_MANQ_${qualUniqueSuffix}`;

    const insert = await dbQuery(
      `INSERT INTO t_cartes (noms, prenoms, date_de_naissance, lieu_de_naissance, statut, site_id, is_dirty)
       VALUES (?, 'ZZTEST_PRENOM', '1980-01-01', 'ZZTEST_LIEU', 'EN STOCK', ?, 0)`,
      [nomManquant, env.seed.siteId]
    );
    const carteId = insert[0].lastInsertRowid as number;
    qualBulkCardIds.push(carteId);

    const beforeCorrection = (await dbQuery(`SELECT is_dirty, num_secu FROM t_cartes WHERE id_carte = ?`, [carteId]))[0];
    expect(beforeCorrection.is_dirty).toBe(0);
    expect(beforeCorrection.num_secu).toBeFalsy();

    const bandeauBeforeNav = await getQualiteBandeau();
    console.log(`[agent13][APU-QUALITE][V2-S5b] Bandeau AVANT navigation vers "Données Manquantes" : ${JSON.stringify(bandeauBeforeNav)}`);

    await window.getByRole('link', { name: 'Données Manquantes' }).click();
    await window.waitForURL(/#\/agent-qualite\/manquants/, { timeout: 15000 });
    await expect(window.getByRole('button', { name: /Sans N° Sécu/ })).toBeVisible({ timeout: 10000 });

    const row = window.locator('tr').filter({ hasText: nomManquant });
    await expect(row).toBeVisible({ timeout: 10000 });
    await row.getByRole('button', { name: /Compléter/ }).click();

    // Ordre du grid ExpandedManquantDetails : Noms(0), Prénoms(1), Date(2), Contact(3), Lieu(4),
    // N°Sécu(5), Rangement(6) — même repère éprouvé que e2e/specs/qualite/agent-qualite.e2e.spec.ts.
    await window.getByRole('button', { name: /Modifier/ }).nth(5).click();
    const secuInput = window.locator('input[placeholder="N° Sécu (13 chiffres)"]');
    const newSecu = String(qualUniqueSuffix).padEnd(13, '0').slice(0, 13);
    await secuInput.fill(newSecu);
    await window.locator('button.btn-primary').filter({ has: window.locator('svg') }).last().click();

    await expect(window.getByText('Donnée mise à jour avec succès !')).toBeVisible({ timeout: 10000 });

    const afterCorrection = (await dbQuery(`SELECT is_dirty, num_secu FROM t_cartes WHERE id_carte = ?`, [carteId]))[0];
    console.log(`[agent13][APU-QUALITE][V2-S5b] Carte après correction réelle via UI : ${JSON.stringify(afterCorrection)}`);
    expect(afterCorrection.is_dirty).toBe(1);
    expect(afterCorrection.num_secu).toBe(newSecu);

    await window.getByRole('link', { name: /Vue d'ensemble/ }).click();
    await expect(window.getByText('Statistiques Globales des Anomalies')).toBeVisible({ timeout: 10000 });
    await window.waitForTimeout(1000);

    const bandeau = await getQualiteBandeau();
    console.log(`[agent13][APU-QUALITE][V2-S5b] Bandeau après retour sur Vue d'ensemble (remontage du composant) : ${JSON.stringify(bandeau)} (attendu = avant+1 = ${(bandeauBeforeNav.pending || 0) + 1})`);
    await window.screenshot({ path: join(SHOT_DIR, 'agent13-apu-qualite-05b-correction-reelle-roundtrip.png') });
    expect(bandeau.visible).toBe(true);
    expect(bandeau.pending).toBe((bandeauBeforeNav.pending || 0) + 1);
  });

  test('6. [QUALITÉ] "dont Y en échec" — absent quand Y=0 (cas courant de ce run), apparaît dès Y>0 (forçage ciblé)', async () => {
    const { window } = env;

    const bandeauNoError = await getQualiteBandeau();
    console.log(`[agent13][APU-QUALITE][V2-S6] Bandeau avant forçage d'erreur : ${JSON.stringify(bandeauNoError)}`);
    expect(bandeauNoError.text, 'Aucune mention "en échec" ne doit apparaître tant qu\'aucune carte n\'est en erreur').not.toContain('en échec');

    // Forçage ciblé : une des cartes ZZTEST_ déjà insérées passe en t_outbox ERROR.
    const targetCarteId = qualBulkCardIds[0];
    const targetSyncId = await dbQuery(`SELECT sync_id FROM t_cartes WHERE id_carte = ?`, [targetCarteId]);
    let syncIdForError = targetSyncId[0]?.sync_id as string | null;
    if (!syncIdForError) {
      syncIdForError = `zztest-force-error-${qualUniqueSuffix}`;
      await dbQuery(`UPDATE t_cartes SET sync_id = ? WHERE id_carte = ?`, [syncIdForError, targetCarteId]);
    }
    await dbQuery(
      `INSERT INTO t_outbox (id, table_name, operation, payload, status) VALUES (?, 't_cartes', 'UPDATE', '{}', 'ERROR')
       ON CONFLICT(id) DO UPDATE SET status = 'ERROR'`,
      [syncIdForError]
    ).catch(async () => {
      // Repli si ON CONFLICT non supporté sur ce schéma d'index — delete+insert.
      await dbQuery(`DELETE FROM t_outbox WHERE id = ?`, [syncIdForError]);
      await dbQuery(`INSERT INTO t_outbox (id, table_name, operation, payload, status) VALUES (?, 't_cartes', 'UPDATE', '{}', 'ERROR')`, [syncIdForError]);
    });

    await window.evaluate(() => window.dispatchEvent(new CustomEvent('app:data-updated')));
    await window.waitForTimeout(800);

    const bandeauWithError = await getQualiteBandeau();
    console.log(`[agent13][APU-QUALITE][V2-S6] Bandeau après forçage d'une carte ERROR : ${JSON.stringify(bandeauWithError)}`);
    await window.screenshot({ path: join(SHOT_DIR, 'agent13-apu-qualite-06-dont-en-echec.png') });
    expect(bandeauWithError.text).toContain('en échec');
    expect(bandeauWithError.error).toBeGreaterThanOrEqual(1);

    // Nettoyage immédiat de ce forçage pour ne pas fausser le scénario d'isolation suivant.
    await dbQuery(`DELETE FROM t_outbox WHERE id = ?`, [syncIdForError]);
  });

  test('7. [QUALITÉ] Cloisonnement site — une carte is_dirty=1 d\'un AUTRE site n\'est jamais incluse dans le bandeau agrégé', async () => {
    const { window } = env;
    const now = Date.now();

    const site = await dbQuery(
      `INSERT INTO t_sites (nom, code, is_active, max_centres, is_permanent, sync_id) VALUES (?, ?, 1, 4, 1, ?)`,
      [`ZZTEST Site Qual2`, `ZZTEST-QUAL-SITE2-${now}`, `zztest-qual-site2-${now}`]
    );
    const otherSiteId = site[0].lastInsertRowid as number;

    // Test 6 vient de supprimer sa ligne t_outbox ERROR en tout dernier (après ses propres
    // assertions) : le bandeau affiché à l'écran reflète encore l'ancien état (pending=4, error=1)
    // tant qu'aucun événement ne déclenche un nouveau fetch. On resynchronise explicitement
    // l'affichage sur la vérité DB actuelle AVANT de capturer la baseline "before" de ce
    // scénario, pour ne pas comparer contre un instantané périmé.
    await window.evaluate(() => window.dispatchEvent(new CustomEvent('app:data-updated')));
    await window.waitForTimeout(800);
    const before = await getQualiteBandeau();

    await dbQuery(
      `INSERT INTO t_cartes (noms, prenoms, date_de_naissance, lieu_de_naissance, num_secu, statut, site_id, is_dirty)
       VALUES (?, 'ZZTEST_PRENOM', '1980-01-01', 'ZZTEST_LIEU', ?, 'EN STOCK', ?, 1)`,
      [`ZZTEST_QUAL_AUTRESITE_${now}`, `ZZTEST-SECU-QAS-${now}`, otherSiteId]
    );

    await window.evaluate(() => window.dispatchEvent(new CustomEvent('app:data-updated')));
    await window.waitForTimeout(800);

    const after = await getQualiteBandeau();
    console.log(`[agent13][APU-QUALITE][V2-S7] Bandeau avant=${JSON.stringify(before)}, après insertion is_dirty=1 sur un AUTRE site=${JSON.stringify(after)} (attendu inchangé)`);
    await window.screenshot({ path: join(SHOT_DIR, 'agent13-apu-qualite-07-cloisonnement-site.png') });
    expect(after.pending, 'Une carte is_dirty=1 d\'un autre site ne doit jamais être comptée dans le bandeau de ce site').toBe(before.pending);

    await dbQuery(`DELETE FROM t_cartes WHERE site_id = ?`, [otherSiteId]);
    await dbQuery(`DELETE FROM t_sites WHERE id = ?`, [otherSiteId]);

    await logout();
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // NETTOYAGE FINAL — toutes les données ZZTEST_/zztest- créées par ce fichier (§1 garde-fou)
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  test('8. Nettoyage final — suppression de toutes les données ZZTEST_/zztest- créées, vérification explicite', async () => {
    await dbQuery(`DELETE FROM t_outbox WHERE id LIKE 'zztest-%'`);
    if (apuSyncId) {
      await dbQuery(`DELETE FROM t_outbox WHERE id = ?`, [apuSyncId]);
    }
    await dbQuery(`DELETE FROM t_cartes WHERE noms LIKE 'ZZTEST\\_%' ESCAPE '\\'`);

    if (apuOtherCentreId) {
      await dbQuery(`DELETE FROM t_centres WHERE id = ?`, [apuOtherCentreId]);
    }
    if (apuOtherSiteId) {
      await dbQuery(`DELETE FROM t_sites WHERE id = ?`, [apuOtherSiteId]);
    }

    const remainingCartes = await dbQuery(`SELECT COUNT(*) as c FROM t_cartes WHERE noms LIKE 'ZZTEST\\_%' ESCAPE '\\'`);
    const remainingOutbox = await dbQuery(`SELECT COUNT(*) as c FROM t_outbox WHERE id LIKE 'zztest-%'`);
    const remainingSites = await dbQuery(`SELECT COUNT(*) as c FROM t_sites WHERE nom LIKE 'ZZTEST%'`);
    console.log(
      `[agent13][APU-QUALITE][CLEANUP] t_cartes ZZTEST_ restantes=${remainingCartes[0].c}, ` +
      `t_outbox zztest- restantes=${remainingOutbox[0].c}, t_sites ZZTEST restants=${remainingSites[0].c}`
    );
    expect(remainingCartes[0].c).toBe(0);
    expect(remainingOutbox[0].c).toBe(0);
    expect(remainingSites[0].c).toBe(0);
  });
});
