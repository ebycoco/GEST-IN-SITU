// Enchainement des ecrans du client telephone (OPERATEUR_VERIFICATION, v1).
//
// Etat : uniquement en memoire React (aucun localStorage / IndexedDB pour les cartes).
// Deconnexion = signOut local + client jete + tout l'etat remis a zero.
// Verrou (15 min, ou session expiree) = session fermee + donnees de cartes effacees ;
// seule exception : le contexte d'un « resultat inconnu » (carte, retirant, criteres,
// request_id) est garde en memoire, non affiche, pour imposer « Verifier » au retour.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { delivrer, fermerSession, rechercher, type Appel, type Criteres, type EchecAppel, type ReponseRetrait, type SessionInfo } from './lib/api';
import { etatFiche, type Carte, type ResultatRecherche } from './lib/cards';
import { messageRetrait, type Message } from './lib/codes';
import { RequestIdKeeper, SendGuard } from './lib/delivery';
import { IdleClock } from './lib/idleLock';
import { formatPhoneFull } from './lib/masks';
import { EcranConnexion, EcranVerrou } from './screens/Connexion';
import { EcranFiche, titreFiche } from './screens/Fiche';
import { EcranRecherche, EcranResultats, FORM_RECHERCHE_VIDE, type FormRecherche } from './screens/Recherche';
import {
  EcranFormRetrait,
  EcranInconnu,
  EcranRecap,
  EcranRefus,
  EcranSucces,
  formRetraitInitial,
  utiliseNumeroFiche,
  type FormRetrait,
} from './screens/Retrait';
import { BandeHorsLigne, Barre, useEnLigne } from './ui';

type Vue =
  | { v: 'recherche' }
  | { v: 'resultats' }
  | { v: 'fiche'; carte: Carte }
  | { v: 'form'; carte: Carte }
  | { v: 'recap'; carte: Carte }
  | { v: 'succes'; carte: Carte; date: string | null }
  | { v: 'refus'; carte: Carte | null; code: string; date: string | null }
  | { v: 'inconnu' };

interface ContexteInconnu {
  carte: Carte;
  form: FormRetrait;
  criteres: Criteres;
}

const MSG_HORS_LIGNE_RECHERCHE: Message = {
  titre: 'Hors-ligne',
  texte: 'La recherche n\'a pas pu être envoyée. Vérifiez votre connexion puis réessayez.',
  variante: 'off',
};
const MSG_AUCUN: Message = {
  titre: 'Aucune carte trouvée',
  texte: 'Vérifiez l\'orthographe du nom et la date, ou essayez la recherche par téléphone.',
  variante: 'info',
};
const MSG_SERVEUR: Message = {
  titre: 'Service indisponible',
  texte: 'Le serveur n\'a pas répondu correctement. Réessayez dans un instant.',
  variante: 'err',
};
const MSG_PARAM_RECHERCHE: Message = {
  titre: 'Recherche incomplète',
  texte: 'Saisissez le nom et une date de naissance valide, ou un numéro de 10 chiffres.',
  variante: 'warn',
};

export function App() {
  const enLigne = useEnLigne();
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [verrou, setVerrou] = useState<null | 'inactivite' | 'session'>(null);
  const [avisConnexion, setAvisConnexion] = useState<Message | null>(null);
  const [vue, setVue] = useState<Vue>({ v: 'recherche' });

  const [formRecherche, setFormRecherche] = useState<FormRecherche>(FORM_RECHERCHE_VIDE);
  const [criteres, setCriteres] = useState<Criteres | null>(null);
  const [resultats, setResultats] = useState<ResultatRecherche | null>(null);
  const [msgRecherche, setMsgRecherche] = useState<Message | null>(null);
  const [envoiRecherche, setEnvoiRecherche] = useState(false);

  const [formRetrait, setFormRetrait] = useState<FormRetrait | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [avisRecap, setAvisRecap] = useState<Message | null>(null);

  const [inconnu, setInconnu] = useState<ContexteInconnu | null>(null);
  const [verif, setVerif] = useState(false);
  const [avisInconnu, setAvisInconnu] = useState<Message | null>(null);
  const [inconnuRepondu, setInconnuRepondu] = useState(false);

  const horloge = useRef(new IdleClock());
  const requetes = useRef(new RequestIdKeeper());
  const garde = useRef(new SendGuard());

  /** Efface toutes les donnees de cartes affichables. */
  const effacerCartes = useCallback((garderInconnu: boolean) => {
    setFormRecherche(FORM_RECHERCHE_VIDE);
    setResultats(null);
    setMsgRecherche(null);
    setFormRetrait(null);
    setAvisRecap(null);
    setAvisInconnu(null);
    if (!garderInconnu) {
      setCriteres(null);
      setInconnu(null);
      setInconnuRepondu(false);
      requetes.current.clear();
    }
  }, []);

  const deconnecter = useCallback(
    async (avis: Message | null = null) => {
      if (garde.current.inFlight) return; // jamais pendant un envoi (bouton grise aussi)
      await fermerSession();
      effacerCartes(false);
      setVue({ v: 'recherche' });
      setVerrou(null);
      setSession(null);
      setAvisConnexion(avis);
    },
    [effacerCartes],
  );

  const verrouiller = useCallback(
    async (raison: 'inactivite' | 'session', garderInconnu: boolean) => {
      await fermerSession();
      effacerCartes(garderInconnu);
      setVue(garderInconnu ? { v: 'inconnu' } : { v: 'recherche' });
      setVerrou(raison);
    },
    [effacerCartes],
  );

  // ---- Verrou d'inactivite (Q4) : activite = toucher / clavier ; controle toutes les
  // 15 s et au retour au premier plan (minuteries suspendues en arriere-plan).
  useEffect(() => {
    if (!session || verrou) return;
    const clock = horloge.current;
    clock.touch();
    const activite = () => clock.touch();
    const controle = () => {
      if (clock.shouldLock()) void verrouiller('inactivite', inconnu !== null);
    };
    const visible = () => {
      if (document.visibilityState === 'visible') controle();
    };
    window.addEventListener('pointerdown', activite, { passive: true });
    window.addEventListener('keydown', activite);
    document.addEventListener('visibilitychange', visible);
    const t = window.setInterval(controle, 15_000);
    return () => {
      window.removeEventListener('pointerdown', activite);
      window.removeEventListener('keydown', activite);
      document.removeEventListener('visibilitychange', visible);
      window.clearInterval(t);
    };
  }, [session, verrou, verrouiller, inconnu]);

  /** Echec commun (hors reponse metier) ; renvoie le message a afficher, ou null si deja traite. */
  const traiterEchec = useCallback(
    (e: EchecAppel, garderInconnu: boolean): Message | null => {
      if (e === 'session') {
        void verrouiller('session', garderInconnu);
        return null;
      }
      if (e === 'role') {
        void deconnecter(messageRetrait('ROLE_NON_AUTORISE'));
        return null;
      }
      if (e === 'reseau') return MSG_HORS_LIGNE_RECHERCHE;
      return MSG_SERVEUR;
    },
    [verrouiller, deconnecter],
  );

  // ---- Recherche
  async function lancerRecherche(cr: Criteres) {
    if (envoiRecherche) return;
    setEnvoiRecherche(true);
    setMsgRecherche(null);
    const r = await rechercher(cr);
    setEnvoiRecherche(false);
    if (!r.ok) {
      setMsgRecherche(traiterEchec(r.echec, false));
      return;
    }
    const d = r.data;
    if (d.code === 'COMPTE_INACTIF') {
      setVue({ v: 'refus', carte: null, code: 'COMPTE_INACTIF', date: null });
      return;
    }
    if (d.code === 'PARAMETRES_INVALIDES') return setMsgRecherche(MSG_PARAM_RECHERCHE);
    if (d.code !== 'OK') return setMsgRecherche(MSG_SERVEUR);
    if (d.resultats.length === 0) return setMsgRecherche(MSG_AUCUN);
    setCriteres(cr);
    setResultats(d);
    setVue({ v: 'resultats' });
  }

  function nouvelleRecherche() {
    effacerCartes(false);
    setVue({ v: 'recherche' });
  }

  // ---- Retrait
  function appliquerReponse(carte: Carte, form: FormRetrait, rep: ReponseRetrait, cr: Criteres | null) {
    if (rep.code === 'OK') {
      requetes.current.clear();
      setInconnu(null);
      setVue({ v: 'succes', carte, date: rep.dateDelivrance });
      return;
    }
    if (rep.code === 'REPONSE_ILLISIBLE') {
      // Reponse sans code : on ne sait pas si l'ecriture a eu lieu -> « Verifier ».
      if (cr) setInconnu({ carte, form, criteres: cr });
      setVue({ v: 'inconnu' });
      return;
    }
    requetes.current.clear(); // reponse definitive : rien n'a ete ecrit
    setInconnu(null);
    setVue({ v: 'refus', carte, code: rep.code, date: rep.dateDelivrance });
  }

  function demande(carte: Carte, form: FormRetrait) {
    return {
      syncId: carte.sync_id,
      type: form.type,
      nomRetirant: form.nom.trim().replace(/\s+/g, ' ').toUpperCase(),
      telRetirant: utiliseNumeroFiche(carte, form) ? '' : form.tel,
      rangementUrgence: carte.non_classee ? form.rangement.trim().toUpperCase() : '',
      requestId: requetes.current.forCard(carte.sync_id),
    };
  }

  async function envoyer<T>(fn: () => Promise<Appel<T>>) {
    horloge.current.setSuspended(true);
    setEnvoi(true);
    try {
      return await garde.current.run(fn);
    } finally {
      setEnvoi(false);
      horloge.current.setSuspended(false);
    }
  }

  async function confirmer(carte: Carte, form: FormRetrait) {
    if (garde.current.inFlight || !navigator.onLine) return;
    setAvisRecap(null);
    const cr = criteres;
    const res = await envoyer(() => delivrer(demande(carte, form)));
    if (res.skipped) return;
    const r = res.value;
    if (r.ok) return appliquerReponse(carte, form, r.data, cr);
    if (r.echec === 'role') {
      // 42501 leve avant toute ecriture
      requetes.current.clear();
      void deconnecter(messageRetrait('ROLE_NON_AUTORISE'));
      return;
    }
    if (r.echec === 'occupee') {
      // 55P03 (verrou de ligne > 3 s) : rien n'est ecrit ; meme request_id pour la reprise.
      setAvisRecap(messageRetrait('OCCUPEE'));
      return;
    }
    // reseau / session / serveur : l'ecriture a peut-etre eu lieu -> « Resultat inconnu ».
    if (cr) setInconnu({ carte, form, criteres: cr });
    setInconnuRepondu(false);
    setAvisInconnu(null);
    setVue({ v: 'inconnu' });
    if (r.echec === 'session') void verrouiller('session', true);
  }

  /**
   * « Verifier » (6c) : relance la recherche et relit la carte.
   *  - EN STOCK  -> recapitulatif, MEME request_id, l'agent reconfirme lui-meme ;
   *  - DELIVRE   -> appel de fn_mobile_delivrer_carte avec le MEME request_id : la carte
   *    etant deja DELIVRE, le serveur n'ecrit rien (controle DEJA_DELIVREE avant toute
   *    ecriture, 0020 l.478-493) et dit si ce retrait est le sien (OK "reessai") ou non ;
   *  - autre     -> fiche a jour.
   */
  async function verifier() {
    const ctx = inconnu;
    if (!ctx || verif) return;
    setVerif(true);
    setAvisInconnu(null);
    try {
      const r = await rechercher(ctx.criteres);
      if (!r.ok) {
        setAvisInconnu(traiterEchec(r.echec, true));
        return;
      }
      if (r.data.code === 'COMPTE_INACTIF') {
        setVue({ v: 'refus', carte: null, code: 'COMPTE_INACTIF', date: null });
        return;
      }
      const c = r.data.code === 'OK' ? r.data.resultats.find((x) => x.sync_id === ctx.carte.sync_id) : undefined;
      if (!c) {
        setAvisInconnu({
          titre: 'Carte non retrouvée',
          texte: 'La recherche ne renvoie plus cette carte. Ne remettez pas la carte et contactez votre administrateur.',
          variante: 'warn',
        });
        setInconnuRepondu(true);
        return;
      }
      if (c.statut === 'DELIVRE') {
        const d = await envoyer(() => delivrer(demande(c, ctx.form)));
        if (d.skipped) return;
        if (!d.value.ok) {
          setAvisInconnu(traiterEchec(d.value.echec, true));
          return;
        }
        const code = d.value.data.code;
        if (code === 'OK' || code === 'DEJA_DELIVREE') {
          appliquerReponse(c, ctx.form, d.value.data, ctx.criteres);
        } else {
          // Ex. HORS_CENTRE : carte non classee dont le centre a ete recalcule par CE
          // retrait. On montre la preuve (date, retirant) pour que l'agent juge.
          requetes.current.clear();
          setInconnu(null);
          setVue({ v: 'fiche', carte: c });
        }
        return;
      }
      setInconnu(null);
      if (etatFiche(c) === 'DELIVRABLE') {
        setFormRetrait(ctx.form);
        setAvisRecap({
          titre: 'Retrait non enregistré',
          texte: 'La carte est toujours EN STOCK. Vérifiez le récapitulatif puis confirmez à nouveau.',
          variante: 'warn',
        });
        setVue({ v: 'recap', carte: c });
      } else {
        requetes.current.clear();
        setVue({ v: 'fiche', carte: c });
      }
    } finally {
      setVerif(false);
    }
  }

  async function voirPreuve(carte: Carte) {
    if (!criteres) return nouvelleRecherche();
    const r = await rechercher(criteres);
    if (r.ok && r.data.code === 'OK') {
      const c = r.data.resultats.find((x) => x.sync_id === carte.sync_id);
      if (c) {
        setResultats(r.data);
        setVue({ v: 'fiche', carte: c });
        return;
      }
    }
    if (!r.ok) traiterEchec(r.echec, false);
  }

  // ---- Rendu
  if (!session) {
    return <EcranConnexion key={avisConnexion?.titre ?? 'connexion'} avis={avisConnexion} onConnecte={(s) => { setAvisConnexion(null); setSession(s); setVue({ v: 'recherche' }); }} />;
  }
  if (verrou) {
    return (
      <EcranVerrou
        login={session.login}
        syncId={session.claims.syncId}
        raison={verrou}
        onDeverrouille={(s) => {
          setSession(s);
          setVerrou(null);
          horloge.current.touch();
        }}
        onDeconnexion={() => void deconnecter()}
      />
    );
  }

  const qui = `${session.login} · ${session.centreNom ?? (session.claims.centreId !== null ? `Centre n° ${session.claims.centreId}` : 'Sans centre')}`;
  const deco = () => void deconnecter();
  const retourResultats = () => setVue(resultats ? { v: 'resultats' } : { v: 'recherche' });

  let barre: { titre: string; sous?: string; retour?: () => void; retourLabel?: string };
  let contenu: ReactNode;

  switch (vue.v) {
    case 'recherche':
      barre = { titre: 'Recherche de carte', sous: qui };
      contenu = (
        <EcranRecherche
          form={formRecherche}
          setForm={(f) => { setFormRecherche(f); if (msgRecherche) setMsgRecherche(null); }}
          message={msgRecherche}
          envoi={envoiRecherche}
          onRechercher={(cr) => void lancerRecherche(cr)}
        />
      );
      break;
    case 'resultats': {
      const n = resultats?.resultats.length ?? 0;
      const cr = criteres;
      barre = {
        titre: `${n} résultat${n > 1 ? 's' : ''}`,
        sous: cr ? (cr.mode === 'NOM' ? `${cr.nom} · ${cr.ddnAffiche}` : formatPhoneFull(cr.tel)) : undefined,
        retour: () => setVue({ v: 'recherche' }),
        retourLabel: 'Retour à la recherche',
      };
      contenu = resultats ? <EcranResultats res={resultats} onOuvrir={(c) => setVue({ v: 'fiche', carte: c })} /> : null;
      break;
    }
    case 'fiche': {
      const t = titreFiche(vue.carte);
      barre = { titre: t.titre, sous: t.sous, retour: retourResultats, retourLabel: 'Retour aux résultats' };
      contenu = (
        <EcranFiche
          carte={vue.carte}
          onRetour={retourResultats}
          onJaiLaCarte={() => {
            requetes.current.clear();
            setFormRetrait(formRetraitInitial(vue.carte));
            setVue({ v: 'form', carte: vue.carte });
          }}
        />
      );
      break;
    }
    case 'form': {
      const f = formRetrait ?? formRetraitInitial(vue.carte);
      barre = {
        titre: 'Validation du Retrait',
        sous: `Étape 1 / 2 · ${`${vue.carte.noms} ${vue.carte.prenoms}`.trim()}`,
        retour: () => setVue({ v: 'fiche', carte: vue.carte }),
        retourLabel: 'Retour à la fiche',
      };
      contenu = (
        <EcranFormRetrait
          carte={vue.carte}
          form={f}
          setForm={setFormRetrait}
          onContinuer={() => { setAvisRecap(null); setVue({ v: 'recap', carte: vue.carte }); }}
        />
      );
      break;
    }
    case 'recap': {
      const f = formRetrait ?? formRetraitInitial(vue.carte);
      barre = {
        titre: 'Récapitulatif',
        sous: envoi ? 'Envoi au cloud en cours…' : 'Étape 2 / 2 · vérifiez avant d\'envoyer',
        retour: () => setVue({ v: 'form', carte: vue.carte }),
        retourLabel: 'Modifier',
      };
      contenu = (
        <EcranRecap
          carte={vue.carte}
          form={f}
          envoi={envoi}
          avis={avisRecap}
          enLigne={enLigne}
          onConfirmer={() => void confirmer(vue.carte, f)}
          onModifier={() => setVue({ v: 'form', carte: vue.carte })}
        />
      );
      break;
    }
    case 'succes':
      barre = { titre: 'Retrait enregistré', sous: qui };
      contenu = <EcranSucces carte={vue.carte} form={formRetrait ?? formRetraitInitial(vue.carte)} date={vue.date} onNouvelle={nouvelleRecherche} />;
      break;
    case 'refus': {
      const carte = vue.carte;
      barre = { titre: 'Retrait refusé', sous: 'Aucune modification enregistrée' };
      contenu = (
        <EcranRefus
          code={vue.code}
          date={vue.date}
          onVoirPreuve={carte ? () => void voirPreuve(carte) : undefined}
          onCorriger={carte ? () => setVue({ v: 'form', carte }) : undefined}
          onNouvelle={nouvelleRecherche}
          onDeconnexion={deco}
        />
      );
      break;
    }
    case 'inconnu':
      barre = { titre: 'Résultat inconnu', sous: 'La connexion a été coupée' };
      contenu = (
        <EcranInconnu
          verif={verif || envoi}
          avis={avisInconnu}
          onVerifier={() => void verifier()}
          onNouvelle={inconnuRepondu || !inconnu ? nouvelleRecherche : undefined}
        />
      );
      break;
  }

  return (
    <div className="app">
      <Barre
        titre={barre.titre}
        sousTitre={barre.sous}
        onRetour={barre.retour}
        retourLabel={barre.retourLabel}
        onDeconnexion={deco}
        bloque={envoi}
      />
      <BandeHorsLigne enLigne={enLigne} />
      {contenu}
    </div>
  );
}
