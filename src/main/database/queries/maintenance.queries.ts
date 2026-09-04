import { getDatabase } from '../connection';
import log from 'electron-log';

export function clearDatabaseCartes(siteId?: number): void {
  const db = getDatabase()!;
  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      // Securite : t_logs (historique operationnel) n'est volontairement PAS purge ici - une
      // purge de cartes ne doit pas effacer la tracabilite des actions anterieures du site.
      if (siteId !== undefined) {
        db.prepare('DELETE FROM t_cartes WHERE site_id = ?').run(siteId);
        // t_sync_queue n'a PAS de colonne site_id - purge des entrees orphelines apres suppression des cartes
        db.prepare("DELETE FROM t_sync_queue WHERE table_name = 't_cartes' AND record_id NOT IN (SELECT id_carte FROM t_cartes)").run();
      } else {
        db.prepare('DELETE FROM t_cartes').run();
        db.prepare('DELETE FROM t_sync_queue').run();
      }
    })();
  } finally {
    db.pragma('foreign_keys = ON');
  }
}

export async function purgeLocalDatabase(siteId: number, progressCallback?: (percent: number) => void): Promise<{ success: boolean, count: number }> {
  const db = getDatabase()!;

  if (!siteId) {
    throw new Error("siteId obligatoire pour la purge locale.");
  }

  try {
    let deletedCartes = 0;

    // ─── CORRECTIF ANTI-FREEZE (réplique du pattern déjà validé par emergencyPurge) ───
    // Étape 1 : Désactivation des clés & suppression des TRIGGERS UNIQUEMENT.
    // Même correctif anti-corruption SQLITE_CORRUPT_VTAB que emergencyPurge (voir sa
    // documentation détaillée plus bas dans ce fichier) : on ne DROP/CREATE JAMAIS
    // t_cartes_fts elle-même (uniquement les 3 triggers), pour permettre un DELETE brut
    // rapide sur t_cartes sans le coût par-ligne du trigger AFTER DELETE, puis on rejoue
    // manuellement — par lots, avec yield — les commandes 'delete' que ce trigger aurait
    // émises lui-même.
    if (progressCallback) progressCallback(5);
    db.pragma('foreign_keys = OFF');

    db.exec('DROP TRIGGER IF EXISTS trg_cartes_ai;');
    db.exec('DROP TRIGGER IF EXISTS trg_cartes_ad;');
    db.exec('DROP TRIGGER IF EXISTS trg_cartes_au;');

    // Capture de l'ancien contenu FTS5 du site à purger AVANT suppression — nécessaire pour
    // reproduire ensuite manuellement les commandes 'delete' que le trigger AFTER DELETE
    // aurait émises (old.* n'est plus disponible une fois les lignes supprimées).
    //
    // CORRECTIF ANTI-FREEZE (lecture chunkée) : ce SELECT portait auparavant sur TOUTES les
    // cartes du site en un seul bloc synchrone (jusqu'à 218 332 lignes en production) — seul
    // point de cette fonction resté non chunké alors que toutes les étapes lourdes suivantes
    // (anomalies, sync_queue/cartes, FTS5) le sont déjà. Ce bloc unique gelait le Main Thread
    // Electron (donc tout l'IPC de l'appli) pendant toute sa durée, provoquant le freeze de la
    // barre de progression vers 10% observé en production. Lecture désormais paginée par
    // keyset sur id_carte (évite la dégradation d'un OFFSET élevé sur une grosse table), par
    // lots de SELECT_BATCH_SIZE avec yield setImmediate entre chaque lot — résultat final
    // (oldFtsCards) strictement identique en forme/contenu/ordre au SELECT unique remplacé.
    type FtsCard = { id_carte: number; noms: string; prenoms: string; num_secu: string; contact: string; lieu_de_naissance: string; rangement: string };
    const SELECT_BATCH_SIZE = 500;
    const oldFtsCards: FtsCard[] = [];
    {
      const selectCardsBatch = db.prepare(`
        SELECT id_carte, noms, prenoms, num_secu, contact, lieu_de_naissance, rangement
        FROM t_cartes WHERE site_id = ? AND id_carte > ? ORDER BY id_carte ASC LIMIT ?
      `);
      let lastId = 0;
      let batch: FtsCard[];
      while ((batch = selectCardsBatch.all(siteId, lastId, SELECT_BATCH_SIZE) as FtsCard[]).length > 0) {
        oldFtsCards.push(...batch);
        lastId = batch[batch.length - 1].id_carte;
        await new Promise(resolve => setImmediate(resolve));
      }
    }

    if (progressCallback) progressCallback(15);
    await new Promise(resolve => setImmediate(resolve));

    // ─── ÉTAPE 2 (CHUNKÉE) : purge par lots de 500 + yield setImmediate ───
    // Comportement métier STRICTEMENT IDENTIQUE à l'ancienne implémentation synchrone
    // (mêmes tables, mêmes filtres site_id, même ordre logique : anomalies → sync_queue →
    // cartes). Contrairement à emergencyPurge, t_logs n'est volontairement PAS touché ici :
    // différence de règle métier intentionnelle entre purge normale et purge d'urgence
    // (à ne pas répliquer).
    //
    // CORRECTIF ANTI-FREEZE (confirmé par agent-13-qa-terrain-tester, sonde IPC concurrente) :
    // l'ancien DELETE brut, enveloppé dans UNE SEULE transaction non chunkée, bloquait le
    // Main Thread Electron 7 à 18s sur 60 000 cartes (des appels IPC totalement indépendants
    // restaient sans réponse pendant tout cet intervalle) — un gel qui aurait scalé
    // proportionnellement sur le volume réel de production (218 332 cartes). On applique ici
    // exactement le même principe déjà validé pour la boucle FTS5 plus bas dans ce fichier :
    // une transaction better-sqlite3 est 100% synchrone du début à la fin (impossible de
    // yield au milieu), donc on ne peut yield qu'ENTRE deux petites transactions successives.
    //
    // Hypothèses de volumétrie documentées (à la demande explicite, plutôt que supposées) :
    // - t_sync_queue N'EST JAMAIS purgée après synchro réussie : markRecordsAsSynced()
    //   (sync.queries.ts) se contente de passer synced=1, sans jamais DELETE la ligne. Son
    //   volume peut donc, avec le temps, atteindre voire dépasser celui de t_cartes lui-même
    //   — elle est donc chunkée au même titre que t_cartes, par précaution.
    // - t_import_anomalies reçoit une ligne par ligne anormale détectée lors d'un import
    //   massif (import-worker.js, INSERT INTO t_import_anomalies) : dans un scénario d'import
    //   pathologique (fichier source majoritairement dupliqué/invalide), son volume peut
    //   atteindre un ordre de grandeur comparable à t_cartes. Elle est donc chunkée elle aussi
    //   — aucune des trois tables n'est considérée comme structurellement bornée à un petit
    //   volume, contrairement à une hypothèse par défaut qui aurait pu sembler raisonnable.
    const DELETE_BATCH_SIZE = 500;

    // 1. Purge chunkée des anomalies d'import pour ce site (colonne site_id native).
    {
      const selectAnomalyIds = db.prepare(`SELECT id FROM t_import_anomalies WHERE site_id = ? LIMIT ?`);
      let batch: { id: number }[];
      // On ré-exécute le même SELECT (sans OFFSET) à chaque tour : puisque les lignes
      // retournées sont supprimées avant le tour suivant, le lot suivant "remonte"
      // naturellement — identique au pattern utilisé ailleurs dans le code (upload-worker.js).
      while ((batch = selectAnomalyIds.all(siteId, DELETE_BATCH_SIZE) as { id: number }[]).length > 0) {
        const ids = batch.map(r => r.id);
        const placeholders = ids.map(() => '?').join(',');
        db.transaction(() => {
          db.prepare(`DELETE FROM t_import_anomalies WHERE id IN (${placeholders})`).run(...ids);
        })();
        await new Promise(resolve => setImmediate(resolve));
      }
    }
    if (progressCallback) progressCallback(25);

    // 2. Nombre de cartes à purger pour le log (calculé une fois, avant toute suppression).
    deletedCartes = oldFtsCards.length;
    const allCarteIds = oldFtsCards.map(c => c.id_carte);

    // 3. Purge chunkée, lot par lot, de la file de synchro PUIS des cartes elles-mêmes
    // (même lot d'id_carte pour les deux, dans la même petite transaction, pour préserver
    // l'ordre logique file de synchro → cartes sans multiplier les yields inutilement).
    // On s'appuie sur la liste d'id_carte capturée AVANT toute suppression (oldFtsCards),
    // t_sync_queue n'ayant pas de colonne site_id propre.
    for (let i = 0; i < allCarteIds.length; i += DELETE_BATCH_SIZE) {
      const idsBatch = allCarteIds.slice(i, i + DELETE_BATCH_SIZE);
      const placeholders = idsBatch.map(() => '?').join(',');
      db.transaction(() => {
        db.prepare(`DELETE FROM t_sync_queue WHERE table_name = 't_cartes' AND record_id IN (${placeholders})`).run(...idsBatch);
        db.prepare(`DELETE FROM t_cartes WHERE id_carte IN (${placeholders})`).run(...idsBatch);
      })();

      if (progressCallback) {
        const step3Progress = 25 + Math.round(((i + idsBatch.length) / Math.max(allCarteIds.length, 1)) * 15);
        progressCallback(Math.min(step3Progress, 40));
      }
      await new Promise(resolve => setImmediate(resolve));
    }

    if (progressCallback) progressCallback(40);
    await new Promise(resolve => setImmediate(resolve));

    // Étape 3 : Recréation des TRIGGERS uniquement (copie exacte de emergencyPurge) —
    // t_cartes_fts elle-même n'est JAMAIS droppée/recréée (voir justification ci-dessus).
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
    if (progressCallback) progressCallback(60);
    await new Promise(resolve => setImmediate(resolve));

    // ─── PURGE FTS5 INCRÉMENTALE NON-BLOQUANTE (lots de 500 + yield setImmediate) ───
    // Identique au pattern emergencyPurge : pour chaque carte réellement supprimée, on
    // rejoue la commande 'delete' que le trigger AFTER DELETE aurait émise — mais par lots,
    // avec yield setImmediate entre chaque lot pour ne pas geler l'UI (CORRECTIF ANTI-FREEZE,
    // cf. historique : le DELETE en masse avec triggers actifs gelait le Main Thread Electron
    // pendant ~30s sur 218 332 cartes).
    const FTS_BATCH_SIZE = 500;
    const totalFts = oldFtsCards.length;
    if (totalFts > 0) {
      const ftsDeleteStmt = db.prepare(`
        INSERT INTO t_cartes_fts(t_cartes_fts, rowid, noms, prenoms, num_secu, contact, lieu_de_naissance, rangement)
        VALUES('delete', ?, ?, ?, ?, ?, ?, ?)
      `);

      for (let i = 0; i < totalFts; i += FTS_BATCH_SIZE) {
        const batch = oldFtsCards.slice(i, i + FTS_BATCH_SIZE);
        db.transaction(() => {
          for (const c of batch) {
            ftsDeleteStmt.run(c.id_carte, c.noms || '', c.prenoms || '', c.num_secu || '', c.contact || '', c.lieu_de_naissance || '', c.rangement || '');
          }
        })();

        // Progression granulaire : 60% → 90% pendant la purge FTS5
        if (progressCallback) {
          const ftsProgress = 60 + Math.round(((i + batch.length) / totalFts) * 30);
          progressCallback(Math.min(ftsProgress, 90));
        }

        // Yield de la boucle d'événements — libère le thread UI d'Electron
        await new Promise(resolve => setImmediate(resolve));
      }
      log.info(`[PURGE LOCALE] Purge FTS5 incrémentale terminée : ${totalFts} cartes retirées de l'index par lots de ${FTS_BATCH_SIZE}.`);
    }

    if (progressCallback) progressCallback(90);
    await new Promise(resolve => setImmediate(resolve));

    db.pragma('foreign_keys = ON');

    // CORRECTIF P0 — VACUUM synchrone et attendu (plus de setTimeout fire-and-forget).
    // L'ancien pattern retournait { success: true } AVANT que le VACUUM n'ait réellement
    // commencé, sans aucun verrou empêchant une autre opération SQLite (IPC, SyncEngine repris,
    // nouvel import) de toucher le fichier .db pendant que VACUUM le réécrit intégralement —
    // scénario reproduit en corruption SQLITE_CORRUPT_VTAB lors d'un enchaînement Emergency
    // Purge + Purge normale. Le VACUUM doit désormais être totalement terminé avant que cette
    // fonction (et donc la promesse IPC du caller qui l'attend) ne se résolve.
    try {
      log.info("⏳ Lancement du VACUUM de compactage du disque...");
      db.prepare("VACUUM").run();
      log.info("✅ VACUUM terminé avec succès.");
    } catch (err) {
      // Le VACUUM échoué (ex. espace disque insuffisant) ne remet pas en cause la purge
      // elle-même (déjà commitée ci-dessus) : on journalise sans faire échouer l'opération,
      // comme le faisait le comportement fire-and-forget précédent. Ce qui change ici, c'est
      // uniquement le fait que ce bloc s'exécute désormais de façon synchrone et attendue,
      // pour qu'aucune autre opération SQLite ne puisse s'intercaler pendant le VACUUM.
      log.error("Erreur lors du VACUUM :", err);
    }

    // CORRECTIF P0 (bug résiduel) — Checkpoint WAL explicite après VACUUM.
    // En mode WAL, VACUUM écrit l'intégralité de la base reconstruite DANS le WAL
    // (pas directement dans le fichier .db principal) : sans checkpoint, l'espace
    // disque libéré par la purge n'est PAS réellement récupéré tant qu'un checkpoint
    // (automatique ou explicite) n'a pas eu lieu. `wal_autocheckpoint = 100000` étant
    // volontairement haut (anti-freeze import massif, voir connection.ts), rien ne
    // garantit qu'un checkpoint automatique se déclenche rapidement après une purge.
    // TRUNCATE force la fusion + la remise à zéro du WAL ici, sans toucher au réglage
    // global. Best-effort : si d'autres connexions retiennent un verrou, TRUNCATE fait
    // simplement ce qu'il peut sans lever d'exception bloquante.
    try {
      db.pragma('wal_checkpoint(TRUNCATE)');
    } catch (err) {
      log.error("Erreur lors du wal_checkpoint(TRUNCATE) post-VACUUM :", err);
    }

    return { success: true, count: deletedCartes };
  } catch (error) {
    db.pragma('foreign_keys = ON');
    throw error;
  }
}

export function getLocalCardCount(siteId?: number): number {
  const db = getDatabase()!;
  // Cloisonnement (CLAUDE.md §3) : si siteId est fourni, on filtre sur ce site (comportement
  // cohérent avec purgeLocalDatabase(siteId), qui purge un site précis). Sans siteId (undefined),
  // on conserve le comportement historique — total global tous sites confondus — pour ne pas
  // casser d'éventuels appelants existants qui en dépendraient.
  const row = siteId !== undefined
    ? db.prepare("SELECT COUNT(*) as count FROM t_cartes WHERE site_id = ?").get(siteId) as { count: number }
    : db.prepare("SELECT COUNT(*) as count FROM t_cartes").get() as { count: number };
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

  // Étape 1 : Désactivation des clés & suppression des TRIGGERS UNIQUEMENT (15%)
  //
  // CORRECTIF P0 (bug résiduel post-VACUUM-synchrone) — SQLITE_CORRUPT_VTAB transitoire :
  // L'ancienne séquence faisait un DROP TABLE t_cartes_fts (+ triggers) PUIS un CREATE VIRTUAL
  // TABLE + ré-indexation PUIS un VACUUM. Stress-testé (3 cycles Emergency Purge → activité SQLite
  // → Purge normale enchaînés), ce DROP+CREATE de la vtable FTS5 juste avant un VACUUM provoquait de
  // façon reproductible (100% sur 5-10 répétitions, isolé empiriquement via un banc de test dédié
  // sur fichier .db jetable) une erreur SQLITE_CORRUPT_VTAB transitoire pour TOUTE connexion
  // SQLite tierce (Worker Thread, IPC, SyncEngine repris) touchant t_cartes_fts juste après —
  // y compris une connexion qui n'avait JAMAIS interagi avec t_cartes_fts auparavant. Le fichier
  // se révèle par ailleurs parfaitement sain à la ré-inspection (integrity_check/quick_check ok) :
  // il s'agit bien d'une race transitoire liée au VACUUM d'une vtable FTS5 tout juste recréée
  // (DROP+CREATE), et non d'une corruption disque persistante.
  // Isolation de la cause (tests différentiels reproductibles) :
  //   - DROP+CREATE de t_cartes_fts suivi d'un VACUUM (même avec un délai/réordonnancement,
  //     même avec 'wal_checkpoint(TRUNCATE)' avant/après, même mmap_size=0) → échoue toujours.
  //   - Purge FTS5 100% incrémentale (aucun DROP+CREATE, aucune commande spéciale bulk type
  //     'delete-all'/'rebuild', uniquement des opérations 'delete' par ligne comme le ferait le
  //     trigger normal AFTER DELETE) suivie d'un VACUUM → jamais d'échec (10/10 répétitions).
  // Correctif retenu : ne plus JAMAIS DROP/CREATE t_cartes_fts ni utiliser de commande bulk FTS5.
  // On droppe seulement les 3 TRIGGERS (pour éviter le coût par-ligne pendant le DELETE en masse,
  // optimisation anti-freeze préservée), on capture l'ANCIEN contenu des cartes à purger AVANT
  // de les supprimer, puis on reproduit exactement — mais par lots avec yield — ce que le trigger
  // AFTER DELETE aurait fait lui-même : une commande 'delete' par ligne dans t_cartes_fts.
  // Bénéfice collatéral : l'ancienne séquence (DROP TABLE t_cartes_fts) vidait l'INTÉGRALITÉ de
  // l'index FTS5 (partagé entre tous les sites) puis ne ré-indexait que le site purgé — ce qui
  // effaçait silencieusement la recherche plein texte des AUTRES sites après une purge d'urgence
  // d'un seul site. La purge incrémentale ci-dessous ne touche que les lignes réellement
  // supprimées et préserve donc l'index FTS5 des autres sites.
  if (progressCallback) progressCallback(5);
  db.pragma('foreign_keys = OFF');

  db.exec('DROP TRIGGER IF EXISTS trg_cartes_ai;');
  db.exec('DROP TRIGGER IF EXISTS trg_cartes_ad;');
  db.exec('DROP TRIGGER IF EXISTS trg_cartes_au;');

  // Capture de l'ancien contenu FTS5 du site à purger AVANT suppression — nécessaire pour
  // reproduire ensuite manuellement les commandes 'delete' que le trigger AFTER DELETE aurait
  // émises (old.* n'est plus disponible une fois les lignes supprimées).
  //
  // CORRECTIF ANTI-FREEZE (lecture chunkée) : même bug latent que purgeLocalDatabase (voir sa
  // documentation détaillée ci-dessus) — ce SELECT unique portait sur TOUTES les cartes du site
  // en un seul bloc synchrone, gelant le Main Thread Electron sur un site volumineux. Lecture
  // désormais paginée par keyset sur id_carte, par lots de SELECT_BATCH_SIZE avec yield
  // setImmediate entre chaque lot — résultat final (oldFtsCards) strictement identique en
  // forme/contenu/ordre au SELECT unique remplacé.
  type FtsCard = { id_carte: number; noms: string; prenoms: string; num_secu: string; contact: string; lieu_de_naissance: string; rangement: string };
  const SELECT_BATCH_SIZE = 500;
  const oldFtsCards: FtsCard[] = [];
  {
    const selectCardsBatch = db.prepare(`
      SELECT id_carte, noms, prenoms, num_secu, contact, lieu_de_naissance, rangement
      FROM t_cartes WHERE site_id = ? AND id_carte > ? ORDER BY id_carte ASC LIMIT ?
    `);
    let lastId = 0;
    let batch: FtsCard[];
    while ((batch = selectCardsBatch.all(siteId, lastId, SELECT_BATCH_SIZE) as FtsCard[]).length > 0) {
      oldFtsCards.push(...batch);
      lastId = batch[batch.length - 1].id_carte;
      await new Promise(resolve => setImmediate(resolve));
    }
  }

  if (progressCallback) progressCallback(15);
  await new Promise(resolve => setImmediate(resolve));

  // Étape 2 : Purge de t_cartes et anomalies (40%)
  db.transaction(() => {
    db.prepare('DELETE FROM t_cartes WHERE site_id = ?').run(siteId);
    db.prepare('DELETE FROM t_import_anomalies WHERE site_id = ?').run(siteId);
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

  // Étape 4 : Recréation des TRIGGERS uniquement (75%) — t_cartes_fts elle-même n'est
  // JAMAIS droppée/recréée (voir justification ci-dessus).
  if (progressCallback) progressCallback(75);
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
  await new Promise(resolve => setImmediate(resolve));

  // ─── PURGE FTS5 INCRÉMENTALE NON-BLOQUANTE (lots de 500 + yield setImmediate) ───
  // Remplace l'ancienne RE-INDEXATION (qui supposait t_cartes_fts vidée par le DROP TABLE)
  // par une suppression incrémentale ciblée : pour chaque carte réellement supprimée, on
  // rejoue la commande 'delete' que le trigger AFTER DELETE aurait émise — mais par lots,
  // avec yield setImmediate entre chaque lot pour ne pas geler l'UI (CORRECTIF ANTI-FREEZE
  // préservé, cf. historique : le SELECT...INSERT en bloc gelait le Main Thread Electron
  // pendant 15-45s sur 220 000 cartes). Contrairement à l'ancienne ré-indexation, ceci ne
  // laisse jamais t_cartes_fts dans un état vidé/reconstruit en bloc juste avant le VACUUM.
  const FTS_BATCH_SIZE = 500;
  const totalFts = oldFtsCards.length;
  if (totalFts > 0) {
    const ftsDeleteStmt = db.prepare(`
      INSERT INTO t_cartes_fts(t_cartes_fts, rowid, noms, prenoms, num_secu, contact, lieu_de_naissance, rangement)
      VALUES('delete', ?, ?, ?, ?, ?, ?, ?)
    `);

    for (let i = 0; i < totalFts; i += FTS_BATCH_SIZE) {
      const batch = oldFtsCards.slice(i, i + FTS_BATCH_SIZE);
      db.transaction(() => {
        for (const c of batch) {
          ftsDeleteStmt.run(c.id_carte, c.noms || '', c.prenoms || '', c.num_secu || '', c.contact || '', c.lieu_de_naissance || '', c.rangement || '');
        }
      })();

      // Progression granulaire : 75% → 90% pendant la purge FTS5
      if (progressCallback) {
        const ftsProgress = 75 + Math.round(((i + batch.length) / totalFts) * 15);
        progressCallback(Math.min(ftsProgress, 90));
      }

      // Yield de la boucle d'événements — libère le thread UI d'Electron
      await new Promise(resolve => setImmediate(resolve));
    }
    log.info(`[EMERGENCY PURGE] Purge FTS5 incrémentale terminée : ${totalFts} cartes retirées de l'index par lots de ${FTS_BATCH_SIZE}.`);
  }

  if (progressCallback) progressCallback(90);
  await new Promise(resolve => setImmediate(resolve));

  // Étape 6 : Réactivation clés & Vacuum (100%)
  db.pragma('foreign_keys = ON');

  // CORRECTIF P0 — VACUUM synchrone et attendu (plus de setTimeout fire-and-forget), même
  // justification que dans purgeLocalDatabase ci-dessus : la fonction ne doit retourner (et donc
  // la promesse IPC de db:emergency-purge ne doit se résoudre) qu'une fois le VACUUM totalement
  // terminé, pour qu'aucune autre opération SQLite ne puisse s'intercaler pendant la réécriture
  // intégrale du fichier .db.
  try {
    log.info("⏳ [EMERGENCY] Lancement du compactage du disque...");
    db.prepare("VACUUM").run();
    log.info("✅ [EMERGENCY] VACUUM terminé avec succès.");
  } catch (err) {
    // Échec du VACUUM (ex. espace disque insuffisant) : journalisé sans faire échouer la
    // réparation d'urgence elle-même, déjà commitée ci-dessus (mêmes semantiques que
    // purgeLocalDatabase).
    log.error("Erreur lors du VACUUM :", err);
  }

  // CORRECTIF P0 (bug résiduel) — Checkpoint WAL explicite après VACUUM, même justification
  // que dans purgeLocalDatabase (voir commentaire détaillé ci-dessus) : sans ce checkpoint,
  // l'espace disque libéré par la purge d'urgence reste dans le WAL au lieu d'être réellement
  // récupéré, `wal_autocheckpoint` étant volontairement réglé haut pour éviter les freezes UI
  // pendant les imports massifs.
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
  } catch (err) {
    log.error("Erreur lors du wal_checkpoint(TRUNCATE) post-VACUUM [EMERGENCY] :", err);
  }

  if (progressCallback) progressCallback(100);

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

export function purgeEmptyRows(): void {
  const db = getDatabase()!;
  try {
    const result = db.prepare(`
      DELETE FROM t_cartes 
      WHERE (noms IS NULL OR noms = '') 
        AND (prenoms IS NULL OR prenoms = '') 
        AND (num_secu IS NULL OR num_secu = '') 
        AND (rangement IS NULL OR rangement = '' OR rangement = 'NON CLASSE')
    `).run();
    if (result.changes > 0) {
      log.info(`[AUTO-PURGE] ${result.changes} lignes fantômes (totalement vides) supprimées de la base locale.`);
    }
  } catch (err) {
    log.error("[AUTO-PURGE] Échec de la suppression des lignes fantômes:", err);
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


