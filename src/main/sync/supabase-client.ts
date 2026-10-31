import { createClient, SupabaseClient } from '@supabase/supabase-js';
import log from 'electron-log';

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || '';

// ─── GARDE-FOU E2E (positionnée UNIQUEMENT par e2e/fixtures/electron-app.ts) ─
// Tous les appelants de getSupabaseClient() (upstream, downstream, outbox,
// preloadUsersFromCloud, handlers IPC...) null-check déjà systématiquement
// son retour et no-opent proprement — bloquer ce point d'entrée unique suffit
// donc à couper tout accès au projet Supabase réel (prod) pour l'ensemble de
// ces appelants, sans avoir à modifier chacun d'eux. Jamais positionnée par
// défaut en dev ou en production.
const E2E_DISABLE_SYNC = process.env.GEST_IN_SITU_E2E_DISABLE_SYNC === '1';

let supabaseInstance: SupabaseClient | null = null;

/**
 * Retourne le client Supabase initialisé, ou `null` si la configuration
 * est manquante ou si l'initialisation a échoué.
 *
 * ⚠️ CONTRAT : Cette fonction ne lève JAMAIS d'exception.
 * Tous les appelants doivent vérifier `if (!supabase) return` avant d'utiliser le client.
 */
export function getSupabaseClient(): SupabaseClient | null {
  if (E2E_DISABLE_SYNC) {
    log.warn('[SupabaseClient] getSupabaseClient() bloqué : GEST_IN_SITU_E2E_DISABLE_SYNC=1 (contexte E2E isolé).');
    return null;
  }
  if (!supabaseInstance) {
    if (!supabaseUrl || !supabaseAnonKey) {
      log.error('[SupabaseClient] URL ou Anon Key manquante dans la config .env — client non initialisé.');
      return null;
    }

    try {
      // Initialisation du client avec l'anon key
      supabaseInstance = createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false
        }
      });
      log.info('[SupabaseClient] Client Supabase initialisé avec succès.');
    } catch (e) {
      // Capture large : tout échec réseau ou d'init ne doit PAS crasher le service Electron.
      log.error('[SupabaseClient] Échec critique lors de l\'initialisation du client (crash réseau évité) :', e);
      supabaseInstance = null;
      return null;
    }
  }
  return supabaseInstance;
}

/**
 * Déconnecte le client Supabase actuel.
 */
export async function logoutSupabase(): Promise<void> {
  if (supabaseInstance) {
    await supabaseInstance.auth.signOut();
    log.info('Supabase session logged out.');
  }
}
