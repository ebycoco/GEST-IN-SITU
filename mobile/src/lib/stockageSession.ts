// Stockage de la session dans l'ONGLET seulement (window.sessionStorage), jamais
// localStorage ni IndexedDB.
//
// Pourquoi : actualiser la page (bouton, ou geste « glisser vers le bas » de Chrome
// Android) ne doit pas deconnecter l'operateur. sessionStorage survit a un rechargement
// de l'onglet mais est efface a la fermeture de l'onglet / de l'appli.
//
// Contenu STRICT (tout commence par PREFIXE, pour un effacement en une passe) :
//  - CLE_AUTH     : session supabase-js (jeton d'acces + jeton de renouvellement), ecrite
//                   par auth-js via l'adaptateur ci-dessous ;
//  - CLE_ACTIVITE : heure (ms) de derniere activite, pour que le verrou d'inactivite
//                   (15 min) reste effectif apres un rechargement ;
//  - CLE_LOGIN    : identifiant affiche dans la barre (pas un secret).
// Aucune donnee de carte ni resultat de recherche n'est jamais stocke ici.

export const PREFIXE = 'gis-mobile-';
export const CLE_AUTH = PREFIXE + 'auth';
export const CLE_ACTIVITE = PREFIXE + 'activite';
export const CLE_LOGIN = PREFIXE + 'login';

/** Sous-ensemble de l'API Storage utilise ici (injectable dans les tests). */
export interface Magasin {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** sessionStorage du navigateur, ou null s'il est absent / bloque (mode prive, etc.). */
export function magasinOnglet(): Magasin | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

/**
 * Adaptateur pour l'option auth.storage de supabase-js (interface SupportedStorage :
 * getItem / setItem / removeItem). Toute erreur du navigateur est avalee : sans stockage
 * utilisable (quota, acces refuse), la session reste simplement en memoire pour cette
 * page (repli Map), comme avant.
 */
export function adaptateurAuth(obtenir: () => Magasin | null = magasinOnglet): {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
} {
  const repli = new Map<string, string>();
  return {
    getItem(key) {
      try {
        const m = obtenir();
        if (m) return m.getItem(key);
      } catch {
        // repli memoire
      }
      return repli.get(key) ?? null;
    },
    setItem(key, value) {
      try {
        const m = obtenir();
        if (m) {
          m.setItem(key, value);
          return;
        }
      } catch {
        // repli memoire
      }
      repli.set(key, value);
    },
    removeItem(key) {
      repli.delete(key);
      try {
        obtenir()?.removeItem(key);
      } catch {
        // rien a faire
      }
    },
  };
}

/** Une session est-elle presente dans l'onglet ? (decide d'afficher l'ecran de chargement) */
export function sessionPresente(m: Magasin | null = magasinOnglet()): boolean {
  try {
    return m !== null && m.getItem(CLE_AUTH) !== null;
  } catch {
    return false;
  }
}

/** Supprime TOUTES les cles de l'appli (session, activite, identifiant, cles annexes d'auth-js). */
export function effacerStockage(m: Magasin | null = magasinOnglet()): void {
  if (!m) return;
  try {
    const cles: string[] = [];
    for (let i = 0; i < m.length; i++) {
      const k = m.key(i);
      if (k !== null && k.startsWith(PREFIXE)) cles.push(k);
    }
    for (const k of cles) m.removeItem(k);
  } catch {
    // stockage inaccessible : rien de plus a faire
  }
}

/** Efface uniquement l'activite et l'identifiant (synchrone, au debut d'une fermeture de session). */
export function effacerActivite(m: Magasin | null = magasinOnglet()): void {
  try {
    m?.removeItem(CLE_ACTIVITE);
    m?.removeItem(CLE_LOGIN);
  } catch {
    // rien a faire
  }
}

export function ecrireActivite(t: number, m: Magasin | null = magasinOnglet()): void {
  try {
    m?.setItem(CLE_ACTIVITE, String(Math.trunc(t)));
  } catch {
    // quota / acces refuse : activite inconnue au rechargement = session refusee (sur)
  }
}

/** Derniere activite memorisee (ms), ou null si absente / illisible. */
export function lireActivite(m: Magasin | null = magasinOnglet()): number | null {
  try {
    const v = m?.getItem(CLE_ACTIVITE);
    if (v === null || v === undefined || !/^\d{1,16}$/.test(v)) return null;
    return Number(v);
  } catch {
    return null;
  }
}

export function ecrireLogin(login: string, m: Magasin | null = magasinOnglet()): void {
  try {
    m?.setItem(CLE_LOGIN, login);
  } catch {
    // affichage seulement
  }
}

export function lireLogin(m: Magasin | null = magasinOnglet()): string | null {
  try {
    return m?.getItem(CLE_LOGIN) ?? null;
  } catch {
    return null;
  }
}
