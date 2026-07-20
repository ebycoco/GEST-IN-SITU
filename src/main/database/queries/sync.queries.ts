import { getDatabase } from '../connection';
import { networkMonitor } from '../../sync/network-monitor';
import { getSupabaseClient } from '../../sync/supabase-client';
import { enqueueOutbox, scheduleOutboxProcessing } from '../../sync/outbox.service';
import log from 'electron-log';

export function enqueueSyncOp(tableName: string, recordId: number, operation: string, syncId: string, siteId: number, lastUpdatedAtLocal?: string) {
  const db = getDatabase()!;
  db.prepare(`
    INSERT INTO t_sync_queue (table_name, record_id, operation, sync_id, site_id, last_updated_at_local)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(tableName, recordId, operation, syncId, siteId, lastUpdatedAtLocal || null);
}

export function getNextSyncBatches(limit: number = 50): any[] {
  const db = getDatabase()!;
  return db.prepare(`
    SELECT id, table_name, record_id, operation, payload, retries
    FROM t_sync_queue 
    WHERE synced = 0
    ORDER BY id ASC
    LIMIT ?
  `).all(limit);
}

export function markRecordsAsSynced(queueIds: number[]): void {
  const db = getDatabase()!;
  const stmt = db.prepare('UPDATE t_sync_queue SET synced = 1 WHERE id = ?');
  const runTx = db.transaction((ids: number[]) => {
    for (const id of ids) {
      stmt.run(id);
    }
  });
  runTx(queueIds);
}

export function updateSyncQueueRetries(queueId: number, newRetries: number): void {
  const db = getDatabase()!;
  const status = newRetries >= 5 ? -1 : 0; 
  db.prepare('UPDATE t_sync_queue SET retries = ?, synced = ? WHERE id = ?')
    .run(newRetries, status, queueId);
}

export function clearSyncQueue(siteId?: number): void {
  const db = getDatabase()!;
  if (siteId) {
    db.prepare('DELETE FROM t_sync_queue WHERE site_id = ?').run(siteId);
  } else {
    db.prepare('DELETE FROM t_sync_queue').run();
  }
}

export function updateRecordIsDirtyStatus(tableName: string, recordId: number, lastUpdatedAtLocal?: string): void {
  const db = getDatabase()!;
  db.transaction(() => {
    const pkName = tableName === 't_users' ? 'id_user' : 'id_carte';

    const currentRecord = db.prepare(`
      SELECT updated_at, is_dirty FROM ${tableName} WHERE ${pkName} = ?
    `).get(recordId) as { updated_at?: string; is_dirty?: number } | undefined;

    if (currentRecord) {
      if (currentRecord.updated_at === lastUpdatedAtLocal) {
        db.prepare(`
          UPDATE ${tableName} 
          SET is_dirty = 0, synced_at = datetime('now')
          WHERE ${pkName} = ?
        `).run(recordId);
      }
    }
  })();
}

export function forceGlobalSuperAdminSync() {
  const db = getDatabase()!;
  db.prepare("UPDATE t_sites SET is_dirty = 1").run();
  db.prepare("UPDATE t_centres SET is_dirty = 1").run();
  db.prepare("UPDATE t_users SET is_dirty = 1 WHERE role != 'SUPER ADMIN'").run();
}

export async function forceSiteAdminSync(siteId: number) {
  const db = getDatabase()!;
  
  // Mise à jour asynchrone par paquets de 1000 cartes pour éviter de bloquer la boucle d'événements
  let updated = true;
  while (updated) {
    const result = db.prepare(`
      UPDATE t_cartes 
      SET is_dirty = 1 
      WHERE id_carte IN (
        SELECT id_carte FROM t_cartes 
        WHERE id_site = ? AND is_dirty = 0 
        LIMIT 1000
      )
    `).run(siteId);

    if (result.changes === 0) {
      updated = false;
    } else {
      // Pause de 10ms pour libérer périodiquement le Main Thread d'Electron
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
}

export async function forceAgentsSync(siteId: number): Promise<{ success: boolean; count: number; message?: string }> {
  const db = getDatabase()!;
  
  // 1. Récupérer les agents non encore synchronisés (ou modifiés) du site
  const dirtyUsers = db.prepare(`
    SELECT id_user, login, password_hash, role, nom_user, prenom_user, email, telephone, site_id, centre_id, sync_id, statut_actif
    FROM t_users
    WHERE site_id = ? AND (is_dirty = 1 OR synced_at IS NULL) AND role != 'SUPER ADMIN' AND statut_actif != -1
  `).all(siteId) as any[];

  if (dirtyUsers.length === 0) {
    return { success: true, count: 0 };
  }

  // 2. Enfilage outbox pour chaque agent et leurs rôles (idempotent, géré par le moteur de synchro)
  let count = 0;
  for (const u of dirtyUsers) {
    if (!u.sync_id) continue;
    enqueueOutbox(u.sync_id, 't_users', 'UPDATE', {
      sync_id: u.sync_id,
      login: u.login,
      password_hash: u.password_hash,
      role: u.role,
      nom_user: u.nom_user || '',
      prenom_user: u.prenom_user || '',
      email: u.email || null,
      telephone: u.telephone || null,
      site_id: u.site_id,
      centre_id: u.centre_id || null,
      statut_actif: u.statut_actif ?? 1,
      updated_at: new Date().toISOString()
    });

    // Enfiler également les rôles multiples si présents
    const roles = db.prepare('SELECT role FROM t_user_roles WHERE id_user = ?').all(u.id_user) as { role: string }[];
    for (const r of roles) {
      const roleOutboxId = `${u.sync_id}_${r.role}`;
      enqueueOutbox(roleOutboxId, 't_user_roles', 'UPDATE', {
        user_sync_id: u.sync_id,
        role: r.role
      });
    }

    count++;
  }

  // 3. Déclencher le traitement si en ligne
  if (networkMonitor.getState() === 'ONLINE') {
    scheduleOutboxProcessing();
  }

  log.info(`[forceAgentsSync] ${count} agents enfilés dans l'outbox pour synchronisation.`);
  return { success: true, count };
}

export async function pullCentresFromCloud(siteId: number): Promise<{ success: boolean; count: number; message?: string }> {
  const db = getDatabase()!;
  const supabase = getSupabaseClient();
  if (!supabase) {
    log.warn('[pullCentresFromCloud] Client Supabase non disponible.');
    return { success: false, count: 0, message: 'Client Supabase non disponible.' };
  }
  log.info(`[pullCentresFromCloud] Récupération manuelle des centres pour le site ${siteId} depuis Supabase...`);

  try {
    const { data: cloudCentres, error } = await supabase
      .from('t_centres')
      .select('*')
      .eq('site_id', siteId);

    if (error) {
      log.error(`[pullCentresFromCloud] Erreur Supabase : ${error.message}`);
      return { success: false, count: 0, message: error.message };
    }

    if (!cloudCentres || cloudCentres.length === 0) {
      return { success: true, count: 0, message: 'Aucun centre trouvé sur Supabase pour ce site.' };
    }

    let count = 0;
    db.transaction(() => {
      const insertStmt = db.prepare(`
        INSERT OR REPLACE INTO t_centres (id, site_id, nom, code, lieu, prefixe_rangement, numero, created_at, sync_id)
        VALUES (@id, @site_id, @nom, @code, @lieu, @prefixe_rangement, @numero, @created_at, @sync_id)
      `);

      for (const c of cloudCentres) {
        insertStmt.run({
          id: c.id,
          site_id: c.site_id,
          nom: c.nom || '',
          code: c.code || null,
          lieu: c.lieu || null,
          prefixe_rangement: c.prefixe_rangement || null,
          numero: c.numero || 1,
          created_at: c.created_at || new Date().toISOString(),
          sync_id: c.sync_id
        });
        count++;
      }
    })();

    log.info(`[pullCentresFromCloud] ${count} centres synchronisés localement.`);
    return { success: true, count };
  } catch (err: any) {
    log.error(`[pullCentresFromCloud] Exception : ${err.message}`);
    return { success: false, count: 0, message: err.message };
  }
}

export async function forceCentresSync(siteId: number): Promise<{ success: boolean; count: number; message?: string }> {
  const db = getDatabase()!;
  
  // 1. Marquer les centres du site comme dirty (si is_dirty existe, sinon on prend tout)
  try {
    db.prepare('UPDATE t_centres SET is_dirty = 1 WHERE site_id = ?').run(siteId);
  } catch (e) {
    log.warn('[forceCentresSync] is_dirty missing in t_centres, proceeding with all centres');
  }

  const dirtyCentres = db.prepare(`
    SELECT id, site_id, nom, code, lieu, prefixe_rangement, numero, created_at, sync_id
    FROM t_centres
    WHERE site_id = ?
  `).all(siteId) as any[];

  if (dirtyCentres.length === 0) {
    return { success: true, count: 0 };
  }

  const supabase = getSupabaseClient();
  if (!supabase) {
    log.warn('[forceCentresSync] Client Supabase non disponible.');
    return { success: false, count: 0, message: 'Client Supabase non disponible.' };
  }
  const mappedCentres = dirtyCentres.map(c => ({
    id: c.id,
    site_id: c.site_id,
    nom: c.nom,
    lieu: c.lieu,
    prefixe_rangement: c.prefixe_rangement,
    numero: c.numero,
    created_at: c.created_at,
    sync_id: c.sync_id
  }));

  const { error } = await supabase
    .from('t_centres')
    .upsert(mappedCentres, { onConflict: 'sync_id' });

  if (error) {
    log.error(`[forceCentresSync] Échec du push vers Supabase : ${error.message}`);
    throw new Error(`Erreur lors du push Supabase : ${error.message}`);
  }

  try {
    db.prepare('UPDATE t_centres SET is_dirty = 0 WHERE site_id = ?').run(siteId);
  } catch (e) {}

  log.info(`[forceCentresSync] ${dirtyCentres.length} centres synchronisés avec succès.`);
  return { success: true, count: dirtyCentres.length };
}
