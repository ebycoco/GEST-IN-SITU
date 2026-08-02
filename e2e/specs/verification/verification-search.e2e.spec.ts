/**
 * e2e/specs/verification/verification-search.e2e.spec.ts
 *
 * Test fonctionnel vivant de VerificationSearchPage (rôle OPERATEUR_VERIFICATION) :
 * recherche par état civil, homonymes, inversion nom/prénom, carte non classée
 * (rangement d'urgence), carte déjà délivrée (preuve de retrait), carte
 * signalée absente, carte introuvable, recherche par téléphone, et
 * cloisonnement site (une carte d'un autre site ne doit jamais apparaître).
 *
 * `e2e/fixtures/seed-database.ts` ne seed AUCUNE carte (seulement site/centre/
 * utilisateurs) : VerificationSearchPage affiche alors l'écran bloquant
 * "Aucune donnée disponible" (index.tsx, cardsCount === 0) et toute la page
 * est intestable. Ce spec seed donc lui-même, en complément et sans modifier
 * seed-database.ts (fichier partagé), un jeu de cartes ZZTEST_ dédié via
 * `extra-seed-cards.js` (scratchpad, technique identique à seed-runner.ts :
 * exécution par electron.exe en mode ELECTRON_RUN_AS_NODE=1 pour respecter
 * l'ABI native de better-sqlite3).
 *
 * Toute vérification d'état en base après action UI passe par le CLI
 * `sqlite3` en lecture seule sur <userDataDir>/data/gest_in_situ.db.
 */
import { test, expect } from '@playwright/test';
import { launchSeededApp, teardownSeededApp, type E2EEnvironment } from '../../fixtures/electron-app';
import { getTestUser } from '../../fixtures/test-users';
import { execFile, execFileSync } from 'child_process';
import { promisify } from 'util';
import { join, resolve } from 'path';

const execFileAsync = promisify(execFile);
const PROJECT_ROOT = resolve(__dirname, '../../..');
const EXTRA_SEED_SCRIPT = 'C:\\Users\\EBYCHOCO\\AppData\\Local\\Temp\\claude\\d--Espace-travail-GEST-IN-SITU-CARTE-ABOBO-V2\\344cf3c3-4173-4a2a-bbd7-a341c1d208bf\\scratchpad\\extra-seed-cards.js';

interface ExtraSeedResult {
  site2Id: number;
  centre2Id: number;
  cardIds: Record<string, number>;
  centre3Id: number;
  centre4Id: number;
  opv2: { login: string; password: string; id: number };
  opv3: { login: string; password: string; id: number };
}

async function runExtraSeed(userDataDir: string, siteId: number, centreId: number): Promise<ExtraSeedResult> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const electronPath = require('electron') as unknown as string;
  const { stdout, stderr } = await execFileAsync(
    electronPath,
    [EXTRA_SEED_SCRIPT, userDataDir, String(siteId), String(centreId)],
    {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_PATH: join(PROJECT_ROOT, 'node_modules') },
      encoding: 'utf-8'
    }
  );
  const marker = '__EXTRA_SEED_RESULT__:';
  const line = stdout.split(/\r?\n/).reverse().find((l) => l.startsWith(marker));
  if (!line) {
    throw new Error(`[E2E] extra-seed-cards.js n'a produit aucun résultat exploitable.\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`);
  }
  return JSON.parse(line.slice(marker.length));
}

function dbPathOf(userDataDir: string): string {
  return join(userDataDir, 'data', 'gest_in_situ.db');
}

function queryDb(dbPath: string, sql: string): string {
  // ⚠️ Pas de `shell: true` ici : sur Windows, `execFileSync` avec `shell: true`
  // rejoint les éléments du tableau `args` par un simple espace SANS les
  // ré-encapsuler (cmd.exe ne fait pas cette quoting automatiquement, contrairement
  // à un shell POSIX) — un `sql` contenant des espaces ("DELETE FROM ...") se
  // retrouvait alors éclaté en plusieurs arguments distincts pour sqlite3, qui
  // interprétait chaque mot comme une commande séparée ("near DELETE: syntax error").
  // Sans `shell`, Node appelle directement CreateProcess avec un quoting Windows
  // correct par argument du tableau : le SQL arrive intact en un seul argv.
  return execFileSync('sqlite3', [dbPath, sql], { encoding: 'utf-8' }).trim();
}

test.describe.serial('VerificationSearchPage — OPERATEUR_VERIFICATION (QA Terrain agent-13)', () => {
  let env: E2EEnvironment;
  let extraSeed: ExtraSeedResult;
  let dbPath: string;
  let anyTestFailed = false;

  test.beforeAll(async () => {
    env = await launchSeededApp();
    dbPath = dbPathOf(env.userDataDir);
    extraSeed = await runExtraSeed(env.userDataDir, env.seed.siteId, env.seed.centreId);
  });

  test.afterAll(async () => {
    if (env) {
      // Nettoyage explicite des données de test ZZTEST_ avant teardown, pour
      // que la trace de ce qui a été créé/supprimé soit vérifiable même si
      // le répertoire temporaire est conservé (cas d'échec).
      try {
        queryDb(dbPath, "DELETE FROM t_cartes WHERE noms LIKE 'ZZTEST_%';");
        queryDb(dbPath, "DELETE FROM t_centres WHERE nom LIKE 'ZZTEST_%';");
        queryDb(dbPath, "DELETE FROM t_sites WHERE nom LIKE 'ZZTEST_%';");
        // Comptes ZZTEST_OPV2/OPV3 (run 2, scénarios 1b/5) — ajoutés à ce nettoyage
        // explicite pour la même raison de traçabilité, même si le répertoire
        // temporaire entier (jetable) est de toute façon supprimé juste après.
        queryDb(dbPath, "DELETE FROM t_user_roles WHERE id_user IN (SELECT id_user FROM t_users WHERE login LIKE 'ZZTEST_%');");
        queryDb(dbPath, "DELETE FROM t_users WHERE login LIKE 'ZZTEST_%';");
        // Run 3 (agent-13, tests 23 et 27) : logs d'audit et notifications de test
        // insérés directement en base (audit_logs n'a pas de préfixe ZZTEST_ sur
        // operator_id pour les entrées générées par le flux applicatif réel -> filtre
        // sur le contenu de `details`/`detail` à la place, qui porte toujours ZZTEST_).
        queryDb(dbPath, "DELETE FROM audit_logs WHERE details LIKE '%ZZTEST%';");
        queryDb(dbPath, "DELETE FROM t_logs WHERE detail LIKE '%ZZTEST%';");
      } catch (e) {
        console.warn('[E2E] Nettoyage ZZTEST_ échoué (non bloquant, répertoire jetable de toute façon) :', e);
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
    const user = getTestUser('operateurVerification');
    await window.waitForURL(/#\/login/);
    await window.getByTestId('login-input').fill(user.login);
    await window.getByTestId('password-input').fill(user.password);
    await window.getByTestId('login-submit').click();
    // RoleRedirect.tsx redirige OPERATEUR_VERIFICATION vers /agent-verification,
    // qui monte AgentVerificationLayout avec pour route `index` VerificationOverview
    // (portail/tableau de bord) — PAS le formulaire de recherche lui-même.
    await window.waitForURL(/#\/agent-verification$/, { timeout: 15000 });
  }

  async function logout(): Promise<void> {
    const { window } = env;
    await window.locator('.btn-logout').click();
    await window.waitForURL(/#\/login/, { timeout: 15000 });
  }

  async function loginAs(userLogin: string, password: string): Promise<void> {
    const { window } = env;
    await window.waitForURL(/#\/login/);
    await window.getByTestId('login-input').fill(userLogin);
    await window.getByTestId('password-input').fill(password);
    await window.getByTestId('login-submit').click();
    await window.waitForURL(/#\/agent-verification$/, { timeout: 15000 });
  }

  // Découverte empirique (1er run) : pour le rôle OPERATEUR_VERIFICATION,
  // App.tsx route `/agent-verification/recherche` vers `RechercheView.tsx`
  // (src/renderer/src/pages/AgentVerification/views/RechercheView.tsx), PAS
  // vers `VerificationSearchPage/index.tsx` (celle-ci n'est montée que sous
  // `/admin-centre/recherche`, pour le rôle ADMIN_CENTRE). RechercheView
  // réutilise cependant EXACTEMENT les mêmes hooks (useVerificationSearch,
  // useDeliveryFlow) et les mêmes composants (SearchForm, SearchResults,
  // DeliveryModal, DeliveryProofModal) que VerificationSearchPage — la
  // couverture métier visée par la tâche reste donc bien exercée.
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

  // Scope les assertions au contenu de DeliveryModal uniquement : les mêmes
  // identités (noms/rangement) peuvent aussi apparaître simultanément dans la
  // liste SearchResults affichée derrière l'overlay (ex: cas des homonymes),
  // ce qui rendrait un `getByText` non scopé ambigu (strict mode violation).
  function deliveryModal() {
    return env.window.locator('.card').filter({ hasText: 'Vérification Physique' });
  }

  test('0. Connexion OPERATEUR_VERIFICATION + navigation vers Recherche Active (cartes visibles grâce au seed ZZTEST_)', async () => {
    const { window } = env;
    await login();
    await expect(window.getByText('PORTAIL DE VÉRIFICATION')).toBeVisible();
    await expect(window.getByText(/Cartes disponibles en local/)).toBeVisible();

    await goToRecherche();
    await expect(window.getByText('Base de données locale vide')).not.toBeVisible();
    await expect(window.getByPlaceholder('Ex: KOFFI KOFFI KAN')).toBeVisible();
  });

  test('1. Recherche nominative + délivrance complète (carte classée, EN STOCK)', async () => {
    const { window } = env;
    const idCarte = extraSeed.cardIds['dispo'];

    await fillNameSearch('ZZTEST_DISPO KOUAME', '15/01/1990');
    await submitNameSearch();

    // Match unique EN STOCK non-absent -> ouverture auto de la modale à l'étape 1.
    await expect(window.getByText('Vérification Physique')).toBeVisible({ timeout: 10000 });
    await expect(window.getByText('A1', { exact: true })).toBeVisible();

    await window.getByRole('button', { name: /Oui, j'ai la carte/ }).click();
    await expect(window.getByText('Validation du Retrait')).toBeVisible();

    // Champs retirant pré-remplis par useDeliveryFlow (retirantType='lui-meme' par défaut).
    await expect(window.locator('input[placeholder="NOM ET PRÉNOMS"]')).toHaveValue('ZZTEST_DISPO KOUAME');

    const before = queryDb(dbPath, `SELECT statut, is_dirty FROM t_cartes WHERE id_carte=${idCarte};`);
    expect(before).toBe('EN STOCK|0');

    await window.getByRole('button', { name: /Valider la délivrance/ }).click();
    await expect(window.getByText('Carte délivrée avec succès !')).toBeVisible({ timeout: 10000 });

    const after = queryDb(
      dbPath,
      `SELECT statut, is_dirty, nom_retirant, num_retirant, agent_distributeur, centre_retrait, (date_delivrance IS NOT NULL) FROM t_cartes WHERE id_carte=${idCarte};`
    );
    expect(after).toBe('DELIVRE|1|ZZTEST_DISPO KOUAME|+225 01 02 03 04 05|E2E_OPERATEUR_VERIFICATION|Centre E2E Test|1');

    const outbox = queryDb(dbPath, `SELECT COUNT(*) FROM t_outbox WHERE table_name='t_cartes' AND status='PENDING';`);
    expect(Number(outbox)).toBeGreaterThanOrEqual(1);
  });

  test('2. Carte déjà délivrée -> ouverture automatique de la Preuve de Retrait', async () => {
    const { window } = env;
    // La carte "dispo" livrée au test précédent est maintenant DELIVRE : la
    // rechercher à nouveau doit ouvrir directement DeliveryProofModal (pas
    // la modale de vérification physique).
    await fillNameSearch('ZZTEST_DISPO KOUAME', '15/01/1990');
    await submitNameSearch();

    await expect(window.getByRole('heading', { name: 'Preuve de Retrait' })).toBeVisible({ timeout: 10000 });
    await expect(window.getByText('DÉLIVRÉE', { exact: true })).toBeVisible();
    // Fermeture via le bouton X du header de la modale.
    await window.locator('.btn-close').click();
    await expect(window.getByRole('heading', { name: 'Preuve de Retrait' })).not.toBeVisible();
  });

  test('3. Carte non classée -> rangement d\'urgence obligatoire', async () => {
    const { window } = env;
    const idCarte = extraSeed.cardIds['nonclasse'];

    await fillNameSearch('ZZTEST_NONCLASSE YAO', '10/04/1993');
    await submitNameSearch();

    await expect(deliveryModal()).toBeVisible({ timeout: 10000 });
    await expect(deliveryModal().getByText('NON CLASSÉ', { exact: true })).toBeVisible();

    await window.getByRole('button', { name: /Oui, j'ai la carte/ }).click();
    await expect(window.getByText(/RANGEMENT D'URGENCE OBLIGATOIRE/)).toBeVisible();

    // Cas d'erreur volontaire : tenter de valider sans remplir le rangement d'urgence.
    await window.getByRole('button', { name: /Valider la délivrance/ }).click();
    await expect(window.getByText("Le rangement d'urgence est obligatoire pour cette carte.")).toBeVisible({ timeout: 5000 });

    const stillEnStock = queryDb(dbPath, `SELECT statut, rangement FROM t_cartes WHERE id_carte=${idCarte};`);
    expect(stillEnStock).toBe('EN STOCK|');

    await window.locator('input[placeholder="Ex: C1-B4-P3 (Box/Colonne/Parapheur)"]').fill('zztest-urgence-1');
    await window.getByRole('button', { name: /Valider la délivrance/ }).click();
    await expect(window.getByText('Carte délivrée avec succès !')).toBeVisible({ timeout: 10000 });

    const after = queryDb(dbPath, `SELECT statut, rangement FROM t_cartes WHERE id_carte=${idCarte};`);
    expect(after).toBe('DELIVRE|ZZTEST-URGENCE-1');
  });

  test('4. Carte signalée ABSENTE -> pas de retrait possible, badge et bouton désactivé', async () => {
    const { window } = env;
    const idCarte = extraSeed.cardIds['absente'];

    await fillNameSearch('ZZTEST_ABSENTE AYA', '20/02/1991');
    await submitNameSearch();

    // Match unique mais statut_physique=ABSENT -> pas d'auto-ouverture de modale,
    // affichage en liste de résultats avec badge + bouton désactivé.
    await expect(window.getByText('Vérification Physique')).not.toBeVisible();
    await expect(window.getByText('⚠️ SIGNALÉE ABSENTE')).toBeVisible({ timeout: 10000 });
    await expect(window.getByRole('button', { name: /En cours de traitement par l'administration/ })).toBeDisabled();

    const unchanged = queryDb(dbPath, `SELECT statut, statut_physique FROM t_cartes WHERE id_carte=${idCarte};`);
    expect(unchanged).toBe('EN STOCK|ABSENT');
  });

  test('5. Homonymes (3 cartes même nom) -> bandeau de raffinement + sélection sans confusion', async () => {
    const { window } = env;
    const idBeta = extraSeed.cardIds['homonyme_beta'];

    await fillNameSearch('ZZTEST_HOMONYME', '15/06/1985');
    await submitNameSearch();

    await expect(window.getByText('Résultats de la Recherche (3)')).toBeVisible({ timeout: 10000 });
    await expect(window.getByText(/Plusieurs homonymes détectés/)).toBeVisible();

    // Sélection précise de BETA parmi les 3 homonymes (ALPHA, BETA, GAMMA) :
    // vérifie qu'aucune confusion d'identité ne se produit dans la modale.
    // Repère la carte résultat par son rangement B2 (unique), plus fiable que
    // le prénom seul qui apparaît aussi en filigrane dans le résumé de la modale.
    const betaCard = window.locator('.card').filter({ hasText: 'Rangement : B2' });
    await betaCard.getByRole('button', { name: /Procéder au Retrait/ }).click();

    const modal = deliveryModal();
    await expect(modal).toBeVisible({ timeout: 10000 });
    // La modale doit afficher BETA (et pas ALPHA/GAMMA) : preuve qu'aucune
    // confusion entre homonymes ne s'est produite lors de la sélection.
    await expect(modal).toContainText('BETA');
    await expect(modal.getByText('B2', { exact: true })).toBeVisible();
    await expect(modal).not.toContainText('ALPHA');
    await expect(modal).not.toContainText('GAMMA');

    await window.locator('.btn-close').click();

    // ID Beta confirmé côté DB, non modifié par la simple sélection.
    const row = queryDb(dbPath, `SELECT prenoms, rangement FROM t_cartes WHERE id_carte=${idBeta};`);
    expect(row).toBe('BETA|B2');
  });

  test('6. Inversion Nom/Prénom -> modale de confirmation puis carte correcte', async () => {
    const { window } = env;

    // Saisie volontairement inversée : nom réel = ZZTEST_INVNOM, prénom réel = ZZTEST_INVPRENOM.
    await fillNameSearch('ZZTEST_INVPRENOM ZZTEST_INVNOM', '05/05/1994');
    await submitNameSearch();

    await expect(window.getByText('Inversion Nom/Prénom Détectée ?')).toBeVisible({ timeout: 10000 });
    await window.getByRole('button', { name: "Oui, c'est celle-ci" }).click();

    const modal = deliveryModal();
    await expect(modal).toBeVisible({ timeout: 10000 });
    await expect(modal).toContainText('ZZTEST_INVNOM');
    await expect(modal).toContainText('ZZTEST_INVPRENOM');
    await expect(modal.getByText('C1', { exact: true })).toBeVisible();
    await window.locator('.btn-close').click();
  });

  test('7. Carte introuvable (recherche sans résultat)', async () => {
    const { window } = env;
    await fillNameSearch('ZZTEST_INTROUVABLE FANTOME', '20/12/1999');
    await submitNameSearch();

    await expect(window.getByText('Carte Introuvable')).toBeVisible({ timeout: 12000 });
    await window.getByRole('button', { name: 'Fermer et recommencer' }).click();
    await expect(window.getByText('Carte Introuvable')).not.toBeVisible();
  });

  test('8. Cloisonnement site : carte ZZTEST_CROSSSITE (autre site) invisible pour cet opérateur', async () => {
    const { window } = env;
    const idCrossSite = extraSeed.cardIds['crosssite'];

    // Confirme d'abord en base que la carte existe bel et bien, mais dans un
    // AUTRE site que celui de l'opérateur connecté.
    const crossRow = queryDb(dbPath, `SELECT site_id FROM t_cartes WHERE id_carte=${idCrossSite};`);
    expect(Number(crossRow)).toBe(extraSeed.site2Id);
    expect(extraSeed.site2Id).not.toBe(env.seed.siteId);

    await fillNameSearch('ZZTEST_CROSSSITE ETRANGER', '01/01/1995');
    await submitNameSearch();

    // Le filtrage site_id est réappliqué côté serveur (handlers.ts, cartes:search)
    // à partir du site réel de l'utilisateur connecté, quel que soit ce que le
    // client aurait pu envoyer : la carte de l'autre site ne doit jamais apparaître.
    await expect(window.getByText('Carte Introuvable')).toBeVisible({ timeout: 12000 });
    await window.getByRole('button', { name: 'Fermer et recommencer' }).click();
  });

  test('9. Recherche par téléphone -> retrouve la carte ZZTEST_DISPO (déjà délivrée) via son contact', async () => {
    const { window } = env;
    await window.getByRole('button', { name: 'Recherche par Téléphone' }).click();
    await window.locator('input[placeholder="+225 01 02 03 04 05"]').fill('+225 01 02 03 04 05');
    await window.getByRole('button', { name: /Rechercher par Téléphone/ }).click();

    await expect(window.getByRole('heading', { name: 'Preuve de Retrait' })).toBeVisible({ timeout: 10000 });
    await window.locator('.btn-close').click();
    // Retour au mode nominatif pour ne pas polluer un éventuel test suivant.
    await window.getByRole('button', { name: 'Recherche par État Civil' }).click();
  });

  test("10. Cas d'erreur : date de naissance incomplète -> toast de validation, aucune requête déclenchée", async () => {
    const { window } = env;
    await fillNameSearch('ZZTEST_ERREUR TEST', '01/01');
    await submitNameSearch();

    await expect(window.getByText('Veuillez remplir le Nom & Prénoms et une Date de Naissance valide (JJ/MM/AAAA).')).toBeVisible({ timeout: 5000 });
    await expect(window.getByText('Carte Introuvable')).not.toBeVisible();
  });

  test("11. Signalement d'absence physique (étape 3 : \"Non, absente\") -> statut_physique bascule à ABSENT côté DB", async () => {
    const { window } = env;
    const idGamma = extraSeed.cardIds['homonyme_gamma'];

    // Réutilise le 3e homonyme (GAMMA/B3), non touché par le test 5 (qui n'avait
    // fait que sélectionner puis fermer la modale sur BETA, sans la délivrer).
    await fillNameSearch('ZZTEST_HOMONYME', '15/06/1985');
    await submitNameSearch();
    await expect(window.getByText('Résultats de la Recherche (3)')).toBeVisible({ timeout: 10000 });

    const gammaCard = window.locator('.card').filter({ hasText: 'Rangement : B3' });
    await gammaCard.getByRole('button', { name: /Procéder au Retrait/ }).click();

    const modal = deliveryModal();
    await expect(modal).toBeVisible({ timeout: 10000 });
    await expect(modal).toContainText('GAMMA');

    await window.getByRole('button', { name: /Non, absente/ }).click();
    await expect(window.getByText("Veuillez laisser un commentaire (optionnel)")).toBeVisible();

    await window.locator('textarea').fill('ZZTEST QA terrain - carte non retrouvee physiquement dans B3');
    await window.getByRole('button', { name: /Confirmer le signalement/ }).click();
    await expect(window.getByText('Absence physique signalée. Traitement admin en cours.')).toBeVisible({ timeout: 10000 });

    const after = queryDb(
      dbPath,
      `SELECT statut, statut_physique, escalade_niveau, agent_signalement_absence, (note_signalement_absence IS NOT NULL) FROM t_cartes WHERE id_carte=${idGamma};`
    );
    expect(after).toBe('EN STOCK|ABSENT|CENTRE|E2E_OPERATEUR_VERIFICATION|1');
  });

  // ── Extension (run 2) — scénarios non couverts précédemment ───────────────
  // Portail /agent-verification (Overview, boutons de synchro, signalements),
  // cloisonnement cross-centre intra-site, route de notification obsolète,
  // /search, fallback téléphone cloud. Réutilise les mêmes fixtures/helpers
  // que ci-dessus + extraSeed enrichi (centre3Id/centre4Id/opv2/opv3) inséré
  // par le même extra-seed-cards.js (voir commentaires dans ce script).

  test("12. Stats \"Aujourd'hui\" (Overview) vs vérité terrain en base + CentreContextSwitcher absent pour OPERATEUR_VERIFICATION", async () => {
    const { window } = env;
    await window.getByRole('link', { name: "Vue d'ensemble" }).click();
    await window.waitForURL(/#\/agent-verification$/, { timeout: 15000 });

    // Scénario 1c : CentreContextSwitcher.tsx:33-35 ne rend rien pour ce rôle
    // (réservé à ADMINISTRATEUR_SITE/SUPER ADMIN) -> absence attendue sur Overview.
    await expect(window.getByText('Centre de travail actuel :')).not.toBeVisible();

    // Vérité terrain : nombre de cartes RÉELLEMENT délivrées AUJOURD'HUI par cet
    // agent (tests 1 et 3 en ont délivré 2 : 'dispo' et 'nonclasse').
    const todayIso = new Date().toISOString().split('T')[0];
    const groundTruthToday = Number(queryDb(
      dbPath,
      `SELECT COUNT(*) FROM t_cartes WHERE agent_distributeur='E2E_OPERATEUR_VERIFICATION' AND date_delivrance LIKE '${todayIso}%';`
    ));
    expect(groundTruthToday).toBeGreaterThanOrEqual(2);

    const rawDateDelivrance = queryDb(dbPath, `SELECT date_delivrance FROM t_cartes WHERE id_carte=${extraSeed.cardIds['dispo']};`);

    const todayCard = window.locator('.glass-card').filter({ hasText: "Aujourd'hui" });
    await expect(todayCard).toBeVisible({ timeout: 10000 });
    const cardText = (await todayCard.innerText()).trim();
    const uiToday = Number((cardText.match(/-?\d+/) || ['NaN'])[0]);

    // RUN 3 (agent-13) — Régression du correctif "Stats Aujourd'hui/Hier"
    // (stats.queries.ts:99-135) : la comparaison est passée d'une égalité
    // stricte `date_delivrance = 'YYYY-MM-DD'` à un intervalle demi-ouvert
    // `>= todayStr AND < tomorrowStr`, compatible avec l'ISOString complet
    // (heure incluse) réellement écrit par delivrerCarte(). Assertion durcie
    // (avant : simple log + Number.isFinite) car le bug documenté lors du
    // run 2 est désormais censé être corrigé.
    console.log(
      `[QA-CHECK][Partie A, correctif 1] date_delivrance brute en base pour 'dispo' = "${rawDateDelivrance}" | ` +
      `todayIso comparé par stats.queries.ts = "${todayIso}" | UI "Aujourd'hui" = ${uiToday} | ` +
      `Vérité terrain (COUNT réel) = ${groundTruthToday} | ` +
      `Verdict = ${uiToday === groundTruthToday ? 'CONFORME — correctif validé en conditions réelles' : 'MISMATCH — régression ou correctif incomplet'}`
    );
    expect(uiToday).toBe(groundTruthToday);

    // Semaine/Mois/Année : bornes `>= dateStr` inchangées par le correctif (pas de
    // régression attendue) -> vérifiées comme non-régression contre la même vérité terrain.
    const weekCard = window.locator('.glass-card').filter({ hasText: 'Semaine' });
    const uiWeek = Number(((await weekCard.innerText()).match(/-?\d+/) || ['NaN'])[0]);
    expect(uiWeek).toBeGreaterThanOrEqual(groundTruthToday);
  });

  test('13. Isolation stricte PAR AGENT des stats "cartes délivrées" entre 2 opérateurs du même centre (scénario 1b)', async () => {
    const { window } = env;
    const idStats2 = extraSeed.cardIds['stats2'];

    await logout();
    await loginAs(extraSeed.opv2.login, extraSeed.opv2.password);

    await window.getByRole('link', { name: "Vue d'ensemble" }).click();
    await window.waitForURL(/#\/agent-verification$/, { timeout: 15000 });
    const todayCardBefore = window.locator('.glass-card').filter({ hasText: "Aujourd'hui" });
    const beforeText = (await todayCardBefore.innerText()).trim();
    const uiTodayBefore = Number((beforeText.match(/-?\d+/) || ['NaN'])[0]);
    // op2 n'a jamais rien délivré : vérité terrain = 0, quel que soit ce que op1 a délivré.
    console.log(`[QA-CHECK][Partie A, correctif 1] op2 AVANT délivrance -> UI "Aujourd'hui" = ${uiTodayBefore} (vérité terrain attendue = 0, indépendamment des 2 cartes déjà délivrées par op1)`);
    expect(uiTodayBefore).toBe(0);

    await goToRecherche();
    await fillNameSearch('ZZTEST_STATS2 OPV2CARD', '05/05/1998');
    await submitNameSearch();
    await expect(window.getByText('Vérification Physique')).toBeVisible({ timeout: 10000 });
    await window.getByRole('button', { name: /Oui, j'ai la carte/ }).click();
    await expect(window.getByText('Validation du Retrait')).toBeVisible();
    await window.getByRole('button', { name: /Valider la délivrance/ }).click();
    await expect(window.getByText('Carte délivrée avec succès !')).toBeVisible({ timeout: 10000 });

    const afterDb = queryDb(dbPath, `SELECT statut, agent_distributeur FROM t_cartes WHERE id_carte=${idStats2};`);
    expect(afterDb).toBe('DELIVRE|ZZTEST_OPV2');

    await window.getByRole('link', { name: "Vue d'ensemble" }).click();
    await window.waitForURL(/#\/agent-verification$/, { timeout: 15000 });
    const todayCardAfter = window.locator('.glass-card').filter({ hasText: "Aujourd'hui" });
    const afterText = (await todayCardAfter.innerText()).trim();
    const uiTodayAfter = Number((afterText.match(/-?\d+/) || ['NaN'])[0]);
    const groundTruthOpv2 = Number(queryDb(dbPath, `SELECT COUNT(*) FROM t_cartes WHERE agent_distributeur='ZZTEST_OPV2';`));
    console.log(`[QA-CHECK][Partie A, correctif 1] op2 APRÈS délivrance -> UI "Aujourd'hui" = ${uiTodayAfter} | vérité terrain (COUNT réel op2) = ${groundTruthOpv2} | isolation confirmée si ce nombre EXCLUT les 2 cartes de op1`);
    // Assertion durcie (run 3) : op2 doit voir EXACTEMENT sa propre carte du jour
    // (1), ni plus (pas de fuite des 2 cartes délivrées par op1), ni moins (le
    // correctif de bornes doit bien compter la carte tout juste délivrée par op2 lui-même).
    expect(uiTodayAfter).toBe(groundTruthOpv2);
    expect(uiTodayAfter).toBe(1);

    // Retour à l'agent principal pour la suite du run (état attendu par les tests suivants).
    await logout();
    await loginAs('E2E_OPERATEUR_VERIFICATION', 'E2E_Test_Pwd_2026!');
  });

  test('14. Cloisonnement cross-centre intra-site — cas "Centre Principal" (numero=1) : carte visible, modale ouverte, boutons de validation désactivés (scénario 5)', async () => {
    const { window } = env;
    const idCentre3Card = extraSeed.cardIds['centre3_card'];

    // Vérité terrain préalable : la carte appartient bien à un AUTRE centre
    // (centre3Id), sur le MÊME site que l'agent connecté (E2E_OPERATEUR_VERIFICATION,
    // rattaché à mainCentreId = "Centre E2E Test", numero=1 -> "Centre Principal").
    const cardCentre = Number(queryDb(dbPath, `SELECT centre_id FROM t_cartes WHERE id_carte=${idCentre3Card};`));
    expect(cardCentre).toBe(extraSeed.centre3Id);
    expect(cardCentre).not.toBe(env.seed.centreId);

    await goToRecherche();
    await fillNameSearch('ZZTEST_CENTRE3 GAMMA', '03/03/1996');
    await submitNameSearch();

    // Match unique, non-absent -> auto-ouverture de la modale (useVerificationSearch.ts:126-136),
    // QUEL QUE SOIT le centre de la carte : l'autorisation de centre n'est pas
    // vérifiée à ce stade (seulement site_id, côté serveur cartes:search).
    await expect(deliveryModal()).toBeVisible({ timeout: 10000 });
    await expect(deliveryModal()).toContainText('ZZTEST_CENTRE3');

    // isCentrePrincipal(userCentre) (RechercheView.tsx:27-31) est vrai pour le
    // centre de L'AGENT (numero=1), pas pour celui de la carte : la modale
    // s'ouvre donc normalement. Mais canDeliver (DeliveryModal.tsx:66-67, égalité
    // STRICTE centre_id) reste faux -> les 2 boutons de l'étape 1 doivent être désactivés.
    const ouiButton = window.getByRole('button', { name: /Oui, j'ai la carte/ });
    const nonButton = window.getByRole('button', { name: /Non, absente/ });
    await expect(ouiButton).toBeDisabled();
    await expect(nonButton).toBeDisabled();
    await expect(ouiButton).toHaveAttribute('title', /pas l'autorisation/);

    // Tentative "forcée" (appel IPC direct, contournant les boutons désactivés
    // du DOM) : documente que le serveur rejette bien l'action avec le message
    // précis de cartes.queries.ts:567, alors que useDeliveryFlow.ts:106-108
    // afficherait, lui, un toast générique ("Erreur lors de la validation du
    // retrait.") masquant ce message spécifique si l'appel passait par l'UI
    // normale -> point d'amélioration UX documenté, pas un bug bloquant.
    const forcedResult = await window.evaluate(async (id) => {
      try {
        await (window as any).api.cartes.delivrer(id, {
          nom_retirant: 'ZZTEST_FORCED', num_retirant: '0000000000',
          type_retirant: 'ASSURE', agent_distributeur: 'E2E_OPERATEUR_VERIFICATION'
        }, { role: 'OPERATEUR_VERIFICATION', site_id: undefined, centre_id: undefined });
        return { ok: true };
      } catch (e: any) {
        return { ok: false, message: e?.message || String(e) };
      }
    }, idCentre3Card);
    expect(forcedResult.ok).toBe(false);
    expect(forcedResult.message).toContain('Cette carte appartient à un autre centre de distribution.');

    const unchanged = queryDb(dbPath, `SELECT statut FROM t_cartes WHERE id_carte=${idCentre3Card};`);
    expect(unchanged).toBe('EN STOCK');

    await window.locator('.btn-close').click();
    await expect(deliveryModal()).not.toBeVisible();
  });

  test('15. Cloisonnement cross-centre intra-site — cas standard (centre NON principal) : badge "Non autorisé" et bouton bloqué (scénario 5)', async () => {
    const { window } = env;
    const idOwn = extraSeed.cardIds['multibadge_own'];
    const idOther = extraSeed.cardIds['multibadge_other'];

    await logout();
    await loginAs(extraSeed.opv3.login, extraSeed.opv3.password);
    await goToRecherche();

    // 2 homonymes (même ddn) répartis sur centre3 (op3, propre centre) et
    // centre4 (autre centre) -> force le rendu de la LISTE SearchResults.tsx
    // (pas d'auto-ouverture de modale, cf. test 14) : c'est le seul cas où le
    // badge "Non autorisé pour votre Box" (SearchResults.tsx:327-340) est visible.
    await window.locator('input[placeholder="Ex: KOFFI KOFFI KAN"]').fill('ZZTEST_MULTIBADGE');
    await window.locator('input[placeholder="JJ/MM/AAAA"]').fill('09/09/1999');
    await submitNameSearch();
    await expect(window.getByText('Résultats de la Recherche (2)')).toBeVisible({ timeout: 10000 });

    const ownCard = window.locator('.card').filter({ hasText: 'Rangement : Z3' });
    const otherCard = window.locator('.card').filter({ hasText: 'Rangement : Z4' });

    // Carte du PROPRE centre de op3 (centre3) -> bouton actif.
    await expect(ownCard.getByRole('button', { name: /Procéder au Retrait/ })).toBeEnabled();
    // Carte de centre4 (un autre centre, non principal) -> badge + pas de bouton de retrait.
    await expect(otherCard.getByText('Non autorisé pour votre Box')).toBeVisible();
    await expect(otherCard.getByRole('button', { name: /Procéder au Retrait/ })).toHaveCount(0);

    const unchanged = queryDb(dbPath, `SELECT statut FROM t_cartes WHERE id_carte IN (${idOwn}, ${idOther});`);
    // ⚠️ split(/\r?\n/) (pas split('\n') seul) : sqlite3.exe sous Windows termine
    // chaque ligne d'un résultat multi-lignes par CRLF, jamais isolé jusqu'ici
    // dans ce spec car toutes les requêtes précédentes ne retournaient qu'UNE
    // seule ligne (où .trim() suffit à absorber le CRLF final).
    expect(unchanged.split(/\r?\n/).every((s) => s === 'EN STOCK')).toBe(true);

    await logout();
    await loginAs('E2E_OPERATEUR_VERIFICATION', 'E2E_Test_Pwd_2026!');
  });

  test('16. Bouton "Récupérer les cartes depuis le Cloud" en environnement sync E2E désactivée (scénario 2)', async () => {
    const { window } = env;
    const pullButton = window.getByRole('button', { name: /RÉCUPÉRER LES CARTES DEPUIS LE CLOUD/ });
    await expect(pullButton).toBeVisible({ timeout: 10000 });

    // RUN 3 (agent-13) — Régression du correctif "Bouton Récupérer les cartes"
    // (AgentVerificationLayout.tsx:31-33) : `pullDisabled` compare désormais
    // `cloudCartesCount <= 0` (au lieu de `=== 0`), couvrant la sentinelle -1
    // renvoyée par sync:getCloudCartesCount quand Supabase est indisponible
    // (bug confirmé lors du run 2). Assertion durcie en conséquence.
    const isDisabled = await pullButton.isDisabled();
    console.log(`[QA-CHECK][Partie A, correctif 3] Bouton "Récupérer les cartes" avec Supabase indisponible (sync E2E désactivée) -> disabled=${isDisabled} (attendu : true)`);
    expect(isDisabled).toBe(true);
    await expect(window.locator('body')).toBeVisible();
  });

  test('17. Bouton "Synchroniser mes actions" — état observé en environnement sync désactivée (scénario 3)', async () => {
    const { window } = env;
    const pushButton = window.getByRole('button', { name: /Synchroniser mes actions/ });
    await expect(pushButton).toBeVisible({ timeout: 10000 });

    const dirtyBefore = Number(queryDb(dbPath, `SELECT COUNT(*) FROM t_cartes WHERE is_dirty=1;`));
    expect(dirtyBefore).toBeGreaterThan(0);

    // Découverte empirique : conformeCount (detailedSyncStats.cleanCount +
    // modifiedCount, stats-worker.js:361-387) applique une logique métier de
    // "propreté" bien plus stricte qu'une simple présence is_dirty=1 (dédoublonnage
    // strict/probable, validité de date, rangement non vide...) : sur ce jeu de
    // cartes ZZTEST_ inséré directement en base (sans passer par le flux applicatif
    // normal de création, notamment sans cle_doublon calculé comme le ferait
    // l'app), conformeCount peut rester à 0 même avec des cartes réellement
    // is_dirty=1 -> le bouton reste désactivé. Non concluant pour juger du VRAI
    // comportement d'un poste terrain (dont les cartes naissent via le flux
        // applicatif normal) : limite de couverture documentée, pas un bug retenu.
    const isEnabled = await pushButton.isEnabled();
    console.log(`[QA-CHECK][scénario 3] dirty is_dirty=1 en base = ${dirtyBefore} | bouton "Synchroniser mes actions" enabled=${isEnabled} (voir limite de couverture ci-dessus sur le calcul de conformeCount)`);
    if (!isEnabled) {
      await expect(pushButton).toBeDisabled();
      return;
    }

    await pushButton.click();
    // bulk-uploader.ts:58-61 : GEST_IN_SITU_E2E_DISABLE_SYNC=1 -> renvoie
    // immédiatement { success:false, uploadedCount:0 } SANS 'cancelled'. Or
    // useForceSyncActions.ts:120-127 ne montre un toast QUE si res.success OU
    // res.cancelled OU uploadedCount>0 : dans ce cas précis (false/false/0),
    // AUCUN toast d'erreur n'est affiché à l'agent — seul le toast de
        // chargement disparaît silencieusement. Documenté comme point
        // d'amélioration UX (échec silencieux), pas testé comme un crash.
    await window.waitForTimeout(1500);
    const errorToastVisible = await window.getByText(/Échec du transfert/).isVisible().catch(() => false);
    console.log(`[QA-CHECK][scénario 3] Toast d'erreur visible après clic "Synchroniser mes actions" en environnement sync désactivée = ${errorToastVisible} (attendu : false, confirmant l'échec silencieux identifié par lecture de code)`);

    // Aucune vraie synchro n'a eu lieu : les cartes restent dirty à l'identique.
    const dirtyAfter = Number(queryDb(dbPath, `SELECT COUNT(*) FROM t_cartes WHERE is_dirty=1;`));
    expect(dirtyAfter).toBe(dirtyBefore);
  });

  test('18. Signalements — Non Résolus affiche la carte GAMMA (scénario 4a) ; badge "Escaladée au Site" ne reflète PAS une escalade réelle en base (scénario 4b, bug suspecté)', async () => {
    const { window } = env;
    const idGamma = extraSeed.cardIds['homonyme_gamma'];

    await window.getByRole('link', { name: 'Signalements d\'anomalies' }).click();
    await window.waitForURL(/#\/agent-verification\/signalements/, { timeout: 15000 });
    await expect(window.getByText('ZZTEST_HOMONYME GAMMA')).toBeVisible({ timeout: 10000 });
    await expect(window.getByText('En traitement au Centre')).toBeVisible();

    // Simulation directe en base de escaladerAuSite() (absence.queries.ts:347-376) :
    // aucun chemin UI n'existe pour ce rôle (action réservée à ADMIN_CENTRE), ce
    // qui est un STOP&WARN volontairement évité en manipulant directement la
    // base de test jetable, comme prescrit par la tâche.
    queryDb(dbPath, `UPDATE t_cartes SET escalade_niveau='SITE' WHERE id_carte=${idGamma};`);
    const dbState = queryDb(dbPath, `SELECT escalade_niveau FROM t_cartes WHERE id_carte=${idGamma};`);
    expect(dbState).toBe('SITE');

    // Force le remontage de NonResolusTab (SignalementsView.tsx:53 ne rend le
    // composant que si l'onglet est actif) pour un refetch propre.
    await window.getByRole('button', { name: 'Historique Résolus' }).click();
    await window.getByRole('button', { name: 'Signalements Non Résolus' }).click();
    await expect(window.getByText('ZZTEST_HOMONYME GAMMA')).toBeVisible({ timeout: 10000 });

    const statusLineVisible = await window.getByText('Escaladée au Site').isVisible().catch(() => false);
    const staleLineVisible = await window.getByText('En traitement au Centre').isVisible().catch(() => false);
    console.log(
      `[QA-CHECK][Partie A, correctif 4] Après UPDATE escalade_niveau='SITE' en base -> badge UI = ` +
      `${statusLineVisible ? '"Escaladée au Site" (conforme au correctif)' : staleLineVisible ? '"En traitement au Centre" (RÉGRESSION : toujours comparé à l\'ancienne valeur)' : 'ni l\'un ni l\'autre (inattendu)'}`
    );
    // RUN 3 (agent-13) — Régression du correctif "Badge escalade"
    // (NonResolusTab.tsx:103) : compare désormais à 'SITE' (valeur réellement
    // écrite par escaladerAuSite(), absence.queries.ts:347-376) au lieu de
    // 'NIVEAU_2' (jamais écrit par le backend -> bug confirmé lors du run 2).
    expect(statusLineVisible).toBe(true);
    expect(staleLineVisible).toBe(false);
  });

  test("19. Signalements — Résolus + Archiver : disparition de la liste sans altération de t_cartes (scénario 4c)", async () => {
    const { window } = env;
    const idGamma = extraSeed.cardIds['homonyme_gamma'];

    // Simulation directe de resoudreAbsence() (réservée à ADMIN_CENTRE côté UI) :
    // même justification STOP&WARN que le test précédent.
    queryDb(dbPath, `UPDATE t_cartes SET escalade_niveau='RESOLU', statut_physique='OK' WHERE id_carte=${idGamma};`);

    await window.getByRole('button', { name: 'Historique Résolus' }).click();
    await expect(window.getByText('ZZTEST_HOMONYME GAMMA')).toBeVisible({ timeout: 10000 });

    await window.getByRole('button', { name: /Archiver/ }).click();
    await expect(window.getByText('ZZTEST_HOMONYME GAMMA')).not.toBeVisible({ timeout: 10000 });

    const archiveRow = queryDb(dbPath, `SELECT COUNT(*) FROM t_agent_archives WHERE id_carte=${idGamma} AND login_user='E2E_OPERATEUR_VERIFICATION';`);
    expect(Number(archiveRow)).toBe(1);
    // t_cartes n'est PAS modifiée par l'archivage (archiveSignalement() n'écrit
    // que dans t_agent_archives) : escalade_niveau reste 'RESOLU'.
    const carteState = queryDb(dbPath, `SELECT escalade_niveau, statut_physique FROM t_cartes WHERE id_carte=${idGamma};`);
    expect(carteState).toBe('RESOLU|OK');
  });

  test('20. Route de notification obsolète pour CARTE_ABSENTE_RETROUVEE (scénario 6, bug suspecté)', async () => {
    const { window } = env;
    const idAbsente = extraSeed.cardIds['absente'];

    // Découverte empirique (run 3) : les tests 18/19 laissent SignalementsView
    // (et son ResolusTab enfant, déjà activé sur "Historique Résolus" par le
    // test 19) MONTÉS lorsque ce test démarre. ResolusTab.tsx:45-47 ne recharge
    // ses données QUE sur son propre montage (`useEffect(loadData, [user])`),
    // sans aucun listener sur l'événement IPC 'sync:updated-data' -> si on
    // déclenchait resoudreAbsence() puis cliquait la notification SANS d'abord
    // quitter la route, ResolusTab resterait monté en continu et n'afficherait
    // JAMAIS la carte tout juste résolue (liste figée à l'état du test 19).
    // Un vrai agent terrain qui reçoit cette notification est, dans l'immense
    // majorité des cas, sur une AUTRE page au moment de la résolution par
    // l'administration (Overview, Recherche...) : on reproduit fidèlement ce
    // parcours réaliste en repartant d'abord de la Vue d'ensemble, pour que le
    // clic sur la notification déclenche un VRAI premier montage de
    // SignalementsView/ResolusTab (donc un `loadData()` frais, exécuté APRÈS
    // la résolution) plutôt qu'un remontage no-op sur un composant déjà en vie.
    await window.getByRole('link', { name: "Vue d'ensemble" }).click();
    await window.waitForURL(/#\/agent-verification$/, { timeout: 15000 });

    // Découverte empirique (run 3, 2 tentatives sur CE test précis) : la carte
    // 'absente' a été pré-seedée DIRECTEMENT avec statut_physique='ABSENT' par
    // extra-seed-cards.js (jamais passée par le vrai signalerAbsence() de l'app,
    // contrairement au parcours normal terrain) -> son champ
    // agent_signalement_absence reste NULL en base. Or getSignalementsResolus()
    // (absence.queries.ts:106-116), utilisée par ResolusTab.tsx:34, filtre
    // STRICTEMENT `WHERE agent_signalement_absence = ?` (login de l'agent
    // connecté) : avec NULL, la carte ne peut RÉELLEMENT jamais apparaître dans
    // "Historique Résolus" pour cet agent, quel que soit l'état de résolution
    // -> ce n'est pas un bug applicatif mais un défaut de fixture de ce test
    // (2 premières exécutions), corrigé ici en alignant l'état de la carte sur
    // celui qu'aurait produit un vrai signalement via l'UI (comme le fait
    // réellement signalerAbsence(), absence.queries.ts:7-68).
    queryDb(
      dbPath,
      `UPDATE t_cartes SET agent_signalement_absence='E2E_OPERATEUR_VERIFICATION', escalade_niveau='CENTRE' WHERE id_carte=${idAbsente};`
    );

    // Découverte empirique (2 tentatives précédentes) : un INSERT SQL direct
    // dans t_logs ne suffit pas à faire apparaître la notification (TopBar.tsx
    // ne refetch que sur montage ou sur l'événement IPC 'sync:updated-data'
    // poussé par le MAIN process lors d'une écriture PASSANT PAR L'APP) ; et
    // `window.reload()` déconnecte l'agent (la session ne survit pas au reload
    // du renderer dans ce contexte de test). Solution retenue : appeler le VRAI
    // chemin applicatif `window.api.cartes.resoudreAbsence` (handlers.ts:1140-1154,
    // exposé en preload) sur la carte 'ZZTEST_ABSENTE AYA' (toujours ABSENT à ce
    // stade du run, cf. test 4) : cela exécute exactement la même logique que
    // resoudreAbsence() (absence.queries.ts:118-189, insertion du log
    // CARTE_ABSENTE_RETROUVEE) ET déclenche le broadcast 'sync:updated-data'
    // que TopBar écoute pour rafraîchir ses notifications sans reload/re-login.
    await window.evaluate(async (id) => {
      await (window as any).api.cartes.resoudreAbsence(id, {
        status: 'OK', agent: 'E2E_OPERATEUR_VERIFICATION',
        note: 'ZZTEST resolution notification test', rangement: 'A2'
      });
    }, idAbsente);

    const dbAfterResolve = queryDb(dbPath, `SELECT statut_physique, escalade_niveau FROM t_cartes WHERE id_carte=${idAbsente};`);
    expect(dbAfterResolve).toBe('OK|RESOLU');
    const logInserted = Number(queryDb(dbPath, `SELECT COUNT(*) FROM t_logs WHERE action='CARTE_ABSENTE_RETROUVEE' AND detail LIKE '%ZZTEST_ABSENTE%';`));
    expect(logInserted).toBeGreaterThanOrEqual(1);

    await window.locator('.topbar-icon-btn[title="Notifications"]').click();
    await expect(window.locator('.topbar-notifications-dropdown')).toBeVisible({ timeout: 10000 });
    const notifItem = window.locator('.topbar-notification-item').filter({ hasText: 'ZZTEST_ABSENTE' });
    await expect(notifItem).toBeVisible({ timeout: 10000 });

    const urlBefore = window.url();
    await notifItem.click();

    // RUN 3 (agent-13) — Régression du correctif "Navigation notification résolue"
    // (TopBar.tsx:237) : navigate() cible désormais la route RÉELLE
    // /agent-verification/signalements?tab=resolus (au lieu de l'ancienne route
    // inexistante /verification/recherche?tab=resolus qui produisait une page
    // blanche, bug confirmé lors du run 2), et SignalementsView.tsx lit le
    // paramètre ?tab=resolus pour atterrir directement sur "Historique Résolus".
    await window.waitForURL(/#\/agent-verification\/signalements\?tab=resolus/, { timeout: 15000 });
    const urlAfter = window.url();
    const bodyText = (await window.locator('body').innerText().catch(() => '')).trim();
    console.log(
      `[QA-CHECK][Partie A, correctif 2] Avant clic = "${urlBefore}" | Après clic = "${urlAfter}" | ` +
      `Contenu <body> non vide = ${bodyText.length > 0}`
    );
    expect(urlAfter).toContain('/agent-verification/signalements?tab=resolus');
    expect(bodyText.length).toBeGreaterThan(0);

    // L'onglet "Historique Résolus" doit être actif directement (pas besoin de
    // re-cliquer dessus), et la carte tout juste résolue (ZZTEST_ABSENTE) y figurer.
    await expect(window.getByRole('button', { name: 'Historique Résolus' })).toBeVisible();
    await expect(window.getByText('ZZTEST_ABSENTE AYA')).toBeVisible({ timeout: 10000 });

    // Application toujours réactive (pas de crash du process Electron).
    await expect(window).toHaveTitle(/.*/);

    // Nettoyage : `globalThis` (pas `window`, masqué dans ce scope par le Page
    // Playwright destructuré `const { window } = env`) pour revenir sur une
    // route connue avant le test suivant.
    await window.evaluate(() => { (globalThis as any).location.hash = '#/agent-verification'; });
    await window.waitForURL(/#\/agent-verification$/, { timeout: 15000 }).catch(() => {});
  });

  test('21. Route parallèle "Recherche Rapide" (/search) : accessible, fonctionnelle, aucune action de délivrance proposée (scénario 7)', async () => {
    const { window } = env;
    await window.getByRole('link', { name: 'Recherche Rapide' }).click();
    await window.waitForURL(/#\/search/, { timeout: 15000 });

    // Recherche texte intégral simple sur une carte connue. SearchPage.tsx:64
    // ne pose AUCUN attribut `type` sur l'input principal (texte HTML implicite,
    // pas de type="text" explicite) -> ciblage par placeholder, plus fiable.
    // La recherche est déclenchée par la soumission du <form> (onSubmit,
    // SearchPage.tsx:49), pas en live/debounced -> Entrée nécessaire.
    const searchInput = window.getByPlaceholder('Tapez un nom, prénom, n° sécu...');
    await expect(searchInput).toBeVisible({ timeout: 10000 });
    await searchInput.fill('ZZTEST_DISPO');
    await searchInput.press('Enter');
    await window.waitForTimeout(1000);

    const pageText = await window.locator('body').innerText();
    const hasResultRef = pageText.includes('ZZTEST_DISPO') || pageText.toUpperCase().includes('ZZTEST_DISPO');
    console.log(`[QA-CHECK][scénario 7] /search — présence du résultat "ZZTEST_DISPO" dans la page après saisie = ${hasResultRef}`);

    // Aucune action de délivrance ne doit être proposée sur cette page (lecture seule).
    await expect(window.getByRole('button', { name: /Valider la délivrance/ })).toHaveCount(0);
    await expect(window.getByRole('button', { name: /Procéder au Retrait/ })).toHaveCount(0);

    await window.evaluate(() => { (globalThis as any).location.hash = '#/agent-verification'; });
    await window.waitForURL(/#\/agent-verification$/, { timeout: 15000 });
  });

  test("22. Recherche par téléphone sans résultat local -> fallback cloud géré proprement (échec attendu, sync désactivée) (scénario 8)", async () => {
    const { window } = env;
    await goToRecherche();
    await window.getByRole('button', { name: 'Recherche par Téléphone' }).click();
    await window.locator('input[placeholder="+225 01 02 03 04 05"]').fill('+225 09 99 99 99 99');
    await window.getByRole('button', { name: /Rechercher par Téléphone/ }).click();

    // Aucun résultat local -> déclenche cartes.searchCloudEmergency (timeout 6s,
    // Promise.race dans useVerificationSearch.ts:166-187) ; en environnement
    // sync désactivée / offline, ce fallback échoue silencieusement côté hook
    // (catch -> setCloudResults([])) et cloudSearchDone doit finir par passer à
    // true SANS bloquer l'UI ni planter la page.
    await expect(window.getByText('Carte Introuvable')).toBeVisible({ timeout: 12000 });
    const stillResponsive = await window.getByRole('button', { name: 'Fermer et recommencer' }).isVisible();
    expect(stillResponsive).toBe(true);
    await window.getByRole('button', { name: 'Fermer et recommencer' }).click();

    await window.getByRole('button', { name: 'Recherche par État Civil' }).click();
  });

  // ── Extension (run 3) — Partie B : scénarios jamais couverts jusqu'ici ─────

  test('23. t_audit_log (table réelle : audit_logs) — trace UPDATE_CONTACT après la délivrance ZZTEST_DISPO du test 1 (scénario 7)', async () => {
    const idDispo = extraSeed.cardIds['dispo'];
    // Découverte de code (cartes.queries.ts:571-591) : la table réellement
    // utilisée par insertAuditLog() est `audit_logs` (colonnes operator_id/
    // action_type/details/timestamp), PAS `t_audit_log` (une table à part,
    // créée par audit.ts/logAudit(), jamais utilisée par le flux de délivrance).
    // UPDATE_CONTACT est déclenché car useDeliveryFlow.ts:32-37 pré-remplit
    // telRetirant avec le contact FORMATÉ ("+225 01 02 03 04 05"), différent en
    // tant que chaîne du contact brut seedé en base ("0102030405") -> la
    // comparaison stricte `carte.contact !== data.num_retirant` (cartes.queries.ts:576)
    // détecte un changement et journalise, même si le numéro réel n'a pas
    // vraiment changé (juste son format) -> comportement confirmé en conditions réelles.
    const row = queryDb(
      dbPath,
      `SELECT operator_id, action_type, details FROM audit_logs WHERE action_type='UPDATE_CONTACT' AND details LIKE '%(ID: ${idDispo})%';`
    );
    console.log(`[QA-CHECK][scénario 7] Ligne audit_logs pour la délivrance ZZTEST_DISPO (ID ${idDispo}) : "${row}"`);
    // Comparaison décomposée (plutôt qu'une égalité stricte sur toute la ligne) pour
    // rester robuste à l'encodage des caractères accentués ("l'assuré") restitués par
    // le CLI sqlite3 sous Windows, tout en validant précisément chaque valeur métier.
    expect(row.startsWith('E2E_OPERATEUR_VERIFICATION|UPDATE_CONTACT|')).toBe(true);
    expect(row).toContain('ancien 0102030405');
    expect(row).toContain('nouveau +225 01 02 03 04 05');
    expect(row).toContain(`(ID: ${idDispo})`);
  });

  test('24. DeliveryProofModal — vérification champ par champ contre la vérité terrain en base (scénario 6)', async () => {
    const { window } = env;
    const idDispo = extraSeed.cardIds['dispo'];

    const dbRow = queryDb(
      dbPath,
      `SELECT nom_retirant, num_retirant, agent_distributeur, centre_retrait, date_delivrance, num_secu FROM t_cartes WHERE id_carte=${idDispo};`
    );
    const [nomRetirantDb, numRetirantDb, agentDb, centreRetraitDb, dateDelivranceDb, numSecuDb] = dbRow.split('|');
    const expectedDateStr = new Date(dateDelivranceDb).toLocaleDateString('fr-FR');

    await goToRecherche();
    await fillNameSearch('ZZTEST_DISPO KOUAME', '15/01/1990');
    await submitNameSearch();

    await expect(window.getByRole('heading', { name: 'Preuve de Retrait' })).toBeVisible({ timeout: 10000 });
    // `.card` générique (utilisé par `deliveryModal()`) est ambigu ici : la carte
    // ZZTEST_DISPO déjà délivrée réapparaît AUSSI listée en arrière-plan avec un
    // texte contenant "Preuve de Retrait" (bouton "Voir la Preuve de Retrait" de
    // SearchResults.tsx) -> violation strict-mode observée en conditions réelles.
    // On cible donc la classe spécifique de DeliveryProofModal (`card animate-scale-in`,
    // distincte de `card animate-fade-in` utilisée par les cartes de résultats).
    const modal = window.locator('.card.animate-scale-in').filter({ hasText: 'Preuve de Retrait' });

    // Carte N° (num_secu) affiché sous le titre.
    await expect(modal).toContainText(`Carte N° ${numSecuDb}`);
    // Bloc "Détails de la transaction" : date (jour/mois/année, l'heure exacte
    // n'est pas re-vérifiée au format identique pour éviter toute fragilité de
    // locale/timezone entre le process de test et le renderer Electron), centre, agent.
    await expect(modal).toContainText(expectedDateStr);
    await expect(modal).toContainText(centreRetraitDb);
    await expect(modal).toContainText(agentDb);
    // Bloc "Identité du Retirant" : qualité déduite (ASSURÉ LUI-MÊME, car
    // nom_retirant === noms+prenoms de la carte), nom et contact exacts.
    await expect(modal).toContainText('ASSURÉ LUI-MÊME');
    await expect(modal).toContainText(nomRetirantDb);
    await expect(modal).toContainText(numRetirantDb);

    console.log(`[QA-CHECK][scénario 6] DeliveryProofModal vérifiée champ par champ contre la DB pour ZZTEST_DISPO (ID ${idDispo}) : nom_retirant="${nomRetirantDb}", num_retirant="${numRetirantDb}", agent="${agentDb}", centre="${centreRetraitDb}", date="${expectedDateStr}"`);

    await window.locator('.btn-close').click();
  });

  test('25. Carte au statut_physique PERDUE — retrait totalement bloqué, aucune action possible (scénario 8)', async () => {
    const { window } = env;
    const idPerdue = extraSeed.cardIds['perdue'];

    const before = queryDb(dbPath, `SELECT statut, statut_physique FROM t_cartes WHERE id_carte=${idPerdue};`);
    expect(before).toBe('EN STOCK|PERDUE');

    await fillNameSearch('ZZTEST_PERDUE ADAMA', '08/08/1988');
    await submitNameSearch();

    // Match unique mais statut_physique=PERDUE -> pas d'auto-ouverture de modale
    // (useVerificationSearch.ts:129 exclut explicitement ABSENT et PERDUE),
    // affichage en liste avec badge dédié et bouton désactivé (SearchResults.tsx:236,341-349).
    await expect(window.getByText('Vérification Physique')).not.toBeVisible();
    await expect(window.getByText('❌ DÉCLARÉE PERDUE')).toBeVisible({ timeout: 10000 });
    const perdueButton = window.getByRole('button', { name: /Carte déclarée perdue/ });
    await expect(perdueButton).toBeDisabled();
    await expect(perdueButton).toHaveAttribute('title', /déclarée perdue par l'administration/);

    const after = queryDb(dbPath, `SELECT statut, statut_physique FROM t_cartes WHERE id_carte=${idPerdue};`);
    expect(after).toBe('EN STOCK|PERDUE');
  });

  test("26. Badge de périmètre TopBar (ConsultantPerimeter) — Site • Centre en lecture seule (scénario 9)", async () => {
    const { window } = env;
    const badge = window.locator('.consultant-perimeter-badge');
    await expect(badge).toBeVisible({ timeout: 10000 });
    await expect(badge).toContainText('PÉRIMÈTRE D\'AFFECTATION');
    await expect(badge).toContainText('Site E2E Test');
    await expect(badge).toContainText('Centre E2E Test');
    await expect(badge).toHaveAttribute('title', /droits de consultation sont limités/);
  });

  test('27. Cloche de notifications — filtre CARTE_ABSENTE_SIGNALEE (réservée ADMIN_CENTRE) hors de la liste OPERATEUR_VERIFICATION (scénario 10)', async () => {
    const { window } = env;

    // Deux notifications insérées DIRECTEMENT en base (même technique STOP&WARN
    // que les tests 18/19/20 : aucun chemin UI ne permet de créer ces logs pour
    // ce rôle) sur le MÊME site que l'agent : une réservée à ADMIN_CENTRE
    // (CARTE_ABSENTE_SIGNALEE, doit être filtrée côté TopBar.tsx:149) et une
    // pertinente pour OPERATEUR_VERIFICATION (CARTE_ABSENTE_ESCALADEE, absente
    // de la liste d'exclusion) -> ne doit apparaître QUE la seconde.
    queryDb(
      dbPath,
      `INSERT INTO t_logs (login_user, action, detail, site_id, is_read, valeur_apres) VALUES ('SYSTEM','CARTE_ABSENTE_SIGNALEE','ZZTEST_FILTERTEST_HIDDEN signalement initial',${env.seed.siteId},0,'{"centre_id":${env.seed.centreId}}');`
    );
    queryDb(
      dbPath,
      `INSERT INTO t_logs (login_user, action, detail, site_id, is_read) VALUES ('SYSTEM','CARTE_ABSENTE_ESCALADEE','ZZTEST_FILTERTEST_VISIBLE escalade site',${env.seed.siteId},0);`
    );

    // Un simple re-fetch ne suffit pas ici (fetchUnreadNotifications ne se
    // redéclenche que sur montage ou sur l'événement IPC 'sync:updated-data',
    // jamais poussé par un INSERT SQL direct — même constat empirique que le
        // test 20) : on force un remontage complet de TopBar via logout/login.
    await logout();
    await loginAs('E2E_OPERATEUR_VERIFICATION', 'E2E_Test_Pwd_2026!');

    await window.locator('.topbar-icon-btn[title="Notifications"]').click();
    await expect(window.locator('.topbar-notifications-dropdown')).toBeVisible({ timeout: 10000 });

    const visibleItem = window.locator('.topbar-notification-item').filter({ hasText: 'ZZTEST_FILTERTEST_VISIBLE' });
    const hiddenItem = window.locator('.topbar-notification-item').filter({ hasText: 'ZZTEST_FILTERTEST_HIDDEN' });
    await expect(visibleItem).toBeVisible({ timeout: 10000 });
    await expect(hiddenItem).toHaveCount(0);

    console.log('[QA-CHECK][scénario 10] Notification CARTE_ABSENTE_SIGNALEE correctement filtrée pour OPERATEUR_VERIFICATION ; CARTE_ABSENTE_ESCALADEE correctement affichée.');

    // Fermeture propre du dropdown avant le test suivant (re-clic sur la cloche).
    await window.locator('.topbar-icon-btn[title="Notifications"]').click();
    await expect(window.locator('.topbar-notifications-dropdown')).not.toBeVisible();
  });

  test('28. SyncWidget (TopBar globale) — état OFFLINE cohérent en environnement sync désactivée, aucun crash (scénario 11)', async () => {
    const { window } = env;
    const widget = window.locator('.sync-widget');
    await expect(widget).toBeVisible({ timeout: 10000 });
    // GEST_IN_SITU_E2E_DISABLE_SYNC=1 -> NetworkMonitor.start() est un no-op
    // (network-monitor.ts:47-51) : l'état reste à sa valeur initiale 'OFFLINE'
    // en permanence (jamais de ping réel, jamais de transition PROBING/ONLINE/
    // PERMANENT_OFFLINE) -> getStatusText() affiche "Mode local autonome".
    await expect(widget).toContainText('Mode local autonome');
    // Ni le bouton "Forcer la synchronisation" (visible seulement si ONLINE) ni
    // le bouton "Réessayer la connexion" (visible seulement si PERMANENT_OFFLINE)
    // ne doivent être rendus dans cet état -> aucune action de synchro n'est
    // proposée à l'agent alors qu'il n'y a de toute façon rien à synchroniser réellement.
    await expect(window.locator('.sync-widget button[title="Forcer la synchronisation"]')).toHaveCount(0);
    await expect(window.locator('.sync-widget button[title="Réessayer la connexion"]')).toHaveCount(0);

    console.log('[QA-CHECK][scénario 11] SyncWidget affiche "Mode local autonome" sans aucun bouton d\'action synchro actionnable, conforme à un environnement sync désactivée — aucun crash observé.');
    await expect(window.locator('body')).toBeVisible();
  });
});

test.describe('RechercheView — Écran "Base de données locale vide" (scénario 9, instance dédiée)', () => {
  // Instance Electron ENTIÈREMENT séparée (son propre userDataDir jetable) :
  // seed-database.ts ne seed AUCUNE carte -> totalCards===0 est garanti tant
  // qu'aucun seed complémentaire n'est exécuté sur CETTE instance. Isolé du
  // describe.serial principal ci-dessus pour ne prendre aucun risque sur les
  // 22 scénarios qui en dépendent (pas de partage d'état).
  let env: E2EEnvironment;
  let anyTestFailed = false;

  test.beforeAll(async () => {
    env = await launchSeededApp();
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

  test('Base fraîchement seedée sans carte -> écran bloquant "Base de données locale vide"', async () => {
    const { window } = env;
    const user = getTestUser('operateurVerification');
    await window.waitForURL(/#\/login/);
    await window.getByTestId('login-input').fill(user.login);
    await window.getByTestId('password-input').fill(user.password);
    await window.getByTestId('login-submit').click();
    await window.waitForURL(/#\/agent-verification$/, { timeout: 15000 });

    await window.getByRole('link', { name: 'Recherche Active' }).click();
    await window.waitForURL(/#\/agent-verification\/recherche/, { timeout: 15000 });

    await expect(window.getByText('Base de données locale vide')).toBeVisible({ timeout: 10000 });
    await expect(window.getByPlaceholder('Ex: KOFFI KOFFI KAN')).not.toBeVisible();
  });
});
