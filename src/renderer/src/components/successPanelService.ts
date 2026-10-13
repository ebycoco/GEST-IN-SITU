/**
 * Service unique du panneau de succès (SuccessPanel.tsx, monté une seule fois dans App.tsx).
 *
 * Même modèle que confirmService.ts : un singleton de module découple les flux métier (délivrance,
 * import, publication des brouillons) de l'affichage. Toute la logique de temporisation vit ici,
 * en TypeScript pur, pour rester testable sans DOM (tests/success-panel-service.test.ts).
 *
 * - Un seul emplacement : un nouveau show() remplace le contenu courant (id incrémenté) et relance
 *   le délai. Pas de déduplication par contenu, qui masquerait deux opérations légitimes distinctes.
 * - Pause/reprise (survol, focus dans le panneau) : le délai restant est conservé ; la reprise
 *   n'a lieu que lorsqu'aucune raison de pause n'est plus active.
 * - Un seul setTimeout actif à la fois, nettoyé par dismiss(), par un nouveau show() et au
 *   désenregistrement (politique Low-Memory, CLAUDE.md §2).
 * - show() ne lève jamais : l'affichage ne doit jamais remettre en cause une réussite métier.
 */

export interface SuccessPanelPayload {
  title: string;
  detail?: string;
}

export interface SuccessPanelState extends SuccessPanelPayload {
  id: number;
}

export type SuccessPanelPauseReason = 'hover' | 'focus';

export const SUCCESS_PANEL_DURATION_MS = 4000;

type SuccessPanelListener = (state: SuccessPanelState | null) => void;

let listener: SuccessPanelListener | null = null;
let current: SuccessPanelState | null = null;
let nextId = 1;
let timer: ReturnType<typeof setTimeout> | null = null;
let remainingMs = SUCCESS_PANEL_DURATION_MS;
let startedAt = 0;
const pauseReasons = new Set<SuccessPanelPauseReason>();

function clearTimer(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
}

function startTimer(): void {
  clearTimer();
  startedAt = Date.now();
  timer = setTimeout(() => {
    timer = null;
    hide();
  }, remainingMs);
}

function notify(): void {
  try {
    listener?.(current);
  } catch {
    // Une erreur d'affichage ne doit jamais remonter vers le flux métier appelant.
  }
}

function resetState(): void {
  clearTimer();
  current = null;
  pauseReasons.clear();
  remainingMs = SUCCESS_PANEL_DURATION_MS;
}

function hide(): void {
  resetState();
  notify();
}

export const successPanel = {
  show(payload: SuccessPanelPayload): void {
    try {
      if (!listener) return;
      clearTimer();
      current = { id: nextId++, title: payload.title, detail: payload.detail };
      remainingMs = SUCCESS_PANEL_DURATION_MS;
      if (pauseReasons.size === 0) startTimer();
      notify();
    } catch {
      // Voir notify() : jamais d'exception vers l'appelant.
    }
  },

  dismiss(): void {
    if (!current) return;
    hide();
  },

  pause(reason: SuccessPanelPauseReason): void {
    if (!current || pauseReasons.has(reason)) return;
    pauseReasons.add(reason);
    if (timer !== null) {
      remainingMs = Math.max(0, remainingMs - (Date.now() - startedAt));
      clearTimer();
    }
  },

  resume(reason: SuccessPanelPauseReason): void {
    if (!pauseReasons.delete(reason)) return;
    if (current && pauseReasons.size === 0 && timer === null) startTimer();
  },

  register(cb: SuccessPanelListener): () => void {
    listener = cb;
    return () => {
      if (listener !== cb) return;
      listener = null;
      resetState();
    };
  }
};
