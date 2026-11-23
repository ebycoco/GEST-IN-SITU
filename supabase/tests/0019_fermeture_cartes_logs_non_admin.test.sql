-- ============================================================
-- Test de supabase/migrations/0019_fermeture_cartes_logs_non_admin.sql
-- A executer sur le projet DEV uniquement (ajadkziqaskadlzboeqo), apres
-- 0011, 0013, 0014 et 0019, dans le SQL Editor (role postgres). Transaction
-- ANNULEE (ROLLBACK final) : aucune ligne ne reste (sites, centres, cartes,
-- logs 't19*', fonctions d'aide public._t19_*, compteurs 0008).
--
-- Methode (identique aux tests 0013 / 0014) : vrais changements de role
-- (SET LOCAL ROLE authenticated / anon / service_role, comme PostgREST) +
-- claims simulees dans request.jwt.claims. RLS et privileges reellement
-- appliques.
-- Profils : OPERATEUR_VERIFICATION du site A, operateur multi-roles
-- (OPERATEUR_VERIFICATION + OPERATEUR_QUALITE), ADMIN_CENTRE du centre A,
-- ADMINISTRATEUR_SITE du site A, multi-roles OPERATEUR_VERIFICATION +
-- ADMIN_CENTRE, SUPER ADMIN principal, SUPER ADMIN seulement secondaire
-- (gis_is_super_admin = false), authenticated SANS claims gis_*, anon,
-- service_role.
-- Les comptages ne portent que sur les lignes de test (sync_id 't19-%').
-- Resultat : table _t, puis un bloc qui LEVE UNE ERREUR si un cas vaut false
-- (le cas 11, service_role, peut etre non concluant si SET ROLE est refuse).
-- NE JAMAIS EXECUTER EN PROD.
-- ============================================================
BEGIN;

CREATE TEMP TABLE _t (n INT, cas TEXT, ok BOOLEAN, detail TEXT) ON COMMIT DROP;

CREATE FUNCTION public._t19_try(p_sql TEXT) RETURNS TEXT
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

CREATE FUNCTION public._t19_n(p_sql TEXT) RETURNS BIGINT
LANGUAGE plpgsql AS $f$
DECLARE
  v BIGINT;
BEGIN
  EXECUTE p_sql INTO v;
  RETURN v;
EXCEPTION WHEN others THEN
  RETURN -1;
END;
$f$;

CREATE FUNCTION public._t19_c(p_sid TEXT, p_site BIGINT, p_centre BIGINT, p_roles TEXT[], p_sa BOOLEAN) RETURNS TEXT
LANGUAGE sql AS $f$
  SELECT jsonb_build_object('role','authenticated','aud','authenticated',
           'sub','00000000-0000-0000-0000-000000000019',
           'gis_v',1,'gis_sync_id',p_sid,'gis_site_id',p_site,'gis_centre_id',p_centre,
           'gis_primary_role',p_roles[1],'gis_roles',to_jsonb(p_roles),
           'gis_is_super_admin',p_sa,'gis_statut_actif',true)::text
$f$;

-- Batterie standard : lecture cartes (site A, total), ecritures cartes,
-- lecture logs, ecritures logs. Renvoie une chaine comparable.
CREATE FUNCTION public._t19_batterie(p_claims TEXT, p_site BIGINT, p_centre BIGINT, p_tag TEXT) RETURNS TEXT
LANGUAGE plpgsql AS $f$
DECLARE
  n_all BIGINT; n_a BIGINT; n_log BIGINT;
  r1 TEXT; r2 TEXT; r3 TEXT; r4 TEXT; r5 TEXT; r6 TEXT; r7 TEXT;
BEGIN
  PERFORM set_config('request.jwt.claims', p_claims, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  n_all := public._t19_n($q$SELECT count(*) FROM public.t_cartes WHERE sync_id LIKE 't19-%'$q$);
  n_a   := public._t19_n($q$SELECT count(*) FROM public.t_cartes WHERE sync_id LIKE 't19-c-a%'$q$);
  n_log := public._t19_n($q$SELECT count(*) FROM public.t_logs WHERE sync_id LIKE 't19-%'$q$);
  r1 := public._t19_try(format('INSERT INTO public.t_cartes (noms, prenoms, id_site, id_centre, sync_id) VALUES (%L, %L, %s, %s, %L)',
                               'T19', p_tag, p_site, p_centre, 't19-c-a-new-' || p_tag));
  r2 := public._t19_try($q$UPDATE public.t_cartes SET statut = 'DELIVRE', date_delivrance = now() WHERE sync_id = 't19-c-a1'$q$);
  r3 := public._t19_try($q$DELETE FROM public.t_cartes WHERE sync_id = 't19-c-a2'$q$);
  r4 := public._t19_try(format('INSERT INTO public.t_logs (action, site_id, centre_id, sync_id) VALUES (%L, %s, %s, %L)',
                               'CARTE_DELIVREE', p_site, p_centre, 't19-l-new-' || p_tag));
  r5 := public._t19_try($q$UPDATE public.t_logs SET detail = 'MODIF' WHERE sync_id = 't19-l-a'$q$);
  r6 := public._t19_try($q$DELETE FROM public.t_logs WHERE sync_id = 't19-l-a2'$q$);
  r7 := public._t19_n(format('SELECT count(*) FROM public.fn_downstream_cartes_chunk(%s, %L, %L, 500) WHERE sync_id LIKE %L', p_site, '-infinity', '', 't19-%'));
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', '', true);
  RETURN format('cartes=%s/%s logs=%s ins=%s upd=%s del=%s log_ins=%s log_upd=%s log_del=%s down=%s',
                n_a, n_all, n_log, r1, r2, r3, r4, r5, r6, r7);
END;
$f$;

DO $$
DECLARE
  v_sa BIGINT; v_sb BIGINT; v_ca BIGINT; v_cb BIGINT;
  c_op TEXT; c_opm TEXT; c_ac TEXT; c_as TEXT; c_mix TEXT; c_sa TEXT; c_sa2 TEXT;
  c_nog TEXT := '{"role":"authenticated","aud":"authenticated","sub":"00000000-0000-0000-0000-000000000019"}';
  r TEXT; r1 TEXT; r2 TEXT; r3 TEXT;
  n1 BIGINT; n2 BIGINT;
  -- Attendus
  e_ferme TEXT;
BEGIN
  PERFORM set_config('request.jwt.claims', '', true);

  -- ---------- 0. Structure ----------
  INSERT INTO _t VALUES (0, '4 politiques r19_* RESTRICTIVE TO authenticated (t_cartes ALL ; t_logs INSERT, UPDATE, DELETE ; aucune sur SELECT t_logs) ; r13_* 14 et r14_* 9 toujours presentes ; aucune politique ne vise anon',
    (SELECT count(*) = 4
            AND bool_and(permissive = 'RESTRICTIVE' AND roles = ARRAY['authenticated']::name[])
            AND string_agg(tablename || '.' || cmd, ',' ORDER BY tablename, cmd) = 't_cartes.ALL,t_logs.DELETE,t_logs.INSERT,t_logs.UPDATE'
       FROM pg_policies WHERE schemaname = 'public' AND policyname LIKE 'r19\_%')
      AND (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND policyname LIKE 'r13\_%') = 14
      AND (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND policyname LIKE 'r14\_%') = 9,
    (SELECT string_agg(tablename || '.' || cmd, ',' ORDER BY tablename, cmd) FROM pg_policies WHERE schemaname = 'public' AND policyname LIKE 'r19\_%'));

  INSERT INTO _t VALUES (1, 'Privileges de table inchanges : authenticated garde SELECT/INSERT/UPDATE/DELETE sur t_cartes et t_logs (fermeture par politique, pas par REVOKE) ; anon idem',
    has_table_privilege('authenticated', 'public.t_cartes', 'SELECT,INSERT,UPDATE,DELETE')
      AND has_table_privilege('authenticated', 'public.t_logs', 'SELECT,INSERT,UPDATE,DELETE')
      AND has_table_privilege('anon', 'public.t_cartes', 'SELECT,INSERT,UPDATE,DELETE')
      AND has_table_privilege('anon', 'public.t_logs', 'SELECT,INSERT,UPDATE,DELETE'),
    NULL);

  -- ---------- Jeu de test (postgres, sans JWT) ----------
  INSERT INTO public.t_sites (nom, code, sync_id) VALUES ('T19 SITE A', 'T19A', 't19-site-a') RETURNING id INTO v_sa;
  INSERT INTO public.t_sites (nom, code, sync_id) VALUES ('T19 SITE B', 'T19B', 't19-site-b') RETURNING id INTO v_sb;
  INSERT INTO public.t_centres (site_id, nom, numero, sync_id) VALUES (v_sa, 'T19 CENTRE A', 1, 't19-cen-a') RETURNING id INTO v_ca;
  INSERT INTO public.t_centres (site_id, nom, numero, sync_id) VALUES (v_sb, 'T19 CENTRE B', 1, 't19-cen-b') RETURNING id INTO v_cb;

  c_op  := public._t19_c('t19-u-op',  v_sa, v_ca, ARRAY['OPERATEUR_VERIFICATION'], false);
  c_opm := public._t19_c('t19-u-opm', v_sa, v_ca, ARRAY['OPERATEUR_VERIFICATION','OPERATEUR_QUALITE'], false);
  c_ac  := public._t19_c('t19-u-ac',  v_sa, v_ca, ARRAY['ADMIN_CENTRE'], false);
  c_as  := public._t19_c('t19-u-as',  v_sa, NULL, ARRAY['ADMINISTRATEUR_SITE'], false);
  c_mix := public._t19_c('t19-u-mix', v_sa, v_ca, ARRAY['OPERATEUR_VERIFICATION','ADMIN_CENTRE'], false);
  c_sa  := public._t19_c('t19-u-sa',  NULL, NULL, ARRAY['SUPER ADMIN'], true);
  c_sa2 := public._t19_c('t19-u-sa2', v_sa, v_ca, ARRAY['OPERATEUR_VERIFICATION','SUPER ADMIN'], false);

  -- =====================================================================
  -- Profils FERMES (non-admin) : lecture 0, ecritures cartes refusees,
  -- lecture logs du site conservee (0013), ecritures logs refusees.
  -- =====================================================================
  e_ferme := 'cartes=0/0 logs=2 ins=err:42501:rls upd=ok:0 del=ok:0 log_ins=err:42501:rls log_upd=ok:0 log_del=ok:0 down=0';

  FOR r1, r2, r3 IN SELECT * FROM (VALUES
      ('2', 'OPERATEUR_VERIFICATION du site A', c_op),
      ('3', 'operateur multi-roles (OPERATEUR_VERIFICATION + OPERATEUR_QUALITE)', c_opm),
      ('4', 'SUPER ADMIN seulement secondaire (gis_is_super_admin = false, gis_roles contient SUPER ADMIN)', c_sa2)) v(a, b, c) LOOP
    DELETE FROM public.t_cartes WHERE sync_id LIKE 't19-%';
    DELETE FROM public.t_logs   WHERE sync_id LIKE 't19-%';
    INSERT INTO public.t_cartes (noms, prenoms, id_site, id_centre, sync_id, statut) VALUES
      ('T19', 'A1', v_sa, v_ca, 't19-c-a1', 'EN STOCK'), ('T19', 'A2', v_sa, v_ca, 't19-c-a2', 'EN STOCK'),
      ('T19', 'B1', v_sb, v_cb, 't19-c-b1', 'EN STOCK');
    INSERT INTO public.t_logs (action, site_id, centre_id, sync_id) VALUES
      ('T19', v_sa, v_ca, 't19-l-a'), ('T19', v_sa, v_ca, 't19-l-a2'), ('T19', v_sb, v_cb, 't19-l-b');
    r := public._t19_batterie(r3, v_sa, v_ca, 'p' || r1);
    INSERT INTO _t VALUES (r1::int, r2 || ' : 0 carte lue (ni directe ni fn_downstream_cartes_chunk), INSERT carte 42501, UPDATE / DELETE 0 ligne, logs du site lisibles (2), ecriture logs refusee',
      r = e_ferme
        AND (SELECT statut FROM public.t_cartes WHERE sync_id = 't19-c-a1') = 'EN STOCK'
        AND EXISTS (SELECT 1 FROM public.t_cartes WHERE sync_id = 't19-c-a2')
        AND (SELECT detail FROM public.t_logs WHERE sync_id = 't19-l-a') IS NULL
        AND EXISTS (SELECT 1 FROM public.t_logs WHERE sync_id = 't19-l-a2'),
      r);
  END LOOP;

  -- Sans claims gis_* : rien du tout (logs compris, 0013).
  DELETE FROM public.t_cartes WHERE sync_id LIKE 't19-%';
  DELETE FROM public.t_logs   WHERE sync_id LIKE 't19-%';
  INSERT INTO public.t_cartes (noms, prenoms, id_site, id_centre, sync_id, statut) VALUES
    ('T19', 'A1', v_sa, v_ca, 't19-c-a1', 'EN STOCK'), ('T19', 'A2', v_sa, v_ca, 't19-c-a2', 'EN STOCK'),
    ('T19', 'B1', v_sb, v_cb, 't19-c-b1', 'EN STOCK');
  INSERT INTO public.t_logs (action, site_id, centre_id, sync_id) VALUES
    ('T19', v_sa, v_ca, 't19-l-a'), ('T19', v_sa, v_ca, 't19-l-a2'), ('T19', v_sb, v_cb, 't19-l-b');
  r := public._t19_batterie(c_nog, v_sa, v_ca, 'nog');
  INSERT INTO _t VALUES (5, 'authenticated SANS claims gis_* : aucune carte, aucun log, aucune ecriture (echec ferme)',
    r = 'cartes=0/0 logs=0 ins=err:42501:rls upd=ok:0 del=ok:0 log_ins=err:42501:rls log_upd=ok:0 log_del=ok:0 down=0', r);

  -- =====================================================================
  -- Profils OUVERTS (administrateurs) : filtre par site 0013 inchange.
  -- =====================================================================
  FOR r1, r2, r3 IN SELECT * FROM (VALUES
      ('6', 'ADMIN_CENTRE du centre A', c_ac),
      ('7', 'ADMINISTRATEUR_SITE du site A', c_as),
      ('8', 'multi-roles OPERATEUR_VERIFICATION + ADMIN_CENTRE (union des roles, comme 0014)', c_mix)) v(a, b, c) LOOP
    DELETE FROM public.t_cartes WHERE sync_id LIKE 't19-%';
    DELETE FROM public.t_logs   WHERE sync_id LIKE 't19-%';
    INSERT INTO public.t_cartes (noms, prenoms, id_site, id_centre, sync_id, statut) VALUES
      ('T19', 'A1', v_sa, v_ca, 't19-c-a1', 'EN STOCK'), ('T19', 'A2', v_sa, v_ca, 't19-c-a2', 'EN STOCK'),
      ('T19', 'B1', v_sb, v_cb, 't19-c-b1', 'EN STOCK');
    INSERT INTO public.t_logs (action, site_id, centre_id, sync_id) VALUES
      ('T19', v_sa, v_ca, 't19-l-a'), ('T19', v_sa, v_ca, 't19-l-a2'), ('T19', v_sb, v_cb, 't19-l-b');
    r := public._t19_batterie(r3, v_sa, v_ca, 'p' || r1);
    -- Ecriture vers le site B toujours refusee (0013).
    PERFORM set_config('request.jwt.claims', r3, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    n1 := public._t19_n($q$SELECT count(*) FROM public.t_cartes WHERE sync_id = 't19-c-b1'$q$);
    r2 := r2 || ' | B: ' || public._t19_try($q$UPDATE public.t_cartes SET prenoms = 'PIRATE' WHERE sync_id = 't19-c-b1'$q$)
               || ' lu=' || n1;
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims', '', true);
    INSERT INTO _t VALUES (r1::int, split_part(r2, ' | ', 1) || ' : cartes de son site lues (2), ecritures permises sur son site, site B invisible et intouchable',
      r = 'cartes=2/2 logs=2 ins=ok:1 upd=ok:1 del=ok:1 log_ins=ok:1 log_upd=ok:1 log_del=ok:1 down=2'
        AND split_part(r2, ' | ', 2) = 'B: ok:0 lu=0',
      r || ' ' || split_part(r2, ' | ', 2));
  END LOOP;

  -- SUPER ADMIN principal : tous les sites.
  DELETE FROM public.t_cartes WHERE sync_id LIKE 't19-%';
  DELETE FROM public.t_logs   WHERE sync_id LIKE 't19-%';
  INSERT INTO public.t_cartes (noms, prenoms, id_site, id_centre, sync_id, statut) VALUES
    ('T19', 'A1', v_sa, v_ca, 't19-c-a1', 'EN STOCK'), ('T19', 'A2', v_sa, v_ca, 't19-c-a2', 'EN STOCK'),
    ('T19', 'B1', v_sb, v_cb, 't19-c-b1', 'EN STOCK');
  INSERT INTO public.t_logs (action, site_id, centre_id, sync_id) VALUES
    ('T19', v_sa, v_ca, 't19-l-a'), ('T19', v_sa, v_ca, 't19-l-a2'), ('T19', v_sb, v_cb, 't19-l-b');
  r := public._t19_batterie(c_sa, v_sb, v_cb, 'sa');
  INSERT INTO _t VALUES (9, 'SUPER ADMIN principal : toutes les cartes et tous les logs (2 sites), ecritures permises partout',
    r = 'cartes=2/3 logs=3 ins=ok:1 upd=ok:1 del=ok:1 log_ins=ok:1 log_upd=ok:1 log_del=ok:1 down=2', r);  -- down : B1 + carte inseree sur le site B

  -- =====================================================================
  -- 10. anon : inchange (lit tout, ecrit tout)
  -- =====================================================================
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  EXECUTE 'SET LOCAL ROLE anon';
  n1 := public._t19_n($q$SELECT count(*) FROM public.t_cartes WHERE sync_id LIKE 't19-%'$q$);
  n2 := public._t19_n($q$SELECT count(*) FROM public.t_logs WHERE sync_id LIKE 't19-%'$q$);
  r1 := public._t19_try($q$UPDATE public.t_cartes SET prenoms = 'ANON' WHERE sync_id LIKE 't19-c-%'$q$);
  r2 := public._t19_try(format('INSERT INTO public.t_logs (action, site_id, sync_id) VALUES (%L, %s, %L)', 'T19', v_sa, 't19-l-anon'));
  r3 := public._t19_try(format('INSERT INTO public.t_cartes (noms, prenoms, id_site, sync_id) VALUES (%L, %L, %s, %L)', 'T19', 'ANON', v_sb, 't19-c-anon'));
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', '', true);
  INSERT INTO _t VALUES (10, 'anon (cle publishable) : lit toutes les cartes et logs de test, ecrit cartes et logs (inchange)',
    n1 = 3 AND n2 = 3 AND r1 = 'ok:3' AND r2 = 'ok:1' AND r3 = 'ok:1',
    format('cartes=%s logs=%s upd=%s log_ins=%s ins=%s', n1, n2, r1, r2, r3));

  -- =====================================================================
  -- 11. service_role : non filtre (BYPASSRLS)
  -- =====================================================================
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  BEGIN
    EXECUTE 'SET LOCAL ROLE service_role';
    n1 := public._t19_n($q$SELECT count(*) FROM public.t_cartes WHERE sync_id LIKE 't19-%'$q$);
    EXECUTE 'RESET ROLE';
    INSERT INTO _t VALUES (11, 'service_role : non filtre (4 cartes de test lues)', n1 = 4, n1::text);
  EXCEPTION WHEN insufficient_privilege THEN
    EXECUTE 'RESET ROLE';
    INSERT INTO _t VALUES (11, 'service_role : SET ROLE refuse au role courant (non concluant)', NULL, SQLSTATE);
  END;

  PERFORM set_config('request.jwt.claims', '', true);
END;
$$;

SELECT n, ok, cas, detail FROM _t ORDER BY n;

DO $$
DECLARE
  v_ko TEXT;
BEGIN
  SELECT string_agg(n::text, ', ' ORDER BY n) INTO v_ko FROM _t WHERE ok IS NOT TRUE AND n <> 11;
  IF v_ko IS NOT NULL THEN
    RAISE EXCEPTION 'TEST 0019 ECHEC : cas en erreur : %', v_ko;
  END IF;
  RAISE NOTICE 'TEST 0019 OK (% cas, cas 11 : %)', (SELECT count(*) FROM _t),
    (SELECT COALESCE(ok::text, 'non concluant') FROM _t WHERE n = 11);
END;
$$;

ROLLBACK;
