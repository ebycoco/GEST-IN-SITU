// GEST-IN-SITU — Download Worker
// Effectue les écritures SQLite (INSERT/UPDATE) pour le téléchargement downstream
// dans un thread séparé pour ne JAMAIS bloquer le thread principal d'Electron.
//
// Protocole de communication (parentPort):
//   ← reçoit : { type: 'write-chunk', watermark, lastSyncId, cloudCards, siteId }
//   → envoie  : { type: 'chunk-done', processed, watermark, lastSyncId }
//   → envoie  : { type: 'error', message }
//   → envoie  : { type: 'log', level, message }

'use strict';
const { parentPort, workerData } = require('worker_threads');
const Database = require(workerData.sqlitePath);

let db = null;

// ─── Utilitaires ───────────────────────────────────────────────────────────

function log(level, message) {
  parentPort.postMessage({ type: 'log', level, message });
}

function cleanBirthDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const parts = s.split(/[\/\-\.]/);
  if (parts.length === 3) {
    if (parts[0].length === 4) return `${parts[0]}-${parts[1].padStart(2,'0')}-${parts[2].padStart(2,'0')}`;
    if (parts[2].length === 4) return `${parts[2]}-${parts[1].padStart(2,'0')}-${parts[0].padStart(2,'0')}`;
  }
  return s;
}

function normalizeContact(contact) {
  if (!contact) return null;
  const digits = String(contact).replace(/\D/g, '');
  return digits.length > 0 ? digits : null;
}

function getOrOpenDb() {
  if (!db) {
    db = new Database(workerData.dbPath, { timeout: 60000 });
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('busy_timeout = 60000');
    db.pragma('cache_size = -32000'); // 32MB cache
    db.pragma('temp_store = MEMORY');
    log('info', '[DownloadWorker] Base de données ouverte en mode WAL.');
  }
  return db;
}

// ─── Traitement d'un chunk ──────────────────────────────────────────────────

function processChunk({ cloudCards, watermark, lastSyncId, siteId }) {
  const database = getOrOpenDb();

  const selectStmt = database.prepare('SELECT id_carte, updated_at, is_dirty FROM t_cartes WHERE sync_id = ?');
  const insertStmt = database.prepare(`
    INSERT INTO t_cartes (
      noms, prenoms, date_de_naissance, lieu_de_naissance, num_secu,
      lieu_enrolement, contact, rangement, statut, date_delivrance,
      agent_saisie, nom_retirant, num_retirant, agent_distributeur,
      centre_retrait, cle_doublon, cle_doublon_flex, statut_physique,
      site_id, centre_id, poste_id, qr_code_data, sync_id,
      created_at, updated_at, synced_at, is_dirty
    ) VALUES (
      :noms, :prenoms, :date_de_naissance, :lieu_de_naissance, :num_secu,
      :lieu_enrolement, :contact, :rangement, :statut, :date_delivrance,
      :agent_saisie, :nom_retirant, :num_retirant, :agent_distributeur,
      :centre_retrait, :cle_doublon, :cle_doublon_flex, :statut_physique,
      :site_id, :centre_id, :poste_id, :qr_code_data, :sync_id,
      :created_at, :updated_at, :updated_at, 0
    )
  `);
  const updateStmt = database.prepare(`
    UPDATE t_cartes
    SET noms = :noms, prenoms = :prenoms, date_de_naissance = :date_de_naissance,
        lieu_de_naissance = :lieu_de_naissance, num_secu = :num_secu,
        lieu_enrolement = :lieu_enrolement, contact = :contact, rangement = :rangement,
        statut = :statut, date_delivrance = :date_delivrance, agent_saisie = :agent_saisie,
        nom_retirant = :nom_retirant, num_retirant = :num_retirant,
        agent_distributeur = :agent_distributeur, centre_retrait = :centre_retrait,
        cle_doublon = :cle_doublon, cle_doublon_flex = :cle_doublon_flex,
        statut_physique = :statut_physique, centre_id = :centre_id, poste_id = :poste_id,
        qr_code_data = :qr_code_data, updated_at = :updated_at, synced_at = :updated_at,
        is_dirty = 0
    WHERE id_carte = :idCarte
  `);
  const updateWatermarkStmt = database.prepare(`
    INSERT OR REPLACE INTO t_config (key, value) VALUES (?, ?)
  `);

  let processedCount = 0;
  let latestUpdatedAt = watermark;
  let latestSyncId = lastSyncId;

  // Désactivation temporaire des FK pendant la transaction (base fraîche / ordre d'arrivée)
  database.exec('PRAGMA foreign_keys = OFF;');
  try {
    database.transaction(() => {
      for (const card of cloudCards) {
        const syncId = card.sync_id;
        if (!syncId) continue;

        // Avancement du watermark
        if (card.updated_at && card.updated_at > latestUpdatedAt) {
          latestUpdatedAt = card.updated_at;
          latestSyncId = card.sync_id;
        } else if (card.updated_at === latestUpdatedAt && card.sync_id > latestSyncId) {
          latestSyncId = card.sync_id;
        }

        const localCard = selectStmt.get(syncId);

        if (!localCard) {
          // INSERT
          insertStmt.run({
            noms: card.noms,
            prenoms: card.prenoms || '',
            date_de_naissance: cleanBirthDate(card.date_naissance || card.date_de_naissance),
            lieu_de_naissance: card.lieu_naissance || card.lieu_de_naissance || null,
            num_secu: card.num_secu || null,
            lieu_enrolement: card.lieu_enrolement || null,
            contact: normalizeContact(card.contact),
            rangement: card.rangement || null,
            statut: card.statut || 'EN STOCK',
            date_delivrance: card.date_delivrance || null,
            agent_saisie: card.agent_saisie || null,
            nom_retirant: card.nom_retirant || null,
            num_retirant: card.num_retirant || null,
            agent_distributeur: card.agent_distributeur || null,
            centre_retrait: card.centre_retrait || null,
            cle_doublon: card.cle_doublon || null,
            cle_doublon_flex: card.cle_doublon_flex || null,
            statut_physique: card.statut_physique || 'OK',
            site_id: card.id_site || card.site_id ? Number(card.id_site || card.site_id) : null,
            centre_id: card.id_centre || card.centre_id || null,
            poste_id: card.id_poste || card.poste_id || null,
            qr_code_data: card.qr_code_data || null,
            sync_id: card.sync_id,
            created_at: card.created_at || new Date().toISOString(),
            updated_at: card.updated_at || new Date().toISOString()
          });
          processedCount++;
        } else if (localCard.is_dirty === 1) {
          // SKIP — carte modifiée localement, on protège le travail local
        } else {
          // UPDATE si la version Cloud est plus récente
          const localTime = new Date(localCard.updated_at || 0).getTime();
          const cloudTime = new Date(card.updated_at || 0).getTime();
          if (cloudTime > localTime) {
            updateStmt.run({
              idCarte: localCard.id_carte,
              noms: card.noms,
              prenoms: card.prenoms || '',
              date_de_naissance: cleanBirthDate(card.date_naissance || card.date_de_naissance),
              lieu_de_naissance: card.lieu_naissance || card.lieu_de_naissance || null,
              num_secu: card.num_secu || null,
              lieu_enrolement: card.lieu_enrolement || null,
              contact: normalizeContact(card.contact),
              rangement: card.rangement || null,
              statut: card.statut || 'EN STOCK',
              date_delivrance: card.date_delivrance || null,
              agent_saisie: card.agent_saisie || null,
              nom_retirant: card.nom_retirant || null,
              num_retirant: card.num_retirant || null,
              agent_distributeur: card.agent_distributeur || null,
              centre_retrait: card.centre_retrait || null,
              cle_doublon: card.cle_doublon || null,
              cle_doublon_flex: card.cle_doublon_flex || null,
              statut_physique: card.statut_physique || 'OK',
              centre_id: card.id_centre || card.centre_id || null,
              poste_id: card.id_poste || card.poste_id || null,
              qr_code_data: card.qr_code_data || null,
              updated_at: card.updated_at || new Date().toISOString()
            });
            processedCount++;
          }
        }
      }

      // Mise à jour du watermark DANS la transaction pour garantir la cohérence
      updateWatermarkStmt.run('last_downstream_sync', latestUpdatedAt);
      updateWatermarkStmt.run('last_downstream_sync_id', latestSyncId);
    })();
  } finally {
    database.exec('PRAGMA foreign_keys = ON;');
  }

  return { processed: processedCount, watermark: latestUpdatedAt, lastSyncId: latestSyncId };
}

// ─── Point d'entrée (messages du Main Thread) ────────────────────────────────

parentPort.on('message', (msg) => {
  if (msg.type === 'write-chunk') {
    try {
      const result = processChunk(msg);
      parentPort.postMessage({ type: 'chunk-done', ...result });
    } catch (err) {
      parentPort.postMessage({ type: 'error', message: err.message || String(err) });
    }
  } else if (msg.type === 'close') {
    if (db) {
      try { db.close(); } catch (_) {}
      db = null;
    }
    process.exit(0);
  }
});
