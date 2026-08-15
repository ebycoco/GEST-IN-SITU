/**
 * e2e/specs/_agent13_sync_status_dashboard.e2e.spec.ts
 *
 * QA Terrain (agent-13) — Test fonctionnel vivant de la page "Monitoring
 * Synchronisation" (`src/renderer/src/pages/SyncStatusDashboard.tsx`,
 * route `/sync/status`).
 *
 * Une seule instance Electron isolée (userDataDir jetable, seed v62,
 * `GEST_IN_SITU_E2E_DISABLE_SYNC=1` — voir `../fixtures/electron-app.ts`)
 * est partagée pour tout le fichier : chaque bloc se connecte/déconnecte
 * successivement sous un rôle différent pour limiter le nombre de démarrages
 * complets d'Electron (coûteux, ~50-75s).
 *
 * ── Limite connue et assumée (STOP & WARN documenté, pas de contournement) ──
 * `GEST_IN_SITU_E2E_DISABLE_SYNC=1` court-circuite `checkConnection()` dans
 * `network-monitor.ts` (return immédiat en tête de fonction, avant même
 * l'incrément de `bootPingCount`) : l'état réseau reste bloqué à `OFFLINE`
 * pour toute la durée du test, et ne peut JAMAIS atteindre `PERMANENT_OFFLINE`
 * dans ce harnais isolé. Le scénario "bouton RÉESSAYER" (n'apparaît que sur
 * PERMANENT_OFFLINE) n'est donc pas exécutable ici sans autoriser un vrai
 * accès réseau (`allowRealSync: true`, qui exige un build `dist-e2e-cloud/`
 * distinct — construction interdite à un agent, voir commentaire dédié dans
 * `electron-app.ts`). Documenté comme limitation dans le rapport final,
 * jamais contourné.
 *
 * Toutes les lignes insérées directement en base pour ces scénarios sont
 * préfixées `ZZTEST_` (t_logs.action) ou `zztest-` (t_outbox.id) / rattachées
 * à `table_name = 'ZZTEST_PROBE'` (t_sync_queue), et supprimées en fin de
 * fichier avec re-vérification explicite. Le `userDataDir` jetable est
 * nettoyé par `teardownSeededApp` — aucune base de production n'est touchée.
 */
import { test, expect, type Page } from '@playwright/test';
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

test.describe.serial('QA Terrain — Monitoring Synchronisation (/sync/status) (agent-13)', () => {
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

  // ── Helpers génériques ───────────────────────────────────────────────────
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

  async function gotoSyncStatus(): Promise<void> {
    const { window } = env;
    await window.evaluate(() => {
      window.location.hash = '#/sync/status';
    });
    await window.waitForTimeout(800);
  }

  async function getCardValueTextOnce(window: Page, label: string): Promise<string | null> {
    return window.evaluate((lbl) => {
      const spans = Array.from(document.querySelectorAll('span'));
      const labelSpan = spans.find((s) => s.textContent?.trim() === lbl);
      if (!labelSpan || !labelSpan.parentElement) return null;
      const valueSpan = labelSpan.parentElement.children[1] as HTMLElement | undefined;
      return valueSpan ? valueSpan.textContent : null;
    }, label);
  }

  // Léger polling (au lieu d'une lecture unique) : absorbe le délai de re-render
  // React consécutif à une navigation de récupération (voir ensureNoGlobalLoadingOverlay)
  // sans masquer un vrai null persistant (report du null tel quel après le délai).
  async function getCardValueText(window: Page, label: string, timeoutMs = 8000): Promise<string | null> {
    const start = Date.now();
    let last: string | null = null;
    while (Date.now() - start < timeoutMs) {
      last = await getCardValueTextOnce(window, label);
      if (last !== null) return last;
      await window.waitForTimeout(300);
    }
    return last;
  }

  function parseLeadingInt(text: string | null): number | null {
    if (!text) return null;
    const m = text.trim().match(/^-?\d+/);
    return m ? parseInt(m[0], 10) : null;
  }

  async function getAnomalyRows(
    window: Page
  ): Promise<Array<{ action: string; dateHeure: string; details: string; badge: string }>> {
    return window.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('.table-soleil tbody tr'));
      return rows.map((r) => {
        const cells = r.querySelectorAll('td');
        return {
          action: cells[0]?.textContent?.trim() || '',
          dateHeure: cells[1]?.textContent?.trim() || '',
          details: cells[2]?.textContent?.trim() || '',
          badge: cells[3]?.textContent?.trim() || ''
        };
      });
    });
  }

  async function getLastSyncText(window: Page): Promise<string | null> {
    return window.evaluate(() => {
      const spans = Array.from(document.querySelectorAll('span'));
      const label = spans.find((s) => s.textContent?.trim() === 'Dernière Synchro :');
      if (!label) return null;
      const sibling = label.nextElementSibling as HTMLElement | null;
      return sibling ? sibling.textContent : null;
    });
  }

  async function clickRefresh(): Promise<void> {
    const { window } = env;
    await ensureNoGlobalLoadingOverlay(window);
    await window.locator('.btn-refresh-soleil').click();
    // .last() : react-hot-toast peut empiler plusieurs toasts identiques si un
    // précédent n'a pas fini son animation de sortie (observé empiriquement —
    // voir rapport final, constat P2 sur l'absence de dédoublonnage par id).
    await expect(window.getByText('Indicateurs mis à jour en temps réel.').last()).toBeVisible({ timeout: 10000 });
  }

  /**
   * Diagnostic + garde-fou pour le bug découvert empiriquement (voir test 3bis
   * ci-dessous, rapport final — constat P0) : l'overlay global de chargement
   * (`initialDataLoading`, MainLayout.tsx ~ligne 76, `.dashboard-premium.animate-fade-in`)
   * verrouille TOUTES les pages (pointerEvents: 'none' sur le contenu réel) tant
   * qu'il n'a pas été explicitement levé — et `SyncStatusDashboard.tsx` ne l'appelle
   * JAMAIS lui-même (contrairement à ImportPage/VerificationSearchPage/InventaireLayout/
   * SitesPage/AdminCentre DashboardView/RetraitsPage, qui le font tous). Si l'utilisateur
   * (notamment SUPER ADMIN, dont le Dashboard "Gouvernance" est la seule page connue à
   * lever ce flag) atteint /sync/status avant que cette levée n'ait eu lieu, la page
   * reste verrouillée durablement. Ce helper attend patiemment (sans jamais forcer un
   * clic à travers l'overlay, ce qui masquerait le bug), puis, seulement si un test
   * suivant en dépend, applique une récupération explicite et journalisée.
   */
  async function ensureNoGlobalLoadingOverlay(win: Page, maxWaitMs = 20000): Promise<void> {
    const overlay = win.locator('.dashboard-premium.animate-fade-in');
    if ((await overlay.count()) === 0) return;
    const start = Date.now();
    try {
      await overlay.waitFor({ state: 'detached', timeout: maxWaitMs });
      console.log(`[agent13][GLOBAL-OVERLAY] Overlay de chargement présent mais levé après ${Date.now() - start}ms.`);
    } catch {
      console.log(
        `[agent13][GLOBAL-OVERLAY] BLOQUÉ : overlay 'initialDataLoading' toujours présent après ${maxWaitMs}ms — ` +
        `récupération explicite via retour /dashboard puis re-navigation.`
      );
      await win.screenshot({ path: join(SHOT_DIR, `agent13-sync-STUCK-overlay-${Date.now()}.png`) });
      await win.evaluate(() => { window.location.hash = '#/dashboard'; });
      // Attend un contenu réel du dashboard (KPI) — preuve que le chargement a fini.
      await win.locator('.kpi-value-lg, .dashboard-premium').first().waitFor({ timeout: 30000 }).catch(() => undefined);
      await win.locator('.dashboard-premium.animate-fade-in').waitFor({ state: 'detached', timeout: 30000 }).catch(() => undefined);
      await gotoSyncStatus();
      await win.waitForTimeout(1000);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // BLOC 1 — RBAC : SUPER ADMIN et ADMINISTRATEUR_SITE autorisés,
  // OPERATEUR_VERIFICATION bloqué/redirigé.
  // ═══════════════════════════════════════════════════════════════════════
  test('1. RBAC — OPERATEUR_VERIFICATION est bloqué sur /sync/status', async () => {
    const { window } = env;
    const user = getTestUser('operateurVerification');

    await window.waitForURL(/#\/login/, { timeout: 20000 });
    await login(user.login, user.password);
    await window.waitForURL(/#\/agent-verification/, { timeout: 20000 });

    await gotoSyncStatus();

    // ProtectedRoute doit rediriger vers "/" → RoleRedirect → /agent-verification.
    await window.waitForURL(/#\/agent-verification/, { timeout: 10000 });
    await expect(window.getByText('Monitoring Synchronisation')).toHaveCount(0);

    await window.screenshot({ path: join(SHOT_DIR, 'agent13-sync-01-operateur-verification-blocked.png') });
    await logout();
  });

  test('2. RBAC — ADMINISTRATEUR_SITE accède à /sync/status', async () => {
    const { window } = env;
    const user = getTestUser('administrateurSite');

    await window.waitForURL(/#\/login/, { timeout: 20000 });
    await login(user.login, user.password);
    await window.waitForURL(/#\/dashboard/, { timeout: 20000 });

    await gotoSyncStatus();
    await window.waitForURL(/#\/sync\/status/, { timeout: 10000 });
    await expect(window.getByText('Monitoring Synchronisation')).toBeVisible({ timeout: 10000 });

    await window.screenshot({ path: join(SHOT_DIR, 'agent13-sync-02-administrateur-site-ok.png') });
    await logout();
  });

  test('3. RBAC — SUPER ADMIN accède à /sync/status (reste connecté pour la suite)', async () => {
    const { window } = env;
    const user = getTestUser('superAdmin');

    await window.waitForURL(/#\/login/, { timeout: 20000 });
    await login(user.login, user.password);
    await window.waitForURL(/#\/dashboard/, { timeout: 20000 });

    await gotoSyncStatus();
    await window.waitForURL(/#\/sync\/status/, { timeout: 10000 });
    await expect(window.getByText('Monitoring Synchronisation')).toBeVisible({ timeout: 10000 });

    // Constat P0 (voir ensureNoGlobalLoadingOverlay et rapport final) : pour un
    // SUPER ADMIN fraîchement connecté (Dashboard "Gouvernance", activeSiteId encore
    // null), naviguer immédiatement vers /sync/status peut laisser l'overlay global
    // `initialDataLoading` (MainLayout.tsx) actif indéfiniment — SyncStatusDashboard.tsx
    // ne l'appelle jamais lui-même contrairement à d'autres pages (ImportPage, etc.).
    const overlayPresent = (await window.locator('.dashboard-premium.animate-fade-in').count()) > 0;
    console.log(`[agent13][GLOBAL-OVERLAY] Juste après navigation SUPER ADMIN vers /sync/status : overlay présent = ${overlayPresent}`);

    await window.screenshot({ path: join(SHOT_DIR, 'agent13-sync-03-super-admin-ok.png') });
    // Reste connecté en SUPER ADMIN pour tous les blocs suivants.
  });

  // ═══════════════════════════════════════════════════════════════════════
  // BLOC 2 — Widget Outbox (t_outbox) : le chiffre affiché doit refléter un
  // vrai COUNT(*) ... WHERE status='PENDING' en base, pas une valeur figée.
  // ═══════════════════════════════════════════════════════════════════════
  test('4. Widget Outbox — cohérence avec COUNT(*) réel sur t_outbox', async () => {
    const { window } = env;

    await clickRefresh();
    const before = parseLeadingInt(await getCardValueText(window, 'Outbox Locale (File Montante)'));
    expect(before).not.toBeNull();

    const now = Date.now();
    // 3 lignes PENDING (doivent être comptées) + 1 ligne SYNCED (ne doit PAS être comptée).
    for (let i = 1; i <= 3; i++) {
      await dbQuery(
        `INSERT INTO t_outbox (id, table_name, operation, payload, status) VALUES (?, 'ZZTEST_PROBE', 'UPDATE', '{}', 'PENDING')`,
        [`zztest-outbox-${now}-${i}`]
      );
    }
    await dbQuery(
      `INSERT INTO t_outbox (id, table_name, operation, payload, status) VALUES (?, 'ZZTEST_PROBE', 'UPDATE', '{}', 'SYNCED')`,
      [`zztest-outbox-${now}-synced`]
    );

    const realCount = (
      await dbQuery(`SELECT COUNT(*) as c FROM t_outbox WHERE status = 'PENDING'`)
    )[0].c;

    await clickRefresh();
    const after = parseLeadingInt(await getCardValueText(window, 'Outbox Locale (File Montante)'));

    await window.screenshot({ path: join(SHOT_DIR, 'agent13-sync-04-outbox-widget.png') });

    expect(after).toBe(realCount);
    expect(after).toBe((before as number) + 3);

    // Nettoyage
    const del = await dbQuery(`DELETE FROM t_outbox WHERE id LIKE ?`, [`zztest-outbox-${now}-%`]);
    expect(del[0].changes).toBe(4);
    const remaining = await dbQuery(`SELECT COUNT(*) as c FROM t_outbox WHERE id LIKE 'zztest-outbox-%'`);
    expect(remaining[0].c).toBe(0);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // BLOC 3 — Widget File d'attente (t_sync_queue) : idem, COUNT(*) WHERE
  // synced = 0.
  // ═══════════════════════════════════════════════════════════════════════
  test('5. Widget File d\'attente — cohérence avec COUNT(*) réel sur t_sync_queue', async () => {
    const { window } = env;

    await clickRefresh();
    const before = parseLeadingInt(await getCardValueText(window, "File d'attente (Downstream)"));
    expect(before).not.toBeNull();

    for (let i = 1; i <= 3; i++) {
      await dbQuery(
        `INSERT INTO t_sync_queue (table_name, record_id, operation, payload, synced) VALUES ('ZZTEST_PROBE', ?, 'UPDATE', '{}', 0)`,
        [900000 + i]
      );
    }
    await dbQuery(
      `INSERT INTO t_sync_queue (table_name, record_id, operation, payload, synced) VALUES ('ZZTEST_PROBE', 999999, 'UPDATE', '{}', 1)`
    );

    const realCount = (
      await dbQuery(`SELECT COUNT(*) as c FROM t_sync_queue WHERE synced = 0`)
    )[0].c;

    await clickRefresh();
    const after = parseLeadingInt(await getCardValueText(window, "File d'attente (Downstream)"));

    await window.screenshot({ path: join(SHOT_DIR, 'agent13-sync-05-queue-widget.png') });

    expect(after).toBe(realCount);
    expect(after).toBe((before as number) + 3);

    const del = await dbQuery(`DELETE FROM t_sync_queue WHERE table_name = 'ZZTEST_PROBE'`);
    expect(del[0].changes).toBe(4);
    const remaining = await dbQuery(`SELECT COUNT(*) as c FROM t_sync_queue WHERE table_name = 'ZZTEST_PROBE'`);
    expect(remaining[0].c).toBe(0);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // BLOC 4 — Tableau des anomalies (t_logs) : état vide, entrée ERROR
  // affichée fidèlement, comportement des entrées "WARN pur", isolation
  // multi-site.
  // ═══════════════════════════════════════════════════════════════════════
  test('6. Tableau anomalies — état vide affiché quand aucun log ERROR/ECHEC/FAILURE', async () => {
    const { window } = env;
    await clickRefresh();

    const preExisting = await dbQuery(
      `SELECT COUNT(*) as c FROM t_logs WHERE action LIKE '%ERROR%' OR action LIKE '%ECHEC%' OR action LIKE '%FAILURE%'`
    );
    // On ne fait l'assertion d'état vide que si la base ne contient vraiment aucun
    // log correspondant (sinon ce test documenterait un faux négatif).
    if (preExisting[0].c === 0) {
      await expect(window.getByText('Aucune anomalie détectée dans les journaux système.')).toBeVisible({
        timeout: 10000
      });
    }
  });

  test('7. Tableau anomalies — une entrée ERROR insérée en base apparaît fidèlement (badge rouge)', async () => {
    const { window } = env;
    const now = Date.now();
    const marker = `ZZTEST_ERROR_PROBE_${now}`;
    const detail = `ZZTEST detail ${now}`;

    await dbQuery(
      `INSERT INTO t_logs (action, detail, site_id, date_heure) VALUES (?, ?, ?, datetime('now'))`,
      [marker, detail, env.seed.siteId]
    );

    await clickRefresh();
    const rows = await getAnomalyRows(window);
    const match = rows.find((r) => r.action === marker);

    await window.screenshot({ path: join(SHOT_DIR, 'agent13-sync-07-anomalies-error.png') });

    expect(match).toBeDefined();
    expect(match?.details).toBe(detail);
    expect(match?.badge).toBe('ERROR');

    await dbQuery(`DELETE FROM t_logs WHERE action = ?`, [marker]);
  });

  test('8. [CORRECTIF P1.1] Tableau anomalies — une entrée "WARN pur" (sans ERROR/ECHEC/FAILURE) apparaît désormais avec badge orange WARN', async () => {
    const { window } = env;
    const now = Date.now();
    // Contient WARN et LIMIT (ce que le front classifie comme badge orange "WARN"),
    // mais AUCUN des mots-clés historiquement filtrés côté SQL par sync:getStatus
    // (ERROR/ECHEC/FAILURE).
    const marker = `ZZTEST_WARNING_RATE_LIMIT_PROBE_${now}`;
    const detail = `ZZTEST warn detail ${now}`;

    await dbQuery(
      `INSERT INTO t_logs (action, detail, site_id, date_heure) VALUES (?, ?, ?, datetime('now'))`,
      [marker, detail, env.seed.siteId]
    );

    // Confirmation indépendante : la ligne existe bien en base.
    const existsInDb = await dbQuery(`SELECT COUNT(*) as c FROM t_logs WHERE action = ?`, [marker]);
    expect(existsInDb[0].c).toBe(1);

    await clickRefresh();
    const rows = await getAnomalyRows(window);
    const match = rows.find((r) => r.action === marker);

    await window.screenshot({ path: join(SHOT_DIR, 'agent13-sync-08-anomalies-warn-fixed.png') });

    // Constat historique (avant correctif) : la requête SQL de sync:getStatus
    // (handlers.ts ~ligne 4023) ne sélectionnait QUE les actions contenant
    // ERROR/ECHEC/FAILURE — jamais WARN/WARNING/LIMIT seuls, rendant le badge
    // orange "WARN" du renderer (SyncStatusDashboard.tsx ~ligne 574) inatteignable.
    // CORRECTIF P1.1 : la clause SQL inclut désormais `OR action LIKE '%WARN%'
    // OR action LIKE '%LIMIT%'` — cette entrée doit maintenant remonter, avec le
    // badge orange "WARN" (pas rouge "ERROR").
    expect(match).toBeDefined();
    expect(match?.details).toBe(detail);
    expect(match?.badge).toBe('WARN');

    await dbQuery(`DELETE FROM t_logs WHERE action = ?`, [marker]);
    const remaining = await dbQuery(`SELECT COUNT(*) as c FROM t_logs WHERE action = ?`, [marker]);
    expect(remaining[0].c).toBe(0);
  });

  test('9. Tableau anomalies — isolation multi-site : une erreur d\'un AUTRE site apparaît-elle ?', async () => {
    const { window } = env;
    const now = Date.now();
    const OTHER_SITE_ID = 999999;
    const marker = `ZZTEST_ERROR_OTHERSITE_PROBE_${now}`;

    await dbQuery(
      `INSERT INTO t_logs (action, detail, site_id, date_heure) VALUES (?, 'ZZTEST cross-site probe', ?, datetime('now'))`,
      [marker, OTHER_SITE_ID]
    );

    await clickRefresh();
    const rows = await getAnomalyRows(window);
    const match = rows.find((r) => r.action === marker);

    await window.screenshot({ path: join(SHOT_DIR, 'agent13-sync-09-anomalies-cross-site.png') });

    // Constat factuel (pas d'assertion bloquante ici — voir rapport final pour la
    // sévérité) : sync:getStatus (handlers.ts) interroge t_logs SANS aucun filtre
    // site_id. Ce test caractérise le comportement réel observé.
    console.log(
      `[agent13][SITE-ISOLATION] Une erreur log d'un site_id=${OTHER_SITE_ID} (≠ site connecté ${env.seed.siteId}) ` +
      `est-elle visible dans le tableau anomalies de l'ADMINISTRATEUR_SITE/SUPER ADMIN connecté ? → ${
        match ? 'OUI (fuite cross-site constatée)' : 'NON'
      }`
    );

    await dbQuery(`DELETE FROM t_logs WHERE action = ?`, [marker]);
    const remaining = await dbQuery(`SELECT COUNT(*) as c FROM t_logs WHERE action LIKE 'ZZTEST_%'`);
    expect(remaining[0].c).toBe(0);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // BLOC 5 — Bouton RAFRAÎCHIR (déjà exercé implicitement par clickRefresh()
  // ci-dessus) — vérification explicite du non-gel de l'UI.
  // ═══════════════════════════════════════════════════════════════════════
  test('10. Bouton RAFRAÎCHIR — toast + widgets rafraîchis sans geler l\'UI', async () => {
    const { window } = env;
    const btn = window.locator('.btn-refresh-soleil');
    await expect(btn).toBeEnabled();
    await btn.click();
    await expect(window.getByText('Indicateurs mis à jour en temps réel.').last()).toBeVisible({ timeout: 10000 });
    // L'UI doit rester interactive immédiatement après (pas de bouclier plein écran).
    await expect(btn).toBeEnabled({ timeout: 5000 });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // BLOC 6 — Bouton SYNCHRONISER MAINTENANT : mot de passe obligatoire.
  // ═══════════════════════════════════════════════════════════════════════
  test('11. SYNCHRONISER MAINTENANT — mauvais mot de passe : action bloquée', async () => {
    const { window } = env;

    await window.locator('.btn-sync-soleil').first().click();
    await expect(window.getByText('Synchronisation Globale Forcée')).toBeVisible({ timeout: 10000 });

    await window.locator('input[type="password"]').fill('MotDePasseIncorrect_2026!');
    await window.getByRole('button', { name: 'Confirmer' }).click();

    await expect(window.getByText('❌ Mot de passe administrateur incorrect.')).toBeVisible({ timeout: 10000 });
    // La modale doit rester ouverte (aucune synchro n'a dû démarrer).
    await expect(window.getByText('Synchronisation Globale Forcée')).toBeVisible();
    await expect(window.getByText('Synchronisation bidirectionnelle en cours...')).toHaveCount(0);

    await window.screenshot({ path: join(SHOT_DIR, 'agent13-sync-11-wrong-password-blocked.png') });

    await window.getByRole('button', { name: 'Annuler' }).click();
    await expect(window.getByText('Synchronisation Globale Forcée')).toHaveCount(0, { timeout: 5000 });
  });

  test('12. [CORRECTIF P1.2] SYNCHRONISER MAINTENANT — bon mot de passe hors-ligne : toast affiche le vrai message (pas le générique)', async () => {
    const { window } = env;
    const user = getTestUser('superAdmin');

    const outboxBefore = (await dbQuery(`SELECT COUNT(*) as c FROM t_outbox WHERE status='PENDING'`))[0].c;
    const lastSyncBefore = await dbQuery(`SELECT value FROM t_config WHERE key = 'last_downstream_sync'`);

    await window.locator('.btn-sync-soleil').first().click();
    await expect(window.getByText('Synchronisation Globale Forcée')).toBeVisible({ timeout: 10000 });
    await window.locator('input[type="password"]').fill(user.password);

    const confirmBtn = window.getByRole('button', { name: 'Confirmer' });
    await confirmBtn.click();

    // Best-effort : capturer l'overlay plein écran (isSyncing) avant qu'il ne
    // disparaisse — le cycle peut être très rapide en environnement offline forcé.
    try {
      await window.waitForSelector('text=Synchronisation globale en cours...', { timeout: 3000 });
      await window.screenshot({ path: join(SHOT_DIR, 'agent13-sync-12-overlay-isSyncing.png') });
    } catch {
      console.log('[agent13] Overlay isSyncing non capturé (cycle offline trop rapide) — non bloquant.');
    }

    // L'état réseau reste OFFLINE dans ce harnais (E2E_DISABLE_SYNC) : forceSync()
    // (sync-engine.ts:216) retourne { success: false, message: "Impossible de
    // synchroniser. L'application est actuellement hors-ligne (OFFLINE)." }.
    // CORRECTIF P1.2 : handleForceSync (SyncStatusDashboard.tsx ~ligne 131) affiche
    // désormais `res.message` réel au lieu du texte générique figé "Synchronisation
    // terminée avec des avertissements.". Le toast générique NE DOIT PLUS apparaître.
    const successToast = window.getByText('✅ Synchronisation effectuée avec succès !');
    const realOfflineToast = window.getByText(/hors-ligne \(OFFLINE\)/);
    const staleGenericToast = window.getByText('⚠️ Synchronisation terminée avec des avertissements.');
    await expect(successToast.or(realOfflineToast)).toBeVisible({ timeout: 20000 });

    const sawGeneric = await staleGenericToast.isVisible().catch(() => false);
    const sawRealOffline = await realOfflineToast.isVisible().catch(() => false);
    const sawSuccess = await successToast.isVisible().catch(() => false);
    console.log(
      `[agent13][CORRECTIF-P1.2][FORCE-SYNC-OFFLINE] toast succès=${sawSuccess} ` +
      `toast message réel hors-ligne=${sawRealOffline} toast générique périmé=${sawGeneric} (attendu: false)`
    );

    await window.screenshot({ path: join(SHOT_DIR, 'agent13-sync-12-after-force-sync.png') });

    // Le harnais reste OFFLINE (jamais ONLINE) : le message réel hors-ligne doit
    // être celui affiché, et JAMAIS le texte générique périmé.
    expect(sawRealOffline).toBe(true);
    expect(sawGeneric).toBe(false);

    // État base : aucun cycle réel n'a dû avoir lieu (réseau coupé) → outbox et
    // last_downstream_sync inchangés.
    const outboxAfter = (await dbQuery(`SELECT COUNT(*) as c FROM t_outbox WHERE status='PENDING'`))[0].c;
    const lastSyncAfter = await dbQuery(`SELECT value FROM t_config WHERE key = 'last_downstream_sync'`);
    expect(outboxAfter).toBe(outboxBefore);
    expect(JSON.stringify(lastSyncAfter)).toBe(JSON.stringify(lastSyncBefore));

    // Bouclier anti-clics bien retiré après résolution.
    await expect(window.locator('.btn-sync-soleil').first()).toBeEnabled({ timeout: 10000 });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // BLOC 7 — Paramètres Moteur : format "Dernière Synchro" + dominance de
  // l'état réseau sur le badge de santé.
  // ═══════════════════════════════════════════════════════════════════════
  test('13. Paramètres Moteur — "Dernière Synchro" formatée fr-FR + badge santé domine par l\'état réseau', async () => {
    const { window } = env;

    const original = await dbQuery(`SELECT value FROM t_config WHERE key = 'last_downstream_sync'`);

    // "Jamais" attendu tant qu'aucune ligne n'existe (cas probable en base fraîche
    // e2e, réseau jamais réellement synchronisé).
    if (original.length === 0) {
      await clickRefresh();
      const text = await getLastSyncText(window);
      expect(text?.trim()).toBe('Jamais');
    }

    const recentIso = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    await dbQuery(
      `INSERT INTO t_config (key, value) VALUES ('last_downstream_sync', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [recentIso]
    );

    await clickRefresh();
    const text = await getLastSyncText(window);
    await window.screenshot({ path: join(SHOT_DIR, 'agent13-sync-13-derniere-synchro.png') });

    expect(text).not.toBeNull();
    expect(text?.trim()).not.toBe('Jamais');
    // Format fr-FR attendu : JJ/MM/AAAA HH:MM:SS (espace insécable possible avant les secondes).
    expect(text?.trim()).toMatch(/^\d{2}\/\d{2}\/\d{4}/);

    // Même avec une synchro très récente (2 min), le badge de santé reste
    // "HORS-LIGNE" car isOnline est faux — le calcul de latence (OPTIMALE/
    // CORRECTE/DÉGRADÉE) n'est évalué QUE si isOnline est vrai
    // (SyncStatusDashboard.tsx, getHealthStatus()). Comportement confirmé, pas un bug.
    await expect(window.getByText('HORS-LIGNE').first()).toBeVisible();
    await expect(window.getByText('OPTIMALE')).toHaveCount(0);

    // Restauration de l'état initial.
    if (original.length === 0) {
      await dbQuery(`DELETE FROM t_config WHERE key = 'last_downstream_sync'`);
    } else {
      await dbQuery(`UPDATE t_config SET value = ? WHERE key = 'last_downstream_sync'`, [original[0].value]);
    }
  });

  test('14. Bouton RÉESSAYER — non applicable dans ce harnais (documenté, non exécuté)', async () => {
    const { window } = env;
    // PERMANENT_OFFLINE n'est jamais atteignable avec GEST_IN_SITU_E2E_DISABLE_SYNC=1
    // (voir en-tête de fichier). On se contente de confirmer que le bouton est bien
    // absent dans l'état OFFLINE simple (comportement conditionnel correct).
    await expect(window.getByRole('button', { name: /RÉESSAYER/ })).toHaveCount(0);
    test.skip(true, 'PERMANENT_OFFLINE non atteignable en harnais E2E_DISABLE_SYNC — nécessite un test manuel terrain (coupure réseau réelle en mode dev).');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // BLOC 8 — REVALIDATION CORRECTIF 2 (P0 fuite inter-sites, handlers.ts
  // sync:getStatus ~ligne 4001) : ADMINISTRATEUR_SITE doit désormais être
  // cloisonné par site_id ; SUPER ADMIN doit conserver sa vue globale
  // (non-régression volontaire).
  // ═══════════════════════════════════════════════════════════════════════
  const OTHER_SITE_ID = 999999;
  let ownSiteMarker = '';
  let otherSiteMarker = '';

  test("15. [CORRECTIF 2] ADMINISTRATEUR_SITE — le tableau anomalies est désormais cloisonné par site_id", async () => {
    const { window } = env;
    const now = Date.now();
    ownSiteMarker = `ZZTEST_ERROR_OWNSITE_${now}`;
    otherSiteMarker = `ZZTEST_ERROR_OTHERSITE_${now}`;

    // Session encore SUPER ADMIN (fin du bloc 7) — bascule vers ADMINISTRATEUR_SITE.
    await logout();
    const adminSite = getTestUser('administrateurSite');
    await login(adminSite.login, adminSite.password);
    await window.waitForURL(/#\/dashboard/, { timeout: 20000 });
    await gotoSyncStatus();
    await expect(window.getByText('Monitoring Synchronisation')).toBeVisible({ timeout: 10000 });

    await dbQuery(
      `INSERT INTO t_logs (action, detail, site_id, date_heure) VALUES (?, 'ZZTEST own-site probe', ?, datetime('now'))`,
      [ownSiteMarker, env.seed.siteId]
    );
    await dbQuery(
      `INSERT INTO t_logs (action, detail, site_id, date_heure) VALUES (?, 'ZZTEST other-site probe', ?, datetime('now'))`,
      [otherSiteMarker, OTHER_SITE_ID]
    );

    await clickRefresh();
    const rows = await getAnomalyRows(window);
    const ownMatch = rows.find((r) => r.action === ownSiteMarker);
    const otherMatch = rows.find((r) => r.action === otherSiteMarker);

    await window.screenshot({ path: join(SHOT_DIR, 'agent13-sync-15-admin-site-isolation.png') });

    console.log(
      `[agent13][CORRECTIF-2][ADMINISTRATEUR_SITE] anomalie même site visible=${!!ownMatch} ` +
      `(attendu: true) ; anomalie site_id=${OTHER_SITE_ID} visible=${!!otherMatch} (attendu: false, était true avant correctif)`
    );

    // Non-régression : le cas normal (même site) doit toujours fonctionner.
    expect(ownMatch).toBeDefined();
    expect(ownMatch?.badge).toBe('ERROR');
    // Le correctif : plus aucune fuite inter-sites pour ADMINISTRATEUR_SITE.
    expect(otherMatch).toBeUndefined();

    await logout();
  });

  test('16. [CORRECTIF 2] SUPER ADMIN — la vue globale reste intentionnellement non filtrée (non-régression)', async () => {
    const { window } = env;
    const user = getTestUser('superAdmin');

    await login(user.login, user.password);
    await window.waitForURL(/#\/dashboard/, { timeout: 20000 });
    await gotoSyncStatus();
    await expect(window.getByText('Monitoring Synchronisation')).toBeVisible({ timeout: 10000 });

    await clickRefresh();
    const rows = await getAnomalyRows(window);
    const ownMatch = rows.find((r) => r.action === ownSiteMarker);
    const otherMatch = rows.find((r) => r.action === otherSiteMarker);

    await window.screenshot({ path: join(SHOT_DIR, 'agent13-sync-16-superadmin-global-view.png') });

    console.log(
      `[agent13][CORRECTIF-2][SUPER ADMIN] anomalie même site visible=${!!ownMatch} ; ` +
      `anomalie site_id=${OTHER_SITE_ID} visible=${!!otherMatch} (attendu: true — vue globale volontaire pour ce rôle)`
    );

    expect(ownMatch).toBeDefined();
    expect(otherMatch).toBeDefined();
    expect(otherMatch?.badge).toBe('ERROR');

    // Nettoyage des deux marqueurs ZZTEST insérés en 15, avec vérification explicite.
    await dbQuery(`DELETE FROM t_logs WHERE action IN (?, ?)`, [ownSiteMarker, otherSiteMarker]);
    const remaining = await dbQuery(`SELECT COUNT(*) as c FROM t_logs WHERE action LIKE 'ZZTEST_%'`);
    expect(remaining[0].c).toBe(0);

    // Bug de harnais constaté (défaut pré-existant, hérité d'une session QA antérieure,
    // non lié aux correctifs applicatifs) : ce test enchaînait directement sur le test 17
    // sans jamais se déconnecter, alors que le test 17 suppose démarrer depuis /login
    // (`waitForURL(/#\/login/)` en tête de boucle) — ce qui le faisait échouer
    // systématiquement par timeout. Corrigé ici pour permettre l'exécution réelle des
    // tests suivants.
    await logout();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // BLOC 9 — REVALIDATION CORRECTIF 1 (P0 gel de page, SyncStatusDashboard.tsx)
  // : reproduit le scénario exact du bug original (SUPER ADMIN naviguant vers
  // /sync/status juste après connexion, avant que le Dashboard n'ait levé
  // `initialDataLoading` lui-même) 5 fois de suite — le bug original était
  // non-déterministe (~2/3). Assertion STRICTE (pas de récupération masquante
  // via ensureNoGlobalLoadingOverlay) : l'overlay doit disparaître seul.
  // ═══════════════════════════════════════════════════════════════════════
  test('17. [CORRECTIF 1] SUPER ADMIN — navigation immédiate post-login vers /sync/status : overlay levé (x5)', async () => {
    const { window } = env;
    const user = getTestUser('superAdmin');
    const attempts: Array<{ n: number; overlayClearedInTime: boolean }> = [];

    for (let i = 1; i <= 5; i++) {
      await window.waitForURL(/#\/login/, { timeout: 20000 });
      await login(user.login, user.password);
      // Course volontaire : on ne laisse à MainLayout/Dashboard aucun délai
      // supplémentaire pour lever lui-même le flag avant de partir vers /sync/status.
      await window.waitForURL(/#\/dashboard/, { timeout: 20000 });
      await gotoSyncStatus();
      await window.waitForURL(/#\/sync\/status/, { timeout: 10000 });

      const overlay = window.locator('.dashboard-premium.animate-fade-in');
      let cleared = true;
      try {
        await expect(overlay).toHaveCount(0, { timeout: 8000 });
      } catch {
        cleared = false;
        await window.screenshot({ path: join(SHOT_DIR, `agent13-sync-17-STUCK-attempt${i}.png`) });
      }
      attempts.push({ n: i, overlayClearedInTime: cleared });

      if (i === 1 || i === 5 || !cleared) {
        await window.screenshot({ path: join(SHOT_DIR, `agent13-sync-17-attempt${i}.png`) });
      }

      // Si l'overlay est bien levé, la page doit être réellement interactive.
      if (cleared) {
        await expect(window.getByText('Monitoring Synchronisation')).toBeVisible({ timeout: 5000 });
        await expect(window.locator('.btn-refresh-soleil')).toBeEnabled({ timeout: 5000 });
        await expect(window.locator('.btn-sync-soleil').first()).toBeEnabled({ timeout: 5000 });
      }

      await logout();
    }

    console.log(
      `[agent13][CORRECTIF-1] Résultat des 5 tentatives : ` +
      attempts.map((a) => `#${a.n}=${a.overlayClearedInTime ? 'OK' : 'GEL'}`).join(', ')
    );

    const stuckCount = attempts.filter((a) => !a.overlayClearedInTime).length;
    expect(stuckCount, `${stuckCount}/5 tentative(s) encore gelée(s) après le correctif`).toBe(0);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // BLOC 10 — REVALIDATION CORRECTIF P2 (toasts empilés sur RAFRAÎCHIR,
  // SyncStatusDashboard.tsx ~ligne 49/55) : le toast de loadStatus porte
  // désormais un id stable ('sync-status-refresh'), donc plusieurs clics
  // rapprochés doivent mettre à jour LE MÊME toast au lieu d'en empiler
  // plusieurs (react-hot-toast déduplique par id).
  // ═══════════════════════════════════════════════════════════════════════
  test("18. [CORRECTIF P2] RAFRAÎCHIR cliqué 4 fois rapidement — jamais plus d'un toast visible simultanément", async () => {
    const { window } = env;

    // Repart d'un état propre : test 17 termine sur /login.
    const user = getTestUser('superAdmin');
    await window.waitForURL(/#\/login/, { timeout: 20000 });
    await login(user.login, user.password);
    await window.waitForURL(/#\/dashboard/, { timeout: 20000 });
    await gotoSyncStatus();
    await ensureNoGlobalLoadingOverlay(window);
    await expect(window.getByText('Monitoring Synchronisation')).toBeVisible({ timeout: 10000 });

    const btn = window.locator('.btn-refresh-soleil');
    const toastText = 'Indicateurs mis à jour en temps réel.';

    // 4 clics rapprochés (locator.click() attend l'activabilité — si le bouton
    // est momentanément désactivé pendant un cycle loadStatus() en cours, le
    // clic suivant patiente puis se déclenche dès que possible ; c'est
    // exactement le scénario "clics rapides" décrit par l'utilisateur). On ne
    // relâche jamais le compteur de toasts entre les clics : c'est justement
    // le risque d'empilement qu'on veut caractériser.
    const countsAfterEachClick: number[] = [];
    for (let i = 0; i < 4; i++) {
      await btn.click();
      // Lecture immédiate (sans attendre de stabilisation) du nombre
      // d'éléments DOM affichant le texte du toast — c'est la fenêtre la
      // plus à risque pour observer un empilement.
      const count = await window.getByText(toastText).count();
      countsAfterEachClick.push(count);
    }

    // Laisse le dernier toast s'afficher pleinement puis re-vérifie une
    // dernière fois avant que l'auto-dismiss (4000ms, App.tsx) ne l'efface.
    await expect(window.getByText(toastText).first()).toBeVisible({ timeout: 10000 });
    const finalCount = await window.getByText(toastText).count();

    await window.screenshot({ path: join(SHOT_DIR, 'agent13-sync-18-no-toast-stacking.png') });

    console.log(
      `[agent13][CORRECTIF-P2] Nombre de toasts "${toastText}" observés après chaque clic : ` +
      `[${countsAfterEachClick.join(', ')}], compte final = ${finalCount} (attendu partout : <= 1)`
    );

    for (const c of countsAfterEachClick) {
      expect(c, `un clic a produit ${c} toast(s) simultané(s) au lieu de 1 max`).toBeLessThanOrEqual(1);
    }
    expect(finalCount).toBeLessThanOrEqual(1);

    // L'UI doit rester interactive après la rafale de clics (pas de bouclier
    // anti-clics resté actif par erreur).
    await expect(btn).toBeEnabled({ timeout: 5000 });

    await logout();
  });
});
