// Ecran 1 (maquettes 1a-1d) et ecran 7 (verrou d'inactivite).
import { useRef, useState, type FormEvent, type RefObject } from 'react';
import { connecter, type SessionInfo } from '../lib/api';
import { messageConnexion, type Message } from '../lib/codes';
import { Bandeau, Pied } from '../ui';

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
          autoComplete="current-password"
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

export function EcranConnexion(props: { avis: Message | null; onConnecte: (s: SessionInfo) => void }) {
  const [login, setLogin] = useState('');
  const [mdp, setMdp] = useState('');
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<Message | null>(props.avis);
  const [errChamps, setErrChamps] = useState(false);
  const mdpRef = useRef<HTMLInputElement>(null);

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
    <form className="app" onSubmit={soumettre} noValidate>
      <main className="corps centre">
        <div className="logo">
          <div className="pastille" aria-hidden="true">GIS</div>
          <h1>GESTION CARTES IN-SITU</h1>
          <p>Système de Gestion des Cartes CMU</p>
        </div>
        {erreur && <Bandeau m={erreur} />}
        <div className="champ">
          <label htmlFor="login">Identifiant</label>
          <input
            id="login"
            className={`saisie${errChamps ? ' err' : ''}`}
            type="text"
            autoComplete="username"
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
}) {
  const [mdp, setMdp] = useState('');
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<Message | null>(null);
  const mdpRef = useRef<HTMLInputElement>(null);

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
