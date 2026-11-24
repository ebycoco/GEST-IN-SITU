// Ecran 5 (formulaire 5a/5b, recapitulatif 5c, envoi 5d) et ecran 6 (resultat 6a-6c).
import type { Carte } from '../lib/cards';
import { rangementUrgenceValide } from '../lib/cards';
import { messageRetrait, refusCorrigeable, type Message } from '../lib/codes';
import { formatDateTime, formatIsoDate, formatMaskedContact, formatPhoneFull, normalizeName } from '../lib/masks';
import { Bandeau, ChampTelephone, Pied } from '../ui';

export interface FormRetrait {
  type: 'ASSURE' | 'TIERS';
  nom: string;
  tel: string; // chiffres saisis
  autreNumero: boolean; // ASSURE : saisir un autre numero que celui de la fiche
  rangement: string; // rangement d'urgence (carte non classee)
}

export function formRetraitInitial(c: Carte): FormRetrait {
  return { type: 'ASSURE', nom: `${c.noms} ${c.prenoms}`.trim().toUpperCase(), tel: '', autreNumero: false, rangement: '' };
}

/** ASSURE avec le numero de la fiche (masque) : rien n'est saisi, le serveur le reprend. */
export function utiliseNumeroFiche(c: Carte, f: FormRetrait): boolean {
  return f.type === 'ASSURE' && !f.autreNumero && c.contact_masque !== null;
}

export function formRetraitValide(c: Carte, f: FormRetrait): boolean {
  const nom = normalizeName(f.nom);
  if (nom === '' || nom.length > 150) return false;
  if (!utiliseNumeroFiche(c, f) && f.tel.length !== 10) return false;
  if (c.non_classee && !rangementUrgenceValide(f.rangement)) return false;
  return true;
}

export function EcranFormRetrait(props: { carte: Carte; form: FormRetrait; setForm: (f: FormRetrait) => void; onContinuer: () => void }) {
  const { carte: c, form: f, setForm } = props;
  const numeroFiche = formatMaskedContact(c.contact_masque);
  const valide = formRetraitValide(c, f);
  return (
    <>
      <main className="corps">
        <div className="champ">
          <span className="label" id="benef">Bénéficiaire du retrait</span>
          <div className="choix" role="radiogroup" aria-labelledby="benef">
            <button
              type="button"
              className="opt"
              role="radio"
              aria-checked={f.type === 'ASSURE'}
              onClick={() => f.type !== 'ASSURE' && setForm({ ...f, type: 'ASSURE', nom: `${c.noms} ${c.prenoms}`.trim().toUpperCase(), tel: '', autreNumero: false })}
            >
              L'assuré lui-même
            </button>
            <button
              type="button"
              className="opt"
              role="radio"
              aria-checked={f.type === 'TIERS'}
              onClick={() => f.type !== 'TIERS' && setForm({ ...f, type: 'TIERS', nom: '', tel: '', autreNumero: false })}
            >
              Un tiers (Mandataire)
            </button>
          </div>
        </div>
        <div className="champ">
          <label htmlFor="f-nom">Nom complet du retirant *</label>
          <input
            id="f-nom"
            className="saisie"
            type="text"
            autoCapitalize="characters"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            maxLength={150}
            placeholder="NOM ET PRÉNOMS"
            value={f.nom}
            onChange={(e) => setForm({ ...f, nom: e.target.value.toUpperCase() })}
          />
          {f.type === 'ASSURE' && <span className="aide">Pré-rempli depuis la fiche. Modifiable.</span>}
        </div>
        {utiliseNumeroFiche(c, f) ? (
          <div className="champ">
            <label htmlFor="f-tel-fiche">Contact téléphonique *</label>
            <div className="tel-groupe">
              <span className="prefixe" aria-hidden="true">+225</span>
              <input id="f-tel-fiche" className="saisie" type="text" value={(numeroFiche ?? '').replace('+225 ', '')} readOnly />
            </div>
            <span className="aide">
              Numéro enregistré de l'assuré (masqué).{' '}
              <button type="button" className="btn-lien" onClick={() => setForm({ ...f, autreNumero: true, tel: '' })}>
                Saisir un autre numéro
              </button>
            </span>
          </div>
        ) : (
          <>
            <ChampTelephone id="f-tel" label="Contact téléphonique *" chiffres={f.tel} onChange={(tel) => setForm({ ...f, tel })} />
            {f.type === 'ASSURE' && c.contact_masque === null && <span className="aide">Aucun numéro enregistré sur la fiche : saisissez-en un.</span>}
            {f.type === 'ASSURE' && f.autreNumero && c.contact_masque !== null && (
              <button type="button" className="btn-lien" style={{ alignSelf: 'flex-start' }} onClick={() => setForm({ ...f, autreNumero: false, tel: '' })}>
                Utiliser le numéro enregistré
              </button>
            )}
          </>
        )}
        {c.non_classee && (
          <div className="bandeau b-warn urgence">
            <label htmlFor="f-rg" style={{ fontWeight: 900 }}>⚠ RANGEMENT D'URGENCE OBLIGATOIRE (Carte sans rangement)</label>
            <input
              id="f-rg"
              className="saisie"
              type="text"
              autoCapitalize="characters"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              maxLength={60}
              placeholder="Ex: C1-B4-P3 (Box/Colonne/Parapheur)"
              value={f.rangement}
              onChange={(e) => setForm({ ...f, rangement: e.target.value.toUpperCase() })}
            />
          </div>
        )}
      </main>
      <Pied>
        <button className="btn btn-soleil" type="button" disabled={!valide} onClick={props.onContinuer}>Continuer</button>
      </Pied>
    </>
  );
}

export function EcranRecap(props: {
  carte: Carte;
  form: FormRetrait;
  envoi: boolean;
  avis: Message | null;
  enLigne: boolean;
  onConfirmer: () => void;
  onModifier: () => void;
}) {
  const { carte: c, form: f } = props;
  const rangement = c.non_classee ? f.rangement.trim().toUpperCase() : c.rangement ?? '';
  const contact = utiliseNumeroFiche(c, f) ? `${formatMaskedContact(c.contact_masque) ?? ''} (enregistré)` : formatPhoneFull(f.tel);
  return (
    <>
      <main className="corps">
        {props.avis && <Bandeau m={props.avis} />}
        <section className="recap" style={props.envoi ? { opacity: 0.85 } : undefined}>
          <div className="t">Carte remise</div>
          <dl>
            <dt>Assuré</dt>
            <dd>{`${c.noms} ${c.prenoms}`.trim()}</dd>
            <dt>Date de Naissance</dt>
            <dd>{formatIsoDate(c.date_naissance)}</dd>
            <dt>Rangement{c.non_classee ? ' (urgence)' : ''}</dt>
            <dd><span className="rg-big">{rangement}</span></dd>
          </dl>
        </section>
        <section className="recap">
          <div className="t">Retirant</div>
          <dl>
            <dt>Qualité</dt>
            <dd>{f.type === 'ASSURE' ? 'ASSURÉ LUI-MÊME' : 'TIERS MANDATÉ'}</dd>
            <dt>Nom complet</dt>
            <dd>{normalizeName(f.nom)}</dd>
            <dt>Contact</dt>
            <dd>{contact}</dd>
          </dl>
        </section>
        {props.envoi ? (
          <Bandeau role="status" m={{ titre: 'Envoi en cours', texte: 'Ne fermez pas l\'application et ne quittez pas cet écran.', variante: 'info' }} />
        ) : !props.enLigne ? (
          <Bandeau m={{ titre: 'Hors-ligne', texte: 'Le retrait exige Internet. Rétablissez la connexion avant de confirmer.', variante: 'off' }} />
        ) : (
          <p className="muted" style={{ margin: 0, fontSize: 15 }}>Date, heure, agent et centre sont enregistrés automatiquement par le serveur.</p>
        )}
      </main>
      <Pied>
        <button className="btn btn-soleil btn-grand" type="button" disabled={props.envoi || !props.enLigne} onClick={props.onConfirmer}>
          {props.envoi ? (<><span className="spin" aria-hidden="true" /> Enregistrement...</>) : '✓ Confirmer le retrait'}
        </button>
        <button className="btn btn-second btn-petit" type="button" disabled={props.envoi} onClick={props.onModifier}>Modifier</button>
      </Pied>
    </>
  );
}

export function EcranSucces(props: { carte: Carte; form: FormRetrait; date: string | null; onNouvelle: () => void }) {
  const m = messageRetrait('OK');
  return (
    <>
      <main className="corps">
        <div className="resultat" role="status">
          <div className="rond ok" aria-hidden="true">✓</div>
          <h2>{m.titre}</h2>
          <p>{m.texte}</p>
          <div className="cadre">
            <b>{`${props.carte.noms} ${props.carte.prenoms}`.trim()}</b>
            <br />
            Remise à : {normalizeName(props.form.nom)} ({props.form.type === 'ASSURE' ? 'assuré' : 'tiers'})
            {props.date && (<><br />Le {formatDateTime(props.date)}</>)}
          </div>
        </div>
      </main>
      <Pied>
        <button className="btn btn-soleil" type="button" onClick={props.onNouvelle}>Nouvelle recherche</button>
      </Pied>
    </>
  );
}

export function EcranRefus(props: {
  code: string;
  date: string | null;
  onVoirPreuve?: () => void;
  onCorriger?: () => void;
  onNouvelle: () => void;
  onDeconnexion: () => void;
}) {
  const m = messageRetrait(props.code);
  const compteInactif = props.code === 'COMPTE_INACTIF';
  return (
    <>
      <main className="corps">
        <div className="resultat" role="alert">
          <div className="rond ko" aria-hidden="true">✕</div>
          <h2>{m.titre}</h2>
          {props.code === 'DEJA_DELIVREE' && props.date && <p>Délivrée le <b>{formatDateTime(props.date)}</b>.</p>}
          <div className="cadre">{m.texte}</div>
        </div>
      </main>
      <Pied>
        {compteInactif ? (
          <button className="btn btn-soleil" type="button" onClick={props.onDeconnexion}>Se déconnecter</button>
        ) : (
          <>
            {props.code === 'DEJA_DELIVREE' && props.onVoirPreuve && (
              <button className="btn btn-second" type="button" onClick={props.onVoirPreuve}>Voir la preuve de retrait</button>
            )}
            {refusCorrigeable(props.code) && props.onCorriger && (
              <button className="btn btn-second" type="button" onClick={props.onCorriger}>‹ Revenir au formulaire</button>
            )}
            <button className="btn btn-soleil" type="button" onClick={props.onNouvelle}>Nouvelle recherche</button>
          </>
        )}
      </Pied>
    </>
  );
}

export function EcranInconnu(props: { verif: boolean; avis: Message | null; onVerifier: () => void; onNouvelle?: () => void }) {
  return (
    <>
      <main className="corps">
        <div className="resultat">
          <div className="rond inc" aria-hidden="true">?</div>
          <h2>Résultat inconnu</h2>
          <p>La connexion a été coupée pendant l'envoi. Le retrait a <b>peut-être</b> été enregistré.</p>
          <div className="cadre">
            <b>Ne refaites pas le retrait.</b>
            <br />
            Gardez la carte en main, rétablissez la connexion, puis appuyez sur « Vérifier ».
          </div>
          {props.avis && <Bandeau m={props.avis} />}
        </div>
      </main>
      <Pied>
        <button className="btn btn-soleil btn-grand" type="button" disabled={props.verif} onClick={props.onVerifier}>
          {props.verif ? (<><span className="spin" aria-hidden="true" /> Vérification...</>) : '↻ Vérifier'}
        </button>
        {props.onNouvelle && (
          <button className="btn btn-second btn-petit" type="button" onClick={props.onNouvelle}>Nouvelle recherche</button>
        )}
      </Pied>
    </>
  );
}
