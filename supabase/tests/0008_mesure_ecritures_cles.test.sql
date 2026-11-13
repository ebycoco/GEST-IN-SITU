-- ============================================================
-- Test de supabase/migrations/0008_mesure_ecritures_cles.sql
-- A executer sur le projet DEV uniquement (ajadkziqaskadlzboeqo), apres la
-- migration, dans le SQL Editor (role postgres). Tout se passe dans une
-- transaction ANNULEE (ROLLBACK final) : aucune donnee ne reste en base
-- (site/cartes/comptes de test 't8-*', compteurs, interrupteur).
--
-- Les cas 1 a 14 simulent l'appelant par les reglages PostgREST
-- (request.jwt.claims, request.headers) en postgres. Le cas 15 rejoue un vrai
-- SET LOCAL ROLE anon (politiques allow_all du dev aligne sur la prod) : si
-- les droits du dev le refusent, il est marque NON CONCLUANT (ok = NULL).
-- Cas 20 a 25 (reserves de l'audit agent-9, 2026-11-13) : ecriture gardee par
-- 0006, ecritures ignorees par 0007 (R5/R6), restauration du lock_timeout de
-- l'appelant, refus authenticated et TRUNCATE, anon sans claims = autre.
-- Non couvert ici : la contention entre deux sessions concurrentes (une seule
-- session dans un test SQL) -> essai reel par appels REST paralleles, cf. plan.
--
-- Les compteurs sont lus par cle "table_name LIKE + client_info de test"
-- (x-client-info 't8-...') pour ne pas dependre des compteurs deja presents.
-- Resultat : table _t (un cas par ligne), puis un bloc qui LEVE UNE ERREUR si
-- un cas vaut false. Valeurs de claims fictives (aucun secret).
-- ============================================================
BEGIN;

CREATE TEMP TABLE _t (n INT, cas TEXT, ok BOOLEAN, detail TEXT) ON COMMIT DROP;

DO $$
DECLARE
  a      public.t_write_audit;
  n_rows INT;
  n_rows2 INT;
  n_cnt  INT;
  n_cnt2 INT;
  v_txt  TEXT;
  v_site BIGINT;
BEGIN
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  PERFORM set_config('request.headers', '', true);

  -- ---------- 0. Preconditions ----------
  INSERT INTO _t VALUES (0, 'Preconditions : 24 triggers STATEMENT actifs, mesure active, fonction SECURITY DEFINER, classe dans la cle primaire',
    (SELECT count(*) FROM pg_trigger t
       WHERE t.tgname LIKE 'trg\_wa\_%' AND t.tgenabled = 'O'
         AND t.tgfoid = 'public.fn_write_audit_stmt()'::regprocedure) = 24
      AND (SELECT enabled FROM public.t_write_audit_config WHERE id = 1)
      AND (SELECT prosecdef FROM pg_proc WHERE oid = 'public.fn_write_audit_stmt()'::regprocedure)
      AND EXISTS (SELECT 1 FROM pg_constraint c
                  JOIN pg_attribute att ON att.attrelid = c.conrelid AND att.attnum = ANY (c.conkey)
                  WHERE c.conrelid = 'public.t_write_audit'::regclass AND c.contype = 'p'
                    AND att.attname = 'classe'),
    format('triggers=%s', (SELECT count(*) FROM pg_trigger WHERE tgname LIKE 'trg\_wa\_%')));

  -- Site de test cree en postgres sans claims (compte en classe postgres).
  PERFORM set_config('request.headers', '{"x-client-info":"t8-pg"}', true);
  INSERT INTO public.t_sites (nom, code, sync_id) VALUES ('SITE TEST 0008', 'T0008', 't8-site')
  RETURNING id INTO v_site;
  SELECT * INTO a FROM public.t_write_audit
   WHERE client_info = 't8-pg' AND table_name = 't_sites' AND op = 'INSERT';
  INSERT INTO _t VALUES (1, 'postgres sans claims : classe postgres, jwt_role vide, claim_keys vide',
    a.classe = 'postgres' AND a.jwt_role = '' AND a.claim_keys = '' AND a.nb_lignes = 1 AND a.nb_instructions = 1,
    format('classe=%s role=%s keys=%s lignes=%s', a.classe, a.jwt_role, a.claim_keys, a.nb_lignes));

  -- ===== Cle publishable : {"role":"anon"} seul =====
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  PERFORM set_config('request.headers', '{"x-client-info":"t8-pub"}', true);

  INSERT INTO public.t_cartes (sync_id, noms, prenoms, statut, id_site) VALUES
    ('t8-c1', 'C1', 'X', 'EN STOCK', v_site),
    ('t8-c2', 'C2', 'X', 'EN STOCK', v_site),
    ('t8-c3', 'C3', 'X', 'EN STOCK', v_site);
  SELECT * INTO a FROM public.t_write_audit
   WHERE client_info = 't8-pub' AND table_name = 't_cartes' AND op = 'INSERT';
  INSERT INTO _t VALUES (2, 'publishable : INSERT de 3 cartes -> classe publishable, 1 instruction, 3 lignes, claim_keys = role',
    a.classe = 'publishable' AND a.jwt_role = 'anon' AND a.claim_keys = 'role'
      AND a.nb_instructions = 1 AND a.nb_lignes = 3,
    format('classe=%s instr=%s lignes=%s keys=%s', a.classe, a.nb_instructions, a.nb_lignes, a.claim_keys));

  -- Upsert ON CONFLICT DO UPDATE : 3 existantes + 1 nouvelle
  INSERT INTO public.t_cartes (sync_id, noms, prenoms, statut, id_site) VALUES
    ('t8-c1', 'C1b', 'X', 'EN STOCK', v_site),
    ('t8-c2', 'C2b', 'X', 'EN STOCK', v_site),
    ('t8-c3', 'C3b', 'X', 'EN STOCK', v_site),
    ('t8-c4', 'C4',  'X', 'EN STOCK', v_site)
  ON CONFLICT (sync_id) DO UPDATE SET noms = EXCLUDED.noms;
  INSERT INTO _t VALUES (3, 'upsert 3 existantes + 1 nouvelle : INSERT +1 instr/+1 ligne, UPDATE 1 instr/3 lignes',
    (SELECT nb_instructions = 2 AND nb_lignes = 4 FROM public.t_write_audit
      WHERE client_info = 't8-pub' AND table_name = 't_cartes' AND op = 'INSERT')
      AND (SELECT nb_instructions = 1 AND nb_lignes = 3 FROM public.t_write_audit
      WHERE client_info = 't8-pub' AND table_name = 't_cartes' AND op = 'UPDATE'),
    NULL);

  -- Instructions a 0 ligne : upsert DO NOTHING tout en conflit, UPDATE sans cible, DELETE sans cible
  INSERT INTO public.t_cartes (sync_id, noms, prenoms, statut, id_site)
  VALUES ('t8-c1', 'C1', 'X', 'EN STOCK', v_site) ON CONFLICT (sync_id) DO NOTHING;
  UPDATE public.t_cartes SET noms = 'RIEN' WHERE sync_id = 't8-inexistant';
  DELETE FROM public.t_cartes WHERE sync_id = 't8-inexistant';
  SELECT count(*) INTO n_cnt FROM public.t_write_audit WHERE client_info = 't8-pub' AND table_name = 't_cartes';
  INSERT INTO _t VALUES (4, 'instructions a 0 ligne (DO NOTHING, UPDATE/DELETE sans cible) : aucun compteur ecrit ni incremente',
    n_cnt = 2
      AND (SELECT nb_instructions FROM public.t_write_audit
            WHERE client_info = 't8-pub' AND table_name = 't_cartes' AND op = 'INSERT') = 2
      AND (SELECT nb_instructions FROM public.t_write_audit
            WHERE client_info = 't8-pub' AND table_name = 't_cartes' AND op = 'UPDATE') = 1,
    format('compteurs=%s', n_cnt));

  -- DELETE de 2 cartes
  DELETE FROM public.t_cartes WHERE sync_id IN ('t8-c3', 't8-c4');
  SELECT * INTO a FROM public.t_write_audit
   WHERE client_info = 't8-pub' AND table_name = 't_cartes' AND op = 'DELETE';
  INSERT INTO _t VALUES (5, 'DELETE de 2 cartes : op DELETE, 2 lignes, classe publishable',
    a.nb_lignes = 2 AND a.nb_instructions = 1 AND a.classe = 'publishable',
    format('lignes=%s', a.nb_lignes));

  -- ===== JWT legacy simule (valeurs fictives) =====
  PERFORM set_config('request.jwt.claims',
    '{"iss":"VAL_ISS_T8","ref":"VAL_REF_T8","role":"anon","iat":1111111111,"exp":2222222222}', true);
  PERFORM set_config('request.headers', '{"x-client-info":"t8-leg"}', true);
  UPDATE public.t_cartes SET noms = 'C1c' WHERE sync_id = 't8-c1';
  SELECT * INTO a FROM public.t_write_audit WHERE client_info = 't8-leg' AND table_name = 't_cartes' AND op = 'UPDATE';
  INSERT INTO _t VALUES (6, 'JWT legacy simule (iss, ref, iat, exp) : classe legacy_suppose, claim_keys tries',
    a.classe = 'legacy_suppose' AND a.claim_keys = 'exp,iat,iss,ref,role' AND a.nb_lignes = 1,
    format('classe=%s keys=%s', a.classe, a.claim_keys));

  -- anon avec iss mais sans ref : autre
  PERFORM set_config('request.jwt.claims', '{"iss":"VAL_ISS_T8","role":"anon"}', true);
  PERFORM set_config('request.headers', '{"x-client-info":"t8-autre"}', true);
  UPDATE public.t_cartes SET noms = 'C1d' WHERE sync_id = 't8-c1';
  SELECT classe INTO v_txt FROM public.t_write_audit WHERE client_info = 't8-autre' AND table_name = 't_cartes';
  INSERT INTO _t VALUES (7, 'anon avec iss incomplet (sans ref/iat/exp) : classe autre',
    v_txt = 'autre', format('classe=%s', v_txt));

  -- authenticated
  PERFORM set_config('request.jwt.claims',
    '{"role":"authenticated","sub":"VAL_SUB_T8","aud":"authenticated","iss":"VAL_ISS_T8","exp":2222222222}', true);
  PERFORM set_config('request.headers', '{"x-client-info":"t8-auth"}', true);
  INSERT INTO public.t_users (login, password_hash, role, nom_user, statut_actif, sync_id, site_id)
  VALUES ('t8_u1', 'HASH_TEST_T8', 'OPERATEUR_SAISIE', 'U1', 1, 't8-u1', v_site);
  SELECT * INTO a FROM public.t_write_audit WHERE client_info = 't8-auth' AND table_name = 't_users' AND op = 'INSERT';
  INSERT INTO _t VALUES (8, 'authenticated : INSERT t_users -> classe authenticated',
    a.classe = 'authenticated' AND a.jwt_role = 'authenticated' AND a.nb_lignes = 1,
    format('classe=%s keys=%s', a.classe, a.claim_keys));

  -- service_role
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  PERFORM set_config('request.headers', '{"x-client-info":"t8-sr"}', true);
  INSERT INTO public.t_user_roles (user_sync_id, role) VALUES ('t8-u1', 'OPERATEUR_SAISIE');
  UPDATE public.t_users SET nom_user = 'U1b' WHERE sync_id = 't8-u1';
  INSERT INTO _t VALUES (9, 'service_role : INSERT t_user_roles + UPDATE t_users -> classe service_role',
    (SELECT classe FROM public.t_write_audit WHERE client_info = 't8-sr' AND table_name = 't_user_roles' AND op = 'INSERT') = 'service_role'
      AND (SELECT classe FROM public.t_write_audit WHERE client_info = 't8-sr' AND table_name = 't_users' AND op = 'UPDATE') = 'service_role',
    NULL);

  -- Repli request.jwt.claim.role (claims vides) + JSON illisible : aucune erreur
  PERFORM set_config('request.jwt.claims', 'pas du json', true);
  PERFORM set_config('request.headers', 'pas du json non plus', true);
  INSERT INTO public.t_logs (action, sync_id) VALUES ('T8_LOG', 't8-log1');
  GET DIAGNOSTICS n_rows = ROW_COUNT;
  SELECT classe INTO v_txt FROM public.t_write_audit
   WHERE table_name = 't_logs' AND op = 'INSERT' AND client_info = '' AND claim_keys = ''
     AND derniere_vue = NOW();
  INSERT INTO _t VALUES (10, 'claims et en-tetes illisibles : ecriture metier faite, compteur ecrit, aucune erreur',
    n_rows = 1 AND v_txt IS NOT NULL, format('classe=%s', v_txt));

  -- client_info borne : 64 caracteres, caracteres speciaux remplaces
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  PERFORM set_config('request.headers',
    json_build_object('x-client-info', 't8-long<b>' || repeat('x', 200))::text, true);
  INSERT INTO public.t_logs (action, sync_id) VALUES ('T8_LOG', 't8-log2');
  SELECT client_info INTO v_txt FROM public.t_write_audit
   WHERE table_name = 't_logs' AND client_info LIKE 't8-long%';
  INSERT INTO _t VALUES (11, 'x-client-info borne a 64 caracteres, sans < >',
    length(v_txt) = 64 AND v_txt !~ '[<>]', format('longueur=%s', length(v_txt)));

  -- Aucune valeur de claim stockee (hors role)
  SELECT count(*) INTO n_cnt FROM public.t_write_audit a2
   WHERE a2::text LIKE '%VAL\_%' OR a2::text LIKE '%1111111111%' OR a2::text LIKE '%2222222222%';
  INSERT INTO _t VALUES (12, 'aucune valeur de claim (iss, ref, sub, iat, exp) stockee',
    n_cnt = 0, format('lignes_fautives=%s', n_cnt));

  -- Interrupteur coupe : rien n'est compte ; puis remis
  PERFORM set_config('request.headers', '{"x-client-info":"t8-off"}', true);
  UPDATE public.t_write_audit_config SET enabled = false, updated_at = now() WHERE id = 1;
  UPDATE public.t_cartes SET noms = 'OFF' WHERE sync_id = 't8-c1';
  GET DIAGNOSTICS n_rows = ROW_COUNT;
  UPDATE public.t_write_audit_config SET enabled = true, updated_at = now() WHERE id = 1;
  SELECT count(*) INTO n_cnt FROM public.t_write_audit WHERE client_info = 't8-off';
  INSERT INTO _t VALUES (13, 'interrupteur coupe : ecriture metier faite, aucun compteur',
    n_rows = 1 AND n_cnt = 0, format('lignes=%s compteurs=%s', n_rows, n_cnt));

  -- Erreur interne du compteur : jamais remontee au poste
  ALTER TABLE public.t_write_audit ADD CONSTRAINT t8_force_echec CHECK (nb_lignes < 0) NOT VALID;
  PERFORM set_config('request.headers', '{"x-client-info":"t8-err"}', true);
  INSERT INTO public.t_cartes (sync_id, noms, prenoms, statut, id_site)
  VALUES ('t8-c5', 'C5', 'X', 'EN STOCK', v_site);
  GET DIAGNOSTICS n_rows = ROW_COUNT;
  ALTER TABLE public.t_write_audit DROP CONSTRAINT t8_force_echec;
  SELECT count(*) INTO n_cnt FROM public.t_write_audit WHERE client_info = 't8-err';
  INSERT INTO _t VALUES (14, 'echec force de l''ecriture du compteur : carte inseree, aucune erreur, compteur perdu',
    n_rows = 1 AND EXISTS (SELECT 1 FROM public.t_cartes WHERE sync_id = 't8-c5') AND n_cnt = 0,
    format('lignes=%s compteurs=%s', n_rows, n_cnt));

  -- (15) vrai role anon : ecriture + compteur via SECURITY DEFINER
  BEGIN
    PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
    PERFORM set_config('request.headers', '{"x-client-info":"t8-anonreel"}', true);
    SET LOCAL ROLE anon;
    UPDATE public.t_cartes SET noms = 'ANON' WHERE sync_id IN ('t8-c1', 't8-c2');
    GET DIAGNOSTICS n_rows = ROW_COUNT;
    RESET ROLE;
    IF n_rows = 0 THEN
      INSERT INTO _t VALUES (15, 'SET LOCAL ROLE anon reel', NULL, 'NON CONCLUANT : 0 ligne atteinte (policies du dev)');
    ELSE
      SELECT * INTO a FROM public.t_write_audit WHERE client_info = 't8-anonreel' AND table_name = 't_cartes' AND op = 'UPDATE';
      INSERT INTO _t VALUES (15, 'SET LOCAL ROLE anon reel : UPDATE 2 cartes compte (publishable, 2 lignes)',
        n_rows = 2 AND a.classe = 'publishable' AND a.nb_lignes = 2,
        format('lignes=%s classe=%s compteur=%s', n_rows, a.classe, a.nb_lignes));
    END IF;
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
    INSERT INTO _t VALUES (15, 'SET LOCAL ROLE anon reel', NULL, 'NON CONCLUANT : droits du dev refusent l''UPDATE anon');
  END;

  -- (16)(17) tables de mesure illisibles / non modifiables par anon
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM 1 FROM public.t_write_audit LIMIT 1;
    RESET ROLE;
    INSERT INTO _t VALUES (16, 't_write_audit illisible pour anon', false, 'SELECT autorise');
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
    INSERT INTO _t VALUES (16, 't_write_audit illisible pour anon', true, 'permission refusee (attendu)');
  END;
  BEGIN
    SET LOCAL ROLE anon;
    UPDATE public.t_write_audit_config SET enabled = false WHERE id = 1;
    RESET ROLE;
    INSERT INTO _t VALUES (17, 't_write_audit_config non modifiable par anon', false, 'UPDATE autorise');
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
    INSERT INTO _t VALUES (17, 't_write_audit_config non modifiable par anon', true, 'permission refusee (attendu)');
  END;

  -- (18) droits : aucun privilege anon/authenticated sur les tables ni EXECUTE sur les fonctions
  INSERT INTO _t VALUES (18, 'aucun droit anon/authenticated sur t_write_audit(_config) ni EXECUTE sur fn_write_audit_*',
    NOT has_table_privilege('anon', 'public.t_write_audit', 'SELECT,INSERT,UPDATE,DELETE')
      AND NOT has_table_privilege('authenticated', 'public.t_write_audit', 'SELECT,INSERT,UPDATE,DELETE')
      AND NOT has_table_privilege('anon', 'public.t_write_audit_config', 'SELECT,INSERT,UPDATE,DELETE')
      AND NOT has_function_privilege('anon', 'public.fn_write_audit_stmt()', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'public.fn_write_audit_stmt()', 'EXECUTE')
      AND NOT has_function_privilege('anon', 'public.fn_write_audit_classe()', 'EXECUTE'),
    NULL);

  -- (19) cascade : DELETE d'un compte compte aussi la suppression en cascade de t_user_roles
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  PERFORM set_config('request.headers', '{"x-client-info":"t8-casc"}', true);
  DELETE FROM public.t_users WHERE sync_id = 't8-u1';
  INSERT INTO _t VALUES (19, 'DELETE t_users : compte t_users DELETE 1 ligne et t_user_roles DELETE (cascade) 1 ligne',
    (SELECT nb_lignes FROM public.t_write_audit WHERE client_info = 't8-casc' AND table_name = 't_users' AND op = 'DELETE') = 1
      AND (SELECT nb_lignes FROM public.t_write_audit WHERE client_info = 't8-casc' AND table_name = 't_user_roles' AND op = 'DELETE') = 1,
    NULL);

  -- ===== Reserves P2-4 / P1-3 de l'audit agent-9 (cas 20 a 25) =====

  -- (20) ecriture t_cartes gardee par 0006 (retour EN STOCK d'une carte DELIVRE,
  -- evenement plus ancien) : la ligne est ecrite (bloc statut repris d'OLD),
  -- le compteur suit les lignes reellement ecrites (ROW_COUNT).
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  PERFORM set_config('request.headers', '{"x-client-info":"t8-g06i"}', true);
  INSERT INTO public.t_cartes (sync_id, noms, prenoms, statut, date_delivrance, agent_distributeur, id_site)
  VALUES ('t8-g1', 'G1', 'X', 'DELIVRE', '2026-10-27T09:00:00Z', 'AGENT_T8', v_site);
  PERFORM set_config('request.headers', '{"x-client-info":"t8-g06"}', true);
  UPDATE public.t_cartes SET statut = 'EN STOCK', date_delivrance = NULL, agent_distributeur = NULL
   WHERE sync_id = 't8-g1';
  GET DIAGNOSTICS n_rows = ROW_COUNT;
  SELECT statut INTO v_txt FROM public.t_cartes WHERE sync_id = 't8-g1';
  SELECT * INTO a FROM public.t_write_audit WHERE client_info = 't8-g06' AND table_name = 't_cartes' AND op = 'UPDATE';
  INSERT INTO _t VALUES (20, 'ecriture gardee par 0006 : statut conserve DELIVRE, compteur = lignes reellement ecrites',
    v_txt = 'DELIVRE' AND n_rows = 1 AND a.nb_lignes = n_rows AND a.nb_instructions = 1 AND a.classe = 'publishable',
    format('statut=%s row_count=%s compteur=%s', v_txt, n_rows, a.nb_lignes));

  -- (21) ecritures ignorees par 0007 (RETURN NULL) : rien n'est compte pour elles.
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.headers', '{"x-client-info":"t8-g07pg"}', true);
  INSERT INTO public.t_users (login, password_hash, role, nom_user, statut_actif, sync_id, site_id) VALUES
    ('t8_sa', 'HASH_TEST_T8', 'SUPER ADMIN', 'SA T8', 1, 't8-sa', v_site),
    ('t8_u2', 'HASH_TEST_T8', 'OPERATEUR_SAISIE', 'U2', 1, 't8-u2', v_site),
    ('t8_u3', 'HASH_TEST_T8', 'OPERATEUR_SAISIE', 'U3', 1, 't8-u3', v_site);
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  -- R5 seul : DELETE d'un SA -> 0 ligne -> aucun compteur
  PERFORM set_config('request.headers', '{"x-client-info":"t8-g07d0"}', true);
  DELETE FROM public.t_users WHERE sync_id = 't8-sa';
  GET DIAGNOSTICS n_rows = ROW_COUNT;
  SELECT count(*) INTO n_cnt FROM public.t_write_audit WHERE client_info = 't8-g07d0';
  -- R5 melange : DELETE SA + non-SA -> 1 ligne ecrite -> compteur 1
  PERFORM set_config('request.headers', '{"x-client-info":"t8-g07d1"}', true);
  DELETE FROM public.t_users WHERE sync_id IN ('t8-sa', 't8-u2');
  GET DIAGNOSTICS n_cnt2 = ROW_COUNT;
  -- R6 : INSERT t_user_roles 'SUPER ADMIN' pour un non-SA -> 0 ligne -> aucun compteur
  PERFORM set_config('request.headers', '{"x-client-info":"t8-g07r"}', true);
  INSERT INTO public.t_user_roles (user_sync_id, role) VALUES ('t8-u3', 'SUPER ADMIN');
  GET DIAGNOSTICS n_rows2 = ROW_COUNT;
  INSERT INTO _t VALUES (21, 'ecritures ignorees par 0007 (R5 DELETE SA, R6 role SA) : 0 ligne comptee ; DELETE mixte : 1 ligne',
    n_rows = 0 AND n_cnt = 0
      AND n_cnt2 = 1
      AND (SELECT nb_lignes FROM public.t_write_audit WHERE client_info = 't8-g07d1' AND table_name = 't_users' AND op = 'DELETE') = 1
      AND n_rows2 = 0
      AND NOT EXISTS (SELECT 1 FROM public.t_write_audit WHERE client_info = 't8-g07r')
      AND EXISTS (SELECT 1 FROM public.t_users WHERE sync_id = 't8-sa'),
    format('R5 seul=%s/%s compteurs, mixte=%s, R6=%s', n_rows, n_cnt, n_cnt2, n_rows2));

  -- (22) lock_timeout de l'appelant restaure apres une ecriture (SET de fonction)
  PERFORM set_config('lock_timeout', '7s', true);
  PERFORM set_config('request.headers', '{"x-client-info":"t8-lt"}', true);
  UPDATE public.t_cartes SET noms = 'LT' WHERE sync_id = 't8-c1';
  SELECT current_setting('lock_timeout') INTO v_txt;
  INSERT INTO _t VALUES (22, 'lock_timeout appelant (7s) restaure apres le trigger (200ms limite a la fonction)',
    v_txt = '7s' AND EXISTS (SELECT 1 FROM public.t_write_audit WHERE client_info = 't8-lt'),
    format('lock_timeout apres=%s', v_txt));
  PERFORM set_config('lock_timeout', '0', true);

  -- (23) authenticated refuse aussi sur t_write_audit_config et t_write_audit
  BEGIN
    SET LOCAL ROLE authenticated;
    UPDATE public.t_write_audit_config SET enabled = false WHERE id = 1;
    RESET ROLE;
    INSERT INTO _t VALUES (23, 't_write_audit_config non modifiable par authenticated', false, 'UPDATE autorise');
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
    BEGIN
      SET LOCAL ROLE authenticated;
      PERFORM 1 FROM public.t_write_audit LIMIT 1;
      RESET ROLE;
      INSERT INTO _t VALUES (23, 't_write_audit illisible par authenticated', false, 'SELECT autorise');
    EXCEPTION WHEN insufficient_privilege THEN
      RESET ROLE;
      INSERT INTO _t VALUES (23, 'authenticated : t_write_audit_config non modifiable, t_write_audit illisible (reel + catalogue)',
        NOT has_table_privilege('authenticated', 'public.t_write_audit_config', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
          AND NOT has_table_privilege('authenticated', 'public.t_write_audit', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'),
        'permission refusee (attendu)');
    END;
  END;

  -- (24) TRUNCATE refuse a anon et authenticated (catalogue + essai reel)
  BEGIN
    SET LOCAL ROLE anon;
    TRUNCATE public.t_write_audit;
    RESET ROLE;
    INSERT INTO _t VALUES (24, 'TRUNCATE t_write_audit refuse a anon', false, 'TRUNCATE autorise');
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
    BEGIN
      SET LOCAL ROLE authenticated;
      TRUNCATE public.t_write_audit_config;
      RESET ROLE;
      INSERT INTO _t VALUES (24, 'TRUNCATE t_write_audit_config refuse a authenticated', false, 'TRUNCATE autorise');
    EXCEPTION WHEN insufficient_privilege THEN
      RESET ROLE;
      INSERT INTO _t VALUES (24, 'TRUNCATE refuse a anon/authenticated sur t_write_audit et t_write_audit_config',
        NOT has_table_privilege('anon', 'public.t_write_audit', 'TRUNCATE')
          AND NOT has_table_privilege('authenticated', 'public.t_write_audit', 'TRUNCATE')
          AND NOT has_table_privilege('anon', 'public.t_write_audit_config', 'TRUNCATE')
          AND NOT has_table_privilege('authenticated', 'public.t_write_audit_config', 'TRUNCATE'),
        'permission refusee (attendu)');
    END;
  END;

  -- (25) role anon SANS claims lisibles (repli request.jwt.claim.role) : classe autre, plus publishable
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.role', 'anon', true);
  PERFORM set_config('request.headers', '{"x-client-info":"t8-noclaims"}', true);
  UPDATE public.t_cartes SET noms = 'NC' WHERE sync_id = 't8-c1';
  SELECT * INTO a FROM public.t_write_audit WHERE client_info = 't8-noclaims' AND table_name = 't_cartes' AND op = 'UPDATE';
  INSERT INTO _t VALUES (25, 'anon sans claims lisibles : classe autre (jwt_role anon, claim_keys vide)',
    a.classe = 'autre' AND a.jwt_role = 'anon' AND a.claim_keys = '' AND public.fn_write_audit_classe() = 'autre',
    format('classe=%s role=%s keys=%s', a.classe, a.jwt_role, a.claim_keys));
  PERFORM set_config('request.jwt.claim.role', '', true);

  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.headers', '', true);
END;
$$;

SELECT n, ok, cas, detail FROM _t ORDER BY n;

-- Assertion finale : leve une erreur si un cas a echoue.
DO $$
DECLARE
  v_ko TEXT;
  v_nc TEXT;
BEGIN
  SELECT string_agg(n::text, ', ' ORDER BY n) INTO v_ko FROM _t WHERE ok = false;
  SELECT string_agg(n::text, ', ' ORDER BY n) INTO v_nc FROM _t WHERE ok IS NULL;
  IF v_nc IS NOT NULL THEN
    RAISE NOTICE 'TEST 0008 : cas non concluants : %', v_nc;
  END IF;
  IF v_ko IS NOT NULL THEN
    RAISE EXCEPTION 'TEST 0008 ECHEC : cas en erreur : %', v_ko;
  END IF;
  RAISE NOTICE 'TEST 0008 OK (% cas)', (SELECT count(*) FROM _t);
END;
$$;

ROLLBACK;
