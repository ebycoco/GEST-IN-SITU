import { getDatabase } from '../database/connection';
import { getCurrentUserLogin } from '../auth/session-heartbeat';
import log from 'electron-log';

/**
 * Enregistre une action utilisateur ou système dans la table d'audit `t_audit_log`.
 * Cette fonction est entièrement sécurisée, idempotente et résiliente :
 * si la table n'existe pas, elle est créée à la volée. Un échec d'écriture n'interrompt jamais l'action appelante.
 */
export function logAudit(utilisateur: string | null | undefined, action: string, details: any): void {
  // Exécution asynchrone non-bloquante pour libérer le thread principal instantanément
  setImmediate(() => {
    try {
      const db = getDatabase();
      if (!db) {
        log.warn('[AUDIT] Base de données indisponible pour enregistrer l\'audit.');
        return;
      }

      // Création dynamique de la table t_audit_log si elle est absente
      db.prepare(`
        CREATE TABLE IF NOT EXISTS t_audit_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          utilisateur TEXT,
          action TEXT,
          details TEXT,
          date_creation TEXT DEFAULT (datetime('now'))
        );
      `).run();

      // Utilisation du login de session actif comme identifiant principal
      const sessionLogin = getCurrentUserLogin();
      let resolvedUser = sessionLogin || utilisateur || 'system';

      // Garantir que details est un JSON structuré valide pour analyse de sécurité
      let jsonDetails = '';
      let detailsObj: any = {};
      if (typeof details === 'object' && details !== null) {
        detailsObj = { ...details };
      } else {
        try {
          detailsObj = JSON.parse(details);
        } catch (e) {
          detailsObj = { message: details };
        }
      }

      // Capture de la version du schéma SQLite pour le suivi de la version de la base de données
      try {
        const schemaVer = db.pragma('user_version', { simple: true }) as number;
        detailsObj.sqlite_schema_version = schemaVer;
      } catch (schemaErr) {
        // Ignorer silencieusement si inaccessible
      }

      jsonDetails = JSON.stringify(detailsObj);

      // Détection d'idempotence temporelle (2 secondes) pour ignorer les doublons de double-clic
      const duplicate = db.prepare(`
        SELECT id FROM t_audit_log 
        WHERE utilisateur = ? AND action = ? AND details = ? AND date_creation > datetime('now', '-2 seconds')
      `).get(resolvedUser, action, jsonDetails);

      if (duplicate) {
        log.warn(`[AUDIT] Action d'audit doublonnée détectée et ignorée (idempotence) : ${action}`);
        return;
      }

      // Insertion idempotente et robuste
      db.prepare(`
        INSERT INTO t_audit_log (utilisateur, action, details, date_creation)
        VALUES (?, ?, ?, datetime('now'));
      `).run(resolvedUser, action, jsonDetails);

    } catch (err) {
      // Encapsulation complète pour garantir la résilience métier
      log.error('[AUDIT ERROR] Échec de la journalisation d\'audit :', err);
    }
  });
}

