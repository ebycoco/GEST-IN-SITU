-- ============================================================
-- Test de supabase/migrations/0017_correctifs_audit_p1.sql
-- A executer sur le projet DEV uniquement (ajadkziqaskadlzboeqo), apres
-- 0017, dans le SQL Editor (role postgres). Transaction ANNULEE (ROLLBACK
-- final) : aucune ligne ne reste (sites, centres, comptes, utilisateurs Auth,
-- identites et tentatives de test 't17*').
-- Le hook est appele DIRECTEMENT avec un evenement JSON simule (il n'a pas
-- besoin d'etre active dans les reglages Auth pour ce test).
-- Resultat : table _t, puis un bloc qui LEVE UNE ERREUR si un cas vaut false.
-- NE JAMAIS EXECUTER EN PROD.
-- ============================================================
BEGIN;

CREATE TEMP TABLE _t (n INT, cas TEXT, ok BOOLEAN, detail TEXT) ON COMMIT DROP;

DO $$
DECLARE
  v_sa   BIGINT; v_susp BIGINT; v_exp BIGINT; v_auj BIGINT; v_perm BIGINT;
  u_ag    UUID := gen_random_uuid();  -- agent site A, actif
  u_sa    UUID := gen_random_uuid();  -- SUPER ADMIN (role principal), site suspendu
  u_sa2   UUID := gen_random_uuid();  -- SUPER ADMIN par t_user_roles seulement
  u_esp   UUID := gen_random_uuid();  -- ' SUPER ADMIN' (avec espace) en role secondaire
  u_susp  UUID := gen_random_uuid();  -- agent d'un site suspendu
  u_exp   UUID := gen_random_uuid();  -- agent d'un site a licence expiree
  u_auj   UUID := gen_random_uuid();  -- licence qui expire aujourd'hui
  u_perm  UUID := gen_random_uuid();  -- site permanent, date d'echeance passee
  u_nometa UUID := gen_random_uuid(); -- compte Auth sans app_metadata.sync_id
  u_autre UUID := gen_random_uuid();  -- compte Auth dont app_metadata = autre personne
  u_libre UUID := gen_random_uuid();  -- compte Auth libre (app_metadata t17-u-ag)
  u_casse UUID := gen_random_uuid();  -- app_metadata = variante de casse
  ev  JSONB;
  r   JSONB;
  c   JSONB;
  b   BOOLEAN;
  i   INT;
  n   BIGINT;
  m   TEXT;
BEGIN
  PERFORM set_config('request.jwt.claims', '', true);

  -- ---------- 0. Droits conserves ----------
  INSERT INTO _t VALUES (0, 'Droits : hook EXECUTE supabase_auth_admin seulement ; upsert et tentatives service_role seulement ; SECURITY DEFINER + search_path fige',
    has_function_privilege('supabase_auth_admin', 'public.custom_access_token_hook(jsonb)', 'EXECUTE')
      AND NOT has_function_privilege('anon', 'public.custom_access_token_hook(jsonb)', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'public.custom_access_token_hook(jsonb)', 'EXECUTE')
      AND has_function_privilege('service_role', 'public.fn_auth_identity_upsert(uuid,text)', 'EXECUTE')
      AND NOT has_function_privilege('anon', 'public.fn_auth_identity_upsert(uuid,text)', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'public.fn_auth_identity_upsert(uuid,text)', 'EXECUTE')
      AND has_function_privilege('service_role', 'public.fn_login_check_and_record(text,text)', 'EXECUTE')
      AND NOT has_function_privilege('anon', 'public.fn_login_check_and_record(text,text)', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'public.fn_login_check_and_record(text,text)', 'EXECUTE')
      AND NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
                       WHERE p.oid IN ('public.custom_access_token_hook(jsonb)'::regprocedure,
                                       'public.fn_auth_identity_upsert(uuid,text)'::regprocedure,
                                       'public.fn_login_check_and_record(text,text)'::regprocedure)
                         AND a.grantee = 0)
      AND (SELECT bool_and(p.prosecdef AND EXISTS (SELECT 1 FROM unnest(p.proconfig) x WHERE x = 'search_path=""'))
             FROM pg_proc p
            WHERE p.oid IN ('public.custom_access_token_hook(jsonb)'::regprocedure,
                            'public.fn_auth_identity_upsert(uuid,text)'::regprocedure,
                            'public.fn_login_check_and_record(text,text)'::regprocedure)),
    NULL);

  -- ---------- 1. Contrainte validee, memes valeurs que t_users ----------
  INSERT INTO _t VALUES (1, 't_user_roles_role_check presente et VALIDEE ; memes 9 valeurs que t_users_role_check',
    EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.t_user_roles'::regclass
             AND conname = 't_user_roles_role_check' AND contype = 'c' AND convalidated)
      AND (SELECT array_agg(x[1] ORDER BY x[1] COLLATE "C") FROM pg_constraint c,
             regexp_matches(pg_get_constraintdef(c.oid), '''([^'']*)''', 'g') x
            WHERE c.conrelid = 'public.t_user_roles'::regclass AND c.conname = 't_user_roles_role_check')
        = (SELECT array_agg(x[1] ORDER BY x[1] COLLATE "C") FROM pg_constraint c,
             regexp_matches(pg_get_constraintdef(c.oid), '''([^'']*)''', 'g') x
            WHERE c.conrelid = 'public.t_users'::regclass AND c.conname = 't_users_role_check'),
    NULL);

  -- ---------- Jeu de test ----------
  INSERT INTO public.t_sites (nom, code, sync_id, is_active, is_permanent, expiry_date)
    VALUES ('T17 SITE A', 'T17A', 't17-site-a', 1, true, NULL) RETURNING id INTO v_sa;
  INSERT INTO public.t_sites (nom, code, sync_id, is_active, is_permanent, expiry_date)
    VALUES ('T17 SITE SUSP', 'T17S', 't17-site-s', 0, true, NULL) RETURNING id INTO v_susp;
  INSERT INTO public.t_sites (nom, code, sync_id, is_active, is_permanent, expiry_date)
    VALUES ('T17 SITE EXP', 'T17E', 't17-site-e', 1, false, NOW() - INTERVAL '2 days') RETURNING id INTO v_exp;
  INSERT INTO public.t_sites (nom, code, sync_id, is_active, is_permanent, expiry_date)
    VALUES ('T17 SITE AUJ', 'T17J', 't17-site-j', 1, false,
            ((NOW() AT TIME ZONE 'UTC')::date::timestamp AT TIME ZONE 'UTC') + INTERVAL '1 hour') RETURNING id INTO v_auj;
  INSERT INTO public.t_sites (nom, code, sync_id, is_active, is_permanent, expiry_date)
    VALUES ('T17 SITE PERM', 'T17P', 't17-site-p', 1, true, NOW() - INTERVAL '400 days') RETURNING id INTO v_perm;

  INSERT INTO public.t_users (login, password_hash, role, statut_actif, site_id, sync_id) VALUES
    ('t17_ag',   'x', 'OPERATEUR_VERIFICATION', 1, v_sa,   't17-u-ag'),
    ('t17_sa2',  'x', 'OPERATEUR_SAISIE',       1, v_sa,   't17-u-sa2'),
    ('t17_esp',  'x', 'OPERATEUR_SAISIE',       1, v_sa,   't17-u-esp'),
    ('t17_susp', 'x', 'OPERATEUR_SAISIE',       1, v_susp, 't17-u-susp'),
    ('t17_exp',  'x', 'OPERATEUR_SAISIE',       1, v_exp,  't17-u-exp'),
    ('t17_auj',  'x', 'OPERATEUR_SAISIE',       1, v_auj,  't17-u-auj'),
    ('t17_perm', 'x', 'OPERATEUR_SAISIE',       1, v_perm, 't17-u-perm'),
    ('t17_c1',   'x', 'OPERATEUR_SAISIE',       1, v_sa,   't17-u-Casse'),
    ('t17_c2',   'x', 'OPERATEUR_SAISIE',       1, v_sa,   't17-u-casse'),
    ('t17_l2',   'x', 'OPERATEUR_SAISIE',       1, v_sa,   't17-u-l2');
  -- SUPER ADMIN de test : insere par postgres (appelant fiable pour 0007), site suspendu.
  INSERT INTO public.t_users (login, password_hash, role, statut_actif, site_id, sync_id)
  VALUES ('t17_sa', 'x', 'SUPER ADMIN', 1, v_susp, 't17-u-sa');
  INSERT INTO public.t_user_roles (user_sync_id, role) VALUES ('t17-u-sa2', 'SUPER ADMIN');

  INSERT INTO auth.users (id, aud, role, email, raw_app_meta_data, created_at, updated_at)
  SELECT x.id, 'authenticated', 'authenticated', 't17-' || x.id::text || '@users.gest-in-situ.invalid',
         x.meta, NOW(), NOW()
    FROM (VALUES (u_ag,   jsonb_build_object('sync_id', 't17-u-ag')),
                 (u_sa,   jsonb_build_object('sync_id', 't17-u-sa')),
                 (u_sa2,  jsonb_build_object('sync_id', 't17-u-sa2')),
                 (u_esp,  jsonb_build_object('sync_id', 't17-u-esp')),
                 (u_susp, jsonb_build_object('sync_id', 't17-u-susp')),
                 (u_exp,  jsonb_build_object('sync_id', 't17-u-exp')),
                 (u_auj,  jsonb_build_object('sync_id', 't17-u-auj')),
                 (u_perm, jsonb_build_object('sync_id', 't17-u-perm')),
                 (u_nometa, '{"provider":"email"}'::jsonb),
                 (u_autre, jsonb_build_object('sync_id', 't17-u-sa')),
                 (u_libre, jsonb_build_object('sync_id', 't17-u-ag')),
                 (u_casse, jsonb_build_object('sync_id', 't17-u-casse'))) AS x(id, meta);

  INSERT INTO public.t_auth_identity (auth_user_id, user_sync_id, last_online_login_at) VALUES
    (u_ag,   't17-u-ag',   NOW() - INTERVAL '1 minute'),
    (u_sa,   't17-u-sa',   NOW() - INTERVAL '1 minute'),
    (u_sa2,  't17-u-sa2',  NOW() - INTERVAL '1 minute'),
    (u_esp,  't17-u-esp',  NOW() - INTERVAL '1 minute'),
    (u_susp, 't17-u-susp', NOW() - INTERVAL '1 minute'),
    (u_exp,  't17-u-exp',  NOW() - INTERVAL '1 minute'),
    (u_auj,  't17-u-auj',  NOW() - INTERVAL '1 minute'),
    (u_perm, 't17-u-perm', NOW() - INTERVAL '1 minute'),
    (u_nometa, 't17-u-c-meta', NOW());   -- identite valide, compte Auth sans app_metadata.sync_id
  INSERT INTO public.t_users (login, password_hash, role, statut_actif, site_id, sync_id)
  VALUES ('t17_meta', 'x', 'OPERATEUR_SAISIE', 1, v_sa, 't17-u-c-meta');

  ev := jsonb_build_object(
    'user_id', u_ag::text,
    'authentication_method', 'magiclink',
    'claims', jsonb_build_object(
      'iss', 'https://exemple.invalid/auth/v1', 'aud', 'authenticated',
      'exp', 1900000000, 'iat', 1899996400, 'sub', u_ag::text,
      'email', 't17@users.gest-in-situ.invalid', 'phone', '',
      'app_metadata', '{}'::jsonb, 'user_metadata', '{}'::jsonb,
      'role', 'authenticated', 'aal', 'aal1',
      'session_id', gen_random_uuid()::text, 'is_anonymous', false));

  -- ---------- 2. P0-a : role avec espaces refuse par la contrainte (postgres et anon) ----------
  b := false;
  BEGIN
    INSERT INTO public.t_user_roles (user_sync_id, role) VALUES ('t17-u-ag', ' SUPER ADMIN');
  EXCEPTION WHEN check_violation THEN b := true;
  END;
  m := NULL;
  BEGIN
    PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
    EXECUTE 'SET LOCAL ROLE anon';
    BEGIN
      INSERT INTO public.t_user_roles (user_sync_id, role) VALUES ('t17-u-ag', 'SUPER ADMIN ');
      m := 'accepte';
    EXCEPTION WHEN check_violation THEN m := '23514';
    END;
    EXECUTE 'RESET ROLE';
  EXCEPTION WHEN others THEN
    EXECUTE 'RESET ROLE';
    m := 'erreur ' || SQLSTATE;
  END;
  PERFORM set_config('request.jwt.claims', '', true);
  BEGIN
    UPDATE public.t_user_roles SET role = 'super admin' WHERE user_sync_id = 't17-u-sa2';
    b := false;
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  INSERT INTO _t VALUES (2, 'P0-a : '' SUPER ADMIN'' (postgres), ''SUPER ADMIN '' (anon reel) et ''super admin'' (UPDATE) refuses par la contrainte (23514)',
    b AND m = '23514'
      AND NOT EXISTS (SELECT 1 FROM public.t_user_roles WHERE user_sync_id LIKE 't17-%' AND role <> 'SUPER ADMIN' AND role ILIKE '%super%'),
    m);

  -- ---------- 3. anon inchange pour les valeurs legitimes ----------
  m := NULL;
  BEGIN
    PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
    EXECUTE 'SET LOCAL ROLE anon';
    INSERT INTO public.t_user_roles (user_sync_id, role) VALUES ('t17-u-ag', 'OPERATEUR_QUALITE');
    INSERT INTO public.t_user_roles (user_sync_id, role) VALUES ('t17-u-ag', 'ADMIN_CENTRE')
      ON CONFLICT (user_sync_id, role) DO UPDATE SET role = EXCLUDED.role;
    DELETE FROM public.t_user_roles WHERE user_sync_id = 't17-u-ag' AND role = 'ADMIN_CENTRE';
    -- SUPER ADMIN vers un non-SA : toujours ignore en silence par 0007.
    INSERT INTO public.t_user_roles (user_sync_id, role) VALUES ('t17-u-ag', 'SUPER ADMIN');
    EXECUTE 'RESET ROLE';
    m := 'ok';
  EXCEPTION WHEN others THEN
    EXECUTE 'RESET ROLE';
    m := 'erreur ' || SQLSTATE;
  END;
  PERFORM set_config('request.jwt.claims', '', true);
  INSERT INTO _t VALUES (3, 'anon reel : INSERT / upsert / DELETE de roles legitimes acceptes ; SUPER ADMIN vers non-SA toujours ignore (0007)',
    m = 'ok'
      AND EXISTS (SELECT 1 FROM public.t_user_roles WHERE user_sync_id = 't17-u-ag' AND role = 'OPERATEUR_QUALITE')
      AND NOT EXISTS (SELECT 1 FROM public.t_user_roles WHERE user_sync_id = 't17-u-ag' AND role IN ('ADMIN_CENTRE', 'SUPER ADMIN')),
    m);
  DELETE FROM public.t_user_roles WHERE user_sync_id = 't17-u-ag';

  -- ---------- 4. Hook : role avec espaces (ligne heritee) -> pas SUPER ADMIN ----------
  -- Simule une ligne anterieure a la contrainte (contrainte retiree dans CETTE
  -- transaction annulee seulement).
  ALTER TABLE public.t_user_roles DROP CONSTRAINT t_user_roles_role_check;
  INSERT INTO public.t_user_roles (user_sync_id, role) VALUES ('t17-u-esp', ' SUPER ADMIN');
  r := public.custom_access_token_hook(jsonb_set(ev, '{user_id}', to_jsonb(u_esp::text)));
  c := r -> 'claims';
  PERFORM set_config('request.jwt.claims', c::text, true);
  INSERT INTO _t VALUES (4, 'Hook : role secondaire '' SUPER ADMIN'' -> gis_is_super_admin false, role brut non nettoye ; fn_jwt_is_super_admin et fn_sa_guard_caller_sa_auth false',
    NOT (r ? 'error') AND c -> 'gis_is_super_admin' = 'false'::jsonb
      AND c -> 'gis_roles' @> '[" SUPER ADMIN"]'::jsonb
      AND NOT (c -> 'gis_roles' @> '["SUPER ADMIN"]'::jsonb)
      AND public.fn_jwt_is_super_admin() = false
      AND public.fn_sa_guard_caller_sa_auth() = false,
    (c -> 'gis_roles')::text);
  PERFORM set_config('request.jwt.claims', '', true);
  DELETE FROM public.t_user_roles WHERE user_sync_id = 't17-u-esp';
  ALTER TABLE public.t_user_roles ADD CONSTRAINT t_user_roles_role_check CHECK (role = ANY (ARRAY[
        'SUPER ADMIN'::text, 'ADMINISTRATEUR_SITE'::text, 'ADMIN_CENTRE'::text,
        'OPERATEUR_VERIFICATION'::text, 'OPERATEUR_QUALITE'::text, 'OPERATEUR_SAISIE'::text,
        'OPERATEUR_LOGISTIQUE'::text, 'OPERATEUR_INVENTAIRE'::text, 'OPERATEUR_APUREMENT'::text]));

  -- ---------- 5. Hook : SUPER ADMIN par t_user_roles exact = meme regle que 0015 ----------
  r := public.custom_access_token_hook(jsonb_set(ev, '{user_id}', to_jsonb(u_sa2::text)));
  c := r -> 'claims';
  PERFORM set_config('request.jwt.claims', c::text, true);
  INSERT INTO _t VALUES (5, 'Hook : SUPER ADMIN en role secondaire exact -> gis_is_super_admin true, et fn_sa_guard_caller_sa_auth (0015) true avec ces claims',
    NOT (r ? 'error') AND c -> 'gis_is_super_admin' = 'true'::jsonb
      AND public.fn_sa_guard_caller_sa_auth() = true,
    NULL);
  PERFORM set_config('request.jwt.claims', '', true);

  -- ---------- 6. P1-1 : methode d'emission ----------
  b := true;
  FOREACH m IN ARRAY ARRAY['password', 'oauth', 'anonymous', 'recovery', 'invite', 'sso/saml',
                           'email/signup', 'email_change', 'totp', 'oauth_provider/authorization_code', 'MAGICLINK', ''] LOOP
    r := public.custom_access_token_hook(jsonb_set(ev, '{authentication_method}', to_jsonb(m)));
    b := b AND (r -> 'error' ->> 'http_code')::int = 403 AND NOT (r ? 'claims');
  END LOOP;
  r := public.custom_access_token_hook(ev - 'authentication_method');
  b := b AND (r -> 'error' ->> 'http_code')::int = 403;
  INSERT INTO _t VALUES (6, 'P1-1 : password, oauth, anonymous, recovery, invite, sso, signup, email_change, totp, oauth_provider, casse differente, vide, absent -> 403',
    b, NULL);

  r := public.custom_access_token_hook(ev);
  b := NOT (r ? 'error') AND r -> 'claims' ->> 'gis_sync_id' = 't17-u-ag';
  r := public.custom_access_token_hook(jsonb_set(ev, '{authentication_method}', '"otp"'));
  b := b AND NOT (r ? 'error');
  UPDATE public.t_auth_identity SET last_online_login_at = NOW() - INTERVAL '1 hour' WHERE auth_user_id = u_ag;
  r := public.custom_access_token_hook(ev);
  b := b AND (r -> 'error' ->> 'http_code')::int = 403;
  r := public.custom_access_token_hook(jsonb_set(ev, '{authentication_method}', '"otp"'));
  b := b AND (r -> 'error' ->> 'http_code')::int = 403;
  r := public.custom_access_token_hook(jsonb_set(ev, '{authentication_method}', '"token_refresh"'));
  INSERT INTO _t VALUES (7, 'P1-1 : magiclink / otp acceptes juste apres gis-login (1 min), refuses 1 h apres ; token_refresh accepte 1 h apres',
    b AND NOT (r ? 'error') AND r -> 'claims' ->> 'gis_sync_id' = 't17-u-ag', NULL);
  UPDATE public.t_auth_identity SET last_online_login_at = NOW() - INTERVAL '1 minute' WHERE auth_user_id = u_ag;

  -- ---------- 8. P0-b (hook) : app_metadata.sync_id obligatoire et exact ----------
  r := public.custom_access_token_hook(jsonb_set(ev, '{user_id}', to_jsonb(u_nometa::text)));
  b := (r -> 'error' ->> 'http_code')::int = 403;
  UPDATE auth.users SET raw_app_meta_data = jsonb_build_object('sync_id', 'T17-U-C-META') WHERE id = u_nometa;
  r := public.custom_access_token_hook(jsonb_set(ev, '{user_id}', to_jsonb(u_nometa::text)));
  b := b AND (r -> 'error' ->> 'http_code')::int = 403;
  UPDATE auth.users SET raw_app_meta_data = jsonb_build_object('sync_id', 't17-u-c-meta') WHERE id = u_nometa;
  r := public.custom_access_token_hook(jsonb_set(ev, '{user_id}', to_jsonb(u_nometa::text)));
  INSERT INTO _t VALUES (8, 'Hook : compte Auth sans app_metadata.sync_id ou avec une autre casse -> 403 ; sync_id exact -> accepte',
    b AND NOT (r ? 'error'), NULL);

  -- ---------- 9. P1-4 : site suspendu / licence expiree, y compris token_refresh ----------
  b := true;
  FOREACH m IN ARRAY ARRAY['magiclink', 'token_refresh'] LOOP
    r := public.custom_access_token_hook(jsonb_set(jsonb_set(ev, '{user_id}', to_jsonb(u_susp::text)), '{authentication_method}', to_jsonb(m)));
    b := b AND (r -> 'error' ->> 'http_code')::int = 403 AND r -> 'error' ->> 'message' LIKE '%suspendu%';
    r := public.custom_access_token_hook(jsonb_set(jsonb_set(ev, '{user_id}', to_jsonb(u_exp::text)), '{authentication_method}', to_jsonb(m)));
    b := b AND (r -> 'error' ->> 'http_code')::int = 403 AND r -> 'error' ->> 'message' LIKE '%licence%';
  END LOOP;
  UPDATE public.t_sites SET is_active = NULL WHERE id = v_sa;
  r := public.custom_access_token_hook(ev);
  b := b AND (r -> 'error' ->> 'http_code')::int = 403;
  UPDATE public.t_sites SET is_active = 1 WHERE id = v_sa;
  INSERT INTO _t VALUES (9, 'P1-4 : site suspendu (0 ou NULL) et licence expiree -> 403, a l''emission ET au token_refresh',
    b, NULL);

  r := public.custom_access_token_hook(jsonb_set(ev, '{user_id}', to_jsonb(u_auj::text)));
  b := NOT (r ? 'error');
  r := public.custom_access_token_hook(jsonb_set(ev, '{user_id}', to_jsonb(u_perm::text)));
  b := b AND NOT (r ? 'error');
  r := public.custom_access_token_hook(jsonb_set(jsonb_set(ev, '{user_id}', to_jsonb(u_sa::text)), '{authentication_method}', '"token_refresh"'));
  INSERT INTO _t VALUES (10, 'P1-4 : licence qui expire aujourd''hui -> accepte (dernier jour utilisable) ; site permanent -> accepte ; SUPER ADMIN d''un site suspendu -> accepte (dispense)',
    b AND NOT (r ? 'error') AND r -> 'claims' -> 'gis_is_super_admin' = 'true'::jsonb, NULL);

  -- ---------- 11. P0-b (upsert) : rattachement ----------
  b := public.fn_auth_identity_upsert(u_ag, 't17-u-ag');                         -- normal
  b := b AND (SELECT last_online_login_at FROM public.t_auth_identity WHERE auth_user_id = u_ag) = NOW();
  b := b AND NOT public.fn_auth_identity_upsert(u_ag, 't17-u-sa2');              -- auth deja lie a une autre personne
  b := b AND (SELECT user_sync_id FROM public.t_auth_identity WHERE auth_user_id = u_ag) = 't17-u-ag';
  b := b AND NOT public.fn_auth_identity_upsert(u_libre, 't17-u-ag');            -- personne deja liee a un autre compte Auth
  b := b AND public.fn_auth_identity_upsert(u_nometa, 't17-u-c-meta');           -- reference : accepte
  UPDATE auth.users SET raw_app_meta_data = '{"provider":"email"}'::jsonb WHERE id = u_nometa;
  b := b AND NOT public.fn_auth_identity_upsert(u_nometa, 't17-u-c-meta');       -- miroir pre-cree sans app_metadata
  b := b AND NOT public.fn_auth_identity_upsert(u_autre, 't17-u-l2');            -- app_metadata d'une autre personne
  b := b AND NOT public.fn_auth_identity_upsert(u_casse, 't17-u-casse');         -- variante de casse d'un autre compte
  b := b AND NOT public.fn_auth_identity_upsert(u_casse, 't17-u-c a');           -- format invalide
  b := b AND NOT EXISTS (SELECT 1 FROM public.t_auth_identity WHERE auth_user_id IN (u_libre, u_autre, u_casse));
  INSERT INTO _t VALUES (11, 'P0-b : upsert accepte le cas normal (date seule) ; refuse auth deja lie ailleurs (sans reecriture), personne deja liee, sans app_metadata, app_metadata d''un autre, variante de casse, format invalide',
    b, NULL);

  -- ---------- 12. P1-2 : reserve atomique ----------
  b := true;
  FOR i IN 1..4 LOOP
    r := public.fn_login_check_and_record('t17_login', 'reserve');
    b := b AND (r ->> 'allowed')::boolean AND (r ->> 'lock_on_failure')::boolean = false;
  END LOOP;
  b := b AND (SELECT nb_echecs FROM public.t_login_attempts WHERE login_key = public.fn_login_key('t17_login')) = 4;
  r := public.fn_login_check_and_record('t17_login', 'reserve');
  b := b AND (r ->> 'allowed')::boolean AND (r ->> 'lock_on_failure')::boolean AND (r ->> 'retry_on_failure_s')::int = 900;
  -- Blocage DEJA pose avant l'issue de la 5e tentative : toute autre tentative refusee.
  r := public.fn_login_check_and_record('t17_login', 'reserve');
  b := b AND NOT (r ->> 'allowed')::boolean AND (r ->> 'retry_after_s')::int = 900;
  r := public.fn_login_check_and_record('t17_login', 'check');
  b := b AND NOT (r ->> 'allowed')::boolean;
  INSERT INTO _t VALUES (12, 'P1-2 : reserve compte l''echec AVANT bcrypt ; 5e reserve autorisee avec lock_on_failure (900 s) et blocage deja pose ; 6e refusee',
    b, r::text);

  r := public.fn_login_check_and_record('t17_login', 'success');
  b := NOT EXISTS (SELECT 1 FROM public.t_login_attempts WHERE login_key = public.fn_login_key('t17_login'));
  r := public.fn_login_check_and_record('t17_ok', 'reserve');
  r := public.fn_login_check_and_record('t17_ok', 'success');
  b := b AND NOT EXISTS (SELECT 1 FROM public.t_login_attempts WHERE login_key = public.fn_login_key('t17_ok'));
  INSERT INTO _t VALUES (13, 'P1-2 : success efface la reservation et le blocage pose par la meme tentative',
    b, NULL);

  -- Login inconnu vs connu : memes reponses, pas d'enumeration.
  b := true;
  FOR i IN 1..6 LOOP
    b := b AND public.fn_login_check_and_record('t17_ag', 'reserve')
             = public.fn_login_check_and_record('t17_inconnu_xyz', 'reserve');
  END LOOP;
  INSERT INTO _t VALUES (14, 'P1-2 : login existant et login inconnu -> reponses identiques sur 6 reservations (dont 429)',
    b, NULL);

  -- 'failure' (gis-login v1) inchange.
  b := true;
  FOR i IN 1..4 LOOP
    r := public.fn_login_check_and_record('t17_v1', 'failure');
    b := b AND (r ->> 'allowed')::boolean;
  END LOOP;
  r := public.fn_login_check_and_record('t17_v1', 'failure');
  INSERT INTO _t VALUES (15, 'Compatibilite gis-login v1 : 4 failure autorises, 5e -> refus 900 s',
    b AND NOT (r ->> 'allowed')::boolean AND (r ->> 'retry_after_s')::int = 900, r::text);

  -- ---------- 16. P1-2 : saturation = echec ferme ----------
  INSERT INTO public.t_login_attempts (login_key, nb_echecs, nb_blocages, premier_echec_at, dernier_echec_at, updated_at)
  SELECT encode(sha256(convert_to('t17-plein-' || g, 'UTF8')), 'hex'), 1, 0, NOW(), NOW(), NOW()
    FROM generate_series(1, 100000) g
  ON CONFLICT DO NOTHING;
  SELECT count(*) INTO n FROM public.t_login_attempts;
  r := public.fn_login_check_and_record('t17_nouveau', 'reserve');
  b := NOT (r ->> 'allowed')::boolean AND (r ->> 'error')::boolean AND (r ->> 'full')::boolean;
  r := public.fn_login_check_and_record('t17_nouveau', 'failure');
  b := b AND NOT (r ->> 'allowed')::boolean AND (r ->> 'error')::boolean;
  b := b AND NOT EXISTS (SELECT 1 FROM public.t_login_attempts WHERE login_key = public.fn_login_key('t17_nouveau'));
  -- Un login qui a deja sa ligne continue d'etre compte.
  r := public.fn_login_check_and_record('t17-plein-1', 'reserve');
  b := b AND (r ->> 'allowed')::boolean AND (r ->> 'lock_on_failure') IS NOT NULL;
  -- Les lignes vieilles de plus de 24 h sont purgees puis la place est reprise.
  UPDATE public.t_login_attempts SET dernier_echec_at = NOW() - INTERVAL '25 hours'
   WHERE login_key IN (SELECT login_key FROM public.t_login_attempts WHERE nb_echecs = 1 LIMIT 10);
  r := public.fn_login_check_and_record('t17_nouveau', 'reserve');
  INSERT INTO _t VALUES (16, 'P1-2 : table pleine -> echec FERME (allowed false, error, full), aucune ligne creee ; ligne existante toujours comptee ; purge > 24 h libere la place',
    b AND (r ->> 'allowed')::boolean, n::text);

  PERFORM set_config('request.jwt.claims', '', true);
END;
$$;

SELECT n, ok, cas, detail FROM _t ORDER BY n;

DO $$
DECLARE
  v_ko TEXT;
BEGIN
  SELECT string_agg(n::text, ', ' ORDER BY n) INTO v_ko FROM _t WHERE ok IS NOT TRUE;
  IF v_ko IS NOT NULL THEN
    RAISE EXCEPTION 'TEST 0017 ECHEC : cas en erreur : %', v_ko;
  END IF;
  RAISE NOTICE 'TEST 0017 OK (% cas)', (SELECT count(*) FROM _t);
END;
$$;

ROLLBACK;
