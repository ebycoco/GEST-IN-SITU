/**
 * Message de bienvenue affiché dans le toast après la connexion.
 *
 * Fonctions PURES (aucun accès React/IPC/DOM) afin d'être testables sous Vitest (env node).
 *
 * Règle métier (validée PO) :
 *  - on affiche le NOM (`nom_user`) ; s'il est absent/vide/espaces, on affiche le PRÉNOM
 *    (`prenom_user`) ; JAMAIS les deux ; si aucun des deux n'existe -> « Bienvenue ! ».
 *  - trim + espaces internes compressés ; la casse saisie est conservée, SAUF si le texte est
 *    entièrement en MAJUSCULES : il est alors mis en forme « Capitalisée » (YEO -> Yeo), car un
 *    toast tout en capitales est perçu comme agressif. Un texte en casse mixte (« McDonald »,
 *    « Kouassi ») est jugé volontairement saisi et n'est pas modifié.
 *  - la capitalisation tient compte des séparateurs espace, tiret et apostrophe
 *    (KOUASSI-YAO -> Kouassi-Yao, N'GUESSAN -> N'Guessan).
 *  - aucune autre donnée (login, rôle, site) n'est jamais utilisée.
 */

/** Sous-ensemble de l'utilisateur nécessaire au message (champs optionnels/nullables). */
export interface WelcomeUser {
  nom_user?: string | null;
  prenom_user?: string | null;
}

/** Nettoie une valeur brute : non-chaîne -> '', trim, espaces internes compressés. */
function cleanName(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim();
}

/** Vrai si le texte contient au moins une lettre et aucune minuscule. */
function isAllUpperCase(text: string): boolean {
  return text !== text.toLocaleLowerCase('fr') && text === text.toLocaleUpperCase('fr');
}

/** Met en « Capitalisée » chaque segment délimité par espace, tiret ou apostrophe. */
function toTitleCase(text: string): string {
  return text
    .toLocaleLowerCase('fr')
    .replace(/(^|[\s\-'’])(\p{L})/gu, (_m, sep: string, letter: string) => sep + letter.toLocaleUpperCase('fr'));
}

/**
 * Retourne le nom d'affichage (nom, sinon prénom) mis en forme, ou '' si aucun n'est exploitable.
 */
export function formatWelcomeName(user: WelcomeUser | null | undefined): string {
  const nom = cleanName(user?.nom_user);
  const chosen = nom !== '' ? nom : cleanName(user?.prenom_user);
  if (chosen === '') return '';
  return isAllUpperCase(chosen) ? toTitleCase(chosen) : chosen;
}

/**
 * Construit le message du toast.
 * - mono-rôle  : « Bienvenue <Nom> ! »  (repli « Bienvenue ! »)
 * - multi-rôle : « Bienvenue <Nom> ! Sélectionnez votre rôle pour cette session. »
 */
export function buildWelcomeMessage(
  user: WelcomeUser | null | undefined,
  options: { multiRole?: boolean } = {}
): string {
  const name = formatWelcomeName(user);
  const greeting = name ? `Bienvenue ${name} !` : 'Bienvenue !';
  return options.multiRole ? `${greeting} Sélectionnez votre rôle pour cette session.` : greeting;
}
