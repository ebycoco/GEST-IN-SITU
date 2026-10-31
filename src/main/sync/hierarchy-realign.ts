import type Database from 'better-sqlite3';
import log from 'electron-log';

/**
 * Réalignement de l'id LOCAL d'un site / centre / poste sur son id CLOUD (plan site_id 2026-10-31, E1).
 *
 * Tout le moteur de synchro suppose que l'id local d'un site, d'un centre ou d'un poste est égal à
 * son id Supabase (réception : INSERT OR REPLACE avec l'id cloud ; envoi : site_id/centre_id locaux
 * transmis tels quels). C'est faux sur le poste qui a CRÉÉ la ligne : elle part au cloud sans `id`,
 * Supabase lui attribue le sien. Ce module renumérote la ligne locale L → C et toutes ses références
 * (colonnes site_id/centre_id/poste_id de toutes les tables, payloads t_outbox en attente).
 *
 * Appelants : réception (downstream.ts, réconciliation avant INSERT OR REPLACE). L'acquittement d'envoi
 * suivra (commit 5 du plan).
 *
 * Écart volontaire au quadriptyque (validé par l'utilisateur le 2026-10-31) : renumérotation technique
 * pour rejoindre le cloud, pas une mutation métier → ni is_dirty, ni t_outbox, ni t_logs.
 *
 * PRAGMA foreign_keys est sans effet dans une transaction : l'appel est refusé si une transaction est
 * déjà ouverte. Chaque mise à jour est un seul UPDATE exécuté par SQLite (aucun tableau chargé en JS).
 * Les UPDATE de site_id/centre_id ne déclenchent pas les triggers FTS de t_cartes (UPDATE OF colonnes
 * texte) ; trg_anomalies_au (tout UPDATE de t_import_anomalies) réindexe les lignes touchées.
 */

export type HierarchyLevel = 'site' | 'centre' | 'poste';

interface LevelDef {
  table: string;
  /** Nom de la colonne de référence dans les autres tables. */
  refColumn: string;
  /** Clés possibles dans un payload t_outbox (local + noms cloud des cartes). */
  payloadKeys: string[];
}

const LEVELS: Record<HierarchyLevel, LevelDef> = {
  site: { table: 't_sites', refColumn: 'site_id', payloadKeys: ['site_id', 'id_site'] },
  centre: { table: 't_centres', refColumn: 'centre_id', payloadKeys: ['centre_id', 'id_centre'] },
  poste: { table: 't_postes', refColumn: 'poste_id', payloadKeys: ['poste_id', 'id_poste'] }
};

export interface RealignResult {
  /**
   * realigned : ligne renumérotée ; merged : doublon local (même sync_id déjà présent sous l'id cloud)
   * fusionné dans la ligne cloud puis supprimé ; vacated : ligne déplacée vers un id libre.
   */
  action: 'noop' | 'realigned' | 'merged' | 'vacated' | 'skipped';
  reason?: string;
  /** Id libre vers lequel une ligne locale occupant l'id cloud (ou l'id à libérer) a été déplacée. */
  movedOccupantTo?: number;
  /** Lignes modifiées (références + payloads t_outbox), hors ligne renumérotée. */
  rowsUpdated?: number;
}

const quote = (name: string): string => `"${name.replace(/"/g, '""')}"`;

/** Tables ordinaires (hors virtuelles FTS et tables internes) portant la colonne `column`. */
function tablesWithColumn(db: Database.Database, column: string): string[] {
  const tables = db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND sql NOT LIKE 'CREATE VIRTUAL TABLE%'
  `).all() as { name: string }[];
  return tables
    .map(t => t.name)
    .filter(name => (db.prepare(`PRAGMA table_info(${quote(name)})`).all() as { name: string }[]).some(c => c.name === column));
}

/** Remplace `from` par `to` dans les références et les payloads t_outbox PENDING/ERROR (pas la ligne elle-même). */
function rewriteReferences(db: Database.Database, def: LevelDef, from: number, to: number, refTables: string[]): number {
  let changes = 0;
  for (const table of refTables) {
    changes += db.prepare(`UPDATE ${quote(table)} SET ${quote(def.refColumn)} = ? WHERE ${quote(def.refColumn)} = ?`).run(to, from).changes;
  }
  for (const key of def.payloadKeys) {
    const path = `$.${key}`;
    changes += db.prepare(`
      UPDATE t_outbox SET payload = json_set(payload, ?, ?)
      WHERE status IN ('PENDING', 'ERROR') AND json_valid(payload)
        AND json_type(payload, ?) IN ('integer', 'text') AND CAST(json_extract(payload, ?) AS INTEGER) = ?
    `).run(path, to, path, path, from).changes;
  }
  // Payload de la ligne elle-même (si un `id` local y figure).
  changes += db.prepare(`
    UPDATE t_outbox SET payload = json_set(payload, '$.id', ?)
    WHERE status IN ('PENDING', 'ERROR') AND table_name = ? AND json_valid(payload)
      AND json_type(payload, '$.id') IN ('integer', 'text') AND CAST(json_extract(payload, '$.id') AS INTEGER) = ?
  `).run(to, def.table, from).changes;
  return changes;
}

/** Renumérote la ligne `from` → `to` (libre) et ses références. À appeler dans une transaction. */
function renumber(db: Database.Database, def: LevelDef, from: number, to: number, refTables: string[]): number {
  db.prepare(`UPDATE ${quote(def.table)} SET id = ? WHERE id = ?`).run(to, from);
  // AUTOINCREMENT : un UPDATE de l'id ne fait pas avancer sqlite_sequence ; sans ce rattrapage, une
  // création locale ultérieure pourrait recevoir l'id `to` (contrainte PRIMARY KEY violée).
  db.prepare(`UPDATE sqlite_sequence SET seq = MAX(seq, ?) WHERE name = ?`).run(to, def.table);
  return rewriteReferences(db, def, from, to, refTables);
}

/** Premier id libre de la table, au-delà de MAX(id) et de sqlite_sequence. */
function freeId(db: Database.Database, def: LevelDef): number {
  const seq = db.prepare(`SELECT seq FROM sqlite_sequence WHERE name = ?`).get(def.table) as { seq: number } | undefined;
  const maxId = (db.prepare(`SELECT MAX(id) AS m FROM ${quote(def.table)}`).get() as { m: number | null }).m ?? 0;
  return Math.max(maxId, seq?.seq ?? 0) + 1;
}

/** Exécute `fn` dans une transaction avec foreign_keys désactivé, puis restaure la valeur d'origine. */
function withForeignKeysOff<T>(db: Database.Database, fn: () => T): T {
  const fkBefore = db.pragma('foreign_keys', { simple: true }) as number;
  db.pragma('foreign_keys = OFF');
  try {
    return db.transaction(fn)();
  } finally {
    db.pragma(`foreign_keys = ${fkBefore ? 'ON' : 'OFF'}`);
  }
}

/**
 * Aligne l'id local de la ligne (`localId`, identifiée par `syncId`) sur `cloudId`.
 * - noop si déjà aligné ;
 * - skipped (sans rien modifier) si la ligne locale est introuvable, porte un autre sync_id, si les
 *   ids sont invalides ou si une transaction est déjà ouverte ;
 * - si la ligne sous `cloudId` porte le MÊME sync_id (doublon créé par un ancien INSERT OR REPLACE),
 *   les références de `localId` sont reportées sur elle et la ligne `localId` est supprimée (merged) ;
 * - si une AUTRE ligne locale occupe déjà `cloudId` (forcément une ligne locale non alignée, deux lignes
 *   cloud ne pouvant partager un id), elle est d'abord déplacée vers un id libre, avec ses références.
 */
export function realignLocalId(
  db: Database.Database,
  level: HierarchyLevel,
  localId: number,
  cloudId: number,
  syncId: string
): RealignResult {
  const def = LEVELS[level];
  if (!Number.isInteger(localId) || !Number.isInteger(cloudId) || localId <= 0 || cloudId <= 0 || !syncId) {
    return { action: 'skipped', reason: 'paramètres invalides' };
  }
  if (localId === cloudId) return { action: 'noop' };

  const local = db.prepare(`SELECT id, sync_id FROM ${quote(def.table)} WHERE id = ?`).get(localId) as { id: number; sync_id: string | null } | undefined;
  if (!local) return { action: 'skipped', reason: `${def.table} id=${localId} introuvable` };
  if (local.sync_id !== syncId) return { action: 'skipped', reason: `${def.table} id=${localId} porte un autre sync_id` };
  if (db.inTransaction) return { action: 'skipped', reason: 'transaction déjà ouverte (foreign_keys non désactivable)' };

  const refTables = tablesWithColumn(db, def.refColumn);
  const result = withForeignKeysOff(db, (): RealignResult => {
    const occupant = db.prepare(`SELECT sync_id FROM ${quote(def.table)} WHERE id = ?`).get(cloudId) as { sync_id: string | null } | undefined;
    if (occupant && occupant.sync_id === syncId) {
      const rowsUpdated = rewriteReferences(db, def, localId, cloudId, refTables);
      db.prepare(`DELETE FROM ${quote(def.table)} WHERE id = ?`).run(localId);
      return { action: 'merged', rowsUpdated };
    }
    let movedOccupantTo: number | undefined;
    let rowsUpdated = 0;
    if (occupant) {
      movedOccupantTo = freeId(db, def);
      rowsUpdated += renumber(db, def, cloudId, movedOccupantTo, refTables);
    }
    rowsUpdated += renumber(db, def, localId, cloudId, refTables);
    return { action: 'realigned', movedOccupantTo, rowsUpdated };
  });
  log.info(
    `[hierarchy-realign] ${def.table} sync_id=${syncId} : id local ${localId} → id cloud ${cloudId}` +
    (result.action === 'merged' ? ' (doublon fusionné dans la ligne cloud)' : '') +
    (result.movedOccupantTo !== undefined ? ` (ligne locale qui occupait ${cloudId} déplacée vers ${result.movedOccupantTo})` : '') +
    `, ${result.rowsUpdated} référence(s) mise(s) à jour.`
  );
  return result;
}

/**
 * Libère l'id `id` : la ligne locale qui l'occupe (non alignée, autre sync_id que la ligne cloud qui va
 * y être écrite) est déplacée vers un id libre, avec ses références. Évite qu'un INSERT OR REPLACE de
 * la ligne cloud ne l'écrase (perte de la ligne, références orphelines).
 */
export function vacateLocalId(db: Database.Database, level: HierarchyLevel, id: number): RealignResult {
  const def = LEVELS[level];
  if (!Number.isInteger(id) || id <= 0) return { action: 'skipped', reason: 'paramètres invalides' };
  if (!db.prepare(`SELECT 1 FROM ${quote(def.table)} WHERE id = ?`).get(id)) return { action: 'noop' };
  if (db.inTransaction) return { action: 'skipped', reason: 'transaction déjà ouverte (foreign_keys non désactivable)' };

  const refTables = tablesWithColumn(db, def.refColumn);
  const result = withForeignKeysOff(db, (): RealignResult => {
    const to = freeId(db, def);
    return { action: 'vacated', movedOccupantTo: to, rowsUpdated: renumber(db, def, id, to, refTables) };
  });
  log.info(`[hierarchy-realign] ${def.table} : ligne locale ${id} déplacée vers ${result.movedOccupantTo} (id requis par le cloud), ${result.rowsUpdated} référence(s) mise(s) à jour.`);
  return result;
}

/** Ligne cloud t_sites / t_centres telle que lue par la réception (champs d'identité métier inclus). */
export interface CloudHierarchyRow {
  id: number;
  sync_id?: string | null;
  /** t_sites : code (UNIQUE localement et dans le cloud). */
  code?: string | null;
  /** t_centres : site_id + numero + nom identifient le même centre. */
  site_id?: number | null;
  numero?: number | null;
  nom?: string | null;
}

export type LocalHierarchyRow = { id: number; sync_id: string | null; code?: string | null; site_id?: number | null; numero?: number | null; nom?: string | null };

const normName = (v: unknown): string => String(v ?? '').trim().toLowerCase();

/**
 * Même site / centre au sens MÉTIER, indépendamment du sync_id : ensureSyncIds() (au démarrage) donne
 * un uuid local ALÉATOIRE à toute ligne sans sync_id ; si le cloud reçoit ensuite un sync_id pour cette
 * ligne, chaque poste porte un sync_id différent du cloud pour la même ligne (audit 2026-10-31, P0-1).
 * Site : même code. Centre : même site, même numéro et même nom.
 */
export function sameIdentity(level: 'site' | 'centre', local: LocalHierarchyRow, cloud: CloudHierarchyRow): boolean {
  if (level === 'site') return !!cloud.code && local.code === cloud.code;
  return cloud.site_id != null && local.site_id === cloud.site_id
    && cloud.numero != null && local.numero === cloud.numero
    && !!normName(cloud.nom) && normName(local.nom) === normName(cloud.nom);
}

/**
 * Remplace le sync_id local d'une ligne par celui du cloud (même ligne métier). Ne change aucun id :
 * sans risque pour une session ouverte.
 * Les envois t_outbox en attente de CETTE ligne sous l'ancien sync_id sont écartés (supprimés et
 * journalisés), jamais réécrits (re-audit 2026-10-31, P1-C) : sous l'ancien sync_id ils échouaient
 * toujours (conflit sur le code UNIQUE cloud, aucun `id` dans le payload) et n'ont donc jamais été
 * appliqués ; réécrits avec le sync_id cloud, ils écraseraient la ligne cloud (is_active, expiry_date,
 * max_centres…) avec des valeurs anciennes. Leur id t_outbox (= ancien sync_id) échapperait aussi à
 * cancelPendingInsert(sync_id courant) de deleteSite / deleteCentre.
 */
function adoptCloudSyncId(db: Database.Database, def: LevelDef, localId: number, oldSyncId: string | null, newSyncId: string): void {
  let discarded: { id: string; operation: string; status: string; created_at: string | null }[] = [];
  db.transaction(() => {
    db.prepare(`UPDATE ${quote(def.table)} SET sync_id = ? WHERE id = ?`).run(newSyncId, localId);
    if (oldSyncId) {
      const where = `status IN ('PENDING', 'ERROR') AND table_name = ? AND (id = ? OR (json_valid(payload) AND json_extract(payload, '$.sync_id') = ?))`;
      discarded = db.prepare(`SELECT id, operation, status, created_at FROM t_outbox WHERE ${where}`).all(def.table, oldSyncId, oldSyncId) as typeof discarded;
      db.prepare(`DELETE FROM t_outbox WHERE ${where}`).run(def.table, oldSyncId, oldSyncId);
    }
  })();
  log.info(`[hierarchy-realign] ${def.table} id ${localId} : sync_id local ${oldSyncId ?? 'NULL'} remplacé par le sync_id cloud ${newSyncId} (même ${def.table === 't_sites' ? 'code' : 'site, numéro et nom'}).`);
  for (const e of discarded) {
    log.warn(`[hierarchy-realign] Envoi t_outbox écarté (ancien sync_id ${oldSyncId}, jamais applicable au cloud) : id=${e.id} ${def.table} ${e.operation} ${e.status} créé le ${e.created_at ?? '?'}.`);
  }
}

export const LOCAL_COLS: Record<'site' | 'centre', string> = {
  site: 'id, sync_id, code',
  centre: 'id, sync_id, site_id, numero, nom'
};

/**
 * Identité du site cloud de même id que le site LOCAL `siteId` (garde anti-fuite §3, audit 2026-10-31 P1-1) :
 * - ok : même sync_id ; ou un sync_id absent sans code différent ;
 * - adopted : sync_id différents mais même code → même site, le sync_id cloud est adopté localement ;
 * - mismatch : code différent (sync_id différents, ou l'un absent — re-audit 2026-10-31, P1-A : le
 *   cloud accepte un sync_id NULL) → l'id local désigne un AUTRE site dans le cloud.
 */
export function checkCloudSiteIdentity(
  db: Database.Database,
  siteId: number,
  cloudSite: { sync_id?: string | null; code?: string | null }
): 'ok' | 'adopted' | 'mismatch' {
  const local = db.prepare(`SELECT ${LOCAL_COLS.site} FROM t_sites WHERE id = ?`).get(siteId) as LocalHierarchyRow | undefined;
  if (!local) return 'ok';
  if (!local.sync_id || !cloudSite.sync_id) {
    return local.code && cloudSite.code && local.code !== cloudSite.code ? 'mismatch' : 'ok';
  }
  if (local.sync_id === cloudSite.sync_id) return 'ok';
  if (sameIdentity('site', local, { id: siteId, ...cloudSite })) {
    adoptCloudSyncId(db, LEVELS.site, siteId, local.sync_id, cloudSite.sync_id);
    return 'adopted';
  }
  return 'mismatch';
}

/**
 * Réconciliation avant INSERT OR REPLACE de lignes cloud t_sites / t_centres (plan site_id 2026-10-31, E2-b).
 * 0. Une ligne locale de même identité métier (sameIdentity) mais d'un autre sync_id adopte le sync_id
 *    cloud (aucun id modifié).
 * 1. Une ligne locale portant le sync_id d'une ligne cloud sous un autre id est réalignée (ou fusionnée).
 * 2. Une ligne locale d'une AUTRE identité (sync_id non nul différent, identité métier différente)
 *    occupant l'id cloud est déplacée vers un id libre.
 * Les étapes 1 et 2 renumérotent : elles ne sont faites que si `allowRenumber` (aucune session ouverte —
 * la session, l'écran et les imports gardent leurs ids en mémoire, audit 2026-10-31 P1-4). Sinon, ou en
 * cas d'échec, l'id cloud est renvoyé dans l'ensemble retourné : l'appelant NE DOIT PAS écrire cette
 * ligne (réalignement au prochain démarrage, préchargement avant connexion).
 * Ne lève jamais : les échecs sont journalisés.
 */
export function reconcileBeforeCloudReplace(
  db: Database.Database,
  level: 'site' | 'centre',
  cloudRows: ReadonlyArray<CloudHierarchyRow>,
  opts: { allowRenumber: boolean }
): Set<number> {
  const def = LEVELS[level];
  const table = quote(def.table);
  const skipIds = new Set<number>();
  const rows = cloudRows.filter(c => !!c?.sync_id && Number.isInteger(c.id));
  const cloudSyncIds = new Set(rows.map(c => c.sync_id as string));
  const skip = (id: number, why: string): void => {
    skipIds.add(id);
    log.warn(`[hierarchy-realign] ${def.table} id cloud ${id} non écrit : ${why}`);
  };

  // 0. Adoption du sync_id cloud par la ligne locale de même identité métier.
  for (const c of rows) {
    try {
      if (db.prepare(`SELECT 1 FROM ${table} WHERE sync_id = ?`).get(c.sync_id)) continue;
      const candidates = (db.prepare(`SELECT ${LOCAL_COLS[level]} FROM ${table} WHERE sync_id IS NULL OR sync_id != ?`).all(c.sync_id) as LocalHierarchyRow[])
        .filter(l => sameIdentity(level, l, c) && !(l.sync_id && cloudSyncIds.has(l.sync_id)));
      if (candidates.length === 1) adoptCloudSyncId(db, def, candidates[0].id, candidates[0].sync_id, c.sync_id as string);
    } catch (err: any) {
      log.error(`[hierarchy-realign] Adoption du sync_id cloud ${c.sync_id} (${def.table}) en échec :`, err?.message || err);
    }
  }

  // 1. Réalignement des lignes locales portant le sync_id cloud sous un autre id.
  for (const c of rows) {
    const locals = db.prepare(`SELECT id FROM ${table} WHERE sync_id = ? AND id != ?`).all(c.sync_id, c.id) as { id: number }[];
    for (const l of locals) {
      if (!opts.allowRenumber) {
        skip(c.id, `id local ${l.id} à réaligner (sync_id ${c.sync_id}), reporté au prochain démarrage (session ouverte)`);
        continue;
      }
      try {
        const res = realignLocalId(db, level, l.id, c.id, c.sync_id as string);
        if (res.action === 'skipped') skip(c.id, `réalignement de ${l.id} refusé (${res.reason})`);
      } catch (err: any) {
        log.error(`[hierarchy-realign] Réalignement ${def.table} ${l.id} → ${c.id} en échec :`, err?.message || err);
        skipIds.add(c.id);
      }
    }
  }

  // 2. Libération de l'id cloud occupé par une ligne locale d'une autre identité. Ligne cloud sans
  //    sync_id (re-audit P1-A) : seuls les sites sont traités, l'identité étant alors le seul code.
  const allRows = cloudRows.filter(c => Number.isInteger(c?.id));
  for (const c of allRows) {
    if (skipIds.has(c.id)) continue;
    const occ = db.prepare(`SELECT ${LOCAL_COLS[level]} FROM ${table} WHERE id = ?`).get(c.id) as LocalHierarchyRow | undefined;
    if (!occ || !occ.sync_id || occ.sync_id === c.sync_id) continue;
    if (!c.sync_id && !(level === 'site' && occ.code && c.code && occ.code !== c.code)) continue;
    if (sameIdentity(level, occ, c)) {
      // Même ligne métier non adoptée (ambiguïté) : ne jamais la déplacer (sinon REPLACE par `code`
      // la supprimerait avec ses références déjà renumérotées, audit P0-1) ; ancien comportement.
      continue;
    }
    if (!opts.allowRenumber) {
      skip(c.id, `occupé localement par une autre identité (sync_id ${occ.sync_id}), reporté au prochain démarrage (session ouverte)`);
      continue;
    }
    try {
      const res = vacateLocalId(db, level, c.id);
      if (res.action === 'skipped') skip(c.id, `libération refusée (${res.reason})`);
    } catch (err: any) {
      log.error(`[hierarchy-realign] Libération de ${def.table} id ${c.id} en échec :`, err?.message || err);
      skipIds.add(c.id);
    }
  }

  // t_sites.code est UNIQUE : un REPLACE supprimerait toute AUTRE ligne locale de même code. Ne pas
  // écrire la ligne cloud si une telle ligne subsiste (identité ambiguë, réalignement reporté).
  if (level === 'site') {
    for (const c of allRows) {
      if (skipIds.has(c.id) || !c.code) continue;
      const other = db.prepare(`SELECT id FROM t_sites WHERE code = ? AND id != ?`).get(c.code, c.id) as { id: number } | undefined;
      if (other) skip(c.id, `une autre ligne locale (id ${other.id}) porte le même code`);
    }
  }
  return skipIds;
}

export const realignLocalSite =(db: Database.Database, localId: number, cloudId: number, syncId: string): RealignResult =>
  realignLocalId(db, 'site', localId, cloudId, syncId);

export const realignLocalCentre = (db: Database.Database, localId: number, cloudId: number, syncId: string): RealignResult =>
  realignLocalId(db, 'centre', localId, cloudId, syncId);

export const realignLocalPoste = (db: Database.Database, localId: number, cloudId: number, syncId: string): RealignResult =>
  realignLocalId(db, 'poste', localId, cloudId, syncId);
