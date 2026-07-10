import log from 'electron-log';
import { getSupabaseClient } from './supabase-client';
import * as queries from '../database/queries';
import { getDatabase } from '../database/connection';

interface PendingOp {
  id: number;
  table_name: string;
  record_id: number;
  operation: 'INSERT' | 'UPDATE' | 'DELETE';
  payload: string;
  retries: number;
}

interface GroupedOps {
  upserts: PendingOp[];
  deletes: PendingOp[];
}

/**
 * Maps SQLite card schema to PostgreSQL Supabase schema.
 */
function mapCardPayload(c: any): any {
  return {
    sync_id: c.sync_id,
    noms: c.noms,
    prenoms: c.prenoms || '',
    date_naissance: c.date_de_naissance || null,
    lieu_naissance: c.lieu_de_naissance || null,
    num_secu: c.num_secu || null,
    lieu_enrolement: c.lieu_enrolement || null,
    contact: c.contact || null,
    rangement: c.rangement || null,
    statut: c.statut || 'EN STOCK',
    statut_physique: c.statut_physique || 'OK',
    date_delivrance: c.date_delivrance || null,
    agent_saisie: c.agent_saisie || null,
    agent_distributeur: c.agent_distributeur || null,
    centre_retrait: c.centre_retrait || null,
    nom_retirant: c.nom_retirant || null,
    num_retirant: c.num_retirant || null,
    cle_doublon: c.cle_doublon || null,
    cle_doublon_flex: c.cle_doublon_flex || null,
    agent_signalement_absence: c.agent_signalement_absence || null,
    date_signalement_absence: c.date_signalement_absence || null,
    date_resolution_absence: c.date_resolution_absence || null,
    agent_resolution_absence: c.agent_resolution_absence || null,
    note_resolution: c.note_resolution || null,
    notif_lue: c.notif_lue ?? 1,
    id_site: c.site_id || 1,
    id_centre: c.centre_id || null,
    id_poste: c.poste_id || null,
    qr_code_data: c.qr_code_data || null,
    is_exported: c.is_exported || 0,
    created_by: c.created_by || null,
    updated_at: c.updated_at || new Date().toISOString()
  };
}

/**
 * Pousse les modifications locales en attente vers Supabase par lots.
 * Retourne le nombre d'opérations synchronisées avec succès.
 */
export async function runUpstream(): Promise<number> {
  const batchSize = 200;
  const pendingOps = queries.getNextSyncBatches(batchSize) as PendingOp[];

  if (pendingOps.length === 0) {
    return 0;
  }

  log.info(`Upstream: Found ${pendingOps.length} pending operations to push in bulk.`);
  const supabase = getSupabaseClient();
  let successCount = 0;

  // 1. Regrouper les opérations par table
  const tableGroups: Record<string, GroupedOps> = {};

  for (const op of pendingOps) {
    if (!tableGroups[op.table_name]) {
      tableGroups[op.table_name] = { upserts: [], deletes: [] };
    }
    if (op.operation === 'DELETE') {
      tableGroups[op.table_name].deletes.push(op);
    } else {
      tableGroups[op.table_name].upserts.push(op);
    }
  }

  // 2. Traiter chaque table
  for (const [tableName, groups] of Object.entries(tableGroups)) {
    // A. Traiter les Upserts (INSERT / UPDATE)
    if (groups.upserts.length > 0) {
      const CHUNK_SIZE = 50;
      for (let i = 0; i < groups.upserts.length; i += CHUNK_SIZE) {
        const chunk = groups.upserts.slice(i, i + CHUNK_SIZE);
        const success = await processUpsertChunk(supabase, tableName, chunk);
        if (success) {
          successCount += chunk.length;
        } else {
          // Fallback unitaire pour isoler le coupable
          log.warn(`Upstream: Bulk upsert failed for chunk on ${tableName}. Falling back to row-by-row processing.`);
          for (const op of chunk) {
            const singleSuccess = await processUpsertChunk(supabase, tableName, [op]);
            if (singleSuccess) successCount++;
          }
        }
      }
    }

    // B. Traiter les Deletes
    if (groups.deletes.length > 0) {
      const CHUNK_SIZE = 50;
      for (let i = 0; i < groups.deletes.length; i += CHUNK_SIZE) {
        const chunk = groups.deletes.slice(i, i + CHUNK_SIZE);
        const success = await processDeleteChunk(supabase, tableName, chunk);
        if (success) {
          successCount += chunk.length;
        } else {
          // Fallback unitaire
          log.warn(`Upstream: Bulk delete failed for chunk on ${tableName}. Falling back to row-by-row processing.`);
          for (const op of chunk) {
            const singleSuccess = await processDeleteChunk(supabase, tableName, [op]);
            if (singleSuccess) successCount++;
          }
        }
      }
    }
  }

  return successCount;
}

/**
 * Pousse un lot d'upserts vers Supabase et valide la transaction locale SQLite.
 */
async function processUpsertChunk(supabase: any, tableName: string, chunk: PendingOp[]): Promise<boolean> {
  const payloadsToUpsert: any[] = [];
  const validOps: PendingOp[] = [];

  for (const op of chunk) {
    try {
      let rawPayload = JSON.parse(op.payload);
      const mappedPayload = tableName === 't_cartes' ? mapCardPayload(rawPayload) : rawPayload;
      payloadsToUpsert.push(mappedPayload);
      validOps.push(op);
    } catch (err: any) {
      log.error(`Upstream payload parsing error for ${tableName} (Queue ID: ${op.id}):`, err.message || err);
      handleSyncFailure(op.id, op.retries || 0, `Payload parse error: ${err.message}`);
    }
  }

  if (payloadsToUpsert.length === 0) {
    return true;
  }

  try {
    console.log(`🌐 [SUPABASE UPLOAD] Envoi de ${payloadsToUpsert.length} lignes vers la table ${tableName} sur Supabase...`);
    const { error } = await supabase
      .from(tableName)
      .upsert(payloadsToUpsert, { onConflict: 'sync_id' });

    if (error) {
      console.error(`❌ [SUPABASE UPLOAD ERROR] Échec de l'upload pour la table ${tableName} : ${error.message}`);
      throw new Error(error.message);
    }

    console.log(`🌐 [SUPABASE UPLOAD SUCCESS] Upload réussi de ${payloadsToUpsert.length} lignes pour la table ${tableName}.`);

    // Validation locale dans un bloc de transaction unique asynchrone (non bloquant pour l'IHM)
    await new Promise<void>((resolve) => {
      setImmediate(() => {
        const db = getDatabase()!;
        db.transaction(() => {
          // 1. Marquer les entrées de file d'attente comme synchronisées
          const syncStmt = db.prepare('UPDATE t_sync_queue SET synced = 1 WHERE id = ?');
          for (const op of validOps) {
            syncStmt.run(op.id);
          }

          // 2. Mettre à jour le statut is_dirty des enregistrements sources
          const pkName = tableName === 't_users' ? 'id_user' : 'id_carte';
          for (const op of validOps) {
            try {
              const payloadObj = JSON.parse(op.payload);
              const lastUpdatedAtLocal = payloadObj.updated_at || new Date().toISOString();

              const currentRecord = db.prepare(`
                SELECT updated_at, is_dirty FROM ${tableName} WHERE ${pkName} = ?
              `).get(op.record_id) as { updated_at?: string; is_dirty?: number } | undefined;

              if (currentRecord && currentRecord.updated_at === lastUpdatedAtLocal) {
                db.prepare(`
                  UPDATE ${tableName} 
                  SET is_dirty = 0, synced_at = datetime('now')
                  WHERE ${pkName} = ?
                `).run(op.record_id);
              }
            } catch (e) {
              log.error(`Upstream local status update error for ${tableName} (Record ID: ${op.record_id}):`, e);
            }
          }
        })();
        resolve();
      });
    });

    return true;
  } catch (err: any) {
    log.error(`Upstream chunk upsert error for ${tableName}:`, err.message || err);
    if (chunk.length === 1) {
      handleSyncFailure(chunk[0].id, chunk[0].retries || 0, err.message || String(err));
    }
    return false;
  }
}

/**
 * Traite un lot de suppressions vers Supabase.
 */
async function processDeleteChunk(supabase: any, tableName: string, chunk: PendingOp[]): Promise<boolean> {
  const syncIds: string[] = [];
  const recordIds: number[] = [];

  for (const op of chunk) {
    try {
      const payload = JSON.parse(op.payload);
      if (payload && payload.sync_id) {
        syncIds.push(payload.sync_id);
      } else {
        recordIds.push(op.record_id);
      }
    } catch {
      recordIds.push(op.record_id);
    }
  }

  try {
    let error = null;

    if (syncIds.length > 0) {
      const { error: err } = await supabase
        .from(tableName)
        .delete()
        .in('sync_id', syncIds);
      error = err;
    }

    // Supprimer les enregistrements restants sans sync_id
    for (const recordId of recordIds) {
      const { error: err } = await supabase
        .from(tableName)
        .delete()
        .eq('sync_id', recordId);
      if (err) error = err;
    }

    if (error) {
      // Ignorer l'erreur 404/not found sur DELETE (idempotence)
      if (error.code === 'PGRST116' || error.message?.includes('404') || error.message?.includes('not found') || error.code === '23503') {
        log.warn(`Upstream bulk DELETE received resource not found or constraint error. Marking as idempotent success.`);
      } else {
        throw new Error(error.message);
      }
    }

    // Valider localement SQLite dans une transaction asynchrone
    await new Promise<void>((resolve) => {
      setImmediate(() => {
        const db = getDatabase()!;
        db.transaction(() => {
          const syncStmt = db.prepare('UPDATE t_sync_queue SET synced = 1 WHERE id = ?');
          for (const op of chunk) {
            syncStmt.run(op.id);
          }
        })();
        resolve();
      });
    });

    return true;
  } catch (err: any) {
    log.error(`Upstream chunk delete error for ${tableName}:`, err.message || err);
    if (chunk.length === 1) {
      handleSyncFailure(chunk[0].id, chunk[0].retries || 0, err.message || String(err));
    }
    return false;
  }
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
