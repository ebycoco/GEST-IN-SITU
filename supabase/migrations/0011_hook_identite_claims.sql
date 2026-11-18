-- ============================================================
-- 0011_hook_identite_claims.sql
-- GEST-IN-SITU : identite cloud de la PERSONNE + hook "custom access token"
-- (chantier B, P1-5, objets D, F et G de l'annexe B de
-- docs/PLAN_P1_CHANTIER_B.md). Purement ADDITIF : aucune table metier
-- modifiee, aucune politique RLS existante touchee, aucun trigger pose sur
-- une table metier.
--
-- Principe (decisions D3, Q3, Q4, Q5 ; preparation PWA) :
--   - le jeton suit la PERSONNE (sync_id de t_users), jamais le poste : aucun
--     poste_key dans les claims ;
--   - uniquement des identifiants CLOUD (t_sites.id / t_centres.id lus dans
--     le cloud + leurs sync_id), jamais un id local de poste ;
--   - la session Auth est creee par l'Edge Function gis-login (passage
--     suivant) : generateLink -> token_hash -> verifyOtp fait par le POSTE
--     (Q3). Le hook ci-dessous s'execute a chaque emission de jeton (login ET
--     token_refresh) et REFUSE (403) si le compte est inconnu, inactif, sans
--     site (hors SUPER ADMIN) ou si la derniere connexion EN LIGNE (mot de
--     passe verifie par gis-login) date de plus de 30 jours (D3).
--
-- Ce que fait ce fichier :
--   1. t_auth_identity : auth.users.id -> t_users.sync_id (une personne = un
--      compte miroir, C7/C8) + last_online_login_at (ecrit UNIQUEMENT par
--      gis-login via service_role, jamais par anon/authenticated : c'est la
--      seule source de la regle des 30 jours ; t_users.last_login est
--      ecrivable par la cle anon, donc non fiable). RLS active SANS
--      politique, REVOKE ALL anon/authenticated.
--   2. fn_auth_identity_upsert(auth_user_id, user_sync_id) : SECURITY
--      DEFINER, EXECUTE service_role seulement. Appelee par gis-login apres
--      verification du mot de passe : cree/met a jour la ligne et pose
--      last_online_login_at = now(). Refuse (false) si le compte t_users
--      n'existe pas ou est inactif, ou si ce sync_id est deja lie a un AUTRE
--      compte Auth.
--   3. custom_access_token_hook(event jsonb) : SECURITY DEFINER (proprietaire
--      postgres : lit t_users/t_user_roles/t_sites/t_centres sans ajouter de
--      politique pour supabase_auth_admin sur ces tables partagees), STABLE
--      (n'ecrit rien), search_path = '' (tout est qualifie). EXECUTE accorde
--      a supabase_auth_admin SEULEMENT ; REVOKE PUBLIC, anon, authenticated.
--      Echec FERME : toute erreur interne -> refus 403 (jamais de jeton sans
--      claims gis_*). Messages generiques, aucune donnee personnelle.
--      Claims ajoutees (niveau racine, a cote des claims obligatoires que le
--      hook conserve telles quelles) :
--        gis_v                  = 1 (version du format, pour le client et RLS)
--        gis_sync_id            = t_users.sync_id
--        gis_site_id            = t_sites.id CLOUD (bigint) ou null (SA)
--        gis_site_sync_id       = t_sites.sync_id ou null (SA)
--        gis_centre_id          = t_centres.id CLOUD ou null
--        gis_centre_sync_id     = t_centres.sync_id ou null
--        gis_primary_role       = t_users.role
--        gis_roles              = tableau trie, sans doublon :
--                                 t_users.role UNION t_user_roles.role
--                                 (P1-3 : le role principal peut manquer dans
--                                 t_user_roles)
--        gis_is_super_admin     = 'SUPER ADMIN' dans gis_roles
--        gis_statut_actif       = true (sinon le jeton est refuse)
--        gis_last_online_login  = epoch (s) de last_online_login_at
--      Pourquoi id ET sync_id : les tables metier filtrables portent un id
--      numerique (t_cartes.id_site / id_centre, t_logs.site_id / centre_id,
--      t_user_presence.site_id / centre_id, t_users.site_id) ; le sync_id est
--      l'identifiant stable cote client / PWA. P1-6 (0013) filtrera sur
--      gis_site_id (Q4 : filtre par site seulement).
--      Centre incoherent (centre absent ou d'un autre site) : claims centre a
--      null, le jeton reste delivre (P1-6 ne filtre que par site, Q4).
--   4. Fonctions de lecture des claims pour la RLS (SECURITY INVOKER, STABLE,
--      search_path fige) ; elles ne font confiance aux claims gis_* QUE si
--      role = 'authenticated' et gis_v present (une cle anon n'en a jamais) :
--        fn_jwt_sync_id()         -> text ou null
--        fn_jwt_site_id()         -> bigint ou null
--        fn_jwt_site_sync_id()    -> text ou null
--        fn_jwt_centre_id()       -> bigint ou null
--        fn_jwt_roles()           -> text[] (vide si absent)
--        fn_jwt_is_super_admin()  -> boolean (false si absent)
--      EXECUTE : authenticated (+ service_role), REVOKE PUBLIC et anon.
--      (Les fonctions SECURITY DEFINER de 0010 / brouillon P3 les appellent
--      en tant que proprietaire : pas besoin d'EXECUTE anon.)
--
-- CE FICHIER N'ACTIVE PAS LE HOOK. Activation = geste utilisateur dans le
-- tableau de bord : Authentication > Hooks > "Customize Access Token (JWT)
-- Claims hook" > type Postgres, schema public, fonction
-- custom_access_token_hook. Dev d'abord ; prod seulement apres P1-6 et
-- l'audit agent-9 (P1-5). Une fois active, TOUTE emission de jeton Auth du
-- projet passe par ce hook : un utilisateur Auth sans ligne
-- t_auth_identity est refuse (voulu : seuls les comptes miroirs existent).
--
-- Limites connues (a traiter plus tard, voir rapport P1-5) :
--   - un jeton deja emis reste valable jusqu'a son expiration (1 h, C6) meme
--     si le compte est desactive entre-temps ;
--   - les roles NON SUPER ADMIN de t_users / t_user_roles restent ecrivables
--     par la cle anon jusqu'a P3 (0007 ne protege que SUPER ADMIN) : un
--     porteur de la cle publique peut encore s'attribuer un role de site.
--     Les claims ne sont donc pas plus fiables que t_users tant que P3 n'est
--     pas fait.
--
-- Idempotent : CREATE TABLE/INDEX IF NOT EXISTS, CREATE OR REPLACE FUNCTION,
-- REVOKE/GRANT rejouables.
-- Application : comme 0008-0010, un seul bloc  BEGIN; <ce fichier> COMMIT;
-- (SET LOCAL lock_timeout = '3s' + controle en tete). Verrou le plus fort :
-- la cle etrangere vers auth.users (ShareRowExclusiveLock court sur
-- auth.users a la creation de t_auth_identity). Aucun verrou sur une table
-- metier.
-- Retour arriere complet (desactiver d'abord le hook dans le tableau de
-- bord, sinon TOUTE connexion Auth echoue ; retirer 0012 avant, elle utilise
-- fn_jwt_is_super_admin) :
--   BEGIN;
--   SET LOCAL lock_timeout = '3s';
--   DROP FUNCTION IF EXISTS public.custom_access_token_hook(jsonb);
--   DROP FUNCTION IF EXISTS public.fn_auth_identity_upsert(uuid, text);
--   DROP FUNCTION IF EXISTS public.fn_jwt_sync_id();
--   DROP FUNCTION IF EXISTS public.fn_jwt_site_id();
--   DROP FUNCTION IF EXISTS public.fn_jwt_site_sync_id();
--   DROP FUNCTION IF EXISTS public.fn_jwt_centre_id();
--   DROP FUNCTION IF EXISTS public.fn_jwt_roles();
--   DROP FUNCTION IF EXISTS public.fn_jwt_is_super_admin();
--   DROP FUNCTION IF EXISTS public.fn_jwt_gis_claims();
--   DROP TABLE IF EXISTS public.t_auth_identity;
--   COMMIT;
--   (Les utilisateurs Auth miroirs eventuels restent dans auth.users :
--   les supprimer par le tableau de bord si voulu.)
--
-- Sources (search_docs Supabase, 2026-11-18) : guide "Custom Access Token
-- Hook" (entree user_id / claims / authentication_method ; claims
-- obligatoires iss, aud, exp, iat, sub, role, aal, session_id, email,
-- phone, is_anonymous ; refus par {"error":{"http_code":403,"message":..}} ;
-- GRANT EXECUTE a supabase_auth_admin, REVOKE authenticated, anon, public).
--
-- Application : dev ajadkziqaskadlzboeqo : appliquee le 2026-11-18 (MCP
-- apply_migration, PostgreSQL 17.11, hook NON active dans Auth) ; voir
-- supabase/migrations/README.md.
-- Production itvyayakwgzvfqvdrgyv : NON appliquee (geste utilisateur, apres
-- P1-6 et audit agent-9).
-- Test : supabase/tests/0011_hook_identite_claims.test.sql
-- ============================================================

-- ------------------------------------------------------------
-- 0. Protection : verrous bornes a 3 s, sinon tout est annule (55P03)
-- ------------------------------------------------------------
SET LOCAL lock_timeout = '3s';

DO $garde$
BEGIN
  IF current_setting('lock_timeout') <> '3s' THEN
    RAISE EXCEPTION '0011 : lock_timeout de protection inactif (fichier execute hors transaction). Executer en un seul bloc : BEGIN; <fichier> COMMIT;';
  END IF;
  IF to_regclass('public.t_users') IS NULL OR to_regclass('public.t_user_roles') IS NULL
     OR to_regclass('public.t_sites') IS NULL OR to_regclass('public.t_centres') IS NULL THEN
    RAISE EXCEPTION '0011 : tables t_users / t_user_roles / t_sites / t_centres attendues.';
  END IF;
  IF to_regclass('auth.users') IS NULL THEN
    RAISE EXCEPTION '0011 : auth.users absente (projet Supabase attendu).';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_auth_admin') THEN
    RAISE EXCEPTION '0011 : role supabase_auth_admin absent (projet Supabase attendu).';
  END IF;
END;
$garde$;

-- ------------------------------------------------------------
-- 1. Identite cloud : compte Auth miroir -> personne (t_users.sync_id)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.t_auth_identity (
  auth_user_id         UUID        PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  user_sync_id         TEXT        NOT NULL,
  last_online_login_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT t_auth_identity_user_sync_id_key UNIQUE (user_sync_id),
  CONSTRAINT t_auth_identity_sync_id_fmt CHECK (length(user_sync_id) BETWEEN 1 AND 64)
);

ALTER TABLE public.t_auth_identity ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.t_auth_identity FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.t_auth_identity TO service_role;

-- ------------------------------------------------------------
-- 2. Ecriture de l'identite par gis-login (service_role seulement)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_auth_identity_upsert(
  p_auth_user_id UUID,
  p_user_sync_id TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '200ms'
AS $$
DECLARE
  v_actif INTEGER;
BEGIN
  IF p_auth_user_id IS NULL OR p_user_sync_id IS NULL
     OR length(p_user_sync_id) NOT BETWEEN 1 AND 64 THEN
    RETURN false;
  END IF;

  SELECT u.statut_actif INTO v_actif
    FROM public.t_users u
   WHERE u.sync_id = p_user_sync_id;
  IF NOT FOUND OR COALESCE(v_actif, 0) <> 1 THEN
    RETURN false;
  END IF;

  -- Ce sync_id deja lie a un AUTRE compte Auth : refus (une personne = un compte).
  IF EXISTS (SELECT 1 FROM public.t_auth_identity i
              WHERE i.user_sync_id = p_user_sync_id
                AND i.auth_user_id <> p_auth_user_id) THEN
    RETURN false;
  END IF;

  INSERT INTO public.t_auth_identity AS i
    (auth_user_id, user_sync_id, last_online_login_at, created_at, updated_at)
  VALUES (p_auth_user_id, p_user_sync_id, NOW(), NOW(), NOW())
  ON CONFLICT (auth_user_id) DO UPDATE SET
    user_sync_id         = EXCLUDED.user_sync_id,
    last_online_login_at = NOW(),
    updated_at           = NOW();
  RETURN true;
EXCEPTION WHEN others THEN
  RAISE WARNING 'fn_auth_identity_upsert : refuse (code %)', SQLSTATE;
  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_auth_identity_upsert(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_auth_identity_upsert(UUID, TEXT) TO service_role;

-- ------------------------------------------------------------
-- 3. Hook custom access token
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event JSONB)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  c_max_hors_ligne CONSTANT INTERVAL := INTERVAL '30 days';  -- D3
  v_uid      UUID;
  v_claims   JSONB;
  v_id       RECORD;
  v_user     RECORD;
  v_site_id  BIGINT := NULL;
  v_site_sid TEXT   := NULL;
  v_cen_id   BIGINT := NULL;
  v_cen_sid  TEXT   := NULL;
  v_roles    TEXT[];
  v_is_sa    BOOLEAN;
BEGIN
  v_claims := event -> 'claims';
  IF v_claims IS NULL OR jsonb_typeof(v_claims) <> 'object' THEN
    RETURN jsonb_build_object('error', jsonb_build_object(
      'http_code', 403, 'message', 'GIS: jeton refuse (requete invalide).'));
  END IF;

  BEGIN
    v_uid := (event ->> 'user_id')::uuid;
  EXCEPTION WHEN others THEN
    v_uid := NULL;
  END;
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', jsonb_build_object(
      'http_code', 403, 'message', 'GIS: jeton refuse (requete invalide).'));
  END IF;

  SELECT i.user_sync_id, i.last_online_login_at INTO v_id
    FROM public.t_auth_identity i
   WHERE i.auth_user_id = v_uid;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', jsonb_build_object(
      'http_code', 403, 'message', 'GIS: compte non reconnu.'));
  END IF;

  -- D3 : 30 jours maximum depuis la derniere connexion EN LIGNE (mot de passe
  -- verifie par gis-login). S'applique aussi au token_refresh.
  IF v_id.last_online_login_at IS NULL
     OR v_id.last_online_login_at < NOW() - c_max_hors_ligne THEN
    RETURN jsonb_build_object('error', jsonb_build_object(
      'http_code', 403, 'message', 'GIS: reconnexion en ligne requise.'));
  END IF;

  SELECT u.sync_id, u.role, u.statut_actif, u.site_id, u.centre_id INTO v_user
    FROM public.t_users u
   WHERE u.sync_id = v_id.user_sync_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', jsonb_build_object(
      'http_code', 403, 'message', 'GIS: compte non reconnu.'));
  END IF;
  IF COALESCE(v_user.statut_actif, 0) <> 1 THEN
    RETURN jsonb_build_object('error', jsonb_build_object(
      'http_code', 403, 'message', 'GIS: compte desactive.'));
  END IF;

  -- Roles : principal (t_users.role) UNION secondaires (t_user_roles).
  SELECT COALESCE(array_agg(DISTINCT r ORDER BY r), ARRAY[]::TEXT[]) INTO v_roles
    FROM (
      SELECT NULLIF(btrim(v_user.role), '') AS r
      UNION ALL
      SELECT NULLIF(btrim(ur.role), '') FROM public.t_user_roles ur
       WHERE ur.user_sync_id = v_user.sync_id
    ) x
   WHERE r IS NOT NULL;
  v_is_sa := 'SUPER ADMIN' = ANY (v_roles);

  -- Site CLOUD (doit exister dans t_sites du cloud).
  IF v_user.site_id IS NOT NULL THEN
    SELECT s.id, s.sync_id INTO v_site_id, v_site_sid
      FROM public.t_sites s WHERE s.id = v_user.site_id;
  END IF;
  IF v_site_id IS NULL AND NOT v_is_sa THEN
    -- Un agent sans site valide ne se connecte pas (regles d'acces metier).
    RETURN jsonb_build_object('error', jsonb_build_object(
      'http_code', 403, 'message', 'GIS: compte sans site.'));
  END IF;

  -- Centre CLOUD, garde seulement s'il appartient au meme site.
  IF v_user.centre_id IS NOT NULL AND v_site_id IS NOT NULL THEN
    SELECT c.id, c.sync_id INTO v_cen_id, v_cen_sid
      FROM public.t_centres c
     WHERE c.id = v_user.centre_id AND c.site_id = v_site_id;
  END IF;

  v_claims := v_claims
    || jsonb_build_object(
         'gis_v',                 1,
         'gis_sync_id',           v_user.sync_id,
         'gis_site_id',           v_site_id,
         'gis_site_sync_id',      v_site_sid,
         'gis_centre_id',         v_cen_id,
         'gis_centre_sync_id',    v_cen_sid,
         'gis_primary_role',      v_user.role,
         'gis_roles',             to_jsonb(v_roles),
         'gis_is_super_admin',    v_is_sa,
         'gis_statut_actif',      true,
         'gis_last_online_login', floor(extract(epoch FROM v_id.last_online_login_at))::bigint
       );

  RETURN jsonb_set(event, '{claims}', v_claims);
EXCEPTION WHEN others THEN
  -- Echec ferme : jamais de jeton sans claims gis_*.
  RAISE WARNING 'custom_access_token_hook : refus sur erreur (code %)', SQLSTATE;
  RETURN jsonb_build_object('error', jsonb_build_object(
    'http_code', 403, 'message', 'GIS: jeton refuse (erreur interne).'));
END;
$$;

GRANT USAGE ON SCHEMA public TO supabase_auth_admin;  -- deja accorde par defaut sur Supabase ; rejouable
REVOKE ALL ON FUNCTION public.custom_access_token_hook(JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(JSONB) TO supabase_auth_admin;

-- ------------------------------------------------------------
-- 4. Lecture des claims gis_* (pour la RLS de P1-6 et le brouillon P3)
-- ------------------------------------------------------------
-- Claims de la requete en cours, SEULEMENT si role = authenticated et gis_v
-- present ; sinon NULL (cle anon, service_role, SQL Editor, jeton sans hook).
CREATE OR REPLACE FUNCTION public.fn_jwt_gis_claims()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_raw TEXT;
  v_j   JSONB;
BEGIN
  v_raw := current_setting('request.jwt.claims', true);
  IF v_raw IS NULL OR btrim(v_raw) = '' THEN
    RETURN NULL;
  END IF;
  BEGIN
    v_j := v_raw::jsonb;
  EXCEPTION WHEN others THEN
    RETURN NULL;
  END;
  IF jsonb_typeof(v_j) <> 'object'
     OR (v_j ->> 'role') IS DISTINCT FROM 'authenticated'
     OR NOT (v_j ? 'gis_v') THEN
    RETURN NULL;
  END IF;
  RETURN v_j;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_jwt_sync_id()
RETURNS TEXT LANGUAGE sql STABLE SET search_path = ''
AS $$ SELECT public.fn_jwt_gis_claims() ->> 'gis_sync_id' $$;

CREATE OR REPLACE FUNCTION public.fn_jwt_site_sync_id()
RETURNS TEXT LANGUAGE sql STABLE SET search_path = ''
AS $$ SELECT public.fn_jwt_gis_claims() ->> 'gis_site_sync_id' $$;

CREATE OR REPLACE FUNCTION public.fn_jwt_site_id()
RETURNS BIGINT
LANGUAGE plpgsql STABLE SET search_path = ''
AS $$
DECLARE
  v TEXT := public.fn_jwt_gis_claims() ->> 'gis_site_id';
BEGIN
  IF v IS NULL OR v !~ '^[0-9]{1,18}$' THEN
    RETURN NULL;
  END IF;
  RETURN v::bigint;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_jwt_centre_id()
RETURNS BIGINT
LANGUAGE plpgsql STABLE SET search_path = ''
AS $$
DECLARE
  v TEXT := public.fn_jwt_gis_claims() ->> 'gis_centre_id';
BEGIN
  IF v IS NULL OR v !~ '^[0-9]{1,18}$' THEN
    RETURN NULL;
  END IF;
  RETURN v::bigint;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_jwt_roles()
RETURNS TEXT[]
LANGUAGE plpgsql STABLE SET search_path = ''
AS $$
DECLARE
  v_j JSONB := public.fn_jwt_gis_claims() -> 'gis_roles';
  v_r TEXT[];
BEGIN
  IF v_j IS NULL OR jsonb_typeof(v_j) <> 'array' THEN
    RETURN ARRAY[]::TEXT[];
  END IF;
  SELECT COALESCE(array_agg(e), ARRAY[]::TEXT[]) INTO v_r
    FROM jsonb_array_elements_text(v_j) AS e;
  RETURN v_r;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_jwt_is_super_admin()
RETURNS BOOLEAN
LANGUAGE sql STABLE SET search_path = ''
AS $$ SELECT COALESCE((public.fn_jwt_gis_claims() -> 'gis_is_super_admin') = 'true'::jsonb, false) $$;

DO $priv$
DECLARE
  f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY['public.fn_jwt_gis_claims()', 'public.fn_jwt_sync_id()',
                           'public.fn_jwt_site_sync_id()', 'public.fn_jwt_site_id()',
                           'public.fn_jwt_centre_id()', 'public.fn_jwt_roles()',
                           'public.fn_jwt_is_super_admin()'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', f);
  END LOOP;
END;
$priv$;
