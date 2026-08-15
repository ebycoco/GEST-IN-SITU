/**
 * e2e/specs/_agent13_password_reset_temp_password.e2e.spec.ts
 *
 * QA Terrain (agent-13) — Vérification vivante du correctif "mot de passe
 * temporaire réel affiché" sur le bouton de réinitialisation d'un agent
 * (AgentsPage.tsx / users.queries.ts::resetAgentPassword).
 *
 * Couvre les 5 scénarios demandés par l'orchestrateur :
 *   1. Mot de passe en clair affiché, lisible, différent à chaque appel, format
 *      8 caractères sans 0/O/1/l/I (alphabet exact de generateTemporaryPassword).
 *   2. Le mot de passe affiché fonctionne réellement pour se connecter.
 *   3. Le bouton "Copier" copie exactement la bonne valeur.
 *   4. Aucune trace en clair en base (colonne password_hash = bcrypt) ni dans
 *      les logs applicatifs (fichiers *.log sous le userDataDir isolé + stdout/
 *      stderr du process principal capturés dès le lancement).
 *   5. Non-régression : l'ancien mot de passe ne fonctionne plus après reset,
 *      et le reste du flux /agents (liste, activation/désactivation) fonctionne.
 *
 * Isolation : réutilise `launchSeededApp()` (voir e2e/fixtures/electron-app.ts)
 * — chaque run obtient un `userDataDir` temporaire jetable et une base SQLite
 * neuve, seedée avec les comptes `E2E_*` de `test-users.ts` (jamais de données
 * de production). L'agent cible de la réinitialisation est le compte de test
 * déjà seedé `E2E_OPERATEUR_VERIFICATION` — aucune donnée supplémentaire n'est
 * créée manuellement ; toute la base est détruite par `teardownSeededApp` en
 * fin de run (cleanup garanti, pas de préfixe ZZTEST_ nécessaire ici).
 */
import { test, expect } from '@playwright/test';
import { launchSeededApp, teardownSeededApp, type E2EEnvironment } from '../fixtures/electron-app';
import { getTestUser } from '../fixtures/test-users';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const execFileAsync = promisify(execFile);

// Alphabet exact de generateTemporaryPassword() (users.queries.ts) :
// 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
// → exclut I, L, O (majuscules), i, l, o (minuscules), 0 et 1 (chiffres).
const TEMP_PASSWORD_RE = /^[A-HJ-KM-NP-Za-hj-km-np-z2-9]{8}$/;

test.describe.serial('QA Terrain — Réinitialisation mot de passe agent (mot de passe temporaire réel)', () => {
  let env: E2EEnvironment;
  let anyTestFailed = false;
  const capturedStdout: string[] = [];
  const capturedStderr: string[] = [];
  const capturedRendererConsole: string[] = [];

  const targetKey = 'operateurVerification';
  const target = () => getTestUser(targetKey);
  const admin = getTestUser('administrateurSite');

  const passwords: string[] = []; // tous les mots de passe temporaires générés, dans l'ordre

  test.beforeAll(async () => {
    env = await launchSeededApp();

    // Capture brute du stdout/stderr du process Electron principal dès le
    // lancement, pour inspecter a posteriori toute trace de mot de passe en
    // clair qu'electron-log (ou un console.log oublié) aurait pu écrire sur
    // la sortie standard (transport 'console' d'electron-log, actif par défaut
    // en plus du transport fichier).
    const proc = env.app.process();
    proc.stdout?.on('data', (chunk) => capturedStdout.push(chunk.toString()));
    proc.stderr?.on('data', (chunk) => capturedStderr.push(chunk.toString()));

    // Capture de la console du renderer (devtools) pour la même raison côté UI.
    env.window.on('console', (msg) => capturedRendererConsole.push(msg.text()));

    await env.window.waitForURL(/#\/login/);
    await env.window.getByTestId('login-input').fill(admin.login);
    await env.window.getByTestId('password-input').fill(admin.password);
    await env.window.getByTestId('login-submit').click();
    await env.window.waitForURL(/#\/dashboard/, { timeout: 20000 });
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

  // ── Helper DB (même contournement ABI que adminsite-qa-terrain.e2e.spec.ts) ──
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

  // Parcours récursif du userDataDir (Node système, pas de module natif) pour
  // retrouver tout fichier *.log écrit par electron-log (chemin par défaut :
  // <userData>/logs/main.log, jamais codé en dur ici pour rester robuste à un
  // éventuel changement de configuration).
  function findLogFiles(dir: string, acc: string[] = []): string[] {
    let entries: string[] = [];
    try {
      entries = readdirSync(dir);
    } catch {
      return acc;
    }
    for (const entry of entries) {
      const full = join(dir, entry);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) findLogFiles(full, acc);
      else if (entry.toLowerCase().endsWith('.log')) acc.push(full);
    }
    return acc;
  }

  async function performReset(confirmPassword: string): Promise<string> {
    const { window } = env;
    const row = window.locator('.table-row-hover', { hasText: target().login });
    await row.locator('button[title="Réinitialiser le mot de passe"]').click();
    await window.getByPlaceholder('••••••••').last().fill(confirmPassword);
    await window.getByRole('button', { name: 'Confirmer' }).click();

    // NOTE méthodologique (constat empirique en cours de run) : react-hot-toast
    // (<Toaster position="top-right">, App.tsx) INSÈRE les nouveaux toasts EN
    // TÊTE de la pile visuelle/DOM, pas à la fin. `.last()` récupère donc le
    // toast le plus ANCIEN encore affiché (ceux de 15s ne sont pas encore
    // expirés lors d'appels successifs rapprochés), pas le plus récent — piège
    // confirmé par capture d'écran montrant deux toasts empilés où le second
    // reset (nouveau) apparaît EN HAUT. `.first()` cible donc le toast courant.
    const toastTitle = window.getByText('Mot de passe réinitialisé !').first();
    await expect(toastTitle).toBeVisible({ timeout: 10000 });
    const toastText = await toastTitle.locator('..').innerText();
    // Structure attendue (AgentsPage.tsx) :
    //   "Mot de passe réinitialisé !\n<PASSWORD>\nCommuniquez ce mot de passe..."
    const lines = toastText.split('\n').map((l) => l.trim()).filter(Boolean);
    const pwdLine = lines[1];
    expect(pwdLine, `toast complet observé: ${JSON.stringify(toastText)}`).toMatch(TEMP_PASSWORD_RE);
    return pwdLine;
  }

  // ══════════════════════════════════════════════════════════════════════
  // SCÉNARIO 1 — mot de passe en clair, lisible, différent à chaque appel
  // ══════════════════════════════════════════════════════════════════════

  test('1a. Navigation /agents et repérage de la ligne agent cible', async () => {
    const { window } = env;
    await window.evaluate(() => { globalThis.location.hash = '#/agents'; });
    await window.waitForURL(/#\/agents/, { timeout: 15000 });
    await expect(window.getByText(target().login)).toBeVisible({ timeout: 15000 });
    await window.screenshot({ path: 'C:/Users/EBYCHOCO/AppData/Local/Temp/claude/d--Espace-travail-GEST-IN-SITU-CARTE-ABOBO-V2/0ecf52dd-3c68-446e-99c9-2a28cf4e9dcc/scratchpad/shots/01-agents-list.png' });
  });

  test('1b. Réinitialisation #1 : toast affiche un mot de passe en clair au bon format', async () => {
    const pwd = await performReset(admin.password);
    passwords.push(pwd);
    await env.window.screenshot({ path: 'C:/Users/EBYCHOCO/AppData/Local/Temp/claude/d--Espace-travail-GEST-IN-SITU-CARTE-ABOBO-V2/0ecf52dd-3c68-446e-99c9-2a28cf4e9dcc/scratchpad/shots/02-reset-1-toast.png' });
  });

  test('1c. Réinitialisation #2 : nouveau mot de passe, différent du #1', async () => {
    const pwd = await performReset(admin.password);
    expect(pwd).not.toBe(passwords[0]);
    passwords.push(pwd);
  });

  test('1d. Réinitialisation #3 : nouveau mot de passe, différent des #1 et #2', async () => {
    const pwd = await performReset(admin.password);
    expect(pwd).not.toBe(passwords[0]);
    expect(pwd).not.toBe(passwords[1]);
    passwords.push(pwd);
  });

  test('1e. Les 3 mots de passe générés sont tous distincts (pas une valeur fixe réutilisée)', async () => {
    const unique = new Set(passwords);
    expect(unique.size).toBe(passwords.length);
    for (const p of passwords) expect(p).toMatch(TEMP_PASSWORD_RE);
    console.log('[SCENARIO 1] Mots de passe générés (test only, DB jetable) :', passwords);
  });

  // ══════════════════════════════════════════════════════════════════════
  // SCÉNARIO 2 — le mot de passe affiché fonctionne réellement pour se connecter
  // ══════════════════════════════════════════════════════════════════════

  test('2. Connexion réussie avec EXACTEMENT le dernier mot de passe temporaire affiché', async () => {
    const { window } = env;
    await window.getByText('Déconnexion').click();
    await window.waitForURL(/#\/login/);

    const lastPwd = passwords[passwords.length - 1];
    await window.getByTestId('login-input').fill(target().login);
    await window.getByTestId('password-input').fill(lastPwd);
    await window.getByTestId('login-submit').click();

    await window.waitForURL(/#\/agent-verification/, { timeout: 15000 });
    await expect(window.getByText('Déconnexion')).toBeVisible();

    // Retour à l'admin pour la suite du run
    await window.getByText('Déconnexion').click();
    await window.waitForURL(/#\/login/);
    await window.getByTestId('login-input').fill(admin.login);
    await window.getByTestId('password-input').fill(admin.password);
    await window.getByTestId('login-submit').click();
    await window.waitForURL(/#\/dashboard/, { timeout: 20000 });
    await window.evaluate(() => { globalThis.location.hash = '#/agents'; });
    await window.waitForURL(/#\/agents/, { timeout: 15000 });
  });

  // ══════════════════════════════════════════════════════════════════════
  // SCÉNARIO 3 — le bouton "Copier" copie la bonne valeur
  // ══════════════════════════════════════════════════════════════════════

  test('3. Bouton "Copier" : la valeur écrite dans le presse-papiers correspond exactement au mot de passe affiché', async () => {
    const { window } = env;

    // Intercepte navigator.clipboard.writeText au niveau du renderer (plus fiable
    // qu'une lecture OS du presse-papiers réel, qui dépend de permissions/focus
    // fenêtre côté CI) : on capture l'argument exact passé par le bouton "Copier".
    await window.evaluate(() => {
      (window as any).__qaCopiedText = null;
      const orig = navigator.clipboard.writeText.bind(navigator.clipboard);
      navigator.clipboard.writeText = (text: string) => {
        (window as any).__qaCopiedText = text;
        return orig(text);
      };
    });

    const row = window.locator('.table-row-hover', { hasText: target().login });
    await row.locator('button[title="Réinitialiser le mot de passe"]').click();
    await window.getByPlaceholder('••••••••').last().fill(admin.password);
    await window.getByRole('button', { name: 'Confirmer' }).click();

    // Voir performReset() : react-hot-toast prépend les nouveaux toasts, .first() cible le plus récent.
    const toastTitle = window.getByText('Mot de passe réinitialisé !').first();
    await expect(toastTitle).toBeVisible({ timeout: 10000 });
    const toastText = await toastTitle.locator('..').innerText();
    const lines = toastText.split('\n').map((l) => l.trim()).filter(Boolean);
    const displayedPwd = lines[1];
    expect(displayedPwd).toMatch(TEMP_PASSWORD_RE);
    passwords.push(displayedPwd);

    const copyBtn = toastTitle.locator('..').locator('..').getByRole('button', { name: 'Copier' });
    await copyBtn.click();

    const copied = await window.evaluate(() => (window as any).__qaCopiedText);
    expect(copied).toBe(displayedPwd);

    await expect(window.getByText('Mot de passe copié dans le presse-papiers.')).toBeVisible({ timeout: 5000 });
  });

  // ══════════════════════════════════════════════════════════════════════
  // SCÉNARIO 4 — aucune trace en clair (DB + logs)
  // ══════════════════════════════════════════════════════════════════════

  test('4a. DB : password_hash est un hash bcrypt, jamais le mot de passe en clair, différent après chaque reset', async () => {
    const before = await dbQuery('SELECT password_hash FROM t_users WHERE login = ?', [target().login]);
    expect(before[0].password_hash.startsWith('$2')).toBe(true);

    const pwd = await performReset(admin.password);
    passwords.push(pwd);

    const after = await dbQuery('SELECT * FROM t_users WHERE login = ?', [target().login]);
    expect(after[0].password_hash.startsWith('$2')).toBe(true);
    expect(after[0].password_hash).not.toBe(before[0].password_hash);
    expect(after[0].password_hash).not.toBe(pwd);
    expect(after[0].password_hash).not.toContain(pwd);

    // Balayage défensif de TOUTE la ligne t_users (toutes colonnes confondues) :
    // aucun des mots de passe générés jusqu'ici ne doit apparaître en clair
    // nulle part sur cette ligne (pas seulement password_hash).
    const rowJson = JSON.stringify(after[0]);
    for (const p of passwords) {
      expect(rowJson).not.toContain(p);
    }
  });

  test('4b. Logs applicatifs (fichiers *.log sous le userDataDir + stdout/stderr/console capturés) : aucun mot de passe en clair', async () => {
    const logFiles = findLogFiles(env.userDataDir);
    console.log('[SCENARIO 4b] Fichiers log trouvés sous userDataDir :', logFiles);

    const allLogContent = logFiles.map((f) => {
      try {
        return readFileSync(f, 'utf-8');
      } catch {
        return '';
      }
    }).join('\n');

    const combinedOutput = allLogContent + '\n' + capturedStdout.join('') + '\n' + capturedStderr.join('') + '\n' + capturedRendererConsole.join('\n');

    for (const p of passwords) {
      expect(combinedOutput).not.toContain(p);
    }
  });

  // ══════════════════════════════════════════════════════════════════════
  // SCÉNARIO 5 — non-régression
  // ══════════════════════════════════════════════════════════════════════

  test('5a. Un ANCIEN mot de passe temporaire ne fonctionne plus après un reset ultérieur', async () => {
    const { window } = env;
    await window.getByText('Déconnexion').click();
    await window.waitForURL(/#\/login/);

    const oldPwd = passwords[0]; // le tout premier généré, obsolète depuis longtemps
    await window.getByTestId('login-input').fill(target().login);
    await window.getByTestId('password-input').fill(oldPwd);
    await window.getByTestId('login-submit').click();

    await expect(window.getByText('Identifiants incorrects')).toBeVisible({ timeout: 10000 });
    await expect(window).toHaveURL(/#\/login/);
  });

  test('5b. Le mot de passe temporaire LE PLUS RÉCENT fonctionne toujours (confirme le remplacement, pas un ajout)', async () => {
    const { window } = env;
    const currentPwd = passwords[passwords.length - 1];
    await window.getByTestId('login-input').fill(target().login);
    await window.getByTestId('password-input').fill(currentPwd);
    await window.getByTestId('login-submit').click();
    await window.waitForURL(/#\/agent-verification/, { timeout: 15000 });
    await window.getByText('Déconnexion').click();
    await window.waitForURL(/#\/login/);

    // Retour admin
    await window.getByTestId('login-input').fill(admin.login);
    await window.getByTestId('password-input').fill(admin.password);
    await window.getByTestId('login-submit').click();
    await window.waitForURL(/#\/dashboard/, { timeout: 20000 });
    await window.evaluate(() => { globalThis.location.hash = '#/agents'; });
    await window.waitForURL(/#\/agents/, { timeout: 15000 });
  });

  test('5c. Non-régression du reste du flux /agents : activation/désactivation de l\'agent cible fonctionne toujours', async () => {
    const { window } = env;
    const row = window.locator('.table-row-hover', { hasText: target().login });
    await row.locator('button[title="Désactiver"]').click();
    await window.getByPlaceholder('••••••••').last().fill(admin.password);
    await window.getByRole('button', { name: 'Confirmer' }).click();

    await expect.poll(async () => {
      const rows = await dbQuery('SELECT statut_actif FROM t_users WHERE login = ?', [target().login]);
      return rows[0]?.statut_actif;
    }, { timeout: 10000 }).toBe(0);

    const rowAfter = window.locator('.table-row-hover', { hasText: target().login });
    await rowAfter.locator('button[title="Activer"]').click();
    await window.getByRole('button', { name: 'Confirmer' }).click();
    await expect.poll(async () => {
      const rows = await dbQuery('SELECT statut_actif FROM t_users WHERE login = ?', [target().login]);
      return rows[0]?.statut_actif;
    }, { timeout: 10000 }).toBe(1);

    await window.screenshot({ path: 'C:/Users/EBYCHOCO/AppData/Local/Temp/claude/d--Espace-travail-GEST-IN-SITU-CARTE-ABOBO-V2/0ecf52dd-3c68-446e-99c9-2a28cf4e9dcc/scratchpad/shots/03-final-agents-page.png' });
  });
});
