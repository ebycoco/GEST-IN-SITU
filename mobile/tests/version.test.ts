import { describe, expect, it, vi } from 'vitest';
import swSource from '../public/sw.js?raw';
import { effacerStockage } from '../src/lib/stockageSession';
import {
  DELAI_MIN_VERIF_MS,
  PARAM_VERIF,
  autoDejaTente,
  creerVerificateur,
  deciderMiseAJour,
  reserverRechargement,
  signatureDe,
  signatureDuHtml,
  type Ecran,
  type EtatMiseAJour,
} from '../src/lib/version';
import { fauxMagasin } from './fauxMagasin';

const page = (js: string, css = 'Dp5BQqwd') => `<!doctype html><html><head>
  <link rel="manifest" href="/manifest.webmanifest">
  <link rel="icon" href="/icons/favicon-32.png" type="image/png">
  <script type="module" crossorigin src="/assets/index-${js}.js"></script>
  <link rel="stylesheet" crossorigin href="/assets/index-${css}.css">
</head><body><div id="root"></div></body></html>`;
const sig = (js: string, css?: string) => signatureDuHtml(page(js, css)) as string;

describe('signature de version', () => {
  it('extrait script et feuille de style d\'entree, comme la page chargee', () => {
    expect(sig('jOQiIftZ')).toBe('/assets/index-Dp5BQqwd.css|/assets/index-jOQiIftZ.js');
    expect(signatureDe(['/assets/index-jOQiIftZ.js', '/assets/index-Dp5BQqwd.css', 'chrome-extension://x/y.js', null])).toBe(sig('jOQiIftZ'));
  });
  it('change si le script OU le CSS seul change', () => {
    expect(sig('AAAA')).not.toBe(sig('BBBB'));
    expect(sig('AAAA', 'c1')).not.toBe(sig('AAAA', 'c2'));
    expect(sig('a_b-C9')).toContain('/assets/index-a_b-C9.js');
  });
  it('page inattendue (portail, erreur, developpement) : null', () => {
    expect(signatureDuHtml('')).toBeNull();
    expect(signatureDuHtml('<html><body>Connectez-vous au wifi</body></html>')).toBeNull();
    expect(signatureDuHtml('<script type="module" src="/src/main.tsx"></script>')).toBeNull();
    expect(signatureDuHtml('<link rel="stylesheet" href="/assets/index-x.css">')).toBeNull();
    expect(signatureDuHtml('<!-- <script src="/assets/index-x.js"></script> -->')).toBeNull();
  });
});

describe('verification', () => {
  function banc(lire: () => Promise<string | null>) {
    const etat = { t: 1_000_000, visible: true, enLigne: true };
    const lireIndex = vi.fn(lire);
    const surResultat = vi.fn();
    const verifier = creerVerificateur({
      actuelle: sig('AAAA'),
      maintenant: () => etat.t,
      visible: () => etat.visible,
      enLigne: () => etat.enLigne,
      lireIndex,
      surResultat,
    });
    return { etat, lireIndex, surResultat, verifier };
  }
  it('autre version signalee ; meme version : null', async () => {
    let js = 'BBBB';
    const b = banc(async () => page(js));
    await b.verifier();
    expect(b.surResultat).toHaveBeenLastCalledWith(sig('BBBB'));
    js = 'AAAA';
    b.etat.t += DELAI_MIN_VERIF_MS;
    await b.verifier();
    expect(b.surResultat).toHaveBeenLastCalledWith(null);
  });
  it('masquee ou hors ligne : aucune requete', async () => {
    const b = banc(async () => page('BBBB'));
    b.etat.visible = false;
    await b.verifier();
    b.etat.visible = true;
    b.etat.enLigne = false;
    await b.verifier();
    expect(b.lireIndex).not.toHaveBeenCalled();
  });
  it('delai minimal entre deux verifications ; horloge reculee acceptee', async () => {
    const b = banc(async () => page('BBBB'));
    await b.verifier();
    b.etat.t += DELAI_MIN_VERIF_MS - 1;
    await b.verifier();
    expect(b.lireIndex).toHaveBeenCalledTimes(1);
    b.etat.t += 1;
    await b.verifier();
    expect(b.lireIndex).toHaveBeenCalledTimes(2);
    b.etat.t -= 3_600_000;
    await b.verifier();
    expect(b.lireIndex).toHaveBeenCalledTimes(3);
  });
  it('un seul appel a la fois', async () => {
    let repondre: (v: string) => void = () => undefined;
    const b = banc(() => new Promise<string>((r) => { repondre = r; }));
    const premier = b.verifier();
    b.etat.t += DELAI_MIN_VERIF_MS;
    await b.verifier();
    expect(b.lireIndex).toHaveBeenCalledTimes(1);
    repondre(page('BBBB'));
    await premier;
    expect(b.surResultat).toHaveBeenCalledTimes(1);
  });
  it('erreur reseau, reponse non valide ou illisible : silence', async () => {
    for (const lire of [async () => { throw new TypeError('Failed to fetch'); }, async () => null, async () => '<html></html>']) {
      const b = banc(lire);
      await expect(b.verifier()).resolves.toBeUndefined();
      expect(b.surResultat).not.toHaveBeenCalled();
    }
  });
});

describe('decision', () => {
  const base: EtatMiseAJour = { ecran: 'connexion', enLigne: true, envoiRetrait: false, occupe: false, contexteInconnu: false, saisie: false };
  const d = (e: Partial<EtatMiseAJour>, deja = false) => deciderMiseAJour(true, { ...base, ...e }, deja);

  it('sans nouvelle version : rien', () => {
    expect(deciderMiseAJour(false, base, false)).toBe('rien');
  });
  it('connexion vierge : auto ; saisie ou deja tente : bandeau', () => {
    expect(d({})).toBe('auto');
    expect(d({ saisie: true })).toBe('bandeau');
    expect(d({}, true)).toBe('bandeau');
  });
  it('session ouverte ou verrou sans contexte : bandeau, jamais auto', () => {
    for (const ecran of ['verrou', 'recherche', 'apercu', 'resultats', 'fiche'] satisfies Ecran[]) {
      expect(d({ ecran })).toBe('bandeau');
    }
  });
  it('retrait, resultat et restauration : rien', () => {
    for (const ecran of ['restauration', 'form', 'recap', 'succes', 'refus', 'inconnu'] satisfies Ecran[]) {
      expect(d({ ecran })).toBe('rien');
    }
  });
  it('envoi, operation en cours, contexte inconnu ou hors ligne : rien, sur tout ecran', () => {
    const ecrans: Ecran[] = ['restauration', 'connexion', 'verrou', 'recherche', 'apercu', 'resultats', 'fiche', 'form', 'recap', 'succes', 'refus', 'inconnu'];
    for (const ecran of ecrans) {
      expect(d({ ecran, envoiRetrait: true })).toBe('rien');
      expect(d({ ecran, occupe: true })).toBe('rien');
      expect(d({ ecran, contexteInconnu: true })).toBe('rien');
      expect(d({ ecran, enLigne: false })).toBe('rien');
    }
  });
});

describe('anti-boucle', () => {
  it('un seul rechargement automatique par version, meme apres effacement de session', () => {
    const m = fauxMagasin();
    expect(autoDejaTente('v2', m)).toBe(false);
    expect(reserverRechargement('v2', m)).toBe(true);
    effacerStockage(m); // verrou / deconnexion
    expect(autoDejaTente('v2', m)).toBe(true);
    expect(reserverRechargement('v2', m)).toBe(false);
    expect(reserverRechargement('v3', m)).toBe(true);
    // Versions alternees (serveur incoherent) : pas de va-et-vient.
    expect(reserverRechargement('v2', m)).toBe(false);
  });
  it('stockage absent, qui leve ou qui n\'ecrit pas : jamais de rechargement automatique', () => {
    expect(reserverRechargement('v2', null)).toBe(false);
    expect(autoDejaTente('v2', null)).toBe(true);
    const plein = { ...fauxMagasin(), setItem: () => { throw new Error('QuotaExceededError'); } };
    expect(reserverRechargement('v2', plein)).toBe(false);
    const muet = { ...fauxMagasin(), setItem: () => undefined };
    expect(reserverRechargement('v2', muet)).toBe(false);
    const bloque = { ...fauxMagasin(), getItem: () => { throw new Error('SecurityError'); } };
    expect(autoDejaTente('v2', bloque)).toBe(true);
    expect(reserverRechargement('v2', bloque)).toBe(false);
  });
});

describe('service worker', () => {
  function intercepte(url: string): boolean {
    let ecouteur: ((e: unknown) => void) | undefined;
    const self = {
      location: { origin: 'https://appli.test' },
      addEventListener: (nom: string, f: (e: unknown) => void) => { if (nom === 'fetch') ecouteur = f; },
    };
    const caches = { match: () => Promise.resolve(undefined) };
    new Function('self', 'caches', 'fetch', swSource)(self, caches, () => Promise.resolve(undefined));
    const respondWith = vi.fn();
    ecouteur?.({ request: { method: 'GET', mode: 'cors', url, headers: new Headers() }, respondWith });
    return respondWith.mock.calls.length > 0;
  }
  it('ne repond jamais a la requete de verification (reseau direct)', () => {
    expect(intercepte('https://appli.test/index.html')).toBe(true);
    expect(intercepte(`https://appli.test/index.html?${PARAM_VERIF}=1`)).toBe(false);
  });
});
