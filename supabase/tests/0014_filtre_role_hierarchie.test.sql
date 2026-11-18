-- ============================================================
-- Test de supabase/migrations/0014_filtre_role_hierarchie.sql
-- A executer sur le projet DEV uniquement (ajadkziqaskadlzboeqo), apres
-- 0011, 0013 et 0014, dans le SQL Editor (role postgres). Transaction
-- ANNULEE (ROLLBACK final) : aucune ligne ne reste (sites, centres, postes
-- 't14*', fonctions d'aide public._t14_*, compteurs 0008).
--
-- Methode (identique au test 0013) : vrais changements de role
-- (SET LOCAL ROLE authenticated / anon / service_role, comme PostgREST) +
-- claims simulees dans request.jwt.claims. RLS et privileges reellement
-- appliques.
-- Profils : SUPER ADMIN (sans site), ADMINISTRATEUR_SITE du site A,
-- ADMINISTRATEUR_SITE du site B, OPERATEUR du site A, ADMIN_CENTRE du
-- centre A, compte multi-roles (principal OPERATEUR_VERIFICATION +
-- ADMINISTRATEUR_SITE secondaire) du site A, authenticated SANS claims gis_*,
-- claims forgees sans gis_v, anon (cle publishable et sans claims),
-- service_role.
-- Les comptages ne portent que sur les lignes de test (sync_id 't14-%').
-- (numero de centre / poste : CHECK 1..4 sur le dev, pas d'unicite.)
-- Resultat : table _t, puis un bloc qui LEVE UNE ERREUR si un cas vaut false
-- (le cas 16, service_role, peut etre non concluant si SET ROLE est refuse).
-- NE JAMAIS EXECUTER EN PROD.
-- ============================================================
BEGIN;

CREATE TEMP TABLE _t (n INT, cas TEXT, ok BOOLEAN, detail TEXT) ON COMMIT DROP;

CREATE FUNCTION public._t14_try(p_sql TEXT) RETURNS TEXT
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

CREATE FUNCTION public._t14_n(p_sql TEXT) RETURNS BIGINT
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

-- Claims d'un profil (authenticated, gis_v = 1).
CREATE FUNCTION public._t14_c(p_sid TEXT, p_site BIGINT, p_centre BIGINT, p_roles TEXT[], p_sa BOOLEAN) RETURNS TEXT
LANGUAGE sql AS $f$
  SELECT jsonb_build_object('role','authenticated','aud','authenticated',
           'sub','00000000-0000-0000-0000-000000000014',
           'gis_v',1,'gis_sync_id',p_sid,'gis_site_id',p_site,'gis_centre_id',p_centre,
           'gis_primary_role',p_roles[1],'gis_roles',to_jsonb(p_roles),
           'gis_is_super_admin',p_sa,'gis_statut_actif',true)::text
$f$;

DO $$
DECLARE
  v_sa BIGINT; v_sb BIGINT; v_ca BIGINT; v_cb BIGINT; v_pa BIGINT; v_pb BIGINT; v_x BIGINT;
  c_sa TEXT; c_ada TEXT; c_adb TEXT; c_opa TEXT; c_aca TEXT; c_multi TEXT; c_forge TEXT;
  c_nog TEXT := '{"role":"authenticated","aud":"authenticated","sub":"00000000-0000-0000-0000-000000000014"}';
  r1 TEXT; r2 TEXT; r3 TEXT; r4 TEXT; r5 TEXT; r6 TEXT; r7 TEXT; r8 TEXT; r9 TEXT;
  n1 BIGINT; n2 BIGINT; n3 BIGINT;
  t TEXT;
  i INT;
  v_prof TEXT[];
BEGIN
  PERFORM set_config('request.jwt.claims', '', true);

  -- ---------- 0. Structure ----------
  INSERT INTO _t VALUES (0, '9 politiques r14_* RESTRICTIVE TO authenticated seulement (3 INSERT, 3 UPDATE, 3 DELETE, aucune SELECT/ALL) ; 14 politiques r13_* toujours presentes',
    (SELECT count(*) = 9
            AND bool_and(permissive = 'RESTRICTIVE' AND roles = ARRAY['authenticated']::name[])
            AND count(*) FILTER (WHERE cmd = 'INSERT') = 3
            AND count(*) FILTER (WHERE cmd = 'UPDATE') = 3
            AND count(*) FILTER (WHERE cmd = 'DELETE') = 3
       FROM pg_policies WHERE schemaname = 'public' AND policyname LIKE 'r14\_%')
      AND (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND policyname LIKE 'r13\_%') = 14,
    (SELECT string_agg(tablename || '.' || cmd, ',' ORDER BY tablename, cmd) FROM pg_policies WHERE schemaname = 'public' AND policyname LIKE 'r14\_%'));

  -- ---------- Jeu de test (postgres, sans JWT) ----------
  INSERT INTO public.t_sites (nom, code, sync_id) VALUES ('T14 SITE A', 'T14A', 't14-site-a') RETURNING id INTO v_sa;
  INSERT INTO public.t_sites (nom, code, sync_id) VALUES ('T14 SITE B', 'T14B', 't14-site-b') RETURNING id INTO v_sb;
  INSERT INTO public.t_centres (site_id, nom, numero, sync_id) VALUES (v_sa, 'T14 CENTRE A', 1, 't14-cen-a') RETURNING id INTO v_ca;
  INSERT INTO public.t_centres (site_id, nom, numero, sync_id) VALUES (v_sb, 'T14 CENTRE B', 1, 't14-cen-b') RETURNING id INTO v_cb;
  INSERT INTO public.t_postes (centre_id, nom, numero, sync_id) VALUES (v_ca, 'T14 POSTE A', 1, 't14-poste-a') RETURNING id INTO v_pa;
  INSERT INTO public.t_postes (centre_id, nom, numero, sync_id) VALUES (v_cb, 'T14 POSTE B', 1, 't14-poste-b') RETURNING id INTO v_pb;

  c_sa    := public._t14_c('t14-u-sa',  NULL, NULL, ARRAY['SUPER ADMIN'], true);
  c_ada   := public._t14_c('t14-u-ada', v_sa, NULL, ARRAY['ADMINISTRATEUR_SITE'], false);
  c_adb   := public._t14_c('t14-u-adb', v_sb, NULL, ARRAY['ADMINISTRATEUR_SITE'], false);
  c_opa   := public._t14_c('t14-u-opa', v_sa, v_ca, ARRAY['OPERATEUR_SAISIE','OPERATEUR_VERIFICATION'], false);
  c_aca   := public._t14_c('t14-u-aca', v_sa, v_ca, ARRAY['ADMIN_CENTRE'], false);
  c_multi := public._t14_c('t14-u-mul', v_sa, v_ca, ARRAY['OPERATEUR_VERIFICATION','ADMINISTRATEUR_SITE'], false);
  c_forge := jsonb_build_object('role','authenticated','gis_sync_id','t14-u-x','gis_site_id',v_sa,
               'gis_roles',jsonb_build_array('ADMINISTRATEUR_SITE','SUPER ADMIN'),
               'gis_is_super_admin',true)::text;

  -- =====================================================================
  -- 1. SUPER ADMIN : toutes les ecritures, tous les sites
  -- =====================================================================
  PERFORM set_config('request.jwt.claims', c_sa, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  r1 := public._t14_try($q$INSERT INTO public.t_sites (nom, code, sync_id) VALUES ('T14 SITE C', 'T14C', 't14-site-c')$q$);
  r2 := public._t14_try($q$UPDATE public.t_sites SET nom = 'T14 SITE A SA' WHERE sync_id = 't14-site-a'$q$);
  r3 := public._t14_try(format('INSERT INTO public.t_centres (site_id, nom, numero, sync_id) VALUES (%s, %L, 2, %L)', v_sb, 'T14 CENTRE B2', 't14-cen-b2'));
  r4 := public._t14_try($q$UPDATE public.t_centres SET lieu = 'SA' WHERE sync_id IN ('t14-cen-a', 't14-cen-b')$q$);
  r5 := public._t14_try(format('INSERT INTO public.t_postes (centre_id, nom, numero, sync_id) VALUES (%s, %L, 2, %L)', v_cb, 'T14 POSTE B2', 't14-poste-b2'));
  r6 := public._t14_try($q$UPDATE public.t_postes SET nom = 'T14 POSTE A SA' WHERE sync_id = 't14-poste-a'$q$);
  r7 := public._t14_try($q$DELETE FROM public.t_postes WHERE sync_id = 't14-poste-b2'$q$);
  r8 := public._t14_try($q$DELETE FROM public.t_centres WHERE sync_id = 't14-cen-b2'$q$);
  r9 := public._t14_try($q$DELETE FROM public.t_sites WHERE sync_id = 't14-site-c'$q$);
  EXECUTE 'RESET ROLE';
  INSERT INTO _t VALUES (1, 'SUPER ADMIN : cree / modifie / supprime site, centre (site B), poste (centre B), modifie les centres des 2 sites',
    r1 = 'ok:1' AND r2 = 'ok:1' AND r3 = 'ok:1' AND r4 = 'ok:2' AND r5 = 'ok:1' AND r6 = 'ok:1'
      AND r7 = 'ok:1' AND r8 = 'ok:1' AND r9 = 'ok:1',
    concat_ws(' ', r1, r2, r3, r4, r5, r6, r7, r8, r9));

  -- =====================================================================
  -- 2. ADMINISTRATEUR_SITE du site A : centres et postes de SON site
  -- =====================================================================
  PERFORM set_config('request.jwt.claims', c_ada, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  r1 := public._t14_try(format('INSERT INTO public.t_centres (site_id, nom, numero, sync_id) VALUES (%s, %L, 2, %L)', v_sa, 'T14 CENTRE A2', 't14-cen-a2'));
  r2 := public._t14_try($q$UPDATE public.t_centres SET nom = 'T14 CENTRE A ADM' WHERE sync_id = 't14-cen-a'$q$);
  r3 := public._t14_try(format('INSERT INTO public.t_postes (centre_id, nom, numero, sync_id) VALUES (%s, %L, 2, %L)', v_ca, 'T14 POSTE A2', 't14-poste-a2'));
  r4 := public._t14_try($q$UPDATE public.t_postes SET nom = 'T14 POSTE A ADM' WHERE sync_id = 't14-poste-a'$q$);
  r5 := public._t14_try($q$DELETE FROM public.t_postes WHERE sync_id = 't14-poste-a2'$q$);
  r6 := public._t14_try($q$DELETE FROM public.t_centres WHERE sync_id = 't14-cen-a2'$q$);
  EXECUTE 'RESET ROLE';
  INSERT INTO _t VALUES (2, 'ADMINISTRATEUR_SITE A : cree / modifie / supprime un centre de son site et un poste d''un centre de son site',
    r1 = 'ok:1' AND r2 = 'ok:1' AND r3 = 'ok:1' AND r4 = 'ok:1' AND r5 = 'ok:1' AND r6 = 'ok:1',
    concat_ws(' ', r1, r2, r3, r4, r5, r6));

  -- =====================================================================
  -- 3. ADMINISTRATEUR_SITE A sur t_sites : aucune ecriture (SA seulement)
  -- =====================================================================
  -- Creation : claims d'un administrateur dont gis_site_id = l'id du site cree
  -- (0013 seule l'aurait permise : id = gis_site_id) -> c'est bien 0014 qui refuse.
  PERFORM set_config('request.jwt.claims',
    public._t14_c('t14-u-adx', v_sa + 100000, NULL, ARRAY['ADMINISTRATEUR_SITE'], false), true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  r1 := public._t14_try(format('INSERT INTO public.t_sites (id, nom, code, sync_id) VALUES (%s, %L, %L, %L)', v_sa + 100000, 'T14 X', 'T14X', 't14-site-x'));
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', c_ada, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  r2 := public._t14_try($q$UPDATE public.t_sites SET nom = 'PIRATE' WHERE sync_id = 't14-site-a'$q$);
  r3 := public._t14_try($q$DELETE FROM public.t_sites WHERE sync_id = 't14-site-a'$q$);
  EXECUTE 'RESET ROLE';
  INSERT INTO _t VALUES (3, 'ADMINISTRATEUR_SITE A : creation de site refusee (42501), modification et suppression de SON site -> 0 ligne (avant 0014 : modification permise)',
    r1 = 'err:42501:rls' AND r2 = 'ok:0' AND r3 = 'ok:0', concat_ws(' ', r1, r2, r3));

  -- =====================================================================
  -- 4. ADMINISTRATEUR_SITE A hors de son site : refuse
  -- =====================================================================
  PERFORM set_config('request.jwt.claims', c_ada, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  r1 := public._t14_try(format('INSERT INTO public.t_centres (site_id, nom, numero, sync_id) VALUES (%s, %L, 3, %L)', v_sb, 'PIRATE', 't14-cen-x'));
  r2 := public._t14_try($q$UPDATE public.t_centres SET nom = 'PIRATE' WHERE sync_id = 't14-cen-b'$q$);
  r3 := public._t14_try($q$DELETE FROM public.t_centres WHERE sync_id = 't14-cen-b'$q$);
  r4 := public._t14_try(format('INSERT INTO public.t_postes (centre_id, nom, numero, sync_id) VALUES (%s, %L, 3, %L)', v_cb, 'PIRATE', 't14-poste-x'));
  r5 := public._t14_try($q$UPDATE public.t_postes SET nom = 'PIRATE' WHERE sync_id = 't14-poste-b'$q$);
  r6 := public._t14_try($q$DELETE FROM public.t_postes WHERE sync_id = 't14-poste-b'$q$);
  r7 := public._t14_try(format('UPDATE public.t_centres SET site_id = %s WHERE sync_id = %L', v_sb, 't14-cen-a'));
  r8 := public._t14_try(format('UPDATE public.t_postes SET centre_id = %s WHERE sync_id = %L', v_cb, 't14-poste-a'));
  EXECUTE 'RESET ROLE';
  INSERT INTO _t VALUES (4, 'ADMINISTRATEUR_SITE A hors site : INSERT centre B / poste B refuse, UPDATE / DELETE centre B et poste B 0 ligne, deplacer centre A vers B / poste A vers centre B refuse',
    r1 = 'err:42501:rls' AND r2 = 'ok:0' AND r3 = 'ok:0' AND r4 = 'err:42501:rls' AND r5 = 'ok:0'
      AND r6 = 'ok:0' AND r7 = 'err:42501:rls' AND r8 = 'err:42501:rls',
    concat_ws(' ', r1, r2, r3, r4, r5, r6, r7, r8));

  -- =====================================================================
  -- 5. ADMINISTRATEUR_SITE du site B : symetrique
  -- =====================================================================
  PERFORM set_config('request.jwt.claims', c_adb, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  r1 := public._t14_try($q$UPDATE public.t_centres SET lieu = 'ADM B' WHERE sync_id = 't14-cen-b'$q$);
  r2 := public._t14_try($q$UPDATE public.t_centres SET nom = 'PIRATE' WHERE sync_id = 't14-cen-a'$q$);
  r3 := public._t14_try(format('INSERT INTO public.t_postes (centre_id, nom, numero, sync_id) VALUES (%s, %L, 4, %L)', v_cb, 'T14 POSTE B4', 't14-poste-b4'));
  r4 := public._t14_try($q$DELETE FROM public.t_postes WHERE sync_id = 't14-poste-b4'$q$);
  r5 := public._t14_try($q$UPDATE public.t_postes SET nom = 'PIRATE' WHERE sync_id = 't14-poste-a'$q$);
  r6 := public._t14_try($q$UPDATE public.t_sites SET nom = 'PIRATE' WHERE sync_id = 't14-site-b'$q$);
  EXECUTE 'RESET ROLE';
  INSERT INTO _t VALUES (5, 'ADMINISTRATEUR_SITE B : modifie son centre, cree / supprime un poste de son centre ; centre A, poste A et son propre site -> 0 ligne',
    r1 = 'ok:1' AND r2 = 'ok:0' AND r3 = 'ok:1' AND r4 = 'ok:1' AND r5 = 'ok:0' AND r6 = 'ok:0',
    concat_ws(' ', r1, r2, r3, r4, r5, r6));

  -- =====================================================================
  -- 6-7. OPERATEUR du site A et ADMIN_CENTRE du centre A : aucune ecriture
  -- =====================================================================
  FOR i IN 6..7 LOOP
    PERFORM set_config('request.jwt.claims', CASE WHEN i = 6 THEN c_opa ELSE c_aca END, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    r1 := public._t14_try(format('INSERT INTO public.t_centres (site_id, nom, numero, sync_id) VALUES (%s, %L, 3, %L)', v_sa, 'PIRATE', 't14-cen-y' || i));
    r2 := public._t14_try($q$UPDATE public.t_centres SET nom = 'PIRATE' WHERE sync_id = 't14-cen-a'$q$);
    r3 := public._t14_try($q$DELETE FROM public.t_centres WHERE sync_id = 't14-cen-a'$q$);
    r4 := public._t14_try(format('INSERT INTO public.t_postes (centre_id, nom, numero, sync_id) VALUES (%s, %L, 3, %L)', v_ca, 'PIRATE', 't14-poste-y' || i));
    r5 := public._t14_try($q$UPDATE public.t_postes SET nom = 'PIRATE' WHERE sync_id = 't14-poste-a'$q$);
    r6 := public._t14_try($q$DELETE FROM public.t_postes WHERE sync_id = 't14-poste-a'$q$);
    r7 := public._t14_try($q$UPDATE public.t_sites SET nom = 'PIRATE' WHERE sync_id = 't14-site-a'$q$);
    r8 := public._t14_try(format('INSERT INTO public.t_sites (id, nom, code, sync_id) VALUES (%s, %L, %L, %L)', v_sa + 100000 + i, 'PIRATE', 'T14Y' || i, 't14-site-y' || i));
    EXECUTE 'RESET ROLE';
    INSERT INTO _t VALUES (i, CASE WHEN i = 6 THEN 'OPERATEUR (SAISIE + VERIFICATION) du site A' ELSE 'ADMIN_CENTRE du centre A' END
      || ' : INSERT centre / poste / site refuses (42501), UPDATE / DELETE centre, poste, site de son site -> 0 ligne',
      r1 = 'err:42501:rls' AND r2 = 'ok:0' AND r3 = 'ok:0' AND r4 = 'err:42501:rls' AND r5 = 'ok:0'
        AND r6 = 'ok:0' AND r7 = 'ok:0' AND r8 = 'err:42501:rls',
      concat_ws(' ', r1, r2, r3, r4, r5, r6, r7, r8));
  END LOOP;

  -- =====================================================================
  -- 8. Compte multi-roles : ADMINISTRATEUR_SITE en role secondaire
  -- =====================================================================
  PERFORM set_config('request.jwt.claims', c_multi, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  r1 := public._t14_try($q$UPDATE public.t_centres SET lieu = 'MULTI' WHERE sync_id = 't14-cen-a'$q$);
  r2 := public._t14_try(format('INSERT INTO public.t_postes (centre_id, nom, numero, sync_id) VALUES (%s, %L, 2, %L)', v_ca, 'T14 POSTE A5', 't14-poste-a5'));
  r3 := public._t14_try($q$UPDATE public.t_centres SET nom = 'PIRATE' WHERE sync_id = 't14-cen-b'$q$);
  r4 := public._t14_try($q$UPDATE public.t_sites SET nom = 'PIRATE' WHERE sync_id = 't14-site-a'$q$);
  EXECUTE 'RESET ROLE';
  INSERT INTO _t VALUES (8, 'Multi-roles (principal OPERATEUR_VERIFICATION, ADMINISTRATEUR_SITE secondaire) : ecrit centre / poste de son site (comme verifyUserRole) ; centre B et site -> 0 ligne',
    r1 = 'ok:1' AND r2 = 'ok:1' AND r3 = 'ok:0' AND r4 = 'ok:0', concat_ws(' ', r1, r2, r3, r4));

  -- =====================================================================
  -- 9. LECTURE inchangee (regles 0013)
  -- =====================================================================
  r1 := '';
  FOREACH t IN ARRAY ARRAY['opa','aca','ada','sa'] LOOP
    PERFORM set_config('request.jwt.claims',
      CASE t WHEN 'opa' THEN c_opa WHEN 'aca' THEN c_aca WHEN 'ada' THEN c_ada ELSE c_sa END, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    r1 := r1 || t || '='
       || public._t14_n($q$SELECT count(*) FROM public.t_sites WHERE sync_id LIKE 't14-%'$q$) || '/'
       || public._t14_n($q$SELECT count(*) FROM public.t_centres WHERE sync_id LIKE 't14-%'$q$) || '/'
       || public._t14_n($q$SELECT count(*) FROM public.t_postes WHERE sync_id LIKE 't14-%'$q$) || ' ';
    EXECUTE 'RESET ROLE';
  END LOOP;
  -- postes : A et A5 (site A) ; B (site B). Agents du site A : 2 postes ; SA : 3.
  INSERT INTO _t VALUES (9, 'Lecture inchangee : sites 2 et centres 2 lisibles par tout porteur des claims (operateur, admin centre, admin site, SA) ; postes : 2 pour le site A, 3 pour le SA',
    r1 = 'opa=2/2/2 aca=2/2/2 ada=2/2/2 sa=2/2/3 ', r1);

  -- =====================================================================
  -- 10-11. Echec ferme : sans claims gis_* ; claims forgees sans gis_v
  -- =====================================================================
  FOR i IN 10..11 LOOP
    PERFORM set_config('request.jwt.claims', CASE WHEN i = 10 THEN c_nog ELSE c_forge END, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    n1 := public._t14_n($q$SELECT count(*) FROM public.t_sites WHERE sync_id LIKE 't14-%'$q$)
        + public._t14_n($q$SELECT count(*) FROM public.t_centres WHERE sync_id LIKE 't14-%'$q$)
        + public._t14_n($q$SELECT count(*) FROM public.t_postes WHERE sync_id LIKE 't14-%'$q$);
    r1 := public._t14_try(format('INSERT INTO public.t_centres (site_id, nom, numero, sync_id) VALUES (%s, %L, 3, %L)', v_sa, 'PIRATE', 't14-cen-z' || i));
    r2 := public._t14_try($q$UPDATE public.t_centres SET nom = 'PIRATE' WHERE sync_id LIKE 't14-%'$q$);
    r3 := public._t14_try($q$DELETE FROM public.t_postes WHERE sync_id LIKE 't14-%'$q$);
    r4 := public._t14_try(format('INSERT INTO public.t_sites (id, nom, code, sync_id) VALUES (%s, %L, %L, %L)', v_sa + 200000 + i, 'PIRATE', 'T14Z' || i, 't14-site-z' || i));
    EXECUTE 'RESET ROLE';
    INSERT INTO _t VALUES (i, CASE WHEN i = 10 THEN 'authenticated SANS claims gis_*' ELSE 'claims forgees sans gis_v (gis_roles ADMINISTRATEUR_SITE + gis_is_super_admin true)' END
      || ' : 0 ligne lue, INSERT centre / site refuses, UPDATE / DELETE 0 ligne (echec ferme)',
      n1 = 0 AND r1 = 'err:42501:rls' AND r2 = 'ok:0' AND r3 = 'ok:0' AND r4 = 'err:42501:rls',
      format('lus=%s %s %s %s %s', n1, r1, r2, r3, r4));
  END LOOP;

  -- =====================================================================
  -- 12-13. anon : comportement INCHANGE (ecrit sites, centres, postes)
  -- =====================================================================
  FOREACH t IN ARRAY ARRAY['{"role":"anon"}', ''] LOOP
    PERFORM set_config('request.jwt.claims', t, true);
    EXECUTE 'SET LOCAL ROLE anon';
    n1 := public._t14_n($q$SELECT count(*) FROM public.t_sites WHERE sync_id LIKE 't14-%'$q$)
        + public._t14_n($q$SELECT count(*) FROM public.t_centres WHERE sync_id LIKE 't14-%'$q$)
        + public._t14_n($q$SELECT count(*) FROM public.t_postes WHERE sync_id LIKE 't14-%'$q$);
    r1 := concat_ws(' ',
      public._t14_try(format('INSERT INTO public.t_sites (nom, code, sync_id) VALUES (%L, %L, %L)', 'T14 ANON', 'T14N' || length(t), 't14-site-anon' || length(t))),
      public._t14_try($q$UPDATE public.t_sites SET nom = nom WHERE sync_id IN ('t14-site-a', 't14-site-b')$q$),
      public._t14_try(format('INSERT INTO public.t_centres (site_id, nom, numero, sync_id) VALUES (%s, %L, 4, %L)', v_sb, 'T14 ANON', 't14-cen-anon' || length(t))),
      public._t14_try($q$UPDATE public.t_centres SET lieu = 'ANON' WHERE sync_id IN ('t14-cen-a', 't14-cen-b')$q$),
      public._t14_try(format('INSERT INTO public.t_postes (centre_id, nom, numero, sync_id) VALUES (%s, %L, 4, %L)', v_ca, 'T14 ANON', 't14-poste-anon' || length(t))),
      public._t14_try(format('DELETE FROM public.t_postes WHERE sync_id = %L', 't14-poste-anon' || length(t))),
      public._t14_try(format('DELETE FROM public.t_centres WHERE sync_id = %L', 't14-cen-anon' || length(t))),
      public._t14_try(format('DELETE FROM public.t_sites WHERE sync_id = %L', 't14-site-anon' || length(t))));
    EXECUTE 'RESET ROLE';
    INSERT INTO _t VALUES (CASE WHEN t = '' THEN 13 ELSE 12 END,
      'anon (' || CASE WHEN t = '' THEN 'sans claims' ELSE 'cle publishable {"role":"anon"}' END
        || ') : lit et ecrit sites, centres, postes de tous les sites (comportement d''avant 0014)',
      n1 = 7 AND r1 = 'ok:1 ok:2 ok:1 ok:2 ok:1 ok:1 ok:1 ok:1',
      format('lus=%s ; %s', n1, r1));
  END LOOP;

  -- =====================================================================
  -- 14. Lignes intactes apres les tentatives refusees
  -- =====================================================================
  INSERT INTO _t VALUES (14, 'Aucune ligne PIRATE ; centre A toujours sur le site A, poste A sur le centre A, poste B et centre B presents ; aucun site / centre / poste x, y, z cree',
    NOT EXISTS (SELECT 1 FROM public.t_sites   WHERE sync_id LIKE 't14-%' AND nom = 'PIRATE')
      AND NOT EXISTS (SELECT 1 FROM public.t_centres WHERE sync_id LIKE 't14-%' AND nom = 'PIRATE')
      AND NOT EXISTS (SELECT 1 FROM public.t_postes  WHERE sync_id LIKE 't14-%' AND nom = 'PIRATE')
      AND (SELECT site_id FROM public.t_centres WHERE sync_id = 't14-cen-a') = v_sa
      AND (SELECT centre_id FROM public.t_postes WHERE sync_id = 't14-poste-a') = v_ca
      AND EXISTS (SELECT 1 FROM public.t_postes WHERE sync_id = 't14-poste-b')
      AND EXISTS (SELECT 1 FROM public.t_centres WHERE sync_id = 't14-cen-b')
      AND NOT EXISTS (SELECT 1 FROM public.t_sites WHERE sync_id ~ '^t14-site-[xyz]')
      AND NOT EXISTS (SELECT 1 FROM public.t_centres WHERE sync_id ~ '^t14-cen-[xyz]')
      AND NOT EXISTS (SELECT 1 FROM public.t_postes WHERE sync_id ~ '^t14-poste-[xyz]'),
    NULL);

  -- =====================================================================
  -- 15. Cascade : un ADMINISTRATEUR_SITE supprime un centre de son site avec
  --     ses postes (ON DELETE CASCADE, hors RLS, comme dans l'application)
  -- =====================================================================
  INSERT INTO public.t_centres (site_id, nom, numero, sync_id) VALUES (v_sa, 'T14 CENTRE A3', 3, 't14-cen-a3') RETURNING id INTO v_x;
  INSERT INTO public.t_postes (centre_id, nom, numero, sync_id) VALUES (v_x, 'T14 POSTE A3', 1, 't14-poste-a3');
  PERFORM set_config('request.jwt.claims', c_ada, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  r1 := public._t14_try($q$DELETE FROM public.t_centres WHERE sync_id = 't14-cen-a3'$q$);
  EXECUTE 'RESET ROLE';
  INSERT INTO _t VALUES (15, 'ADMINISTRATEUR_SITE A supprime un centre de son site : ses postes partent en cascade',
    r1 = 'ok:1' AND NOT EXISTS (SELECT 1 FROM public.t_postes WHERE sync_id = 't14-poste-a3'), r1);

  -- =====================================================================
  -- 16. service_role : non filtre (BYPASSRLS)
  -- =====================================================================
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  BEGIN
    EXECUTE 'SET LOCAL ROLE service_role';
    r1 := public._t14_try($q$UPDATE public.t_sites SET nom = nom WHERE sync_id LIKE 't14-%'$q$);
    EXECUTE 'RESET ROLE';
    INSERT INTO _t VALUES (16, 'service_role : non filtre (modifie les 2 sites de test)', r1 = 'ok:2', r1);
  EXCEPTION WHEN insufficient_privilege THEN
    EXECUTE 'RESET ROLE';
    INSERT INTO _t VALUES (16, 'service_role : SET ROLE refuse au role courant (non concluant)', NULL, SQLSTATE);
  END;

  PERFORM set_config('request.jwt.claims', '', true);
END;
$$;

SELECT n, ok, cas, detail FROM _t ORDER BY n;

DO $$
DECLARE
  v_ko TEXT;
BEGIN
  SELECT string_agg(n::text, ', ' ORDER BY n) INTO v_ko FROM _t WHERE ok IS NOT TRUE AND n <> 16;
  IF v_ko IS NOT NULL THEN
    RAISE EXCEPTION 'TEST 0014 ECHEC : cas en erreur : %', v_ko;
  END IF;
  RAISE NOTICE 'TEST 0014 OK (% cas, cas 16 : %)', (SELECT count(*) FROM _t),
    (SELECT COALESCE(ok::text, 'non concluant') FROM _t WHERE n = 16);
END;
$$;

ROLLBACK;
