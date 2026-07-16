const { parentPort, workerData } = require('worker_threads');
const Database = require(workerData.sqlitePath);

let db = null;

parentPort.on('message', (msg) => {
  try {
    const { type, messageId, siteId, centreId, where: whereClause, params } = msg;

    if (!db) {
      db = new Database(workerData.dbPath, { readonly: true, timeout: 60000 });
      db.pragma('journal_mode = WAL');
      db.pragma('synchronous = NORMAL');
      db.pragma('cache_size = -64000'); // 64MB cache
      db.pragma('temp_store = MEMORY');
      db.pragma('mmap_size = 268435456'); // 256MB mmap
      db.pragma('busy_timeout = 60000');

      db.function('regexp', (pattern, text) => {
        if (text === null) return 0;
        const re = new RegExp(pattern);
        return re.test(text) ? 1 : 0;
      });
    }

    if (type === 'getStats') {
      const t0 = performance.now();
      const stats = db.prepare(`
        SELECT
          COUNT(*) as total,
          IFNULL(SUM(CASE WHEN statut = 'EN STOCK' OR statut IS NULL OR statut = '' THEN 1 ELSE 0 END), 0) as en_stock,
          IFNULL(SUM(CASE WHEN statut IN ('DELIVRE','DISTRIBUEE','RETIRE') THEN 1 ELSE 0 END), 0) as distribuees,
          IFNULL(SUM(CASE WHEN statut_physique = 'ABSENT' THEN 1 ELSE 0 END), 0) as absentes,
          IFNULL(SUM(CASE WHEN num_secu IS NULL OR num_secu = '' OR num_secu LIKE '-%' THEN 1 ELSE 0 END), 0) as sans_num_secu,
          IFNULL(SUM(CASE WHEN rangement IS NULL OR rangement = '' OR rangement = 'NON CLASSE' THEN 1 ELSE 0 END), 0) as sans_rangement,
          IFNULL(SUM(CASE WHEN noms IS NULL OR noms = '' THEN 1 ELSE 0 END), 0) as sans_nom,
          IFNULL(SUM(CASE WHEN prenoms IS NULL OR prenoms = '' THEN 1 ELSE 0 END), 0) as sans_prenom,
          0 as dates_invalides
        FROM t_cartes
        ${whereClause}
      `).get(params);
      const t1 = performance.now();

      let anomaliesCount = 0;
      const tableCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='t_import_anomalies'").get();
      if (tableCheck) {
        const row = db.prepare('SELECT COUNT(*) as count FROM t_import_anomalies').get();
        anomaliesCount = row ? row.count : 0;
      }
      stats.dates_invalides = anomaliesCount;
      const t2 = performance.now();

      const andSite = siteId ? `AND site_id = @siteId` : '';
      const andCentre = centreId ? `AND centre_id = @centreId` : '';
      const andSiteT = siteId ? `AND t.site_id = @siteId` : '';
      const andCentreT = centreId ? `AND t.centre_id = @centreId` : '';

      const distribParJour = db.prepare(`
        SELECT date_delivrance as jour, COUNT(*) as count
        FROM t_cartes 
        WHERE date_delivrance IS NOT NULL AND date_delivrance != ''
        ${andSite} ${andCentre}
        GROUP BY date_delivrance ORDER BY jour DESC LIMIT 30
      `).all(params);
      const t3 = performance.now();

      const distribParCentre = db.prepare(`
        SELECT c.nom as centre, COUNT(t.id_carte) as count
        FROM t_cartes t LEFT JOIN t_centres c ON t.centre_id = c.id
        WHERE t.statut IN ('DELIVRE','DISTRIBUEE','RETIRE')
        ${andSiteT} ${andCentreT}
        GROUP BY t.centre_id
      `).all(params);
      const t4 = performance.now();

      const hasWhere = whereClause !== '';
      const doublons = db.prepare(`
        SELECT COUNT(*) as count FROM (
          SELECT cle_doublon FROM t_cartes
          ${whereClause}
          GROUP BY cle_doublon
          HAVING cle_doublon IS NOT NULL AND cle_doublon != '' AND cle_doublon != '||||' AND COUNT(*) > 1
        )
      `).get(params);
      const t5 = performance.now();

      const doublonsProbables = db.prepare(`
        SELECT COUNT(*) as count FROM (
          SELECT noms, prenoms, date_de_naissance
          FROM t_cartes
          ${whereClause}
          GROUP BY noms, prenoms, date_de_naissance
          HAVING noms IS NOT NULL AND COUNT(DISTINCT cle_doublon) > 1
        )
      `).get(params);
      const t6 = performance.now();

      parentPort.postMessage({
        type: 'log',
        message: `[WORKER PERF] KPI: ${(t1-t0).toFixed(2)}ms | DLQ: ${(t2-t1).toFixed(2)}ms | Jour: ${(t3-t2).toFixed(2)}ms | Centre: ${(t4-t3).toFixed(2)}ms | Strict: ${(t5-t4).toFixed(2)}ms | Prob: ${(t6-t5).toFixed(2)}ms | Total: ${(t6-t0).toFixed(2)}ms`
      });

      parentPort.postMessage({
        success: true,
        messageId,
        data: {
          ...stats,
          doublons_stricts: doublons.count,
          doublons_probables: doublonsProbables.count,
          distribParJour,
          distribParCentre
        }
      });
    } else if (type === 'getBulkAnomalies') {
      const strictCountRow = db.prepare(`
        SELECT COUNT(*) as count FROM t_cartes 
        WHERE site_id = ? AND is_dirty = 1 AND cle_doublon IN (
          SELECT cle_doublon FROM t_cartes 
          WHERE site_id = ?
          GROUP BY cle_doublon HAVING cle_doublon IS NOT NULL AND cle_doublon != '' AND cle_doublon != '||||' AND COUNT(*) > 1
        )
      `).get(siteId, siteId);

      const probableCountRow = db.prepare(`
        SELECT COUNT(*) as count FROM t_cartes 
        WHERE site_id = ? AND is_dirty = 1 AND (noms || '||' || prenoms || '||' || date_de_naissance) IN (
          SELECT noms || '||' || prenoms || '||' || date_de_naissance FROM t_cartes 
          WHERE site_id = ?
          GROUP BY noms, prenoms, date_de_naissance HAVING noms IS NOT NULL AND COUNT(DISTINCT cle_doublon) > 1
        )
      `).get(siteId, siteId);

      const invalidDateCountRow = db.prepare(`
        SELECT COUNT(*) as count FROM t_cartes 
        WHERE site_id = ? AND is_dirty = 1 AND (
          date_de_naissance IS NOT NULL AND date_de_naissance != '' AND 
          (
            date_de_naissance NOT REGEXP '^([0-2][0-9]|3[0-1])/(0[1-9]|1[0-2])/[0-9]{4}$' 
            AND date_de_naissance NOT REGEXP '^[0-9]{4}$'
          )
        )
      `).get(siteId);

      parentPort.postMessage({
        success: true,
        messageId,
        data: {
          strictCount: strictCountRow ? strictCountRow.count : 0,
          probableCount: probableCountRow ? probableCountRow.count : 0,
          invalidCount: invalidDateCountRow ? invalidDateCountRow.count : 0
        }
      });
    } else if (type === 'getDetailedSyncStats') {
      const t0 = performance.now();
      const dirtyCards = db.prepare(`
        SELECT cle_doublon, noms, prenoms, date_de_naissance 
        FROM t_cartes 
        WHERE site_id = ? AND (is_dirty = 1 OR synced_at IS NULL OR synced_at = '')
      `).all(siteId);

      const strictDuplicates = db.prepare(`
          SELECT cle_doublon FROM t_cartes 
          WHERE site_id = ?
          GROUP BY cle_doublon HAVING cle_doublon IS NOT NULL AND cle_doublon != '' AND cle_doublon != '||||' AND COUNT(*) > 1
      `).all(siteId).reduce((acc, row) => { acc.add(row.cle_doublon); return acc; }, new Set());

      const probableDuplicates = db.prepare(`
          SELECT noms || '||' || prenoms || '||' || date_de_naissance as hash 
          FROM t_cartes 
          WHERE site_id = ?
          GROUP BY noms, prenoms, date_de_naissance HAVING noms IS NOT NULL AND COUNT(DISTINCT cle_doublon) > 1
      `).all(siteId).reduce((acc, row) => { acc.add(row.hash); return acc; }, new Set());

      let invalidCount = 0;
      let strictCount = 0;
      let probableCount = 0;
      let cleanCount = 0;

      const dateRegex = /^\\d{4}-\\d{2}-\\d{2}$/;

      for (const card of dirtyCards) {
        if (!card.date_de_naissance || !dateRegex.test(card.date_de_naissance)) {
          invalidCount++;
        } else if (card.cle_doublon && card.cle_doublon !== '||||' && strictDuplicates.has(card.cle_doublon)) {
          strictCount++;
        } else if (card.noms && probableDuplicates.has(card.noms + '||' + card.prenoms + '||' + card.date_de_naissance)) {
          probableCount++;
        } else {
          cleanCount++;
        }
      }

      const t1 = performance.now();
      parentPort.postMessage({
        type: 'log',
        message: `[WORKER PERF] getDetailedSyncStats for siteId ${siteId} took ${(t1-t0).toFixed(2)}ms`
      });

      parentPort.postMessage({
        success: true,
        messageId,
        data: {
          invalidCount,
          strictCount,
          probableCount,
          cleanCount
        }
      });
    }
  } catch (error) {
    parentPort.postMessage({ success: false, messageId: msg.messageId, error: error.message });
  }
});
