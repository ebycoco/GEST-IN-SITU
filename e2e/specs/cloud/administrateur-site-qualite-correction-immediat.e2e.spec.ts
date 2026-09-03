/**
 * e2e/specs/cloud/administrateur-site-qualite-correction-immediat.e2e.spec.ts
 *
 * Preuve terrain (agent-13) de la série de correctifs 092c9ad / b317ae1 /
 * 3f219a7 / c216646 (branche main), second chemin couvert — celui
 * explicitement signalé par l'utilisateur au départ de ce cycle : une
 * correction unitaire faite via le portail Qualité (rangement, date de
 * naissance...) restait bloquée en local sans jamais remonter automatiquement
 * vers Supabase, même avec une connexion internet active.
 *
 *   Chemin corrigé — `autoEnqueueCorrection()` (cartes.queries.ts:20-57),
 *   appelée par `updateQuickFields()` (cartes.queries.ts:1511-1571, ligne
 *   1569) elle-même appelée par le handler IPC `qualite:corrigerFormat`
 *   (handlers.ts:2572-2679, cas "simple carte" ligne 2657) : après l'UPDATE
 *   SQL + enqueueOutbox(), `autoEnqueueCorrection()` appelle désormais
 *   `scheduleOutboxProcessing(true)` (forceCards=true, cartes.queries.ts:52)
 *   au lieu de `scheduleOutboxProcessing()` — `processOutboxPending()`
 *   (outbox.service.ts:255) ignore alors le gating `_cardsAutoUpstreamEnabled`
 *   pour cette entrée précise, indépendamment du toggle "Envoi Automatique"
 *   de l'utilisateur connecté (désactivé par défaut pour ADMINISTRATEUR_SITE
 *   tant qu'aucune préférence explicite `t_config.auto_upstream_<id_user>`
 *   n'existe — même condition de reproduction que le 1er test de ce cycle).
 *
 * Scénario prouvé ici : ADMINISTRATEUR_SITE fraîchement seedé (donc SANS
 * ligne `t_config.auto_upstream_<id_user>` — condition de reproduction du
 * bug d'origine, vérifiée explicitement en étape 1) crée une carte
 * `ZZTEST_ADMINSITE_QUALITE` en stock, puis corrige unitairement son champ
 * `date_de_naissance` via l'IPC réel `qualite:corrigerFormat` -> l'entrée
 * t_outbox correspondante doit passer de PENDING à SYNCED SANS aucune action
 * manuelle (pas de clic sur un bouton d'envoi, pas d'appel à
 * `sync:startBulk`) -> la carte doit apparaître sur Supabase dev avec la
 * nouvelle `date_de_naissance`.
 *
 * Mutation choisie : `qualite:corrigerFormat` via
 * `window.api.qualite.corrigerFormat(payload)` (nom de méthode vérifié dans
 * src/preload/index.ts:358-359), appelée directement en IPC — verifyUserRole
 * (handlers.ts:2597) autorise explicitement ADMINISTRATEUR_SITE pour ce
 * canal, sans restriction de centre supplémentaire (seul le site_id est
 * comparé, handlers.ts:2613), cohérent avec le compte `siteOnly: true` de ce
 * rôle (e2e/fixtures/test-users.ts:73-81).
 *
 * Champ corrigé : `date_de_naissance` (whitelist CHAMPS_AUTORISES,
 * handlers.ts:2577 ; les deux champs cités par l'utilisateur au signalement
 * initial sont "rangement ou bien date de naissance" — `date_de_naissance`
 * est celui retenu ici, voir note ci-dessous) — valeur initiale
 * `1988-03-20`, valeur cible `1988-04-25` (format ISO, accepté par
 * isValidCalendarDateFlexible, validators.ts:26-52). Ce champ passe par
 * `queries.updateDateDeNaissance()` (cartes.queries.ts:1220-1289, branche
 * "simple carte" ligne 1283-1289) plutôt que par `updateQuickFields()`, mais
 * les deux convergent sur le même appel `autoEnqueueCorrection(id)` sous
 * test (ligne 1288 resp. 1569).
 *
 * NOTE IMPORTANTE (constat fait pendant l'écriture de ce spec, hors
 * périmètre des 4 commits testés) : le champ `rangement`, initialement
 * prévu pour ce test, a été écarté après découverte d'une corruption
 * préexistante et reproductible du shadow-table FTS5 `t_cartes_fts`
 * (indépendante du code sous test — voir rapport final de cette session).
 * `date_de_naissance` n'est pas une colonne suivie par le trigger FTS5
 * `trg_cartes_au` (schema.ts:1034, liste : noms, prenoms, num_secu, contact,
 * lieu_de_naissance, rangement — date_de_naissance en est absente), ce qui
 * permet de prouver le chemin `autoEnqueueCorrection()` sans dépendre de ce
 * bug distinct.
 *
 * Piège réutilisé directement (déjà résolu au 1er test de ce cycle, voir
 * administrateur-site-auto-upstream-immediat.e2e.spec.ts) : syncCurrentUserActiveStatus()
 * (downstream.ts:869) désactive localement tout compte TEST_USERS resté
 * connecté online >~10s, ce compte n'existant pas côté Supabase par
 * conception (seed-database.ts). Fix appliqué directement dans ce
 * beforeAll (pas d'itération ratée cette fois) : upsert d'une ligne t_users
 * cloud minimale pour E2E_ADMINISTRATEUR_SITE, avec le même sync_id que la
 * ligne locale, nettoyée symétriquement en afterAll.
 *
 * Comme les autres specs `allowRealSync: true` de ce dossier, ce fichier
 * n'est PAS destiné à tourner via `npm run test:e2e` (son hook
 * `pretest:e2e` reconstruirait `dist/`, sans effet sur ce test qui dépend de
 * `dist-e2e-cloud/`) — invocation ciblée uniquement :
 *   npx playwright test e2e/specs/cloud/administrateur-site-qualite-correction-immediat.e2e.spec.ts
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

test.describe.serial('[PREUVE] ADMINISTRATEUR_SITE — correction Qualité unitaire (qualite:corrigerFormat / autoEnqueueCorrection, champ date_de_naissance) -> envoi immédiat sans toggle "Envoi Automatique"', () => {
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

    // Fix fixture (déjà validé au 1er test de ce cycle, réutilisé directement) :
    // syncCurrentUserActiveStatus() désactiverait sinon E2E_ADMINISTRATEUR_SITE ~10s
    // après le login (compte introuvable côté Cloud), invalidant la session avant même
    // d'atteindre le code sous test. Scopé à CE spec (pas de modification de fixture
    // partagée, CLAUDE.md §4) : upsert d'une ligne t_users cloud minimale, même sync_id
    // que la ligne locale seedée.
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

    // Nettoyage de la ligne t_users cloud ajoutée en beforeAll — cleanupAllCloudTestData()
    // ne couvre que t_cartes/t_centres/t_sites (préfixe ZZTEST_), jamais t_users.
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

  test('2. Login ADMINISTRATEUR_SITE + réseau ONLINE réel + création carte ZZTEST EN STOCK + correction Qualité unitaire (date_de_naissance, IPC réel) -> t_outbox PENDING -> SYNCED sans action manuelle -> carte à jour sur Supabase dev', async () => {
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

    // Carte créée via le vrai chemin applicatif (cartes:create), statut EN STOCK avec
    // un rangement initial simple (R1) — évite toute seconde connexion SQLite pendant
    // que l'app allowRealSync tourne (corruption observée sinon dans les autres specs
    // de ce dossier).
    const created = await window.evaluate(
      async ({ siteId, centreId }) => {
        return (window as any).api.cartes.create({
          noms: 'ZZTEST_ADMINSITE_QUALITE',
          prenoms: 'DIABATE',
          date_de_naissance: '1988-03-20',
          rangement: 'R1',
          statut: 'EN STOCK',
          site_id: siteId,
          centre_id: centreId,
          contact: '0708091012',
          num_secu: 'ZZTEST-NUMSECU-QUALITE',
          agent_saisie: 'E2E_ADMINISTRATEUR_SITE'
        });
      },
      { siteId: mainSiteId, centreId: mainCentreId }
    );
    cardSyncId = created.sync_id;
    const cardId = created.id;
    console.log(`[PREUVE] Carte ZZTEST_ADMINSITE_QUALITE créée -> id_carte=${cardId} sync_id=${cardSyncId} date_de_naissance initiale=1988-03-20`);
    expect(Number(queryDb(dbPath, `SELECT COUNT(*) FROM t_cartes WHERE sync_id='${cardSyncId}';`))).toBe(1);

    const ddnBeforeCorrection = queryDb(dbPath, `SELECT date_de_naissance FROM t_cartes WHERE sync_id='${cardSyncId}';`);
    console.log(`[PREUVE] date_de_naissance locale AVANT correction Qualité -> "${ddnBeforeCorrection}" (attendu : 1988-03-20)`);
    expect(ddnBeforeCorrection).toBe('1988-03-20');

    // Confirme qu'aucune entrée t_outbox n'existe pour cette carte AVANT la correction testée
    // (la création via cartes:create n'enfile pas d'outbox — seul le chemin t_sync_queue/
    // upstream.ts gère l'INSERT initial, hors périmètre de ce correctif).
    const outboxBeforeCorrection = queryDb(dbPath, `SELECT COUNT(*) FROM t_outbox WHERE id='${cardSyncId}';`);
    console.log(`[PREUVE] Entrées t_outbox pour ce sync_id AVANT correction -> ${outboxBeforeCorrection} (attendu : 0)`);

    // ── Mutation testée : qualite:corrigerFormat via l'IPC réel, en direct (pas de clic UI) ──
    // Correspond exactement au chemin corrigé : handlers.ts:2572 -> updateDateDeNaissance()
    // (cartes.queries.ts:1220, cas "simple carte" lignes 1283-1289) -> autoEnqueueCorrection()
    // (cartes.queries.ts:20-57, enqueueOutbox() + scheduleOutboxProcessing(true)).
    const correctionResult = await window.evaluate(
      async ({ id }) => {
        return (window as any).api.qualite.corrigerFormat({
          id_carte: id,
          champ_corrige: 'date_de_naissance',
          valeur_avant: '1988-03-20',
          valeur_apres: '1988-04-25'
        });
      },
      { id: cardId }
    );
    console.log(`[PREUVE] Appel IPC qualite:corrigerFormat effectué (aucun clic UI, aucun bouton d'envoi manuel, aucun sync:startBulk) -> résultat=${JSON.stringify(correctionResult)}`);
    expect(correctionResult.success).toBe(true);
    expect(correctionResult.changes).toBe(1);

    const localStateAfterCorrection = queryDb(dbPath, `SELECT date_de_naissance, is_dirty FROM t_cartes WHERE sync_id='${cardSyncId}';`);
    console.log(`[PREUVE] État local après correction -> "${localStateAfterCorrection}" (attendu : 1988-04-25|1 juste après, is_dirty repassera à 0 une fois SYNCED)`);
    expect(localStateAfterCorrection.startsWith('1988-04-25|')).toBe(true);

    // ── Preuve centrale : SANS aucune action manuelle supplémentaire, l'entrée t_outbox
    // (id = sync_id de la carte, comme autoEnqueueCorrection() l'enfile) doit quitter
    // PENDING pour SYNCED — c'est exactement ce que scheduleOutboxProcessing(true) garantit
    // désormais, indépendamment du toggle "Envoi Automatique" désactivé par défaut pour ce
    // rôle (étape 1).
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

    const localStateAfterSync = queryDb(dbPath, `SELECT date_de_naissance, is_dirty FROM t_cartes WHERE sync_id='${cardSyncId}';`);
    console.log(`[PREUVE] État local après confirmation SYNCED -> "${localStateAfterSync}" (attendu : 1988-04-25|0, is_dirty remis à 0 par _clearLocalDirtyFlag)`);
    expect(localStateAfterSync).toBe('1988-04-25|0');

    // ── Preuve définitive côté cloud ──
    // Note : mapCardPayload() (payload-mapper.ts:28) renomme la colonne locale
    // date_de_naissance en date_naissance côté cloud (schéma Supabase distinct du
    // schéma local sur ce champ) — vérifié ici après un premier essai infructueux
    // sur le nom local.
    const cloudCard = await getCloudCardBySyncId(cardSyncId);
    console.log(`[PREUVE] Carte sur Supabase dev pour sync_id=${cardSyncId} -> ${cloudCard ? JSON.stringify({ date_naissance: cloudCard.date_naissance, statut: cloudCard.statut, id_site: cloudCard.id_site }) : 'ABSENTE (null)'}`);
    expect(cloudCard).not.toBeNull();
    expect(cloudCard.date_naissance).toBe('1988-04-25');
    expect(cloudCard.statut).toBe('EN STOCK');
    expect(Number(cloudCard.id_site)).toBe(mainSiteId);
  });
});
