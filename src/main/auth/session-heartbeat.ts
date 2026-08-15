import log from 'electron-log';
import { BrowserWindow } from 'electron';
import { getSupabaseClient } from '../sync/supabase-client';
import { networkMonitor } from '../sync/network-monitor';
import { getDatabase } from '../database/connection';
import { resolveGrantedRoles } from '../database/queries/users.queries';

let heartbeatInterval: NodeJS.Timeout | null = null;
let currentSessionToken: string | null = null;
let currentUserLogin: string | null = null;
let secureCurrentUser: any = null;

/**
 * Dernier snapshot connu des rôles accordés (t_user_roles, résolus via resolveGrantedRoles)
 * pour la session active. Alimenté exclusivement par refreshSecureCurrentUser() (jamais par
 * startSessionHeartbeat : `null` au login signifie "pas encore de référence", ce qui évite
 * un faux-positif `changed=true` lors du tout premier appel post-login). Réinitialisé à
 * `null` par stopSessionHeartbeat() pour ne jamais fuiter vers une session suivante.
 */
let secureCurrentGrantedRoles: string[] | null = null;

export function startSessionHeartbeat(user: any, sessionToken: string): void {
  // Nettoyer un intervalle existant
  stopSessionHeartbeat();

  currentSessionToken = sessionToken;
  currentUserLogin = user.login;
  
  const secureUserCopy = { ...user };
  // Traçage/audit pur : conserve le rôle DE CONNEXION (celui utilisé pour authentifier la
  // session), invariant après un éventuel changement de rôle actif via `setActiveRole`.
  // Aucun consommateur existant ne doit lire ce champ pour une décision de cantonnement —
  // seul `role` (mutable via setActiveRole) fait foi pour le cantonnement site/centre.
  secureUserCopy.loginRole = user.role;
  if (secureUserCopy.role === 'ADMINISTRATEUR_SITE' && !secureUserCopy.centre_id && secureUserCopy.site_id) {
    try {
      const db = getDatabase();
      if (db) {
        const mainCentre = db.prepare(`
          SELECT id FROM t_centres
          WHERE site_id = ?
          ORDER BY numero ASC, id ASC
          LIMIT 1
        `).get(secureUserCopy.site_id) as { id: number } | undefined;
        if (mainCentre) {
          secureUserCopy.centre_id = mainCentre.id;
        }
      }
    } catch (e) {
      log.warn("Erreur lors de la résolution du centre principal pour le heartbeat:", e);
    }
  }
  secureCurrentUser = secureUserCopy;

  log.info(`Démarrage du Heartbeat de session pour l'utilisateur : ${user.login}`);

  // Ping local toutes les 2 minutes (120 000 ms) pour la forme et traçabilité locale
  heartbeatInterval = setInterval(async () => {
    log.debug(`Heartbeat local réussi pour ${currentUserLogin}`);
  }, 2 * 60 * 1000);
}

export async function stopSessionHeartbeat(): Promise<void> {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
    log.info('Heartbeat de session arrêté.');
  }

  currentSessionToken = null;
  currentUserLogin = null;
  secureCurrentUser = null;
  secureCurrentGrantedRoles = null;
}

export function getCurrentUserLogin(): string | null {
  return currentUserLogin;
}

export function getSecureCurrentUser(): any | null {
  return secureCurrentUser;
}

/**
 * Met à jour le rôle ACTIF de la session serveur en cours (post-sélection via
 * RoleSelectorPage, pour un compte multi-rôles). Ne touche jamais à `site_id`/`centre_id` :
 * ils sont invariants par rôle pour un même compte (attachés au compte, pas au rôle — cf.
 * PK composite `(id_user, role)` de `t_user_roles`, sans colonne site_id/centre_id).
 * Le champ `loginRole` (rôle de connexion d'origine) n'est jamais modifié ici — pur
 * traçage/audit.
 * Validation des rôles autorisés : entièrement à la charge de l'appelant (handler IPC
 * `auth:setActiveRole`), cette fonction ne fait qu'appliquer la mutation.
 */
export function setActiveRole(role: string): boolean {
  if (!secureCurrentUser) return false;
  secureCurrentUser.role = role;
  return true;
}

/**
 * Rafraîchit l'instantané en mémoire de la session serveur (`secureCurrentUser`) à partir
 * de l'état LOCAL SQLite (`t_users`/`t_user_roles`), déjà tenu à jour par le cycle dédié
 * comptes/rôles (3 min, `syncEngine.triggerUserAccountsSync` → `syncUsersFromCloud`).
 * Comble le trou de sécurité/UX suivant : `secureCurrentUser` n'était jusqu'ici construit
 * qu'une seule fois, au login (`startSessionHeartbeat`), et ne reflétait donc jamais un
 * compte activé/désactivé ou un rôle ajouté/retiré côté Cloud tant que l'app n'était pas
 * fermée/rouverte — alors que ~120 handlers IPC dérivent leur cantonnement site/centre/rôle
 * de cette même référence via getSecureCurrentUser().
 *
 * Fonction STRICTEMENT SYNCHRONE (aucun await entre la lecture SQLite et la mutation des
 * champs) : la lecture better-sqlite3 est déjà synchrone, ceci garantit l'absence de
 * fenêtre de concurrence entre la lecture et la mutation in-place.
 *
 * Invariants de sécurité (cantonnement) :
 *  - Dans les branches `disabled`/`revoked`, AUCUN champ de cantonnement n'est modifié
 *    (`site_id`, `centre_id`, `role`, `loginRole`) : la terminaison de la session est de la
 *    responsabilité d'un mécanisme appelant (hors périmètre de cette fonction), pas de
 *    celle-ci — elle se contente de signaler l'état.
 *  - Dans la branche de succès, la mutation est IN PLACE sur l'objet `secureCurrentUser`
 *    existant (même pattern que setActiveRole() ci-dessus) : seuls `nom_user`/`prenom_user`
 *    (si déjà présents sur l'objet) et le snapshot module-level `secureCurrentGrantedRoles`
 *    sont mis à jour. `site_id`, `centre_id`, `role` et `loginRole` ne sont JAMAIS touchés
 *    ici (un changement de rôle actif reste l'exclusivité de setActiveRole(), validée par le
 *    handler IPC `auth:setActiveRole`).
 *
 * @returns `{ changed, revoked, disabled }` — à charge de l'appelant (étape IPC ultérieure,
 *   hors périmètre ici) de décider d'une notification renderer / déconnexion forcée.
 *   `changed` n'est jamais signalé sur le tout premier appel post-login (établissement de la
 *   référence `secureCurrentGrantedRoles`), pour éviter un faux-positif.
 */
export function refreshSecureCurrentUser(): { changed: boolean; revoked: boolean; disabled: boolean } {
  // No-op : aucune session active.
  if (!secureCurrentUser) {
    return { changed: false, revoked: false, disabled: false };
  }

  const db = getDatabase();
  if (!db) {
    // Base indisponible (cas limite) : rien de frais à comparer, on ne mute rien.
    return { changed: false, revoked: false, disabled: false };
  }

  const row = db.prepare(
    'SELECT statut_actif, role, nom_user, prenom_user FROM t_users WHERE login = ?'
  ).get(secureCurrentUser.login) as
    | { statut_actif: number; role: string; nom_user: string; prenom_user: string }
    | undefined;

  // Compte introuvable en local (suppression) : traité par prudence comme désactivé, sans
  // muter les champs de cantonnement (cf. invariant ci-dessus).
  if (!row) {
    return { changed: false, revoked: false, disabled: true };
  }

  if (row.statut_actif !== 1) {
    return { changed: false, revoked: false, disabled: true };
  }

  const freshGrantedRoles = resolveGrantedRoles(secureCurrentUser.id_user, row.role);

  // Le rôle ACTIF de la session (mutable via setActiveRole, cf. commentaire de ce fichier)
  // n'est plus autorisé -> révocation, sans mutation des champs de cantonnement.
  if (!freshGrantedRoles.includes(secureCurrentUser.role)) {
    return { changed: false, revoked: true, disabled: false };
  }

  // Détection de changement : comparaison au dernier snapshot connu des rôles accordés.
  // `secureCurrentGrantedRoles === null` signifie "premier appel post-login" -> jamais
  // signalé comme changement (établissement de la référence, pas une divergence détectée).
  const rolesChanged =
    secureCurrentGrantedRoles !== null &&
    (secureCurrentGrantedRoles.length !== freshGrantedRoles.length ||
      !secureCurrentGrantedRoles.every((r) => freshGrantedRoles.includes(r)));

  const nameChanged =
    (secureCurrentUser.nom_user !== undefined && secureCurrentUser.nom_user !== row.nom_user) ||
    (secureCurrentUser.prenom_user !== undefined && secureCurrentUser.prenom_user !== row.prenom_user);

  // Mutation IN PLACE de l'objet existant (jamais de remplacement de référence) : les ~120
  // call sites de getSecureCurrentUser() conservent leur référence sans changement de
  // comportement. INVARIANT : site_id, centre_id, role et loginRole ne sont JAMAIS touchés.
  if (secureCurrentUser.nom_user !== undefined) secureCurrentUser.nom_user = row.nom_user;
  if (secureCurrentUser.prenom_user !== undefined) secureCurrentUser.prenom_user = row.prenom_user;
  secureCurrentGrantedRoles = freshGrantedRoles;

  return { changed: rolesChanged || nameChanged, revoked: false, disabled: false };
}
