-- ============================================================
-- Test de supabase/migrations/0007_t_users_super_admin_guard.sql
-- A executer sur le projet DEV uniquement (ajadkziqaskadlzboeqo), apres la
-- migration, dans le SQL Editor (role postgres). Tout se passe dans une
-- transaction ANNULEE (ROLLBACK final) : aucune donnee ne reste en base
-- (comptes de test 't7-*', journal, interrupteur remis a l'identique).
--
-- Autonomie vis-a-vis des policies RLS : les policies du dev peuvent differer
-- de la production. Les cas 1 a 15 simulent donc l'appelant par les seuls
-- reglages PostgREST (request.jwt.claims / request.jwt.claim.role), que lit le
-- garde, en executant le SQL en postgres (proprietaire, hors RLS). Le cas 16
-- rejoue un vrai SET LOCAL ROLE anon : si les droits du dev le refusent, il
-- est marque NON CONCLUANT (ok = NULL) au lieu d'echouer.
-- Non couvert ici : le repli "session_user = 'authenticator' sans claims"
-- (impossible a simuler depuis le SQL Editor ; a verifier par un appel REST
-- reel avec la cle anon, cf. README).
--
-- Resultat : table _t (un cas par ligne, ok = true/false/NULL), puis un bloc
-- qui LEVE UNE ERREUR si un cas vaut false (ok NULL = non concluant, signale
-- par NOTICE). Hash de test fictifs (aucun secret).
-- ============================================================
BEGIN;

CREATE TEMP TABLE _t (n INT, cas TEXT, ok BOOLEAN, detail TEXT) ON COMMIT DROP;

DO $$
DECLARE
  u      public.t_users;
  n_ev   INT;
  n_rows INT;
  v_txt  TEXT;
  v_bool BOOLEAN;
  -- Raccourcis d'appelant (reglages locaux a la transaction)
BEGIN
  -- ---------- 0. Preconditions ----------
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  INSERT INTO _t VALUES (0, 'Preconditions : 5 triggers presents et actifs, garde actif',
    (SELECT count(*) FROM pg_trigger WHERE tgname IN
       ('trg_t_users_sa_guard_ins','trg_t_users_sa_guard_upd','trg_t_users_sa_guard_del',
        'trg_t_user_roles_sa_guard_ins','trg_t_user_roles_sa_guard_upd') AND tgenabled = 'O') = 5
      AND (SELECT enabled FROM public.t_security_guard_config WHERE id = 1),
    NULL);

  -- Comptes de depart, crees en postgres sans claims (appelant de confiance).
  INSERT INTO public.t_users (login, password_hash, role, nom_user, statut_actif, site_id, sync_id) VALUES
    ('t7_sa1', 'HASH_TEST_SA1', 'SUPER ADMIN',      'SA1', 1, NULL, 't7-sa1'),
    ('t7_sa2', 'HASH_TEST_SA2', 'SUPER ADMIN',      'SA2', 1, NULL, 't7-sa2'),
    ('t7_op1', 'HASH_TEST_OP1', 'OPERATEUR_SAISIE', 'OP1', 1, NULL, 't7-op1'),
    ('t7_op2', 'HASH_TEST_OP2', 'OPERATEUR_SAISIE', 'OP2', 1, NULL, 't7-op2'),
    ('t7_op3', 'HASH_TEST_OP3', 'OPERATEUR_SAISIE', 'OP3', 1, NULL, 't7-op3');
  INSERT INTO public.t_user_roles (user_sync_id, role) VALUES
    ('t7-sa1', 'SUPER ADMIN'), ('t7-op1', 'OPERATEUR_SAISIE');
  SELECT count(*) INTO n_ev FROM public.t_security_guard_events WHERE sync_id LIKE 't7-%';
  INSERT INTO _t VALUES (1, 'Creation en postgres sans claims : SA actif, aucun journal',
    (SELECT statut_actif FROM public.t_users WHERE sync_id = 't7-sa1') = 1 AND n_ev = 0,
    format('journal=%s', n_ev));

  -- ---------- Identification de l'appelant ----------
  PERFORM set_config('request.jwt.claims', 'pas du json', true);
  v_txt := public.fn_sa_guard_jwt_role();
  v_bool := public.fn_sa_guard_caller_untrusted();
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.role', 'anon', true);
  INSERT INTO _t VALUES (2, 'jwt_role : JSON illisible -> NULL sans erreur (postgres = fiable) ; repli request.jwt.claim.role',
    v_txt IS NULL AND v_bool = false
      AND public.fn_sa_guard_jwt_role() = 'anon' AND public.fn_sa_guard_caller_untrusted(),
    format('illisible=%s fiable=%s legacy=%s', v_txt, NOT v_bool, public.fn_sa_guard_jwt_role()));
  PERFORM set_config('request.jwt.claim.role', '', true);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  v_bool := public.fn_sa_guard_caller_untrusted();
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated"}', true);
  INSERT INTO _t VALUES (3, 'service_role fiable ; authenticated non fiable',
    v_bool = false AND public.fn_sa_guard_caller_untrusted(), NULL);

  -- ===== A partir d'ici : appelant = cle anon =====
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);

  -- (a) INSERT d'un SA par anon -> quarantaine
  INSERT INTO public.t_users (login, password_hash, role, nom_user, statut_actif, site_id, sync_id)
  VALUES ('t7_sanew', 'HASH_TEST_NEW', 'SUPER ADMIN', 'NEW', 1, NULL, 't7-sanew');
  SELECT * INTO u FROM public.t_users WHERE sync_id = 't7-sanew';
  SELECT count(*) INTO n_ev FROM public.t_security_guard_events WHERE sync_id = 't7-sanew' AND reason = 'SA_INSERT_QUARANTAINE';
  INSERT INTO _t VALUES (4, '(a) INSERT d''un SA par anon : cree en quarantaine (statut 0), journalise',
    u.role = 'SUPER ADMIN' AND u.statut_actif = 0 AND n_ev = 1,
    format('statut=%s journal=%s', u.statut_actif, n_ev));

  -- (b) upsert ON CONFLICT DO UPDATE sur un SA actif existant, meme hash, nom modifie
  INSERT INTO public.t_users (login, password_hash, role, nom_user, statut_actif, site_id, sync_id)
  VALUES ('t7_sa1', 'HASH_TEST_SA1', 'SUPER ADMIN', 'SA1_RENOMME', 1, NULL, 't7-sa1')
  ON CONFLICT (sync_id) DO UPDATE SET
    login = EXCLUDED.login, password_hash = EXCLUDED.password_hash, role = EXCLUDED.role,
    nom_user = EXCLUDED.nom_user, statut_actif = EXCLUDED.statut_actif, site_id = EXCLUDED.site_id;
  SELECT * INTO u FROM public.t_users WHERE sync_id = 't7-sa1';
  SELECT count(*) INTO n_ev FROM public.t_security_guard_events WHERE sync_id = 't7-sa1';
  INSERT INTO _t VALUES (5, '(b) upsert anon d''un SA existant (meme hash) : reste actif, nom mis a jour, aucun journal',
    u.statut_actif = 1 AND u.nom_user = 'SA1_RENOMME' AND u.password_hash = 'HASH_TEST_SA1' AND n_ev = 0,
    format('statut=%s nom=%s journal=%s', u.statut_actif, u.nom_user, n_ev));

  -- (c) elevation d'un OPERATEUR_SAISIE par UPDATE
  UPDATE public.t_users SET role = 'SUPER ADMIN' WHERE sync_id = 't7-op1';
  SELECT * INTO u FROM public.t_users WHERE sync_id = 't7-op1';
  SELECT count(*) INTO n_ev FROM public.t_security_guard_events WHERE sync_id = 't7-op1' AND reason = 'SA_ELEVATION_BLOQUEE';
  INSERT INTO _t VALUES (6, '(c) elevation OPERATEUR_SAISIE -> SA par anon (UPDATE) : role inchange, journalise',
    u.role = 'OPERATEUR_SAISIE' AND u.statut_actif = 1 AND n_ev = 1,
    format('role=%s journal=%s', u.role, n_ev));

  -- (c2) elevation par upsert (role SA sur le sync_id d'un non-SA) : ni elevation, ni desactivation (E1)
  INSERT INTO public.t_users (login, password_hash, role, nom_user, statut_actif, site_id, sync_id)
  VALUES ('t7_op2', 'HASH_TEST_OP2', 'SUPER ADMIN', 'OP2', 1, NULL, 't7-op2')
  ON CONFLICT (sync_id) DO UPDATE SET role = EXCLUDED.role, statut_actif = EXCLUDED.statut_actif;
  SELECT * INTO u FROM public.t_users WHERE sync_id = 't7-op2';
  INSERT INTO _t VALUES (7, '(c2) elevation par upsert ON CONFLICT : role inchange ET compte toujours actif',
    u.role = 'OPERATEUR_SAISIE' AND u.statut_actif = 1,
    format('role=%s statut=%s', u.role, u.statut_actif));

  -- (d) hash + login d'un SA changes par anon
  UPDATE public.t_users SET password_hash = 'HASH_TEST_PIRATE', login = 't7_pirate', nom_user = 'SA1_NOM2'
  WHERE sync_id = 't7-sa1';
  SELECT * INTO u FROM public.t_users WHERE sync_id = 't7-sa1';
  SELECT max(reason) INTO v_txt FROM public.t_security_guard_events WHERE sync_id = 't7-sa1';
  INSERT INTO _t VALUES (8, '(d) hash et login d''un SA changes par anon : inchanges, nom (autre colonne) passe, journalise',
    u.password_hash = 'HASH_TEST_SA1' AND u.login = 't7_sa1' AND u.nom_user = 'SA1_NOM2'
      AND v_txt = 'SA_MODIF_NEUTRALISEE:password_hash,login',
    format('login=%s nom=%s motif=%s', u.login, u.nom_user, v_txt));

  -- (d2) retrogradation d'un SA par anon (E2) : refusee
  UPDATE public.t_users SET role = 'OPERATEUR_SAISIE' WHERE sync_id = 't7-sa1';
  SELECT * INTO u FROM public.t_users WHERE sync_id = 't7-sa1';
  INSERT INTO _t VALUES (9, '(d2) retrogradation d''un SA par anon : role SA conserve (ecart E2)',
    u.role = 'SUPER ADMIN', format('role=%s', u.role));

  -- (e) statut 0 -> 1 bloque (SA en quarantaine) ; 1 -> 0 permis
  UPDATE public.t_users SET statut_actif = 1 WHERE sync_id = 't7-sanew';
  UPDATE public.t_users SET statut_actif = 0 WHERE sync_id = 't7-sa2';
  INSERT INTO _t VALUES (10, '(e) anon : reactivation 0->1 d''un SA bloquee, desactivation 1->0 permise',
    (SELECT statut_actif FROM public.t_users WHERE sync_id = 't7-sanew') = 0
      AND (SELECT statut_actif FROM public.t_users WHERE sync_id = 't7-sa2') = 0,
    NULL);

  -- (f) t_user_roles : role SA pour un non-SA refuse sans erreur ; pour un SA accepte
  INSERT INTO public.t_user_roles (user_sync_id, role) VALUES ('t7-op1', 'SUPER ADMIN')
  ON CONFLICT (user_sync_id, role) DO UPDATE SET role = EXCLUDED.role;
  GET DIAGNOSTICS n_rows = ROW_COUNT;
  UPDATE public.t_user_roles SET role = 'SUPER ADMIN' WHERE user_sync_id = 't7-op1' AND role = 'OPERATEUR_SAISIE';
  INSERT INTO public.t_user_roles (user_sync_id, role) VALUES ('t7-sanew', 'SUPER ADMIN');
  SELECT count(*) INTO n_ev FROM public.t_security_guard_events WHERE sync_id = 't7-op1' AND reason = 'ROLES_SA_REFUSE';
  INSERT INTO _t VALUES (11, '(f) anon : role SA dans t_user_roles pour un non-SA ignore (INSERT 0 ligne, UPDATE annule), accepte pour un SA',
    n_rows = 0
      AND NOT EXISTS (SELECT 1 FROM public.t_user_roles WHERE user_sync_id = 't7-op1' AND role = 'SUPER ADMIN')
      AND EXISTS (SELECT 1 FROM public.t_user_roles WHERE user_sync_id = 't7-op1' AND role = 'OPERATEUR_SAISIE')
      AND EXISTS (SELECT 1 FROM public.t_user_roles WHERE user_sync_id = 't7-sanew' AND role = 'SUPER ADMIN')
      AND n_ev = 2,
    format('lignes_insert=%s journal=%s', n_rows, n_ev));

  -- (i) upsert en lot mixte (2 operateurs + 1 SA) : aucune erreur
  INSERT INTO public.t_users (login, password_hash, role, nom_user, statut_actif, site_id, sync_id) VALUES
    ('t7_lot1', 'HASH_TEST_L1', 'OPERATEUR_SAISIE', 'L1', 1, NULL, 't7-lot1'),
    ('t7_lot2', 'HASH_TEST_L2', 'SUPER ADMIN',      'L2', 1, NULL, 't7-lot2'),
    ('t7_op3',  'HASH_TEST_OP3','OPERATEUR_SAISIE', 'OP3_MAJ', 1, NULL, 't7-op3')
  ON CONFLICT (sync_id) DO UPDATE SET nom_user = EXCLUDED.nom_user, role = EXCLUDED.role, statut_actif = EXCLUDED.statut_actif;
  INSERT INTO _t VALUES (12, '(i) upsert anon en lot mixte : aucune erreur, SA en quarantaine, operateurs intacts',
    (SELECT statut_actif FROM public.t_users WHERE sync_id = 't7-lot1') = 1
      AND (SELECT statut_actif FROM public.t_users WHERE sync_id = 't7-lot2') = 0
      AND (SELECT nom_user FROM public.t_users WHERE sync_id = 't7-op3') = 'OP3_MAJ',
    NULL);

  -- (j) DELETE d'un SA par anon : ignore et journalise ; DELETE d'un non-SA : inchange
  DELETE FROM public.t_users WHERE sync_id = 't7-sa2';
  DELETE FROM public.t_users WHERE sync_id = 't7-lot1';
  SELECT count(*) INTO n_ev FROM public.t_security_guard_events WHERE sync_id = 't7-sa2' AND reason = 'SA_DELETE_IGNORE';
  INSERT INTO _t VALUES (13, '(j) DELETE d''un SA par anon ignore (ligne presente, journal) ; DELETE d''un non-SA effectue',
    EXISTS (SELECT 1 FROM public.t_users WHERE sync_id = 't7-sa2')
      AND NOT EXISTS (SELECT 1 FROM public.t_users WHERE sync_id = 't7-lot1') AND n_ev = 1,
    format('journal=%s', n_ev));

  -- (h) garde desactive : comportement d'avant la migration
  UPDATE public.t_security_guard_config SET enabled = false, updated_at = now() WHERE id = 1;
  UPDATE public.t_users SET password_hash = 'HASH_TEST_SA2_BIS' WHERE sync_id = 't7-sa2';
  v_bool := (SELECT password_hash FROM public.t_users WHERE sync_id = 't7-sa2') = 'HASH_TEST_SA2_BIS';
  UPDATE public.t_security_guard_config SET enabled = true, updated_at = now() WHERE id = 1;
  INSERT INTO _t VALUES (14, '(h) garde desactive (interrupteur) : modification anon du hash d''un SA appliquee',
    v_bool, NULL);

  -- (g) memes gestes en service_role puis en postgres sans claims : appliques
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  UPDATE public.t_users SET role = 'SUPER ADMIN' WHERE sync_id = 't7-op2';
  UPDATE public.t_users SET statut_actif = 1 WHERE sync_id = 't7-sanew';
  UPDATE public.t_users SET password_hash = 'HASH_TEST_SA1_SR', login = 't7_sa1_sr' WHERE sync_id = 't7-sa1';
  INSERT INTO public.t_user_roles (user_sync_id, role) VALUES ('t7-op1', 'SUPER ADMIN');
  PERFORM set_config('request.jwt.claims', '', true);
  UPDATE public.t_users SET password_hash = 'HASH_TEST_SA2_PG' WHERE sync_id = 't7-sa2';
  DELETE FROM public.t_users WHERE sync_id = 't7-lot2';
  INSERT INTO _t VALUES (15, '(g) service_role et postgres : elevation, reactivation, hash/login, role secondaire, DELETE appliques',
    (SELECT role FROM public.t_users WHERE sync_id = 't7-op2') = 'SUPER ADMIN'
      AND (SELECT statut_actif FROM public.t_users WHERE sync_id = 't7-sanew') = 1
      AND (SELECT password_hash FROM public.t_users WHERE sync_id = 't7-sa1') = 'HASH_TEST_SA1_SR'
      AND (SELECT login FROM public.t_users WHERE sync_id = 't7-sa1') = 't7_sa1_sr'
      AND EXISTS (SELECT 1 FROM public.t_user_roles WHERE user_sync_id = 't7-op1' AND role = 'SUPER ADMIN')
      AND (SELECT password_hash FROM public.t_users WHERE sync_id = 't7-sa2') = 'HASH_TEST_SA2_PG'
      AND NOT EXISTS (SELECT 1 FROM public.t_users WHERE sync_id = 't7-lot2'),
    NULL);

  -- (k) le journal ne contient jamais de password_hash
  SELECT count(*) INTO n_ev FROM public.t_security_guard_events
   WHERE sync_id LIKE 't7-%' AND (attempted ? 'password_hash' OR attempted::text LIKE '%HASH_TEST%');
  INSERT INTO _t VALUES (17, '(k) journal : aucune cle password_hash ni valeur de hash',
    n_ev = 0 AND (SELECT count(*) FROM public.t_security_guard_events WHERE sync_id LIKE 't7-%') >= 8,
    format('lignes_fautives=%s total=%s', n_ev,
           (SELECT count(*) FROM public.t_security_guard_events WHERE sync_id LIKE 't7-%')));

  -- (16) vrai role anon (depend des droits/policies du dev : NON CONCLUANT si refuse)
  BEGIN
    PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
    SET LOCAL ROLE anon;
    UPDATE public.t_users SET password_hash = 'HASH_TEST_ANON_REEL' WHERE sync_id = 't7-sa1';
    GET DIAGNOSTICS n_rows = ROW_COUNT;
    RESET ROLE;
    IF n_rows = 0 THEN
      -- RLS du dev sans policy UPDATE pour anon : la ligne n'est pas atteinte.
      INSERT INTO _t VALUES (16, 'SET LOCAL ROLE anon reel', NULL, 'NON CONCLUANT : 0 ligne atteinte (policies du dev)');
    ELSE
      SELECT count(*) INTO n_ev FROM public.t_security_guard_events
       WHERE sync_id = 't7-sa1' AND reason = 'SA_MODIF_NEUTRALISEE:password_hash' AND jwt_role = 'anon';
      INSERT INTO _t VALUES (16, 'SET LOCAL ROLE anon reel : hash d''un SA inchange (trigger SECURITY DEFINER journalise)',
        (SELECT password_hash FROM public.t_users WHERE sync_id = 't7-sa1') = 'HASH_TEST_SA1_SR' AND n_ev = 1,
        format('lignes=%s journal=%s', n_rows, n_ev));
    END IF;
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
    INSERT INTO _t VALUES (16, 'SET LOCAL ROLE anon reel', NULL, 'NON CONCLUANT : droits/policies du dev refusent l''UPDATE anon sur t_users');
  END;

  -- (18) tables du garde illisibles pour anon
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM 1 FROM public.t_security_guard_events LIMIT 1;
    RESET ROLE;
    INSERT INTO _t VALUES (18, 't_security_guard_events illisible pour anon', false, 'SELECT autorise');
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
    INSERT INTO _t VALUES (18, 't_security_guard_events illisible pour anon', true, 'permission refusee (attendu)');
  END;
  BEGIN
    SET LOCAL ROLE anon;
    UPDATE public.t_security_guard_config SET enabled = false WHERE id = 1;
    RESET ROLE;
    INSERT INTO _t VALUES (19, 't_security_guard_config non modifiable par anon', false, 'UPDATE autorise');
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
    INSERT INTO _t VALUES (19, 't_security_guard_config non modifiable par anon', true, 'permission refusee (attendu)');
  END;

  PERFORM set_config('request.jwt.claims', '', true);
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
    RAISE NOTICE 'TEST 0007 : cas non concluants : %', v_nc;
  END IF;
  IF v_ko IS NOT NULL THEN
    RAISE EXCEPTION 'TEST 0007 ECHEC : cas en erreur : %', v_ko;
  END IF;
  RAISE NOTICE 'TEST 0007 OK (% cas)', (SELECT count(*) FROM _t);
END;
$$;

ROLLBACK;
