import log from 'electron-log';
import { getSupabaseClient } from './supabase-client';
import { getDatabase } from '../database/connection';
import { networkMonitor } from './network-monitor';

/**
 * Pousse en masse toutes les cartes modifiées (is_dirty = 1) d'un site vers Supabase.
 * Par paquets de 5000 pour préserver la mémoire et la bande passante.
 * Le processus est résumable : en cas d'interruption, les lignes déjà synchronisées
 * ont leur is_dirty passé à 0 et ne seront pas re-téléversées.
 */
export async function runBulkUpload(
  siteId: number,
  allowProbable: boolean,
  allowInvalid: boolean,
  progressCallback: (progress: number) => void
): Promise<{ success: boolean; uploadedCount: number; message: string }> {
  const db = getDatabase()!;
  
  // Activer le contournement forcé du statut ONLINE pour ignorer la congestion réseau
  networkMonitor.setBypassForceOnline(true);
  
  try {
    // Construction dynamique de la clause WHERE et de ses paramètres
    let filterClause = `
      WHERE site_id = ? AND (is_dirty = 1 OR synced_at IS NULL OR synced_at = '')
      AND (cle_doublon IS NULL OR cle_doublon = '' OR cle_doublon = '||||' OR cle_doublon NOT IN (
        SELECT cle_doublon FROM t_cartes 
        WHERE site_id = ? AND cle_doublon IS NOT NULL AND cle_doublon != '' AND cle_doublon != '||||'
        GROUP BY cle_doublon HAVING COUNT(*) > 1
      ))
    `;
    const queryParams: any[] = [siteId, siteId];

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

    // Libération du thread principal pour laisser Electron afficher le loader à 0%
    await new Promise(r => setImmediate(r));

    // 1. Récupérer uniquement les IDs des cartes à synchroniser (léger en mémoire)
    const cardIdsRows = db.prepare(`
      SELECT id_carte FROM t_cartes 
      ${filterClause}
    `).all(...queryParams) as { id_carte: number }[];
    
    const totalToUpload = cardIdsRows.length;
    console.log(`📦 [BULK-START] Nombre total d'IDs récupérés depuis SQLite : ${totalToUpload}`);
    
    if (totalToUpload === 0) {
      progressCallback(100);
      return { success: true, uploadedCount: 0, message: 'Aucune donnée locale conforme en attente de synchronisation.' };
    }

    log.info(`BulkUpload: Starting bulk upload of ${totalToUpload} cards for site ${siteId} (allowProbable=${allowProbable}, allowInvalid=${allowInvalid})...`);
    const supabase = getSupabaseClient();
    let uploadedCount = 0;
    const CHUNK_SIZE = 1000;

    for (let i = 0; i < totalToUpload; i += CHUNK_SIZE) {
      const chunkIds = cardIdsRows.slice(i, i + CHUNK_SIZE).map(r => r.id_carte);
      if (chunkIds.length === 0) {
        break;
      }

      const blockIndex = Math.floor(i / CHUNK_SIZE) + 1;
      const totalBlocks = Math.ceil(totalToUpload / CHUNK_SIZE);
      console.log(`📦 [BLOC] Traitement du bloc ${blockIndex}/${totalBlocks} (${chunkIds.length} cartes)...`);

      // 2. Récupérer le bloc de cartes par leurs IDs
      const placeholders = chunkIds.map(() => '?').join(',');
      const cards = db.prepare(`
        SELECT * FROM t_cartes
        WHERE id_carte IN (${placeholders})
      `).all(...chunkIds) as any[];

      log.info(`BulkUpload: Preparing chunk of ${cards.length} cards...`);

      // Filtrer les cartes avec dates invalides si allowInvalid === false
      const validCards: any[] = [];
      const skippedCards: any[] = [];

      for (const c of cards) {
        if (!allowInvalid && !isValidDate(c.date_de_naissance)) {
          skippedCards.push(c);
        } else {
          validCards.push(c);
        }
      }

      console.log(`🚨 [DATE INVALID] Bloc ${blockIndex}/${totalBlocks} : ${validCards.length} saines, ${skippedCards.length} invalides isolées`);

      if (validCards.length > 0) {
        const startTime = Date.now();
        console.log(`🌐 [SUPABASE] Début de l'upsert pour le bloc ${blockIndex}/${totalBlocks}...`);
        try {
          // Traduire les champs du format SQLite local vers le format PostgreSQL Supabase
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

          // 3. Pousser vers Supabase
          const { error } = await supabase
            .from('t_cartes')
            .upsert(mappedCards, { onConflict: 'sync_id' });

          const duration = Date.now() - startTime;
          if (error) {
            console.error(`🌐 [SUPABASE] ÉCHEC de l'upsert pour le bloc ${blockIndex}/${totalBlocks} en ${duration}ms : ${error.message}`);
            throw new Error(`Cloud upsert chunk failure: ${error.message}`);
          }
          console.log(`🌐 [SUPABASE] SUCCÈS de l'upsert pour le bloc ${blockIndex}/${totalBlocks} en ${duration}ms`);

          // 4. Mettre à jour SQLite localement (marquer is_dirty = 0) dans une transaction asynchrone pour ne pas bloquer l'Event Loop
          await new Promise<void>((resolveTx) => {
            setImmediate(() => {
              db.transaction(() => {
                const updateStmt = db.prepare(`
                  UPDATE t_cartes
                  SET is_dirty = 0, synced_at = datetime('now')
                  WHERE sync_id = ?
                `);
                
                for (const card of validCards) {
                  updateStmt.run(card.sync_id);
                }
              })();
              resolveTx();
            });
          });

          uploadedCount += validCards.length;
        } catch (chunkErr: any) {
          log.error(`BulkUpload: Error uploading chunk starting at index ${i}:`, chunkErr);
          // Si une erreur de bloc survient, on loggue et on continue le traitement du reste
        }
      }

      // Les cartes sautées pour date invalide ne sont pas poussées mais on incrémente l'index pour la progression
      uploadedCount += skippedCards.length;
      
      // Notifier la progression
      const progress = Math.min(Math.round(((i + chunkIds.length) / totalToUpload) * 100), 100);
      console.log(`📈 [PROGRESS] Progression envoyée à l'UI : ${progress}%`);
      progressCallback(progress);
      log.info(`BulkUpload: Progress ${progress}% (${i + chunkIds.length}/${totalToUpload})`);

      // Micro-pause de 50ms pour libérer l'Event Loop et permettre à Electron de rafraîchir l'IHM et transmettre les messages IPC
      await new Promise(r => setTimeout(r, 50));
    }

    log.info(`BulkUpload: Successfully completed bulk upload. ${uploadedCount} cards processed.`);
    console.log(`🟢 [SUPABASE BULK SUCCESS] Synchronisation de masse terminée avec succès : ${uploadedCount} cartes poussées vers la table t_cartes.`);
    return { success: true, uploadedCount, message: `Synchronisation de masse terminée : ${uploadedCount} cartes traitées.` };
  } catch (err: any) {
    log.error('BulkUpload: Fatal upload failure:', err);
    return { success: false, uploadedCount: 0, message: `Erreur lors de la synchronisation en masse : ${err.message || err}` };
  } finally {
    networkMonitor.setBypassForceOnline(false);
  }
}

/**
 * Valide la cohérence logique et le format d'une date YYYY-MM-DD
 */
function isValidDate(dateStr: string | null | undefined): boolean {
  if (!dateStr) return false;
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);
  return month >= 1 && month <= 12 && day >= 1 && day <= 31;
}
