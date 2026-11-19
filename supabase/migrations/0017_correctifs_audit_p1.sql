-- ============================================================
-- 0017_correctifs_audit_p1.sql
-- GEST-IN-SITU : correctifs des reserves de l'audit agent-9 du 2026-11-18
-- (NO-GO gis-login + hook en prod), chantier B, P1. Les fichiers 0011-0016
-- deja appliques ne sont PAS modifies : cette migration REMPLACE des
-- fonctions (CREATE OR REPLACE, droits conserves puis reaffirmes) et AJOUTE
-- une contrainte.
-- DEPEND DE 0007, 0011, 0012, 0015, 0016 : le fichier s'arrete si l'une manque.
--
-- Reserves traitees ici (la partie Edge Function est dans
-- supabase/functions/gis-login/index.ts) :
--
--   P0-a  Role « SUPER ADMIN » avec espaces.
--         0007 / 0015 comparent a l'identique (role = 'SUPER ADMIN'), alors
--         que le hook 0011 nettoyait les espaces (btrim) : ' SUPER ADMIN'
--         ecrit par la cle anon dans t_user_roles (non garde par 0007, clause
--         WHEN stricte) donnait gis_is_super_admin = true.
--         (1) Hook : plus aucun nettoyage ; gis_is_super_admin suit EXACTEMENT
--             la regle de fn_sa_guard_caller_sa_auth (0015) : compte actif
--             (statut_actif = 1) ET (t_users.role = 'SUPER ADMIN' OU une ligne
--             t_user_roles.role = 'SUPER ADMIN'), comparaison stricte.
--         (2) Contrainte t_user_roles_role_check (SEULE modification de schema
--             partage, accord STOP & WARN de l'utilisateur du 2026-11-18) :
--             memes 9 valeurs que t_users_role_check (verifie en tete : le
--             fichier s'arrete si t_users_role_check ne porte pas exactement
--             ces 9 valeurs) et que le CHECK(role) de t_user_roles du poste
--             (src/main/database/schema.ts:800 ; les postes n'ecrivent dans le
--             t_user_roles du cloud que des lignes de leur t_user_roles local :
--             src/main/database/queries/sync.queries.ts:133-139). Ajoutee NOT
--             VALID (les ecritures futures sont controlees tout de suite), puis
--             VALIDATE seulement si AUCUNE ligne existante ne la viole ; sinon
--             elle reste NOT VALID et un WARNING donne le nombre de lignes.
--             Requete de controle a lancer en prod AVANT : README, section 0017.
--
--   P0-b  Compte miroir pre-cree / rattachement reecrit.
--         fn_auth_identity_upsert REMPLACEE :
--           - refuse un auth_user_id deja lie a un AUTRE user_sync_id (avant :
--             l'ON CONFLICT reecrivait user_sync_id) ; sinon ne met a jour que
--             les dates ;
--           - refuse si auth.users.raw_app_meta_data->>'sync_id' (pose par
--             gis-login, modifiable seulement par service_role) n'est pas
--             EXACTEMENT ce sync_id (compte miroir pre-cree sans
--             app_metadata, ou d'une autre personne) ;
--           - refuse les sync_id qui ne different que par la casse (le
--             courriel miroir est en minuscules : deux personnes
--             partageraient un compte Auth) : si un AUTRE compte t_users ou
--             une AUTRE identite a le meme lower(sync_id), refus ;
--           - format du sync_id identique a gis-login (^[A-Za-z0-9_-]{1,64}$).
--         Hook : verifie aussi raw_app_meta_data->>'sync_id' = identite.
--
--   P1-1  Methode d'emission du jeton (champ d'entree authentication_method
--         du hook). Sources : Context7 /supabase/supabase,
--         apps/docs/content/guides/auth/auth-hooks/custom-access-token-hook.mdx
--         (tableau « Inputs » et JSON Schema, enum : oauth, password, otp,
--         totp, recovery, invite, sso/saml, magiclink, email/signup,
--         email_change, token_refresh, oauth_provider/authorization_code,
--         anonymous) ; meme page via search_docs le 2026-11-18
--         (https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook).
--         Acceptees : 'magiclink' et 'otp' (flux gis-login : generateLink
--         magiclink puis verifyOtp({token_hash, type:'magiclink'}) par le
--         poste ; la doc ne dit pas laquelle des deux valeurs Auth envoie
--         pour ce flux, les deux sont donc acceptees) et 'token_refresh'.
--         Toute autre valeur, ou champ absent : refus 403 (echec ferme).
--         En plus, pour 'magiclink' / 'otp' : last_online_login_at doit dater
--         de moins de 15 minutes (gis-login l'ecrit juste avant de renvoyer le
--         token_hash) : un lien / code obtenu hors gis-login (sans mot de
--         passe verifie) est refuse.
--
--   P1-2  Limite de tentatives atomique et non saturable.
--         fn_login_check_and_record REMPLACEE, nouvelle action 'reserve' (les
--         actions 'check' / 'failure' / 'success' gardent leur sens, pour
--         gis-login v1 encore deployee pendant la transition) :
--           'reserve' : AVANT bcrypt, sous verrou de ligne (SELECT ... FOR
--             UPDATE, ligne creee au besoin par INSERT ... ON CONFLICT DO
--             NOTHING puis relue sous verrou) : refus si blocage en cours ;
--             sinon l'echec est COMPTE d'avance ; si ce compte atteint le
--             seuil (5), le blocage est pose TOUT DE SUITE et la tentative
--             en cours reste autorisee (la 5e est donc verifiee, comme avant)
--             avec lock_on_failure = true. Des requetes paralleles ne peuvent
--             donc pas faire plus de 5 verifications de mot de passe par
--             fenetre (avant : 'check' puis 'failure' separes, course).
--           'success' : supprime la ligne (efface le compte d'avance et un
--             blocage pose par cette meme tentative), comme avant.
--         Saturation : table pleine (100 000 lignes apres purge des lignes
--         sans blocage dont le dernier echec a plus de 24 h) = ECHEC FERME :
--         {"allowed": false, "error": true, "full": true} -> gis-login 503
--         pour toute connexion d'un login sans ligne. Choix justifie : la
--         variante « pas de ligne pour un login inexistant » rendrait un
--         login inconnu jamais bloque (pas de 429) alors qu'un login connu
--         l'est : enumeration des comptes. Une ligne est donc creee pour TOUT
--         login (connu ou non), le comportement observable est identique, et
--         la saturation ne desactive plus la limite (avant : echec non
--         compte = limite contournee). Prix : un remplissage massif (100 000
--         logins distincts en 24 h, chacun avec un bcrypt cote fonction)
--         bloque les nouvelles connexions en ligne (503) jusqu'a la purge ;
--         les postes hors ligne (connexion locale) ne sont pas touches.
--
--   P1-4  Hook : refuse aussi site suspendu (t_sites.is_active = 0 ou NULL,
--         meme lecture que gis-login : Number(null) = 0) et licence expiree
--         (is_permanent different de true, expiry_date non NULL, blocage a
--         partir du lendemain 00:00 UTC de la date d'echeance, regle A1 de
--         src/shared/utils/license.ts reprise par gis-login), SUPER ADMIN
--         dispense ; s'applique a CHAQUE emission, token_refresh compris.
--
-- Aucune table, colonne, politique ou droit anon ajoute ou modifie : seule la
-- contrainte CHECK est ajoutee. L'empreinte anon du README (section 0013)
-- est identique avant / apres (elle ne couvre pas les contraintes ; pour les
-- valeurs legitimes de role, anon ecrit comme avant).
--
-- Verrous : ADD CONSTRAINT ... NOT VALID prend un AccessExclusiveLock sur
-- t_user_roles (mesure sur le dev le 2026-11-18), VALIDATE un
-- ShareUpdateExclusiveLock ; garde jusqu'au COMMIT, table de quelques
-- centaines de lignes : instant court. Aucun verrou sur t_cartes.
--
-- Idempotent : CREATE OR REPLACE FUNCTION ; contrainte ajoutee seulement si
-- absente ; VALIDATE seulement si non validee et aucune ligne fautive.
-- Application : un seul bloc  BEGIN; <ce fichier> COMMIT;  (SET LOCAL
-- lock_timeout = '3s' + controle en tete ; 55P03 = rien n'est change).
--
-- ORDRE avec l'Edge Function : appliquer 0017 PUIS deployer gis-login v2
-- (qui appelle l'action 'reserve'). gis-login v1 reste compatible avec 0017
-- (actions inchangees). Retour arriere : redeployer gis-login v1 AVANT de
-- retirer 0017 (v2 sur une base sans 'reserve' -> 400 a chaque connexion).
--
-- Retour arriere (desactiver le hook d'abord s'il est active) :
--   BEGIN;
--   SET LOCAL lock_timeout = '3s';
--   ALTER TABLE public.t_user_roles DROP CONSTRAINT IF EXISTS t_user_roles_role_check;
--   -- puis rejouer telles quelles la section 2 et la section 3 de
--   -- 0011_hook_identite_claims.sql (fn_auth_identity_upsert,
--   -- custom_access_token_hook + leurs REVOKE/GRANT) et la section 3 de
--   -- 0012_tentatives_connexion.sql (fn_login_check_and_record + REVOKE/GRANT).
--   COMMIT;
--
-- Application : dev ajadkziqaskadlzboeqo : appliquee le 2026-11-18 (MCP
-- apply_migration « 0017_correctifs_audit_p1 », partie executable identique
-- a ce fichier ; md5 des 3 fonctions = fichier ; contrainte VALIDEE, 0 ligne
-- fautive) ; test 17/17 ; gis-login v2 deployee ; detail : README, section
-- « 0017 ». Production itvyayakwgzvfqvdrgyv : NON appliquee (geste
-- utilisateur, avec 0011-0016, apres nouvel audit agent-9).
-- Test : supabase/tests/0017_correctifs_audit_p1.test.sql
-- ============================================================

-- ------------------------------------------------------------
-- 0. Protection et prerequis
-- ------------------------------------------------------------
SET LOCAL lock_timeout = '3s';

DO $garde$
DECLARE
  v_attendu TEXT[] := ARRAY['ADMINISTRATEUR_SITE', 'ADMIN_CENTRE', 'OPERATEUR_APUREMENT',
                            'OPERATEUR_INVENTAIRE', 'OPERATEUR_LOGISTIQUE', 'OPERATEUR_QUALITE',
                            'OPERATEUR_SAISIE', 'OPERATEUR_VERIFICATION', 'SUPER ADMIN'];
  v_def     TEXT;
  v_vals    TEXT[];
BEGIN
  IF current_setting('lock_timeout') <> '3s' THEN
    RAISE EXCEPTION '0017 : lock_timeout de protection inactif (fichier execute hors transaction). Executer en un seul bloc : BEGIN; <fichier> COMMIT;';
  END IF;
  IF to_regclass('public.t_auth_identity') IS NULL
     OR to_regprocedure('public.custom_access_token_hook(jsonb)') IS NULL
     OR to_regprocedure('public.fn_auth_identity_upsert(uuid,text)') IS NULL THEN
    RAISE EXCEPTION '0017 : 0011 absente : appliquer 0011 d''abord.';
  END IF;
  IF to_regclass('public.t_login_attempts') IS NULL
     OR to_regprocedure('public.fn_login_check_and_record(text,text)') IS NULL
     OR to_regprocedure('public.fn_login_key(text)') IS NULL THEN
    RAISE EXCEPTION '0017 : 0012 absente : appliquer 0012 d''abord.';
  END IF;
  IF to_regprocedure('public.fn_sa_guard_caller_sa_auth()') IS NULL THEN
    RAISE EXCEPTION '0017 : 0015 absente : appliquer 0015 d''abord.';
  END IF;
  IF to_regprocedure('public.fn_t_user_roles_filtre_role()') IS NULL THEN
    RAISE EXCEPTION '0017 : 0016 absente : appliquer 0016 d''abord.';
  END IF;
  -- La liste de la nouvelle contrainte doit etre EXACTEMENT celle de t_users
  -- (tri en collation "C", v_attendu ecrit dans cet ordre).
  SELECT pg_get_constraintdef(c.oid) INTO v_def
    FROM pg_constraint c
   WHERE c.conrelid = 'public.t_users'::regclass AND c.conname = 't_users_role_check';
  IF v_def IS NULL THEN
    RAISE EXCEPTION '0017 : contrainte t_users_role_check absente : arret (liste de reference inconnue).';
  END IF;
  SELECT array_agg(m[1] ORDER BY m[1] COLLATE "C") INTO v_vals
    FROM regexp_matches(v_def, '''([^'']*)''', 'g') AS m;
  IF v_vals IS DISTINCT FROM v_attendu THEN
    RAISE EXCEPTION '0017 : t_users_role_check ne porte pas les 9 roles attendus : arret, rien n''est change.';
  END IF;
END;
$garde$;

-- ------------------------------------------------------------
-- 1. P0-a (2) : contrainte sur t_user_roles.role
-- ------------------------------------------------------------
DO $contrainte$
DECLARE
  v_fautives BIGINT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.t_user_roles'::regclass
                    AND conname = 't_user_roles_role_check') THEN
    EXECUTE $ddl$ALTER TABLE public.t_user_roles
      ADD CONSTRAINT t_user_roles_role_check CHECK (role = ANY (ARRAY[
        'SUPER ADMIN'::text, 'ADMINISTRATEUR_SITE'::text, 'ADMIN_CENTRE'::text,
        'OPERATEUR_VERIFICATION'::text, 'OPERATEUR_QUALITE'::text, 'OPERATEUR_SAISIE'::text,
        'OPERATEUR_LOGISTIQUE'::text, 'OPERATEUR_INVENTAIRE'::text, 'OPERATEUR_APUREMENT'::text]))
      NOT VALID$ddl$;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint
              WHERE conrelid = 'public.t_user_roles'::regclass
                AND conname = 't_user_roles_role_check' AND NOT convalidated) THEN
    SELECT count(*) INTO v_fautives
      FROM public.t_user_roles r
     WHERE r.role IS NULL OR NOT (r.role = ANY (ARRAY[
        'SUPER ADMIN', 'ADMINISTRATEUR_SITE', 'ADMIN_CENTRE',
        'OPERATEUR_VERIFICATION', 'OPERATEUR_QUALITE', 'OPERATEUR_SAISIE',
        'OPERATEUR_LOGISTIQUE', 'OPERATEUR_INVENTAIRE', 'OPERATEUR_APUREMENT']::text[]));
    IF v_fautives = 0 THEN
      EXECUTE 'ALTER TABLE public.t_user_roles VALIDATE CONSTRAINT t_user_roles_role_check';
    ELSE
      RAISE WARNING '0017 : t_user_roles_role_check laissee NOT VALID : % ligne(s) existante(s) hors liste (requete de controle du README, section 0017).', v_fautives;
    END IF;
  END IF;
END;
$contrainte$;

-- ------------------------------------------------------------
-- 2. P0-b : rattachement identite <-> compte Auth miroir
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
  v_meta  TEXT;
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

  -- sync_id differant seulement par la casse : courriel miroir partage, refus.
  IF EXISTS (SELECT 1 FROM public.t_users u
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
-- 3. Hook custom access token (P0-a, P0-b, P1-1, P1-4)
-- ------------------------------------------------------------
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
  v_site     RECORD;
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

  -- P0-a : roles tels qu'ecrits (aucun nettoyage), principal UNION secondaires.
  SELECT COALESCE(array_agg(DISTINCT r ORDER BY r), ARRAY[]::TEXT[]) INTO v_roles
    FROM (
      SELECT v_user.role AS r
      UNION ALL
      SELECT ur.role FROM public.t_user_roles ur
       WHERE ur.user_sync_id = v_user.sync_id
    ) x
   WHERE r IS NOT NULL AND r <> '';
  -- Meme regle que fn_sa_guard_caller_sa_auth (0015) : actif (verifie
  -- ci-dessus) ET role principal ou secondaire EXACTEMENT 'SUPER ADMIN'.
  v_is_sa := v_user.role = 'SUPER ADMIN'
             OR EXISTS (SELECT 1 FROM public.t_user_roles r
                         WHERE r.user_sync_id = v_user.sync_id AND r.role = 'SUPER ADMIN');
  v_is_sa := COALESCE(v_is_sa, false);

  -- Site CLOUD.
  IF v_user.site_id IS NOT NULL THEN
    SELECT s.id, s.sync_id, s.is_active, s.expiry_date, s.is_permanent INTO v_site
      FROM public.t_sites s WHERE s.id = v_user.site_id;
    IF FOUND THEN
      v_site_id  := v_site.id;
      v_site_sid := v_site.sync_id;
    END IF;
  END IF;
  IF NOT v_is_sa THEN
    IF v_site_id IS NULL THEN
      RETURN jsonb_build_object('error', jsonb_build_object(
        'http_code', 403, 'message', 'GIS: compte sans site.'));
    END IF;
    -- P1-4 : memes regles que gis-login (SUPER ADMIN dispense).
    IF COALESCE(v_site.is_active, 0) = 0 THEN
      RETURN jsonb_build_object('error', jsonb_build_object(
        'http_code', 403, 'message', 'GIS: site suspendu.'));
    END IF;
    IF v_site.is_permanent IS NOT TRUE AND v_site.expiry_date IS NOT NULL
       AND NOW() >= (((v_site.expiry_date AT TIME ZONE 'UTC')::date + 1)::timestamp AT TIME ZONE 'UTC') THEN
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
-- 4. P1-2 : limite de tentatives atomique et non saturable
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_login_check_and_record(p_login TEXT, p_action TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '2s'
AS $$
DECLARE
  c_seuil    CONSTANT INTEGER  := 5;
  c_base     CONSTANT INTERVAL := INTERVAL '15 minutes';
  c_plafond  CONSTANT INTERVAL := INTERVAL '24 hours';
  c_oubli    CONSTANT INTERVAL := INTERVAL '24 hours';
  c_max_rows CONSTANT INTEGER  := 100000;
  v_key   TEXT := public.fn_login_key(p_login);
  v_row   public.t_login_attempts%ROWTYPE;
  v_now   TIMESTAMPTZ := NOW();
  v_duree INTERVAL;
  v_found BOOLEAN;
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

  -- 'reserve' ou 'failure' : il faut une ligne (echec FERME si table pleine).
  IF NOT v_found THEN
    IF (SELECT count(*) FROM public.t_login_attempts) >= c_max_rows THEN
      DELETE FROM public.t_login_attempts
       WHERE (bloque_jusqu_a IS NULL OR bloque_jusqu_a <= v_now)
         AND (dernier_echec_at IS NULL OR dernier_echec_at < v_now - c_oubli);
      IF (SELECT count(*) FROM public.t_login_attempts) >= c_max_rows THEN
        RAISE WARNING 'fn_login_check_and_record : table pleine, connexion refusee (echec ferme)';
        RETURN jsonb_build_object('allowed', false, 'retry_after_s', 60, 'error', true, 'full', true);
      END IF;
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
        'lock_on_failure', true, 'retry_on_failure_s', ceil(extract(epoch FROM v_duree))::int);
    END IF;
    RETURN jsonb_build_object('allowed', false,
      'retry_after_s', ceil(extract(epoch FROM v_duree))::int);
  END IF;

  IF p_action = 'reserve' THEN
    RETURN jsonb_build_object('allowed', true, 'retry_after_s', 0,
      'lock_on_failure', false, 'retry_on_failure_s', 0);
  END IF;
  RETURN jsonb_build_object('allowed', true, 'retry_after_s', 0);
EXCEPTION WHEN others THEN
  RAISE WARNING 'fn_login_check_and_record : erreur (code %)', SQLSTATE;
  RETURN jsonb_build_object('allowed', false, 'retry_after_s', 60, 'error', true);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_login_check_and_record(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_login_check_and_record(TEXT, TEXT) TO service_role;
