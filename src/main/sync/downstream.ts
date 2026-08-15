import log from 'electron-log';
import { getSupabaseClient } from './supabase-client';
import { getDatabase, getDbPath } from '../database/connection';
import { logAudit } from '../utils/audit';
import { BrowserWindow, app } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import { Worker } from 'worker_threads';
import { join } from 'path';

// ─── Garde de réentrance : preloadUsersFromCloud() ──────────────────────────
// `syncEngine.init()` est déclenché depuis `mainWindow.on('ready-to-show', ...)`
// (src/main/index.ts). Si cet événement Electron se déclenche plus d'une fois
// sur la même fenêtre (observé empiriquement lors d'une investigation QA sur
// perte de données : deux occurrences de "[PERF] Cold Start" dans les logs
// d'une seule session, ~32s d'écart, coïncidant avec la transition réseau
// OFFLINE->ONLINE), `preloadUsersFromCloud()` peut être invoquée deux fois en
// recouvrement. Sans garde, ces deux exécutions concurrentes déclenchent
// chacune leurs propres `db.transaction()` sur t_sites/t_centres/t_users sur
// LA MÊME connexion partagée, en plus de dupliquer 4 requêtes Supabase
// parallèles — un doublement injustifié de la pression concurrente sur SQLite
// pendant la fenêtre exacte où l'utilisateur peut être en train de créer/
// délivrer une carte. Cette garde ne corrige pas la cause du double
// déclenchement (hors périmètre autorisé, voir rapport final : STOP & WARN
// sur src/main/index.ts), mais neutralise son effet d'amplification ici,
// dans le module qui possède la logique de préchargement.
let _isPreloadingUsers = false;

/**
 * Récupère les données depuis Supabase modifiées après le watermark et les intègre localement.
 * Réalise la résolution de conflit (Pilier 4) et évite les boucles infinies.
 * Conformément à la Section 9, cette opération s'exécute par lots (chunks) de 500 maximum,
 * libérant périodiquement la RAM et le thread principal via un délai d'attente asynchrone.
 */
export async function runDownstream(siteId: number, force: boolean = false): Promise<number> {
  if (!siteId || isNaN(Number(siteId))) {
    log.warn("[SYNC] runDownstream appelé sans siteId valide. Synchronisation des cartes ignorée.");
    return 0;
  }

  const supabase = getSupabaseClient();
  if (!supabase) {
    log.warn('[runDownstream] Client Supabase non disponible — downstream ignoré.');
    return 0;
  }
  const db = getDatabase()!;

  // 1. TÉLÉCHARGER ET STOCKER LE SITE COURANT (t_sites)
  try {
    log.info(`[SYNC] Rapatriement du site courant (${siteId}) depuis Supabase...`);
    const { data: siteDataList, error: siteError } = await supabase
      .from('t_sites')
      .select('id, nom, code, is_active, max_centres, created_at, sync_id, expiry_date, is_permanent')
      .eq('id', siteId);

    if (siteError || !siteDataList || siteDataList.length === 0) {
      log.warn(`[SYNC] Site ${siteId} non trouvé ou erreur de requête.`, siteError ? siteError.message : "Aucune donnée");
      return 0;
    }
    const siteData = siteDataList[0];

    // ── Filet de sécurité FK (parité avec syncUsersFromCloud, ~ligne 452) ────
    // `INSERT OR REPLACE` sur une PK déjà existante est un DELETE+INSERT
    // implicite côté SQLite. t_centres référence t_sites(id) SANS
    // ON DELETE CASCADE (schema.ts) : le PRAGMA OFF/finally garantit que ce
    // cycle automatique (rejoué à chaque tirage downstream tant qu'un
    // utilisateur est connecté) ne peut jamais être bloqué par une violation
    // FK transitoire, quelle que soit l'activité concurrente sur t_centres/
    // t_cartes au même instant.
    db.exec('PRAGMA foreign_keys = OFF;');
    try {
      db.prepare(`
        INSERT OR REPLACE INTO t_sites (id, nom, code, is_active, max_centres, created_at, sync_id, expiry_date, is_permanent)
        VALUES (@id, @nom, @code, @is_active, @max_centres, @created_at, @sync_id, @expiry_date, @is_permanent)
      `).run({
        id: siteData.id,
        nom: siteData.nom,
        code: siteData.code,
        is_active: siteData.is_active !== undefined ? siteData.is_active : 1,
        max_centres: siteData.max_centres || 4,
        created_at: siteData.created_at || new Date().toISOString(),
        sync_id: siteData.sync_id || null,
        expiry_date: siteData.expiry_date || null,
        is_permanent: siteData.is_permanent ? 1 : 0
      });
    } finally {
      db.exec('PRAGMA foreign_keys = ON;');
    }
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
      .select('id, site_id, nom, numero, created_at, sync_id, prefixe_rangement, lieu')
      .eq('site_id', siteId);

    if (centresError) {
      log.error(`[SYNC] Impossible de récupérer les centres du site ${siteId} :`, centresError.message);
    } else if (centresData && centresData.length > 0) {
      // Même filet de sécurité FK que pour t_sites ci-dessus : t_cartes référence
      // centre_id sans cascade, et ce REPLACE tourne en boucle tant que la session
      // reste connectée.
      db.exec('PRAGMA foreign_keys = OFF;');
      try {
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
              code: null,
              lieu: c.lieu || null
            });
          }
        })();
      } finally {
        db.exec('PRAGMA foreign_keys = ON;');
      }
      log.info(`[SYNC] ${centresData.length} centres assurés localement pour le site ${siteId}.`);
    }
  } catch (err: any) {
    log.error(`[SYNC] Exception lors de la synchronisation des centres :`, err.message || err);
  }

  let totalMerged = 0;
  let hasMore = true;

  log.info(`[SYNC] Démarrage du pull pour site : ${siteId}`);
  log.info(`Downstream: Starting full sync for site ${siteId} in Low-Memory chunked mode (Force: ${force}).`);

  // Si on force la synchronisation, on réinitialise le watermark local AVANT de commencer les chunks.
  // De cette façon, les chunks pourront progresser normalement en lisant et mettant à jour le t_config.
  if (force) {
    try {
      db.prepare(`INSERT OR REPLACE INTO t_config (key, value) VALUES ('last_downstream_sync', '1970-01-01T00:00:00Z')`).run();
      db.prepare(`INSERT OR REPLACE INTO t_config (key, value) VALUES ('last_downstream_sync_id', '00000000-0000-0000-0000-000000000000')`).run();
    } catch (e) {
      log.error(`[SYNC] Erreur lors du reset du watermark (force = true) :`, e);
    }
  }

  let totalToPull = 0;
  try {
    let initialWatermark = '1970-01-01T00:00:00Z';
    let initialLastSyncId = '00000000-0000-0000-0000-000000000000';
    const configRow = db.prepare("SELECT value FROM t_config WHERE key = 'last_downstream_sync'").get() as { value: string } | undefined;
    if (configRow && configRow.value) {
      initialWatermark = configRow.value;
    }
    const configRowId = db.prepare("SELECT value FROM t_config WHERE key = 'last_downstream_sync_id'").get() as { value: string } | undefined;
    if (configRowId && configRowId.value) {
      initialLastSyncId = configRowId.value;
    }
    const { count } = await supabase.from('t_cartes')
      .select('*', { count: 'exact', head: true })
      .or(`updated_at.gt.${initialWatermark},and(updated_at.eq.${initialWatermark},sync_id.gt.${initialLastSyncId})`)
      .eq('id_site', siteId);
    if (count) totalToPull = count;
    log.info(`[SYNC] Total exact count returned by Supabase for downstream: ${totalToPull}`);
  } catch (err) {
    log.error(`[SYNC] Erreur lors du calcul du count downstream :`, err);
  }

  // Émission du progrès initial avec objet enrichi
  let currentProgress = 0;
  const emitProgress = (pct: number, merged: number, total: number) => {
    BrowserWindow.getAllWindows().forEach(w =>
      w.webContents.send('sync:downstream-progress', { progress: pct, merged, total })
    );
  };
  if (totalToPull > 0) {
    emitProgress(0, 0, totalToPull);
  }

  let totalFetched = 0;

  while (hasMore) {
    const { fetched, processed } = await runDownstreamChunk(siteId);
    totalFetched += fetched;
    totalMerged += processed;

    if (fetched < 500) {
      hasMore = false;
    } else {
      log.info(`Downstream: Chunk of 500 processed. Yielding CPU & RAM...`);
      // Pause asynchrone de 300ms pour laisser respirer Windows, le garbage collector et les requêtes de l'interface (Sec 9)
      await new Promise(resolve => setTimeout(resolve, 300));
    }

    if (totalToPull > 0) {
      let progress = Math.round((totalFetched / totalToPull) * 100);
      if (progress >= 100 && hasMore) {
        progress = 99; // Ne jamais afficher 100% tant que c'est pas vraiment fini
      } else if (progress > 100) {
        progress = 100;
      }
      currentProgress = progress;
      emitProgress(currentProgress, totalFetched, totalToPull);
    } else if (hasMore) {
      // Si on n'a pas de totalToPull, on simule une progression qui bloque à 99%
      currentProgress = 99;
      emitProgress(99, totalFetched, 0);
    }
  }

  // ── Marge de sécurité sur le watermark persisté (protection anti-décalage d'horloge) ──
  // Le watermark a déjà été avancé précisément, chunk par chunk, jusqu'au updated_at exact
  // de la dernière carte reçue (download-worker.js). On le recule ici d'un petit tampon
  // avant de conclure ce cycle : si le poste qui a ENVOYÉ une carte a une horloge légèrement
  // en retard, son updated_at de poussée peut être antérieur à ce que d'autres postes ont
  // déjà vu. Ce tampon garantit qu'un prochain tirage réexamine cette fenêtre récente — au
  // prix d'un nombre borné de cartes déjà à jour re-fetchées inutilement (sans risque,
  // l'upsert/merge est idempotent).
  // N'agit QUE si ce cycle a réellement avancé le watermark (totalFetched > 0) : sinon,
  // la valeur déjà persistée est déjà un ancien recul appliqué, et reculer à nouveau à
  // chaque cycle sans nouvelles données ferait dériver le watermark indéfiniment vers
  // le passé (fenêtre de re-fetch grandissant sans borne à chaque cycle inactif).
  if (totalFetched > 0) {
    const WATERMARK_SAFETY_BUFFER_MS = 2 * 60 * 1000;
    try {
      const finalWatermarkRow = db.prepare("SELECT value FROM t_config WHERE key = 'last_downstream_sync'").get() as { value: string } | undefined;
      const finalSyncIdRow = db.prepare("SELECT value FROM t_config WHERE key = 'last_downstream_sync_id'").get() as { value: string } | undefined;
      if (finalWatermarkRow?.value) {
        const rewound = new Date(new Date(finalWatermarkRow.value).getTime() - WATERMARK_SAFETY_BUFFER_MS).toISOString();
        db.transaction(() => {
          // ── Repère d'affichage "vrai point atteint" (NON reculé) ────────────────
          // Distinct du curseur de sécurité ci-dessous : ce couple de clés capture la
          // position EXACTE (non tamponnée) où ce pull s'est arrêté, avant d'appliquer
          // le recul anti-décalage d'horloge. Consommé exclusivement par
          // sync:getCloudCartesCount (handlers.ts) pour afficher un compteur "reste à
          // télécharger" qui ne recompte jamais du contenu déjà rapatrié à l'instant.
          // Ne JAMAIS lire ces clés pour piloter un vrai pull (runDownstream/
          // runDownstreamChunk) — seul le curseur de sécurité 'last_downstream_sync'/
          // '_id' ci-dessous doit servir de base au prochain pull réel.
          db.prepare(`INSERT OR REPLACE INTO t_config (key, value) VALUES ('last_downstream_sync_true', ?)`).run(finalWatermarkRow.value);
          db.prepare(`INSERT OR REPLACE INTO t_config (key, value) VALUES ('last_downstream_sync_true_id', ?)`).run(finalSyncIdRow?.value || '00000000-0000-0000-0000-000000000000');

          // ── Curseur de sécurité (pull) — comportement inchangé ──────────────────
          db.prepare(`INSERT OR REPLACE INTO t_config (key, value) VALUES ('last_downstream_sync', ?)`).run(rewound);
          db.prepare(`INSERT OR REPLACE INTO t_config (key, value) VALUES ('last_downstream_sync_id', '00000000-0000-0000-0000-000000000000')`).run();
        })();
      }
    } catch (err) {
      log.warn('[SYNC] Impossible d\'appliquer la marge de sécurité sur le watermark :', err);
    }
  }

  // Émission finale : 100% réel
  emitProgress(100, totalFetched, totalToPull > 0 ? totalToPull : totalFetched);

  log.info(`Downstream: Sync completed. Total merged: ${totalMerged} records.`);

  // 🔔 Notification unique finale — émise UNE SEULE FOIS avec le vrai total
  if (totalMerged > 0) {
    try {
      const db = getDatabase()!;
      db.prepare(`
        INSERT INTO t_logs (id_user, login_user, action, detail, valeur_apres, sync_id, is_dirty, site_id)
        VALUES (NULL, 'SYSTEM', 'SYNC_UPDATE', ?, '{"read": false}', ?, 1, ?)
      `).run(`${totalMerged} cartes synchronisées depuis le Cloud.`, uuidv4(), siteId);
    } catch (err) {
      log.error('Failed to record downstream log:', err);
    }
    BrowserWindow.getAllWindows().forEach(w =>
      w.webContents.send('sync:updated-data', { count: totalMerged })
    );
  }

  return totalMerged;
}

/**
 * Traite un unique lot (chunk) de 500 cartes maximum de Supabase via Worker.
 */
async function runDownstreamChunk(siteId: number): Promise<{ fetched: number; processed: number }> {
  const db = getDatabase()!;
  
  // 1. Récupération du watermark local dans t_config
  let watermark = '1970-01-01T00:00:00Z';
  let lastSyncId = '00000000-0000-0000-0000-000000000000';

  const configRow = db.prepare("SELECT value FROM t_config WHERE key = 'last_downstream_sync'").get() as { value: string } | undefined;
  if (configRow && configRow.value) {
    watermark = configRow.value;
  }
  const configRowId = db.prepare("SELECT value FROM t_config WHERE key = 'last_downstream_sync_id'").get() as { value: string } | undefined;
  if (configRowId && configRowId.value) {
    lastSyncId = configRowId.value;
  }

  log.info(`Downstream Chunk: Fetching updates on t_cartes from Supabase since ${watermark} (sync_id > ${lastSyncId}) for site ${siteId}...`);
  const supabase = getSupabaseClient();
  if (!supabase) {
    log.warn('[runDownstreamChunk] Client Supabase non disponible — chunk ignoré.');
    return { fetched: 0, processed: 0 };
  }

  // 2. Requête Supabase avec AbortController
  const controller = new AbortController();
  const timeoutId = setTimeout(() => { controller.abort(); }, 10000);

  let cloudCards: any[] | null = null;
  try {
    const { data, error } = await supabase
      .from('t_cartes')
      .select('*')
      .or(`updated_at.gt.${watermark},and(updated_at.eq.${watermark},sync_id.gt.${lastSyncId})`)
      .eq('id_site', siteId)
      .order('updated_at', { ascending: true })
      .order('sync_id', { ascending: true })
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
      log.warn("⚠️ [SUPABASE] Requête downstream interrompue : Timeout. Passage en mode dégradé.");
      return { fetched: 0, processed: 0 };
    }
    throw err;
  }

  if (!cloudCards || cloudCards.length === 0) {
    return { fetched: 0, processed: 0 };
  }

  log.info(`Downstream Chunk: Found ${cloudCards.length} updates on Cloud. Sending to Worker...`);

  // 3. Délégation au Worker pour l'insertion SQLite (zéro gel UI)
  return new Promise((resolve, reject) => {
    let sqlitePath: string;
    try {
      sqlitePath = require.resolve('better-sqlite3');
    } catch {
      sqlitePath = 'better-sqlite3';
    }

    const workerPath = join(__dirname, 'workers', 'download-worker.js');
    const worker = new Worker(workerPath, {
      workerData: { dbPath: getDbPath(), sqlitePath }
    });

    let chunkResult: { fetched: number; processed: number } | null = null;
    let chunkError: Error | null = null;

    worker.on('message', (msg) => {
      if (msg.type === 'log') {
        if (msg.level === 'error') log.error(msg.message);
        else log.info(msg.message);
      } else if (msg.type === 'chunk-done') {
        log.info(`✅ [SYNC SUCCESS] ${cloudCards!.length} cartes reçues (fusionnées: ${msg.processed}) par le worker.`);
        // fetched = pagination réelle (pour savoir s'il reste des pages sur Supabase) ;
        // processed = nombre de cartes réellement insérées/mises à jour localement
        // (certaines cartes reçues peuvent être déjà à jour et donc ignorées par le worker).
        chunkResult = { fetched: cloudCards!.length, processed: msg.processed || 0 };
        worker.postMessage({ type: 'close' });
      } else if (msg.type === 'error') {
        log.error(`[DownloadWorker] Erreur: ${msg.message}`);
        chunkError = new Error(msg.message);
        worker.postMessage({ type: 'close' });
      }
    });

    worker.on('error', (err) => {
      log.error(`[DownloadWorker] Fatal error:`, err);
      reject(err);
    });

    worker.on('exit', (code) => {
      if (code !== 0) log.warn(`[DownloadWorker] Exited with code ${code}`);
      if (chunkError) reject(chunkError);
      else resolve(chunkResult || { fetched: 0, processed: 0 });
    });

    worker.postMessage({
      type: 'write-chunk',
      cloudCards,
      watermark,
      lastSyncId,
      siteId
    });
  });
}

/**
 * Télécharge proactivement tous les utilisateurs actifs rattachés à ce site
 * depuis Supabase et les insère localement en SQLite.
 */
export async function syncUsersFromCloud(siteId: number): Promise<number> {
  const db = getDatabase()!;
  const supabase = getSupabaseClient();
  if (!supabase) {
    log.warn('[syncUsersFromCloud] Client Supabase non disponible — sync utilisateurs ignoré.');
    return 0;
  }

  log.info(`Downstream: Synchronisation préliminaire du site ${siteId} depuis Supabase...`);
  
  // --- ÉTAPE PRÉALABLE : SÉCURISATION DU PARENT (t_sites) ---
  try {
    const { data: siteDataList, error: siteError } = await supabase
      .from('t_sites')
      .select('id, nom, code, is_active, max_centres, created_at, sync_id, expiry_date, is_permanent')
      .eq('id', siteId);

    if (siteError || !siteDataList || siteDataList.length === 0) {
      log.warn(`[syncUsersFromCloud] Site parent ${siteId} non trouvé ou erreur de requête.`, siteError ? siteError.message : "Aucune donnée");
      return 0;
    }
    const siteData = siteDataList[0];

    // Filet de sécurité FK (parité avec la garde déjà appliquée un peu plus
    // bas dans cette même fonction pour t_users) : voir le commentaire détaillé
    // sur le premier INSERT OR REPLACE t_sites de ce fichier (runDownstream).
    db.exec('PRAGMA foreign_keys = OFF;');
    try {
      db.prepare(`
        INSERT OR REPLACE INTO t_sites (id, nom, code, is_active, max_centres, created_at, sync_id, expiry_date, is_permanent)
        VALUES (@id, @nom, @code, @is_active, @max_centres, @created_at, @sync_id, @expiry_date, @is_permanent)
      `).run({
        id: siteData.id,
        nom: siteData.nom,
        code: siteData.code,
        is_active: siteData.is_active !== undefined ? siteData.is_active : 1,
        max_centres: siteData.max_centres || 4,
        created_at: siteData.created_at || new Date().toISOString(),
        sync_id: siteData.sync_id || null,
        expiry_date: siteData.expiry_date || null,
        is_permanent: siteData.is_permanent ? 1 : 0
      });
    } finally {
      db.exec('PRAGMA foreign_keys = ON;');
    }
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
    'OPERATEUR_LOGISTIQUE', 'OPERATEUR_INVENTAIRE', 'OPERATEUR_APUREMENT'
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

  // ── Synchronisation descendante des rôles multiples (t_user_roles) ──
  const userSyncIds = cloudUsers.map(u => u.sync_id).filter(Boolean);
  if (userSyncIds.length > 0) {
    try {
      const { data: cloudRoles, error: rolesErr } = await supabase
        .from('t_user_roles')
        .select('user_sync_id, role')
        .in('user_sync_id', userSyncIds);

      if (!rolesErr && cloudRoles) {
        db.exec('PRAGMA foreign_keys = OFF;');
        try {
          db.transaction(() => {
            for (const u of cloudUsers) {
              if (!u.sync_id && !u.login) continue;
              const localRow = db.prepare('SELECT id_user FROM t_users WHERE sync_id = ? OR login = ?').get(u.sync_id, u.login) as { id_user: number } | undefined;
              if (localRow) {
                db.prepare('DELETE FROM t_user_roles WHERE id_user = ?').run(localRow.id_user);
                const userRoles = cloudRoles.filter(r => r.user_sync_id === u.sync_id);
                for (const r of userRoles) {
                  if (validRoles.includes(r.role)) {
                    db.prepare('INSERT OR IGNORE INTO t_user_roles (id_user, role) VALUES (?, ?)').run(localRow.id_user, r.role);
                  }
                }
                if (u.role && validRoles.includes(u.role)) {
                  db.prepare('INSERT OR IGNORE INTO t_user_roles (id_user, role) VALUES (?, ?)').run(localRow.id_user, u.role);
                }
              }
            }
          })();
        } finally {
          db.exec('PRAGMA foreign_keys = ON;');
        }
      } else if (rolesErr) {
        log.warn(`[syncUsersFromCloud] Erreur lors de la récupération des multi-rôles depuis Supabase : ${rolesErr.message}`);
      }
    } catch (roleCatchErr: any) {
      log.warn(`[syncUsersFromCloud] Exception lors du rapatriement de t_user_roles : ${roleCatchErr.message}`);
    }
  }

  if (count > 0) {
    log.info(`Downstream: ${count} utilisateur(s) inséré(s)/mis à jour depuis Supabase pour le site ${siteId}.`);
  } else {
    log.info(`Downstream: Aucun nouveau compte à insérer ou mettre à jour pour le site ${siteId} (déjà à jour).`);
  }
  return count;
}

/**
 * Correctif P0-2 : `syncUsersFromCloud()` ci-dessus filtre sa requête Supabase
 * avec `.eq('statut_actif', 1)` — un compte désactivé côté Cloud n'apparaît donc
 * JAMAIS dans ses résultats et n'est jamais réécrit en local, ce qui empêche
 * `refreshSecureCurrentUser()` (session-heartbeat.ts) de détecter la désactivation
 * pendant une session active.
 *
 * Cette fonction est un ajout indépendant et ciblé : elle interroge Supabase
 * uniquement pour l'utilisateur de la session courante (login + site_id) et,
 * si le compte est désactivé ou introuvable côté Cloud, met à jour EN LOCAL
 * uniquement la colonne `statut_actif` — jamais aucune autre colonne, jamais
 * `is_dirty`, jamais l'Outbox/t_sync_queue (cette écriture ne doit pas être
 * remontée vers le Cloud, c'est une simple réplique descendante d'un état déjà
 * décidé côté serveur).
 *
 * Comportement fail-open volontaire : toute erreur réseau/Supabase est
 * capturée silencieusement (log `warn`) sans toucher à l'état local — un
 * problème réseau ponctuel ne doit jamais éjecter un utilisateur légitime.
 *
 * Remarque : cette fonction n'est PAS appelée depuis ce fichier. Le câblage
 * dans le cycle de synchro (sync-engine.ts) est délibérément hors périmètre
 * de cet ajout et sera réalisé séparément.
 */
export async function syncCurrentUserActiveStatus(login: string, siteId: number): Promise<void> {
  if (!login || !siteId || isNaN(Number(siteId))) {
    return;
  }

  const supabase = getSupabaseClient();
  if (!supabase) {
    log.warn('[syncCurrentUserActiveStatus] Client Supabase non disponible — vérification ignorée.');
    return;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, 10000);

  let cloudRow: { login: string; statut_actif: number } | null = null;
  try {
    const { data, error } = await supabase
      .from('t_users')
      .select('login, statut_actif')
      .eq('login', login)
      .eq('site_id', siteId)
      .abortSignal(controller.signal);

    clearTimeout(timeoutId);

    if (error) {
      log.warn(`[syncCurrentUserActiveStatus] Erreur Supabase pour "${login}" : ${error.message}`);
      return;
    }
    cloudRow = data && data.length > 0 ? data[0] : null;
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError' || err.message?.includes('aborted') || controller.signal.aborted) {
      log.warn(`[SUPABASE] syncCurrentUserActiveStatus timeout pour "${login}". Aborted. Passing in degraded mode.`);
    } else {
      log.warn(`[syncCurrentUserActiveStatus] Exception pour "${login}" : ${err.message || err}`);
    }
    return;
  }

  // Compte présent côté Cloud et actif : rien à faire.
  if (cloudRow && cloudRow.statut_actif === 1) {
    return;
  }

  // Compte absent côté Cloud (supprimé) OU désactivé : réplique locale ciblée,
  // strictement mono-colonne, sans toucher is_dirty ni aucune autre colonne.
  try {
    const db = getDatabase()!;
    db.prepare(`UPDATE t_users SET statut_actif = 0 WHERE login = ?`).run(login);
    log.warn(`[syncCurrentUserActiveStatus] Compte "${login}" désactivé/supprimé côté Cloud — statut_actif réaligné localement à 0.`);
  } catch (err: any) {
    log.warn(`[syncCurrentUserActiveStatus] Exception lors de la mise à jour locale de "${login}" : ${err.message || err}`);
  }
}

/**
 * Pré-charge tous les utilisateurs depuis Supabase et les insère/met à jour
 * localement via un INSERT OR REPLACE.
 */
export async function preloadUsersFromCloud(): Promise<void> {
  if (_isPreloadingUsers) {
    log.warn('[preloadUsersFromCloud] Appel ignoré : un préchargement est déjà en cours (garde de réentrance).');
    return;
  }
  _isPreloadingUsers = true;
  log.info('Preload: Rapatriement en tâche de fond de tous les utilisateurs depuis Supabase...');
  log.info("📥 [SUPABASE] Tentative de préchargement des utilisateurs depuis le cloud...");
  try {
    const db = getDatabase();
    if (!db) {
      log.warn('Preload: Base de données non initialisée, impossible de pré-charger les utilisateurs.');
      return;
    }
    const supabase = getSupabaseClient();
    if (!supabase) {
      log.warn('[preloadUsersFromCloud] Client Supabase non disponible — preload ignoré (mode dégradé).');
      return;
    }

    // Vérification de la présence des tables critiques dans SQLite
    const checkTableExists = (tableName: string): boolean => {
      try {
        const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(tableName);
        return !!row;
      } catch (e) {
        return false;
      }
    };

    for (const table of ['t_sites', 't_centres', 't_users']) {
      if (!checkTableExists(table)) {
        logAudit('SYSTEM', 'SYS_INIT_TABLE_MISSING', { table });
      }
    }

    log.info('Preload: Récupération parallèle (sites, centres, users, roles) depuis Supabase...');
    
    // R2: Paralléliser les 4 requêtes Supabase pour réduire le temps de Cold Start (P1)
    const [sitesPromise, centresPromise, usersPromise, rolesPromise] = await Promise.all([
      supabase.from('t_sites').select('id, nom, code, is_active, max_centres, created_at, sync_id, expiry_date, is_permanent'),
      supabase.from('t_centres').select('id, site_id, nom, numero, created_at, sync_id, prefixe_rangement, lieu'),
      supabase.from('t_users').select('login, password_hash, role, nom_user, prenom_user, email, telephone, statut_actif, site_id, centre_id, poste_id, avatar_url, last_login, created_at, updated_at, sync_id'),
      supabase.from('t_user_roles').select('user_sync_id, role')
    ]);

    const { data: sitesData, error: sitesError } = sitesPromise;
    const { data: centresData, error: centresError } = centresPromise;
    const { data: cloudUsers, error: error } = usersPromise;
    const { data: cloudRoles, error: rolesErr } = rolesPromise;

    // --- 1. INSERTION DES SITES ---
    try {
      if (sitesError) {
        log.error('Preload: Impossible de pré-charger les sites parents :', sitesError.message);
        logAudit('SYSTEM', 'SYS_INIT_EMPTY_TABLE', { table: 't_sites', error: sitesError.message });
      } else if (!sitesData || sitesData.length === 0) {
        logAudit('SYSTEM', 'SYS_INIT_EMPTY_TABLE', { table: 't_sites', error: 'Données non récupérées ou vides' });
      } else {
        // Filet de sécurité FK — même justification que runDownstream/syncUsersFromCloud.
        db.exec('PRAGMA foreign_keys = OFF;');
        try {
          db.transaction(() => {
            const insertSiteStmt = db.prepare(`
              INSERT OR REPLACE INTO t_sites (id, nom, code, is_active, max_centres, created_at, sync_id, expiry_date, is_permanent)
              VALUES (@id, @nom, @code, @is_active, @max_centres, @created_at, @sync_id, @expiry_date, @is_permanent)
            `);
            for (const s of sitesData) {
              insertSiteStmt.run({
                id: s.id,
                nom: s.nom,
                code: s.code,
                is_active: s.is_active !== undefined ? s.is_active : 1,
                max_centres: s.max_centres || 4,
                created_at: s.created_at || new Date().toISOString(),
                sync_id: s.sync_id || null,
                expiry_date: s.expiry_date || null,
                is_permanent: s.is_permanent ? 1 : 0
              });
            }
          })();
        } finally {
          db.exec('PRAGMA foreign_keys = ON;');
        }
        log.info(`Preload: ${sitesData.length} sites parents assurés localement.`);
        logAudit('SYSTEM', 'SYS_BOOTSTRAP_INIT', { table: 't_sites', count: sitesData.length });
      }
    } catch (siteErr: any) {
      log.error('Preload: Exception lors de la récupération préliminaire des sites parents :', siteErr.message || siteErr);
      logAudit('SYSTEM', 'SYS_INIT_EMPTY_TABLE', { table: 't_sites', error: siteErr.message || String(siteErr) });
    }

    // --- 2. INSERTION DES CENTRES ---
    try {
      if (centresError) {
        log.error('Preload: Impossible de pré-charger les centres parents :', centresError.message);
        logAudit('SYSTEM', 'SYS_INIT_EMPTY_TABLE', { table: 't_centres', error: centresError.message });
      } else if (!centresData || centresData.length === 0) {
        logAudit('SYSTEM', 'SYS_INIT_EMPTY_TABLE', { table: 't_centres', error: 'Données non récupérées' });
      } else {
        // Filet de sécurité FK — même justification que runDownstream/syncUsersFromCloud.
        db.exec('PRAGMA foreign_keys = OFF;');
        try {
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
                code: null,
                lieu: c.lieu || null
              });
            }
          })();
        } finally {
          db.exec('PRAGMA foreign_keys = ON;');
        }
        log.info(`Preload: ${centresData.length} centres parents assurés localement.`);
        logAudit('SYSTEM', 'SYS_BOOTSTRAP_INIT', { table: 't_centres', count: centresData.length });
      }
    } catch (centreErr: any) {
      log.error('Preload: Exception lors de la récupération préliminaire des centres parents :', centreErr.message || centreErr);
      logAudit('SYSTEM', 'SYS_INIT_EMPTY_TABLE', { table: 't_centres', error: centreErr.message || String(centreErr) });
    }
    
    // --- 3. INSERTION DES UTILISATEURS ---
    if (error) {
      log.error(`Preload error querying t_users on Supabase: ${error.message}`);
      log.error(`❌ [SUPABASE] Échec du préchargement des utilisateurs : ${error.message}`);
      logAudit('SYSTEM', 'SYS_INIT_EMPTY_TABLE', { table: 't_users', error: error.message });
      return;
    }

    if (!cloudUsers || cloudUsers.length === 0) {
      log.warn('Preload: Supabase a retourné 0 utilisateur. Si des comptes existent bien sur Supabase, vérifier les politiques RLS (Row Level Security) sur la table t_users — elles peuvent filtrer les résultats sans générer d\'erreur visible.');
      log.warn('⚠️ [SUPABASE] La table t_users renvoie 0 ligne. Si des comptes existent sur Supabase, vérifier les règles RLS (Row Level Security) : une politique trop restrictive renvoie [] sans erreur.');
      logAudit('SYSTEM', 'SYS_INIT_EMPTY_TABLE', { table: 't_users', error: 'Données non récupérées ou vides (vérifier RLS)' });
      return;
    }

    log.info(`📥 [SUPABASE] ${cloudUsers.length} utilisateurs récupérés avec succès depuis le cloud.`);

    db.exec('PRAGMA foreign_keys = OFF;');
    try {
      db.transaction(() => {
        const insertStmt = db.prepare(`
          INSERT INTO t_users (
            login, password_hash, role, nom_user, prenom_user, email, telephone, 
            statut_actif, site_id, centre_id, poste_id, avatar_url, last_login, 
            created_at, updated_at, sync_id, is_dirty
          ) VALUES (
            @login, @password_hash, @role, @nom_user, @prenom_user, @email, @telephone, 
            @statut_actif, @site_id, @centre_id, @poste_id, @avatar_url, @last_login, 
            @created_at, @updated_at, @sync_id, 0
          )
          ON CONFLICT(login) DO UPDATE SET
            password_hash = excluded.password_hash,
            role = excluded.role,
            nom_user = excluded.nom_user,
            prenom_user = excluded.prenom_user,
            email = excluded.email,
            telephone = excluded.telephone,
            statut_actif = excluded.statut_actif,
            site_id = COALESCE(t_users.site_id, excluded.site_id),
            centre_id = COALESCE(t_users.centre_id, excluded.centre_id),
            sync_id = COALESCE(t_users.sync_id, excluded.sync_id),
            updated_at = excluded.updated_at
          WHERE t_users.is_dirty = 0
        `);

        // Validation des rôles également dans preload pour éviter les violations de contrainte CHECK
        const validRolesPreload = [
          'SUPER ADMIN', 'ADMINISTRATEUR_SITE', 'ADMIN_CENTRE',
          'OPERATEUR_VERIFICATION', 'OPERATEUR_QUALITE', 'OPERATEUR_SAISIE',
          'OPERATEUR_LOGISTIQUE', 'OPERATEUR_INVENTAIRE', 'OPERATEUR_APUREMENT'
        ];

        for (const u of cloudUsers) {
          if (!validRolesPreload.includes(u.role)) {
            log.warn(`[preloadUsersFromCloud] Rôle invalide ignoré pour "${u.login}": "${u.role}".`);
            log.warn(`⚠️ [PRELOAD] Compte "${u.login}" ignoré : rôle "${u.role}" non reconnu.`);
            continue;
          }
          insertStmt.run({
            login: u.login,
            password_hash: u.password_hash,
            role: u.role,
            nom_user: u.nom_user || null,
            prenom_user: u.prenom_user || null,
            email: u.email || null,
            telephone: u.telephone || null,
            statut_actif: u.statut_actif !== undefined ? u.statut_actif : 1,
            site_id: u.site_id !== undefined && u.site_id !== null ? u.site_id : null,
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
      log.info(`Preload: ${cloudUsers.length} utilisateurs synchronisés (INSERT ON CONFLICT) avec succès.`);
      logAudit('SYSTEM', 'SYS_BOOTSTRAP_INIT', { table: 't_users', count: cloudUsers.length });
    } finally {
      db.exec('PRAGMA foreign_keys = ON;');
      log.info('Preload: Contraintes de clés étrangères (foreign_keys) réactivées.');
    }

    // ── Synchronisation descendante des rôles multiples pour tous les comptes préchargés ──
    try {
      if (!rolesErr && cloudRoles) {
        db.exec('PRAGMA foreign_keys = OFF;');
        try {
          db.transaction(() => {
            const validRolesPreload = [
              'SUPER ADMIN', 'ADMINISTRATEUR_SITE', 'ADMIN_CENTRE',
              'OPERATEUR_VERIFICATION', 'OPERATEUR_QUALITE', 'OPERATEUR_SAISIE',
              'OPERATEUR_LOGISTIQUE', 'OPERATEUR_INVENTAIRE', 'OPERATEUR_APUREMENT'
            ];
            for (const u of cloudUsers) {
              if (!u.sync_id && !u.login) continue;
              const localRow = db.prepare('SELECT id_user FROM t_users WHERE sync_id = ? OR login = ?').get(u.sync_id, u.login) as { id_user: number } | undefined;
              if (localRow) {
                db.prepare('DELETE FROM t_user_roles WHERE id_user = ?').run(localRow.id_user);
                const userRoles = cloudRoles.filter(r => r.user_sync_id === u.sync_id);
                for (const r of userRoles) {
                  if (validRolesPreload.includes(r.role)) {
                    db.prepare('INSERT OR IGNORE INTO t_user_roles (id_user, role) VALUES (?, ?)').run(localRow.id_user, r.role);
                  }
                }
                if (u.role && validRolesPreload.includes(u.role)) {
                  db.prepare('INSERT OR IGNORE INTO t_user_roles (id_user, role) VALUES (?, ?)').run(localRow.id_user, u.role);
                }
              }
            }
          })();
          log.info(`Preload: ${cloudRoles.length} multi-rôles synchronisés dans t_user_roles.`);
        } finally {
          db.exec('PRAGMA foreign_keys = ON;');
        }
      } else if (rolesErr) {
        log.warn(`Preload: Erreur lors du pré-chargement de t_user_roles : ${rolesErr.message}`);
      }
    } catch (roleCatchErr: any) {
      log.warn(`Preload: Exception lors du pré-chargement de t_user_roles : ${roleCatchErr.message}`);
    }
  } catch (err: any) {
    log.error('Preload: Exception attrapée lors de la synchronisation des utilisateurs (mode hors-ligne ou erreur réseau) :', err.message || err);
  } finally {
    _isPreloadingUsers = false;
  }
}

/**
 * Pull chunké (par lots de 500) des entrées `t_logs` synchronisables — actions CRUD métier de
 * la liste blanche CRUD_SYNC_WHITELIST (voir src/main/utils/audit.ts) — depuis Supabase.
 *
 * Fonction NOUVELLE et volontairement ISOLÉE : elle ne modifie ni ne partage d'état avec
 * runDownstream/runDownstreamChunk (dédiées à t_cartes) ci-dessus. Watermark dédié dans
 * t_config ('last_downstream_sync_logs' / '_id'), jamais les clés watermark des cartes.
 *
 * Cloisonnement P0 : filtrage `.eq('site_id', siteId)` appliqué CÔTÉ SERVEUR (obligatoire),
 * plus une double vérification défensive côté client dans runLogsDownstreamChunk.
 *
 * Politique low-memory (§2) : chunks ≤ 500, pause asynchrone de 300ms entre chunks pour
 * libérer le thread principal (mêmes constantes que runDownstream ci-dessus).
 *
 * Câblage (décision utilisateur validée) : appelée depuis
 *  - sync-engine.ts (triggerAutoDownstream, cycle automatique de 2h), juste après
 *    runDownstream(siteId) — échec non-bloquant, isolé dans son propre try/catch.
 *  - handlers.ts, sync:pullSiteCards (pull manuel des cartes par l'admin de site) et
 *    sync:forceFullPull (pull complet sans cache, maintenance), mêmes garanties.
 * Dans les trois cas, un échec de runLogsDownstream ne remet jamais en cause le pull des
 * cartes déjà effectué avec succès juste avant.
 */
export async function runLogsDownstream(siteId: number): Promise<number> {
  if (!siteId || isNaN(Number(siteId))) {
    log.warn('[SYNC][t_logs] runLogsDownstream appelé sans siteId valide. Pull ignoré.');
    return 0;
  }
  const supabase = getSupabaseClient();
  if (!supabase) {
    log.warn('[SYNC][t_logs] Client Supabase non disponible — pull t_logs ignoré.');
    return 0;
  }
  const db = getDatabase();
  if (!db) return 0;

  let totalMerged = 0;
  let hasMore = true;

  while (hasMore) {
    const { fetched, processed } = await runLogsDownstreamChunk(siteId);
    totalMerged += processed;

    if (fetched < 500) {
      hasMore = false;
    } else {
      log.info('[SYNC][t_logs] Chunk de 500 traité. Pause asynchrone (low-memory)...');
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  }

  if (totalMerged > 0) {
    log.info(`[SYNC][t_logs] ${totalMerged} entrée(s) CRUD cross-poste synchronisée(s) localement pour le site ${siteId}.`);
  }

  return totalMerged;
}

/**
 * Traite un unique lot (chunk) de 500 entrées `t_logs` maximum depuis Supabase.
 * Idempotence assurée par une vérification manuelle "SELECT ... WHERE sync_id = ?" avant
 * insertion (t_logs.sync_id n'a PAS de contrainte UNIQUE côté SQLite local — contrairement à
 * Supabase — donc pas d'`ON CONFLICT` possible sans migration de schéma ; ce pattern
 * manuel reproduit exactement celui déjà utilisé pour t_cartes dans download-worker.js).
 */
async function runLogsDownstreamChunk(siteId: number): Promise<{ fetched: number; processed: number }> {
  const db = getDatabase();
  if (!db) return { fetched: 0, processed: 0 };
  const supabase = getSupabaseClient();
  if (!supabase) return { fetched: 0, processed: 0 };

  let watermark = '1970-01-01T00:00:00Z';
  let lastSyncId = '00000000-0000-0000-0000-000000000000';
  const wmRow = db.prepare("SELECT value FROM t_config WHERE key = 'last_downstream_sync_logs'").get() as { value: string } | undefined;
  if (wmRow?.value) watermark = wmRow.value;
  const wmIdRow = db.prepare("SELECT value FROM t_config WHERE key = 'last_downstream_sync_logs_id'").get() as { value: string } | undefined;
  if (wmIdRow?.value) lastSyncId = wmIdRow.value;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => { controller.abort(); }, 10000);

  let cloudLogs: any[] | null = null;
  try {
    const { data, error } = await supabase
      .from('t_logs')
      .select('id_user, login_user, action, detail, valeur_avant, valeur_apres, date_heure, centre_id, site_id, sync_id')
      // Cloisonnement P0 : filtrage obligatoire côté serveur sur le site de l'appelant.
      .eq('site_id', siteId)
      .or(`date_heure.gt.${watermark},and(date_heure.eq.${watermark},sync_id.gt.${lastSyncId})`)
      .order('date_heure', { ascending: true })
      .order('sync_id', { ascending: true })
      .limit(500)
      .abortSignal(controller.signal);

    clearTimeout(timeoutId);

    if (error) {
      log.error(`[SYNC][t_logs] Échec du pull t_logs pour le site ${siteId} : ${error.message}`);
      return { fetched: 0, processed: 0 };
    }
    cloudLogs = data;
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError' || err.message?.includes('aborted') || controller.signal.aborted) {
      log.warn(`[SYNC][t_logs] Requête pull t_logs interrompue (timeout) pour le site ${siteId}. Mode dégradé.`);
      return { fetched: 0, processed: 0 };
    }
    log.error(`[SYNC][t_logs] Exception lors du pull t_logs pour le site ${siteId} :`, err.message || err);
    return { fetched: 0, processed: 0 };
  }

  if (!cloudLogs || cloudLogs.length === 0) {
    return { fetched: 0, processed: 0 };
  }

  let processed = 0;
  let latestDateHeure = watermark;
  let latestSyncId = lastSyncId;

  // Filet de sécurité FK (id_user référence t_users(id_user) localement) — même justification
  // que pour t_cartes/t_users plus haut dans ce fichier : un id_user peut ne pas (encore)
  // exister localement sur ce poste au moment du pull.
  db.exec('PRAGMA foreign_keys = OFF;');
  try {
    db.transaction(() => {
      const existsStmt = db.prepare('SELECT id_log FROM t_logs WHERE sync_id = ?');
      const insertStmt = db.prepare(`
        INSERT INTO t_logs (id_user, login_user, action, detail, valeur_avant, valeur_apres, date_heure, centre_id, site_id, sync_id, is_dirty)
        VALUES (@id_user, @login_user, @action, @detail, @valeur_avant, @valeur_apres, @date_heure, @centre_id, @site_id, @sync_id, 0)
      `);

      for (const row of cloudLogs!) {
        if (!row.sync_id || !row.date_heure) continue;

        // Double sécurité cloisonnement (P0) : la clause .eq('site_id', siteId) côté serveur
        // garantit déjà le périmètre ; ce filtre local est une défense en profondeur.
        if (Number(row.site_id) !== Number(siteId)) continue;

        if (row.date_heure > latestDateHeure || (row.date_heure === latestDateHeure && row.sync_id > latestSyncId)) {
          latestDateHeure = row.date_heure;
          latestSyncId = row.sync_id;
        }

        const existing = existsStmt.get(row.sync_id);
        if (existing) continue; // Déjà rapatrié localement (idempotence, pas d'UPDATE — entrées de journal immuables)

        insertStmt.run({
          id_user: row.id_user ?? null,
          login_user: row.login_user ?? null,
          action: row.action,
          detail: row.detail ?? null,
          valeur_avant: row.valeur_avant ?? null,
          valeur_apres: row.valeur_apres ?? null,
          date_heure: row.date_heure,
          centre_id: row.centre_id ?? null,
          site_id: row.site_id,
          sync_id: row.sync_id
        });
        processed++;
      }

      db.prepare(`INSERT OR REPLACE INTO t_config (key, value) VALUES ('last_downstream_sync_logs', ?)`).run(latestDateHeure);
      db.prepare(`INSERT OR REPLACE INTO t_config (key, value) VALUES ('last_downstream_sync_logs_id', ?)`).run(latestSyncId);
    })();
  } finally {
    db.exec('PRAGMA foreign_keys = ON;');
  }

  return { fetched: cloudLogs.length, processed };
}

/**
 * Exécute le bootstrap initial global (SyncInitiale) uniquement si t_users est vide.
 */
export async function runSyncInitiale(): Promise<boolean> {
  const db = getDatabase();
  if (!db) return false;

  try {
    const userCountRow = db.prepare("SELECT COUNT(*) as count FROM t_users").get() as { count: number };
    if (userCountRow.count === 0) {
      log.info("[SYS_BOOTSTRAP_INIT] Table t_users vide. Lancement de la SyncInitiale (téléchargement global des sites, centres et utilisateurs)...");
      logAudit('SYSTEM', 'SYS_INIT_EMPTY_TABLE', { table: 't_users', message: 'Base de données vide au démarrage' });
      await preloadUsersFromCloud();
      log.info("[SYS_BOOTSTRAP_INIT] SyncInitiale terminée avec succès.");
      return true;
    }
  } catch (err: any) {
    log.error("[SYS_BOOTSTRAP_INIT] Exception lors de la SyncInitiale :", err.message || err);
  }
  return false;
}


