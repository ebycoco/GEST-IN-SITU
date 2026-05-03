// GEST-IN-SITU Import Worker
// Runs in a separate thread to avoid blocking the Electron UI
const { parentPort, workerData } = require('worker_threads');
const Database = require(workerData.sqlitePath);
const { createReadStream } = require('fs');
const readline = require('readline');

async function run() {
  const { dbPath, filePath, agent, totalEstimate } = workerData;
  const total = totalEstimate || 220000;

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('cache_size = -64000');
  db.pragma('temp_store = MEMORY');

  // Clear temp table
  db.prepare('DELETE FROM t_import_temp').run();

  const insertStmt = db.prepare(
    'INSERT INTO t_import_temp (noms, prenoms, date_de_naissance, num_secu, lieu_de_naissance, ' +
    'contact, lieu_enrolement, rangement, statut, date_delivrance, ' +
    'agent_saisie, cle_doublon, cle_doublon_flex) ' +
    'VALUES (@noms, @prenoms, @date_de_naissance, @num_secu, @lieu_de_naissance, ' +
    '@contact, @lieu_enrolement, @rangement, @statut, @date_delivrance, ' +
    '@agent_saisie, @cle_doublon, @cle_doublon_flex)'
  );

  const BATCH_SIZE = 5000;
  const insertMany = db.transaction(function(items) {
    for (var i = 0; i < items.length; i++) {
      insertStmt.run(items[i]);
    }
  });

  // Stream read CSV
  const fileStream = createReadStream(filePath);
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
  var headers = [];
  var batch = [];
  var lineCount = 0;
  var processedRows = 0;
  var sep = ',';

  for await (const line of rl) {
    if (!line.trim()) continue;
    if (lineCount === 0) {
      sep = line.includes(';') ? ';' : ',';
      headers = line.split(sep).map(function(h) { return h.trim().replace(/"/g, ''); });
    } else {
      var cols = line.split(sep).map(function(c) { return c.trim().replace(/^"|"$/g, ''); });
      var rowData = {};
      for (var i = 0; i < headers.length; i++) {
        rowData[headers[i].toLowerCase().replace(/\s+/g, '_')] = cols[i] || '';
      }

      var noms = (rowData.noms || '').toUpperCase().trim();
      var prenoms = (rowData.prenoms || '').toUpperCase().trim();
      var ddn = rowData.date_de_naissance || '';
      var lieuN = (rowData.lieu_de_naissance || '').toUpperCase().trim();
      var contact = (rowData.contact || '').toUpperCase().trim();

      var rawStatut = (rowData.statut || 'EN STOCK').toUpperCase().trim();
      var validStatuts = ['EN STOCK', 'DELIVRE', 'DISTRIBUEE', 'RETIRE', 'ANNULE'];
      var statut = validStatuts.indexOf(rawStatut) >= 0 ? rawStatut : 'EN STOCK';

      batch.push({
        noms: noms,
        prenoms: prenoms,
        date_de_naissance: ddn,
        num_secu: (rowData.num_secu || '').trim(),
        lieu_de_naissance: lieuN,
        contact: contact,
        lieu_enrolement: (rowData.lieu_enrolement || '').toUpperCase().trim(),
        rangement: (rowData.rangement || '').toUpperCase().trim(),
        statut: statut,
        date_delivrance: rowData.date_delivrance || '',
        agent_saisie: agent,
        cle_doublon: noms + '|' + prenoms + '|' + ddn + '|' + lieuN + '|' + contact,
        cle_doublon_flex: noms + '|' + prenoms + '|' + ddn + '|' + contact
      });

      processedRows++;

      if (batch.length >= BATCH_SIZE) {
        insertMany(batch);
        batch = [];
        parentPort.postMessage({
          type: 'progress',
          value: Math.min(Math.round((processedRows / total) * 80), 80)
        });
      }
    }
    lineCount++;
  }

  if (batch.length > 0) {
    insertMany(batch);
  }

  parentPort.postMessage({ type: 'progress', value: 85 });

  // Fusion phase
  var now = new Date().toISOString();

  var updateResult = db.prepare(
    'UPDATE t_cartes ' +
    'SET statut = t_import_temp.statut, updated_at = @now, is_dirty = 1 ' +
    'FROM t_import_temp ' +
    'WHERE t_cartes.cle_doublon = t_import_temp.cle_doublon ' +
    "AND (t_cartes.statut = 'EN STOCK' OR t_cartes.statut IS NULL OR t_cartes.statut = '') " +
    "AND t_import_temp.statut IN ('DELIVRE','DISTRIBUEE','RETIRE')"
  ).run({ now: now });

  parentPort.postMessage({ type: 'progress', value: 92 });

  var insertResult = db.prepare(
    'INSERT INTO t_cartes (noms, prenoms, date_de_naissance, num_secu, lieu_de_naissance, ' +
    'contact, lieu_enrolement, rangement, statut, date_delivrance, agent_saisie, ' +
    'cle_doublon, cle_doublon_flex, sync_id, created_at, updated_at, is_dirty) ' +
    'SELECT noms, prenoms, date_de_naissance, num_secu, lieu_de_naissance, ' +
    'contact, lieu_enrolement, rangement, ' +
    "CASE WHEN statut IN ('EN STOCK','DELIVRE','DISTRIBUEE','RETIRE','ANNULE') THEN statut ELSE 'EN STOCK' END, " +
    'date_delivrance, agent_saisie, ' +
    "cle_doublon, cle_doublon_flex, lower(hex(randomblob(16))), " +
    '@now, @now, 1 ' +
    'FROM t_import_temp ' +
    'WHERE cle_doublon NOT IN (SELECT cle_doublon FROM t_cartes WHERE cle_doublon IS NOT NULL)'
  ).run({ now: now });

  parentPort.postMessage({ type: 'progress', value: 98 });

  db.prepare('DELETE FROM t_import_temp').run();
  db.close();

  parentPort.postMessage({ type: 'progress', value: 100 });
  parentPort.postMessage({
    type: 'done',
    result: { updated: updateResult.changes, inserted: insertResult.changes }
  });
}

run().catch(function(e) {
  parentPort.postMessage({ type: 'error', error: String(e) });
});
