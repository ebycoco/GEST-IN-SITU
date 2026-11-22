-- ============================================================
-- Test de supabase/migrations/0018_correctifs_controle_p1.sql
-- A executer sur le projet DEV uniquement (ajadkziqaskadlzboeqo), apres
-- 0018, dans le SQL Editor (role postgres). Transaction ANNULEE (ROLLBACK
-- final) : aucune ligne ne reste (sites, comptes, utilisateurs Auth,
-- identites et tentatives de test 't18*'), et les changements de type de
-- colonnes du cas 9 sont annules avec elle.
-- Le hook est appele DIRECTEMENT avec un evenement JSON simule (il n'a pas
-- besoin d'etre active dans les reglages Auth pour ce test).
-- Resultat : table _t, puis un bloc qui LEVE UNE ERREUR si un cas vaut false.
-- NE JAMAIS EXECUTER EN PROD.
-- ============================================================
BEGIN;

CREATE TEMP TABLE _t (n INT, cas TEXT, ok BOOLEAN, detail TEXT) ON COMMIT DROP;

DO $$
DECLARE
  v_sa   BIGINT; v_susp BIGINT;
  u_ag   UUID := gen_random_uuid();  -- agent site A
  u_sa   UUID := gen_random_uuid();  -- SUPER ADMIN principal, site suspendu
  u_sa2  UUID := gen_random_uuid();  -- SUPER ADMIN seulement secondaire, site A
  u_sa3  UUID := gen_random_uuid();  -- SUPER ADMIN seulement secondaire, sans site
  u_sa4  UUID := gen_random_uuid();  -- SUPER ADMIN seulement secondaire, site suspendu
  u_c1   UUID := gen_random_uuid();  -- t18-u-Casse (deja rattache)
  u_c2   UUID := gen_random_uuid();  -- compte Auth pour t18-u-casse (variante creee apres)
  u_v1   UUID := gen_random_uuid();  -- t18-u-Var (jamais rattache, variante t18-u-var existe)
  ev  JSONB;
  r   JSONB;
  c   JSONB;
  b   BOOLEAN;
  n   BIGINT;
  i   INT;
  m   TEXT;
  v_empr_avant TEXT;
  v_empr_apres TEXT;
BEGIN
  PERFORM set_config('request.jwt.claims', '', true);

  -- Empreinte anon (requete du README, section 0013) avant les cas.
  SELECT md5(string_agg(x, '|' ORDER BY x)) || '/' || count(*) INTO v_empr_avant FROM (
   SELECT 'pol:'||tablename||':'||policyname||':'||permissive||':'||cmd||':'||array_to_string(roles,',')||':'||coalesce(qual,'')||':'||coalesce(with_check,'') x
     FROM pg_policies WHERE schemaname='public' AND ('anon'=ANY(roles) OR 'public'=ANY(roles))
   UNION ALL
   SELECT 'priv:'||c.relname||':'||pr FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) pr
    WHERE n.nspname='public' AND c.relkind='r' AND has_table_privilege('anon',c.oid,pr)
   UNION ALL
   SELECT 'col:'||attrelid::regclass||':'||attname FROM pg_attribute
    WHERE attrelid IN (SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r')
      AND attnum>0 AND NOT attisdropped AND has_column_privilege('anon',attrelid,attnum,'SELECT')
   UNION ALL
   SELECT 'fn:'||p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND has_function_privilege('anon',p.oid,'EXECUTE')) s;

  -- ---------- 0. Droits ----------
  INSERT INTO _t VALUES (0, 'Droits : hook -> supabase_auth_admin ; upsert / tentatives -> service_role ; fn_sa_guard_caller_sa_auth fermee ; aucun EXECUTE anon / authenticated / PUBLIC ; search_path fige',
    has_function_privilege('supabase_auth_admin', 'public.custom_access_token_hook(jsonb)', 'EXECUTE')
      AND has_function_privilege('service_role', 'public.fn_auth_identity_upsert(uuid,text)', 'EXECUTE')
      AND has_function_privilege('service_role', 'public.fn_login_check_and_record(text,text)', 'EXECUTE')
      AND (SELECT count(*) FROM (VALUES ('anon'), ('authenticated')) rr(r),
             (VALUES ('public.custom_access_token_hook(jsonb)'), ('public.fn_auth_identity_upsert(uuid,text)'),
                     ('public.fn_login_check_and_record(text,text)'), ('public.fn_sa_guard_caller_sa_auth()')) f(sig)
            WHERE has_function_privilege(rr.r, f.sig::regprocedure, 'EXECUTE')) = 0
      AND NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
                       WHERE p.oid IN ('public.custom_access_token_hook(jsonb)'::regprocedure,
                                       'public.fn_auth_identity_upsert(uuid,text)'::regprocedure,
                                       'public.fn_login_check_and_record(text,text)'::regprocedure,
                                       'public.fn_sa_guard_caller_sa_auth()'::regprocedure)
                         AND a.grantee = 0)
      AND (SELECT bool_and(EXISTS (SELECT 1 FROM unnest(p.proconfig) x WHERE x LIKE 'search\_path=%'))
             FROM pg_proc p
            WHERE p.oid IN ('public.custom_access_token_hook(jsonb)'::regprocedure,
                            'public.fn_auth_identity_upsert(uuid,text)'::regprocedure,
                            'public.fn_login_check_and_record(text,text)'::regprocedure,
                            'public.fn_sa_guard_caller_sa_auth()'::regprocedure)),
    NULL);

  -- ---------- Jeu de test ----------
  INSERT INTO public.t_sites (nom, code, sync_id, is_active, is_permanent, expiry_date)
    VALUES ('T18 SITE A', 'T18A', 't18-site-a', 1, true, NULL) RETURNING id INTO v_sa;
  INSERT INTO public.t_sites (nom, code, sync_id, is_active, is_permanent, expiry_date)
    VALUES ('T18 SITE SUSP', 'T18S', 't18-site-s', 0, true, NULL) RETURNING id INTO v_susp;

  INSERT INTO public.t_users (login, password_hash, role, statut_actif, site_id, sync_id) VALUES
    ('t18_ag',   'x', 'OPERATEUR_VERIFICATION', 1, v_sa,   't18-u-ag'),
    ('t18_op',   'x', 'OPERATEUR_SAISIE',       1, v_sa,   't18-u-op'),
    ('t18_sa2',  'x', 'ADMINISTRATEUR_SITE',    1, v_sa,   't18-u-sa2'),
    ('t18_sa3',  'x', 'OPERATEUR_SAISIE',       1, NULL,   't18-u-sa3'),
    ('t18_sa4',  'x', 'OPERATEUR_SAISIE',       1, v_susp, 't18-u-sa4'),
    ('t18_c1',   'x', 'OPERATEUR_SAISIE',       1, v_sa,   't18-u-Casse'),
    ('t18_v1',   'x', 'OPERATEUR_SAISIE',       1, v_sa,   't18-u-Var'),
    ('t18_v2',   'x', 'OPERATEUR_SAISIE',       1, v_sa,   't18-u-var');
  -- SUPER ADMIN principal : insere par postgres (appelant fiable pour 0007), site suspendu.
  INSERT INTO public.t_users (login, password_hash, role, statut_actif, site_id, sync_id)
  VALUES ('t18_sa', 'x', 'SUPER ADMIN', 1, v_susp, 't18-u-sa');
  INSERT INTO public.t_user_roles (user_sync_id, role) VALUES
    ('t18-u-sa', 'SUPER ADMIN'),
    ('t18-u-sa2', 'ADMINISTRATEUR_SITE'), ('t18-u-sa2', 'SUPER ADMIN'),
    ('t18-u-sa3', 'SUPER ADMIN'), ('t18-u-sa4', 'SUPER ADMIN');

  INSERT INTO auth.users (id, aud, role, email, raw_app_meta_data, created_at, updated_at)
  SELECT x.id, 'authenticated', 'authenticated', 't18-' || x.id::text || '@users.gest-in-situ.invalid',
         x.meta, NOW(), NOW()
    FROM (VALUES (u_ag,  jsonb_build_object('sync_id', 't18-u-ag')),
                 (u_sa,  jsonb_build_object('sync_id', 't18-u-sa')),
                 (u_sa2, jsonb_build_object('sync_id', 't18-u-sa2')),
                 (u_sa3, jsonb_build_object('sync_id', 't18-u-sa3')),
                 (u_sa4, jsonb_build_object('sync_id', 't18-u-sa4')),
                 (u_c1,  jsonb_build_object('sync_id', 't18-u-Casse')),
                 (u_c2,  jsonb_build_object('sync_id', 't18-u-casse')),
                 (u_v1,  jsonb_build_object('sync_id', 't18-u-Var'))) AS x(id, meta);

  INSERT INTO public.t_auth_identity (auth_user_id, user_sync_id, last_online_login_at) VALUES
    (u_ag,  't18-u-ag',    NOW() - INTERVAL '1 minute'),
    (u_sa,  't18-u-sa',    NOW() - INTERVAL '1 minute'),
    (u_sa2, 't18-u-sa2',   NOW() - INTERVAL '1 minute'),
    (u_sa3, 't18-u-sa3',   NOW() - INTERVAL '1 minute'),
    (u_sa4, 't18-u-sa4',   NOW() - INTERVAL '1 minute'),
    (u_c1,  't18-u-Casse', NOW() - INTERVAL '2 days');   -- rattache AVANT la variante

  ev := jsonb_build_object(
    'user_id', u_ag::text,
    'authentication_method', 'token_refresh',
    'claims', jsonb_build_object(
      'iss', 'https://exemple.invalid/auth/v1', 'aud', 'authenticated',
      'exp', 1900000000, 'iat', 1899996400, 'sub', u_ag::text,
      'email', 't18@users.gest-in-situ.invalid', 'phone', '',
      'app_metadata', '{}'::jsonb, 'user_metadata', '{}'::jsonb,
      'role', 'authenticated', 'aal', 'aal1',
      'session_id', gen_random_uuid()::text, 'is_anonymous', false));

  -- ---------- 1. N-1 : SUPER ADMIN principal -> claim, dispense, verifie en base ----------
  r := public.custom_access_token_hook(jsonb_set(ev, '{user_id}', to_jsonb(u_sa::text)));
  c := r -> 'claims';
  PERFORM set_config('request.jwt.claims', c::text, true);
  INSERT INTO _t VALUES (1, 'N-1 : SUPER ADMIN PRINCIPAL (site suspendu) -> jeton emis (dispense), gis_is_super_admin true, fn_jwt_is_super_admin et fn_sa_guard_caller_sa_auth true',
    NOT (r ? 'error') AND c -> 'gis_is_super_admin' = 'true'::jsonb
      AND public.fn_jwt_is_super_admin() AND public.fn_sa_guard_caller_sa_auth(),
    r::text);
  PERFORM set_config('request.jwt.claims', '', true);

  -- ---------- 2. N-1 : SUPER ADMIN seulement secondaire -> aucun privilege SA ----------
  r := public.custom_access_token_hook(jsonb_set(ev, '{user_id}', to_jsonb(u_sa2::text)));
  c := r -> 'claims';
  PERFORM set_config('request.jwt.claims', c::text, true);
  INSERT INTO _t VALUES (2, 'N-1 : SUPER ADMIN SECONDAIRE (principal ADMINISTRATEUR_SITE, site actif) -> jeton emis, gis_is_super_admin false, gis_roles reel (contient SUPER ADMIN), fn_jwt_is_super_admin et fn_sa_guard_caller_sa_auth false',
    NOT (r ? 'error') AND c -> 'gis_is_super_admin' = 'false'::jsonb
      AND c -> 'gis_roles' @> '["SUPER ADMIN", "ADMINISTRATEUR_SITE"]'::jsonb
      AND c ->> 'gis_primary_role' = 'ADMINISTRATEUR_SITE'
      AND NOT public.fn_jwt_is_super_admin() AND NOT public.fn_sa_guard_caller_sa_auth(),
    (c -> 'gis_roles')::text);

  -- Ecriture reelle sous le role authenticated avec ces claims : 0016 -> REFUS (42501).
  m := NULL;
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    BEGIN
      UPDATE public.t_users SET nom_user = 'pirate' WHERE sync_id = 't18-u-op';
      m := 'accepte';
    EXCEPTION WHEN others THEN m := SQLSTATE || ':' || left(SQLERRM, 4);
    END;
    EXECUTE 'RESET ROLE';
  EXCEPTION WHEN others THEN
    EXECUTE 'RESET ROLE';
    m := 'erreur ' || SQLSTATE;
  END;
  PERFORM set_config('request.jwt.claims', '', true);
  INSERT INTO _t VALUES (3, 'N-1 : jeton du SUPER ADMIN secondaire, ecriture t_users en authenticated -> refusee 42501 (0016 : REFUS), ligne intacte',
    m = '42501:0016' AND (SELECT nom_user FROM public.t_users WHERE sync_id = 't18-u-op') IS DISTINCT FROM 'pirate',
    m);

  -- Pas de dispense site / licence.
  r := public.custom_access_token_hook(jsonb_set(ev, '{user_id}', to_jsonb(u_sa3::text)));
  b := (r -> 'error' ->> 'http_code')::int = 403 AND r -> 'error' ->> 'message' LIKE '%sans site%';
  r := public.custom_access_token_hook(jsonb_set(ev, '{user_id}', to_jsonb(u_sa4::text)));
  INSERT INTO _t VALUES (4, 'N-1 : SUPER ADMIN secondaire sans site -> 403 sans site ; d''un site suspendu -> 403 suspendu (plus de dispense)',
    b AND (r -> 'error' ->> 'http_code')::int = 403 AND r -> 'error' ->> 'message' LIKE '%suspendu%',
    r::text);

  -- Jeton forge (ou emis avant 0018) declarant SA pour un SA secondaire : non verifie (0015 alignee).
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role','authenticated','aud','authenticated',
    'gis_v',1,'gis_sync_id','t18-u-sa2','gis_site_id',v_sa,'gis_roles',jsonb_build_array('ADMINISTRATEUR_SITE','SUPER ADMIN'),
    'gis_is_super_admin',true,'gis_statut_actif',true)::text, true);
  b := NOT public.fn_sa_guard_caller_sa_auth();
  m := NULL;
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    BEGIN
      UPDATE public.t_users SET nom_user = 'pirate' WHERE sync_id = 't18-u-op';
      m := 'accepte';
    EXCEPTION WHEN others THEN m := SQLSTATE || ':' || left(SQLERRM, 4);
    END;
    EXECUTE 'RESET ROLE';
  EXCEPTION WHEN others THEN
    EXECUTE 'RESET ROLE';
    m := 'erreur ' || SQLSTATE;
  END;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role','authenticated','aud','authenticated',
    'gis_v',1,'gis_sync_id','t18-u-sa','gis_site_id',v_susp,'gis_roles',jsonb_build_array('SUPER ADMIN'),
    'gis_is_super_admin',true,'gis_statut_actif',true)::text, true);
  INSERT INTO _t VALUES (5, 'N-1 : claims SA (gis_is_super_admin true) pour un SA SECONDAIRE -> fn_sa_guard_caller_sa_auth false et ecriture refusee 42501 ; meme claims pour le SA PRINCIPAL -> true',
    b AND m = '42501:0016' AND public.fn_sa_guard_caller_sa_auth(), m);
  PERFORM set_config('request.jwt.claims', '', true);

  -- ---------- 6. anon inchange (0007 non modifie) ----------
  m := NULL;
  BEGIN
    PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
    EXECUTE 'SET LOCAL ROLE anon';
    INSERT INTO public.t_user_roles (user_sync_id, role) VALUES ('t18-u-ag', 'OPERATEUR_QUALITE');
    DELETE FROM public.t_user_roles WHERE user_sync_id = 't18-u-ag' AND role = 'OPERATEUR_QUALITE';
    INSERT INTO public.t_user_roles (user_sync_id, role) VALUES ('t18-u-ag', 'SUPER ADMIN');  -- ignore (0007)
    UPDATE public.t_users SET role = 'OPERATEUR_SAISIE' WHERE sync_id = 't18-u-sa';           -- neutralise (0007)
    EXECUTE 'RESET ROLE';
    m := 'ok';
  EXCEPTION WHEN others THEN
    EXECUTE 'RESET ROLE';
    m := 'erreur ' || SQLSTATE;
  END;
  PERFORM set_config('request.jwt.claims', '', true);
  INSERT INTO _t VALUES (6, 'anon reel inchange : roles legitimes ecrits ; SUPER ADMIN vers non-SA ignore et retrogradation d''un SA neutralisee (0007)',
    m = 'ok'
      AND NOT EXISTS (SELECT 1 FROM public.t_user_roles WHERE user_sync_id = 't18-u-ag')
      AND (SELECT role FROM public.t_users WHERE sync_id = 't18-u-sa') = 'SUPER ADMIN',
    m);

  -- ---------- 7. N-3 : collision de casse seulement au premier rattachement ----------
  -- t18-u-Casse est rattache ; la variante t18-u-casse est creee APRES.
  b := public.fn_auth_identity_upsert(u_c1, 't18-u-Casse');                       -- avant la variante
  INSERT INTO public.t_users (login, password_hash, role, statut_actif, site_id, sync_id)
  VALUES ('t18_c2', 'x', 'OPERATEUR_SAISIE', 1, v_sa, 't18-u-casse');
  b := b AND public.fn_auth_identity_upsert(u_c1, 't18-u-Casse');                 -- deja rattache : OK
  b := b AND (SELECT last_online_login_at FROM public.t_auth_identity WHERE auth_user_id = u_c1) = NOW();
  b := b AND NOT public.fn_auth_identity_upsert(u_c2, 't18-u-casse');             -- variante : premier rattachement refuse
  b := b AND NOT public.fn_auth_identity_upsert(u_c1, 't18-u-casse');             -- variante sur le compte Auth de l'autre : refuse
  b := b AND NOT public.fn_auth_identity_upsert(u_v1, 't18-u-Var');               -- premier rattachement avec variante existante : refuse
  b := b AND NOT EXISTS (SELECT 1 FROM public.t_auth_identity WHERE auth_user_id IN (u_c2, u_v1));
  b := b AND (SELECT count(*) FROM public.t_auth_identity WHERE lower(user_sync_id) = 't18-u-casse') = 1;
  -- Le hook laisse passer la personne deja rattachee.
  r := public.custom_access_token_hook(jsonb_set(ev, '{user_id}', to_jsonb(u_c1::text)));
  INSERT INTO _t VALUES (7, 'N-3 : personne deja rattachee -> upsert accepte malgre une variante de casse creee apres, hook OK ; variante (premier rattachement) et compte jamais rattache avec variante -> refuses, aucun partage',
    b AND NOT (r ? 'error') AND r -> 'claims' ->> 'gis_sync_id' = 't18-u-Casse', NULL);

  -- ---------- 8. Hook : agent ordinaire, forme des claims inchangee ----------
  r := public.custom_access_token_hook(ev);
  c := r -> 'claims';
  INSERT INTO _t VALUES (8, 'Hook : agent ordinaire -> memes 11 claims gis_* qu''en 0017, gis_is_super_admin false, site / sync_id corrects',
    NOT (r ? 'error')
      AND (SELECT count(*) FROM jsonb_object_keys(c) k WHERE k LIKE 'gis\_%') = 11
      AND c -> 'gis_is_super_admin' = 'false'::jsonb AND (c ->> 'gis_site_id')::bigint = v_sa
      AND c ->> 'gis_site_sync_id' = 't18-site-a' AND c ->> 'gis_sync_id' = 't18-u-ag',
    NULL);

  -- ---------- 9. N-9 : types de colonnes differents (annules avec la transaction) ----------
  m := 'ok';
  BEGIN
    ALTER TABLE public.t_sites ALTER COLUMN is_active DROP DEFAULT;
    ALTER TABLE public.t_sites ALTER COLUMN is_active TYPE BOOLEAN USING (is_active <> 0);
    ALTER TABLE public.t_sites ALTER COLUMN is_permanent DROP DEFAULT;
    ALTER TABLE public.t_sites ALTER COLUMN is_permanent TYPE INTEGER USING (CASE WHEN is_permanent THEN 1 ELSE 0 END);
    ALTER TABLE public.t_sites ALTER COLUMN expiry_date TYPE TEXT USING (expiry_date::text);
  EXCEPTION WHEN others THEN
    m := 'ALTER impossible : ' || SQLSTATE || ' ' || SQLERRM;
  END;
  IF m = 'ok' THEN
    b := true;
    r := public.custom_access_token_hook(ev);                                       -- is_active boolean true
    b := b AND NOT (r ? 'error');
    UPDATE public.t_sites SET is_active = false WHERE id = v_sa;
    r := public.custom_access_token_hook(ev);
    b := b AND r -> 'error' ->> 'message' LIKE '%suspendu%';
    UPDATE public.t_sites SET is_active = true, is_permanent = 0,
           expiry_date = to_char((NOW() AT TIME ZONE 'UTC')::date - 2, 'YYYY-MM-DD') WHERE id = v_sa;
    r := public.custom_access_token_hook(ev);                                       -- date texte passee
    b := b AND r -> 'error' ->> 'message' LIKE '%licence%';
    UPDATE public.t_sites SET is_permanent = 1 WHERE id = v_sa;                     -- permanent (entier)
    r := public.custom_access_token_hook(ev);
    b := b AND NOT (r ? 'error');
    UPDATE public.t_sites SET is_permanent = 0, expiry_date = 'illisible' WHERE id = v_sa;
    r := public.custom_access_token_hook(ev);                                       -- illisible : pas de blocage (A1)
    b := b AND NOT (r ? 'error');
    UPDATE public.t_sites SET expiry_date = to_char((NOW() AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') WHERE id = v_sa;
    r := public.custom_access_token_hook(ev);                                       -- echeance aujourd'hui : dernier jour utilisable
    b := b AND NOT (r ? 'error');
    m := 'ok';
  ELSE
    b := false;
  END IF;
  INSERT INTO _t VALUES (9, 'N-9 : is_active BOOLEAN, is_permanent INTEGER, expiry_date TEXT -> hook sans erreur interne : actif / suspendu / licence expiree / permanent / date illisible (pas de blocage) / echeance du jour',
    b, m);

  -- ---------- 10-12. N-2 : saturation ----------
  -- Table pleine de lignes non bloquees dont le dernier echec date de 2 h.
  INSERT INTO public.t_login_attempts (login_key, nb_echecs, nb_blocages, premier_echec_at, dernier_echec_at, updated_at)
  SELECT encode(sha256(convert_to('t18-vieux-' || g, 'UTF8')), 'hex'), 1, 0,
         NOW() - INTERVAL '2 hours', NOW() - INTERVAL '2 hours', NOW() - INTERVAL '2 hours'
    FROM generate_series(1, 100000) g
  ON CONFLICT DO NOTHING;
  -- Plus 10 lignes BLOQUEES vieilles de 2 h (blocage en cours : jamais purgees).
  UPDATE public.t_login_attempts SET bloque_jusqu_a = NOW() + INTERVAL '1 hour', nb_blocages = 1
   WHERE login_key IN (SELECT encode(sha256(convert_to('t18-vieux-' || g, 'UTF8')), 'hex') FROM generate_series(1, 10) g);
  SELECT count(*) INTO n FROM public.t_login_attempts;
  r := public.fn_login_check_and_record('t18_legitime', 'reserve');
  b := (r ->> 'allowed')::boolean AND (r ->> 'saturation')::boolean AND NOT (r ? 'error');
  b := b AND EXISTS (SELECT 1 FROM public.t_login_attempts WHERE login_key = public.fn_login_key('t18_legitime'));
  b := b AND (SELECT count(*) FROM public.t_login_attempts WHERE bloque_jusqu_a > NOW()) = 10;
  b := b AND (SELECT count(*) FROM public.t_login_attempts) = 11;
  r := public.fn_login_check_and_record('t18_legitime', 'success');
  b := b AND NOT EXISTS (SELECT 1 FROM public.t_login_attempts WHERE login_key = public.fn_login_key('t18_legitime'));
  INSERT INTO _t VALUES (10, 'N-2 : table pleine de lignes > 1 h -> purge, l''utilisateur legitime passe (allowed, saturation true) ; lignes bloquees conservees ; success efface sa ligne',
    b, n::text || ' lignes avant');

  -- Table pleine de lignes RECENTES (< 1 h) : echec ferme en dernier recours.
  INSERT INTO public.t_login_attempts (login_key, nb_echecs, nb_blocages, premier_echec_at, dernier_echec_at, updated_at)
  SELECT encode(sha256(convert_to('t18-recent-' || g, 'UTF8')), 'hex'), 1, 0,
         NOW() - INTERVAL '30 minutes', NOW() - INTERVAL '30 minutes', NOW() - INTERVAL '30 minutes'
    FROM generate_series(1, 100000) g
  ON CONFLICT DO NOTHING;
  SELECT count(*) INTO n FROM public.t_login_attempts;
  r := public.fn_login_check_and_record('t18_nouveau', 'reserve');
  b := NOT (r ->> 'allowed')::boolean AND (r ->> 'error')::boolean AND (r ->> 'full')::boolean;
  b := b AND NOT EXISTS (SELECT 1 FROM public.t_login_attempts WHERE login_key = public.fn_login_key('t18_nouveau'));
  b := b AND (SELECT count(*) FROM public.t_login_attempts) = n;
  -- Un login connu et un login inconnu recoivent la meme reponse.
  b := b AND public.fn_login_check_and_record('t18_ag', 'reserve') = public.fn_login_check_and_record('t18_inconnu_xyz', 'reserve');
  -- Une ligne existante continue d'etre comptee.
  r := public.fn_login_check_and_record('t18-recent-1', 'reserve');
  INSERT INTO _t VALUES (11, 'N-2 : table pleine de lignes < 1 h -> echec FERME (allowed false, error, full), rien purge ni cree ; login connu / inconnu : reponse identique ; ligne existante toujours comptee',
    b AND (r ->> 'allowed')::boolean AND NOT (r ? 'error'), n::text || ' lignes');

  -- Hors saturation : reponses de 0017 inchangees (saturation false), seuil 5.
  DELETE FROM public.t_login_attempts WHERE login_key IN
    (SELECT encode(sha256(convert_to('t18-recent-' || g, 'UTF8')), 'hex') FROM generate_series(1, 100000) g);
  b := true;
  FOR i IN 1..4 LOOP
    r := public.fn_login_check_and_record('t18_seuil', 'reserve');
    b := b AND (r ->> 'allowed')::boolean AND NOT (r ->> 'lock_on_failure')::boolean AND NOT (r ->> 'saturation')::boolean;
  END LOOP;
  r := public.fn_login_check_and_record('t18_seuil', 'reserve');
  b := b AND (r ->> 'lock_on_failure')::boolean AND (r ->> 'retry_on_failure_s')::int = 900;
  r := public.fn_login_check_and_record('t18_seuil', 'reserve');
  INSERT INTO _t VALUES (12, 'N-2 : hors saturation, comportement 0017 inchange (4 reserves, 5e avec blocage 900 s, 6e refusee)',
    b AND NOT (r ->> 'allowed')::boolean AND (r ->> 'retry_after_s')::int = 900, r::text);

  -- ---------- 13. Empreinte anon identique ----------
  SELECT md5(string_agg(x, '|' ORDER BY x)) || '/' || count(*) INTO v_empr_apres FROM (
   SELECT 'pol:'||tablename||':'||policyname||':'||permissive||':'||cmd||':'||array_to_string(roles,',')||':'||coalesce(qual,'')||':'||coalesce(with_check,'') x
     FROM pg_policies WHERE schemaname='public' AND ('anon'=ANY(roles) OR 'public'=ANY(roles))
   UNION ALL
   SELECT 'priv:'||c.relname||':'||pr FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) pr
    WHERE n.nspname='public' AND c.relkind='r' AND has_table_privilege('anon',c.oid,pr)
   UNION ALL
   SELECT 'col:'||attrelid::regclass||':'||attname FROM pg_attribute
    WHERE attrelid IN (SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r')
      AND attnum>0 AND NOT attisdropped AND has_column_privilege('anon',attrelid,attnum,'SELECT')
   UNION ALL
   SELECT 'fn:'||p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND has_function_privilege('anon',p.oid,'EXECUTE')) s;
  INSERT INTO _t VALUES (13, 'Empreinte anon (README section 0013) identique avant / apres les cas',
    v_empr_avant = v_empr_apres, v_empr_apres);

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
    RAISE EXCEPTION 'TEST 0018 ECHEC : cas en erreur : %', v_ko;
  END IF;
  RAISE NOTICE 'TEST 0018 OK (% cas)', (SELECT count(*) FROM _t);
END;
$$;

ROLLBACK;
