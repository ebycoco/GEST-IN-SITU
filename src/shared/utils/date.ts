/**
 * Normalise une chaîne de date au format ISO (AAAA-MM-JJ).
 * Gère les formats JJ/MM/AAAA et JJ-MM-AAAA avec ou sans espaces.
 */
export function normalizeDate(dateString: string): string {
  if (!dateString) return '';
  const trimmed = dateString.trim().replace(/\s+/g, '');
  
  // Si déjà au format AAAA-MM-JJ, on le retourne directement
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  // Format JJ/MM/AAAA (ex: 31/12/1990 ou 1/2/1990)
  const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const day = slashMatch[1].padStart(2, '0');
    const month = slashMatch[2].padStart(2, '0');
    const year = slashMatch[3];
    return `${year}-${month}-${day}`;
  }

  // Format JJ-MM-AAAA (ex: 31-12-1990 ou 1-2-1990)
  const dashMatch = trimmed.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (dashMatch) {
    const day = dashMatch[1].padStart(2, '0');
    const month = dashMatch[2].padStart(2, '0');
    const year = dashMatch[3];
    return `${year}-${month}-${day}`;
  }

  return trimmed;
}
