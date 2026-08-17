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

  // Borne de fin (exclusive) pour la journée "aujourd'hui" : le lendemain à 00:00,
  // nécessaire car date_delivrance est stockée en ISO complet avec heure (ex.
  // "2026-07-31T19:16:36.645Z") — une égalité stricte avec todayStr ne matche jamais.
  const dTomorrow = new Date();
  dTomorrow.setDate(dTomorrow.getDate() + 1);
  const tomorrowStr = dTomorrow.toISOString().split('T')[0];

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
      SUM(CASE WHEN date_delivrance >= ? AND date_delivrance < ? THEN 1 ELSE 0 END) as today,
      SUM(CASE WHEN date_delivrance >= ? AND date_delivrance < ? THEN 1 ELSE 0 END) as yesterday,
      SUM(CASE WHEN date_delivrance >= ? THEN 1 ELSE 0 END) as week,
      SUM(CASE WHEN date_delivrance >= ? THEN 1 ELSE 0 END) as month,
      SUM(CASE WHEN date_delivrance >= ? THEN 1 ELSE 0 END) as year
    FROM t_cartes
    WHERE statut = 'DELIVRE' AND UPPER(agent_distributeur) = UPPER(?) AND site_id = ?
  `).get(todayStr, tomorrowStr, yesterdayStr, todayStr, weekStr, monthStr, yearStartStr, agentUsername, siteId) as { today: number; yesterday: number; week: number; month: number; year: number } | undefined;

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

/**
 * Liste paginée des fiches DÉLIVRÉES aujourd'hui par un agent OPERATEUR_VERIFICATION donné
 * (Portail Vérification, onglet "Vue d'ensemble" > "Travail du jour"). Même structure que
 * getApurementCardsTodayPaginated (pagination LIMIT/OFFSET plafonnée, politique Low-Memory RAM
 * 8 Go), mais filtrée sur `date_delivrance` (et non `updated_at`) : contrairement au flux
 * d'Apurement, `date_delivrance` est ici auto-timestampée à `now` au moment de la délivrance
 * réelle (cartes.queries.ts, mise à jour du statut DELIVRE), donc fiable pour une borne
 * "aujourd'hui" — c'est déjà ce qu'utilise getVerificationStats ci-dessus pour son bucket
 * "today", on reste cohérent avec l'existant. `date_delivrance` est un ISO complet avec heure,
 * donc la même borne exclusive "lendemain à 00:00" que pour l'Apurement fonctionne telle quelle.
 * Politique Low-Memory (RAM 8 Go) : pageSize est toujours borné (LIMIT/OFFSET, plafond 100),
 * jamais de chargement de l'historique complet en mémoire.
 */
export function getVerificationCardsTodayPaginated(
  agentUsername: string,
  siteId: number,
  page: number = 0,
  pageSize: number = 20
): {
  rows: any[];
  total: number;
  syncSummary: { synced: number; pending: number; error: number };
} {
  const db = getDatabase()!;

  const todayStr = new Date().toISOString().split('T')[0];
  const dTomorrow = new Date();
  dTomorrow.setDate(dTomorrow.getDate() + 1);
  const tomorrowStr = dTomorrow.toISOString().split('T')[0];

  const safePageSize = Math.min(Math.max(1, Math.floor(pageSize) || 20), 100);
  const safePage = Math.max(0, Math.floor(page) || 0);
  const offset = safePage * safePageSize;

  const conditionClause = `
    WHERE statut = 'DELIVRE'
      AND UPPER(agent_distributeur) = UPPER(?)
      AND site_id = ?
      AND date_delivrance >= ?
      AND date_delivrance < ?
  `;
  const params: (string | number)[] = [agentUsername, siteId, todayStr, tomorrowStr];

  const totalRow = db.prepare(`SELECT COUNT(*) as total FROM t_cartes ${conditionClause}`).get(...params) as { total: number } | undefined;
  const total = totalRow?.total || 0;

  // Enrichissement statut de synchro (badge "Travail du jour", Portail Vérification) : jointure
  // sur clés indexées (t_outbox.id = PK, t_cartes.sync_id = UNIQUE), relation 0..1, aucune ligne
  // dupliquée. Priorité is_dirty/synced_at, t_outbox.status en simple enrichissement — jamais
  // utilisé seul comme source de vérité (une carte peut être synchronisée sans avoir jamais eu
  // de ligne outbox, cas legacy antérieur à l'introduction du circuit t_outbox pour t_cartes) :
  //   - is_dirty = 0 ET (pas de ligne outbox OU statut SYNCED)      → synchronisé
  //   - is_dirty = 1 ET t_outbox.status = 'ERROR'                   → échec (uniquement ce cas)
  //   - sinon (is_dirty = 1, pas encore SYNCED, ou PENDING)         → en attente
  const fromWithJoin = `
    FROM t_cartes
    LEFT JOIN t_outbox ON t_outbox.id = t_cartes.sync_id AND t_outbox.table_name = 't_cartes'
  `;
  const syncStatusCase = `
    CASE
      WHEN t_cartes.is_dirty = 0 THEN 'SYNCED'
      WHEN t_cartes.is_dirty = 1 AND t_outbox.status = 'ERROR' THEN 'ERROR'
      ELSE 'PENDING'
    END
  `;

  const rows = db.prepare(`
    SELECT t_cartes.id_carte, t_cartes.noms, t_cartes.prenoms, t_cartes.date_de_naissance,
           t_cartes.lieu_de_naissance, t_cartes.num_secu, t_cartes.date_delivrance,
           t_cartes.nom_retirant, t_cartes.num_retirant, t_cartes.relation_retirant, t_cartes.rangement,
           ${syncStatusCase} AS sync_status
    ${fromWithJoin}
    ${conditionClause}
    ORDER BY t_cartes.date_delivrance DESC
    LIMIT ? OFFSET ?
  `).all(...params, safePageSize, offset);

  const summaryRow = db.prepare(`
    SELECT
      SUM(CASE WHEN ${syncStatusCase} = 'SYNCED' THEN 1 ELSE 0 END) as synced,
      SUM(CASE WHEN ${syncStatusCase} = 'ERROR' THEN 1 ELSE 0 END) as error
    ${fromWithJoin}
    ${conditionClause}
  `).get(...params) as { synced: number | null; error: number | null } | undefined;

  const synced = summaryRow?.synced || 0;
  const error = summaryRow?.error || 0;
  const pending = Math.max(0, total - synced - error);

  return { rows, total, syncSummary: { synced, pending, error } };
}

/**
 * Équivalent de getVerificationStats ci-dessus, mais dédié au Portail d'Apurement
 * (OPERATEUR_APUREMENT — Vue d'ensemble, 4 KPI Aujourd'hui/Semaine/Mois/Année).
 *
 * Différence volontaire avec getVerificationStats : ici on indexe/filtre sur `updated_at`
 * (horodatage réel de l'action serveur, écrit par updateApurementHistorique à chaque
 * validation — cartes.queries.ts:1364) et NON sur `date_delivrance`. Pour ce flux précis,
 * `date_delivrance` est saisie librement par l'agent (InventaireApurement.tsx, champ "DATE DU
 * RETRAIT (Cahier)") et correspond à une date passée du cahier d'émargement historique
 * dépouillé — elle ne reflète PAS le moment où l'agent a réellement traité la fiche
 * aujourd'hui. `updated_at` est un ISO complet avec heure, toujours écrit par le serveur à
 * `now`, donc fiable pour des bornes "Aujourd'hui/Semaine/Mois/Année".
 * Ne pas fusionner avec getVerificationStats : le portail Vérification (délivrance normale)
 * utilise correctement date_delivrance (auto-timestampée à `now` dans ce flux-là).
 */
export function getApurementStats(agentUsername: string, siteId: number) {
  const db = getDatabase()!;

  const todayStr = new Date().toISOString().split('T')[0];
  const dTomorrow = new Date();
  dTomorrow.setDate(dTomorrow.getDate() + 1);
  const tomorrowStr = dTomorrow.toISOString().split('T')[0];

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
      SUM(CASE WHEN updated_at >= ? AND updated_at < ? THEN 1 ELSE 0 END) as today,
      SUM(CASE WHEN updated_at >= ? AND updated_at < ? THEN 1 ELSE 0 END) as yesterday,
      SUM(CASE WHEN updated_at >= ? THEN 1 ELSE 0 END) as week,
      SUM(CASE WHEN updated_at >= ? THEN 1 ELSE 0 END) as month,
      SUM(CASE WHEN updated_at >= ? THEN 1 ELSE 0 END) as year
    FROM t_cartes
    WHERE statut = 'DELIVRE' AND UPPER(agent_distributeur) = UPPER(?) AND site_id = ?
  `).get(todayStr, tomorrowStr, yesterdayStr, todayStr, weekStr, monthStr, yearStartStr, agentUsername, siteId) as { today: number; yesterday: number; week: number; month: number; year: number } | undefined;

  const weekdays = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];
  const last7Days: { dayName: string; count: number }[] = [];

  const dStartWeek = new Date();
  dStartWeek.setDate(dStartWeek.getDate() - 6);
  const startWeekStr = dStartWeek.toISOString().split('T')[0];

  const daysStats = db.prepare(`
    SELECT
      substr(updated_at, 1, 10) as jour,
      COUNT(*) as count
    FROM t_cartes
    WHERE statut = 'DELIVRE' AND UPPER(agent_distributeur) = UPPER(?) AND site_id = ?
      AND updated_at >= ?
    GROUP BY jour
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

/**
 * Liste paginée des fiches d'émargement historique traitées AUJOURD'HUI par un agent
 * OPERATEUR_APUREMENT donné (Portail d'Apurement, onglet "Vue d'ensemble" > "Travail du jour").
 * Reprend exactement le même schéma d'écriture que updateApurementHistorique
 * (cartes.queries.ts:1364 — statut='DELIVRE', agent_distributeur, updated_at) et le même
 * calcul de bornes de date que getApurementStats ci-dessus : filtrage sur `updated_at`
 * (horodatage réel de l'action serveur) et non `date_delivrance` (saisie libre, date passée du
 * cahier — voir commentaire de getApurementStats). `updated_at` est déjà un ISO complet avec
 * heure, donc le même style de borne exclusive "lendemain à 00:00" fonctionne tel quel.
 * Politique Low-Memory (RAM 8 Go) : pageSize est toujours borné (LIMIT/OFFSET, plafond 100),
 * jamais de chargement de l'historique complet en mémoire.
 */
export function getApurementCardsTodayPaginated(
  agentUsername: string,
  siteId: number,
  page: number = 0,
  pageSize: number = 20
): { rows: any[]; total: number } {
  const db = getDatabase()!;

  const todayStr = new Date().toISOString().split('T')[0];
  const dTomorrow = new Date();
  dTomorrow.setDate(dTomorrow.getDate() + 1);
  const tomorrowStr = dTomorrow.toISOString().split('T')[0];

  const safePageSize = Math.min(Math.max(1, Math.floor(pageSize) || 20), 100);
  const safePage = Math.max(0, Math.floor(page) || 0);
  const offset = safePage * safePageSize;

  const whereClause = `
    FROM t_cartes
    WHERE statut = 'DELIVRE'
      AND UPPER(agent_distributeur) = UPPER(?)
      AND site_id = ?
      AND updated_at >= ?
      AND updated_at < ?
  `;
  const params: (string | number)[] = [agentUsername, siteId, todayStr, tomorrowStr];

  const totalRow = db.prepare(`SELECT COUNT(*) as total ${whereClause}`).get(...params) as { total: number } | undefined;
  const total = totalRow?.total || 0;

  // updated_at (et non date_delivrance) pilote aussi le tri et l'affichage "Heure d'apurement"
  // du renderer (ApurementOverview.tsx) : cohérent avec le filtre ci-dessus, puisque
  // date_delivrance reste une date passée saisie librement (cahier), sans valeur d'heure fiable.
  const rows = db.prepare(`
    SELECT id_carte, noms, prenoms, date_de_naissance, lieu_de_naissance, num_secu,
           date_delivrance, nom_retirant, num_retirant, relation_retirant, rangement, updated_at
    ${whereClause}
    ORDER BY updated_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, safePageSize, offset);

  return { rows, total };
}

export function getUnsyncedCardsCount(siteId: number): number {
  const db = getDatabase()!;
  const row = db.prepare('SELECT COUNT(*) as count FROM t_cartes WHERE site_id = ? AND is_dirty = 1').get(siteId) as { count: number };
  return row?.count || 0;
}

// Miroir exact des critères de conformité appliqués par défaut par le bouton "Envoyer les
// corrections" du Portail Qualité (allowProbable=false, allowInvalid=false,
// allowMissing=true dans upload-worker.js) : une donnée manquante (rangement, nom,
// prénom, contact...) ne bloque plus l'envoi — seuls une date invalide ou un doublon
// restent des blocages durs. Sert uniquement à afficher le nombre réel de cartes
// envoyables, pour éviter l'incohérence avec le compteur brut getUnsyncedCardsCount
// (utilisé ailleurs dans l'app, volontairement laissé inchangé).
export function getUnsyncedConformeCardsCount(siteId: number): number {
  const db = getDatabase()!;
  const row = db.prepare(`
    SELECT COUNT(*) as count FROM t_cartes
    WHERE site_id = ?
      AND is_dirty = 1
      AND statut != 'BROUILLON'
      AND NOT (
        (noms IS NULL OR noms = '') AND
        (prenoms IS NULL OR prenoms = '') AND
        (num_secu IS NULL OR num_secu = '') AND
        (rangement IS NULL OR rangement = '' OR rangement = 'NON CLASSE')
      )
      AND (date_de_naissance IS NULL OR date_de_naissance = '' OR date_de_naissance REGEXP '^\\d{4}-\\d{2}-\\d{2}$')
      AND (cle_doublon IS NULL OR cle_doublon = '' OR cle_doublon = '||||' OR cle_doublon NOT IN (
        SELECT cle_doublon FROM t_cartes
        WHERE site_id = ? AND cle_doublon IS NOT NULL AND cle_doublon != '' AND cle_doublon != '||||'
        GROUP BY cle_doublon HAVING COUNT(*) > 1
      ))
      AND (noms || '||' || prenoms || '||' || date_de_naissance) NOT IN (
        SELECT noms || '||' || prenoms || '||' || date_de_naissance FROM t_cartes
        WHERE site_id = ?
        GROUP BY noms, prenoms, date_de_naissance HAVING COUNT(DISTINCT cle_doublon) > 1
      )
  `).get(siteId, siteId, siteId) as { count: number };
  return row?.count || 0;
}

export function getUnsyncedUsersCount(siteId: number): number {
  const db = getDatabase()!;
  const row = db.prepare('SELECT COUNT(*) as count FROM t_users WHERE site_id = ? AND is_dirty = 1').get(siteId) as { count: number };
  return row?.count || 0;
}

export function getUnsyncedCentresCount(siteId: number): number {
  const db = getDatabase()!;
  const row = db.prepare('SELECT COUNT(*) as count FROM t_centres WHERE site_id = ? AND is_dirty = 1').get(siteId) as { count: number };
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

export function getAgentRecentSaisies(userId: number, limit: number = 25, offset: number = 0) {
  const db = getDatabase()!;

  const countRow = db.prepare(`
    SELECT COUNT(*) as total
    FROM t_cartes
    WHERE created_by = ?
  `).get(userId) as { total: number };

  const rows = db.prepare(`
    SELECT id_carte, noms, prenoms, num_secu, date_de_naissance, lieu_de_naissance, rangement, contact, created_at, statut, is_dirty
    FROM t_cartes
    WHERE created_by = ?
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).all(userId, limit, offset);

  return {
    total: countRow ? countRow.total : 0,
    rows
  };
}

/**
 * Vue d'ensemble du Portail de Saisie (OPERATEUR_SAISIE) — 4 KPI (Aujourd'hui/Semaine/Mois/
 * Année), miroir structurel de getVerificationStats/getApurementStats ci-dessus. Reprend
 * EXACTEMENT le même filtre que getAgentStatsToday ci-dessus (`created_by = userId AND
 * created_at >= <borne>`, aucun filtre sur `statut` ni `site_id`) : une saisie compte dès sa
 * création, brouillon ou non, quel que soit son état de synchronisation — comportement
 * volontairement inchangé par rapport à getAgentStatsToday, seulement étendu aux 4 périodes.
 * Ne pas fusionner avec getVerificationStats/getApurementStats : ces deux-là filtrent sur
 * statut='DELIVRE' + agent_distributeur (flux de délivrance), alors qu'ici on compte les
 * cartes SAISIES par l'agent (created_by), flux distinct.
 */
export function getAgentStats(userId: number) {
  const db = getDatabase()!;

  const todayStartStr = new Date().toISOString().split('T')[0] + 'T00:00:00.000Z';

  const dYesterday = new Date();
  dYesterday.setDate(dYesterday.getDate() - 1);
  const yesterdayStartStr = dYesterday.toISOString().split('T')[0] + 'T00:00:00.000Z';

  const dWeek = new Date();
  dWeek.setDate(dWeek.getDate() - 7);
  const weekStartStr = dWeek.toISOString().split('T')[0] + 'T00:00:00.000Z';

  const dMonth = new Date();
  dMonth.setDate(dMonth.getDate() - 30);
  const monthStartStr = dMonth.toISOString().split('T')[0] + 'T00:00:00.000Z';

  const yearStartStr = `${new Date().getFullYear()}-01-01T00:00:00.000Z`;

  const stats = db.prepare(`
    SELECT
      SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) as today,
      SUM(CASE WHEN created_at >= ? AND created_at < ? THEN 1 ELSE 0 END) as yesterday,
      SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) as week,
      SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) as month,
      SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) as year
    FROM t_cartes
    WHERE created_by = ?
  `).get(todayStartStr, yesterdayStartStr, todayStartStr, weekStartStr, monthStartStr, yearStartStr, userId) as
    { today: number; yesterday: number; week: number; month: number; year: number } | undefined;

  return {
    today: stats?.today || 0,
    yesterday: stats?.yesterday || 0,
    week: stats?.week || 0,
    month: stats?.month || 0,
    year: stats?.year || 0
  };
}

/**
 * Liste paginée des fiches SAISIES aujourd'hui par un agent OPERATEUR_SAISIE donné (Portail de
 * Saisie, onglet "Vue d'ensemble" > "Travail du jour"). Même filtre que getAgentStats/
 * getAgentStatsToday (`created_by`, aucun filtre `statut`), borné à la journée en cours avec la
 * même borne exclusive "lendemain à 00:00" que getApurementCardsTodayPaginated/
 * getVerificationCardsTodayPaginated. Colonnes identiques à getAgentRecentSaisies ci-dessus
 * (aussi consommées par HistoriqueView.tsx) pour rester cohérent avec l'existant — mais cette
 * fonction est un NOUVEAU point d'entrée dédié à "aujourd'hui uniquement, paginé" : elle ne
 * remplace ni ne modifie getAgentRecentSaisies (toutes dates, utilisée par l'historique complet).
 * Politique Low-Memory (RAM 8 Go) : pageSize est toujours borné (LIMIT/OFFSET, plafond 100),
 * jamais de chargement de l'historique complet en mémoire.
 */
export function getAgentCardsTodayPaginated(
  userId: number,
  page: number = 0,
  pageSize: number = 20
): {
  rows: any[];
  total: number;
  syncSummary: { synced: number; pending: number; error: number };
} {
  const db = getDatabase()!;

  const todayStr = new Date().toISOString().split('T')[0];
  const dTomorrow = new Date();
  dTomorrow.setDate(dTomorrow.getDate() + 1);
  const tomorrowStr = dTomorrow.toISOString().split('T')[0];

  const safePageSize = Math.min(Math.max(1, Math.floor(pageSize) || 20), 100);
  const safePage = Math.max(0, Math.floor(page) || 0);
  const offset = safePage * safePageSize;

  // Colonnes qualifiées par t_cartes. : t_outbox possède aussi une colonne created_at
  // (schema.ts ~ligne 919), et cette clause est réutilisée dans des requêtes qui font
  // LEFT JOIN t_outbox (rows/summaryRow ci-dessous) — sans préfixe, SQLite rejette la
  // requête à la préparation avec "ambiguous column name: created_at" (bug P0 corrigé).
  const conditionClause = `
    WHERE t_cartes.created_by = ?
      AND t_cartes.created_at >= ?
      AND t_cartes.created_at < ?
  `;
  const params: (string | number)[] = [userId, todayStr, tomorrowStr];

  const totalRow = db.prepare(`SELECT COUNT(*) as total FROM t_cartes ${conditionClause}`).get(...params) as { total: number } | undefined;
  const total = totalRow?.total || 0;

  // Enrichissement statut de synchro (badge "Travail du jour", Portail Saisie) : même jointure et
  // même priorité que getVerificationCardsTodayPaginated ci-dessus (jointure sur clés indexées,
  // t_outbox.id = PK, t_cartes.sync_id = UNIQUE, relation 0..1, aucune ligne dupliquée) :
  //   - is_dirty = 0 ET (pas de ligne outbox OU statut SYNCED)      → synchronisé
  //   - is_dirty = 1 ET t_outbox.status = 'ERROR'                   → échec (uniquement ce cas)
  //   - sinon (is_dirty = 1, pas encore SYNCED, ou PENDING)         → en attente
  const fromWithJoin = `
    FROM t_cartes
    LEFT JOIN t_outbox ON t_outbox.id = t_cartes.sync_id AND t_outbox.table_name = 't_cartes'
  `;
  const syncStatusCase = `
    CASE
      WHEN t_cartes.is_dirty = 0 THEN 'SYNCED'
      WHEN t_cartes.is_dirty = 1 AND t_outbox.status = 'ERROR' THEN 'ERROR'
      ELSE 'PENDING'
    END
  `;

  const rows = db.prepare(`
    SELECT t_cartes.id_carte, t_cartes.noms, t_cartes.prenoms, t_cartes.num_secu, t_cartes.date_de_naissance,
           t_cartes.lieu_de_naissance, t_cartes.rangement, t_cartes.contact, t_cartes.created_at, t_cartes.statut, t_cartes.is_dirty,
           ${syncStatusCase} AS sync_status
    ${fromWithJoin}
    ${conditionClause}
    ORDER BY t_cartes.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, safePageSize, offset);

  const summaryRow = db.prepare(`
    SELECT
      SUM(CASE WHEN ${syncStatusCase} = 'SYNCED' THEN 1 ELSE 0 END) as synced,
      SUM(CASE WHEN ${syncStatusCase} = 'ERROR' THEN 1 ELSE 0 END) as error
    ${fromWithJoin}
    ${conditionClause}
  `).get(...params) as { synced: number | null; error: number | null } | undefined;

  const synced = summaryRow?.synced || 0;
  const error = summaryRow?.error || 0;
  const pending = Math.max(0, total - synced - error);

  return { rows, total, syncSummary: { synced, pending, error } };
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
  
  let whereClause = `WHERE u.site_id = ? AND (u.role IN ('OPERATEUR_QUALITE', 'OPERATEUR_VERIFICATION') OR EXISTS (SELECT 1 FROM t_user_roles ur WHERE ur.id_user = u.id_user AND ur.role IN ('OPERATEUR_QUALITE', 'OPERATEUR_VERIFICATION')))`;
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

  // Filtre sur la nature de l'action (P2 QA terrain, agent-13, suite au commit 07d476a) : sans
  // ce filtre, le LEFT JOIN t_logs comptait TOUTE action journalière de l'utilisateur (LOGIN
  // inclus), pas seulement les actions de contrôle qualité/délivrance attendues par ce
  // compteur "ACTIONS DU JOUR". Actions retenues (vérifiées dans le code réel, cf. rapport) :
  // - CARTE_DELIVREE : délivrance de carte (cartes:delivrer), chemin réel d'OPERATEUR_VERIFICATION.
  // - CMU_MODIFICATION : correction qualité (cmu:updateCarte), chemin réel emprunté par
  //   CorrectionSidePanel.onSave dans le portail Qualité (DoublonsView, InvalidFormatView,
  //   MissingDataView) pour OPERATEUR_QUALITE. Les actions QUALITE_FUSION/QUALITE_CORRECTION/
  //   QUALITE_NETTOYAGE/QUALITE_MASSE (handlers qualite:*) ne sont volontairement PAS incluses
  //   ici : elles ne figurent pas dans CRUD_SYNC_WHITELIST (audit.ts) et ne transitent donc
  //   jamais par t_logs (uniquement t_audit_log, local, non synchronisé cross-poste).
  const relevantActions = ['CARTE_DELIVREE', 'CMU_MODIFICATION'];
  const actionPlaceholders = relevantActions.map(() => '?').join(', ');

  return db.prepare(`
    SELECT u.id_user, u.login, u.nom_user, u.prenom_user, u.centre_id, COUNT(l.id_log) as total_actions
    FROM t_users u
    LEFT JOIN t_logs l ON u.id_user = l.id_user AND l.date_heure >= ? AND l.date_heure <= ? AND l.action IN (${actionPlaceholders})
    ${whereClause}
    GROUP BY u.id_user
    ORDER BY total_actions DESC
  `).all(...params.slice(0, 2), ...relevantActions, ...params.slice(2));
}

export function getSiteLogistiqueStatsToday(siteId: number, centreId?: number, agentId?: number, dateStr?: string) {
  const db = getDatabase()!;
  
  const targetDate = dateStr || new Date().toISOString().split('T')[0];
  
  let whereClause = `WHERE u.site_id = ? AND (u.role IN ('OPERATEUR_LOGISTIQUE', 'OPERATEUR_INVENTAIRE', 'OPERATEUR_APUREMENT') OR EXISTS (SELECT 1 FROM t_user_roles ur WHERE ur.id_user = u.id_user AND ur.role IN ('OPERATEUR_LOGISTIQUE', 'OPERATEUR_INVENTAIRE', 'OPERATEUR_APUREMENT')))`;
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
