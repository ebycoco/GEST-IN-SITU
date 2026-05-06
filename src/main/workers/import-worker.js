// GEST-IN-SITU Import Worker
// Runs in a separate thread to avoid blocking the Electron UI
const { parentPort, workerData } = require('worker_threads');
const Database = require(workerData.sqlitePath);
const { createReadStream } = require('fs');
const readline = require('readline');

async function run() {
  const { dbPath, filePath, agent, totalEstimate, siteId } = workerData;
  const total = totalEstimate || 220000;

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('cache_size = -64000');
  db.pragma('temp_store = MEMORY');

  // Ensure t_import_temp has the new columns
  try {
    db.prepare('ALTER TABLE t_import_temp ADD COLUMN nom_retirant TEXT').run();
    db.prepare('ALTER TABLE t_import_temp ADD COLUMN num_retirant TEXT').run();
    db.prepare('ALTER TABLE t_import_temp ADD COLUMN site_id INTEGER').run();
  } catch (e) {
    // Columns probably already exist
  }

  // Clear temp table
  db.prepare('DELETE FROM t_import_temp').run();

  const insertStmt = db.prepare(
    'INSERT INTO t_import_temp (noms, prenoms, date_de_naissance, num_secu, lieu_de_naissance, ' +
    'contact, lieu_enrolement, rangement, statut, date_delivrance, ' +
    'agent_saisie, site_id, cle_doublon, cle_doublon_flex, nom_retirant, num_retirant) ' +
    'VALUES (@noms, @prenoms, @date_de_naissance, @num_secu, @lieu_de_naissance, ' +
    '@contact, @lieu_enrolement, @rangement, @statut, @date_delivrance, ' +
    '@agent_saisie, @site_id, @cle_doublon, @cle_doublon_flex, @nom_retirant, @num_retirant)'
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
  var sep = ';';

  function removeAccents(str) {
    return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }

  function cleanDate(dateStr) {
    if (!dateStr) return '';
    let s = dateStr.toString().trim();
    s = s.replace(/\/\/+/g, '/');
    const months = { 'jan': '01', 'fev': '02', 'fév': '02', 'mar': '03', 'avr': '04', 'mai': '05', 'jui': '06', 'juin': '06', 'juil': '07', 'aou': '08', 'aoû': '08', 'aug': '08', 'sep': '09', 'oct': '10', 'nov': '11', 'dec': '12', 'déc': '12' };
    let match = s.match(/^(\d{1,3})[-\s\/]+([a-zA-Zàâäéèêëïîôöùûüç]+)\.??[-\s\/]+(\d{2,4})$/i);
    if (match) {
      let day = parseInt(match[1], 10).toString().padStart(2, '0');
      let mStr = match[2].toLowerCase().replace(/\./g, '');
      let year = match[3];
      if (year.length === 2) year = (parseInt(year) > 50 ? '19' : '20') + year;
      let mNum = null;
      for (const [k, v] of Object.entries(months)) {
        if (mStr.startsWith(k)) { mNum = v; break; }
      }
      if (mNum) return day + '/' + mNum + '/' + year;
    }
    let parts = s.split(/[^0-9]+/).filter(Boolean);
    if (parts.length >= 3) {
      let d = parts[0]; let m = parts[1]; let y = parts[2];
      if (d.length === 4) { let temp = y; y = d; d = temp; }
      d = parseInt(d, 10).toString().padStart(2, '0');
      m = parseInt(m, 10).toString().padStart(2, '0');
      if (y.length === 2) y = (parseInt(y) > 50 ? '19' : '20') + y;
      if (parseInt(d, 10) > 31) d = parts[0].substring(0, 2);
      return d + '/' + m + '/' + y;
    }
    return s;
  }

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
      var ddn = cleanDate(rowData.date_de_naissance || '');
      var lieuN = (rowData.lieu_de_naissance || '').toUpperCase().trim();
      var contact = (rowData.contact || '').trim();

      // --- IMPROVED STATUT LOGIC ---
      var rawStatut = removeAccents((rowData.statut || '').toUpperCase().trim());
      var finalStatut = 'EN STOCK';
      var nomRetirant = null;
      var numRetirant = null;

      // 1. Synonymes & Normalisation
      if (rawStatut.startsWith('DELIV') || 
          rawStatut.startsWith('DISTRIB') || 
          rawStatut.startsWith('REMI') || 
          rawStatut === 'OK' || 
          rawStatut === 'RECU' ||
          rawStatut.startsWith('RETIRE')) {
        finalStatut = 'DELIVRE';
      } else if (rawStatut === 'ANNULE') {
        finalStatut = 'ANNULE';
      } else if (rawStatut === 'STOCK' || rawStatut === 'EN STOCK' || !rawStatut) {
        finalStatut = 'EN STOCK';
      }

      // 2. Extraction Retirant si "RETIRE PAR"
      if (rawStatut.startsWith('RETIRE PAR')) {
        finalStatut = 'DELIVRE';
        var detail = rawStatut.replace('RETIRE PAR', '').trim();
        
        if (detail === 'LUI MEME' || detail === 'ELLE MEME') {
          nomRetirant = noms + ' ' + prenoms;
          numRetirant = contact;
        } else {
          // Extraction du numéro (Regex pour trouver 8 à 10 chiffres consécutifs ou avec espaces/points)
          var phoneMatch = detail.match(/(?:(?:\+|00)225)?\s?(\d[\s\.]?\d[\s\.]?\d[\s\.]?\d[\s\.]?\d[\s\.]?\d[\s\.]?\d[\s\.]?\d[\s\.]?\d?)/);
          if (phoneMatch) {
            numRetirant = phoneMatch[0].replace(/[\s\.]/g, '');
            // On retire le numéro du nom
            nomRetirant = detail.replace(phoneMatch[0], '').replace(/[,]/g, '').trim();
          } else {
            nomRetirant = detail;
            numRetirant = contact; // Par défaut
          }
        }
      }

      batch.push({
        noms: noms,
        prenoms: prenoms,
        date_de_naissance: ddn,
        num_secu: (rowData.num_secu || '').trim(),
        lieu_de_naissance: lieuN,
        contact: contact,
        lieu_enrolement: (rowData.lieu_enrolement || '').toUpperCase().trim(),
        rangement: (rowData.rangement || '').toUpperCase().trim(),
        statut: finalStatut,
        date_delivrance: rowData.date_delivrance || (finalStatut === 'DELIVRE' ? new Date().toISOString().split('T')[0] : ''),
        agent_saisie: agent,
        site_id: siteId,
        cle_doublon: noms + '|' + prenoms + '|' + ddn + '|' + lieuN + '|' + contact,
        cle_doublon_flex: noms + '|' + prenoms + '|' + ddn + '|' + contact,
        nom_retirant: nomRetirant,
        num_retirant: numRetirant
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
    'SET statut = t_import_temp.statut, ' +
    '    nom_retirant = t_import_temp.nom_retirant, ' +
    '    num_retirant = t_import_temp.num_retirant, ' +
    '    date_delivrance = COALESCE(t_cartes.date_delivrance, t_import_temp.date_delivrance), ' +
    '    updated_at = @now, is_dirty = 1 ' +
    'FROM t_import_temp ' +
    'WHERE t_cartes.cle_doublon = t_import_temp.cle_doublon ' +
    "AND (t_cartes.statut = 'EN STOCK' OR t_cartes.statut IS NULL OR t_cartes.statut = '') " +
    "AND t_import_temp.statut = 'DELIVRE' " +
    "AND t_cartes.site_id = @siteId"
  ).run({ now: now, siteId: siteId });

  parentPort.postMessage({ type: 'progress', value: 92 });

  var insertResult = db.prepare(
    'INSERT INTO t_cartes (noms, prenoms, date_de_naissance, num_secu, lieu_de_naissance, ' +
    'contact, lieu_enrolement, rangement, statut, date_delivrance, agent_saisie, site_id, ' +
    'cle_doublon, cle_doublon_flex, nom_retirant, num_retirant, sync_id, created_at, updated_at, is_dirty) ' +
    'SELECT noms, prenoms, date_de_naissance, num_secu, lieu_de_naissance, ' +
    'contact, lieu_enrolement, rangement, statut, date_delivrance, agent_saisie, site_id, ' +
    'cle_doublon, cle_doublon_flex, nom_retirant, num_retirant, lower(hex(randomblob(16))), ' +
    '@now, @now, 1 ' +
    'FROM t_import_temp ' +
    'WHERE cle_doublon NOT IN (SELECT cle_doublon FROM t_cartes WHERE cle_doublon IS NOT NULL AND site_id = @siteId)'
  ).run({ now: now, siteId: siteId });

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

