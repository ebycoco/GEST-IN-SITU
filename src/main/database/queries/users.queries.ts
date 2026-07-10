import { getDatabase } from '../connection';
import { hashPassword, verifyPassword } from '../../auth/local-auth';
import { getSupabaseClient } from '../../sync/supabase-client';
import { networkMonitor } from '../../sync/network-monitor';
import { logAction } from './logs.queries';
import { v4 as uuidv4 } from 'uuid';
import log from 'electron-log';

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
    SELECT id_user, login, password_hash, role, nom_user, prenom_user, site_id, centre_id, sync_id, statut_actif
    FROM t_users 
    WHERE login = ? AND statut_actif = 1
  `).get(login) as any;

  if (!user) return null;

  const valid = verifyPassword(password, user.password_hash);
  if (!valid) return null;

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
    nom_user: user.nom_user,
    prenom_user: user.prenom_user,
    site_id: user.site_id,
    centre_id: user.centre_id,
    sessionToken: token
  };
}

export function getUserRoles(userId: number): string[] {
  const db = getDatabase()!;
  const rows = db.prepare('SELECT role FROM t_user_roles WHERE id_user = ?').all(userId) as { role: string }[];
  return rows.map(r => r.role);
}

export function getUsers(siteId?: number) {
  const db = getDatabase()!;
  const query = `
    SELECT u.*, c.nom AS centre_nom, s.nom AS site_nom 
    FROM t_users u
    LEFT JOIN t_centres c ON u.centre_id = c.id
    LEFT JOIN t_sites s ON u.site_id = s.id
    WHERE u.role != 'SUPER ADMIN'
    ${siteId ? 'AND u.site_id = ?' : ''}
    ORDER BY u.login
  `;
  const users = (siteId ? db.prepare(query).all(siteId) : db.prepare(query).all()) as any[];
  
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
  
  const creator = db.prepare('SELECT role, site_id FROM t_users WHERE id_user = ?').get(callerUserId) as { role: string; site_id?: number } | undefined;
  if (!creator || !['SUPER ADMIN', 'ADMINISTRATEUR_SITE'].includes(creator.role)) {
    throw new Error("Accès non autorisé : Rôle insuffisant pour créer un utilisateur.");
  }

  const targetSiteId = creator.role === 'ADMINISTRATEUR_SITE' ? creator.site_id : (Number(data.site_id) || 1);

  if (creator.role === 'ADMINISTRATEUR_SITE' && data.centre_id) {
    const centre = db.prepare('SELECT site_id FROM t_centres WHERE id = ?').get(data.centre_id) as { site_id?: number } | undefined;
    if (!centre || centre.site_id !== creator.site_id) {
      throw new Error("Accès non autorisé : Ce centre n'appartient pas à votre site.");
    }
  }

  const hash = hashPassword(data.password as string);
  const syncId = uuidv4();
  const inputRoles = (data.roles as string[]) || (data.role ? [data.role as string] : ['OPERATEUR_SAISIE']);
  const primaryRole = (data.role as string) || inputRoles[0];

  return db.transaction(() => {
    const existing = db.prepare('SELECT id_user, sync_id FROM t_users WHERE login = ?').get(data.login) as { id_user: number; sync_id: string } | undefined;
    
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
        centre_id: data.centre_id || null,
        site_id: targetSiteId,
        sync_id: userSyncId
      });

      db.prepare('DELETE FROM t_user_roles WHERE id_user = ?').run(existing.id_user);
      const insertStmt = db.prepare('INSERT INTO t_user_roles (id_user, role) VALUES (?, ?)');
      for (const r of inputRoles) {
        insertStmt.run(existing.id_user, r);
      }

      if (networkMonitor.getState() === 'ONLINE') {
        const supabase = getSupabaseClient();
        (async () => {
          try {
            const { error } = await supabase.from('t_users').upsert({
              id_user: existing.id_user,
              login: data.login,
              password_hash: hash,
              role: primaryRole,
              nom_user: data.nom_user || '',
              prenom_user: data.prenom_user || '',
              site_id: targetSiteId,
              centre_id: data.centre_id || null,
              statut_actif: 1,
              sync_id: userSyncId,
              updated_at: new Date().toISOString()
            }, { onConflict: 'sync_id' });

            if (error) {
              log.warn(`[createUser] Push direct de mise à jour de l'agent échoué (non-bloquant): ${error.message}`);
            } else {
              log.info(`[createUser] Agent '${data.login}' mis à jour sur Supabase en direct.`);
              db.prepare("UPDATE t_users SET is_dirty = 0, synced_at = datetime('now') WHERE id_user = ?").run(existing.id_user);
            }
          } catch (e: any) {
            log.warn(`[createUser] Exception push direct de l'agent (non-bloquant): ${e.message || e}`);
          }
        })();
      }

      return result;
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
      centre_id: data.centre_id || null, 
      site_id: targetSiteId,
      sync_id: syncId 
    });

    const newUserId = result.lastInsertRowid as number;

    const insertStmt = db.prepare('INSERT INTO t_user_roles (id_user, role) VALUES (?, ?)');
    for (const r of inputRoles) {
      insertStmt.run(newUserId, r);
    }

    if (networkMonitor.getState() === 'ONLINE') {
      const supabase = getSupabaseClient();
      (async () => {
        try {
          const { error } = await supabase.from('t_users').insert({
            id_user: newUserId,
            login: data.login,
            password_hash: hash,
            role: primaryRole,
            nom_user: data.nom_user || '',
            prenom_user: data.prenom_user || '',
            site_id: targetSiteId,
            centre_id: data.centre_id || null,
            statut_actif: 1,
            sync_id: syncId
          });

          if (error) {
            log.warn(`[createUser] Push direct de création de l'agent échoué (non-bloquant): ${error.message}`);
          } else {
            log.info(`[createUser] Nouvel agent '${data.login}' créé sur Supabase en direct.`);
            db.prepare("UPDATE t_users SET is_dirty = 0, synced_at = datetime('now') WHERE id_user = ?").run(newUserId);
          }
        } catch (e: any) {
          log.warn(`[createUser] Exception push direct de l'agent (non-bloquant): ${e.message || e}`);
        }
      })();
    }

    return result;
  })();
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
  
  return db.transaction(() => {
    let result = { changes: 0 };
    if (filteredKeys.length > 0) {
      const fields = filteredKeys.map(k => `${k} = @${k}`).join(', ');
      const params: any = {};
      filteredKeys.forEach(k => {
        params[k] = data[k];
      });
      params.id = id;
      
      result = db.prepare(`UPDATE t_users SET ${fields}, updated_at = datetime('now'), is_dirty = 1 WHERE id_user = @id`).run(params);
      if (result.changes === 0) {
        throw new Error("Accès non autorisé aux données de ce site");
      }
    }

    if (inputRoles) {
      db.prepare('DELETE FROM t_user_roles WHERE id_user = ?').run(id);
      const insertStmt = db.prepare('INSERT INTO t_user_roles (id_user, role) VALUES (?, ?)');
      for (const r of inputRoles) {
        insertStmt.run(id, r);
      }
      db.prepare("UPDATE t_users SET is_dirty = 1, updated_at = datetime('now') WHERE id_user = ?").run(id);
      result.changes = 1;
    }

    return result;
  })();
}

export function deleteUser(id: number, creator?: { role: string; site_id?: number }) {
  const db = getDatabase()!;
  if (creator && creator.role !== 'SUPER ADMIN') {
    const target = db.prepare('SELECT site_id FROM t_users WHERE id_user = ?').get(id) as { site_id?: number } | undefined;
    if (!target || target.site_id !== creator.site_id) {
      throw new Error("Accès non autorisé aux données de ce site");
    }
  }
  const result = db.prepare("UPDATE t_users SET statut_actif = 0, updated_at = datetime('now'), is_dirty = 1 WHERE id_user = ?").run(id);
  if (result.changes === 0) {
    throw new Error("Accès non autorisé aux données de ce site");
  }
  return result;
}

export function hardDeleteUser(id: number, creator?: { role: string; site_id?: number }) {
  const db = getDatabase()!;
  if (creator && creator.role !== 'SUPER ADMIN') {
    const target = db.prepare('SELECT site_id FROM t_users WHERE id_user = ?').get(id) as { site_id?: number } | undefined;
    if (!target || target.site_id !== creator.site_id) {
      throw new Error("Accès non autorisé aux données de ce site");
    }
  }
  return db.transaction(() => {
    db.prepare('DELETE FROM t_logs WHERE id_user = ?').run(id);
    const result = db.prepare('DELETE FROM t_users WHERE id_user = ?').run(id);
    if (result.changes === 0) {
      throw new Error("Accès non autorisé aux données de ce site");
    }
    return result;
  })();
}

export async function resetAgentPassword(targetUserId: number, callerUserId: number) {
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
  
  db.prepare(`
    UPDATE t_users
    SET password_hash = ?, is_dirty = 1, updated_at = datetime('now')
    WHERE id_user = ?
  `).run(hash, targetUserId);

  logAction(callerUserId, caller.role, 'RESET_PASSWORD', `Réinitialisation du mot de passe de l'agent ${target.login} (${targetUserId})`);

  if (networkMonitor.getState() === 'ONLINE') {
    const supabase = getSupabaseClient();
    try {
      const { error } = await supabase
        .from('t_users')
        .update({
          password_hash: hash,
          updated_at: new Date().toISOString()
        })
        .eq('sync_id', target.sync_id);
        
      if (error) {
        log.warn(`[resetAgentPassword] Échec de la mise à jour synchrone cloud pour l'agent ${target.login}: ${error.message}`);
      } else {
        log.info(`[resetAgentPassword] Mot de passe de l'agent ${target.login} synchronisé sur Supabase.`);
        db.prepare("UPDATE t_users SET is_dirty = 0, synced_at = datetime('now') WHERE id_user = ?").run(targetUserId);
      }
    } catch (e: any) {
      log.warn(`[resetAgentPassword] Exception lors de la mise à jour cloud: ${e.message || e}`);
    }
  }

  return { success: true };
}

export async function updateSelfProfile(userId: number, data: { nom_user?: string; prenom_user?: string; email?: string; telephone?: string; password?: string }) {
  const db = getDatabase()!;
  
  const user = db.prepare('SELECT role, sync_id, login FROM t_users WHERE id_user = ?').get(userId) as { role: string; sync_id: string; login: string } | undefined;
  if (!user) {
    throw new Error("Utilisateur non trouvé.");
  }
  
  if (user.role === 'SUPER ADMIN') {
    throw new Error("La modification autonome du compte Super Admin est désactivée.");
  }

  const updateData: Record<string, any> = {};
  if (data.nom_user !== undefined) updateData.nom_user = data.nom_user;
  if (data.prenom_user !== undefined) updateData.prenom_user = data.prenom_user;
  if (data.email !== undefined) updateData.email = data.email;
  if (data.telephone !== undefined) updateData.telephone = data.telephone;
  
  if (data.password) {
    updateData.password_hash = hashPassword(data.password);
  }

  const allowedSelfProfileColumns = ['nom_user', 'prenom_user', 'email', 'telephone', 'password_hash'];
  const filteredKeys = Object.keys(updateData).filter(k => allowedSelfProfileColumns.includes(k));

  if (filteredKeys.length === 0) {
    return { success: true };
  }

  const fields = filteredKeys.map(k => `${k} = @${k}`).join(', ');
  const params: any = {};
  filteredKeys.forEach(k => {
    params[k] = updateData[k];
  });
  params.userId = userId;

  db.prepare(`
    UPDATE t_users 
    SET ${fields}, is_dirty = 1, updated_at = datetime('now')
    WHERE id_user = @userId
  `).run(params);

  logAction(userId, user.role, 'UPDATE_PROFILE', `Mise à jour autonome du profil de l'utilisateur ${user.login}`);

  if (networkMonitor.getState() === 'ONLINE') {
    const supabase = getSupabaseClient();
    try {
      const payload: Record<string, any> = { ...updateData, updated_at: new Date().toISOString() };
      const { error } = await supabase
        .from('t_users')
        .update(payload)
        .eq('sync_id', user.sync_id);
        
      if (error) {
        log.warn(`[updateSelfProfile] Échec de la mise à jour cloud en direct pour ${user.login}: ${error.message}`);
      } else {
        log.info(`[updateSelfProfile] Profil de ${user.login} mis à jour en direct sur Supabase.`);
        db.prepare("UPDATE t_users SET is_dirty = 0, synced_at = datetime('now') WHERE id_user = ?").run(userId);
      }
    } catch (e: any) {
      log.warn(`[updateSelfProfile] Exception lors de la mise à jour cloud: ${e.message || e}`);
    }
  }

  return { success: true };
}

export async function pullAgentsFromCloud(siteId: number, centreId?: number): Promise<{ success: boolean; count: number; message?: string }> {
  const db = getDatabase()!;
  const supabase = getSupabaseClient();

  log.info(`[pullAgentsFromCloud] Récupération manuelle des agents pour le site ${siteId} (centre: ${centreId || 'tous'}) depuis Supabase...`);

  try {
    let query = supabase
      .from('t_users')
      .select('login, password_hash, role, nom_user, prenom_user, email, telephone, site_id, centre_id, sync_id, statut_actif')
      .eq('site_id', siteId);

    if (centreId) {
      query = query.eq('centre_id', centreId);
    }

    const { data: cloudUsers, error } = await query;

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
          centre_id: u.centre_id || null,
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

