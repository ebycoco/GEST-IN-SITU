/**
 * Utilitaires propres au portail OPERATEUR_LOGISTIQUE (InventaireLogistique / InventaireSansRangement)
 * pour le champ « Contact » FACULTATIF du rangement.
 *
 * Copie volontairement locale (pas de factorisation avec SaisiePage / ProfilePage /
 * useVerificationSearch / DeliveryModal : composants partagés hors périmètre, CLAUDE.md §4).
 * Fonctions pures, synchrones, sans DOM ni IPC : coût négligeable (≤ 13 chiffres traités).
 */

const PREFIX = '+225';
const MAX_LOCAL_DIGITS = 10;

/**
 * Extrait les chiffres locaux (max 10) d'une saisie ou d'un collage.
 * - Valeur déjà au format du champ (commence par « +225 ») : le préfixe est retiré, le reste
 *   constitue le numéro local (ce qui permet un numéro local commençant par 225 : « +225 22 51 ... »).
 * - Sinon, le préfixe 225 n'est retiré que s'il y a plus de 10 chiffres : un vrai numéro local de
 *   10 chiffres commençant par 225 n'est jamais amputé.
 */
export function extractLocalDigits(value: string): string {
  const trimmed = (value ?? '').trimStart();
  let digits: string;
  if (trimmed.startsWith(PREFIX)) {
    digits = trimmed.slice(PREFIX.length).replace(/\D/g, '');
  } else {
    digits = trimmed.replace(/\D/g, '');
    if (digits.length > MAX_LOCAL_DIGITS && digits.startsWith('225')) {
      digits = digits.slice(3);
    }
  }
  return digits.slice(0, MAX_LOCAL_DIGITS);
}

/** Formate en « +225 XX XX XX XX XX » ; champ vide ou « +225 » seul => chaîne vide. */
export function formatPhoneInput(value: string): string {
  const digits = extractLocalDigits(value);
  if (digits.length === 0) return '';
  let formatted = PREFIX;
  for (let i = 0; i < digits.length; i++) {
    if (i % 2 === 0) formatted += ' ';
    formatted += digits[i];
  }
  return formatted;
}

/** Chiffres locaux à envoyer à l'IPC (chiffres seuls, ≤ 10). */
export function getLocalDigitsToSend(formatted: string): string {
  return extractLocalDigits(formatted);
}

/**
 * Décide du contact à envoyer : undefined si vide ou inchangé par rapport à la fiche (une valeur
 * historique non conforme ne doit pas bloquer le rangement). `error` est renseigné si la valeur
 * saisie est non vide, modifiée et différente de 10 chiffres (aucun appel IPC à faire).
 */
export function resolveContactToSend(
  formatted: string,
  ficheContact: string | null | undefined
): { contact?: string; error?: string } {
  const digits = getLocalDigitsToSend(formatted);
  if (digits === '') return {};
  if (digits === extractLocalDigits(formatPhoneInput(ficheContact ?? ''))) return {};
  if (digits.length !== MAX_LOCAL_DIGITS) {
    return { error: 'Le contact doit comporter exactement 10 chiffres.' };
  }
  return { contact: digits };
}

/** Retire le préfixe Electron « Error invoking remote method '...': Error: » d'un message d'erreur IPC. */
export function cleanIpcErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? '');
  return raw.replace(/^Error invoking remote method '[^']*':\s*(?:Error:\s*)?/, '').trim();
}
