// @ts-check
// Configuration ESLint (format « flat config », ESLint 10) de GEST-IN-SITU.
//
// Principes :
//  - Règles « recommandées » SANS analyse des types (plus légère : postes de développement à 8 Go).
//    Le typage strict reste vérifié par `npx tsc --noEmit` (CLAUDE.md §5).
//  - Les règles les plus bruyantes sur le code historique sont en « warn » : `npm run lint` passe
//    (0 erreur) sans réécrire du code en production ; on peut les durcir progressivement.
//  - Règles des hooks React sur le renderer (nettoyage des abonnements IPC, dépendances, CLAUDE.md §2).
import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'dist-e2e-cloud/**',
      'dist-electron-builder/**',
      'node_modules/**',
      'out/**',
      'test-results/**',
      'playwright-report/**',
      'ud_l2/**'
    ]
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Règles communes à tout src/ : le code historique en contient beaucoup, d'où « warn ».
  {
    files: ['src/**/*.{ts,tsx,js,mjs}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      '@typescript-eslint/no-require-imports': 'warn',
      '@typescript-eslint/no-empty-object-type': 'warn',
      '@typescript-eslint/no-unused-expressions': 'warn',
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-useless-escape': 'warn',
      'no-control-regex': 'warn',
      'no-case-declarations': 'warn',
      'prefer-const': 'warn',
      // Règles plus strictes d'ESLint 10 / typescript-eslint 8, signalées sur du code historique
      // qui fonctionne : « warn » (à traiter progressivement, pas dans cette tâche).
      'preserve-caught-error': 'warn',
      'no-useless-assignment': 'warn',
      'no-useless-catch': 'warn',
      'no-irregular-whitespace': 'warn',
      'no-prototype-builtins': 'warn',
      '@typescript-eslint/no-unsafe-function-type': 'warn',
      '@typescript-eslint/ban-ts-comment': 'warn'
    }
  },

  // Processus principal, preload, code partagé : environnement Node.
  {
    files: ['src/main/**/*.{ts,js}', 'src/preload/**/*.ts', 'src/shared/**/*.ts'],
    languageOptions: { globals: { ...globals.node } }
  },

  // Workers (JavaScript, thread séparé).
  {
    files: ['src/main/workers/*.js'],
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-require-imports': 'off'
    }
  },

  // Renderer (React) : navigateur + règles des hooks.
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn'
    }
  }
);
