import { getDatabase } from '../connection';

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

export function clearImportTemp(siteId: number) {
  return getDatabase()!.prepare('DELETE FROM t_import_temp WHERE site_id = ?').run(siteId);
}



export function getImportAnomalies(siteId: number, offset = 0, limit = 50, query?: string) {
  const db = getDatabase()!;
  
  let where = "WHERE site_id = ? AND type_anomalie != 'DATE_INVALIDE'";
  const params: any[] = [siteId];
  
  if (query && query.trim()) {
    where += " AND (noms LIKE ? OR prenoms LIKE ? OR contact LIKE ? OR num_secu LIKE ? OR rangement LIKE ?)";
    params.push(`%${query}%`, `%${query}%`, `%${query}%`, `%${query}%`, `%${query}%`);
  }

  const totalRow = db.prepare(`
    SELECT COUNT(*) as count FROM t_import_anomalies
    ${where}
  `).get(...params) as { count: number };
  const total = totalRow?.count || 0;

  const rows = db.prepare(`
    SELECT
      id,
      id AS id_carte,
      carte_id,
      type_anomalie,
      COALESCE(erreur_message, description) AS erreur_message,
      noms,
      prenoms,
      date_de_naissance,
      num_secu,
      lieu_de_naissance,
      rangement,
      contact,
      site_id,
      created_at
    FROM t_import_anomalies
    ${where}
    ORDER BY id DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  return { rows, total };
}

export function clearImportAnomalies(siteId: number) {
  const db = getDatabase()!;
  return db.prepare('DELETE FROM t_import_anomalies WHERE site_id = ?').run(siteId);
}

export function deleteImportAnomaly(id: number) {
  const db = getDatabase()!;
  return db.prepare('DELETE FROM t_import_anomalies WHERE id = ?').run(id);
}

export function countEmptyAnomalies(siteId: number) {
  const db = getDatabase()!;
  const row = db.prepare(`
    SELECT COUNT(*) as count FROM t_import_anomalies
    WHERE (site_id IS NULL OR site_id = ?)
      AND (noms IS NULL OR trim(noms) = '')
      AND (prenoms IS NULL OR trim(prenoms) = '')
      AND (date_de_naissance IS NULL OR trim(date_de_naissance) = '')
  `).get(siteId) as { count: number };
  
  return row?.count || 0;
}

export function deleteEmptyAnomalies(siteId: number) {
  const db = getDatabase()!;
  return db.prepare(`
    DELETE FROM t_import_anomalies
    WHERE (site_id IS NULL OR site_id = ?)
      AND (noms IS NULL OR trim(noms) = '')
      AND (prenoms IS NULL OR trim(prenoms) = '')
      AND (date_de_naissance IS NULL OR trim(date_de_naissance) = '')
  `).run(siteId);
}
