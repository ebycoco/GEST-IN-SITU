// Ecran « Vue d'ensemble » : 4 compteurs (aujourd'hui / semaine lundi-dimanche / mois / annee)
// puis « Travail du jour » en cartes empilees (lisible sur 320 px). Meme contenu que
// AgentVerification/views/Overview.tsx du bureau, sans la colonne Synchro (le telephone ecrit
// directement en ligne). Donnees en memoire React seulement (effacees au verrou).
import { formatIsoDate } from '../lib/masks';
import { formatHeureAbidjan, type RetraitJour, type StatsOperateur } from '../lib/stats';

function Tuile({ n, l, jour }: { n: number; l: string; jour?: boolean }) {
  return (
    <div className={`tuile${jour ? ' jour' : ''}`}>
      <span className="n">{n}</span>
      <span className="l">{l}</span>
    </div>
  );
}

function Champ({ k, v, secu }: { k: string; v: string | null | undefined; secu?: boolean }) {
  return (
    <p className="sec">
      <b>{k}</b>
      <span className={secu ? 'secu' : undefined}>{v ? v : '—'}</span>
    </p>
  );
}

function CarteRetrait({ r }: { r: RetraitJour }) {
  const naissance = [formatIsoDate(r.dateNaissance), r.lieuNaissance].filter((x) => x).join(' · ');
  const retirant = [r.nomRetirant, r.relationRetirant, r.numRetirant].filter((x) => x).join(' · ');
  return (
    <li className="tj">
      <div className="tete">
        <span className="nom">{`${r.noms} ${r.prenoms}`.trim() || '—'}</span>
        <span className="heure" aria-label="Heure de délivrance">{formatHeureAbidjan(r.dateDelivrance)}</span>
      </div>
      <Champ k="Né(e)" v={naissance} />
      <Champ k="N° Sécu" v={r.numSecu} secu />
      <Champ k="Rangement" v={r.rangement} />
      <Champ k="Retirant" v={retirant} />
    </li>
  );
}

export function EcranApercu(props: { stats: StatsOperateur | null; enCours: boolean }) {
  const { stats } = props;
  if (!stats) {
    return (
      <main className="corps centre" role="status" aria-live="polite">
        <p className="vide-tj">{props.enCours ? 'Chargement…' : 'Informations non chargées. Appuyez sur « Actualiser ».'}</p>
      </main>
    );
  }
  return (
    <main className="corps">
      <div className="tuiles">
        <Tuile n={stats.aujourdhui} l="Aujourd'hui" jour />
        <Tuile n={stats.semaine} l="Cette semaine" />
        <Tuile n={stats.mois} l="Ce mois" />
        <Tuile n={stats.annee} l="Cette année" />
      </div>
      <h2 className="tj-titre">
        Travail du jour
        <span>{stats.retraits.length}</span>
      </h2>
      {stats.retraits.length === 0 ? (
        <p className="vide-tj">Aucune fiche délivrée aujourd'hui pour le moment.</p>
      ) : (
        <ul className="liste">
          {stats.retraits.map((r, i) => (
            <CarteRetrait key={`${r.dateDelivrance ?? ''}-${i}`} r={r} />
          ))}
        </ul>
      )}
    </main>
  );
}
