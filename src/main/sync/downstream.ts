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
 */
export async function runDownstream(siteId: number): Promise<number> {
  const db = getDatabase()!;
  
  // 1. Récupération du watermark local dans t_config
  let watermark = '1970-01-01T00:00:00Z';
  const configRow = db.prepare("SELECT value FROM t_config WHERE key = 'last_downstream_sync'").get() as { value: string } | undefined;
  if (configRow && configRow.value) {
    watermark = configRow.value;
  }

  log.info(`Downstream: Fetching updates on t_cartes from Supabase since ${watermark} for site ${siteId}...`);
  const supabase = getSupabaseClient();

  // 2. Requête Supabase
  const { data: cloudCards, error } = await supabase
    .from('t_cartes')
    .select('*')
    .gt('updated_at', watermark)
    .eq('site_id', siteId)
    .order('updated_at', { ascending: true })
    .limit(500);

  if (error) {
    throw new Error(`Failed to fetch downstream updates: ${error.message}`);
  }

  if (!cloudCards || cloudCards.length === 0) {
    return 0;
  }

  log.info(`Downstream: Found ${cloudCards.length} updates on Cloud to merge.`);
  console.log("📥 [SYNC] Première carte brute reçue de Supabase :", cloudCards[0]);

  let processedCount = 0;
  let latestUpdatedAt = watermark;

  db.transaction(() => {
    for (const card of cloudCards) {
      const syncId = card.sync_id;
      if (!syncId) continue;

      // Conserver le timestamp de mise à jour pour faire progresser le watermark
      if (card.updated_at && card.updated_at > latestUpdatedAt) {
        latestUpdatedAt = card.updated_at;
      }

      // Chercher si la carte existe localement par son sync_id
      const localCard = db.prepare('SELECT * FROM t_cartes WHERE sync_id = ?').get(syncId) as any;

      if (!localCard) {
        // Cas A : La carte n'existe pas en local -> INSERT direct
        insertLocalCard(db, card);
        processedCount++;
      } else if (localCard.is_dirty === 0) {
        // Cas B : La carte existe en local et n'a pas été modifiée -> UPDATE direct
        updateLocalCard(db, localCard.id_carte, card);
        processedCount++;
      } else {
        // Cas C : ⚠️ CONFLIT (modifiée localement ET modifiée sur le cloud)
        resolveAndApplyConflict(db, localCard, card);
        processedCount++;
      }
    }

    // 4. Mettre à jour le watermark local
    db.prepare(`
      INSERT OR REPLACE INTO t_config (key, value)
      VALUES ('last_downstream_sync', ?)
    `).run(latestUpdatedAt);
  })();

  console.log(`✅ [SYNC SUCCESS] ${cloudCards.length} cartes enregistrées/fusionnées en local.`);

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

  return processedCount;
}

/**
 * Insertion brute en base de données locale (provenance Cloud).
 * Met is_dirty à 0 pour éviter de ré-expédier la ligne à l'upstream.
 */
function insertLocalCard(db: any, card: any): void {
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
    site_id: Number(card.site_id || card.siteId || 1),
    centre_id: card.centre_id || null,
    poste_id: card.poste_id || null,
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
function updateLocalCard(db: any, idCarte: number, card: any): void {
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
    centre_id: card.centre_id || null,
    poste_id: card.poste_id || null,
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
        centre_id: cloud.centre_id || null,
        poste_id: cloud.poste_id || null,
        qr_code_data: cloud.qr_code_data || null,
        updated_at: cloud.updated_at
      };
      resolvedBy = 'LWW (Cloud plus récent)';
    } else {
      resolvedBy = 'LWW (Local plus récent)';
    }
  }

  // Appliquer le résultat de la résolution en base locale avec is_dirty = 0 (guard anti-boucle)
  updateLocalCard(db, local.id_carte, {
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
