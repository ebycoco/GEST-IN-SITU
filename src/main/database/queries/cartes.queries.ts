import { getDatabase } from '../connection';
import { v4 as uuidv4 } from 'uuid';
import { enqueueOutbox, scheduleOutboxProcessing, cancelPendingInsert } from '../../sync/outbox.service';
import { networkMonitor } from '../../sync/network-monitor';
import { insertAuditLog } from './audit.queries';

function removeAccents(str: string): string {
  if (!str) return '';
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .trim();
}

function normalizeContact(contactStr: string): string {
  if (!contactStr) return '';
  let cleaned = contactStr.replace(/\D/g, '');
  if (cleaned.startsWith('225') && cleaned.length > 10) {
    cleaned = cleaned.substring(3);
  }
  if (cleaned.length > 10) {
    cleaned = cleaned.substring(cleaned.length - 10);
  }
  return cleaned;
}

// Cache pour optimiser la pagination (les requêtes COUNT(*) peuvent être lourdes sur de grandes tables)
const paginationCountCache = new Map<string, { count: number; timestamp: number }>();
const COUNT_CACHE_TTL = 10000; // 10 secondes

function getCachedCount(db: any, query: string, params: any): number {
  const cacheKey = query + JSON.stringify(params);
  const now = Date.now();
  const cached = paginationCountCache.get(cacheKey);
  
  if (cached && (now - cached.timestamp < COUNT_CACHE_TTL)) {
    return cached.count;
  }
  
  const result = (Array.isArray(params) 
    ? db.prepare(query).get(...params) 
    : db.prepare(query).get(params)) as { count: number };
  
  // Nettoyage basique pour éviter une fuite de mémoire (limite empirique à 500 requêtes en cache)
  if (paginationCountCache.size > 500) {
    paginationCountCache.clear();
  }
  
  paginationCountCache.set(cacheKey, { count: result.count, timestamp: now });
  return result.count;
}

export function getCartesPage(offset: number, limit: number, filters?: Record<string, string>) {
  const db = getDatabase()!;
  let where = 'WHERE is_dirty != -1';
  const params: any = {};

  if (filters?.statut) { where += ' AND statut = @statut'; params.statut = filters.statut; }
  if (filters?.site_id) { where += ' AND site_id = @site_id'; params.site_id = Number(filters.site_id); }
  if (filters?.centre_id) { where += ' AND centre_id = @centre_id'; params.centre_id = Number(filters.centre_id); }
  if (filters?.rangement) { where += " AND rangement LIKE @rangement"; params.rangement = `%${filters.rangement}%`; }
  if (filters?.statut_physique) { where += ' AND statut_physique = @statut_physique'; params.statut_physique = filters.statut_physique; }
  
  if (filters?.q || filters?.search) {
    const q = filters.q || filters.search;
    where += " AND (noms LIKE @q OR prenoms LIKE @q OR (noms || ' ' || prenoms) LIKE @q OR (prenoms || ' ' || noms) LIKE @q OR num_secu LIKE @q OR contact LIKE @q OR lieu_de_naissance LIKE @q OR rangement LIKE @q)";
    params.q = `%${q}%`;
  }

  const countQuery = `SELECT COUNT(*) as count FROM t_cartes ${where}`;
  const totalCount = getCachedCount(db, countQuery, params);
  const rows = db.prepare(`SELECT * FROM t_cartes ${where} ORDER BY id_carte DESC LIMIT @limit OFFSET @offset`)
    .all({ ...params, limit, offset });

  return { rows, total: totalCount, offset, limit };
}

export function searchCartesFTS(query: string, limit = 100, filters?: Record<string, string>) {
  const db = getDatabase()!;
  
  const params: Record<string, any> = { limit };
  let hasFilters = false;
  let filtersSql = ' AND t_cartes.is_dirty != -1';

  if (filters?.date_de_naissance) {
    filtersSql += ' AND t_cartes.date_de_naissance = @date_de_naissance';
    params.date_de_naissance = filters.date_de_naissance;
    hasFilters = true;
  }
  if (filters?.lieu_de_naissance) {
    filtersSql += ' AND t_cartes.lieu_de_naissance LIKE @lieu_de_naissance';
    params.lieu_de_naissance = `%${filters.lieu_de_naissance}%`;
    hasFilters = true;
  }
  if (filters?.contact) {
    filtersSql += ' AND t_cartes.contact LIKE @contact';
    let finalContactParam = filters.contact;
    if (finalContactParam) {
      if (!finalContactParam.startsWith('%')) {
        finalContactParam = `%${finalContactParam}%`;
      }
    }
    params.contact = finalContactParam;
    hasFilters = true;
  }
  if (filters?.site_id) {
    filtersSql += ' AND t_cartes.site_id = @site_id';
    params.site_id = Number(filters.site_id);
    hasFilters = true;
  }

  if (filters?.exclude_delivered === 'true') {
    filtersSql += " AND t_cartes.statut = 'EN STOCK'";
    hasFilters = true;
  }

  if (!query.trim()) {
    let nonFtsQuery = `SELECT t_cartes.*, t_sites.nom as site_nom, t_centres.nom as centre_nom FROM t_cartes LEFT JOIN t_sites ON t_cartes.site_id = t_sites.id LEFT JOIN t_centres ON t_cartes.centre_id = t_centres.id WHERE t_cartes.is_dirty != -1`;
    if (filters?.date_de_naissance) nonFtsQuery += ' AND t_cartes.date_de_naissance = @date_de_naissance';
    if (filters?.lieu_de_naissance) nonFtsQuery += ' AND t_cartes.lieu_de_naissance LIKE @lieu_de_naissance';
    if (filters?.contact) nonFtsQuery += ' AND t_cartes.contact LIKE @contact';
    if (filters?.site_id) nonFtsQuery += ' AND t_cartes.site_id = @site_id';
    if (filters?.exclude_delivered === 'true') nonFtsQuery += " AND t_cartes.statut = 'EN STOCK'";
    nonFtsQuery += ' ORDER BY t_cartes.id_carte DESC LIMIT @limit';
    
    return db.prepare(nonFtsQuery).all(params);
  }

  const ftsQuery = query.split(/\s+/).map(w => `"${w}"*`).join(' ');
  params.query = ftsQuery;
  
  return db.prepare(`
    SELECT t_cartes.*, t_sites.nom as site_nom, t_centres.nom as centre_nom FROM t_cartes_fts
    JOIN t_cartes ON t_cartes_fts.rowid = t_cartes.id_carte
    LEFT JOIN t_sites ON t_cartes.site_id = t_sites.id
    LEFT JOIN t_centres ON t_cartes.centre_id = t_centres.id
    WHERE t_cartes_fts MATCH @query
    ${filtersSql}
    ORDER BY rank
    LIMIT @limit
  `).all(params);
}

export function getCarteById(id: number, currentUser?: { role: string; site_id?: number }) {
  const db = getDatabase()!;
  if (currentUser && currentUser.role !== 'SUPER ADMIN') {
    const row = db.prepare('SELECT * FROM t_cartes WHERE id_carte = ? AND site_id = ? AND is_dirty != -1').get(id, currentUser.site_id);
    if (!row) throw new Error("Accès non autorisé aux données de ce site");
    return row;
  }
  return db.prepare('SELECT * FROM t_cartes WHERE id_carte = ? AND is_dirty != -1').get(id);
}

function isValidDate(dateStr: string | null | undefined): boolean {
  if (!dateStr) return false;
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);
  return month >= 1 && month <= 12 && day >= 1 && day <= 31;
}

export function createCarte(data: Record<string, unknown>, siteIdToUse: number) {
  const db = getDatabase()!;
  const now = new Date().toISOString();
  const syncId = uuidv4();
  
  const noms = removeAccents(data.noms as string || '');
  const prenoms = removeAccents(data.prenoms as string || '');
  const ddn = data.date_de_naissance as string || '';
  const lieuN = removeAccents(data.lieu_de_naissance as string || '');
  const contact = normalizeContact(data.contact as string || '');

  if (!isValidDate(ddn)) {
    throw new Error("Date de naissance invalide. Format attendu : AAAA-MM-JJ (ex : 1990-12-31).");
  }

  const dateDelivrance = data.date_delivrance as string || '';
  if (dateDelivrance && !isValidDate(dateDelivrance)) {
    throw new Error("Date de délivrance invalide. Format attendu : AAAA-MM-JJ.");
  }

  const cleDbl = `${noms}|${prenoms}|${ddn}|${lieuN}|${contact}`;
  const cleFlex = `${noms}|${prenoms}|${ddn}|${contact}`;

  const stmt = db.prepare(`
    INSERT INTO t_cartes (noms, prenoms, date_de_naissance, lieu_de_naissance, num_secu,
      lieu_enrolement, contact, rangement, statut, agent_saisie, centre_id, poste_id,
      cle_doublon, cle_doublon_flex, sync_id, site_id, created_at, updated_at, is_dirty, created_by)
    VALUES (@noms, @prenoms, @date_de_naissance, @lieu_de_naissance, @num_secu,
      @lieu_enrolement, @contact, @rangement, @statut, @agent_saisie, @centre_id, @poste_id,
      @cle_doublon, @cle_doublon_flex, @sync_id, @site_id, @created_at, @updated_at, 1, @created_by)
  `);

  const result = stmt.run({
    noms,
    prenoms,
    date_de_naissance: ddn || null,
    lieu_de_naissance: lieuN,
    num_secu: data.num_secu || null,
    lieu_enrolement: removeAccents(data.lieu_enrolement as string || ''),
    contact,
    rangement: removeAccents(data.rangement as string || ''),
    statut: data.statut || 'EN STOCK',
    agent_saisie: data.agent_saisie || 'SYSTEM',
    centre_id: data.centre_id || null,
    poste_id: data.poste_id || null,
    cle_doublon: cleDbl,
    cle_doublon_flex: cleFlex,
    sync_id: syncId,
    site_id: siteIdToUse,
    created_at: now,
    updated_at: now,
    created_by: data.created_by || null
  });

  enqueueOutbox(syncId, 't_cartes', 'INSERT', {
    sync_id: syncId,
    noms,
    prenoms,
    date_de_naissance: ddn || null,
    lieu_de_naissance: lieuN,
    num_secu: data.num_secu || null,
    lieu_enrolement: removeAccents(data.lieu_enrolement as string || ''),
    contact,
    rangement: removeAccents(data.rangement as string || ''),
    statut: data.statut || 'EN STOCK',
    agent_saisie: data.agent_saisie || 'SYSTEM',
    centre_id: data.centre_id || null,
    poste_id: data.poste_id || null,
    cle_doublon: cleDbl,
    cle_doublon_flex: cleFlex,
    site_id: siteIdToUse,
    created_by: data.created_by || null
  });

  if (networkMonitor.getState() === 'ONLINE') {
    scheduleOutboxProcessing();
  }

  return { id: result.lastInsertRowid, sync_id: syncId };
}

export function updateCarte(id: number, data: Record<string, unknown>, currentUser?: { role: string; site_id?: number }) {
  const db = getDatabase()!;
  const now = new Date().toISOString();

  if ('date_de_naissance' in data) {
    const ddn = data.date_de_naissance as string;
    if (ddn && !isValidDate(ddn)) {
      throw new Error("Date de naissance invalide. Format attendu : AAAA-MM-JJ (ex : 1990-12-31).");
    }
  }

  if ('date_delivrance' in data) {
    const dateDelivrance = data.date_delivrance as string;
    if (dateDelivrance && !isValidDate(dateDelivrance)) {
      throw new Error("Date de délivrance invalide. Format attendu : AAAA-MM-JJ.");
    }
  }
  
  const allowedColumns = [
    'noms', 'prenoms', 'date_de_naissance', 'lieu_de_naissance', 'num_secu',
    'lieu_enrolement', 'contact', 'rangement', 'statut', 'date_delivrance',
    'agent_saisie', 'nom_retirant', 'num_retirant', 'agent_distributeur',
    'centre_retrait', 'cle_doublon', 'cle_doublon_flex', 'statut_physique',
    'site_id', 'centre_id', 'poste_id', 'qr_code_data', 'sync_id', 'is_dirty', 'is_exported', 'created_by'
  ];
  
  const filteredKeys = Object.keys(data).filter(k => allowedColumns.includes(k));
  if (filteredKeys.length === 0) {
    return { changes: 0 };
  }
  
  const fields = filteredKeys.map(k => `${k} = @${k}`).join(', ');
  
  let query = `UPDATE t_cartes SET ${fields}, updated_at = @updated_at, is_dirty = 1 WHERE id_carte = @id`;
  const params: any = {};
  filteredKeys.forEach(k => {
    params[k] = data[k];
  });
  params.updated_at = now;
  params.id = id;
  
  if (currentUser && currentUser.role !== 'SUPER ADMIN') {
    query += ' AND site_id = @site_id';
    params.site_id = currentUser.site_id;
  }
  
  const result = db.prepare(query).run(params);
  if (result.changes === 0) {
    throw new Error("Accès non autorisé aux données de ce site");
  }

  const carte = db.prepare('SELECT sync_id FROM t_cartes WHERE id_carte = ?').get(id) as { sync_id: string } | undefined;
  if (carte?.sync_id) {
    const updatedCarte = db.prepare('SELECT noms, prenoms, date_de_naissance, lieu_de_naissance, num_secu, lieu_enrolement, contact, rangement, statut, date_delivrance, agent_saisie, nom_retirant, num_retirant, agent_distributeur, centre_retrait, cle_doublon, cle_doublon_flex, statut_physique, site_id, centre_id, poste_id, qr_code_data, created_by FROM t_cartes WHERE id_carte = ?').get(id) as any;
    
    enqueueOutbox(carte.sync_id, 't_cartes', 'UPDATE', {
      sync_id: carte.sync_id,
      ...updatedCarte,
      updated_at: now
    });

    if (networkMonitor.getState() === 'ONLINE') {
      scheduleOutboxProcessing();
    }
  }

  return result;
}

export function deleteCarte(id: number, currentUser?: { role: string; site_id?: number; login?: string }) {
  const db = getDatabase()!;
  
  // 1. Validation de l'autorisation : réservé aux administrateurs
  if (currentUser && !['SUPER ADMIN', 'ADMINISTRATEUR_SITE', 'ADMIN_CENTRE'].includes(currentUser.role)) {
    throw new Error("Accès non autorisé : Rôle insuffisant pour supprimer une carte.");
  }

  // Lire les données de la carte
  const carte = db.prepare('SELECT sync_id, site_id, centre_id FROM t_cartes WHERE id_carte = ?').get(id) as { sync_id: string | null; site_id: number; centre_id: number } | undefined;
  if (!carte) {
    return { changes: 0 };
  }

  if (currentUser && currentUser.role !== 'SUPER ADMIN' && carte.site_id !== currentUser.site_id) {
    throw new Error("Accès non autorisé aux données de ce site");
  }

  // Trace d'audit
  insertAuditLog(
    currentUser?.login || 'ADMIN',
    'VALIDATION',
    `[SUPPRESSION] Par ${currentUser?.login || 'ADMIN'} sur t_cartes (ID: ${id})`
  );

  // 2. Marquer la carte en pending_delete local (is_dirty = -1) au lieu de la supprimer physiquement
  const result = db.prepare("UPDATE t_cartes SET is_dirty = -1, updated_at = datetime('now') WHERE id_carte = ?").run(id);
  if (result.changes === 0) {
    throw new Error("Accès non autorisé aux données de ce site");
  }

  // 3. Enfilage Outbox DELETE
  if (carte.sync_id) {
    const wasLocalOnly = cancelPendingInsert(carte.sync_id, 't_cartes');
    if (!wasLocalOnly) {
      enqueueOutbox(carte.sync_id, 't_cartes', 'DELETE', { sync_id: carte.sync_id });
      if (networkMonitor.getState() === 'ONLINE') {
        scheduleOutboxProcessing();
      }
    } else {
      // Si la carte n'a jamais été synchronisée (local uniquement), suppression physique immédiate
      db.prepare('DELETE FROM t_cartes WHERE id_carte = ?').run(id);
    }
  }

  return result;
}

export function delivrerCarte(
  id: number, 
  data: { nom_retirant: string; num_retirant: string; contact_retirant?: string; agent_distributeur: string; centre_retrait?: string; rangement?: string }, 
  currentUser?: { role: string; site_id?: number }
) {
  const db = getDatabase()!;
  const now = new Date().toISOString();
  const query = `
    UPDATE t_cartes SET
      statut = 'DELIVRE',
      date_delivrance = @now,
      nom_retirant = @nom_retirant,
      num_retirant = @num_retirant,
      contact_retirant = @contact_retirant,
      agent_distributeur = @agent_distributeur,
      centre_retrait = @centre_retrait,
      rangement = COALESCE(@rangement, rangement),
      updated_at = @now,
      is_dirty = 1
    WHERE id_carte = @id
  `;
  const params: any = { 
    id,
    nom_retirant: data.nom_retirant,
    num_retirant: data.num_retirant,
    contact_retirant: data.contact_retirant || null,
    agent_distributeur: data.agent_distributeur,
    centre_retrait: data.centre_retrait || null,
    rangement: data.rangement || null,
    now
  };
  const result = db.prepare(query).run(params);
  if (result.changes === 0) {
    throw new Error("Carte introuvable ou déjà distribuée.");
  }
  return result;
}

export function transfererCarte(
  id: number, 
  data: { centre_id: number; rangement?: string; agent_transfert: string }
) {
  const db = getDatabase()!;
  const now = new Date().toISOString();
  
  const query = `
    UPDATE t_cartes SET
      centre_id = @centre_id,
      rangement = COALESCE(@rangement, rangement),
      updated_at = @now,
      is_dirty = 1
    WHERE id_carte = @id AND statut = 'EN STOCK'
  `;
  const params: any = { 
    id,
    centre_id: data.centre_id,
    rangement: data.rangement || null,
    now
  };
  const result = db.prepare(query).run(params);
  if (result.changes === 0) {
    throw new Error("Carte introuvable ou n'est plus EN STOCK.");
  }
  return result;
}

export function getExportRows(filters?: Record<string, string>) {
  const db = getDatabase()!;
  let where = 'WHERE 1=1';
  const params: Record<string, any> = {};

  if (filters?.site_id) {
    where += ' AND site_id = @siteId';
    params.siteId = Number(filters.site_id);
  }
  if (filters?.statut) {
    where += ' AND statut = @statut';
    params.statut = filters.statut;
  }
  if (filters?.export_status === 'exported') {
    where += ' AND is_exported = 1';
  } else if (filters?.export_status === 'pending') {
    where += ' AND (is_exported = 0 OR is_exported IS NULL)';
  }

  return db.prepare(`
    SELECT noms, prenoms, date_de_naissance, lieu_de_naissance, num_secu,
      contact, rangement, statut, date_delivrance, nom_retirant, num_retirant,
      agent_saisie, agent_distributeur, centre_retrait, created_at, site_id, cle_doublon
    FROM t_cartes ${where}
    ORDER BY id_carte
  `).all(params);
}

export function getDistinctRangements(siteId?: number) {
  const db = getDatabase()!;
  let query = `
    SELECT DISTINCT rangement 
    FROM t_cartes 
    WHERE rangement IS NOT NULL AND rangement != '' AND rangement != 'NON CLASSE'
  `;
  const params: Record<string, any> = {};
  if (siteId) {
    query += ' AND site_id = @siteId';
    params.siteId = siteId;
  }
  query += ' ORDER BY rangement ASC';
  return db.prepare(query).all(params).map((row: any) => row.rangement);
}

export function marquerCartesExporte(ids: number[]) {
  const db = getDatabase()!;
  const now = new Date().toISOString();
  const stmt = db.prepare('UPDATE t_cartes SET is_exported = 1, is_dirty = 1, updated_at = ? WHERE id_carte = ?');
  const runTx = db.transaction((idList: number[]) => {
    for (const id of idList) {
      stmt.run(now, id);
    }
  });
  runTx(ids);
}

export function exportCartes(ids: number[]) {
  return marquerCartesExporte(ids);
}


export function getInvalidDateRecords(siteId?: number) {
  const db = getDatabase()!;
  let query = "SELECT * FROM t_cartes WHERE (date_de_naissance NOT REGEXP '^\\d{4}-\\d{2}-\\d{2}$' OR date_de_naissance IS NULL OR date_de_naissance = '')";
  const params: any[] = [];
  if (siteId) {
    query += ' AND site_id = ?';
    params.push(siteId);
  }
  query += ' ORDER BY id_carte DESC';
  return db.prepare(query).all(...params);
}

export function updateDateDeNaissance(id: number, newDate: string) {
  const db = getDatabase()!;
  const now = new Date().toISOString();

  // Vérifier si la fiche correspond à une anomalie d'importation (DLQ)
  const anomaly = db.prepare('SELECT * FROM t_import_anomalies WHERE id = ?').get(id) as any;

  if (anomaly) {
    const runTx = db.transaction(() => {
      const noms = removeAccents(anomaly.noms || '');
      const prenoms = removeAccents(anomaly.prenoms || '');
      const ddn = newDate;
      const lieuN = removeAccents(anomaly.lieu_de_naissance || '');
      const contact = normalizeContact(anomaly.contact || '');
      
      const cleDbl = `${noms}|${prenoms}|${ddn}|${lieuN}|${contact}`;
      const cleFlex = `${noms}|${prenoms}|${ddn}|${contact}`;
      const syncId = uuidv4();

      db.prepare(`
        INSERT INTO t_cartes (
          noms, prenoms, date_de_naissance, lieu_de_naissance, num_secu,
          lieu_enrolement, contact, rangement, statut, agent_saisie,
          cle_doublon, cle_doublon_flex, sync_id, site_id, created_at, updated_at, is_dirty, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
      `).run(
        noms,
        prenoms,
        ddn,
        lieuN,
        anomaly.num_secu || null,
        removeAccents(anomaly.lieu_enrolement || ''),
        contact,
        removeAccents(anomaly.rangement || ''),
        anomaly.statut || 'EN STOCK',
        'CORRECTION',
        cleDbl,
        cleFlex,
        syncId,
        anomaly.site_id,
        now,
        now,
        'CORRECTION'
      );

      db.prepare('DELETE FROM t_import_anomalies WHERE id = ?').run(id);
    });

    const res = runTx();
    console.log(`[CORRECTION DIAGNOSTIC] ✨ Anomalie ID ${id} corrigée. Carte transférée avec succès vers t_cartes et purgée de la DLQ.`);
    return res;
  }

  return db.prepare(`
    UPDATE t_cartes 
    SET date_de_naissance = ?, updated_at = ?, is_dirty = 1 
    WHERE id_carte = ?
  `).run(newDate, now, id);
}

export function getDoublonsStrictsPage(siteId: number, offset: number, limit: number, query?: string) {
  const db = getDatabase()!;
  let where = "WHERE site_id = ? AND cle_doublon IS NOT NULL AND cle_doublon != '' AND cle_doublon != '||||'";
  const params: any[] = [siteId];

  if (query && query.trim()) {
    where += " AND (noms LIKE ? OR prenoms LIKE ? OR contact LIKE ?)";
    params.push(`%${query}%`, `%${query}%`, `%${query}%`);
  }

  const totalRow = db.prepare(`
    SELECT COUNT(*) as count FROM (
      SELECT cle_doublon FROM t_cartes ${where} GROUP BY cle_doublon HAVING COUNT(*) > 1
    )
  `).get(...params) as { count: number };
  const total = totalRow?.count || 0;

  const duplicateKeys = db.prepare(`
    SELECT cle_doublon, COUNT(*) as count 
    FROM t_cartes 
    ${where}
    GROUP BY cle_doublon 
    HAVING COUNT(*) > 1
    ORDER BY count DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as { cle_doublon: string, count: number }[];

  const rows: any[] = [];
  if (duplicateKeys.length > 0) {
    const keys = duplicateKeys.map(k => k.cle_doublon);
    const placeholders = keys.map(() => '?').join(',');
    const sql = `SELECT * FROM t_cartes WHERE site_id = ? AND cle_doublon IN (${placeholders}) ORDER BY cle_doublon, id_carte`;
    rows.push(...db.prepare(sql).all(siteId, ...keys));
  }

  return { rows, total };
}

export function getDoublonsProbablesPage(siteId: number, offset: number, limit: number, query?: string) {
  const db = getDatabase()!;
  
  let filterClause = "";
  const filterParams: any[] = [];
  if (query && query.trim()) {
    filterClause = " AND (noms LIKE ? OR prenoms LIKE ? OR contact LIKE ?)";
    filterParams.push(`%${query}%`, `%${query}%`, `%${query}%`);
  }

  const totalQuery = `
    SELECT COUNT(*) as count FROM (
      SELECT noms, prenoms, date_de_naissance
      FROM t_cartes
      WHERE site_id = ? ${filterClause}
      GROUP BY noms, prenoms, date_de_naissance
      HAVING COUNT(DISTINCT cle_doublon) > 1
    )
  `;
  const totalRow = db.prepare(totalQuery).get(siteId, ...filterParams) as { count: number };
  const total = totalRow?.count || 0;

  const groupsQuery = `
    SELECT noms, prenoms, date_de_naissance
    FROM t_cartes
    WHERE site_id = ? ${filterClause}
    GROUP BY noms, prenoms, date_de_naissance
    HAVING COUNT(DISTINCT cle_doublon) > 1
    ORDER BY noms ASC, prenoms ASC
    LIMIT ? OFFSET ?
  `;
  const groups = db.prepare(groupsQuery).all(siteId, ...filterParams, limit, offset) as any[];

  const rows: any[] = [];
  if (groups.length > 0) {
    const subClauses: string[] = [];
    const subParams: any[] = [siteId];
    
    groups.forEach(g => {
      subClauses.push("(noms = ? AND prenoms = ? AND date_de_naissance = ?)");
      subParams.push(g.noms, g.prenoms, g.date_de_naissance);
    });

    const sql = `
      SELECT * 
      FROM t_cartes 
      WHERE site_id = ? 
        AND (${subClauses.join(' OR ')})
      ORDER BY noms ASC, prenoms ASC, id_carte ASC
    `;
    rows.push(...db.prepare(sql).all(...subParams));
  }

  return { rows, total };
}

export function getSansNumSecuPage(siteId: number, offset: number, limit: number, query?: string) {
  const db = getDatabase()!;
  let where = "WHERE site_id = ? AND (num_secu IS NULL OR num_secu = '' OR num_secu LIKE '-%')";
  const params: any[] = [siteId];

  if (query && query.trim()) {
    where += " AND (noms LIKE ? OR prenoms LIKE ? OR contact LIKE ?)";
    params.push(`%${query}%`, `%${query}%`, `%${query}%`);
  }

  const countQuery = `SELECT COUNT(*) as count FROM t_cartes ${where}`;
  const total = getCachedCount(db, countQuery, params) || 0;
  
  const rows = db.prepare(`SELECT * FROM t_cartes ${where} ORDER BY id_carte DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);

  return { rows, total };
}

export function getSansRangementPage(siteId: number, offset: number, limit: number, query?: string) {
  const db = getDatabase()!;
  let where = "WHERE site_id = ? AND (rangement IS NULL OR rangement = '' OR rangement = 'NON CLASSE')";
  const params: any[] = [siteId];

  if (query && query.trim()) {
    where += " AND (noms LIKE ? OR prenoms LIKE ? OR contact LIKE ?)";
    params.push(`%${query}%`, `%${query}%`, `%${query}%`);
  }

  const countQuery = `SELECT COUNT(*) as count FROM t_cartes ${where}`;
  const total = getCachedCount(db, countQuery, params) || 0;

  const rows = db.prepare(`SELECT * FROM t_cartes ${where} ORDER BY id_carte DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);

  return { rows, total };
}

export function getSansNomPage(siteId: number, offset: number, limit: number, query?: string) {
  const db = getDatabase()!;
  let where = "WHERE site_id = ? AND (noms IS NULL OR noms = '')";
  const params: any[] = [siteId];

  if (query && query.trim()) {
    where += " AND (prenoms LIKE ? OR num_secu LIKE ? OR contact LIKE ?)";
    params.push(`%${query}%`, `%${query}%`, `%${query}%`);
  }

  const countQuery = `SELECT COUNT(*) as count FROM t_cartes ${where}`;
  const total = getCachedCount(db, countQuery, params) || 0;

  const rows = db.prepare(`SELECT * FROM t_cartes ${where} ORDER BY id_carte DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);

  return { rows, total };
}

export function getSansPrenomPage(siteId: number, offset: number, limit: number, query?: string) {
  const db = getDatabase()!;
  let where = "WHERE site_id = ? AND (prenoms IS NULL OR prenoms = '')";
  const params: any[] = [siteId];

  if (query && query.trim()) {
    where += " AND (noms LIKE ? OR num_secu LIKE ? OR contact LIKE ?)";
    params.push(`%${query}%`, `%${query}%`, `%${query}%`);
  }

  const countQuery = `SELECT COUNT(*) as count FROM t_cartes ${where}`;
  const total = getCachedCount(db, countQuery, params) || 0;

  const rows = db.prepare(`SELECT * FROM t_cartes ${where} ORDER BY id_carte DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);

  return { rows, total };
}

export function updateQuickFields(id: number, fields: { num_secu?: string, rangement?: string }) {
  const db = getDatabase()!;
  const now = new Date().toISOString();
  const sets: string[] = ['updated_at = ?', 'is_dirty = 1'];
  const params: any[] = [now];

  if (fields.num_secu !== undefined) {
    sets.push('num_secu = ?');
    params.push(fields.num_secu.trim());
  }
  if (fields.rangement !== undefined) {
    sets.push('rangement = ?');
    params.push(fields.rangement.trim().toUpperCase());
  }

  params.push(id);
  return db.prepare(`UPDATE t_cartes SET ${sets.join(', ')} WHERE id_carte = ?`).run(...params);
}

export function searchQuickLogistique(siteId: number, critere: string) {
  const db = getDatabase()!;
  const cleaned = critere.trim();
  if (!cleaned) return [];

  const searchPattern = `%${cleaned}%`;
  
  return db.prepare(`
    SELECT id_carte, noms, prenoms, date_de_naissance, lieu_de_naissance, num_secu, rangement, statut, statut_physique
    FROM t_cartes
    WHERE site_id = ? 
      AND (
        UPPER(num_secu) = UPPER(?) 
        OR contact = ? 
        OR date_de_naissance = ? 
        OR (noms || " " || prenoms LIKE ?) 
        OR (prenoms || " " || noms LIKE ?)
        OR lieu_de_naissance LIKE ?
      )
    ORDER BY noms ASC, prenoms ASC
    LIMIT 20
  `).all(siteId, cleaned, cleaned, cleaned, searchPattern, searchPattern, searchPattern);
}

export function updateRangementEtFiche(id: number, fields: { rangement: string, num_secu?: string }) {
  const db = getDatabase()!;
  const now = new Date().toISOString();
  const sets: string[] = ['updated_at = ?', 'is_dirty = 1', 'rangement = ?'];
  const params: any[] = [now, fields.rangement.trim().toUpperCase()];

  if (fields.num_secu !== undefined) {
    sets.push('num_secu = ?');
    params.push(fields.num_secu.trim());
  }

  params.push(id);
  return db.prepare(`UPDATE t_cartes SET ${sets.join(', ')} WHERE id_carte = ?`).run(...params);
}

export function searchCombinedInventaire(siteId: number, queryNomsPrenoms: string, dateNaissance?: string, lieuNaissance?: string) {
  const db = getDatabase()!;
  let where = 'WHERE site_id = ?';
  const params: any[] = [siteId];

  const cleanedQuery = queryNomsPrenoms.trim();
  if (cleanedQuery) {
    where += ' AND (noms || " " || prenoms LIKE ? OR prenoms || " " || noms LIKE ?)';
    params.push(`%${cleanedQuery}%`, `%${cleanedQuery}%`);
  }

  if (dateNaissance && dateNaissance.trim()) {
    where += ' AND date_de_naissance = ?';
    params.push(dateNaissance.trim());
  }

  if (lieuNaissance && lieuNaissance.trim()) {
    where += ' AND lieu_de_naissance LIKE ?';
    params.push(`%${lieuNaissance.trim()}%`);
  }

  return db.prepare(`
    SELECT id_carte, noms, prenoms, date_de_naissance, lieu_de_naissance, num_secu, rangement, statut, statut_physique
    FROM t_cartes
    ${where}
    ORDER BY noms ASC, prenoms ASC
    LIMIT 20
  `).all(...params);
}

export function updateApurementHistorique(id: number, fields: { date_delivrance: string, nom_retirant: string, num_retirant: string, relation_retirant: string, agent_distributeur: string }) {
  const db = getDatabase()!;
  const now = new Date().toISOString();
  
  return db.prepare(`
    UPDATE t_cartes 
    SET statut = 'DELIVRE',
        date_delivrance = ?,
        nom_retirant = ?,
        num_retirant = ?,
        relation_retirant = ?,
        agent_distributeur = ?,
        updated_at = ?,
        is_dirty = 1
    WHERE id_carte = ?
  `).run(
    fields.date_delivrance,
    fields.nom_retirant.trim().toUpperCase(),
    fields.num_retirant.trim(),
    fields.relation_retirant.trim(),
    fields.agent_distributeur.trim(),
    now,
    id
  );
}

export function updateCarteRangementAndStatusRapid(identifiant: string, rangement: string) {
  const db = getDatabase()!;
  const now = new Date().toISOString();
  const cleanedId = identifiant.trim().toUpperCase();
  const targetRangement = rangement.trim().toUpperCase();

  // Search for the card by num_secu (or id_carte if it's the sync_id/cle_doublon, but assuming num_secu or similar unique field)
  const carte = db.prepare(`SELECT id_carte, noms, prenoms, num_secu, rangement FROM t_cartes WHERE UPPER(num_secu) = ? LIMIT 1`).get(cleanedId) as any;
  
  if (!carte) {
    return { success: false, message: "Carte introuvable avec cet identifiant." };
  }

  db.prepare(`
    UPDATE t_cartes
    SET statut = 'EN STOCK',
        rangement = ?,
        updated_at = ?,
        is_dirty = 1
    WHERE id_carte = ?
  `).run(targetRangement, now, carte.id_carte);

  return { 
    success: true, 
    carte: {
      ...carte,
      rangement: targetRangement
    }
  };
}
