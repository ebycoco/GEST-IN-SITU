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
  if (filters?.centre_id) { where += ' AND centre_id = @centre_id'; params.centre_id = filters.centre_id; }
  if (filters?.rangement) { where += " AND rangement LIKE @rangement"; params.rangement = `%${filters.rangement}%`; }
  if (filters?.statut_physique) { where += ' AND statut_physique = @statut_physique'; params.statut_physique = filters.statut_physique; }

  const total = db.prepare(`SELECT COUNT(*) as count FROM t_cartes ${where}`).get(params) as { count: number };
  const rows = db.prepare(`SELECT * FROM t_cartes ${where} ORDER BY id_carte DESC LIMIT @limit OFFSET @offset`)
    .all({ ...params, limit, offset });

  return { rows, total: total.count, offset, limit };
}

export function searchCartesFTS(query: string, limit = 100) {
  const db = getDatabase()!;
  if (!query.trim()) return [];

  const ftsQuery = query.split(/\s+/).map(w => `"${w}"*`).join(' ');
  return db.prepare(`
    SELECT t_cartes.* FROM t_cartes_fts
    JOIN t_cartes ON t_cartes_fts.rowid = t_cartes.id_carte
    WHERE t_cartes_fts MATCH @query
    ORDER BY rank
    LIMIT @limit
  `).all({ query: ftsQuery, limit });
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
      statut = 'DISTRIBUEE',
      date_delivrance = @now,
      nom_retirant = @nom_retirant,
      num_retirant = @num_retirant,
      agent_distributeur = @agent_distributeur,
      centre_retrait = @centre_retrait,
      updated_at = @now,
      is_dirty = 1
    WHERE id_carte = @id
  `).run({ ...data, now, id });
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

// ============================================================
// IMPORT ENGINE
// ============================================================

export function clearImportTemp() {
  return getDatabase()!.prepare('DELETE FROM t_import_temp').run();
}

export function importBatch(rows: Record<string, string>[], agentSaisie: string) {
  const db = getDatabase()!;
  const insertStmt = db.prepare(`
    INSERT INTO t_import_temp (noms, prenoms, date_de_naissance, num_secu,
      lieu_de_naissance, contact, lieu_enrolement, rangement, statut,
      date_delivrance, agent_saisie, cle_doublon, cle_doublon_flex)
    VALUES (@noms, @prenoms, @date_de_naissance, @num_secu,
      @lieu_de_naissance, @contact, @lieu_enrolement, @rangement, @statut,
      @date_delivrance, @agent_saisie, @cle_doublon, @cle_doublon_flex)
  `);

  const insertMany = db.transaction((items: Record<string, string>[]) => {
    for (const row of items) {
      const noms = (row.noms || '').toUpperCase().trim();
      const prenoms = (row.prenoms || '').toUpperCase().trim();
      const ddn = row.date_de_naissance || '';
      const lieuN = (row.lieu_de_naissance || '').toUpperCase().trim();
      const contact = (row.contact || '').toUpperCase().trim();
      const cleDbl = `${noms}|${prenoms}|${ddn}|${lieuN}|${contact}`;
      const cleFlex = `${noms}|${prenoms}|${ddn}|${contact}`;

      insertStmt.run({
        noms, prenoms, date_de_naissance: ddn,
        num_secu: (row.num_secu || '').trim(),
        lieu_de_naissance: lieuN,
        contact,
        lieu_enrolement: (row.lieu_enrolement || '').toUpperCase().trim(),
        rangement: (row.rangement || '').toUpperCase().trim(),
        statut: (row.statut || 'EN STOCK').toUpperCase().trim(),
        date_delivrance: row.date_delivrance || '',
        agent_saisie: agentSaisie,
        cle_doublon: cleDbl,
        cle_doublon_flex: cleFlex
      });
    }
  });

  insertMany(rows);
  return rows.length;
}

export function fusionnerImport() {
  const db = getDatabase()!;
  const now = new Date().toISOString();

  // Optimized update using UPDATE FROM (SQLite 3.33+)
  // This updates existing cards that are currently 'EN STOCK' with new status if they are in the import
  const updateResult = db.prepare(`
    UPDATE t_cartes
    SET 
      statut = t_import_temp.statut,
      updated_at = @now,
      is_dirty = 1
    FROM t_import_temp
    WHERE t_cartes.cle_doublon = t_import_temp.cle_doublon
      AND (t_cartes.statut = 'EN STOCK' OR t_cartes.statut IS NULL OR t_cartes.statut = '')
      AND t_import_temp.statut IN ('DELIVRE','DISTRIBUEE','RETIRE')
  `).run({ now });

  // Insert new cards efficiently
  const insertResult = db.prepare(`
    INSERT INTO t_cartes (
      noms, prenoms, date_de_naissance, num_secu, lieu_de_naissance,
      contact, lieu_enrolement, rangement, statut, date_delivrance, agent_saisie,
      cle_doublon, cle_doublon_flex, sync_id, created_at, updated_at, is_dirty
    )
    SELECT 
      noms, prenoms, date_de_naissance, num_secu, lieu_de_naissance,
      contact, lieu_enrolement, rangement, statut, date_delivrance, agent_saisie,
      cle_doublon, cle_doublon_flex, lower(hex(randomblob(16))),
      @now, @now, 1
    FROM t_import_temp
    WHERE cle_doublon NOT IN (SELECT cle_doublon FROM t_cartes WHERE cle_doublon IS NOT NULL)
  `).run({ now });

  // Clear temp and vacuum if needed (optional)
  db.prepare('DELETE FROM t_import_temp').run();

  return { updated: updateResult.changes, inserted: insertResult.changes };
}

// ============================================================
// STATISTICS
// ============================================================

export function getStats() {
  const db = getDatabase()!;
  const stats = db.prepare(`
    SELECT
      COUNT(*) as total,
      IFNULL(SUM(CASE WHEN statut = 'EN STOCK' OR statut IS NULL OR statut = '' THEN 1 ELSE 0 END), 0) as en_stock,
      IFNULL(SUM(CASE WHEN statut IN ('DELIVRE','DISTRIBUEE','RETIRE') THEN 1 ELSE 0 END), 0) as distribuees,
      IFNULL(SUM(CASE WHEN statut_physique = 'ABSENT' THEN 1 ELSE 0 END), 0) as absentes,
      IFNULL(SUM(CASE WHEN num_secu IS NULL OR num_secu = '' THEN 1 ELSE 0 END), 0) as sans_num_secu,
      IFNULL(SUM(CASE WHEN rangement IS NULL OR rangement = '' THEN 1 ELSE 0 END), 0) as sans_rangement
    FROM t_cartes
  `).get() as Record<string, number>;

  const doublons = db.prepare(`
    SELECT COUNT(*) as count FROM (
      SELECT cle_doublon FROM t_cartes
      WHERE cle_doublon IS NOT NULL AND cle_doublon != '' AND cle_doublon != '||||'
      GROUP BY cle_doublon HAVING COUNT(*) > 1
    )
  `).get() as { count: number };

  const distribParJour = db.prepare(`
    SELECT date(date_delivrance) as jour, COUNT(*) as count
    FROM t_cartes WHERE date_delivrance IS NOT NULL AND date_delivrance != ''
    GROUP BY date(date_delivrance) ORDER BY jour DESC LIMIT 30
  `).all();

  const distribParCentre = db.prepare(`
    SELECT c.nom as centre, COUNT(t.id_carte) as count
    FROM t_cartes t LEFT JOIN t_centres c ON t.centre_id = c.id
    WHERE t.statut IN ('DELIVRE','DISTRIBUEE','RETIRE')
    GROUP BY t.centre_id
  `).all();

  return { ...stats, doublons_stricts: doublons.count, distribParJour, distribParCentre };
}

// ============================================================
// USERS
// ============================================================

export function authenticateUser(login: string, password: string) {
  const db = getDatabase()!;
  
  // BYPASS D'URGENCE POUR TEST
  if (login === 'superadmin' && password === 'admin') {
    const user = db.prepare('SELECT * FROM t_users WHERE login = ?').get(login) as any;
    if (user) {
      const { password_hash, ...safeUser } = user;
      return safeUser;
    }
  }

  const user = db.prepare('SELECT * FROM t_users WHERE login = ? AND statut_actif = 1').get(login) as Record<string, unknown> | undefined;
  if (!user) return null;

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
  db.prepare('UPDATE t_users SET last_login = datetime("now") WHERE id_user = ?').run(user.id_user);

  // Log
  logAction(user.id_user as number, user.login as string, 'CONNEXION', 'Connexion réussie');

  const { password_hash, ...safeUser } = user;
  return safeUser;
}

export function getUsers() {
  return getDatabase()!.prepare('SELECT id_user, login, role, nom_user, prenom_user, email, telephone, statut_actif, centre_id, poste_id, last_login, created_at FROM t_users ORDER BY login').all();
}

export function createUser(data: { login: string; password: string; role: string; nom_user?: string; centre_id?: number }) {
  const db = getDatabase()!;
  const hash = hashPassword(data.password);
  return db.prepare(`
    INSERT INTO t_users (login, password_hash, role, nom_user, statut_actif, centre_id, sync_id, is_dirty)
    VALUES (@login, @hash, @role, @nom_user, 1, @centre_id, @sync_id, 1)
  `).run({ login: data.login, hash, role: data.role, nom_user: data.nom_user || '', centre_id: data.centre_id || null, sync_id: uuidv4() });
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
  return getDatabase()!.prepare('UPDATE t_users SET statut_actif = 0, updated_at = datetime("now") WHERE id_user = ?').run(id);
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

export function getLogs(offset = 0, limit = 100, filters?: { action?: string; userId?: number }) {
  const db = getDatabase()!;
  let where = 'WHERE 1=1';
  const params: Record<string, unknown> = {};
  if (filters?.action) { where += ' AND action = @action'; params.action = filters.action; }
  if (filters?.userId) { where += ' AND id_user = @userId'; params.userId = filters.userId; }

  const total = db.prepare(`SELECT COUNT(*) as count FROM t_logs ${where}`).get(params) as { count: number };
  const rows = db.prepare(`SELECT * FROM t_logs ${where} ORDER BY date_heure DESC LIMIT @limit OFFSET @offset`)
    .all({ ...params, limit, offset });
  return { rows, total: total.count };
}

export function purgeLogs() {
  return getDatabase()!.prepare('DELETE FROM t_logs').run();
}

// ============================================================
// HIERARCHY
// ============================================================

export function getSites() { return getDatabase()!.prepare('SELECT * FROM t_sites').all(); }
export function getCentres(siteId?: number) {
  if (siteId) return getDatabase()!.prepare('SELECT * FROM t_centres WHERE site_id = ?').all(siteId);
  return getDatabase()!.prepare('SELECT * FROM t_centres').all();
}
export function getPostes(centreId?: number) {
  if (centreId) return getDatabase()!.prepare('SELECT * FROM t_postes WHERE centre_id = ?').all(centreId);
  return getDatabase()!.prepare('SELECT * FROM t_postes').all();
}

// ============================================================
// CONFIG
// ============================================================

export function getConfig(key: string) {
  const row = getDatabase()!.prepare('SELECT value FROM t_config WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value || null;
}

export function setConfig(key: string, value: string) {
  return getDatabase()!.prepare('INSERT OR REPLACE INTO t_config (key, value, updated_at) VALUES (?, ?, datetime("now"))').run(key, value);
}

export function getAllConfig() {
  return getDatabase()!.prepare('SELECT * FROM t_config').all();
}
