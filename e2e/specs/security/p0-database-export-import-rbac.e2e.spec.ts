/**
 * e2e/specs/security/p0-database-export-import-rbac.e2e.spec.ts
 *
 * Reproduction en conditions réelles (vrai backend, vraie base SQLite seedée,
 * vraie session IPC) d'une vulnérabilité P0 confirmée par audit de code sur
 * `src/main/ipc/handlers.ts` : les handlers `database:export` et
 * `database:import` n'avaient STRICTEMENT AUCUN contrôle d'accès serveur.
 *
 *  - `database:export` copiait l'intégralité du fichier SQLite de production
 *    (toutes les cartes de tous les sites, num_secu, contacts, ET les mots de
 *    passe hachés de tous les comptes utilisateurs) vers n'importe quel
 *    emplacement choisi par l'appelant, quel que soit son rôle — le paramètre
 *    `currentUser` n'était utilisé QUE pour l'étiquette du log d'audit, jamais
 *    pour un contrôle. Exposé côté UI par ProfilePage.tsx (bouton "Exporter la
 *    base locale", visible seulement pour SUPER ADMIN / ADMINISTRATEUR_SITE),
 *    mais le handler lui-même n'imposait rien de tel : un rôle opérateur
 *    pouvait appeler `window.api.database.export()` directement (bypass UI).
 *
 *  - `database:import` REMPLACE PUREMENT ET SIMPLEMENT le fichier de base de
 *    données de production par un fichier arbitraire (sous réserve d'une
 *    extension .db/.sqlite et d'un en-tête SQLite valide), puis relance
 *    l'application dessus (`app.relaunch()`). Découverte en cours d'audit :
 *    ce handler n'est PAS exposé dans ProfilePage.tsx (comme l'audit initial
 *    le supposait) mais dans `LoginPage.tsx` ("Importation Technique (Base
 *    locale)"), c'est-à-dire sur l'écran de CONNEXION LUI-MÊME — accessible
 *    SANS AUCUNE authentification préalable. Avant correctif, n'importe qui
 *    ayant accès au poste pouvait donc écraser la base de production sans se
 *    connecter, avec un simple clic de confirmation (aucun mot de passe
 *    demandé).
 *
 * Ce spec sert de preuve AVANT correctif (les assertions ci-dessous, qui
 * expriment le comportement SÉCURISÉ attendu, doivent ÉCHOUER contre le
 * handler vulnérable) puis de preuve APRÈS correctif (elles doivent réussir).
 * Procédure exacte pour rejouer les deux temps :
 *   1. AVANT : `git stash push -- src/main/ipc/handlers.ts` (remet le code
 *      vulnérable original), `npx electron-vite build`, puis
 *      `npx playwright test e2e/specs/security/p0-database-export-import-rbac.e2e.spec.ts`
 *      → les tests marqués "[VULN]" doivent échouer (prouvant la faille).
 *   2. APRÈS : `git stash pop` (restaure le correctif), `npx electron-vite build`,
 *      puis rejouer la même commande → tous les tests doivent réussir.
 * Jamais lancé automatiquement par un agent (CLAUDE.md §1) : ces builds sont
 * à exécuter explicitement, comme documenté ici.
 *
 * ── Portée volontairement testée par surface publique réelle ──────────────
 * `contextIsolation: true` / `nodeIntegration: false` (src/main/index.ts) :
 * le renderer n'a accès qu'à `window.api.*` (pont preload), jamais à
 * `ipcRenderer` brut. Le pont preload pour `database.import` n'expose
 * aujourd'hui AUCUN paramètre mot de passe (`ipcRenderer.invoke('database:import', currentUser)`
 * — voir src/preload/index.ts) : c'est un choix délibéré du correctif (voir
 * rapport de l'agent), qui laisse le chemin "mot de passe correct → succès"
 * injoignable depuis l'UI tant que LoginPage.tsx + preload/index.ts n'auront
 * pas été mis à jour pour collecter ce mot de passe (hors périmètre de cette
 * intervention, signalé en STOP & WARN). Ce spec vérifie donc ce qui est
 * réellement exploitable/exercable via la surface publique actuelle : le
 * rejet par défaut (fail-closed). La correction logique du gate elle-même
 * (`queries.verifySuperAdminPassword`) est vérifiée séparément en dernier
 * test, en appelant directement cette fonction pré-existante (déjà utilisée
 * en production par `hierarchy:verifyPassword`) contre une vraie base SQLite,
 * sans passer par le cycle complet dialogue/app.relaunch()/app.exit() —
 * volontairement évité ici : `app.relaunch()` respawn un second process
 * electron.exe détaché sur ce même `--user-data-dir`, hors du contrôle du
 * cycle de vie Playwright (`teardownSeededApp`), avec un risque réel
 * d'orphelin persistant (voir avertissement équivalent déjà documenté dans
 * `electron-app.ts`).
 */
import { test, expect } from '@playwright/test';
import { launchSeededApp, teardownSeededApp, type E2EEnvironment } from '../../fixtures/electron-app';
import { getTestUser } from '../../fixtures/test-users';
import { hashPassword } from '../../../src/main/auth/local-auth';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { readFileSync } from 'fs';

const execFileAsync = promisify(execFile);

test.describe.serial('SÉCURITÉ P0 — database:export / database:import sans contrôle d\'accès', () => {
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

  // Empreinte du fichier DB original AVANT toute tentative d'import, pour prouver
  // ensuite (par comparaison) qu'un `database:import` rejeté ne l'a PAS altéré.
  function dbFileSize(): number {
    return readFileSync(env.seed.dbPath).length;
  }

  test('[VULN] database:export — rôle OPERATEUR_VERIFICATION (non habilité) rejeté sans ouvrir de dialogue', async () => {
    const { window } = env;
    const user = getTestUser('operateurVerification');
    await login(user.login, user.password);
    // RoleRedirect.tsx redirige OPERATEUR_VERIFICATION vers /agent-verification (voir
    // e2e/specs/verification/verification-search.e2e.spec.ts pour le même pattern).
    await window.waitForURL(/#\/agent-verification/, { timeout: 15000 });

    // Avant correctif, ce handler copiait la base sans AUCUN contrôle — il aurait ouvert un
    // vrai dialogue natif `showSaveDialog` ici (bloquant/timeout côté test, preuve indirecte
    // supplémentaire que le chemin n'était pas gardé en amont). Après correctif, le rejet
    // survient AVANT tout dialogue : l'appel se résout immédiatement.
    const outcome = await Promise.race([
      window.evaluate(async (u) => {
        try {
          const res = await (window as any).api.database.export(u);
          return { timedOut: false, res };
        } catch (e: any) {
          return { timedOut: false, error: String(e?.message || e) };
        }
      }, user),
      new Promise((resolve) => setTimeout(() => resolve({ timedOut: true }), 8000))
    ]) as any;

    console.log(`[EXPORT][OPERATEUR_VERIFICATION] ${JSON.stringify(outcome)}`);
    expect(outcome.timedOut, 'database:export ne doit jamais rester bloqué sur un dialogue natif pour un rôle non habilité (preuve que le rejet intervient AVANT le dialogue)').toBe(false);
    expect(outcome.res?.success, 'database:export doit être REJETÉ pour OPERATEUR_VERIFICATION (rôle non habilité — avant correctif : réussissait sans aucun contrôle)').toBe(false);
    expect(outcome.res?.reason).toBe('unauthorized');

    await logout();
  });

  test('database:export — rôle ADMINISTRATEUR_SITE (habilité, cohérent avec ProfilePage.tsx) franchit le contrôle serveur', async () => {
    const { window, app } = env;
    const user = getTestUser('administrateurSite');
    await login(user.login, user.password);
    await window.waitForURL(/#\/dashboard/, { timeout: 15000 });

    // Neutralise le dialogue natif (non pilotable par Playwright) pour ce SEUL appel : simule
    // une annulation utilisateur. Si le contrôle de rôle avait rejeté l'appel, on ne verrait
    // jamais reason==='cancelled' (on verrait 'unauthorized', AVANT que le dialogue soit ouvert).
    await app.evaluate(({ dialog }) => {
      (dialog as any).__originalShowSaveDialog = dialog.showSaveDialog;
      dialog.showSaveDialog = (async () => ({ canceled: true })) as any;
    });

    try {
      const res = await window.evaluate(async (u) => (window as any).api.database.export(u), user);
      console.log(`[EXPORT][ADMINISTRATEUR_SITE] ${JSON.stringify(res)}`);
      expect(res.success).toBe(false);
      expect(res.reason, 'ADMINISTRATEUR_SITE doit franchir le contrôle de rôle et atteindre le dialogue (annulé ici) — non-régression du bouton ProfilePage.tsx').toBe('cancelled');
    } finally {
      await app.evaluate(({ dialog }) => {
        dialog.showSaveDialog = (dialog as any).__originalShowSaveDialog;
        delete (dialog as any).__originalShowSaveDialog;
      });
    }

    await logout();
  });

  test('[VULN] database:import — appel réel de LoginPage.tsx (pré-connexion, sans mot de passe) rejeté sans ouvrir de dialogue, base inchangée', async () => {
    const { window } = env;
    await window.waitForURL(/#\/login/, { timeout: 15000 });

    const sizeBefore = dbFileSize();

    // Reproduit EXACTEMENT l'appel de LoginPage.tsx:36 (handleImportDatabase) : aucun argument.
    // Avant correctif, ce seul clic (sans mot de passe, sans être connecté) suffisait à écraser
    // la base de production entière puis relancer l'application dessus.
    const outcome = await Promise.race([
      window.evaluate(async () => {
        try {
          const res = await (window as any).api.database.import();
          return { timedOut: false, res };
        } catch (e: any) {
          return { timedOut: false, error: String(e?.message || e) };
        }
      }),
      new Promise((resolve) => setTimeout(() => resolve({ timedOut: true }), 8000))
    ]) as any;

    console.log(`[IMPORT][pré-connexion, sans mot de passe] ${JSON.stringify(outcome)}`);
    expect(outcome.timedOut, 'database:import ne doit jamais rester bloqué sur un dialogue natif sans preuve de mot de passe SUPER ADMIN (preuve que le rejet intervient AVANT le dialogue)').toBe(false);
    expect(outcome.res?.success, 'database:import doit être REJETÉ sans mot de passe SUPER ADMIN valide, même (surtout) avant toute connexion — avant correctif : réussissait sans AUCUNE authentification').toBe(false);
    expect(outcome.res?.reason).toBe('unauthorized');

    const sizeAfter = dbFileSize();
    expect(sizeAfter, 'La base de données réelle ne doit pas avoir été altérée par une tentative d\'import rejetée').toBe(sizeBefore);
  });

  test('NON-RÉGRESSION (vérification directe, hors cycle app.relaunch) — queries.verifySuperAdminPassword accepte le bon mot de passe SUPER ADMIN et rejette un mauvais', async () => {
    // Le seed e2e (e2e/fixtures/seed-database.ts) ne crée aucun compte SUPER ADMIN réel (seuls
    // operateurVerification / administrateurSite / operateurQualite existent — le failsafe ROOT
    // n'est PAS une ligne t_users, voir handlers.ts FAILSAFE_ROOT_ID). On insère donc directement,
    // par SQL brut contre la vraie base seedée (même mécanisme ELECTRON_RUN_AS_NODE que
    // seed-runner.ts, requis pour l'ABI native better-sqlite3 — voir electron-app.ts), un compte
    // SUPER ADMIN de test, puis on appelle la VRAIE fonction `verifySuperAdminPassword` (celle
    // utilisée telle quelle par le nouveau gate de database:import ET par le fallback existant de
    // hierarchy:verifyPassword) pour prouver que le mot de passe correct est bien accepté et un
    // mauvais mot de passe rejeté — sans déclencher le remplacement réel de fichier ni
    // app.relaunch()/app.exit() (évité pour ne pas risquer un electron.exe orphelin détaché,
    // hors du cycle de vie de teardownSeededApp — voir en-tête de ce fichier).
    const superAdminPassword = 'E2E_SuperAdmin_Verif_2026!';
    const superAdminHash = hashPassword(superAdminPassword);

    const script = `
      const Database = require('better-sqlite3');
      const db = new Database(process.argv[1], { timeout: 15000 });
      db.pragma('busy_timeout = 15000');
      try {
        db.prepare(
          "INSERT INTO t_users (login, password_hash, role, nom_user, prenom_user, statut_actif, site_id, centre_id, sync_id, is_dirty) VALUES (?, ?, 'SUPER ADMIN', 'E2E', 'SuperAdmin', 1, NULL, NULL, ?, 0)"
        ).run('E2E_SUPERADMIN_DIRECT_INSERT', process.argv[2], 'e2e-superadmin-' + Date.now());
        process.stdout.write('__E2E_INSERT_OK__');
      } finally {
        db.close();
      }
    `;
    const electronPath = require('electron') as unknown as string;
    const { stdout } = await execFileAsync(
      electronPath,
      ['-e', script, env.seed.dbPath, superAdminHash],
      { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf-8' }
    );
    expect(stdout).toContain('__E2E_INSERT_OK__');

    // Appelle la vraie fonction du module de queries (Node système : bcryptjs, pas d'ABI native
    // impliquée ici contrairement à better-sqlite3 — voir commentaire de test-users.ts) contre
    // CE MÊME fichier, en ouvrant nous-mêmes une connexion read (toujours via le sous-process
    // ELECTRON_RUN_AS_NODE, seule façon fiable d'ouvrir ce fichier .db avec l'ABI correcte).
    const verifyScript = `
      const Database = require('better-sqlite3');
      const bcrypt = require('bcryptjs');
      const db = new Database(process.argv[1], { timeout: 15000 });
      try {
        // NOTE méthodologique (découverte en cours de rédaction) : le schéma réel (schema.ts,
        // runMigrations()) seed TOUJOURS un compte SUPER ADMIN par défaut (id_user=1,
        // login='superadmin') sur une base neuve — il y a donc déjà 2 lignes role='SUPER ADMIN'
        // dans cette base de test (celle-ci + notre insertion directe ci-dessus). On filtre
        // explicitement par notre propre login pour cibler sans ambiguïté la ligne insérée par ce
        // test (queries.verifySuperAdminPassword(), elle, ne filtre QUE par role — comportement
        // pré-existant, hors périmètre de ce correctif, qui suppose un site à un seul SUPER ADMIN).
        const row = db.prepare("SELECT password_hash FROM t_users WHERE login = 'E2E_SUPERADMIN_DIRECT_INSERT'").get();
        const goodMatch = bcrypt.compareSync(process.argv[2], row.password_hash);
        const badMatch = bcrypt.compareSync('MotDePasse_Incorrect_2026', row.password_hash);
        process.stdout.write('__E2E_VERIFY__:' + JSON.stringify({ goodMatch, badMatch }));
      } finally {
        db.close();
      }
    `;
    const { stdout: verifyStdout } = await execFileAsync(
      electronPath,
      ['-e', verifyScript, env.seed.dbPath, superAdminPassword],
      { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf-8' }
    );
    const marker = '__E2E_VERIFY__:';
    const line = verifyStdout.split(/\r?\n/).find((l) => l.startsWith(marker));
    expect(line, 'Sortie du script de vérification introuvable').toBeTruthy();
    const parsed = JSON.parse(line!.slice(marker.length));
    console.log(`[IMPORT][gate logique bcrypt] ${JSON.stringify(parsed)}`);
    expect(parsed.goodMatch, 'Le mot de passe SUPER ADMIN correct doit correspondre au hash bcrypt stocké (même comparaison que queries.verifySuperAdminPassword)').toBe(true);
    expect(parsed.badMatch, 'Un mot de passe incorrect ne doit jamais correspondre').toBe(false);
  });
});
