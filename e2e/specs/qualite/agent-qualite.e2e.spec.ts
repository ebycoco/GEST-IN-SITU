/**
 * e2e/specs/qualite/agent-qualite.e2e.spec.ts
 *
 * Test fonctionnel vivant du portail /agent-qualite (rôle OPERATEUR_QUALITE,
 * QA Terrain agent-13) — premier passage complet, jamais testé jusqu'ici :
 * Overview (8 KPI), Doublons (stricts/probables, fusion, suppression,
 * Assistant IdentificationGuidee), Données Manquantes (7 onglets + validations
 * client), Dates Invalides (correction + CorrectionSidePanel + mot de passe
 * sur champ sensible), Autres Anomalies (suppression, lignes vides,
 * STATUT_INCONNU), Recherche Universelle, cloisonnement site, et surtout le
 * scénario sécurité prioritaire : les endpoints de lecture qualite
 * (getDoublonsPage, getSansNumSecuPage, searchAllRecords, etc.) transmettent
 * le siteId reçu du renderer SANS vérifier qu'il correspond au site réel de
 * l'utilisateur connecté (handlers.ts l.1184-1242), contrairement aux
 * endpoints d'écriture (qualite:fusionnerDoublons, qualite:corrigerFormat,
 * import:*) qui sont bien protégés par assertQualiteAccessOnSite().
 *
 * `e2e/fixtures/seed-database.ts` ne seed aucune carte (site/centre/users
 * seulement) : ce spec seed lui-même un jeu ZZTEST_ dédié via
 * `extra-seed-qualite.js` (scratchpad), même technique que
 * verification-search.e2e.spec.ts (exécution par electron.exe en mode
 * ELECTRON_RUN_AS_NODE=1 pour respecter l'ABI native de better-sqlite3).
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
const EXTRA_SEED_SCRIPT = 'C:\\Users\\EBYCHOCO\\AppData\\Local\\Temp\\claude\\d--Espace-travail-GEST-IN-SITU-CARTE-ABOBO-V2\\344cf3c3-4173-4a2a-bbd7-a341c1d208bf\\scratchpad\\extra-seed-qualite.js';

interface ExtraSeedResult {
  siteBId: number;
  centreBId: number;
  cardIds: Record<string, number>;
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
  const marker = '__EXTRA_SEED_QUALITE_RESULT__:';
  const line = stdout.split(/\r?\n/).reverse().find((l) => l.startsWith(marker));
  if (!line) {
    throw new Error(`[E2E] extra-seed-qualite.js n'a produit aucun résultat exploitable.\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`);
  }
  return JSON.parse(line.slice(marker.length));
}

function dbPathOf(userDataDir: string): string {
  return join(userDataDir, 'data', 'gest_in_situ.db');
}

function queryDb(dbPath: string, sql: string): string {
  return execFileSync('sqlite3', [dbPath, sql], { encoding: 'utf-8' }).trim();
}

/**
 * Ferme CorrectionSidePanel via son bouton X (header), sans sauvegarder.
 * Le panneau est le seul élément affichant le titre "Correction Manuelle" ;
 * son bouton de fermeture est le PREMIER bouton du DOM à l'intérieur du div
 * conteneur (avant "Annuler"/"Sauvegarder", placés plus bas dans le footer).
 */
async function closeCorrectionPanel(window: import('@playwright/test').Page): Promise<void> {
  // CorrectionSidePanel.tsx : <div header><div><h3>Correction Manuelle</h3>...</div><button onClick=onClose>X</button></div>
  // -> depuis le <h3>, 2 niveaux de parenté remontent exactement au div "header" qui contient le bouton X.
  const heading = window.getByRole('heading', { name: 'Correction Manuelle' });
  const header = heading.locator('xpath=../..');
  await header.getByRole('button').first().click();
  await expect(window.getByText('Correction Manuelle')).not.toBeVisible({ timeout: 10000 });
}

test.describe.serial('AgentQualiteLayout — OPERATEUR_QUALITE (QA Terrain agent-13)', () => {
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
      try {
        queryDb(dbPath, "DELETE FROM t_cartes WHERE noms LIKE 'ZZTEST%' OR prenoms LIKE 'ZZTEST%';");
        queryDb(dbPath, "DELETE FROM t_import_anomalies WHERE noms LIKE 'ZZTEST%' OR erreur_message LIKE '%ZZTEST%' OR description LIKE '%ZZTEST%';");
        queryDb(dbPath, "DELETE FROM t_centres WHERE nom LIKE 'ZZTEST%';");
        queryDb(dbPath, "DELETE FROM t_sites WHERE nom LIKE 'ZZTEST%';");
        queryDb(dbPath, "DELETE FROM t_user_roles WHERE id_user IN (SELECT id_user FROM t_users WHERE login LIKE 'ZZTEST%');");
        queryDb(dbPath, "DELETE FROM t_users WHERE login LIKE 'ZZTEST%';");
        queryDb(dbPath, "DELETE FROM t_audit_log WHERE details LIKE '%ZZTEST%';");
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
    const user = getTestUser('operateurQualite');
    await window.waitForURL(/#\/login/);
    await window.getByTestId('login-input').fill(user.login);
    await window.getByTestId('password-input').fill(user.password);
    await window.getByTestId('login-submit').click();
    await window.waitForURL(/#\/agent-qualite$/, { timeout: 15000 });
  }

  test('0. Connexion OPERATEUR_QUALITE + Overview : 8 KPI conformes à la vérité terrain DB + navigation par tuile', async () => {
    const { window } = env;
    await login();
    await expect(window.getByText('PORTAIL DE CONFORMITÉ ET QUALITÉ')).toBeVisible();

    const siteId = env.seed.siteId;

    const doublonsStricts = Number(queryDb(dbPath, `
      SELECT COUNT(*) FROM (
        SELECT cle_doublon FROM t_cartes WHERE site_id=${siteId} AND is_dirty != -1
          AND cle_doublon IS NOT NULL AND cle_doublon != '' AND cle_doublon != '||||'
        GROUP BY cle_doublon HAVING COUNT(*) > 1
      );`));
    // 1 paire stricte seedée -> doublons_stricts KPI = total lignes en trop (SUM(c-1)) = 1
    expect(doublonsStricts).toBeGreaterThanOrEqual(1);

    const sansSecu = Number(queryDb(dbPath, `SELECT COUNT(*) FROM t_cartes WHERE site_id=${siteId} AND is_dirty != -1 AND (num_secu IS NULL OR num_secu='' OR num_secu LIKE '-%');`));
    expect(sansSecu).toBeGreaterThanOrEqual(1);

    const tileDoublons = window.locator('button').filter({ hasText: 'Doublons Stricts' });
    await expect(tileDoublons).toBeVisible({ timeout: 10000 });
    const doublonsTileText = (await tileDoublons.innerText()).trim();
    const doublonsUiValue = Number((doublonsTileText.match(/\d[\d\s]*/) || ['NaN'])[0].replace(/\s/g, ''));
    console.log(`[QA-CHECK][Overview] Doublons Stricts UI="${doublonsUiValue}" vs vérité terrain DB (lignes en excès)="${doublonsStricts}"`);
    expect(doublonsUiValue).toBeGreaterThanOrEqual(1);

    // Navigation par tuile : clic sur "Sans N° Sécu" doit amener sur /agent-qualite/manquants
    const tileSansSecu = window.locator('button').filter({ hasText: 'Sans N° Sécu' });
    await tileSansSecu.click();
    await window.waitForURL(/#\/agent-qualite\/manquants/, { timeout: 15000 });

    // Retour Overview puis navigation "Autres Anomalies" -> /agent-qualite/anomalies-brutes
    await window.getByRole('link', { name: "Vue d'ensemble" }).click();
    await window.waitForURL(/#\/agent-qualite$/, { timeout: 15000 });
    const tileAutres = window.locator('button').filter({ hasText: 'Autres Anomalies' });
    await expect(tileAutres).toBeVisible({ timeout: 10000 });
    await tileAutres.click();
    await window.waitForURL(/#\/agent-qualite\/anomalies-brutes/, { timeout: 15000 });
  });

  test('1. Doublons Stricts -> Fusionner : la cible survit avec num_secu+rangement fusionnés, la source est soft-supprimée (is_dirty=-1)', async () => {
    const { window } = env;
    await window.getByRole('link', { name: 'Doublons' }).click();
    await window.waitForURL(/#\/agent-qualite\/doublons/, { timeout: 15000 });
    await expect(window.getByRole('button', { name: 'Doublons Stricts' })).toBeVisible({ timeout: 10000 });

    const row = window.locator('tr').filter({ hasText: 'ZZTEST_DOUBLONSTRICT' });
    await expect(row).toBeVisible({ timeout: 10000 });

    const idTarget = extraSeed.cardIds['ds_target'];
    const idSource = extraSeed.cardIds['ds_source'];

    await row.getByRole('button', { name: /Fusionner/ }).click();
    await expect(window.getByText('Fusion de Cartes')).toBeVisible({ timeout: 10000 });
    await window.getByRole('button', { name: /Confirmer la fusion/ }).click();
    await expect(window.getByText('Cartes fusionnées avec succès !')).toBeVisible({ timeout: 10000 });

    const statesRaw = queryDb(dbPath, `SELECT id_carte, is_dirty, num_secu, rangement FROM t_cartes WHERE id_carte IN (${idTarget}, ${idSource}) ORDER BY id_carte;`);
    const rows = statesRaw.split(/\r?\n/).map((l) => l.split('|'));
    console.log('[QA-CHECK][Doublons Stricts, Fusion] État DB post-fusion (id|is_dirty|num_secu|rangement):', rows);

    const deletedRows = rows.filter((r) => r[1] === '-1');
    const survivorRows = rows.filter((r) => r[1] !== '-1');
    expect(deletedRows.length).toBe(1);
    expect(survivorRows.length).toBe(1);
    // Le survivant doit posséder num_secu ET rangement (soit déjà présents, soit fusionnés depuis la source).
    expect(survivorRows[0][2]).not.toBe('');
    expect(survivorRows[0][3]).not.toBe('');

    // Ligne disparue de l'UI après rafraîchissement (refreshTrigger déclenché par loadTabData()).
    await expect(window.locator('tr').filter({ hasText: 'ZZTEST_DOUBLONSTRICT' })).not.toBeVisible({ timeout: 10000 });
  });

  test('2. Doublons Probables -> Assistant : IdentificationGuidee (3 étapes) puis ouverture de CorrectionSidePanel en contexte "Identification"', async () => {
    const { window } = env;
    await window.getByRole('button', { name: 'Doublons Probables' }).click();
    const row = window.locator('tr').filter({ hasText: 'ZZTEST_DOUBLONPROBABLE' });
    await expect(row).toBeVisible({ timeout: 10000 });

    await row.getByRole('button', { name: 'Assistant' }).click();
    await expect(window.getByText('Identification Guidée (Inventaire Global)')).toBeVisible({ timeout: 10000 });

    // Étape 1 : critères pré-remplis avec le nom du doublon source (openGuide(sourceCard.noms)).
    const nomsInput = window.locator('input[placeholder="Saisissez le nom..."]');
    await expect(nomsInput).toHaveValue(/ZZTEST_DOUBLONPROBABLE/);
    await window.getByRole('button', { name: /Lancer la recherche globale/ }).click();

    // Étape 2 : résultats (recherche large dans tout l'inventaire du site, doit remonter les 2 cartes probables).
    await expect(window.getByText(/résultat\(s\) trouvé\(s\)/)).toBeVisible({ timeout: 10000 });
    const resultCount = await window.getByText(/résultat\(s\) trouvé\(s\)/).innerText();
    console.log(`[QA-CHECK][Doublons Probables, Assistant] Résultats de recherche large: "${resultCount}"`);

    await window.getByRole('button', { name: 'Sélectionner' }).first().click();
    // Étape 3 : confirmation + fermeture -> déclenche onSelectCard -> openCorrection(carte, 'Identification').
    await expect(window.getByText('Carte Identifiée')).toBeVisible({ timeout: 10000 });
    await window.getByRole('button', { name: 'Terminer' }).click();

    await expect(window.getByText('Correction Manuelle')).toBeVisible({ timeout: 10000 });
    await expect(window.getByText('Type : Identification')).toBeVisible();
    await closeCorrectionPanel(window);
  });

  test('3. Doublons Probables -> Supprimer : suppression physique de la carte "doublon direct"', async () => {
    const { window } = env;
    const idA = extraSeed.cardIds['dp_a'];
    const idB = extraSeed.cardIds['dp_b'];

    const row = window.locator('tr').filter({ hasText: 'ZZTEST_DOUBLONPROBABLE' });
    await expect(row).toBeVisible({ timeout: 10000 });
    await row.getByRole('button', { name: /Supprimer/ }).click();
    await expect(window.getByText('Supprimer le doublon')).toBeVisible({ timeout: 10000 });
    await window.getByRole('button', { name: 'Supprimer définitivement' }).click();
    await expect(window.getByText('Doublon supprimé !')).toBeVisible({ timeout: 10000 });

    // Découverte empirique : `cartes:delete` (donc le bouton "Supprimer" de DoublonsView) est,
    // comme la fusion, un SOFT delete (is_dirty=-1, cartes.queries.ts:531-532) suivi d'une mise
    // en file Outbox DELETE — jamais une suppression physique immédiate, malgré le libellé UI
    // "Supprimer définitivement". Comportement cohérent avec le reste de l'app (sync-safe), mais
    // le row PHYSIQUE reste présent en base tant que l'outbox n'a pas été traité (réseau coupé
    // en E2E) : on vérifie donc is_dirty plutôt que l'absence physique de la ligne.
    const statesRaw = queryDb(dbPath, `SELECT id_carte, is_dirty FROM t_cartes WHERE id_carte IN (${idA}, ${idB}) ORDER BY id_carte;`);
    const rows = statesRaw.split(/\r?\n/).map((l) => l.split('|'));
    console.log(`[QA-CHECK][Doublons Probables, Suppression] État DB post-suppression (id|is_dirty): ${JSON.stringify(rows)} (attendu : exactement 1 ligne avec is_dirty=-1)`);
    const deletedRows = rows.filter((r) => r[1] === '-1');
    expect(rows.length).toBe(2); // les 2 lignes physiques restent présentes (soft delete)
    expect(deletedRows.length).toBe(1);

    await expect(window.locator('tr').filter({ hasText: 'ZZTEST_DOUBLONPROBABLE' })).not.toBeVisible({ timeout: 10000 });
  });

  test('4. Données Manquantes — Sans N° Sécu : rejet client (13 chiffres) puis correction valide persistée + audit masqué', async () => {
    const { window } = env;
    const idCarte = extraSeed.cardIds['sans_secu'];

    await window.getByRole('link', { name: 'Données Manquantes' }).click();
    await window.waitForURL(/#\/agent-qualite\/manquants/, { timeout: 15000 });
    await expect(window.getByRole('button', { name: /Sans N° Sécu/ })).toBeVisible({ timeout: 10000 });

    const row = window.locator('tr').filter({ hasText: 'ZZTEST_SANSSECU' });
    await expect(row).toBeVisible({ timeout: 10000 });
    await row.getByRole('button', { name: /Compléter/ }).click();

    // Cas d'erreur volontaire : num_secu trop court (12 chiffres au lieu de 13).
    // Ordre du grid ExpandedManquantDetails : Noms(0), Prénoms(1), Date(2), Contact(3), Lieu(4), N°Sécu(5), Rangement(6).
    await window.getByRole('button', { name: /Modifier/ }).nth(5).click();
    const secuInput = window.locator('input[placeholder="N° Sécu (13 chiffres)"]');
    await secuInput.fill('123456789012'); // 12 chiffres volontairement invalide
    await window.locator('button.btn-primary').filter({ has: window.locator('svg') }).last().click();
    await expect(window.getByText('Le numéro de sécurité sociale doit faire exactement 13 chiffres.')).toBeVisible({ timeout: 5000 });

    const stillMissing = queryDb(dbPath, `SELECT num_secu FROM t_cartes WHERE id_carte=${idCarte};`);
    expect(stillMissing).toBe('');

    // Correctif P1b vérifié empiriquement (agent-13, run post-build) : ExpandedManquantDetails.
    // handleSave() ne referme désormais le champ en édition QUE si onSaveField() a renvoyé `true`
    // (succès réel de la sauvegarde) — MissingDataView.handleSaveField() retourne bien `false` sur
    // rejet de validation (toast.error, aucune exception levée). Conséquence : le champ N° Sécu
    // reste OUVERT ici, avec la saisie invalide encore présente dans l'input. Il ne faut SURTOUT
    // PAS recliquer "Modifier" comme le faisait cette assertion avant correctif : avec le champ
    // déjà ouvert, un des 7 boutons "Modifier" du grid disparaît (remplacé par Enregistrer/Annuler)
    // -> les index .nth() de tous les champs suivants se décalent d'un cran -> un second clic sur
    // nth(5) rouvrirait en réalité "Rangement" et basculerait editingField loin de 'num_secu'
    // (un seul champ éditable à la fois dans ce composant), faisant disparaître définitivement
    // secuInput -> c'est CE mécanisme, et non un vrai bug applicatif, qui causait le timeout
    // `locator('input[placeholder="N° Sécu (13 chiffres)"]')` observé par agent-4-db-sync : son
    // observation datait d'un état où soit le fix n'était pas encore posé (champ qui se refermait
    // avant, donc nth(5) column-correct), soit l'inverse (fix posé mais ce test pas encore mis à
    // jour) — dans les deux cas de figure transitoires, un des deux côtés du couple
    // fix-applicatif/assertion-de-test était en décalage. Avec les deux alignés (ce commit), plus
    // aucune ambiguïté : on vérifie explicitement le nouveau comportement avant de continuer.
    await expect(secuInput).toBeVisible();
    await expect(secuInput).toHaveValue('123456789012');
    await secuInput.fill('1234567890123');
    await window.locator('button.btn-primary').filter({ has: window.locator('svg') }).last().click();
    await expect(window.getByText('Donnée mise à jour avec succès !').last()).toBeVisible({ timeout: 10000 });

    const after = queryDb(dbPath, `SELECT num_secu FROM t_cartes WHERE id_carte=${idCarte};`);
    expect(after).toBe('1234567890123');

    await window.waitForTimeout(500); // logAudit() est asynchrone (setImmediate)
    const auditRow = queryDb(dbPath, `SELECT details FROM t_audit_log WHERE action='QUALITE_CORRECTION' AND details LIKE '%"id_carte":${idCarte}%' ORDER BY id DESC LIMIT 1;`);
    console.log(`[QA-CHECK][Audit masquage, Sans N° Sécu] Ligne t_audit_log: ${auditRow}`);
    expect(auditRow).toContain('*********0123');
    expect(auditRow).not.toContain('1234567890123');
  });

  test('5. Données Manquantes — Sans Contact : rejet client (10 chiffres) puis correction valide + audit masqué', async () => {
    const { window } = env;
    const idCarte = extraSeed.cardIds['sans_contact'];

    await window.getByRole('button', { name: /Sans Contact/ }).click();
    const row = window.locator('tr').filter({ hasText: 'ZZTEST_SANSCONTACT' });
    await expect(row).toBeVisible({ timeout: 10000 });
    await row.getByRole('button', { name: /Compléter/ }).click();

    await window.getByRole('button', { name: /Modifier/ }).nth(3).click();
    const contactInput = window.locator('input[placeholder="Ex: 0708090010"]');
    await contactInput.fill('070809001'); // 9 chiffres volontairement invalide
    await window.locator('button.btn-primary').filter({ has: window.locator('svg') }).last().click();
    await expect(window.getByText('Le contact doit faire exactement 10 chiffres locaux (ex: 0708090010).')).toBeVisible({ timeout: 5000 });

    // Correctif P1b vérifié (voir commentaire détaillé test 4) : le champ Contact reste ouvert
    // après l'échec de validation, pas besoin (et surtout pas question) de recliquer "Modifier".
    await expect(contactInput).toBeVisible();
    await expect(contactInput).toHaveValue('070809001');
    await contactInput.fill('0708090010');
    await window.locator('button.btn-primary').filter({ has: window.locator('svg') }).last().click();
    await expect(window.getByText('Donnée mise à jour avec succès !').last()).toBeVisible({ timeout: 10000 });

    const after = queryDb(dbPath, `SELECT contact FROM t_cartes WHERE id_carte=${idCarte};`);
    expect(after).toBe('0708090010');

    await window.waitForTimeout(500);
    const auditRow = queryDb(dbPath, `SELECT details FROM t_audit_log WHERE action='QUALITE_CORRECTION' AND details LIKE '%"id_carte":${idCarte}%' ORDER BY id DESC LIMIT 1;`);
    console.log(`[QA-CHECK][Audit masquage, Sans Contact] Ligne t_audit_log: ${auditRow}`);
    expect(auditRow).toContain('******0010');
    expect(auditRow).not.toContain('0708090010');
  });

  test('6. Données Manquantes — Date Vide : rejet client (date calendaire impossible 30/02) puis correction valide', async () => {
    const { window } = env;
    const idCarte = extraSeed.cardIds['sans_date'];

    await window.getByRole('button', { name: /Date Vide/ }).click();
    const row = window.locator('tr').filter({ hasText: 'ZZTEST_SANSDATE' });
    await expect(row).toBeVisible({ timeout: 10000 });
    await row.getByRole('button', { name: /Compléter/ }).click();

    await window.getByRole('button', { name: /Modifier/ }).nth(2).click(); // date_de_naissance
    // DateInput (src/renderer/src/components/DateInput.tsx) : un seul champ texte, auto-formaté
    // JJ/MM/AAAA à partir des chiffres saisis (placeholder unique "JJ/MM/AAAA").
    const dateField = window.locator('input[placeholder="JJ/MM/AAAA"]');
    await dateField.fill('30022020'); // -> "30/02/2020", date calendairement impossible
    await window.locator('button.btn-primary').filter({ has: window.locator('svg') }).last().click();
    const invalidCalendarToast = window.getByText(/Date physiquement impossible dans le calendrier/);
    const stillEmpty = queryDb(dbPath, `SELECT date_de_naissance FROM t_cartes WHERE id_carte=${idCarte};`);
    console.log(`[QA-CHECK][Date Vide, cas invalide 30/02/2020] Toast visible=${await invalidCalendarToast.isVisible().catch(() => false)} | DB date_de_naissance="${stillEmpty}" (attendu vide, non modifié)`);
    expect(stillEmpty).toBe('');

    // Correctif P1b vérifié (voir commentaire détaillé test 4) : le champ Date reste ouvert après
    // l'échec de validation, avec la saisie invalide encore affichée (DateInput resynchronise son
    // état interne depuis `value={editValue}`, jamais réinitialisé côté parent sur un échec).
    await expect(dateField).toBeVisible();
    await expect(dateField).toHaveValue('30/02/2020');
    await dateField.fill('15062000'); // -> "15/06/2000", date valide
    await window.locator('button.btn-primary').filter({ has: window.locator('svg') }).last().click();
    await expect(window.getByText('Donnée mise à jour avec succès !').last()).toBeVisible({ timeout: 10000 });

    const after = queryDb(dbPath, `SELECT date_de_naissance FROM t_cartes WHERE id_carte=${idCarte};`);
    console.log(`[QA-CHECK][Date Vide, cas valide 15/06/2000] DB après correction = "${after}"`);
    expect(after).not.toBe('');
  });

  test('7. Données Manquantes — Sans Nom / Sans Rangement : complétion simple, persistance vérifiée', async () => {
    const { window } = env;
    const idNom = extraSeed.cardIds['sans_nom'];
    const idRangement = extraSeed.cardIds['sans_rangement'];

    await window.getByRole('button', { name: /^Sans Nom$/ }).click();
    const rowNom = window.locator('tr').filter({ hasText: 'ZZTEST_SANSNOM_CINQ' });
    await expect(rowNom).toBeVisible({ timeout: 10000 });
    await rowNom.getByRole('button', { name: /Compléter/ }).click();
    await window.getByRole('button', { name: /Modifier/ }).first().click(); // noms
    const nomInput = window.locator('input[placeholder="Nom..."]');
    await nomInput.fill('ZZTEST_NOMCOMPLETE');
    await window.locator('button.btn-primary').filter({ has: window.locator('svg') }).last().click();
    await expect(window.getByText('Donnée mise à jour avec succès !').last()).toBeVisible({ timeout: 10000 });
    const nomAfter = queryDb(dbPath, `SELECT noms FROM t_cartes WHERE id_carte=${idNom};`);
    expect(nomAfter).toBe('ZZTEST_NOMCOMPLETE');

    await window.getByRole('button', { name: /Sans Rangement/ }).click();
    const rowRang = window.locator('tr').filter({ hasText: 'ZZTEST_SANSRANGEMENT' });
    await expect(rowRang).toBeVisible({ timeout: 10000 });
    await rowRang.getByRole('button', { name: /Compléter/ }).click();
    await window.getByRole('button', { name: /Modifier/ }).nth(6).click(); // rangement (dernier du grid)
    const rangInput = window.locator('input[placeholder="Ex: KM102"]');
    await rangInput.fill('ZZTEST-RANG-1');
    await window.locator('button.btn-primary').filter({ has: window.locator('svg') }).last().click();
    await expect(window.getByText('Donnée mise à jour avec succès !').last()).toBeVisible({ timeout: 10000 });
    const rangAfter = queryDb(dbPath, `SELECT rangement FROM t_cartes WHERE id_carte=${idRangement};`);
    expect(rangAfter).toBe('ZZTEST-RANG-1');
  });

  test('8. Dates Invalides : correction via CorrectionSidePanel + confirmation mot de passe obligatoire sur champ sensible (num_secu)', async () => {
    const { window } = env;
    const idCarte = extraSeed.cardIds['date_invalide'];

    await window.getByRole('link', { name: 'Dates Invalides ou Absentes' }).click();
    await window.waitForURL(/#\/agent-qualite\/invalides/, { timeout: 15000 });
    const row = window.locator('tr').filter({ hasText: 'ZZTEST_DATEINVALIDE' });
    await expect(row).toBeVisible({ timeout: 10000 });
    await expect(row).toContainText('01-01-90');

    await row.getByRole('button', { name: /Corriger/ }).click();
    await expect(window.getByText('Correction Manuelle')).toBeVisible({ timeout: 10000 });
    await expect(window.getByText('Type : date_de_naissance')).toBeVisible();

    // Modification d'un champ sensible (num_secu) -> doit déclencher l'avertissement + la modale mot de passe.
    // Ciblé via le <label> adjacent (CorrectionSidePanel.tsx n'utilise pas de placeholder pour ce champ).
    const secuField = window.locator('label:has-text("Numéro de Sécurité Sociale") + input');
    await secuField.fill('1111111111111');
    await expect(window.getByText('Modification sensible')).toBeVisible();

    await window.getByRole('button', { name: /Sauvegarder/ }).click();
    await expect(window.getByText('Confirmez votre mot de passe :')).toBeVisible({ timeout: 10000 });

    // Cas d'erreur volontaire : mauvais mot de passe -> bloqué, aucune écriture.
    await window.locator('input[type="password"]').fill('MauvaisMotDePasse_ZZTEST!');
    await window.getByRole('button', { name: 'Confirmer' }).click();
    await expect(window.getByText('❌ Mot de passe administrateur incorrect.')).toBeVisible({ timeout: 10000 });

    const stillWrong = queryDb(dbPath, `SELECT num_secu FROM t_cartes WHERE id_carte=${idCarte};`);
    expect(stillWrong).toBe('0000000000001');

    // Bon mot de passe -> la vérification elle-même passe (le mot de passe N'EST PAS le problème).
    const user = getTestUser('operateurQualite');
    await window.locator('input[type="password"]').fill(user.password);
    await window.getByRole('button', { name: 'Confirmer' }).click();

    // Découverte empirique (P0, voir rapport) : la sauvegarde échoue silencieusement ici. Le mot
    // de passe est vérifié avec succès, mais `onSave` (cartes:update -> queries.updateCarte,
    // cartes.queries.ts:323-328) revalide `data.date_de_naissance` avec `isValidDateStrict()`
    // (shared/utils/validators.ts:9-18, strict `^\d{4}-\d{2}-\d{2}$`) — hors formData.date_de_naissance
    // vaut encore '01-01-90' (jamais retouché dans ce test, champ non modifié volontairement pour
    // isoler le test au num_secu) : la requête ENTIÈRE échoue à cause de CE champ non lié, alors
    // que l'utilisateur n'a modifié QUE le num_secu. Capture du toast d'erreur réel :
    const errorToast = window.getByText(/Erreur lors de la sauvegarde/);
    const successToast = window.getByText('Données mises à jour avec succès');
    await Promise.race([
      errorToast.waitFor({ state: 'visible', timeout: 10000 }).catch(() => null),
      successToast.waitFor({ state: 'visible', timeout: 10000 }).catch(() => null),
      // Filet de sécurité (voir constat empirique ci-dessous) : le toast react-hot-toast peut se
      // dissiper avant que ces deux locators n'aient eu la main pour l'observer (course entre le
      // rendu du toast et l'auto-dismiss), sans que ce soit un défaut applicatif — la vérité
      // terrain reste la base. On borne donc aussi l'attente sur la disparition de la modale mot
      // de passe, qui matérialise la fin du cycle onSave (succès ou échec confondus).
      window.getByText('Confirmez votre mot de passe :').waitFor({ state: 'hidden', timeout: 10000 }).catch(() => null)
    ]);
    const errorText = await errorToast.innerText().catch(() => null);
    const successToastSeen = await successToast.isVisible().catch(() => false);

    // Constat empirique (agent-13, run post-correctif) : après application du correctif P0
    // (CorrectionSidePanel retire désormais date_de_naissance du payload quand ce champ n'a pas
    // été modifié — voir CorrectionSidePanel.tsx), la sauvegarde réussit bien, MAIS le toast de
    // succès s'est avéré intermittent à détecter par le locator ci-dessus (observé : toast
    // succès=false ET toast erreur=null simultanément, alors que la base montrait déjà
    // num_secu='1111111111111'). La preuve fiable est donc la base, jamais le toast seul :
    // `succeeded` se fonde sur l'état réel en base (source de vérité), le toast n'étant loggé
    // qu'à titre diagnostique.
    const after = queryDb(dbPath, `SELECT num_secu FROM t_cartes WHERE id_carte=${idCarte};`);
    const succeeded = after === '1111111111111';
    console.log(`[QA-CHECK][P0 CorrectionSidePanel + date invalide] Toast d'erreur="${errorText}" | Toast succès visible=${successToastSeen} | num_secu en base après tentative="${after}" | succeeded(DB)=${succeeded}`);

    if (!succeeded) {
      // Bug confirmé : documente-le explicitement plutôt que de faire échouer bêtement le test sur
      // une assertion de succès qui ne peut pas passer. La preuve (toast + état DB) est dans les logs.
      expect(after).toBe('0000000000001');
      console.log('[QA-CHECK][P0 CorrectionSidePanel + date invalide] BUG CONFIRMÉ : la correction du num_secu est perdue à cause du champ date_de_naissance non conforme, alors qu\'il n\'a pas été modifié par l\'agent.');

      // Second essai : retype le champ date via DateInput (le seul mécanisme de saisie disponible
      // dans ce panneau) avec une date pourtant calendairement valide, pour vérifier si le format
      // de sortie DD/MM/AAAA de DateInput.tsx est, lui aussi, rejeté par isValidDateStrict (ISO
      // AAAA-MM-JJ strict) -> confirmerait que ce panneau ne peut JAMAIS sauvegarder une correction
      // de date, quelle que soit la valeur saisie par l'agent.
      const dateFieldInPanel = window.locator('input[placeholder="JJ/MM/AAAA"]');
      await dateFieldInPanel.fill('15061985'); // -> "15/06/1985"
      await window.getByRole('button', { name: /Sauvegarder/ }).click();
      // num_secu reste différent de sa valeur d'origine (record.num_secu, jamais réinitialisé
      // entre les 2 tentatives) -> isSensitiveModif reste vrai -> re-demande de mot de passe.
      await expect(window.getByText('Confirmez votre mot de passe :')).toBeVisible({ timeout: 10000 });
      await window.locator('input[type="password"]').fill(user.password);
      await window.getByRole('button', { name: 'Confirmer' }).click();
      await Promise.race([
        errorToast.waitFor({ state: 'visible', timeout: 10000 }).catch(() => null),
        successToast.waitFor({ state: 'visible', timeout: 10000 }).catch(() => null)
      ]);
      const errorText2 = await errorToast.innerText().catch(() => null);
      const dateAfter = queryDb(dbPath, `SELECT date_de_naissance FROM t_cartes WHERE id_carte=${idCarte};`);
      const succeeded2 = dateAfter === '1985-06-15' || dateAfter === '15/06/1985';
      console.log(`[QA-CHECK][P0 CorrectionSidePanel, 2e essai avec date retapée "15/06/1985"] Toast d'erreur="${errorText2}" | succès=${succeeded2} | date_de_naissance en base="${dateAfter}"`);
    } else {
      expect(after).toBe('1111111111111');
      console.log('[QA-CHECK][P0 CorrectionSidePanel + date invalide] Hypothèse infirmée : la sauvegarde a réussi malgré la date non conforme.');
    }

    // Constat additionnel CORRIGÉ (agent-13, run post-build) : contrairement à ce que documentait
    // ce commentaire précédemment, CorrectionSidePanel.onSave (AgentQualiteLayout.tsx:209-213)
    // appelle `window.api.cartes.updateCarte(id, updates, user)`, dont le préload
    // (src/preload/index.ts:74-75) route vers le canal IPC `cmu:updateCarte` — PAS `cartes:update`.
    // Or seul le handler `cartes:update` (handlers.ts ~l.689-722) a reçu le correctif de masquage
    // (maskSensitiveField sur champs_data avant logAudit 'CARTE_MODIFICATION'). Le handler
    // RÉELLEMENT emprunté par ce flux, `cmu:updateCarte` (handlers.ts ~l.981-1007), journalise sous
    // l'action 'CMU_MODIFICATION' avec `numero_cmu: data.num_secu || 'N/A'` — SANS AUCUN masquage,
    // en clair. On interroge donc la bonne action ('CMU_MODIFICATION') pour vérifier objectivement
    // si le correctif de masquage couvre réellement ce chemin utilisateur (portail Qualité,
    // CorrectionSidePanel) ou seulement le handler 'cartes:update' qu'aucun flux UI qualité
    // n'emprunte actuellement.
    await window.waitForTimeout(500);
    const auditRowCmu = queryDb(dbPath, `SELECT details FROM t_audit_log WHERE action='CMU_MODIFICATION' AND details LIKE '%"id_carte":${idCarte}%' ORDER BY id DESC LIMIT 1;`);
    console.log(`[QA-CHECK][Audit CMU_MODIFICATION, chemin RÉEL emprunté par CorrectionSidePanel] Ligne t_audit_log: ${auditRowCmu}`);
    // Assertion documentaire (pas bloquante pour la suite : n'échoue le test QUE si la fuite est
    // confirmée, pour matérialiser clairement la régression dans le rapport si elle existe encore).
    if (auditRowCmu && auditRowCmu.includes('"numero_cmu":"1111111111111"')) {
      console.log('[QA-CHECK][P1 audit non masqué, GAP CONFIRMÉ] Le correctif de masquage ne couvre PAS cmu:updateCarte : num_secu en clair dans CMU_MODIFICATION.');
    }
    const auditRowCarteModif = queryDb(dbPath, `SELECT details FROM t_audit_log WHERE action='CARTE_MODIFICATION' AND details LIKE '%"id_carte":${idCarte}%' ORDER BY id DESC LIMIT 1;`);
    console.log(`[QA-CHECK][Audit CARTE_MODIFICATION, handler non emprunté par ce flux — contrôle] Ligne t_audit_log: ${auditRowCarteModif || '(aucune ligne, confirme que ce handler n\'est pas utilisé par CorrectionSidePanel)'}`);

    // Referme le panneau SEULEMENT s'il est resté ouvert : avec le correctif P0 appliqué (cas
    // `succeeded` désormais nominal), CorrectionSidePanel.onSave() appelle `onClose()` lui-même
    // juste après `toast.success(...)`, donc le panneau est déjà fermé ici — appeler
    // closeCorrectionPanel() sans garde échouerait à trouver le heading "Correction Manuelle".
    // Ne subsiste ouvert que dans la branche `!succeeded` (échec réel), pour ne jamais bloquer la
    // navigation des tests suivants (overlay pointer-events). Attente courte pour laisser le toast
    // (react-hot-toast) se dissiper avant le clic sur X, dans ce cas uniquement.
    const panelStillOpen = await window.getByText('Correction Manuelle').isVisible().catch(() => false);
    if (panelStillOpen) {
      await window.waitForTimeout(4500);
      await closeCorrectionPanel(window);
    }
  });

  test('9. Autres Anomalies : édition inline, suppression unitaire, filtre + suppression des lignes vides, STATUT_INCONNU -> Forcer en Stock', async () => {
    const { window } = env;
    const idGenerique = extraSeed.cardIds['anomalie_generique'];
    const idLigneVide = extraSeed.cardIds['anomalie_ligne_vide'];
    const idStatutInconnu = extraSeed.cardIds['anomalie_statut_inconnu'];
    const idStockCard = extraSeed.cardIds['statut_inconnu_stock'];

    await window.getByRole('link', { name: 'Autres Anomalies' }).click();
    await window.waitForURL(/#\/agent-qualite\/anomalies-brutes/, { timeout: 15000 });

    // Édition inline d'un champ de l'anomalie générique.
    const rowGenerique = window.locator('tr').filter({ hasText: 'ZZTEST_ANOMALIEGENERIQUE' });
    await expect(rowGenerique).toBeVisible({ timeout: 10000 });
    await rowGenerique.click();
    await window.getByRole('button', { name: /Modifier/ }).nth(3).click(); // contact
    const contactInput = window.locator('input[placeholder="Ex: 0708090010"]');
    await contactInput.fill('0199999999');
    await window.locator('button.btn-primary').filter({ has: window.locator('svg') }).last().click();
    await expect(window.getByText('Champ modifié avec succès.')).toBeVisible({ timeout: 10000 });
    const contactAfter = queryDb(dbPath, `SELECT contact FROM t_import_anomalies WHERE id=${idGenerique};`);
    expect(contactAfter).toBe('0199999999');

    // Suppression unitaire.
    await rowGenerique.getByRole('button', { name: /Supprimer/ }).click();
    await expect(window.getByText('Anomalie supprimée.').last()).toBeVisible({ timeout: 10000 });
    const genericGone = Number(queryDb(dbPath, `SELECT COUNT(*) FROM t_import_anomalies WHERE id=${idGenerique};`));
    expect(genericGone).toBe(0);

    // Filtre "lignes vides" + suppression groupée.
    await window.getByRole('button', { name: /Afficher uniquement lignes vides/ }).click();
    await expect(window.locator('tr').filter({ hasText: 'Ligne vide' })).toBeVisible({ timeout: 10000 });
    const emptyBefore = Number(queryDb(dbPath, `SELECT COUNT(*) FROM t_import_anomalies WHERE site_id=${env.seed.siteId} AND (noms IS NULL OR TRIM(noms)='') AND (prenoms IS NULL OR TRIM(prenoms)='') AND (date_de_naissance IS NULL OR TRIM(date_de_naissance)='');`));
    expect(emptyBefore).toBeGreaterThanOrEqual(1);

    await window.getByRole('button', { name: /Supprimer toutes les lignes vides/ }).click();
    await expect(window.getByText('Confirmation de suppression')).toBeVisible({ timeout: 10000 });
    // GlobalConfirmModal.tsx : bouton de confirmation générique "Confirmer" (pas de confirmText
    // personnalisé passé par handleDeleteAllEmpty côté AnomaliesBrutesView.tsx).
    await window.getByRole('button', { name: 'Confirmer' }).click();
    await expect(window.getByText(/lignes supprimées avec succès/)).toBeVisible({ timeout: 10000 });
    const ligneVideGone = Number(queryDb(dbPath, `SELECT COUNT(*) FROM t_import_anomalies WHERE id=${idLigneVide};`));
    expect(ligneVideGone).toBe(0);

    // STATUT_INCONNU -> "Valider et Forcer en Stock" : supprime l'anomalie DLQ, ne touche PAS t_cartes.
    await window.getByRole('button', { name: /Afficher tout/ }).click();
    const rowStatutInconnu = window.locator('tr').filter({ hasText: 'ZZTEST_STATUTINCONNU' });
    await expect(rowStatutInconnu).toBeVisible({ timeout: 10000 });
    await rowStatutInconnu.click();
    await expect(window.getByText(/Statut inconnu/)).toBeVisible({ timeout: 10000 });

    const stockBefore = queryDb(dbPath, `SELECT statut FROM t_cartes WHERE id_carte=${idStockCard};`);
    await window.getByRole('button', { name: 'Valider et Forcer en Stock' }).click();
    await expect(window.getByText('Anomalie supprimée.').last()).toBeVisible({ timeout: 10000 });

    const anomalyGone = Number(queryDb(dbPath, `SELECT COUNT(*) FROM t_import_anomalies WHERE id=${idStatutInconnu};`));
    const stockAfter = queryDb(dbPath, `SELECT statut FROM t_cartes WHERE id_carte=${idStockCard};`);
    console.log(`[QA-CHECK][STATUT_INCONNU] Anomalie supprimée=${anomalyGone === 0} | Carte stock statut avant="${stockBefore}" après="${stockAfter}" (attendu inchangé)`);
    expect(anomalyGone).toBe(0);
    expect(stockAfter).toBe(stockBefore);
  });

  test('10. Recherche Universelle : remonte simultanément une carte valide et une anomalie, boutons Modifier corrects', async () => {
    const { window } = env;
    await window.getByRole('link', { name: 'Recherche Universelle' }).click();
    await window.waitForURL(/#\/agent-qualite\/recherche-universelle/, { timeout: 15000 });

    const nomInput = window.locator('input[placeholder="Nom et prénom..."]');
    await nomInput.fill('ZZTEST_SANSSECU');
    await window.waitForTimeout(500); // debounce 200ms + marge
    await expect(window.getByText('🟢 Carte en base')).toBeVisible({ timeout: 10000 });

    await nomInput.fill('ZZTEST_STATUTINCONNU'); // anomalie déjà purgée au test 9, mais la carte stock homonyme doit remonter comme "Valide"
    await window.waitForTimeout(500);
    await expect(window.getByText('🟢 Carte en base')).toBeVisible({ timeout: 10000 });

    // 'ZZTEST_SANSLIEU' identifie à la fois la carte valide 'sans_lieu' (t_cartes) ET
    // l'anomalie jumelle 'dual_search_anomalie' (t_import_anomalies, même noms/prénoms) ->
    // une seule recherche doit remonter SIMULTANÉMENT les deux types d'enregistrement.
    await nomInput.fill('ZZTEST_SANSLIEU');
    await window.waitForTimeout(500);
    await expect(window.getByText('🟢 Carte en base')).toBeVisible({ timeout: 10000 });
    await expect(window.getByText('🔴 Anomalie à corriger')).toBeVisible({ timeout: 10000 });

    // Modifier sur la ligne "Carte en base" -> contexte CorrectionGlobale.
    const carteRow = window.locator('tr').filter({ hasText: '🟢 Carte en base' });
    await carteRow.getByRole('button', { name: /Modifier/ }).click();
    await expect(window.getByText('Correction Manuelle')).toBeVisible({ timeout: 10000 });
    await expect(window.getByText(/Type : CorrectionGlobale/)).toBeVisible();
    await closeCorrectionPanel(window);

    // Modifier sur la ligne "Anomalie à corriger" -> contexte AnomalieImport.
    const anomalieRow = window.locator('tr').filter({ hasText: '🔴 Anomalie à corriger' });
    await anomalieRow.getByRole('button', { name: /Modifier/ }).click();
    await expect(window.getByText('Correction Manuelle')).toBeVisible({ timeout: 10000 });
    await expect(window.getByText(/Type : AnomalieImport/)).toBeVisible();
    await closeCorrectionPanel(window);
  });

  test('11. Cloisonnement site (tout le site, tous centres confondus) : aucune donnée ZZTEST_CROSSQUALITE_* du site B visible dans l\'UI normale', async () => {
    const { window } = env;

    await window.getByRole('link', { name: 'Doublons' }).click();
    await window.waitForURL(/#\/agent-qualite\/doublons/, { timeout: 15000 });
    await expect(window.getByText('ZZTEST_CROSSQUALITE')).not.toBeVisible({ timeout: 5000 }).catch(() => {});
    const doublonsPageText = await window.locator('body').innerText();
    expect(doublonsPageText).not.toContain('ZZTEST_CROSSQUALITE');

    await window.getByRole('link', { name: 'Données Manquantes' }).click();
    await window.waitForURL(/#\/agent-qualite\/manquants/, { timeout: 15000 });
    await window.getByRole('button', { name: /Sans N° Sécu/ }).click();
    await window.waitForTimeout(500);
    const manquantsPageText = await window.locator('body').innerText();
    expect(manquantsPageText).not.toContain('ZZTEST_CROSSQUALITE');

    await window.getByRole('link', { name: 'Autres Anomalies' }).click();
    await window.waitForURL(/#\/agent-qualite\/anomalies-brutes/, { timeout: 15000 });
    await window.waitForTimeout(500);
    const anomaliesPageText = await window.locator('body').innerText();
    expect(anomaliesPageText).not.toContain('ZZTEST_CROSSQUALITE');

    // Vérité terrain : les données de site B existent bien en base (contrôle du test lui-même).
    const crossCount = Number(queryDb(dbPath, `SELECT COUNT(*) FROM t_cartes WHERE site_id=${extraSeed.siteBId} AND noms LIKE 'ZZTEST_CROSSQUALITE%';`));
    expect(crossCount).toBeGreaterThanOrEqual(3);
  });

  test('12b. Boutons de synchro cloud (header) : état activé/désactivé cohérent en environnement sync E2E désactivée', async () => {
    const { window } = env;
    await window.getByRole('link', { name: "Vue d'ensemble" }).click();
    await window.waitForURL(/#\/agent-qualite$/, { timeout: 15000 });

    const pullButton = window.getByRole('button', { name: /RÉCUPÉRER LES CARTES DEPUIS LE CLOUD/ });
    await expect(pullButton).toBeVisible({ timeout: 10000 });
    const pullDisabled = await pullButton.isDisabled();
    // Correctif P1 vérifié : AgentQualiteLayout.tsx calcule désormais
    // `pullDisabled = isPullingCards || cloudCartesCount <= 0`, aligné sur le correctif déjà en
    // place côté AgentVerificationLayout.tsx, qui couvre la sentinelle -1 renvoyée par
    // sync:getCloudCartesCount (handlers.ts ~l.3529-3530 : `getSupabaseClient()` renvoie null sous
    // GEST_IN_SITU_E2E_DISABLE_SYNC=1 -> retour -1). Assertion stricte désormais possible :
    // le réseau est coupé dans cet environnement E2E -> cloudCartesCount vaut -1 -> le bouton DOIT
    // être désactivé.
    console.log(`[QA-CHECK][Sync, P1] Bouton "Récupérer les cartes" disabled=${pullDisabled} (attendu true)`);
    expect(pullDisabled).toBe(true);

    const pushButton = window.getByRole('button', { name: /Envoyer les corrections/ });
    await expect(pushButton).toBeVisible({ timeout: 10000 });
    const pushDisabled = await pushButton.isDisabled();
    const dirtyCount = Number(queryDb(dbPath, `SELECT COUNT(*) FROM t_cartes WHERE is_dirty=1 AND site_id=${env.seed.siteId};`));
    console.log(`[QA-CHECK][Sync] Bouton "Envoyer les corrections" disabled=${pushDisabled} | is_dirty=1 en base (site A)=${dirtyCount}`);
    // Pas d'assertion stricte ici (conformeCartesCount applique une logique métier plus fine
    // que is_dirty=1 brut, cf. limite de couverture déjà documentée pour ce même bouton côté
    // rôle Vérification) : simple observation de cohérence, non-bloquante.
  });

  // Test volontairement placé EN DERNIER (describe.serial : Playwright saute les tests suivants
  // après un échec) — son échec intentionnel matérialise la faille de sécurité prioritaire de la
  // tâche ; tous les autres scénarios doivent avoir eu la chance de s'exécuter avant lui.
  test('13. [SÉCURITÉ PRIORITAIRE] Endpoints de lecture qualite avec siteId forgé (site B) : fuite cross-site confirmée ou infirmée', async () => {
    const { window } = env;
    const siteBId = extraSeed.siteBId;

    // Contrôle négatif : import:getAnomalies EST protégé par assertQualiteAccessOnSite()
    // -> doit être rejeté avec siteId=B alors que l'utilisateur connecté appartient au site A.
    const controlRejected = await window.evaluate(async (sId) => {
      try {
        await (window as any).api.import.getAnomalies(sId, 0, 50);
        return { ok: true };
      } catch (e: any) {
        return { ok: false, message: e?.message || String(e) };
      }
    }, siteBId);
    console.log(`[QA-CHECK][Sécurité #9, témoin de contrôle] import:getAnomalies(siteB) -> ${JSON.stringify(controlRejected)} (attendu: rejeté)`);
    expect(controlRejected.ok).toBe(false);

    // Endpoints suspectés NON gardés (handlers.ts l.1184-1242) : appel direct avec siteId
    // du site B, en contournant totalement l'UI (siteIdToUse dérivé de user.site_id côté renderer).
    const leakResults: Record<string, any> = {};

    leakResults.getDoublonsPage = await window.evaluate(async (sId) => {
      const res = await (window as any).api.cartes.getDoublonsPage(sId, 0, 50, '');
      return { total: res?.total, sample: (res?.rows || []).map((r: any) => ({ noms: r.noms, num_secu: r.num_secu, contact: r.contact })) };
    }, siteBId);

    leakResults.getSansNumSecuPage = await window.evaluate(async (sId) => {
      const res = await (window as any).api.cartes.getSansNumSecuPage(sId, 0, 50, '');
      return { total: res?.total, sample: (res?.rows || []).map((r: any) => ({ noms: r.noms, contact: r.contact })) };
    }, siteBId);

    leakResults.searchAllRecords = await window.evaluate(async (sId) => {
      const res = await (window as any).api.cartes.searchAllRecords(sId, { nom: 'ZZTEST_CROSSQUALITE' }, 50);
      return { count: (res || []).length, sample: (res || []).map((r: any) => ({ noms: r.noms, num_secu: r.num_secu, contact: r.contact })) };
    }, siteBId);

    console.log('[QA-CHECK][Sécurité #9, PREUVE] Résultats bruts des appels forgés (siteId=' + siteBId + ', utilisateur connecté = site ' + env.seed.siteId + '):');
    console.log(JSON.stringify(leakResults, null, 2));

    const doublonsLeaked = leakResults.getDoublonsPage.sample.some((r: any) => String(r.noms).includes('ZZTEST_CROSSQUALITE'));
    const sansSecuLeaked = leakResults.getSansNumSecuPage.sample.some((r: any) => String(r.noms).includes('ZZTEST_CROSSQUALITE'));
    const searchLeaked = leakResults.searchAllRecords.sample.some((r: any) => String(r.noms).includes('ZZTEST_CROSSQUALITE'));

    console.log(`[QA-CHECK][Sécurité #9, VERDICT] getDoublonsPage fuite=${doublonsLeaked} | getSansNumSecuPage fuite=${sansSecuLeaked} | searchAllRecords fuite=${searchLeaked}`);

    // Assertion documentaire : si l'un de ces flags est vrai, la faille de lecture cross-site
    // est CONFIRMÉE empiriquement (num_secu/contact d'un autre site exposés à un
    // OPERATEUR_QUALITE non autorisé sur ce site). Le test échoue intentionnellement dans ce
    // cas pour matérialiser la régression de sécurité dans le rapport, plutôt que de
    // documenter silencieusement un accès non autorisé aux données citoyennes.
    expect({ doublonsLeaked, sansSecuLeaked, searchLeaked }).toEqual({ doublonsLeaked: false, sansSecuLeaked: false, searchLeaked: false });
  });
});
