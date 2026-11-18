-- ============================================================
-- Test de supabase/migrations/0013_rls_authenticated_par_site.sql
-- A executer sur le projet DEV uniquement (ajadkziqaskadlzboeqo), apres
-- 0011 et 0013, dans le SQL Editor (role postgres). Transaction ANNULEE
-- (ROLLBACK final) : aucune ligne ne reste (sites, centres, postes,
-- comptes, roles, cartes, logs, presences 't13*', fonctions d'aide
-- public._t13_*, compteurs 0008, journal 0007).
--
-- Methode : vrais changements de role (SET LOCAL ROLE authenticated / anon /
-- service_role, comme PostgREST) + claims simulees dans request.jwt.claims.
-- La RLS et les privileges sont donc reellement appliques.
-- Profils : agent du site A (operateur), ADMINISTRATEUR_SITE du site A,
-- agent du site B, SUPER ADMIN (sans site), authenticated SANS claims gis_*,
-- authenticated avec claims gis_* mais sans gis_v (forge), anon (cle
-- publishable et sans claims), service_role.
--
-- Empilement reel (adaptation du 2026-11-18, agent-4) : ce test s'execute
-- sur l'etat REEL du dev, 0013 + 0014 (+ 0015) en place ; les politiques
-- r14_* ne sont PAS retirees. 0014 reserve les ecritures de t_sites au SUPER
-- ADMIN et celles de t_centres / t_postes au SUPER ADMIN ou a
-- l'ADMINISTRATEUR_SITE de son site. Donc :
--   - tables metier (t_cartes, t_logs, t_users, t_user_roles,
--     t_user_presence) : toujours testees avec l'OPERATEUR du site A (filtre
--     par site seulement, Q4) ;
--   - ecritures de hierarchie (t_centres, t_postes) sur SON site et HORS de
--     son site : testees avec l'ADMINISTRATEUR_SITE du site A, pour que le
--     refus hors site prouve le filtre PAR SITE de 0013 (et non le seul filtre
--     par role de 0014) ;
--   - t_sites : la ligne de SON site n'est plus modifiable que par le SUPER
--     ADMIN (0014) : attente ajustee a 0 ligne pour l'operateur ET
--     l'administrateur de site (cas 6) ; le refus hors site reste teste
--     (cas 8) ;
--   - l'operateur A ne cree plus ni poste ni centre sur son site (0014,
--     42501) : verifie au cas 6.
-- Empilement 0016 (adaptation du 2026-11-18, agent-4) : un operateur ne cree
-- plus de compte ni de role ; au cas 5, le compte 't13-u-a2' et son role sont
-- crees par l'ADMINISTRATEUR_SITE A ; au cas 7, la creation d'un compte du
-- site B et d'un role pour un compte B sont refusees (42501) par la RLS ET par
-- le trigger 0016 (qui passe avant le WITH CHECK : seul le code 42501 est
-- attendu, plus le texte « rls »).
-- Les profils administrateur n'ont pas de ligne t_users (les politiques ne
-- lisent que les claims) : les comptages des cas 3, 11 et 12 sont inchanges.
-- Les comptages ne portent que sur les lignes de test (sync_id 't13-%').
-- Resultat : table _t, puis un bloc qui LEVE UNE ERREUR si un cas vaut false.
-- NE JAMAIS EXECUTER EN PROD.
-- ============================================================
BEGIN;

CREATE TEMP TABLE _t (n INT, cas TEXT, ok BOOLEAN, detail TEXT) ON COMMIT DROP;

-- Aides (SECURITY INVOKER : s'executent avec le role courant ; supprimees
-- par le ROLLBACK final).
CREATE FUNCTION public._t13_try(p_sql TEXT) RETURNS TEXT
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

CREATE FUNCTION public._t13_n(p_sql TEXT) RETURNS BIGINT
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

DO $$
DECLARE
  v_sa BIGINT; v_sb BIGINT; v_ca BIGINT; v_cb BIGINT; v_pa BIGINT; v_pb BIGINT;
  c_a   TEXT;  -- claims agent site A
  c_b   TEXT;  -- claims agent site B
  c_sa  TEXT;  -- claims SUPER ADMIN
  c_nog TEXT := '{"role":"authenticated","aud":"authenticated","sub":"00000000-0000-0000-0000-000000000013"}';
  c_forge TEXT; -- claims gis_* sans gis_v
  c_adm_a TEXT; -- claims ADMINISTRATEUR_SITE du site A
  r1 TEXT; r2 TEXT; r3 TEXT; r4 TEXT; r5 TEXT; r6 TEXT; r7 TEXT; r8 TEXT; r9 TEXT; r10 TEXT; r11 TEXT; r12 TEXT;
  r13 TEXT; r14 TEXT; r15 TEXT;
  a1 TEXT; a2 TEXT; a3 TEXT; a4 TEXT; a5 TEXT; a6 TEXT; a7 TEXT; o1 TEXT; o2 TEXT; o3 TEXT;
  n1 BIGINT; n2 BIGINT; n3 BIGINT; n4 BIGINT; n5 BIGINT; n6 BIGINT; n7 BIGINT; n8 BIGINT;
  b  BOOLEAN;
  t  TEXT;
BEGIN
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);

  -- ---------- 0. Structure ----------
  INSERT INTO _t VALUES (0, '14 politiques r13_* : toutes RESTRICTIVE, TO authenticated seulement (aucune ne vise anon ni public)',
    (SELECT count(*) = 14 AND bool_and(permissive = 'RESTRICTIVE' AND roles = ARRAY['authenticated']::name[])
       FROM pg_policies WHERE schemaname = 'public' AND policyname LIKE 'r13\_%'),
    (SELECT count(*)::text FROM pg_policies WHERE schemaname = 'public' AND policyname LIKE 'r13\_%'));

  INSERT INTO _t VALUES (1, 'password_hash : SELECT refuse a authenticated (table et colonne), autres colonnes lisibles, INSERT/UPDATE gardes ; anon lit toujours password_hash',
    NOT has_table_privilege('authenticated', 'public.t_users', 'SELECT')
      AND NOT has_column_privilege('authenticated', 'public.t_users', 'password_hash', 'SELECT')
      AND has_column_privilege('authenticated', 'public.t_users', 'login', 'SELECT')
      AND has_column_privilege('authenticated', 'public.t_users', 'site_id', 'SELECT')
      AND has_column_privilege('authenticated', 'public.t_users', 'sync_id', 'SELECT')
      AND (SELECT bool_and(has_column_privilege('authenticated', a.attrelid, a.attnum, 'SELECT'))
             FROM pg_attribute a WHERE a.attrelid = 'public.t_users'::regclass AND a.attnum > 0
              AND NOT a.attisdropped AND a.attname <> 'password_hash')
      AND has_table_privilege('authenticated', 'public.t_users', 'INSERT')
      AND has_table_privilege('authenticated', 'public.t_users', 'UPDATE')
      AND has_table_privilege('anon', 'public.t_users', 'SELECT')
      AND has_column_privilege('anon', 'public.t_users', 'password_hash', 'SELECT'),
    NULL);

  b := true;
  FOREACH t IN ARRAY ARRAY['t_cartes','t_logs','t_user_presence','t_users','t_user_roles','t_postes','t_centres','t_sites'] LOOP
    b := b AND NOT has_table_privilege('authenticated', 'public.' || t, 'TRUNCATE')
           AND NOT has_table_privilege('authenticated', 'public.' || t, 'TRIGGER')
           AND NOT has_table_privilege('authenticated', 'public.' || t, 'REFERENCES')
           AND has_table_privilege('authenticated', 'public.' || t, 'INSERT')
           AND has_table_privilege('authenticated', 'public.' || t, 'UPDATE')
           AND has_table_privilege('authenticated', 'public.' || t, 'DELETE')
           -- anon : droits inchanges
           AND has_table_privilege('anon', 'public.' || t, 'SELECT')
           AND has_table_privilege('anon', 'public.' || t, 'INSERT')
           AND has_table_privilege('anon', 'public.' || t, 'UPDATE')
           AND has_table_privilege('anon', 'public.' || t, 'DELETE')
           AND has_table_privilege('anon', 'public.' || t, 'TRUNCATE')
           AND (SELECT relrowsecurity FROM pg_class WHERE oid = ('public.' || t)::regclass);
  END LOOP;
  INSERT INTO _t VALUES (2, '8 tables : RLS active ; TRUNCATE/TRIGGER/REFERENCES retires a authenticated (INSERT/UPDATE/DELETE gardes) ; anon garde tous ses droits', b, NULL);

  -- ---------- Jeu de test (postgres, sans JWT) ----------
  INSERT INTO public.t_sites (nom, code, sync_id) VALUES ('T13 SITE A', 'T13A', 't13-site-a') RETURNING id INTO v_sa;
  INSERT INTO public.t_sites (nom, code, sync_id) VALUES ('T13 SITE B', 'T13B', 't13-site-b') RETURNING id INTO v_sb;
  INSERT INTO public.t_centres (site_id, nom, numero, sync_id) VALUES (v_sa, 'T13 CENTRE A', 1, 't13-cen-a') RETURNING id INTO v_ca;
  INSERT INTO public.t_centres (site_id, nom, numero, sync_id) VALUES (v_sb, 'T13 CENTRE B', 1, 't13-cen-b') RETURNING id INTO v_cb;
  INSERT INTO public.t_postes (centre_id, nom, numero, sync_id) VALUES (v_ca, 'T13 POSTE A', 1, 't13-poste-a') RETURNING id INTO v_pa;
  INSERT INTO public.t_postes (centre_id, nom, numero, sync_id) VALUES (v_cb, 'T13 POSTE B', 1, 't13-poste-b') RETURNING id INTO v_pb;
  INSERT INTO public.t_users (login, password_hash, role, statut_actif, site_id, centre_id, sync_id) VALUES
    ('t13_agent_a', 'x-t13-pas-un-hash', 'OPERATEUR_VERIFICATION', 1, v_sa, v_ca, 't13-u-a'),
    ('t13_agent_b', 'x-t13-pas-un-hash', 'OPERATEUR_VERIFICATION', 1, v_sb, v_cb, 't13-u-b'),
    ('t13_sa',      'x-t13-pas-un-hash', 'SUPER ADMIN',            1, NULL, NULL, 't13-u-sa');
  INSERT INTO public.t_user_roles (user_sync_id, role) VALUES
    ('t13-u-a', 'OPERATEUR_RECHERCHE'), ('t13-u-b', 'OPERATEUR_RECHERCHE');
  INSERT INTO public.t_cartes (noms, prenoms, id_site, id_centre, sync_id) VALUES
    ('T13', 'A1', v_sa, v_ca, 't13-c-a1'), ('T13', 'A2', v_sa, v_ca, 't13-c-a2'),
    ('T13', 'B1', v_sb, v_cb, 't13-c-b1'), ('T13', 'B2', v_sb, v_cb, 't13-c-b2'),
    ('T13', 'SANS SITE', NULL, NULL, 't13-c-null');
  INSERT INTO public.t_logs (action, site_id, centre_id, sync_id) VALUES
    ('T13', v_sa, v_ca, 't13-l-a'), ('T13', v_sb, v_cb, 't13-l-b');
  INSERT INTO public.t_user_presence (user_sync_id, login, site_id, centre_id, role) VALUES
    ('t13-u-a', 't13_agent_a', v_sa, v_ca, 'OPERATEUR_VERIFICATION'),
    ('t13-u-b', 't13_agent_b', v_sb, v_cb, 'OPERATEUR_VERIFICATION');

  c_a := jsonb_build_object('role','authenticated','aud','authenticated','sub','00000000-0000-0000-0000-00000000013a',
           'gis_v',1,'gis_sync_id','t13-u-a','gis_site_id',v_sa,'gis_site_sync_id','t13-site-a',
           'gis_centre_id',v_ca,'gis_roles',jsonb_build_array('OPERATEUR_RECHERCHE','OPERATEUR_VERIFICATION'),
           'gis_is_super_admin',false,'gis_statut_actif',true)::text;
  c_b := jsonb_build_object('role','authenticated','aud','authenticated','sub','00000000-0000-0000-0000-00000000013b',
           'gis_v',1,'gis_sync_id','t13-u-b','gis_site_id',v_sb,'gis_site_sync_id','t13-site-b',
           'gis_centre_id',v_cb,'gis_roles',jsonb_build_array('OPERATEUR_VERIFICATION'),
           'gis_is_super_admin',false,'gis_statut_actif',true)::text;
  c_sa := jsonb_build_object('role','authenticated','aud','authenticated','sub','00000000-0000-0000-0000-0000000013ff',
           'gis_v',1,'gis_sync_id','t13-u-sa','gis_site_id',NULL,'gis_site_sync_id',NULL,
           'gis_centre_id',NULL,'gis_roles',jsonb_build_array('SUPER ADMIN'),
           'gis_is_super_admin',true,'gis_statut_actif',true)::text;
  c_forge := jsonb_build_object('role','authenticated','gis_sync_id','t13-u-a','gis_site_id',v_sa,
           'gis_is_super_admin',true)::text;
  c_adm_a := jsonb_build_object('role','authenticated','aud','authenticated','sub','00000000-0000-0000-0000-0000000013ad',
           'gis_v',1,'gis_sync_id','t13-u-adm-a','gis_site_id',v_sa,'gis_site_sync_id','t13-site-a',
           'gis_centre_id',NULL,'gis_roles',jsonb_build_array('ADMINISTRATEUR_SITE'),
           'gis_is_super_admin',false,'gis_statut_actif',true)::text;

  -- =====================================================================
  -- 3-4. Agent du site A : LECTURE
  -- =====================================================================
  PERFORM set_config('request.jwt.claims', c_a, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  n1 := public._t13_n($q$SELECT count(*) FROM public.t_cartes WHERE sync_id LIKE 't13-%'$q$);
  n2 := public._t13_n($q$SELECT count(*) FROM public.t_cartes WHERE sync_id LIKE 't13-c-a%'$q$);
  n3 := public._t13_n($q$SELECT count(*) FROM public.t_logs WHERE sync_id LIKE 't13-%'$q$);
  n4 := public._t13_n($q$SELECT count(*) FROM public.t_user_presence WHERE user_sync_id LIKE 't13-%'$q$);
  n5 := public._t13_n($q$SELECT count(*) FROM public.t_users WHERE sync_id LIKE 't13-%'$q$);
  n6 := public._t13_n($q$SELECT count(*) FROM public.t_user_roles WHERE user_sync_id LIKE 't13-%'$q$);
  n7 := public._t13_n($q$SELECT count(*) FROM public.t_postes WHERE sync_id LIKE 't13-%'$q$);
  n8 := public._t13_n($q$SELECT count(*) FROM public.t_centres WHERE sync_id LIKE 't13-%'$q$)
        * 10 + public._t13_n($q$SELECT count(*) FROM public.t_sites WHERE sync_id LIKE 't13-%'$q$);
  r1 := (SELECT string_agg(x, ',') FROM unnest(ARRAY[
          public._t13_n($q$SELECT count(*) FROM public.t_users WHERE sync_id = 't13-u-a'$q$)::text,
          public._t13_n($q$SELECT count(*) FROM public.t_users WHERE sync_id IN ('t13-u-b','t13-u-sa')$q$)::text,
          public._t13_n(format('SELECT count(*) FROM public.fn_downstream_cartes_chunk(%s, %L, %L, 500) WHERE sync_id LIKE %L', v_sa, '-infinity', '', 't13-%'))::text,
          public._t13_n(format('SELECT count(*) FROM public.fn_downstream_cartes_chunk(%s, %L, %L, 500) WHERE sync_id LIKE %L', v_sb, '-infinity', '', 't13-%'))::text,
          public._t13_n(format('SELECT count(*) FROM public.fn_downstream_logs_chunk(%s, %L, %L, 500) WHERE sync_id LIKE %L', v_sb, '-infinity', '', 't13-%'))::text]) x);
  EXECUTE 'RESET ROLE';
  INSERT INTO _t VALUES (3, 'Agent A lit SON site seulement : cartes 2/5 (ni B ni sans site), logs 1, presences 1, comptes 1 (ni B ni SA), roles 1, postes 1',
    n1 = 2 AND n2 = 2 AND n3 = 1 AND n4 = 1 AND n5 = 1 AND n6 = 1 AND n7 = 1,
    format('cartes=%s/%s logs=%s pres=%s users=%s roles=%s postes=%s', n1, n2, n3, n4, n5, n6, n7));
  INSERT INTO _t VALUES (4, 'Agent A : sites et centres (reference) lisibles en entier (2+2) ; downstream RPC (INVOKER) filtre : site A 2 cartes, site B 0 carte, 0 log ; compte A visible, B et SA invisibles',
    n8 = 22 AND r1 = '1,0,2,0,0', format('centres*10+sites=%s ; %s', n8, r1));

  -- =====================================================================
  -- 5-6. Agent A : ECRITURES sur son site (permises)
  -- =====================================================================
  PERFORM set_config('request.jwt.claims', c_a, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  r1 := public._t13_try(format('INSERT INTO public.t_cartes (noms, prenoms, id_site, id_centre, sync_id) VALUES (%L, %L, %s, %s, %L)', 'T13', 'A3', v_sa, v_ca, 't13-c-a3'));
  r2 := public._t13_try($q$UPDATE public.t_cartes SET prenoms = 'A1 MODIF' WHERE sync_id = 't13-c-a1'$q$);
  r3 := public._t13_try($q$DELETE FROM public.t_cartes WHERE sync_id = 't13-c-a3'$q$);
  r4 := public._t13_try(format('INSERT INTO public.t_logs (action, site_id, centre_id, sync_id) VALUES (%L, %s, %s, %L)', 'T13', v_sa, v_ca, 't13-l-a2'));
  -- Empilement 0016 : la creation de compte et de role est faite plus bas par
  -- l'ADMINISTRATEUR_SITE A (un operateur ne cree plus de compte).
  -- Empilement 0014 : l'operateur ne cree ni poste ni centre, ne modifie pas son site.
  r13 := public._t13_try(format('INSERT INTO public.t_postes (centre_id, nom, numero, sync_id) VALUES (%s, %L, 4, %L)', v_ca, 'T13 POSTE OP', 't13-poste-op'));
  r14 := public._t13_try(format('INSERT INTO public.t_centres (site_id, nom, numero, sync_id) VALUES (%s, %L, 4, %L)', v_sa, 'T13 CENTRE OP', 't13-cen-op'));
  r9 := public._t13_try($q$UPDATE public.t_sites SET nom = 'T13 SITE A MODIF' WHERE sync_id = 't13-site-a'$q$);
  r10 := public._t13_try($q$UPDATE public.t_user_presence SET last_heartbeat_at = now() WHERE user_sync_id = 't13-u-a'$q$);
  r11 := public._t13_try($q$UPDATE public.t_users SET password_hash = 'x-t13-nouveau' WHERE sync_id = 't13-u-a'$q$);
  EXECUTE 'RESET ROLE';
  -- Ecritures de hierarchie sur SON site : ADMINISTRATEUR_SITE du site A.
  PERFORM set_config('request.jwt.claims', c_adm_a, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  r7 := public._t13_try(format('INSERT INTO public.t_postes (centre_id, nom, numero, sync_id) VALUES (%s, %L, 2, %L)', v_ca, 'T13 POSTE A2', 't13-poste-a2'));
  r8 := public._t13_try(format('INSERT INTO public.t_centres (site_id, nom, numero, sync_id) VALUES (%s, %L, 2, %L)', v_sa, 'T13 CENTRE A2', 't13-cen-a2'));
  r15 := public._t13_try($q$UPDATE public.t_sites SET nom = 'T13 SITE A MODIF' WHERE sync_id = 't13-site-a'$q$);
  r5 := public._t13_try(format('INSERT INTO public.t_users (login, password_hash, role, statut_actif, site_id, sync_id) VALUES (%L, %L, %L, 1, %s, %L)', 't13_agent_a2', 'x-t13-pas-un-hash', 'OPERATEUR_SAISIE', v_sa, 't13-u-a2'));
  r6 := public._t13_try($q$INSERT INTO public.t_user_roles (user_sync_id, role) VALUES ('t13-u-a2', 'OPERATEUR_VERIFICATION')$q$);
  EXECUTE 'RESET ROLE';
  INSERT INTO _t VALUES (5, 'Sur SON site : operateur A ecrit carte insert/update/delete, log, presence ; ADMINISTRATEUR_SITE A cree poste, centre, compte et role du compte (1 ligne chacun ; empilement 0014 / 0016)',
    r1 = 'ok:1' AND r2 = 'ok:1' AND r3 = 'ok:1' AND r4 = 'ok:1' AND r5 = 'ok:1' AND r6 = 'ok:1'
      AND r7 = 'ok:1' AND r8 = 'ok:1' AND r10 = 'ok:1',
    concat_ws(' ', r1, r2, r3, r4, r5, r6, r7, r8, r10));
  INSERT INTO _t VALUES (6, 'Empilement 0014 : la ligne de SON site dans t_sites n''est modifiable ni par l''operateur ni par l''admin de site (0 ligne, SA seulement) ; operateur : poste / centre de son site refuses (42501) ; operateur ECRIT password_hash d''un compte de son site sans pouvoir le relire',
    r9 = 'ok:0' AND r15 = 'ok:0' AND r13 = 'err:42501:rls' AND r14 = 'err:42501:rls' AND r11 = 'ok:1'
      AND (SELECT nom FROM public.t_sites WHERE sync_id = 't13-site-a') = 'T13 SITE A'
      AND (SELECT password_hash FROM public.t_users WHERE sync_id = 't13-u-a') = 'x-t13-nouveau',
    concat_ws(' ', r9, r15, r13, r14, r11));

  -- =====================================================================
  -- 7-8. Agent A : ECRITURES hors de son site (refusees)
  -- =====================================================================
  PERFORM set_config('request.jwt.claims', c_a, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  r1 := public._t13_try(format('INSERT INTO public.t_cartes (noms, prenoms, id_site, id_centre, sync_id) VALUES (%L, %L, %s, %s, %L)', 'T13', 'X', v_sb, v_cb, 't13-c-x1'));
  r2 := public._t13_try($q$INSERT INTO public.t_cartes (noms, prenoms, id_site, sync_id) VALUES ('T13', 'X', NULL, 't13-c-x2')$q$);
  r3 := public._t13_try($q$UPDATE public.t_cartes SET prenoms = 'PIRATE' WHERE sync_id = 't13-c-b1'$q$);
  r4 := public._t13_try($q$DELETE FROM public.t_cartes WHERE sync_id IN ('t13-c-b1', 't13-c-b2', 't13-c-null')$q$);
  r5 := public._t13_try(format('UPDATE public.t_cartes SET id_site = %s WHERE sync_id = %L', v_sb, 't13-c-a2'));
  r6 := public._t13_try(format('INSERT INTO public.t_logs (action, site_id, sync_id) VALUES (%L, %s, %L)', 'T13', v_sb, 't13-l-x'));
  r7 := public._t13_try(format('INSERT INTO public.t_users (login, password_hash, role, statut_actif, site_id, sync_id) VALUES (%L, %L, %L, 1, %s, %L)', 't13_x', 'x-t13-pas-un-hash', 'OPERATEUR_SAISIE', v_sb, 't13-u-x'));
  r8 := public._t13_try($q$UPDATE public.t_users SET nom_user = 'PIRATE' WHERE sync_id IN ('t13-u-b', 't13-u-sa')$q$);
  r9 := public._t13_try($q$INSERT INTO public.t_user_roles (user_sync_id, role) VALUES ('t13-u-b', 'ADMINISTRATEUR_SITE')$q$);
  o1 := public._t13_try(format('INSERT INTO public.t_user_presence (user_sync_id, login, site_id) VALUES (%L, %L, %s)', 't13-u-x', 't13_x', v_sb));
  o2 := public._t13_try($q$UPDATE public.t_user_presence SET role = 'PIRATE' WHERE user_sync_id = 't13-u-b'$q$);
  o3 := public._t13_try($q$DELETE FROM public.t_user_roles WHERE user_sync_id = 't13-u-b'$q$);
  EXECUTE 'RESET ROLE';
  -- Hierarchie hors site : ADMINISTRATEUR_SITE du site A (son role l'autorise
  -- sur SON site, cas 5) : un refus ici prouve le filtre PAR SITE.
  PERFORM set_config('request.jwt.claims', c_adm_a, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  r10 := public._t13_try(format('INSERT INTO public.t_postes (centre_id, nom, numero, sync_id) VALUES (%s, %L, 3, %L)', v_cb, 'T13 X', 't13-poste-x'));
  r11 := public._t13_try(format('INSERT INTO public.t_centres (site_id, nom, numero, sync_id) VALUES (%s, %L, 3, %L)', v_sb, 'T13 X', 't13-cen-x'));
  a1 := public._t13_try($q$UPDATE public.t_centres SET nom = 'PIRATE' WHERE sync_id = 't13-cen-b'$q$);
  a2 := public._t13_try($q$DELETE FROM public.t_centres WHERE sync_id = 't13-cen-b'$q$);
  a3 := public._t13_try($q$UPDATE public.t_sites SET nom = 'PIRATE' WHERE sync_id = 't13-site-b'$q$);
  a4 := public._t13_try($q$DELETE FROM public.t_sites WHERE sync_id = 't13-site-b'$q$);
  a5 := public._t13_try($q$INSERT INTO public.t_sites (nom, code, sync_id) VALUES ('T13 X', 'T13X', 't13-site-x')$q$);
  a6 := public._t13_try($q$UPDATE public.t_postes SET nom = 'PIRATE' WHERE sync_id = 't13-poste-b'$q$);
  a7 := public._t13_try(format('UPDATE public.t_postes SET centre_id = %s WHERE sync_id = %L', v_cb, 't13-poste-a'));
  EXECUTE 'RESET ROLE';
  r12 := concat_ws(' ', a1, a2, a3, a4, a5, o1, o2, o3, a6, a7);
  INSERT INTO _t VALUES (7, 'Hors site : operateur A -> INSERT carte site B / sans site, log B, compte B, role d''un compte B refuses (42501), UPDATE/DELETE cartes B et sans site, comptes B et SA -> 0 ligne, deplacer une carte A vers B refuse ; ADMINISTRATEUR_SITE A -> poste B, centre B refuses (42501)',
    r1 = 'err:42501:rls' AND r2 = 'err:42501:rls' AND r3 = 'ok:0' AND r4 = 'ok:0' AND r5 = 'err:42501:rls'
      -- r7 / r9 : refuses aussi par 0016 (trigger BEFORE, avant le WITH CHECK) : 42501, message de 0016
      AND r6 = 'err:42501:rls' AND r7 LIKE 'err:42501:%' AND r8 = 'ok:0' AND r9 LIKE 'err:42501:%'
      AND r10 = 'err:42501:rls' AND r11 = 'err:42501:rls',
    concat_ws(' ', r1, r2, r3, r4, r5, r6, r7, r8, r9, r10, r11));
  INSERT INTO _t VALUES (8, 'Hors site : ADMINISTRATEUR_SITE A -> centre B et site B non modifiables / supprimables (0 ligne), creation de site refusee, poste B 0 ligne, deplacer un poste A vers un centre B refuse ; operateur A -> presence B refusee / 0 ligne, roles B 0 ligne',
    r12 = 'ok:0 ok:0 ok:0 ok:0 err:42501:rls err:42501:rls ok:0 ok:0 ok:0 err:42501:rls', r12);
  -- Les lignes du site B et sans site sont intactes (verifie en postgres).
  INSERT INTO _t VALUES (9, 'Lignes hors site intactes apres les tentatives de l''agent A',
    (SELECT count(*) FROM public.t_cartes WHERE sync_id IN ('t13-c-b1','t13-c-b2','t13-c-null') AND prenoms <> 'PIRATE') = 3
      AND (SELECT id_site FROM public.t_cartes WHERE sync_id = 't13-c-a2') = v_sa
      AND NOT EXISTS (SELECT 1 FROM public.t_users WHERE nom_user = 'PIRATE' AND sync_id LIKE 't13-%')
      AND (SELECT nom FROM public.t_sites WHERE sync_id = 't13-site-b') = 'T13 SITE B'
      AND (SELECT count(*) FROM public.t_user_roles WHERE user_sync_id = 't13-u-b') = 1
      AND (SELECT centre_id FROM public.t_postes WHERE sync_id = 't13-poste-a') = v_ca,
    NULL);

  -- =====================================================================
  -- 10. password_hash illisible pour authenticated
  -- =====================================================================
  PERFORM set_config('request.jwt.claims', c_a, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  r1 := public._t13_try($q$SELECT password_hash FROM public.t_users WHERE sync_id = 't13-u-a'$q$);
  r2 := public._t13_try($q$SELECT * FROM public.t_users WHERE sync_id = 't13-u-a'$q$);
  r3 := public._t13_try($q$SELECT login, role, site_id, centre_id, sync_id, statut_actif FROM public.t_users WHERE sync_id = 't13-u-a'$q$);
  r4 := public._t13_try($q$SELECT count(*) FROM public.t_users WHERE password_hash LIKE 'x%'$q$);
  r5 := public._t13_try($q$UPDATE public.t_users SET nom_user = 'X' WHERE sync_id = 't13-u-a' RETURNING password_hash$q$);
  r6 := public._t13_try(format('INSERT INTO public.t_users AS u (login, password_hash, role, statut_actif, site_id, sync_id) VALUES (%L, %L, %L, 1, %s, %L) ON CONFLICT (sync_id) DO UPDATE SET password_hash = EXCLUDED.password_hash', 't13_agent_a', 'x-t13-upsert', 'OPERATEUR_VERIFICATION', v_sa, 't13-u-a'));
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', c_sa, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  r7 := public._t13_try($q$SELECT password_hash FROM public.t_users WHERE sync_id = 't13-u-sa'$q$);
  EXECUTE 'RESET ROLE';
  INSERT INTO _t VALUES (10, 'password_hash illisible par authenticated (agent et SA) : SELECT colonne, SELECT *, filtre WHERE sur la colonne, RETURNING -> refus de privilege ; colonnes listees -> OK ; upsert ON CONFLICT reecrivant password_hash -> refus (a savoir pour P2)',
    r1 = 'err:42501:priv' AND r2 = 'err:42501:priv' AND r3 = 'ok:1' AND r4 = 'err:42501:priv'
      AND r5 = 'err:42501:priv' AND r6 = 'err:42501:priv' AND r7 = 'err:42501:priv',
    concat_ws(' ', r1, r2, r3, r4, r5, r6, r7));

  -- =====================================================================
  -- 11. Agent du site B : symetrique
  -- =====================================================================
  PERFORM set_config('request.jwt.claims', c_b, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  n1 := public._t13_n($q$SELECT count(*) FROM public.t_cartes WHERE sync_id LIKE 't13-%'$q$);
  n2 := public._t13_n($q$SELECT count(*) FROM public.t_cartes WHERE sync_id LIKE 't13-c-b%'$q$);
  n3 := public._t13_n($q$SELECT count(*) FROM public.t_users WHERE sync_id LIKE 't13-%'$q$);
  r1 := public._t13_try($q$UPDATE public.t_cartes SET prenoms = 'B1 MODIF' WHERE sync_id = 't13-c-b1'$q$);
  r2 := public._t13_try($q$UPDATE public.t_cartes SET prenoms = 'PIRATE' WHERE sync_id LIKE 't13-c-a%'$q$);
  r3 := public._t13_try(format('INSERT INTO public.t_cartes (noms, prenoms, id_site, sync_id) VALUES (%L, %L, %s, %L)', 'T13', 'X', v_sa, 't13-c-x3'));
  EXECUTE 'RESET ROLE';
  INSERT INTO _t VALUES (11, 'Agent B : lit ses 2 cartes et son seul compte (rien du site A), modifie sa carte, 0 ligne sur les cartes A, INSERT carte A refuse',
    n1 = 2 AND n2 = 2 AND n3 = 1 AND r1 = 'ok:1' AND r2 = 'ok:0' AND r3 = 'err:42501:rls',
    format('cartes=%s/%s users=%s %s %s %s', n1, n2, n3, r1, r2, r3));

  -- =====================================================================
  -- 12. SUPER ADMIN (claims gis_is_super_admin, sans site) : tous les sites
  -- =====================================================================
  PERFORM set_config('request.jwt.claims', c_sa, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  n1 := public._t13_n($q$SELECT count(*) FROM public.t_cartes WHERE sync_id LIKE 't13-c-%'$q$);
  n2 := public._t13_n($q$SELECT count(*) FROM public.t_users WHERE sync_id LIKE 't13-%'$q$);
  n3 := public._t13_n($q$SELECT count(*) FROM public.t_logs WHERE sync_id LIKE 't13-%'$q$);
  n4 := public._t13_n($q$SELECT count(*) FROM public.t_postes WHERE sync_id LIKE 't13-%'$q$);
  r1 := public._t13_try(format('INSERT INTO public.t_cartes (noms, prenoms, id_site, sync_id) VALUES (%L, %L, %s, %L)', 'T13', 'SA', v_sb, 't13-c-sa1'));
  r2 := public._t13_try($q$UPDATE public.t_cartes SET prenoms = 'SA MODIF' WHERE sync_id IN ('t13-c-a2', 't13-c-null')$q$);
  r3 := public._t13_try($q$INSERT INTO public.t_sites (nom, code, sync_id) VALUES ('T13 SITE C', 'T13C', 't13-site-c')$q$);
  r4 := public._t13_try($q$UPDATE public.t_users SET nom_user = 'SA MODIF' WHERE sync_id IN ('t13-u-a', 't13-u-b')$q$);
  r5 := public._t13_try($q$DELETE FROM public.t_logs WHERE sync_id = 't13-l-b'$q$);
  EXECUTE 'RESET ROLE';
  INSERT INTO _t VALUES (12, 'SUPER ADMIN : lit les 5 cartes (A, B, sans site), 3+ comptes (dont le sien), logs et postes des 2 sites ; ecrit sur le site B, la carte sans site, cree un site, modifie des comptes des 2 sites, supprime un log B',
    n1 = 5 AND n2 >= 3 AND n3 >= 2 AND n4 >= 2 AND r1 = 'ok:1' AND r2 = 'ok:2' AND r3 = 'ok:1' AND r4 = 'ok:2' AND r5 = 'ok:1',
    format('cartes=%s users=%s logs=%s postes=%s %s %s %s %s %s', n1, n2, n3, n4, r1, r2, r3, r4, r5));

  -- =====================================================================
  -- 13-14. authenticated SANS claims gis_* et avec claims forgees sans gis_v
  -- =====================================================================
  PERFORM set_config('request.jwt.claims', c_nog, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  n1 := public._t13_n($q$SELECT count(*) FROM public.t_cartes WHERE sync_id LIKE 't13-%'$q$);
  n2 := public._t13_n($q$SELECT count(*) FROM public.t_sites WHERE sync_id LIKE 't13-%'$q$);
  n3 := public._t13_n($q$SELECT count(*) FROM public.t_centres WHERE sync_id LIKE 't13-%'$q$);
  n4 := public._t13_n($q$SELECT count(*) FROM public.t_users WHERE sync_id LIKE 't13-%'$q$)
        + public._t13_n($q$SELECT count(*) FROM public.t_user_roles WHERE user_sync_id LIKE 't13-%'$q$)
        + public._t13_n($q$SELECT count(*) FROM public.t_logs WHERE sync_id LIKE 't13-%'$q$)
        + public._t13_n($q$SELECT count(*) FROM public.t_postes WHERE sync_id LIKE 't13-%'$q$)
        + public._t13_n($q$SELECT count(*) FROM public.t_user_presence WHERE user_sync_id LIKE 't13-%'$q$);
  r1 := public._t13_try(format('INSERT INTO public.t_cartes (noms, prenoms, id_site, sync_id) VALUES (%L, %L, %s, %L)', 'T13', 'X', v_sa, 't13-c-x4'));
  r2 := public._t13_try($q$UPDATE public.t_cartes SET prenoms = 'PIRATE' WHERE sync_id LIKE 't13-%'$q$);
  r3 := public._t13_try($q$DELETE FROM public.t_sites WHERE sync_id LIKE 't13-%'$q$);
  EXECUTE 'RESET ROLE';
  INSERT INTO _t VALUES (13, 'authenticated SANS claims gis_* : 0 ligne lue sur les 8 tables (meme sites et centres), INSERT refuse, UPDATE / DELETE 0 ligne (echec ferme)',
    n1 = 0 AND n2 = 0 AND n3 = 0 AND n4 = 0 AND r1 = 'err:42501:rls' AND r2 = 'ok:0' AND r3 = 'ok:0',
    format('cartes=%s sites=%s centres=%s autres=%s %s %s %s', n1, n2, n3, n4, r1, r2, r3));

  PERFORM set_config('request.jwt.claims', c_forge, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  n1 := public._t13_n($q$SELECT count(*) FROM public.t_cartes WHERE sync_id LIKE 't13-%'$q$);
  n2 := public._t13_n($q$SELECT count(*) FROM public.t_sites WHERE sync_id LIKE 't13-%'$q$);
  r1 := public._t13_try(format('INSERT INTO public.t_cartes (noms, prenoms, id_site, sync_id) VALUES (%L, %L, %s, %L)', 'T13', 'X', v_sa, 't13-c-x5'));
  EXECUTE 'RESET ROLE';
  INSERT INTO _t VALUES (14, 'authenticated avec claims gis_* SANS gis_v (gis_is_super_admin=true forge) : 0 ligne, INSERT refuse',
    n1 = 0 AND n2 = 0 AND r1 = 'err:42501:rls', format('cartes=%s sites=%s %s', n1, n2, r1));

  -- =====================================================================
  -- 15-16. anon : comportement INCHANGE (tout, tous sites, password_hash)
  -- =====================================================================
  FOREACH t IN ARRAY ARRAY['{"role":"anon"}', ''] LOOP
    PERFORM set_config('request.jwt.claims', t, true);
    EXECUTE 'SET LOCAL ROLE anon';
    n1 := public._t13_n($q$SELECT count(*) FROM public.t_cartes WHERE sync_id LIKE 't13-c-%'$q$);
    n2 := public._t13_n($q$SELECT count(*) FROM public.t_users WHERE sync_id LIKE 't13-%' AND password_hash LIKE 'x%'$q$);
    n3 := public._t13_n($q$SELECT count(*) FROM public.t_sites WHERE sync_id LIKE 't13-%'$q$)
          + public._t13_n($q$SELECT count(*) FROM public.t_centres WHERE sync_id LIKE 't13-%'$q$)
          + public._t13_n($q$SELECT count(*) FROM public.t_postes WHERE sync_id LIKE 't13-%'$q$)
          + public._t13_n($q$SELECT count(*) FROM public.t_logs WHERE sync_id LIKE 't13-%'$q$)
          + public._t13_n($q$SELECT count(*) FROM public.t_user_roles WHERE user_sync_id LIKE 't13-%'$q$)
          + public._t13_n($q$SELECT count(*) FROM public.t_user_presence WHERE user_sync_id LIKE 't13-%'$q$);
    n4 := public._t13_n(format('SELECT count(*) FROM public.fn_downstream_cartes_chunk(%s, %L, %L, 500) WHERE sync_id LIKE %L', v_sb, '-infinity', '', 't13-%'));
    r1 := concat_ws(' ',
            public._t13_try(format('INSERT INTO public.t_cartes (noms, prenoms, id_site, sync_id) VALUES (%L, %L, %s, %L)', 'T13', 'ANON', v_sb, 't13-c-anon-' || length(t))),
            public._t13_try($q$UPDATE public.t_cartes SET prenoms = 'ANON MODIF' WHERE sync_id IN ('t13-c-a1', 't13-c-b2')$q$),
            public._t13_try(format('DELETE FROM public.t_cartes WHERE sync_id = %L', 't13-c-anon-' || length(t))),
            public._t13_try(format('INSERT INTO public.t_users AS u (login, password_hash, role, statut_actif, site_id, sync_id) VALUES (%L, %L, %L, 1, %s, %L) ON CONFLICT (sync_id) DO UPDATE SET password_hash = EXCLUDED.password_hash', 't13_agent_b', 'x-t13-anon', 'OPERATEUR_VERIFICATION', v_sb, 't13-u-b')),
            public._t13_try($q$SELECT * FROM public.t_users WHERE sync_id = 't13-u-a'$q$),
            public._t13_try(format('INSERT INTO public.t_user_roles (user_sync_id, role) VALUES (%L, %L)', 't13-u-b', 'R' || length(t))),
            public._t13_try(format('INSERT INTO public.t_logs (action, site_id, sync_id) VALUES (%L, %s, %L)', 'T13', v_sa, 't13-l-anon-' || length(t))));
    EXECUTE 'RESET ROLE';
    INSERT INTO _t VALUES (CASE WHEN t = '' THEN 16 ELSE 15 END,
      'anon (' || CASE WHEN t = '' THEN 'sans claims' ELSE 'cle publishable {"role":"anon"}' END
        || ') : lit tout (cartes des 2 sites et sans site, comptes AVEC password_hash, tables de reference, downstream site B) et ecrit sur tous les sites, upsert password_hash compris : comportement d''avant 0013',
      -- n4 = 3 : b1, b2 et la carte creee sur B par le SUPER ADMIN (cas 12)
      n1 >= 6 AND n2 >= 4 AND n3 >= 15 AND n4 = 3
        AND r1 = 'ok:1 ok:2 ok:1 ok:1 ok:1 ok:1 ok:1',
      format('cartes=%s users_hash=%s ref=%s down_b=%s ; %s', n1, n2, n3, n4, r1));
  END LOOP;

  -- =====================================================================
  -- 17. Garde 0007 toujours actif pour authenticated (non fiable)
  -- =====================================================================
  PERFORM set_config('request.jwt.claims', c_a, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  r1 := public._t13_try($q$INSERT INTO public.t_user_roles (user_sync_id, role) VALUES ('t13-u-a', 'SUPER ADMIN')$q$);
  r2 := public._t13_try($q$UPDATE public.t_users SET role = 'SUPER ADMIN' WHERE sync_id = 't13-u-a'$q$);
  EXECUTE 'RESET ROLE';
  INSERT INTO _t VALUES (17, 'Garde 0007 inchange : un agent authenticated de son site ne cree pas de role SUPER ADMIN et ne s''eleve pas (neutralisation silencieuse, aucune erreur)',
    NOT EXISTS (SELECT 1 FROM public.t_user_roles WHERE user_sync_id = 't13-u-a' AND role = 'SUPER ADMIN')
      AND (SELECT role FROM public.t_users WHERE sync_id = 't13-u-a') <> 'SUPER ADMIN'
      AND r1 LIKE 'ok:%' AND r2 LIKE 'ok:%',
    concat_ws(' ', r1, r2));

  -- =====================================================================
  -- 18. service_role : non filtre (BYPASSRLS)
  -- =====================================================================
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  BEGIN
    EXECUTE 'SET LOCAL ROLE service_role';
    n1 := public._t13_n($q$SELECT count(*) FROM public.t_cartes WHERE sync_id LIKE 't13-c-%'$q$);
    r1 := public._t13_try($q$SELECT password_hash FROM public.t_users WHERE sync_id = 't13-u-a'$q$);
    EXECUTE 'RESET ROLE';
    INSERT INTO _t VALUES (18, 'service_role : non filtre (lit toutes les cartes de test et password_hash)',
      n1 >= 6 AND r1 = 'ok:1', format('cartes=%s %s', n1, r1));
  EXCEPTION WHEN insufficient_privilege THEN
    EXECUTE 'RESET ROLE';
    INSERT INTO _t VALUES (18, 'service_role : SET ROLE refuse au role courant (non concluant)', NULL, SQLSTATE);
  END;

  PERFORM set_config('request.jwt.claims', '', true);
END;
$$;

SELECT n, ok, cas, detail FROM _t ORDER BY n;

DO $$
DECLARE
  v_ko TEXT;
BEGIN
  SELECT string_agg(n::text, ', ' ORDER BY n) INTO v_ko FROM _t WHERE ok IS NOT TRUE AND n <> 18;
  IF v_ko IS NOT NULL THEN
    RAISE EXCEPTION 'TEST 0013 ECHEC : cas en erreur : %', v_ko;
  END IF;
  RAISE NOTICE 'TEST 0013 OK (% cas, cas 18 : %)', (SELECT count(*) FROM _t),
    (SELECT COALESCE(ok::text, 'non concluant') FROM _t WHERE n = 18);
END;
$$;

ROLLBACK;
