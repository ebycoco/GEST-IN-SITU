/**
 * Affichage du rangement d'une carte (texte uniquement, aucune logique métier).
 * Une carte sans rangement exploitable (vide, null/undefined, « NON CLASSE » quelle que soit la casse
 * ou les accents) doit afficher un message explicite plutôt que « Non classé ».
 * La logique de classement (isUnclassifiedCard, validations, SQL) reste inchangée ailleurs.
 */
export const AUCUN_RANGEMENT_LABEL = 'Aucun rangement renseigné pour cette carte';

export function isRangementAbsent(rangement: string | null | undefined): boolean {
  if (rangement == null) return true;
  const r = String(rangement).trim();
  if (r === '') return true;
  const n = r.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  return n === 'NON CLASSE';
}

export function formatRangementDisplay(rangement: string | null | undefined): string {
  return isRangementAbsent(rangement) ? AUCUN_RANGEMENT_LABEL : String(rangement);
}
