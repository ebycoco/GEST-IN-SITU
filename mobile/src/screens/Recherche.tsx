// Ecran 2 (recherche, maquettes 2a-2c) et ecran 3 (liste de resultats).
import type { FormEvent } from 'react';
import type { Criteres } from '../lib/api';
import type { Message } from '../lib/codes';
import { estBloquee, type Carte, type ResultatRecherche } from '../lib/cards';
import { formatDateInput, formatIsoDate, normalizeName, parseDdn } from '../lib/masks';
import { Badge, Bandeau, ChampTelephone, Pied } from '../ui';

export interface FormRecherche {
  onglet: 'NOM' | 'TEL';
  nom: string;
  ddn: string; // masque JJ/MM/AAAA
  tel: string; // chiffres
}

export const FORM_RECHERCHE_VIDE: FormRecherche = { onglet: 'NOM', nom: '', ddn: '', tel: '' };

/** Criteres envoyables, ou null tant que le formulaire est incomplet. */
export function criteresDe(f: FormRecherche): Criteres | null {
  if (f.onglet === 'TEL') {
    return f.tel.length === 10 ? { mode: 'TEL', nom: '', ddnIso: '', ddnAffiche: '', tel: f.tel } : null;
  }
  const nom = normalizeName(f.nom);
  const iso = parseDdn(f.ddn);
  if (nom === '' || nom.length > 200 || !iso) return null;
  return { mode: 'NOM', nom, ddnIso: iso, ddnAffiche: f.ddn, tel: '' };
}

export function EcranRecherche(props: {
  form: FormRecherche;
  setForm: (f: FormRecherche) => void;
  message: Message | null;
  envoi: boolean;
  onRechercher: (c: Criteres) => void;
}) {
  const { form, setForm } = props;
  const criteres = criteresDe(form);
  const ddnComplete = form.ddn.length === 10;
  const ddnInvalide = ddnComplete && parseDdn(form.ddn) === null;

  function soumettre(e: FormEvent) {
    e.preventDefault();
    if (criteres && !props.envoi) props.onRechercher(criteres);
  }

  return (
    <form className="contenu" onSubmit={soumettre} noValidate style={{ display: 'contents' }}>
      <main className="corps">
        <div className="onglets" role="tablist" aria-label="Mode de recherche">
          <button type="button" className="onglet" role="tab" aria-selected={form.onglet === 'NOM'} onClick={() => setForm({ ...form, onglet: 'NOM' })}>
            Nom + date de naissance
          </button>
          <button type="button" className="onglet" role="tab" aria-selected={form.onglet === 'TEL'} onClick={() => setForm({ ...form, onglet: 'TEL' })}>
            Téléphone
          </button>
        </div>
        {props.message && <Bandeau m={props.message} role={props.message.variante === 'info' ? 'status' : 'alert'} />}
        {form.onglet === 'NOM' ? (
          <>
            <div className="champ">
              <label htmlFor="r-nom">Nom &amp; Prénoms *</label>
              <input
                id="r-nom"
                className="saisie"
                type="text"
                autoCapitalize="characters"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                maxLength={200}
                placeholder="Ex: KOFFI KOFFI KAN"
                value={form.nom}
                onChange={(e) => setForm({ ...form, nom: e.target.value.toUpperCase() })}
              />
            </div>
            <div className="champ">
              <label htmlFor="r-ddn">Date de Naissance *</label>
              <input
                id="r-ddn"
                className={`saisie${ddnInvalide ? ' err' : ''}`}
                type="text"
                inputMode="numeric"
                maxLength={10}
                autoComplete="off"
                placeholder="JJ/MM/AAAA"
                value={form.ddn}
                onChange={(e) => setForm({ ...form, ddn: formatDateInput(e.target.value) })}
                aria-invalid={ddnInvalide}
                aria-describedby="r-ddn-aide"
              />
              <span className="aide" id="r-ddn-aide">
                {ddnInvalide ? 'Cette date n\'existe pas. Vérifiez jour, mois et année.' : 'Tapez les chiffres, les « / » s\'ajoutent seuls.'}
              </span>
            </div>
          </>
        ) : (
          <ChampTelephone id="r-tel" label="Numéro de Téléphone Ivoirien *" chiffres={form.tel} onChange={(tel) => setForm({ ...form, tel })} />
        )}
      </main>
      <Pied>
        <button className="btn btn-soleil" type="submit" disabled={!criteres || props.envoi}>
          {props.envoi ? (<><span className="spin" aria-hidden="true" /> Recherche...</>) : form.onglet === 'NOM' ? 'Rechercher la Carte' : 'Rechercher par Téléphone'}
        </button>
        <button
          className="btn btn-second btn-petit"
          type="button"
          disabled={props.envoi}
          onClick={() => setForm(form.onglet === 'NOM' ? { ...form, nom: '', ddn: '' } : { ...form, tel: '' })}
        >
          Effacer
        </button>
      </Pied>
    </form>
  );
}

export function EcranResultats(props: { res: ResultatRecherche; onOuvrir: (c: Carte) => void }) {
  const { res } = props;
  return (
    <main className="corps" style={{ gap: 12 }}>
      {res.inversion && (
        <Bandeau
          role="status"
          m={{ titre: 'Nom et prénoms inversés ?', texte: 'Aucune carte exacte : ces résultats ont été trouvés en inversant nom et prénoms. Vérifiez bien l\'identité.', variante: 'warn' }}
        />
      )}
      {res.tronque && (
        <Bandeau role="status" m={{ titre: 'Affinez la recherche', texte: '10 résultats affichés au maximum.', variante: 'info' }} />
      )}
      <div className="compteur">Votre centre d'abord · 10 résultats max.</div>
      <ul className="liste">
        {res.resultats.map((c) => (
          <li key={c.sync_id}>
            <button type="button" className={`res${estBloquee(c) ? ' bloquee' : ''}`} onClick={() => props.onOuvrir(c)}>
              <span className="fleche" aria-hidden="true">›</span>
              <span><Badge c={c} /></span>
              <span className="nom">{`${c.noms} ${c.prenoms}`.trim()}</span>
              {c.date_naissance && <span className="ddn">Né(e) le {formatIsoDate(c.date_naissance)}</span>}
              <span className="ligne">
                {c.non_classee ? <span className="rg vide">Aucun rangement</span> : <span className="rg">{c.rangement}</span>}
                <span className="muted">{c.centre_nom ?? ''}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}
