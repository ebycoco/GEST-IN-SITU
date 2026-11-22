-- ============================================================
-- 0018_correctifs_controle_p1.sql
-- GEST-IN-SITU : correctifs de l'audit de CONTROLE agent-9 du 2026-11-19
-- (chantier B, P1). Les fichiers 0001-0017 ne sont PAS modifies : cette
-- migration REMPLACE 4 fonctions (CREATE OR REPLACE, droits reaffirmes).
-- Aucune table, colonne, contrainte, politique, trigger ni droit anon ajoute
-- ou modifie (empreinte anon du README, section 0013, identique avant / apres).
-- DEPEND DE 0007, 0011, 0012, 0015, 0016, 0017 : le fichier s'arrete si l'une
-- manque.
--
-- Points traites (la partie Edge Function est dans
-- supabase/functions/gis-login/index.ts, version 3) :
--
--   N-1 (P0)  SUPER ADMIN « secondaire ».
--         Le garde 0007 ne protege que les lignes t_users dont role =
--         'SUPER ADMIN' (clauses WHEN, 0007:399-415) : la cle anon peut
--         reecrire le password_hash d'un compte dont le role PRINCIPAL n'est
--         pas SUPER ADMIN mais qui a une ligne t_user_roles 'SUPER ADMIN'.
--         Avant 0018, le hook (0017) et gis-login v2 lui donnaient
--         gis_is_super_admin = true (et la dispense site / licence), et
--         fn_sa_guard_caller_sa_auth (0015) le reconnaissait en base.
--         Regle 0018 (meme regle partout) : SUPER ADMIN = compte actif dont
--         t_users.role vaut EXACTEMENT 'SUPER ADMIN' (role principal). Un
--         SUPER ADMIN seulement secondaire est traite en ECHEC FERME :
--           - hook : gis_is_super_admin = false, pas de dispense site /
--             licence (compte sans site -> 403) ; gis_roles reste la liste
--             reelle (principal + secondaires) et contient donc 'SUPER ADMIN' ;
--           - 0016 (fn_r16_niveau, NON modifiee) : jeton dont gis_roles
--             contient 'SUPER ADMIN' sans etre « SUPER ADMIN verifie » ->
--             'REFUS' : aucune ecriture t_users / t_user_roles ;
--           - 0013 / 0014 : fn_jwt_is_super_admin() = false -> droits de son
--             site et de ses autres roles seulement ;
--           - fn_sa_guard_caller_sa_auth (0015) REMPLACEE ici : exige
--             t_users.role = 'SUPER ADMIN' (avant : principal OU t_user_roles).
--         0007 (fichier et objets) non modifie ; fn_r16_detient (0016) garde
--         la lecture « principal OU t_user_roles » : c'est une PROTECTION (un
--         administrateur de site ne touche pas un compte detenant SUPER ADMIN
--         a quelque titre que ce soit), elle reste plus large, a dessein.
--         Requete de controle prod (comptes concernes) : README, section 0018.
--
--   N-2 (P1)  Table des tentatives pleine.
--         fn_login_check_and_record REMPLACEE (actions et reponses
--         inchangees). En saturation (c_max_rows lignes), pour un login SANS
--         ligne :
--           1. purge des lignes NON bloquees dont le dernier echec date de
--              plus de c_purge_satur (1 h ; avant 0018 : 24 h) ;
--           2. RAISE WARNING prefixe « GIS_LOGIN_SATURATION » (journal
--              Postgres du projet, Logs Explorer) : nombre de lignes avant,
--              purgees, apres, et issue ;
--           3. s'il reste de la place : la connexion continue normalement
--              (reponse avec 'saturation': true, que gis-login v3 journalise
--              sous le code 'attempts_saturation_purge') ;
--           4. sinon seulement (dernier recours) : ECHEC FERME, comme 0017
--              ({"allowed": false, "error": true, "full": true} -> 503).
--         Plafond : constante c_max_rows (100 000) en tete de la fonction ;
--         pour le changer, rejouer cette fonction avec une autre valeur
--         (README, section 0018). Pourquoi une constante et pas une table de
--         reglage : aucune modification de schema dans cette migration.
--         Cout pour un attaquant (sans limite par adresse IP, voir README) :
--         tenir la table pleine de lignes non purgeables exige au moins
--         c_max_rows logins DISTINCTS ayant echoue dans la derniere heure,
--         soit >= 100 000 appels gis-login par heure (~28/s en continu),
--         chacun payant une comparaison bcrypt (cout 10) cote fonction. Les
--         personnes qui ont deja une ligne (echec recent) restent comptees
--         normalement. Effet de bord connu : pendant une saturation, la
--         ligne d'un login sans blocage en cours et sans echec depuis 1 h
--         peut etre purgee (remise a zero de l'escalade des blocages) : au
--         pire ~5 essais par login cible par periode « blocage 15 min + 1 h »,
--         au lieu de l'escalade 15 min -> 24 h ; seulement pendant une
--         saturation entretenue. Un blocage en cours n'est jamais purge.
--
--   N-3 (P2)  Collision de casse au rattachement.
--         fn_auth_identity_upsert REMPLACEE : le refus « un AUTRE compte
--         t_users a le meme lower(sync_id) » ne s'applique plus qu'au PREMIER
--         rattachement (aucune ligne t_auth_identity pour ce sync_id exact).
--         Une personne deja rattachee (identite existante, meme compte Auth,
--         app_metadata.sync_id exact) n'est plus bloquee si un compte de casse
--         voisine est cree ensuite. Le nouveau compte, lui, reste refuse : son
--         courriel miroir (minuscules) designe le compte Auth de la premiere
--         personne, dont app_metadata.sync_id ne correspond pas (gis-login :
--         mirror_mismatch ; upsert : refus). Les autres refus de 0017
--         (identite d'une variante de casse, compte Auth lie ailleurs,
--         app_metadata absent ou different, format) sont inchanges.
--
--   N-9 (P2)  Types des colonnes de t_sites lues par le hook.
--         Le hook lit desormais la ligne du site en JSON (to_jsonb) et
--         interprete is_active / is_permanent / expiry_date quel que soit
--         leur type (INTEGER / BOOLEAN / TEXT / DATE / TIMESTAMPTZ) :
--           is_active    : actif si true, nombre <> 0, ou texte '1' / 'true' /
--                          't' ; NULL, 0, false ou autre valeur -> suspendu
--                          (meme sens que 0017 pour les types attendus) ;
--           is_permanent : permanent si true, nombre <> 0, ou texte '1' /
--                          'true' / 't' ; sinon non permanent ;
--           expiry_date  : date « AAAA-MM-JJ » lue telle quelle ; sinon
--                          horodatage ramene au jour UTC ; valeur illisible
--                          -> pas de blocage (meme regle que gis-login et
--                          que src/shared/utils/license.ts, regle A1).
--         Avant 0018, un type different (ex. is_active BOOLEAN) faisait
--         echouer le hook pour TOUS (403 « erreur interne »). Types attendus
--         (baseline 0001 et dev le 2026-11-22) : is_active integer,
--         is_permanent boolean, expiry_date timestamptz ; requete
--         information_schema de controle : README, section 0018.
--
-- Hors perimetre (STOP & WARN, voir README section 0018 et rapport) : la
-- limite par adresse IP dans gis-login n'est PAS ajoutee : l'en-tete fiable
-- de l'adresse du client n'est pas documente de facon sure pour les Edge
-- Functions hebergees.
--
-- Verrous : CREATE OR REPLACE FUNCTION seulement (aucun verrou de table).
-- Idempotent : CREATE OR REPLACE FUNCTION, REVOKE / GRANT rejouables.
-- Application : un seul bloc  BEGIN; <ce fichier> COMMIT;  (SET LOCAL
-- lock_timeout = '3s' + controle en tete).
--
-- ORDRE avec l'Edge Function : appliquer 0018 PUIS deployer gis-login v3
-- (v3 n'appelle aucune action nouvelle : elle reste compatible avec 0017 ;
-- gis-login v2 reste compatible avec 0018, mais garde la faille N-1 cote
-- fonction : SUPER ADMIN secondaire dispense des controles site / licence
-- et annonce is_super_admin: true au poste).
--
-- Retour arriere (desactiver le hook d'abord s'il est active).
-- ATTENTION : le retour arriere COMPLET RESTAURE des versions VULNERABLES :
-- N-1 (SUPER ADMIN secondaire -> privileges SUPER ADMIN via gis-login et le
-- hook), N-2 (table pleine -> refus de tout login sans ligne pendant 24 h),
-- N-3 (personne deja rattachee bloquee par une collision de casse). Ne le
-- faire que sur incident prouve, en le sachant. Retour arriere PARTIEL
-- conseille selon l'incident :
--   - saturation mal reglee : rejouer seulement la section 4 de
--     0017_correctifs_audit_p1.sql (fn_login_check_and_record + REVOKE /
--     GRANT) : ne rouvre PAS N-1 ;
--   - rattachement : rejouer seulement la section 2 de 0017
--     (fn_auth_identity_upsert) : ne rouvre PAS N-1 (rouvre N-3) ;
--   - hook : rejouer la section 3 de 0017 (custom_access_token_hook) ROUVRE
--     N-1 pour les sessions authenticated ;
--   - fn_sa_guard_caller_sa_auth : rejouer la section 1 de
--     0015_garde_sa_authenticated.sql ROUVRE N-1 (SUPER ADMIN secondaire
--     reconnu en base).
--   Bloc complet (dans cet ordre, gis-login v2 redeployee avant) :
--   BEGIN;
--   SET LOCAL lock_timeout = '3s';
--   -- 0017 sections 2, 3 et 4 telles quelles, puis 0015 section 1 + son REVOKE.
--   COMMIT;
--
-- Application : dev ajadkziqaskadlzboeqo : appliquee le 2026-11-22 (MCP
-- apply_migration « 0018_correctifs_controle_p1 », partie executable identique
-- a ce fichier ; md5 de prosrc des 4 fonctions = fichier) ; test 14/14 ;
-- gis-login v3 deployee ; detail : README, section « 0018 ».
-- Production itvyayakwgzvfqvdrgyv : NON appliquee (geste utilisateur, avec
-- 0011-0017, apres nouvel audit agent-9).
-- Test : supabase/tests/0018_correctifs_controle_p1.test.sql
-- ============================================================

-- ------------------------------------------------------------
-- 0. Protection et prerequis
-- ------------------------------------------------------------
SET LOCAL lock_timeout = '3s';

DO $garde$
BEGIN
  IF current_setting('lock_timeout') <> '3s' THEN
    RAISE EXCEPTION '0018 : lock_timeout de protection inactif (fichier execute hors transaction). Executer en un seul bloc : BEGIN; <fichier> COMMIT;';
  END IF;
  -- 0007
  IF to_regprocedure('public.fn_t_users_sa_guard()') IS NULL
     OR to_regprocedure('public.fn_t_user_roles_sa_guard()') IS NULL THEN
    RAISE EXCEPTION '0018 : 0007 absente : appliquer 0007 d''abord.';
  END IF;
  -- 0011 / 0012
  IF to_regclass('public.t_auth_identity') IS NULL
     OR to_regprocedure('public.fn_jwt_gis_claims()') IS NULL
     OR to_regclass('public.t_login_attempts') IS NULL
     OR to_regprocedure('public.fn_login_key(text)') IS NULL THEN
    RAISE EXCEPTION '0018 : 0011 / 0012 absentes : les appliquer d''abord.';
  END IF;
  -- 0015 / 0016
  IF to_regprocedure('public.fn_sa_guard_caller_sa_auth()') IS NULL
     OR to_regprocedure('public.fn_t_users_sa_guard_auth()') IS NULL THEN
    RAISE EXCEPTION '0018 : 0015 absente : appliquer 0015 d''abord.';
  END IF;
  IF to_regprocedure('public.fn_r16_niveau()') IS NULL THEN
    RAISE EXCEPTION '0018 : 0016 absente : appliquer 0016 d''abord.';
  END IF;
  -- 0017 : contrainte des roles + versions 0017 des 3 fonctions remplacees ici.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.t_user_roles'::regclass
                    AND conname = 't_user_roles_role_check')
     OR (SELECT prosrc NOT LIKE '%authentication_method%'
           FROM pg_proc WHERE oid = 'public.custom_access_token_hook(jsonb)'::regprocedure)
     OR (SELECT prosrc NOT LIKE '%raw_app_meta_data%'
           FROM pg_proc WHERE oid = 'public.fn_auth_identity_upsert(uuid,text)'::regprocedure)
     OR (SELECT prosrc NOT LIKE '%''reserve''%'
           FROM pg_proc WHERE oid = 'public.fn_login_check_and_record(text,text)'::regprocedure) THEN
    RAISE EXCEPTION '0018 : 0017 absente : appliquer 0017 d''abord.';
  END IF;
END;
$garde$;

-- ------------------------------------------------------------
-- 1. N-1 : « SUPER ADMIN verifie » = role PRINCIPAL (remplace 0015 section 1)
-- ------------------------------------------------------------
-- Identique a 0015 sauf la derniere condition : t_user_roles n'est plus lu.
CREATE OR REPLACE FUNCTION public.fn_sa_guard_caller_sa_auth()
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_c   JSONB;
  v_sid TEXT;
BEGIN
  -- NULL sauf role = authenticated ET gis_v present (0011).
  v_c := public.fn_jwt_gis_claims();
  IF v_c IS NULL THEN
    RETURN false;
  END IF;
  IF (v_c -> 'gis_is_super_admin') IS DISTINCT FROM 'true'::jsonb
     OR (v_c -> 'gis_statut_actif') IS DISTINCT FROM 'true'::jsonb THEN
    RETURN false;
  END IF;
  v_sid := NULLIF(btrim(COALESCE(v_c ->> 'gis_sync_id', '')), '');
  IF v_sid IS NULL THEN
    RETURN false;
  END IF;
  -- Etat REEL du compte au moment de l'ecriture : actif ET role PRINCIPAL
  -- exactement 'SUPER ADMIN' (0018, N-1 : un SUPER ADMIN seulement
  -- secondaire n'est pas protege par 0007, il n'est donc jamais « verifie »).
  RETURN EXISTS (
    SELECT 1 FROM public.t_users u
     WHERE u.sync_id = v_sid
       AND u.statut_actif = 1
       AND u.role = 'SUPER ADMIN');
EXCEPTION WHEN others THEN
  RAISE WARNING 'fn_sa_guard_caller_sa_auth : repli ferme (code %)', SQLSTATE;
  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_sa_guard_caller_sa_auth() FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 2. N-3 : rattachement identite <-> compte Auth miroir (remplace 0017 section 2)
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
  v_actif   INTEGER;
  v_meta    TEXT;
  v_rattach BOOLEAN;
BEGIN
  IF p_auth_user_id IS NULL OR p_user_sync_id IS NULL
     OR p_user_sync_id !~ '^[A-Za-z0-9_-]{1,64}$' THEN
    RETURN false;
  END IF;

  SELECT u.statut_actif INTO v_actif
    FROM public.t_users u
   WHERE u.sync_id = p_user_sync_id;
  IF NOT FOUND OR COALESCE(v_actif, 0) <> 1 THEN
    RETURN false;
  END IF;

  -- Personne deja rattachee (identite existante pour CE sync_id exact) ?
  v_rattach := EXISTS (SELECT 1 FROM public.t_auth_identity i
                        WHERE i.user_sync_id = p_user_sync_id);

  -- N-3 : collision de casse avec un AUTRE compte t_users controlee au
  -- PREMIER rattachement seulement (courriel miroir partage). Une personne
  -- deja rattachee n'est plus bloquee par un compte de casse voisine cree
  -- apres elle (les controles ci-dessous restent appliques).
  IF NOT v_rattach
     AND EXISTS (SELECT 1 FROM public.t_users u
                  WHERE lower(u.sync_id) = lower(p_user_sync_id)
                    AND u.sync_id <> p_user_sync_id) THEN
    RETURN false;
  END IF;

  -- Compte Auth : doit porter EXACTEMENT ce sync_id dans app_metadata
  -- (pose par gis-login, modifiable par service_role seulement).
  SELECT au.raw_app_meta_data ->> 'sync_id' INTO v_meta
    FROM auth.users au
   WHERE au.id = p_auth_user_id;
  IF v_meta IS DISTINCT FROM p_user_sync_id THEN
    RETURN false;
  END IF;

  -- Ce compte Auth deja lie a une AUTRE personne : refus (jamais de reecriture).
  IF EXISTS (SELECT 1 FROM public.t_auth_identity i
              WHERE i.auth_user_id = p_auth_user_id
                AND i.user_sync_id <> p_user_sync_id) THEN
    RETURN false;
  END IF;

  -- Cette personne (ou une variante de casse) deja liee a un AUTRE compte Auth : refus.
  IF EXISTS (SELECT 1 FROM public.t_auth_identity i
              WHERE lower(i.user_sync_id) = lower(p_user_sync_id)
                AND (i.auth_user_id <> p_auth_user_id OR i.user_sync_id <> p_user_sync_id)) THEN
    RETURN false;
  END IF;

  INSERT INTO public.t_auth_identity AS i
    (auth_user_id, user_sync_id, last_online_login_at, created_at, updated_at)
  VALUES (p_auth_user_id, p_user_sync_id, NOW(), NOW(), NOW())
  ON CONFLICT (auth_user_id) DO UPDATE SET
    last_online_login_at = NOW(),
    updated_at           = NOW()
  WHERE i.user_sync_id = EXCLUDED.user_sync_id;
  -- Course perdue (ligne d'une autre personne inseree entre-temps) : 0 ligne.
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  RETURN true;
EXCEPTION WHEN others THEN
  RAISE WARNING 'fn_auth_identity_upsert : refuse (code %)', SQLSTATE;
  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_auth_identity_upsert(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_auth_identity_upsert(UUID, TEXT) TO service_role;

-- ------------------------------------------------------------
-- 3. Hook custom access token (N-1, N-9 ; remplace 0017 section 3)
-- ------------------------------------------------------------
-- Identique a 0017 sauf : SUPER ADMIN = role principal (N-1) ; lecture du
-- site independante des types de colonnes (N-9).
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event JSONB)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  c_max_hors_ligne CONSTANT INTERVAL := INTERVAL '30 days';   -- D3
  c_fenetre_lien   CONSTANT INTERVAL := INTERVAL '15 minutes'; -- P1-1
  v_uid      UUID;
  v_meth     TEXT;
  v_claims   JSONB;
  v_id       RECORD;
  v_user     RECORD;
  v_meta     TEXT;
  v_sj       JSONB  := NULL;
  v_site_id  BIGINT := NULL;
  v_site_sid TEXT   := NULL;
  v_cen_id   BIGINT := NULL;
  v_cen_sid  TEXT   := NULL;
  v_roles    TEXT[];
  v_is_sa    BOOLEAN;
  v_val      JSONB;
  v_actif    BOOLEAN;
  v_perm     BOOLEAN;
  v_exp_txt  TEXT;
  v_exp_jour DATE;
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

  -- P1-1 : seulement le flux gis-login (lien magique / code verifie par le
  -- poste) et le rafraichissement. Absent ou autre valeur : refus.
  v_meth := event ->> 'authentication_method';
  IF v_meth IS NULL OR v_meth NOT IN ('magiclink', 'otp', 'token_refresh') THEN
    RETURN jsonb_build_object('error', jsonb_build_object(
      'http_code', 403, 'message', 'GIS: methode de connexion refusee.'));
  END IF;

  SELECT i.user_sync_id, i.last_online_login_at INTO v_id
    FROM public.t_auth_identity i
   WHERE i.auth_user_id = v_uid;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', jsonb_build_object(
      'http_code', 403, 'message', 'GIS: compte non reconnu.'));
  END IF;

  -- P0-b : le compte Auth doit porter exactement ce sync_id (app_metadata).
  SELECT au.raw_app_meta_data ->> 'sync_id' INTO v_meta
    FROM auth.users au WHERE au.id = v_uid;
  IF v_meta IS DISTINCT FROM v_id.user_sync_id THEN
    RETURN jsonb_build_object('error', jsonb_build_object(
      'http_code', 403, 'message', 'GIS: compte non reconnu.'));
  END IF;

  -- D3 : 30 jours maximum depuis la derniere connexion EN LIGNE.
  IF v_id.last_online_login_at IS NULL
     OR v_id.last_online_login_at < NOW() - c_max_hors_ligne THEN
    RETURN jsonb_build_object('error', jsonb_build_object(
      'http_code', 403, 'message', 'GIS: reconnexion en ligne requise.'));
  END IF;
  -- P1-1 : un lien / code doit suivre de pres un mot de passe verifie par gis-login.
  IF v_meth IN ('magiclink', 'otp')
     AND v_id.last_online_login_at < NOW() - c_fenetre_lien THEN
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

  -- Roles tels qu'ecrits (aucun nettoyage), principal UNION secondaires :
  -- liste reelle, informative (0014 / 0016 y lisent les roles d'administration).
  SELECT COALESCE(array_agg(DISTINCT r ORDER BY r), ARRAY[]::TEXT[]) INTO v_roles
    FROM (
      SELECT v_user.role AS r
      UNION ALL
      SELECT ur.role FROM public.t_user_roles ur
       WHERE ur.user_sync_id = v_user.sync_id
    ) x
   WHERE r IS NOT NULL AND r <> '';
  -- N-1 (0018) : SUPER ADMIN = role PRINCIPAL exactement 'SUPER ADMIN' (seul
  -- cas protege par 0007) ; meme regle que fn_sa_guard_caller_sa_auth (0018)
  -- et gis-login v3. Un SUPER ADMIN seulement secondaire : false.
  v_is_sa := COALESCE(v_user.role = 'SUPER ADMIN', false);

  -- Site CLOUD, lu en JSON : independant du type des colonnes (N-9).
  IF v_user.site_id IS NOT NULL THEN
    SELECT to_jsonb(s.*) INTO v_sj
      FROM public.t_sites s WHERE s.id = v_user.site_id;
    IF v_sj IS NOT NULL THEN
      v_site_id  := v_user.site_id;
      v_site_sid := v_sj ->> 'sync_id';
    END IF;
  END IF;
  IF NOT v_is_sa THEN
    IF v_site_id IS NULL THEN
      RETURN jsonb_build_object('error', jsonb_build_object(
        'http_code', 403, 'message', 'GIS: compte sans site.'));
    END IF;
    -- P1-4 : memes regles que gis-login (SUPER ADMIN principal dispense).
    -- is_active : actif si true, nombre <> 0, ou texte 1 / true / t ; sinon
    -- (NULL, 0, false, autre) suspendu.
    v_val := v_sj -> 'is_active';
    v_actif := CASE jsonb_typeof(v_val)
                 WHEN 'boolean' THEN (v_val)::text = 'true'
                 WHEN 'number'  THEN (v_val #>> '{}')::numeric <> 0
                 WHEN 'string'  THEN lower(v_val #>> '{}') IN ('1', 'true', 't')
                 ELSE false
               END;
    IF NOT COALESCE(v_actif, false) THEN
      RETURN jsonb_build_object('error', jsonb_build_object(
        'http_code', 403, 'message', 'GIS: site suspendu.'));
    END IF;
    -- is_permanent : permanent si true, nombre <> 0, ou texte 1 / true / t.
    v_val := v_sj -> 'is_permanent';
    v_perm := CASE jsonb_typeof(v_val)
                WHEN 'boolean' THEN (v_val)::text = 'true'
                WHEN 'number'  THEN (v_val #>> '{}')::numeric <> 0
                WHEN 'string'  THEN lower(v_val #>> '{}') IN ('1', 'true', 't')
                ELSE false
              END;
    -- expiry_date : jour d'echeance UTC ; illisible -> pas de blocage (A1).
    v_exp_txt := v_sj ->> 'expiry_date';
    v_exp_jour := NULL;
    IF NOT COALESCE(v_perm, false) AND v_exp_txt IS NOT NULL AND v_exp_txt <> '' THEN
      BEGIN
        IF v_exp_txt ~ '^\d{4}-\d{2}-\d{2}$' THEN
          v_exp_jour := v_exp_txt::date;
        ELSE
          v_exp_jour := (v_exp_txt::timestamptz AT TIME ZONE 'UTC')::date;
        END IF;
      EXCEPTION WHEN others THEN
        v_exp_jour := NULL;
      END;
    END IF;
    IF v_exp_jour IS NOT NULL
       AND NOW() >= ((v_exp_jour + 1)::timestamp AT TIME ZONE 'UTC') THEN
      RETURN jsonb_build_object('error', jsonb_build_object(
        'http_code', 403, 'message', 'GIS: licence du site expiree.'));
    END IF;
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
  RAISE WARNING 'custom_access_token_hook : refus sur erreur (code %)', SQLSTATE;
  RETURN jsonb_build_object('error', jsonb_build_object(
    'http_code', 403, 'message', 'GIS: jeton refuse (erreur interne).'));
END;
$$;

REVOKE ALL ON FUNCTION public.custom_access_token_hook(JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(JSONB) TO supabase_auth_admin;

-- ------------------------------------------------------------
-- 4. N-2 : saturation de la table des tentatives (remplace 0017 section 4)
-- ------------------------------------------------------------
-- Identique a 0017 sauf la branche « table pleine » (purge 1 h, journal,
-- echec ferme en dernier recours seulement).
CREATE OR REPLACE FUNCTION public.fn_login_check_and_record(p_login TEXT, p_action TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '2s'
AS $$
DECLARE
  c_seuil        CONSTANT INTEGER  := 5;
  c_base         CONSTANT INTERVAL := INTERVAL '15 minutes';
  c_plafond      CONSTANT INTERVAL := INTERVAL '24 hours';
  c_oubli        CONSTANT INTERVAL := INTERVAL '24 hours';
  -- Plafond de la table (lignes). Pour le changer : rejouer cette fonction
  -- avec une autre valeur (README, section 0018).
  c_max_rows     CONSTANT INTEGER  := 100000;
  -- Age minimal (dernier echec) d'une ligne non bloquee purgee en saturation.
  c_purge_satur  CONSTANT INTERVAL := INTERVAL '1 hour';
  v_key    TEXT := public.fn_login_key(p_login);
  v_row    public.t_login_attempts%ROWTYPE;
  v_now    TIMESTAMPTZ := NOW();
  v_duree  INTERVAL;
  v_found  BOOLEAN;
  v_satur  BOOLEAN := false;
  v_avant  BIGINT;
  v_purge  BIGINT;
  v_apres  BIGINT;
BEGIN
  IF v_key IS NULL OR p_action IS NULL
     OR p_action NOT IN ('check', 'reserve', 'failure', 'success') THEN
    RETURN jsonb_build_object('allowed', false, 'retry_after_s', 0, 'invalid', true);
  END IF;

  IF p_action = 'success' THEN
    DELETE FROM public.t_login_attempts WHERE login_key = v_key;
    RETURN jsonb_build_object('allowed', true, 'retry_after_s', 0);
  END IF;

  SELECT * INTO v_row FROM public.t_login_attempts WHERE login_key = v_key FOR UPDATE;
  v_found := FOUND;

  -- Oubli : dernier echec vieux de plus de 24 h et aucun blocage en cours.
  IF v_found AND (v_row.bloque_jusqu_a IS NULL OR v_row.bloque_jusqu_a <= v_now)
     AND v_row.dernier_echec_at IS NOT NULL AND v_row.dernier_echec_at < v_now - c_oubli THEN
    DELETE FROM public.t_login_attempts WHERE login_key = v_key;
    v_found := false;
  END IF;

  -- Blocage en cours : refus, rien n'est modifie.
  IF v_found AND v_row.bloque_jusqu_a IS NOT NULL AND v_row.bloque_jusqu_a > v_now THEN
    RETURN jsonb_build_object('allowed', false,
      'retry_after_s', ceil(extract(epoch FROM (v_row.bloque_jusqu_a - v_now)))::int);
  END IF;

  IF p_action = 'check' THEN
    RETURN jsonb_build_object('allowed', true, 'retry_after_s', 0);
  END IF;

  -- 'reserve' ou 'failure' : il faut une ligne.
  IF NOT v_found THEN
    SELECT count(*) INTO v_avant FROM public.t_login_attempts;
    IF v_avant >= c_max_rows THEN
      -- N-2 : purge des lignes NON bloquees sans echec depuis 1 h.
      DELETE FROM public.t_login_attempts
       WHERE (bloque_jusqu_a IS NULL OR bloque_jusqu_a <= v_now)
         AND COALESCE(dernier_echec_at, updated_at) < v_now - c_purge_satur;
      GET DIAGNOSTICS v_purge = ROW_COUNT;
      SELECT count(*) INTO v_apres FROM public.t_login_attempts;
      v_satur := true;
      IF v_apres >= c_max_rows THEN
        -- Dernier recours : ECHEC FERME (aucune ligne ne peut etre creee).
        RAISE WARNING 'GIS_LOGIN_SATURATION : table pleine (% lignes, plafond %), % ligne(s) purgee(s) (non bloquees, dernier echec > 1 h), reste % : ECHEC FERME, connexion refusee',
          v_avant, c_max_rows, v_purge, v_apres;
        RETURN jsonb_build_object('allowed', false, 'retry_after_s', 60, 'error', true, 'full', true);
      END IF;
      RAISE WARNING 'GIS_LOGIN_SATURATION : table pleine (% lignes, plafond %), % ligne(s) purgee(s) (non bloquees, dernier echec > 1 h), reste % : connexion poursuivie',
        v_avant, c_max_rows, v_purge, v_apres;
    END IF;
    INSERT INTO public.t_login_attempts
      (login_key, nb_echecs, nb_blocages, premier_echec_at, dernier_echec_at, bloque_jusqu_a, updated_at)
    VALUES (v_key, 0, 0, NULL, NULL, NULL, v_now)
    ON CONFLICT (login_key) DO NOTHING;
    -- Relecture SOUS VERROU (ligne creee ici ou par une transaction concurrente).
    SELECT * INTO v_row FROM public.t_login_attempts WHERE login_key = v_key FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('allowed', false, 'retry_after_s', 60, 'error', true);
    END IF;
    IF v_row.bloque_jusqu_a IS NOT NULL AND v_row.bloque_jusqu_a > v_now THEN
      RETURN jsonb_build_object('allowed', false,
        'retry_after_s', ceil(extract(epoch FROM (v_row.bloque_jusqu_a - v_now)))::int);
    END IF;
  END IF;

  UPDATE public.t_login_attempts
     SET nb_echecs = nb_echecs + 1,
         premier_echec_at = COALESCE(premier_echec_at, v_now),
         dernier_echec_at = v_now,
         updated_at = v_now
   WHERE login_key = v_key
  RETURNING * INTO v_row;

  IF v_row.nb_echecs >= c_seuil THEN
    -- 15 min * 2^nb_blocages, plafond 24 h.
    v_duree := LEAST(c_base * power(2, LEAST(v_row.nb_blocages, 10))::int, c_plafond);
    UPDATE public.t_login_attempts
       SET nb_echecs = 0,
           nb_blocages = LEAST(nb_blocages + 1, 1000),
           bloque_jusqu_a = v_now + v_duree,
           updated_at = v_now
     WHERE login_key = v_key;
    IF p_action = 'reserve' THEN
      -- Cette tentative (la 5e) reste verifiee ; le blocage est deja pose pour
      -- toutes les autres. Echec -> 429 ; succes -> ligne supprimee.
      RETURN jsonb_build_object('allowed', true, 'retry_after_s', 0,
        'lock_on_failure', true, 'retry_on_failure_s', ceil(extract(epoch FROM v_duree))::int,
        'saturation', v_satur);
    END IF;
    RETURN jsonb_build_object('allowed', false,
      'retry_after_s', ceil(extract(epoch FROM v_duree))::int);
  END IF;

  IF p_action = 'reserve' THEN
    RETURN jsonb_build_object('allowed', true, 'retry_after_s', 0,
      'lock_on_failure', false, 'retry_on_failure_s', 0, 'saturation', v_satur);
  END IF;
  RETURN jsonb_build_object('allowed', true, 'retry_after_s', 0);
EXCEPTION WHEN others THEN
  RAISE WARNING 'fn_login_check_and_record : erreur (code %)', SQLSTATE;
  RETURN jsonb_build_object('allowed', false, 'retry_after_s', 60, 'error', true);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_login_check_and_record(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_login_check_and_record(TEXT, TEXT) TO service_role;
