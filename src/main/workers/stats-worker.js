const { parentPort, workerData } = require('worker_threads');
const Database = require(workerData.sqlitePath);

let db = null;

parentPort.on('message', (msg) => {
  try {
    const { type, messageId, siteId, centreId, where: whereClause, params } = msg;

    if (!db) {
      db = new Database(workerData.dbPath, { readonly: true, timeout: 60000 });
      try {
        db.pragma('journal_mode = WAL');
        db.pragma('synchronous = NORMAL');
        db.pragma('cache_size = -64000'); // 64MB cache
        db.pragma('temp_store = MEMORY');
        db.pragma('mmap_size = 268435456'); // 256MB mmap
        db.pragma('busy_timeout = 60000');
      } catch(e) {
        // Ignorer si readonly
      }

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
      stats.total = (stats.total || 0) + anomaliesCount;
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
        SELECT SUM(c - 1) as count FROM (
          SELECT COUNT(*) as c FROM t_cartes
          ${whereClause}
          GROUP BY cle_doublon
          HAVING cle_doublon IS NOT NULL AND cle_doublon != '' AND cle_doublon != '||||' AND COUNT(*) > 1
        )
      `).get(params);
      const t5 = performance.now();

      const doublonsProbables = db.prepare(`
        SELECT SUM(c - 1) as count FROM (
          SELECT COUNT(*) as c FROM t_cartes
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
          doublons_stricts: doublons.count || 0,
          doublons_probables: doublonsProbables.count || 0,
          distribParJour,
          distribParCentre
        }
      });
    } else if (type === 'getBulkAnomalies') {
      // Cartes avec champs critiques manquants (Nom, Prénom, Date, Rangement)
      const missingCountRow = db.prepare(`
        SELECT COUNT(*) as count FROM t_cartes 
        WHERE site_id = ? AND (is_dirty = 1 OR synced_at IS NULL OR synced_at = '') AND (
          (noms IS NULL OR noms = '') OR
          (prenoms IS NULL OR prenoms = '') OR
          (date_de_naissance IS NULL OR date_de_naissance = '') OR
          (rangement IS NULL OR rangement = '' OR rangement = 'NON CLASSE')
        )
        AND (date_de_naissance IS NULL OR date_de_naissance = '' OR date_de_naissance REGEXP '^\\d{4}-\\d{2}-\\d{2}$')
        AND NOT (
          (noms IS NULL OR noms = '') AND
          (prenoms IS NULL OR prenoms = '') AND
          (num_secu IS NULL OR num_secu = '') AND
          (rangement IS NULL OR rangement = '' OR rangement = 'NON CLASSE')
        )
      `).get(siteId);

      const strictCountRow = db.prepare(`
        SELECT COUNT(*) as count FROM t_cartes AS c
        WHERE c.site_id = ? AND (c.is_dirty = 1 OR c.synced_at IS NULL OR c.synced_at = '')
        AND (c.noms IS NOT NULL AND c.noms != '') AND (c.prenoms IS NOT NULL AND c.prenoms != '')
        AND (c.date_de_naissance IS NOT NULL AND c.date_de_naissance != '')
        AND (c.rangement IS NOT NULL AND c.rangement != '' AND c.rangement != 'NON CLASSE')
        AND c.date_de_naissance REGEXP '^\\d{4}-\\d{2}-\\d{2}$'
        AND c.cle_doublon IS NOT NULL AND c.cle_doublon != '' AND c.cle_doublon != '||||'
        AND EXISTS (
          SELECT 1 FROM t_cartes AS c2 
          WHERE c2.site_id = c.site_id AND c2.cle_doublon = c.cle_doublon AND c2.id_carte != c.id_carte
        )
      `).get(siteId);

      const probableCountRow = db.prepare(`
        SELECT COUNT(*) as count FROM t_cartes AS c
        WHERE c.site_id = ? AND (c.is_dirty = 1 OR c.synced_at IS NULL OR c.synced_at = '')
        AND (c.noms IS NOT NULL AND c.noms != '') AND (c.prenoms IS NOT NULL AND c.prenoms != '')
        AND (c.date_de_naissance IS NOT NULL AND c.date_de_naissance != '')
        AND (c.rangement IS NOT NULL AND c.rangement != '' AND c.rangement != 'NON CLASSE')
        AND c.date_de_naissance REGEXP '^\\d{4}-\\d{2}-\\d{2}$'
        AND EXISTS (
          SELECT 1 FROM t_cartes AS c2 
          WHERE c2.site_id = c.site_id 
            AND c2.noms = c.noms AND c2.prenoms = c.prenoms AND c2.date_de_naissance = c.date_de_naissance 
            AND c2.cle_doublon != c.cle_doublon
        )
      `).get(siteId);

      const invalidDateCountRow = db.prepare(`
        SELECT COUNT(*) as count FROM t_cartes 
        WHERE site_id = ? AND (is_dirty = 1 OR synced_at IS NULL OR synced_at = '')
        AND date_de_naissance IS NOT NULL AND date_de_naissance != ''
        AND date_de_naissance NOT REGEXP '^\\d{4}-\\d{2}-\\d{2}$'
        AND NOT (
          (noms IS NULL OR noms = '') AND
          (prenoms IS NULL OR prenoms = '') AND
          (num_secu IS NULL OR num_secu = '') AND
          (rangement IS NULL OR rangement = '' OR rangement = 'NON CLASSE')
        )
      `).get(siteId);

      const invalidAnomaliesRow = db.prepare(`
        SELECT COUNT(*) as count FROM t_import_anomalies
        WHERE site_id = ? AND type_anomalie = 'DATE_INVALIDE'
      `).get(siteId);

      const totalInvalidCount = (invalidDateCountRow ? invalidDateCountRow.count : 0) + 
                                (invalidAnomaliesRow ? invalidAnomaliesRow.count : 0);


      parentPort.postMessage({
        success: true,
        messageId,
        data: {
          missingCount: missingCountRow ? missingCountRow.count : 0,
          strictCount: strictCountRow ? strictCountRow.count : 0,
          probableCount: probableCountRow ? probableCountRow.count : 0,
          invalidCount: totalInvalidCount
        }
      });
    } else if (type === 'getDetailedSyncStats') {
      // ─── OPTIMISATION PERF : 100% SQL agrégé, zéro boucle JS, zéro chargement en mémoire ───
      // Ancien algo : boucle JS sur N cartes × 2 requêtes SQL/carte → 227s pour 200k cartes
      // Nouveau algo : 6 COUNT() SQL directs exploitant les index existants → <1s attendu
      const t0 = performance.now();

      // ── 0. Cartes supprimées en attente (is_dirty = -1) ──────────────────────────────────────
      const deletedCountRow = db.prepare(`
        SELECT COUNT(*) as count FROM t_cartes
        WHERE site_id = ? AND is_dirty = -1 AND statut != 'BROUILLON'
      `).get(siteId);
      const deletedCount = deletedCountRow ? deletedCountRow.count : 0;

      // ── 1. Anomalies DATE_INVALIDE depuis la table d'import ──────────────────────────────────
      const invalidAnomaliesRow = db.prepare(`
        SELECT COUNT(*) as count FROM t_import_anomalies
        WHERE site_id = ? AND type_anomalie = 'DATE_INVALIDE'
      `).get(siteId);
      const invalidFromAnomalies = invalidAnomaliesRow ? invalidAnomaliesRow.count : 0;

      // CTE de base : cartes dirty non-supprimées, non-brouillon, non-fantômes
      // Utilisée dans TOUTES les requêtes ci-dessous pour éviter la répétition et garder les index actifs
      const BASE_CTE = `
        WITH dirty_base AS (
          SELECT id_carte, cle_doublon, noms, prenoms, date_de_naissance, rangement, num_secu, synced_at, is_dirty
          FROM t_cartes
          WHERE site_id = ?
            AND is_dirty = 1
            AND statut != 'BROUILLON'
            AND NOT (
              (noms IS NULL OR noms = '') AND
              (prenoms IS NULL OR prenoms = '') AND
              (num_secu IS NULL OR num_secu = '') AND
              (rangement IS NULL OR rangement = '' OR rangement = 'NON CLASSE')
            )
        )
      `;

      // ── 2. invalidCount : date présente mais format invalide → BLOQUÉ (Étape 3) ─────────────
      const invalidDateCountRow = db.prepare(`${BASE_CTE}
        SELECT COUNT(*) as count FROM dirty_base
        WHERE date_de_naissance IS NOT NULL
          AND date_de_naissance != ''
          AND date_de_naissance NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
      `).get(siteId);
      const invalidCount = (invalidDateCountRow ? invalidDateCountRow.count : 0) + invalidFromAnomalies;

      // ── 3. missingCount : champ critique manquant (Étape 2) ──────────────────────────────────
      // Exclut les cartes déjà comptées dans invalidCount
      const missingCountRow = db.prepare(`${BASE_CTE}
        SELECT COUNT(*) as count FROM dirty_base
        WHERE (
          date_de_naissance IS NULL OR date_de_naissance = '' OR
          date_de_naissance GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
        )
        AND (
          (noms IS NULL OR noms = '') OR
          (prenoms IS NULL OR prenoms = '') OR
          (date_de_naissance IS NULL OR date_de_naissance = '') OR
          (rangement IS NULL OR rangement = '' OR rangement = 'NON CLASSE')
        )
      `).get(siteId);
      const missingCount = missingCountRow ? missingCountRow.count : 0;

      // ── 4. strictCount : doublons stricts parmi les cartes complètes dirty (Étape 2) ─────────
      // Utilise une auto-jointure groupée sur cle_doublon : aucune boucle JS
      const strictCountRow = db.prepare(`${BASE_CTE}
        SELECT COUNT(*) as count FROM dirty_base AS d
        WHERE (d.noms IS NOT NULL AND d.noms != '')
          AND (d.prenoms IS NOT NULL AND d.prenoms != '')
          AND (d.date_de_naissance IS NOT NULL AND d.date_de_naissance != '')
          AND (d.rangement IS NOT NULL AND d.rangement != '' AND d.rangement != 'NON CLASSE')
          AND d.date_de_naissance GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
          AND d.cle_doublon IS NOT NULL AND d.cle_doublon != '' AND d.cle_doublon != '||||'
          AND EXISTS (
            SELECT 1 FROM t_cartes c2
            WHERE c2.site_id = ? AND c2.cle_doublon = d.cle_doublon AND c2.id_carte != d.id_carte
          )
      `).get(siteId, siteId);
      const strictCount = strictCountRow ? strictCountRow.count : 0;

      // ── 5. probableCount : doublons probables parmi les cartes non-strictes complètes (Étape 2)
      const probableCountRow = db.prepare(`${BASE_CTE}
        SELECT COUNT(*) as count FROM dirty_base AS d
        WHERE (d.noms IS NOT NULL AND d.noms != '')
          AND (d.prenoms IS NOT NULL AND d.prenoms != '')
          AND (d.date_de_naissance IS NOT NULL AND d.date_de_naissance != '')
          AND (d.rangement IS NOT NULL AND d.rangement != '' AND d.rangement != 'NON CLASSE')
          AND d.date_de_naissance GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
          AND (d.cle_doublon IS NULL OR d.cle_doublon = '' OR d.cle_doublon = '||||' OR NOT EXISTS (
            SELECT 1 FROM t_cartes c2
            WHERE c2.site_id = ? AND c2.cle_doublon = d.cle_doublon AND c2.id_carte != d.id_carte
          ))
          AND EXISTS (
            SELECT 1 FROM t_cartes c3
            WHERE c3.site_id = ?
              AND c3.noms = d.noms AND c3.prenoms = d.prenoms AND c3.date_de_naissance = d.date_de_naissance
              AND (c3.cle_doublon != d.cle_doublon OR d.cle_doublon IS NULL OR d.cle_doublon = '' OR d.cle_doublon = '||||')
          )
      `).get(siteId, siteId, siteId);
      const probableCount = probableCountRow ? probableCountRow.count : 0;

      // ── 6. Cartes saines : nouvelles (cleanCount) et modifications valides (modifiedCount) ───
      // Une carte saine = complète, date valide, pas de doublon strict ni probable
      const cleanModifiedRow = db.prepare(`${BASE_CTE}
        SELECT
          SUM(CASE WHEN synced_at IS NULL OR synced_at = '' THEN 1 ELSE 0 END) as cleanCount,
          SUM(CASE WHEN synced_at IS NOT NULL AND synced_at != '' THEN 1 ELSE 0 END) as modifiedCount
        FROM dirty_base AS d
        WHERE (d.noms IS NOT NULL AND d.noms != '')
          AND (d.prenoms IS NOT NULL AND d.prenoms != '')
          AND (d.date_de_naissance IS NOT NULL AND d.date_de_naissance != '')
          AND (d.rangement IS NOT NULL AND d.rangement != '' AND d.rangement != 'NON CLASSE')
          AND d.date_de_naissance GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
          AND (d.cle_doublon IS NULL OR d.cle_doublon = '' OR d.cle_doublon = '||||' OR NOT EXISTS (
            SELECT 1 FROM t_cartes c2
            WHERE c2.site_id = ? AND c2.cle_doublon = d.cle_doublon AND c2.id_carte != d.id_carte
          ))
          AND NOT EXISTS (
            SELECT 1 FROM t_cartes c3
            WHERE c3.site_id = ?
              AND c3.noms = d.noms AND c3.prenoms = d.prenoms AND c3.date_de_naissance = d.date_de_naissance
              AND (c3.cle_doublon != d.cle_doublon OR d.cle_doublon IS NULL OR d.cle_doublon = '' OR d.cle_doublon = '||||')
          )
      `).get(siteId, siteId, siteId);

      const cleanCount = (cleanModifiedRow ? (cleanModifiedRow.cleanCount || 0) : 0);
      // modifiedCount = modifications valides + suppressions en attente
      const modifiedCount = (cleanModifiedRow ? (cleanModifiedRow.modifiedCount || 0) : 0) + deletedCount;

      const t1 = performance.now();
      parentPort.postMessage({
        type: 'log',
        message: `[WORKER PERF] getDetailedSyncStats (SQL agrégé) siteId=${siteId} → ${(t1-t0).toFixed(2)}ms | clean=${cleanCount} modified=${modifiedCount} missing=${missingCount} strict=${strictCount} probable=${probableCount} invalid=${invalidCount} deleted=${deletedCount}`
      });

      parentPort.postMessage({
        success: true,
        messageId,
        data: {
          cleanCount,
          missingCount,
          strictCount,
          probableCount,
          invalidCount,
          modifiedCount
        }
      });
    }
  } catch (error) {
    parentPort.postMessage({ success: false, messageId: msg.messageId, error: error.message });
  }
});
