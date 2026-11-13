-- ============================================================
-- Test de supabase/migrations/0009_versions_postes.sql
-- A executer sur le projet DEV uniquement (ajadkziqaskadlzboeqo), apres 0008
-- et 0009, dans le SQL Editor (role postgres). Transaction ANNULEE (ROLLBACK
-- final) : aucune ligne ne reste (postes de test 't9-*').
-- Les cas 1 a 9 simulent l'appelant par request.jwt.claims ; les cas 10 a 12
-- rejouent un vrai SET LOCAL ROLE anon.
-- Resultat : table _t, puis un bloc qui LEVE UNE ERREUR si un cas vaut false.
-- ============================================================
BEGIN;

CREATE TEMP TABLE _t (n INT, cas TEXT, ok BOOLEAN, detail TEXT) ON COMMIT DROP;

DO $$
DECLARE
  v      public.t_client_versions;
  b      BOOLEAN;
  b2     BOOLEAN;
  n_cnt  INT;
BEGIN
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.headers', '', true);

  -- ---------- 0. Preconditions ----------
  INSERT INTO _t VALUES (0, 'Preconditions : table en RLS sans politique, RPC SECURITY DEFINER, EXECUTE anon/authenticated',
    (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.t_client_versions'::regclass)
      AND NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 't_client_versions')
      AND (SELECT prosecdef FROM pg_proc WHERE oid = 'public.fn_report_client_version(text,text,text,text)'::regprocedure)
      AND has_function_privilege('anon', 'public.fn_report_client_version(text,text,text,text)', 'EXECUTE')
      AND has_function_privilege('authenticated', 'public.fn_report_client_version(text,text,text,text)', 'EXECUTE'),
    NULL);

  -- ---------- 1. Premier appel publishable ----------
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  PERFORM set_config('request.headers', '{"x-client-info":"t9-client/1.0"}', true);
  b := public.fn_report_client_version('t9-poste-0001', '2.26.2', 't9-user-1', 't9-site-1');
  SELECT * INTO v FROM public.t_client_versions WHERE poste_key = 't9-poste-0001';
  INSERT INTO _t VALUES (1, 'premier appel publishable : true, ligne creee, key_kind publishable calcule serveur',
    b AND v.app_version = '2.26.2' AND v.key_kind = 'publishable' AND v.client_info = 't9-client/1.0'
      AND v.last_user_sync_id = 't9-user-1' AND v.site_sync_id = 't9-site-1' AND v.nb_reports = 1,
    format('ok=%s kind=%s', b, v.key_kind));

  -- ---------- 2. Deuxieme appel meme poste (legacy simule, nouvelle version, sans user) ----------
  PERFORM set_config('request.jwt.claims', '{"iss":"x","ref":"y","role":"anon","iat":1,"exp":2}', true);
  b := public.fn_report_client_version('t9-poste-0001', '2.27.0-beta.1', NULL, NULL);
  SELECT * INTO v FROM public.t_client_versions WHERE poste_key = 't9-poste-0001';
  SELECT count(*) INTO n_cnt FROM public.t_client_versions WHERE poste_key = 't9-poste-0001';
  INSERT INTO _t VALUES (2, 'meme poste : une seule ligne, version et key_kind mis a jour, user/site conserves, nb_reports 2',
    b AND n_cnt = 1 AND v.app_version = '2.27.0-beta.1' AND v.key_kind = 'legacy_suppose'
      AND v.last_user_sync_id = 't9-user-1' AND v.site_sync_id = 't9-site-1' AND v.nb_reports = 2,
    format('lignes=%s kind=%s reports=%s', n_cnt, v.key_kind, v.nb_reports));

  -- ---------- 3-6. Parametres refuses (false, aucune ligne, aucune erreur) ----------
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  INSERT INTO _t VALUES (3, 'poste_key invalide (trop court, caracteres interdits, NULL, > 64) : false',
    NOT public.fn_report_client_version('court', '2.26.2')
      AND NOT public.fn_report_client_version('t9 poste; drop', '2.26.2')
      AND NOT public.fn_report_client_version(NULL, '2.26.2')
      AND NOT public.fn_report_client_version(repeat('a', 65), '2.26.2'),
    NULL);
  INSERT INTO _t VALUES (4, 'version invalide (texte, 4 segments, NULL, trop longue, injection) : false',
    NOT public.fn_report_client_version('t9-poste-0002', 'abc')
      AND NOT public.fn_report_client_version('t9-poste-0002', '1.2.3.4')
      AND NOT public.fn_report_client_version('t9-poste-0002', NULL)
      AND NOT public.fn_report_client_version('t9-poste-0002', '1.2.3-' || repeat('a', 40))
      AND NOT public.fn_report_client_version('t9-poste-0002', '1.2.3''; select 1; --'),
    NULL);
  SELECT count(*) INTO n_cnt FROM public.t_client_versions WHERE poste_key LIKE 't9-poste-0002%' OR poste_key IN ('court');
  INSERT INTO _t VALUES (5, 'appels refuses : aucune ligne creee', n_cnt = 0, format('lignes=%s', n_cnt));

  b := public.fn_report_client_version('t9-poste-0003', '2.26.1', repeat('u', 65), 'site invalide !');
  SELECT * INTO v FROM public.t_client_versions WHERE poste_key = 't9-poste-0003';
  INSERT INTO _t VALUES (6, 'user/site invalides : appel accepte, champs stockes NULL',
    b AND v.last_user_sync_id IS NULL AND v.site_sync_id IS NULL, NULL);

  -- ---------- 7. authenticated / service_role ----------
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"s","iss":"i"}', true);
  b := public.fn_report_client_version('t9-poste-0004', '3.0.0');
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  b2 := public.fn_report_client_version('t9-poste-0005', '3.0.0');
  INSERT INTO _t VALUES (7, 'key_kind authenticated et service_role',
    b AND b2
      AND (SELECT key_kind FROM public.t_client_versions WHERE poste_key = 't9-poste-0004') = 'authenticated'
      AND (SELECT key_kind FROM public.t_client_versions WHERE poste_key = 't9-poste-0005') = 'service_role',
    NULL);

  -- ---------- 8. Plafond anti-abus (5000) ----------
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  INSERT INTO public.t_client_versions (poste_key, app_version, key_kind)
  SELECT 't9-remp-' || lpad(g::text, 6, '0'), '0.0.1', 'test'
  FROM generate_series(1, GREATEST(0, 5000 - (SELECT count(*) FROM public.t_client_versions))) g;
  b  := public.fn_report_client_version('t9-poste-9999', '2.26.2');
  b2 := public.fn_report_client_version('t9-poste-0001', '2.26.3');
  INSERT INTO _t VALUES (8, 'plafond 5000 lignes : nouveau poste refuse, poste connu mis a jour',
    NOT b AND b2
      AND NOT EXISTS (SELECT 1 FROM public.t_client_versions WHERE poste_key = 't9-poste-9999')
      AND (SELECT app_version FROM public.t_client_versions WHERE poste_key = 't9-poste-0001') = '2.26.3',
    format('nouveau=%s connu=%s total=%s', b, b2, (SELECT count(*) FROM public.t_client_versions)));
  DELETE FROM public.t_client_versions WHERE poste_key LIKE 't9-remp-%';

  -- ---------- 9. Aucune valeur de claim stockee ----------
  SELECT count(*) INTO n_cnt FROM public.t_client_versions v2
   WHERE v2.poste_key LIKE 't9-%' AND (v2::text LIKE '%"iss"%' OR v2.key_kind NOT IN
     ('publishable','legacy_suppose','authenticated','service_role','postgres','autre'));
  INSERT INTO _t VALUES (9, 'key_kind toujours une classe connue, aucune claim brute stockee',
    n_cnt = 0, format('lignes_fautives=%s', n_cnt));

  -- ---------- 10-12. Vrai role anon ----------
  BEGIN
    PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
    SET LOCAL ROLE anon;
    b := public.fn_report_client_version('t9-poste-anon', '2.26.2', 't9-user-2', NULL);
    RESET ROLE;
    INSERT INTO _t VALUES (10, 'SET LOCAL ROLE anon : RPC appelable, ligne ecrite (publishable)',
      b AND (SELECT key_kind FROM public.t_client_versions WHERE poste_key = 't9-poste-anon') = 'publishable',
      format('ok=%s', b));
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
    INSERT INTO _t VALUES (10, 'SET LOCAL ROLE anon : RPC appelable', false, 'permission refusee');
  END;
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM 1 FROM public.t_client_versions LIMIT 1;
    RESET ROLE;
    INSERT INTO _t VALUES (11, 't_client_versions illisible pour anon', false, 'SELECT autorise');
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
    INSERT INTO _t VALUES (11, 't_client_versions illisible pour anon', true, 'permission refusee (attendu)');
  END;
  BEGIN
    SET LOCAL ROLE anon;
    UPDATE public.t_client_versions SET app_version = '9.9.9' WHERE poste_key = 't9-poste-anon';
    RESET ROLE;
    INSERT INTO _t VALUES (12, 't_client_versions non modifiable directement par anon', false, 'UPDATE autorise');
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
    INSERT INTO _t VALUES (12, 't_client_versions non modifiable directement par anon', true, 'permission refusee (attendu)');
  END;

  INSERT INTO _t VALUES (13, 'aucun droit anon/authenticated sur la table',
    NOT has_table_privilege('anon', 'public.t_client_versions', 'SELECT,INSERT,UPDATE,DELETE')
      AND NOT has_table_privilege('authenticated', 'public.t_client_versions', 'SELECT,INSERT,UPDATE,DELETE'),
    NULL);

  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.headers', '', true);
END;
$$;

SELECT n, ok, cas, detail FROM _t ORDER BY n;

DO $$
DECLARE
  v_ko TEXT;
BEGIN
  SELECT string_agg(n::text, ', ' ORDER BY n) INTO v_ko FROM _t WHERE ok IS DISTINCT FROM true;
  IF v_ko IS NOT NULL THEN
    RAISE EXCEPTION 'TEST 0009 ECHEC : cas en erreur ou non concluants : %', v_ko;
  END IF;
  RAISE NOTICE 'TEST 0009 OK (% cas)', (SELECT count(*) FROM _t);
END;
$$;

ROLLBACK;
