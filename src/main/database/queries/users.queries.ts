import { getDatabase } from '../connection';
import { hashPassword, verifyPassword } from '../../auth/local-auth';
import { getSupabaseClient } from '../../sync/supabase-client';
import { networkMonitor } from '../../sync/network-monitor';
import { logAction } from './logs.queries';
import { v4 as uuidv4 } from 'uuid';
import log from 'electron-log';
import { enqueueOutbox, scheduleOutboxProcessing, cancelPendingInsert } from '../../sync/outbox.service';
import { insertAuditLog } from './audit.queries';

export function seedUserFromCloud(userData: {
  login: string;
  password_hash: string;
  role: string;
  nom_user?: string;
  prenom_user?: string;
  site_id: number;
  centre_id?: number;
  sync_id: string;
}) {
  const db = getDatabase()!;
  db.prepare(`
    INSERT OR IGNORE INTO t_users 
      (login, password_hash, role, nom_user, prenom_user, statut_actif, site_id, centre_id, sync_id, is_dirty)
    VALUES 
      (@login, @password_hash, @role, @nom_user, @prenom_user, 1, @site_id, @centre_id, @sync_id, 0)
  `).run({
    login: userData.login,
    password_hash: userData.password_hash,
    role: userData.role,
    nom_user: userData.nom_user || '',
    prenom_user: userData.prenom_user || '',
    site_id: userData.site_id,
    centre_id: userData.centre_id || null,
    sync_id: userData.sync_id,
  });
}

export async function authenticateUser(login: string, password: string): Promise<any> {
  const db = getDatabase()!;
  
  const user = db.prepare(`
    SELECT u.id_user, u.login, u.password_hash, u.role, u.nom_user, u.prenom_user, u.site_id, u.centre_id, u.sync_id, u.statut_actif,
           s.is_active AS site_is_active, s.expiry_date AS site_expiry_date, s.is_permanent AS site_is_permanent
    FROM t_users u
    LEFT JOIN t_sites s ON u.site_id = s.id
    WHERE u.login = ? AND u.statut_actif = 1
  `).get(login) as any;

  if (!user) return null;

  const valid = verifyPassword(password, user.password_hash);
  if (!valid) return null;

  // VERIFICATION SITE ACTIF ET LICENCE
  let warningMessage: string | undefined = undefined;
  if (user.role !== 'SUPER ADMIN' && user.site_id) {
    if (user.site_is_active === 0) {
      throw new Error('SITE_SUSPENDU');
    }

    if (user.site_is_permanent !== 1 && user.site_expiry_date) {
      const now = new Date();
      const expiry = new Date(user.site_expiry_date);
      if (now > expiry) {
        throw new Error('LICENCE_EXPIREE');
      }

      // Calcul des jours restants
      const timeDiff = expiry.getTime() - now.getTime();
      const daysDiff = Math.ceil(timeDiff / (1000 * 3600 * 24));
      if (daysDiff <= 30) {
        warningMessage = `Votre licence expire dans ${daysDiff} jour(s) (${expiry.toLocaleDateString('fr-FR')}). Veuillez contacter le Super Administrateur.`;
      }
    }
  }

  const rolesRows = db.prepare('SELECT role FROM t_user_roles WHERE id_user = ?').all(user.id_user) as { role: string }[];
  let roles = rolesRows.map(r => r.role);
  if (roles.length === 0 && user.role) {
    roles = [user.role];
  }

  const token = uuidv4();
  db.prepare("UPDATE t_users SET last_login = datetime('now') WHERE id_user = ?").run(user.id_user);

  try {
    logAction(user.id_user, user.role, 'LOGIN', `Connexion locale de l'utilisateur ${user.login}`);
  } catch (err) {
    log.error('Failed to log authenticateUser action:', err);
  }

  return {
    id_user: user.id_user,
    login: user.login,
    role: user.role,
    roles: roles,
    nom_user: user.nom_user,
    prenom_user: user.prenom_user,
    site_id: user.site_id,
    centre_id: user.centre_id,
    sessionToken: token,
    warning: warningMessage
  };
}

export function getUserRoles(userId: number): string[] {
  const db = getDatabase()!;
  const rows = db.prepare('SELECT role FROM t_user_roles WHERE id_user = ?').all(userId) as { role: string }[];
  return rows.map(r => r.role);
}

export function getUsers(siteId?: number, centreId?: number) {
  const db = getDatabase()!;
  let query = `
    SELECT u.*, c.nom AS centre_nom, s.nom AS site_nom 
    FROM t_users u
    LEFT JOIN t_centres c ON u.centre_id = c.id
    LEFT JOIN t_sites s ON u.site_id = s.id
    WHERE u.role != 'SUPER ADMIN' AND u.statut_actif != -1
  `;
  
  const params: any[] = [];
  if (siteId) {
    query += ' AND u.site_id = ?';
    params.push(siteId);
  }
  if (centreId) {
    query += ' AND u.centre_id = ?';
    params.push(centreId);
  }
  
  query += ' ORDER BY u.login';
  
  const users = db.prepare(query).all(...params) as any[];
  
  for (const user of users) {
    const roles = db.prepare('SELECT role FROM t_user_roles WHERE id_user = ?').all(user.id_user) as { role: string }[];
    user.roles = roles.map(r => r.role);
    if (user.roles.length === 0 && user.role) {
      user.roles = [user.role];
    }
  }
  return users;
}

export function createUser(data: Record<string, unknown>, callerUserId: number) {
  const db = getDatabase()!;
  
  const creator = db.prepare('SELECT role, site_id, centre_id FROM t_users WHERE id_user = ?').get(callerUserId) as { role: string; site_id?: number; centre_id?: number } | undefined;
  if (!creator || !['SUPER ADMIN', 'ADMINISTRATEUR_SITE', 'ADMIN_CENTRE'].includes(creator.role)) {
    throw new Error("Accès non autorisé : Rôle insuffisant pour créer un utilisateur.");
  }

  // Si c'est un ADMIN_CENTRE, on utilise son site et son centre. Si c'est un ADMINISTRATEUR_SITE, on utilise son site. Sinon (SUPER ADMIN), on prend data.site_id.
  const targetSiteId = (creator.role === 'ADMINISTRATEUR_SITE' || creator.role === 'ADMIN_CENTRE') ? creator.site_id : (Number(data.site_id) || 1);
  const targetCentreId = creator.role === 'ADMIN_CENTRE' ? creator.centre_id : (data.centre_id ? Number(data.centre_id) : null);

  if (creator.role === 'ADMINISTRATEUR_SITE' && targetCentreId) {
    const centre = db.prepare('SELECT site_id FROM t_centres WHERE id = ?').get(targetCentreId) as { site_id?: number } | undefined;
    if (!centre || centre.site_id !== creator.site_id) {
      throw new Error("Accès non autorisé : Ce centre n'appartient pas à votre site.");
    }
  }

  const hash = hashPassword(data.password as string);
  const syncId = uuidv4();
  const inputRoles = (data.roles as string[]) || (data.role ? [data.role as string] : ['OPERATEUR_SAISIE']);
  const primaryRole = (data.role as string) || inputRoles[0];

  const transaction = db.transaction(() => {
    const existing = db.prepare('SELECT id_user, sync_id FROM t_users WHERE login = ?').get(data.login) as { id_user: number; sync_id: string } | undefined;
    
    let localOutboxToEnqueue: { id: string; table: string; operation: 'INSERT' | 'UPDATE'; payload: Record<string, unknown> } | null = null;

    if (existing) {
      const userSyncId = existing.sync_id || syncId;
      const result = db.prepare(`
        UPDATE t_users 
        SET password_hash = @hash, role = @role, nom_user = @nom_user, prenom_user = @prenom_user,
            statut_actif = 1, centre_id = @centre_id, site_id = @site_id, sync_id = @sync_id, is_dirty = 1
        WHERE id_user = @id
      `).run({
        id: existing.id_user,
        hash,
        role: primaryRole,
        nom_user: data.nom_user || '',
        prenom_user: data.prenom_user || '',
        centre_id: targetCentreId,
        site_id: targetSiteId,
        sync_id: userSyncId
      });

      db.prepare('DELETE FROM t_user_roles WHERE id_user = ?').run(existing.id_user);
      const insertStmt = db.prepare('INSERT INTO t_user_roles (id_user, role) VALUES (?, ?)');
      for (const r of inputRoles) {
        insertStmt.run(existing.id_user, r);
      }

      localOutboxToEnqueue = {
        id: userSyncId,
        table: 't_users',
        operation: 'UPDATE',
        payload: {
          sync_id: userSyncId,
          login: data.login,
          password_hash: hash,
          role: primaryRole,
          nom_user: data.nom_user || '',
          prenom_user: data.prenom_user || '',
          site_id: targetSiteId,
          centre_id: targetCentreId,
          statut_actif: 1,
          updated_at: new Date().toISOString()
        }
      };

      return { result, outboxToEnqueue: localOutboxToEnqueue };
    }

    const result = db.prepare(`
      INSERT INTO t_users (login, password_hash, role, nom_user, prenom_user, statut_actif, centre_id, site_id, sync_id, is_dirty)
      VALUES (@login, @hash, @role, @nom_user, @prenom_user, 1, @centre_id, @site_id, @sync_id, 1)
    `).run({ 
      login: data.login, 
      hash, 
      role: primaryRole, 
      nom_user: data.nom_user || '', 
      prenom_user: data.prenom_user || '', 
      centre_id: targetCentreId, 
      site_id: targetSiteId,
      sync_id: syncId 
    });

    const newUserId = result.lastInsertRowid as number;

    const insertStmt = db.prepare('INSERT INTO t_user_roles (id_user, role) VALUES (?, ?)');
    for (const r of inputRoles) {
      insertStmt.run(newUserId, r);
    }

    localOutboxToEnqueue = {
      id: syncId,
      table: 't_users',
      operation: 'INSERT',
      payload: {
        sync_id: syncId,
        login: data.login,
        password_hash: hash,
        role: primaryRole,
        nom_user: data.nom_user || '',
        prenom_user: data.prenom_user || '',
        site_id: targetSiteId,
        centre_id: targetCentreId,
        statut_actif: 1
      }
    };

    return { result, outboxToEnqueue: localOutboxToEnqueue };
  });
  const txResult = transaction();

  if (txResult.outboxToEnqueue) {
    enqueueOutbox(txResult.outboxToEnqueue.id, txResult.outboxToEnqueue.table, txResult.outboxToEnqueue.operation, txResult.outboxToEnqueue.payload);
    if (networkMonitor.getState() === 'ONLINE') {
      scheduleOutboxProcessing();
    }
  }

  return txResult.result;
}

export function updateUser(id: number, data: Record<string, unknown>, creator?: { role: string; site_id?: number }) {
  const db = getDatabase()!;
  
  if (creator && creator.role !== 'SUPER ADMIN') {
    const target = db.prepare('SELECT site_id FROM t_users WHERE id_user = ?').get(id) as { site_id?: number } | undefined;
    if (!target || target.site_id !== creator.site_id) {
      throw new Error("Accès non autorisé aux données de ce site");
    }
  }
  
  if (data.password) {
    data.password_hash = hashPassword(data.password as string);
    delete data.password;
  }

  const inputRoles = data.roles as string[] | undefined;
  if (inputRoles && inputRoles.length > 0) {
    data.role = inputRoles[0];
  }
  delete data.roles;
  
  const allowedUserColumns = [
    'login', 'password_hash', 'role', 'nom_user', 'prenom_user', 
    'statut_actif', 'site_id', 'centre_id', 'sync_id', 'is_dirty', 'last_login'
  ];
  
  const filteredKeys = Object.keys(data).filter(k => allowedUserColumns.includes(k));
  
  const transaction = db.transaction(() => {
    // ── 0. Récupération du sync_id courant de l'utilisateur ──────────────────────
    const user = db.prepare('SELECT sync_id FROM t_users WHERE id_user = ?').get(id) as { sync_id: string } | undefined;

    let result = { changes: 0 };
    let localOutboxToEnqueue: { id: string; table: string; operation: 'INSERT' | 'UPDATE'; payload: Record<string, unknown> } | null = null;

    if (filteredKeys.length > 0) {
      const fields = filteredKeys.map(k => `${k} = @${k}`).join(', ');
      const params: Record<string, unknown> = {};
      filteredKeys.forEach(k => {
        params[k] = data[k];
      });
      params.id = id;
      
      // ── 1. Mise à jour locale immédiate ─────────────────────────────────────────
      try {
        result = db.prepare(`UPDATE t_users SET ${fields}, updated_at = datetime('now'), is_dirty = 1 WHERE id_user = @id`).run(params);
      } catch (err: any) {
        console.error("ERREUR SQL:", err);
        throw err;
      }
      if (result.changes === 0) {
        throw new Error("Accès non autorisé aux données de ce site");
      }
    }

    if (inputRoles) {
      try {
        db.prepare('DELETE FROM t_user_roles WHERE id_user = ?').run(id);
        const insertStmt = db.prepare('INSERT INTO t_user_roles (id_user, role) VALUES (?, ?)');
        for (const r of inputRoles) {
          insertStmt.run(id, r);
        }
        db.prepare("UPDATE t_users SET is_dirty = 1, updated_at = datetime('now') WHERE id_user = ?").run(id);
      } catch (err: any) {
        console.error("ERREUR SQL:", err);
        throw err;
      }
      result.changes = 1;
    }

    // ── 2. Enfilage outbox UPDATE (après confirmation des changements SQLite) ───
    if (user?.sync_id && result.changes > 0) {
      let updatedUser;
      try {
        updatedUser = db.prepare(
          'SELECT login, password_hash, role, nom_user, prenom_user, statut_actif, site_id, centre_id FROM t_users WHERE id_user = ?'
        ).get(id) as any;
      } catch (err: any) {
        console.error("ERREUR SQL:", err);
        throw err;
      }

      localOutboxToEnqueue = {
        id: user.sync_id,
        table: 't_users',
        operation: 'UPDATE',
        payload: {
          sync_id: user.sync_id,
          ...updatedUser,
          updated_at: new Date().toISOString()
        }
      };
    }

    return { result, outboxToEnqueue: localOutboxToEnqueue };
  });
  const txResult = transaction();

  if (txResult.outboxToEnqueue) {
    enqueueOutbox(txResult.outboxToEnqueue.id, txResult.outboxToEnqueue.table, txResult.outboxToEnqueue.operation, txResult.outboxToEnqueue.payload);
    if (networkMonitor.getState() === 'ONLINE') {
      scheduleOutboxProcessing();
    }
  }

  return txResult.result;
}

export function deleteUser(id: number, creator?: { role: string; site_id?: number; login?: string }) {
  const db = getDatabase()!;
  
  if (creator && !['SUPER ADMIN', 'ADMINISTRATEUR_SITE'].includes(creator.role)) {
    throw new Error("Accès non autorisé : Rôle insuffisant pour désactiver un agent.");
  }

  if (creator && creator.role !== 'SUPER ADMIN') {
    const target = db.prepare('SELECT site_id FROM t_users WHERE id_user = ?').get(id) as { site_id?: number } | undefined;
    if (!target || target.site_id !== creator.site_id) {
      throw new Error("Accès non autorisé aux données de ce site");
    }
  }

  // Trace d'audit
  const user = db.prepare('SELECT sync_id, login FROM t_users WHERE id_user = ?').get(id) as { sync_id: string; login: string } | undefined;
  if (user) {
    insertAuditLog(
      creator?.login || 'ADMIN',
      'VALIDATION',
      `[SUPPRESSION] Par ${creator?.login || 'ADMIN'} sur t_users (ID: ${id})`
    );
  }

  // Soft-delete local immédiat (statut_actif = 0)
  const result = db.prepare("UPDATE t_users SET statut_actif = 0, updated_at = datetime('now'), is_dirty = 1 WHERE id_user = ?").run(id);
  if (result.changes === 0) {
    throw new Error("Accès non autorisé aux données de ce site");
  }

  if (user?.sync_id) {
    enqueueOutbox(user.sync_id, 't_users', 'UPDATE', {
      sync_id: user.sync_id,
      statut_actif: 0,
      updated_at: new Date().toISOString()
    });
    if (networkMonitor.getState() === 'ONLINE') {
      scheduleOutboxProcessing();
    }
  }

  return result;
}

export function hardDeleteUser(id: number, creator?: { role: string; site_id?: number; login?: string }) {
  const db = getDatabase()!;
  
  if (creator && !['SUPER ADMIN', 'ADMINISTRATEUR_SITE'].includes(creator.role)) {
    throw new Error("Accès non autorisé : Rôle insuffisant pour supprimer définitivement un agent.");
  }

  if (creator && creator.role !== 'SUPER ADMIN') {
    const target = db.prepare('SELECT site_id FROM t_users WHERE id_user = ?').get(id) as { site_id?: number } | undefined;
    if (!target || target.site_id !== creator.site_id) {
      throw new Error("Accès non autorisé aux données de ce site");
    }
  }

  const user = db.prepare('SELECT sync_id, login FROM t_users WHERE id_user = ?').get(id) as { sync_id: string | null; login: string } | undefined;
  if (!user) return { changes: 0 };
  const userSyncId = user.sync_id;

  // Trace d'audit
  insertAuditLog(
    creator?.login || 'ADMIN',
    'VALIDATION',
    `[SUPPRESSION] Par ${creator?.login || 'ADMIN'} sur t_users (ID: ${id})`
  );

  // Marquer temporairement en local comme supprimé (statut_actif = -1, is_dirty = -1)
  const result = db.prepare("UPDATE t_users SET statut_actif = -1, is_dirty = -1, updated_at = datetime('now') WHERE id_user = ?").run(id);
  if (result.changes === 0) {
    throw new Error("Accès non autorisé aux données de ce site");
  }

  // Enfilage outbox DELETE
  if (userSyncId) {
    const wasLocalOnly = cancelPendingInsert(userSyncId, 't_users');
    if (!wasLocalOnly) {
      enqueueOutbox(userSyncId, 't_users', 'DELETE', { sync_id: userSyncId });
      if (networkMonitor.getState() === 'ONLINE') {
        scheduleOutboxProcessing();
      }
    } else {
      // Si l'utilisateur n'a jamais été synchronisé, suppression physique immédiate
      db.prepare('DELETE FROM t_user_roles WHERE id_user = ?').run(id);
      db.prepare('DELETE FROM t_users WHERE id_user = ?').run(id);
    }
  }

  return result;
}

export function resetAgentPassword(targetUserId: number, callerUserId: number): { success: boolean } {
  const db = getDatabase()!;
  
  const caller = db.prepare('SELECT role, site_id FROM t_users WHERE id_user = ?').get(callerUserId) as { role: string; site_id?: number } | undefined;
  if (!caller || !['SUPER ADMIN', 'ADMINISTRATEUR_SITE'].includes(caller.role)) {
    throw new Error("Accès non autorisé : Rôle insuffisant pour réinitialiser un mot de passe.");
  }
  
  const target = db.prepare('SELECT site_id, login, sync_id FROM t_users WHERE id_user = ?').get(targetUserId) as { site_id?: number; login: string; sync_id: string } | undefined;
  if (!target) {
    throw new Error("L'agent cible n'existe pas.");
  }
  
  if (caller.role === 'ADMINISTRATEUR_SITE' && caller.site_id !== target.site_id) {
    throw new Error("Accès non autorisé : L'agent cible n'appartient pas à votre site.");
  }

  const newPasswordPlain = 'cnam@2026';
  const hash = hashPassword(newPasswordPlain);
  
  // ── 1. Mise à jour locale immédiate ─────────────────────────────────────────
  db.prepare(`
    UPDATE t_users
    SET password_hash = ?, is_dirty = 1, updated_at = datetime('now')
    WHERE id_user = ?
  `).run(hash, targetUserId);

  logAction(callerUserId, caller.role, 'RESET_PASSWORD', `Réinitialisation du mot de passe de l'agent ${target.login} (${targetUserId})`);

  // ── 2. Enfilage outbox UPDATE (remplacement du push Supabase direct) ───────
  // L'ancien push asynchrone Supabase était fragile (pas de réessai en cas
  // d'échec réseau). Le pattern outbox garantit la synchro différée.
  if (target.sync_id) {
    enqueueOutbox(target.sync_id, 't_users', 'UPDATE', {
      sync_id: target.sync_id,
      password_hash: hash,
      updated_at: new Date().toISOString()
    });
    if (networkMonitor.getState() === 'ONLINE') {
      scheduleOutboxProcessing();
    }
  }

  return { success: true };
}

export function updateSelfProfile(userId: number, data: { nom_user?: string; prenom_user?: string; email?: string; telephone?: string; password?: string }): { success: boolean } {
  const db = getDatabase()!;
  
  const user = db.prepare('SELECT role, sync_id, login FROM t_users WHERE id_user = ?').get(userId) as { role: string; sync_id: string; login: string } | undefined;
  if (!user) {
    throw new Error("Utilisateur non trouvé.");
  }
  
  if (user.role === 'SUPER ADMIN') {
    throw new Error("La modification autonome du compte Super Admin est désactivée.");
  }

  const updateData: Record<string, unknown> = {};
  if (data.nom_user !== undefined)    updateData.nom_user    = data.nom_user;
  if (data.prenom_user !== undefined) updateData.prenom_user = data.prenom_user;
  if (data.email !== undefined)       updateData.email       = data.email;
  if (data.telephone !== undefined)   updateData.telephone   = data.telephone;
  
  if (data.password) {
    updateData.password_hash = hashPassword(data.password);
  }

  const allowedSelfProfileColumns = ['nom_user', 'prenom_user', 'email', 'telephone', 'password_hash'];
  const filteredKeys = Object.keys(updateData).filter(k => allowedSelfProfileColumns.includes(k));

  if (filteredKeys.length === 0) {
    return { success: true };
  }

  const fields = filteredKeys.map(k => `${k} = @${k}`).join(', ');
  const params: Record<string, unknown> = {};
  filteredKeys.forEach(k => {
    params[k] = updateData[k];
  });
  params.userId = userId;

  // ── 1. Mise à jour locale immédiate ─────────────────────────────────────────
  db.prepare(`
    UPDATE t_users 
    SET ${fields}, is_dirty = 1, updated_at = datetime('now')
    WHERE id_user = @userId
  `).run(params);

  logAction(userId, user.role, 'UPDATE_PROFILE', `Mise à jour autonome du profil de l'utilisateur ${user.login}`);

  // ── 2. Enfilage outbox UPDATE (remplacement du push Supabase direct) ───────
  // L'ancienne implémentation async était fragile : en cas de déconnexion au
  // moment du push, la modification était perdue. Le pattern outbox garantit
  // la synchro différée dès le retour du réseau, sans risque de perte.
  if (user.sync_id) {
    const outboxPayload: Record<string, unknown> = {
      sync_id: user.sync_id,
      ...updateData,
      updated_at: new Date().toISOString()
    };
    enqueueOutbox(user.sync_id, 't_users', 'UPDATE', outboxPayload);
    if (networkMonitor.getState() === 'ONLINE') {
      scheduleOutboxProcessing();
    }
  }

  return { success: true };
}

export async function pullAgentsFromCloud(siteId: number, centreId?: number): Promise<{ success: boolean; count: number; message?: string }> {
  const db = getDatabase()!;
  const supabase = getSupabaseClient();

  log.info(`[pullAgentsFromCloud] Récupération manuelle des agents pour le site ${siteId} (filtrage par centre local) depuis Supabase...`);

  try {
    const { data: cloudUsers, error } = await supabase
      .from('t_users')
      .select('login, password_hash, role, nom_user, prenom_user, email, telephone, site_id, centre_id, sync_id, statut_actif')
      .eq('site_id', siteId);

    if (error) {
      log.error(`[pullAgentsFromCloud] Erreur Supabase : ${error.message}`);
      return { success: false, count: 0, message: error.message };
    }

    if (!cloudUsers || cloudUsers.length === 0) {
      return { success: true, count: 0, message: "Aucun agent trouvé sur Supabase pour ce site." };
    }

    let count = 0;
    db.transaction(() => {
      const insertStmt = db.prepare(`
        INSERT INTO t_users (
          login, password_hash, role, nom_user, prenom_user, email, telephone,
          statut_actif, site_id, centre_id, sync_id, is_dirty, synced_at
        ) VALUES (
          @login, @password_hash, @role, @nom_user, @prenom_user, @email, @telephone,
          @statut_actif, @site_id, @centre_id, @sync_id, 0, datetime('now')
        )
        ON CONFLICT(login) DO UPDATE SET
          password_hash = excluded.password_hash,
          role = excluded.role,
          nom_user = excluded.nom_user,
          prenom_user = excluded.prenom_user,
          email = excluded.email,
          telephone = excluded.telephone,
          statut_actif = excluded.statut_actif,
          centre_id = excluded.centre_id,
          sync_id = COALESCE(t_users.sync_id, excluded.sync_id),
          is_dirty = 0,
          synced_at = datetime('now');
      `);

      for (const u of cloudUsers) {
        // Validation stricte du rôle (Agent 6 QA constraint check)
        const validRoles = [
          'SUPER ADMIN', 'ADMINISTRATEUR_SITE', 'ADMIN_CENTRE',
          'OPERATEUR_VERIFICATION', 'OPERATEUR_QUALITE', 'OPERATEUR_SAISIE',
          'OPERATEUR_LOGISTIQUE', 'OPERATEUR_INVENTAIRE'
        ];
        if (!validRoles.includes(u.role)) {
          log.warn(`[pullAgentsFromCloud] Rôle invalide ignoré pour ${u.login}: ${u.role}`);
          continue;
        }

        let finalCentreId = u.centre_id || null;
        if (finalCentreId) {
          // Vérifier si le centre existe localement. S'il n'existe pas encore (synchro incomplète), 
          // on l'ignore temporairement pour éviter une erreur de FOREIGN KEY constraint failed.
          const checkLocal = db.prepare('SELECT id FROM t_centres WHERE id = ?').get(finalCentreId);
          if (!checkLocal) {
            log.warn(`[pullAgentsFromCloud] Le centre ${finalCentreId} n'existe pas localement. L'utilisateur ${u.login} sera importé sans centre pour l'instant.`);
            finalCentreId = null;
          }
        }

        if (finalCentreId && centreId) {
          const cloudCentre = db.prepare('SELECT nom FROM t_centres WHERE id = ?').get(finalCentreId) as { nom: string } | undefined;
          const adminCentre = db.prepare('SELECT nom FROM t_centres WHERE id = ?').get(centreId) as { nom: string } | undefined;
          if (cloudCentre && adminCentre && cloudCentre.nom.toUpperCase().trim() === adminCentre.nom.toUpperCase().trim()) {
            finalCentreId = centreId;
          }
        }

        const result = insertStmt.run({
          login: u.login,
          password_hash: u.password_hash,
          role: u.role,
          nom_user: u.nom_user || '',
          prenom_user: u.prenom_user || '',
          email: u.email || null,
          telephone: u.telephone || null,
          statut_actif: u.statut_actif !== undefined ? u.statut_actif : 1,
          site_id: u.site_id,
          centre_id: finalCentreId,
          sync_id: u.sync_id || null
        });
        if (result.changes > 0) {
          count++;
        }
      }
    })();

    log.info(`[pullAgentsFromCloud] ${count} utilisateur(s) importé(s)/mis à jour pour le site ${siteId}.`);
    return { success: true, count };
  } catch (e: any) {
    log.error(`[pullAgentsFromCloud] Exception : ${e.message || e}`);
    return { success: false, count: 0, message: e.message || String(e) };
  }
}

