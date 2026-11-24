import log from 'electron-log';
import type { Database } from 'better-sqlite3';
import { getSupabaseClient } from './supabase-client';
import { getDatabase } from '../database/connection';
import { writeCardsChunkWithoutCursor } from './downstream';

/**
 * Rattrapage des cartes manquantes par reconciliation de listes de sync_id ("piste 1").
 *
 * Probleme traite : le pull descendant est pilote par un curseur (updated_at, sync_id). Une carte
 * arrivee dans le cloud avec un updated_at <= curseur d'un poste recepteur (horloge cliente en
 * retard, ancienne version, echec silencieux...) n'est jamais re-telechargee. Ce module compare
 * l'ensemble des sync_id du site cote cloud avec ceux presents en local et ne telecharge QUE les
 * manquants (INSERT uniquement : une carte absente localement n'a pas de conflit possible).
 * Aucune condition de declenchement par comptage : un poste peut avoir autant (ou plus) de cartes
 * locales que le cloud (cartes non encore poussees, doublons) tout en manquant des cartes cloud.
 * Cout : ~1 requete cloud par 1000 cartes du site a chaque passage (<= 1x/24 h et par poste depuis
 * R1, cf. planification en fin de fichier et sync-engine).
 *
 * Garanties :
 *  - Ne touche JAMAIS au curseur last_downstream_sync / last_downstream_sync_id (le worker est
 *    appele avec skipWatermark=true).
 *  - Toutes les requetes cloud portent .eq('id_site', siteId) (CLAUDE.md §3). Les lignes retournees
 *    dont id_site differe sont ecartees avant ecriture (defense en profondeur).
 *  - Low-memory (§2) : pages cloud de 1000 sync_id (max-rows PostgREST par defaut), comparaison
 *    SQLite par lots <= 500, recuperation par `.in()` de 100 (limite d'URL ~8000 caracteres du
 *    client supabase-js), ecriture worker par lots <= 500, cession de boucle entre les lots. Les
 *    manquantes sont traitees page par page : jamais la liste complete en memoire.
 *  - Table locale du site vide (purge locale, installation neuve) : passage ignore (status
 *    'skipped-empty-local'), le telechargement initial prend le relais.
 *  - Chaque requete cloud est limitee a 15 s (AbortController) pour ne pas garder le verrou de
 *    synchro sur un reseau degrade.
 *  - Aucune exception ne sort : une erreur reseau/Supabase/worker interrompt le passage et est
 *    renvoyee dans le resultat (status 'error'), le prochain passage reprend depuis zero.
 *  - Cartes avec une suppression en attente dans t_outbox : ecartees (evite de ressusciter une
 *    carte dont le DELETE n'est pas encore parti vers le cloud).
 */

export const RECONCILE_PAGE_SIZE = 1000;
export const RECONCILE_LOCAL_LOOKUP_CHUNK = 500;
export const RECONCILE_FETCH_IN_CHUNK = 100;
export const RECONCILE_WRITE_BATCH = 500;
/** Garde-fou : ~1 000 000 de cartes au maximum par passage. */
const RECONCILE_MAX_PAGES = 1000;
/** Delai maximal de CHAQUE requete cloud du rattrapage (pattern downstream.ts : AbortController). */
export const RECONCILE_REQUEST_TIMEOUT_MS = 15000;

export interface ReconcileResult {
  status: 'ok' | 'skipped' | 'skipped-empty-local' | 'error';
  missingFound: number;
  recovered: number;
  error?: string;
}

export interface ReconcileDeps {
  supabase: any;
  db: Database;
  writeChunk: (cards: any[], siteId: number, myCentreId: number | null) => Promise<{ processed: number; insertedCount: number }>;
  yieldFn: () => Promise<void>;
  /** Delai maximal par requete cloud (defaut RECONCILE_REQUEST_TIMEOUT_MS ; surcharge pour les tests). */
  requestTimeoutMs: number;
}

/** Retourne, parmi cloudIds, ceux absents de t_cartes local (comparaison par lots <= 500). */
export function findMissingSyncIds(db: Database, cloudIds: string[], excluded?: Set<string>): string[] {
  const missing: string[] = [];
  for (let i = 0; i < cloudIds.length; i += RECONCILE_LOCAL_LOOKUP_CHUNK) {
    const chunk = cloudIds.slice(i, i + RECONCILE_LOCAL_LOOKUP_CHUNK);
    const placeholders = chunk.map(() => '?').join(',');
    const rows = db.prepare(`SELECT sync_id FROM t_cartes WHERE sync_id IN (${placeholders})`).all(...chunk) as { sync_id: string }[];
    const present = new Set(rows.map(r => r.sync_id));
    for (const id of chunk) {
      if (!present.has(id) && !(excluded && excluded.has(id))) missing.push(id);
    }
  }
  return missing;
}

/** sync_id de cartes dont une suppression est en attente dans l'outbox (a ne pas ressusciter). */
function getPendingDeleteSyncIds(db: Database): Set<string> {
  try {
    const rows = db.prepare(
      `SELECT json_extract(payload, '$.sync_id') AS s FROM t_outbox
       WHERE table_name = 't_cartes' AND operation = 'DELETE' AND status != 'SYNCED'`
    ).all() as { s: string | null }[];
    return new Set(rows.map(r => r.s).filter((s): s is string => !!s));
  } catch {
    return new Set();
  }
}

/**
 * Execute une requete cloud avec un delai maximal. Un timeout annule la requete (AbortError) ;
 * le client supabase-js renvoie alors { error } que l'appelant transforme en exception, geree par
 * le catch global (status 'error').
 */
async function withTimeout<T>(builder: any, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await builder.abortSignal(controller.signal);
  } finally {
    clearTimeout(timeoutId);
  }
}

const defaultYield = (): Promise<void> => new Promise(resolve => setImmediate(resolve));

export async function reconcileMissingCards(
  siteId: number,
  myCentreId: number | null,
  depsOverride?: Partial<ReconcileDeps>
): Promise<ReconcileResult> {
  const result: ReconcileResult = { status: 'skipped', missingFound: 0, recovered: 0 };
  if (!siteId || isNaN(Number(siteId))) return result;

  const supabase = depsOverride?.supabase ?? getSupabaseClient();
  const db = depsOverride?.db ?? getDatabase();
  if (!supabase || !db) return result;
  const writeChunk = depsOverride?.writeChunk ?? writeCardsChunkWithoutCursor;
  const yieldFn = depsOverride?.yieldFn ?? defaultYield;
  const timeoutMs = depsOverride?.requestTimeoutMs ?? RECONCILE_REQUEST_TIMEOUT_MS;

  try {
    // Table locale vide pour ce site : purge locale (db:purge / db:emergency-purge) ou installation
    // neuve (deja couverte par le telechargement initial). Rattraper ici ferait reapparaitre tout le
    // cloud (et des doublons apres un re-import CSV) : on ne fait rien, sans aucune requete cloud.
    const localRow = db.prepare('SELECT COUNT(*) AS n FROM t_cartes WHERE site_id = ?').get(siteId) as { n: number } | undefined;
    if (!localRow || localRow.n === 0) {
      result.status = 'skipped-empty-local';
      log.info(`[SYNC][Reconcile] Site ${siteId} : table locale vide (purge ou installation neuve) - rattrapage ignore.`);
      return result;
    }

    const pendingDeletes = getPendingDeleteSyncIds(db);
    const writeBuffer: any[] = [];
    const flush = async (force: boolean): Promise<void> => {
      while (writeBuffer.length >= RECONCILE_WRITE_BATCH || (force && writeBuffer.length > 0)) {
        const batch = writeBuffer.splice(0, RECONCILE_WRITE_BATCH);
        const res = await writeChunk(batch, siteId, myCentreId);
        result.recovered += res.insertedCount;
        await yieldFn();
      }
    };

    // 1. Pagination keyset sur sync_id (ordre stable, insensible aux insertions concurrentes).
    let lastSyncId: string | null = null;
    for (let page = 0; page < RECONCILE_MAX_PAGES; page++) {
      let q = supabase.from('t_cartes').select('sync_id').eq('id_site', siteId);
      if (lastSyncId !== null) q = q.gt('sync_id', lastSyncId);
      const { data: pageRows, error: pageErr } = await withTimeout<{ data: any[] | null; error: { message: string } | null }>(
        q.order('sync_id', { ascending: true }).limit(RECONCILE_PAGE_SIZE), timeoutMs
      );
      if (pageErr) throw new Error(`liste des sync_id cloud : ${pageErr.message}`);
      if (!pageRows || pageRows.length === 0) break;

      const ids: string[] = (pageRows as { sync_id: string | null }[]).map(r => r.sync_id).filter((s): s is string => !!s);
      const pageLast = (pageRows[pageRows.length - 1] as { sync_id: string | null }).sync_id;

      const missing = findMissingSyncIds(db, ids, pendingDeletes);
      result.missingFound += missing.length;

      // 2. Recuperation des seules cartes manquantes (id_site obligatoire).
      for (let i = 0; i < missing.length; i += RECONCILE_FETCH_IN_CHUNK) {
        const chunk = missing.slice(i, i + RECONCILE_FETCH_IN_CHUNK);
        const { data: cards, error: cardsErr } = await withTimeout<{ data: any[] | null; error: { message: string } | null }>(
          supabase.from('t_cartes').select('*').in('sync_id', chunk).eq('id_site', siteId), timeoutMs
        );
        if (cardsErr) throw new Error(`recuperation des cartes manquantes : ${cardsErr.message}`);
        for (const c of (cards || [])) {
          if (Number(c.id_site) === Number(siteId)) writeBuffer.push(c);
        }
        await flush(false);
      }

      await yieldFn();

      // Garde-fou : un sync_id nul/vide en fin de page laisserait lastSyncId inchange (null) et
      // la pagination repartirait du debut : on sort de la boucle plutot que de rejouer la page.
      if (!pageLast) {
        log.warn(`[SYNC][Reconcile] Site ${siteId} : sync_id nul en fin de page ${page} - pagination interrompue.`);
        break;
      }
      lastSyncId = pageLast;
    }
    await flush(true);

    result.status = 'ok';
    log.info(`[SYNC][Reconcile] Site ${siteId} : ${result.missingFound} carte(s) manquante(s) detectee(s), ${result.recovered} recuperee(s).`);
    return result;
  } catch (err: any) {
    result.status = 'error';
    result.error = err?.message || String(err);
    log.warn(`[SYNC][Reconcile] Passage interrompu (site ${siteId}) apres ${result.recovered} carte(s) recuperee(s) : ${result.error}`);
    return result;
  }
}

// ─── PLANIFICATION PERSISTANTE (R1, plan quota Supabase gratuit du 2026-11-24) ──────────────────
//
// Un passage complet liste tous les sync_id du site (~4,3 Mo compresses pour ~223 000 cartes).
// Planifie en memoire (1 h, re-arme a 2 min a chaque connexion / changement de role / bascule de
// la preference), il tournait ~42 fois par jour et par poste. Desormais :
//  - la date du dernier passage REUSSI (status 'ok') est stockee dans t_config, par site
//    (cle locale au poste : t_config n'est jamais synchronisee vers le cloud) ;
//  - le passage suivant est du a last_ok + 24 h, quel que soit le nombre de reconnexions ;
//  - chaque tentative est horodatee (last_try) AVANT la premiere requete cloud : un passage
//    interrompu (erreur, fermeture de l'application) ne compte pas comme reussi mais ne peut pas
//    etre rejoue immediatement a la connexion suivante ;
//  - apres un echec, nouvel essai espace : 1 h, 2 h, 4 h puis 8 h maximum (compteur d'echecs
//    persistant, remis a zero par un succes).
// Aucune table creee : uniquement des cles t_config (table existante, INSERT OR REPLACE).

/** Intervalle minimal entre deux passages reussis, par poste et par site. */
export const CARDS_RECONCILE_MIN_INTERVAL_MS = 24 * 60 * 60 * 1000;
/**
 * Delai minimal apres le demarrage du cycle auto : laisse passer le premier pull (10 s) et le
 * premier tick du cycle court (15 s). S'applique aussi au tout premier passage d'un poste.
 */
export const CARDS_RECONCILE_INITIAL_DELAY_MS = 2 * 60 * 1000;
/** Premier delai de nouvel essai apres un echec / passage non abouti. */
export const CARDS_RECONCILE_RETRY_BASE_MS = 60 * 60 * 1000;
/** Plafond du delai de nouvel essai (echecs repetes). */
export const CARDS_RECONCILE_RETRY_MAX_MS = 8 * 60 * 60 * 1000;

export interface ReconcileScheduleState {
  /** Fin du dernier passage reussi (epoch ms), null si jamais. */
  lastOkMs: number | null;
  /** Debut (ou fin d'echec) de la derniere tentative (epoch ms), null si jamais. */
  lastTryMs: number | null;
  /** Nombre d'echecs consecutifs depuis le dernier succes. */
  failCount: number;
}

export function reconcileConfigKeys(siteId: number): { lastOk: string; lastTry: string; failCount: string } {
  const s = Number(siteId);
  return {
    lastOk: `cards_reconcile_last_ok_${s}`,
    lastTry: `cards_reconcile_last_try_${s}`,
    failCount: `cards_reconcile_fail_count_${s}`
  };
}

function readConfigValue(db: Database, key: string): string | null {
  const row = db.prepare('SELECT value FROM t_config WHERE key = ?').get(key) as { value: string | null } | undefined;
  return row?.value ?? null;
}

function writeConfigValue(db: Database, key: string, value: string): void {
  db.prepare("INSERT OR REPLACE INTO t_config (key, value, updated_at) VALUES (?, ?, datetime('now'))").run(key, value);
}

function parseTimeMs(value: string | null): number | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : null;
}

export function readReconcileScheduleState(db: Database, siteId: number): ReconcileScheduleState {
  const k = reconcileConfigKeys(siteId);
  const fc = parseInt(readConfigValue(db, k.failCount) ?? '0', 10);
  return {
    lastOkMs: parseTimeMs(readConfigValue(db, k.lastOk)),
    lastTryMs: parseTimeMs(readConfigValue(db, k.lastTry)),
    failCount: Number.isFinite(fc) && fc > 0 ? fc : 0
  };
}

/** 1 h, 2 h, 4 h, 8 h, 8 h... (failCount <= 1 -> 1 h). */
export function reconcileRetryDelayMs(failCount: number): number {
  const n = Math.max(1, Math.floor(failCount || 0));
  const delay = CARDS_RECONCILE_RETRY_BASE_MS * Math.pow(2, Math.min(n - 1, 10));
  return Math.min(delay, CARDS_RECONCILE_RETRY_MAX_MS);
}

/**
 * Prochaine echeance (epoch ms) du rattrapage, calculee au demarrage du cycle auto. Fonction pure.
 * Le maximum de trois bornes :
 *  - nowMs + delai initial (laisser l'interface et le premier pull s'installer) ;
 *  - dernier succes + 24 h ;
 *  - derniere tentative (si posterieure au dernier succes) + delai d'essai selon le nombre d'echecs.
 * Une date dans le futur (horloge du poste reculee depuis) est ramenee a nowMs : l'attente ne peut
 * jamais depasser l'intervalle concerne.
 */
export function computeReconcileNextAt(state: ReconcileScheduleState, nowMs: number): number {
  let next = nowMs + CARDS_RECONCILE_INITIAL_DELAY_MS;
  if (state.lastOkMs !== null) {
    next = Math.max(next, Math.min(state.lastOkMs, nowMs) + CARDS_RECONCILE_MIN_INTERVAL_MS);
  }
  if (state.lastTryMs !== null && (state.lastOkMs === null || state.lastTryMs > state.lastOkMs)) {
    next = Math.max(next, Math.min(state.lastTryMs, nowMs) + reconcileRetryDelayMs(state.failCount));
  }
  return next;
}

/** A appeler juste avant la premiere requete cloud d'un passage. */
export function markReconcileAttempt(db: Database, siteId: number, nowMs: number): void {
  writeConfigValue(db, reconcileConfigKeys(siteId).lastTry, new Date(nowMs).toISOString());
}

/** Passage complet reussi (status 'ok') : date enregistree, compteur d'echecs remis a zero. */
export function markReconcileSuccess(db: Database, siteId: number, nowMs: number): void {
  const k = reconcileConfigKeys(siteId);
  const tx = db.transaction(() => {
    writeConfigValue(db, k.lastOk, new Date(nowMs).toISOString());
    writeConfigValue(db, k.failCount, '0');
  });
  tx();
}

/** Echec : last_ok inchange, compteur incremente. Retourne le nouveau nombre d'echecs. */
export function markReconcileFailure(db: Database, siteId: number, nowMs: number): number {
  const k = reconcileConfigKeys(siteId);
  let count = 0;
  const tx = db.transaction(() => {
    count = readReconcileScheduleState(db, siteId).failCount + 1;
    writeConfigValue(db, k.failCount, String(count));
    writeConfigValue(db, k.lastTry, new Date(nowMs).toISOString());
  });
  tx();
  return count;
}
