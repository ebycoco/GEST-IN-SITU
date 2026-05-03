const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');

const dbPath = path.join(os.homedir(), 'AppData', 'Roaming', 'gest-in-situ', 'data', 'gest_in_situ.db');
console.log('Connecting to:', dbPath);

try {
  const db = new Database(dbPath);
  db.prepare("UPDATE t_users SET password_hash = 'admin' WHERE id_user = 1").run();
  console.log('SUCCESS: User "superadmin" password set to "admin"');
  db.close();
} catch (e) {
  console.error('ERROR:', e.message);
}
