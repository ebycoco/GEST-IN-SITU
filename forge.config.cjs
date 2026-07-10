const { MakerSquirrel } = require('@electron-forge/maker-squirrel');
const { MakerZIP } = require('@electron-forge/maker-zip');
const { MakerDMG } = require('@electron-forge/maker-dmg');
const { AutoUnpackNativesPlugin } = require('@electron-forge/plugin-auto-unpack-natives');
const { execSync } = require('child_process');
const path = require('path');

module.exports = {
  packagerConfig: {
    asar: {
      unpack: '**/{*.node,*.dll,better-sqlite3/**}'
    },
    ignore: [
      /^\/src/,
      /^\/\.git/,
      /^\/\.github/,
      /^\/\.vscode/,
      /^\/tsconfig\.json/,
      /^\/electron\.vite\.config\./,
      /^\/README\.md/,
      /^\/dist\/make/,
      /^\/dist\/GEST-IN-SITU/,
      /^\/compile_installer\.ps1/,
      /^\/installer\.iss/,
      /^\/GEMINI\.md/,
      /^\/debug_ignore\.txt/,
      /^\/build-log\.txt/,
      /^\/create_project\.json/,
      /^\/scratch/,
      /^\/supabase_schema\.sql/,
      /^\/scripts/,
      /^\/index-relais\.js/,
      /^\/out/
    ],
    icon: './resources/icon',
    name: 'GEST-IN-SITU',
    executableName: 'gest-in-situ',
    appBundleId: 'com.ebycoco.gest-in-situ',
    appCopyright: 'Copyright © 2026 EBYCHOCO',
    win32metadata: {
      CompanyName: 'EBYCHOCO',
      ProductName: 'GEST-IN-SITU',
      FileDescription: 'Gestion logistique des cartes CMU'
    }
  },
  makers: [
    new MakerZIP({}, ['win32', 'darwin', 'linux'])
  ],
  plugins: [
    new AutoUnpackNativesPlugin({})
  ],
  // --- HOOK CRITIQUE : Recompilation native de better-sqlite3 pour l'ABI Electron ---
  // Ce hook s'exécute APRÈS que electron-forge a copié les node_modules dans le
  // répertoire de staging et avant la création de l'archive ASAR.
  // Sans ce hook, le binaire .node est compilé pour Node.js (ABI incompatible avec
  // Electron), ce qui cause un crash silencieux sur toute machine autre que la machine
  // de développement.
  hooks: {
    packageAfterPrune: async (_config, buildPath) => {
      console.log('[Hook] packageAfterPrune : Recompilation native de better-sqlite3 pour Electron...');
      try {
        execSync(
          'npm rebuild better-sqlite3 --runtime=electron --target=34.5.8 --dist-url=https://electronjs.org/headers --build-from-source',
          {
            cwd: buildPath,
            stdio: 'inherit',
            env: {
              ...process.env,
              // Forcer le mode production pour éviter les dépendances de dev
              NODE_ENV: 'production'
            }
          }
        );
        console.log('[Hook] packageAfterPrune : Recompilation native terminée avec succès.');
      } catch (err) {
        // On logue l'erreur en détail pour faciliter le diagnostic mais on ne bloque pas
        // le packaging si la recompilation échoue (mieux vaut livrer que planter le build).
        console.error('[Hook] packageAfterPrune ERREUR : La recompilation native a échoué.', err.message);
        console.error('[Hook] Vérifier que les outils natifs (Visual C++ Build Tools, Python) sont installés.');
      }
    }
  },
  publishers: [
    {
      name: '@electron-forge/publisher-github',
      config: {
        repository: {
          owner: 'ebycoco',
          name: 'GEST-IN-SITU'
        },
        prerelease: false,
        draft: true
      }
    }
  ]
};
