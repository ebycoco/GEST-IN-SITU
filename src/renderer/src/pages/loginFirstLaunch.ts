/**
 * loginFirstLaunch.ts
 *
 * Logique PURE (sans DOM, sans React, sans IPC) du premier démarrage de LoginPage.tsx,
 * extraite pour être testable sous Vitest (tests/login-first-launch.test.ts).
 *
 * Contenu :
 *  - normalizeNetworkState : traduit l'état émis par le main (network-monitor.ts, MAJUSCULES)
 *    en une décision tri-état pour le bandeau « Hors-ligne ».
 *  - shouldShowOfflineBanner : décide si le bandeau « Hors-ligne » doit primer sur le message
 *    de configuration (`setupMessage`).
 *  - startBoundedPoll : sondage borné par setTimeout enchaînés (jamais de boucle bloquante),
 *    annulable, qui sert à attendre le rapatriement des comptes par le SyncEngine.
 */

/** Décision réseau issue d'un état du main : 'unknown' = ne pas modifier l'affichage courant. */
export type NetworkKind = 'online' | 'offline' | 'unknown';

/**
 * Normalise l'état réseau émis par le main (NetworkState : 'ONLINE' | 'OFFLINE' | 'PROBING' |
 * 'DEGRADED' | 'PERMANENT_OFFLINE') sans tenir compte de la casse.
 *  - ONLINE et DEGRADED => 'online' (DEGRADED = connexion existante mais instable : on ne
 *    bascule pas l'écran en « Hors-ligne » alors qu'Internet répond).
 *  - OFFLINE et PERMANENT_OFFLINE => 'offline'.
 *  - PROBING, valeur absente ou inconnue => 'unknown' (état transitoire : pas de bascule).
 *  'connected' est conservé comme alias historique de 'online'.
 */
export function normalizeNetworkState(state: unknown): NetworkKind {
  if (typeof state !== 'string') return 'unknown';
  switch (state.trim().toUpperCase()) {
    case 'ONLINE':
    case 'CONNECTED':
    case 'DEGRADED':
      return 'online';
    case 'OFFLINE':
    case 'PERMANENT_OFFLINE':
      return 'offline';
    default:
      return 'unknown';
  }
}

export interface OfflineBannerInput {
  isOnline: boolean;
  setupStatus: 'idle' | 'pulling' | 'success' | 'failed';
  navigatorOnLine: boolean;
  /** Dernier verdict réseau du main (null tant qu'aucun événement n'a été reçu). */
  mainNetworkKind: NetworkKind | null;
}

/**
 * Le bandeau « Hors-ligne » s'affiche si le réseau est réputé coupé. Exception : en échec de
 * configuration alors que le navigateur ET le main ne signalent pas de coupure, le message de
 * configuration (`setupMessage`) est plus fidèle et prime. Un vrai hors-ligne
 * (navigator.onLine false ou état OFFLINE) reste affiché tel quel.
 */
export function shouldShowOfflineBanner(input: OfflineBannerInput): boolean {
  if (input.isOnline) return false;
  const reallyOnline =
    input.setupStatus === 'failed' && input.navigatorOnLine && input.mainNetworkKind !== 'offline';
  return !reallyOnline;
}

export type PollOutcome = 'success' | 'timeout';

export interface BoundedPollOptions {
  /** Renvoie true quand la condition attendue est remplie (ex. t_users non vide). */
  check: () => Promise<boolean>;
  /** Appelé une seule fois, sauf si le sondage est annulé (alors jamais appelé). */
  onDone: (outcome: PollOutcome) => void;
  intervalMs: number;
  timeoutMs: number;
}

/**
 * Sondage borné : un `check` toutes les `intervalMs`, au plus ceil(timeoutMs/intervalMs) essais.
 *
 * Logique asynchrone : chaque essai est planifié par setTimeout APRÈS la fin du précédent
 * (jamais deux `check` simultanés, jamais de boucle bloquante pour le thread de rendu).
 * Gestion d'erreur : un `check` qui rejette compte comme un essai raté (le sondage continue).
 * Mémoire : un seul timer vivant à la fois ; la fonction d'annulation retournée l'efface et
 * neutralise tout résultat de `check` en vol (aucun `onDone` ni nouvel essai après annulation).
 */
export function startBoundedPoll(options: BoundedPollOptions): () => void {
  const { check, onDone, intervalMs, timeoutMs } = options;
  const maxAttempts = Math.max(1, Math.ceil(timeoutMs / intervalMs));
  let attempts = 0;
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const tick = async (): Promise<void> => {
    timer = null;
    if (cancelled) return;
    attempts += 1;
    let ok = false;
    try {
      ok = await check();
    } catch {
      ok = false;
    }
    if (cancelled) return;
    if (ok) {
      onDone('success');
    } else if (attempts >= maxAttempts) {
      onDone('timeout');
    } else {
      timer = setTimeout(() => { void tick(); }, intervalMs);
    }
  };

  timer = setTimeout(() => { void tick(); }, intervalMs);

  return () => {
    cancelled = true;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Redéclenchement automatique borné (anti-tempête d'appels IPC)
// ─────────────────────────────────────────────────────────────────────────────────────────────

export interface AutoRetryState {
  /** Nombre de tentatives AUTOMATIQUES déjà lancées (la tentative initiale du montage compte). */
  attempts: number;
  /** Horodatage (ms) de la dernière tentative, automatique ou manuelle ; null si aucune. */
  lastAttemptAt: number | null;
}

export interface AutoRetryPolicy {
  minIntervalMs: number;
  maxAutoAttempts: number;
}

export const DEFAULT_AUTO_RETRY_POLICY: AutoRetryPolicy = { minIntervalMs: 10000, maxAutoAttempts: 5 };

/**
 * Un redéclenchement AUTOMATIQUE (retour en ligne) n'est permis que si le plafond n'est pas atteint
 * et si la dernière tentative date d'au moins `minIntervalMs`. Fonction pure : l'appelant tient
 * l'état (`AutoRetryState`) dans un ref et le met à jour via `recordAttempt`. Le bouton manuel
 * n'est jamais soumis à cette politique.
 */
export function canAutoRetry(
  state: AutoRetryState,
  now: number,
  policy: AutoRetryPolicy = DEFAULT_AUTO_RETRY_POLICY
): boolean {
  if (state.attempts >= policy.maxAutoAttempts) return false;
  if (state.lastAttemptAt !== null && now - state.lastAttemptAt < policy.minIntervalMs) return false;
  return true;
}

/** Enregistre une tentative (auto => compteur +1 ; manuelle => seul l'horodatage avance). */
export function recordAttempt(state: AutoRetryState, now: number, auto: boolean): AutoRetryState {
  return { attempts: auto ? state.attempts + 1 : state.attempts, lastAttemptAt: now };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Orchestration de la configuration de premier démarrage
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** 'unreachable' = réseau Supabase injoignable ; 'network_error' = exception du ping ;
 *  'no_accounts' = réseau OK mais aucun compte rapatrié dans le délai. */
export type SetupFailureReason = 'unreachable' | 'network_error' | 'no_accounts';

export interface FirstLaunchSetupDeps {
  forcePing: () => Promise<{ success?: boolean; state?: unknown } | null | undefined>;
  forceGlobal: () => Promise<unknown>;
  checkFirstLaunch: () => Promise<{ isFirstLaunch?: boolean } | null | undefined>;
  /** t_users est rempli : l'appelant doit repasser son état « premier démarrage » à false. */
  onConfigured: () => void;
  onFailed: (reason: SetupFailureReason) => void;
  intervalMs: number;
  timeoutMs: number;
}

/**
 * Déroule la configuration : (0) contrôle immédiat -> forcePing -> forceGlobal -> contrôle ->
 * sondage borné. Retourne une fonction d'annulation (aucun callback après annulation).
 *
 * Décision clé : `checkFirstLaunch` (t_users non vide) est le SEUL juge. Le résultat de
 * `forceGlobal` (undefined, {success}) et ses exceptions (ex. « Accès refusé. Session invalide. »
 * levé quand le SyncEngine a déjà rapatrié les comptes) sont journalisés mais ne ferment jamais
 * la configuration. Seul le garde forcePing (OFFLINE / exception) peut échouer avant le sondage.
 * Mémoire/flux : aucun listener ajouté, un seul timer vivant (voir startBoundedPoll).
 */
export function runFirstLaunchSetup(deps: FirstLaunchSetupDeps): () => void {
  let cancelled = false;
  let cancelPoll: (() => void) | null = null;

  const isConfigured = async (): Promise<boolean> => {
    try {
      const check = await deps.checkFirstLaunch();
      return !!check && check.isFirstLaunch === false;
    } catch (err) {
      console.debug('[FIRST LAUNCH] checkFirstLaunch en erreur (essai ignoré):', err);
      return false;
    }
  };

  const run = async (): Promise<void> => {
    if (await isConfigured()) {
      if (!cancelled) deps.onConfigured();
      return;
    }
    if (cancelled) return;

    try {
      const pingRes = await deps.forcePing();
      if (cancelled) return;
      if (!pingRes || !pingRes.success || normalizeNetworkState(pingRes.state) === 'offline') {
        deps.onFailed('unreachable');
        return;
      }
    } catch (err) {
      console.warn('[FIRST LAUNCH] forcePing en erreur:', err);
      if (!cancelled) deps.onFailed('network_error');
      return;
    }

    try {
      const res = await deps.forceGlobal();
      console.debug('[FIRST LAUNCH] forceGlobal terminé (non décisif):', res);
    } catch (err) {
      console.warn('[FIRST LAUNCH] forceGlobal en erreur (non décisif):', err);
    }
    if (cancelled) return;

    if (await isConfigured()) {
      if (!cancelled) deps.onConfigured();
      return;
    }
    if (cancelled) return;

    cancelPoll = startBoundedPoll({
      check: isConfigured,
      intervalMs: deps.intervalMs,
      timeoutMs: deps.timeoutMs,
      onDone: (outcome) => {
        cancelPoll = null;
        if (cancelled) return;
        if (outcome === 'success') deps.onConfigured();
        else deps.onFailed('no_accounts');
      }
    });
  };

  void run();

  return () => {
    cancelled = true;
    if (cancelPoll) {
      cancelPoll();
      cancelPoll = null;
    }
  };
}
