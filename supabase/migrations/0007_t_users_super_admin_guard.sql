-- ============================================================
-- 0007_t_users_super_admin_guard.sql
-- GEST-IN-SITU : garde-fou serveur anti-SUPER ADMIN via la cle anon
-- (option a2 validee par l'utilisateur, plan agent-1, 2026-11-13).
--
-- Probleme : t_users et t_user_roles sont ouverts en ecriture a la cle anon
-- (policies allow_all_* / "Enable ... for all users", USING (true)), et cette
-- cle est publique (distribuee avec l'application). N'importe qui peut donc,
-- par l'API REST, creer un SUPER ADMIN actif, elever un compte existant,
-- remplacer le mot de passe (hash) du SUPER ADMIN ou le supprimer.
--
-- Principe : neutralisation SILENCIEUSE (meme modele que 0006). Le garde ne
-- leve JAMAIS d'erreur vers le poste : le moteur outbox reessaie toute erreur
-- (5 tentatives puis ERROR remis en PENDING ; un message contenant certains
-- mots reseau est retente sans plafond, src/main/sync/outbox.service.ts:799).
-- Chaque geste neutralise est journalise dans t_security_guard_events.
--
-- Appelant "non fiable" (fn_sa_guard_caller_untrusted) :
--   role JWT = request.jwt.claims->>'role' (repli request.jwt.claim.role) ;
--   non fiable si role IN ('anon','authenticated'), ou si la session vient de
--   PostgREST (session_user = 'authenticator') sans role service_role
--   (echec FERME : claims absents/illisibles via l'API = non fiable).
--   service_role (cle secrete) et postgres sans claims (SQL Editor) = fiables.
--   Sources (Context7, 2026-11-13) : doc PostgREST references/transactions.rst
--   ("request.jwt.claims", role par defaut = db-anon-role ; un reglage vaut ''
--   et non NULL apres la transaction), references/auth.rst (le role
--   "authenticator" se connecte puis fait SET LOCAL ROLE <role du JWT>),
--   explanations/db_authz.rst (request.jwt.claim.<x> pour PG < 14) ; doc
--   Supabase row-level-security-performance.mdx (une requete PostgREST =
--   role + request.jwt.claims dont "role" reprend ce role). current_user n'est
--   PAS utilise : il vaut le proprietaire dans une fonction SECURITY DEFINER.
--
-- Regles (seulement pour un appelant non fiable, garde actif) :
--   R1 INSERT t_users role = 'SUPER ADMIN' :
--      - si une ligne de MEME sync_id existe deja (quel que soit son role) :
--        NEW rendu INTACT (l'INSERT deviendra l'UPDATE d'un ON CONFLICT, ou
--        echouera sur l'unicite) ; la ligne existante est verrouillee
--        FOR KEY SHARE pour fermer la course "suppression concurrente".
--        Toute modification faite ici passerait dans EXCLUDED et desactiverait
--        le compte existant ; la branche UPDATE est couverte par R2/R3.
--      - sinon : quarantaine, statut_actif := 0, journal SA_INSERT_QUARANTAINE.
--   R2 UPDATE non-SA -> SA : NEW.role := OLD.role, journal SA_ELEVATION_BLOQUEE.
--   R3 UPDATE d'une ligne SA : password_hash, login, sync_id ET role repris de
--      OLD ; statut_actif ne peut pas monter (baisse permise). Journal
--      SA_MODIF_NEUTRALISEE:<colonnes> seulement si quelque chose a ete
--      neutralise. Les autres colonnes (nom, contact, site...) passent.
--   R5 DELETE d'une ligne SA : ignore (RETURN NULL), journal SA_DELETE_IGNORE.
--   R6 t_user_roles INSERT/UPDATE vers role 'SUPER ADMIN' : accepte seulement
--      si t_users porte deja role = 'SUPER ADMIN' pour ce user_sync_id ;
--      sinon INSERT ignore (RETURN NULL) / UPDATE annule (RETURN OLD),
--      journal ROLES_SA_REFUSE.
--   Exception interne : repli FERME et silencieux (INSERT -> statut_actif 0 ;
--   UPDATE -> role/hash/login/sync_id/statut repris de OLD ; DELETE -> ignore ;
--   t_user_roles -> ignore/annule). RAISE WARNING avec SQLSTATE seul.
--
-- ECARTS A LA SPECIFICATION DU PLAN (a valider par l'utilisateur, voir rapport
-- agent-4 du 2026-11-13) :
--   E1 R1 teste "meme sync_id, quel que soit le role" (spec : "meme sync_id ET
--      role SA"). Sans cela, l'upsert d'un compte NON-SA envoye avec role SA
--      (ex. elevation legitime par ROOT) passerait en quarantaine dans
--      EXCLUDED et DESACTIVERAIT ce compte existant.
--   E2 R3 fige aussi le role (spec : "retrogradation permise"). Sans cela :
--      retrograder le SA par la cle anon, puis changer son hash et son statut
--      (plus soumis a R3), alors que sa ligne t_user_roles 'SUPER ADMIN'
--      demeure -> compte pirate avec le role secondaire SUPER ADMIN (l'app
--      honore les roles secondaires). Idem pour un SA en quarantaine.
--      Pour revenir a la spec : supprimer le bloc "E2" dans fn_t_users_sa_guard.
--   E3 fn_sa_guard_caller_untrusted : une session 'authenticator' avec un role
--      JWT autre que service_role est aussi non fiable (sur-ensemble ferme).
--
-- Securite : t_security_guard_config et t_security_guard_events en RLS active
-- sans policy + REVOKE ALL pour anon/authenticated (lecture/ecriture par
-- service_role ou SQL Editor seulement). Le journal ne contient JAMAIS
-- password_hash (attempted = role, statut_actif, site_id, hash_modifie).
-- Fonctions trigger SECURITY DEFINER, search_path fige, EXECUTE retire a
-- PUBLIC/anon/authenticated.
--
-- Idempotent : CREATE TABLE/INDEX IF NOT EXISTS, INSERT ... ON CONFLICT DO
-- NOTHING, CREATE OR REPLACE FUNCTION, CREATE OR REPLACE TRIGGER (PG >= 14 ;
-- dev et prod en PG 17). Aucun DROP, aucune colonne existante modifiee, aucune
-- donnee existante modifiee (seules les ecritures FUTURES sont filtrees).
--
-- Retour arriere immediat (une ligne, sans perte, reversible) :
--   UPDATE public.t_security_guard_config SET enabled = false, updated_at = now() WHERE id = 1;
-- Retour arriere complet (triggers inactifs) :
--   ALTER TABLE public.t_users      DISABLE TRIGGER trg_t_users_sa_guard_ins;
--   ALTER TABLE public.t_users      DISABLE TRIGGER trg_t_users_sa_guard_upd;
--   ALTER TABLE public.t_users      DISABLE TRIGGER trg_t_users_sa_guard_del;
--   ALTER TABLE public.t_user_roles DISABLE TRIGGER trg_t_user_roles_sa_guard_ins;
--   ALTER TABLE public.t_user_roles DISABLE TRIGGER trg_t_user_roles_sa_guard_upd;
--
-- Periode transitoire : les gestes legitimes de ROOT / d'un SUPER ADMIN qui
-- touchent un SUPER ADMIN (creation -> quarantaine ; reset ou changement de
-- mot de passe ou de login d'un SA -> cloud inchange ; elevation,
-- retrogradation, reactivation) sont rejoues a la main dans le SQL Editor.
-- Procedures pretes a copier : supabase/migrations/README.md, section
-- "0007 : procedures manuelles".
--
-- Application : dev ajadkziqaskadlzboeqo : APPLIQUEE le 2026-11-13 (apply_migration),
-- test SQL 20/20 OK (cas 16 "SET LOCAL ROLE anon" reel concluant) + appels
-- REST reels avec la cle publishable (jwt_role journalise = anon) ; donnees
-- de test supprimees. Production itvyayakwgzvfqvdrgyv : APPLIQUEE le
-- 2026-11-13 sur instruction explicite de l'utilisateur (apply_migration) ;
-- verifie : 5 triggers actifs, garde actif, journal vide et illisible/non
-- modifiable par anon, 1 SUPER ADMIN actif inchange.
-- Test : supabase/tests/0007_t_users_super_admin_guard.test.sql
-- ============================================================

-- ------------------------------------------------------------
-- 1. Interrupteur du garde (une seule ligne, id = 1)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.t_security_guard_config (
  id         SMALLINT PRIMARY KEY CHECK (id = 1),
  enabled    BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.t_security_guard_config (id, enabled, updated_at)
VALUES (1, true, NOW())
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.t_security_guard_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.t_security_guard_config FROM anon, authenticated;

-- ------------------------------------------------------------
-- 2. Journal des gestes neutralises (jamais de password_hash)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.t_security_guard_events (
  id         BIGSERIAL PRIMARY KEY,
  table_name TEXT,
  op         TEXT,
  sync_id    TEXT,
  login      TEXT,
  reason     TEXT,
  jwt_role   TEXT,
  attempted  JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_security_guard_events_created_at ON public.t_security_guard_events(created_at);
CREATE INDEX IF NOT EXISTS idx_security_guard_events_sync_id    ON public.t_security_guard_events(sync_id);

ALTER TABLE public.t_security_guard_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.t_security_guard_events FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.t_security_guard_events_id_seq FROM anon, authenticated;

-- ------------------------------------------------------------
-- 3. Identification de l'appelant
-- ------------------------------------------------------------
-- Role JWT de la requete en cours (NULL si absent, vide ou JSON illisible).
CREATE OR REPLACE FUNCTION public.fn_sa_guard_jwt_role()
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_raw  TEXT;
  v_role TEXT := NULL;
BEGIN
  v_raw := current_setting('request.jwt.claims', true);
  IF v_raw IS NOT NULL AND btrim(v_raw) <> '' THEN
    BEGIN
      v_role := (v_raw::jsonb) ->> 'role';
    EXCEPTION WHEN others THEN
      v_role := NULL; -- JSON illisible : traite comme absent
    END;
  END IF;
  IF v_role IS NULL OR btrim(v_role) = '' THEN
    v_role := NULLIF(btrim(COALESCE(current_setting('request.jwt.claim.role', true), '')), '');
  END IF;
  RETURN v_role;
END;
$$;

-- true = appelant non fiable (cle anon / utilisateur authentifie / API sans
-- role reconnu). session_user n'est change ni par SET ROLE ni par SECURITY
-- DEFINER : il reste le role de connexion ('authenticator' pour PostgREST).
CREATE OR REPLACE FUNCTION public.fn_sa_guard_caller_untrusted()
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role TEXT := public.fn_sa_guard_jwt_role();
BEGIN
  IF v_role IN ('anon', 'authenticated') THEN
    RETURN true;
  END IF;
  IF session_user::text = 'authenticator' AND v_role IS DISTINCT FROM 'service_role' THEN
    RETURN true; -- echec ferme (E3) : requete API sans role de confiance
  END IF;
  RETURN false;
END;
$$;

-- Ecriture du journal : ne leve jamais d'erreur ; retire password_hash par
-- precaution meme si un appelant futur l'ajoutait dans p_attempted.
CREATE OR REPLACE FUNCTION public.fn_sa_guard_log(
  p_table TEXT, p_op TEXT, p_sync_id TEXT, p_login TEXT, p_reason TEXT, p_attempted JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  BEGIN
    INSERT INTO public.t_security_guard_events
      (table_name, op, sync_id, login, reason, jwt_role, attempted, created_at)
    VALUES
      (p_table, p_op, p_sync_id, p_login, p_reason, public.fn_sa_guard_jwt_role(),
       COALESCE(p_attempted, '{}'::jsonb) - 'password_hash', NOW());
  EXCEPTION WHEN others THEN
    RAISE WARNING 'fn_sa_guard_log : journal non ecrit (code %)', SQLSTATE;
  END;
END;
$$;

-- ------------------------------------------------------------
-- 4. Fonction trigger t_users
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_t_users_sa_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_enabled    BOOLEAN;
  v_attempted  JSONB;
  v_neutralise TEXT[] := ARRAY[]::TEXT[];
BEGIN
  BEGIN
    SELECT c.enabled INTO v_enabled FROM public.t_security_guard_config c WHERE c.id = 1;
    -- Ligne de configuration absente : garde ACTIF (echec ferme).
    IF NOT COALESCE(v_enabled, true) OR NOT public.fn_sa_guard_caller_untrusted() THEN
      IF TG_OP = 'DELETE' THEN
        RETURN OLD;
      END IF;
      RETURN NEW;
    END IF;

    -- ---------- R1 : INSERT d'un SUPER ADMIN ----------
    IF TG_OP = 'INSERT' THEN
      IF NEW.sync_id IS NOT NULL THEN
        PERFORM 1 FROM public.t_users u WHERE u.sync_id = NEW.sync_id FOR KEY SHARE;
        IF FOUND THEN
          RETURN NEW; -- intact : branche UPDATE (R2/R3) ou echec d'unicite (E1)
        END IF;
      END IF;
      v_attempted := jsonb_build_object(
        'role', NEW.role, 'statut_actif', NEW.statut_actif,
        'site_id', NEW.site_id, 'hash_modifie', false);
      NEW.statut_actif := 0;
      PERFORM public.fn_sa_guard_log('t_users', 'INSERT', NEW.sync_id, NEW.login,
                                     'SA_INSERT_QUARANTAINE', v_attempted);
      RETURN NEW;
    END IF;

    -- ---------- R5 : DELETE d'un SUPER ADMIN ----------
    IF TG_OP = 'DELETE' THEN
      PERFORM public.fn_sa_guard_log('t_users', 'DELETE', OLD.sync_id, OLD.login,
        'SA_DELETE_IGNORE',
        jsonb_build_object('role', OLD.role, 'statut_actif', OLD.statut_actif,
                           'site_id', OLD.site_id, 'hash_modifie', false));
      RETURN NULL;
    END IF;

    -- ---------- UPDATE ----------
    v_attempted := jsonb_build_object(
      'role', NEW.role, 'statut_actif', NEW.statut_actif, 'site_id', NEW.site_id,
      'hash_modifie', (NEW.password_hash IS DISTINCT FROM OLD.password_hash));

    -- R2 : elevation vers SUPER ADMIN
    IF OLD.role IS DISTINCT FROM 'SUPER ADMIN' AND NEW.role = 'SUPER ADMIN' THEN
      NEW.role := OLD.role;
      PERFORM public.fn_sa_guard_log('t_users', 'UPDATE', OLD.sync_id, OLD.login,
                                     'SA_ELEVATION_BLOQUEE', v_attempted);
      RETURN NEW;
    END IF;

    -- R3 : ligne SUPER ADMIN existante
    IF OLD.role = 'SUPER ADMIN' THEN
      IF NEW.password_hash IS DISTINCT FROM OLD.password_hash THEN
        NEW.password_hash := OLD.password_hash;
        v_neutralise := v_neutralise || 'password_hash'::text;
      END IF;
      IF NEW.login IS DISTINCT FROM OLD.login THEN
        NEW.login := OLD.login;
        v_neutralise := v_neutralise || 'login'::text;
      END IF;
      IF NEW.sync_id IS DISTINCT FROM OLD.sync_id THEN
        NEW.sync_id := OLD.sync_id;
        v_neutralise := v_neutralise || 'sync_id'::text;
      END IF;
      -- E2 (ecart a la spec) : retrogradation interdite a la cle anon.
      IF NEW.role IS DISTINCT FROM OLD.role THEN
        NEW.role := OLD.role;
        v_neutralise := v_neutralise || 'role'::text;
      END IF;
      IF COALESCE(NEW.statut_actif, 1) > COALESCE(OLD.statut_actif, 1) THEN
        NEW.statut_actif := OLD.statut_actif;
        v_neutralise := v_neutralise || 'statut_actif'::text;
      END IF;
      IF array_length(v_neutralise, 1) > 0 THEN
        PERFORM public.fn_sa_guard_log('t_users', 'UPDATE', OLD.sync_id, OLD.login,
          'SA_MODIF_NEUTRALISEE:' || array_to_string(v_neutralise, ','), v_attempted);
      END IF;
    END IF;

    RETURN NEW;
  EXCEPTION WHEN others THEN
    -- Repli FERME et silencieux : jamais d'erreur renvoyee au poste.
    RAISE WARNING 'fn_t_users_sa_guard : repli ferme (op %, code %)', TG_OP, SQLSTATE;
    BEGIN
      PERFORM public.fn_sa_guard_log('t_users', TG_OP,
        CASE WHEN TG_OP = 'INSERT' THEN NEW.sync_id ELSE OLD.sync_id END,
        CASE WHEN TG_OP = 'INSERT' THEN NEW.login ELSE OLD.login END,
        'SA_GARDE_REPLI_FERME:' || SQLSTATE, NULL);
    EXCEPTION WHEN others THEN
      NULL;
    END;
    IF TG_OP = 'INSERT' THEN
      NEW.statut_actif := 0;
      RETURN NEW;
    ELSIF TG_OP = 'UPDATE' THEN
      NEW.role          := OLD.role;
      NEW.password_hash := OLD.password_hash;
      NEW.login         := OLD.login;
      NEW.sync_id       := OLD.sync_id;
      NEW.statut_actif  := OLD.statut_actif;
      RETURN NEW;
    END IF;
    RETURN NULL;
  END;
END;
$$;

-- ------------------------------------------------------------
-- 5. Fonction trigger t_user_roles
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_t_user_roles_sa_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_enabled BOOLEAN;
  v_login   TEXT;
BEGIN
  BEGIN
    SELECT c.enabled INTO v_enabled FROM public.t_security_guard_config c WHERE c.id = 1;
    IF NOT COALESCE(v_enabled, true) OR NOT public.fn_sa_guard_caller_untrusted() THEN
      RETURN NEW;
    END IF;

    IF EXISTS (SELECT 1 FROM public.t_users u
                WHERE u.sync_id = NEW.user_sync_id AND u.role = 'SUPER ADMIN') THEN
      RETURN NEW;
    END IF;

    SELECT u.login INTO v_login FROM public.t_users u WHERE u.sync_id = NEW.user_sync_id;
    PERFORM public.fn_sa_guard_log('t_user_roles', TG_OP, NEW.user_sync_id, v_login,
      'ROLES_SA_REFUSE', jsonb_build_object('role', NEW.role));
    IF TG_OP = 'INSERT' THEN
      RETURN NULL;
    END IF;
    RETURN OLD;
  EXCEPTION WHEN others THEN
    RAISE WARNING 'fn_t_user_roles_sa_guard : repli ferme (op %, code %)', TG_OP, SQLSTATE;
    BEGIN
      PERFORM public.fn_sa_guard_log('t_user_roles', TG_OP, NEW.user_sync_id, NULL,
        'ROLES_SA_REPLI_FERME:' || SQLSTATE, jsonb_build_object('role', NEW.role));
    EXCEPTION WHEN others THEN
      NULL;
    END;
    IF TG_OP = 'INSERT' THEN
      RETURN NULL;
    END IF;
    RETURN OLD;
  END;
END;
$$;

-- Aucun appel direct legitime (un trigger ne verifie pas le droit EXECUTE de
-- l'utilisateur qui declenche l'ecriture ; les fonctions appelees depuis une
-- fonction SECURITY DEFINER s'executent avec les droits du proprietaire).
REVOKE ALL ON FUNCTION public.fn_t_users_sa_guard()          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_t_user_roles_sa_guard()     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_sa_guard_log(TEXT, TEXT, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_sa_guard_caller_untrusted() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_sa_guard_jwt_role()         FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 6. Triggers (clauses WHEN : aucun cout sur les comptes non-SA)
-- ------------------------------------------------------------
CREATE OR REPLACE TRIGGER trg_t_users_sa_guard_ins
  BEFORE INSERT ON public.t_users
  FOR EACH ROW
  WHEN (NEW.role = 'SUPER ADMIN')
  EXECUTE FUNCTION public.fn_t_users_sa_guard();

CREATE OR REPLACE TRIGGER trg_t_users_sa_guard_upd
  BEFORE UPDATE ON public.t_users
  FOR EACH ROW
  WHEN (OLD.role = 'SUPER ADMIN' OR NEW.role = 'SUPER ADMIN')
  EXECUTE FUNCTION public.fn_t_users_sa_guard();

CREATE OR REPLACE TRIGGER trg_t_users_sa_guard_del
  BEFORE DELETE ON public.t_users
  FOR EACH ROW
  WHEN (OLD.role = 'SUPER ADMIN')
  EXECUTE FUNCTION public.fn_t_users_sa_guard();

CREATE OR REPLACE TRIGGER trg_t_user_roles_sa_guard_ins
  BEFORE INSERT ON public.t_user_roles
  FOR EACH ROW
  WHEN (NEW.role = 'SUPER ADMIN')
  EXECUTE FUNCTION public.fn_t_user_roles_sa_guard();

CREATE OR REPLACE TRIGGER trg_t_user_roles_sa_guard_upd
  BEFORE UPDATE ON public.t_user_roles
  FOR EACH ROW
  WHEN (NEW.role = 'SUPER ADMIN')
  EXECUTE FUNCTION public.fn_t_user_roles_sa_guard();

-- DELETE d'une ligne 'SUPER ADMIN' de t_user_roles : volontairement NON garde
-- (proposition, voir rapport) : c'est une baisse de droits ; l'application
-- supprime TOUS les roles d'un compte puis les reinsere a chaque mise a jour
-- (users.queries.ts, payload { sync_id } -> delete().eq('user_sync_id')), et
-- le poste remet toujours le role principal (users-sync.helper.ts:357) ; un
-- BEFORE DELETE qui ignore la ligne interfererait en outre avec l'ON DELETE
-- CASCADE depuis t_users.
