/**
 * e2e/specs/_agent13_role_switcher_revalidation.e2e.spec.ts
 *
 * QA Terrain (agent-13) — Revalidation ciblée du widget RoleSwitcher (TopBar)
 * après trois correctifs :
 *   1. Bug P1 de traçabilité ROLE_SWITCH (capture de `previousActiveRole`
 *      AVANT mutation, src/main/ipc/handlers.ts:352).
 *   2. Correctif cosmétique .role-switcher-trigger (largeur auto).
 *   3. Fermeture croisée des dropdowns Notifications / RoleSwitcher (TopBar.tsx).
 *
 * Portée : PAS un audit complet (déjà fait lors d'un premier passage validé) —
 * une passe de non-régression ciblée sur ces trois points précis + les
 * scénarios listés dans la mission (bascule x2, capture visuelle, fermeture
 * croisée dans les deux sens, absence d'erreur console).
 *
 * Compte de test QA_TERRAIN_MULTIROLE créé directement en base (préfixe
 * QA_TERRAIN_ non ambigu dans login/nom/prénom), rattaché au site/centre déjà
 * seedés par launchSeededApp(). Rôles accordés : ADMIN_CENTRE (primaire) +
 * OPERATEUR_VERIFICATION (secondaire) — deux rôles avec des routes/sidebars
 * distinctes (RoleRedirect.tsx), pour rendre la bascule observable. Supprimé
 * explicitement en fin de fichier (t_users + t_user_roles via CASCADE +
 * audit_logs), avant même le nettoyage automatique du userDataDir jetable par
 * teardownSeededApp.
 */
import { test, expect, type Page } from '@playwright/test';
import {
  launchSeededApp,
  teardownSeededApp,
  type E2EEnvironment
} from '../fixtures/electron-app';
import { join } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { hashPassword } from '../../src/main/auth/local-auth';

const execFileAsync = promisify(execFile);
const SHOT_DIR = join(__dirname, '..', '..', 'test-results', 'agent13-role-switcher-screenshots');

const QA_LOGIN = 'QA_TERRAIN_MULTIROLE';
const QA_PASSWORD = 'QA_Terrain_Pwd_2026!';

test.describe.serial('QA Terrain — Revalidation RoleSwitcher (agent-13)', () => {
  let env: E2EEnvironment;
  let anyTestFailed = false;
  const consoleErrors: string[] = [];
  let qaUserId = 0;

  test.beforeAll(async () => {
    env = await launchSeededApp();
    env.window.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
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

  // ── Helper DB direct (repris tel quel de _agent13_admin_centre_overview) ──
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

  test('Création du compte de test QA_TERRAIN_MULTIROLE (ADMIN_CENTRE + OPERATEUR_VERIFICATION)', async () => {
    const insertRes = await dbQuery(
      `INSERT INTO t_users (login, password_hash, role, nom_user, prenom_user, statut_actif, site_id, centre_id, sync_id, is_dirty)
       VALUES (?, ?, 'ADMIN_CENTRE', 'QA_TERRAIN', 'MultiRole', 1, ?, ?, ?, 0)`,
      [QA_LOGIN, hashPassword(QA_PASSWORD), env.seed.siteId, env.seed.centreId, `qaterrain-multirole-${Date.now()}`]
    );
    qaUserId = insertRes[0].lastInsertRowid;
    expect(qaUserId).toBeGreaterThan(0);

    await dbQuery(`INSERT INTO t_user_roles (id_user, role) VALUES (?, 'ADMIN_CENTRE')`, [qaUserId]);
    await dbQuery(`INSERT INTO t_user_roles (id_user, role) VALUES (?, 'OPERATEUR_VERIFICATION')`, [qaUserId]);

    const roles = await dbQuery(`SELECT role FROM t_user_roles WHERE id_user = ? ORDER BY role`, [qaUserId]);
    expect(roles.map((r) => r.role).sort()).toEqual(['ADMIN_CENTRE', 'OPERATEUR_VERIFICATION']);
  });

  test('Connexion + sélection du rôle initial (ADMIN_CENTRE) sur RoleSelectorPage', async () => {
    const { window } = env;
    await login(QA_LOGIN, QA_PASSWORD);

    // Compte multi-rôle : RoleSelectorPage doit s'afficher avant tout accès à l'app.
    await expect(window.getByText('Administrateur de Centre')).toBeVisible({ timeout: 15000 });
    await window.getByText('Administrateur de Centre').click();

    // Redirection attendue vers le portail ADMIN_CENTRE.
    await expect(window).toHaveURL(/#\/admin-centre/, { timeout: 15000 });
    await expect(window.locator('.role-switcher-trigger')).toBeVisible({ timeout: 15000 });
  });

  test('Capture visuelle du bouton RoleSwitcher — résolution normale', async () => {
    const { window } = env;
    const fs = await import('fs');
    fs.mkdirSync(SHOT_DIR, { recursive: true });
    const trigger = window.locator('.role-switcher-trigger');
    await expect(trigger).toBeVisible();
    const box = await trigger.boundingBox();
    // Correctif attendu : largeur auto (padding 0 8px + icône + chevron),
    // donc strictement supérieure au carré générique 36x36 de .topbar-icon-btn.
    expect(box?.width ?? 0).toBeGreaterThan(36);
    await window.screenshot({ path: join(SHOT_DIR, '01-role-switcher-normal-res.png') });
  });

  test('Capture visuelle du bouton RoleSwitcher — résolution terrain 1366x768', async () => {
    const { window } = env;
    await window.setViewportSize({ width: 1366, height: 768 });
    const trigger = window.locator('.role-switcher-trigger');
    await expect(trigger).toBeVisible();
    const box = await trigger.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(36);
    // Icône + chevron doivent rester dans les limites du bouton (pas de débordement horizontal).
    const chevron = window.locator('.role-switcher-trigger svg').last();
    const chevronBox = await chevron.boundingBox();
    if (box && chevronBox) {
      expect(chevronBox.x + chevronBox.width).toBeLessThanOrEqual(box.x + box.width + 1);
    }
    await window.screenshot({ path: join(SHOT_DIR, '02-role-switcher-1366x768.png') });
    // Retour à une taille de fenêtre standard pour la suite des tests.
    await window.setViewportSize({ width: 1600, height: 900 });
  });

  test('Fermeture croisée : ouvrir Notifications puis RoleSwitcher → Notifications se ferme', async () => {
    const { window } = env;
    const notifBtn = window.locator('button.topbar-icon-btn[title="Notifications"]');
    const roleTrigger = window.locator('.role-switcher-trigger');

    await notifBtn.click();
    await expect(window.locator('.topbar-notifications-dropdown')).toBeVisible();

    await roleTrigger.click();
    await expect(window.locator('.role-switcher-dropdown')).toBeVisible();
    await expect(window.locator('.topbar-notifications-dropdown')).toHaveCount(0);

    // Fermer proprement avant le scénario suivant.
    await roleTrigger.click();
    await expect(window.locator('.role-switcher-dropdown')).toHaveCount(0);
  });

  test('Fermeture croisée : ouvrir RoleSwitcher puis Notifications → RoleSwitcher se ferme', async () => {
    const { window } = env;
    const notifBtn = window.locator('button.topbar-icon-btn[title="Notifications"]');
    const roleTrigger = window.locator('.role-switcher-trigger');

    await roleTrigger.click();
    await expect(window.locator('.role-switcher-dropdown')).toBeVisible();

    await notifBtn.click();
    await expect(window.locator('.topbar-notifications-dropdown')).toBeVisible();
    await expect(window.locator('.role-switcher-dropdown')).toHaveCount(0);

    // Fermer proprement avant le scénario suivant.
    await notifBtn.click();
    await expect(window.locator('.topbar-notifications-dropdown')).toHaveCount(0);
  });

  test('Annulation de bascule : le rôle actif et la page restent inchangés', async () => {
    const { window } = env;
    await expect(window).toHaveURL(/#\/admin-centre/);

    await window.locator('.role-switcher-trigger').click();
    await window.getByText('Opérateur de Vérification').click();
    await expect(window.getByText('Changer de rôle actif')).toBeVisible();
    await window.getByRole('button', { name: 'Annuler' }).click();

    // Aucune navigation, toujours sur le portail ADMIN_CENTRE.
    await expect(window).toHaveURL(/#\/admin-centre/);
    await expect(window.locator('.role-switcher-dropdown')).toHaveCount(0);
  });

  test('Bascule #1 (via RoleSwitcher) : ADMIN_CENTRE → OPERATEUR_VERIFICATION', async () => {
    const { window } = env;
    await window.locator('.role-switcher-trigger').click();
    await window.getByText('Opérateur de Vérification').click();
    await window.getByRole('button', { name: 'Changer de rôle' }).click();

    await expect(window.getByText(/Rôle actif\s*:\s*Opérateur de Vérification/)).toBeVisible({ timeout: 10000 });
    await expect(window).toHaveURL(/#\/agent-verification/, { timeout: 15000 });
  });

  test('Bascule #2 (via RoleSwitcher) : retour OPERATEUR_VERIFICATION → ADMIN_CENTRE', async () => {
    const { window } = env;
    await window.locator('.role-switcher-trigger').click();
    await window.getByText('Administrateur de Centre').click();
    await window.getByRole('button', { name: 'Changer de rôle' }).click();

    await expect(window.getByText(/Rôle actif\s*:\s*Administrateur de Centre/)).toBeVisible({ timeout: 10000 });
    await expect(window).toHaveURL(/#\/admin-centre/, { timeout: 15000 });
  });

  test('Vérification BDD : chaque ligne ROLE_SWITCH reflète la transition réelle (pas le rôle de connexion figé)', async () => {
    const rows = await dbQuery(
      `SELECT action_type, details, timestamp FROM audit_logs WHERE operator_id = ? AND action_type = 'ROLE_SWITCH' ORDER BY id ASC`,
      [QA_LOGIN]
    );

    // Attendu : 1 entrée pour la sélection initiale (RoleSelectorPage, ADMIN_CENTRE → ADMIN_CENTRE,
    // rôle de connexion == rôle sélectionné) + 2 entrées pour les bascules via le widget TopBar.
    expect(rows.length).toBeGreaterThanOrEqual(3);

    const details = rows.map((r) => r.details as string);
    // Sélection initiale : rôle de connexion (ADMIN_CENTRE) → rôle choisi (ADMIN_CENTRE).
    expect(details[0]).toBe('ADMIN_CENTRE → ADMIN_CENTRE');
    // Bascule #1 : le rôle actif JUSTE AVANT (ADMIN_CENTRE, pas le rôle de connexion s'il différait)
    // → OPERATEUR_VERIFICATION. C'est le point critique du correctif P1 : avant le fix, cette valeur
    // aurait été figée sur le rôle de connexion initial pour TOUTE bascule ultérieure.
    expect(details[1]).toBe('ADMIN_CENTRE → OPERATEUR_VERIFICATION');
    // Bascule #2 : le rôle actif juste avant est bien OPERATEUR_VERIFICATION (celui adopté à la
    // bascule #1), pas ADMIN_CENTRE (rôle de connexion) — c'est exactement la régression corrigée.
    expect(details[2]).toBe('OPERATEUR_VERIFICATION → ADMIN_CENTRE');
  });

  test('Absence d\'erreur console pendant toute la manipulation', async () => {
    expect(consoleErrors, `Erreurs console capturées :\n${consoleErrors.join('\n')}`).toEqual([]);
  });

  test('Nettoyage explicite des données de test QA_TERRAIN_MULTIROLE', async () => {
    await dbQuery(`DELETE FROM audit_logs WHERE operator_id = ?`, [QA_LOGIN]);
    // t_logs.id_user porte une FK vers t_users SANS clause ON DELETE (ni CASCADE ni SET NULL) —
    // contrairement à t_user_roles (ON DELETE CASCADE). Le login réel de ce compte de test a
    // inséré au moins une ligne t_logs (action LOGIN) : sans ce nettoyage explicite, la
    // suppression de t_users ci-dessous échoue avec SQLITE_CONSTRAINT_FOREIGNKEY (constaté à
    // l'exécution). Nettoyage ciblé sur ce seul id_user, pas une purge globale de t_logs.
    await dbQuery(`DELETE FROM t_logs WHERE id_user = ?`, [qaUserId]);
    await dbQuery(`DELETE FROM t_users WHERE login = ?`, [QA_LOGIN]); // CASCADE → t_user_roles

    const remainingUser = await dbQuery(`SELECT COUNT(*) as count FROM t_users WHERE login = ?`, [QA_LOGIN]);
    const remainingRoles = await dbQuery(`SELECT COUNT(*) as count FROM t_user_roles WHERE id_user = ?`, [qaUserId]);
    const remainingLogs = await dbQuery(`SELECT COUNT(*) as count FROM audit_logs WHERE operator_id = ?`, [QA_LOGIN]);
    const remainingTLogs = await dbQuery(`SELECT COUNT(*) as count FROM t_logs WHERE id_user = ?`, [qaUserId]);

    expect(remainingUser[0].count).toBe(0);
    expect(remainingRoles[0].count).toBe(0);
    expect(remainingLogs[0].count).toBe(0);
    expect(remainingTLogs[0].count).toBe(0);
  });
});
