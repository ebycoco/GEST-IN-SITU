import { getDatabase } from '../database/connection';
import { getCurrentUserLogin, getSecureCurrentUser } from '../auth/session-heartbeat';
import { enqueueOutbox, scheduleOutboxProcessing } from '../sync/outbox.service';
import { networkMonitor } from '../sync/network-monitor';
import { v4 as uuidv4 } from 'uuid';
import log from 'electron-log';

/**
 * Liste blanche des actions CRUD métier réelles devant transiter par `t_logs` (synchronisée
 * Supabase, cross-poste) EN PLUS de `t_audit_log` (100% locale, comportement inchangé).
 *
 * Décision validée avec l'utilisateur (plan d'impact agent-1) : seules les actions ci-dessous
 * doivent devenir visibles cross-poste dans le Journal d'Audit Système. Sont explicitement
 * EXCLUES : connexions/déconnexions, consultations de pages (dont SYSTEM_LOG_CONSULTATION),
 * exports — ces actions restent journalisées SEULEMENT dans t_audit_log, comme aujourd'hui.
 *
 * Aucun de ces noms d'action ne doit jamais recouper les 6 actions réservées aux notifications
 * de synchro déjà lues par getUnreadSyncNotifications/getUnreadNotificationsList
 * (logs.queries.ts) : SYNC_UPDATE, CARTE_ABSENTE_SIGNALEE, CARTE_ABSENTE_ESCALADEE,
 * CARTE_ABSENTE_RETROUVEE, CARTE_PERDUE_CONFIRMEE, CARTE_PERDUE_RETROUVEE.
 *
 * Écart comblé (décision utilisateur validée, suite du rapport agent-4 précédent) : la
 * délivrance/le transfert de carte (`cartes:delivrer`/`cartes:transferer`, handlers.ts) et la
 * création/suppression d'utilisateur (`queries.createUser()`, `users:delete`/`users:hardDelete`,
 * handlers.ts) journalisaient exclusivement via `insertAuditLog()` (t_audit_log, hors périmètre
 * t_logs). Des appels logAudit() dédiés ont été ajoutés en plus (jamais en remplacement) de ces
 * insertAuditLog() existants pour couvrir ces actions ci-dessous.
 */
export const CRUD_SYNC_WHITELIST: ReadonlySet<string> = new Set([
  // Cartes CMU — création / modification / suppression / changement de statut (canal cartes:*)
  'CARTE_SAISIE',
  'CARTE_MODIFICATION',
  'CARTE_SUPPRESSION',
  // Cartes CMU — délivrance / transfert (cartes:delivrer, cartes:transferer)
  'CARTE_DELIVREE',
  'CARTE_TRANSFEREE',
  // Cartes CMU — même entité métier, canal alternatif cmu:*
  'CMU_SAISIE',
  'CMU_NOUVELLE_SAISIE',
  'CMU_MODIFICATION',
  'CMU_SUPPRESSION',
  'CMU_CHANGEMENT_STATUT',
  // Utilisateurs — modification (droits/rôle)
  'SYS_MODIF_DROITS',
  'SYS_ELEVATION_PRIVILEGE',
  // Utilisateurs — création (queries.createUser) / suppression (users:delete, users:hardDelete)
  'UTILISATEUR_CREE',
  'UTILISATEUR_SUPPRIME',
]);

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

      // Utilisation du login explicite, ou fallback sur la session active
      const sessionLogin = getCurrentUserLogin();
      let resolvedUser = utilisateur || sessionLogin || 'system';

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

      // ── Aiguillage CRUD synchronisable (t_logs) ──────────────────────────────
      // En plus de l'écriture t_audit_log ci-dessus (comportement inchangé), les actions de
      // la liste blanche sont EN PLUS dupliquées dans t_logs (déjà synchronisée Supabase,
      // colonnes site_id/centre_id/sync_id/is_dirty prêtes) et enfilées dans l'outbox, pour
      // devenir visibles cross-poste dans le Journal d'Audit (voir CRUD_SYNC_WHITELIST
      // ci-dessus). Isolé dans son propre try/catch : un échec ici ne doit jamais remettre en
      // cause l'écriture t_audit_log déjà effectuée.
      if (CRUD_SYNC_WHITELIST.has(action)) {
        try {
          const secureUser = getSecureCurrentUser();
          if (!secureUser || !secureUser.site_id) {
            log.warn(`[AUDIT] Action CRUD "${action}" non synchronisée via t_logs : aucune session serveur active pour résoudre site_id (cloisonnement P0).`);
          } else {
            const syncId = uuidv4();
            // Neutralisation FK ROOT (même garde que logAction() dans logs.queries.ts) : le
            // compte ROOT Failsafe (id 999999) n'existe pas dans t_users.
            const safeUserId = (secureUser.id_user === 999999) ? null : (secureUser.id_user ?? null);
            const centreId = secureUser.centre_id ?? null;

            db.prepare(`
              INSERT INTO t_logs (id_user, login_user, action, detail, site_id, centre_id, sync_id, is_dirty)
              VALUES (?, ?, ?, ?, ?, ?, ?, 1)
            `).run(safeUserId, resolvedUser, action, jsonDetails, secureUser.site_id, centreId, syncId);

            enqueueOutbox(syncId, 't_logs', 'INSERT', {
              sync_id: syncId,
              id_user: safeUserId,
              login_user: resolvedUser,
              action,
              detail: jsonDetails,
              site_id: secureUser.site_id,
              centre_id: centreId,
              date_heure: new Date().toISOString()
            });

            if (networkMonitor.getState() === 'ONLINE') {
              scheduleOutboxProcessing();
            }
          }
        } catch (syncErr) {
          log.error(`[AUDIT] Échec de la synchronisation CRUD (t_logs) pour l'action "${action}" :`, syncErr);
        }
      }

    } catch (err) {
      // Encapsulation complète pour garantir la résilience métier
      log.error('[AUDIT ERROR] Échec de la journalisation d\'audit :', err);
    }
  });
}

