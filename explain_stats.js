const DB = require('better-sqlite3');
const db = new DB('C:/Users/EBYCHOCO/AppData/Roaming/gest-in-situ/data/gest_in_situ.db');
const siteId = 4;

console.log('--- EXPLAIN KPI generaux ---');
console.log(db.prepare(`EXPLAIN QUERY PLAN
  SELECT
    COUNT(*) as total,
    IFNULL(SUM(CASE WHEN statut = 'EN STOCK' OR statut IS NULL OR statut = '' THEN 1 ELSE 0 END), 0) as en_stock,
    IFNULL(SUM(CASE WHEN statut IN ('DELIVRE','DISTRIBUEE','RETIRE') THEN 1 ELSE 0 END), 0) as distribuees,
    IFNULL(SUM(CASE WHEN statut_physique = 'ABSENT' THEN 1 ELSE 0 END), 0) as absentes,
    IFNULL(SUM(CASE WHEN num_secu IS NULL OR num_secu = '' OR num_secu LIKE '-%' THEN 1 ELSE 0 END), 0) as sans_num_secu,
    IFNULL(SUM(CASE WHEN rangement IS NULL OR rangement = '' OR rangement = 'NON CLASSE' THEN 1 ELSE 0 END), 0) as sans_rangement,
    0 as dates_invalides
  FROM t_cartes
  WHERE site_id = ?
`).all(siteId));

console.log('\n--- EXPLAIN Distrib Par Jour ---');
console.log(db.prepare(`EXPLAIN QUERY PLAN
  SELECT date_delivrance as jour, COUNT(*) as count
  FROM t_cartes 
  WHERE date_delivrance IS NOT NULL AND date_delivrance != ''
  AND site_id = ?
  GROUP BY date_delivrance ORDER BY jour DESC LIMIT 30
`).all(siteId));

console.log('\n--- EXPLAIN Doublons probables ---');
console.log(db.prepare(`EXPLAIN QUERY PLAN
  SELECT COUNT(*) as count FROM (
    SELECT noms, prenoms, date_de_naissance
    FROM t_cartes
    WHERE site_id = ?
    AND noms IS NOT NULL
    GROUP BY noms, prenoms, date_de_naissance
    HAVING COUNT(DISTINCT cle_doublon) > 1
  )
`).all(siteId));

console.log('\n--- EXPLAIN Doublons stricts ---');
console.log(db.prepare(`EXPLAIN QUERY PLAN
  SELECT COUNT(*) as count FROM (
    SELECT cle_doublon FROM t_cartes
    WHERE site_id = ?
    AND cle_doublon IS NOT NULL AND cle_doublon != '' AND cle_doublon != '||||'
    GROUP BY cle_doublon HAVING COUNT(*) > 1
  )
`).all(siteId));
