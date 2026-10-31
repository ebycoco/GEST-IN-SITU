/**
 * e2e/specs/security/p0-database-import-login-ui.e2e.spec.ts
 *
 * Complète p0-database-export-import-rbac.e2e.spec.ts : ce spec-là prouve le
 * gate serveur (`database:import` fail-closed) en appelant `window.api.database
 * .import()` directement via `window.evaluate` (bypass UI), et documentait
 * explicitement que la modale de LoginPage.tsx n'exposait alors AUCUN champ
 * mot de passe (STOP & WARN, hors périmètre de cette tâche-là).
 *
 * Suite explicitement autorisée par l'utilisateur : LoginPage.tsx +
 * preload/index.ts ont depuis été mis à jour pour collecter et transmettre
 * ce mot de passe. Ce spec teste donc la plomberie UI réelle bouton par
 * bouton (pas d'appel direct à l'API) :
 *   1. Le bouton "Oui, Importer" est désactivé tant qu'aucun mot de passe
 *      n'est saisi.
 *   2. Un mauvais mot de passe saisi dans le vrai champ, via un vrai clic,
 *      est rejeté ('unauthorized') et la base réelle reste inchangée.
 *   3. Le VRAI mot de passe SUPER ADMIN saisi via le vrai champ franchit le
 *      contrôle serveur : la requête atteint le dialogue natif
 *      `dialog.showOpenDialog`, mocké ici (comme dans le spec RBAC existant)
 *      pour renvoyer `canceled: true` — preuve que le gate est passé, SANS
 *      jamais déclencher le remplacement réel de fichier ni
 *      `app.relaunch()`/`app.exit()` (risque d'orphelin documenté dans
 *      electron-app.ts, volontairement évité ici comme dans le spec RBAC).
 *
 * Compte utilisé (mis à jour le 2026-10-31, durcissement bee7d20) :
 * `queries.verifySuperAdminPassword()` (hierarchy.queries.ts), appelée ici
 * SANS session (écran de connexion), n'accepte plus que les comptes
 * SUPER ADMIN ACTIFS (statut_actif = 1) ET synchronisés (sync_id non vide),
 * rôle primaire ou t_user_roles. Le compte seed `id_user=1, login='superadmin'`
 * créé par `runMigrations()` (schema.ts) est désormais DÉSACTIVÉ, avec un mot
 * de passe aléatoire non conservé : il n'est plus jamais candidat. Ce spec
 * utilise donc le compte de test `getTestUser('superAdmin')`
 * (e2e/fixtures/test-users.ts), inséré par `seed-database.ts` avec
 * statut_actif = 1, un sync_id non vide, un hash bcrypt et une ligne
 * t_user_roles 'SUPER ADMIN' — il remplit toutes les conditions du gate.
 */
import { test, expect } from '@playwright/test';
import { launchSeededApp, teardownSeededApp, type E2EEnvironment } from '../../fixtures/electron-app';
import { getTestUser } from '../../fixtures/test-users';
import { readFileSync } from 'fs';

test.describe.serial('SÉCURITÉ P0 — database:import, plomberie UI réelle (LoginPage.tsx)', () => {
  let env: E2EEnvironment;
  let anyTestFailed = false;
  // Compte SUPER ADMIN de test (actif + sync_id non vide, voir seed-database.ts) :
  // seul type de compte que `verifySuperAdminPassword()` accepte sans session
  // (voir note ci-dessus). Le compte seed 'superadmin' / 'admin' est désactivé.
  const SUPER_ADMIN_PASSWORD = getTestUser('superAdmin').password;

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

  function dbFileSize(): number {
    return readFileSync(env.seed.dbPath).length;
  }

  async function openImportModal(): Promise<void> {
    const { window } = env;
    await window.getByRole('button', { name: 'Importation Technique (Base locale)' }).click();
    await expect(window.getByText('Importer une Base de Données ?')).toBeVisible();
  }

  test('le bouton "Oui, Importer" est désactivé tant qu\'aucun mot de passe n\'est saisi', async () => {
    const { window } = env;
    await window.waitForURL(/#\/login/, { timeout: 15000 });

    await openImportModal();
    const confirmButton = window.getByRole('button', { name: 'Oui, Importer' });
    await expect(confirmButton).toBeDisabled();

    await window.getByTestId('import-password-input').fill('quelquechose');
    await expect(confirmButton).toBeEnabled();

    // Referme sans soumettre — remet la modale dans un état propre pour le test suivant.
    await window.getByRole('button', { name: 'Annuler' }).click();
  });

  test('[UI RÉELLE] mauvais mot de passe saisi dans le vrai champ → rejeté (unauthorized), base inchangée', async () => {
    const { window } = env;
    const sizeBefore = dbFileSize();

    await openImportModal();
    await window.getByTestId('import-password-input').fill('MotDePasse_Totalement_Incorrect');
    await window.getByRole('button', { name: 'Oui, Importer' }).click();

    // handleImportDatabase ferme la modale immédiatement (avant l'appel async),
    // puis met à jour le même toast une fois la réponse IPC reçue.
    await expect(window.getByText('Mot de passe SUPER ADMIN incorrect.')).toBeVisible({ timeout: 10000 });

    const sizeAfter = dbFileSize();
    expect(sizeAfter, 'La base réelle ne doit pas avoir été altérée par un mot de passe incorrect saisi via l\'UI').toBe(sizeBefore);
  });

  test('[UI RÉELLE] VRAI mot de passe SUPER ADMIN saisi dans le vrai champ → franchit le gate serveur', async () => {
    const { window, app } = env;
    const sizeBefore = dbFileSize();

    // Neutralise le dialogue natif (non pilotable par Playwright), comme le fait
    // déjà p0-database-export-import-rbac.e2e.spec.ts pour database:export : si
    // le gate mot de passe est franchi, le handler atteint `dialog.showOpenDialog`
    // (mocké ici en annulation) AVANT tout accès disque réel — aucun fichier n'est
    // donc jamais copié ni remplacé, et `app.relaunch()`/`app.exit()` (plus loin
        // dans le handler, uniquement atteints après sélection réelle d'un fichier)
    // ne sont jamais exercés par ce test.
    await app.evaluate(({ dialog }) => {
      (dialog as any).__originalShowOpenDialog = dialog.showOpenDialog;
      dialog.showOpenDialog = (async () => ({ canceled: true, filePaths: [] })) as any;
    });

    try {
      await openImportModal();
      await window.getByTestId('import-password-input').fill(SUPER_ADMIN_PASSWORD);
      await window.getByRole('button', { name: 'Oui, Importer' }).click();

      // 'cancelled' (dialogue annulé) — et non 'unauthorized' — prouve que le VRAI
      // mot de passe SUPER ADMIN saisi via l'UI a bien franchi le contrôle serveur.
      await expect(window.getByText("Importation annulée par l'utilisateur.")).toBeVisible({ timeout: 10000 });
    } finally {
      await app.evaluate(({ dialog }) => {
        dialog.showOpenDialog = (dialog as any).__originalShowOpenDialog;
        delete (dialog as any).__originalShowOpenDialog;
      });
    }

    const sizeAfter = dbFileSize();
    expect(sizeAfter, 'La base réelle ne doit pas avoir été altérée (dialogue mocké en annulation)').toBe(sizeBefore);
  });
});
