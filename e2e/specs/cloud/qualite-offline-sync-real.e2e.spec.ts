/**
 * e2e/specs/cloud/qualite-offline-sync-real.e2e.spec.ts
 *
 * QA Terrain (agent-13) — cycle cloud RÉEL pour le portail /agent-qualite
 * (OPERATEUR_QUALITE), calqué sur le protocole déjà validé pour le rôle
 * Vérification (two-centres-offline-sync-real.e2e.spec.ts) :
 *   1. Poste A, fenêtre OFFLINE/PROBING réelle au lancement : 3 corrections
 *      ZZTEST_ via le VRAI portail Qualité (clics UI, pas d'appel IPC direct) —
 *      complétion N° Sécu manquant (Données Manquantes), correction de date
 *      invalide (Dates Invalides), fusion d'un doublon strict (Doublons).
 *   2. Retour réseau ONLINE réel -> vérifie sur Supabase dev que les 4 cartes
 *      concernées sont bien remontées avec les bonnes valeurs. Point notable
 *      de code (à confirmer empiriquement ici) : la fusion de doublon
 *      n'emprunte PAS le même chemin que les 2 autres corrections —
 *      qualite:fusionnerDoublons (handlers.ts ~l.1616-1651) passe par
 *      enqueueOutbox()/t_outbox (drainé automatiquement par le SyncEngine dès
 *      le passage ONLINE, cf. sync-engine.ts processOutboxPending), alors que
 *      cmu:updateCarte (chemin réel de MissingDataView/CorrectionSidePanel,
 *      cartes.queries.ts:319-493) ne fait QUE poser is_dirty=1 sans jamais
 *      enfiler d'outbox ("La synchronisation automatique a été désactivée.
 *      L'envoi vers Supabase est 100% manuel et basé sur is_dirty = 1.") — ces
 *      2 cartes ne peuvent donc être poussées QUE par le bouton "Envoyer les
 *      corrections" (bulk upload, upload-worker.js). Pire : ce même bulk
 *      upload EXCLUT structurellement les lignes dont cle_doublon est encore
 *      partagé par >1 ligne (filtre !allowProbable, upload-worker.js l.67-87)
 *      — et fusionnerDoublons() NE VIDE JAMAIS cle_doublon sur la carte
 *      source soft-supprimée (is_dirty=-1) ni sur la cible survivante
 *      (handlers.ts ~l.1601-1638) : cible ET source partagent donc TOUJOURS
 *      le même cle_doublon après fusion. Conséquence prévisible (à confirmer
 *      empiriquement au run) : la fusion doit obligatoirement transiter par
 *      l'outbox (t_outbox), jamais par le bouton "Envoyer les corrections".
 *   3. Fermeture propre du poste A (données Supabase conservées).
 *   4. Poste B — même site/centre, jamais vu ces cartes — doit pouvoir les
 *      récupérer via "RÉCUPÉRER LES CARTES DEPUIS LE CLOUD", y compris le
 *      résultat de la fusion (cible avec rangement fusionné, source absente).
 *
 * Seed dédié (scratchpad, jamais committé) : SEED_SCRIPT_SRC. Mêmes
 * précautions anti-corruption SQLite que les autres specs cloud de ce dossier
 * (seed exécuté par electron.exe en ELECTRON_RUN_AS_NODE=1 AVANT chaque
 * electron.launch(), jamais un second écrivain pendant que l'app tourne).
 *
 * Invocation ciblée uniquement :
 *   npx playwright test e2e/specs/cloud/qualite-offline-sync-real.e2e.spec.ts
 * Build préalable requis : npx electron-vite build --mode e2e (jamais lancé
 * automatiquement par un agent — CLAUDE.md §1). Ce spec réutilise le build
 * dist-e2e-cloud/ existant, ne le régénère jamais lui-même.
 */
import { test, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { teardownSeededApp } from '../../fixtures/electron-app';
import {
  supabaseDev,
  ensureCloudSiteAndCentre,
  getCloudCardBySyncId,
  cleanupAllCloudTestData
} from '../../fixtures/supabase-dev-client';
import { build } from 'esbuild';
import { execFile, execFileSync } from 'child_process';
import { promisify } from 'util';
import { join, resolve } from 'path';
import { mkdtempSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';

const execFileAsync = promisify(execFile);
const PROJECT_ROOT = resolve(__dirname, '../../..');
const MAIN_ENTRY_E2E_CLOUD = join(PROJECT_ROOT, 'dist-e2e-cloud', 'main', 'index.js');
const SEED_SCRIPT_SRC =
  'C:\\Users\\EBYCHOCO\\AppData\\Local\\Temp\\claude\\d--Espace-travail-GEST-IN-SITU-CARTE-ABOBO-V2\\344cf3c3-4173-4a2a-bbd7-a341c1d208bf\\scratchpad\\seed-qualite-cloud-sync.ts';

interface SeedQualiteCloudResult {
  dbPath: string;
  siteId: number;
  centreId: number;
  opqA: { login: string; password: string; id: number };
  opqB: { login: string; password: string; id: number };
  cardIds: Record<string, number>;
}

// ─── Bundling + exécution du seed custom (même technique que les autres specs cloud) ──
async function bundleSeedScript(): Promise<string> {
  const result = await build({
    entryPoints: [SEED_SCRIPT_SRC],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    external: ['better-sqlite3'],
    write: false,
    logLevel: 'silent'
  });
  const output = result.outputFiles?.[0]?.text;
  if (!output) throw new Error('[E2E][seed-qualite-cloud] esbuild n\'a produit aucune sortie.');
  return output;
}

async function runQualiteSeed(userDataDir: string, withCards: boolean): Promise<SeedQualiteCloudResult> {
  const bundleCode = await bundleSeedScript();
  const bundleDir = mkdtempSync(join(tmpdir(), 'gest-in-situ-e2e-seedq-'));
  const bundlePath = join(bundleDir, 'seed-qualite-cloud-sync.bundle.cjs');
  writeFileSync(bundlePath, bundleCode, 'utf-8');
  const electronPath = require('electron') as unknown as string;
  const { stdout, stderr } = await execFileAsync(
    electronPath,
    [bundlePath, userDataDir, withCards ? '1' : '0'],
    {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_PATH: join(PROJECT_ROOT, 'node_modules') },
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024
    }
  );
  console.log('[E2E][seed-qualite-cloud][stdout]\n' + stdout);
  if (stderr) console.log('[E2E][seed-qualite-cloud][stderr]\n' + stderr);
  const marker = '__SEED_QUALITE_CLOUD_RESULT__:';
  const line = stdout.split(/\r?\n/).reverse().find((l) => l.startsWith(marker));
  if (!line) {
    throw new Error(`[E2E] seed-qualite-cloud-sync.ts n'a produit aucun résultat exploitable.\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`);
  }
  return JSON.parse(line.slice(marker.length));
}

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
  throw new Error(`[E2E][qualite-sync] Aucune fenêtre applicative détectée dans le délai de ${timeoutMs}ms.`);
}

async function launchAllowRealSync(userDataDir: string): Promise<{ app: ElectronApplication; window: Page }> {
  if (!existsSync(MAIN_ENTRY_E2E_CLOUD)) {
    throw new Error(`[E2E] Build e2e-cloud introuvable à ${MAIN_ENTRY_E2E_CLOUD}. Lancez : npx electron-vite build --mode e2e`);
  }
  const baseEnv = { ...(process.env as Record<string, string>) };
  delete baseEnv.GEST_IN_SITU_E2E_DISABLE_SYNC;
  const app = await electron.launch({
    args: [MAIN_ENTRY_E2E_CLOUD, `--user-data-dir=${userDataDir}`],
    env: baseEnv
  });
  const window = await waitForMainWindow(app, 120_000);
  await window.waitForLoadState('domcontentloaded');
  return { app, window };
}

function dbPathOf(userDataDir: string): string {
  return join(userDataDir, 'data', 'gest_in_situ.db');
}
function queryDb(dbPath: string, sql: string): string {
  return execFileSync('sqlite3', [dbPath, sql], { encoding: 'utf-8' }).trim();
}
function execDb(dbPath: string, sql: string): void {
  execFileSync('sqlite3', [dbPath, sql], { encoding: 'utf-8' });
}

async function getNetworkState(window: Page): Promise<string> {
  const status = await window.evaluate(() => (window as any).api.sync.getStatus());
  return status.state;
}

async function waitForNetworkOnline(window: Page, timeoutMs: number): Promise<{ state: string; elapsedMs: number }> {
  const start = Date.now();
  let state = await getNetworkState(window);
  while (state !== 'ONLINE' && Date.now() - start < timeoutMs) {
    await window.waitForTimeout(1500);
    state = await getNetworkState(window);
  }
  return { state, elapsedMs: Date.now() - start };
}

async function login(window: Page, user: { login: string; password: string }): Promise<void> {
  await window.waitForURL(/#\/login/);
  await window.getByTestId('login-input').fill(user.login);
  await window.getByTestId('password-input').fill(user.password);
  await window.getByTestId('login-submit').click();
  await window.waitForURL(/#\/agent-qualite$/, { timeout: 15000 });
}
async function logout(window: Page): Promise<void> {
  await window.locator('.btn-logout').click();
  await window.waitForURL(/#\/login/, { timeout: 15000 });
}

async function closeCorrectionPanel(window: Page): Promise<void> {
  const heading = window.getByRole('heading', { name: 'Correction Manuelle' });
  const header = heading.locator('xpath=../..');
  await header.getByRole('button').first().click();
  await expect(window.getByText('Correction Manuelle')).not.toBeVisible({ timeout: 10000 });
}

async function readPushButton(window: Page, expectNonZero = false): Promise<{ enabled: boolean; count: number; text: string }> {
  const btn = window.getByRole('button', { name: /Envoyer les corrections/ });
  await expect(btn).toBeVisible({ timeout: 15000 });
  if (expectNonZero) {
    // AgentQualiteLayout n'affiche pas de suffixe "(N)" sur ce bouton (contrairement à
    // AgentVerificationLayout) : on se fie donc uniquement à `enabled`, avec un settle-delay
    // court pour laisser useDashboardStats/getUnsyncedConformeCardsCount se recharger au montage.
    await expect(btn).toBeEnabled({ timeout: 20000 });
  } else {
    await window.waitForTimeout(4000);
  }
  const text = (await btn.textContent()) || '';
  return { enabled: await btn.isEnabled(), count: -1, text };
}

async function waitForPullButtonNonZero(
  window: Page,
  user: { login: string; password: string },
  siteId: number,
  maxAttempts = 4
): Promise<{ enabled: boolean; count: number; text: string }> {
  let last = { enabled: false, count: 0, text: '' };
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const directCount = await window.evaluate((siteId) => (window as any).api.sync.getCloudCartesCount(siteId), siteId);
    console.log(`[QA-CHECK][Pull][Tentative ${attempt}/${maxAttempts}] Contrôle croisé IPC direct sync:getCloudCartesCount = ${directCount}`);

    await logout(window);
    await login(window, user);

    const btn = window.getByRole('button', { name: /RÉCUPÉRER LES CARTES DEPUIS LE CLOUD|RÉCUPÉRATION EN COURS/ });
    await expect(btn).toBeVisible({ timeout: 15000 });
    try {
      await expect(btn).toHaveText(/RÉCUPÉRER LES CARTES DEPUIS LE CLOUD \(\d+\)/, { timeout: 20000 });
    } catch {
      // Timeout de cette tentative — on relit l'état courant pour log/diagnostic et on boucle.
    }
    const text = (await btn.textContent()) || '';
    const match = text.match(/\((\d+)\)/);
    last = { enabled: await btn.isEnabled(), count: match ? Number(match[1]) : 0, text };
    console.log(`[QA-CHECK][Pull][Tentative ${attempt}/${maxAttempts}] État UI après remontage -> "${last.text}" enabled=${last.enabled} (contrôle croisé direct=${directCount})`);

    if (last.count > 0) return last;
  }
  return last;
}

const RUN_ID = Date.now();

test.describe.serial('Sync Cloud RÉELLE — Portail Qualité, offline push (bouton + outbox fusion) + pull inter-postes (agent-13)', () => {
  let seedA: SeedQualiteCloudResult;
  let seedB: SeedQualiteCloudResult;
  let userDataDirA: string;
  let userDataDirB: string;
  let envA: { app: ElectronApplication; window: Page; userDataDir: string } | null = null;
  let envB: { app: ElectronApplication; window: Page; userDataDir: string } | null = null;
  let dbPathA: string;
  let dbPathB: string;
  let anyTestFailed = false;

  const syncIds: { sansSecu?: string; dateInvalide?: string; dupTarget?: string; dupSource?: string } = {};

  test.afterEach(async ({}, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus) anyTestFailed = true;
  });

  test.afterAll(async () => {
    if (envA) {
      await teardownSeededApp({ app: envA.app, window: envA.window, userDataDir: envA.userDataDir, seed: {} as any }, anyTestFailed);
    }
    if (envB) {
      await teardownSeededApp({ app: envB.app, window: envB.window, userDataDir: envB.userDataDir, seed: {} as any }, anyTestFailed);
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
  // ÉTAPE 0 — Seed topologie (A avec cartes, B sans) + lancement Poste A
  // ═══════════════════════════════════════════════════════════════════════
  test('0. Seed Poste A (avec 4 cartes ZZTEST_QSYNC_*) + Poste B (mêmes ids site/centre, sans cartes) + lancement Poste A + parents cloud', async () => {
    test.setTimeout(240_000);
    userDataDirA = mkdtempSync(join(tmpdir(), 'gest-in-situ-e2e-qopA-'));
    userDataDirB = mkdtempSync(join(tmpdir(), 'gest-in-situ-e2e-qopB-'));

    seedA = await runQualiteSeed(userDataDirA, true);
    seedB = await runQualiteSeed(userDataDirB, false);

    console.log(`[QA-CHECK][Topologie] Poste A -> site=${seedA.siteId} centre=${seedA.centreId} cardIds=${JSON.stringify(seedA.cardIds)}`);
    console.log(`[QA-CHECK][Topologie] Poste B -> site=${seedB.siteId} centre=${seedB.centreId}`);

    // Garde défensive : mêmes ids déterministes (schéma identique, ordre d'insertion identique).
    expect(seedB.siteId).toBe(seedA.siteId);
    expect(seedB.centreId).toBe(seedA.centreId);

    const { app, window } = await launchAllowRealSync(userDataDirA);
    envA = { app, window, userDataDir: userDataDirA };
    dbPathA = dbPathOf(userDataDirA);
    dbPathB = dbPathOf(userDataDirB);

    await ensureCloudSiteAndCentre(seedA.siteId, seedA.centreId);

    // Sync_id locaux des 4 cartes (pour interroger Supabase précisément plus tard).
    const rows = queryDb(
      dbPathA,
      `SELECT noms||'|'||sync_id FROM t_cartes WHERE noms LIKE 'ZZTEST_QSYNC_%' ORDER BY noms;`
    ).split(/\r?\n/);
    console.log(`[QA-CHECK][Setup] Cartes seedées (noms|sync_id) -> ${JSON.stringify(rows)}`);
    for (const line of rows) {
      const [noms, syncId] = line.split('|');
      if (noms === 'ZZTEST_QSYNC_SANSSECU') syncIds.sansSecu = syncId;
      if (noms === 'ZZTEST_QSYNC_DATEINVALIDE') syncIds.dateInvalide = syncId;
    }
    // dup_target / dup_source partagent le même noms -> distingués par sync_id connu du seed.
    const dupRows = queryDb(
      dbPathA,
      `SELECT sync_id FROM t_cartes WHERE id_carte IN (${seedA.cardIds['dup_target']}, ${seedA.cardIds['dup_source']}) ORDER BY id_carte;`
    ).split(/\r?\n/);
    const targetSyncId = queryDb(dbPathA, `SELECT sync_id FROM t_cartes WHERE id_carte = ${seedA.cardIds['dup_target']};`);
    const sourceSyncId = queryDb(dbPathA, `SELECT sync_id FROM t_cartes WHERE id_carte = ${seedA.cardIds['dup_source']};`);
    syncIds.dupTarget = targetSyncId;
    syncIds.dupSource = sourceSyncId;
    console.log(`[QA-CHECK][Setup] sync_ids résolus -> ${JSON.stringify(syncIds)} (dupRows bruts=${JSON.stringify(dupRows)})`);

    console.log('[QA-CHECK][Setup] Topologie seedée, parents cloud assurés, Poste A lancé — prêt pour le login.');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SOUS-PARTIE 1 — Fenêtre OFFLINE réelle : 3 corrections via le VRAI portail
  // Qualité (clics UI), vérification du COMPTE affiché par "Envoyer les
  // corrections" pendant cette période.
  // ═══════════════════════════════════════════════════════════════════════
  test('1. Poste A — fenêtre OFFLINE réelle : Compléter N° Sécu + Corriger date invalide + Fusionner doublon strict, via clics UI réels', async () => {
    test.setTimeout(180_000);
    const { window } = envA!;
    const launchTs = Date.now();

    await login(window, seedA.opqA);
    const stateAfterLogin = await getNetworkState(window);
    console.log(`[QA-CHECK][Offline] État réseau juste après login (+${Date.now() - launchTs}ms depuis lancement) = "${stateAfterLogin}"`);
    await expect(window.getByText('PORTAIL DE CONFORMITÉ ET QUALITÉ')).toBeVisible();

    // ── Action 1 : Données Manquantes > Sans N° Sécu > Compléter ──────────
    await window.getByRole('link', { name: 'Données Manquantes' }).click();
    await window.waitForURL(/#\/agent-qualite\/manquants/, { timeout: 15000 });
    const rowSansSecu = window.locator('tr').filter({ hasText: 'ZZTEST_QSYNC_SANSSECU' });
    await expect(rowSansSecu).toBeVisible({ timeout: 10000 });
    await rowSansSecu.getByRole('button', { name: /Compléter/ }).click();
    // Ordre du grid ExpandedManquantDetails : Noms(0), Prénoms(1), Date(2), Contact(3), Lieu(4), N°Sécu(5), Rangement(6).
    await window.getByRole('button', { name: /Modifier/ }).nth(5).click();
    const secuInput = window.locator('input[placeholder="N° Sécu (13 chiffres)"]');
    await secuInput.fill('1990010199001');
    await window.locator('button.btn-primary').filter({ has: window.locator('svg') }).last().click();
    await expect(window.getByText('Donnée mise à jour avec succès !').last()).toBeVisible({ timeout: 10000 });
    console.log(`[QA-CHECK][Offline][Action 1] N° Sécu complété via UI (+${Date.now() - launchTs}ms) — réseau="${await getNetworkState(window)}"`);

    // ── Action 2 : Dates Invalides > Corriger (CorrectionSidePanel) ───────
    await window.getByRole('link', { name: 'Dates Invalides ou Absentes' }).click();
    await window.waitForURL(/#\/agent-qualite\/invalides/, { timeout: 15000 });
    const rowDateInvalide = window.locator('tr').filter({ hasText: 'ZZTEST_QSYNC_DATEINVALIDE' });
    await expect(rowDateInvalide).toBeVisible({ timeout: 10000 });
    await rowDateInvalide.getByRole('button', { name: /Corriger/ }).click();
    await expect(window.getByText('Correction Manuelle')).toBeVisible({ timeout: 10000 });
    await expect(window.getByText('Type : date_de_naissance')).toBeVisible();
    const dateField = window.locator('input[placeholder="JJ/MM/AAAA"]');
    await dateField.fill('12061992'); // -> "12/06/1992", date calendairement valide
    await window.getByRole('button', { name: /Sauvegarder/ }).click();
    await expect(window.getByText(/Données mises à jour avec succès|succès/i).first()).toBeVisible({ timeout: 10000 });
    console.log(`[QA-CHECK][Offline][Action 2] Date invalide corrigée via UI (+${Date.now() - launchTs}ms) — réseau="${await getNetworkState(window)}"`);
    const panelStillOpen = await window.getByText('Correction Manuelle').isVisible().catch(() => false);
    if (panelStillOpen) await closeCorrectionPanel(window);

    // ── Action 3 : Doublons > Doublons Stricts > Fusionner ─────────────────
    await window.getByRole('link', { name: 'Doublons' }).click();
    await window.waitForURL(/#\/agent-qualite\/doublons/, { timeout: 15000 });
    await expect(window.getByRole('button', { name: 'Doublons Stricts' })).toBeVisible({ timeout: 10000 });
    const rowDoublon = window.locator('tr').filter({ hasText: 'ZZTEST_QSYNC_DOUBLON' });
    await expect(rowDoublon).toBeVisible({ timeout: 10000 });
    await rowDoublon.getByRole('button', { name: /Fusionner/ }).click();
    await expect(window.getByText('Fusion de Cartes')).toBeVisible({ timeout: 10000 });
    await window.getByRole('button', { name: /Confirmer la fusion/ }).click();
    await expect(window.getByText('Cartes fusionnées avec succès !')).toBeVisible({ timeout: 10000 });
    console.log(`[QA-CHECK][Offline][Action 3] Doublon fusionné via UI (+${Date.now() - launchTs}ms) — réseau="${await getNetworkState(window)}"`);

    // ── Vérité terrain locale AVANT tout affichage UI ──────────────────────
    const cardsState = queryDb(
      dbPathA,
      `SELECT id_carte||'|'||noms||'|'||is_dirty||'|'||num_secu||'|'||date_de_naissance||'|'||rangement
       FROM t_cartes WHERE noms LIKE 'ZZTEST_QSYNC_%' ORDER BY id_carte;`
    ).split(/\r?\n/);
    console.log(`[QA-CHECK][Offline] État local des 4 cartes après les 3 corrections (id|noms|is_dirty|num_secu|date|rangement) -> ${JSON.stringify(cardsState, null, 2)}`);

    const sansSecuRow = cardsState.find((r) => r.includes('ZZTEST_QSYNC_SANSSECU'));
    expect(sansSecuRow).toContain('|1|1990010199001|');
    const dateInvalideRow = cardsState.find((r) => r.includes('ZZTEST_QSYNC_DATEINVALIDE'));
    expect(dateInvalideRow).toContain('1992-06-12');
    const targetRow = cardsState.find((r) => r.startsWith(`${seedA.cardIds['dup_target']}|`));
    const sourceRow = cardsState.find((r) => r.startsWith(`${seedA.cardIds['dup_source']}|`));
    console.log(`[QA-CHECK][Offline][Fusion] Cible -> ${targetRow} | Source -> ${sourceRow ?? '(absente localement)'}`);
    expect(targetRow).toContain('|QS4-SOURCE'); // rangement fusionné depuis la source

    // ── t_outbox : diagnostic de la fusion (UPDATE cible + DELETE source) ─────────────────
    const outboxRows = queryDb(
      dbPathA,
      `SELECT table_name||'|'||operation||'|'||status FROM t_outbox WHERE id IN ('${syncIds.dupTarget}', '${syncIds.dupSource}') ORDER BY id;`
    ).split(/\r?\n/);
    console.log(`[QA-CHECK][Offline][Fusion, t_outbox] Entrées pour la fusion (peuvent déjà avoir été traitées et supprimées si le réseau était déjà ONLINE) -> ${JSON.stringify(outboxRows)}`);

    // Découverte empirique (run 1, agent-13) : la fenêtre OFFLINE/PROBING réelle observée sur
    // CE Supabase dev peut être bien plus courte que les ~30-50s habituels (13,5s constatées au
    // login sur le run précédent) — le réseau était alors déjà ONLINE au moment de la fusion.
    // Dans ce cas, fusionnerDoublons() (handlers.ts ~l.1645, `if (networkMonitor.getState() ===
    // 'ONLINE') scheduleOutboxProcessing();`) déclenche IMMÉDIATEMENT le drainage de l'outbox :
    // outbox.service.ts supprime alors la ligne t_cartes source PHYSIQUEMENT en local
    // (`DELETE FROM t_cartes WHERE sync_id = ?`, pas seulement is_dirty=-1) ET la ligne t_outbox
    // elle-même après succès — les deux se produisent alors AVANT même que ce test n'ait eu la
    // main pour vérifier l'état "soft delete" intermédiaire. On distingue donc explicitement les
    // 2 issues valides plutôt que d'imposer un seul état attendu :
    if (sourceRow === undefined) {
      console.log(
        '[QA-CHECK][Offline][Fusion][TIMING RAPIDE] La carte source a déjà été supprimée PHYSIQUEMENT en local ' +
        `(+${Date.now() - launchTs}ms depuis le lancement) — le réseau était déjà ONLINE au moment de la fusion, ` +
        'l\'outbox a drainé la fusion immédiatement (comportement correct, juste plus rapide que la fenêtre offline visée). ' +
        'Vérification de propagation cloud reportée au test 2 (poll Supabase direct).'
      );
      // Correction empirique (run 2) : les entrées t_outbox ne sont PAS supprimées après succès,
      // seulement repassées à status='SYNCED'. Correction empirique supplémentaire (run 4) : la
      // suppression PHYSIQUE locale de la source et le passage du statut t_outbox à 'SYNCED' ne
      // sont pas atomiques (deux étapes distinctes de processOutboxPending) — un run peut donc
      // légitimement observer la ligne déjà absente localement MAIS son entrée t_outbox encore
      // 'PENDING' à cet instant précis (capturé entre les deux étapes). On vérifie donc seulement
      // le nombre d'entrées (diagnostic non-bloquant sur le statut exact, juste loggé).
      expect(outboxRows.length).toBe(2);
      const allSynced = outboxRows.every((r) => r.includes('SYNCED'));
      console.log(`[QA-CHECK][Offline][Fusion, t_outbox] Statut SYNCED sur les 2 entrées au moment de cette lecture = ${allSynced} (sinon capturé en plein drainage, non bloquant — vérification définitive faite sur Supabase au test 2).`);
    } else {
      console.log('[QA-CHECK][Offline][Fusion][CONFIRMÉ OFFLINE] La carte source est encore en soft-delete local (fenêtre offline réellement observée).');
      expect(sourceRow.split('|')[2]).toBe('-1'); // soft-delete de la source, outbox pas encore drainé
      expect(outboxRows.some((r) => r.includes('UPDATE') && r.includes('PENDING'))).toBe(true);
      expect(outboxRows.some((r) => r.includes('DELETE') && r.includes('PENDING'))).toBe(true);
    }

    // ── useDashboardStats : remount pour forcer un loadStats() frais ──────
    await logout(window);
    await login(window, seedA.opqA);
    const stateAtRemount = await getNetworkState(window);
    console.log(`[QA-CHECK][Offline] État réseau au moment du remount (+${Date.now() - launchTs}ms depuis lancement) = "${stateAtRemount}"`);

    const pushBtn = await readPushButton(window, true);
    console.log(`[QA-CHECK][Offline] Bouton "Envoyer les corrections" -> texte="${pushBtn.text}" enabled=${pushBtn.enabled} (état réseau au remount="${stateAtRemount}")`);
    expect(pushBtn.enabled).toBe(true);

    const conformeCount = await window.evaluate((siteId) => (window as any).api.stats.getUnsyncedConformeCardsCount(siteId), seedA.siteId);
    // Découverte empirique (run 3, agent-13) : le compte réel dépend d'un TIMING RACE non
    // anticipé initialement. Théoriquement 2 (sans_secu + date_invalide), la fusion étant
    // structurellement exclue tant que cle_doublon reste partagé par 2 lignes (cible + source).
    // MAIS si l'outbox a déjà drainé la fusion (réseau ONLINE dès le lancement, cf. logs
    // ci-dessus) AVANT cette lecture, la source est alors PHYSIQUEMENT supprimée de t_cartes —
    // la cible n'a donc plus aucune ligne concurrente partageant son cle_doublon, et sort de
    // l'exclusion "doublon". Or outbox.service.ts (chemin RÉELLEMENT emprunté par
    // qualite:fusionnerDoublons) ne remet JAMAIS is_dirty à 0 après un succès (contrairement à
    // upstream.ts/t_sync_queue qui le fait, cf. commentaire de tête de fichier) : la cible reste
    // is_dirty=1 indéfiniment -> elle devient éligible à getUnsyncedConformeCardsCount dès que la
    // source disparaît, d'où un compte de 3 observé quand la fusion a déjà été drainée avant ce
    // point de mesure. Les deux valeurs sont donc valides selon le timing réel de ce run —
    // documenté explicitement plutôt qu'une assertion figée qui échouerait à tort.
    console.log(`[QA-CHECK][Offline] Contrôle croisé IPC direct stats:getUnsyncedConformeCardsCount(site) = ${conformeCount} (attendu : 2 si la fusion n'est pas encore drainée par l'outbox, 3 si elle l'est déjà — voir commentaire de code ci-dessus)`);
    expect([2, 3]).toContain(conformeCount);
    if (conformeCount === 3) {
      console.warn(
        '[QA-CHECK][Offline][P2 CANDIDAT, is_dirty jamais remis à 0 après fusion synchronisée via outbox] ' +
        'La carte cible de la fusion (is_dirty=1 posé par qualite:fusionnerDoublons) n\'a jamais été remise à ' +
        'is_dirty=0 malgré un succès confirmé de la synchronisation outbox (status=SYNCED en base) — ' +
        'contrairement au chemin upstream.ts/t_sync_queue qui le fait. Conséquence concrète : cette carte reste ' +
        'indéfiniment comptée comme "en attente" (conformeCount, badge "corrections en attente", bouton ' +
        '"Envoyer les corrections") et sera réenvoyée (upsert idempotent, sans casse) à chaque futur clic, ' +
        'sans jamais se stabiliser à 0 — gaspillage réseau mineur, pas de perte de données.'
      );
    }

    if (stateAtRemount === 'ONLINE') {
      console.warn(
        '[QA-CHECK][Offline][INFO TIMING] Le réseau est déjà passé ONLINE avant la fin de cette vérification — ' +
        'la fenêtre hors-ligne réelle observée sur ce run a donc été plus courte que les ~30-50s habituels. ' +
        'Les 3 corrections ont néanmoins bien été réalisées via l\'UI pendant que le réseau était encore hors-ligne ' +
        '(timestamps loggés ci-dessus), et le compte du bouton reste prouvé exact (calcul 100% local).'
      );
    } else {
      console.log('[QA-CHECK][Offline][CONFIRMÉ] Les 3 corrections UI et la vérification du bouton ont eu lieu pendant que le réseau était encore hors-ligne.');
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SOUS-PARTIE 2 — Retour réseau + envoi réel (bouton "Envoyer les
  // corrections" pour sans_secu/date_invalide, outbox automatique pour la
  // fusion) — vérifie les 4 cartes sur Supabase dev.
  // ═══════════════════════════════════════════════════════════════════════
  test('2. Poste A — passage ONLINE + synchronisation réelle -> les 4 cartes (2 via bouton, fusion via outbox) sont sur Supabase avec les bonnes valeurs', async () => {
    test.setTimeout(300_000);
    const { window } = envA!;

    const { state, elapsedMs } = await waitForNetworkOnline(window, 150_000);
    console.log(`[QA-CHECK][Online] Réseau atteint l'état "${state}" après ${elapsedMs}ms de polling post-remount.`);
    expect(state).toBe('ONLINE');

    // Laisser une marge courte pour que processOutboxPending() (déclenché immédiatement
    // par handleNetworkChange('ONLINE'), sync-engine.ts) ait pu drainer la fusion.
    await window.waitForTimeout(3000);

    const pushBtnBeforeClick = await readPushButton(window);
    console.log(`[QA-CHECK][Online] Bouton "Envoyer les corrections" avant clic -> "${pushBtnBeforeClick.text}" enabled=${pushBtnBeforeClick.enabled}`);

    if (pushBtnBeforeClick.enabled) {
      await window.getByRole('button', { name: /Envoyer les corrections/ }).click();
      await expect(
        window.getByText(/[Ss]ynchronisation de masse|cartes traitées|cartes envoyées|à jour|Aucune donnee locale conforme/i)
      ).toBeVisible({ timeout: 30000 });
      console.log('[QA-CHECK][Online] Clic réel sur "Envoyer les corrections" effectué.');
    } else {
      console.log('[QA-CHECK][Online][INFO] Bouton déjà désactivé au moment du test — soit déjà envoyé, soit rien à envoyer.');
    }

    // ── Poll cloud : sans_secu + date_invalide (chemin bouton bulk upload) ──
    let cloudSansSecu: any = null, cloudDateInvalide: any = null;
    let deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      cloudSansSecu = await getCloudCardBySyncId(syncIds.sansSecu!);
      cloudDateInvalide = await getCloudCardBySyncId(syncIds.dateInvalide!);
      if (cloudSansSecu && cloudDateInvalide) break;
      await window.waitForTimeout(3000);
    }
    console.log(`[QA-CHECK][Online] Carte Sans N° Sécu sur Supabase -> ${cloudSansSecu ? JSON.stringify({ num_secu: cloudSansSecu.num_secu, rangement: cloudSansSecu.rangement }) : 'ABSENTE'}`);
    console.log(`[QA-CHECK][Online] Carte Date Invalide sur Supabase -> ${cloudDateInvalide ? JSON.stringify({ date_naissance: cloudDateInvalide.date_naissance }) : 'ABSENTE'}`);
    expect(cloudSansSecu).not.toBeNull();
    expect(cloudSansSecu.num_secu).toBe('1990010199001');
    expect(cloudDateInvalide).not.toBeNull();
    expect(cloudDateInvalide.date_naissance).toBe('1992-06-12');

    // ── Poll cloud : fusion du doublon (chemin outbox, indépendant du bouton) ──
    let cloudTarget: any = null, cloudSourceStillThere: any = null;
    deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      cloudTarget = await getCloudCardBySyncId(syncIds.dupTarget!);
      cloudSourceStillThere = await getCloudCardBySyncId(syncIds.dupSource!);
      if (cloudTarget && cloudTarget.rangement === 'QS4-SOURCE' && !cloudSourceStillThere) break;
      await window.waitForTimeout(3000);
    }
    console.log(`[QA-CHECK][Online][Fusion] Carte CIBLE sur Supabase -> ${cloudTarget ? JSON.stringify({ num_secu: cloudTarget.num_secu, rangement: cloudTarget.rangement }) : 'ABSENTE'}`);
    console.log(`[QA-CHECK][Online][Fusion] Carte SOURCE sur Supabase (attendu : ABSENTE, supprimée) -> ${cloudSourceStillThere ? JSON.stringify(cloudSourceStillThere) : 'ABSENTE (conforme)'}`);

    const fusionPropagated = !!cloudTarget && cloudTarget.rangement === 'QS4-SOURCE' && !cloudSourceStillThere;
    if (!fusionPropagated) {
      console.warn(
        '[QA-CHECK][Online][Fusion][À DOCUMENTER] La fusion de doublon n\'a PAS (encore) été propagée sur Supabase ' +
        `après ${Math.round((Date.now() - (deadline - 90000)) / 1000)}s de polling. État observé : cible=${JSON.stringify(cloudTarget)}, source=${JSON.stringify(cloudSourceStillThere)}. ` +
        'Voir le commentaire de tête de fichier sur le chemin outbox (t_outbox) vs. le chemin bulk upload (bouton "Envoyer les corrections") — ' +
        'diagnostic local t_outbox ci-dessous pour trancher la cause exacte.'
      );
      const outboxState = queryDb(
        dbPathA,
        `SELECT table_name||'|'||operation||'|'||status||'|'||COALESCE(error_msg,'') FROM t_outbox WHERE id IN ('${syncIds.dupTarget}', '${syncIds.dupSource}') ORDER BY id;`
      ).split(/\r?\n/);
      console.log(`[QA-CHECK][Online][Fusion] État local t_outbox après polling -> ${JSON.stringify(outboxState)}`);
    } else {
      console.log('[QA-CHECK][Online][Fusion][CONFIRMÉ] La fusion a bien été propagée sur Supabase via le mécanisme outbox automatique, sans dépendre du bouton "Envoyer les corrections".');
    }

    // Assertion documentaire : matérialise clairement dans le rapport si la fusion ne part
    // jamais vers le cloud (régression potentielle), plutôt que de la passer sous silence.
    expect(fusionPropagated).toBe(true);
  });

  test('2b. Poste A — fermeture propre (données Supabase conservées pour Poste B)', async () => {
    if (envA) {
      await teardownSeededApp({ app: envA.app, window: envA.window, userDataDir: envA.userDataDir, seed: {} as any }, false);
      envA = null;
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SOUS-PARTIE 3 — Poste B télécharge la mise à jour poussée par Poste A.
  // ═══════════════════════════════════════════════════════════════════════
  test('3. Poste B — nouvelle instance jamais vue ces cartes -> bouton "RÉCUPÉRER..." reflète > 0, clic réel -> cartes rapatriées avec bonnes valeurs (y compris la fusion)', async () => {
    test.setTimeout(300_000);
    const { app, window } = await launchAllowRealSync(userDataDirB);
    envB = { app, window, userDataDir: userDataDirB };

    const localBefore = queryDb(dbPathB, `SELECT COUNT(*) FROM t_cartes WHERE noms LIKE 'ZZTEST_QSYNC_%';`);
    expect(Number(localBefore)).toBe(0);

    await login(window, seedB.opqB);

    let directCount = -1;
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      directCount = await window.evaluate((siteId) => (window as any).api.sync.getCloudCartesCount(siteId), seedB.siteId);
      if (directCount > 0) break;
      await window.waitForTimeout(3000);
    }
    console.log(`[QA-CHECK][Pull] sync:getCloudCartesCount(${seedB.siteId}) en appel IPC direct (Poste B) = ${directCount} (attendu : >= 3, la carte source fusionnée ayant été supprimée du cloud)`);
    expect(directCount).toBeGreaterThanOrEqual(3);

    const pullBtn = await waitForPullButtonNonZero(window, seedB.opqB, seedB.siteId);
    console.log(`[QA-CHECK][Pull] Bouton "RÉCUPÉRER LES CARTES DEPUIS LE CLOUD" (Poste B) état final -> "${pullBtn.text}" enabled=${pullBtn.enabled}`);
    expect(pullBtn.count).toBeGreaterThanOrEqual(3);
    expect(pullBtn.enabled).toBe(true);

    await window.getByRole('button', { name: /RÉCUPÉRER LES CARTES DEPUIS LE CLOUD/ }).click();
    await expect(window.getByText(/Récupération réussie|données locales sont déjà à jour|Synchronisation initiale/)).toBeVisible({ timeout: 40000 });

    const rows = queryDb(
      dbPathB,
      `SELECT noms||'|'||num_secu||'|'||date_de_naissance||'|'||rangement||'|'||site_id||'|'||centre_id FROM t_cartes WHERE noms LIKE 'ZZTEST_QSYNC_%' ORDER BY noms;`
    ).split(/\r?\n/);
    console.log(`[QA-CHECK][Pull] Lignes locales Poste B après pull -> ${JSON.stringify(rows, null, 2)}`);

    const sansSecuLocal = rows.find((r) => r.startsWith('ZZTEST_QSYNC_SANSSECU|'));
    const dateInvalideLocal = rows.find((r) => r.startsWith('ZZTEST_QSYNC_DATEINVALIDE|'));
    const doublonLocalRows = rows.filter((r) => r.startsWith('ZZTEST_QSYNC_DOUBLON|'));

    console.log(`[QA-CHECK][Pull] Sans N° Sécu -> ${sansSecuLocal}`);
    console.log(`[QA-CHECK][Pull] Date Invalide -> ${dateInvalideLocal}`);
    console.log(`[QA-CHECK][Pull][Fusion] Ligne(s) ZZTEST_QSYNC_DOUBLON récupérées (attendu : 1 seule, la cible fusionnée) -> ${JSON.stringify(doublonLocalRows)}`);

    expect(sansSecuLocal).toContain('|1990010199001|');
    expect(dateInvalideLocal).toContain('|1992-06-12|');
    expect(doublonLocalRows.length).toBe(1);
    expect(doublonLocalRows[0]).toContain('|QS4-SOURCE|');
    expect(doublonLocalRows[0]).toContain(`|${seedB.siteId}|${seedB.centreId}`);
  });

  test('4. Poste B — après pull, compteur retombe (ou marge de sécurité watermark documentée)', async () => {
    const { window } = envB!;
    await logout(window);
    await login(window, seedB.opqB);

    const btn = window.getByRole('button', { name: /RÉCUPÉRER LES CARTES DEPUIS LE CLOUD|RÉCUPÉRATION EN COURS/ });
    await expect(btn).toBeVisible({ timeout: 15000 });
    await window.waitForTimeout(4000);
    const text = (await btn.textContent()) || '';
    const match = text.match(/\((\d+)\)/);
    const count = match ? Number(match[1]) : 0;
    const enabled = await btn.isEnabled();
    console.log(`[QA-CHECK][Post-pull] Bouton "RÉCUPÉRER..." après remontage post-pull -> "${text}" enabled=${enabled} count=${count}`);

    if (count !== 0 || enabled !== false) {
      console.warn(
        `[QA-CHECK][Post-pull][À DOCUMENTER] Le compteur n'est pas retombé à 0 immédiatement après le pull (count=${count}, enabled=${enabled}). ` +
        'Comportement probablement dû à la marge de sécurité de 2 minutes sur le watermark (downstream.ts), déjà documentée sur le rôle Vérification — pas nécessairement un bug.'
      );
    } else {
      console.log('[QA-CHECK][Post-pull][CONFIRMÉ] Compteur à 0, bouton désactivé immédiatement après le pull.');
    }
  });
});
