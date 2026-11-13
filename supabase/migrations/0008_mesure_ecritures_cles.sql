-- ============================================================
-- 0008_mesure_ecritures_cles.sql
-- GEST-IN-SITU : mesure des ecritures par type de cle (chantier B, P1-1,
-- docs/PLAN_P1_CHANTIER_B.md). Purement ADDITIF et SILENCIEUX.
--
-- But : savoir, sans lire aucune cle, quelles ecritures arrivent encore avec
-- l'ancienne cle anon (JWT "legacy") et lesquelles avec la cle publishable,
-- pour decider quand desactiver l'ancienne cle (D6 : 7 jours sans ecriture
-- legacy_suppose, tout le parc >= 2.26.1).
--
-- Constats d'origine (P1-0, RELAIS.md) :
--   - l'en-tete apikey n'arrive pas dans Postgres : on classe par la FORME
--     des claims (request.jwt.claims). Cle publishable -> {"role":"anon"}
--     seul (verifie sur le dev). Cle legacy -> iss, ref, iat, exp attendus
--     (SUPPOSE, d'apres la doc : a prouver en prod, P1-1b) ;
--   - Postgres 17 refuse un seul trigger "AFTER INSERT OR UPDATE ...
--     REFERENCING" : un trigger STATEMENT par operation ; sur un upsert
--     ON CONFLICT DO UPDATE les triggers INSERT et UPDATE partent tous les
--     deux, meme a 0 ligne -> table de transition vide = rien n'est ecrit.
--
-- Ce que fait ce fichier :
--   1. t_write_audit_config : interrupteur (une ligne, id = 1).
--   2. t_write_audit : COMPTEURS agreges (pas une ligne par appel), cle
--      (jour, table_name, op, jwt_role, claim_keys, client_info, classe)
--      (classe ajoutee a la cle le 2026-11-13, reserve P2-2 de l'audit
--      agent-9 : une ligne ne melange jamais deux classes).
--      claim_keys = liste triee des NOMS de cles de request.jwt.claims.
--      Aucune VALEUR de claim n'est stockee, sauf le role (jwt_role), demande
--      explicitement par le plan. client_info = en-tete x-client-info,
--      caracteres hors [A-Za-z0-9._/@:+ -] remplaces par '?', 64 caracteres
--      maximum (cardinalite bornee).
--   3. fn_write_audit_classe() : classement de l'appelant courant
--      (aussi reutilise par 0009) :
--        role = 'anon' ET claims ?& {iss,ref,iat,exp}   -> legacy_suppose
--        role = 'anon' ET claims lisibles ET NOT ? 'iss' -> publishable
--        role = 'authenticated'                         -> authenticated
--        role = 'service_role'                          -> service_role
--        aucun claim ET session_user <> 'authenticator' -> postgres
--        tout le reste (anon avec iss incomplet, anon SANS claims lisibles
--        -- role lu seulement dans request.jwt.claim.role --, role inconnu,
--        API sans claims, JSON illisible via l'API)    -> autre
--      (anon sans claims = autre et non publishable depuis le 2026-11-13,
--      reserve P1-3 : un cas inconnu ne doit jamais etre compte comme la
--      nouvelle cle. Verifie sur le dev le 2026-11-13 : un vrai appel REST
--      avec la cle publishable donne des claims {"role":"anon"}, donc reste
--      publishable.)
--   4. fn_write_audit_stmt() : fonction trigger STATEMENT, SECURITY DEFINER,
--      search_path fige, lock_timeout 200 ms ; ne leve JAMAIS d'erreur vers
--      le poste (EXCEPTION WHEN others -> RAISE WARNING avec SQLSTATE seul).
--   5. 3 triggers par table surveillee (24 au total) :
--        trg_wa_<table>_ins  AFTER INSERT  REFERENCING NEW TABLE AS wa_rows
--        trg_wa_<table>_upd  AFTER UPDATE  REFERENCING NEW TABLE AS wa_rows
--        trg_wa_<table>_del  AFTER DELETE  REFERENCING OLD TABLE AS wa_rows
--      Tables : t_cartes, t_users, t_user_roles, t_logs, t_sites, t_centres,
--      t_postes, t_user_presence (une table absente est sautee, NOTICE).
--
-- Contention (deux postes qui ecrivent en meme temps) :
--   - meme cle de compteur (meme jour/table/op/classe/client_info) : l'upsert
--     ON CONFLICT DO UPDATE est atomique (pas d'erreur d'unicite) ; le second
--     attend le verrou de ligne du premier jusqu'a SON COMMIT. Une requete
--     PostgREST = une transaction courte, le trigger part en fin
--     d'instruction juste avant le commit : attente de l'ordre de la ms ;
--   - transaction longue ou multi-instructions (RPC, SQL Editor) : l'attente
--     est bornee par lock_timeout = 200 ms (reglage limite a la fonction) ;
--     au-dela, ou en cas de deadlock (40P01), le compteur de CETTE
--     instruction est perdu (WARNING), l'ecriture metier passe toujours. Le
--     bloc EXCEPTION est une sous-transaction : son verrou est relache tout
--     de suite. Consequence : sous-comptage possible en cas de forte
--     contention, jamais de blocage durable ni d'erreur au poste.
--   Mesure reelle sur le dev : voir docs/PLAN_P1_CHANTIER_B.md (P1-1).
--
-- Securite : t_write_audit et t_write_audit_config en RLS active SANS
-- politique + REVOKE ALL pour anon/authenticated (lecture : SQL Editor ou
-- service_role). EXECUTE des fonctions retire a PUBLIC/anon/authenticated.
-- Le trigger ne lit que les noms de claims, le role, et x-client-info.
--
-- Idempotent : CREATE TABLE IF NOT EXISTS, INSERT ... ON CONFLICT DO NOTHING,
-- CREATE OR REPLACE FUNCTION, CREATE OR REPLACE TRIGGER (PG >= 14 ; dev
-- PG 17.11, prod PG 17.6). Aucune colonne ajoutee aux tables metier, aucune
-- donnee metier modifiee. Les triggers sont AFTER : ils ne changent jamais
-- les lignes ecrites.
--
-- APPLICATION (reserve P1-1 de l'audit agent-9) : ce fichier commence par
-- SET LOCAL lock_timeout = '3s' et un controle qui ARRETE tout si ce reglage
-- n'est pas actif (fichier execute hors transaction). En prod, l'utilisateur
-- colle UN SEUL bloc dans le SQL Editor :  BEGIN;  <tout ce fichier>  COMMIT;
-- Chaque verrou (ShareRowExclusiveLock par CREATE TRIGGER, mesure sur le dev)
-- attend au plus 3 s ; au-dela, erreur 55P03 et TOUT est annule (rien n'est
-- cree) : rejouer plus tard. Hors heures de travail des postes. Verification
-- prealable et requete de CONTROLE : supabase/migrations/README.md.
--
-- ORDRE D'URGENCE (du plus doux au plus lourd ; reserve P1-2) :
--   1. Interrupteur (immediat, reversible, aucun verrou de table) :
--        UPDATE public.t_write_audit_config SET enabled = false, updated_at = now() WHERE id = 1;
--      (reactivation : enabled = true). Ligne absente = mesure INACTIVE.
--      Desactive, le trigger fait une seule lecture de la ligne de config.
--   2. Debrancher les triggers sans DROP (ShareRowExclusiveLock court) :
--        BEGIN;
--        SET LOCAL lock_timeout = '3s';
--        DO $dis$ DECLARE t TEXT; BEGIN
--          FOREACH t IN ARRAY ARRAY['t_cartes','t_users','t_user_roles','t_logs',
--            't_sites','t_centres','t_postes','t_user_presence'] LOOP
--            IF to_regclass('public.' || t) IS NOT NULL THEN
--              EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER %I', t, 'trg_wa_' || t || '_ins');
--              EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER %I', t, 'trg_wa_' || t || '_upd');
--              EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER %I', t, 'trg_wa_' || t || '_del');
--            END IF;
--          END LOOP; END $dis$;
--        COMMIT;
--      (reactivation : meme bloc avec ENABLE TRIGGER).
--   3. Retour arriere complet, SEULEMENT hors heures (DROP TRIGGER prend un
--      AccessExclusiveLock sur la table metier, mesure sur le dev). Retirer
--      0009 AVANT (0009 utilise fn_write_audit_classe et
--      fn_write_audit_client_info). Un seul bloc :
--        BEGIN;
--        SET LOCAL lock_timeout = '3s';
--        DO $rb$ DECLARE t TEXT; BEGIN
--          FOREACH t IN ARRAY ARRAY['t_cartes','t_users','t_user_roles','t_logs',
--            't_sites','t_centres','t_postes','t_user_presence'] LOOP
--            IF to_regclass('public.' || t) IS NOT NULL THEN
--              EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', 'trg_wa_' || t || '_ins', t);
--              EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', 'trg_wa_' || t || '_upd', t);
--              EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', 'trg_wa_' || t || '_del', t);
--            END IF;
--          END LOOP; END $rb$;
--        DROP FUNCTION IF EXISTS public.fn_write_audit_stmt();
--        DROP FUNCTION IF EXISTS public.fn_write_audit_classe();
--        DROP FUNCTION IF EXISTS public.fn_write_audit_client_info();
--        DROP FUNCTION IF EXISTS public.fn_write_audit_claim_keys();
--        DROP FUNCTION IF EXISTS public.fn_write_audit_claims();
--        DROP TABLE IF EXISTS public.t_write_audit;
--        DROP TABLE IF EXISTS public.t_write_audit_config;
--        COMMIT;
--      En cas d'erreur 55P03 : rien n'est retire, l'etape 1 ou 2 reste en
--      place ; rejouer plus tard.
--
-- Lecture des compteurs (SQL Editor) :
--   SELECT jour, classe, table_name, op, jwt_role, claim_keys, client_info,
--          nb_instructions, nb_lignes, derniere_vue
--   FROM public.t_write_audit ORDER BY jour DESC, classe, table_name, op;
--
-- Application : dev ajadkziqaskadlzboeqo : APPLIQUEE le 2026-11-13 (agent-4,
-- apply_migration) ; test SQL 20/20 ; appels REST reels cle publishable
-- classes "publishable" avec les bons nb_lignes ; 10 upserts concurrents sans
-- erreur ni compteur perdu ; verrou tenu 4 s par une autre transaction : 3
-- requetes retardees d'environ 220 ms, aucune erreur, 3 compteurs perdus (attendu).
-- Version corrigee (reserves de l'audit agent-9 : lock_timeout de
-- protection, classe dans la cle, anon sans claims = autre) : dev retour
-- arriere puis REAPPLIQUEE le 2026-11-13 (agent-4) ; resultats des tests :
-- docs/PLAN_P1_CHANTIER_B.md (P1-1).
-- Production itvyayakwgzvfqvdrgyv : APPLIQUEE le 2026-11-13 vers 23 h 40
-- (session principale, apply_migration, sur autorisation ecrite de
-- l'utilisateur), apres verification prealable 5/5 OK ; controle
-- post-application 12/12 OK. Compteurs vides a l'application (nuit).
-- Test : supabase/tests/0008_mesure_ecritures_cles.test.sql
-- ============================================================

-- ------------------------------------------------------------
-- 0. Protection : verrous bornes a 3 s, sinon tout est annule (55P03)
-- ------------------------------------------------------------
SET LOCAL lock_timeout = '3s';

DO $garde$
BEGIN
  IF current_setting('lock_timeout') <> '3s' THEN
    RAISE EXCEPTION '0008 : lock_timeout de protection inactif (fichier execute hors transaction). Executer en un seul bloc : BEGIN; <fichier> COMMIT;';
  END IF;
  -- Ancienne version (cle sans classe) deja en place : retour arriere d'abord.
  IF to_regclass('public.t_write_audit') IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM pg_constraint c
       JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
       WHERE c.conrelid = to_regclass('public.t_write_audit')
         AND c.contype = 'p' AND a.attname = 'classe') THEN
    RAISE EXCEPTION '0008 : t_write_audit existe avec une ancienne cle primaire sans classe : faire le retour arriere (etape 3) puis reappliquer.';
  END IF;
END;
$garde$;

-- ------------------------------------------------------------
-- 1. Interrupteur (une seule ligne, id = 1)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.t_write_audit_config (
  id         SMALLINT PRIMARY KEY CHECK (id = 1),
  enabled    BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.t_write_audit_config (id, enabled, updated_at)
VALUES (1, true, NOW())
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.t_write_audit_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.t_write_audit_config FROM anon, authenticated;

-- ------------------------------------------------------------
-- 2. Compteurs agreges
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.t_write_audit (
  jour            DATE        NOT NULL,
  table_name      TEXT        NOT NULL,
  op              TEXT        NOT NULL,
  jwt_role        TEXT        NOT NULL DEFAULT '',
  claim_keys      TEXT        NOT NULL DEFAULT '',
  client_info     TEXT        NOT NULL DEFAULT '',
  classe          TEXT        NOT NULL,
  nb_instructions BIGINT      NOT NULL DEFAULT 0,
  nb_lignes       BIGINT      NOT NULL DEFAULT 0,
  premiere_vue    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  derniere_vue    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT t_write_audit_pkey
    PRIMARY KEY (jour, table_name, op, jwt_role, claim_keys, client_info, classe)
);

CREATE INDEX IF NOT EXISTS idx_write_audit_classe_jour ON public.t_write_audit(classe, jour);

ALTER TABLE public.t_write_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.t_write_audit FROM anon, authenticated;

-- ------------------------------------------------------------
-- 3. Lecture de l'appelant (aucune erreur possible)
-- ------------------------------------------------------------
-- Claims de la requete en cours ; NULL si absents, vides ou illisibles.
CREATE OR REPLACE FUNCTION public.fn_write_audit_claims()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_raw TEXT;
  v_j   JSONB := NULL;
BEGIN
  v_raw := current_setting('request.jwt.claims', true);
  IF v_raw IS NOT NULL AND btrim(v_raw) <> '' THEN
    BEGIN
      v_j := v_raw::jsonb;
      IF jsonb_typeof(v_j) <> 'object' THEN
        v_j := NULL;
      END IF;
    EXCEPTION WHEN others THEN
      v_j := NULL;
    END;
  END IF;
  RETURN v_j;
END;
$$;

-- Noms de cles tries, separes par des virgules, 200 caracteres maximum.
CREATE OR REPLACE FUNCTION public.fn_write_audit_claim_keys()
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_j    JSONB := public.fn_write_audit_claims();
  v_keys TEXT;
BEGIN
  IF v_j IS NULL THEN
    RETURN '';
  END IF;
  SELECT string_agg(regexp_replace(k, '[^A-Za-z0-9_.:-]', '?', 'g'), ',' ORDER BY k)
    INTO v_keys
    FROM jsonb_object_keys(v_j) AS k;
  RETURN left(COALESCE(v_keys, ''), 200);
END;
$$;

-- En-tete x-client-info, borne (64 caracteres, jeu de caracteres limite).
CREATE OR REPLACE FUNCTION public.fn_write_audit_client_info()
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_raw TEXT;
  v_ci  TEXT := NULL;
BEGIN
  v_raw := current_setting('request.headers', true);
  IF v_raw IS NOT NULL AND btrim(v_raw) <> '' THEN
    BEGIN
      v_ci := (v_raw::jsonb) ->> 'x-client-info';
    EXCEPTION WHEN others THEN
      v_ci := NULL;
    END;
  END IF;
  RETURN left(regexp_replace(COALESCE(v_ci, ''), '[^A-Za-z0-9._/@:+ -]', '?', 'g'), 64);
END;
$$;

-- Classe de l'appelant courant (voir en-tete).
CREATE OR REPLACE FUNCTION public.fn_write_audit_classe()
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_j    JSONB := public.fn_write_audit_claims();
  v_role TEXT;
BEGIN
  v_role := NULLIF(btrim(COALESCE(v_j ->> 'role', '')), '');
  IF v_role IS NULL THEN
    v_role := NULLIF(btrim(COALESCE(current_setting('request.jwt.claim.role', true), '')), '');
  END IF;

  IF v_role = 'anon' THEN
    IF v_j IS NULL THEN
      RETURN 'autre'; -- role anon sans claims lisibles : forme inconnue (P1-3)
    ELSIF v_j ?& ARRAY['iss', 'ref', 'iat', 'exp'] THEN
      RETURN 'legacy_suppose';
    ELSIF NOT (v_j ? 'iss') THEN
      RETURN 'publishable';
    END IF;
    RETURN 'autre';
  ELSIF v_role = 'authenticated' THEN
    RETURN 'authenticated';
  ELSIF v_role = 'service_role' THEN
    RETURN 'service_role';
  ELSIF v_role IS NULL AND v_j IS NULL AND session_user::text <> 'authenticator' THEN
    RETURN 'postgres';
  END IF;
  RETURN 'autre';
EXCEPTION WHEN others THEN
  RETURN 'autre';
END;
$$;

-- ------------------------------------------------------------
-- 4. Fonction trigger STATEMENT (ne leve jamais d'erreur)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_write_audit_stmt()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET lock_timeout = '200ms'
AS $$
DECLARE
  v_enabled BOOLEAN;
  v_n       BIGINT;
  v_j       JSONB;
  v_role    TEXT;
BEGIN
  BEGIN
    SELECT c.enabled INTO v_enabled FROM public.t_write_audit_config c WHERE c.id = 1;
    IF NOT COALESCE(v_enabled, false) THEN
      RETURN NULL;
    END IF;

    -- wa_rows = NEW TABLE (INSERT/UPDATE) ou OLD TABLE (DELETE).
    SELECT count(*) INTO v_n FROM wa_rows;
    IF v_n = 0 THEN
      RETURN NULL; -- cas normal de l'upsert : un des deux triggers voit 0 ligne
    END IF;

    v_j := public.fn_write_audit_claims();
    v_role := NULLIF(btrim(COALESCE(v_j ->> 'role', '')), '');
    IF v_role IS NULL THEN
      v_role := NULLIF(btrim(COALESCE(current_setting('request.jwt.claim.role', true), '')), '');
    END IF;

    INSERT INTO public.t_write_audit AS a
      (jour, table_name, op, jwt_role, claim_keys, client_info, classe,
       nb_instructions, nb_lignes, premiere_vue, derniere_vue)
    VALUES
      ((NOW() AT TIME ZONE 'UTC')::date, TG_TABLE_NAME, TG_OP,
       left(regexp_replace(COALESCE(v_role, ''), '[^A-Za-z0-9_.-]', '?', 'g'), 32),
       public.fn_write_audit_claim_keys(), public.fn_write_audit_client_info(),
       public.fn_write_audit_classe(), 1, v_n, NOW(), NOW())
    ON CONFLICT (jour, table_name, op, jwt_role, claim_keys, client_info, classe) DO UPDATE SET
      nb_instructions = a.nb_instructions + 1,
      nb_lignes       = a.nb_lignes + EXCLUDED.nb_lignes,
      derniere_vue    = GREATEST(a.derniere_vue, EXCLUDED.derniere_vue);
  EXCEPTION WHEN others THEN
    -- Jamais d'erreur renvoyee au poste : le compteur de cette instruction est perdu.
    RAISE WARNING 'fn_write_audit_stmt : compteur non ecrit (table %, op %, code %)',
      TG_TABLE_NAME, TG_OP, SQLSTATE;
  END;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_write_audit_stmt()        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_write_audit_classe()      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_write_audit_client_info() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_write_audit_claim_keys()  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_write_audit_claims()      FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 5. Triggers STATEMENT (3 par table surveillee)
-- ------------------------------------------------------------
DO $wa$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['t_cartes', 't_users', 't_user_roles', 't_logs',
                           't_sites', 't_centres', 't_postes', 't_user_presence'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE '0008 : table public.% absente, non surveillee', t;
      CONTINUE;
    END IF;
    EXECUTE format(
      'CREATE OR REPLACE TRIGGER %I AFTER INSERT ON public.%I '
      'REFERENCING NEW TABLE AS wa_rows FOR EACH STATEMENT '
      'EXECUTE FUNCTION public.fn_write_audit_stmt()', 'trg_wa_' || t || '_ins', t);
    EXECUTE format(
      'CREATE OR REPLACE TRIGGER %I AFTER UPDATE ON public.%I '
      'REFERENCING NEW TABLE AS wa_rows FOR EACH STATEMENT '
      'EXECUTE FUNCTION public.fn_write_audit_stmt()', 'trg_wa_' || t || '_upd', t);
    EXECUTE format(
      'CREATE OR REPLACE TRIGGER %I AFTER DELETE ON public.%I '
      'REFERENCING OLD TABLE AS wa_rows FOR EACH STATEMENT '
      'EXECUTE FUNCTION public.fn_write_audit_stmt()', 'trg_wa_' || t || '_del', t);
  END LOOP;
END;
$wa$;
