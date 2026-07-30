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
