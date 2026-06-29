import { createClient, SupabaseClient } from '@supabase/supabase-js';
import log from 'electron-log';

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || '';

let supabaseInstance: SupabaseClient | null = null;
let currentAuthenticatedSiteId: number | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (!supabaseInstance) {
    if (!supabaseUrl || !supabaseAnonKey) {
      log.error('Supabase URL or Anon Key is missing in .env config.');
      throw new Error('Supabase configuration missing.');
    }
    
    // Initialisation du client avec l'anon key
    supabaseInstance = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false
      }
    });
    log.info('Supabase client initialized.');
  }
  return supabaseInstance;
}

/**
 * Connecte le client Supabase au compte de service associé au siteId local.
 * Si siteId = null, on tente de se connecter en Super Admin.
 */
export async function authenticateSupabaseSite(siteId: number | null, siteCode: string): Promise<boolean> {
  const supabase = getSupabaseClient();

  // Éviter de re-connecter si on est déjà authentifié sur ce site
  if (currentAuthenticatedSiteId === siteId && supabase.auth.getSession() !== null) {
    return true;
  }

  try {
    let email = '';
    let password = '';

    if (siteId === null || siteCode.toLowerCase() === 'superadmin') {
      email = 'superadmin@gest-in-situ.local';
      // Le mot de passe du compte de service superadmin est stocké dans .env pour la production
      password = process.env.SUPABASE_SUPERADMIN_PASSWORD || 'superadmin_secure_pass';
    } else {
      email = `site_${siteCode.toLowerCase()}@gest-in-situ.local`;
      // Mot de passe calculé ou récupéré de la configuration locale sécurisée
      password = process.env.SUPABASE_SITE_PASSWORD_PREFIX 
        ? `${process.env.SUPABASE_SITE_PASSWORD_PREFIX}_${siteCode.toLowerCase()}`
        : `password_site_${siteCode.toLowerCase()}`;
    }

    log.info(`Attempting Supabase connection for site service account: ${email}`);
    
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      log.error(`Supabase authentication failed for ${email}:`, error.message);
      return false;
    }

    if (data.session) {
      currentAuthenticatedSiteId = siteId;
      log.info(`Successfully authenticated on Supabase. JWT acquired for site: ${siteCode}`);
      return true;
    }

    return false;
  } catch (e) {
    log.error('Supabase authentication error:', e);
    return false;
  }
}

/**
 * Déconnecte le client Supabase actuel.
 */
export async function logoutSupabase(): Promise<void> {
  if (supabaseInstance) {
    await supabaseInstance.auth.signOut();
    currentAuthenticatedSiteId = null;
    log.info('Supabase session logged out.');
  }
}
