import { getDatabase } from '../database/connection';
import { hashPassword, verifyPassword } from '../auth/local-auth';
import { v4 as uuidv4 } from 'uuid';
import log from 'electron-log';
import type Database from 'better-sqlite3';
import { getSupabaseClient } from '../sync/supabase-client';
import { networkMonitor } from '../sync/network-monitor';

// ============================================================
// CARTES QUERIES
// ============================================================

export function getCartesPage(offset: number, limit: number, filters?: Record<string, string>) {
  const db = getDatabase()!;
  let where = 'WHERE 1=1';
  const params: any = {};

  if (filters?.statut) { where += ' AND statut = @statut'; params.statut = filters.statut; }
  if (filters?.site_id) { where += ' AND site_id = @site_id'; params.site_id = Number(filters.site_id); }
  if (filters?.centre_id) { where += ' AND centre_id = @centre_id'; params.centre_id = Number(filters.centre_id); }
  if (filters?.rangement) { where += " AND rangement LIKE @rangement"; params.rangement = `%${filters.rangement}%`; }
  if (filters?.statut_physique) { where += ' AND statut_physique = @statut_physique'; params.statut_physique = filters.statut_physique; }
  
  // Recherche globale (noms, prénoms, num_secu, contact)
  if (filters?.q || filters?.search) {
    const q = filters.q || filters.search;
    where += ' AND (noms LIKE @q OR prenoms LIKE @q OR num_secu LIKE @q OR contact LIKE @q OR lieu_de_naissance LIKE @q OR rangement LIKE @q)';
    params.q = `%${q}%`;
  }

  const totalResult = db.prepare(`SELECT COUNT(*) as count FROM t_cartes ${where}`).get(params) as { count: number };
  const rows = db.prepare(`SELECT * FROM t_cartes ${where} ORDER BY id_carte DESC LIMIT @limit OFFSET @offset`)
    .all({ ...params, limit, offset });

  return { rows, total: totalResult.count, offset, limit };
}

export function searchCartesFTS(query: string, limit = 100, filters?: Record<string, string>) {
  const db = getDatabase()!;
  
  const params: Record<string, any> = { limit };
  let hasFilters = false;
  let filtersSql = '';

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
      // Sécurité : Si le Renderer a déjà envoyé un pattern avec des %, on le prend tel quel, sinon on l'encapsule
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

  console.log("🗄️ [MAIN PROCESS - SQL] Requête exécutée sur SQLite local. Paramètres résolus :", {
    query,
    filters,
    resolvedParams: params
  });

  if (!query.trim()) {
    if (!hasFilters) return [];
    
    // Fallback to normal query if no FTS text query is provided but filters exist
    let nonFtsQuery = `SELECT t_cartes.*, t_sites.nom as site_nom, t_centres.nom as centre_nom FROM t_cartes LEFT JOIN t_sites ON t_cartes.site_id = t_sites.id LEFT JOIN t_centres ON t_cartes.centre_id = t_centres.id WHERE 1=1`;
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
    const row = db.prepare('SELECT * FROM t_cartes WHERE id_carte = ? AND site_id = ?').get(id, currentUser.site_id);
    if (!row) throw new Error("Accès non autorisé aux données de ce site");
    return row;
  }
  return db.prepare('SELECT * FROM t_cartes WHERE id_carte = ?').get(id);
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

  return { id: result.lastInsertRowid, sync_id: syncId };
}

export function updateCarte(id: number, data: Record<string, unknown>, currentUser?: { role: string; site_id?: number }) {
  const db = getDatabase()!;
  const now = new Date().toISOString();
  const fields = Object.keys(data).map(k => `${k} = @${k}`).join(', ');
  
  let query = `UPDATE t_cartes SET ${fields}, updated_at = @updated_at, is_dirty = 1 WHERE id_carte = @id`;
  const params: any = { ...data, updated_at: now, id };
  
  if (currentUser && currentUser.role !== 'SUPER ADMIN') {
    query += ' AND site_id = @site_id';
    params.site_id = currentUser.site_id;
  }
  
  const result = db.prepare(query).run(params);
  if (result.changes === 0) {
    throw new Error("Accès non autorisé aux données de ce site");
  }
  return result;
}

export function deleteCarte(id: number, currentUser?: { role: string; site_id?: number }) {
  const db = getDatabase()!;
  let query = 'DELETE FROM t_cartes WHERE id_carte = ?';
  const params: any[] = [id];
  if (currentUser && currentUser.role !== 'SUPER ADMIN') {
    query += ' AND site_id = ?';
    params.push(currentUser.site_id);
  }
  const result = db.prepare(query).run(...params);
  if (result.changes === 0) {
    throw new Error("Accès non autorisé aux données de ce site");
  }
  return result;
}

export function delivrerCarte(
  id: number, 
  data: { nom_retirant: string; num_retirant: string; agent_distributeur: string; centre_retrait?: string }, 
  currentUser?: { role: string; site_id?: number }
) {
  const db = getDatabase()!;
  const now = new Date().toISOString();
  let query = `
    UPDATE t_cartes SET
      statut = 'DELIVRE',
      date_delivrance = @now,
      nom_retirant = @nom_retirant,
      num_retirant = @num_retirant,
      agent_distributeur = @agent_distributeur,
      centre_retrait = @centre_retrait,
      updated_at = @now,
      is_dirty = 1
    WHERE id_carte = @id
  `;
  const params: any = { 
    id,
    nom_retirant: data.nom_retirant,
    num_retirant: data.num_retirant,
    agent_distributeur: data.agent_distributeur,
    centre_retrait: data.centre_retrait || null,
    now 
  };
  if (currentUser && currentUser.role !== 'SUPER ADMIN') {
    query += ' AND site_id = @site_id';
    params.site_id = currentUser.site_id;
  }
  const result = db.prepare(query).run(params);
  if (result.changes === 0) {
    throw new Error("Accès non autorisé aux données de ce site");
  }
  return result;
}

export function signalerAbsence(id: number, agent: string, currentUser?: { role: string; site_id?: number; id_user?: number }) {
  const db = getDatabase()!;
  const now = new Date().toISOString();
  let query = `
    UPDATE t_cartes SET statut_physique = 'ABSENT',
      agent_signalement_absence = @agent, date_signalement_absence = @now,
      updated_at = @now, is_dirty = 1
    WHERE id_carte = @id
  `;
  const params: any = { agent, now, id };
  if (currentUser && currentUser.role !== 'SUPER ADMIN') {
    query += ' AND site_id = @site_id';
    params.site_id = currentUser.site_id;
  }
  const result = db.prepare(query).run(params);
  if (result.changes === 0) {
    throw new Error("Accès non autorisé aux données de ce site");
  }

  const card = db.prepare('SELECT site_id, noms, prenoms FROM t_cartes WHERE id_carte = ?').get(id) as any;
  if (card) {
    const siteId = card.site_id;
    const message = `🚨 [SIGNALEMENT - ABSENCE] La carte de ${card.noms} ${card.prenoms} est signalée absente par ${agent}.`;
    const userId = currentUser?.id_user || null;
    const userLogin = agent;
    const logPayload = JSON.stringify({ read: false, id_carte: id });

    try {
      db.prepare(`
        INSERT INTO t_logs (id_user, login_user, action, detail, valeur_apres, sync_id, is_dirty, site_id)
        VALUES (?, ?, 'CARTE_ABSENTE_SIGNALEE', ?, ?, ?, 1, ?)
      `).run(userId, userLogin, message, logPayload, uuidv4(), siteId);

      const { BrowserWindow } = require('electron');
      const windows = BrowserWindow.getAllWindows();
      if (windows.length > 0) {
        windows[0].webContents.send('sync:updated-data', { type: 'ABSENCE_SIGNALEE' });
      }
    } catch (err) {
      log.error('Failed to log or notify CARTE_ABSENTE_SIGNALEE:', err);
    }
  }

  return result;
}

export function getAbsencesReportees(siteId?: number) {
  const db = getDatabase()!;
  if (siteId) {
    return db.prepare(`
      SELECT * FROM t_cartes 
      WHERE statut_physique = 'ABSENT' AND site_id = ?
      ORDER BY date_signalement_absence DESC
    `).all(siteId);
  }
  return db.prepare(`
    SELECT * FROM t_cartes 
    WHERE statut_physique = 'ABSENT' 
    ORDER BY date_signalement_absence DESC
  `).all();
}

export function resoudreAbsence(
  id: number, 
  data: { status: string, agent: string, note: string, rangement?: string }, 
  currentUser?: { role: string; site_id?: number }
) {
  const db = getDatabase()!;
  const now = new Date().toISOString();
  let query = `
    UPDATE t_cartes SET 
      statut_physique = @status,
      agent_resolution_absence = @agent,
      date_resolution_absence = @now,
      note_resolution = @note,
      rangement = COALESCE(@rangement, rangement),
      updated_at = @now,
      is_dirty = 1
    WHERE id_carte = @id
  `;
  const params: any = { ...data, now, id, rangement: data.rangement || null };
  if (currentUser && currentUser.role !== 'SUPER ADMIN') {
    query += ' AND site_id = @site_id';
    params.site_id = currentUser.site_id;
  }
  const result = db.prepare(query).run(params);
  if (result.changes === 0) {
    throw new Error("Accès non autorisé aux données de ce site");
  }

  const card = db.prepare('SELECT site_id, noms, prenoms, rangement, contact, agent_signalement_absence FROM t_cartes WHERE id_carte = ?').get(id) as any;
  if (card) {
    const siteId = card.site_id;
    const message = `Carte de ${card.noms} ${card.prenoms} retrouvée (Rangement: ${card.rangement || 'non spécifié'}) par ${data.agent}.`;

    try {
      const unreadLog = db.prepare(`
        SELECT id_log FROM t_logs 
        WHERE action = 'CARTE_ABSENTE_SIGNALEE' 
        AND json_extract(valeur_apres, '$.read') = false
        AND json_extract(valeur_apres, '$.id_carte') = ?
      `).get(id) as { id_log: number } | undefined;

      if (unreadLog) {
        db.prepare(`
          UPDATE t_logs 
          SET valeur_apres = '{"read": true}', is_dirty = 1 
          WHERE id_log = ?
        `).run(unreadLog.id_log);
      } else {
        log.error("Log introuvable pour la carte ID:", id);
      }

      const payload = {
        read: false,
        noms: card.noms,
        prenoms: card.prenoms,
        rangement: card.rangement,
        contact: card.contact,
        site_id: siteId
      };
      db.prepare(`
        INSERT INTO t_logs (id_user, login_user, action, detail, valeur_apres, sync_id, is_dirty, site_id)
        VALUES (NULL, 'SYSTEM', 'CARTE_ABSENTE_RETROUVEE', ?, ?, ?, 1, ?)
      `).run(message, JSON.stringify(payload), uuidv4(), siteId);

      const { BrowserWindow } = require('electron');
      const windows = BrowserWindow.getAllWindows();
      if (windows.length > 0) {
        windows[0].webContents.send('sync:updated-data', { type: 'ABSENCE_RESOLUE' });
      }
    } catch (err) {
      log.error('Failed to log or notify CARTE_ABSENTE_RETROUVEE:', err);
    }
  }

  return result;
}

export function getInvalidDateRecords(siteId?: number) {
  const db = getDatabase()!;
  if (siteId) {
    return db.prepare(`
      SELECT * FROM t_cartes 
      WHERE date_de_naissance NOT REGEXP '^\\d{4}-\\d{2}-\\d{2}$'
      AND site_id = ?
      LIMIT 500
    `).all(siteId);
  }
  return db.prepare(`
    SELECT * FROM t_cartes 
    WHERE date_de_naissance NOT REGEXP '^\\d{4}-\\d{2}-\\d{2}$'
    LIMIT 500
  `).all();
}

export function updateDateDeNaissance(id: number, newDate: string) {
  const db = getDatabase()!;
  const now = new Date().toISOString();
  return db.prepare(`
    UPDATE t_cartes SET date_de_naissance = @newDate, updated_at = @now, is_dirty = 1
    WHERE id_carte = @id
  `).run({ newDate, now, id });
}

// ============================================================
// EXPORT
// ============================================================

export function exportCartes(filters?: Record<string, string>) {
  const db = getDatabase()!;
  let where = 'WHERE 1=1';
  const params: Record<string, any> = {};

  if (filters?.site_id) { where += ' AND site_id = @site_id'; params.site_id = parseInt(filters.site_id); }
  if (filters?.statut && filters.statut !== 'ALL') {
    if (filters.statut === 'SANS_RANGEMENT') {
      where += " AND (rangement IS NULL OR rangement = '' OR rangement = 'NON CLASSE')";
    } else if (filters.statut === 'SANS_SECU') {
      where += " AND (num_secu IS NULL OR length(num_secu) < 13)";
    } else {
      where += ' AND statut = @statut'; 
      params.statut = filters.statut;
    }
  }
  if (filters?.incremental === 'true') {
    where += ' AND is_exported = 0';
  }
  if (filters?.rangement && filters.rangement !== 'ALL') {
    where += ' AND rangement = @rangement_filter';
    params.rangement_filter = filters.rangement;
  }

  return db.prepare(`
    SELECT id_carte, noms, prenoms, date_de_naissance, lieu_de_naissance, num_secu,
      lieu_enrolement, contact, rangement, statut, statut_physique,
      date_delivrance, nom_retirant, num_retirant, agent_saisie,
      agent_distributeur, centre_retrait, created_at, site_id, cle_doublon
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

// ============================================================
// IMPORT ENGINE
// ============================================================

export function clearImportTemp(siteId: number) {
  return getDatabase()!.prepare('DELETE FROM t_import_temp').run();
}

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
  // Nettoyer tous les caractères non numériques
  let cleaned = contactStr.replace(/\D/g, '');
  
  // Si le numéro commence par 00225 ou +225 (225 après nettoyage)
  if (cleaned.startsWith('225') && cleaned.length > 10) {
    cleaned = cleaned.substring(3);
  }
  
  // Conserver uniquement les 10 derniers chiffres (format ivoirien standard)
  if (cleaned.length > 10) {
    cleaned = cleaned.substring(cleaned.length - 10);
  }
  
  return cleaned;
}

export function importBatch(rows: Record<string, string>[], agentSaisie: string, siteId: number) {
  const db = getDatabase()!;
  const insertStmt = db.prepare(`
    INSERT INTO t_import_temp (noms, prenoms, date_de_naissance, num_secu,
      lieu_de_naissance, contact, lieu_enrolement, rangement, statut,
      date_delivrance, agent_saisie, cle_doublon, cle_doublon_flex,
      nom_retirant, num_retirant, site_id)
    VALUES (@noms, @prenoms, @date_de_naissance, @num_secu,
      @lieu_de_naissance, @contact, @lieu_enrolement, @rangement, @statut,
      @date_delivrance, @agent_saisie, @cle_doublon, @cle_doublon_flex,
      @nom_retirant, @num_retirant, @siteId)
  `);

  const insertMany = db.transaction((items: Record<string, string>[]) => {
    for (const row of items) {
      const noms = removeAccents(row.noms || '');
      const prenoms = removeAccents(row.prenoms || '');
      const ddn = row.date_de_naissance || '';
      const lieuN = removeAccents(row.lieu_de_naissance || '');
      const contact = normalizeContact(row.contact || '');
      
      const cleDbl = `${noms}|${prenoms}|${ddn}|${lieuN}|${contact}`;
      const cleFlex = `${noms}|${prenoms}|${ddn}|${contact}`;

      const rawStatut = removeAccents((row.statut || '').toUpperCase().trim());
      let finalStatut = 'EN STOCK';
      let nomRetirant = null;
      let numRetirant = null;

      if (rawStatut.startsWith('DELIV') || 
          rawStatut.startsWith('DISTRIB') || 
          rawStatut.startsWith('REMI') || 
          rawStatut === 'OK' || 
          rawStatut === 'RECU' ||
          rawStatut.startsWith('RETIRE')) {
        finalStatut = 'DELIVRE';
      } else if (rawStatut === 'ANNULE') {
        finalStatut = 'ANNULE';
      } else if (rawStatut === 'STOCK' || rawStatut === 'EN STOCK' || !rawStatut) {
        finalStatut = 'EN STOCK';
      }

      if (rawStatut.startsWith('RETIRE PAR')) {
        finalStatut = 'DELIVRE';
        const detail = rawStatut.replace('RETIRE PAR', '').trim();
        
        if (detail === 'LUI MEME' || detail === 'ELLE MEME') {
          nomRetirant = `${noms} ${prenoms}`;
          numRetirant = contact;
        } else {
          const phoneMatch = detail.match(/(?:(?:\+|00)225)?\s?(\d[\s\.]?\d[\s\.]?\d[\s\.]?\d[\s\.]?\d[\s\.]?\d[\s\.]?\d[\s\.]?\d[\s\.]?\d?)/);
          if (phoneMatch) {
            numRetirant = phoneMatch[0].replace(/[\s\.]/g, '');
            nomRetirant = detail.replace(phoneMatch[0], '').replace(/[,]/g, '').trim();
          } else {
            nomRetirant = detail;
            numRetirant = contact;
          }
        }
      }

      insertStmt.run({
        noms, prenoms, date_de_naissance: ddn,
        num_secu: (row.num_secu || '').trim(),
        lieu_de_naissance: lieuN,
        contact,
        lieu_enrolement: (row.lieu_enrolement || '').toUpperCase().trim(),
        rangement: (row.rangement || '').toUpperCase().trim(),
        statut: finalStatut,
        date_delivrance: row.date_delivrance || (finalStatut === 'DELIVRE' ? new Date().toISOString().split('T')[0] : ''),
        agent_saisie: agentSaisie,
        cle_doublon: cleDbl,
        cle_doublon_flex: cleFlex,
        nom_retirant: nomRetirant,
        num_retirant: numRetirant,
        siteId
      });
    }
  });

  insertMany(rows);
  return rows.length;
}

export function fusionnerImport(siteId: number) {
  const db = getDatabase()!;
  const now = new Date().toISOString();

  // 1. Update existing cards for this site
  const updateResult = db.prepare(`
    UPDATE t_cartes
    SET 
      statut = t_import_temp.statut,
      nom_retirant = t_import_temp.nom_retirant,
      num_retirant = t_import_temp.num_retirant,
      date_delivrance = COALESCE(t_cartes.date_delivrance, t_import_temp.date_delivrance),
      updated_at = @now,
      is_dirty = 1
    FROM t_import_temp
    WHERE t_cartes.cle_doublon = t_import_temp.cle_doublon
      AND t_cartes.site_id = @siteId
      AND t_import_temp.site_id = @siteId
      AND (t_cartes.statut = 'EN STOCK' OR t_cartes.statut IS NULL OR t_cartes.statut = '')
      AND t_import_temp.statut = 'DELIVRE'
  `).run({ now, siteId });

  // 2. Insert new cards for this site
  const insertResult = db.prepare(`
    INSERT INTO t_cartes (
      noms, prenoms, date_de_naissance, num_secu, lieu_de_naissance,
      contact, lieu_enrolement, rangement, statut, date_delivrance, agent_saisie,
      cle_doublon, cle_doublon_flex, nom_retirant, num_retirant, site_id, sync_id, created_at, updated_at, is_dirty
    )
    SELECT 
      noms, prenoms, date_de_naissance, num_secu, lieu_de_naissance,
      contact, lieu_enrolement, rangement, statut, date_delivrance, agent_saisie,
      cle_doublon, cle_doublon_flex, nom_retirant, num_retirant, @siteId, lower(hex(randomblob(16))),
      @now, @now, 1
    FROM t_import_temp
    WHERE t_import_temp.site_id = @siteId
      AND cle_doublon NOT IN (SELECT cle_doublon FROM t_cartes WHERE site_id = @siteId AND cle_doublon IS NOT NULL)
  `).run({ now, siteId });

  // 3. Clear temp for this site
  db.prepare('DELETE FROM t_import_temp WHERE site_id = ?').run(siteId);

  return { updated: updateResult.changes, inserted: insertResult.changes };
}

// ============================================================
// STATISTICS
// ============================================================

export async function getStats(siteId?: number) {
  const db = getDatabase()!;
  const where = siteId ? 'WHERE site_id = @siteId' : '';
  const params = siteId ? { siteId } : {};

  const stats = db.prepare(`
    SELECT
      COUNT(*) as total,
      IFNULL(SUM(CASE WHEN statut = 'EN STOCK' OR statut IS NULL OR statut = '' THEN 1 ELSE 0 END), 0) as en_stock,
      IFNULL(SUM(CASE WHEN statut IN ('DELIVRE','DISTRIBUEE','RETIRE') THEN 1 ELSE 0 END), 0) as distribuees,
      IFNULL(SUM(CASE WHEN statut_physique = 'ABSENT' THEN 1 ELSE 0 END), 0) as absentes,
      IFNULL(SUM(CASE WHEN num_secu IS NULL OR num_secu = '' OR num_secu LIKE '-%' THEN 1 ELSE 0 END), 0) as sans_num_secu,
      IFNULL(SUM(CASE WHEN rangement IS NULL OR rangement = '' OR rangement = 'NON CLASSE' THEN 1 ELSE 0 END), 0) as sans_rangement,
      IFNULL(SUM(CASE WHEN date_de_naissance NOT REGEXP '^\\d{4}-\\d{2}-\\d{2}$' OR date_de_naissance IS NULL OR date_de_naissance = '' THEN 1 ELSE 0 END), 0) as dates_invalides
    FROM t_cartes
    ${where}
  `).get(params) as Record<string, number>;

  // Libérer le thread principal
  await new Promise((resolve) => setTimeout(resolve, 10));

  const distribParJour = db.prepare(`
    SELECT date(date_delivrance) as jour, COUNT(*) as count
    FROM t_cartes 
    WHERE date_delivrance IS NOT NULL AND date_delivrance != ''
    ${siteId ? 'AND site_id = @siteId' : ''}
    GROUP BY date(date_delivrance) ORDER BY jour DESC LIMIT 30
  `).all(params);

  // Libérer à nouveau le thread
  await new Promise((resolve) => setTimeout(resolve, 10));

  const distribParCentre = db.prepare(`
    SELECT c.nom as centre, COUNT(t.id_carte) as count
    FROM t_cartes t LEFT JOIN t_centres c ON t.centre_id = c.id
    WHERE t.statut IN ('DELIVRE','DISTRIBUEE','RETIRE')
    ${siteId ? 'AND t.site_id = @siteId' : ''}
    GROUP BY t.centre_id
  `).all(params);

  // Libérer à nouveau le thread
  await new Promise((resolve) => setTimeout(resolve, 10));

  const doublons = db.prepare(`
    SELECT COUNT(*) as count FROM (
      SELECT cle_doublon FROM t_cartes
      ${where}
      ${siteId ? 'AND' : 'WHERE'} cle_doublon IS NOT NULL AND cle_doublon != '' AND cle_doublon != '||||'
      GROUP BY cle_doublon HAVING COUNT(*) > 1
    )
  `).get(params) as { count: number };

  return { ...stats, doublons_stricts: doublons.count, distribParJour, distribParCentre };
}

export function getAgentStatsToday(userId: number) {
  const db = getDatabase()!;
  const row = db.prepare(`
    SELECT COUNT(*) as count 
    FROM t_cartes 
    WHERE created_by = ? AND date(created_at) = date('now')
  `).get(userId) as { count: number };
  return row ? row.count : 0;
}

export function getAgentRecentSaisies(userId: number, limit: number = 15) {
  const db = getDatabase()!;
  return db.prepare(`
    SELECT id_carte, noms, prenoms, num_secu, date_de_naissance, rangement, contact, created_at, statut
    FROM t_cartes
    WHERE created_by = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(userId, limit);
}

export function getSiteSaisieStatsToday(siteId: number) {
  const db = getDatabase()!;
  return db.prepare(`
    SELECT u.id_user, u.login, u.nom_user, u.prenom_user, COUNT(c.id_carte) as total_saisies
    FROM t_users u
    LEFT JOIN t_cartes c ON u.id_user = c.created_by AND date(c.created_at) = date('now')
    WHERE u.site_id = ? AND u.role = 'OPERATEUR_SAISIE'
    GROUP BY u.id_user
    ORDER BY total_saisies DESC
  `).all(siteId);
}

// ============================================================
// USERS
// ============================================================

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
  
  // 1. Essai local
  let user = db.prepare(`
    SELECT u.*, s.is_active as site_active 
    FROM t_users u 
    LEFT JOIN t_sites s ON u.site_id = s.id 
    WHERE LOWER(u.login) = LOWER(?) AND u.statut_actif = 1
  `).get(login) as any;
  
  if (!user) {
    // 2. Fallback Supabase si non trouvé en local et en ligne
    log.info(`authenticateUser: login "${login}" introuvable localement. Essai avec le fallback Supabase...`);
    try {
      const { getSupabaseClient } = await import('../sync/supabase-client');
      const { networkMonitor } = await import('../sync/network-monitor');
      
      if (networkMonitor.getState() !== 'ONLINE') {
        log.warn('authenticateUser: Mode hors-ligne, impossible de contacter Supabase.');
        return null;
      }
      
      const supabase = getSupabaseClient();
      const { data: cloudUser, error } = await supabase
        .from('t_users')
        .select('login, password_hash, role, nom_user, prenom_user, site_id, centre_id, sync_id, statut_actif')
        .ilike('login', login)
        .eq('statut_actif', 1)
        .maybeSingle();
        
      if (error || !cloudUser) {
        log.warn(`authenticateUser: login "${login}" introuvable sur Supabase.`);
        return null;
      }
      
      // Vérification du mot de passe
      const hash = cloudUser.password_hash as string;
      let valid = false;
      if (hash.startsWith('$2')) {
        valid = verifyPassword(password, hash);
      } else {
        valid = password === hash;
      }
      
      if (!valid) {
        log.warn(`authenticateUser: Mot de passe incorrect pour l'utilisateur cloud "${login}".`);
        return null;
      }
      
      log.info(`authenticateUser: Connexion cloud réussie. Insertion locale de "${login}".`);
      seedUserFromCloud(cloudUser as any);
      
      // Récupérer l'utilisateur nouvellement créé localement
      user = db.prepare(`
        SELECT u.*, s.is_active as site_active 
        FROM t_users u 
        LEFT JOIN t_sites s ON u.site_id = s.id 
        WHERE LOWER(u.login) = LOWER(?) AND u.statut_actif = 1
      `).get(login) as any;
      
      if (!user) return null;
    } catch (err) {
      log.error('authenticateUser: Erreur lors du fallback Supabase:', err);
      return null;
    }
  }

  if (user.role !== 'SUPER ADMIN' && user.site_id && user.site_active === 0) {
    throw new Error('Votre site est actuellement banni. Contactez le Super Administrateur.');
  }

  const hash = user.password_hash as string;
  let valid = false;
  if (hash.startsWith('$2')) {
    valid = verifyPassword(password, hash);
  } else {
    valid = password === hash; // Legacy plain text
    if (valid) {
      const newHash = hashPassword(password);
      db.prepare('UPDATE t_users SET password_hash = ? WHERE id_user = ?').run(newHash, user.id_user);
    }
  }

  if (!valid) return null;

  db.prepare('UPDATE t_users SET last_login = datetime(\'now\') WHERE id_user = ?').run(user.id_user);
  logAction(user.id_user as number, user.login as string, 'CONNEXION', 'Connexion réussie');

  const { password_hash, ...safeUser } = user;
  return safeUser;
}

export function getUsers(siteId?: number) {
  const db = getDatabase()!;
  if (siteId) {
    return db.prepare(`
      SELECT u.*, s.nom as site_nom, c.nom as centre_nom
      FROM t_users u
      LEFT JOIN t_sites s ON u.site_id = s.id
      LEFT JOIN t_centres c ON u.centre_id = c.id
      WHERE u.site_id = ?
      ORDER BY u.login
    `).all(siteId);
  }
  return db.prepare(`
    SELECT u.*, s.nom as site_nom, c.nom as centre_nom
    FROM t_users u
    LEFT JOIN t_sites s ON u.site_id = s.id
    LEFT JOIN t_centres c ON u.centre_id = c.id
    ORDER BY u.login
  `).all();
}

export function createUser(
  data: { login: string; password: string; role: string; nom_user?: string; prenom_user?: string; centre_id?: number; site_id?: number },
  creator?: { role: string; site_id?: number }
) {
  const db = getDatabase()!;
  const hash = hashPassword(data.password);
  const syncId = uuidv4();
  
  let targetSiteId = data.site_id || 1;
  if (creator && creator.role !== 'SUPER ADMIN') {
    targetSiteId = creator.site_id!;
  }
  if (!targetSiteId) {
    throw new Error("Accès non autorisé : site_id invalide ou absent.");
  }

  log.info(`createUser: login=${data.login}, role=${data.role}, site_id=${targetSiteId}, centre_id=${data.centre_id}`);

  // Check if user already exists
  const existing = db.prepare('SELECT id_user, site_id, statut_actif FROM t_users WHERE LOWER(login) = LOWER(?)').get(data.login) as any;
  
  if (existing) {
    // Check site match for non super admin
    if (creator && creator.role !== 'SUPER ADMIN' && existing.site_id !== creator.site_id) {
      throw new Error("Accès non autorisé aux données de ce site");
    }
    
    log.info(`createUser: found existing user id=${existing.id_user}, site_id=${existing.site_id}, updating...`);
    
    const userSyncId = existing.sync_id || uuidv4();
    const result = db.prepare(`
      UPDATE t_users 
      SET password_hash = @hash, role = @role, nom_user = @nom_user, 
          prenom_user = @prenom_user, site_id = @site_id, centre_id = @centre_id, 
          statut_actif = 1, updated_at = datetime('now'), is_dirty = 1, sync_id = @sync_id
      WHERE id_user = @id
    `).run({ 
      id: existing.id_user,
      hash, 
      role: data.role, 
      nom_user: data.nom_user || '', 
      prenom_user: data.prenom_user || '', 
      centre_id: data.centre_id || null, 
      site_id: targetSiteId,
      sync_id: userSyncId
    });

    // Push cloud synchrone direct si ONLINE
    if (networkMonitor.getState() === 'ONLINE') {
      const supabase = getSupabaseClient();
      (async () => {
        try {
          const { error } = await supabase.from('t_users').upsert({
            id_user: existing.id_user,
            login: data.login,
            password_hash: hash,
            role: data.role,
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
    role: data.role, 
    nom_user: data.nom_user || '', 
    prenom_user: data.prenom_user || '', 
    centre_id: data.centre_id || null, 
    site_id: targetSiteId,
    sync_id: syncId 
  });

  const newUserId = result.lastInsertRowid as number;

  // Push cloud synchrone direct si ONLINE
  if (networkMonitor.getState() === 'ONLINE') {
    const supabase = getSupabaseClient();
    (async () => {
      try {
        const { error } = await supabase.from('t_users').insert({
          id_user: newUserId,
          login: data.login,
          password_hash: hash,
          role: data.role,
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
  const fields = Object.keys(data).map(k => `${k} = @${k}`).join(', ');
  const result = db.prepare(`UPDATE t_users SET ${fields}, updated_at = datetime('now'), is_dirty = 1 WHERE id_user = @id`).run({ ...data, id });
  if (result.changes === 0) {
    throw new Error("Accès non autorisé aux données de ce site");
  }
  return result;
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

// ============================================================
// LOGS
// ============================================================

export function logAction(userId: number, login: string, action: string, detail?: string, valeurAvant?: string, valeurApres?: string) {
  const db = getDatabase()!;
  db.prepare(`
    INSERT INTO t_logs (id_user, login_user, action, detail, valeur_avant, valeur_apres, sync_id, is_dirty)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1)
  `).run(userId, login, action, detail || '', valeurAvant || '', valeurApres || '', uuidv4());
}

export function getLogs(offset = 0, limit = 100, filters?: { action?: string; userId?: number; siteId?: number; centreId?: number }) {
  const db = getDatabase()!;
  let where = 'WHERE 1=1';
  const params: Record<string, unknown> = {};
  if (filters?.action) { where += ' AND l.action = @action'; params.action = filters.action; }
  if (filters?.userId) { where += ' AND l.id_user = @userId'; params.userId = filters.userId; }
  
  if (filters?.siteId) {
    // Note: We join with t_users to get the site_id for now
    // In a future migration, we should add site_id directly to t_logs
    where += ' AND u.site_id = @siteId';
    params.siteId = filters.siteId;
  }
  
  if (filters?.centreId) {
    where += ' AND u.centre_id = @centreId';
    params.centreId = filters.centreId;
  }

  const queryBase = `
    FROM t_logs l
    LEFT JOIN t_users u ON l.id_user = u.id_user
    ${where}
  `;

  const total = db.prepare(`SELECT COUNT(*) as count ${queryBase}`).get(params) as { count: number };
  const rows = db.prepare(`
    SELECT l.*, u.login as user_login 
    ${queryBase}
    ORDER BY l.date_heure DESC 
    LIMIT @limit OFFSET @offset
  `).all({ ...params, limit, offset });

  return { rows, total: total.count };
}

export function purgeLogs() {
  return getDatabase()!.prepare('DELETE FROM t_logs').run();
}

// ============================================================
// HIERARCHY
// ============================================================

export async function createSite(data: { 
  nom: string; 
  code: string; 
  max_centres?: number;
  admin?: { nom: string; login: string; password_hash: string }
}): Promise<{ success: boolean; siteId: number }> {
  const db = getDatabase()!;

  // ── ÉTAPE 1 : Transaction SQLite locale (synchrone, atomique) ──────────────
  let localSiteId: number;
  let localCentreId: number;
  let adminSyncId: string | null = null;
  let hashedPassword: string | null = null;

  const transaction = db.transaction(() => {
    // 1a. Créer le Site
    const siteResult = db.prepare('INSERT INTO t_sites (nom, code, max_centres) VALUES (?, ?, ?)')
      .run(data.nom, data.code, data.max_centres || 4);
    localSiteId = siteResult.lastInsertRowid as number;

    // 1b. Créer un Centre par défaut (nécessaire pour lier l'admin)
    const centreResult = db.prepare('INSERT INTO t_centres (nom, numero, lieu, site_id) VALUES (?, ?, ?, ?)')
      .run('CENTRE PRINCIPAL', '001', data.nom, localSiteId);
    localCentreId = centreResult.lastInsertRowid as number;

    // 1c. Créer l'administrateur du site avec sync_id UUID
    if (data.admin) {
      hashedPassword = hashPassword(data.admin.password_hash);
      adminSyncId = uuidv4();
      db.prepare(`
        INSERT INTO t_users (login, password_hash, role, nom_user, site_id, centre_id, statut_actif, sync_id) 
        VALUES (?, ?, 'ADMINISTRATEUR_SITE', ?, ?, ?, 1, ?)
      `).run(data.admin.login, hashedPassword, data.admin.nom, localSiteId, localCentreId, adminSyncId);
    }

    return { siteId: localSiteId, centreId: localCentreId };
  });

  const { siteId, centreId } = transaction();

  // ── ÉTAPE 2 : Push Cloud immédiat (asynchrone, non-bloquant si hors ligne) ─
  const networkState = networkMonitor.getState();
  if (networkState === 'ONLINE') {
    try {
      const supabase = getSupabaseClient();

      // 2a. Push du Site
      const { error: siteErr } = await supabase
        .from('t_sites')
        .insert({
          id: siteId,
          nom: data.nom,
          code: data.code,
          max_centres: data.max_centres || 4,
          is_active: 1,
        });
      if (siteErr) {
        log.warn(`[createSite] Push site vers Supabase échoué (non-bloquant): ${siteErr.message}`);
      } else {
        log.info(`[createSite] Site id=${siteId} poussé sur Supabase avec succès.`);
      }

      // 2b. Push du Centre
      const { error: centreErr } = await supabase
        .from('t_centres')
        .insert({
          id: centreId,
          nom: 'CENTRE PRINCIPAL',
          numero: '001',
          lieu: data.nom,
          site_id: siteId,
        });
      if (centreErr) {
        log.warn(`[createSite] Push centre vers Supabase échoué (non-bloquant): ${centreErr.message}`);
      } else {
        log.info(`[createSite] Centre id=${centreId} poussé sur Supabase avec succès.`);
      }

      // 2c. Push de l'Administrateur
      if (data.admin && adminSyncId && hashedPassword) {
        const { error: userErr } = await supabase
          .from('t_users')
          .insert({
            login: data.admin.login,
            password_hash: hashedPassword,
            role: 'ADMINISTRATEUR_SITE',
            nom_user: data.admin.nom,
            site_id: siteId,
            centre_id: centreId,
            statut_actif: 1,
            sync_id: adminSyncId,
          });
        if (userErr) {
          log.warn(`[createSite] Push admin vers Supabase échoué (non-bloquant): ${userErr.message}`);
        } else {
          log.info(`[createSite] Admin '${data.admin.login}' poussé sur Supabase avec succès.`);
        }
      }
    } catch (cloudErr: any) {
      // Le push cloud est non-bloquant : la création locale est déjà validée
      log.error(`[createSite] Erreur inattendue lors du push cloud (non-bloquant):`, cloudErr);
    }
  } else {
    log.info(`[createSite] Hors ligne (état: ${networkState}). Site id=${siteId} sera synchronisé par la prochaine session online.`);
  }

  return { success: true, siteId };
}

/**
 * Synchronisation forcée globale Super Admin.
 * Pousse l'intégralité des tables locales (sites, centres, users) vers Supabase via upsert.
 * Utilisée comme bouton de sauvetage pour les données créées localement hors-ligne.
 */
export async function forceGlobalSuperAdminSync(): Promise<{
  success: boolean;
  counts: { sites: number; centres: number; users: number };
  errors: string[];
}> {
  const db = getDatabase()!;
  const supabase = getSupabaseClient();
  const errors: string[] = [];
  const counts = { sites: 0, centres: 0, users: 0 };

  log.info('[forceGlobalSync] Démarrage de la synchronisation forcée globale Super Admin...');

  // ── 1. UPSERT de tous les Sites ─────────────────────────────────────────────
  try {
    const localSites = db.prepare('SELECT * FROM t_sites').all() as any[];
    if (localSites.length > 0) {
      const sitesPayload = localSites.map((s) => ({
        id: s.id,
        nom: s.nom,
        code: s.code,
        max_centres: s.max_centres,
        is_active: s.is_active ?? 1,
      }));
      const { error } = await supabase.from('t_sites').upsert(sitesPayload, { onConflict: 'id' });
      if (error) {
        errors.push(`Sites: ${error.message}`);
        log.error('[forceGlobalSync] Erreur upsert t_sites:', error.message);
      } else {
        counts.sites = localSites.length;
        log.info(`[forceGlobalSync] ${localSites.length} site(s) synchronisé(s).`);
      }
    }
  } catch (e: any) {
    errors.push(`Sites (exception): ${e.message}`);
    log.error('[forceGlobalSync] Exception upsert t_sites:', e);
  }

  // ── 2. UPSERT de tous les Centres ──────────────────────────────────────────
  try {
    const localCentres = db.prepare('SELECT * FROM t_centres').all() as any[];
    if (localCentres.length > 0) {
      const centresPayload = localCentres.map((c) => ({
        id: c.id,
        nom: c.nom,
        numero: c.numero,
        lieu: c.lieu,
        site_id: c.site_id,
      }));
      const { error } = await supabase.from('t_centres').upsert(centresPayload, { onConflict: 'id' });
      if (error) {
        errors.push(`Centres: ${error.message}`);
        log.error('[forceGlobalSync] Erreur upsert t_centres:', error.message);
      } else {
        counts.centres = localCentres.length;
        log.info(`[forceGlobalSync] ${localCentres.length} centre(s) synchronisé(s).`);
      }
    }
  } catch (e: any) {
    errors.push(`Centres (exception): ${e.message}`);
    log.error('[forceGlobalSync] Exception upsert t_centres:', e);
  }

  // ── 3. UPSERT de tous les Users (avec password_hash complet) ───────────────
  try {
    const localUsers = db.prepare("SELECT * FROM t_users WHERE role != 'SUPER ADMIN'").all() as any[];
    if (localUsers.length > 0) {
      const usersPayload = localUsers.map((u) => ({
        id_user: u.id_user,
        login: u.login,
        password_hash: u.password_hash,
        role: u.role,
        nom_user: u.nom_user,
        site_id: u.site_id,
        centre_id: u.centre_id,
        statut_actif: u.statut_actif ?? 1,
        sync_id: u.sync_id || uuidv4(),
      }));
      const { error } = await supabase.from('t_users').upsert(usersPayload, { onConflict: 'id_user' });
      if (error) {
        errors.push(`Users: ${error.message}`);
        log.error('[forceGlobalSync] Erreur upsert t_users:', error.message);
      } else {
        counts.users = localUsers.length;
        log.info(`[forceGlobalSync] ${localUsers.length} utilisateur(s) synchronisé(s).`);
      }
    }
  } catch (e: any) {
    errors.push(`Users (exception): ${e.message}`);
    log.error('[forceGlobalSync] Exception upsert t_users:', e);
  }

  const success = errors.length === 0;
  log.info(`[forceGlobalSync] Terminé. Succès: ${success}. Erreurs: ${errors.length}`);
  return { success, counts, errors };
}

/**
 * Synchronisation de secours pour l'Administrateur de Site.
 * Pousse tous les utilisateurs locaux associés à son site,
 * et déclenche la synchronisation en bloc de toutes ses cartes modifiées.
 */
export async function forceSiteAdminSync(siteId: number): Promise<{
  success: boolean;
  counts: { users: number; cards: number };
  errors: string[];
}> {
  const db = getDatabase()!;
  const supabase = getSupabaseClient();
  const errors: string[] = [];
  const counts = { users: 0, cards: 0 };

  log.info(`[forceSiteAdminSync] Démarrage de la synchronisation forcée pour le site ${siteId}...`);

  // ── 1. UPSERT des Utilisateurs du Site ─────────────────────────────────────
  try {
    const localUsers = db.prepare("SELECT * FROM t_users WHERE site_id = ? AND role != 'SUPER ADMIN'").all(siteId) as any[];
    if (localUsers.length > 0) {
      const usersPayload = localUsers.map((u) => ({
        id_user: u.id_user,
        login: u.login,
        password_hash: u.password_hash,
        role: u.role,
        nom_user: u.nom_user,
        site_id: u.site_id,
        centre_id: u.centre_id,
        statut_actif: u.statut_actif ?? 1,
        sync_id: u.sync_id || uuidv4(),
      }));
      const { error } = await supabase.from('t_users').upsert(usersPayload, { onConflict: 'id_user' });
      if (error) {
        errors.push(`Utilisateurs: ${error.message}`);
        log.error(`[forceSiteAdminSync] Erreur upsert t_users pour le site ${siteId}:`, error.message);
      } else {
        counts.users = localUsers.length;
        log.info(`[forceSiteAdminSync] ${localUsers.length} utilisateur(s) poussé(s) sur Supabase.`);
      }
    }
  } catch (e: any) {
    errors.push(`Utilisateurs (exception): ${e.message}`);
    log.error(`[forceSiteAdminSync] Exception lors de l'upsert t_users:`, e);
  }

  // ── 2. BULK UPLOAD des Cartes modifiées (is_dirty = 1) du Site ─────────────
  try {
    const { runBulkUpload } = await import('../sync/bulk-uploader');
    const uploadRes = await runBulkUpload(siteId, (progress) => {
      log.info(`[forceSiteAdminSync] Progression Bulk Upload cartes: ${progress}%`);
    });
    if (!uploadRes.success) {
      errors.push(`Cartes: ${uploadRes.message}`);
      log.error(`[forceSiteAdminSync] Erreur bulk upload cartes:`, uploadRes.message);
    } else {
      counts.cards = uploadRes.uploadedCount;
      log.info(`[forceSiteAdminSync] ${uploadRes.uploadedCount} carte(s) synchronisée(s).`);
    }
  } catch (e: any) {
    errors.push(`Cartes (exception): ${e.message}`);
    log.error(`[forceSiteAdminSync] Exception lors du bulk upload cartes:`, e);
  }

  const success = errors.length === 0;
  log.info(`[forceSiteAdminSync] Terminé pour le site ${siteId}. Succès: ${success}. Erreurs: ${errors.length}`);
  return { success, counts, errors };
}

export function updateSite(id: number, data: { nom?: string; code?: string; max_centres?: number; is_active?: number }) {
  const db = getDatabase()!;
  const sets: string[] = [];
  const params: any[] = [];

  if (data.nom) { sets.push('nom = ?'); params.push(data.nom); }
  if (data.code) { sets.push('code = ?'); params.push(data.code); }
  if (data.max_centres !== undefined) { sets.push('max_centres = ?'); params.push(data.max_centres); }
  if (data.is_active !== undefined) { sets.push('is_active = ?'); params.push(data.is_active); }

  if (sets.length === 0) return null;
  params.push(id);

  return db.prepare(`UPDATE t_sites SET ${sets.join(', ')} WHERE id = ?`).run(...params);
}

export function deleteSite(id: number) {
  const db = getDatabase()!;
  const transaction = db.transaction(() => {
    // 1. Delete Cards (Direct site_id filtering is safer)
    db.prepare('DELETE FROM t_cartes WHERE site_id = ?').run(id);
    
    // 2. Delete Logs associated with ANY user of this site
    // This is critical because of FOREIGN KEY (id_user) REFERENCES t_users(id_user)
    db.prepare('DELETE FROM t_logs WHERE id_user IN (SELECT id_user FROM t_users WHERE site_id = ?)').run(id);
    // Also delete logs linked via site_id directly if column exists
    try { db.prepare('DELETE FROM t_logs WHERE site_id = ?').run(id); } catch(e){}
    
    // 3. Delete Users FIRST (because they reference postes and centres)
    db.prepare("DELETE FROM t_users WHERE site_id = ? AND role != 'SUPER ADMIN'").run(id);
    
    // 4. Delete Postes (via centres)
    db.prepare('DELETE FROM t_postes WHERE centre_id IN (SELECT id FROM t_centres WHERE site_id = ?)').run(id);
    
    // 5. Delete Centres
    db.prepare('DELETE FROM t_centres WHERE site_id = ?').run(id);
    
    // 6. Delete Temp Imports
    db.prepare('DELETE FROM t_import_temp WHERE site_id = ?').run(id);
    
    // 7. Finally Delete Site
    return db.prepare('DELETE FROM t_sites WHERE id = ?').run(id);
  });
  return transaction();
}

export function verifySuperAdminPassword(password: string): boolean {
  const db = getDatabase()!;
  const admin = db.prepare('SELECT password_hash FROM t_users WHERE role = \'SUPER ADMIN\'').get() as any;
  if (!admin) return false;
  
  const hash = admin.password_hash;
  if (hash.startsWith('$2')) {
    return verifyPassword(password, hash);
  }
  return password === hash; // Fallback legacy
}

export function getSites() {
  return getDatabase()!.prepare('SELECT * FROM t_sites ORDER BY nom').all();
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
  return db.prepare(`
    UPDATE t_users 
    SET password_hash = ?, is_dirty = 1, updated_at = datetime('now')
    WHERE site_id = ? AND role = 'ADMINISTRATEUR_SITE'
  `).run(hash, siteId);
}

export function getCentres(siteId?: number) {
  const db = getDatabase()!;
  if (siteId) {
    return db.prepare(`
      SELECT c.*, s.nom as site_nom 
      FROM t_centres c 
      LEFT JOIN t_sites s ON c.site_id = s.id 
      WHERE c.site_id = ? 
      ORDER BY c.numero
    `).all(siteId);
  }
  return db.prepare(`
    SELECT c.*, s.nom as site_nom 
    FROM t_centres c 
    LEFT JOIN t_sites s ON c.site_id = s.id 
    ORDER BY s.nom, c.nom
  `).all();
}

export function createCentre(data: { site_id: number; nom: string; numero: number; prefixe_rangement?: string }) {
  const db = getDatabase()!;
  
  // Check quota
  const site = db.prepare('SELECT max_centres FROM t_sites WHERE id = ?').get(data.site_id) as { max_centres: number };
  const count = db.prepare('SELECT COUNT(*) as count FROM t_centres WHERE site_id = ?').get(data.site_id) as { count: number };
  
  if (count.count >= site.max_centres) {
    throw new Error(`Quota de centres atteint (${site.max_centres}). Contactez le Super Admin.`);
  }

  return db.prepare('INSERT INTO t_centres (site_id, nom, numero, prefixe_rangement) VALUES (?, ?, ?, ?)').run(data.site_id, data.nom, data.numero, data.prefixe_rangement || null);
}

export function updateCentre(id: number, data: { nom: string; numero: string | number; prefixe_rangement?: string | null }) {
  const db = getDatabase()!;
  return db.prepare('UPDATE t_centres SET nom = ?, numero = ?, prefixe_rangement = ? WHERE id = ?').run(data.nom, data.numero, data.prefixe_rangement !== undefined ? data.prefixe_rangement : null, id);
}

export function getPostes(centreId?: number) {
  if (centreId) return getDatabase()!.prepare('SELECT * FROM t_postes WHERE centre_id = ? ORDER BY numero').all(centreId);
  return getDatabase()!.prepare('SELECT * FROM t_postes ORDER BY nom').all();
}

// ============================================================
// CONFIG
// ============================================================

export function getConfig(key: string) {
  const row = getDatabase()!.prepare('SELECT value FROM t_config WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value || null;
}

export function setConfig(key: string, value: string) {
  return getDatabase()!.prepare('INSERT OR REPLACE INTO t_config (key, value, updated_at) VALUES (?, ?, datetime(\'now\'))').run(key, value);
}

export function getGlobalStats() {
  const db = getDatabase()!;
  return db.prepare(`
    SELECT 
      (SELECT COUNT(*) FROM t_sites) as total_sites,
      (SELECT COUNT(*) FROM t_sites WHERE is_active = 1) as active_sites,
      (SELECT COUNT(*) FROM t_cartes) as total_cartes,
      (SELECT COUNT(*) FROM t_users WHERE role != 'SUPER ADMIN') as total_agents
  `).get();
}

// ============================================================
// MAINTENANCE
// ============================================================

export async function clearDatabaseCartes(siteId?: number, onProgress?: (percent: number) => void) {
  const db = getDatabase()!;
  try {
    log.info(`Starting asynchronous batch clear for site ${siteId || 'ALL'}...`);
    
    // 1. Clear temp tables (scoped by site if provided)
    if (siteId) {
      db.prepare('DELETE FROM t_import_temp WHERE site_id = ?').run(siteId);
    } else {
      db.prepare('DELETE FROM t_import_temp').run();
      db.prepare('DELETE FROM t_sync_queue').run();
    }

    // 2. Count total rows to delete
    let countQuery = 'SELECT COUNT(*) as count FROM t_cartes';
    const countParams: any = {};
    if (siteId) {
      countQuery += ' WHERE site_id = @siteId';
      countParams.siteId = siteId;
    }
    const totalToLink = db.prepare(countQuery).get(countParams) as { count: number };
    const total = totalToLink?.count || 0;

    let deleted = 0;
    let batchCount = 1;
    
    // Loop batch delete
    while (true) {
      let deleteQuery = 'DELETE FROM t_cartes WHERE id_carte IN (SELECT id_carte FROM t_cartes ';
      const deleteParams: any = {};
      if (siteId) {
        deleteQuery += 'WHERE site_id = @siteId ';
        deleteParams.siteId = siteId;
      }
      deleteQuery += 'LIMIT 5000)';

      const result = db.prepare(deleteQuery).run(deleteParams);
      if (result.changes === 0) {
        break;
      }
      deleted += result.changes;

      if (total > 0 && onProgress) {
        const percent = Math.min(100, Math.round((deleted / total) * 100));
        onProgress(percent);
      }

      log.info(`[clearDatabaseCartes] Deleted batch #${batchCount++}: ${result.changes} rows (total: ${deleted}/${total})`);
      
      // Let event loop breathe
      await new Promise(resolve => setImmediate(resolve));
    }

    // 3. Compact database
    log.info('[clearDatabaseCartes] Running VACUUM...');
    db.prepare('VACUUM').run();
    log.info('[clearDatabaseCartes] Database compacted successfully.');
    
    logAction(0, 'SYSTEM', 'MAINTENANCE', `Vidage de la base de données (${deleted} cartes supprimées - Site: ${siteId || 'Tous'})`);
    return { success: true, count: deleted };
  } catch (error) {
    log.error('CRITICAL: clearDatabaseCartes failed', error);
    throw error;
  }
}

export async function fullSystemReset(onProgress?: (percent: number) => void) {
  try {
    const db = getDatabase()!;
    log.info('Starting full system reset batch...');
    
    // 1. Clear temp tables and logs
    db.prepare('DELETE FROM t_import_temp').run();
    db.prepare('DELETE FROM t_sync_queue').run();
    db.prepare('DELETE FROM t_logs').run();

    // 2. Count total cards
    const totalToLink = db.prepare('SELECT COUNT(*) as count FROM t_cartes').get() as { count: number };
    const total = totalToLink?.count || 0;

    let deleted = 0;
    let batchCount = 1;

    // Loop delete
    while (true) {
      const result = db.prepare('DELETE FROM t_cartes WHERE id_carte IN (SELECT id_carte FROM t_cartes LIMIT 5000)').run();
      if (result.changes === 0) {
        break;
      }
      deleted += result.changes;

      if (total > 0 && onProgress) {
        const percent = Math.min(100, Math.round((deleted / total) * 100));
        onProgress(percent);
      }

      log.info(`[fullSystemReset] Deleted batch #${batchCount++}: ${result.changes} rows (total: ${deleted}/${total})`);
      await new Promise(resolve => setImmediate(resolve));
    }

    // 3. Delete all users except SUPER ADMIN
    db.prepare("DELETE FROM t_users WHERE role != 'SUPER ADMIN'").run();

    // 4. Compact database
    log.info('[fullSystemReset] Running VACUUM...');
    db.prepare('VACUUM').run();
    log.info('[fullSystemReset] Database compacted successfully.');

    logAction(0, 'SYSTEM', 'MAINTENANCE', 'RÉINITIALISATION TOTALE DU SYSTÈME (Cartes + Utilisateurs hors Super Admin)');
    return { success: true };
  } catch (error) {
    log.error('CRITICAL: fullSystemReset failed', error);
    throw error;
  }
}

export function getAllConfig() {
  return getDatabase()!.prepare('SELECT * FROM t_config').all();
}

// ============================================================
// OFFLINE SYNC CAPTURE FUNCTIONS
// ============================================================

/**
 * Enregistre une opération de modification locale dans la file d'attente de synchronisation.
 */
export function enqueueSyncOp(
  tableName: string, 
  recordId: number, 
  operation: 'INSERT' | 'UPDATE' | 'DELETE', 
  payload: any
): void {
  try {
    const db = getDatabase()!;
    db.prepare(`
      INSERT INTO t_sync_queue (table_name, record_id, operation, payload, synced)
      VALUES (?, ?, ?, ?, 0)
    `).run(tableName, recordId, operation, JSON.stringify(payload));
  } catch (e) {
    log.error(`Failed to enqueue sync op for table ${tableName} (ID: ${recordId}):`, e);
  }
}

/**
 * Récupère les prochains lots d'écritures en attente dans la queue.
 */
export function getNextSyncBatches(limit: number = 50) {
  const db = getDatabase()!;
  return db.prepare(`
    SELECT * FROM t_sync_queue
    WHERE synced = 0
    ORDER BY created_at ASC
    LIMIT ?
  `).all(limit) as any[];
}

/**
 * Marque un enregistrement local de t_sync_queue comme synchronisé avec succès
 * et remet is_dirty à 0 dans la table métier si aucun changement local n'a eu lieu entre-temps.
 */
export function markRecordsAsSynced(
  queueId: number,
  tableName: string,
  recordId: number,
  lastUpdatedAtLocal: string
): void {
  const db = getDatabase()!;
  
  db.transaction(() => {
    // 1. Marquer l'entrée comme synchronisée dans la queue
    db.prepare('UPDATE t_sync_queue SET synced = 1 WHERE id = ?').run(queueId);

    // 2. Déterminer le nom de la clé primaire de la table concernée
    const pkName = tableName === 't_users' ? 'id_user' : 'id_carte';

    // 3. Vérifier le timestamp updated_at actuel pour s'assurer que la ligne n'a pas été modifiée à nouveau
    const currentRecord = db.prepare(`
      SELECT updated_at, is_dirty FROM ${tableName} WHERE ${pkName} = ?
    `).get(recordId) as { updated_at?: string; is_dirty?: number } | undefined;

    if (currentRecord) {
      // Ajustement stratégique 2 : On ne repasse is_dirty à 0 que si le timestamp local concorde
      if (currentRecord.updated_at === lastUpdatedAtLocal) {
        db.prepare(`
          UPDATE ${tableName} 
          SET is_dirty = 0, synced_at = datetime('now')
          WHERE ${pkName} = ?
        `).run(recordId);
      } else {
        log.info(`Sync safety triggered: Record ${tableName} (ID: ${recordId}) was modified locally during upload. Keeping is_dirty = 1.`);
      }
    }
  })();
}

export function getVerificationStats(agentUsername: string, siteId: number) {
  const db = getDatabase()!;
  
  const today = db.prepare(`
    SELECT COUNT(*) as count FROM t_cartes 
    WHERE statut = 'DELIVRE' AND UPPER(agent_distributeur) = UPPER(?) AND site_id = ? 
    AND date(date_delivrance, 'localtime') = date('now', 'localtime')
  `).get(agentUsername, siteId) as { count: number } | undefined;

  const yesterday = db.prepare(`
    SELECT COUNT(*) as count FROM t_cartes 
    WHERE statut = 'DELIVRE' AND UPPER(agent_distributeur) = UPPER(?) AND site_id = ? 
    AND date(date_delivrance, 'localtime') = date('now', '-1 day', 'localtime')
  `).get(agentUsername, siteId) as { count: number } | undefined;

  const week = db.prepare(`
    SELECT COUNT(*) as count FROM t_cartes 
    WHERE statut = 'DELIVRE' AND UPPER(agent_distributeur) = UPPER(?) AND site_id = ? 
    AND date(date_delivrance, 'localtime') >= date('now', '-7 days', 'localtime')
  `).get(agentUsername, siteId) as { count: number } | undefined;

  const month = db.prepare(`
    SELECT COUNT(*) as count FROM t_cartes 
    WHERE statut = 'DELIVRE' AND UPPER(agent_distributeur) = UPPER(?) AND site_id = ? 
    AND date(date_delivrance, 'localtime') >= date('now', '-30 days', 'localtime')
  `).get(agentUsername, siteId) as { count: number } | undefined;

  const year = db.prepare(`
    SELECT COUNT(*) as count FROM t_cartes 
    WHERE statut = 'DELIVRE' AND UPPER(agent_distributeur) = UPPER(?) AND site_id = ? 
    AND strftime('%Y', date_delivrance, 'localtime') = strftime('%Y', 'now', 'localtime')
  `).get(agentUsername, siteId) as { count: number } | undefined;

  // Décompte individuel des 7 derniers jours glissants typés par nom de jour
  const weekdays = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];
  const last7Days: { dayName: string; count: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const dayOffset = i === 0 ? '0 days' : `-${i} day${i > 1 ? 's' : ''}`;
    const queryStr = `
      SELECT COUNT(*) as count, strftime('%w', date('now', ?, 'localtime')) as dayIndex
      FROM t_cartes 
      WHERE statut = 'DELIVRE' AND UPPER(agent_distributeur) = UPPER(?) AND site_id = ? 
      AND date(date_delivrance, 'localtime') = date('now', ?, 'localtime')
    `;
    const row = db.prepare(queryStr).get(dayOffset, agentUsername, siteId, dayOffset) as { count: number; dayIndex: string } | undefined;
    const dayName = weekdays[Number(row?.dayIndex || 0)];
    last7Days.push({
      dayName,
      count: row?.count || 0
    });
  }

  return {
    today: today?.count || 0,
    yesterday: yesterday?.count || 0,
    week: week?.count || 0,
    month: month?.count || 0,
    year: year?.count || 0,
    last7Days
  };
}

export function getVerificationCardsToday(agentUsername: string, siteId: number) {
  const db = getDatabase()!;
  return db.prepare(`
    SELECT id_carte, noms, prenoms, date_delivrance, contact 
    FROM t_cartes 
    WHERE statut = 'DELIVRE' AND UPPER(agent_distributeur) = UPPER(?) AND site_id = ? 
    AND date(date_delivrance, 'localtime') = date('now', 'localtime') 
    ORDER BY date_delivrance DESC
  `).all(agentUsername, siteId);
}

export async function purgeLocalDatabase(siteId: number, onProgress?: (percent: number) => void) {
  const db = getDatabase()!;
  
  if (!siteId) {
    throw new Error("siteId obligatoire pour purger la base locale.");
  }
  
  try {
    // 1. Désactiver temporairement les clés étrangères pour accélérer
    db.pragma('foreign_keys = OFF');
    
    // Obtenir le nombre total de cartes pour ce site
    const totalRow = db.prepare("SELECT COUNT(*) as count FROM t_cartes WHERE site_id = ?").get(siteId) as { count: number };
    const total = totalRow ? totalRow.count : 0;
    
    let deleted = 0;
    
    if (total > 0) {
      // Préparer la requête d'extraction des identifiants par lots de 5000
      const selectStmt = db.prepare("SELECT id_carte FROM t_cartes WHERE site_id = ? LIMIT 5000");

      while (true) {
        // 1. Récupérer le lot d'IDs courant
        const rows = selectStmt.all(siteId) as { id_carte: number }[];
        if (rows.length === 0) break;
        
        const idList = rows.map(r => r.id_carte);
        const placeholders = idList.map(() => '?').join(',');

        // 2. Supprimer de manière atomique le lot dans les deux tables
        const deleteTx = db.transaction(() => {
          db.prepare(`DELETE FROM t_cartes_fts WHERE rowid IN (${placeholders})`).run(idList);
          db.prepare(`DELETE FROM t_cartes WHERE id_carte IN (${placeholders})`).run(idList);
        });
        
        deleteTx();
        deleted += idList.length;
        
        if (onProgress) {
          onProgress(Math.round((deleted / total) * 100));
        }
        
        // Laisser la boucle d'événements respirer
        await new Promise(resolve => setImmediate(resolve));
      }
    }
    
    db.pragma('foreign_keys = ON');

    // 2. Déporter le VACUUM lourd en tâche de fond asynchrone
    setTimeout(() => {
      try {
        log.info("⏳ [BACKGROUND] Lancement du VACUUM de compactage du disque...");
        db.prepare("VACUUM").run();
        log.info("✅ [BACKGROUND] VACUUM terminé avec succès.");
      } catch (err) {
        log.error("Erreur lors du VACUUM en tâche de fond:", err);
      }
    }, 500);

    return { success: true, count: deleted };
  } catch (error) {
    db.pragma('foreign_keys = ON');
    throw error;
  }
}

export function getLocalCardCount(): number {
  const db = getDatabase()!;
  const row = db.prepare("SELECT COUNT(*) as count FROM t_cartes").get() as { count: number };
  return row ? row.count : 0;
}

export function getUnreadSyncNotifications(siteId?: number): number {
  const db = getDatabase()!;
  let query = `SELECT COUNT(*) as count FROM t_logs WHERE action IN ('SYNC_UPDATE', 'CARTE_ABSENTE_SIGNALEE', 'CARTE_ABSENTE_RETROUVEE', 'CARTE_PERDUE_CONFIRMEE', 'CARTE_PERDUE_RETROUVEE') AND (valeur_apres LIKE '%"read":false%' OR valeur_apres LIKE '%"read": false%')`;
  const params: any[] = [];
  if (siteId !== undefined && siteId !== null) {
    query += ' AND site_id = ?';
    params.push(Number(siteId));
  }
  const row = db.prepare(query).get(...params) as { count: number } | undefined;
  return row ? row.count : 0;
}

export function getUnreadNotificationsList(siteId?: number): any[] {
  const db = getDatabase()!;
  let query = `SELECT * FROM t_logs WHERE action IN ('SYNC_UPDATE', 'CARTE_ABSENTE_SIGNALEE', 'CARTE_ABSENTE_RETROUVEE', 'CARTE_PERDUE_CONFIRMEE', 'CARTE_PERDUE_RETROUVEE') AND (valeur_apres LIKE '%"read":false%' OR valeur_apres LIKE '%"read": false%')`;
  const params: any[] = [];
  if (siteId !== undefined && siteId !== null) {
    query += ' AND site_id = ?';
    params.push(Number(siteId));
  }
  query += ' ORDER BY date_heure DESC LIMIT 10';
  return db.prepare(query).all(...params);
}

export function markUnreadSyncNotificationsAsRead(siteId?: number): boolean {
  const db = getDatabase()!;
  let query = `UPDATE t_logs SET valeur_apres = '{"read": true}', is_dirty = 1 WHERE action IN ('SYNC_UPDATE', 'CARTE_ABSENTE_SIGNALEE', 'CARTE_ABSENTE_RETROUVEE', 'CARTE_PERDUE_CONFIRMEE', 'CARTE_PERDUE_RETROUVEE') AND (valeur_apres LIKE '%"read":false%' OR valeur_apres LIKE '%"read": false%')`;
  const params: any[] = [];
  if (siteId !== undefined && siteId !== null) {
    query += ' AND site_id = ?';
    params.push(Number(siteId));
  }
  const result = db.prepare(query).run(...params);
  return result.changes > 0;
}

export function markNotificationAsRead(idLog: number): boolean {
  const db = getDatabase()!;
  const result = db.prepare(`
    UPDATE t_logs 
    SET valeur_apres = '{"read": true}', is_dirty = 1 
    WHERE id_log = ?
  `).run(idLog);
  return result.changes > 0;
}

export function getAgentReportedAbsences(agent: string, siteId?: number): any[] {
  const db = getDatabase()!;
  let query = `SELECT * FROM t_cartes WHERE statut_physique IN ('ABSENT', 'RETROUVE', 'PERDUE')`;
  const params: any[] = [];
  if (siteId !== undefined && siteId !== null) {
    query += ' AND site_id = ?';
    params.push(Number(siteId));
  }
  query += ' ORDER BY date_signalement_absence DESC LIMIT 50';
  return db.prepare(query).all(...params);
}

export function declarerPerdue(id: number, currentUser?: { role: string; site_id?: number }) {
  const db = getDatabase()!;
  const now = new Date().toISOString();
  let query = `
    UPDATE t_cartes 
    SET statut_physique = 'PERDUE', updated_at = @now, is_dirty = 1
    WHERE id_carte = @id
  `;
  const params: any = { now, id };
  if (currentUser && currentUser.role !== 'SUPER ADMIN') {
    query += ' AND site_id = @site_id';
    params.site_id = currentUser.site_id;
  }
  const result = db.prepare(query).run(params);
  if (result.changes === 0) {
    throw new Error("Accès non autorisé aux données de ce site");
  }

  const card = db.prepare('SELECT site_id, noms, prenoms, contact, agent_signalement_absence FROM t_cartes WHERE id_carte = ?').get(id) as any;
  if (card) {
    const siteId = card.site_id;
    const message = `La carte de ${card.noms} ${card.prenoms} a été confirmée PERDUE par l'administration.`;
    const payload = {
      read: false,
      noms: card.noms,
      prenoms: card.prenoms,
      contact: card.contact || '—',
      isLost: true,
      site_id: siteId
    };
    try {
      const unreadLog = db.prepare(`
        SELECT id_log FROM t_logs 
        WHERE action = 'CARTE_ABSENTE_SIGNALEE' 
        AND json_extract(valeur_apres, '$.read') = false
        AND json_extract(valeur_apres, '$.id_carte') = ?
      `).get(id) as { id_log: number } | undefined;

      if (unreadLog) {
        db.prepare(`
          UPDATE t_logs 
          SET valeur_apres = '{"read": true}', is_dirty = 1 
          WHERE id_log = ?
        `).run(unreadLog.id_log);
      } else {
        log.error("Log introuvable pour la carte ID:", id);
      }

      db.prepare(`
        INSERT INTO t_logs (id_user, login_user, action, detail, valeur_apres, sync_id, is_dirty, site_id)
        VALUES (NULL, 'SYSTEM', 'CARTE_PERDUE_CONFIRMEE', ?, ?, ?, 1, ?)
      `).run(message, JSON.stringify(payload), uuidv4(), siteId);
    } catch (err) {
      log.error('Failed to log or update on declarerPerdue:', err);
    }

    const { BrowserWindow } = require('electron');
    const windows = BrowserWindow.getAllWindows();
    if (windows.length > 0) {
      windows[0].webContents.send('sync:updated-data', { type: 'ABSENCE_RESOLUE' });
    }
  }

  return result;
}

export function getHistoriquePertes(siteId?: number): any[] {
  const db = getDatabase()!;
  let query = `
    SELECT c.id_carte, c.noms, c.prenoms, c.contact, c.num_secu, c.rangement, s.nom as site_nom,
           l.date_heure as date_perte
    FROM t_cartes c
    LEFT JOIN t_sites s ON c.site_id = s.id
    LEFT JOIN t_logs l ON l.action = 'CARTE_PERDUE_CONFIRMEE' AND json_extract(l.valeur_apres, '$.id_carte') = c.id_carte
    WHERE c.statut_physique = 'PERDUE'
  `;
  const params: any[] = [];
  if (siteId !== undefined && siteId !== null) {
    query += ' AND c.site_id = ?';
    params.push(Number(siteId));
  }
  query += ' ORDER BY l.date_heure DESC';
  return db.prepare(query).all(...params);
}

export function reactiverCarte(id: number, nouveauRangement: string, currentUser?: { role: string; site_id?: number }) {
  const db = getDatabase()!;
  return db.transaction(() => {
    const now = new Date().toISOString();
    let updateQuery = `
      UPDATE t_cartes 
      SET statut_physique = 'OK', statut = 'EN STOCK', rangement = @rangement, updated_at = @now, is_dirty = 1
      WHERE id_carte = @id
    `;
    const params: any = { now, id, rangement: nouveauRangement ? nouveauRangement.toUpperCase().trim() : null };
    if (currentUser && currentUser.role !== 'SUPER ADMIN') {
      updateQuery += ' AND site_id = @site_id';
      params.site_id = currentUser.site_id;
    }
    const result = db.prepare(updateQuery).run(params);
    if (result.changes === 0) {
      throw new Error("Accès non autorisé aux données de ce site");
    }

    const card = db.prepare('SELECT site_id, noms, prenoms, rangement, contact FROM t_cartes WHERE id_carte = ?').get(id) as any;
    if (card) {
      const siteId = card.site_id;
      const message = `La carte de ${card.noms} ${card.prenoms} a été confirmée RETROUVÉE (Rangement: ${card.rangement || 'non spécifié'}) par l'administration.`;
      const payload = {
        read: false,
        noms: card.noms,
        prenoms: card.prenoms,
        rangement: card.rangement || 'Non classé',
        contact: card.contact || '—',
        site_id: siteId
      };

      db.prepare(`
        INSERT INTO t_logs (id_user, login_user, action, detail, valeur_apres, sync_id, is_dirty, site_id)
        VALUES (NULL, 'SYSTEM', 'CARTE_PERDUE_RETROUVEE', ?, ?, ?, 1, ?)
      `).run(message, JSON.stringify(payload), uuidv4(), siteId);

      // Émission différée du signal IPC hors transaction
      setTimeout(() => {
        const { BrowserWindow } = require('electron');
        const windows = BrowserWindow.getAllWindows();
        if (windows.length > 0) {
          windows[0].webContents.send('sync:updated-data', { type: 'CARTE_RETROUVEE' });
        }
      }, 50);
    }

    return result;
  })();
}

export function getSiteById(id: number) {
  const db = getDatabase()!;
  return db.prepare('SELECT * FROM t_sites WHERE id = ?').get(id) as any;
}

export function getCentresWithPrefixes(siteId: number) {
  const db = getDatabase()!;
  return db.prepare(`
    SELECT id, site_id, nom, prefixe_rangement 
    FROM t_centres 
    WHERE site_id = ? AND prefixe_rangement IS NOT NULL AND prefixe_rangement != ''
  `).all(siteId) as any[];
}

export async function emergencyPurge(siteId: number): Promise<{ success: boolean }> {
  const db = getDatabase()!;
  
  if (!siteId) {
    throw new Error("siteId obligatoire pour la purge d'urgence.");
  }

  // 1. Désactiver les verrous de clés étrangères
  db.pragma('foreign_keys = OFF');

  // 2. Raser brutalement les déclencheurs et la table FTS5 corrompue
  db.exec('DROP TRIGGER IF EXISTS trg_cartes_ai;');
  db.exec('DROP TRIGGER IF EXISTS trg_cartes_ad;');
  db.exec('DROP TRIGGER IF EXISTS trg_cartes_au;');
  db.exec('DROP TABLE IF EXISTS t_cartes_fts;');

  // 3. Supprimer directement les cartes physiques du site connecté
  db.prepare("DELETE FROM t_cartes WHERE site_id = ?").run(siteId);

  // Laisser souffler l'event loop d'Electron
  await new Promise((resolve) => setTimeout(resolve, 50));

  // 4. Recréer la table FTS5 toute neuve
  db.exec('CREATE VIRTUAL TABLE t_cartes_fts USING fts5(noms, prenoms, num_secu, contact, lieu_de_naissance, rangement);');

  // 5. Réactiver les déclencheurs (triggers) standards
  db.exec(`
    CREATE TRIGGER trg_cartes_ai AFTER INSERT ON t_cartes BEGIN
      INSERT INTO t_cartes_fts(rowid, noms, prenoms, num_secu, contact, lieu_de_naissance, rangement)
      VALUES (new.id_carte, new.noms, new.prenoms, new.num_secu, new.contact, new.lieu_de_naissance, new.rangement);
    END;
  `);
  db.exec(`
    CREATE TRIGGER trg_cartes_ad AFTER DELETE ON t_cartes BEGIN
      DELETE FROM t_cartes_fts WHERE rowid = old.id_carte;
    END;
  `);
  db.exec(`
    CREATE TRIGGER trg_cartes_au AFTER UPDATE ON t_cartes BEGIN
      DELETE FROM t_cartes_fts WHERE rowid = old.id_carte;
      INSERT INTO t_cartes_fts(rowid, noms, prenoms, num_secu, contact, lieu_de_naissance, rangement)
      VALUES (new.id_carte, new.noms, new.prenoms, new.num_secu, new.contact, new.lieu_de_naissance, new.rangement);
    END;
  `);

  // Laisser souffler l'event loop d'Electron
  await new Promise((resolve) => setTimeout(resolve, 50));

  // 6. Réindexer uniquement les cartes qui restent (les autres sites)
  db.prepare(`
    INSERT INTO t_cartes_fts(rowid, noms, prenoms, num_secu, contact, lieu_de_naissance, rangement)
    SELECT id_carte, noms, prenoms, num_secu, contact, lieu_de_naissance, rangement 
    FROM t_cartes
  `).run();

  db.pragma('foreign_keys = ON');

  // Compactage VACUUM asynchrone rapide
  setTimeout(() => {
    try {
      db.prepare("VACUUM").run();
      log.info("Emergency VACUUM completed.");
    } catch (err) {
      log.error("Emergency VACUUM failed", err);
    }
  }, 100);

  return { success: true };
}

// ============================================================
// ASSAINISSEMENT TABS (PAGINATED & ASYNC)
// ============================================================

export function getDoublonsStrictsPage(siteId: number, offset: number, limit: number, query?: string) {
  const db = getDatabase()!;
  let where = "WHERE site_id = ? AND cle_doublon IS NOT NULL AND cle_doublon != '' AND cle_doublon != '||||'";
  const params: any[] = [siteId];

  if (query && query.trim()) {
    where += " AND (noms LIKE ? OR prenoms LIKE ? OR contact LIKE ?)";
    params.push(`%${query}%`, `%${query}%`, `%${query}%`);
  }

  // Obtenir le nombre total de groupes de doublons distincts
  const totalRow = db.prepare(`
    SELECT COUNT(DISTINCT cle_doublon) as count FROM t_cartes ${where} GROUP BY cle_doublon HAVING COUNT(*) > 1
  `).all(...params);
  const total = totalRow.length;

  // Récupérer les clés de doublons pour la page actuelle
  const duplicateKeys = db.prepare(`
    SELECT cle_doublon, COUNT(*) as count 
    FROM t_cartes 
    ${where}
    GROUP BY cle_doublon 
    HAVING COUNT(*) > 1
    ORDER BY count DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as { cle_doublon: string, count: number }[];

  // Récupérer toutes les cartes correspondant à ces clés de doublon
  const rows: any[] = [];
  if (duplicateKeys.length > 0) {
    const keys = duplicateKeys.map(k => k.cle_doublon);
    const placeholders = keys.map(() => '?').join(',');
    const sql = `SELECT * FROM t_cartes WHERE site_id = ? AND cle_doublon IN (${placeholders}) ORDER BY cle_doublon, id_carte`;
    rows.push(...db.prepare(sql).all(siteId, ...keys));
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

  const totalRow = db.prepare(`SELECT COUNT(*) as count FROM t_cartes ${where}`).get(...params) as { count: number };
  const total = totalRow?.count || 0;
  
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

  const totalRow = db.prepare(`SELECT COUNT(*) as count FROM t_cartes ${where}`).get(...params) as { count: number };
  const total = totalRow?.count || 0;

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

  // FTS5 search or fallback queries
  // 1. Recherche par numéro exact de sécu/cmu ou téléphone
  // 2. Recherche par nom/prénom ou date de naissance YYYY-MM-DD
  const searchPattern = `%${cleaned}%`;
  
  return db.prepare(`
    SELECT id_carte, noms, prenoms, date_de_naissance, lieu_de_naissance, num_secu, rangement, statut, statut_physique
    FROM t_cartes
    WHERE site_id = ? 
      AND (
        UPPER(num_secu) = UPPER(?) 
        OR contact = ? 
        OR date_de_naissance = ? 
        OR noms LIKE ? 
        OR prenoms LIKE ?
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
    // Recherche par nom et prénom combinés en FTS ou LIKE croisé
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
  
  // Utilisation de la constante de statut 'DELIVRE'
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

export async function getCentreStats(centreId: number, siteId: number) {
  const db = getDatabase()!;
  return db.prepare(`
    SELECT
      COUNT(*) as total,
      IFNULL(SUM(CASE WHEN statut = 'EN STOCK' OR statut IS NULL OR statut = '' THEN 1 ELSE 0 END), 0) as en_stock,
      IFNULL(SUM(CASE WHEN statut IN ('DELIVRE','DISTRIBUEE','RETIRE') THEN 1 ELSE 0 END), 0) as distribuees,
      IFNULL(SUM(CASE WHEN statut_physique = 'ABSENT' THEN 1 ELSE 0 END), 0) as absentes
    FROM t_cartes
    WHERE site_id = ? AND centre_id = ?
  `).get(siteId, centreId) as Record<string, number>;
}

export function getCentreOperateurCadence(centreId: number) {
  const db = getDatabase()!;
  return db.prepare(`
    SELECT 
      u.id_user, 
      u.login, 
      u.nom_user, 
      u.prenom_user,
      COUNT(c.id_carte) as verifications_today,
      MAX(c.updated_at) as derniere_activite
    FROM t_users u
    LEFT JOIN t_cartes c ON c.agent_distributeur = u.login AND date(c.date_delivrance) = date('now')
    WHERE u.centre_id = ? AND u.role = 'OPERATEUR_VERIFICATION'
    GROUP BY u.id_user
    ORDER BY verifications_today DESC
  `).all(centreId);
}

// ============================================================
// RETRAITS ANALYTICS
// ============================================================

type PeriodFilter = 'jour' | 'semaine' | 'mois' | 'annee';

function buildPeriodWhere(period: PeriodFilter): string {
  switch (period) {
    case 'jour':    return "AND date(date_delivrance, 'localtime') = date('now', 'localtime')";
    case 'semaine': return "AND date(date_delivrance, 'localtime') >= date('now', '-6 days', 'localtime')";
    case 'mois':    return "AND strftime('%Y-%m', date_delivrance, 'localtime') = strftime('%Y-%m', 'now', 'localtime')";
    case 'annee':   return "AND strftime('%Y', date_delivrance, 'localtime') = strftime('%Y', 'now', 'localtime')";
  }
}

/**
 * Retraits groupés par centre pour un site donné.
 * centreId = null  → ADMINISTRATEUR_SITE (tous les centres du site)
 * centreId = N     → ADMIN_CENTRE (son seul centre)
 */
export function getRetraitsByCentre(siteId: number, centreId: number | null, period: PeriodFilter) {
  const db = getDatabase()!;
  const periodWhere = buildPeriodWhere(period);
  const centreFilter = centreId !== null ? 'AND ca.centre_id = @centreId' : '';

  const rows = db.prepare(`
    SELECT
      co.id   AS centre_id,
      co.nom  AS centre_nom,
      COUNT(ca.id_carte) AS total
    FROM t_centres co
    LEFT JOIN t_cartes ca
      ON ca.centre_id = co.id
      AND ca.statut = 'DELIVRE'
      AND ca.date_delivrance IS NOT NULL
      AND ca.date_delivrance != ''
      ${periodWhere}
      ${centreFilter}
    WHERE co.site_id = @siteId
    GROUP BY co.id
    ORDER BY total DESC
  `).all({ siteId, centreId: centreId ?? null }) as Array<{ centre_id: number; centre_nom: string; total: number }>;

  // Agrégats globaux du scope
  const totaux = db.prepare(`
    SELECT
      COUNT(*) AS total,
      COUNT(CASE WHEN date(date_delivrance, 'localtime') = date('now', 'localtime') THEN 1 END)            AS aujourd_hui,
      COUNT(CASE WHEN date(date_delivrance, 'localtime') >= date('now', '-6 days', 'localtime') THEN 1 END) AS cette_semaine,
      COUNT(CASE WHEN strftime('%Y-%m', date_delivrance, 'localtime') = strftime('%Y-%m', 'now', 'localtime') THEN 1 END) AS ce_mois,
      COUNT(CASE WHEN strftime('%Y', date_delivrance, 'localtime') = strftime('%Y', 'now', 'localtime') THEN 1 END) AS cette_annee
    FROM t_cartes
    WHERE statut = 'DELIVRE'
      AND site_id = @siteId
      ${centreFilter}
      AND date_delivrance IS NOT NULL AND date_delivrance != ''
  `).get({ siteId, centreId: centreId ?? null }) as any;

  return { rows, totaux };
}

/**
 * Courbe temporelle des retraits (granularité adaptée à la période).
 * Jour     → 24 dernières heures par heure
 * Semaine  → 7 derniers jours
 * Mois     → jours du mois courant
 * Année    → 12 mois de l'année courante
 */
export function getRetraitsTrend(siteId: number, centreId: number | null, period: PeriodFilter) {
  const db = getDatabase()!;
  const centreFilter = centreId !== null ? 'AND centre_id = @centreId' : '';

  let groupBy: string;
  let orderBy: string;
  let periodWhere: string;

  if (period === 'jour') {
    groupBy  = "strftime('%H:00', date_delivrance, 'localtime')";
    orderBy  = 'label ASC';
    periodWhere = "AND date(date_delivrance, 'localtime') = date('now', 'localtime')";
  } else if (period === 'semaine') {
    groupBy  = "date(date_delivrance, 'localtime')";
    orderBy  = 'label ASC';
    periodWhere = "AND date(date_delivrance, 'localtime') >= date('now', '-6 days', 'localtime')";
  } else if (period === 'mois') {
    groupBy  = "date(date_delivrance, 'localtime')";
    orderBy  = 'label ASC';
    periodWhere = "AND strftime('%Y-%m', date_delivrance, 'localtime') = strftime('%Y-%m', 'now', 'localtime')";
  } else {
    groupBy  = "strftime('%Y-%m', date_delivrance, 'localtime')";
    orderBy  = 'label ASC';
    periodWhere = "AND strftime('%Y', date_delivrance, 'localtime') = strftime('%Y', 'now', 'localtime')";
  }

  return db.prepare(`
    SELECT
      ${groupBy} AS label,
      COUNT(*) AS total
    FROM t_cartes
    WHERE statut = 'DELIVRE'
      AND site_id = @siteId
      ${centreFilter}
      AND date_delivrance IS NOT NULL AND date_delivrance != ''
      ${periodWhere}
    GROUP BY label
    ORDER BY ${orderBy}
  `).all({ siteId, centreId: centreId ?? null }) as Array<{ label: string; total: number }>;
}
