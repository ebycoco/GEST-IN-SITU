/**
 * Affichage sûr d'un n° de sécurité sociale (CMU) : jamais en notation scientifique.
 *
 * Contexte : Excel peut corrompre un n° à 13 chiffres en « 3,84E+12 » avant réimport ; la valeur
 * est alors stockée telle quelle en base. Cette fonction est PURE et n'agit qu'à l'affichage /
 * à l'export : elle ne modifie jamais la valeur stockée.
 *
 * Conversion par manipulation de chaînes uniquement (jamais Number()/parseFloat : aucun
 * arrondi flottant). Si le résultat n'est pas exactement 13 chiffres, la valeur d'origine est
 * renvoyée inchangée (on n'invente rien).
 *
 * @param value Valeur brute de t_cartes.num_secu.
 * @returns Les 13 chiffres reconstruits, sinon la valeur d'origine ('' si null/undefined).
 */
// Conversion : la partie entière doit commencer par [1-9] (« 0,384E+12 » n'est pas un n° valide).
const SCIENTIFIC_RE = /^([1-9]\d*)(?:[.,](\d+))?[eE]\+?(\d+)$/;
// Détection large (mantisse quelconque, convertible ou non) : sert à décider du préremplissage.
const SCIENTIFIC_SHAPE_RE = /^\d+(?:[.,]\d+)?[eE]\+?\d+$/;
const NUM_SECU_LENGTH = 13;
const MAX_PLAUSIBLE_EXPONENT = 30;

export function formatNumSecu(value: string | null | undefined): string {
  if (value === null || value === undefined) return '';
  // Typage strict : une valeur non-chaîne (nombre venu d'une source mal typée) est stringifiée sans lever.
  if (typeof value !== 'string') return String(value);
  const trimmed = value.trim();
  const match = SCIENTIFIC_RE.exec(trimmed);
  if (!match) return value;

  const intPart = match[1];
  const decPart = match[2] ?? '';
  const exponentStr = match[3];
  if (exponentStr.length > 2) return value;
  const exponent = parseInt(exponentStr, 10);
  if (exponent > MAX_PLAUSIBLE_EXPONENT) return value;

  const digits = intPart + decPart;
  const integerLength = intPart.length + exponent;
  // Chiffres fractionnaires restants : pas un entier, on ne convertit pas.
  if (integerLength < digits.length) return value;

  const result = digits + '0'.repeat(integerLength - digits.length);
  return result.length === NUM_SECU_LENGTH ? result : value;
}

/**
 * Vrai si la valeur BRUTE stockée a la forme mantisse/exposant (« 3,84E+12 », « 0,384E+12 »),
 * qu'elle soit convertible en 13 chiffres ou non : dans tous les cas c'est une corruption
 * Excel, jamais un vrai n° exploitable. PURE.
 */
export function isScientificNumSecu(value: string | null | undefined): boolean {
  if (value === null || value === undefined) return false;
  return SCIENTIFIC_SHAPE_RE.test(String(value).trim());
}

/**
 * Valeur de préremplissage d'un champ d'ÉDITION de n° sécu dans le portail Qualité :
 * vide si la valeur stockée est en notation scientifique (l'opérateur doit saisir le vrai n°),
 * sinon la valeur brute stockée ('' si null/undefined). Ne fabrique jamais un n° à partir
 * d'une notation scientifique. PURE.
 */
export function getNumSecuEditDefault(raw: string | null | undefined): string {
  if (raw === null || raw === undefined) return '';
  if (isScientificNumSecu(raw)) return '';
  return String(raw);
}

/**
 * Vrai uniquement si le n° sécu courant du formulaire diffère de la valeur préremplie
 * (comparaison après trim). Règle : ne JAMAIS envoyer un num_secu que l'utilisateur n'a
 * pas modifié lui-même. PURE.
 */
export function shouldSendNumSecu(current: string | null | undefined, initial: string | null | undefined): boolean {
  return (current ?? '').trim() !== (initial ?? '').trim();
}

/**
 * Page Sans rangement : le champ n° sécu n'est affiché (donc saisissable) que si la fiche n'en
 * a aucun. Renvoie la valeur saisie (trimée) à envoyer, ou undefined si le champ est caché
 * (n° déjà stocké) ou laissé vide. PURE.
 */
export function resolveNumSecuToSendWhenAbsent(
  storedNumSecu: string | null | undefined,
  inputValue: string | null | undefined
): string | undefined {
  if (storedNumSecu) return undefined;
  const trimmed = (inputValue ?? '').trim();
  return trimmed || undefined;
}
