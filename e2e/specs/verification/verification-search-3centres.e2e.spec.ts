/**
 * e2e/specs/verification/verification-search-3centres.e2e.spec.ts
 *
 * Test fonctionnel vivant (QA Terrain - agent-13) : confirmation du
 * cloisonnement "visible mais non délivrable" avec la topologie EXACTE
 * demandée — 1 site A avec TROIS centres nommés explicitement :
 *   - ZZTEST_CENTRE_1 (numero=1, donc "principal" au sens de
 *     isCentrePrincipal(), RechercheView.tsx:27-31), préfixe de rangement "A"
 *   - ZZTEST_CENTRE_2 (numero=2, non principal), préfixe "B"
 *   - ZZTEST_CENTRE_3 (numero=3, non principal), préfixe "C"
 *
 * Comportement attendu (déjà vérifié une première fois avec une topologie à
 * 2 centres dans verification-search.e2e.spec.ts, tests 14/15) : la
 * recherche de cartes n'est filtrée QUE par site_id (jamais par centre_id —
 * src/main/ipc/handlers.ts:339-359, useVerificationSearch.ts:100-102), donc
 * un opérateur OPERATEUR_VERIFICATION rattaché au Centre 3 DOIT voir dans
 * ses résultats les cartes rangées au Centre 1 ET au Centre 2, mais ne doit
 * PAS pouvoir les délivrer (ni via l'UI, ni via un appel IPC forcé
 * contournant l'UI) — seule sa propre carte (Centre 3) doit être
 * délivrable. Ce spec couvre explicitement le cas à DEUX centres non
 * principaux distincts (Centre 2 ET Centre 3) en plus du principal (Centre
 * 1), avec l'opérateur testé rattaché au centre le plus "éloigné"
 * (Centre 3 : ni principal, ni premier centre non-principal).
 *
 * Topologie entièrement isolée de celle de verification-search.e2e.spec.ts
 * (site/centres/cartes/compte dédiés, propre instance Electron) : aucune
 * dépendance croisée, aucun risque d'interférence entre les deux fichiers.
 *
 * Mécanisme vérifié en conditions réelles (voir seed-3-centres.js pour le
 * détail du seed) :
 *  - Visibilité : useVerificationSearch.ts filtre uniquement par site_id.
 *  - Blocage UI (liste SearchResults) : isAgentAuthorisedForCard()
 *    (RechercheView.tsx:119-135) compare le préfixe de rangement de l'agent
 *    (userCentre.prefixe_rangement) au rangement de la carte ; si non
 *    autorisé -> badge "Non autorisé pour votre Box" (SearchResults.tsx:
 *    327-340), bouton de retrait absent.
 *  - Blocage UI (modale, cas single-match auto-ouvert) : canDeliver
 *    (DeliveryModal.tsx:66-67, égalité STRICTE centre_id) désactive les 2
 *    boutons de l'étape 1.
 *  - Blocage serveur (source de vérité, non contournable) : delivrerCarte()
 *    (cartes.queries.ts:565-569) rejette avec "Cette carte appartient à un
 *    autre centre de distribution." si carte.centre_id !== currentUser.
 *    centre_id pour un rôle OPERATEUR_VERIFICATION — l'autorisation réelle
 *    est dérivée de la session serveur (getSecureCurrentUser(), handlers.ts:
 *    1053), jamais du 3e argument client passé à l'appel IPC (voir le forced
 *    call ci-dessous, dont ce 3e argument est donc volontairement ignoré
 *    côté serveur : c'est précisément ce qui rend ce test probant).
 *
 * Toute vérification d'état en base après action UI passe par le CLI
 * `sqlite3` en lecture seule sur <userDataDir>/data/gest_in_situ.db.
 */
import { test, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { teardownSeededApp, type E2EEnvironment } from '../../fixtures/electron-app';
import { runSeedInElectronNode } from '../../fixtures/seed-runner';
import { execFile, execFileSync } from 'child_process';
import { promisify } from 'util';
import { join, resolve } from 'path';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';

const execFileAsync = promisify(execFile);
const PROJECT_ROOT = resolve(__dirname, '../../..');
const MAIN_ENTRY_PROD = join(PROJECT_ROOT, 'dist', 'main', 'index.js');
const SEED_3_CENTRES_SCRIPT = 'C:\\Users\\EBYCHOCO\\AppData\\Local\\Temp\\claude\\d--Espace-travail-GEST-IN-SITU-CARTE-ABOBO-V2\\344cf3c3-4173-4a2a-bbd7-a341c1d208bf\\scratchpad\\seed-3-centres.js';

interface Seed3CentresResult {
  siteId: number;
  centre1Id: number;
  centre2Id: number;
  centre3Id: number;
  cardIds: Record<string, number>;
  opvCentre3: { login: string; password: string; id: number };
}

async function runSeed3Centres(userDataDir: string): Promise<Seed3CentresResult> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const electronPath = require('electron') as unknown as string;
  const { stdout, stderr } = await execFileAsync(
    electronPath,
    [SEED_3_CENTRES_SCRIPT, userDataDir],
    {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_PATH: join(PROJECT_ROOT, 'node_modules') },
      encoding: 'utf-8'
    }
  );
  console.log('[E2E][seed-3-centres][stdout]\n' + stdout);
  if (stderr) console.log('[E2E][seed-3-centres][stderr]\n' + stderr);
  const marker = '__SEED_3_CENTRES_RESULT__:';
  const line = stdout.split(/\r?\n/).reverse().find((l) => l.startsWith(marker));
  if (!line) {
    throw new Error(`[E2E] seed-3-centres.js n'a produit aucun résultat exploitable.\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`);
  }
  return JSON.parse(line.slice(marker.length));
}

/**
 * Copie locale minimale de `waitForMainWindow()` (electron-app.ts) : ce
 * fichier lance sa propre instance Electron (voir justification dans le
 * beforeAll ci-dessous — seed intégralement AVANT le lancement de l'app,
 * pour éliminer tout écrivain concurrent sur la base pendant que l'app
 * tourne, ce que `launchSeededApp()` ne permet pas nativement). Dupliquée
 * ici plutôt que modifiée/exportée depuis electron-app.ts (fichier de
 * fixture partagé, hors du périmètre de cette tâche — CLAUDE.md §4).
 */
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
      new Promise((resolve) => setTimeout(resolve, 500))
    ]);
  }
  throw new Error(`[E2E][3centres] Aucune fenêtre applicative détectée dans le délai de ${timeoutMs}ms.`);
}

function dbPathOf(userDataDir: string): string {
  return join(userDataDir, 'data', 'gest_in_situ.db');
}

function queryDb(dbPath: string, sql: string): string {
  // Pas de `shell: true` (voir verification-search.e2e.spec.ts pour le détail
  // empirique du problème de quoting Windows que cela évite).
  return execFileSync('sqlite3', [dbPath, sql], { encoding: 'utf-8' }).trim();
}

test.describe.serial('RechercheView — Topologie 3 centres nommés (ZZTEST_SITE_A) — Cloisonnement Centre 3 (agent-13, run complémentaire)', () => {
  let env: E2EEnvironment;
  let topo: Seed3CentresResult;
  let dbPath: string;
  let anyTestFailed = false;

  test.beforeAll(async () => {
    // Seed intégralement AVANT le lancement d'Electron (contrairement au
    // pattern habituel de launchSeededApp() + extra-seed EN COURS DE VIE de
    // l'app, utilisé par verification-search.e2e.spec.ts) : seeder la
    // topologie à 3 centres APRÈS le lancement de l'app (même pattern que
    // extra-seed-cards.js) a provoqué de façon reproductible (3/3 runs, voir
    // investigation agent-13) un "SqliteError: database disk image is
    // malformed" sur le PREMIER UPDATE émis par l'app (delivrerCarte(),
    // déclenchant trg_cartes_au -> écriture shadow FTS5), alors que PRAGMA
    // integrity_check et une lecture FTS5 directe depuis le process de seed
    // lui-même, juste avant sa fermeture, étaient tous deux "ok". Cause
    // probable : désynchronisation du wal-index entre la connexion longuement
    // ouverte de l'app et un écrivain externe (process electron.exe séparé)
    // ayant écrit pendant cette même fenêtre de vie. Ce spec seed donc
    // l'intégralité de sa topologie (seed de base + seed-3-centres.js) AVANT
    // tout `electron.launch()`, éliminant catégoriquement tout écrivain
    // concurrent pendant la vie de l'app — ce qui reproduit de surcroît plus
    // fidèlement la réalité d'un poste terrain (jamais 2 process n'écrivent
    // simultanément dans le même userData).
    const userDataDir = mkdtempSync(join(tmpdir(), 'gest-in-situ-e2e-'));
    const baseSeed = await runSeedInElectronNode(userDataDir);
    topo = await runSeed3Centres(userDataDir);

    const app = await electron.launch({
      args: [MAIN_ENTRY_PROD, `--user-data-dir=${userDataDir}`],
      env: { ...(process.env as Record<string, string>), GEST_IN_SITU_E2E_DISABLE_SYNC: '1' }
    });
    const window = await waitForMainWindow(app, 120_000);
    await window.waitForLoadState('domcontentloaded');

    env = { app, window, userDataDir, seed: baseSeed };
    dbPath = dbPathOf(env.userDataDir);
  });

  test.afterAll(async () => {
    if (env) {
      try {
        queryDb(dbPath, "DELETE FROM t_cartes WHERE noms LIKE 'ZZTEST_%';");
        queryDb(dbPath, "DELETE FROM t_centres WHERE nom LIKE 'ZZTEST_%';");
        queryDb(dbPath, "DELETE FROM t_sites WHERE nom LIKE 'ZZTEST_%';");
        queryDb(dbPath, "DELETE FROM t_user_roles WHERE id_user IN (SELECT id_user FROM t_users WHERE login LIKE 'ZZTEST_%');");
        queryDb(dbPath, "DELETE FROM t_users WHERE login LIKE 'ZZTEST_%';");
        queryDb(dbPath, "DELETE FROM audit_logs WHERE details LIKE '%ZZTEST%';");
        queryDb(dbPath, "DELETE FROM t_logs WHERE detail LIKE '%ZZTEST%';");
      } catch (e) {
        console.warn('[E2E] Nettoyage ZZTEST_ (3 centres) échoué (non bloquant, répertoire jetable de toute façon) :', e);
      }
      await teardownSeededApp(env, anyTestFailed);
    }
  });

  test.afterEach(async ({}, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus) {
      anyTestFailed = true;
    }
  });

  async function login(): Promise<void> {
    const { window } = env;
    await window.waitForURL(/#\/login/);
    await window.getByTestId('login-input').fill(topo.opvCentre3.login);
    await window.getByTestId('password-input').fill(topo.opvCentre3.password);
    await window.getByTestId('login-submit').click();
    await window.waitForURL(/#\/agent-verification$/, { timeout: 15000 });
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

  test('0. Connexion ZZTEST_OPV_CENTRE3 (OPERATEUR_VERIFICATION rattaché au Centre 3) + navigation Recherche Active', async () => {
    const { window } = env;
    await login();
    await expect(window.getByText('PORTAIL DE VÉRIFICATION')).toBeVisible();

    await goToRecherche();
    await expect(window.getByText('Base de données locale vide')).not.toBeVisible();
    await expect(window.getByPlaceholder('Ex: KOFFI KOFFI KAN')).toBeVisible();

    // Vérité terrain préalable : les 3 cartes ZZTEST existent bien en base, une par centre.
    const rows = queryDb(
      dbPath,
      `SELECT noms||'='||centre_id FROM t_cartes WHERE noms IN ('ZZTEST_CARTE_C1','ZZTEST_CARTE_C2','ZZTEST_CARTE_C3') ORDER BY noms;`
    ).split(/\r?\n/);
    expect(rows).toEqual([
      `ZZTEST_CARTE_C1=${topo.centre1Id}`,
      `ZZTEST_CARTE_C2=${topo.centre2Id}`,
      `ZZTEST_CARTE_C3=${topo.centre3Id}`
    ]);
  });

  test('1. ZZTEST_CARTE_C1 (Centre 1, PRINCIPAL numero=1) — visible mais NON délivrable pour l\'agent du Centre 3', async () => {
    const { window } = env;
    const idC1 = topo.cardIds.c1;

    await fillNameSearch('ZZTEST_CARTE_C1 PORTECARTE_UN', '01/01/1990');
    await submitNameSearch();

    // Match unique, non-absent -> auto-ouverture de la modale (useVerificationSearch.ts:126-136)
    // QUEL QUE SOIT le centre de la carte : la visibilité/ouverture n'est
    // conditionnée que par site_id, jamais par centre_id.
    await expect(deliveryModal()).toBeVisible({ timeout: 10000 });
    await expect(deliveryModal()).toContainText('ZZTEST_CARTE_C1');
    await expect(deliveryModal().getByText('A1', { exact: true })).toBeVisible();

    // canDeliver (DeliveryModal.tsx:66-67, égalité STRICTE centre_id) est faux
    // (centre1Id !== centre3Id de l'agent) -> les 2 boutons de l'étape 1 désactivés.
    const ouiButton = window.getByRole('button', { name: /Oui, j'ai la carte/ });
    const nonButton = window.getByRole('button', { name: /Non, absente/ });
    await expect(ouiButton).toBeDisabled();
    await expect(nonButton).toBeDisabled();
    await expect(ouiButton).toHaveAttribute('title', /pas l'autorisation/);

    // Fermeture de la modale -> la LISTE SearchResults sous-jacente (rendue en
    // permanence dès qu'il y a un résultat, indépendamment de l'overlay modal)
    // doit afficher le badge "Non autorisé" et AUCUN bouton "Procéder au Retrait"
    // pour cette carte : c'est le mécanisme isAgentAuthorisedForCard()
    // (RechercheView.tsx:119-135, comparaison de préfixe de rangement).
    await window.locator('.btn-close').click();
    await expect(deliveryModal()).not.toBeVisible();

    const row = window.locator('.card').filter({ hasText: 'ZZTEST_CARTE_C1' });
    await expect(row.getByText('Non autorisé pour votre Box')).toBeVisible({ timeout: 10000 });
    await expect(row.getByRole('button', { name: /Procéder au Retrait/ })).toHaveCount(0);

    const unchanged = queryDb(dbPath, `SELECT statut FROM t_cartes WHERE id_carte=${idC1};`);
    expect(unchanged).toBe('EN STOCK');
  });

  test('2. ZZTEST_CARTE_C2 (Centre 2, non principal numero=2) — visible mais NON délivrable pour l\'agent du Centre 3', async () => {
    const { window } = env;
    const idC2 = topo.cardIds.c2;

    await fillNameSearch('ZZTEST_CARTE_C2 PORTECARTE_DEUX', '02/01/1990');
    await submitNameSearch();

    await expect(deliveryModal()).toBeVisible({ timeout: 10000 });
    await expect(deliveryModal()).toContainText('ZZTEST_CARTE_C2');
    await expect(deliveryModal().getByText('B1', { exact: true })).toBeVisible();

    const ouiButton = window.getByRole('button', { name: /Oui, j'ai la carte/ });
    const nonButton = window.getByRole('button', { name: /Non, absente/ });
    await expect(ouiButton).toBeDisabled();
    await expect(nonButton).toBeDisabled();
    await expect(ouiButton).toHaveAttribute('title', /pas l'autorisation/);

    await window.locator('.btn-close').click();
    await expect(deliveryModal()).not.toBeVisible();

    const row = window.locator('.card').filter({ hasText: 'ZZTEST_CARTE_C2' });
    await expect(row.getByText('Non autorisé pour votre Box')).toBeVisible({ timeout: 10000 });
    await expect(row.getByRole('button', { name: /Procéder au Retrait/ })).toHaveCount(0);

    const unchanged = queryDb(dbPath, `SELECT statut FROM t_cartes WHERE id_carte=${idC2};`);
    expect(unchanged).toBe('EN STOCK');
  });

  test('3. ZZTEST_CARTE_C3 (Centre 3, PROPRE centre de l\'agent) — délivrance complète réussie, vérifiée en base', async () => {
    const { window } = env;
    const idC3 = topo.cardIds.c3;

    await fillNameSearch('ZZTEST_CARTE_C3 PORTECARTE_TROIS', '03/01/1990');
    await submitNameSearch();

    await expect(deliveryModal()).toBeVisible({ timeout: 10000 });
    await expect(deliveryModal()).toContainText('ZZTEST_CARTE_C3');
    await expect(deliveryModal().getByText('C1', { exact: true })).toBeVisible();

    // canDeliver vrai (centre_id de la carte === centre_id de l'agent) -> boutons actifs.
    const ouiButton = window.getByRole('button', { name: /Oui, j'ai la carte/ });
    await expect(ouiButton).toBeEnabled();
    await ouiButton.click();
    await expect(window.getByText('Validation du Retrait')).toBeVisible();

    const before = queryDb(dbPath, `SELECT statut, is_dirty FROM t_cartes WHERE id_carte=${idC3};`);
    expect(before).toBe('EN STOCK|0');

    await window.getByRole('button', { name: /Valider la délivrance/ }).click();
    await expect(window.getByText('Carte délivrée avec succès !')).toBeVisible({ timeout: 10000 });

    const after = queryDb(
      dbPath,
      `SELECT statut, is_dirty, centre_id, (date_delivrance IS NOT NULL) FROM t_cartes WHERE id_carte=${idC3};`
    );
    expect(after).toBe(`DELIVRE|1|${topo.centre3Id}|1`);
  });

  test('4. Délivrance forcée (appel IPC direct, contournant l\'UI) de ZZTEST_CARTE_C1 -> rejet serveur, statut inchangé', async () => {
    const { window } = env;
    const idC1 = topo.cardIds.c1;

    // Le 3e argument (contexte client) est volontairement incohérent avec la
    // réalité serveur : handlers.ts:1053 dérive l'identité EXCLUSIVEMENT de
    // getSecureCurrentUser() (session serveur non falsifiable), pas de ce
    // qu'un client IPC pourrait prétendre. Ce test documente donc bien un
    // rejet côté SOURCE DE VÉRITÉ, pas une simple restriction UI.
    const forcedResult = await window.evaluate(async (id) => {
      try {
        await (window as any).api.cartes.delivrer(id, {
          nom_retirant: 'ZZTEST_FORCED', num_retirant: '0000000000',
          type_retirant: 'ASSURE', agent_distributeur: 'ZZTEST_OPV_CENTRE3'
        }, { role: 'OPERATEUR_VERIFICATION', site_id: undefined, centre_id: undefined });
        return { ok: true };
      } catch (e: any) {
        return { ok: false, message: e?.message || String(e) };
      }
    }, idC1);

    expect(forcedResult.ok).toBe(false);
    expect(forcedResult.message).toContain('Cette carte appartient à un autre centre de distribution.');

    const unchanged = queryDb(dbPath, `SELECT statut FROM t_cartes WHERE id_carte=${idC1};`);
    expect(unchanged).toBe('EN STOCK');
  });

  test('5. Délivrance forcée (appel IPC direct, contournant l\'UI) de ZZTEST_CARTE_C2 -> rejet serveur, statut inchangé', async () => {
    const { window } = env;
    const idC2 = topo.cardIds.c2;

    const forcedResult = await window.evaluate(async (id) => {
      try {
        await (window as any).api.cartes.delivrer(id, {
          nom_retirant: 'ZZTEST_FORCED', num_retirant: '0000000000',
          type_retirant: 'ASSURE', agent_distributeur: 'ZZTEST_OPV_CENTRE3'
        }, { role: 'OPERATEUR_VERIFICATION', site_id: undefined, centre_id: undefined });
        return { ok: true };
      } catch (e: any) {
        return { ok: false, message: e?.message || String(e) };
      }
    }, idC2);

    expect(forcedResult.ok).toBe(false);
    expect(forcedResult.message).toContain('Cette carte appartient à un autre centre de distribution.');

    const unchanged = queryDb(dbPath, `SELECT statut FROM t_cartes WHERE id_carte=${idC2};`);
    expect(unchanged).toBe('EN STOCK');
  });
});
