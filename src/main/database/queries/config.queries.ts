import { getDatabase } from '../connection';

export function getConfig(key: string): string | null {
  const db = getDatabase()!;
  const row = db.prepare('SELECT value FROM t_config WHERE key = ?').get(key) as { value: string } | undefined;
  return row ? row.value : null;
}

export function setConfig(key: string, value: string) {
  const db = getDatabase()!;
  return db.prepare("INSERT OR REPLACE INTO t_config (key, value, updated_at) VALUES (?, ?, datetime('now'))").run(key, value);
}

export function getAllConfig() {
  const db = getDatabase()!;
  return db.prepare('SELECT * FROM t_config').all();
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
      u.role as role,
      COUNT(c.id_carte) as verifications_today,
      MAX(c.updated_at) as derniere_activite
    FROM t_users u
    LEFT JOIN t_cartes c ON c.agent_distributeur = u.login AND date(c.date_delivrance) = date('now')
    WHERE u.centre_id = ? AND (u.role LIKE 'OPERATEUR_%' OR u.role = 'ADMIN_CENTRE')
    GROUP BY u.id_user
    ORDER BY verifications_today DESC
  `).all(centreId);
}

type PeriodFilter = 'jour' | 'semaine' | 'mois' | 'annee';

function buildPeriodWhere(period: PeriodFilter): string {
  switch (period) {
    case 'jour':    return "AND date(date_delivrance, 'localtime') = date('now', 'localtime')";
    case 'semaine': return "AND date(date_delivrance, 'localtime') >= date('now', '-6 days', 'localtime')";
    case 'mois':    return "AND strftime('%Y-%m', date_delivrance, 'localtime') = strftime('%Y-%m', 'now', 'localtime')";
    case 'annee':   return "AND strftime('%Y', date_delivrance, 'localtime') = strftime('%Y', 'now', 'localtime')";
  }
}

export function getRetraitsTrend(
  siteId: number,
  centreId: number | null,
  period: PeriodFilter,
  customDate?: string | null  // YYYY-MM-DD pour 'jour', YYYY-MM pour 'mois', YYYY pour 'annee'
) {
  const db = getDatabase()!;
  const centreFilter = centreId !== null ? 'AND centre_id = @centreId' : '';

  let groupBy: string;
  let orderBy: string;
  let periodWhere: string;

  if (period === 'jour') {
    groupBy  = "strftime('%H:00', date_delivrance, 'localtime')";
    orderBy  = 'label ASC';
    periodWhere = customDate
      ? `AND date(date_delivrance, 'localtime') = '${customDate}'`
      : "AND date(date_delivrance, 'localtime') = date('now', 'localtime')";
  } else if (period === 'semaine') {
    groupBy  = "date(date_delivrance, 'localtime')";
    orderBy  = 'label ASC';
    periodWhere = "AND date(date_delivrance, 'localtime') >= date('now', '-6 days', 'localtime')";
  } else if (period === 'mois') {
    groupBy  = "date(date_delivrance, 'localtime')";
    orderBy  = 'label ASC';
    periodWhere = customDate
      ? `AND strftime('%Y-%m', date_delivrance, 'localtime') = '${customDate}'`
      : "AND strftime('%Y-%m', date_delivrance, 'localtime') = strftime('%Y-%m', 'now', 'localtime')";
  } else {
    groupBy  = "strftime('%Y-%m', date_delivrance, 'localtime')";
    orderBy  = 'label ASC';
    periodWhere = customDate
      ? `AND strftime('%Y', date_delivrance, 'localtime') = '${customDate}'`
      : "AND strftime('%Y', date_delivrance, 'localtime') = strftime('%Y', 'now', 'localtime')";
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

export function getCardsCount(): number {
  const db = getDatabase()!;
  const row = db.prepare('SELECT COUNT(*) as count FROM t_cartes').get() as { count: number } | undefined;
  return row?.count || 0;
}
