import { getDatabase } from '../connection';

export async function getStats(siteId?: number, centreId?: number) {
  const db = getDatabase()!;
  // Construire la clause WHERE en fonction des paramètres disponibles
  let where = '';
  const params: Record<string, any> = {};
  if (siteId && centreId) {
    where = 'WHERE site_id = @siteId AND centre_id = @centreId';
    params.siteId = siteId;
    params.centreId = centreId;
  } else if (siteId) {
    where = 'WHERE site_id = @siteId';
    params.siteId = siteId;
  }

  // Helpers : AND clauses complémentaires pour les requêtes avec WHERE propre
  const andSite = siteId ? `AND site_id = @siteId` : '';
  const andCentre = centreId ? `AND centre_id = @centreId` : '';
  const andSiteT = siteId ? `AND t.site_id = @siteId` : '';
  const andCentreT = centreId ? `AND t.centre_id = @centreId` : '';

  // 1. KPI généraux
  const stats = await new Promise<Record<string, number>>((resolve, reject) => {
    setImmediate(() => {
      try {
        const res = db.prepare(`
          SELECT
            COUNT(*) as total,
            IFNULL(SUM(CASE WHEN statut = 'EN STOCK' OR statut IS NULL OR statut = '' THEN 1 ELSE 0 END), 0) as en_stock,
            IFNULL(SUM(CASE WHEN statut IN ('DELIVRE','DISTRIBUEE','RETIRE') THEN 1 ELSE 0 END), 0) as distribuees,
            IFNULL(SUM(CASE WHEN statut_physique = 'ABSENT' THEN 1 ELSE 0 END), 0) as absentes,
            IFNULL(SUM(CASE WHEN num_secu IS NULL OR num_secu = '' OR num_secu LIKE '-%' THEN 1 ELSE 0 END), 0) as sans_num_secu,
            IFNULL(SUM(CASE WHEN rangement IS NULL OR rangement = '' OR rangement = 'NON CLASSE' THEN 1 ELSE 0 END), 0) as sans_rangement,
            0 as dates_invalides
          FROM t_cartes
          ${where}
        `).get(params) as Record<string, number>;
        resolve(res);
      } catch (err) {
        reject(err);
      }
    });
  });

  // Récupération rapide du nombre d'anomalies de date depuis la DLQ (t_import_anomalies)
  const anomaliesCount = await new Promise<number>((resolve) => {
    setImmediate(() => {
      try {
        const tableCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='t_import_anomalies'").get();
        if (!tableCheck) {
          resolve(0);
          return;
        }
        let countQuery = 'SELECT COUNT(*) as count FROM t_import_anomalies';
        const row = db.prepare(countQuery).get() as { count: number } | undefined;
        const totalAnomalies = row ? row.count : 0;
        console.log(`[DASHBOARD DIAGNOSTIC] 📊 Compteur d'anomalies lu depuis t_import_anomalies. Total : ${totalAnomalies}`);
        resolve(totalAnomalies);
      } catch (err) {
        console.warn("Erreur non critique lors du comptage des anomalies (t_import_anomalies) :", err);
        resolve(0);
      }
    });
  });

  stats.dates_invalides = anomaliesCount;

  // Respiration CPU
  await new Promise<void>((resolve) => setImmediate(resolve));

  // 2. Distribution par jour - OPTIMISÉE (plus de fonction date() sur la colonne)
  const distribParJour = await new Promise<any[]>((resolve, reject) => {
    setImmediate(() => {
      try {
        const res = db.prepare(`
          SELECT date_delivrance as jour, COUNT(*) as count
          FROM t_cartes 
          WHERE date_delivrance IS NOT NULL AND date_delivrance != ''
          ${andSite} ${andCentre}
          GROUP BY date_delivrance ORDER BY jour DESC LIMIT 30
        `).all(params);
        resolve(res);
      } catch (err) {
        reject(err);
      }
    });
  });

  // Respiration CPU
  await new Promise<void>((resolve) => setImmediate(resolve));

  // 3. Distribution par centre
  const distribParCentre = await new Promise<any[]>((resolve, reject) => {
    setImmediate(() => {
      try {
        const res = db.prepare(`
          SELECT c.nom as centre, COUNT(t.id_carte) as count
          FROM t_cartes t LEFT JOIN t_centres c ON t.centre_id = c.id
          WHERE t.statut IN ('DELIVRE','DISTRIBUEE','RETIRE')
          ${andSiteT} ${andCentreT}
          GROUP BY t.centre_id
        `).all(params);
        resolve(res);
      } catch (err) {
        reject(err);
      }
    });
  });

  // Respiration CPU
  await new Promise<void>((resolve) => setImmediate(resolve));

  // 4. Doublons stricts
  const doublons = await new Promise<{ count: number }>((resolve, reject) => {
    setImmediate(() => {
      try {
        const hasWhere = where !== '';
        const res = db.prepare(`
          SELECT COUNT(*) as count FROM (
            SELECT cle_doublon FROM t_cartes
            ${where}
            ${hasWhere ? 'AND' : 'WHERE'} cle_doublon IS NOT NULL AND cle_doublon != '' AND cle_doublon != '||||'
            GROUP BY cle_doublon HAVING COUNT(*) > 1
          )
        `).get(params) as { count: number };
        resolve(res);
      } catch (err) {
        reject(err);
      }
    });
  });

  // Respiration CPU
  await new Promise<void>((resolve) => setImmediate(resolve));

  // 5. Doublons probables
  const doublonsProbables = await new Promise<{ count: number }>((resolve, reject) => {
    setImmediate(() => {
      try {
        const res = db.prepare(`
          SELECT COUNT(*) as count FROM (
            SELECT noms, prenoms, date_de_naissance
            FROM t_cartes
            ${where}
            ${where ? 'AND' : 'WHERE'} noms IS NOT NULL
            GROUP BY noms, prenoms, date_de_naissance
            HAVING COUNT(DISTINCT cle_doublon) > 1
          )
        `).get(params) as { count: number };
        resolve(res);
      } catch (err) {
        reject(err);
      }
    });
  });

  return {
    ...stats,
    doublons_stricts: doublons.count,
    doublons_probables: doublonsProbables.count,
    distribParJour,
    distribParCentre
  };
}

export function getVerificationStats(agentUsername: string, siteId: number) {
  const db = getDatabase()!;
  
  // Précalculer les dates en JavaScript pour des requêtes index-friendly
  const todayStr = new Date().toISOString().split('T')[0];
  
  const dYesterday = new Date();
  dYesterday.setDate(dYesterday.getDate() - 1);
  const yesterdayStr = dYesterday.toISOString().split('T')[0];
  
  const dWeek = new Date();
  dWeek.setDate(dWeek.getDate() - 7);
  const weekStr = dWeek.toISOString().split('T')[0];
  
  const dMonth = new Date();
  dMonth.setDate(dMonth.getDate() - 30);
  const monthStr = dMonth.toISOString().split('T')[0];
  
  const yearStartStr = `${new Date().getFullYear()}-01-01`;

  const stats = db.prepare(`
    SELECT 
      SUM(CASE WHEN date_delivrance = ? THEN 1 ELSE 0 END) as today,
      SUM(CASE WHEN date_delivrance = ? THEN 1 ELSE 0 END) as yesterday,
      SUM(CASE WHEN date_delivrance >= ? THEN 1 ELSE 0 END) as week,
      SUM(CASE WHEN date_delivrance >= ? THEN 1 ELSE 0 END) as month,
      SUM(CASE WHEN date_delivrance >= ? THEN 1 ELSE 0 END) as year
    FROM t_cartes 
    WHERE statut = 'DELIVRE' AND UPPER(agent_distributeur) = UPPER(?) AND site_id = ?
  `).get(todayStr, yesterdayStr, weekStr, monthStr, yearStartStr, agentUsername, siteId) as { today: number; yesterday: number; week: number; month: number; year: number } | undefined;

  const weekdays = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];
  const last7Days: { dayName: string; count: number }[] = [];
  
  const dStartWeek = new Date();
  dStartWeek.setDate(dStartWeek.getDate() - 6);
  const startWeekStr = dStartWeek.toISOString().split('T')[0];

  const daysStats = db.prepare(`
    SELECT 
      date_delivrance as jour,
      COUNT(*) as count
    FROM t_cartes
    WHERE statut = 'DELIVRE' AND UPPER(agent_distributeur) = UPPER(?) AND site_id = ?
      AND date_delivrance >= ?
    GROUP BY date_delivrance
  `).all(agentUsername, siteId, startWeekStr) as { jour: string; count: number }[];

  const statsMap = new Map<string, number>();
  daysStats.forEach(d => {
    statsMap.set(d.jour, d.count);
  });

  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];
    const dayName = weekdays[d.getDay()];
    last7Days.push({
      dayName,
      count: statsMap.get(dateStr) || 0
    });
  }

  return {
    today: stats?.today || 0,
    yesterday: stats?.yesterday || 0,
    week: stats?.week || 0,
    month: stats?.month || 0,
    year: stats?.year || 0,
    last7Days
  };
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

export function getVerificationCardsToday(agentUsername: string, siteId: number): number {
  const db = getDatabase()!;
  const todayStr = new Date().toISOString().split('T')[0];
  const row = db.prepare(`
    SELECT COUNT(*) as count 
    FROM t_cartes 
    WHERE statut = 'DELIVRE' AND UPPER(agent_distributeur) = UPPER(?) AND site_id = ?
      AND date_delivrance = ?
  `).get(agentUsername, siteId, todayStr) as { count: number } | undefined;
  return row?.count || 0;
}

export function getUnsyncedCardsCount(siteId: number): number {
  const db = getDatabase()!;
  const row = db.prepare('SELECT COUNT(*) as count FROM t_cartes WHERE site_id = ? AND is_dirty = 1').get(siteId) as { count: number };
  return row?.count || 0;
}

export function getUnsyncedUsersCount(siteId: number): number {
  const db = getDatabase()!;
  const row = db.prepare('SELECT COUNT(*) as count FROM t_users WHERE site_id = ? AND is_dirty = 1').get(siteId) as { count: number };
  return row?.count || 0;
}

export function getAgentStatsToday(userId: number) {
  const db = getDatabase()!;
  const todayStartStr = new Date().toISOString().split('T')[0] + 'T00:00:00.000Z';
  const row = db.prepare(`
    SELECT COUNT(*) as count 
    FROM t_cartes 
    WHERE created_by = ? AND created_at >= ?
  `).get(userId, todayStartStr) as { count: number };
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

export function getSiteSaisieStatsToday(siteId: number, centreId?: number) {
  const db = getDatabase()!;
  const todayStartStr = new Date().toISOString().split('T')[0] + 'T00:00:00.000Z';
  const whereClause = centreId 
    ? 'WHERE u.site_id = ? AND u.role = \'OPERATEUR_SAISIE\' AND u.centre_id = ?' 
    : 'WHERE u.site_id = ? AND u.role = \'OPERATEUR_SAISIE\'';
  const params = centreId ? [siteId, centreId] : [siteId];

  return db.prepare(`
    SELECT u.id_user, u.login, u.nom_user, u.prenom_user, u.centre_id, COUNT(c.id_carte) as total_saisies
    FROM t_users u
    LEFT JOIN t_cartes c ON u.id_user = c.created_by AND c.created_at >= ?
    ${whereClause}
    GROUP BY u.id_user
    ORDER BY total_saisies DESC
  `).all(...params, todayStartStr);
}

export function getRetraitsByCentre(
  siteId: number,
  centreId: number | null,
  period: 'jour' | 'semaine' | 'mois' | 'annee',
  customDate?: string | null  // YYYY-MM-DD pour 'jour', YYYY-MM pour 'mois', YYYY pour 'annee'
) {
  const db = getDatabase()!;
  
  // 1. Détermination de la clause WHERE pour la période de classement sans fonctions SQLite sur les colonnes
  let periodWhere = "";
  switch (period) {
    case 'jour':
      const targetDay = customDate || new Date().toISOString().split('T')[0];
      periodWhere = `AND t.date_delivrance = '${targetDay}'`;
      break;
    case 'semaine':
      const dWeek = new Date();
      dWeek.setDate(dWeek.getDate() - 6);
      const weekStr = dWeek.toISOString().split('T')[0];
      periodWhere = `AND t.date_delivrance >= '${weekStr}'`;
      break;
    case 'mois':
      const targetMonth = customDate || new Date().toISOString().slice(0, 7); // YYYY-MM
      periodWhere = `AND t.date_delivrance LIKE '${targetMonth}%'`;
      break;
    case 'annee':
      const targetYear = customDate || new Date().getFullYear().toString(); // YYYY
      periodWhere = `AND t.date_delivrance LIKE '${targetYear}%'`;
      break;
  }

  // 2. Requête du classement (rows)
  let rowsQuery = "";
  const rowsParams: any[] = [];

  if (centreId !== null) {
    // ADMIN_CENTRE : un seul centre
    rowsQuery = `
      SELECT 
        c.id as centre_id,
        c.nom as centre_nom,
        COUNT(t.id_carte) as total
      FROM t_centres c
      LEFT JOIN t_cartes t ON t.centre_id = c.id AND t.statut = 'DELIVRE' ${periodWhere}
      WHERE c.id = ?
    `;
    rowsParams.push(centreId);
  } else {
    // SITE ADMIN / SUPER ADMIN : tous les centres du site
    rowsQuery = `
      SELECT 
        c.id as centre_id,
        c.nom as centre_nom,
        COUNT(t.id_carte) as total
      FROM t_centres c
      LEFT JOIN t_cartes t ON t.centre_id = c.id AND t.statut = 'DELIVRE' ${periodWhere}
      WHERE c.site_id = ?
      GROUP BY c.id
      ORDER BY total DESC
    `;
    rowsParams.push(siteId);
  }

  const rows = db.prepare(rowsQuery).all(...rowsParams);

  // 3. Calcul des KPIs globaux (totaux) avec index
  const baseKpiQuery = `
    SELECT COUNT(*) as count 
    FROM t_cartes 
    WHERE statut = 'DELIVRE' AND site_id = ? 
      ${centreId !== null ? 'AND centre_id = ?' : ''}
  `;
  
  const kpiParams = centreId !== null ? [siteId, centreId] : [siteId];

  const getKpi = (timeFilter: string) => {
    const row = db.prepare(`${baseKpiQuery} ${timeFilter}`).get(...kpiParams) as { count: number } | undefined;
    return row?.count || 0;
  };

  const todayStr = new Date().toISOString().split('T')[0];
  const dWeekAgo = new Date();
  dWeekAgo.setDate(dWeekAgo.getDate() - 6);
  const weekAgoStr = dWeekAgo.toISOString().split('T')[0];
  const monthStr = new Date().toISOString().slice(0, 7);
  const yearStr = new Date().getFullYear().toString();

  const totaux = {
    aujourd_hui:   getKpi(`AND date_delivrance = '${todayStr}'`),
    cette_semaine: getKpi(`AND date_delivrance >= '${weekAgoStr}'`),
    ce_mois:       getKpi(`AND date_delivrance LIKE '${monthStr}%'`),
    cette_annee:   getKpi(`AND date_delivrance LIKE '${yearStr}%'`)
  };

  return { rows, totaux };
}

export function getRetraitsByCentrePage(siteId: number | undefined, offset: number, limit: number): { rows: any[], total: number } {
  const db = getDatabase()!;
  let where = "WHERE t.statut = 'DELIVRE'";
  const params: any[] = [];
  if (siteId) {
    where += ' AND t.site_id = ?';
    params.push(siteId);
  }

  const countQuery = `
    SELECT COUNT(DISTINCT t.centre_id) as count 
    FROM t_cartes t 
    ${where}
  `;
  const totalRow = db.prepare(countQuery).get(...params) as { count: number } | undefined;
  const total = totalRow?.count || 0;

  const dataQuery = `
    SELECT 
      c.nom as centre_nom,
      COUNT(t.id_carte) as total_retraits,
      SUM(CASE WHEN t.nom_retirant = (t.noms || ' ' || t.prenoms) THEN 1 ELSE 0 END) as retraits_titulaires,
      SUM(CASE WHEN t.nom_retirant != (t.noms || ' ' || t.prenoms) THEN 1 ELSE 0 END) as retraits_mandataires
    FROM t_cartes t
    JOIN t_centres c ON t.centre_id = c.id
    ${where}
    GROUP BY t.centre_id
    ORDER BY total_retraits DESC
    LIMIT ? OFFSET ?
  `;
  const rows = db.prepare(dataQuery).all(...params, limit, offset);

  return { rows, total };
}

export function getDetailsRetraitsCentre(siteId: number | undefined, centreNom: string, offset: number, limit: number) {
  const db = getDatabase()!;
  let where = "WHERE t.statut = 'DELIVRE' AND UPPER(c.nom) = UPPER(?)";
  const params: any[] = [centreNom];
  
  if (siteId) {
    where += ' AND t.site_id = ?';
    params.push(siteId);
  }

  const countRow = db.prepare(`
    SELECT COUNT(*) as count 
    FROM t_cartes t 
    JOIN t_centres c ON t.centre_id = c.id 
    ${where}
  `).get(...params) as { count: number } | undefined;
  const total = countRow?.count || 0;

  const rows = db.prepare(`
    SELECT t.noms, t.prenoms, t.num_secu, t.rangement, t.nom_retirant, t.num_retirant, t.date_delivrance, t.agent_distributeur
    FROM t_cartes t
    JOIN t_centres c ON t.centre_id = c.id
    ${where}
    ORDER BY t.date_delivrance DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  return { rows, total };
}

export function getSiteQualiteStatsToday(siteId: number, centreId?: number) {
  const db = getDatabase()!;
  const todayStartStr = new Date().toISOString().split('T')[0] + ' 00:00:00';
  const whereClause = centreId 
    ? 'WHERE u.site_id = ? AND u.role = \'OPERATEUR_QUALITE\' AND u.centre_id = ?' 
    : 'WHERE u.site_id = ? AND u.role = \'OPERATEUR_QUALITE\'';
  const params = centreId ? [siteId, centreId] : [siteId];

  return db.prepare(`
    SELECT u.id_user, u.login, u.nom_user, u.prenom_user, u.centre_id, COUNT(l.id_log) as total_actions
    FROM t_users u
    LEFT JOIN t_logs l ON u.id_user = l.id_user AND l.date_heure >= ?
    ${whereClause}
    GROUP BY u.id_user
    ORDER BY total_actions DESC
  `).all(...params, todayStartStr);
}

export function getSiteLogistiqueStatsToday(siteId: number, centreId?: number) {
  const db = getDatabase()!;
  const todayStr = new Date().toISOString().split('T')[0];
  const whereClause = centreId 
    ? 'WHERE u.site_id = ? AND u.role IN (\'OPERATEUR_LOGISTIQUE\', \'OPERATEUR_INVENTAIRE\') AND u.centre_id = ?' 
    : 'WHERE u.site_id = ? AND u.role IN (\'OPERATEUR_LOGISTIQUE\', \'OPERATEUR_INVENTAIRE\')';
  const params = centreId ? [siteId, centreId] : [siteId];

  return db.prepare(`
    SELECT u.id_user, u.login, u.nom_user, u.prenom_user, u.centre_id, COUNT(c.id_carte) as total_distributions
    FROM t_users u
    LEFT JOIN t_cartes c ON u.login = c.agent_distributeur AND c.date_delivrance = ?
    ${whereClause}
    GROUP BY u.id_user
    ORDER BY total_distributions DESC
  `).all(...params, todayStr);
}
