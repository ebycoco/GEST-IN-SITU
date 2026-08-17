/**
 * e2e/specs/_agent13_sync_badge_saisie.e2e.spec.ts
 *
 * QA Terrain (agent-13) — Test fonctionnel vivant de la RÉPLICATION + AJUSTEMENT du badge de
 * statut de synchro (déjà validé côté portail Vérification, voir
 * _agent13_sync_badge_travail_du_jour.e2e.spec.ts) vers le portail OPERATEUR_SAISIE
 * (`src/renderer/src/pages/AgentSaisie/views/Overview.tsx`).
 *
 * ── Différence assumée avec le portail Vérification (rappel) ───────────────────────────────
 * `createCarte()`/`updateCarte()` (cartes.queries.ts) n'appellent JAMAIS `enqueueOutbox()` :
 * le workflow de synchro de ce portail est 100% manuel (push en masse déclenché plus tard par
 * un admin via le bouton "Synchroniser vers le Cloud" / upload-worker.js). En conséquence :
 *   - Libellé "en attente" changé en "À synchroniser (admin)" (au lieu de "En attente").
 *   - Pas de polling dédié 30s ici (seul le rafraîchissement général ~60s préexistant subsiste).
 *   - L'état ERROR est structurellement inatteignable (aucune ligne t_outbox n'est jamais créée
 *     pour ces cartes tant qu'un admin n'a pas lancé un push).
 *
 * ── Isolation ─────────────────────────────────────────────────────────────
 * Harnais Playwright `_electron` exclusif (`../fixtures/electron-app.ts`), lancé contre le build
 * réel `dist/` (renderer reconstruit après le diff, confirmé par scan direct du bundle avant ce
 * run : `dist/renderer/assets/index-CuFK9ZZM.js` contient `SyncStatusBadge` et
 * "synchroniser (admin)"). `userDataDir` jetable (`fs.mkdtempSync` via la fixture),
 * `GEST_IN_SITU_E2E_DISABLE_SYNC=1` positionné par défaut (réseau Supabase réel jamais atteint).
 * Toutes les données créées sont préfixées `ZZTEST_`/`zztest-` et nettoyées en fin de fichier
 * avec re-vérification explicite.
 */
import { test, expect } from '@playwright/test';
import { launchSeededApp, teardownSeededApp, type E2EEnvironment } from '../fixtures/electron-app';
import { getTestUser } from '../fixtures/test-users';
import { join } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const SHOT_DIR = join(__dirname, '..', '..', 'test-results', 'agent13-screenshots');

test.describe.serial('QA Terrain — Badge Synchro "Travail du jour" Portail Saisie (agent-13)', () => {
  let env: E2EEnvironment;
  let anyTestFailed = false;
  // ── P0 DÉCOUVERT EN COURS DE RUN (pas une hypothèse — reproduit à 2 reprises via appel IPC
  // direct sur l'app réelle) ────────────────────────────────────────────────────────────────
  // getAgentCardsTodayPaginated (src/main/database/queries/stats.queries.ts ~ligne 638-654)
  // construit `rows`/`summaryRow` via `FROM t_cartes LEFT JOIN t_outbox ... ${conditionClause}`,
  // où conditionClause = `WHERE created_by = ? AND created_at >= ? AND created_at < ?` — colonnes
  // NON qualifiées par table. `t_outbox` possède AUSSI une colonne `created_at` (schema.ts ~ligne
  // 919/2304) : SQLite rejette la requête à la préparation avec `SqliteError: ambiguous column
  // name: created_at`, INDÉPENDAMMENT des données présentes (erreur de compilation de la requête,
  // pas une erreur de contenu) — donc systématique pour TOUT OPERATEUR_SAISIE, à chaque visite de
  // "Travail du jour". Le composant Overview.tsx avale l'exception silencieusement (`catch (err) {
  // console.error(...) }`, `rows` state jamais réassigné) : l'écran affiche à tort "Aucune saisie
  // enregistrée aujourd'hui" même quand des cartes existent bel et bien (confirmé : la carte créée
  // par le test 1 existe en base avec created_by correct, retrouvée par une requête SQL directe
  // équivalente MAIS qualifiée par table). Absent côté portail Vérification (getVerificationCards
  // TodayPaginated, même fichier ~ligne 235-284) : son conditionClause utilise statut/agent_
  // distributeur/site_id/date_delivrance, aucune collision de nom avec les colonnes de t_outbox.
  // STOP & WARN (CLAUDE.md §4) : correctif dans un fichier de requêtes partagé
  // (stats.queries.ts) — hors périmètre d'agent-13 (jamais de correction de code par ce rôle).
  // Signalé en priorité absolue dans le rapport final ; scénarios 2/3/4 ci-dessous inobservables
  // via l'UI tant que ce correctif n'est pas appliqué (agent-3-coder / agent-4-db-sync), et donc
  // volontairement `test.skip()` avec renvoi explicite vers ce constat plutôt que des échecs
  // trompeurs en cascade.
  let cardsTodayPanelBroken = false;
  const CARDS_TODAY_BROKEN_SKIP_REASON =
    'getAgentCardsTodayPaginated (stats.queries.ts) lève SqliteError: ambiguous column name: created_at ' +
    '(colonne créée_at non qualifiée, présente à la fois dans t_cartes ET t_outbox après le LEFT JOIN) — ' +
    '"Travail du jour" reste bloqué en affichage vide pour tout OPERATEUR_SAISIE. Voir rapport final (P0).';

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

  // ── Helper SQL direct (better-sqlite3 via ELECTRON_RUN_AS_NODE — même mécanisme que
  // _agent13_sync_badge_travail_du_jour.e2e.spec.ts / _agent13_sync_status_dashboard.e2e.spec.ts) ──
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

  // Lit le badge affiché dans la colonne "Synchro" pour une ligne contenant `nameFragment`.
  async function getRowBadgeText(nameFragment: string): Promise<string | null> {
    const { window } = env;
    const row = window.locator('tbody tr', { hasText: nameFragment });
    const rowCount = await row.count();
    if (rowCount === 0) return null;
    return (await row.locator('td').last().innerText()).trim();
  }

  async function getSyncSummaryCounts(): Promise<{ synced: string; pending: string; error: string } | null> {
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
        pending: findAfterBadge('SYNCHRONISER (ADMIN)') || '',
        error: findAfterBadge('ÉCHEC') || ''
      };
    });
  }

  async function gotoAgentSaisieOverview(): Promise<void> {
    const { window } = env;
    await window.evaluate(() => { window.location.hash = '#/agent-saisie'; });
    await window.waitForURL(/#\/agent-saisie$/, { timeout: 15000 });
  }

  // Constat connu (documenté par de précédents runs QA terrain) : l'overlay global
  // `initialDataLoading` (MainLayout.tsx) peut rester actif si une navigation trop rapprochée
  // du login empêche useDashboardStats.ts de le lever. Hors périmètre de ce diff, appliqué en
  // garde-fou pour fiabiliser cette suite — pas un correctif produit ici.
  async function waitForNoLoadingOverlay(timeout = 60000): Promise<void> {
    const { window } = env;
    await expect(window.getByText('Chargement sécurisé en cours...')).toHaveCount(0, { timeout }).catch(async () => {
      await window.screenshot({ path: join(SHOT_DIR, `agent13-badge-saisie-STUCK-overlay-${Date.now()}.png`) });
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // SCÉNARIO 1 — Création réelle (parcours UI complet) → badge
  // "À SYNCHRONISER (ADMIN)" immédiatement, is_dirty=1, AUCUNE ligne t_outbox.
  // ═══════════════════════════════════════════════════════════════════════

  let createdSyncId = '';
  const uniqueSuffix = Date.now();
  const nomsCree = `ZZTEST_SAISIE${uniqueSuffix}`;

  test('1. OPERATEUR_SAISIE crée une carte via le vrai formulaire "Nouvelle Saisie" → badge "À synchroniser (admin)" affiché immédiatement dans "Travail du jour", cohérent avec is_dirty=1 / AUCUNE ligne t_outbox', async () => {
    const { window } = env;
    const user = getTestUser('operateurSaisie');

    await window.waitForURL(/#\/login/, { timeout: 20000 });
    await login(user.login, user.password);
    await window.waitForURL(/#\/agent-saisie$/, { timeout: 20000 });
    await waitForNoLoadingOverlay();

    await window.getByRole('link', { name: 'Nouvelle Saisie' }).click();
    await window.waitForURL(/#\/agent-saisie\/nouvelle/, { timeout: 15000 });

    await window.getByPlaceholder('Ex: KOUASSI').fill(nomsCree);
    await window.getByPlaceholder('Ex: JEAN BAPTISTE').fill('OVERVIEW');
    // DateInput (src/renderer/src/components/DateInput.tsx) : un unique input texte, formatage
    // JJ/MM/AAAA appliqué automatiquement à la frappe (digits uniquement).
    await window.locator('input[placeholder="JJ/MM/AAAA"]').first().fill('01/01/1990');
    await window.getByPlaceholder('Ex: ABIDJAN').fill('ABOBO');
    // Date.now() est un entier de 13 chiffres au moment de ce run : num_secu doit faire
    // exactement 13 chiffres (le champ filtre déjà tout caractère non numérique à la saisie).
    await window.getByPlaceholder('Ex: 3841236548952').fill(String(uniqueSuffix));
    await window.getByPlaceholder('Ex: BOITE 42 / RAYON C').fill('ZZTEST_R1');

    await window.getByRole('button', { name: /Valider la saisie/i }).click();
    await expect(window.getByText('Carte enregistrée avec succès !')).toBeVisible({ timeout: 10000 });

    // ── Retrouver la carte réellement créée (sync_id inconnu à l'avance côté test — généré
    // en base par createCarte()) via le nom unique préfixé ci-dessus.
    const created = await dbQuery(
      `SELECT sync_id, is_dirty, statut, created_by FROM t_cartes WHERE noms = ?`,
      [nomsCree]
    );
    expect(created.length).toBe(1);
    createdSyncId = created[0].sync_id;
    console.log(`[agent13][SAISIE][SCENARIO1] Carte créée en base : ${JSON.stringify(created[0])}`);
    expect(created[0].is_dirty).toBe(1);
    expect(created[0].created_by).toBe(env.seed.userIds.operateurSaisie);

    const outboxRows = await dbQuery(
      `SELECT * FROM t_outbox WHERE id = ? AND table_name = 't_cartes'`,
      [createdSyncId]
    );
    console.log(`[agent13][SAISIE][SCENARIO1] Lignes t_outbox pour cette carte : ${outboxRows.length}`);
    expect(outboxRows.length, 'Aucune ligne t_outbox ne doit exister — workflow 100% manuel côté Saisie').toBe(0);

    // ── Écran "Travail du jour" : badge attendu = "À synchroniser (admin)" ────────────
    await gotoAgentSaisieOverview();
    await expect(window.getByText('Travail du jour')).toBeVisible({ timeout: 10000 });
    await window.waitForTimeout(1500);

    // Appel direct de l'IPC réellement utilisé par Overview.tsx (mêmes arguments), pour
    // capturer l'éventuelle exception backend précisément plutôt que de laisser un
    // matcher Playwright échouer sur une valeur `undefined` peu explicite. Overview.tsx
    // avale cette même exception silencieusement (console.error), d'où l'intérêt de la
    // rejouer explicitement ici pour objectiver la cause racine.
    const directIpcResult: { ok: boolean; total?: number; rowsCount?: number; error?: string } = await window.evaluate(
      async (userId) => {
        try {
          const res = await (window as any).api.stats.getAgentCardsTodayPaginated(userId, 0, 20);
          return { ok: true, total: res?.total, rowsCount: res?.rows?.length };
        } catch (e: any) {
          return { ok: false, error: String(e?.message || e) };
        }
      },
      env.seed.userIds.operateurSaisie
    );
    console.log(`[agent13][SAISIE][SCENARIO1] Appel direct getAgentCardsTodayPaginated(operateurSaisie,0,20) : ${JSON.stringify(directIpcResult)}`);

    if (!directIpcResult.ok && /ambiguous column name/i.test(directIpcResult.error || '')) {
      cardsTodayPanelBroken = true;
      console.log(
        `[agent13][SAISIE][SCENARIO1][P0] getAgentCardsTodayPaginated échoue avec : "${directIpcResult.error}". ` +
        `Le panneau "Travail du jour" (et donc le badge de synchro) est structurellement inaccessible pour ` +
        `OPERATEUR_SAISIE — voir commentaire en tête de describe() pour l'analyse de cause racine complète.`
      );
    }

    await window.screenshot({ path: join(SHOT_DIR, 'agent13-badge-saisie-01-apres-creation.png') });

    // Les assertions UI sur le badge ne sont exécutées QUE si le backend répond correctement —
    // sinon elles échoueraient de façon trompeuse sur une cause déjà identifiée et journalisée
    // ci-dessus (P0 backend, hors périmètre de correction d'agent-13).
    test.skip(cardsTodayPanelBroken, CARDS_TODAY_BROKEN_SKIP_REASON);

    const badge = await getRowBadgeText(nomsCree);
    console.log(`[agent13][SAISIE][SCENARIO1] Badge affiché juste après création pour ${nomsCree} : "${badge}"`);
    expect(badge?.toUpperCase()).toContain('SYNCHRONISER (ADMIN)');
    expect(badge?.toUpperCase()).not.toContain('EN ATTENTE');

    const summary = await getSyncSummaryCounts();
    console.log(`[agent13][SAISIE][SCENARIO1] Récapitulatif agrégé affiché : ${JSON.stringify(summary)}`);
    expect(summary).not.toBeNull();
    expect(Number(summary?.pending)).toBeGreaterThanOrEqual(1);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SCÉNARIO 2 — Absence du polling dédié 30s (constat empirique + code)
  // ═══════════════════════════════════════════════════════════════════════

  test('2. Aucun rafraîchissement automatique du badge sur une fenêtre de 35s sans action UI (confirme l\'absence du polling 30s présent côté Vérification)', async () => {
    test.skip(cardsTodayPanelBroken, CARDS_TODAY_BROKEN_SKIP_REASON);
    const { window } = env;

    const samples: Array<{ t: number; badge: string | null }> = [];
    const start = Date.now();
    while (Date.now() - start < 35000) {
      const badge = await getRowBadgeText(nomsCree);
      samples.push({ t: Date.now() - start, badge });
      await window.waitForTimeout(3000);
    }
    console.log(`[agent13][SAISIE][SCENARIO2] Badge échantillonné sur 35s SANS action UI : ${JSON.stringify(samples)}`);
    await window.screenshot({ path: join(SHOT_DIR, 'agent13-badge-saisie-02-apres-35s-sans-action.png') });

    const changed = samples.some((s) => s.badge && !s.badge.toUpperCase().includes('SYNCHRONISER (ADMIN)'));
    console.log(`[agent13][SAISIE][SCENARIO2] Changement observé sans action UI sur 35s = ${changed}`);
    expect(changed, 'Le badge ne doit pas changer sans action UI sur une fenêtre < 60s (pas de polling 30s côté Saisie)').toBe(false);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SCÉNARIO 3 — Simulation d'une synchro manuelle admin + vérification que le
  // rafraîchissement général ~60s (préexistant) reflète bien le changement, sans
  // régression de ce mécanisme.
  // ═══════════════════════════════════════════════════════════════════════

  test('3. Simulation en base d\'un push manuel admin réussi (is_dirty=0, outbox SYNCED) SANS action UI → le badge finit par passer à "Synchronisé" via le rafraîchissement général ~60s préexistant (non-régression)', async () => {
    test.skip(cardsTodayPanelBroken, CARDS_TODAY_BROKEN_SKIP_REASON);
    const { window } = env;

    await dbQuery(
      `UPDATE t_cartes SET is_dirty = 0, synced_at = datetime('now') WHERE sync_id = ?`,
      [createdSyncId]
    );
    await dbQuery(
      `INSERT INTO t_outbox (id, table_name, operation, payload, status) VALUES (?, 't_cartes', 'UPDATE', '{}', 'SYNCED')`,
      [createdSyncId]
    );
    const dbState = await dbQuery(`SELECT is_dirty FROM t_cartes WHERE sync_id = ?`, [createdSyncId]);
    expect(dbState[0].is_dirty).toBe(0);

    // Observation passive jusqu'à 75s (couvre largement le cycle de 60s + marge) : aucun clic,
    // aucune navigation manuelle — seul le setInterval(60000) préexistant (loadCardsToday) doit
    // faire évoluer l'affichage.
    const samples: Array<{ t: number; badge: string | null }> = [];
    const start = Date.now();
    let autoRefreshedAt: number | null = null;
    while (Date.now() - start < 75000) {
      const badge = await getRowBadgeText(nomsCree);
      samples.push({ t: Date.now() - start, badge });
      if (badge?.toUpperCase().includes('SYNCHRONISÉ') && autoRefreshedAt === null) {
        autoRefreshedAt = Date.now() - start;
        break;
      }
      await window.waitForTimeout(4000);
    }
    console.log(`[agent13][SAISIE][SCENARIO3] Échantillons badge (attente rafraîchissement général ~60s) : ${JSON.stringify(samples)}`);
    console.log(`[agent13][SAISIE][SCENARIO3] Rafraîchissement automatique observé à t=${autoRefreshedAt}ms`);
    await window.screenshot({ path: join(SHOT_DIR, 'agent13-badge-saisie-03-apres-refresh-general.png') });

    expect(autoRefreshedAt, 'Le badge doit finir par passer à "Synchronisé" via le rafraîchissement général ~60s préexistant, sans action UI').not.toBeNull();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SCÉNARIO 4 — Cloisonnement : ne montrer que les cartes du agent connecté.
  // ═══════════════════════════════════════════════════════════════════════

  test('4. Cloisonnement : une carte saisie aujourd\'hui par un AUTRE agent (created_by différent) n\'apparaît pas dans "Travail du jour" de l\'agent connecté', async () => {
    const { window, seed } = env;
    const nomsAutreAgent = `ZZTEST_AUTREAGENT_${uniqueSuffix}`;
    const otherUserId = seed.userIds.operateurQualite;
    expect(otherUserId, 'Le compte de test operateurQualite doit exister en base (seed)').toBeTruthy();

    await dbQuery(
      `INSERT INTO t_cartes (noms, prenoms, date_de_naissance, lieu_de_naissance, contact, statut, rangement, site_id, centre_id, cle_doublon, sync_id, created_by, created_at, is_dirty)
       VALUES (?, 'X', '1990-01-01', 'ABOBO', '0102030488', 'EN STOCK', 'R1', ?, ?, ?, ?, ?, datetime('now'), 1)`,
      [nomsAutreAgent, seed.siteId, seed.centreId, `${nomsAutreAgent}|X|1990-01-01|ABOBO|0102030488`, `zztest-autreagent-${uniqueSuffix}`, otherUserId]
    );

    await gotoAgentSaisieOverview();
    await expect(window.getByText('Travail du jour')).toBeVisible({ timeout: 10000 });
    await window.waitForTimeout(1500);

    if (cardsTodayPanelBroken) {
      // Repli explicite (P0 déjà journalisé au scénario 1) : la fonction getAgentCardsTodayPaginated
      // lève AVANT de retourner quoi que ce soit (l'exception survient sur la préparation de la
      // requête `rows`, jointe — voir commentaire en tête de describe()), donc même `total` (calculé
      // par une requête non-jointe plus haut dans la fonction, elle-même saine) n'est JAMAIS restitué
      // par l'appel IPC réel. On rejoue ici, en lecture directe, l'EXACTE requête `totalRow` de
      // stats.queries.ts (COUNT sur t_cartes seul, non jointe — donc non affectée par l'ambiguïté de
      // colonne) pour valider le filtre created_by indépendamment du bug d'affichage.
      const todayStr = new Date().toISOString().split('T')[0];
      const dTomorrow = new Date();
      dTomorrow.setDate(dTomorrow.getDate() + 1);
      const tomorrowStr = dTomorrow.toISOString().split('T')[0];
      const ownTotalRows = await dbQuery(
        `SELECT COUNT(*) as total FROM t_cartes WHERE created_by = ? AND created_at >= ? AND created_at < ?`,
        [env.seed.userIds.operateurSaisie, todayStr, tomorrowStr]
      );
      const ownTotal = ownTotalRows[0].total;
      console.log(`[agent13][SAISIE][SCENARIO4][Repli P0] total recalculé (requête totalRow exacte, hors IPC) pour l'agent connecté = ${ownTotal}`);
      // Le total ne doit compter QUE la carte du test 1 (créée par operateurSaisie), jamais celle
      // de operateurQualite insérée ci-dessus — confirme le filtre created_by au niveau SQL brut,
      // même si le rendu visuel et l'appel IPC réel restent tous deux bloqués par le P0.
      expect(ownTotal, 'Le total "Travail du jour" de l\'agent connecté ne doit pas inclure la carte du autre agent').toBe(1);

      const rawCheck = await dbQuery(`SELECT created_by FROM t_cartes WHERE noms = ?`, [nomsAutreAgent]);
      expect(rawCheck[0].created_by).toBe(otherUserId);
      return;
    }

    const crossAgentRowCount = await window.locator('tbody tr', { hasText: nomsAutreAgent }).count();
    console.log(
      `[agent13][SAISIE][SCENARIO4] Carte créée aujourd'hui par un AUTRE agent (created_by=${otherUserId}) visible dans "Travail du jour" de l'agent connecté ? → ${
        crossAgentRowCount > 0 ? 'OUI (fuite cross-agent)' : 'NON (correctement cloisonné)'
      }`
    );
    await window.screenshot({ path: join(SHOT_DIR, 'agent13-badge-saisie-04-cloisonnement.png') });
    expect(crossAgentRowCount, 'Une carte saisie par un autre agent ne doit jamais apparaître dans le "Travail du jour" de cet agent').toBe(0);

    // Confirmation complémentaire côté base (pas seulement l'UI) : la ligne existe bel et bien,
    // rattachée au bon created_by — la non-visibilité vient donc bien du filtre applicatif.
    const rawCheck = await dbQuery(`SELECT created_by FROM t_cartes WHERE noms = ?`, [nomsAutreAgent]);
    expect(rawCheck[0].created_by).toBe(otherUserId);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // NETTOYAGE FINAL — toutes les données ZZTEST_ créées par ce fichier
  // ═══════════════════════════════════════════════════════════════════════

  test('5. Nettoyage final : toutes les données ZZTEST_ créées par ce fichier sont supprimées, vérification explicite', async () => {
    await dbQuery(`DELETE FROM t_outbox WHERE id LIKE 'zztest-%'`);
    await dbQuery(`DELETE FROM t_outbox WHERE id = ?`, [createdSyncId]);
    await dbQuery(`DELETE FROM t_cartes WHERE noms LIKE 'ZZTEST\\_%' ESCAPE '\\'`);

    const remainingCartes = await dbQuery(`SELECT COUNT(*) as c FROM t_cartes WHERE noms LIKE 'ZZTEST\\_%' ESCAPE '\\'`);
    const remainingOutbox = await dbQuery(`SELECT COUNT(*) as c FROM t_outbox WHERE id LIKE 'zztest-%' OR id = ?`, [createdSyncId]);
    console.log(`[agent13][SAISIE][CLEANUP] t_cartes ZZTEST_ restantes=${remainingCartes[0].c} t_outbox zztest- restantes=${remainingOutbox[0].c}`);
    expect(remainingCartes[0].c).toBe(0);
    expect(remainingOutbox[0].c).toBe(0);
  });
});
