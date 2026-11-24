// Cartes renvoyees par fn_mobile_rechercher_cartes (0020) : lecture defensive du JSON,
// badges de statut et etat de la fiche (tests/cards.test.ts).
// Jamais de num_secu (le serveur ne le renvoie pas) ; contacts deja masques par le serveur.

export interface Carte {
  sync_id: string;
  noms: string;
  prenoms: string;
  date_naissance: string | null;
  lieu_naissance: string | null;
  rangement: string | null;
  non_classee: boolean;
  statut: string | null;
  statut_physique: string | null;
  id_centre: number | null;
  centre_nom: string | null;
  meme_centre: boolean;
  contact_masque: string | null;
  date_delivrance: string | null;
  centre_retrait: string | null;
  nom_retirant: string | null;
  tel_retirant_masque: string | null;
}

export interface ResultatRecherche {
  code: string;
  mode: 'NOM' | 'TEL' | null;
  inversion: boolean;
  tronque: boolean;
  resultats: Carte[];
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function parseCarte(v: unknown): Carte | null {
  if (v === null || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const sync = str(o['sync_id']);
  if (!sync) return null;
  return {
    sync_id: sync,
    noms: str(o['noms']) ?? '',
    prenoms: str(o['prenoms']) ?? '',
    date_naissance: str(o['date_naissance']),
    lieu_naissance: str(o['lieu_naissance']),
    rangement: str(o['rangement']),
    non_classee: o['non_classee'] === true,
    statut: str(o['statut']),
    statut_physique: str(o['statut_physique']),
    id_centre: num(o['id_centre']),
    centre_nom: str(o['centre_nom']),
    meme_centre: o['meme_centre'] === true,
    contact_masque: str(o['contact_masque']),
    date_delivrance: str(o['date_delivrance']),
    centre_retrait: str(o['centre_retrait']),
    nom_retirant: str(o['nom_retirant']),
    tel_retirant_masque: str(o['tel_retirant_masque']),
  };
}

/** Reponse de fn_mobile_rechercher_cartes -> objet type ; code 'REPONSE_ILLISIBLE' si inattendu. */
export function parseRecherche(data: unknown): ResultatRecherche {
  if (data === null || typeof data !== 'object') {
    return { code: 'REPONSE_ILLISIBLE', mode: null, inversion: false, tronque: false, resultats: [] };
  }
  const o = data as Record<string, unknown>;
  const code = str(o['code']) ?? 'REPONSE_ILLISIBLE';
  const mode = o['mode'] === 'NOM' || o['mode'] === 'TEL' ? o['mode'] : null;
  const brut = Array.isArray(o['resultats']) ? o['resultats'] : [];
  const resultats = brut.map(parseCarte).filter((c): c is Carte => c !== null).slice(0, 10);
  return { code, mode, inversion: o['inversion'] === true, tronque: o['tronque'] === true, resultats };
}

export type Badge = { cls: string; texte: string };

/** Badge de la liste et de la fiche : symbole + mot (le statut ne repose jamais sur la couleur seule). */
export function badgeFor(c: Pick<Carte, 'statut' | 'statut_physique'>): Badge {
  if (c.statut === 'DELIVRE') return { cls: 's-delivre', texte: '● DÉLIVRÉE' };
  if (c.statut === 'DOUBLON') return { cls: 's-doublon', texte: '⛔ DOUBLON' };
  if (c.statut_physique === 'PERDUE') return { cls: 's-perdue', texte: '✕ PERDUE' };
  if (c.statut_physique === 'ABSENT') return { cls: 's-absente', texte: '⚠ ABSENTE' };
  if (c.statut === 'EN STOCK') return { cls: 's-stock', texte: '✓ EN STOCK' };
  return { cls: 's-autre', texte: `? ${c.statut ?? 'INCONNU'}` };
}

export type EtatFiche =
  | 'DELIVREE'
  | 'DOUBLON'
  | 'PERDUE'
  | 'ABSENTE'
  | 'NON_DELIVRABLE'
  | 'HORS_CENTRE'
  | 'DELIVRABLE';

/**
 * Etat de la fiche, dans l'esprit des controles de fn_mobile_delivrer_carte
 * (le serveur reste l'autorite : il recontrole tout au moment du retrait).
 * Une carte non classee n'est jamais « hors centre » (le serveur l'accepte avec un
 * rangement d'urgence, et recalcule son centre).
 */
export function etatFiche(c: Carte): EtatFiche {
  if (c.statut === 'DELIVRE') return 'DELIVREE';
  if (c.statut === 'DOUBLON') return 'DOUBLON';
  if (c.statut_physique === 'PERDUE') return 'PERDUE';
  if (c.statut_physique === 'ABSENT') return 'ABSENTE';
  if (c.statut !== 'EN STOCK') return 'NON_DELIVRABLE';
  if (!c.non_classee && !c.meme_centre) return 'HORS_CENTRE';
  return 'DELIVRABLE';
}

/** Carte « bloquee » dans la liste (liseré rouge). */
export function estBloquee(c: Carte): boolean {
  const e = etatFiche(c);
  return e !== 'DELIVRABLE' && e !== 'DELIVREE';
}

/** Rangement d'urgence acceptable (meme regle que le serveur : non vide, pas « NON CLASSE », <= 60). */
export function rangementUrgenceValide(v: string): boolean {
  const r = v.trim().toUpperCase();
  return r !== '' && r !== 'NON CLASSE' && r.length <= 60;
}
