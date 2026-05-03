const { MakerSquirrel } = require('@electron-forge/maker-squirrel');
const { MakerZIP } = require('@electron-forge/maker-zip');
const { MakerDMG } = require('@electron-forge/maker-dmg');
const { AutoUnpackNativesPlugin } = require('@electron-forge/plugin-auto-unpack-natives');

module.exports = {
  packagerConfig: {
    asar: {
      unpack: '**/{*.node,*.dll,better-sqlite3/**}'
    },
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
    new MakerSquirrel({
      name: 'GEST-IN-SITU',
      setupIcon: './resources/icon.ico',
      setupExe: 'GEST-IN-SITU-Setup.exe',
      noMsi: true
    }),
    new MakerZIP({}, ['darwin', 'linux']),
    new MakerDMG({
      name: 'GEST-IN-SITU',
      icon: './resources/icon.icns',
      format: 'ULFO'
    })
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
