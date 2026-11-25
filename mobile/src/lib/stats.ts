// « Vue d'ensemble » de l'operateur : reponse de fn_mobile_mes_stats() (lecture defensive du
// JSONB, comme lib/cards.ts pour la recherche) et mise en forme de l'heure (tests/stats.test.ts).
//
// Contrat serveur (une seule RPC, sans parametre) :
//   { code: 'OK' | 'COMPTE_INACTIF', site_nom, centre_nom, aujourd_hui, semaine, mois, annee,
//     retraits_jour: [{ date_delivrance, noms, prenoms, date_de_naissance, lieu_de_naissance,
//                       num_secu, rangement, nom_retirant, relation_retirant, num_retirant }] }
// Aucune de ces donnees n'est conservee hors de la memoire React (effacees au verrou / a la
// deconnexion, voir App.tsx).

export interface RetraitJour {
  dateDelivrance: string | null;
  noms: string;
  prenoms: string;
  dateNaissance: string | null;
  lieuNaissance: string | null;
  /** Numero de securite sociale tel que renvoye par le serveur (non reformate). */
  numSecu: string | null;
  rangement: string | null;
  nomRetirant: string | null;
  relationRetirant: string | null;
  numRetirant: string | null;
}

export interface StatsOperateur {
  /** 'OK', 'COMPTE_INACTIF', autre code serveur, ou 'REPONSE_ILLISIBLE' (forme inattendue). */
  code: string;
  siteNom: string | null;
  centreNom: string | null;
  aujourdhui: number;
  semaine: number;
  mois: number;
  annee: number;
  retraits: RetraitJour[];
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const compteur = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null;

const ILLISIBLE: StatsOperateur = {
  code: 'REPONSE_ILLISIBLE',
  siteNom: null,
  centreNom: null,
  aujourdhui: 0,
  semaine: 0,
  mois: 0,
  annee: 0,
  retraits: [],
};

function parseRetrait(v: unknown): RetraitJour | null {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  return {
    dateDelivrance: str(o['date_delivrance']),
    noms: str(o['noms']) ?? '',
    prenoms: str(o['prenoms']) ?? '',
    dateNaissance: str(o['date_de_naissance']),
    lieuNaissance: str(o['lieu_de_naissance']),
    numSecu: str(o['num_secu']),
    rangement: str(o['rangement']),
    nomRetirant: str(o['nom_retirant']),
    relationRetirant: str(o['relation_retirant']),
    numRetirant: str(o['num_retirant']),
  };
}

/**
 * Reponse de fn_mobile_mes_stats -> objet type. Un corps non objet, sans code, ou un code 'OK'
 * dont les 4 compteurs ne sont pas des nombres, rend 'REPONSE_ILLISIBLE' : on n'affiche jamais
 * de faux « 0 ». COMPTE_INACTIF (ou tout autre code) est rendu tel quel, sans donnees.
 */
export function parseStats(data: unknown): StatsOperateur {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return { ...ILLISIBLE };
  const o = data as Record<string, unknown>;
  const code = str(o['code']);
  if (code === null) return { ...ILLISIBLE };
  if (code !== 'OK') return { ...ILLISIBLE, code };
  const a = compteur(o['aujourd_hui']);
  const s = compteur(o['semaine']);
  const m = compteur(o['mois']);
  const y = compteur(o['annee']);
  if (a === null || s === null || m === null || y === null) return { ...ILLISIBLE };
  const brut = Array.isArray(o['retraits_jour']) ? o['retraits_jour'] : [];
  return {
    code,
    siteNom: str(o['site_nom']),
    centreNom: str(o['centre_nom']),
    aujourdhui: a,
    semaine: s,
    mois: m,
    annee: y,
    retraits: brut.map(parseRetrait).filter((r): r is RetraitJour => r !== null),
  };
}

let formateurHeure: Intl.DateTimeFormat | null = null;

/**
 * Heure de delivrance en fr-FR, fuseau Africa/Abidjan (« 09:46 ») ; date absente ou
 * illisible -> « — ». Le formateur est cree une seule fois (liste potentiellement longue).
 */
export function formatHeureAbidjan(iso: string | null | undefined): string {
  if (!iso) return '—';
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return '—';
  formateurHeure ??= new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Abidjan' });
  return formateurHeure.format(t);
}
