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
 * Aucun appelant branché pour l'instant (commits suivants : acquittement d'envoi et réception).
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
  action: 'noop' | 'realigned' | 'skipped';
  reason?: string;
  /** Id libre vers lequel une ligne locale occupant déjà l'id cloud a été déplacée. */
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

/**
 * Renumérote `from` → `to` dans la table du niveau, ses références et les payloads t_outbox en attente.
 * À appeler dans une transaction (foreign_keys déjà désactivé). Retourne le nombre de lignes de
 * références/payloads modifiées.
 */
function renumber(db: Database.Database, def: LevelDef, from: number, to: number, refTables: string[]): number {
  let changes = 0;
  db.prepare(`UPDATE ${quote(def.table)} SET id = ? WHERE id = ?`).run(to, from);
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
  // AUTOINCREMENT : un UPDATE de l'id ne fait pas avancer sqlite_sequence ; sans ce rattrapage, une
  // création locale ultérieure pourrait recevoir l'id `to` (contrainte PRIMARY KEY violée).
  db.prepare(`UPDATE sqlite_sequence SET seq = MAX(seq, ?) WHERE name = ?`).run(to, def.table);
  return changes;
}

/**
 * Aligne l'id local de la ligne (`localId`, identifiée par `syncId`) sur `cloudId`.
 * - noop si déjà aligné ;
 * - skipped (sans rien modifier) si la ligne locale est introuvable, porte un autre sync_id, si les
 *   ids sont invalides ou si une transaction est déjà ouverte ;
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
  const fkBefore = db.pragma('foreign_keys', { simple: true }) as number;
  db.pragma('foreign_keys = OFF');
  try {
    const result = db.transaction((): RealignResult => {
      let movedOccupantTo: number | undefined;
      let rowsUpdated = 0;
      const occupant = db.prepare(`SELECT sync_id FROM ${quote(def.table)} WHERE id = ?`).get(cloudId) as { sync_id: string | null } | undefined;
      if (occupant) {
        const seq = db.prepare(`SELECT seq FROM sqlite_sequence WHERE name = ?`).get(def.table) as { seq: number } | undefined;
        const maxId = (db.prepare(`SELECT MAX(id) AS m FROM ${quote(def.table)}`).get() as { m: number | null }).m ?? 0;
        movedOccupantTo = Math.max(maxId, seq?.seq ?? 0) + 1;
        rowsUpdated += renumber(db, def, cloudId, movedOccupantTo, refTables);
      }
      rowsUpdated += renumber(db, def, localId, cloudId, refTables);
      return { action: 'realigned', movedOccupantTo, rowsUpdated };
    })();
    log.info(
      `[hierarchy-realign] ${def.table} sync_id=${syncId} : id local ${localId} → id cloud ${cloudId}` +
      `${result.movedOccupantTo !== undefined ? ` (ligne locale qui occupait ${cloudId} déplacée vers ${result.movedOccupantTo})` : ''}` +
      `, ${result.rowsUpdated} référence(s) mise(s) à jour.`
    );
    return result;
  } finally {
    db.pragma(`foreign_keys = ${fkBefore ? 'ON' : 'OFF'}`);
  }
}

export const realignLocalSite = (db: Database.Database, localId: number, cloudId: number, syncId: string): RealignResult =>
  realignLocalId(db, 'site', localId, cloudId, syncId);

export const realignLocalCentre = (db: Database.Database, localId: number, cloudId: number, syncId: string): RealignResult =>
  realignLocalId(db, 'centre', localId, cloudId, syncId);

export const realignLocalPoste = (db: Database.Database, localId: number, cloudId: number, syncId: string): RealignResult =>
  realignLocalId(db, 'poste', localId, cloudId, syncId);
