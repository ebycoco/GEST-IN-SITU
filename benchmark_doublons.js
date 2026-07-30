const Database = require('better-sqlite3');
const { performance } = require('perf_hooks');

const db = new Database(':memory:');

// Create table matching the schema
db.exec(`
  CREATE TABLE t_cartes (
    id_carte INTEGER PRIMARY KEY AUTOINCREMENT,
    site_id INTEGER,
    is_dirty INTEGER,
    noms TEXT,
    prenoms TEXT,
    date_de_naissance TEXT,
    contact TEXT,
    lieu_de_naissance TEXT,
    cle_doublon TEXT
  );

  CREATE INDEX idx_cartes_stats_dp_v2 ON t_cartes(site_id, noms, prenoms, date_de_naissance, cle_doublon);
  CREATE INDEX idx_cartes_site_identite ON t_cartes(site_id, noms, prenoms, date_de_naissance);
`);

// Insert 20,000 records
const insert = db.prepare(`
  INSERT INTO t_cartes (site_id, is_dirty, noms, prenoms, date_de_naissance, contact, lieu_de_naissance, cle_doublon)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

db.transaction(() => {
  for (let i = 0; i < 20000; i++) {
    // We create some "doublons probables" (same identity, different cle_doublon)
    // 1000 pairs of doublons probables (2000 records), and 18000 distinct records
    const isDoublon = i < 2000;
    const baseId = isDoublon ? Math.floor(i / 2) : i;
    
    insert.run(
      1, // site_id
      0, // is_dirty
      `NOM_${baseId}`, // noms
      `PRENOM_${baseId}`, // prenoms
      `1990-01-01`, // ddn
      `010203040${i%10}`, // contact
      `LIEU_${i}`, // lieu
      `CLE_${i}` // cle_doublon (always unique so they are considered "probables" since identities match but cle_doublon differ)
    );
  }
})();

console.log("DB populated with 20,000 records (including 1,000 groups of doublons probables).");

// Simulate the query without filters
const queryWithoutFilters = `
    SELECT SUM(c - 1) as count FROM (
      SELECT COUNT(*) as c
      FROM t_cartes
      WHERE site_id = ? AND is_dirty != -1 
      GROUP BY noms, prenoms, date_de_naissance
      HAVING COUNT(DISTINCT cle_doublon) > 1
    )
`;

const groupsQueryWithoutFilters = `
    SELECT noms, prenoms, date_de_naissance
    FROM t_cartes
    WHERE site_id = ? AND is_dirty != -1 
    GROUP BY noms, prenoms, date_de_naissance
    HAVING COUNT(DISTINCT cle_doublon) > 1
    ORDER BY noms ASC, prenoms ASC
    LIMIT 20 OFFSET 0
`;

let t0 = performance.now();
let res1 = db.prepare(queryWithoutFilters).get(1);
let t1 = performance.now();
console.log(`Total Query (No Filters): ${(t1 - t0).toFixed(2)} ms (Count: ${res1.count})`);

t0 = performance.now();
let res2 = db.prepare(groupsQueryWithoutFilters).all(1);
t1 = performance.now();
console.log(`Groups Query (No Filters): ${(t1 - t0).toFixed(2)} ms`);

// Now simulate with the heavy text filter
const filterClause = " AND ((COALESCE(noms, '') || ' ' || COALESCE(prenoms, '')) LIKE ? OR (COALESCE(prenoms, '') || ' ' || COALESCE(noms, '')) LIKE ? OR contact LIKE ?)";
const q = '%NOM_500%';

const queryWithFilters = `
    SELECT SUM(c - 1) as count FROM (
      SELECT COUNT(*) as c
      FROM t_cartes
      WHERE site_id = ? AND is_dirty != -1 ${filterClause}
      GROUP BY noms, prenoms, date_de_naissance
      HAVING COUNT(DISTINCT cle_doublon) > 1
    )
`;

t0 = performance.now();
let res3 = db.prepare(queryWithFilters).get(1, q, q, q);
t1 = performance.now();
console.log(`Total Query (With Heavy Filter '%NOM_500%'): ${(t1 - t0).toFixed(2)} ms (Count: ${res3.count})`);
