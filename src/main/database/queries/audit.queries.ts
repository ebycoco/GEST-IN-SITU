import { getDatabase } from '../connection';

export function insertAuditLog(operatorId: string, actionType: string, details: string): void {
  const db = getDatabase();
  if (!db) return;
  try {
    db.prepare(`
      INSERT INTO audit_logs (operator_id, action_type, details)
      VALUES (?, ?, ?)
    `).run(operatorId, actionType, details);
  } catch (err) {
    console.error('Failed to insert audit log:', err);
  }
}

export function getAuditLogsPage(offset: number, limit: number, restrictCentreId?: number): { rows: any[]; total: number } {
  const db = getDatabase();
  if (!db) return { rows: [], total: 0 };
  try {
    let where = '';
    const params: any[] = [];
    if (restrictCentreId !== undefined && restrictCentreId !== null) {
      where = 'WHERE operator_id IN (SELECT login FROM t_users WHERE centre_id = ?)';
      params.push(restrictCentreId);
    }
    
    const countRow = db.prepare(`SELECT COUNT(*) as count FROM audit_logs ${where}`).get(...params) as { count: number } | undefined;
    const total = countRow ? countRow.count : 0;
    
    const queryParams = [...params, limit, offset];
    const rows = db.prepare(`
      SELECT * FROM audit_logs 
      ${where}
      ORDER BY timestamp DESC 
      LIMIT ? OFFSET ?
    `).all(...queryParams);
    return { rows, total };
  } catch (err) {
    console.error('Failed to get audit logs page:', err);
    return { rows: [], total: 0 };
  }
}

export function deleteAuditLog(id: number): void {
  const db = getDatabase();
  if (!db) return;
  try {
    db.prepare('DELETE FROM audit_logs WHERE id = ?').run(id);
  } catch (err) {
    console.error('Failed to delete audit log:', err);
  }
}
