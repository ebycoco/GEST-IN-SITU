-- ============================================================
-- 0012_tentatives_connexion.sql
-- GEST-IN-SITU : limite des tentatives de connexion PAR LOGIN (chantier B,
-- P1-5, objet E de l'annexe B de docs/PLAN_P1_CHANTIER_B.md, choix C5).
-- Purement ADDITIF : une table de service, trois fonctions ; aucune table
-- metier touchee.
--
-- Regle C5 : 5 echecs -> blocage 15 min ; chaque nouveau blocage double la
-- duree (15, 30, 60 min...), plafond 24 h ; deblocage par un SUPER ADMIN.
-- Pas de blocage par IP (plusieurs postes derriere la meme IP).
-- Remise a zero : connexion reussie, deblocage SA, ou dernier echec vieux de
-- plus de 24 h (hors blocage en cours).
--
-- DEPEND DE 0011 (fn_jwt_is_super_admin, pour le deblocage) : appliquer 0011
-- avant 0012.
--
-- Ce que fait ce fichier :
--   1. t_login_attempts : une ligne par login (cle = SHA-256 hexadecimal du
--      login normalise lower(btrim(login)) : le login n'est PAS stocke en
--      clair). nb_echecs (echecs consecutifs depuis le dernier blocage ou
--      succes), nb_blocages (pour le doublement), bloque_jusqu_a. RLS active
--      SANS politique, REVOKE ALL anon/authenticated.
--   2. fn_login_check_and_record(p_login, p_action) -> jsonb
--        p_action = 'check'   : {"allowed": bool, "retry_after_s": int}
--        p_action = 'failure' : enregistre un echec (sans effet pendant un
--                               blocage en cours) puis renvoie l'etat
--        p_action = 'success' : remet le compteur a zero (supprime la ligne)
--      Login invalide (NULL, vide, > 128 caracteres) ou action inconnue :
--      {"allowed": false, "retry_after_s": 0, "invalid": true}.
--      EXECUTE service_role SEULEMENT (appelee par l'Edge Function gis-login,
--      passage suivant). Login inconnu de t_users : compte comme un autre
--      (aucune difference visible -> pas d'enumeration des logins).
--      Plafond anti-remplissage : au-dela de 20 000 lignes, purge des lignes
--      non bloquees dont le dernier echec a plus de 24 h ; si la table reste
--      pleine, un NOUVEAU login n'est pas enregistre (l'echec n'est pas
--      compte, la verification du mot de passe reste obligatoire).
--   3. fn_login_unblock(p_login) -> boolean : deblocage. Accepte seulement
--      si l'appelant est service_role, postgres (SQL Editor) ou un
--      authenticated porteur de gis_is_super_admin = true (claims du hook
--      0011). EXECUTE service_role seulement pour l'instant ; ouvrir a
--      authenticated quand l'ecran SA utilisera une session (P2) :
--        GRANT EXECUTE ON FUNCTION public.fn_login_unblock(TEXT) TO authenticated;
--
-- Idempotent : CREATE TABLE IF NOT EXISTS, CREATE OR REPLACE FUNCTION.
-- Application : un seul bloc  BEGIN; <ce fichier> COMMIT;  (SET LOCAL
-- lock_timeout = '3s' + controle en tete). Aucun verrou sur une table metier.
-- Retour arriere complet :
--   BEGIN;
--   SET LOCAL lock_timeout = '3s';
--   DROP FUNCTION IF EXISTS public.fn_login_unblock(TEXT);
--   DROP FUNCTION IF EXISTS public.fn_login_check_and_record(TEXT, TEXT);
--   DROP FUNCTION IF EXISTS public.fn_login_key(TEXT);
--   DROP TABLE IF EXISTS public.t_login_attempts;
--   COMMIT;
--
-- Deblocage manuel (SQL Editor, role postgres) :
--   SELECT public.fn_login_unblock('<LOGIN>');
-- Lecture (aucun login en clair) :
--   SELECT left(login_key, 8) AS cle, nb_echecs, nb_blocages, bloque_jusqu_a,
--          dernier_echec_at FROM public.t_login_attempts
--   ORDER BY dernier_echec_at DESC NULLS LAST LIMIT 100;
--
-- Application : dev ajadkziqaskadlzboeqo : appliquee le 2026-11-18 (MCP
-- apply_migration, PostgreSQL 17.11) ; voir supabase/migrations/README.md.
-- Production itvyayakwgzvfqvdrgyv : NON appliquee (geste utilisateur, avec
-- 0011, apres P1-6 et audit agent-9).
-- Test : supabase/tests/0012_tentatives_connexion.test.sql
-- ============================================================

-- ------------------------------------------------------------
-- 0. Protection
-- ------------------------------------------------------------
SET LOCAL lock_timeout = '3s';

DO $garde$
BEGIN
  IF current_setting('lock_timeout') <> '3s' THEN
    RAISE EXCEPTION '0012 : lock_timeout de protection inactif (fichier execute hors transaction). Executer en un seul bloc : BEGIN; <fichier> COMMIT;';
  END IF;
  IF to_regprocedure('public.fn_jwt_is_super_admin()') IS NULL THEN
    RAISE EXCEPTION '0012 : 0011 absente (fn_jwt_is_super_admin) : appliquer 0011 d''abord.';
  END IF;
END;
$garde$;

-- ------------------------------------------------------------
-- 1. Table
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.t_login_attempts (
  login_key        TEXT        PRIMARY KEY,
  nb_echecs        INTEGER     NOT NULL DEFAULT 0,
  nb_blocages      INTEGER     NOT NULL DEFAULT 0,
  premier_echec_at TIMESTAMPTZ,
  dernier_echec_at TIMESTAMPTZ,
  bloque_jusqu_a   TIMESTAMPTZ,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT t_login_attempts_key_fmt CHECK (login_key ~ '^[0-9a-f]{64}$'),
  CONSTRAINT t_login_attempts_nb_ok   CHECK (nb_echecs >= 0 AND nb_blocages >= 0)
);

CREATE INDEX IF NOT EXISTS idx_login_attempts_dernier_echec ON public.t_login_attempts(dernier_echec_at);

ALTER TABLE public.t_login_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.t_login_attempts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.t_login_attempts TO service_role;

-- ------------------------------------------------------------
-- 2. Cle d'un login (SHA-256 du login normalise ; NULL si invalide)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_login_key(p_login TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_login IS NULL OR btrim(p_login) = '' OR length(p_login) > 128 THEN NULL
    ELSE encode(sha256(convert_to(lower(btrim(p_login)), 'UTF8')), 'hex')
  END
$$;

REVOKE ALL ON FUNCTION public.fn_login_key(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_login_key(TEXT) TO service_role;

-- ------------------------------------------------------------
-- 3. Verification / enregistrement
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_login_check_and_record(p_login TEXT, p_action TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '2s'
AS $$
DECLARE
  c_seuil    CONSTANT INTEGER  := 5;
  c_base     CONSTANT INTERVAL := INTERVAL '15 minutes';
  c_plafond  CONSTANT INTERVAL := INTERVAL '24 hours';
  c_oubli    CONSTANT INTERVAL := INTERVAL '24 hours';
  c_max_rows CONSTANT INTEGER  := 20000;
  v_key   TEXT := public.fn_login_key(p_login);
  v_row   public.t_login_attempts%ROWTYPE;
  v_now   TIMESTAMPTZ := NOW();
  v_duree INTERVAL;
  v_found BOOLEAN;
BEGIN
  IF v_key IS NULL OR p_action IS NULL OR p_action NOT IN ('check', 'failure', 'success') THEN
    RETURN jsonb_build_object('allowed', false, 'retry_after_s', 0, 'invalid', true);
  END IF;

  IF p_action = 'success' THEN
    DELETE FROM public.t_login_attempts WHERE login_key = v_key;
    RETURN jsonb_build_object('allowed', true, 'retry_after_s', 0);
  END IF;

  SELECT * INTO v_row FROM public.t_login_attempts WHERE login_key = v_key FOR UPDATE;
  v_found := FOUND;

  -- Oubli : dernier echec vieux de plus de 24 h et aucun blocage en cours.
  IF v_found AND (v_row.bloque_jusqu_a IS NULL OR v_row.bloque_jusqu_a <= v_now)
     AND v_row.dernier_echec_at IS NOT NULL AND v_row.dernier_echec_at < v_now - c_oubli THEN
    DELETE FROM public.t_login_attempts WHERE login_key = v_key;
    v_found := false;
  END IF;

  -- Blocage en cours : refus, rien n'est modifie (un echec pendant le blocage
  -- ne prolonge pas le blocage).
  IF v_found AND v_row.bloque_jusqu_a IS NOT NULL AND v_row.bloque_jusqu_a > v_now THEN
    RETURN jsonb_build_object('allowed', false,
      'retry_after_s', ceil(extract(epoch FROM (v_row.bloque_jusqu_a - v_now)))::int);
  END IF;

  IF p_action = 'check' THEN
    RETURN jsonb_build_object('allowed', true, 'retry_after_s', 0);
  END IF;

  -- p_action = 'failure'
  IF NOT v_found THEN
    IF (SELECT count(*) FROM public.t_login_attempts) >= c_max_rows THEN
      DELETE FROM public.t_login_attempts
       WHERE (bloque_jusqu_a IS NULL OR bloque_jusqu_a <= v_now)
         AND (dernier_echec_at IS NULL OR dernier_echec_at < v_now - c_oubli);
      IF (SELECT count(*) FROM public.t_login_attempts) >= c_max_rows THEN
        RAISE WARNING 'fn_login_check_and_record : table pleine, echec non compte';
        RETURN jsonb_build_object('allowed', true, 'retry_after_s', 0);
      END IF;
    END IF;
    INSERT INTO public.t_login_attempts AS a
      (login_key, nb_echecs, nb_blocages, premier_echec_at, dernier_echec_at, bloque_jusqu_a, updated_at)
    VALUES (v_key, 1, 0, v_now, v_now, NULL, v_now)
    ON CONFLICT (login_key) DO UPDATE SET
      nb_echecs = a.nb_echecs + 1, dernier_echec_at = v_now, updated_at = v_now
    RETURNING * INTO v_row;
  ELSE
    UPDATE public.t_login_attempts
       SET nb_echecs = nb_echecs + 1,
           premier_echec_at = COALESCE(premier_echec_at, v_now),
           dernier_echec_at = v_now,
           updated_at = v_now
     WHERE login_key = v_key
    RETURNING * INTO v_row;
  END IF;

  IF v_row.nb_echecs >= c_seuil THEN
    -- 15 min * 2^nb_blocages, plafond 24 h (exposant borne pour eviter un depassement).
    v_duree := LEAST(c_base * power(2, LEAST(v_row.nb_blocages, 10))::int, c_plafond);
    UPDATE public.t_login_attempts
       SET nb_echecs = 0,
           nb_blocages = LEAST(nb_blocages + 1, 1000),
           bloque_jusqu_a = v_now + v_duree,
           updated_at = v_now
     WHERE login_key = v_key;
    RETURN jsonb_build_object('allowed', false,
      'retry_after_s', ceil(extract(epoch FROM v_duree))::int);
  END IF;

  RETURN jsonb_build_object('allowed', true, 'retry_after_s', 0);
EXCEPTION WHEN others THEN
  -- Echec FERME : en cas d'erreur, la connexion est refusee pour ce coup.
  RAISE WARNING 'fn_login_check_and_record : erreur (code %)', SQLSTATE;
  RETURN jsonb_build_object('allowed', false, 'retry_after_s', 60, 'error', true);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_login_check_and_record(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_login_check_and_record(TEXT, TEXT) TO service_role;

-- ------------------------------------------------------------
-- 4. Deblocage (SUPER ADMIN, service_role ou SQL Editor)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_login_unblock(p_login TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '2s'
AS $$
DECLARE
  v_key  TEXT := public.fn_login_key(p_login);
  v_raw  TEXT := current_setting('request.jwt.claims', true);
  v_role TEXT := NULL;
BEGIN
  IF v_raw IS NOT NULL AND btrim(v_raw) <> '' THEN
    BEGIN
      v_role := (v_raw::jsonb) ->> 'role';
    EXCEPTION WHEN others THEN
      v_role := 'invalide';
    END;
  END IF;

  IF NOT (
       v_role = 'service_role'
    OR (v_role IS NULL AND session_user::text <> 'authenticator')   -- SQL Editor (postgres)
    OR (v_role = 'authenticated' AND public.fn_jwt_is_super_admin())
  ) THEN
    RETURN false;
  END IF;
  IF v_key IS NULL THEN
    RETURN false;
  END IF;

  DELETE FROM public.t_login_attempts WHERE login_key = v_key;
  RETURN true;
EXCEPTION WHEN others THEN
  RAISE WARNING 'fn_login_unblock : refuse (code %)', SQLSTATE;
  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_login_unblock(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_login_unblock(TEXT) TO service_role;
