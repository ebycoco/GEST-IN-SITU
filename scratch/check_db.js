const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');

// Déterminer le chemin de la DB (basé sur connection.ts)
const dbPath = path.join(os.homedir(), '.gest-in-situ', 'database.sqlite');
console.log('Vérification de la base de données :', dbPath);

try {
  const db = new Database(dbPath);
  
  const version = db.pragma('user_version', { simple: true });
  console.log('Version du schéma :', version);

  const tables = ['t_sites', 't_users', 't_cartes'];
  
  tables.forEach(table => {
    try {
      const info = db.prepare(`PRAGMA table_info(${table})`).all();
      console.log(`\nColonnes pour ${table} :`);
      info.forEach(col => console.log(` - ${col.name} (${col.type})`));
    } catch (e) {
      console.error(`Erreur lors de la lecture de ${table} :`, e.message);
    }
  });

  db.close();
} catch (e) {
  console.error('Impossible d\'ouvrir la base de données :', e.message);
}
