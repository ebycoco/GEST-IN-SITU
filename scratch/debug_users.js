const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');

// Path corrected based on src/main/database/connection.ts
const dbPath = path.join(os.homedir(), 'AppData', 'Roaming', 'gest-in-situ', 'data', 'gest_in_situ.db');
console.log('Opening DB at:', dbPath);

try {
  const db = new Database(dbPath);
  const users = db.prepare('SELECT id_user, login, role, site_id FROM t_users').all();
  console.log('ALL USERS IN DB:');
  console.table(users);
  db.close();
} catch (e) {
  console.error('Error:', e.message);
}
