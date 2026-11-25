// Acces serveur : connexion (gis-login puis verifyOtp) et les deux fonctions RPC de 0020.
//
// SESSION (choix documente, revise apres essai reel Android/Chrome) : supabase-js avec
// persistSession: true et auth.storage = window.sessionStorage (lib/stockageSession.ts),
// cle « gis-mobile-auth ». Jamais localStorage ni IndexedDB :
//   - actualiser la page (bouton, ou geste « glisser vers le bas ») ne deconnecte plus :
//     au demarrage, restaurerSession() relit la session de l'onglet et revalide les claims
//     gis_* comme apres une connexion normale ;
//   - sessionStorage est propre a l'onglet et efface a sa fermeture (appli fermee, onglet
//     ferme : plus de jeton sur l'appareil) ;
//   - verrou d'inactivite (15 min) : l'heure de derniere activite est aussi gardee dans
//     sessionStorage ; au rechargement, delai depasse -> session fermee et effacee, ecran
//     de connexion (actualiser ne contourne pas le verrou) ;
//   - verrou / deconnexion : signOut local + effacement explicite de toutes les cles
//     « gis-mobile-* » (fermerSession) ;
//   - CONTREPARTIE : tant que l'onglet est ouvert, un jeton d'acces et un jeton de
//     renouvellement sont lisibles par du JavaScript de cette origine (XSS) et par une
//     personne qui ouvre les outils de developpement du navigateur ; non stockes : cartes
//     et resultats de recherche (memoire React seulement).
// autoRefreshToken: true : auth-js renouvelle le jeton tant que l'onglet est visible.
//
// RESEAU : postgrest-js ne relance JAMAIS automatiquement un POST (RETRYABLE_METHODS =
// GET/HEAD/OPTIONS) ; .rpc() envoie un POST : aucun double retrait cache. Un echec reseau
// est rendu sous la forme { data: null, status: 0 } (verifie dans postgrest-js/dist/index.mjs).
//
// DELAI MAXIMAL (audit E6 P2-4) : chaque appel reseau est abandonne apres DELAI_APPEL_MS.
// - RPC : .abortSignal(AbortSignal.timeout(...)) (postgrest-js 2.x, PostgrestTransformBuilder).
//   L'abandon (AbortError / TimeoutError) est rendu { error, status: 0 } (postgrest-js
//   index.mjs, branche catch de then()) -> classerErreur -> 'reseau'. Pendant un retrait,
//   App.tsx mene alors a « Resultat inconnu » (l'ecriture a peut-etre eu lieu cote serveur).
// - gis-login (fetch) : AbortController + setTimeout couvrant envoi ET lecture du corps ;
//   l'abandon leve une exception -> connecter() rend { kind: 'offline' }.

import { createClient, type EmailOtpType, type SupabaseClient } from '@supabase/supabase-js';
import { config } from './config';
import { isAllowedV1, readGisClaims, type GisClaims } from './claims';
import { issueGisLogin, type IssueConnexion } from './codes';
import { parseRecherche, type ResultatRecherche } from './cards';
import { parseStats, type StatsOperateur } from './stats';
import { IDLE_TIMEOUT_MS, inactiviteDepassee } from './idleLock';
import {
  CLE_AUTH,
  adaptateurAuth,
  ecrireActivite,
  ecrireLogin,
  effacerActivite,
  effacerStockage,
  lireActivite,
  lireLogin,
} from './stockageSession';

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

/** Delai maximal d'un appel reseau (ms). */
export const DELAI_APPEL_MS = 30_000;

let client: SupabaseClient | null = null;
// Incremente a chaque client installe : un nettoyage tardif (fermeture lente, hors ligne)
// n'efface pas le stockage si une session plus recente a ete ouverte entre-temps.
let epoque = 0;

function nouveauClient(): SupabaseClient {
  return createClient(config.supabaseUrl, config.publishableKey, {
    // Session dans l'onglet (sessionStorage) : survit a l'actualisation, effacee a la
    // fermeture de l'onglet. Context7 (supabase-js, GoTrueClient) : storage / storageKey /
    // persistSession ; auth-js lit la session au demarrage (getSession) via ce storage.
    auth: {
      persistSession: true,
      storage: adaptateurAuth(),
      storageKey: CLE_AUTH,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
}

/** Abandonne une instance : arret du renouvellement, signOut local borne, effacement des cles. */
async function fermerInstance(c: SupabaseClient, delaiMs: number): Promise<void> {
  const e = epoque;
  try {
    await c.auth.stopAutoRefresh();
  } catch {
    // sans importance : l'instance est abandonnee
  }
  try {
    await Promise.race([c.auth.signOut({ scope: 'local' }), new Promise((r) => setTimeout(r, delaiMs))]);
  } catch {
    // hors ligne : on efface quand meme le stockage ci-dessous
  }
  // Effacement explicite meme si signOut a echoue / expire : aucun jeton ne doit rester
  // dans l'onglet apres un verrou ou une deconnexion.
  if (e === epoque) effacerStockage();
}

/**
 * Ferme la session et jette le client. signOut({ scope: 'local' }) revoque la session
 * de CE telephone seulement ; que le serveur reponde ou non, toutes les cles
 * « gis-mobile-* » sont ensuite supprimees de sessionStorage.
 * L'activite et l'identifiant sont effaces TOUT DE SUITE (synchrone) : un rechargement
 * pendant la fermeture (jusqu'a 4 s hors ligne) trouve une activite inconnue -> refuse.
 */
export async function fermerSession(): Promise<void> {
  const c = client;
  client = null;
  effacerActivite();
  if (!c) {
    effacerStockage();
    return;
  }
  await fermerInstance(c, 4000);
}

/**
 * Restauration au demarrage (page rechargee). Rend la session si TOUT est valide :
 * session presente dans l'onglet, delai d'inactivite non depasse, jeton valide ou
 * renouvelable, claims gis_* conformes (role OPERATEUR_VERIFICATION, site). Sinon tout est
 * efface et on rend null (ecran de connexion, sans erreur bloquante). Ne leve jamais.
 * Appels simultanes (React StrictMode en developpement) : une seule restauration.
 */
let restaurationEnCours: Promise<{ session: SessionInfo; derniereActivite: number } | null> | null = null;

export function restaurerSession(): Promise<{ session: SessionInfo; derniereActivite: number } | null> {
  if (!restaurationEnCours) {
    restaurationEnCours = restaurer().finally(() => {
      restaurationEnCours = null;
    });
  }
  return restaurationEnCours;
}

async function restaurer(): Promise<{ session: SessionInfo; derniereActivite: number } | null> {
  if (!config.valide) {
    effacerStockage();
    return null;
  }
  const derniere = lireActivite();
  const c = nouveauClient();
  try {
    if (inactiviteDepassee(derniere, Date.now(), IDLE_TIMEOUT_MS)) throw new Error('inactivite');
    // getSession : lit le stockage ; jeton expire -> renouvellement par le jeton de
    // renouvellement (reseau). Echec (hors ligne, jeton refuse) -> pas de session.
    const { data, error } = await c.auth.getSession();
    if (error || !data.session || derniere === null) throw new Error('session');
    const claims = readGisClaims(data.session.access_token);
    if (!isAllowedV1(claims)) throw new Error('claims');
    await fermerClientPrecedent();
    client = c;
    epoque++;
    return {
      session: { login: lireLogin() ?? 'Opérateur', claims, centreNom: await nomCentre(claims.centreId) },
      derniereActivite: derniere,
    };
  } catch {
    // Les cles de l'onglet sont rendues inutilisables TOUT DE SUITE ; la revocation cote
    // serveur est tentee ensuite, bornee a 2 s (hors ligne : on passe a l'ecran de connexion).
    effacerActivite();
    await fermerInstance(c, 2000);
    return null;
  }
}

/** Evite deux instances actives sur la meme cle de stockage (cas anormal : client deja ouvert). */
async function fermerClientPrecedent(): Promise<void> {
  const ancien = client;
  client = null;
  if (!ancien) return;
  try {
    await ancien.auth.stopAutoRefresh();
  } catch {
    // instance abandonnee
  }
}

async function appelGisLogin(login: string, password: string): Promise<{ status: number; body: unknown; retry: string | null }> {
  // Un seul delai pour l'ensemble (envoi(s) + lecture des corps) : au-dela, fetch ou
  // r.json() rejette (AbortError) et l'appelant rend « hors-ligne ». La minuterie est
  // toujours liberee (finally) pour ne rien laisser tourner en memoire.
  const ctrl = new AbortController();
  const minuterie = setTimeout(() => ctrl.abort(), DELAI_APPEL_MS);
  const envoyer = (bearer: boolean) =>
    fetch(config.gisLoginUrl, {
      method: 'POST',
      cache: 'no-store',
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        apikey: config.publishableKey,
        ...(bearer ? { Authorization: `Bearer ${config.publishableKey}` } : {}),
      },
      body: JSON.stringify({ login, password }),
    });
  // Corps illisible -> null ; mais un abandon (delai depasse) pendant la lecture doit
  // remonter comme une erreur reseau, pas comme une reponse vide.
  const lireCorps = (r: Response): Promise<unknown> =>
    r.json().catch((e: unknown) => {
      if (ctrl.signal.aborted) throw e;
      return null;
    });
  try {
    let r = await envoyer(false);
    // Meme repli que le test vivant E4 : un 401 de la passerelle (corps sans "ok")
    // n'est pas une reponse de gis-login ; on renvoie alors avec l'en-tete Authorization.
    let body: unknown = await lireCorps(r);
    if (r.status === 401 && !(body !== null && typeof body === 'object' && 'ok' in body)) {
      const r2 = await envoyer(true);
      const body2: unknown = await lireCorps(r2);
      r = r2;
      body = body2;
    }
    return { status: r.status, body, retry: r.headers.get('Retry-After') };
  } finally {
    clearTimeout(minuterie);
  }
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

  // Ancienne session fermee AVANT d'ouvrir la nouvelle : les deux instances partagent la
  // meme cle de stockage, une fermeture tardive effacerait la session neuve.
  await fermerSession();
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
    effacerStockage();
    return { ok: false, issue: { kind: 'role' } };
  }

  client = c;
  epoque++;
  // Activite initiale + identifiant : un rechargement juste apres la connexion restaure la session.
  ecrireActivite(Date.now());
  ecrireLogin(login.trim());
  return { ok: true, session: { login: login.trim(), claims, centreNom: await nomCentre(claims.centreId) } };
}

/** Nom du centre pour la barre du haut (affichage seulement, best effort ; sinon numero). */
async function nomCentre(id: number | null): Promise<string | null> {
  if (id === null || !client) return null;
  try {
    const { data, error } = await client
      .from('t_centres')
      .select('nom')
      .eq('id', id)
      .abortSignal(AbortSignal.timeout(DELAI_APPEL_MS))
      .maybeSingle();
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
  const { data, error, status } = await client
    .rpc('fn_mobile_rechercher_cartes', args)
    .abortSignal(AbortSignal.timeout(DELAI_APPEL_MS));
  if (error) return { ok: false, echec: classerErreur(status, error.code, error.message) };
  return { ok: true, data: parseRecherche(data) };
}

/**
 * « Vue d'ensemble » : compteurs + travail du jour de l'operateur connecte (RPC sans
 * parametre, lecture seule). Meme delai maximal et meme classement d'erreurs que les autres
 * appels ; ne leve jamais (une exception inattendue est rendue comme un echec reseau, pour
 * ne jamais laisser un indicateur « en cours » bloque cote App).
 */
export async function mesStats(): Promise<Appel<StatsOperateur>> {
  const client = await clientActif();
  if (!client) return { ok: false, echec: 'session' };
  try {
    const { data, error, status } = await client
      .rpc('fn_mobile_mes_stats')
      .abortSignal(AbortSignal.timeout(DELAI_APPEL_MS));
    if (error) return { ok: false, echec: classerErreur(status, error.code, error.message) };
    return { ok: true, data: parseStats(data) };
  } catch {
    return { ok: false, echec: 'reseau' };
  }
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
  // Delai depasse -> status 0 -> 'reseau' -> « Resultat inconnu » (App.tsx confirmer) :
  // le POST n'est jamais relance automatiquement, le MEME request_id sert a « Verifier ».
  const { data, error, status } = await client
    .rpc('fn_mobile_delivrer_carte', {
      p_sync_id: d.syncId,
      p_type_retirant: d.type,
      p_nom_retirant: d.nomRetirant,
      p_tel_retirant: d.telRetirant === '' ? null : d.telRetirant,
      p_rangement_urgence: d.rangementUrgence === '' ? null : d.rangementUrgence,
      p_request_id: d.requestId,
    })
    .abortSignal(AbortSignal.timeout(DELAI_APPEL_MS));
  if (error) return { ok: false, echec: classerErreur(status, error.code, error.message) };
  return { ok: true, data: parseRetrait(data) };
}
