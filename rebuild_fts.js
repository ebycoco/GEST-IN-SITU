const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');

// In Electron, app.getPath('userData') on Windows defaults to %APPDATA%\<app-name>
const dbPath = path.join(os.homedir(), 'AppData', 'Roaming', 'gest-in-situ', 'data', 'gest_in_situ.db');

try {
  console.log('Connecting to database at:', dbPath);
  const db = new Database(dbPath);
  
  console.log('Running FTS5 rebuild...');
  db.exec("INSERT INTO t_cartes_fts(t_cartes_fts) VALUES('rebuild');");
  
  console.log('Rebuild successful!');
  db.close();
} catch (e) {
  console.error('Error rebuilding FTS5 index:', e);
}
