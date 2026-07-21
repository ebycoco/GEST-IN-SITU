import log from 'electron-log';
import { BrowserWindow } from 'electron';
import { getSupabaseClient } from '../sync/supabase-client';
import { networkMonitor } from '../sync/network-monitor';

let heartbeatInterval: NodeJS.Timeout | null = null;
let currentSessionToken: string | null = null;
let currentUserLogin: string | null = null;
let secureCurrentUser: any = null;

export function startSessionHeartbeat(user: any, sessionToken: string): void {
  // Nettoyer un intervalle existant
  stopSessionHeartbeat();

  currentSessionToken = sessionToken;
  currentUserLogin = user.login;
  secureCurrentUser = user;

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
