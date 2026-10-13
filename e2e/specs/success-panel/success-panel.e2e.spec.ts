/**
 * e2e/specs/success-panel/success-panel.e2e.spec.ts
 *
 * Panneau de succès animé (« sceau de validation ») — SuccessPanel.tsx / successPanelService.ts,
 * monté dans App.tsx et branché sur trois opérations :
 *   - délivrance d'une carte CMU        (useDeliveryFlow.ts, route OPERATEUR_VERIFICATION),
 *   - import CSV (statut SUCCES seul)   (ImportPage.tsx, route ADMINISTRATEUR_SITE),
 *   - publication de brouillons         (AgentSaisieLayout.tsx = N2 / MesBrouillonsView.tsx = N3,
 *                                        panneau seulement si promotedCount > 0).
 *
 * ── Isolation (aucun accès cloud, aucune donnée de production) ───────────────────────────
 * Même harnais que les autres specs hors cloud : `launchSeededApp()` SANS option (jamais
 * `allowRealSync`) crée un `userDataDir` jetable sous le dossier temporaire du système, y seed
 * le schéma réel + utilisateurs E2E_*, et force GEST_IN_SITU_E2E_DISABLE_SYNC=1. Ce fichier n'est
 * volontairement PAS nommé `*.cloud.e2e.spec.ts`. Le test 0 vérifie explicitement, avant toute
 * écriture : (1) userDataDir sous os.tmpdir(), (2) userData réellement utilisé par l'application
 * (app.getPath('userData')) identique à ce dossier, (3) base seedée dans ce dossier, (4) variable
 * GEST_IN_SITU_E2E_DISABLE_SYNC=1 effective dans le process principal. Si l'un d'eux échoue, la
 * suite s'arrête (describe.serial) avant toute donnée de test.
 * Toutes les données créées sont préfixées `ZZTEST_PNL` et supprimées en fin de run (la base
 * reste de toute façon jetable).
 *
 * ── Prérequis d'exécution ────────────────────────────────────────────────────────────────
 * Les specs hors cloud lancent `dist/main/index.js` : le build doit être À JOUR (sinon l'ancienne
 * version, sans panneau, est testée). `npm run test:e2e -- e2e/specs/success-panel` reconstruit
 * d'abord (`pretest:e2e` = electron-vite build, build simple sans packaging).
 *
 * ── Limites connues ──────────────────────────────────────────────────────────────────────
 * - `emulateMedia({ reducedMotion })` n'est pas garanti sur une fenêtre Electron : le cas A7
 *   vérifie l'effectivité de l'émulation (matchMedia) et se marque SKIP — jamais un faux succès —
 *   si elle est sans effet.
 * - Les durées (4 s, pause, fondu) sont testées avec de larges marges (la logique exacte de
 *   temporisation est couverte en unitaire par tests/success-panel-service.test.ts).
 * - Non couvert ici : déclaration de doublon (flux distinct, sans lien avec le panneau).
 */
import { test, expect, type Locator } from '@playwright/test';
import { launchSeededApp, teardownSeededApp, type E2EEnvironment } from '../../fixtures/electron-app';
import { getTestUser } from '../../fixtures/test-users';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { basename, join, resolve, sep } from 'path';

const execFileAsync = promisify(execFile);

const PANEL_TESTID = 'success-panel';
const DELIVERY_TITLE = 'Carte délivrée avec succès !';
const DELIVERY_DETAIL = 'Enregistrée sur ce poste';
const DRAFT_DETAIL = 'Enregistrés sur ce poste';
const CARD_PRENOM = 'SEAL';
const CARD_DDN_DISPLAY = '15/01/1990';

// Cartes EN STOCK du centre de l'opérateur (une par scénario de délivrance).
const CARDS = {
  alpha: 'ZZTEST_PNLALPHA',     // A1 (panneau complet) puis A8a (preuve de retrait)
  bravo: 'ZZTEST_PNLBRAVO',     // A3 fermeture automatique
  charlie: 'ZZTEST_PNLCHARLIE', // A2 position / sidebar
  delta: 'ZZTEST_PNLDELTA',     // A4 pause au survol
  echo: 'ZZTEST_PNLECHO',       // A5 pause au focus + fermeture clavier
  lima: 'ZZTEST_PNLLIMA',       // A5b fermeture manuelle (clic)
  foxtrot: 'ZZTEST_PNLFOXTROT', // A6 Échap
  golf: 'ZZTEST_PNLGOLF',       // A7 prefers-reduced-motion
  hotel: 'ZZTEST_PNLHOTEL',     // A9 déconnexion juste après une délivrance
  india: 'ZZTEST_PNLINDIA',     // A8c retour arrière + signalement d'absence (non-succès)
  kilo: 'ZZTEST_PNLKILO'        // A8b non classée sans rangement d'urgence (échec de validation)
} as const;

test.describe.serial('Panneau de succès animé — délivrance, brouillons, import (hors cloud)', () => {
  let env: E2EEnvironment;
  let anyTestFailed = false;
  let opSaisieId = 0;
  const csvDir = mkdtempSync(join(tmpdir(), 'gest-in-situ-e2e-panel-csv-'));

  const siteId = () => env.seed.siteId;
  const centreId = () => env.seed.centreId;

  test.beforeAll(async () => {
    // Jamais `allowRealSync` : synchronisation Supabase coupée par la fixture.
    env = await launchSeededApp();
  });

  test.afterAll(async () => {
    if (env) {
      try {
        await dbQuery("DELETE FROM t_cartes WHERE noms LIKE 'ZZTEST\\_PNL%' ESCAPE '\\'");
        await dbQuery("DELETE FROM t_logs WHERE detail LIKE '%ZZTEST_PNL%'");
        await dbQuery("DELETE FROM audit_logs WHERE details LIKE '%ZZTEST_PNL%'");
      } catch (e) {
        console.warn('[E2E] Nettoyage ZZTEST_PNL échoué (non bloquant, répertoire jetable de toute façon) :', e);
      }
      await teardownSeededApp(env, anyTestFailed);
    }
    try { rmSync(csvDir, { recursive: true, force: true }); } catch { /* temporaire */ }
  });

  test.afterEach(async ({}, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus) {
      anyTestFailed = true;
    }
  });

  // Aucun test ne doit démarrer avec un panneau encore affiché par le test précédent.
  test.beforeEach(async () => {
    if (env) await expect(panel()).toHaveCount(0, { timeout: 8000 });
  });

  // ── Helpers ──────────────────────────────────────────────────────────────────────────

  const DB_QUERY_MARKER = '__E2E_DBQ__:';
  /** Requête SQL sur la base JETABLE du run (better-sqlite3 sous ELECTRON_RUN_AS_NODE). */
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

  const panel = (): Locator => env.window.getByTestId(PANEL_TESTID);
  const closeButton = (): Locator => panel().getByRole('button', { name: 'Fermer la notification' });
  const nameInput = (): Locator => env.window.locator('input[placeholder="Ex: KOFFI KOFFI KAN"]');

  type Box = { x: number; y: number; width: number; height: number };
  const overlaps = (a: Box, b: Box): boolean =>
    a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

  /** Éloigne le pointeur (haut de la zone de contenu) : il ne doit jamais survoler le panneau. */
  async function parkPointer(): Promise<void> {
    const w = await env.window.evaluate(() => globalThis.innerWidth);
    await env.window.mouse.move(Math.floor(w * 0.75), 100);
  }

  async function loginAs(userKey: string, urlAfter: RegExp): Promise<void> {
    const { window: page } = env;
    const user = getTestUser(userKey);
    await page.waitForURL(/#\/login/, { timeout: 30000 });
    await page.getByTestId('login-input').fill(user.login);
    await page.getByTestId('password-input').fill(user.password);
    await page.getByTestId('login-submit').click();
    await page.waitForURL(urlAfter, { timeout: 20000 });
  }

  async function logout(): Promise<void> {
    const { window: page } = env;
    await page.locator('.btn-logout').click();
    await page.waitForURL(/#\/login/, { timeout: 15000 });
  }

  // ── Carte EN STOCK du centre de l'opérateur (insertion SQL directe dans la base jetable) ─
  async function seedCard(noms: string, rangement: string): Promise<number> {
    const contact = '0102030405';
    const cle = `${noms}|${CARD_PRENOM}|1990-01-15||${contact}`;
    const res = await dbQuery(
      `INSERT INTO t_cartes (noms, prenoms, date_de_naissance, rangement, statut, statut_physique,
         contact, num_secu, site_id, centre_id, agent_saisie, cle_doublon, cle_doublon_flex, sync_id, is_dirty)
       VALUES (?, ?, '1990-01-15', ?, 'EN STOCK', 'OK', ?, ?, ?, ?, 'SYSTEM', ?, ?, ?, 0)`,
      [noms, CARD_PRENOM, rangement, contact, `ZZTEST-PNL-NS-${noms}`, siteId(), centreId(), cle, cle, `zztest-pnl-${noms}-${Date.now()}`]
    );
    return Number(res[0].lastInsertRowid);
  }

  async function openDeliveryFor(noms: string): Promise<void> {
    const { window: page } = env;
    await nameInput().fill(`${noms} ${CARD_PRENOM}`);
    await page.locator('input[placeholder="JJ/MM/AAAA"]').fill(CARD_DDN_DISPLAY);
    await page.getByRole('button', { name: /Rechercher la Carte/ }).click();
    await expect(page.getByText('Vérification Physique')).toBeVisible({ timeout: 10000 });
  }

  /** Recherche + modale + « Valider la délivrance ». Le pointeur est éloigné juste après le clic. */
  async function deliverCard(noms: string): Promise<void> {
    const { window: page } = env;
    await openDeliveryFor(noms);
    await page.getByRole('button', { name: /Oui, j'ai la carte/ }).click();
    await expect(page.getByText('Validation du Retrait')).toBeVisible();
    await page.getByRole('button', { name: /Valider la délivrance/ }).click();
    await parkPointer();
  }

  async function waitNameInputFocused(): Promise<void> {
    // useDeliveryFlow redonne le focus au champ nom ~50 ms après loadStats/loadCardsToday :
    // on attend ce focus AVANT de focaliser le panneau, sinon il pourrait nous le reprendre.
    await expect(nameInput()).toBeFocused({ timeout: 8000 });
  }

  // ══════════════════════════════════════════════════════════════════════════════════════
  // BLOC 0 — Isolation et données de test
  // ══════════════════════════════════════════════════════════════════════════════════════

  test('0. Isolation : userData jetable sous le dossier temporaire, synchronisation réseau coupée', async () => {
    const tmpRoot = resolve(tmpdir()).toLowerCase();
    const userDataDir = resolve(env.userDataDir).toLowerCase();
    expect(userDataDir.startsWith(tmpRoot + sep), `userDataDir hors du dossier temporaire : ${env.userDataDir}`).toBe(true);
    expect(basename(userDataDir).startsWith('gest-in-situ-e2e-')).toBe(true);
    expect(resolve(env.seed.dbPath).toLowerCase().startsWith(userDataDir + sep), `base hors du userData jetable : ${env.seed.dbPath}`).toBe(true);

    const appUserData = await env.app.evaluate(({ app }) => app.getPath('userData'));
    expect(resolve(appUserData).toLowerCase(), 'userData réellement utilisé par l\'application').toBe(userDataDir);

    const syncFlag = await env.app.evaluate(() => process.env.GEST_IN_SITU_E2E_DISABLE_SYNC);
    expect(syncFlag, 'GEST_IN_SITU_E2E_DISABLE_SYNC doit valoir 1 dans le process principal').toBe('1');
  });

  test('0b. Données de test ZZTEST_PNL (cartes EN STOCK du centre de l\'opérateur)', async () => {
    for (const noms of Object.values(CARDS)) {
      await seedCard(noms, noms === CARDS.kilo ? '' : 'P1');
    }
    const rows = await dbQuery("SELECT COUNT(*) AS c FROM t_cartes WHERE noms LIKE 'ZZTEST\\_PNL%' ESCAPE '\\'");
    expect(rows[0].c).toBe(Object.keys(CARDS).length);
  });

  // ══════════════════════════════════════════════════════════════════════════════════════
  // BLOC A — OPERATEUR_VERIFICATION : délivrance
  // ══════════════════════════════════════════════════════════════════════════════════════

  test('A0. Connexion OPERATEUR_VERIFICATION + accès à Recherche Active', async () => {
    const { window: page } = env;
    await loginAs('operateurVerification', /#\/agent-verification$/);
    await page.getByRole('link', { name: 'Recherche Active' }).click();
    await page.waitForURL(/#\/agent-verification\/recherche/, { timeout: 15000 });
    await expect(nameInput()).toBeVisible();
    // Aucun panneau (ni conteneur role="status" vide) tant qu'aucun succès n'a eu lieu.
    await expect(panel()).toHaveCount(0);
    await expect(page.locator(`[role="status"][data-testid="${PANEL_TESTID}"]`)).toHaveCount(0);
  });

  test('A1. Délivrance réussie : panneau, titre, détail, rôle status, aucune mention du cloud, focus préservé', async () => {
    const { window: page } = env;
    await deliverCard(CARDS.alpha);
    const p = panel();
    await expect(p).toBeVisible({ timeout: 10000 });

    // Contrôle : l'animation est bien en cours juste après l'apparition (sert de témoin au cas A7).
    const animations = await p.evaluate((el) => el.getAnimations({ subtree: true }).length);
    expect(animations, 'animation SVG/CSS jouée à l\'apparition').toBeGreaterThan(0);

    await expect(p).toHaveAttribute('role', 'status');
    await expect(p.getByText(DELIVERY_TITLE, { exact: true })).toBeVisible();
    await expect(p.getByText(DELIVERY_DETAIL, { exact: true })).toBeVisible();
    await expect(page.getByText(DELIVERY_TITLE)).toHaveCount(1); // un seul élément de succès à l'écran
    const text = (await p.innerText()).toLowerCase();
    expect(text, 'le panneau ne doit jamais suggérer une synchronisation cloud terminée').not.toMatch(/cloud|synchronis|supabase|serveur/);

    // Réussite = enregistrement LOCAL : carte DELIVRE, is_dirty=1, outbox PENDING (jamais synchronisée ici).
    const row = await dbQuery("SELECT id_carte, statut, is_dirty, sync_id FROM t_cartes WHERE noms = ?", [CARDS.alpha]);
    expect(row[0].statut).toBe('DELIVRE');
    expect(row[0].is_dirty).toBe(1);
    const outbox = await dbQuery("SELECT status FROM t_outbox WHERE id = ?", [row[0].sync_id]);
    expect(outbox.length).toBe(1);
    expect(outbox[0].status).toBe('PENDING');

    // Le panneau ne vole pas le focus : useDeliveryFlow le rend au champ de recherche.
    await expect(nameInput()).toBeFocused({ timeout: 8000 });
  });

  test('A2. Position : à droite de la sidebar, sans recouvrir « Déconnexion », y compris après repli/dépli', async () => {
    const { window: page } = env;
    await deliverCard(CARDS.charlie);
    const p = panel();
    await expect(p).toBeVisible({ timeout: 10000 });
    // Survol = délai suspendu (D3) : laisse le temps de mesurer et de replier/déplier la barre.
    await p.hover();

    const sidebar = page.locator('.sidebar');
    const toggle = page.locator('.sidebar-toggle-btn');
    const logoutBtn = page.locator('.btn-logout');
    const measure = async () => {
      const [pb, sb, lb] = await Promise.all([p.boundingBox(), sidebar.boundingBox(), logoutBtn.boundingBox()]);
      if (!pb || !sb || !lb) throw new Error('Mesure impossible : panneau, .sidebar ou .btn-logout sans boîte englobante.');
      return { pb, sb, lb, gap: pb.x - (sb.x + sb.width) };
    };

    let m = await measure();
    expect(m.gap, 'panneau à droite de la sidebar (marge ≈ 24 px)').toBeGreaterThanOrEqual(23);
    expect(overlaps(m.pb, m.lb), 'le panneau ne doit pas recouvrir .btn-logout').toBe(false);
    const widthInitial = m.sb.width;

    // Bascule de l'état de la sidebar au clavier (la souris reste sur le panneau, donc en pause).
    await toggle.press('Enter');
    await expect.poll(async () => Math.abs((await measure()).gap - 24) <= 1.5, { timeout: 4000 }).toBe(true);
    m = await measure();
    expect(overlaps(m.pb, m.lb), 'aucun recouvrement après changement d\'état de la sidebar').toBe(false);
    const widthAfterToggle = m.sb.width;

    // Retour à l'état initial (la préférence de repli ne doit pas fuiter vers les autres tests).
    await toggle.press('Enter');
    await expect.poll(async () => {
      const x = await measure();
      return Math.abs(x.gap - 24) <= 1.5 && Math.abs(x.sb.width - widthInitial) <= 1;
    }, { timeout: 4000 }).toBe(true);
    m = await measure();
    expect(overlaps(m.pb, m.lb)).toBe(false);
    console.log(`[PANEL][A2] largeur sidebar initiale=${widthInitial}px, après bascule=${widthAfterToggle}px (identique si la fenêtre est sous le point de rupture).`);
    await parkPointer();
  });

  test('A3. Fermeture automatique après ≈ 4 s', async () => {
    await deliverCard(CARDS.bravo);
    const p = panel();
    await expect(p).toBeVisible({ timeout: 10000 });
    const t0 = Date.now();
    await env.window.waitForTimeout(2500);
    await expect(p, 'toujours affiché à ≈ 2,5 s').toBeVisible();
    await expect(p).toBeHidden({ timeout: 6000 });
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeGreaterThanOrEqual(3300);
    expect(elapsed).toBeLessThan(6500);
  });

  test('A4. Pause au survol : le panneau reste affiché au-delà de 4 s, puis se ferme après reprise', async () => {
    await deliverCard(CARDS.delta);
    const p = panel();
    await expect(p).toBeVisible({ timeout: 10000 });
    await p.hover();
    await env.window.waitForTimeout(6000);
    await expect(p, 'toujours affiché après 6 s de survol (délai suspendu)').toBeVisible();
    await parkPointer();
    const t0 = Date.now();
    await expect(p).toBeHidden({ timeout: 8000 });
    const elapsed = Date.now() - t0;
    expect(elapsed, 'le délai reprend après le survol (pas de fermeture instantanée)').toBeGreaterThanOrEqual(2000);
    expect(elapsed).toBeLessThan(6500);
  });

  test('A5. Pause au focus + fermeture au clavier (Entrée) : le focus est rendu au champ précédent', async () => {
    await deliverCard(CARDS.echo);
    const p = panel();
    await expect(p).toBeVisible({ timeout: 10000 });
    await waitNameInputFocused();
    await closeButton().focus(); // atteignable au clavier ; focus dans le panneau = délai suspendu
    await env.window.waitForTimeout(5500);
    await expect(p, 'toujours affiché après 5,5 s avec le focus dans le panneau').toBeVisible();
    await closeButton().press('Enter');
    await expect(p).toHaveCount(0, { timeout: 3000 });
    await expect(nameInput(), 'le focus revient à l\'élément qui le détenait avant le panneau').toBeFocused();
  });

  test('A5b. Fermeture manuelle au clic sur le bouton « Fermer »', async () => {
    await deliverCard(CARDS.lima);
    const p = panel();
    await expect(p).toBeVisible({ timeout: 10000 });
    await closeButton().click();
    await expect(p).toHaveCount(0, { timeout: 3000 });
  });

  test('A6. Échap : sans effet hors du panneau, ferme le panneau lorsque le focus y est', async () => {
    await deliverCard(CARDS.foxtrot);
    const p = panel();
    await expect(p).toBeVisible({ timeout: 10000 });
    await waitNameInputFocused();
    await env.window.keyboard.press('Escape'); // focus sur le champ de recherche, pas dans le panneau
    await env.window.waitForTimeout(600);
    await expect(p, 'Échap hors du panneau ne le ferme pas').toBeVisible();
    await closeButton().focus();
    await env.window.keyboard.press('Escape');
    await expect(p).toHaveCount(0, { timeout: 3000 });
    await expect(nameInput()).toBeFocused();
  });

  test('A7. prefers-reduced-motion : état final immédiat, aucune animation en cours', async () => {
    const { window: page } = env;
    await page.emulateMedia({ reducedMotion: 'reduce' });
    try {
      const effective = await page.evaluate(() => globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches);
      // Défensif : si l'émulation est sans effet sur cette fenêtre Electron, on ne produit PAS un faux succès.
      test.skip(!effective, 'emulateMedia({ reducedMotion }) sans effet sur cette fenêtre Electron : cas non vérifiable ici.');

      await deliverCard(CARDS.golf);
      const p = panel();
      await expect(p).toBeVisible({ timeout: 10000 });
      const state = await p.evaluate((el) => ({
        animations: el.getAnimations({ subtree: true }).length,
        opacity: getComputedStyle(el).opacity
      }));
      expect(state.animations, 'aucune animation en cours avec prefers-reduced-motion').toBe(0);
      expect(state.opacity, 'état final (pleinement visible) immédiat').toBe('1');
      await expect(p.getByText(DELIVERY_TITLE, { exact: true })).toBeVisible();
    } finally {
      await page.emulateMedia({ reducedMotion: null });
    }
  });

  test('A8. Aucun panneau pour une opération qui n\'est pas un succès de délivrance', async () => {
    const { window: page } = env;

    // (a) Carte déjà délivrée → Preuve de Retrait, pas de panneau.
    await nameInput().fill(`${CARDS.alpha} ${CARD_PRENOM}`);
    await page.locator('input[placeholder="JJ/MM/AAAA"]').fill(CARD_DDN_DISPLAY);
    await page.getByRole('button', { name: /Rechercher la Carte/ }).click();
    await expect(page.getByRole('heading', { name: 'Preuve de Retrait' })).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(800);
    await expect(panel()).toHaveCount(0);
    await page.locator('.btn-close').click();
    await expect(page.getByRole('heading', { name: 'Preuve de Retrait' })).not.toBeVisible();

    // (b) Échec de validation : carte non classée sans rangement d'urgence → toast d'erreur, pas de panneau.
    await openDeliveryFor(CARDS.kilo);
    await page.getByRole('button', { name: /Oui, j'ai la carte/ }).click();
    await page.getByRole('button', { name: /Valider la délivrance/ }).click();
    await expect(page.getByText("Le rangement d'urgence est obligatoire pour cette carte.")).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(800);
    await expect(panel()).toHaveCount(0);
    const kilo = await dbQuery('SELECT statut FROM t_cartes WHERE noms = ?', [CARDS.kilo]);
    expect(kilo[0].statut).toBe('EN STOCK');
    await page.locator('.btn-close').click();

    // (c) Annulation (Retour) puis signalement d'absence : ni l'un ni l'autre n'est un succès de délivrance.
    await openDeliveryFor(CARDS.india);
    await page.getByRole('button', { name: /Oui, j'ai la carte/ }).click();
    await page.getByRole('button', { name: 'Retour', exact: true }).click();
    await expect(page.getByText('Avez-vous trouvé la carte physiquement dans le rangement ?')).toBeVisible();
    await expect(panel()).toHaveCount(0);
    await page.getByRole('button', { name: /Non, absente/ }).click();
    await page.getByRole('button', { name: /Confirmer le signalement/ }).click();
    await expect(page.getByText('Absence physique signalée. Traitement admin en cours.')).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(800);
    await expect(panel()).toHaveCount(0);
    const india = await dbQuery('SELECT statut FROM t_cartes WHERE noms = ?', [CARDS.india]);
    expect(india[0].statut).toBe('EN STOCK');
    if (await page.locator('.btn-close').count()) await page.locator('.btn-close').first().click();
  });

  test('A9. Déconnexion juste après une délivrance : « Déconnexion » reste cliquable, et le panneau ne survit pas à la session', async () => {
    const { window: page } = env;
    await deliverCard(CARDS.hotel);
    const p = panel();
    await expect(p).toBeVisible({ timeout: 10000 });
    const [pb, lb] = await Promise.all([p.boundingBox(), page.locator('.btn-logout').boundingBox()]);
    expect(pb && lb && overlaps(pb, lb), 'le panneau ne recouvre pas « Déconnexion »').toBe(false);
    const tShown = Date.now();
    const t0 = Date.now();
    await page.locator('.btn-logout').click(); // le clic échouerait (cible interceptée) si le panneau recouvrait le bouton
    await page.waitForURL(/#\/login/, { timeout: 15000 });
    expect(Date.now() - t0).toBeLessThan(10000);

    // Frontière de session : le pointeur est volontairement LAISSÉ sur l'ancien bouton « Déconnexion »
    // (sidebar disparue, le panneau se replace à gauche, donc sous le pointeur : cas qui suspendait
    // indéfiniment le délai). Le panneau doit être fermé par la fin de session (SuccessPanel.tsx,
    // authStore.user → null), pas par le délai de 4 s : la fermeture doit survenir bien avant.
    await expect(panel(), 'le panneau ne doit pas rester affiché sur l\'écran de connexion').toHaveCount(0, { timeout: 2500 });
    expect(Date.now() - tShown, 'fermé par la fin de session, pas par le délai de 4 s').toBeLessThan(3500);
  });

  // ══════════════════════════════════════════════════════════════════════════════════════
  // BLOC B — OPERATEUR_SAISIE : publication des brouillons (N2 = en-tête, N3 = « Mes Brouillons »)
  // ══════════════════════════════════════════════════════════════════════════════════════

  async function seedDraft(suffix: string, ddn: string | null): Promise<void> {
    const noms = `ZZTEST_PNLDRAFT${suffix}`;
    await dbQuery(
      `INSERT INTO t_cartes (noms, prenoms, date_de_naissance, lieu_de_naissance, statut, site_id, centre_id, created_by, cle_doublon, sync_id, is_dirty)
       VALUES (?, 'DRAFT', ?, 'ABOBO', 'BROUILLON', ?, ?, ?, ?, ?, 1)`,
      [noms, ddn, siteId(), centreId(), opSaisieId, `${noms}|DRAFT|${ddn ?? ''}|ABOBO|`, `zztest-pnl-draft-${suffix}-${Date.now()}`]
    );
  }
  async function clearDrafts(): Promise<void> {
    await dbQuery("DELETE FROM t_cartes WHERE noms LIKE 'ZZTEST\\_PNLDRAFT%' ESCAPE '\\' AND statut = 'BROUILLON'");
  }
  const statutOfDraft = async (suffix: string): Promise<string> =>
    (await dbQuery('SELECT statut FROM t_cartes WHERE noms = ?', [`ZZTEST_PNLDRAFT${suffix}`]))[0].statut;

  const headerPublishButton = (): Locator => env.window.getByRole('button', { name: /VALIDER MES BROUILLONS/ });
  const viewPublishButton = (): Locator => env.window.getByRole('button', { name: /VALIDER TOUS LES BROUILLONS/ });
  const ignoredWarning = (): Locator => env.window.getByText(/brouillon\(s\) ignoré\(s\) car leur date de naissance est invalide/);

  async function openBrouillons(): Promise<void> {
    const { window: page } = env;
    await page.getByRole('link', { name: "Vue d'ensemble" }).click();
    await page.getByRole('link', { name: 'Mes Brouillons' }).click();
    await page.waitForURL(/#\/agent-saisie\/brouillons/, { timeout: 15000 });
    await expect(page.getByText('Chargement en cours...')).toHaveCount(0, { timeout: 20000 });
  }
  async function confirmPublish(): Promise<void> {
    await env.window.getByRole('button', { name: /Oui, valider et envoyer vers le Cloud/ }).click();
  }

  test('B0. Connexion OPERATEUR_SAISIE (compte créé dans la base jetable si absent)', async () => {
    const { window: page } = env;
    const op = getTestUser('operateurSaisie');
    const existing = await dbQuery('SELECT id_user FROM t_users WHERE login = ?', [op.login]);
    if (existing.length === 0) {
      const res = await dbQuery(
        `INSERT INTO t_users (login, password_hash, role, nom_user, prenom_user, statut_actif, site_id, centre_id, sync_id, is_dirty)
         VALUES (?, ?, 'OPERATEUR_SAISIE', ?, ?, 1, ?, ?, ?, 0)`,
        [op.login, op.passwordHash, op.nom, op.prenom, siteId(), centreId(), `e2e-user-opsaisie-pnl-${Date.now()}`]
      );
      await dbQuery('INSERT INTO t_user_roles (id_user, role) VALUES (?, ?)', [res[0].lastInsertRowid, 'OPERATEUR_SAISIE']);
    }
    opSaisieId = (await dbQuery('SELECT id_user FROM t_users WHERE login = ?', [op.login]))[0].id_user;
    await loginAs('operateurSaisie', /#\/agent-saisie$/);
    await expect(page.getByText('PORTAIL DE SAISIE')).toBeVisible();
  });

  test('B1. En-tête (N2) : 1 brouillon valide → panneau « 1 brouillon(s) publié(s) », sans avertissement', async () => {
    await clearDrafts();
    await seedDraft('B1', '1990-01-15');
    await expect(headerPublishButton()).toBeEnabled({ timeout: 15000 });
    await headerPublishButton().click();
    const p = panel();
    await expect(p).toBeVisible({ timeout: 10000 });
    await expect(p.getByText('1 brouillon(s) publié(s)', { exact: true })).toBeVisible();
    await expect(p.getByText(DRAFT_DETAIL, { exact: true })).toBeVisible();
    await expect(ignoredWarning()).toHaveCount(0);
    expect(await statutOfDraft('B1')).toBe('EN STOCK');
  });

  test('B2. En-tête (N2) : 1 valide + 1 date invalide → panneau, ET avertissement séparé pour le brouillon ignoré', async () => {
    await clearDrafts();
    await seedDraft('B2V', '1990-01-15');
    await seedDraft('B2I', null);
    await expect(headerPublishButton()).toBeEnabled({ timeout: 15000 });
    await headerPublishButton().click();
    const p = panel();
    await expect(p).toBeVisible({ timeout: 10000 });
    await expect(p.getByText('1 brouillon(s) publié(s)', { exact: true })).toBeVisible();
    await expect(ignoredWarning().first()).toBeVisible({ timeout: 5000 });
    await expect(p.getByText(/ignoré/), 'l\'avertissement reste un toast séparé, hors du panneau').toHaveCount(0);
    expect(await statutOfDraft('B2V')).toBe('EN STOCK');
    expect(await statutOfDraft('B2I')).toBe('BROUILLON');
  });

  test('B3. En-tête (N2) : uniquement une date invalide (promotedCount = 0) → aucun panneau, toast actuel conservé', async () => {
    await clearDrafts();
    await seedDraft('B3I', null);
    await expect(headerPublishButton()).toBeEnabled({ timeout: 15000 });
    await headerPublishButton().click();
    await expect(ignoredWarning().first()).toBeVisible({ timeout: 10000 });
    await env.window.waitForTimeout(1500);
    await expect(panel()).toHaveCount(0);
    expect(await statutOfDraft('B3I')).toBe('BROUILLON');
  });

  test('B4. « Mes Brouillons » (N3) : 2 brouillons valides → panneau « 2 brouillon(s) publié(s) »', async () => {
    await clearDrafts();
    await seedDraft('B4A', '1990-01-15');
    await seedDraft('B4B', '1991-02-16');
    await openBrouillons();
    await expect(viewPublishButton()).toBeEnabled({ timeout: 15000 });
    await viewPublishButton().click();
    await confirmPublish();
    const p = panel();
    await expect(p).toBeVisible({ timeout: 10000 });
    await expect(p.getByText('2 brouillon(s) publié(s)', { exact: true })).toBeVisible();
    await expect(p.getByText(DRAFT_DETAIL, { exact: true })).toBeVisible();
    expect(await statutOfDraft('B4A')).toBe('EN STOCK');
    expect(await statutOfDraft('B4B')).toBe('EN STOCK');
  });

  test('B5. « Mes Brouillons » (N3) : 1 valide + 1 date invalide → panneau ET avertissement séparé', async () => {
    await clearDrafts();
    await seedDraft('B5V', '1990-01-15');
    await seedDraft('B5I', null);
    await openBrouillons();
    await expect(viewPublishButton()).toBeEnabled({ timeout: 15000 });
    await viewPublishButton().click();
    await confirmPublish();
    const p = panel();
    await expect(p).toBeVisible({ timeout: 10000 });
    await expect(p.getByText('1 brouillon(s) publié(s)', { exact: true })).toBeVisible();
    await expect(ignoredWarning().first()).toBeVisible({ timeout: 5000 });
    await expect(p.getByText(/ignoré/)).toHaveCount(0);
    expect(await statutOfDraft('B5I')).toBe('BROUILLON');
  });

  test('B6. « Mes Brouillons » (N3) : uniquement une date invalide (promotedCount = 0) → aucun panneau', async () => {
    await clearDrafts();
    await seedDraft('B6I', null);
    await openBrouillons();
    await expect(viewPublishButton()).toBeEnabled({ timeout: 15000 });
    await viewPublishButton().click();
    await confirmPublish();
    await expect(ignoredWarning().first()).toBeVisible({ timeout: 10000 });
    await env.window.waitForTimeout(1500);
    await expect(panel()).toHaveCount(0);
    expect(await statutOfDraft('B6I')).toBe('BROUILLON');
  });

  // ══════════════════════════════════════════════════════════════════════════════════════
  // BLOC C — ADMINISTRATEUR_SITE : import CSV (SUCCES / PARTIEL / ECHEC)
  // ══════════════════════════════════════════════════════════════════════════════════════

  const CSV_HEADER = 'NOMS;PRENOMS;DATE DE NAISSANCE;LIEU DE NAISSANCE;CONTACT;N° SECU;RANGEMENT;STATUT;DATE DELIVRANCE;LIEU ENROLEMENT';
  const csvRow = (noms: string, ddn: string, i: number): string =>
    `${noms};STANDARD;${ddn};ABOBO;010203${4000 + i};${9876500000000 + i};;EN STOCK;;ABOBO`; // N° sécu : 13 chiffres exigés (import-worker.js, NUM_SECU_INVALIDE = ligne comptée rejetée)
  function writeCsv(name: string, rows: string[]): string {
    const path = join(csvDir, name);
    writeFileSync(path, [CSV_HEADER, ...rows].join('\n'), 'utf-8');
    return path;
  }

  // Attente défensive propre au portail admin (même constat que import-centre-migration-qa-terrain) :
  // l'overlay global « Chargement sécurisé en cours... » peut intercepter les clics après un login.
  async function waitForNoLoadingOverlay(): Promise<void> {
    await expect(env.window.getByText('Chargement sécurisé en cours...')).toHaveCount(0, { timeout: 60000 });
  }
  async function mockOpenDialogOnce(filePath: string): Promise<void> {
    await env.app.evaluate(({ dialog }, fp) => {
      (dialog as any).__originalShowOpenDialog = dialog.showOpenDialog;
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [fp] })) as any;
    }, filePath);
  }
  async function restoreOpenDialog(): Promise<void> {
    await env.app.evaluate(({ dialog }) => {
      if ((dialog as any).__originalShowOpenDialog) {
        dialog.showOpenDialog = (dialog as any).__originalShowOpenDialog;
        delete (dialog as any).__originalShowOpenDialog;
      }
    });
  }

  /** Sélectionne le fichier, lance l'import réel (Worker) et attend le Bilan de Migration. */
  async function runImport(csvPath: string, expectedLines: number): Promise<void> {
    const { window: page } = env;
    if (await page.getByText('Bilan de Migration').count()) {
      await page.getByRole('button', { name: 'Nouvelle Migration' }).click();
      await expect(page.getByText('Prêt pour la migration ?')).toBeVisible({ timeout: 10000 });
    }
    await mockOpenDialogOnce(csvPath);
    try {
      await page.getByRole('button', { name: /Sélectionner le Listing/i }).click();
      await expect(page.getByText(`${expectedLines} lignes détectées`).first()).toBeVisible({ timeout: 10000 });
    } finally {
      await restoreOpenDialog();
    }
    await page.getByRole('button', { name: "Lancer l'Importation" }).click();
    const proceed = page.getByRole('button', { name: "Poursuivre l'import" }); // modale « Configuration des Centres »
    await expect(proceed).toBeVisible({ timeout: 10000 });
    await proceed.click();
    await expect(page.getByText('Bilan de Migration')).toBeVisible({ timeout: 60000 });
  }

  test('C0. Connexion ADMINISTRATEUR_SITE puis accès au Centre de Migration', async () => {
    const { window: page } = env;
    await logout();
    await loginAs('administrateurSite', /#\/dashboard/);
    await waitForNoLoadingOverlay();
    await page.evaluate(() => { globalThis.location.hash = '#/import'; });
    await page.waitForURL(/#\/import/);
    await waitForNoLoadingOverlay();
    await expect(page.getByText('Sélectionner le Listing')).toBeVisible({ timeout: 10000 });
  });

  test('C1. Import SUCCES (aucun rejet) : panneau « Import terminé » avec le bilan', async () => {
    const csv = writeCsv('zztest_pnl_succes.csv', [
      csvRow('ZZTEST_PNLIMPOK1', '1990-01-01', 1),
      csvRow('ZZTEST_PNLIMPOK2', '1991-02-02', 2),
      csvRow('ZZTEST_PNLIMPOK3', '1992-03-03', 3)
    ]);
    await runImport(csv, 3);
    const p = panel();
    await expect(p).toBeVisible({ timeout: 10000 });
    await expect(p.getByText('Import terminé', { exact: true })).toBeVisible();
    await expect(p.getByText(/Import terminé : \d+ ligne\(s\) traitée\(s\) sans rejet\./)).toBeVisible();
    await expect(env.window.getByText('Migration terminée !')).toHaveCount(0); // l'ancien toast de succès est remplacé
    const inserted = await dbQuery("SELECT COUNT(*) AS c FROM t_cartes WHERE noms LIKE 'ZZTEST\\_PNLIMPOK%' ESCAPE '\\'");
    expect(inserted[0].c, 'le panneau n\'apparaît qu\'une fois les données réellement importées').toBe(3);
  });

  test('C2. Import PARTIEL (1 ligne rejetée) : toast d\'avertissement conservé, aucun panneau', async () => {
    await expect(panel()).toHaveCount(0, { timeout: 8000 });
    const csv = writeCsv('zztest_pnl_partiel.csv', [
      csvRow('ZZTEST_PNLIMPPA1', '1990-01-01', 11),
      csvRow('ZZTEST_PNLIMPPA2', '1991-02-02', 12),
      csvRow('ZZTEST_PNLIMPPABAD', '99/99/9999', 13)
    ]);
    await runImport(csv, 3);
    await expect(env.window.getByText(/Import partiel : 1 ligne\(s\) rejetée\(s\) sur/).first()).toBeVisible({ timeout: 10000 });
    await expect(panel()).toHaveCount(0);
    await env.window.waitForTimeout(1500);
    await expect(panel()).toHaveCount(0);
  });

  test('C3. Import en ECHEC (toutes les lignes rejetées) : toast d\'erreur conservé, aucun panneau', async () => {
    const csv = writeCsv('zztest_pnl_echec.csv', [
      csvRow('ZZTEST_PNLIMPKO1', '99/99/9999', 21),
      csvRow('ZZTEST_PNLIMPKO2', '99/99/9999', 22)
    ]);
    await runImport(csv, 2);
    await expect(env.window.getByText(/Toutes les lignes ont été rejetées/).first()).toBeVisible({ timeout: 10000 });
    await expect(panel()).toHaveCount(0);
    await env.window.waitForTimeout(1500);
    await expect(panel()).toHaveCount(0);
  });
});
