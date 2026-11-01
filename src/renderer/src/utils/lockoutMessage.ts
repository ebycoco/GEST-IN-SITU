/**
 * Verrou anti-bruteforce de `hierarchy:verifyPassword`.
 *
 * Le handler lève `Error('TROP_DE_TENTATIVES: <message utile>')` ; Electron peut préfixer le
 * message par « Error invoking remote method 'hierarchy:verifyPassword': Error: ».
 * Fonction pure, synchrone, sans effet de bord : extrait uniquement la partie utile à afficher.
 */
const LOCKOUT_MARKER = 'TROP_DE_TENTATIVES:';
const LOCKOUT_FALLBACK = 'Trop de tentatives de confirmation échouées. Réessayez dans quelques minutes.';

/**
 * @returns le texte à afficher si `err` est un verrou anti-bruteforce (repli si le détail est vide),
 *          `null` pour toute autre erreur (l'appelant conserve alors son comportement existant).
 */
export function extractLockoutMessage(err: unknown): string | null {
  let raw: string;
  if (err instanceof Error) {
    raw = err.message;
  } else if (typeof err === 'string') {
    raw = err;
  } else if (typeof err === 'object' && err !== null && typeof (err as { message?: unknown }).message === 'string') {
    raw = (err as { message: string }).message;
  } else {
    return null;
  }
  const idx = raw.indexOf(LOCKOUT_MARKER);
  if (idx < 0) return null;
  const detail = raw.slice(idx + LOCKOUT_MARKER.length).trim();
  return detail || LOCKOUT_FALLBACK;
}
