/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Lancer depuis mobile/ (npx vite, npx vite build) : racine et dossier des fichiers .env =
// mobile/ (valeurs par defaut de Vite) ; les fichiers .env de la racine du depot ne sont
// jamais lus.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2020',
  },
  // 5173 / 4173 = origines autorisees par defaut dans gis-login (DEFAULT_ALLOWED_ORIGINS).
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
