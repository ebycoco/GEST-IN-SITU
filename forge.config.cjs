const { MakerSquirrel } = require('@electron-forge/maker-squirrel');
const { MakerZIP } = require('@electron-forge/maker-zip');
const { MakerDMG } = require('@electron-forge/maker-dmg');
const { AutoUnpackNativesPlugin } = require('@electron-forge/plugin-auto-unpack-natives');

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
