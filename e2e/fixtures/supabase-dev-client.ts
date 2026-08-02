/**
 * e2e/fixtures/supabase-dev-client.ts
 *
 * Client Supabase JS pointé EXCLUSIVEMENT vers le projet Supabase de
 * DEV/STAGING dédié aux tests e2e-cloud (jamais un projet contenant des
 * données citoyennes réelles). Utilisé UNIQUEMENT par les specs
 * `allowRealSync: true` (voir e2e/fixtures/electron-app.ts) pour :
 *   1. Pré-positionner des données ZZTEST_ côté cloud avant un scénario
 *      (pull, fallback de recherche cloud),
 *   2. Vérifier après coup qu'une action de l'app (push/pull) a bien
 *      écrit/lu les bonnes données sur ce projet distant,
 *   3. Nettoyer intégralement les données ZZTEST_ créées à la fin de la
 *      session de test (le projet dev est persistant entre les runs,
 *      contrairement aux bases SQLite locales jetables sous
 *      `fs.mkdtempSync`).
 *
 * @supabase/supabase-js est une implémentation 100% JS (client HTTP, pas de
 * binding natif) : contrairement à `better-sqlite3`, aucun problème d'ABI
 * Node — ce module peut être importé directement dans ce fichier, exécuté
 * sous le Node système du test-runner Playwright.
 *
 * Identifiants repris tels quels de `.env.e2e` (projet dev dédié, RLS
 * désactivée, clé anon à portée `GRANT ALL` sur les tables applicatives —
 * voir supabase_schema.sql lignes 188-206). Aucune donnée sensible : ce
 * projet ne contient et ne contiendra jamais de données citoyennes réelles.
 */
import { createClient } from '@supabase/supabase-js';

export const E2E_CLOUD_SUPABASE_URL = 'https://zddibqgutigwxjwbojmn.supabase.co';
export const E2E_CLOUD_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpkZGlicWd1dGlnd3hqd2Jvam1uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU1OTI1MjksImV4cCI6MjEwMTE2ODUyOX0.bDbPfWF6Isudw_5XOrNI0qHFxQaZMDk4hLtEUAHlIS8';

export const supabaseDev = createClient(E2E_CLOUD_SUPABASE_URL, E2E_CLOUD_SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
});

/**
 * Assure la présence, sur le projet dev, d'un site + centre PARENTS avec
 * EXACTEMENT le même `id` que le site/centre seedés localement par
 * `seed-database.ts` (`env.seed.siteId` / `env.seed.centreId`).
 *
 * Indispensable pour les 3 scénarios :
 *  - `runDownstream()` (downstream.ts:29-61) rapatrie D'ABORD le site
 *    `t_sites` par `id` avant toute carte, et abandonne (return 0) si
 *    absent côté cloud.
 *  - `t_cartes.id_site` / `id_centre` sont des BIGINT REFERENCES sur
 *    `t_sites(id)` / `t_centres(id)` côté Postgres (supabase_schema.sql) :
 *    tout insert/upsert de carte échouerait (violation FK) sans ce parent.
 *
 * `upsert` avec `id` explicite (BIGSERIAL autorise l'insertion d'un id
 * explicite) — idempotent d'un scénario à l'autre au sein de la même
 * session de test (les 3 scénarios partagent le même site/centre).
 */
export async function ensureCloudSiteAndCentre(siteId: number, centreId: number): Promise<void> {
  const now = Date.now();
  const { error: siteErr } = await supabaseDev.from('t_sites').upsert(
    {
      id: siteId,
      nom: 'ZZTEST_QA_Terrain_Site_Cloud',
      code: `ZZTEST-QA-SITE-${now}`,
      is_active: 1,
      max_centres: 4,
      is_permanent: true,
      sync_id: `zztest-qa-site-${now}`
    },
    { onConflict: 'id' }
  );
  if (siteErr) throw new Error(`[E2E-CLOUD] Échec upsert t_sites (id=${siteId}) : ${siteErr.message}`);

  const { error: centreErr } = await supabaseDev.from('t_centres').upsert(
    {
      id: centreId,
      site_id: siteId,
      nom: 'ZZTEST_QA_Terrain_Centre_Cloud',
      numero: 1,
      sync_id: `zztest-qa-centre-${now}`
    },
    { onConflict: 'id' }
  );
  if (centreErr) throw new Error(`[E2E-CLOUD] Échec upsert t_centres (id=${centreId}) : ${centreErr.message}`);
}

export interface CloudTestCard {
  sync_id: string;
  noms: string;
  prenoms: string;
  date_naissance: string; // YYYY-MM-DD
  rangement: string;
  statut?: string;
  id_site: number;
  id_centre: number;
  contact?: string;
  num_secu?: string;
  updated_at?: string;
}

/** Insère une carte ZZTEST_ directement sur le projet Supabase dev (table t_cartes). */
export async function insertCloudCard(card: CloudTestCard): Promise<any> {
  const { data, error } = await supabaseDev
    .from('t_cartes')
    .insert({
      sync_id: card.sync_id,
      noms: card.noms,
      prenoms: card.prenoms,
      date_naissance: card.date_naissance,
      rangement: card.rangement,
      statut: card.statut || 'EN STOCK',
      id_site: card.id_site,
      id_centre: card.id_centre,
      contact: card.contact || null,
      num_secu: card.num_secu || null,
      updated_at: card.updated_at || new Date().toISOString()
    })
    .select()
    .single();
  if (error) throw new Error(`[E2E-CLOUD] Échec insertion carte cloud "${card.sync_id}" : ${error.message}`);
  return data;
}

/** Lit une carte cloud par sync_id (vérification post-action, ex. après un push). */
export async function getCloudCardBySyncId(syncId: string): Promise<any | null> {
  const { data, error } = await supabaseDev.from('t_cartes').select('*').eq('sync_id', syncId).maybeSingle();
  if (error) throw new Error(`[E2E-CLOUD] Échec lecture carte cloud "${syncId}" : ${error.message}`);
  return data;
}

/**
 * Nettoyage complet des données ZZTEST_ sur le projet dev distant (cartes,
 * centres, sites) + vérification finale qu'aucune trace ZZTEST_ ne subsiste
 * (nouvelle requête SELECT après les DELETE), conformément à la règle de
 * nettoyage stricte de la tâche.
 */
export async function cleanupAllCloudTestData(): Promise<{ residualCartes: number; residualCentres: number; residualSites: number }> {
  await supabaseDev.from('t_cartes').delete().ilike('noms', 'ZZTEST_%');
  await supabaseDev.from('t_centres').delete().ilike('nom', 'ZZTEST_%');
  await supabaseDev.from('t_sites').delete().ilike('nom', 'ZZTEST_%');

  const [cartesLeft, centresLeft, sitesLeft] = await Promise.all([
    supabaseDev.from('t_cartes').select('id_carte', { count: 'exact', head: true }).ilike('noms', 'ZZTEST_%'),
    supabaseDev.from('t_centres').select('id', { count: 'exact', head: true }).ilike('nom', 'ZZTEST_%'),
    supabaseDev.from('t_sites').select('id', { count: 'exact', head: true }).ilike('nom', 'ZZTEST_%')
  ]);

  return {
    residualCartes: cartesLeft.count || 0,
    residualCentres: centresLeft.count || 0,
    residualSites: sitesLeft.count || 0
  };
}
