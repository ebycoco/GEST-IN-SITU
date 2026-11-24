// Briques d'interface communes (barre du haut, bandeaux, badges, champ telephone).
import { useEffect, useState, type ReactNode } from 'react';
import type { Message } from './lib/codes';
import { badgeFor, type Carte } from './lib/cards';
import { formatPhoneInput, phoneDigits } from './lib/masks';
import logoGis from './assets/logo-gis.png';

/** Etat reseau du navigateur ; ecouteurs retires au demontage. */
export function useEnLigne(): boolean {
  const [enLigne, setEnLigne] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  useEffect(() => {
    const on = () => setEnLigne(true);
    const off = () => setEnLigne(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return enLigne;
}

export function Barre(props: {
  titre: string;
  sousTitre?: string;
  onRetour?: () => void;
  retourLabel?: string;
  onDeconnexion: () => void;
  bloque?: boolean;
}) {
  return (
    <header className="barre">
      <div className="marque">
        <img src={logoGis} alt="" aria-hidden="true" width={36} height={36} decoding="async" />
        <span className="appnom">GEST-IN-SITU</span>
      </div>
      <button className="deco" type="button" onClick={props.onDeconnexion} disabled={props.bloque}>
        Se déconnecter
      </button>
      {props.onRetour && (
        <button className="retour" type="button" aria-label={props.retourLabel ?? 'Retour'} onClick={props.onRetour} disabled={props.bloque}>
          ‹
        </button>
      )}
      <div className="bt">
        <b>{props.titre}</b>
        {props.sousTitre && <span>{props.sousTitre}</span>}
      </div>
    </header>
  );
}

export function BandeHorsLigne({ enLigne }: { enLigne: boolean }) {
  if (enLigne) return null;
  return (
    <div className="horsligne" role="status">
      Hors-ligne : Internet est obligatoire pour rechercher et délivrer.
    </div>
  );
}

const ICO: Record<Message['variante'], string> = { err: '!', warn: '!', info: 'i', off: '×', ok: '✓' };

export function Bandeau({ m, role = 'alert' }: { m: Message; role?: 'alert' | 'status' }) {
  return (
    <div className={`bandeau b-${m.variante}`} role={role}>
      <span className="ico" aria-hidden="true">{ICO[m.variante]}</span>
      <div>
        <b>{m.titre}</b>
        <p>{m.texte}</p>
      </div>
    </div>
  );
}

export function Badge({ c }: { c: Pick<Carte, 'statut' | 'statut_physique'> }) {
  const b = badgeFor(c);
  return <span className={`badge ${b.cls}`}>{b.texte}</span>;
}

export function Pied({ children }: { children: ReactNode }) {
  return <footer className="pied">{children}</footer>;
}

/** Champ telephone : prefixe +225 fixe, 10 chiffres groupes par 2, compteur. */
export function ChampTelephone(props: {
  id: string;
  label: string;
  chiffres: string;
  onChange: (chiffres: string) => void;
  disabled?: boolean;
}) {
  const n = props.chiffres.length;
  return (
    <div className="champ">
      <label htmlFor={props.id}>{props.label}</label>
      <div className="tel-groupe">
        <span className="prefixe" aria-hidden="true">+225</span>
        <input
          id={props.id}
          className="saisie"
          type="tel"
          inputMode="tel"
          autoComplete="off"
          maxLength={18}
          placeholder="01 02 03 04 05"
          value={formatPhoneInput(props.chiffres)}
          onChange={(e) => props.onChange(phoneDigits(e.target.value))}
          disabled={props.disabled}
          aria-describedby={`${props.id}-aide`}
        />
      </div>
      <span className="aide" id={`${props.id}-aide`}>
        10 chiffres. {n} / 10 {n === 10 ? '✓' : 'saisis.'}
      </span>
    </div>
  );
}
