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
const SCIENTIFIC_RE = /^(\d+)(?:[.,](\d+))?[eE]\+?(\d+)$/;
const NUM_SECU_LENGTH = 13;
const MAX_PLAUSIBLE_EXPONENT = 30;

export function formatNumSecu(value: string | null | undefined): string {
  if (value === null || value === undefined) return '';
  const trimmed = String(value).trim();
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
