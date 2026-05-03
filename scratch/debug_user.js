const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');

const dbPath = path.join(os.homedir(), 'AppData', 'Roaming', 'gest-in-situ', 'data', 'gest_in_situ.db');
console.log('Connecting to:', dbPath);

try {
  const db = new Database(dbPath);
  const user = db.prepare("SELECT * FROM t_users WHERE login = 'superadmin'").get();
  console.log('DEBUG User:', user);
  db.close();
} catch (e) {
  console.error('ERROR:', e.message);
}
