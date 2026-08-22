-- ============================================================
-- 0003_apurement_correction_annulation.sql
-- GEST-IN-SITU : ajout des colonnes de correction/annulation d'un
-- émargement Apurement sur t_cartes
--
-- Migration NEUVE (pas une capture rétroactive comme 0001/0002) : ces 6
-- colonnes ont été ajoutées en local (SQLite, migration V69 — voir
-- src/main/database/schema.ts) par la fonctionnalité de correction/
-- annulation d'un émargement Apurement, mais n'existent pas encore côté
-- Supabase. Vérifié le 22/08/2026 par requête PostgREST directe sur le
-- projet dev/staging (zddibqgutigwxjwbojmn) :
-- GET /rest/v1/t_cartes?select=id_carte,apurement_correction_par,...
-- → 400 { code: "42703", message: "column t_cartes.apurement_correction_par
-- does not exist" }.
--
-- Colonnes ajoutées (toutes TEXT, nullable — pas de valeur par défaut,
-- alignées sur le type SQLite source) :
--   - apurement_correction_par / _le / _motif : traçabilité d'une
--     correction d'un émargement Apurement déjà enregistré.
--   - apurement_annulation_par / _le / _motif : traçabilité d'une
--     annulation d'un émargement Apurement déjà enregistré.
--
-- Idempotent (ADD COLUMN IF NOT EXISTS) : une exécution accidentelle sur
-- un projet où les colonnes existent déjà est sans danger.
--
-- Application : dev/staging (zddibqgutigwxjwbojmn) PUIS production
-- (itvyayakwgzvfqvdrgyv) — jamais un seul des deux, voir README.md. À la
-- date de création de ce fichier, seule l'application sur dev/staging a
-- été validée explicitement par l'utilisateur ; la production reste à
-- traiter séparément.
-- ============================================================

ALTER TABLE public.t_cartes ADD COLUMN IF NOT EXISTS apurement_correction_par     TEXT;
ALTER TABLE public.t_cartes ADD COLUMN IF NOT EXISTS apurement_correction_le      TEXT;
ALTER TABLE public.t_cartes ADD COLUMN IF NOT EXISTS apurement_correction_motif   TEXT;
ALTER TABLE public.t_cartes ADD COLUMN IF NOT EXISTS apurement_annulation_par     TEXT;
ALTER TABLE public.t_cartes ADD COLUMN IF NOT EXISTS apurement_annulation_le      TEXT;
ALTER TABLE public.t_cartes ADD COLUMN IF NOT EXISTS apurement_annulation_motif   TEXT;
