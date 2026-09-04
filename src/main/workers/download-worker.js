// GEST-IN-SITU — Download Worker
// Effectue les écritures SQLite (INSERT/UPDATE) pour le téléchargement downstream
// dans un thread séparé pour ne JAMAIS bloquer le thread principal d'Electron.
//
// Protocole de communication (parentPort):
//   ← reçoit : { type: 'write-chunk', watermark, lastSyncId, cloudCards, siteId, myCentreId }
//     (myCentreId : centre_id de l'utilisateur connecté, résolu côté thread principal via
//     getSecureCurrentUser() — CLAUDE.md §3, le worker n'y a structurellement pas accès)
//   → envoie  : { type: 'chunk-done', processed, insertedCount, updatedCount,
//                 insertedInMyCentreCount, watermark, lastSyncId, insertedLabels }
//     (insertedLabels : libellés bornés — max 6, {noms,prenoms,rangement,sync_id,isNew} — des
//     cartes réellement insérées/mises à jour dans ce chunk, pour la notification
//     granulaire par carte côté renderer, voir downstream.ts CARDS_NOTIFICATION_THRESHOLD.
//     insertedCount/updatedCount/insertedInMyCentreCount : compteurs exacts NON plafonnés,
//     contrairement à insertedLabels qui reste borné à CARDS_LABEL_CAP.)
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

// Priorité métier des statuts : un statut plus avancé ne doit jamais régresser
// (ex: une carte DELIVRE ne doit jamais redevenir EN STOCK suite à un pull).
const STATUT_PRIORITY = { 'EN STOCK': 1, 'DELIVRE': 2, 'ANNULE': 3 };

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

function processChunk({ cloudCards, watermark, lastSyncId, siteId, myCentreId }) {
  const database = getOrOpenDb();

  const selectStmt = database.prepare('SELECT id_carte, updated_at, is_dirty, statut FROM t_cartes WHERE sync_id = ?');
  const insertStmt = database.prepare(`
    INSERT INTO t_cartes (
      noms, prenoms, date_de_naissance, lieu_de_naissance, num_secu,
      lieu_enrolement, contact, rangement, statut, date_delivrance,
      agent_saisie, nom_retirant, num_retirant, agent_distributeur,
      centre_retrait, cle_doublon, cle_doublon_flex, statut_physique,
      agent_signalement_absence, date_signalement_absence, note_signalement_absence,
      escalade_niveau, has_invalid_date, contact_retirant, relation_retirant,
      date_resolution_absence, agent_resolution_absence, note_resolution,
      doublon_declare_par, doublon_declare_le, doublon_motif, statut_avant_doublon,
      doublon_annule_par, doublon_annule_le, doublon_motif_annulation,
      apurement_correction_par, apurement_correction_le, apurement_correction_motif,
      apurement_annulation_par, apurement_annulation_le, apurement_annulation_motif,
      site_id, centre_id, poste_id, qr_code_data, sync_id,
      created_at, updated_at, action_at, synced_at, is_dirty
    ) VALUES (
      :noms, :prenoms, :date_de_naissance, :lieu_de_naissance, :num_secu,
      :lieu_enrolement, :contact, :rangement, :statut, :date_delivrance,
      :agent_saisie, :nom_retirant, :num_retirant, :agent_distributeur,
      :centre_retrait, :cle_doublon, :cle_doublon_flex, :statut_physique,
      :agent_signalement_absence, :date_signalement_absence, :note_signalement_absence,
      :escalade_niveau, :has_invalid_date, :contact_retirant, :relation_retirant,
      :date_resolution_absence, :agent_resolution_absence, :note_resolution,
      :doublon_declare_par, :doublon_declare_le, :doublon_motif, :statut_avant_doublon,
      :doublon_annule_par, :doublon_annule_le, :doublon_motif_annulation,
      :apurement_correction_par, :apurement_correction_le, :apurement_correction_motif,
      :apurement_annulation_par, :apurement_annulation_le, :apurement_annulation_motif,
      :site_id, :centre_id, :poste_id, :qr_code_data, :sync_id,
      :created_at, :updated_at, :action_at, :updated_at, 0
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
        qr_code_data = :qr_code_data, updated_at = :updated_at, action_at = :action_at, synced_at = :updated_at,
        agent_signalement_absence = :agent_signalement_absence,
        date_signalement_absence = :date_signalement_absence,
        note_signalement_absence = :note_signalement_absence,
        escalade_niveau = :escalade_niveau, has_invalid_date = :has_invalid_date,
        contact_retirant = :contact_retirant, relation_retirant = :relation_retirant,
        date_resolution_absence = :date_resolution_absence,
        agent_resolution_absence = :agent_resolution_absence,
        note_resolution = :note_resolution,
        doublon_declare_par = :doublon_declare_par, doublon_declare_le = :doublon_declare_le,
        doublon_motif = :doublon_motif, statut_avant_doublon = :statut_avant_doublon,
        doublon_annule_par = :doublon_annule_par, doublon_annule_le = :doublon_annule_le,
        doublon_motif_annulation = :doublon_motif_annulation,
        apurement_correction_par = :apurement_correction_par, apurement_correction_le = :apurement_correction_le,
        apurement_correction_motif = :apurement_correction_motif,
        apurement_annulation_par = :apurement_annulation_par, apurement_annulation_le = :apurement_annulation_le,
        apurement_annulation_motif = :apurement_annulation_motif,
        is_dirty = 0
    WHERE id_carte = :idCarte
  `);
  // Fusion partielle appliquée à une carte localement dirty : n'adopte QUE le statut
  // (et les champs de délivrance associés, ainsi que les champs du cycle de signalement
  // d'absence/escalade qui voyagent avec le statut) du cloud quand il est plus avancé,
  // sans toucher aux autres champs en cours de correction locale ni à is_dirty (la fiche
  // reste marquée à renvoyer pour ses propres modifications).
  // action_at DÉLIBÉRÉMENT EXCLU de cette fusion partielle (contrairement à insertStmt et
  // updateStmt ci-dessus) : cette fiche reste is_dirty=1 côté local, donc porteuse d'une
  // action métier locale plus récente que ce que le cloud connaît. Adopter le action_at cloud
  // ici écraserait la valeur d'action locale par une valeur potentiellement obsolète ou déjà
  // polluée par un envoi antérieur — reproduirait, à un niveau supérieur, le bug d'origine
  // (fix e3a7005) que action_at a précisément pour but de corriger. updated_at n'est pas non
  // plus inclus ici pour la même raison (fusion partielle historique, comportement inchangé).
  const statusMergeStmt = database.prepare(`
    UPDATE t_cartes
    SET statut = :statut, date_delivrance = :date_delivrance,
        agent_distributeur = :agent_distributeur, centre_retrait = :centre_retrait,
        nom_retirant = :nom_retirant, num_retirant = :num_retirant,
        agent_signalement_absence = :agent_signalement_absence,
        date_signalement_absence = :date_signalement_absence,
        note_signalement_absence = :note_signalement_absence,
        escalade_niveau = :escalade_niveau, has_invalid_date = :has_invalid_date,
        contact_retirant = :contact_retirant, relation_retirant = :relation_retirant,
        date_resolution_absence = :date_resolution_absence,
        agent_resolution_absence = :agent_resolution_absence,
        note_resolution = :note_resolution,
        doublon_declare_par = :doublon_declare_par, doublon_declare_le = :doublon_declare_le,
        doublon_motif = :doublon_motif, statut_avant_doublon = :statut_avant_doublon,
        doublon_annule_par = :doublon_annule_par, doublon_annule_le = :doublon_annule_le,
        doublon_motif_annulation = :doublon_motif_annulation,
        apurement_correction_par = :apurement_correction_par, apurement_correction_le = :apurement_correction_le,
        apurement_correction_motif = :apurement_correction_motif,
        apurement_annulation_par = :apurement_annulation_par, apurement_annulation_le = :apurement_annulation_le,
        apurement_annulation_motif = :apurement_annulation_motif
    WHERE id_carte = :idCarte
  `);
  const updateWatermarkStmt = database.prepare(`
    INSERT OR REPLACE INTO t_config (key, value) VALUES (?, ?)
  `);

  let processedCount = 0;
  let latestUpdatedAt = watermark;
  let latestSyncId = lastSyncId;

  // Libellés bornés (seuil de notification granulaire côté renderer, voir downstream.ts
  // CARDS_NOTIFICATION_THRESHOLD/CARDS_LABEL_CAP) des cartes réellement insérées/mises à
  // jour dans CE chunk. Plafonné à CARDS_LABEL_CAP quel que soit le volume du chunk (jusqu'à
  // 500) — politique low-memory (§2 CLAUDE.md) : jamais la liste complète d'un gros chunk.
  const CARDS_LABEL_CAP = 6;
  const insertedLabels = [];
  function pushLabel(card, isNew) {
    if (insertedLabels.length < CARDS_LABEL_CAP) {
      insertedLabels.push({
        noms: card.noms || '',
        prenoms: card.prenoms || '',
        rangement: card.rangement || null,
        sync_id: card.sync_id,
        isNew: !!isNew
      });
    }
  }

  // Compteurs exacts NON plafonnés (coût mémoire nul, contrairement aux labels bornés
  // ci-dessus) — voir en-tête de fichier pour la sémantique de chaque compteur.
  let insertedCount = 0;
  let updatedCount = 0;
  let insertedInMyCentreCount = 0;

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
            agent_signalement_absence: card.agent_signalement_absence || null,
            date_signalement_absence: card.date_signalement_absence || null,
            note_signalement_absence: card.note_signalement_absence || null,
            escalade_niveau: card.escalade_niveau || 'CENTRE',
            has_invalid_date: card.has_invalid_date ?? 0,
            contact_retirant: card.contact_retirant || null,
            relation_retirant: card.relation_retirant || null,
            date_resolution_absence: card.date_resolution_absence || null,
            agent_resolution_absence: card.agent_resolution_absence || null,
            note_resolution: card.note_resolution || null,
            doublon_declare_par: card.doublon_declare_par || null,
            doublon_declare_le: card.doublon_declare_le || null,
            doublon_motif: card.doublon_motif || null,
            statut_avant_doublon: card.statut_avant_doublon || null,
            doublon_annule_par: card.doublon_annule_par || null,
            doublon_annule_le: card.doublon_annule_le || null,
            doublon_motif_annulation: card.doublon_motif_annulation || null,
            apurement_correction_par: card.apurement_correction_par || null,
            apurement_correction_le: card.apurement_correction_le || null,
            apurement_correction_motif: card.apurement_correction_motif || null,
            apurement_annulation_par: card.apurement_annulation_par || null,
            apurement_annulation_le: card.apurement_annulation_le || null,
            apurement_annulation_motif: card.apurement_annulation_motif || null,
            site_id: card.id_site || card.site_id ? Number(card.id_site || card.site_id) : null,
            centre_id: card.id_centre || card.centre_id || null,
            poste_id: card.id_poste || card.poste_id || null,
            qr_code_data: card.qr_code_data || null,
            sync_id: card.sync_id,
            created_at: card.created_at || new Date().toISOString(),
            updated_at: card.updated_at || new Date().toISOString(),
            action_at: card.action_at || null
          });
          processedCount++;
          insertedCount++;
          if (myCentreId != null && Number(card.id_centre || card.centre_id) === Number(myCentreId)) {
            insertedInMyCentreCount++;
          }
          pushLabel(card, true);
        } else if (localCard.is_dirty === 1) {
          // Carte modifiée localement (non encore renvoyée) : on protège les champs
          // en cours de correction, MAIS on adopte quand même un statut cloud plus
          // avancé pour éviter qu'un envoi ultérieur de cette fiche ne renvoie un
          // statut périmé et n'écrase une délivrance déjà enregistrée ailleurs.
          const localScore = STATUT_PRIORITY[localCard.statut] || 1;
          const cloudScore = STATUT_PRIORITY[card.statut] || 1;
          if (cloudScore > localScore) {
            statusMergeStmt.run({
              idCarte: localCard.id_carte,
              statut: card.statut,
              date_delivrance: card.date_delivrance || null,
              agent_distributeur: card.agent_distributeur || null,
              centre_retrait: card.centre_retrait || null,
              nom_retirant: card.nom_retirant || null,
              num_retirant: card.num_retirant || null,
              agent_signalement_absence: card.agent_signalement_absence || null,
              date_signalement_absence: card.date_signalement_absence || null,
              note_signalement_absence: card.note_signalement_absence || null,
              escalade_niveau: card.escalade_niveau || 'CENTRE',
              has_invalid_date: card.has_invalid_date ?? 0,
              contact_retirant: card.contact_retirant || null,
              relation_retirant: card.relation_retirant || null,
              date_resolution_absence: card.date_resolution_absence || null,
              agent_resolution_absence: card.agent_resolution_absence || null,
              note_resolution: card.note_resolution || null,
              doublon_declare_par: card.doublon_declare_par || null,
              doublon_declare_le: card.doublon_declare_le || null,
              doublon_motif: card.doublon_motif || null,
              statut_avant_doublon: card.statut_avant_doublon || null,
              doublon_annule_par: card.doublon_annule_par || null,
              doublon_annule_le: card.doublon_annule_le || null,
              doublon_motif_annulation: card.doublon_motif_annulation || null,
              apurement_correction_par: card.apurement_correction_par || null,
              apurement_correction_le: card.apurement_correction_le || null,
              apurement_correction_motif: card.apurement_correction_motif || null,
              apurement_annulation_par: card.apurement_annulation_par || null,
              apurement_annulation_le: card.apurement_annulation_le || null,
              apurement_annulation_motif: card.apurement_annulation_motif || null
            });
            processedCount++;
            updatedCount++;
            pushLabel(card, false);
          }
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
              agent_signalement_absence: card.agent_signalement_absence || null,
              date_signalement_absence: card.date_signalement_absence || null,
              note_signalement_absence: card.note_signalement_absence || null,
              escalade_niveau: card.escalade_niveau || 'CENTRE',
              has_invalid_date: card.has_invalid_date ?? 0,
              contact_retirant: card.contact_retirant || null,
              relation_retirant: card.relation_retirant || null,
              date_resolution_absence: card.date_resolution_absence || null,
              agent_resolution_absence: card.agent_resolution_absence || null,
              note_resolution: card.note_resolution || null,
              doublon_declare_par: card.doublon_declare_par || null,
              doublon_declare_le: card.doublon_declare_le || null,
              doublon_motif: card.doublon_motif || null,
              statut_avant_doublon: card.statut_avant_doublon || null,
              doublon_annule_par: card.doublon_annule_par || null,
              doublon_annule_le: card.doublon_annule_le || null,
              doublon_motif_annulation: card.doublon_motif_annulation || null,
              apurement_correction_par: card.apurement_correction_par || null,
              apurement_correction_le: card.apurement_correction_le || null,
              apurement_correction_motif: card.apurement_correction_motif || null,
              apurement_annulation_par: card.apurement_annulation_par || null,
              apurement_annulation_le: card.apurement_annulation_le || null,
              apurement_annulation_motif: card.apurement_annulation_motif || null,
              centre_id: card.id_centre || card.centre_id || null,
              poste_id: card.id_poste || card.poste_id || null,
              qr_code_data: card.qr_code_data || null,
              updated_at: card.updated_at || new Date().toISOString(),
              action_at: card.action_at || null
            });
            processedCount++;
            updatedCount++;
            pushLabel(card, false);
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

  return {
    processed: processedCount,
    insertedCount,
    updatedCount,
    insertedInMyCentreCount,
    watermark: latestUpdatedAt,
    lastSyncId: latestSyncId,
    insertedLabels
  };
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
