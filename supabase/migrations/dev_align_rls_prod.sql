-- =============================================================================
-- DEV UNIQUEMENT — reproduit l'état prod du 2026-11-13. NE PAS APPLIQUER EN PROD.
-- =============================================================================
-- Projet cible : DEV ajadkziqaskadlzboeqo (GEST-IN-SITU-DEV).
-- Hors numérotation NNNN volontairement : ce fichier n'est PAS une évolution du
-- schéma à rejouer sur les deux projets (règle du README), c'est un alignement
-- du dev sur l'état réel de la production, pour que les essais du chantier B
-- (politiques RESTRICTIVE TO authenticated, P1) soient représentatifs.
--
-- État prod relu en lecture seule le 2026-11-13 (pg_class / pg_policies) :
--   - RLS ACTIVE (non forcée) sur les 11 tables public ;
--   - t_cartes, t_centres, t_logs, t_postes, t_sites, t_users : une politique
--     PERMISSIVE allow_all_operations_<table> FOR ALL
--     TO anon, authenticated, service_role USING (true) WITH CHECK (true) ;
--   - t_user_presence, t_user_roles, t_security_guard_*, t_sync_conflicts :
--     déjà identiques sur le dev (non touchées ici).
-- État dev avant ce fichier : RLS DÉSACTIVÉE et aucune politique sur ces 6 tables
-- (héritage de 0001_baseline_schema.sql, lignes 269-274).
--
-- Ce que fait ce fichier (et rien d'autre) :
--   1. crée la politique allow_all_operations_<table> si elle n'existe pas ;
--   2. active la RLS (ENABLE, pas FORCE) sur les 6 tables.
-- Aucune suppression, aucune donnée touchée, aucun GRANT modifié.
-- Idempotent : rejouable sans effet.
--
-- Écart NON traité : t_app_version existe sur le dev (RLS désactivée) mais
-- n'existe pas en prod ; aucune référence dans src/ (vérifié le 2026-11-13).
-- Laissée telle quelle.
--
-- Retour arrière (dev) :
--   ALTER TABLE public.<table> DISABLE ROW LEVEL SECURITY;
--   DROP POLICY IF EXISTS allow_all_operations_<table> ON public.<table>;
-- =============================================================================

DO $$
DECLARE
  t TEXT;
  v_tables CONSTANT TEXT[] := ARRAY['t_cartes','t_centres','t_logs','t_postes','t_sites','t_users'];
BEGIN
  FOREACH t IN ARRAY v_tables LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE EXCEPTION 'Table public.% absente : base inattendue, arrêt.', t;
    END IF;

    -- 1. Politique d'abord (évite toute fenêtre où la RLS bloquerait anon).
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = t
        AND policyname = 'allow_all_operations_' || t
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I AS PERMISSIVE FOR ALL '
        'TO anon, authenticated, service_role USING (true) WITH CHECK (true)',
        'allow_all_operations_' || t, t);
      RAISE NOTICE 'Politique allow_all_operations_% créée', t;
    END IF;

    -- 2. Puis la RLS (ENABLE seulement, comme en prod : relforcerowsecurity = false).
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END
$$;

-- Contrôle (à lancer sur dev ET prod, résultats attendus identiques) :
-- SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
--   (SELECT string_agg(p.policyname||'|'||p.permissive||'|'||p.cmd||'|'||array_to_string(p.roles,',')
--      ||'|'||coalesce(p.qual,'-')||'|'||coalesce(p.with_check,'-'), ' ; ' ORDER BY p.policyname)
--    FROM pg_policies p WHERE p.schemaname='public' AND p.tablename=c.relname) AS policies
-- FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
-- WHERE n.nspname='public' AND c.relkind='r' ORDER BY 1;
