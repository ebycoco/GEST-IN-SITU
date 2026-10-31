import log from 'electron-log';

/**
 * Porte de préchargement (plan site_id, re-audit 2026-10-31 P1-D).
 *
 * Le préchargement de démarrage (preloadUsersFromCloud) est le SEUL moment où les ids locaux de
 * site / centre peuvent être réalignés sur ceux du cloud : la réconciliation ne renumérote rien
 * tant qu'une session est ouverte. La page de connexion désactive donc le bouton « Se connecter »
 * tant que la porte est ouverte (canal 'auth:preload-status' + 'auth:isPreloadingUsers').
 *
 * La porte se ferme à la fin du préchargement ou au plus tard après `capMs` (réseau lent ou
 * hors ligne : la connexion n'est jamais bloquée plus longtemps). Fermeture idempotente.
 */

export const PRELOAD_GATE_CAP_MS = 20_000;

let open = false;
let generation = 0;

export function isPreloadGateOpen(): boolean {
  return open;
}

/**
 * Ouvre la porte et notifie (`notify(true)`). Retourne la fonction de fermeture : notifie
 * `notify(false)` une seule fois, sans effet si une ouverture plus récente a eu lieu.
 */
export function openPreloadGate(notify: (isOpen: boolean) => void, capMs: number = PRELOAD_GATE_CAP_MS): () => void {
  const gen = ++generation;
  open = true;
  notify(true);
  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    if (gen !== generation) return;
    open = false;
    notify(false);
  };
  const timer = setTimeout(() => {
    log.warn(`[PreloadGate] Préchargement non terminé après ${capMs} ms : connexion débloquée (réalignement éventuel au prochain démarrage).`);
    close();
  }, capMs);
  (timer as any).unref?.();
  return close;
}
