-- ============================================================
-- 0010_lecture_versions_postes.sql
-- GEST-IN-SITU : LECTURE des versions de postes pour l'ecran SUPER ADMIN
-- « Versions des postes » (docs/PLAN_ECRAN_VERSIONS_POSTES.md, etape 1).
-- Purement ADDITIF : deux fonctions en lecture seule, aucune table creee ni
-- modifiee, aucune donnee ecrite. Ne touche pas 0009 ni sa RPC d'ecriture
-- fn_report_client_version (qui reste FERMEE jusqu'a la Release).
--
-- DEPEND DE 0009 (table public.t_client_versions) : appliquer 0009 avant 0010.
-- Numerotation : 0010 est pris par cet ecran ; les migrations non ecrites du
-- chantier B sont decalees en 0011+ (docs/PLAN_P1_CHANTIER_B.md).
--
-- Ce que fait ce fichier :
--   1. fn_list_client_versions() : SECURITY DEFINER, STABLE, search_path
--      fige, sans parametre. Renvoie au plus 1000 lignes (les plus recentes
--      d'abord, ORDER BY last_seen_at DESC) :
--        poste_ref         = left(poste_key, 8)  -- JAMAIS la cle complete
--        app_version, site_sync_id, last_user_sync_id,
--        first_seen_at, last_seen_at, nb_reports, key_kind
--      Lignes ECARTEES :
--        - poste_key LIKE 'preuve-%' (appels de preuve P1-1b / tests) ;
--        - lignes dont site_sync_id ne correspond a AUCUN t_sites.sync_id
--          ET last_user_sync_id ne correspond a AUCUN t_users.sync_id
--          (NULL = ne correspond pas). Une ligne est gardee si l'un des deux
--          est reconnu : poste d'un site supprime mais utilisateur connu, ou
--          l'inverse, reste visible.
--      Aucun nom (site, login) n'est renvoye : la traduction sync_id -> nom
--      se fait en local cote main. client_info n'est pas renvoye.
--   2. fn_count_client_versions() : memes protections, UNE ligne toujours :
--        nb_total     = toutes les lignes de t_client_versions ;
--        nb_preuve    = lignes 'preuve-%' ecartees ;
--        nb_ignorees  = lignes hors preuve sans site ni utilisateur reconnus ;
--        nb_listables = nb_total - nb_preuve - nb_ignorees
--                       (> 1000 => la liste est tronquee).
--
-- CHOIX DE FORME (RETURNS TABLE + petite fonction de comptage, plutot que
-- des colonnes de comptage repetees sur chaque ligne) :
--   - quand toutes les lignes sont ecartees (cas reel au debut : seules des
--     lignes 'preuve-%' existent), une liste vide ne porterait AUCUN
--     compteur ; la fonction de comptage renvoie toujours une ligne ;
--   - la troncature a 1000 se lit directement (nb_listables > 1000) ;
--   - le contrat de la liste reste simple (une ligne = un poste) ;
--   - cout : deux appels REST (instantanes differents, ecart negligeable
--     pour un compteur d'information) et deux fonctions a refermer en P2.
--
-- Securite :
--   - SECURITY DEFINER (proprietaire postgres) : lit t_client_versions,
--     t_sites, t_users malgre la RLS / l'absence de droits anon ; seules
--     les colonnes ci-dessus sortent (jamais password_hash, login, nom).
--   - STABLE : Postgres refuse toute ecriture dans le corps de la fonction ;
--     aucun parametre (rien a injecter) ; LIMIT 1000.
--   - EXECUTE : REVOKE PUBLIC, GRANT anon et authenticated (les postes
--     actuels n'ont que la cle publique). t_client_versions reste illisible
--     directement (0009 inchangee).
--   - Ce qui fuit vers un porteur de la cle publique : 8 premiers caracteres
--     des cles de poste, versions, sync_id techniques de site/utilisateur,
--     horodatages, classe de cle. Aucune donnee personnelle, aucun secret.
--
-- A REFERMER EN P2 (a inscrire dans le brouillon P3,
-- docs/PLAN_P1_CHANTIER_B.md, P1-7) : quand les postes auront une session
-- authentifiee, ajouter dans les deux fonctions un controle
-- public.fn_jwt_is_super_admin() (refus sinon) et
--   REVOKE EXECUTE ON FUNCTION public.fn_list_client_versions()  FROM anon;
--   REVOKE EXECUTE ON FUNCTION public.fn_count_client_versions() FROM anon;
--
-- Idempotent : CREATE OR REPLACE FUNCTION, REVOKE/GRANT rejouables.
-- Application : comme 0008/0009, un seul bloc  BEGIN; <ce fichier> COMMIT;
-- (SET LOCAL lock_timeout = '3s' + controle en tete).
-- Retour arriere complet (aucune table touchee ; meme protection) :
--   BEGIN;
--   SET LOCAL lock_timeout = '3s';
--   DROP FUNCTION IF EXISTS public.fn_list_client_versions();
--   DROP FUNCTION IF EXISTS public.fn_count_client_versions();
--   COMMIT;
--
-- Lecture (SQL Editor ou REST /rest/v1/rpc/fn_list_client_versions) :
--   SELECT * FROM public.fn_count_client_versions();
--   SELECT * FROM public.fn_list_client_versions();
--
-- Application : dev ajadkziqaskadlzboeqo : APPLIQUEE le 2026-11-14
-- (agent-4, apply_migration) ; test SQL 14/14 ; appel REST reel avec la cle
-- publishable : liste et comptage 200, poste_ref sur 8 caracteres, table
-- directe et fn_report_client_version refusees (42501) ; dev nettoye.
-- Production itvyayakwgzvfqvdrgyv : NON appliquee (geste utilisateur).
-- Test : supabase/tests/0010_lecture_versions_postes.test.sql
-- ============================================================

-- ------------------------------------------------------------
-- 0. Protection : verrous bornes a 3 s, sinon tout est annule (55P03)
-- ------------------------------------------------------------
SET LOCAL lock_timeout = '3s';

DO $garde$
BEGIN
  IF current_setting('lock_timeout') <> '3s' THEN
    RAISE EXCEPTION '0010 : lock_timeout de protection inactif (fichier execute hors transaction). Executer en un seul bloc : BEGIN; <fichier> COMMIT;';
  END IF;
  IF to_regclass('public.t_client_versions') IS NULL
     OR to_regprocedure('public.fn_report_client_version(text,text,text,text)') IS NULL THEN
    RAISE EXCEPTION '0010 : 0009 absente (t_client_versions / fn_report_client_version) : appliquer 0009 d''abord.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 't_sites' AND column_name = 'sync_id')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 't_users' AND column_name = 'sync_id') THEN
    RAISE EXCEPTION '0010 : colonne sync_id absente de t_sites ou t_users.';
  END IF;
END;
$garde$;

-- ------------------------------------------------------------
-- 1. Liste (au plus 1000 postes, cle tronquee)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_list_client_versions()
RETURNS TABLE (
  poste_ref         TEXT,
  app_version       TEXT,
  site_sync_id      TEXT,
  last_user_sync_id TEXT,
  first_seen_at     TIMESTAMPTZ,
  last_seen_at      TIMESTAMPTZ,
  nb_reports        BIGINT,
  key_kind          TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT left(v.poste_key, 8)::text,
         v.app_version,
         v.site_sync_id,
         v.last_user_sync_id,
         v.first_seen_at,
         v.last_seen_at,
         v.nb_reports,
         v.key_kind
  FROM public.t_client_versions v
  WHERE v.poste_key NOT LIKE 'preuve-%'
    AND (EXISTS (SELECT 1 FROM public.t_sites s WHERE s.sync_id = v.site_sync_id)
         OR EXISTS (SELECT 1 FROM public.t_users u WHERE u.sync_id = v.last_user_sync_id))
  ORDER BY v.last_seen_at DESC, v.poste_key
  LIMIT 1000;
$$;

-- ------------------------------------------------------------
-- 2. Comptage (toujours une ligne)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_count_client_versions()
RETURNS TABLE (
  nb_total     BIGINT,
  nb_preuve    BIGINT,
  nb_ignorees  BIGINT,
  nb_listables BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH c AS (
    SELECT (v.poste_key LIKE 'preuve-%') AS est_preuve,
           (EXISTS (SELECT 1 FROM public.t_sites s WHERE s.sync_id = v.site_sync_id)
            OR EXISTS (SELECT 1 FROM public.t_users u WHERE u.sync_id = v.last_user_sync_id)) AS reconnu
    FROM public.t_client_versions v
  )
  SELECT count(*)::bigint,
         count(*) FILTER (WHERE est_preuve)::bigint,
         count(*) FILTER (WHERE NOT est_preuve AND NOT reconnu)::bigint,
         count(*) FILTER (WHERE NOT est_preuve AND reconnu)::bigint
  FROM c;
$$;

-- ------------------------------------------------------------
-- 3. Droits : lecture ouverte a la cle publique (a refermer en P2)
-- ------------------------------------------------------------
REVOKE ALL ON FUNCTION public.fn_list_client_versions()  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_count_client_versions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_list_client_versions()  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_count_client_versions() TO anon, authenticated;
