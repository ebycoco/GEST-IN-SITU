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
