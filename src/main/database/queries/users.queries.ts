import { getDatabase } from '../connection';
import { hashPassword, verifyPassword } from '../../auth/local-auth';
import { getSupabaseClient } from '../../sync/supabase-client';
import { networkMonitor } from '../../sync/network-monitor';
import { logAction } from './logs.queries';
import { v4 as uuidv4 } from 'uuid';
import { randomInt } from 'crypto';
import log from 'electron-log';
import { enqueueOutbox, scheduleOutboxProcessing, cancelPendingInsert } from '../../sync/outbox.service';
import { insertAuditLog } from './audit.queries';
import { logAudit } from '../../utils/audit';

// Rôles que chaque niveau d'administrateur est autorisé à attribuer à un agent.
// Reflète côté serveur la restriction déjà appliquée côté UI (AgentsPage.visibleRoles) :
// un ADMIN_CENTRE ne doit jamais pouvoir créer/promouvoir un ADMIN_CENTRE, un
// ADMINISTRATEUR_SITE ou un SUPER ADMIN. Sans cette vérification serveur, un appel
// direct à l'IPC (hors UI) pouvait contourner la restriction visuelle.
const ASSIGNABLE_ROLES_BY_CREATOR: Record<string, string[]> = {
  'SUPER ADMIN': [
    'SUPER ADMIN', 'ADMINISTRATEUR_SITE', 'ADMIN_CENTRE',
    'OPERATEUR_VERIFICATION', 'OPERATEUR_SAISIE', 'OPERATEUR_LOGISTIQUE',
    'OPERATEUR_QUALITE', 'OPERATEUR_INVENTAIRE', 'OPERATEUR_APUREMENT'
  ],
  'ADMINISTRATEUR_SITE': [
    'ADMIN_CENTRE', 'OPERATEUR_VERIFICATION', 'OPERATEUR_SAISIE',
    'OPERATEUR_LOGISTIQUE', 'OPERATEUR_QUALITE', 'OPERATEUR_INVENTAIRE', 'OPERATEUR_APUREMENT'
  ],
  'ADMIN_CENTRE': [
    'OPERATEUR_VERIFICATION', 'OPERATEUR_SAISIE',
    'OPERATEUR_LOGISTIQUE', 'OPERATEUR_QUALITE', 'OPERATEUR_INVENTAIRE', 'OPERATEUR_APUREMENT'
  ],
};

function assertRolesAssignable(creatorRole: string, roles: string[]): void {
  const allowed = ASSIGNABLE_ROLES_BY_CREATOR[creatorRole] || [];
  const forbidden = roles.filter(r => !allowed.includes(r));
  if (forbidden.length > 0) {
    throw new Error(`Accès non autorisé : le rôle "${creatorRole}" ne peut pas attribuer le(s) rôle(s) suivant(s) : ${forbidden.join(', ')}.`);
  }
}

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

/**
 * Résout les rôles attribués à un utilisateur (multi-rôles via `t_user_roles`), avec
 * fallback sur son rôle unique (`t_users.role`) si aucune ligne n'existe dans
 * `t_user_roles`. Extrait tel quel de la logique historiquement inline dans
 * `authenticateUser` (zéro changement de comportement) pour être réutilisable par le
 * handler IPC `auth:setActiveRole` (validation serveur du rôle actif demandé).
 */
export function resolveGrantedRoles(userId: number, baseRole: string): string[] {
  const db = getDatabase()!;
  const rolesRows = db.prepare('SELECT role FROM t_user_roles WHERE id_user = ?').all(userId) as { role: string }[];
  let roles = rolesRows.map(r => r.role);
  if (roles.length === 0 && baseRole) {
    roles = [baseRole];
  }
  return roles;
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

  const roles = resolveGrantedRoles(user.id_user, user.role);

  if (user.role === 'ADMINISTRATEUR_SITE' && !user.centre_id && user.site_id) {
    const mainCentre = db.prepare(`
      SELECT id FROM t_centres
      WHERE site_id = ?
      ORDER BY numero ASC, id ASC
      LIMIT 1
    `).get(user.site_id) as { id: number } | undefined;
    
    if (mainCentre) {
      user.centre_id = mainCentre.id;
    }
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
    SELECT u.*, c.nom AS centre_nom, s.nom AS site_nom,
      (SELECT GROUP_CONCAT(role, ',') FROM t_user_roles WHERE id_user = u.id_user) as roles_concat
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
    user.roles = user.roles_concat ? user.roles_concat.split(',') : [];
    if (user.roles.length === 0 && user.role) {
      user.roles = [user.role];
    }
    delete user.roles_concat;
    delete user.password_hash;
  }
  return users;
}

export function createUser(data: Record<string, unknown>, caller: { id_user: number; role: string; site_id?: number; centre_id?: number; login?: string }) {
  const db = getDatabase()!;

  // Sécurité (cloisonnement §3) : cantonnement dérivé du rôle ACTIF de la session serveur
  // (caller, transmis par l'appelant via getSecureCurrentUser()), pas d'une re-requête directe
  // sur t_users — pour un compte multi-rôles ayant changé de rôle actif via setActiveRole(),
  // le rôle "primaire" statique en base pouvait diverger du rôle réellement utilisé.
  const creator = caller;
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

  assertRolesAssignable(creator.role, inputRoles);

  const transaction = db.transaction(() => {
    const existing = db.prepare('SELECT id_user, sync_id FROM t_users WHERE login = ?').get(data.login) as { id_user: number; sync_id: string } | undefined;
    
    const outboxItems: Array<{ id: string; table: string; operation: 'INSERT' | 'UPDATE' | 'DELETE'; payload: Record<string, unknown> }> = [];

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

      outboxItems.push({
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
      });

      outboxItems.push({
        id: `${userSyncId}_roles_del`,
        table: 't_user_roles',
        operation: 'DELETE',
        payload: { sync_id: userSyncId }
      });

      for (const r of inputRoles) {
        outboxItems.push({
          id: `${userSyncId}_${r}`,
          table: 't_user_roles',
          operation: 'INSERT',
          payload: { user_sync_id: userSyncId, role: r }
        });
      }

      return { result, outboxItems };
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

    outboxItems.push({
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
    });

    for (const r of inputRoles) {
      outboxItems.push({
        id: `${syncId}_${r}`,
        table: 't_user_roles',
        operation: 'INSERT',
        payload: { user_sync_id: syncId, role: r }
      });
    }

    return { result, outboxItems };
  });
  const txResult = transaction();

  if (txResult.outboxItems && txResult.outboxItems.length > 0) {
    for (const item of txResult.outboxItems) {
      enqueueOutbox(item.id, item.table, item.operation, item.payload);
    }
    if (networkMonitor.getState() === 'ONLINE') {
      scheduleOutboxProcessing();
    }
  }

  insertAuditLog(
    caller.login || creator?.role || 'SYSTEM',
    'AGENT',
    `[CREATION] Agent ${data.login} créé avec succès.`
  );

  // Couverture CRUD_SYNC_WHITELIST (décision utilisateur validée) : la création (ou
  // réactivation) d'un compte utilisateur devient visible cross-poste via t_logs/logAudit(),
  // en plus de insertAuditLog() ci-dessus (t_audit_log local, inchangé). logAudit() résout
  // elle-même site_id/centre_id via la session serveur active (getSecureCurrentUser) —
  // cohérent avec le cloisonnement P0 déjà appliqué au reste de t_logs.
  logAudit(
    caller.login || creator?.role || 'SYSTEM',
    'UTILISATEUR_CREE',
    JSON.stringify({ login: data.login, role: primaryRole, site_id: targetSiteId, centre_id: targetCentreId })
  );

  return txResult.result;
}

export function updateUser(id: number, data: Record<string, unknown>, creator?: { role: string; site_id?: number; login?: string }) {
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
    if (creator) {
      assertRolesAssignable(creator.role, inputRoles);
    }
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
    const outboxItems: Array<{ id: string; table: string; operation: 'INSERT' | 'UPDATE' | 'DELETE'; payload: Record<string, unknown> }> = [];

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
        throw new Error("Utilisateur introuvable ou aucune donnée n'a été modifiée.");
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

      outboxItems.push({
        id: user.sync_id,
        table: 't_users',
        operation: 'UPDATE',
        payload: {
          sync_id: user.sync_id,
          ...updatedUser,
          updated_at: new Date().toISOString()
        }
      });

      if (inputRoles) {
        outboxItems.push({
          id: `${user.sync_id}_roles_del`,
          table: 't_user_roles',
          operation: 'DELETE',
          payload: { sync_id: user.sync_id }
        });

        for (const r of inputRoles) {
          outboxItems.push({
            id: `${user.sync_id}_${r}`,
            table: 't_user_roles',
            operation: 'INSERT',
            payload: { user_sync_id: user.sync_id, role: r }
          });
        }
      }
    }

    return { result, outboxItems };
  });
  const txResult = transaction();

  if (txResult.outboxItems && txResult.outboxItems.length > 0) {
    for (const item of txResult.outboxItems) {
      enqueueOutbox(item.id, item.table, item.operation, item.payload);
    }
    if (networkMonitor.getState() === 'ONLINE') {
      scheduleOutboxProcessing();
    }
  }

  insertAuditLog(
    creator?.login || creator?.role || 'SYSTEM',
    'AGENT',
    `[MODIFICATION] Agent ID ${id} (Login: ${data.login || 'Inconnu'}) mis à jour avec succès.`
  );

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
  const user = db.prepare('SELECT sync_id, login, password_hash, role FROM t_users WHERE id_user = ?').get(id) as { sync_id: string; login: string; password_hash: string; role: string } | undefined;
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
    // Payload t_users : login/password_hash/role obligatoires (NOT NULL côté Supabase,
    // voir invariant documenté sur enqueueOutbox — remplacement intégral du payload en
    // attente, jamais une fusion).
    enqueueOutbox(user.sync_id, 't_users', 'UPDATE', {
      sync_id: user.sync_id,
      login: user.login,
      password_hash: user.password_hash,
      role: user.role,
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

// SEC fix : génère un mot de passe temporaire aléatoire, unique par appel, communicable
// à l'oral (8 caractères, alphabet restreint sans caractères ambigus 0/O, 1/l/I).
// Utilise crypto.randomInt (CSPRNG Node natif) plutôt qu'un ad-hoc Math.random()
// afin de garantir l'imprévisibilité du mot de passe temporaire.
function generateTemporaryPassword(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let pwd = '';
  for (let i = 0; i < 8; i++) {
    pwd += alphabet[randomInt(alphabet.length)];
  }
  return pwd;
}

export function resetAgentPassword(targetUserId: number, caller: { id_user: number; role: string; site_id?: number }): { success: boolean; temporaryPassword: string } {
  const db = getDatabase()!;

  // Sécurité (cloisonnement §3) : cantonnement dérivé du rôle ACTIF de la session serveur
  // (caller, transmis par l'appelant via getSecureCurrentUser()), pas d'une re-requête directe
  // sur t_users — pour un compte multi-rôles ayant changé de rôle actif via setActiveRole(),
  // le rôle "primaire" statique en base pouvait diverger du rôle réellement utilisé.
  if (!caller || !['SUPER ADMIN', 'ADMINISTRATEUR_SITE'].includes(caller.role)) {
    throw new Error("Accès non autorisé : Rôle insuffisant pour réinitialiser un mot de passe.");
  }
  
  const target = db.prepare('SELECT site_id, login, sync_id, role FROM t_users WHERE id_user = ?').get(targetUserId) as { site_id?: number; login: string; sync_id: string; role: string } | undefined;
  if (!target) {
    throw new Error("L'agent cible n'existe pas.");
  }
  
  if (caller.role === 'ADMINISTRATEUR_SITE' && caller.site_id !== target.site_id) {
    throw new Error("Accès non autorisé : L'agent cible n'appartient pas à votre site.");
  }

  // SEC fix : l'ancienne implémentation réutilisait une valeur FIXE (DEFAULT_TEMP_PASSWORD
  // ou 'cnam2026!'), identique à chaque réinitialisation pour tout agent — un attaquant
  // connaissant cette constante pouvait se connecter à la place de n'importe quel agent
  // fraîchement réinitialisé. Générer un mot de passe aléatoire unique par appel.
  // Le mot de passe en clair n'est JAMAIS persisté ni loggé : seul son hash (ci-dessous)
  // est écrit en base/outbox, et le clair n'est retourné qu'une fois à l'appelant IPC
  // pour affichage immédiat côté renderer (cf. handlers.ts / AgentsPage.tsx).
  const newPasswordPlain = generateTemporaryPassword();
  const hash = hashPassword(newPasswordPlain);
  
  // ── 1. Mise à jour locale immédiate ─────────────────────────────────────────
  db.prepare(`
    UPDATE t_users
    SET password_hash = ?, is_dirty = 1, updated_at = datetime('now')
    WHERE id_user = ?
  `).run(hash, targetUserId);

  logAction(caller.id_user, caller.role, 'RESET_PASSWORD', `Réinitialisation du mot de passe de l'agent ${target.login} (${targetUserId})`);

  // ── 2. Enfilage outbox UPDATE (remplacement du push Supabase direct) ───────
  // L'ancien push asynchrone Supabase était fragile (pas de réessai en cas
  // d'échec réseau). Le pattern outbox garantit la synchro différée.
  if (target.sync_id) {
    // Payload t_users : login/password_hash/role obligatoires (NOT NULL côté Supabase,
    // voir invariant documenté sur enqueueOutbox — remplacement intégral du payload en
    // attente, jamais une fusion). `login` était déjà en scope (target.login) mais absent
    // du payload — oubli corrigé ici.
    enqueueOutbox(target.sync_id, 't_users', 'UPDATE', {
      sync_id: target.sync_id,
      login: target.login,
      password_hash: hash,
      role: target.role,
      updated_at: new Date().toISOString()
    });
    if (networkMonitor.getState() === 'ONLINE') {
      scheduleOutboxProcessing();
    }
  }

  return { success: true, temporaryPassword: newPasswordPlain };
}

export function updateSelfProfile(userId: number, data: { nom_user?: string; prenom_user?: string; email?: string; telephone?: string; password?: string; login?: string }): { success: boolean } {
  const db = getDatabase()!;

  const user = db.prepare('SELECT role, sync_id, login, password_hash FROM t_users WHERE id_user = ?').get(userId) as { role: string; sync_id: string; login: string; password_hash: string } | undefined;
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

  // Modification de l'identifiant de connexion (login) : réservée au rôle
  // ADMINISTRATEUR_SITE, ne jamais faire confiance au seul filtrage visuel du
  // renderer. Validation d'unicité obligatoire avant écriture pour éviter une
  // erreur SQLite brute (`UNIQUE constraint failed`) non gérée côté UI.
  if (data.login !== undefined) {
    if (user.role !== 'ADMINISTRATEUR_SITE') {
      throw new Error("Seul un Administrateur de Site peut modifier son identifiant de connexion.");
    }
    const newLogin = data.login.trim();
    if (!newLogin) {
      throw new Error("L'identifiant de connexion ne peut pas être vide.");
    }
    if (newLogin !== user.login) {
      const collision = db.prepare('SELECT id_user FROM t_users WHERE login = ? AND id_user != ?').get(newLogin, userId);
      if (collision) {
        throw new Error("Cet identifiant est déjà utilisé par un autre compte.");
      }
      updateData.login = newLogin;
    }
  }

  const allowedSelfProfileColumns = ['nom_user', 'prenom_user', 'email', 'telephone', 'password_hash', 'login'];
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
    // Payload t_users : login/password_hash/role obligatoires (NOT NULL côté Supabase,
    // voir invariant documenté sur enqueueOutbox — remplacement intégral du payload en
    // attente, jamais une fusion). role et login déjà disponibles via `user` ; password_hash
    // ajouté ici via `user.password_hash` pour couvrir le cas où l'utilisateur ne change pas
    // son mot de passe dans cet appel (updateData ne le contient alors pas). Le spread
    // `...updateData` prime sur ces valeurs de repli lorsque le champ a réellement changé.
    const outboxPayload: Record<string, unknown> = {
      sync_id: user.sync_id,
      login: user.login,
      password_hash: user.password_hash,
      role: user.role,
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
  if (!supabase) {
    log.warn('[pullAgentsFromCloud] Client Supabase non disponible.');
    return { success: false, count: 0, message: 'Client Supabase non disponible.' };
  }

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

    // Récupérer les rôles multiples pour ces agents
    const syncIds = cloudUsers.map(u => u.sync_id).filter(id => id);
    let cloudRoles: any[] = [];
    if (syncIds.length > 0) {
      const { data: rolesData, error: rolesError } = await supabase
        .from('t_user_roles')
        .select('user_sync_id, role')
        .in('user_sync_id', syncIds);

      if (!rolesError && rolesData) {
        cloudRoles = rolesData;
      } else if (rolesError) {
        log.warn(`[pullAgentsFromCloud] Erreur lors de la récupération des rôles multiples : ${rolesError.message}`);
      }
    }

    // Grouper les rôles par user_sync_id
    const rolesMap = new Map<string, string[]>();
    for (const r of cloudRoles) {
      const roles = rolesMap.get(r.user_sync_id) || [];
      roles.push(r.role);
      rolesMap.set(r.user_sync_id, roles);
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
          'OPERATEUR_LOGISTIQUE', 'OPERATEUR_INVENTAIRE', 'OPERATEUR_APUREMENT'
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

        // --- Synchronisation des multi-rôles ---
        if (u.sync_id) {
          const cloudRolesForUser = rolesMap.get(u.sync_id);
          if (cloudRolesForUser && cloudRolesForUser.length > 0) {
            const localUser = db.prepare('SELECT id_user FROM t_users WHERE login = ?').get(u.login) as { id_user: number } | undefined;
            if (localUser) {
              db.prepare('DELETE FROM t_user_roles WHERE id_user = ?').run(localUser.id_user);
              const insertRoleStmt = db.prepare('INSERT INTO t_user_roles (id_user, role) VALUES (?, ?)');
              for (const r of cloudRolesForUser) {
                insertRoleStmt.run(localUser.id_user, r);
              }
            }
          }
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

