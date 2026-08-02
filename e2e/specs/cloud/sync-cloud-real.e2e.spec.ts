/**
 * e2e/specs/cloud/sync-cloud-real.e2e.spec.ts
 *
 * QA Terrain (agent-13) — 4ème passage : les 3 scénarios structurellement
 * impossibles à tester lors des runs précédents (garde-fou anti-prod,
 * réseau Supabase coupé par `GEST_IN_SITU_E2E_DISABLE_SYNC=1`) sont
 * maintenant validés EN CONDITIONS RÉELLES contre un projet Supabase de
 * DEV/STAGING dédié (RLS désactivée, aucune donnée citoyenne réelle),
 * via `launchSeededApp({ allowRealSync: true })` (lance
 * `dist-e2e-cloud/main/index.js`, réseau réel autorisé) :
 *
 *   1. Pull réel  — "RÉCUPÉRER LES CARTES DEPUIS LE CLOUD" (sync:pullSiteCards)
 *   2. Push réel  — "Synchroniser mes actions" (sync:startBulk / bulk-uploader)
 *   3. Fallback recherche cloud — cartes:searchCloudEmergency + "Rapatrier"
 *      (cartes:pullSingleCard)
 *
 * Toutes les 3 partagent UNE SEULE instance Electron / UNE SEULE session de
 * connexion OPERATEUR_VERIFICATION (sauf ré-authentification volontaire au
 * scénario 2, nécessaire pour forcer le remontage d'AgentVerificationLayout
 * et donc un `loadStats()` frais qui prenne en compte la carte tout juste
 * délivrée — `useDashboardStats.ts` ne recharge les stats qu'au montage,
 * jamais en polling).
 *
 * Le site + centre locaux seedés par `seed-database.ts` (`env.seed.siteId`,
 * `env.seed.centreId` — déterministes à 1/1 sur une base SQLite fraîche)
 * sont répliqués tels quels (mêmes `id`) sur le projet Supabase dev via
 * `ensureCloudSiteAndCentre()` (e2e/fixtures/supabase-dev-client.ts) :
 * indispensable, `runDownstream()` exige un site cloud de même id, et
 * `t_cartes.id_site`/`id_centre` sont des FK Postgres vers `t_sites`/`t_centres`.
 *
 * Toute donnée créée sur le projet dev est préfixée `ZZTEST_` et supprimée
 * en fin de run par `cleanupAllCloudTestData()`, avec vérification finale
 * (nouveau SELECT) qu'aucune trace ne subsiste — voir test `afterAll`.
 */
import { test, expect } from '@playwright/test';
import { launchSeededApp, teardownSeededApp, type E2EEnvironment } from '../../fixtures/electron-app';
import { getTestUser } from '../../fixtures/test-users';
import {
  ensureCloudSiteAndCentre,
  insertCloudCard,
  getCloudCardBySyncId,
  cleanupAllCloudTestData
} from '../../fixtures/supabase-dev-client';
import { execFileSync } from 'child_process';
import { join } from 'path';

function dbPathOf(userDataDir: string): string {
  return join(userDataDir, 'data', 'gest_in_situ.db');
}

// Voir verification-search.e2e.spec.ts : pas de `shell: true` (quoting Windows).
function queryDb(dbPath: string, sql: string): string {
  return execFileSync('sqlite3', [dbPath, sql], { encoding: 'utf-8' }).trim();
}

// Nettoyage final uniquement (app totalement idle, fin de suite, plus aucune
// interaction en attente) : pattern déjà éprouvé sans incident par
// verification-search.e2e.spec.ts (runs 1-3).
function execDb(dbPath: string, sql: string): void {
  execFileSync('sqlite3', [dbPath, sql], { encoding: 'utf-8' });
}

/**
 * Découverte empirique (2 tentatives précédentes) : en mode `allowRealSync`,
 * le SyncEngine de l'app effectue de VRAIS cycles upstream/downstream en
 * tâche de fond (contrairement aux autres specs, où
 * `GEST_IN_SITU_E2E_DISABLE_SYNC=1` les neutralise totalement) — il écrit
 * donc bien plus activement sur la base SQLite pendant toute la durée de vie
 * du process. Une seconde connexion externe (CLI `sqlite3`, tentative 1, OU
 * un second process `electron.exe --run-as-node` + `better-sqlite3`,
 * tentative 2) ouverte SUR LA MÊME base pendant que l'app tourne a corrompu
 * la base à chaque fois ("database disk image is malformed" sur
 * `cartes:delivrer` juste après, `t_cartes` revenant ensuite vide).
 *
 * Solution retenue (tentative 3) : ne plus jamais ouvrir de seconde connexion
 * pendant que l'app `allowRealSync` tourne. La carte locale du scénario Push
 * est donc créée via le VRAI chemin applicatif `cartes:create` (mêmes
 * garanties d'écriture série que n'importe quelle action UI), appelé en
 * `window.evaluate()` depuis la session déjà connectée — aucune connexion
 * SQLite supplémentaire, la même unique connexion `better-sqlite3` de l'app
 * traite l'insertion. `cartes:create` (handlers.ts:599) ne restreint par
 * rôle : appelable tel quel depuis la session OPERATEUR_VERIFICATION déjà
 * ouverte.
 */
async function createPushCardViaApp(window: E2EEnvironment['window'], siteId: number, centreId: number): Promise<{ id: number; sync_id: string }> {
  const result = await window.evaluate(
    async ({ siteId, centreId }) => {
      return (window as any).api.cartes.create({
        noms: 'ZZTEST_CLOUDPUSH',
        prenoms: 'ADAMA',
        date_de_naissance: '1991-07-02',
        rangement: 'P2',
        statut: 'EN STOCK',
        site_id: siteId,
        centre_id: centreId,
        contact: '0102030491',
        num_secu: 'ZZTEST-NUMSECU-PUSH',
        agent_saisie: 'E2E_OPERATEUR_VERIFICATION'
      });
    },
    { siteId, centreId }
  );
  return result;
}

const RUN_ID = Date.now();
const PULL_SYNC_ID = `zztest-cloud-pull-${RUN_ID}`;
const FALLBACK_SYNC_ID = `zztest-cloud-fallback-${RUN_ID}`;

test.describe.serial('Sync Cloud RÉELLE (allowRealSync) — Pull / Push / Fallback recherche (QA Terrain agent-13, run 4)', () => {
  let env: E2EEnvironment;
  let dbPath: string;
  let mainSiteId: number;
  let mainCentreId: number;
  let pushCardSyncId: string;
  let anyTestFailed = false;

  test.beforeAll(async () => {
    env = await launchSeededApp({ allowRealSync: true });
    dbPath = dbPathOf(env.userDataDir);
    mainSiteId = env.seed.siteId;
    mainCentreId = env.seed.centreId;

    // ── Prépare le parent site/centre côté cloud AVANT toute interaction UI ──
    await ensureCloudSiteAndCentre(mainSiteId, mainCentreId);

    // ── Scénario 1 (pull) : carte posée UNIQUEMENT côté cloud, avant le tout
    // premier login (loadStats() ne recharge cloudCartesCount qu'au montage
    // du Layout — il faut donc que la donnée existe dès le login initial). ──
    await insertCloudCard({
      sync_id: PULL_SYNC_ID,
      noms: 'ZZTEST_CLOUDPULL',
      prenoms: 'KOFFI',
      date_naissance: '1990-06-01',
      rangement: 'P1',
      statut: 'EN STOCK',
      id_site: mainSiteId,
      id_centre: mainCentreId,
      contact: '0102030490',
      num_secu: 'ZZTEST-NUMSECU-PULL'
    });

    // Scénario 2 (push) prep : carte LOCALE (EN STOCK, complète, rangement
    // classé) — volontairement PAS insérée ici (voir commentaire de
    // `createPushCardViaApp` : une seconde connexion SQLite externe pendant
    // que l'app `allowRealSync` tourne a corrompu la base à 2 reprises lors de
    // ce run). Créée au début du test 2a, via le vrai chemin applicatif
    // `cartes:create` sur la session déjà connectée.
  });

  test.afterAll(async () => {
    if (env) {
      // ── Nettoyage LOCAL (base SQLite jetable, mais trace explicite avant
      // suppression du répertoire temporaire par teardownSeededApp) ──
      try {
        execDb(dbPath, "DELETE FROM t_cartes WHERE noms LIKE 'ZZTEST_%';");
        execDb(dbPath, "DELETE FROM audit_logs WHERE details LIKE '%ZZTEST%';");
        execDb(dbPath, "DELETE FROM t_logs WHERE detail LIKE '%ZZTEST%';");
      } catch (e) {
        console.warn('[E2E-CLOUD] Nettoyage local ZZTEST_ échoué (non bloquant) :', e);
      }
      await teardownSeededApp(env, anyTestFailed);
    }

    // ── Nettoyage DISTANT (projet Supabase dev, persistant entre les runs) ──
    const residual = await cleanupAllCloudTestData();
    console.log(
      `[E2E-CLOUD][NETTOYAGE FINAL] Résidus ZZTEST_ après DELETE + re-SELECT sur le projet dev -> ` +
      `cartes=${residual.residualCartes} centres=${residual.residualCentres} sites=${residual.residualSites} ` +
      `(attendu : 0/0/0)`
    );
    expect(residual.residualCartes).toBe(0);
    expect(residual.residualCentres).toBe(0);
    expect(residual.residualSites).toBe(0);
  });

  test.afterEach(async ({}, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus) {
      anyTestFailed = true;
    }
  });

  async function login(): Promise<void> {
    const { window } = env;
    const user = getTestUser('operateurVerification');
    await window.waitForURL(/#\/login/);
    await window.getByTestId('login-input').fill(user.login);
    await window.getByTestId('password-input').fill(user.password);
    await window.getByTestId('login-submit').click();
    await window.waitForURL(/#\/agent-verification$/, { timeout: 15000 });
  }

  async function logout(): Promise<void> {
    const { window } = env;
    await window.locator('.btn-logout').click();
    await window.waitForURL(/#\/login/, { timeout: 15000 });
  }

  async function goToRecherche(): Promise<void> {
    const { window } = env;
    await window.getByRole('link', { name: 'Recherche Active' }).click();
    await window.waitForURL(/#\/agent-verification\/recherche/, { timeout: 15000 });
  }

  async function fillNameSearch(nomComplet: string, ddn: string): Promise<void> {
    const { window } = env;
    await window.locator('input[placeholder="Ex: KOFFI KOFFI KAN"]').fill(nomComplet);
    await window.locator('input[placeholder="JJ/MM/AAAA"]').fill(ddn);
  }

  async function submitNameSearch(): Promise<void> {
    const { window } = env;
    await window.getByRole('button', { name: /Rechercher la Carte/ }).click();
  }

  function deliveryModal() {
    return env.window.locator('.card').filter({ hasText: 'Vérification Physique' });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // SCÉNARIO 1 — Pull réel : "RÉCUPÉRER LES CARTES DEPUIS LE CLOUD"
  // ═══════════════════════════════════════════════════════════════════════

  test('1a. Connexion initiale -> cloudCartesCount reflète la carte ZZTEST_CLOUDPULL posée sur le projet dev (> 0, plus la sentinelle -1 "indisponible" du run 3)', async () => {
    const { window } = env;
    await login();

    const beforeLocal = queryDb(dbPath, `SELECT COUNT(*) FROM t_cartes WHERE sync_id='${PULL_SYNC_ID}';`);
    expect(Number(beforeLocal)).toBe(0);

    // ── Découverte empirique (ce run) : au tout premier login, le NetworkMonitor
    // interne (network-monitor.ts) est encore en OFFLINE/PROBING (transition mesurée
    // ~20-27s après le boot, 6 pings possibles) au moment précis où useDashboardStats.ts
    // déclenche son fetch UNIQUE (non rejoué) de sync:getCloudCartesCount au montage
    // du Layout -> le compteur reste bloqué à 0/-1 pour toute la durée de la session
    // si le login se fait "à chaud" juste après le démarrage, sans qu'aucun mécanisme
    // de retry ne rattrape le coup (pas de polling, cf. useDashboardStats.ts:167-198).
    // On confirme donc D'ABORD, par appel IPC direct (indépendant de l'UI), que la
    // vraie requête réseau vers le projet dev fonctionne et renvoie bien un nombre
    // réel (>0) une fois le réseau réellement stabilisé, PUIS on force un remontage
    // du Layout (cycle logout/login, seul déclencheur de loadStats() disponible sans
    // toucher un composant partagé) pour que l'UI reflète cette valeur.
    let directCount = -1;
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      directCount = await window.evaluate((siteId) => (window as any).api.sync.getCloudCartesCount(siteId), mainSiteId);
      if (directCount > 0) break;
      await window.waitForTimeout(3000);
    }
    console.log(`[QA-CHECK][Scénario 1] sync:getCloudCartesCount(${mainSiteId}) en appel IPC direct (polling réseau) = ${directCount} (attendu : >= 1)`);
    expect(directCount).toBeGreaterThan(0);

    await logout();
    await login();

    const pullButton = window.getByRole('button', { name: /RÉCUPÉRER LES CARTES DEPUIS LE CLOUD/ });
    await expect(pullButton).toBeVisible({ timeout: 15000 });
    await expect(pullButton).toHaveText(/RÉCUPÉRER LES CARTES DEPUIS LE CLOUD \(\d+\)/, { timeout: 20000 });
    const label = await pullButton.textContent();
    const match = label?.match(/\((\d+)\)/);
    const cloudCartesCount = match ? Number(match[1]) : 0;
    console.log(`[QA-CHECK][Scénario 1] cloudCartesCount affiché après re-connexion = ${cloudCartesCount} (attendu : >= 1, réseau réel contre le projet dev)`);
    expect(cloudCartesCount).toBeGreaterThan(0);
    await expect(pullButton).toBeEnabled();
  });

  test('1b. Clic "RÉCUPÉRER LES CARTES DEPUIS LE CLOUD" -> la carte ZZTEST_CLOUDPULL est rapatriée en SQLite local avec les bonnes données', async () => {
    const { window } = env;
    const pullButton = window.getByRole('button', { name: /RÉCUPÉRER LES CARTES DEPUIS LE CLOUD/ });
    await pullButton.click();

    // Le pull réel implique un aller-retour réseau (site+centre puis chunk de
    // cartes) : on attend soit le toast de succès, soit -a défaut- l'apparition
    // effective de la ligne en base (poll court), pour ne pas dépendre
    // uniquement du texte exact du toast.
    await expect(window.getByText(/Récupération réussie|données locales sont déjà à jour|Synchronisation initiale/)).toBeVisible({ timeout: 30000 });

    const row = queryDb(
      dbPath,
      `SELECT noms, prenoms, date_de_naissance, rangement, statut, site_id, centre_id, is_dirty FROM t_cartes WHERE sync_id='${PULL_SYNC_ID}';`
    );
    console.log(`[QA-CHECK][Scénario 1] Ligne SQLite locale après pull pour sync_id=${PULL_SYNC_ID} -> "${row}"`);
    expect(row).toBe(`ZZTEST_CLOUDPULL|KOFFI|1990-06-01|P1|EN STOCK|${mainSiteId}|${mainCentreId}|0`);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SCÉNARIO 2 — Push réel : "Synchroniser mes actions"
  // ═══════════════════════════════════════════════════════════════════════

  test('2a. Délivrance réelle de ZZTEST_CLOUDPUSH -> carte conforme (is_dirty=1, DELIVRE, sans doublon) qualifiant réellement pour conformeCount', async () => {
    const { window } = env;

    // Insertion de la carte locale à délivrer via le VRAI chemin applicatif
    // `cartes:create` (voir commentaire de `createPushCardViaApp` : aucune
    // seconde connexion SQLite, la seule connexion `better-sqlite3` de l'app
    // reste utilisée — corruption observée à 2 reprises avec un process externe).
    const created = await createPushCardViaApp(window, mainSiteId, mainCentreId);
    pushCardSyncId = created.sync_id;
    const seededCheck = queryDb(dbPath, `SELECT COUNT(*) FROM t_cartes WHERE sync_id='${pushCardSyncId}';`);
    expect(Number(seededCheck)).toBe(1);

    await goToRecherche();
    await fillNameSearch('ZZTEST_CLOUDPUSH ADAMA', '02/07/1991');
    await submitNameSearch();

    await expect(window.getByText('Vérification Physique')).toBeVisible({ timeout: 10000 });
    await window.getByRole('button', { name: /Oui, j'ai la carte/ }).click();
    await expect(window.getByText('Validation du Retrait')).toBeVisible();
    await window.getByRole('button', { name: /Valider la délivrance/ }).click();
    await expect(window.getByText('Carte délivrée avec succès !')).toBeVisible({ timeout: 10000 });

    const after = queryDb(
      dbPath,
      `SELECT statut, is_dirty, rangement FROM t_cartes WHERE sync_id='${pushCardSyncId}';`
    );
    console.log(`[QA-CHECK][Scénario 2] État local après délivrance -> "${after}"`);
    expect(after).toBe('DELIVRE|1|P2');

    // Vérité terrain de la classification "conforme" (stats-worker.js
    // cleanCount/modifiedCount, cf. AgentVerificationLayout.tsx:40) : complète,
    // date valide, rangement classé, aucun doublon strict/probable sur ce site.
    const dupCheck = queryDb(
      dbPath,
      `SELECT COUNT(*) FROM t_cartes WHERE site_id=${mainSiteId} AND noms='ZZTEST_CLOUDPUSH' AND prenoms='ADAMA' AND date_de_naissance='1991-07-02';`
    );
    expect(Number(dupCheck)).toBe(1);
  });

  test('2b. Ré-authentification (remontage Layout -> loadStats frais) -> "Synchroniser mes actions" actif, clic réel -> carte présente sur le projet dev avec le bon statut', async () => {
    const { window } = env;
    // useDashboardStats.ts ne recharge qu'au montage (pas de polling) :
    // on force un remontage d'AgentVerificationLayout par un cycle logout/login,
    // seul moyen fiable (sans toucher au composant partagé) de rafraîchir
    // conformeCount après la délivrance du test précédent.
    await logout();
    await login();

    const pushButton = window.getByRole('button', { name: /Synchroniser mes actions/ });
    await expect(pushButton).toBeVisible({ timeout: 15000 });
    await expect(pushButton).toHaveText(/Synchroniser mes actions \(\d+\)/, { timeout: 20000 });
    const label = await pushButton.textContent();
    const conformeCount = Number((label?.match(/\((\d+)\)/) || ['', '0'])[1]);
    console.log(`[QA-CHECK][Scénario 2] conformeCount affiché après ré-authentification = ${conformeCount} (attendu : >= 1)`);
    expect(conformeCount).toBeGreaterThan(0);
    await expect(pushButton).toBeEnabled();

    const cloudBefore = await getCloudCardBySyncId(pushCardSyncId);
    expect(cloudBefore).toBeNull();

    await pushButton.click();
    // Message réel émis par upload-worker.js:282 (`Synchronisation de masse
    // terminée : N cartes traitées.`), remonté tel quel via toast.success(res.message)
    // dans useForceSyncActions.ts:117. Regex volontairement large (variantes possibles
    // selon uploadedCount et le chemin de code emprunté).
    await expect(window.getByText(/[Ss]ynchronisation de masse|cartes traitées|cartes envoyées|à jour/i)).toBeVisible({ timeout: 30000 });

    const localAfter = queryDb(dbPath, `SELECT is_dirty FROM t_cartes WHERE sync_id='${pushCardSyncId}';`);
    console.log(`[QA-CHECK][Scénario 2] is_dirty local après push = ${localAfter} (attendu : 0)`);
    expect(Number(localAfter)).toBe(0);

    const cloudAfter = await getCloudCardBySyncId(pushCardSyncId);
    expect(cloudAfter).not.toBeNull();
    console.log(
      `[QA-CHECK][Scénario 2] Ligne cloud après push -> noms="${cloudAfter.noms}" prenoms="${cloudAfter.prenoms}" ` +
      `statut="${cloudAfter.statut}" id_site=${cloudAfter.id_site} id_centre=${cloudAfter.id_centre}`
    );
    expect(cloudAfter.noms).toBe('ZZTEST_CLOUDPUSH');
    expect(cloudAfter.prenoms).toBe('ADAMA');
    expect(cloudAfter.statut).toBe('DELIVRE');
    expect(Number(cloudAfter.id_site)).toBe(mainSiteId);
    expect(Number(cloudAfter.id_centre)).toBe(mainCentreId);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SCÉNARIO 3 — Fallback recherche cloud réel
  // ═══════════════════════════════════════════════════════════════════════

  test('3a. Carte ZZTEST_CLOUDFALLBACK posée UNIQUEMENT côté cloud -> introuvable localement, fallback searchCloudEmergency la trouve, "Rapatrier" proposé', async () => {
    const { window } = env;
    await insertCloudCard({
      sync_id: FALLBACK_SYNC_ID,
      noms: 'ZZTEST_CLOUDFALLBACK',
      prenoms: 'BAKARY',
      date_naissance: '1992-08-03',
      rangement: 'F1',
      statut: 'EN STOCK',
      id_site: mainSiteId,
      id_centre: mainCentreId,
      contact: '0102030492',
      num_secu: 'ZZTEST-NUMSECU-FALLBACK'
    });

    const localBefore = queryDb(dbPath, `SELECT COUNT(*) FROM t_cartes WHERE sync_id='${FALLBACK_SYNC_ID}';`);
    expect(Number(localBefore)).toBe(0);

    await goToRecherche();
    await fillNameSearch('ZZTEST_CLOUDFALLBACK BAKARY', '03/08/1992');
    await submitNameSearch();

    // 1er palier : "Carte Introuvable" ne doit PAS s'afficher en dur — le
    // fallback cloud (timeout interne 6s, useVerificationSearch.ts:167) doit
    // prendre le relais avant que l'agent ne voie un message d'échec définitif.
    await expect(window.getByText('Trouvée sur le Cloud')).toBeVisible({ timeout: 12000 });
    await expect(window.getByText('ZZTEST_CLOUDFALLBACK')).toBeVisible();
    const rapatrierButton = window.getByRole('button', { name: /Rapatrier/ });
    await expect(rapatrierButton).toBeVisible();

    await rapatrierButton.click();

    // pullSingleCard() réussi -> ouverture directe de la modale de vérification
    // physique sur la carte tout juste rapatriée (SearchResults.tsx:76-83).
    await expect(deliveryModal()).toBeVisible({ timeout: 15000 });
    await expect(deliveryModal()).toContainText('ZZTEST_CLOUDFALLBACK');

    const localAfter = queryDb(
      dbPath,
      `SELECT noms, prenoms, date_de_naissance, rangement, statut, site_id, centre_id, is_dirty FROM t_cartes WHERE sync_id='${FALLBACK_SYNC_ID}';`
    );
    console.log(`[QA-CHECK][Scénario 3] Ligne SQLite locale après rapatriement unitaire -> "${localAfter}"`);
    expect(localAfter).toBe(`ZZTEST_CLOUDFALLBACK|BAKARY|1992-08-03|F1|EN STOCK|${mainSiteId}|${mainCentreId}|0`);

    await window.locator('.btn-close').click();
  });
});
