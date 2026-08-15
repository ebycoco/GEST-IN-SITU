import log from 'electron-log';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../database/connection';
import { getSupabaseClient } from './supabase-client';
import { networkMonitor } from './network-monitor';
import { mapCardPayload } from './payload-mapper';

// ─── Constantes de configuration ────────────────────────────────────────────
/** Nombre maximal de tentatives avant de basculer une entrée en ERROR. */
const MAX_OUTBOX_ATTEMPTS = 5;

/** Taille du lot traité à chaque appel de processOutboxPending. */
const OUTBOX_BATCH_SIZE = 50;

// ─── Types internes ──────────────────────────────────────────────────────────
interface OutboxEntry {
  id: string;
  table_name: string;
  /** INSERT et UPDATE → upsert Supabase. DELETE → .delete().eq('sync_id', ...). */
  operation: 'INSERT' | 'UPDATE' | 'DELETE';
  payload: string;
  created_at: string;
  status: 'PENDING' | 'SYNCED' | 'ERROR';
  error_msg: string | null;
  attempts: number;
  depends_on: string | null;
}

// ─── API publique ────────────────────────────────────────────────────────────

/**
 * Enfile une opération dans t_outbox de façon **idempotente**.
 *
 * Garantie d'idempotence :
 *   La clé primaire `id` est un UUID v4 fourni par l'appelant.
 *   Un `INSERT OR IGNORE` garantit qu'un double appel avec le même UUID
 *   ne crée pas de doublon — l'entrée existante est silencieusement ignorée.
 *
 * @param id        - UUID v4 unique identifiant l'opération (fourni par l'appelant).
 * @param tableName - Table cible Supabase (ex: 't_sites', 't_centres', 't_users').
 * @param operation - Type d'opération : 'INSERT' | 'UPDATE' | 'DELETE'.
 * @param payload   - Pour INSERT/UPDATE : objet complet. Pour DELETE : { sync_id }.
 */
export function enqueueOutbox(
  id: string,
  tableName: string,
  operation: 'INSERT' | 'UPDATE' | 'DELETE',
  payload: Record<string, unknown>,
  dependsOnId: string | null = null
): void {
  try {
    const db = getDatabase();
    if (!db) {
      log.error('[OutboxService] enqueueOutbox : base de données non disponible.');
      return;
    }

    const payloadJson = JSON.stringify(payload);

    log.info(`[OutboxService] Enfilage outbox tenté (id=${id}, table=${tableName}, op=${operation}, payload=${payloadJson}, dependsOn=${dependsOnId})`);
    
    // UPSERT : si l'UUID existe déjà, on met à jour le payload et on le repasse en PENDING.
    db.prepare(`
      INSERT INTO t_outbox (id, table_name, operation, payload, status, attempts, created_at, error_msg, depends_on)
      VALUES (?, ?, ?, ?, 'PENDING', 0, datetime('now'), NULL, ?)
      ON CONFLICT(id) DO UPDATE SET 
        operation = excluded.operation,
        payload = excluded.payload,
        status = 'PENDING',
        attempts = 0,
        error_msg = NULL,
        created_at = datetime('now'),
        depends_on = excluded.depends_on
    `).run(id, tableName, operation, payloadJson, dependsOnId);

    log.info(`[OutboxService] Enfilé → ${tableName} [${operation}] (id=${id})`);

      // Validation visuelle : afficher un aperçu des entrées PENDING (LIMIT 10 pour éviter la saturation des logs en production)
    try {
      const pendingItems = db.prepare("SELECT id, table_name, operation, status FROM t_outbox WHERE status = 'PENDING' LIMIT 10").all() as any[];
      log.info(`[OutboxService] Aperçu file d'attente t_outbox (max 10 PENDING) : ${JSON.stringify(pendingItems)}`);
    } catch (e: any) {
      log.error(`[OutboxService] Impossible de lister la file t_outbox :`, e.message);
    }
  } catch (err: any) {
    log.error(`[OutboxService] Erreur lors de l'enfilage dans t_outbox (id=${id}) :`, err.message || err);
  }
}

/**
 * Purge une entrée INSERT encore en statut PENDING dans t_outbox.
 *
 * Cas d'usage : une entité est supprimée avant d'avoir été synchronisée.
 * Au lieu d'envoyer la paire INSERT+DELETE à Supabase (ce qui provoquerait
 * une erreur 404 sur le DELETE), on annule silencieusement l'INSERT local.
 * Un DELETE n'est alors enfilé que si l'entité était déjà synchronisée
 * (i.e., aucune entrée INSERT PENDING n'existait).
 *
 * @returns `true` si une entrée PENDING a été trouvée et supprimée, `false` sinon.
 */
export function cancelPendingInsert(syncId: string, tableName: string): boolean {
  try {
    const db = getDatabase();
    if (!db) return false;

    const result = db.prepare(`
      DELETE FROM t_outbox
      WHERE id = ? AND table_name = ? AND operation = 'INSERT' AND status = 'PENDING'
    `).run(syncId, tableName);

    if (result.changes > 0) {
      log.info(`[OutboxService] INSERT PENDING annulé pour ${tableName} (sync_id=${syncId}) — entité supprimée avant synchronisation.`);
      return true;
    }
    return false;
  } catch (err: any) {
    log.error(`[OutboxService] Erreur dans cancelPendingInsert (sync_id=${syncId}) :`, err.message || err);
    return false;
  }
}

/**
 * Traite séquentiellement les entrées `PENDING` de t_outbox.
 *
 * Comportement asynchrone et résilient :
 *  - Lit jusqu'à OUTBOX_BATCH_SIZE entrées PENDING, triées par date de création.
 *  - Pour chaque entrée : appel Supabase upsert → mise à jour du statut.
 *  - Erreur réseau (timeout, pas de réponse) → statut CONSERVÉ en PENDING
 *    pour être retenté lors du prochain appel.
 *  - Erreur applicative (payload invalide, >MAX_OUTBOX_ATTEMPTS tentatives) → ERROR.
 *
 * Thread Safety :
 *  - Cette fonction est appelée via setImmediate() par scheduleOutboxProcessing()
 *    pour ne jamais bloquer le thread UI d'Electron.
 *  - Un verrou interne `_isProcessing` prévient les exécutions concurrentes.
 *
 * @returns Objet { processed, errors } indiquant les résultats du traitement.
 */
export async function processOutboxPending(): Promise<{ processed: number; errors: number }> {
  // Verrou anti-concurrence léger (flag module-level)
  if (_isProcessing) {
    log.info('[OutboxService] processOutboxPending ignoré : traitement déjà en cours.');
    return { processed: 0, errors: 0 };
  }

  _isProcessing = true;
  let processed = 0;
  let errors = 0;

  try {
    const db = getDatabase();
    if (!db) return { processed: 0, errors: 0 };

    // Vérification de la disponibilité réseau avant tout traitement Supabase
    const networkState = networkMonitor.getState();
    if (networkState !== 'ONLINE') {
      log.info(`[OutboxService] Réseau ${networkState} — traitement de l'outbox différé.`);
      return { processed: 0, errors: 0 };
    }

    // Lire le prochain lot d'entrées PENDING
    const pendingEntries = db.prepare(`
      SELECT id, table_name, operation, payload, status, error_msg, attempts, depends_on
      FROM t_outbox
      WHERE status = 'PENDING'
      ORDER BY created_at ASC
      LIMIT ?
    `).all(OUTBOX_BATCH_SIZE) as OutboxEntry[];

    if (pendingEntries.length === 0) {
      return { processed: 0, errors: 0 };
    }

    log.info(`[OutboxService] Traitement de ${pendingEntries.length} entrée(s) PENDING...`);

    const supabase = getSupabaseClient();
    if (!supabase) {
      log.warn('[OutboxService] Client Supabase non disponible — traitement outbox ignoré.');
      return { processed: 0, errors: 0 };
    }

    for (const entry of pendingEntries) {
      if (entry.depends_on) {
        const parent = db.prepare('SELECT status FROM t_outbox WHERE id = ?').get(entry.depends_on) as { status: string } | undefined;
        if (parent && parent.status === 'ERROR') {
          _markOutboxError(db, entry.id, entry.attempts + 1, "Action parente en échec définitif. Opération suspendue.");
          errors++;
          continue;
        } else if (parent && parent.status === 'PENDING') {
          continue; // Parent pas encore prêt, on reporte à plus tard sans erreur
        }
      }

      const newAttempts = entry.attempts + 1;

      // Vérification du seuil de tentatives avant tout appel réseau
      if (newAttempts > MAX_OUTBOX_ATTEMPTS) {
        _markOutboxError(db, entry.id, newAttempts, `Nombre maximum de tentatives (${MAX_OUTBOX_ATTEMPTS}) atteint.`);
        log.error(`[OutboxService] Entrée ${entry.id} (${entry.table_name}) basculée en ERROR après ${MAX_OUTBOX_ATTEMPTS} tentatives.`);
        errors++;
        continue;
      }

      // Incrémenter le compteur de tentatives avant l'appel réseau
      db.prepare(`UPDATE t_outbox SET attempts = ? WHERE id = ?`).run(newAttempts, entry.id);

      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(entry.payload);
        
        // Mappage strict des booléens pour PostgreSQL (Supabase)
        if (entry.table_name === 't_sites') {
          if (payload.is_active !== undefined) payload.is_active = Boolean(payload.is_active);
          if (payload.is_permanent !== undefined) payload.is_permanent = Boolean(payload.is_permanent);
        } else if (entry.table_name === 't_users') {
          if (payload.statut_actif !== undefined) {
            // PostgreSQL attend un entier (1/0) pour t_users.statut_actif
            payload.statut_actif = (payload.statut_actif === true || payload.statut_actif === 1 || payload.statut_actif === 'true') ? 1 : 0;
          }
        }

      } catch (parseErr: any) {
        _markOutboxError(db, entry.id, newAttempts, `Payload JSON invalide : ${parseErr.message}`);
        log.error(`[OutboxService] Payload invalide pour l'entrée ${entry.id} :`, parseErr.message);
        errors++;
        continue;
      }

      try {
        // ── Dispatcher selon le type d'opération ─────────────────────────────
        // INSERT / UPDATE → upsert idempotent sur sync_id
        // DELETE          → suppression ciblée par sync_id
        let supabaseError: { message: string } | null = null;

        if (entry.operation === 'DELETE') {
          // Un payload DELETE ne contient que { sync_id } (ou { user_sync_id } pour t_user_roles)
          const syncIdToDelete = (payload['sync_id'] || payload['user_sync_id']) as string | undefined;
          if (!syncIdToDelete) {
            _markOutboxError(db, entry.id, newAttempts, 'Payload DELETE invalide : champ sync_id manquant.');
            log.error(`[OutboxService] Payload DELETE invalide pour ${entry.table_name} (id=${entry.id}).`);
            errors++;
            continue;
          }
          const deleteColumn = entry.table_name === 't_user_roles' ? 'user_sync_id' : 'sync_id';
          const { error } = await supabase
            .from(entry.table_name)
            .delete()
            .eq(deleteColumn, syncIdToDelete);
          supabaseError = error;

          if (!supabaseError) {
            // Confirmation de suppression Cloud -> Réaliser la suppression physique réelle SQLite locale
            try {
              if (entry.table_name === 't_users') {
                db.prepare('DELETE FROM t_user_roles WHERE id_user IN (SELECT id_user FROM t_users WHERE sync_id = ?)').run(syncIdToDelete);
                db.prepare('DELETE FROM t_users WHERE sync_id = ?').run(syncIdToDelete);
                log.info(`[OutboxService] Suppression physique locale effectuée pour t_users (sync_id=${syncIdToDelete})`);
              } else if (entry.table_name === 't_cartes') {
                db.prepare('DELETE FROM t_cartes WHERE sync_id = ?').run(syncIdToDelete);
                log.info(`[OutboxService] Suppression physique locale effectuée pour t_cartes (sync_id=${syncIdToDelete})`);
              } else if (entry.table_name === 't_centres') {
                db.prepare('DELETE FROM t_postes WHERE centre_id IN (SELECT id FROM t_centres WHERE sync_id = ?)').run(syncIdToDelete);
                db.prepare('DELETE FROM t_centres WHERE sync_id = ?').run(syncIdToDelete);
                log.info(`[OutboxService] Suppression physique locale effectuée pour t_centres (sync_id=${syncIdToDelete})`);
              } else if (entry.table_name === 't_sites') {
                db.prepare('DELETE FROM t_sites WHERE sync_id = ?').run(syncIdToDelete);
                log.info(`[OutboxService] Suppression physique locale effectuée pour t_sites (sync_id=${syncIdToDelete})`);
              }
            } catch (localDbErr: any) {
              log.error(`[OutboxService] Erreur lors de la suppression physique locale différée :`, localDbErr.message || localDbErr);
            }
          }
        } else {
          let finalPayload;
          try {
            finalPayload = entry.table_name === 't_cartes' ? mapCardPayload(payload) : payload;
          } catch (validationErr: any) {
            _markOutboxError(db, entry.id, newAttempts, validationErr.message);
            log.error(`[OutboxService] Rejet local (validation) pour ${entry.table_name} (id=${entry.id}) : ${validationErr.message}`);
            errors++;
            continue;
          }

          // INSERT ou UPDATE → upsert idempotent sur sync_id (ou user_sync_id,role pour t_user_roles)
          log.info(`[OutboxService][DEBUG] Envoi du payload d'upsert pour ${entry.table_name} :`, JSON.stringify(finalPayload));
          const conflictKey = entry.table_name === 't_user_roles' ? 'user_sync_id,role' : 'sync_id';
          let { error } = await supabase
            .from(entry.table_name)
            .upsert(finalPayload, { onConflict: conflictKey });

          if (error && ['t_sites', 't_centres', 't_postes', 't_users'].includes(entry.table_name) && error.message.includes('duplicate key value violates unique constraint')) {
            const pk = entry.table_name === 't_users' ? 'id_user' : 'id';
            if (payload[pk]) {
              log.warn(`[OutboxService][FALLBACK] Conflit détecté sur ${entry.table_name}. Tentative d'UPDATE via ${pk}...`);
              const { error: updateError } = await supabase
                .from(entry.table_name)
                .update(payload)
                .eq(pk, payload[pk]);
              
              if (!updateError) {
                log.info(`[OutboxService][FALLBACK SUCCESS] Update réussi pour ${entry.table_name}.`);
                error = null; // Clear error to mark as SYNCED
              } else {
                log.error(`[OutboxService][FALLBACK ERROR] Update échoué: ${updateError.message}`);
              }
            }
          }

          supabaseError = error;
        }

        if (supabaseError) {
          const isNetworkError = _isTransientNetworkError(supabaseError.message);

          if (isNetworkError) {
            // Erreur transitoire réseau → conserver PENDING pour nouvelle tentative
            log.warn(
              `[OutboxService] Erreur réseau transitoire pour ${entry.table_name} (id=${entry.id}). ` +
              `Conservé en PENDING. Tentative ${newAttempts}/${MAX_OUTBOX_ATTEMPTS}. Détail : ${supabaseError.message}`
            );
          } else if (newAttempts >= MAX_OUTBOX_ATTEMPTS) {
            // Erreur définitive dépassant le seuil → ERROR
            _markOutboxError(db, entry.id, newAttempts, supabaseError.message);
            log.error(`[OutboxService] Erreur définitive pour ${entry.table_name} (id=${entry.id}) : ${supabaseError.message}`);
            errors++;
          } else {
            log.warn(
              `[OutboxService] Erreur Supabase pour ${entry.table_name} (id=${entry.id}). ` +
              `Tentative ${newAttempts}/${MAX_OUTBOX_ATTEMPTS} : ${supabaseError.message}`
            );
          }
          continue;
        }

        // Succès → marquer SYNCED + remettre à zéro le flag local is_dirty
        // (même connexion/transaction que le reste du traitement outbox —
        // voir _clearLocalDirtyFlag). Sans cela, une entité modifiée localement
        // puis synchronisée avec succès restait signalée "en attente" (is_dirty
        // = 1) indéfiniment, faussant les compteurs UI (ex: bandeau "corrections
        // en attente" du Portail Qualité après une fusion de doublons).
        db.transaction(() => {
          db.prepare(`
            UPDATE t_outbox SET status = 'SYNCED', error_msg = NULL WHERE id = ?
          `).run(entry.id);

          if (entry.operation !== 'DELETE') {
            const syncIdValue = (payload['sync_id'] || payload['user_sync_id']) as string | undefined;
            _clearLocalDirtyFlag(db, entry.table_name, syncIdValue);
          }
        })();

        log.info(`[OutboxService] ✓ ${entry.table_name} [${entry.operation}] synchronisé (id=${entry.id})`);
        processed++;

      } catch (networkErr: any) {
        // Exception réseau (timeout, DNS, etc.) → conserver PENDING
        log.warn(
          `[OutboxService] Exception réseau pour ${entry.table_name} (id=${entry.id}). ` +
          `Conservé en PENDING. Tentative ${newAttempts}/${MAX_OUTBOX_ATTEMPTS}. ` +
          `Détail : ${networkErr.message || networkErr}`
        );
      }
    }

    if (processed > 0 || errors > 0) {
      log.info(`[OutboxService] Traitement terminé : ${processed} synchronisé(s), ${errors} en erreur.`);
    }

    return { processed, errors };

  } finally {
    // Libérer le verrou dans TOUS les cas (succès ou exception)
    _isProcessing = false;
  }
}

/**
 * Planifie l'exécution de processOutboxPending de façon **non-bloquante**.
 *
 * Utilise setImmediate() pour sortir du call-stack courant et exécuter
 * le traitement dans la prochaine itération de la boucle d'événements Node.js,
 * protégeant ainsi le thread UI d'Electron contre tout gel.
 */
export function scheduleOutboxProcessing(): void {
  setImmediate(() => {
    processOutboxPending().catch((err: any) => {
      log.error('[OutboxService] Erreur non capturée dans processOutboxPending :', err);
    });
  });
}

/**
 * Retourne le nombre d'entrées PENDING dans t_outbox.
 * Utile pour les logs de statut du SyncEngine et les badges UI.
 */
export function getOutboxPendingCount(): number {
  try {
    const db = getDatabase();
    if (!db) return 0;
    const row = db.prepare(
      `SELECT COUNT(*) as count FROM t_outbox WHERE status = 'PENDING'`
    ).get() as { count: number } | undefined;
    return row ? row.count : 0;
  } catch {
    return 0;
  }
}

// ─── Helpers privés ──────────────────────────────────────────────────────────

/** Verrou interne anti-concurrence du worker outbox. */
let _isProcessing = false;

/**
 * Marque une entrée outbox en statut ERROR avec le message d'erreur fourni.
 * Opération synchrone SQLite (très rapide, non bloquante pour l'UI).
 */
function _markOutboxError(
  db: NonNullable<ReturnType<typeof getDatabase>>,
  id: string,
  attempts: number,
  errorMsg: string
): void {
  try {
    db.prepare(`
      UPDATE t_outbox SET status = 'ERROR', error_msg = ?, attempts = ? WHERE id = ?
    `).run(errorMsg, attempts, id);
  } catch (err: any) {
    log.error(`[OutboxService] Impossible de marquer l'entrée ${id} en ERROR :`, err.message);
  }
}

/**
 * Remet à zéro le flag local `is_dirty` (et `synced_at` quand la colonne
 * existe) de l'entité correspondant à une entrée outbox INSERT/UPDATE dont
 * l'upsert Supabase vient d'être confirmé en succès.
 *
 * Corrige un défaut où une carte (ou autre entité) modifiée localement puis
 * synchronisée avec succès restait signalée "en attente" (is_dirty = 1) de
 * façon permanente — outbox.service.ts ne touchait jamais aux tables
 * métier après un upsert réussi, contrairement à upload-worker.js:272 qui le
 * fait pour son propre chemin (bulk upload manuel "Envoyer les corrections").
 *
 * Portée volontairement limitée aux tables qui possèdent réellement is_dirty
 * ET transitent par enqueueOutbox() : t_cartes, t_users et t_logs (is_dirty +
 * synced_at, voir schema.ts), t_sites et t_centres (is_dirty seul, pas de
 * colonne synced_at sur ces deux tables). t_user_roles/t_postes n'ont pas de
 * notion is_dirty équivalente sur ce chemin → ignorés (défaut absent).
 * Ne s'applique jamais à un DELETE : la ligne locale est déjà supprimée
 * physiquement par l'appelant dans ce cas (voir plus haut dans la boucle).
 */
function _clearLocalDirtyFlag(
  db: NonNullable<ReturnType<typeof getDatabase>>,
  tableName: string,
  syncIdValue: string | undefined
): void {
  if (!syncIdValue) return;
  try {
    switch (tableName) {
      case 't_cartes':
      case 't_users':
        db.prepare(`UPDATE ${tableName} SET is_dirty = 0, synced_at = datetime('now') WHERE sync_id = ?`).run(syncIdValue);
        break;
      case 't_sites':
      case 't_centres':
        db.prepare(`UPDATE ${tableName} SET is_dirty = 0 WHERE sync_id = ?`).run(syncIdValue);
        break;
      case 't_logs':
        // Journal d'audit CRUD synchronisable (voir src/main/utils/audit.ts, aiguillage
        // CRUD_SYNC_WHITELIST). t_logs possède is_dirty + synced_at (mêmes colonnes que
        // t_cartes/t_users) — même traitement de remise à zéro après upsert Supabase confirmé.
        db.prepare(`UPDATE t_logs SET is_dirty = 0, synced_at = datetime('now') WHERE sync_id = ?`).run(syncIdValue);
        break;
      default:
        // Table sans notion is_dirty équivalente sur ce chemin (t_postes,
        // t_user_roles) — rien à faire.
        break;
    }
  } catch (err: any) {
    log.error(`[OutboxService] Erreur lors de la remise à zéro locale de is_dirty pour ${tableName} (sync_id=${syncIdValue}) :`, err.message || err);
  }
}

/**
 * Détecte si un message d'erreur Supabase correspond à une erreur réseau transitoire.
 * Les erreurs transitoires conservent le statut PENDING pour nouvelle tentative.
 * Les erreurs applicatives (contrainte, droits) peuvent déclencher le basculement en ERROR.
 */
function _isTransientNetworkError(errorMessage: string): boolean {
  const transientPatterns = [
    'network', 'timeout', 'ECONNREFUSED', 'ENOTFOUND',
    'ETIMEDOUT', 'fetch failed', 'Failed to fetch',
    'socket hang up', 'NetworkError', 'ERR_NETWORK'
  ];
  const lower = errorMessage.toLowerCase();
  return transientPatterns.some(p => lower.includes(p.toLowerCase()));
}

// ─── Ré-exports publics ──────────────────────────────────────────────────────
/**
 * Génère un UUID v4 pour les appelants (alias de uuidv4).
 * Chaque identifiant doit être généré UNE SEULE FOIS par opération de création.
 */
export { uuidv4 as generateOutboxId };

/**
 * Type union public décrivant toutes les opérations supportées par l'outbox.
 * Utilisable par les appelants externes (queries) pour le typage strict.
 */
export type OutboxOperation = 'INSERT' | 'UPDATE' | 'DELETE';

/**
 * Réinitialise les entrées en ERROR à PENDING au démarrage de l'application
 * pour garantir que les erreurs persistantes ne soient pas oubliées.
 */
export function resetOutboxErrors(): void {
  try {
    const db = getDatabase();
    if (!db) return;
    const result = db.prepare("UPDATE t_outbox SET status = 'PENDING', attempts = 0 WHERE status = 'ERROR'").run();
    if (result.changes > 0) {
      log.info(`[OutboxService] ${result.changes} entrée(s) en ERROR réinitialisée(s) en PENDING.`);
    }
  } catch (err: any) {
    log.error(`[OutboxService] Erreur lors de la réinitialisation des erreurs outbox :`, err.message || err);
  }
}
