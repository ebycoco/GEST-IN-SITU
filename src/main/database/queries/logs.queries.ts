import { getDatabase } from '../connection';
import { v4 as uuidv4 } from 'uuid';

export function logAction(userId: number | null, loginUser: string, action: string, detail: string, siteId?: number): void {
  const db = getDatabase()!;

  let resolvedSiteId = siteId;
  if (!resolvedSiteId && userId && userId !== 999999) {
    const user = db.prepare('SELECT site_id FROM t_users WHERE id_user = ?').get(userId) as { site_id?: number } | undefined;
    if (user) resolvedSiteId = user.site_id;
  }

  // ─── NEUTRALISATION FK ROOT ──────────────────────────────────────────────
  // Le compte ROOT Failsafe (id 999999) n'existe pas dans t_users.
  // On passe NULL pour éviter la violation de contrainte FOREIGN KEY dans t_logs.
  const safeUserId = (userId === 999999) ? null : userId;
  // ─────────────────────────────────────────────────────────────────────────

  db.prepare(`
    INSERT INTO t_logs (id_user, login_user, action, detail, site_id, sync_id, is_dirty)
    VALUES (?, ?, ?, ?, ?, ?, 1)
  `).run(safeUserId, loginUser, action, detail, resolvedSiteId || 1, uuidv4());
}


export function getLogs(siteId?: number, offset: number = 0, limit: number = 100): any[] {
  const db = getDatabase()!;
  let query = 'SELECT * FROM t_logs';
  const params: any[] = [];
  if (siteId) {
    query += ' WHERE site_id = ?';
    params.push(siteId);
  }
  query += ' ORDER BY date_heure DESC LIMIT ? OFFSET ?';
  return db.prepare(query).all(...params, limit, offset);
}

export function getLogsCount(siteId?: number): number {
  const db = getDatabase()!;
  let query = 'SELECT COUNT(*) as count FROM t_logs';
  const params: any[] = [];
  if (siteId) {
    query += ' WHERE site_id = ?';
    params.push(siteId);
  }
  const row = db.prepare(query).get(...params) as { count: number } | undefined;
  return row ? row.count : 0;
}

export function getUnreadSyncNotifications(siteId?: number): number {
  const db = getDatabase()!;
  let query = `SELECT COUNT(*) as count FROM t_logs WHERE action IN ('SYNC_UPDATE', 'CARTE_ABSENTE_SIGNALEE', 'CARTE_ABSENTE_RETROUVEE', 'CARTE_PERDUE_CONFIRMEE', 'CARTE_PERDUE_RETROUVEE') AND is_read = 0`;
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
  let query = `SELECT * FROM t_logs WHERE action IN ('SYNC_UPDATE', 'CARTE_ABSENTE_SIGNALEE', 'CARTE_ABSENTE_RETROUVEE', 'CARTE_PERDUE_CONFIRMEE', 'CARTE_PERDUE_RETROUVEE') AND is_read = 0`;
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
  let query = `UPDATE t_logs SET is_read = 1, is_dirty = 1 WHERE action IN ('SYNC_UPDATE', 'CARTE_ABSENTE_SIGNALEE', 'CARTE_ABSENTE_RETROUVEE', 'CARTE_PERDUE_CONFIRMEE', 'CARTE_PERDUE_RETROUVEE') AND is_read = 0`;
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
    SET is_read = 1, is_dirty = 1 
    WHERE id_log = ?
  `).run(idLog);
  return result.changes > 0;
}

export function purgeLogs(): void {
  const db = getDatabase()!;
  db.prepare('DELETE FROM t_logs').run();
}

