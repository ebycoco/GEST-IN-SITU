// Masques de saisie et mises en forme (logique pure, testee dans tests/masks.test.ts).
// Aucune donnee n'est conservee : fonctions sans etat.

/** Garde uniquement les chiffres. */
export function digitsOnly(v: string): string {
  return v.replace(/\D+/g, '');
}

/**
 * Masque JJ/MM/AAAA : l'operateur tape les chiffres, les « / » s'ajoutent seuls.
 * Les caracteres non numeriques sont ignores ; 8 chiffres au plus.
 */
export function formatDateInput(raw: string): string {
  const d = digitsOnly(raw).slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
}

/**
 * JJ/MM/AAAA -> AAAA-MM-JJ (format DATE attendu par fn_mobile_rechercher_cartes),
 * ou null si la date est incomplete ou n'existe pas (31/02, annee < 1900 ou future).
 */
export function parseDdn(masked: string, today: Date = new Date()): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(masked);
  if (!m) return null;
  const j = Number(m[1]);
  const mo = Number(m[2]);
  const a = Number(m[3]);
  if (a < 1900 || mo < 1 || mo > 12 || j < 1) return null;
  const dt = new Date(Date.UTC(a, mo - 1, j));
  if (dt.getUTCFullYear() !== a || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== j) return null;
  const finJour = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  if (dt.getTime() > finJour) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/**
 * Chiffres d'un telephone ivoirien saisi (10 au plus). Un numero colle avec
 * l'indicatif (+225 / 00225 suivi de 10 chiffres) est ramene a ses 10 chiffres,
 * comme fn_mobile_tel_chiffres cote serveur.
 */
export function phoneDigits(raw: string): string {
  let d = digitsOnly(raw);
  if (d.length === 15 && d.startsWith('00225')) d = d.slice(5);
  else if (d.length === 13 && d.startsWith('225')) d = d.slice(3);
  return d.slice(0, 10);
}

/** Affichage par groupes de 2 : « 07 00 00 00 1 » (le prefixe +225 est fixe a l'ecran). */
export function formatPhoneInput(raw: string): string {
  const d = phoneDigits(raw);
  return d.replace(/(\d{2})(?=\d)/g, '$1 ');
}

/** Numero complet a l'ecran : « +225 05 00 00 00 18 » (saisi par l'agent, recapitulatif). */
export function formatPhoneFull(digits: string): string {
  return `+225 ${formatPhoneInput(digits)}`;
}

/**
 * Contact deja masque par le serveur (« ********45 », fn_mobile_masque) ->
 * « +225 •• •• •• •• 45 ». Rien n'est demasque : seuls les 2 derniers chiffres
 * renvoyes par le serveur sont repris. null / illisible -> null.
 */
export function formatMaskedContact(masque: string | null | undefined): string | null {
  if (!masque) return null;
  const m = /(\d{2})$/.exec(masque);
  if (!m) return null;
  return `+225 •• •• •• •• ${m[1]}`;
}

/** Date du serveur (AAAA-MM-JJ, eventuellement suivie d'une heure) -> JJ/MM/AAAA ; sinon texte brut. */
export function formatIsoDate(v: string | null | undefined): string {
  if (!v) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : v;
}

/** Horodatage (timestamptz) -> « 23/11/2026 à 09:46 » en heure locale du telephone. */
export function formatDateTime(v: string | null | undefined): string {
  if (!v) return '';
  const t = new Date(v);
  if (Number.isNaN(t.getTime())) return v;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(t.getDate())}/${p(t.getMonth() + 1)}/${t.getFullYear()} à ${p(t.getHours())}:${p(t.getMinutes())}`;
}

/** Nom saisi : majuscules, espaces multiples reduits (meme normalisation que le serveur). */
export function normalizeName(v: string): string {
  return v.trim().replace(/\s+/g, ' ').toUpperCase();
}
