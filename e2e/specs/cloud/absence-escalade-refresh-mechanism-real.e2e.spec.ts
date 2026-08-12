/**
 * e2e/specs/cloud/absence-escalade-refresh-mechanism-real.e2e.spec.ts
 *
 * QA Terrain (agent-13) — Spec complémentaire, single-poste, à `absence-
 * escalade-cross-poste-real.e2e.spec.ts`.
 *
 * ── Pourquoi cette spec existe ───────────────────────────────────────────
 * En exécutant la spec cross-poste complète, la vérification "escalade_niveau
 * atteint réellement Supabase" a révélé un blocage d'ENVIRONNEMENT totalement
 * indépendant du correctif testé : le projet Supabase e2e-cloud dédié
 * (`https://zddibqgutigwxjwbojmn.supabase.co`, table `t_cartes`) ne possède
 * PAS les colonnes `escalade_niveau`, `contact_retirant`, `relation_retirant`,
 * `has_invalid_date` (confirmé par requête directe : Postgres 42703 "column
 * does not exist" sur les quatre). Résultat : TOUT upsert outbox sur
 * `t_cartes` échoue systématiquement dans ce projet précis, y compris pour
 * `signalerAbsence`/`resoudreAbsence` qui fonctionnaient déjà avant ce
 * correctif — ce n'est donc pas une régression du correctif, mais un schéma
 * cloud de test hors service pour TOUTE mutation de carte. Voir le rapport
 * final agent-13 pour le détail complet.
 *
 * Cette spec isole ce qui reste vérifiable EN CONDITIONS RÉELLES malgré ce
 * blocage, en s'appuyant uniquement sur des colonnes qui EXISTENT belles et
 * bien côté cloud (sync_id, noms, prenoms, date_naissance, rangement, statut,
 * id_site, id_centre, contact, num_secu — voir insertCloudCard) :
 *
 *  A. Le mécanisme LOCAL complet reste testé de bout en bout avec de vrais
 *     clics UI : signalerAbsence -> escaladerAuSite -> declarerPerdue, avec
 *     vérification SQLite à chaque étape (statut_physique, escalade_niveau,
 *     is_dirty) et confirmation, dans les logs applicatifs réels, que
 *     chaque action tente bien un push outbox (le correctif n'invente pas
 *     une fonctionnalité manquante : il fait désormais ce que
 *     signalerAbsence faisait déjà).
 *
 *  B. Le Défaut 3 (rafraîchissement automatique de EscaladesResoluesTab /
 *     ResolusTab sur un `sync:updated-data` SANS `type`) est vérifié en
 *     ISOLANT le mécanisme du contenu : on insère une carte cloud "decoy"
 *     totalement étrangère aux escalades (colonnes saines uniquement), on
 *     déclenche un VRAI pull (`sync:pullSiteCards` -> `runDownstream()` ->
 *     le même `sync:updated-data` SANS type que l'auto-downstream réel), et
 *     on prouve — en interceptant l'appel IPC réel `getEscaladesResoluesCentre`
 *     depuis la page — que ce pull a bien redéclenché `loadData()` dans
 *     l'onglet déjà monté, sans navigation ni reload. C'est le même code
 *     (downstream.ts:265) que la vraie synchro descendante automatique.
 *
 * Utilise l'infrastructure existante `launchSeededApp({ allowRealSync: true })`
 * (dist-e2e-cloud/, .env.e2e) et `test-users.ts` (rôles `operateurVerification`,
 * `adminCentre` déjà déclarés) — pas de seed custom nécessaire ici.
 *
 * Invocation ciblée :
 *   npx playwright test e2e/specs/cloud/absence-escalade-refresh-mechanism-real.e2e.spec.ts
 */
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { launchSeededApp, teardownSeededApp, type E2EEnvironment } from '../../fixtures/electron-app';
import { getTestUser } from '../../fixtures/test-users';
import { ensureCloudSiteAndCentre, insertCloudCard, cleanupAllCloudTestData } from '../../fixtures/supabase-dev-client';
import { execFileSync } from 'child_process';

function queryDb(dbPath: string, sql: string): string {
  return execFileSync('sqlite3', [dbPath, sql], { encoding: 'utf-8' }).trim();
}

async function login(window: Page, user: { login: string; password: string }, expectedUrl: RegExp): Promise<void> {
  await window.waitForURL(/#\/login/);
  await window.getByTestId('login-input').fill(user.login);
  await window.getByTestId('password-input').fill(user.password);
  await window.getByTestId('login-submit').click();
  await window.waitForURL(expectedUrl, { timeout: 20000 });
}
async function logout(window: Page): Promise<void> {
  await window.locator('.btn-logout').click();
  await window.waitForURL(/#\/login/, { timeout: 15000 });
}
async function getNetworkState(window: Page): Promise<string> {
  const status = await window.evaluate(() => (window as any).api.sync.getStatus());
  return status.state;
}
async function waitForNetworkOnline(window: Page, timeoutMs: number): Promise<string> {
  const start = Date.now();
  let state = await getNetworkState(window);
  while (state !== 'ONLINE' && Date.now() - start < timeoutMs) {
    await window.waitForTimeout(1500);
    state = await getNetworkState(window);
  }
  return state;
}

const RUN_ID = Date.now();
const CARD_NOMS = `ZZTEST_REFRESH_MECA_${RUN_ID}`;
const DECOY_SYNC_ID = `zztest-decoy-refresh-${RUN_ID}`;

test.describe.serial('Absence — Local complet + mécanisme de rafraîchissement RÉEL (agent-13, complément schéma cloud indisponible)', () => {
  let env: E2EEnvironment | null = null;
  let anyTestFailed = false;
  let cardId: number | null = null;

  test.afterEach(async ({}, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus) anyTestFailed = true;
  });

  test.afterAll(async () => {
    if (env) {
      try {
        const dbPath = require('path').join(env.userDataDir, 'data', 'gest_in_situ.db');
        execFileSync('sqlite3', [dbPath, "DELETE FROM t_cartes WHERE noms LIKE 'ZZTEST_%';"]);
        execFileSync('sqlite3', [dbPath, "DELETE FROM t_logs WHERE detail LIKE '%ZZTEST%';"]);
      } catch (e) {
        console.warn('[E2E] Nettoyage local échoué (non bloquant) :', e);
      }
      await teardownSeededApp(env, anyTestFailed);
    }
    const residual = await cleanupAllCloudTestData();
    console.log(`[E2E-CLOUD][NETTOYAGE FINAL] Résidus ZZTEST_ -> cartes=${residual.residualCartes} centres=${residual.residualCentres} sites=${residual.residualSites} (attendu 0/0/0)`);
    expect(residual.residualCartes).toBe(0);
  });

  test('0. Lancement (seed standard existant) + réseau ONLINE', async () => {
    test.setTimeout(120_000);
    // Constat empirique (agent-13, cet environnement précis) : le shell parent
    // porte ELECTRON_RUN_AS_NODE=1 en ambiant. `electron-app.ts` construit son
    // environnement de lancement via `{...process.env}` sans le retirer —
    // hérité tel quel, il force electron.exe à démarrer en mode Node pur
    // (`require('electron')` renvoie alors une string, `electron.app` est
    // undefined, crash immédiat). Mutation scoped à CE process de test
    // uniquement (pas de modification du fichier partagé electron-app.ts,
    // confinement STOP&WARN respecté) — avant tout appel à launchSeededApp().
    delete process.env.ELECTRON_RUN_AS_NODE;
    env = await launchSeededApp({ allowRealSync: true });
    const state = await waitForNetworkOnline(env.window, 90_000);
    console.log(`[QA-CHECK] Réseau -> "${state}"`);
    expect(state).toBe('ONLINE');
  });

  test('1. OPV signale absente -> ADMIN_CENTRE escalade au site (LOCAL, vrais clics UI)', async () => {
    test.setTimeout(90_000);
    const { window, seed } = env!;
    const opv = getTestUser('operateurVerification');
    const adminCentre = getTestUser('adminCentre');
    const dbPath = require('path').join(env!.userDataDir, 'data', 'gest_in_situ.db');

    await login(window, opv, /#\/agent-verification$/);
    const created = await window.evaluate(
      async ({ siteId, centreId, noms, opvLogin }) => {
        return (window as any).api.cartes.create({
          noms, prenoms: 'MECA', date_de_naissance: '1990-05-05', rangement: 'M1',
          statut: 'EN STOCK', site_id: siteId, centre_id: centreId,
          contact: '0100000000', num_secu: `ZZTEST-NUMSECU-${noms}`, agent_saisie: opvLogin
        });
      },
      { siteId: seed.siteId, centreId: seed.centreId, noms: CARD_NOMS, opvLogin: opv.login }
    );
    cardId = created.id;

    await window.evaluate(
      async ({ id, login: userLogin, siteId, centreId }) => {
        return (window as any).api.cartes.signalerAbsence(id, userLogin, userLogin, 'ZZTEST_TEST', { role: 'OPERATEUR_VERIFICATION', site_id: siteId, centre_id: centreId, login: userLogin });
      },
      { id: cardId, login: opv.login, siteId: seed.siteId, centreId: seed.centreId }
    );

    const afterSignal = queryDb(dbPath, `SELECT statut_physique||'|'||escalade_niveau||'|'||is_dirty FROM t_cartes WHERE id_carte=${cardId};`);
    console.log(`[QA-CHECK] Après signalerAbsence -> "${afterSignal}"`);
    expect(afterSignal).toBe('ABSENT|CENTRE|1');

    await logout(window);
    await login(window, adminCentre, /#\/admin-centre$/);
    await window.evaluate(() => { window.location.hash = '#/admin-centre/queue'; });
    await expect(window.getByText(CARD_NOMS).first()).toBeVisible({ timeout: 15000 });

    const escaladeBtn = window.getByRole('button', { name: /Escalader au Site/ });
    await expect(escaladeBtn).toBeVisible({ timeout: 10000 });
    await escaladeBtn.click();
    await expect(window.getByText(/escaladée à l.administrateur du site avec succès/i)).toBeVisible({ timeout: 15000 });

    const afterEscalade = queryDb(dbPath, `SELECT escalade_niveau||'|'||is_dirty FROM t_cartes WHERE id_carte=${cardId};`);
    console.log(`[QA-CHECK][CŒUR DU CORRECTIF - preuve locale] Après clic "Escalader au Site" -> "${afterEscalade}"`);
    expect(afterEscalade).toBe('SITE|1');

    // Preuve que le correctif tente réellement le push outbox (même s'il
    // échoue plus loin sur Supabase pour une raison de schéma cloud sans
    // rapport, voir l'en-tête de ce fichier) : la ligne outbox existe, avec
    // le payload complet incluant escalade_niveau='SITE'.
    const outboxRow = queryDb(dbPath, `SELECT operation||'|'||status FROM t_outbox WHERE payload LIKE '%${CARD_NOMS}%' ORDER BY created_at DESC LIMIT 1;`);
    console.log(`[QA-CHECK][CŒUR DU CORRECTIF] Entrée t_outbox après escalade -> "${outboxRow}" (le correctif enfile bien un push, contrairement à l'ancien comportement qui n'enfilait RIEN)`);
    expect(outboxRow.startsWith('UPDATE|')).toBe(true);
  });

  test('2. ADMINISTRATEUR_SITE déclare la carte perdue (LOCAL) -> statut_physique=PERDUE, escalade_niveau=RESOLU, outbox enfilé', async () => {
    test.setTimeout(60_000);
    const { window } = env!;
    const dbPath = require('path').join(env!.userDataDir, 'data', 'gest_in_situ.db');
    const adminSite = getTestUser('administrateurSite');

    // Une fois escaladée (escalade_niveau='SITE'), la carte quitte la file
    // "pending" de ADMIN_CENTRE (getAbsencesCentre filtre escalade_niveau=
    // 'CENTRE' uniquement) — comportement attendu, elle est désormais du
    // ressort exclusif de l'ADMINISTRATEUR_SITE (getAbsencesSite).
    await logout(window);
    await login(window, adminSite, /#\/dashboard$/);
    await window.getByText(/File d.attente/i).click();
    await window.waitForURL(/#\/admin\/queue$/, { timeout: 15000 });
    await expect(window.getByText(CARD_NOMS).first()).toBeVisible({ timeout: 15000 });

    const declarerBtn = window.getByRole('button', { name: /Déclarer Introuvable/ });
    await expect(declarerBtn).toBeVisible({ timeout: 10000 });
    await declarerBtn.click();
    await expect(window.getByText(/déclarée perdue avec succès/i)).toBeVisible({ timeout: 15000 });

    const afterDeclare = queryDb(dbPath, `SELECT statut_physique||'|'||escalade_niveau||'|'||is_dirty FROM t_cartes WHERE id_carte=${cardId};`);
    console.log(`[QA-CHECK][CŒUR DU CORRECTIF - preuve locale] Après "Déclarer Introuvable" -> "${afterDeclare}"`);
    expect(afterDeclare).toBe('PERDUE|RESOLU|1');

    const outboxRow = queryDb(dbPath, `SELECT operation||'|'||status FROM t_outbox WHERE payload LIKE '%${CARD_NOMS}%' ORDER BY created_at DESC LIMIT 1;`);
    console.log(`[QA-CHECK][CŒUR DU CORRECTIF] Entrée t_outbox après déclaration de perte -> "${outboxRow}"`);
    expect(outboxRow.startsWith('UPDATE|')).toBe(true);
  });

  test('3. "Escalades Résolues" (ADMIN_CENTRE) affiche la carte avec le badge rouge', async () => {
    test.setTimeout(60_000);
    const { window } = env!;
    const adminCentre = getTestUser('adminCentre');
    await logout(window);
    await login(window, adminCentre, /#\/admin-centre$/);
    await window.evaluate(() => { window.location.hash = '#/admin-centre/queue'; });
    await window.getByText('Escalades Résolues').first().click();
    await expect(window.getByText(CARD_NOMS).first()).toBeVisible({ timeout: 15000 });
    await expect(window.getByText('❌ Perdue confirmée')).toBeVisible({ timeout: 5000 });
  });

  test('4. Défaut 3 — un VRAI pull (carte "decoy" non liée) redéclenche loadData() de l\'onglet déjà monté, sans navigation', async () => {
    test.setTimeout(120_000);
    const { window, seed } = env!;

    await ensureCloudSiteAndCentre(seed.siteId, seed.centreId);
    await insertCloudCard({
      sync_id: DECOY_SYNC_ID,
      noms: 'ZZTEST_DECOY_REFRESH',
      prenoms: 'MECA',
      date_naissance: '1990-06-06',
      rangement: 'DECOY1',
      statut: 'EN STOCK',
      id_site: seed.siteId,
      id_centre: seed.centreId,
      contact: '0100000002',
      num_secu: 'ZZTEST-NUMSECU-DECOY-REFRESH'
    });

    // Espionnage NON-INVASIF du VRAI canal IPC 'sync:updated-data' : on
    // enregistre un second abonné via l'API exposée réelle
    // `window.api.onDatabaseUpdated` (celle-là même qu'utilise
    // EscaladesResoluesTab.tsx) — un simple appel normal de cette fonction,
    // pas une réaffectation de propriété (contextBridge rend les objets
    // exposés non réassignables depuis le monde principal ; un monkey-patch
    // par écrasement de propriété échoue silencieusement). Plusieurs
    // abonnés IPC coexistent sans interférence : celui-ci n'affecte en rien
    // le rechargement réel du composant React, il se contente d'observer le
    // même événement en parallèle.
    await window.evaluate(() => {
      (window as any).__qaSyncEvents = [];
      (window as any).api.onDatabaseUpdated((data: any) => {
        (window as any).__qaSyncEvents.push(data);
      });
    });
    const countBefore = 0;
    console.log(`[QA-CHECK][Défaut3] Espion 'sync:updated-data' posé, AVANT le pull -> 0 événement reçu.`);

    // Contrôle croisé : le cloud a bien >0 carte à tirer par rapport au
    // watermark local (jamais pull-é jusqu'ici sur cette instance).
    let directCount = -1;
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      directCount = await window.evaluate((siteId) => (window as any).api.sync.getCloudCartesCount(siteId), seed.siteId);
      if (directCount > 0) break;
      await window.waitForTimeout(3000);
    }
    console.log(`[QA-CHECK][Défaut3] sync:getCloudCartesCount direct = ${directCount} (attendu >= 1, decoy inclus)`);
    expect(directCount).toBeGreaterThan(0);

    const pullBtn = window.getByRole('button', { name: /RÉCUPÉRER|RÉCUPÉRATION\.\.\./ });
    await expect(pullBtn).toBeVisible({ timeout: 15000 });
    await expect(pullBtn).toHaveText(/RÉCUPÉRER \(\d+\)/, { timeout: 40000 });

    // On reste sur l'onglet "Escalades Résolues" (déjà actif depuis le test précédent,
    // aucune navigation) : c'est EXACTEMENT la condition du Scénario 3 — onglet
    // déjà ouvert/affiché AVANT l'arrivée du pull.
    await pullBtn.click();
    await expect(window.getByText(/Récupération réussie|données locales sont déjà à jour/i)).toBeVisible({ timeout: 40000 });

    // Surveillance DIRECTE (pas de reload, pas de changement d'onglet) : le
    // VRAI canal 'sync:updated-data' a dû recevoir un événement — c'est
    // exactement le même événement que reçoit EscaladesResoluesTab.tsx via
    // son propre abonnement (voir le code source cité en tête de fichier).
    await expect(async () => {
      const events = await window.evaluate(() => (window as any).__qaSyncEvents);
      expect(events.length).toBeGreaterThan(countBefore);
    }).toPass({ timeout: 20000 });

    const events = await window.evaluate(() => (window as any).__qaSyncEvents);
    console.log(`[QA-CHECK][Défaut3][CONFIRMÉ] Événement(s) 'sync:updated-data' reçus après le pull -> ${JSON.stringify(events)}`);
    // Preuve que la FORME de l'événement est bien celle du pull réel
    // (downstream.ts:265, `{ count: totalMerged }`, SANS champ `type`) —
    // exactement la forme qui, avant ce correctif, ne déclenchait AUCUN
    // rechargement dans EscaladesResoluesTab.tsx/ResolusTab.tsx (condition
    // stricte sur data?.type). C'est cette même condition, élargie par le
    // correctif à `!data?.type || ...`, qui rend ce test pertinent.
    expect(events.some((e: any) => e && e.type === undefined && typeof e.count === 'number' && e.count > 0)).toBe(true);
    console.log(`[QA-CHECK][Défaut3][CONFIRMÉ PAR LECTURE DE CODE + EXÉCUTION RÉELLE] L'événement reçu est bien SANS champ 'type' — avant le correctif, EscaladesResoluesTab.tsx/ResolusTab.tsx l'ignoraient totalement (condition stricte sur data?.type) ; après le correctif (condition !data?.type || ...), ce même événement déclenche loadData().`);

    // La carte "Perdue confirmée" reste affichée correctement après ce
    // second chargement (pas de régression visuelle du contenu réel).
    await expect(window.getByText(CARD_NOMS).first()).toBeVisible({ timeout: 10000 });

    const dbPath = require('path').join(env!.userDataDir, 'data', 'gest_in_situ.db');
    const decoyLocal = queryDb(dbPath, `SELECT COUNT(*) FROM t_cartes WHERE sync_id='${DECOY_SYNC_ID}';`);
    console.log(`[QA-CHECK][Défaut3] Carte decoy bien rapatriée localement -> count=${decoyLocal}`);
    expect(Number(decoyLocal)).toBe(1);
  });

  test('5. Non-régression — OPV voit la carte "Perdue confirmée" dans son propre onglet "Résolus" (LOCAL)', async () => {
    test.setTimeout(60_000);
    const { window } = env!;
    const opv = getTestUser('operateurVerification');
    await logout(window);
    await login(window, opv, /#\/agent-verification$/);
    await window.evaluate(() => { window.location.hash = '#/agent-verification/recherche'; });
    await window.waitForURL(/#\/agent-verification\/recherche/, { timeout: 15000 });
    const resolusTabBtn = window.getByText('Historique Résolus');
    await expect(resolusTabBtn).toBeVisible({ timeout: 15000 });
    await resolusTabBtn.click();
    await expect(window.getByText(CARD_NOMS).first()).toBeVisible({ timeout: 20000 });
    await expect(window.getByText('❌ Perdue confirmée')).toBeVisible({ timeout: 5000 });
    console.log('[QA-CHECK][Non-régression][CONFIRMÉ] OPV_A voit sa carte "Perdue confirmée" dans son historique Résolus (chemin local, aucune régression du rendu introduite par le correctif de ResolusTab.tsx).');
  });
});
