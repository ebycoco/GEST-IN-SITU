/**
 * Valide strictement une chaîne de caractères représentant une date.
 * Formats acceptés : AAAA-MM-JJ.
 * Vérifie l'existence réelle au calendrier (ex: rejette le 31 Février, mais accepte le 29 Février 2000).
 * 
 * @param dateStr La chaîne de date à valider.
 * @returns true si la date est valide, false sinon.
 */
export function isValidDateStrict(dateStr: string | null | undefined): boolean {
  if (!dateStr) return false;
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);
  const d = new Date(year, month - 1, day);
  return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day;
}

/**
 * Valide une date de naissance au format JJ/MM/AAAA ou AAAA-MM-JJ.
 * Contrairement à isValidDateStrict (ISO uniquement), accepte le format de saisie
 * utilisateur JJ/MM/AAAA pour permettre une revalidation serveur des corrections
 * qualité, dont le format de saisie diffère du format de stockage.
 */
export function isValidCalendarDateFlexible(dateStr: string | null | undefined): boolean {
  if (!dateStr || typeof dateStr !== 'string') return false;

  const matchSlash = dateStr.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const matchIso = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  let day: number, month: number, year: number;

  if (matchSlash) {
    day = parseInt(matchSlash[1], 10);
    month = parseInt(matchSlash[2], 10);
    year = parseInt(matchSlash[3], 10);
  } else if (matchIso) {
    year = parseInt(matchIso[1], 10);
    month = parseInt(matchIso[2], 10);
    day = parseInt(matchIso[3], 10);
  } else {
    return false;
  }

  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  if (year < 1900 || year > new Date().getFullYear()) return false;

  const d = new Date(year, month - 1, day);
  return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day;
}
