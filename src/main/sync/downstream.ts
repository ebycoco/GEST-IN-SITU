import log from 'electron-log';
import { getSupabaseClient } from './supabase-client';
import { getDatabase } from '../database/connection';
import { logAction } from '../database/queries';
import { BrowserWindow } from 'electron';
import { v4 as uuidv4 } from 'uuid';

function cleanBirthDate(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;
  const cleanStr = dateStr.trim().toLowerCase();

  // 1. Si c'est déjà au format ISO parfait (YYYY-MM-DD), on le retourne directement
  if (/^\d{4}-\d{2}-\d{2}$/.test(cleanStr)) return cleanStr;

  // 2. CAS DU FORMAT STANDARD : JJ/MM/AAAA ou JJ-MM-AAAA purement numérique
  if (/^\d{1,2}[\/\s-]\d{1,2}[\/\s-]\d{4}$/.test(cleanStr)) {
    const parts = cleanStr.split(/[\/\s-]+/);
    const day = parts[0].padStart(2, '0');
    const month = parts[1].padStart(2, '0');
    const year = parts[2];
    return `${year}-${month}-${day}`;
  }

  // 3. CAS DU FORMAT LITTÉRAL ABRÉGÉ : ex "1-févr.-1997", "27-dc.-1997", "25-sept.-1998"
  // Nettoyage des points (ex: sept. -> sept) et découpage par les tirets/espaces
  const normalizedLiteral = cleanStr.replace(/\./g, '');
  const partsLiteral = normalizedLiteral.split(/[- ]+/);

  if (partsLiteral.length === 3) {
    const day = partsLiteral[0].padStart(2, '0');
    let monthToken = partsLiteral[1].toLowerCase();
    let year = partsLiteral[2];

    // TECHNIQUE DE SÉCURITÉ : On nettoie les caractères corrompus d'encodage
    if (monthToken.includes('jan')) monthToken = 'janv';
    else if (monthToken.startsWith('f')) monthToken = 'fevr'; // Février est le SEUL mois qui commence par 'f'
    else if (monthToken.includes('mar')) monthToken = 'mars';
    else if (monthToken.startsWith('av')) monthToken = 'avr'; // Avril commence par 'av'
    else if (monthToken.includes('mai')) monthToken = 'mai';
    else if (monthToken.includes('jui') && monthToken.includes('n')) monthToken = 'juin';
    else if (monthToken.includes('jui')) monthToken = 'juil';
    else if (monthToken.startsWith('a')) monthToken = 'aout'; // Août commence par 'a' (et se distingue d'avril)
    else if (monthToken.includes('sep')) monthToken = 'sept';
    else if (monthToken.includes('oct')) monthToken = 'oct';
    else if (monthToken.startsWith('n')) monthToken = 'nov';  // Novembre est le SEUL mois qui commence par 'n'
    else if (monthToken.includes('d') || monthToken.includes('c')) monthToken = 'dec'; // Décembre (déc, dc, etc.)

    const frenchMonths: { [key: string]: string } = {
      'janv': '01', 'fevr': '02', 'mars': '03', 'avr': '04', 'mai': '05', 'juin': '06',
      'juil': '07', 'aout': '08', 'sept': '09', 'oct': '10', 'nov': '11', 'dec': '12'
    };

    if (frenchMonths[monthToken]) {
      const month = frenchMonths[monthToken];
      if (year.length === 2) {
        year = parseInt(year) > 30 ? `19${year}` : `20${year}`;
      }
      return `${year}-${month}-${day}`;
    }
  }

  // Si aucun pattern ne matche, on renvoie la chaîne brute pour éviter de perdre la donnée
  return dateStr;
}

function normalizeContact(contactStr: string | null | undefined): string {
  if (!contactStr) return '+225 00 00 00 00 00';
  
  // 1. Extraire uniquement les caractères numériques
  let digits = contactStr.toString().replace(/\D/g, '');

  // 2. Isoler le numéro local ivoirien à 10 chiffres
  let localNumber = '';

  if (digits.startsWith('225')) {
    // Si ça commence par 225, le numéro local est ce qui suit
    localNumber = digits.slice(3);
  } else {
    // Sinon, on considère que toute la chaîne est le numéro local
    localNumber = digits;
  }

  // 3. Sécurité : Si le numéro local ne fait pas exactement 10 chiffres, on renvoie le format vide de sécurité
  if (localNumber.length !== 10) {
    return '+225 00 00 00 00 00';
  }

  // 4. Découper le numéro local à 10 chiffres en blocs de 2 (XX XX XX XX XX)
  const part1 = localNumber.slice(0, 2);
  const part2 = localNumber.slice(2, 4);
  const part3 = localNumber.slice(4, 6);
  const part4 = localNumber.slice(6, 8);
  const part5 = localNumber.slice(8, 10);

  // 5. Retourner le format international standardisé propre
  return `+225 ${part1} ${part2} ${part3} ${part4} ${part5}`;
}

/**
 * Récupère les données depuis Supabase modifiées après le watermark et les intègre localement.
 * Réalise la résolution de conflit (Pilier 4) et évite les boucles infinies.
 * Conformément à la Section 9, cette opération s'exécute par lots (chunks) de 500 maximum,
 * libérant périodiquement la RAM et le thread principal via un délai d'attente asynchrone.
 */
export async function runDownstream(siteId: number, force: boolean = false): Promise<number> {
  if (!siteId || isNaN(Number(siteId))) {
    throw new Error("siteId invalide ou manquant.");
  }

  const supabase = getSupabaseClient();
  const db = getDatabase()!;

  // 1. TÉLÉCHARGER ET STOCKER LE SITE COURANT (t_sites)
  try {
    log.info(`[SYNC] Rapatriement du site courant (${siteId}) depuis Supabase...`);
    const { data: siteDataList, error: siteError } = await supabase
      .from('t_sites')
      .select('id, nom, code, is_active, max_centres, created_at, sync_id')
      .eq('id', siteId);

    if (siteError || !siteDataList || siteDataList.length === 0) {
      log.warn(`[SYNC] Site ${siteId} non trouvé ou erreur de requête.`, siteError ? siteError.message : "Aucune donnée");
      return 0;
    }
    const siteData = siteDataList[0];

    db.prepare(`
      INSERT OR REPLACE INTO t_sites (id, nom, code, is_active, max_centres, created_at, sync_id)
      VALUES (@id, @nom, @code, @is_active, @max_centres, @created_at, @sync_id)
    `).run({
      id: siteData.id,
      nom: siteData.nom,
      code: siteData.code,
      is_active: siteData.is_active !== undefined ? siteData.is_active : 1,
      max_centres: siteData.max_centres || 4,
      created_at: siteData.created_at || new Date().toISOString(),
      sync_id: siteData.sync_id || null
    });
    log.info(`[SYNC] Site ${siteId} ("${siteData.nom}") mis à jour localement avec succès.`);
  } catch (err: any) {
    log.error(`[SYNC] Exception lors de la synchronisation du site courant :`, err.message || err);
    return 0;
  }

  // 2. TÉLÉCHARGER ET STOCKER LES CENTRES ASSOCIÉS (t_centres)
  // Indispensable pour éviter la violation de clé étrangère centre_id sur t_cartes
  try {
    log.info(`[SYNC] Rapatriement des centres opérationnels pour le site ${siteId} depuis Supabase...`);
    const { data: centresData, error: centresError } = await supabase
      .from('t_centres')
      .select('id, site_id, nom, numero, created_at, sync_id, prefixe_rangement, code, lieu')
      .eq('site_id', siteId);

    if (centresError) {
      log.error(`[SYNC] Impossible de récupérer les centres du site ${siteId} :`, centresError.message);
    } else if (centresData && centresData.length > 0) {
      db.transaction(() => {
        const insertCentreStmt = db.prepare(`
          INSERT OR REPLACE INTO t_centres (id, site_id, nom, numero, created_at, sync_id, prefixe_rangement, code, lieu)
          VALUES (@id, @site_id, @nom, @numero, @created_at, @sync_id, @prefixe_rangement, @code, @lieu)
        `);
        for (const c of centresData) {
          insertCentreStmt.run({
            id: c.id,
            site_id: c.site_id,
            nom: c.nom,
            numero: c.numero,
            created_at: c.created_at || new Date().toISOString(),
            sync_id: c.sync_id || null,
            prefixe_rangement: c.prefixe_rangement || null,
            code: c.code || null,
            lieu: c.lieu || null
          });
        }
      })();
      log.info(`[SYNC] ${centresData.length} centres assurés localement pour le site ${siteId}.`);
    }
  } catch (err: any) {
    log.error(`[SYNC] Exception lors de la synchronisation des centres :`, err.message || err);
  }

  let totalMerged = 0;
  let hasMore = true;

  log.info(`[SYNC] Démarrage du pull pour site : ${siteId}`);
  log.info(`Downstream: Starting full sync for site ${siteId} in Low-Memory chunked mode (Force: ${force}).`);

  while (hasMore) {
    const chunkProcessed = await runDownstreamChunk(siteId, force);
    totalMerged += chunkProcessed;

    if (chunkProcessed < 500) {
      hasMore = false;
    } else {
      log.info(`Downstream: Chunk of 500 processed. Yielding CPU & RAM...`);
      // Pause asynchrone de 50ms pour laisser respirer Windows et le garbage collector (Sec 9)
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }

  log.info(`Downstream: Sync completed. Total merged: ${totalMerged} records.`);
  return totalMerged;
}

/**
 * Traite un unique lot (chunk) de 500 cartes maximum de Supabase.
 */
async function runDownstreamChunk(siteId: number, force: boolean = false): Promise<number> {
  const db = getDatabase()!;
  
  // 1. Récupération du watermark local dans t_config
  let watermark = '1970-01-01T00:00:00Z';
  if (!force) {
    const configRow = db.prepare("SELECT value FROM t_config WHERE key = 'last_downstream_sync'").get() as { value: string } | undefined;
    if (configRow && configRow.value) {
      watermark = configRow.value;
    }
  }

  log.info(`Downstream Chunk: Fetching updates on t_cartes from Supabase since ${watermark} for site ${siteId}...`);
  log.info(`⏳ [SUPABASE] Récupération des cartes modifiées pour le site ${siteId}...`);
  const supabase = getSupabaseClient();

  // 2. Requête Supabase avec AbortController et Timeout de 10 secondes
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, 10000);

  let cloudCards: any[] | null = null;
  try {
    const { data, error } = await supabase
      .from('t_cartes')
      .select('*')
      .gt('updated_at', watermark)
      .eq('id_site', siteId)
      .order('updated_at', { ascending: true })
      .limit(500)
      .abortSignal(controller.signal);

    clearTimeout(timeoutId);

    if (error) {
      log.error(`❌ [SUPABASE] Échec de la récupération des cartes pour le site ${siteId} : ${error.message}`);
      throw new Error(`Failed to fetch downstream updates: ${error.message}`);
    }
    cloudCards = data;
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError' || err.message?.includes('aborted') || controller.signal.aborted) {
      log.warn("⚠️ [SUPABASE] Requête downstream interrompue : Timeout de 10s dépassé. Passage en mode dégradé.");
      log.warn(`[SUPABASE] Downstream timeout for site ${siteId}. Aborted. Passing in degraded mode.`);
      return 0; // Mode dégradé : on retourne 0 carte traitée sans crasher
    }
    throw err;
  }

  log.info(`✅ [SUPABASE] ${cloudCards?.length || 0} cartes récupérées avec succès depuis le cloud.`);

  if (!cloudCards || cloudCards.length === 0) {
    return 0;
  }

  log.info(`Downstream Chunk: Found ${cloudCards.length} updates on Cloud to merge.`);

  let processedCount = 0;
  let latestUpdatedAt = watermark;

  // Préparation des requêtes SQL une seule fois hors transaction/boucle pour éviter les compiles répétitifs
  const selectStmt = db.prepare('SELECT * FROM t_cartes WHERE sync_id = ?');
  const insertStmt = db.prepare(`
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
  const updateStmt = db.prepare(`
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
  const updateWatermarkStmt = db.prepare(`
    INSERT OR REPLACE INTO t_config (key, value)
    VALUES ('last_downstream_sync', ?)
  `);

  // ─── FILET DE SÉCURITÉ FK (t_cartes) ────────────────────────────────────────
  // Désactivation temporaire des contraintes de clés étrangères le temps de la
  // transaction downstream. Au premier démarrage, Supabase renvoie des centre_id /
  // poste_id qui ne sont pas encore dans t_centres / t_postes locaux (base fraîche).
  // Sans ce guard, SQLite lève un FOREIGN KEY constraint failed fatal.
  // La réactivation est garantie dans le bloc finally, même en cas d'exception.
  // ─────────────────────────────────────────────────────────────────────────────
  db.exec('PRAGMA foreign_keys = OFF;');
  try {
    db.transaction(() => {
      for (const card of cloudCards) {
        const syncId = card.sync_id;
        if (!syncId) continue;

        // Conserver le timestamp de mise à jour pour faire progresser le watermark
        if (card.updated_at && card.updated_at > latestUpdatedAt) {
          latestUpdatedAt = card.updated_at;
        }

        // Chercher si la carte existe localement par son sync_id (Requête compilée réutilisée)
        const localCard = selectStmt.get(syncId) as any;

        if (!localCard) {
          // Cas A : La carte n'existe pas en local -> INSERT direct (Requête compilée réutilisée)
          insertLocalCard(insertStmt, card);
          processedCount++;
        } else if (localCard.is_dirty === 1) {
          // Cas B : Si la carte existe mais a 'is_dirty === 1' ➡️ SKIP (on protège le travail local)
          log.info(`[SYNC PULL] Skip de la carte ${syncId} car elle est modifiée localement (is_dirty = 1).`);
        } else {
          // Cas C : Si la carte existe et n'est pas modifiée ➡️ UPDATE uniquement si 'updated_at' du Cloud est strictement supérieur au 'updated_at' local
          const localTime = new Date(localCard.updated_at || 0).getTime();
          const cloudTime = new Date(card.updated_at || 0).getTime();

          if (cloudTime > localTime) {
            // Requête compilée réutilisée
            updateLocalCard(updateStmt, localCard.id_carte, card);
            processedCount++;
          }
        }
      }

      // 4. Mettre à jour le watermark local (Requête compilée réutilisée)
      updateWatermarkStmt.run(latestUpdatedAt);
    })();
  } finally {
    // Réactivation inconditionnelle des contraintes FK après la transaction
    db.exec('PRAGMA foreign_keys = ON;');
  }

  log.info(`✅ [SYNC SUCCESS] ${cloudCards.length} cartes enregistrées/fusionnées en local.`);

  if (processedCount > 0) {
    try {
      db.prepare(`
        INSERT INTO t_logs (id_user, login_user, action, detail, valeur_apres, sync_id, is_dirty, site_id)
        VALUES (NULL, 'SYSTEM', 'SYNC_UPDATE', ?, '{"read": false}', ?, 1, ?)
      `).run(`${processedCount} cartes synchronisées depuis le Cloud.`, uuidv4(), siteId);

      const windows = BrowserWindow.getAllWindows();
      if (windows.length > 0) {
        windows[0].webContents.send('sync:updated-data', {
          count: processedCount
        });
      }
    } catch (err) {
      log.error('Failed to record downstream update notification:', err);
    }
  }

  return cloudCards.length;
}

/**
 * Insertion brute en base de données locale (provenance Cloud).
 * Met is_dirty à 0 pour éviter de ré-expédier la ligne à l'upstream.
 */
function insertLocalCard(insertStmt: any, card: any): void {
  insertStmt.run({
    noms: card.noms,
    prenoms: card.prenoms || '',
    date_de_naissance: cleanBirthDate(card.date_naissance || card.date_de_naissance), // Supabase utilise date_naissance ou date_de_naissance
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
    site_id: Number(card.id_site || card.site_id || card.siteId || 1),
    centre_id: card.id_centre || card.centre_id || null,
    poste_id: card.id_poste || card.poste_id || null,
    qr_code_data: card.qr_code_data || null,
    sync_id: card.sync_id,
    created_at: card.created_at || new Date().toISOString(),
    updated_at: card.updated_at || new Date().toISOString()
  });
}

/**
 * Mise à jour locale (provenance Cloud).
 * Met is_dirty à 0 pour éviter de ré-expédier la ligne à l'upstream.
 */
function updateLocalCard(updateStmt: any, idCarte: number, card: any): void {
  updateStmt.run({
    idCarte,
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
}

/**
 * Pilier 4 : Résolution de conflit et application
 */
function resolveAndApplyConflict(db: any, local: any, cloud: any): void {
  const statutScores: Record<string, number> = { 'EN STOCK': 1, 'DELIVRE': 2, 'ANNULE': 3 };
  
  const localStatutScore = statutScores[local.statut] || 1;
  const cloudStatutScore = statutScores[cloud.statut] || 1;

  let resolvedCard = { ...local };
  let resolvedBy = '';

  // Règle 1 : Règle métier sur le statut le plus avancé
  if (cloudStatutScore > localStatutScore) {
    resolvedCard.statut = cloud.statut;
    resolvedCard.date_delivrance = cloud.date_delivrance;
    resolvedCard.nom_retirant = cloud.nom_retirant;
    resolvedCard.num_retirant = cloud.num_retirant;
    resolvedCard.agent_distributeur = cloud.agent_distributeur;
    resolvedCard.centre_retrait = cloud.centre_retrait;
    resolvedBy = 'Règle métier (Statut Cloud plus avancé)';
  } else if (localStatutScore > cloudStatutScore) {
    // Le statut local gagne, on garde nos infos de livraison
    resolvedBy = 'Règle métier (Statut Local plus avancé)';
  } else {
    // Règle 2 : Last-Write-Wins sur updated_at local vs cloud
    const localTime = new Date(local.updated_at || 0).getTime();
    const cloudTime = new Date(cloud.updated_at || 0).getTime();

    if (cloudTime > localTime) {
      // Le cloud est plus récent, on fusionne les champs
      resolvedCard = {
        ...local,
        noms: cloud.noms,
        prenoms: cloud.prenoms || '',
        date_de_naissance: cloud.date_naissance || null,
        lieu_de_naissance: cloud.lieu_naissance || null,
        num_secu: cloud.num_secu || null,
        lieu_enrolement: cloud.lieu_enrolement || null,
        contact: cloud.contact || null,
        rangement: cloud.rangement || null,
        statut_physique: cloud.statut_physique || 'OK',
        centre_id: cloud.id_centre || cloud.centre_id || null,
        poste_id: cloud.id_poste || cloud.poste_id || null,
        qr_code_data: cloud.qr_code_data || null,
        updated_at: cloud.updated_at
      };
      resolvedBy = 'LWW (Cloud plus récent)';
    } else {
      resolvedBy = 'LWW (Local plus récent)';
    }
  }

  // Appliquer le résultat de la résolution en base locale avec is_dirty = 0 (guard anti-boucle)
  const updateStmt = db.prepare(`
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

  updateLocalCard(updateStmt, local.id_carte, {
    noms: resolvedCard.noms,
    prenoms: resolvedCard.prenoms,
    date_naissance: resolvedCard.date_de_naissance,
    lieu_naissance: resolvedCard.lieu_de_naissance,
    num_secu: resolvedCard.num_secu,
    lieu_enrolement: resolvedCard.lieu_enrolement,
    contact: resolvedCard.contact,
    rangement: resolvedCard.rangement,
    statut: resolvedCard.statut,
    date_delivrance: resolvedCard.date_delivrance,
    agent_saisie: resolvedCard.agent_saisie,
    nom_retirant: resolvedCard.nom_retirant,
    num_retirant: resolvedCard.num_retirant,
    agent_distributeur: resolvedCard.agent_distributeur,
    centre_retrait: resolvedCard.centre_retrait,
    cle_doublon: resolvedCard.cle_doublon,
    cle_doublon_flex: resolvedCard.cle_doublon_flex,
    statut_physique: resolvedCard.statut_physique,
    centre_id: resolvedCard.centre_id,
    poste_id: resolvedCard.poste_id,
    qr_code_data: resolvedCard.qr_code_data,
    updated_at: resolvedCard.updated_at || new Date().toISOString()
  });

  // Enregistrer le conflit résolu dans l'historique de logs
  logAction(
    0, 
    'SYSTEM', 
    'SYNC_CONFLIT', 
    `Conflit résolu sur carte sync_id ${local.sync_id}. Méthode : ${resolvedBy}. Avant : ${JSON.stringify({statut: local.statut, rangement: local.rangement})}, Après : ${JSON.stringify({statut: resolvedCard.statut, rangement: resolvedCard.rangement})}`
  );
}

/**
 * Télécharge proactivement tous les utilisateurs actifs rattachés à ce site
 * depuis Supabase et les insère localement en SQLite.
 */
export async function syncUsersFromCloud(siteId: number): Promise<number> {
  const db = getDatabase()!;
  const supabase = getSupabaseClient();

  log.info(`Downstream: Synchronisation préliminaire du site ${siteId} depuis Supabase...`);
  
  // --- ÉTAPE PRÉALABLE : SÉCURISATION DU PARENT (t_sites) ---
  try {
    const { data: siteDataList, error: siteError } = await supabase
      .from('t_sites')
      .select('id, nom, code, is_active, max_centres, created_at, sync_id')
      .eq('id', siteId);

    if (siteError || !siteDataList || siteDataList.length === 0) {
      log.warn(`[syncUsersFromCloud] Site parent ${siteId} non trouvé ou erreur de requête.`, siteError ? siteError.message : "Aucune donnée");
      return 0;
    }
    const siteData = siteDataList[0];

    db.prepare(`
      INSERT OR REPLACE INTO t_sites (id, nom, code, is_active, max_centres, created_at, sync_id)
      VALUES (@id, @nom, @code, @is_active, @max_centres, @created_at, @sync_id)
    `).run({
      id: siteData.id,
      nom: siteData.nom,
      code: siteData.code,
      is_active: siteData.is_active !== undefined ? siteData.is_active : 1,
      max_centres: siteData.max_centres || 4,
      created_at: siteData.created_at || new Date().toISOString(),
      sync_id: siteData.sync_id || null
    });
    log.info(`[syncUsersFromCloud] Site parent ${siteId} assuré localement.`);
  } catch (err: any) {
    log.error(`[syncUsersFromCloud] Exception lors de la sécurisation du site parent ${siteId} :`, err.message || err);
    return 0;
  }

  log.info(`Downstream: Synchronisation des utilisateurs pour le site ${siteId} depuis Supabase...`);
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, 10000);

  let cloudUsers: any[] | null = null;
  try {
    const { data, error } = await supabase
      .from('t_users')
      .select('login, password_hash, role, nom_user, prenom_user, site_id, centre_id, sync_id, statut_actif')
      .eq('site_id', siteId)
      .eq('statut_actif', 1)
      .abortSignal(controller.signal);

    clearTimeout(timeoutId);

    if (error) {
      log.error(`Downstream error on syncUsersFromCloud: ${error.message}`);
      return 0;
    }
    cloudUsers = data;
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError' || err.message?.includes('aborted') || controller.signal.aborted) {
      log.warn(`[SUPABASE] syncUsersFromCloud timeout for site ${siteId}. Aborted. Passing in degraded mode.`);
      return 0;
    }
    log.error(`Downstream error on syncUsersFromCloud exception: ${err.message || err}`);
    return 0;
  }

  if (!cloudUsers || cloudUsers.length === 0) {
    log.warn(`[syncUsersFromCloud] Supabase a retourné 0 utilisateur pour le site ${siteId}. Vérifier les politiques RLS sur t_users et le filtrage site_id.`);
    log.warn(`⚠️ [SUPABASE] 0 utilisateur reçu pour le site ${siteId}. Vérifier les règles RLS Supabase sur la table t_users.`);
    return 0;
  }

  // ── Garde de validation des rôles autorisés (identiques à la contrainte CHECK SQLite) ──
  const validRoles = [
    'SUPER ADMIN', 'ADMINISTRATEUR_SITE', 'ADMIN_CENTRE',
    'OPERATEUR_VERIFICATION', 'OPERATEUR_QUALITE', 'OPERATEUR_SAISIE',
    'OPERATEUR_LOGISTIQUE', 'OPERATEUR_INVENTAIRE'
  ];

  // ─── FILET DE SÉCURITÉ FK (t_users) ─────────────────────────────────────────
  // Même logique que pour t_cartes : un utilisateur Supabase peut référencer un
  // site_id ou centre_id absent de t_sites / t_centres locaux (base fraîche).
  // Le PRAGMA OFF/finally garantit que la FK ne bloque pas et est toujours réactivée.
  // ─────────────────────────────────────────────────────────────────────────────
  let count = 0;
  db.exec('PRAGMA foreign_keys = OFF;');
  try {
    db.transaction(() => {
      // INSERT ... ON CONFLICT DO UPDATE : met à jour le password_hash et les infos
      // si le compte existe déjà localement, au lieu de l'ignorer silencieusement.
      const insertStmt = db.prepare(`
        INSERT INTO t_users 
          (login, password_hash, role, nom_user, prenom_user, statut_actif, site_id, centre_id, sync_id, is_dirty)
        VALUES 
          (@login, @password_hash, @role, @nom_user, @prenom_user, 1, @site_id, @centre_id, @sync_id, 0)
        ON CONFLICT(login) DO UPDATE SET
          password_hash = excluded.password_hash,
          role          = excluded.role,
          nom_user      = excluded.nom_user,
          prenom_user   = excluded.prenom_user,
          statut_actif  = excluded.statut_actif,
          centre_id     = excluded.centre_id,
          sync_id       = COALESCE(t_users.sync_id, excluded.sync_id),
          is_dirty      = 0,
          synced_at     = datetime('now')
      `);

      for (const u of cloudUsers) {
        // Validation stricte du rôle avant toute tentative d'insertion (évite le crash SQLite silencieux)
        if (!validRoles.includes(u.role)) {
          log.warn(`[syncUsersFromCloud] Rôle invalide ignoré pour "${u.login}": "${u.role}". Rôles acceptés : ${validRoles.join(', ')}.`);
          log.warn(`⚠️ [SYNC] Compte "${u.login}" ignoré : rôle Supabase "${u.role}" non reconnu par l'application.`);
          continue;
        }

        const result = insertStmt.run({
          login: u.login,
          password_hash: u.password_hash,
          role: u.role,
          nom_user: u.nom_user || '',
          prenom_user: u.prenom_user || '',
          site_id: u.site_id,
          centre_id: u.centre_id || null,
          sync_id: u.sync_id
        });
        if (result.changes > 0) count++;
      }
    })();
  } finally {
    // Réactivation inconditionnelle des contraintes FK après la transaction
    db.exec('PRAGMA foreign_keys = ON;');
  }

  if (count > 0) {
    log.info(`Downstream: ${count} utilisateur(s) inséré(s)/mis à jour depuis Supabase pour le site ${siteId}.`);
  } else {
    log.info(`Downstream: Aucun nouveau compte à insérer ou mettre à jour pour le site ${siteId} (déjà à jour).`);
  }
  return count;
}

/**
 * Pré-charge tous les utilisateurs depuis Supabase et les insère/met à jour
 * localement via un INSERT OR REPLACE.
 */
export async function preloadUsersFromCloud(): Promise<void> {
  log.info('Preload: Rapatriement en tâche de fond de tous les utilisateurs depuis Supabase...');
  log.info("📥 [SUPABASE] Tentative de préchargement des utilisateurs depuis le cloud...");
  try {
    const db = getDatabase();
    if (!db) {
      log.warn('Preload: Base de données non initialisée, impossible de pré-charger les utilisateurs.');
      return;
    }
    const supabase = getSupabaseClient();

    // --- ÉTAPE PRÉALABLE : RÉCUPÉRATION DE TOUS LES SITES ---
    // On télécharge d'abord tous les sites pour éviter les violations de clés étrangères
    // sur site_id pour n'importe quel compte utilisateur inséré.
    try {
      log.info('Preload: Rapatriement préliminaire de tous les sites depuis Supabase...');
      const { data: sitesData, error: sitesError } = await supabase
        .from('t_sites')
        .select('id, nom, code, is_active, max_centres, created_at, sync_id');

      if (sitesError) {
        log.error('Preload: Impossible de pré-charger les sites parents :', sitesError.message);
      } else if (sitesData && sitesData.length > 0) {
        db.transaction(() => {
          const insertSiteStmt = db.prepare(`
            INSERT OR REPLACE INTO t_sites (id, nom, code, is_active, max_centres, created_at, sync_id)
            VALUES (@id, @nom, @code, @is_active, @max_centres, @created_at, @sync_id)
          `);
          for (const s of sitesData) {
            insertSiteStmt.run({
              id: s.id,
              nom: s.nom,
              code: s.code,
              is_active: s.is_active !== undefined ? s.is_active : 1,
              max_centres: s.max_centres || 4,
              created_at: s.created_at || new Date().toISOString(),
              sync_id: s.sync_id || null
            });
          }
        })();
        log.info(`Preload: ${sitesData.length} sites parents assurés localement.`);
      }
    } catch (siteErr: any) {
      log.error('Preload: Exception lors de la récupération préliminaire des sites parents :', siteErr.message || siteErr);
    }

    // --- ÉTAPE PRÉALABLE 2 : RÉCUPÉRATION DE TOUS LES CENTRES ---
    // De même, on charge tous les centres pour t_centres avant d'insérer les utilisateurs
    // qui pourraient référencer un centre_id.
    try {
      log.info('Preload: Rapatriement préliminaire de tous les centres depuis Supabase...');
      const { data: centresData, error: centresError } = await supabase
        .from('t_centres')
        .select('id, site_id, nom, numero, created_at, sync_id, prefixe_rangement, code, lieu');

      if (centresError) {
        log.error('Preload: Impossible de pré-charger les centres parents :', centresError.message);
      } else if (centresData && centresData.length > 0) {
        db.transaction(() => {
          const insertCentreStmt = db.prepare(`
            INSERT OR REPLACE INTO t_centres (id, site_id, nom, numero, created_at, sync_id, prefixe_rangement, code, lieu)
            VALUES (@id, @site_id, @nom, @numero, @created_at, @sync_id, @prefixe_rangement, @code, @lieu)
          `);
          for (const c of centresData) {
            insertCentreStmt.run({
              id: c.id,
              site_id: c.site_id,
              nom: c.nom,
              numero: c.numero,
              created_at: c.created_at || new Date().toISOString(),
              sync_id: c.sync_id || null,
              prefixe_rangement: c.prefixe_rangement || null,
              code: c.code || null,
              lieu: c.lieu || null
            });
          }
        })();
        log.info(`Preload: ${centresData.length} centres parents assurés localement.`);
      }
    } catch (centreErr: any) {
      log.error('Preload: Exception lors de la récupération préliminaire des centres parents :', centreErr.message || centreErr);
    }
    
    const { data: cloudUsers, error } = await supabase
      .from('t_users')
      .select('login, password_hash, role, nom_user, prenom_user, email, telephone, statut_actif, site_id, centre_id, poste_id, avatar_url, last_login, created_at, updated_at, sync_id');

    if (error) {
      log.error(`Preload error querying t_users on Supabase: ${error.message}`);
      log.error(`❌ [SUPABASE] Échec du préchargement des utilisateurs : ${error.message}`);
      return;
    }

    if (!cloudUsers || cloudUsers.length === 0) {
      log.warn('Preload: Supabase a retourné 0 utilisateur. Si des comptes existent bien sur Supabase, vérifier les politiques RLS (Row Level Security) sur la table t_users — elles peuvent filtrer les résultats sans générer d\'erreur visible.');
      log.warn('⚠️ [SUPABASE] La table t_users renvoie 0 ligne. Si des comptes existent sur Supabase, vérifier les règles RLS (Row Level Security) : une politique trop restrictive renvoie [] sans erreur.');
      return;
    }

    log.info(`📥 [SUPABASE] ${cloudUsers.length} utilisateurs récupérés avec succès depuis le cloud.`);

    db.exec('PRAGMA foreign_keys = OFF;');
    try {
      db.transaction(() => {
        const insertOrReplaceStmt = db.prepare(`
          INSERT OR REPLACE INTO t_users (
            login, password_hash, role, nom_user, prenom_user, email, telephone, 
            statut_actif, site_id, centre_id, poste_id, avatar_url, last_login, 
            created_at, updated_at, sync_id, is_dirty
          ) VALUES (
            @login, @password_hash, @role, @nom_user, @prenom_user, @email, @telephone, 
            @statut_actif, @site_id, @centre_id, @poste_id, @avatar_url, @last_login, 
            @created_at, @updated_at, @sync_id, 0
          )
        `);

        // Validation des rôles également dans preload pour éviter les violations de contrainte CHECK
        const validRolesPreload = [
          'SUPER ADMIN', 'ADMINISTRATEUR_SITE', 'ADMIN_CENTRE',
          'OPERATEUR_VERIFICATION', 'OPERATEUR_QUALITE', 'OPERATEUR_SAISIE',
          'OPERATEUR_LOGISTIQUE', 'OPERATEUR_INVENTAIRE'
        ];

        for (const u of cloudUsers) {
          if (!validRolesPreload.includes(u.role)) {
            log.warn(`[preloadUsersFromCloud] Rôle invalide ignoré pour "${u.login}": "${u.role}".`);
            log.warn(`⚠️ [PRELOAD] Compte "${u.login}" ignoré : rôle "${u.role}" non reconnu.`);
            continue;
          }
          insertOrReplaceStmt.run({
            login: u.login,
            password_hash: u.password_hash,
            role: u.role,
            nom_user: u.nom_user || null,
            prenom_user: u.prenom_user || null,
            email: u.email || null,
            telephone: u.telephone || null,
            statut_actif: u.statut_actif !== undefined ? u.statut_actif : 1,
            site_id: u.site_id !== undefined && u.site_id !== null ? u.site_id : 1,
            centre_id: u.centre_id || null,
            poste_id: u.poste_id || null,
            avatar_url: u.avatar_url || null,
            last_login: u.last_login || null,
            created_at: u.created_at || null,
            updated_at: u.updated_at || null,
            sync_id: u.sync_id || null
          });
        }
      })();
      log.info(`Preload: ${cloudUsers.length} utilisateurs synchronisés (INSERT OR REPLACE) avec succès.`);
    } finally {
      db.exec('PRAGMA foreign_keys = ON;');
      log.info('Preload: Contraintes de clés étrangères (foreign_keys) réactivées.');
    }
  } catch (err: any) {
    log.error('Preload: Exception attrapée lors de la synchronisation des utilisateurs (mode hors-ligne ou erreur réseau) :', err.message || err);
  }
}

