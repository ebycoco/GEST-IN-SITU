// GEST-IN-SITU Upload Worker
// Runs in a separate thread to avoid blocking the Electron UI during Supabase bulk upload
const { parentPort, workerData } = require('worker_threads');
const Database = require(workerData.sqlitePath);
const { createClient } = require('@supabase/supabase-js');

async function run() {
  const { siteId, dbPath, supabaseUrl, supabaseAnonKey, allowProbable, allowInvalid } = workerData;

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });

  const db = new Database(dbPath, { timeout: 60000 });
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 60000');

  // Support de l'opérateur REGEXP dans SQLite (requis pour le filtre des dates invalides)
  db.function('regexp', (pattern, text) => {
    if (text === null) return 0;
    const re = new RegExp(pattern);
    return re.test(text) ? 1 : 0;
  });

  function isValidDate(dateStr) {
    if (!dateStr) return false;
    const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return false;
    const year = parseInt(match[1], 10);
    const month = parseInt(match[2], 10);
    const day = parseInt(match[3], 10);
    if (month < 1 || month > 12) return false;
    
    // Nombres de jours par mois (index 1 à 12)
    const daysInMonth = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    
    // Vérification de l'année bissextile pour Février
    if (month === 2) {
      const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
      if (isLeapYear) daysInMonth[2] = 29;
    }
    
    return day >= 1 && day <= daysInMonth[month];
  }

  let filterClause = `
    WHERE site_id = ? AND (is_dirty = 1 OR synced_at IS NULL OR synced_at = '')
    AND (cle_doublon IS NULL OR cle_doublon = '' OR cle_doublon = '||||' OR cle_doublon NOT IN (
      SELECT cle_doublon FROM t_cartes 
      WHERE site_id = ? AND cle_doublon IS NOT NULL AND cle_doublon != '' AND cle_doublon != '||||'
      GROUP BY cle_doublon HAVING COUNT(*) > 1
    ))
  `;
  const queryParams = [siteId, siteId];

  if (!allowProbable) {
    filterClause += `
      AND (noms || '||' || prenoms || '||' || date_de_naissance) NOT IN (
        SELECT noms || '||' || prenoms || '||' || date_de_naissance FROM t_cartes
        WHERE site_id = ?
        GROUP BY noms, prenoms, date_de_naissance HAVING COUNT(DISTINCT cle_doublon) > 1
      )
    `;
    queryParams.push(siteId);
  }

  if (!allowInvalid) {
    filterClause += `
      AND date_de_naissance REGEXP '^\\d{4}-\\d{2}-\\d{2}$'
      AND date_de_naissance IS NOT NULL
      AND date_de_naissance != ''
    `;
  }

  let cardIdsRows = [];
  try {
    cardIdsRows = db.prepare(`SELECT id_carte FROM t_cartes ${filterClause}`).all(...queryParams);
  } catch (err) {
    parentPort.postMessage({ type: 'error', error: err.message });
    return;
  }

  const totalToUpload = cardIdsRows.length;
  if (totalToUpload === 0) {
    parentPort.postMessage({ type: 'done', uploadedCount: 0, message: 'Aucune donnee locale conforme en attente de synchronisation.' });
    return;
  }

  parentPort.postMessage({ type: 'start', total: totalToUpload });

  let uploadedCount = 0;
  let chunkSize = 300;
  const MIN_CHUNK_SIZE = 100;
  const MAX_CHUNK_SIZE = 800;
  let i = 0;
  let blockIndex = 0;
  let lastProgressSentAt = 0;
  const PROGRESS_THROTTLE_MS = 500;

  while (i < totalToUpload) {
    blockIndex++;
    const chunkIds = cardIdsRows.slice(i, i + chunkSize).map(r => r.id_carte);
    if (chunkIds.length === 0) break;

    const placeholders = chunkIds.map(() => '?').join(',');
    let cards = [];
    try {
      cards = db.prepare(`SELECT * FROM t_cartes WHERE id_carte IN (${placeholders})`).all(...chunkIds);
    } catch (err) {
      parentPort.postMessage({ type: 'log', level: 'error', message: `Erreur SQLite bloc ${blockIndex} : ${err.message}` });
    }

    const validCards = [];
    for (const c of cards) {
      if (!allowInvalid && !isValidDate(c.date_de_naissance)) {
        // skipped
      } else {
        validCards.push(c);
      }
    }

    const chunkStart = Date.now();

    if (validCards.length > 0) {
      const mappedCards = validCards.map(c => ({
        sync_id: c.sync_id,
        noms: c.noms,
        prenoms: c.prenoms || '',
        date_naissance: c.date_de_naissance || null,
        lieu_naissance: c.lieu_de_naissance || null,
        num_secu: c.num_secu || null,
        lieu_enrolement: c.lieu_enrolement || null,
        contact: c.contact || null,
        rangement: c.rangement || null,
        statut: c.statut || 'EN STOCK',
        date_delivrance: c.date_delivrance || null,
        agent_distributeur: c.agent_distributeur || null,
        centre_retrait: c.centre_retrait || null,
        nom_retirant: c.nom_retirant || null,
        num_retirant: c.num_retirant || null,
        cle_doublon: c.cle_doublon || null,
        cle_doublon_flex: c.cle_doublon_flex || null,
        statut_physique: c.statut_physique || 'OK',
        id_site: c.site_id || 1,
        id_centre: c.centre_id || null,
        id_poste: c.poste_id || null,
        qr_code_data: c.qr_code_data || null,
        updated_at: c.updated_at || new Date().toISOString()
      }));

      try {
        const { error } = await supabase
          .from('t_cartes')
          .upsert(mappedCards, { onConflict: 'sync_id' });

        const chunkDuration = Date.now() - chunkStart;

        if (error) {
          parentPort.postMessage({ type: 'log', level: 'error', message: `ÉCHEC bloc ${blockIndex} en ${chunkDuration}ms : ${error.message}` });
        } else {
          parentPort.postMessage({ type: 'log', level: 'info', message: `Bloc ${blockIndex} OK — ${chunkDuration}ms — chunkSize=${chunkSize}` });

          try {
            const syncIds = validCards.map(c => c.sync_id);
            const placeholders = syncIds.map(() => '?').join(',');
            const updateStmt = db.prepare(`UPDATE t_cartes SET is_dirty = 0, synced_at = datetime('now') WHERE sync_id IN (${placeholders})`);
            db.transaction(() => {
              updateStmt.run(...syncIds);
            })();
          } catch (txErr) {
            parentPort.postMessage({ type: 'log', level: 'error', message: `Erreur SQLite locale bloc ${blockIndex} : ${txErr.message}` });
          }

          uploadedCount += validCards.length;

          if (chunkDuration < 500) {
            chunkSize = Math.min(chunkSize + 50, MAX_CHUNK_SIZE);
          } else if (chunkDuration > 1500) {
            chunkSize = Math.max(chunkSize - 50, MIN_CHUNK_SIZE);
          }
        }
      } catch (err) {
        parentPort.postMessage({ type: 'log', level: 'error', message: `Exception bloc ${blockIndex} : ${err.message}` });
      }
    } else {
      parentPort.postMessage({ type: 'log', level: 'warn', message: `Bloc ${blockIndex} ignoré : ${chunkIds.length} dates invalides.` });
    }

    const nowTs = Date.now();
    const progress = Math.min(Math.round(((i + chunkIds.length) / totalToUpload) * 100), 100);
    if (nowTs - lastProgressSentAt >= PROGRESS_THROTTLE_MS || progress >= 100) {
      lastProgressSentAt = nowTs;
      parentPort.postMessage({ type: 'progress', progress, uploadedCount, total: totalToUpload, chunkSize });
    }

    i += chunkIds.length;
  }

  parentPort.postMessage({ type: 'done', uploadedCount, message: `Synchronisation de masse terminée : ${uploadedCount} cartes traitées.` });
}

run().catch(err => {
  parentPort.postMessage({ type: 'error', error: err.message });
});
