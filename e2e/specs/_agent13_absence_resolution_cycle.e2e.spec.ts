/**
 * e2e/specs/_agent13_absence_resolution_cycle.e2e.spec.ts
 *
 * QA Terrain (agent-13) — Validation vivante du correctif du cycle de
 * résolution des signalements d'absence de carte, 3 rôles :
 * OPERATEUR_VERIFICATION -> ADMIN_CENTRE -> ADMINISTRATEUR_SITE.
 *
 * Correctifs sous test :
 *  1. declarerPerdue() pose désormais escalade_niveau='RESOLU' (jamais fait avant).
 *  2. Nouvel événement ABSENCE_PERDUE_CONFIRMEE (distinct de ABSENCE_RESOLUE).
 *  3. ResolusTab.tsx — badge dynamique (vert "Retrouvée" / rouge "Perdue confirmée").
 *  4. TopBar.tsx — toast distinct perdue vs retrouvée.
 *  5. Nouvel onglet "Escalades Résolues" (ADMIN_CENTRE uniquement) +
 *     handler cartes:getEscaladesResoluesCentre.
 *
 * Base 100% isolée (userDataDir jetable via launchSeededApp, réseau Supabase
 * coupé) — jamais de données citoyennes réelles. Toute donnée insérée
 * directement en base porte le préfixe ZZTEST_, nettoyée en fin de fichier.
 * Comptes de test : TEST_USERS existants (e2e/fixtures/test-users.ts,
 * préfixe E2E_), jamais de compte inventé.
 *
 * Suite `describe.serial` avec verdicts capturés en `console.log` (convention
 * agent-13 déjà en usage) : une assertion en échec n'interrompt jamais toute
 * la suite (cold start Electron ~50-75s, coûteux à relancer).
 */
import { test } from '@playwright/test';
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

const VERDICTS: string[] = [];
function verdict(id: string, ok: boolean, detail: string): void {
  const line = `[VERDICT][${id}] ${ok ? 'PASS' : 'FAIL'} — ${detail}`;
  VERDICTS.push(line);
  // eslint-disable-next-line no-console
  console.log(line);
}

test.describe.serial('QA Terrain — Cycle de résolution des absences (agent-13)', () => {
  let env: E2EEnvironment;
  let anyTestFailed = false;

  test.beforeAll(async () => {
    env = await launchSeededApp();
  });

  test.afterAll(async () => {
    console.log('\n\n========== RÉCAPITULATIF DES VERDICTS (cycle absences) ==========');
    for (const v of VERDICTS) console.log(v);
    console.log('===================================================================\n');
    if (env) {
      await teardownSeededApp(env, anyTestFailed);
    }
  });

  test.afterEach(async ({}, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus) {
      anyTestFailed = true;
    }
  });

  // ── Helpers (mêmes conventions que les specs agent-13 précédentes) ─────
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

  async function goHash(path: string): Promise<void> {
    await env.window.evaluate((p) => { window.location.hash = p; }, path);
  }

  async function loginAs(loginValue: string, password: string, urlRegex: RegExp): Promise<void> {
    const { window } = env;
    await window.waitForURL(/#\/login/, { timeout: 20000 });
    await window.getByTestId('login-input').fill(loginValue);
    await window.getByTestId('password-input').fill(password);
    await window.getByTestId('login-submit').click();
    await window.waitForURL(urlRegex, { timeout: 20000 });
    // Garde-fou (cf. commentaire de waitForSecureLoadingOverlayGone plus bas) : login() pose
    // systématiquement initialDataLoading=true (authStore.ts), levé de façon asynchrone et
    // propre à chaque page d'atterrissage — attendre sa disparition ici, une fois pour toutes,
    // évite de réintroduire la même course dans chaque test qui interagit juste après connexion.
    await waitForSecureLoadingOverlayGone();
  }

  async function logout(): Promise<void> {
    const { window } = env;
    try {
      await window.locator('.btn-logout').click({ timeout: 5000 });
      await window.waitForURL(/#\/login/, { timeout: 15000 });
    } catch (e) {
      console.warn('[E2E] Déconnexion normale impossible, reload direct sur #/login :', e);
      await window.evaluate(() => { window.location.hash = '#/login'; });
      await window.waitForURL(/#\/login/, { timeout: 15000 });
    }
  }

  // Note méthodologique (diagnostic _agent13_diag_search.e2e.spec.ts) : les 3 cartes de test
  // partagent le préfixe "ZZTEST_AGT13_", ce qui déclenche la détection FTS5 "Plusieurs
  // homonymes détectés" (tokenisation sur "_") au lieu de l'ouverture automatique de la modale
  // réservée au cas d'un match exact UNIQUE (useVerificationSearch.ts, directMatches.length===1).
  // Dans ce cas, il faut sélectionner manuellement la bonne ligne de résultat et cliquer son
  // propre bouton "Procéder au Retrait" (SearchResults.tsx) pour ouvrir la modale — les deux
  // chemins (auto-ouverture / sélection manuelle) sont gérés ici pour rester robuste.
  // Diagnostic (spikes _agent13_diag_search*.e2e.spec.ts, supprimés après investigation) : la
  // cause racine du premier échec de cette suite n'était PAS liée aux 3 cartes de test
  // partageant un préfixe commun (le filtre DOB discrimine correctement, un seul résultat
  // remonte bien) — c'était une course avec l'overlay global "Chargement sécurisé en cours..."
  // (MainLayout.tsx, piloté par `initialDataLoading` dans authStore.ts, posé à `true` par
  // `login()` et levé de façon asynchrone par l'effet "Étape C" de VerificationSearchPage/
  // index.tsx après son propre appel IPC hierarchy.getCentres()). Tant que cet overlay est
  // affiché, la div contenant l'<Outlet/> passe en `pointerEvents:'none'` : `fill()` réussit
  // quand même (Playwright ne fait pas de hit-test pour fill), mais un `click({force:true})`
  // sur le bouton de soumission ne fait RIEN — le clic est absorbé par l'overlay, invisible
  // pour Playwright puisque `force:true` saute justement la vérification "receives events" qui
  // aurait autrement fait patienter/réessayer jusqu'à la disparition de l'overlay. Fix : attendre
  // explicitement la disparition de cet overlay avant toute interaction avec le formulaire.
  async function waitForSecureLoadingOverlayGone(): Promise<void> {
    await env.window.getByText('Chargement sécurisé en cours...').waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
  }

  async function searchAndReportAbsence(nomComplet: string, ddn: string, uniqueCardName: string): Promise<void> {
    const { window } = env;
    await goHash('#/agent-verification/recherche');
    await window.waitForURL(/#\/agent-verification\/recherche/, { timeout: 15000 });
    await waitForSecureLoadingOverlayGone();
    await window.getByPlaceholder('Ex: KOFFI KOFFI KAN').fill(nomComplet);
    await window.locator('input[placeholder="JJ/MM/AAAA"]').fill(ddn);
    await window.getByRole('button', { name: /Rechercher la Carte/ }).click({ timeout: 15000 });
    await window.waitForTimeout(1500);
    const modalAlreadyOpen = await window.getByText('Vérification Physique').isVisible({ timeout: 3000 }).catch(() => false);
    if (!modalAlreadyOpen) {
      const row = window.locator('.card.animate-fade-in', { hasText: uniqueCardName }).first();
      await row.getByRole('button', { name: /Procéder au Retrait/ }).click({ timeout: 10000 });
      await window.getByText('Vérification Physique').waitFor({ state: 'visible', timeout: 10000 });
    }
    await window.getByRole('button', { name: /Non, absente/ }).click();
    await window.getByText('Signalement d\'Absence').waitFor({ state: 'visible', timeout: 10000 });
    await window.getByRole('button', { name: /Confirmer le signalement/ }).click();
    await window.waitForTimeout(1200);
  }

  // ── Données de test (préfixe ZZTEST_, nettoyées §12) ────────────────────
  const now = Date.now();
  let cardRetrouveeId = 0; // cycle complet : signalée -> escaladée -> résolue (retrouvée)
  let cardPerdueId = 0;    // cycle complet : signalée -> escaladée -> déclarée perdue
  let cardDirectId = 0;    // NON escaladée, résolue directement par ADMIN_CENTRE (contrôle négatif)
  let centreBId = 0;
  let cardCentreBEscaladeeResolueId = 0;
  const allInsertedCardIds: number[] = [];

  test.beforeAll(async () => {
    const ownSiteId = env.seed.siteId;
    const ownCentreId = env.seed.centreId;

    let ins = await dbQuery(
      `INSERT INTO t_cartes (noms, prenoms, date_de_naissance, lieu_de_naissance, num_secu, statut, site_id, centre_id, contact, rangement)
       VALUES ('ZZTEST_AGT13_RETROUVEE', 'BENEF', '1980-01-01', 'ZZTEST_LIEU', ?, 'EN STOCK', ?, ?, '+225 01 01 01 01 01', 'BX-A1')`,
      [`ZZTEST-SECU-AGT13-RETR-${now}`, ownSiteId, ownCentreId]
    );
    cardRetrouveeId = ins[0].lastInsertRowid;
    allInsertedCardIds.push(cardRetrouveeId);

    ins = await dbQuery(
      `INSERT INTO t_cartes (noms, prenoms, date_de_naissance, lieu_de_naissance, num_secu, statut, site_id, centre_id, contact, rangement)
       VALUES ('ZZTEST_AGT13_PERDUE', 'BENEF', '1980-02-02', 'ZZTEST_LIEU', ?, 'EN STOCK', ?, ?, '+225 02 02 02 02 02', 'BX-A2')`,
      [`ZZTEST-SECU-AGT13-PERDUE-${now}`, ownSiteId, ownCentreId]
    );
    cardPerdueId = ins[0].lastInsertRowid;
    allInsertedCardIds.push(cardPerdueId);

    ins = await dbQuery(
      `INSERT INTO t_cartes (noms, prenoms, date_de_naissance, lieu_de_naissance, num_secu, statut, site_id, centre_id, contact, rangement)
       VALUES ('ZZTEST_AGT13_DIRECT', 'BENEF', '1980-03-03', 'ZZTEST_LIEU', ?, 'EN STOCK', ?, ?, '+225 03 03 03 03 03', 'BX-A3')`,
      [`ZZTEST-SECU-AGT13-DIRECT-${now}`, ownSiteId, ownCentreId]
    );
    cardDirectId = ins[0].lastInsertRowid;
    allInsertedCardIds.push(cardDirectId);

    // Centre B (même site) — pour le test de sécurité (forgeage centreId sur getEscaladesResoluesCentre).
    const centreBRes = await dbQuery(
      `INSERT INTO t_centres (site_id, nom, numero, sync_id) VALUES (?, 'ZZTEST_CENTRE_B_AGT13', 2, ?)`,
      [ownSiteId, `zztest-centreb-agt13-${now}`]
    );
    centreBId = centreBRes[0].lastInsertRowid;

    ins = await dbQuery(
      `INSERT INTO t_cartes (noms, prenoms, date_de_naissance, lieu_de_naissance, num_secu, statut, statut_physique, escalade_niveau, agent_signalement_absence, date_signalement_absence, site_id, centre_id, rangement, updated_at)
       VALUES ('ZZTEST_CENTREB_ESCALADE_RESOLUE', 'X', '1990-01-01', 'ZZTEST_LIEU', ?, 'EN STOCK', 'OK', 'RESOLU', 'ZZTEST_GHOST', datetime('now'), ?, ?, 'BX-B9', datetime('now'))`,
      [`ZZTEST-SECU-CENTREB-ESC-${now}`, ownSiteId, centreBId]
    );
    cardCentreBEscaladeeResolueId = ins[0].lastInsertRowid;
    allInsertedCardIds.push(cardCentreBEscaladeeResolueId);
    await dbQuery(
      `INSERT INTO t_logs (id_user, login_user, action, detail, valeur_apres, sync_id, is_dirty, site_id) VALUES (NULL, 'ZZTEST_GHOST', 'CARTE_ABSENTE_ESCALADEE', 'zztest', ?, ?, 1, ?)`,
      [JSON.stringify({ read: false, id_carte: cardCentreBEscaladeeResolueId }), `zztest-esclog-${now}`, ownSiteId]
    );

    console.log(`[agent13][SETUP] cardRetrouvee=${cardRetrouveeId}, cardPerdue=${cardPerdueId}, cardDirect=${cardDirectId}, centreB=${centreBId}, cardCentreB=${cardCentreBEscaladeeResolueId}`);
  });

  // ═══════════════════════════════════════════════════════════════════
  // BLOC 1 — OPERATEUR_VERIFICATION : signalement des 3 cartes.
  // ═══════════════════════════════════════════════════════════════════
  test('1. OPERATEUR_VERIFICATION — signale l\'absence des 3 cartes de test', async () => {
    const { window } = env;
    const opVerif = getTestUser('operateurVerification');
    try {
      await loginAs(opVerif.login, opVerif.password, /#\/agent-verification/);

      await searchAndReportAbsence('ZZTEST_AGT13_RETROUVEE BENEF', '01/01/1980', 'ZZTEST_AGT13_RETROUVEE');
      await searchAndReportAbsence('ZZTEST_AGT13_PERDUE BENEF', '02/02/1980', 'ZZTEST_AGT13_PERDUE');
      await searchAndReportAbsence('ZZTEST_AGT13_DIRECT BENEF', '03/03/1980', 'ZZTEST_AGT13_DIRECT');

      const rows = await dbQuery(
        `SELECT id_carte, statut_physique, escalade_niveau, agent_signalement_absence FROM t_cartes WHERE id_carte IN (?, ?, ?)`,
        [cardRetrouveeId, cardPerdueId, cardDirectId]
      );
      const allAbsentCentre = rows.every((r: any) =>
        r.statut_physique === 'ABSENT' && r.escalade_niveau === 'CENTRE' && r.agent_signalement_absence === opVerif.login
      );
      verdict('BLOC1-SIGNALEMENTS', allAbsentCentre && rows.length === 3, `3 cartes signalées -> ${JSON.stringify(rows)}`);
      await window.screenshot({ path: join(SHOT_DIR, 'agt13-abs-1-signalements.png') });
      await logout();
    } catch (e: any) {
      verdict('BLOC1-SIGNALEMENTS', false, `EXCEPTION : ${e?.message || e}`);
      await logout().catch(() => {});
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // BLOC 2 — ADMIN_CENTRE : file d'attente, escalade x2, résolution directe x1.
  // ═══════════════════════════════════════════════════════════════════
  test('2. ADMIN_CENTRE — file d\'attente affiche les 3 signalements niveau CENTRE', async () => {
    const { window } = env;
    const adminCentre = getTestUser('adminCentre');
    try {
      await loginAs(adminCentre.login, adminCentre.password, /#\/admin-centre$/);
      await goHash('#/admin-centre/queue');
      await window.waitForURL(/#\/admin-centre\/queue/, { timeout: 15000 });
      await window.waitForTimeout(800);
      const bodyText = await window.locator('body').innerText();
      const allPresent = ['ZZTEST_AGT13_RETROUVEE', 'ZZTEST_AGT13_PERDUE', 'ZZTEST_AGT13_DIRECT'].every((n) => bodyText.includes(n));
      verdict('BLOC2-QUEUE-CENTRE', allPresent, `3 signalements visibles dans la file d'attente ADMIN_CENTRE=${allPresent}`);
      await window.screenshot({ path: join(SHOT_DIR, 'agt13-abs-2-queue-centre.png') });
    } catch (e: any) {
      verdict('BLOC2-QUEUE-CENTRE', false, `EXCEPTION : ${e?.message || e}`);
    }
  });

  test('3. ADMIN_CENTRE — escalade au site (cardRetrouvee, cardPerdue) et vérifie leur disparition de la file "niveau centre"', async () => {
    const { window } = env;
    try {
      for (const [label, name] of [['retrouvee', 'ZZTEST_AGT13_RETROUVEE'], ['perdue', 'ZZTEST_AGT13_PERDUE']] as const) {
        const row = window.locator('div.hover-scale', { hasText: name }).first();
        await row.getByRole('button', { name: /Escalader au Site/ }).click();
        await window.waitForTimeout(1000);
        console.log(`[agent13] Escalade ${label} déclenchée.`);
      }

      const bodyText = await window.locator('body').innerText();
      const disappeared = !bodyText.includes('ZZTEST_AGT13_RETROUVEE') && !bodyText.includes('ZZTEST_AGT13_PERDUE');
      const stillDirect = bodyText.includes('ZZTEST_AGT13_DIRECT');
      verdict('BLOC2-ESCALADE-UI', disappeared && stillDirect,
        `Après escalade : cartes escaladées disparues de la file centre=${disappeared}, carte non-escaladée toujours visible=${stillDirect}`);

      const rows = await dbQuery(
        `SELECT id_carte, escalade_niveau FROM t_cartes WHERE id_carte IN (?, ?)`,
        [cardRetrouveeId, cardPerdueId]
      );
      const bothSite = rows.every((r: any) => r.escalade_niveau === 'SITE');
      const logs = await dbQuery(
        `SELECT json_extract(valeur_apres, '$.id_carte') as id_carte FROM t_logs WHERE action = 'CARTE_ABSENTE_ESCALADEE' AND json_extract(valeur_apres, '$.id_carte') IN (?, ?)`,
        [cardRetrouveeId, cardPerdueId]
      );
      verdict('BLOC2-ESCALADE-DB', bothSite && logs.length === 2,
        `DB escalade_niveau='SITE' pour les 2 cartes=${bothSite}, logs CARTE_ABSENTE_ESCALADEE créés=${logs.length}/2`);
      await window.screenshot({ path: join(SHOT_DIR, 'agt13-abs-3-escalade.png') });
    } catch (e: any) {
      verdict('BLOC2-ESCALADE-UI', false, `EXCEPTION : ${e?.message || e}`);
    }
  });

  test('4. ADMIN_CENTRE — résout DIRECTEMENT cardDirect (sans escalade) — contrôle négatif "Escalades Résolues"', async () => {
    const { window } = env;
    try {
      const row = window.locator('div.hover-scale', { hasText: 'ZZTEST_AGT13_DIRECT' }).first();
      await row.locator('input[placeholder="Nouveau Rangement (Ex: TK 180)"]').fill('ZZTEST-RANGEMENT-DIRECT');
      await row.getByRole('button', { name: /Valider la relocalisation/ }).click();
      await window.waitForTimeout(1200);

      const rowDb = (await dbQuery(
        `SELECT statut_physique, escalade_niveau, rangement FROM t_cartes WHERE id_carte = ?`,
        [cardDirectId]
      ))[0];
      const ok = rowDb.statut_physique === 'OK' && rowDb.escalade_niveau === 'RESOLU' && rowDb.rangement === 'ZZTEST-RANGEMENT-DIRECT';
      verdict('BLOC2-DIRECT-RESOLVE', ok, `Résolution directe (non escaladée) -> ${JSON.stringify(rowDb)}`);

      // Non-régression TopBar (§2 mission) : toast "retrouvée" doit s'afficher (même fenêtre = même
      // session que celle qui vient d'exécuter l'action).
      const toastVisible = await window.getByText(/retrouvée et relocalisée/i).first().isVisible({ timeout: 6000 }).catch(() => false);
      verdict('TOPBAR-TOAST-RETROUVEE-1', toastVisible, `Toast "retrouvée et relocalisée" visible après resoudreAbsence (ADMIN_CENTRE, résolution directe)=${toastVisible}`);
      await window.screenshot({ path: join(SHOT_DIR, 'agt13-abs-4-direct-resolve.png') });
      await logout();
    } catch (e: any) {
      verdict('BLOC2-DIRECT-RESOLVE', false, `EXCEPTION : ${e?.message || e}`);
      await logout().catch(() => {});
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // BLOC 3 — ADMINISTRATEUR_SITE : traite les 2 signalements escaladés (2 branches).
  // ═══════════════════════════════════════════════════════════════════
  test('5. ADMINISTRATEUR_SITE — /admin/queue affiche les 2 escalades (pas la carte résolue directement)', async () => {
    const { window } = env;
    const adminSite = getTestUser('administrateurSite');
    try {
      await loginAs(adminSite.login, adminSite.password, /#\/dashboard/);
      await goHash('#/admin/queue');
      await window.waitForURL(/#\/admin\/queue/, { timeout: 15000 });
      await window.waitForTimeout(800);
      const bodyText = await window.locator('body').innerText();
      const bothPresent = bodyText.includes('ZZTEST_AGT13_RETROUVEE') && bodyText.includes('ZZTEST_AGT13_PERDUE');
      const directAbsent = !bodyText.includes('ZZTEST_AGT13_DIRECT');
      verdict('BLOC3-QUEUE-SITE', bothPresent && directAbsent,
        `Vue /admin/queue (ADMINISTRATEUR_SITE) : 2 cartes escaladées visibles=${bothPresent}, carte résolue directement absente=${directAbsent}`);
      await window.screenshot({ path: join(SHOT_DIR, 'agt13-abs-5-queue-site.png') });
    } catch (e: any) {
      verdict('BLOC3-QUEUE-SITE', false, `EXCEPTION : ${e?.message || e}`);
    }
  });

  test('6a. ADMINISTRATEUR_SITE — branche "Résolue/Retrouvée" (resoudreAbsence) — cœur du scénario', async () => {
    const { window } = env;
    try {
      const row = window.locator('div.hover-scale', { hasText: 'ZZTEST_AGT13_RETROUVEE' }).first();
      await row.locator('input[placeholder="Nouveau Rangement (Ex: TK 180)"]').fill('ZZTEST-RANGEMENT-SITE-RETR');
      await row.getByRole('button', { name: /Valider la relocalisation/ }).click();
      await window.waitForTimeout(1200);

      const rowDb = (await dbQuery(
        `SELECT statut_physique, escalade_niveau, rangement FROM t_cartes WHERE id_carte = ?`,
        [cardRetrouveeId]
      ))[0];
      const ok = rowDb.statut_physique === 'OK' && rowDb.escalade_niveau === 'RESOLU' && rowDb.rangement === 'ZZTEST-RANGEMENT-SITE-RETR';
      verdict('BLOC3-RESOLVE-DB', ok, `resoudreAbsence (escaladée) -> ${JSON.stringify(rowDb)} (attendu statut_physique=OK, escalade_niveau=RESOLU)`);

      // .first() : le même toast "retrouvée et relocalisée" (durée 6000ms, TopBar.tsx) peut
      // encore être affiché en pile depuis le test précédent (4., résolution directe par
      // ADMIN_CENTRE) au moment de ce check — deux éléments textuellement identiques
      // déclencheraient sinon une violation de "strict mode" Playwright silencieusement avalée
      // par le .catch(), faisant échouer à tort ce test alors que le toast est bien réel.
      const toastVisible = await window.getByText(/retrouvée et relocalisée/i).first().isVisible({ timeout: 6000 }).catch(() => false);
      verdict('TOPBAR-TOAST-RETROUVEE-2', toastVisible, `Toast "retrouvée et relocalisée" visible (ADMINISTRATEUR_SITE, résolution d'une escalade)=${toastVisible}`);
      await window.screenshot({ path: join(SHOT_DIR, 'agt13-abs-6a-resolve-site.png') });
    } catch (e: any) {
      verdict('BLOC3-RESOLVE-DB', false, `EXCEPTION : ${e?.message || e}`);
    }
  });

  test('6b. ADMINISTRATEUR_SITE — branche "Déclarée perdue" (declarerPerdue) — CŒUR DU CORRECTIF', async () => {
    const { window } = env;
    try {
      // Laisse le temps au toast "retrouvée et relocalisée" du test précédent (6a, durée 6000ms
      // configurée dans TopBar.tsx) de disparaître, pour ne pas fausser la vérification de
      // non-régression ci-dessous (un résidu visible serait un faux positif de méthode de test,
      // pas une vraie régression produit).
      await window.waitForTimeout(5500);
      const row = window.locator('div.hover-scale', { hasText: 'ZZTEST_AGT13_PERDUE' }).first();
      await row.getByRole('button', { name: /Déclarer Introuvable/ }).click();
      await window.waitForTimeout(1200);

      const rowDb = (await dbQuery(
        `SELECT statut_physique, escalade_niveau FROM t_cartes WHERE id_carte = ?`,
        [cardPerdueId]
      ))[0];
      // Cœur du correctif : escalade_niveau doit désormais valoir 'RESOLU' (jamais posé avant le fix).
      const ok = rowDb.statut_physique === 'PERDUE' && rowDb.escalade_niveau === 'RESOLU';
      verdict('BLOC3-DECLAREPERDUE-DB', ok, `declarerPerdue (escaladée) -> ${JSON.stringify(rowDb)} (attendu statut_physique=PERDUE, escalade_niveau=RESOLU — CORRECTIF)`);

      // Non-régression TopBar (§2 mission) : toast distinct, ne doit JAMAIS contenir "retrouvée".
      const toastPerdueVisible = await window.getByText(/déclarée définitivement perdue/i).first().isVisible({ timeout: 6000 }).catch(() => false);
      const bodyTextNow = await window.locator('body').innerText().catch(() => '');
      const wronglyMentionsRetrouvee = /carte introuvable a été retrouvée/i.test(bodyTextNow);
      verdict('TOPBAR-TOAST-PERDUE', toastPerdueVisible && !wronglyMentionsRetrouvee,
        `Toast "déclarée définitivement perdue" visible=${toastPerdueVisible}, message "retrouvée" affiché à tort=${wronglyMentionsRetrouvee} (attendu false)`);
      await window.screenshot({ path: join(SHOT_DIR, 'agt13-abs-6b-declareperdue-site.png') });
      await logout();
    } catch (e: any) {
      verdict('BLOC3-DECLAREPERDUE-DB', false, `EXCEPTION : ${e?.message || e}`);
      await logout().catch(() => {});
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // BLOC 4 — OPERATEUR_VERIFICATION : onglet "Résolus", badges dynamiques.
  // ═══════════════════════════════════════════════════════════════════
  test('7. OPERATEUR_VERIFICATION — onglet "Résolus" : badges dynamiques corrects pour les 3 cartes', async () => {
    const { window } = env;
    const opVerif = getTestUser('operateurVerification');
    try {
      await loginAs(opVerif.login, opVerif.password, /#\/agent-verification/);
      // Correction (investigation du run précédent) : le "Portail Vérification" (route
      // /agent-verification/recherche, composant RechercheView.tsx) N'A PAS d'onglet "Historique
      // Résolus" — ResolusTab.tsx est en réalité monté par SignalementsView.tsx, sur la route
      // /agent-verification/signalements (menu latéral "Recherche Rapide" pointe ailleurs). C'est
      // exactement la route que TopBar.tsx utilise lui-même (handleNotificationClick ->
      // navigate('/agent-verification/signalements?tab=resolus')) — confirmé en lisant le code
      // source, pas une supposition.
      await goHash('#/agent-verification/signalements?tab=resolus');
      await window.waitForURL(/#\/agent-verification\/signalements/, { timeout: 15000 });
      await window.waitForTimeout(1000);

      const rowRetrouvee = window.locator('div.hover-scale', { hasText: 'ZZTEST_AGT13_RETROUVEE' }).first();
      const rowPerdue = window.locator('div.hover-scale', { hasText: 'ZZTEST_AGT13_PERDUE' }).first();
      const rowDirect = window.locator('div.hover-scale', { hasText: 'ZZTEST_AGT13_DIRECT' }).first();

      const badgeRetrouvee = await rowRetrouvee.getByText('✅ Retrouvée').isVisible({ timeout: 8000 }).catch(() => false);
      const badgePerdue = await rowPerdue.getByText('❌ Perdue confirmée').isVisible({ timeout: 8000 }).catch(() => false);
      const badgeDirect = await rowDirect.getByText('✅ Retrouvée').isVisible({ timeout: 8000 }).catch(() => false);

      verdict('BLOC4-RESOLUSTAB-BADGES', badgeRetrouvee && badgePerdue && badgeDirect,
        `Badges -> cardRetrouvee(vert attendu)=${badgeRetrouvee}, cardPerdue(rouge "Perdue confirmée" attendu — CORRECTIF, avant le fix cette carte n'apparaissait JAMAIS ici)=${badgePerdue}, cardDirect(vert attendu)=${badgeDirect}`);
      await window.screenshot({ path: join(SHOT_DIR, 'agt13-abs-7-resolustab.png') });
      await logout();
    } catch (e: any) {
      verdict('BLOC4-RESOLUSTAB-BADGES', false, `EXCEPTION : ${e?.message || e}`);
      await logout().catch(() => {});
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // BLOC 5 — ADMIN_CENTRE : nouvel onglet "Escalades Résolues".
  // ═══════════════════════════════════════════════════════════════════
  test('8. ADMIN_CENTRE — onglet "Escalades Résolues" : montre les 2 cartes escaladées (pas la résolue directement)', async () => {
    const { window } = env;
    const adminCentre = getTestUser('adminCentre');
    try {
      await loginAs(adminCentre.login, adminCentre.password, /#\/admin-centre$/);
      await goHash('#/admin-centre/queue');
      await window.waitForURL(/#\/admin-centre\/queue/, { timeout: 15000 });
      await window.getByText('Escalades Résolues').first().click();
      await window.waitForTimeout(1000);

      const bodyText = await window.locator('body').innerText();
      const bothEscaladeesPresent = bodyText.includes('ZZTEST_AGT13_RETROUVEE') && bodyText.includes('ZZTEST_AGT13_PERDUE');
      // Non-régression #4 (mission) : la carte résolue SANS escalade ne doit JAMAIS apparaître ici,
      // même si son escalade_niveau vaut aussi 'RESOLU' — seul le filtre EXISTS sur le log
      // CARTE_ABSENTE_ESCALADEE doit faire la distinction.
      const directAbsent = !bodyText.includes('ZZTEST_AGT13_DIRECT');

      const rowRetrouvee = window.locator('div.hover-scale', { hasText: 'ZZTEST_AGT13_RETROUVEE' }).first();
      const rowPerdue = window.locator('div.hover-scale', { hasText: 'ZZTEST_AGT13_PERDUE' }).first();
      const badgeRetrouvee = await rowRetrouvee.getByText('✅ Retrouvée').isVisible({ timeout: 8000 }).catch(() => false);
      const badgePerdue = await rowPerdue.getByText('❌ Perdue confirmée').isVisible({ timeout: 8000 }).catch(() => false);

      verdict('BLOC5-ESCALADESRESOLUES', bothEscaladeesPresent && directAbsent && badgeRetrouvee && badgePerdue,
        `2 cartes escaladées+résolues visibles=${bothEscaladeesPresent} (badges vert=${badgeRetrouvee}, rouge=${badgePerdue}), ` +
        `carte résolue SANS escalade absente=${directAbsent} (filtre EXISTS log CARTE_ABSENTE_ESCALADEE)`);
      await window.screenshot({ path: join(SHOT_DIR, 'agt13-abs-8-escaladesresolues.png') });
    } catch (e: any) {
      verdict('BLOC5-ESCALADESRESOLUES', false, `EXCEPTION : ${e?.message || e}`);
    }
  });

  test('9. [Sécurité] cartes:getEscaladesResoluesCentre — appel forgé (Centre B) recadré sur le VRAI centre de session', async () => {
    const { window } = env;
    try {
      const forged = await window.evaluate(async (centreB) => {
        // @ts-expect-error API preload non typée ici — appel IPC direct forgé, comme un client compromis.
        return await window.api.cartes.getEscaladesResoluesCentre(centreB);
      }, centreBId);
      const noms = (forged as any[]).map((r) => r.noms);
      const leaked = noms.includes('ZZTEST_CENTREB_ESCALADE_RESOLUE');
      const ownDataPresent = noms.includes('ZZTEST_AGT13_RETROUVEE') || noms.includes('ZZTEST_AGT13_PERDUE');
      verdict('BLOC5-SECURITY-FORGED', !leaked && ownDataPresent,
        `Appel forgé centreId=${centreBId} (Centre B étranger) -> noms=${JSON.stringify(noms)} (fuite Centre B=${leaked} attendu false, données propres présentes=${ownDataPresent} attendu true)`);
    } catch (e: any) {
      verdict('BLOC5-SECURITY-FORGED', false, `EXCEPTION : ${e?.message || e}`);
    }
  });

  test('10. Onglet "Escalades Résolues" — visibilité stricte ADMIN_CENTRE (absent pour ADMINISTRATEUR_SITE sur /admin/queue)', async () => {
    const { window } = env;
    const adminSite = getTestUser('administrateurSite');
    try {
      await logout();
      await loginAs(adminSite.login, adminSite.password, /#\/dashboard/);
      await goHash('#/admin/queue');
      await window.waitForURL(/#\/admin\/queue/, { timeout: 15000 });
      await window.waitForTimeout(800);
      const tabVisible = await window.getByText('Escalades Résolues').isVisible({ timeout: 5000 }).catch(() => false);
      verdict('BLOC5-TAB-VISIBILITY', !tabVisible,
        `Onglet "Escalades Résolues" visible pour ADMINISTRATEUR_SITE sur /admin/queue (même composant AdminQueuePage)=${tabVisible} (attendu false — gate user.role==='ADMIN_CENTRE'). ` +
        `Note : /admin-centre/queue lui-même est INACCESSIBLE à ADMINISTRATEUR_SITE (route protégée requiredRoles=['ADMIN_CENTRE'], App.tsx) — non applicable, testé via /admin/queue qui partage le même composant AdminQueuePage.tsx.`);
      await window.screenshot({ path: join(SHOT_DIR, 'agt13-abs-10-tab-visibility-adminsite.png') });
      await logout();
    } catch (e: any) {
      verdict('BLOC5-TAB-VISIBILITY', false, `EXCEPTION : ${e?.message || e}`);
      await logout().catch(() => {});
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // BLOC 6 — Non-régression reactiverCarte (rafraîchissement CARTE_RETROUVEE).
  // ═══════════════════════════════════════════════════════════════════
  test('11. [Non-régression] reactiverCarte — réactivation d\'une carte PERDUE depuis l\'Historique des Pertes', async () => {
    const { window } = env;
    const adminSite = getTestUser('administrateurSite');
    try {
      await loginAs(adminSite.login, adminSite.password, /#\/dashboard/);
      await goHash('#/admin/queue');
      await window.waitForURL(/#\/admin\/queue/, { timeout: 15000 });
      await window.getByText('Historique des Pertes').click();
      await window.waitForTimeout(800);

      const row = window.locator('div.hover-scale', { hasText: 'ZZTEST_AGT13_PERDUE' }).first();
      const rowVisible = await row.isVisible({ timeout: 8000 }).catch(() => false);
      if (!rowVisible) {
        verdict('BLOC6-REACTIVER', false, `Carte PERDUE introuvable dans l'onglet "Historique des Pertes" — impossible de tester la réactivation.`);
      } else {
        await row.getByRole('button', { name: /Marquer comme Retrouvée/ }).click();
        await window.getByText('Réactivation de la Carte').waitFor({ state: 'visible', timeout: 8000 });
        const rangementInput = window.getByPlaceholder('Ex: TK 180');
        await rangementInput.fill('ZZTEST-RANGEMENT-REACTIVE');
        await window.getByRole('button', { name: 'Confirmer' }).click();
        await window.waitForTimeout(1200);

        const rowDb = (await dbQuery(
          `SELECT statut_physique, statut, rangement FROM t_cartes WHERE id_carte = ?`,
          [cardPerdueId]
        ))[0];
        const ok = rowDb.statut_physique === 'OK' && rowDb.statut === 'EN STOCK' && rowDb.rangement === 'ZZTEST-RANGEMENT-REACTIVE';
        verdict('BLOC6-REACTIVER', ok, `reactiverCarte -> ${JSON.stringify(rowDb)} (attendu statut_physique=OK, statut=EN STOCK)`);
      }
      await window.screenshot({ path: join(SHOT_DIR, 'agt13-abs-11-reactiver.png') });

      // Pas de gel de page après ce cycle complet (garde-fou mission §4).
      await goHash('#/admin/queue');
      await window.waitForURL(/#\/admin\/queue/, { timeout: 15000 });
      const stillResponsive = await window.getByText('File d\'attente de Traitement').isVisible({ timeout: 8000 }).catch(() => false);
      verdict('BLOC6-NOFREEZE', stillResponsive, `Page /admin/queue toujours réactive après le cycle complet (pas de gel)=${stillResponsive}`);
      await logout();
    } catch (e: any) {
      verdict('BLOC6-REACTIVER', false, `EXCEPTION : ${e?.message || e}`);
      await logout().catch(() => {});
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // BLOC 7 — Nettoyage exhaustif des données de test (§1 garde-fou).
  // ═══════════════════════════════════════════════════════════════════
  test('12. Nettoyage — suppression de toutes les données ZZTEST_ créées', async () => {
    for (const id of allInsertedCardIds) {
      await dbQuery(`DELETE FROM t_cartes WHERE id_carte = ?`, [id]);
    }
    await dbQuery(`DELETE FROM t_cartes WHERE noms LIKE 'ZZTEST_%'`);
    await dbQuery(`DELETE FROM t_logs WHERE login_user LIKE 'ZZTEST_%' OR detail LIKE '%ZZTEST%' OR (valeur_apres LIKE '%ZZTEST%')`);
    await dbQuery(`DELETE FROM t_logs WHERE json_extract(valeur_apres, '$.id_carte') IN (${allInsertedCardIds.map(() => '?').join(',') || 'NULL'})`, allInsertedCardIds);
    await dbQuery(`DELETE FROM t_centres WHERE nom LIKE 'ZZTEST_%'`);

    const remainingCards = (await dbQuery(`SELECT COUNT(*) as c FROM t_cartes WHERE noms LIKE 'ZZTEST_%'`))[0].c;
    const remainingCentres = (await dbQuery(`SELECT COUNT(*) as c FROM t_centres WHERE nom LIKE 'ZZTEST_%'`))[0].c;
    const allClean = remainingCards === 0 && remainingCentres === 0;
    verdict('NETTOYAGE', allClean, `Restants -> cartes=${remainingCards}, centres=${remainingCentres} (attendu 0 partout). Rappel : userDataDir jetable de toute façon supprimé au teardown.`);
  });
});
