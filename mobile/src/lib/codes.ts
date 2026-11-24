// Textes affiches pour les reponses du serveur (tests/codes.test.ts).
// Retrait : codes de fn_mobile_delivrer_carte (supabase/migrations/0020, lignes 51-65 et 106-108).
// Connexion : reponses de supabase/functions/gis-login/index.ts (401 / 403 / 429 / 503).

export type Variante = 'err' | 'warn' | 'info' | 'off' | 'ok';

export interface Message {
  titre: string;
  texte: string;
  variante: Variante;
}

/** Tous les codes que fn_mobile_delivrer_carte peut renvoyer (0020) + cas client. */
export const CODES_RETRAIT = [
  'OK',
  'INTROUVABLE',
  'HORS_SITE',
  'HORS_CENTRE',
  'DOUBLON',
  'DEJA_DELIVREE',
  'STATUT_INVALIDE',
  'ABSENTE',
  'RANGEMENT_REQUIS',
  'PARAMETRES_INVALIDES',
  'COMPTE_INACTIF',
] as const;

const RETRAIT: Record<string, Message> = {
  OK: { titre: 'Retrait enregistré dans le cloud', texte: 'Visible sur les postes à leur prochaine synchronisation.', variante: 'ok' },
  DEJA_DELIVREE: { titre: 'Carte déjà délivrée', texte: 'Ne remettez pas la carte. Si l\'assuré la réclame encore, contactez votre administrateur.', variante: 'err' },
  HORS_CENTRE: { titre: 'Carte d\'un autre centre', texte: 'Cette carte est rangée dans un autre centre. Orientez l\'assuré vers ce centre.', variante: 'err' },
  HORS_SITE: { titre: 'Carte d\'un autre site', texte: 'Vous ne pouvez pas délivrer une carte d\'un autre site.', variante: 'err' },
  DOUBLON: { titre: 'Carte déclarée en doublon', texte: 'Elle ne peut plus être délivrée. Contactez un administrateur.', variante: 'err' },
  ABSENTE: { titre: 'Carte signalée absente ou perdue', texte: 'Délivrance impossible. Contactez votre administrateur.', variante: 'err' },
  RANGEMENT_REQUIS: { titre: 'Rangement d\'urgence obligatoire', texte: 'Cette carte n\'a pas de rangement. Revenez en arrière et saisissez-le.', variante: 'warn' },
  STATUT_INVALIDE: { titre: 'Carte non délivrable', texte: 'Son statut a changé. Relancez la recherche.', variante: 'err' },
  COMPTE_INACTIF: { titre: 'Compte désactivé', texte: 'Votre compte n\'est plus actif. Vous allez être déconnecté.', variante: 'err' },
  INTROUVABLE: { titre: 'Carte introuvable', texte: 'Cette carte n\'existe plus dans le cloud. Relancez la recherche.', variante: 'err' },
  PARAMETRES_INVALIDES: { titre: 'Informations incomplètes', texte: 'Vérifiez le nom et le téléphone du retirant (10 chiffres). Si la fiche n\'a pas de numéro enregistré, saisissez-en un.', variante: 'warn' },
  OCCUPEE: { titre: 'Carte en cours de traitement', texte: 'Un autre retrait de cette carte est en cours. Rien n\'a été enregistré. Patientez quelques secondes puis confirmez à nouveau.', variante: 'warn' },
  ROLE_NON_AUTORISE: { titre: 'Accès réservé', texte: 'Cette version téléphone est réservée aux opérateurs de vérification.', variante: 'info' },
};

const INCONNU: Message = {
  titre: 'Réponse inattendue du serveur',
  texte: 'Le retrait n\'a peut-être pas été enregistré. Vérifiez la carte avant toute nouvelle tentative.',
  variante: 'err',
};

export function messageRetrait(code: string): Message {
  return RETRAIT[code] ?? INCONNU;
}

/** Refus pour lesquels l'operateur peut revenir au formulaire / recapitulatif. */
export function refusCorrigeable(code: string): boolean {
  return code === 'RANGEMENT_REQUIS' || code === 'PARAMETRES_INVALIDES' || code === 'OCCUPEE';
}

// ---------------------------------------------------------------------------
// Connexion

export type IssueConnexion =
  | { kind: 'ok'; tokenHash: string; otpType: string }
  | { kind: 'invalid' }
  | { kind: 'blocked'; minutes: number }
  | { kind: 'suspended' }
  | { kind: 'licence' }
  | { kind: 'no_site' }
  | { kind: 'service' }
  | { kind: 'offline' }
  | { kind: 'role' }
  | { kind: 'config' };

/**
 * Reponse HTTP de gis-login -> issue. retryAfterHeader = en-tete Retry-After (secondes),
 * expose par la fonction (Access-Control-Expose-Headers).
 */
export function issueGisLogin(status: number, body: unknown, retryAfterHeader: string | null): IssueConnexion {
  const b = body !== null && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  if (status === 200 && b['ok'] === true && typeof b['token_hash'] === 'string' && b['token_hash'] !== '') {
    return { kind: 'ok', tokenHash: b['token_hash'], otpType: typeof b['type'] === 'string' ? b['type'] : 'magiclink' };
  }
  if (status === 429) {
    const brut = typeof b['retry_after'] === 'number' ? b['retry_after'] : Number(retryAfterHeader ?? '');
    const s = Number.isFinite(brut) && brut > 0 ? brut : 60;
    return { kind: 'blocked', minutes: Math.max(1, Math.ceil(s / 60)) };
  }
  if (status === 403) {
    if (b['error'] === 'site_suspended') return { kind: 'suspended' };
    if (b['error'] === 'licence_expired') return { kind: 'licence' };
    if (b['error'] === 'no_site') return { kind: 'no_site' };
    return { kind: 'service' };
  }
  if (status === 401 || status === 400 || status === 413) return { kind: 'invalid' };
  return { kind: 'service' };
}

export function messageConnexion(i: IssueConnexion): Message | null {
  switch (i.kind) {
    case 'ok':
      return null;
    case 'invalid':
      return { titre: 'Connexion échouée', texte: 'Identifiant ou mot de passe incorrect', variante: 'err' };
    case 'blocked':
      return {
        titre: 'Connexion temporairement bloquée',
        texte: `Trop de tentatives de connexion échouées. Réessayez dans ${i.minutes} min.`,
        variante: 'warn',
      };
    case 'suspended':
      return { titre: 'Accès suspendu', texte: 'L\'accès de votre site a été suspendu. Veuillez contacter le Super Administrateur.', variante: 'err' };
    case 'licence':
      return { titre: 'Licence expirée', texte: 'La licence de votre site a expiré. Veuillez contacter le super administrateur.', variante: 'err' };
    case 'no_site':
      return { titre: 'Compte sans site', texte: 'Votre compte n\'est rattaché à aucun site. Contactez votre administrateur.', variante: 'err' };
    case 'offline':
      return { titre: 'Hors-ligne', texte: 'Une connexion Internet est requise. Activez les données mobiles ou le Wi-Fi, puis réessayez.', variante: 'off' };
    case 'role':
      return { titre: 'Accès réservé', texte: 'Cette version téléphone est réservée aux opérateurs de vérification.', variante: 'info' };
    case 'config':
      return { titre: 'Application mal configurée', texte: 'Adresse du serveur manquante. Contactez votre administrateur.', variante: 'err' };
    case 'service':
      return { titre: 'Service indisponible', texte: 'Le serveur n\'a pas pu traiter la connexion. Réessayez dans un instant.', variante: 'err' };
  }
}
