/**
 * Navigation initiale de la fenêtre principale, avec UNE seule récupération possible.
 *
 * Cause (audit démarrage du 03/10/2026) : si le processus principal reste bloqué plus de 15 s
 * après le lancement du Network Service Chromium (lancé dès la création du splash), ce service
 * s'arrête de lui-même faute de réponse IPC (ChildThreadImpl::EnsureConnected, délai de 15 s).
 * Le premier loadURL() part alors vers le service perdu et est rejeté avec ERR_FAILED (-2) ;
 * Chromium relance le service, mais la navigation initiale n'est jamais refaite : la fenêtre
 * reste sur about:blank, sans ready-to-show (« il faut relancer l'application »).
 *
 * Portée volontairement étroite : uniquement le premier chargement de la fenêtre principale,
 * uniquement sur ERR_FAILED (-2), une seule nouvelle tentative vers la même cible, puis fin.
 * Aucune dépendance à Electron ici (testable sous Vitest).
 */

/** Délai avant l'unique nouvelle tentative : temps laissé à Chromium pour relancer le Network Service (mesuré ≈ 1,3 s). */
export const STARTUP_NAVIGATION_RECOVERY_DELAY_MS = 1500;

export type StartupNavigationOutcome = 'loaded' | 'recovered' | 'failed';

interface StartupNavigationLogger {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

export interface StartupNavigationDeps {
  log: StartupNavigationLogger;
  /** Faux si la fenêtre a été fermée/détruite entre-temps : aucune nouvelle tentative. */
  canRetry: () => boolean;
  wait?: (ms: number) => Promise<void>;
  delayMs?: number;
}

const defaultWait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function describeError(err: unknown): { code: unknown; errno: unknown; message: string } {
  const e = err as { code?: unknown; errno?: unknown; message?: unknown } | null;
  return { code: e?.code, errno: e?.errno, message: String(e?.message ?? err) };
}

/** Rejet de loadURL/loadFile observé lors de la perte du Network Service : code ERR_FAILED, errno -2. */
export function isNetworkServiceLossError(err: unknown): boolean {
  const { code, errno } = describeError(err);
  return code === 'ERR_FAILED' && errno === -2;
}

/**
 * Exécute le chargement initial `load` (loadURL ou loadFile vers la cible de démarrage).
 * Ne rejette jamais : l'issue est journalisée et retournée.
 */
export async function loadInitialNavigation(
  load: () => Promise<void>,
  deps: StartupNavigationDeps
): Promise<StartupNavigationOutcome> {
  const { log, canRetry } = deps;
  const wait = deps.wait ?? defaultWait;
  const delayMs = deps.delayMs ?? STARTUP_NAVIGATION_RECOVERY_DELAY_MS;

  log.info('[StartupNavigation] initial load started');
  try {
    await load();
    log.info('[StartupNavigation] initial load succeeded');
    return 'loaded';
  } catch (err) {
    const { code, errno, message } = describeError(err);
    log.warn(`[StartupNavigation] initial load failed code=${String(code)} errorCode=${String(errno)} message=${message}`);
    if (!isNetworkServiceLossError(err)) {
      log.error('[StartupNavigation] no recovery for this error (only ERR_FAILED -2 is recovered)');
      return 'failed';
    }
  }

  await wait(delayMs);
  if (!canRetry()) {
    log.warn('[StartupNavigation] window no longer available, recovery navigation skipped');
    return 'failed';
  }

  log.info(`[StartupNavigation] attempting one recovery navigation (after ${delayMs} ms)`);
  try {
    await load();
    log.info('[StartupNavigation] recovery navigation succeeded');
    return 'recovered';
  } catch (err) {
    const { code, errno, message } = describeError(err);
    log.error(`[StartupNavigation] recovery navigation failed code=${String(code)} errorCode=${String(errno)} message=${message}`);
    return 'failed';
  }
}
