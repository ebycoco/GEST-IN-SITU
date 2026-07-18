/**
 * @file dateValidator.ts
 * @description Utilitaire centralise de validation stricte des dates de naissance.
 * Utilise la meme logique que le backend (workers/import-worker.js) pour garantir
 * une coherence totale entre l import CSV et la saisie manuelle.
 */

/**
 * Valide une date de naissance au format JJ/MM/AAAA ou AAAA-MM-JJ.
 * Detecte les dates physiquement impossibles : 30 Fevrier, 31 Avril, etc.
 * Gere correctement les annees bissextiles (ex: 29/02/2000 valide, 29/02/2001 invalide).
 *
 * @param dateStr - La date au format "JJ/MM/AAAA" saisie par l utilisateur.
 * @returns `true` si la date est reelle et valide dans le calendrier gregorien, `false` sinon.
 */
export function isValidCalendarDate(dateStr: string): boolean {
  if (!dateStr || typeof dateStr !== 'string') return false;

  // Accepte JJ/MM/AAAA (format saisie utilisateur)
  const matchSlash = dateStr.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  // Accepte aussi AAAA-MM-JJ (format ISO stocke en base)
  const matchIso = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  let day: number, month: number, year: number;

  if (matchSlash) {
    day   = parseInt(matchSlash[1], 10);
    month = parseInt(matchSlash[2], 10);
    year  = parseInt(matchSlash[3], 10);
  } else if (matchIso) {
    year  = parseInt(matchIso[1], 10);
    month = parseInt(matchIso[2], 10);
    day   = parseInt(matchIso[3], 10);
  } else {
    return false;
  }

  // Plages basiques
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  if (year < 1900 || year > new Date().getFullYear()) return false;

  // Validation calendaire stricte via debordement de l objet Date.
  // Si le jour est invalide pour ce mois, JavaScript bascule sur le mois suivant.
  // Ex: new Date(2000, 1, 30) -> 1er Mars 2000, pas le 30 Fevrier.
  const d = new Date(year, month - 1, day);
  return (
    d.getFullYear() === year &&
    d.getMonth()    === month - 1 &&
    d.getDate()     === day
  );
}

/**
 * Message d erreur standard a afficher sous les champs de date invalides.
 */
export const DATE_ERROR_MESSAGE = 'Date inexistante dans le calendrier (ex: 30/02 ou 31/04). Veuillez verifier.';
