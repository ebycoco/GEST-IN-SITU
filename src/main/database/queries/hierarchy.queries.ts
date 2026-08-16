import { getDatabase } from '../connection';
import { hashPassword, verifyPassword } from '../../auth/local-auth';
import { v4 as uuidv4 } from 'uuid';
import { enqueueOutbox, scheduleOutboxProcessing, cancelPendingInsert } from '../../sync/outbox.service';
import { networkMonitor } from '../../sync/network-monitor';
import { insertAuditLog } from './audit.queries';
import log from 'electron-log';

// Cache du schéma de t_centres pour éviter de répéter PRAGMA table_info à chaque appel
// Cache du schéma de t_centres pour éviter de répéter PRAGMA table_info à chaque appel
let _centresColumns: Set<string> | null = null;
function getCentresColumns(): Set<string> {
  if (!_centresColumns) {
    const db = getDatabase()!;
    let info = db.prepare("PRAGMA table_info(t_centres)").all() as { name: string }[];
    let colSet = new Set(info.map(c => c.name));
    if (!colSet.has('updated_at') || !colSet.has('is_dirty')) {
      try {
        if (!colSet.has('is_dirty')) db.exec("ALTER TABLE t_centres ADD COLUMN is_dirty INTEGER DEFAULT 0;");
        if (!colSet.has('updated_at')) db.exec("ALTER TABLE t_centres ADD COLUMN updated_at TEXT;");
        info = db.prepare("PRAGMA table_info(t_centres)").all() as { name: string }[];
        colSet = new Set(info.map(c => c.name));
        log.info('[hierarchy.queries][auto-heal] Colonnes updated_at/is_dirty ajoutées à t_centres.');
      } catch (e: any) {
        log.warn('[hierarchy.queries][auto-heal] Erreur ajout colonnes sur t_centres:', e.message);
      }
    }
    _centresColumns = colSet;
    log.info('[hierarchy.queries][cache] PRAGMA table_info(t_centres) chargé en cache. Colonnes:', [..._centresColumns].join(', '));
  }
  return _centresColumns;
}

let _sitesColumns: Set<string> | null = null;
function getSitesColumns(): Set<string> {
  if (!_sitesColumns) {
    const db = getDatabase()!;
    let info = db.prepare("PRAGMA table_info(t_sites)").all() as { name: string }[];
    let colSet = new Set(info.map(c => c.name));
    if (!colSet.has('updated_at') || !colSet.has('is_dirty')) {
      try {
        if (!colSet.has('is_dirty')) db.exec("ALTER TABLE t_sites ADD COLUMN is_dirty INTEGER DEFAULT 0;");
        if (!colSet.has('updated_at')) db.exec("ALTER TABLE t_sites ADD COLUMN updated_at TEXT;");
        info = db.prepare("PRAGMA table_info(t_sites)").all() as { name: string }[];
        colSet = new Set(info.map(c => c.name));
        log.info('[hierarchy.queries][auto-heal] Colonnes updated_at/is_dirty ajoutées à t_sites.');
      } catch (e: any) {
        log.warn('[hierarchy.queries][auto-heal] Erreur ajout colonnes sur t_sites:', e.message);
      }
    }
    _sitesColumns = colSet;
    log.info('[hierarchy.queries][cache] PRAGMA table_info(t_sites) chargé en cache. Colonnes:', [..._sitesColumns].join(', '));
  }
  return _sitesColumns;
}

// Invalider le cache après migration ou modification de schéma
export function invalidateCentresColumnsCache(): void { _centresColumns = null; _sitesColumns = null; }

export function getSites() {
  const db = getDatabase()!;
  return db.prepare('SELECT * FROM t_sites ORDER BY nom').all();
}

export function getSiteById(id: number) {
  const db = getDatabase()!;
  return db.prepare('SELECT * FROM t_sites WHERE id = ?').get(id) as any;
}

export function getCentreById(id: number) {
  const db = getDatabase()!;
  return db.prepare('SELECT * FROM t_centres WHERE id = ?').get(id) as any;
}

export function getCentres(siteId?: number) {
  const db = getDatabase()!;
  let rows: any[];
  if (siteId) {
    rows = db.prepare(`
      SELECT c.*, s.nom as site_nom 
      FROM t_centres c 
      LEFT JOIN t_sites s ON c.site_id = s.id 
      WHERE c.site_id = ? 
      ORDER BY c.nom
    `).all(siteId);
  } else {
    rows = db.prepare(`
      SELECT c.*, s.nom as site_nom 
      FROM t_centres c 
      LEFT JOIN t_sites s ON c.site_id = s.id 
      ORDER BY s.nom, c.nom
    `).all();
  }

  // Vérifier les doublons de sync_id pour le log de validation exigé
  const seenSyncIds = new Set<string>();
  let hasDuplicates = false;
  for (const r of rows) {
    if (r.sync_id) {
      if (seenSyncIds.has(r.sync_id)) {
        hasDuplicates = true;
      }
      seenSyncIds.add(r.sync_id);
    }
  }
  if (!hasDuplicates) {
    log.info("Aucun doublon trouvé dans la requête de rendu");
  } else {
    log.warn("Attention: Doublons logiques détectés dans getCentres");
  }

  return rows;
}

export function getCentresWithPrefixes(siteId: number) {
  const db = getDatabase()!;
  return db.prepare(`
    SELECT id, site_id, nom, prefixe_rangement, numero 
    FROM t_centres 
    WHERE site_id = ?
    ORDER BY numero ASC, id ASC
  `).all(siteId) as any[];
}

export function getPostes(centreId?: number) {
  const db = getDatabase()!;
  if (centreId) {
    return db.prepare("SELECT * FROM t_postes WHERE centre_id = ? ORDER BY nom").all(centreId);
  }
  return db.prepare("SELECT * FROM t_postes ORDER BY nom").all();
}

export function createSite(data: { nom: string; code: string; max_centres: number; expiry_date?: string | null; is_permanent?: number; admin: { nom: string; login: string; password_hash: string }; sync_id?: string }) {
  const db = getDatabase()!;
  // L'UUID du site est généré ici et utilisé comme clé d'idempotence pour l'outbox.
  // Un même UUID = une seule entrée dans t_outbox, même en cas de double appel.
  const siteSyncId = data.sync_id || uuidv4();

  const transaction = db.transaction(() => {
    // ── 1. Insertion locale immédiate (toujours, online ET offline) ──────────
    const siteResult = db.prepare(`
      INSERT INTO t_sites (nom, code, is_active, max_centres, sync_id, expiry_date, is_permanent)
      VALUES (?, ?, 1, ?, ?, ?, ?)
    `).run(data.nom, data.code, data.max_centres, siteSyncId, data.expiry_date || null, data.is_permanent || 0);

    const siteId = siteResult.lastInsertRowid as number;

    // ── 2. Insertion de l'admin du site ──────────────────────────────────────
    const hash = hashPassword(data.admin.password_hash);
    const userSyncId = uuidv4();
    db.prepare(`
      INSERT INTO t_users (login, password_hash, role, nom_user, prenom_user, statut_actif, site_id, centre_id, sync_id, is_dirty)
      VALUES (?, ?, 'ADMINISTRATEUR_SITE', ?, '', 1, ?, NULL, ?, 1)
    `).run(data.admin.login, hash, data.admin.nom, siteId, userSyncId);

    // ── 3. Enfilage dans t_outbox (idempotent via UUID) ──────────────────────
    // Le site et son admin sont enfilés séparément pour permettre
    // un rejouer granulaire en cas d'erreur partielle.
    enqueueOutbox(siteSyncId, 't_sites', 'INSERT', {
      sync_id: siteSyncId,
      nom: data.nom,
      code: data.code,
      is_active: 1,
      max_centres: data.max_centres,
      expiry_date: data.expiry_date || null,
      is_permanent: data.is_permanent || 0
    });

    enqueueOutbox(userSyncId, 't_users', 'INSERT', {
      sync_id: userSyncId,
      login: data.admin.login,
      password_hash: hash,
      role: 'ADMINISTRATEUR_SITE',
      nom_user: data.admin.nom,
      prenom_user: '',
      statut_actif: 1,
      site_id: siteId,
      centre_id: null
    });

    return siteResult;
  });
  const siteResult = transaction();

  // ── 4. Déclenchement immédiat si online (hors transaction SQLite) ─────────
  // scheduleOutboxProcessing utilise setImmediate → non bloquant pour l'UI.
  // En cas d'offline, les entrées restent PENDING et seront traitées
  // dès le prochain retour réseau via handleNetworkChange.
  if (networkMonitor.getState() === 'ONLINE') {
    scheduleOutboxProcessing();
  }

  return siteResult;
}

export function updateSite(id: number, data: { nom?: string; code?: string; max_centres?: number; is_active?: number; expiry_date?: string | null; is_permanent?: number }) {
  const db = getDatabase()!;
  log.info(`[hierarchy.queries][DIAGNOSTIC] updateSite appelé pour id=${id}, data=${JSON.stringify(data)}`);

  // Récupérer le sync_id du site avant mise à jour (nécessaire pour l'outbox)
  let site = db.prepare('SELECT sync_id FROM t_sites WHERE id = ?').get(id) as { sync_id: string | null } | undefined;
  log.info(`[hierarchy.queries][DIAGNOSTIC] sync_id initial pour site id=${id} : ${site?.sync_id}`);
  
  if (!site || !site.sync_id) {
    log.warn(`[hierarchy.queries][Outbox] sync_id absent pour le site ${id}. Génération et liaison forcée d'un nouveau sync_id.`);
    const newSyncId = uuidv4();
    try {
      db.prepare('UPDATE t_sites SET sync_id = ? WHERE id = ?').run(newSyncId, id);
      site = { sync_id: newSyncId };
      log.info(`[hierarchy.queries][Outbox] Liaison forcée réussie. Nouveau sync_id pour le site ${id} : ${newSyncId}`);
    } catch (dbErr: any) {
      log.error(`[hierarchy.queries][Outbox] Échec de la liaison forcée de sync_id pour le site ${id} :`, dbErr);
      throw new Error(`Impossible de modifier le site : sync_id absent et échec de la liaison forcée.`);
    }
  }

  const siteSyncId = site.sync_id;
  if (!siteSyncId) {
    throw new Error(`Modification bloquée: sync_id invalide ou absent pour le site ${id}.`);
  }

  const sets: string[] = [];
  const params: unknown[] = [];

  if (data.nom !== undefined)          { sets.push('nom = ?');          params.push(data.nom); }
  if (data.code !== undefined)         { sets.push('code = ?');         params.push(data.code); }
  if (data.max_centres !== undefined)  { sets.push('max_centres = ?');  params.push(data.max_centres); }
  if (data.is_active !== undefined)    { sets.push('is_active = ?');    params.push(data.is_active); }
  if (data.expiry_date !== undefined)  { sets.push('expiry_date = ?');  params.push(data.expiry_date); }
  if (data.is_permanent !== undefined) { sets.push('is_permanent = ?'); params.push(data.is_permanent); }

  if (sets.length === 0) return null;
  const siteColumns = getSitesColumns();
  if (siteColumns.has('updated_at')) sets.push("updated_at = datetime('now')");
  if (siteColumns.has('is_dirty')) sets.push("is_dirty = 1");
  params.push(id);

  // ── 1. Mise à jour locale immédiate ───────────────────────────────────────────
  let result;
  try {
    result = db.prepare(`UPDATE t_sites SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  } catch (err: any) {
    console.error("ERREUR SQL:", err);
    throw err;
  }

  if (result.changes === 0) return result;

  // ── 2. Construction du payload réfléchissant l'état actuel après update ───────
  let updatedSite;
  try {
    updatedSite = db.prepare('SELECT id, nom, code, max_centres, is_active, expiry_date, is_permanent FROM t_sites WHERE id = ?').get(id) as any;
  } catch (err: any) {
    console.error("ERREUR SQL:", err);
    throw err;
  }
  const outboxPayload: Record<string, unknown> = { sync_id: siteSyncId, ...updatedSite };

  // ── 3. Enfilage dans t_outbox (UPDATE idempotent via sync_id) ──────────────
  // L'UUID sync_id existant du site est utilisé comme clé de l'entrée outbox,
  // garantissant qu'un seul UPDATE est traité même en cas d'appels multiples.
  enqueueOutbox(siteSyncId, 't_sites', 'UPDATE', outboxPayload);

  if (networkMonitor.getState() === 'ONLINE') {
    scheduleOutboxProcessing();
  }

  return result;
}

export function deleteSite(id: number) {
  const db = getDatabase()!;

  // ── 0. Lecture du sync_id avant suppression (nécessaire pour outbox) ──────
  // Si le site n'a pas de sync_id, il n'a jamais été synchronisé ; on peut
  // supprimer localement sans envoyer quoi que ce soit vers Supabase.
  const site = db.prepare('SELECT sync_id FROM t_sites WHERE id = ?').get(id) as { sync_id: string | null } | undefined;
  const siteSyncId = site?.sync_id ?? null;

  // ── Comptes SUPER ADMIN rattachés à ce site ────────────────────────────────
  // deleteSite() exclut volontairement ce rôle du DELETE de t_users (étape 3
  // ci-dessous) : un SUPER ADMIN n'est jamais supprimé par une purge de site.
  // Sans neutralisation, ces comptes survivraient avec un site_id/centre_id/
  // poste_id pointant vers des lignes t_sites/t_centres/t_postes supprimées
  // plus bas — exactement les orphelins constatés en production, cause racine
  // de l'échec systématique de foreign_key_check(t_users) rencontré par
  // migrateV64 (voir schema.ts). On neutralise (jamais on ne supprime le
  // compte) : SUPER ADMIN n'est pas cloisonné par site/centre dans la logique
  // métier (cf. ipc/handlers.ts, qui ignore systématiquement site_id/centre_id
  // pour ce rôle), cette neutralisation est donc sans impact fonctionnel.
  const affectedSuperAdmins = db.prepare(
    "SELECT sync_id, login, password_hash FROM t_users WHERE site_id = ? AND role = 'SUPER ADMIN'"
  ).all(id) as { sync_id: string | null; login: string; password_hash: string }[];

  const transaction = db.transaction(() => {
    // 1. Delete Cards
    const cartesCount = db.prepare('DELETE FROM t_cartes WHERE site_id = ?').run(id).changes;

    // 2. Delete Logs
    const logsCount1 = db.prepare('DELETE FROM t_logs WHERE id_user IN (SELECT id_user FROM t_users WHERE site_id = ?)').run(id).changes;
    let logsCount2 = 0;
    try { logsCount2 = db.prepare('DELETE FROM t_logs WHERE site_id = ?').run(id).changes; } catch (_e) {}

    // 3. Delete Users (hors SUPER ADMIN)
    const usersCount = db.prepare("DELETE FROM t_users WHERE site_id = ? AND role != 'SUPER ADMIN'").run(id).changes;

    // 3bis. Neutraliser (jamais supprimer) les comptes SUPER ADMIN restants
    // rattachés à ce site — cf. commentaire détaillé plus haut.
    if (affectedSuperAdmins.length > 0) {
      db.prepare(`
        UPDATE t_users
        SET site_id = NULL, centre_id = NULL, poste_id = NULL, is_dirty = 1, updated_at = datetime('now')
        WHERE site_id = ? AND role = 'SUPER ADMIN'
      `).run(id);
    }

    // 4. Delete Postes
    const postesCount = db.prepare('DELETE FROM t_postes WHERE centre_id IN (SELECT id FROM t_centres WHERE site_id = ?)').run(id).changes;

    // 5. Delete Centres
    const centresCount = db.prepare('DELETE FROM t_centres WHERE site_id = ?').run(id).changes;

    // 6. Delete Temp Imports
    const tempCount = db.prepare('DELETE FROM t_import_temp WHERE site_id = ?').run(id).changes;

    // 7. Finally Delete Site
    const res = db.prepare('DELETE FROM t_sites WHERE id = ?').run(id);

    insertAuditLog(
      'SUPER ADMIN',
      'VALIDATION',
      `[PURGE SITE] Site ID: ${id} supprimé. Détail : ${cartesCount} cartes, ${usersCount} agents, ${centresCount} centres, ${postesCount} postes, ${logsCount1 + logsCount2} logs, ${tempCount} imports temp${affectedSuperAdmins.length > 0 ? `, ${affectedSuperAdmins.length} SUPER ADMIN neutralisé(s)` : ''}.`
    );

    return res;
  });
  const result = transaction();

  if (affectedSuperAdmins.length > 0) {
    log.warn(`[deleteSite] ${affectedSuperAdmins.length} compte(s) SUPER ADMIN neutralisé(s) (site_id/centre_id/poste_id → NULL) suite à la suppression du site ID ${id} : ${affectedSuperAdmins.map(a => a.login).join(', ')}`);
  }

  // ── Enfilage outbox (hors transaction SQLite) ─────────────────────────────
  let anyEnqueued = false;
  if (siteSyncId) {
    // Si un INSERT était encore PENDING (création non synchronisée), on l'annule.
    // Dans ce cas, aucun DELETE n'est enfié car Supabase ne connaît pas encore l'entité.
    const wasLocalOnly = cancelPendingInsert(siteSyncId, 't_sites');
    if (!wasLocalOnly) {
      // L'entité était déjà synchronisée → envoyer un DELETE à Supabase
      enqueueOutbox(siteSyncId, 't_sites', 'DELETE', { sync_id: siteSyncId });
      anyEnqueued = true;
    }
  }

  // Répercuter la neutralisation des comptes SUPER ADMIN vers Supabase.
  // Payload t_users : login/password_hash/role obligatoires (NOT NULL côté Supabase, voir
  // invariant documenté sur enqueueOutbox — remplacement intégral du payload en attente,
  // jamais une fusion). role fixé en dur : contraint par le WHERE ci-dessus (role = 'SUPER ADMIN').
  for (const admin of affectedSuperAdmins) {
    if (!admin.sync_id) continue;
    enqueueOutbox(admin.sync_id, 't_users', 'UPDATE', {
      sync_id: admin.sync_id,
      login: admin.login,
      password_hash: admin.password_hash,
      role: 'SUPER ADMIN',
      site_id: null,
      centre_id: null,
      poste_id: null,
      updated_at: new Date().toISOString()
    });
    anyEnqueued = true;
  }

  if (anyEnqueued && networkMonitor.getState() === 'ONLINE') {
    scheduleOutboxProcessing();
  }

  return result;
}

export function verifySuperAdminPassword(password: string): boolean {
  const db = getDatabase()!;
  const admin = db.prepare("SELECT password_hash FROM t_users WHERE role = 'SUPER ADMIN'").get() as any;
  if (!admin) return false;

  const hash = admin.password_hash;
  // Sécurité : seule une comparaison bcrypt est acceptée. Un hash legacy non-bcrypt (donnée mal
  // migrée) est traité comme invalide plutôt que comparé en clair — le mot de passe doit être
  // réinitialisé via le flux dédié.
  if (!hash || !hash.startsWith('$2')) {
    log.warn('[SECURITY] verifySuperAdminPassword : hash non-bcrypt détecté, vérification refusée.');
    return false;
  }
  return verifyPassword(password, hash);
}

export function verifyUserPassword(login: string, password: string): boolean {
  const db = getDatabase()!;
  const user = db.prepare("SELECT password_hash FROM t_users WHERE login = ?").get(login) as any;
  if (!user) {
    return false;
  }

  const hash = user.password_hash;
  // Sécurité : idem, aucun fallback en clair.
  if (!hash || !hash.startsWith('$2')) {
    log.warn(`[SECURITY] verifyUserPassword : hash non-bcrypt détecté pour '${login}', vérification refusée.`);
    return false;
  }
  return verifyPassword(password, hash);
}

export function getSitesSummary() {
  const db = getDatabase()!;
  return db.prepare(`
    SELECT s.*, 
           s.code as code_site,
           (SELECT COUNT(*) FROM t_centres WHERE site_id = s.id) as total_centres,
           (SELECT COUNT(*) FROM t_cartes WHERE site_id = s.id) as total_cartes,
           (SELECT login FROM t_users WHERE site_id = s.id AND role = 'ADMINISTRATEUR_SITE' LIMIT 1) as admin_login
    FROM t_sites s
    ORDER BY s.nom
  `).all();
}

export function resetSiteAdminPassword(siteId: number, newPasswordPlain: string) {
  const db = getDatabase()!;
  const hash = hashPassword(newPasswordPlain);

  // ── 1. Mise à jour locale immédiate ───────────────────────────────────────────
  const result = db.prepare(`
    UPDATE t_users 
    SET password_hash = ?, is_dirty = 1, updated_at = datetime('now')
    WHERE site_id = ? AND role = 'ADMINISTRATEUR_SITE'
  `).run(hash, siteId);

  // ── 2. Enfilage outbox pour chaque admin concerné ─────────────────────────
  // On récupère les sync_id des admins mis à jour pour enreg dans la file.
  // Remplacement du push Supabase direct (fragile) par le pattern outbox résilient.
  if (result.changes > 0) {
    const admins = db.prepare(
      "SELECT sync_id, login FROM t_users WHERE site_id = ? AND role = 'ADMINISTRATEUR_SITE'"
    ).all(siteId) as { sync_id: string; login: string }[];

    for (const admin of admins) {
      if (!admin.sync_id) continue;
      // Payload t_users : login/password_hash/role obligatoires (NOT NULL côté Supabase,
      // voir invariant documenté sur enqueueOutbox — remplacement intégral du payload en
      // attente, jamais une fusion). role fixé en dur : contraint par le WHERE ci-dessus
      // (role = 'ADMINISTRATEUR_SITE').
      enqueueOutbox(admin.sync_id, 't_users', 'UPDATE', {
        sync_id: admin.sync_id,
        login: admin.login,
        password_hash: hash,
        role: 'ADMINISTRATEUR_SITE',
        updated_at: new Date().toISOString()
      });
    }

    if (networkMonitor.getState() === 'ONLINE') {
      scheduleOutboxProcessing();
    }
  }

  return result;
}

export function createCentre(data: { site_id: number; nom: string; code?: string; lieu?: string; prefixe_rangement?: string; sync_id?: string; numero?: number }) {
  const db = getDatabase()!;

  // Vérification du quota avant toute opération
  const site = db.prepare('SELECT max_centres FROM t_sites WHERE id = ?').get(data.site_id) as { max_centres: number };
  const count = db.prepare('SELECT COUNT(*) as count FROM t_centres WHERE site_id = ?').get(data.site_id) as { count: number };

  if (count.count >= site.max_centres) {
    throw new Error(`Quota de centres atteint (${site.max_centres}). Contactez le Super Admin.`);
  }

  // UUID généré ici = clé d'idempotence pour l'outbox (une seule entrée possible par centre)
  const centreSyncId = data.sync_id || uuidv4();

  // Vérification de l'existence des colonnes en base (cache module-level)
  const centreColumns = getCentresColumns();
  const hasColumn = (colName: string) => centreColumns.has(colName);

  const columns = ['site_id', 'nom', 'sync_id'];
  const values: (string | number | null)[] = [data.site_id, data.nom, centreSyncId];

  if (hasColumn('numero')) {
    columns.push('numero');
    values.push(data.numero !== undefined ? data.numero : 1);
  }
  if (hasColumn('code') && data.code !== undefined) {
    columns.push('code');
    values.push(data.code || null);
  }
  if (hasColumn('lieu') && data.lieu !== undefined) {
    columns.push('lieu');
    values.push(data.lieu || null);
  }
  if (hasColumn('prefixe_rangement') && data.prefixe_rangement !== undefined) {
    columns.push('prefixe_rangement');
    values.push(data.prefixe_rangement || null);
  }

  const placeholders = columns.map(() => '?').join(', ');

  // ── 1. Insertion locale immédiate (toujours, online ET offline) ──────────
  const result = db.prepare(`
    INSERT INTO t_centres (${columns.join(', ')})
    VALUES (${placeholders})
  `).run(...values);

  const centreId = result.lastInsertRowid as number;

  // ── 2. Construction du payload outbox ────────────────────────────────────
  const outboxPayload: Record<string, unknown> = {
    sync_id: centreSyncId,
    site_id: data.site_id,
    nom: data.nom,
    numero: data.numero !== undefined ? data.numero : 1
  };
  if (data.lieu !== undefined)               outboxPayload.lieu = data.lieu || null;
  if (data.prefixe_rangement !== undefined)  outboxPayload.prefixe_rangement = data.prefixe_rangement || null;

  // ── 3. Enfilage dans t_outbox (idempotent via UUID) ──────────────────────
  enqueueOutbox(centreSyncId, 't_centres', 'INSERT', outboxPayload);

  // ── 4. Déclenchement immédiat si online (via setImmediate → non bloquant) ─
  if (networkMonitor.getState() === 'ONLINE') {
    scheduleOutboxProcessing();
  }

  return result;
}

export function updateCentre(id: number, data: { nom?: string; code?: string; lieu?: string; prefixe_rangement?: string; numero?: number }) {
  const db = getDatabase()!;
  log.info(`[hierarchy.queries][DIAGNOSTIC] updateCentre appelé pour id=${id}, data=${JSON.stringify(data)}`);

  // ── 0. Lecture du sync_id avant modification ──────────────────────────────
  let centre = db.prepare('SELECT sync_id, site_id FROM t_centres WHERE id = ?').get(id) as { sync_id: string | null; site_id: number } | undefined;
  log.info(`[hierarchy.queries][DIAGNOSTIC] sync_id initial pour centre id=${id} : ${centre?.sync_id}`);
  
  if (!centre || !centre.sync_id) {
    log.warn(`[hierarchy.queries][Outbox] sync_id absent pour le centre ${id}. Génération et liaison forcée d'un nouveau sync_id.`);
    const newSyncId = uuidv4();
    try {
      db.prepare('UPDATE t_centres SET sync_id = ? WHERE id = ?').run(newSyncId, id);
      const siteId = centre ? centre.site_id : 1;
      centre = { sync_id: newSyncId, site_id: siteId };
      log.info(`[hierarchy.queries][Outbox] Liaison forcée réussie. Nouveau sync_id pour le centre ${id} : ${newSyncId}`);
    } catch (dbErr: any) {
      log.error(`[hierarchy.queries][Outbox] Échec de la liaison forcée de sync_id pour le centre ${id} :`, dbErr);
      throw new Error(`Impossible de modifier le centre : sync_id absent et échec de la liaison forcée.`);
    }
  }

  const centreSyncId = centre.sync_id;
  if (!centreSyncId) {
    throw new Error(`Modification bloquée: sync_id invalide ou absent pour le centre ${id}.`);
  }

  const sets: string[] = [];
  const params: unknown[] = [];

  // Vérification de l'existence des colonnes en base (cache module-level)
  const centreColumns = getCentresColumns();
  const hasColumn = (colName: string) => centreColumns.has(colName);

  if (data.nom !== undefined)                                    { sets.push('nom = ?');                params.push(data.nom); }
  if (data.numero !== undefined && hasColumn('numero'))          { sets.push('numero = ?');             params.push(data.numero); }
  if (data.code !== undefined && hasColumn('code'))              { sets.push('code = ?');               params.push(data.code); }
  if (data.lieu !== undefined && hasColumn('lieu'))              { sets.push('lieu = ?');               params.push(data.lieu); }
  if (data.prefixe_rangement !== undefined && hasColumn('prefixe_rangement')) {
    sets.push('prefixe_rangement = ?');
    params.push(data.prefixe_rangement);
  }

  if (sets.length === 0) return null;
  if (hasColumn('updated_at')) sets.push("updated_at = datetime('now')");
  if (hasColumn('is_dirty')) sets.push("is_dirty = 1");
  params.push(id);

  // ── 1. Mise à jour locale immédiate ───────────────────────────────────────────
  let result;
  try {
    result = db.prepare(`UPDATE t_centres SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  } catch (err: any) {
    console.error("ERREUR SQL:", err);
    throw err;
  }

  if (result.changes === 0) return result;

  // ── 2. Construction du payload outbox (réfléchit l'état après modification) ──
  let updatedCentre;
  try {
    updatedCentre = db.prepare('SELECT nom, site_id, numero, code, lieu, prefixe_rangement FROM t_centres WHERE id = ?').get(id) as any;
  } catch (err: any) {
    console.error("ERREUR SQL:", err);
    throw err;
  }
  const outboxPayload: Record<string, unknown> = { sync_id: centreSyncId, ...updatedCentre };
  delete outboxPayload.code;

  // ── 3. Enfilage outbox (UPDATE idempotent via sync_id du centre) ───────────
  enqueueOutbox(centreSyncId, 't_centres', 'UPDATE', outboxPayload);

  if (networkMonitor.getState() === 'ONLINE') {
    scheduleOutboxProcessing();
  }

  return result;
}

export function createPoste(data: { centre_id: number; nom: string; code?: string; sync_id?: string }) {
  const db = getDatabase()!;
  const sync_id = data.sync_id || require('uuid').v4();
  const result = db.prepare(`
    INSERT INTO t_postes (centre_id, nom, code, sync_id)
    VALUES (?, ?, ?, ?)
  `).run(data.centre_id, data.nom, data.code || null, sync_id);

  enqueueOutbox(sync_id, 't_postes', 'INSERT', {
    sync_id,
    centre_id: data.centre_id,
    nom: data.nom,
    code: data.code || null
  });

  if (networkMonitor.getState() === 'ONLINE') {
    scheduleOutboxProcessing();
  }

  return result;
}

export function deleteCentre(id: number) {
  const db = getDatabase()!;

  // ── 0. Lecture du sync_id avant suppression ───────────────────────────────
  const centre = db.prepare('SELECT sync_id, nom FROM t_centres WHERE id = ?').get(id) as { sync_id: string | null; nom: string } | undefined;
  if (!centre) return { changes: 0 };
  const centreSyncId = centre.sync_id;

  // ── Utilisateurs rattachés à ce centre ─────────────────────────────────────
  // Jusqu'ici, deleteCentre() ne touchait JAMAIS t_users : un compte
  // ADMIN_CENTRE/opérateur rattaché à ce centre survivait avec un centre_id
  // (et poste_id) pointant vers une ligne supprimée — même cause racine
  // d'orphelins que dans deleteSite (cf. migrateV64 dans schema.ts). Choix
  // volontairement le MOINS destructeur (décision produit ambiguë entre
  // supprimer les comptes, comme deleteSite le fait pour les non-SUPER-ADMIN
  // d'un site, ou simplement neutraliser) : on neutralise à NULL sans jamais
  // supprimer de compte, ce qui préserve l'accès de l'utilisateur au niveau du
  // site — à valider avec l'utilisateur si le comportement destructeur
  // (suppression) était en réalité attendu.
  const affectedUsers = db.prepare(
    "SELECT sync_id, login, password_hash, role FROM t_users WHERE centre_id = ?"
  ).all(id) as { sync_id: string | null; login: string; password_hash: string; role: string }[];

  // Trace d'audit
  insertAuditLog(
    'ADMIN',
    'VALIDATION',
    `[SUPPRESSION] Par ADMIN sur t_centres (ID: ${id})${affectedUsers.length > 0 ? `. ${affectedUsers.length} compte(s) utilisateur neutralisé(s) (centre_id/poste_id -> NULL)` : ''}`
  );

  // Suppression physique immédiate locale (l'outbox conserve le sync_id pour
  // Supabase) + neutralisation des comptes rattachés, dans une transaction
  // unique pour garantir l'atomicité (auparavant, ces DELETE n'étaient pas du
  // tout enveloppés dans une transaction).
  const transaction = db.transaction(() => {
    if (affectedUsers.length > 0) {
      db.prepare(`
        UPDATE t_users
        SET centre_id = NULL, poste_id = NULL, is_dirty = 1, updated_at = datetime('now')
        WHERE centre_id = ?
      `).run(id);
    }
    db.prepare('DELETE FROM t_postes WHERE centre_id = ?').run(id);
    return db.prepare('DELETE FROM t_centres WHERE id = ?').run(id);
  });
  const result = transaction();

  if (affectedUsers.length > 0) {
    log.warn(`[deleteCentre] ${affectedUsers.length} compte(s) utilisateur neutralisé(s) (centre_id/poste_id → NULL) suite à la suppression du centre ID ${id} : ${affectedUsers.map(u => u.login).join(', ')}`);
  }

  // ── Enfilage outbox (hors transaction SQLite) ─────────────────────────────
  let anyEnqueued = false;
  if (centreSyncId) {
    const wasLocalOnly = cancelPendingInsert(centreSyncId, 't_centres');
    if (!wasLocalOnly) {
      enqueueOutbox(centreSyncId, 't_centres', 'DELETE', { sync_id: centreSyncId });
      anyEnqueued = true;
    }
  }

  // Répercuter la neutralisation des comptes vers Supabase.
  // Payload t_users : login/password_hash/role obligatoires (NOT NULL côté Supabase, voir
  // invariant documenté sur enqueueOutbox — remplacement intégral du payload en attente,
  // jamais une fusion). Contrairement à deleteSite (role='SUPER ADMIN' contraint par le
  // WHERE), ici le rôle n'est PAS contraint (n'importe quel rôle peut être rattaché à un
  // centre) — jamais codé en dur, toujours lu depuis le SELECT ci-dessus.
  for (const u of affectedUsers) {
    if (!u.sync_id) continue;
    enqueueOutbox(u.sync_id, 't_users', 'UPDATE', {
      sync_id: u.sync_id,
      login: u.login,
      password_hash: u.password_hash,
      role: u.role,
      centre_id: null,
      poste_id: null,
      updated_at: new Date().toISOString()
    });
    anyEnqueued = true;
  }

  if (anyEnqueued && networkMonitor.getState() === 'ONLINE') {
    scheduleOutboxProcessing();
  }

  return result;
}

/**
 * ensureSyncIds - Correction préventive
 * Parcourt les centres et sites n'ayant pas de sync_id et tente de générer/lier un sync_id.
 */
export function ensureSyncIds(): void {
  const db = getDatabase()!;
  try {
    // 1. Corriger les sites sans sync_id
    const sitesWithoutSync = db.prepare("SELECT id, nom FROM t_sites WHERE sync_id IS NULL OR sync_id = ''").all() as { id: number; nom: string }[];
    if (sitesWithoutSync.length > 0) {
      log.info(`[hierarchy.queries][ensureSyncIds] ${sitesWithoutSync.length} site(s) sans sync_id détecté(s).`);
      const updateSiteStmt = db.prepare('UPDATE t_sites SET sync_id = ? WHERE id = ?');
      for (const s of sitesWithoutSync) {
        const newSyncId = uuidv4();
        updateSiteStmt.run(newSyncId, s.id);
        log.info(`[hierarchy.queries][ensureSyncIds] Site "${s.nom}" (id=${s.id}) lié à sync_id : ${newSyncId}`);
      }
    }

    // 2. Corriger les centres sans sync_id
    const centresWithoutSync = db.prepare("SELECT id, nom FROM t_centres WHERE sync_id IS NULL OR sync_id = ''").all() as { id: number; nom: string }[];
    if (centresWithoutSync.length > 0) {
      log.info(`[hierarchy.queries][ensureSyncIds] ${centresWithoutSync.length} centre(s) sans sync_id détecté(s).`);
      const updateCentreStmt = db.prepare('UPDATE t_centres SET sync_id = ? WHERE id = ?');
      for (const c of centresWithoutSync) {
        const newSyncId = uuidv4();
        updateCentreStmt.run(newSyncId, c.id);
        log.info(`[hierarchy.queries][ensureSyncIds] Centre "${c.nom}" (id=${c.id}) lié à sync_id : ${newSyncId}`);
      }
    }
  } catch (err: any) {
    log.error('[hierarchy.queries][ensureSyncIds] Échec lors de la correction préventive des sync_ids :', err);
  }
}

