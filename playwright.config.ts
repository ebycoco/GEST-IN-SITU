import { defineConfig } from '@playwright/test';

/**
 * playwright.config.ts
 *
 * Configuration dédiée à la suite E2E Electron (`_electron` de
 * @playwright/test), totalement indépendante de `vitest`/`npm test`
 * (voir `vitest.config.ts` à la racine, qui exclut `e2e/**`).
 *
 * Prérequis : `dist/main/index.js`, `dist/preload/index.js` et
 * `dist/renderer/index.html` doivent exister (build via `electron-vite build`,
 * déclenché par le script `pretest:e2e` — jamais automatiquement par un
 * agent, conformément à CLAUDE.md §1).
 *
 * `workers: 1` : chaque test lance sa propre instance Electron isolée
 * (voir e2e/fixtures/electron-app.ts) avec un `--user-data-dir` jetable
 * distinct, ce qui les rend théoriquement parallélisables. Le nombre de
 * workers est volontairement figé à 1 pour ce premier incrément (spike de
 * validation) afin de limiter la consommation RAM simultanée (plusieurs
 * instances Electron complètes en parallèle) et d'obtenir des logs
 * d'exécution non entrelacés plus faciles à diagnostiquer. À revisiter une
 * fois la suite étendue et stabilisée.
 */
export default defineConfig({
  testDir: './e2e/specs',
  testMatch: '**/*.e2e.spec.ts',
  // Le cold start réel de l'application (DB + IPC + auto-updater + premier
  // cycle SyncEngine avant ready-to-show) a été mesuré empiriquement entre
  // ~50s et ~75s sur poste de développement (voir logs/main.log capturés
  // lors du spike de validation). 90s laissait trop peu de marge pour le
  // hook beforeAll (seed + launch + firstWindow) — porté à 180s.
  timeout: 180_000,
  expect: {
    timeout: 15_000
  },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  outputDir: 'test-results',
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  }
});
