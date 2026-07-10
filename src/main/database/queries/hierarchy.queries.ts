import { getDatabase } from '../connection';
import { hashPassword, verifyPassword } from '../../auth/local-auth';

export function getSites() {
  const db = getDatabase()!;
  return db.prepare('SELECT * FROM t_sites ORDER BY nom').all();
}

export function getSiteById(id: number) {
  const db = getDatabase()!;
  return db.prepare('SELECT * FROM t_sites WHERE id = ?').get(id) as any;
}

export function getCentres(siteId?: number) {
  const db = getDatabase()!;
  if (siteId) {
    return db.prepare(`
      SELECT c.*, s.nom as site_nom 
      FROM t_centres c 
      LEFT JOIN t_sites s ON c.site_id = s.id 
      WHERE c.site_id = ? 
      ORDER BY c.nom
    `).all(siteId);
  }
  return db.prepare(`
    SELECT c.*, s.nom as site_nom 
    FROM t_centres c 
    LEFT JOIN t_sites s ON c.site_id = s.id 
    ORDER BY s.nom, c.nom
  `).all();
}

export function getCentresWithPrefixes(siteId: number) {
  const db = getDatabase()!;
  return db.prepare(`
    SELECT id, site_id, nom, prefixe_rangement 
    FROM t_centres 
    WHERE site_id = ? AND prefixe_rangement IS NOT NULL AND prefixe_rangement != ''
  `).all(siteId) as any[];
}

export function getPostes(centreId?: number) {
  const db = getDatabase()!;
  if (centreId) {
    return db.prepare("SELECT * FROM t_postes WHERE centre_id = ? ORDER BY nom").all(centreId);
  }
  return db.prepare("SELECT * FROM t_postes ORDER BY nom").all();
}

export function createSite(data: { nom: string; code: string; max_centres: number; admin: { nom: string; login: string; password_hash: string }; sync_id?: string }) {
  const db = getDatabase()!;
  const sync_id = data.sync_id || require('uuid').v4();
  
  return db.transaction(() => {
    // 1. Insert Site
    const siteResult = db.prepare(`
      INSERT INTO t_sites (nom, code, is_active, max_centres, sync_id)
      VALUES (?, ?, 1, ?, ?)
    `).run(data.nom, data.code, data.max_centres, sync_id);
    
    const siteId = siteResult.lastInsertRowid;
    
    // 2. Insert Admin User for this site
    const hash = hashPassword(data.admin.password_hash);
    const userSyncId = require('uuid').v4();
    db.prepare(`
      INSERT INTO t_users (login, password_hash, role, nom_user, prenom_user, statut_actif, site_id, centre_id, sync_id, is_dirty)
      VALUES (?, ?, 'ADMINISTRATEUR_SITE', ?, '', 1, ?, NULL, ?, 1)
    `).run(data.admin.login, hash, data.admin.nom, siteId, userSyncId);
    
    return siteResult;
  })();
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
    // 1. Delete Cards
    db.prepare('DELETE FROM t_cartes WHERE site_id = ?').run(id);
    
    // 2. Delete Logs
    db.prepare('DELETE FROM t_logs WHERE id_user IN (SELECT id_user FROM t_users WHERE site_id = ?)').run(id);
    try { db.prepare('DELETE FROM t_logs WHERE site_id = ?').run(id); } catch(e){}
    
    // 3. Delete Users
    db.prepare("DELETE FROM t_users WHERE site_id = ? AND role != 'SUPER ADMIN'").run(id);
    
    // 4. Delete Postes
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
  const admin = db.prepare("SELECT password_hash FROM t_users WHERE role = 'SUPER ADMIN'").get() as any;
  if (!admin) return false;
  
  const hash = admin.password_hash;
  if (hash.startsWith('$2')) {
    return verifyPassword(password, hash);
  }
  return password === hash;
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

export function createCentre(data: { site_id: number; nom: string; code?: string; lieu?: string; prefixe_rangement?: string; sync_id?: string; numero?: number }) {
  const db = getDatabase()!;
  
  // Check quota
  const site = db.prepare('SELECT max_centres FROM t_sites WHERE id = ?').get(data.site_id) as { max_centres: number };
  const count = db.prepare('SELECT COUNT(*) as count FROM t_centres WHERE site_id = ?').get(data.site_id) as { count: number };
  
  if (count.count >= site.max_centres) {
    throw new Error(`Quota de centres atteint (${site.max_centres}). Contactez le Super Admin.`);
  }

  const sync_id = data.sync_id || require('uuid').v4();

  // Vérification de l'existence des colonnes en base
  const tableInfo = db.prepare("PRAGMA table_info(t_centres)").all() as { name: string }[];
  const hasColumn = (colName: string) => tableInfo.some(c => c.name === colName);

  const columns = ['site_id', 'nom', 'sync_id'];
  const values = [data.site_id, data.nom, sync_id];

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
  
  return db.prepare(`
    INSERT INTO t_centres (${columns.join(', ')}) 
    VALUES (${placeholders})
  `).run(...values);
}

export function updateCentre(id: number, data: { nom?: string; code?: string; lieu?: string; prefixe_rangement?: string; numero?: number }) {
  const db = getDatabase()!;
  const sets: string[] = [];
  const params: any[] = [];

  // Vérification de l'existence des colonnes en base
  const tableInfo = db.prepare("PRAGMA table_info(t_centres)").all() as { name: string }[];
  const hasColumn = (colName: string) => tableInfo.some(c => c.name === colName);

  if (data.nom) { sets.push('nom = ?'); params.push(data.nom); }
  if (data.numero !== undefined && hasColumn('numero')) { sets.push('numero = ?'); params.push(data.numero); }
  if (data.code && hasColumn('code')) { sets.push('code = ?'); params.push(data.code); }
  if (data.lieu && hasColumn('lieu')) { sets.push('lieu = ?'); params.push(data.lieu); }
  if (data.prefixe_rangement !== undefined && hasColumn('prefixe_rangement')) { sets.push('prefixe_rangement = ?'); params.push(data.prefixe_rangement); }

  if (sets.length === 0) return null;
  params.push(id);

  return db.prepare(`UPDATE t_centres SET ${sets.join(', ')} WHERE id = ?`).run(...params);
}

export function createPoste(data: { centre_id: number; nom: string; code?: string; sync_id?: string }) {
  const db = getDatabase()!;
  const sync_id = data.sync_id || require('uuid').v4();
  const result = db.prepare(`
    INSERT INTO t_postes (centre_id, nom, code, sync_id)
    VALUES (?, ?, ?, ?)
  `).run(data.centre_id, data.nom, data.code || null, sync_id);
  return result;
}

export function deleteCentre(id: number) {
  const db = getDatabase()!;
  const transaction = db.transaction(() => {
    // 1. Delete associated postes
    db.prepare('DELETE FROM t_postes WHERE centre_id = ?').run(id);
    // 2. Delete the centre itself
    return db.prepare('DELETE FROM t_centres WHERE id = ?').run(id);
  });
  return transaction();
}

