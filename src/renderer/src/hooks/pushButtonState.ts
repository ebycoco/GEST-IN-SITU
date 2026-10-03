/**
 * Règle de visibilité du bouton manuel « Envoyer les corrections » / « Synchroniser mes actions »
 * (extraite de usePushButtonVisibility pour être testée sans React).
 *
 * - Envoi automatique désactivé, ou poste hors-ligne : bouton toujours visible, compteur = `conformeCount`
 *   (comportement historique inchangé).
 * - Envoi automatique actif + en ligne : le bouton est visible s'il reste des lignes d'outbox à traiter
 *   (`outboxActionableCount` : PENDING + ERROR) OU des cartes conformes modifiées en local qui n'ont
 *   aucune ligne d'outbox (`orphanCount`). Ces dernières (ex. modifiées avant une mise à jour de
 *   l'application) ne partiront jamais seules : sans ce second terme, le bouton restait masqué alors que
 *   l'envoi manuel (upload-worker.js, qui lit is_dirty directement) pouvait les envoyer.
 *   Les deux compteurs sont disjoints (voir getUnsyncedConformeOrphanCardsCount) : leur somme ne compte
 *   aucune carte deux fois.
 */
export interface PushButtonStateInput {
  autoUpstream: boolean;
  isOnline: boolean;
  /** Cartes conformes is_dirty = 1 (compteur historique du bouton). */
  conformeCount: number;
  /** Lignes t_outbox PENDING + ERROR pour t_cartes. */
  outboxActionableCount: number;
  /** Cartes conformes is_dirty = 1 sans ligne PENDING/ERROR dans t_outbox. */
  orphanCount: number;
  isBulkUploading: boolean;
}

export interface PushButtonState {
  visible: boolean;
  disabled: boolean;
  actionableCount: number;
}

export function computePushButtonState(input: PushButtonStateInput): PushButtonState {
  const { autoUpstream, isOnline, conformeCount, outboxActionableCount, orphanCount, isBulkUploading } = input;

  let visible: boolean;
  let actionableCount: number;
  if (!autoUpstream || !isOnline) {
    visible = true;
    actionableCount = conformeCount;
  } else {
    actionableCount = outboxActionableCount + orphanCount;
    visible = actionableCount > 0;
  }

  return { visible, disabled: isBulkUploading || actionableCount === 0, actionableCount };
}
