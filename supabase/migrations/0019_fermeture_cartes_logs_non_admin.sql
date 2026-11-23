-- ============================================================
-- 0019_fermeture_cartes_logs_non_admin.sql
-- GEST-IN-SITU : version telephone v1 (docs/PLAN_MOBILE_V1.md, etape E2,
-- decision Q2 du 2026-11-23). Ferme, pour les sessions authenticated NON
-- administrateur, la LECTURE et l'ECRITURE directes de t_cartes et
-- l'ECRITURE directe de t_logs. La recherche et la delivrance par telephone
-- passent uniquement par les fonctions serveur de 0020.
-- Purement ADDITIF : 4 politiques RESTRICTIVE TO authenticated ; aucune
-- politique existante (0013 / 0014 comprises) modifiee ou supprimee ; aucun
-- droit anon touche ; aucune colonne, aucun trigger, aucune fonction ajoutes.
-- DEPEND DE 0011 (fn_jwt_*), 0013 (r13_*) et 0014 (r14_*).
--
-- Probleme ferme (P0 du plan mobile) : r13_t_cartes_site
-- (0013_rls_authenticated_par_site.sql:177-183) laisse tout authenticated
-- lire et ecrire TOUTES les colonnes des cartes de son site (num_secu,
-- contact compris), sans filtre par role. Un operateur muni d'une session
-- (telephone) pourrait donc lire num_secu, ou ecrire une delivrance sans
-- les controles de delivrerCarte (statut, centre, DOUBLON, ABSENT...).
--
-- Regle retenue :
--   « administrateur » = SUPER ADMIN verifie par la claim
--   (fn_jwt_is_super_admin, 0011/0018 : role PRINCIPAL seulement) OU
--   ADMINISTRATEUR_SITE OU ADMIN_CENTRE dans gis_roles (principal +
--   secondaires, meme semantique que 0014 et verifyUserRole()).
--   t_cartes : SELECT / INSERT / UPDATE / DELETE reserves aux
--              administrateurs (FOR ALL, USING et WITH CHECK identiques) ;
--   t_logs   : INSERT / UPDATE / DELETE reserves aux administrateurs ;
--              la LECTURE reste regie par 0013 (par site) : Q2 ne ferme que
--              l'ecriture.
--   Le filtre par site de 0013 reste en place et s'ajoute (RESTRICTIVE = ET).
--
-- Pourquoi les administrateurs gardent l'acces direct (Q2 = « non-admin ») :
--   - 0013 (en-tete, lignes 16-19 et 90-91) et le README (section 0013,
--     « A savoir pour P2 ») documentent l'acces authenticated aux cartes de
--     son site pour le client P2 (poste avec badge) ; le fermer aussi aux
--     administrateurs casserait cette conception pour les postes tenus par
--     un administrateur ;
--   - dans l'application, ADMINISTRATEUR_SITE et ADMIN_CENTRE consultent et
--     modifient deja les cartes de leur perimetre (num_secu compris) : la
--     fermeture n'apporterait pas de protection de donnees supplementaire.
--   Limite assumee : ADMIN_CENTRE garde la lecture de tout SON SITE (filtre
--   0013), pas seulement de son centre (comme avant 0019).
--
-- !! A SAVOIR AVANT P2 (poste Windows avec session authenticated) !!
--   Un poste dont la session est celle d'un OPERATEUR_* ne pourra plus lire
--   (y compris via fn_downstream_cartes_chunk, SECURITY INVOKER), ni envoyer
--   ses cartes (outbox) sous authenticated, ni ecrire t_logs. Aujourd'hui
--   sans effet (les postes ecrivent en anon, aucune session personnelle en
--   prod). Le client P2 devra en tenir compte (decision a prendre avant P2 :
--   garder anon pour la synchronisation des operateurs, ou fonctions dediees).
--
-- Pourquoi des politiques et pas un REVOKE : un REVOKE sur la table vise le
-- role SQL authenticated en entier (administrateurs compris) ; seule une
-- politique peut lire les claims et distinguer les roles metier. Les
-- privileges de table restent donc inchanges (REVOKE TRUNCATE etc. deja fait
-- par 0013).
--
-- Echec ferme : sans claims gis_* (ou sans gis_v), fn_jwt_roles() = {} et
-- fn_jwt_is_super_admin() = false : aucun acces (deja le cas par 0013).
-- service_role (BYPASSRLS) et les fonctions SECURITY DEFINER proprietaire
-- postgres (BYPASSRLS, proprietaire des tables : 0006, 0008, 0020) ne sont
-- pas filtres.
-- A savoir : un SELECT / UPDATE / DELETE non permis rend 0 ligne SANS erreur
-- (USING filtre) ; un INSERT non permis leve 42501 (WITH CHECK).
--
-- Idempotent : DROP POLICY IF EXISTS puis CREATE POLICY.
-- Application : un seul bloc  BEGIN; <ce fichier> COMMIT;  (SET LOCAL
-- lock_timeout = '3s' + controle en tete). Verrou : CREATE / DROP POLICY
-- prend un AccessExclusiveLock COURT sur t_cartes et t_logs (bloque aussi
-- les lectures le temps de l'instruction, mesure de 0013) -> en prod, hors
-- heures de travail des postes ; si un verrou n'est pas obtenu en 3 s, tout
-- est annule (55P03), rien n'est change.
--
-- Retour arriere (rend a authenticated les seuls filtres 0013) :
--   BEGIN;
--   SET LOCAL lock_timeout = '3s';
--   DROP POLICY IF EXISTS r19_t_cartes_admin ON public.t_cartes;
--   DROP POLICY IF EXISTS r19_t_logs_ins     ON public.t_logs;
--   DROP POLICY IF EXISTS r19_t_logs_upd     ON public.t_logs;
--   DROP POLICY IF EXISTS r19_t_logs_del     ON public.t_logs;
--   COMMIT;
-- Ordre : retirer 0020 n'est pas necessaire pour retirer 0019 (0020 ne lit
-- pas ces politiques) ; si 0013 doit aussi etre retiree : 0019, puis 0014,
-- puis 0013.
--
-- Sources : PostgreSQL 17, CREATE POLICY / 5.9 Row Security Policies
-- (politiques RESTRICTIVE combinees par ET, ne s'appliquent qu'aux roles
-- cites) ; methode identique a 0013 / 0014 (prouvee sur le dev).
--
-- Application : dev ajadkziqaskadlzboeqo : voir README, section « 0019 ».
-- Production itvyayakwgzvfqvdrgyv : NON appliquee (geste utilisateur, avec
-- 0020, prerequis prod du plan mobile).
-- Test : supabase/tests/0019_fermeture_cartes_logs_non_admin.test.sql
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
    RAISE EXCEPTION '0019 : lock_timeout de protection inactif (fichier execute hors transaction). Executer en un seul bloc : BEGIN; <fichier> COMMIT;';
  END IF;
  IF to_regprocedure('public.fn_jwt_is_super_admin()') IS NULL
     OR to_regprocedure('public.fn_jwt_roles()') IS NULL THEN
    RAISE EXCEPTION '0019 : 0011 absente (fonctions fn_jwt_*) : appliquer 0011 d''abord.';
  END IF;
  IF (SELECT count(*) FROM pg_policies
       WHERE schemaname = 'public' AND policyname LIKE 'r13\_%'
         AND permissive = 'RESTRICTIVE' AND roles = ARRAY['authenticated']::name[]) <> 14 THEN
    RAISE EXCEPTION '0019 : 0013 absente ou incomplete (14 politiques r13_* attendues).';
  END IF;
  IF (SELECT count(*) FROM pg_policies
       WHERE schemaname = 'public' AND policyname LIKE 'r14\_%'
         AND permissive = 'RESTRICTIVE' AND roles = ARRAY['authenticated']::name[]) <> 9 THEN
    RAISE EXCEPTION '0019 : 0014 absente ou incomplete (9 politiques r14_* attendues).';
  END IF;
  FOREACH t IN ARRAY ARRAY['t_cartes','t_logs'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE EXCEPTION '0019 : table public.% absente.', t;
    END IF;
    IF NOT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = ('public.' || t)::regclass) THEN
      RAISE EXCEPTION '0019 : RLS inactive sur public.% : etat inattendu, rien n''est applique.', t;
    END IF;
  END LOOP;
END;
$garde$;

-- ------------------------------------------------------------
-- 1. t_cartes : lecture ET ecriture directes reservees aux administrateurs
-- ------------------------------------------------------------
DROP POLICY IF EXISTS r19_t_cartes_admin ON public.t_cartes;
CREATE POLICY r19_t_cartes_admin ON public.t_cartes
  AS RESTRICTIVE FOR ALL TO authenticated
  USING      ((SELECT public.fn_jwt_is_super_admin())
              OR (SELECT public.fn_jwt_roles()) && ARRAY['ADMINISTRATEUR_SITE','ADMIN_CENTRE']::text[])
  WITH CHECK ((SELECT public.fn_jwt_is_super_admin())
              OR (SELECT public.fn_jwt_roles()) && ARRAY['ADMINISTRATEUR_SITE','ADMIN_CENTRE']::text[]);

-- ------------------------------------------------------------
-- 2. t_logs : ecriture directe reservee aux administrateurs
--    (lecture inchangee : 0013)
-- ------------------------------------------------------------
DROP POLICY IF EXISTS r19_t_logs_ins ON public.t_logs;
CREATE POLICY r19_t_logs_ins ON public.t_logs
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.fn_jwt_is_super_admin())
              OR (SELECT public.fn_jwt_roles()) && ARRAY['ADMINISTRATEUR_SITE','ADMIN_CENTRE']::text[]);

DROP POLICY IF EXISTS r19_t_logs_upd ON public.t_logs;
CREATE POLICY r19_t_logs_upd ON public.t_logs
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING      ((SELECT public.fn_jwt_is_super_admin())
              OR (SELECT public.fn_jwt_roles()) && ARRAY['ADMINISTRATEUR_SITE','ADMIN_CENTRE']::text[])
  WITH CHECK ((SELECT public.fn_jwt_is_super_admin())
              OR (SELECT public.fn_jwt_roles()) && ARRAY['ADMINISTRATEUR_SITE','ADMIN_CENTRE']::text[]);

DROP POLICY IF EXISTS r19_t_logs_del ON public.t_logs;
CREATE POLICY r19_t_logs_del ON public.t_logs
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING ((SELECT public.fn_jwt_is_super_admin())
         OR (SELECT public.fn_jwt_roles()) && ARRAY['ADMINISTRATEUR_SITE','ADMIN_CENTRE']::text[]);
