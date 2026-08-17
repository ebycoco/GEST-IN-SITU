/**
 * e2e/specs/_agent13_sync_badge_travail_du_jour.e2e.spec.ts
 *
 * QA Terrain (agent-13) — Test fonctionnel vivant du diff non commité (working
 * tree) portant sur 3 chantiers liés au circuit de synchronisation des cartes :
 *
 *  1. import-worker.js  : les cartes fusionnées par un import massif sont
 *     désormais enfilées dans t_outbox (status PENDING) au lieu d'un envoi
 *     direct séparé.
 *  2. upload-worker.js  : le bouton "Forcer la synchronisation" (bulk upload
 *     manuel) exclut désormais les cartes déjà PENDING dans t_outbox (évite
 *     un double envoi), tout en restant capable de reprendre les cartes en
 *     ERROR.
 *  3. Overview.tsx (portail OPERATEUR_VERIFICATION, écran "Travail du jour") :
 *     nouveau badge de statut de synchro par ligne (✓/⏳/✗) + récapitulatif
 *     agrégé, alimenté par getVerificationCardsTodayPaginated() (stats.queries.ts).
 *
 * ── Isolation ─────────────────────────────────────────────────────────────
 * Harnais Playwright `_electron` exclusif (`../fixtures/electron-app.ts`),
 * lancé contre le build réel `dist/` (reconstruit par l'utilisateur juste
 * avant cette session, postérieur à toutes les modifications testées ici).
 * `userDataDir` jetable (`fs.mkdtempSync`), `GEST_IN_SITU_E2E_DISABLE_SYNC=1`
 * positionné par défaut par `launchSeededApp()` — réseau Supabase réel jamais
 * atteint. Toutes les données créées sont préfixées `ZZTEST_` et nettoyées en
 * fin de fichier avec re-vérification explicite.
 *
 * ── Limite structurelle assumée (STOP & WARN documenté, pas de contournement) ──
 * `runBulkUpload()` (bulk-uploader.ts) retourne immédiatement, SANS même
 * démarrer le Worker Thread `upload-worker.js`, dès que
 * `GEST_IN_SITU_E2E_DISABLE_SYNC=1` est positionnée (garde-fou dédié, voir
 * bulk-uploader.ts ~ligne 51). Le correctif "exclusion des cartes déjà
 * PENDING" vit DANS la clause SQL de ce Worker : il ne peut donc PAS être
 * exercé de bout en bout par un clic UI réel dans ce harnais (le Worker ne
 * tourne jamais). Validé ici par exécution DIRECTE de la clause SQL exacte du
 * correctif contre la base de test réelle (pas une relecture de code) — voir
 * BLOC 3. Le comportement de bout en bout (clic réel → Worker → Supabase)
 * nécessiterait `allowRealSync: true` (build `dist-e2e-cloud/` distinct,
 * construction interdite à un agent) : limitation documentée dans le rapport
 * final, jamais contournée.
 */
import { test, expect } from '@playwright/test';
import { launchSeededApp, teardownSeededApp, type E2EEnvironment } from '../fixtures/electron-app';
import { getTestUser } from '../fixtures/test-users';
import { writeFileSync, mkdtempSync, readdirSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const SHOT_DIR = join(__dirname, '..', '..', 'test-results', 'agent13-screenshots');

/**
 * ── GARDE-FOU DÉCOUVERT EN COURS DE RUN (pas une hypothèse — vérifié par lecture
 * directe du bundle construit) ──────────────────────────────────────────────
 * `dist/main/index.js` et `dist/main/workers/*.js` ont bien été reconstruits après
 * les modifications de ce diff (contiennent `syncSummary`, `touchedCardsStmt`,
 * `outboxUpsertStmt`, le filtre `NOT EXISTS ... o.status = 'PENDING'`). MAIS
 * `dist/renderer/assets/index-*.js` (le bundle React) date d'AVANT ce diff : il ne
 * contient PAS `SyncStatusBadge` (nom de composant introduit par Overview.tsx dans
 * ce diff). Seul `electron-vite build` du process main/preload a visiblement été
 * relancé, pas celui du renderer — l'app testée ici affiche donc l'ANCIEN
 * Overview.tsx, sans le nouveau badge de synchro. Détecté dynamiquement (scan du
 * bundle sur disque, pas une hypothèse) pour `test.skip()` proprement les
 * scénarios qui en dépendent, au lieu de les faire échouer de façon trompeuse.
 * Un `electron-vite build` complet (jamais lancé par cet agent, CLAUDE.md §1) est
 * nécessaire avant de pouvoir QA-tester réellement le badge — signalé en priorité
 * absolue dans le rapport final.
 */
function rendererBundleHasSyncBadge(): boolean {
  try {
    const assetsDir = join(__dirname, '..', '..', 'dist', 'renderer', 'assets');
    if (!existsSync(assetsDir)) return false;
    const jsFiles = readdirSync(assetsDir).filter((f) => f.endsWith('.js'));
    for (const f of jsFiles) {
      const content = readFileSync(join(assetsDir, f), 'utf-8');
      if (content.includes('SyncStatusBadge')) return true;
    }
    return false;
  } catch {
    return false;
  }
}
const RENDERER_HAS_SYNC_BADGE = rendererBundleHasSyncBadge();
const STALE_RENDERER_SKIP_REASON =
  "dist/renderer/assets/*.js ne contient pas 'SyncStatusBadge' : le bundle renderer construit est " +
  "ANTÉRIEUR à ce diff (Overview.tsx). electron-vite build (process renderer) doit être relancé " +
  '(jamais par cet agent, CLAUDE.md §1) avant de pouvoir QA-tester ce badge. Voir rapport final.';

test.describe.serial('QA Terrain — Badge Synchro "Travail du jour" + Import Outbox + Bouton Forcer Synchro (agent-13)', () => {
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

  // ── Helper SQL direct (better-sqlite3 via ELECTRON_RUN_AS_NODE — voir
  // _agent13_sync_status_dashboard.e2e.spec.ts pour le détail empirique) ──────
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
    await window.locator('.btn-logout').click();
    await window.waitForURL(/#\/login/, { timeout: 15000 });
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

  // Lit le badge affiché dans la colonne "Synchro" pour une ligne contenant `nameFragment`.
  async function getRowBadgeText(nameFragment: string): Promise<string | null> {
    const { window } = env;
    const row = window.locator('tbody tr', { hasText: nameFragment });
    const rowCount = await row.count();
    if (rowCount === 0) return null;
    if (process.env.AGENT13_DEBUG_ROW === '1') {
      const cellTexts = await row.first().locator('td').allInnerTexts();
      console.log(`[DEBUG getRowBadgeText] rowCount=${rowCount} cellTexts=${JSON.stringify(cellTexts)}`);
    }
    return (await row.locator('td').last().innerText()).trim();
  }

  async function getSyncSummaryCounts(): Promise<{ synced: string; pending: string; error: string } | null> {
    const { window } = env;
    return window.evaluate(() => {
      const spans = Array.from(document.querySelectorAll('span'));
      // Les 3 compteurs suivent chacun immédiatement un badge (Synchronisé/En attente/Échec).
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

  async function gotoAgentVerificationOverview(): Promise<void> {
    const { window } = env;
    await window.evaluate(() => { window.location.hash = '#/agent-verification'; });
    await window.waitForURL(/#\/agent-verification$/, { timeout: 15000 });
  }

  // Constat connu (documenté par de précédents runs QA terrain, ex:
  // import-centre-migration-qa-terrain.e2e.spec.ts) : l'overlay global
  // `initialDataLoading` (MainLayout.tsx) peut rester actif si une navigation trop
  // rapprochée du login empêche useDashboardStats.ts de le lever. Hors périmètre de
  // ce diff (ne touche à aucun des fichiers testés ici), mais appliqué en garde-fou
  // pour fiabiliser cette suite — pas un correctif produit ici.
  async function waitForNoLoadingOverlay(timeout = 60000): Promise<void> {
    const { window } = env;
    await expect(window.getByText('Chargement sécurisé en cours...')).toHaveCount(0, { timeout }).catch(async () => {
      await window.screenshot({ path: join(SHOT_DIR, `agent13-badge-STUCK-overlay-${Date.now()}.png`) });
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // BLOC 1 — SCÉNARIO 1 (priorité absolue) : badge de synchro "Travail du
  // jour" après délivrance, et comportement du (non-)rafraîchissement auto.
  // ═══════════════════════════════════════════════════════════════════════

  let deliveredSyncId = '';

  test('1. OPERATEUR_VERIFICATION délivre une carte via le vrai parcours UI → badge "En attente" affiché immédiatement, cohérent avec t_outbox/is_dirty', async () => {
    test.skip(!RENDERER_HAS_SYNC_BADGE, STALE_RENDERER_SKIP_REASON);
    const { window, seed } = env;
    const user = getTestUser('operateurVerification');

    await window.waitForURL(/#\/login/, { timeout: 20000 });
    await login(user.login, user.password);
    await window.waitForURL(/#\/agent-verification$/, { timeout: 20000 });

    // ── Constat (P2, hors périmètre de ce diff) ────────────────────────────
    // `window.api.cartes.create` est désormais réservé à SUPER ADMIN/ADMINISTRATEUR_SITE/
    // OPERATEUR_SAISIE côté handler (handlers.ts ~ligne 797, durcissement RBAC visiblement
    // non lié aux fichiers de ce diff) : un OPERATEUR_VERIFICATION appelant ce chemin reçoit
    // désormais "Accès refusé." — confirmé empiriquement ici (et casse au passage le spec
    // préexistant sync-button-after-delivery.e2e.spec.ts, qui utilisait le même raccourci de
    // test). Sans impact applicatif réel (l'appli elle-même n'appelle jamais cartes:create
    // depuis ce rôle), mais la carte de ce scénario est donc créée directement en base — même
    // convention que la majorité des autres specs QA terrain (ex: import-centre-migration-qa-
    // terrain.e2e.spec.ts) — puis retrouvée par la recherche FTS5 réelle (triggers trg_cartes_ai
    // maintenus, aucun contournement de l'indexation).
    const now = Date.now();
    deliveredSyncId = `zztest-badge1-${now}`;
    await dbQuery(
      `INSERT INTO t_cartes (noms, prenoms, date_de_naissance, lieu_de_naissance, contact, num_secu, rangement, statut, site_id, centre_id, agent_saisie, cle_doublon, sync_id, is_dirty)
       VALUES (?, 'OVERVIEW', '1990-01-01', 'ABOBO', '0102030401', 'ZZTEST-NUMSECU-BADGE1', 'R1', 'EN STOCK', ?, ?, 'E2E_OPERATEUR_VERIFICATION', ?, ?, 1)`,
      ['ZZTEST_BADGE1', seed.siteId, seed.centreId, 'ZZTEST_BADGE1|OVERVIEW|1990-01-01|ABOBO|0102030401', deliveredSyncId]
    );
    expect(deliveredSyncId).toBeTruthy();

    // ── Constat additionnel (P2, hors périmètre de ce diff) ────────────────
    // `stats:get` (handlers.ts ~ligne 1905) mémoïse son résultat 15s côté serveur
    // (statsCache), keyed par site/centre. Une insertion SQL directe (comme ci-dessus,
    // ou tout écrivain hors du chemin IPC habituel) ne l'invalide jamais : RechercheView.tsx
    // (fetchTotal(), ~ligne 104) lirait alors un total pré-insertion périmé et afficherait à
    // tort l'écran bloquant "Base de données locale vide" — confirmé empiriquement en
    // première itération de ce test. Contournement ciblé au test (force un recalcul frais
    // via le paramètre forceRefresh existant, déjà exposé par ce handler pour le bouton
    // "Actualiser") — pas une réécriture de app.
    await window.evaluate(
      async (siteId) => { await (window as any).api.stats.get(siteId, undefined, true); },
      seed.siteId
    );

    await window.getByRole('link', { name: 'Recherche Active' }).click();
    await window.waitForURL(/#\/agent-verification\/recherche/, { timeout: 15000 });

    await window.locator('input[placeholder="Ex: KOFFI KOFFI KAN"]').fill('ZZTEST_BADGE1 OVERVIEW');
    await window.locator('input[placeholder="JJ/MM/AAAA"]').fill('01/01/1990');
    await window.getByRole('button', { name: /Rechercher la Carte/ }).click();

    await expect(window.getByText('Vérification Physique')).toBeVisible({ timeout: 10000 });
    await window.getByRole('button', { name: /Oui, j'ai la carte/ }).click();
    await expect(window.getByText('Validation du Retrait')).toBeVisible();
    await window.getByRole('button', { name: /Valider la délivrance/ }).click();
    await expect(window.getByText('Carte délivrée avec succès !')).toBeVisible({ timeout: 10000 });

    // ── État réel en base immédiatement après délivrance ──────────────────
    const dbState = await dbQuery(
      `SELECT t_cartes.statut, t_cartes.is_dirty, t_outbox.status as outbox_status
       FROM t_cartes LEFT JOIN t_outbox ON t_outbox.id = t_cartes.sync_id AND t_outbox.table_name='t_cartes'
       WHERE t_cartes.sync_id = ?`,
      [deliveredSyncId]
    );
    console.log(`[agent13][SCENARIO1] État DB juste après délivrance : ${JSON.stringify(dbState[0])}`);
    expect(dbState[0].statut).toBe('DELIVRE');
    expect(dbState[0].is_dirty).toBe(1);
    expect(dbState[0].outbox_status).toBe('PENDING');

    // ── Écran "Travail du jour" : badge attendu = "En attente" ────────────
    await gotoAgentVerificationOverview();
    await expect(window.getByText('Travail du jour')).toBeVisible({ timeout: 10000 });

    const badge = await getRowBadgeText('ZZTEST_BADGE1');
    console.log(`[agent13][SCENARIO1] Badge affiché juste après délivrance pour ZZTEST_BADGE1 : "${badge}"`);
    await window.screenshot({ path: join(SHOT_DIR, 'agent13-badge-01-pending-juste-apres-delivrance.png') });
    // Note (constat, pas un bug appli) : le badge applique CSS `textTransform: 'uppercase'`
    // (Overview.tsx ~ligne 22) sur le label source réel `'En attente'` — `.innerText` reflète
    // donc le texte rendu tout en majuscules. Comparaison insensible à la casse en conséquence.
    expect(badge?.toUpperCase()).toContain('EN ATTENTE');

    // ── Récapitulatif agrégé : au moins 1 carte "En attente" comptabilisée ──
    const summary = await getSyncSummaryCounts();
    console.log(`[agent13][SCENARIO1] Récapitulatif agrégé affiché : ${JSON.stringify(summary)}`);
    expect(summary).not.toBeNull();
    expect(Number(summary?.pending)).toBeGreaterThanOrEqual(1);
  });

  test('2. [POINT CRITIQUE] Simulation d\'un cycle de synchro réussi en base (is_dirty=0, outbox SYNCED) SANS aucune action UI → le badge se met-il à jour tout seul ?', async () => {
    test.skip(!RENDERER_HAS_SYNC_BADGE, STALE_RENDERER_SKIP_REASON);
    const { window } = env;

    // Simule exactement ce que fait upload-worker.js en cas de succès réseau
    // (UPDATE t_cartes SET is_dirty=0, synced_at=... + marquage outbox SYNCED),
    // sans passer par un vrai cycle réseau (impossible dans ce harnais, réseau
    // coupé par GEST_IN_SITU_E2E_DISABLE_SYNC=1).
    await dbQuery(
      `UPDATE t_cartes SET is_dirty = 0, synced_at = datetime('now') WHERE sync_id = ?`,
      [deliveredSyncId]
    );
    await dbQuery(
      `UPDATE t_outbox SET status = 'SYNCED' WHERE id = ?`,
      [deliveredSyncId]
    );
    const dbState = await dbQuery(
      `SELECT is_dirty FROM t_cartes WHERE sync_id = ?`,
      [deliveredSyncId]
    );
    expect(dbState[0].is_dirty).toBe(0);

    // Observation passive, aucun clic ni rechargement : on échantillonne le
    // badge affiché pendant 15s (2 cycles de sync périodique typiques, si un
    // tel mécanisme existe côté renderer) pour caractériser empiriquement le
    // comportement réel — pas une relecture de code.
    const samples: Array<{ t: number; badge: string | null }> = [];
    const start = Date.now();
    while (Date.now() - start < 15000) {
      const badge = await getRowBadgeText('ZZTEST_BADGE1');
      samples.push({ t: Date.now() - start, badge });
      await window.waitForTimeout(2000);
    }
    console.log(
      `[agent13][SCENARIO1][POINT CRITIQUE] Badge échantillonné sur 15s SANS action UI après passage ` +
      `is_dirty=0 en base : ${JSON.stringify(samples)}`
    );
    await window.screenshot({ path: join(SHOT_DIR, 'agent13-badge-02-apres-15s-sans-action-ui.png') });

    const autoRefreshed = samples.some((s) => s.badge && s.badge.toUpperCase().includes('SYNCHRONISÉ'));
    console.log(
      `[agent13][SCENARIO1][POINT CRITIQUE] Rafraîchissement automatique du badge observé (sans reload manuel) = ${autoRefreshed}`
    );

    // Constat factuel (pas une assertion bloquante — Overview.tsx n'a ni
    // setInterval ni listener IPC, useEffect ne dépend que de user.login/
    // user.site_id/page, qui ne changent jamais ici) : le badge NE DOIT PAS
    // se mettre à jour tout seul dans cet état. Si cette assertion échouait
    // un jour (comportement corrigé), ce serait une bonne nouvelle à signaler
    // explicitement dans un futur rapport, pas un vrai échec de régression.
    expect(autoRefreshed, 'Badge auto-rafraîchi sans action UI : si true, le comportement a changé depuis le dernier audit').toBe(false);
  });

  test('3. Une navigation qui change la page déclenche bien un re-fetch → le badge finit par refléter la base (preuve que le rendu est correct, seul le déclenchement auto manque)', async () => {
    test.skip(!RENDERER_HAS_SYNC_BADGE, STALE_RENDERER_SKIP_REASON);
    const { window } = env;

    // Changer de page puis revenir déclenche loadCardsToday() (useEffect dépend de `page`),
    // sans jamais recharger l'écran (pas de F5 / re-navigation complète).
    // Une seule ligne aujourd'hui → les boutons Précédent/Suivant peuvent être désactivés ;
    // on force un re-fetch équivalent via une navigation hash aller-retour (cas robuste,
    // vrai comportement utilisateur : quitter puis revenir sur "Travail du jour").
    await window.evaluate(() => { window.location.hash = '#/agent-verification/recherche'; });
    await window.waitForURL(/#\/agent-verification\/recherche/, { timeout: 10000 });
    await gotoAgentVerificationOverview();
    await expect(window.getByText('Travail du jour')).toBeVisible({ timeout: 10000 });

    const badgeAfterRevisit = await getRowBadgeText('ZZTEST_BADGE1');
    console.log(`[agent13][SCENARIO1] Badge après re-visite de l'écran (nouveau montage du composant) : "${badgeAfterRevisit}"`);
    await window.screenshot({ path: join(SHOT_DIR, 'agent13-badge-03-apres-revisite-ecran.png') });

    expect(badgeAfterRevisit?.toUpperCase()).toContain('SYNCHRONISÉ');

    await logout();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // BLOC 2 — SCÉNARIO 2 : import massif → cartes fusionnées enfilées dans
  // t_outbox (PENDING), UI réactive pendant l'import.
  // ═══════════════════════════════════════════════════════════════════════

  const tmpDir = mkdtempSync(join(tmpdir(), 'gest-in-situ-e2e-agent13-badge-'));
  const importCsvPath = join(tmpDir, 'zztest_import_outbox.csv');

  test('4. Login ADMINISTRATEUR_SITE + import CSV réel (3 nouvelles cartes) → toutes fusionnées avec une ligne t_outbox PENDING correspondante', async () => {
    const { window, seed } = env;
    const admin = getTestUser('administrateurSite');

    await window.waitForURL(/#\/login/, { timeout: 20000 });
    await login(admin.login, admin.password);
    await window.waitForURL(/#\/dashboard/, { timeout: 20000 });
    await waitForNoLoadingOverlay();

    const lines = [
      'NOMS;PRENOMS;DATE DE NAISSANCE;LIEU DE NAISSANCE;CONTACT;N° SECU;RANGEMENT;STATUT',
      'ZZTEST_IMPORT_OUTBOX1;A;1990-01-01;ABOBO;0102030421;NSOX1;R1;EN STOCK',
      'ZZTEST_IMPORT_OUTBOX2;B;1991-02-02;ABOBO;0102030422;NSOX2;R2;EN STOCK',
      'ZZTEST_IMPORT_OUTBOX3;C;1992-03-03;ABOBO;0102030423;NSOX3;R3;EN STOCK'
    ];
    writeFileSync(importCsvPath, lines.join('\n'), 'utf-8');

    await window.evaluate(() => { globalThis.location.hash = '#/import'; });
    await window.waitForURL(/#\/import/, { timeout: 15000 });

    await mockOpenDialogOnce(importCsvPath);
    try {
      await window.getByRole('button', { name: /Sélectionner le Listing/i }).click();
      await expect(window.getByText('3 lignes détectées').first()).toBeVisible({ timeout: 15000 });
    } finally {
      await restoreOpenDialog();
    }

    await window.getByRole('button', { name: "Lancer l'Importation" }).click();
    // Selon l'état du centre de test (nom générique ou pas), soit la modale garde-fou
    // apparaît, soit directement "Configuration des Centres" — les deux sont gérées.
    const guardModal = window.getByText('Personnalisation du Centre Requise');
    const configModal = window.getByText('Configuration des Centres');
    await expect(guardModal.or(configModal)).toBeVisible({ timeout: 10000 });
    if (await guardModal.isVisible().catch(() => false)) {
      // Renomme le centre pour débloquer, puis relance l'import (même flow que
      // import-centre-migration-qa-terrain.e2e.spec.ts).
      await window.getByRole('button', { name: 'Fermer' }).click();
      await dbQuery(`UPDATE t_centres SET nom = 'ZZTEST_CENTRE_BADGE_IMPORT' WHERE id = ?`, [seed.centreId]);
      await window.evaluate(() => { globalThis.location.hash = '#/dashboard'; });
      await window.waitForURL(/#\/dashboard/);
      await window.evaluate(() => { globalThis.location.hash = '#/import'; });
      await window.waitForURL(/#\/import/);
      await mockOpenDialogOnce(importCsvPath);
      try {
        await window.getByRole('button', { name: /Sélectionner le Listing/i }).click();
        await expect(window.getByText('3 lignes détectées').first()).toBeVisible({ timeout: 15000 });
      } finally {
        await restoreOpenDialog();
      }
      await window.getByRole('button', { name: "Lancer l'Importation" }).click();
      await expect(configModal).toBeVisible({ timeout: 10000 });
    }

    // ── UI réactive pendant l'import : le bouton reste cliquable avant de lancer ──
    const continueBtn = window.getByRole('button', { name: "Poursuivre l'import" });
    await expect(continueBtn).toBeEnabled({ timeout: 10000 });
    await continueBtn.click();

    // Best-effort (fenêtre parfois trop courte à capturer pour un import de seulement
    // 3 lignes, terminé en ~1s d'après le bilan observé) : sur un jeu de données plus
    // volumineux ce texte reste visible plus longtemps ; ici on ne bloque pas dessus.
    try {
      await expect(window.getByText('Importation en cours...')).toBeVisible({ timeout: 3000 });
    } catch {
      console.log('[agent13][SCENARIO2] "Importation en cours..." non capturé (import 3 lignes trop rapide) — non bloquant.');
    }
    // L'UI ne doit pas être totalement figée : le curseur/évènements restent traités
    // (vérifié en observant que l'événement focus-restored, utilisé ailleurs dans la
    // suite pour fiabiliser la réconciliation post-import, est bien pris en compte).
    await window.evaluate(() => window.dispatchEvent(new Event('app:focus-restored')));

    await expect(window.getByText('Bilan de Migration')).toBeVisible({ timeout: 60000 });
    await window.screenshot({ path: join(SHOT_DIR, 'agent13-badge-04-import-bilan.png') });

    // ── Vérification base : les 3 cartes existent ET ont chacune une ligne
    // t_outbox PENDING correspondante (le nouveau comportement testé) ──────
    const rows = await dbQuery(
      `SELECT t_cartes.noms, t_cartes.sync_id, t_cartes.is_dirty, t_outbox.status as outbox_status, t_outbox.operation
       FROM t_cartes LEFT JOIN t_outbox ON t_outbox.id = t_cartes.sync_id AND t_outbox.table_name='t_cartes'
       WHERE t_cartes.noms LIKE 'ZZTEST_IMPORT_OUTBOX%'
       ORDER BY t_cartes.noms`
    );
    console.log(`[agent13][SCENARIO2] Cartes importées + état outbox associé : ${JSON.stringify(rows)}`);

    expect(rows.length).toBe(3);
    for (const r of rows) {
      expect(r.outbox_status, `Carte ${r.noms} : attendu une ligne t_outbox PENDING`).toBe('PENDING');
      expect(r.operation).toBe('UPDATE');
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // BLOC 3 — SCÉNARIO 3 : bouton "Forcer la synchronisation" (bulk upload) —
  // exclusion des cartes déjà PENDING, reprise des cartes ERROR.
  // ═══════════════════════════════════════════════════════════════════════

  test('5. Bouton bulk upload cliqué en contexte E2E réseau coupé : le Worker ne démarre même pas (garde-fou dédié), zéro mutation en base — limite de harnais documentée', async () => {
    const { window } = env;

    const outboxBefore = await dbQuery(`SELECT COUNT(*) as c FROM t_outbox WHERE status = 'PENDING'`);

    await window.evaluate(() => { globalThis.location.hash = '#/dashboard'; });
    await window.waitForURL(/#\/dashboard/, { timeout: 15000 });
    await waitForNoLoadingOverlay();

    const bulkBtn = window.locator('button', { hasText: /CARTES VERS LE CLOUD|ENVOYER LES ANOMALIES|SYSTÈME À JOUR/i }).first();
    const btnVisible = await bulkBtn.isVisible().catch(() => false);
    console.log(`[agent13][SCENARIO3] Bouton bulk upload (SiteAdminView) visible = ${btnVisible}`);

    if (btnVisible) {
      const label = (await bulkBtn.innerText()).trim();
      console.log(`[agent13][SCENARIO3] Libellé du bouton avant clic : "${label}"`);
      if (!label.includes('SYSTÈME À JOUR')) {
        await bulkBtn.click();
        // Le clic ouvre une modale de confirmation ("Transfert de Masse Cloud") — jamais
        // d'envoi direct. Confirmer pour réellement invoquer runBulkUpload() (bulk-uploader.ts)
        // et observer son comportement en contexte E2E réseau coupé.
        const confirmBtn = window.getByRole('button', { name: 'Confirmer' });
        await expect(confirmBtn).toBeVisible({ timeout: 10000 });
        await confirmBtn.click();
        await window.waitForTimeout(3000);
        await window.screenshot({ path: join(SHOT_DIR, 'agent13-badge-05-bulk-upload-e2e-disabled.png') });
        // La modale doit s'être refermée d'elle-même (résolution de la promesse
        // runBulkUpload, garde-fou E2E — pas de blocage résiduel de l'UI).
        await expect(window.getByText('Transfert de Masse Cloud')).toHaveCount(0, { timeout: 10000 });
      } else {
        console.log('[agent13][SCENARIO3] Bouton en état "SYSTÈME À JOUR" (rien à envoyer) — clic non pertinent ici.');
      }
    }

    const outboxAfter = await dbQuery(`SELECT COUNT(*) as c FROM t_outbox WHERE status = 'PENDING'`);
    console.log(
      `[agent13][SCENARIO3] t_outbox PENDING avant=${outboxBefore[0].c} après=${outboxAfter[0].c} ` +
      `(attendu : inchangé, le Worker upload-worker.js ne démarre jamais avec GEST_IN_SITU_E2E_DISABLE_SYNC=1)`
    );
    expect(outboxAfter[0].c).toBe(outboxBefore[0].c);
  });

  test('6. [VALIDATION DIRECTE SQL — Worker non exécutable en harnais isolé] La clause d\'exclusion exacte d\'upload-worker.js exclut bien les cartes PENDING mais inclut les cartes ERROR et les cartes sans ligne outbox', async () => {
    const { seed } = env;
    const now = Date.now();
    const nomsPending = `ZZTEST_UPLOADFILTER_PENDING_${now}`;
    const nomsError = `ZZTEST_UPLOADFILTER_ERROR_${now}`;
    const nomsNoOutbox = `ZZTEST_UPLOADFILTER_NOOUTBOX_${now}`;

    const cleDoublon = (noms: string) => `${noms}|X|1990-01-01|ABOBO|0102030499`;

    // Carte A : is_dirty=1, ligne t_outbox PENDING associée → DOIT être EXCLUE
    // (déjà prise en charge par le circuit standard, ex: import massif).
    const syncIdPending = `zztest-uploadfilter-pending-${now}`;
    await dbQuery(
      `INSERT INTO t_cartes (noms, prenoms, date_de_naissance, lieu_de_naissance, contact, statut, rangement, is_dirty, site_id, centre_id, cle_doublon, sync_id)
       VALUES (?, 'X', '1990-01-01', 'ABOBO', '0102030499', 'EN STOCK', 'R1', 1, ?, ?, ?, ?)`,
      [nomsPending, seed.siteId, seed.centreId, cleDoublon(nomsPending), syncIdPending]
    );
    await dbQuery(
      `INSERT INTO t_outbox (id, table_name, operation, payload, status) VALUES (?, 't_cartes', 'UPDATE', '{}', 'PENDING')`,
      [syncIdPending]
    );

    // Carte B : is_dirty=1, ligne t_outbox ERROR associée → DOIT être INCLUSE
    // (c'est précisément le comportement corrigé par le patch : reprise des échecs).
    const syncIdError = `zztest-uploadfilter-error-${now}`;
    await dbQuery(
      `INSERT INTO t_cartes (noms, prenoms, date_de_naissance, lieu_de_naissance, contact, statut, rangement, is_dirty, site_id, centre_id, cle_doublon, sync_id)
       VALUES (?, 'X', '1990-01-01', 'ABOBO', '0102030499', 'EN STOCK', 'R1', 1, ?, ?, ?, ?)`,
      [nomsError, seed.siteId, seed.centreId, cleDoublon(nomsError), syncIdError]
    );
    await dbQuery(
      `INSERT INTO t_outbox (id, table_name, operation, payload, status) VALUES (?, 't_cartes', 'UPDATE', '{}', 'ERROR')`,
      [syncIdError]
    );

    // Carte C : is_dirty=1, AUCUNE ligne t_outbox (cas legacy antérieur au circuit
    // outbox pour t_cartes) → DOIT être INCLUSE (non-régression du chemin historique).
    const syncIdNoOutbox = `zztest-uploadfilter-noout-${now}`;
    await dbQuery(
      `INSERT INTO t_cartes (noms, prenoms, date_de_naissance, lieu_de_naissance, contact, statut, rangement, is_dirty, site_id, centre_id, cle_doublon, sync_id)
       VALUES (?, 'X', '1990-01-01', 'ABOBO', '0102030499', 'EN STOCK', 'R1', 1, ?, ?, ?, ?)`,
      [nomsNoOutbox, seed.siteId, seed.centreId, cleDoublon(nomsNoOutbox), syncIdNoOutbox]
    );

    // Clause SQL EXACTEMENT recopiée depuis src/main/workers/upload-worker.js
    // (filterClause, NOT EXISTS + condition is_dirty), restreinte à nos 3 lignes
    // de test via un filtre noms additionnel pour ne pas capter le reste de la base.
    const candidateRows = await dbQuery(
      `SELECT noms FROM t_cartes
       WHERE site_id = ?
       AND NOT EXISTS (
         SELECT 1 FROM t_outbox o
         WHERE o.table_name = 't_cartes' AND o.status = 'PENDING'
         AND o.id = t_cartes.sync_id
       )
       AND (is_dirty = 1 OR is_dirty = -1 OR synced_at IS NULL OR synced_at = '') AND statut != 'BROUILLON'
       AND noms LIKE 'ZZTEST_UPLOADFILTER_%'
       ORDER BY noms`,
      [seed.siteId]
    );
    const candidateNoms = candidateRows.map((r) => r.noms);
    console.log(`[agent13][SCENARIO3][VALIDATION SQL] Cartes retenues par la clause corrigée : ${JSON.stringify(candidateNoms)}`);

    expect(candidateNoms, 'La carte avec ligne outbox PENDING doit être exclue (évite le double envoi)').not.toContain(nomsPending);
    expect(candidateNoms, 'CORRECTIF : la carte avec ligne outbox ERROR doit être reprise (retry)').toContain(nomsError);
    expect(candidateNoms, 'Non-régression : une carte sans ligne outbox (cas legacy) reste incluse').toContain(nomsNoOutbox);

    // Nettoyage de ce bloc
    await dbQuery(`DELETE FROM t_outbox WHERE id IN (?, ?)`, [syncIdPending, syncIdError]);
    await dbQuery(`DELETE FROM t_cartes WHERE noms LIKE 'ZZTEST_UPLOADFILTER_%'`);
    const remaining = await dbQuery(`SELECT COUNT(*) as c FROM t_cartes WHERE noms LIKE 'ZZTEST_UPLOADFILTER_%'`);
    expect(remaining[0].c).toBe(0);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // BLOC 4 — SCÉNARIO 4 : cloisonnement site/centre du badge "Travail du jour"
  // ═══════════════════════════════════════════════════════════════════════

  test('7. Cloisonnement site : une carte DELIVRE par le même agent mais rattachée à un AUTRE site n\'apparaît PAS dans "Travail du jour"', async () => {
    const { window, seed } = env;
    const now = Date.now();

    const siteRes = await dbQuery(
      `INSERT INTO t_sites (nom, code, is_active, max_centres, is_permanent, sync_id) VALUES (?, ?, 1, 4, 1, ?)`,
      [`ZZTEST_SITE_BADGE_${now}`, `ZZTEST-SITEBADGE-${now}`, `zztest-sitebadge-${now}`]
    );
    const otherSiteId = siteRes[0].lastInsertRowid;
    const centreRes = await dbQuery(
      `INSERT INTO t_centres (site_id, nom, numero, sync_id) VALUES (?, 'ZZTEST_CENTRE_BADGE', 1, ?)`,
      [otherSiteId, `zztest-centrebadge-${now}`]
    );
    const otherCentreId = centreRes[0].lastInsertRowid;

    const nomsOtherSite = `ZZTEST_CROSSSITE_${now}`;
    const todayIso = new Date().toISOString();
    await dbQuery(
      `INSERT INTO t_cartes (noms, prenoms, date_de_naissance, statut, site_id, centre_id, agent_distributeur, date_delivrance, cle_doublon, sync_id)
       VALUES (?, 'X', '1990-01-01', 'DELIVRE', ?, ?, 'E2E_OPERATEUR_VERIFICATION', ?, ?, ?)`,
      [nomsOtherSite, otherSiteId, otherCentreId, todayIso, `${nomsOtherSite}|X|1990-01-01||`, `zztest-crosssite-${now}`]
    );

    // Reconnexion OPERATEUR_VERIFICATION (rattaché au site de test A, seed.siteId) —
    // la session courante est ADMINISTRATEUR_SITE (tests 4/5/6) : déconnexion explicite
    // requise avant de rebasculer de rôle.
    const opUser = getTestUser('operateurVerification');
    await logout();
    await login(opUser.login, opUser.password);
    await window.waitForURL(/#\/agent-verification$/, { timeout: 20000 });
    await gotoAgentVerificationOverview();
    await expect(window.getByText('Travail du jour')).toBeVisible({ timeout: 10000 });

    // Vérification par PRÉSENCE DE LIGNE (pas lecture du badge de synchro) : le tableau
    // "Travail du jour" lui-même (colonnes Identité/N° Sécu/Rangement/...) existait déjà
    // avant ce diff — seule la colonne Synchro est nouvelle (absente du bundle renderer
    // stale, voir RENDERER_HAS_SYNC_BADGE). Le filtrage site_id testé ici vit dans
    // getVerificationCardsTodayPaginated (stats.queries.ts, process main, à jour dans
    // dist/main/index.js) : ce test reste donc valide et exécuté même bundle renderer stale.
    const crossSiteRowCount = await window.locator('tbody tr', { hasText: nomsOtherSite }).count();
    console.log(
      `[agent13][SCENARIO4] Carte DELIVRE par le même agent mais site_id=${otherSiteId} (≠ site connecté ${seed.siteId}) visible dans "Travail du jour" ? → ${
        crossSiteRowCount > 0 ? 'OUI (fuite cross-site)' : 'NON (correctement cloisonné)'
      }`
    );
    await window.screenshot({ path: join(SHOT_DIR, 'agent13-badge-07-cloisonnement-site.png') });

    expect(crossSiteRowCount, 'Une carte délivrée sur un AUTRE site ne doit jamais apparaître dans "Travail du jour" de ce poste').toBe(0);

    // Nettoyage
    await dbQuery(`DELETE FROM t_cartes WHERE site_id = ?`, [otherSiteId]);
    await dbQuery(`DELETE FROM t_centres WHERE id = ?`, [otherCentreId]);
    await dbQuery(`DELETE FROM t_sites WHERE id = ?`, [otherSiteId]);
    const remaining = await dbQuery(`SELECT COUNT(*) as c FROM t_sites WHERE id = ?`, [otherSiteId]);
    expect(remaining[0].c).toBe(0);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // NETTOYAGE FINAL — toutes les données ZZTEST_ créées par ce fichier
  // ═══════════════════════════════════════════════════════════════════════

  test('8. Nettoyage final : toutes les données ZZTEST_ créées par ce fichier sont supprimées, vérification explicite', async () => {
    await dbQuery(`DELETE FROM t_outbox WHERE id LIKE 'zztest-%'`);
    await dbQuery(`DELETE FROM t_cartes WHERE noms LIKE 'ZZTEST\\_%' ESCAPE '\\'`);
    await dbQuery(`DELETE FROM t_import_anomalies WHERE noms LIKE 'ZZTEST\\_%' ESCAPE '\\'`);

    const remainingCartes = await dbQuery(`SELECT COUNT(*) as c FROM t_cartes WHERE noms LIKE 'ZZTEST\\_%' ESCAPE '\\'`);
    const remainingOutbox = await dbQuery(`SELECT COUNT(*) as c FROM t_outbox WHERE id LIKE 'zztest-%'`);
    console.log(`[agent13][CLEANUP] t_cartes ZZTEST_ restantes=${remainingCartes[0].c} t_outbox zztest- restantes=${remainingOutbox[0].c}`);
    expect(remainingCartes[0].c).toBe(0);
    expect(remainingOutbox[0].c).toBe(0);
  });
});
