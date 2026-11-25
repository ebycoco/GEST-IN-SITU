// Detection d'une nouvelle version publiee et decision de mise a jour. Logique pure,
// dependances injectees (tests/version.test.ts) ; le branchement navigateur est dans
// lib/useNouvelleVersion.ts.
//
// Principe : la « version » est la liste des fichiers d'entree /assets/index-<empreinte>.js
// et .css references par index.html (noms regeneres par le build des que leur contenu
// change ; le CSS est compte car une publication peut ne changer que lui). La page chargee
// est comparee a l'index.html publie, relu sur le reseau (public/sw.js laisse passer toute
// requete portant PARAM_VERIF).
//
// Limite : une publication qui ne modifie que les fichiers de public/ (icones, manifeste,
// sw.js, en-tetes) ou le seul texte d'index.html ne change pas cette liste.

import type { Magasin } from './stockageSession';

/** Parametre d'URL de la requete de verification ; meme nom dans public/sw.js. */
export const PARAM_VERIF = 'verif-version';
/** Controle periodique (appli visible et en ligne). */
export const INTERVALLE_VERIF_MS = 15 * 60 * 1000;
/** Delai minimal entre deux verifications (retours au premier plan rapproches). */
export const DELAI_MIN_VERIF_MS = 60 * 1000;
/** Abandon d'une lecture d'index.html sans reponse. */
export const DELAI_LECTURE_MS = 10_000;

// Hors du prefixe « gis-mobile- » : effacerStockage() (verrou, deconnexion) ne doit pas
// effacer la memoire anti-boucle. Contenu : noms de fichiers publics, aucune donnee.
export const CLE_RECHARGEMENTS = 'gis-maj-rechargements';
const MAX_MEMOIRE = 10;

const ENTREE = /^\/assets\/index-[A-Za-z0-9_-]+\.(js|css)$/;

/** Signature d'une liste d'adresses ; null si aucun script d'entree n'y figure. */
export function signatureDe(adresses: readonly (string | null)[]): string | null {
  const entrees = [...new Set(adresses.filter((a): a is string => a !== null && ENTREE.test(a)))].sort();
  return entrees.some((a) => a.endsWith('.js')) ? entrees.join('|') : null;
}

/**
 * Signature d'un index.html relu sur le reseau : src des <script> et href des feuilles de
 * style (commentaires ignores). Page inattendue (portail captif, erreur) : null.
 */
export function signatureDuHtml(html: string): string | null {
  const adresses: string[] = [];
  const balises = html.replace(/<!--[\s\S]*?-->/g, '').match(/<(script|link)\b[^>]*>/gi) ?? [];
  for (const balise of balises) {
    const script = /^<script/i.test(balise);
    if (!script && !/\srel\s*=\s*["']stylesheet["']/i.test(balise)) continue;
    const valeur = (script ? /\ssrc\s*=\s*["']([^"']*)["']/i : /\shref\s*=\s*["']([^"']*)["']/i).exec(balise)?.[1];
    if (valeur !== undefined) adresses.push(valeur);
  }
  return signatureDe(adresses);
}

export interface DepsVerification {
  /** Signature de la page chargee. */
  actuelle: string;
  maintenant: () => number;
  visible: () => boolean;
  enLigne: () => boolean;
  /** Texte de l'index.html publie, ou null (reponse non valide). Peut lever. */
  lireIndex: () => Promise<string | null>;
  /** Appele seulement apres une reponse exploitable : autre version, ou null si identique. */
  surResultat: (nouvelle: string | null) => void;
}

/**
 * Rend la fonction « verifier » : rien si l'appli est masquee ou hors ligne, si une lecture
 * est deja en cours ou si la precedente date de moins de DELAI_MIN_VERIF_MS. Toute erreur
 * est silencieuse et conserve le resultat precedent. Ne leve jamais.
 */
export function creerVerificateur(deps: DepsVerification): () => Promise<void> {
  let enCours = false;
  let dernier: number | null = null;
  return async () => {
    if (enCours || !deps.visible() || !deps.enLigne()) return;
    const t = deps.maintenant();
    // Ecart negatif (horloge du telephone reculee) : on verifie.
    if (dernier !== null && t >= dernier && t - dernier < DELAI_MIN_VERIF_MS) return;
    dernier = t;
    enCours = true;
    try {
      const html = await deps.lireIndex();
      const publiee = html === null ? null : signatureDuHtml(html);
      if (publiee !== null) deps.surResultat(publiee === deps.actuelle ? null : publiee);
    } catch {
      // reseau coupe, delai depasse : rien ne se passe
    } finally {
      enCours = false;
    }
  };
}

// ---- Decision

export type Ecran =
  | 'restauration'
  | 'connexion'
  | 'verrou'
  | 'recherche'
  | 'apercu'
  | 'resultats'
  | 'fiche'
  | 'form'
  | 'recap'
  | 'succes'
  | 'refus'
  | 'inconnu';

export interface EtatMiseAJour {
  ecran: Ecran;
  enLigne: boolean;
  /** Envoi d'un retrait en cours. */
  envoiRetrait: boolean;
  /** Autre operation a ne pas couper : connexion, fermeture de session, recherche, verification. */
  occupe: boolean;
  /** Contexte « resultat inconnu » en memoire (carte, retirant, request_id). */
  contexteInconnu: boolean;
  /** Ecran de connexion : champ rempli ou message affiche. */
  saisie: boolean;
}

export type ActionMiseAJour = 'auto' | 'bandeau' | 'rien';

/**
 * 'auto' : rechargement immediat (ecran de connexion vierge seulement, une seule fois par
 * version) ; 'bandeau' : bouton propose a l'operateur ; 'rien' : differe.
 * Formulaire, recapitulatif, resultat (succes / refus / inconnu) : un rechargement ferait
 * perdre la saisie, la preuve affichee ou le request_id -> differe.
 */
export function deciderMiseAJour(nouvelle: boolean, etat: EtatMiseAJour, autoDejaTente: boolean): ActionMiseAJour {
  if (!nouvelle || !etat.enLigne || etat.envoiRetrait || etat.occupe || etat.contexteInconnu) return 'rien';
  switch (etat.ecran) {
    case 'connexion':
      return etat.saisie || autoDejaTente ? 'bandeau' : 'auto';
    case 'verrou':
    case 'recherche':
    case 'apercu':
    case 'resultats':
    case 'fiche':
      return 'bandeau';
    case 'restauration':
    case 'form':
    case 'recap':
    case 'succes':
    case 'refus':
    case 'inconnu':
      return 'rien';
  }
}

// ---- Anti-boucle (sessionStorage : survit au rechargement)

function lireMemoire(m: Magasin): string[] {
  const brut = m.getItem(CLE_RECHARGEMENTS);
  if (brut === null) return [];
  try {
    const v: unknown = JSON.parse(brut);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** Un rechargement automatique a-t-il deja eu lieu pour cette version ? Doute = oui. */
export function autoDejaTente(version: string, m: Magasin | null): boolean {
  if (!m) return true;
  try {
    return lireMemoire(m).includes(version);
  } catch {
    return true;
  }
}

/**
 * Reserve LE rechargement automatique de cette version. false (donc aucun rechargement) si
 * deja fait ou si la memoire ne peut pas etre ecrite puis relue.
 */
export function reserverRechargement(version: string, m: Magasin | null): boolean {
  if (!m || autoDejaTente(version, m)) return false;
  try {
    m.setItem(CLE_RECHARGEMENTS, JSON.stringify([...lireMemoire(m), version].slice(-MAX_MEMOIRE)));
    return autoDejaTente(version, m);
  } catch {
    return false;
  }
}
