// GEST-IN-SITU Upload Worker
// Runs in a separate thread to avoid blocking the Electron UI during Supabase bulk upload
const { parentPort, workerData } = require('worker_threads');
const Database = require(workerData.sqlitePath);
const { createClient } = require('@supabase/supabase-js');


async function run() {
  const { siteId, centreId, dbPath, supabaseUrl, supabaseAnonKey, allowProbable, allowInvalid, allowMissing, onlyModified } = workerData;

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


  function isValidDateStrict(dateStr) {
    if (!dateStr) return false;
    const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return false;
    const year = parseInt(match[1], 10);
    const month = parseInt(match[2], 10);
    const day = parseInt(match[3], 10);
    const d = new Date(year, month - 1, day);
    return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day;
  }

  let filterClause = `
    WHERE site_id = ? 
  `;
  const queryParams = [siteId];

  if (centreId) {
    filterClause += ` AND centre_id = ? `;
    queryParams.push(centreId);
  }

  if (onlyModified) {
    filterClause += ` AND ((is_dirty = 1 AND synced_at IS NOT NULL AND synced_at != '') OR is_dirty = -1) AND statut != 'BROUILLON' `;
  } else {
    filterClause += ` AND (is_dirty = 1 OR is_dirty = -1 OR synced_at IS NULL OR synced_at = '') AND statut != 'BROUILLON' `;
  }

  filterClause += `
    AND NOT (
      (noms IS NULL OR noms = '') AND
      (prenoms IS NULL OR prenoms = '') AND
      (num_secu IS NULL OR num_secu = '') AND
      (rangement IS NULL OR rangement = '' OR rangement = 'NON CLASSE')
    )
  `;

  if (!allowProbable) {
    // Étape 1 : Exclure les doublons stricts
    filterClause += `
      AND (cle_doublon IS NULL OR cle_doublon = '' OR cle_doublon = '||||' OR cle_doublon NOT IN (
        SELECT cle_doublon FROM t_cartes 
        WHERE site_id = ? AND cle_doublon IS NOT NULL AND cle_doublon != '' AND cle_doublon != '||||'
        GROUP BY cle_doublon HAVING COUNT(*) > 1
      ))
    `;
    queryParams.push(siteId);

    // Étape 1 : Exclure les doublons probables
    filterClause += `
      AND (noms || '||' || prenoms || '||' || date_de_naissance) NOT IN (
        SELECT noms || '||' || prenoms || '||' || date_de_naissance FROM t_cartes
        WHERE site_id = ?
        GROUP BY noms, prenoms, date_de_naissance HAVING COUNT(DISTINCT cle_doublon) > 1
      )
    `;
    queryParams.push(siteId);
  }

  if (!allowMissing) {
    // Étape 1 : exclure les cartes avec des données critiques manquantes
    filterClause += `
      AND (noms IS NOT NULL AND noms != '')
      AND (prenoms IS NOT NULL AND prenoms != '')
      AND NOT (
        (noms IS NULL OR noms = '')
        AND (prenoms IS NULL OR prenoms = '')
        AND (date_de_naissance IS NULL OR date_de_naissance = '')
      )
      AND (rangement IS NOT NULL AND rangement != '' AND rangement != 'NON CLASSE')
    `;
  }

  if (!allowInvalid) {
    filterClause += `
      AND (date_de_naissance IS NULL OR date_de_naissance = '' OR date_de_naissance REGEXP '^\\d{4}-\\d{2}-\\d{2}$')
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
  const failedSyncIds = new Map();

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
    const deleteCards = [];
    for (const c of cards) {
      if ((failedSyncIds.get(c.sync_id) || 0) > 3) {
        continue; // skipped due to quarantine
      }
      if (c.is_dirty === -1) {
        deleteCards.push(c);
      } else if (!allowInvalid && !isValidDateStrict(c.date_de_naissance)) {
        // skipped
      } else {
        validCards.push(c);
      }
    }

    const chunkStart = Date.now();

    if (deleteCards.length > 0) {
      const deleteSyncIds = deleteCards.map(c => c.sync_id).filter(Boolean);
      try {
        let hasError = false;
        if (deleteSyncIds.length > 0) {
          const { error } = await supabase.from('t_cartes').delete().in('sync_id', deleteSyncIds);
          if (error) {
            parentPort.postMessage({ type: 'log', level: 'error', message: `ÉCHEC SUPPRESSION bloc ${blockIndex} : ${error.message}` });
            hasError = true;
          }
        }
        
        if (!hasError) {
          try {
            const deleteIds = deleteCards.map(c => c.id_carte);
            const placeholders = deleteIds.map(() => '?').join(',');
            const deleteStmt = db.prepare(`DELETE FROM t_cartes WHERE id_carte IN (${placeholders})`);
            db.transaction(() => { deleteStmt.run(...deleteIds); })();
            uploadedCount += deleteCards.length;
          } catch (txErr) {
            parentPort.postMessage({ type: 'log', level: 'error', message: `Erreur suppression locale bloc ${blockIndex} : ${txErr.message}` });
          }
        }
      } catch (e) {
        parentPort.postMessage({ type: 'log', level: 'error', message: `Erreur réseau suppression bloc ${blockIndex} : ${e.message}` });
      }
    }

    if (validCards.length > 0) {
      // Horodatage unique de ce lot, pris au moment RÉEL de l'envoi vers le cloud —
      // et non la date de dernière édition locale de la carte (c.updated_at). Le tirage
      // descendant (downstream) sur les autres postes se base sur updated_at pour savoir
      // ce qu'il reste à récupérer ; une carte "propre" corrigée puis classée il y a
      // plusieurs jours mais envoyée seulement maintenant doit porter un updated_at
      // d'AUJOURD'HUI pour être garantie détectable par tout autre poste, même si son
      // propre repère de tirage a déjà avancé au-delà de la date d'édition d'origine.
      const pushedAt = new Date().toISOString();
      // ATTENTION SYNCHRONISATION MANUELLE : ce mapping doit rester aligné avec
      // mapCardPayload() dans src/main/sync/payload-mapper.ts (et son homonyme
      // dans src/main/sync/upstream.ts). Ce fichier tourne dans un worker_threads
      // séparé, copié tel quel (copyFileSync, voir copyWorkerPlugin dans
      // electron.vite.config.ts) SANS passer par le bundler TypeScript — il ne
      // peut donc pas `require()`/`import` payload-mapper.ts directement (pas de
      // module .js compilé et adressable séparément pour ce fichier .ts, tout est
      // inliné dans le bundle unique dist/main/index.js). Une vraie source unique
      // partagée impliquerait d'extraire ce mapping dans un module .js pur, requis
      // à la fois par les workers et par le bundle TS, et de mettre à jour
      // copyWorkerPlugin pour le copier — un changement d'infrastructure de build
      // jugé disproportionné pour ce correctif ciblé sur une appli en prod active.
      // Tout ajout/retrait de champ carte->Supabase doit donc être répercuté
      // MANUELLEMENT dans les 3 endroits.
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
        agent_saisie: c.agent_saisie || null,
        agent_distributeur: c.agent_distributeur || null,
        centre_retrait: c.centre_retrait || null,
        nom_retirant: c.nom_retirant || null,
        num_retirant: c.num_retirant || null,
        contact_retirant: c.contact_retirant || null,
        relation_retirant: c.relation_retirant || null,
        cle_doublon: c.cle_doublon || null,
        cle_doublon_flex: c.cle_doublon_flex || null,
        doublon_declare_par: c.doublon_declare_par || null,
        doublon_declare_le: c.doublon_declare_le || null,
        doublon_motif: c.doublon_motif || null,
        statut_avant_doublon: c.statut_avant_doublon || null,
        doublon_annule_par: c.doublon_annule_par || null,
        doublon_annule_le: c.doublon_annule_le || null,
        doublon_motif_annulation: c.doublon_motif_annulation || null,
        statut_physique: c.statut_physique || 'OK',
        agent_signalement_absence: c.agent_signalement_absence || null,
        date_signalement_absence: c.date_signalement_absence || null,
        date_resolution_absence: c.date_resolution_absence || null,
        agent_resolution_absence: c.agent_resolution_absence || null,
        note_resolution: c.note_resolution || null,
        note_signalement_absence: c.note_signalement_absence || null,
        escalade_niveau: c.escalade_niveau || 'CENTRE',
        has_invalid_date: c.has_invalid_date ?? 0,
        notif_lue: c.notif_lue ?? 1,
        id_site: c.site_id || 1,
        id_centre: c.centre_id || null,
        id_poste: c.poste_id || null,
        qr_code_data: c.qr_code_data || null,
        is_exported: c.is_exported || 0,
        created_by: c.created_by || null,
        updated_at: pushedAt
      }));

      try {
        const { error } = await supabase
          .from('t_cartes')
          .upsert(mappedCards, { onConflict: 'sync_id' });

        const chunkDuration = Date.now() - chunkStart;

        if (error) {
          parentPort.postMessage({ type: 'log', level: 'error', message: `ÉCHEC bloc ${blockIndex} en ${chunkDuration}ms : ${error.message}` });
          validCards.forEach(c => {
            failedSyncIds.set(c.sync_id, (failedSyncIds.get(c.sync_id) || 0) + 1);
          });
        } else {
          parentPort.postMessage({ type: 'log', level: 'info', message: `Bloc ${blockIndex} OK — ${chunkDuration}ms — chunkSize=${chunkSize}` });

          try {
            // updated_at local aligné sur pushedAt : évite un écart local/cloud qui
            // provoquerait une fusion inutile (mais inoffensive) lors d'un futur tirage
            // de cette même carte par ce poste ou un autre.
            const syncIds = validCards.map(c => c.sync_id);
            const placeholders = syncIds.map(() => '?').join(',');
            const updateStmt = db.prepare(`UPDATE t_cartes SET is_dirty = 0, synced_at = datetime('now'), updated_at = ? WHERE sync_id IN (${placeholders})`);
            db.transaction(() => {
              updateStmt.run(pushedAt, ...syncIds);
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
