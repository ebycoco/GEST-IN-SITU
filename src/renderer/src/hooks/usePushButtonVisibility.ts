import { useState, useEffect, useCallback } from 'react';
import { useAutoUpstreamPreference } from './useAutoUpstreamPreference';
import { useOnlineStatus } from './useOnlineStatus';

/**
 * Intervalle de rafraîchissement du compteur "actionnable" (t_outbox PENDING+ERROR) quand
 * l'Envoi Automatique est actif et que le poste est en ligne. Politique Low-Memory (CLAUDE.md
 * §2) : pas de polling du tout dans les autres cas (envoi auto désactivé, ou hors-ligne) car
 * le compteur affiché repose alors sur `conformeCount`, déjà recalculé par ailleurs
 * (useDashboardStats / detailedSyncStats).
 */
const REFRESH_INTERVAL_MS = 90000;

/**
 * Détermine si le bouton manuel de synchro upstream ("Synchroniser mes actions"/"Envoyer les
 * corrections") doit être affiché, et le compteur à afficher dans son libellé.
 *
 * Logique (cf. plan validé — 3 cas) :
 * - Envoi automatique désactivé : bouton toujours visible, compteur = `conformeCount` (nombre
 *   de cartes réellement envoyables, hors doublons/dates invalides — comportement actuel
 *   inchangé pour ce cas).
 * - Envoi automatique actif + hors-ligne : bouton visible (actions locales en attente),
 *   compteur = `conformeCount`.
 * - Envoi automatique actif + en ligne : bouton visible seulement si `actionableCount > 0`
 *   (une carte est réellement bloquée en attente ou en échec d'auto-envoi), compteur =
 *   `actionableCount` (source : sync:getCardsOutboxActionableCount, PENDING+ERROR sur
 *   t_cartes).
 *
 * Rafraîchissement du compteur actionnable : au montage, toutes les 90s (uniquement quand
 * auto actif + en ligne), sur l'événement déjà existant `sync:onStatusChanged` (déjà
 * consommé par SyncWidget.tsx), et manuellement via `refreshActionableCount()` — à appeler
 * par l'appelant après un push manuel réussi.
 *
 * `outboxBacklogCount` (audit agent-9-senior-auditor, correctif P1) : compteur INFORMATIF
 * distinct de `actionableCount`, alimenté par `sync:getCardsOutboxPendingCount` (comptage réel
 * des lignes `t_outbox` en statut PENDING pour `t_cartes` — cf. `getOutboxPendingCount`,
 * handlers.ts). Ne sert JAMAIS à la décision `visible`/`disabled` (qui reste pilotée
 * exclusivement par `actionableCount`/`conformeCount`) — uniquement à afficher à l'agent
 * l'ampleur réelle de son backlog non synchronisé, y compris les cartes non "conformes"
 * (doublons, dates invalides, données manquantes) qui restent hors `conformeCount` mais sont
 * bien en attente d'envoi. Rafraîchi selon la même stratégie que `actionableCount` : montage,
 * événement `sync:onStatusChanged`, et manuellement via `refreshOutboxBacklogCount()` — à
 * appeler par l'appelant après un push manuel réussi (même pattern que
 * `refreshActionableCount`).
 *
 * Note sur le clic en mode hors-ligne : le bouton reste volontairement cliquable dans ce
 * cas — `useCloudActionGuard` (déjà branché sur `handleStartBulkUpload`) affiche déjà un
 * message explicite si `!navigator.onLine` au moment du clic. Aucune logique supplémentaire
 * n'est nécessaire ici pour ce garde-fou.
 */
export function usePushButtonVisibility(conformeCount: number, isBulkUploading: boolean) {
  const autoUpstream = useAutoUpstreamPreference();
  const isOnline = useOnlineStatus();
  const [rawActionableCount, setRawActionableCount] = useState(0);
  const [outboxBacklogCount, setOutboxBacklogCount] = useState(0);

  const refreshActionableCount = useCallback(() => {
    window.api.sync.getCardsOutboxActionableCount()
      .then(setRawActionableCount)
      .catch((err) => {
        console.error('Failed to fetch outbox actionable count', err);
      });
  }, []);

  // Compteur informatif de backlog réel (t_outbox PENDING sur t_cartes) — cf. docblock
  // ci-dessus. Indépendant de la logique visible/disabled.
  const refreshOutboxBacklogCount = useCallback(() => {
    window.api.sync.getCardsOutboxPendingCount()
      .then(setOutboxBacklogCount)
      .catch((err) => {
        console.error('Failed to fetch outbox backlog count', err);
      });
  }, []);

  // Rafraîchissement au montage
  useEffect(() => {
    refreshActionableCount();
    refreshOutboxBacklogCount();
  }, [refreshActionableCount, refreshOutboxBacklogCount]);

  // Polling 90s — uniquement quand pertinent (envoi auto actif + en ligne)
  useEffect(() => {
    if (!autoUpstream || !isOnline) return undefined;
    const interval = setInterval(refreshActionableCount, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [autoUpstream, isOnline, refreshActionableCount]);

  // Rafraîchissement sur l'événement de statut de synchro déjà existant (poussé par le
  // Main Process après chaque cycle) — nettoyage systématique du listener au démontage
  // (CLAUDE.md §2).
  useEffect(() => {
    if (!window.api?.sync?.onStatusChanged) return undefined;
    const unsubscribe = window.api.sync.onStatusChanged(() => {
      refreshActionableCount();
      refreshOutboxBacklogCount();
    });
    return () => unsubscribe();
  }, [refreshActionableCount, refreshOutboxBacklogCount]);

  let visible: boolean;
  let actionableCount: number;

  if (!autoUpstream || !isOnline) {
    // Envoi auto désactivé, ou actif mais hors-ligne : comportement legacy, toujours visible.
    visible = true;
    actionableCount = conformeCount;
  } else {
    // Envoi auto actif + en ligne : masqué tant qu'aucune carte n'est réellement bloquée.
    visible = rawActionableCount > 0;
    actionableCount = rawActionableCount;
  }

  const disabled = isBulkUploading || actionableCount === 0;

  return {
    visible,
    disabled,
    actionableCount,
    refreshActionableCount,
    outboxBacklogCount,
    refreshOutboxBacklogCount
  };
}
