import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { copyFileSync, mkdirSync, existsSync } from 'fs';
import { loadEnv } from 'vite';

// Plugin to copy worker files to output
// `outBase` DOIT suivre le même dossier de sortie que `main.build.outDir`
// (voir plus bas) — sinon un build `--mode e2e` copierait ses workers dans
// `dist/main/workers` (build prod) au lieu de `dist-e2e-cloud/main/workers`,
// cassant silencieusement bulk-uploader.ts (upload-worker.js) et
// downstream.ts (download-worker.js) pour ce mode.
function copyWorkerPlugin(outBase: string) {
  return {
    name: 'copy-worker',
    closeBundle() {
      const outDir = resolve(`${outBase}/main/workers`);
      if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
      
      const importWorker = resolve('src/main/workers/import-worker.js');
      if (existsSync(importWorker)) copyFileSync(importWorker, resolve(outDir, 'import-worker.js'));
      
      const uploadWorker = resolve('src/main/workers/upload-worker.js');
      if (existsSync(uploadWorker)) copyFileSync(uploadWorker, resolve(outDir, 'upload-worker.js'));
      
      const statsWorker = resolve('src/main/workers/stats-worker.js');
      if (existsSync(statsWorker)) copyFileSync(statsWorker, resolve(outDir, 'stats-worker.js'));

      const downloadWorker = resolve('src/main/workers/download-worker.js');
      if (existsSync(downloadWorker)) copyFileSync(downloadWorker, resolve(outDir, 'download-worker.js'));
    }
  };
}

export default defineConfig(({ mode }) => {
  // Charger les variables .env pour les injecter dans le main process
  const env = loadEnv(mode, process.cwd(), '');

  // ─── Isolation structurelle du build e2e-cloud (mode === 'e2e') ───────────
  // Un build lancé avec `--mode e2e` (donc `.env.e2e` en tête de cascade
  // loadEnv, voir .env.e2e à la racine) sort dans un dossier PHYSIQUEMENT
  // DISTINCT (`dist-e2e-cloud/`) de celui du build de production (`dist/`).
  // Conséquences volontaires :
  //  - `electron-builder.yml` (files: dist/**, extraMetadata.main: dist/main/
  //    index.js) ne référence QUE `dist/` — il ne peut structurellement pas
  //    embarquer un artefact issu de `dist-e2e-cloud/` dans un installeur.
  //  - `npm run build` / `build:win` / `release` (aucun `--mode`, donc mode
  //    par défaut 'production') continuent à écrire exclusivement dans
  //    `dist/` à partir de `.env` (identifiants Supabase PROD), comme avant
  //    ce changement — comportement 100% inchangé.
  //  - `npm run dev` (mode 'development') écrit aussi dans `dist/` comme
  //    avant.
  //  - Aucune commande de packaging ne lit jamais `dist-e2e-cloud/`.
  // Voir e2e/fixtures/electron-app.ts pour la procédure complète de build/
  // lancement de ce mode et la procédure de retour en sécurité au build prod.
  const outBase = mode === 'e2e' ? 'dist-e2e-cloud' : 'dist';

  return {
  main: {
    plugins: [externalizeDepsPlugin(), copyWorkerPlugin(outBase)],
    define: {
      // Injecter les variables Supabase dans le bundle Main (process.env)
      'process.env.VITE_SUPABASE_URL': JSON.stringify(env.VITE_SUPABASE_URL || ''),
      'process.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(env.VITE_SUPABASE_ANON_KEY || ''),
      'process.env.SUPABASE_SUPERADMIN_PASSWORD': JSON.stringify(env.SUPABASE_SUPERADMIN_PASSWORD || ''),
      'process.env.SUPABASE_SITE_PASSWORD_PREFIX': JSON.stringify(env.SUPABASE_SITE_PASSWORD_PREFIX || ''),
    },
    build: {
      outDir: `${outBase}/main`,
      rollupOptions: {
        external: ['better-sqlite3']
      }
    },
    esbuild: {
      drop: mode === 'production' ? ['console', 'debugger'] : []
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: `${outBase}/preload`
    },
    esbuild: {
      drop: mode === 'production' ? ['console', 'debugger'] : []
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@': resolve('src/renderer/src'),
        '@components': resolve('src/renderer/src/components'),
        '@pages': resolve('src/renderer/src/pages'),
        '@stores': resolve('src/renderer/src/stores'),
        '@hooks': resolve('src/renderer/src/hooks'),
        '@utils': resolve('src/renderer/src/utils'),
        '@assets': resolve('src/renderer/src/assets')
      }
    },
    plugins: [react()],
    optimizeDeps: {
      include: ['react', 'react-dom', 'react-router-dom', 'lucide-react']
    },
    build: {
      outDir: `${outBase}/renderer`,
      rollupOptions: {
        input: resolve('src/renderer/index.html')
      }
    },
    esbuild: {
      drop: mode === 'production' ? ['console', 'debugger'] : []
    }
  }
  };
});
