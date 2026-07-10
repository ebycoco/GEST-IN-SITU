import { getDatabase } from '../connection';
import { networkMonitor } from '../../sync/network-monitor';
import { getSupabaseClient } from '../../sync/supabase-client';
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
  
  // 1. Marquer d'abord tous les agents du site comme dirty
  db.prepare("UPDATE t_users SET is_dirty = 1 WHERE site_id = ? AND role != 'SUPER ADMIN'").run(siteId);
  
  // 2. Récupérer la liste des utilisateurs dirty du site
  const dirtyUsers = db.prepare(`
    SELECT id_user, login, password_hash, role, nom_user, prenom_user, email, telephone, site_id, centre_id, sync_id, statut_actif
    FROM t_users
    WHERE site_id = ? AND is_dirty = 1 AND role != 'SUPER ADMIN'
  `).all(siteId) as any[];

  if (dirtyUsers.length === 0) {
    return { success: true, count: 0 };
  }

  // 3. On pousse les utilisateurs vers Supabase (la gestion réseau et les timeouts sont gérés par le client)
  const supabase = getSupabaseClient();
  const mappedUsers = dirtyUsers.map(u => ({
    login: u.login,
    password_hash: u.password_hash,
    role: u.role,
    nom_user: u.nom_user || '',
    prenom_user: u.prenom_user || '',
    email: u.email || null,
    telephone: u.telephone || null,
    site_id: u.site_id,
    centre_id: u.centre_id || null,
    sync_id: u.sync_id,
    statut_actif: u.statut_actif ?? 1,
    updated_at: new Date().toISOString()
  }));

  const { error } = await supabase
    .from('t_users')
    .upsert(mappedUsers, { onConflict: 'sync_id' });

  if (error) {
    log.error(`[forceAgentsSync] Échec du push vers Supabase : ${error.message}`);
    throw new Error(`Erreur lors du push Supabase : ${error.message}`);
  }

  // 4. On extrait et on pousse les rôles multiples vers Supabase
  const userIds = dirtyUsers.map(u => u.id_user);
  const placeholders = userIds.map(() => '?').join(',');
  const localRoles = db.prepare(`
    SELECT u.sync_id AS user_sync_id, r.role
    FROM t_user_roles r
    JOIN t_users u ON r.id_user = u.id_user
    WHERE r.id_user IN (${placeholders})
  `).all(userIds) as { user_sync_id: string; role: string }[];

  if (localRoles.length > 0) {
    try {
      const { error: rolesError } = await supabase
        .from('t_user_roles')
        .upsert(localRoles, { onConflict: 'user_sync_id,role' });

      if (rolesError) {
        log.warn(`[forceAgentsSync] Avertissement du push des rôles vers Supabase : ${rolesError.message} (la table t_user_roles n'existe peut-être pas encore sur ce backend)`);
      }
    } catch (e: any) {
      log.warn(`[forceAgentsSync] Exception lors du push des rôles vers Supabase : ${e.message || e}`);
    }
  }

  // 5. Mettre à jour localement is_dirty = 0
  db.transaction(() => {
    const updateStmt = db.prepare(`
      UPDATE t_users
      SET is_dirty = 0, synced_at = datetime('now')
      WHERE id_user = ?
    `);
    for (const u of dirtyUsers) {
      updateStmt.run(u.id_user);
    }
  })();

  log.info(`[forceAgentsSync] ${dirtyUsers.length} agents synchronisés avec succès.`);
  return { success: true, count: dirtyUsers.length };
}


