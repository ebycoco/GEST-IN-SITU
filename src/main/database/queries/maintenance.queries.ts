import { getDatabase } from '../connection';
import log from 'electron-log';

export function clearDatabaseCartes(siteId?: number): void {
  const db = getDatabase()!;
  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      if (siteId !== undefined) {
        db.prepare('DELETE FROM t_cartes WHERE site_id = ?').run(siteId);
        // t_sync_queue n'a PAS de colonne site_id — purge des entr\u00e9es orphelines apr\u00e8s suppression des cartes
        db.prepare("DELETE FROM t_sync_queue WHERE table_name = 't_cartes' AND record_id NOT IN (SELECT id_carte FROM t_cartes)").run();
        db.prepare('DELETE FROM t_logs WHERE site_id = ?').run(siteId);
      } else {
        db.prepare('DELETE FROM t_cartes').run();
        db.prepare('DELETE FROM t_sync_queue').run();
        db.prepare('DELETE FROM t_logs').run();
      }
    })();
  } finally {
    db.pragma('foreign_keys = ON');
  }
}

export async function purgeLocalDatabase(siteId: number, progressCallback?: (percent: number) => void): Promise<{ success: boolean, count: number }> {
  const db = getDatabase()!;
  db.pragma('foreign_keys = OFF');
  try {
    let deleted = 0;
    
    const countRow = db.prepare('SELECT COUNT(*) as count FROM t_cartes WHERE site_id = ?').get(siteId) as { count: number } | undefined;
    const totalToPurge = countRow ? countRow.count : 0;
    
    if (totalToPurge > 0) {
      const batchSize = 1000;
      let hasMore = true;
      while (hasMore) {
        const idsRow = db.prepare('SELECT id_carte FROM t_cartes WHERE site_id = ? LIMIT ?').all(siteId, batchSize) as { id_carte: number }[];
        if (idsRow.length === 0) {
          hasMore = false;
          break;
        }
        
        const ids = idsRow.map(r => r.id_carte);
        const placeholders = ids.map(() => '?').join(',');
        
        db.transaction(() => {
          db.prepare(`DELETE FROM t_cartes WHERE id_carte IN (${placeholders})`).run(...ids);
          db.prepare(`DELETE FROM t_sync_queue WHERE table_name = 't_cartes' AND record_id IN (${placeholders})`).run(...ids);
        })();
        
        deleted += ids.length;
        if (progressCallback) {
          const percent = Math.min(Math.round((deleted / totalToPurge) * 100), 100);
          progressCallback(percent);
        }
        // Yield Event Loop
        await new Promise((resolve) => setImmediate(resolve));
      }
    } else {
      if (progressCallback) progressCallback(100);
    }
    
    db.pragma('foreign_keys = ON');

    setTimeout(() => {
      try {
        log.info("⏳ [BACKGROUND] Lancement du VACUUM de compactage du disque...");
        db.prepare("VACUUM").run();
        log.info("✅ [BACKGROUND] VACUUM terminé avec succès.");
      } catch (err) {
        log.error("Erreur lors du VACUUM en tâche de fond:", err);
      }
    }, 500);

    return { success: true, count: deleted };
  } catch (error) {
    db.pragma('foreign_keys = ON');
    throw error;
  }
}

export function getLocalCardCount(): number {
  const db = getDatabase()!;
  const row = db.prepare("SELECT COUNT(*) as count FROM t_cartes").get() as { count: number };
  return row ? row.count : 0;
}

export async function emergencyPurge(
  siteId: number,
  progressCallback?: (percent: number) => void
): Promise<{ success: boolean }> {
  const db = getDatabase()!;
  
  if (!siteId) {
    throw new Error("siteId obligatoire pour la purge d'urgence.");
  }

  // Étape 1 : Désactivation des clés & suppression des triggers (15%)
  if (progressCallback) progressCallback(5);
  db.pragma('foreign_keys = OFF');

  db.exec('DROP TRIGGER IF EXISTS trg_cartes_ai;');
  db.exec('DROP TRIGGER IF EXISTS trg_cartes_ad;');
  db.exec('DROP TRIGGER IF EXISTS trg_cartes_au;');
  db.exec('DROP TABLE IF EXISTS t_cartes_fts;');
  
  if (progressCallback) progressCallback(15);
  await new Promise(resolve => setImmediate(resolve));

  // Étape 2 : Purge de t_cartes (40%)
  db.transaction(() => {
    db.prepare('DELETE FROM t_cartes WHERE site_id = ?').run(siteId);
  })();
  if (progressCallback) progressCallback(40);
  await new Promise(resolve => setImmediate(resolve));

  // Étape 3 : Nettoyage des files & logs (60%)
  db.transaction(() => {
    // t_logs a bien une colonne site_id (ajoutée en migration V6/V7)
    db.prepare("DELETE FROM t_logs WHERE site_id = ? AND action IN ('SYNC_UPDATE', 'CARTE_ABSENTE_SIGNALEE', 'CARTE_ABSENTE_RETROUVEE', 'CARTE_PERDUE_CONFIRMEE', 'CARTE_PERDUE_RETROUVEE')").run(siteId);
    // t_sync_queue n'a PAS de colonne site_id — on purge via les IDs de cartes du site concerné
    // ou on vide toute la queue (les entrées orphelines après purge t_cartes sont de toute façon inutiles)
    db.prepare("DELETE FROM t_sync_queue WHERE table_name = 't_cartes' AND record_id NOT IN (SELECT id_carte FROM t_cartes)").run();
  })();
  if (progressCallback) progressCallback(60);
  await new Promise(resolve => setImmediate(resolve));

  // Étape 4 : Recréation de la structure FTS5 (75%)
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS t_cartes_fts USING fts5(
      noms,
      prenoms,
      num_secu,
      contact,
      lieu_de_naissance,
      rangement,
      content='t_cartes',
      content_rowid='id_carte'
    );
  `);
  if (progressCallback) progressCallback(75);
  await new Promise(resolve => setImmediate(resolve));

  // Étape 5 : Recréation des triggers & Ré-indexation FTS5 (90%)
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_cartes_ai AFTER INSERT ON t_cartes BEGIN
      INSERT INTO t_cartes_fts(rowid, noms, prenoms, num_secu, contact, lieu_de_naissance, rangement)
      VALUES (new.id_carte, new.noms, new.prenoms, new.num_secu, new.contact, new.lieu_de_naissance, new.rangement);
    END;

    CREATE TRIGGER IF NOT EXISTS trg_cartes_ad AFTER DELETE ON t_cartes BEGIN
      INSERT INTO t_cartes_fts(t_cartes_fts, rowid, noms, prenoms, num_secu, contact, lieu_de_naissance, rangement)
      VALUES('delete', old.id_carte, old.noms, old.prenoms, old.num_secu, old.contact, old.lieu_de_naissance, old.rangement);
    END;

    CREATE TRIGGER IF NOT EXISTS trg_cartes_au AFTER UPDATE ON t_cartes BEGIN
      INSERT INTO t_cartes_fts(t_cartes_fts, rowid, noms, prenoms, num_secu, contact, lieu_de_naissance, rangement)
      VALUES('delete', old.id_carte, old.noms, old.prenoms, old.num_secu, old.contact, old.lieu_de_naissance, old.rangement);
      INSERT INTO t_cartes_fts(rowid, noms, prenoms, num_secu, contact, lieu_de_naissance, rangement)
      VALUES(new.id_carte, new.noms, new.prenoms, new.num_secu, new.contact, new.lieu_de_naissance, new.rangement);
    END;
  `);

  // ─── RE-INDEXATION FTS5 NON-BLOQUANTE (lots de 500 + yield setImmediate) ───
  // CORRECTIF ANTI-FREEZE : Le SELECT...INSERT en bloc précédent gelait le Main
  // Thread Electron pendant 15-45s sur 220 000 cartes (Abobo). Désormais :
  //   1. Les données sont chargées en mémoire en une seule requête SELECT (rapide).
  //   2. L'insertion FTS5 se fait par lots de FTS_BATCH_SIZE pour libérer l'Event
  //      Loop entre chaque lot via setImmediate (non bloquant pour l'UI).
  //   3. La progression est mise à jour de façon granulaire entre 75% et 90%.
  const FTS_BATCH_SIZE = 500;
  type FtsCard = { id_carte: number; noms: string; prenoms: string; num_secu: string; contact: string; lieu_de_naissance: string; rangement: string };
  const ftsCards = db.prepare(`
    SELECT id_carte, noms, prenoms, num_secu, contact, lieu_de_naissance, rangement
    FROM t_cartes WHERE site_id = ? ORDER BY id_carte ASC
  `).all(siteId) as FtsCard[];

  const totalFts = ftsCards.length;
  if (totalFts > 0) {
    const ftsInsertStmt = db.prepare(`
      INSERT INTO t_cartes_fts(rowid, noms, prenoms, num_secu, contact, lieu_de_naissance, rangement)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    for (let i = 0; i < totalFts; i += FTS_BATCH_SIZE) {
      const batch = ftsCards.slice(i, i + FTS_BATCH_SIZE);
      db.transaction(() => {
        for (const c of batch) {
          ftsInsertStmt.run(c.id_carte, c.noms || '', c.prenoms || '', c.num_secu || '', c.contact || '', c.lieu_de_naissance || '', c.rangement || '');
        }
      })();

      // Progression granulaire : 75% → 90% pendant la ré-indexation
      if (progressCallback) {
        const ftsProgress = 75 + Math.round(((i + batch.length) / totalFts) * 15);
        progressCallback(Math.min(ftsProgress, 90));
      }

      // Yield de la boucle d'événements — libère le thread UI d'Electron
      await new Promise(resolve => setImmediate(resolve));
    }
    log.info(`[EMERGENCY PURGE] Ré-indexation FTS5 terminée : ${totalFts} cartes indexées par lots de ${FTS_BATCH_SIZE}.`);
  }

  if (progressCallback) progressCallback(90);
  await new Promise(resolve => setImmediate(resolve));

  // Étape 6 : Réactivation clés & Vacuum (100%)
  db.pragma('foreign_keys = ON');
  
  if (progressCallback) progressCallback(100);

  setTimeout(() => {
    try {
      log.info("⏳ [BACKGROUND - EMERGENCY] Lancement du compactage du disque...");
      db.prepare("VACUUM").run();
      log.info("✅ [BACKGROUND - EMERGENCY] VACUUM terminé avec succès.");
    } catch (err) {
      log.error("Erreur lors du VACUUM en tâche de fond:", err);
    }
  }, 500);

  return { success: true };
}

export function purgeExpiredDeadLetters(): void {
  const db = getDatabase()!;
  try {
    const result = db.prepare("DELETE FROM t_sync_queue WHERE synced = -1 AND created_at < datetime('now', '-7 days')").run();
    log.info(`[DLQ MAINTENANCE] ${result.changes} anciennes Dead Letter Entries expirées (> 7 jours) purgées.`);
  } catch (err) {
    log.error("[DLQ MAINTENANCE] Échec de la purge des Dead Letter Entries:", err);
  }
}

/**
 * Réinitialisation TOTALE du système : cartes, queue de sync, logs, utilisateurs (hors SUPER ADMIN).
 *
 * ⚠️  AVERTISSEMENT — OPÉRATION SYNCHRONE BLOQUANTE :
 *   Les DELETE en transaction SQLite ci-dessous sont exécutés de façon synchrone.
 *   Sur une base contenant plus de 100 000 cartes, cela peut geler le Main Thread
 *   Electron pendant 2 à 8 secondes. Cette fonction est réservée au SUPER ADMIN
 *   et doit être appelée UNIQUEMENT lors des opérations de maintenance planifiée
 *   (hors utilisation active des postes de terrain).
 *
 * Thread Safety : appelée depuis maintenance:fullReset (IPC Handler) qui gère
 * la vérification de rôle SUPER ADMIN en amont.
 */
export function fullSystemReset(): { success: boolean } {
  try {
    const db = getDatabase()!;
    const { logAction } = require('./logs.queries');
    
    db.transaction(() => {
      db.prepare('DELETE FROM t_cartes').run();
      db.prepare('DELETE FROM t_import_temp').run();
      db.prepare('DELETE FROM t_sync_queue').run();
      db.prepare('DELETE FROM t_logs').run();
      db.prepare("DELETE FROM t_users WHERE role != 'SUPER ADMIN'").run();
    })();

    logAction(0, 'SYSTEM', 'MAINTENANCE', 'RÉINITIALISATION TOTALE DU SYSTÈME (Cartes + Utilisateurs hors Super Admin)');
    return { success: true };
  } catch (error) {
    log.error('CRITICAL: fullSystemReset failed', error);
    throw error;
  }
}


