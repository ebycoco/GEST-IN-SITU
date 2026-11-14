// ============================================================================
// Logique PURE de la page SUPER ADMIN "Versions des postes" (aucun accès IPC/DOM,
// testable seule). Voir docs/PLAN_ECRAN_VERSIONS_POSTES.md (choix 4).
//
// États d'une ligne :
//  - SILENCIEUX : dernière remontée > 7 jours (prioritaire sur les états de version ;
//                 l'état de version reste disponible dans `versionState` pour un
//                 second badge) ;
//  - A_JOUR     : version >= référence ;
//  - EN_RETARD  : version <  référence ;
//  - INCONNU    : version invalide/absente, ou aucune référence disponible.
// ============================================================================

import type { PosteVersionRow } from '../../../shared/types';

export type PosteVersionState = 'A_JOUR' | 'EN_RETARD' | 'INCONNU';
export type PosteState = PosteVersionState | 'SILENCIEUX';

/** Au-delà de ce délai sans remontée, un poste est « silencieux » (strictement supérieur). */
export const SILENT_AFTER_DAYS = 7;
const MS_PER_DAY = 86_400_000;
export const SILENT_AFTER_MS = SILENT_AFTER_DAYS * MS_PER_DAY;

export type SemverTriplet = readonly [number, number, number];

/**
 * Analyse x.y.z. Tolère espaces, `v` initial, suffixes (`-beta.1`, `+build`) qui sont ignorés
 * (une préversion est comparée comme sa version stable). Invalide → null.
 */
export function parseSemver(value: string | null | undefined): SemverTriplet | null {
  if (typeof value !== 'string') return null;
  const m = /^\s*v?(\d{1,9})\.(\d{1,9})\.(\d{1,9})(?:[-+][0-9A-Za-z.+-]*)?\s*$/i.exec(value);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** Compare deux versions : <0, 0, >0 ; null si l'une des deux est invalide. */
export function compareVersions(a: string | null | undefined, b: string | null | undefined): number | null {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return 0;
}

/**
 * Version de référence : `latestVersion` (auto-updater) si valide, sinon la plus haute
 * version valide vue dans les lignes, sinon null.
 */
export function pickReferenceVersion(
  latestVersion: string | null | undefined,
  rows: ReadonlyArray<Pick<PosteVersionRow, 'app_version'>>
): string | null {
  if (parseSemver(latestVersion)) return (latestVersion as string).trim();
  let best: string | null = null;
  for (const r of rows) {
    if (!parseSemver(r.app_version)) continue;
    if (best === null || (compareVersions(r.app_version, best) ?? 0) > 0) best = r.app_version as string;
  }
  return best === null ? null : best.trim();
}

/** Convertit un ISO en ms ; null si absent/invalide. */
export function toMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/** Dernière remontée trop ancienne (> 7 jours). Date absente/invalide : considéré silencieux. */
export function isSilent(lastSeenAt: string | null | undefined, nowMs: number): boolean {
  const ms = toMs(lastSeenAt);
  if (ms === null) return true;
  return nowMs - ms > SILENT_AFTER_MS;
}

/** État « version » seul (sans la notion de silence). */
export function computeVersionState(appVersion: string | null | undefined, reference: string | null): PosteVersionState {
  if (reference === null) return 'INCONNU';
  const cmp = compareVersions(appVersion, reference);
  if (cmp === null) return 'INCONNU';
  return cmp >= 0 ? 'A_JOUR' : 'EN_RETARD';
}

export interface PosteRowState {
  /** État principal (SILENCIEUX prioritaire). */
  state: PosteState;
  /** État de version, toujours renseigné (permet un second badge pour un poste silencieux). */
  versionState: PosteVersionState;
  silent: boolean;
}

export function computeRowState(
  row: Pick<PosteVersionRow, 'app_version' | 'last_seen_at'>,
  reference: string | null,
  nowMs: number
): PosteRowState {
  const versionState = computeVersionState(row.app_version, reference);
  const silent = isSilent(row.last_seen_at, nowMs);
  return { state: silent ? 'SILENCIEUX' : versionState, versionState, silent };
}

export interface PostesSummary {
  total: number;
  A_JOUR: number;
  EN_RETARD: number;
  INCONNU: number;
  SILENCIEUX: number;
}

/** Synthèse par état principal : la somme des 4 états égale `total`. */
export function summarize(states: ReadonlyArray<PosteState>): PostesSummary {
  const s: PostesSummary = { total: states.length, A_JOUR: 0, EN_RETARD: 0, INCONNU: 0, SILENCIEUX: 0 };
  for (const st of states) s[st]++;
  return s;
}

const STATE_RANK: Record<PosteState, number> = { EN_RETARD: 0, SILENCIEUX: 1, INCONNU: 2, A_JOUR: 3 };

/**
 * Tri par défaut : en retard d'abord (version la plus basse en tête), puis silencieux,
 * inconnus, à jour ; à égalité, remontée la plus ancienne d'abord (date absente en tête).
 * Retourne un NOUVEAU tableau d'items, l'entrée n'est pas modifiée.
 */
export function sortByLateness<T extends { row: Pick<PosteVersionRow, 'app_version' | 'last_seen_at' | 'poste_ref'>; info: PosteRowState }>(
  items: ReadonlyArray<T>
): T[] {
  return [...items].sort((a, b) => {
    const r = STATE_RANK[a.info.state] - STATE_RANK[b.info.state];
    if (r !== 0) return r;
    const cmpV = compareVersions(a.row.app_version, b.row.app_version);
    if (cmpV !== null && cmpV !== 0) return cmpV;
    const ta = toMs(a.row.last_seen_at) ?? -Infinity;
    const tb = toMs(b.row.last_seen_at) ?? -Infinity;
    if (ta !== tb) return ta < tb ? -1 : 1;
    return a.row.poste_ref < b.row.poste_ref ? -1 : a.row.poste_ref > b.row.poste_ref ? 1 : 0;
  });
}

// ----------------------------------------------------------------------------
// Tri interactif par colonne (clic sur les en-têtes).
// ----------------------------------------------------------------------------

export type SortKey = 'poste' | 'site' | 'version' | 'etat' | 'lastSeen' | 'user';
export type SortDir = 'asc' | 'desc';

type SortableItem = {
  row: Pick<PosteVersionRow, 'app_version' | 'last_seen_at' | 'poste_ref' | 'site_nom' | 'last_user_login'>;
  info: PosteRowState;
};

/** Texte comparable : vide/absent → null (toujours placé en fin de liste). */
function textKey(v: string | null | undefined): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t === '' ? null : t;
}

/** Compare deux clés ; une valeur absente (null) est TOUJOURS après les valeurs présentes, quel que soit le sens. */
function compareNullable<V>(a: V | null, b: V | null, cmp: (x: V, y: V) => number, dir: SortDir): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  const c = cmp(a, b);
  return dir === 'asc' ? c : -c;
}

const cmpText = (x: string, y: string): number => x.localeCompare(y, 'fr', { numeric: true, sensitivity: 'base' });

/**
 * Tri par colonne. Stable : à clé égale, l'ordre d'entrée est conservé (on passe donc en entrée
 * la liste déjà triée par défaut avec sortByLateness). Valeurs absentes toujours en fin.
 * Retourne un NOUVEAU tableau, l'entrée n'est pas modifiée.
 */
export function sortByColumn<T extends SortableItem>(items: ReadonlyArray<T>, key: SortKey, dir: SortDir): T[] {
  const get = (it: T): string | number | null => {
    switch (key) {
      case 'poste': return textKey(it.row.poste_ref);
      case 'site': return textKey(it.row.site_nom);
      case 'user': return textKey(it.row.last_user_login);
      case 'etat': return STATE_RANK[it.info.state];
      case 'lastSeen': return toMs(it.row.last_seen_at);
      case 'version': return textKey(it.row.app_version);
    }
  };
  return items
    .map((it, i) => ({ it, i }))
    .sort((a, b) => {
      let c: number;
      if (key === 'version') {
        // Version invalide/absente → en fin ; deux versions valides comparées en semver.
        const va = parseSemver(a.it.row.app_version) ? (a.it.row.app_version as string) : null;
        const vb = parseSemver(b.it.row.app_version) ? (b.it.row.app_version as string) : null;
        c = compareNullable(va, vb, (x, y) => compareVersions(x, y) ?? 0, dir);
      } else if (key === 'etat' || key === 'lastSeen') {
        c = compareNullable(get(a.it) as number | null, get(b.it) as number | null, (x, y) => x - y, dir);
      } else {
        c = compareNullable(get(a.it) as string | null, get(b.it) as string | null, cmpText, dir);
      }
      return c !== 0 ? c : a.i - b.i;
    })
    .map((x) => x.it);
}

/** Date relative en français (« il y a 3 h »). Absente/invalide → « — ». Futur proche → « à l'instant ». */
export function formatRelative(iso: string | null | undefined, nowMs: number): string {
  const ms = toMs(iso);
  if (ms === null) return '—';
  const diff = nowMs - ms;
  if (diff < 60_000) return "à l'instant";
  const min = Math.floor(diff / 60_000);
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.floor(h / 24);
  return `il y a ${d} j`;
}

/** Date absolue au format français (JJ/MM/AAAA HH:MM:SS). Absente/invalide → « — ». */
export function formatAbsolute(iso: string | null | undefined): string {
  const ms = toMs(iso);
  if (ms === null) return '—';
  return new Date(ms).toLocaleString('fr-FR');
}
