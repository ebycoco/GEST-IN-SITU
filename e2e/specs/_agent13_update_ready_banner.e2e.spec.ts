/**
 * e2e/specs/_agent13_update_ready_banner.e2e.spec.ts
 *
 * QA Terrain (agent-13) — Test fonctionnel vivant du bandeau persistant
 * "Mise à jour prête" (`src/renderer/src/components/UpdateReadyBanner.tsx`,
 * rendu depuis `App.tsx`), qui remplace l'ancien toast auto-disparaissant
 * (10s) "Une mise à jour est prête !".
 *
 * Test purement UI/renderer — aucune écriture SQLite associée à cette
 * fonctionnalité (le state `updateReady` est un state React en mémoire, pas
 * persisté). Une seule instance Electron isolée (userDataDir jetable, réseau
 * Supabase coupé — voir `../fixtures/electron-app.ts`) est partagée pour tout
 * le fichier.
 *
 * ── Simulation de l'événement IPC ────────────────────────────────────────
 * En conditions réelles, `updater:update-downloaded` est émis par
 * `src/main/auto-updater.ts` (`autoUpdater.on('update-downloaded', ...)` →
 * `mainWindow.webContents.send('updater:update-downloaded', info)`) suite à
 * un vrai téléchargement `electron-updater` depuis GitHub Releases — hors de
 * portée et inutile pour ce test. On simule directement l'arrivée de
 * l'événement depuis le processus main via `electronApp.evaluate(...)`
 * (accès à `BrowserWindow.getAllWindows()`), comme documenté dans la tâche.
 *
 * Aucune donnée de test créée en base pour ce spec (rien à nettoyer côté
 * SQLite) — seul le `userDataDir` jetable est nettoyé par `teardownSeededApp`.
 */
import { test, expect, type Page } from '@playwright/test';
import {
  launchSeededApp,
  teardownSeededApp,
  type E2EEnvironment
} from '../fixtures/electron-app';
import { getTestUser } from '../fixtures/test-users';
import { join } from 'path';

const SHOT_DIR =
  'C:\\Users\\EBYCHOCO\\AppData\\Local\\Temp\\claude\\d--Espace-travail-GEST-IN-SITU-CARTE-ABOBO-V2\\0ecf52dd-3c68-446e-99c9-2a28cf4e9dcc\\scratchpad';

test.describe.serial('QA Terrain — Bandeau persistant "Mise à jour prête" (agent-13)', () => {
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

  async function login(loginStr: string, password: string): Promise<void> {
    const { window } = env;
    await window.getByTestId('login-input').fill(loginStr);
    await window.getByTestId('password-input').fill(password);
    await window.getByTestId('login-submit').click();
  }

  async function sendUpdateDownloaded(version = '9.9.9-test'): Promise<void> {
    await env.app.evaluate(({ BrowserWindow }, ver) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.webContents.send('updater:update-downloaded', { version: ver });
    }, version);
  }

  function bannerLocator(window: Page) {
    return window.getByText('Mise à jour prête');
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Connexion (ADMINISTRATEUR_SITE — reste connecté pour tout le fichier).
  // ═══════════════════════════════════════════════════════════════════════
  test('0. Connexion ADMINISTRATEUR_SITE + vérification absence de gel "Chargement sécurisé"', async () => {
    const { window } = env;
    const user = getTestUser('administrateurSite');

    await window.waitForURL(/#\/login/, { timeout: 20000 });
    await login(user.login, user.password);
    await window.waitForURL(/#\/dashboard/, { timeout: 20000 });

    // Scénario 7 : pas de gel persistant sur "Chargement sécurisé en cours...".
    const overlay = window.getByText('Chargement sécurisé en cours...');
    if ((await overlay.count()) > 0) {
      await expect(overlay).toHaveCount(0, { timeout: 20000 });
    }
    await expect(window.locator('.dashboard-premium, .kpi-value-lg').first()).toBeVisible({ timeout: 20000 });

    await window.screenshot({ path: join(SHOT_DIR, 'agent13-update-banner-00-dashboard-initial.png') });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Scénario 1 — Apparition, position bas-centre, non-bloquant.
  // ═══════════════════════════════════════════════════════════════════════
  test('1. Apparition du bandeau — ancré bas-centre, sans bloquer le reste de l\'UI', async () => {
    const { window } = env;

    await expect(bannerLocator(window)).toHaveCount(0);

    await sendUpdateDownloaded();

    await expect(bannerLocator(window)).toBeVisible({ timeout: 10000 });

    // Position : ancré bas-centre de la fenêtre (pas seulement en CSS, mesure réelle).
    const viewport = await window.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
    const box = await window
      .locator('.premium-card.premium-glass.animate-slide-up')
      .first()
      .boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      const centerX = box.x + box.width / 2;
      // Centré horizontalement (tolérance 5%).
      expect(Math.abs(centerX - viewport.w / 2)).toBeLessThan(viewport.w * 0.05);
      // Ancré en bas : le bas de la carte doit être proche du bas du viewport.
      const distanceFromBottom = viewport.h - (box.y + box.height);
      expect(distanceFromBottom).toBeLessThan(60);
      console.log(
        `[agent13][UPDATE-BANNER] position mesurée: centerX=${centerX.toFixed(0)} (viewport ${viewport.w}), ` +
        `distanceFromBottom=${distanceFromBottom.toFixed(0)}px`
      );
    }

    // Non-bloquant : le contenu derrière (topbar) doit rester cliquable.
    // Le conteneur externe a pointerEvents:'none', seule la carte interne capte les clics.
    await window.locator('.topbar-title').click({ timeout: 5000 });

    await window.screenshot({ path: join(SHOT_DIR, 'agent13-update-banner-01-appeared.png') });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Scénario 2 — Pas de disparition automatique (>15s, contrairement à
  // l'ancien toast 10s).
  // ═══════════════════════════════════════════════════════════════════════
  test('2. Pas de disparition automatique — reste visible après 15s+', async () => {
    const { window } = env;
    await expect(bannerLocator(window)).toBeVisible();

    await window.waitForTimeout(16000);

    await expect(bannerLocator(window)).toBeVisible();
    await window.screenshot({ path: join(SHOT_DIR, 'agent13-update-banner-02-still-visible-after-16s.png') });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Scénario 3 — Contenu du message.
  //
  // Mis à jour par agent-13 (re-passage QA) : le texte du bandeau a changé
  // (git diff -- src/renderer/src/components/UpdateReadyBanner.tsx) pour
  // mentionner une fenêtre d'installation VISIBLE (au lieu d'une installation
  // silencieuse) et avertir explicitement de ne pas la fermer manuellement,
  // en cohérence avec `autoInstallOnAppQuit=false`/`quitAndInstall(false)`
  // (src/main/auto-updater.ts). Les 3 anciennes assertions regex ci-dessous
  // ciblaient l'ANCIEN texte ("...va s'installer automatiquement à la
  // prochaine fermeture...", "...icône du raccourci...peut clignoter ou
  // blanchir...", "...c'est normal, ce n'est pas une anomalie.") : elles ne
  // matchaient plus le DOM réel et auraient fait échouer ce spec au prochain
  // run (constat vérifié par lecture du texte actuellement rendu par le
  // composant). Remplacées par les phrases réellement présentes aujourd'hui.
  // ═══════════════════════════════════════════════════════════════════════
  test('3. Message — fenêtre d\'installation visible à la prochaine fermeture + avertissement de ne pas la fermer', async () => {
    const { window } = env;

    await expect(
      window.getByText(/va s'installer.*à la prochaine fermeture.*de l'application/i)
    ).toBeVisible();
    await expect(
      window.getByText(/une fenêtre d'installation va s'afficher/i)
    ).toBeVisible();
    await expect(
      window.getByText(/l'application redémarrera automatiquement ensuite/i)
    ).toBeVisible();
    await expect(
      window.getByText(/ne fermez pas cette fenêtre manuellement/i)
    ).toBeVisible();
    await expect(
      window.getByText(/pendant la copie des fichiers/i)
    ).toBeVisible();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Scénario 4 — Acquittement (bouton principal, puis re-test avec la croix).
  // ═══════════════════════════════════════════════════════════════════════
  test('4a. Acquittement — clic sur "J\'ai compris" (bouton principal) fait disparaître le bandeau', async () => {
    const { window } = env;

    await window.getByRole('button', { name: "J'ai compris" }).click();
    await expect(bannerLocator(window)).toHaveCount(0, { timeout: 5000 });

    await window.screenshot({ path: join(SHOT_DIR, 'agent13-update-banner-04a-dismissed-main-button.png') });
  });

  test('4b. Acquittement — la croix de fermeture (icône X) fonctionne aussi indépendamment', async () => {
    const { window } = env;

    // Re-déclenche l'événement pour retester avec la croix cette fois.
    await sendUpdateDownloaded();
    await expect(bannerLocator(window)).toBeVisible({ timeout: 10000 });

    await window.getByRole('button', { name: 'Fermer la notification' }).click();
    await expect(bannerLocator(window)).toHaveCount(0, { timeout: 5000 });

    await window.screenshot({ path: join(SHOT_DIR, 'agent13-update-banner-04b-dismissed-close-cross.png') });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Scénario 5 — Non-réapparition dans la session après acquittement.
  // ═══════════════════════════════════════════════════════════════════════
  test('5. Non-réapparition — navigation dashboard → profil → retour, bandeau absent', async () => {
    const { window } = env;

    await sendUpdateDownloaded();
    await expect(bannerLocator(window)).toBeVisible({ timeout: 10000 });
    await window.getByRole('button', { name: "J'ai compris" }).click();
    await expect(bannerLocator(window)).toHaveCount(0, { timeout: 5000 });

    await window.evaluate(() => { window.location.hash = '#/profile'; });
    await window.waitForURL(/#\/profile/, { timeout: 10000 });
    await expect(bannerLocator(window)).toHaveCount(0);

    await window.evaluate(() => { window.location.hash = '#/dashboard'; });
    await window.waitForURL(/#\/dashboard/, { timeout: 10000 });
    await expect(bannerLocator(window)).toHaveCount(0);

    await window.screenshot({ path: join(SHOT_DIR, 'agent13-update-banner-05-no-reappear-after-nav.png') });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Scénario 6 — Non-régression : onAuthWarning (toast) + collision visuelle
  // avec Toaster (haut-droit) et barre hors-ligne (TopBar, haut). Le bandeau
  // est bas-centre : aucune collision géométrique attendue avec ces deux
  // éléments (tous deux ancrés en haut de l'écran).
  // ═══════════════════════════════════════════════════════════════════════
  test('6. Non-régression — toast onAuthWarning fonctionne, aucune collision visuelle avec le bandeau', async () => {
    const { window } = env;

    // Re-déclenche le bandeau pour le faire coexister avec un toast.
    await sendUpdateDownloaded();
    await expect(bannerLocator(window)).toBeVisible({ timeout: 10000 });

    await env.app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.webContents.send('auth:warning', 'ZZTEST — avertissement de session simulé (agent-13)');
    });

    await expect(window.getByText('ZZTEST — avertissement de session simulé (agent-13)')).toBeVisible({
      timeout: 10000
    });
    // Le bandeau doit toujours être là, sans interférence.
    await expect(bannerLocator(window)).toBeVisible();

    await window.screenshot({ path: join(SHOT_DIR, 'agent13-update-banner-06-coexist-with-toast.png') });

    // Vérification géométrique explicite : pas de chevauchement entre le
    // toast (Toaster, top-right) et la carte du bandeau (bottom-center).
    const bannerBox = await window
      .locator('.premium-card.premium-glass.animate-slide-up')
      .first()
      .boundingBox();
    const toastBox = await window
      .getByText('ZZTEST — avertissement de session simulé (agent-13)')
      .first()
      .boundingBox();
    if (bannerBox && toastBox) {
      const overlap =
        bannerBox.x < toastBox.x + toastBox.width &&
        bannerBox.x + bannerBox.width > toastBox.x &&
        bannerBox.y < toastBox.y + toastBox.height &&
        bannerBox.y + bannerBox.height > toastBox.y;
      console.log(`[agent13][UPDATE-BANNER] chevauchement bandeau/toast détecté = ${overlap} (attendu: false)`);
      expect(overlap).toBe(false);
    }

    // Nettoyage de session pour la suite : acquitte le bandeau.
    await window.getByRole('button', { name: "J'ai compris" }).click();
    await expect(bannerLocator(window)).toHaveCount(0, { timeout: 5000 });
  });

  test('7. [Best-effort] Barre "hors-ligne" (TopBar) — pas de collision constatable dans ce harnais', async () => {
    const { window } = env;
    // La barre rouge "hors-ligne" de TopBar.tsx n'apparaît que si
    // syncStatus.queueLength > 0 ET !isOnline. Ce harnais tourne avec
    // GEST_IN_SITU_E2E_DISABLE_SYNC=1 (réseau bloqué en OFFLINE) mais sans
    // garantie qu'un élément outbox soit présent pour ce compte au moment du
    // test — condition non fiablement déclenchable ici sans altérer l'état
    // applicatif au-delà du périmètre de ce spec (STOP & WARN implicite :
    // pas de manipulation de t_outbox pour forcer artificiellement cette
    // condition, hors scope de ce test purement UI/renderer).
    const offlineBarVisible = await window.getByText(/Vous avez des signalements ou données en attente/).count();
    console.log(
      `[agent13][UPDATE-BANNER] Barre hors-ligne visible au moment du test = ${offlineBarVisible > 0} ` +
      `(condition non forcée — documenté comme non testé en conditions réelles si absente).`
    );
    // Documenté dans le rapport final comme non testé en conditions réelles si absente ici.
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Scénario 6 (suite) — onSessionExpired : dernier test du fichier (termine
  // la session / déconnecte l'utilisateur via un alert() natif).
  // ═══════════════════════════════════════════════════════════════════════
  test('8. Non-régression — onSessionExpired (alert natif + logout) fonctionne toujours, sans interférence du bandeau', async () => {
    const { window } = env;

    // Re-déclenche le bandeau pour vérifier qu'il ne bloque/n'interfère pas
    // avec l'alert natif de session expirée.
    await sendUpdateDownloaded();
    await expect(bannerLocator(window)).toBeVisible({ timeout: 10000 });

    let dialogMessage = '';
    window.once('dialog', async (dialog) => {
      dialogMessage = dialog.message();
      await dialog.accept();
    });

    await env.app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.webContents.send('auth:session-expired');
    });

    await window.waitForURL(/#\/login/, { timeout: 15000 });
    console.log(`[agent13][UPDATE-BANNER] alert() natif de session expirée intercepté : "${dialogMessage}"`);
    expect(dialogMessage).toContain('session a été fermée');

    await window.screenshot({ path: join(SHOT_DIR, 'agent13-update-banner-08-session-expired-logout.png') });
  });
});
