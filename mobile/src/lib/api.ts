// Acces serveur : connexion (gis-login puis verifyOtp) et les deux fonctions RPC de 0020.
//
// SESSION (choix documente) : supabase-js avec persistSession: false -> la session vit
// UNIQUEMENT en memoire (adaptateur memoire interne de auth-js, verifie dans
// GoTrueClient : « persistSession false -> memoryLocalStorageAdapter »). Rien n'est ecrit
// dans localStorage / sessionStorage / IndexedDB :
//   - telephone vole ou appli fermee : aucun jeton a recuperer sur l'appareil ;
//   - verrou d'inactivite : la session est fermee (signOut local) et l'instance du client
//     jetee ; deverrouiller = nouvelle connexion complete par mot de passe (gis-login,
//     limite de tentatives serveur comprise) ;
//   - contrepartie : recharger la page ou tuer l'appli impose de se reconnecter.
// autoRefreshToken: true : auth-js renouvelle le jeton tant que l'onglet est visible.
//
// RESEAU : postgrest-js ne relance JAMAIS automatiquement un POST (RETRYABLE_METHODS =
// GET/HEAD/OPTIONS) ; .rpc() envoie un POST : aucun double retrait cache. Un echec reseau
// est rendu sous la forme { data: null, status: 0 } (verifie dans postgrest-js/dist/index.mjs).

import { createClient, type EmailOtpType, type SupabaseClient } from '@supabase/supabase-js';
import { config } from './config';
import { isAllowedV1, readGisClaims, type GisClaims } from './claims';
import { issueGisLogin, type IssueConnexion } from './codes';
import { parseRecherche, type ResultatRecherche } from './cards';

export interface SessionInfo {
  login: string;
  claims: GisClaims;
  centreNom: string | null;
}

export type EchecAppel = 'reseau' | 'session' | 'role' | 'occupee' | 'serveur';
export type Appel<T> = { ok: true; data: T } | { ok: false; echec: EchecAppel };

/** Classement d'une erreur PostgREST (logique pure, tests/api.test.ts). */
export function classerErreur(status: number, code: string | undefined, message = ''): EchecAppel {
  if (status === 0) return 'reseau';
  // fn_mobile_operateur (0020) leve 42501 « session invalide » pour un jeton sans claims
  // gis_* (session expiree / fermee) et « role non autorise » pour un role retire.
  if (code === '42501') return /session invalide/i.test(message) ? 'session' : 'role';
  if (status === 401 || code === 'PGRST301' || code === 'PGRST303') return 'session';
  if (code === '55P03') return 'occupee';
  return 'serveur';
}

let client: SupabaseClient | null = null;

function nouveauClient(): SupabaseClient {
  return createClient(config.supabaseUrl, config.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: true, detectSessionInUrl: false },
  });
}

/**
 * Ferme la session et jette le client. signOut({ scope: 'local' }) revoque la session
 * de CE telephone seulement ; s'il echoue (hors ligne), auth-js garde la session : jeter
 * l'instance suffit alors, la session n'existant qu'en memoire.
 */
export async function fermerSession(): Promise<void> {
  const c = client;
  client = null;
  if (!c) return;
  try {
    await c.auth.stopAutoRefresh();
  } catch {
    // sans importance : l'instance est abandonnee
  }
  try {
    await Promise.race([c.auth.signOut({ scope: 'local' }), new Promise((r) => setTimeout(r, 4000))]);
  } catch {
    // hors ligne : la session en memoire disparait avec l'instance
  }
}

async function appelGisLogin(login: string, password: string): Promise<{ status: number; body: unknown; retry: string | null }> {
  const envoyer = (bearer: boolean) =>
    fetch(config.gisLoginUrl, {
      method: 'POST',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        apikey: config.publishableKey,
        ...(bearer ? { Authorization: `Bearer ${config.publishableKey}` } : {}),
      },
      body: JSON.stringify({ login, password }),
    });
  let r = await envoyer(false);
  // Meme repli que le test vivant E4 : un 401 de la passerelle (corps sans "ok")
  // n'est pas une reponse de gis-login ; on renvoie alors avec l'en-tete Authorization.
  let body: unknown = await r.json().catch(() => null);
  if (r.status === 401 && !(body !== null && typeof body === 'object' && 'ok' in body)) {
    const r2 = await envoyer(true);
    const body2: unknown = await r2.json().catch(() => null);
    r = r2;
    body = body2;
  }
  return { status: r.status, body, retry: r.headers.get('Retry-After') };
}

/**
 * Connexion complete : gis-login (mot de passe verifie cote serveur) -> verifyOtp
 * (session Supabase) -> controle des claims gis_* (Q3). En cas d'echec, aucune session
 * ne reste ouverte. expectedSyncId : deverrouillage, le compte doit etre le meme.
 */
export async function connecter(
  login: string,
  password: string,
  expectedSyncId?: string,
): Promise<{ ok: true; session: SessionInfo } | { ok: false; issue: IssueConnexion }> {
  if (!config.valide) return { ok: false, issue: { kind: 'config' } };
  let rep: { status: number; body: unknown; retry: string | null };
  try {
    rep = await appelGisLogin(login.trim(), password);
  } catch {
    return { ok: false, issue: { kind: 'offline' } };
  }
  const issue = issueGisLogin(rep.status, rep.body, rep.retry);
  if (issue.kind !== 'ok') return { ok: false, issue };

  const c = nouveauClient();
  let jeton: string | undefined;
  try {
    // Type renvoye par gis-login ('magiclink', chemin valide par le test vivant E4).
    // Context7 (supabase-js, GoTrueClient.verifyOtp) : 'magiclink' est deprecie, 'email'
    // est recommande pour un token_hash ; non bascule tant qu'un essai reel ne l'a pas
    // valide (voir rapport E5).
    const { data, error } = await c.auth.verifyOtp({ token_hash: issue.tokenHash, type: issue.otpType as EmailOtpType });
    if (error || !data.session) {
      await c.auth.stopAutoRefresh().catch(() => undefined);
      return { ok: false, issue: { kind: 'service' } };
    }
    jeton = data.session.access_token;
  } catch {
    await c.auth.stopAutoRefresh().catch(() => undefined);
    return { ok: false, issue: { kind: 'offline' } };
  }

  const claims = readGisClaims(jeton);
  if (!isAllowedV1(claims) || (expectedSyncId !== undefined && claims.syncId !== expectedSyncId)) {
    await c.auth.stopAutoRefresh().catch(() => undefined);
    await c.auth.signOut({ scope: 'local' }).catch(() => undefined);
    return { ok: false, issue: { kind: 'role' } };
  }

  await fermerSession();
  client = c;
  return { ok: true, session: { login: login.trim(), claims, centreNom: await nomCentre(claims.centreId) } };
}

/** Nom du centre pour la barre du haut (affichage seulement, best effort ; sinon numero). */
async function nomCentre(id: number | null): Promise<string | null> {
  if (id === null || !client) return null;
  try {
    const { data, error } = await client.from('t_centres').select('nom').eq('id', id).maybeSingle();
    if (error || !data) return null;
    const nom: unknown = (data as Record<string, unknown>)['nom'];
    return typeof nom === 'string' ? nom : null;
  } catch {
    return null;
  }
}

export interface Criteres {
  mode: 'NOM' | 'TEL';
  nom: string; // NOM : nom + prenoms normalises
  ddnIso: string; // NOM : AAAA-MM-JJ
  ddnAffiche: string; // NOM : JJ/MM/AAAA
  tel: string; // TEL : 10 chiffres
}

/** Client avec une session vivante, sinon null (session expiree non renouvelee). */
async function clientActif(): Promise<SupabaseClient | null> {
  if (!client) return null;
  try {
    const { data } = await client.auth.getSession();
    return data.session ? client : null;
  } catch {
    return null;
  }
}

export async function rechercher(cr: Criteres): Promise<Appel<ResultatRecherche>> {
  const client = await clientActif();
  if (!client) return { ok: false, echec: 'session' };
  const args =
    cr.mode === 'NOM'
      ? { p_nom: cr.nom, p_ddn: cr.ddnIso, p_tel: null }
      : { p_nom: null, p_ddn: null, p_tel: cr.tel };
  const { data, error, status } = await client.rpc('fn_mobile_rechercher_cartes', args);
  if (error) return { ok: false, echec: classerErreur(status, error.code, error.message) };
  return { ok: true, data: parseRecherche(data) };
}

export interface DemandeRetrait {
  syncId: string;
  type: 'ASSURE' | 'TIERS';
  nomRetirant: string;
  telRetirant: string; // '' = numero de la fiche (ASSURE seulement)
  rangementUrgence: string; // '' si carte classee
  requestId: string;
}

export interface ReponseRetrait {
  code: string;
  reessai: boolean;
  dateDelivrance: string | null;
}

export function parseRetrait(data: unknown): ReponseRetrait {
  const o = data !== null && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  return {
    code: typeof o['code'] === 'string' ? o['code'] : 'REPONSE_ILLISIBLE',
    reessai: o['reessai'] === true,
    dateDelivrance: typeof o['date_delivrance'] === 'string' ? o['date_delivrance'] : null,
  };
}

export async function delivrer(d: DemandeRetrait): Promise<Appel<ReponseRetrait>> {
  const client = await clientActif();
  if (!client) return { ok: false, echec: 'session' };
  const { data, error, status } = await client.rpc('fn_mobile_delivrer_carte', {
    p_sync_id: d.syncId,
    p_type_retirant: d.type,
    p_nom_retirant: d.nomRetirant,
    p_tel_retirant: d.telRetirant === '' ? null : d.telRetirant,
    p_rangement_urgence: d.rangementUrgence === '' ? null : d.rangementUrgence,
    p_request_id: d.requestId,
  });
  if (error) return { ok: false, echec: classerErreur(status, error.code, error.message) };
  return { ok: true, data: parseRetrait(data) };
}
