import { useState, useEffect, useCallback } from 'react';
import { useAutoUpstreamPreference } from './useAutoUpstreamPreference';
import { useOnlineStatus } from './useOnlineStatus';
import { useAuthStore } from '../stores/authStore';
import { computePushButtonState } from './pushButtonState';

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
 *   (une carte est réellement bloquée en attente ou en échec d'auto-envoi, OU une carte conforme
 *   modifiée en local n'a aucune ligne d'outbox), compteur = `actionableCount` = lignes d'outbox
 *   PENDING+ERROR sur t_cartes (sync:getCardsOutboxActionableCount) + cartes conformes locales sans
 *   ligne d'outbox (stats:getUnsyncedConformeOrphanCardsCount). La règle est dans pushButtonState.ts.
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
export function usePushButtonVisibility(
  conformeCount: number,
  isBulkUploading: boolean,
  /**
   * Options du clic « Envoyer les corrections » de la page appelante (allowMissing, onlyModified).
   * Le compteur orphelin doit reproduire exactement ces options, sinon le bouton peut afficher des
   * cartes que le clic n'enverra pas (ou masquer celles qu'il enverra).
   */
  sendOptions: { allowMissing: boolean; onlyModified: boolean }
) {
  const { allowMissing, onlyModified } = sendOptions;
  const autoUpstream = useAutoUpstreamPreference();
  const isOnline = useOnlineStatus();
  const [rawActionableCount, setRawActionableCount] = useState(0);
  const [orphanCount, setOrphanCount] = useState(0);
  const [outboxBacklogCount, setOutboxBacklogCount] = useState(0);
  const siteId = useAuthStore((s) => (s.user?.role === 'SUPER ADMIN' ? s.activeSiteId : s.user?.site_id));

  // Cartes conformes modifiées en local SANS ligne d'outbox (ex. avant une mise à jour de
  // l'application) : elles ne sont pas comptées par l'outbox mais l'envoi manuel peut les envoyer.
  const refreshOrphanCount = useCallback(() => {
    if (!siteId) { setOrphanCount(0); return; }
    window.api.stats.getUnsyncedConformeOrphanCardsCount(Number(siteId), { allowMissing, onlyModified })
      .then(setOrphanCount)
      .catch((err) => {
        console.error('Failed to fetch orphan conforme cards count', err);
      });
  }, [siteId, allowMissing, onlyModified]);

  // Appelé par les pages après un push manuel réussi : rafraîchit les deux compteurs d'un coup.
  const refreshActionableCount = useCallback(() => {
    window.api.sync.getCardsOutboxActionableCount()
      .then(setRawActionableCount)
      .catch((err) => {
        console.error('Failed to fetch outbox actionable count', err);
      });
    refreshOrphanCount();
  }, [refreshOrphanCount]);

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

  // Rafraîchissement sur l'événement de statut de synchro déjà existant (poussé par le Main
  // Process à chaque changement d'état réseau, pas après chaque cycle : cf. handlers.ts) —
  // nettoyage systématique du listener au démontage (CLAUDE.md §2).
  useEffect(() => {
    if (!window.api?.sync?.onStatusChanged) return undefined;
    const unsubscribe = window.api.sync.onStatusChanged(() => {
      refreshActionableCount();
      refreshOutboxBacklogCount();
    });
    return () => unsubscribe();
  }, [refreshActionableCount, refreshOutboxBacklogCount]);

  // `conformeCount` (cartes is_dirty=1 conformes) varie dès qu'une carte est modifiée ou envoyée :
  // c'est le signal pour relire le nombre de cartes locales sans ligne d'outbox.
  useEffect(() => {
    refreshOrphanCount();
  }, [conformeCount, refreshOrphanCount]);

  const { visible, disabled, actionableCount } = computePushButtonState({
    autoUpstream,
    isOnline,
    conformeCount,
    outboxActionableCount: rawActionableCount,
    orphanCount,
    isBulkUploading
  });

  return {
    visible,
    disabled,
    actionableCount,
    refreshActionableCount,
    outboxBacklogCount,
    refreshOutboxBacklogCount
  };
}
