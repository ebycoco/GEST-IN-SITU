-- ============================================================
-- 0021_allegement_index_t_cartes.sql
-- GEST-IN-SITU : rester sous la limite de 0,5 Go de base de l'offre gratuite
-- (docs/PLAN_QUOTA_SUPABASE_GRATUIT.md, plan agent-4 du 2026-11-24, decision utilisateur).
--
-- Supprime 7 index de public.t_cartes jamais utilises ou en double (groupe 1, ~ -77 Mo en
-- prod) puis reconstruit 2 index gonfles (~ -35 Mo). AUCUNE DONNEE N'EST SUPPRIMEE :
-- un index n'est qu'une table de recherche rapide, recalculable a tout moment.
--
--   idx_cartes_sync_id      : copie non unique de la contrainte t_cartes_sync_id_key
--                             (meme colonne) -> l'index unique prend le relais.
--   idx_cartes_cle_flex, idx_cartes_prenoms, idx_cartes_contact, idx_cartes_statut,
--   idx_cartes_statut_phys, idx_cartes_rangement : 0 lecture en prod (pg_stat_user_indexes,
--                             2026-11-24) ; aucune requete cloud du poste, de 0020
--                             (fn_mobile_*), de gis-login ni du hook ne filtre sur ces
--                             colonnes d'une facon qu'un btree servirait (verifie par agent-4).
--
-- EXECUTION : DROP / REINDEX ... CONCURRENTLY refusent un bloc transactionnel. Executer
-- UNE instruction par execution (pas apply_migration, pas un SQL Editor multi-instructions).
-- CONCURRENTLY ne bloque ni les lectures ni les ecritures des postes.
-- Un REINDEX CONCURRENTLY interrompu peut laisser un index *_ccnew INVALID : le supprimer
-- (DROP INDEX CONCURRENTLY) et relancer.
--
-- Ordre : apres 0001 (qui cree ces index avec IF NOT EXISTS) ; si une base est reconstruite
-- depuis 0001, rejouer 0021.
--
-- Garde (executer d'abord, seule) :
DO $garde$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.t_cartes'::regclass
                  AND conname = 't_cartes_sync_id_key' AND contype = 'u') THEN
    RAISE EXCEPTION '0021 : contrainte unique t_cartes_sync_id_key absente, arret (idx_cartes_sync_id ne doit pas etre supprime).';
  END IF;
END;
$garde$;

-- Groupe 1 (une instruction par execution) :
DROP INDEX CONCURRENTLY IF EXISTS public.idx_cartes_sync_id;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_cartes_cle_flex;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_cartes_prenoms;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_cartes_contact;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_cartes_statut;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_cartes_statut_phys;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_cartes_rangement;

-- Reconstruction des index gonfles (une instruction par execution) :
REINDEX INDEX CONCURRENTLY public.idx_cartes_site_updated_syncid;
REINDEX INDEX CONCURRENTLY public.t_cartes_sync_id_key;

-- Groupe 2 (NON inclus : a decider apres 7 jours d'observation de idx_scan) :
--   idx_cartes_cle_doublon, idx_cartes_site_statut, idx_cartes_num_secu, idx_cartes_sync.
--
-- RETOUR ARRIERE (une instruction par execution, quelques secondes chacune) :
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cartes_sync_id     ON public.t_cartes(sync_id);
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cartes_cle_flex    ON public.t_cartes(cle_doublon_flex);
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cartes_prenoms     ON public.t_cartes(prenoms);
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cartes_contact     ON public.t_cartes(contact);
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cartes_statut      ON public.t_cartes(statut);
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cartes_statut_phys ON public.t_cartes(statut_physique);
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cartes_rangement   ON public.t_cartes(rangement);
-- ============================================================
