import log from 'electron-log';
import { BrowserWindow } from 'electron';
import { getSupabaseClient } from '../sync/supabase-client';
import { networkMonitor } from '../sync/network-monitor';
import { getDatabase } from '../database/connection';

let heartbeatInterval: NodeJS.Timeout | null = null;
let currentSessionToken: string | null = null;
let currentUserLogin: string | null = null;
let secureCurrentUser: any = null;

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
