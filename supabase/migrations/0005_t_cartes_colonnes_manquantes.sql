-- ============================================================
-- 0005_t_cartes_colonnes_manquantes.sql
-- GEST-IN-SITU : rattrapage de 12 colonnes de t_cartes poussees/lues par
-- l'application mais absentes des migrations 0001 -> 0004.
--
-- Contexte : ces colonnes ont ete ajoutees A LA MAIN (ALTER TABLE) sur la
-- production et sur l'ancien projet dev, sans fichier de migration
-- correspondant (voir CHANGELOG.md : cycle signalement/escalade/resolution
-- d'absence, colonnes escalade_niveau / has_invalid_date /
-- note_signalement_absence / contact_retirant / relation_retirant ; et
-- migrations locales SQLite V67 pour les 7 colonnes de tracabilite doublon).
-- Le projet dev historique zddibqgutigwxjwbojmn a ete supprime puis recree
-- le 2026-10-10 (GEST-IN-SITU-DEV, ajadkziqaskadlzboeqo) en rejouant
-- 0001 -> 0004 : l'ecart est alors apparu (PostgREST : "Could not find the
-- 'contact_retirant' column of 't_cartes' in the schema cache").
--
-- Colonnes ajoutees (toutes nullables, SANS valeur par defaut : le code
-- d'envoi fournit toujours la valeur, cf. src/main/sync/payload-mapper.ts:34-50,
-- src/main/sync/upstream.ts:53-77, src/main/workers/upload-worker.js:244-269) :
--   TEXT :
--     contact_retirant, relation_retirant            (local TEXT, schema.ts:844 / V63)
--     doublon_declare_par, doublon_motif,
--     statut_avant_doublon, doublon_annule_par,
--     doublon_motif_annulation                       (local TEXT, schema.ts:847-853)
--     doublon_declare_le, doublon_annule_le          (local TEXT : ISO via
--       new Date().toISOString(), cartes.queries.ts:894/996 ; TEXT et non
--       TIMESTAMPTZ pour rester coherent avec apurement_*_le de 0003 et avec
--       la colonne locale TEXT, sans re-parsing cote serveur)
--     note_signalement_absence                       (local TEXT, schema.ts:823)
--     escalade_niveau                                (local TEXT 'CENTRE'|'SITE'|'RESOLU',
--       schema.ts:824 ; pas de CHECK ni de DEFAULT ici : l'app envoie toujours
--       une valeur, 'CENTRE' par defaut, payload-mapper.ts:50)
--   INTEGER :
--     has_invalid_date                               (local INTEGER DEFAULT 0, schema.ts:845 ;
--       l'app envoie 0/1 via `?? 0`, payload-mapper.ts:50 -> pas BOOLEAN, un
--       entier JSON serait rejete par PostgREST sur une colonne boolean)
--
-- Aucun index ajoute : aucune requete cote Supabase ne filtre sur ces
-- colonnes (l'index idx_cartes_site_invalid_date existe uniquement en SQLite).
-- Aucun DROP, aucun UPDATE de donnees, aucune colonne existante modifiee.
--
-- RPC : fn_downstream_cartes_chunk (0001) retourne SETOF public.t_cartes avec
-- SELECT * : les nouvelles colonnes sont renvoyees automatiquement au pull
-- (download-worker.js:79-95 les lit), aucune modification de la fonction.
--
-- Idempotent (ADD COLUMN IF NOT EXISTS) : rejouable sans danger sur un projet
-- ou les colonnes existent deja (cas probable de la production). ATTENTION :
-- IF NOT EXISTS ne compare pas les types ; si la production a deja une de ces
-- colonnes avec un type different (ex. TIMESTAMPTZ), elle est laissee telle
-- quelle -- verifier d'abord (voir ci-dessous).
--
-- Application : ce fichier est PREPARE, PAS ENCORE APPLIQUE. Ordre : dev
-- ajadkziqaskadlzboeqo D'ABORD ; production itvyayakwgzvfqvdrgyv seulement sur
-- instruction explicite de l'utilisateur, apres verification que la prod ne
-- possede pas deja ces colonnes (information_schema.columns). Aucun agent
-- n'execute ce fichier contre un projet Supabase reel (CLAUDE.md, README.md).
-- ============================================================

ALTER TABLE public.t_cartes ADD COLUMN IF NOT EXISTS contact_retirant           TEXT;
ALTER TABLE public.t_cartes ADD COLUMN IF NOT EXISTS relation_retirant          TEXT;
ALTER TABLE public.t_cartes ADD COLUMN IF NOT EXISTS doublon_declare_par        TEXT;
ALTER TABLE public.t_cartes ADD COLUMN IF NOT EXISTS doublon_declare_le         TEXT;
ALTER TABLE public.t_cartes ADD COLUMN IF NOT EXISTS doublon_motif              TEXT;
ALTER TABLE public.t_cartes ADD COLUMN IF NOT EXISTS statut_avant_doublon       TEXT;
ALTER TABLE public.t_cartes ADD COLUMN IF NOT EXISTS doublon_annule_par         TEXT;
ALTER TABLE public.t_cartes ADD COLUMN IF NOT EXISTS doublon_annule_le          TEXT;
ALTER TABLE public.t_cartes ADD COLUMN IF NOT EXISTS doublon_motif_annulation   TEXT;
ALTER TABLE public.t_cartes ADD COLUMN IF NOT EXISTS note_signalement_absence   TEXT;
ALTER TABLE public.t_cartes ADD COLUMN IF NOT EXISTS escalade_niveau            TEXT;
ALTER TABLE public.t_cartes ADD COLUMN IF NOT EXISTS has_invalid_date           INTEGER;

-- Rechargement du cache de schema PostgREST (sinon l'erreur "schema cache"
-- peut persister quelques instants apres l'ALTER).
NOTIFY pgrst, 'reload schema';
