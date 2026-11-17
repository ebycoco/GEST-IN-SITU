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
  // Correctif (agent-4-db-sync) : alignement sur le même comportement que getStats()/stats-worker.js
  // (case 'getStats', commit c6c9f2c) — cette requête laissait passer dans total/en_stock/distribuees/
  // absentes les cartes soft-supprimées en attente de purge/synchro (is_dirty = -1) et les brouillons
  // de saisie non finalisés (statut = 'BROUILLON'), deux catégories déjà exclues de la liste réelle de
  // cartes par getCartesPage() (cartes.queries.ts, WHERE is_dirty != -1). DOUBLON reste volontairement
  // INCLUS : une carte déclarée doublon est toujours une carte physique réelle, pas un résidu à purger
  // — même raisonnement que le correctif stats-worker.js. Le cloisonnement site_id/centre_id existant
  // (CLAUDE.md §3) reste strictement inchangé.
  return db.prepare(`
    SELECT
      COUNT(*) as total,
      IFNULL(SUM(CASE WHEN statut = 'EN STOCK' OR statut IS NULL OR statut = '' THEN 1 ELSE 0 END), 0) as en_stock,
      IFNULL(SUM(CASE WHEN statut IN ('DELIVRE','DISTRIBUEE','RETIRE') THEN 1 ELSE 0 END), 0) as distribuees,
      IFNULL(SUM(CASE WHEN statut_physique = 'ABSENT' THEN 1 ELSE 0 END), 0) as absentes
    FROM t_cartes
    WHERE site_id = ? AND centre_id = ? AND is_dirty != -1 AND statut != 'BROUILLON'
  `).get(siteId, centreId) as Record<string, number>;
}

/**
 * Portée imposée pour le badge « cartes du centre » (stats:getCentreCardsCount).
 * Fonction pure (testable sans Electron). Cloisonnement §3 : pour tout rôle non-SUPER ADMIN,
 * site ET centre viennent EXCLUSIVEMENT de la session serveur (getSecureCurrentUser()), jamais
 * des paramètres reçus du renderer (falsifiables). SUPER ADMIN garde les paramètres fournis.
 * Retourne null si la session est absente ou le rôle non autorisé pour ce badge.
 */
export function resolveCentreCardsCountScope(
  secureUser: { role?: string; site_id?: number | null; centre_id?: number | null } | null | undefined,
  requestedSiteId?: number | null,
  requestedCentreId?: number | null
): { siteId: number | null; centreId: number | null } | null {
  if (!secureUser || !secureUser.role) return null;
  if (secureUser.role === 'SUPER ADMIN') {
    return { siteId: requestedSiteId ?? null, centreId: requestedCentreId ?? null };
  }
  if (secureUser.role === 'ADMIN_CENTRE' || secureUser.role === 'OPERATEUR_VERIFICATION') {
    return { siteId: secureUser.site_id ?? null, centreId: secureUser.centre_id ?? null };
  }
  return null;
}

/**
 * Nombre de cartes actives d'un centre = EXACTEMENT `total` de getStats(siteId, centreId)
 * (stats-worker.js case 'getStats' : COUNT(*) FROM t_cartes WHERE site_id = @siteId AND
 * centre_id = @centreId AND is_dirty != -1 AND statut != 'BROUILLON'). DOUBLON inclus (idem).
 * Un seul COUNT(*) synchrone sur index (site_id, centre_id, ...) : évite le calcul complet des
 * 8 requêtes du worker de stats (jusqu'à ~7 s) juste pour lire ce chiffre. Site ET centre sont
 * requis (comme getStats : sans siteId le filtre centre est ignoré) ; sinon 0.
 */
export function getCentreCardsCount(siteId: number | null | undefined, centreId: number | null | undefined): number {
  if (!siteId || !centreId) return 0;
  const db = getDatabase()!;
  const row = db.prepare(`
    SELECT COUNT(*) AS total
    FROM t_cartes
    WHERE site_id = ? AND centre_id = ? AND is_dirty != -1 AND statut != 'BROUILLON'
  `).get(siteId, centreId) as { total: number } | undefined;
  return row?.total ?? 0;
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
