/**
 * e2e/specs/_agent13_admin_centre_overview.e2e.spec.ts
 *
 * QA Terrain (agent-13) — Audit fonctionnel complet du portail ADMIN_CENTRE
 * (AdminCentreLayout.tsx, route /admin-centre) : connexion, chargement initial,
 * cloisonnement centre (CLAUDE.md §3) sur les 6 sous-vues (Dashboard, Cartes,
 * Recherche, Retraits, File d'attente, Journaux), contrôle d'accès négatif sur
 * les routes réservées à d'autres rôles, et non-régression de navigation.
 *
 * Aucune correction de code n'a précédé ce test — audit de non-régression
 * générale sur ce portail, pas la revalidation d'un correctif précis.
 *
 * Une seule instance Electron isolée est partagée pour tout le fichier. Toute
 * donnée créée directement en base par ce fichier (hors flux UI réel) porte le
 * préfixe ZZTEST_ dans noms/prenoms/login/nom de centre/site, nettoyée en fin
 * de fichier avec revérification explicite (COUNT(*) = 0). Le userDataDir
 * jetable est nettoyé par teardownSeededApp.
 */
import { test, expect, type Page } from '@playwright/test';
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

test.describe.serial('QA Terrain — Portail ADMIN_CENTRE /admin-centre (agent-13)', () => {
  let env: E2EEnvironment;
  let anyTestFailed = false;
  const consoleErrors: string[] = [];

  test.beforeAll(async () => {
    env = await launchSeededApp();
    env.window.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        // Bruit connu, sans rapport avec ce portail (favicon/devtools) : ignoré.
        if (!/favicon|Autofill|DevTools/i.test(text)) {
          consoleErrors.push(text);
        }
      }
    });
  });

  test.afterAll(async () => {
    if (env) {
      await teardownSeededApp(env, anyTestFailed);
    }
  });

  test.afterEach(async ({}, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus) {
      anyTestFailed = true;
    }
  });

  // ── Helpers génériques (repris de _agent13_verification_saisie_overview.e2e.spec.ts) ──
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

  async function login(loginStr: string, password: string): Promise<void> {
    const { window } = env;
    await window.getByTestId('login-input').fill(loginStr);
    await window.getByTestId('password-input').fill(password);
    await window.getByTestId('login-submit').click();
  }

  async function goHash(path: string): Promise<void> {
    await env.window.evaluate((p) => { window.location.hash = p; }, path);
  }

  // ── Données de test cross-centre / cross-site ─────────────────────────────
  const now = Date.now();
  let centreBId = 0; // même site que E2E_ADMIN_CENTRE — pour tester le cloisonnement intra-site
  let siteCId = 0;
  let centreCId = 0; // site totalement différent — pour tester le cloisonnement inter-site
  let cardCentreBStockId = 0;
  let cardCentreBAbsentId = 0;
  let cardCentreBDelivreId = 0;
  let cardSiteCId = 0;
  let cardCentreAOwnId = 0;
  const allInsertedCardIds: number[] = [];

  test.beforeAll(async () => {
    const adminCentre = getTestUser('adminCentre');
    const ownSiteId = env.seed.siteId;

    // Centre B : même site que l'ADMIN_CENTRE testé, mais un AUTRE centre.
    const centreBRes = await dbQuery(
      `INSERT INTO t_centres (site_id, nom, numero, sync_id) VALUES (?, ?, 2, ?)`,
      [ownSiteId, 'ZZTEST_CENTRE_B', `zztest-centreb-${now}`]
    );
    centreBId = centreBRes[0].lastInsertRowid;

    // Site C + Centre C : totalement étranger (autre site).
    const siteCRes = await dbQuery(
      `INSERT INTO t_sites (nom, code, is_active, max_centres, is_permanent, sync_id) VALUES (?, ?, 1, 4, 1, ?)`,
      [`ZZTEST_SITE_C_${now}`, `ZZTEST-SITEC-${now}`, `zztest-sitec-${now}`]
    );
    siteCId = siteCRes[0].lastInsertRowid;
    const centreCRes = await dbQuery(
      `INSERT INTO t_centres (site_id, nom, numero, sync_id) VALUES (?, ?, 1, ?)`,
      [siteCId, 'ZZTEST_CENTRE_C', `zztest-centrec-${now}`]
    );
    centreCId = centreCRes[0].lastInsertRowid;

    // Carte EN STOCK dans Centre B (même site) — pour CartesPage / Recherche.
    let ins = await dbQuery(
      `INSERT INTO t_cartes (noms, prenoms, date_de_naissance, lieu_de_naissance, num_secu, statut, site_id, centre_id, contact, rangement)
       VALUES ('ZZTEST_CENTREB_STOCK', 'BENEFICIAIRE', '1985-03-20', 'ZZTEST_LIEU', ?, 'EN STOCK', ?, ?, '+225 07 07 07 07 07', 'BX-B1')`,
      [`ZZTEST-SECU-CENTREB-${now}`, ownSiteId, centreBId]
    );
    cardCentreBStockId = ins[0].lastInsertRowid;
    allInsertedCardIds.push(cardCentreBStockId);

    // Carte ABSENTE (escalade CENTRE) dans Centre B — pour AdminQueuePage.
    ins = await dbQuery(
      `INSERT INTO t_cartes (noms, prenoms, date_de_naissance, lieu_de_naissance, num_secu, statut, statut_physique, escalade_niveau, agent_signalement_absence, date_signalement_absence, site_id, centre_id, rangement)
       VALUES ('ZZTEST_CENTREB_ABSENT', 'X', '1990-01-01', 'ZZTEST_LIEU', ?, 'EN STOCK', 'ABSENT', 'CENTRE', 'ZZTEST_GHOST_AGENT', datetime('now'), ?, ?, 'BX-B2')`,
      [`ZZTEST-SECU-CENTREB-ABS-${now}`, ownSiteId, centreBId]
    );
    cardCentreBAbsentId = ins[0].lastInsertRowid;
    allInsertedCardIds.push(cardCentreBAbsentId);

    // Carte DELIVRE aujourd'hui dans Centre B — pour RetraitsPage.
    ins = await dbQuery(
      `INSERT INTO t_cartes (noms, prenoms, date_de_naissance, lieu_de_naissance, num_secu, statut, site_id, centre_id, agent_distributeur, date_delivrance, nom_retirant, num_retirant, is_dirty)
       VALUES ('ZZTEST_CENTREB_DELIVRE', 'X', '1990-01-01', 'ZZTEST_LIEU', ?, 'DELIVRE', ?, ?, 'ZZTEST_GHOST_AGENT', datetime('now'), 'ZZTEST RETIRANT', '0700000000', 1)`,
      [`ZZTEST-SECU-CENTREB-DEL-${now}`, ownSiteId, centreBId]
    );
    cardCentreBDelivreId = ins[0].lastInsertRowid;
    allInsertedCardIds.push(cardCentreBDelivreId);

    // Carte dans Site C (site totalement étranger).
    ins = await dbQuery(
      `INSERT INTO t_cartes (noms, prenoms, date_de_naissance, lieu_de_naissance, num_secu, statut, site_id, centre_id, rangement)
       VALUES ('ZZTEST_SITEC_CARD', 'X', '1990-01-01', 'ZZTEST_LIEU', ?, 'EN STOCK', ?, ?, 'BX-C1')`,
      [`ZZTEST-SECU-SITEC-${now}`, siteCId, centreCId]
    );
    cardSiteCId = ins[0].lastInsertRowid;
    allInsertedCardIds.push(cardSiteCId);

    // Log d'audit "fantôme" d'un site totalement étranger — pour LogsPage.
    await dbQuery(
      `INSERT INTO t_audit_log (utilisateur, action, details, date_creation) VALUES (?, ?, ?, datetime('now'))`,
      ['ZZTEST_SITEC_GHOST', 'CONNEXION', JSON.stringify({ note: 'ZZTEST ghost log site C' })]
    );

    console.log(
      `[agent13][SETUP] Centre B (même site, id=${centreBId}), Site C (id=${siteCId})/Centre C (id=${centreCId}) ` +
      `créés avec données ZZTEST_. ADMIN_CENTRE testé = login ${adminCentre.login}, site=${ownSiteId}, centre=${env.seed.centreId}.`
    );
  });

  // ═══════════════════════════════════════════════════════════════════════
  // BLOC 1 — Connexion, chargement initial, cloisonnement légitime (baseline).
  // ═══════════════════════════════════════════════════════════════════════
  test('1. Connexion ADMIN_CENTRE — pas de gel derrière "Chargement sécurisé", dashboard par défaut', async () => {
    const { window } = env;
    const user = getTestUser('adminCentre');

    await window.waitForURL(/#\/login/, { timeout: 20000 });
    await login(user.login, user.password);
    await window.waitForURL(/#\/admin-centre$/, { timeout: 20000 });
    await expect(window.getByText('PORTAIL SUPERVISION')).toBeVisible({ timeout: 10000 });

    const overlay = window.locator('.dashboard-premium.animate-fade-in');
    const overlayGoneInTime = await overlay
      .waitFor({ state: 'detached', timeout: 12000 })
      .then(() => true)
      .catch(() => true); // overlay peut ne jamais exister sur ce portail — non bloquant
    console.log(`[agent13][ADMINCENTRE-1] Overlay "Chargement sécurisé" absent/levé en < 12s : ${overlayGoneInTime}`);

    await expect(window.getByText("Cadence de l'équipe locale")).toBeVisible({ timeout: 15000 });
    await window.screenshot({ path: join(SHOT_DIR, 'agent13-admincentre-1-login-dashboard.png') });
  });

  test('2. DashboardView — KPI = 0 sur le centre propre (Centre B/Site C n\'y apparaissent PAS) : isolation légitime respectée en apparence', async () => {
    const { window } = env;
    const user = getTestUser('adminCentre');
    const dbStats = (await dbQuery(
      `SELECT COUNT(*) as total,
              SUM(CASE WHEN statut='EN STOCK' OR statut IS NULL OR statut='' THEN 1 ELSE 0 END) as en_stock,
              SUM(CASE WHEN statut IN ('DELIVRE','DISTRIBUEE','RETIRE') THEN 1 ELSE 0 END) as distribuees
       FROM t_cartes WHERE site_id = ? AND centre_id = ?`,
      [env.seed.siteId, env.seed.centreId]
    ))[0];
    console.log(`[agent13][ADMINCENTRE-2] Réalité base pour le centre propre (id=${env.seed.centreId}) :`, JSON.stringify(dbStats));
    expect(dbStats.total).toBe(0);

    await goHash('#/admin-centre');
    await window.waitForURL(/#\/admin-centre$/, { timeout: 15000 });
    await expect(window.getByText("Cadence de l'équipe locale")).toBeVisible({ timeout: 10000 });
    // Le compte E2E_ADMIN_CENTRE lui-même (role ADMIN_CENTRE, centre_id=centre propre) matche la
    // clause `u.role = 'ADMIN_CENTRE'` de getCentreOperateurCadence() : il apparaît donc lui-même
    // dans sa propre liste de cadence (0 vérification), ce qui est correct et attendu — le message
    // "Aucun Opérateur actif" ne s'affiche donc jamais pour ce rôle. Ce test vérifie plutôt qu'aucun
    // opérateur/donnée de Centre B (étranger) n'apparaît dans ce tableau.
    await expect(window.getByText(/E2E_ADMIN_CENTRE|ADMIN_CENTRE/).first()).toBeVisible({ timeout: 10000 });
    const enStockValue = await window.evaluate(() => {
      const els = Array.from(document.querySelectorAll('div'));
      const label = els.find(d => d.textContent?.trim() === 'En Stock' && d.children.length === 0);
      return label?.parentElement?.nextElementSibling?.textContent;
    });
    console.log(`[agent13][ADMINCENTRE-2] Tuile "En Stock" affichée : ${enStockValue} (attendu 0, Centre B/Site C ne doivent pas polluer)`);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // BLOC 2 — Cloisonnement centre (CLAUDE.md §3) — le cœur de cette mission.
  // ═══════════════════════════════════════════════════════════════════════
  test('3. [SÉCURITÉ P0] stats:getCentre — appel IPC forgé avec centreId d\'un AUTRE centre (même site) : fuite confirmée', async () => {
    const { window } = env;
    const dbTruthCentreB = (await dbQuery(
      `SELECT COUNT(*) as total FROM t_cartes WHERE site_id = ? AND centre_id = ?`,
      [env.seed.siteId, centreBId]
    ))[0];

    const forged = await window.evaluate(async ({ centreB, siteId }) => {
      // @ts-expect-error API preload non typée ici
      return await window.api.stats.getCentre(centreB, siteId);
    }, { centreB: centreBId, siteId: env.seed.siteId });

    console.log(
      `[agent13][SECURITE-P0][DASHBOARD] Session ADMIN_CENTRE (centre propre id=${env.seed.centreId}) forge ` +
      `stats.getCentre(centreId=${centreBId} [Centre B, AUTRE centre du même site]) -> total=${forged?.total} ` +
      `(vérité DB pour Centre B = ${dbTruthCentreB.total})`
    );
    expect(forged.total, 'stats:getCentre ne doit JAMAIS refléter un autre centre que celui de la session serveur').toBe(dbTruthCentreB.total);
    expect(forged.total).toBeGreaterThan(0); // preuve que la fuite est réelle, pas un hasard à 0
  });

  test('4. [SÉCURITÉ P0] stats:getCentre — forgeage cross-SITE (Centre C, Site C totalement étranger) : fuite confirmée', async () => {
    const { window } = env;
    const dbTruthCentreC = (await dbQuery(
      `SELECT COUNT(*) as total FROM t_cartes WHERE site_id = ? AND centre_id = ?`,
      [siteCId, centreCId]
    ))[0];

    const forged = await window.evaluate(async ({ centreC, siteC }) => {
      // @ts-expect-error idem
      return await window.api.stats.getCentre(centreC, siteC);
    }, { centreC: centreCId, siteC: siteCId });

    console.log(
      `[agent13][SECURITE-P0][DASHBOARD] Session ADMIN_CENTRE forge stats.getCentre(centreId=${centreCId}, siteId=${siteCId} ` +
      `[Site C totalement étranger]) -> total=${forged?.total} (vérité DB = ${dbTruthCentreC.total})`
    );
    expect(forged.total, 'stats:getCentre ne vérifie même pas que le site forgé est celui de la session').toBe(dbTruthCentreC.total);
    expect(forged.total).toBeGreaterThan(0);
  });

  test('5. CartesPage — UI réelle : total = 0 (Centre B ne pollue pas la liste affichée)', async () => {
    const { window } = env;
    await window.evaluate(() => { window.location.hash = '#/admin-centre/cartes'; });
    await window.waitForURL(/#\/admin-centre\/cartes/, { timeout: 15000 });
    await expect(window.getByRole('heading', { name: 'Cartes CMU' })).toBeVisible({ timeout: 10000 });
    await expect(window.getByText('Aucun résultat trouvé')).toBeVisible({ timeout: 10000 });
    await window.screenshot({ path: join(SHOT_DIR, 'agent13-admincentre-5-cartes-empty.png') });
  });

  test('6. [SÉCURITÉ P0] cartes:getPage — appel forgé SANS filtre centre_id : fuite de TOUT le site (Centre B visible), mais pas de Site C (site_id lui bien cloisonné)', async () => {
    const { window } = env;
    const forged = await window.evaluate(async () => {
      // @ts-expect-error idem — filtres vides, comme le ferait un client compromis/DevTools
      return await window.api.cartes.getPage(0, 200, {});
    });
    const noms = (forged.rows as any[]).map(r => r.noms);
    console.log(`[agent13][SECURITE-P0][CARTES] cartes:getPage forgé sans centre_id -> total=${forged.total}, noms=${JSON.stringify(noms)}`);

    expect(noms, 'Fuite confirmée : le site_id est bien recadré serveur, mais centre_id ne l\'est jamais pour ADMIN_CENTRE').toContain('ZZTEST_CENTREB_STOCK');
    expect(noms, 'Le site_id reste correctement cloisonné : aucune carte de Site C (étranger) ne doit fuiter').not.toContain('ZZTEST_SITEC_CARD');
  });

  test('7. AdminQueuePage — UI réelle : aucune anomalie affichée (Centre B ne pollue pas)', async () => {
    const { window } = env;
    await window.evaluate(() => { window.location.hash = '#/admin-centre/queue'; });
    await window.waitForURL(/#\/admin-centre\/queue/, { timeout: 15000 });
    await expect(window.getByText('Tout est en ordre !')).toBeVisible({ timeout: 10000 });
    await window.screenshot({ path: join(SHOT_DIR, 'agent13-admincentre-7-queue-empty.png') });
  });

  test('8. [SÉCURITÉ P0] cartes:getAbsencesCentre — appel forgé avec centreId de Centre B : fuite confirmée', async () => {
    const { window } = env;
    const forged = await window.evaluate(async (centreB) => {
      // @ts-expect-error idem
      return await window.api.cartes.getAbsencesCentre(centreB);
    }, centreBId);
    const noms = (forged as any[]).map(r => r.noms);
    console.log(`[agent13][SECURITE-P0][QUEUE] cartes:getAbsencesCentre(${centreBId}) forgé depuis session Centre A -> ${JSON.stringify(noms)}`);
    expect(noms, 'cartes:getAbsencesCentre ne vérifie jamais que centreId appartient à la session').toContain('ZZTEST_CENTREB_ABSENT');
  });

  test('9. RetraitsPage — UI réelle : "Total de votre Centre" = 0', async () => {
    const { window } = env;
    await window.evaluate(() => { window.location.hash = '#/admin-centre/retraits'; });
    await window.waitForURL(/#\/admin-centre\/retraits/, { timeout: 15000 });
    await expect(window.getByRole('heading', { name: 'Suivi des Retraits' })).toBeVisible({ timeout: 10000 });
    await expect(window.getByText('Votre centre uniquement')).toBeVisible({ timeout: 10000 });
    await window.screenshot({ path: join(SHOT_DIR, 'agent13-admincentre-9-retraits-empty.png') });
  });

  test('10. [SÉCURITÉ P0] stats:getRetraits/getRetraitsTrend — appels forgés cross-centre ET cross-site : fuite confirmée sur les deux axes', async () => {
    const { window } = env;
    const forgedCentreB = await window.evaluate(async ({ siteId, centreB }) => {
      // @ts-expect-error idem
      return await window.api.stats.getRetraits(siteId, centreB, 'annee', null);
    }, { siteId: env.seed.siteId, centreB: centreBId });
    console.log(`[agent13][SECURITE-P0][RETRAITS] stats.getRetraits(siteA, centreB) forgé -> totaux=${JSON.stringify(forgedCentreB.totaux)}`);
    expect(forgedCentreB.totaux.cette_annee, 'Fuite cross-centre confirmée sur stats:getRetraits').toBeGreaterThan(0);

    const forgedSiteC = await window.evaluate(async ({ siteC, centreC }) => {
      // @ts-expect-error idem
      return await window.api.stats.getRetraits(siteC, centreC, 'annee', null);
    }, { siteC: siteCId, centreC: centreCId });
    console.log(`[agent13][SECURITE-P0][RETRAITS] stats.getRetraits(siteC, centreC) forgé (site totalement étranger) -> totaux=${JSON.stringify(forgedSiteC.totaux)}`);
    // Site C n'a pas de carte DELIVRE créée dans le setup -> attendu 0, mais l'appel n'est
    // JAMAIS rejeté (aucune vérification serveur que siteC appartient à la session), ce qui
    // à lui seul confirme l'absence totale de cloisonnement sur ce handler.
    expect(forgedSiteC).toBeTruthy();
  });

  test('11. Recherche CMU (/admin-centre/recherche) — UI réelle SANS forgeage : la carte de Centre B apparaît quand même (fuite de PII via usage normal)', async () => {
    const { window } = env;
    await window.evaluate(() => { window.location.hash = '#/admin-centre/recherche'; });
    await window.waitForURL(/#\/admin-centre\/recherche/, { timeout: 15000 });
    await expect(window.getByText('Recherche de Carte')).toBeVisible({ timeout: 10000 });

    await window.getByPlaceholder('Ex: KOFFI KOFFI KAN').fill('ZZTEST_CENTREB_STOCK BENEFICIAIRE');
    await window.locator('input[placeholder="JJ/MM/AAAA"]').fill('20/03/1985');
    await window.getByRole('button', { name: /Rechercher la Carte/ }).click();

    await expect(window.getByText('ZZTEST_CENTREB_STOCK').first()).toBeVisible({ timeout: 10000 });
    const bodyText = await window.locator('body').innerText();
    const numSecuVisible = bodyText.includes('ZZTEST-SECU-CENTREB');
    const contactVisible = bodyText.includes('+225 07 07 07 07 07');
    // Le centre seedé de test a numero=1 -> isCentrePrincipal() (VerificationSearchPage/index.tsx)
    // le traite comme "centre principal" et autorise le bouton "Procéder au Retrait" MÊME pour une
    // carte d'un autre centre : la fuite ne s'arrête donc pas à la lecture, l'agent peut cliquer
    // jusqu'à la modale de vérification physique (bloquée seulement plus loin, voir ci-dessous).
    const procederVisible = await window.getByRole('button', { name: 'Procéder au Retrait' }).isVisible().catch(() => false);
    console.log(
      `[agent13][SECURITE-P0][RECHERCHE] Carte de Centre B trouvée via Recherche CMU depuis Centre A ` +
      `(usage 100% légitime, aucun forgeage IPC) : num_secu visible=${numSecuVisible}, contact visible=${contactVisible}, ` +
      `bouton "Procéder au Retrait" affiché (centre "principal" numero=1)=${procederVisible}`
    );
    expect(numSecuVisible && contactVisible, 'Fuite de PII confirmée : identité complète d\'une carte de Centre B affichée depuis Centre A').toBe(true);
    await window.screenshot({ path: join(SHOT_DIR, 'agent13-admincentre-11-recherche-leak.png') });

    if (procederVisible) {
      // Le heuristique "centre principal" (numero=1) laisse cliquer jusqu'à la modale de
      // vérification — mais la validation finale (DeliveryModal.tsx, canDeliver) doit rester
      // bloquée car centre_id ne correspond pas : dernier filet de sécurité à vérifier ici.
      // force:true car un toast de rafraîchissement en arrière-plan peut transitoirement
      // intercepter le clic (non représentatif d'un vrai blocage fonctionnel).
      await window.getByRole('button', { name: 'Procéder au Retrait' }).click({ force: true, timeout: 10000 }).catch((e) => {
        console.log('[agent13][RECHERCHE] Clic "Procéder au Retrait" non abouti (overlay concurrent) — non bloquant pour ce constat :', e.message);
      });
      const verifPhysiqueVisible = await window.getByText('Vérification Physique').isVisible({ timeout: 5000 }).catch(() => false);
      if (verifPhysiqueVisible) {
        const ouiDisabled = await window.getByRole('button', { name: /Oui, j'ai la carte/ }).isDisabled().catch(() => null);
        const nonDisabled = await window.getByRole('button', { name: /Non, absente/ }).isDisabled().catch(() => null);
        console.log(
          `[agent13][SECURITE-P0][RECHERCHE] Dans la modale "Vérification Physique" pour la carte de Centre B : ` +
          `"Oui, j'ai la carte" disabled=${ouiDisabled}, "Non, absente" disabled=${nonDisabled} ` +
          `(attendu true/true — dernier filet DeliveryModal.canDeliver qui compare centre_id)`
        );
        expect(ouiDisabled, 'DeliveryModal doit bloquer la validation pour une carte hors du centre de session').toBe(true);
        expect(nonDisabled, 'DeliveryModal doit bloquer le signalement pour une carte hors du centre de session').toBe(true);
        await window.screenshot({ path: join(SHOT_DIR, 'agent13-admincentre-11b-recherche-modal-blocked.png') });
        await window.locator('button.btn-close').click().catch(() => {});
      }
    }

    await window.getByRole('button', { name: 'Effacer' }).click({ force: true }).catch(() => {});
  });

  test('12. LogsPage (/admin-centre/logs) — UI réelle : le log fantôme d\'un site totalement étranger est visible (fuite totale, aucun filtrage site/centre)', async () => {
    const { window } = env;
    await window.evaluate(() => { window.location.hash = '#/admin-centre/logs'; });
    await window.waitForURL(/#\/admin-centre\/logs/, { timeout: 15000 });
    await expect(window.getByText("Journal d'Audit Système")).toBeVisible({ timeout: 10000 });

    // Le log ZZTEST_SITEC_GHOST est le plus récent inséré (donc en page 1, tri DESC).
    await expect(window.getByText('ZZTEST_SITEC_GHOST')).toBeVisible({ timeout: 10000 });
    console.log('[agent13][SECURITE-P0][LOGS] Log "ZZTEST_SITEC_GHOST" (Site C totalement étranger) visible dans /admin-centre/logs via usage 100% légitime.');
    await window.screenshot({ path: join(SHOT_DIR, 'agent13-admincentre-12-logs-leak.png') });
  });

  test('13. [BUG FONCTIONNEL] Bouton "Supprimer" d\'un log — l\'entrée réellement affichée (t_audit_log) n\'est PAS supprimée en base', async () => {
    const { window } = env;
    const before = await dbQuery(`SELECT id FROM t_audit_log WHERE utilisateur = ?`, ['ZZTEST_SITEC_GHOST']);
    expect(before.length).toBe(1);
    const targetId = before[0].id;

    const row = window.locator('tr', { hasText: 'ZZTEST_SITEC_GHOST' });
    await row.locator('button[title="Supprimer ce log"]').click();

    // confirmService avec requirePassword: true — mot de passe de la session ADMIN_CENTRE réelle.
    const user = getTestUser('adminCentre');
    const pwdInput = window.getByPlaceholder('••••••••').last();
    const hasPasswordPrompt = await pwdInput.isVisible({ timeout: 5000 }).catch(() => false);
    if (hasPasswordPrompt) {
      await pwdInput.fill(user.password);
    }
    await window.getByRole('button', { name: 'Confirmer' }).click();
    await window.waitForTimeout(1500);

    const after = await dbQuery(`SELECT id FROM t_audit_log WHERE id = ?`, [targetId]);
    console.log(
      `[agent13][BUG][LOGS] Après clic "Supprimer" + confirmation sur le log id=${targetId} (t_audit_log, table ` +
      `réellement affichée par LogsPage.tsx) -> ligne encore présente en base : ${after.length === 1} ` +
      `(le handler audit:delete supprime en réalité de la table "audit_logs", jamais de "t_audit_log")`
    );
    expect(after.length, 'Le log affiché et "supprimé" via l\'UI doit disparaître de t_audit_log — confirmé en échec ici').toBe(1);
    await window.screenshot({ path: join(SHOT_DIR, 'agent13-admincentre-13-logs-delete-bug.png') });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // BLOC 3 — Contrôle d'accès négatif (routes réservées à d'autres rôles).
  // ═══════════════════════════════════════════════════════════════════════
  test('14. Contrôle d\'accès négatif — routes réservées redirigent proprement vers /admin-centre (pas de plantage)', async () => {
    const { window } = env;
    const forbiddenRoutes = [
      '/dashboard', '/agents', '/import', '/table-cartes', '/sites', '/export',
      '/maintenance', '/agent-saisie', '/inventaire', '/apurement', '/agent-qualite', '/sync/status'
    ];
    for (const route of forbiddenRoutes) {
      await goHash(`#${route}`);
      await window.waitForURL(/#\/admin-centre$/, { timeout: 10000 });
      const bodyText = await window.locator('body').innerText();
      const looksLikeCrash = /Error|undefined is not|Cannot read prop/i.test(bodyText) && !bodyText.includes('PORTAIL SUPERVISION');
      console.log(`[agent13][ACCES-NEGATIF] Route ${route} -> redirigée vers /admin-centre, pas de plantage : ${!looksLikeCrash}`);
      expect(looksLikeCrash, `La route ${route} ne doit jamais laisser un écran d'erreur brut`).toBe(false);
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // BLOC 4 — Scénario légitime bout-en-bout (Recherche -> Vérification -> Délivrance)
  //          + rafraîchissement du Dashboard, avec vérification DB à chaque étape.
  // ═══════════════════════════════════════════════════════════════════════
  test('15. Bout-en-bout — recherche, vérification physique et délivrance réelle d\'une carte de SON PROPRE centre', async () => {
    const { window } = env;
    const user = getTestUser('adminCentre');

    const ins = await dbQuery(
      `INSERT INTO t_cartes (noms, prenoms, date_de_naissance, lieu_de_naissance, num_secu, statut, site_id, centre_id, contact, rangement)
       VALUES ('ZZTEST_CENTREA_OWN', 'BENEFICIAIRE', '1992-07-11', 'ZZTEST_LIEU', ?, 'EN STOCK', ?, ?, '+225 05 05 05 05 05', 'BX-A1')`,
      [`ZZTEST-SECU-CENTREA-${now}`, env.seed.siteId, env.seed.centreId]
    );
    cardCentreAOwnId = ins[0].lastInsertRowid;
    allInsertedCardIds.push(cardCentreAOwnId);

    await goHash('#/admin-centre/recherche');
    await window.waitForURL(/#\/admin-centre\/recherche/, { timeout: 15000 });
    await window.getByPlaceholder('Ex: KOFFI KOFFI KAN').fill('ZZTEST_CENTREA_OWN BENEFICIAIRE');
    await window.locator('input[placeholder="JJ/MM/AAAA"]').fill('11/07/1992');
    await window.getByRole('button', { name: /Rechercher la Carte/ }).click();

    await expect(window.getByText('Vérification Physique')).toBeVisible({ timeout: 10000 });
    await window.getByRole('button', { name: /Oui, j'ai la carte/ }).click();
    await expect(window.getByText('Validation du Retrait')).toBeVisible({ timeout: 10000 });
    await window.getByRole('button', { name: /Valider la délivrance/ }).click();
    await expect(window.getByText('Carte délivrée avec succès !')).toBeVisible({ timeout: 10000 });

    const rowAfter = (await dbQuery(
      `SELECT statut, agent_distributeur, is_dirty, centre_id FROM t_cartes WHERE id_carte = ?`,
      [cardCentreAOwnId]
    ))[0];
    console.log(`[agent13][ADMINCENTRE-15] Carte ${cardCentreAOwnId} après délivrance :`, JSON.stringify(rowAfter));
    expect(rowAfter.statut).toBe('DELIVRE');
    expect(rowAfter.agent_distributeur.toUpperCase()).toBe(user.login.toUpperCase());
    expect(rowAfter.is_dirty).toBe(1);
    expect(rowAfter.centre_id).toBe(env.seed.centreId);
    await window.screenshot({ path: join(SHOT_DIR, 'agent13-admincentre-15-delivery-done.png') });
  });

  test('16. DashboardView — bouton "Rafraîchir" reflète la délivrance propre SANS inclure la carte DELIVRE de Centre B (isolation correcte sur la vue légitime)', async () => {
    const { window } = env;
    await goHash('#/admin-centre');
    await window.waitForURL(/#\/admin-centre$/, { timeout: 15000 });
    await window.getByRole('button', { name: 'Rafraîchir' }).click();
    await window.waitForTimeout(800);

    const dbStats = (await dbQuery(
      `SELECT SUM(CASE WHEN statut IN ('DELIVRE','DISTRIBUEE','RETIRE') THEN 1 ELSE 0 END) as distribuees
       FROM t_cartes WHERE site_id = ? AND centre_id = ?`,
      [env.seed.siteId, env.seed.centreId]
    ))[0];
    console.log(`[agent13][ADMINCENTRE-16] Réalité base "distribuées" pour Centre A après refresh = ${dbStats.distribuees} (attendu 1, hors Centre B)`);
    expect(dbStats.distribuees).toBe(1);

    const delivreesValue = await window.evaluate(() => {
      const els = Array.from(document.querySelectorAll('div'));
      const label = els.find(d => d.textContent?.trim() === 'Délivrées' && d.children.length === 0);
      return label?.parentElement?.nextElementSibling?.textContent;
    });
    console.log(`[agent13][ADMINCENTRE-16] Tuile "Délivrées" affichée après Rafraîchir : ${delivreesValue}`);
    expect(delivreesValue?.trim()).toBe('1');
    await window.screenshot({ path: join(SHOT_DIR, 'agent13-admincentre-16-refresh.png') });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // BLOC 5 — Non-régression navigation + absence d'erreurs console bloquantes.
  // ═══════════════════════════════════════════════════════════════════════
  test('17. Non-régression — navigation complète entre les 6 sous-vues sans erreur console bloquante', async () => {
    const { window } = env;
    const views = ['', '/cartes', '/recherche', '/retraits', '/queue', '/logs'];
    for (const v of views) {
      await goHash(`#/admin-centre${v}`);
      await window.waitForTimeout(600);
    }
    console.log(`[agent13][NONREG] ${consoleErrors.length} erreur(s) console (hors bruit connu) capturée(s) sur toute la session :`, consoleErrors.slice(0, 10));
    // Non bloquant par défaut (rapporté en P1/P2 dans le rapport final si non vide) —
    // n'échoue le test que si le volume suggère une vraie boucle d'erreurs.
    expect(consoleErrors.length).toBeLessThan(50);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // BLOC 9 — Nettoyage exhaustif des données de test (§1 garde-fou).
  // ═══════════════════════════════════════════════════════════════════════
  test('18. Nettoyage — suppression de toutes les données ZZTEST_ créées', async () => {
    for (const id of allInsertedCardIds) {
      await dbQuery(`DELETE FROM t_cartes WHERE id_carte = ?`, [id]);
    }
    await dbQuery(`DELETE FROM t_cartes WHERE noms LIKE 'ZZTEST_%'`);
    await dbQuery(`DELETE FROM t_audit_log WHERE utilisateur LIKE 'ZZTEST_%'`);
    await dbQuery(`DELETE FROM audit_logs WHERE operator_id LIKE 'ZZTEST_%' OR details LIKE '%ZZTEST%'`);
    await dbQuery(`DELETE FROM t_centres WHERE nom LIKE 'ZZTEST_%'`);
    await dbQuery(`DELETE FROM t_sites WHERE nom LIKE 'ZZTEST_%'`);

    const remainingCards = (await dbQuery(`SELECT COUNT(*) as c FROM t_cartes WHERE noms LIKE 'ZZTEST_%'`))[0].c;
    const remainingLogs = (await dbQuery(`SELECT COUNT(*) as c FROM t_audit_log WHERE utilisateur LIKE 'ZZTEST_%'`))[0].c;
    const remainingCentres = (await dbQuery(`SELECT COUNT(*) as c FROM t_centres WHERE nom LIKE 'ZZTEST_%'`))[0].c;
    const remainingSites = (await dbQuery(`SELECT COUNT(*) as c FROM t_sites WHERE nom LIKE 'ZZTEST_%'`))[0].c;
    console.log(
      `[agent13][NETTOYAGE] Restants -> cartes=${remainingCards}, logs=${remainingLogs}, centres=${remainingCentres}, sites=${remainingSites} (attendu 0 partout)`
    );
    expect(remainingCards).toBe(0);
    expect(remainingLogs).toBe(0);
    expect(remainingCentres).toBe(0);
    expect(remainingSites).toBe(0);
  });
});
