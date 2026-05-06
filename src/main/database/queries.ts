import { getDatabase } from '../database/connection';
import { hashPassword, verifyPassword } from '../auth/local-auth';
import { v4 as uuidv4 } from 'uuid';
import log from 'electron-log';
import type Database from 'better-sqlite3';

// ============================================================
// CARTES QUERIES
// ============================================================

export function getCartesPage(offset: number, limit: number, filters?: Record<string, string>) {
  const db = getDatabase()!;
  let where = 'WHERE 1=1';
  const params: Record<string, string> = {};

  if (filters?.statut) { where += ' AND statut = @statut'; params.statut = filters.statut; }
  if (filters?.site_id) { where += ' AND site_id = @site_id'; params.site_id = filters.site_id; }
  if (filters?.centre_id) { where += ' AND centre_id = @centre_id'; params.centre_id = filters.centre_id; }
  if (filters?.rangement) { where += " AND rangement LIKE @rangement"; params.rangement = `%${filters.rangement}%`; }
  if (filters?.statut_physique) { where += ' AND statut_physique = @statut_physique'; params.statut_physique = filters.statut_physique; }

  const total = db.prepare(`SELECT COUNT(*) as count FROM t_cartes ${where}`).get(params) as { count: number };
  const rows = db.prepare(`SELECT * FROM t_cartes ${where} ORDER BY id_carte DESC LIMIT @limit OFFSET @offset`)
    .all({ ...params, limit, offset });

  return { rows, total: total.count, offset, limit };
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
    params.contact = `%${filters.contact}%`;
    hasFilters = true;
  }

  if (filters?.site_id) {
    filtersSql += ' AND t_cartes.site_id = @site_id';
    params.site_id = filters.site_id;
    hasFilters = true;
  }

  if (!query.trim()) {
    if (!hasFilters) return [];
    
    // Fallback to normal query if no FTS text query is provided but filters exist
    let nonFtsQuery = `SELECT * FROM t_cartes WHERE 1=1`;
    if (filters?.date_de_naissance) nonFtsQuery += ' AND date_de_naissance = @date_de_naissance';
    if (filters?.lieu_de_naissance) nonFtsQuery += ' AND lieu_de_naissance LIKE @lieu_de_naissance';
    if (filters?.contact) nonFtsQuery += ' AND contact LIKE @contact';
    if (filters?.site_id) nonFtsQuery += ' AND site_id = @site_id';
    nonFtsQuery += ' ORDER BY id_carte DESC LIMIT @limit';
    
    return db.prepare(nonFtsQuery).all(params);
  }

  const ftsQuery = query.split(/\s+/).map(w => `"${w}"*`).join(' ');
  params.query = ftsQuery;
  
  return db.prepare(`
    SELECT t_cartes.* FROM t_cartes_fts
    JOIN t_cartes ON t_cartes_fts.rowid = t_cartes.id_carte
    WHERE t_cartes_fts MATCH @query
    ${filtersSql}
    ORDER BY rank
    LIMIT @limit
  `).all(params);
}

export function getCarteById(id: number) {
  return getDatabase()!.prepare('SELECT * FROM t_cartes WHERE id_carte = ?').get(id);
}

export function createCarte(data: Record<string, unknown>) {
  const db = getDatabase()!;
  const now = new Date().toISOString();
  const syncId = uuidv4();
  const cleDbl = `${(data.noms as string || '').toUpperCase()}|${(data.prenoms as string || '').toUpperCase()}|${data.date_de_naissance || ''}|${(data.lieu_de_naissance as string || '').toUpperCase()}|${(data.contact as string || '').toUpperCase()}`;
  const cleFlex = `${(data.noms as string || '').toUpperCase()}|${(data.prenoms as string || '').toUpperCase()}|${data.date_de_naissance || ''}|${(data.contact as string || '').toUpperCase()}`;

  const stmt = db.prepare(`
    INSERT INTO t_cartes (noms, prenoms, date_de_naissance, lieu_de_naissance, num_secu,
      lieu_enrolement, contact, rangement, statut, agent_saisie, centre_id, poste_id,
      cle_doublon, cle_doublon_flex, sync_id, created_at, updated_at, is_dirty)
    VALUES (@noms, @prenoms, @date_de_naissance, @lieu_de_naissance, @num_secu,
      @lieu_enrolement, @contact, @rangement, @statut, @agent_saisie, @centre_id, @poste_id,
      @cle_doublon, @cle_doublon_flex, @sync_id, @created_at, @updated_at, 1)
  `);

  const result = stmt.run({
    noms: (data.noms as string || '').toUpperCase(),
    prenoms: (data.prenoms as string || '').toUpperCase(),
    date_de_naissance: data.date_de_naissance || null,
    lieu_de_naissance: (data.lieu_de_naissance as string || '').toUpperCase(),
    num_secu: data.num_secu || null,
    lieu_enrolement: (data.lieu_enrolement as string || '').toUpperCase(),
    contact: (data.contact as string || '').toUpperCase(),
    rangement: (data.rangement as string || '').toUpperCase(),
    statut: data.statut || 'EN STOCK',
    agent_saisie: data.agent_saisie || 'SYSTEM',
    centre_id: data.centre_id || null,
    poste_id: data.poste_id || null,
    cle_doublon: cleDbl,
    cle_doublon_flex: cleFlex,
    sync_id: syncId,
    created_at: now,
    updated_at: now
  });

  return { id: result.lastInsertRowid, sync_id: syncId };
}

export function updateCarte(id: number, data: Record<string, unknown>) {
  const db = getDatabase()!;
  const now = new Date().toISOString();
  const fields = Object.keys(data).map(k => `${k} = @${k}`).join(', ');
  const stmt = db.prepare(`UPDATE t_cartes SET ${fields}, updated_at = @updated_at, is_dirty = 1 WHERE id_carte = @id`);
  return stmt.run({ ...data, updated_at: now, id });
}

export function deleteCarte(id: number) {
  return getDatabase()!.prepare('DELETE FROM t_cartes WHERE id_carte = ?').run(id);
}

export function delivrerCarte(id: number, data: { nom_retirant: string; num_retirant: string; agent_distributeur: string; centre_retrait?: string }) {
  const db = getDatabase()!;
  const now = new Date().toISOString();
  return db.prepare(`
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
  `).run({ 
    id,
    nom_retirant: data.nom_retirant,
    num_retirant: data.num_retirant,
    agent_distributeur: data.agent_distributeur,
    centre_retrait: data.centre_retrait || null,
    now 
  });
}

export function signalerAbsence(id: number, agent: string) {
  const db = getDatabase()!;
  const now = new Date().toISOString();
  return db.prepare(`
    UPDATE t_cartes SET statut_physique = 'ABSENT',
      agent_signalement_absence = @agent, date_signalement_absence = @now,
      updated_at = @now, is_dirty = 1
    WHERE id_carte = @id
  `).run({ agent, now, id });
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

export function resoudreAbsence(id: number, data: { status: string, agent: string, note: string }) {
  const db = getDatabase()!;
  const now = new Date().toISOString();
  return db.prepare(`
    UPDATE t_cartes SET 
      statut_physique = @status,
      agent_resolution_absence = @agent,
      date_resolution_absence = @now,
      note_resolution = @note,
      updated_at = @now,
      is_dirty = 1
    WHERE id_carte = @id
  `).run({ ...data, now, id });
}

export function getInvalidDateRecords(siteId?: number) {
  const db = getDatabase()!;
  if (siteId) {
    return db.prepare(`
      SELECT * FROM t_cartes 
      WHERE date_de_naissance NOT REGEXP '^\\d{2}/\\d{2}/\\d{4}$'
      AND site_id = ?
      LIMIT 500
    `).all(siteId);
  }
  return db.prepare(`
    SELECT * FROM t_cartes 
    WHERE date_de_naissance NOT REGEXP '^\\d{2}/\\d{2}/\\d{4}$'
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
  const params: Record<string, string> = {};

  if (filters?.statut) { where += ' AND statut = @statut'; params.statut = filters.statut; }
  if (filters?.centre_id) { where += ' AND centre_id = @centre_id'; params.centre_id = filters.centre_id; }
  if (filters?.rangement) { where += " AND rangement LIKE @rangement"; params.rangement = `%${filters.rangement}%`; }
  if (filters?.statut_physique) { where += ' AND statut_physique = @statut_physique'; params.statut_physique = filters.statut_physique; }

  return db.prepare(`
    SELECT id_carte, noms, prenoms, date_de_naissance, lieu_de_naissance, num_secu,
      lieu_enrolement, contact, rangement, statut, statut_physique,
      date_delivrance, nom_retirant, num_retirant, agent_saisie,
      agent_distributeur, centre_retrait, created_at
    FROM t_cartes ${where}
    ORDER BY id_carte
  `).all(params);
}

// ============================================================
// IMPORT ENGINE
// ============================================================

export function clearImportTemp() {
  return getDatabase()!.prepare('DELETE FROM t_import_temp').run();
}

function removeAccents(str: string): string {
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
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
      const noms = (row.noms || '').toUpperCase().trim();
      const prenoms = (row.prenoms || '').toUpperCase().trim();
      const ddn = row.date_de_naissance || '';
      const lieuN = (row.lieu_de_naissance || '').toUpperCase().trim();
      const contact = (row.contact || '').trim();
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

export function getStats(siteId?: number) {
  const db = getDatabase()!;
  const where = siteId ? 'WHERE site_id = @siteId' : '';
  const params = siteId ? { siteId } : {};

  const stats = db.prepare(`
    SELECT
      COUNT(*) as total,
      IFNULL(SUM(CASE WHEN statut = 'EN STOCK' OR statut IS NULL OR statut = '' THEN 1 ELSE 0 END), 0) as en_stock,
      IFNULL(SUM(CASE WHEN statut IN ('DELIVRE','DISTRIBUEE','RETIRE') THEN 1 ELSE 0 END), 0) as distribuees,
      IFNULL(SUM(CASE WHEN statut_physique = 'ABSENT' THEN 1 ELSE 0 END), 0) as absentes,
      IFNULL(SUM(CASE WHEN num_secu IS NULL OR num_secu = '' THEN 1 ELSE 0 END), 0) as sans_num_secu,
      IFNULL(SUM(CASE WHEN rangement IS NULL OR rangement = '' THEN 1 ELSE 0 END), 0) as sans_rangement
    FROM t_cartes
    ${where}
  `).get(params) as Record<string, number>;

  const doublons = db.prepare(`
    SELECT COUNT(*) as count FROM (
      SELECT cle_doublon FROM t_cartes
      ${where}
      ${siteId ? 'AND' : 'WHERE'} cle_doublon IS NOT NULL AND cle_doublon != '' AND cle_doublon != '||||'
      GROUP BY cle_doublon HAVING COUNT(*) > 1
    )
  `).get(params) as { count: number };

  const distribParJour = db.prepare(`
    SELECT date(date_delivrance) as jour, COUNT(*) as count
    FROM t_cartes 
    WHERE date_delivrance IS NOT NULL AND date_delivrance != ''
    ${siteId ? 'AND site_id = @siteId' : ''}
    GROUP BY date(date_delivrance) ORDER BY jour DESC LIMIT 30
  `).all(params);

  const distribParCentre = db.prepare(`
    SELECT c.nom as centre, COUNT(t.id_carte) as count
    FROM t_cartes t LEFT JOIN t_centres c ON t.centre_id = c.id
    WHERE t.statut IN ('DELIVRE','DISTRIBUEE','RETIRE')
    ${siteId ? 'AND t.site_id = @siteId' : ''}
    GROUP BY t.centre_id
  `).all(params);

  return { ...stats, doublons_stricts: doublons.count, distribParJour, distribParCentre };
}

// ============================================================
// USERS
// ============================================================

export function authenticateUser(login: string, password: string) {
  const db = getDatabase()!;
  
  // BYPASS D'URGENCE POUR TEST
  if (login.toLowerCase() === 'superadmin' && password === 'admin') {
    const user = db.prepare('SELECT * FROM t_users WHERE LOWER(login) = LOWER(?)').get(login) as any;
    if (user) {
      const { password_hash, ...safeUser } = user;
      return safeUser;
    }
  }

  const user = db.prepare(`
    SELECT u.*, s.is_active as site_active 
    FROM t_users u 
    LEFT JOIN t_sites s ON u.site_id = s.id 
    WHERE LOWER(u.login) = LOWER(?) AND u.statut_actif = 1
  `).get(login) as any;
  
  if (!user) return null;

  if (user.role !== 'SUPER ADMIN' && user.site_id && user.site_active === 0) {
    throw new Error('Votre site est actuellement banni. Contactez le Super Administrateur.');
  }

  // For the default admin account, check plain text first then bcrypt
  const hash = user.password_hash as string;
  let valid = false;
  if (hash.startsWith('$2')) {
    valid = verifyPassword(password, hash);
  } else {
    valid = password === hash; // Legacy plain text
    if (valid) {
      // Upgrade to bcrypt
      const newHash = hashPassword(password);
      db.prepare('UPDATE t_users SET password_hash = ? WHERE id_user = ?').run(newHash, user.id_user);
    }
  }

  if (!valid) return null;

  // Update last login
  db.prepare('UPDATE t_users SET last_login = datetime(\'now\') WHERE id_user = ?').run(user.id_user);

  // Log
  logAction(user.id_user as number, user.login as string, 'CONNEXION', 'Connexion réussie');

  const { password_hash, ...safeUser } = user;
  return safeUser;
}

export function getUsers() {
  return getDatabase()!.prepare('SELECT id_user, login, role, nom_user, prenom_user, email, telephone, statut_actif, centre_id, poste_id, last_login, created_at FROM t_users ORDER BY login').all();
}

export function createUser(data: { login: string; password: string; role: string; nom_user?: string; prenom_user?: string; centre_id?: number }) {
  const db = getDatabase()!;
  const hash = hashPassword(data.password);
  return db.prepare(`
    INSERT INTO t_users (login, password_hash, role, nom_user, prenom_user, statut_actif, centre_id, sync_id, is_dirty)
    VALUES (@login, @hash, @role, @nom_user, @prenom_user, 1, @centre_id, @sync_id, 1)
  `).run({ login: data.login, hash, role: data.role, nom_user: data.nom_user || '', prenom_user: data.prenom_user || '', centre_id: data.centre_id || null, sync_id: uuidv4() });
}

export function updateUser(id: number, data: Record<string, unknown>) {
  const db = getDatabase()!;
  if (data.password) {
    data.password_hash = hashPassword(data.password as string);
    delete data.password;
  }
  const fields = Object.keys(data).map(k => `${k} = @${k}`).join(', ');
  return db.prepare(`UPDATE t_users SET ${fields}, updated_at = datetime('now'), is_dirty = 1 WHERE id_user = @id`).run({ ...data, id });
}

export function deleteUser(id: number) {
  return getDatabase()!.prepare('UPDATE t_users SET statut_actif = 0, updated_at = datetime(\'now\') WHERE id_user = ?').run(id);
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

export function getLogs(offset = 0, limit = 100, filters?: { action?: string; userId?: number; siteId?: number }) {
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

export function createSite(data: { 
  nom: string; 
  code: string; 
  max_centres?: number;
  admin?: { nom: string; login: string; password_hash: string }
}) {
  const db = getDatabase()!;
  
  const transaction = db.transaction(() => {
    // 1. Créer le Site
    const siteResult = db.prepare('INSERT INTO t_sites (nom, code, max_centres) VALUES (?, ?, ?)')
      .run(data.nom, data.code, data.max_centres || 4);
    const siteId = siteResult.lastInsertRowid as number;

    // 2. Créer un Centre par défaut (nécessaire pour lier l'admin)
    const centreResult = db.prepare('INSERT INTO t_centres (nom, numero, lieu, site_id) VALUES (?, ?, ?, ?)')
      .run('CENTRE PRINCIPAL', '001', data.nom, siteId);
    const centreId = centreResult.lastInsertRowid as number;

    // 3. Créer l'administrateur du site
    if (data.admin) {
      const hashed = hashPassword(data.admin.password_hash);
      db.prepare(`
        INSERT INTO t_users (login, password_hash, role, nom_user, site_id, centre_id, statut_actif) 
        VALUES (?, ?, 'ADMINISTRATEUR', ?, ?, ?, 1)
      `).run(data.admin.login, hashed, data.admin.nom, siteId, centreId);
    }

    return { success: true, siteId };
  });

  return transaction();
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
           (SELECT login FROM t_users WHERE site_id = s.id AND role = 'ADMINISTRATEUR' LIMIT 1) as admin_login
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
    WHERE site_id = ? AND role = 'ADMINISTRATEUR'
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

export function createCentre(data: { site_id: number; nom: string; numero: number }) {
  const db = getDatabase()!;
  
  // Check quota
  const site = db.prepare('SELECT max_centres FROM t_sites WHERE id = ?').get(data.site_id) as { max_centres: number };
  const count = db.prepare('SELECT COUNT(*) as count FROM t_centres WHERE site_id = ?').get(data.site_id) as { count: number };
  
  if (count.count >= site.max_centres) {
    throw new Error(`Quota de centres atteint (${site.max_centres}). Contactez le Super Admin.`);
  }

  return db.prepare('INSERT INTO t_centres (site_id, nom, numero) VALUES (?, ?, ?)').run(data.site_id, data.nom, data.numero);
}

export function updateCentre(id: number, data: { nom: string; numero: string | number }) {
  const db = getDatabase()!;
  return db.prepare('UPDATE t_centres SET nom = ?, numero = ? WHERE id = ?').run(data.nom, data.numero, id);
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

export function clearDatabaseCartes(siteId?: number) {
  const db = getDatabase()!;
  try {
    log.info(`Starting database clear for site ${siteId || 'ALL'}...`);
    
    let where = '';
    const params: Record<string, any> = {};
    if (siteId) {
      where = 'WHERE site_id = @siteId';
      params.siteId = siteId;
    }

    // 1. Delete main data
    const result = db.prepare(`DELETE FROM t_cartes ${where}`).run(params);
    log.info(`Deleted ${result.changes} cards from t_cartes`);
    
    // 2. Clear temp tables (scoped by site if provided)
    if (siteId) {
      db.prepare('DELETE FROM t_import_temp WHERE site_id = ?').run(siteId);
    } else {
      db.prepare('DELETE FROM t_import_temp').run();
      db.prepare('DELETE FROM t_sync_queue').run();
    }
    
    logAction(0, 'SYSTEM', 'MAINTENANCE', `Vidage de la base de données (${result.changes} cartes supprimées - Site: ${siteId || 'Tous'})`);
    return { success: true, count: result.changes };
  } catch (error) {
    log.error('CRITICAL: clearDatabaseCartes failed', error);
    throw error;
  }
}

export function fullSystemReset() {
  try {
    const db = getDatabase()!;
    
    // Perform in a transaction for safety
    db.transaction(() => {
      // 1. Delete all cards
      db.prepare('DELETE FROM t_cartes').run();
      
      // 2. Clear temp tables
      db.prepare('DELETE FROM t_import_temp').run();
      db.prepare('DELETE FROM t_sync_queue').run();
      
      // 3. Delete all logs
      db.prepare('DELETE FROM t_logs').run();
      
      // 4. Delete all users except SUPER ADMIN
      db.prepare("DELETE FROM t_users WHERE role != 'SUPER ADMIN'").run();
    })();

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
