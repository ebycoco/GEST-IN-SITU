/**
 * e2e/specs/_agent13_presence_cloisonnement_cloud.cloud.e2e.spec.ts
 *
 * QA Terrain (agent-13) — Test fonctionnel VIVANT contre le vrai projet
 * Supabase dev/staging (`allowRealSync: true`, build `dist-e2e-cloud/`,
 * `.env.e2e` — voir e2e/fixtures/electron-app.ts) de la fonctionnalité de
 * présence des agents :
 *   - handler IPC `presence:getAgents` (src/main/ipc/handlers.ts)
 *   - service `getAgentsPresence()` (src/main/sync/presence.service.ts)
 *   - page `AgentsPresencePage.tsx` (route `/agents/presence`)
 *
 * Objectif principal : revalider en conditions réelles le cloisonnement
 * site (commit 88d9070) — y compris le cas limite ADMINISTRATEUR_SITE avec
 * site_id orphelin (doit lever une erreur explicite au lieu de tout voir).
 *
 * Toutes les données cloud créées par ce fichier sont préfixées `ZZTEST_`
 * (t_sites.nom, t_centres.nom, t_users.login/nom_user) SAUF l'identité
 * mirror du test 5 qui réutilise volontairement le sync_id réel d'un
 * utilisateur local seedé par seed-database.ts (préfixe `e2e-user-`,
 * convention déjà établie par ce fichier) — nécessaire pour valider le vrai
 * chemin d'écriture recordPresenceLogin()/recordPresenceLogout() déclenché
 * par un LOGIN RÉEL, pas une donnée pré-positionnée. Toutes ces lignes sont
 * supprimées du projet Supabase dev en fin de fichier, avec re-vérification
 * explicite (aucune trace résiduelle tolérée).
 */
import { test, expect, type Page } from '@playwright/test';
import {
  launchSeededApp,
  teardownSeededApp,
  type E2EEnvironment
} from '../fixtures/electron-app';
import { getTestUser } from '../fixtures/test-users';
import { supabaseDev, ensureCloudSiteAndCentre } from '../fixtures/supabase-dev-client';
import { join } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const SHOT_DIR = join(__dirname, '..', '..', 'test-results', 'agent13-screenshots');
const NOW = Date.now();

test.describe.serial('QA Terrain CLOUD — Présence des Agents (/agents/presence) (agent-13)', () => {
  let env: E2EEnvironment;
  let anyTestFailed = false;

  // ── Identités cloud ZZTEST_ créées par ce fichier (nettoyées en afterAll) ──
  let siteBId: number;
  let centreBId: number;
  const cloudUserSyncIds: string[] = []; // pour cleanup t_user_presence + t_users
  let mirroredOperatorSyncId: string | null = null; // identité locale mirrorée (test 5)
  let userPresenceTableExists = true; // constaté dynamiquement au test 0 — cf. finding P0 rapport final

  test.beforeAll(async () => {
    env = await launchSeededApp({ allowRealSync: true });
  });

  test.afterAll(async () => {
    // ── Nettoyage cloud (avant fermeture app, sans dépendance à l'app) ──────
    const cleanupLog: string[] = [];
    try {
      if (cloudUserSyncIds.length > 0) {
        const { error: presErr } = await supabaseDev
          .from('t_user_presence')
          .delete()
          .in('user_sync_id', cloudUserSyncIds);
        cleanupLog.push(`t_user_presence delete in(${cloudUserSyncIds.length} sync_ids) error=${presErr?.message ?? 'none'}`);

        const { error: usersErr } = await supabaseDev
          .from('t_users')
          .delete()
          .in('sync_id', cloudUserSyncIds);
        cleanupLog.push(`t_users delete in(${cloudUserSyncIds.length} sync_ids) error=${usersErr?.message ?? 'none'}`);
      }
      if (mirroredOperatorSyncId) {
        await supabaseDev.from('t_user_presence').delete().eq('user_sync_id', mirroredOperatorSyncId);
        await supabaseDev.from('t_users').delete().eq('sync_id', mirroredOperatorSyncId);
        cleanupLog.push(`identité mirrorée ${mirroredOperatorSyncId} supprimée`);
      }
      // Sites/centres ZZTEST_ (couvre Site B + le site A upserté par ensureCloudSiteAndCentre).
      await supabaseDev.from('t_centres').delete().ilike('nom', 'ZZTEST_%');
      await supabaseDev.from('t_sites').delete().ilike('nom', 'ZZTEST_%');

      // Vérification finale résiduelle.
      const [usersLeft, presenceLeft, centresLeft, sitesLeft] = await Promise.all([
        supabaseDev.from('t_users').select('id_user', { count: 'exact', head: true }).ilike('login', 'ZZTEST_%'),
        supabaseDev.from('t_user_presence').select('user_sync_id', { count: 'exact', head: true }).ilike('login', 'ZZTEST_%'),
        supabaseDev.from('t_centres').select('id', { count: 'exact', head: true }).ilike('nom', 'ZZTEST_%'),
        supabaseDev.from('t_sites').select('id', { count: 'exact', head: true }).ilike('nom', 'ZZTEST_%')
      ]);
      console.log(
        `[agent13][CLOUD-CLEANUP] ${cleanupLog.join(' | ')} | résiduel: users=${usersLeft.count} presence=${presenceLeft.count} centres=${centresLeft.count} sites=${sitesLeft.count}`
      );
    } catch (err) {
      console.error('[agent13][CLOUD-CLEANUP] Échec du nettoyage cloud :', err);
    }

    if (env) {
      await teardownSeededApp(env, anyTestFailed);
    }
  });

  test.afterEach(async ({}, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus) {
      anyTestFailed = true;
    }
  });

  // ── Helpers ──────────────────────────────────────────────────────────────
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
    await window.getByRole('button', { name: 'Déconnexion' }).click();
    await window.waitForURL(/#\/login/, { timeout: 15000 });
  }

  async function gotoPresence(): Promise<void> {
    const { window } = env;
    await window.evaluate(() => { window.location.hash = '#/agents/presence'; });
    await window.waitForTimeout(800);
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

  async function getPresenceRowsViaApi(): Promise<any[]> {
    const { window } = env;
    return window.evaluate(async () => {
      try {
        return await (window as any).api.presence.getAgents();
      } catch (e: any) {
        return { __error__: e?.message || String(e) };
      }
    });
  }

  async function getPresenceTableLogins(): Promise<string[]> {
    const { window } = env;
    return window.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('.presence-table tbody tr'));
      return rows.map((r) => (r.querySelector('td:nth-child(2) div:nth-child(2)')?.textContent || '').trim());
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // SETUP DONNÉES CLOUD (avant tout login) — Site A = site local seedé,
  // Site B = site cloud-only distinct, pour caractériser le cloisonnement.
  // ═══════════════════════════════════════════════════════════════════════
  test('0. Préparation — attendre réseau ONLINE réel + pré-positionner les données cloud ZZTEST_', async () => {
    const online = await waitForRealNetworkOnline(60000);
    console.log(`[agent13][CLOUD] Réseau réel ONLINE atteint dans le harnais allowRealSync: ${online}`);
    expect(online, 'Le réseau réel doit atteindre ONLINE dans ce harnais e2e-cloud pour la suite du scénario').toBe(true);

    // Site A cloud = même id que le site local seedé (requis par la FK t_users.site_id).
    await ensureCloudSiteAndCentre(env.seed.siteId, env.seed.centreId);

    // Site B — cloud-only, jamais rattaché au site local. Id explicite très
    // au-delà de toute plage locale plausible (le site local seedé démarre
    // toujours à 1 sur une base temporaire fraîche) : `ensureCloudSiteAndCentre`
    // insère le Site A avec un id explicite SANS avancer la séquence BIGSERIAL
    // de t_sites (constat empirique : nextval() reste à 1 après un insert à id
    // explicite), donc un simple insert() sans id sur Site B entrait en
    // collision avec l'id du Site A. Id fixe et hors plage pour lever toute
    // ambiguïté, même style que le OTHER_SITE_ID=999999 déjà utilisé dans
    // _agent13_sync_status_dashboard.e2e.spec.ts.
    const SITE_B_ID = 9_000_001;
    const CENTRE_B_ID = 9_000_001;
    const { data: siteB, error: siteBErr } = await supabaseDev
      .from('t_sites')
      .upsert(
        {
          id: SITE_B_ID,
          nom: 'ZZTEST_QA_Terrain_Site_B_Cloud',
          code: `ZZTEST-QA-SITEB-${NOW}`,
          is_active: 1,
          max_centres: 4,
          is_permanent: true,
          sync_id: `zztest-qa-siteb-${NOW}`
        },
        { onConflict: 'id' }
      )
      .select()
      .single();
    expect(siteBErr, `Échec insertion Site B : ${siteBErr?.message}`).toBeNull();
    siteBId = siteB.id;

    const { data: centreB, error: centreBErr } = await supabaseDev
      .from('t_centres')
      .upsert(
        {
          id: CENTRE_B_ID,
          site_id: siteBId,
          nom: 'ZZTEST_QA_Terrain_Centre_B_Cloud',
          numero: 1,
          sync_id: `zztest-qa-centreb-${NOW}`
        },
        { onConflict: 'id' }
      )
      .select()
      .single();
    expect(centreBErr, `Échec insertion Centre B : ${centreBErr?.message}`).toBeNull();
    centreBId = centreB.id;

    // Agent ZZTEST_ Site A (ADMIN_CENTRE, rôle surveillé par la présence).
    const userA2SyncId = `zztest-qa-usera2-${NOW}`;
    const { error: userA2Err } = await supabaseDev.from('t_users').insert({
      login: 'ZZTEST_QA_ADMINCENTRE_A',
      password_hash: 'ZZTEST_NOT_A_REAL_HASH',
      role: 'ADMIN_CENTRE',
      nom_user: 'ZZTEST_QA',
      prenom_user: 'AdminCentreA',
      statut_actif: 1,
      site_id: env.seed.siteId,
      centre_id: env.seed.centreId,
      sync_id: userA2SyncId
    });
    expect(userA2Err, `Échec insertion user A2 : ${userA2Err?.message}`).toBeNull();
    cloudUserSyncIds.push(userA2SyncId);

    // Agent ZZTEST_ Site B (OPERATEUR_QUALITE).
    const userB1SyncId = `zztest-qa-userb1-${NOW}`;
    const { error: userB1Err } = await supabaseDev.from('t_users').insert({
      login: 'ZZTEST_QA_OPQUALITE_B',
      password_hash: 'ZZTEST_NOT_A_REAL_HASH',
      role: 'OPERATEUR_QUALITE',
      nom_user: 'ZZTEST_QA',
      prenom_user: 'OpQualiteB',
      statut_actif: 1,
      site_id: siteBId,
      centre_id: centreBId,
      sync_id: userB1SyncId
    });
    expect(userB1Err, `Échec insertion user B1 : ${userB1Err?.message}`).toBeNull();
    cloudUserSyncIds.push(userB1SyncId);

    // Présence "connectée récemment" pour les deux — NON BLOQUANT : constat
    // fait en pratique (voir rapport final, finding P0) que la table
    // `t_user_presence` définie dans supabase_schema.sql n'existe PAS sur ce
    // projet Supabase dev/staging (PGRST205 "Could not find the table
    // 'public.t_user_presence' in the schema cache"). C'est un constat
    // d'infrastructure hors périmètre QA (STOP & WARN, CLAUDE.md §4) — on ne
    // la crée pas nous-mêmes ici. On le détecte une seule fois puis on
    // continue le scénario de cloisonnement roster (t_users), qui lui ne
    // dépend pas de cette table (dégradation gracieuse déjà prévue par
    // getAgentsPresence() côté service).
    const nowIso = new Date().toISOString();
    for (const [syncId, login_, siteId, centreId, role] of [
      [userA2SyncId, 'ZZTEST_QA_ADMINCENTRE_A', env.seed.siteId, env.seed.centreId, 'ADMIN_CENTRE'],
      [userB1SyncId, 'ZZTEST_QA_OPQUALITE_B', siteBId, centreBId, 'OPERATEUR_QUALITE']
    ] as const) {
      const { error: presErr } = await supabaseDev.from('t_user_presence').insert({
        user_sync_id: syncId,
        login: login_,
        site_id: siteId,
        centre_id: centreId,
        role,
        last_heartbeat_at: nowIso,
        last_login_at: nowIso
      });
      if (presErr) {
        userPresenceTableExists = false;
        console.log(`[agent13][P0-FINDING] Insertion t_user_presence(${syncId}) impossible : ${presErr.message} (code=${(presErr as any).code})`);
      }
    }
    console.log(`[agent13][P0-FINDING] Table t_user_presence disponible sur le projet Supabase dev/staging = ${userPresenceTableExists}`);

    console.log(`[agent13][CLOUD] Site A (local) id=${env.seed.siteId} centre=${env.seed.centreId} | Site B (cloud-only) id=${siteBId} centre=${centreBId}`);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // TEST 1 — RBAC : OPERATEUR_VERIFICATION bloqué (route + handler IPC).
  // ═══════════════════════════════════════════════════════════════════════
  test('1. RBAC — OPERATEUR_VERIFICATION est bloqué sur /agents/presence (route ET handler IPC)', async () => {
    const { window } = env;
    const user = getTestUser('operateurVerification');

    await window.waitForURL(/#\/login/, { timeout: 20000 });
    await login(user.login, user.password);
    await window.waitForURL(/#\/agent-verification/, { timeout: 20000 });

    await gotoPresence();
    // ProtectedRoute doit rediriger vers "/" → RoleRedirect → /agent-verification.
    await window.waitForURL(/#\/agent-verification/, { timeout: 10000 });
    await expect(window.getByText('Présence des Agents')).toHaveCount(0);

    // Défense en profondeur : même en appelant directement l'API IPC exposée,
    // le handler doit refuser (verifyUserRole côté serveur, pas seulement la route UI).
    const apiResult = await getPresenceRowsViaApi();
    console.log(`[agent13][RBAC] Appel direct window.api.presence.getAgents() en tant qu'OPERATEUR_VERIFICATION → ${JSON.stringify(apiResult).slice(0, 200)}`);
    expect(Array.isArray(apiResult), 'Le handler IPC doit refuser (erreur), pas retourner un tableau, pour un rôle non autorisé').toBe(false);
    expect((apiResult as any).__error__).toMatch(/Accès refusé/);

    await window.screenshot({ path: join(SHOT_DIR, 'agent13-presence-01-operateur-blocked.png') });
    await logout();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // TEST 2 — ADMINISTRATEUR_SITE (Site A) : cloisonnement — voit A, pas B.
  // ═══════════════════════════════════════════════════════════════════════
  test('2. ADMINISTRATEUR_SITE (Site A) — cloisonnement site confirmé (A visible, B invisible)', async () => {
    const { window } = env;
    const user = getTestUser('administrateurSite');

    await window.waitForURL(/#\/login/, { timeout: 20000 });
    await login(user.login, user.password);
    await window.waitForURL(/#\/dashboard/, { timeout: 20000 });

    await gotoPresence();
    await window.waitForURL(/#\/agents\/presence/, { timeout: 10000 });
    await expect(window.getByRole('heading', { name: 'Présence des Agents' })).toBeVisible({ timeout: 10000 });

    // Laisse le premier chargement (loadPresence()) se terminer.
    await expect(window.locator('.presence-table').or(window.getByText('Aucun agent trouvé'))).toBeVisible({ timeout: 15000 });

    const rowsViaApi = await getPresenceRowsViaApi();
    expect(Array.isArray(rowsViaApi), `Réponse inattendue : ${JSON.stringify(rowsViaApi)}`).toBe(true);
    const logins = (rowsViaApi as any[]).map((r) => r.login);
    const siteIds = new Set((rowsViaApi as any[]).map((r) => r.site_id));

    console.log(`[agent13][CLOISONNEMENT][ADMINISTRATEUR_SITE] logins renvoyés par presence:getAgents() = ${JSON.stringify(logins)} ; site_id distincts = ${JSON.stringify([...siteIds])}`);

    const tableLogins = await getPresenceTableLogins();
    console.log(`[agent13][CLOISONNEMENT][ADMINISTRATEUR_SITE] logins affichés dans le tableau UI = ${JSON.stringify(tableLogins)}`);

    await window.screenshot({ path: join(SHOT_DIR, 'agent13-presence-02-administrateur-site.png') });

    // Cas nominal : l'agent du même site apparaît (pas de liste vide anormale).
    expect(logins).toContain('ZZTEST_QA_ADMINCENTRE_A');
    expect(tableLogins.some((l) => l.includes('ZZTEST_QA_ADMINCENTRE_A'))).toBe(true);

    // Cloisonnement : l'agent de l'autre site n'apparaît JAMAIS.
    expect(logins).not.toContain('ZZTEST_QA_OPQUALITE_B');
    expect(tableLogins.some((l) => l.includes('ZZTEST_QA_OPQUALITE_B'))).toBe(false);

    // Tous les site_id renvoyés doivent être le site A (aucune fuite).
    for (const sid of siteIds) {
      expect(sid).toBe(env.seed.siteId);
    }

    await logout();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // TEST 3 — SUPER ADMIN : vue globale non filtrée (A + B), + filtre site UI.
  // ═══════════════════════════════════════════════════════════════════════
  test('3. SUPER ADMIN — vue globale (A + B visibles) + filtre "Tous les sites" fonctionnel', async () => {
    const { window } = env;
    const user = getTestUser('superAdmin');

    await window.waitForURL(/#\/login/, { timeout: 20000 });
    await login(user.login, user.password);
    await window.waitForURL(/#\/dashboard/, { timeout: 20000 });

    await gotoPresence();
    await window.waitForURL(/#\/agents\/presence/, { timeout: 10000 });
    await expect(window.getByRole('heading', { name: 'Présence des Agents' })).toBeVisible({ timeout: 10000 });
    await expect(window.locator('.presence-table').or(window.getByText('Aucun agent trouvé'))).toBeVisible({ timeout: 15000 });

    const rowsViaApi = await getPresenceRowsViaApi();
    expect(Array.isArray(rowsViaApi), `Réponse inattendue : ${JSON.stringify(rowsViaApi)}`).toBe(true);
    const logins = (rowsViaApi as any[]).map((r) => r.login);
    console.log(`[agent13][SUPER-ADMIN] logins renvoyés (vue globale attendue) = ${JSON.stringify(logins)}`);

    await window.screenshot({ path: join(SHOT_DIR, 'agent13-presence-03-super-admin-global.png') });

    expect(logins).toContain('ZZTEST_QA_ADMINCENTRE_A');
    expect(logins).toContain('ZZTEST_QA_OPQUALITE_B');

    // Filtre UI "site" : sélection du Site A → seul A doit rester affiché côté écran.
    // ⚠️ Piège identifié empiriquement : `select` seul matche AUSSI le
    // sélecteur "CONTEXTE OPÉRATIONNEL" du Sidebar (`.site-select`, visible
    // pour tout SUPER ADMIN sur TOUTES les pages, cf. Sidebar.tsx ~ligne 222)
    // qui apparaît AVANT dans le DOM. `.first()` seul le capturait par erreur,
    // laissant croire à un filtre cassé alors que c'est un mauvais select ciblé
    // par le harnais. On exclut explicitement `.site-select` pour cibler le
    // vrai filtre de AgentsPresencePage.tsx (pas de classe dédiée sur celui-ci).
    const siteSelect = window.locator('select:not(.site-select)').first();
    if ((await siteSelect.count()) > 0) {
      await siteSelect.selectOption(String(env.seed.siteId));
      await window.waitForTimeout(300);
      const filteredLogins = await getPresenceTableLogins();
      console.log(`[agent13][SUPER-ADMIN] Après filtre UI "Site A" → logins affichés = ${JSON.stringify(filteredLogins)}`);
      expect(filteredLogins.some((l) => l.includes('ZZTEST_QA_ADMINCENTRE_A'))).toBe(true);
      expect(filteredLogins.some((l) => l.includes('ZZTEST_QA_OPQUALITE_B'))).toBe(false);

      await window.screenshot({ path: join(SHOT_DIR, 'agent13-presence-03b-super-admin-filtered.png') });
      await siteSelect.selectOption('ALL');
    } else {
      console.log('[agent13][SUPER-ADMIN] Sélecteur de site absent (sites.length probablement 0 côté hierarchy:getSites local) — filtre non testable dans ce harnais.');
    }

    await logout();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // TEST 4 — Chemin d'écriture RÉEL : login/logout d'un opérateur local
  // déclenche bien recordPresenceLogin/Logout() vers le vrai Supabase dev,
  // et l'agent apparaît "En ligne" côté ADMINISTRATEUR_SITE juste après.
  // ═══════════════════════════════════════════════════════════════════════
  test('4. Chemin d\'écriture réel — login local d\'un opérateur écrit dans t_user_presence (Supabase dev)', async () => {
    test.skip(
      !userPresenceTableExists,
      "[STOP & WARN] Table 'public.t_user_presence' absente du projet Supabase dev/staging " +
      "(PGRST205 constaté au test 0) — recordPresenceLogin()/recordPresenceLogout() échouent " +
      "silencieusement (catch interne, cf. D2 dans presence.service.ts), donc aucune écriture " +
      "n'est vérifiable ici. Création de la table hors périmètre QA (schéma BDD partagé, " +
      "CLAUDE.md §4) — consigné comme finding P0 dans le rapport final, pas de contournement."
    );
    const { window } = env;

    // Récupère l'identité réelle (sync_id) de l'opérateur seedé localement.
    const rows = await dbQuery(
      `SELECT sync_id, login, site_id, centre_id, role, nom_user, prenom_user FROM t_users WHERE login = 'E2E_OPERATEUR_VERIFICATION'`
    );
    expect(rows.length).toBe(1);
    const opUser = rows[0];
    mirroredOperatorSyncId = opUser.sync_id;

    // Mirror cloud : cet opérateur doit exister dans t_users côté cloud pour
    // que l'upsert t_user_presence (FK ON DELETE CASCADE sur t_users.sync_id)
    // ne soit pas rejeté silencieusement.
    const { error: mirrorErr } = await supabaseDev.from('t_users').insert({
      login: opUser.login,
      password_hash: 'ZZTEST_MIRROR_NOT_A_REAL_HASH',
      role: opUser.role,
      nom_user: opUser.nom_user,
      prenom_user: opUser.prenom_user,
      statut_actif: 1,
      site_id: opUser.site_id,
      centre_id: opUser.centre_id,
      sync_id: opUser.sync_id
    });
    expect(mirrorErr, `Échec mirroring cloud de l'opérateur local : ${mirrorErr?.message}`).toBeNull();

    // Aucune ligne de présence avant login.
    const before = await supabaseDev.from('t_user_presence').select('*').eq('user_sync_id', opUser.sync_id).maybeSingle();
    expect(before.data).toBeNull();

    const beforeLoginTime = Date.now();
    await window.waitForURL(/#\/login/, { timeout: 20000 });
    await login(getTestUser('operateurVerification').login, getTestUser('operateurVerification').password);
    await window.waitForURL(/#\/agent-verification/, { timeout: 20000 });

    // recordPresenceLogin() est fire-and-forget (setImmediate + appel réseau) :
    // on laisse une marge raisonnable avant de vérifier côté cloud.
    let presenceAfterLogin: any = null;
    for (let i = 0; i < 20; i++) {
      const res = await supabaseDev.from('t_user_presence').select('*').eq('user_sync_id', opUser.sync_id).maybeSingle();
      if (res.data) { presenceAfterLogin = res.data; break; }
      await window.waitForTimeout(1000);
    }

    console.log(`[agent13][WRITE-PATH] Ligne t_user_presence après login réel = ${JSON.stringify(presenceAfterLogin)}`);
    expect(presenceAfterLogin, 'recordPresenceLogin() aurait dû créer une ligne t_user_presence côté Supabase dev réel').not.toBeNull();
    expect(presenceAfterLogin.last_login_at).not.toBeNull();
    expect(new Date(presenceAfterLogin.last_login_at).getTime()).toBeGreaterThanOrEqual(beforeLoginTime - 5000);

    // Déconnexion → recordPresenceLogout() doit renseigner last_logout_at.
    await logout();
    let presenceAfterLogout: any = null;
    for (let i = 0; i < 20; i++) {
      const res = await supabaseDev.from('t_user_presence').select('*').eq('user_sync_id', opUser.sync_id).maybeSingle();
      if (res.data?.last_logout_at) { presenceAfterLogout = res.data; break; }
      await window.waitForTimeout(1000);
    }
    console.log(`[agent13][WRITE-PATH] Ligne t_user_presence après logout réel = ${JSON.stringify(presenceAfterLogout)}`);
    expect(presenceAfterLogout, 'recordPresenceLogout() aurait dû renseigner last_logout_at').not.toBeNull();

    // Re-login (pour un heartbeat frais), puis vérifie côté ADMINISTRATEUR_SITE
    // que cet agent RÉEL apparaît "En ligne" dans la page.
    await window.waitForURL(/#\/login/, { timeout: 20000 });
    await login(getTestUser('operateurVerification').login, getTestUser('operateurVerification').password);
    await window.waitForURL(/#\/agent-verification/, { timeout: 20000 });
    await window.waitForTimeout(3000); // laisse le nouveau heartbeat/login s'écrire
    await logout();

    await window.waitForURL(/#\/login/, { timeout: 20000 });
    await login(getTestUser('administrateurSite').login, getTestUser('administrateurSite').password);
    await window.waitForURL(/#\/dashboard/, { timeout: 20000 });
    await gotoPresence();
    await expect(window.getByRole('heading', { name: 'Présence des Agents' })).toBeVisible({ timeout: 10000 });
    await expect(window.locator('.presence-table').or(window.getByText('Aucun agent trouvé'))).toBeVisible({ timeout: 15000 });

    const tableLogins = await getPresenceTableLogins();
    console.log(`[agent13][WRITE-PATH] Après re-login, logins affichés côté ADMINISTRATEUR_SITE = ${JSON.stringify(tableLogins)}`);
    await window.screenshot({ path: join(SHOT_DIR, 'agent13-presence-04-real-operator-visible.png') });
    expect(tableLogins.some((l) => l.includes('E2E_OPERATEUR_VERIFICATION'))).toBe(true);

    await logout();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // TEST 5 — Cas limite : ADMINISTRATEUR_SITE avec site_id orphelin (NULL)
  // doit lever une erreur explicite, jamais retomber sur "tous les sites".
  // ═══════════════════════════════════════════════════════════════════════
  test('5. [CAS LIMITE] ADMINISTRATEUR_SITE avec site_id orphelin (NULL) — erreur explicite, pas de fuite "tous sites"', async () => {
    const { window } = env;

    // Simule un compte désynchronisé après suppression de site (site_id NULL en local).
    const upd = await dbQuery(`UPDATE t_users SET site_id = NULL WHERE login = 'E2E_ADMINISTRATEUR_SITE'`);
    expect(upd[0].changes).toBe(1);
    const check = await dbQuery(`SELECT site_id FROM t_users WHERE login = 'E2E_ADMINISTRATEUR_SITE'`);
    expect(check[0].site_id).toBeNull();

    await window.waitForURL(/#\/login/, { timeout: 20000 });
    await login(getTestUser('administrateurSite').login, getTestUser('administrateurSite').password);
    await window.waitForURL(/#\/dashboard/, { timeout: 20000 });

    await gotoPresence();
    await expect(window.getByRole('heading', { name: 'Présence des Agents' })).toBeVisible({ timeout: 10000 });

    const apiResult = await getPresenceRowsViaApi();
    console.log(`[agent13][CAS-LIMITE][site_id orphelin] Résultat window.api.presence.getAgents() = ${JSON.stringify(apiResult).slice(0, 300)}`);

    // Le handler doit lever une erreur explicite ("Session invalide : site_id
    // introuvable...") — jamais retourner silencieusement un tableau (qui
    // romprait le cloisonnement en tombant sur siteId=null = tous les sites).
    expect(Array.isArray(apiResult), 'Un site_id orphelin ne doit JAMAIS produire un tableau de résultats (risque de fuite tous-sites)').toBe(false);
    expect((apiResult as any).__error__).toMatch(/site_id introuvable/);

    // Vérifie aussi le comportement affiché à l'écran (pas un tableau rempli
    // silencieusement de tous les sites, mais un message d'erreur explicite
    // OU un état vide — jamais les agents du Site B, qui prouverait la fuite).
    const tableLogins = await getPresenceTableLogins();
    await window.screenshot({ path: join(SHOT_DIR, 'agent13-presence-05-orphan-site-id.png') });
    console.log(`[agent13][CAS-LIMITE][site_id orphelin] logins affichés à l'écran = ${JSON.stringify(tableLogins)}`);
    expect(tableLogins.some((l) => l.includes('ZZTEST_QA_OPQUALITE_B'))).toBe(false);

    await logout();

    // Restauration (par prudence, même si le userDataDir est jetable et détruit au teardown).
    await dbQuery(`UPDATE t_users SET site_id = ? WHERE login = 'E2E_ADMINISTRATEUR_SITE'`, [env.seed.siteId]);
  });
});
