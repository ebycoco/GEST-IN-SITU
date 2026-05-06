const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(process.env.APPDATA, 'gest-in-situ', 'data', 'gest_in_situ.db');

if (!fs.existsSync(dbPath)) {
    console.error('Base de données non trouvée à :', dbPath);
    process.exit(1);
}

console.log('Connexion à la base de données :', dbPath);
const db = new Database(dbPath);

try {
    db.transaction(() => {
        // Supprimer toutes les cartes
        const resCartes = db.prepare('DELETE FROM t_cartes').run();
        console.log(`- Supprimé ${resCartes.changes} cartes.`);

        // Supprimer toutes les données temporaires
        db.prepare('DELETE FROM t_import_temp').run();
        db.prepare('DELETE FROM t_sync_queue').run();
        console.log('- Vidé les tables temporaires.');

        // Supprimer les logs
        db.prepare('DELETE FROM t_logs').run();
        console.log('- Supprimé les journaux (logs).');

        // Supprimer les utilisateurs sauf SUPER ADMIN
        const resUsers = db.prepare("DELETE FROM t_users WHERE role != 'SUPER ADMIN'").run();
        console.log(`- Supprimé ${resUsers.changes} utilisateurs (hors Super Admin).`);
    })();

    console.log('Optimisation de la base (VACUUM)...');
    db.pragma('journal_mode = DELETE'); // Reset WAL to single file if needed
    db.prepare('VACUUM').run();
    
    console.log('\n--- RÉINITIALISATION TERMINÉE AVEC SUCCÈS ---');
} catch (error) {
    console.error('ERREUR LORS DE LA RÉINITIALISATION :', error);
} finally {
    db.close();
}
