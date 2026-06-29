import log from 'electron-log';
import { getSupabaseClient } from './supabase-client';
import { getDatabase } from '../database/connection';

/**
 * Pousse en masse toutes les cartes modifiées (is_dirty = 1) d'un site vers Supabase.
 * Par paquets de 5000 pour préserver la mémoire et la bande passante.
 * Le processus est résumable : en cas d'interruption, les lignes déjà synchronisées
 * ont leur is_dirty passé à 0 et ne seront pas re-téléversées.
 */
export async function runBulkUpload(
  siteId: number,
  progressCallback: (progress: number) => void
): Promise<{ success: boolean; uploadedCount: number; message: string }> {
  const db = getDatabase()!;
  const CHUNK_SIZE = 5000;
  
  try {
    // 1. Calculer le total des cartes à synchroniser
    const totalRow = db.prepare(`
      SELECT COUNT(*) as count FROM t_cartes 
      WHERE site_id = ? AND is_dirty = 1
    `).get(siteId) as { count: number } | undefined;
    
    const totalToUpload = totalRow ? totalRow.count : 0;
    
    if (totalToUpload === 0) {
      progressCallback(100);
      return { success: true, uploadedCount: 0, message: 'Aucune donnée locale en attente de synchronisation.' };
    }

    log.info(`BulkUpload: Starting bulk upload of ${totalToUpload} cards for site ${siteId}...`);
    const supabase = getSupabaseClient();
    let uploadedCount = 0;

    while (true) {
      // 2. Récupérer un bloc de 5000 cartes modifiées
      // On utilise pas offset car is_dirty passera à 0 à chaque itération réussie (résumabilité naturelle)
      const cards = db.prepare(`
        SELECT * FROM t_cartes
        WHERE site_id = ? AND is_dirty = 1
        LIMIT ?
      `).all(siteId, CHUNK_SIZE) as any[];

      if (cards.length === 0) {
        break;
      }

      log.info(`BulkUpload: Preparing chunk of ${cards.length} cards...`);
      
      // Traduire les champs du format SQLite local vers le format PostgreSQL Supabase
      const mappedCards = cards.map(c => ({
        sync_id: c.sync_id,
        noms: c.noms,
        prenoms: c.prenoms || '',
        date_naissance: c.date_de_naissance || null, // SQLite date_de_naissance -> Postgres date_naissance
        lieu_naissance: c.lieu_de_naissance || null, // SQLite lieu_de_naissance -> Postgres lieu_naissance
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
        id_site: c.site_id || 1,                     // SQLite site_id -> Postgres id_site
        id_centre: c.centre_id || null,             // SQLite centre_id -> Postgres id_centre
        id_poste: c.poste_id || null,               // SQLite poste_id -> Postgres id_poste
        qr_code_data: c.qr_code_data || null,
        updated_at: c.updated_at || new Date().toISOString()
      }));

      // 3. Pousser vers Supabase
      const { error } = await supabase
        .from('t_cartes')
        .upsert(mappedCards, { onConflict: 'sync_id' });

      if (error) {
        throw new Error(`Cloud upsert chunk failure: ${error.message}`);
      }

      // 4. Mettre à jour SQLite localement (marquer is_dirty = 0) dans une transaction
      db.transaction(() => {
        const updateStmt = db.prepare(`
          UPDATE t_cartes
          SET is_dirty = 0, synced_at = datetime('now')
          WHERE sync_id = ?
        `);
        
        for (const card of cards) {
          updateStmt.run(card.sync_id);
        }
      })();

      uploadedCount += cards.length;
      
      // Notifier la progression
      const progress = Math.min(Math.round((uploadedCount / totalToUpload) * 100), 100);
      progressCallback(progress);
      log.info(`BulkUpload: Progress ${progress}% (${uploadedCount}/${totalToUpload})`);
    }

    log.info(`BulkUpload: Successfully completed bulk upload. ${uploadedCount} cards synchronized.`);
    return { success: true, uploadedCount, message: `Synchronisation de masse terminée : ${uploadedCount} cartes poussées.` };
  } catch (err: any) {
    log.error('BulkUpload: Fatal upload failure:', err);
    return { success: false, uploadedCount: 0, message: `Erreur lors de la synchronisation en masse : ${err.message || err}` };
  }
}
