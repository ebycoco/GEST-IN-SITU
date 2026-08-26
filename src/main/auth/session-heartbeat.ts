import log from 'electron-log';
import { BrowserWindow } from 'electron';
import { getSupabaseClient } from '../sync/supabase-client';
import { networkMonitor } from '../sync/network-monitor';
import { getDatabase } from '../database/connection';
import { resolveGrantedRoles } from '../database/queries/users.queries';
import { heartbeatPresence, PresenceUserRef } from '../sync/presence.service';

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

/**
 * Bannière préventive d'expiration de licence de site (canal IPC
 * 'license:expiryWarning', consommé par LicenseExpiryBanner.tsx côté
 * renderer). Remplace intégralement l'ancien mécanisme `auth:warning`
 * (toast unique au login, seuil ≤30 jours, calculé jusqu'ici dans
 * authenticateUser() — users.queries.ts, retiré nettement, sans repli).
 *
 * Seuil : ≤ 3 jours avant `t_sites.expiry_date` (jamais négatif : un site
 * déjà expiré relève de `refreshSecureCurrentUser()`/licenseExpired, hors
 * périmètre ici). Exclusions : site `is_permanent = 1`, rôle SUPER ADMIN,
 * ou `site_id` absent — même garde que l'ancien code retiré de
 * users.queries.ts.
 *
 * Cadence de réapparition (après fermeture par l'utilisateur, gérée côté
 * renderer via `reappearMs`) : décidée ici à partir du rôle ACTIF de la
 * session (`user.role`, mutable via setActiveRole) — 60s pour
 * ADMINISTRATEUR_SITE, 5 min pour tout autre rôle concerné.
 *
 * Réutilisation stricte du tick périodique déjà existant de ce fichier
 * (politique Low-Memory CLAUDE.md §2 — aucun nouveau timer créé) : appelée
 * à la fois au tout début de startSessionHeartbeat() (premier affichage
 * sans attendre le prochain tick) et à chaque tick de heartbeatInterval.
 *
 * Bloc STRICTEMENT ADDITIF et isolé : lecture seule sur t_sites, aucune
 * mutation de secureCurrentUser ni interaction avec refreshSecureCurrentUser()
 * (léger doublon de calcul de date assumé plutôt que de toucher à ce code de
 * sécurité déjà validé — cf. tests/session-heartbeat-license-site.test.ts).
 *
 * @param user - Référence utilisateur courante (role/site_id) : soit
 *   secureUserCopy (premier appel, avant assignation à secureCurrentUser),
 *   soit getSecureCurrentUser() (tick périodique, rôle actif à jour via
 *   setActiveRole()).
 */
function checkAndPushLicenseExpiryWarning(user: any): void {
  if (!user || user.role === 'SUPER ADMIN' || !user.site_id) return;

  const db = getDatabase();
  if (!db) return;

  try {
    const site = db.prepare(
      'SELECT expiry_date, is_permanent FROM t_sites WHERE id = ?'
    ).get(user.site_id) as { expiry_date: string | null; is_permanent: number } | undefined;

    if (!site || site.is_permanent === 1 || !site.expiry_date) return;

    const now = new Date();
    const expiry = new Date(site.expiry_date);
    const timeDiff = expiry.getTime() - now.getTime();
    const daysLeft = Math.ceil(timeDiff / (1000 * 3600 * 24));

    // Hors fenêtre (trop tôt, ou déjà expiré — cf. commentaire ci-dessus).
    if (daysLeft < 0 || daysLeft > 3) return;

    const formattedDate = expiry.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
    const message = `Attention, votre licence expire le ${formattedDate}. Veuillez contacter le super administrateur pour procéder au renouvellement.`;
    const reappearMs = user.role === 'ADMINISTRATEUR_SITE' ? 60 * 1000 : 5 * 60 * 1000;

    BrowserWindow.getAllWindows().forEach(w => w.webContents.send('license:expiryWarning', {
      message,
      expiryDate: site.expiry_date,
      daysLeft,
      reappearMs
    }));
  } catch (e) {
    log.warn("Erreur lors du calcul de la bannière d'expiration de licence:", e);
  }
}

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

  // Présence agents (câblage de src/main/sync/presence.service.ts, hors périmètre de ce
  // fichier pour son implémentation interne) : heartbeatPresence()/recordPresenceLogout()
  // ont besoin d'un `sync_id` non vide pour identifier la ligne Supabase à mettre à jour.
  // Or authenticateUser() (users.queries.ts, contrat de retour existant VERROUILLÉ — cf.
  // CLAUDE.md, non modifié ici) ne renvoie pas ce champ dans l'objet `user` reçu en
  // paramètre. Résolu ici en AJOUT STRICTEMENT ADDITIF sur `secureUserCopy` (aucun champ
  // existant modifié — même précédent que `secureCurrentGrantedRoles` dans ce fichier),
  // suivant exactement le même schéma que la résolution du centre principal ci-dessus.
  // Silencieux si indisponible (ex. ROOT failsafe, sans ligne t_users) : la garde plus bas
  // (tick du heartbeat) saute alors simplement l'appel à heartbeatPresence().
  if (!secureUserCopy.sync_id && secureUserCopy.id_user) {
    try {
      const db = getDatabase();
      if (db) {
        const row = db.prepare('SELECT sync_id FROM t_users WHERE id_user = ?').get(secureUserCopy.id_user) as { sync_id: string } | undefined;
        if (row?.sync_id) {
          secureUserCopy.sync_id = row.sync_id;
        }
      }
    } catch (e) {
      log.warn("Erreur lors de la résolution du sync_id pour la présence agents:", e);
    }
  }

  secureCurrentUser = secureUserCopy;

  // Bannière licence (voir checkAndPushLicenseExpiryWarning ci-dessus) : premier affichage
  // immédiat au login, sans attendre le prochain tick du setInterval ci-dessous.
  checkAndPushLicenseExpiryWarning(secureUserCopy);

  log.info(`Démarrage du Heartbeat de session pour l'utilisateur : ${user.login}`);

  // Ping local toutes les 2 minutes (120 000 ms) pour la forme et traçabilité locale
  heartbeatInterval = setInterval(() => {
    log.debug(`Heartbeat local réussi pour ${currentUserLogin}`);

    // Présence agents (Supabase, fire-and-forget) : réutilisation stricte de ce tick
    // existant (politique low-memory CLAUDE.md §2 — aucun nouveau timer créé).
    // heartbeatPresence() ne retourne JAMAIS de Promise (signature `void`) et catche toute
    // erreur réseau/Supabase en interne (cf. presence.service.ts, décision D2) : ne JAMAIS
    // l'await. No-op silencieux si aucune session active ou si le sync_id n'a pas pu être
    // résolu ci-dessus (ex. ROOT failsafe).
    const activeUser = getSecureCurrentUser();

    // Bannière licence (voir checkAndPushLicenseExpiryWarning ci-dessus) : réutilisation
    // stricte de ce tick existant, indépendante de la présence agents ci-dessous.
    checkAndPushLicenseExpiryWarning(activeUser);

    if (activeUser?.sync_id) {
      const presenceUser: PresenceUserRef = {
        sync_id: activeUser.sync_id,
        login: activeUser.login,
        site_id: activeUser.site_id ?? null,
        centre_id: activeUser.centre_id ?? null,
        role: activeUser.role,
      };
      heartbeatPresence(presenceUser);
    }
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
 * Expose le dernier snapshot connu des rôles accordés (t_user_roles résolus), alimenté
 * exclusivement par refreshSecureCurrentUser() (cf. commentaire de `secureCurrentGrantedRoles`
 * ci-dessus). Ajout STRICTEMENT ADDITIF : ne modifie ni la signature ni le comportement de
 * refreshSecureCurrentUser(). Retourne `null` tant qu'aucun rafraîchissement post-login n'a
 * encore eu lieu (avant le premier tick du cycle comptes/rôles de 3 min) — l'appelant (canal
 * IPC `auth:session-updated` / handler `auth:getSessionSnapshot`) doit prévoir un repli sur
 * les rôles connus au login dans ce cas.
 */
export function getCurrentGrantedRoles(): string[] | null {
  return secureCurrentGrantedRoles;
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
 * @returns `{ changed, revoked, disabled, siteSuspended, licenseExpired }` — à charge de
 *   l'appelant (étape IPC ultérieure, hors périmètre ici) de décider d'une notification
 *   renderer / déconnexion forcée.
 *   `changed` n'est jamais signalé sur le tout premier appel post-login (établissement de la
 *   référence `secureCurrentGrantedRoles`), pour éviter un faux-positif.
 *   `siteSuspended`/`licenseExpired` répliquent fidèlement la même vérification que
 *   `authenticateUser()` (users.queries.ts), appliquée ici à une session déjà ouverte : lecture
 *   seule sur `t_sites`, aucune mutation des champs de cantonnement de `secureCurrentUser`.
 */
export function refreshSecureCurrentUser(): {
  changed: boolean;
  revoked: boolean;
  disabled: boolean;
  siteSuspended: boolean;
  licenseExpired: boolean;
} {
  // No-op : aucune session active.
  if (!secureCurrentUser) {
    return { changed: false, revoked: false, disabled: false, siteSuspended: false, licenseExpired: false };
  }

  const db = getDatabase();
  if (!db) {
    // Base indisponible (cas limite) : rien de frais à comparer, on ne mute rien.
    return { changed: false, revoked: false, disabled: false, siteSuspended: false, licenseExpired: false };
  }

  const row = db.prepare(
    'SELECT statut_actif, role, nom_user, prenom_user FROM t_users WHERE login = ?'
  ).get(secureCurrentUser.login) as
    | { statut_actif: number; role: string; nom_user: string; prenom_user: string }
    | undefined;

  // Compte introuvable en local (suppression) : traité par prudence comme désactivé, sans
  // muter les champs de cantonnement (cf. invariant ci-dessus).
  if (!row) {
    return { changed: false, revoked: false, disabled: true, siteSuspended: false, licenseExpired: false };
  }

  if (row.statut_actif !== 1) {
    return { changed: false, revoked: false, disabled: true, siteSuspended: false, licenseExpired: false };
  }

  // VERIFICATION SITE ACTIF ET LICENCE — même logique exacte que authenticateUser()
  // (users.queries.ts:106-116), répliquée ici en lecture seule pour une session déjà ouverte.
  // Aucune mutation des champs de cantonnement (site_id/centre_id/role/loginRole).
  if (secureCurrentUser.role !== 'SUPER ADMIN' && secureCurrentUser.site_id) {
    const site = db.prepare(
      'SELECT is_active, expiry_date, is_permanent FROM t_sites WHERE id = ?'
    ).get(secureCurrentUser.site_id) as
      | { is_active: number; expiry_date: string | null; is_permanent: number }
      | undefined;

    if (site) {
      if (site.is_active === 0) {
        return { changed: false, revoked: false, disabled: false, siteSuspended: true, licenseExpired: false };
      }

      if (site.is_permanent !== 1 && site.expiry_date) {
        const now = new Date();
        const expiry = new Date(site.expiry_date);
        if (now > expiry) {
          return { changed: false, revoked: false, disabled: false, siteSuspended: false, licenseExpired: true };
        }
      }
    }
  }

  const freshGrantedRoles = resolveGrantedRoles(secureCurrentUser.id_user, row.role);

  // Le rôle ACTIF de la session (mutable via setActiveRole, cf. commentaire de ce fichier)
  // n'est plus autorisé -> révocation, sans mutation des champs de cantonnement.
  if (!freshGrantedRoles.includes(secureCurrentUser.role)) {
    return { changed: false, revoked: true, disabled: false, siteSuspended: false, licenseExpired: false };
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

  return { changed: rolesChanged || nameChanged, revoked: false, disabled: false, siteSuspended: false, licenseExpired: false };
}
