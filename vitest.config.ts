import { defineConfig } from 'vitest/config';

/**
 * vitest.config.ts
 *
 * Explicite la configuration vitest (jusqu'ici implicite/par défaut) pour
 * exclure définitivement le dossier `e2e/**` de sa collecte de specs.
 *
 * Sans ce fichier, le pattern de découverte par défaut de vitest
 * (`**\/*.{test,spec}.{js,ts,...}`) risquait de capturer également les
 * futures specs E2E nommées `*.e2e.spec.ts` sous `e2e/specs/`, provoquant
 * une collision entre `npm test` (vitest) et `npm run test:e2e`
 * (playwright — voir playwright.config.ts). Les deux suites restent
 * strictement indépendantes.
 */
export default defineConfig({
  test: {
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/out/**',
      '**/build/**',
      'e2e/**'
    ]
  }
});
