import { create } from 'zustand';

/**
 * Store global Zustand pour l'état du téléchargement en arrière-plan (downstream).
 * Permet d'afficher la bannière de progression sur TOUTES les pages de l'application,
 * indépendamment du composant qui a déclenché la synchronisation.
 */

export interface DownstreamInfo {
  progress: number;   // 0-100
  merged: number;     // Nombre de cartes déjà reçues
  total: number;      // Total estimé (0 si inconnu)
}

interface SyncDownstreamState {
  /** Indique qu'un téléchargement est en cours (phase bloquante initiale) */
  isPullingCards: boolean;
  /** Indique que le téléchargement se poursuit en arrière-plan (≥ 2000 cartes reçues) */
  isBackgroundPulling: boolean;
  /** Données de progression enrichies, null si aucun téléchargement en cours */
  downstreamInfo: DownstreamInfo | null;

  // ─── Actions ──────────────────────────────────────────────────────────────
  setIsPullingCards: (v: boolean) => void;
  setDownstreamProgress: (payload: DownstreamInfo) => void;
  clearDownstream: () => void;
}

export const useSyncDownstreamStore = create<SyncDownstreamState>((set, get) => ({
  isPullingCards: false,
  isBackgroundPulling: false,
  downstreamInfo: null,

  setIsPullingCards: (v) => set({ isPullingCards: v }),

  setDownstreamProgress: (payload) => {
    const { merged } = payload;
    const wasBackground = get().isBackgroundPulling;
    // Passage automatique en mode arrière-plan dès 2000 cartes reçues
    const shouldBeBackground = wasBackground || merged >= 2000;
    set({
      downstreamInfo: payload,
      isBackgroundPulling: shouldBeBackground,
      // isPullingCards = true seulement si on n'est pas encore en arrière-plan
      isPullingCards: !shouldBeBackground,
    });
  },

  clearDownstream: () => set({
    isPullingCards: false,
    isBackgroundPulling: false,
    downstreamInfo: null,
  }),
}));
