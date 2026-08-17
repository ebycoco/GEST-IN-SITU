import log from 'electron-log';
import { getSupabaseClient } from './supabase-client';
import { networkMonitor } from './network-monitor';

/**
 * ============================================================================
 * Présence des agents — module BACKEND uniquement (lecture/écriture Supabase).
 * ============================================================================
 *
 * Décisions de design (plan d'impact validé par agent-1-architect-pm, D1-D4) :
 *
 *  D1 — Table Supabase dédiée `t_user_presence`, séparée de `t_users`/`t_logs`.
 *       Zéro colonne ajoutée à `t_users`, zéro modification de
 *       `syncUsersFromCloud` (src/main/sync/downstream.ts) ni de
 *       `CRUD_SYNC_WHITELIST`/`t_logs` (src/main/utils/audit.ts).
 *
 *  D2 — Écritures FIRE-AND-FORGET, hors du moteur outbox. Le heartbeat/login/
 *       logout sont des données éphémères : pas de retry stocké, pas de
 *       `is_dirty`. Chaque fonction d'écriture ci-dessous :
 *         - ne retourne JAMAIS de Promise (signature `: void`) ;
 *         - lance son travail réel via `setImmediate()` (même pattern que
 *           `scheduleOutboxProcessing()` dans outbox.service.ts) et retourne
 *           immédiatement ;
 *         - catche TOUTE erreur en interne, sans jamais la propager.
 *       CONSÉQUENCE IMPORTANTE POUR LES APPELANTS : ces fonctions ne doivent
 *       JAMAIS être `await`ées, en particulier pas dans un chemin critique
 *       comme `authenticateUser()`. Elles sont conçues pour qu'un `await`
 *       accidentel reste inoffensif (il ne ferait qu'attendre une Promise
 *       `undefined` résolue immédiatement) mais ne doit pas être ajouté.
 *
 *  D3 — Lecture EN DIRECT depuis Supabase (`getAgentsPresence`), jamais depuis
 *       SQLite local : la fraîcheur cross-site n'est pas garantie localement
 *       (`syncUsersFromCloud` ne pull que le site propre de l'appelant).
 *       Exception assumée au principe offline-first, cantonnée à cette seule
 *       fonctionnalité.
 *
 *  D4 — Aucun statut (En ligne/Inactif/Hors ligne) n'est calculé ici : seules
 *       des données brutes (timestamps) sont exposées. Le calcul du statut se
 *       fait côté renderer, hors périmètre de ce module.
 *
 * Toutes les fonctions ci-dessous respectent la même garde que le reste du
 * projet (cf. outbox.service.ts) : no-op silencieux si
 * `networkMonitor.getState() !== 'ONLINE'` ou si `getSupabaseClient()` est
 * indisponible.
 * ============================================================================
 */

const PRESENCE_TABLE = 't_user_presence';

/** Rôles OPERATEUR_* / ADMIN_CENTRE concernés par la présence — identique à la
 * liste `validRoles` de src/main/sync/downstream.ts, moins SUPER ADMIN et
 * ADMINISTRATEUR_SITE (ces deux rôles ne sont pas des agents de terrain
 * supervisés par cette fonctionnalité). Ne pas faire diverger cette liste de
 * downstream.ts sans revalider les deux en même temps.
 */
const PRESENCE_ROLES = [
  'OPERATEUR_VERIFICATION',
  'OPERATEUR_QUALITE',
  'OPERATEUR_SAISIE',
  'OPERATEUR_LOGISTIQUE',
  'OPERATEUR_INVENTAIRE',
  'OPERATEUR_APUREMENT',
  'ADMIN_CENTRE',
] as const;

/** Fenêtre de recherche pour la "dernière action" agrégée depuis `t_logs`.
 * Choix technique documenté : 24h borne le volume de lignes remontées tout en
 * couvrant très largement une session de travail terrain (le cas où un agent
 * n'a strictement rien fait depuis plus de 24h se traduit simplement par
 * `last_action_at: null`, ce qui reste correct côté UI — un agent hors ligne
 * depuis longtemps n'a de toute façon pas d'action récente à afficher).
 */
const LAST_ACTION_LOOKBACK_HOURS = 24;

/** Plafond de lignes `t_logs` remontées pour l'agrégation "dernière action"
 * (politique low-memory, cf. CLAUDE.md §2/§4 — éviter un scan/transfert
 * disproportionné sur un site à fort volume de logs). Les lignes sont triées
 * `date_heure DESC` avant application de la limite, donc un dépassement du
 * plafond ne peut que faire manquer la dernière action des agents les MOINS
 * récemment actifs dans la fenêtre — jamais celle des agents les plus actifs.
 */
const LAST_ACTION_LOGS_LIMIT = 2000;

// ─── Types publics ──────────────────────────────────────────────────────────

/** Identité minimale d'un utilisateur, telle que fournie par l'appelant
 * (session courante via getSecureCurrentUser()) aux fonctions d'écriture. */
export interface PresenceUserRef {
  sync_id: string;
  login: string;
  site_id: number | null;
  centre_id: number | null;
  /** Rôle ACTIF courant (mutable via setActiveRole pour comptes multi-rôles),
   * jamais le rôle de connexion d'origine. */
  role: string;
}

/** Ligne brute retournée par getAgentsPresence — fusion roster (t_users) +
 * présence (t_user_presence) + dernière action (t_logs). Aucun statut
 * calculé (cf. D4) : uniquement des timestamps bruts, à interpréter côté
 * renderer. */
export interface AgentPresenceRow {
  sync_id: string;
  login: string;
  nom_user: string | null;
  prenom_user: string | null;
  role: string | null;
  site_id: number | null;
  centre_id: number | null;
  last_heartbeat_at: string | null;
  last_login_at: string | null;
  last_logout_at: string | null;
  last_action_at: string | null;
  last_action_label: string | null;
}

// ─── Fonctions d'écriture (fire-and-forget — cf. D2, NE JAMAIS AWAIT) ───────

/**
 * Rafraîchit `last_heartbeat_at` (+ login/site_id/centre_id/role, utiles si le
 * rôle actif ou le centre a changé depuis le dernier battement) pour l'agent
 * donné. Appelée par le timer périodique existant (src/main/auth/
 * session-heartbeat.ts) — le câblage de cet appel est hors périmètre ici.
 *
 * FIRE-AND-FORGET (cf. D2 en tête de fichier) : signature `void`, ne JAMAIS
 * `await`er cet appel. Toute erreur réseau/Supabase est catchée en interne.
 */
export function heartbeatPresence(user: PresenceUserRef): void {
  setImmediate(() => {
    _upsertPresence(user, { includeLogin: true }).catch(() => {
      /* filet de sécurité : _upsertPresence catche déjà tout en interne */
    });
  });
}

/**
 * Enregistre une connexion : `last_login_at = now()` + `last_heartbeat_at =
 * now()` (un login vaut aussi un premier battement), et rafraîchit
 * login/site_id/centre_id/role.
 *
 * FIRE-AND-FORGET (cf. D2 en tête de fichier) : signature `void`, ne JAMAIS
 * `await`er cet appel — notamment pas dans `authenticateUser()`, exécuté par
 * 100% des connexions. Toute erreur réseau/Supabase est catchée en interne.
 */
export function recordPresenceLogin(user: PresenceUserRef): void {
  setImmediate(() => {
    _upsertPresence(user, { includeLogin: true, isLogin: true }).catch(() => {
      /* filet de sécurité : _upsertPresence catche déjà tout en interne */
    });
  });
}

/**
 * Enregistre une déconnexion explicite : `last_logout_at = now()` sur la
 * ligne existante. Si `userSyncId` n'a pas encore de ligne en base (aucun
 * login préalable enregistré), l'appel est ignoré silencieusement — pas de
 * création orpheline (UPDATE simple, jamais d'upsert : une ligne inexistante
 * ne matche aucune ligne et ne produit aucune erreur).
 *
 * FIRE-AND-FORGET (cf. D2 en tête de fichier) : signature `void`, ne JAMAIS
 * `await`er cet appel. Toute erreur réseau/Supabase est catchée en interne.
 */
export function recordPresenceLogout(userSyncId: string): void {
  setImmediate(() => {
    _updateLogout(userSyncId).catch(() => {
      /* filet de sécurité : _updateLogout catche déjà tout en interne */
    });
  });
}

// ─── Fonction de lecture ─────────────────────────────────────────────────────

/**
 * Retourne l'état de présence brut de tous les agents OPERATEUR_x / ADMIN_CENTRE
 * actifs, pour un site donné ou tous sites (`siteId: null`).
 *
 * `siteId: null` = tous sites, réservé SUPER ADMIN — la validation de ce
 * droit est ENTIÈREMENT à la charge de l'appelant (futur handler IPC), pas de
 * cette fonction.
 *
 * Lecture EN DIRECT depuis Supabase (cf. D3 en tête de fichier), jamais depuis
 * SQLite local. Fusionne 3 sources par sync_id/login :
 *   1. Roster : `t_users` (role IN PRESENCE_ROLES, statut_actif=1, site_id si fourni).
 *   2. Présence : `t_user_presence` pour les sync_id du roster.
 *   3. Dernière action : agrégat `t_logs` (fenêtre LAST_ACTION_LOOKBACK_HOURS,
 *      plafonné à LAST_ACTION_LOGS_LIMIT lignes — cf. doc de ces constantes).
 *
 * Ne lève jamais d'exception : retourne `[]` en cas d'indisponibilité réseau/
 * Supabase ou d'erreur roster (source primaire). Une erreur sur les sources
 * secondaires (présence, dernière action) dégrade gracieusement ces seuls
 * champs à `null` plutôt que de faire échouer tout l'appel.
 */
export async function getAgentsPresence(params: { siteId: number | null }): Promise<AgentPresenceRow[]> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    log.warn('[PresenceService] getAgentsPresence : client Supabase indisponible.');
    return [];
  }

  try {
    // ── 1. Roster (source primaire — t_users) ──────────────────────────────
    let rosterQuery = supabase
      .from('t_users')
      .select('sync_id, login, nom_user, prenom_user, role, site_id, centre_id')
      .in('role', PRESENCE_ROLES as unknown as string[])
      .eq('statut_actif', 1);
    if (params.siteId !== null) {
      rosterQuery = rosterQuery.eq('site_id', params.siteId);
    }

    const { data: roster, error: rosterError } = await rosterQuery;
    if (rosterError) {
      log.error('[PresenceService] getAgentsPresence : erreur roster t_users :', rosterError.message);
      return [];
    }
    if (!roster || roster.length === 0) {
      return [];
    }

    const syncIds = roster.map((u: any) => u.sync_id).filter((v: unknown): v is string => Boolean(v));
    const logins = roster.map((u: any) => u.login).filter((v: unknown): v is string => Boolean(v));

    // ── 2. Présence (t_user_presence) — dégradation gracieuse si erreur ────
    const presenceBySyncId = new Map<string, { last_heartbeat_at: string | null; last_login_at: string | null; last_logout_at: string | null }>();
    if (syncIds.length > 0) {
      const { data: presenceRows, error: presenceError } = await supabase
        .from(PRESENCE_TABLE)
        .select('user_sync_id, last_heartbeat_at, last_login_at, last_logout_at')
        .in('user_sync_id', syncIds);

      if (presenceError) {
        log.warn('[PresenceService] getAgentsPresence : erreur lecture t_user_presence (dégradé à null) :', presenceError.message);
      } else {
        for (const p of presenceRows || []) {
          presenceBySyncId.set(p.user_sync_id, {
            last_heartbeat_at: p.last_heartbeat_at ?? null,
            last_login_at: p.last_login_at ?? null,
            last_logout_at: p.last_logout_at ?? null,
          });
        }
      }
    }

    // ── 3. Dernière action (t_logs, fenêtre bornée) — dégradation gracieuse ─
    const lastActionByLogin = new Map<string, { action: string | null; date_heure: string }>();
    if (logins.length > 0) {
      const cutoffIso = new Date(Date.now() - LAST_ACTION_LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();
      let logsQuery = supabase
        .from('t_logs')
        .select('login_user, action, date_heure')
        .in('login_user', logins)
        .gte('date_heure', cutoffIso)
        .order('date_heure', { ascending: false })
        .limit(LAST_ACTION_LOGS_LIMIT);
      if (params.siteId !== null) {
        logsQuery = logsQuery.eq('site_id', params.siteId);
      }

      const { data: logRows, error: logsError } = await logsQuery;
      if (logsError) {
        log.warn('[PresenceService] getAgentsPresence : erreur lecture t_logs (dégradé à null) :', logsError.message);
      } else {
        // Trié DESC par date_heure : la première occurrence rencontrée par
        // login_user est donc bien la plus récente.
        for (const l of logRows || []) {
          if (!l.login_user || lastActionByLogin.has(l.login_user)) continue;
          lastActionByLogin.set(l.login_user, { action: l.action ?? null, date_heure: l.date_heure });
        }
      }
    }

    // ── 4. Fusion par sync_id/login ─────────────────────────────────────────
    return roster.map((u: any) => {
      const presence = u.sync_id ? presenceBySyncId.get(u.sync_id) : undefined;
      const lastAction = u.login ? lastActionByLogin.get(u.login) : undefined;
      return {
        sync_id: u.sync_id,
        login: u.login,
        nom_user: u.nom_user ?? null,
        prenom_user: u.prenom_user ?? null,
        role: u.role ?? null,
        site_id: u.site_id ?? null,
        centre_id: u.centre_id ?? null,
        last_heartbeat_at: presence?.last_heartbeat_at ?? null,
        last_login_at: presence?.last_login_at ?? null,
        last_logout_at: presence?.last_logout_at ?? null,
        last_action_at: lastAction?.date_heure ?? null,
        last_action_label: lastAction?.action ?? null,
      } satisfies AgentPresenceRow;
    });
  } catch (err: any) {
    log.error('[PresenceService] getAgentsPresence : exception :', err.message || err);
    return [];
  }
}

// ─── Helpers privés (implémentation réelle des écritures fire-and-forget) ───

/**
 * Upsert réel de `t_user_presence`, appelé exclusivement via `setImmediate()`
 * par heartbeatPresence()/recordPresenceLogin() ci-dessus — jamais directement
 * (toujours passer par les wrappers `void` publics). Catche toute erreur en
 * interne, ne la propage jamais (cf. D2).
 */
async function _upsertPresence(
  user: PresenceUserRef,
  opts: { includeLogin: boolean; isLogin?: boolean }
): Promise<void> {
  if (networkMonitor.getState() !== 'ONLINE') return;

  const supabase = getSupabaseClient();
  if (!supabase) return;

  try {
    const nowIso = new Date().toISOString();
    const payload: Record<string, unknown> = {
      user_sync_id: user.sync_id,
      last_heartbeat_at: nowIso,
    };
    if (opts.includeLogin) {
      payload.login = user.login;
      payload.site_id = user.site_id;
      payload.centre_id = user.centre_id;
      payload.role = user.role;
    }
    if (opts.isLogin) {
      payload.last_login_at = nowIso;
    }

    const { error } = await supabase
      .from(PRESENCE_TABLE)
      .upsert(payload, { onConflict: 'user_sync_id' });

    if (error) {
      log.warn(`[PresenceService] upsert ${PRESENCE_TABLE} échoué (user_sync_id=${user.sync_id}) :`, error.message);
    }
  } catch (err: any) {
    log.warn(`[PresenceService] upsert ${PRESENCE_TABLE} exception (user_sync_id=${user.sync_id}) :`, err.message || err);
  }
}

/**
 * Update réel de `last_logout_at`, appelé exclusivement via `setImmediate()`
 * par recordPresenceLogout() ci-dessus. UPDATE simple (jamais upsert) : une
 * ligne inexistante ne matche rien et ne produit aucune erreur ni création
 * orpheline. Catche toute erreur en interne, ne la propage jamais (cf. D2).
 */
async function _updateLogout(userSyncId: string): Promise<void> {
  if (networkMonitor.getState() !== 'ONLINE') return;

  const supabase = getSupabaseClient();
  if (!supabase) return;

  try {
    const { error } = await supabase
      .from(PRESENCE_TABLE)
      .update({ last_logout_at: new Date().toISOString() })
      .eq('user_sync_id', userSyncId);

    if (error) {
      log.warn(`[PresenceService] update logout ${PRESENCE_TABLE} échoué (user_sync_id=${userSyncId}) :`, error.message);
    }
  } catch (err: any) {
    log.warn(`[PresenceService] update logout ${PRESENCE_TABLE} exception (user_sync_id=${userSyncId}) :`, err.message || err);
  }
}
