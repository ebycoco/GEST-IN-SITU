/**
 * e2e/specs/_agent13_doublon_declaration.e2e.spec.ts
 *
 * QA Terrain (agent-13) — Test fonctionnel vivant de la déclaration manuelle de carte
 * "Doublon" avec blocage de délivrance (commit eccdbf9, feat(cartes)) :
 *   - `cartes:declarerDoublon(id, motif)` (RBAC : SUPER ADMIN, ADMINISTRATEUR_SITE,
 *     ADMIN_CENTRE, OPERATEUR_VERIFICATION, OPERATEUR_APUREMENT), motif obligatoire,
 *     rejette si déjà DELIVRE ou déjà DOUBLON.
 *   - `cartes:annulerDoublon(id, motifAnnulation)` (RBAC restreint : SUPER ADMIN,
 *     ADMINISTRATEUR_SITE, ADMIN_CENTRE — jamais l'opérateur déclarant).
 *   - Double verrou : `delivrerCarte()` ET `updateApurementHistorique()` (cahier
 *     historique) rejettent tous deux une carte DOUBLON.
 *   - 2 points d'entrée UI : Opérateur Vérification (DeliveryModal.tsx, résultats de
 *     recherche) et Opérateur Apurement (InventaireApurement.tsx, gaté par rôle —
 *     absent pour OPERATEUR_INVENTAIRE/OPERATEUR_LOGISTIQUE qui montent le même
 *     composant partagé via /inventaire).
 *
 * ── Contournement d'environnement (documenté, pas une modification de code) ────────
 * `dist/` (build de référence utilisé par tous les specs `_agent13_*` existants via
 * `launchSeededApp()`/`electron-app.ts`) datait du 15/08 — antérieur au commit testé
 * (16/08, eccdbf9) : il ne contenait ni les nouveaux handlers IPC, ni les changements
 * renderer. `npm run build`/`electron-vite build` sont interdits à l'initiative d'un
 * agent (CLAUDE.md §1, rôle agent-13 §"Protocole de Lancement"). `npm run dev` est en
 * revanche explicitement autorisé et documenté (electron.vite.config.ts, commentaire
 * "npm run dev (mode development) écrit aussi dans dist/ comme avant") comme
 * recompilant réellement `dist/main`/`dist/preload` à chaque lancement — utilisé ici
 * pour rafraîchir ces deux artefacts (confirmé par `grep declarerDoublon dist/main/index.js`
 * après coup). `dist/renderer/` n'est en revanche JAMAIS écrit par le mode dev (seul
 * `electron-vite build` le fait) : le renderer réel (DeliveryModal.tsx,
 * SearchResults.tsx, InventaireApurement.tsx, useVerificationSearch.ts modifiés par ce
 * commit) est donc servi ici en LIVE depuis un serveur de dev Vite autonome
 * (`.agent13-tmp-renderer-dev.mjs`, script temporaire supprimé en fin de session,
 * jamais committé), reproduisant fidèlement la configuration `renderer` de
 * `electron.vite.config.ts` (mêmes alias, même plugin React). L'auto-lancement
 * d'Electron intégré à `electron-vite dev`/`--rendererOnly` plante dans ce sandbox
 * (`Cannot read properties of undefined (reading 'isPackaged')`, cause : le process
 * spawné s'exécute sous Node pur au lieu du runtime Electron) et tue tout l'arbre de
 * process, y compris le serveur Vite — d'où l'usage du lanceur Playwright `_electron`
 * déjà éprouvé par tous les specs `_agent13_*` (fiable dans ce même sandbox), pointé
 * ici vers `dist/main/index.js` fraîchement recompilé + `ELECTRON_RENDERER_URL` fixé
 * sur ce serveur Vite autonome (`is.dev && process.env.ELECTRON_RENDERER_URL`,
 * src/main/index.ts:229-230, déjà supporté nativement par le code — aucune
 * modification de src/main/index.ts). Ceci reste un lancement 100% "dev mode" au sens
 * du protocole agent-13 : aucun artefact de packaging/build de production n'est
 * produit ni utilisé.
 *
 * Toute carte insérée directement en base par ce fichier porte le préfixe ZZTEST_DBL_
 * dans `noms`, et est supprimée en fin de fichier avec revérification explicite
 * (COUNT(*) = 0), de même que les site/centre secondaires créés pour les tests
 * d'isolation. Le userDataDir jetable est nettoyé par teardownSeededApp (fixture
 * partagée, réutilisée telle quelle, non modifiée).
 */
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { teardownSeededApp, type E2EEnvironment } from '../fixtures/electron-app';
import { runSeedInElectronNode } from '../fixtures/seed-runner';
import { getTestUser } from '../fixtures/test-users';
import { execFileSync } from 'child_process';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

const PROJECT_ROOT = resolve(__dirname, '../..');
const MAIN_ENTRY = join(PROJECT_ROOT, 'dist', 'main', 'index.js');
const RENDERER_DEV_URL = 'http://localhost:5173';

// ── Lanceur custom (voir bandeau ci-dessus) : identique à launchAppOnUserDataDir()
// (electron-app.ts) sur tous les points (isolation --user-data-dir, coupure réseau
// Supabase GEST_IN_SITU_E2E_DISABLE_SYNC=1, attente robuste de la fenêtre applicative
// hors splashscreen), à la seule différence de ELECTRON_RENDERER_URL ci-dessous.
async function waitForMainWindow(app: ElectronApplication, timeoutMs: number): Promise<Page> {
  const isSplash = (win: Page): boolean => {
    try {
      return win.isClosed() || win.url().includes('splash.html');
    } catch {
      return true;
    }
  };
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const candidate = app.windows().find((win) => !isSplash(win));
    if (candidate) return candidate;
    await Promise.race([
      app.waitForEvent('window', { timeout: 2000 }).catch(() => undefined),
      new Promise((r) => setTimeout(r, 500))
    ]);
  }
  throw new Error(`[agent13][doublon] Aucune fenêtre applicative détectée sous ${timeoutMs}ms.`);
}

async function launchLiveApp(userDataDir: string): Promise<{ app: ElectronApplication; window: Page }> {
  const baseEnv = { ...(process.env as Record<string, string>) };
  baseEnv.GEST_IN_SITU_E2E_DISABLE_SYNC = '1';
  baseEnv.ELECTRON_RENDERER_URL = RENDERER_DEV_URL;
  // ⚠️ Découverte empirique (sandbox de cette session) : le shell qui lance
  // `npx playwright test` hérite de `ELECTRON_RUN_AS_NODE=1` (visible via `env` en Bash) —
  // sans rapport avec le code applicatif. Sous cette variable, `electron.exe` s'exécute en
  // Node pur (`require('electron')` renvoie le chemin du binaire, pas l'API `app`), ce qui
  // fait planter IMMÉDIATEMENT tout main process Electron réel (`electron.app.isPackaged`
  // sur `undefined`), reproduit à l'identique même pour les specs `_agent13_*` déjà
  // établis et non modifiés par cette session. Purement défensif : supprimé explicitement
  // ici pour ce lancement, sans dépendre de l'état du shell appelant.
  delete baseEnv.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: [MAIN_ENTRY, `--user-data-dir=${userDataDir}`], env: baseEnv });
  const window = await waitForMainWindow(app, 120_000);
  await window.waitForLoadState('domcontentloaded');
  return { app, window };
}

function queryDb(dbPath: string, sql: string): string {
  return execFileSync('sqlite3', [dbPath, sql], { encoding: 'utf-8' }).trim();
}

test.describe.serial('Déclaration manuelle de carte DOUBLON — Vérification + Apurement (QA Terrain agent-13, commit eccdbf9)', () => {
  let env: E2EEnvironment;
  let dbPath: string;
  let anyTestFailed = false;

  // IDs de cartes ZZTEST_DBL_ créés au fil des tests, nettoyés en fin de fichier.
  const cardIds: Record<string, number> = {};
  let centre2Id = 0;
  let site2Id = 0;
  let centreSite2Id = 0;

  test.beforeAll(async () => {
    const userDataDir = mkdtempSync(join(tmpdir(), 'gest-in-situ-e2e-doublon-'));
    const seed = await runSeedInElectronNode(userDataDir);
    const { app, window } = await launchLiveApp(userDataDir);
    env = { app, window, userDataDir, seed };
    dbPath = join(userDataDir, 'data', 'gest_in_situ.db');

    // Vérification préalable : confirme que dist/main a bien été recompilé avec le
    // commit testé AVANT de lancer quoi que ce soit (sinon tout le reste du fichier
    // testerait une version stale de l'app, en silence).
    const preloadHasApi = await window.evaluate(() => typeof (window as any).api?.cartes?.declarerDoublon === 'function');
    console.log(`[agent13][DOUBLON][SETUP] window.api.cartes.declarerDoublon exposé côté preload = ${preloadHasApi} (attendu: true — sinon dist/ est stale)`);
    expect(preloadHasApi).toBe(true);

    // Second centre (même site) — isolation cross-centre (scénario 10a).
    const now = Date.now();
    queryDb(dbPath, `INSERT INTO t_centres (site_id, nom, numero, sync_id) VALUES (${env.seed.siteId}, 'ZZTEST_DBL Centre 2', 2, 'zztest-dbl-centre2-${now}');`);
    centre2Id = Number(queryDb(dbPath, `SELECT id FROM t_centres WHERE nom='ZZTEST_DBL Centre 2';`));

    // Second site + son centre — isolation cross-site (scénario 10b).
    queryDb(dbPath, `INSERT INTO t_sites (nom, code, is_active, max_centres, is_permanent, sync_id) VALUES ('ZZTEST_DBL Site 2', 'ZZTEST-DBL-SITE2-${now}', 1, 4, 1, 'zztest-dbl-site2-${now}');`);
    site2Id = Number(queryDb(dbPath, `SELECT id FROM t_sites WHERE nom='ZZTEST_DBL Site 2';`));
    queryDb(dbPath, `INSERT INTO t_centres (site_id, nom, numero, sync_id) VALUES (${site2Id}, 'ZZTEST_DBL Centre Site2', 1, 'zztest-dbl-centre-site2-${now}');`);
    centreSite2Id = Number(queryDb(dbPath, `SELECT id FROM t_centres WHERE nom='ZZTEST_DBL Centre Site2';`));

    console.log(`[agent13][DOUBLON][SETUP] site1=${env.seed.siteId} centre1=${env.seed.centreId} centre2(même site)=${centre2Id} site2=${site2Id} centreSite2=${centreSite2Id}`);
  });

  test.afterAll(async () => {
    if (env) {
      try {
        queryDb(dbPath, "DELETE FROM t_cartes WHERE noms LIKE 'ZZTEST_DBL_%';");
        const remainingCards = Number(queryDb(dbPath, "SELECT COUNT(*) FROM t_cartes WHERE noms LIKE 'ZZTEST_DBL_%';"));
        queryDb(dbPath, `DELETE FROM t_centres WHERE id IN (${centre2Id || 0}, ${centreSite2Id || 0});`);
        queryDb(dbPath, `DELETE FROM t_sites WHERE id = ${site2Id || 0};`);
        const remainingCentres = Number(queryDb(dbPath, "SELECT COUNT(*) FROM t_centres WHERE nom LIKE 'ZZTEST_DBL%';"));
        const remainingSites = Number(queryDb(dbPath, "SELECT COUNT(*) FROM t_sites WHERE nom LIKE 'ZZTEST_DBL%';"));
        console.log(
          `[agent13][DOUBLON][CLEANUP] cartes ZZTEST_DBL_ restantes=${remainingCards}, centres restants=${remainingCentres}, sites restants=${remainingSites} (attendu 0 partout)`
        );
      } catch (e) {
        console.warn('[agent13][DOUBLON][CLEANUP] Échec du nettoyage (non bloquant, répertoire jetable) :', e);
      }
      await teardownSeededApp(env, anyTestFailed);
    }
  });

  test.afterEach(async ({}, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus) {
      anyTestFailed = true;
    }
  });

  // ── Helpers de connexion ──────────────────────────────────────────────────
  async function login(loginStr: string, password: string, expectedUrlRe: RegExp): Promise<void> {
    const { window } = env;
    await window.waitForURL(/#\/login/, { timeout: 20000 });
    await window.getByTestId('login-input').fill(loginStr);
    await window.getByTestId('password-input').fill(password);
    await window.getByTestId('login-submit').click();
    await window.waitForURL(expectedUrlRe, { timeout: 20000 });
  }

  async function logout(): Promise<void> {
    const { window } = env;
    await window.locator('.btn-logout').click();
    await window.waitForURL(/#\/login/, { timeout: 15000 });
  }

  async function goToRechercheVerification(): Promise<void> {
    const { window } = env;
    await window.getByRole('link', { name: 'Recherche Active' }).click();
    await window.waitForURL(/#\/agent-verification\/recherche/, { timeout: 15000 });
  }

  async function fillNameSearch(nomComplet: string, ddn: string): Promise<void> {
    const { window } = env;
    await window.locator('input[placeholder="Ex: KOFFI KOFFI KAN"]').fill(nomComplet);
    await window.locator('input[placeholder="JJ/MM/AAAA"]').fill(ddn);
    await window.getByRole('button', { name: /Rechercher la Carte/ }).click();
  }

  function deliveryModal() {
    return env.window.locator('.card').filter({ hasText: /Vérification Physique|Déclaration de Doublon/ });
  }

  function insertCard(opts: {
    key: string;
    noms: string;
    statut: string;
    siteId: number;
    centreId?: number | null;
    ddn?: string;
  }): number {
    const { key, noms, statut, siteId, centreId, ddn } = opts;
    const now = Date.now();
    queryDb(
      dbPath,
      `INSERT INTO t_cartes (noms, prenoms, date_de_naissance, lieu_de_naissance, num_secu, statut, site_id, centre_id)
       VALUES ('${noms}', 'ZZTEST_PRENOM', '${ddn || '1988-04-12'}', 'ZZTEST_LIEU', 'ZZTEST-DBL-SECU-${now}-${key}', '${statut}', ${siteId}, ${centreId ?? 'NULL'});`
    );
    const id = Number(queryDb(dbPath, `SELECT id_carte FROM t_cartes WHERE noms='${noms}' ORDER BY id_carte DESC LIMIT 1;`));
    cardIds[key] = id;
    return id;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // SCÉNARIO 1 — Déclaration côté Vérification (OPERATEUR_VERIFICATION)
  // ═══════════════════════════════════════════════════════════════════════
  test('1. OPERATEUR_VERIFICATION déclare une carte EN STOCK en doublon — DB tracée, bandeau + bouton désactivé au re-scan', async () => {
    const { window } = env;
    const now = Date.now();
    const noms = `ZZTEST_DBL_V1_${now}`;
    const idCarte = insertCard({ key: 'v1', noms, statut: 'EN STOCK', siteId: env.seed.siteId, centreId: env.seed.centreId, ddn: '1988-04-12' });

    const user = getTestUser('operateurVerification');
    await login(user.login, user.password, /#\/agent-verification$/);
    await goToRechercheVerification();

    await fillNameSearch(`${noms} ZZTEST_PRENOM`, '12/04/1988');
    await expect(window.getByText('Vérification Physique')).toBeVisible({ timeout: 10000 });

    const doublonBtn = window.getByRole('button', { name: /C'est un doublon/ });
    await expect(doublonBtn).toBeEnabled();
    await doublonBtn.click();
    await expect(window.getByText('Déclaration de Doublon')).toBeVisible({ timeout: 5000 });

    const motif = `ZZTEST motif - le requérant présente déjà sa carte, délivrée au centre X (${now})`;
    await window.locator('textarea[placeholder^="Ex: Le requérant présente déjà"]').fill(motif);
    await window.getByRole('button', { name: /Confirmer le doublon/ }).click();
    await expect(window.getByText('Carte déclarée en doublon. Elle ne pourra plus être délivrée.')).toBeVisible({ timeout: 10000 });

    const row = queryDb(
      dbPath,
      `SELECT statut, statut_avant_doublon, doublon_declare_par, doublon_motif, is_dirty, (doublon_declare_le IS NOT NULL) FROM t_cartes WHERE id_carte=${idCarte};`
    );
    console.log(`[agent13][DOUBLON][1] État DB après déclaration : ${row}`);
    expect(row).toBe(`DOUBLON|EN STOCK|${user.login}|${motif}|1|1`);

    // Re-scan : bandeau motif/auteur/date + bouton désactivé, plus de "Procéder au Retrait".
    await fillNameSearch(`${noms} ZZTEST_PRENOM`, '12/04/1988');
    await expect(window.getByText('🚫 Déclarée en doublon')).toBeVisible({ timeout: 10000 });
    await expect(window.getByText(new RegExp(`Par ${user.login}`))).toBeVisible();
    await expect(window.getByText(new RegExp(motif.replace(/[()]/g, '\\$&')))).toBeVisible();
    const disabledBtn = window.getByRole('button', { name: /Doublon — non délivrable/ });
    await expect(disabledBtn).toBeVisible();
    await expect(disabledBtn).toBeDisabled();
    await expect(window.getByRole('button', { name: /Procéder au Retrait/ })).toHaveCount(0);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SCÉNARIO 2 — Blocage de la délivrance classique (double verrou, circuit 1)
  // ═══════════════════════════════════════════════════════════════════════
  test('2. Blocage de la délivrance classique sur la carte DOUBLON (appel direct cartes:delivrer) — statut inchangé', async () => {
    const { window } = env;
    const idCarte = cardIds['v1'];
    const before = queryDb(dbPath, `SELECT statut, is_dirty FROM t_cartes WHERE id_carte=${idCarte};`);

    const forced = await window.evaluate(async (id) => {
      try {
        await (window as any).api.cartes.delivrer(id, {
          nom_retirant: 'ZZTEST_FORCED', num_retirant: '0000000000', contact_retirant: '0000000000',
          type_retirant: 'ASSURE', agent_distributeur: 'E2E_OPERATEUR_VERIFICATION'
        });
        return { ok: true };
      } catch (e: any) {
        return { ok: false, message: e?.message || String(e) };
      }
    }, idCarte);

    console.log(`[agent13][DOUBLON][2] Tentative de délivrance forcée sur carte DOUBLON -> ${JSON.stringify(forced)}`);
    expect(forced.ok).toBe(false);
    expect(forced.message).toContain('déclarée en doublon et ne peut plus être délivrée');

    const after = queryDb(dbPath, `SELECT statut, is_dirty FROM t_cartes WHERE id_carte=${idCarte};`);
    expect(after).toBe(before);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SCÉNARIO 3 — Rejet si motif vide (UI + contournement direct)
  // ═══════════════════════════════════════════════════════════════════════
  test('3. Motif obligatoire — bouton désactivé côté UI sans motif, ET rejeté côté serveur si appel direct avec motif vide/espaces', async () => {
    const { window } = env;
    const now = Date.now();
    const noms = `ZZTEST_DBL_V2_${now}`;
    const idCarte = insertCard({ key: 'v2', noms, statut: 'EN STOCK', siteId: env.seed.siteId, centreId: env.seed.centreId, ddn: '1990-01-01' });

    await fillNameSearch(`${noms} ZZTEST_PRENOM`, '01/01/1990');
    await expect(window.getByText('Vérification Physique')).toBeVisible({ timeout: 10000 });
    await window.getByRole('button', { name: /C'est un doublon/ }).click();
    await expect(window.getByText('Déclaration de Doublon')).toBeVisible({ timeout: 5000 });

    const confirmBtn = window.getByRole('button', { name: /Confirmer le doublon/ });
    await expect(confirmBtn).toBeDisabled();

    // Contournement direct (motif vide, puis motif espaces-seulement) : le serveur doit
    // rejeter dans les deux cas, pas seulement l'UI.
    const emptyResult = await window.evaluate(async (id) => {
      try { await (window as any).api.cartes.declarerDoublon(id, ''); return { ok: true }; }
      catch (e: any) { return { ok: false, message: e?.message || String(e) }; }
    }, idCarte);
    const whitespaceResult = await window.evaluate(async (id) => {
      try { await (window as any).api.cartes.declarerDoublon(id, '   '); return { ok: true }; }
      catch (e: any) { return { ok: false, message: e?.message || String(e) }; }
    }, idCarte);

    console.log(`[agent13][DOUBLON][3] motif vide -> ${JSON.stringify(emptyResult)} | motif espaces -> ${JSON.stringify(whitespaceResult)}`);
    expect(emptyResult.ok).toBe(false);
    expect(emptyResult.message).toContain('obligatoire');
    expect(whitespaceResult.ok).toBe(false);
    expect(whitespaceResult.message).toContain('obligatoire');

    const unchanged = queryDb(dbPath, `SELECT statut FROM t_cartes WHERE id_carte=${idCarte};`);
    expect(unchanged).toBe('EN STOCK');

    await window.getByRole('button', { name: 'Retour' }).click();
    await window.locator('.btn-close').click().catch(() => {});
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SCÉNARIO 4 — Rejet si carte déjà DELIVRE
  // ═══════════════════════════════════════════════════════════════════════
  test('4. Rejet si la carte est déjà DELIVRE — message oriente vers la preuve de retrait, statut inchangé', async () => {
    const { window } = env;
    const now = Date.now();
    const noms = `ZZTEST_DBL_DELIVRE_${now}`;
    queryDb(
      dbPath,
      `INSERT INTO t_cartes (noms, prenoms, date_de_naissance, lieu_de_naissance, num_secu, statut, site_id, centre_id, agent_distributeur, date_delivrance, nom_retirant, num_retirant)
       VALUES ('${noms}', 'ZZTEST_PRENOM', '1980-06-15', 'ZZTEST_LIEU', 'ZZTEST-DBL-SECU-DELIVRE-${now}', 'DELIVRE', ${env.seed.siteId}, ${env.seed.centreId}, 'E2E_OPERATEUR_VERIFICATION', '2026-01-10', 'ZZTEST RETIRANT', '0700000099');`
    );
    const idCarte = Number(queryDb(dbPath, `SELECT id_carte FROM t_cartes WHERE noms='${noms}';`));
    cardIds['delivre'] = idCarte;

    // Chemin UI normal : impossible d'atteindre le bouton "doublon" pour une carte
    // DELIVRE (useVerificationSearch.ts ouvre directement DeliveryProofModal, jamais
    // DeliveryModal). Vérifié ici avant le contournement direct.
    await fillNameSearch(`${noms} ZZTEST_PRENOM`, '15/06/1980');
    await expect(window.getByRole('heading', { name: 'Preuve de Retrait' })).toBeVisible({ timeout: 10000 });
    await expect(window.getByText('Déclaration de Doublon')).not.toBeVisible();
    await window.locator('.btn-close').click();

    const forced = await window.evaluate(async (id) => {
      try { await (window as any).api.cartes.declarerDoublon(id, 'ZZTEST tentative sur carte deja delivree'); return { ok: true }; }
      catch (e: any) { return { ok: false, message: e?.message || String(e) }; }
    }, idCarte);

    console.log(`[agent13][DOUBLON][4] Déclaration forcée sur carte DELIVRE -> ${JSON.stringify(forced)}`);
    expect(forced.ok).toBe(false);
    expect(forced.message).toContain('déjà été délivrée');
    expect(forced.message).toContain('preuve de retrait');

    const unchanged = queryDb(dbPath, `SELECT statut FROM t_cartes WHERE id_carte=${idCarte};`);
    expect(unchanged).toBe('DELIVRE');

    await logout();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SCÉNARIO 5 + 7 — Déclaration côté Apurement, puis blocage de l'émargement
  // rétroactif sur cette même carte désormais DOUBLON (double verrou, circuit 2).
  // ═══════════════════════════════════════════════════════════════════════
  test('5+7. OPERATEUR_APUREMENT déclare une carte doublon depuis le cahier historique, puis l\'émargement rétroactif sur cette carte est bloqué', async () => {
    const { window } = env;
    const now = Date.now();
    const noms = `ZZTEST_DBL_AP1_${now}`;
    const idCarte = insertCard({ key: 'ap1', noms, statut: 'EN STOCK', siteId: env.seed.siteId, centreId: env.seed.centreId, ddn: '1975-03-20' });

    const user = getTestUser('operateurApurement');
    await login(user.login, user.password, /#\/apurement$/);
    await window.getByText("TRAVAIL D'APUREMENT").click();
    await expect(window.getByPlaceholder('Saisir nom & prénoms...')).toBeVisible({ timeout: 10000 });
    await window.getByPlaceholder('Saisir nom & prénoms...').fill(noms);
    await window.getByRole('button', { name: /Rechercher/ }).click();
    await expect(window.getByText(`${noms} ZZTEST_PRENOM`)).toBeVisible({ timeout: 10000 });
    await window.getByText(`${noms} ZZTEST_PRENOM`).click();

    // Non-régression : pas de modale "carte déjà déchargée" pour une carte EN STOCK.
    await expect(window.getByText('Carte déjà déchargée')).not.toBeVisible();
    await expect(window.getByText('Dossier Sélectionné')).toBeVisible({ timeout: 10000 });

    const marquerBtn = window.getByRole('button', { name: /Marquer comme doublon/ });
    await expect(marquerBtn).toBeVisible();
    await marquerBtn.click();

    const motif = `ZZTEST motif apurement - cahier historique (${now})`;
    await window.locator('textarea[placeholder^="Motif obligatoire"]').fill(motif);
    await window.getByRole('button', { name: /Confirmer le doublon/ }).click();
    await expect(window.getByText('Carte déclarée en doublon. Elle ne pourra plus être émargée.')).toBeVisible({ timeout: 10000 });

    const row = queryDb(
      dbPath,
      `SELECT statut, statut_avant_doublon, doublon_declare_par, doublon_motif FROM t_cartes WHERE id_carte=${idCarte};`
    );
    console.log(`[agent13][DOUBLON][5] État DB après déclaration côté Apurement : ${row}`);
    expect(row).toBe(`DOUBLON|EN STOCK|${user.login}|${motif}`);

    // Scénario 7 — sur cette même carte désormais DOUBLON : ré-sélection possible sans
    // avertissement dédié (seul DELIVRE déclenche une modale — écart UX documenté dans
    // le rapport), mais la VALIDATION doit être bloquée côté serveur (double verrou).
    await expect(window.getByPlaceholder('Saisir nom & prénoms...')).toBeVisible({ timeout: 10000 });
    await window.getByPlaceholder('Saisir nom & prénoms...').fill(noms);
    await window.getByRole('button', { name: /Rechercher/ }).click();
    await expect(window.getByText(`${noms} ZZTEST_PRENOM`)).toBeVisible({ timeout: 10000 });
    await window.getByText(`${noms} ZZTEST_PRENOM`).click();
    await expect(window.getByText('Carte déjà déchargée')).not.toBeVisible();
    await expect(window.getByText('Dossier Sélectionné')).toBeVisible({ timeout: 10000 });

    await window.locator('input[placeholder="Ex: 0707..."]').fill('0711111111');
    await window.getByRole('button', { name: /Valider l'Apurement/ }).click();
    await expect(window.getByText(/Erreur d'enregistrement.*doublon.*émargée/)).toBeVisible({ timeout: 10000 });

    const afterAttempt = queryDb(dbPath, `SELECT statut, num_retirant FROM t_cartes WHERE id_carte=${idCarte};`);
    console.log(`[agent13][DOUBLON][7] État DB après tentative d'émargement rétroactif bloquée : ${afterAttempt}`);
    expect(afterAttempt).toBe('DOUBLON|');

    await logout();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SCÉNARIO 6 — Gate du bouton par rôle (composant partagé InventaireApurement.tsx)
  // ═══════════════════════════════════════════════════════════════════════
  test('6. OPERATEUR_INVENTAIRE sur /inventaire — bouton "Marquer comme doublon" ABSENT (composant partagé, gaté par rôle) + IPC refusé', async () => {
    const { window } = env;
    const now = Date.now();
    const noms = `ZZTEST_DBL_INV1_${now}`;
    const idCarte = insertCard({ key: 'inv1', noms, statut: 'EN STOCK', siteId: env.seed.siteId, centreId: env.seed.centreId, ddn: '1992-09-09' });

    const user = getTestUser('operateurInventaire');
    await login(user.login, user.password, /#\/inventaire$/);
    await window.getByRole('button', { name: /APUREMENT HISTORIQUE/ }).click();
    await expect(window.getByPlaceholder('Saisir nom & prénoms...')).toBeVisible({ timeout: 10000 });
    await window.getByPlaceholder('Saisir nom & prénoms...').fill(noms);
    await window.getByRole('button', { name: /Rechercher/ }).click();
    await expect(window.getByText(`${noms} ZZTEST_PRENOM`)).toBeVisible({ timeout: 10000 });
    await window.getByText(`${noms} ZZTEST_PRENOM`).click();
    await expect(window.getByText('Dossier Sélectionné')).toBeVisible({ timeout: 10000 });

    const marquerBtn = window.getByRole('button', { name: /Marquer comme doublon/ });
    await expect(marquerBtn).toHaveCount(0);
    console.log('[agent13][DOUBLON][6] Bouton "Marquer comme doublon" absent du DOM pour OPERATEUR_INVENTAIRE : conforme.');

    // RBAC serveur (défense en profondeur) : même en contournant l'absence du bouton,
    // OPERATEUR_INVENTAIRE n'est pas dans la liste des rôles autorisés à declarerDoublon.
    const forced = await window.evaluate(async (id) => {
      try { await (window as any).api.cartes.declarerDoublon(id, 'ZZTEST tentative role non autorise'); return { ok: true }; }
      catch (e: any) { return { ok: false, message: e?.message || String(e) }; }
    }, idCarte);
    console.log(`[agent13][DOUBLON][6][RBAC] declarerDoublon appelé directement par OPERATEUR_INVENTAIRE -> ${JSON.stringify(forced)}`);
    expect(forced.ok).toBe(false);
    expect(forced.message).toContain('Accès refusé');

    const unchanged = queryDb(dbPath, `SELECT statut FROM t_cartes WHERE id_carte=${idCarte};`);
    expect(unchanged).toBe('EN STOCK');

    await logout();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SCÉNARIO 8 — Annulation par superviseur (ADMIN_CENTRE) — AUCUNE UI n'existe pour
  // cette action (voir rapport) : appel direct de l'API exposée en preload, comme
  // prescrit par la tâche en cas de circuit UI non disponible.
  // ═══════════════════════════════════════════════════════════════════════
  test('8. ADMIN_CENTRE annule la déclaration de doublon du scénario 1 — statut restauré, historique de déclaration préservé', async () => {
    const { window } = env;
    const idCarte = cardIds['v1'];
    const beforeAnnulation = queryDb(
      dbPath,
      `SELECT doublon_declare_par, doublon_motif, doublon_declare_le FROM t_cartes WHERE id_carte=${idCarte};`
    );

    const user = getTestUser('adminCentre');
    await login(user.login, user.password, /#\/admin-centre$/);

    const motifAnnulation = 'ZZTEST_DBL annulation - verification faite, ce n\'est pas un doublon';
    const result = await window.evaluate(
      async ({ id, motif }) => {
        try { const res = await (window as any).api.cartes.annulerDoublon(id, motif); return { ok: true, res }; }
        catch (e: any) { return { ok: false, message: e?.message || String(e) }; }
      },
      { id: idCarte, motif: motifAnnulation }
    );
    console.log(`[agent13][DOUBLON][8] Annulation par ADMIN_CENTRE -> ${JSON.stringify(result)}`);
    expect(result.ok).toBe(true);

    const after = queryDb(
      dbPath,
      `SELECT statut, doublon_annule_par, doublon_motif_annulation, (doublon_annule_le IS NOT NULL), doublon_declare_par, doublon_motif, doublon_declare_le FROM t_cartes WHERE id_carte=${idCarte};`
    );
    console.log(`[agent13][DOUBLON][8] État DB après annulation : ${after} | (avant, pour comparaison historique) : ${beforeAnnulation}`);
    const parts = after.split('|');
    expect(parts[0]).toBe('EN STOCK');
    expect(parts[1]).toBe(user.login);
    expect(parts[2]).toBe(motifAnnulation);
    expect(parts[3]).toBe('1');
    // Historique de la déclaration d'origine JAMAIS écrasé.
    expect(`${parts[4]}|${parts[5]}|${parts[6]}`).toBe(beforeAnnulation);

    await logout();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SCÉNARIO 9 — RBAC annulation : ni l'opérateur déclarant, ni un opérateur tiers
  // non-superviseur ne peuvent annuler. Aucune UI n'existe pour cette action (voir
  // scénario 8) : contournement direct assumé, conforme au fallback prévu par la tâche.
  // ═══════════════════════════════════════════════════════════════════════
  test('9. RBAC — ni OPERATEUR_APUREMENT (déclarant) ni OPERATEUR_VERIFICATION ne peuvent annuler la déclaration du scénario 5', async () => {
    const { window } = env;
    const idCarte = cardIds['ap1'];
    const apurementUser = getTestUser('operateurApurement');
    const verifUser = getTestUser('operateurVerification');

    await login(apurementUser.login, apurementUser.password, /#\/apurement$/);
    const asDeclarant = await window.evaluate(async (id) => {
      try { await (window as any).api.cartes.annulerDoublon(id, 'ZZTEST tentative annulation par le declarant lui-meme'); return { ok: true }; }
      catch (e: any) { return { ok: false, message: e?.message || String(e) }; }
    }, idCarte);
    console.log(`[agent13][DOUBLON][9] Annulation tentée par OPERATEUR_APUREMENT (déclarant lui-même) -> ${JSON.stringify(asDeclarant)}`);
    expect(asDeclarant.ok).toBe(false);
    expect(asDeclarant.message).toContain('Accès refusé');
    await logout();

    await login(verifUser.login, verifUser.password, /#\/agent-verification$/);
    const asThirdParty = await window.evaluate(async (id) => {
      try { await (window as any).api.cartes.annulerDoublon(id, 'ZZTEST tentative annulation par tiers non superviseur'); return { ok: true }; }
      catch (e: any) { return { ok: false, message: e?.message || String(e) }; }
    }, idCarte);
    console.log(`[agent13][DOUBLON][9] Annulation tentée par OPERATEUR_VERIFICATION (tiers) -> ${JSON.stringify(asThirdParty)}`);
    expect(asThirdParty.ok).toBe(false);
    expect(asThirdParty.message).toContain('Accès refusé');

    const unchanged = queryDb(dbPath, `SELECT statut FROM t_cartes WHERE id_carte=${idCarte};`);
    expect(unchanged).toBe('DOUBLON');

    await logout();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SCÉNARIO 10 — Isolation site/centre : ADMIN_CENTRE / OPERATEUR_VERIFICATION ne
  // peuvent ni déclarer ni annuler un doublon sur une carte d'un autre centre (même
  // site) ou d'un autre site.
  // ═══════════════════════════════════════════════════════════════════════
  test('10a. ADMIN_CENTRE et OPERATEUR_VERIFICATION ne peuvent pas déclarer un doublon sur une carte d\'un AUTRE CENTRE (même site)', async () => {
    const { window } = env;
    const now = Date.now();
    const noms = `ZZTEST_DBL_XCENTRE_${now}`;
    const idCarte = insertCard({ key: 'xcentre', noms, statut: 'EN STOCK', siteId: env.seed.siteId, centreId: centre2Id, ddn: '1995-05-05' });

    const adminCentreUser = getTestUser('adminCentre');
    await login(adminCentreUser.login, adminCentreUser.password, /#\/admin-centre$/);
    const asAdminCentre = await window.evaluate(async (id) => {
      try { await (window as any).api.cartes.declarerDoublon(id, 'ZZTEST tentative cross-centre admin_centre'); return { ok: true }; }
      catch (e: any) { return { ok: false, message: e?.message || String(e) }; }
    }, idCarte);
    console.log(`[agent13][DOUBLON][10a] ADMIN_CENTRE (centre1) sur carte de centre2 -> ${JSON.stringify(asAdminCentre)}`);
    expect(asAdminCentre.ok).toBe(false);
    expect(asAdminCentre.message).toContain('autre centre');
    await logout();

    const verifUser = getTestUser('operateurVerification');
    await login(verifUser.login, verifUser.password, /#\/agent-verification$/);
    const asVerif = await window.evaluate(async (id) => {
      try { await (window as any).api.cartes.declarerDoublon(id, 'ZZTEST tentative cross-centre operateur_verification'); return { ok: true }; }
      catch (e: any) { return { ok: false, message: e?.message || String(e) }; }
    }, idCarte);
    console.log(`[agent13][DOUBLON][10a] OPERATEUR_VERIFICATION (centre1) sur carte de centre2 -> ${JSON.stringify(asVerif)}`);
    expect(asVerif.ok).toBe(false);
    expect(asVerif.message).toContain('autre centre');

    const unchanged = queryDb(dbPath, `SELECT statut FROM t_cartes WHERE id_carte=${idCarte};`);
    expect(unchanged).toBe('EN STOCK');
    await logout();
  });

  test('10b. OPERATEUR_VERIFICATION (site 1) ne peut pas déclarer un doublon sur une carte d\'un AUTRE SITE', async () => {
    const { window } = env;
    const now = Date.now();
    const noms = `ZZTEST_DBL_XSITE_${now}`;
    const idCarte = insertCard({ key: 'xsite', noms, statut: 'EN STOCK', siteId: site2Id, centreId: centreSite2Id, ddn: '1997-07-07' });

    const verifUser = getTestUser('operateurVerification');
    await login(verifUser.login, verifUser.password, /#\/agent-verification$/);
    const result = await window.evaluate(async (id) => {
      try { await (window as any).api.cartes.declarerDoublon(id, 'ZZTEST tentative cross-site'); return { ok: true }; }
      catch (e: any) { return { ok: false, message: e?.message || String(e) }; }
    }, idCarte);
    console.log(`[agent13][DOUBLON][10b] OPERATEUR_VERIFICATION (site1) sur carte de site2 -> ${JSON.stringify(result)}`);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('introuvable');

    const unchanged = queryDb(dbPath, `SELECT statut, site_id FROM t_cartes WHERE id_carte=${idCarte};`);
    expect(unchanged).toBe(`EN STOCK|${site2Id}`);
    await logout();
  });
});
