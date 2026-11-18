-- ============================================================
-- 0013_rls_authenticated_par_site.sql
-- GEST-IN-SITU : politiques RESTRICTIVE TO authenticated, filtre PAR SITE
-- (chantier B, P1-6, objet H de l'annexe B de docs/PLAN_P1_CHANTIER_B.md).
-- Purement ADDITIF pour anon : aucune politique existante modifiee ou
-- supprimee, aucun droit anon touche, aucune colonne ni trigger ajoute.
-- DEPEND DE 0011 (fonctions fn_jwt_*).
--
-- Principe (decisions Q4 et D6b du 2026-11-18) :
--   - les postes actuels ecrivent en anon (cle publishable / legacy) via la
--     politique PERMISSIVE allow_all_operations_* (prod) : INCHANGE. Une
--     politique RESTRICTIVE ne s'applique qu'aux roles qu'elle cible (TO
--     authenticated) ; pour anon, seules les politiques PERMISSIVE
--     existantes comptent, donc son comportement ne change pas
--     (verifie par le test, avant/apres sur les memes lignes).
--   - authenticated (sessions emises par gis-login + hook 0011, P2/PWA) :
--     acces limite AU SITE porte par la claim gis_site_id (Q4 : par site
--     SEULEMENT, filtre par role revu plus tard pour la PWA). Le SUPER ADMIN
--     (claim gis_is_super_admin = true) voit et ecrit tous les sites.
--   - ECHEC FERME : un jeton authenticated SANS claims gis_* (hook non
--     active, jeton forge sans gis_v, utilisateur Auth cree hors gis-login)
--     n'a acces a RIEN (fn_jwt_* renvoient NULL / false). Aujourd'hui aucun
--     code de src/ n'ouvre de session Auth (verifie : aucun signInWith* /
--     verifyOtp / setSession dans src/), donc aucun poste n'est affecte.
--     Sans 0013, un tel jeton aurait TOUT (allow_all_operations_* vise aussi
--     authenticated) : c'est la raison de l'echec ferme.
--   - service_role : BYPASSRLS sur Supabase, non filtre.
--
-- Regles par table (condition « site » = SA, ou colonne site non NULL et
-- egale a gis_site_id ; une ligne sans site n'est visible que du SA) :
--   t_cartes        : id_site                       lecture + ecriture
--   t_logs          : site_id                       lecture + ecriture
--   t_user_presence : site_id                       lecture + ecriture
--   t_users         : site_id                       lecture + ecriture
--                     (un SUPER ADMIN sans site n'est jamais visible d'un
--                      agent de site : Q5 / D1)
--   t_user_roles    : site du compte t_users (user_sync_id) lecture + ecriture
--   t_postes        : site du centre t_centres (centre_id) lecture + ecriture
--   t_centres       : lecture = tout authenticated porteur des claims gis_*
--                     (tables de reference, annexe H d'agent-1) ;
--                     ecriture = site_id du centre
--   t_sites         : lecture = tout authenticated porteur des claims gis_* ;
--                     ecriture = la ligne de SON site (id), SA : tous
--   USING et WITH CHECK identiques : impossible de lire, modifier, supprimer
--   ou DEPLACER une ligne vers un autre site.
--   Les fonctions fn_jwt_* sont appelees sous forme (SELECT ...) : evaluees
--   une fois par requete (InitPlan), pas une fois par ligne.
--
-- password_hash (t_users) : ILLISIBLE par authenticated, par privileges de
-- COLONNE (pas de vue) : REVOKE SELECT (table) FROM authenticated puis
-- GRANT SELECT (toutes les colonnes sauf password_hash) TO authenticated,
-- liste construite depuis le catalogue (colonnes eventuelles en plus en
-- prod incluses). Pourquoi pas une vue : une vue demanderait un autre nom
-- d'objet cote client (P2) et une seconde surface RLS ; les privileges de
-- colonne gardent une seule table, une seule RLS, et anon n'est pas touche.
-- INSERT / UPDATE restent accordes (table) : un authenticated peut ECRIRE
-- password_hash (changement de mot de passe, P2) sans pouvoir le RELIRE.
-- Consequences pour le client P2 (sessions authenticated) :
--   - select=* sur t_users est refuse (42501) : lister les colonnes ;
--   - Prefer: return=representation sur t_users est refuse : return=minimal ;
--   - un upsert qui reecrit password_hash (ON CONFLICT DO UPDATE SET
--     password_hash = EXCLUDED.password_hash) est refuse (lire EXCLUDED
--     demande SELECT sur la colonne) : UPDATE simple ou RPC dediee.
--   anon lit et ecrit TOUJOURS password_hash (downstream.ts lit la colonne
--   en anon) : retrait de la lecture anon = P3 (C4), pas ici.
--
-- Defense en profondeur (authenticated seulement) : REVOKE TRUNCATE,
-- REFERENCES, TRIGGER (et MAINTAIN en PostgreSQL >= 17) sur les 8 tables :
-- TRUNCATE contourne la RLS. anon garde ces droits (P3 ; PostgREST
-- n'expose de toute facon pas TRUNCATE).
--
-- Interaction avec les gardes existants (non modifies) :
--   - 0006 (t_cartes, statut) et 0007 (SUPER ADMIN sur t_users /
--     t_user_roles) sont des triggers BEFORE SECURITY DEFINER : ils
--     s'executent avant le WITH CHECK de la RLS. 0007 traite authenticated
--     comme non fiable (seul service_role l'est) : un agent de site ne peut
--     toujours pas creer / elever un SUPER ADMIN (adaptation = 0014, Q6).
--   - 0008 (mesure) : triggers STATEMENT SECURITY DEFINER, ecrivent dans
--     t_write_audit (proprietaire, hors RLS) : inchange.
--   - 0010 : fn_list_client_versions / fn_count_client_versions restent
--     SECURITY DEFINER ouvertes a authenticated (tous sites) : a refermer en
--     P2/P3 (brouillon P3, plan P1-7) ; non modifiees ici.
--
-- Limites connues :
--   - une nouvelle table creee plus tard n'aura PAS ces politiques : chaque
--     migration future qui expose une table doit ajouter la sienne ;
--   - une nouvelle COLONNE de t_users ne sera PAS lisible par authenticated
--     tant qu'un GRANT SELECT (colonne) n'est pas ajoute (rejouer la section
--     3 de ce fichier suffit, elle recalcule la liste) ;
--   - un upsert par lot qui touche UNE ligne d'un autre site echoue en
--     entier (42501) pour authenticated : a gerer cote client P2 ;
--   - les cartes / logs / utilisateurs dont la colonne site est NULL ne sont
--     visibles que du SUPER ADMIN.
--
-- Idempotent : DROP POLICY IF EXISTS puis CREATE POLICY ; REVOKE / GRANT
-- rejouables (la liste de colonnes est recalculee).
-- Application : un seul bloc  BEGIN; <ce fichier> COMMIT;  (SET LOCAL
-- lock_timeout = '3s' + controle en tete). Verrou : CREATE / DROP POLICY
-- prend un AccessExclusiveLock COURT sur chaque table (mesure sur le dev,
-- voir README) ; t_cartes compris -> en prod, hors heures de travail des
-- postes ; si un verrou n'est pas obtenu en 3 s, tout est annule (55P03),
-- rien n'est change.
--
-- Retour arriere complet (rend a authenticated l'etat d'avant : TOUT via
-- allow_all_operations_*) :
--   BEGIN;
--   SET LOCAL lock_timeout = '3s';
--   DROP POLICY IF EXISTS r13_t_cartes_site        ON public.t_cartes;
--   DROP POLICY IF EXISTS r13_t_logs_site          ON public.t_logs;
--   DROP POLICY IF EXISTS r13_t_user_presence_site ON public.t_user_presence;
--   DROP POLICY IF EXISTS r13_t_users_site         ON public.t_users;
--   DROP POLICY IF EXISTS r13_t_user_roles_site    ON public.t_user_roles;
--   DROP POLICY IF EXISTS r13_t_postes_site        ON public.t_postes;
--   DROP POLICY IF EXISTS r13_t_centres_claims     ON public.t_centres;
--   DROP POLICY IF EXISTS r13_t_centres_ins        ON public.t_centres;
--   DROP POLICY IF EXISTS r13_t_centres_upd        ON public.t_centres;
--   DROP POLICY IF EXISTS r13_t_centres_del        ON public.t_centres;
--   DROP POLICY IF EXISTS r13_t_sites_claims       ON public.t_sites;
--   DROP POLICY IF EXISTS r13_t_sites_ins          ON public.t_sites;
--   DROP POLICY IF EXISTS r13_t_sites_upd          ON public.t_sites;
--   DROP POLICY IF EXISTS r13_t_sites_del          ON public.t_sites;
--   GRANT SELECT ON TABLE public.t_users TO authenticated;
--   GRANT TRUNCATE, REFERENCES, TRIGGER ON TABLE public.t_cartes, public.t_logs,
--     public.t_user_presence, public.t_users, public.t_user_roles,
--     public.t_postes, public.t_centres, public.t_sites TO authenticated;
--   -- PostgreSQL >= 17 seulement :
--   GRANT MAINTAIN ON TABLE public.t_cartes, public.t_logs,
--     public.t_user_presence, public.t_users, public.t_user_roles,
--     public.t_postes, public.t_centres, public.t_sites TO authenticated;
--   COMMIT;
--   (Les GRANT SELECT de colonne restants sont sans effet une fois le
--   SELECT de table rendu.)
--
-- Application : dev ajadkziqaskadlzboeqo : appliquee le 2026-11-18 (MCP
-- apply_migration, PostgreSQL 17.11, partie executable identique a ce
-- fichier) ; test 19/19 ; empreinte des droits et politiques anon identique
-- avant / apres ; voir supabase/migrations/README.md.
-- Production itvyayakwgzvfqvdrgyv : NON appliquee (geste utilisateur, avec
-- 0011/0012, apres audit agent-9).
-- Test : supabase/tests/0013_rls_authenticated_par_site.test.sql
-- ============================================================

-- ------------------------------------------------------------
-- 0. Protection
-- ------------------------------------------------------------
SET LOCAL lock_timeout = '3s';

DO $garde$
DECLARE
  t TEXT;
BEGIN
  IF current_setting('lock_timeout') <> '3s' THEN
    RAISE EXCEPTION '0013 : lock_timeout de protection inactif (fichier execute hors transaction). Executer en un seul bloc : BEGIN; <fichier> COMMIT;';
  END IF;
  IF to_regprocedure('public.fn_jwt_site_id()') IS NULL
     OR to_regprocedure('public.fn_jwt_is_super_admin()') IS NULL
     OR to_regprocedure('public.fn_jwt_gis_claims()') IS NULL THEN
    RAISE EXCEPTION '0013 : 0011 absente (fonctions fn_jwt_*) : appliquer 0011 d''abord.';
  END IF;
  FOREACH t IN ARRAY ARRAY['t_cartes','t_logs','t_user_presence','t_users',
                           't_user_roles','t_postes','t_centres','t_sites'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE EXCEPTION '0013 : table public.% absente.', t;
    END IF;
    -- Sans RLS active, une politique serait sans effet : on refuse plutot
    -- que d'activer la RLS ici (ce qui changerait le comportement d'anon).
    IF NOT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = ('public.' || t)::regclass) THEN
      RAISE EXCEPTION '0013 : RLS inactive sur public.% : etat inattendu, rien n''est applique.', t;
    END IF;
  END LOOP;
END;
$garde$;

-- ------------------------------------------------------------
-- 1. Tables filtrees par une colonne site directe
-- ------------------------------------------------------------
DROP POLICY IF EXISTS r13_t_cartes_site ON public.t_cartes;
CREATE POLICY r13_t_cartes_site ON public.t_cartes
  AS RESTRICTIVE FOR ALL TO authenticated
  USING      ((SELECT public.fn_jwt_is_super_admin())
              OR (id_site IS NOT NULL AND id_site = (SELECT public.fn_jwt_site_id())))
  WITH CHECK ((SELECT public.fn_jwt_is_super_admin())
              OR (id_site IS NOT NULL AND id_site = (SELECT public.fn_jwt_site_id())));

DROP POLICY IF EXISTS r13_t_logs_site ON public.t_logs;
CREATE POLICY r13_t_logs_site ON public.t_logs
  AS RESTRICTIVE FOR ALL TO authenticated
  USING      ((SELECT public.fn_jwt_is_super_admin())
              OR (site_id IS NOT NULL AND site_id = (SELECT public.fn_jwt_site_id())))
  WITH CHECK ((SELECT public.fn_jwt_is_super_admin())
              OR (site_id IS NOT NULL AND site_id = (SELECT public.fn_jwt_site_id())));

DROP POLICY IF EXISTS r13_t_user_presence_site ON public.t_user_presence;
CREATE POLICY r13_t_user_presence_site ON public.t_user_presence
  AS RESTRICTIVE FOR ALL TO authenticated
  USING      ((SELECT public.fn_jwt_is_super_admin())
              OR (site_id IS NOT NULL AND site_id = (SELECT public.fn_jwt_site_id())))
  WITH CHECK ((SELECT public.fn_jwt_is_super_admin())
              OR (site_id IS NOT NULL AND site_id = (SELECT public.fn_jwt_site_id())));

DROP POLICY IF EXISTS r13_t_users_site ON public.t_users;
CREATE POLICY r13_t_users_site ON public.t_users
  AS RESTRICTIVE FOR ALL TO authenticated
  USING      ((SELECT public.fn_jwt_is_super_admin())
              OR (site_id IS NOT NULL AND site_id = (SELECT public.fn_jwt_site_id())))
  WITH CHECK ((SELECT public.fn_jwt_is_super_admin())
              OR (site_id IS NOT NULL AND site_id = (SELECT public.fn_jwt_site_id())));

-- ------------------------------------------------------------
-- 2. Tables filtrees par une table parente
-- ------------------------------------------------------------
-- t_user_roles : site du compte. La sous-requete sur t_users passe elle-meme
-- par la RLS de t_users (meme filtre) : pas de recursion (t_users ne
-- reference pas t_user_roles).
DROP POLICY IF EXISTS r13_t_user_roles_site ON public.t_user_roles;
CREATE POLICY r13_t_user_roles_site ON public.t_user_roles
  AS RESTRICTIVE FOR ALL TO authenticated
  USING      ((SELECT public.fn_jwt_is_super_admin())
              OR EXISTS (SELECT 1 FROM public.t_users u
                          WHERE u.sync_id = t_user_roles.user_sync_id
                            AND u.site_id IS NOT NULL
                            AND u.site_id = (SELECT public.fn_jwt_site_id())))
  WITH CHECK ((SELECT public.fn_jwt_is_super_admin())
              OR EXISTS (SELECT 1 FROM public.t_users u
                          WHERE u.sync_id = t_user_roles.user_sync_id
                            AND u.site_id IS NOT NULL
                            AND u.site_id = (SELECT public.fn_jwt_site_id())));

-- t_postes : site du centre.
DROP POLICY IF EXISTS r13_t_postes_site ON public.t_postes;
CREATE POLICY r13_t_postes_site ON public.t_postes
  AS RESTRICTIVE FOR ALL TO authenticated
  USING      ((SELECT public.fn_jwt_is_super_admin())
              OR EXISTS (SELECT 1 FROM public.t_centres c
                          WHERE c.id = t_postes.centre_id
                            AND c.site_id IS NOT NULL
                            AND c.site_id = (SELECT public.fn_jwt_site_id())))
  WITH CHECK ((SELECT public.fn_jwt_is_super_admin())
              OR EXISTS (SELECT 1 FROM public.t_centres c
                          WHERE c.id = t_postes.centre_id
                            AND c.site_id IS NOT NULL
                            AND c.site_id = (SELECT public.fn_jwt_site_id())));

-- ------------------------------------------------------------
-- 3. Tables de reference : lecture par tout porteur des claims gis_*,
--    ecriture par site
-- ------------------------------------------------------------
-- FOR ALL sans WITH CHECK : la condition « claims presentes » vaut pour
-- SELECT, et sert aussi de controle aux INSERT / UPDATE (cumul avec les
-- politiques par commande ci-dessous, toutes RESTRICTIVE donc combinees par ET).
DROP POLICY IF EXISTS r13_t_centres_claims ON public.t_centres;
CREATE POLICY r13_t_centres_claims ON public.t_centres
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.fn_jwt_gis_claims()) IS NOT NULL);

DROP POLICY IF EXISTS r13_t_centres_ins ON public.t_centres;
CREATE POLICY r13_t_centres_ins ON public.t_centres
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.fn_jwt_is_super_admin())
              OR (site_id IS NOT NULL AND site_id = (SELECT public.fn_jwt_site_id())));

DROP POLICY IF EXISTS r13_t_centres_upd ON public.t_centres;
CREATE POLICY r13_t_centres_upd ON public.t_centres
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING      ((SELECT public.fn_jwt_is_super_admin())
              OR (site_id IS NOT NULL AND site_id = (SELECT public.fn_jwt_site_id())))
  WITH CHECK ((SELECT public.fn_jwt_is_super_admin())
              OR (site_id IS NOT NULL AND site_id = (SELECT public.fn_jwt_site_id())));

DROP POLICY IF EXISTS r13_t_centres_del ON public.t_centres;
CREATE POLICY r13_t_centres_del ON public.t_centres
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING ((SELECT public.fn_jwt_is_super_admin())
         OR (site_id IS NOT NULL AND site_id = (SELECT public.fn_jwt_site_id())));

DROP POLICY IF EXISTS r13_t_sites_claims ON public.t_sites;
CREATE POLICY r13_t_sites_claims ON public.t_sites
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.fn_jwt_gis_claims()) IS NOT NULL);

-- Un agent de site ne peut pas creer de site (l'id de la nouvelle ligne
-- devrait etre le sien) ; il peut modifier / supprimer la ligne de SON site
-- (Q4 : pas de filtre par role en P1-6 ; voir rapport P1-6, risque note).
DROP POLICY IF EXISTS r13_t_sites_ins ON public.t_sites;
CREATE POLICY r13_t_sites_ins ON public.t_sites
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.fn_jwt_is_super_admin())
              OR id = (SELECT public.fn_jwt_site_id()));

DROP POLICY IF EXISTS r13_t_sites_upd ON public.t_sites;
CREATE POLICY r13_t_sites_upd ON public.t_sites
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING      ((SELECT public.fn_jwt_is_super_admin())
              OR id = (SELECT public.fn_jwt_site_id()))
  WITH CHECK ((SELECT public.fn_jwt_is_super_admin())
              OR id = (SELECT public.fn_jwt_site_id()));

DROP POLICY IF EXISTS r13_t_sites_del ON public.t_sites;
CREATE POLICY r13_t_sites_del ON public.t_sites
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING ((SELECT public.fn_jwt_is_super_admin())
         OR id = (SELECT public.fn_jwt_site_id()));

-- ------------------------------------------------------------
-- 4. password_hash illisible par authenticated (privileges de colonne)
-- ------------------------------------------------------------
DO $colonnes$
DECLARE
  v_cols TEXT;
BEGIN
  SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum) INTO v_cols
    FROM pg_attribute a
   WHERE a.attrelid = 'public.t_users'::regclass
     AND a.attnum > 0 AND NOT a.attisdropped
     AND a.attname <> 'password_hash';
  IF v_cols IS NULL THEN
    RAISE EXCEPTION '0013 : colonnes de t_users introuvables.';
  END IF;
  EXECUTE 'REVOKE SELECT ON TABLE public.t_users FROM authenticated';
  EXECUTE 'REVOKE SELECT (password_hash) ON TABLE public.t_users FROM authenticated';
  EXECUTE format('GRANT SELECT (%s) ON TABLE public.t_users TO authenticated', v_cols);
END;
$colonnes$;

-- ------------------------------------------------------------
-- 5. Defense en profondeur : droits qui contournent la RLS (authenticated)
-- ------------------------------------------------------------
REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE
  public.t_cartes, public.t_logs, public.t_user_presence, public.t_users,
  public.t_user_roles, public.t_postes, public.t_centres, public.t_sites
  FROM authenticated;

DO $maintain$
BEGIN
  IF current_setting('server_version_num')::int >= 170000 THEN
    EXECUTE 'REVOKE MAINTAIN ON TABLE public.t_cartes, public.t_logs, public.t_user_presence, '
         || 'public.t_users, public.t_user_roles, public.t_postes, public.t_centres, public.t_sites '
         || 'FROM authenticated';
  END IF;
END;
$maintain$;
