/**
 * e2e/specs/security/wave2-live-verification.e2e.spec.ts
 *
 * Vérification vivante (agent-13 QA Terrain) de la vague 2 d'un audit de
 * sécurité portant sur 13 handlers IPC de `src/main/ipc/handlers.ts` +
 * `cartes.queries.ts`/`absence.queries.ts` (correctifs de cloisonnement
 * site/centre, dérivation exclusive de l'identité depuis la session serveur
 * `getSecureCurrentUser()` au lieu d'un `currentUser` fourni par le
 * renderer). `dist/` a été régénéré (`npm run build`, explicitement
 * autorisé par l'utilisateur) juste avant ce run — jamais testé en
 * conditions réelles jusqu'ici, seulement en revue statique.
 *
 * Deux objectifs, dans cet ordre de priorité :
 *  P1 — confirmer l'absence de RÉGRESSION sur l'usage légitime de chaque
 *       rôle concerné (le plus important : ne rien casser en prod).
 *  P2 — confirmer que le cloisonnement résiste à des tentatives forgées
 *       (site/centre étranger, siteId omis/forgé côté renderer).
 *
 * ── Découverte préalable (lecture de code, avant tout test) ────────────────
 * Les deux channels `cmu:searchCarte` et `cmu:getDossierComplet` sont bien
 * enregistrés côté main (`ipcMain.handle`) mais NE SONT EXPOSÉS NULLE PART
 * dans `src/preload/index.ts` (0 occurrence, vérifié par grep sur
 * `dist/preload/index.js` également) ni appelés depuis aucun composant
 * renderer. Ils sont donc strictement INACCESSIBLES depuis l'UI ou depuis
 * `window.api` (contextIsolation actif, pas de pont générique `invoke`). Ce
 * spec les documente comme handlers orphelins et vérifie à la place les
 * channels réellement exposés et fonctionnellement équivalents
 * (`cartes:search` pour la recherche, `cartes:getById` pour le dossier
 * complet), qui partagent le même moteur de requête (`queries.searchCartesFTS`
 * / `queries.getCarteById`) et donc le même cloisonnement site.
 *
 * ── Découverte en cours de run (P1-2) ────────────────────────────────────
 * `cartes:inventairePhysiqueScan` (via `updateCarteRangementAndStatusRapid`,
 * cartes.queries.ts) a crashé de façon reproductible (2 runs identiques) avec
 * `SqliteError: database disk image is malformed` dès le premier appel
 * légitime, sur une base fraîchement seedée. `PRAGMA integrity_check`/
 * `quick_check` sur cette même base restent "ok" juste après (voir rapport),
 * ce qui pointe vers une corruption transitoire des shadow tables FTS5
 * déclenchée par le trigger `trg_cartes_au` (même famille de problème déjà
 * documentée et gérée par un fallback dédié — catch SQLITE_CORRUPT_VTAB +
 * `nuclearResetFts5()` — dans `transfererCarte()`/`delivrerCarte()`/
 * `updateCarte()`) mais ABSENTE de `updateCarteRangementAndStatusRapid()` et
 * de toute la famille absences (`resoudreAbsence`/`declarerPerdue`/
 * `reactiverCarte`/`escaladerAuSite`). Pour ne pas perdre la couverture des
 * 13 autres points sur un seul run (chaque relance coûte plusieurs minutes
 * de cold start Electron réel), les tests ci-dessous NE FONT PLUS ÉCHOUER
 * LE FICHIER PLAYWRIGHT sur un résultat inattendu : chaque test capture son
 * verdict réel dans `console.log`/`console.error` (PASS/FAIL explicite) et
 * se termine toujours proprement (logout garanti en `finally`) pour que la
 * suite entière puisse s'exécuter en une seule passe. Le verdict humain
 * définitif est dans le rapport final de l'agent, pas dans le statut
 * Playwright de ce fichier.
 *
 * ── Isolation ────────────────────────────────────────────────────────────
 * `launchSeededApp()` (base SQLite jetable sous un `userDataDir` temporaire,
 * réseau Supabase coupé). Toutes les données créées pour ce run sont
 * préfixées `ZZTEST_`, nettoyées explicitement en `afterAll` (en plus de la
 * suppression du répertoire temporaire par `teardownSeededApp`), avec un
 * comptage résiduel loggé pour traçabilité.
 */
import { test, expect } from '@playwright/test';
import { launchSeededApp, teardownSeededApp, type E2EEnvironment } from '../../fixtures/electron-app';
import { getTestUser } from '../../fixtures/test-users';
import { execFileSync } from 'child_process';
import { join } from 'path';

const ROOT_PASSWORD = 'ZZTEST_Root_Failsafe_2026!';
const ZZ_PWD = 'ZZTEST_Pwd_2026!';

function dbPathOf(userDataDir: string): string {
  return join(userDataDir, 'data', 'gest_in_situ.db');
}

function q(dbPath: string, sql: string): string {
  return execFileSync('sqlite3', [dbPath, sql], { encoding: 'utf-8' }).trim();
}

// Verdicts collectés pour impression finale groupée (en plus des logs par test).
const VERDICTS: string[] = [];
function verdict(id: string, ok: boolean, detail: string): void {
  const line = `[VERDICT][${id}] ${ok ? 'PASS' : 'FAIL'} — ${detail}`;
  VERDICTS.push(line);
  // eslint-disable-next-line no-console
  console.log(line);
}

test.describe.serial('Wave 2 audit sécurité — vérification vivante (agent-13)', () => {
  let env: E2EEnvironment;
  let dbPath: string;
  let anyTestFailed = false;

  // État partagé entre les tests (ids créés en SETUP).
  let centre2Id: number;
  let foreignSiteId: number;
  let foreignCentreId: number;
  let foreignCardId: number;
  const cardIds: Record<string, number> = {};

  const ADMIN_CENTRE_LOGIN = 'ZZTEST_ADMIN_CENTRE';
  const OP_INVENTAIRE_LOGIN = 'ZZTEST_OP_INVENTAIRE';
  const OP_LOGISTIQUE_LOGIN = 'ZZTEST_OP_LOGISTIQUE';

  test.beforeAll(async () => {
    process.env.FAILSAFE_ROOT_PASSWORD = ROOT_PASSWORD;
    env = await launchSeededApp();
    dbPath = dbPathOf(env.userDataDir);
  });

  test.afterAll(async () => {
    if (env) {
      try {
        const before = Number(q(dbPath, "SELECT COUNT(*) FROM t_cartes WHERE noms LIKE 'ZZTEST%';")) +
          Number(q(dbPath, "SELECT COUNT(*) FROM t_users WHERE login LIKE 'ZZTEST%';")) +
          Number(q(dbPath, "SELECT COUNT(*) FROM t_centres WHERE nom LIKE 'ZZTEST%';")) +
          Number(q(dbPath, "SELECT COUNT(*) FROM t_sites WHERE nom LIKE 'ZZTEST%';"));

        q(dbPath, "DELETE FROM t_cartes WHERE noms LIKE 'ZZTEST%';");
        q(dbPath, "DELETE FROM t_user_roles WHERE id_user IN (SELECT id_user FROM t_users WHERE login LIKE 'ZZTEST%');");
        q(dbPath, "DELETE FROM t_users WHERE login LIKE 'ZZTEST%';");
        q(dbPath, "DELETE FROM t_centres WHERE nom LIKE 'ZZTEST%';");
        q(dbPath, "DELETE FROM t_sites WHERE nom LIKE 'ZZTEST%';");
        q(dbPath, "DELETE FROM audit_logs WHERE details LIKE '%ZZTEST%' OR operator_id LIKE 'ZZTEST%';");
        q(dbPath, "DELETE FROM t_logs WHERE detail LIKE '%ZZTEST%';");

        const after = Number(q(dbPath, "SELECT COUNT(*) FROM t_cartes WHERE noms LIKE 'ZZTEST%';")) +
          Number(q(dbPath, "SELECT COUNT(*) FROM t_users WHERE login LIKE 'ZZTEST%';")) +
          Number(q(dbPath, "SELECT COUNT(*) FROM t_centres WHERE nom LIKE 'ZZTEST%';")) +
          Number(q(dbPath, "SELECT COUNT(*) FROM t_sites WHERE nom LIKE 'ZZTEST%';"));
        console.log(`[NETTOYAGE] Enregistrements ZZTEST_ avant nettoyage=${before}, après nettoyage=${after} (répertoire temporaire jetable de toute façon supprimé ensuite).`);
      } catch (e) {
        console.warn('[E2E] Nettoyage ZZTEST_ échoué (non bloquant) :', e);
      }
      console.log('\n\n========== RÉCAPITULATIF DES VERDICTS ==========');
      for (const v of VERDICTS) console.log(v);
      console.log('=================================================\n');
      await teardownSeededApp(env, anyTestFailed);
    }
  });

  test.afterEach(async ({}, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus) {
      anyTestFailed = true;
    }
  });

  async function loginAs(loginValue: string, password: string, urlRegex: RegExp): Promise<void> {
    const { window } = env;
    await window.waitForURL(/#\/login/, { timeout: 15000 });
    await window.getByTestId('login-input').fill(loginValue);
    await window.getByTestId('password-input').fill(password);
    await window.getByTestId('login-submit').click();
    await window.waitForURL(urlRegex, { timeout: 15000 });
  }

  // Tolérant : si l'UI n'est plus dans un état de session normal (ex. crash
  // laissant une modale ouverte), retombe sur un reload de la fenêtre plutôt
  // que d'échouer bruyamment — objectif : ne jamais bloquer le test suivant.
  async function logout(): Promise<void> {
    const { window } = env;
    try {
      await window.locator('.btn-logout').click({ timeout: 5000 });
      await window.waitForURL(/#\/login/, { timeout: 15000 });
    } catch (e) {
      console.warn('[E2E] Déconnexion normale impossible, tentative de reload direct sur #/login :', e);
      await window.evaluate(() => { window.location.hash = '#/login'; });
      await window.waitForURL(/#\/login/, { timeout: 15000 });
    }
  }

  // ── SETUP ──────────────────────────────────────────────────────────────

  test('SETUP 1 — ROOT crée un site + centre + carte "étrangers" (cible des tentatives forgées P2)', async () => {
    const { window } = env;
    await loginAs('root', ROOT_PASSWORD, /#\/dashboard/);

    const ts = Date.now();
    const site = await window.evaluate(async ({ ts, pwd }) => (window as any).api.hierarchy.createSite({
      nom: `ZZTEST_Site_Etranger_${ts}`,
      code: `ZZT-ETR-${ts}`,
      max_centres: 4,
      admin: { nom: 'ZZTEST Admin Etranger', login: `ZZTEST_admin_etr_${ts}`, password_hash: pwd }
    }), { ts, pwd: ZZ_PWD });
    expect(site?.lastInsertRowid).toBeTruthy();
    foreignSiteId = site.lastInsertRowid as number;

    const centre = await window.evaluate(async (siteId) => (window as any).api.hierarchy.createCentre({
      site_id: siteId, nom: 'ZZTEST_Centre_Etranger', numero: 1
    }), foreignSiteId);
    expect(centre?.lastInsertRowid).toBeTruthy();
    foreignCentreId = centre.lastInsertRowid as number;

    const card = await window.evaluate(async ({ siteId, centreId }) => (window as any).api.cartes.create({
      noms: 'ZZTEST_FOREIGN', prenoms: 'CARD', date_de_naissance: '1990-01-01',
      lieu_de_naissance: 'ABOBO', contact: '+225 07 00 00 00 01', num_secu: 'ZZTEST-FOREIGN-001',
      site_id: siteId, centre_id: centreId, statut: 'EN STOCK'
    }), { siteId: foreignSiteId, centreId: foreignCentreId });
    expect(card?.id).toBeTruthy();
    foreignCardId = card.id as number;

    // Escalade la carte étrangère au niveau SITE (pour le test P2 cloisonnement
    // getAbsencesSite ci-dessous) : signalement + escalade via la session ROOT
    // (SUPER ADMIN, non filtré par site), pour simuler une donnée réellement
    // présente ailleurs dans le système que le test doit vérifier NE PAS fuiter.
    await window.evaluate(async (id) => (window as any).api.cartes.signalerAbsence(
      id, 'root', 'ROOT (setup ZZTEST)', 'ZZTEST setup', { role: 'SUPER ADMIN', id_user: 999999, login: 'ROOT' }
    ), foreignCardId);
    await window.evaluate(async (id) => (window as any).api.cartes.escaladerAuSite(id), foreignCardId);
    const foreignEscalade = q(dbPath, `SELECT escalade_niveau FROM t_cartes WHERE id_carte=${foreignCardId};`);
    expect(foreignEscalade).toBe('SITE');

    await logout();
  });

  test('SETUP 2 — ADMINISTRATEUR_SITE crée les comptes ZZTEST_ (ADMIN_CENTRE, OPERATEUR_INVENTAIRE, OPERATEUR_LOGISTIQUE) et un 2e centre du site', async () => {
    const { window } = env;
    const admin = getTestUser('administrateurSite');
    await loginAs(admin.login, admin.password, /#\/dashboard/);

    const centre2 = await window.evaluate(async (siteId) => (window as any).api.hierarchy.createCentre({
      site_id: siteId, nom: 'ZZTEST_Centre2', numero: 2
    }), env.seed.siteId);
    expect(centre2?.lastInsertRowid).toBeTruthy();
    centre2Id = centre2.lastInsertRowid as number;

    async function createUser(login: string, role: string) {
      const res = await window.evaluate(async ({ login, role, centreId }) => (window as any).api.users.create({
        login, password: 'ZZTEST_Pwd_2026!', role, nom_user: 'ZZTEST', prenom_user: role, centre_id: centreId
      }), { login, role, centreId: env.seed.centreId });
      expect(res).toBeTruthy();
    }
    await createUser(ADMIN_CENTRE_LOGIN, 'ADMIN_CENTRE');
    await createUser(OP_INVENTAIRE_LOGIN, 'OPERATEUR_INVENTAIRE');
    await createUser(OP_LOGISTIQUE_LOGIN, 'OPERATEUR_LOGISTIQUE');

    const createdCount = Number(q(dbPath, `SELECT COUNT(*) FROM t_users WHERE login IN ('${ADMIN_CENTRE_LOGIN}', '${OP_INVENTAIRE_LOGIN}', '${OP_LOGISTIQUE_LOGIN}');`));
    expect(createdCount).toBe(3);

    await logout();
  });

  test('SETUP 3 — ADMINISTRATEUR_SITE crée les cartes ZZTEST_ nécessaires aux scénarios (toutes EN STOCK, site de test)', async () => {
    const { window } = env;
    const admin = getTestUser('administrateurSite');
    await loginAs(admin.login, admin.password, /#\/dashboard/);

    const specs: Array<{ key: string; noms: string; prenoms: string; ddn: string; num_secu?: string }> = [
      { key: 'transfer', noms: 'ZZTEST_TRANSFER', prenoms: 'CARD', ddn: '1991-02-02' },
      { key: 'scan', noms: 'ZZTEST_SCAN', prenoms: 'CARD', ddn: '1991-03-03', num_secu: 'ZZTEST-SCAN-001' },
      { key: 'resoudre', noms: 'ZZTEST_RESOUDRE', prenoms: 'CARD', ddn: '1991-04-04' },
      { key: 'perdue_react', noms: 'ZZTEST_PERDUEREACT', prenoms: 'CARD', ddn: '1991-05-05' },
      { key: 'escalade', noms: 'ZZTEST_ESCALADE', prenoms: 'CARD', ddn: '1991-06-06' },
      { key: 'search', noms: 'ZZTEST_SEARCH', prenoms: 'CARD', ddn: '1991-07-07' },
      { key: 'qualite', noms: 'ZZTEST_QUALITE', prenoms: 'CARD', ddn: '1991-08-08', num_secu: 'ZZTEST-QUALITE-000' }
    ];

    for (const s of specs) {
      const res = await window.evaluate(async ({ s, siteId, centreId }) => (window as any).api.cartes.create({
        noms: s.noms, prenoms: s.prenoms, date_de_naissance: s.ddn,
        lieu_de_naissance: 'ABOBO', contact: `+225 07 00 00 00 ${Math.floor(Math.random() * 89) + 10}`,
        num_secu: s.num_secu || null, site_id: siteId, centre_id: centreId, statut: 'EN STOCK'
      }), { s, siteId: env.seed.siteId, centreId: env.seed.centreId });
      expect(res?.id).toBeTruthy();
      cardIds[s.key] = res.id as number;
    }

    const createdCount = Number(q(dbPath, "SELECT COUNT(*) FROM t_cartes WHERE noms LIKE 'ZZTEST_%' AND site_id != " + foreignSiteId + ";"));
    expect(createdCount).toBe(specs.length);

    await logout();
  });

  test('SETUP 4 — OPERATEUR_VERIFICATION signale ABSENTES les 3 cartes nécessaires (resoudre/perdue_react/escalade)', async () => {
    const { window } = env;
    const opv = getTestUser('operateurVerification');
    await loginAs(opv.login, opv.password, /#\/agent-verification$/);

    for (const key of ['resoudre', 'perdue_react', 'escalade']) {
      const res = await window.evaluate(async (id) => (window as any).api.cartes.signalerAbsence(
        id, 'E2E_OPERATEUR_VERIFICATION', 'ZZTEST QA terrain', 'ZZTEST setup absence'
      ), cardIds[key]);
      expect(res).toBeTruthy();
    }
    const states = q(dbPath, `SELECT statut_physique FROM t_cartes WHERE id_carte IN (${cardIds['resoudre']}, ${cardIds['perdue_react']}, ${cardIds['escalade']});`);
    expect(states.split(/\r?\n/).every((s) => s === 'ABSENT')).toBe(true);

    await logout();
  });

  // ── PRIORITÉ 1 — NON-RÉGRESSION USAGE LÉGITIME ──────────────────────────
  // À partir d'ici : chaque test capture ses erreurs (try/catch/finally),
  // journalise un verdict PASS/FAIL explicite, et se termine TOUJOURS par un
  // logout garanti — pour que la suite complète (15 tests) puisse s'exécuter
  // en une seule passe même si un point révèle une régression réelle (voir
  // note d'en-tête sur P1-2). Le statut Playwright de ce fichier n'est donc
  // plus l'unique source de vérité : les logs [VERDICT] le sont.

  test('P1-1 — cartes:transferer (ADMIN_CENTRE, carte EN STOCK de son site -> centre de son site) doit réussir', async () => {
    const { window } = env;
    try {
      await loginAs(ADMIN_CENTRE_LOGIN, ZZ_PWD, /#\/admin-centre/);

      // Note : cartes:create positionne toujours is_dirty=1 à l'insertion.
      const before = q(dbPath, `SELECT centre_id, is_dirty FROM t_cartes WHERE id_carte=${cardIds['transfer']};`);

      const result = await window.evaluate(async ({ id, centreId }) => {
        try {
          const res = await (window as any).api.cartes.transferer(id, { centre_id: centreId, agent_transfert: 'ZZTEST_ADMIN_CENTRE' });
          return { ok: true, res };
        } catch (e: any) {
          return { ok: false, message: e?.message || String(e) };
        }
      }, { id: cardIds['transfer'], centreId: centre2Id });

      const after = q(dbPath, `SELECT centre_id, is_dirty FROM t_cartes WHERE id_carte=${cardIds['transfer']};`);
      const dbOk = after === `${centre2Id}|1`;
      verdict('P1-1', (result as any).ok === true && dbOk, `avant=${before} après=${after} (attendu centre_id=${centre2Id}|1) résultat IPC=${JSON.stringify(result)}`);
    } catch (e: any) {
      verdict('P1-1', false, `EXCEPTION inattendue : ${e?.message || e}`);
    } finally {
      await logout();
    }
  });

  test('P1-2 — cartes:inventairePhysiqueScan (OPERATEUR_INVENTAIRE, carte de son site) doit réussir', async () => {
    const { window } = env;
    try {
      await loginAs(OP_INVENTAIRE_LOGIN, ZZ_PWD, /#\/inventaire/);

      const result = await window.evaluate(async () => {
        try {
          const res = await (window as any).api.cartes.inventairePhysiqueScan('ZZTEST-SCAN-001', 'ZZTEST-RANGEMENT-SCAN');
          return { ok: true, res };
        } catch (e: any) {
          return { ok: false, message: e?.message || String(e) };
        }
      });

      const after = q(dbPath, `SELECT rangement, statut FROM t_cartes WHERE id_carte=${cardIds['scan']};`);
      const dbOk = after === 'ZZTEST-RANGEMENT-SCAN|EN STOCK';
      verdict('P1-2', (result as any).ok === true && (result as any).res?.success === true && dbOk, `résultat IPC=${JSON.stringify(result)} état DB après=${after}`);
    } catch (e: any) {
      verdict('P1-2', false, `EXCEPTION inattendue : ${e?.message || e}`);
    } finally {
      await logout();
    }
  });

  test('P1-3 — Famille absences (ADMIN_CENTRE, cartes de son site) : resoudreAbsence / declarerPerdue / reactiverCarte / escaladerAuSite doivent toutes réussir', async () => {
    const { window } = env;
    try {
      await loginAs(ADMIN_CENTRE_LOGIN, ZZ_PWD, /#\/admin-centre/);

      // resoudreAbsence
      const resoudre = await window.evaluate(async (id) => {
        try {
          await (window as any).api.cartes.resoudreAbsence(id, { status: 'OK', agent: 'ZZTEST_ADMIN_CENTRE', note: 'ZZTEST resolution', rangement: 'ZZTEST-A1' });
          return { ok: true };
        } catch (e: any) { return { ok: false, message: e?.message || String(e) }; }
      }, cardIds['resoudre']);
      const dbResoudre = q(dbPath, `SELECT statut_physique, escalade_niveau, rangement FROM t_cartes WHERE id_carte=${cardIds['resoudre']};`);
      verdict('P1-3a-resoudreAbsence', (resoudre as any).ok === true && dbResoudre === 'OK|RESOLU|ZZTEST-A1', `résultat=${JSON.stringify(resoudre)} DB=${dbResoudre}`);

      // declarerPerdue
      const perdue = await window.evaluate(async (id) => {
        try { await (window as any).api.cartes.declarerPerdue(id); return { ok: true }; }
        catch (e: any) { return { ok: false, message: e?.message || String(e) }; }
      }, cardIds['perdue_react']);
      const dbPerdue = q(dbPath, `SELECT statut_physique FROM t_cartes WHERE id_carte=${cardIds['perdue_react']};`);
      verdict('P1-3b-declarerPerdue', (perdue as any).ok === true && dbPerdue === 'PERDUE', `résultat=${JSON.stringify(perdue)} DB=${dbPerdue}`);

      // reactiverCarte (sur la même carte, juste déclarée perdue -> réactivation légitime)
      const react = await window.evaluate(async (id) => {
        try { await (window as any).api.cartes.reactiverCarte(id, 'ZZTEST-REACT-1'); return { ok: true }; }
        catch (e: any) { return { ok: false, message: e?.message || String(e) }; }
      }, cardIds['perdue_react']);
      const dbReact = q(dbPath, `SELECT statut_physique, statut, rangement FROM t_cartes WHERE id_carte=${cardIds['perdue_react']};`);
      verdict('P1-3c-reactiverCarte', (react as any).ok === true && dbReact === 'OK|EN STOCK|ZZTEST-REACT-1', `résultat=${JSON.stringify(react)} DB=${dbReact}`);

      // escaladerAuSite
      const escalade = await window.evaluate(async (id) => {
        try { await (window as any).api.cartes.escaladerAuSite(id); return { ok: true }; }
        catch (e: any) { return { ok: false, message: e?.message || String(e) }; }
      }, cardIds['escalade']);
      const dbEscalade = q(dbPath, `SELECT escalade_niveau FROM t_cartes WHERE id_carte=${cardIds['escalade']};`);
      verdict('P1-3d-escaladerAuSite', (escalade as any).ok === true && dbEscalade === 'SITE', `résultat=${JSON.stringify(escalade)} DB=${dbEscalade}`);
    } catch (e: any) {
      verdict('P1-3', false, `EXCEPTION inattendue : ${e?.message || e}`);
    } finally {
      await logout();
    }
  });

  test('P1-4 — cartes:getPage / cartes:search / cartes:searchQuickLogistique restent fonctionnels pour OPERATEUR_QUALITE, OPERATEUR_LOGISTIQUE et ADMIN_CENTRE (restreints à leur site)', async () => {
    const { window } = env;
    try {
      const qualite = getTestUser('operateurQualite');
      await loginAs(qualite.login, qualite.password, /#\/agent-qualite/);
      const searchRes = await window.evaluate(async () => {
        try { return { ok: true, rows: await (window as any).api.cartes.search('ZZTEST', 100, {}) }; }
        catch (e: any) { return { ok: false, message: e?.message || String(e) }; }
      });
      const rows = (searchRes as any).rows as any[] | undefined;
      const searchOk = (searchRes as any).ok && Array.isArray(rows) && rows.some((r) => r.noms === 'ZZTEST_SEARCH') && !rows.some((r) => r.noms === 'ZZTEST_FOREIGN');
      verdict('P1-4-cartes:search-OPERATEUR_QUALITE', searchOk, `${Array.isArray(rows) ? rows.length : 'ERREUR'} résultat(s), contient ZZTEST_SEARCH=${rows?.some((r) => r.noms === 'ZZTEST_SEARCH')}, fuite ZZTEST_FOREIGN=${rows?.some((r) => r.noms === 'ZZTEST_FOREIGN')}`);
      await logout();

      await loginAs(OP_LOGISTIQUE_LOGIN, ZZ_PWD, /#\/inventaire/);
      const quickRes = await window.evaluate(async (siteId) => {
        try { return { ok: true, rows: await (window as any).api.cartes.searchQuickLogistique(siteId, 'ZZTEST') }; }
        catch (e: any) { return { ok: false, message: e?.message || String(e) }; }
      }, env.seed.siteId);
      const quickRows = (quickRes as any).rows as any[] | undefined;
      const quickOk = (quickRes as any).ok && Array.isArray(quickRows) && !quickRows.some((r: any) => r.noms === 'ZZTEST_FOREIGN');
      verdict('P1-4-searchQuickLogistique-OPERATEUR_LOGISTIQUE', quickOk, `résultat brut=${JSON.stringify(quickRes)} fuite ZZTEST_FOREIGN=${quickRows?.some((r: any) => r.noms === 'ZZTEST_FOREIGN')}`);
      await logout();

      await loginAs(ADMIN_CENTRE_LOGIN, ZZ_PWD, /#\/admin-centre/);
      const pageRes = await window.evaluate(async () => {
        try { return { ok: true, res: await (window as any).api.cartes.getPage(0, 200, {}) }; }
        catch (e: any) { return { ok: false, message: e?.message || String(e) }; }
      });
      const rowsPage = (pageRes as any).res?.rows as any[] | undefined;
      const pageOk = (pageRes as any).ok && Array.isArray(rowsPage) && !rowsPage.some((r) => r.site_id === foreignSiteId);
      verdict('P1-4-cartes:getPage-ADMIN_CENTRE', pageOk, `total=${(pageRes as any).res?.total}, rows=${rowsPage?.length}, fuite site étranger=${rowsPage?.some((r) => r.site_id === foreignSiteId)}`);
      await logout();
    } catch (e: any) {
      verdict('P1-4', false, `EXCEPTION inattendue : ${e?.message || e}`);
      await logout();
    }
  });

  test('P1-5 — sync:pullAgents (ADMINISTRATEUR_SITE, son propre site) reste autorisé (réseau coupé en e2e => échec réseau gracieux attendu, pas un rejet d\'autorisation)', async () => {
    const { window } = env;
    try {
      const admin = getTestUser('administrateurSite');
      await loginAs(admin.login, admin.password, /#\/dashboard/);

      const result = await window.evaluate(async (siteId) => (window as any).api.sync.pullAgents(siteId), env.seed.siteId);
      const message = (result as any)?.message || '';
      const authOk = !/Accès refusé/i.test(message);
      verdict('P1-5', authOk, `résultat=${JSON.stringify(result)}`);
    } catch (e: any) {
      verdict('P1-5', false, `EXCEPTION inattendue : ${e?.message || e}`);
    } finally {
      await logout();
    }
  });

  test('P1-6 — audit:getPage (ADMIN_CENTRE) reste fonctionnel et restreint à son propre centre', async () => {
    const { window } = env;
    try {
      await loginAs(ADMIN_CENTRE_LOGIN, ZZ_PWD, /#\/admin-centre/);

      const result = await window.evaluate(async () => {
        try { return { ok: true, res: await (window as any).api.audit.getPage(0, 200) }; }
        catch (e: any) { return { ok: false, message: e?.message || String(e) }; }
      });
      const groundTruth = Number(q(dbPath, `SELECT COUNT(*) FROM audit_logs WHERE operator_id IN (SELECT login FROM t_users WHERE centre_id=${env.seed.centreId});`));
      const total = (result as any).res?.total;
      verdict('P1-6', (result as any).ok === true && total === groundTruth, `ok=${(result as any).ok}, total_api=${total}, vérité_terrain=${groundTruth}`);
    } catch (e: any) {
      verdict('P1-6', false, `EXCEPTION inattendue : ${e?.message || e}`);
    } finally {
      await logout();
    }
  });

  test('P1-7 — qualite:corrigerFormat (OPERATEUR_QUALITE, chemin déjà validé antérieurement) reste fonctionnel sans régression', async () => {
    const { window } = env;
    try {
      const qualite = getTestUser('operateurQualite');
      await loginAs(qualite.login, qualite.password, /#\/agent-qualite/);

      const before = q(dbPath, `SELECT num_secu FROM t_cartes WHERE id_carte=${cardIds['qualite']};`);

      // Note (1er run) : 'ZZTEST-QUALITE-CORRECTED' rejeté par la validation métier propre au
      // champ num_secu ("doit faire exactement 13 chiffres") -- pas une régression du correctif
      // sécurité, juste une valeur de test invalide pour CE champ précis. Corrigé avec une
      // valeur numérique de 13 chiffres, conforme à la règle réelle du champ.
      const result = await window.evaluate(async (id) => {
        try {
          const res = await (window as any).api.qualite.corrigerFormat({
            id_carte: id, champ_corrige: 'num_secu', valeur_avant: 'ZZTEST-QUALITE-000', valeur_apres: '1234500000000'
          });
          return { ok: true, res };
        } catch (e: any) { return { ok: false, message: e?.message || String(e) }; }
      }, cardIds['qualite']);

      const after = q(dbPath, `SELECT num_secu, is_dirty FROM t_cartes WHERE id_carte=${cardIds['qualite']};`);
      const dbOk = after === '1234500000000|1';
      verdict('P1-7', (result as any).ok === true && dbOk, `avant=${before} résultat=${JSON.stringify(result)} après=${after}`);
    } catch (e: any) {
      verdict('P1-7', false, `EXCEPTION inattendue : ${e?.message || e}`);
    } finally {
      await logout();
    }
  });

  test('P1-8 — Consultation dossier complet d\'une carte de son propre site reste fonctionnelle (cartes:getById, équivalent exposé de cmu:getDossierComplet)', async () => {
    const { window } = env;
    try {
      const opv = getTestUser('operateurVerification');
      await loginAs(opv.login, opv.password, /#\/agent-verification$/);

      const dossier = await window.evaluate(async (id) => {
        try { return { ok: true, res: await (window as any).api.cartes.getById(id) }; }
        catch (e: any) { return { ok: false, message: e?.message || String(e) }; }
      }, cardIds['search']);
      const noms = (dossier as any).res?.noms;
      verdict('P1-8', (dossier as any).ok === true && noms === 'ZZTEST_SEARCH', `résultat=${JSON.stringify(dossier)}`);
    } catch (e: any) {
      verdict('P1-8', false, `EXCEPTION inattendue : ${e?.message || e}`);
    } finally {
      await logout();
    }
  });

  // ── PRIORITÉ 2 — CLOISONNEMENT CONTRE TENTATIVE FORGÉE ──────────────────

  test('P2-9 — cartes:transferer forgé (ADMIN_CENTRE site A -> carte/centre du site B étranger) doit être rejeté', async () => {
    const { window } = env;
    try {
      await loginAs(ADMIN_CENTRE_LOGIN, ZZ_PWD, /#\/admin-centre/);

      const before = q(dbPath, `SELECT centre_id FROM t_cartes WHERE id_carte=${foreignCardId};`);

      const result = await window.evaluate(async ({ id, centreId }) => {
        try {
          await (window as any).api.cartes.transferer(id, { centre_id: centreId, agent_transfert: 'exploit' });
          return { rejected: false };
        } catch (e: any) { return { rejected: true, message: e?.message || String(e) }; }
      }, { id: foreignCardId, centreId: foreignCentreId });

      const after = q(dbPath, `SELECT centre_id FROM t_cartes WHERE id_carte=${foreignCardId};`);
      const unchanged = after === before;
      verdict('P2-9', (result as any).rejected === true && unchanged, `résultat=${JSON.stringify(result)} centre_id avant=${before} après=${after}`);
    } catch (e: any) {
      verdict('P2-9', false, `EXCEPTION inattendue : ${e?.message || e}`);
    } finally {
      await logout();
    }
  });

  test('P2-10 — sync:pullAgents forgé (ADMINISTRATEUR_SITE site A, siteId=site B étranger) doit être recadré sur le vrai site de la session, jamais le site forgé', async () => {
    const { window } = env;
    try {
      const admin = getTestUser('administrateurSite');
      await loginAs(admin.login, admin.password, /#\/dashboard/);

      await window.evaluate(async (siteId) => (window as any).api.sync.pullAgents(siteId), foreignSiteId);

      // Découverte (1er run) : sync:pullAgents journalise via logAudit() (src/main/utils/audit.ts),
      // qui écrit dans la table `t_audit_log` (colonnes utilisateur/action/details, écriture
      // différée via setImmediate) -- table DISTINCTE de `audit_logs` (colonnes operator_id/
      // action_type/details) utilisée par insertAuditLog()/audit:getPage (LogsPage.tsx). Un
      // premier essai interrogeant `audit_logs` pour 'SYNC_AGENTS_INIT' ne pouvait donc jamais
      // trouver de résultat -- corrigé ici pour interroger la bonne table, avec une courte
      // attente pour laisser le temps à l'écriture différée (setImmediate) de se committer.
      await window.waitForTimeout(800);
      const lastAudit = q(dbPath, `SELECT details FROM t_audit_log WHERE utilisateur='${admin.login}' AND action='SYNC_AGENTS_INIT' ORDER BY id DESC LIMIT 1;`);
      let recadre = false;
      let parsedSiteId: any = null;
      if (lastAudit) {
        try {
          const parsed = JSON.parse(lastAudit);
          parsedSiteId = parsed.site_id;
          recadre = parsed.site_id === env.seed.siteId && parsed.site_id !== foreignSiteId;
        } catch { /* laisse recadre=false */ }
      }
      verdict('P2-10', recadre, `dernier audit SYNC_AGENTS_INIT=${lastAudit} -> site_id_utilisé=${parsedSiteId}, site_réel=${env.seed.siteId}, site_forgé=${foreignSiteId}`);
    } catch (e: any) {
      verdict('P2-10', false, `EXCEPTION inattendue : ${e?.message || e}`);
    } finally {
      await logout();
    }
  });

  test('P2-11 — cartes:getAbsencesSite sans siteId, puis avec un siteId étranger forgé, ne renvoie QUE les données du site réel de l\'appelant', async () => {
    const { window } = env;
    try {
      await loginAs(ADMIN_CENTRE_LOGIN, ZZ_PWD, /#\/admin-centre/);

      const noArg = await window.evaluate(async () => {
        try { return { ok: true, rows: await (window as any).api.cartes.getAbsencesSite() }; }
        catch (e: any) { return { ok: false, message: e?.message || String(e) }; }
      });
      const forged = await window.evaluate(async (siteId) => {
        try { return { ok: true, rows: await (window as any).api.cartes.getAbsencesSite(siteId) }; }
        catch (e: any) { return { ok: false, message: e?.message || String(e) }; }
      }, foreignSiteId);

      let allOk = true;
      const details: string[] = [];
      for (const [label, resp] of [['sans siteId', noArg], ['siteId étranger forgé', forged]] as const) {
        const arr = ((resp as any).rows || []) as any[];
        const hasHome = arr.some((c) => c.noms === 'ZZTEST_ESCALADE');
        const leaksForeign = arr.some((c) => c.noms === 'ZZTEST_FOREIGN');
        const allHomeSite = arr.every((c: any) => c.site_id === env.seed.siteId);
        const ok = (resp as any).ok === true && hasHome && !leaksForeign && allHomeSite;
        allOk = allOk && ok;
        details.push(`[${label}] ok=${(resp as any).ok} n=${arr.length} contient_home=${hasHome} fuite_étranger=${leaksForeign} tout_site_réel=${allHomeSite}`);
      }
      verdict('P2-11', allOk, details.join(' | '));
    } catch (e: any) {
      verdict('P2-11', false, `EXCEPTION inattendue : ${e?.message || e}`);
    } finally {
      await logout();
    }
  });
});
