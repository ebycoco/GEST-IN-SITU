/**
 * e2e/specs/cloud/administrateur-site-auto-upstream-immediat.e2e.spec.ts
 *
 * Preuve terrain (agent-13) de la série de correctifs 092c9ad / b317ae1 /
 * 3f219a7 / c216646 (branche main) :
 *
 *   Bug initial — une correction unitaire de carte (rangement, date de
 *   naissance, livraison, etc.) faite par un compte dont le rôle actif est
 *   ADMINISTRATEUR_SITE restait bloquée en local (`t_outbox` en PENDING)
 *   sans jamais remonter automatiquement vers Supabase, même avec une
 *   connexion internet active — car `sync:getAutoUpstream`/l'auth login
 *   (handlers.ts ~l.248 : `cardsAutoUpstreamEnabled = upstreamPref ?
 *   upstreamPref.value === 'true' : (user.role !== 'ADMINISTRATEUR_SITE')`)
 *   désactive par défaut le toggle "Envoi Automatique" pour ce rôle tant
 *   qu'aucune préférence explicite (`t_config.auto_upstream_<id_user>`)
 *   n'existe.
 *
 *   Correctif — `delivrerCarte()` (cartes.queries.ts:609, une des 10
 *   fonctions de mutation unitaire listées dans les 4 commits ci-dessus)
 *   appelle désormais `scheduleOutboxProcessing(true)` (forceCards=true) au
 *   lieu de `scheduleOutboxProcessing()` : `processOutboxPending()`
 *   (outbox.service.ts:255) ignore alors le gating
 *   `_cardsAutoUpstreamEnabled` pour cette entrée précise, indépendamment du
 *   toggle "Envoi Automatique" de l'utilisateur connecté.
 *
 * Scénario prouvé ici : ADMINISTRATEUR_SITE fraîchement seedé (donc SANS
 * ligne `t_config.auto_upstream_<id_user>` — condition de reproduction du
 * bug d'origine, vérifiée explicitement en étape 1) délivre une carte créée
 * pour l'occasion -> l'entrée t_outbox correspondante doit passer de PENDING
 * à SYNCED SANS aucune action manuelle (pas de clic sur un bouton d'envoi,
 * pas d'appel à `sync:startBulk`) -> la carte doit apparaître sur Supabase
 * dev avec `statut = 'DELIVRE'`.
 *
 * Mutation choisie : `delivrerCarte()` via `window.api.cartes.delivrer(id,
 * data)` (nom de méthode vérifié dans src/preload/index.ts:98-99), appelée
 * directement en IPC — la navigation UI du tableau de bord ADMINISTRATEUR_SITE
 * (route /dashboard, RoleRedirect.tsx:29-31) n'expose pas un parcours de
 * délivrance aussi direct que le portail Opérateur Vérification, et la
 * mission demande de choisir la mutation la plus simple à déclencher
 * fiablement pour ce rôle — `cartes:delivrer` accepte explicitement
 * ADMINISTRATEUR_SITE (handlers.ts:1426) et ne applique aucune restriction de
 * centre supplémentaire à ce rôle (cartes.queries.ts:636, restriction
 * centre_id réservée à OPERATEUR_VERIFICATION/ADMIN_CENTRE).
 *
 * Comme les autres specs `allowRealSync: true` de ce dossier, ce fichier
 * n'est PAS destiné à tourner via `npm run test:e2e` (son hook
 * `pretest:e2e` reconstruirait `dist/`, sans effet sur ce test qui dépend de
 * `dist-e2e-cloud/`) — invocation ciblée uniquement :
 *   npx playwright test e2e/specs/cloud/administrateur-site-auto-upstream-immediat.e2e.spec.ts
 * Build préalable : npx electron-vite build --mode e2e (jamais lancé
 * automatiquement par un agent — CLAUDE.md §1). Build déjà à jour au moment
 * de l'écriture de ce spec (dist-e2e-cloud/ du 2026-09-03, postérieur à
 * c216646) — ce spec ne le régénère jamais lui-même.
 */
import { test, expect } from '@playwright/test';
import { launchSeededApp, teardownSeededApp, type E2EEnvironment } from '../../fixtures/electron-app';
import { getTestUser } from '../../fixtures/test-users';
import { supabaseDev, ensureCloudSiteAndCentre, getCloudCardBySyncId, cleanupAllCloudTestData } from '../../fixtures/supabase-dev-client';
import { execFileSync } from 'child_process';
import { join } from 'path';

function dbPathOf(userDataDir: string): string {
  return join(userDataDir, 'data', 'gest_in_situ.db');
}

function queryDb(dbPath: string, sql: string): string {
  return execFileSync('sqlite3', [dbPath, sql], { encoding: 'utf-8' }).trim();
}

async function getNetworkState(window: import('@playwright/test').Page): Promise<string> {
  const status = await window.evaluate(() => (window as any).api.sync.getStatus());
  return status.state;
}

async function waitForNetworkOnline(
  window: import('@playwright/test').Page,
  timeoutMs: number
): Promise<{ state: string; elapsedMs: number }> {
  const start = Date.now();
  let state = await getNetworkState(window);
  while (state !== 'ONLINE' && Date.now() - start < timeoutMs) {
    await window.waitForTimeout(1500);
    state = await getNetworkState(window);
  }
  return { state, elapsedMs: Date.now() - start };
}

test.describe.serial('[PREUVE] ADMINISTRATEUR_SITE — mutation unitaire de carte (delivrerCarte) -> envoi immédiat sans toggle "Envoi Automatique"', () => {
  let env: E2EEnvironment;
  let dbPath: string;
  let mainSiteId: number;
  let mainCentreId: number;
  let adminSiteUserId: number;
  let cardSyncId: string;
  let anyTestFailed = false;

  test.beforeAll(async () => {
    env = await launchSeededApp({ allowRealSync: true });
    dbPath = dbPathOf(env.userDataDir);
    mainSiteId = env.seed.siteId;
    mainCentreId = env.seed.centreId;
    adminSiteUserId = env.seed.userIds['administrateurSite'];
    console.log(`[PREUVE][Setup] site=${mainSiteId} centre=${mainCentreId} adminSiteUserId=${adminSiteUserId}`);
    await ensureCloudSiteAndCentre(mainSiteId, mainCentreId);

    // ── Découverte empirique (run 1, agent-13) ──────────────────────────────
    // syncCurrentUserActiveStatus() (downstream.ts:869) tourne 10s après CHAQUE
    // login online (SyncEngine.startUserAccountsSyncTimer, USER_SYNC_INITIAL_DELAY_MS)
    // — mécanisme de sécurité TOUJOURS actif, totalement indépendant des 4 commits
    // testés ici : si le compte de session n'est PAS trouvé côté Cloud pour
    // (login, site_id), il est traité comme "supprimé/désactivé côté Cloud" et
    // désactivé localement (statut_actif=0), invalidant la session en cours. Les
    // comptes TEST_USERS (test-users.ts) sont seedés UNIQUEMENT en local, par
    // conception (seed-database.ts: "aucune synchronisation Supabase n'est
    // souhaitée ni possible dans ce contexte de test") — un run de ce spec sans
    // ce correctif de fixture voit donc son compte ADMINISTRATEUR_SITE auto-désactivé
    // ~10s après le login, avant même la mutation testée, ce qui fait échouer
    // cartes:delivrer sur "Accès refusé" AVANT d'atteindre le code sous test — un
    // faux négatif sans rapport avec le comportement de scheduleOutboxProcessing(true).
    // Fix scopé à CE spec uniquement (pas de modification de supabase-dev-client.ts
    // ni d'aucune fixture partagée, CLAUDE.md §4) : on pousse une ligne t_users
    // cloud minimale pour ce compte, avec EXACTEMENT le même sync_id que la ligne
    // locale seedée (ON CONFLICT(login) DO UPDATE de syncUsersFromCloud garde de
    // toute façon COALESCE(t_users.sync_id, excluded.sync_id) — le sync_id local
    // n'est jamais écrasé), pour rester idempotent avec tout pull ultérieur.
    const localAdminRow = queryDb(
      dbPath,
      `SELECT sync_id||'|'||password_hash FROM t_users WHERE login = 'E2E_ADMINISTRATEUR_SITE';`
    );
    const [adminSyncId, adminPasswordHash] = localAdminRow.split('|');
    console.log(`[PREUVE][Setup][Fix fixture] Ligne locale ADMINISTRATEUR_SITE -> sync_id=${adminSyncId}`);
    const { error: cloudUserErr } = await supabaseDev.from('t_users').upsert(
      {
        login: 'E2E_ADMINISTRATEUR_SITE',
        password_hash: adminPasswordHash,
        role: 'ADMINISTRATEUR_SITE',
        nom_user: 'E2E',
        prenom_user: 'AdminSite',
        statut_actif: 1,
        site_id: mainSiteId,
        centre_id: null,
        sync_id: adminSyncId
      },
      { onConflict: 'login' }
    );
    if (cloudUserErr) throw new Error(`[PREUVE][Setup] Échec upsert t_users cloud (login=E2E_ADMINISTRATEUR_SITE) : ${cloudUserErr.message}`);
    console.log('[PREUVE][Setup][Fix fixture] Ligne t_users cloud assurée pour E2E_ADMINISTRATEUR_SITE (empêche l\'auto-désactivation par syncCurrentUserActiveStatus).');
  });

  test.afterAll(async () => {
    if (env) {
      try {
        execFileSync('sqlite3', [dbPath, "DELETE FROM t_cartes WHERE noms LIKE 'ZZTEST_ADMINSITE_%';"], { encoding: 'utf-8' });
      } catch (e) {
        console.warn('[PREUVE] Nettoyage local ZZTEST_ADMINSITE_ échoué (non bloquant) :', e);
      }
      await teardownSeededApp(env, anyTestFailed);
    }

    // Nettoyage de la ligne t_users cloud ajoutée en beforeAll (fix fixture, voir
    // commentaire ci-dessus) — cleanupAllCloudTestData() ne couvre que t_cartes/
    // t_centres/t_sites (préfixe ZZTEST_), jamais t_users.
    const { error: cloudUserDeleteErr } = await supabaseDev.from('t_users').delete().eq('login', 'E2E_ADMINISTRATEUR_SITE');
    if (cloudUserDeleteErr) {
      console.warn('[PREUVE][NETTOYAGE FINAL] Échec suppression t_users cloud (E2E_ADMINISTRATEUR_SITE) :', cloudUserDeleteErr.message);
    }
    const { count: residualUsersCount } = await supabaseDev
      .from('t_users')
      .select('id_user', { count: 'exact', head: true })
      .eq('login', 'E2E_ADMINISTRATEUR_SITE');
    console.log(`[PREUVE][NETTOYAGE FINAL] Résidus t_users cloud (login=E2E_ADMINISTRATEUR_SITE) -> ${residualUsersCount ?? 'inconnu'} (attendu : 0)`);
    expect(residualUsersCount || 0).toBe(0);

    const residual = await cleanupAllCloudTestData();
    console.log(
      `[PREUVE][NETTOYAGE FINAL] Résidus ZZTEST_ après DELETE + re-SELECT -> ` +
      `cartes=${residual.residualCartes} centres=${residual.residualCentres} sites=${residual.residualSites} (attendu : 0/0/0)`
    );
    expect(residual.residualCartes).toBe(0);
    expect(residual.residualCentres).toBe(0);
    expect(residual.residualSites).toBe(0);
  });

  test.afterEach(async ({}, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus) anyTestFailed = true;
  });

  test('1. Précondition de reproduction : aucune ligne t_config auto_upstream_<id_user> pour ce compte ADMINISTRATEUR_SITE fraîchement seedé', async () => {
    const configRow = queryDb(
      dbPath,
      `SELECT * FROM t_config WHERE key = 'auto_upstream_${adminSiteUserId}';`
    );
    console.log(`[PREUVE][Précondition] SELECT * FROM t_config WHERE key = 'auto_upstream_${adminSiteUserId}' -> "${configRow}" (attendu : vide, aucune préférence explicite)`);
    expect(configRow).toBe('');
  });

  test('2. Login ADMINISTRATEUR_SITE + réseau ONLINE réel + création carte ZZTEST + délivrance directe (IPC) -> t_outbox PENDING -> SYNCED sans action manuelle -> carte DELIVRE sur Supabase dev', async () => {
    test.setTimeout(180_000);
    const { window } = env;
    const user = getTestUser('administrateurSite');

    await window.waitForURL(/#\/login/);
    await window.getByTestId('login-input').fill(user.login);
    await window.getByTestId('password-input').fill(user.password);
    await window.getByTestId('login-submit').click();
    await window.waitForURL(/#\/dashboard$/, { timeout: 15000 });
    console.log('[PREUVE] Login ADMINISTRATEUR_SITE réussi, redirigé vers /dashboard.');

    // Re-vérification post-login : le login (handlers.ts ~l.244-253) ne fait que LIRE
    // auto_upstream_<id_user> pour peupler le miroir en mémoire (SyncEngine) — il n'écrit
    // jamais de ligne t_config en son absence. La condition de reproduction reste donc
    // intacte après le login, avant toute mutation.
    const configRowAfterLogin = queryDb(
      dbPath,
      `SELECT * FROM t_config WHERE key = 'auto_upstream_${adminSiteUserId}';`
    );
    console.log(`[PREUVE][Post-login] t_config auto_upstream_${adminSiteUserId} -> "${configRowAfterLogin}" (attendu : toujours vide)`);
    expect(configRowAfterLogin).toBe('');

    const { state: networkStateBeforeAction, elapsedMs } = await waitForNetworkOnline(window, 90_000);
    console.log(`[PREUVE] Réseau réel atteint l'état "${networkStateBeforeAction}" après ${elapsedMs}ms d'attente (network-monitor.ts).`);
    expect(networkStateBeforeAction).toBe('ONLINE');

    // Carte créée via le vrai chemin applicatif (cartes:create), comme
    // delivrer-carte-outbox-repro.e2e.spec.ts : évite toute seconde connexion SQLite
    // pendant que l'app allowRealSync tourne (corruption observée sinon dans les autres
        // specs de ce dossier).
    const created = await window.evaluate(
      async ({ siteId, centreId }) => {
        return (window as any).api.cartes.create({
          noms: 'ZZTEST_ADMINSITE_AUTOUPSTREAM',
          prenoms: 'KOUAME',
          date_de_naissance: '1990-05-15',
          rangement: 'R-ADMINSITE-01',
          statut: 'EN STOCK',
          site_id: siteId,
          centre_id: centreId,
          contact: '0708091011',
          num_secu: 'ZZTEST-NUMSECU-ADMINSITE',
          agent_saisie: 'E2E_ADMINISTRATEUR_SITE'
        });
      },
      { siteId: mainSiteId, centreId: mainCentreId }
    );
    cardSyncId = created.sync_id;
    const cardId = created.id;
    console.log(`[PREUVE] Carte ZZTEST_ADMINSITE_AUTOUPSTREAM créée -> id_carte=${cardId} sync_id=${cardSyncId}`);
    expect(Number(queryDb(dbPath, `SELECT COUNT(*) FROM t_cartes WHERE sync_id='${cardSyncId}';`))).toBe(1);

    // Confirme qu'aucune entrée t_outbox n'existe pour cette carte AVANT la mutation testée
    // (la création via cartes:create n'enfile pas d'outbox — seul le chemin `t_sync_queue`/
    // upstream.ts gère l'INSERT initial, hors périmètre de ce correctif).
    const outboxBeforeDelivrance = queryDb(dbPath, `SELECT COUNT(*) FROM t_outbox WHERE id='${cardSyncId}';`);
    console.log(`[PREUVE] Entrées t_outbox pour ce sync_id AVANT délivrance -> ${outboxBeforeDelivrance} (attendu : 0)`);

    // ── Mutation testée : délivrerCarte() via l'IPC réel, en direct (pas de clic UI) ──
    // Correspond exactement au chemin corrigé par 3f219a7 (cartes.queries.ts:729-733 :
    // enqueueOutbox() + scheduleOutboxProcessing(true) dans delivrerCarte()).
    await window.evaluate(
      async ({ id }) => {
        return (window as any).api.cartes.delivrer(id, {
          nom_retirant: 'ZZTEST_RETIRANT_ADMINSITE',
          num_retirant: 'CNI-ZZTEST-ADMINSITE-0001',
          contact_retirant: '0708091011',
          type_retirant: 'ASSURE',
          agent_distributeur: 'E2E_ADMINISTRATEUR_SITE'
        });
      },
      { id: cardId }
    );
    console.log('[PREUVE] Appel IPC cartes:delivrer effectué (aucun clic UI, aucun bouton d\'envoi manuel, aucun sync:startBulk).');

    const localStateAfterDelivrance = queryDb(dbPath, `SELECT statut, is_dirty FROM t_cartes WHERE sync_id='${cardSyncId}';`);
    console.log(`[PREUVE] État local après délivrance -> "${localStateAfterDelivrance}" (attendu : DELIVRE|1 juste après, is_dirty repassera à 0 une fois SYNCED)`);
    expect(localStateAfterDelivrance.startsWith('DELIVRE|')).toBe(true);

    // ── Preuve centrale : SANS aucune action manuelle supplémentaire, l'entrée t_outbox
    // (id = sync_id de la carte, comme delivrerCarte() l'enfile) doit quitter PENDING pour
    // SYNCED — c'est exactement ce que scheduleOutboxProcessing(true) garantit désormais,
    // indépendamment du toggle "Envoi Automatique" désactivé par défaut pour ce rôle (étape 1).
    let outboxRow = '';
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      outboxRow = queryDb(dbPath, `SELECT status, error_msg FROM t_outbox WHERE id='${cardSyncId}';`);
      if (outboxRow && !outboxRow.startsWith('PENDING')) break;
      await window.waitForTimeout(2000);
    }
    console.log(`[PREUVE] Ligne t_outbox (id=sync_id=${cardSyncId}) après traitement -> "${outboxRow}" (attendu : commence par SYNCED, jamais PENDING ni ERROR)`);

    expect(outboxRow).not.toBe('');
    expect(outboxRow.startsWith('PENDING')).toBe(false);
    expect(outboxRow.startsWith('SYNCED')).toBe(true);

    const localStateAfterSync = queryDb(dbPath, `SELECT statut, is_dirty FROM t_cartes WHERE sync_id='${cardSyncId}';`);
    console.log(`[PREUVE] État local après confirmation SYNCED -> "${localStateAfterSync}" (attendu : DELIVRE|0, is_dirty remis à 0 par _clearLocalDirtyFlag)`);
    expect(localStateAfterSync).toBe('DELIVRE|0');

    // ── Preuve définitive côté cloud ──
    const cloudCard = await getCloudCardBySyncId(cardSyncId);
    console.log(`[PREUVE] Carte sur Supabase dev pour sync_id=${cardSyncId} -> ${cloudCard ? JSON.stringify({ statut: cloudCard.statut, id_site: cloudCard.id_site, nom_retirant: cloudCard.nom_retirant }) : 'ABSENTE (null)'}`);
    expect(cloudCard).not.toBeNull();
    expect(cloudCard.statut).toBe('DELIVRE');
    expect(cloudCard.nom_retirant).toBe('ZZTEST_RETIRANT_ADMINSITE');
    expect(Number(cloudCard.id_site)).toBe(mainSiteId);
  });
});
