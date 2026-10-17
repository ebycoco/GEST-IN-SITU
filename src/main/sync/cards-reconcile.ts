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
 * Cout : ~1 requete cloud par 1000 cartes du site a chaque passage (<= 1x/heure, cf. sync-engine).
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
