-- ============================================================
-- Test de supabase/migrations/0020_fonctions_mobile_verification.sql
-- A executer sur le projet DEV uniquement (ajadkziqaskadlzboeqo), apres
-- 0019 et 0020, dans le SQL Editor (role postgres). Transaction ANNULEE
-- (ROLLBACK final) : aucune ligne ne reste (sites, centres, comptes,
-- cartes, journaux 't20*', fonctions d'aide public._t20_*, compteurs 0008).
--
-- Methode : claims simulees dans request.jwt.claims (comme PostgREST) ;
-- appels directs des fonctions (SECURITY DEFINER : meme comportement quel
-- que soit l'appelant) et, pour les droits, vrais SET LOCAL ROLE
-- authenticated / anon. Les delivrances CONCURRENTES (deux sessions) ne sont
-- pas possibles dans une seule transaction : elles sont prouvees par les
-- appels REST reels (README, section 0020) ; ici : delivrances SUCCESSIVES.
-- Resultat : table _t, puis un bloc qui LEVE UNE ERREUR si un cas vaut false.
-- NE JAMAIS EXECUTER EN PROD.
-- ============================================================
BEGIN;

CREATE TEMP TABLE _t (n INT, cas TEXT, ok BOOLEAN, detail TEXT) ON COMMIT DROP;

CREATE FUNCTION public._t20_c(p_sid TEXT, p_site BIGINT, p_centre BIGINT, p_roles TEXT[]) RETURNS TEXT
LANGUAGE sql AS $f$
  SELECT jsonb_build_object('role','authenticated','aud','authenticated',
           'sub','00000000-0000-0000-0000-000000000020',
           'gis_v',1,'gis_sync_id',p_sid,'gis_site_id',p_site,'gis_centre_id',p_centre,
           'gis_primary_role',p_roles[1],'gis_roles',to_jsonb(p_roles),
           'gis_is_super_admin',false,'gis_statut_actif',true)::text
$f$;

-- Delivrance sous des claims ; erreur -> {"err": SQLSTATE}.
CREATE FUNCTION public._t20_d(p_claims TEXT, p_sync TEXT, p_type TEXT, p_nom TEXT, p_tel TEXT, p_rang TEXT, p_req UUID) RETURNS JSONB
LANGUAGE plpgsql AS $f$
DECLARE
  v JSONB;
BEGIN
  PERFORM set_config('request.jwt.claims', p_claims, true);
  v := public.fn_mobile_delivrer_carte(p_sync, p_type, p_nom, p_tel, p_rang, p_req);
  PERFORM set_config('request.jwt.claims', '', true);
  RETURN v;
EXCEPTION WHEN others THEN
  PERFORM set_config('request.jwt.claims', '', true);
  RETURN jsonb_build_object('err', SQLSTATE);
END;
$f$;

CREATE FUNCTION public._t20_s(p_claims TEXT, p_nom TEXT, p_ddn DATE, p_tel TEXT) RETURNS JSONB
LANGUAGE plpgsql AS $f$
DECLARE
  v JSONB;
BEGIN
  PERFORM set_config('request.jwt.claims', p_claims, true);
  v := public.fn_mobile_rechercher_cartes(p_nom, p_ddn, p_tel);
  PERFORM set_config('request.jwt.claims', '', true);
  RETURN v;
EXCEPTION WHEN others THEN
  PERFORM set_config('request.jwt.claims', '', true);
  RETURN jsonb_build_object('err', SQLSTATE);
END;
$f$;

DO $$
DECLARE
  v_sa BIGINT; v_sb BIGINT; v_c1 BIGINT; v_c2 BIGINT; v_cb BIGINT;
  c_op TEXT; c_inact TEXT; c_saisie TEXT; c_retire TEXT; c_nog TEXT; c_forge TEXT; c_ob TEXT;
  r JSONB; r2 JSONB; r3 JSONB;
  q1 UUID := gen_random_uuid();
  q2 UUID := gen_random_uuid();
  k RECORD;
  n1 BIGINT; n2 BIGINT; n3 BIGINT;
  t1 TIMESTAMPTZ;
  s TEXT;
BEGIN
  PERFORM set_config('request.jwt.claims', '', true);

  -- ---------- 0. Structure et droits ----------
  INSERT INTO _t VALUES (0, '5 fonctions ; operateur / recherche / delivrance SECURITY DEFINER ; search_path vide partout ; EXECUTE : authenticated sur les 2 fonctions publiques seulement ; anon sur aucune ; aides fermees a authenticated',
    (SELECT count(*) = 5 AND bool_and(p.proconfig @> ARRAY['search_path=""'])
       FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn\_mobile\_%')
    AND (SELECT bool_and(p.prosecdef) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
          AND p.proname IN ('fn_mobile_operateur','fn_mobile_rechercher_cartes','fn_mobile_delivrer_carte'))
    AND has_function_privilege('authenticated', 'public.fn_mobile_rechercher_cartes(text,date,text)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.fn_mobile_delivrer_carte(text,text,text,text,text,uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.fn_mobile_rechercher_cartes(text,date,text)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.fn_mobile_delivrer_carte(text,text,text,text,text,uuid)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.fn_mobile_operateur()', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.fn_mobile_masque(text)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.fn_mobile_tel_chiffres(text)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.fn_mobile_operateur()', 'EXECUTE'),
    (SELECT string_agg(p.proname || ':' || p.prosecdef || ':' || COALESCE(array_to_string(p.proconfig, ';'), ''), ' ')
       FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn\_mobile\_%'));

  -- ---------- Jeu de test (postgres, sans JWT) ----------
  INSERT INTO public.t_sites (nom, code, sync_id, is_active) VALUES ('T20 SITE A', 'T20A', 't20-site-a', 1) RETURNING id INTO v_sa;
  INSERT INTO public.t_sites (nom, code, sync_id, is_active) VALUES ('T20 SITE B', 'T20B', 't20-site-b', 1) RETURNING id INTO v_sb;
  INSERT INTO public.t_centres (site_id, nom, numero, prefixe_rangement, sync_id)
    VALUES (v_sa, 'T20 CENTRE A1', 1, 'A1-, A2', 't20-cen-a1') RETURNING id INTO v_c1;
  INSERT INTO public.t_centres (site_id, nom, numero, prefixe_rangement, sync_id)
    VALUES (v_sa, 'T20 CENTRE A2', 2, 'A2-,A2-X', 't20-cen-a2') RETURNING id INTO v_c2;
  INSERT INTO public.t_centres (site_id, nom, numero, prefixe_rangement, sync_id)
    VALUES (v_sb, 'T20 CENTRE B', 1, 'A2-X', 't20-cen-b') RETURNING id INTO v_cb;
  INSERT INTO public.t_users (login, password_hash, role, statut_actif, site_id, centre_id, sync_id) VALUES
    ('t20_op',     'x-t20', 'OPERATEUR_VERIFICATION', 1, v_sa, v_c1, 't20-u-op'),
    ('t20_inact',  'x-t20', 'OPERATEUR_VERIFICATION', 0, v_sa, v_c1, 't20-u-inact'),
    ('t20_saisie', 'x-t20', 'OPERATEUR_SAISIE',       1, v_sa, v_c1, 't20-u-saisie'),
    ('t20_retire', 'x-t20', 'OPERATEUR_QUALITE',      1, v_sa, v_c1, 't20-u-retire'),
    ('t20_ob',     'x-t20', 'OPERATEUR_QUALITE',      1, v_sb, v_cb, 't20-u-ob');
  INSERT INTO public.t_user_roles (user_sync_id, role) VALUES ('t20-u-ob', 'OPERATEUR_VERIFICATION');

  INSERT INTO public.t_cartes (sync_id, noms, prenoms, date_naissance, lieu_naissance, num_secu, contact,
                               rangement, statut, statut_physique, id_site, id_centre, updated_at) VALUES
    ('t20-c1',  'KOUASSI', 'JEAN MARC', '1990-01-01', 'ABOBO', 'T20SECRETNUMSECU', '0701020304', 'A1-01', 'EN STOCK', 'OK', v_sa, v_c1, now() - INTERVAL '1 day'),
    ('t20-c2',  'KOUASSI', 'PAUL',      '1990-01-01', 'ABOBO', 'T20SECRET2', '0102030405', 'A2-05', 'EN STOCK', 'OK', v_sa, v_c2, now() - INTERVAL '1 day'),
    ('t20-c3',  'KOUASSI', 'JEAN MARC', '1990-01-01', 'ABOBO', 'T20SECRET3', '0701020304', 'A2-X1', 'EN STOCK', 'OK', v_sb, v_cb, now() - INTERVAL '1 day'),
    ('t20-c4',  'BAMBA',   'AMINATA',   '1985-05-05', NULL, NULL, '0505050505', NULL,          'EN STOCK', 'OK', v_sa, v_c1, now() - INTERVAL '1 day'),
    ('t20-c4b', 'BAMBA',   'MARIAM',    '1985-05-05', NULL, NULL, '0505050506', 'NON CLASSE',  'EN STOCK', 'OK', v_sa, NULL, now() - INTERVAL '1 day'),
    ('t20-c5',  'DIALLO',  'A',         '1970-01-01', NULL, NULL, NULL, 'A1-02', 'DOUBLON',  'OK',     v_sa, v_c1, now() - INTERVAL '1 day'),
    ('t20-c6',  'DIALLO',  'B',         '1970-01-01', NULL, NULL, NULL, 'A1-03', 'EN STOCK', 'ABSENT', v_sa, v_c1, now() - INTERVAL '1 day'),
    ('t20-c7',  'DIALLO',  'C',         '1970-01-01', NULL, NULL, NULL, 'A1-04', 'EN STOCK', 'PERDUE', v_sa, v_c1, now() - INTERVAL '1 day'),
    ('t20-c8',  'DIALLO',  'D',         '1970-01-01', NULL, NULL, NULL, 'A1-05', 'ANNULE',   'OK',     v_sa, v_c1, now() - INTERVAL '1 day'),
    ('t20-c9',  'DIALLO',  'E',         '1970-01-01', NULL, NULL, NULL, 'A1-06', 'DELIVRE',  'OK',     v_sa, v_c1, now() - INTERVAL '1 day'),
    ('t20-c10', 'KONE',    'ISSA',      '1980-02-02', NULL, NULL, '0708090102', 'A1-07', 'EN STOCK', 'OK', v_sa, v_c1, now() - INTERVAL '1 day'),
    ('t20-c11', 'KONE',    'AWA',       '1980-02-02', NULL, NULL, NULL,         'A1-08', 'EN STOCK', 'OK', v_sa, v_c1, now() - INTERVAL '1 day'),
    ('t20-c12', 'KONE',    'ALI',       '1980-02-02', NULL, NULL, '0708090103', 'A1-09', 'EN STOCK', 'OK', v_sa, v_c1, now() - INTERVAL '1 day'),
    ('t20-c13', 'KONE',    'SALI',      '1980-02-02', NULL, NULL, '+225 07 08 09 01 04', 'A1-10', 'EN STOCK', 'OK', v_sa, v_c1, now() - INTERVAL '1 day'),
    ('t20-c14', 'YAO',     'FUTUR',     '1980-02-02', NULL, NULL, NULL, 'A1-11', 'EN STOCK', 'OK', v_sa, v_c1, now() + INTERVAL '1 hour');
  UPDATE public.t_cartes SET date_delivrance = now() - INTERVAL '2 days', agent_distributeur = 'POSTE'
   WHERE sync_id = 't20-c9';
  -- c15 : garde 0006 (donnee incoherente : carte EN STOCK portant une date de
  -- delivrance FUTURE -> evenement de la nouvelle ligne plus ancien, garde 0006 refuse)
  INSERT INTO public.t_cartes (sync_id, noms, prenoms, date_naissance, rangement, statut, statut_physique,
                               id_site, id_centre, date_delivrance, updated_at)
  VALUES ('t20-c15', 'YAO', 'GARDE', '1980-02-02', 'A1-12', 'EN STOCK', 'OK', v_sa, v_c1,
          now() + INTERVAL '1 day', now() - INTERVAL '1 day');
  -- 12 homonymes pour la limite (7 centre A2, 5 centre A1 de l'operateur)
  INSERT INTO public.t_cartes (sync_id, noms, prenoms, date_naissance, rangement, statut, id_site, id_centre)
  SELECT 't20-h' || g, 'TRAORE', 'AWA ' || g, '2000-03-03', 'A1-H' || g, 'EN STOCK', v_sa,
         CASE WHEN g <= 7 THEN v_c2 ELSE v_c1 END
    FROM generate_series(1, 12) g;

  c_op     := public._t20_c('t20-u-op',     v_sa, v_c1, ARRAY['OPERATEUR_VERIFICATION']);
  c_inact  := public._t20_c('t20-u-inact',  v_sa, v_c1, ARRAY['OPERATEUR_VERIFICATION']);
  c_saisie := public._t20_c('t20-u-saisie', v_sa, v_c1, ARRAY['OPERATEUR_SAISIE']);
  c_retire := public._t20_c('t20-u-retire', v_sa, v_c1, ARRAY['OPERATEUR_VERIFICATION','OPERATEUR_QUALITE']);
  c_ob     := public._t20_c('t20-u-ob',     v_sb, v_cb, ARRAY['OPERATEUR_QUALITE','OPERATEUR_VERIFICATION']);
  c_nog    := '{"role":"authenticated","aud":"authenticated","sub":"00000000-0000-0000-0000-000000000020"}';
  c_forge  := jsonb_build_object('role','authenticated','gis_sync_id','t20-u-op','gis_site_id',v_sa,
                'gis_roles',jsonb_build_array('OPERATEUR_VERIFICATION'))::text;

  n3 := (SELECT count(*) FROM public.t_sync_conflicts);

  -- =====================================================================
  -- RECHERCHE
  -- =====================================================================
  r := public._t20_s(c_op, '  kouassi   jean ', '1990-01-01', NULL);
  INSERT INTO _t VALUES (1, 'Recherche nom + date : 1er mot = nom exact (majuscules, espaces nettoyes), prenom en inclusion ; site du jeton seulement (homonyme du site B absent) ; KOUASSI PAUL exclu (prenom)',
    r ->> 'code' = 'OK' AND (r ->> 'inversion')::boolean = false
      AND jsonb_array_length(r -> 'resultats') = 1
      AND r -> 'resultats' -> 0 ->> 'sync_id' = 't20-c1'
      AND (r -> 'resultats' -> 0 ->> 'meme_centre')::boolean
      AND r -> 'resultats' -> 0 ->> 'centre_nom' = 'T20 CENTRE A1',
    left(r::text, 300));

  INSERT INTO _t VALUES (2, 'Q6 : aucune cle num_secu ni valeur num_secu dans la reponse ; contact masque « ********04 » ; contact en clair absent',
    NOT (r -> 'resultats' -> 0 ? 'num_secu') AND NOT (r -> 'resultats' -> 0 ? 'contact')
      AND strpos(r::text, 'T20SECRET') = 0 AND strpos(r::text, '0701020304') = 0
      AND r -> 'resultats' -> 0 ->> 'contact_masque' = '********04',
    r -> 'resultats' -> 0 ->> 'contact_masque');

  r := public._t20_s(c_op, 'KOUASSI', '1990-01-01', NULL);
  INSERT INTO _t VALUES (3, 'Recherche nom seul (sans prenom) : tous les KOUASSI du site A a cette date (2), centre de l''operateur d''abord',
    r ->> 'code' = 'OK' AND jsonb_array_length(r -> 'resultats') = 2
      AND r -> 'resultats' -> 0 ->> 'sync_id' = 't20-c1' AND r -> 'resultats' -> 1 ->> 'sync_id' = 't20-c2',
    left(r::text, 200));

  r := public._t20_s(c_op, 'JEAN KOUASSI', '1990-01-01', NULL);
  INSERT INTO _t VALUES (4, 'Inversion nom / prenom : « JEAN KOUASSI » -> carte KOUASSI JEAN MARC, inversion = true',
    r ->> 'code' = 'OK' AND (r ->> 'inversion')::boolean
      AND jsonb_array_length(r -> 'resultats') = 1 AND r -> 'resultats' -> 0 ->> 'sync_id' = 't20-c1',
    left(r::text, 200));

  r := public._t20_s(c_op, 'KOUASSI JEAN', '1991-01-01', NULL);
  r2 := public._t20_s(c_op, 'KOUASSI', NULL, NULL);
  r3 := public._t20_s(c_op, NULL, NULL, NULL);
  INSERT INTO _t VALUES (5, 'Mauvaise date : 0 resultat ; nom sans date / aucun critere : PARAMETRES_INVALIDES',
    r ->> 'code' = 'OK' AND jsonb_array_length(r -> 'resultats') = 0 AND (r ->> 'inversion')::boolean = false
      AND r2 ->> 'code' = 'PARAMETRES_INVALIDES' AND r3 ->> 'code' = 'PARAMETRES_INVALIDES',
    concat_ws(' ', r::text, r2::text, r3::text));

  r := public._t20_s(c_op, NULL, NULL, '+225 07 01 02 03 04');
  r2 := public._t20_s(c_op, NULL, NULL, '0701 02');
  INSERT INTO _t VALUES (6, 'Recherche par telephone (prefixe 225 retire, 10 chiffres) : la carte du site A seulement ; 6 chiffres : PARAMETRES_INVALIDES',
    r ->> 'code' = 'OK' AND r ->> 'mode' = 'TEL' AND jsonb_array_length(r -> 'resultats') = 1
      AND r -> 'resultats' -> 0 ->> 'sync_id' = 't20-c1'
      AND r2 ->> 'code' = 'PARAMETRES_INVALIDES',
    concat_ws(' ', left(r::text, 150), r2::text));

  r := public._t20_s(c_op, 'TRAORE AWA', '2000-03-03', NULL);
  s := (SELECT string_agg((e ->> 'meme_centre'), ',' ORDER BY o) FROM jsonb_array_elements(r -> 'resultats') WITH ORDINALITY x(e, o));
  INSERT INTO _t VALUES (7, 'Limite : 12 homonymes -> 10 lignes, tronque = true ; les 5 du centre de l''operateur d''abord',
    r ->> 'code' = 'OK' AND jsonb_array_length(r -> 'resultats') = 10 AND (r ->> 'tronque')::boolean
      AND s = 'true,true,true,true,true,false,false,false,false,false',
    s);

  INSERT INTO _t VALUES (8, 'Journal VERIFICATION_RECHERCHE : une ligne par recherche reussie (6 ci-dessus), canal MOBILE, login de l''operateur, site A, sans nom ni telephone recherche',
    (SELECT count(*) FROM public.t_logs WHERE action = 'VERIFICATION_RECHERCHE' AND login_user = 't20_op' AND site_id = v_sa) = 6
      AND NOT EXISTS (SELECT 1 FROM public.t_logs WHERE action = 'VERIFICATION_RECHERCHE' AND login_user = 't20_op'
                        AND (detail NOT LIKE '%"canal": "MOBILE"%' OR detail LIKE '%KOUASSI%' OR detail LIKE '%0701%')),
    (SELECT count(*)::text FROM public.t_logs WHERE action = 'VERIFICATION_RECHERCHE' AND login_user = 't20_op'));

  -- =====================================================================
  -- DELIVRANCE
  -- =====================================================================
  t1 := (SELECT updated_at FROM public.t_cartes WHERE sync_id = 't20-c1');
  r := public._t20_d(c_op, 't20-c1', 'assure', 'kouassi jean marc', NULL, NULL, q1);
  SELECT * INTO k FROM public.t_cartes WHERE sync_id = 't20-c1';
  INSERT INTO _t VALUES (9, 'Delivrance ASSURE sans telephone : OK ; DELIVRE, date, agent = login relu, retirant en majuscules, num_retirant = contact de la fiche (non renvoye), contact inchange, centre_retrait = centre de l''operateur, updated_at avance, action_at pose',
    r ->> 'code' = 'OK' AND (r ->> 'reessai')::boolean = false AND strpos(r::text, '0701020304') = 0
      AND k.statut = 'DELIVRE' AND k.date_delivrance = now() AND k.agent_distributeur = 't20_op'
      AND k.nom_retirant = 'KOUASSI JEAN MARC' AND k.num_retirant = '0701020304' AND k.contact_retirant = '0701020304'
      AND k.contact = '0701020304' AND k.centre_retrait = 'T20 CENTRE A1' AND k.updated_at > t1
      AND k.action_at = now() AND k.id_centre = v_c1 AND k.rangement = 'A1-01',
    left(r::text, 250));

  INSERT INTO _t VALUES (10, 'Journal CARTE_DELIVREE : 1 ligne, cles de handlers.ts (id_carte, nom_retirant, num_retirant, agent_distributeur) + canal MOBILE, sync_id, request_id ; num_retirant MASQUE ; site de la carte, centre de l''operateur ; aucun conflit 0006',
    (SELECT count(*) FROM public.t_logs l WHERE l.action = 'CARTE_DELIVREE' AND l.site_id = v_sa AND l.centre_id = v_c1
        AND l.login_user = 't20_op' AND l.id_user IS NULL
        AND (l.detail::jsonb) ?& ARRAY['id_carte','nom_retirant','num_retirant','agent_distributeur','canal','sync_id','request_id']
        AND l.detail::jsonb ->> 'canal' = 'MOBILE' AND l.detail::jsonb ->> 'request_id' = q1::text
        AND l.detail::jsonb ->> 'num_retirant' = '********04'
        AND (l.detail::jsonb ->> 'id_carte')::bigint = k.id_carte) = 1
      AND (SELECT count(*) FROM public.t_sync_conflicts) = n3,
    (SELECT string_agg(detail, ' | ') FROM public.t_logs WHERE action = 'CARTE_DELIVREE' AND login_user = 't20_op'));

  r  := public._t20_d(c_op, 't20-c1', 'TIERS', 'AUTRE', '0102030405', NULL, q2);
  r2 := public._t20_d(c_op, 't20-c1', 'ASSURE', 'KOUASSI JEAN MARC', NULL, NULL, q1);
  INSERT INTO _t VALUES (11, 'Seconde delivrance successive (autre request_id) : DEJA_DELIVREE, preuve inchangee ; reessai du MEME request_id : OK reessai = true, aucune nouvelle ecriture',
    r ->> 'code' = 'DEJA_DELIVREE' AND r2 ->> 'code' = 'OK' AND (r2 ->> 'reessai')::boolean
      AND (SELECT nom_retirant FROM public.t_cartes WHERE sync_id = 't20-c1') = 'KOUASSI JEAN MARC'
      AND (SELECT count(*) FROM public.t_logs WHERE action = 'CARTE_DELIVREE' AND detail LIKE '%"t20-c1"%') = 1,
    concat_ws(' ', r::text, left(r2::text, 120)));

  r  := public._t20_d(c_ob, 't20-c1', 'ASSURE', 'X', NULL, NULL, q1);
  INSERT INTO _t VALUES (12, 'Meme request_id rejoue par un AUTRE agent (autre site) : HORS_SITE (le reessai ne vaut que pour son auteur)',
    r ->> 'code' = 'HORS_SITE', r::text);

  r  := public._t20_d(c_op, 't20-c2', 'ASSURE', 'KOUASSI PAUL', NULL, NULL, gen_random_uuid());
  r2 := public._t20_d(c_op, 't20-c3', 'ASSURE', 'KOUASSI JEAN MARC', NULL, NULL, gen_random_uuid());
  r3 := public._t20_d(c_op, 't20-inconnue', 'ASSURE', 'X', NULL, NULL, gen_random_uuid());
  INSERT INTO _t VALUES (13, 'Carte classee d''un autre centre : HORS_CENTRE ; carte d''un autre site : HORS_SITE ; sync_id inconnu : INTROUVABLE ; aucune ecriture',
    r ->> 'code' = 'HORS_CENTRE' AND r2 ->> 'code' = 'HORS_SITE' AND r3 ->> 'code' = 'INTROUVABLE'
      AND (SELECT count(*) FROM public.t_cartes WHERE sync_id IN ('t20-c2','t20-c3') AND statut = 'EN STOCK') = 2,
    concat_ws(' ', r::text, r2::text, r3::text));

  r  := public._t20_d(c_op, 't20-c4', 'ASSURE', 'BAMBA AMINATA', NULL, NULL, gen_random_uuid());
  r2 := public._t20_d(c_op, 't20-c4', 'ASSURE', 'BAMBA AMINATA', NULL, 'NON CLASSE', gen_random_uuid());
  r3 := public._t20_d(c_op, 't20-c4', 'ASSURE', 'BAMBA AMINATA', NULL, ' a2-x9 ', gen_random_uuid());
  SELECT * INTO k FROM public.t_cartes WHERE sync_id = 't20-c4';
  INSERT INTO _t VALUES (14, 'Carte non classee : sans rangement d''urgence (ou « NON CLASSE ») -> RANGEMENT_REQUIS ; avec « a2-x9 » -> OK, rangement A2-X9, centre recalcule = centre du prefixe le plus long (A2-X, centre A2, pas A2 du centre A1 ni A2-X du site B), journal CENTRE_CARTE_RECALCULE',
    r ->> 'code' = 'RANGEMENT_REQUIS' AND r2 ->> 'code' = 'RANGEMENT_REQUIS' AND r3 ->> 'code' = 'OK'
      AND (r3 ->> 'centre_recalcule')::boolean AND k.statut = 'DELIVRE' AND k.rangement = 'A2-X9' AND k.id_centre = v_c2
      AND (SELECT count(*) FROM public.t_logs WHERE action = 'CENTRE_CARTE_RECALCULE' AND site_id = v_sa AND centre_id = v_c2
             AND (valeur_apres::jsonb ->> 'centre_id_avant')::bigint = v_c1
             AND (valeur_apres::jsonb ->> 'centre_id_apres')::bigint = v_c2) = 1,
    concat_ws(' ', r::text, r2::text, left(r3::text, 150), k.id_centre::text));

  r := public._t20_d(c_op, 't20-c4b', 'ASSURE', 'BAMBA MARIAM', NULL, 'QQ1', gen_random_uuid());
  SELECT * INTO k FROM public.t_cartes WHERE sync_id = 't20-c4b';
  INSERT INTO _t VALUES (15, 'Carte non classee, rangement sans prefixe connu : centre de l''operateur (repli :763), journal CENTRE_CARTE_RECALCULE (NULL -> A1)',
    r ->> 'code' = 'OK' AND k.id_centre = v_c1 AND k.rangement = 'QQ1'
      AND EXISTS (SELECT 1 FROM public.t_logs WHERE action = 'CENTRE_CARTE_RECALCULE' AND valeur_apres LIKE '%"t20-c4b"%'),
    left(r::text, 150));

  r  := public._t20_d(c_op, 't20-c5', 'ASSURE', 'DIALLO A', '0700000000', NULL, gen_random_uuid());
  r2 := public._t20_d(c_op, 't20-c6', 'ASSURE', 'DIALLO B', '0700000000', NULL, gen_random_uuid());
  r3 := public._t20_d(c_op, 't20-c7', 'ASSURE', 'DIALLO C', '0700000000', NULL, gen_random_uuid());
  INSERT INTO _t VALUES (16, 'DOUBLON -> DOUBLON ; statut_physique ABSENT -> ABSENTE ; PERDUE -> ABSENTE (Q5) ; aucune ecriture',
    r ->> 'code' = 'DOUBLON' AND r2 ->> 'code' = 'ABSENTE' AND r3 ->> 'code' = 'ABSENTE'
      AND (SELECT count(*) FROM public.t_cartes WHERE sync_id IN ('t20-c6','t20-c7') AND statut = 'EN STOCK') = 2,
    concat_ws(' ', r::text, r2::text, r3::text));

  r  := public._t20_d(c_op, 't20-c8', 'ASSURE', 'DIALLO D', '0700000000', NULL, gen_random_uuid());
  r2 := public._t20_d(c_op, 't20-c9', 'ASSURE', 'DIALLO E', '0700000000', NULL, gen_random_uuid());
  INSERT INTO _t VALUES (17, 'Statut ANNULE -> STATUT_INVALIDE ; carte deja delivree par un poste -> DEJA_DELIVREE (preuve du poste conservee)',
    r ->> 'code' = 'STATUT_INVALIDE' AND r2 ->> 'code' = 'DEJA_DELIVREE'
      AND (SELECT agent_distributeur FROM public.t_cartes WHERE sync_id = 't20-c9') = 'POSTE',
    concat_ws(' ', r::text, r2::text));

  r  := public._t20_d(c_op, 't20-c10', 'TIERS', 'tiers un', NULL, NULL, gen_random_uuid());
  r2 := public._t20_d(c_op, 't20-c10', 'TIERS', 'tiers un', '07 08 09', NULL, gen_random_uuid());
  r3 := public._t20_d(c_op, 't20-c10', 'TIERS', 'tiers un', '+225 0102030405', NULL, gen_random_uuid());
  SELECT * INTO k FROM public.t_cartes WHERE sync_id = 't20-c10';
  INSERT INTO _t VALUES (18, 'TIERS : telephone absent ou incomplet -> PARAMETRES_INVALIDES ; 10 chiffres -> OK, num_retirant « +225 01 02 03 04 05 », contact de la fiche INCHANGE',
    r ->> 'code' = 'PARAMETRES_INVALIDES' AND r2 ->> 'code' = 'PARAMETRES_INVALIDES' AND r3 ->> 'code' = 'OK'
      AND k.num_retirant = '+225 01 02 03 04 05' AND k.contact_retirant = '+225 01 02 03 04 05'
      AND k.contact = '0708090102' AND (r3 ->> 'contact_mis_a_jour')::boolean = false,
    concat_ws(' ', r::text, r2::text, left(r3::text, 120)));

  r  := public._t20_d(c_op, 't20-c11', 'ASSURE', 'KONE AWA', '', NULL, gen_random_uuid());
  r2 := public._t20_d(c_op, 't20-c12', 'ASSURE', 'KONE ALI', '0544332211', NULL, gen_random_uuid());
  r3 := public._t20_d(c_op, 't20-c13', 'ASSURE', 'KONE SALI', '0708090104', NULL, gen_random_uuid());
  INSERT INTO _t VALUES (19, 'ASSURE : sans telephone et fiche sans contact -> PARAMETRES_INVALIDES ; telephone different -> contact mis a jour (+ journal UPDATE_CONTACT masque) ; meme numero autrement ecrit -> contact inchange',
    r ->> 'code' = 'PARAMETRES_INVALIDES'
      AND r2 ->> 'code' = 'OK' AND (r2 ->> 'contact_mis_a_jour')::boolean
      AND (SELECT contact FROM public.t_cartes WHERE sync_id = 't20-c12') = '+225 05 44 33 22 11'
      AND (SELECT count(*) FROM public.t_logs WHERE action = 'UPDATE_CONTACT' AND detail LIKE '%t20-c12%'
             AND detail LIKE '%********03%' AND detail LIKE '%********11%' AND detail NOT LIKE '%0708090103%') = 1
      AND r3 ->> 'code' = 'OK' AND (r3 ->> 'contact_mis_a_jour')::boolean = false
      AND (SELECT contact FROM public.t_cartes WHERE sync_id = 't20-c13') = '+225 07 08 09 01 04'
      AND NOT EXISTS (SELECT 1 FROM public.t_logs WHERE action = 'UPDATE_CONTACT' AND detail LIKE '%t20-c13%'),
    concat_ws(' ', r::text, left(r2::text, 100), left(r3::text, 100)));

  t1 := (SELECT updated_at FROM public.t_cartes WHERE sync_id = 't20-c14');
  r := public._t20_d(c_op, 't20-c14', 'TIERS', 'X', '0102030405', NULL, gen_random_uuid());
  INSERT INTO _t VALUES (20, 'updated_at = GREATEST(now(), ancien + 1 ms) : carte dont updated_at est dans le futur -> ancien + 1 ms',
    r ->> 'code' = 'OK' AND (SELECT updated_at FROM public.t_cartes WHERE sync_id = 't20-c14') = t1 + INTERVAL '1 millisecond',
    left(r::text, 120));

  n1 := (SELECT count(*) FROM public.t_logs WHERE sync_id IS NOT NULL);
  r := public._t20_d(c_op, 't20-c15', 'TIERS', 'X', '0102030405', NULL, gen_random_uuid());
  INSERT INTO _t VALUES (21, 'Garde 0006 refusant la delivrance (evenement plus recent deja en base) : STATUT_INVALIDE, carte inchangee, aucune ligne t_sync_conflicts ni journal laissee (sous-transaction annulee)',
    r ->> 'code' = 'STATUT_INVALIDE'
      AND (SELECT statut FROM public.t_cartes WHERE sync_id = 't20-c15') = 'EN STOCK'
      AND (SELECT count(*) FROM public.t_sync_conflicts) = n3
      AND (SELECT count(*) FROM public.t_logs WHERE sync_id IS NOT NULL) = n1,
    r::text);

  -- =====================================================================
  -- IDENTITE / DROITS
  -- =====================================================================
  r  := public._t20_d(c_inact, 't20-c11', 'TIERS', 'X', '0102030405', NULL, gen_random_uuid());
  r2 := public._t20_s(c_inact, 'KONE', '1980-02-02', NULL);
  UPDATE public.t_users SET statut_actif = 0 WHERE sync_id = 't20-u-op';
  r3 := public._t20_s(c_op, 'KONE', '1980-02-02', NULL);
  UPDATE public.t_users SET statut_actif = 1 WHERE sync_id = 't20-u-op';
  INSERT INTO _t VALUES (22, 'Compte desactive en base (jeton encore valable) : COMPTE_INACTIF (delivrance et recherche), aucune ecriture',
    r ->> 'code' = 'COMPTE_INACTIF' AND r2 ->> 'code' = 'COMPTE_INACTIF' AND r3 ->> 'code' = 'COMPTE_INACTIF'
      AND (SELECT statut FROM public.t_cartes WHERE sync_id = 't20-c11') = 'EN STOCK',
    concat_ws(' ', r::text, r2::text, r3::text));

  UPDATE public.t_users SET site_id = v_sb WHERE sync_id = 't20-u-op';
  r := public._t20_s(c_op, 'KONE', '1980-02-02', NULL);
  UPDATE public.t_users SET site_id = v_sa WHERE sync_id = 't20-u-op';
  INSERT INTO _t VALUES (23, 'Compte deplace sur un autre site en base (jeton de l''ancien site) : COMPTE_INACTIF',
    r ->> 'code' = 'COMPTE_INACTIF', r::text);

  r  := public._t20_d(c_nog, 't20-c11', 'TIERS', 'X', '0102030405', NULL, gen_random_uuid());
  r2 := public._t20_s(c_nog, 'KONE', '1980-02-02', NULL);
  r3 := public._t20_s(c_forge, 'KONE', '1980-02-02', NULL);
  INSERT INTO _t VALUES (24, 'Jeton sans claims gis_* / claims forgees sans gis_v : 42501 (delivrance et recherche)',
    r ->> 'err' = '42501' AND r2 ->> 'err' = '42501' AND r3 ->> 'err' = '42501',
    concat_ws(' ', r::text, r2::text, r3::text));

  r  := public._t20_d(c_saisie, 't20-c11', 'TIERS', 'X', '0102030405', NULL, gen_random_uuid());
  r2 := public._t20_s(c_saisie, 'KONE', '1980-02-02', NULL);
  r3 := public._t20_s(c_retire, 'KONE', '1980-02-02', NULL);
  INSERT INTO _t VALUES (25, 'Role non autorise (OPERATEUR_SAISIE) : 42501 ; role OPERATEUR_VERIFICATION dans le jeton mais retire en base : 42501',
    r ->> 'err' = '42501' AND r2 ->> 'err' = '42501' AND r3 ->> 'err' = '42501',
    concat_ws(' ', r::text, r2::text, r3::text));

  r := public._t20_s(c_ob, 'KOUASSI', '1990-01-01', NULL);
  INSERT INTO _t VALUES (26, 'Role OPERATEUR_VERIFICATION seulement secondaire (t_user_roles), site B : accepte, ne voit que le site B',
    r ->> 'code' = 'OK' AND jsonb_array_length(r -> 'resultats') = 1 AND r -> 'resultats' -> 0 ->> 'sync_id' = 't20-c3',
    left(r::text, 150));

  -- Vrais roles SQL : authenticated appelle les fonctions mais ne lit pas
  -- t_cartes en direct (0019) ; anon n'a pas EXECUTE.
  PERFORM set_config('request.jwt.claims', c_op, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    n1 := (SELECT count(*) FROM public.t_cartes WHERE sync_id LIKE 't20-%');
    r  := public.fn_mobile_rechercher_cartes('KONE', '1980-02-02', NULL);
    r2 := public.fn_mobile_delivrer_carte('t20-h8', 'TIERS', 'X', '0102030405', NULL, gen_random_uuid());
    EXECUTE 'RESET ROLE';
  EXCEPTION WHEN others THEN
    EXECUTE 'RESET ROLE';
    r := jsonb_build_object('err', SQLSTATE);
  END;
  PERFORM set_config('request.jwt.claims', '', true);
  INSERT INTO _t VALUES (27, 'Sous le role SQL authenticated (operateur) : SELECT direct de t_cartes = 0 ligne (0019), recherche et delivrance par les fonctions OK',
    n1 = 0 AND r ->> 'code' = 'OK' AND jsonb_array_length(r -> 'resultats') = 4 AND r2 ->> 'code' = 'OK',
    concat_ws(' ', n1::text, left(r::text, 80), left(r2::text, 80)));

  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  EXECUTE 'SET LOCAL ROLE anon';
  BEGIN
    r := public.fn_mobile_rechercher_cartes('KONE', '1980-02-02', NULL);
    s := 'execute';
  EXCEPTION WHEN others THEN
    s := SQLSTATE;
  END;
  BEGIN
    r := public.fn_mobile_delivrer_carte('t20-h9', 'TIERS', 'X', '0102030405', NULL, gen_random_uuid());
    s := s || ' execute';
  EXCEPTION WHEN others THEN
    s := s || ' ' || SQLSTATE;
  END;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', '', true);
  INSERT INTO _t VALUES (28, 'anon : EXECUTE refuse sur les 2 fonctions (42501), carte h9 intacte',
    s = '42501 42501' AND (SELECT statut FROM public.t_cartes WHERE sync_id = 't20-h9') = 'EN STOCK', s);

  INSERT INTO _t VALUES (29, 'Mesure 0008 : les ecritures des fonctions passent par les triggers STATEMENT (compteurs t_cartes UPDATE et t_logs INSERT du jour presents)',
    EXISTS (SELECT 1 FROM public.t_write_audit WHERE jour >= current_date - 1 AND table_name = 't_cartes' AND op = 'UPDATE')
      AND EXISTS (SELECT 1 FROM public.t_write_audit WHERE jour >= current_date - 1 AND table_name = 't_logs' AND op = 'INSERT'),
    (SELECT string_agg(table_name || ':' || op || ':' || classe, ',') FROM public.t_write_audit WHERE jour >= current_date - 1));

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
    RAISE EXCEPTION 'TEST 0020 ECHEC : cas en erreur : %', v_ko;
  END IF;
  RAISE NOTICE 'TEST 0020 OK (% cas)', (SELECT count(*) FROM _t);
END;
$$;

ROLLBACK;
