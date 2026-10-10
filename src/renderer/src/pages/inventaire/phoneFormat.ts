/**
 * Utilitaires propres au portail OPERATEUR_LOGISTIQUE (InventaireLogistique / InventaireSansRangement)
 * pour le champ « Contact » FACULTATIF du rangement.
 *
 * Copie volontairement locale (pas de factorisation avec SaisiePage / ProfilePage /
 * useVerificationSearch / DeliveryModal : composants partagés hors périmètre, CLAUDE.md §4).
 * Fonctions pures, synchrones, sans DOM ni IPC : coût négligeable (quelques dizaines de caractères).
 */

const PREFIX = '+225';
const MAX_LOCAL_DIGITS = 10;

/**
 * Extrait TOUS les chiffres locaux d'une saisie ou d'un collage, SANS troncature (peut dépasser 10).
 * - Valeur déjà au format du champ (commence par « +225 ») : le préfixe est retiré, le reste
 *   constitue le numéro local (ce qui permet un numéro local commençant par 225 : « +225 22 51 ... »).
 * - Sinon, le préfixe 225 n'est retiré que s'il y a plus de 10 chiffres : un vrai numéro local de
 *   10 chiffres commençant par 225 n'est jamais amputé.
 * Sert à détecter un dépassement (collage trop long) et à valider à l'enregistrement : aucune
 * valeur issue d'une troncature silencieuse ne doit atteindre l'IPC.
 */
export function rawLocalDigits(value: string): string {
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
  return digits;
}

/** Variante tronquée à 10 chiffres, réservée à l'AFFICHAGE formaté (jamais à l'envoi IPC). */
export function extractLocalDigits(value: string): string {
  return rawLocalDigits(value).slice(0, MAX_LOCAL_DIGITS);
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

/** Vrai si la valeur contient plus de 10 chiffres locaux (donnée historique non conforme). */
export function isOverlongContact(value: string | null | undefined): boolean {
  return rawLocalDigits(value ?? '').length > MAX_LOCAL_DIGITS;
}

/**
 * Valeur à pré-remplir dans le champ pour un contact déjà en fiche : formatée si <= 10 chiffres
 * (contacts courts historiques inclus), sinon affichée TELLE QUELLE (non tronquée) afin de ne pas
 * masquer l'anomalie de donnée.
 */
export function formatContactForDisplay(contact: string | null | undefined): string {
  const raw = (contact ?? '').trim();
  if (isOverlongContact(raw)) return raw;
  return formatPhoneInput(raw);
}

export const CONTACT_TOO_LONG_MESSAGE = 'Numéro trop long : vérifiez les chiffres (10 chiffres attendus).';

/**
 * Applique un changement du champ (onChange). Fonction pure.
 * - <= 10 chiffres : valeur reformatée.
 * - > 10 chiffres et saisie qui raccourcit la valeur courante (suppression sur donnée historique
 *   non conforme) : acceptée telle quelle, pour ne pas bloquer la correction.
 * - > 10 chiffres sinon : valeur précédente conservée (jamais de troncature silencieuse).
 *   `tooLong` n'est vrai que pour un collage / ajout multi-caractères : le 11e chiffre tapé est
 *   simplement ignoré, sans toast.
 */
export function applyPhoneChange(prev: string, next: string): { value: string; tooLong: boolean } {
  const nextRaw = rawLocalDigits(next);
  if (nextRaw.length <= MAX_LOCAL_DIGITS) return { value: formatPhoneInput(next), tooLong: false };
  if (nextRaw.length < rawLocalDigits(prev).length) return { value: next, tooLong: false };
  return { value: prev, tooLong: next.length - prev.length > 1 };
}

/** Chiffres locaux du champ pour l'IPC (chiffres seuls, NON tronqués : la validation tranche). */
export function getLocalDigitsToSend(formatted: string): string {
  return rawLocalDigits(formatted);
}

/**
 * Décide du contact à envoyer : undefined si vide ou inchangé par rapport à la fiche (une valeur
 * historique non conforme, y compris > 10 chiffres, ne doit pas bloquer le rangement). `error` est
 * renseigné si la valeur saisie est non vide, modifiée et différente de 10 chiffres (aucun appel
 * IPC à faire). Aucune troncature : une valeur > 10 chiffres modifiée est refusée.
 */
export function resolveContactToSend(
  formatted: string,
  ficheContact: string | null | undefined
): { contact?: string; error?: string } {
  const digits = getLocalDigitsToSend(formatted);
  if (digits === '') return {};
  if (digits === rawLocalDigits(ficheContact ?? '')) return {};
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
