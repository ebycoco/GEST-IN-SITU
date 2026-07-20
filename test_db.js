const Database = require('better-sqlite3');
const db = new Database('C:\\Users\\EBYCHOCO\\AppData\\Roaming\\gest-in-situ\\data\\gest_in_situ.db');

const siteId = 4; // Abobo is 4 based on logs 

console.log('--- ALL CARDS ---');
const totalRows = db.prepare(`SELECT COUNT(*) as count FROM t_cartes WHERE site_id = ?`).get(siteId);
console.log('Total cards:', totalRows);

console.log('--- DOUBLONS STRICTS GROUPS ---');
const query = `
  SELECT COUNT(*) as count FROM (
    SELECT cle_doublon FROM t_cartes 
    WHERE site_id = ? 
      AND is_dirty != -1 
      AND cle_doublon IS NOT NULL 
      AND cle_doublon != '' 
      AND cle_doublon != '||||' 
    GROUP BY cle_doublon 
    HAVING COUNT(*) > 1
  )
`;
const duplicates = db.prepare(query).get(siteId);
console.log('Total doublons groups (with is_dirty != -1):', duplicates);

const query2 = `
  SELECT COUNT(*) as count FROM (
    SELECT cle_doublon FROM t_cartes 
    WHERE site_id = ? 
      AND cle_doublon IS NOT NULL 
      AND cle_doublon != '' 
      AND cle_doublon != '||||' 
    GROUP BY cle_doublon 
    HAVING COUNT(*) > 1
  )
`;
const duplicatesAll = db.prepare(query2).get(siteId);
console.log('Total doublons groups (without is_dirty filter):', duplicatesAll);

// Test how many groups have exactly 2 duplicates, vs 3, vs 4...
const groupSizes = db.prepare(`
    SELECT size, COUNT(*) as groupCount FROM (
      SELECT COUNT(*) as size FROM t_cartes 
      WHERE site_id = ? 
        AND is_dirty != -1 
        AND cle_doublon IS NOT NULL 
        AND cle_doublon != '' 
        AND cle_doublon != '||||' 
      GROUP BY cle_doublon 
      HAVING COUNT(*) > 1
    )
    GROUP BY size ORDER BY size ASC
`).all(siteId);

console.log('Distribution of duplicate group sizes:', groupSizes);
