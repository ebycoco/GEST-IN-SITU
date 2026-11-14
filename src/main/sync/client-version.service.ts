import { app } from 'electron';
import log from 'electron-log';
import { randomUUID } from 'crypto';
import { promises as fsp } from 'fs';
import * as path from 'path';
import { getSupabaseClient } from './supabase-client';
import { networkMonitor } from './network-monitor';
import { getDatabase } from '../database/connection';
import { getSecureCurrentUser } from '../auth/session-heartbeat';
import type { PosteVersionRow, PostesVersionsCounts, PostesVersionsError } from '../../shared/types';

/**
 * ============================================================================
 * Versions des postes — module BACKEND (main process) uniquement.
 * Plan : docs/PLAN_ECRAN_VERSIONS_POSTES.md, étapes 2 (envoi) et 3 (lecture).
 * ============================================================================
 *
 * ENVOI (fn_report_client_version, supabase/migrations/0009_versions_postes.sql)
 *  - Tâche de fond PURE : aucune fonction publique d'envoi ne renvoie de Promise
 *    (signatures `void`), le travail réel part via setTimeout/setImmediate et TOUTE
 *    erreur est absorbée ici (journal info/debug). Rien n'est jamais attendu sur le
 *    chemin de démarrage ni sur celui de la connexion.
 *  - La RPC est FERMÉE en prod tant que l'utilisateur ne l'ouvre pas (REVOKE de 0009) :
 *    l'échec "permission denied" est un cas NORMAL, journalisé en info, jamais en erreur.
 *  - Déclencheurs : démarrage + 20 s (timer unref) ; connexion réussie ; si le réseau
 *    n'est pas ONLINE au moment voulu, UN SEUL écouteur 'change' du networkMonitor est
 *    armé et se détache au premier passage ONLINE (aucun polling).
 *  - Anti-répétition : au plus 1 envoi/heure/processus, sauf changement d'utilisateur
 *    (sync_id) ou de version (shouldSendReport, fonction pure testée).
 *  - Identité : sync_id de l'utilisateur de la session serveur et t_sites.sync_id de son
 *    site — JAMAIS les id locaux numériques (bug historique site_id local envoyé au cloud).
 *  - Garde dev : rien en is.dev (= !app.isPackaged ; le .env de dev cible la PROD) sauf
 *    GIS_REPORT_VERSION_IN_DEV=1. Rien si le client Supabase est absent (E2E compris).
 *
 * CLÉ DE POSTE
 *  - UUID crypto.randomUUID() créé au premier lancement, stocké dans
 *    userData/gis-poste/poste-id.json (jamais dans t_config : une base restaurée ou copiée
 *    dupliquerait la clé ; jamais le nom du PC). Écriture atomique (fichier temporaire +
 *    rename). Fichier illisible/invalide → régénéré et journalisé.
 *  - Lecture une seule fois par processus (promesse mise en cache), fichier de quelques
 *    dizaines d'octets, E/S asynchrones (fs.promises) : aucun blocage du thread principal.
 *
 * LECTURE (fn_list_client_versions / fn_count_client_versions, migration 0010)
 *  - listClientVersions() : deux RPC sans paramètre (timeout 15 s via AbortController),
 *    puis traduction LOCALE site_sync_id → t_sites.nom et last_user_sync_id → t_users.login
 *    (requêtes IN par lots ≤ 500, au plus 1000 lignes). Inconnu → null.
 *  - Ne lève jamais : renvoie { success:false, error } structuré.
 * ============================================================================
 */

// ─── Constantes ───────────────────────────────────────────────────────────────

const POSTE_DIR_NAME = 'gis-poste';
const POSTE_FILE_NAME = 'poste-id.json';

/** Délai entre le démarrage et le premier essai d'envoi. */
export const BOOT_REPORT_DELAY_MS = 20_000;
/** Fenêtre anti-répétition (1 envoi/heure/processus sauf changement). */
export const REPORT_MIN_INTERVAL_MS = 60 * 60 * 1000;
const REPORT_TIMEOUT_MS = 10_000;
const LIST_TIMEOUT_MS = 15_000;
const SQL_IN_CHUNK = 500;

/** Mêmes contraintes que fn_report_client_version (0009) : un envoi hors format est inutile. */
const POSTE_KEY_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
const APP_VERSION_PATTERN = /^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,6}(-[0-9A-Za-z.-]{1,32})?$/;
const SYNC_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/;

// ─── Clé de poste ─────────────────────────────────────────────────────────────

export function getPosteKeyFilePath(): string {
  return path.join(app.getPath('userData'), POSTE_DIR_NAME, POSTE_FILE_NAME);
}

export function isValidPosteKey(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 64 && POSTE_KEY_PATTERN.test(value);
}

interface PosteKeyFile {
  poste_key: string;
  created_at: string;
}

async function writePosteKeyAtomically(filePath: string, key: string): Promise<void> {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const payload: PosteKeyFile = { poste_key: key, created_at: new Date().toISOString() };
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fsp.writeFile(tmpPath, JSON.stringify(payload), 'utf-8');
    // rename() remplace la cible existante (Windows compris) : jamais de fichier à moitié écrit.
    await fsp.rename(tmpPath, filePath);
  } catch (err) {
    await fsp.rm(tmpPath, { force: true }).catch(() => undefined);
    throw err;
  }
}

/**
 * Lit la clé de poste, ou la crée si absente / illisible / invalide.
 * Si l'écriture échoue, la clé générée reste utilisée en mémoire pour ce processus
 * (journalisé) : l'envoi n'est jamais bloqué par un disque en lecture seule.
 */
async function loadOrCreatePosteKey(): Promise<string> {
  const filePath = getPosteKeyFilePath();
  let reason = 'absent';
  try {
    const raw = await fsp.readFile(filePath, 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    const key = (parsed && typeof parsed === 'object') ? (parsed as Partial<PosteKeyFile>).poste_key : undefined;
    if (isValidPosteKey(key)) return key;
    reason = 'contenu invalide';
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code !== 'ENOENT') reason = `illisible (${code ?? 'JSON invalide'})`;
  }

  const key = randomUUID();
  if (reason !== 'absent') {
    log.warn(`[ClientVersion] Fichier de clé de poste ${reason} : nouvelle clé générée.`);
  } else {
    log.info('[ClientVersion] Première exécution : clé de poste créée.');
  }
  try {
    await writePosteKeyAtomically(filePath, key);
  } catch (err) {
    log.warn('[ClientVersion] Écriture de la clé de poste impossible (clé gardée en mémoire pour ce processus) :', (err as Error)?.message ?? err);
  }
  return key;
}

let posteKeyPromise: Promise<string> | null = null;

/** Clé de poste (lue/créée une seule fois par processus). Ne rejette jamais. */
export function getPosteKey(): Promise<string> {
  if (!posteKeyPromise) {
    posteKeyPromise = loadOrCreatePosteKey().catch((err) => {
      // Garde ultime (ne devrait pas arriver : loadOrCreatePosteKey absorbe déjà ses erreurs).
      log.warn('[ClientVersion] Clé de poste indisponible, clé de secours en mémoire :', (err as Error)?.message ?? err);
      return randomUUID();
    });
  }
  return posteKeyPromise;
}

// ─── Gardes et anti-répétition ────────────────────────────────────────────────

/**
 * Équivalent exact de `is.dev` de @electron-toolkit/utils (défini comme `!app.isPackaged`,
 * node_modules/@electron-toolkit/utils/dist/index.mjs l.4), évalué à l'appel. Le paquet
 * n'est volontairement PAS importé ici : son chargement échoue hors Electron et ce service
 * est importé par handlers.ts, que de nombreux tests Vitest chargent.
 */
function isDevMode(): boolean {
  return !app.isPackaged;
}

/**
 * true si l'envoi est autorisé dans ce processus : jamais en mode développement
 * (le .env de dev pointe sur la PROD) sauf GIS_REPORT_VERSION_IN_DEV=1.
 */
export function isVersionReportingAllowed(): boolean {
  if (isDevMode() && process.env.GIS_REPORT_VERSION_IN_DEV !== '1') return false;
  return true;
}

export interface ReportFingerprint {
  at: number;
  userSyncId: string | null;
  version: string;
}

/**
 * Règle anti-répétition (fonction pure) : envoi si jamais envoyé, si la version ou
 * l'utilisateur a changé, ou si la dernière tentative date d'au moins une heure.
 */
export function shouldSendReport(
  last: ReportFingerprint | null,
  next: { userSyncId: string | null; version: string },
  now: number
): boolean {
  if (!last) return true;
  if (last.version !== next.version) return true;
  if (last.userSyncId !== next.userSyncId) return true;
  return now - last.at >= REPORT_MIN_INTERVAL_MS;
}

function sanitizeSyncId(value: unknown): string | null {
  return typeof value === 'string' && SYNC_ID_PATTERN.test(value) ? value : null;
}

/** t_sites.sync_id du site local de l'utilisateur (JAMAIS l'id numérique local). */
function resolveSiteSyncId(siteId: unknown): string | null {
  if (typeof siteId !== 'number' || !Number.isInteger(siteId)) return null;
  try {
    const db = getDatabase();
    if (!db) return null;
    const row = db.prepare('SELECT sync_id FROM t_sites WHERE id = ?').get(siteId) as { sync_id: string | null } | undefined;
    return sanitizeSyncId(row?.sync_id);
  } catch (err) {
    log.debug('[ClientVersion] Résolution du sync_id de site impossible :', (err as Error)?.message ?? err);
    return null;
  }
}

// ─── Envoi ────────────────────────────────────────────────────────────────────

let lastReport: ReportFingerprint | null = null;
let sendInFlight = false;
let bootTimer: NodeJS.Timeout | null = null;
let onlineListener: ((evt: { newState: string }) => void) | null = null;

function disarmOnlineListener(): void {
  if (onlineListener) {
    networkMonitor.removeListener('change', onlineListener);
    onlineListener = null;
  }
}

/** Arme UN seul écouteur : premier passage ONLINE → un essai d'envoi, puis détachement. */
function armOnlineListener(): void {
  if (onlineListener) return;
  onlineListener = ({ newState }) => {
    if (newState !== 'ONLINE') return;
    disarmOnlineListener();
    setImmediate(() => { void runReport('retour en ligne'); });
  };
  networkMonitor.on('change', onlineListener);
}

/**
 * Cœur de l'envoi. Ne rejette jamais (toutes erreurs absorbées). L'identité est lue
 * AU MOMENT de l'envoi depuis la session serveur (getSecureCurrentUser), source de
 * vérité du compte connecté (CLAUDE.md §3) ; sans session → envoi sans utilisateur/site.
 */
async function runReport(trigger: string): Promise<void> {
  let ownsInFlight = false;
  try {
    if (!isVersionReportingAllowed()) return;
    if (networkMonitor.getState() !== 'ONLINE') {
      armOnlineListener();
      return;
    }
    if (sendInFlight) return;

    const version = app.getVersion();
    if (!APP_VERSION_PATTERN.test(version) || version.length > 64) {
      log.debug(`[ClientVersion] Version "${version}" hors format attendu : envoi ignoré.`);
      return;
    }

    const session = getSecureCurrentUser() as { sync_id?: unknown; site_id?: unknown } | null;
    const userSyncId = sanitizeSyncId(session?.sync_id);
    const siteSyncId = session ? resolveSiteSyncId(session.site_id) : null;

    const now = Date.now();
    if (!shouldSendReport(lastReport, { userSyncId, version }, now)) return;

    const supabase = getSupabaseClient();
    if (!supabase) return;

    sendInFlight = true;
    ownsInFlight = true;
    // L'empreinte est posée AVANT l'appel : un échec (RPC fermée, réseau) ne provoque pas
    // de nouvel essai avant une heure, sauf changement d'utilisateur ou de version.
    lastReport = { at: now, userSyncId, version };

    const posteKey = await getPosteKey();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REPORT_TIMEOUT_MS);
    timeout.unref?.();
    try {
      const { data, error } = await supabase
        .rpc('fn_report_client_version', {
          p_poste_key: posteKey,
          p_app_version: version,
          p_user_sync_id: userSyncId,
          p_site_sync_id: siteSyncId,
        })
        .abortSignal(controller.signal);
      if (error) {
        // Cas normal tant que la RPC est fermée (permission denied, 42501) : simple info.
        log.info(`[ClientVersion] Déclaration de version non acceptée (${trigger}) : ${error.code ?? ''} ${error.message ?? ''}`.trim());
      } else if (data === true) {
        log.info(`[ClientVersion] Version ${version} déclarée (${trigger}).`);
      } else {
        log.info(`[ClientVersion] Déclaration de version refusée par le serveur (${trigger}).`);
      }
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    log.info(`[ClientVersion] Déclaration de version impossible (${trigger}, non bloquant) :`, (err as Error)?.message ?? err);
  } finally {
    if (ownsInFlight) sendInFlight = false;
  }
}

/**
 * Démarrage (src/main/index.ts) : un essai 20 s après le lancement (timer unref) ;
 * si le réseau n'est pas ONLINE à ce moment, un essai au premier retour en ligne.
 * Retour immédiat, jamais de Promise.
 */
export function startClientVersionReporter(): void {
  try {
    if (!isVersionReportingAllowed()) {
      log.info('[ClientVersion] Déclaration de version désactivée en développement (GIS_REPORT_VERSION_IN_DEV=1 pour l\'activer).');
      return;
    }
    if (bootTimer) return;
    bootTimer = setTimeout(() => {
      bootTimer = null;
      void runReport('démarrage');
    }, BOOT_REPORT_DELAY_MS);
    bootTimer.unref?.();
  } catch (err) {
    log.info('[ClientVersion] Démarrage du déclarant de version impossible (non bloquant) :', (err as Error)?.message ?? err);
  }
}

/**
 * Après une connexion réussie (src/main/ipc/handlers.ts, auth:login) : essai en tâche
 * de fond (setImmediate). NE JAMAIS await (signature void).
 */
export function reportClientVersionAfterLogin(): void {
  try {
    setImmediate(() => { void runReport('connexion'); });
  } catch (err) {
    log.info('[ClientVersion] Planification de la déclaration impossible (non bloquant) :', (err as Error)?.message ?? err);
  }
}

/** Arrêt propre (fermeture de l'application) : timer de démarrage et écouteur réseau. */
export function stopClientVersionReporter(): void {
  if (bootTimer) {
    clearTimeout(bootTimer);
    bootTimer = null;
  }
  disarmOnlineListener();
}

// ─── Lecture (écran SUPER ADMIN) ──────────────────────────────────────────────

interface RawVersionRow {
  poste_ref: unknown;
  app_version: unknown;
  site_sync_id: unknown;
  last_user_sync_id: unknown;
  first_seen_at: unknown;
  last_seen_at: unknown;
  nb_reports: unknown;
  key_kind: unknown;
}

interface RawCountRow {
  nb_total: unknown;
  nb_preuve: unknown;
  nb_ignorees: unknown;
  nb_listables: unknown;
}

export type ListClientVersionsResult =
  | { success: true; rows: PosteVersionRow[]; counts: PostesVersionsCounts; truncated: boolean }
  | { success: false; error: PostesVersionsError };

const LIST_MAX_ROWS = 1000;

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asCount(value: unknown): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : 0;
}

/** sync_id → valeur (nom de site ou login) en local, requêtes IN par lots ≤ 500. */
function lookupLocalNames(table: 't_sites' | 't_users', column: 'nom' | 'login', syncIds: string[]): Map<string, string> {
  const result = new Map<string, string>();
  if (syncIds.length === 0) return result;
  const db = getDatabase();
  if (!db) return result;
  for (let i = 0; i < syncIds.length; i += SQL_IN_CHUNK) {
    const chunk = syncIds.slice(i, i + SQL_IN_CHUNK);
    const placeholders = chunk.map(() => '?').join(',');
    // Nom de table/colonne : littéraux fermés (union de types), jamais une entrée externe.
    const rows = db.prepare(`SELECT sync_id, ${column} AS label FROM ${table} WHERE sync_id IN (${placeholders})`)
      .all(...chunk) as { sync_id: string; label: string | null }[];
    for (const r of rows) {
      if (r.sync_id && typeof r.label === 'string') result.set(r.sync_id, r.label);
    }
  }
  return result;
}

/**
 * Lit la liste des postes et les compteurs (RPC 0010), puis traduit en local les
 * sync_id en nom de site / login. Ne lève jamais.
 */
export async function listClientVersions(): Promise<ListClientVersionsResult> {
  if (networkMonitor.getState() !== 'ONLINE') return { success: false, error: 'OFFLINE' };
  const supabase = getSupabaseClient();
  if (!supabase) return { success: false, error: 'NO_CLIENT' };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LIST_TIMEOUT_MS);
  timeout.unref?.();
  try {
    const [listRes, countRes] = await Promise.all([
      supabase.rpc('fn_list_client_versions').abortSignal(controller.signal),
      supabase.rpc('fn_count_client_versions').abortSignal(controller.signal),
    ]);
    if (listRes.error || countRes.error) {
      const err = listRes.error ?? countRes.error;
      if (controller.signal.aborted) return { success: false, error: 'TIMEOUT' };
      log.warn(`[ClientVersion] Lecture des versions de postes en échec : ${err?.code ?? ''} ${err?.message ?? ''}`.trim());
      return { success: false, error: 'RPC_ERROR' };
    }

    const rawRows = (Array.isArray(listRes.data) ? listRes.data : []).slice(0, LIST_MAX_ROWS) as RawVersionRow[];
    const rawCount = (Array.isArray(countRes.data) ? countRes.data[0] : countRes.data) as RawCountRow | null | undefined;

    const siteIds = new Set<string>();
    const userIds = new Set<string>();
    for (const r of rawRows) {
      const s = asString(r.site_sync_id);
      const u = asString(r.last_user_sync_id);
      if (s) siteIds.add(s);
      if (u) userIds.add(u);
    }
    const siteNames = lookupLocalNames('t_sites', 'nom', [...siteIds]);
    const userLogins = lookupLocalNames('t_users', 'login', [...userIds]);

    const rows: PosteVersionRow[] = [];
    for (const r of rawRows) {
      const posteRef = asString(r.poste_ref);
      if (!posteRef) continue;
      const siteSyncId = asString(r.site_sync_id);
      const userSyncId = asString(r.last_user_sync_id);
      rows.push({
        // Défense en profondeur : la RPC renvoie déjà left(poste_key, 8).
        poste_ref: posteRef.slice(0, 8),
        app_version: asString(r.app_version),
        site_sync_id: siteSyncId,
        site_nom: siteSyncId ? siteNames.get(siteSyncId) ?? null : null,
        last_user_login: userSyncId ? userLogins.get(userSyncId) ?? null : null,
        first_seen_at: asString(r.first_seen_at),
        last_seen_at: asString(r.last_seen_at),
        nb_reports: asCount(r.nb_reports),
        key_kind: asString(r.key_kind),
      });
    }

    const counts: PostesVersionsCounts = {
      nb_total: asCount(rawCount?.nb_total),
      nb_preuve: asCount(rawCount?.nb_preuve),
      nb_ignorees: asCount(rawCount?.nb_ignorees),
      nb_listables: asCount(rawCount?.nb_listables),
    };
    return { success: true, rows, counts, truncated: counts.nb_listables > LIST_MAX_ROWS };
  } catch (err) {
    if (controller.signal.aborted) return { success: false, error: 'TIMEOUT' };
    log.warn('[ClientVersion] Lecture des versions de postes impossible :', (err as Error)?.message ?? err);
    return { success: false, error: 'RPC_ERROR' };
  } finally {
    clearTimeout(timeout);
  }
}

/** Réservé aux tests : remet l'état de module à zéro. */
export function __resetClientVersionStateForTests(): void {
  stopClientVersionReporter();
  lastReport = null;
  sendInFlight = false;
  posteKeyPromise = null;
}
