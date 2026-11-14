-- ============================================================
-- Test de supabase/migrations/0010_lecture_versions_postes.sql
-- A executer sur le projet DEV uniquement (ajadkziqaskadlzboeqo), apres 0008,
-- 0009 et 0010, dans le SQL Editor (role postgres). Transaction ANNULEE
-- (ROLLBACK final) : aucune ligne ne reste (site, utilisateur et postes de
-- test 't10*' / 'preuve-t10*').
-- Les cas sont mesures en ECART par rapport a l'etat initial du projet
-- (le dev peut deja contenir des lignes).
-- Resultat : table _t, puis un bloc qui LEVE UNE ERREUR si un cas vaut false.
-- ============================================================
BEGIN;

CREATE TEMP TABLE _t (n INT, cas TEXT, ok BOOLEAN, detail TEXT) ON COMMIT DROP;

DO $$
DECLARE
  c0       RECORD;   -- comptage initial
  c1       RECORD;   -- comptage apres insertion des lignes de test
  n_cnt    INT;
  n_cnt2   INT;
  v_ref    TEXT;
  h_avant  TEXT;
  h_apres  TEXT;
  b        BOOLEAN;
  v_site_id BIGINT;
BEGIN
  PERFORM set_config('request.jwt.claims', '', true);

  -- ---------- 0. Preconditions ----------
  INSERT INTO _t VALUES (0, 'Preconditions : 2 fonctions SECURITY DEFINER, STABLE, sans parametre, search_path fige ; EXECUTE anon/authenticated ; aucun EXECUTE PUBLIC ; RPC d''ecriture 0009 toujours FERMEE',
    (SELECT count(*) FROM pg_proc p
      WHERE p.oid IN ('public.fn_list_client_versions()'::regprocedure, 'public.fn_count_client_versions()'::regprocedure)
        AND p.prosecdef AND p.provolatile = 's' AND p.pronargs = 0
        AND EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search\_path=%')) = 2
      AND has_function_privilege('anon', 'public.fn_list_client_versions()', 'EXECUTE')
      AND has_function_privilege('authenticated', 'public.fn_list_client_versions()', 'EXECUTE')
      AND has_function_privilege('anon', 'public.fn_count_client_versions()', 'EXECUTE')
      AND has_function_privilege('authenticated', 'public.fn_count_client_versions()', 'EXECUTE')
      AND NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
                       WHERE p.oid IN ('public.fn_list_client_versions()'::regprocedure, 'public.fn_count_client_versions()'::regprocedure)
                         AND a.grantee = 0)
      AND NOT has_function_privilege('anon', 'public.fn_report_client_version(text,text,text,text)', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'public.fn_report_client_version(text,text,text,text)', 'EXECUTE'),
    NULL);

  INSERT INTO _t VALUES (1, 'aucune colonne de sortie nommee poste_key, client_info, login ou password_hash',
    NOT EXISTS (SELECT 1 FROM pg_proc p, unnest(p.proargnames) a
                 WHERE p.oid IN ('public.fn_list_client_versions()'::regprocedure, 'public.fn_count_client_versions()'::regprocedure)
                   AND a IN ('poste_key', 'client_info', 'login', 'password_hash')),
    NULL);

  SELECT * INTO c0 FROM public.fn_count_client_versions();

  -- ---------- Jeu de test (role postgres) ----------
  INSERT INTO public.t_sites (nom, code, sync_id) VALUES ('T10 SITE TEST', 'T10TST', 't10-site-1')
  RETURNING id INTO v_site_id;
  INSERT INTO public.t_users (login, password_hash, role, site_id, sync_id)
  VALUES ('t10_user_test', 'x', 'OPERATEUR_VERIFICATION', v_site_id, 't10-user-1');

  INSERT INTO public.t_client_versions (poste_key, app_version, key_kind, site_sync_id, last_user_sync_id, last_seen_at) VALUES
    ('t10aaaaa-0000-4000-8000-000000000001', '2.27.0', 'publishable', 't10-site-1', NULL,          NOW() + interval '1 hour'),  -- site reconnu
    ('t10bbbbb-0000-4000-8000-000000000002', '2.26.2', 'publishable', 't10-site-x', 't10-user-1',  NOW() + interval '50 minutes'), -- user reconnu
    ('t10ccccc-0000-4000-8000-000000000003', '2.26.2', 'publishable', 't10-site-x', 't10-user-x',  NOW()),  -- ni l'un ni l'autre
    ('t10ddddd-0000-4000-8000-000000000004', '2.26.2', 'autre',       NULL,         NULL,          NOW()),  -- tout NULL
    ('preuve-t10-0000-0001',                 '2.26.2', 'publishable', 't10-site-1', 't10-user-1',  NOW() + interval '2 hours'); -- preuve

  SELECT * INTO c1 FROM public.fn_count_client_versions();

  -- ---------- 2. Cle complete jamais renvoyee ----------
  SELECT count(*) INTO n_cnt FROM public.fn_list_client_versions() l
   WHERE length(l.poste_ref) > 8
      OR EXISTS (SELECT 1 FROM public.t_client_versions v WHERE v.poste_key = l.poste_ref AND length(v.poste_key) > 8);
  SELECT poste_ref INTO v_ref FROM public.fn_list_client_versions() WHERE poste_ref = 't10aaaaa';
  INSERT INTO _t VALUES (2, 'poste_ref = 8 premiers caracteres, jamais la cle complete',
    n_cnt = 0 AND v_ref = 't10aaaaa'
      AND NOT EXISTS (SELECT 1 FROM public.fn_list_client_versions() l WHERE l.poste_ref LIKE 't10aaaaa-%'),
    format('lignes_fautives=%s ref=%s', n_cnt, v_ref));

  -- ---------- 3. Filtre preuve-% ----------
  INSERT INTO _t VALUES (3, 'preuve-% ecartee de la liste (meme avec site et utilisateur valides) et comptee dans nb_preuve',
    NOT EXISTS (SELECT 1 FROM public.fn_list_client_versions() WHERE poste_ref LIKE 'preuve-%')
      AND c1.nb_preuve - c0.nb_preuve = 1,
    format('delta_preuve=%s', c1.nb_preuve - c0.nb_preuve));

  -- ---------- 4. Filtre site/utilisateur + comptage des ignorees ----------
  INSERT INTO _t VALUES (4, 'site seul reconnu -> listee ; utilisateur seul reconnu -> listee ; ni l''un ni l''autre (ou NULL) -> ignoree',
    EXISTS (SELECT 1 FROM public.fn_list_client_versions() WHERE poste_ref = 't10aaaaa' AND site_sync_id = 't10-site-1')
      AND EXISTS (SELECT 1 FROM public.fn_list_client_versions() WHERE poste_ref = 't10bbbbb' AND last_user_sync_id = 't10-user-1')
      AND NOT EXISTS (SELECT 1 FROM public.fn_list_client_versions() WHERE poste_ref IN ('t10ccccc', 't10ddddd')),
    NULL);
  INSERT INTO _t VALUES (5, 'compteurs : +5 total, +2 ignorees, +2 listables, total = preuve + ignorees + listables = lignes de la table',
    c1.nb_total - c0.nb_total = 5 AND c1.nb_ignorees - c0.nb_ignorees = 2 AND c1.nb_listables - c0.nb_listables = 2
      AND c1.nb_total = c1.nb_preuve + c1.nb_ignorees + c1.nb_listables
      AND c1.nb_total = (SELECT count(*) FROM public.t_client_versions),
    format('total=%s preuve=%s ignorees=%s listables=%s', c1.nb_total, c1.nb_preuve, c1.nb_ignorees, c1.nb_listables));

  -- ---------- 6. Colonnes renvoyees et ordre ----------
  INSERT INTO _t VALUES (6, 'colonnes renvoyees conformes (version, horodatages, nb_reports, key_kind) et tri last_seen_at DESC',
    EXISTS (SELECT 1 FROM public.fn_list_client_versions()
             WHERE poste_ref = 't10aaaaa' AND app_version = '2.27.0' AND key_kind = 'publishable'
               AND nb_reports = 1 AND first_seen_at IS NOT NULL AND last_seen_at > NOW())
      AND (SELECT poste_ref FROM public.fn_list_client_versions() LIMIT 1) = 't10aaaaa',
    NULL);

  -- ---------- 7. LIMIT 1000 ----------
  INSERT INTO public.t_client_versions (poste_key, app_version, key_kind, site_sync_id)
  SELECT 't10rempl-' || lpad(g::text, 6, '0'), '0.0.1', 'test', 't10-site-1'
  FROM generate_series(1, 1100) g;
  SELECT count(*) INTO n_cnt FROM public.fn_list_client_versions();
  SELECT nb_listables INTO n_cnt2 FROM public.fn_count_client_versions();
  INSERT INTO _t VALUES (7, 'LIMIT : au plus 1000 lignes renvoyees, nb_listables > 1000 signale la troncature',
    n_cnt = 1000 AND n_cnt2 >= 1102,
    format('renvoyees=%s listables=%s', n_cnt, n_cnt2));
  DELETE FROM public.t_client_versions WHERE poste_key LIKE 't10rempl-%';

  -- ---------- 8-12. Vrai role anon ----------
  SELECT md5(string_agg(v::text, '|' ORDER BY poste_key)) INTO h_avant FROM public.t_client_versions v;
  BEGIN
    PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
    SET LOCAL ROLE anon;
    SELECT count(*) INTO n_cnt FROM public.fn_list_client_versions() WHERE poste_ref IN ('t10aaaaa', 't10bbbbb');
    SELECT nb_ignorees INTO n_cnt2 FROM public.fn_count_client_versions();
    RESET ROLE;
    INSERT INTO _t VALUES (8, 'SET LOCAL ROLE anon : lecture et comptage executables',
      n_cnt = 2 AND n_cnt2 = c1.nb_ignorees, format('lignes_t10=%s ignorees=%s', n_cnt, n_cnt2));
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
    INSERT INTO _t VALUES (8, 'SET LOCAL ROLE anon : lecture et comptage executables', false, 'permission refusee');
  END;
  BEGIN
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO n_cnt FROM public.fn_list_client_versions() WHERE poste_ref = 't10aaaaa';
    RESET ROLE;
    INSERT INTO _t VALUES (9, 'SET LOCAL ROLE authenticated : lecture executable', n_cnt = 1, NULL);
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
    INSERT INTO _t VALUES (9, 'SET LOCAL ROLE authenticated : lecture executable', false, 'permission refusee');
  END;
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM 1 FROM public.t_client_versions LIMIT 1;
    RESET ROLE;
    INSERT INTO _t VALUES (10, 't_client_versions toujours illisible directement pour anon', false, 'SELECT autorise');
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
    INSERT INTO _t VALUES (10, 't_client_versions toujours illisible directement pour anon', true, 'permission refusee (attendu)');
  END;
  BEGIN
    SET LOCAL ROLE anon;
    b := public.fn_report_client_version('t10eeeee-0000-4000-8000-000000000005', '2.26.2');
    RESET ROLE;
    INSERT INTO _t VALUES (11, 'fn_report_client_version toujours FERMEE a anon', false, format('appel accepte ok=%s', b));
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
    INSERT INTO _t VALUES (11, 'fn_report_client_version toujours FERMEE a anon (42501)',
      NOT EXISTS (SELECT 1 FROM public.t_client_versions WHERE poste_key = 't10eeeee-0000-4000-8000-000000000005'),
      'permission refusee (attendu)');
  END;
  PERFORM set_config('request.jwt.claims', '', true);

  -- ---------- 12. Aucune ecriture via la lecture ----------
  SELECT md5(string_agg(v::text, '|' ORDER BY poste_key)) INTO h_apres FROM public.t_client_versions v;
  INSERT INTO _t VALUES (12, 'aucune ecriture via la lecture : table identique apres les appels (empreinte md5), fonctions STABLE',
    h_avant = h_apres
      AND (SELECT bool_and(provolatile = 's') FROM pg_proc
            WHERE oid IN ('public.fn_list_client_versions()'::regprocedure, 'public.fn_count_client_versions()'::regprocedure)),
    NULL);

  -- ---------- 13. Garde STABLE effective : une ecriture dans une fonction STABLE est refusee ----------
  BEGIN
    EXECUTE $f$CREATE FUNCTION pg_temp.t10_stable_ecrit() RETURNS INT LANGUAGE sql STABLE AS
      'UPDATE public.t_client_versions SET nb_reports = nb_reports + 1 WHERE false; SELECT 1'$f$;
    PERFORM pg_temp.t10_stable_ecrit();
    INSERT INTO _t VALUES (13, 'Postgres refuse une ecriture dans une fonction STABLE (garantie utilisee par 0010)', false, 'ecriture acceptee');
  EXCEPTION WHEN others THEN
    INSERT INTO _t VALUES (13, 'Postgres refuse une ecriture dans une fonction STABLE (garantie utilisee par 0010)', true, SQLSTATE);
  END;
END;
$$;

SELECT n, ok, cas, detail FROM _t ORDER BY n;

DO $$
DECLARE
  v_ko TEXT;
BEGIN
  SELECT string_agg(n::text, ', ' ORDER BY n) INTO v_ko FROM _t WHERE ok IS DISTINCT FROM true;
  IF v_ko IS NOT NULL THEN
    RAISE EXCEPTION 'TEST 0010 ECHEC : cas en erreur ou non concluants : %', v_ko;
  END IF;
  RAISE NOTICE 'TEST 0010 OK (% cas)', (SELECT count(*) FROM _t);
END;
$$;

ROLLBACK;
