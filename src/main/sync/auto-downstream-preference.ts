import type Database from 'better-sqlite3';

/**
 * Préférence "Récupération automatique des cartes" (t_config, clé `auto_downstream_<id_user>`,
 * migration V65 de schema.ts) — résolution UNIQUE partagée par le login, le changement de rôle
 * actif (auth:setActiveRole) et l'IPC sync:getAutoDownstream (handlers.ts).
 *
 * Règle (P1-1, pilote version téléphone, 2026-11-24) :
 *  - valeur explicite en base ('true' / toute autre valeur) : toujours respectée, quel que soit
 *    le rôle (choix personnel fait dans ProfilePage) — comportement historique inchangé ;
 *  - clé ABSENTE : défaut par rôle ACTIF. Activé pour OPERATEUR_VERIFICATION (le poste doit
 *    recevoir rapidement les retraits faits ailleurs, ex. par le téléphone, sinon il propose
 *    encore « Procéder au Retrait » sur une carte déjà remise) ; désactivé pour les autres rôles
 *    (défaut historique).
 *
 * Le rôle passé ici DOIT être le rôle actif de la session serveur (getSecureCurrentUser().role,
 * maintenu par setActiveRole) — jamais une re-lecture de t_users.role (CLAUDE.md §3).
 */
export const AUTO_DOWNSTREAM_DEFAULT_ON_ROLES: ReadonlySet<string> = new Set(['OPERATEUR_VERIFICATION']);

export function autoDownstreamConfigKey(idUser: number | string): string {
  return `auto_downstream_${idUser}`;
}

/** Fonction pure : valeur stockée (undefined/null = clé absente) + rôle actif -> préférence effective. */
export function resolveAutoDownstreamPreference(
  storedValue: string | null | undefined,
  activeRole: string | null | undefined
): boolean {
  if (storedValue !== undefined && storedValue !== null) {
    return storedValue === 'true';
  }
  return !!activeRole && AUTO_DOWNSTREAM_DEFAULT_ON_ROLES.has(activeRole);
}

/** Valeur brute stockée pour ce compte (undefined si la clé n'existe pas). */
export function readStoredAutoDownstream(db: Database.Database, idUser: number | string): string | undefined {
  const row = db.prepare('SELECT value FROM t_config WHERE key = ?').get(autoDownstreamConfigKey(idUser)) as
    | { value: string }
    | undefined;
  return row ? row.value : undefined;
}

/** Lecture + résolution en un appel (login, sync:getAutoDownstream). */
export function readAutoDownstreamPreference(
  db: Database.Database,
  idUser: number | string,
  activeRole: string | null | undefined
): boolean {
  return resolveAutoDownstreamPreference(readStoredAutoDownstream(db, idUser), activeRole);
}
