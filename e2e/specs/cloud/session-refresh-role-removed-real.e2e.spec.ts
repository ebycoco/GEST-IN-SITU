/**
 * e2e/specs/cloud/session-refresh-role-removed-real.e2e.spec.ts
 *
 * QA Terrain (agent-13) — Scénario 1/4 : "rôle retiré pendant une session
 * active". Revalidation vivante, en conditions RÉELLES (une instance
 * Electron GUI réelle, réseau Supabase dev/staging réel, PAS de
 * GEST_IN_SITU_E2E_DISABLE_SYNC), du chantier "rafraîchissement de session"
 * (commits 6c5df9f -> dcd0bb7) :
 *   - Cycle dédié comptes/rôles (3 min, sync-engine.ts, USER_SYNC_INTERVAL_MS),
 *     TOUJOURS actif après login, indépendant du cycle cartes (2h).
 *   - Après chaque cycle réussi : syncUsersFromCloud() (pull comptes/rôles)
 *     PUIS refreshSecureCurrentUser() (session-heartbeat.ts) : si le rôle
 *     ACTIF de la session n'est plus dans les rôles accordés (t_user_roles
 *     local, rafraîchi par le pull) -> revoked=true.
 *   - revoked=true -> invalidation fail-closed SYNCHRONE côté main process
 *     (stopSessionHeartbeat + stopUserAccountsSyncTimer + stopAutoDownstreamTimer)
 *     AVANT la notification renderer 'auth:session-expired' (payload.reason
 *     = 'revoked'), elle-même best-effort.
 *   - Message différencié côté renderer (App.tsx) : "Votre rôle a été
 *     modifié par un administrateur. Veuillez vous reconnecter." — à
 *     distinguer du message historique "...connecté sur une autre machine."
 *
 * ── Adaptation empirique (contrainte RAM du poste de test) ─────────────────
 * Conception initiale à deux instances Electron GUI simultanées (Poste A +
 * Poste B), abandonnée après deux échecs reproductibles au lancement de la
 * SECONDE instance (`waitForLoadState('domcontentloaded')` > 30s) : ce poste
 * de test dispose de ~7,9 Go RAM au total mais seulement ~1,4-1,5 Go
 * disponibles au moment du test — insuffisant pour deux app Electron GUI
 * complètes simultanées. L'action admin ("Poste B") est donc simulée par une
 * écriture DIRECTE sur Supabase dev, reproduisant EXACTEMENT la forme du
 * payload que produirait le vrai chemin applicatif (`updateUser()`,
 * users.queries.ts + outbox.service.ts). Voir _session-refresh-shared.ts
 * pour le détail complet de cette adaptation et sa justification (le
 * mécanisme sous test ici est intégralement côté PULL, pas côté push).
 *
 * ── Garde-fou données ───────────────────────────────────────────────────
 * Poste A est un `userDataDir` jetable (`fs.mkdtempSync`), distinct
 * d'`AppData/Roaming/gest-in-situ`. Le projet Supabase visé est le projet
 * dev/staging dédié e2e-cloud (`.env.e2e`), jamais le projet de production.
 * Compte de test préfixé QA_TERRAIN_, nettoyé en fin de fichier (local +
 * Cloud), avec revérification explicite.
 *
 * Invocation ciblée uniquement :
 *   npx playwright test e2e/specs/cloud/session-refresh-role-removed-real.e2e.spec.ts
 * Build préalable requis : npx electron-vite build --mode e2e (déjà fait).
 */
import { test, expect } from '@playwright/test';
import { launchSeededApp, teardownSeededApp, type E2EEnvironment } from '../../fixtures/electron-app';
import { ensureCloudSiteAndCentre } from '../../fixtures/supabase-dev-client';
import { hashPassword } from '../../../src/main/auth/local-auth';
import {
  QA_PWD,
  queryDb,
  login,
  waitLoggedIn,
  waitForNetworkOnline,
  createCrossPosteUser,
  simulateAdminRoleChange,
  cleanupLocalCrossPosteUsers,
  cleanupCloudCrossPosteUsers
} from './_session-refresh-shared';

const RUN_ID = Date.now();
const loginRoleRemoved = `QA_TERRAIN_ROLEDEL_${RUN_ID}`;
const syncIdRoleRemoved = `qa-terrain-crossposte-roledel-${RUN_ID}`;

test.describe.serial('Session Cloud RÉELLE — Scénario 1/4 : rôle retiré en session active (agent-13, commits 6c5df9f -> dcd0bb7)', () => {
  let envA: E2EEnvironment;
  let dbPathA: string;
  let capturedDialogMessage: string | null = null;
  let anyTestFailed = false;

  test.afterEach(async ({}, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus) anyTestFailed = true;
  });

  test.afterAll(async () => {
    if (envA) await teardownSeededApp(envA, anyTestFailed);
  });

  test('0. Setup — Poste A réel + 1 compte QA_TERRAIN_ croisé (local + Cloud)', async () => {
    test.setTimeout(150_000);
    envA = await launchSeededApp({ allowRealSync: true });
    dbPathA = envA.seed.dbPath;
    const siteId = envA.seed.siteId;
    const centreId = envA.seed.centreId;
    console.log(`[SETUP] Poste A -> site=${siteId} centre=${centreId}`);

    await ensureCloudSiteAndCentre(siteId, centreId);

    const pwdHash = hashPassword(QA_PWD);
    await createCrossPosteUser(dbPathA, siteId, centreId, loginRoleRemoved, 'OPERATEUR_VERIFICATION', syncIdRoleRemoved, pwdHash);

    envA.window.on('dialog', async (dialog) => {
      capturedDialogMessage = dialog.message();
      console.log(`[DIALOG][Poste A] alert() capturé : "${capturedDialogMessage}"`);
      await dialog.accept();
    });

    const stateA = await waitForNetworkOnline(envA.window, 90_000);
    console.log(`[SETUP] État réseau Poste A = "${stateA}" (attendu ONLINE).`);
    expect(stateA).toBe('ONLINE');
  });

  test('1. Rôle actif retiré pendant une session active -> déconnexion fail-closed + message "rôle...modifié"', async () => {
    test.setTimeout(360_000);
    const { window } = envA;
    capturedDialogMessage = null;

    await login(window, loginRoleRemoved, QA_PWD);
    await waitLoggedIn(window);
    console.log(`[SC1] Poste A connecté (${loginRoleRemoved}), url="${window.url()}".`);
    await expect(window).toHaveURL(/#\/agent-verification/, { timeout: 10000 });

    // Admin (Poste B, simulé — voir commentaire de tête) retire OPERATEUR_VERIFICATION
    // en le remplaçant par ADMIN_CENTRE (rôle assignable par ADMINISTRATEUR_SITE).
    await simulateAdminRoleChange(syncIdRoleRemoved, loginRoleRemoved, hashPassword(QA_PWD), envA.seed.siteId, envA.seed.centreId, ['ADMIN_CENTRE']);

    // Poll jusqu'à ~250s (initial 10s + 1 cycle de 3 min + marge réseau) pour la détection
    // par le cycle réel comptes/rôles de Poste A — AUCUNE accélération de timer.
    const startWait = Date.now();
    const deadline = startWait + 250_000;
    let detected = false;
    while (Date.now() < deadline) {
      if (capturedDialogMessage || window.url().includes('#/login')) { detected = true; break; }
      await window.waitForTimeout(8000);
    }
    console.log(`[SC1] Détection après ${Math.round((Date.now() - startWait) / 1000)}s -> detected=${detected}, dialog="${capturedDialogMessage}", url="${window.url()}".`);

    expect(detected, 'Poste A doit se déconnecter automatiquement après retrait du rôle actif').toBe(true);
    expect(capturedDialogMessage, 'Un message alert() différencié doit être affiché').not.toBeNull();
    expect(capturedDialogMessage).toMatch(/rôle/i);
    expect(capturedDialogMessage).toMatch(/modifié/i);
    expect(capturedDialogMessage).not.toMatch(/autre machine/i);
    expect(window.url()).toContain('#/login');

    const localRow = queryDb(dbPathA, `SELECT statut_actif||'|'||role FROM t_users WHERE login='${loginRoleRemoved}';`);
    console.log(`[SC1] État local Poste A après détection (statut_actif|role) -> ${localRow}`);
  });

  test('2. Nettoyage — compte QA_TERRAIN_ (Poste A + Cloud) avec revérification explicite', async () => {
    const { remainingA } = cleanupLocalCrossPosteUsers(dbPathA);
    console.log(`[CLEANUP] Restants locaux Poste A -> ${remainingA} (attendu 0)`);
    expect(remainingA).toBe(0);

    const { residualUsers, residualRoles } = await cleanupCloudCrossPosteUsers();
    console.log(`[CLEANUP][CLOUD] Résiduel -> users=${residualUsers} roles=${residualRoles} (attendu 0/0)`);
    expect(residualUsers).toBe(0);
    expect(residualRoles).toBe(0);
  });
});
