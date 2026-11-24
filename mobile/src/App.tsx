// Enchainement des ecrans du client telephone (OPERATEUR_VERIFICATION, v1).
//
// Etat : uniquement en memoire React (aucun localStorage / IndexedDB pour les cartes).
// Deconnexion = signOut local + client jete + tout l'etat remis a zero.
// Verrou (15 min, ou session expiree) = session fermee + donnees de cartes effacees ;
// seule exception : le contexte d'un « resultat inconnu » (carte, retirant, criteres,
// request_id) est garde en memoire, non affiche, pour imposer « Verifier » au retour.
//
// Ordre au verrou / a la deconnexion (audit E6 P2-3) : l'etat est efface et l'ecran de
// verrou / connexion pose AVANT de fermer la session (fermerSession() peut attendre
// jusqu'a 4 s hors ligne) ; fermerSession() met client=null de facon synchrone, donc plus
// aucun appel ne part avec l'ancienne session pendant ce temps.
// Rechargement de la page : la session de l'onglet (sessionStorage, lib/stockageSession.ts)
// est restauree au demarrage (restaurerSession) et le verrou d'inactivite reste effectif :
// l'heure de derniere activite est memorisee (au plus toutes les 5 s) et relue au demarrage.
// Reponses tardives (audit E6 P2-2) : compteur de generation (lib/generation.ts).
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { delivrer, fermerSession, rechercher, restaurerSession, type Appel, type Criteres, type EchecAppel, type ReponseRetrait, type SessionInfo } from './lib/api';
import { etatFiche, type Carte, type ResultatRecherche } from './lib/cards';
import { messageRetrait, type Message } from './lib/codes';
import { RequestIdKeeper, SendGuard } from './lib/delivery';
import { Generation } from './lib/generation';
import { IdleClock } from './lib/idleLock';
import { formatPhoneFull } from './lib/masks';
import { ecrireActivite, sessionPresente } from './lib/stockageSession';
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
  // form = formulaire REELLEMENT envoye (audit E6 P2-1) : jamais reconstruit au rendu.
  | { v: 'succes'; carte: Carte; date: string | null; form: FormRetrait }
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
// COMPTE_INACTIF (audit E6 P2-9) : la deconnexion est faite tout de suite ; ce message
// s'affiche sur l'ecran de connexion.
const MSG_COMPTE_INACTIF: Message = {
  titre: 'Compte désactivé',
  texte: 'Votre compte n\'est plus actif : vous avez été déconnecté. Contactez votre administrateur.',
  variante: 'err',
};

export function App() {
  const enLigne = useEnLigne();
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [verrou, setVerrou] = useState<null | 'inactivite' | 'session'>(null);
  const [avisConnexion, setAvisConnexion] = useState<Message | null>(null);
  const [vue, setVue] = useState<Vue>({ v: 'recherche' });
  // Ecran « Chargement » pendant la restauration d'une session d'onglet (rechargement).
  const [restauration, setRestauration] = useState<boolean>(() => sessionPresente());

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
  const generation = useRef(new Generation());
  const derniereEcriture = useRef(0);

  /** Memorise l'activite pour le verrou apres rechargement ; 1 ecriture / 5 s sauf force. */
  const memoriserActivite = useCallback((force: boolean) => {
    const t = Date.now();
    if (!force && t - derniereEcriture.current < 5_000) return;
    derniereEcriture.current = t;
    ecrireActivite(horloge.current.lastActivity());
  }, []);

  // ---- Restauration de la session au demarrage (page rechargee). Annulable au demontage ;
  // restaurerSession() ne leve jamais et efface tout si la session n'est pas valide.
  useEffect(() => {
    if (!restauration) return;
    let annule = false;
    restaurerSession()
      .then((r) => {
        if (annule) return;
        if (r) {
          horloge.current.restaurer(r.derniereActivite);
          setSession(r.session);
          setVue({ v: 'recherche' });
        }
        setRestauration(false);
      })
      .catch(() => {
        if (!annule) setRestauration(false);
      });
    return () => {
      annule = true;
    };
  }, [restauration]);

  /**
   * Efface toutes les donnees de cartes affichables et invalide les reponses en attente
   * (generation). Les indicateurs « en cours » sont remis a zero ici, car la reponse
   * ignoree ne le fera plus (sinon bouton bloque au retour). envoi (retrait) n'est pas
   * touche : il suit la garde anti double envoi, toujours liberee par envoyer().
   */
  const effacerCartes = useCallback((garderInconnu: boolean) => {
    generation.current.bump();
    setEnvoiRecherche(false);
    setVerif(false);
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
    (avis: Message | null = null) => {
      if (garde.current.inFlight) return; // jamais pendant un envoi (bouton grise aussi)
      // Etat efface et ecran de connexion pose d'abord ; fermeture de session ensuite,
      // sans l'attendre (client=null immediat dans api.ts, signOut borne a 4 s).
      effacerCartes(false);
      setVue({ v: 'recherche' });
      setVerrou(null);
      setSession(null);
      setAvisConnexion(avis);
      void fermerSession();
    },
    [effacerCartes],
  );

  const verrouiller = useCallback(
    (raison: 'inactivite' | 'session', garderInconnu: boolean) => {
      effacerCartes(garderInconnu);
      setVue(garderInconnu ? { v: 'inconnu' } : { v: 'recherche' });
      setVerrou(raison);
      void fermerSession();
    },
    [effacerCartes],
  );

  // ---- Verrou d'inactivite (Q4) : activite = toucher / clavier ; controle toutes les
  // 15 s et au retour au premier plan (minuteries suspendues en arriere-plan).
  useEffect(() => {
    if (!session || verrou) return;
    const clock = horloge.current;
    // Pas de touch() ici : le depart de l'horloge vient de la connexion / du deverrouillage
    // (touch dans leurs rappels) ou de la restauration (activite memorisee, jamais remise a zero).
    const activite = () => {
      clock.touch();
      memoriserActivite(false);
    };
    const controle = () => {
      if (clock.shouldLock()) verrouiller('inactivite', inconnu !== null);
    };
    const visible = () => {
      if (document.visibilityState === 'visible') controle();
      else memoriserActivite(true);
    };
    const quitte = () => memoriserActivite(true);
    window.addEventListener('pointerdown', activite, { passive: true });
    window.addEventListener('keydown', activite);
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('pagehide', quitte);
    const t = window.setInterval(controle, 15_000);
    return () => {
      window.removeEventListener('pointerdown', activite);
      window.removeEventListener('keydown', activite);
      document.removeEventListener('visibilitychange', visible);
      window.removeEventListener('pagehide', quitte);
      window.clearInterval(t);
    };
  }, [session, verrou, verrouiller, inconnu, memoriserActivite]);

  /** Echec commun (hors reponse metier) ; renvoie le message a afficher, ou null si deja traite. */
  const traiterEchec = useCallback(
    (e: EchecAppel, garderInconnu: boolean): Message | null => {
      if (e === 'session') {
        verrouiller('session', garderInconnu);
        return null;
      }
      if (e === 'role') {
        deconnecter(messageRetrait('ROLE_NON_AUTORISE'));
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
    const aJour = generation.current.ticket();
    const r = await rechercher(cr);
    if (!aJour()) return; // deconnexion / verrou / effacement pendant l'appel : ignoree
    setEnvoiRecherche(false);
    if (!r.ok) {
      setMsgRecherche(traiterEchec(r.echec, false));
      return;
    }
    const d = r.data;
    if (d.code === 'COMPTE_INACTIF') return deconnecter(MSG_COMPTE_INACTIF);
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
      // Formulaire envoye remis en etat (le verrou a pu vider formRetrait) et porte par la vue.
      setFormRetrait(form);
      setVue({ v: 'succes', carte, date: rep.dateDelivrance, form });
      return;
    }
    if (rep.code === 'COMPTE_INACTIF') {
      // Reponse definitive levee avant toute ecriture : deconnexion immediate.
      requetes.current.clear();
      deconnecter(MSG_COMPTE_INACTIF);
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
    memoriserActivite(true); // un rechargement pendant l'envoi ne doit pas passer pour de l'inactivite
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
    const aJour = generation.current.ticket();
    const res = await envoyer(() => delivrer(demande(carte, form)));
    if (res.skipped) return;
    // En pratique la generation ne bouge pas pendant un retrait (deconnexion refusee tant
    // que la garde est prise, horloge d'inactivite suspendue) ; si elle a bouge, rien
    // n'est affiche : le request_id serveur rend la reprise sure (« Verifier » / DEJA_DELIVREE).
    if (!aJour()) return;
    const r = res.value;
    if (r.ok) return appliquerReponse(carte, form, r.data, cr);
    if (r.echec === 'role') {
      // 42501 leve avant toute ecriture
      requetes.current.clear();
      deconnecter(messageRetrait('ROLE_NON_AUTORISE'));
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
    if (r.echec === 'session') verrouiller('session', true);
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
    const aJour = generation.current.ticket();
    try {
      const r = await rechercher(ctx.criteres);
      if (!aJour()) return;
      if (!r.ok) {
        setAvisInconnu(traiterEchec(r.echec, true));
        return;
      }
      if (r.data.code === 'COMPTE_INACTIF') return deconnecter(MSG_COMPTE_INACTIF);
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
        if (d.skipped || !aJour()) return;
        if (!d.value.ok) {
          setAvisInconnu(traiterEchec(d.value.echec, true));
          return;
        }
        const code = d.value.data.code;
        if (code === 'OK' || code === 'DEJA_DELIVREE' || code === 'COMPTE_INACTIF') {
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
      // Generation changee : effacerCartes a deja remis verif a false.
      if (aJour()) setVerif(false);
    }
  }

  async function voirPreuve(carte: Carte) {
    if (!criteres) return nouvelleRecherche();
    const aJour = generation.current.ticket();
    const r = await rechercher(criteres);
    if (!aJour()) return;
    if (r.ok && r.data.code === 'COMPTE_INACTIF') return deconnecter(MSG_COMPTE_INACTIF);
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
  if (restauration) {
    return (
      <div className="app">
        <main className="corps centre" role="status" aria-live="polite">
          <p>Chargement…</p>
        </main>
      </div>
    );
  }
  if (!session) {
    return <EcranConnexion key={avisConnexion?.titre ?? 'connexion'} avis={avisConnexion} onConnecte={(s) => { horloge.current.touch(); memoriserActivite(true); setAvisConnexion(null); setSession(s); setVue({ v: 'recherche' }); }} />;
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
          memoriserActivite(true);
        }}
        onDeconnexion={() => deconnecter()}
      />
    );
  }

  const qui = `${session.login} · ${session.centreNom ?? (session.claims.centreId !== null ? `Centre n° ${session.claims.centreId}` : 'Sans centre')}`;
  const deco = () => deconnecter();
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
      contenu = <EcranSucces carte={vue.carte} form={vue.form} date={vue.date} onNouvelle={nouvelleRecherche} />;
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
