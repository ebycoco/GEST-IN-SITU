// Ecran 4 : fiche carte (maquettes 4a-4d). Aucune donnee n'est conservee hors de la memoire.
import { etatFiche, type Carte } from '../lib/cards';
import { formatDateTime, formatIsoDate, formatMaskedContact } from '../lib/masks';
import { Badge, Pied } from '../ui';

function Ligne({ k, v }: { k: string; v: string | null | undefined }) {
  if (!v) return null;
  return (
    <div>
      <div className="k">{k}</div>
      <p className="v">{v}</p>
    </div>
  );
}

export function titreFiche(c: Carte): { titre: string; sous: string } {
  const e = etatFiche(c);
  if (e === 'DELIVREE') return { titre: 'Preuve de Retrait', sous: 'Carte déjà distribuée' };
  if (e === 'DELIVRABLE') return { titre: 'Fiche carte', sous: 'Vérification Physique' };
  return { titre: 'Fiche carte', sous: 'Non délivrable' };
}

export function EcranFiche(props: { carte: Carte; onRetour: () => void; onJaiLaCarte: () => void }) {
  const c = props.carte;
  const e = etatFiche(c);
  const contact = formatMaskedContact(c.contact_masque);

  if (e === 'DELIVREE') {
    return (
      <>
        <main className="corps">
          <div className="ident">
            <Badge c={c} />
            <div className="nom">{c.noms}</div>
            <div className="prenoms">{c.prenoms}</div>
            <div className="grille">
              <Ligne k="Date de Naissance" v={formatIsoDate(c.date_naissance)} />
            </div>
          </div>
          <section className="preuve">
            <h3>Détails de la transaction</h3>
            <div className="grille">
              <Ligne k="Date & Heure exactes" v={formatDateTime(c.date_delivrance) || 'Non renseignée'} />
              <Ligne k="Centre de distribution" v={c.centre_retrait || 'Non renseigné'} />
            </div>
          </section>
          <section className="preuve">
            <h3>Identité du Retirant</h3>
            <div className="grille">
              <Ligne k="Nom & Prénom" v={c.nom_retirant || 'Non renseigné'} />
              <Ligne k="Contact" v={formatMaskedContact(c.tel_retirant_masque) ?? 'Non renseigné'} />
            </div>
          </section>
          {!c.non_classee && c.rangement && (
            <div className="rangement gris">
              <div className="k">Ancien rangement</div>
              <div className="v">{c.rangement}</div>
            </div>
          )}
        </main>
        <Pied>
          <button className="btn btn-second" type="button" onClick={props.onRetour}>Fermer</button>
        </Pied>
      </>
    );
  }

  const bandeau =
    e === 'DOUBLON' ? (
      <div className="bandeau-rouge" role="alert">
        <b>⛔ DÉCLARÉE EN DOUBLON</b>
        <p>Cette carte ne peut plus être délivrée. Contactez un administrateur pour vérifier ou annuler cette déclaration.</p>
      </div>
    ) : e === 'ABSENTE' ? (
      <div className="bandeau-rouge absente" role="alert">
        <b>⚠ SIGNALÉE ABSENTE</b>
        <p>En cours de traitement par l'administration. Délivrance impossible pour le moment.</p>
      </div>
    ) : e === 'PERDUE' ? (
      <div className="bandeau-rouge perdue" role="alert">
        <b>✕ DÉCLARÉE PERDUE</b>
        <p>Cette carte a été déclarée perdue par l'administration. Contactez votre administrateur.</p>
      </div>
    ) : e === 'HORS_CENTRE' ? (
      <div className="bandeau-rouge" role="alert">
        <b>⛔ CARTE HORS DE VOTRE CENTRE</b>
        <p>Cette carte est rangée {c.centre_nom ? `au ${c.centre_nom}` : 'dans un autre centre'}. Orientez l'assuré vers ce centre.</p>
      </div>
    ) : e === 'NON_DELIVRABLE' ? (
      <div className="bandeau-rouge" role="alert">
        <b>⛔ CARTE NON DÉLIVRABLE</b>
        <p>Statut actuel : {c.statut ?? 'inconnu'}. Contactez votre administrateur.</p>
      </div>
    ) : null;

  const rangementBloc =
    e === 'DELIVRABLE' ? (
      c.non_classee ? (
        <div className="rangement vide">
          <div className="k">Emplacement de rangement exact</div>
          <div className="v">⚠ Aucun rangement renseigné pour cette carte</div>
        </div>
      ) : (
        <div className="rangement">
          <div className="k">Emplacement de rangement exact</div>
          <div className="v">{c.rangement}</div>
        </div>
      )
    ) : null;

  return (
    <>
      <main className="corps">
        {bandeau}
        {rangementBloc}
        <div className="ident">
          <Badge c={c} />
          <div className="nom">{c.noms}</div>
          <div className="prenoms">{c.prenoms}</div>
          <div className="grille">
            <Ligne k="Date de Naissance" v={formatIsoDate(c.date_naissance)} />
            {e === 'DELIVRABLE' && <Ligne k="Lieu de Naissance" v={c.lieu_naissance} />}
            {e === 'DELIVRABLE' && <Ligne k="Contact" v={contact ?? 'Aucun numéro enregistré'} />}
            <Ligne k="Centre" v={c.centre_nom} />
            {e !== 'DELIVRABLE' && <Ligne k="Rangement" v={c.non_classee ? 'Aucun rangement' : c.rangement} />}
          </div>
        </div>
        {e === 'DELIVRABLE' && <p className="question">Avez-vous trouvé la carte physiquement dans le rangement ?</p>}
      </main>
      <Pied>
        {e === 'DELIVRABLE' ? (
          <button className="btn btn-soleil" type="button" onClick={props.onJaiLaCarte}>✓ Oui, j'ai la carte</button>
        ) : (
          <button className="btn btn-second" type="button" onClick={props.onRetour}>‹ Retour aux résultats</button>
        )}
      </Pied>
    </>
  );
}
