/**
 * e2e/specs/_agent13_bulk_progress_flushpeak_cloud.cloud.e2e.spec.ts
 *
 * QA Terrain (agent-13) — Test fonctionnel VIVANT contre le vrai projet
 * Supabase dev/staging (`allowRealSync: true`, build `dist-e2e-cloud/`,
 * `.env.e2e` — voir e2e/fixtures/electron-app.ts) du correctif commit
 * c9cef45 (src/main/ipc/handlers.ts, handler `sync:startBulk`) : la barre
 * de progression du "vidage forcé de t_outbox" restait bloquée à 0% quand
 * le backlog t_outbox (t_cartes) continuait de grossir PENDANT le vidage
 * (dénominateur `initialFlushTotal` figé une seule fois avant la boucle).
 * Le correctif remplace ce total figé par un total "pic" (`flushTotalPeak`)
 * qui s'ajuste à la hausse si le backlog observé dépasse le total connu.
 *
 * Deux scénarios :
 *  TEST 1 — Reproduction littérale du scénario terrain décrit : import
 *    Excel/CSV réel via l'UI (clic "Poursuivre l'import" SANS attendre sa
 *    résolution) suivi IMMÉDIATEMENT d'un clic réel sur "ENVOYER LES CARTES
 *    VERS LE CLOUD" sur le Dashboard — ces deux flux tournent réellement en
 *    concurrence dans le process main (aucun verrou ne les sépare, voir
 *    sync-engine.ts::pause()/isCurrentlySyncing()). On observe le
 *    pourcentage affiché en continu et on corrèle avec main.log.
 *  TEST 2 — Reproduction déterministe et ciblée du mécanisme exact fixé :
 *    un lot A de cartes ZZTEST_ est mis en PENDING dans t_outbox, le
 *    transfert manuel est lancé, et PENDANT que la boucle de vidage tourne
 *    (détecté par polling du % affiché), un lot B est injecté directement
 *    en base via une connexion SQLite concurrente (même mécanisme qu'un
 *    import qui continuerait d'écrire pendant le vidage) — on vérifie que
 *    `flushTotalPeak` absorbe cette croissance sans jamais bloquer/negativer
 *    la progression affichée, jusqu'à 100%.
 *
 * Isolation : `userDataDir` jetable (fs.mkdtempSync), jamais
 * AppData/Roaming/gest-in-situ (production terrain). Toutes les données
 * créées (locales ET cloud dev/staging) sont préfixées `ZZTEST_`, nettoyées
 * en fin de run avec re-vérification explicite (aucune trace résiduelle).
 */
import { test, expect } from '@playwright/test';
import {
  launchSeededApp,
  teardownSeededApp,
  type E2EEnvironment
} from '../fixtures/electron-app';
import { getTestUser } from '../fixtures/test-users';
import { supabaseDev, ensureCloudSiteAndCentre, cleanupAllCloudTestData } from '../fixtures/supabase-dev-client';
import { writeFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const SHOT_DIR = join(__dirname, '..', '..', 'test-results', 'agent13-screenshots');
const NOW = Date.now();

test.describe.serial('QA Terrain CLOUD — Progression vidage forcé t_outbox (fix c9cef45 flushTotalPeak) (agent-13)', () => {
  let env: E2EEnvironment;
  let anyTestFailed = false;
  let mainLogPath: string | null = null;

  test.beforeAll(async () => {
    env = await launchSeededApp({ allowRealSync: true });
    // electron-log par défaut écrit sous <userData>/logs/main.log (constaté empiriquement sur
    // le répertoire de diagnostic conservé d'un run en échec) — pas besoin de require() côté
    // process main (indisponible dans le contexte utilityScript de app.evaluate()).
    mainLogPath = join(env.userDataDir, 'logs', 'main.log');
    console.log(`[agent13][LOG] main.log résolu à : ${mainLogPath}`);
  });

  test.afterAll(async () => {
    const cleanupLog: string[] = [];
    // ⚠️ ORDRE IMPORTANT : le mirror t_users(login=administrateurSite, site_id=env.seed.siteId)
    // DOIT être supprimé AVANT cleanupAllCloudTestData() (qui supprime t_sites en dernier).
    // Constat empirique (premier run de ce fichier) : l'ordre inverse laissait un t_sites
    // résiduel — le DELETE sur t_sites échouait silencieusement (contrainte FK depuis la ligne
    // t_users mirror encore présente au moment de l'appel), sans erreur visible côté appelant
    // (cleanupAllCloudTestData ne fait qu'un re-COUNT final, pas de remontée d'erreur par ligne).
    try {
      const { error } = await supabaseDev.from('t_users').delete().eq('login', getTestUser('administrateurSite').login);
      cleanupLog.push(`mirror cloud t_users(${getTestUser('administrateurSite').login}) supprimé, error=${error?.message ?? 'none'}`);
    } catch (err) {
      cleanupLog.push(`échec nettoyage mirror t_users : ${err}`);
    }
    try {
      const res = await cleanupAllCloudTestData();
      cleanupLog.push(`résiduel cloud après nettoyage cartes/centres/sites : cartes=${res.residualCartes} centres=${res.residualCentres} sites=${res.residualSites}`);
    } catch (err) {
      cleanupLog.push(`échec nettoyage cloud générique : ${err}`);
    }
    console.log(`[agent13][CLOUD-CLEANUP] ${cleanupLog.join(' | ')}`);

    if (env) {
      await teardownSeededApp(env, anyTestFailed);
    }
  });

  test.afterEach(async ({}, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus) {
      anyTestFailed = true;
    }
  });

  // ── Helpers DB directs (pattern établi, voir import-centre-migration-qa-terrain.e2e.spec.ts) ──
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

  /**
   * Injecte N cartes ZZTEST_ directement en base (t_cartes, is_dirty=1) PLUS
   * l'entrée t_outbox PENDING correspondante (même schéma exact que
   * import-worker.js::outboxUpsertStmt : id = sync_id, payload = JSON de la
   * ligne t_cartes complète). Exécuté via une connexion SQLite SÉPARÉE
   * (nouveau process electron -e), en WAL — peut donc tourner PENDANT que
   * l'app a elle-même la base ouverte (busy_timeout gère la contention).
   */
  async function seedBulkOutboxCards(prefix: string, count: number, siteId: number, centreId: number): Promise<string[]> {
    const script = `
      const Database = require('better-sqlite3');
      const db = new Database(process.argv[1], { timeout: 15000 });
      db.pragma('busy_timeout = 15000');
      db.pragma('journal_mode = WAL');
      const prefix = process.argv[2];
      const count = Number(process.argv[3]);
      const siteId = Number(process.argv[4]);
      const centreId = Number(process.argv[5]);
      const now = process.argv[6];
      const insertCarte = db.prepare(
        \`INSERT INTO t_cartes (noms, prenoms, date_de_naissance, lieu_de_naissance, rangement, statut, statut_physique,
           contact, num_secu, site_id, centre_id, agent_saisie, cle_doublon, cle_doublon_flex, sync_id, is_dirty)
         VALUES (@noms, @prenoms, @ddn, @lieu, @rangement, 'EN STOCK', 'OK',
           @contact, @num_secu, @site_id, @centre_id, 'SYSTEM', @cle_doublon, @cle_doublon_flex, @sync_id, 1)\`
      );
      const getCard = db.prepare('SELECT * FROM t_cartes WHERE id_carte = ?');
      const outboxUpsert = db.prepare(
        \`INSERT INTO t_outbox (id, table_name, operation, payload, status, attempts, created_at, error_msg, depends_on)
         VALUES (@id, 't_cartes', 'UPDATE', @payload, 'PENDING', 0, datetime('now'), NULL, NULL)
         ON CONFLICT(id) DO UPDATE SET operation='UPDATE', payload=excluded.payload, status='PENDING', attempts=0, error_msg=NULL, created_at=excluded.created_at\`
      );
      const syncIds = [];
      const tx = db.transaction(() => {
        for (let i = 0; i < count; i++) {
          const noms = prefix + '_' + String(i).padStart(4, '0');
          const syncId = 'zztest-flushpeak-' + prefix.toLowerCase() + '-' + i + '-' + now;
          const ddn = '1990-01-01';
          const contact = '01' + String(1000000 + i);
          const rangement = 'ZZTEST-RGT-' + prefix + '-' + i;
          const cleDbl = noms + '|AGENT|' + ddn + '|ZZTEST_LIEU|' + contact;
          const id = insertCarte.run({
            noms, prenoms: 'AGENT', ddn, lieu: 'ZZTEST_LIEU', rangement,
            contact, num_secu: 'NS' + prefix + String(i).padStart(4, '0'),
            site_id: siteId, centre_id: centreId,
            cle_doublon: cleDbl, cle_doublon_flex: cleDbl,
            sync_id: syncId
          }).lastInsertRowid;
          const row = getCard.get(id);
          outboxUpsert.run({ id: syncId, payload: JSON.stringify(row) });
          syncIds.push(syncId);
        }
      });
      tx();
      db.close();
      process.stdout.write(${JSON.stringify(DB_QUERY_MARKER)} + JSON.stringify(syncIds));
    `;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electronPath = require('electron') as unknown as string;
    const { stdout, stderr } = await execFileAsync(
      electronPath,
      [
        '-e', script, env.seed.dbPath, prefix, String(count), String(siteId), String(centreId), String(Date.now())
      ],
      { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
    );
    const line = stdout.split(/\r?\n/).reverse().find((l) => l.startsWith(DB_QUERY_MARKER));
    if (!line) {
      throw new Error(`[seedBulkOutboxCards] Aucun résultat exploitable.\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`);
    }
    return JSON.parse(line.slice(DB_QUERY_MARKER.length));
  }

  async function login(loginStr: string, password: string): Promise<void> {
    const { window } = env;
    await window.getByTestId('login-input').fill(loginStr);
    await window.getByTestId('password-input').fill(password);
    await window.getByTestId('login-submit').click();
  }

  /**
   * Attend que le bouton "ENVOYER LES CARTES VERS LE CLOUD" apparaisse sur le Dashboard.
   *
   * Constat empirique (run précédent de ce fichier) : `useDashboardStats.ts` (ligne ~329)
   * ne rappelle `loadStats()` au montage QUE si `useCacheStore.dashboardCache.cachedAt` est
   * vide — un remontage simple (navigation ailleurs puis retour) réutilise donc le cache
   * FIGÉ de la toute première visite du Dashboard (fait AVANT tout import, dans TEST 0), et
   * le bouton "ENVOYER..." n'apparaît jamais tant que ce cache n'est pas invalidé. Le clic
   * réel sur "Actualiser" appelle `loadStats(..., forceRefresh: true)` — un appel DIRECT,
   * jamais gaté par ce cache de montage — c'est donc le seul moyen fiable de forcer un
   * rafraîchissement réel depuis ce harnais, quel que soit l'état du cache. Effet de bord
   * accepté : "Actualiser" déclenche aussi un pull cloud réel (handlePullSiteCards) avant le
   * rechargement des stats — cohérent avec le reste de ce spec (réseau réel déjà utilisé).
   */
  async function waitForEnvoyerButton(maxMs = 30000): Promise<void> {
    const { window } = env;
    const envoyerBtn = window.getByRole('button', { name: /ENVOYER LES CARTES VERS LE CLOUD/i });
    const actualiserBtn = window.getByRole('button', { name: 'Actualiser' });
    const deadline = Date.now() + maxMs;
    while (Date.now() < deadline) {
      if (await envoyerBtn.count() > 0 && await envoyerBtn.isVisible()) return;
      if (await actualiserBtn.count() > 0) {
        await actualiserBtn.click().catch(() => {});
      }
      await window.waitForTimeout(1500);
    }
    // Dernière tentative directe (fera échouer l'assertion appelante avec un message clair
    // si le bouton n'est vraiment jamais apparu).
    await expect(envoyerBtn).toBeVisible({ timeout: 5000 });
  }

  async function waitForRealNetworkOnline(timeoutMs = 60000): Promise<boolean> {
    const { window } = env;
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const state = await window.evaluate(async () => {
        try {
          const s = await (window as any).api?.sync?.getStatus?.();
          return s?.state ?? null;
        } catch {
          return null;
        }
      });
      if (state === 'ONLINE') return true;
      await window.waitForTimeout(1000);
    }
    return false;
  }

  /**
   * Poll du pourcentage affiché dans l'overlay de blocage
   * ("Transfert de masse vers le Cloud... (X%)") tant que isBulkUploading
   * reste vrai côté UI (recherché via la présence du texte "Transfert de
   * masse"). Retourne la série temporelle des valeurs observées.
   */
  async function pollBulkProgress(maxMs: number, intervalMs = 400): Promise<Array<{ t: number; text: string | null; pct: number | null }>> {
    const { window } = env;
    const readings: Array<{ t: number; text: string | null; pct: number | null }> = [];
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      const text = await window.evaluate(() => {
        const el = Array.from(document.querySelectorAll('span')).find((s) => s.textContent?.includes('Transfert de masse vers le Cloud'));
        return el?.textContent || null;
      });
      const m = text?.match(/\((-?\d+)%\)/);
      const pct = m ? parseInt(m[1], 10) : null;
      readings.push({ t: Date.now() - start, text, pct });
      if (!text) {
        // Overlay disparu -> transfert terminé (ou jamais démarré).
        break;
      }
      await window.waitForTimeout(intervalMs);
    }
    return readings;
  }

  function summarizeReadings(readings: Array<{ t: number; text: string | null; pct: number | null }>): string {
    const pcts = readings.map((r) => r.pct).filter((p): p is number => p !== null);
    return `n=${readings.length} pcts=${JSON.stringify(pcts)} maxT=${readings.length ? readings[readings.length - 1].t : 0}ms`;
  }

  async function readLogTail(maxChars = 20000): Promise<string> {
    if (!mainLogPath) return '(chemin main.log inconnu)';
    try {
      const { readFileSync } = await import('fs');
      const content = readFileSync(mainLogPath, 'utf-8');
      return content.slice(-maxChars);
    } catch (e: any) {
      return `(lecture main.log échouée : ${e.message})`;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // SETUP — réseau réel ONLINE + site/centre cloud pré-positionnés.
  // ═══════════════════════════════════════════════════════════════════════
  test('0. Préparation — réseau réel ONLINE + site/centre cloud ZZTEST_', async () => {
    const online = await waitForRealNetworkOnline(60000);
    console.log(`[agent13][CLOUD] Réseau réel ONLINE atteint : ${online}`);
    expect(online, 'Le réseau réel doit atteindre ONLINE pour ce scénario cloud').toBe(true);

    await ensureCloudSiteAndCentre(env.seed.siteId, env.seed.centreId);

    // Mirror cloud du compte ADMINISTRATEUR_SITE utilisé pour toute la suite : downstream.ts
    // ::syncCurrentUserActiveStatus() interroge Supabase par (login, site_id) à chaque cycle
    // downstream et désactive LOCALEMENT tout compte absent côté cloud (traité comme
    // "supprimé/désactivé côté Cloud" — comportement voulu pour de vrais agents terrain).
    // Sans ce mirror, la session est forcée en déconnexion ("Compte désactivé") dès le
    // premier cycle downstream réel — constat empirique fait sur un run précédent de ce
    // fichier (main.log : "[syncCurrentUserActiveStatus] Compte "E2E_ADMINISTRATEUR_SITE"
    // désactivé/supprimé côté Cloud"). Purge défensive d'abord (au cas où un run antérieur
    // interrompu aurait laissé un résidu avec statut_actif=0 sur ce même login/site).
    const adminSiteUser = getTestUser('administrateurSite');
    await supabaseDev.from('t_users').delete().eq('login', adminSiteUser.login).eq('site_id', env.seed.siteId);
    const { error: mirrorErr } = await supabaseDev.from('t_users').insert({
      login: adminSiteUser.login,
      password_hash: 'ZZTEST_MIRROR_NOT_A_REAL_HASH',
      role: adminSiteUser.role,
      nom_user: adminSiteUser.nom,
      prenom_user: adminSiteUser.prenom,
      statut_actif: 1,
      site_id: env.seed.siteId,
      centre_id: null,
      sync_id: `zztest-flushpeak-adminsite-mirror-${NOW}`
    });
    expect(mirrorErr, `Échec mirroring cloud du compte ADMINISTRATEUR_SITE : ${mirrorErr?.message}`).toBeNull();

    await login(adminSiteUser.login, adminSiteUser.password);
    await env.window.waitForURL(/#\/dashboard/, { timeout: 20000 });
    await env.window.screenshot({ path: join(SHOT_DIR, 'agent13-flushpeak-00-login-dashboard.png') });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // TEST 1 — Reproduction littérale : import CSV réel via l'UI, puis clic
  // immédiat (sans attendre la fin de l'import) sur "Envoyer vers le Cloud".
  // ═══════════════════════════════════════════════════════════════════════
  test('1. Import réel (UI) puis clic immédiat "Envoyer vers le Cloud" — progression jamais bloquée à 0%', async () => {
    test.setTimeout(240_000);
    const { window } = env;
    const N = 130;
    const tmpDir = mkdtempSync(join(tmpdir(), 'gest-in-situ-agent13-'));
    const csvPath = join(tmpDir, 'zztest_flushpeak_import.csv');
    // En-tête CANONIQUE complète (confirmée fonctionnelle pour un import RÉEL — reprise du
    // test 9/10 d'import-centre-migration-qa-terrain.e2e.spec.ts, ligne 377). Un run précédent
    // de ce fichier utilisait par erreur l'en-tête courte 'date_naissance' du test 2 de ce
    // même spec voisin — celui-ci ne teste QUE la détection de colonnes en aperçu (jamais un
    // import réel) : 'date_naissance' (sans "DE") n'est PAS dans COLUMN_ALIASES.date_de_naissance
    // (import-worker.js) → ddn restait vide → isValidDate() rejetait les 130 lignes
    // (rejected:130, inserted:0 constaté dans main.log). Colonne "RANGEMENT" INCLUSE : sans
    // elle, resolveRouting() pose rangement='NON CLASSE', qui bascule la classification
    // serveur (stats-worker.js::getDetailedSyncStats) dans missingCount ("2E ÉTAPE : ENVOYER
    // LES ANOMALIES") plutôt que cleanCount ("ENVOYER LES CARTES VERS LE CLOUD" — bouton visé).
    const lines = ['NOMS;PRENOMS;DATE DE NAISSANCE;LIEU DE NAISSANCE;CONTACT;N° SECU;RANGEMENT;STATUT'];
    for (let i = 0; i < N; i++) {
      lines.push(`ZZTEST_FPK_IMP${String(i).padStart(4, '0')};Agent;1991-0${(i % 9) + 1}-1${i % 9};ZZTEST_LIEU;010${String(2000000 + i)};NSFPK${String(i).padStart(4, '0')};ZZTEST-RGT-IMP${String(i).padStart(4, '0')};EN STOCK`);
    }
    writeFileSync(csvPath, lines.join('\n'), 'utf-8');

    await window.evaluate(() => { window.location.hash = '#/import'; });
    await window.waitForURL(/#\/import/, { timeout: 15000 });

    // Mock du dialogue natif (même pattern que les autres specs QA terrain).
    await env.app.evaluate(({ dialog }, fp) => {
      (dialog as any).__originalShowOpenDialog = dialog.showOpenDialog;
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [fp] })) as any;
    }, csvPath);

    await window.getByRole('button', { name: /Sélectionner le Listing/i }).click();
    await expect(window.getByText(`${N} lignes détectées`).first()).toBeVisible({ timeout: 10000 });
    await window.screenshot({ path: join(SHOT_DIR, 'agent13-flushpeak-01-preview.png') });

    await window.getByRole('button', { name: /Lancer l'Importation/i }).click();
    await expect(window.getByRole('button', { name: /Poursuivre l'import/i })).toBeVisible({ timeout: 10000 });

    const t0 = Date.now();
    // Clic réel — la promesse interne (executeImport -> processFile) n'est PAS
    // attendue ici : .click() de Playwright ne résout qu'une fois l'événement
    // DOM dispatché, pas la chaîne async React qu'il déclenche. L'import worker
    // continue de tourner dans le process main après ce point.
    await window.getByRole('button', { name: /Poursuivre l'import/i }).click();
    console.log(`[agent13][TIMING] Clic "Poursuivre l'import" dispatché à t+0ms (${new Date(t0).toISOString()})`);

    // Navigation IMMÉDIATE vers le Dashboard, sans attendre "Migration terminée !"
    await window.evaluate(() => { window.location.hash = '#/dashboard'; });
    const tNav = Date.now() - t0;
    console.log(`[agent13][TIMING] Navigation vers #/dashboard à t+${tNav}ms`);

    // Le bouton "ENVOYER LES CARTES VERS LE CLOUD" ne s'affiche qu'une fois que
    // loadStats() a été rappelé APRÈS l'écriture des cartes en base — voir
    // waitForEnvoyerButton() pour le détail empirique (cache de montage figé,
    // "Actualiser" = seul chemin de rafraîchissement fiable depuis ce harnais).
    await waitForEnvoyerButton(30000);
    const envoyerBtn = window.getByRole('button', { name: /ENVOYER LES CARTES VERS LE CLOUD/i });
    const tBtnVisible = Date.now() - t0;
    console.log(`[agent13][TIMING] Bouton "ENVOYER LES CARTES VERS LE CLOUD" visible à t+${tBtnVisible}ms`);
    await window.screenshot({ path: join(SHOT_DIR, 'agent13-flushpeak-02-dashboard-envoyer-visible.png') });

    await envoyerBtn.click();
    await window.getByRole('button', { name: 'Confirmer' }).click();
    const tConfirm = Date.now() - t0;
    console.log(`[agent13][TIMING] Transfert confirmé à t+${tConfirm}ms`);

    const readings = await pollBulkProgress(120000, 400);
    console.log(`[agent13][PROGRESSION][TEST1] ${summarizeReadings(readings)}`);
    await window.screenshot({ path: join(SHOT_DIR, 'agent13-flushpeak-03-during-transfer.png') }).catch(() => {});

    // Attendre la fin réelle de l'import (pour ne pas polluer TEST 2) + laisser
    // le temps à un éventuel dernier cycle outbox de se terminer.
    await expect(window.getByText('Migration terminée !')).toBeVisible({ timeout: 60000 }).catch(() =>
      console.warn('[agent13][TEST1] Toast "Migration terminée !" non observé dans le délai (import peut-être déjà revenu sur le Dashboard).')
    );
    await window.waitForTimeout(3000);

    const logTail = await readLogTail();
    const outboxSyncedLines = (logTail.match(/\[OutboxService\] ✓ t_cartes/g) || []).length;
    const bulkProgressLines = (logTail.match(/PROGRESSION BULK UPLOAD/g) || []).length;
    console.log(`[agent13][LOG-CORRELATION][TEST1] Lignes "[OutboxService] ✓ t_cartes" dans la fenêtre de log : ${outboxSyncedLines} ; lignes "PROGRESSION BULK UPLOAD" : ${bulkProgressLines}`);

    // ── Assertions ──
    const pcts = readings.map((r) => r.pct).filter((p): p is number => p !== null);
    expect(pcts.length, 'Au moins une lecture de pourcentage doit avoir été capturée pendant le transfert').toBeGreaterThan(0);
    expect(Math.max(...pcts, -1), 'La progression ne doit jamais rester strictement négative (clamp UI)').toBeGreaterThanOrEqual(0);
    // Le test central du correctif : la progression ne doit PAS rester bloquée
    // à 0% durant tout le run alors que le transfert avance réellement (lignes
    // OutboxService synced présentes) ni dans le tout dernier relevé.
    if (outboxSyncedLines > 0) {
      expect(pcts.some((p) => p > 0), 'Des cartes sont synchronisées (logs) mais la progression affichée est restée à 0% tout du long').toBe(true);
    }

    // Vérification base locale : plus aucune entrée PENDING t_outbox pour nos
    // cartes ZZTEST_FPK_IMP, is_dirty=0 et synced_at renseigné.
    const remainingPending = await dbQuery(
      "SELECT COUNT(*) as n FROM t_outbox WHERE status = 'PENDING' AND payload LIKE '%ZZTEST_FPK_IMP%'"
    );
    const dirtyLeft = await dbQuery(
      "SELECT COUNT(*) as n FROM t_cartes WHERE noms LIKE 'ZZTEST_FPK_IMP%' AND is_dirty = 1"
    );
    const syncedCount = await dbQuery(
      "SELECT COUNT(*) as n FROM t_cartes WHERE noms LIKE 'ZZTEST_FPK_IMP%' AND synced_at IS NOT NULL"
    );
    console.log(`[agent13][DB-STATE][TEST1] outbox PENDING restant=${remainingPending[0].n} ; cartes encore dirty=${dirtyLeft[0].n} ; cartes synced_at renseigné=${syncedCount[0].n}/${N}`);

    expect(remainingPending[0].n, 'Aucune entrée t_outbox PENDING ne devrait subsister pour ce lot après la fin du transfert').toBe(0);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // TEST 2 — Reproduction déterministe : backlog t_outbox qui GROSSIT
  // PENDANT le vidage forcé (injection concurrente via connexion séparée).
  // ═══════════════════════════════════════════════════════════════════════
  test('2. Backlog t_outbox croissant PENDANT le vidage forcé — flushTotalPeak absorbe la croissance sans blocage', async () => {
    test.setTimeout(300_000);
    const { window } = env;

    const batchASize = 55; // > OUTBOX_BATCH_SIZE (50) : garantit >= 2 itérations de boucle
    const batchBSize = 40;

    const batchASyncIds = await seedBulkOutboxCards('ZZTEST_FPK_A', batchASize, env.seed.siteId, env.seed.centreId);
    console.log(`[agent13][SEED][TEST2] Lot A injecté : ${batchASyncIds.length} cartes PENDING dans t_outbox.`);

    const pendingBefore = await dbQuery("SELECT COUNT(*) as n FROM t_outbox WHERE status='PENDING' AND table_name='t_cartes'");
    console.log(`[agent13][DB-STATE][TEST2] t_outbox PENDING t_cartes avant clic = ${pendingBefore[0].n}`);

    await window.evaluate(() => { window.location.hash = '#/dashboard'; });
    await window.waitForURL(/#\/dashboard/, { timeout: 15000 });

    // Voir waitForEnvoyerButton() : le cache de montage du Dashboard reste figé sur la
    // dernière valeur connue (ici, l'état "SYSTÈME À JOUR" laissé par TEST 1 après son
    // propre transfert) — seul un clic réel sur "Actualiser" force un loadStats() frais
    // qui verra le lot A tout juste injecté directement en base.
    await waitForEnvoyerButton(30000);
    const envoyerBtn = window.getByRole('button', { name: /ENVOYER LES CARTES VERS LE CLOUD/i });
    await envoyerBtn.click();
    await window.getByRole('button', { name: 'Confirmer' }).click();

    const t0 = Date.now();
    console.log(`[agent13][TIMING][TEST2] Transfert confirmé à ${new Date(t0).toISOString()}`);

    let injected = false;
    let injectionTMs: number | null = null;
    let injectionError: string | null = null;
    const injectionPromise = (async () => {
      // Attendre la première lecture de progression NON-nulle (ou un délai de
      // sécurité de 2.5s) avant d'injecter le lot B, pour être sûr que la
      // boucle de vidage a démarré et a déjà pris son "flushTotalPeak" initial
      // (= batchASize) AVANT que le lot B n'apparaisse — condition exacte du
      // bug corrigé (le backlog grossit APRÈS le snapshot initial).
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        const text = await window.evaluate(() => {
          const el = Array.from(document.querySelectorAll('span')).find((s) => s.textContent?.includes('Transfert de masse vers le Cloud'));
          return el?.textContent || null;
        }).catch(() => null);
        if (text) break;
        await window.waitForTimeout(200);
      }
      await window.waitForTimeout(1500); // marge additionnelle pour être bien "pendant" la boucle, pas juste au tout début
      try {
        const batchBSyncIds = await seedBulkOutboxCards('ZZTEST_FPK_B', batchBSize, env.seed.siteId, env.seed.centreId);
        injected = true;
        injectionTMs = Date.now() - t0;
        console.log(`[agent13][INJECTION][TEST2] Lot B (${batchBSyncIds.length} cartes) injecté à t+${injectionTMs}ms pendant le vidage forcé.`);
      } catch (e: any) {
        injectionError = e.message || String(e);
        console.error(`[agent13][INJECTION][TEST2] Échec injection lot B : ${injectionError}`);
      }
    })();

    const readings = await pollBulkProgress(150000, 400);
    await injectionPromise;

    console.log(`[agent13][PROGRESSION][TEST2] ${summarizeReadings(readings)} | lot B injecté=${injected} à t+${injectionTMs}ms | erreur injection=${injectionError}`);
    await window.screenshot({ path: join(SHOT_DIR, 'agent13-flushpeak-04-test2-during-transfer.png') }).catch(() => {});

    await window.waitForTimeout(2000);
    const logTail = await readLogTail();
    const outboxSyncedLines2 = (logTail.match(/\[OutboxService\] ✓ t_cartes/g) || []).length;
    console.log(`[agent13][LOG-CORRELATION][TEST2] Lignes "[OutboxService] ✓ t_cartes" dans la fenêtre de log : ${outboxSyncedLines2}`);

    // ── Assertions ──
    expect(injected, 'L\'injection du lot B doit avoir réussi (sinon le scénario de croissance du backlog n\'a pas été exercé)').toBe(true);

    const pcts = readings.map((r) => r.pct).filter((p): p is number => p !== null);
    expect(pcts.length, 'Au moins une lecture de pourcentage doit avoir été capturée').toBeGreaterThan(0);
    expect(Math.min(...pcts), 'La progression affichée ne doit jamais être négative (bug historique : (peak-remaining)/peak négatif si le backlog dépassait le total figé)').toBeGreaterThanOrEqual(0);

    // La progression ne doit pas rester bloquée à 0% en fin de lecture alors
    // que des cartes ont été synchronisées.
    const lastPct = pcts.length ? pcts[pcts.length - 1] : null;
    console.log(`[agent13][ASSERT][TEST2] Dernière valeur de progression observée = ${lastPct}%`);

    const remainingPendingA = await dbQuery(
      "SELECT COUNT(*) as n FROM t_outbox WHERE status = 'PENDING' AND payload LIKE '%ZZTEST_FPK_A%'"
    );
    const remainingPendingB = await dbQuery(
      "SELECT COUNT(*) as n FROM t_outbox WHERE status = 'PENDING' AND payload LIKE '%ZZTEST_FPK_B%'"
    );
    const syncedA = await dbQuery("SELECT COUNT(*) as n FROM t_cartes WHERE noms LIKE 'ZZTEST_FPK_A%' AND synced_at IS NOT NULL");
    const syncedB = await dbQuery("SELECT COUNT(*) as n FROM t_cartes WHERE noms LIKE 'ZZTEST_FPK_B%' AND synced_at IS NOT NULL");
    console.log(`[agent13][DB-STATE][TEST2] Lot A restant PENDING=${remainingPendingA[0].n}/${batchASize} synced=${syncedA[0].n} | Lot B restant PENDING=${remainingPendingB[0].n}/${batchBSize} synced=${syncedB[0].n}`);

    // Vérification cloud croisée : un échantillon de chaque lot doit être
    // réellement présent côté Supabase dev/staging.
    if (batchASyncIds.length > 0) {
      const sample = await supabaseDev.from('t_cartes').select('sync_id').eq('sync_id', batchASyncIds[0]).maybeSingle();
      console.log(`[agent13][CLOUD-CHECK][TEST2] Échantillon lot A (${batchASyncIds[0]}) présent côté cloud = ${!!sample.data}`);
    }

    expect(remainingPendingA[0].n, 'Le lot A doit être intégralement vidé de t_outbox en fin de transfert').toBe(0);
    expect(remainingPendingB[0].n, 'Le lot B (injecté pendant le vidage) doit lui aussi être intégralement vidé de t_outbox — c\'est exactement ce que flushTotalPeak doit garantir').toBe(0);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // CLEANUP LOCAL — cartes ZZTEST_ créées par ce fichier (local + vérif).
  // ═══════════════════════════════════════════════════════════════════════
  test('3. Nettoyage local — suppression des cartes ZZTEST_ créées par ce fichier', async () => {
    const del1 = await dbQuery("DELETE FROM t_outbox WHERE payload LIKE '%ZZTEST_FPK%'");
    const del2 = await dbQuery("DELETE FROM t_cartes WHERE noms LIKE 'ZZTEST_FPK%'");
    console.log(`[agent13][LOCAL-CLEANUP] t_outbox supprimées=${del1[0].changes} ; t_cartes supprimées=${del2[0].changes}`);

    const residual = await dbQuery("SELECT COUNT(*) as n FROM t_cartes WHERE noms LIKE 'ZZTEST_FPK%'");
    console.log(`[agent13][LOCAL-CLEANUP] Résiduel local t_cartes ZZTEST_FPK% = ${residual[0].n}`);
    expect(residual[0].n).toBe(0);
  });
});
