// Ecran 1 (maquettes 1a-1d) et ecran 7 (verrou d'inactivite).
//
// TELEPHONE PARTAGE (audit E6 P1-1) : le mot de passe ne doit pas etre enregistre ni
// pre-rempli par le navigateur.
//  - identifiant : autoComplete="off" (pas de liste d'identifiants proposee) ;
//  - mot de passe : autoComplete="new-password" : valeur recommandee (MDN « How to turn off
//    form autocompletion ») pour empecher le PRE-REMPLISSAGE d'un mot de passe enregistre,
//    les navigateurs ignorant autocomplete="off" sur un champ de mot de passe.
//  - Limite connue : aucun attribut standard n'interdit a Chrome de PROPOSER l'enregistrement
//    apres une connexion reussie (sa detection marche aussi sans balise <form>). Les
//    contournements (champ type="text" masque par CSS, nom de champ aleatoire) feraient
//    apprendre le mot de passe au clavier du telephone ou casseraient l'accessibilite :
//    ecartes. La parade fiable est une consigne d'exploitation (mobile/README.md) :
//    desactiver « Proposer d'enregistrer les mots de passe » dans Chrome Android.
//  - La balise <form> est gardee : touche Entree du clavier = « Se connecter ».
import { useEffect, useRef, useState, type FormEvent, type ReactNode, type RefObject } from 'react';
import { connecter, type SessionInfo } from '../lib/api';
import { messageConnexion, type Message } from '../lib/codes';
import { Bandeau, Pied } from '../ui';
import logoGis from '../assets/logo-gis.png';

function ChampMotDePasse(props: { id: string; valeur: string; onChange: (v: string) => void; disabled: boolean; err: boolean; inputRef: RefObject<HTMLInputElement | null> }) {
  const [voir, setVoir] = useState(false);
  return (
    <div className="champ">
      <label htmlFor={props.id}>Mot de passe</label>
      <div className="mdp">
        <input
          ref={props.inputRef}
          id={props.id}
          className={`saisie${props.err ? ' err' : ''}`}
          type={voir ? 'text' : 'password'}
          autoComplete="new-password"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="Entrez votre mot de passe"
          value={props.valeur}
          onChange={(e) => props.onChange(e.target.value)}
          disabled={props.disabled}
        />
        <button className="oeil" type="button" onClick={() => setVoir((v) => !v)} aria-label={voir ? 'Masquer le mot de passe' : 'Afficher le mot de passe'} disabled={props.disabled}>
          {voir ? 'Cacher' : 'Voir'}
        </button>
      </div>
    </div>
  );
}

/** Etat signale a App pour la mise a jour : ne jamais recharger pendant 'envoi'. */
export type EtatFormulaire = 'vide' | 'saisie' | 'envoi';

export function EcranConnexion(props: {
  avis: Message | null;
  onConnecte: (s: SessionInfo) => void;
  onEtat: (e: EtatFormulaire) => void;
  miseAJour?: ReactNode;
}) {
  const [login, setLogin] = useState('');
  const [mdp, setMdp] = useState('');
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<Message | null>(props.avis);
  const [errChamps, setErrChamps] = useState(false);
  const mdpRef = useRef<HTMLInputElement>(null);
  const { onEtat } = props;
  // Un message affiche (avis de deconnexion, erreur) compte comme contenu a preserver.
  const etat: EtatFormulaire = envoi ? 'envoi' : login !== '' || mdp !== '' || erreur !== null ? 'saisie' : 'vide';
  useEffect(() => onEtat(etat), [etat, onEtat]);

  async function soumettre(e: FormEvent) {
    e.preventDefault();
    if (envoi || login.trim() === '' || mdp === '') return;
    setEnvoi(true);
    setErreur(null);
    const r = await connecter(login, mdp);
    if (r.ok) {
      setMdp('');
      props.onConnecte(r.session);
      return;
    }
    setEnvoi(false);
    setErreur(messageConnexion(r.issue));
    setErrChamps(r.issue.kind === 'invalid');
    // Comme Windows (setPassword('')) : mot de passe vide et focus dessus.
    setMdp('');
    setTimeout(() => mdpRef.current?.focus(), 0);
  }

  return (
    <form className="app connexion" onSubmit={soumettre} noValidate>
      <div className="hero">
        <img className="logo-img" src={logoGis} alt="" aria-hidden="true" width={96} height={96} decoding="async" />
        <h1>GESTION CARTES IN-SITU</h1>
        <p>Système de Gestion des Cartes CMU</p>
      </div>
      <main className="corps">
        {props.miseAJour}
        <div className="carte-form">
        {erreur && <Bandeau m={erreur} />}
        <div className="champ">
          <label htmlFor="login">Identifiant</label>
          <input
            id="login"
            className={`saisie${errChamps ? ' err' : ''}`}
            type="text"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="Entrez votre identifiant"
            value={login}
            onChange={(e) => setLogin(e.target.value)}
            disabled={envoi}
          />
        </div>
        <ChampMotDePasse id="mdp" valeur={mdp} onChange={setMdp} disabled={envoi} err={errChamps} inputRef={mdpRef} />
        </div>
      </main>
      <Pied>
        <button className="btn btn-soleil" type="submit" disabled={envoi || login.trim() === '' || mdp === ''}>
          {envoi ? (<><span className="spin" aria-hidden="true" /> Connexion...</>) : 'Se connecter'}
        </button>
        <div className="version">Connexion Internet requise · v1</div>
      </Pied>
    </form>
  );
}

/**
 * Verrou : la session a deja ete fermee (signOut local) ; deverrouiller = nouvelle
 * connexion par mot de passe, pour le MEME compte (sync_id du jeton compare).
 */
export function EcranVerrou(props: {
  login: string;
  syncId: string;
  raison: 'inactivite' | 'session';
  onDeverrouille: (s: SessionInfo) => void;
  onDeconnexion: () => void;
  onEtat: (e: EtatFormulaire) => void;
  miseAJour?: ReactNode;
}) {
  const [mdp, setMdp] = useState('');
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<Message | null>(null);
  const mdpRef = useRef<HTMLInputElement>(null);
  const { onEtat } = props;
  const etat: EtatFormulaire = envoi ? 'envoi' : mdp !== '' ? 'saisie' : 'vide';
  useEffect(() => onEtat(etat), [etat, onEtat]);

  async function soumettre(e: FormEvent) {
    e.preventDefault();
    if (envoi || mdp === '') return;
    setEnvoi(true);
    setErreur(null);
    const r = await connecter(props.login, mdp, props.syncId);
    setMdp('');
    if (r.ok) {
      props.onDeverrouille(r.session);
      return;
    }
    setEnvoi(false);
    setErreur(messageConnexion(r.issue));
    setTimeout(() => mdpRef.current?.focus(), 0);
  }

  return (
    <form className="app verrou" onSubmit={soumettre} noValidate>
      <main className="corps centre">
        {props.miseAJour}
        <div className="cadenas" aria-hidden="true">🔒</div>
        <div>
          <h1>Session verrouillée</h1>
          <p className="sous">
            {props.raison === 'inactivite' ? 'Aucune activité depuis 15 minutes.' : 'Votre session a expiré.'}
            <br />
            Saisissez votre mot de passe pour continuer.
          </p>
        </div>
        <div className="ident-v">
          <span>Identifiant</span>
          <b>{props.login}</b>
        </div>
        {erreur && <Bandeau m={erreur} />}
        <ChampMotDePasse id="mdp-v" valeur={mdp} onChange={setMdp} disabled={envoi} err={false} inputRef={mdpRef} />
      </main>
      <footer className="pied">
        <button className="btn btn-soleil" type="submit" disabled={envoi || mdp === ''}>
          {envoi ? (<><span className="spin" aria-hidden="true" /> Vérification...</>) : 'Déverrouiller'}
        </button>
        <button className="btn deco-v" type="button" onClick={props.onDeconnexion} disabled={envoi}>
          Se déconnecter
        </button>
      </footer>
    </form>
  );
}
