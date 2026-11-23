-- ============================================================
-- 0020_fonctions_mobile_verification.sql
-- GEST-IN-SITU : version telephone v1 (docs/PLAN_MOBILE_V1.md, etape E3,
-- decisions Q1, Q3, Q5, Q6 du 2026-11-23). Deux fonctions serveur, seules
-- portes d'acces du telephone aux cartes (0019 ferme la lecture et
-- l'ecriture directes de t_cartes aux non-administrateurs) :
--   fn_mobile_rechercher_cartes(p_nom, p_ddn, p_tel)
--   fn_mobile_delivrer_carte(p_sync_id, p_type_retirant, p_nom_retirant,
--                            p_tel_retirant, p_rangement_urgence, p_request_id)
-- + 3 aides internes (fn_mobile_operateur, fn_mobile_masque,
--   fn_mobile_tel_chiffres), non appelables par anon / authenticated.
-- Purement ADDITIF : aucune table, colonne, politique, trigger ni droit anon
-- ajoute ou modifie ; aucun index (mesure EXPLAIN : README section 0020).
-- DEPEND DE 0006 (garde statut), 0008 (mesure), 0011 (fn_jwt_*), 0019.
--
-- Identite (Q1, Q3) : claims du jeton (fn_jwt_sync_id / site / centre /
-- roles, 0011), puis RELECTURE en base a chaque appel (t_users) :
--   - jeton sans claims gis_* valides, sans site, sans sync_id, ou sans le
--     role OPERATEUR_VERIFICATION dans gis_roles      -> ERREUR 42501 ;
--   - compte absent, statut_actif <> 1, ou site en base different du site du
--     jeton (compte deplace pendant la vie du jeton) -> code COMPTE_INACTIF ;
--   - role OPERATEUR_VERIFICATION retire en base (principal et
--     t_user_roles)                                   -> ERREUR 42501.
--   Q3 : v1 reservee a OPERATEUR_VERIFICATION (un administrateur garde ses
--   acces directs, 0019). L'agent distributeur ecrit = t_users.login relu.
--
-- RECHERCHE (meme regle que useVerificationSearch.ts:118-163, portail
-- Verification Windows) :
--   - mode NOM : p_nom + p_ddn obligatoires. p_nom est decoupe comme a
--     l'ecran : 1er mot = nom de famille (egalite exacte, majuscules),
--     reste = prenom (inclusion, majuscules). Sans resultat et avec un
--     prenom : essai inverse (nom = reste, prenoms contenant le 1er mot),
--     signale par "inversion": true (l'ecran demande confirmation).
--     p_tel facultatif : filtre supplementaire (meme motif que l'ecran).
--   - mode TEL (p_nom vide) : 10 chiffres (prefixe 225 retire comme a
--     l'ecran), motif « chiffres dans l'ordre » identique a
--     useVerificationSearch.ts:259-267 (contact LIKE '%0%7%...%').
--   - site du jeton seulement ; 10 lignes au plus ("tronque": true s'il y en
--     a plus), centre de l'operateur d'abord, puis nom, prenoms ;
--   - colonnes reduites ; JAMAIS num_secu (Q6) ; contact de l'assure et
--     telephone du retirant masques sauf les 2 derniers chiffres (Q6) ;
--   - tous statuts renvoyes (exclude_delivered = false, comme l'ecran) ;
--   - journal t_logs VERIFICATION_RECHERCHE (canal MOBILE, mode, nombre de
--     resultats ; aucun nom, date ni telephone recherche).
--   Ecart assume : l'ecran Windows retombe sur la recherche plein texte
--   locale quand aucune regle ne correspond ; ici : 0 resultat.
--
-- DELIVRANCE (portage de delivrerCarte, src/main/database/queries/
-- cartes.queries.ts:673-839, et de resolveCentreIdFromPrefix :73-93) :
--   SELECT ... FOR UPDATE sur la carte (sync_id), puis, dans l'ordre :
--     INTROUVABLE          sync_id inconnu ;
--     HORS_SITE            carte d'un autre site (:701) ;
--     HORS_CENTRE          carte classee d'un autre centre (:704) ;
--     DOUBLON              (:713) ;
--     DEJA_DELIVREE        (:722) ; sauf reessai du MEME p_request_id par
--                          le MEME agent (journal CARTE_DELIVREE de ce
--                          request_id) -> OK avec "reessai": true ;
--     STATUT_INVALIDE      statut different de EN STOCK (:725) ;
--     ABSENTE              statut_physique ABSENT ou PERDUE (Q5, absent de
--                          delivrerCarte : telephone seulement) ;
--     RANGEMENT_REQUIS     carte non classee (rangement vide ou NON CLASSE,
--                          :692) sans rangement d'urgence (:696) ; un
--                          rangement d'urgence « NON CLASSE » est traite
--                          comme absent (plus strict que Windows) ;
--     PARAMETRES_INVALIDES parametre manquant ou mal forme (aucune ecriture).
--   Ordre different de Windows : le rangement d'urgence est controle APRES
--   le statut (pas de demande de rangement pour une carte deja delivree).
--   Telephone du retirant (precision de la session principale du
--   2026-11-23) :
--     ASSURE : p_tel_retirant vide / NULL accepte -> num_retirant et
--              contact_retirant = contact de la fiche (jamais renvoye) ; si
--              la fiche n'a pas de contact : PARAMETRES_INVALIDES. S'il est
--              fourni (10 chiffres) : comme delivrerCarte (:733-749), le
--              contact de la fiche est remplace s'il est different (compare
--              sur les chiffres, prefixe 225 retire, pour ne pas reecrire un
--              meme numero mis en forme autrement) + journal UPDATE_CONTACT.
--     TIERS  : 10 chiffres obligatoires ; contact de la fiche inchange.
--     Telephone saisi enregistre au format de l'ecran Windows
--     (useDeliveryFlow.ts:38 / :85) : « +225 XX XX XX XX XX ».
--   Ecriture (une seule instruction UPDATE) : statut DELIVRE ;
--   date_delivrance = action_at = now() ; nom_retirant (majuscules) ;
--   num_retirant = contact_retirant ; agent_distributeur = t_users.login ;
--   centre_retrait = nom du centre de l'operateur ; carte non classee :
--   rangement = rangement d'urgence (majuscules) et id_centre = centre du
--   PREFIXE le plus long (t_centres.prefixe_rangement du site de la carte,
--   liste separee par des virgules ; egalite de longueur : numero puis id
--   croissants, comme getCentresWithPrefixes + tri stable), sinon centre de
--   l'operateur (:759-764) ; updated_at = GREATEST(now(), ancien updated_at
--   + 1 ms) (les postes re-telechargent une carte dont updated_at du cloud
--   est strictement plus recent : download-worker.js:325-327).
--   Garde 0006 : la carte etant EN STOCK, le bloc statut passe ; si le
--   garde le refusait quand meme (evenement plus recent deja en base), la
--   sous-transaction est annulee (aucune ligne t_sync_conflicts laissee) et
--   la fonction renvoie STATUT_INVALIDE.
--   Journal t_logs (meme forme que src/main/utils/audit.ts:147-164 :
--   id_user NULL, login_user, action, detail JSON, site_id, centre_id de
--   l'operateur, sync_id uuid, date_heure) :
--     CARTE_DELIVREE : detail = {id_carte, nom_retirant, num_retirant,
--       agent_distributeur} (cles de handlers.ts:1480-1485) + canal
--       "MOBILE", sync_id (carte), request_id, type_retirant. id_carte = id
--       CLOUD (le telephone n'a pas d'id local). num_retirant MASQUE dans le
--       journal (Q6 : t_logs reste lisible par les agents du site, 0013) ;
--     CENTRE_CARTE_RECALCULE (si id_centre change, cartes.queries.ts:809-820) ;
--     UPDATE_CONTACT (si le contact change) : anciens / nouveaux numeros
--       MASQUES (Q6), contrairement au journal local Windows.
--   Codes de retour : {"code": ..., ...} ; OK renvoie sync_id,
--   date_delivrance, updated_at, id_centre, centre_recalcule,
--   contact_mis_a_jour, reessai.
--
-- Concurrence : deux delivrances simultanees de la meme carte s'attendent
-- sur le verrou de ligne ; la seconde relit la ligne mise a jour (READ
-- COMMITTED, PostgreSQL 17 §13.2.1) et renvoie DEJA_DELIVREE (ou OK
-- "reessai" si c'est le meme request_id). lock_timeout de la fonction :
-- 3 s (55P03 au-dela : rien n'est ecrit, le telephone peut reessayer avec
-- le meme request_id).
--
-- Securite : SECURITY DEFINER (proprietaire postgres : contourne la RLS,
-- d'ou les controles de site / centre ecrits ici), search_path = '' (tout
-- est qualifie), EXECUTE : authenticated seulement pour les 2 fonctions
-- (REVOKE PUBLIC, anon) ; aides : REVOKE PUBLIC, anon, authenticated.
-- Sources : Supabase « Database Functions » (security definer + search_path
-- vide, revoke execute from public / anon) et lints 0028 / 0029 (search_docs,
-- 2026-11-23) ; PostgreSQL 17 §13.2.1 et §13.3.2 (FOR UPDATE, Context7
-- /websites/postgresql).
--
-- Idempotent : CREATE OR REPLACE FUNCTION, REVOKE / GRANT rejouables.
-- Verrous : aucun verrou de table (creation de fonctions seulement).
-- Application : un seul bloc  BEGIN; <ce fichier> COMMIT;  (SET LOCAL
-- lock_timeout = '3s' + controle en tete).
--
-- Retour arriere :
--   BEGIN;
--   SET LOCAL lock_timeout = '3s';
--   DROP FUNCTION IF EXISTS public.fn_mobile_delivrer_carte(TEXT, TEXT, TEXT, TEXT, TEXT, UUID);
--   DROP FUNCTION IF EXISTS public.fn_mobile_rechercher_cartes(TEXT, DATE, TEXT);
--   DROP FUNCTION IF EXISTS public.fn_mobile_operateur();
--   DROP FUNCTION IF EXISTS public.fn_mobile_masque(TEXT);
--   DROP FUNCTION IF EXISTS public.fn_mobile_tel_chiffres(TEXT);
--   COMMIT;
--   (Les lignes t_logs VERIFICATION_RECHERCHE / CARTE_DELIVREE canal MOBILE
--   deja ecrites restent : ce sont des journaux.)
--
-- Application : dev ajadkziqaskadlzboeqo : voir README, section « 0020 ».
-- Production itvyayakwgzvfqvdrgyv : NON appliquee (geste utilisateur, apres
-- 0019, prerequis prod du plan mobile).
-- Test : supabase/tests/0020_fonctions_mobile_verification.test.sql
-- ============================================================

-- ------------------------------------------------------------
-- 0. Protection et prerequis
-- ------------------------------------------------------------
SET LOCAL lock_timeout = '3s';

DO $garde$
DECLARE
  c TEXT;
BEGIN
  IF current_setting('lock_timeout') <> '3s' THEN
    RAISE EXCEPTION '0020 : lock_timeout de protection inactif (fichier execute hors transaction). Executer en un seul bloc : BEGIN; <fichier> COMMIT;';
  END IF;
  IF to_regprocedure('public.fn_jwt_gis_claims()') IS NULL
     OR to_regprocedure('public.fn_jwt_sync_id()') IS NULL
     OR to_regprocedure('public.fn_jwt_site_id()') IS NULL
     OR to_regprocedure('public.fn_jwt_centre_id()') IS NULL
     OR to_regprocedure('public.fn_jwt_roles()') IS NULL THEN
    RAISE EXCEPTION '0020 : 0011 absente (fonctions fn_jwt_*) : appliquer 0011 d''abord.';
  END IF;
  IF (SELECT count(*) FROM pg_policies
       WHERE schemaname = 'public' AND policyname LIKE 'r19\_%'
         AND permissive = 'RESTRICTIVE' AND roles = ARRAY['authenticated']::name[]) <> 4 THEN
    RAISE EXCEPTION '0020 : 0019 absente ou incomplete (4 politiques r19_* attendues) : appliquer 0019 d''abord.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.t_cartes'::regclass
                  AND tgname = 'trg_t_cartes_status_guard' AND NOT tgisinternal) THEN
    RAISE EXCEPTION '0020 : 0006 absente (trg_t_cartes_status_guard) : etat inattendu.';
  END IF;
  FOREACH c IN ARRAY ARRAY['sync_id','noms','prenoms','date_naissance','lieu_naissance','contact',
                           'rangement','statut','statut_physique','date_delivrance',
                           'agent_distributeur','centre_retrait','nom_retirant','num_retirant',
                           'contact_retirant','id_site','id_centre','updated_at','action_at'] LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 't_cartes' AND column_name = c) THEN
      RAISE EXCEPTION '0020 : colonne t_cartes.% absente.', c;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                  AND table_name = 't_centres' AND column_name = 'prefixe_rangement')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                  AND table_name = 't_users' AND column_name = 'login')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                  AND table_name = 't_logs' AND column_name = 'detail') THEN
    RAISE EXCEPTION '0020 : colonnes t_centres.prefixe_rangement / t_users.login / t_logs.detail attendues.';
  END IF;
END;
$garde$;

-- ------------------------------------------------------------
-- 1. Aides internes
-- ------------------------------------------------------------
-- Chiffres d'un telephone, prefixe 225 retire (useVerificationSearch.ts:259-260).
CREATE OR REPLACE FUNCTION public.fn_mobile_tel_chiffres(p TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE WHEN d LIKE '225%' THEN substr(d, 4) ELSE d END
    FROM (SELECT regexp_replace(COALESCE(p, ''), '[^0-9]', '', 'g') AS d) x
$$;

-- Masque Q6 : 8 etoiles + 2 derniers chiffres (longueur reelle non revelee).
CREATE OR REPLACE FUNCTION public.fn_mobile_masque(p TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE WHEN length(d) >= 2 THEN '********' || right(d, 2) ELSE NULL END
    FROM (SELECT regexp_replace(COALESCE(p, ''), '[^0-9]', '', 'g') AS d) x
$$;

-- Operateur appelant : 42501 si le jeton ne convient pas ; sinon
-- {"code": "OK" | "COMPTE_INACTIF", sync_id, login, site_id, centre_id}.
CREATE OR REPLACE FUNCTION public.fn_mobile_operateur()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_sync   TEXT;
  v_site   BIGINT;
  v_centre BIGINT;
  v_user   RECORD;
BEGIN
  IF public.fn_jwt_gis_claims() IS NULL THEN
    RAISE EXCEPTION 'GIS mobile : session invalide' USING ERRCODE = '42501';
  END IF;
  v_sync   := NULLIF(btrim(COALESCE(public.fn_jwt_sync_id(), '')), '');
  v_site   := public.fn_jwt_site_id();
  v_centre := public.fn_jwt_centre_id();
  IF v_sync IS NULL OR v_site IS NULL
     OR NOT ('OPERATEUR_VERIFICATION' = ANY (public.fn_jwt_roles())) THEN
    RAISE EXCEPTION 'GIS mobile : role non autorise' USING ERRCODE = '42501';
  END IF;

  SELECT u.login, u.statut_actif, u.site_id, u.role INTO v_user
    FROM public.t_users u WHERE u.sync_id = v_sync;
  IF NOT FOUND OR COALESCE(v_user.statut_actif, 0) <> 1
     OR v_user.site_id IS DISTINCT FROM v_site THEN
    RETURN jsonb_build_object('code', 'COMPTE_INACTIF');
  END IF;
  IF v_user.role IS DISTINCT FROM 'OPERATEUR_VERIFICATION'
     AND NOT EXISTS (SELECT 1 FROM public.t_user_roles r
                      WHERE r.user_sync_id = v_sync AND r.role = 'OPERATEUR_VERIFICATION') THEN
    RAISE EXCEPTION 'GIS mobile : role non autorise' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object('code', 'OK', 'sync_id', v_sync, 'login', v_user.login,
                            'site_id', v_site, 'centre_id', v_centre);
END;
$$;

-- ------------------------------------------------------------
-- 2. Recherche
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_mobile_rechercher_cartes(
  p_nom TEXT DEFAULT NULL,
  p_ddn DATE DEFAULT NULL,
  p_tel TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  c_max      CONSTANT INT := 10;
  v_ctx      JSONB;
  v_site     BIGINT;
  v_centre   BIGINT;
  v_nom      TEXT;
  v_nom1     TEXT;
  v_prenom   TEXT;
  v_tel      TEXT;
  v_motif    TEXT := NULL;
  v_mode     TEXT;
  v_inv      BOOLEAN := false;
  v_rows     JSONB;
  v_n        INT;
BEGIN
  v_ctx := public.fn_mobile_operateur();
  IF v_ctx ->> 'code' <> 'OK' THEN
    RETURN v_ctx;
  END IF;
  v_site   := (v_ctx ->> 'site_id')::bigint;
  v_centre := (v_ctx ->> 'centre_id')::bigint;

  v_nom := upper(regexp_replace(btrim(COALESCE(p_nom, '')), '\s+', ' ', 'g'));
  v_tel := public.fn_mobile_tel_chiffres(p_tel);
  IF length(v_nom) > 200 OR length(COALESCE(p_tel, '')) > 40 THEN
    RETURN jsonb_build_object('code', 'PARAMETRES_INVALIDES');
  END IF;
  IF v_tel <> '' THEN
    IF length(v_tel) <> 10 THEN
      RETURN jsonb_build_object('code', 'PARAMETRES_INVALIDES');
    END IF;
    v_motif := '%' || array_to_string(regexp_split_to_array(v_tel, ''), '%') || '%';
  END IF;

  IF v_nom <> '' THEN
    IF p_ddn IS NULL THEN
      RETURN jsonb_build_object('code', 'PARAMETRES_INVALIDES');
    END IF;
    v_mode   := 'NOM';
    v_nom1   := split_part(v_nom, ' ', 1);
    v_prenom := btrim(substr(v_nom, length(v_nom1) + 1));
  ELSIF v_motif IS NOT NULL THEN
    v_mode := 'TEL';
  ELSE
    RETURN jsonb_build_object('code', 'PARAMETRES_INVALIDES');
  END IF;

  -- Candidats : (essai 1 = direct, essai 2 = inverse) ; c_max + 1 lignes pour
  -- savoir si la liste est tronquee.
  FOR i IN 1..2 LOOP
    EXIT WHEN i = 2 AND (v_mode <> 'NOM' OR v_prenom = '');
    WITH cand AS (
      SELECT c.*
        FROM public.t_cartes c
       WHERE c.id_site = v_site
         AND (v_motif IS NULL OR c.contact LIKE v_motif)
         AND (v_mode = 'TEL'
              OR (c.date_naissance = p_ddn
                  AND CASE WHEN i = 1
                        THEN upper(c.noms) = v_nom1
                             AND (v_prenom = '' OR strpos(upper(COALESCE(c.prenoms, '')), v_prenom) > 0)
                        ELSE upper(c.noms) = v_prenom
                             AND strpos(upper(COALESCE(c.prenoms, '')), v_nom1) > 0
                      END))
       ORDER BY (c.id_centre IS NOT DISTINCT FROM v_centre) DESC, c.noms, c.prenoms, c.id_carte
       LIMIT c_max + 1
    )
    SELECT count(*)::int,
           COALESCE(jsonb_agg(jsonb_build_object(
             'sync_id',          x.sync_id,
             'noms',             x.noms,
             'prenoms',          x.prenoms,
             'date_naissance',   x.date_naissance,
             'lieu_naissance',   x.lieu_naissance,
             'rangement',        x.rangement,
             'non_classee',      (x.rangement IS NULL OR btrim(x.rangement) = ''
                                  OR upper(btrim(x.rangement)) = 'NON CLASSE'),
             'statut',           x.statut,
             'statut_physique',  x.statut_physique,
             'id_centre',        x.id_centre,
             'centre_nom',       (SELECT ce.nom FROM public.t_centres ce WHERE ce.id = x.id_centre),
             'meme_centre',      (x.id_centre IS NOT DISTINCT FROM v_centre),
             'contact_masque',   public.fn_mobile_masque(x.contact),
             'date_delivrance',  x.date_delivrance,
             'centre_retrait',   x.centre_retrait,
             'nom_retirant',     x.nom_retirant,
             'tel_retirant_masque', public.fn_mobile_masque(x.num_retirant)
           ) ORDER BY x.rn) FILTER (WHERE x.rn <= c_max), '[]'::jsonb)
      INTO v_n, v_rows
      FROM (SELECT cand.*, row_number() OVER (ORDER BY (cand.id_centre IS NOT DISTINCT FROM v_centre) DESC,
                                                cand.noms, cand.prenoms, cand.id_carte) AS rn
              FROM cand) x;
    v_inv := (i = 2);
    EXIT WHEN v_n > 0;
  END LOOP;
  IF v_n = 0 THEN
    v_inv := false;
  END IF;

  INSERT INTO public.t_logs (id_user, login_user, action, detail, site_id, centre_id, sync_id, date_heure)
  VALUES (NULL, v_ctx ->> 'login', 'VERIFICATION_RECHERCHE',
          jsonb_build_object('canal', 'MOBILE', 'mode', v_mode,
                             'nb_resultats', LEAST(v_n, c_max), 'inversion', v_inv,
                             'tronque', v_n > c_max)::text,
          v_site, v_centre, gen_random_uuid()::text, now());

  RETURN jsonb_build_object('code', 'OK', 'mode', v_mode, 'inversion', v_inv,
                            'tronque', v_n > c_max, 'resultats', v_rows);
END;
$$;

-- ------------------------------------------------------------
-- 3. Delivrance
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_mobile_delivrer_carte(
  p_sync_id           TEXT,
  p_type_retirant     TEXT,
  p_nom_retirant      TEXT,
  p_tel_retirant      TEXT,
  p_rangement_urgence TEXT,
  p_request_id        UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '3s'
AS $$
DECLARE
  v_ctx        JSONB;
  v_login      TEXT;
  v_site       BIGINT;
  v_centre     BIGINT;
  v_type       TEXT;
  v_nom        TEXT;
  v_tel        TEXT;
  v_tel_fmt    TEXT;
  v_rang       TEXT;
  v_carte      RECORD;
  v_nc         BOOLEAN;
  v_num        TEXT;
  v_new_cont   TEXT := NULL;
  v_override   BIGINT := NULL;
  v_centre_nom TEXT;
  v_now        TIMESTAMPTZ := now();
  v_res        RECORD;
  v_ok         BOOLEAN := false;
BEGIN
  v_ctx := public.fn_mobile_operateur();
  IF v_ctx ->> 'code' <> 'OK' THEN
    RETURN v_ctx;
  END IF;
  v_login  := v_ctx ->> 'login';
  v_site   := (v_ctx ->> 'site_id')::bigint;
  v_centre := (v_ctx ->> 'centre_id')::bigint;

  -- ---------- Parametres ----------
  v_type := upper(btrim(COALESCE(p_type_retirant, '')));
  v_nom  := upper(regexp_replace(btrim(COALESCE(p_nom_retirant, '')), '\s+', ' ', 'g'));
  v_tel  := public.fn_mobile_tel_chiffres(p_tel_retirant);
  v_rang := upper(btrim(COALESCE(p_rangement_urgence, '')));
  IF p_request_id IS NULL
     OR p_sync_id IS NULL OR length(p_sync_id) NOT BETWEEN 1 AND 64
     OR v_type NOT IN ('ASSURE', 'TIERS')
     OR v_nom = '' OR length(v_nom) > 150
     OR length(COALESCE(p_tel_retirant, '')) > 40
     OR length(v_rang) > 60
     OR (v_type = 'TIERS' AND length(v_tel) <> 10)
     OR (v_type = 'ASSURE' AND v_tel <> '' AND length(v_tel) <> 10) THEN
    RETURN jsonb_build_object('code', 'PARAMETRES_INVALIDES');
  END IF;
  IF v_tel <> '' THEN
    v_tel_fmt := '+225 ' || substr(v_tel, 1, 2) || ' ' || substr(v_tel, 3, 2) || ' '
                 || substr(v_tel, 5, 2) || ' ' || substr(v_tel, 7, 2) || ' ' || substr(v_tel, 9, 2);
  END IF;

  -- ---------- Carte, sous verrou de ligne ----------
  SELECT c.id_carte, c.sync_id, c.id_site, c.id_centre, c.statut, c.statut_physique,
         c.rangement, c.contact, c.date_delivrance, c.updated_at
    INTO v_carte
    FROM public.t_cartes c
   WHERE c.sync_id = p_sync_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('code', 'INTROUVABLE');
  END IF;
  IF v_carte.id_site IS DISTINCT FROM v_site THEN
    RETURN jsonb_build_object('code', 'HORS_SITE');
  END IF;

  v_nc := v_carte.rangement IS NULL OR btrim(v_carte.rangement) = ''
          OR upper(btrim(v_carte.rangement)) = 'NON CLASSE';
  IF NOT v_nc AND (v_centre IS NULL OR v_carte.id_centre IS DISTINCT FROM v_centre) THEN
    RETURN jsonb_build_object('code', 'HORS_CENTRE');
  END IF;
  IF v_carte.statut = 'DOUBLON' THEN
    RETURN jsonb_build_object('code', 'DOUBLON');
  END IF;
  IF v_carte.statut = 'DELIVRE' THEN
    -- Reessai du meme request_id par le meme agent : la premiere reponse
    -- s'est perdue, la delivrance est bien la sienne.
    IF EXISTS (SELECT 1 FROM public.t_logs l
                WHERE l.action = 'CARTE_DELIVREE'
                  AND l.site_id = v_carte.id_site
                  AND l.login_user = v_login
                  AND l.date_heure >= COALESCE(v_carte.date_delivrance, '-infinity'::timestamptz) - INTERVAL '1 minute'
                  AND strpos(COALESCE(l.detail, ''), p_request_id::text) > 0
                  AND strpos(COALESCE(l.detail, ''), '"' || p_sync_id || '"') > 0) THEN
      RETURN jsonb_build_object('code', 'OK', 'reessai', true, 'sync_id', v_carte.sync_id,
                                'date_delivrance', v_carte.date_delivrance,
                                'updated_at', v_carte.updated_at, 'id_centre', v_carte.id_centre);
    END IF;
    RETURN jsonb_build_object('code', 'DEJA_DELIVREE', 'date_delivrance', v_carte.date_delivrance);
  END IF;
  IF v_carte.statut IS DISTINCT FROM 'EN STOCK' THEN
    RETURN jsonb_build_object('code', 'STATUT_INVALIDE');
  END IF;
  IF v_carte.statut_physique IN ('ABSENT', 'PERDUE') THEN
    RETURN jsonb_build_object('code', 'ABSENTE');
  END IF;
  IF v_nc AND (v_rang = '' OR v_rang = 'NON CLASSE') THEN
    RETURN jsonb_build_object('code', 'RANGEMENT_REQUIS');
  END IF;

  -- ---------- Telephone du retirant ----------
  IF v_type = 'ASSURE' AND v_tel = '' THEN
    IF public.fn_mobile_tel_chiffres(v_carte.contact) = '' THEN
      RETURN jsonb_build_object('code', 'PARAMETRES_INVALIDES');
    END IF;
    v_num := v_carte.contact;                       -- contact de la fiche, jamais renvoye
  ELSE
    v_num := v_tel_fmt;
    IF v_type = 'ASSURE' AND public.fn_mobile_tel_chiffres(v_carte.contact) IS DISTINCT FROM v_tel THEN
      v_new_cont := v_tel_fmt;                      -- delivrerCarte :733-738
    END IF;
  END IF;

  -- ---------- Centre (carte non classee : prefixe le plus long) ----------
  IF v_nc THEN
    SELECT ce.id INTO v_override
      FROM public.t_centres ce
      CROSS JOIN LATERAL unnest(string_to_array(COALESCE(ce.prefixe_rangement, ''), ','))
                 WITH ORDINALITY AS p(pref, ord)
     WHERE ce.site_id = v_carte.id_site
       AND upper(btrim(p.pref)) <> ''
       AND left(v_rang, length(upper(btrim(p.pref)))) = upper(btrim(p.pref))
     ORDER BY length(upper(btrim(p.pref))) DESC, ce.numero ASC NULLS FIRST, ce.id ASC, p.ord ASC
     LIMIT 1;
    v_override := COALESCE(v_override, v_centre);
  END IF;
  SELECT ce.nom INTO v_centre_nom FROM public.t_centres ce
   WHERE ce.id = v_centre AND ce.site_id = v_site;

  -- ---------- Ecriture (sous-transaction : annulee si le garde 0006 refuse) ----------
  BEGIN
    UPDATE public.t_cartes c SET
      statut             = 'DELIVRE',
      date_delivrance    = v_now,
      nom_retirant       = v_nom,
      num_retirant       = v_num,
      contact_retirant   = v_num,
      contact            = COALESCE(v_new_cont, c.contact),
      agent_distributeur = v_login,
      centre_retrait     = v_centre_nom,
      rangement          = CASE WHEN v_nc THEN v_rang ELSE c.rangement END,
      id_centre          = COALESCE(v_override, c.id_centre),
      updated_at         = GREATEST(v_now, c.updated_at + INTERVAL '1 millisecond'),
      action_at          = v_now
     WHERE c.id_carte = v_carte.id_carte
    RETURNING c.statut, c.date_delivrance, c.updated_at, c.id_centre INTO v_res;
    IF v_res.statut IS DISTINCT FROM 'DELIVRE' OR v_res.date_delivrance IS DISTINCT FROM v_now THEN
      RAISE EXCEPTION 'garde 0006' USING ERRCODE = 'GS006';
    END IF;
    v_ok := true;
  EXCEPTION WHEN SQLSTATE 'GS006' THEN
    v_ok := false;
  END;
  IF NOT v_ok THEN
    RETURN jsonb_build_object('code', 'STATUT_INVALIDE');
  END IF;

  -- ---------- Journaux ----------
  IF v_new_cont IS NOT NULL THEN
    INSERT INTO public.t_logs (id_user, login_user, action, detail, site_id, centre_id, sync_id, date_heure)
    VALUES (NULL, v_login, 'UPDATE_CONTACT',
            format('[MISE A JOUR CONTACT] Retrait par l''assure (MOBILE): ancien %s, nouveau %s (carte %s)',
                   COALESCE(public.fn_mobile_masque(v_carte.contact), 'vide'),
                   public.fn_mobile_masque(v_new_cont), v_carte.sync_id),
            v_carte.id_site, v_centre, gen_random_uuid()::text, v_now);
  END IF;
  IF v_override IS NOT NULL AND v_override IS DISTINCT FROM v_carte.id_centre THEN
    INSERT INTO public.t_logs (id_user, login_user, action, detail, valeur_apres, site_id, centre_id, sync_id, date_heure)
    VALUES (NULL, v_login, 'CENTRE_CARTE_RECALCULE',
            format('Centre recalcule pour la carte %s suite a delivrance (MOBILE) avec rangement d''urgence : centre_id %s -> %s, d''apres le rangement "%s".',
                   v_carte.sync_id, COALESCE(v_carte.id_centre::text, 'NULL'), v_override, v_rang),
            jsonb_build_object('id_carte', v_carte.id_carte, 'sync_id', v_carte.sync_id,
                               'centre_id_avant', v_carte.id_centre, 'centre_id_apres', v_override,
                               'rangement', v_rang)::text,
            v_carte.id_site, v_override, gen_random_uuid()::text, v_now);
  END IF;
  INSERT INTO public.t_logs (id_user, login_user, action, detail, site_id, centre_id, sync_id, date_heure)
  VALUES (NULL, v_login, 'CARTE_DELIVREE',
          jsonb_build_object('id_carte', v_carte.id_carte,
                             'nom_retirant', v_nom,
                             'num_retirant', public.fn_mobile_masque(v_num),
                             'agent_distributeur', v_login,
                             'canal', 'MOBILE',
                             'sync_id', v_carte.sync_id,
                             'request_id', p_request_id::text,
                             'type_retirant', v_type)::text,
          v_carte.id_site, v_centre, gen_random_uuid()::text, v_now);

  RETURN jsonb_build_object('code', 'OK', 'reessai', false, 'sync_id', v_carte.sync_id,
                            'date_delivrance', v_res.date_delivrance, 'updated_at', v_res.updated_at,
                            'id_centre', v_res.id_centre,
                            'centre_recalcule', (v_override IS NOT NULL AND v_override IS DISTINCT FROM v_carte.id_centre),
                            'contact_mis_a_jour', v_new_cont IS NOT NULL);
END;
$$;

-- ------------------------------------------------------------
-- 4. Droits
-- ------------------------------------------------------------
REVOKE ALL ON FUNCTION public.fn_mobile_tel_chiffres(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_mobile_masque(TEXT)       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_mobile_operateur()        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_mobile_rechercher_cartes(TEXT, DATE, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_mobile_delivrer_carte(TEXT, TEXT, TEXT, TEXT, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_mobile_rechercher_cartes(TEXT, DATE, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_mobile_delivrer_carte(TEXT, TEXT, TEXT, TEXT, TEXT, UUID) TO authenticated;
