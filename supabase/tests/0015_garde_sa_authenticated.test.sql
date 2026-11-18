-- ============================================================
-- Test de supabase/migrations/0015_garde_sa_authenticated.sql
-- A executer sur le projet DEV uniquement (ajadkziqaskadlzboeqo), apres
-- 0007, 0011, 0013, 0014 et 0015, dans le SQL Editor (role postgres).
-- Transaction ANNULEE (ROLLBACK final) : aucune ligne ne reste (sites,
-- comptes, roles 't15*', journal 0007, compteurs 0008, fonctions d'aide
-- public._t15_*).
--
-- Methode : vrais changements de role (SET LOCAL ROLE authenticated / anon,
-- comme PostgREST) + claims simulees dans request.jwt.claims. La RLS
-- (0013 / 0014), les privileges et les triggers (0007 / 0015) sont donc
-- reellement appliques.
-- Profils : anon (cle publishable et sans claims), authenticated SANS claims
-- gis_*, claims forgees sans gis_v, operateur du site A, ADMINISTRATEUR_SITE
-- du site A, ADMINISTRATEUR_SITE du site B, SUPER ADMIN authentifie
-- (verifie), jeton SUPER ADMIN perime (compte desactive en base), jeton
-- SUPER ADMIN d'un compte qui n'est plus SUPER ADMIN en base, claims SA avec
-- gis_statut_actif = false, postgres sans claims.
-- Les comptages ne portent que sur les lignes de test (sync_id 't15-%').
-- Resultat : table _t, puis un bloc qui LEVE UNE ERREUR si un cas vaut false.
-- NE JAMAIS EXECUTER EN PROD.
-- ============================================================
BEGIN;

CREATE TEMP TABLE _t (n INT, cas TEXT, ok BOOLEAN, detail TEXT) ON COMMIT DROP;

CREATE FUNCTION public._t15_try(p_sql TEXT) RETURNS TEXT
LANGUAGE plpgsql AS $f$
DECLARE
  v_n BIGINT;
BEGIN
  EXECUTE p_sql;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN 'ok:' || v_n;
EXCEPTION WHEN others THEN
  RETURN 'err:' || SQLSTATE || ':' ||
         CASE WHEN SQLERRM ILIKE '%row-level security%' THEN 'rls'
              WHEN SQLERRM ILIKE '%permission denied%'   THEN 'priv'
              ELSE left(SQLERRM, 80) END;
END;
$f$;

DO $$
DECLARE
  v_sa BIGINT; v_sb BIGINT;
  v_ev0 BIGINT; v_ev1 BIGINT;
  c_op_a TEXT; c_adm_a TEXT; c_adm_b TEXT; c_sa TEXT; c_sa_perime TEXT; c_sa_retro TEXT; c_sa_inactif TEXT;
  c_nog TEXT := '{"role":"authenticated","aud":"authenticated","sub":"00000000-0000-0000-0000-000000000015"}';
  c_forge TEXT;
  r1 TEXT; r2 TEXT; r3 TEXT; r4 TEXT; r5 TEXT; r6 TEXT;
  b BOOLEAN;
  t TEXT;
  i INT;
BEGIN
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  SELECT COALESCE(max(id), 0) INTO v_ev0 FROM public.t_security_guard_events;

  -- ---------- 0. Structure ----------
  INSERT INTO _t VALUES (0, '0015 en place : 3 triggers auth actifs sur t_users (avant ceux de 0007), 5 triggers 0007 actifs, garde actif, fonctions fermees a PUBLIC/anon/authenticated',
    (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.t_users'::regclass AND NOT tgisinternal
        AND tgname IN ('trg_t_users_sa_guard_auth_ins','trg_t_users_sa_guard_auth_upd','trg_t_users_sa_guard_auth_del')
        AND tgenabled = 'O') = 3
      AND (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgenabled = 'O'
        AND tgname IN ('trg_t_users_sa_guard_ins','trg_t_users_sa_guard_upd','trg_t_users_sa_guard_del',
                       'trg_t_user_roles_sa_guard_ins','trg_t_user_roles_sa_guard_upd')) = 5
      AND 'trg_t_users_sa_guard_auth_upd' < 'trg_t_users_sa_guard_upd'
      AND (SELECT enabled FROM public.t_security_guard_config WHERE id = 1)
      AND NOT has_function_privilege('anon', 'public.fn_sa_guard_caller_sa_auth()', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'public.fn_sa_guard_caller_sa_auth()', 'EXECUTE')
      AND NOT has_function_privilege('anon', 'public.fn_t_users_sa_guard_auth()', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'public.fn_t_users_sa_guard_auth()', 'EXECUTE')
      AND NOT has_function_privilege('anon', 'public.fn_sa_guard_caller_untrusted()', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'public.fn_sa_guard_caller_untrusted()', 'EXECUTE')
      AND (SELECT prosecdef FROM pg_proc WHERE oid = 'public.fn_t_users_sa_guard_auth()'::regprocedure),
    NULL);

  -- ---------- Jeu de test (postgres, sans JWT : appelant fiable) ----------
  INSERT INTO public.t_sites (nom, code, sync_id) VALUES ('T15 SITE A', 'T15A', 't15-site-a') RETURNING id INTO v_sa;
  INSERT INTO public.t_sites (nom, code, sync_id) VALUES ('T15 SITE B', 'T15B', 't15-site-b') RETURNING id INTO v_sb;
  INSERT INTO public.t_users (login, password_hash, role, statut_actif, site_id, sync_id) VALUES
    ('t15_op_a',      'x-t15-h-op-a',  'OPERATEUR_VERIFICATION', 1, v_sa, 't15-u-a'),
    ('t15_op_b',      'x-t15-h-op-b',  'OPERATEUR_VERIFICATION', 1, v_sb, 't15-u-b'),
    ('t15_op_c',      'x-t15-h-op-c',  'OPERATEUR_SAISIE',       1, v_sa, 't15-u-c'),
    ('t15_adm_a',     'x-t15-h-adm-a', 'ADMINISTRATEUR_SITE',    1, v_sa, 't15-adm-a'),
    ('t15_adm_b',     'x-t15-h-adm-b', 'ADMINISTRATEUR_SITE',    1, v_sb, 't15-adm-b'),
    ('t15_sa1',       'x-t15-h-sa1',   'SUPER ADMIN',            1, NULL, 't15-sa1'),
    ('t15_sa2',       'x-t15-h-sa2',   'SUPER ADMIN',            1, NULL, 't15-sa2'),
    ('t15_sa_site_a', 'x-t15-h-sasa',  'SUPER ADMIN',            1, v_sa, 't15-sa-site-a'),
    ('t15_sa_dormant','x-t15-h-sad',   'SUPER ADMIN',            0, NULL, 't15-sa-dormant');
  -- Postgres sans claims = fiable : SA actif cree tel quel (0007 et 0015 inactifs).
  INSERT INTO _t VALUES (1, 'postgres sans claims (SQL Editor) : SUPER ADMIN crees actifs, aucun journal (fiable, inchange)',
    (SELECT count(*) FROM public.t_users WHERE sync_id IN ('t15-sa1','t15-sa2','t15-sa-site-a') AND statut_actif = 1) = 3
      AND NOT EXISTS (SELECT 1 FROM public.t_security_guard_events WHERE id > v_ev0),
    NULL);

  c_op_a := jsonb_build_object('role','authenticated','aud','authenticated','sub','00000000-0000-0000-0000-00000000015a',
           'gis_v',1,'gis_sync_id','t15-u-a','gis_site_id',v_sa,'gis_roles',jsonb_build_array('OPERATEUR_VERIFICATION'),
           'gis_is_super_admin',false,'gis_statut_actif',true)::text;
  c_adm_a := jsonb_build_object('role','authenticated','aud','authenticated','sub','00000000-0000-0000-0000-0000000015ad',
           'gis_v',1,'gis_sync_id','t15-adm-a','gis_site_id',v_sa,'gis_roles',jsonb_build_array('ADMINISTRATEUR_SITE'),
           'gis_is_super_admin',false,'gis_statut_actif',true)::text;
  c_adm_b := jsonb_build_object('role','authenticated','aud','authenticated','sub','00000000-0000-0000-0000-0000000015bd',
           'gis_v',1,'gis_sync_id','t15-adm-b','gis_site_id',v_sb,'gis_roles',jsonb_build_array('ADMINISTRATEUR_SITE'),
           'gis_is_super_admin',false,'gis_statut_actif',true)::text;
  c_sa := jsonb_build_object('role','authenticated','aud','authenticated','sub','00000000-0000-0000-0000-0000000015ff',
           'gis_v',1,'gis_sync_id','t15-sa1','gis_site_id',NULL,'gis_roles',jsonb_build_array('SUPER ADMIN'),
           'gis_is_super_admin',true,'gis_statut_actif',true)::text;
  c_sa_perime := jsonb_build_object('role','authenticated','aud','authenticated','sub','00000000-0000-0000-0000-0000000015fe',
           'gis_v',1,'gis_sync_id','t15-sa-dormant','gis_site_id',NULL,'gis_roles',jsonb_build_array('SUPER ADMIN'),
           'gis_is_super_admin',true,'gis_statut_actif',true)::text;
  -- Jeton SA d'un compte qui n'est pas (plus) SUPER ADMIN en base (retrograde).
  c_sa_retro := jsonb_build_object('role','authenticated','aud','authenticated','sub','00000000-0000-0000-0000-0000000015fd',
           'gis_v',1,'gis_sync_id','t15-u-a','gis_site_id',v_sa,'gis_roles',jsonb_build_array('SUPER ADMIN'),
           'gis_is_super_admin',true,'gis_statut_actif',true)::text;
  c_sa_inactif := jsonb_build_object('role','authenticated','aud','authenticated','sub','00000000-0000-0000-0000-0000000015fc',
           'gis_v',1,'gis_sync_id','t15-sa1','gis_site_id',NULL,'gis_roles',jsonb_build_array('SUPER ADMIN'),
           'gis_is_super_admin',true,'gis_statut_actif',false)::text;
  c_forge := jsonb_build_object('role','authenticated','gis_sync_id','t15-sa1','gis_is_super_admin',true,
           'gis_statut_actif',true)::text;

  -- =====================================================================
  -- 2-3. anon : INCHANGE (cle publishable, puis forme de claims d'une cle
  --      legacy). « anon sans claims » n'est pas simulable ici : 0007 le
  --      juge non fiable par session_user = 'authenticator' (PostgREST), or
  --      ce test tourne en session postgres.
  -- =====================================================================
  i := 0;
  FOREACH t IN ARRAY ARRAY['{"role":"anon"}', '{"iss":"supabase","ref":"t15","role":"anon","iat":1,"exp":2}'] LOOP
    i := i + 1;
    SELECT COALESCE(max(id), 0) INTO v_ev1 FROM public.t_security_guard_events;
    PERFORM set_config('request.jwt.claims', t, true);
    EXECUTE 'SET LOCAL ROLE anon';
    r1 := public._t15_try(format('INSERT INTO public.t_users (login, password_hash, role, statut_actif, site_id, sync_id) VALUES (%L, %L, %L, 1, NULL, %L)',
            't15_anon_sa' || i, 'x-t15-h-anon', 'SUPER ADMIN', 't15-anon-sa' || i));
    r2 := public._t15_try($q$UPDATE public.t_users SET role = 'SUPER ADMIN' WHERE sync_id = 't15-u-a'$q$);
    r3 := public._t15_try($q$UPDATE public.t_users SET password_hash = 'x-t15-pirate', login = 't15_pirate' WHERE sync_id = 't15-sa2'$q$);
    r4 := public._t15_try($q$DELETE FROM public.t_users WHERE sync_id = 't15-sa2'$q$);
    r5 := public._t15_try($q$INSERT INTO public.t_user_roles (user_sync_id, role) VALUES ('t15-u-b', 'SUPER ADMIN')$q$);
    EXECUTE 'RESET ROLE';
    INSERT INTO _t VALUES (1 + i, 'anon (' || CASE WHEN i = 1 THEN 'cle publishable' ELSE 'claims de cle legacy' END
        || ') INCHANGE : SA cree en quarantaine, elevation annulee, hash/login d''un SA repris, suppression SA ignoree, role SA refuse ; aucune erreur',
      (SELECT statut_actif FROM public.t_users WHERE sync_id = 't15-anon-sa' || i) = 0
        AND (SELECT role FROM public.t_users WHERE sync_id = 't15-u-a') = 'OPERATEUR_VERIFICATION'
        AND (SELECT password_hash || '|' || login FROM public.t_users WHERE sync_id = 't15-sa2') = 'x-t15-h-sa2|t15_sa2'
        AND NOT EXISTS (SELECT 1 FROM public.t_user_roles WHERE user_sync_id = 't15-u-b' AND role = 'SUPER ADMIN')
        AND r1 = 'ok:1' AND r2 = 'ok:1' AND r3 = 'ok:1' AND r4 = 'ok:0' AND r5 = 'ok:0'
        AND (SELECT count(*) FROM public.t_security_guard_events
              WHERE id > v_ev1 AND jwt_role = 'anon'
                AND reason IN ('SA_INSERT_QUARANTAINE','SA_ELEVATION_BLOQUEE','SA_DELETE_IGNORE','ROLES_SA_REFUSE')
                AND (sync_id LIKE 't15-%')) >= 4
        AND NOT EXISTS (SELECT 1 FROM public.t_security_guard_events WHERE id > v_ev0 AND reason LIKE 'SA\_AUTH\_%'),
      concat_ws(' ', r1, r2, r3, r4, r5));
  END LOOP;

  -- =====================================================================
  -- 4. authenticated SANS claims gis_* / claims forgees sans gis_v / SA
  --    avec gis_statut_actif = false : non fiables (RLS : rien ; garde : rien)
  -- =====================================================================
  r6 := '';
  FOREACH t IN ARRAY ARRAY[c_nog, c_forge, c_sa_inactif] LOOP
    PERFORM set_config('request.jwt.claims', t, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    r1 := public._t15_try($q$UPDATE public.t_users SET role = 'SUPER ADMIN' WHERE sync_id = 't15-u-a'$q$);
    r2 := public._t15_try($q$INSERT INTO public.t_users (login, password_hash, role, statut_actif, site_id, sync_id) VALUES ('t15_x', 'x', 'SUPER ADMIN', 1, NULL, 't15-x-nog')$q$);
    EXECUTE 'RESET ROLE';
    r6 := concat_ws(' ', NULLIF(r6, ''), r1, r2);
  END LOOP;
  INSERT INTO _t VALUES (4, 'authenticated sans claims gis_* / claims forgees sans gis_v / claims SA avec gis_statut_actif=false : elevation 0 ligne ou annulee, creation SA refusee ou en quarantaine (jamais un SA actif)',
    (SELECT role FROM public.t_users WHERE sync_id = 't15-u-a') = 'OPERATEUR_VERIFICATION'
      AND NOT EXISTS (SELECT 1 FROM public.t_users WHERE sync_id = 't15-x-nog' AND statut_actif = 1)
      AND NOT EXISTS (SELECT 1 FROM public.t_security_guard_events WHERE id > v_ev0 AND reason LIKE 'SA\_AUTH\_%'),
    r6);

  -- =====================================================================
  -- 5. Operateur du site A : rien sur un SUPER ADMIN
  -- =====================================================================
  PERFORM set_config('request.jwt.claims', c_op_a, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  r1 := public._t15_try($q$UPDATE public.t_users SET role = 'SUPER ADMIN' WHERE sync_id = 't15-u-a'$q$);
  r2 := public._t15_try($q$INSERT INTO public.t_user_roles (user_sync_id, role) VALUES ('t15-u-a', 'SUPER ADMIN')$q$);
  r3 := public._t15_try(format('INSERT INTO public.t_users (login, password_hash, role, statut_actif, site_id, sync_id) VALUES (%L, %L, %L, 1, %s, %L)', 't15_op_sa', 'x', 'SUPER ADMIN', v_sa, 't15-op-sa'));
  r4 := public._t15_try($q$UPDATE public.t_users SET password_hash = 'x-t15-pirate', statut_actif = 0 WHERE sync_id IN ('t15-sa1', 't15-sa-site-a')$q$);
  r5 := public._t15_try($q$DELETE FROM public.t_users WHERE sync_id IN ('t15-sa1', 't15-sa-site-a')$q$);
  EXECUTE 'RESET ROLE';
  INSERT INTO _t VALUES (5, 'Operateur A : s''elever (role principal ou secondaire) annule / refuse, SA cree sur son site en quarantaine, SA de son site : hash repris (baisse de statut permise par 0007 R3), SA sans site invisible et intact, suppression SA ignoree',
    (SELECT role FROM public.t_users WHERE sync_id = 't15-u-a') = 'OPERATEUR_VERIFICATION'
      AND NOT EXISTS (SELECT 1 FROM public.t_user_roles WHERE user_sync_id = 't15-u-a' AND role = 'SUPER ADMIN')
      AND (SELECT statut_actif FROM public.t_users WHERE sync_id = 't15-op-sa') = 0
      AND (SELECT password_hash FROM public.t_users WHERE sync_id = 't15-sa-site-a') = 'x-t15-h-sasa'
      AND (SELECT password_hash || '|' || statut_actif FROM public.t_users WHERE sync_id = 't15-sa1') = 'x-t15-h-sa1|1'
      AND EXISTS (SELECT 1 FROM public.t_users WHERE sync_id = 't15-sa-site-a')
      AND r1 = 'ok:1' AND r2 = 'ok:0' AND r3 = 'ok:1' AND r4 = 'ok:1' AND r5 = 'ok:0',
    concat_ws(' ', r1, r2, r3, r4, r5));
  -- Remise en etat du statut de t15-sa-site-a (la baisse de statut est permise par 0007 R3).
  UPDATE public.t_users SET statut_actif = 1 WHERE sync_id = 't15-sa-site-a';

  -- =====================================================================
  -- 6. ADMINISTRATEUR_SITE du site A : comptes de son site seulement,
  --    jamais creer / promouvoir un SUPER ADMIN
  -- =====================================================================
  PERFORM set_config('request.jwt.claims', c_adm_a, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  r1 := public._t15_try(format('INSERT INTO public.t_users (login, password_hash, role, statut_actif, site_id, sync_id) VALUES (%L, %L, %L, 1, %s, %L)', 't15_adm_sa', 'x', 'SUPER ADMIN', v_sa, 't15-adm-sa'));
  r2 := public._t15_try($q$UPDATE public.t_users SET role = 'SUPER ADMIN' WHERE sync_id = 't15-u-c'$q$);
  r3 := public._t15_try($q$INSERT INTO public.t_user_roles (user_sync_id, role) VALUES ('t15-u-c', 'SUPER ADMIN')$q$);
  r4 := public._t15_try($q$UPDATE public.t_users SET password_hash = 'x-t15-pirate', login = 't15_pirate2', nom_user = 'T15 MODIF' WHERE sync_id = 't15-sa-site-a'$q$);
  r5 := public._t15_try($q$DELETE FROM public.t_users WHERE sync_id = 't15-sa-site-a'$q$);
  r6 := public._t15_try($q$UPDATE public.t_users SET nom_user = 'T15 ADM A' WHERE sync_id IN ('t15-u-c', 't15-u-b', 't15-sa1')$q$);
  EXECUTE 'RESET ROLE';
  INSERT INTO _t VALUES (6, 'ADMINISTRATEUR_SITE A : SA cree en quarantaine, promotion SA annulee, role SA refuse ; SA de son site : hash et login repris (autres colonnes passent), suppression ignoree ; modifie un compte de son site seulement (1 ligne : ni site B ni SA sans site)',
    (SELECT statut_actif FROM public.t_users WHERE sync_id = 't15-adm-sa') = 0
      AND (SELECT role FROM public.t_users WHERE sync_id = 't15-u-c') = 'OPERATEUR_SAISIE'
      AND NOT EXISTS (SELECT 1 FROM public.t_user_roles WHERE user_sync_id = 't15-u-c' AND role = 'SUPER ADMIN')
      AND (SELECT password_hash || '|' || login || '|' || nom_user FROM public.t_users WHERE sync_id = 't15-sa-site-a') = 'x-t15-h-sasa|t15_sa_site_a|T15 MODIF'
      AND EXISTS (SELECT 1 FROM public.t_users WHERE sync_id = 't15-sa-site-a')
      AND r1 = 'ok:1' AND r2 = 'ok:1' AND r3 = 'ok:0' AND r4 = 'ok:1' AND r5 = 'ok:0' AND r6 = 'ok:1'
      AND (SELECT count(*) FROM public.t_security_guard_events WHERE id > v_ev0 AND sync_id IN ('t15-adm-sa','t15-u-c','t15-sa-site-a')
             AND jwt_role = 'authenticated'
             AND (reason IN ('SA_INSERT_QUARANTAINE','SA_ELEVATION_BLOQUEE','ROLES_SA_REFUSE','SA_DELETE_IGNORE')
                  OR reason LIKE 'SA\_MODIF\_NEUTRALISEE:%')) >= 5,
    concat_ws(' ', r1, r2, r3, r4, r5, r6));

  -- =====================================================================
  -- 7. ADMINISTRATEUR_SITE du site B : rien sur les comptes du site A
  -- =====================================================================
  PERFORM set_config('request.jwt.claims', c_adm_b, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  r1 := public._t15_try($q$UPDATE public.t_users SET role = 'SUPER ADMIN', nom_user = 'PIRATE' WHERE sync_id IN ('t15-u-a', 't15-u-c', 't15-sa-site-a')$q$);
  r2 := public._t15_try(format('INSERT INTO public.t_users (login, password_hash, role, statut_actif, site_id, sync_id) VALUES (%L, %L, %L, 1, %s, %L)', 't15_admb_sa', 'x', 'SUPER ADMIN', v_sa, 't15-admb-sa'));
  r3 := public._t15_try($q$INSERT INTO public.t_user_roles (user_sync_id, role) VALUES ('t15-u-a', 'ADMIN_CENTRE')$q$);
  r4 := public._t15_try($q$DELETE FROM public.t_users WHERE sync_id IN ('t15-u-a', 't15-sa-site-a')$q$);
  EXECUTE 'RESET ROLE';
  INSERT INTO _t VALUES (7, 'ADMINISTRATEUR_SITE B : comptes du site A ni modifiables ni supprimables (0 ligne), compte cree sur le site A et role d''un compte A refuses (42501)',
    r1 = 'ok:0' AND r2 = 'err:42501:rls' AND r3 = 'err:42501:rls' AND r4 = 'ok:0'
      AND NOT EXISTS (SELECT 1 FROM public.t_users WHERE sync_id LIKE 't15-%' AND nom_user = 'PIRATE'),
    concat_ws(' ', r1, r2, r3, r4));

  -- =====================================================================
  -- 8. SUPER ADMIN authentifie verifie : creation, elevation, role SA
  -- =====================================================================
  SELECT COALESCE(max(id), 0) INTO v_ev1 FROM public.t_security_guard_events;
  PERFORM set_config('request.jwt.claims', c_sa, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  r1 := public._t15_try($q$INSERT INTO public.t_users (login, password_hash, role, statut_actif, site_id, sync_id) VALUES ('t15_sa_new', 'x-t15-h-new', 'SUPER ADMIN', 1, NULL, 't15-sa-new')$q$);
  r2 := public._t15_try($q$UPDATE public.t_users SET role = 'SUPER ADMIN' WHERE sync_id = 't15-u-c'$q$);
  r3 := public._t15_try($q$INSERT INTO public.t_user_roles (user_sync_id, role) VALUES ('t15-u-b', 'SUPER ADMIN')$q$);
  r4 := public._t15_try($q$UPDATE public.t_users SET statut_actif = 1 WHERE sync_id = 't15-adm-sa'$q$);
  EXECUTE 'RESET ROLE';
  INSERT INTO _t VALUES (8, 'SUPER ADMIN authentifie : cree un SUPER ADMIN actif, eleve un compte, ajoute le role secondaire SUPER ADMIN, reactive le SA mis en quarantaine (journal SA_AUTH_*)',
    (SELECT statut_actif FROM public.t_users WHERE sync_id = 't15-sa-new') = 1
      AND (SELECT role FROM public.t_users WHERE sync_id = 't15-u-c') = 'SUPER ADMIN'
      AND EXISTS (SELECT 1 FROM public.t_user_roles WHERE user_sync_id = 't15-u-b' AND role = 'SUPER ADMIN')
      AND (SELECT statut_actif FROM public.t_users WHERE sync_id = 't15-adm-sa') = 1
      AND r1 = 'ok:1' AND r2 = 'ok:1' AND r3 = 'ok:1' AND r4 = 'ok:1'
      AND EXISTS (SELECT 1 FROM public.t_security_guard_events WHERE id > v_ev0 AND sync_id = 't15-sa-new' AND reason = 'SA_AUTH_CREATION' AND jwt_role = 'authenticated')
      AND EXISTS (SELECT 1 FROM public.t_security_guard_events WHERE id > v_ev0 AND sync_id = 't15-u-c' AND reason = 'SA_AUTH_ELEVATION')
      AND EXISTS (SELECT 1 FROM public.t_security_guard_events WHERE id > v_ev0 AND sync_id = 't15-adm-sa' AND reason = 'SA_AUTH_MODIF:statut_actif')
      AND NOT EXISTS (SELECT 1 FROM public.t_security_guard_events WHERE id > v_ev1
                        AND reason NOT LIKE 'SA\_AUTH\_%'),
    concat_ws(' ', r1, r2, r3, r4));

  -- =====================================================================
  -- 9. SUPER ADMIN authentifie sur un AUTRE SUPER ADMIN : login / statut /
  --    retrogradation permis ; mot de passe (ROOT seulement) et sync_id repris
  -- =====================================================================
  PERFORM set_config('request.jwt.claims', c_sa, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  r1 := public._t15_try($q$UPDATE public.t_users SET login = 't15_sa2_renomme', statut_actif = 0, password_hash = 'x-t15-pirate', sync_id = 't15-sa2-x' WHERE sync_id = 't15-sa2'$q$);
  r2 := public._t15_try($q$UPDATE public.t_users SET role = 'ADMINISTRATEUR_SITE' WHERE sync_id = 't15-sa-site-a'$q$);
  EXECUTE 'RESET ROLE';
  INSERT INTO _t VALUES (9, 'SUPER ADMIN authentifie sur un autre SA : login et desactivation appliques, password_hash et sync_id repris (journal SA_AUTH_NEUTRALISE), retrogradation appliquee',
    (SELECT login || '|' || statut_actif || '|' || password_hash FROM public.t_users WHERE sync_id = 't15-sa2') = 't15_sa2_renomme|0|x-t15-h-sa2'
      AND NOT EXISTS (SELECT 1 FROM public.t_users WHERE sync_id = 't15-sa2-x')
      AND (SELECT role FROM public.t_users WHERE sync_id = 't15-sa-site-a') = 'ADMINISTRATEUR_SITE'
      AND r1 = 'ok:1' AND r2 = 'ok:1'
      AND EXISTS (SELECT 1 FROM public.t_security_guard_events WHERE id > v_ev0 AND sync_id = 't15-sa2'
                    AND reason = 'SA_AUTH_NEUTRALISE:sync_id,password_hash')
      AND EXISTS (SELECT 1 FROM public.t_security_guard_events WHERE id > v_ev0 AND sync_id = 't15-sa2'
                    AND reason = 'SA_AUTH_MODIF:statut_actif,login'),
    concat_ws(' ', r1, r2));

  -- =====================================================================
  -- 10. SUPER ADMIN authentifie sur SON compte : mot de passe permis,
  --     auto-desactivation reprise
  -- =====================================================================
  PERFORM set_config('request.jwt.claims', c_sa, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  r1 := public._t15_try($q$UPDATE public.t_users SET password_hash = 'x-t15-h-sa1-nouveau' WHERE sync_id = 't15-sa1'$q$);
  r2 := public._t15_try($q$UPDATE public.t_users SET statut_actif = 0 WHERE sync_id = 't15-sa1'$q$);
  EXECUTE 'RESET ROLE';
  INSERT INTO _t VALUES (10, 'SUPER ADMIN authentifie sur son compte : nouveau mot de passe applique, auto-desactivation reprise (statut reste 1)',
    (SELECT password_hash || '|' || statut_actif FROM public.t_users WHERE sync_id = 't15-sa1') = 'x-t15-h-sa1-nouveau|1'
      AND r1 = 'ok:1' AND r2 = 'ok:1'
      AND EXISTS (SELECT 1 FROM public.t_security_guard_events WHERE id > v_ev0 AND sync_id = 't15-sa1' AND reason = 'SA_AUTH_MODIF:password_hash')
      AND EXISTS (SELECT 1 FROM public.t_security_guard_events WHERE id > v_ev0 AND sync_id = 't15-sa1' AND reason = 'SA_AUTH_NEUTRALISE:statut_actif'),
    concat_ws(' ', r1, r2));

  -- =====================================================================
  -- 11. SUPER ADMIN authentifie : suppression d'un autre SA permise,
  --     auto-suppression ignoree
  -- =====================================================================
  PERFORM set_config('request.jwt.claims', c_sa, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  r1 := public._t15_try($q$DELETE FROM public.t_users WHERE sync_id = 't15-sa-new'$q$);
  r2 := public._t15_try($q$DELETE FROM public.t_users WHERE sync_id = 't15-sa1'$q$);
  EXECUTE 'RESET ROLE';
  INSERT INTO _t VALUES (11, 'SUPER ADMIN authentifie : supprime un autre SA (1 ligne), sa propre suppression est ignoree (0 ligne, compte present)',
    r1 = 'ok:1' AND r2 = 'ok:0'
      AND NOT EXISTS (SELECT 1 FROM public.t_users WHERE sync_id = 't15-sa-new')
      AND EXISTS (SELECT 1 FROM public.t_users WHERE sync_id = 't15-sa1' AND statut_actif = 1)
      AND EXISTS (SELECT 1 FROM public.t_security_guard_events WHERE id > v_ev0 AND sync_id = 't15-sa-new' AND reason = 'SA_AUTH_SUPPRESSION')
      AND EXISTS (SELECT 1 FROM public.t_security_guard_events WHERE id > v_ev0 AND sync_id = 't15-sa1' AND reason = 'SA_AUTH_AUTO_SUPPRESSION_IGNOREE'),
    concat_ws(' ', r1, r2));

  -- =====================================================================
  -- 12. Jeton SUPER ADMIN perime : compte desactive en base, ou plus SUPER
  --     ADMIN en base -> non fiable (0007 s'applique)
  -- =====================================================================
  r6 := '';
  FOREACH t IN ARRAY ARRAY[c_sa_perime, c_sa_retro] LOOP
    PERFORM set_config('request.jwt.claims', t, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    r1 := public._t15_try($q$UPDATE public.t_users SET role = 'SUPER ADMIN' WHERE sync_id = 't15-adm-b'$q$);
    r2 := public._t15_try($q$INSERT INTO public.t_user_roles (user_sync_id, role) VALUES ('t15-adm-b', 'SUPER ADMIN')$q$);
    r3 := public._t15_try($q$UPDATE public.t_users SET password_hash = 'x-t15-pirate' WHERE sync_id = 't15-sa2'$q$);
    EXECUTE 'RESET ROLE';
    r6 := concat_ws(' ', NULLIF(r6, ''), r1, r2, r3);
  END LOOP;
  INSERT INTO _t VALUES (12, 'Jeton SA d''un compte desactive en base, ou d''un compte non SA en base : elevation annulee, role SA refuse, hash d''un SA repris (garde 0007)',
    (SELECT role FROM public.t_users WHERE sync_id = 't15-adm-b') = 'ADMINISTRATEUR_SITE'
      AND NOT EXISTS (SELECT 1 FROM public.t_user_roles WHERE user_sync_id = 't15-adm-b' AND role = 'SUPER ADMIN')
      AND (SELECT password_hash FROM public.t_users WHERE sync_id = 't15-sa2') = 'x-t15-h-sa2'
      AND (SELECT count(*) FROM public.t_security_guard_events WHERE id > v_ev0 AND sync_id = 't15-adm-b'
             AND reason IN ('SA_ELEVATION_BLOQUEE','ROLES_SA_REFUSE') AND jwt_role = 'authenticated') = 4,
    r6);

  -- =====================================================================
  -- 13. Garde coupe (interrupteur 0007) : 0015 ne fait rien non plus
  -- =====================================================================
  UPDATE public.t_security_guard_config SET enabled = false WHERE id = 1;
  PERFORM set_config('request.jwt.claims', c_sa, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  r1 := public._t15_try($q$UPDATE public.t_users SET password_hash = 'x-t15-coupe' WHERE sync_id = 't15-sa2'$q$);
  EXECUTE 'RESET ROLE';
  UPDATE public.t_security_guard_config SET enabled = true WHERE id = 1;
  INSERT INTO _t VALUES (13, 'Interrupteur enabled=false : 0015 inactif aussi (hash d''un autre SA ecrit) ; interrupteur remis a true',
    r1 = 'ok:1' AND (SELECT password_hash FROM public.t_users WHERE sync_id = 't15-sa2') = 'x-t15-coupe'
      AND (SELECT enabled FROM public.t_security_guard_config WHERE id = 1),
    r1);

  -- =====================================================================
  -- 14. postgres sans claims : fiable, inchange
  -- =====================================================================
  PERFORM set_config('request.jwt.claims', '', true);
  UPDATE public.t_users SET password_hash = 'x-t15-postgres', sync_id = 't15-sa2' WHERE sync_id = 't15-sa2';
  DELETE FROM public.t_users WHERE sync_id = 't15-sa2';
  INSERT INTO _t VALUES (14, 'postgres sans claims : hash d''un SA ecrit puis SA supprime (fiable, aucun journal SA_AUTH)',
    NOT EXISTS (SELECT 1 FROM public.t_users WHERE sync_id = 't15-sa2')
      AND NOT EXISTS (SELECT 1 FROM public.t_security_guard_events WHERE id > v_ev0 AND sync_id = 't15-sa2' AND jwt_role IS NULL),
    NULL);

  -- =====================================================================
  -- 15. Journal : jamais de password_hash ; SA_AUTH_* toujours en authenticated
  -- =====================================================================
  INSERT INTO _t VALUES (15, 'Journal : aucun password_hash dans attempted ; raisons SA_AUTH_* seulement pour authenticated ; aucun repli ferme',
    NOT EXISTS (SELECT 1 FROM public.t_security_guard_events WHERE id > v_ev0 AND attempted ? 'password_hash')
      AND NOT EXISTS (SELECT 1 FROM public.t_security_guard_events WHERE id > v_ev0 AND attempted::text LIKE '%x-t15-%')
      AND NOT EXISTS (SELECT 1 FROM public.t_security_guard_events WHERE id > v_ev0 AND reason LIKE 'SA\_AUTH\_%' AND jwt_role IS DISTINCT FROM 'authenticated')
      AND NOT EXISTS (SELECT 1 FROM public.t_security_guard_events WHERE id > v_ev0 AND reason LIKE '%REPLI%'),
    (SELECT string_agg(reason || '/' || coalesce(jwt_role, '-'), ', ' ORDER BY id) FROM public.t_security_guard_events WHERE id > v_ev0));

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
    RAISE EXCEPTION 'TEST 0015 ECHEC : cas en erreur : %', v_ko;
  END IF;
  RAISE NOTICE 'TEST 0015 OK (% cas)', (SELECT count(*) FROM _t);
END;
$$;

ROLLBACK;
