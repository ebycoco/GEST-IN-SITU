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
  /**
   * Instant (ms epoch, horloge locale du poste) où la lecture cloud dont provient `cloudRow` a DÉMARRÉ.
   * Si la ligne locale a été marquée synchronisée (synced_at, horloge locale aussi) à ou après cet instant
   * (arrondi à la seconde), la valeur cloud peut être antérieure à un UPDATE tout juste poussé : la ligne est
   * ignorée (skipped_dirty, « local plus récent ») et sera réalignée au tick suivant. Absent = pas de garde.
   */
  readAt?: number;
  /**
   * sync_id cloud des sites lus par l'appelant dans la même synchro (id cloud → sync_id). Règle du site
   * « le cloud l'emporte » (plan site_id 2026-10-31, commit 7) : le site_id cloud ne remplace un site_id
   * local déjà renseigné que si la ligne locale de cet id porte le MÊME sync_id que le cloud (sinon,
   * poste non réaligné : l'id local peut désigner un autre site). Absent : ancienne règle (site local conservé).
   */
  cloudSiteSyncIds?: ReadonlyMap<number, string | null>;
  /**
   * sync_id cloud des centres lus par l'appelant (id cloud → sync_id). Fourni : le centre_id cloud n'est appliqué
   * que si la ligne locale de cet id porte le MÊME sync_id (poste non réaligné : l'id peut désigner un autre
   * centre). Absent : existence locale seule. Dans tous les cas, un centre hors du site retenu est retiré.
   */
  cloudCentreSyncIds?: ReadonlyMap<number, string | null>;
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
  synced_at: string | null;
}

const LOCAL_COLS = 'id_user, login, role, site_id, centre_id, statut_actif, sync_id, is_dirty, synced_at';

/** synced_at local (datetime('now') UTC « YYYY-MM-DD HH:MM:SS », ou ISO) -> ms epoch ; NaN si illisible. */
function parseLocalTs(ts: string | null | undefined): number {
  if (!ts) return NaN;
  const iso = ts.includes('T') ? ts : ts.replace(' ', 'T') + 'Z';
  return Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : iso + 'Z');
}

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
function guardLocalRow(db: Database.Database, local: LocalUserRow, cloudSyncId: string, readAt?: number): UpsertCloudUserResult | null {
  if (local.statut_actif === -1 || local.is_dirty === -1) {
    return { action: 'skipped_deleted', id_user: local.id_user, reason: 'ligne locale supprimée (-1), jamais ressuscitée' };
  }
  if (local.is_dirty === 1) {
    return { action: 'skipped_dirty', id_user: local.id_user, reason: 'modification locale non synchronisée (is_dirty=1)' };
  }
  if (hasPendingOutbox(db, local.sync_id) || hasPendingOutbox(db, cloudSyncId)) {
    return { action: 'skipped_pending_outbox', id_user: local.id_user, reason: 'entrée t_outbox PENDING/ERROR pour ce compte' };
  }
  // Course lecture cloud / push : la ligne est redevenue propre (UPDATE poussé, synced_at posé) APRÈS le début
  // de la lecture cloud -> la valeur cloud reçue peut être antérieure à cet UPDATE. Même horloge (poste) des deux
  // côtés : pas de dérive poste/serveur à tolérer ; seule la troncature à la seconde de synced_at est absorbée.
  if (typeof readAt === 'number' && Number.isFinite(readAt)) {
    const ts = parseLocalTs(local.synced_at);
    if (Number.isFinite(ts) && ts >= Math.floor(readAt / 1000) * 1000) {
      return { action: 'skipped_dirty', id_user: local.id_user, reason: 'local plus récent que la lecture cloud (synchronisé après le début de la lecture)' };
    }
  }
  return null;
}

// ── Journalisation plafonnée des comptes ignorés (diagnostic, aucun effet sur la synchro) ──
// Budget par fenêtre de rafale : au-delà de SKIP_LOG_MAX lignes, les suivantes sont comptées puis résumées.
const SKIP_LOG_MAX = 20;
const SKIP_LOG_WINDOW_MS = 5000;
let skipLogCount = 0;
let skipLogSuppressed = 0;
let skipLogTimer: ReturnType<typeof setTimeout> | null = null;

/** Émet le résumé des lignes non détaillées et réinitialise la fenêtre. Exporté pour les tests. */
export function flushSkipLogSummary(): void {
  if (skipLogTimer) { clearTimeout(skipLogTimer); skipLogTimer = null; }
  if (skipLogSuppressed > 0) {
    log.info(`[users-sync.helper] ... ${skipLogSuppressed} autre(s) compte(s) ignoré(s) non détaillé(s) (plafond ${SKIP_LOG_MAX} lignes)`);
  }
  skipLogCount = 0;
  skipLogSuppressed = 0;
}

function logSkippedUser(login: string, res: UpsertCloudUserResult): void {
  // skipped_invalid inclus (motifs sans secret : site/centre absent, rôle invalide, champ cloud manquant).
  if (res.action !== 'skipped_dirty' && res.action !== 'skipped_pending_outbox' && res.action !== 'skipped_deleted' && res.action !== 'skipped_invalid') return;
  if (!skipLogTimer) {
    skipLogTimer = setTimeout(flushSkipLogSummary, SKIP_LOG_WINDOW_MS);
    (skipLogTimer as any).unref?.();
  }
  if (skipLogCount < SKIP_LOG_MAX) {
    skipLogCount++;
    log.info(`[users-sync.helper] Compte ignoré (${res.action}) login="${login}" id_user=${res.id_user ?? '-'} : ${res.reason ?? ''}`);
  } else {
    skipLogSuppressed++;
  }
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
    logSkippedUser(loginForLog, res);
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
    const skip = guardLocalRow(db, target, cloud.sync_id, opts.readAt);
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
    const skip = guardLocalRow(db, target, cloud.sync_id, opts.readAt);
    if (skip) return skip;
    action = 'adopted';
  }

  const siteExists = (id: unknown): boolean =>
    typeof id === 'number' && !!db.prepare('SELECT 1 FROM t_sites WHERE id = ?').get(id);
  const centreExists = (id: unknown): boolean =>
    typeof id === 'number' && !!db.prepare('SELECT 1 FROM t_centres WHERE id = ?').get(id);
  // Centre cloud vérifié : même sync_id local/cloud si l'appelant a fourni la liste, sinon existence seule.
  const cloudCentreVerified = (id: number): boolean => {
    if (!opts.cloudCentreSyncIds) return true;
    const cloudSync = opts.cloudCentreSyncIds.get(id);
    const localCentre = db.prepare('SELECT sync_id FROM t_centres WHERE id = ?').get(id) as { sync_id: string | null } | undefined;
    return !!cloudSync && !!localCentre && localCentre.sync_id === cloudSync;
  };
  const centreSiteOf = (id: number): number | null | undefined =>
    (db.prepare('SELECT site_id FROM t_centres WHERE id = ?').get(id) as { site_id: number | null } | undefined)?.site_id;

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
    } else if (!centreExists(cloud.centre_id)) {
      centreNote = `centre ${cloud.centre_id} absent localement : centre local conservé`;
    } else if (!cloudCentreVerified(cloud.centre_id)) {
      centreNote = `centre ${cloud.centre_id} non vérifié (identité locale différente) : centre local conservé`;
    } else {
      centreId = cloud.centre_id;
    }
    // site : la valeur cloud l'emporte (plan site_id 2026-10-31, commit 7, règle « recommandée ») —
    // les réparations faites dans le cloud atteignent ainsi les postes qui avaient déjà le compte. La
    // ligne locale sale ou en attente d'envoi est déjà écartée plus haut (guardLocalRow).
    // - site local vide : site cloud s'il existe localement (logique historique) ;
    // - SUPER ADMIN local : jamais rattaché à un site par le cloud, seulement détaché (site NULL) ;
    // - autre compte : site cloud seulement s'il est vérifié (même sync_id local/cloud, cloudSiteSyncIds).
    const cloudSiteVerified = (id: unknown): boolean => {
      if (typeof id !== 'number' || !opts.cloudSiteSyncIds?.has(id)) return false;
      const cloudSync = opts.cloudSiteSyncIds.get(id);
      const localSite = db.prepare('SELECT sync_id FROM t_sites WHERE id = ?').get(id) as { sync_id: string | null } | undefined;
      return !!cloudSync && !!localSite && localSite.sync_id === cloudSync;
    };
    const superAdmin = target.role === 'SUPER ADMIN' || cloud.role === 'SUPER ADMIN';
    let siteId = target.site_id ?? (!superAdmin && siteExists(cloud.site_id) ? (cloud.site_id as number) : null);
    if (target.site_id != null && cloud.site_id !== target.site_id) {
      if (superAdmin) {
        if (cloud.site_id == null && cloud.role === 'SUPER ADMIN') siteId = null;
      } else if (cloud.site_id != null && cloudSiteVerified(cloud.site_id)) {
        siteId = cloud.site_id;
      }
    }
    // Cohérence finale (§3) : le centre retenu (local ou cloud) doit appartenir au site retenu, sinon NULL.
    // Centre cloud écarté : repli sur le centre local s'il appartient, lui, au site retenu.
    if (centreId != null && centreSiteOf(centreId) !== siteId) {
      const fallback = target.centre_id != null && target.centre_id !== centreId && centreSiteOf(target.centre_id) === siteId
        ? target.centre_id : null;
      centreNote = `centre ${centreId} hors du site ${siteId ?? 'NULL'} : ${fallback != null ? `centre local ${fallback} conservé` : 'centre retiré'}`;
      centreId = fallback;
    }

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
      if (!centreExists(cloud.centre_id)) centreNote = `centre ${cloud.centre_id} absent localement : centre_id NULL`;
      else if (!cloudCentreVerified(cloud.centre_id)) centreNote = `centre ${cloud.centre_id} non vérifié (identité locale différente) : centre_id NULL`;
      else if (centreSiteOf(cloud.centre_id) !== cloud.site_id) centreNote = `centre ${cloud.centre_id} hors du site ${cloud.site_id} : centre_id NULL`;
      else centreId = cloud.centre_id;
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
