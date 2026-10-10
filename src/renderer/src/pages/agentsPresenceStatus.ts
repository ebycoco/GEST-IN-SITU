// ============================================================================
// Logique PURE de la page "Présence des Agents" (aucun import natif, aucun accès
// IPC/DOM : testable seule). Extraite de AgentsPresencePage.tsx.
//
// Définition métier : En ligne = application ouverte et connectée ;
// Hors ligne = application fermée ou agent déconnecté.
// Le statut repose UNIQUEMENT sur le battement de présence (last_heartbeat_at) et
// sur la déconnexion explicite. last_action_at (issu de t_logs, qui ne reçoit que
// les écritures CRUD de cartes) n'entre plus dans le calcul : un agent qui consulte
// sans écrire serait sinon « Inactif » en permanence.
// ============================================================================

import type { AgentPresenceRow } from '../../../shared/types';

export type PresenceStatus = 'EN_LIGNE' | 'INACTIF' | 'HORS_LIGNE';

/** Champs minimaux nécessaires au calcul du statut. */
export type PresenceStatusInput = Pick<
  AgentPresenceRow,
  'last_heartbeat_at' | 'last_login_at' | 'last_logout_at'
>;

// Le tick de présence côté poste est de 2 min : un battement < 6 min (3 ticks) reste
// « récent » même si un tick est manqué. Au-delà (6-15 min) : zone intermédiaire Inactif.
export const HEARTBEAT_ONLINE_MAX_MIN = 6;
// Au-delà de 15 min sans battement, l'application est considérée fermée.
export const HEARTBEAT_OFFLINE_MIN = 15;

// Horloge de poste agent en avance : le battement est horodaté par le poste agent, pas par
// le serveur. Un battement « dans le futur » de plus de 2 min est un signe de vie douteux :
// il est traité comme INACTIF (pas de 4e statut : widgets/compteurs/couleurs en dépendent).
// En deçà (>= -2 min) c'est une dérive normale, traitée comme âge 0 (EN_LIGNE).
// LIMITE : une horloge très en avance masque un vrai départ (l'agent reste « Inactif » au
// lieu de passer « Hors ligne » tant que le battement figé reste dans le futur) ; seule
// l'heure serveur (now() côté Supabase) corrigerait cela — hors périmètre.
export const HEARTBEAT_CLOCK_SKEW_TOLERANCE_MIN = 2;

const MS_PER_MIN = 60000;

/** Convertit un timestamp ISO en ms ; null si absent ou invalide (jamais d'exception). */
function toMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? null : ms;
}

export function computeStatus(row: PresenceStatusInput, nowMs: number): PresenceStatus {
  const heartbeatMs = toMs(row.last_heartbeat_at);
  if (heartbeatMs === null) return 'HORS_LIGNE';

  const logoutMs = toMs(row.last_logout_at);
  if (logoutMs !== null && logoutMs >= heartbeatMs) return 'HORS_LIGNE';

  const heartbeatAgeMin = (nowMs - heartbeatMs) / MS_PER_MIN;
  // Battement futur au-delà de la tolérance : signe de vie douteux → INACTIF (cf. ci-dessus).
  if (heartbeatAgeMin < -HEARTBEAT_CLOCK_SKEW_TOLERANCE_MIN) return 'INACTIF';
  if (heartbeatAgeMin >= HEARTBEAT_OFFLINE_MIN) return 'HORS_LIGNE';
  if (heartbeatAgeMin >= HEARTBEAT_ONLINE_MAX_MIN) return 'INACTIF';
  return 'EN_LIGNE';
}

/** Contenu de la cellule « Dernière déconnexion ». */
export type LogoutCell =
  | { kind: 'none' }
  | { kind: 'logout'; at: string }
  | { kind: 'closed'; lastSignAt: string | null };

/**
 * - EN_LIGNE / INACTIF : rien à afficher (« — »).
 * - HORS_LIGNE avec déconnexion valide strictement postérieure à la dernière connexion
 *   (ou connexion absente/invalide) : date de déconnexion.
 * - Sinon (pas de déconnexion, ou déconnexion d'une session antérieure) : « Fermé sans
 *   déconnexion » + dernier battement connu (null si aucun battement valide).
 */
export function computeLogoutCell(row: PresenceStatusInput, status: PresenceStatus): LogoutCell {
  if (status !== 'HORS_LIGNE') return { kind: 'none' };

  const logoutMs = toMs(row.last_logout_at);
  const loginMs = toMs(row.last_login_at);
  if (logoutMs !== null && (loginMs === null || logoutMs > loginMs)) {
    return { kind: 'logout', at: row.last_logout_at as string };
  }

  const lastSignAt = toMs(row.last_heartbeat_at) !== null ? row.last_heartbeat_at : null;
  return { kind: 'closed', lastSignAt };
}
