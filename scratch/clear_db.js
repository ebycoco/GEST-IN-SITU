const Database = require('better-sqlite3');
const path = 'C:\\Users\\EBYCHOCO\\AppData\\Roaming\\gest-in-situ-v2\\data\\gest_in_situ.db';

try {
  const db = new Database(path);
  console.log('Connected to database at:', path);

  // Vider les tables principales
  const resultCartes = db.prepare('DELETE FROM t_cartes').run();
  console.log('Table t_cartes vidée:', resultCartes.changes, 'lignes supprimées');

  const resultTemp = db.prepare('DELETE FROM t_import_temp').run();
  console.log('Table t_import_temp vidée:', resultTemp.changes, 'lignes supprimées');

  // Réinitialiser les index FTS5 si nécessaire
  try {
    db.prepare('DELETE FROM t_cartes_fts').run();
    console.log('Index FTS5 vidé.');
  } catch (e) {
    console.log('Note: Pas de table FTS5 ou erreur lors de sa vidange.');
  }

  // Optionnel: Réinitialiser les auto-incréments
  db.prepare("DELETE FROM sqlite_sequence WHERE name='t_cartes'").run();
  db.prepare("DELETE FROM sqlite_sequence WHERE name='t_import_temp'").run();
  
  console.log('Base de données réinitialisée avec succès.');
  db.close();
} catch (error) {
  console.error('Erreur lors de la réinitialisation de la base de données:', error.message);
  process.exit(1);
}
