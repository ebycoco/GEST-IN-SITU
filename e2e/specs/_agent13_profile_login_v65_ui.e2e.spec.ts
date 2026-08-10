/**
 * e2e/specs/_agent13_profile_login_v65_ui.e2e.spec.ts
 *
 * QA Terrain (agent-13) — Revalidation en conditions réelles, sur build FRAIS
 * (`dist/` régénéré via `npx electron-vite build` après purge de
 * `node_modules/.vite` — 31 modules transformés pour le bundle main, un seul
 * `getDatabase()` confirmé dans `dist/main/index.js`), des deux chantiers
 * "Mon Profil" (`src/renderer/src/pages/ProfilePage.tsx`) :
 *
 *   Chantier 1 — Édition du login pour ADMINISTRATEUR_SITE (champ visible
 *     uniquement pour ce rôle, unicité vérifiée côté serveur, identité dérivée
 *     de `getSecureCurrentUser()` — jamais du paramètre client `userId`).
 *   Chantier 2 (volet UI) — Bascule "Récupération Automatique" (clé
 *     `auto_downstream_<id_user>` depuis la migration V65) + le scénario clé
 *     qui a motivé le chantier : changement de login PUIS reconnexion sous le
 *     nouveau login, préférence non orpheline.
 *
 * Isolation : une seule instance Electron lancée sur un `userDataDir` jetable
 * (`launchSeededApp`), seedée avec les comptes `TEST_USERS` réels existants
 * (aucune modification de `e2e/fixtures/test-users.ts` nécessaire — la
 * collision de login utilise le login déjà seedé d'un autre compte de test,
 * et la sonde de sécurité "userId forgé" cible l'id_user d'un autre compte de
 * test déjà présent). Tous les renommages de login utilisent le préfixe
 * `ZZTEST_` (garde-fou §1 du mandat agent-13). Base entièrement jetable,
 * supprimée par `teardownSeededApp` en fin de run (ou conservée pour
 * diagnostic UNIQUEMENT en cas d'échec, comportement standard de la fixture).
 */
import { test, expect, type Page } from '@playwright/test';
import {
  launchSeededApp,
  teardownSeededApp,
  type E2EEnvironment
} from '../fixtures/electron-app';
import { getTestUser } from '../fixtures/test-users';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const NEW_LOGIN = 'ZZTEST_ADMINSITE_LOGIN_V1';
const FORGED_NOM = 'ZZTEST_FORGED_NOM';

test.describe.serial('QA Terrain — ProfilePage Chantiers 1+2 (édition login + migration V65 auto-downstream) (agent-13)', () => {
  let env: E2EEnvironment;
  let anyTestFailed = false;
  let adminSiteId: number;
  let operateurSaisieId: number;

  test.beforeAll(async () => {
    env = await launchSeededApp();
    adminSiteId = env.seed.userIds['administrateurSite'];
    operateurSaisieId = env.seed.userIds['operateurSaisie'];
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

  // ── Helpers ───────────────────────────────────────────────────────────
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

  function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /** Localise l'`<input>` associé à un label exact `.form-label` du formulaire (structure DOM non uniforme : input direct sibling pour Nom/Prénom, input imbriqué dans un wrapper icône pour Email/Téléphone/Login). */
  function fieldInput(window: Page, exactLabel: string) {
    const label = window.locator('label.form-label').filter({ hasText: new RegExp(`^${escapeRegExp(exactLabel)}$`) });
    return label.locator('xpath=following-sibling::*[1]/descendant-or-self::input');
  }

  async function login(loginId: string, password: string): Promise<void> {
    const { window } = env;
    await window.waitForURL(/#\/login/, { timeout: 20000 });
    await window.getByTestId('login-input').fill(loginId);
    await window.getByTestId('password-input').fill(password);
    await window.getByTestId('login-submit').click();
  }

  async function logout(): Promise<void> {
    const { window } = env;
    await window.getByText('Déconnexion').click();
    await window.waitForURL(/#\/login/, { timeout: 20000 });
  }

  async function goToProfile(): Promise<void> {
    const { window } = env;
    await window.getByText('Mon Profil').first().click();
    await window.waitForURL(/#\/profile/, { timeout: 15000 });
  }

  // ═══════════════════════════════════════════════════════════════════
  // CHANTIER 1 — ADMINISTRATEUR_SITE
  // ═══════════════════════════════════════════════════════════════════

  test('1. ADMINISTRATEUR_SITE : champ Login visible et éditable dans le formulaire', async () => {
    const { window } = env;
    const user = getTestUser('administrateurSite');
    await login(user.login, user.password);
    await window.waitForURL(/#\/dashboard/, { timeout: 20000 });
    await goToProfile();

    const loginInput = fieldInput(window, 'Identifiant unique (Login)');
    await expect(loginInput).toBeVisible({ timeout: 10000 });
    await expect(loginInput).toHaveValue(user.login);
    await expect(loginInput).toBeEditable();

    await window.screenshot({
      path: 'C:\\Users\\EBYCHOCO\\AppData\\Local\\Temp\\claude\\d--Espace-travail-GEST-IN-SITU-CARTE-ABOBO-V2\\0ecf52dd-3c68-446e-99c9-2a28cf4e9dcc\\scratchpad\\agent13-v65-01-adminsite-login-field.png'
    });
  });

  test('2. Collision de login rejetée avec message clair, aucune écriture en base (atomicité)', async () => {
    const { window } = env;
    const before = (await dbQuery('SELECT login, nom_user, is_dirty, updated_at FROM t_users WHERE id_user = ?', [adminSiteId]))[0];

    // Le seed ne renseigne pas de colonne email pour les comptes de test (NULL en
    // base) — le champ Email étant `required` au niveau HTML5, il doit être
    // rempli AVANT toute tentative de soumission, sans quoi le navigateur bloque
    // le submit avant même que le JS (et donc le contrôle de collision côté
    // backend) ne s'exécute.
    await fieldInput(window, 'Adresse Email').fill('zztest.adminsite@example.com');
    // Le champ Téléphone par défaut ("+225" sans chiffre local) échoue à la
    // validation client "doit comporter exactement 10 chiffres locaux" AVANT
    // même d'atteindre l'appel backend — fournir un numéro valide pour laisser
    // le scénario atteindre réellement le contrôle de collision de login.
    // `formatPhoneString` exige que la valeur fournie à `fill()` commence déjà
    // par le préfixe "+225 " (sinon elle réinitialise silencieusement le champ).
    await fieldInput(window, 'Téléphone').fill('+225 0102030405');
    const loginInput = fieldInput(window, 'Identifiant unique (Login)');
    await loginInput.fill('E2E_OPERATEUR_SAISIE'); // login déjà utilisé par le compte de test operateurSaisie
    await window.getByRole('button', { name: /Enregistrer/ }).click();

    await expect(window.getByText(/déjà utilisé/i)).toBeVisible({ timeout: 10000 });

    await window.screenshot({
      path: 'C:\\Users\\EBYCHOCO\\AppData\\Local\\Temp\\claude\\d--Espace-travail-GEST-IN-SITU-CARTE-ABOBO-V2\\0ecf52dd-3c68-446e-99c9-2a28cf4e9dcc\\scratchpad\\agent13-v65-02-collision-login-rejetee.png'
    });

    const after = (await dbQuery('SELECT login, nom_user, is_dirty, updated_at FROM t_users WHERE id_user = ?', [adminSiteId]))[0];
    expect(after).toEqual(before);
    expect(after.login).toBe('E2E_ADMINISTRATEUR_SITE');
  });

  test('3. Activation "Récupération Automatique" (clé auto_downstream_<id_user>)', async () => {
    const { window } = env;
    const toggle = window.locator('input[type="checkbox"]');
    await expect(toggle).not.toBeChecked();
    await toggle.evaluate((el: HTMLInputElement) => el.click());
    await expect(window.getByText(/activée/i)).toBeVisible({ timeout: 10000 });

    const rows = await dbQuery('SELECT value FROM t_config WHERE key = ?', [`auto_downstream_${adminSiteId}`]);
    expect(rows.length).toBe(1);
    expect(rows[0].value).toBe('true');
  });

  test('4. Changement de login réussi : écriture en base + réplication immédiate dans la session (useAuthStore)', async () => {
    const { window } = env;
    await fieldInput(window, 'Adresse Email').fill('zztest.adminsite@example.com');
    await fieldInput(window, 'Téléphone').fill('+225 0102030405');
    const loginInput = fieldInput(window, 'Identifiant unique (Login)');
    await loginInput.fill(NEW_LOGIN);
    await window.getByRole('button', { name: /Enregistrer/ }).click();
    await expect(window.getByText('Profil mis à jour avec succès !')).toBeVisible({ timeout: 10000 });

    // Réplication immédiate en mémoire : le libellé "@<login>" en tête de la
    // fiche récapitulative (toujours rendu, indépendamment du rôle) doit
    // refléter le nouveau login SANS rechargement de page.
    await expect(window.getByText(`@${NEW_LOGIN}`)).toBeVisible({ timeout: 5000 });

    const row = (await dbQuery('SELECT login, is_dirty FROM t_users WHERE id_user = ?', [adminSiteId]))[0];
    expect(row.login).toBe(NEW_LOGIN);
    expect(row.is_dirty).toBe(1);

    await window.screenshot({
      path: 'C:\\Users\\EBYCHOCO\\AppData\\Local\\Temp\\claude\\d--Espace-travail-GEST-IN-SITU-CARTE-ABOBO-V2\\0ecf52dd-3c68-446e-99c9-2a28cf4e9dcc\\scratchpad\\agent13-v65-04-login-change-success.png'
    });
  });

  test('5. Sécurité : appel IPC forgé auth:updateSelfProfile(userId falsifié) n\'affecte que la session réelle', async () => {
    const { window } = env;
    // Snapshot AVANT : le compte réellement ciblé par le paramètre forgé (operateurSaisie).
    const targetBefore = (await dbQuery('SELECT nom_user FROM t_users WHERE id_user = ?', [operateurSaisieId]))[0];
    expect(targetBefore.nom_user).not.toBe(FORGED_NOM);

    const outcome = await window.evaluate(async (forgedId: number) => {
      return (window as any).api.auth.updateSelfProfile(forgedId, { nom_user: 'ZZTEST_FORGED_NOM' });
    }, operateurSaisieId);
    expect(outcome?.success).toBe(true);

    // Le compte forgé (operateurSaisie) ne doit PAS avoir bougé.
    const targetAfter = (await dbQuery('SELECT nom_user FROM t_users WHERE id_user = ?', [operateurSaisieId]))[0];
    expect(targetAfter.nom_user).toBe(targetBefore.nom_user);

    // Seule la session réelle (administrateurSite, sous son NOUVEAU login) doit avoir été modifiée.
    const selfAfter = (await dbQuery('SELECT nom_user FROM t_users WHERE id_user = ?', [adminSiteId]))[0];
    expect(selfAfter.nom_user).toBe(FORGED_NOM);
  });

  test('6. [Scénario clé V65] Déconnexion + reconnexion sous le NOUVEAU login → préférence auto-downstream toujours active', async () => {
    const { window } = env;
    await logout();
    await login(NEW_LOGIN, getTestUser('administrateurSite').password);
    await window.waitForURL(/#\/dashboard/, { timeout: 20000 });
    await goToProfile();

    const toggle = window.locator('input[type="checkbox"]');
    await expect(toggle).toBeChecked({ timeout: 10000 });

    // Vérification base : la préférence reste bien indexée par id_user (stable),
    // jamais recréée sous une clé basée sur l'ancien OU le nouveau login.
    const rows = await dbQuery('SELECT key, value FROM t_config WHERE key LIKE ?', ['auto_downstream_%']);
    expect(rows).toEqual([{ key: `auto_downstream_${adminSiteId}`, value: 'true' }]);

    await window.screenshot({
      path: 'C:\\Users\\EBYCHOCO\\AppData\\Local\\Temp\\claude\\d--Espace-travail-GEST-IN-SITU-CARTE-ABOBO-V2\\0ecf52dd-3c68-446e-99c9-2a28cf4e9dcc\\scratchpad\\agent13-v65-06-reconnect-new-login-toggle-still-on.png'
    });
  });

  test('7. Non-régression : Export de la base locale (bouton ADMINISTRATEUR_SITE) toujours câblé', async () => {
    const { window, app } = env;
    await app.evaluate(({ dialog }) => {
      (dialog as any).__originalShowSaveDialog = dialog.showSaveDialog;
      dialog.showSaveDialog = (async () => ({ canceled: true })) as any;
    });
    try {
      await window.getByRole('button', { name: /Exporter la base locale/ }).click();
      await expect(window.getByText("Exportation annulée par l'utilisateur.")).toBeVisible({ timeout: 10000 });
    } finally {
      await app.evaluate(({ dialog }) => {
        dialog.showSaveDialog = (dialog as any).__originalShowSaveDialog;
        delete (dialog as any).__originalShowSaveDialog;
      });
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // SUPER ADMIN — formulaire entièrement désactivé
  // ═══════════════════════════════════════════════════════════════════

  test('8. SUPER ADMIN : formulaire entièrement désactivé, pas de champ Login', async () => {
    const { window } = env;
    await logout();
    const superAdmin = getTestUser('superAdmin');
    await login(superAdmin.login, superAdmin.password);
    await window.waitForURL(/#\/dashboard/, { timeout: 20000 });
    await goToProfile();

    await expect(window.getByText('Modification restreinte')).toBeVisible({ timeout: 10000 });
    // Aucun input de formulaire (nom/prénom/email/téléphone/login/mdp) ne doit être présent.
    await expect(window.locator('form input')).toHaveCount(0);
    // Le login reste affiché en lecture seule dans la fiche récapitulative
    // (deux occurrences légitimes pour SUPER ADMIN/OPERATEUR_* : l'en-tête de
    // la fiche ET le bloc "Identifiant unique (Login)" en lecture seule,
    // celui-ci n'étant rendu QUE quand canEditLogin est faux).
    await expect(window.getByText(`@${superAdmin.login}`).first()).toBeVisible();
    await expect(window.getByText(`@${superAdmin.login}`)).toHaveCount(2);

    await window.screenshot({
      path: 'C:\\Users\\EBYCHOCO\\AppData\\Local\\Temp\\claude\\d--Espace-travail-GEST-IN-SITU-CARTE-ABOBO-V2\\0ecf52dd-3c68-446e-99c9-2a28cf4e9dcc\\scratchpad\\agent13-v65-08-superadmin-disabled.png'
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // OPERATEUR_SAISIE — formulaire éditable SANS champ Login + non-régression
  // ═══════════════════════════════════════════════════════════════════

  test('9. OPERATEUR_SAISIE : formulaire éditable SANS champ Login, login en lecture seule + non-régression MAJ profil', async () => {
    const { window } = env;
    await logout();
    const saisie = getTestUser('operateurSaisie');
    await login(saisie.login, saisie.password);
    await window.waitForURL(/#\/agent-saisie/, { timeout: 20000 });
    await goToProfile();

    // Pas de champ Login éditable dans le formulaire.
    const loginInput = fieldInput(window, 'Identifiant unique (Login)');
    await expect(loginInput).toHaveCount(0);
    // Login affiché en lecture seule dans la fiche récapitulative.
    // Idem test 8 : deux occurrences légitimes du login en lecture seule (en-tête + bloc récapitulatif).
    await expect(window.getByText(`@${saisie.login}`).first()).toBeVisible();
    await expect(window.getByText(`@${saisie.login}`)).toHaveCount(2);

    // Non-régression : MAJ nom/prénom/email/téléphone toujours fonctionnelle.
    await fieldInput(window, 'Prénom').fill('ZZTEST_PrenomModifie');
    await fieldInput(window, 'Nom').fill('ZZTEST_NomModifie');
    await fieldInput(window, 'Adresse Email').fill('zztest.saisie@example.com');
    await fieldInput(window, 'Téléphone').fill('+225 0102030405');
    await window.getByRole('button', { name: /Enregistrer/ }).click();
    await expect(window.getByText('Profil mis à jour avec succès !')).toBeVisible({ timeout: 10000 });

    const row = (await dbQuery(
      'SELECT nom_user, prenom_user, email, telephone, is_dirty FROM t_users WHERE id_user = ?',
      [operateurSaisieId]
    ))[0];
    expect(row.nom_user).toBe('ZZTEST_NomModifie');
    expect(row.prenom_user).toBe('ZZTEST_PrenomModifie');
    expect(row.email).toBe('zztest.saisie@example.com');
    expect(row.is_dirty).toBe(1);

    await window.screenshot({
      path: 'C:\\Users\\EBYCHOCO\\AppData\\Local\\Temp\\claude\\d--Espace-travail-GEST-IN-SITU-CARTE-ABOBO-V2\\0ecf52dd-3c68-446e-99c9-2a28cf4e9dcc\\scratchpad\\agent13-v65-09-operateursaisie-no-login-field.png'
    });
  });

  test('10. Non-régression : Export des logs de diagnostic (bouton visible pour tous les rôles) toujours câblé', async () => {
    const { window, app } = env;
    await app.evaluate(({ dialog }) => {
      (dialog as any).__originalShowSaveDialog = dialog.showSaveDialog;
      dialog.showSaveDialog = (async () => ({ canceled: true })) as any;
    });
    try {
      await window.getByRole('button', { name: /Exporter les logs de diagnostic/ }).click();
      await expect(window.getByText('Exportation annulée par l\'utilisateur.')).toBeVisible({ timeout: 10000 });
    } finally {
      await app.evaluate(({ dialog }) => {
        dialog.showSaveDialog = (dialog as any).__originalShowSaveDialog;
        delete (dialog as any).__originalShowSaveDialog;
      });
    }
  });
});
