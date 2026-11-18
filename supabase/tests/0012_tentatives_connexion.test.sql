-- ============================================================
-- Test de supabase/migrations/0012_tentatives_connexion.sql
-- A executer sur le projet DEV uniquement (ajadkziqaskadlzboeqo), apres 0011
-- et 0012, dans le SQL Editor (role postgres). Transaction ANNULEE (ROLLBACK
-- final) : aucune ligne ne reste (logins de test 't12_*').
-- Le temps est simule en modifiant directement bloque_jusqu_a /
-- dernier_echec_at (NOW() est fige dans une transaction).
-- Resultat : table _t, puis un bloc qui LEVE UNE ERREUR si un cas vaut false.
-- NE JAMAIS EXECUTER EN PROD.
-- ============================================================
BEGIN;

CREATE TEMP TABLE _t (n INT, cas TEXT, ok BOOLEAN, detail TEXT) ON COMMIT DROP;

DO $$
DECLARE
  r     JSONB;
  b     BOOLEAN;
  i     INT;
  k     TEXT := public.fn_login_key('t12_agent');
  v_det TEXT;
BEGIN
  PERFORM set_config('request.jwt.claims', '', true);

  -- ---------- 0. Droits ----------
  INSERT INTO _t VALUES (0, 'fn_login_check_and_record / fn_login_unblock / fn_login_key : EXECUTE service_role seulement (ni anon, ni authenticated, ni PUBLIC)',
    has_function_privilege('service_role', 'public.fn_login_check_and_record(text,text)', 'EXECUTE')
      AND NOT has_function_privilege('anon', 'public.fn_login_check_and_record(text,text)', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'public.fn_login_check_and_record(text,text)', 'EXECUTE')
      AND has_function_privilege('service_role', 'public.fn_login_unblock(text)', 'EXECUTE')
      AND NOT has_function_privilege('anon', 'public.fn_login_unblock(text)', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'public.fn_login_unblock(text)', 'EXECUTE')
      AND NOT has_function_privilege('anon', 'public.fn_login_key(text)', 'EXECUTE')
      AND NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
                       WHERE p.oid IN ('public.fn_login_check_and_record(text,text)'::regprocedure,
                                       'public.fn_login_unblock(text)'::regprocedure,
                                       'public.fn_login_key(text)'::regprocedure)
                         AND a.grantee = 0),
    NULL);

  INSERT INTO _t VALUES (1, 't_login_attempts : RLS active, aucune politique, aucun droit anon/authenticated, pas de colonne login en clair',
    (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.t_login_attempts'::regclass)
      AND NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 't_login_attempts')
      AND NOT has_table_privilege('anon', 'public.t_login_attempts', 'SELECT')
      AND NOT has_table_privilege('authenticated', 'public.t_login_attempts', 'SELECT')
      AND NOT has_table_privilege('anon', 'public.t_login_attempts', 'INSERT')
      AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_schema = 'public' AND table_name = 't_login_attempts'
                         AND column_name IN ('login', 'login_user', 'ip', 'ip_address')),
    NULL);

  -- ---------- 2. Login inconnu : autorise ----------
  r := public.fn_login_check_and_record('t12_agent', 'check');
  INSERT INTO _t VALUES (2, 'check sur un login jamais vu : allowed true, aucune ligne creee',
    (r ->> 'allowed')::boolean AND NOT EXISTS (SELECT 1 FROM public.t_login_attempts WHERE login_key = k), r::text);

  -- ---------- 3. 4 echecs : encore autorise ; 5e : blocage 15 min ----------
  b := true;
  FOR i IN 1..4 LOOP
    r := public.fn_login_check_and_record('t12_agent', 'failure');
    b := b AND (r ->> 'allowed')::boolean;
  END LOOP;
  r := public.fn_login_check_and_record('t12_agent', 'check');
  b := b AND (r ->> 'allowed')::boolean;
  r := public.fn_login_check_and_record('t12_agent', 'failure');
  INSERT INTO _t VALUES (3, '4 echecs : toujours autorise ; 5e echec : refus, retry_after_s = 900 (15 min)',
    b AND NOT (r ->> 'allowed')::boolean AND (r ->> 'retry_after_s')::int = 900, r::text);

  -- ---------- 4. Pendant le blocage ----------
  r := public.fn_login_check_and_record('t12_agent', 'check');
  b := NOT (r ->> 'allowed')::boolean AND (r ->> 'retry_after_s')::int BETWEEN 1 AND 900;
  r := public.fn_login_check_and_record('t12_agent', 'failure');
  INSERT INTO _t VALUES (4, 'Pendant le blocage : check refuse ; un echec ne prolonge pas le blocage ni ne compte',
    b AND NOT (r ->> 'allowed')::boolean
      AND (SELECT nb_echecs = 0 AND nb_blocages = 1 AND bloque_jusqu_a = NOW() + INTERVAL '15 minutes'
             FROM public.t_login_attempts WHERE login_key = k), r::text);

  -- ---------- 5. Doublement : 2e blocage = 30 min ----------
  UPDATE public.t_login_attempts SET bloque_jusqu_a = NOW() - INTERVAL '1 second' WHERE login_key = k;
  r := public.fn_login_check_and_record('t12_agent', 'check');
  b := (r ->> 'allowed')::boolean;
  FOR i IN 1..5 LOOP
    r := public.fn_login_check_and_record('t12_agent', 'failure');
  END LOOP;
  INSERT INTO _t VALUES (5, 'Blocage expire : de nouveau autorise ; 5 nouveaux echecs -> 2e blocage de 1800 s (doublement)',
    b AND NOT (r ->> 'allowed')::boolean AND (r ->> 'retry_after_s')::int = 1800, r::text);

  -- ---------- 6. Plafond 24 h ----------
  UPDATE public.t_login_attempts SET bloque_jusqu_a = NOW() - INTERVAL '1 second', nb_blocages = 7 WHERE login_key = k;
  FOR i IN 1..5 LOOP
    r := public.fn_login_check_and_record('t12_agent', 'failure');
  END LOOP;
  v_det := r::text;
  b := NOT (r ->> 'allowed')::boolean AND (r ->> 'retry_after_s')::int = 86400;
  UPDATE public.t_login_attempts SET bloque_jusqu_a = NOW() - INTERVAL '1 second', nb_blocages = 1000 WHERE login_key = k;
  FOR i IN 1..5 LOOP
    r := public.fn_login_check_and_record('t12_agent', 'failure');
  END LOOP;
  INSERT INTO _t VALUES (6, 'Plafond : 15 min x 2^7 et au-dela -> 86400 s (24 h), sans depassement numerique',
    b AND NOT (r ->> 'allowed')::boolean AND (r ->> 'retry_after_s')::int = 86400, v_det || ' / ' || r::text);

  -- ---------- 7. Succes : remise a zero ----------
  UPDATE public.t_login_attempts SET bloque_jusqu_a = NULL, nb_echecs = 3 WHERE login_key = k;
  r := public.fn_login_check_and_record('t12_agent', 'success');
  INSERT INTO _t VALUES (7, 'Succes : ligne supprimee (compteur et doublement remis a zero)',
    (r ->> 'allowed')::boolean AND NOT EXISTS (SELECT 1 FROM public.t_login_attempts WHERE login_key = k), r::text);

  -- ---------- 8. Normalisation du login ----------
  PERFORM public.fn_login_check_and_record('  T12_Agent ', 'failure');
  PERFORM public.fn_login_check_and_record('t12_agent', 'failure');
  INSERT INTO _t VALUES (8, 'Login normalise (casse, espaces) : une seule ligne, 2 echecs ; cle = 64 hex, login absent de la table',
    (SELECT count(*) FROM public.t_login_attempts WHERE login_key = k) = 1
      AND (SELECT nb_echecs FROM public.t_login_attempts WHERE login_key = k) = 2
      AND k ~ '^[0-9a-f]{64}$'
      AND NOT EXISTS (SELECT 1 FROM public.t_login_attempts t WHERE t::text ILIKE '%t12_agent%'),
    NULL);

  -- ---------- 9. Oubli apres 24 h sans echec ----------
  UPDATE public.t_login_attempts SET nb_echecs = 4, nb_blocages = 2, dernier_echec_at = NOW() - INTERVAL '25 hours' WHERE login_key = k;
  r := public.fn_login_check_and_record('t12_agent', 'failure');
  INSERT INTO _t VALUES (9, 'Dernier echec > 24 h et pas de blocage : compteurs oublies, l''echec suivant repart a 1 (pas de blocage)',
    (r ->> 'allowed')::boolean
      AND (SELECT nb_echecs = 1 AND nb_blocages = 0 FROM public.t_login_attempts WHERE login_key = k), r::text);

  -- ---------- 10. Deblocage ----------
  UPDATE public.t_login_attempts SET bloque_jusqu_a = NOW() + INTERVAL '1 hour' WHERE login_key = k;
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","gis_v":1,"gis_is_super_admin":false}', true);
  b := NOT public.fn_login_unblock('t12_agent');
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  b := b AND NOT public.fn_login_unblock('t12_agent');
  b := b AND EXISTS (SELECT 1 FROM public.t_login_attempts WHERE login_key = k);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","gis_v":1,"gis_is_super_admin":true}', true);
  b := b AND public.fn_login_unblock('t12_agent');
  b := b AND NOT EXISTS (SELECT 1 FROM public.t_login_attempts WHERE login_key = k);
  PERFORM public.fn_login_check_and_record('t12_agent', 'failure');
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  b := b AND public.fn_login_unblock('T12_AGENT');
  PERFORM public.fn_login_check_and_record('t12_agent', 'failure');
  PERFORM set_config('request.jwt.claims', '', true);
  b := b AND public.fn_login_unblock('t12_agent');   -- SQL Editor (postgres)
  INSERT INTO _t VALUES (10, 'Deblocage : refuse a authenticated non SA et a anon ; accepte pour SA (claims hook), service_role et SQL Editor',
    b AND NOT EXISTS (SELECT 1 FROM public.t_login_attempts WHERE login_key = k), NULL);

  -- ---------- 11. Entrees invalides ----------
  b := true;
  r := public.fn_login_check_and_record(NULL, 'check');      b := b AND NOT (r ->> 'allowed')::boolean AND (r ->> 'invalid')::boolean;
  r := public.fn_login_check_and_record('   ', 'failure');   b := b AND NOT (r ->> 'allowed')::boolean;
  r := public.fn_login_check_and_record(repeat('a', 129), 'check'); b := b AND NOT (r ->> 'allowed')::boolean;
  r := public.fn_login_check_and_record('t12_agent', 'DROP'); b := b AND NOT (r ->> 'allowed')::boolean;
  r := public.fn_login_check_and_record('t12_agent', NULL);   b := b AND NOT (r ->> 'allowed')::boolean;
  b := b AND NOT public.fn_login_unblock(NULL);
  INSERT INTO _t VALUES (11, 'Entrees invalides (login NULL, vide, > 128, action inconnue ou NULL) : refus sans erreur ni ligne creee',
    b AND NOT EXISTS (SELECT 1 FROM public.t_login_attempts WHERE login_key = public.fn_login_key(repeat('a', 129))), NULL);

  -- ---------- 12. Deux logins independants ----------
  FOR i IN 1..5 LOOP
    PERFORM public.fn_login_check_and_record('t12_autre', 'failure');
  END LOOP;
  r := public.fn_login_check_and_record('t12_agent', 'check');
  INSERT INTO _t VALUES (12, 'Le blocage d''un login n''affecte pas un autre login',
    (r ->> 'allowed')::boolean
      AND NOT (public.fn_login_check_and_record('t12_autre', 'check') ->> 'allowed')::boolean, NULL);
END;
$$;

SELECT n, ok, cas, detail FROM _t ORDER BY n;

DO $$
DECLARE
  v_ko TEXT;
BEGIN
  SELECT string_agg(n::text, ', ' ORDER BY n) INTO v_ko FROM _t WHERE ok IS NOT TRUE;
  IF v_ko IS NOT NULL THEN
    RAISE EXCEPTION 'TEST 0012 ECHEC : cas en erreur : %', v_ko;
  END IF;
  RAISE NOTICE 'TEST 0012 OK (% cas)', (SELECT count(*) FROM _t);
END;
$$;

ROLLBACK;
