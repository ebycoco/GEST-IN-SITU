import log from 'electron-log';
import { getSupabaseClient } from './supabase-client';
import * as queries from '../database/queries';
import { getDatabase } from '../database/connection';

/**
 * Pousse les modifications locales en attente vers Supabase.
 * Retourne le nombre d'opérations synchronisées avec succès.
 */
export async function runUpstream(): Promise<number> {
  const batchSize = 50;
  const pendingOps = queries.getNextSyncBatches(batchSize);

  if (pendingOps.length === 0) {
    return 0;
  }

  log.info(`Upstream: Found ${pendingOps.length} pending operations to push.`);
  const supabase = getSupabaseClient();
  let successCount = 0;

  for (const op of pendingOps) {
    const { id: queueId, table_name: tableName, record_id: recordId, operation, payload: payloadStr } = op;
    let payload = JSON.parse(payloadStr);

    try {
      // Exclure password_hash pour des raisons de sécurité évidentes si la table est t_users
      if (tableName === 't_users' && payload.password_hash) {
        delete payload.password_hash;
      }

      // Supabase attend des noms de tables sans préfixe t_ ou alignés
      // Dans le cadre du schéma, on utilise le nom de table standardisé
      const targetTable = tableName;

      let error = null;

      if (operation === 'INSERT' || operation === 'UPDATE') {
        // Résolution de conflit native via upsert basé sur sync_id
        const { error: upsertError } = await supabase
          .from(targetTable)
          .upsert(payload, { onConflict: 'sync_id' });
        error = upsertError;
      } else if (operation === 'DELETE') {
        const { error: deleteError } = await supabase
          .from(targetTable)
          .delete()
          .eq('sync_id', payload.sync_id || recordId);
        error = deleteError;
      }

      if (error) {
        throw new Error(error.message);
      }

      // Succès : marquer localement comme synchronisé
      // On a besoin du updated_at local issu du payload initial pour la vérification de sécurité
      const lastUpdatedAtLocal = payload.updated_at || new Date().toISOString();
      queries.markRecordsAsSynced(queueId, tableName, recordId, lastUpdatedAtLocal);
      successCount++;
    } catch (err: any) {
      log.error(`Upstream error on operation ${operation} for ${tableName} (ID: ${recordId}):`, err.message || err);
      handleSyncFailure(queueId, op.retries || 0, err.message || String(err));
    }
  }

  return successCount;
}

/**
 * Gère l'échec de la synchronisation d'une entrée de la queue.
 * Incrémente le compteur de retours ou bascule en Dead Letter Office (synced = -1).
 */
function handleSyncFailure(queueId: number, currentRetries: number, errorMessage: string): void {
  const db = getDatabase()!;
  const newRetries = currentRetries + 1;
  const status = newRetries >= 5 ? -1 : 0; // -1 = Dead Letter, abandonné pour ne pas bloquer la file

  try {
    db.prepare(`
      UPDATE t_sync_queue
      SET retries = ?, last_error = ?, synced = ?
      WHERE id = ?
    `).run(newRetries, errorMessage, status, queueId);
    
    if (status === -1) {
      log.error(`Sync queue entry ${queueId} marked as DEAD LETTER (failed 5 times).`);
    }
  } catch (e) {
    log.error(`Failed to update sync failure status for entry ${queueId}:`, e);
  }
}
