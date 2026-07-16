import { getDatabase } from '../connection';
import log from 'electron-log';
import { Worker } from 'worker_threads';
import { join } from 'path';
import { app } from 'electron';
import { getDbPath } from '../connection';

let _statsWorker: Worker | null = null;
let _messageIdCounter = 0;
const _pendingRequests = new Map<number, { resolve: Function, reject: Function }>();

function getOrCreateStatsWorker(): Worker {
  if (!_statsWorker) {
    let sqlitePath: string;
    try {
      sqlitePath = require.resolve('better-sqlite3');
    } catch {
      sqlitePath = 'better-sqlite3';
    }

    const workerPath = join(__dirname, 'workers', 'stats-worker.js');
      
    _statsWorker = new Worker(workerPath, {
      workerData: { dbPath: getDbPath(), sqlitePath }
    });

    _statsWorker.on('message', (msg) => {
      if (msg.type === 'log') {
        log.info(msg.message);
        return;
      }
      const req = _pendingRequests.get(msg.messageId);
      if (req) {
        _pendingRequests.delete(msg.messageId);
        if (msg.success) req.resolve(msg.data);
        else req.reject(new Error(msg.error));
      }
    });

    _statsWorker.on('error', (err) => {
      log.error('[STATS WORKER FATAL ERROR]', err);
      _pendingRequests.forEach(req => req.reject(err));
      _pendingRequests.clear();
      _statsWorker = null;
    });

    _statsWorker.on('exit', (code) => {
      if (code !== 0) log.error(`[STATS WORKER EXIT] code ${code}`);
      _pendingRequests.forEach(req => req.reject(new Error(`Worker stopped with exit code ${code}`)));
      _pendingRequests.clear();
      _statsWorker = null;
    });
  }
  return _statsWorker;
}

export function runStatsWorker(type: string, payload: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const worker = getOrCreateStatsWorker();
    const messageId = ++_messageIdCounter;
    _pendingRequests.set(messageId, { resolve, reject });
    worker.postMessage({ type, messageId, ...payload });
  });
}

export async function getStats(siteId?: number, centreId?: number) {
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

  try {
    log.info(`[STATS WORKER] Offloading getStats to background thread for siteId: ${siteId}`);
    return await runStatsWorker('getStats', { siteId, centreId, where, params });
  } catch (err: any) {
    log.error('[STATS WORKER ERROR] Echec du worker, verifiez stats-worker.js :', err.message);
    throw err;
  }
}

export async function getDetailedSyncStats(siteId: number) {
  try {
    log.info(`[STATS WORKER] Offloading getDetailedSyncStats to background thread for siteId: ${siteId}`);
    return await runStatsWorker('getDetailedSyncStats', { siteId });
  } catch (err: any) {
    log.error('[STATS WORKER ERROR] Echec de getDetailedSyncStats :', err.message);
    throw err;
  }
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

export function getSiteSaisieStatsToday(siteId: number, centreId?: number, agentId?: number, dateStr?: string) {
  const db = getDatabase()!;
  
  // Utilise la date fournie ou la date du jour au format YYYY-MM-DD
  const targetDate = dateStr || new Date().toISOString().split('T')[0];
  const startOfDay = targetDate + 'T00:00:00.000Z';
  const endOfDay = targetDate + 'T23:59:59.999Z';
  
  let whereClause = `WHERE u.site_id = ? AND (u.role = 'OPERATEUR_SAISIE' OR EXISTS (SELECT 1 FROM t_user_roles ur WHERE ur.id_user = u.id_user AND ur.role = 'OPERATEUR_SAISIE'))`;
  const params: unknown[] = [siteId];

  if (centreId) {
    whereClause += ' AND u.centre_id = ?';
    params.push(centreId);
  }
  if (agentId) {
    whereClause += ' AND u.id_user = ?';
    params.push(agentId);
  }

  // Injecter la date de début et de fin pour le filtrage
  params.unshift(startOfDay, endOfDay);

  return db.prepare(`
    SELECT u.id_user, u.login, u.nom_user, u.prenom_user, u.centre_id, COUNT(c.id_carte) as total_saisies
    FROM t_users u
    LEFT JOIN t_cartes c ON u.id_user = c.created_by AND c.created_at >= ? AND c.created_at <= ?
    ${whereClause}
    GROUP BY u.id_user
    ORDER BY total_saisies DESC
  `).all(...params);
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

export function getSiteQualiteStatsToday(siteId: number, centreId?: number, agentId?: number, dateStr?: string) {
  const db = getDatabase()!;
  
  const targetDate = dateStr || new Date().toISOString().split('T')[0];
  const startOfDay = targetDate + ' 00:00:00';
  const endOfDay = targetDate + ' 23:59:59';
  
  let whereClause = `WHERE u.site_id = ? AND (u.role = 'OPERATEUR_QUALITE' OR EXISTS (SELECT 1 FROM t_user_roles ur WHERE ur.id_user = u.id_user AND ur.role = 'OPERATEUR_QUALITE'))`;
  const params: unknown[] = [siteId];

  if (centreId) {
    whereClause += ' AND u.centre_id = ?';
    params.push(centreId);
  }
  if (agentId) {
    whereClause += ' AND u.id_user = ?';
    params.push(agentId);
  }

  params.unshift(startOfDay, endOfDay);

  return db.prepare(`
    SELECT u.id_user, u.login, u.nom_user, u.prenom_user, u.centre_id, COUNT(l.id_log) as total_actions
    FROM t_users u
    LEFT JOIN t_logs l ON u.id_user = l.id_user AND l.date_heure >= ? AND l.date_heure <= ?
    ${whereClause}
    GROUP BY u.id_user
    ORDER BY total_actions DESC
  `).all(...params);
}

export function getSiteLogistiqueStatsToday(siteId: number, centreId?: number, agentId?: number, dateStr?: string) {
  const db = getDatabase()!;
  
  const targetDate = dateStr || new Date().toISOString().split('T')[0];
  
  let whereClause = `WHERE u.site_id = ? AND (u.role IN ('OPERATEUR_LOGISTIQUE', 'OPERATEUR_INVENTAIRE') OR EXISTS (SELECT 1 FROM t_user_roles ur WHERE ur.id_user = u.id_user AND ur.role IN ('OPERATEUR_LOGISTIQUE', 'OPERATEUR_INVENTAIRE')))`;
  const params: unknown[] = [siteId];

  if (centreId) {
    whereClause += ' AND u.centre_id = ?';
    params.push(centreId);
  }
  if (agentId) {
    whereClause += ' AND u.id_user = ?';
    params.push(agentId);
  }

  params.unshift(targetDate);

  return db.prepare(`
    SELECT u.id_user, u.login, u.nom_user, u.prenom_user, u.centre_id, COUNT(c.id_carte) as total_distributions
    FROM t_users u
    LEFT JOIN t_cartes c ON u.login = c.agent_distributeur AND c.date_delivrance = ?
    ${whereClause}
    GROUP BY u.id_user
    ORDER BY total_distributions DESC
  `).all(...params);
}

/**
 * Fonction unifiée pour récupérer toutes les activités par agent et par date (Pilotage de Terrain).
 */
export function getActivitiesByAgentAndDate(siteId: number, centreId?: number | null, agentId?: number | null, dateStr?: string | null) {
  const resolvedCentreId = centreId || undefined;
  const resolvedAgentId = agentId || undefined;
  const resolvedDateStr = dateStr || undefined;

  const saisies = getSiteSaisieStatsToday(siteId, resolvedCentreId, resolvedAgentId, resolvedDateStr);
  const qualite = getSiteQualiteStatsToday(siteId, resolvedCentreId, resolvedAgentId, resolvedDateStr);
  const logistique = getSiteLogistiqueStatsToday(siteId, resolvedCentreId, resolvedAgentId, resolvedDateStr);

  return {
    saisies,
    qualite,
    logistique
  };
}
