// Point d'entrée Electron.
// electron-vite compile TOUJOURS vers out/main/index.js.
// Ce fichier est le "main" déclaré dans package.json pour que
// Electron Forge puisse le trouver à la racine du package.

const path = require('path');

try {
  require(path.join(__dirname, 'out', 'main', 'index.js'));
} catch (e) {
  if (e.code === 'MODULE_NOT_FOUND') {
    throw new Error(
      '[index-relais] Impossible de charger out/main/index.js.\n' +
      'Lancez "npm run build" avant de packager l\'application.\n' +
      'Détail : ' + e.message
    );
  }
  throw e;
}