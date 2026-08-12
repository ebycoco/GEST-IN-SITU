/**
 * e2e/specs/cloud/absence-escalade-cross-poste-real.e2e.spec.ts
 *
 * QA Terrain (agent-13) — Validation du correctif critique : les signalements
 * d'absence escaladés au site (`escaladerAuSite`) ou déclarés définitivement
 * perdus (`declarerPerdue`) ne quittaient JAMAIS le poste local avant ce
 * correctif (aucun `enqueueOutbox`/`scheduleOutboxProcessing`, contrairement
 * à `signalerAbsence`/`resoudreAbsence` qui fonctionnaient déjà). Un second
 * correctif fait que `EscaladesResoluesTab.tsx`/`ResolusTab.tsx` se
 * rechargent aussi sur un `sync:updated-data` SANS `type` (pull automatique
 * descendant, `source: 'auto-downstream'`), pas seulement sur les types
 * d'action locale explicites.
 *
 * DEUX instances Electron réellement distinctes (deux `userDataDir` jetables,
 * deux process electron.exe successifs — jamais concurrents), simulant deux
 * postes physiques différents, toutes deux pointées vers le MÊME projet
 * Supabase e2e-cloud réel (`dist-e2e-cloud/`, `allowRealSync: true`).
 *
 * Topologie (seed dédié, voir SEED_SCRIPT_SRC) : 1 site ZZTEST, 2 centres
 * (A et B), 4 comptes — OPV_A (OPERATEUR_VERIFICATION, centre A),
 * ADMIN_CENTRE_A / ADMIN_CENTRE_B (centre A / B), ADMIN_SITE
 * (ADMINISTRATEUR_SITE, siteOnly). Mêmes id numériques sur les deux DB
 * (auto-incrément déterministe sur schéma identique).
 *
 * Invocation ciblée uniquement :
 *   npx playwright test e2e/specs/cloud/absence-escalade-cross-poste-real.e2e.spec.ts
 * Build préalable requis : npx electron-vite build --mode e2e (jamais lancé
 * automatiquement par un agent — CLAUDE.md §1).
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
  'C:\\Users\\EBYCHOCO\\AppData\\Local\\Temp\\claude\\d--Espace-travail-GEST-IN-SITU-CARTE-ABOBO-V2\\0ecf52dd-3c68-446e-99c9-2a28cf4e9dcc\\scratchpad\\seed-escalade-cross-poste.ts';

interface SeedResult {
  dbPath: string;
  siteId: number;
  centreAId: number;
  centreBId: number;
  opvA: { login: string; password: string; id: number };
  adminCentreA: { login: string; password: string; id: number };
  adminCentreB: { login: string; password: string; id: number };
  adminSite: { login: string; password: string; id: number };
}

// ─── Bundling + exécution du seed custom (même technique que les autres specs
// cloud de ce dossier — fichier hors e2e/fixtures/, confinement STOP&WARN) ──
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
  if (!output) throw new Error('[E2E][seed-escalade] esbuild n\'a produit aucune sortie.');
  return output;
}

async function runCustomSeed(userDataDir: string): Promise<SeedResult> {
  const bundleCode = await bundleSeedScript();
  const bundleDir = mkdtempSync(join(tmpdir(), 'gest-in-situ-e2e-seed-escalade-'));
  const bundlePath = join(bundleDir, 'seed-escalade-cross-poste.bundle.cjs');
  writeFileSync(bundlePath, bundleCode, 'utf-8');
  const electronPath = require('electron') as unknown as string;
  const { stdout, stderr } = await execFileAsync(electronPath, [bundlePath, userDataDir], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_PATH: join(PROJECT_ROOT, 'node_modules') },
    encoding: 'utf-8',
    maxBuffer: 10 * 1024 * 1024
  });
  console.log('[E2E][seed-escalade][stdout]\n' + stdout);
  if (stderr) console.log('[E2E][seed-escalade][stderr]\n' + stderr);
  const marker = '__SEED_ESCALADE_CROSS_POSTE_RESULT__:';
  const line = stdout.split(/\r?\n/).reverse().find((l) => l.startsWith(marker));
  if (!line) {
    throw new Error(`[E2E] seed-escalade-cross-poste.ts n'a produit aucun résultat exploitable.\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`);
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
  throw new Error(`[E2E][absence-escalade] Aucune fenêtre applicative détectée dans le délai de ${timeoutMs}ms.`);
}

async function launchAllowRealSync(userDataDir: string): Promise<{ app: ElectronApplication; window: Page }> {
  if (!existsSync(MAIN_ENTRY_E2E_CLOUD)) {
    throw new Error(`[E2E] Build e2e-cloud introuvable à ${MAIN_ENTRY_E2E_CLOUD}. Lancez : npx electron-vite build --mode e2e`);
  }
  const baseEnv = { ...(process.env as Record<string, string>) };
  delete baseEnv.GEST_IN_SITU_E2E_DISABLE_SYNC;
  // Constat empirique (agent-13, cet environnement précis) : le shell parent
  // porte ELECTRON_RUN_AS_NODE=1 en ambiant (nécessaire au bundle du seed
  // custom ci-dessus, qui doit tourner en pur Node contre l'ABI native
  // d'Electron). Hérité tel quel par electron.launch(), il force electron.exe
  // à démarrer en mode Node pur : require('electron') renvoie alors le
  // chemin binaire (string) au lieu de l'API réelle, et
  // `electron.app.isPackaged` (@electron-toolkit/utils) explose au tout
  // premier require. Sans rapport avec le correctif testé — purement un
  // artefact de cet environnement de lancement, à retirer explicitement pour
  // toute vraie instance applicative.
  delete baseEnv.ELECTRON_RUN_AS_NODE;
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

async function createCardViaApp(
  window: Page,
  siteId: number,
  centreId: number,
  noms: string,
  ddnISO: string,
  rangement: string,
  agentLogin: string
): Promise<{ id: number; sync_id: string }> {
  return window.evaluate(
    async ({ siteId, centreId, noms, ddnISO, rangement, agentLogin }) => {
      return (window as any).api.cartes.create({
        noms,
        prenoms: 'ESCALADE',
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
    { siteId, centreId, noms, ddnISO, rangement, agentLogin }
  );
}

async function signalerAbsenceViaApp(
  window: Page,
  id: number,
  currentUser: { role: string; site_id: number; id_user: number; centre_id: number; login: string }
): Promise<any> {
  return window.evaluate(
    async ({ id, currentUser }) => {
      return (window as any).api.cartes.signalerAbsence(id, currentUser.login, currentUser.login, 'ZZTEST_ABSENCE_ESCALADE_TEST', currentUser);
    },
    { id, currentUser }
  );
}

const RUN_ID = Date.now();

test.describe.serial('Absence — Escalade + Perte cross-poste RÉELLE (agent-13, correctif outbox manquant)', () => {
  let topoA: SeedResult;
  let topoB: SeedResult;
  let userDataDirA: string;
  let userDataDirB: string;
  let envA: { app: ElectronApplication; window: Page; userDataDir: string } | null = null;
  let envB: { app: ElectronApplication; window: Page; userDataDir: string } | null = null;
  let dbPathA: string;
  let dbPathB: string;
  let anyTestFailed = false;

  const card1 = { id: 0, sync_id: '', noms: `ZZTEST_CARD_ESCALADE_${RUN_ID}` };
  const card2 = { id: 0, sync_id: '', noms: `ZZTEST_CARD_RESOLU_DIRECT_${RUN_ID}` };

  test.afterEach(async ({}, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus) anyTestFailed = true;
  });

  test.afterAll(async () => {
    if (envA) {
      try {
        execDb(dbPathA, "DELETE FROM t_cartes WHERE noms LIKE 'ZZTEST_%';");
        execDb(dbPathA, "DELETE FROM t_logs WHERE detail LIKE '%ZZTEST%' OR detail LIKE '%zztest%';");
        execDb(dbPathA, "DELETE FROM t_user_roles WHERE id_user IN (SELECT id_user FROM t_users WHERE login LIKE 'ZZTEST_%');");
        execDb(dbPathA, "DELETE FROM t_users WHERE login LIKE 'ZZTEST_%';");
        execDb(dbPathA, "DELETE FROM t_centres WHERE nom LIKE 'ZZTEST_%';");
        execDb(dbPathA, "DELETE FROM t_sites WHERE nom LIKE 'ZZTEST_%';");
      } catch (e) {
        console.warn('[E2E] Nettoyage local Poste 1 échoué (non bloquant) :', e);
      }
      await teardownSeededApp({ app: envA.app, window: envA.window, userDataDir: envA.userDataDir, seed: {} as any }, anyTestFailed);
    }
    if (envB) {
      try {
        execDb(dbPathB, "DELETE FROM t_cartes WHERE noms LIKE 'ZZTEST_%';");
        execDb(dbPathB, "DELETE FROM t_logs WHERE detail LIKE '%ZZTEST%' OR detail LIKE '%zztest%';");
        execDb(dbPathB, "DELETE FROM t_user_roles WHERE id_user IN (SELECT id_user FROM t_users WHERE login LIKE 'ZZTEST_%');");
        execDb(dbPathB, "DELETE FROM t_users WHERE login LIKE 'ZZTEST_%';");
        execDb(dbPathB, "DELETE FROM t_centres WHERE nom LIKE 'ZZTEST_%';");
        execDb(dbPathB, "DELETE FROM t_sites WHERE nom LIKE 'ZZTEST_%';");
      } catch (e) {
        console.warn('[E2E] Nettoyage local Poste 2 échoué (non bloquant) :', e);
      }
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
  // ÉTAPE 0 — Seed topologie (site + 2 centres + 4 comptes) + lancement Poste 1
  // ═══════════════════════════════════════════════════════════════════════
  test('0. Seed topologie (2 DB indépendantes, ids identiques) + lancement Poste 1 + parents cloud', async () => {
    test.setTimeout(240_000);
    userDataDirA = mkdtempSync(join(tmpdir(), 'gest-in-situ-e2e-poste1-'));
    userDataDirB = mkdtempSync(join(tmpdir(), 'gest-in-situ-e2e-poste2-'));

    topoA = await runCustomSeed(userDataDirA);
    topoB = await runCustomSeed(userDataDirB);

    console.log(`[QA-CHECK][Topologie] Poste 1 DB -> site=${topoA.siteId} centreA=${topoA.centreAId} centreB=${topoA.centreBId}`);
    console.log(`[QA-CHECK][Topologie] Poste 2 DB -> site=${topoB.siteId} centreA=${topoB.centreAId} centreB=${topoB.centreBId}`);

    expect(topoB.siteId).toBe(topoA.siteId);
    expect(topoB.centreAId).toBe(topoA.centreAId);
    expect(topoB.centreBId).toBe(topoA.centreBId);

    const { app, window } = await launchAllowRealSync(userDataDirA);
    envA = { app, window, userDataDir: userDataDirA };
    dbPathA = dbPathOf(userDataDirA);
    dbPathB = dbPathOf(userDataDirB);

    await ensureCloudSiteAndCentre(topoA.siteId, topoA.centreAId);
    const { error: centreBErr } = await supabaseDev.from('t_centres').upsert(
      {
        id: topoA.centreBId,
        site_id: topoA.siteId,
        nom: 'ZZTEST_CENTRE_B',
        numero: 2,
        sync_id: `zztest-cloud-centre-b-escalade-${RUN_ID}`
      },
      { onConflict: 'id' }
    );
    expect(centreBErr).toBeNull();

    const { state } = await waitForNetworkOnline(window, 120_000);
    console.log(`[QA-CHECK][Setup] Réseau Poste 1 -> "${state}". Topologie seedée, parents cloud assurés.`);
    expect(state).toBe('ONLINE');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SCÉNARIO 1 (partie 1) — Poste 1 : signalement + escalade au site,
  // vérification que escalade_niveau='SITE' atteint bien Supabase (cœur du bug).
  // ═══════════════════════════════════════════════════════════════════════
  test('1. Poste 1 — OPV_A signale absente, ADMIN_CENTRE_A escalade au site -> escalade_niveau=SITE remonte sur Supabase', async () => {
    test.setTimeout(180_000);
    const { window } = envA!;

    // ── OPV_A : création + signalement d'absence ──────────────────────────
    await login(window, topoA.opvA, /#\/agent-verification$/);
    const c1 = await createCardViaApp(window, topoA.siteId, topoA.centreAId, card1.noms, '1990-01-01', 'A1', topoA.opvA.login);
    card1.id = c1.id;
    card1.sync_id = c1.sync_id;
    await signalerAbsenceViaApp(window, c1.id, {
      role: 'OPERATEUR_VERIFICATION',
      site_id: topoA.siteId,
      id_user: topoA.opvA.id,
      centre_id: topoA.centreAId,
      login: topoA.opvA.login
    });

    const localAfterSignal = queryDb(dbPathA, `SELECT statut_physique||'|'||escalade_niveau||'|'||is_dirty FROM t_cartes WHERE id_carte=${card1.id};`);
    console.log(`[QA-CHECK][Scénario1] État local après signalerAbsence -> "${localAfterSignal}"`);
    expect(localAfterSignal).toBe('ABSENT|CENTRE|1');

    await logout(window);

    // ── ADMIN_CENTRE_A : escalade au site (le cœur du correctif) ──────────
    await login(window, topoA.adminCentreA, /#\/admin-centre$/);
    await window.evaluate(() => { window.location.hash = '#/admin-centre/queue'; });
    await expect(window.getByText(card1.noms).first()).toBeVisible({ timeout: 15000 });

    const escaladeBtn = window.getByRole('button', { name: /Escalader au Site/ });
    await expect(escaladeBtn).toBeVisible({ timeout: 10000 });
    await escaladeBtn.click();
    await expect(window.getByText(/escaladée à l.administrateur du site avec succès/i)).toBeVisible({ timeout: 15000 });

    const localAfterEscalade = queryDb(dbPathA, `SELECT escalade_niveau||'|'||is_dirty FROM t_cartes WHERE id_carte=${card1.id};`);
    console.log(`[QA-CHECK][Scénario1] État local juste après clic "Escalader au Site" -> "${localAfterEscalade}"`);

    // ── Vérification CŒUR DU BUG : escalade_niveau='SITE' doit atteindre Supabase ──
    let cloudCard: any = null;
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      cloudCard = await getCloudCardBySyncId(card1.sync_id);
      if (cloudCard && cloudCard.escalade_niveau === 'SITE') break;
      await window.waitForTimeout(3000);
    }
    console.log(`[QA-CHECK][Scénario1][CŒUR DU CORRECTIF] Carte sur Supabase après escalade -> ${cloudCard ? JSON.stringify({ escalade_niveau: cloudCard.escalade_niveau, statut_physique: cloudCard.statut_physique, id_centre: cloudCard.id_centre }) : 'ABSENTE DU CLOUD'}`);
    expect(cloudCard).not.toBeNull();
    expect(cloudCard.escalade_niveau).toBe('SITE');
    expect(Number(cloudCard.id_centre)).toBe(topoA.centreAId);

    // Laisse le tab "Escalades Résolues" (vide à ce stade) déjà monté et
    // affiché, SANS déconnexion — préparation du Scénario 3 (rafraîchissement
    // automatique) : cet onglet doit rester ouvert pendant toute l'action
    // faite depuis le Poste 2 ci-dessous.
    await window.getByText('Escalades Résolues').first().click();
    await expect(window.getByText(/Aucune escalade résolue en attente/i)).toBeVisible({ timeout: 10000 });
    console.log('[QA-CHECK][Scénario3][Préparation] Onglet "Escalades Résolues" de ADMIN_CENTRE_A monté et vide, laissé ouvert avant l\'action du Poste 2.');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SCÉNARIO 1 (partie 2) — Poste 2 : ADMINISTRATEUR_SITE pull -> la carte
  // apparaît dans SA file d'attente locale (getAbsencesSite).
  // ═══════════════════════════════════════════════════════════════════════
  test('2. Poste 2 — nouvelle instance, ADMIN_SITE pull -> la carte escaladée apparaît dans getAbsencesSite', async () => {
    test.setTimeout(240_000);
    const { app, window } = await launchAllowRealSync(userDataDirB);
    envB = { app, window, userDataDir: userDataDirB };

    const localBefore = queryDb(dbPathB, `SELECT COUNT(*) FROM t_cartes WHERE noms='${card1.noms}';`);
    expect(Number(localBefore)).toBe(0);

    await login(window, topoB.adminSite, /#\/dashboard$/);
    await waitForNetworkOnline(window, 90_000);

    // Contrôle croisé direct (indépendant de l'UI) avant de dépendre du bouton.
    let directCount = -1;
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      directCount = await window.evaluate((siteId) => (window as any).api.sync.getCloudCartesCount(siteId), topoB.siteId);
      if (directCount > 0) break;
      await window.waitForTimeout(3000);
    }
    console.log(`[QA-CHECK][Scénario1][Pull] sync:getCloudCartesCount(${topoB.siteId}) direct (Poste 2) = ${directCount} (attendu >= 1)`);
    expect(directCount).toBeGreaterThan(0);

    const pullBtn = window.getByRole('button', { name: /TÉLÉCHARGER \d+ CARTES DEPUIS LE CLOUD|RÉCUPÉRATION EN COURS/ });
    await expect(pullBtn).toBeVisible({ timeout: 20000 });
    await expect(pullBtn).toHaveText(/TÉLÉCHARGER \d+ CARTES DEPUIS LE CLOUD/, { timeout: 30000 });
    await pullBtn.click();
    await expect(window.getByText(/Récupération réussie|données locales sont déjà à jour/i)).toBeVisible({ timeout: 40000 });

    // Vérité terrain LOCALE (SQLite) après pull.
    const localAfterPull = queryDb(dbPathB, `SELECT escalade_niveau||'|'||statut_physique||'|'||centre_id FROM t_cartes WHERE noms='${card1.noms}';`);
    console.log(`[QA-CHECK][Scénario1][Pull] État local Poste 2 après pull -> "${localAfterPull}"`);
    expect(localAfterPull).toBe(`SITE|ABSENT|${topoB.centreAId}`);

    // Vérité terrain via l'IPC réellement utilisé par la file d'attente Admin Site.
    const absencesSite = await window.evaluate((siteId) => (window as any).api.cartes.getAbsencesSite(siteId), topoB.siteId);
    const found = (absencesSite || []).find((r: any) => r.noms === card1.noms);
    console.log(`[QA-CHECK][Scénario1][Pull] getAbsencesSite(${topoB.siteId}) contient la carte -> ${!!found}`);
    expect(found).toBeTruthy();

    // Navigation normale (pas un "rafraîchissement manuel" au sens du Scénario 3 —
    // simple montage de page après le pull) : confirme le rendu visuel de la file.
    await window.getByText(/File d.attente/i).click();
    await window.waitForURL(/#\/admin\/queue$/, { timeout: 15000 });
    await expect(window.getByText(card1.noms).first()).toBeVisible({ timeout: 15000 });

    const declarerBtn = window.getByRole('button', { name: /Déclarer Introuvable/ });
    await expect(declarerBtn).toBeVisible({ timeout: 10000 });
    console.log('[QA-CHECK][Scénario1][CONFIRMÉ] La carte escaladée par le Poste 1 est visible et actionnable dans la file d\'attente du Poste 2 (ADMIN_SITE), via un pull cloud réel.');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SCÉNARIO 2 — Poste 2 : déclaration de perte -> statut_physique='PERDUE'
  // ET escalade_niveau='RESOLU' doivent remonter sur Supabase.
  // ═══════════════════════════════════════════════════════════════════════
  test('3. Poste 2 — ADMIN_SITE déclare la carte perdue -> statut_physique=PERDUE + escalade_niveau=RESOLU sur Supabase', async () => {
    test.setTimeout(120_000);
    const { window } = envB!;

    const declarerBtn = window.getByRole('button', { name: /Déclarer Introuvable/ });
    await declarerBtn.click();
    await expect(window.getByText(/déclarée perdue avec succès/i)).toBeVisible({ timeout: 15000 });

    const localAfterDeclare = queryDb(dbPathB, `SELECT statut_physique||'|'||escalade_niveau||'|'||is_dirty FROM t_cartes WHERE noms='${card1.noms}';`);
    console.log(`[QA-CHECK][Scénario2] État local Poste 2 juste après "Déclarer Introuvable" -> "${localAfterDeclare}"`);

    let cloudCard: any = null;
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      cloudCard = await getCloudCardBySyncId(card1.sync_id);
      if (cloudCard && cloudCard.statut_physique === 'PERDUE' && cloudCard.escalade_niveau === 'RESOLU') break;
      await window.waitForTimeout(3000);
    }
    console.log(`[QA-CHECK][Scénario2][CŒUR DU CORRECTIF] Carte sur Supabase après déclaration de perte -> ${cloudCard ? JSON.stringify({ statut_physique: cloudCard.statut_physique, escalade_niveau: cloudCard.escalade_niveau }) : 'PAS DE MISE À JOUR VISIBLE'}`);
    expect(cloudCard).not.toBeNull();
    expect(cloudCard.statut_physique).toBe('PERDUE');
    expect(cloudCard.escalade_niveau).toBe('RESOLU');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SCÉNARIO 3 — Poste 1 : l'onglet "Escalades Résolues" (déjà ouvert AVANT
  // l'action du Poste 2 ci-dessus) doit se rafraîchir tout seul sur un pull
  // réel, sans changement d'onglet ni reload.
  // ═══════════════════════════════════════════════════════════════════════
  test('4. Poste 1 — ADMIN_CENTRE_A (onglet déjà ouvert) : un pull réel déclenche le rafraîchissement automatique sans reload', async () => {
    test.setTimeout(120_000);
    const { window } = envA!;

    // L'onglet est resté ouvert et vide depuis le test 1 (aucune navigation,
    // aucune déconnexion entre-temps). On déclenche un pull RÉEL via le
    // bouton "RÉCUPÉRER" du header ADMIN_CENTRE — ce pull passe par le même
    // downstream.ts qui émet 'sync:updated-data' SANS champ `type`
    // (downstream.ts:265), exactement la même forme d'événement qu'un pull
    // automatique en tâche de fond (sync-engine.ts:553).
    const pullBtn = window.getByRole('button', { name: /RÉCUPÉRER|RÉCUPÉRATION\.\.\./ });
    await expect(pullBtn).toBeVisible({ timeout: 15000 });
    await expect(pullBtn).toHaveText(/RÉCUPÉRER \(\d+\)/, { timeout: 40000 });

    // État AVANT le pull : toujours vide (contrôle négatif).
    await expect(window.getByText(/Aucune escalade résolue en attente/i)).toBeVisible();

    await pullBtn.click();

    // Surveillance DOM directe (Playwright auto-retry) — AUCUN page.reload(),
    // AUCUN changement d'onglet : on attend que le badge rouge apparaisse
    // tout seul dans l'onglet déjà affiché.
    await expect(window.getByText('❌ Perdue confirmée')).toBeVisible({ timeout: 30000 });
    await expect(window.getByText(card1.noms).first()).toBeVisible({ timeout: 5000 });
    console.log('[QA-CHECK][Scénario3][CONFIRMÉ] "Escalades Résolues" (ADMIN_CENTRE_A) s\'est rafraîchi automatiquement sur un sync:updated-data sans type, sans reload ni changement d\'onglet.');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SCÉNARIO 2 (suite) — OPERATEUR_VERIFICATION d'origine voit la résolution
  // dans son propre onglet "Résolus".
  // ═══════════════════════════════════════════════════════════════════════
  test('5. Poste 1 — OPV_A (auteur du signalement d\'origine) voit la carte dans son onglet "Résolus"', async () => {
    test.setTimeout(90_000);
    const { window } = envA!;
    await logout(window);
    await login(window, topoA.opvA, /#\/agent-verification$/);
    await window.evaluate(() => { window.location.hash = '#/agent-verification/recherche'; });
    await window.getByText('Historique Résolus').click();
    await expect(window.getByText(card1.noms).first()).toBeVisible({ timeout: 20000 });
    await expect(window.getByText('❌ Perdue confirmée')).toBeVisible({ timeout: 5000 });
    console.log('[QA-CHECK][Scénario2][CONFIRMÉ] OPV_A voit sa carte "Perdue confirmée" dans son historique Résolus.');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SCÉNARIO 4 — Non-régression cloisonnement : ADMIN_CENTRE_B (centre B) ne
  // doit JAMAIS voir l'escalade du centre A, y compris sur des données ayant
  // réellement transité par le cloud (Poste 2, données pull-ées).
  // ═══════════════════════════════════════════════════════════════════════
  test('6. Poste 2 — ADMIN_CENTRE_B (centre B) ne voit AUCUNE escalade du centre A malgré le pull cloud réel', async () => {
    test.setTimeout(90_000);
    const { window } = envB!;
    await logout(window);
    await login(window, topoB.adminCentreB, /#\/admin-centre$/);
    await window.evaluate(() => { window.location.hash = '#/admin-centre/queue'; });
    await window.getByText('Escalades Résolues').first().click();
    await expect(window.getByText(/Aucune escalade résolue en attente/i)).toBeVisible({ timeout: 15000 });
    await expect(window.getByText(card1.noms)).toHaveCount(0);

    // Double vérification par IPC direct (indépendant du rendu React).
    const escaladesB = await window.evaluate((centreId) => (window as any).api.cartes.getEscaladesResoluesCentre(centreId), topoB.centreBId);
    console.log(`[QA-CHECK][Scénario4][Cloisonnement] getEscaladesResoluesCentre(centreB=${topoB.centreBId}) sur Poste 2 (données transitées par le cloud) -> ${JSON.stringify(escaladesB)}`);
    expect((escaladesB || []).length).toBe(0);

    // Confirme que la donnée existe pourtant bel et bien en local sur ce
    // poste (via le pull), pour prouver que c'est le filtrage SQL centre_id
    // qui protège, pas une absence de données.
    const rawRow = queryDb(dbPathB, `SELECT centre_id FROM t_cartes WHERE noms='${card1.noms}';`);
    console.log(`[QA-CHECK][Scénario4][Cloisonnement] Ligne brute présente localement sur Poste 2 avec centre_id=${rawRow} (centreA=${topoB.centreAId}, centreB=${topoB.centreBId}) — cloisonnement applicatif confirmé, pas absence de données.`);
    expect(Number(rawRow)).toBe(topoB.centreAId);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SCÉNARIO 5 — Non-régression : signalerAbsence/resoudreAbsence (déjà
  // fonctionnels avant ce correctif) continuent à fonctionner cross-poste.
  // ═══════════════════════════════════════════════════════════════════════
  test('7. Poste 1 — Non-régression : résolution DIRECTE (sans escalade) par ADMIN_CENTRE_A continue de fonctionner cross-poste', async () => {
    test.setTimeout(180_000);
    const { window } = envA!;
    await logout(window);
    await login(window, topoA.opvA, /#\/agent-verification$/);
    const c2 = await createCardViaApp(window, topoA.siteId, topoA.centreAId, card2.noms, '1990-02-02', 'B2', topoA.opvA.login);
    card2.id = c2.id;
    card2.sync_id = c2.sync_id;
    await signalerAbsenceViaApp(window, c2.id, {
      role: 'OPERATEUR_VERIFICATION',
      site_id: topoA.siteId,
      id_user: topoA.opvA.id,
      centre_id: topoA.centreAId,
      login: topoA.opvA.login
    });
    await logout(window);

    await login(window, topoA.adminCentreA, /#\/admin-centre$/);
    await window.evaluate(() => { window.location.hash = '#/admin-centre/queue'; });
    await window.getByText('Anomalies Actives').click().catch(() => {});
    await expect(window.getByText(card2.noms).first()).toBeVisible({ timeout: 15000 });

    const rangementInput = window.locator('input[placeholder*="Nouveau Rangement"]');
    await rangementInput.fill('ZZTEST-B2-RELOC');
    const resolveBtn = window.getByRole('button', { name: /Valider la relocalisation/ });
    await resolveBtn.click();
    await expect(window.getByText(/relocalisée et statut remis à OK/i)).toBeVisible({ timeout: 15000 });

    let cloudCard2: any = null;
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      cloudCard2 = await getCloudCardBySyncId(card2.sync_id);
      if (cloudCard2 && cloudCard2.statut_physique === 'OK') break;
      await window.waitForTimeout(3000);
    }
    console.log(`[QA-CHECK][Scénario5][Non-régression] Carte résolue directement (sans escalade) sur Supabase -> ${cloudCard2 ? JSON.stringify({ statut_physique: cloudCard2.statut_physique, escalade_niveau: cloudCard2.escalade_niveau }) : 'ABSENTE'}`);
    expect(cloudCard2).not.toBeNull();
    expect(cloudCard2.statut_physique).toBe('OK');
    expect(cloudCard2.escalade_niveau).toBe('RESOLU');
  });
});
