/**
 * e2e/specs/cloud/cloud-counter-reset-fix.e2e.spec.ts
 *
 * QA Terrain (agent-13) — Vérification vivante du correctif du compteur
 * "Télécharger N cartes depuis le Cloud" (bouton "RÉCUPÉRER LES CARTES
 * DEPUIS LE CLOUD") qui ne redescendait jamais à 0 après un téléchargement
 * complet réussi.
 *
 * Rappel du correctif audité par lecture de code AVANT ce run (src/main/sync/
 * downstream.ts + src/main/ipc/handlers.ts) :
 *   - Après chaque pull réussi (totalFetched > 0), downstream.ts persiste
 *     DEUX couples de clés t_config :
 *       * last_downstream_sync_true / _true_id : le VRAI point atteint
 *         (non reculé) — nouveau.
 *       * last_downstream_sync / _id : le curseur de sécurité EXISTANT,
 *         reculé de 2 minutes (anti-décalage d'horloge), sync_id remis à
 *         00000000-0000-0000-0000-000000000000 — comportement INCHANGÉ.
 *   - sync:getCloudCartesCount (handlers.ts) lit désormais le couple "true"
 *     en priorité, avec repli automatique sur l'ancien couple si absent
 *     (compat ascendante, postes déjà en prod avant cette mise à jour).
 *   - useDashboardStats.ts rafraîchit cloudCartesCount toutes les 3 minutes
 *     (setInterval, nettoyé au démontage) tant qu'un rôle concerné reste
 *     affiché, sans action manuelle.
 *
 * Ce fichier valide les 5 scénarios demandés EN CONDITIONS RÉELLES contre le
 * projet Supabase de DEV/STAGING dédié (`dist-e2e-cloud/`, `allowRealSync`),
 * avec DEUX instances Electron distinctes (Poste A, Poste B) simulant deux
 * postes physiques différents, comme two-centres-offline-sync-real.e2e.spec.ts.
 *
 * Toute donnée créée est préfixée `ZZTEST_` et nettoyée en fin de run
 * (local + Supabase dev), avec vérification finale de résidus nuls.
 *
 * Invocation ciblée :
 *   npx playwright test e2e/specs/cloud/cloud-counter-reset-fix.e2e.spec.ts
 * Build préalable requis : npx electron-vite build --mode e2e (déjà fait
 * pour ce run — jamais lancé automatiquement par un agent, CLAUDE.md §1).
 */
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { launchSeededApp, launchExistingApp, teardownSeededApp, type E2EEnvironment } from '../../fixtures/electron-app';
import { getTestUser } from '../../fixtures/test-users';
import {
  ensureCloudSiteAndCentre,
  insertCloudCard,
  cleanupAllCloudTestData
} from '../../fixtures/supabase-dev-client';
import { execFileSync } from 'child_process';
import { join } from 'path';

function dbPathOf(userDataDir: string): string {
  return join(userDataDir, 'data', 'gest_in_situ.db');
}
function queryDb(dbPath: string, sql: string): string {
  return execFileSync('sqlite3', [dbPath, sql], { encoding: 'utf-8' }).trim();
}
function execDb(dbPath: string, sql: string): void {
  execFileSync('sqlite3', [dbPath, sql], { encoding: 'utf-8' });
}

async function login(window: Page, user: { login: string; password: string }): Promise<void> {
  await window.waitForURL(/#\/login/);
  await window.getByTestId('login-input').fill(user.login);
  await window.getByTestId('password-input').fill(user.password);
  await window.getByTestId('login-submit').click();
  await window.waitForURL(/#\/agent-verification$/, { timeout: 15000 });
}
async function logout(window: Page): Promise<void> {
  await window.locator('.btn-logout').click();
  await window.waitForURL(/#\/login/, { timeout: 15000 });
}

async function goToRecherche(window: Page): Promise<void> {
  await window.getByRole('link', { name: 'Recherche Active' }).click();
  await window.waitForURL(/#\/agent-verification\/recherche/, { timeout: 15000 });
}

async function createCardViaApp(
  window: Page,
  siteId: number,
  centreId: number,
  noms: string,
  prenoms: string,
  ddnISO: string,
  rangement: string,
  agentLogin: string
): Promise<{ id: number; sync_id: string }> {
  return window.evaluate(
    async ({ siteId, centreId, noms, prenoms, ddnISO, rangement, agentLogin }) => {
      return (window as any).api.cartes.create({
        noms,
        prenoms,
        date_de_naissance: ddnISO,
        rangement,
        statut: 'EN STOCK',
        site_id: siteId,
        centre_id: centreId,
        contact: '0100000000',
        num_secu: `ZZTEST-NUMSECU-${noms}`,
        agent_saisie: agentLogin
      });
    },
    { siteId, centreId, noms, prenoms, ddnISO, rangement, agentLogin }
  );
}

async function deliverCardViaApp(window: Page, id: number, agentLogin: string): Promise<any> {
  return window.evaluate(
    async ({ id, agentLogin }) => {
      return (window as any).api.cartes.delivrer(id, {
        nom_retirant: 'ZZTEST_RETIRANT',
        num_retirant: '0100000000',
        type_retirant: 'ASSURE',
        agent_distributeur: agentLogin
      });
    },
    { id, agentLogin }
  );
}

async function directCloudCount(window: Page, siteId: number): Promise<number> {
  return window.evaluate((siteId) => (window as any).api.sync.getCloudCartesCount(siteId), siteId);
}

function pullButtonLocator(window: Page) {
  return window.getByRole('button', { name: /RÉCUPÉRER LES CARTES DEPUIS LE CLOUD|RÉCUPÉRATION EN COURS/ });
}
function pushButtonLocator(window: Page) {
  return window.getByRole('button', { name: /Synchroniser mes actions|ACTUALISATION/ });
}

async function readButtonText(btn: ReturnType<typeof pullButtonLocator>): Promise<{ enabled: boolean; count: number | null; text: string }> {
  const text = (await btn.textContent()) || '';
  const match = text.match(/\((\d+)\)/);
  return { enabled: await btn.isEnabled().catch(() => false), count: match ? Number(match[1]) : null, text };
}

/**
 * Poll PASSIF du bouton "RÉCUPÉRER..." (aucun clic, aucun logout/login —
 * juste une lecture de `textContent()` répétée) jusqu'à ce qu'un compte non
 * nul apparaisse ou que le délai imparti expire. C'est le SEUL moyen
 * d'observer honnêtement le rafraîchissement périodique automatique de
 * useDashboardStats.ts (toute action de remount fausserait la mesure en
 * déclenchant un loadStats() frais indépendant de l'intervalle testé).
 */
async function pollPullButtonPassively(
  window: Page,
  deadlineTs: number,
  sinceTs: number
): Promise<{ count: number | null; enabled: boolean; text: string; elapsedMs: number }> {
  let last = { count: null as number | null, enabled: false, text: '' };
  while (Date.now() < deadlineTs) {
    const btn = pullButtonLocator(window);
    if (await btn.count() > 0) {
      last = await readButtonText(btn);
      if (last.count && last.count > 0) {
        return { ...last, elapsedMs: Date.now() - sinceTs };
      }
    } else {
      // Bouton absent (masqué quand count===0 selon l'UI) : on considère count=0.
      last = { count: 0, enabled: false, text: '(absent)' };
    }
    await window.waitForTimeout(5000);
  }
  return { ...last, elapsedMs: Date.now() - sinceTs };
}

const RUN_ID = Date.now();
const PULL1_SYNC_ID = `zztest-counter-pull1-${RUN_ID}`;
const B_CARD_1 = `ZZTEST_CLOUDCOUNTB1_${RUN_ID}`;
const B_CARD_2 = `ZZTEST_CLOUDCOUNTB2_${RUN_ID}`;
const COMPAT_SYNC_ID = `zztest-counter-compat-${RUN_ID}`;

test.describe.serial('Correctif compteur cloud "RÉCUPÉRER LES CARTES DEPUIS LE CLOUD" — redescente à 0 (QA Terrain agent-13)', () => {
  let envA: E2EEnvironment;
  let dbPathA: string;
  let mainSiteId: number;
  let mainCentreId: number;
  let anyTestFailed = false;

  let envB: E2EEnvironment | null = null;
  let dbPathB: string;

  let aMountTs: number = 0; // horodatage du dernier (re)montage AgentVerificationLayout sur Poste A

  test.afterEach(async ({}, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus) anyTestFailed = true;
  });

  test.afterAll(async () => {
    if (envB) {
      try {
        execDb(dbPathB, "DELETE FROM t_cartes WHERE noms LIKE 'ZZTEST_%';");
        execDb(dbPathB, "DELETE FROM t_logs WHERE detail LIKE '%ZZTEST%';");
      } catch (e) {
        console.warn('[E2E-CLOUD] Nettoyage local Poste B échoué (non bloquant) :', e);
      }
      await teardownSeededApp(envB, anyTestFailed);
    }
    if (envA) {
      try {
        execDb(dbPathA, "DELETE FROM t_cartes WHERE noms LIKE 'ZZTEST_%';");
        execDb(dbPathA, "DELETE FROM t_logs WHERE detail LIKE '%ZZTEST%';");
      } catch (e) {
        console.warn('[E2E-CLOUD] Nettoyage local Poste A échoué (non bloquant) :', e);
      }
      await teardownSeededApp(envA, anyTestFailed);
    }

    const residual = await cleanupAllCloudTestData();
    console.log(
      `[E2E-CLOUD][NETTOYAGE FINAL] Résidus ZZTEST_ après DELETE + re-SELECT -> ` +
      `cartes=${residual.residualCartes} centres=${residual.residualCentres} sites=${residual.residualSites} (attendu : 0/0/0)`
    );
    expect(residual.residualCartes).toBe(0);
    expect(residual.residualCentres).toBe(0);
    expect(residual.residualSites).toBe(0);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // ÉTAPE 0 — Lancement Poste A + parents cloud + carte de seed pour le pull
  // ═══════════════════════════════════════════════════════════════════════
  test('0. Lancement Poste A, parents cloud assurés, carte ZZTEST posée côté cloud pour le premier pull', async () => {
    test.setTimeout(180_000);
    // Défensif : purge tout résidu ZZTEST_ d'un run précédent avorté.
    await cleanupAllCloudTestData();

    envA = await launchSeededApp({ allowRealSync: true });
    dbPathA = dbPathOf(envA.userDataDir);
    mainSiteId = envA.seed.siteId;
    mainCentreId = envA.seed.centreId;

    await ensureCloudSiteAndCentre(mainSiteId, mainCentreId);
    await insertCloudCard({
      sync_id: PULL1_SYNC_ID,
      noms: 'ZZTEST_CLOUDCOUNT_PULL1',
      prenoms: 'KOFFI',
      date_naissance: '1990-06-01',
      rangement: 'P1',
      statut: 'EN STOCK',
      id_site: mainSiteId,
      id_centre: mainCentreId,
      contact: '0102030490',
      num_secu: 'ZZTEST-NUMSECU-COUNTPULL1'
    });

    console.log(`[QA-CHECK][Setup] Poste A lancé (site=${mainSiteId}, centre=${mainCentreId}), 1 carte ZZTEST posée sur le projet dev.`);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SCÉNARIO 1 — Cœur du correctif : pull complet -> compteur EXACTEMENT 0
  // ═══════════════════════════════════════════════════════════════════════
  test('1. Poste A — pull complet via bouton -> compteur redescend EXACTEMENT à 0, t_config "true" écrit et distinct du curseur reculé', async () => {
    test.setTimeout(180_000);
    const { window } = envA;

    await login(window, getTestUser('operateurVerification'));
    aMountTs = Date.now();

    // Même précaution timing que sync-cloud-real.e2e.spec.ts : réseau parfois
    // encore OFFLINE/PROBING au tout premier login.
    let directCount = -1;
    let deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      directCount = await directCloudCount(window, mainSiteId);
      if (directCount > 0) break;
      await window.waitForTimeout(3000);
    }
    console.log(`[QA-CHECK][Scénario1] sync:getCloudCartesCount direct avant pull = ${directCount} (attendu >= 1)`);
    expect(directCount).toBeGreaterThan(0);

    await logout(window);
    await login(window, getTestUser('operateurVerification'));
    aMountTs = Date.now();

    const pullBtn = pullButtonLocator(window);
    await expect(pullBtn).toBeVisible({ timeout: 15000 });
    await expect(pullBtn).toHaveText(/RÉCUPÉRER LES CARTES DEPUIS LE CLOUD \(\d+\)/, { timeout: 20000 });
    const before = await readButtonText(pullBtn);
    console.log(`[QA-CHECK][Scénario1] Bouton avant clic -> "${before.text}"`);
    expect(before.count).toBeGreaterThan(0);

    await pullBtn.click();
    await expect(window.getByText(/Récupération réussie|données locales sont déjà à jour|Synchronisation initiale/)).toBeVisible({ timeout: 30000 });

    const localRow = queryDb(dbPathA, `SELECT COUNT(*) FROM t_cartes WHERE sync_id='${PULL1_SYNC_ID}';`);
    expect(Number(localRow)).toBe(1);

    // Vérité terrain immédiate (IPC direct, indépendant du remount UI) :
    let afterDirect = -1;
    deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      afterDirect = await directCloudCount(window, mainSiteId);
      if (afterDirect === 0) break;
      await window.waitForTimeout(2000);
    }
    console.log(`[QA-CHECK][Scénario1] sync:getCloudCartesCount direct après pull = ${afterDirect} (attendu EXACTEMENT 0)`);
    expect(afterDirect).toBe(0);

    // Reflet UI (remount) : bouton doit disparaître/être désactivé, comptage à 0.
    await logout(window);
    await login(window, getTestUser('operateurVerification'));
    aMountTs = Date.now();
    await window.waitForTimeout(6000); // laisser fetchCloudCountWithRetry se résoudre
    const pullBtnAfter = pullButtonLocator(window);
    const stillVisible = await pullBtnAfter.count() > 0 && await pullBtnAfter.isVisible().catch(() => false);
    if (stillVisible) {
      const after = await readButtonText(pullBtnAfter);
      console.log(`[QA-CHECK][Scénario1] Bouton après remontage post-pull -> "${after.text}" enabled=${after.enabled}`);
      // Lecture de code (AgentVerificationLayout.tsx:194) : le suffixe "(N)" n'est
      // affiché QUE si cloudCartesCount > 0 — à 0 (ou négatif), le bouton garde son
      // libellé de base SANS parenthèses. `after.count` vaut donc `null` (aucun match
      // regex) dans ce cas précis, PAS `0` littéralement. Les deux sont le signal attendu ici.
      expect(after.count === null || after.count === 0).toBe(true);
      expect(after.enabled).toBe(false);
    } else {
      console.log('[QA-CHECK][Scénario1] Bouton "RÉCUPÉRER..." absent de l\'UI après remontage (count=0) — cohérent avec un compteur à 0.');
    }

    // Preuve base SQLite : t_config "true" écrit, distinct du curseur reculé.
    const trueRow = queryDb(dbPathA, "SELECT value FROM t_config WHERE key='last_downstream_sync_true';");
    const trueIdRow = queryDb(dbPathA, "SELECT value FROM t_config WHERE key='last_downstream_sync_true_id';");
    const rewoundRow = queryDb(dbPathA, "SELECT value FROM t_config WHERE key='last_downstream_sync';");
    const rewoundIdRow = queryDb(dbPathA, "SELECT value FROM t_config WHERE key='last_downstream_sync_id';");
    console.log(`[QA-CHECK][Scénario1] t_config -> true="${trueRow}" true_id="${trueIdRow}" rewound="${rewoundRow}" rewound_id="${rewoundIdRow}"`);

    expect(trueRow).not.toBe('');
    expect(trueIdRow).not.toBe('');
    expect(trueRow).not.toBe(rewoundRow);
    expect(rewoundIdRow).toBe('00000000-0000-0000-0000-000000000000');

    const expectedRewound = new Date(new Date(trueRow).getTime() - 2 * 60 * 1000).toISOString();
    expect(rewoundRow).toBe(expectedRewound);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SCÉNARIO 2 — Poste B pousse de nouvelles cartes, Poste A (resté ouvert,
  // AUCUNE action manuelle) doit voir son compteur remonter tout seul via le
  // rafraîchissement périodique de 3 minutes.
  // ═══════════════════════════════════════════════════════════════════════
  test('2. Poste B (instance distincte) pousse 2 cartes sur le même site Supabase', async () => {
    test.setTimeout(180_000);
    envB = await launchSeededApp({ allowRealSync: true });
    dbPathB = dbPathOf(envB.userDataDir);
    const { window } = envB;

    // Défensif : la topologie seedée par launchSeededApp est déterministe
    // (site=1/centre=1 sur une base fraîche) — même site que Poste A.
    expect(envB.seed.siteId).toBe(mainSiteId);
    expect(envB.seed.centreId).toBe(mainCentreId);

    await login(window, getTestUser('operateurVerification'));

    const c1 = await createCardViaApp(window, mainSiteId, mainCentreId, B_CARD_1, 'AGENT1', '1991-01-01', 'B1', 'E2E_OPERATEUR_VERIFICATION');
    await deliverCardViaApp(window, c1.id, 'E2E_OPERATEUR_VERIFICATION');
    const c2 = await createCardViaApp(window, mainSiteId, mainCentreId, B_CARD_2, 'AGENT2', '1991-01-02', 'B2', 'E2E_OPERATEUR_VERIFICATION');
    await deliverCardViaApp(window, c2.id, 'E2E_OPERATEUR_VERIFICATION');

    // Remount pour rafraîchir conformeCount avant de cliquer "Synchroniser mes actions".
    await logout(window);
    await login(window, getTestUser('operateurVerification'));

    const pushBtn = pushButtonLocator(window);
    await expect(pushBtn).toBeVisible({ timeout: 15000 });
    const pushBefore = await readButtonText(pushBtn);
    console.log(`[QA-CHECK][Scénario2] Bouton "Synchroniser mes actions" avant clic -> "${pushBefore.text}" enabled=${pushBefore.enabled}`);

    if (pushBefore.enabled) {
      await pushBtn.click();
      // Découverte empirique CE run (comme two-centres-offline-sync-real.e2e.spec.ts) :
      // le cycle outbox/upstream automatique de l'app (allowRealSync) peut avoir déjà
      // poussé les cartes AVANT que ce clic n'ait quoi que ce soit à envoyer — dans ce
      // cas précis, upload-worker.js:119 renvoie "Aucune donnee locale conforme en
      // attente de synchronisation." (uploadedCount=0), un message de SUCCÈS légitime
      // qui ne correspond simplement à aucun des messages "il y avait du travail"
      // attendus par la regex ci-dessous. On tente donc un match large avec un timeout
      // COURT, SANS faire échouer le test sur un timeout (le vrai juge de paix est
      // l'état réel de la base ci-dessous, is_dirty=0).
      try {
        await expect(
          window.getByText(/[Ss]ynchronisation de masse|cartes traitées|cartes envoyées|à jour|Aucune donnee locale conforme/i)
        ).toBeVisible({ timeout: 15000 });
        console.log('[QA-CHECK][Scénario2] Toast de fin de transfert visible.');
      } catch {
        console.log('[QA-CHECK][Scénario2][INFO] Aucun toast de fin de transfert détecté dans la fenêtre (probable course avec le cycle outbox automatique) — vérification directe de l\'état local ci-dessous.');
      }
    } else {
      console.log('[QA-CHECK][Scénario2][INFO] Bouton déjà désactivé avant clic — le cycle outbox automatique a probablement déjà poussé les 2 cartes. Vérification directe de l\'état local et cloud ci-dessous.');
    }

    let dirtyAfter = -1;
    const dirtyDeadline = Date.now() + 30000;
    while (Date.now() < dirtyDeadline) {
      dirtyAfter = Number(queryDb(dbPathB, `SELECT COUNT(*) FROM t_cartes WHERE noms IN ('${B_CARD_1}','${B_CARD_2}') AND is_dirty=1;`));
      if (dirtyAfter === 0) break;
      await window.waitForTimeout(2000);
    }
    console.log(`[QA-CHECK][Scénario2] Cartes encore dirty après push Poste B = ${dirtyAfter} (attendu 0)`);
    expect(dirtyAfter).toBe(0);

    // Fermeture propre de Poste B — Poste A n'a reçu AUCUNE action manuelle
    // pendant toute cette étape (pas de logout/login, pas de clic).
    await teardownSeededApp(envB, false);
    envB = null;
    console.log('[QA-CHECK][Scénario2] Poste B fermé. Poste A reste ouvert sans interaction depuis son remontage du Scénario 1.');
  });

  test('3. Poste A — SANS action manuelle, le compteur se met à jour tout seul via le rafraîchissement périodique (3 min)', async () => {
    test.setTimeout(360_000);
    const { window } = envA;

    const CLOUD_COUNT_REFRESH_INTERVAL_MS = 3 * 60 * 1000;
    const deadline = aMountTs + CLOUD_COUNT_REFRESH_INTERVAL_MS + 90_000; // marge de 90s
    const remainingMs = Math.max(0, deadline - Date.now());
    console.log(`[QA-CHECK][Scénario2] Poll passif du bouton "RÉCUPÉRER..." jusqu'à ${remainingMs}ms restants (mount A à +0, intervalle attendu à +180000ms).`);

    const result = await pollPullButtonPassively(window, deadline, aMountTs);
    console.log(`[QA-CHECK][Scénario2] Résultat poll passif -> count=${result.count} enabled=${result.enabled} text="${result.text}" délai réel observé depuis le mount = ${result.elapsedMs}ms`);

    expect(result.count).not.toBeNull();
    expect(result.count).toBeGreaterThanOrEqual(2);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SCÉNARIO 3 — Non-régression : un second pull complet retombe aussi à 0
  // ═══════════════════════════════════════════════════════════════════════
  test('4. Poste A — second pull complet -> compteur retombe de nouveau EXACTEMENT à 0 (non-régression)', async () => {
    test.setTimeout(120_000);
    const { window } = envA;

    // Le bouton peut nécessiter un remount pour refléter la valeur détectée par le polling passif.
    await logout(window);
    await login(window, getTestUser('operateurVerification'));
    aMountTs = Date.now();

    const pullBtn = pullButtonLocator(window);
    await expect(pullBtn).toBeVisible({ timeout: 15000 });
    await expect(pullBtn).toHaveText(/RÉCUPÉRER LES CARTES DEPUIS LE CLOUD \(\d+\)/, { timeout: 20000 });
    const before = await readButtonText(pullBtn);
    console.log(`[QA-CHECK][Scénario3] Bouton avant second pull -> "${before.text}"`);
    expect(before.count).toBeGreaterThanOrEqual(2);

    await pullBtn.click();
    await expect(window.getByText(/Récupération réussie|données locales sont déjà à jour|Synchronisation initiale/)).toBeVisible({ timeout: 30000 });

    const rows = queryDb(dbPathA, `SELECT noms||'|'||statut FROM t_cartes WHERE noms IN ('${B_CARD_1}','${B_CARD_2}') ORDER BY noms;`).split(/\r?\n/);
    console.log(`[QA-CHECK][Scénario3] Cartes B rapatriées localement sur A -> ${JSON.stringify(rows)}`);
    expect(rows).toEqual([`${B_CARD_1}|DELIVRE`, `${B_CARD_2}|DELIVRE`]);

    let afterDirect = -1;
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      afterDirect = await directCloudCount(window, mainSiteId);
      if (afterDirect === 0) break;
      await window.waitForTimeout(2000);
    }
    console.log(`[QA-CHECK][Scénario3] sync:getCloudCartesCount direct après second pull = ${afterDirect} (attendu EXACTEMENT 0, preuve que le fix n'est pas un coup de chance)`);
    expect(afterDirect).toBe(0);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SCÉNARIO 4 — Compatibilité ascendante : poste "ancien" sans les clés
  // last_downstream_sync_true[_id]
  // ═══════════════════════════════════════════════════════════════════════
  test('5. Poste A — simulation poste ancien (clés "true" absentes) -> compteur ne plante pas (pas de NaN/négatif), se corrige après un nouveau pull', async () => {
    test.setTimeout(180_000);

    // `testFailed: true` ici ne signifie PAS que le test a échoué — c'est un
    // détournement volontaire et inoffensif de teardownSeededApp() : passé à
    // `true`, il ferme proprement le process Electron (close gracieux +
    // fallback taskkill) mais SAUTE le rmSync final du userDataDir (voir
    // e2e/fixtures/electron-app.ts:353-358, "répertoire conservé pour
    // diagnostic"). Ce comportement de préservation est exactement ce dont ce
    // scénario a besoin : fermer l'app SANS supprimer sa base SQLite, pour
    // pouvoir la manipuler directement juste après (voir commentaire ci-dessous).
    await teardownSeededApp(envA, true);

    // App fermée : seule fenêtre sûre pour toucher directement la base
    // (voir le commentaire de sync-cloud-real.e2e.spec.ts sur la corruption
    // observée en cas de second écrivain pendant que l'app tourne).
    execDb(dbPathA, "DELETE FROM t_config WHERE key IN ('last_downstream_sync_true','last_downstream_sync_true_id');");
    const check = queryDb(dbPathA, "SELECT COUNT(*) FROM t_config WHERE key IN ('last_downstream_sync_true','last_downstream_sync_true_id');");
    expect(Number(check)).toBe(0);
    console.log('[QA-CHECK][Scénario4] Clés last_downstream_sync_true/_id supprimées localement (simulation poste pré-correctif).');

    const { app, window } = await launchExistingApp(envA.userDataDir, { allowRealSync: true });
    envA = { app, window, userDataDir: envA.userDataDir, seed: envA.seed };

    await login(window, getTestUser('operateurVerification'));
    aMountTs = Date.now();

    const compatCount = await directCloudCount(window, mainSiteId);
    console.log(`[QA-CHECK][Scénario4] sync:getCloudCartesCount direct AVANT nouveau pull (mode compat, repli sur last_downstream_sync) = ${compatCount} (attendu : nombre fini >= 0, jamais NaN/négatif)`);
    expect(Number.isFinite(compatCount)).toBe(true);
    expect(compatCount).toBeGreaterThanOrEqual(0);

    // Nouvelle carte cloud pour vérifier que le compteur se corrige après un pull réel.
    await insertCloudCard({
      sync_id: COMPAT_SYNC_ID,
      noms: 'ZZTEST_CLOUDCOUNT_COMPAT',
      prenoms: 'ADAMA',
      date_naissance: '1993-01-01',
      rangement: 'C1',
      statut: 'EN STOCK',
      id_site: mainSiteId,
      id_centre: mainCentreId,
      contact: '0102030499',
      num_secu: 'ZZTEST-NUMSECU-COMPAT'
    });

    let directAfterInsert = -1;
    let deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      directAfterInsert = await directCloudCount(window, mainSiteId);
      if (directAfterInsert > compatCount) break;
      await window.waitForTimeout(3000);
    }
    console.log(`[QA-CHECK][Scénario4] sync:getCloudCartesCount direct après insertion carte compat = ${directAfterInsert} (attendu > ${compatCount})`);
    expect(directAfterInsert).toBeGreaterThan(compatCount);

    await logout(window);
    await login(window, getTestUser('operateurVerification'));
    aMountTs = Date.now();

    const pullBtn = pullButtonLocator(window);
    await expect(pullBtn).toBeVisible({ timeout: 15000 });
    await expect(pullBtn).toHaveText(/RÉCUPÉRER LES CARTES DEPUIS LE CLOUD \(\d+\)/, { timeout: 20000 });
    await pullBtn.click();
    await expect(window.getByText(/Récupération réussie|données locales sont déjà à jour|Synchronisation initiale/)).toBeVisible({ timeout: 30000 });

    let afterDirect = -1;
    deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      afterDirect = await directCloudCount(window, mainSiteId);
      if (afterDirect === 0) break;
      await window.waitForTimeout(2000);
    }
    console.log(`[QA-CHECK][Scénario4] sync:getCloudCartesCount direct après pull post-compat = ${afterDirect} (attendu EXACTEMENT 0)`);
    expect(afterDirect).toBe(0);

    const trueRowAfter = queryDb(dbPathA, "SELECT value FROM t_config WHERE key='last_downstream_sync_true';");
    console.log(`[QA-CHECK][Scénario4] Clé last_downstream_sync_true re-populée après ce pull -> "${trueRowAfter}" (attendu non vide)`);
    expect(trueRowAfter).not.toBe('');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SCÉNARIO 5 — Non-régression mémoire/listeners : pas de fuite d'intervalle
  // ═══════════════════════════════════════════════════════════════════════
  test('6. Poste A — cycles logout/login répétés pendant que l\'intervalle de 3 min est actif -> aucun setInterval résiduel (pas de fuite, pas de double-comptage)', async () => {
    test.setTimeout(120_000);
    const { window } = envA;

    // Instrumentation : intercepte tout setInterval/clearInterval créé avec
    // le délai EXACT utilisé par le rafraîchissement périodique cloud
    // (CLOUD_COUNT_REFRESH_INTERVAL_MS = 180000ms, useDashboardStats.ts).
    // Ne modifie AUCUN fichier applicatif — pur monkey-patch côté test,
    // injecté APRÈS le mount courant (déjà comptabilisé manuellement) pour
    // ne suivre que les cycles à venir.
    await window.evaluate(() => {
      const w = window as any;
      w.__qaIntervalNet = 0;
      const realSet = window.setInterval.bind(window);
      const realClear = window.clearInterval.bind(window);
      const tracked = new Set<number>();
      w.setInterval = ((fn: any, delay?: number, ...args: any[]) => {
        const id = realSet(fn, delay, ...args);
        if (delay === 180000) {
          tracked.add(id as unknown as number);
          w.__qaIntervalNet++;
        }
        return id;
      }) as any;
      w.clearInterval = ((id: any) => {
        if (tracked.has(id)) {
          tracked.delete(id);
          w.__qaIntervalNet--;
        }
        return realClear(id);
      }) as any;
    });

    // 3 cycles logout/login (chaque login démonte puis remonte
    // AgentVerificationLayout -> useEffect crée puis l'ancien se nettoie).
    for (let i = 0; i < 3; i++) {
      await logout(window);
      await login(window, getTestUser('operateurVerification'));
      await window.waitForTimeout(1500);
    }

    const netWhileLoggedIn = await window.evaluate(() => (window as any).__qaIntervalNet);
    console.log(`[QA-CHECK][Scénario5] Net setInterval(180000ms) actifs après 3 cycles logout/login, ENCORE connecté = ${netWhileLoggedIn} (attendu EXACTEMENT 1 : un seul montage courant)`);
    expect(netWhileLoggedIn).toBe(1);

    await logout(window);
    await window.waitForTimeout(1500);
    const netAfterFinalLogout = await window.evaluate(() => (window as any).__qaIntervalNet);
    console.log(`[QA-CHECK][Scénario5] Net setInterval(180000ms) actifs après déconnexion finale (aucune vue concernée affichée) = ${netAfterFinalLogout} (attendu EXACTEMENT 0 : nettoyage complet, aucune fuite)`);
    expect(netAfterFinalLogout).toBe(0);

    // Reconnexion finale pour laisser l'app dans un état propre avant teardown.
    await login(window, getTestUser('operateurVerification'));
  });
});
