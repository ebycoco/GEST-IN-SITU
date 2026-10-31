import log from 'electron-log';
import { v4 as uuidv4 } from 'uuid';
import { BrowserWindow } from 'electron';
import { getDatabase } from '../database/connection';
import { getSupabaseClient } from './supabase-client';
import { networkMonitor } from './network-monitor';
import { mapCardPayload } from './payload-mapper';
import { insertAuditLog } from '../database/queries/audit.queries';
import { realignLocalId, type HierarchyLevel } from './hierarchy-realign';

// ─── État en mémoire : gating "Envoi Automatique" des cartes (upstream) ─────
/**
 * Miroir en mémoire de la préférence utilisateur `auto_upstream_<id_user>` (t_config),
 * répercuté ici par SyncEngine.setCardsAutoUpstreamEnabled() à chaque login et à chaque
 * appel de l'IPC sync:setAutoUpstream. Ce module reste volontairement ignorant de la
 * notion d'utilisateur/session (transverse à toutes les tables) — il ne connaît qu'un
 * booléen simple, jamais getSecureCurrentUser().
 *
 * Portée stricte : ne gate QUE les entrées t_outbox de table_name = 't_cartes'. Toutes
 * les autres tables (t_sites, t_centres, t_postes, t_users, t_logs) continuent de
 * s'envoyer automatiquement sans condition, quelle que soit la valeur de ce flag.
 *
 * Défaut true (envoi actif) : si aucun login n'a encore initialisé ce flag (ex: cycle
 * périodique déclenché avant tout login dans de rares scénarios), le comportement reste
 * celui d'avant l'introduction du toggle — jamais un blocage silencieux par défaut.
 */
let _cardsAutoUpstreamEnabled = true;

/**
 * Met à jour le miroir en mémoire du gating "Envoi Automatique" des cartes.
 * Appelé exclusivement par SyncEngine.setCardsAutoUpstreamEnabled() — jamais directement
 * depuis un handler IPC ou une query, pour garder une source de vérité unique côté
 * SyncEngine (qui, lui, connaît la notion de session/utilisateur).
 */
export function setCardsAutoUpstreamEnabled(enabled: boolean): void {
  _cardsAutoUpstreamEnabled = enabled;
  log.info(`[OutboxService] Gating "Envoi Automatique" des cartes (t_cartes) : ${enabled ? 'ACTIVÉ' : 'DÉSACTIVÉ'}.`);
}

// ─── Constantes de configuration ────────────────────────────────────────────
/** Nombre maximal de tentatives avant de basculer une entrée en ERROR. */
const MAX_OUTBOX_ATTEMPTS = 5;

/** Taille du lot traité à chaque appel de processOutboxPending. */
const OUTBOX_BATCH_SIZE = 50;

/**
 * Backoff progressif appliqué aux entrées ERROR avant nouvelle tentative
 * automatique (voir _promoteEligibleErrorsToPending). Doublement à chaque
 * tentative au-delà du seuil MAX_OUTBOX_ATTEMPTS, plafonné à 24h — évite
 * le martèlement de Supabase par des entrées en échec persistant tout en
 * garantissant qu'une résolution externe (ex: correction de donnée côté
 * Supabase) finisse par être retentée dans un délai borné.
 */
const OUTBOX_ERROR_BACKOFF_BASE_MINUTES = 15;
const OUTBOX_ERROR_BACKOFF_MAX_MINUTES = 24 * 60;

/**
 * "Bloc statut" de t_cartes (21 colonnes) protégé côté cloud par le trigger
 * trg_t_cartes_status_guard (supabase/migrations/0006_t_cartes_status_guard.sql, même liste).
 * DUPLIQUÉ dans src/main/workers/upload-worker.js (STATUS_BLOCK_COLUMNS) : le worker est copié
 * tel quel sans bundler (copyWorkerPlugin, electron.vite.config.ts) et ne peut pas importer ce
 * module — tenir les deux listes (et la migration) synchronisées.
 */
const STATUS_BLOCK_COLUMNS = [
  'statut', 'date_delivrance', 'agent_distributeur', 'centre_retrait',
  'nom_retirant', 'num_retirant', 'contact_retirant', 'relation_retirant',
  'doublon_declare_par', 'doublon_declare_le', 'doublon_motif',
  'doublon_annule_par', 'doublon_annule_le', 'doublon_motif_annulation',
  'statut_avant_doublon',
  'apurement_correction_par', 'apurement_correction_le', 'apurement_correction_motif',
  'apurement_annulation_par', 'apurement_annulation_le', 'apurement_annulation_motif'
] as const;

/** Colonnes relues après l'upsert d'une carte (.select) : bloc statut + sync_id + updated_at. */
const CARD_UPSERT_RETURN_COLUMNS = ['sync_id', 'updated_at', ...STATUS_BLOCK_COLUMNS].join(',');

/** Clés de payload jamais écrites dans main.log (le payload envoyé à Supabase reste intact). */
const LOG_REDACTED_KEYS = new Set(['password_hash', 'password']);

/**
 * JSON d'un payload pour les logs, avec les secrets masqués. Auparavant le payload t_users
 * complet (password_hash compris) était journalisé à chaque enfilage et à chaque envoi.
 */
export function redactPayloadForLog(payload: unknown): string {
  return JSON.stringify(payload, (key, value) =>
    LOG_REDACTED_KEYS.has(key) && value != null ? '[MASQUÉ]' : value
  );
}

/** Tables de hiérarchie dont l'id cloud est relu à l'envoi (plan site_id, commit 5). */
const HIERARCHY_LEVEL_BY_TABLE: Record<string, HierarchyLevel> = {
  t_sites: 'site',
  t_centres: 'centre',
  t_postes: 'poste'
};

/**
 * Après l'acquittement d'un upsert t_sites / t_centres / t_postes : si le cloud a attribué un id
 * différent de l'id local (ligne créée sur ce poste), réaligne l'id local (hierarchy-realign.ts).
 * Jamais pendant une session ouverte (session, écrans et imports gardent les ids en mémoire, re-audit
 * 2026-10-31 P1-4) : reporté au préchargement du prochain démarrage, qui réaligne par sync_id.
 * Retourne true si des ids locaux ont changé. Ne lève jamais.
 */
async function _realignAfterAck(
  db: NonNullable<ReturnType<typeof getDatabase>>,
  tableName: string,
  syncId: unknown,
  cloudId: number
): Promise<boolean> {
  const level = HIERARCHY_LEVEL_BY_TABLE[tableName];
  if (!level || typeof syncId !== 'string' || !syncId) return false;
  try {
    const local = db.prepare(`SELECT id FROM ${tableName} WHERE sync_id = ?`).get(syncId) as { id: number } | undefined;
    if (!local || local.id === cloudId) return false;
    // Import différé : session-heartbeat → users.queries → outbox.service (cycle au chargement).
    const { getSecureCurrentUser } = await import('../auth/session-heartbeat');
    if (getSecureCurrentUser()) {
      log.info(`[OutboxService] ${tableName} sync_id=${syncId} : id local ${local.id} ≠ id cloud ${cloudId}, session ouverte — réalignement au prochain démarrage.`);
      return false;
    }
    const res = realignLocalId(db, level, local.id, cloudId, syncId);
    return res.action === 'realigned' || res.action === 'merged';
  } catch (err: any) {
    log.error(`[OutboxService] Réalignement après envoi de ${tableName} sync_id=${syncId} en échec :`, err?.message || err);
    return false;
  }
}

// ─── Types internes ──────────────────────────────────────────────────────────
interface OutboxEntry {
  id: string;
  table_name: string;
  /** INSERT et UPDATE → upsert Supabase. DELETE → .delete().eq('sync_id', ...). */
  operation: 'INSERT' | 'UPDATE' | 'DELETE';
  payload: string;
  created_at: string;
  status: 'PENDING' | 'SYNCED' | 'ERROR';
  error_msg: string | null;
  attempts: number;
  depends_on: string | null;
  last_attempt_at?: string | null;
}

// ─── API publique ────────────────────────────────────────────────────────────

/**
 * Enfile une opération dans t_outbox de façon **idempotente**.
 *
 * Garantie d'idempotence :
 *   La clé primaire `id` est un UUID v4 fourni par l'appelant.
 *   Un `INSERT OR IGNORE` garantit qu'un double appel avec le même UUID
 *   ne crée pas de doublon — l'entrée existante est silencieusement ignorée.
 *
 * @param id        - UUID v4 unique identifiant l'opération (fourni par l'appelant).
 * @param tableName - Table cible Supabase (ex: 't_sites', 't_centres', 't_users').
 * @param operation - Type d'opération : 'INSERT' | 'UPDATE' | 'DELETE'.
 * @param payload   - Pour INSERT/UPDATE : objet complet. Pour DELETE : { sync_id }.
 *
 * Invariant t_users : tout payload 't_users' enfilé doit systématiquement inclure
 * `login`, `password_hash`, `role` (colonnes NOT NULL côté Supabase), quelle que soit
 * l'ampleur réelle du changement métier porté par cet appel — car enqueueOutbox fait un
 * remplacement intégral du payload en attente (`ON CONFLICT(id) DO UPDATE SET payload =
 * excluded.payload`), jamais une fusion. Un payload partiel omettant l'une de ces 3
 * colonnes écrase silencieusement (ou fait rejeter par PostgREST) l'entrée existante.
 */
// SQL d'upsert (INSERT ... ON CONFLICT(id) DO UPDATE) dupliqué intentionnellement (sans la
// journalisation verbeuse ci-dessous) dans src/main/workers/import-worker.js (worker JS pur,
// ne peut pas importer ce module TS) — tenir synchronisé si le schéma t_outbox évolue.
export function enqueueOutbox(
  id: string,
  tableName: string,
  operation: 'INSERT' | 'UPDATE' | 'DELETE',
  payload: Record<string, unknown>,
  dependsOnId: string | null = null
): void {
  try {
    const db = getDatabase();
    if (!db) {
      log.error('[OutboxService] enqueueOutbox : base de données non disponible.');
      return;
    }

    const payloadJson = JSON.stringify(payload);

    log.info(`[OutboxService] Enfilage outbox tenté (id=${id}, table=${tableName}, op=${operation}, payload=${redactPayloadForLog(payload)}, dependsOn=${dependsOnId})`);
    
    // UPSERT : si l'UUID existe déjà, on met à jour le payload et on le repasse en PENDING.
    db.prepare(`
      INSERT INTO t_outbox (id, table_name, operation, payload, status, attempts, created_at, error_msg, depends_on)
      VALUES (?, ?, ?, ?, 'PENDING', 0, datetime('now'), NULL, ?)
      ON CONFLICT(id) DO UPDATE SET 
        operation = excluded.operation,
        payload = excluded.payload,
        status = 'PENDING',
        attempts = 0,
        error_msg = NULL,
        created_at = datetime('now'),
        depends_on = excluded.depends_on
    `).run(id, tableName, operation, payloadJson, dependsOnId);

    log.info(`[OutboxService] Enfilé → ${tableName} [${operation}] (id=${id})`);

      // Validation visuelle : afficher un aperçu des entrées PENDING (LIMIT 10 pour éviter la saturation des logs en production)
    try {
      const pendingItems = db.prepare("SELECT id, table_name, operation, status FROM t_outbox WHERE status = 'PENDING' LIMIT 10").all() as any[];
      log.info(`[OutboxService] Aperçu file d'attente t_outbox (max 10 PENDING) : ${JSON.stringify(pendingItems)}`);
    } catch (e: any) {
      log.error(`[OutboxService] Impossible de lister la file t_outbox :`, e.message);
    }
  } catch (err: any) {
    log.error(`[OutboxService] Erreur lors de l'enfilage dans t_outbox (id=${id}) :`, err.message || err);
  }
}

/**
 * Purge une entrée INSERT encore en statut PENDING dans t_outbox.
 *
 * Cas d'usage : une entité est supprimée avant d'avoir été synchronisée.
 * Au lieu d'envoyer la paire INSERT+DELETE à Supabase (ce qui provoquerait
 * une erreur 404 sur le DELETE), on annule silencieusement l'INSERT local.
 * Un DELETE n'est alors enfilé que si l'entité était déjà synchronisée
 * (i.e., aucune entrée INSERT PENDING n'existait).
 *
 * @returns `true` si une entrée PENDING a été trouvée et supprimée, `false` sinon.
 */
export function cancelPendingInsert(syncId: string, tableName: string): boolean {
  try {
    const db = getDatabase();
    if (!db) return false;

    const result = db.prepare(`
      DELETE FROM t_outbox
      WHERE id = ? AND table_name = ? AND operation = 'INSERT' AND status = 'PENDING'
    `).run(syncId, tableName);

    if (result.changes > 0) {
      log.info(`[OutboxService] INSERT PENDING annulé pour ${tableName} (sync_id=${syncId}) — entité supprimée avant synchronisation.`);
      return true;
    }
    return false;
  } catch (err: any) {
    log.error(`[OutboxService] Erreur dans cancelPendingInsert (sync_id=${syncId}) :`, err.message || err);
    return false;
  }
}

/**
 * Suppression physique locale d'un utilisateur après confirmation de sa suppression cloud.
 *
 * t_logs(id_user) référence t_users(id_user) sans ON DELETE (FK canonique rétablie par V72) :
 * les lignes de journal de l'agent sont d'abord détachées (id_user = NULL ; le login reste dans
 * login_user), puis rôles et utilisateur sont supprimés — le tout dans UNE transaction (aucun
 * état partiel « agent sans rôle » en cas d'échec).
 *
 * is_dirty/synced_at de t_logs volontairement NON modifiés : la propagation de t_logs vers
 * Supabase passe exclusivement par t_outbox (enqueueOutbox à l'insertion, cf. utils/audit.ts) ;
 * is_dirty n'y est qu'un indicateur local, remis à 0 par _clearLocalDirtyFlag. Le détachement
 * est donc strictement local et n'engendre aucun envoi.
 *
 * L'UPDATE t_logs n'est exécuté que si une ligne référence l'agent : sur une base dont la FK de
 * t_logs serait encore cassée (V72 en échec), un UPDATE de t_logs lèverait « no such table ».
 */
export function purgeLocalUserAfterCloudDelete(
  db: NonNullable<ReturnType<typeof getDatabase>>,
  syncId: string
): { logsDetached: number; usersDeleted: number } {
  return db.transaction(() => {
    const userIds = 'SELECT id_user FROM t_users WHERE sync_id = ?';
    let logsDetached = 0;
    if (db.prepare(`SELECT 1 FROM t_logs WHERE id_user IN (${userIds}) LIMIT 1`).get(syncId)) {
      logsDetached = db.prepare(`UPDATE t_logs SET id_user = NULL WHERE id_user IN (${userIds})`).run(syncId).changes;
    }
    db.prepare(`DELETE FROM t_user_roles WHERE id_user IN (${userIds})`).run(syncId);
    const usersDeleted = db.prepare('DELETE FROM t_users WHERE sync_id = ?').run(syncId).changes;
    return { logsDetached, usersDeleted };
  })();
}

/**
 * Traite séquentiellement les entrées `PENDING` de t_outbox.
 *
 * Comportement asynchrone et résilient :
 *  - Lit jusqu'à OUTBOX_BATCH_SIZE entrées PENDING, triées par date de création.
 *  - Pour chaque entrée : appel Supabase upsert → mise à jour du statut.
 *  - Erreur réseau (timeout, pas de réponse) → statut CONSERVÉ en PENDING
 *    pour être retenté lors du prochain appel.
 *  - Erreur applicative (payload invalide, >MAX_OUTBOX_ATTEMPTS tentatives) → ERROR.
 *
 * Thread Safety :
 *  - Cette fonction est appelée via setImmediate() par scheduleOutboxProcessing()
 *    pour ne jamais bloquer le thread UI d'Electron.
 *  - Un verrou interne `_isProcessing` prévient les exécutions concurrentes. Un appel
 *    reçu pendant que ce verrou est déjà pris n'est PAS perdu : il arme une dette
 *    `_rerunRequested`/`_rerunForceCards`, consommée une seule fois dans le `finally`
 *    pour déclencher un rerun immédiat (setImmediate) dès la libération du verrou — voir
 *    les commentaires au point d'usage de ces deux flags, plus bas dans ce fichier.
 *
 * @param fromPeriodicCycle - `true` uniquement lorsque l'appel provient du cycle
 *   périodique de synchronisation (startSyncCycle) ou du retour réseau — jamais des
 *   appels post-mutation immédiats via scheduleOutboxProcessing(), pour éviter tout
 *   effet de rafale de la promotion ERROR→PENDING sur des mutations rapprochées.
 *   Par défaut `false` (comportement inchangé pour tous les appelants existants).
 * @param forceCards - `true` pour deux cas légitimes, tous deux distincts du gating normal
 *   par le toggle "Envoi Automatique" (`_cardsAutoUpstreamEnabled`) : (1) un déclenchement
 *   manuel explicite (bouton "Envoyer les corrections" → sync:startBulk), qui reste une
 *   porte de sortie garantie pour toute carte PENDING dans t_outbox ; (2) l'envoi immédiat
 *   d'une correction unitaire de carte via autoEnqueueCorrection() (cartes.queries.ts,
 *   portail Qualité/panneau de correction) — une mutation ponctuelle, jamais un import
 *   massif, qui doit donc échapper au toggle indépendamment d'un clic utilisateur sur ce
 *   bouton précis. D'autres appelants de cartes.queries.ts réalisant chacun une mutation
 *   unitaire de carte (une seule carte par invocation, jamais un lot) suivent le même
 *   principe — voir le commentaire dédié au-dessus de chaque appel concerné dans ce fichier
 *   plutôt qu'une énumération ici, pour éviter que cette liste se désynchronise du code au
 *   fil des évolutions. Automatique (périodique ou immédiat post-sauvegarde d'import) = respecte
 *   le toggle (défaut `false`). Manuel explicite ou correction unitaire = l'ignore (`true`).
 * @param onEntryProcessed - Callback optionnel invoqué de façon SYNCHRONE juste après
 *   chaque entrée ayant définitivement quitté le statut PENDING au cours de ce lot
 *   (succès → SYNCED, ou échec définitif → ERROR — jamais pour une entrée conservée en
 *   PENDING pour nouvelle tentative : erreur réseau transitoire, dépendance parente encore
 *   PENDING, etc.). Fournit { tableName, success } sans requête SQL supplémentaire — le
 *   compteur "cartes restantes" reste entièrement à la charge de l'appelant (mémoire locale),
 *   conformément à la politique Low-Memory (CLAUDE.md §2). Par défaut undefined (aucun effet,
 *   aucun coût) — seul l'appel manuel sync:startBulk (handlers.ts) fournit ce callback ; les
 *   3 autres appelants (sync-engine.ts cycles périodiques, planification différée interne
 *   post-mutation) n'ont aucune UI à alimenter et restent inchangés.
 * @returns Objet { processed, errors } indiquant les résultats du traitement.
 */
export async function processOutboxPending(fromPeriodicCycle: boolean = false, forceCards: boolean = false, onEntryProcessed?: (result: { tableName: string; success: boolean }) => void): Promise<{ processed: number; errors: number }> {
  // Verrou anti-concurrence léger (flag module-level)
  if (_isProcessing) {
    // ── Correctif course "entrée orpheline" (agent-13-qa-terrain-tester, e2e cloud) ──
    // Ne jamais abandonner silencieusement cet appel : un lot déjà en cours d'exécution
    // a figé sa liste d'entrées à traiter via le SELECT ... LIMIT fait en tête de la
    // section critique ci-dessous (juste avant la boucle for), AVANT que l'entrée
    // t_outbox motivant CET appel-ci n'existe forcément en base. Sans re-planification,
    // une correction unitaire de carte (forceCards=true, ex: autoEnqueueCorrection())
    // arrivée pendant qu'un traitement précédent tourne déjà (ex: juste après la
    // création de cette même carte) pouvait rester PENDING indéfiniment : le cycle
    // périodique respecte le toggle "Envoi Automatique" désactivé par défaut pour
    // ADMINISTRATEUR_SITE et exclut donc t_cartes de son traitement automatique — aucun
    // filet de sécurité ne rattrapait alors cette entrée. On mémorise donc la "dette"
    // (et son besoin éventuel de forceCards, combiné en OR si plusieurs demandes
    // divergent) pour la rejouer une seule fois dans le `finally` ci-dessous, juste
    // après la libération du verrou par le traitement en cours.
    _rerunRequested = true;
    _rerunForceCards = _rerunForceCards || forceCards;
    log.info(`[OutboxService] processOutboxPending ignoré : traitement déjà en cours. Re-run planifié après libération du verrou (forceCards cumulé=${_rerunForceCards}).`);
    return { processed: 0, errors: 0 };
  }

  _isProcessing = true;
  let processed = 0;
  let errors = 0;
  // Compte les agents (t_users) effectivement resynchronisés dans ce batch, hors DELETE
  // (une suppression physique locale ne concerne pas le compteur "agents en attente
  // d'envoi" côté UI) — sert uniquement à notifier le Renderer via 'sync:users-synced'
  // pour rafraîchir le badge pendingPushUsersCount de AgentsPage sans polling.
  let usersSyncedCount = 0;

  try {
    const db = getDatabase();
    if (!db) return { processed: 0, errors: 0 };

    // Vérification de la disponibilité réseau avant tout traitement Supabase
    const networkState = networkMonitor.getState();
    if (networkState !== 'ONLINE') {
      log.info(`[OutboxService] Réseau ${networkState} — traitement de l'outbox différé.`);
      return { processed: 0, errors: 0 };
    }

    // Retry automatique : promeut les entrées ERROR dont le backoff est écoulé en
    // PENDING, uniquement depuis le cycle périodique (voir doc du paramètre ci-dessus).
    if (fromPeriodicCycle) {
      _promoteEligibleErrorsToPending(db);
    }

    // Gating "Envoi Automatique" des cartes (t_cartes uniquement) : un appel manuel
    // explicite (forceCards=true, voir doc du paramètre) ignore toujours ce gating —
    // seuls les appels automatiques (périodique ou immédiat post-sauvegarde) le respectent.
    const excludeCardsUpstream = !forceCards && !_cardsAutoUpstreamEnabled;
    if (excludeCardsUpstream) {
      log.info('[OutboxService] Toggle "Envoi Automatique" désactivé — entrées t_cartes exclues de ce traitement automatique.');
    }

    // Lire le prochain lot d'entrées PENDING
    const pendingEntries = db.prepare(`
      SELECT id, table_name, operation, payload, status, error_msg, attempts, depends_on
      FROM t_outbox
      WHERE status = 'PENDING'
        ${excludeCardsUpstream ? "AND table_name != 't_cartes'" : ''}
      ORDER BY created_at ASC
      LIMIT ?
    `).all(OUTBOX_BATCH_SIZE) as OutboxEntry[];

    if (pendingEntries.length === 0) {
      return { processed: 0, errors: 0 };
    }

    log.info(`[OutboxService] Traitement de ${pendingEntries.length} entrée(s) PENDING...`);

    const supabase = getSupabaseClient();
    if (!supabase) {
      log.warn('[OutboxService] Client Supabase non disponible — traitement outbox ignoré.');
      return { processed: 0, errors: 0 };
    }

    for (const entry of pendingEntries) {
      // ── Garde anti-course "ré-enfilage pendant traitement" (audit 2026-10-26, point 5) ──
      // L'id t_outbox est réutilisé pour une même entité : enqueueOutbox() remplace payload/
      // operation et repasse la ligne en PENDING (attempts = 0). Toute écriture de statut
      // ci-dessous (SYNCED, ERROR, attempts) est donc conditionnée à ce que la ligne porte
      // encore la version lue dans ce lot (même operation + même payload) — sinon la réponse
      // d'un envoi de l'ancienne version écraserait la nouvelle (perdue, is_dirty effacé).
      // Comparaison sur le payload plutôt que sur created_at (datetime('now') : résolution à
      // la seconde, deux enfilages dans la même seconde seraient indiscernables).
      const markError = (attempts: number, errorMsg: string): boolean =>
        _markOutboxError(db, entry.id, attempts, errorMsg, { operation: entry.operation, payload: entry.payload });

      if (entry.depends_on) {
        const parent = db.prepare('SELECT status FROM t_outbox WHERE id = ?').get(entry.depends_on) as { status: string } | undefined;
        if (parent && parent.status === 'ERROR') {
          if (markError(entry.attempts + 1, "Action parente en échec définitif. Opération suspendue.")) {
            errors++;
            onEntryProcessed?.({ tableName: entry.table_name, success: false });
          }
          continue;
        } else if (parent && parent.status === 'PENDING') {
          continue; // Parent pas encore prêt, on reporte à plus tard sans erreur
        }
      }

      const newAttempts = entry.attempts + 1;

      // Vérification du seuil de tentatives avant tout appel réseau — UNIQUEMENT sur le
      // chemin rapide/immédiat (post-mutation, fromPeriodicCycle=false) : on parque vite en
      // ERROR pour ne pas marteler Supabase en boucle serrée juste après une action
      // utilisateur qui échoue pour une raison structurelle.
      // Sur le chemin cycle périodique (fromPeriodicCycle=true), ce plafond est
      // volontairement désactivé : c'est justement là qu'atterrissent les entrées promues
      // par _promoteEligibleErrorsToPending (attempts déjà > MAX_OUTBOX_ATTEMPTS, jamais
      // réinitialisé) — sans cette exception, une entrée déjà en ERROR ne recevrait plus
      // jamais de vraie tentative réseau après promotion, seulement une comptabilité de
      // timestamp/backoff. L'espacement croissant (jusqu'à 24h) est déjà garanti par ce
      // backoff, et la visibilité admin par le badge outboxErrorCount (dashboard) — donc
      // plus besoin d'un couperet définitif ici : l'entrée retente indéfiniment jusqu'à
      // réussite ou intervention humaine. Un nouvel échec repasse par _markOutboxError
      // plus bas (branche supabaseError), qui met à jour last_attempt_at et fait croître
      // attempts pour le calcul du prochain backoff.
      if (!fromPeriodicCycle && newAttempts > MAX_OUTBOX_ATTEMPTS) {
        if (markError(newAttempts, `Nombre maximum de tentatives (${MAX_OUTBOX_ATTEMPTS}) atteint.`)) {
          log.error(`[OutboxService] Entrée ${entry.id} (${entry.table_name}) basculée en ERROR après ${MAX_OUTBOX_ATTEMPTS} tentatives.`);
          errors++;
          onEntryProcessed?.({ tableName: entry.table_name, success: false });
        }
        continue;
      }

      // Incrémenter le compteur de tentatives avant l'appel réseau — gardé sur la version lue :
      // si l'entrée a été ré-enfilée (ou supprimée) depuis la lecture du lot (pendant l'envoi
      // d'une entrée précédente), on n'envoie pas l'ancienne version ; la nouvelle reste
      // PENDING pour le prochain traitement.
      const attemptsUpdate = db.prepare(
        `UPDATE t_outbox SET attempts = ? WHERE id = ? AND operation = ? AND payload = ?`
      ).run(newAttempts, entry.id, entry.operation, entry.payload);
      if (attemptsUpdate.changes === 0) {
        log.info(`[OutboxService] Entrée ${entry.id} (${entry.table_name}) modifiée depuis la lecture du lot : ancienne version non envoyée, nouvelle version conservée en PENDING.`);
        continue;
      }

      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(entry.payload);
        
        // Mappage strict des booléens pour PostgreSQL (Supabase) — t_sites a un typage
        // ASYMÉTRIQUE entre ses deux colonnes 0/1 (confirmé par supabase/migrations/
        // 0001_baseline_schema.sql, ligne 46 et 51 — aucune migration ultérieure ne les
        // modifie) : is_active est INTEGER (comme en local SQLite, donc AUCUNE coercion à
        // appliquer — envoyer un booléen JS y provoquait "invalid input syntax for type
        // integer: \"true\"", bug confirmé), alors que is_permanent est bien BOOLEAN (donc
        // la coercion Boolean() reste nécessaire ici, symétrique à la coercion inverse déjà
        // appliquée par downstream.ts : `is_permanent ? 1 : 0` au retour vers SQLite).
        if (entry.table_name === 't_sites') {
          if (payload.is_permanent !== undefined) payload.is_permanent = Boolean(payload.is_permanent);
        } else if (entry.table_name === 't_users') {
          if (payload.statut_actif !== undefined) {
            // PostgreSQL attend un entier (1/0) pour t_users.statut_actif
            payload.statut_actif = (payload.statut_actif === true || payload.statut_actif === 1 || payload.statut_actif === 'true') ? 1 : 0;
          }
        }

      } catch (parseErr: any) {
        log.error(`[OutboxService] Payload invalide pour l'entrée ${entry.id} :`, parseErr.message);
        if (markError(newAttempts, `Payload JSON invalide : ${parseErr.message}`)) {
          errors++;
          onEntryProcessed?.({ tableName: entry.table_name, success: false });
        }
        continue;
      }

      try {
        // ── Dispatcher selon le type d'opération ─────────────────────────────
        // INSERT / UPDATE → upsert idempotent sur sync_id
        // DELETE          → suppression ciblée par sync_id
        let supabaseError: { message: string; code?: string; details?: string | null } | null = null;
        // t_cartes seulement : ligne renvoyée par le cloud (bloc statut + sync_id + updated_at).
        let cloudCardRow: Record<string, unknown> | null = null;
        let sentCardPayload: Record<string, unknown> | null = null;
        // t_sites / t_centres / t_postes seulement : id attribué par le cloud (plan site_id, commit 5).
        let cloudHierarchyId: number | null = null;

        if (entry.operation === 'DELETE') {
          // Un payload DELETE ne contient que { sync_id } (ou { user_sync_id } pour t_user_roles)
          const syncIdToDelete = (payload['sync_id'] || payload['user_sync_id']) as string | undefined;
          if (!syncIdToDelete) {
            log.error(`[OutboxService] Payload DELETE invalide pour ${entry.table_name} (id=${entry.id}).`);
            if (markError(newAttempts, 'Payload DELETE invalide : champ sync_id manquant.')) {
              errors++;
              onEntryProcessed?.({ tableName: entry.table_name, success: false });
            }
            continue;
          }
          const deleteColumn = entry.table_name === 't_user_roles' ? 'user_sync_id' : 'sync_id';
          const { error } = await supabase
            .from(entry.table_name)
            .delete()
            .eq(deleteColumn, syncIdToDelete);
          supabaseError = error;

          if (!supabaseError) {
            // Confirmation de suppression Cloud -> Réaliser la suppression physique réelle SQLite locale
            try {
              if (entry.table_name === 't_users') {
                const { logsDetached } = purgeLocalUserAfterCloudDelete(db, syncIdToDelete);
                log.info(`[OutboxService] Suppression physique locale effectuée pour t_users (sync_id=${syncIdToDelete}, ${logsDetached} ligne(s) t_logs détachée(s))`);
              } else if (entry.table_name === 't_cartes') {
                db.prepare('DELETE FROM t_cartes WHERE sync_id = ?').run(syncIdToDelete);
                log.info(`[OutboxService] Suppression physique locale effectuée pour t_cartes (sync_id=${syncIdToDelete})`);
              } else if (entry.table_name === 't_centres') {
                db.prepare('DELETE FROM t_postes WHERE centre_id IN (SELECT id FROM t_centres WHERE sync_id = ?)').run(syncIdToDelete);
                db.prepare('DELETE FROM t_centres WHERE sync_id = ?').run(syncIdToDelete);
                log.info(`[OutboxService] Suppression physique locale effectuée pour t_centres (sync_id=${syncIdToDelete})`);
              } else if (entry.table_name === 't_sites') {
                db.prepare('DELETE FROM t_sites WHERE sync_id = ?').run(syncIdToDelete);
                log.info(`[OutboxService] Suppression physique locale effectuée pour t_sites (sync_id=${syncIdToDelete})`);
              }
            } catch (localDbErr: any) {
              log.error(`[OutboxService] Erreur lors de la suppression physique locale différée :`, localDbErr.message || localDbErr);
            }
          }
        } else {
          let finalPayload;
          try {
            if (entry.table_name === 't_cartes') {
              finalPayload = mapCardPayload(payload);
              sentCardPayload = finalPayload;
            } else if (entry.table_name === 't_logs') {
              // id_user neutralisé au moment de l'envoi (audit 2026-10-26, chantier C3), y compris
              // pour les entrées enfilées par une version antérieure : l'id_user local n'est jamais
              // aligné sur l'id_user Supabase (FK t_logs_id_user_fkey). login_user identifie l'agent.
              finalPayload = { ...payload, id_user: null };
            } else {
              finalPayload = payload;
            }
          } catch (validationErr: any) {
            log.error(`[OutboxService] Rejet local (validation) pour ${entry.table_name} (id=${entry.id}) : ${validationErr.message}`);
            if (markError(newAttempts, validationErr.message)) {
              errors++;
              onEntryProcessed?.({ tableName: entry.table_name, success: false });
            }
            continue;
          }

          // INSERT ou UPDATE → upsert idempotent sur sync_id (ou user_sync_id,role pour t_user_roles)
          log.info(`[OutboxService][DEBUG] Envoi du payload d'upsert pour ${entry.table_name} :`, redactPayloadForLog(finalPayload));
          const conflictKey = entry.table_name === 't_user_roles' ? 'user_sync_id,role' : 'sync_id';
          const upsertQuery: any = supabase
            .from(entry.table_name)
            .upsert(finalPayload, { onConflict: conflictKey });
          let error: { message: string; code?: string; details?: string | null } | null;
          if (entry.table_name === 't_cartes' && typeof upsertQuery.select === 'function') {
            // Correctif rouge 4 / A-02, étape 2 : lecture de la ligne gardée par le cloud
            // (trigger trg_t_cartes_status_guard, supabase/migrations/0006). Colonnes limitées au
            // bloc statut + sync_id + updated_at (Low-Memory). `typeof ... === 'function'` : le
            // builder supabase-js expose toujours select() ; ce test ne sert qu'aux clients simulés
            // des tests existants (upsert directement awaitable), qui restent sur l'ancien chemin.
            const res = await upsertQuery.select(CARD_UPSERT_RETURN_COLUMNS);
            error = res.error;
            if (!error && Array.isArray(res.data)) {
              cloudCardRow = (res.data as Record<string, unknown>[]).find(
                (r) => r && r.sync_id === (finalPayload as Record<string, unknown>).sync_id
              ) ?? null;
            }
          } else if (entry.table_name in HIERARCHY_LEVEL_BY_TABLE && typeof upsertQuery.select === 'function') {
            // Plan site_id (commit 5) : id attribué par le cloud, pour réaligner l'id local.
            const res = await upsertQuery.select('id, sync_id');
            error = res.error;
            if (!error && Array.isArray(res.data)) {
              const row = (res.data as { id?: unknown; sync_id?: unknown }[]).find(
                (r) => r && r.sync_id === (finalPayload as Record<string, unknown>).sync_id
              );
              cloudHierarchyId = row && Number.isInteger(row.id) ? (row.id as number) : null;
            }
          } else {
            ({ error } = await upsertQuery);
          }

          if (error && ['t_sites', 't_centres', 't_postes', 't_users'].includes(entry.table_name) && error.message.includes('duplicate key value violates unique constraint')) {
            const pk = entry.table_name === 't_users' ? 'id_user' : 'id';
            if (payload[pk]) {
              log.warn(`[OutboxService][FALLBACK] Conflit détecté sur ${entry.table_name}. Tentative d'UPDATE via ${pk}...`);
              const { error: updateError } = await supabase
                .from(entry.table_name)
                .update(payload)
                .eq(pk, payload[pk]);
              
              if (!updateError) {
                log.info(`[OutboxService][FALLBACK SUCCESS] Update réussi pour ${entry.table_name}.`);
                error = null; // Clear error to mark as SYNCED
              } else {
                log.error(`[OutboxService][FALLBACK ERROR] Update échoué: ${updateError.message}`);
              }
            }
          }

          supabaseError = error;
        }

        if (supabaseError) {
          // ── Filet de sécurité L2-3b : DELETE cloud de t_users refusé par une FK (23503) ──
          // Strictement limité à t_users + DELETE + erreur FK identifiée sans ambiguïté ; toute
          // autre table/opération/erreur suit le traitement historique ci-dessous, inchangé.
          if (
            entry.table_name === 't_users' &&
            entry.operation === 'DELETE' &&
            _isForeignKeyViolation(supabaseError)
          ) {
            const failedSyncId = (payload['sync_id'] || payload['user_sync_id']) as string | undefined;
            if (failedSyncId) {
              try {
                _handleUserDeleteForeignKeyViolation(db, entry.id, failedSyncId, supabaseError.message);
                processed++;
                onEntryProcessed?.({ tableName: entry.table_name, success: true });
                continue;
              } catch (fkHandlerErr: any) {
                // Échec du filet : on retombe sur le traitement historique (aucune régression).
                log.error(`[OutboxService] Filet FK t_users en échec (sync_id=${failedSyncId}) :`, fkHandlerErr.message || fkHandlerErr);
              }
            }
          }

          const isNetworkError = _isTransientNetworkError(supabaseError.message);

          if (isNetworkError) {
            // Erreur transitoire réseau → conserver PENDING pour nouvelle tentative
            log.warn(
              `[OutboxService] Erreur réseau transitoire pour ${entry.table_name} (id=${entry.id}). ` +
              `Conservé en PENDING. Tentative ${newAttempts}/${MAX_OUTBOX_ATTEMPTS}. Détail : ${supabaseError.message}`
            );
          } else if (newAttempts >= MAX_OUTBOX_ATTEMPTS) {
            // Erreur définitive dépassant le seuil → ERROR (sauf si l'entrée a été ré-enfilée
            // pendant l'envoi : la nouvelle version, jamais tentée, reste PENDING)
            log.error(`[OutboxService] Erreur définitive pour ${entry.table_name} (id=${entry.id}) : ${supabaseError.message}`);
            if (markError(newAttempts, supabaseError.message)) {
              errors++;
              onEntryProcessed?.({ tableName: entry.table_name, success: false });
            }
          } else {
            log.warn(
              `[OutboxService] Erreur Supabase pour ${entry.table_name} (id=${entry.id}). ` +
              `Tentative ${newAttempts}/${MAX_OUTBOX_ATTEMPTS} : ${supabaseError.message}`
            );
            // Trace dès la 1re erreur (audit 2026-10-26, chantier C3) : statut PENDING inchangé.
            _recordOutboxAttemptError(db, entry, _formatSupabaseError(supabaseError));
          }
          continue;
        }

        // Succès → marquer SYNCED + remettre à zéro le flag local is_dirty
        // (même connexion/transaction que le reste du traitement outbox —
        // voir _clearLocalDirtyFlag). Sans cela, une entité modifiée localement
        // puis synchronisée avec succès restait signalée "en attente" (is_dirty
        // = 1) indéfiniment, faussant les compteurs UI (ex: bandeau "corrections
        // en attente" du Portail Qualité après une fusion de doublons).
        // Garde anti-course (voir markError en tête de boucle) : SYNCED + effacement de is_dirty
        // uniquement si la ligne porte encore la version envoyée. Si elle a été ré-enfilée
        // pendant l'envoi, on ne touche à rien : la nouvelle version reste PENDING, is_dirty = 1.
        // Conflit de bloc statut (A-02 étape 2) : le cloud a gardé un bloc différent de l'envoi.
        // Sans trigger (production actuelle), la réponse = l'envoi → aucun écart, chemin inchangé.
        const statusConflict = (entry.table_name === 't_cartes' && sentCardPayload && cloudCardRow)
          ? _diffStatusBlock(sentCardPayload, cloudCardRow)
          : [];

        const markedSynced = db.transaction(() => {
          const res = db.prepare(`
            UPDATE t_outbox SET status = 'SYNCED', error_msg = NULL
            WHERE id = ? AND operation = ? AND payload = ?
          `).run(entry.id, entry.operation, entry.payload);
          // Garde anti-course : si l'entrée a été ré-enfilée pendant l'envoi, on ne touche à rien
          // (ni bloc cloud, ni is_dirty, ni t_logs). La nouvelle version locale reste PENDING ; à
          // son envoi, le trigger cloud ré-arbitrera et ce même code appliquera alors le bloc gardé.
          if (res.changes === 0) return false;

          if (statusConflict.length > 0 && sentCardPayload && cloudCardRow) {
            // Même transaction que le passage SYNCED : bloc cloud + updated_at cloud + is_dirty 0
            // + t_logs. Pas de nouvelle mise en file : le cloud porte déjà la version juste.
            _applyCloudStatusBlock(db, sentCardPayload, cloudCardRow, statusConflict);
          } else if (entry.operation !== 'DELETE') {
            const syncIdValue = (payload['sync_id'] || payload['user_sync_id']) as string | undefined;
            _clearLocalDirtyFlag(db, entry.table_name, syncIdValue);
          }
          return true;
        })();

        if (!markedSynced) {
          log.info(`[OutboxService] ${entry.table_name} [${entry.operation}] envoyé (id=${entry.id}) mais ré-enfilé pendant l'envoi : nouvelle version conservée en PENDING, is_dirty inchangé.`);
          continue;
        }

        log.info(`[OutboxService] ✓ ${entry.table_name} [${entry.operation}] synchronisé (id=${entry.id})`);
        processed++;
        onEntryProcessed?.({ tableName: entry.table_name, success: true });
        if (entry.table_name === 't_users' && entry.operation !== 'DELETE') usersSyncedCount++;

        if (cloudHierarchyId !== null && await _realignAfterAck(db, entry.table_name, (payload as Record<string, unknown>).sync_id, cloudHierarchyId)) {
          // Payloads en attente réécrits (site_id/centre_id) : les entrées déjà lues dans ce lot
          // portent l'ancien id. Lot interrompu ; les suivantes repartent relues, au prochain passage.
          scheduleOutboxProcessing();
          break;
        }

      } catch (networkErr: any) {
        // Exception réseau (timeout, DNS, etc.) → conserver PENDING
        log.warn(
          `[OutboxService] Exception réseau pour ${entry.table_name} (id=${entry.id}). ` +
          `Conservé en PENDING. Tentative ${newAttempts}/${MAX_OUTBOX_ATTEMPTS}. ` +
          `Détail : ${networkErr.message || networkErr}`
        );
        // Trace de l'exception (audit 2026-10-26, chantier C3) : statut PENDING inchangé.
        _recordOutboxAttemptError(db, entry, `Exception : ${networkErr?.message || String(networkErr)}`);
      }
    }

    if (processed > 0 || errors > 0) {
      log.info(`[OutboxService] Traitement terminé : ${processed} synchronisé(s), ${errors} en erreur.`);
    }

    // Notifie le Renderer qu'au moins un agent (t_users) vient d'être poussé avec succès
    // vers Supabase, pour lui permettre de rafraîchir silencieusement le badge
    // pendingPushUsersCount (AgentsPage) sans dépendre d'une action utilisateur explicite.
    // Canal dédié 'sync:users-synced' — ne PAS réutiliser 'sync:updated-data' (consommé par
    // MainLayout pour un toast de téléchargement de cartes, sémantique différente).
    if (usersSyncedCount > 0) {
      BrowserWindow.getAllWindows().forEach(w => {
        if (!w.isDestroyed()) w.webContents.send('sync:users-synced', { count: usersSyncedCount });
      });
    }

    return { processed, errors };

  } finally {
    // Libérer le verrou dans TOUS les cas (succès ou exception)
    _isProcessing = false;

    // ── Rejeu de la dette accumulée pendant ce traitement (voir commentaire du verrou
    // ci-dessus) ────────────────────────────────────────────────────────────────────
    // Consommation immédiate et unique : on capture puis on remet à zéro AVANT de
    // planifier le nouvel appel, pour qu'une éventuelle nouvelle demande arrivant
    // pendant l'exécution de ce rerun (setImmediate ci-dessous) reparte sur un flag
    // propre plutôt que de s'agréger à une dette déjà en cours de traitement — sans
    // quoi une dette consommée pourrait être "reconsommée" une seconde fois par erreur.
    // Garantie anti-boucle infinie : ce bloc ne se déclenche QUE si une vraie collision
    // a eu lieu pendant CE traitement précis (_rerunRequested mis à true uniquement par
    // le branchement du verrou ci-dessus, jamais par ce `finally` lui-même) — une seule
    // dette consommée => au plus UN rerun planifié ici. Si ce rerun ne rencontre lui-même
    // aucune collision, _rerunRequested reste false à sa propre sortie et la chaîne
    // s'arrête naturellement. Si du trafic outbox continue d'arriver en continu pendant
    // ce rerun, une nouvelle dette pourra se former et déclencher un rerun suivant — ce
    // n'est pas une boucle artificielle mais le reflet direct d'une demande réelle
    // toujours en attente (même principe que le setImmediate() déjà utilisé par
    // scheduleOutboxProcessing : événementiel, jamais un polling/timer actif).
    if (_rerunRequested) {
      const rerunForceCards = _rerunForceCards;
      _rerunRequested = false;
      _rerunForceCards = false;
      log.info(`[OutboxService] Re-run planifié suite à collision de verrou pendant le traitement qui vient de se terminer (forceCards=${rerunForceCards}).`);
      setImmediate(() => {
        processOutboxPending(false, rerunForceCards).catch((err: any) => {
          log.error('[OutboxService] Erreur non capturée dans le re-run planifié de processOutboxPending :', err);
        });
      });
    }
  }
}

/**
 * Planifie l'exécution de processOutboxPending de façon **non-bloquante**.
 *
 * Utilise setImmediate() pour sortir du call-stack courant et exécuter
 * le traitement dans la prochaine itération de la boucle d'événements Node.js,
 * protégeant ainsi le thread UI d'Electron contre tout gel.
 *
 * @param forceCards - Répercuté tel quel sur `processOutboxPending` (voir sa doc) :
 *   par défaut `false` (comportement inchangé, respecte le toggle "Envoi Automatique"
 *   pour t_cartes). Seul un appelant explicite qui doit garantir l'envoi immédiat d'une
 *   correction unitaire de carte, indépendamment de ce toggle, doit passer `true`.
 */
export function scheduleOutboxProcessing(forceCards: boolean = false): void {
  setImmediate(() => {
    processOutboxPending(false, forceCards).catch((err: any) => {
      log.error('[OutboxService] Erreur non capturée dans processOutboxPending :', err);
    });
  });
}

/**
 * Retourne le nombre d'entrées PENDING dans t_outbox.
 * Utile pour les logs de statut du SyncEngine et les badges UI.
 *
 * @param tableName - Optionnel. Si fourni, restreint le comptage à cette seule table
 *   (ex: 't_cartes' pour le badge du bouton "Envoyer les corrections", qui doit refléter
 *   uniquement les cartes en attente — pas les entrées t_sites/t_centres/t_users/t_logs
 *   qui s'envoient déjà automatiquement sans lien avec ce bouton). Omis = comportement
 *   inchangé (compte toutes les tables confondues).
 */
export function getOutboxPendingCount(tableName?: string): number {
  try {
    const db = getDatabase();
    if (!db) return 0;
    const row = tableName
      ? db.prepare(
          `SELECT COUNT(*) as count FROM t_outbox WHERE status = 'PENDING' AND table_name = ?`
        ).get(tableName) as { count: number } | undefined
      : db.prepare(
          `SELECT COUNT(*) as count FROM t_outbox WHERE status = 'PENDING'`
        ).get() as { count: number } | undefined;
    return row ? row.count : 0;
  } catch {
    return 0;
  }
}

/**
 * Retourne le nombre d'entrées t_outbox pour une table et un statut donnés — un COUNT(*)
 * direct, jamais une accumulation en mémoire. Complète `getOutboxPendingCount` (qui ne
 * couvre que PENDING) pour permettre à un appelant de mesurer un résultat par différence
 * "vérité base de données" avant/après une fenêtre de traitement, plutôt que par
 * accumulation via le callback `onEntryProcessed` de `processOutboxPending` — cette
 * dernière approche est structurellement aveugle à tout traitement survenant EN DEHORS de
 * l'appelant (ex: le rerun automatique déclenché par `_rerunRequested`/`_rerunForceCards`
 * ci-dessus lors d'une collision de verrou `_isProcessing`, qui ne fournit jamais de
 * callback). Un diff `getOutboxCountByStatus(table, 'SYNCED')` avant/après reste exact quelle
 * que soit la source du traitement, car SYNCED/ERROR ne sont écrits que par ce module
 * (`_markOutboxError` et le bloc `db.transaction` de succès ci-dessus).
 *
 * Utilisé par `sync:startBulk` (handlers.ts) pour compter de façon fiable les cartes
 * réellement transmises/en échec pendant le vidage forcé de t_outbox (voir commentaire
 * détaillé au point d'usage — remplace 2 correctifs empilés précédents basés sur
 * l'accumulation locale, tous deux défaillants face au rerun automatique).
 *
 * @param tableName - Table cible (ex: 't_cartes').
 * @param status - Statut ciblé ('PENDING' | 'SYNCED' | 'ERROR').
 */
export function getOutboxCountByStatus(tableName: string, status: 'PENDING' | 'SYNCED' | 'ERROR'): number {
  try {
    const db = getDatabase();
    if (!db) return 0;
    const row = db.prepare(
      `SELECT COUNT(*) as count FROM t_outbox WHERE status = ? AND table_name = ?`
    ).get(status, tableName) as { count: number } | undefined;
    return row ? row.count : 0;
  } catch {
    return 0;
  }
}

/**
 * Retourne l'ENSEMBLE des `id` (TEXT PRIMARY KEY, cf. schema.ts) actuellement en statut
 * ERROR pour une table donnée — jamais un simple compte.
 *
 * Corrige un défaut structurel de `getOutboxCountByStatus(table, 'ERROR')` utilisé en diff
 * avant/après (voir point d'usage dans handlers.ts, sync:startBulk) : contrairement à SYNCED,
 * le bucket ERROR n'est PAS monotone — `_promoteEligibleErrorsToPending()` ci-dessous (appelée
 * à chaque cycle périodique, indépendamment du vidage forcé de t_outbox) peut faire sortir une
 * entrée d'ERROR (promotion en PENDING, puis succès) pendant la même fenêtre qu'une AUTRE
 * entrée y entre réellement. Un diff de COUNT(*) neutralise alors les deux mouvements (ex:
 * -1 puis +1 = 0), masquant une carte réellement bloquée en échec dans le message affiché à
 * l'agent (audit non-régression agent-9-senior-auditor, commit eb375d8).
 *
 * Un diff d'ENSEMBLES d'id (id présents "après" mais absents "avant") reste exact quel que
 * soit ce mouvement de sortie concurrent : seules les entrées réellement NOUVELLES dans le
 * bucket ERROR comptent comme "nouvelle erreur" pour la fenêtre observée.
 *
 * @param tableName - Table cible (ex: 't_cartes').
 */
export function getOutboxErrorIds(tableName: string): Set<string> {
  try {
    const db = getDatabase();
    if (!db) return new Set();
    const rows = db.prepare(
      `SELECT id FROM t_outbox WHERE status = 'ERROR' AND table_name = ?`
    ).all(tableName) as { id: string }[];
    return new Set(rows.map((r) => r.id));
  } catch {
    return new Set();
  }
}

/**
 * Retourne le nombre d'entrées "actionnables" dans t_outbox : PENDING (en attente d'un
 * prochain cycle d'envoi) ET ERROR (échec d'envoi après épuisement des tentatives
 * automatiques, cf. MAX_OUTBOX_ATTEMPTS). Fonction additive, distincte de
 * `getOutboxPendingCount` — celle-ci reste inchangée et continue de servir de condition
 * d'arrêt à la boucle de vidage forcé de `sync:startBulk` (handlers.ts) ; élargir son filtre
 * à ERROR y casserait ce comportement (une carte en ERROR ne doit pas bloquer indéfiniment
 * cette boucle de vidage).
 *
 * Usage : détecter, côté UI, une carte réellement bloquée en échec d'auto-envoi (pas
 * seulement une entrée en cours de traitement normal) afin de réafficher le bouton manuel de
 * synchro upstream quand l'envoi automatique est actif — cf. usePushButtonVisibility.ts.
 *
 * @param tableName - Optionnel. Si fourni, restreint le comptage à cette seule table
 *   (ex: 't_cartes').
 */
export function getOutboxActionableCount(tableName?: string): number {
  try {
    const db = getDatabase();
    if (!db) return 0;
    const row = tableName
      ? db.prepare(
          `SELECT COUNT(*) as count FROM t_outbox WHERE status IN ('PENDING', 'ERROR') AND table_name = ?`
        ).get(tableName) as { count: number } | undefined
      : db.prepare(
          `SELECT COUNT(*) as count FROM t_outbox WHERE status IN ('PENDING', 'ERROR')`
        ).get() as { count: number } | undefined;
    return row ? row.count : 0;
  } catch {
    return 0;
  }
}

/**
 * Indique si `processOutboxPending` est actuellement en cours d'exécution
 * (verrou anti-concurrence `_isProcessing`, en lecture seule).
 *
 * Usage : permettre à un appelant externe (ex: handlers IPC de suppression de
 * hiérarchie `hierarchy:deleteSite` / `handleDeleteCentreLogic`) d'attendre la
 * fin d'un cycle d'envoi en cours avant une opération destructrice locale,
 * afin d'éviter la fenêtre de course où `cancelPendingInsert()` supprimerait
 * une entrée t_outbox PENDING pendant qu'un appel réseau Supabase est déjà en
 * vol pour cette même entrée (upsert qui aboutirait après coup en ligne
 * fantôme orpheline côté cloud, jamais nettoyée).
 */
export function isOutboxProcessing(): boolean {
  return _isProcessing;
}

// ─── Helpers privés ──────────────────────────────────────────────────────────

/** Verrou interne anti-concurrence du worker outbox. */
let _isProcessing = false;

/**
 * Dette de re-run : positionnée à `true` par processOutboxPending() lorsqu'un appel est
 * reçu alors que `_isProcessing` est déjà vrai (voir commentaire détaillé au point
 * d'usage). Consommée une seule fois dans le `finally` de processOutboxPending, juste
 * après la libération du verrou, pour garantir qu'aucune entrée t_outbox fraîchement
 * enfilée pendant un traitement en cours ne reste orpheline (bug de course confirmé par
 * agent-13-qa-terrain-tester, e2e cloud, 2 échecs/3 tentatives).
 */
let _rerunRequested = false;

/**
 * `forceCards` à utiliser pour le rerun planifié via `_rerunRequested`. Combiné en OR
 * logique (jamais écrasé) si plusieurs appels divergents sur ce paramètre collisionnent
 * avec le même traitement en cours — une seule demande avec forceCards=true suffit à
 * exiger que le rerun ignore le gating "Envoi Automatique", même si une autre demande
 * concurrente avait forceCards=false.
 */
let _rerunForceCards = false;

/**
 * Marque une entrée outbox en statut ERROR avec le message d'erreur fourni.
 * Opération synchrone SQLite (très rapide, non bloquante pour l'UI).
 *
 * `expected` (garde anti-course, audit 2026-10-26 point 5) : si fourni, l'écriture n'a lieu
 * que si la ligne porte encore cette operation + ce payload (version lue dans le lot). Une
 * entrée ré-enfilée entre-temps n'est pas marquée ERROR (elle reste PENDING).
 *
 * @returns `true` si la ligne a effectivement été passée en ERROR.
 */
function _markOutboxError(
  db: NonNullable<ReturnType<typeof getDatabase>>,
  id: string,
  attempts: number,
  errorMsg: string,
  expected?: { operation: string; payload: string }
): boolean {
  try {
    const res = expected
      ? db.prepare(`
          UPDATE t_outbox SET status = 'ERROR', error_msg = ?, attempts = ?, last_attempt_at = datetime('now')
          WHERE id = ? AND operation = ? AND payload = ?
        `).run(errorMsg, attempts, id, expected.operation, expected.payload)
      : db.prepare(`
          UPDATE t_outbox SET status = 'ERROR', error_msg = ?, attempts = ?, last_attempt_at = datetime('now') WHERE id = ?
        `).run(errorMsg, attempts, id);
    if (res.changes === 0) {
      log.info(`[OutboxService] Entrée ${id} non passée en ERROR : ré-enfilée (ou retirée) depuis sa lecture, nouvelle version conservée.`);
      return false;
    }
    return true;
  } catch (err: any) {
    log.error(`[OutboxService] Impossible de marquer l'entrée ${id} en ERROR :`, err.message);
    return false;
  }
}

/**
 * Enregistre la dernière erreur d'envoi (error_msg + last_attempt_at) d'une entrée qui RESTE
 * en PENDING (erreur Supabase non transitoire sous le seuil, ou exception) — audit 2026-10-26,
 * chantier C3 : auparavant ces échecs n'étaient visibles que dans les logs. Ne modifie ni le
 * statut ni attempts (déjà incrémenté avant l'envoi). Même garde anti-course que
 * _markOutboxError : sans effet si l'entrée a été ré-enfilée pendant l'envoi.
 * last_attempt_at n'est lu par _promoteEligibleErrorsToPending que pour les entrées ERROR.
 */
function _recordOutboxAttemptError(
  db: NonNullable<ReturnType<typeof getDatabase>>,
  entry: Pick<OutboxEntry, 'id' | 'operation' | 'payload'>,
  errorMsg: string
): void {
  try {
    db.prepare(`
      UPDATE t_outbox SET error_msg = ?, last_attempt_at = datetime('now')
      WHERE id = ? AND status = 'PENDING' AND operation = ? AND payload = ?
    `).run(errorMsg, entry.id, entry.operation, entry.payload);
  } catch (err: any) {
    log.error(`[OutboxService] Impossible d'enregistrer l'erreur de l'entrée ${entry.id} :`, err.message || err);
  }
}

/** Message d'erreur Supabase lisible, préfixé du code PostgreSQL quand il est connu (ex: 23503). */
function _formatSupabaseError(error: { message: string; code?: string }): string {
  return error.code ? `[${error.code}] ${error.message}` : error.message;
}

/**
 * Calcule le délai de backoff (en minutes) avant qu'une entrée ERROR ayant
 * cumulé `attempts` tentatives redevienne éligible à une nouvelle promotion
 * PENDING. Doublement à chaque tentative au-delà de MAX_OUTBOX_ATTEMPTS,
 * plafonné à OUTBOX_ERROR_BACKOFF_MAX_MINUTES (24h).
 */
function _computeErrorBackoffMinutes(attempts: number): number {
  const exponent = Math.max(0, attempts - MAX_OUTBOX_ATTEMPTS);
  const delay = OUTBOX_ERROR_BACKOFF_BASE_MINUTES * Math.pow(2, exponent);
  return Math.min(delay, OUTBOX_ERROR_BACKOFF_MAX_MINUTES);
}

/**
 * Retry automatique des entrées `t_outbox` en échec définitif (ERROR).
 *
 * Sélectionne les entrées ERROR dont le backoff (voir _computeErrorBackoffMinutes)
 * est écoulé depuis `last_attempt_at`, et les repasse en PENDING pour qu'elles
 * soient reprises par la boucle de traitement de processOutboxPending juste après.
 *
 * IMPORTANT : `attempts` n'est JAMAIS réinitialisé ici. Le compteur doit continuer
 * de croître à chaque nouvel échec pour alimenter le calcul de backoff au tour
 * suivant — le réinitialiser provoquerait une boucle de tentatives rapprochées à
 * l'infini sur une entrée durablement en échec (ex: payload invalide).
 *
 * N'est appelée que depuis le cycle périodique (voir paramètre `fromPeriodicCycle`
 * de processOutboxPending) — jamais depuis les appels post-mutation immédiats.
 */
function _promoteEligibleErrorsToPending(db: NonNullable<ReturnType<typeof getDatabase>>): void {
  try {
    const errorEntries = db.prepare(
      `SELECT id, attempts, last_attempt_at FROM t_outbox WHERE status = 'ERROR'`
    ).all() as { id: string; attempts: number; last_attempt_at: string | null }[];

    if (errorEntries.length === 0) return;

    const now = Date.now();
    const eligibleIds: string[] = [];

    for (const entry of errorEntries) {
      if (!entry.last_attempt_at) {
        // Entrée historique sans last_attempt_at (créée avant migration V68) :
        // éligible immédiatement, pas de date de référence pour un backoff.
        eligibleIds.push(entry.id);
        continue;
      }
      // Format SQLite datetime('now') : "YYYY-MM-DD HH:MM:SS" (UTC, sans suffixe).
      const lastAttemptMs = new Date(entry.last_attempt_at.replace(' ', 'T') + 'Z').getTime();
      if (Number.isNaN(lastAttemptMs)) {
        eligibleIds.push(entry.id);
        continue;
      }
      const backoffMinutes = _computeErrorBackoffMinutes(entry.attempts);
      const elapsedMinutes = (now - lastAttemptMs) / 60000;
      if (elapsedMinutes >= backoffMinutes) {
        eligibleIds.push(entry.id);
      }
    }

    if (eligibleIds.length === 0) return;

    const promote = db.prepare(`UPDATE t_outbox SET status = 'PENDING' WHERE id = ? AND status = 'ERROR'`);
    db.transaction(() => {
      for (const id of eligibleIds) {
        promote.run(id);
      }
    })();

    log.info(`[OutboxService] ${eligibleIds.length} entrée(s) ERROR promue(s) en PENDING (backoff écoulé, nouvelle tentative automatique).`);
  } catch (err: any) {
    log.error('[OutboxService] Erreur lors de la promotion des entrées ERROR éligibles :', err.message || err);
  }
}

/**
 * Remet à zéro le flag local `is_dirty` (et `synced_at` quand la colonne
 * existe) de l'entité correspondant à une entrée outbox INSERT/UPDATE dont
 * l'upsert Supabase vient d'être confirmé en succès.
 *
 * Corrige un défaut où une carte (ou autre entité) modifiée localement puis
 * synchronisée avec succès restait signalée "en attente" (is_dirty = 1) de
 * façon permanente — outbox.service.ts ne touchait jamais aux tables
 * métier après un upsert réussi, contrairement à upload-worker.js:272 qui le
 * fait pour son propre chemin (bulk upload manuel "Envoyer les corrections").
 *
 * Portée volontairement limitée aux tables qui possèdent réellement is_dirty
 * ET transitent par enqueueOutbox() : t_cartes, t_users et t_logs (is_dirty +
 * synced_at, voir schema.ts), t_sites et t_centres (is_dirty seul, pas de
 * colonne synced_at sur ces deux tables). t_user_roles/t_postes n'ont pas de
 * notion is_dirty équivalente sur ce chemin → ignorés (défaut absent).
 * Ne s'applique jamais à un DELETE : la ligne locale est déjà supprimée
 * physiquement par l'appelant dans ce cas (voir plus haut dans la boucle).
 */
function _clearLocalDirtyFlag(
  db: NonNullable<ReturnType<typeof getDatabase>>,
  tableName: string,
  syncIdValue: string | undefined
): void {
  if (!syncIdValue) return;
  try {
    switch (tableName) {
      case 't_cartes':
      case 't_users':
        db.prepare(`UPDATE ${tableName} SET is_dirty = 0, synced_at = datetime('now') WHERE sync_id = ?`).run(syncIdValue);
        break;
      case 't_sites':
      case 't_centres':
        db.prepare(`UPDATE ${tableName} SET is_dirty = 0 WHERE sync_id = ?`).run(syncIdValue);
        break;
      case 't_logs':
        // Journal d'audit CRUD synchronisable (voir src/main/utils/audit.ts, aiguillage
        // CRUD_SYNC_WHITELIST). t_logs possède is_dirty + synced_at (mêmes colonnes que
        // t_cartes/t_users) — même traitement de remise à zéro après upsert Supabase confirmé.
        db.prepare(`UPDATE t_logs SET is_dirty = 0, synced_at = datetime('now') WHERE sync_id = ?`).run(syncIdValue);
        break;
      default:
        // Table sans notion is_dirty équivalente sur ce chemin (t_postes,
        // t_user_roles) — rien à faire.
        break;
    }
  } catch (err: any) {
    log.error(`[OutboxService] Erreur lors de la remise à zéro locale de is_dirty pour ${tableName} (sync_id=${syncIdValue}) :`, err.message || err);
  }
}

/**
 * Valeur d'une colonne du bloc statut ramenée à une forme comparable entre l'envoi (payload
 * mappé, chaînes locales) et la réponse PostgREST. Vide/absent → null. date_delivrance est la
 * seule colonne TIMESTAMPTZ du bloc (vérifié dans information_schema du dev le 2026-10-27) :
 * PostgREST la renvoie normalisée ("2026-10-20T09:00:00+00:00") alors que le poste envoie
 * "2026-10-20T09:00:00.000Z" — comparaison à la milliseconde, chaîne sans fuseau lue en UTC
 * (fuseau de session Supabase = UTC). Les autres colonnes sont TEXT : renvoyées telles quelles.
 * DUPLIQUÉ dans src/main/workers/upload-worker.js (normalizeStatusValue) — tenir synchronisé.
 */
function _normalizeStatusValue(column: string, value: unknown): string | null {
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
 * Colonnes du bloc statut dont la valeur renvoyée par le cloud diffère de la valeur envoyée.
 * Une colonne absente de la réponse est ignorée. Tableau vide = pas de conflit (cas normal,
 * et cas unique tant que le trigger 0006 n'est pas appliqué en production).
 */
function _diffStatusBlock(sent: Record<string, unknown>, cloud: Record<string, unknown>): string[] {
  const diff: string[] = [];
  for (const column of STATUS_BLOCK_COLUMNS) {
    if (!(column in cloud)) continue;
    if (_normalizeStatusValue(column, sent[column]) !== _normalizeStatusValue(column, cloud[column])) {
      diff.push(column);
    }
  }
  return diff;
}

/**
 * Applique localement le bloc statut gardé par le cloud (A-02 étape 2). Appelée DANS la
 * transaction qui passe l'entrée outbox en SYNCED (après la garde anti-course).
 *  - t_cartes : les colonnes du bloc renvoyées par le cloud, updated_at = valeur cloud
 *    (greatest(NEW, OLD) + 1 ms, posé par le trigger), is_dirty = 0, synced_at. Aucun autre
 *    champ local touché (contact, rangement, bloc absence...). Filtre sync_id + site_id
 *    (cloisonnement §3, site_id = celui de la carte envoyée).
 *  - t_logs : une ligne CONFLIT_SYNC_STATUT (valeur_avant = bloc écarté, valeur_apres = bloc
 *    gardé), au format des journaux système locaux (id_user NULL, login 'SYSTEM', is_dirty 1
 *    comme SYNC_UPDATE / CENTRE_CARTE_CORRIGE). Elle n'est PAS mise en file t_outbox : le cloud
 *    trace déjà l'arbitrage dans t_sync_conflicts, et seules les actions de CRUD_SYNC_WHITELIST
 *    (utils/audit.ts) partent au cloud.
 *  - Aucune nouvelle mise en file pour la carte : le cloud porte déjà la version juste.
 */
function _applyCloudStatusBlock(
  db: NonNullable<ReturnType<typeof getDatabase>>,
  sent: Record<string, unknown>,
  cloud: Record<string, unknown>,
  diffColumns: string[]
): void {
  const syncId = String(sent.sync_id);
  const columns = STATUS_BLOCK_COLUMNS.filter((c) => c in cloud);
  const assignments = columns.map((c) => `${c} = ?`).join(', ');
  const cloudUpdatedAt = typeof cloud.updated_at === 'string' && cloud.updated_at !== '' ? cloud.updated_at : null;
  db.prepare(`
    UPDATE t_cartes SET ${assignments}, updated_at = COALESCE(?, updated_at), is_dirty = 0, synced_at = datetime('now')
    WHERE sync_id = ? AND site_id = ?
  `).run(...columns.map((c) => (cloud[c] ?? null) as string | null), cloudUpdatedAt, syncId, sent.id_site as number);

  const kept: Record<string, unknown> = { statut: cloud.statut ?? null };
  const rejected: Record<string, unknown> = { statut: sent.statut ?? null };
  for (const c of diffColumns) {
    kept[c] = cloud[c] ?? null;
    rejected[c] = sent[c] ?? null;
  }
  const detail = `Conflit de synchronisation (carte ${syncId}) : le cloud a gardé le statut "${String(kept.statut)}" ` +
    `(envoyé : "${String(rejected.statut)}"). Champs du bloc statut repris du cloud : ${diffColumns.join(', ')}.`;
  db.prepare(`
    INSERT INTO t_logs (id_user, login_user, action, detail, valeur_avant, valeur_apres, sync_id, is_dirty, site_id, centre_id)
    VALUES (NULL, 'SYSTEM', 'CONFLIT_SYNC_STATUT', ?, ?, ?, ?, 1, ?, ?)
  `).run(
    detail,
    JSON.stringify({ sync_id: syncId, ecarte: rejected }),
    JSON.stringify({ sync_id: syncId, garde: kept, updated_at: cloudUpdatedAt }),
    uuidv4(),
    sent.id_site as number,
    (sent.id_centre ?? null) as number | null
  );

  log.warn(`[OutboxService] ${detail}`);
}

/**
 * Détecte sans ambiguïté un échec de clé étrangère PostgreSQL (SQLSTATE 23503) renvoyé par
 * PostgREST/supabase-js. PostgrestError expose `code`, `message`, `details`, `hint` (Context7
 * /supabase/postgrest-js) ; `code` peut néanmoins être absent selon le chemin d'erreur, d'où le
 * repli sur le texte PostgreSQL « violates foreign key constraint ». Une erreur réseau/transitoire
 * ou toute autre erreur (42501, 23505...) ne correspond jamais à ce test.
 */
function _isForeignKeyViolation(err: { message?: string; code?: string; details?: string | null }): boolean {
  if (err.code === '23503') return true;
  const text = `${err.message || ''} ${err.details || ''}`.toLowerCase();
  return text.includes('violates foreign key constraint');
}

/**
 * Filet de sécurité L2-3b : le DELETE cloud d'un agent (t_users) a été refusé par une FK
 * (t_cartes.created_by / t_logs.id_user → t_users sans ON DELETE) : l'agent a une activité côté
 * cloud que le contrôle local n'a pas pu prévoir. La ligne locale zombie (statut_actif = -1,
 * is_dirty = -1) est rendue visible et désactivée (statut_actif = 0, is_dirty = 1) et un UPDATE
 * t_users complet (statut_actif 0) est enfilé pour que le cloud, qui contient l'agent ACTIF,
 * passe aussi à 0 (sinon la synchro descendante le réactiverait) ; l'entrée DELETE est clôturée (SYNCED).
 *
 * Course DELETE/recréation : la ligne locale est relue dans la même transaction que l'écriture ;
 * elle n'est modifiée que si statut_actif = -1. Si elle a été recréée/réactivée entre-temps (ou
 * n'existe plus), seule l'entrée DELETE est clôturée, sans effet destructeur. La clôture est
 * gardée sur operation = 'DELETE' pour ne jamais écraser une entrée ré-enfilée (INSERT/UPDATE
 * partageant le même id). Jamais de suppression physique ; t_user_roles et leurs entrées outbox
 * ne sont pas touchés.
 */
function _handleUserDeleteForeignKeyViolation(
  db: NonNullable<ReturnType<typeof getDatabase>>,
  outboxId: string,
  syncId: string,
  cloudMessage: string
): void {
  const { reactivated } = db.transaction(() => {
    const row = db.prepare('SELECT id_user, login, password_hash, role, statut_actif FROM t_users WHERE sync_id = ?').get(syncId) as
      | { id_user: number; login: string; password_hash: string; role: string; statut_actif: number }
      | undefined;
    let reactivatedLogin: string | null = null;
    if (row && row.statut_actif === -1) {
      // is_dirty = 1 + UPDATE enfilé : le cloud contient l'agent ACTIF ; sans cela la synchro
      // descendante (upsertCloudUser, règles « ligne propre ») le réactiverait localement.
      db.prepare(
        "UPDATE t_users SET statut_actif = 0, is_dirty = 1, updated_at = datetime('now') WHERE sync_id = ? AND statut_actif = -1"
      ).run(syncId);
      reactivatedLogin = row.login;
    }
    // Clôture du DELETE d'abord (gardée sur operation = 'DELETE'), puis ré-enfilage de l'UPDATE
    // sur le même id : état final = UNE entrée UPDATE PENDING pour ce sync_id.
    db.prepare(
      "UPDATE t_outbox SET status = 'SYNCED', error_msg = NULL WHERE id = ? AND operation = 'DELETE'"
    ).run(outboxId);
    if (row && reactivatedLogin !== null) {
      enqueueOutbox(syncId, 't_users', 'UPDATE', {
        sync_id: syncId,
        login: row.login,
        password_hash: row.password_hash,
        role: row.role,
        statut_actif: 0,
        updated_at: new Date().toISOString()
      });
      const queued = db.prepare("SELECT 1 FROM t_outbox WHERE id = ? AND operation = 'UPDATE' AND status = 'PENDING'").get(syncId);
      if (!queued) throw new Error("Enfilage de l'UPDATE de désactivation impossible");
    }
    return { reactivated: reactivatedLogin };
  })();

  if (reactivated !== null) {
    log.warn(
      `[OutboxService] Suppression cloud de l'agent "${reactivated}" (sync_id=${syncId}) refusée (clé étrangère) : ` +
      `activité enregistrée côté cloud. Agent désactivé localement au lieu d'être supprimé. Détail : ${cloudMessage}`
    );
    insertAuditLog(
      'SYSTEM',
      'VALIDATION',
      `[DESACTIVATION] Suppression définitive de l'agent "${reactivated}" (sync_id=${syncId}) refusée par le cloud (activité enregistrée côté cloud) : agent désactivé au lieu d'être supprimé.`
    );
  } else {
    log.warn(
      `[OutboxService] Suppression cloud de t_users (sync_id=${syncId}) refusée (clé étrangère) mais la ligne locale n'est plus en statut -1 ` +
      `(recréée/réactivée ou absente) : entrée DELETE clôturée sans modification locale.`
    );
  }
}

/**
 * Détecte si un message d'erreur Supabase correspond à une erreur réseau transitoire.
 * Les erreurs transitoires conservent le statut PENDING pour nouvelle tentative.
 * Les erreurs applicatives (contrainte, droits) peuvent déclencher le basculement en ERROR.
 */
function _isTransientNetworkError(errorMessage: string): boolean {
  const transientPatterns = [
    'network', 'timeout', 'ECONNREFUSED', 'ENOTFOUND',
    'ETIMEDOUT', 'fetch failed', 'Failed to fetch',
    'socket hang up', 'NetworkError', 'ERR_NETWORK'
  ];
  const lower = errorMessage.toLowerCase();
  return transientPatterns.some(p => lower.includes(p.toLowerCase()));
}

// ─── Ré-exports publics ──────────────────────────────────────────────────────
/**
 * Génère un UUID v4 pour les appelants (alias de uuidv4).
 * Chaque identifiant doit être généré UNE SEULE FOIS par opération de création.
 */
export { uuidv4 as generateOutboxId };

/**
 * Type union public décrivant toutes les opérations supportées par l'outbox.
 * Utilisable par les appelants externes (queries) pour le typage strict.
 */
export type OutboxOperation = 'INSERT' | 'UPDATE' | 'DELETE';

/**
 * Réinitialise les entrées en ERROR à PENDING au démarrage de l'application
 * pour garantir que les erreurs persistantes ne soient pas oubliées.
 */
export function resetOutboxErrors(): void {
  try {
    const db = getDatabase();
    if (!db) return;
    const result = db.prepare("UPDATE t_outbox SET status = 'PENDING', attempts = 0 WHERE status = 'ERROR'").run();
    if (result.changes > 0) {
      log.info(`[OutboxService] ${result.changes} entrée(s) en ERROR réinitialisée(s) en PENDING.`);
    }
  } catch (err: any) {
    log.error(`[OutboxService] Erreur lors de la réinitialisation des erreurs outbox :`, err.message || err);
  }
}
