-- ============================================================
-- 0015_garde_sa_authenticated.sql
-- GEST-IN-SITU : adaptation du garde-fou SUPER ADMIN de 0007 aux sessions
-- authenticated porteuses des claims gis_* (chantier B, decision Q6 du
-- 2026-11-18 : nouvelle migration, le fichier 0007 n'est jamais modifie).
-- DEPEND DE 0007 (garde), 0011 (fn_jwt_*), 0013 et 0014 (politiques r13_* /
-- r14_*) : le fichier s'arrete si l'une manque.
--
-- Avant 0015 : 0007 traite TOUT appelant authenticated comme non fiable
-- (fn_sa_guard_caller_untrusted : role JWT 'anon' ou 'authenticated' = non
-- fiable). Un SUPER ADMIN connecte en ligne (P2, session gis-login + hook
-- 0011) verrait donc ses gestes legitimes sur les comptes SUPER ADMIN
-- neutralises (creation -> quarantaine, elevation annulee, etc.).
--
-- Regle retenue (alignee sur ce que l'application permet, lecture de src/
-- le 2026-11-18, src/ non modifie) :
--   1. anon (cle publishable / legacy / sans claims) : INCHANGE (0007 tel quel).
--   2. authenticated SANS claims gis_* valides (pas de gis_v, hook non
--      active, jeton forge), ou dont la claim gis_is_super_admin n'est pas
--      true : INCHANGE, non fiable (0007 tel quel). Cela couvre
--      l'ADMINISTRATEUR_SITE : il agit sur les comptes de SON site (RLS 0013)
--      mais ne cree / n'eleve JAMAIS un SUPER ADMIN (creation en
--      quarantaine, elevation annulee, role secondaire SUPER ADMIN refuse),
--      comme dans l'application : ASSIGNABLE_ROLES_BY_CREATOR
--      (src/main/database/queries/users.queries.ts:22-35) ne lui donne pas
--      'SUPER ADMIN', assertTargetNotSuperAdmin (users.queries.ts:93-102,
--      appele :710, :1014, :1096) lui interdit toute cible SUPER ADMIN.
--      ADMIN_CENTRE et OPERATEUR_* : idem (rien sur un SUPER ADMIN).
--   3. authenticated « SUPER ADMIN verifie » (fn_sa_guard_caller_sa_auth) :
--      claims gis_* valides (role authenticated + gis_v, fn_jwt_gis_claims de
--      0011), gis_is_super_admin = true, gis_statut_actif = true,
--      gis_sync_id non vide, ET le compte t_users de ce sync_id est ENCORE
--      actif et SUPER ADMIN (role principal ou t_user_roles) au moment de
--      l'ecriture : ferme la fenetre d'une heure d'un jeton emis avant une
--      desactivation ou une retrogradation (limite connue de 0011).
--      Il est traite comme FIABLE par 0007 (plus de quarantaine ni
--      d'elevation annulee), sauf les regles suivantes, alignees sur l'appli
--      et appliquees par un nouveau trigger (fn_t_users_sa_guard_auth) :
--        - creation d'un SUPER ADMIN : permise (users:create,
--          src/main/ipc/handlers.ts:3588-3604 ; createUser
--          users.queries.ts:281-345 ; le SUPER ADMIN peut attribuer
--          'SUPER ADMIN', users.queries.ts:23-27 ; liste complete des roles a
--          l'ecran pour un SUPER ADMIN, src/renderer/src/pages/AgentsPage.tsx:76-79) ;
--        - elevation d'un compte vers SUPER ADMIN (role principal ou role
--          secondaire t_user_roles) : permise (updateUser,
--          users.queries.ts:743-761, roles ajoutes soumis a la meme liste) ;
--        - mot de passe (password_hash) d'un AUTRE compte SUPER ADMIN :
--          NEUTRALISE (repris de l'ancien), regle « ROOT seulement »
--          (updateUser users.queries.ts:729-741 ; resetAgentPassword
--          users.queries.ts:1229-1240). ROOT est une session LOCALE (id
--          999999, handlers.ts:33, :252-290) sans compte cloud : ses gestes
--          sur un SUPER ADMIN restent la procedure manuelle du README
--          (section « 0007 : procedures manuelles ») ;
--        - SON PROPRE mot de passe : permis (updateUser, exception « cible =
--          appelant », users.queries.ts:733-736) ;
--        - sync_id d'un compte SUPER ADMIN : NEUTRALISE (identifiant stable,
--          jamais modifie par l'application) ;
--        - se desactiver soi-meme (statut_actif en baisse sur SA propre
--          ligne) : NEUTRALISE ; se supprimer soi-meme : IGNORE (RETURN NULL)
--          (assertNotSelfTarget, users.queries.ts:636-640, appele par
--          assertDeactivationAllowed :665-668, deleteUser :1018,
--          hardDeleteUser :1100) ;
--        - autres changements d'un compte SUPER ADMIN (login, nom, site,
--          role / retrogradation, statut d'un AUTRE compte, reactivation,
--          suppression d'un AUTRE compte) : permis (aucune garde serveur ne
--          les refuse a un SUPER ADMIN : updateUser / deleteUser /
--          hardDeleteUser, users.queries.ts:705, :1008, :1090 ne filtrent que
--          les appelants non SUPER ADMIN). L'ecran les masque
--          (AgentsPage.tsx:821-843, comptes SUPER ADMIN visibles du seul
--          ROOT, handlers.ts:3560-3566) : ecart UI / serveur signale dans le
--          rapport, la regle suit le serveur.
--      Chaque geste sensible permis ou neutralise est journalise dans
--      t_security_guard_events (raisons 'SA_AUTH_*', jamais de
--      password_hash), en plus des raisons de 0007.
--   service_role et postgres sans claims (SQL Editor) : INCHANGES (fiables).
--
-- Moyens (aucun objet de 0007 supprime, fichier 0007 non modifie) :
--   a. fn_sa_guard_caller_sa_auth() : nouvelle fonction (lecture seule).
--   b. fn_sa_guard_caller_untrusted() : REMPLACEE (CREATE OR REPLACE, droits
--      conserves) par la version de 0007 + une seule ligne en tete : un
--      appelant « SUPER ADMIN verifie » est fiable. Pour tout autre appelant
--      le resultat est identique a 0007 (meme code, meme ordre).
--   c. fn_t_users_sa_guard_auth() + 3 triggers BEFORE sur t_users
--      (trg_t_users_sa_guard_auth_ins / _upd / _del, memes clauses WHEN que
--      0007, donc aucun cout sur les comptes non SUPER ADMIN). Ils ne font
--      RIEN si l'appelant n'est pas « SUPER ADMIN verifie » ou si le garde
--      est coupe (t_security_guard_config.enabled = false). Ordre : les
--      triggers BEFORE s'executent par ordre alphabetique de nom ;
--      « ..._sa_guard_auth_* » passe AVANT « ..._sa_guard_del / _ins / _upd »
--      de 0007.
--   Repli FERME : toute erreur interne de fn_t_users_sa_guard_auth reprend
--   le repli de 0007 (INSERT -> statut_actif 0 ; UPDATE -> role, hash,
--   login, sync_id, statut repris de OLD ; DELETE -> ignore) ; toute erreur
--   de fn_sa_guard_caller_sa_auth -> false (non fiable). Jamais d'erreur
--   renvoyee au poste (meme modele que 0006 / 0007).
--   t_user_roles : aucun trigger ajoute ; fn_t_user_roles_sa_guard (0007,
--   inchangee) laisse passer un appelant fiable via (b).
--
-- Securite : fonctions SECURITY DEFINER (trigger) / INVOKER (aides), owner
-- postgres, search_path fige, EXECUTE retire a PUBLIC, anon, authenticated.
-- Aucun droit ni politique anon touche (empreinte anon identique avant /
-- apres, requete du README section 0013). Aucune table, colonne ou politique
-- ajoutee. Aucune donnee existante modifiee.
--
-- Idempotent : CREATE OR REPLACE FUNCTION / TRIGGER, REVOKE rejouables.
-- Application : un seul bloc  BEGIN; <ce fichier> COMMIT;  (SET LOCAL
-- lock_timeout = '3s' + controle en tete). Verrou : CREATE TRIGGER prend un
-- ShareRowExclusiveLock COURT sur t_users seulement (pas t_cartes) ; si le
-- verrou n'est pas obtenu en 3 s, tout est annule (55P03), rien n'est change.
--
-- Coupure immediate (TOUT le garde, 0007 compris, reversible) :
--   UPDATE public.t_security_guard_config SET enabled = false, updated_at = now() WHERE id = 1;
-- Retour arriere de 0015 seule (rend le comportement exact de 0007) :
--   BEGIN;
--   SET LOCAL lock_timeout = '3s';
--   DROP TRIGGER IF EXISTS trg_t_users_sa_guard_auth_ins ON public.t_users;
--   DROP TRIGGER IF EXISTS trg_t_users_sa_guard_auth_upd ON public.t_users;
--   DROP TRIGGER IF EXISTS trg_t_users_sa_guard_auth_del ON public.t_users;
--   CREATE OR REPLACE FUNCTION public.fn_sa_guard_caller_untrusted()
--   RETURNS BOOLEAN LANGUAGE plpgsql STABLE SET search_path = public, pg_temp
--   AS $$
--   DECLARE
--     v_role TEXT := public.fn_sa_guard_jwt_role();
--   BEGIN
--     IF v_role IN ('anon', 'authenticated') THEN
--       RETURN true;
--     END IF;
--     IF session_user::text = 'authenticator' AND v_role IS DISTINCT FROM 'service_role' THEN
--       RETURN true;
--     END IF;
--     RETURN false;
--   END;
--   $$;
--   DROP FUNCTION IF EXISTS public.fn_t_users_sa_guard_auth();
--   DROP FUNCTION IF EXISTS public.fn_sa_guard_caller_sa_auth();
--   COMMIT;
--   (Le corps de fn_sa_guard_caller_untrusted ci-dessus est celui de 0007,
--   section 3, recopie a l'identique.)
--
-- Application : dev ajadkziqaskadlzboeqo : appliquee le 2026-11-18 (MCP
-- apply_migration, PostgreSQL 17, partie executable identique a ce fichier) ;
-- test 16/16 ; empreinte anon identique avant / apres (206 elements) ;
-- non-regression 0006-0014 rejouee (voir README, section « 0015 ») ; aucun
-- residu. Production itvyayakwgzvfqvdrgyv : NON appliquee (geste
-- utilisateur, avant P2, apres 0011-0014 et l'audit agent-9).
-- Test : supabase/tests/0015_garde_sa_authenticated.test.sql
-- ============================================================

-- ------------------------------------------------------------
-- 0. Protection et prerequis
-- ------------------------------------------------------------
SET LOCAL lock_timeout = '3s';

DO $garde$
DECLARE
  t TEXT;
BEGIN
  IF current_setting('lock_timeout') <> '3s' THEN
    RAISE EXCEPTION '0015 : lock_timeout de protection inactif (fichier execute hors transaction). Executer en un seul bloc : BEGIN; <fichier> COMMIT;';
  END IF;
  -- 0007
  IF to_regclass('public.t_security_guard_config') IS NULL
     OR to_regclass('public.t_security_guard_events') IS NULL
     OR to_regprocedure('public.fn_sa_guard_jwt_role()') IS NULL
     OR to_regprocedure('public.fn_sa_guard_caller_untrusted()') IS NULL
     OR to_regprocedure('public.fn_sa_guard_log(text,text,text,text,text,jsonb)') IS NULL
     OR to_regprocedure('public.fn_t_users_sa_guard()') IS NULL
     OR to_regprocedure('public.fn_t_user_roles_sa_guard()') IS NULL THEN
    RAISE EXCEPTION '0015 : 0007 absente (garde SUPER ADMIN) : appliquer 0007 d''abord.';
  END IF;
  FOREACH t IN ARRAY ARRAY['trg_t_users_sa_guard_ins','trg_t_users_sa_guard_upd','trg_t_users_sa_guard_del'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.t_users'::regclass AND tgname = t AND NOT tgisinternal) THEN
      RAISE EXCEPTION '0015 : trigger % de 0007 absent sur t_users.', t;
    END IF;
  END LOOP;
  FOREACH t IN ARRAY ARRAY['trg_t_user_roles_sa_guard_ins','trg_t_user_roles_sa_guard_upd'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.t_user_roles'::regclass AND tgname = t AND NOT tgisinternal) THEN
      RAISE EXCEPTION '0015 : trigger % de 0007 absent sur t_user_roles.', t;
    END IF;
  END LOOP;
  -- 0011
  IF to_regprocedure('public.fn_jwt_gis_claims()') IS NULL
     OR to_regprocedure('public.fn_jwt_sync_id()') IS NULL
     OR to_regprocedure('public.fn_jwt_is_super_admin()') IS NULL THEN
    RAISE EXCEPTION '0015 : 0011 absente (fonctions fn_jwt_*) : appliquer 0011 d''abord.';
  END IF;
  -- 0013 et 0014
  IF (SELECT count(*) FROM pg_policies
       WHERE schemaname = 'public' AND policyname LIKE 'r13\_%'
         AND permissive = 'RESTRICTIVE' AND roles = ARRAY['authenticated']::name[]) <> 14 THEN
    RAISE EXCEPTION '0015 : 0013 absente ou incomplete (14 politiques r13_* attendues) : appliquer 0013 d''abord.';
  END IF;
  IF (SELECT count(*) FROM pg_policies
       WHERE schemaname = 'public' AND policyname LIKE 'r14\_%'
         AND permissive = 'RESTRICTIVE' AND roles = ARRAY['authenticated']::name[]) <> 9 THEN
    RAISE EXCEPTION '0015 : 0014 absente ou incomplete (9 politiques r14_* attendues) : appliquer 0014 d''abord.';
  END IF;
END;
$garde$;

-- ------------------------------------------------------------
-- 1. Appelant « SUPER ADMIN verifie » (lecture seule, echec ferme)
-- ------------------------------------------------------------
-- Appelee depuis les fonctions trigger SECURITY DEFINER de 0007 / 0015 :
-- s'execute alors avec les droits du proprietaire (lit t_users /
-- t_user_roles hors RLS).
CREATE OR REPLACE FUNCTION public.fn_sa_guard_caller_sa_auth()
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_c   JSONB;
  v_sid TEXT;
BEGIN
  -- NULL sauf role = authenticated ET gis_v present (0011).
  v_c := public.fn_jwt_gis_claims();
  IF v_c IS NULL THEN
    RETURN false;
  END IF;
  IF (v_c -> 'gis_is_super_admin') IS DISTINCT FROM 'true'::jsonb
     OR (v_c -> 'gis_statut_actif') IS DISTINCT FROM 'true'::jsonb THEN
    RETURN false;
  END IF;
  v_sid := NULLIF(btrim(COALESCE(v_c ->> 'gis_sync_id', '')), '');
  IF v_sid IS NULL THEN
    RETURN false;
  END IF;
  -- Etat REEL du compte au moment de l'ecriture.
  RETURN EXISTS (
    SELECT 1 FROM public.t_users u
     WHERE u.sync_id = v_sid
       AND u.statut_actif = 1
       AND (u.role = 'SUPER ADMIN'
            OR EXISTS (SELECT 1 FROM public.t_user_roles r
                        WHERE r.user_sync_id = v_sid AND r.role = 'SUPER ADMIN')));
EXCEPTION WHEN others THEN
  RAISE WARNING 'fn_sa_guard_caller_sa_auth : repli ferme (code %)', SQLSTATE;
  RETURN false;
END;
$$;

-- ------------------------------------------------------------
-- 2. Appelant non fiable : version 0007 + une ligne en tete
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_sa_guard_caller_untrusted()
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role TEXT := public.fn_sa_guard_jwt_role();
BEGIN
  -- 0015 : SUPER ADMIN authentifie et verifie = fiable.
  IF v_role = 'authenticated' AND public.fn_sa_guard_caller_sa_auth() THEN
    RETURN false;
  END IF;
  -- Suite identique a 0007.
  IF v_role IN ('anon', 'authenticated') THEN
    RETURN true;
  END IF;
  IF session_user::text = 'authenticator' AND v_role IS DISTINCT FROM 'service_role' THEN
    RETURN true; -- echec ferme (E3) : requete API sans role de confiance
  END IF;
  RETURN false;
END;
$$;

-- ------------------------------------------------------------
-- 3. Regles residuelles pour le SUPER ADMIN authentifie (t_users)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_t_users_sa_guard_auth()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_enabled    BOOLEAN;
  v_me         TEXT;
  v_attempted  JSONB;
  v_neutralise TEXT[] := ARRAY[]::TEXT[];
  v_autorise   TEXT[] := ARRAY[]::TEXT[];
BEGIN
  BEGIN
    SELECT c.enabled INTO v_enabled FROM public.t_security_guard_config c WHERE c.id = 1;
    -- Garde coupe, ou appelant autre que « SUPER ADMIN verifie » : rien a
    -- faire ici (0007 s'applique seul, inchange).
    IF NOT COALESCE(v_enabled, true) OR NOT public.fn_sa_guard_caller_sa_auth() THEN
      IF TG_OP = 'DELETE' THEN
        RETURN OLD;
      END IF;
      RETURN NEW;
    END IF;

    v_me := public.fn_jwt_sync_id();

    -- ---------- INSERT d'un SUPER ADMIN : permis ----------
    IF TG_OP = 'INSERT' THEN
      IF NEW.sync_id IS NULL
         OR NOT EXISTS (SELECT 1 FROM public.t_users u WHERE u.sync_id = NEW.sync_id) THEN
        PERFORM public.fn_sa_guard_log('t_users', 'INSERT', NEW.sync_id, NEW.login,
          'SA_AUTH_CREATION',
          jsonb_build_object('role', NEW.role, 'statut_actif', NEW.statut_actif,
                             'site_id', NEW.site_id, 'hash_modifie', false));
      END IF;
      -- Ligne existante : branche UPDATE d'un upsert, traitee par le trigger UPDATE.
      RETURN NEW;
    END IF;

    -- ---------- DELETE d'un SUPER ADMIN ----------
    IF TG_OP = 'DELETE' THEN
      v_attempted := jsonb_build_object('role', OLD.role, 'statut_actif', OLD.statut_actif,
                                        'site_id', OLD.site_id, 'hash_modifie', false);
      IF v_me IS NOT NULL AND OLD.sync_id = v_me THEN
        PERFORM public.fn_sa_guard_log('t_users', 'DELETE', OLD.sync_id, OLD.login,
          'SA_AUTH_AUTO_SUPPRESSION_IGNOREE', v_attempted);
        RETURN NULL;
      END IF;
      PERFORM public.fn_sa_guard_log('t_users', 'DELETE', OLD.sync_id, OLD.login,
        'SA_AUTH_SUPPRESSION', v_attempted);
      RETURN OLD;
    END IF;

    -- ---------- UPDATE ----------
    v_attempted := jsonb_build_object(
      'role', NEW.role, 'statut_actif', NEW.statut_actif, 'site_id', NEW.site_id,
      'hash_modifie', (NEW.password_hash IS DISTINCT FROM OLD.password_hash));

    -- Elevation d'un compte non SUPER ADMIN : permise.
    IF OLD.role IS DISTINCT FROM 'SUPER ADMIN' THEN
      PERFORM public.fn_sa_guard_log('t_users', 'UPDATE', OLD.sync_id, OLD.login,
        'SA_AUTH_ELEVATION', v_attempted);
      RETURN NEW;
    END IF;

    -- Ligne SUPER ADMIN existante.
    IF NEW.sync_id IS DISTINCT FROM OLD.sync_id THEN
      NEW.sync_id := OLD.sync_id;
      v_neutralise := v_neutralise || 'sync_id'::text;
    END IF;
    IF NEW.password_hash IS DISTINCT FROM OLD.password_hash THEN
      IF v_me IS NOT NULL AND OLD.sync_id = v_me THEN
        v_autorise := v_autorise || 'password_hash'::text;
      ELSE
        NEW.password_hash := OLD.password_hash; -- ROOT seulement
        v_neutralise := v_neutralise || 'password_hash'::text;
      END IF;
    END IF;
    IF v_me IS NOT NULL AND OLD.sync_id = v_me
       AND COALESCE(NEW.statut_actif, 1) < COALESCE(OLD.statut_actif, 1) THEN
      NEW.statut_actif := OLD.statut_actif; -- pas d'auto-desactivation
      v_neutralise := v_neutralise || 'statut_actif'::text;
    ELSIF NEW.statut_actif IS DISTINCT FROM OLD.statut_actif THEN
      v_autorise := v_autorise || 'statut_actif'::text;
    END IF;
    IF NEW.role IS DISTINCT FROM OLD.role THEN
      v_autorise := v_autorise || 'role'::text;
    END IF;
    IF NEW.login IS DISTINCT FROM OLD.login THEN
      v_autorise := v_autorise || 'login'::text;
    END IF;

    IF array_length(v_neutralise, 1) > 0 THEN
      PERFORM public.fn_sa_guard_log('t_users', 'UPDATE', OLD.sync_id, OLD.login,
        'SA_AUTH_NEUTRALISE:' || array_to_string(v_neutralise, ','), v_attempted);
    END IF;
    IF array_length(v_autorise, 1) > 0 THEN
      PERFORM public.fn_sa_guard_log('t_users', 'UPDATE', OLD.sync_id, OLD.login,
        'SA_AUTH_MODIF:' || array_to_string(v_autorise, ','), v_attempted);
    END IF;
    RETURN NEW;
  EXCEPTION WHEN others THEN
    -- Repli FERME et silencieux (identique au repli de 0007).
    RAISE WARNING 'fn_t_users_sa_guard_auth : repli ferme (op %, code %)', TG_OP, SQLSTATE;
    BEGIN
      PERFORM public.fn_sa_guard_log('t_users', TG_OP,
        CASE WHEN TG_OP = 'INSERT' THEN NEW.sync_id ELSE OLD.sync_id END,
        CASE WHEN TG_OP = 'INSERT' THEN NEW.login ELSE OLD.login END,
        'SA_AUTH_REPLI_FERME:' || SQLSTATE, NULL);
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

REVOKE ALL ON FUNCTION public.fn_sa_guard_caller_sa_auth() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_t_users_sa_guard_auth()   FROM PUBLIC, anon, authenticated;
-- fn_sa_guard_caller_untrusted : CREATE OR REPLACE conserve les droits de 0007 ;
-- REVOKE rejoue par precaution (identique a 0007).
REVOKE ALL ON FUNCTION public.fn_sa_guard_caller_untrusted() FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 4. Triggers (memes clauses WHEN que 0007 ; noms tries AVANT ceux de 0007)
-- ------------------------------------------------------------
CREATE OR REPLACE TRIGGER trg_t_users_sa_guard_auth_ins
  BEFORE INSERT ON public.t_users
  FOR EACH ROW
  WHEN (NEW.role = 'SUPER ADMIN')
  EXECUTE FUNCTION public.fn_t_users_sa_guard_auth();

CREATE OR REPLACE TRIGGER trg_t_users_sa_guard_auth_upd
  BEFORE UPDATE ON public.t_users
  FOR EACH ROW
  WHEN (OLD.role = 'SUPER ADMIN' OR NEW.role = 'SUPER ADMIN')
  EXECUTE FUNCTION public.fn_t_users_sa_guard_auth();

CREATE OR REPLACE TRIGGER trg_t_users_sa_guard_auth_del
  BEFORE DELETE ON public.t_users
  FOR EACH ROW
  WHEN (OLD.role = 'SUPER ADMIN')
  EXECUTE FUNCTION public.fn_t_users_sa_guard_auth();
