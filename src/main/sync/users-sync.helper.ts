import type Database from 'better-sqlite3';
import log from 'electron-log';

/**
 * Helper pur-DB (LOT 2 / L2-1a) : upsert sécurisé d'UN utilisateur issu du cloud dans t_users.
 *
 * Aucun appelant branché pour l'instant. Ne lève jamais d'exception par ligne : toute erreur est
 * convertie en résultat `skipped_invalid` (la transaction de la ligne est annulée via savepoint,
 * les autres lignes d'un lot ne sont pas affectées). Ne journalise jamais password_hash.
 *
 * Le helper ne touche pas aux PRAGMA (inutilisables dans une transaction) : l'appelant décide.
 */

export const VALID_USER_ROLES: readonly string[] = [
  'SUPER ADMIN', 'ADMINISTRATEUR_SITE', 'ADMIN_CENTRE',
  'OPERATEUR_VERIFICATION', 'OPERATEUR_QUALITE', 'OPERATEUR_SAISIE',
  'OPERATEUR_LOGISTIQUE', 'OPERATEUR_INVENTAIRE', 'OPERATEUR_APUREMENT'
];

export interface CloudUserRow {
  login: string;
  password_hash: string;
  role: string;
  nom_user?: string | null;
  prenom_user?: string | null;
  site_id?: number | null;
  centre_id?: number | null;
  statut_actif?: number | null;
  sync_id: string;
  /** Rôles multiples cloud (t_user_roles.role). Absent = t_user_roles non remplacé (seul le rôle principal est garanti). */
  roles?: string[] | null;
}

export interface UpsertCloudUserOptions {
  /** true (défaut) : statut_actif = valeur cloud (0/1). false : forcé à 1 (ex. flux ne ramenant que les comptes actifs). */
  statutFromCloud?: boolean;
}

export type UpsertCloudUserAction =
  | 'inserted' | 'updated' | 'adopted' | 'renamed'
  | 'skipped_dirty' | 'skipped_pending_outbox' | 'skipped_deleted'
  | 'skipped_conflict' | 'skipped_invalid';

export interface UpsertCloudUserResult {
  action: UpsertCloudUserAction;
  id_user?: number;
  reason?: string;
}

interface LocalUserRow {
  id_user: number;
  login: string;
  role: string;
  site_id: number | null;
  centre_id: number | null;
  statut_actif: number | null;
  sync_id: string | null;
  is_dirty: number | null;
}

const LOCAL_COLS = 'id_user, login, role, site_id, centre_id, statut_actif, sync_id, is_dirty';

function hasPendingOutbox(db: Database.Database, syncId: string | null | undefined): boolean {
  if (!syncId) return false;
  const escaped = syncId.replace(/[\\%_]/g, c => '\\' + c);
  const row = db.prepare(
    `SELECT 1 FROM t_outbox
      WHERE status IN ('PENDING','ERROR')
        AND (id = ? OR id LIKE ? ESCAPE '\\')
      LIMIT 1`
  ).get(syncId, escaped + '\\_%');
  return !!row;
}

/** Vérifie les gardes « ligne locale intouchable ». Retourne un résultat de skip ou null. */
function guardLocalRow(db: Database.Database, local: LocalUserRow, cloudSyncId: string): UpsertCloudUserResult | null {
  if (local.statut_actif === -1 || local.is_dirty === -1) {
    return { action: 'skipped_deleted', id_user: local.id_user, reason: 'ligne locale supprimée (-1), jamais ressuscitée' };
  }
  if (local.is_dirty === 1) {
    return { action: 'skipped_dirty', id_user: local.id_user, reason: 'modification locale non synchronisée (is_dirty=1)' };
  }
  if (hasPendingOutbox(db, local.sync_id) || hasPendingOutbox(db, cloudSyncId)) {
    return { action: 'skipped_pending_outbox', id_user: local.id_user, reason: 'entrée t_outbox PENDING/ERROR pour ce compte' };
  }
  return null;
}

export function upsertCloudUser(
  db: Database.Database,
  cloudRow: CloudUserRow,
  opts: UpsertCloudUserOptions = {}
): UpsertCloudUserResult {
  const loginForLog = typeof cloudRow?.login === 'string' ? cloudRow.login : '?';
  try {
    // Un savepoint par ligne (db.transaction imbriqué) : un échec n'annule que cette ligne.
    const res = db.transaction((): UpsertCloudUserResult => doUpsert(db, cloudRow, opts))();
    if (res.action === 'skipped_conflict') {
      log.warn(`[users-sync.helper] Conflit sur "${loginForLog}" : ${res.reason}`);
    }
    return res;
  } catch (err: any) {
    log.warn(`[users-sync.helper] Ligne "${loginForLog}" en échec (ignorée) : ${err?.message || err}`);
    return { action: 'skipped_invalid', reason: `exception: ${err?.message || String(err)}` };
  }
}

function doUpsert(db: Database.Database, cloud: CloudUserRow, opts: UpsertCloudUserOptions): UpsertCloudUserResult {
  // ── Validation ──
  if (!cloud || typeof cloud.login !== 'string' || cloud.login.length === 0) {
    return { action: 'skipped_invalid', reason: 'login cloud vide' };
  }
  if (typeof cloud.sync_id !== 'string' || cloud.sync_id.length === 0) {
    return { action: 'skipped_invalid', reason: 'sync_id cloud absent' };
  }
  if (typeof cloud.password_hash !== 'string' || cloud.password_hash.length === 0) {
    return { action: 'skipped_invalid', reason: 'password_hash cloud absent' };
  }
  if (!VALID_USER_ROLES.includes(cloud.role)) {
    return { action: 'skipped_invalid', reason: `rôle cloud invalide "${cloud.role}"` };
  }
  if (cloud.statut_actif === -1) {
    return { action: 'skipped_deleted', reason: 'compte supprimé côté cloud (-1)' };
  }
  const statut = opts.statutFromCloud === false ? 1 : (cloud.statut_actif === 0 ? 0 : 1);

  // ── Recherche locale : sync_id d'abord, puis login exact ──
  const bySync = db.prepare(`SELECT ${LOCAL_COLS} FROM t_users WHERE sync_id = ? LIMIT 2`).all(cloud.sync_id) as LocalUserRow[];
  if (bySync.length > 1) {
    return { action: 'skipped_conflict', reason: `sync_id "${cloud.sync_id}" porté par plusieurs lignes locales` };
  }
  const byLogin = db.prepare(`SELECT ${LOCAL_COLS} FROM t_users WHERE login = ?`).get(cloud.login) as LocalUserRow | undefined;

  let target: LocalUserRow | null = null;
  let action: 'updated' | 'renamed' | 'adopted' = 'updated';

  if (bySync.length === 1) {
    target = bySync[0];
    const skip = guardLocalRow(db, target, cloud.sync_id);
    if (skip) return skip;
    if (target.login !== cloud.login) {
      if (byLogin && byLogin.id_user !== target.id_user) {
        return { action: 'skipped_conflict', id_user: target.id_user, reason: `renommage vers "${cloud.login}" impossible : login déjà détenu par une autre ligne locale` };
      }
      action = 'renamed';
    }
  } else if (byLogin) {
    if (byLogin.sync_id && byLogin.sync_id !== cloud.sync_id) {
      return { action: 'skipped_conflict', id_user: byLogin.id_user, reason: `login "${cloud.login}" local lié à un autre sync_id (${byLogin.sync_id} ≠ ${cloud.sync_id})` };
    }
    target = byLogin;
    const skip = guardLocalRow(db, target, cloud.sync_id);
    if (skip) return skip;
    action = 'adopted';
  }

  const siteExists = (id: unknown): boolean =>
    typeof id === 'number' && !!db.prepare('SELECT 1 FROM t_sites WHERE id = ?').get(id);
  const centreExists = (id: unknown): boolean =>
    typeof id === 'number' && !!db.prepare('SELECT 1 FROM t_centres WHERE id = ?').get(id);

  let idUser: number;
  let centreNote: string | undefined;

  if (target) {
    // SUPER ADMIN local jamais rétrogradé par une valeur cloud divergente.
    if (target.role === 'SUPER ADMIN' && cloud.role !== 'SUPER ADMIN') {
      return { action: 'skipped_conflict', id_user: target.id_user, reason: 'rétrogradation d\'un SUPER ADMIN local refusée' };
    }
    // centre : valeur cloud seulement si le centre existe localement, sinon on garde le local.
    let centreId: number | null = target.centre_id;
    if (cloud.centre_id == null) {
      centreId = null;
    } else if (centreExists(cloud.centre_id)) {
      centreId = cloud.centre_id;
    } else {
      centreNote = `centre ${cloud.centre_id} absent localement : centre local conservé`;
    }
    // site : logique existante (COALESCE) — jamais écrasé s'il est déjà renseigné localement.
    const siteId = target.site_id ?? (siteExists(cloud.site_id) ? (cloud.site_id as number) : null);

    db.prepare(`
      UPDATE t_users SET
        login = ?, password_hash = ?, role = ?, nom_user = ?, prenom_user = ?,
        statut_actif = ?, site_id = ?, centre_id = ?, sync_id = ?,
        is_dirty = 0, synced_at = datetime('now')
      WHERE id_user = ?
    `).run(
      cloud.login, cloud.password_hash, cloud.role, cloud.nom_user || '', cloud.prenom_user || '',
      statut, siteId, centreId, cloud.sync_id, target.id_user
    );
    idUser = target.id_user;
  } else {
    if (!siteExists(cloud.site_id)) {
      return { action: 'skipped_invalid', reason: `site ${cloud.site_id ?? 'NULL'} absent localement` };
    }
    let centreId: number | null = null;
    if (cloud.centre_id != null) {
      if (centreExists(cloud.centre_id)) centreId = cloud.centre_id;
      else centreNote = `centre ${cloud.centre_id} absent localement : centre_id NULL`;
    }
    const res = db.prepare(`
      INSERT INTO t_users
        (login, password_hash, role, nom_user, prenom_user, statut_actif, site_id, centre_id, sync_id, is_dirty, synced_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, datetime('now'))
    `).run(
      cloud.login, cloud.password_hash, cloud.role, cloud.nom_user || '', cloud.prenom_user || '',
      statut, cloud.site_id, centreId, cloud.sync_id
    );
    idUser = Number(res.lastInsertRowid);
  }

  // ── t_user_roles : ligne propre uniquement (les gardes ci-dessus ont déjà écarté les sales) ──
  if (Array.isArray(cloud.roles)) {
    db.prepare('DELETE FROM t_user_roles WHERE id_user = ?').run(idUser);
    const ins = db.prepare('INSERT OR IGNORE INTO t_user_roles (id_user, role) VALUES (?, ?)');
    for (const r of cloud.roles) {
      if (VALID_USER_ROLES.includes(r)) ins.run(idUser, r);
    }
  }
  db.prepare('INSERT OR IGNORE INTO t_user_roles (id_user, role) VALUES (?, ?)').run(idUser, cloud.role);

  const finalAction: UpsertCloudUserAction = target ? action : 'inserted';
  if (finalAction === 'renamed' || finalAction === 'adopted') {
    log.info(`[users-sync.helper] ${finalAction} : id_user=${idUser} login="${cloud.login}" sync_id=${cloud.sync_id}`);
  }
  return { action: finalAction, id_user: idUser, ...(centreNote ? { reason: centreNote } : {}) };
}
