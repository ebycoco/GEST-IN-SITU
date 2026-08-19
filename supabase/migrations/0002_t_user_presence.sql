-- ============================================================
-- 0002_t_user_presence.sql
-- GEST-IN-SITU : ajout de t_user_presence (présence des agents)
--
-- Capture RÉTROACTIVE de l'ajout réel du 17/08/2026 (commit e67326c,
-- "feat(presence): module backend de presence des agents (heartbeat)").
-- Cet ajout avait été fait à la main directement sur le projet Supabase de
-- PRODUCTION (itvyayakwgzvfqvdrgyv) au moment du commit, sans geste
-- équivalent sur dev/staging (zddibqgutigwxjwbojmn) — d'où l'écart de
-- schéma détecté et corrigé manuellement le 19/08/2026, à l'origine de la
-- mise en place de ce dossier supabase/migrations/.
--
-- ⚠️ DÉJÀ APPLIQUÉ sur les deux projets (dev et prod) à la date de création
-- de ce fichier — ne pas le rejouer par réflexe. Contrairement à
-- 0001_baseline_schema.sql, ce fichier est cependant idempotent
-- (CREATE TABLE/INDEX ... IF NOT EXISTS) : une exécution accidentelle sur
-- un projet où la table existe déjà est sans danger (aucun DROP).
--
-- Isolé de 0001_baseline_schema.sql pour illustrer le format attendu d'une
-- migration incrémentale normale à partir de maintenant : un changement
-- ciblé, un fichier, appliqué manuellement sur dev PUIS prod (jamais un
-- seul des deux), voir README.md.
-- ============================================================================
-- TABLE : t_user_presence (Présence des agents — heartbeat/login/logout)
-- ============================================================================
-- Alimentée en écritures fire-and-forget (hors moteur outbox) par
-- src/main/sync/presence.service.ts : heartbeatPresence(), recordPresenceLogin(),
-- recordPresenceLogout(). Lue en direct (jamais via SQLite local) par
-- getAgentsPresence() du même module, pour la future page "Présence des agents"
-- (ADMINISTRATEUR_SITE sur son site, SUPER ADMIN tous sites).
--
-- Une seule ligne par compte (PK user_sync_id), écrasée à chaque battement/
-- connexion/déconnexion — pas d'historique, pas de table de log, pas de purge
-- à prévoir. Aucun statut (En ligne/Inactif/Hors ligne) n'est stocké ici : seuls
-- des timestamps bruts, le calcul du statut se fait côté renderer.
--
-- Types alignés sur t_users (sync_id TEXT UNIQUE, site_id/centre_id BIGINT
-- REFERENCES t_sites(id)/t_centres(id) — cf. section 4 de 0001_baseline_schema.sql).
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.t_user_presence (
    user_sync_id        TEXT PRIMARY KEY REFERENCES public.t_users(sync_id) ON DELETE CASCADE,
    login                TEXT NOT NULL,
    site_id              BIGINT REFERENCES public.t_sites(id),
    centre_id            BIGINT REFERENCES public.t_centres(id),
    role                 TEXT,
    last_heartbeat_at    TIMESTAMPTZ,
    last_login_at        TIMESTAMPTZ,
    last_logout_at       TIMESTAMPTZ
);

-- Index de lecture par site/centre (requêtes futures directes sur cette table ;
-- getAgentsPresence() filtre aujourd'hui par user_sync_id issu du roster t_users,
-- déjà couvert par la PK ci-dessus, mais ces index restent utiles pour toute
-- requête directe filtrée site_id/centre_id).
CREATE INDEX IF NOT EXISTS idx_user_presence_site_id   ON public.t_user_presence(site_id);
CREATE INDEX IF NOT EXISTS idx_user_presence_centre_id ON public.t_user_presence(centre_id);

-- RLS ACTIVÉ + policy permissive "allow_all_operations_*", même modèle réel que
-- t_sites/t_centres/t_postes/t_users/t_cartes/t_logs (vérifié directement en base
-- de production le 2026-08-17 via pg_tables/pg_policies — la mention "RLS
-- désactivé sur toutes les tables" de 0001_baseline_schema.sql (section 8) est
-- OBSOLÈTE/fausse pour ces tables, ne pas s'y fier ; correction de cette
-- section 8 elle-même laissée en dehors du périmètre de cet ajout).
ALTER TABLE public.t_user_presence ENABLE ROW LEVEL SECURITY;

CREATE POLICY "allow_all_operations_t_user_presence" ON public.t_user_presence
FOR ALL USING (true) WITH CHECK (true);

GRANT ALL ON public.t_user_presence TO anon, authenticated, service_role;
