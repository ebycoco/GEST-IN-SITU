// Branchement navigateur de la detection de version (logique : lib/version.ts).
// Verification au demarrage, au retour au premier plan (visibilitychange / pageshow : une
// appli installee reste en memoire et reprend sa page) et toutes les 15 min.
// Production seulement : en developpement il n'y a pas de fichiers /assets/index-*.
// Memoire : une seule chaine en etat ; ecouteurs et minuterie retires au demontage ; la
// reponse (index.html, ~1 Ko) n'est pas conservee.
import { useEffect, useState } from 'react';
import { DELAI_LECTURE_MS, INTERVALLE_VERIF_MS, PARAM_VERIF, creerVerificateur, signatureDe } from './version';

async function lireIndexPublie(): Promise<string | null> {
  // Parametre unique + no-store : ni le service worker (ancien ou nouveau) ni le cache
  // HTTP ne repondent a la place du serveur. Meme origine (CSP connect-src 'self').
  const r = await fetch(`/index.html?${PARAM_VERIF}=${Date.now()}`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(DELAI_LECTURE_MS),
  });
  return r.ok ? r.text() : null;
}

/** Signature de la version publiee si elle differe de la page chargee, sinon null. */
export function useNouvelleVersion(): string | null {
  const [nouvelle, setNouvelle] = useState<string | null>(null);

  useEffect(() => {
    if (!import.meta.env.PROD) return;
    const actuelle = signatureDe(
      Array.from(document.querySelectorAll('script[src], link[rel="stylesheet"][href]'), (e) => e.getAttribute('src') ?? e.getAttribute('href')),
    );
    if (actuelle === null) return;
    let actif = true;
    const verifier = creerVerificateur({
      actuelle,
      maintenant: Date.now,
      visible: () => document.visibilityState === 'visible',
      enLigne: () => navigator.onLine,
      lireIndex: lireIndexPublie,
      surResultat: (v) => {
        if (actif) setNouvelle(v);
      },
    });
    const lancer = () => void verifier();
    lancer();
    document.addEventListener('visibilitychange', lancer);
    window.addEventListener('pageshow', lancer);
    const t = window.setInterval(lancer, INTERVALLE_VERIF_MS);
    return () => {
      actif = false;
      document.removeEventListener('visibilitychange', lancer);
      window.removeEventListener('pageshow', lancer);
      window.clearInterval(t);
    };
  }, []);

  return nouvelle;
}
