/**
 * Normalisation et validation des coordonnees de contact (email / telephone) d'un agent.
 *
 * Regles identiques a ProfilePage (renderer) :
 *  - email : /^[^\s@]+@[^\s@]+\.[^\s@]+$/ ;
 *  - telephone : commence par '+', 13 chiffres pour l'indicatif +225, au moins 8 chiffres sinon.
 * Une chaine vide ou blanche (ou null/undefined) est normalisee en null (contact facultatif).
 * Fonctions pures, sans dependance : utilisables par les trois processus.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Retourne l'email trim, ou null si vide/blanc/absent. Une valeur non textuelle est renvoyee telle quelle en String (validee ensuite). */
export function normalizeEmail(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s === '' ? null : s;
}

/** Retourne le telephone sans aucun espace, ou null si vide/blanc/absent. */
export function normalizePhone(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).replace(/\s+/g, '');
  return s === '' ? null : s;
}

/** Message d'erreur (francais) si l'email NORMALISE est invalide, sinon null. null accepte (facultatif). */
export function validateEmail(normalized: string | null): string | null {
  if (normalized === null) return null;
  return EMAIL_RE.test(normalized) ? null : "Adresse e-mail invalide (ex: utilisateur@domaine.com).";
}

/** Message d'erreur (francais) si le telephone NORMALISE est invalide, sinon null. null accepte (facultatif). */
export function validatePhone(normalized: string | null): string | null {
  if (normalized === null) return null;
  if (!normalized.startsWith('+')) {
    return "Le numéro de téléphone doit commencer par '+' suivi de l'indicatif pays.";
  }
  const digits = normalized.replace(/\D/g, '').length;
  if (normalized.startsWith('+225') && digits !== 13) {
    return "Le numéro de téléphone pour la Côte d'Ivoire (+225) doit comporter exactement 10 chiffres locaux.";
  }
  if (digits < 8) {
    return "Le numéro de téléphone saisi est trop court.";
  }
  return null;
}
