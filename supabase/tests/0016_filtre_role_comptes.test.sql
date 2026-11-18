-- ============================================================
-- Test de supabase/migrations/0016_filtre_role_comptes.sql
-- A executer sur le projet DEV uniquement (ajadkziqaskadlzboeqo), apres
-- 0007, 0011, 0013, 0014, 0015 et 0016, dans le SQL Editor (role postgres).
-- Transaction ANNULEE (ROLLBACK final) : aucune ligne ne reste (sites,
-- centres, comptes, roles 't16*', journal 0007, compteurs 0008, fonctions
-- d'aide public._t16_*).
--
-- Methode : vrais changements de role (SET LOCAL ROLE authenticated / anon /
-- service_role, comme PostgREST) + claims simulees dans request.jwt.claims.
-- La RLS (0013 / 0014), les privileges et les triggers (0007 / 0015 / 0016)
-- sont donc reellement appliques.
-- Profils : anon (cle publishable, forme legacy), authenticated SANS claims
-- gis_*, claims forgees sans gis_v, operateur du site A, ADMINISTRATEUR_SITE
-- du site A, ADMINISTRATEUR_SITE du site B, ADMIN_CENTRE du site A,
-- multi-roles (operateur + ADMIN_CENTRE), SUPER ADMIN verifie, jeton SUPER
-- ADMIN non verifie, service_role, postgres sans claims.
-- Les mots de passe sont des valeurs factices 'x-t16-*' (aucun vrai hash).
-- Resultat : table _t, puis un bloc qui LEVE UNE ERREUR si un cas vaut false.
-- NE JAMAIS EXECUTER EN PROD.
-- ============================================================
BEGIN;

CREATE TEMP TABLE _t (n INT, cas TEXT, ok BOOLEAN, detail TEXT) ON COMMIT DROP;

CREATE FUNCTION public._t16_try(p_sql TEXT) RETURNS TEXT
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
              ELSE left(SQLERRM, 90) END;
END;
$f$;

-- Claims d'une session gis-login (hook 0011) simulees.
CREATE FUNCTION public._t16_c(p_sync TEXT, p_site BIGINT, p_centre BIGINT, p_roles TEXT[], p_sa BOOLEAN DEFAULT false)
RETURNS TEXT LANGUAGE sql AS $f$
  SELECT jsonb_build_object('role','authenticated','aud','authenticated',
           'sub','00000000-0000-0000-0000-000000000016',
           'gis_v',1,'gis_sync_id',p_sync,'gis_site_id',p_site,'gis_centre_id',p_centre,
           'gis_primary_role',p_roles[1],'gis_roles',to_jsonb(p_roles),
           'gis_is_super_admin',p_sa,'gis_statut_actif',true)::text
$f$;

DO $$
DECLARE
  v_sa BIGINT; v_sb BIGINT; v_ca1 BIGINT; v_ca2 BIGINT; v_cb BIGINT;
  c_nog   TEXT := '{"role":"authenticated","aud":"authenticated","sub":"00000000-0000-0000-0000-000000000016"}';
  c_forge TEXT;
  c TEXT;
  r TEXT[];
  v_roles_a2_1 TEXT; v_roles_a2_2 TEXT; v_prim_a2 TEXT;
  t TEXT;
  i INT;
BEGIN
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);

  -- ---------- 0. Structure ----------
  INSERT INTO _t VALUES (0, '0016 en place : 2 triggers actifs, tries apres 0007/0015, 6 fonctions fermees a anon/authenticated, triggers SECURITY DEFINER',
    (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgenabled = 'O'
        AND ((tgrelid = 'public.t_users'::regclass AND tgname = 'trg_t_users_x16_filtre_role')
          OR (tgrelid = 'public.t_user_roles'::regclass AND tgname = 'trg_t_user_roles_x16_filtre_role'))) = 2
      AND 'trg_t_users_x16_filtre_role' > 'trg_t_users_sa_guard_upd'
      AND 'trg_t_user_roles_x16_filtre_role' > 'trg_t_user_roles_sa_guard_upd'
      AND (SELECT count(*) FROM pg_proc p, (VALUES ('anon'), ('authenticated')) ro(r)
            WHERE p.oid IN ('public.fn_r16_niveau()'::regprocedure, 'public.fn_r16_roles_attribuables(text)'::regprocedure,
                            'public.fn_r16_detient(text,text)'::regprocedure, 'public.fn_r16_refus(text)'::regprocedure,
                            'public.fn_t_users_filtre_role()'::regprocedure, 'public.fn_t_user_roles_filtre_role()'::regprocedure)
              AND has_function_privilege(ro.r, p.oid, 'EXECUTE')) = 0
      AND (SELECT bool_and(prosecdef) FROM pg_proc
            WHERE oid IN ('public.fn_t_users_filtre_role()'::regprocedure, 'public.fn_t_user_roles_filtre_role()'::regprocedure)),
    NULL);

  -- ---------- Jeu de test (postgres, sans JWT : non filtre) ----------
  INSERT INTO public.t_sites (nom, code, sync_id) VALUES ('T16 SITE A', 'T16A', 't16-site-a') RETURNING id INTO v_sa;
  INSERT INTO public.t_sites (nom, code, sync_id) VALUES ('T16 SITE B', 'T16B', 't16-site-b') RETURNING id INTO v_sb;
  INSERT INTO public.t_centres (site_id, nom, numero, sync_id) VALUES (v_sa, 'T16 CENTRE A1', 1, 't16-cen-a1') RETURNING id INTO v_ca1;
  INSERT INTO public.t_centres (site_id, nom, numero, sync_id) VALUES (v_sa, 'T16 CENTRE A2', 2, 't16-cen-a2') RETURNING id INTO v_ca2;
  INSERT INTO public.t_centres (site_id, nom, numero, sync_id) VALUES (v_sb, 'T16 CENTRE B', 1, 't16-cen-b') RETURNING id INTO v_cb;
  INSERT INTO public.t_users (login, password_hash, role, nom_user, statut_actif, site_id, centre_id, sync_id) VALUES
    ('t16_op_a',      'x-t16-h-op-a',  'OPERATEUR_VERIFICATION', 'Op A',      1, v_sa, v_ca1, 't16-op-a'),
    ('t16_op_c',      'x-t16-h-op-c',  'OPERATEUR_SAISIE',       'Collegue',  1, v_sa, v_ca1, 't16-op-c'),
    ('t16_op_d',      'x-t16-h-op-d',  'OPERATEUR_SAISIE',       'Op D',      1, v_sa, v_ca2, 't16-op-d'),
    ('t16_op_e',      'x-t16-h-op-e',  'OPERATEUR_SAISIE',       'Op E',      1, v_sa, v_ca2, 't16-op-e'),
    ('t16_adm_a',     'x-t16-h-adm-a', 'ADMINISTRATEUR_SITE',    'Adm A',     1, v_sa, NULL,  't16-adm-a'),
    ('t16_adm_a2',    'x-t16-h-adm-a2','OPERATEUR_QUALITE',      'Adm A2',    1, v_sa, v_ca1, 't16-adm-a2'),
    ('t16_ac_a',      'x-t16-h-ac-a',  'ADMIN_CENTRE',           'AC A',      1, v_sa, v_ca1, 't16-ac-a'),
    ('t16_multi',     'x-t16-h-multi', 'OPERATEUR_VERIFICATION', 'Multi',     1, v_sa, v_ca2, 't16-multi'),
    ('t16_adm_b',     'x-t16-h-adm-b', 'ADMINISTRATEUR_SITE',    'Adm B',     1, v_sb, NULL,  't16-adm-b'),
    ('t16_op_b',      'x-t16-h-op-b',  'OPERATEUR_VERIFICATION', 'Op B',      1, v_sb, v_cb,  't16-op-b'),
    ('t16_sa1',       'x-t16-h-sa1',   'SUPER ADMIN',            'SA 1',      1, NULL, NULL,  't16-sa1'),
    ('t16_sa_site_a', 'x-t16-h-sasa',  'OPERATEUR_SAISIE',       'SA site A', 1, v_sa, v_ca1, 't16-sa-site-a');
  INSERT INTO public.t_user_roles (user_sync_id, role) VALUES
    ('t16-op-a', 'OPERATEUR_VERIFICATION'), ('t16-op-c', 'OPERATEUR_SAISIE'),
    ('t16-adm-a', 'ADMINISTRATEUR_SITE'),
    ('t16-adm-a2', 'OPERATEUR_QUALITE'), ('t16-adm-a2', 'ADMINISTRATEUR_SITE'),
    ('t16-ac-a', 'ADMIN_CENTRE'),
    ('t16-multi', 'OPERATEUR_VERIFICATION'), ('t16-multi', 'ADMIN_CENTRE'),
    ('t16-sa1', 'SUPER ADMIN'), ('t16-sa-site-a', 'OPERATEUR_SAISIE'), ('t16-sa-site-a', 'SUPER ADMIN');
  c_forge := jsonb_build_object('role','authenticated','gis_sync_id','t16-adm-a','gis_site_id',v_sa,
           'gis_roles',jsonb_build_array('ADMINISTRATEUR_SITE'),'gis_statut_actif',true)::text;

  -- =====================================================================
  -- 1. anon (cle publishable, forme legacy) : INCHANGE (comportement d'avant
  --    0016 : 0013 ne vise pas anon ; fermeture anon = P3)
  -- =====================================================================
  i := 0;
  FOREACH t IN ARRAY ARRAY['{"role":"anon"}', '{"iss":"supabase","ref":"t16","role":"anon","iat":1,"exp":2}'] LOOP
    i := i + 1;
    PERFORM set_config('request.jwt.claims', t, true);
    EXECUTE 'SET LOCAL ROLE anon';
    r := ARRAY[
      public._t16_try($q$UPDATE public.t_users SET role = 'ADMINISTRATEUR_SITE' WHERE sync_id = 't16-op-c'$q$),
      public._t16_try($q$INSERT INTO public.t_user_roles (user_sync_id, role) VALUES ('t16-op-c', 'ADMINISTRATEUR_SITE')$q$),
      public._t16_try($q$DELETE FROM public.t_user_roles WHERE user_sync_id = 't16-op-c' AND role = 'ADMINISTRATEUR_SITE'$q$),
      public._t16_try($q$UPDATE public.t_users SET role = 'OPERATEUR_SAISIE' WHERE sync_id = 't16-op-c'$q$)];
    EXECUTE 'RESET ROLE';
    INSERT INTO _t VALUES (i, 'anon (' || CASE WHEN i = 1 THEN 'cle publishable' ELSE 'claims de cle legacy' END
        || ') INCHANGE : ecritures t_users / t_user_roles d''un role non SA acceptees comme avant 0016 (fermeture anon = P3)',
      r = ARRAY['ok:1','ok:1','ok:1','ok:1']
        AND (SELECT role FROM public.t_users WHERE sync_id = 't16-op-c') = 'OPERATEUR_SAISIE'
        AND NOT EXISTS (SELECT 1 FROM public.t_user_roles WHERE user_sync_id = 't16-op-c' AND role = 'ADMINISTRATEUR_SITE'),
      array_to_string(r, ' '));
  END LOOP;

  -- =====================================================================
  -- 3-4. authenticated SANS claims gis_* / claims forgees sans gis_v :
  --      aucune ecriture (echec ferme)
  -- =====================================================================
  i := 2;
  FOREACH t IN ARRAY ARRAY[c_nog, c_forge] LOOP
    i := i + 1;
    PERFORM set_config('request.jwt.claims', t, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    r := ARRAY[
      public._t16_try($q$UPDATE public.t_users SET nom_user = 'pirate' WHERE sync_id = 't16-op-a'$q$),
      public._t16_try(format('INSERT INTO public.t_users (login, password_hash, role, statut_actif, site_id, sync_id) VALUES (%L, %L, %L, 1, %s, %L)',
                             't16_x_nog' || i, 'x-t16-x', 'OPERATEUR_SAISIE', v_sa, 't16-x-nog' || i)),
      public._t16_try($q$INSERT INTO public.t_user_roles (user_sync_id, role) VALUES ('t16-op-a', 'ADMINISTRATEUR_SITE')$q$),
      public._t16_try($q$DELETE FROM public.t_user_roles WHERE user_sync_id = 't16-op-a'$q$)];
    EXECUTE 'RESET ROLE';
    INSERT INTO _t VALUES (i, CASE WHEN i = 3 THEN 'authenticated SANS claims gis_*' ELSE 'claims forgees sans gis_v' END
        || ' : modification 0 ligne, creation de compte et de role refusees (42501), suppression de role 0 ligne',
      r[1] = 'ok:0' AND r[2] LIKE 'err:42501%' AND r[3] LIKE 'err:42501%' AND r[4] = 'ok:0'
        AND (SELECT nom_user FROM public.t_users WHERE sync_id = 't16-op-a') = 'Op A'
        AND NOT EXISTS (SELECT 1 FROM public.t_users WHERE sync_id = 't16-x-nog' || i)
        AND (SELECT count(*) FROM public.t_user_roles WHERE user_sync_id = 't16-op-a') = 1,
      array_to_string(r, ' '));
  END LOOP;

  -- =====================================================================
  -- 5. Operateur du site A : auto-promotion refusee, son mot de passe et son
  --    profil permis, collegue intouchable, aucune creation
  -- =====================================================================
  PERFORM set_config('request.jwt.claims', public._t16_c('t16-op-a', v_sa, v_ca1, ARRAY['OPERATEUR_VERIFICATION']), true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  r := ARRAY[
    public._t16_try($q$UPDATE public.t_users SET role = 'ADMINISTRATEUR_SITE' WHERE sync_id = 't16-op-a'$q$),                 -- 1
    public._t16_try($q$INSERT INTO public.t_user_roles (user_sync_id, role) VALUES ('t16-op-a', 'ADMINISTRATEUR_SITE')$q$),   -- 2
    public._t16_try($q$UPDATE public.t_users SET password_hash = 'x-t16-new-op-a', updated_at = now() WHERE sync_id = 't16-op-a'$q$), -- 3
    public._t16_try($q$UPDATE public.t_users SET nom_user = 'Op A bis', email = 't16@exemple.invalid', telephone = '+2250000000016' WHERE sync_id = 't16-op-a'$q$), -- 4
    public._t16_try($q$UPDATE public.t_users SET login = 't16_op_a_nouveau' WHERE sync_id = 't16-op-a'$q$),                   -- 5
    public._t16_try($q$UPDATE public.t_users SET statut_actif = 0 WHERE sync_id = 't16-op-a'$q$),                              -- 6
    public._t16_try(format('UPDATE public.t_users SET centre_id = %s WHERE sync_id = %L', v_ca2, 't16-op-a')),                -- 7
    public._t16_try($q$UPDATE public.t_users SET nom_user = 'pirate', password_hash = 'x-t16-pirate' WHERE sync_id = 't16-op-c'$q$), -- 8
    public._t16_try($q$DELETE FROM public.t_users WHERE sync_id = 't16-op-c'$q$),                                              -- 9
    public._t16_try(format('INSERT INTO public.t_users (login, password_hash, role, statut_actif, site_id, centre_id, sync_id) VALUES (%L, %L, %L, 1, %s, %s, %L)',
                           't16_op_new', 'x-t16-x', 'OPERATEUR_SAISIE', v_sa, v_ca1, 't16-op-new')),                          -- 10
    -- 11 : forme « upsert » de l'outbox (branche UPDATE sur sa propre ligne, colonnes inchangees sauf le nom)
    public._t16_try(format('INSERT INTO public.t_users (login, password_hash, role, site_id, sync_id, nom_user) VALUES (%L, %L, %L, %s, %L, %L) '
                        || 'ON CONFLICT (sync_id) DO UPDATE SET nom_user = EXCLUDED.nom_user, login = EXCLUDED.login, role = EXCLUDED.role',
                           't16_op_a', 'x-t16-ignore', 'OPERATEUR_VERIFICATION', v_sa, 't16-op-a', 'Nom upsert')),
    -- 12 : meme forme, mais en changeant son role
    public._t16_try(format('INSERT INTO public.t_users (login, password_hash, role, site_id, sync_id) VALUES (%L, %L, %L, %s, %L) '
                        || 'ON CONFLICT (sync_id) DO UPDATE SET role = EXCLUDED.role',
                           't16_op_a', 'x-t16-ignore', 'ADMIN_CENTRE', v_sa, 't16-op-a')),
    public._t16_try($q$UPDATE public.t_user_roles SET role = 'ADMIN_CENTRE' WHERE user_sync_id = 't16-op-a'$q$)                 -- 13
  ];
  EXECUTE 'RESET ROLE';
  INSERT INTO _t VALUES (5, 'Operateur A : s''attribuer ADMINISTRATEUR_SITE / ADMIN_CENTRE (role principal, role secondaire, upsert) refuse ; son mot de passe, nom, contact permis ; son login, statut, centre refuses ; collegue : modification, suppression refusees ; creation de compte refusee ; upsert de son profil permis',
    r[1] LIKE 'err:42501%' AND r[2] LIKE 'err:42501%' AND r[3] = 'ok:1' AND r[4] = 'ok:1'
      AND r[5] LIKE 'err:42501%' AND r[6] LIKE 'err:42501%' AND r[7] LIKE 'err:42501%'
      AND r[8] LIKE 'err:42501%' AND r[9] LIKE 'err:42501%' AND r[10] LIKE 'err:42501%'
      AND r[11] = 'ok:1' AND r[12] LIKE 'err:42501%' AND r[13] LIKE 'err:42501%'
      AND (SELECT role || '|' || password_hash || '|' || login || '|' || statut_actif || '|' || centre_id || '|' || nom_user || '|' || email
             FROM public.t_users WHERE sync_id = 't16-op-a')
          = 'OPERATEUR_VERIFICATION|x-t16-new-op-a|t16_op_a|1|' || v_ca1 || '|Nom upsert|t16@exemple.invalid'
      AND (SELECT string_agg(role, ',') FROM public.t_user_roles WHERE user_sync_id = 't16-op-a') = 'OPERATEUR_VERIFICATION'
      AND (SELECT nom_user || '|' || password_hash FROM public.t_users WHERE sync_id = 't16-op-c') = 'Collegue|x-t16-h-op-c'
      AND NOT EXISTS (SELECT 1 FROM public.t_users WHERE sync_id = 't16-op-new'),
    array_to_string(r, ' '));

  -- =====================================================================
  -- 6. ADMINISTRATEUR_SITE du site A
  -- =====================================================================
  c := public._t16_c('t16-adm-a', v_sa, NULL, ARRAY['ADMINISTRATEUR_SITE']);
  PERFORM set_config('request.jwt.claims', c, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  r := ARRAY[
    public._t16_try(format('INSERT INTO public.t_users (login, password_hash, role, statut_actif, site_id, centre_id, sync_id) VALUES (%L, %L, %L, 1, %s, %s, %L)',
                           't16_new_ac', 'x-t16-x', 'ADMIN_CENTRE', v_sa, v_ca1, 't16-new-ac')),                              -- 1
    public._t16_try(format('INSERT INTO public.t_users (login, password_hash, role, statut_actif, site_id, centre_id, sync_id) VALUES (%L, %L, %L, 1, %s, %s, %L)',
                           't16_new_op', 'x-t16-x', 'OPERATEUR_APUREMENT', v_sa, v_ca2, 't16-new-op')),                       -- 2
    public._t16_try(format('INSERT INTO public.t_users (login, password_hash, role, statut_actif, site_id, sync_id) VALUES (%L, %L, %L, 1, %s, %L)',
                           't16_x_as', 'x-t16-x', 'ADMINISTRATEUR_SITE', v_sa, 't16-x-as')),                                  -- 3
    public._t16_try(format('INSERT INTO public.t_users (login, password_hash, role, statut_actif, site_id, sync_id) VALUES (%L, %L, %L, 1, %s, %L)',
                           't16_x_sa', 'x-t16-x', 'SUPER ADMIN', v_sa, 't16-x-sa')),                                          -- 4
    public._t16_try(format('INSERT INTO public.t_users (login, password_hash, role, statut_actif, site_id, centre_id, sync_id) VALUES (%L, %L, %L, 1, %s, %s, %L)',
                           't16_x_cb', 'x-t16-x', 'OPERATEUR_SAISIE', v_sa, v_cb, 't16-x-cb')),                               -- 5
    public._t16_try($q$UPDATE public.t_users SET role = 'ADMIN_CENTRE' WHERE sync_id = 't16-op-c'$q$),                         -- 6
    public._t16_try($q$UPDATE public.t_users SET role = 'ADMINISTRATEUR_SITE' WHERE sync_id = 't16-op-d'$q$),                  -- 7
    public._t16_try($q$INSERT INTO public.t_user_roles (user_sync_id, role) VALUES ('t16-op-d', 'ADMINISTRATEUR_SITE')$q$),    -- 8
    public._t16_try($q$INSERT INTO public.t_user_roles (user_sync_id, role) VALUES ('t16-op-d', 'ADMIN_CENTRE')$q$),           -- 9
    public._t16_try($q$UPDATE public.t_users SET password_hash = 'x-t16-reset-a2', updated_at = now() WHERE sync_id = 't16-adm-a2'$q$), -- 10
    -- 11-12 : cycle de l'application sur un collegue administrateur (tout effacer, puis upsert de la liste)
    public._t16_try($q$DELETE FROM public.t_user_roles WHERE user_sync_id = 't16-adm-a2'$q$)                                   -- 11
  ];
  EXECUTE 'RESET ROLE';
  SELECT string_agg(role, ',' ORDER BY role) INTO v_roles_a2_1 FROM public.t_user_roles WHERE user_sync_id = 't16-adm-a2';
  EXECUTE 'SET LOCAL ROLE authenticated';
  r := r || ARRAY[
    public._t16_try($q$INSERT INTO public.t_user_roles (user_sync_id, role) VALUES ('t16-adm-a2', 'ADMINISTRATEUR_SITE'), ('t16-adm-a2', 'OPERATEUR_QUALITE'), ('t16-adm-a2', 'OPERATEUR_SAISIE') ON CONFLICT (user_sync_id, role) DO UPDATE SET role = EXCLUDED.role$q$), -- 12
    public._t16_try($q$UPDATE public.t_users SET role = 'ADMINISTRATEUR_SITE' WHERE sync_id = 't16-adm-a2'$q$),                -- 13
    public._t16_try($q$UPDATE public.t_users SET statut_actif = 0 WHERE sync_id = 't16-op-c'$q$),                              -- 14
    public._t16_try($q$UPDATE public.t_users SET statut_actif = 0 WHERE sync_id = 't16-adm-a'$q$),                             -- 15
    public._t16_try($q$DELETE FROM public.t_users WHERE sync_id = 't16-adm-a'$q$),                                             -- 16
    public._t16_try($q$UPDATE public.t_users SET nom_user = 'pirate' WHERE sync_id = 't16-sa-site-a'$q$),                      -- 17
    public._t16_try($q$UPDATE public.t_users SET sync_id = 't16-op-c-bis' WHERE sync_id = 't16-op-c'$q$),                      -- 18
    public._t16_try(format('UPDATE public.t_users SET site_id = %s, centre_id = %s WHERE sync_id = %L', v_sb, v_cb, 't16-op-e')), -- 19
    public._t16_try(format('UPDATE public.t_users SET centre_id = %s WHERE sync_id = %L', v_cb, 't16-op-e')),                  -- 20
    public._t16_try(format('UPDATE public.t_users SET centre_id = %s WHERE sync_id = %L', v_ca1, 't16-op-e'))                  -- 21
  ];
  EXECUTE 'RESET ROLE';
  SELECT string_agg(role, ',' ORDER BY role) INTO v_roles_a2_2 FROM public.t_user_roles WHERE user_sync_id = 't16-adm-a2';
  SELECT role INTO v_prim_a2 FROM public.t_users WHERE sync_id = 't16-adm-a2';
  EXECUTE 'SET LOCAL ROLE authenticated';
  r := r || ARRAY[
    public._t16_try($q$DELETE FROM public.t_users WHERE sync_id = 't16-adm-a2'$q$),                                            -- 22 (cascade des roles)
    public._t16_try($q$DELETE FROM public.t_users WHERE sync_id = 't16-op-d'$q$),                                              -- 23
    public._t16_try($q$UPDATE public.t_users SET login = 't16_adm_a_nouveau' WHERE sync_id = 't16-adm-a'$q$),                  -- 24
    public._t16_try($q$DELETE FROM public.t_user_roles WHERE user_sync_id = 't16-sa-site-a'$q$)                                -- 25
  ];
  EXECUTE 'RESET ROLE';
  INSERT INTO _t VALUES (6, 'ADMINISTRATEUR_SITE A : cree ADMIN_CENTRE / operateur de son site ; jamais ADMINISTRATEUR_SITE, SUPER ADMIN ni centre d''un autre site ; promeut en ADMIN_CENTRE, pas en ADMINISTRATEUR_SITE (principal ou secondaire) ; mot de passe d''un collegue admin permis ; cycle « tout effacer / upsert » garde le role ADMINISTRATEUR_SITE du collegue ; desactive un agent, pas lui-meme ; compte detenant SUPER ADMIN intouchable ; sync_id et site figes ; supprime un collegue (roles en cascade)',
    r[1] = 'ok:1' AND r[2] = 'ok:1' AND r[3] LIKE 'err:42501%' AND r[4] LIKE 'err:42501%' AND r[5] LIKE 'err:42501%'
      AND r[6] = 'ok:1' AND r[7] LIKE 'err:42501%' AND r[8] LIKE 'err:42501%' AND r[9] = 'ok:1' AND r[10] = 'ok:1'
      AND r[11] = 'ok:1' AND v_roles_a2_1 = 'ADMINISTRATEUR_SITE'
      AND r[12] = 'ok:3' AND r[13] = 'ok:1'
      AND v_roles_a2_2 = 'ADMINISTRATEUR_SITE,OPERATEUR_QUALITE,OPERATEUR_SAISIE' AND v_prim_a2 = 'ADMINISTRATEUR_SITE'
      AND r[14] = 'ok:1' AND r[15] LIKE 'err:42501%' AND r[16] LIKE 'err:42501%' AND r[17] LIKE 'err:42501%'
      AND r[18] LIKE 'err:42501%' AND r[19] LIKE 'err:42501%' AND r[20] LIKE 'err:42501%' AND r[21] = 'ok:1'
      AND r[22] = 'ok:1' AND r[23] = 'ok:1' AND r[24] = 'ok:1' AND r[25] LIKE 'err:42501%'
      AND (SELECT role || '|' || centre_id FROM public.t_users WHERE sync_id = 't16-new-ac') = 'ADMIN_CENTRE|' || v_ca1
      AND EXISTS (SELECT 1 FROM public.t_users WHERE sync_id = 't16-new-op')
      AND NOT EXISTS (SELECT 1 FROM public.t_users WHERE sync_id IN ('t16-x-as', 't16-x-sa', 't16-x-cb', 't16-op-c-bis'))
      AND (SELECT role || '|' || statut_actif FROM public.t_users WHERE sync_id = 't16-op-c') = 'ADMIN_CENTRE|0'
      AND (SELECT login || '|' || statut_actif FROM public.t_users WHERE sync_id = 't16-adm-a') = 't16_adm_a_nouveau|1'
      AND (SELECT nom_user FROM public.t_users WHERE sync_id = 't16-sa-site-a') = 'SA site A'
      AND (SELECT count(*) FROM public.t_user_roles WHERE user_sync_id = 't16-sa-site-a') = 2
      AND (SELECT site_id || '|' || centre_id FROM public.t_users WHERE sync_id = 't16-op-e') = v_sa || '|' || v_ca1
      AND NOT EXISTS (SELECT 1 FROM public.t_users WHERE sync_id IN ('t16-adm-a2', 't16-op-d'))
      AND NOT EXISTS (SELECT 1 FROM public.t_user_roles WHERE user_sync_id IN ('t16-adm-a2', 't16-op-d')),
    array_to_string(r, ' ') || ' | a2 apres effacement=' || coalesce(v_roles_a2_1, '-') || ' apres upsert=' || coalesce(v_roles_a2_2, '-'));

  -- =====================================================================
  -- 7. ADMINISTRATEUR_SITE du site B : rien sur le site A
  -- =====================================================================
  PERFORM set_config('request.jwt.claims', public._t16_c('t16-adm-b', v_sb, NULL, ARRAY['ADMINISTRATEUR_SITE']), true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  r := ARRAY[
    public._t16_try($q$UPDATE public.t_users SET nom_user = 'pirate', role = 'ADMIN_CENTRE' WHERE sync_id = 't16-op-a'$q$),
    public._t16_try($q$INSERT INTO public.t_user_roles (user_sync_id, role) VALUES ('t16-op-a', 'ADMIN_CENTRE')$q$),
    public._t16_try($q$DELETE FROM public.t_users WHERE sync_id = 't16-op-a'$q$),
    public._t16_try($q$DELETE FROM public.t_user_roles WHERE user_sync_id = 't16-op-a'$q$),
    public._t16_try($q$UPDATE public.t_users SET role = 'ADMIN_CENTRE' WHERE sync_id = 't16-op-b'$q$)];
  EXECUTE 'RESET ROLE';
  INSERT INTO _t VALUES (7, 'ADMINISTRATEUR_SITE B : comptes et roles du site A invisibles (0 ligne) ou refuses ; promotion en ADMIN_CENTRE sur son site permise',
    r[1] = 'ok:0' AND r[2] LIKE 'err:42501%' AND r[3] = 'ok:0' AND r[4] = 'ok:0' AND r[5] = 'ok:1'
      AND (SELECT nom_user || '|' || role FROM public.t_users WHERE sync_id = 't16-op-a') = 'Nom upsert|OPERATEUR_VERIFICATION'
      AND (SELECT count(*) FROM public.t_user_roles WHERE user_sync_id = 't16-op-a') = 1,
    array_to_string(r, ' '));

  -- =====================================================================
  -- 8. ADMIN_CENTRE du site A (centre A1)
  -- =====================================================================
  PERFORM set_config('request.jwt.claims', public._t16_c('t16-ac-a', v_sa, v_ca1, ARRAY['ADMIN_CENTRE']), true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  r := ARRAY[
    public._t16_try(format('INSERT INTO public.t_users (login, password_hash, role, statut_actif, site_id, centre_id, sync_id) VALUES (%L, %L, %L, 1, %s, %s, %L)',
                           't16_ac_new1', 'x-t16-x', 'OPERATEUR_LOGISTIQUE', v_sa, v_ca1, 't16-ac-new1')),                    -- 1
    public._t16_try(format('INSERT INTO public.t_users (login, password_hash, role, statut_actif, site_id, centre_id, sync_id) VALUES (%L, %L, %L, 1, %s, %s, %L)',
                           't16_ac_x2', 'x-t16-x', 'OPERATEUR_LOGISTIQUE', v_sa, v_ca2, 't16-ac-x2')),                        -- 2
    public._t16_try(format('INSERT INTO public.t_users (login, password_hash, role, statut_actif, site_id, centre_id, sync_id) VALUES (%L, %L, %L, 1, %s, %s, %L)',
                           't16_ac_x3', 'x-t16-x', 'ADMIN_CENTRE', v_sa, v_ca1, 't16-ac-x3')),                                -- 3
    public._t16_try($q$UPDATE public.t_users SET password_hash = 'x-t16-ac-set', updated_at = now() WHERE sync_id = 't16-op-a'$q$), -- 4
    public._t16_try($q$UPDATE public.t_users SET role = 'ADMIN_CENTRE' WHERE sync_id = 't16-op-a'$q$),                         -- 5
    public._t16_try($q$UPDATE public.t_users SET nom_user = 'pirate' WHERE sync_id = 't16-op-e'$q$),                           -- 6 (centre A1 depuis le cas 6 : permis)
    public._t16_try($q$UPDATE public.t_users SET nom_user = 'pirate' WHERE sync_id = 't16-new-op'$q$),                         -- 7 (centre A2)
    public._t16_try($q$UPDATE public.t_users SET nom_user = 'pirate' WHERE sync_id = 't16-adm-a'$q$),                          -- 8
    public._t16_try($q$DELETE FROM public.t_users WHERE sync_id = 't16-op-a'$q$),                                              -- 9
    public._t16_try($q$UPDATE public.t_users SET statut_actif = 0 WHERE sync_id = 't16-op-a'$q$),                              -- 10
    public._t16_try($q$INSERT INTO public.t_user_roles (user_sync_id, role) VALUES ('t16-op-a', 'OPERATEUR_SAISIE')$q$),       -- 11
    public._t16_try($q$INSERT INTO public.t_user_roles (user_sync_id, role) VALUES ('t16-op-a', 'ADMIN_CENTRE')$q$),           -- 12
    public._t16_try($q$UPDATE public.t_users SET password_hash = 'x-t16-ac-self', updated_at = now() WHERE sync_id = 't16-ac-a'$q$), -- 13
    public._t16_try($q$UPDATE public.t_users SET role = 'OPERATEUR_SAISIE' WHERE sync_id = 't16-ac-a'$q$),                     -- 14
    public._t16_try($q$UPDATE public.t_users SET login = 't16_ac_a_nouveau' WHERE sync_id = 't16-ac-a'$q$),                    -- 15
    public._t16_try($q$UPDATE public.t_users SET centre_id = NULL WHERE sync_id = 't16-op-a'$q$),                              -- 16
    public._t16_try($q$UPDATE public.t_users SET nom_user = 'pirate' WHERE sync_id = 't16-new-ac'$q$),                         -- 17 (autre ADMIN_CENTRE de son centre)
    public._t16_try($q$DELETE FROM public.t_user_roles WHERE user_sync_id = 't16-op-a'$q$)                                     -- 18
  ];
  EXECUTE 'RESET ROLE';
  INSERT INTO _t VALUES (8, 'ADMIN_CENTRE A1 : cree un operateur de son centre seulement, jamais un ADMIN_CENTRE ; mot de passe / statut / roles d''operateur de ses agents permis ; promotion, autre centre, administrateurs, suppression refuses ; son mot de passe permis, son role et son login refuses',
    r[1] = 'ok:1' AND r[2] LIKE 'err:42501%' AND r[3] LIKE 'err:42501%' AND r[4] = 'ok:1' AND r[5] LIKE 'err:42501%'
      AND r[6] = 'ok:1' AND r[7] LIKE 'err:42501%' AND r[8] LIKE 'err:42501%' AND r[9] LIKE 'err:42501%'
      AND r[10] = 'ok:1' AND r[11] = 'ok:1' AND r[12] LIKE 'err:42501%' AND r[13] = 'ok:1'
      AND r[14] LIKE 'err:42501%' AND r[15] LIKE 'err:42501%' AND r[16] LIKE 'err:42501%' AND r[17] LIKE 'err:42501%'
      AND r[18] = 'ok:2'
      AND (SELECT centre_id FROM public.t_users WHERE sync_id = 't16-ac-new1') = v_ca1
      AND NOT EXISTS (SELECT 1 FROM public.t_users WHERE sync_id IN ('t16-ac-x2', 't16-ac-x3'))
      AND (SELECT role || '|' || statut_actif || '|' || password_hash || '|' || centre_id FROM public.t_users WHERE sync_id = 't16-op-a')
          = 'OPERATEUR_VERIFICATION|0|x-t16-ac-set|' || v_ca1
      AND (SELECT role || '|' || login || '|' || password_hash FROM public.t_users WHERE sync_id = 't16-ac-a') = 'ADMIN_CENTRE|t16_ac_a|x-t16-ac-self'
      AND (SELECT nom_user FROM public.t_users WHERE sync_id = 't16-new-op') IS DISTINCT FROM 'pirate'
      AND (SELECT nom_user FROM public.t_users WHERE sync_id = 't16-adm-a') = 'Adm A'
      AND NOT EXISTS (SELECT 1 FROM public.t_user_roles WHERE user_sync_id = 't16-op-a'),
    array_to_string(r, ' '));

  -- =====================================================================
  -- 9. Multi-roles (OPERATEUR_VERIFICATION + ADMIN_CENTRE, centre A2) :
  --    droits d'ADMIN_CENTRE (union des roles, comme verifyUserRole)
  -- =====================================================================
  PERFORM set_config('request.jwt.claims', public._t16_c('t16-multi', v_sa, v_ca2, ARRAY['OPERATEUR_VERIFICATION', 'ADMIN_CENTRE']), true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  r := ARRAY[
    public._t16_try(format('INSERT INTO public.t_users (login, password_hash, role, statut_actif, site_id, centre_id, sync_id) VALUES (%L, %L, %L, 1, %s, %s, %L)',
                           't16_multi_new', 'x-t16-x', 'OPERATEUR_QUALITE', v_sa, v_ca2, 't16-multi-new')),
    public._t16_try(format('INSERT INTO public.t_users (login, password_hash, role, statut_actif, site_id, centre_id, sync_id) VALUES (%L, %L, %L, 1, %s, %s, %L)',
                           't16_multi_x', 'x-t16-x', 'ADMINISTRATEUR_SITE', v_sa, v_ca2, 't16-multi-x'))];
  EXECUTE 'RESET ROLE';
  INSERT INTO _t VALUES (9, 'Multi-roles operateur + ADMIN_CENTRE : cree un operateur de son centre, pas un ADMINISTRATEUR_SITE',
    r[1] = 'ok:1' AND r[2] LIKE 'err:42501%'
      AND EXISTS (SELECT 1 FROM public.t_users WHERE sync_id = 't16-multi-new')
      AND NOT EXISTS (SELECT 1 FROM public.t_users WHERE sync_id = 't16-multi-x'),
    array_to_string(r, ' '));

  -- =====================================================================
  -- 10. SUPER ADMIN verifie : 0016 ne s'applique pas (0015 inchange)
  -- =====================================================================
  PERFORM set_config('request.jwt.claims', public._t16_c('t16-sa1', NULL, NULL, ARRAY['SUPER ADMIN'], true), true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  r := ARRAY[
    public._t16_try(format('INSERT INTO public.t_users (login, password_hash, role, statut_actif, site_id, sync_id) VALUES (%L, %L, %L, 1, %s, %L)',
                           't16_sa_new_as', 'x-t16-x', 'ADMINISTRATEUR_SITE', v_sa, 't16-sa-new-as')),
    public._t16_try($q$UPDATE public.t_users SET role = 'ADMINISTRATEUR_SITE' WHERE sync_id = 't16-op-c'$q$),
    public._t16_try($q$INSERT INTO public.t_user_roles (user_sync_id, role) VALUES ('t16-op-e', 'ADMINISTRATEUR_SITE')$q$),
    public._t16_try(format('UPDATE public.t_users SET site_id = %s, centre_id = NULL WHERE sync_id = %L', v_sb, 't16-new-op'))];
  EXECUTE 'RESET ROLE';
  INSERT INTO _t VALUES (10, 'SUPER ADMIN verifie : cree un ADMINISTRATEUR_SITE, promeut, ajoute un role ADMINISTRATEUR_SITE, change le site d''un agent (0016 inactif pour lui)',
    r = ARRAY['ok:1','ok:1','ok:1','ok:1']
      AND (SELECT role FROM public.t_users WHERE sync_id = 't16-sa-new-as') = 'ADMINISTRATEUR_SITE'
      AND (SELECT role FROM public.t_users WHERE sync_id = 't16-op-c') = 'ADMINISTRATEUR_SITE'
      AND EXISTS (SELECT 1 FROM public.t_user_roles WHERE user_sync_id = 't16-op-e' AND role = 'ADMINISTRATEUR_SITE')
      AND (SELECT site_id FROM public.t_users WHERE sync_id = 't16-new-op') = v_sb,
    array_to_string(r, ' '));

  -- =====================================================================
  -- 11. Jeton SUPER ADMIN NON verifie (compte non SA en base) : echec ferme
  -- =====================================================================
  PERFORM set_config('request.jwt.claims', public._t16_c('t16-op-b', v_sb, v_cb, ARRAY['SUPER ADMIN'], true), true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  r := ARRAY[
    public._t16_try(format('INSERT INTO public.t_users (login, password_hash, role, statut_actif, site_id, sync_id) VALUES (%L, %L, %L, 1, %s, %L)',
                           't16_saf_new', 'x-t16-x', 'OPERATEUR_SAISIE', v_sb, 't16-saf-new')),
    public._t16_try($q$UPDATE public.t_users SET role = 'ADMINISTRATEUR_SITE' WHERE sync_id = 't16-op-b'$q$),
    public._t16_try($q$INSERT INTO public.t_user_roles (user_sync_id, role) VALUES ('t16-op-b', 'ADMIN_CENTRE')$q$)];
  EXECUTE 'RESET ROLE';
  INSERT INTO _t VALUES (11, 'Jeton SUPER ADMIN non verifie en base : creation, promotion, role refuses (42501)',
    r[1] LIKE 'err:42501%' AND r[2] LIKE 'err:42501%' AND r[3] LIKE 'err:42501%'
      AND NOT EXISTS (SELECT 1 FROM public.t_users WHERE sync_id = 't16-saf-new')
      AND (SELECT role FROM public.t_users WHERE sync_id = 't16-op-b') = 'ADMIN_CENTRE',
    array_to_string(r, ' '));

  -- =====================================================================
  -- 12. service_role et postgres sans claims : non filtres (inchanges)
  -- =====================================================================
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  EXECUTE 'SET LOCAL ROLE service_role';
  r := ARRAY[public._t16_try($q$UPDATE public.t_users SET role = 'OPERATEUR_QUALITE' WHERE sync_id = 't16-op-e'$q$)];
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', '', true);
  r := r || public._t16_try($q$UPDATE public.t_users SET role = 'ADMINISTRATEUR_SITE' WHERE sync_id = 't16-op-e'$q$);
  r := r || public._t16_try($q$DELETE FROM public.t_user_roles WHERE user_sync_id = 't16-op-e' AND role = 'ADMINISTRATEUR_SITE'$q$);
  INSERT INTO _t VALUES (12, 'service_role puis postgres sans claims : ecritures non filtrees par 0016',
    r = ARRAY['ok:1','ok:1','ok:1']
      AND (SELECT role FROM public.t_users WHERE sync_id = 't16-op-e') = 'ADMINISTRATEUR_SITE',
    array_to_string(r, ' '));

  -- =====================================================================
  -- 14. postgres avec des claims authenticated simulees, SANS SET ROLE :
  --     non filtre (0016 suit le role SQL, comme une politique TO authenticated)
  -- =====================================================================
  PERFORM set_config('request.jwt.claims', public._t16_c('t16-op-b', v_sb, v_cb, ARRAY['OPERATEUR_VERIFICATION']), true);
  r := ARRAY[public._t16_try($q$UPDATE public.t_users SET role = 'OPERATEUR_SAISIE' WHERE sync_id = 't16-op-b'$q$)];
  PERFORM set_config('request.jwt.claims', '', true);
  INSERT INTO _t VALUES (14, 'postgres avec claims d''operateur simulees (sans SET ROLE) : non filtre par 0016',
    r = ARRAY['ok:1'] AND (SELECT role FROM public.t_users WHERE sync_id = 't16-op-b') = 'OPERATEUR_SAISIE',
    array_to_string(r, ' '));

  -- =====================================================================
  -- 13. Aucune valeur de mot de passe dans le journal 0007
  -- =====================================================================
  INSERT INTO _t VALUES (13, 'Journal 0007 : aucune valeur x-t16-* ni cle password_hash',
    NOT EXISTS (SELECT 1 FROM public.t_security_guard_events
                 WHERE attempted::text LIKE '%x-t16-%' OR attempted ? 'password_hash'),
    NULL);

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
    RAISE EXCEPTION 'TEST 0016 ECHEC : cas en erreur : %', v_ko;
  END IF;
  RAISE NOTICE 'TEST 0016 OK (% cas)', (SELECT count(*) FROM _t);
END;
$$;

ROLLBACK;
