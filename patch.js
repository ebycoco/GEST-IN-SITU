const db = require('better-sqlite3')('database.sqlite');
const result = db.prepare("UPDATE t_cartes SET centre_id = (SELECT centre_id FROM t_users WHERE t_users.login = t_cartes.agent_signalement_absence LIMIT 1) WHERE statut_physique = 'ABSENT' AND centre_id IS NULL").run();
console.log('Updated ' + result.changes + ' missing cards');
