-- ============================================================
-- 0014_filtre_role_hierarchie.sql
-- GEST-IN-SITU : filtre PAR ROLE des ECRITURES de authenticated sur
-- t_sites, t_centres et t_postes (chantier B, P1-6, complement de 0013).
-- Decision de l'utilisateur du 2026-11-18 (point 2). Purement ADDITIF :
-- 9 politiques RESTRICTIVE TO authenticated ; aucune politique existante
-- (0013 comprise) modifiee ou supprimee ; aucun droit anon touche ; aucune
-- colonne, aucun trigger, aucune fonction ajoutes.
-- DEPEND DE 0011 (fn_jwt_*) ET DE 0013 (politiques r13_*).
--
-- Regle retenue, alignee sur ce que l'application permet AUJOURD'HUI
-- (lecture de src/ le 2026-11-18) :
--   t_sites   INSERT / UPDATE / DELETE : SUPER ADMIN seulement.
--     src/main/ipc/handlers.ts : hierarchy:createSite, updateSite, deleteSite
--     -> verifyUserRole(..., ['SUPER ADMIN']) (createSite ~l.4015-4027,
--     updateSite ~l.4028-4044, deleteSite ~l.4045-4072).
--   t_centres INSERT / UPDATE / DELETE : SUPER ADMIN, ou ADMINISTRATEUR_SITE
--     pour un centre de SON site.
--     handlers.ts : hierarchy:createCentre (~l.4160-4173 : SUPER ADMIN /
--     ADMINISTRATEUR_SITE, site force sur celui de la session),
--     hierarchy:updateCentre (~l.4227-4250, meme liste + centre de son
--     site), handleDeleteCentreLogic (~l.4315-4338, idem).
--   t_postes  INSERT / UPDATE / DELETE : SUPER ADMIN, ou ADMINISTRATEUR_SITE
--     pour un poste d'un centre de SON site.
--     L'application n'a AUCUN handler IPC de poste : createPoste
--     (src/main/database/queries/hierarchy.queries.ts:783) n'est appele
--     nulle part ; les postes ne disparaissent qu'avec leur centre
--     (deleteCentre, hierarchy.queries.ts:847) ou leur site (deleteSite,
--     hierarchy.queries.ts:372), gestes SUPER ADMIN / ADMINISTRATEUR_SITE.
--     On aligne donc t_postes sur t_centres.
--   ADMIN_CENTRE et OPERATEUR_* : AUCUNE ecriture sur ces 3 tables (aucun
--     handler ne le leur permet ; route « sites » reservee a SUPER ADMIN /
--     ADMINISTRATEUR_SITE : src/renderer/src/App.tsx:339).
--
-- Role lu dans la claim gis_roles (fn_jwt_roles, 0011) : role principal ET
-- roles secondaires (t_user_roles). Meme semantique que verifyUserRole()
-- (handlers.ts:76-101), qui accepte un role principal OU secondaire. Le
-- SUPER ADMIN est lu par fn_jwt_is_super_admin (claim gis_is_super_admin).
-- Noms de roles : contrainte t_users_role_check (verifiee sur le dev le
-- 2026-11-18) : 'SUPER ADMIN', 'ADMINISTRATEUR_SITE', 'ADMIN_CENTRE', ...
--
-- LECTURE : INCHANGEE (aucune politique SELECT / FOR ALL ajoutee) : 0013
-- s'applique toujours (sites / centres lisibles par tout porteur des claims
-- gis_*, postes par site).
-- ECHEC FERME (decision confirmee le 2026-11-18) : sans claims gis_*,
-- fn_jwt_roles() = {} et fn_jwt_is_super_admin() = false -> aucune ecriture.
--
-- Les conditions de site sont REPETEES ici (et pas seulement heritees de
-- 0013) : si 0013 etait retiree seule par erreur, 0014 garderait le
-- cloisonnement par site des ecritures. Toutes les politiques sont
-- RESTRICTIVE : elles se combinent par ET avec 0013 et avec
-- allow_all_operations_* (PERMISSIVE, inchangee).
-- Les fonctions sont appelees sous forme (SELECT ...) : evaluees une fois par
-- requete (InitPlan).
--
-- A savoir :
--   - un UPDATE / DELETE non permis touche 0 ligne SANS erreur (USING filtre) ;
--     un INSERT non permis, ou un UPDATE qui deplacerait la ligne hors du
--     perimetre, leve 42501 (WITH CHECK) ;
--   - les suppressions en CASCADE par cle etrangere (t_sites -> t_centres ->
--     t_postes, ON DELETE CASCADE) ne passent PAS par la RLS (comportement
--     PostgreSQL) : un ADMINISTRATEUR_SITE qui supprime un centre de son site
--     supprime aussi ses postes, comme dans l'application ;
--   - P2 (client authenticated) : une ecriture de centre mise en file
--     (t_outbox) par un administrateur puis envoyee sous la session d'un
--     autre agent du poste serait refusee (42501 / 0 ligne). A traiter avec
--     actor_sync_id (Q8) ; sync:forceCentres (handlers.ts:7648) n'a pas
--     de garde de role cote poste : sous session authenticated, un agent
--     non administrateur qui le declenche serait refuse par 0014.
--
-- Idempotent : DROP POLICY IF EXISTS puis CREATE POLICY.
-- Application : un seul bloc  BEGIN; <ce fichier> COMMIT;  (SET LOCAL
-- lock_timeout = '3s' + controle en tete). Verrou : CREATE / DROP POLICY
-- prend un AccessExclusiveLock COURT sur t_sites, t_centres, t_postes (pas
-- t_cartes) ; si un verrou n'est pas obtenu en 3 s, tout est annule (55P03),
-- rien n'est change.
--
-- Retour arriere (rend aux ecritures authenticated le seul filtre par site
-- de 0013) :
--   BEGIN;
--   SET LOCAL lock_timeout = '3s';
--   DROP POLICY IF EXISTS r14_t_sites_ins   ON public.t_sites;
--   DROP POLICY IF EXISTS r14_t_sites_upd   ON public.t_sites;
--   DROP POLICY IF EXISTS r14_t_sites_del   ON public.t_sites;
--   DROP POLICY IF EXISTS r14_t_centres_ins ON public.t_centres;
--   DROP POLICY IF EXISTS r14_t_centres_upd ON public.t_centres;
--   DROP POLICY IF EXISTS r14_t_centres_del ON public.t_centres;
--   DROP POLICY IF EXISTS r14_t_postes_ins  ON public.t_postes;
--   DROP POLICY IF EXISTS r14_t_postes_upd  ON public.t_postes;
--   DROP POLICY IF EXISTS r14_t_postes_del  ON public.t_postes;
--   COMMIT;
-- Ordre si 0013 doit aussi etre retiree : 0014 d'abord, puis 0013.
--
-- Application : dev ajadkziqaskadlzboeqo : appliquee le 2026-11-18 (MCP
-- apply_migration, PostgreSQL 17.11, partie executable identique a ce
-- fichier) ; test 17/17 (cas 16 service_role concluant) ; empreinte des
-- droits et politiques anon identique avant / apres (206 elements) ;
-- non-regression 0006 a 0013 rejouee (voir README) ; aucun residu.
-- Production itvyayakwgzvfqvdrgyv : NON appliquee (geste utilisateur, avec
-- 0011/0012/0013, apres audit agent-9).
-- Test : supabase/tests/0014_filtre_role_hierarchie.test.sql
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
    RAISE EXCEPTION '0014 : lock_timeout de protection inactif (fichier execute hors transaction). Executer en un seul bloc : BEGIN; <fichier> COMMIT;';
  END IF;
  IF to_regprocedure('public.fn_jwt_site_id()') IS NULL
     OR to_regprocedure('public.fn_jwt_is_super_admin()') IS NULL
     OR to_regprocedure('public.fn_jwt_roles()') IS NULL THEN
    RAISE EXCEPTION '0014 : 0011 absente (fonctions fn_jwt_*) : appliquer 0011 d''abord.';
  END IF;
  IF (SELECT count(*) FROM pg_policies
       WHERE schemaname = 'public' AND policyname LIKE 'r13\_%'
         AND permissive = 'RESTRICTIVE' AND roles = ARRAY['authenticated']::name[]) <> 14 THEN
    RAISE EXCEPTION '0014 : 0013 absente ou incomplete (14 politiques r13_* attendues) : appliquer 0013 d''abord.';
  END IF;
  FOREACH t IN ARRAY ARRAY['t_sites','t_centres','t_postes'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE EXCEPTION '0014 : table public.% absente.', t;
    END IF;
    IF NOT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = ('public.' || t)::regclass) THEN
      RAISE EXCEPTION '0014 : RLS inactive sur public.% : etat inattendu, rien n''est applique.', t;
    END IF;
  END LOOP;
END;
$garde$;

-- ------------------------------------------------------------
-- 1. t_sites : ecritures SUPER ADMIN seulement
-- ------------------------------------------------------------
DROP POLICY IF EXISTS r14_t_sites_ins ON public.t_sites;
CREATE POLICY r14_t_sites_ins ON public.t_sites
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.fn_jwt_is_super_admin()));

DROP POLICY IF EXISTS r14_t_sites_upd ON public.t_sites;
CREATE POLICY r14_t_sites_upd ON public.t_sites
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING      ((SELECT public.fn_jwt_is_super_admin()))
  WITH CHECK ((SELECT public.fn_jwt_is_super_admin()));

DROP POLICY IF EXISTS r14_t_sites_del ON public.t_sites;
CREATE POLICY r14_t_sites_del ON public.t_sites
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING ((SELECT public.fn_jwt_is_super_admin()));

-- ------------------------------------------------------------
-- 2. t_centres : SUPER ADMIN, ou ADMINISTRATEUR_SITE de SON site
-- ------------------------------------------------------------
DROP POLICY IF EXISTS r14_t_centres_ins ON public.t_centres;
CREATE POLICY r14_t_centres_ins ON public.t_centres
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.fn_jwt_is_super_admin())
              OR (ARRAY['ADMINISTRATEUR_SITE']::text[] <@ (SELECT public.fn_jwt_roles())
                  AND site_id IS NOT NULL AND site_id = (SELECT public.fn_jwt_site_id())));

DROP POLICY IF EXISTS r14_t_centres_upd ON public.t_centres;
CREATE POLICY r14_t_centres_upd ON public.t_centres
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING      ((SELECT public.fn_jwt_is_super_admin())
              OR (ARRAY['ADMINISTRATEUR_SITE']::text[] <@ (SELECT public.fn_jwt_roles())
                  AND site_id IS NOT NULL AND site_id = (SELECT public.fn_jwt_site_id())))
  WITH CHECK ((SELECT public.fn_jwt_is_super_admin())
              OR (ARRAY['ADMINISTRATEUR_SITE']::text[] <@ (SELECT public.fn_jwt_roles())
                  AND site_id IS NOT NULL AND site_id = (SELECT public.fn_jwt_site_id())));

DROP POLICY IF EXISTS r14_t_centres_del ON public.t_centres;
CREATE POLICY r14_t_centres_del ON public.t_centres
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING ((SELECT public.fn_jwt_is_super_admin())
         OR (ARRAY['ADMINISTRATEUR_SITE']::text[] <@ (SELECT public.fn_jwt_roles())
             AND site_id IS NOT NULL AND site_id = (SELECT public.fn_jwt_site_id())));

-- ------------------------------------------------------------
-- 3. t_postes : SUPER ADMIN, ou ADMINISTRATEUR_SITE pour un centre de SON site
-- ------------------------------------------------------------
DROP POLICY IF EXISTS r14_t_postes_ins ON public.t_postes;
CREATE POLICY r14_t_postes_ins ON public.t_postes
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.fn_jwt_is_super_admin())
              OR (ARRAY['ADMINISTRATEUR_SITE']::text[] <@ (SELECT public.fn_jwt_roles())
                  AND EXISTS (SELECT 1 FROM public.t_centres c
                               WHERE c.id = t_postes.centre_id
                                 AND c.site_id IS NOT NULL
                                 AND c.site_id = (SELECT public.fn_jwt_site_id()))));

DROP POLICY IF EXISTS r14_t_postes_upd ON public.t_postes;
CREATE POLICY r14_t_postes_upd ON public.t_postes
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING      ((SELECT public.fn_jwt_is_super_admin())
              OR (ARRAY['ADMINISTRATEUR_SITE']::text[] <@ (SELECT public.fn_jwt_roles())
                  AND EXISTS (SELECT 1 FROM public.t_centres c
                               WHERE c.id = t_postes.centre_id
                                 AND c.site_id IS NOT NULL
                                 AND c.site_id = (SELECT public.fn_jwt_site_id()))))
  WITH CHECK ((SELECT public.fn_jwt_is_super_admin())
              OR (ARRAY['ADMINISTRATEUR_SITE']::text[] <@ (SELECT public.fn_jwt_roles())
                  AND EXISTS (SELECT 1 FROM public.t_centres c
                               WHERE c.id = t_postes.centre_id
                                 AND c.site_id IS NOT NULL
                                 AND c.site_id = (SELECT public.fn_jwt_site_id()))));

DROP POLICY IF EXISTS r14_t_postes_del ON public.t_postes;
CREATE POLICY r14_t_postes_del ON public.t_postes
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING ((SELECT public.fn_jwt_is_super_admin())
         OR (ARRAY['ADMINISTRATEUR_SITE']::text[] <@ (SELECT public.fn_jwt_roles())
             AND EXISTS (SELECT 1 FROM public.t_centres c
                          WHERE c.id = t_postes.centre_id
                            AND c.site_id IS NOT NULL
                            AND c.site_id = (SELECT public.fn_jwt_site_id()))));
