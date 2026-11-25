-- ============================================================
-- Test de supabase/migrations/0022_fonction_mobile_mes_stats.sql
-- DEV UNIQUEMENT (ajadkziqaskadlzboeqo), apres 0020 + 0022. Tout s'execute
-- dans un bloc DO qui se termine par RAISE EXCEPTION : annulation complete,
-- aucune ligne ne reste ; le message d'erreur contient le bilan « ok/total ».
-- Les dates fixes supposent la semaine du lundi 2026-11-23 au dimanche
-- 2026-11-29, le test etant joue un 2026-11-25 (adapter sinon).
-- NE JAMAIS EXECUTER EN PROD.
-- ============================================================
DO $t$
DECLARE
  v_sa BIGINT; v_sb BIGINT; v_c1 BIGINT; v_cb BIGINT;
  cl TEXT; r JSONB; res TEXT := ''; nok INT := 0; tot INT := 0; b BOOLEAN;
  c_op TEXT; c_inact TEXT; c_saisie TEXT; c_big TEXT; c_forge TEXT; c_opb TEXT;
BEGIN
  INSERT INTO public.t_sites (nom, code, sync_id, is_active) VALUES ('ZZTEST SITE A','ZZA','zz22-sa',1) RETURNING id INTO v_sa;
  INSERT INTO public.t_sites (nom, code, sync_id, is_active) VALUES ('ZZTEST SITE B','ZZB','zz22-sb',1) RETURNING id INTO v_sb;
  INSERT INTO public.t_centres (site_id, nom, numero, prefixe_rangement, sync_id) VALUES (v_sa,'ZZTEST CENTRE A1',1,'A1-','zz22-ca1') RETURNING id INTO v_c1;
  INSERT INTO public.t_centres (site_id, nom, numero, prefixe_rangement, sync_id) VALUES (v_sb,'ZZTEST CENTRE B',1,'B-','zz22-cb') RETURNING id INTO v_cb;
  INSERT INTO public.t_users (login, password_hash, role, statut_actif, site_id, centre_id, sync_id) VALUES
    ('zztest_op','x','OPERATEUR_VERIFICATION',1,v_sa,v_c1,'zz22-u-op'),
    ('zztest_inact','x','OPERATEUR_VERIFICATION',0,v_sa,v_c1,'zz22-u-inact'),
    ('zztest_saisie','x','OPERATEUR_SAISIE',1,v_sa,v_c1,'zz22-u-saisie'),
    ('zztest_big','x','OPERATEUR_VERIFICATION',1,v_sa,v_c1,'zz22-u-big'),
    ('zztest_opb','x','OPERATEUR_VERIFICATION',1,v_sb,v_cb,'zz22-u-opb');

  -- Cartes de zztest_op (site A), DELIVRE : a..h comptees, i hors annee
  INSERT INTO public.t_cartes (sync_id, noms, prenoms, date_naissance, lieu_naissance, num_secu, rangement,
                               nom_retirant, relation_retirant, num_retirant, statut, statut_physique, id_site, id_centre,
                               agent_distributeur, date_delivrance) VALUES
   ('zz22-a','AAA','P','1990-01-01','ABOBO','ZZSECRETNUM01','A1-01','RET A','PERE','+225 07 01 02 03 04','DELIVRE','OK',v_sa,v_c1,'zztest_op', now() - interval '1 second'),
   ('zz22-b','BBB','P',NULL,NULL,NULL,NULL,NULL,NULL,NULL,'DELIVRE','OK',v_sa,v_c1,'zztest_op','2026-11-25 00:00:00+00'),
   ('zz22-c','CCC','P',NULL,NULL,NULL,NULL,NULL,NULL,NULL,'DELIVRE','OK',v_sa,v_c1,'zztest_op','2026-11-24 23:59:59+00'),
   ('zz22-d','DDD','P',NULL,NULL,NULL,NULL,NULL,NULL,NULL,'DELIVRE','OK',v_sa,v_c1,'zztest_op','2026-11-23 00:00:00+00'),
   ('zz22-e','EEE','P',NULL,NULL,NULL,NULL,NULL,NULL,NULL,'DELIVRE','OK',v_sa,v_c1,'zztest_op','2026-11-22 23:59:59+00'),
   ('zz22-f','FFF','P',NULL,NULL,NULL,NULL,NULL,NULL,NULL,'DELIVRE','OK',v_sa,v_c1,'zztest_op','2026-11-01 00:00:00+00'),
   ('zz22-g','GGG','P',NULL,NULL,NULL,NULL,NULL,NULL,NULL,'DELIVRE','OK',v_sa,v_c1,'zztest_op','2026-10-31 23:59:59+00'),
   ('zz22-h','HHH','P',NULL,NULL,NULL,NULL,NULL,NULL,NULL,'DELIVRE','OK',v_sa,v_c1,'zztest_op','2026-01-01 00:00:00+00'),
   ('zz22-i','III','P',NULL,NULL,NULL,NULL,NULL,NULL,NULL,'DELIVRE','OK',v_sa,v_c1,'zztest_op','2025-12-31 23:59:59+00'),
   -- login en majuscules : compte (insensible a la casse)
   ('zz22-j','JJJ','P',NULL,NULL,NULL,NULL,NULL,NULL,NULL,'DELIVRE','OK',v_sa,v_c1,'ZZTEST_OP', now() - interval '2 seconds'),
   -- exclues : date future, autre agent, autre site (meme login), statut non DELIVRE
   ('zz22-k','KKK','P',NULL,NULL,NULL,NULL,NULL,NULL,NULL,'DELIVRE','OK',v_sa,v_c1,'zztest_op', now() + interval '1 hour'),
   ('zz22-l','LLL','P',NULL,NULL,NULL,NULL,NULL,NULL,NULL,'DELIVRE','OK',v_sa,v_c1,'zztest_autre', now() - interval '3 seconds'),
   ('zz22-m','MMM','P',NULL,NULL,NULL,NULL,NULL,NULL,NULL,'DELIVRE','OK',v_sb,v_cb,'zztest_op', now() - interval '4 seconds'),
   ('zz22-n','NNN','P',NULL,NULL,NULL,NULL,NULL,NULL,NULL,'EN STOCK','OK',v_sa,v_c1,'zztest_op', now() - interval '5 seconds');
  -- 205 retraits du jour pour zztest_big (limite 200)
  INSERT INTO public.t_cartes (sync_id, noms, prenoms, statut, statut_physique, id_site, id_centre, agent_distributeur, date_delivrance)
  SELECT 'zz22-big' || g, 'BIG', 'P' || g, 'DELIVRE', 'OK', v_sa, v_c1, 'zztest_big', now() - (g || ' seconds')::interval
    FROM generate_series(1, 205) g;

  c_op     := jsonb_build_object('role','authenticated','gis_v',1,'gis_sync_id','zz22-u-op','gis_site_id',v_sa,'gis_centre_id',v_c1,'gis_roles',jsonb_build_array('OPERATEUR_VERIFICATION'))::text;
  c_inact  := jsonb_build_object('role','authenticated','gis_v',1,'gis_sync_id','zz22-u-inact','gis_site_id',v_sa,'gis_centre_id',v_c1,'gis_roles',jsonb_build_array('OPERATEUR_VERIFICATION'))::text;
  c_saisie := jsonb_build_object('role','authenticated','gis_v',1,'gis_sync_id','zz22-u-saisie','gis_site_id',v_sa,'gis_centre_id',v_c1,'gis_roles',jsonb_build_array('OPERATEUR_SAISIE'))::text;
  c_big    := jsonb_build_object('role','authenticated','gis_v',1,'gis_sync_id','zz22-u-big','gis_site_id',v_sa,'gis_centre_id',v_c1,'gis_roles',jsonb_build_array('OPERATEUR_VERIFICATION'))::text;
  c_opb    := jsonb_build_object('role','authenticated','gis_v',1,'gis_sync_id','zz22-u-opb','gis_site_id',v_sb,'gis_centre_id',v_cb,'gis_roles',jsonb_build_array('OPERATEUR_VERIFICATION'))::text;
  -- jeton du compte site A mais site du jeton = B (compte « deplace »)
  c_forge  := jsonb_build_object('role','authenticated','gis_v',1,'gis_sync_id','zz22-u-op','gis_site_id',v_sb,'gis_centre_id',v_cb,'gis_roles',jsonb_build_array('OPERATEUR_VERIFICATION'))::text;

  -- 1 : compteurs et contrat
  PERFORM set_config('request.jwt.claims', c_op, true);
  r := public.fn_mobile_mes_stats();
  tot := tot + 1; b := r->>'code' = 'OK' AND (r->>'aujourd_hui')::int = 3 AND (r->>'semaine')::int = 5 AND (r->>'mois')::int = 7 AND (r->>'annee')::int = 9;
  IF b THEN nok := nok + 1; END IF; res := res || format('1 compteurs j3/s5/m7/a9 : %s (%s)%s', b, r - 'retraits_jour', E'\n');
  tot := tot + 1; b := r->>'site_nom' = 'ZZTEST SITE A' AND r->>'centre_nom' = 'ZZTEST CENTRE A1';
  IF b THEN nok := nok + 1; END IF; res := res || format('2 site_nom / centre_nom : %s%s', b, E'\n');
  tot := tot + 1; b := jsonb_array_length(r->'retraits_jour') = 3 AND r->'retraits_jour'->0->>'noms' = 'AAA' AND r->'retraits_jour'->1->>'noms' = 'JJJ' AND r->'retraits_jour'->2->>'noms' = 'BBB';
  IF b THEN nok := nok + 1; END IF; res := res || format('3 liste du jour (3, tri decroissant AAA,JJJ,BBB) : %s%s', b, E'\n');
  tot := tot + 1; b := (r->'retraits_jour'->0) ?& ARRAY['date_delivrance','noms','prenoms','date_de_naissance','lieu_de_naissance','num_secu','rangement','nom_retirant','relation_retirant','num_retirant']
        AND r->'retraits_jour'->0->>'num_secu' = '********01' AND r->'retraits_jour'->0->>'num_retirant' = '********04'
        AND r->'retraits_jour'->0->>'lieu_de_naissance' = 'ABOBO' AND r->'retraits_jour'->0->>'date_de_naissance' = '1990-01-01'
        AND r::text NOT LIKE '%ZZSECRETNUM01%' AND r::text NOT LIKE '%07 01 02 03%';
  IF b THEN nok := nok + 1; END IF; res := res || format('4 cles + masquage (aucun numero en clair) : %s%s', b, E'\n');

  -- 5 : autre site, meme login d'agent : ne voit que ses cartes (site B : 1 carte 'zz22-m' agent zztest_op, mais compte zztest_opb)
  PERFORM set_config('request.jwt.claims', c_opb, true);
  r := public.fn_mobile_mes_stats();
  tot := tot + 1; b := r->>'code' = 'OK' AND (r->>'annee')::int = 0 AND r->>'site_nom' = 'ZZTEST SITE B';
  IF b THEN nok := nok + 1; END IF; res := res || format('5 operateur site B (login different) : annee 0 : %s (%s)%s', b, r - 'retraits_jour', E'\n');

  -- 6 : compte inactif ; 7 : site du jeton different du site du compte
  PERFORM set_config('request.jwt.claims', c_inact, true);
  r := public.fn_mobile_mes_stats();
  tot := tot + 1; b := r = '{"code":"COMPTE_INACTIF"}'::jsonb;
  IF b THEN nok := nok + 1; END IF; res := res || format('6 compte inactif : %s%s', b, E'\n');
  PERFORM set_config('request.jwt.claims', c_forge, true);
  r := public.fn_mobile_mes_stats();
  tot := tot + 1; b := r = '{"code":"COMPTE_INACTIF"}'::jsonb;
  IF b THEN nok := nok + 1; END IF; res := res || format('7 site du jeton <> site du compte : %s%s', b, E'\n');

  -- 8 : role non autorise (42501) ; 9 : sans claims (42501)
  tot := tot + 1;
  BEGIN
    PERFORM set_config('request.jwt.claims', c_saisie, true);
    PERFORM public.fn_mobile_mes_stats();
    b := false;
  EXCEPTION WHEN insufficient_privilege THEN b := true; END;
  IF b THEN nok := nok + 1; END IF; res := res || format('8 role OPERATEUR_SAISIE -> 42501 : %s%s', b, E'\n');
  tot := tot + 1;
  BEGIN
    PERFORM set_config('request.jwt.claims', '{"role":"authenticated"}', true);
    PERFORM public.fn_mobile_mes_stats();
    b := false;
  EXCEPTION WHEN insufficient_privilege THEN b := true; END;
  IF b THEN nok := nok + 1; END IF; res := res || format('9 sans claims gis -> 42501 : %s%s', b, E'\n');

  -- 10 : limite 200 ; compteur reel 205
  PERFORM set_config('request.jwt.claims', c_big, true);
  r := public.fn_mobile_mes_stats();
  tot := tot + 1; b := jsonb_array_length(r->'retraits_jour') = 200 AND (r->>'aujourd_hui')::int = 205 AND (r->>'annee')::int = 205;
  IF b THEN nok := nok + 1; END IF; res := res || format('10 limite 200 lignes, compteur 205 : %s%s', b, E'\n');

  -- 11 : droits
  tot := tot + 1; b := has_function_privilege('authenticated','public.fn_mobile_mes_stats()','EXECUTE')
        AND NOT has_function_privilege('anon','public.fn_mobile_mes_stats()','EXECUTE')
        AND (SELECT p.prosecdef AND p.provolatile = 's' AND p.proconfig @> ARRAY['search_path=""'] FROM pg_proc p WHERE p.oid = 'public.fn_mobile_mes_stats()'::regprocedure);
  IF b THEN nok := nok + 1; END IF; res := res || format('11 droits / securite : %s%s', b, E'\n');

  RAISE EXCEPTION E'BILAN 0022 : %/% cas OK\n%', nok, tot, res;
END
$t$;
