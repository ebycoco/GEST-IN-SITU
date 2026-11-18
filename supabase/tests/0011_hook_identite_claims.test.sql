-- ============================================================
-- Test de supabase/migrations/0011_hook_identite_claims.sql
-- A executer sur le projet DEV uniquement (ajadkziqaskadlzboeqo), apres
-- 0011, dans le SQL Editor (role postgres). Transaction ANNULEE (ROLLBACK
-- final) : aucune ligne ne reste (sites, centres, comptes, utilisateurs Auth
-- et identites de test 't11*').
-- Le hook est appele DIRECTEMENT avec un evenement JSON simule (le hook n'a
-- pas besoin d'etre active dans les reglages Auth pour ce test).
-- Resultat : table _t, puis un bloc qui LEVE UNE ERREUR si un cas vaut false.
-- NE JAMAIS EXECUTER EN PROD.
-- ============================================================
BEGIN;

CREATE TEMP TABLE _t (n INT, cas TEXT, ok BOOLEAN, detail TEXT) ON COMMIT DROP;

DO $$
DECLARE
  v_sa_id  BIGINT;  v_sb_id BIGINT;
  v_ca_id  BIGINT;  v_cb_id BIGINT;
  u_ok     UUID := gen_random_uuid();   -- agent actif, site A, centre A, 2 roles
  u_inact  UUID := gen_random_uuid();   -- agent inactif
  u_sa     UUID := gen_random_uuid();   -- SUPER ADMIN sans site, sans ligne t_user_roles
  u_vieux  UUID := gen_random_uuid();   -- derniere connexion en ligne il y a 31 jours
  u_29j    UUID := gen_random_uuid();   -- il y a 29 jours
  u_ssite  UUID := gen_random_uuid();   -- non-SA sans site
  u_xcen   UUID := gen_random_uuid();   -- centre d'un autre site
  u_noid   UUID := gen_random_uuid();   -- utilisateur Auth sans identite
  u_orph   UUID := gen_random_uuid();   -- identite vers un compte t_users absent
  u_null   UUID := gen_random_uuid();   -- statut_actif NULL
  ev       JSONB;
  r        JSONB;
  c        JSONB;
  b        BOOLEAN;
  v_txt    TEXT;
  v_arr    TEXT[];
  v_big    BIGINT;
  f        TEXT;
  n_ko     INT;
BEGIN
  PERFORM set_config('request.jwt.claims', '', true);

  -- ---------- 0. Preconditions (droits) ----------
  INSERT INTO _t VALUES (0, 'Hook : SECURITY DEFINER, STABLE, search_path fige ; EXECUTE supabase_auth_admin ; refuse a anon, authenticated et PUBLIC',
    (SELECT p.prosecdef AND p.provolatile = 's'
            AND EXISTS (SELECT 1 FROM unnest(p.proconfig) x WHERE x LIKE 'search\_path=%')
       FROM pg_proc p WHERE p.oid = 'public.custom_access_token_hook(jsonb)'::regprocedure)
      AND has_function_privilege('supabase_auth_admin', 'public.custom_access_token_hook(jsonb)', 'EXECUTE')
      AND NOT has_function_privilege('anon', 'public.custom_access_token_hook(jsonb)', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'public.custom_access_token_hook(jsonb)', 'EXECUTE')
      AND NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
                       WHERE p.oid = 'public.custom_access_token_hook(jsonb)'::regprocedure AND a.grantee = 0),
    NULL);

  INSERT INTO _t VALUES (1, 't_auth_identity : RLS active, aucune politique, aucun droit anon/authenticated ; fn_auth_identity_upsert EXECUTE service_role seulement',
    (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.t_auth_identity'::regclass)
      AND NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 't_auth_identity')
      AND NOT has_table_privilege('anon', 'public.t_auth_identity', 'SELECT')
      AND NOT has_table_privilege('authenticated', 'public.t_auth_identity', 'SELECT')
      AND NOT has_table_privilege('anon', 'public.t_auth_identity', 'INSERT')
      AND NOT has_table_privilege('authenticated', 'public.t_auth_identity', 'UPDATE')
      AND has_function_privilege('service_role', 'public.fn_auth_identity_upsert(uuid,text)', 'EXECUTE')
      AND NOT has_function_privilege('anon', 'public.fn_auth_identity_upsert(uuid,text)', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'public.fn_auth_identity_upsert(uuid,text)', 'EXECUTE'),
    NULL);

  b := true;
  FOREACH f IN ARRAY ARRAY['public.fn_jwt_gis_claims()', 'public.fn_jwt_sync_id()',
                           'public.fn_jwt_site_sync_id()', 'public.fn_jwt_site_id()',
                           'public.fn_jwt_centre_id()', 'public.fn_jwt_roles()',
                           'public.fn_jwt_is_super_admin()'] LOOP
    b := b AND has_function_privilege('authenticated', f, 'EXECUTE')
           AND NOT has_function_privilege('anon', f, 'EXECUTE')
           AND NOT (SELECT prosecdef FROM pg_proc WHERE oid = f::regprocedure);
  END LOOP;
  INSERT INTO _t VALUES (2, 'Fonctions fn_jwt_* : SECURITY INVOKER, EXECUTE authenticated, refusees a anon', b, NULL);

  -- ---------- Jeu de test ----------
  INSERT INTO public.t_sites (nom, code, sync_id) VALUES ('T11 SITE A', 'T11A', 't11-site-a') RETURNING id INTO v_sa_id;
  INSERT INTO public.t_sites (nom, code, sync_id) VALUES ('T11 SITE B', 'T11B', 't11-site-b') RETURNING id INTO v_sb_id;
  INSERT INTO public.t_centres (site_id, nom, numero, sync_id) VALUES (v_sa_id, 'T11 CENTRE A', 1, 't11-cen-a') RETURNING id INTO v_ca_id;
  INSERT INTO public.t_centres (site_id, nom, numero, sync_id) VALUES (v_sb_id, 'T11 CENTRE B', 1, 't11-cen-b') RETURNING id INTO v_cb_id;

  INSERT INTO public.t_users (login, password_hash, role, statut_actif, site_id, centre_id, sync_id) VALUES
    ('t11_ok',    'x', 'OPERATEUR_VERIFICATION', 1, v_sa_id, v_ca_id, 't11-u-ok'),
    ('t11_inact', 'x', 'OPERATEUR_VERIFICATION', 0, v_sa_id, NULL,    't11-u-inact'),
    ('t11_vieux', 'x', 'OPERATEUR_SAISIE',       1, v_sa_id, NULL,    't11-u-vieux'),
    ('t11_29j',   'x', 'OPERATEUR_SAISIE',       1, v_sa_id, NULL,    't11-u-29j'),
    ('t11_ssite', 'x', 'OPERATEUR_SAISIE',       1, NULL,    NULL,    't11-u-ssite'),
    ('t11_xcen',  'x', 'ADMIN_CENTRE',           1, v_sa_id, v_cb_id, 't11-u-xcen'),
    ('t11_null',  'x', 'OPERATEUR_SAISIE',       1, v_sa_id, NULL,    't11-u-null');
  UPDATE public.t_users SET statut_actif = NULL WHERE sync_id = 't11-u-null';
  -- SUPER ADMIN de test : insere par postgres (appelant fiable pour 0007).
  INSERT INTO public.t_users (login, password_hash, role, statut_actif, site_id, centre_id, sync_id)
  VALUES ('t11_sa', 'x', 'SUPER ADMIN', 1, NULL, NULL, 't11-u-sa');

  INSERT INTO public.t_user_roles (user_sync_id, role) VALUES
    ('t11-u-ok', 'OPERATEUR_VERIFICATION'),   -- doublon du role principal
    ('t11-u-ok', 'ADMIN_CENTRE');

  INSERT INTO auth.users (id, aud, role, email, created_at, updated_at)
  SELECT x, 'authenticated', 'authenticated', 't11-' || x::text || '@users.gest-in-situ.invalid', NOW(), NOW()
    FROM unnest(ARRAY[u_ok, u_inact, u_sa, u_vieux, u_29j, u_ssite, u_xcen, u_noid, u_orph, u_null]) AS x;

  INSERT INTO public.t_auth_identity (auth_user_id, user_sync_id, last_online_login_at) VALUES
    (u_ok,    't11-u-ok',      NOW() - INTERVAL '1 hour'),
    (u_inact, 't11-u-inact',   NOW()),
    (u_sa,    't11-u-sa',      NOW()),
    (u_vieux, 't11-u-vieux',   NOW() - INTERVAL '31 days'),
    (u_29j,   't11-u-29j',     NOW() - INTERVAL '29 days'),
    (u_ssite, 't11-u-ssite',   NOW()),
    (u_xcen,  't11-u-xcen',    NOW()),
    (u_orph,  't11-u-absent',  NOW()),
    (u_null,  't11-u-null',    NOW());

  -- Evenement simule (forme de la doc Supabase).
  ev := jsonb_build_object(
    'user_id', u_ok::text,
    'authentication_method', 'magiclink',
    'claims', jsonb_build_object(
      'iss', 'https://exemple.invalid/auth/v1', 'aud', 'authenticated',
      'exp', 1900000000, 'iat', 1899996400, 'sub', u_ok::text,
      'email', 't11@users.gest-in-situ.invalid', 'phone', '',
      'app_metadata', '{}'::jsonb, 'user_metadata', '{}'::jsonb,
      'role', 'authenticated', 'aal', 'aal1',
      'amr', jsonb_build_array(jsonb_build_object('method', 'magiclink', 'timestamp', 1899996400)),
      'session_id', gen_random_uuid()::text, 'is_anonymous', false));

  -- ---------- 3. Agent actif : claims gis_* corrects ----------
  r := public.custom_access_token_hook(ev);
  c := r -> 'claims';
  INSERT INTO _t VALUES (3, 'Agent actif : pas d''erreur, ids CLOUD de site/centre et sync_id corrects, statut actif, version 1',
    NOT (r ? 'error')
      AND c ->> 'gis_sync_id' = 't11-u-ok'
      AND (c ->> 'gis_site_id')::bigint = v_sa_id
      AND c ->> 'gis_site_sync_id' = 't11-site-a'
      AND (c ->> 'gis_centre_id')::bigint = v_ca_id
      AND c ->> 'gis_centre_sync_id' = 't11-cen-a'
      AND c ->> 'gis_primary_role' = 'OPERATEUR_VERIFICATION'
      AND c -> 'gis_is_super_admin' = 'false'::jsonb
      AND c -> 'gis_statut_actif' = 'true'::jsonb
      AND (c ->> 'gis_v')::int = 1
      AND abs((c ->> 'gis_last_online_login')::bigint - floor(extract(epoch FROM NOW() - INTERVAL '1 hour'))::bigint) <= 1,
    NULL);

  INSERT INTO _t VALUES (4, 'Roles = t_users.role UNION t_user_roles, tries, sans doublon',
    c -> 'gis_roles' = '["ADMIN_CENTRE", "OPERATEUR_VERIFICATION"]'::jsonb,
    (c -> 'gis_roles')::text);

  INSERT INTO _t VALUES (5, 'Claims obligatoires conservees a l''identique, role toujours authenticated, aucune cle poste ni hash',
    (SELECT bool_and(c -> k = ev -> 'claims' -> k)
       FROM unnest(ARRAY['iss','aud','exp','iat','sub','role','aal','session_id','email','phone','is_anonymous','amr','app_metadata','user_metadata']) k)
      AND c ->> 'role' = 'authenticated'
      AND NOT EXISTS (SELECT 1 FROM jsonb_object_keys(c) k
                       WHERE k ILIKE '%poste%' OR k ILIKE '%hash%' OR k ILIKE '%password%' OR k ILIKE '%login_name%')
      AND position('t11_ok' IN c::text) = 0,
    NULL);

  -- ---------- 6. Refus : compte inactif / statut NULL ----------
  r := public.custom_access_token_hook(jsonb_set(ev, '{user_id}', to_jsonb(u_inact::text)));
  b := (r -> 'error' ->> 'http_code')::int = 403 AND NOT (r ? 'claims');
  r := public.custom_access_token_hook(jsonb_set(ev, '{user_id}', to_jsonb(u_null::text)));
  INSERT INTO _t VALUES (6, 'Compte inactif (0) ou statut_actif NULL : refus 403, aucune claim renvoyee',
    b AND (r -> 'error' ->> 'http_code')::int = 403 AND NOT (r ? 'claims'), r::text);

  -- ---------- 7. D3 : 30 jours ----------
  r := public.custom_access_token_hook(jsonb_set(jsonb_set(ev, '{user_id}', to_jsonb(u_vieux::text)),
                                                 '{authentication_method}', '"token_refresh"'));
  b := (r -> 'error' ->> 'http_code')::int = 403;
  r := public.custom_access_token_hook(jsonb_set(jsonb_set(ev, '{user_id}', to_jsonb(u_29j::text)),
                                                 '{authentication_method}', '"token_refresh"'));
  INSERT INTO _t VALUES (7, 'D3 : derniere connexion en ligne il y a 31 j -> refus 403 au token_refresh ; 29 j -> accepte',
    b AND NOT (r ? 'error') AND r -> 'claims' ->> 'gis_sync_id' = 't11-u-29j', NULL);

  -- ---------- 8. SUPER ADMIN sans site, role lu dans t_users seulement ----------
  r := public.custom_access_token_hook(jsonb_set(ev, '{user_id}', to_jsonb(u_sa::text)));
  c := r -> 'claims';
  INSERT INTO _t VALUES (8, 'SUPER ADMIN sans ligne t_user_roles ni site : accepte, gis_is_super_admin true, site et centre null',
    NOT (r ? 'error') AND c -> 'gis_is_super_admin' = 'true'::jsonb
      AND c -> 'gis_roles' = '["SUPER ADMIN"]'::jsonb
      AND c -> 'gis_site_id' = 'null'::jsonb AND c -> 'gis_site_sync_id' = 'null'::jsonb
      AND c -> 'gis_centre_id' = 'null'::jsonb,
    NULL);

  -- ---------- 9-11. Refus : sans identite, identite orpheline, non-SA sans site ----------
  r := public.custom_access_token_hook(jsonb_set(ev, '{user_id}', to_jsonb(u_noid::text)));
  INSERT INTO _t VALUES (9, 'Utilisateur Auth sans ligne t_auth_identity : refus 403',
    (r -> 'error' ->> 'http_code')::int = 403, NULL);
  r := public.custom_access_token_hook(jsonb_set(ev, '{user_id}', to_jsonb(u_orph::text)));
  INSERT INTO _t VALUES (10, 'Identite vers un compte t_users absent : refus 403',
    (r -> 'error' ->> 'http_code')::int = 403, NULL);
  r := public.custom_access_token_hook(jsonb_set(ev, '{user_id}', to_jsonb(u_ssite::text)));
  INSERT INTO _t VALUES (11, 'Agent non SUPER ADMIN sans site : refus 403',
    (r -> 'error' ->> 'http_code')::int = 403, NULL);

  -- ---------- 12. Centre d'un autre site ----------
  r := public.custom_access_token_hook(jsonb_set(ev, '{user_id}', to_jsonb(u_xcen::text)));
  c := r -> 'claims';
  INSERT INTO _t VALUES (12, 'Centre appartenant a un autre site : jeton delivre, claims centre a null, site conserve',
    NOT (r ? 'error') AND c -> 'gis_centre_id' = 'null'::jsonb AND c -> 'gis_centre_sync_id' = 'null'::jsonb
      AND (c ->> 'gis_site_id')::bigint = v_sa_id, NULL);

  -- ---------- 13. Evenements malformes : refus, jamais d'exception ----------
  b := true;
  BEGIN
    r := public.custom_access_token_hook(jsonb_set(ev, '{user_id}', '"pas-un-uuid"'));
    b := b AND (r -> 'error' ->> 'http_code')::int = 403;
    r := public.custom_access_token_hook(ev - 'claims');
    b := b AND (r -> 'error' ->> 'http_code')::int = 403;
    r := public.custom_access_token_hook('{}'::jsonb);
    b := b AND (r -> 'error' ->> 'http_code')::int = 403;
    r := public.custom_access_token_hook(NULL);
    b := b AND (r -> 'error' ->> 'http_code')::int = 403;
  EXCEPTION WHEN others THEN
    b := false;
  END;
  INSERT INTO _t VALUES (13, 'Evenement malforme (user_id invalide, sans claims, vide, NULL) : refus 403 sans exception', b, NULL);

  -- ---------- 14. Le hook n'ecrit rien ----------
  INSERT INTO _t VALUES (14, 'Hook en lecture seule : last_online_login_at inchange apres appels',
    (SELECT last_online_login_at FROM public.t_auth_identity WHERE auth_user_id = u_ok)
      = (SELECT NOW() - INTERVAL '1 hour'), NULL);

  -- ---------- 15. Fonctions fn_jwt_* avec les claims du hook ----------
  r := public.custom_access_token_hook(ev);
  PERFORM set_config('request.jwt.claims', (r -> 'claims')::text, true);
  v_txt := public.fn_jwt_site_sync_id(); v_big := public.fn_jwt_site_id(); v_arr := public.fn_jwt_roles();
  INSERT INTO _t VALUES (15, 'Claims agent (authenticated) : fn_jwt_site_id / site_sync_id / centre_id / sync_id / roles / is_super_admin corrects',
    v_txt = 't11-site-a' AND v_big = v_sa_id AND public.fn_jwt_centre_id() = v_ca_id
      AND public.fn_jwt_sync_id() = 't11-u-ok'
      AND v_arr = ARRAY['ADMIN_CENTRE', 'OPERATEUR_VERIFICATION']
      AND public.fn_jwt_is_super_admin() = false,
    NULL);

  r := public.custom_access_token_hook(jsonb_set(ev, '{user_id}', to_jsonb(u_sa::text)));
  PERFORM set_config('request.jwt.claims', (r -> 'claims')::text, true);
  INSERT INTO _t VALUES (16, 'Claims SUPER ADMIN : fn_jwt_is_super_admin true, fn_jwt_site_id NULL',
    public.fn_jwt_is_super_admin() AND public.fn_jwt_site_id() IS NULL, NULL);

  -- Cle publique (forme publishable) et jeton anon portant de fausses claims gis_*.
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  b := public.fn_jwt_site_id() IS NULL AND public.fn_jwt_is_super_admin() = false
       AND public.fn_jwt_roles() = ARRAY[]::TEXT[] AND public.fn_jwt_sync_id() IS NULL;
  PERFORM set_config('request.jwt.claims',
    '{"role":"anon","gis_v":1,"gis_is_super_admin":true,"gis_site_id":1,"gis_roles":["SUPER ADMIN"]}', true);
  b := b AND public.fn_jwt_is_super_admin() = false AND public.fn_jwt_site_id() IS NULL
         AND public.fn_jwt_roles() = ARRAY[]::TEXT[];
  -- authenticated sans hook (jeton emis avant activation) : aucune claim gis_ reconnue.
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"x"}', true);
  b := b AND public.fn_jwt_is_super_admin() = false AND public.fn_jwt_site_id() IS NULL;
  -- claims illisibles / gis_site_id non numerique.
  PERFORM set_config('request.jwt.claims', 'pas du json', true);
  b := b AND public.fn_jwt_site_id() IS NULL AND public.fn_jwt_is_super_admin() = false;
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","gis_v":1,"gis_site_id":"1 OR 1=1","gis_is_super_admin":"true"}', true);
  b := b AND public.fn_jwt_site_id() IS NULL AND public.fn_jwt_is_super_admin() = false;
  PERFORM set_config('request.jwt.claims', '', true);
  b := b AND public.fn_jwt_site_id() IS NULL AND public.fn_jwt_is_super_admin() = false;
  INSERT INTO _t VALUES (17, 'Claims gis_* ignorees hors role authenticated + gis_v (anon, anon forge, jeton sans hook, JSON illisible, valeurs non typees, sans claims)', b, NULL);

  -- ---------- 18. fn_auth_identity_upsert ----------
  UPDATE public.t_auth_identity SET last_online_login_at = NOW() - INTERVAL '10 days' WHERE auth_user_id = u_29j;
  PERFORM set_config('request.jwt.claims', '', true);
  b := public.fn_auth_identity_upsert(u_29j, 't11-u-29j');
  b := b AND (SELECT last_online_login_at FROM public.t_auth_identity WHERE auth_user_id = u_29j) = NOW();
  b := b AND NOT public.fn_auth_identity_upsert(u_noid, 't11-u-inact');      -- compte inactif
  b := b AND NOT public.fn_auth_identity_upsert(u_noid, 't11-u-inexistant'); -- compte absent
  b := b AND NOT public.fn_auth_identity_upsert(u_noid, 't11-u-ok');         -- deja lie a un autre compte Auth
  b := b AND NOT public.fn_auth_identity_upsert(NULL, 't11-u-ok');
  b := b AND NOT EXISTS (SELECT 1 FROM public.t_auth_identity WHERE auth_user_id = u_noid);
  INSERT INTO _t VALUES (18, 'fn_auth_identity_upsert : met a jour last_online_login_at ; refuse compte inactif, absent, deja lie, parametre NULL', b, NULL);

  -- ---------- 19. Suppression du compte Auth -> identite supprimee ----------
  DELETE FROM auth.users WHERE id = u_xcen;
  INSERT INTO _t VALUES (19, 'ON DELETE CASCADE : suppression du compte Auth miroir supprime son identite',
    NOT EXISTS (SELECT 1 FROM public.t_auth_identity WHERE auth_user_id = u_xcen), NULL);

  -- ---------- 20. Appel reel en tant que supabase_auth_admin ----------
  BEGIN
    EXECUTE 'SET LOCAL ROLE supabase_auth_admin';
    r := public.custom_access_token_hook(ev);
    EXECUTE 'RESET ROLE';
    INSERT INTO _t VALUES (20, 'Appel du hook sous le role supabase_auth_admin (celui d''Auth) : claims produites',
      NOT (r ? 'error') AND r -> 'claims' ->> 'gis_sync_id' = 't11-u-ok', NULL);
  EXCEPTION WHEN insufficient_privilege THEN
    EXECUTE 'RESET ROLE';
    INSERT INTO _t VALUES (20, 'Appel du hook sous le role supabase_auth_admin : SET ROLE refuse au role courant (non concluant, couvert par le cas 0)',
      NULL, SQLSTATE);
  END;

  PERFORM set_config('request.jwt.claims', '', true);
END;
$$;

SELECT n, ok, cas, detail FROM _t ORDER BY n;

DO $$
DECLARE
  v_ko TEXT;
BEGIN
  SELECT string_agg(n::text, ', ' ORDER BY n) INTO v_ko FROM _t WHERE ok IS NOT TRUE AND n <> 20;
  IF v_ko IS NOT NULL THEN
    RAISE EXCEPTION 'TEST 0011 ECHEC : cas en erreur : %', v_ko;
  END IF;
  RAISE NOTICE 'TEST 0011 OK (% cas, cas 20 : %)', (SELECT count(*) FROM _t),
    (SELECT COALESCE(ok::text, 'non concluant') FROM _t WHERE n = 20);
END;
$$;

ROLLBACK;
