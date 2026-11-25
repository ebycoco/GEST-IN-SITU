-- ============================================================
-- 0022_fonction_mobile_mes_stats.sql
-- GEST-IN-SITU : version telephone, « Vue d'ensemble » de l'operateur de
-- verification (equivalent mobile de Overview.tsx + getVerificationStats,
-- src/main/database/queries/stats.queries.ts). UNE fonction :
--   fn_mobile_mes_stats()   (aucun parametre)
-- Purement ADDITIF : aucune table, colonne, politique, trigger, index ni droit
-- anon ajoute ou modifie. Reutilise fn_mobile_operateur() (0020) : memes
-- controles d'identite (42501 jeton / role ; COMPTE_INACTIF).
-- DEPEND DE 0020 (fn_mobile_operateur, fn_mobile_masque).
--
-- Cloisonnement : id_site = site du jeton ET UPPER(agent_distributeur) =
-- UPPER(login relu en base) ET statut = 'DELIVRE'. Rien d'autre n'est lu.
-- Periodes en UTC (Abidjan = UTC+0), intervalles [debut, fin[ plafonnes a
-- maintenant : jour, semaine du lundi au dimanche (date_trunc('week') = lundi
-- ISO), mois civil, annee civile ; une date de delivrance future n'est
-- JAMAIS comptee (borne haute = LEAST(fin de periode, now()), now() inclus).
-- Une seule passe d'agregation (FILTER) ; liste « retraits_jour » = ceux du
-- jour, triee par date decroissante, 200 lignes au plus.
-- Masquage (Q6, comme fn_mobile_rechercher_cartes) : num_secu et num_retirant
-- renvoyes sous forme « ********NN » (fn_mobile_masque) ; aucun numero en clair.
--
-- Contrat de retour (JSONB) :
--   {"code": "OK" | "COMPTE_INACTIF",
--    "site_nom", "centre_nom", "aujourd_hui", "semaine", "mois", "annee",
--    "retraits_jour": [{date_delivrance, noms, prenoms, date_de_naissance,
--      lieu_de_naissance, num_secu, rangement, nom_retirant,
--      relation_retirant, num_retirant}]}
--   (COMPTE_INACTIF : seul "code" est renvoye.)
--
-- Securite : SECURITY DEFINER, STABLE, search_path = '', EXECUTE : authenticated
-- seulement (REVOKE PUBLIC, anon). Idempotent : CREATE OR REPLACE.
-- Verrous : aucun verrou de table. Application : BEGIN; <ce fichier> COMMIT;
--
-- Retour arriere :
--   DROP FUNCTION IF EXISTS public.fn_mobile_mes_stats();
--
-- Application : dev ajadkziqaskadlzboeqo (voir README, section 0022).
-- Production itvyayakwgzvfqvdrgyv : NON appliquee (geste utilisateur, apres 0020).
-- Test : supabase/tests/0022_fonction_mobile_mes_stats.test.sql
-- ============================================================

SET LOCAL lock_timeout = '3s';

DO $garde$
BEGIN
  IF current_setting('lock_timeout') <> '3s' THEN
    RAISE EXCEPTION '0022 : lock_timeout de protection inactif (fichier execute hors transaction). Executer en un seul bloc : BEGIN; <fichier> COMMIT;';
  END IF;
  IF to_regprocedure('public.fn_mobile_operateur()') IS NULL
     OR to_regprocedure('public.fn_mobile_masque(text)') IS NULL THEN
    RAISE EXCEPTION '0022 : 0020 absente (fn_mobile_operateur / fn_mobile_masque) : appliquer 0020 d''abord.';
  END IF;
END;
$garde$;

CREATE OR REPLACE FUNCTION public.fn_mobile_mes_stats()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  c_max     CONSTANT INT := 200;
  v_ctx     JSONB;
  v_site    BIGINT;
  v_centre  BIGINT;
  v_login   TEXT;
  v_now     TIMESTAMPTZ := now();
  v_jour    TIMESTAMPTZ;
  v_semaine TIMESTAMPTZ;
  v_mois    TIMESTAMPTZ;
  v_annee   TIMESTAMPTZ;
  v_j INT; v_s INT; v_m INT; v_a INT;
  v_liste   JSONB;
  v_site_nom   TEXT;
  v_centre_nom TEXT;
BEGIN
  v_ctx := public.fn_mobile_operateur();
  IF v_ctx ->> 'code' <> 'OK' THEN
    RETURN v_ctx;
  END IF;
  v_login  := v_ctx ->> 'login';
  v_site   := (v_ctx ->> 'site_id')::bigint;
  v_centre := (v_ctx ->> 'centre_id')::bigint;

  v_jour    := date_trunc('day',   v_now AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  v_semaine := date_trunc('week',  v_now AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  v_mois    := date_trunc('month', v_now AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  v_annee   := date_trunc('year',  v_now AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';

  SELECT count(*) FILTER (WHERE c.date_delivrance >= v_jour),
         count(*) FILTER (WHERE c.date_delivrance >= v_semaine),
         count(*) FILTER (WHERE c.date_delivrance >= v_mois),
         count(*)
    INTO v_j, v_s, v_m, v_a
    FROM public.t_cartes c
   WHERE c.id_site = v_site
     AND c.statut = 'DELIVRE'
     AND upper(c.agent_distributeur) = upper(v_login)
     AND c.date_delivrance >= v_annee
     AND c.date_delivrance <= v_now;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'date_delivrance',   x.date_delivrance,
           'noms',              x.noms,
           'prenoms',           x.prenoms,
           'date_de_naissance', x.date_naissance,
           'lieu_de_naissance', x.lieu_naissance,
           'num_secu',          public.fn_mobile_masque(x.num_secu),
           'rangement',         x.rangement,
           'nom_retirant',      x.nom_retirant,
           'relation_retirant', x.relation_retirant,
           'num_retirant',      public.fn_mobile_masque(x.num_retirant)
         ) ORDER BY x.date_delivrance DESC, x.id_carte DESC), '[]'::jsonb)
    INTO v_liste
    FROM (SELECT c.id_carte, c.date_delivrance, c.noms, c.prenoms, c.date_naissance,
                 c.lieu_naissance, c.num_secu, c.rangement, c.nom_retirant,
                 c.relation_retirant, c.num_retirant
            FROM public.t_cartes c
           WHERE c.id_site = v_site
             AND c.statut = 'DELIVRE'
             AND upper(c.agent_distributeur) = upper(v_login)
             AND c.date_delivrance >= v_jour
             AND c.date_delivrance <= v_now
           ORDER BY c.date_delivrance DESC, c.id_carte DESC
           LIMIT c_max) x;

  SELECT s.nom INTO v_site_nom FROM public.t_sites s WHERE s.id = v_site;
  SELECT ce.nom INTO v_centre_nom FROM public.t_centres ce
   WHERE ce.id = v_centre AND ce.site_id = v_site;

  RETURN jsonb_build_object('code', 'OK',
                            'site_nom', v_site_nom, 'centre_nom', v_centre_nom,
                            'aujourd_hui', v_j, 'semaine', v_s, 'mois', v_m, 'annee', v_a,
                            'retraits_jour', v_liste);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_mobile_mes_stats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_mobile_mes_stats() TO authenticated;
