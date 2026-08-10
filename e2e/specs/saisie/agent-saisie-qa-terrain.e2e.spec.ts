/**
 * e2e/specs/saisie/agent-saisie-qa-terrain.e2e.spec.ts
 *
 * QA Terrain (agent-13) — Premier passage complet sur le Portail de Saisie
 * (/agent-saisie, rôle OPERATEUR_SAISIE).
 *
 * Couvre : contrôle d'accès, formulaire "Nouvelle Saisie" (SaisiePage.tsx —
 * validations, doublon strict, formatage téléphone, brouillon vs final),
 * "Mes Brouillons" (cloisonnement par agent, recherche, édition, suppression,
 * publication en masse, pagination), "Historique" (badges Local/Cloud,
 * verrouillage post-sync, bug de statut sur SaisieEditModal), "Vue d'ensemble"
 * (compteur du jour, auto-refresh), et cohérence des boutons de synchro Cloud
 * de l'en-tête.
 *
 * Toutes les données créées sont préfixées ZZTEST_ (cartes) ou ZZTEST_ (users),
 * nettoyées en fin de run (test.afterAll), avec vérification explicite du
 * nettoyage.
 */
import { test, expect } from '@playwright/test';
import { launchSeededApp, teardownSeededApp, type E2EEnvironment } from '../../fixtures/electron-app';
import { getTestUser } from '../../fixtures/test-users';
import { hashPassword } from '../../../src/main/auth/local-auth';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

test.describe.serial('Portail de Saisie — OPERATEUR_SAISIE (agent-13)', () => {
  let env: E2EEnvironment;
  let anyTestFailed = false;

  const siteAId = () => env.seed.siteId;
  const siteACentreId = () => env.seed.centreId;
  let agentBUserId: number;
  let agentBLogin: string;

  test.beforeAll(async () => {
    env = await launchSeededApp();
  });

  test.afterAll(async () => {
    if (env) {
      try {
        // `1234500%` : préfixe synthétique dédié aux N° CMU de test de ce spec (FORM-6/7/8,
        // OVERVIEW-1) — nécessaire en filet de sécurité car le brouillon "date valide isolée"
        // de FORM-8 a délibérément noms='' (pour prouver que noms/lieu sont bien optionnels),
        // donc invisible au filtre `noms LIKE 'ZZTEST_%'` seul.
        await dbQuery("DELETE FROM t_cartes WHERE noms LIKE 'ZZTEST\\_%' ESCAPE '\\' OR prenoms LIKE 'ZZTEST\\_%' ESCAPE '\\' OR num_secu LIKE '1234500%'");
        await dbQuery("DELETE FROM t_user_roles WHERE id_user IN (SELECT id_user FROM t_users WHERE login LIKE 'ZZTEST\\_%' ESCAPE '\\')");
        await dbQuery("DELETE FROM t_users WHERE login LIKE 'ZZTEST\\_%' ESCAPE '\\'");
        const remainingCartes: any[] = await dbQuery("SELECT COUNT(*) as c FROM t_cartes WHERE noms LIKE 'ZZTEST\\_%' ESCAPE '\\' OR num_secu LIKE '1234500%'");
        const remainingUsers: any[] = await dbQuery("SELECT COUNT(*) as c FROM t_users WHERE login LIKE 'ZZTEST\\_%' ESCAPE '\\'");
        console.log(`[CLEANUP] Résiduel après nettoyage — cartes: ${remainingCartes[0].c}, users: ${remainingUsers[0].c} (attendu 0 pour les deux)`);
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

  // ── Helper DB : identique au pattern établi (adminsite-qa-terrain.e2e.spec.ts) ──
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

  // ══════════════════════════════════════════════════════════════════════
  // BLOC 0 — Contrôle d'accès
  // ══════════════════════════════════════════════════════════════════════

  test('0a. OPERATEUR_VERIFICATION est bloqué/redirigé loin de /agent-saisie', async () => {
    const { window } = env;
    const opVerif = getTestUser('operateurVerification');
    await window.waitForURL(/#\/login/);
    await window.getByTestId('login-input').fill(opVerif.login);
    await window.getByTestId('password-input').fill(opVerif.password);
    await window.getByTestId('login-submit').click();
    await window.waitForURL(/#\/agent-verification/, { timeout: 20000 });

    // Tentative d'accès forcé via changement de hash direct.
    await window.evaluate(() => { globalThis.location.hash = '#/agent-saisie'; });
    await window.waitForTimeout(1000);
    // ProtectedRoute redirige vers "/" -> RoleRedirect -> /agent-verification pour ce rôle.
    await window.waitForURL(/#\/agent-verification/, { timeout: 10000 });
    await expect(window.getByText('PORTAIL DE SAISIE')).toHaveCount(0);
    console.log('[QA-CHECK][ACCESS] OPERATEUR_VERIFICATION redirigé loin de /agent-saisie : OK');

    // Déconnexion réelle via le bouton "Déconnexion" de la Sidebar, pour la suite du
    // run (bascule sur OPERATEUR_SAISIE).
    await window.getByText('Déconnexion').click();
    await window.waitForURL(/#\/login/, { timeout: 20000 });
  });

  test('0b. Setup : compte OPERATEUR_SAISIE de test + connexion, arrivée sur /agent-saisie', async () => {
    const { window } = env;

    // Le compte 'operateurSaisie' du fixture test-users.ts n'a pas été semé par
    // seedDatabase() (ajouté après ce spike) -> on l'insère nous-mêmes, avec le
    // même schéma que les autres comptes E2E_ (pas de préfixe ZZTEST_ ici pour
    // rester cohérent avec le fixture partagé, mais ce compte est un compte
    // E2E_ standard, pas une donnée citoyenne).
    const opSaisie = getTestUser('operateurSaisie');
    const existing = await dbQuery('SELECT id_user FROM t_users WHERE login = ?', [opSaisie.login]);
    if (existing.length === 0) {
      const now = Date.now();
      const res = await dbQuery(
        `INSERT INTO t_users (login, password_hash, role, nom_user, prenom_user, statut_actif, site_id, centre_id, sync_id, is_dirty)
         VALUES (?, ?, 'OPERATEUR_SAISIE', ?, ?, 1, ?, ?, ?, 0)`,
        [opSaisie.login, opSaisie.passwordHash, opSaisie.nom, opSaisie.prenom, siteAId(), siteACentreId(), `e2e-user-opsaisie-${now}`]
      );
      await dbQuery('INSERT INTO t_user_roles (id_user, role) VALUES (?, ?)', [res[0].lastInsertRowid, 'OPERATEUR_SAISIE']);
    }

    await window.getByTestId('login-input').fill(opSaisie.login);
    await window.getByTestId('password-input').fill(opSaisie.password);
    await window.getByTestId('login-submit').click();
    await window.waitForURL(/#\/agent-saisie$/, { timeout: 20000 });
    await expect(window.getByText('PORTAIL DE SAISIE')).toBeVisible();
    console.log('[QA-CHECK][ACCESS] OPERATEUR_SAISIE atterrit correctement sur /agent-saisie : OK');
  });

  // ══════════════════════════════════════════════════════════════════════
  // BLOC 1 — Formulaire "Nouvelle Saisie" (SaisiePage.tsx)
  // ══════════════════════════════════════════════════════════════════════

  test('FORM-1. Validation finale : Nom/Prénom/Lieu de naissance obligatoires (brouillon non bloqué par ces champs)', async () => {
    const { window } = env;
    await window.getByRole('link', { name: 'Nouvelle Saisie' }).click();
    await window.waitForURL(/#\/agent-saisie\/nouvelle/, { timeout: 15000 });

    const before = await dbQuery("SELECT COUNT(*) as c FROM t_cartes WHERE site_id = ?", [siteAId()]);

    // Formulaire totalement vide -> validation finale via le bouton "Valider la saisie"
    // (type="submit"). CONSTAT EMPIRIQUE : les attributs HTML5 `required` posés sur les
    // <input> (noms/prenoms/lieu_de_naissance/num_secu/DateInput) interceptent la
    // soumission AVANT que le JS de SaisiePage.handleSave() ne s'exécute — le navigateur
    // affiche sa propre bulle native ("Veuillez renseigner ce champ.") sur le premier champ
    // requis vide (noms), et handleSave() n'est jamais appelé. Le toast.error() personnalisé
    // "Les champs Nom de famille, Prénom(s) et Lieu de naissance sont obligatoires." est donc
    // INATTEIGNABLE par ce chemin UI normal (formulaire strictement vide) — voir capture
    // d'écran jointe au rapport. On vérifie ici le comportement RÉEL (blocage natif, DB
    // inchangée), documenté comme observation QA plutôt que comme un échec de test.
    await window.getByRole('button', { name: 'Valider la saisie' }).click();
    await window.waitForTimeout(500);
    const nomsFieldValidationMessage = await window.getByPlaceholder('Ex: KOUASSI').evaluate(
      (el: HTMLInputElement) => el.validationMessage
    );
    console.log(`[QA-CHECK][FORM-1][OBSERVATION] Formulaire vide + "Valider la saisie" -> validation HTML5 native interceptée AVANT le JS (validationMessage du champ noms="${nomsFieldValidationMessage}"). Le toast personnalisé "Les champs Nom de famille, Prénom(s) et Lieu de naissance sont obligatoires." ne s'affiche donc JAMAIS pour un formulaire strictement vide — code mort en pratique pour ce cas précis.`);
    expect(nomsFieldValidationMessage.length).toBeGreaterThan(0); // preuve que le navigateur a bien bloqué nativement

    const after = await dbQuery("SELECT COUNT(*) as c FROM t_cartes WHERE site_id = ?", [siteAId()]);
    expect(after[0].c).toBe(before[0].c);

    // Contournement volontaire pour ATTEINDRE la validation JS métier elle-même : des champs
    // remplis d'un simple espace satisfont `required` (non vide pour le navigateur) mais
    // échouent au `.trim()` de handleSave() -> permet de vérifier que le toast personnalisé
    // est bien correct et fonctionnel LORSQU'il est atteignable (ex: formulaire pré-rempli
    // par une saisie vocale ou un copier-coller contenant des espaces).
    await window.getByPlaceholder('Ex: KOUASSI').fill(' ');
    await window.getByPlaceholder('Ex: JEAN BAPTISTE').fill(' ');
    await window.getByPlaceholder('Ex: ABIDJAN').fill(' ');
    await window.locator('input[placeholder="JJ/MM/AAAA"]').fill('15062000');
    await window.getByPlaceholder('Ex: 3841236548952').fill('1234567890123');
    await window.getByRole('button', { name: 'Valider la saisie' }).click();
    await expect(window.getByText('Les champs Nom de famille, Prénom(s) et Lieu de naissance sont obligatoires.')).toBeVisible({ timeout: 5000 });
    const afterWhitespace = await dbQuery("SELECT COUNT(*) as c FROM t_cartes WHERE site_id = ?", [siteAId()]);
    expect(afterWhitespace[0].c).toBe(before[0].c);
    console.log('[QA-CHECK][FORM-1] Toast JS "Nom/Prénom/Lieu obligatoires" confirmé fonctionnel et correct une fois le blocage natif contourné (champs espaces).');

    // Vide le formulaire avant la suite (les champs espace-only ne doivent pas persister).
    await window.getByRole('button', { name: 'Réinitialiser' }).click();
    await window.getByRole('button', { name: 'Confirmer' }).click();

    // Le même formulaire vide, en brouillon (bouton type="button", ne déclenche PAS la
    // validation HTML5 native — atteint directement handleSave(undefined, true)) : doit être
    // rejeté (aucun des 3 champs nom/prénom/num_secu renseigné), avec le message spécifique
    // du mode brouillon.
    await window.getByRole('button', { name: 'Sauvegarder en brouillon' }).click();
    await expect(window.getByText('Veuillez au moins saisir un nom, un prénom ou un numéro CMU pour le brouillon.')).toBeVisible({ timeout: 5000 });
    const afterDraft = await dbQuery("SELECT COUNT(*) as c FROM t_cartes WHERE site_id = ?", [siteAId()]);
    expect(afterDraft[0].c).toBe(before[0].c);
  });

  test('FORM-2. Date de naissance calendairement impossible (30/02/2000) rejetée en mode final', async () => {
    const { window } = env;
    await window.getByPlaceholder('Ex: KOUASSI').fill('ZZTEST_FORMDATE');
    await window.getByPlaceholder('Ex: JEAN BAPTISTE').fill('INVALID');
    const dateField = window.locator('input[placeholder="JJ/MM/AAAA"]');
    await dateField.fill('30022000');
    await window.getByPlaceholder('Ex: ABIDJAN').fill('ABOBO');
    // Renseigne aussi le N° CMU (requis en HTML5 natif) : sans valeur ici, le navigateur
    // bloquerait la soumission sur CE champ (bulle native) avant même que la validation JS
    // de la date ne s'exécute — voir l'observation détaillée en FORM-1. L'ordre des
    // contrôles dans handleSave() vérifie la date AVANT le N° CMU, donc ce remplissage
    // (valide, 13 chiffres) permet bien d'isoler et d'atteindre la validation JS de date.
    await window.getByPlaceholder('Ex: 3841236548952').fill('1234567890123');

    const before = await dbQuery("SELECT COUNT(*) as c FROM t_cartes WHERE noms = 'ZZTEST_FORMDATE'");
    await window.getByRole('button', { name: 'Valider la saisie' }).click();
    await expect(window.getByText(/Date impossible dans le calendrier/)).toBeVisible({ timeout: 5000 });
    const after = await dbQuery("SELECT COUNT(*) as c FROM t_cartes WHERE noms = 'ZZTEST_FORMDATE'");
    expect(after[0].c).toBe(before[0].c);
    console.log('[QA-CHECK][FORM-2] Date 30/02/2000 correctement rejetée, aucune insertion.');
  });

  test('FORM-3. N° CMU : 12 chiffres rejeté ; 14 chiffres tronqué à 13 par l\'input lui-même (limite préventive côté client)', async () => {
    const { window } = env;
    // Corrige la date en une date valide pour isoler ce test au seul champ CMU.
    const dateField = window.locator('input[placeholder="JJ/MM/AAAA"]');
    await dateField.fill('15062000');

    const cmuInput = window.getByPlaceholder('Ex: 3841236548952');
    await cmuInput.fill('123456789012'); // 12 chiffres
    await expect(cmuInput).toHaveValue('123456789012');

    const before = await dbQuery("SELECT COUNT(*) as c FROM t_cartes WHERE noms = 'ZZTEST_FORMDATE'");
    await window.getByRole('button', { name: 'Valider la saisie' }).click();
    await expect(window.getByText('Le N° de Sécurité Sociale (CMU) est obligatoire et doit faire exactement 13 chiffres.')).toBeVisible({ timeout: 5000 });
    const after = await dbQuery("SELECT COUNT(*) as c FROM t_cartes WHERE noms = 'ZZTEST_FORMDATE'");
    expect(after[0].c).toBe(before[0].c);

    // 14 chiffres : constat empirique de la limite préventive (onChange applique
    // `.replace(/\\D/g,'').substring(0,13)`) -> le 14e chiffre ne peut physiquement
    // pas être saisi, quelle que soit la vitesse de frappe.
    await cmuInput.fill('');
    await cmuInput.fill('12345678901234'); // tentative de 14 chiffres
    const truncatedValue = await cmuInput.inputValue();
    console.log(`[QA-CHECK][FORM-3] Saisie de 14 chiffres -> valeur réellement dans le champ: "${truncatedValue}" (longueur ${truncatedValue.length}, attendu 13 par troncature préventive côté client)`);
    expect(truncatedValue.length).toBe(13);
  });

  test('FORM-4. Formatage téléphone ivoirien +225 XX XX XX XX XX pendant la saisie', async () => {
    const { window } = env;
    const contactInput = window.getByPlaceholder('Ex: +225 07 00 00 00 00');
    await contactInput.fill('0708091011');
    const formatted = await contactInput.inputValue();
    console.log(`[QA-CHECK][FORM-4] Contact "0708091011" formaté en "${formatted}"`);
    expect(formatted).toBe('+225 07 08 09 10 11');
  });

  test('FORM-5. Bouton "Réinitialiser" (Vider le formulaire) demande confirmation avant de réinitialiser', async () => {
    const { window } = env;
    const nomInput = window.getByPlaceholder('Ex: KOUASSI');
    await expect(nomInput).toHaveValue('ZZTEST_FORMDATE'); // état résiduel des tests précédents

    await window.getByRole('button', { name: 'Réinitialiser' }).click();
    await expect(window.getByRole('heading', { name: 'Vider le formulaire' })).toBeVisible({ timeout: 5000 });
    await expect(window.getByText('Voulez-vous vraiment vider le formulaire ?')).toBeVisible();

    // Annulation : le formulaire ne doit PAS être vidé.
    await window.getByRole('button', { name: 'Annuler' }).click();
    await expect(nomInput).toHaveValue('ZZTEST_FORMDATE');

    // Confirmation : le formulaire doit être vidé (site/centre restent pré-remplis).
    await window.getByRole('button', { name: 'Réinitialiser' }).click();
    await window.getByRole('button', { name: 'Confirmer' }).click();
    await expect(nomInput).toHaveValue('');
    console.log('[QA-CHECK][FORM-5] Confirmation obligatoire avant réinitialisation : OK (Annuler préserve, Confirmer vide).');
  });

  let opSaisieUserId: number;

  test('FORM-6. Saisie finale valide : carte créée avec is_dirty=1, agent_saisie, created_by, site/centre corrects, statut EN STOCK, statut_physique OK', async () => {
    const { window } = env;
    const opSaisie = getTestUser('operateurSaisie');
    const userRow = await dbQuery('SELECT id_user FROM t_users WHERE login = ?', [opSaisie.login]);
    opSaisieUserId = userRow[0].id_user;

    await window.getByPlaceholder('Ex: KOUASSI').fill('ZZTEST_VALIDFINAL');
    await window.getByPlaceholder('Ex: JEAN BAPTISTE').fill('AGENT');
    await window.locator('input[placeholder="JJ/MM/AAAA"]').fill('15062000');
    await window.getByPlaceholder('Ex: ABIDJAN').fill('ABOBO');
    await window.getByPlaceholder('Ex: 3841236548952').fill('1234500001111');

    await window.getByRole('button', { name: 'Valider la saisie' }).click();
    await expect(window.getByText('✅ Carte enregistrée avec succès !').first()).toBeVisible({ timeout: 10000 });

    const rows = await dbQuery(
      "SELECT is_dirty, agent_saisie, created_by, site_id, centre_id, statut, statut_physique FROM t_cartes WHERE noms = 'ZZTEST_VALIDFINAL'"
    );
    expect(rows.length).toBe(1);
    const r = rows[0];
    console.log('[QA-CHECK][FORM-6] Carte créée en base:', JSON.stringify(r));
    expect(r.is_dirty).toBe(1);
    expect(r.agent_saisie).toContain('Saisie'); // prenom_user du compte E2E_OPERATEUR_SAISIE
    expect(r.created_by).toBe(opSaisieUserId);
    expect(r.site_id).toBe(siteAId());
    expect(r.centre_id).toBe(siteACentreId());
    expect(r.statut).toBe('EN STOCK');
    expect(r.statut_physique).toBe('OK');
  });

  test('FORM-7. Détection de doublon strict : ressaisir exactement la même identité est rejeté', async () => {
    const { window } = env;
    const before = await dbQuery("SELECT COUNT(*) as c FROM t_cartes WHERE noms = 'ZZTEST_VALIDFINAL'");
    expect(before[0].c).toBe(1);

    // Le formulaire s'est réinitialisé après le succès précédent (mode create) -> ressaisie
    // à l'identique (noms, prénoms, date, lieu, contact identiques => même cle_doublon).
    await window.getByPlaceholder('Ex: KOUASSI').fill('ZZTEST_VALIDFINAL');
    await window.getByPlaceholder('Ex: JEAN BAPTISTE').fill('AGENT');
    await window.locator('input[placeholder="JJ/MM/AAAA"]').fill('15062000');
    await window.getByPlaceholder('Ex: ABIDJAN').fill('ABOBO');
    await window.getByPlaceholder('Ex: 3841236548952').fill('1234500002222'); // CMU différent, reste sans effet sur cle_doublon

    await window.getByRole('button', { name: 'Valider la saisie' }).click();

    // RE-VALIDATION P1-1 (correctif : .startsWith -> .includes dans SaisiePage.handleSave) :
    // `ipcRenderer.invoke` enveloppe le message d'erreur du Main Process dans un préfixe
    // "Error invoking remote method '...': Error: DOUBLON_STRICT: ...", donc err.message ne
    // COMMENCE plus par "DOUBLON_STRICT:" une fois traversé l'IPC (seul .includes() le
    // détecte encore). Le serveur rejette bien le doublon (intégrité DB préservée) ET l'agent
    // doit maintenant voir le toast spécifique et informatif, plus le message générique.
    await expect(window.getByText('⚠️ Doublon détecté : cette carte existe déjà dans la base locale.').first()).toBeVisible({ timeout: 10000 });
    console.log('[QA-CHECK][FORM-7][P1-1 RE-VALIDÉ] Le toast spécifique "⚠️ Doublon détecté : cette carte existe déjà dans la base locale." s\'affiche maintenant correctement (.includes() détecte bien DOUBLON_STRICT: malgré le préfixe ajouté par ipcRenderer.invoke).');

    const after = await dbQuery("SELECT COUNT(*) as c FROM t_cartes WHERE noms = 'ZZTEST_VALIDFINAL'");
    expect(after[0].c).toBe(1); // toujours une seule ligne : l'intégrité de la donnée est préservée
  });

  test('FORM-8. [RE-VALIDATION P0-1] Saisie en brouillon SANS date de naissance : doit maintenant réussir, statut=BROUILLON en base, date vide/null', async () => {
    const { window } = env;
    // Vider le formulaire de la tentative précédente (doublon).
    await window.getByRole('button', { name: 'Réinitialiser' }).click();
    await window.getByRole('button', { name: 'Confirmer' }).click();

    // Un seul des 3 champs (num_secu) rempli, tout le reste vide (y compris la date) -> la
    // règle métier documentée à l'écran ("Sauvegarder en brouillon : Utilisez cette option si
    // des informations manquent") et la validation JS de handleSave(isDraft=true) n'exigent
    // explicitement AUCUN de ces champs. AVANT LE CORRECTIF P0-1, createCarte() imposait quand
    // même isValidDateStrict(ddn) inconditionnellement côté serveur, rendant ce cas
    // IMPOSSIBLE à sauvegarder (voir rapport QA précédent). Le correctif rend
    // isValidDateStrict() conditionnel à `data.statut !== 'BROUILLON'`.
    await window.getByPlaceholder('Ex: 3841236548952').fill('1234500003333');

    const before = await dbQuery("SELECT COUNT(*) as c FROM t_cartes WHERE num_secu = '1234500003333'");
    await window.getByRole('button', { name: 'Sauvegarder en brouillon' }).click();
    await expect(window.getByText('✅ Carte enregistrée avec succès !').first()).toBeVisible({ timeout: 10000 });

    const rowsAfterDateEmpty = await dbQuery("SELECT statut, is_dirty, noms, lieu_de_naissance, date_de_naissance FROM t_cartes WHERE num_secu = '1234500003333'");
    console.log(`[QA-CHECK][FORM-8][P0-1] Tentative brouillon SANS date_de_naissance -> lignes en base: ${rowsAfterDateEmpty.length} (avant: ${before[0].c})`, JSON.stringify(rowsAfterDateEmpty[0]));
    expect(rowsAfterDateEmpty.length).toBe(1);
    expect(rowsAfterDateEmpty[0].statut).toBe('BROUILLON');
    expect(rowsAfterDateEmpty[0].is_dirty).toBe(1);
    expect(rowsAfterDateEmpty[0].date_de_naissance === null || rowsAfterDateEmpty[0].date_de_naissance === '').toBe(true);
    console.log('[QA-CHECK][FORM-8][P0-1 RE-VALIDÉ] Brouillon sans date de naissance créé avec succès : statut=BROUILLON, is_dirty=1, date_de_naissance vide/null en base — le blocage P0 précédent est levé.');

    // Complète maintenant la date (édite ce même brouillon via une 2e saisie distincte pour
    // ne pas perturber le brouillon "date invalide" ci-dessus, qui sert de matière première au
    // scénario BROUILLONS-8 (publishDrafts ignore les dates invalides) plus loin dans ce spec.
    // Seconde carte, avec date valide cette fois, pour prouver que noms/lieu restent
    // réellement optionnels en brouillon indépendamment de la date.
    await window.getByRole('button', { name: 'Réinitialiser' }).click();
    await window.getByRole('button', { name: 'Confirmer' }).click();
    await window.getByPlaceholder('Ex: 3841236548952').fill('1234500003334');
    await window.locator('input[placeholder="JJ/MM/AAAA"]').fill('01011999');
    await window.getByRole('button', { name: 'Sauvegarder en brouillon' }).click();
    await expect(window.getByText('✅ Carte enregistrée avec succès !').first()).toBeVisible({ timeout: 10000 });

    const rows = await dbQuery("SELECT statut, is_dirty, noms, lieu_de_naissance, date_de_naissance FROM t_cartes WHERE num_secu = '1234500003334'");
    expect(rows.length).toBe(1); // preuve qu'avec une date valide (même vide sur tout le reste), le brouillon réussit bien
    console.log('[QA-CHECK][FORM-8] Brouillon créé (avec date valide, isole bien la cause) :', JSON.stringify(rows[0]));
    expect(rows[0].statut).toBe('BROUILLON');
    expect(rows[0].is_dirty).toBe(1);
    expect(rows[0].noms).toBe(''); // confirme que noms/lieu, eux, sont bien réellement optionnels en brouillon
  });

  // ══════════════════════════════════════════════════════════════════════
  // BLOC 2 — Vue d'ensemble : compteur du jour + auto-refresh
  // ══════════════════════════════════════════════════════════════════════

  test('OVERVIEW-1. "Mes saisies aujourd\'hui" correspond à un COUNT(*) réel, et se met à jour SANS clic manuel après une nouvelle saisie', async () => {
    const { window } = env;
    await window.getByRole('link', { name: "Vue d'ensemble" }).click();
    await window.waitForURL(/#\/agent-saisie$/, { timeout: 15000 });

    const dbCountBefore = await dbQuery(
      "SELECT COUNT(*) as c FROM t_cartes WHERE created_by = ? AND created_at >= ?",
      [opSaisieUserId, new Date().toISOString().split('T')[0] + 'T00:00:00.000Z']
    );
    console.log(`[QA-CHECK][OVERVIEW-1] DB COUNT(*) avant = ${dbCountBefore[0].c}`);

    // Crée une nouvelle carte finale depuis "Nouvelle Saisie" SANS jamais revenir cliquer
    // "Actualiser" sur Vue d'ensemble -> vérifie que 'app:data-updated' suffit.
    await window.getByRole('link', { name: 'Nouvelle Saisie' }).click();
    await window.waitForURL(/#\/agent-saisie\/nouvelle/, { timeout: 15000 });
    await window.getByPlaceholder('Ex: KOUASSI').fill('ZZTEST_OVERVIEWCOUNT');
    await window.getByPlaceholder('Ex: JEAN BAPTISTE').fill('AUTOREFRESH');
    await window.locator('input[placeholder="JJ/MM/AAAA"]').fill('10102001');
    await window.getByPlaceholder('Ex: ABIDJAN').fill('ABOBO');
    await window.getByPlaceholder('Ex: 3841236548952').fill('1234500004444');
    await window.getByRole('button', { name: 'Valider la saisie' }).click();
    await expect(window.getByText('✅ Carte enregistrée avec succès !').first()).toBeVisible({ timeout: 10000 });

    await window.getByRole('link', { name: "Vue d'ensemble" }).click();
    await window.waitForURL(/#\/agent-saisie$/, { timeout: 15000 });

    const dbCountAfter = await dbQuery(
      "SELECT COUNT(*) as c FROM t_cartes WHERE created_by = ? AND created_at >= ?",
      [opSaisieUserId, new Date().toISOString().split('T')[0] + 'T00:00:00.000Z']
    );
    expect(dbCountAfter[0].c).toBe(dbCountBefore[0].c + 1);

    // Le "app:data-updated" est dispatché AVANT la navigation (SaisiePage.handleSave), et
    // Overview.fetchStats() l'écoute même en dehors du montage courant ? Non : l'écouteur est
    // scopé au composant monté. On revient donc juste sur Overview (remontage du composant),
    // qui fait un fetch initial -> suffisant pour prouver la cohérence DB/UI sans dépendre du
    // timing exact de l'event si le composant n'était pas monté au moment du dispatch.
    await expect.poll(async () => {
      const text = await window.locator('.glass-card').filter({ hasText: "Mes saisies aujourd'hui" }).first().innerText().catch(() => '');
      return text;
    }, { timeout: 10000 }).toContain(String(dbCountAfter[0].c));
    console.log(`[QA-CHECK][OVERVIEW-1] UI affiche bien ${dbCountAfter[0].c} après la nouvelle saisie (DB confirmée).`);
  });

  test('OVERVIEW-2. Bouton "Actualiser" fonctionne sans erreur et "Activité Récente" affiche les 5 dernières saisies', async () => {
    const { window } = env;
    const refreshBtn = window.getByRole('button', { name: /Actualiser/ });
    await expect(refreshBtn).toBeVisible();
    await refreshBtn.click();
    await expect(window.getByText('Actualisation...')).toBeVisible({ timeout: 3000 }).catch(() => {});
    await expect(refreshBtn).toBeEnabled({ timeout: 10000 });

    const recentRows = await dbQuery(
      'SELECT noms, prenoms FROM t_cartes WHERE created_by = ? ORDER BY created_at DESC LIMIT 5',
      [opSaisieUserId]
    );
    console.log('[QA-CHECK][OVERVIEW-2] 5 dernières saisies attendues (DB):', JSON.stringify(recentRows));
    // La plus récente doit être visible dans "Activité Récente".
    if (recentRows.length > 0) {
      await expect(window.getByText(recentRows[0].prenoms)).toBeVisible({ timeout: 10000 });
    }
  });

  // ══════════════════════════════════════════════════════════════════════
  // BLOC 3 — Mes Brouillons
  // ══════════════════════════════════════════════════════════════════════

  test('BROUILLONS-1. [RE-VALIDATION P0-2] Badge "Mes Brouillons (N)" cohérent avec countDrafts() réel (activeSiteId -> user.site_id pour OPERATEUR_SAISIE)', async () => {
    const { window } = env;
    const draftsInDb = await dbQuery(
      "SELECT COUNT(*) as c FROM t_cartes WHERE site_id = ? AND created_by = ? AND statut = 'BROUILLON' AND is_dirty != -1",
      [siteAId(), opSaisieUserId]
    );
    console.log(`[QA-CHECK][BROUILLONS-1] Brouillons en base pour cet agent: ${draftsInDb[0].c} (attendu 2 : les deux brouillons créés en FORM-8)`);
    expect(draftsInDb[0].c).toBe(2);

    const ipcCount = await window.evaluate(
      (args) => (window as any).api.cartes.countDrafts(args.siteId, { id_user: args.userId }),
      { siteId: siteAId(), userId: opSaisieUserId }
    );
    console.log(`[QA-CHECK][BROUILLONS-1] Appel direct window.api.cartes.countDrafts(siteId, {id_user}) -> ${ipcCount} (attendu ${draftsInDb[0].c})`);
    expect(ipcCount).toBe(draftsInDb[0].c);

    // AVANT LE CORRECTIF P0-2, `activeSiteId` (store) restait TOUJOURS null pour
    // OPERATEUR_SAISIE (peuplé seulement pour ADMINISTRATEUR_SITE/ADMIN_CENTRE/SUPER ADMIN),
    // donc `if (!activeSiteId) return;` empêchait fetchDraftsCount() de jamais s'exécuter — le
    // badge restait invisible/à 0 quel que soit le nombre réel de brouillons. Le correctif
    // utilise `effectiveSiteId = user.site_id` pour ce rôle.
    const badge = window.locator('a', { hasText: 'Mes Brouillons' }).locator('span');
    const publishHeaderBtn = window.getByRole('button', { name: /VALIDER MES BROUILLONS/ });
    await expect(badge).toHaveText(String(draftsInDb[0].c), { timeout: 10000 });
    await expect(publishHeaderBtn).toBeEnabled({ timeout: 10000 });
    console.log('[QA-CHECK][BROUILLONS-1][P0-2 RE-VALIDÉ] Badge "Mes Brouillons" affiche bien le nombre réel de brouillons dès l\'arrivée, sans attente de polling ni navigation manuelle. Bouton "VALIDER MES BROUILLONS" de l\'en-tête actif (effectiveSiteId résolu).');
  });

  test('BROUILLONS-2. [SÉCURITÉ][RE-VALIDATION P1-2] Cloisonnement par agent : le brouillon d\'un 2e OPERATEUR_SAISIE du même site n\'apparaît PAS via l\'UI NI via un appel cartes:getPage forgé sans created_by', async () => {
    const { window } = env;
    // Crée un 2e agent OPERATEUR_SAISIE ZZTEST_ sur le même site/centre, avec son propre brouillon.
    agentBLogin = `ZZTEST_QA_OPSAISIE_B_${Date.now()}`;
    const userRes = await dbQuery(
      `INSERT INTO t_users (login, password_hash, role, nom_user, prenom_user, statut_actif, site_id, centre_id, sync_id, is_dirty)
       VALUES (?, ?, 'OPERATEUR_SAISIE', 'ZZTEST', 'AGENTB', 1, ?, ?, ?, 0)`,
      [agentBLogin, hashPassword('ZZTEST_Pwd_2026!'), siteAId(), siteACentreId(), `zztest-agentb-${Date.now()}`]
    );
    agentBUserId = userRes[0].lastInsertRowid;

    const now = Date.now();
    const cleDoublon = 'ZZTEST_AGENTBDRAFT|SECRET|1999-01-01|ABOBO|';
    await dbQuery(
      `INSERT INTO t_cartes (noms, prenoms, date_de_naissance, lieu_de_naissance, statut, site_id, centre_id, created_by, cle_doublon, sync_id, is_dirty)
       VALUES ('ZZTEST_AGENTBDRAFT', 'SECRET', '1999-01-01', 'ABOBO', 'BROUILLON', ?, ?, ?, ?, ?, 1)`,
      [siteAId(), siteACentreId(), agentBUserId, cleDoublon, `zztest-agentbdraft-${now}`]
    );

    // Vérification UI normale : la liste "Mes Brouillons" de l'agent A NE DOIT PAS afficher ce brouillon.
    await window.getByRole('link', { name: 'Mes Brouillons' }).click();
    await window.waitForURL(/#\/agent-saisie\/brouillons/, { timeout: 15000 });
    // RE-VALIDATION P0-2 : la page ne doit plus jamais rester bloquée sur "Chargement en cours..."
    await expect(window.getByText('Chargement en cours...')).toHaveCount(0, { timeout: 20000 });
    const pageText = await window.locator('body').innerText();
    expect(pageText).not.toContain('ZZTEST_AGENTBDRAFT');
    console.log('[QA-CHECK][BROUILLONS-2] UI normale (client envoie created_by=soi-même) : cloisonnement respecté, page chargée sans blocage, OK.');

    // RE-VALIDATION P1-2 : appel IPC forcé au même endpoint (cartes:getPage), filtré uniquement
    // sur statut+site_id, SANS le filtre created_by envoyé normalement par MesBrouillonsView.tsx.
    // Le handler doit désormais réimposer created_by=secureUser.id_user côté serveur pour
    // OPERATEUR_SAISIE + statut=BROUILLON, même si le client tente de forger un appel sans ce filtre.
    const forgedResult: any = await window.evaluate(
      (siteId) => (window as any).api.cartes.getPage(0, 100, { statut: 'BROUILLON', site_id: String(siteId) }),
      siteAId()
    );
    const leaked = (forgedResult?.rows || []).some((r: any) => r.noms === 'ZZTEST_AGENTBDRAFT');
    console.log(`[QA-CHECK][BROUILLONS-2][SÉCURITÉ] Appel cartes:getPage forcé sans filtre created_by -> brouillon de l'agent B visible depuis la session de l'agent A = ${leaked} (nb lignes retournées: ${(forgedResult?.rows || []).length}, attendu 2 : les 2 brouillons propres à l'agent A)`);
    expect(leaked).toBe(false);
    expect((forgedResult?.rows || []).every((r: any) => r.created_by === opSaisieUserId)).toBe(true);
    console.log('[QA-CHECK][BROUILLONS-2][P1-2 RE-VALIDÉ] cartes:getPage réimpose désormais created_by côté serveur pour OPERATEUR_SAISIE+BROUILLON : plus aucune fuite via appel IPC forgé.');
  });

  test('BROUILLONS-3. Recherche par nom/prénom/N° CMU fonctionnelle', async () => {
    const { window } = env;
    // Re-déclenche un fetch propre en re-naviguant sur l'onglet.
    await window.getByRole('link', { name: "Vue d'ensemble" }).click();
    await window.getByRole('link', { name: 'Mes Brouillons' }).click();
    await window.waitForURL(/#\/agent-saisie\/brouillons/, { timeout: 15000 });
    await expect(window.getByText('Chargement en cours...')).toHaveCount(0, { timeout: 20000 });

    const searchInput = window.getByPlaceholder('Rechercher par nom ou N° CMU...');
    await searchInput.fill('1234500003333'); // num_secu du brouillon "date invalide" créé en FORM-8
    await window.waitForTimeout(300);
    await expect(window.locator('body')).toContainText('1234500003333', { timeout: 10000 });

    await searchInput.fill('INTROUVABLE_ZZTEST_XYZ');
    await window.waitForTimeout(300);
    await expect(window.getByText('Aucun brouillon trouvé.')).toBeVisible({ timeout: 5000 });
    await searchInput.fill('');
    console.log('[QA-CHECK][BROUILLONS-3] Recherche fonctionnelle, page chargée sans blocage (P0-2 re-validé indirectement).');
  });

  test('BROUILLONS-4. "Modifier" ouvre SaisieEditModal seulement si is_dirty=1 ET statut=BROUILLON, sinon "Verrouillé"', async () => {
    const { window } = env;
    // Force un brouillon "verrouillé" côté agent A (is_dirty=0, situation anormale en pratique
    // mais permet de vérifier la condition canEdit exacte du composant).
    const now = Date.now();
    const cleDoublon = `ZZTEST_LOCKEDDRAFT|X|1998-01-01|ABOBO|`;
    await dbQuery(
      `INSERT INTO t_cartes (noms, prenoms, date_de_naissance, lieu_de_naissance, statut, site_id, centre_id, created_by, cle_doublon, sync_id, is_dirty)
       VALUES ('ZZTEST_LOCKEDDRAFT', 'X', '1998-01-01', 'ABOBO', 'BROUILLON', ?, ?, ?, ?, ?, 0)`,
      [siteAId(), siteACentreId(), opSaisieUserId, cleDoublon, `zztest-lockeddraft-${now}`]
    );

    try {
      // Rafraîchit la liste (re-navigation).
      await window.getByRole('link', { name: "Vue d'ensemble" }).click();
      await window.getByRole('link', { name: 'Mes Brouillons' }).click();
      await window.waitForURL(/#\/agent-saisie\/brouillons/, { timeout: 15000 });
      await expect(window.getByText('Chargement en cours...')).toHaveCount(0, { timeout: 20000 });

      const lockedRow = window.locator('tr').filter({ hasText: 'ZZTEST_LOCKEDDRAFT' });
      await expect(lockedRow).toBeVisible({ timeout: 10000 });
      await expect(lockedRow.getByText('Verrouillé')).toBeVisible();
      await expect(lockedRow.getByRole('button', { name: 'Modifier' })).toHaveCount(0);
      console.log('[QA-CHECK][BROUILLONS-4] Brouillon avec is_dirty=0 correctement affiché "Verrouillé", pas de bouton Modifier.');

      // Le brouillon "date invalide" (is_dirty=1, FORM-8) doit lui avoir "Modifier" actif.
      const editableRow = window.locator('tr').filter({ hasText: '1234500003333' });
      await expect(editableRow).toBeVisible({ timeout: 10000 });
      await editableRow.getByRole('button', { name: 'Modifier' }).click();
      await expect(window.getByText('Modification de Carte CMU')).toBeVisible({ timeout: 10000 });

      // Modification réelle : complète le nom (vide jusqu'ici) puis enregistre en brouillon
      // (bouton "Sauvegarder en brouillon" reste disponible même en mode edit). La date reste
      // volontairement vide/invalide : ce brouillon sert de matière première au scénario dédié
      // du correctif "publishDrafts revalide la date" (BROUILLONS-7 ci-dessous).
      const modalNomInput = window.getByPlaceholder('Ex: KOUASSI');
      await modalNomInput.fill('ZZTEST_BROUILLONEDITED');
      await window.getByRole('button', { name: 'Sauvegarder en brouillon' }).click();
      await expect(window.getByText('✅ Carte mise à jour avec succès !').first()).toBeVisible({ timeout: 10000 });

      const afterEdit = await dbQuery("SELECT noms, statut, date_de_naissance FROM t_cartes WHERE num_secu = '1234500003333'");
      console.log('[QA-CHECK][BROUILLONS-4] Après édition via modal:', JSON.stringify(afterEdit[0]));
      expect(afterEdit[0].noms).toBe('ZZTEST_BROUILLONEDITED');
      expect(afterEdit[0].statut).toBe('BROUILLON'); // reste brouillon (bouton "Sauvegarder en brouillon" utilisé)
      expect(afterEdit[0].date_de_naissance === null || afterEdit[0].date_de_naissance === '').toBe(true); // date toujours invalide/vide
    } finally {
      // Nettoyage immédiat de l'artefact synthétique ZZTEST_LOCKEDDRAFT (is_dirty=0, cas
      // anormal en pratique — une carte BROUILLON n'est normalement jamais is_dirty=0) : sa
      // persistance perturberait le comptage des scénarios de publication suivants.
      await dbQuery("DELETE FROM t_cartes WHERE noms = 'ZZTEST_LOCKEDDRAFT'");
    }
  });

  test('BROUILLONS-5. Suppression d\'un brouillon : confirmation obligatoire, effet réel vérifié en base', async () => {
    const { window } = env;
    const now = Date.now();
    const cleDoublon = `ZZTEST_TODELETE|X|1997-01-01|ABOBO|`;
    const insertRes = await dbQuery(
      `INSERT INTO t_cartes (noms, prenoms, date_de_naissance, lieu_de_naissance, statut, site_id, centre_id, created_by, cle_doublon, sync_id, is_dirty)
       VALUES ('ZZTEST_TODELETE', 'X', '1997-01-01', 'ABOBO', 'BROUILLON', ?, ?, ?, ?, ?, 1)`,
      [siteAId(), siteACentreId(), opSaisieUserId, cleDoublon, `zztest-todelete-${now}`]
    );
    const idToDelete = insertRes[0].lastInsertRowid;

    try {
      await window.getByRole('link', { name: "Vue d'ensemble" }).click();
      await window.getByRole('link', { name: 'Mes Brouillons' }).click();
      await window.waitForURL(/#\/agent-saisie\/brouillons/, { timeout: 15000 });
      await expect(window.getByText('Chargement en cours...')).toHaveCount(0, { timeout: 20000 });

      const row = window.locator('tr').filter({ hasText: 'ZZTEST_TODELETE' });
      await expect(row).toBeVisible({ timeout: 10000 });
      await row.locator('button[title="Supprimer"]').click();
      await expect(window.getByRole('heading', { name: 'Supprimer le brouillon' })).toBeVisible({ timeout: 5000 });

      // Annulation d'abord : la ligne doit rester.
      await window.getByRole('button', { name: 'Annuler' }).click();
      const stillThere = await dbQuery('SELECT is_dirty FROM t_cartes WHERE id_carte = ?', [idToDelete]);
      expect(stillThere.length).toBe(1);
      expect(stillThere[0].is_dirty).toBe(1);

      // Confirmation réelle.
      await row.locator('button[title="Supprimer"]').click();
      await expect(window.getByRole('heading', { name: 'Supprimer le brouillon' })).toBeVisible({ timeout: 5000 });
      await window.getByRole('button', { name: 'Confirmer' }).click();
      await expect(window.getByText('Brouillon supprimé avec succès.').first()).toBeVisible({ timeout: 10000 });

      const afterDelete = await dbQuery('SELECT id_carte, is_dirty FROM t_cartes WHERE id_carte = ?', [idToDelete]);
      console.log('[QA-CHECK][BROUILLONS-5] État DB après suppression:', JSON.stringify(afterDelete));
      if (afterDelete.length === 0) {
        console.log('[QA-CHECK][BROUILLONS-5] Suppression physique réelle (DELETE) confirmée.');
      } else {
        console.log(`[QA-CHECK][BROUILLONS-5][ÉCART DOCUMENTÉ, non lié aux 7 correctifs] La ligne physique SUBSISTE en base avec is_dirty=${afterDelete[0].is_dirty} : soft-delete (comme le reste de l'application, voir deleteCarte/cancelPendingInsert), PAS un DELETE physique immédiat. Cohérent avec le comportement déjà documenté pour le portail Qualité.`);
      }
      await expect(row).not.toBeVisible({ timeout: 10000 });
    } catch (e: any) {
      await dbQuery('DELETE FROM t_cartes WHERE id_carte = ?', [idToDelete]).catch(() => {});
      throw e;
    }
  });

  test('BROUILLONS-6. Pagination : boutons Précédent/Suivant correctement désactivés aux bornes (jeu de données réduit)', async () => {
    const { window } = env;
    const prevBtn = window.getByRole('button', { name: /Précédent/ });
    const nextBtn = window.getByRole('button', { name: /Suivant/ });
    const paginationVisible = await prevBtn.count() > 0;
    if (!paginationVisible) {
      console.log('[QA-CHECK][BROUILLONS-6] Pas assez de brouillons (< 25) pour afficher la pagination — comportement attendu (total > limit uniquement). Non bloquant.');
    } else {
      await expect(prevBtn).toBeDisabled();
      await expect(nextBtn).toBeDisabled(); // un seul écran de résultats dans ce jeu de test réduit
    }
  });

  test('BROUILLONS-7. [NOUVEAU — point 3] "VALIDER MES BROUILLONS" (en-tête) : le brouillon à date invalide reste BROUILLON, seul celui à date valide passe EN STOCK, toast mentionne le nombre ignoré', async () => {
    const { window } = env;
    // État attendu à ce stade : exactement 2 brouillons is_dirty=1 pour cet agent —
    // num_secu=1234500003333 (noms='ZZTEST_BROUILLONEDITED' depuis BROUILLONS-4, date_de_naissance
    // vide/invalide) et num_secu=1234500003334 (noms='', date_de_naissance='1999-01-01', valide).
    const draftsBefore = await dbQuery(
      "SELECT id_carte, num_secu, date_de_naissance FROM t_cartes WHERE site_id = ? AND created_by = ? AND statut = 'BROUILLON' AND is_dirty = 1",
      [siteAId(), opSaisieUserId]
    );
    console.log('[QA-CHECK][BROUILLONS-7] Brouillons is_dirty=1 de l\'agent avant publication:', JSON.stringify(draftsBefore));
    expect(draftsBefore.length).toBe(2);
    const invalidDateCarte = draftsBefore.find((d: any) => d.num_secu === '1234500003333');
    const validDateCarte = draftsBefore.find((d: any) => d.num_secu === '1234500003334');
    expect(invalidDateCarte).toBeTruthy();
    expect(validDateCarte).toBeTruthy();
    expect(invalidDateCarte.date_de_naissance === null || invalidDateCarte.date_de_naissance === '').toBe(true);
    expect(validDateCarte.date_de_naissance).toBe('1999-01-01');

    // Re-navigue sur "Mes Brouillons" (RE-VALIDATION P0-2 : plus de blocage "Chargement en cours...")
    // puis clique le bouton "VALIDER MES BROUILLONS" de l'en-tête (AgentSaisieLayout.tsx,
    // effectiveSiteId désormais résolu pour OPERATEUR_SAISIE).
    await window.getByRole('link', { name: "Vue d'ensemble" }).click();
    await window.getByRole('link', { name: 'Mes Brouillons' }).click();
    await window.waitForURL(/#\/agent-saisie\/brouillons/, { timeout: 15000 });
    await expect(window.getByText('Chargement en cours...')).toHaveCount(0, { timeout: 20000 });

    const publishHeaderBtn = window.getByRole('button', { name: /VALIDER MES BROUILLONS/ });
    await expect(publishHeaderBtn).toBeEnabled({ timeout: 10000 });
    await publishHeaderBtn.click();

    // Toast attendu (point 3) : mentionne à la fois le nombre publié ET le nombre ignoré.
    // `page.waitForFunction` avec `polling: 'raf'` évalue le prédicat DANS le renderer à chaque
    // frame (pas d'aller-retour CDP par vérification comme un expect.poll externe), ce qui est
    // nécessaire ici : le toast (toastOptions duration=4000ms, App.tsx) peut être manqué par un
    // polling externe si le process principal est occupé (transaction publishDrafts() +
    // rafraîchissement loadStats() derrière ce même clic).
    const toastAppeared = await window.waitForFunction(
      () => document.body.innerText.includes('brouillon(s) publié(s)') && document.body.innerText.includes('ignoré(s)'),
      null,
      { timeout: 10000, polling: 'raf' }
    ).then(() => true).catch(() => false);

    if (!toastAppeared) {
      const finalText = await window.locator('body').innerText().catch(() => '');
      console.log('[QA-CHECK][BROUILLONS-7][DIAGNOSTIC] Toast non capturé même avec polling raf — état final de page (500 premiers caractères) :', finalText.slice(0, 500));
    } else {
      console.log('[QA-CHECK][BROUILLONS-7] Toast "VALIDER MES BROUILLONS" capturé, affiche bien le nombre publié ET le nombre ignoré pour date invalide.');
    }
    expect(toastAppeared).toBe(true);

    const invalidAfter = await dbQuery('SELECT statut, is_dirty FROM t_cartes WHERE id_carte = ?', [invalidDateCarte.id_carte]);
    const validAfter = await dbQuery('SELECT statut, is_dirty FROM t_cartes WHERE id_carte = ?', [validDateCarte.id_carte]);
    console.log(`[QA-CHECK][BROUILLONS-7] Après publication — date invalide (id=${invalidDateCarte.id_carte}): ${JSON.stringify(invalidAfter[0])} (attendu statut=BROUILLON) | date valide (id=${validDateCarte.id_carte}): ${JSON.stringify(validAfter[0])} (attendu statut=EN STOCK)`);
    expect(invalidAfter[0].statut).toBe('BROUILLON');
    expect(invalidAfter[0].is_dirty).toBe(1);
    expect(validAfter[0].statut).toBe('EN STOCK');
    console.log('[QA-CHECK][BROUILLONS-7][NOUVEAU CORRECTIF RE-VALIDÉ] publishDrafts() revalide bien la date avant publication : le brouillon à date invalide/vide n\'est JAMAIS promu silencieusement en EN STOCK, il reste BROUILLON ; skippedInvalidDateCount correctement reflété dans le toast.');

    // Nettoyage : republie le brouillon restant (date invalide) avec une date valide, pour ne
    // pas laisser d'artefact non nettoyable par la simple suppression ZZTEST_ (le filtre de
    // nettoyage cible noms/num_secu, pas le statut) — en réalité DELETE le couvre déjà (num_secu
    // LIKE '1234500%'), donc rien à faire de plus ici ; le CLEANUP final purge cette ligne.
  });

  // ══════════════════════════════════════════════════════════════════════
  // BLOC 4 — Historique
  // ══════════════════════════════════════════════════════════════════════

  test('HISTORIQUE-1. Liste toutes les saisies de l\'agent (pas seulement les brouillons), triées de la plus récente à la plus ancienne', async () => {
    const { window } = env;
    await window.getByRole('link', { name: 'Historique des saisies' }).click();
    await window.waitForURL(/#\/agent-saisie\/historique/, { timeout: 15000 });

    const dbRows = await dbQuery(
      'SELECT noms, created_at FROM t_cartes WHERE created_by = ? ORDER BY created_at DESC LIMIT 5',
      [opSaisieUserId]
    );
    console.log('[QA-CHECK][HISTORIQUE-1] 5 plus récentes en base:', JSON.stringify(dbRows));
    expect(dbRows.length).toBeGreaterThan(0);
    // La plus récente en base doit être la première ligne visible du tableau.
    const firstRow = window.locator('tbody tr').first();
    await expect(firstRow).toContainText(dbRows[0].noms, { timeout: 10000 });
  });

  test('HISTORIQUE-2. Badge Local (is_dirty=1) vs Cloud (is_dirty=0) cohérent avec la base ; verrouillage effectif une fois is_dirty=0', async () => {
    const { window } = env;
    const dirtyRow = await dbQuery("SELECT id_carte FROM t_cartes WHERE noms = 'ZZTEST_VALIDFINAL'");
    const idCarte = dirtyRow[0].id_carte;

    // État initial : is_dirty=1 -> badge "Local", bouton "Modifier" actif.
    let row = window.locator('tr').filter({ hasText: 'ZZTEST_VALIDFINAL' });
    await expect(row).toBeVisible({ timeout: 10000 });
    await expect(row.getByText('Local')).toBeVisible();
    await expect(row.getByRole('button', { name: 'Modifier' })).toBeVisible();

    // Simule une synchronisation réussie (is_dirty=0) directement en base.
    await dbQuery('UPDATE t_cartes SET is_dirty = 0 WHERE id_carte = ?', [idCarte]);
    await window.getByRole('link', { name: "Vue d'ensemble" }).click();
    await window.getByRole('link', { name: 'Historique des saisies' }).click();
    await window.waitForURL(/#\/agent-saisie\/historique/, { timeout: 15000 });

    row = window.locator('tr').filter({ hasText: 'ZZTEST_VALIDFINAL' });
    await expect(row).toBeVisible({ timeout: 10000 });
    await expect(row.getByText('Cloud')).toBeVisible();
    await expect(row.getByText('Verrouillé')).toBeVisible();
    await expect(row.getByRole('button', { name: 'Modifier' })).toHaveCount(0);
    console.log('[QA-CHECK][HISTORIQUE-2] is_dirty=0 -> badge Cloud + Verrouillé confirmé, cohérent avec la base.');
  });

  test('HISTORIQUE-3. Recherche par nom/prénom/N° CMU fonctionnelle', async () => {
    const { window } = env;
    const searchInput = window.getByPlaceholder('Rechercher par nom ou N° CMU...');
    await searchInput.fill('ZZTEST_OVERVIEWCOUNT');
    await window.waitForTimeout(300);
    await expect(window.getByText('ZZTEST_OVERVIEWCOUNT')).toBeVisible({ timeout: 5000 });
    await searchInput.fill('INTROUVABLE_ZZTEST_XYZ');
    await window.waitForTimeout(300);
    await expect(window.getByText('Aucune saisie trouvée.')).toBeVisible({ timeout: 5000 });
    await searchInput.fill('');
  });

  test('HISTORIQUE-4. [RE-VALIDATION P0-3] Édition via SaisieEditModal d\'une carte non-BROUILLON (DELIVRE, is_dirty=1) : le statut DELIVRE doit rester inchangé après modification d\'un champ secondaire', async () => {
    const { window } = env;
    const now = Date.now();
    const cleDoublon = `ZZTEST_DELIVREEDIT|X|1996-01-01|ABOBO|`;
    const insertRes = await dbQuery(
      `INSERT INTO t_cartes (noms, prenoms, date_de_naissance, lieu_de_naissance, num_secu, statut, site_id, centre_id, created_by, cle_doublon, sync_id, is_dirty, rangement)
       VALUES ('ZZTEST_DELIVREEDIT', 'X', '1996-01-01', 'ABOBO', '1234500009999', 'DELIVRE', ?, ?, ?, ?, ?, 1, 'RANG-AVANT')`,
      [siteAId(), siteACentreId(), opSaisieUserId, cleDoublon, `zztest-delivreedit-${now}`]
    );
    const idCarte = insertRes[0].lastInsertRowid;

    await window.getByRole('link', { name: "Vue d'ensemble" }).click();
    await window.getByRole('link', { name: 'Historique des saisies' }).click();
    await window.waitForURL(/#\/agent-saisie\/historique/, { timeout: 15000 });

    const row = window.locator('tr').filter({ hasText: 'ZZTEST_DELIVREEDIT' });
    await expect(row).toBeVisible({ timeout: 10000 });
    // canEdit dans HistoriqueView.tsx = is_dirty===1 uniquement (indépendant du statut) -> doit être éditable.
    await row.getByRole('button', { name: 'Modifier' }).click();
    await expect(window.getByText('Modification de Carte CMU')).toBeVisible({ timeout: 10000 });

    const rangementInput = window.locator('input[placeholder="Ex: BOITE 42 / RAYON C"]');
    await rangementInput.fill('RANG-APRES-EDIT');
    await window.getByRole('button', { name: 'Enregistrer les modifications' }).click();
    await expect(window.getByText('✅ Carte mise à jour avec succès !').first()).toBeVisible({ timeout: 10000 });

    const after = await dbQuery('SELECT statut, rangement FROM t_cartes WHERE id_carte = ?', [idCarte]);
    console.log(`[QA-CHECK][HISTORIQUE-4] Après édition + "Enregistrer les modifications" d'une carte initialement DELIVRE: statut="${after[0].statut}" rangement="${after[0].rangement}" (attendu métier: statut INCHANGÉ = DELIVRE)`);
    // AVANT LE CORRECTIF P0-3, SaisiePage.tsx (mode='edit') calculait
    // finalData.statut = (formData as any).statut || 'EN STOCK' — or SaisieEditModal.tsx ne
    // transmettait jamais `statut` dans `initialData`, donc formData.statut était TOUJOURS
    // undefined en mode edit, et "Enregistrer les modifications" retombait systématiquement sur
    // 'EN STOCK', quel que soit le statut réel d'origine (DELIVRE écrasé silencieusement). Le
    // correctif omet désormais la clé `statut` du payload quand elle n'est pas connue en mode
    // edit, ce qui laisse updateCarte() ne PAS toucher la colonne statut (filteredKeys).
    expect(after[0].statut).toBe('DELIVRE');
    expect(after[0].rangement).toBe('RANG-APRES-EDIT'); // le champ réellement modifié est bien sauvegardé
    console.log('[QA-CHECK][HISTORIQUE-4][P0-3 RE-VALIDÉ] Le statut DELIVRE original a bien été préservé ; seul le champ rangement modifié a été mis à jour.');
  });

  // ══════════════════════════════════════════════════════════════════════
  // BLOC 5 — Boutons de synchro Cloud (en-tête)
  // ══════════════════════════════════════════════════════════════════════

  test('SYNC-1. [RE-VALIDATION P1-3] Bouton "Télécharger depuis le Cloud" désactivé quand cloudCartesCount vaut la sentinelle -1 (réseau coupé en E2E)', async () => {
    const { window } = env;
    const pullButton = window.getByRole('button', { name: /Télécharger depuis le Cloud|TÉLÉCHARGEMENT EN COURS/ });
    await expect(pullButton).toBeVisible({ timeout: 15000 });
    const pullDisabled = await pullButton.isDisabled();
    console.log(`[QA-CHECK][SYNC-1] Bouton "Télécharger depuis le Cloud" disabled=${pullDisabled} (réseau coupé -> cloudCartesCount attendu sentinelle -1, doit être désactivé)`);
    // AVANT LE CORRECTIF P1-3, AgentSaisieLayout.tsx calculait `pullDisabled = isPullingCards ||
    // cloudCartesCount === 0` (comparaison stricte à 0), alors que `sync:getCloudCartesCount`
    // renvoie la sentinelle -1 quand `getSupabaseClient()` est null (réseau coupé) — `-1 === 0`
    // est faux, donc le bouton restait ACTIF hors ligne. Correctif : `cloudCartesCount <= 0`,
    // aligné sur AgentVerificationLayout.tsx / AgentQualiteLayout.tsx.
    expect(pullDisabled).toBe(true);
    console.log('[QA-CHECK][SYNC-1][P1-3 RE-VALIDÉ] Bouton "Télécharger depuis le Cloud" correctement désactivé réseau coupé (cloudCartesCount <= 0 couvre bien la sentinelle -1).');

    const dirtyCount = await dbQuery('SELECT COUNT(*) as c FROM t_cartes WHERE is_dirty = 1 AND site_id = ?', [siteAId()]);
    const pushButton = window.getByRole('button', { name: /Synchroniser vers le Cloud|ENVOI/ });
    await expect(pushButton).toBeVisible({ timeout: 15000 });
    const pushDisabled = await pushButton.isDisabled();
    console.log(`[QA-CHECK][SYNC-1] Bouton "Synchroniser vers le Cloud" disabled=${pushDisabled} | is_dirty=1 en base (site A)=${dirtyCount[0].c} (conformeCount peut différer de is_dirty brut : pas d'assertion stricte, simple observation de cohérence).`);
  });

  // ══════════════════════════════════════════════════════════════════════
  // NETTOYAGE FINAL — artefacts ZZTEST_ résiduels
  // ══════════════════════════════════════════════════════════════════════

  test('CLEANUP. Suppression et vérification de tous les artefacts ZZTEST_ résiduels', async () => {
    // `1234500%` couvre aussi le brouillon "date valide isolée" de FORM-8 (noms='' volontaire,
    // donc invisible au filtre noms LIKE 'ZZTEST_%' seul — voir commentaire détaillé afterAll).
    const cartesDeleted = await dbQuery("DELETE FROM t_cartes WHERE noms LIKE 'ZZTEST\\_%' ESCAPE '\\' OR num_secu LIKE '1234500%'");
    const usersDeleted = await dbQuery("DELETE FROM t_users WHERE login LIKE 'ZZTEST\\_%' ESCAPE '\\'");
    console.log(`[CLEANUP] Supprimés — cartes: ${cartesDeleted[0].changes}, users: ${usersDeleted[0].changes}`);

    const remainingCartes = await dbQuery("SELECT COUNT(*) as c FROM t_cartes WHERE noms LIKE 'ZZTEST\\_%' ESCAPE '\\' OR num_secu LIKE '1234500%'");
    const remainingUsers = await dbQuery("SELECT COUNT(*) as c FROM t_users WHERE login LIKE 'ZZTEST\\_%' ESCAPE '\\'");
    expect(remainingCartes[0].c).toBe(0);
    expect(remainingUsers[0].c).toBe(0);
  });
});
