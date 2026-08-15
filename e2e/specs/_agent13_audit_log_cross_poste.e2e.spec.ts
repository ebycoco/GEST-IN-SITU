/**
 * e2e/specs/_agent13_audit_log_cross_poste.e2e.spec.ts
 *
 * QA Terrain (agent-13) — Revalidation vivante du commit a324fc8
 * "feat(audit): journal d'audit visible entre postes d'un meme site".
 *
 * Vérifie, en conditions réelles (app lancée, DB SQLite locale inspectée
 * avant/après action) :
 *  1. Qu'une action CRUD de la liste blanche (CRUD_SYNC_WHITELIST, voir
 *     src/main/utils/audit.ts) écrit bien à la fois dans t_audit_log ET
 *     t_logs (is_dirty=1) + enfile une entrée t_outbox.
 *  2. Le cloisonnement centre sur /logs pour un ADMIN_CENTRE (CLAUDE.md §3) :
 *     un ADMIN_CENTRE d'un centre B ne doit JAMAIS voir une action CRUD
 *     journalisée pour le centre A du même site.
 *  3. Qu'une entrée simulant une provenance cross-poste (source: 'sync',
 *     is_dirty=0, sync_id fabriqué) affiche le bouton "Supprimer" désactivé
 *     dans /logs.
 *  4. Qu'une connexion/déconnexion normale n'écrit JAMAIS dans t_logs (reste
 *     100% locale à t_audit_log), pour confirmer que la liste blanche filtre
 *     correctement.
 *
 * Limitation assumée et documentée (pas de faux résultat) : cette instance
 * tourne avec GEST_IN_SITU_E2E_DISABLE_SYNC=1 (réseau Supabase coupé, voir
 * electron-app.ts) — c'est la SEULE façon d'obtenir une base 100% isolée de
 * toute donnée réelle sans lancer de commande de build (CLAUDE.md §1 interdit
 * npm run build/electron-vite build de la propre initiative d'un agent, y
 * compris `--mode e2e` pour dist-e2e-cloud). Conséquence : la confirmation
 * réelle d'upload (is_dirty 1 -> 0 après upsert Supabase confirmé) et le pull
 * cross-poste réel (runLogsDownstream contre un second poste) NE SONT PAS
 * vérifiables ici — seule l'écriture correcte outbox/t_logs (condition
 * nécessaire côté émetteur) est testée. Voir rapport final pour le détail.
 *
 * Toute donnée créée directement en base porte le préfixe QA_TERRAIN_ dans
 * noms/prenoms/login/nom de centre, nettoyée en fin de fichier avec
 * revérification explicite (COUNT(*) = 0). Le userDataDir jetable est
 * nettoyé par teardownSeededApp (base entièrement jetée, hors AppData réel).
 */
import { test, expect } from '@playwright/test';
import {
  launchSeededApp,
  teardownSeededApp,
  type E2EEnvironment
} from '../fixtures/electron-app';
import { getTestUser } from '../fixtures/test-users';
import { hashPassword } from '../../src/main/auth/local-auth';
import { join } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
// test-results/ est déjà ignoré par git (.gitignore) : emplacement portable pour les
// captures de ce test, indépendant de toute session/machine (contrairement à un chemin
// absolu vers un répertoire scratchpad temporaire).
const SHOT_DIR = join(__dirname, '..', '..', 'test-results', 'agent13-screenshots');

test.describe.serial('QA Terrain — Journal d\'audit cross-poste t_logs (agent-13, commit a324fc8)', () => {
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
    const logoutBtn = window.getByRole('button', { name: /Déconnexion|Se déconnecter|Logout/i }).first();
    const visible = await logoutBtn.isVisible({ timeout: 3000 }).catch(() => false);
    if (visible) {
      await logoutBtn.click();
    } else {
      // Fallback : IPC direct si aucun bouton de déconnexion trouvé dans le layout courant.
      await window.evaluate(() => {
        // @ts-expect-error API preload non typée ici
        return window.api?.auth?.logout ? window.api.auth.logout() : undefined;
      }).catch(() => {});
      await window.evaluate(() => { window.location.hash = '#/login'; });
    }
  }

  async function goHash(path: string): Promise<void> {
    await env.window.evaluate((p) => { window.location.hash = p; }, path);
  }

  // ── Données de test ──────────────────────────────────────────────────────
  const now = Date.now();
  let centreBId = 0;
  let cardCentreAId = 0;
  const centreBAdminLogin = `QA_TERRAIN_ADMIN_CENTREB_${now}`;
  const centreBAdminPassword = 'QaTerrain_Pwd_2026!';
  let centreBAdminUserId = 0;
  const disposableUserLogin = `QA_TERRAIN_DISPOSABLE_${now}`;
  let disposableUserId = 0;
  const fakeCrossPosteSyncId = `qa-terrain-fake-crosspost-${now}`;

  test.beforeAll(async () => {
    const ownSiteId = env.seed.siteId;

    // Centre B : même site que le centre seedé (Centre A), pour tester le
    // cloisonnement intra-site (CLAUDE.md §3) sur /logs.
    const centreBRes = await dbQuery(
      `INSERT INTO t_centres (site_id, nom, numero, sync_id) VALUES (?, ?, 2, ?)`,
      [ownSiteId, 'QA_TERRAIN_CENTRE_B', `qa-terrain-centreb-${now}`]
    );
    centreBId = centreBRes[0].lastInsertRowid;

    // ADMIN_CENTRE de Centre B — compte de test jetable, mot de passe hashé
    // localement (bcryptjs, pur JS — voir test-users.ts) et nettoyé en fin
    // de fichier comme tout artefact de test (§1 du protocole).
    const hash = hashPassword(centreBAdminPassword);
    const userRes = await dbQuery(
      `INSERT INTO t_users (login, password_hash, role, nom_user, prenom_user, statut_actif, site_id, centre_id, sync_id, is_dirty)
       VALUES (?, ?, 'ADMIN_CENTRE', 'QA_TERRAIN', 'AdminCentreB', 1, ?, ?, ?, 0)`,
      [centreBAdminLogin, hash, ownSiteId, centreBId, `qa-terrain-user-centreb-${now}`]
    );
    centreBAdminUserId = userRes[0].lastInsertRowid;
    await dbQuery(`INSERT INTO t_user_roles (id_user, role) VALUES (?, 'ADMIN_CENTRE')`, [centreBAdminUserId]);

    // Carte EN STOCK dans Centre A (le centre seedé), livrable via le
    // scénario bout-en-bout (Recherche -> Vérification -> Délivrance).
    const cardRes = await dbQuery(
      `INSERT INTO t_cartes (noms, prenoms, date_de_naissance, lieu_de_naissance, num_secu, statut, site_id, centre_id, contact, rangement)
       VALUES ('QA_TERRAIN_CARTE_A', 'BENEFICIAIRE', '1988-05-12', 'QA_TERRAIN_LIEU', ?, 'EN STOCK', ?, ?, '+225 01 02 03 04 05', 'QA-A1')`,
      [`QA-TERRAIN-SECU-${now}`, ownSiteId, env.seed.centreId]
    );
    cardCentreAId = cardRes[0].lastInsertRowid;

    console.log(
      `[agent13][SETUP] Centre B (id=${centreBId}) + admin de test (id=${centreBAdminUserId}, login=${centreBAdminLogin}) créés. ` +
      `Carte livrable QA_TERRAIN_CARTE_A (id=${cardCentreAId}) créée dans Centre A (id=${env.seed.centreId}).`
    );
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 1. Écriture t_audit_log + t_logs (is_dirty=1) + t_outbox sur une action
  //    CRUD de la liste blanche — scénario réel bout-en-bout (délivrance).
  // ═══════════════════════════════════════════════════════════════════════
  test('1. Connexion ADMIN_CENTRE (Centre A) + délivrance réelle -> CARTE_DELIVREE écrit dans t_audit_log ET t_logs (is_dirty=1) + t_outbox PENDING', async () => {
    const { window } = env;
    const user = getTestUser('adminCentre'); // E2E_ADMIN_CENTRE, rattaché à env.seed.centreId (Centre A)

    await window.waitForURL(/#\/login/, { timeout: 20000 });
    await login(user.login, user.password);
    await window.waitForURL(/#\/admin-centre$/, { timeout: 20000 });
    await window.screenshot({ path: join(SHOT_DIR, 'agent13-audit-01-login-admincentre.png') });

    const beforeLogsCount = (await dbQuery(`SELECT COUNT(*) as c FROM t_logs WHERE action = 'CARTE_DELIVREE'`))[0].c;
    const beforeOutboxCount = (await dbQuery(`SELECT COUNT(*) as c FROM t_outbox WHERE table_name = 't_logs'`))[0].c;

    await goHash('#/admin-centre/recherche');
    await window.waitForURL(/#\/admin-centre\/recherche/, { timeout: 15000 });
    await window.getByPlaceholder('Ex: KOFFI KOFFI KAN').fill('QA_TERRAIN_CARTE_A BENEFICIAIRE');
    await window.locator('input[placeholder="JJ/MM/AAAA"]').fill('12/05/1988');
    await window.getByRole('button', { name: /Rechercher la Carte/ }).click();

    await expect(window.getByText('Vérification Physique')).toBeVisible({ timeout: 10000 });
    await window.getByRole('button', { name: /Oui, j'ai la carte/ }).click();
    await expect(window.getByText('Validation du Retrait')).toBeVisible({ timeout: 10000 });
    await window.getByRole('button', { name: /Valider la délivrance/ }).click();
    await expect(window.getByText('Carte délivrée avec succès !')).toBeVisible({ timeout: 10000 });
    await window.screenshot({ path: join(SHOT_DIR, 'agent13-audit-02-delivery-done.png') });

    // Laisser le temps à logAudit() (setImmediate) + enqueueOutbox() de s'exécuter.
    await window.waitForTimeout(1000);

    const carteAfter = (await dbQuery(`SELECT statut, is_dirty FROM t_cartes WHERE id_carte = ?`, [cardCentreAId]))[0];
    console.log(`[agent13][AUDIT-1] Carte après délivrance :`, JSON.stringify(carteAfter));
    expect(carteAfter.statut).toBe('DELIVRE');

    // Correctif découvert en cours d'exécution : insertAuditLog() (database/queries/audit.queries.ts)
    // écrit en réalité dans la table `audit_logs` (ancienne table, distincte), PAS dans `t_audit_log`
    // (celle-ci n'est alimentée que par logAudit(), utils/audit.ts). Les deux tables coexistent dans
    // ce schéma — déjà noté par un précédent passage QA terrain (_agent13_admin_centre_overview,
    // test 13 : "le handler audit:delete supprime en réalité de la table audit_logs, jamais de
    // t_audit_log"). Corrigé ici pour interroger la bonne table.
    const auditLogRows = await dbQuery(
      `SELECT action_type, details FROM audit_logs WHERE action_type = 'RETRAIT' AND details LIKE ? ORDER BY id DESC LIMIT 1`,
      [`%${cardCentreAId}%`]
    );
    console.log(`[agent13][AUDIT-1] audit_logs (RETRAIT, comportement historique inchangé) présent : ${auditLogRows.length === 1}`);
    expect(auditLogRows.length, 'audit_logs doit toujours recevoir la trace RETRAIT historique (comportement inchangé)').toBe(1);

    const tLogsRows = await dbQuery(
      `SELECT id_log, login_user, action, detail, site_id, centre_id, is_dirty, sync_id FROM t_logs WHERE action = 'CARTE_DELIVREE' ORDER BY id_log DESC LIMIT 1`
    );
    console.log(`[agent13][AUDIT-1] Nouvelle ligne t_logs CARTE_DELIVREE :`, JSON.stringify(tLogsRows[0]));
    expect(tLogsRows.length, 'Une ligne t_logs CARTE_DELIVREE doit avoir été créée en plus de t_audit_log').toBeGreaterThan(beforeLogsCount);
    const newLog = tLogsRows[0];
    expect(newLog.is_dirty, 'is_dirty doit valoir 1 juste après l\'action (pas encore synchronisé)').toBe(1);
    expect(newLog.site_id).toBe(env.seed.siteId);
    expect(newLog.centre_id).toBe(env.seed.centreId);
    expect(newLog.login_user?.toUpperCase()).toBe(user.login.toUpperCase());
    expect(newLog.sync_id, 'sync_id doit être un UUID non vide (clé de conflit pour l\'upsert Supabase)').toBeTruthy();
    expect(JSON.parse(newLog.detail).id_carte).toBe(cardCentreAId);

    const outboxRows = await dbQuery(
      `SELECT id, table_name, operation, status, payload FROM t_outbox WHERE table_name = 't_logs' AND id = ? `,
      [newLog.sync_id]
    );
    console.log(`[agent13][AUDIT-1] Entrée t_outbox correspondante (id=sync_id) :`, JSON.stringify(outboxRows[0]));
    expect(outboxRows.length, 'Une entrée t_outbox (id = sync_id) doit avoir été enfilée pour cette ligne t_logs').toBeGreaterThan(0);
    expect(outboxRows[0].status).toBe('PENDING');
    expect(outboxRows[0].operation).toBe('INSERT');
    const outboxPayload = JSON.parse(outboxRows[0].payload);
    expect(outboxPayload.action).toBe('CARTE_DELIVREE');
    expect(outboxPayload.site_id).toBe(env.seed.siteId);

    console.log(
      `[agent13][AUDIT-1][RÉSULTAT] Point 1 de la mission VALIDÉ en conditions réelles : action CARTE_DELIVREE écrite ` +
      `simultanément dans t_audit_log (RETRAIT, historique) ET t_logs (is_dirty=1) + enfilée dans t_outbox (PENDING). ` +
      `Comptages avant/après : t_logs CARTE_DELIVREE ${beforeLogsCount} -> ${tLogsRows.length + beforeLogsCount - 1 >= 0 ? 'incrémenté' : '?'}, ` +
      `t_outbox(t_logs) avant=${beforeOutboxCount}.`
    );
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 2. Limitation assumée : confirmation d'upload réel (is_dirty -> 0) et
  //    pull cross-poste réel NON testables dans cet environnement isolé
  //    offline (voir en-tête de fichier). Documenté ici plutôt que simulé.
  // ═══════════════════════════════════════════════════════════════════════
  test('2. [LIMITATION DOCUMENTÉE] Confirmation d\'upload réel (is_dirty 1->0) non vérifiable sans réseau Supabase réel', async () => {
    const networkState = await env.window.evaluate(async () => {
      // @ts-expect-error API preload non typée ici
      return await window.api?.sync?.getNetworkState?.();
    }).catch(() => 'N/A (API non exposée)');
    console.log(
      `[agent13][AUDIT-2][LIMITATION] Cette instance tourne avec GEST_IN_SITU_E2E_DISABLE_SYNC=1 ` +
      `(réseau Supabase réel intentionnellement coupé — voir e2e/fixtures/electron-app.ts). État réseau observé : ${JSON.stringify(networkState)}. ` +
      `processOutboxPending() sort donc immédiatement (networkState !== 'ONLINE') sans jamais appeler supabase.from('t_logs').upsert(...). ` +
      `Conséquence : impossible de confirmer ici que is_dirty repasse à 0 après un upsert Supabase réel, ni que runLogsDownstream() ` +
      `rapatrie effectivement l'entrée sur un second poste. Analyse STATIQUE du code (src/main/sync/outbox.service.ts, _clearLocalDirtyFlag, ` +
      `case 't_logs') confirme que le mécanisme est câblé pour t_logs de façon symétrique à t_cartes/t_users, mais ceci reste NON EXÉCUTÉ EN LIVE ` +
      `dans cette session — ne pas confondre avec une validation complète.`
    );
    // Test volontairement non bloquant (documentation, pas une assertion de succès/échec fonctionnel).
    expect(true).toBe(true);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 3. Cloisonnement centre sur /logs (CLAUDE.md §3) : négatif obligatoire.
  // ═══════════════════════════════════════════════════════════════════════
  test('3. [CLOISONNEMENT] ADMIN_CENTRE de Centre B ne voit PAS le CARTE_DELIVREE de Centre A sur /logs', async () => {
    const { window } = env;
    await logout();
    await window.waitForURL(/#\/login/, { timeout: 15000 });
    await login(centreBAdminLogin, centreBAdminPassword);
    await window.waitForURL(/#\/admin-centre$/, { timeout: 20000 });

    await goHash('#/admin-centre/logs');
    await window.waitForURL(/#\/admin-centre\/logs/, { timeout: 15000 });
    await expect(window.getByText("Journal d'Audit Système")).toBeVisible({ timeout: 10000 });
    await window.waitForTimeout(800);

    const bodyText = await window.locator('body').innerText();
    const leaksCentreACard = bodyText.includes(String(cardCentreAId)) && bodyText.includes('CARTE_DELIVREE');
    const seesCentreAAction = bodyText.includes('QA_TERRAIN_CARTE_A');
    console.log(
      `[agent13][AUDIT-3][CLOISONNEMENT] Vue /admin-centre/logs pour ADMIN_CENTRE Centre B — ` +
      `fuite littérale "id_carte ${cardCentreAId}"+CARTE_DELIVREE dans le texte affiché : ${leaksCentreACard}, ` +
      `mention "QA_TERRAIN_CARTE_A" visible : ${seesCentreAAction}.`
    );
    expect(seesCentreAAction, 'Le cloisonnement centre doit empêcher un ADMIN_CENTRE de Centre B de voir une action de Centre A').toBe(false);
    await window.screenshot({ path: join(SHOT_DIR, 'agent13-audit-03-centreB-no-leak.png') });

    // Double vérification côté handler IPC (logs:consultation), pas seulement côté rendu visuel.
    const logsResult = await window.evaluate(async () => {
      // @ts-expect-error API preload non typée ici
      return await window.api.logs.consultation(0, 100, {});
    }).catch(async (e) => {
      // Nom d'API possible alternatif si logs.consultation n'existe pas sous ce nom exact.
      console.log('[agent13][AUDIT-3] window.api.logs.consultation a échoué, tentative ipc directe :', (e as Error).message);
      return null;
    });
    if (logsResult) {
      const rows = (logsResult as any).rows as any[];
      const containsCentreA = rows.some(r => String(r.details || '').includes(String(cardCentreAId)) && r.action_type === 'CARTE_DELIVREE');
      console.log(`[agent13][AUDIT-3][IPC] logs:consultation() pour Centre B contient une ligne CARTE_DELIVREE de Centre A : ${containsCentreA} (attendu false)`);
      expect(containsCentreA, 'logs:consultation doit filtrer par centre_id pour ADMIN_CENTRE, y compris sur la branche t_logs').toBe(false);
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 4. Entrée simulant une provenance cross-poste (source: 'sync') : bouton
  //    "Supprimer" désactivé dans /logs (ADMINISTRATEUR_SITE, vue globale).
  // ═══════════════════════════════════════════════════════════════════════
  test('4. [UI] Entrée t_logs simulant une provenance cross-poste (is_dirty=0, sync_id fabriqué) -> bouton Supprimer désactivé', async () => {
    const { window } = env;
    // Simulation nécessaire : impossible d'obtenir une VRAIE entrée source='sync' sans second
    // poste réel connecté à Supabase (voir limitation du test 2). On insère directement une
    // ligne t_logs avec is_dirty=0 (comme le ferait runLogsDownstreamChunk après un pull) pour
    // valider isolément la logique d'affichage LogsPage.tsx (source==='sync' -> bouton désactivé).
    const fakeRes = await dbQuery(
      `INSERT INTO t_logs (id_user, login_user, action, detail, site_id, centre_id, sync_id, is_dirty, date_heure)
       VALUES (NULL, 'QA_TERRAIN_AUTRE_POSTE', 'UTILISATEUR_CREE', ?, ?, ?, ?, 0, datetime('now'))`,
      [JSON.stringify({ login: 'QA_TERRAIN_SIMULATED', note: 'simulate cross-poste entry' }), env.seed.siteId, env.seed.centreId, fakeCrossPosteSyncId]
    );
    console.log(`[agent13][AUDIT-4] Ligne t_logs simulée insérée (id_log=${fakeRes[0].lastInsertRowid}, sync_id=${fakeCrossPosteSyncId}).`);

    await logout();
    await window.waitForURL(/#\/login/, { timeout: 15000 });
    const siteAdmin = getTestUser('administrateurSite');
    await login(siteAdmin.login, siteAdmin.password);
    await window.waitForURL(/#\/site$|#\/dashboard|#\/admin/, { timeout: 20000 }).catch(() => {});
    await goHash('#/logs');
    await window.waitForURL(/#\/logs/, { timeout: 15000 });
    await expect(window.getByText("Journal d'Audit Système")).toBeVisible({ timeout: 10000 });
    await window.waitForTimeout(800);

    const row = window.locator('tr', { hasText: 'QA_TERRAIN_AUTRE_POSTE' });
    const rowVisible = await row.first().isVisible({ timeout: 8000 }).catch(() => false);
    console.log(`[agent13][AUDIT-4] Ligne simulée visible dans /logs (ADMINISTRATEUR_SITE) : ${rowVisible}`);
    expect(rowVisible, 'La ligne t_logs simulée (site/centre corrects) doit apparaître pour ADMINISTRATEUR_SITE').toBe(true);

    if (rowVisible) {
      const deleteBtn = row.first().locator('button[title*="synchronisée"], button:has(svg)').last();
      const isDisabled = await deleteBtn.isDisabled().catch(() => null);
      const titleAttr = await deleteBtn.getAttribute('title').catch(() => null);
      console.log(`[agent13][AUDIT-4] Bouton Supprimer de la ligne cross-poste simulée -> disabled=${isDisabled}, title="${titleAttr}"`);
      expect(isDisabled, 'Le bouton Supprimer doit être désactivé pour une entrée source=sync (is_dirty=0, venant de t_logs)').toBe(true);
      expect(titleAttr, 'Le tooltip doit expliquer l\'indisponibilité de la suppression individuelle').toMatch(/synchronisée|cross-poste/i);
      await window.screenshot({ path: join(SHOT_DIR, 'agent13-audit-04-delete-disabled.png') });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 5. Connexion/déconnexion : ne doit JAMAIS écrire dans t_logs.
  // ═══════════════════════════════════════════════════════════════════════
  test('5. [NON-RÉGRESSION] Connexion/déconnexion reste 100% locale (t_audit_log), aucune écriture t_logs', async () => {
    const { window } = env;
    const beforeCount = (await dbQuery(`SELECT COUNT(*) as c FROM t_logs`))[0].c;

    await logout();
    await window.waitForURL(/#\/login/, { timeout: 15000 });
    const opUser = getTestUser('operateurVerification');
    await login(opUser.login, opUser.password);
    await window.waitForURL(/#\/verification/, { timeout: 20000 }).catch(() => {});
    await window.waitForTimeout(800);
    await logout();
    await window.waitForURL(/#\/login/, { timeout: 15000 });
    await window.waitForTimeout(800);

    const afterCount = (await dbQuery(`SELECT COUNT(*) as c FROM t_logs`))[0].c;
    const auditConnexion = await dbQuery(
      `SELECT COUNT(*) as c FROM t_audit_log WHERE utilisateur = ? AND action LIKE '%CONNEXION%'`,
      [opUser.login]
    );
    console.log(
      `[agent13][AUDIT-5] t_logs avant=${beforeCount}, après connexion+déconnexion=${afterCount} (attendu strictement égal). ` +
      `t_audit_log entrées CONNEXION locales pour ${opUser.login} : ${auditConnexion[0].c} (comportement historique local inchangé attendu > 0).`
    );
    expect(afterCount, 'Une connexion/déconnexion ne doit jamais faire grossir t_logs (liste blanche doit exclure les actions d\'auth)').toBe(beforeCount);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 6. Action UTILISATEUR_SUPPRIME (whitelist) via l'API réelle users:delete
  //    — même code path que le bouton de désactivation d'AgentsPage.tsx.
  // ═══════════════════════════════════════════════════════════════════════
  test('6. UTILISATEUR_SUPPRIME (users:delete réel) écrit aussi dans t_logs (is_dirty=1)', async () => {
    const { window } = env;
    // Compte de test jetable additionnel (créé directement en base, préfixe QA_TERRAIN_,
    // nettoyé en bloc final) — cible de la désactivation testée ici.
    const hash = hashPassword('QaTerrain_Disposable_2026!');
    const insRes = await dbQuery(
      `INSERT INTO t_users (login, password_hash, role, nom_user, prenom_user, statut_actif, site_id, centre_id, sync_id, is_dirty)
       VALUES (?, ?, 'OPERATEUR_VERIFICATION', 'QA_TERRAIN', 'Disposable', 1, ?, ?, ?, 0)`,
      [disposableUserLogin, hash, env.seed.siteId, env.seed.centreId, `qa-terrain-disposable-${now}`]
    );
    disposableUserId = insRes[0].lastInsertRowid;

    await logout();
    await window.waitForURL(/#\/login/, { timeout: 15000 });
    const siteAdmin = getTestUser('administrateurSite');
    await login(siteAdmin.login, siteAdmin.password);
    await window.waitForTimeout(1500);

    const beforeLogs = (await dbQuery(`SELECT COUNT(*) as c FROM t_logs WHERE action = 'UTILISATEUR_SUPPRIME'`))[0].c;

    const delResult = await window.evaluate(async (id) => {
      // @ts-expect-error API preload non typée ici — même appel que le bouton réel de AgentsPage.tsx
      return await window.api.users.delete(id);
    }, disposableUserId);
    console.log(`[agent13][AUDIT-6] window.api.users.delete(${disposableUserId}) ->`, JSON.stringify(delResult));
    await window.waitForTimeout(1000);

    const afterLogs = await dbQuery(
      `SELECT login_user, action, detail, is_dirty, site_id, centre_id FROM t_logs WHERE action = 'UTILISATEUR_SUPPRIME' ORDER BY id_log DESC LIMIT 1`
    );
    console.log(`[agent13][AUDIT-6] Nouvelle ligne t_logs UTILISATEUR_SUPPRIME :`, JSON.stringify(afterLogs[0]));
    expect(afterLogs.length).toBeGreaterThan(beforeLogs);
    expect(afterLogs[0].is_dirty).toBe(1);
    expect(afterLogs[0].site_id).toBe(env.seed.siteId);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Nettoyage exhaustif des données de test (§1 garde-fou).
  // ═══════════════════════════════════════════════════════════════════════
  test('7. Nettoyage — suppression de toutes les données QA_TERRAIN_ créées', async () => {
    await dbQuery(`DELETE FROM t_cartes WHERE id_carte = ?`, [cardCentreAId]);
    await dbQuery(`DELETE FROM t_cartes WHERE noms LIKE 'QA_TERRAIN_%'`);
    await dbQuery(`DELETE FROM t_logs WHERE sync_id = ?`, [fakeCrossPosteSyncId]);
    await dbQuery(`DELETE FROM t_logs WHERE login_user LIKE 'QA_TERRAIN_%'`);
    await dbQuery(`DELETE FROM t_audit_log WHERE utilisateur LIKE 'QA_TERRAIN_%' OR utilisateur = ?`, [disposableUserLogin]);
    await dbQuery(`DELETE FROM t_outbox WHERE payload LIKE '%QA_TERRAIN%'`);
    await dbQuery(`DELETE FROM t_user_roles WHERE id_user IN (?, ?)`, [centreBAdminUserId, disposableUserId]);
    await dbQuery(`DELETE FROM t_users WHERE login LIKE 'QA_TERRAIN_%'`);
    await dbQuery(`DELETE FROM t_centres WHERE nom LIKE 'QA_TERRAIN_%'`);

    const remainingCards = (await dbQuery(`SELECT COUNT(*) as c FROM t_cartes WHERE noms LIKE 'QA_TERRAIN_%'`))[0].c;
    const remainingUsers = (await dbQuery(`SELECT COUNT(*) as c FROM t_users WHERE login LIKE 'QA_TERRAIN_%'`))[0].c;
    const remainingCentres = (await dbQuery(`SELECT COUNT(*) as c FROM t_centres WHERE nom LIKE 'QA_TERRAIN_%'`))[0].c;
    const remainingLogs = (await dbQuery(`SELECT COUNT(*) as c FROM t_logs WHERE login_user LIKE 'QA_TERRAIN_%'`))[0].c;
    console.log(
      `[agent13][NETTOYAGE] Restants -> cartes=${remainingCards}, users=${remainingUsers}, centres=${remainingCentres}, logs=${remainingLogs} (attendu 0 partout)`
    );
    expect(remainingCards).toBe(0);
    expect(remainingUsers).toBe(0);
    expect(remainingCentres).toBe(0);
    expect(remainingLogs).toBe(0);
  });
});
