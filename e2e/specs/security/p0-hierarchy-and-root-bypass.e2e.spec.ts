/**
 * e2e/specs/security/p0-hierarchy-and-root-bypass.e2e.spec.ts
 *
 * Reproduction en conditions réelles (vrai backend, vraie base SQLite seedée,
 * vraie session IPC) de deux vulnérabilités P0 confirmées par agent-13 sur
 * `src/main/ipc/handlers.ts` :
 *
 *  - P0-1 : les handlers `hierarchy:*` (getSites/createSite/updateSite/
 *    deleteSite/createCentre/updateCentre/deleteCentre) ne vérifient pas que
 *    le site ciblé appartient à l'appelant (ni, pour les mutations sur les
 *    sites, que l'appelant est SUPER ADMIN) — un ADMINISTRATEUR_SITE normal
 *    peut lire/modifier/supprimer l'infrastructure d'un site étranger.
 *  - P0-2 : `db:purge` / `db:emergency-purge` dérivent l'identité de
 *    l'appelant d'un paramètre `currentUser` fourni par le CLIENT (falsifiable)
 *    au lieu de la session serveur réelle (`getSecureCurrentUser()`). Un
 *    ADMINISTRATEUR_SITE normal, jamais authentifié via le vrai login ROOT,
 *    peut forger `{id_user: 999999, role: 'SUPER ADMIN'}` pour contourner le
 *    cloisonnement de site et purger un site étranger.
 *
 * Ce spec sert de preuve AVANT correctif (bugs reproduits, doit échouer/
 * réussir dans le sens vulnérable) puis de preuve APRÈS correctif (les mêmes
 * séquences doivent être rejetées). Il est conçu pour être exécuté deux fois
 * (avant/après l'application des correctifs dans handlers.ts), avec un
 * rebuild (`npx electron-vite build`) entre les deux — jamais lancé
 * automatiquement par un agent (CLAUDE.md §1) : ce fichier documente
 * uniquement la procédure via `npx playwright test <ce fichier>`.
 *
 * ── ROOT failsafe dans cet environnement e2e ────────────────────────────
 * `FAILSAFE_ROOT_PASSWORD` est défini dans `.env` (racine du dépôt), mais
 * `process.env` du process de TEST Playwright (Node système) ne le contient
 * pas automatiquement — seul un poste de maintenance réel le positionnerait
 * en variable d'environnement OS avant de lancer l'application packagée. On
 * le fixe donc explicitement ici, AVANT `launchSeededApp()`, pour que
 * `baseEnv = {...process.env}` (voir electron-app.ts) le propage au process
 * Electron lancé par le test — sans toucher au fichier `.env` ni à aucune
 * fixture partagée.
 */
import { test, expect } from '@playwright/test';
import { launchSeededApp, teardownSeededApp, type E2EEnvironment } from '../../fixtures/electron-app';
import { getTestUser } from '../../fixtures/test-users';

const ROOT_PASSWORD = 'Root@Abobo2026!'; // Valeur réelle de FAILSAFE_ROOT_PASSWORD dans .env (racine du dépôt).

test.describe.serial('SÉCURITÉ P0 — cloisonnement hierarchy:* et bypass FAILSAFE_ROOT_ID', () => {
  let env: E2EEnvironment;
  let anyTestFailed = false;

  // Identité du site/centre "étranger" créé par ROOT en amont, ciblé par les
  // tentatives d'attaque menées ensuite depuis la session ADMINISTRATEUR_SITE.
  let foreignSiteId: number;
  let foreignCentreId: number;
  let homeSiteId: number;

  test.beforeAll(async () => {
    process.env.FAILSAFE_ROOT_PASSWORD = ROOT_PASSWORD;
    env = await launchSeededApp();
    homeSiteId = env.seed.siteId;
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

  async function login(loginValue: string, password: string): Promise<void> {
    const { window } = env;
    await window.waitForURL(/#\/login/, { timeout: 15000 });
    await window.getByTestId('login-input').fill(loginValue);
    await window.getByTestId('password-input').fill(password);
    await window.getByTestId('login-submit').click();
  }

  async function logout(): Promise<void> {
    const { window } = env;
    await window.getByText('Déconnexion').click();
    await window.waitForURL(/#\/login/);
  }

  test('SETUP (ROOT réel) — crée un site + centre "étranger" pour servir de cible', async () => {
    const { window } = env;
    await login('root', ROOT_PASSWORD);
    // Le failsafe ROOT redirige comme un SUPER ADMIN normal.
    await window.waitForURL(/#\/dashboard/, { timeout: 15000 });

    const ts = Date.now();
    const createRes = await window.evaluate(async (ts) => {
      return (window as any).api.hierarchy.createSite({
        nom: `Site Etranger E2E ${ts}`,
        code: `ETR-E2E-${ts}`,
        max_centres: 4,
        admin: { nom: 'Admin Etranger', login: `e2e_admin_etr_${ts}`, password_hash: 'Xx_Etranger_2026!' }
      });
    }, ts);
    expect(createRes && createRes.lastInsertRowid).toBeTruthy();
    foreignSiteId = createRes.lastInsertRowid as number;

    const centreRes = await window.evaluate(async (siteId) => {
      return (window as any).api.hierarchy.createCentre({ site_id: siteId, nom: 'Centre Etranger', numero: 1 });
    }, foreignSiteId);
    expect(centreRes && centreRes.lastInsertRowid).toBeTruthy();
    foreignCentreId = centreRes.lastInsertRowid as number;

    await logout();
  });

  test('P0-1 — ADMINISTRATEUR_SITE : lecture/mutation d\'un site et d\'un centre étrangers via hierarchy:*', async () => {
    const { window } = env;
    const user = getTestUser('administrateurSite');
    await login(user.login, user.password);
    await window.waitForURL(/#\/dashboard/, { timeout: 15000 });

    // 1. getSites() ne doit exposer QUE le site de l'appelant.
    const sites = await window.evaluate(async () => (window as any).api.hierarchy.getSites());
    const leaksForeignSite = Array.isArray(sites) && sites.some((s: any) => s.id === foreignSiteId);
    console.log(`[P0-1][getSites] sites visibles=${Array.isArray(sites) ? sites.length : 'N/A'} fuite_site_etranger=${leaksForeignSite}`);
    expect.soft(leaksForeignSite, 'hierarchy:getSites ne doit jamais exposer un site étranger à un ADMINISTRATEUR_SITE').toBe(false);

    // 2. updateSite sur le site étranger doit être rejeté.
    const updateOutcome = await window.evaluate(async (siteId) => {
      try {
        await (window as any).api.hierarchy.updateSite(siteId, { nom: 'HACKED_BY_ADMIN_SITE' });
        return { rejected: false };
      } catch (e: any) {
        return { rejected: true, message: String(e?.message || e) };
      }
    }, foreignSiteId);
    console.log(`[P0-1][updateSite] site étranger : ${JSON.stringify(updateOutcome)}`);
    expect.soft(updateOutcome.rejected, 'hierarchy:updateSite doit rejeter la modification d\'un site étranger par un ADMINISTRATEUR_SITE').toBe(true);

    // 3. createCentre visant le site étranger : soit rejeté, soit recadré de force sur le
    //    site de l'appelant (jamais créé sous le site étranger — cf. pattern getCentres).
    const createCentreOutcome = await window.evaluate(async (siteId) => {
      try {
        const res = await (window as any).api.hierarchy.createCentre({ site_id: siteId, nom: 'Intrus', numero: 3 });
        return { rejected: false, res };
      } catch (e: any) {
        return { rejected: true, message: String(e?.message || e) };
      }
    }, foreignSiteId);
    console.log(`[P0-1][createCentre] cible site étranger : ${JSON.stringify(createCentreOutcome)}`);
    // NOTE : si l'appel n'a pas été rejeté, il doit avoir été recadré de force sur le site de
    // l'appelant (jamais un centre effectivement créé sous foreignSiteId). On ne peut PAS le
    // vérifier depuis cette session ADMINISTRATEUR_SITE elle-même : hierarchy:getCentres
    // applique le même recadrage de site pour tout rôle non-SUPER-ADMIN (protection
    // pré-existante), donc getCentres(foreignSiteId) depuis cette session renvoie de toute
    // façon les centres du site de l'appelant, quel que soit l'argument — un faux positif
    // trompeur. La vérification réelle (site_id effectif du centre "Intrus" côté serveur) est
    // faite plus bas, dans le test NON-RÉGRESSION, via une vraie session SUPER ADMIN (ROOT).

    // 4. updateCentre sur le centre étranger doit être rejeté.
    const updateCentreOutcome = await window.evaluate(async (centreId) => {
      try {
        await (window as any).api.hierarchy.updateCentre(centreId, { nom: 'HACKED_CENTRE' });
        return { rejected: false };
      } catch (e: any) {
        return { rejected: true, message: String(e?.message || e) };
      }
    }, foreignCentreId);
    console.log(`[P0-1][updateCentre] centre étranger : ${JSON.stringify(updateCentreOutcome)}`);
    expect.soft(updateCentreOutcome.rejected, 'hierarchy:updateCentre doit rejeter la modification d\'un centre étranger par un ADMINISTRATEUR_SITE').toBe(true);

    // 5. deleteCentre sur le centre étranger doit être rejeté.
    const deleteCentreOutcome = await window.evaluate(async (centreId) => {
      try {
        await (window as any).api.hierarchy.deleteCentre(centreId);
        return { rejected: false };
      } catch (e: any) {
        return { rejected: true, message: String(e?.message || e) };
      }
    }, foreignCentreId);
    console.log(`[P0-1][deleteCentre] centre étranger : ${JSON.stringify(deleteCentreOutcome)}`);
    expect.soft(deleteCentreOutcome.rejected, 'hierarchy:deleteCentre doit rejeter la suppression d\'un centre étranger par un ADMINISTRATEUR_SITE').toBe(true);

    // 6. deleteSite sur le site étranger doit être rejeté (fait en dernier : destructeur).
    const deleteSiteOutcome = await window.evaluate(async (siteId) => {
      try {
        await (window as any).api.hierarchy.deleteSite(siteId);
        return { rejected: false };
      } catch (e: any) {
        return { rejected: true, message: String(e?.message || e) };
      }
    }, foreignSiteId);
    console.log(`[P0-1][deleteSite] site étranger : ${JSON.stringify(deleteSiteOutcome)}`);
    expect.soft(deleteSiteOutcome.rejected, 'hierarchy:deleteSite doit rejeter la suppression d\'un site étranger par un ADMINISTRATEUR_SITE').toBe(true);

    await logout();
  });

  test('P0-2 — ADMINISTRATEUR_SITE : bypass FAILSAFE_ROOT_ID forgé côté client sur db:purge/db:emergency-purge', async () => {
    const { window } = env;
    const user = getTestUser('administrateurSite');
    await login(user.login, user.password);
    await window.waitForURL(/#\/dashboard/, { timeout: 15000 });

    // Forge un objet currentUser prétendant être le ROOT failsafe (id 999999), alors que
    // cette session n'a JAMAIS authentifié via le vrai login ROOT (mot de passe jamais vérifié).
    const forgedRootUser = { id_user: 999999, role: 'SUPER ADMIN', login: 'exploit' };

    const purgeOutcome = await window.evaluate(async ({ siteId, forged }) => {
      try {
        const res = await (window as any).api.db.purge(siteId, forged);
        return { rejected: false, res };
      } catch (e: any) {
        return { rejected: true, message: String(e?.message || e) };
      }
    }, { siteId: foreignSiteId, forged: forgedRootUser });
    console.log(`[P0-2][db:purge] site étranger, currentUser forgé 999999 : ${JSON.stringify(purgeOutcome)}`);
    expect.soft(purgeOutcome.rejected, 'db:purge ne doit jamais accepter un id_user=999999 forgé côté client sans session ROOT réelle').toBe(true);

    const emergencyOutcome = await window.evaluate(async ({ siteId, forged }) => {
      try {
        const res = await (window as any).api.db.emergencyPurge(siteId, forged);
        return { rejected: false, res };
      } catch (e: any) {
        return { rejected: true, message: String(e?.message || e) };
      }
    }, { siteId: foreignSiteId, forged: forgedRootUser });
    console.log(`[P0-2][db:emergency-purge] site étranger, currentUser forgé 999999 : ${JSON.stringify(emergencyOutcome)}`);
    expect.soft(emergencyOutcome.rejected, 'db:emergency-purge ne doit jamais accepter un id_user=999999 forgé côté client sans session ROOT réelle').toBe(true);

    await logout();
  });

  test('NON-RÉGRESSION — le vrai login ROOT (mot de passe correct) conserve son bypass légitime sur db:purge', async () => {
    const { window } = env;
    await login('root', ROOT_PASSWORD);
    await window.waitForURL(/#\/dashboard/, { timeout: 15000 });

    // Vérification différée de P0-1 (3. createCentre) : depuis une vraie session SUPER ADMIN
    // (ROOT), getCentres(foreignSiteId) n'est PAS recadré — on peut donc vérifier avec certitude
    // que le centre "Intrus" créé par l'ADMINISTRATEUR_SITE plus haut n'a PAS atterri sous le
    // site étranger (soit il a été rejeté, soit il a été recadré de force sur le site de
    // l'appelant — jamais créé sous foreignSiteId).
    const foreignCentresAsRoot = await window.evaluate(async (siteId) => (window as any).api.hierarchy.getCentres(siteId), foreignSiteId);
    const injectedUnderForeignSite = Array.isArray(foreignCentresAsRoot) && foreignCentresAsRoot.some((c: any) => c.nom === 'Intrus');
    console.log(`[P0-1][createCentre][vérif ROOT] centres du site étranger : ${JSON.stringify(foreignCentresAsRoot?.map((c: any) => c.nom))}`);
    expect.soft(injectedUnderForeignSite, 'hierarchy:createCentre ne doit jamais créer effectivement un centre sous un site étranger (vérifié via une vraie session SUPER ADMIN)').toBe(false);

    // Un vrai ROOT (session serveur réellement établie via le bon mot de passe) doit pouvoir
    // purger N'IMPORTE QUEL site, y compris le site "home" (jamais le sien au sens strict, ROOT
    // n'a pas de site_id) — la légitimité du bypass volontaire (§ intro de la tâche) doit
    // survivre au correctif qui dérive désormais l'identité de getSecureCurrentUser().
    const purgeOutcome = await window.evaluate(async (siteId) => {
      try {
        const res = await (window as any).api.db.purge(siteId);
        return { rejected: false, res };
      } catch (e: any) {
        return { rejected: true, message: String(e?.message || e) };
      }
    }, homeSiteId);
    console.log(`[NON-REGRESSION][db:purge via vrai ROOT] : ${JSON.stringify(purgeOutcome)}`);
    expect.soft(purgeOutcome.rejected, 'Un vrai login ROOT (session serveur réelle) doit conserver son bypass légitime sur db:purge').toBe(false);

    await logout();
  });
});
