-- ============================================================
-- 0016_filtre_role_comptes.sql
-- GEST-IN-SITU : filtre PAR ROLE des ECRITURES de authenticated sur
-- t_users et t_user_roles (chantier B, decision de l'utilisateur du
-- 2026-11-18, option b). Complement de 0013 (par site), 0014 (par role sur
-- la hierarchie) et 0015 (garde SUPER ADMIN pour authenticated).
-- DEPEND DE 0007, 0011, 0013, 0014, 0015 : le fichier s'arrete si l'une manque.
--
-- Probleme ferme : 0013 laissait un authenticated ecrire t_users /
-- t_user_roles de SON site avec n'importe quel role non SUPER ADMIN (un
-- operateur pouvait s'attribuer ADMINISTRATEUR_SITE, un ADMIN_CENTRE creer
-- un ADMINISTRATEUR_SITE, un operateur modifier un collegue...).
--
-- Regle retenue, alignee sur l'application (lecture de src/ le 2026-11-18,
-- src/ non modifie). Elle ne vise QUE les instructions executees sous le
-- role authenticated (current_setting('role') = 'authenticated', pose par
-- PostgREST ; voir fn_r16_niveau) ; anon, service_role et postgres (SQL
-- Editor, meme avec des claims simulees) sont INCHANGES ; le SUPER ADMIN
-- verifie (fn_sa_guard_caller_sa_auth, 0015) est INCHANGE (regles 0015).
--
--   Niveau d'administration de l'appelant = le plus haut des roles de la
--   claim gis_roles (principal + secondaires). L'application controle le
--   role ACTIF de la session (getSecureCurrentUser), mais une personne peut
--   prendre comme role actif n'importe lequel de ses roles
--   (auth:setActiveRole, src/main/ipc/handlers.ts:405-417, valide contre
--   resolveGrantedRoles) et les handlers la laissent entrer avec n'importe
--   lequel (verifyUserRole, handlers.ts:76-101). Le JWT ne porte pas de role
--   actif : on retient donc l'union de ce que la personne peut faire, comme
--   0014. Les listes attribuables sont imbriquees (SUPER ADMIN > ADMINISTRATEUR_SITE
--   > ADMIN_CENTRE), donc union = le plus haut niveau.
--
--   Roles attribuables (ASSIGNABLE_ROLES_BY_CREATOR,
--   src/main/database/queries/users.queries.ts:22-35) :
--     ADMINISTRATEUR_SITE : ADMIN_CENTRE + les 6 OPERATEUR_* ;
--     ADMIN_CENTRE        : les 6 OPERATEUR_* ;
--     autres roles        : aucun.
--
--   t_users, INSERT (createUser users.queries.ts:281-345 ; porte users:create
--   handlers.ts:3588-3597 = SUPER ADMIN / ADMINISTRATEUR_SITE / ADMIN_CENTRE) :
--     - agent sans role d'administration : REFUSE ;
--     - role principal dans la liste attribuable (:322) ;
--     - site = celui de l'appelant (:295, site force) ;
--     - ADMIN_CENTRE : centre = le sien (:296, centre force) ;
--       ADMINISTRATEUR_SITE : centre NULL ou centre de son site (:298-303) ;
--     - statut_actif 0, 1 ou NULL.
--     Une ligne de MEME sync_id deja presente = branche UPDATE d'un upsert
--     (l'outbox envoie tout en upsert, src/main/sync/outbox.service.ts:750) :
--     controlee par la regle UPDATE, pas ici.
--
--   t_users, UPDATE :
--     a. SA PROPRE ligne (sync_id = gis_sync_id), quel que soit son role :
--        seules nom_user, prenom_user, email, telephone, password_hash,
--        updated_at peuvent changer, plus login si son role PRINCIPAL est
--        ADMINISTRATEUR_SITE (updateSelfProfile users.queries.ts:1297-1388 :
--        colonnes :1340, login :1323-1326 sur user.role = role principal ;
--        porte auth:updateSelfProfile handlers.ts:6814-6842, toute session).
--        Comparaison colonne par colonne (to_jsonb(NEW) - liste =
--        to_jsonb(OLD) - liste) : toute autre colonne changee (role,
--        site_id, centre_id, statut_actif, sync_id, poste_id, ...) sort de
--        cette voie.
--     b. Sinon, agent sans role d'administration : REFUSE (un operateur ne
--        touche jamais la ligne d'un collegue ; users:update est reserve aux
--        3 roles d'administration, handlers.ts:3635-3645).
--     c. Sinon (ADMINISTRATEUR_SITE / ADMIN_CENTRE, updateUser
--        users.queries.ts:684-997) :
--        - cible detenant SUPER ADMIN (role principal ou t_user_roles) :
--          REFUSE (assertTargetNotSuperAdmin :93-102, appele :711) ;
--          role principal NOUVEAU = SUPER ADMIN : REFUSE ;
--        - sync_id, id_user non modifiables (:848-855, liste des colonnes) ;
--        - site non modifiable (:779-787, SUPER ADMIN seulement) et cible de
--          son site (:705-708) ;
--        - ADMIN_CENTRE : cible de SON centre, centre force au sien, cible
--          ne detenant ni ADMINISTRATEUR_SITE ni ADMIN_CENTRE (:714-726) ;
--          ADMINISTRATEUR_SITE : nouveau centre NULL ou de son site (:772-777) ;
--        - role principal change : nouveau role attribuable, OU deja detenu
--          par la cible en role secondaire (t_user_roles) : « seuls les roles
--          NOUVELLEMENT attribues sont controles » (:744-761) ;
--        - statut_actif : 0 ou 1 seulement (:698-703) ; baisser son propre
--          statut : REFUSE (assertNotSelfTarget :636-640, :769).
--        Login, nom, contact, mot de passe d'un compte non SUPER ADMIN de son
--        perimetre : permis (updateUser ; resetAgentPassword :1209-1292,
--        porte SUPER ADMIN / ADMINISTRATEUR_SITE handlers.ts:3739-3748 ;
--        ADMIN_CENTRE pose un mot de passe via users:update, AgentsPage.tsx:530).
--
--   t_users, DELETE (deleteUser :999-1056, hardDeleteUser :1081-1197 ;
--   portes SUPER ADMIN / ADMINISTRATEUR_SITE handlers.ts:3675-3707) :
--     ADMINISTRATEUR_SITE seulement ; jamais soi-meme (:1018, :1100) ;
--     jamais un compte detenant SUPER ADMIN.
--
--   t_user_roles (l'application efface TOUS les roles du compte puis
--   reinsere la liste : updateUser :888-895 et :957-973, outbox DELETE
--   eq(user_sync_id) outbox.service.ts:697, puis upsert
--   onConflict (user_sync_id, role) :750) :
--     - agent sans role d'administration : AUCUNE ecriture ;
--     - compte cible : de son site, ne detenant pas SUPER ADMIN ; pour
--       ADMIN_CENTRE : de son centre et ne detenant ni ADMINISTRATEUR_SITE
--       ni ADMIN_CENTRE ;
--     - INSERT : role attribuable ; ou role deja detenu (ligne identique
--       deja presente = branche UPDATE de l'upsert, ou role principal du
--       compte) ; sinon REFUSE ;
--     - UPDATE : sans changement (upsert idempotent) permis ; sinon ancien
--       ET nouveau role attribuables ;
--     - DELETE d'un role attribuable : permis ; DELETE d'un role NON
--       attribuable (ex. ADMINISTRATEUR_SITE d'un collegue, efface par un
--       ADMINISTRATEUR_SITE) : IGNORE sans erreur (ligne conservee). C'est le
--       pendant serveur du formulaire, qui renvoie tel quel un role masque
--       (AgentsPage.tsx:76-85 visibleRoles, :563-566 roles de depart) et que
--       updateUser accepte comme « deja detenu » (:744-747) : le cycle
--       « tout effacer puis reinserer » garde donc ce role, au lieu d'etre
--       refuse en bloc. L'ecran n'offre pas de retirer un role non
--       attribuable ; l'ecart (IPC forge) est signale dans le rapport.
--     - DELETE d'une ligne dont le compte n'existe plus : permis (cascade
--       ON DELETE CASCADE depuis t_users, ou role orphelin ; une ligne
--       orpheline est de toute facon invisible a un non SUPER ADMIN, 0013).
--
--   Echec FERME : jeton authenticated sans claims gis_* (ou sans gis_v,
--   sans gis_sync_id, sans site, gis_statut_actif different de true), ou
--   jeton SUPER ADMIN NON verifie (compte desactive / retrograde en base) :
--   AUCUNE ecriture sur ces 2 tables.
--   Un refus leve 42501 (insufficient_privilege, message generique, aucune
--   donnee personnelle) ; une erreur interne leve aussi 42501 (jamais
--   laisser passer). Difference volontaire avec 0007 (neutralisation
--   silencieuse) : 0007 protege les postes en anon dont l'outbox reessaie ;
--   authenticated n'est utilise par aucun poste aujourd'hui (P2).
--
-- Pourquoi un TRIGGER et pas des politiques : une politique RLS voit OLD
-- (USING) et NEW (WITH CHECK) separement ; elle ne peut pas comparer OLD et
-- NEW colonne par colonne (« seul le mot de passe change »), ni dire « ce
-- role etait deja detenu », ni ignorer en silence l'effacement d'un role
-- non attribuable au milieu d'un DELETE de plusieurs lignes. Un seul
-- trigger BEFORE par table, qui ne fait RIEN hors authenticated, porte
-- toute la regle (une seule source, refus explicites 42501). La RLS de 0013
-- (par site) reste en place et s'applique avant / apres comme aujourd'hui.
--
-- Moyens (aucun objet existant modifie ; fichiers 0001-0015 non modifies) :
--   fn_r16_niveau()                    niveau de l'appelant (HORS, SA, AS, AC, AGENT, REFUS)
--   fn_r16_roles_attribuables(TEXT)    liste ASSIGNABLE_ROLES_BY_CREATOR
--   fn_r16_detient(TEXT, TEXT)         le compte detient-il ce role (principal ou t_user_roles)
--   fn_r16_refus(TEXT)                 leve 42501
--   fn_t_users_filtre_role()           trigger t_users (SECURITY DEFINER)
--   fn_t_user_roles_filtre_role()      trigger t_user_roles (SECURITY DEFINER)
--   trg_t_users_x16_filtre_role        BEFORE INSERT OR UPDATE OR DELETE, FOR EACH ROW
--   trg_t_user_roles_x16_filtre_role   BEFORE INSERT OR UPDATE OR DELETE, FOR EACH ROW
--   Noms tries APRES ceux de 0007 / 0015 (« x16 » > « sa_guard ») : le
--   filtre valide la ligne finale. Si 0007 ignore deja la ligne (RETURN
--   NULL, ex. suppression d'un SUPER ADMIN), le filtre n'est pas appele :
--   le geste reste refuse (0 ligne).
--   Cout pour anon (postes actuels) : un appel de fonction par ligne ecrite
--   dans t_users / t_user_roles (lecture de current_setting('role')), rien
--   d'autre ; ces tables sont peu ecrites.
--
-- Securite : fonctions owner postgres, search_path fige, EXECUTE retire a
-- PUBLIC, anon, authenticated. Aucun droit, aucune politique, aucune table
-- ni colonne ajoutes ou modifies : empreinte anon identique avant / apres.
--
-- Limites connues (rapport agent-4 du 2026-11-18) :
--   - roles lus dans les claims (jeton de 1 h, comme 0013 / 0014) : un
--     administrateur retrograde garde ses droits jusqu'a l'expiration du
--     jeton (le SUPER ADMIN, lui, est reverifie en base par 0015) ;
--   - la regle « dernier administrateur actif du site » (assertNotLastSiteAdmin,
--     users.queries.ts:648-663) n'est PAS reprise ;
--   - P2 : une ecriture de compte mise en file par un administrateur puis
--     envoyee sous la session d'un autre agent du poste serait refusee
--     (actor_sync_id, Q8) ; sync:forceAgents (handlers.ts:6327-6341, sans
--     garde de role) renvoie les comptes et roles du site : sous la session
--     d'un non-administrateur, refuse ;
--   - P2 : un upsert de t_users qui reecrit password_hash reste refuse par
--     0013 (EXCLUDED illisible) : changement de mot de passe = UPDATE simple.
--
-- Idempotent : CREATE OR REPLACE FUNCTION / TRIGGER, REVOKE rejouables.
-- Application : un seul bloc  BEGIN; <ce fichier> COMMIT;  (SET LOCAL
-- lock_timeout = '3s' + controle en tete). Verrou : CREATE TRIGGER prend un
-- ShareRowExclusiveLock COURT sur t_users et t_user_roles (pas t_cartes) ;
-- si un verrou n'est pas obtenu en 3 s, tout est annule (55P03).
--
-- Coupure immediate (reversible, verrou court) :
--   BEGIN; SET LOCAL lock_timeout = '3s';
--   ALTER TABLE public.t_users      DISABLE TRIGGER trg_t_users_x16_filtre_role;
--   ALTER TABLE public.t_user_roles DISABLE TRIGGER trg_t_user_roles_x16_filtre_role;
--   COMMIT;
-- Retour arriere complet (rend a authenticated le seul filtre par site de
-- 0013, plus 0007 / 0015) :
--   BEGIN;
--   SET LOCAL lock_timeout = '3s';
--   DROP TRIGGER IF EXISTS trg_t_users_x16_filtre_role      ON public.t_users;
--   DROP TRIGGER IF EXISTS trg_t_user_roles_x16_filtre_role ON public.t_user_roles;
--   DROP FUNCTION IF EXISTS public.fn_t_users_filtre_role();
--   DROP FUNCTION IF EXISTS public.fn_t_user_roles_filtre_role();
--   DROP FUNCTION IF EXISTS public.fn_r16_refus(TEXT);
--   DROP FUNCTION IF EXISTS public.fn_r16_detient(TEXT, TEXT);
--   DROP FUNCTION IF EXISTS public.fn_r16_roles_attribuables(TEXT);
--   DROP FUNCTION IF EXISTS public.fn_r16_niveau();
--   COMMIT;
-- Ordre si 0015 / 0014 / 0013 doivent aussi etre retirees : 0016 d'abord.
--
-- Application : dev ajadkziqaskadlzboeqo : appliquee le 2026-11-18 (MCP
-- apply_migration « 0016_filtre_role_comptes », puis correctif
-- « 0016_filtre_role_comptes_niveau_role_sql » qui remplace seulement
-- fn_r16_niveau : filtre declenche par le role SQL authenticated et non plus
-- par la seule claim role) ; corps des 6 fonctions identiques a ce fichier
-- (md5 de prosrc compare au fichier) ; test 15/15 ; empreinte anon identique
-- avant / apres ; voir supabase/migrations/README.md, section « 0016 ».
-- Production itvyayakwgzvfqvdrgyv : NON appliquee (geste utilisateur, apres
-- 0011-0015 et l'audit agent-9).
-- Test : supabase/tests/0016_filtre_role_comptes.test.sql
-- ============================================================

-- ------------------------------------------------------------
-- 0. Protection et prerequis
-- ------------------------------------------------------------
SET LOCAL lock_timeout = '3s';

DO $garde$
BEGIN
  IF current_setting('lock_timeout') <> '3s' THEN
    RAISE EXCEPTION '0016 : lock_timeout de protection inactif (fichier execute hors transaction). Executer en un seul bloc : BEGIN; <fichier> COMMIT;';
  END IF;
  IF to_regclass('public.t_users') IS NULL OR to_regclass('public.t_user_roles') IS NULL
     OR to_regclass('public.t_centres') IS NULL THEN
    RAISE EXCEPTION '0016 : tables t_users / t_user_roles / t_centres attendues.';
  END IF;
  -- 0007
  IF to_regprocedure('public.fn_sa_guard_jwt_role()') IS NULL THEN
    RAISE EXCEPTION '0016 : 0007 absente (fn_sa_guard_jwt_role) : appliquer 0007 d''abord.';
  END IF;
  -- 0011
  IF to_regprocedure('public.fn_jwt_gis_claims()') IS NULL
     OR to_regprocedure('public.fn_jwt_sync_id()') IS NULL
     OR to_regprocedure('public.fn_jwt_site_id()') IS NULL
     OR to_regprocedure('public.fn_jwt_centre_id()') IS NULL
     OR to_regprocedure('public.fn_jwt_roles()') IS NULL
     OR to_regprocedure('public.fn_jwt_is_super_admin()') IS NULL THEN
    RAISE EXCEPTION '0016 : 0011 absente (fonctions fn_jwt_*) : appliquer 0011 d''abord.';
  END IF;
  -- 0013 et 0014
  IF (SELECT count(*) FROM pg_policies
       WHERE schemaname = 'public' AND policyname LIKE 'r13\_%'
         AND permissive = 'RESTRICTIVE' AND roles = ARRAY['authenticated']::name[]) <> 14 THEN
    RAISE EXCEPTION '0016 : 0013 absente ou incomplete (14 politiques r13_* attendues).';
  END IF;
  IF (SELECT count(*) FROM pg_policies
       WHERE schemaname = 'public' AND policyname LIKE 'r14\_%'
         AND permissive = 'RESTRICTIVE' AND roles = ARRAY['authenticated']::name[]) <> 9 THEN
    RAISE EXCEPTION '0016 : 0014 absente ou incomplete (9 politiques r14_* attendues).';
  END IF;
  -- 0015
  IF to_regprocedure('public.fn_sa_guard_caller_sa_auth()') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.t_users'::regclass
                     AND tgname = 'trg_t_users_sa_guard_auth_upd' AND NOT tgisinternal) THEN
    RAISE EXCEPTION '0016 : 0015 absente (garde SUPER ADMIN authenticated) : appliquer 0015 d''abord.';
  END IF;
END;
$garde$;

-- ------------------------------------------------------------
-- 1. Aides (lecture seule)
-- ------------------------------------------------------------
-- Niveau de l'appelant :
--   HORS  : instruction pas executee sous le role authenticated (anon,
--           service_role, postgres / SQL Editor) -> aucun filtre ;
--   SA    : SUPER ADMIN verifie (0015) -> aucun filtre ici ;
--   AS    : ADMINISTRATEUR_SITE parmi gis_roles ;
--   AC    : ADMIN_CENTRE parmi gis_roles ;
--   AGENT : authenticated valide sans role d'administration ;
--   REFUS : authenticated sans droits verifiables (echec ferme).
CREATE OR REPLACE FUNCTION public.fn_r16_niveau()
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_c     JSONB;
  v_roles TEXT[];
BEGIN
  -- Filtre seulement les instructions executees SOUS le role authenticated
  -- (SET LOCAL ROLE de PostgREST), comme une politique « TO authenticated ».
  -- current_setting('role') garde le role pose par SET ROLE meme dans une
  -- fonction SECURITY DEFINER (verifie sur le dev le 2026-11-18 : postgres ->
  -- 'none', SET LOCAL ROLE authenticated -> 'authenticated', anon -> 'anon').
  -- Les claims seules ne suffisent pas a declencher le filtre (une session
  -- postgres / service_role reste non filtree), et une session authenticated
  -- sans claims gis_* valides est refusee (ci-dessous).
  IF COALESCE(current_setting('role', true), 'none') IS DISTINCT FROM 'authenticated' THEN
    RETURN 'HORS';
  END IF;
  v_c := public.fn_jwt_gis_claims();
  IF v_c IS NULL THEN
    RETURN 'REFUS';
  END IF;
  IF public.fn_sa_guard_caller_sa_auth() THEN
    RETURN 'SA';
  END IF;
  v_roles := public.fn_jwt_roles();
  IF public.fn_jwt_is_super_admin() OR 'SUPER ADMIN' = ANY (v_roles) THEN
    RETURN 'REFUS'; -- jeton SUPER ADMIN non verifie en base
  END IF;
  IF (v_c -> 'gis_statut_actif') IS DISTINCT FROM 'true'::jsonb
     OR NULLIF(btrim(COALESCE(public.fn_jwt_sync_id(), '')), '') IS NULL
     OR public.fn_jwt_site_id() IS NULL THEN
    RETURN 'REFUS';
  END IF;
  IF 'ADMINISTRATEUR_SITE' = ANY (v_roles) THEN
    RETURN 'AS';
  END IF;
  IF 'ADMIN_CENTRE' = ANY (v_roles) THEN
    RETURN 'AC';
  END IF;
  RETURN 'AGENT';
EXCEPTION WHEN others THEN
  RETURN 'REFUS';
END;
$$;

-- ASSIGNABLE_ROLES_BY_CREATOR (src/main/database/queries/users.queries.ts:22-35),
-- hors SUPER ADMIN (non filtre ici).
CREATE OR REPLACE FUNCTION public.fn_r16_roles_attribuables(p_niveau TEXT)
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE p_niveau
    WHEN 'AS' THEN ARRAY['ADMIN_CENTRE', 'OPERATEUR_VERIFICATION', 'OPERATEUR_SAISIE',
                         'OPERATEUR_LOGISTIQUE', 'OPERATEUR_QUALITE', 'OPERATEUR_INVENTAIRE',
                         'OPERATEUR_APUREMENT']::TEXT[]
    WHEN 'AC' THEN ARRAY['OPERATEUR_VERIFICATION', 'OPERATEUR_SAISIE',
                         'OPERATEUR_LOGISTIQUE', 'OPERATEUR_QUALITE', 'OPERATEUR_INVENTAIRE',
                         'OPERATEUR_APUREMENT']::TEXT[]
    ELSE ARRAY[]::TEXT[]
  END
$$;

-- Le compte detient-il ce role (role principal OU t_user_roles) ?
-- Meme regle que userHoldsRole (users.queries.ts:86-90).
CREATE OR REPLACE FUNCTION public.fn_r16_detient(p_sync_id TEXT, p_role TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (SELECT 1 FROM public.t_users u WHERE u.sync_id = p_sync_id AND u.role = p_role)
      OR EXISTS (SELECT 1 FROM public.t_user_roles r WHERE r.user_sync_id = p_sync_id AND r.role = p_role)
$$;

CREATE OR REPLACE FUNCTION public.fn_r16_refus(p_motif TEXT)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION '0016 : ecriture refusee (%)', p_motif USING ERRCODE = '42501';
END;
$$;

-- ------------------------------------------------------------
-- 2. Trigger t_users
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_t_users_filtre_role()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_niv    TEXT;
  v_me     TEXT;
  v_site   BIGINT;
  v_centre BIGINT;
  v_prim   TEXT;
  v_attr   TEXT[];
  v_libres TEXT[];
  v_self   BOOLEAN;
BEGIN
  v_niv := public.fn_r16_niveau();
  IF v_niv IN ('HORS', 'SA') THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  BEGIN
    IF v_niv = 'REFUS' THEN
      PERFORM public.fn_r16_refus('jeton sans droits verifiables');
    END IF;
    v_me     := public.fn_jwt_sync_id();
    v_site   := public.fn_jwt_site_id();
    v_centre := public.fn_jwt_centre_id();
    v_prim   := public.fn_jwt_gis_claims() ->> 'gis_primary_role';
    v_attr   := public.fn_r16_roles_attribuables(v_niv);

    -- ---------------- INSERT ----------------
    IF TG_OP = 'INSERT' THEN
      -- Ligne deja presente : branche UPDATE d'un upsert (controlee par la regle UPDATE).
      IF NEW.sync_id IS NOT NULL
         AND EXISTS (SELECT 1 FROM public.t_users u WHERE u.sync_id = NEW.sync_id) THEN
        RETURN NEW;
      END IF;
      IF v_niv = 'AGENT' THEN
        PERFORM public.fn_r16_refus('creation de compte reservee aux administrateurs');
      END IF;
      IF NEW.role IS NULL OR NOT (NEW.role = ANY (v_attr)) THEN
        PERFORM public.fn_r16_refus('role non attribuable par cet appelant');
      END IF;
      IF NEW.site_id IS DISTINCT FROM v_site THEN
        PERFORM public.fn_r16_refus('compte hors de son site');
      END IF;
      IF NEW.statut_actif IS NOT NULL AND NEW.statut_actif NOT IN (0, 1) THEN
        PERFORM public.fn_r16_refus('statut invalide');
      END IF;
      IF v_niv = 'AC' THEN
        IF NEW.centre_id IS DISTINCT FROM v_centre THEN
          PERFORM public.fn_r16_refus('ADMIN_CENTRE : compte de son centre seulement');
        END IF;
      ELSIF NEW.centre_id IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM public.t_centres c
                             WHERE c.id = NEW.centre_id AND c.site_id = v_site) THEN
        PERFORM public.fn_r16_refus('centre hors de son site');
      END IF;
      RETURN NEW;
    END IF;

    -- ---------------- DELETE ----------------
    IF TG_OP = 'DELETE' THEN
      IF v_niv <> 'AS' THEN
        PERFORM public.fn_r16_refus('suppression de compte reservee a SUPER ADMIN / ADMINISTRATEUR_SITE');
      END IF;
      IF OLD.sync_id IS NOT DISTINCT FROM v_me THEN
        PERFORM public.fn_r16_refus('suppression de son propre compte');
      END IF;
      IF OLD.site_id IS DISTINCT FROM v_site THEN
        PERFORM public.fn_r16_refus('compte hors de son site');
      END IF;
      IF OLD.role = 'SUPER ADMIN' OR public.fn_r16_detient(OLD.sync_id, 'SUPER ADMIN') THEN
        PERFORM public.fn_r16_refus('compte SUPER ADMIN');
      END IF;
      RETURN OLD;
    END IF;

    -- ---------------- UPDATE ----------------
    v_self := v_me IS NOT NULL AND OLD.sync_id IS NOT DISTINCT FROM v_me;

    -- a. Son propre profil (updateSelfProfile).
    IF v_self THEN
      v_libres := ARRAY['nom_user', 'prenom_user', 'email', 'telephone', 'password_hash', 'updated_at']::TEXT[];
      IF v_prim = 'ADMINISTRATEUR_SITE' THEN
        v_libres := v_libres || 'login'::TEXT;
      END IF;
      IF (to_jsonb(NEW) - v_libres) = (to_jsonb(OLD) - v_libres) THEN
        RETURN NEW;
      END IF;
    END IF;

    -- b. Agent sans role d'administration : rien d'autre.
    IF v_niv = 'AGENT' THEN
      PERFORM public.fn_r16_refus('un agent ne modifie que son propre profil (nom, contact, mot de passe)');
    END IF;

    -- c. ADMINISTRATEUR_SITE / ADMIN_CENTRE (updateUser).
    IF OLD.role = 'SUPER ADMIN' OR NEW.role = 'SUPER ADMIN'
       OR public.fn_r16_detient(OLD.sync_id, 'SUPER ADMIN') THEN
      PERFORM public.fn_r16_refus('compte SUPER ADMIN');
    END IF;
    IF NEW.sync_id IS DISTINCT FROM OLD.sync_id OR NEW.id_user IS DISTINCT FROM OLD.id_user THEN
      PERFORM public.fn_r16_refus('identifiant de compte non modifiable');
    END IF;
    IF OLD.site_id IS DISTINCT FROM v_site OR NEW.site_id IS DISTINCT FROM OLD.site_id THEN
      PERFORM public.fn_r16_refus('site non modifiable ou compte hors de son site');
    END IF;
    IF v_niv = 'AC' THEN
      IF v_centre IS NULL OR OLD.centre_id IS DISTINCT FROM v_centre
         OR NEW.centre_id IS DISTINCT FROM v_centre THEN
        PERFORM public.fn_r16_refus('ADMIN_CENTRE : agents de son centre seulement');
      END IF;
      IF OLD.role IN ('ADMINISTRATEUR_SITE', 'ADMIN_CENTRE')
         OR public.fn_r16_detient(OLD.sync_id, 'ADMINISTRATEUR_SITE')
         OR public.fn_r16_detient(OLD.sync_id, 'ADMIN_CENTRE') THEN
        PERFORM public.fn_r16_refus('ADMIN_CENTRE : compte administrateur non modifiable');
      END IF;
    ELSIF NEW.centre_id IS DISTINCT FROM OLD.centre_id AND NEW.centre_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM public.t_centres c
                           WHERE c.id = NEW.centre_id AND c.site_id = v_site) THEN
      PERFORM public.fn_r16_refus('centre hors de son site');
    END IF;
    IF NEW.role IS DISTINCT FROM OLD.role
       AND NOT (COALESCE(NEW.role = ANY (v_attr), false)
                OR EXISTS (SELECT 1 FROM public.t_user_roles r
                            WHERE r.user_sync_id = OLD.sync_id AND r.role = NEW.role)) THEN
      PERFORM public.fn_r16_refus('role non attribuable par cet appelant');
    END IF;
    IF NEW.statut_actif IS DISTINCT FROM OLD.statut_actif THEN
      IF NEW.statut_actif IS NULL OR NEW.statut_actif NOT IN (0, 1) THEN
        PERFORM public.fn_r16_refus('statut invalide');
      END IF;
      IF v_self AND NEW.statut_actif < COALESCE(OLD.statut_actif, 1) THEN
        PERFORM public.fn_r16_refus('desactivation de son propre compte');
      END IF;
    END IF;
    RETURN NEW;
  EXCEPTION WHEN others THEN
    IF SQLSTATE = '42501' THEN
      RAISE;
    END IF;
    RAISE EXCEPTION '0016 : ecriture refusee (erreur interne, code %)', SQLSTATE USING ERRCODE = '42501';
  END;
END;
$$;

-- ------------------------------------------------------------
-- 3. Trigger t_user_roles
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_t_user_roles_filtre_role()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_niv    TEXT;
  v_site   BIGINT;
  v_centre BIGINT;
  v_attr   TEXT[];
  v_cibles TEXT[];
  v_sync   TEXT;
  v_cible  RECORD;
BEGIN
  v_niv := public.fn_r16_niveau();
  IF v_niv IN ('HORS', 'SA') THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  BEGIN
    -- Compte disparu (cascade ON DELETE depuis t_users, ou role orphelin) : permis.
    IF TG_OP = 'DELETE'
       AND NOT EXISTS (SELECT 1 FROM public.t_users u WHERE u.sync_id = OLD.user_sync_id) THEN
      RETURN OLD;
    END IF;
    IF v_niv = 'REFUS' THEN
      PERFORM public.fn_r16_refus('jeton sans droits verifiables');
    END IF;
    IF v_niv = 'AGENT' THEN
      PERFORM public.fn_r16_refus('roles reserves aux administrateurs');
    END IF;
    v_site   := public.fn_jwt_site_id();
    v_centre := public.fn_jwt_centre_id();
    v_attr   := public.fn_r16_roles_attribuables(v_niv);

    v_cibles := CASE TG_OP
                  WHEN 'INSERT' THEN ARRAY[NEW.user_sync_id]
                  WHEN 'DELETE' THEN ARRAY[OLD.user_sync_id]
                  ELSE ARRAY[OLD.user_sync_id, NEW.user_sync_id]
                END;
    FOREACH v_sync IN ARRAY v_cibles LOOP
      SELECT u.site_id, u.centre_id INTO v_cible FROM public.t_users u WHERE u.sync_id = v_sync;
      IF NOT FOUND THEN
        PERFORM public.fn_r16_refus('compte cible introuvable');
      END IF;
      IF v_cible.site_id IS DISTINCT FROM v_site THEN
        PERFORM public.fn_r16_refus('compte hors de son site');
      END IF;
      IF public.fn_r16_detient(v_sync, 'SUPER ADMIN') THEN
        PERFORM public.fn_r16_refus('compte SUPER ADMIN');
      END IF;
      IF v_niv = 'AC'
         AND (v_centre IS NULL OR v_cible.centre_id IS DISTINCT FROM v_centre
              OR public.fn_r16_detient(v_sync, 'ADMINISTRATEUR_SITE')
              OR public.fn_r16_detient(v_sync, 'ADMIN_CENTRE')) THEN
        PERFORM public.fn_r16_refus('ADMIN_CENTRE : agents de son centre seulement');
      END IF;
    END LOOP;

    IF TG_OP = 'INSERT' THEN
      -- Ligne identique deja presente : branche UPDATE de l'upsert (sans changement).
      IF EXISTS (SELECT 1 FROM public.t_user_roles r
                  WHERE r.user_sync_id = NEW.user_sync_id AND r.role = NEW.role) THEN
        RETURN NEW;
      END IF;
      IF NEW.role = ANY (v_attr) THEN
        RETURN NEW;
      END IF;
      -- Role deja detenu comme role principal (jamais SUPER ADMIN : refuse plus haut).
      IF EXISTS (SELECT 1 FROM public.t_users u
                  WHERE u.sync_id = NEW.user_sync_id AND u.role = NEW.role) THEN
        RETURN NEW;
      END IF;
      PERFORM public.fn_r16_refus('role non attribuable par cet appelant');
    END IF;

    IF TG_OP = 'UPDATE' THEN
      IF NEW.user_sync_id IS NOT DISTINCT FROM OLD.user_sync_id
         AND NEW.role IS NOT DISTINCT FROM OLD.role THEN
        RETURN NEW;
      END IF;
      IF COALESCE(OLD.role = ANY (v_attr), false) AND COALESCE(NEW.role = ANY (v_attr), false) THEN
        RETURN NEW;
      END IF;
      PERFORM public.fn_r16_refus('role non attribuable par cet appelant');
    END IF;

    -- DELETE
    IF OLD.role = ANY (v_attr) THEN
      RETURN OLD;
    END IF;
    RETURN NULL; -- role non attribuable : conserve, sans erreur (voir en-tete)
  EXCEPTION WHEN others THEN
    IF SQLSTATE = '42501' THEN
      RAISE;
    END IF;
    RAISE EXCEPTION '0016 : ecriture refusee (erreur interne, code %)', SQLSTATE USING ERRCODE = '42501';
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_r16_niveau()                     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_r16_roles_attribuables(TEXT)     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_r16_detient(TEXT, TEXT)          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_r16_refus(TEXT)                  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_t_users_filtre_role()            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_t_user_roles_filtre_role()       FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 4. Triggers (noms tries apres ceux de 0007 / 0015)
-- ------------------------------------------------------------
CREATE OR REPLACE TRIGGER trg_t_users_x16_filtre_role
  BEFORE INSERT OR UPDATE OR DELETE ON public.t_users
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_t_users_filtre_role();

CREATE OR REPLACE TRIGGER trg_t_user_roles_x16_filtre_role
  BEFORE INSERT OR UPDATE OR DELETE ON public.t_user_roles
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_t_user_roles_filtre_role();
