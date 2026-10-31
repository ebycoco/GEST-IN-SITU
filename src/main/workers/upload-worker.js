// GEST-IN-SITU Upload Worker
// Runs in a separate thread to avoid blocking the Electron UI during Supabase bulk upload
const { parentPort, workerData } = require('worker_threads');
const Database = require(workerData.sqlitePath);
const { createClient } = require('@supabase/supabase-js');
const { randomUUID } = require('crypto');

// ─── Bloc statut gardé par le cloud (correctif rouge 4 / A-02, étape 2) ─────────────
// DUPLICATION VOLONTAIRE de la logique de src/main/sync/outbox.service.ts
// (STATUS_BLOCK_COLUMNS, _normalizeStatusValue, _diffStatusBlock, _applyCloudStatusBlock) :
// ce worker est copié tel quel sans bundler (copyWorkerPlugin, electron.vite.config.ts) et ne
// peut pas importer le module TS. Tenir les deux copies (et supabase/migrations/0006) alignées.
const STATUS_BLOCK_COLUMNS = [
  'statut', 'date_delivrance', 'agent_distributeur', 'centre_retrait',
  'nom_retirant', 'num_retirant', 'contact_retirant', 'relation_retirant',
  'doublon_declare_par', 'doublon_declare_le', 'doublon_motif',
  'doublon_annule_par', 'doublon_annule_le', 'doublon_motif_annulation',
  'statut_avant_doublon',
  'apurement_correction_par', 'apurement_correction_le', 'apurement_correction_motif',
  'apurement_annulation_par', 'apurement_annulation_le', 'apurement_annulation_motif'
];
const CARD_UPSERT_RETURN_COLUMNS = ['sync_id', 'updated_at', ...STATUS_BLOCK_COLUMNS].join(',');

/** Forme comparable envoi/réponse (date_delivrance = seule colonne TIMESTAMPTZ du bloc). */
function normalizeStatusValue(column, value) {
  if (value === null || value === undefined || value === '') return null;
  const text = String(value);
  if (column !== 'date_delivrance') return text;
  let iso = text.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) iso += 'T00:00:00Z';
  else if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(iso) && !/(Z|[+-]\d{2}(:?\d{2})?)$/i.test(iso)) iso = iso.replace(' ', 'T') + 'Z';
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? text : `ts:${ms}`;
}

/**
 * Fonction pure : cartes du lot dont le bloc statut renvoyé par le cloud diffère de l'envoi.
 * @returns Map sync_id -> { sent, cloud, diff } (vide si pas de réponse ou aucun écart).
 */
function findStatusConflicts(sentRows, cloudRows) {
  const conflicts = new Map();
  if (!Array.isArray(cloudRows) || cloudRows.length === 0) return conflicts;
  const sentById = new Map(sentRows.map(r => [r.sync_id, r]));
  for (const cloud of cloudRows) {
    const sent = cloud && sentById.get(cloud.sync_id);
    if (!sent) continue;
    const diff = STATUS_BLOCK_COLUMNS.filter(c => (c in cloud) && normalizeStatusValue(c, sent[c]) !== normalizeStatusValue(c, cloud[c]));
    if (diff.length > 0) conflicts.set(cloud.sync_id, { sent, cloud, diff });
  }
  return conflicts;
}

/**
 * Applique le bloc gardé par le cloud à la carte locale (autres champs intacts), updated_at =
 * valeur cloud, is_dirty = 0, + une ligne t_logs CONFLIT_SYNC_STATUT locale (non mise en file,
 * le cloud trace déjà dans t_sync_conflicts). Appelée dans la transaction du lot.
 */
function applyCloudStatusBlock(db, { sent, cloud, diff }) {
  const columns = STATUS_BLOCK_COLUMNS.filter(c => c in cloud);
  const cloudUpdatedAt = typeof cloud.updated_at === 'string' && cloud.updated_at !== '' ? cloud.updated_at : null;
  db.prepare(`UPDATE t_cartes SET ${columns.map(c => `${c} = ?`).join(', ')}, updated_at = COALESCE(?, updated_at), is_dirty = 0, synced_at = datetime('now') WHERE sync_id = ? AND site_id = ?`)
    .run(...columns.map(c => (cloud[c] === undefined ? null : cloud[c])), cloudUpdatedAt, sent.sync_id, sent.id_site);

  const kept = { statut: cloud.statut ?? null };
  const rejected = { statut: sent.statut ?? null };
  for (const c of diff) {
    kept[c] = cloud[c] ?? null;
    rejected[c] = sent[c] ?? null;
  }
  const detail = `Conflit de synchronisation (carte ${sent.sync_id}) : le cloud a gardé le statut "${String(kept.statut)}" ` +
    `(envoyé : "${String(rejected.statut)}"). Champs du bloc statut repris du cloud : ${diff.join(', ')}.`;
  db.prepare(`
    INSERT INTO t_logs (id_user, login_user, action, detail, valeur_avant, valeur_apres, sync_id, is_dirty, site_id, centre_id)
    VALUES (NULL, 'SYSTEM', 'CONFLIT_SYNC_STATUT', ?, ?, ?, ?, 1, ?, ?)
  `).run(
    detail,
    JSON.stringify({ sync_id: sent.sync_id, ecarte: rejected }),
    JSON.stringify({ sync_id: sent.sync_id, garde: kept, updated_at: cloudUpdatedAt }),
    randomUUID(),
    sent.id_site,
    sent.id_centre ?? null
  );
}


// ─── Délai maximal par requête et arrêt sur réseau défaillant (audit agent-13 2026-10-31, P1-3) ───
// Sans délai, une requête vers un réseau qui se bloque après la garde d'alignement restait pendante
// jusqu'au délai TCP du système (~5 min mesurés) et le worker concluait quand même « terminé ».
const DEFAULT_REQUEST_TIMEOUT_MS = 60000;
const MAX_CONSECUTIVE_NETWORK_FAILURES = 2;
const NETWORK_ERROR_RE = /fetch failed|network|timeout|timed out|abort|ECONN|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|socket/i;

/** fetch avec délai maximal (fusionne le signal éventuel de l'appelant avec le délai). */
function makeTimedFetch(timeoutMs) {
  return (input, init = {}) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error(`Délai de ${timeoutMs} ms dépassé`)), timeoutMs);
    if (init.signal) {
      if (init.signal.aborted) controller.abort(init.signal.reason);
      else init.signal.addEventListener('abort', () => controller.abort(init.signal.reason), { once: true });
    }
    return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
  };
}

async function run() {
  const { siteId, centreId, dbPath, supabaseUrl, supabaseAnonKey, allowProbable, allowInvalid, allowMissing, onlyModified } = workerData;

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    },
    global: { fetch: makeTimedFetch(workerData.requestTimeoutMs || DEFAULT_REQUEST_TIMEOUT_MS) }
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

  // Exclut les cartes déjà prises en charge par le circuit standard t_outbox (ex: cartes
  // fusionnées par un import massif, voir import-worker.js) — évite un double envoi direct
  // hors-outbox par ce worker de synchronisation manuelle en masse.
  filterClause += `
    AND NOT EXISTS (
      SELECT 1 FROM t_outbox o
      WHERE o.table_name = 't_cartes' AND o.status = 'PENDING'
      AND o.id = t_cartes.sync_id
    )
  `;

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
  let failedBlocks = 0;
  let consecutiveNetworkFailures = 0;
  let networkAborted = false;

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
        apurement_correction_par: c.apurement_correction_par || null,
        apurement_correction_le: c.apurement_correction_le || null,
        apurement_correction_motif: c.apurement_correction_motif || null,
        apurement_annulation_par: c.apurement_annulation_par || null,
        apurement_annulation_le: c.apurement_annulation_le || null,
        apurement_annulation_motif: c.apurement_annulation_motif || null,
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
        // created_by : toujours null vers le cloud (id_user local jamais aligné sur l'id_user
        // Supabase, FK t_cartes_created_by_fkey) — même règle que payload-mapper.ts. Valeur locale inchangée.
        created_by: null,
        updated_at: pushedAt,
        // action_at : simple passager, jamais recalculé ici (contrairement à updated_at ci-dessus
        // qui est réécrit à pushedAt). Reflète la date réelle de l'action métier locale (posée par
        // cartes.queries.ts/absence.queries.ts au moment de la mutation) — voir migration V70
        // (schema.ts). NE PAS l'aligner sur pushedAt dans l'UPDATE local ligne ~301 : contrairement
        // à updated_at, action_at doit rester la valeur d'action locale d'origine, jamais réécrite
        // par un envoi réseau réussi.
        action_at: c.action_at || null
      }));

      try {
        // .select() (A-02 étape 2) : relit, pour chaque carte du lot, le bloc statut gardé par le
        // cloud (trigger trg_t_cartes_status_guard). Colonnes limitées au strict nécessaire ; la
        // réponse est bornée par la taille du lot (≤ MAX_CHUNK_SIZE) et libérée à la fin du tour.
        const { data: cloudRows, error } = await supabase
          .from('t_cartes')
          .upsert(mappedCards, { onConflict: 'sync_id' })
          .select(CARD_UPSERT_RETURN_COLUMNS);

        const chunkDuration = Date.now() - chunkStart;

        if (error) {
          parentPort.postMessage({ type: 'log', level: 'error', message: `ÉCHEC bloc ${blockIndex} en ${chunkDuration}ms : ${error.message}` });
          validCards.forEach(c => {
            failedSyncIds.set(c.sync_id, (failedSyncIds.get(c.sync_id) || 0) + 1);
          });
          failedBlocks++;
          consecutiveNetworkFailures = NETWORK_ERROR_RE.test(String(error.message)) ? consecutiveNetworkFailures + 1 : 0;
        } else {
          consecutiveNetworkFailures = 0;
          parentPort.postMessage({ type: 'log', level: 'info', message: `Bloc ${blockIndex} OK — ${chunkDuration}ms — chunkSize=${chunkSize}` });

          try {
            // updated_at local aligné sur pushedAt : évite un écart local/cloud qui
            // provoquerait une fusion inutile (mais inoffensive) lors d'un futur tirage
            // de cette même carte par ce poste ou un autre.
            // Cartes dont le bloc statut renvoyé par le cloud diffère de l'envoi (conflit arbitré
            // par le trigger) : elles prennent le bloc cloud au lieu de updated_at = pushedAt.
            // Sans trigger (prod actuelle), la réponse = l'envoi → aucune carte en conflit.
            const conflicts = findStatusConflicts(mappedCards, cloudRows);
            const syncIds = validCards.map(c => c.sync_id).filter(id => !conflicts.has(id));
            db.transaction(() => {
              if (syncIds.length > 0) {
                const placeholders = syncIds.map(() => '?').join(',');
                db.prepare(`UPDATE t_cartes SET is_dirty = 0, synced_at = datetime('now'), updated_at = ? WHERE sync_id IN (${placeholders})`)
                  .run(pushedAt, ...syncIds);
              }
              for (const conflict of conflicts.values()) {
                applyCloudStatusBlock(db, conflict);
              }
            })();
            if (conflicts.size > 0) {
              parentPort.postMessage({ type: 'log', level: 'warn', message: `Bloc ${blockIndex} : ${conflicts.size} carte(s) en conflit de statut, bloc statut du cloud appliqué localement (CONFLIT_SYNC_STATUT).` });
            }
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
        failedBlocks++;
        consecutiveNetworkFailures = NETWORK_ERROR_RE.test(String(err.message)) ? consecutiveNetworkFailures + 1 : 0;
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

    // Réseau défaillant : inutile d'attendre un délai par bloc restant, l'envoi s'arrête (les cartes non
    // envoyées restent is_dirty=1 et repartiront au prochain envoi).
    if (consecutiveNetworkFailures >= MAX_CONSECUTIVE_NETWORK_FAILURES && i < totalToUpload) {
      networkAborted = true;
      parentPort.postMessage({ type: 'log', level: 'error', message: `Envoi interrompu : ${consecutiveNetworkFailures} blocs consécutifs en échec réseau.` });
      break;
    }
  }

  if (networkAborted || (uploadedCount === 0 && failedBlocks > 0)) {
    const reason = networkAborted ? 'le réseau est devenu indisponible pendant l\'envoi' : 'aucun bloc n\'a pu être envoyé';
    parentPort.postMessage({
      type: 'done',
      success: false,
      uploadedCount,
      message: `Envoi interrompu : ${reason} (${uploadedCount} carte(s) envoyée(s), les autres restent à envoyer). Vérifiez la connexion et réessayez.`
    });
    return;
  }

  const failedNote = failedBlocks > 0 ? ` ${failedBlocks} bloc(s) en échec, à renvoyer.` : '';
  parentPort.postMessage({ type: 'done', uploadedCount, message: `Synchronisation de masse terminée : ${uploadedCount} cartes traitées.${failedNote}` });
}

run().catch(err => {
  parentPort.postMessage({ type: 'error', error: err.message });
});
